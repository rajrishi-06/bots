import { GeminiProvider, GeminiReranker } from "@bots/core";
import postgres from "postgres";
import { ABLATIONS, formatFailures, formatTable, runAblation, seed, type RunResult } from "./run.js";

/**
 * `pnpm --filter @bots/eval bench`
 *
 * Seeds a throwaway bot with the fixed corpus, runs the golden set through every
 * ablation, prints the table, and exits non-zero if the full pipeline regresses
 * below the floor — so CI can gate on retrieval quality, not just on tests.
 */

// Floors, not targets. Set from a measured baseline and raised deliberately.
const FLOOR = { recallAt5: 0.75, ndcgAt10: 0.7, gateAccuracy: 1 };

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL).");
if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY.");

const contextualize = process.env.EVAL_CONTEXTUALIZE !== "0";
const sql = postgres(url, { max: 4 });
const provider = new GeminiProvider();
const reranker = new GeminiReranker();

console.log(`\nSeeding corpus (contextual retrieval: ${contextualize ? "on" : "off"})…`);
const { botId, primaryDocId, chunkCount, cleanup } = await seed(sql, provider, { contextualize });
console.log(`  ${chunkCount} chunks indexed (handbook + 2 distractors)`);

const runs: RunResult[] = [];
try {
  for (const ablation of ABLATIONS) {
    process.stdout.write(`  ${ablation.label}… `);
    const run = await runAblation(sql, provider, reranker, botId, primaryDocId, ablation);
    runs.push(run);
    console.log(`recall@5 ${run.metrics.recallAt5.toFixed(3)}  (${run.elapsedMs}ms)`);
  }

  console.log(`\n${formatTable(runs)}\n`);

  const full = runs[runs.length - 1]!;
  console.log(`Misses in the full pipeline:\n${formatFailures(full)}\n`);

  const failed = [
    full.metrics.recallAt5 < FLOOR.recallAt5 && `recall@5 ${full.metrics.recallAt5.toFixed(3)} < ${FLOOR.recallAt5}`,
    full.metrics.ndcgAt10 < FLOOR.ndcgAt10 && `nDCG@10 ${full.metrics.ndcgAt10.toFixed(3)} < ${FLOOR.ndcgAt10}`,
    full.gateAccuracy < FLOOR.gateAccuracy && `gate accuracy ${full.gateAccuracy.toFixed(2)} < ${FLOOR.gateAccuracy}`,
  ].filter(Boolean);

  if (failed.length) {
    console.error(`REGRESSION:\n${failed.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All floors met.\n");
  }
} finally {
  await cleanup();
  await sql.end();
}
