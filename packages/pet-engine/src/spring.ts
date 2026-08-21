/**
 * A ~150-line rAF spring primitive.
 *
 * The reference rig is built on framer-motion's `useMotionValue` / `useSpring` /
 * `useTransform` / `useMotionTemplate`. That is React-only and far too heavy for
 * an embeddable with a 30KB budget, so this reimplements exactly the surface the
 * rig uses and nothing else.
 *
 * Two deliberate differences from framer-motion:
 *
 *  - ONE shared ticker drives every spring in the document, not one rAF loop
 *    per value. A gallery renders a dozen live pets, each with ~10 springs; a
 *    hundred competing rAF callbacks is how that drops frames.
 *  - The ticker is injectable, so tests step time by hand instead of waiting on
 *    real frames. Spring physics that is only observable through a real
 *    animation frame is spring physics nobody tests.
 */

export type Unsubscribe = () => void;

export interface Value<T> {
  get(): T;
  on(listener: (v: T) => void): Unsubscribe;
}

/** A settable value. The root of every derived chain. */
export class MotionValue<T> implements Value<T> {
  #v: T;
  #listeners = new Set<(v: T) => void>();

  constructor(initial: T) {
    this.#v = initial;
  }

  get(): T {
    return this.#v;
  }

  set(v: T): void {
    if (Object.is(v, this.#v)) return; // no work, and no listener churn
    this.#v = v;
    for (const l of this.#listeners) l(v);
  }

  on(listener: (v: T) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Below both thresholds for a frame, the spring snaps to target and sleeps. */
const REST_DISPLACEMENT = 0.0005;
const REST_VELOCITY = 0.0005;
/** Longest step the integrator will take. A backgrounded tab hands back a huge
 *  dt on return; integrating it in one go throws the spring across the screen. */
const MAX_DT = 1 / 30;

/**
 * The shared clock. Springs register while moving and unregister at rest, so an
 * idle page runs no animation frames at all.
 */
class Ticker {
  #active = new Set<Spring>();
  #frame: number | null = null;
  #last = 0;
  /** Swapped out in tests for a manual clock. */
  raf: ((cb: (t: number) => void) => number) | null =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame.bind(globalThis) : null;

  add(s: Spring): void {
    this.#active.add(s);
    if (this.#frame === null && this.raf) {
      this.#last = performance.now();
      this.#frame = this.raf(this.#tick);
    }
  }

  remove(s: Spring): void {
    this.#active.delete(s);
  }

  #tick = (now: number): void => {
    const dt = (now - this.#last) / 1000;
    this.#last = now;
    this.step(dt);
    this.#frame = this.#active.size > 0 && this.raf ? this.raf(this.#tick) : null;
  };

  /**
   * Advance every active spring by `dt` seconds. Public so tests can drive it.
   *
   * The MAX_DT clamp lives HERE rather than in the rAF callback, because this is
   * the actual integration entry point — clamping only on the way in from
   * requestAnimationFrame left every other caller able to hand the integrator a
   * five-second step, which throws the rig thousands of units off screen.
   */
  step(dt: number): void {
    const clamped = Math.min(dt, MAX_DT);
    for (const s of [...this.#active]) s.step(clamped);
  }

  get activeCount(): number {
    return this.#active.size;
  }

  /** Test-only. The ticker is a process-wide singleton by design, so a spring
   *  left mid-flight by one test would otherwise be counted by the next. */
  reset(): void {
    this.#active.clear();
    this.#frame = null;
  }
}

export const ticker = new Ticker();

/**
 * A damped harmonic oscillator chasing `source`.
 *
 * Semi-implicit Euler: velocity updates first, then position uses the NEW
 * velocity. Explicit Euler adds energy at these stiffnesses and the chain
 * visibly diverges instead of settling.
 */
export class Spring implements Value<number> {
  #current: number;
  #velocity = 0;
  #target: number;
  #config: SpringConfig;
  #listeners = new Set<(v: number) => void>();
  #unsubscribe: Unsubscribe;
  #resting = true;

  constructor(source: Value<number>, config: SpringConfig) {
    this.#current = source.get();
    this.#target = this.#current;
    this.#config = config;
    this.#unsubscribe = source.on((v) => {
      this.#target = v;
      if (this.#resting) {
        this.#resting = false;
        ticker.add(this);
      }
    });
  }

  get(): number {
    return this.#current;
  }

  on(listener: (v: number) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Jump straight to a value, cancelling motion. Used by reduced-motion. */
  jump(v: number): void {
    this.#current = v;
    this.#target = v;
    this.#velocity = 0;
    this.#sleep();
    this.#emit();
  }

  step(dt: number): void {
    const { stiffness, damping, mass } = this.#config;
    const displacement = this.#current - this.#target;
    const acceleration = (-stiffness * displacement - damping * this.#velocity) / mass;

    this.#velocity += acceleration * dt;
    this.#current += this.#velocity * dt;

    if (
      Math.abs(this.#current - this.#target) < REST_DISPLACEMENT &&
      Math.abs(this.#velocity) < REST_VELOCITY
    ) {
      this.#current = this.#target;
      this.#velocity = 0;
      this.#sleep();
    }
    this.#emit();
  }

  #sleep(): void {
    this.#resting = true;
    ticker.remove(this);
  }

  #emit(): void {
    for (const l of this.#listeners) l(this.#current);
  }

  destroy(): void {
    this.#unsubscribe();
    this.#listeners.clear();
    ticker.remove(this);
  }
}

/** Derive a value from one or more sources. Recomputes on any source change. */
export function transform<T>(sources: readonly Value<number>[], fn: (values: number[]) => T): Value<T> {
  const compute = () => fn(sources.map((s) => s.get()));
  let current = compute();
  const listeners = new Set<(v: T) => void>();

  const unsubscribes = sources.map((s) =>
    s.on(() => {
      const next = compute();
      if (Object.is(next, current)) return;
      current = next;
      for (const l of listeners) l(current);
    }),
  );

  return {
    get: () => current,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Exposed for teardown; not part of the Value contract.
    ...({ destroy: () => unsubscribes.forEach((u) => u()) } as object),
  } as Value<T>;
}

/** Tagged template producing a live string — the SVG `transform` attribute. */
export function template(
  strings: TemplateStringsArray,
  ...values: (Value<number> | number)[]
): Value<string> {
  const dynamic = values.filter((v): v is Value<number> => typeof v !== "number");
  return transform(dynamic, () => {
    let out = strings[0] ?? "";
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      const n = typeof v === "number" ? v : v.get();
      // 3dp is below a pixel at every size the pet renders, and it keeps the
      // attribute string short enough that setAttribute is not the bottleneck.
      out += `${Math.round(n * 1000) / 1000}${strings[i + 1] ?? ""}`;
    }
    return out;
  });
}

/** Bind a live string to an element attribute. The whole rig is this. */
export function bindAttribute(el: Element, name: string, value: Value<string>): Unsubscribe {
  const apply = (v: string) => el.setAttribute(name, v);
  apply(value.get());
  return value.on(apply);
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);
