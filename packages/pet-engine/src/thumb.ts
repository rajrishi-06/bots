import type { PetPalette, Theme } from "@bots/core/pet";
import { PARTS, partFor, type PartContext } from "./parts.js";
import type { PetSlot } from "./pivots.js";

/**
 * Render ONE part as a standalone thumbnail.
 *
 * The editor's option pickers show the actual geometry rather than the word
 * "boxy", which is the difference between choosing a shape and guessing at a
 * label. This lives in the engine rather than the dashboard because it needs
 * the parts library and the gradient conventions, and duplicating either into
 * the UI is how the two drift.
 */

/**
 * Tight crops per slot, in the rig's 72×72 space.
 *
 * A part is authored where it belongs on the body, so rendering the crown at
 * full viewBox is a speck at the top of an empty square. These frame each slot
 * around where its geometry actually sits.
 */
const CROP: Record<PetSlot, string> = {
  crown: "8 0 56 26",
  head: "2 6 68 40",
  face: "10 12 52 30",
  torso: "14 36 44 32",
  arms: "6 42 60 26",
  feet: "16 56 40 18",
};

export function partThumbSvg(
  theme: Theme,
  slot: PetSlot,
  option: string,
  palette: PetPalette,
  uid = `t${Math.random().toString(36).slice(2, 9)}`,
): string {
  const c: PartContext = {
    uid,
    g: (name) => `url(#${uid}-${name})`,
    lit: palette.lit,
    plateLo: palette.plateLo,
    visorHi: palette.visorHi,
    visorLo: palette.visorLo,
  };

  // Arms are one slot drawn in two places; a thumbnail shows both so "noodle"
  // reads as a pair rather than a single stroke of unclear origin.
  const body =
    slot === "arms"
      ? PARTS.arms[option as keyof typeof PARTS.arms]?.left(c) +
        (PARTS.arms[option as keyof typeof PARTS.arms]?.right(c) ?? "")
      : partFor(theme, slot as Exclude<PetSlot, "arms">, option)(c);

  return `<svg viewBox="${CROP[slot]}" fill="none" aria-hidden="true" style="overflow:visible">
    <defs>
      <linearGradient id="${uid}-shell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.shellHi}"/><stop offset="1" stop-color="${palette.shellLo}"/>
      </linearGradient>
      <linearGradient id="${uid}-plate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.plateHi}"/><stop offset="1" stop-color="${palette.plateLo}"/>
      </linearGradient>
      <linearGradient id="${uid}-visor" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="${palette.visorHi}"/><stop offset="1" stop-color="${palette.visorLo}"/>
      </linearGradient>
      <radialGradient id="${uid}-lit">
        <stop offset="0" stop-color="${palette.lit}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${palette.lit}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${uid}-bulb">
        <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="${palette.lit}"/>
        <stop offset="1" stop-color="${palette.plateLo}"/>
      </radialGradient>
    </defs>
    ${body}
  </svg>`;
}
