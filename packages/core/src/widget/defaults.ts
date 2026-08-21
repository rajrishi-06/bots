import type { Action, Appearance } from "./config.js";

// Re-exported as TYPES so consumers on a bundle budget can take the whole
// surface from this module. Type imports erase, so this costs nothing at runtime
// even though config.ts imports zod.
export type { Action, Appearance } from "./config.js";

/**
 * Zod-free normalisation, for the widget.
 *
 * The schemas in ./config.ts are the authority and the API validates with them.
 * The widget only needs to survive a config that predates a field — and pulling
 * zod in for that cost 20 kB gzip against a 30 kB budget, which is most of the
 * budget spent re-checking something already checked upstream.
 *
 * This is defence in depth at the last line, not the only line.
 */

export const FALLBACK_APPEARANCE: Appearance = {
  accent: "pet",
  corner: "soft",
  density: "comfortable",
  bubbles: "bordered",
  header: "branded",
  position: "auto",
  launcherSize: 64,
  feedback: true,
};

const CORNERS = new Set(["square", "soft", "round"]);
const DENSITIES = new Set(["comfortable", "compact"]);
const BUBBLES = new Set(["bordered", "filled", "minimal"]);
const HEADERS = new Set(["traffic", "minimal", "branded"]);
const POSITIONS = new Set(["auto", "bottom-right", "bottom-left"]);

const pick = <T extends string>(v: unknown, allowed: Set<string>, fallback: T): T =>
  typeof v === "string" && allowed.has(v) ? (v as T) : fallback;

export function normalizeAppearance(raw: unknown): Appearance {
  const a = (raw ?? {}) as Record<string, unknown>;
  const size = Number(a.launcherSize);
  return {
    accent:
      typeof a.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(a.accent)
        ? a.accent
        : "pet",
    corner: pick(a.corner, CORNERS, FALLBACK_APPEARANCE.corner),
    density: pick(a.density, DENSITIES, FALLBACK_APPEARANCE.density),
    bubbles: pick(a.bubbles, BUBBLES, FALLBACK_APPEARANCE.bubbles),
    header: pick(a.header, HEADERS, FALLBACK_APPEARANCE.header),
    position: pick(a.position, POSITIONS, FALLBACK_APPEARANCE.position),
    launcherSize: Number.isFinite(size) && size >= 44 && size <= 96 ? Math.round(size) : 64,
    feedback: a.feedback !== false,
  };
}

/** https only — see the note in config.ts. Anything else is dropped. */
function httpsOnly(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Action => {
      if (!a || typeof a !== "object") return false;
      const x = a as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.label !== "string") return false;
      if (x.kind !== "link" && x.kind !== "prompt") return false;
      if (typeof x.value !== "string" || !x.value) return false;
      return x.kind === "prompt" || httpsOnly(x.value);
    })
    .slice(0, 4);
}
