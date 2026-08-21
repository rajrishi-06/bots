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
/** Anything the ticker can advance. */
interface Steppable {
  step(dt: number): void;
}

class Ticker {
  #active = new Set<Steppable>();
  /** Registered for the object's lifetime rather than until it comes to rest. */
  #persistent = new Set<Steppable>();
  #frame: number | null = null;
  #last = 0;
  /** Swapped out in tests for a manual clock. */
  raf: ((cb: (t: number) => void) => number) | null =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame.bind(globalThis) : null;

  add(s: Steppable): void {
    this.#active.add(s);
    this.#wake();
  }

  /** For oscillators: they never reach rest, so they never unregister themselves. */
  addPersistent(s: Steppable): void {
    this.#persistent.add(s);
    this.#wake();
  }

  remove(s: Steppable): void {
    this.#active.delete(s);
    this.#persistent.delete(s);
  }

  #wake(): void {
    if (this.#frame === null && this.raf && !this.#paused) {
      this.#last = performance.now();
      this.#frame = this.raf(this.#tick);
    }
  }

  #paused = false;

  /**
   * Stop the clock entirely. Bound to document visibility by the rig: a
   * backgrounded tab should not be running springs, and rAF throttling there is
   * unreliable enough that a hidden pet can otherwise eat real CPU.
   */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (!paused) this.#wake();
  }

  #tick = (now: number): void => {
    const dt = (now - this.#last) / 1000;
    this.#last = now;
    this.step(dt);
    const running = this.#active.size > 0 || this.#persistent.size > 0;
    this.#frame = running && this.raf && !this.#paused ? this.raf(this.#tick) : null;
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
    for (const s of [...this.#persistent]) s.step(clamped);
  }

  /** Springs currently in flight. Oscillators are excluded — they never rest,
   *  and counting them would make "is anything still moving?" always true. */
  get activeCount(): number {
    return this.#active.size;
  }

  /** Test-only. The ticker is a process-wide singleton by design, so a spring
   *  left mid-flight by one test would otherwise be counted by the next. */
  reset(): void {
    this.#active.clear();
    this.#persistent.clear();
    this.#paused = false;
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

/**
 * A free-running sine oscillator, for motion that never settles — breathing,
 * a pulsing glow.
 *
 * Springs chase a target and then sleep, which is exactly wrong for a rhythm.
 * This registers with the same ticker so idle motion composes with velocity
 * motion in one clock rather than a second animation system.
 *
 * It is deliberately NOT CSS. `transform` on an SVG element is the shakiest
 * corner of CSS animation support — Safari in particular — and the rig already
 * writes the transform ATTRIBUTE for every joint, which works everywhere. Idle
 * motion that only breathes on Chrome is worse than none.
 */
export class Oscillator implements Value<number> {
  #phase = 0;
  #current = 0;
  #listeners = new Set<(v: number) => void>();
  #period: number;
  #amplitude: number;

  constructor(periodSeconds: number, amplitude: number) {
    this.#period = periodSeconds;
    this.#amplitude = amplitude;
    ticker.addPersistent(this);
  }

  /** Retune without restarting — phase is preserved, so it does not jump. */
  set(periodSeconds: number, amplitude: number): void {
    this.#period = periodSeconds;
    this.#amplitude = amplitude;
  }

  get(): number {
    return this.#current;
  }

  on(listener: (v: number) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  step(dt: number): void {
    this.#phase = (this.#phase + dt / this.#period) % 1;
    // -cos rather than sin so it starts at the bottom of the breath (0) and
    // rises — starting mid-inhale reads as a twitch on mount.
    const next = ((1 - Math.cos(this.#phase * Math.PI * 2)) / 2) * this.#amplitude;
    if (next === this.#current) return;
    this.#current = next;
    for (const l of this.#listeners) l(next);
  }

  destroy(): void {
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
