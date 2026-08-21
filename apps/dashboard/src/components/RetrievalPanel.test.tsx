import { cleanup, render, screen } from "@testing-library/react";
import type { RetrievalTrace } from "@bots/rag";
import { afterEach, describe, expect, it } from "vitest";
import { RetrievalPanel, type DebugChunk } from "./RetrievalPanel";

/**
 * The signature screen. What is asserted here is what makes it an instrument
 * readout rather than a JSON dump — the paired bars, the drawn gate line, and
 * the fact that the numbers shown are the real ones.
 */

const trace = (over: Partial<RetrievalTrace> = {}): RetrievalTrace => ({
  rewrittenQuery: "EU refund window",
  denseCount: 12,
  bm25Count: 7,
  fusedCount: 15,
  gate: { useContext: true, refuse: false, reason: "top score 0.900 ≥ threshold 0.45" },
  timings: { rewrite: 120, embed: 340, search: 22, rerank: 7800 },
  ...over,
});

const chunk = (over: Partial<DebugChunk> = {}): DebugChunk => ({
  id: "c1",
  headingPath: "Billing › Refunds › EU",
  preview: "EU customers may request a refund within 14 days of purchase.",
  score: 0.9,
  fusedScore: 0.0325,
  ranks: [1, 2],
  ...over,
});

// Without globals:true, testing-library does not auto-clean, and every
// query then matches the previous test's DOM as well as this one's.
afterEach(cleanup);

describe("RetrievalPanel", () => {
  it("shows the rewritten query, not just the original", () => {
    render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    expect(screen.getByText("EU refund window")).toBeTruthy();
  });

  it("shows each retriever's contribution separately", () => {
    const { container } = render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    const text = container.textContent ?? "";
    expect(text).toContain("12"); // dense
    expect(text).toContain("7"); // bm25
    expect(text).toContain("15"); // fused
  });

  it("labels per-retriever ranks readably instead of printing an array", () => {
    render(<RetrievalPanel trace={trace()} chunks={[chunk({ ranks: [1, null] })]} threshold={0.45} />);
    // "dense #1  bm25 —" beats "[1,null]".
    expect(screen.getByText(/dense #1/)).toBeTruthy();
    expect(screen.getByText(/bm25 —/)).toBeTruthy();
  });

  it("draws BOTH bars, so the rerank is visible as movement", () => {
    const { container } = render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    expect(container.querySelector(".bar.fused")).toBeTruthy();
    expect(container.querySelector(".bar.final")).toBeTruthy();
  });

  it("shows the REAL pre-rerank score, not the normalised one used for the bar", () => {
    const { container } = render(
      <RetrievalPanel trace={trace()} chunks={[chunk({ fusedScore: 0.0325 })]} threshold={0.45} />,
    );
    // The bar is normalised so the two are comparable; presenting that
    // normalised value as the score would be a lie.
    expect(container.textContent).toContain("0.0325");
  });

  it("draws the gate threshold as a line positioned at its actual value", () => {
    const { container } = render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    const line = container.querySelector<HTMLElement>(".threshold");
    expect(line).toBeTruthy();
    expect(line!.style.left).toBe("45%");
  });

  it("dims a chunk that falls under the gate", () => {
    const { container } = render(
      <RetrievalPanel
        trace={trace()}
        chunks={[chunk({ score: 0.9 }), chunk({ id: "c2", score: 0.2 })]}
        threshold={0.45}
      />,
    );
    const chunks = container.querySelectorAll(".chunk");
    expect(chunks[0]!.className).not.toContain("under");
    expect(chunks[1]!.className).toContain("under");
  });

  it("shows the heading path for every chunk", () => {
    render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    expect(screen.getByText("Billing › Refunds › EU")).toBeTruthy();
  });

  it("says REFUSED and gives the gate's own reasoning when it fires", () => {
    const t = trace({
      gate: { useContext: false, refuse: true, reason: "top score 0.210 < threshold 0.45 — strict: refused" },
    });
    render(<RetrievalPanel trace={t} chunks={[chunk({ score: 0.21 })]} threshold={0.45} />);
    expect(screen.getByText("REFUSED")).toBeTruthy();
    expect(screen.getByText(/strict: refused/)).toBeTruthy();
  });

  it("distinguishes answering-unaided from using context", () => {
    const t = trace({
      gate: { useContext: false, refuse: false, reason: "blended: answering unaided" },
    });
    render(<RetrievalPanel trace={t} chunks={[]} threshold={0.45} />);
    expect(screen.getByText("UNAIDED")).toBeTruthy();
  });

  it("says so plainly when retrieval returned nothing", () => {
    render(<RetrievalPanel trace={trace({ fusedCount: 0 })} chunks={[]} threshold={0.45} />);
    expect(screen.getByText(/returned nothing/)).toBeTruthy();
  });

  it("reports per-stage timings, including the one that hurts", () => {
    const { container } = render(<RetrievalPanel trace={trace()} chunks={[chunk()]} threshold={0.45} />);
    const timings = container.querySelector(".timings")?.textContent ?? "";
    expect(timings).toContain("rerank");
    expect(timings).toContain("7800ms");
  });
});
