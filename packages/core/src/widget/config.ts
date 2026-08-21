import { z } from "zod";

/**
 * What a bot owner can change about the widget itself.
 *
 * Two separate things live here and they are deliberately different in kind:
 * APPEARANCE is a closed set of choices, and ACTIONS are content.
 *
 * Appearance is enumerated rather than free-form CSS on purpose. Letting an
 * owner ship arbitrary CSS into a shadow root they do not control is a support
 * burden at best and a defacement vector at worst, and the interesting variation
 * is between a handful of coherent looks rather than in one-off overrides.
 */

export const CORNERS = ["square", "soft", "round"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const BUBBLES = ["bordered", "filled", "minimal"] as const;
export const HEADERS = ["traffic", "minimal", "branded"] as const;
export const CORNER_POSITIONS = ["auto", "bottom-right", "bottom-left"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be #RRGGBB");

export const appearanceSchema = z.object({
  /** "pet" derives the accent from the active pet's palette, which is the
   *  default because it keeps the panel and the creature obviously related. */
  accent: z.union([z.literal("pet"), hex]).default("pet"),
  corner: z.enum(CORNERS).default("soft"),
  density: z.enum(DENSITIES).default("comfortable"),
  bubbles: z.enum(BUBBLES).default("bordered"),
  header: z.enum(HEADERS).default("branded"),
  /** Where the launcher first appears. After that the visitor's dragged
   *  position wins — their choice outranks the owner's default. */
  position: z.enum(CORNER_POSITIONS).default("auto"),
  launcherSize: z.number().int().min(44).max(96).default(64),
  /** Offer a thumbs up/down on each answer. Feeds the unanswered-questions view. */
  feedback: z.boolean().default(true),
});

export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = appearanceSchema.parse({});

/**
 * A quick action offered under the greeting.
 *
 * `link` is restricted to https, and that restriction is the whole security
 * story: the widget renders owner-supplied strings into a page it does not own,
 * so a `javascript:` or `data:` URL here would be script execution on the
 * customer's site with the owner's blessing and the customer's origin.
 */
export const actionSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  kind: z.enum(["link", "prompt"]),
  value: z.string().min(1).max(400),
});

export type Action = z.infer<typeof actionSchema>;

export const actionsSchema = z.array(actionSchema).max(4).default([]);

/** https only, and parseable. Anything else is dropped rather than rendered. */
export function safeActionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Drop actions that could not be rendered safely, rather than failing the load.
 *  A bad action must not take the whole widget down with it. */
export function usableActions(actions: readonly Action[]): Action[] {
  return actions.filter((a) => (a.kind === "link" ? safeActionUrl(a.value) !== null : true));
}
