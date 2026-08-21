import { REFERENCE_PET, type PetSpec } from "@bots/core/pet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PetRig } from "./rig.js";
import { PIVOT, SKELETON_SCALE, SLOT_HALF_WIDTH } from "./pivots.js";
import { ticker } from "./spring.js";

const SVG_NS = "http://www.w3.org/2000/svg";

let svg: SVGSVGElement;
let rig: PetRig | null = null;

const make = (spec: PetSpec = REFERENCE_PET, opts = {}) => {
  rig = new PetRig(svg, spec, opts);
  return rig;
};
const settle = (frames = 400) => {
  for (let i = 0; i < frames && ticker.activeCount > 0; i++) ticker.step(1 / 60);
};
const joint = (name: string) => svg.querySelector(`[data-joint="${name}"]`);
const transformOf = (name: string) => joint(name)?.getAttribute("transform") ?? "";

beforeEach(() => {
  ticker.raf = null;
  ticker.reset();
  svg = document.createElementNS(SVG_NS, "svg");
  document.body.appendChild(svg);
});

afterEach(() => {
  rig?.destroy();
  rig = null;
  svg.remove();
});

describe("structure", () => {
  it("renders every joint slot", () => {
    make();
    for (const j of ["shadow", "root", "crown", "armL", "armR", "feet", "torso", "head", "gaze"]) {
      expect(joint(j), `missing joint ${j}`).not.toBeNull();
    }
  });

  it("pivots each joint at its fixed anchor, not at a guessed transform-origin", () => {
    make();
    expect(transformOf("head")).toContain(`${PIVOT.head[0]} ${PIVOT.head[1]}`);
    expect(transformOf("torso")).toContain(`${PIVOT.torso[0]} ${PIVOT.torso[1]}`);
    expect(transformOf("armL")).toContain(`${PIVOT.armL[0]} ${PIVOT.armL[1]}`);
    expect(transformOf("crown")).toContain(`${PIVOT.crown[0]} ${PIVOT.crown[1]}`);
  });

  it("namespaces gradient ids per instance so a gallery does not collide", () => {
    const a = document.createElementNS(SVG_NS, "svg");
    const b = document.createElementNS(SVG_NS, "svg");
    document.body.append(a, b);
    const ra = new PetRig(a, REFERENCE_PET);
    const rb = new PetRig(b, REFERENCE_PET);

    const idsOf = (el: SVGSVGElement) =>
      [...el.querySelectorAll("linearGradient, radialGradient, clipPath")].map((g) => g.id);
    const ia = idsOf(a);
    const ib = idsOf(b);
    expect(ia.length).toBeGreaterThan(0);
    // Not one id in common — otherwise the second pet paints in the first's colours.
    expect(ia.filter((id) => ib.includes(id))).toEqual([]);

    ra.destroy();
    rb.destroy();
    a.remove();
    b.remove();
  });

  it("uses the spec's palette, and only the spec's palette", () => {
    make();
    const markup = svg.innerHTML;
    expect(markup).toContain(REFERENCE_PET.palette.shellHi);
    expect(markup).toContain(REFERENCE_PET.palette.visorLo);
    // No colour that is not in the palette (allowing plain white for highlights).
    const hexes = new Set(markup.match(/#[0-9A-Fa-f]{6}/g) ?? []);
    const allowed = new Set([...Object.values(REFERENCE_PET.palette), "#FFFFFF"]);
    for (const h of hexes) expect(allowed.has(h.toUpperCase()), `stray colour ${h}`).toBe(true);
  });

  it("renders every part combination in the library without throwing", () => {
    const crowns = ["antenna", "ears", "horn", "fin", "none"] as const;
    const heads = ["round", "boxy", "blob", "cat"] as const;
    const faces = ["visor", "eyes", "goggles"] as const;
    for (const crown of crowns) {
      for (const head of heads) {
        for (const face of faces) {
          const el = document.createElementNS(SVG_NS, "svg");
          document.body.appendChild(el);
          const r = new PetRig(el, {
            ...REFERENCE_PET,
            parts: { ...REFERENCE_PET.parts, crown, head, face },
          });
          expect(el.querySelector('[data-joint="head"]'), `${crown}/${head}/${face}`).not.toBeNull();
          r.destroy();
          el.remove();
        }
      }
    }
  });

  it("does not grow FOUR ears on a cat", () => {
    // The cat head draws its own ears; an `ears` crown stacks a second pair on
    // top. Caught by looking at rendered output, not by any structural check —
    // every joint was present and every id unique, and the pet had four ears.
    make({ ...REFERENCE_PET, parts: { ...REFERENCE_PET.parts, head: "cat", crown: "ears" } });
    const crown = joint("crown")!;
    expect(crown.innerHTML.trim()).toBe(""); // crown resolved away
    // Exactly one pair of ear triangles, from the head itself.
    const earPaths = [...svg.querySelectorAll("path")].filter((p) =>
      /^M(18|54) 13\.5/.test(p.getAttribute("d") ?? ""),
    );
    expect(earPaths).toHaveLength(2);
  });

  it("suppresses side plates when the crown already occupies the silhouette", () => {
    make({ ...REFERENCE_PET, parts: { ...REFERENCE_PET.parts, head: "round", crown: "ears" } });
    expect(svg.innerHTML).not.toContain('x="5" y="25.5"');
  });

  it("keeps every skeleton inside the 72-unit viewBox", () => {
    // `overflow: visible` means anything past the box bleeds into neighbouring
    // pets in a gallery rather than clipping. bigHead at 1.18 did exactly that,
    // and only showed up on looking at rendered output.
    const slots = [
      { name: "head", pivotX: PIVOT.head[0], half: SLOT_HALF_WIDTH.head },
      { name: "torso", pivotX: PIVOT.torso[0], half: SLOT_HALF_WIDTH.torso },
      { name: "limb", pivotX: PIVOT.armR[0], half: SLOT_HALF_WIDTH.limb },
    ] as const;

    for (const skeleton of ["balanced", "bigHead", "longBody", "stout"] as const) {
      const scale = SKELETON_SCALE[skeleton];
      for (const slot of slots) {
        const k = scale[slot.name];
        const right = slot.pivotX + slot.half * k;
        const left = slot.pivotX - slot.half * k;
        expect(right, `${skeleton}.${slot.name} overflows right`).toBeLessThanOrEqual(72);
        expect(left, `${skeleton}.${slot.name} overflows left`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("motion", () => {
  it("leans into travel, and the whole chain returns to rest", () => {
    const r = make();
    r.setVelocity(900, 0);
    settle();
    const leaning = transformOf("root");
    expect(leaning).not.toContain("rotate(0 ");

    r.setVelocity(0, 0);
    settle();
    expect(transformOf("root")).toContain("rotate(0 ");
    expect(ticker.activeCount).toBe(0); // idle page runs no frames
  });

  it("swings the crown opposite the body — it sits above its pivot", () => {
    const r = make();
    r.setVelocity(900, 0);
    for (let i = 0; i < 20; i++) ticker.step(1 / 60);

    const rootAngle = Number(/rotate\((-?[\d.]+)/.exec(transformOf("root"))?.[1]);
    const crownAngle = Number(/rotate\((-?[\d.]+)/.exec(transformOf("crown"))?.[1]);
    expect(rootAngle).not.toBe(0);
    expect(crownAngle).not.toBe(0);
    // Opposite signs. Same sign means the antenna leads the motion instead of
    // trailing it, and the rig stops reading as jointed.
    expect(Math.sign(rootAngle) * Math.sign(crownAngle)).toBe(-1);
  });

  it("the crown is still moving after the body has stopped", () => {
    const r = make();
    r.setVelocity(900, 0);
    settle();
    r.setVelocity(0, 0);

    let rootStopped = -1;
    let crownStopped = -1;
    for (let i = 0; i < 900; i++) {
      ticker.step(1 / 60);
      const root = Math.abs(Number(/rotate\((-?[\d.]+)/.exec(transformOf("root"))?.[1] ?? 0));
      const crown = Math.abs(Number(/rotate\((-?[\d.]+)/.exec(transformOf("crown"))?.[1] ?? 0));
      if (root > 0.05) rootStopped = i;
      if (crown > 0.05) crownStopped = i;
    }
    expect(crownStopped).toBeGreaterThan(rootStopped);
  });

  it("squashes along the axis of travel", () => {
    const r = make();
    r.setVelocity(0, 900);
    for (let i = 0; i < 30; i++) ticker.step(1 / 60);
    const scale = /scale\(([\d.]+) ([\d.]+)\)/.exec(transformOf("root"));
    expect(scale).not.toBeNull();
    // Falling: narrower and taller.
    expect(Number(scale![1])).toBeLessThan(1);
    expect(Number(scale![2])).toBeGreaterThan(1);
  });
});

describe("reduced motion", () => {
  it("pins the chain to zero — the pet still travels, it just never swings", () => {
    const r = make(REFERENCE_PET, { reducedMotion: true });
    r.setVelocity(900, 900);
    settle();
    expect(transformOf("root")).toContain("rotate(0 ");
    expect(transformOf("crown")).toContain("rotate(0 ");
    expect(ticker.activeCount).toBe(0);
  });

  it("disables the idle CSS animations too", () => {
    make(REFERENCE_PET, { reducedMotion: true });
    expect(svg.innerHTML).toContain("animation:none");
  });

  it("always emits a prefers-reduced-motion block, even when motion is on", () => {
    make();
    expect(svg.innerHTML).toContain("prefers-reduced-motion");
  });
});

describe("hot-swap", () => {
  const OTHER: PetSpec = {
    ...REFERENCE_PET,
    name: "Lavi",
    skeleton: "stout",
    parts: { crown: "fin", head: "blob", torso: "egg", arms: "noodle", feet: "paws", face: "eyes" },
    palette: {
      shellHi: "#E6CCFF", shellLo: "#8A5CD6", plateHi: "#C4A0F0", plateLo: "#6B3FA8",
      visorHi: "#241040", visorLo: "#0D0518", lit: "#9BE8FF",
    },
    personality: { energy: 0.1, curiosity: 0.4, blurb: "Drifts." },
  };

  it("morphs geometry and palette in place", () => {
    const r = make();
    expect(svg.innerHTML).toContain(REFERENCE_PET.palette.shellHi);

    r.setSpec(OTHER);
    expect(svg.innerHTML).toContain(OTHER.palette.shellHi);
    expect(svg.innerHTML).not.toContain(REFERENCE_PET.palette.shellHi);
    expect(joint("head")).not.toBeNull();
  });

  it("keeps the running spring chain — a swap is a data change, not a remount", () => {
    const r = make();
    r.setVelocity(900, 0);
    for (let i = 0; i < 15; i++) ticker.step(1 / 60);
    const midSwing = Number(/rotate\((-?[\d.]+)/.exec(transformOf("root"))?.[1]);
    expect(Math.abs(midSwing)).toBeGreaterThan(0.1);

    r.setSpec(OTHER);
    // The rig is still mid-swing at the same angle: nothing was torn down.
    const after = Number(/rotate\((-?[\d.]+)/.exec(transformOf("root"))?.[1]);
    expect(after).toBeCloseTo(midSwing, 2);

    // And it still settles afterwards, so the bindings survived the rebuild.
    r.setVelocity(0, 0);
    settle();
    expect(transformOf("root")).toContain("rotate(0 ");
  });

  it("re-namespaces gradients on swap without leaving the old ones behind", () => {
    const r = make();
    r.setSpec(OTHER);
    const ids = [...svg.querySelectorAll("linearGradient, radialGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg.innerHTML).toContain(`url(#${ids[0]!.split("-")[0]}-shell)`);
  });
});

describe("teardown", () => {
  it("releases springs so a destroyed pet stops consuming frames", () => {
    const r = make();
    r.setVelocity(900, 0);
    expect(ticker.activeCount).toBeGreaterThan(0);
    r.destroy();
    rig = null;
    expect(ticker.activeCount).toBe(0);
  });
});
