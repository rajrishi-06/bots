import { contrast, luminance, NEAR_BLACK, WHITE } from "../contrast.js";
import type { PetPalette } from "./spec.js";

/**
 * Contrast gate for a generated pet palette.
 *
 * ── Why this is not "every colour clears 4.5:1 on both grounds" ──────────────
 * That rule is impossible, and measurably so. For a colour of relative
 * luminance L, contrast against white is 1.05/(L+0.05) and against near-black
 * is (L+0.05)/0.05335. Those two curves cross at L ≈ 0.1867, where both equal
 * **4.435:1** — so 4.435 is the ceiling for ANY single colour that has to
 * survive both extremes. 4.5 on both grounds cannot be satisfied by any colour
 * that exists. (`palette.test.ts` asserts this so nobody re-raises the bar.)
 *
 * 3:1 is also the correct standard here on its own merits: a pet is a graphic,
 * and WCAG 1.4.11 sets non-text contrast at 3:1.
 *
 * ── Why it is a palette-level rule, not a per-colour one ─────────────────────
 * Applying even the 3:1 gate to every colour rejects the reference robot, which
 * demonstrably works on both white and near-black pages: four of its seven
 * stops fail individually (its highlight #C3CDFB scores 1.56 worst-case).
 *
 * It works because contrast comes from the SILHOUETTE spanning the grounds, not
 * from each stop surviving alone — the dark stops hold the outline against a
 * white page, the light stops hold it against a dark one, and the shell
 * gradient runs between them so some part of every shape always separates from
 * whatever is behind it.
 *
 * So the gate is: the palette must STRADDLE the band, plus a few internal
 * legibility checks. Thresholds are calibrated against the reference robot —
 * the one design known to work — with headroom, rather than picked by feel.
 */

/** WCAG 1.4.11 non-text contrast. The pet is a graphic. */
const GROUND = 3;
/** Eyes on the visor. Reference scores 8.06; this is a floor, not a target. */
const EYES_ON_VISOR = 4.5;
/** Visor panel against the head shell. Reference's tightest pair scores 3.82. */
const VISOR_ON_SHELL = 3;
/** The shell gradient must be perceptible. Reference scores 2.60. */
const SHELL_GRADIENT = 1.3;

export interface PaletteIssue {
  rule: string;
  got: number;
  need: number;
  /** Which stops to nudge. Fed back to the model on a re-roll. */
  fix: string;
}

export interface PaletteVerdict {
  ok: boolean;
  issues: PaletteIssue[];
}

/**
 * Check a palette. Returns every failure rather than the first, so a re-roll
 * prompt can name all of them in one pass instead of ping-ponging.
 */
export function validatePetPalette(p: PetPalette): PaletteVerdict {
  const stops = Object.values(p);
  const darkest = stops.reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
  const lightest = stops.reduce((a, b) => (luminance(b) > luminance(a) ? b : a));

  const checks: PaletteIssue[] = [
    {
      rule: "darkest stop must hold the silhouette on a white page",
      got: contrast(darkest, WHITE),
      need: GROUND,
      fix: "darken shellLo, plateLo or visorLo",
    },
    {
      rule: "lightest stop must hold the silhouette on a dark page",
      got: contrast(lightest, NEAR_BLACK),
      need: GROUND,
      fix: "lighten shellHi or lit",
    },
    {
      rule: "lit must read against visorHi (the eyes are the face)",
      got: contrast(p.lit, p.visorHi),
      need: EYES_ON_VISOR,
      fix: "brighten lit or darken visorHi",
    },
    {
      rule: "visorHi must read as a panel against shellHi",
      got: contrast(p.visorHi, p.shellHi),
      need: VISOR_ON_SHELL,
      fix: "darken visorHi or lighten shellHi",
    },
    {
      rule: "shell gradient must be perceptible",
      got: contrast(p.shellHi, p.shellLo),
      need: SHELL_GRADIENT,
      fix: "widen the gap between shellHi and shellLo",
    },
  ];

  const issues = checks.filter((c) => c.got < c.need);
  return { ok: issues.length === 0, issues };
}

/** One-line-per-issue text, suitable for appending to a re-roll prompt. */
export function describePaletteIssues(issues: readonly PaletteIssue[]): string {
  return issues
    .map((i) => `- ${i.rule}: got ${i.got.toFixed(2)}:1, need ${i.need}:1 — ${i.fix}`)
    .join("\n");
}
