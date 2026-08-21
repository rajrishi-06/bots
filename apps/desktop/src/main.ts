import { REFERENCE_PET, type PetSpec } from "@bots/core/pet";
import { PetRig } from "@bots/pet-engine";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The desktop shell's pet window.
 *
 * The chat panel is `@bots/widget` in the other window — this file only owns
 * the creature and the one thing the browser build never has to solve: making a
 * transparent always-on-top window click-through everywhere except the pet.
 */

const HOST = document.getElementById("pet")!;
const API_BASE = import.meta.env.VITE_API_BASE ?? "https://api.petbot.dev";
const BOT_KEY = localStorage.getItem("petbot:botKey") ?? "";

const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
HOST.appendChild(svg);

let spec: PetSpec = REFERENCE_PET;
const rig = new PetRig(svg, spec, {
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  gaze: true,
});

/* ── Click-through ─────────────────────────────────────────────────────────
   The window is a 220×220 hole in the desktop and the pet occupies maybe 15%
   of it. Without this, every click in the surrounding empty space is swallowed
   instead of reaching the application underneath.

   `set_ignore_cursor_events` is per-window and all-or-nothing, so the decision
   has to be made here — only the frontend knows where the pet currently is. */
let overPet = false;

function updateHitRegion(x: number, y: number): void {
  const box = svg.getBoundingClientRect();
  // A circle rather than the bounding box: the pet is roughly round, and a
  // square hit region reclaims corners that visibly contain nothing.
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const inside = Math.hypot(x - cx, y - cy) < box.width * 0.45;
  if (inside === overPet) return;
  overPet = inside;
  void invoke("set_hit_region", { overPet: inside });
}

// Pointer events only arrive while the window is NOT ignoring them, so this
// alone cannot detect re-entry. A low-frequency poll of the real cursor covers
// the gap without a per-frame IPC round trip.
window.addEventListener("pointermove", (e) => {
  updateHitRegion(e.clientX, e.clientY);
  rig.setPointer(e.clientX, e.clientY);
});

/* ── Drag ───────────────────────────────────────────────────────────────── */
let dragging = false;
let last = { x: 0, y: 0, t: 0 };

svg.addEventListener("pointerdown", (e) => {
  dragging = true;
  svg.setPointerCapture(e.pointerId);
  last = { x: e.screenX, y: e.screenY, t: performance.now() };
  rig.setState({ dragging: true, pressed: true });
});

svg.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.screenX - last.x;
  const dy = e.screenY - last.y;
  const now = performance.now();
  const dt = Math.max(now - last.t, 8) / 1000;
  rig.setVelocity(dx / dt, dy / dt);
  void invoke("move_pet", { dx, dy });
  last = { x: e.screenX, y: e.screenY, t: now };
});

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  rig.setVelocity(0, 0);
  rig.setState({ dragging: false, pressed: false });
};
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
svg.addEventListener("pointerenter", () => rig.setState({ hovered: true }));
svg.addEventListener("pointerleave", () => rig.setState({ hovered: false }));

// Click opens the chat, unless it was the end of a drag.
svg.addEventListener("click", () => {
  if (!dragging) void invoke("toggle_chat");
});

/* ── Live config ───────────────────────────────────────────────────────────
   Same endpoint the embedded widget polls, so activating a different pet in the
   dashboard morphs the desktop buddy too — without a restart. */
async function syncPet(): Promise<void> {
  if (!BOT_KEY) return;
  try {
    const res = await fetch(`${API_BASE}/v1/bot/${encodeURIComponent(BOT_KEY)}/config`);
    if (!res.ok) return;
    const config = (await res.json()) as { pet: PetSpec };
    if (JSON.stringify(config.pet) === JSON.stringify(spec)) return;
    spec = config.pet;
    rig.setSpec(spec); // hot-swap under a running spring chain
  } catch {
    /* offline — keep the pet we have */
  }
}

void syncPet();
setInterval(() => void syncPet(), 60_000);

void getCurrentWindow().show();
