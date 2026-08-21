/**
 * The joint slots. FIXED across every part combination — this is the constraint
 * that makes swapping a pet a data change rather than a remount.
 *
 * Lifted verbatim from the reference robot's 72×72 viewBox. Every part in the
 * library is authored to these pivots, so a `cat` head and a `boxy` head hang
 * off the same neck and the running rig never has to be rebuilt.
 *
 * Sign convention (SVG, y down): a POSITIVE angle is clockwise, which swings
 * anything BELOW the pivot to the left. So for rightward travel every trailing
 * part below its pivot rotates positive, and parts ABOVE it — the crown —
 * rotate negative. Get this backwards and the antenna leads instead of trails.
 */

export const VIEWBOX = 72;

export const PIVOT = {
  root: [36, 20],
  squash: [36, 68],
  crown: [36, 12],
  head: [36, 41],
  torso: [36, 43],
  feet: [36, 60],
  armL: [17.5, 48],
  armR: [54.5, 48],
  shadow: [36, 70.5],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Spring tiers, progressively softer down the body. This chain IS the
 * follow-through: the torso settles first, then the head, then the limbs, and
 * the crown is still whipping after everything else has stopped.
 *
 * `lead` is the only tier that ANTICIPATES rather than trails — it drives the
 * gaze, because you look where you are going, and that anticipation is what
 * sells the rest of the motion as intentional.
 */
export const TIER = {
  lead: { stiffness: 460, damping: 32, mass: 0.35 },
  core: { stiffness: 230, damping: 24, mass: 0.6 },
  torso: { stiffness: 150, damping: 16, mass: 0.8 },
  head: { stiffness: 120, damping: 13, mass: 0.9 },
  limb: { stiffness: 92, damping: 11, mass: 1 },
  whip: { stiffness: 62, damping: 7.5, mass: 1.1 },
  lift: { stiffness: 320, damping: 26, mass: 0.6 },
  gaze: { stiffness: 170, damping: 22, mass: 0.6 },
} as const;

/** Drag speed (px/s) at which lean, trail and squash reach full deflection. */
export const FULL_TILT_SPEED = 900;
/** Quiet time before the pet dozes off. Any pointer movement wakes it. */
export const DOZE_AFTER_MS = 15_000;

/**
 * Half-width of the widest geometry hanging off each joint, measured from that
 * joint's pivot. Scaling a slot by k puts its edge at pivotX ± halfWidth·k, and
 * `overflow: visible` means anything past the 72-unit box bleeds into the
 * neighbouring pet in a gallery rather than clipping.
 *
 * head  the side plates, x 5…67 about pivot x=36  → 31
 * torso the capsule, x 18…54 about pivot x=36     → 18.5 (egg is 18.5 too)
 * limb  the noodle arm plus its 4.4 stroke, about pivot x=54.5 → 7.2
 */
export const SLOT_HALF_WIDTH = { head: 31, torso: 18.5, limb: 7.2 } as const;

/**
 * Per-skeleton proportion scalars. These scale what hangs off a joint; they
 * never move a joint, because moving one would break hot-swap.
 *
 * The head ceiling is 1.12, not higher, and that is a geometric limit rather
 * than taste: at k=1.18 the side plates land at −0.6…72.6, outside the box.
 * 1.12 lands at 1.3…70.7. See SLOT_HALF_WIDTH; the rig test enforces it.
 */
export const SKELETON_SCALE = {
  balanced: { head: 1, torso: 1, limb: 1 },
  bigHead: { head: 1.12, torso: 0.88, limb: 0.92 },
  longBody: { head: 0.9, torso: 1.2, limb: 1.1 },
  stout: { head: 1.06, torso: 1.08, limb: 0.82 },
} as const;

/**
 * The editable slots, in the order the editor lists them — crown to feet, the
 * way you would describe a creature out loud.
 *
 * Distinct from JOINTS: a joint is an animation group (the head carries the
 * face), a slot is something a person selects and changes.
 */
export const PET_SLOTS = ["crown", "head", "face", "torso", "arms", "feet"] as const;
export type PetSlot = (typeof PET_SLOTS)[number];
