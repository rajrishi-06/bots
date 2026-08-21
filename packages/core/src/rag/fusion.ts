/**
 * Reciprocal Rank Fusion.
 *
 * Combines the dense and BM25 result lists without needing their scores to be
 * comparable — which they are not, and which is exactly why naive score
 * addition (or min-max normalising two differently-shaped distributions)
 * misbehaves. RRF only reads RANK, so it is scale-free.
 *
 *   score(d) = Σ over lists  1 / (k + rank(d))
 *
 * k=60 is the value from the original paper and the one every implementation
 * that reports numbers uses; it damps the top of each list enough that a single
 * list cannot dominate the fusion on its own.
 */

export const RRF_K = 60;

export interface FusedResult<T> {
  id: T;
  score: number;
  /** 1-based rank in each input list, or null where absent. Shown in the debug panel:
   *  "dense #1, bm25 absent" is the clearest explanation of why fusion moved a chunk. */
  ranks: (number | null)[];
}

/**
 * Fuse ranked id lists. Input lists are ordered best-first; ids may repeat
 * across lists and need not appear in all of them.
 */
export function reciprocalRankFusion<T extends string | number>(
  lists: readonly (readonly T[])[],
  k: number = RRF_K,
): FusedResult<T>[] {
  const scores = new Map<T, number>();
  const ranks = new Map<T, (number | null)[]>();

  const blank = () => new Array<number | null>(lists.length).fill(null);

  lists.forEach((list, listIndex) => {
    list.forEach((id, i) => {
      const rank = i + 1;
      // Guard against a list containing the same id twice — only its best rank counts.
      const seen = ranks.get(id) ?? blank();
      if (seen[listIndex] !== null) return;
      seen[listIndex] = rank;
      ranks.set(id, seen);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  });

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, ranks: ranks.get(id) ?? blank() }))
    .sort((a, b) => b.score - a.score);
}
