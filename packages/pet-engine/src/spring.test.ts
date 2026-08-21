import { beforeEach, describe, expect, it } from "vitest";
import { MotionValue, Spring, bindAttribute, template, ticker, transform } from "./spring.js";

/** Step the shared ticker by hand — no real animation frames involved. */
const settle = (frames = 600, dt = 1 / 60) => {
  for (let i = 0; i < frames && ticker.activeCount > 0; i++) ticker.step(dt);
};

beforeEach(() => {
  ticker.raf = null; // tests drive the clock
  ticker.reset(); // shared singleton — never inherit another test's springs
});

describe("MotionValue", () => {
  it("notifies listeners on change and stops after unsubscribe", () => {
    const v = new MotionValue(0);
    const seen: number[] = [];
    const off = v.on((x) => seen.push(x));
    v.set(1);
    v.set(2);
    off();
    v.set(3);
    expect(seen).toEqual([1, 2]);
  });

  it("does not notify when the value is unchanged", () => {
    const v = new MotionValue(5);
    let calls = 0;
    v.on(() => calls++);
    v.set(5);
    expect(calls).toBe(0);
  });
});

describe("Spring", () => {
  const config = { stiffness: 230, damping: 24, mass: 0.6 };

  it("converges on the target and comes to rest", () => {
    const source = new MotionValue(0);
    const s = new Spring(source, config);
    source.set(10);
    settle();
    expect(s.get()).toBeCloseTo(10, 3);
    expect(ticker.activeCount).toBe(0); // sleeps, so an idle page runs no frames
  });

  it("does not diverge at the stiffest setting in the chain", () => {
    // The `lead` tier. Explicit Euler adds energy here and visibly explodes.
    const source = new MotionValue(0);
    const s = new Spring(source, { stiffness: 460, damping: 32, mass: 0.35 });
    source.set(1);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      ticker.step(1 / 60);
      peak = Math.max(peak, Math.abs(s.get()));
    }
    expect(Number.isFinite(s.get())).toBe(true);
    expect(peak).toBeLessThan(2); // some overshoot is the point; runaway is not
    expect(s.get()).toBeCloseTo(1, 3);
  });

  it("softer tiers settle later than stiffer ones — this is the follow-through", () => {
    const source = new MotionValue(0);
    const core = new Spring(source, { stiffness: 230, damping: 24, mass: 0.6 });
    const whip = new Spring(source, { stiffness: 62, damping: 7.5, mass: 1.1 });
    source.set(1);

    let coreFrames = 0;
    let whipFrames = 0;
    for (let i = 0; i < 1200; i++) {
      ticker.step(1 / 60);
      if (Math.abs(core.get() - 1) > 0.01) coreFrames = i;
      if (Math.abs(whip.get() - 1) > 0.01) whipFrames = i;
    }
    // The antenna is still moving after the body has stopped. That progressive
    // softening is what makes the rig read as jointed rather than as a tilt.
    expect(whipFrames).toBeGreaterThan(coreFrames);
  });

  it("clamps a huge delta so a backgrounded tab does not fling the rig", () => {
    const source = new MotionValue(0);
    const s = new Spring(source, config);
    source.set(1);
    ticker.step(5); // five seconds in one frame, as a restored tab hands back
    expect(Number.isFinite(s.get())).toBe(true);
    // Without the clamp this integrates to ~9583 and the pet leaves the page.
    expect(Math.abs(s.get())).toBeLessThan(3);
  });

  it("jump() pins the value and cancels motion — the reduced-motion path", () => {
    const source = new MotionValue(0);
    const s = new Spring(source, config);
    source.set(10);
    ticker.step(1 / 60);
    s.jump(0);
    expect(s.get()).toBe(0);
    expect(ticker.activeCount).toBe(0);
  });

  it("stops receiving updates once destroyed", () => {
    const source = new MotionValue(0);
    const s = new Spring(source, config);
    s.destroy();
    source.set(99);
    settle();
    expect(s.get()).toBe(0);
  });
});

describe("transform", () => {
  it("derives from several sources and recomputes on any change", () => {
    const a = new MotionValue(1);
    const b = new MotionValue(2);
    const sum = transform([a, b], ([x, y]) => x! + y!);
    expect(sum.get()).toBe(3);
    a.set(10);
    expect(sum.get()).toBe(12);
  });

  it("does not emit when the derived value is unchanged", () => {
    const a = new MotionValue(1);
    const clamped = transform([a], ([x]) => Math.min(x!, 5));
    let calls = 0;
    clamped.on(() => calls++);
    a.set(6);
    a.set(7); // still clamps to 5 — nothing downstream should re-run
    expect(calls).toBe(1);
  });
});

describe("template", () => {
  it("builds a live SVG transform string", () => {
    const angle = new MotionValue(0);
    const t = template`rotate(${angle} 36 41)`;
    expect(t.get()).toBe("rotate(0 36 41)");
    angle.set(12.5);
    expect(t.get()).toBe("rotate(12.5 36 41)");
  });

  it("rounds to 3dp so attribute strings stay short", () => {
    const angle = new MotionValue(1 / 3);
    expect(template`rotate(${angle})`.get()).toBe("rotate(0.333)");
  });

  it("accepts constants alongside live values", () => {
    const s = new MotionValue(2);
    expect(template`scale(${s} ${1})`.get()).toBe("scale(2 1)");
  });
});

describe("bindAttribute", () => {
  it("writes immediately and on every change, then stops after unbind", () => {
    const el = { attrs: {} as Record<string, string>, setAttribute(n: string, v: string) { this.attrs[n] = v; } };
    const angle = new MotionValue(0);
    const off = bindAttribute(el as unknown as Element, "transform", template`rotate(${angle})`);
    expect(el.attrs.transform).toBe("rotate(0)");
    angle.set(5);
    expect(el.attrs.transform).toBe("rotate(5)");
    off();
    angle.set(9);
    expect(el.attrs.transform).toBe("rotate(5)");
  });
});

describe("the shared ticker", () => {
  it("runs no frames when everything is at rest", () => {
    expect(ticker.activeCount).toBe(0);
  });

  it("drives many springs from one clock", () => {
    const source = new MotionValue(0);
    const springs = Array.from({ length: 12 }, () => new Spring(source, { stiffness: 120, damping: 13, mass: 0.9 }));
    source.set(1);
    expect(ticker.activeCount).toBe(12);
    settle();
    expect(ticker.activeCount).toBe(0);
    for (const s of springs) expect(s.get()).toBeCloseTo(1, 3);
  });
});
