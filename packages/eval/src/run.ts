import type { ModelProvider, Reranker } from "@bots/core";
import { ingestDocument, retrieve, type Stages } from "@bots/rag";
import type { Sql } from "postgres";
import { CORPUS, DISTRACTORS, GOLDEN, type GoldenQuestion } from "./corpus.js";
import { aggregate, type Judged, type MetricSet } from "./metrics.js";

/**
 * The harness. Seeds a bot with the fixed corpus, runs the golden set through
 * the real pipeline, and reports metrics per configuration.
 *
 * It runs the SAME `retrieve()` the API serves from — not a reimplementation.
 * A harness that measures its own copy of the pipeline measures nothing.
 */

export interface Ablation {
  label: string;
  stages: Stages;
}

/** The stages, added one at a time, so each row shows what that stage bought. */
export const ABLATIONS: Ablation[] = [
  { label: "dense only", stages: { dense: true, bm25: false, rerank: false, rewrite: false } },
  { label: "bm25 only", stages: { dense: false, bm25: true, rerank: false, rewrite: false } },
  { label: "hybrid + RRF", stages: { dense: true, bm25: true, rerank: false, rewrite: false } },
  { label: "hybrid + rerank", stages: { dense: true, bm25: true, rerank: true, rewrite: false } },
  { label: "full pipeline", stages: { dense: true, bm25: true, rerank: true, rewrite: true } },
];

export interface SeedResult {
  botId: string;
  /** The CURRENT handbook. Golden labels resolve against this document only, so
   *  a distractor containing the same phrase is never counted as correct. */
  primaryDocId: string;
  chunkCount: number;
  cleanup: () => Promise<void>;
}

/** Create a throwaway bot, ingest the corpus, and hand back a cleanup. */
export async function seed(
  sql: Sql,
  provider: ModelProvider,
  { contextualize }: { contextualize: boolean },
): Promise<SeedResult> {
  const [org] = await sql`INSERT INTO organizations (name) VALUES ('eval') RETURNING id`;
  const orgId = org!.id as string;
  const key = `pb_eval_${Math.random().toString(36).slice(2, 10)}`;
  const [bot] = await sql`
    INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'eval', ${key}) RETURNING id`;
  const botId = bot!.id as string;

  const [doc] = await sql`
    INSERT INTO documents (bot_id, source_type, title, checksum)
    VALUES (${botId}, 'upload', 'Northwind Support Handbook', ${`eval-${key}`}) RETURNING id`;

  const primaryDocId = doc!.id as string;
  const primary = await ingestDocument({
    sql, provider, botId, documentId: primaryDocId,
    markdown: CORPUS, title: "Northwind Support Handbook", contextualize,
  });

  // Distractors go in the SAME bot, as they would in production.
  let total = primary.chunkCount;
  for (const [i, d] of DISTRACTORS.entries()) {
    const [dd] = await sql`
      INSERT INTO documents (bot_id, source_type, title, checksum)
      VALUES (${botId}, 'upload', ${d.title}, ${`eval-${key}-d${i}`}) RETURNING id`;
    const r = await ingestDocument({
      sql, provider, botId, documentId: dd!.id as string,
      markdown: d.body, title: d.title, contextualize,
    });
    total += r.chunkCount;
  }

  return {
    botId,
    primaryDocId,
    chunkCount: total,
    cleanup: async () => {
      await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    },
  };
}

export interface QuestionResult {
  question: GoldenQuestion;
  /** Retrieved chunk ids in rank order. */
  retrieved: string[];
  /** Ids matched to the question's `expect` substrings. */
  relevant: string[];
  topScore: number | undefined;
  gateRefused: boolean;
  /** For out-of-scope questions: did the gate do the right thing? */
  correct: boolean;
}

export interface RunResult {
  label: string;
  metrics: MetricSet;
  /** Share of out-of-scope questions the gate correctly refused. */
  gateAccuracy: number;
  results: QuestionResult[];
  elapsedMs: number;
}

/**
 * Resolve each question's `expect` substrings to real chunk ids.
 *
 * Done by lookup against the corpus rather than by storing ids in the golden
 * set, so re-chunking the corpus does not silently invalidate every label.
 */
async function resolveRelevant(
  sql: Sql,
  botId: string,
  primaryDocId: string,
  q: GoldenQuestion,
): Promise<string[]> {
  if (q.expect.length === 0) return [];
  const ids = new Set<string>();
  for (const needle of q.expect) {
    // Scoped to the primary document: the deprecated handbook contains the same
    // phrases with different numbers, and matching those would score a
    // retriever for returning stale answers.
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM chunks
      WHERE bot_id = ${botId} AND document_id = ${primaryDocId}
        AND content LIKE ${"%" + needle + "%"}`;
    if (rows.length === 0) {
      throw new Error(
        `Golden set is stale: no chunk contains ${JSON.stringify(needle)} for "${q.question}".`,
      );
    }
    for (const r of rows) ids.add(r.id);
  }
  return [...ids];
}

export async function runAblation(
  sql: Sql,
  provider: ModelProvider,
  reranker: Reranker,
  botId: string,
  primaryDocId: string,
  ablation: Ablation,
): Promise<RunResult> {
  const started = Date.now();
  const results: QuestionResult[] = [];

  for (const question of GOLDEN) {
    const relevant = await resolveRelevant(sql, botId, primaryDocId, question);
    const { chunks, trace } = await retrieve({
      sql, provider, reranker, botId,
      query: question.question,
      mode: "strict",
      stages: ablation.stages,
    });

    const retrieved = chunks.map((c) => c.id);
    results.push({
      question,
      retrieved,
      relevant,
      topScore: chunks[0]?.score,
      gateRefused: trace.gate.refuse,
      // In scope: the gate must NOT refuse. Out of scope: it must.
      correct: question.outOfScope ? trace.gate.refuse : !trace.gate.refuse,
    });
  }

  const inScope = results.filter((r) => !r.question.outOfScope);
  const outOfScope = results.filter((r) => r.question.outOfScope);
  const judged: Judged[] = inScope.map((r) => ({ retrieved: r.retrieved, relevant: r.relevant }));

  return {
    label: ablation.label,
    metrics: aggregate(judged),
    gateAccuracy: outOfScope.length
      ? outOfScope.filter((r) => r.correct).length / outOfScope.length
      : 1,
    results,
    elapsedMs: Date.now() - started,
  };
}

/** Fixed-width table. The artifact the plan asks for. */
export function formatTable(runs: readonly RunResult[]): string {
  const head = ["configuration", "recall@5", "P@5", "MRR", "nDCG@10", "miss", "gate", "ms"];
  const rows = runs.map((r) => [
    r.label,
    r.metrics.recallAt5.toFixed(3),
    r.metrics.precisionAt5.toFixed(3),
    r.metrics.mrr.toFixed(3),
    r.metrics.ndcgAt10.toFixed(3),
    r.metrics.missRate.toFixed(3),
    r.gateAccuracy.toFixed(2),
    String(r.elapsedMs),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [line(head), widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** Per-question detail for the worst performers — where to actually look. */
export function formatFailures(run: RunResult, limit = 6): string {
  const failing = run.results
    .filter((r) => !r.question.outOfScope)
    .filter((r) => !r.retrieved.slice(0, 5).some((id) => r.relevant.includes(id)))
    .slice(0, limit);
  if (failing.length === 0) return "no in-scope question missed at rank 5";
  return failing
    .map((r) => `  ✗ ${r.question.question}\n      probes: ${r.question.probes}`)
    .join("\n");
}
