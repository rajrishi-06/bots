import type { PetPalette } from "@bots/core/pet";

/**
 * Shadow DOM stylesheet.
 *
 * Starts with `all: initial` on the host because this renders inside somebody
 * else's page. Shadow DOM stops the host's selectors reaching in, but INHERITED
 * properties (font, colour, line-height, letter-spacing) still cross the
 * boundary, and a host with `* { box-sizing: content-box }` or a 24px base font
 * will otherwise deform the panel.
 *
 * Colours derive from the active pet's palette rather than from a fixed theme:
 * the widget has to look deliberate on a page we have never seen, and the pet
 * is the only thing that carries colour anywhere in this product.
 */
export function stylesheet(palette: PetPalette): string {
  return `
:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --ink: ${palette.visorHi};
  --paper: #FFFFFF;
  --surface: #F4F5F7;
  --muted: #4A4F58;
  --faint: #6B7280;
  --line: rgba(0,0,0,0.14);
  --line-strong: rgba(0,0,0,0.28);
  --lit: ${palette.shellLo};
}
@media (prefers-color-scheme: dark) {
  :host {
    --ink: #EDEEEA; --paper: #14161A; --surface: #1C1F24;
    --muted: #B2B8BE; --faint: #8A9098;
    --line: rgba(255,255,255,0.14); --line-strong: rgba(255,255,255,0.28);
    --lit: ${palette.shellHi};
  }
}
*, *::before, *::after { box-sizing: border-box; }

.launcher-layer, .panel-layer {
  position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
}
.launcher {
  position: absolute; left: 0; top: 0; width: 64px; height: 64px;
  pointer-events: auto; cursor: grab; background: none; border: 0; padding: 0;
  touch-action: none; transition: opacity .22s cubic-bezier(.21,.47,.32,.98), transform .22s;
}
.launcher:active { cursor: grabbing; }
.launcher[data-open="true"] { opacity: 0; transform: scale(.85); pointer-events: none; }
.launcher:focus-visible { outline: 2px solid var(--lit); outline-offset: 4px; border-radius: 4px; }
.launcher svg { width: 64px; height: 64px; display: block; }

.panel {
  position: absolute; display: flex; flex-direction: column; overflow: hidden;
  pointer-events: auto; background: var(--paper); color: var(--ink);
  border: 1px solid var(--line-strong); border-radius: 2px;
  opacity: 0; transform: scale(.97); transition: opacity .26s cubic-bezier(.21,.47,.32,.98), transform .26s;
}
.panel[data-open="true"] { opacity: 1; transform: scale(1); }
.panel[data-open="false"] { pointer-events: none; }

.bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 9px 12px; border-bottom: 1px solid var(--line);
  cursor: grab; user-select: none; touch-action: none;
}
.bar:active { cursor: grabbing; }
.bar-title { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--faint); }
.bar-title svg { width: 20px; height: 20px; }
.dots { display: flex; gap: 7px; }
.dot { width: 12px; height: 12px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
       position: relative; }
.dot::before { content: ""; position: absolute; inset: -8px; }
.dot:focus-visible { outline: 2px solid var(--lit); outline-offset: 2px; }

.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px;
       touch-action: pan-y; }
.row { display: flex; gap: 9px; align-items: flex-start; }
.row.me { flex-direction: row-reverse; }
.avatar { width: 26px; height: 26px; flex: 0 0 26px; border: 1px solid var(--line);
          background: var(--surface); display: grid; place-items: center;
          overflow: hidden; color: var(--faint); }
.avatar svg { width: 20px; height: 20px; }
.bubble { max-width: 82%; padding: 8px 11px; font-size: 13.5px; line-height: 1.55;
          border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
.row.me .bubble { background: var(--ink); color: var(--paper); border-color: transparent;
                  white-space: pre-wrap; }
.bubble p { margin: 0 0 6px; } .bubble p:last-child { margin-bottom: 0; }
.bubble .h2 { font-weight: 600; color: var(--ink); margin-top: 8px; }
.bubble .h3 { font-weight: 600; color: var(--ink); font-size: 13px; margin-top: 6px; }
.bubble strong { color: var(--ink); font-weight: 600; }
.bubble code { font-family: ui-monospace, monospace; font-size: .85em; background: var(--paper);
               padding: 1px 4px; }
.bubble ul, .bubble ol { margin: 4px 0; padding-left: 18px; }
.bubble li { margin: 2px 0; }
.cite { font-size: 9px; color: var(--lit); font-family: ui-monospace, monospace;
        vertical-align: super; margin-left: 1px; }

.dots-typing { display: inline-flex; gap: 4px; padding: 3px 0; }
.dots-typing i { width: 5px; height: 5px; background: var(--faint); display: block;
                 animation: blink 1.2s infinite; }
.dots-typing i:nth-child(2) { animation-delay: .15s; }
.dots-typing i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%,80%,100% { opacity:.25 } 40% { opacity:1 } }

.starters { display: flex; flex-wrap: wrap; gap: 6px; }
.starter { font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
           border: 1px solid var(--line); background: var(--surface); color: var(--ink);
           padding: 6px 10px; border-radius: 2px; }
.starter:hover { border-color: var(--line-strong); }
.starter:focus-visible { outline: 2px solid var(--lit); outline-offset: 2px; }

.composer { border-top: 1px solid var(--line); padding: 10px; }
.field { display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--line);
         background: var(--surface); padding: 6px 8px; }
.field:focus-within { border-color: var(--line-strong); }
textarea { flex: 1; resize: none; border: 0; background: none; color: var(--ink);
           font: inherit; font-size: 16px; line-height: 1.4; max-height: 96px; outline: none; }
@media (min-width: 640px) { textarea { font-size: 13.5px; } }
textarea::placeholder { color: var(--faint); }
.send { width: 30px; height: 30px; flex: 0 0 30px; border: 0; cursor: pointer;
        background: var(--ink); color: var(--paper); display: grid; place-items: center;
        border-radius: 2px; }
.send[disabled] { opacity: .4; cursor: default; }
.send:focus-visible { outline: 2px solid var(--lit); outline-offset: 2px; }
.foot { font-size: 10px; color: var(--faint); text-align: center; margin: 6px 0 0;
        font-family: ui-monospace, monospace; letter-spacing: .06em; }
.err { border-left: 2px solid #B3261E; background: var(--surface); padding: 7px 10px;
       font-size: 12.5px; color: var(--ink); }

@media (prefers-reduced-motion: reduce) {
  .launcher, .panel { transition: none; }
  .dots-typing i { animation: none; opacity: .6; }
}`;
}
