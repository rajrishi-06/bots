"use client";

import type { PetSpec } from "@bots/core/pet";
import { PetRig } from "@bots/pet-engine";
import { useEffect, useRef } from "react";

/**
 * One live rig. Every pet shown in this product is a running instance, never a
 * screenshot — see DESIGN.md.
 *
 * The gallery caps how many animate at once via IntersectionObserver: each rig
 * runs its own spring chain, and a hundred of them drops frames.
 */
export function LivePet({ spec, gaze = false }: { spec: PetSpec; gaze?: boolean }) {
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

    return () => {
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

  return <svg ref={ref} />;
}
