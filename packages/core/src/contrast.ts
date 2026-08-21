/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Two callers, and they are the reason this is shipping code rather than a
 * one-off script:
 *
 *   1. The design palette in DESIGN.md is measured with it, not eyeballed.
 *   2. Every AI-generated `PetSpec` palette is validated with it before the pet
 *      is saved. A pet is embedded on a stranger's page over an unknown
 *      background, so "invisible on dark sites" is a bug the schema must catch
 *      at generation time — see `validatePetPalette` in ./pet/palette.ts.
 */

/** Grounds every embeddable palette must survive. Not configurable on purpose:
 *  these are the two extremes a host page can put behind the widget. */
export const WHITE = "#FFFFFF";
export const NEAR_BLACK = "#0B0B0C";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb` (case-insensitive). Throws on anything else — a
 *  malformed colour must fail loudly rather than silently score as black. */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${JSON.stringify(hex)}`);
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** True if the string is a colour `parseHex` accepts. */
export function isHex(hex: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 … 21. Order-independent. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Worst-case contrast of `color` against every ground it may land on. */
export function worstContrast(color: string, grounds: readonly string[]): number {
  return grounds.reduce((min, g) => Math.min(min, contrast(color, g)), Infinity);
}
