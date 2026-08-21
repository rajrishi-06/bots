import { describe, expect, it } from "vitest";
import { RRF_K, reciprocalRankFusion } from "./fusion.js";

describe("reciprocalRankFusion", () => {
  it("ranks a document both retrievers found above one only a single retriever found", () => {
    // This is the property the whole fusion step exists for: agreement across
    // two independent retrievers beats a strong hit from one of them.
    //   b: 2nd in both  → 1/62 + 1/62 = 0.032258
    //   a: 1st in one   → 1/61        = 0.016393
    const fused = reciprocalRankFusion([
      ["a", "b"],
      ["b"],
    ]);
    expect(fused[0]!.id).toBe("b");
  });

  it("barely favours a single #1 over 2nd-in-both when both lists are complete", () => {
    // Worth pinning because it is counter-intuitive. With k=60 the damping is
    // gentle, so across two fully-overlapping reversed lists:
    //   a: 1/61 + 1/63 = 0.0322656
    //   b: 1/62 + 1/62 = 0.0322581
    // 'a' wins by 8.4e-6. Consensus only dominates once a candidate is MISSING
    // from a list (previous test) — not merely ranked lower in it.
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["c", "b", "a"],
    ]);
    expect(fused[0]!.id).not.toBe("b");
    expect(fused[0]!.score - fused[2]!.score).toBeLessThan(1e-4);
  });

  it("is scale-free — only rank matters, never the caller's scores", () => {
    const fused = reciprocalRankFusion([["x", "y"], ["y", "x"]]);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 10);
  });

  it("keeps documents that appear in only one list", () => {
    const fused = reciprocalRankFusion([["a"], ["b"]]);
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("records per-list ranks, with null where a document was absent", () => {
    const fused = reciprocalRankFusion([["a", "b"], ["b"]]);
    const a = fused.find((f) => f.id === "a")!;
    const b = fused.find((f) => f.id === "b")!;
    expect(a.ranks).toEqual([1, null]);
    expect(b.ranks).toEqual([2, 1]);
  });

  it("counts a duplicated id only at its best rank", () => {
    const dup = reciprocalRankFusion([["a", "a", "a"]]);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("returns an empty array for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});
