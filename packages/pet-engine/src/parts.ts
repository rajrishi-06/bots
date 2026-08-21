import type { PetParts, Theme } from "@bots/core/pet";

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
  visorHi: string;
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

/**
 * Compatibility rules between slots.
 *
 * The parts library is a flat set of independent choices, which is what keeps
 * it cheap to extend — but a few combinations are geometrically wrong rather
 * than merely ugly, and the model is free to pick them. Resolving here means
 * the rule lives in ONE place instead of inside each part function, and the
 * stored spec keeps the user's actual choice.
 */
export function resolveParts(parts: PetParts): PetParts {
  // The cat head draws its own ears. An `ears` crown on top of it renders FOUR.
  if (parts.head === "cat" && parts.crown === "ears") return { ...parts, crown: "none" };
  return parts;
}

/**
 * Ear plates flanking the head.
 *
 * Machine furniture, so only the machine themes get them — a wisp of a ghost
 * with bolted-on ear nubs reads as a rendering bug, not a design. Also skipped
 * when the crown or head already occupies the silhouette's sides, so a cat does
 * not grow a second pair of ears.
 */
export const headSidePlates = (c: PartContext, parts: PetParts, theme: Theme): string =>
  theme !== "robot" && theme !== "mech"
    ? ""
    : parts.crown === "ears" || parts.head === "cat"
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


/* ── Themes ────────────────────────────────────────────────────────────────
   A theme overrides only the parts that define its silhouette and inherits the
   rest from the robot set. That is what keeps a sixth theme cheap rather than a
   combinatorial rewrite — and every shape is still authored to the same fixed
   pivots, so switching theme remains a hot-swap. */

type SlotOverrides = {
  head?: Partial<Record<PetParts["head"], Part>>;
  torso?: Partial<Record<PetParts["torso"], Part>>;
  face?: Partial<Record<PetParts["face"], Part>>;
  feet?: Partial<Record<PetParts["feet"], Part>>;
  crown?: Partial<Record<PetParts["crown"], Part>>;
  /** Drawn over the torso. `null` removes the robot's terminal panel. */
  chest?: Part | null;
};

/** Blocky and stepped. Nothing curves; radii are 0 and edges are quantised. */
const pixel: SlotOverrides = {
  head: {
    round: (c) => `
      <rect x="12" y="12" width="48" height="28" fill="${c.g("shell")}"/>
      <rect x="8" y="16" width="4" height="20" fill="${c.g("shell")}"/>
      <rect x="60" y="16" width="4" height="20" fill="${c.g("shell")}"/>
      <rect x="12" y="12" width="48" height="4" fill="#FFF" fill-opacity="0.18"/>`,
    boxy: (c) => `
      <rect x="10" y="11" width="52" height="30" fill="${c.g("shell")}"/>
      <rect x="10" y="11" width="52" height="4" fill="#FFF" fill-opacity="0.18"/>`,
    blob: (c) => `
      <rect x="14" y="10" width="44" height="32" fill="${c.g("shell")}"/>
      <rect x="10" y="14" width="4" height="24" fill="${c.g("shell")}"/>
      <rect x="58" y="14" width="4" height="24" fill="${c.g("shell")}"/>`,
    cat: (c) => `
      <rect x="12" y="14" width="48" height="27" fill="${c.g("shell")}"/>
      <rect x="14" y="6" width="8" height="8" fill="${c.g("shell")}"/>
      <rect x="50" y="6" width="8" height="8" fill="${c.g("shell")}"/>
      <rect x="16" y="9" width="4" height="4" fill="${c.plateLo}"/>
      <rect x="52" y="9" width="4" height="4" fill="${c.plateLo}"/>`,
  },
  torso: {
    capsule: (c) => `
      <rect x="32" y="39" width="8" height="6" fill="${c.plateLo}"/>
      <rect x="19" y="43" width="34" height="22" fill="${c.g("shell")}"/>
      <rect x="19" y="43" width="34" height="3" fill="#FFF" fill-opacity="0.16"/>`,
    boxy: (c) => `
      <rect x="32" y="39" width="8" height="6" fill="${c.plateLo}"/>
      <rect x="18" y="43" width="36" height="22" fill="${c.g("shell")}"/>`,
    egg: (c) => `
      <rect x="32" y="39" width="8" height="6" fill="${c.plateLo}"/>
      <rect x="21" y="43" width="30" height="22" fill="${c.g("shell")}"/>
      <rect x="18" y="47" width="3" height="14" fill="${c.g("shell")}"/>
      <rect x="51" y="47" width="3" height="14" fill="${c.g("shell")}"/>`,
  },
  face: {
    visor: (c) => `<rect x="17" y="18" width="38" height="17" fill="${c.g("visor")}"/>`,
    eyes: (c) => `
      <rect x="21" y="20" width="13" height="13" fill="${c.g("visor")}"/>
      <rect x="38" y="20" width="13" height="13" fill="${c.g("visor")}"/>`,
    goggles: (c) => `
      <rect x="13" y="24" width="46" height="4" fill="${c.plateLo}"/>
      <rect x="19" y="18" width="17" height="17" fill="${c.g("visor")}"/>
      <rect x="36" y="18" width="17" height="17" fill="${c.g("visor")}"/>`,
  },
  feet: {
    pads: (c) => `
      <rect x="22" y="61" width="11" height="7" fill="${c.g("plate")}"/>
      <rect x="39" y="61" width="11" height="7" fill="${c.g("plate")}"/>`,
    paws: (c) => `
      <rect x="21" y="61" width="12" height="7" fill="${c.g("plate")}"/>
      <rect x="39" y="61" width="12" height="7" fill="${c.g("plate")}"/>
      <rect x="23" y="63" width="2" height="2" fill="${c.visorLo}" fill-opacity="0.45"/>
      <rect x="27" y="63" width="2" height="2" fill="${c.visorLo}" fill-opacity="0.45"/>
      <rect x="41" y="63" width="2" height="2" fill="${c.visorLo}" fill-opacity="0.45"/>
      <rect x="45" y="63" width="2" height="2" fill="${c.visorLo}" fill-opacity="0.45"/>`,
  },
  crown: {
    antenna: (c) => `
      <rect x="34.5" y="4" width="3" height="9" fill="${c.plateLo}"/>
      <rect class="pet-glow" x="31" y="0" width="10" height="6" fill="${c.g("lit")}" opacity="0.5"/>
      <rect x="33" y="1" width="6" height="4" fill="${c.lit}"/>`,
    horn: (c) => `<rect x="33" y="4" width="6" height="9" fill="${c.g("plate")}"/>
      <rect x="34.5" y="1" width="3" height="3" fill="${c.lit}"/>`,
    ears: (c) => `
      <rect x="17" y="5" width="9" height="9" fill="${c.g("shell")}"/>
      <rect x="46" y="5" width="9" height="9" fill="${c.g("shell")}"/>`,
    fin: (c) => `
      <rect x="33" y="2" width="6" height="12" fill="${c.g("shell")}"/>
      <rect x="28" y="7" width="5" height="7" fill="${c.g("shell")}"/>
      <rect x="39" y="7" width="5" height="7" fill="${c.g("shell")}"/>`,
  },
  chest: (c) => `
    <rect x="26" y="49" width="20" height="10" fill="${c.g("visor")}"/>
    <rect x="29" y="52" width="3" height="3" fill="${c.lit}"/>
    <rect class="pet-cursor" x="35" y="55" width="6" height="2" fill="${c.lit}"/>`,
};

/** Soft and organic. Snouts, ear tufts, rounded haunches, no panels. */
const animal: SlotOverrides = {
  head: {
    round: (c) => `
      <ellipse cx="36" cy="27" rx="24" ry="16" fill="${c.g("shell")}"/>
      <ellipse cx="36" cy="33" rx="11" ry="7" fill="${c.g("plate")}" opacity="0.75"/>
      <ellipse cx="36" cy="30.5" rx="3" ry="2.2" fill="${c.visorHi}"/>`,
    boxy: (c) => `
      <path d="M14 20 Q14 11 36 11 Q58 11 58 20 L58 33 Q58 42 36 42 Q14 42 14 33 Z" fill="${c.g("shell")}"/>
      <ellipse cx="36" cy="34" rx="10" ry="6" fill="${c.g("plate")}" opacity="0.7"/>`,
    blob: (c) => `
      <ellipse cx="36" cy="26.5" rx="25" ry="16.5" fill="${c.g("shell")}"/>
      <ellipse cx="36" cy="34" rx="12" ry="7.5" fill="${c.g("plate")}" opacity="0.7"/>
      <ellipse cx="36" cy="31" rx="3.4" ry="2.4" fill="${c.visorHi}"/>`,
    cat: (c) => `
      <ellipse cx="36" cy="27" rx="24" ry="16" fill="${c.g("shell")}"/>
      <path d="M17 14 Q15 4 25 8 Q29 10 30 13 Z" fill="${c.g("shell")}"/>
      <path d="M55 14 Q57 4 47 8 Q43 10 42 13 Z" fill="${c.g("shell")}"/>
      <path d="M19 13 Q18 7 24 10 Z" fill="${c.plateLo}" opacity="0.5"/>
      <path d="M53 13 Q54 7 48 10 Z" fill="${c.plateLo}" opacity="0.5"/>
      <ellipse cx="36" cy="32" rx="3.2" ry="2.3" fill="${c.visorHi}"/>`,
  },
  torso: {
    capsule: (c) => `
      <ellipse cx="36" cy="53.5" rx="19" ry="12" fill="${c.g("shell")}"/>
      <ellipse cx="36" cy="56" rx="11" ry="7" fill="${c.g("plate")}" opacity="0.5"/>`,
    boxy: (c) => `
      <path d="M18 46 Q18 42 36 42 Q54 42 54 46 L54 60 Q54 65 36 65 Q18 65 18 60 Z" fill="${c.g("shell")}"/>`,
    egg: (c) => `
      <ellipse cx="36" cy="54" rx="18" ry="12.5" fill="${c.g("shell")}"/>
      <ellipse cx="36" cy="57" rx="10" ry="6.5" fill="${c.g("plate")}" opacity="0.5"/>`,
  },
  face: {
    visor: (c) => `
      <ellipse cx="27.6" cy="25" rx="6.5" ry="7" fill="${c.g("visor")}"/>
      <ellipse cx="44.4" cy="25" rx="6.5" ry="7" fill="${c.g("visor")}"/>`,
    eyes: (c) => `
      <ellipse cx="27.6" cy="25" rx="7" ry="7.5" fill="${c.g("visor")}"/>
      <ellipse cx="44.4" cy="25" rx="7" ry="7.5" fill="${c.g("visor")}"/>`,
    goggles: (c) => `
      <path d="M12 24 Q36 20 60 24" stroke="${c.plateLo}" stroke-width="3.5" fill="none"/>
      <ellipse cx="27.6" cy="25.5" rx="8.5" ry="8" fill="${c.g("visor")}"/>
      <ellipse cx="44.4" cy="25.5" rx="8.5" ry="8" fill="${c.g("visor")}"/>`,
  },
  feet: {
    pads: (c) => `
      <ellipse cx="27" cy="65" rx="7.5" ry="4.5" fill="${c.g("plate")}"/>
      <ellipse cx="45" cy="65" rx="7.5" ry="4.5" fill="${c.g("plate")}"/>`,
  },
  chest: null,
};

/** No feet, a tapered wispy hem, translucent shell. */
const ghost: SlotOverrides = {
  head: {
    round: (c) => `<path d="M36 9 C51 9 61 19 61 31 L61 40 Q57 34 53 40 Q49 34 45 40 Q41 34 36 40 Q31 34 27 40 Q23 34 19 40 Q15 34 11 40 L11 31 C11 19 21 9 36 9 Z" fill="${c.g("shell")}" opacity="0.92"/>`,
    boxy: (c) => `<path d="M12 12 H60 V40 Q56 34 52 40 Q48 34 44 40 Q40 34 36 40 Q32 34 28 40 Q24 34 20 40 Q16 34 12 40 Z" fill="${c.g("shell")}" opacity="0.92"/>`,
    blob: (c) => `<path d="M36 8 C53 8 63 20 63 32 L63 41 Q58 35 53 41 Q48 35 43 41 Q39 35 36 41 Q33 35 29 41 Q24 35 19 41 Q14 35 9 41 L9 32 C9 20 19 8 36 8 Z" fill="${c.g("shell")}" opacity="0.92"/>`,
    cat: (c) => `<path d="M20 13 Q17 4 27 9 M52 13 Q55 4 45 9" stroke="${c.g("shell")}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M36 10 C51 10 60 20 60 31 L60 40 Q55 34 50 40 Q45 34 40 40 Q36 34 32 40 Q27 34 22 40 Q17 34 12 40 L12 31 C12 20 21 10 36 10 Z" fill="${c.g("shell")}" opacity="0.92"/>`,
  },
  torso: {
    capsule: (c) => `<path d="M20 44 Q20 42 36 42 Q52 42 52 44 L52 62 Q48 56 44 62 Q40 56 36 62 Q32 56 28 62 Q24 56 20 62 Z" fill="${c.g("shell")}" opacity="0.85"/>`,
    boxy: (c) => `<path d="M19 43 H53 V62 Q49 56 45 62 Q41 56 36 62 Q31 56 27 62 Q23 56 19 62 Z" fill="${c.g("shell")}" opacity="0.85"/>`,
    egg: (c) => `<path d="M36 42 Q53 42 53 54 L53 62 Q48 56 44 62 Q40 56 36 62 Q32 56 28 62 Q23 56 19 62 L19 54 Q19 42 36 42 Z" fill="${c.g("shell")}" opacity="0.85"/>`,
  },
  feet: { pads: () => "", paws: () => "", none: () => "" },
  chest: null,
};

/** Angular, armoured, hard bevels and a jaw plate. */
const mech: SlotOverrides = {
  head: {
    round: (c) => `
      <path d="M14 16 L20 11 H52 L58 16 V33 L52 40 H20 L14 33 Z" fill="${c.g("shell")}"/>
      <path d="M14 16 L20 11 H52 L58 16 Z" fill="#FFF" fill-opacity="0.14"/>
      <path d="M24 40 H48 L44 44 H28 Z" fill="${c.g("plate")}"/>`,
    boxy: (c) => `
      <path d="M11 12 H61 V36 L55 41 H17 L11 36 Z" fill="${c.g("shell")}"/>
      <rect x="11" y="12" width="50" height="3.5" fill="#FFF" fill-opacity="0.14"/>`,
    blob: (c) => `
      <path d="M12 22 L22 10 H50 L60 22 V32 L50 42 H22 L12 32 Z" fill="${c.g("shell")}"/>`,
    cat: (c) => `
      <path d="M14 16 L20 11 H52 L58 16 V33 L52 40 H20 L14 33 Z" fill="${c.g("shell")}"/>
      <path d="M16 12 L14 3 L26 9 Z" fill="${c.g("plate")}"/>
      <path d="M56 12 L58 3 L46 9 Z" fill="${c.g("plate")}"/>`,
  },
  torso: {
    capsule: (c) => `
      <rect x="31" y="38" width="10" height="7" fill="${c.plateLo}"/>
      <path d="M18 46 L23 43 H49 L54 46 V60 L48 65 H24 L18 60 Z" fill="${c.g("shell")}"/>
      <path d="M18 46 L23 43 H49 L54 46 Z" fill="#FFF" fill-opacity="0.14"/>`,
    boxy: (c) => `
      <rect x="31" y="38" width="10" height="7" fill="${c.plateLo}"/>
      <path d="M18 43 H54 V61 L49 65 H23 L18 61 Z" fill="${c.g("shell")}"/>`,
    egg: (c) => `
      <rect x="31" y="38" width="10" height="7" fill="${c.plateLo}"/>
      <path d="M20 48 L27 43 H45 L52 48 V59 L45 65 H27 L20 59 Z" fill="${c.g("shell")}"/>`,
  },
  face: {
    visor: (c) => `
      <path d="M16 19 L20 16 H52 L56 19 V33 L52 36 H20 L16 33 Z" fill="${c.g("visor")}"/>
      <path d="M16 32 L56 20 V23 L16 35 Z" fill="#FFF" opacity="0.06"/>`,
  },
  feet: {
    pads: (c) => `
      <path d="M21 61 H34 L32 69 H23 Z" fill="${c.g("plate")}"/>
      <path d="M38 61 H51 L49 69 H40 Z" fill="${c.g("plate")}"/>`,
  },
};

const THEME_OVERRIDES: Record<Theme, SlotOverrides> = {
  robot: {},
  pixel,
  animal,
  ghost,
  mech,
};

/** Resolve a slot's geometry for a theme, falling back to the robot library. */
export function partFor<S extends keyof typeof PARTS>(
  theme: Theme,
  slot: S,
  option: string,
): Part {
  const override = (THEME_OVERRIDES[theme] as Record<string, Record<string, Part> | undefined>)[slot];
  return (
    override?.[option] ??
    ((PARTS[slot] as unknown as Record<string, Part>)[option] ?? (() => ""))
  );
}

/** The chest panel for a theme. `null` means the theme has no chest furniture —
 *  a terminal readout on an animal's belly reads as a mistake, not a feature. */
export function chestFor(theme: Theme): Part | null {
  const o = THEME_OVERRIDES[theme];
  return o.chest === undefined ? chestPanel : o.chest;
}
