import { beforeAll, describe, expect, it } from "vitest";
import { EMBED_DIM } from "./provider.js";
import { GeminiProvider, GeminiReranker } from "./gemini.js";

/**
 * Live contract test against the real Gemini API.
 *
 * Skipped without GEMINI_API_KEY, so the default suite stays hermetic. Run it
 * when the key is available — it checks the things that break SILENTLY when a
 * provider renames a model or changes a default:
 *
 *   - the model ids actually resolve
 *   - embeddings come back at EMBED_DIM, not the 3072 native width
 *   - they arrive UNIT-NORMALISED, which is the sole justification for the
 *     vector_ip_ops HNSW index. If that ever stops being true, every distance
 *     in the product is quietly wrong and nothing throws.
 */

const live = describe.skipIf(!process.env.GEMINI_API_KEY);

live("Gemini live contract", () => {
  // Constructed in beforeAll, NOT in the describe body: vitest still executes a
  // skipped suite's callback during collection, so building a provider there
  // throws "GEMINI_API_KEY is not set" for everyone without a key — including CI.
  let provider: GeminiProvider;
  beforeAll(() => {
    provider = new GeminiProvider();
  });

  it("embeds at the indexed width, unit-normalised", { timeout: 60_000 }, async () => {
    const [v] = await provider.embed(["EU customers may request a refund within 14 days."], "document");
    expect(v).toBeDefined();
    expect(v!.length).toBe(EMBED_DIM);

    const norm = Math.hypot(...v!);
    // The vector_ip_ops index in @bots/db is only correct while this holds.
    expect(norm).toBeCloseTo(1, 3);
  });

  it("does NOT currently embed asymmetrically — taskType is accepted and ignored", { timeout: 60_000 }, async () => {
    const text = "refund window";
    const [asDoc] = await provider.embed([text], "document");
    const [asQuery] = await provider.embed([text], "query");
    const dot = asDoc!.reduce((s, x, i) => s + x * asQuery![i]!, 0);

    // Pins the measured behaviour rather than the documented one. The request
    // 200s with taskType set, which reads as support; the vectors are identical
    // to float precision, so retrieval is running symmetric. If this assertion
    // ever fails, taskType has STARTED working — remove the note in gemini.ts
    // and reinstate the asymmetry expectation.
    expect(dot).toBeGreaterThan(0.9999);
  });

  it("batches without losing or reordering inputs", { timeout: 90_000 }, async () => {
    const texts = ["alpha refund", "beta invoice", "gamma sso"];
    const vs = await provider.embed(texts, "document");
    expect(vs).toHaveLength(3);
    const [again] = await provider.embed([texts[1]!], "document");
    const dot = vs[1]!.reduce((s, x, i) => s + x * again![i]!, 0);
    expect(dot).toBeGreaterThan(0.99); // same text → same vector, so order held
  });

  it("streams a complete answer at a SMALL answer budget", { timeout: 120_000 }, async () => {
    // The regression guard for thinking-token starvation. The chat model spends
    // ~120-140 tokens thinking regardless of thinkingBudget, and they come out
    // of maxOutputTokens — so a naive request for 100 returned five tokens of a
    // truncated word. The adapter adds headroom; this proves it.
    let out = "";
    for await (const d of provider.generateStream({
      system: "Answer from the context only.",
      messages: [{ role: "user", content: "Context: 'EU refunds take 14 days.' How long do EU refunds take?" }],
      maxOutputTokens: 100,
    })) {
      out += d;
    }
    expect(out).toMatch(/14/);
    // Not truncated mid-word: the answer reaches a real terminator.
    expect(out.trim()).toMatch(/[.!?"']$/);
  });

  it("returns structured JSON under a schema", { timeout: 60_000 }, async () => {
    const res = await provider.generateJson<{ answer: string }>({
      system: "You extract facts.",
      prompt: "The refund window is 14 days. What is the refund window?",
      schema: { type: "OBJECT", properties: { answer: { type: "STRING" } }, required: ["answer"] },
      parse: (raw) => raw as { answer: string },
    });
    expect(res.answer).toMatch(/14/);
  });

  it("reranks the relevant passage to the top", { timeout: 60_000 }, async () => {
    const ranked = await new GeminiReranker().rerank(
      "How long do EU customers have to request a refund?",
      [
        "Invoices are issued monthly and emailed to the billing contact on the account.",
        "EU customers may request a refund within 14 days of purchase.",
        "Single sign-on is available on enterprise plans via SAML and OIDC.",
      ],
    );
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.index).toBe(1);
    // It must DISCRIMINATE, not just order — a flat scorer is useless as a gate input.
    expect(ranked[0]!.score).toBeGreaterThan(ranked[2]!.score + 0.2);
  });

  it("scores every candidate it was given, never dropping one", { timeout: 60_000 }, async () => {
    const ranked = await new GeminiReranker().rerank(
      "refund",
      Array.from({ length: 12 }, (_, i) => `Passage ${i} about assorted policies.`),
    );
    expect(ranked).toHaveLength(12);
    expect(new Set(ranked.map((r) => r.index)).size).toBe(12);
  });
});
