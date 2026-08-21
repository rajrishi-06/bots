import type { PetPalette } from "@bots/core/pet";
import type { Appearance } from "@bots/core/widget/defaults";
import { contrast } from "@bots/core/contrast";

/**
 * Shadow DOM stylesheet, parameterised by the owner's appearance choices.
 *
 * Starts with `all: initial` on the host because this renders inside somebody
 * else's page. Shadow DOM stops the host's SELECTORS reaching in, but INHERITED
 * properties — font, colour, line-height, letter-spacing — still cross the
 * boundary, and a host with a 24px base font or content-box sizing will deform
 * the panel without it.
 */

const RADIUS = { square: "0px", soft: "10px", round: "18px" } as const;
const BUBBLE_RADIUS = { square: "0px", soft: "12px", round: "16px" } as const;
const PAD = { comfortable: "14px", compact: "9px" } as const;
const GAP = { comfortable: "12px", compact: "7px" } as const;

/**
 * Pick the accent.
 *
 * "pet" derives it from the palette so the panel and the creature read as one
 * thing. The chosen stop is whichever of the pet's mid-tones holds up against
 * the panel surface — a pale highlight used as a link colour is unreadable, and
 * the palette gate only guarantees the SILHOUETTE works, not any single stop.
 */
function resolveAccent(appearance: Appearance, palette: PetPalette, surface: string): string {
  if (appearance.accent !== "pet") return appearance.accent;
  const candidates = [palette.shellLo, palette.plateLo, palette.visorHi, palette.shellHi];
  let best = candidates[0]!;
  let bestScore = 0;
  for (const c of candidates) {
    const score = contrast(c, surface);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function stylesheet(palette: PetPalette, appearance: Appearance): string {
  const radius = RADIUS[appearance.corner];
  const bubble = BUBBLE_RADIUS[appearance.corner];
  const pad = PAD[appearance.density];
  const gap = GAP[appearance.density];
  const light = resolveAccent(appearance, palette, "#FFFFFF");
  const dark = resolveAccent(appearance, palette, "#14161A");

  return `
:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --paper: #FFFFFF;
  --surface: #F5F6F8;
  --ink: #14171C;
  --muted: #4A505A;
  --faint: #757D89;
  --line: rgba(0,0,0,0.10);
  --line-strong: rgba(0,0,0,0.18);
  --accent: ${light};
  --on-accent: #FFFFFF;
  --shadow: 0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08);
  --radius: ${radius};
  --bubble: ${bubble};
  --pad: ${pad};
  --gap: ${gap};
}
@media (prefers-color-scheme: dark) {
  :host {
    --paper: #16181D; --surface: #1F232A; --ink: #ECEEF2;
    --muted: #B4BAC4; --faint: #868E9A;
    --line: rgba(255,255,255,0.12); --line-strong: rgba(255,255,255,0.20);
    --accent: ${dark};
    --shadow: 0 12px 32px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
  }
}
*, *::before, *::after { box-sizing: border-box; }

.launcher-layer, .panel-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }

.launcher {
  position: absolute; left: 0; top: 0;
  width: ${appearance.launcherSize}px; height: ${appearance.launcherSize}px;
  pointer-events: auto; cursor: grab; background: none; border: 0; padding: 0;
  touch-action: none;
  transition: opacity .2s ease, transform .2s cubic-bezier(.2,.9,.3,1.2);
}
.launcher:active { cursor: grabbing; }
.launcher[data-open="true"] { opacity: 0; transform: scale(.8); pointer-events: none; }
.launcher:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 8px; }
.launcher svg { width: 100%; height: 100%; display: block; }

.panel {
  position: absolute; display: flex; flex-direction: column; overflow: hidden;
  pointer-events: auto; background: var(--paper); color: var(--ink);
  border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);
  opacity: 0; transform: translateY(8px) scale(.98); transform-origin: bottom right;
  transition: opacity .18s ease, transform .24s cubic-bezier(.2,.9,.3,1.05);
}
.panel[data-open="true"] { opacity: 1; transform: translateY(0) scale(1); }
.panel[data-open="false"] { pointer-events: none; }

/* ── Header ─────────────────────────────────────────────────────────────── */
.bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-bottom: 1px solid var(--line);
  cursor: grab; user-select: none; touch-action: none; flex: 0 0 auto;
}
.bar:active { cursor: grabbing; }
.bar-pet { width: 28px; height: 28px; flex: 0 0 28px; }
.bar-pet svg { width: 100%; height: 100%; display: block; }
.bar-text { flex: 1; min-width: 0; }
.bar-name { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.2;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-sub { font-size: 11px; color: var(--faint); line-height: 1.3; display: flex;
           align-items: center; gap: 5px; }
.bar-sub::before { content: ""; width: 6px; height: 6px; border-radius: 50%;
                   background: #2E9E5B; flex: 0 0 6px; }
.bar-actions { display: flex; gap: 2px; }
.icon-btn {
  width: 26px; height: 26px; display: grid; place-items: center; cursor: pointer;
  border: 0; background: none; color: var(--faint); border-radius: 6px; padding: 0;
}
.icon-btn:hover { background: var(--surface); color: var(--ink); }
.icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dots { display: flex; gap: 7px; }
.dot { width: 12px; height: 12px; border-radius: 50%; border: 0; padding: 0;
       cursor: pointer; position: relative; }
.dot::before { content: ""; position: absolute; inset: -8px; }
.dot:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Log ────────────────────────────────────────────────────────────────── */
.log { flex: 1; overflow-y: auto; padding: var(--pad); display: flex;
       flex-direction: column; gap: var(--gap); touch-action: pan-y;
       scrollbar-width: thin; }
.row { display: flex; gap: 8px; align-items: flex-end; }
.row.me { flex-direction: row-reverse; }
.avatar { width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%;
          background: var(--surface); display: grid; place-items: center;
          overflow: hidden; color: var(--faint); align-self: flex-end; }
.avatar svg { width: 20px; height: 20px; }
.row.me .avatar { display: none; }

.bubble {
  max-width: 84%; padding: 9px 12px; font-size: 14px; line-height: 1.5;
  border-radius: var(--bubble); color: var(--muted);
  animation: rise .22s cubic-bezier(.2,.9,.3,1) both;
}
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.b-bordered .bubble { background: var(--surface); border: 1px solid var(--line); }
.b-filled   .bubble { background: var(--surface); border: 0; }
.b-minimal  .bubble { background: none; border: 0; padding: 2px 0; max-width: 100%; }
.row.me .bubble { background: var(--accent); color: var(--on-accent);
                  border-color: transparent; white-space: pre-wrap;
                  border-bottom-right-radius: 4px; }
.b-minimal .row.me .bubble { background: var(--accent); padding: 9px 12px; }
.row:not(.me) .bubble { border-bottom-left-radius: 4px; }

.bubble p { margin: 0 0 6px; } .bubble p:last-child { margin-bottom: 0; }
.bubble .h2 { font-weight: 600; color: var(--ink); margin-top: 8px; font-size: 14px; }
.bubble .h3 { font-weight: 600; color: var(--ink); font-size: 13px; margin-top: 6px; }
.bubble strong { color: var(--ink); font-weight: 600; }
.bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
               font-size: .86em; background: var(--paper); padding: 1px 5px; border-radius: 4px; }
.bubble ul, .bubble ol { margin: 5px 0; padding-left: 18px; }
.bubble li { margin: 2px 0; }
.bubble table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12.5px; }
.bubble th, .bubble td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--line); }
.bubble th { font-weight: 600; color: var(--ink); font-size: 11px; text-transform: uppercase;
             letter-spacing: .04em; }
.bubble td { font-variant-numeric: tabular-nums; }
.bubble tr:last-child td { border-bottom: 0; }

.cite { font-size: 9.5px; color: var(--accent); font-weight: 600;
        vertical-align: super; margin-left: 2px; }

.typing { display: inline-flex; gap: 4px; padding: 4px 0; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--faint);
            display: block; animation: bounce 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%,60%,100% { opacity:.3; transform: translateY(0) } 30% { opacity:1; transform: translateY(-3px) } }

/* ── Chips ──────────────────────────────────────────────────────────────── */
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 32px; }
.chip {
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink);
  padding: 7px 11px; border-radius: 999px; line-height: 1.3;
  transition: background .14s ease, border-color .14s ease, transform .14s ease;
}
.chip:hover { background: var(--surface); border-color: var(--accent); transform: translateY(-1px); }
.chip:active { transform: none; }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.chip[disabled] { opacity: .5; cursor: default; transform: none; }
.chip.action { border-color: var(--accent); color: var(--accent); font-weight: 500;
               text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }

/* ── Feedback ───────────────────────────────────────────────────────────── */
.feedback { display: flex; gap: 2px; padding-left: 32px; margin-top: -4px; }
.feedback button {
  border: 0; background: none; cursor: pointer; padding: 3px 5px; border-radius: 5px;
  color: var(--faint); display: grid; place-items: center;
}
.feedback button:hover { background: var(--surface); color: var(--ink); }
.feedback button[data-picked="true"] { color: var(--accent); }
.feedback button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.feedback svg { width: 13px; height: 13px; }

/* ── Composer ───────────────────────────────────────────────────────────── */
.composer { border-top: 1px solid var(--line); padding: 10px; flex: 0 0 auto; }
.field {
  display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--line-strong);
  background: var(--surface); padding: 6px 6px 6px 12px; border-radius: 999px;
  transition: border-color .14s ease;
}
.field:focus-within { border-color: var(--accent); }
textarea {
  flex: 1; resize: none; border: 0; background: none; color: var(--ink);
  font: inherit; font-size: 16px; line-height: 1.45; max-height: 96px; outline: none;
  padding: 5px 0;
}
@media (min-width: 640px) { textarea { font-size: 14px; } }
textarea::placeholder { color: var(--faint); }
.send {
  width: 32px; height: 32px; flex: 0 0 32px; border: 0; cursor: pointer;
  background: var(--accent); color: var(--on-accent); display: grid;
  place-items: center; border-radius: 50%;
  transition: opacity .14s ease, transform .14s ease;
}
.send:hover:not([disabled]) { transform: scale(1.06); }
.send[disabled] { opacity: .35; cursor: default; }
.send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.foot { font-size: 10.5px; color: var(--faint); text-align: center; margin: 7px 0 0; }
.err { border-left: 2px solid #C0392B; background: var(--surface); padding: 8px 11px;
       font-size: 13px; color: var(--ink); border-radius: 6px; }

@media (prefers-reduced-motion: reduce) {
  .launcher, .panel, .bubble, .chip, .send { transition: none; animation: none; }
  .typing i { animation: none; opacity: .6; }
}`;
}
