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

/** Per-skeleton proportion scalars. These scale what hangs off a joint; they
 *  never move a joint, because moving one would break hot-swap. */
export const SKELETON_SCALE = {
  balanced: { head: 1, torso: 1, limb: 1 },
  bigHead: { head: 1.18, torso: 0.88, limb: 0.92 },
  longBody: { head: 0.9, torso: 1.2, limb: 1.1 },
  stout: { head: 1.06, torso: 1.08, limb: 0.82 },
} as const;
