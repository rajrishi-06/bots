"use client";

import type { PetSpec } from "@bots/core/pet";
import { PetRig, type PetSlot } from "@bots/pet-engine";
import { useEffect, useRef } from "react";

/**
 * One live rig. Every pet shown in this product is a running instance, never a
 * screenshot — see DESIGN.md.
 *
 * The gallery caps how many animate at once via IntersectionObserver: each rig
 * runs its own spring chain, and a hundred of them drops frames.
 */
export function LivePet({
  spec,
  gaze = false,
  selection,
  onPick,
}: {
  spec: PetSpec;
  gaze?: boolean;
  /** Editor only: dims every slot but this one. */
  selection?: PetSlot | null;
  /** Editor only: makes the rig clickable, resolving a click to its slot. */
  onPick?: (slot: PetSlot | null) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const rigRef = useRef<PetRig | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rig = new PetRig(ref.current, spec, { reducedMotion: reduced, gaze });
    rigRef.current = rig;

    // Pause off-screen pets. Cheap, and it is the difference between a gallery
    // that scrolls and one that stutters.
    const svg = ref.current;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        svg.style.visibility = entry.isIntersecting ? "visible" : "hidden";
      },
      { rootMargin: "200px" },
    );
    io.observe(svg);

    // `gaze` promised the pet follows the cursor and delivered nothing: the rig
    // exposes setPointer but had no caller outside the widget, so a dashboard
    // pet tracked nothing and dozed off after 15s with no way to wake it.
    // One listener per rig, already throttled to a frame inside the rig.
    let move: ((e: PointerEvent) => void) | undefined;
    if (gaze) {
      move = (e) => rig.setPointer(e.clientX, e.clientY);
      window.addEventListener("pointermove", move, { passive: true });
    }

    return () => {
      if (move) window.removeEventListener("pointermove", move);
      io.disconnect();
      rig.destroy();
      rigRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A spec change is a hot-swap under a running chain, not a rebuild.
  useEffect(() => {
    rigRef.current?.setSpec(spec);
  }, [spec]);

  useEffect(() => {
    if (selection !== undefined) rigRef.current?.setSelection(selection);
  }, [selection, spec]);

  return (
    <svg
      ref={ref}
      onClick={onPick ? (e) => onPick(PetRig.slotFromEvent(e.nativeEvent)) : undefined}
      style={onPick ? { cursor: "pointer" } : undefined}
    />
  );
}
