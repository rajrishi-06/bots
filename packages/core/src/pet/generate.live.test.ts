import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../models/gemini.js";
import { generatePet } from "./generate.js";
import { validatePetPalette } from "./palette.js";
import { petSpecSchema } from "./spec.js";

/**
 * Prompt → PetSpec, against the live model.
 *
 * The claim under test is the plan's central bet on the pet engine: that a
 * flash-lite tier under a strict schema is sufficient, because the schema does
 * the work. Skipped without GEMINI_API_KEY.
 */

const live = describe.skipIf(!process.env.GEMINI_API_KEY);

live("pet generation (live)", () => {
  const provider = new GeminiProvider();

  it("turns a prompt into a valid, legible pet", { timeout: 120_000 }, async () => {
    const { spec, attempts } = await generatePet(provider, { prompt: "a sleepy lavender axolotl" });

    expect(() => petSpecSchema.parse(spec)).not.toThrow();
    expect(validatePetPalette(spec.palette).ok).toBe(true);
    expect(spec.name.length).toBeGreaterThan(0);
    expect(spec.personality.blurb.length).toBeGreaterThan(3);
    expect(attempts).toBeLessThanOrEqual(3);

    console.log(
      `  → ${spec.name} [${attempts} attempt(s)] ${spec.skeleton} ` +
        `${Object.values(spec.parts).join("/")} ${spec.palette.shellHi}→${spec.palette.shellLo} ` +
        `energy=${spec.personality.energy} "${spec.personality.blurb}"`,
    );
  });

  it("picks parts that match the prompt rather than defaulting", { timeout: 120_000 }, async () => {
    const { spec } = await generatePet(provider, { prompt: "a sleek black cat with pointed ears" });
    // The library has a `cat` head and an `ears` crown. A model ignoring the
    // prompt would still be schema-valid, which is exactly why this is checked.
    expect([spec.parts.head, spec.parts.crown]).toContain(
      spec.parts.head === "cat" ? "cat" : "ears",
    );
    console.log(`  → ${spec.name}: head=${spec.parts.head} crown=${spec.parts.crown}`);
  });

  it("produces a payload small enough to hot-swap without a reload", { timeout: 120_000 }, async () => {
    const { spec } = await generatePet(provider, { prompt: "a tiny brass clockwork owl" });
    const bytes = Buffer.byteLength(JSON.stringify(spec));
    // The plan's claim that swapping a pet is a data change, not a remount,
    // rests on this staying tiny.
    expect(bytes).toBeLessThan(1200);
    console.log(`  → ${spec.name}: ${bytes} bytes`);
  });

  it("every generated palette passes the contrast gate on both grounds", { timeout: 300_000 }, async () => {
    // Acceptance criterion 11, scaled down. Runs prompts that actively invite a
    // failing palette — washed-out pastels and near-black creatures are exactly
    // what an unguarded model produces and what vanishes on a real page.
    const prompts = [
      "a pale ghost made of mist",
      "a shadow creature from the void",
      "a neon acid-green tree frog",
      "a sun-bleached desert lizard",
    ];
    const results = await Promise.all(
      prompts.map((p) => generatePet(provider, { prompt: p, maxAttempts: 4 })),
    );
    for (const [i, { spec, attempts }] of results.entries()) {
      const verdict = validatePetPalette(spec.palette);
      console.log(`  → "${prompts[i]}" → ${spec.name} [${attempts}] ok=${verdict.ok}`);
      expect(verdict.ok, `${prompts[i]} produced an illegible palette`).toBe(true);
    }
  });
});
