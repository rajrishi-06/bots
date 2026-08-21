import type { PetSpec } from "@bots/core/pet";
import { DOZE_AFTER_MS, FULL_TILT_SPEED, PIVOT, SKELETON_SCALE, TIER } from "./pivots.js";
import { PARTS, chestFor, eye, headSidePlates, partFor, resolveParts, type PartContext } from "./parts.js";
import {
  MotionValue,
  Oscillator,
  Spring,
  bindAttribute,
  clamp,
  template,
  transform,
  type Unsubscribe,
  ticker,
  type Value,
} from "./spring.js";

/**
 * The rig: a jointed puppet, not a picture that tilts.
 *
 * Velocity feeds a chain of progressively softer springs, and every rotation is
 * written straight to a `<g>`'s `transform` attribute as `rotate(deg cx cy)` —
 * so each joint pivots exactly where a joint should (shoulder, neck, hips)
 * rather than at a CSS transform-origin we would have to guess at.
 *
 * Framework-agnostic on purpose: the dashboard renders these from React and the
 * widget from Preact, and neither re-renders a single time per frame.
 */

export interface RigOptions {
  /** Pins the whole spring chain to 0 — the pet still travels with the pointer,
   *  it just stops swinging. Idle CSS animations are disabled too. */
  reducedMotion?: boolean;
  /** Gaze-follow needs a pointer device; skipped when there isn't one. */
  gaze?: boolean;
}

export interface RigState {
  dragging?: boolean;
  hovered?: boolean;
  pressed?: boolean;
}

type Mood = "open" | "closed" | "arc";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Joint groups, in paint order. Fixed — see pivots.ts. */
const JOINTS = ["shadow", "breath", "root", "crown", "armL", "armR", "feet", "torso", "head", "gaze"] as const;
type Joint = (typeof JOINTS)[number];

export class PetRig {
  #svg: SVGSVGElement;
  #spec: PetSpec;
  #opts: Required<RigOptions>;
  #uid: string;

  // Inputs
  #nx = new MotionValue(0);
  #ny = new MotionValue(0);
  #liftTo = new MotionValue(0);
  #land = new MotionValue(0);
  #wave = new MotionValue(0);
  #gazeXTo = new MotionValue(0);
  #gazeYTo = new MotionValue(0);

  #springs: Spring[] = [];
  #breath!: Oscillator;
  #glow!: Oscillator;
  #bindings: Unsubscribe[] = [];
  #timers: ReturnType<typeof setTimeout>[] = [];
  #cleanups: Unsubscribe[] = [];

  #groups = new Map<Joint, SVGGElement>();
  #state: Required<RigState> = { dragging: false, hovered: false, pressed: false };
  #asleep = false;
  #mood: Mood = "open";
  #destroyed = false;

  constructor(svg: SVGSVGElement, spec: PetSpec, opts: RigOptions = {}) {
    this.#svg = svg;
    this.#spec = spec;
    this.#opts = { reducedMotion: false, gaze: true, ...opts };
    // Namespaced so a dozen live pets on one page do not collide on gradient ids.
    this.#uid = `p${Math.random().toString(36).slice(2, 9)}`;

    this.#svg.setAttribute("viewBox", "0 0 72 72");
    this.#svg.setAttribute("fill", "none");
    this.#svg.setAttribute("aria-hidden", "true");
    this.#svg.style.overflow = "visible";

    this.#build();
    this.#wireSprings();
    this.#startIdleBehaviours();
    this.#attachGlobalListeners();
  }

  /**
   * The rig watches the page itself.
   *
   * This used to be the caller's job — `setPointer` was public and every host
   * had to remember to feed it. The widget did not, so its pets never tracked
   * the cursor and, with nothing rousing them, dozed off after fifteen seconds
   * and stayed asleep. The pet looked dead on the one surface that matters most.
   *
   * A responsibility every caller must remember is a responsibility in the wrong
   * place. `setPointer` stays public for hosts with their own pointer pipeline
   * (the desktop shell reports screen coordinates), but nobody has to use it.
   */
  #attachGlobalListeners(): void {
    if (typeof window === "undefined") return;

    if (this.#opts.gaze && !this.#opts.reducedMotion) {
      let frame = 0;
      const onMove = (e: PointerEvent) => {
        // One sample per frame is plenty for three pixels of eye travel.
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          this.setPointer(e.clientX, e.clientY);
        });
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      this.#cleanups.push(() => {
        window.removeEventListener("pointermove", onMove);
        if (frame) cancelAnimationFrame(frame);
      });
    }

    // A hidden tab should not be running springs. rAF throttling in background
    // tabs is inconsistent enough that a pet nobody can see still burns CPU.
    const onVisibility = () => ticker.setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    this.#cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  /** Live velocity of whatever is carrying the pet, px/s. Drives the whole rig. */
  setVelocity(vx: number, vy: number): void {
    if (this.#opts.reducedMotion) return;
    this.#nx.set(clamp(vx / FULL_TILT_SPEED, -1, 1));
    this.#ny.set(clamp(vy / FULL_TILT_SPEED, -1, 1));
    this.#rouse();
  }

  /**
   * Viewport coordinates of the pointer. The eyes track it.
   *
   * Called automatically from a window listener — see `#attachGlobalListeners`.
   * Public for hosts with their own pointer pipeline, like the desktop shell.
   */
  setPointer(clientX: number, clientY: number): void {
    if (this.#opts.reducedMotion || !this.#opts.gaze) return;
    const box = this.#svg.getBoundingClientRect();
    if (!box.width) return;
    // Curiosity widens how far the eyes will travel to follow you.
    const reach = 1.4 + this.#spec.personality.curiosity * 1.4;
    this.#gazeXTo.set(clamp((clientX - (box.left + box.width / 2)) / (box.width * 2) * reach, -1, 1));
    this.#gazeYTo.set(clamp((clientY - (box.top + box.height * 0.36)) / (box.height * 2) * reach, -1, 1));
    this.#rouse();
  }

  setState(next: RigState): void {
    const was = this.#state.dragging;
    Object.assign(this.#state, next);
    this.#liftTo.set(this.#state.dragging ? 1 : this.#state.hovered ? 0.42 : 0);

    // Landing squash: a one-shot the moment the pet is set down.
    if (was && !this.#state.dragging && !this.#opts.reducedMotion) this.#pulse(this.#land, 440);
    if (this.#state.hovered && !this.#state.dragging && !this.#opts.reducedMotion) {
      this.#pulse(this.#wave, 1150);
    }
    this.#applyPressed();
    this.#rouse();
  }

  /**
   * Hot-swap the pet.
   *
   * Only the geometry is rebuilt — the spring chain, its transform templates and
   * every binding survive, because the joint slots are fixed. That is what makes
   * activating a different pet a data change rather than a remount, and why the
   * embedded widget can morph mid-conversation without a reload.
   */
  setSpec(spec: PetSpec): void {
    this.#spec = spec;
    this.#build();
    this.#rebind();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#breath?.destroy();
    this.#glow?.destroy();
    for (const t of this.#timers) clearTimeout(t);
    for (const c of this.#cleanups) c();
    for (const b of this.#bindings) b();
    for (const s of this.#springs) s.destroy();
    this.#timers = [];
    this.#cleanups = [];
    this.#bindings = [];
    this.#springs = [];
  }

  /* ── Geometry ───────────────────────────────────────────────────────────── */

  #context(): PartContext {
    const p = this.#spec.palette;
    return {
      uid: this.#uid,
      g: (name) => `url(#${this.#uid}-${name})`,
      lit: p.lit,
      plateLo: p.plateLo,
      visorHi: p.visorHi,
      visorLo: p.visorLo,
    };
  }

  #build(): void {
    const c = this.#context();
    const parts = resolveParts(this.#spec.parts);
    const { palette } = this.#spec;
    const theme = this.#spec.theme;
    const chest = chestFor(theme);
    const scale = SKELETON_SCALE[this.#spec.skeleton];
    const s = (v: number) => `scale(${v})`;
    // Scale about each joint's own pivot, so proportion changes never shift it.
    const about = (pivot: readonly [number, number], k: number) =>
      k === 1 ? "" : `translate(${pivot[0]} ${pivot[1]}) ${s(k)} translate(${-pivot[0]} ${-pivot[1]})`;

    this.#svg.innerHTML = `
      <defs>
        <linearGradient id="${this.#uid}-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${palette.shellHi}"/><stop offset="1" stop-color="${palette.shellLo}"/>
        </linearGradient>
        <linearGradient id="${this.#uid}-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${palette.plateHi}"/><stop offset="1" stop-color="${palette.plateLo}"/>
        </linearGradient>
        <linearGradient id="${this.#uid}-visor" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stop-color="${palette.visorHi}"/><stop offset="1" stop-color="${palette.visorLo}"/>
        </linearGradient>
        <radialGradient id="${this.#uid}-lit">
          <stop offset="0" stop-color="${palette.lit}" stop-opacity="0.85"/>
          <stop offset="1" stop-color="${palette.lit}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${this.#uid}-bulb">
          <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="${palette.lit}"/>
          <stop offset="1" stop-color="${palette.plateLo}"/>
        </radialGradient>
        <radialGradient id="${this.#uid}-shadow">
          <stop offset="0" stop-color="${palette.visorLo}" stop-opacity="0.5"/>
          <stop offset="1" stop-color="${palette.visorLo}" stop-opacity="0"/>
        </radialGradient>
        <clipPath id="${this.#uid}-faceclip"><rect x="12" y="14" width="48" height="25" rx="9"/></clipPath>
      </defs>
      <g data-joint="shadow">
        <ellipse class="pet-shadow" cx="36" cy="70.5" rx="16" ry="3" fill="${c.g("shadow")}"/>
      </g>

      <g data-joint="breath">
        <g data-joint="root">
          <g class="pet-zzz" opacity="0">
            <path d="M52 3 h5 l-5 6.4 h5" stroke="${palette.lit}" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </g>

          <g data-joint="crown">${partFor(theme, "crown", parts.crown)(c)}</g>

          <g transform="${about(PIVOT.armL, scale.limb)}">
            <g data-joint="armL">${PARTS.arms[parts.arms].left(c)}</g>
          </g>
          <g transform="${about(PIVOT.armR, scale.limb)}">
            <g data-joint="armR">${PARTS.arms[parts.arms].right(c)}</g>
          </g>
          <g data-joint="feet">${partFor(theme, "feet", parts.feet)(c)}</g>

          <g transform="${about(PIVOT.torso, scale.torso)}">
            <g data-joint="torso">
              ${partFor(theme, "torso", parts.torso)(c)}
              ${chest ? chest(c) : ""}
            </g>
          </g>

          <g transform="${about(PIVOT.head, scale.head)}">
            <g data-joint="head">
              ${headSidePlates(c, parts, theme)}
              ${partFor(theme, "head", parts.head)(c)}
              ${partFor(theme, "face", parts.face)(c)}
              <g clip-path="${c.g("faceclip")}">
                <g data-joint="gaze">${eye(c, 27.6)}${eye(c, 44.4)}</g>
              </g>
              <rect class="pet-squint" x="12" y="14" width="48" height="25" rx="9"
                    fill="${palette.visorLo}" opacity="0"/>
            </g>
          </g>
        </g>
      </g>`;

    // The stylesheet is built as a NODE with textContent, never as part of the
    // innerHTML string. `<style>` is raw text, and handing a parser a blob of
    // CSS inside an SVG innerHTML is fragile — happy-dom silently drops the
    // content AND everything after it, and browsers differ on the edges too.
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = this.#styles();
    this.#svg.appendChild(style);

    this.#groups.clear();
    for (const joint of JOINTS) {
      const el = this.#svg.querySelector<SVGGElement>(`[data-joint="${joint}"]`);
      if (el) this.#groups.set(joint, el);
    }
  }

  /**
   * Idle motion is CSS, not JS.
   *
   * Breathing, the crown glow, the chest cursor and the sleep z composite off
   * the main thread and stay in phase without a ticker. Only velocity-driven
   * motion — the part that must react to a real drag — needs springs.
   *
   * `energy` sets the tempo: a sleepy pet breathes slowly and a twitchy one fast.
   */
  #styles(): string {
    if (this.#opts.reducedMotion) {
      return `.pet-cursor,.pet-zzz{animation:none}
      @media (prefers-reduced-motion: reduce){.pet-cursor,.pet-zzz{animation:none}}`;
    }
    // ONLY opacity animates in CSS. Breathing and the glow moved to the ticker,
    // because CSS `transform` on an SVG element is the least reliable corner of
    // CSS animation — Safari especially — and idle motion that works on one
    // browser is worse than idle motion that works on all of them.
    return `
      .pet-cursor{animation:${this.#uid}-c 1.1s steps(1) infinite}
      @keyframes ${this.#uid}-c{0%,50%{opacity:1}50.01%,100%{opacity:0}}
      .pet-zzz{animation:${this.#uid}-z 2.8s ease-out infinite}
      @keyframes ${this.#uid}-z{0%{opacity:0}40%{opacity:.55}100%{opacity:0}}
      @media (prefers-reduced-motion: reduce){.pet-cursor,.pet-zzz{animation:none}}
    `;
  }

  /* ── Motion ─────────────────────────────────────────────────────────────── */

  #spring(source: Value<number>, tier: keyof typeof TIER): Spring {
    const base = TIER[tier];
    // Energy stiffens the whole chain: a twitchy pet snaps back, a sleepy one lolls.
    const k = 0.75 + this.#spec.personality.energy * 0.5;
    const s = new Spring(source, {
      stiffness: base.stiffness * k,
      damping: base.damping * Math.sqrt(k),
      mass: base.mass,
    });
    this.#springs.push(s);
    return s;
  }

  #wireSprings(): void {
    // Idle rhythm, on the same clock as everything else and written to the
    // transform ATTRIBUTE — see Oscillator for why this is not CSS.
    //
    // Amplitude 0 under reduced motion rather than skipping construction: the
    // transform chain and every binding stay identical, so there is one code
    // path instead of two, and `jump(0)` on the springs does not silently miss
    // the oscillators the way it did when they were created unconditionally.
    const e = this.#spec.personality.energy;
    const still = this.#opts.reducedMotion;
    this.#breath = new Oscillator(5.6 - e * 2.6, still ? 0 : 1.2 + e * 1.1);
    this.#glow = new Oscillator(4.4 - e * 2.2, still ? 0 : 1);

    const lead = this.#spring(this.#nx, "lead");
    const leadY = this.#spring(this.#ny, "lead");
    const core = this.#spring(this.#nx, "core");
    const coreY = this.#spring(this.#ny, "core");
    const torso = this.#spring(this.#nx, "torso");
    const head = this.#spring(this.#nx, "head");
    const limb = this.#spring(this.#nx, "limb");
    const limbY = this.#spring(this.#ny, "limb");
    const whip = this.#spring(this.#nx, "whip");
    const whipY = this.#spring(this.#ny, "whip");
    const lift = this.#spring(this.#liftTo, "lift");
    const land = this.#spring(this.#land, "lift");
    const wave = this.#spring(this.#wave, "limb");
    const gazeX = this.#spring(this.#gazeXTo, "gaze");
    const gazeY = this.#spring(this.#gazeYTo, "gaze");

    const t = transform;

    // Whole body: rises when held, swings from the point it is held by, then
    // squashes along the axis it is travelling — and again, harder, on landing.
    const rise = t([lift, land], ([l, d]) => -l! * 2.4 - d! * 0.8);
    const swing = t([core], ([v]) => v! * 11);
    const sx = t([coreY, land], ([v, d]) => 1 - Math.abs(v!) * 0.05 + d! * 0.09);
    const sy = t([coreY, land], ([v, d]) => 1 + Math.abs(v!) * 0.075 - d! * 0.11);

    this.#transforms = {
      root: template`translate(0 ${rise}) rotate(${swing} ${PIVOT.root[0]} ${PIVOT.root[1]}) translate(${PIVOT.squash[0]} ${PIVOT.squash[1]}) scale(${sx} ${sy}) translate(${-PIVOT.squash[0]} ${-PIVOT.squash[1]})`,
      // ABOVE its pivot, so it whips the other way. See the sign convention.
      crown: template`rotate(${t([whip], ([v]) => -v! * 26)} ${PIVOT.crown[0]} ${PIVOT.crown[1]}) translate(0 ${t([whipY], ([v]) => -v! * 1.6)})`,
      head: template`rotate(${t([head], ([v]) => -v! * 5)} ${PIVOT.head[0]} ${PIVOT.head[1]})`,
      torso: template`rotate(${t([torso], ([v]) => v! * 6)} ${PIVOT.torso[0]} ${PIVOT.torso[1]})`,
      feet: template`rotate(${t([limb], ([v]) => v! * 11)} ${PIVOT.feet[0]} ${PIVOT.feet[1]})`,
      armL: template`rotate(${t([limb, limbY, wave], ([h, v, w]) => h! * 23 + v! * 11 - w! * 4)} ${PIVOT.armL[0]} ${PIVOT.armL[1]})`,
      armR: template`rotate(${t([limb, limbY, wave], ([h, v, w]) => h! * 26 - v! * 11 - w! * 54)} ${PIVOT.armR[0]} ${PIVOT.armR[1]})`,
      // The gaze LEADS the drag; pointer-follow rides on top of it.
      gaze: template`translate(${t([lead, gazeX], ([l, p]) => clamp(l! * 2.5 + p! * 2.6, -3.2, 3.2))} ${t([leadY, gazeY], ([l, p]) => clamp(l! * 1.6 + p! * 1.8, -2.2, 2.2))})`,
      shadow: template`translate(${PIVOT.shadow[0]} ${PIVOT.shadow[1]}) scale(${t([lift, land], ([l, d]) => 1 - l! * 0.3 + d! * 0.1)} 1) translate(${-PIVOT.shadow[0]} ${-PIVOT.shadow[1]})`,
      // A pure translate, so it composes cleanly with every rotation below it.
      breath: template`translate(0 ${t([this.#breath], ([b]) => -b!)})`,
    };

    this.#shadowOpacity = t([lift, land], ([l, d]) => 0.9 - l! * 0.5 + d! * 0.1);
    this.#glowOpacity = t([this.#glow], ([g]) => 0.34 + g! * 0.38);
    this.#rebind();
  }

  #transforms!: Record<Joint, Value<string>>;
  #shadowOpacity!: Value<number>;
  #glowOpacity!: Value<number>;

  /** Re-attach bindings after a rebuild. The springs are untouched. */
  #rebind(): void {
    for (const b of this.#bindings) b();
    this.#bindings = [];
    for (const joint of JOINTS) {
      const el = this.#groups.get(joint);
      const value = this.#transforms[joint];
      if (el && value) this.#bindings.push(bindAttribute(el, "transform", value));
    }
    for (const el of this.#svg.querySelectorAll<SVGElement>(".pet-glow")) {
      const apply = (v: number) => el.setAttribute("opacity", String(Math.round(v * 100) / 100));
      apply(this.#glowOpacity.get());
      this.#bindings.push(this.#glowOpacity.on(apply));
    }
    const shadow = this.#svg.querySelector<SVGElement>(".pet-shadow");
    if (shadow) {
      const apply = (v: number) => shadow.setAttribute("opacity", String(Math.round(v * 100) / 100));
      apply(this.#shadowOpacity.get());
      this.#bindings.push(this.#shadowOpacity.on(apply));
    }
    this.#applyMood();
    this.#applyPressed();
  }

  /** One-shot 0 → 1 → 0, for the landing squash and the wave. */
  #pulse(value: MotionValue<number>, ms: number): void {
    value.set(1);
    const t = setTimeout(() => value.set(0), ms * 0.35);
    this.#timers.push(t);
  }

  /* ── Face ───────────────────────────────────────────────────────────────── */

  #applyMood(): void {
    for (const g of this.#svg.querySelectorAll<SVGGElement>(".pet-eye")) {
      const set = (sel: string, on: boolean) =>
        g.querySelector<SVGElement>(sel)?.setAttribute("opacity", on ? "1" : "0");
      set(".pet-eye-open", this.#mood === "open");
      set(".pet-eye-closed", this.#mood === "closed");
      set(".pet-eye-arc", this.#mood === "arc");
    }
  }

  #applyPressed(): void {
    this.#svg
      .querySelector<SVGElement>(".pet-squint")
      ?.setAttribute("opacity", this.#state.pressed && !this.#state.dragging ? "0.45" : "0");
  }

  #setMood(mood: Mood): void {
    if (this.#mood === mood) return;
    this.#mood = mood;
    this.#applyMood();
  }

  #rouse(): void {
    if (this.#asleep) {
      this.#asleep = false;
      this.#svg.removeAttribute("data-asleep");
      this.#svg.querySelector<SVGElement>(".pet-zzz")?.setAttribute("opacity", "0");
      this.#setMood("open");
    }
    this.#resetDoze();
  }

  #dozeTimer: ReturnType<typeof setTimeout> | null = null;

  #resetDoze(): void {
    if (this.#opts.reducedMotion) return; // no dozing when motion is unwelcome
    if (this.#dozeTimer) clearTimeout(this.#dozeTimer);
    this.#dozeTimer = setTimeout(() => {
      if (this.#destroyed) return;
      this.#asleep = true;
      this.#svg.setAttribute("data-asleep", "true");
      this.#svg.querySelector<SVGElement>(".pet-zzz")?.setAttribute("opacity", "1");
      this.#setMood("arc");
    }, DOZE_AFTER_MS);
    this.#timers.push(this.#dozeTimer);
  }

  #startIdleBehaviours(): void {
    if (this.#opts.reducedMotion) {
      // Pin the entire chain: the pet still travels, it just never swings.
      for (const s of this.#springs) s.jump(0);
      this.#applyMood();
      return;
    }

    // Open is the resting face on purpose: open eyes are the ones that track the
    // cursor, and that is what makes the pet feel present.
    const blink = () => {
      if (this.#destroyed) return;
      const t = setTimeout(() => {
        if (this.#asleep) return blink();
        this.#setMood("closed");
        const t2 = setTimeout(() => {
          this.#setMood("open");
          blink();
        }, 130);
        this.#timers.push(t2);
      }, 2400 + Math.random() * 4200);
      this.#timers.push(t);
    };
    blink();
    this.#resetDoze();
  }
}

/** Convenience: make an `<svg>` and rig it in one call. */
export function createPet(
  container: Element,
  spec: PetSpec,
  opts?: RigOptions,
): { svg: SVGSVGElement; rig: PetRig } {
  const svg = document.createElementNS(SVG_NS, "svg");
  container.appendChild(svg);
  return { svg, rig: new PetRig(svg, spec, opts) };
}
