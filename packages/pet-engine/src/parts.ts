import type { PetParts } from "@bots/core/pet";

/**
 * The vetted parts library.
 *
 * Every entry is static geometry authored to the fixed pivots in `pivots.ts`.
 * The ONLY interpolated values are palette colours, and those are `#RRGGBB`
 * guaranteed by the Zod schema — the model never contributes markup, which is
 * what makes rendering into a customer's page safe.
 *
 * Gradient references are namespaced per instance (`${uid}-shell`) because a
 * gallery renders a dozen live pets on one page and SVG gradient ids are
 * document-global. Without the namespace, twelve pets collide and every one
 * after the first paints with the first one's colours.
 */

export interface PartContext {
  /** Instance id, already sanitised to [A-Za-z0-9]. */
  uid: string;
  /** `url(#uid-name)` for a namespaced gradient. */
  g: (name: string) => string;
  lit: string;
  plateLo: string;
  visorLo: string;
}

type Part = (c: PartContext) => string;

/* ── Crown: sits ABOVE the crown pivot (36,12), so it rotates negative ─────── */

const crown: Record<PetParts["crown"], Part> = {
  antenna: (c) => `
    <path d="M36 13V6.6" stroke="${c.plateLo}" stroke-width="2.4" stroke-linecap="round"/>
    <circle class="pet-glow" cx="36" cy="4.6" r="7" fill="${c.g("lit")}" opacity="0.5"/>
    <circle cx="36" cy="4.6" r="3.1" fill="${c.g("bulb")}"/>
    <circle cx="34.9" cy="3.5" r="1" fill="#FFF" opacity="0.8"/>`,
  ears: (c) => `
    <path d="M20 16 L17 4 L29 10 Z" fill="${c.g("shell")}"/>
    <path d="M52 16 L55 4 L43 10 Z" fill="${c.g("shell")}"/>
    <path d="M21.5 14.5 L20 7.5 L26.5 11 Z" fill="${c.plateLo}" opacity="0.55"/>
    <path d="M50.5 14.5 L52 7.5 L45.5 11 Z" fill="${c.plateLo}" opacity="0.55"/>`,
  horn: (c) => `
    <path d="M36 13 C33.5 8 34 3 36 0.5 C38 3 38.5 8 36 13 Z" fill="${c.g("plate")}"/>
    <circle class="pet-glow" cx="36" cy="2.5" r="4.5" fill="${c.g("lit")}" opacity="0.35"/>`,
  fin: (c) => `
    <path d="M27 15 C29 6 33 2 36 1 C39 2 43 6 45 15 Z" fill="${c.g("shell")}"/>
    <path d="M36 14 V3" stroke="${c.plateLo}" stroke-width="1.3" opacity="0.6"/>
    <path d="M31.5 14.5 C32.5 8.5 34 5 36 3" stroke="${c.plateLo}" stroke-width="1" fill="none" opacity="0.45"/>
    <path d="M40.5 14.5 C39.5 8.5 38 5 36 3" stroke="${c.plateLo}" stroke-width="1" fill="none" opacity="0.45"/>`,
  none: () => "",
};

/* ── Head: pivots at the neck (36,41) ─────────────────────────────────────── */

const head: Record<PetParts["head"], Part> = {
  round: (c) => `
    <rect x="10" y="11" width="52" height="31" rx="12.5" fill="${c.g("shell")}"/>
    <rect x="11.6" y="12.5" width="48.8" height="28" rx="11" fill="none" stroke="#FFF" stroke-opacity="0.24" stroke-width="1.2"/>`,
  boxy: (c) => `
    <rect x="11" y="11" width="50" height="31" rx="4" fill="${c.g("shell")}"/>
    <rect x="12.6" y="12.5" width="46.8" height="28" rx="3" fill="none" stroke="#FFF" stroke-opacity="0.24" stroke-width="1.2"/>`,
  blob: (c) => `
    <path d="M36 10 C50 10 63 17 63 27 C63 37 50 43 36 43 C22 43 9 37 9 27 C9 17 22 10 36 10 Z" fill="${c.g("shell")}"/>
    <path d="M36 12 C48.5 12 60.5 18 60.5 27 C60.5 36 48.5 41 36 41" fill="none" stroke="#FFF" stroke-opacity="0.22" stroke-width="1.2"/>`,
  cat: (c) => `
    <path d="M36 11 C49 11 61 17.5 61 27 C61 36.5 49 42.5 36 42.5 C23 42.5 11 36.5 11 27 C11 17.5 23 11 36 11 Z" fill="${c.g("shell")}"/>
    <path d="M18 13.5 L15.5 4.5 L26 9.5 Z" fill="${c.g("shell")}"/>
    <path d="M54 13.5 L56.5 4.5 L46 9.5 Z" fill="${c.g("shell")}"/>
    <path d="M19.2 12.4 L17.8 7.4 L23.6 10.2 Z" fill="${c.plateLo}" opacity="0.5"/>
    <path d="M52.8 12.4 L54.2 7.4 L48.4 10.2 Z" fill="${c.plateLo}" opacity="0.5"/>`,
};

/* ── Face: sits inside the head, so it moves with it ──────────────────────── */

const face: Record<PetParts["face"], Part> = {
  visor: (c) => `
    <rect x="16" y="16.4" width="40" height="20.6" rx="9" fill="${c.g("visor")}"/>
    <path d="M14 34 L27 15 L34 15 L21 39 Z" fill="#FFF" opacity="0.055"/>`,
  eyes: (c) => `
    <ellipse cx="27.6" cy="26.6" rx="8" ry="8.6" fill="${c.g("visor")}"/>
    <ellipse cx="44.4" cy="26.6" rx="8" ry="8.6" fill="${c.g("visor")}"/>`,
  goggles: (c) => `
    <rect x="12" y="23.5" width="48" height="4" rx="2" fill="${c.plateLo}"/>
    <circle cx="27.6" cy="26.6" r="9.4" fill="${c.g("visor")}"/>
    <circle cx="44.4" cy="26.6" r="9.4" fill="${c.g("visor")}"/>
    <circle cx="27.6" cy="26.6" r="9.4" fill="none" stroke="${c.plateLo}" stroke-width="1.8"/>
    <circle cx="44.4" cy="26.6" r="9.4" fill="none" stroke="${c.plateLo}" stroke-width="1.8"/>`,
};

/* ── Torso: pivots at the hips (36,43) ────────────────────────────────────── */

const torso: Record<PetParts["torso"], Part> = {
  capsule: (c) => `
    <rect x="31" y="39" width="10" height="6" rx="2.4" fill="${c.plateLo}"/>
    <rect x="18" y="43" width="36" height="22" rx="9.5" fill="${c.g("shell")}"/>
    <rect x="19.5" y="44.4" width="33" height="19.2" rx="8.4" fill="none" stroke="#FFF" stroke-opacity="0.22" stroke-width="1.1"/>`,
  boxy: (c) => `
    <rect x="31" y="39" width="10" height="6" rx="2.4" fill="${c.plateLo}"/>
    <rect x="19" y="43" width="34" height="22" rx="3.5" fill="${c.g("shell")}"/>
    <rect x="20.5" y="44.4" width="31" height="19.2" rx="2.6" fill="none" stroke="#FFF" stroke-opacity="0.22" stroke-width="1.1"/>`,
  egg: (c) => `
    <rect x="31" y="39" width="10" height="6" rx="2.4" fill="${c.plateLo}"/>
    <ellipse cx="36" cy="54.5" rx="18.5" ry="11.8" fill="${c.g("shell")}"/>
    <ellipse cx="36" cy="54.5" rx="16.6" ry="10.1" fill="none" stroke="#FFF" stroke-opacity="0.22" stroke-width="1.1"/>`,
};

/** The chest panel — the terminal, relocated. Drawn over whichever torso. */
export const chestPanel = (c: PartContext): string => `
  <rect x="25.5" y="48" width="21" height="11.4" rx="3.8" fill="${c.g("visor")}"/>
  <path d="M30 51.2 L33 53.7 L30 56.2" stroke="${c.lit}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <rect class="pet-cursor" x="35" y="54.6" width="6" height="1.8" rx="0.9" fill="${c.lit}"/>`;

/* ── Arms: pivot at the shoulders (17.5,48) and (54.5,48) ─────────────────── */

const armGeometry: Record<PetParts["arms"], { left: Part; right: Part }> = {
  stub: {
    left: (c) => `<rect x="14.4" y="45.5" width="6.2" height="13.5" rx="3.1" fill="${c.g("plate")}"/>`,
    right: (c) => `<rect x="51.4" y="45.5" width="6.2" height="13.5" rx="3.1" fill="${c.g("plate")}"/>`,
  },
  noodle: {
    left: (c) => `<path d="M17.5 46 C13 50 12.5 55 15 60" stroke="${c.g("plate")}" stroke-width="4.4" stroke-linecap="round" fill="none"/>`,
    right: (c) => `<path d="M54.5 46 C59 50 59.5 55 57 60" stroke="${c.g("plate")}" stroke-width="4.4" stroke-linecap="round" fill="none"/>`,
  },
  none: { left: () => "", right: () => "" },
};

/* ── Feet: pivot at (36,60) ───────────────────────────────────────────────── */

const feet: Record<PetParts["feet"], Part> = {
  pads: (c) => `
    <rect x="22" y="61" width="11.5" height="8" rx="3.4" fill="${c.g("plate")}"/>
    <rect x="38.5" y="61" width="11.5" height="8" rx="3.4" fill="${c.g("plate")}"/>`,
  paws: (c) => `
    <ellipse cx="27.5" cy="65" rx="6.4" ry="4.6" fill="${c.g("plate")}"/>
    <ellipse cx="44.5" cy="65" rx="6.4" ry="4.6" fill="${c.g("plate")}"/>
    <circle cx="24.6" cy="63.2" r="1.25" fill="${c.visorLo}" opacity="0.42"/>
    <circle cx="27.5" cy="62.4" r="1.25" fill="${c.visorLo}" opacity="0.42"/>
    <circle cx="30.4" cy="63.2" r="1.25" fill="${c.visorLo}" opacity="0.42"/>
    <circle cx="41.6" cy="63.2" r="1.25" fill="${c.visorLo}" opacity="0.42"/>
    <circle cx="44.5" cy="62.4" r="1.25" fill="${c.visorLo}" opacity="0.42"/>
    <circle cx="47.4" cy="63.2" r="1.25" fill="${c.visorLo}" opacity="0.42"/>`,
  none: () => "",
};

/** Ear plates flanking the head. Skipped when the crown already occupies the
 *  silhouette's sides, so a cat does not grow a second pair of ears. */
export const headSidePlates = (c: PartContext, parts: PetParts): string =>
  parts.crown === "ears" || parts.head === "cat"
    ? ""
    : `
      <rect x="5" y="25.5" width="6" height="11" rx="3" fill="${c.g("plate")}"/>
      <rect x="61" y="25.5" width="6" height="11" rx="3" fill="${c.g("plate")}"/>
      <circle cx="8" cy="31" r="1.1" fill="${c.lit}" opacity="0.75"/>
      <circle cx="64" cy="31" r="1.1" fill="${c.lit}" opacity="0.75"/>`;

export const PARTS = { crown, head, face, torso, arms: armGeometry, feet } as const;

/**
 * The eyes, drawn three ways and cross-faded rather than morphed — cheaper and
 * steadier than animating a path, and it lets a 70ms blink coexist with a 200ms
 * smile without the two fighting over the same geometry.
 */
export const eye = (c: PartContext, cx: number): string => `
  <g class="pet-eye" data-cx="${cx}">
    <circle cx="${cx}" cy="26.6" r="5.6" fill="${c.g("lit")}" opacity="0.5"/>
    <rect class="pet-eye-open" x="${cx - 2.6}" y="22.2" width="5.2" height="8.8" rx="2.6" fill="${c.lit}"/>
    <rect class="pet-eye-closed" x="${cx - 2.9}" y="25.8" width="5.8" height="1.7" rx="0.85" fill="${c.lit}" opacity="0"/>
    <path class="pet-eye-arc" d="M${cx - 3.1} 24.9 q3.1 4 6.2 0" stroke="${c.lit}" stroke-width="1.9" stroke-linecap="round" fill="none" opacity="0"/>
  </g>`;
