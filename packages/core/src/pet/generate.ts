import type { ModelProvider } from "../models/provider.js";
import { describePaletteIssues, validatePetPalette } from "./palette.js";
import { PART_OPTIONS, SKELETONS, THEMES, petSpecSchema, type PetSpec } from "./spec.js";

/**
 * Prompt → PetSpec.
 *
 * The schema does the work here, not the model. A measured pet spec came back
 * valid in 3.7s from a flash-lite tier with the right enum choices and a
 * coherent palette — emitting a small constrained object is not a reasoning
 * task, and paying for a large model's thinking tokens buys nothing.
 */

/**
 * JSON Schema for constrained decoding. Derived from the Zod enums so the two
 * cannot drift — adding a part in spec.ts is the only edit needed.
 *
 * Types are written as plain strings rather than the SDK's `Type` enum (whose
 * members are exactly these strings). This file is reachable from
 * `@bots/core/pet`, which the widget imports for PetSpec — a value import of
 * the Gemini SDK here would drag the whole thing into a 30KB bundle.
 */
const responseSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    theme: { type: "STRING", enum: [...THEMES] },
    skeleton: { type: "STRING", enum: [...SKELETONS] },
    parts: {
      type: "OBJECT",
      properties: Object.fromEntries(
        Object.entries(PART_OPTIONS).map(([slot, options]) => [
          slot,
          { type: "STRING", enum: [...options] },
        ]),
      ),
      required: Object.keys(PART_OPTIONS),
    },
    palette: {
      type: "OBJECT",
      properties: Object.fromEntries(
        ["shellHi", "shellLo", "plateHi", "plateLo", "visorHi", "visorLo", "lit"].map((k) => [
          k,
          { type: "STRING" },
        ]),
      ),
      required: ["shellHi", "shellLo", "plateHi", "plateLo", "visorHi", "visorLo", "lit"],
    },
    personality: {
      type: "OBJECT",
      properties: {
        energy: { type: "NUMBER" },
        curiosity: { type: "NUMBER" },
        blurb: { type: "STRING" },
      },
      required: ["energy", "curiosity", "blurb"],
    },
  },
  required: ["name", "theme", "skeleton", "parts", "palette", "personality"],
} as const;

const SYSTEM = `You design small on-screen creatures by SELECTING from a fixed parts library and choosing a colour palette. You never draw; you never emit SVG, paths, or coordinates.

THEME — the visual family, chosen first because it sets everything else's look:
  robot   clean machine, panels and a visor. The default.
  pixel   blocky and stepped. Nothing curves. Retro-game.
  animal  soft and organic. Snouts, ear tufts, rounded haunches.
  ghost   a wisp with a tapered, ragged hem and no feet.
  mech    angular and armoured. Hard bevels, a jaw plate.
Pick the theme the description actually implies: a frog or a cat is "animal", a
retro sprite is "pixel", a spirit or a wisp is "ghost", a war machine is "mech".

PARTS — pick exactly one option per slot:
${Object.entries(PART_OPTIONS)
  .map(([slot, options]) => `  ${slot}: ${options.join(" | ")}`)
  .join("\n")}
  skeleton: ${SKELETONS.join(" | ")}

PALETTE — seven hex colours that light one creature:
  shellHi / shellLo  the body gradient, light stop and dark stop
  plateHi / plateLo  limbs and secondary panels
  visorHi / visorLo  the face panel, always the darkest pair
  lit                the eyes and any glow — the single brightest colour

PALETTE RULES, and they are checked mechanically after you answer:
  - The pet is embedded on pages we do not control, over any background. So the
    palette must STRADDLE: include at least one stop dark enough to hold an
    outline on a white page, and at least one light enough on a near-black page.
  - shellHi must be clearly lighter than shellLo, or the body reads flat.
  - visorHi/visorLo must be much darker than shellHi — the face is a dark panel
    set into a lighter body.
  - lit must be bright and clearly readable against visorHi. The eyes are the
    face; if they wash out, the creature is dead.
  - Hue is yours. Commit to a palette with a point of view rather than hedging
    toward grey.

PERSONALITY drives real behaviour, so choose deliberately:
  energy     0 = slow and heavy, 1 = twitchy and quick. Sets breathing rate and
             how stiffly the body springs back.
  curiosity  0 = aloof, barely tracks. 1 = follows the cursor eagerly.
  blurb      one short sentence of character, written in third person.

Answer with the object only.`;

export interface GeneratePetOptions {
  /** What the user typed, e.g. "a sleepy lavender axolotl". */
  prompt: string;
  /** Re-roll budget when the palette gate rejects the result. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface GeneratePetResult {
  spec: PetSpec;
  /** 1 on a first-try success. Worth surfacing — a consistently high number
   *  means the palette rules in SYSTEM need rewording, not more retries. */
  attempts: number;
}

/**
 * Generate a pet, re-rolling while the contrast gate rejects it.
 *
 * Failures are fed back into the prompt by name — a blind retry tends to
 * reproduce the same washed-out palette, because the same prompt is still
 * asking for it.
 */
export async function generatePet(
  provider: ModelProvider,
  { prompt, maxAttempts = 3, signal }: GeneratePetOptions,
): Promise<GeneratePetResult> {
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const spec = await provider.generateJson<PetSpec>({
      system: SYSTEM,
      prompt: feedback ? `${prompt}\n\n${feedback}` : prompt,
      schema: responseSchema,
      // `v` is ours, not the model's — it has no business versioning our format.
      parse: (raw) => petSpecSchema.parse({ ...(raw as object), v: 1 }),
      signal,
    });

    const verdict = validatePetPalette(spec.palette);
    if (verdict.ok) return { spec, attempts: attempt };

    feedback =
      `Your previous palette was rejected by the contrast check:\n` +
      `${describePaletteIssues(verdict.issues)}\n` +
      `Keep the same character and parts. Fix only the colours.`;
  }

  throw new Error(
    `Could not produce a legible palette in ${maxAttempts} attempts. Last failures:\n${feedback}`,
  );
}
