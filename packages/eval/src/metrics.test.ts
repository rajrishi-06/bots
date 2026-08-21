import { describe, expect, it } from "vitest";
import { aggregate, ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from "./metrics.js";

const j = (retrieved: string[], relevant: string[]) => ({ retrieved, relevant });

describe("recallAtK", () => {
  it("counts relevant chunks found in the top k", () => {
    expect(recallAtK(j(["a", "b", "c", "d", "e"], ["a", "c"]), 5)).toBe(1);
    expect(recallAtK(j(["a", "x", "y", "z", "w"], ["a", "c"]), 5)).toBe(0.5);
  });

  it("ignores chunks below the cutoff", () => {
    expect(recallAtK(j(["x", "y", "z", "w", "v", "a"], ["a"]), 5)).toBe(0);
  });

  it("does not punish a retriever for a generous labeller", () => {
    // 8 relevant chunks cannot all fit in the top 5. Scoring 5/8 would measure
    // the labelling, not the retrieval — the denominator is min(|relevant|, k).
    const relevant = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(recallAtK(j(["a", "b", "c", "d", "e"], relevant), 5)).toBe(1);
  });

  it("treats a question with no relevant chunks as trivially satisfied", () => {
    expect(recallAtK(j(["a"], []), 5)).toBe(1);
  });
});

describe("precisionAtK", () => {
  it("measures how much of what we showed was worth showing", () => {
    expect(precisionAtK(j(["a", "b", "c", "d"], ["a", "b"]), 4)).toBe(0.5);
  });
  it("is 0 when nothing was retrieved", () => {
    expect(precisionAtK(j([], ["a"]), 5)).toBe(0);
  });
});

describe("reciprocalRank", () => {
  it("is 1 when the first result is relevant", () => {
    expect(reciprocalRank(j(["a", "b"], ["a"]))).toBe(1);
  });
  it("falls off with the rank of the first hit", () => {
    expect(reciprocalRank(j(["x", "a"], ["a"]))).toBe(0.5);
    expect(reciprocalRank(j(["x", "y", "a"], ["a"]))).toBeCloseTo(1 / 3, 10);
  });
  it("is 0 when nothing relevant came back", () => {
    expect(reciprocalRank(j(["x", "y"], ["a"]))).toBe(0);
  });
});

describe("ndcgAtK", () => {
  it("is 1 for a perfect ranking", () => {
    expect(ndcgAtK(j(["a", "b", "c"], ["a", "b"]), 10)).toBeCloseTo(1, 10);
  });

  it("matches hand-computed DCG for a known imperfect ranking", () => {
    // Retrieved [x, a]; relevant {a}. Gains [0, 1].
    //   DCG  = 0/log2(2) + 1/log2(3) = 1/1.584963 = 0.630930
    //   IDCG = 1/log2(2) = 1
    const value = ndcgAtK(j(["x", "a"], ["a"]), 10);
    expect(value).toBeCloseTo(1 / Math.log2(3), 10);
    expect(value).toBeCloseTo(0.63093, 5);
  });

  it("rewards ranking the relevant chunk higher", () => {
    const high = ndcgAtK(j(["a", "x", "y"], ["a"]), 10);
    const low = ndcgAtK(j(["x", "y", "a"], ["a"]), 10);
    expect(high).toBeGreaterThan(low);
  });

  it("is 0 when nothing relevant is in the top k", () => {
    expect(ndcgAtK(j(["x", "y"], ["a"]), 2)).toBe(0);
  });

  it("normalises so questions with different relevant-set sizes are comparable", () => {
    const one = ndcgAtK(j(["a", "x"], ["a"]), 10);
    const two = ndcgAtK(j(["a", "b"], ["a", "b"]), 10);
    expect(one).toBeCloseTo(1, 10);
    expect(two).toBeCloseTo(1, 10);
  });
});

describe("aggregate", () => {
  it("averages across the golden set and reports the miss rate", () => {
    const set = [
      j(["a", "x"], ["a"]), // perfect
      j(["x", "y"], ["b"]), // complete miss
    ];
    const m = aggregate(set);
    expect(m.n).toBe(2);
    expect(m.mrr).toBe(0.5); // (1 + 0) / 2
    expect(m.missRate).toBe(0.5);
    expect(m.recallAt5).toBe(0.5);
  });

  it("returns zeros rather than NaN for an empty set", () => {
    const m = aggregate([]);
    expect(Object.values(m).every((v) => Number.isFinite(v))).toBe(true);
  });
});
