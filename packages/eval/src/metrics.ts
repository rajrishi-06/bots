/**
 * Retrieval metrics.
 *
 * These are the functions that turn "retrieval feels good" into a number a
 * regression can fail on. They are also the ones that get subtly wrong in
 * practice — nDCG's log base, whether ranks are 0- or 1-indexed, what happens
 * when a question has more relevant chunks than k — so each has a hand-checked
 * test with the arithmetic written out.
 *
 * Relevance is binary here (a chunk either answers the question or it does
 * not). Graded relevance would need a labelling effort the golden set does not
 * justify yet.
 */

export interface Judged {
  /** Retrieved chunk ids, best first. */
  retrieved: readonly string[];
  /** Ids a correct answer must surface. Order irrelevant. */
  relevant: readonly string[];
}

/**
 * Fraction of the relevant chunks that appear in the top k.
 *
 * Capped at 1 even when `relevant` is larger than k: a question with 8 relevant
 * chunks cannot have all of them in the top 5, and scoring it 5/8 would punish
 * the retriever for the labeller's generosity. The denominator is therefore
 * min(|relevant|, k).
 */
export function recallAtK({ retrieved, relevant }: Judged, k: number): number {
  if (relevant.length === 0) return 1; // nothing to find, nothing to miss
  const top = new Set(retrieved.slice(0, k));
  const hits = relevant.filter((id) => top.has(id)).length;
  return hits / Math.min(relevant.length, k);
}

/** Precision@k — of what we showed, how much was worth showing. */
export function precisionAtK({ retrieved, relevant }: Judged, k: number): number {
  const top = retrieved.slice(0, k);
  if (top.length === 0) return 0;
  const rel = new Set(relevant);
  return top.filter((id) => rel.has(id)).length / top.length;
}

/**
 * Reciprocal rank of the FIRST relevant chunk. 0 when none is retrieved.
 *
 * The metric that matters most for a chat bot specifically: the model reads the
 * top chunks, so a correct answer buried at rank 9 is a wrong answer.
 */
export function reciprocalRank({ retrieved, relevant }: Judged): number {
  const rel = new Set(relevant);
  const i = retrieved.findIndex((id) => rel.has(id));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Discounted cumulative gain over binary relevance, 1-indexed ranks. */
function dcg(gains: readonly number[]): number {
  return gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
}

/**
 * nDCG@k. Rewards putting relevant chunks high, normalised so a question with
 * few relevant chunks is comparable to one with many.
 */
export function ndcgAtK({ retrieved, relevant }: Judged, k: number): number {
  if (relevant.length === 0) return 1;
  const rel = new Set(relevant);
  const gains = retrieved.slice(0, k).map((id) => (rel.has(id) ? 1 : 0));
  const ideal = new Array(Math.min(relevant.length, k)).fill(1) as number[];
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 0 : dcg(gains) / idealDcg;
}

export interface MetricSet {
  n: number;
  recallAt5: number;
  precisionAt5: number;
  mrr: number;
  ndcgAt10: number;
  /** Share of questions where nothing relevant was retrieved at all. */
  missRate: number;
}

/** Mean of each metric across the golden set. */
export function aggregate(judged: readonly Judged[]): MetricSet {
  const n = judged.length;
  if (n === 0) {
    return { n: 0, recallAt5: 0, precisionAt5: 0, mrr: 0, ndcgAt10: 0, missRate: 0 };
  }
  const mean = (f: (j: Judged) => number) => judged.reduce((s, j) => s + f(j), 0) / n;
  return {
    n,
    recallAt5: mean((j) => recallAtK(j, 5)),
    precisionAt5: mean((j) => precisionAtK(j, 5)),
    mrr: mean(reciprocalRank),
    ndcgAt10: mean((j) => ndcgAtK(j, 10)),
    missRate: mean((j) => (reciprocalRank(j) === 0 ? 1 : 0)),
  };
}
