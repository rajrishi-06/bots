import {
  applyGate,
  reciprocalRankFusion,
  type GateDecision,
  type GroundingMode,
  type ModelProvider,
  type Reranker,
} from "@bots/core";
import type { Sql, TransactionSql } from "postgres";

/**
 * Anything that can run a query.
 *
 * Retrieval must work inside a transaction, because the API opens one per
 * request to `SET LOCAL app.bot_id` for RLS — and postgres.js types a
 * transaction as a narrower thing than a pool, not a subtype of it. This
 * pipeline only ever issues queries, so the pool-lifecycle half of `Sql` is not
 * part of what it needs.
 */
export type Queryable = Sql | TransactionSql;

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

/**
 * Per-stage toggles.
 *
 * Exists so the eval harness can run a real ablation — dense-only, +BM25, +RRF,
 * +rerank — and attribute a score change to a stage instead of asserting one.
 * Production always runs everything; nothing else should be passing this.
 */
export interface Stages {
  dense?: boolean;
  bm25?: boolean;
  rerank?: boolean;
  rewrite?: boolean;
}

const ALL_STAGES: Required<Stages> = { dense: true, bm25: true, rerank: true, rewrite: true };

export interface RetrieveInput {
  sql: Queryable;
  provider: ModelProvider;
  reranker: Reranker;
  botId: string;
  query: string;
  /** Prior turns, oldest first. Used only to condense a follow-up into a standalone query. */
  history?: { role: "user" | "assistant"; content: string }[];
  mode: GroundingMode;
  threshold?: number;
  stages?: Stages;
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
async function denseSearch(sql: Queryable, botId: string, embedding: number[], k: number): Promise<Row[]> {
  const literal = `[${embedding.join(",")}]`;
  return sql<Row[]>`
    SELECT id, document_id, heading_path, content
    FROM chunks
    WHERE bot_id = ${botId} AND embedding IS NOT NULL
    ORDER BY embedding <#> ${literal}::vector
    LIMIT ${k}`;
}

/**
 * BM25-ish lexical retrieval over the generated tsvector.
 *
 * The query is reduced to lexemes and OR-ed, NOT passed through
 * `websearch_to_tsquery`. That function ANDs every term — "How long do EU
 * customers have to request a refund?" becomes
 * `'long' & 'eu' & 'custom' & 'request' & 'refund'`, which requires one chunk to
 * contain all five and therefore matched nothing on any real question. The eval
 * harness caught it: BM25 scored recall@5 of 0.000 across the whole golden set
 * while looking like it was running, because zero rows is not an error.
 *
 * OR-ing recovers the documents; `ts_rank_cd` does the discriminating, since it
 * weights term frequency and proximity and rewards chunks matching more terms.
 */
async function bm25Search(sql: Queryable, botId: string, query: string, k: number): Promise<Row[]> {
  // Lexemes come from to_tsvector so they are stemmed and stop-worded exactly
  // like the indexed column — building the query string by hand would not match.
  return sql<Row[]>`
    WITH q AS (
      SELECT to_tsquery(
        'english',
        array_to_string(tsvector_to_array(to_tsvector('english', ${query})), ' | ')
      ) AS query
    )
    SELECT c.id, c.document_id, c.heading_path, c.content
    FROM chunks c, q
    WHERE c.bot_id = ${botId}
      AND q.query IS NOT NULL
      AND c.tsv @@ q.query
    ORDER BY ts_rank_cd(c.tsv, q.query) DESC
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
  stages,
  signal,
}: RetrieveInput): Promise<RetrieveResult> {
  const on = { ...ALL_STAGES, ...stages };
  if (!on.dense && !on.bm25) throw new Error("At least one retriever must be enabled.");
  const timings: Record<string, number> = {};
  const clock = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      timings[stage] = Math.round(performance.now() - t);
    }
  };

  const rewrittenQuery = on.rewrite
    ? await clock("rewrite", () => rewriteQuery(provider, query, history, signal))
    : query;

  // Both retrievers pre-filter on bot_id. RLS is the second line, not the first.
  const [dense, bm25] = await clock("search", async () => {
    const densePromise = on.dense
      ? clock("embed", () => provider.embed([rewrittenQuery], "query")).then(([e]) => {
          if (!e) throw new Error("Query embedding failed.");
          return denseSearch(sql, botId, e, CANDIDATE_K);
        })
      : Promise.resolve([] as Row[]);
    const bm25Promise = on.bm25
      ? bm25Search(sql, botId, rewrittenQuery, CANDIDATE_K)
      : Promise.resolve([] as Row[]);
    return Promise.all([densePromise, bm25Promise]);
  });

  const byId = new Map<string, Row>();
  for (const r of [...dense, ...bm25]) byId.set(r.id, r);

  // Only fuse the lists that ran, so a single-retriever ablation keeps that
  // retriever's own ordering rather than fusing it against an empty list.
  const lists = [
    ...(on.dense ? [dense.map((r) => r.id)] : []),
    ...(on.bm25 ? [bm25.map((r) => r.id)] : []),
  ];
  const fused = reciprocalRankFusion(lists);

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

  const ranked = on.rerank
    ? await clock("rerank", () => reranker.rerank(rewrittenQuery, candidates, { signal }))
    // Without a reranker the fused order stands, and the fused score becomes the
    // gate input. RRF scores are ~1/60 scale, so they are normalised against the
    // top hit — otherwise every ablation row would trip the gate on scale alone.
    : fused.map((f, index) => ({ index, score: f.score / (fused[0]?.score || 1) }));

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
