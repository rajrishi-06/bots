import { z } from "zod";
import { isHex } from "../contrast.js";

/**
 * A pet is DATA, never drawing instructions.
 *
 * The model picks parts from a vetted library and picks colours. It never emits
 * path data. Two reasons, both load-bearing:
 *
 *   - Security. The widget renders into a customer's page. Model-authored SVG
 *     is an XSS vector (`<path onload>`, `<foreignObject>`, `<script>`) and
 *     there is no safe way to sanitise arbitrary generated markup into someone
 *     else's DOM.
 *   - Size and correctness. A spec is ~370 bytes and cannot be unrenderable.
 *     Generated geometry is ~200KB and frequently is.
 *
 * The joint slots are fixed across every part combination (see pivots in
 * @bots/pet-engine). That is what makes swapping the active pet a data change
 * rather than a remount — the rig keeps running and the geometry morphs under it.
 */

const Hex = z
  .string()
  .refine(isHex, "must be a hex colour like #6376DD")
  // Normalise so `#abc` and `#AABBCC` compare equal downstream.
  .transform((h) => {
    const s = h.trim().replace(/^#/, "");
    const full = s.length === 3 ? s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]! : s;
    return `#${full.toUpperCase()}`;
  });

/** Proportion preset. Cannot move the joint pivots — only scales what hangs off
 *  them — because fixed pivots are what let one running rig swap its geometry. */
export const SKELETONS = ["balanced", "bigHead", "longBody", "stout"] as const;

/**
 * Visual family.
 *
 * A theme swaps the GEOMETRY behind each slot, not the slots themselves — the
 * pivots stay fixed, so a pixel head hangs off the same neck as a robot one and
 * switching theme is still a hot-swap rather than a remount.
 *
 * Each theme only overrides the parts that define its silhouette and inherits
 * the rest, which is what keeps adding a sixth theme cheap instead of a
 * combinatorial rewrite of the whole library.
 */
export const THEMES = ["robot", "pixel", "animal", "ghost", "mech"] as const;
export type Theme = (typeof THEMES)[number];

export const PART_OPTIONS = {
  crown: ["antenna", "ears", "horn", "fin", "none"],
  head: ["round", "boxy", "blob", "cat"],
  torso: ["capsule", "boxy", "egg"],
  arms: ["stub", "noodle", "none"],
  feet: ["pads", "paws", "none"],
  face: ["visor", "eyes", "goggles"],
} as const;

export const petPartsSchema = z.object({
  crown: z.enum(PART_OPTIONS.crown),
  head: z.enum(PART_OPTIONS.head),
  torso: z.enum(PART_OPTIONS.torso),
  arms: z.enum(PART_OPTIONS.arms),
  feet: z.enum(PART_OPTIONS.feet),
  face: z.enum(PART_OPTIONS.face),
});

/** Seven stops, matching the reference rig's gradient set exactly. */
export const petPaletteSchema = z.object({
  shellHi: Hex,
  shellLo: Hex,
  plateHi: Hex,
  plateLo: Hex,
  visorHi: Hex,
  visorLo: Hex,
  lit: Hex,
});

/**
 * Personality is not decoration — `energy` and `curiosity` are wired into the
 * rig (breathing rate, spring stiffness, gaze travel) and `blurb` is appended
 * to the bot's system prompt. A personality that changed nothing would be a
 * string we lied about.
 */
export const petPersonalitySchema = z.object({
  energy: z.number().min(0).max(1),
  curiosity: z.number().min(0).max(1),
  blurb: z.string().min(3).max(160),
});

export const petSpecSchema = z.object({
  v: z.literal(1),
  name: z.string().min(1).max(48),
  // Defaulted, not required: every spec written before themes existed is still
  // valid, and a stored pet must never stop parsing because the schema grew.
  theme: z.enum(THEMES).default("robot"),
  skeleton: z.enum(SKELETONS),
  parts: petPartsSchema,
  palette: petPaletteSchema,
  personality: petPersonalitySchema,
});

export type PetParts = z.infer<typeof petPartsSchema>;
export type PetPalette = z.infer<typeof petPaletteSchema>;
export type PetPersonality = z.infer<typeof petPersonalitySchema>;
export type PetSpec = z.infer<typeof petSpecSchema>;

/** The portfolio robot, expressed as a spec. Doubles as the fallback pet and as
 *  the known-good fixture the palette gate is calibrated against. */
export const REFERENCE_PET: PetSpec = {
  v: 1,
  name: "Terminal",
  theme: "robot",
  skeleton: "balanced",
  parts: { crown: "antenna", head: "round", torso: "capsule", arms: "stub", feet: "pads", face: "visor" },
  palette: {
    shellHi: "#C3CDFB",
    shellLo: "#6376DD",
    plateHi: "#8493EA",
    plateLo: "#4B5CC6",
    visorHi: "#1A2242",
    visorLo: "#070B1A",
    lit: "#7FC0FF",
  },
  personality: { energy: 0.55, curiosity: 0.8, blurb: "Watchful, dry, quietly pleased to be useful." },
};
