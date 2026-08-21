import {
  applyGate,
  reciprocalRankFusion,
  type GateDecision,
  type GroundingMode,
  type ModelProvider,
  type Reranker,
} from "@bots/core";
import type { Sql } from "postgres";

/**
 * The query-side pipeline.
 *
 * rewrite → (dense ‖ bm25) → RRF → rerank → gate
 *
 * Every stage records what it did into `RetrievalTrace`, because the retrieval
 * debug panel is a product surface, not a debug log — and because an eval
 * ablation needs per-stage rankings to attribute a score change to a stage.
 */

/** Candidates pulled from each retriever before fusion. */
export const CANDIDATE_K = 50;
/** Chunks that survive rerank and reach the model. */
export const CONTEXT_K = 5;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  headingPath: string;
  content: string;
  /** Post-rerank relevance. The number the gate reads and the panel draws. */
  score: number;
  /** Pre-rerank fused score. Shown beside `score` so the rerank is visible as movement. */
  fusedScore: number;
  /** 1-based rank in [dense, bm25]; null where that retriever did not return it. */
  ranks: (number | null)[];
}

export interface RetrievalTrace {
  /** The standalone query actually searched with, after history condensation. */
  rewrittenQuery: string;
  denseCount: number;
  bm25Count: number;
  fusedCount: number;
  gate: GateDecision;
  /** Wall-clock per stage, ms. The rerank number is the one that will hurt. */
  timings: Record<string, number>;
}

export interface RetrieveInput {
  sql: Sql;
  provider: ModelProvider;
  reranker: Reranker;
  botId: string;
  query: string;
  /** Prior turns, oldest first. Used only to condense a follow-up into a standalone query. */
  history?: { role: "user" | "assistant"; content: string }[];
  mode: GroundingMode;
  threshold?: number;
  signal?: AbortSignal;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  trace: RetrievalTrace;
}

/**
 * Condense a follow-up into a standalone query.
 *
 * This is the single biggest fix for multi-turn RAG failure. "What about the EU
 * one?" embeds to nothing useful on its own — the subject lives two turns back.
 * Skipped when there is no history, which is the common case and saves a call.
 */
export async function rewriteQuery(
  provider: ModelProvider,
  query: string,
  history: readonly { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<string> {
  if (history.length === 0) return query;

  const transcript = history
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");

  const rewritten = await provider.generateJson<{ query: string }>({
    system:
      "Rewrite the user's latest message as a standalone search query that makes sense " +
      "without the conversation. Resolve pronouns and elliptical references against the " +
      "transcript. Keep it short and keep the user's own words where you can. If the " +
      "message is already standalone, return it unchanged.",
    prompt: `${transcript}\nUser: ${query}\n\nStandalone query:`,
    schema: {
      type: "OBJECT",
      properties: { query: { type: "STRING" } },
      required: ["query"],
    },
    parse: (raw) => {
      const q = (raw as { query?: unknown }).query;
      // A rewrite that fails is never worth failing the whole request over —
      // the original query is always a usable fallback.
      return { query: typeof q === "string" && q.trim() ? q.trim() : query };
    },
    signal,
  });
  return rewritten.query;
}

interface Row {
  id: string;
  document_id: string;
  heading_path: string;
  content: string;
}

/** Dense retrieval. `<#>` is pgvector's inner-product operator (negated), which
 *  the HNSW index is built for; valid because embeddings are unit-normalised. */
async function denseSearch(sql: Sql, botId: string, embedding: number[], k: number): Promise<Row[]> {
  const literal = `[${embedding.join(",")}]`;
  return sql<Row[]>`
    SELECT id, document_id, heading_path, content
    FROM chunks
    WHERE bot_id = ${botId} AND embedding IS NOT NULL
    ORDER BY embedding <#> ${literal}::vector
    LIMIT ${k}`;
}

/** BM25-ish lexical retrieval over the generated tsvector.
 *  `websearch_to_tsquery` tolerates whatever a visitor types; plainto_ would
 *  choke on quotes and operators. `ts_rank_cd` accounts for term proximity. */
async function bm25Search(sql: Sql, botId: string, query: string, k: number): Promise<Row[]> {
  return sql<Row[]>`
    SELECT id, document_id, heading_path, content
    FROM chunks
    WHERE bot_id = ${botId}
      AND tsv @@ websearch_to_tsquery('english', ${query})
    ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('english', ${query})) DESC
    LIMIT ${k}`;
}

export async function retrieve({
  sql,
  provider,
  reranker,
  botId,
  query,
  history = [],
  mode,
  threshold,
  signal,
}: RetrieveInput): Promise<RetrieveResult> {
  const timings: Record<string, number> = {};
  const clock = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      timings[stage] = Math.round(performance.now() - t);
    }
  };

  const rewrittenQuery = await clock("rewrite", () =>
    rewriteQuery(provider, query, history, signal),
  );

  const [embedding] = await clock("embed", () => provider.embed([rewrittenQuery], "query"));
  if (!embedding) throw new Error("Query embedding failed.");

  // Both retrievers pre-filter on bot_id. RLS is the second line, not the first.
  const [dense, bm25] = await clock("search", () =>
    Promise.all([
      denseSearch(sql, botId, embedding, CANDIDATE_K),
      bm25Search(sql, botId, rewrittenQuery, CANDIDATE_K),
    ]),
  );

  const byId = new Map<string, Row>();
  for (const r of [...dense, ...bm25]) byId.set(r.id, r);

  const fused = reciprocalRankFusion([dense.map((r) => r.id), bm25.map((r) => r.id)]);

  if (fused.length === 0) {
    const gate = applyGate({ mode, topScore: undefined, threshold });
    return {
      chunks: [],
      trace: {
        rewrittenQuery,
        denseCount: dense.length,
        bm25Count: bm25.length,
        fusedCount: 0,
        gate,
        timings,
      },
    };
  }

  // Rerank sees the heading path too — "Billing › Refunds › EU" is often the
  // clearest signal in a chunk, and it is what the passage was embedded with.
  const candidates = fused.map((f) => {
    const row = byId.get(f.id)!;
    return row.heading_path ? `${row.heading_path}\n${row.content}` : row.content;
  });

  const ranked = await clock("rerank", () =>
    reranker.rerank(rewrittenQuery, candidates, { signal }),
  );

  const chunks: RetrievedChunk[] = ranked.slice(0, CONTEXT_K).map((r) => {
    const f = fused[r.index]!;
    const row = byId.get(f.id)!;
    return {
      id: row.id,
      documentId: row.document_id,
      headingPath: row.heading_path,
      content: row.content,
      score: r.score,
      fusedScore: f.score,
      ranks: f.ranks,
    };
  });

  const gate = applyGate({ mode, topScore: chunks[0]?.score, threshold });

  return {
    chunks,
    trace: {
      rewrittenQuery,
      denseCount: dense.length,
      bm25Count: bm25.length,
      fusedCount: fused.length,
      gate,
      timings,
    },
  };
}
