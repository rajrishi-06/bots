import { REFERENCE_PET, validatePetPalette, type PetSpec } from "@bots/core/pet";
import { PetRig } from "../src/rig.js";

/**
 * Twelve live rigs on one page — the gallery load case from the plan, and the
 * reason gradient ids are namespaced per instance.
 */

const spec = (
  name: string,
  skeleton: PetSpec["skeleton"],
  parts: PetSpec["parts"],
  palette: PetSpec["palette"],
  energy: number,
  curiosity: number,
  blurb: string,
): PetSpec => ({ v: 1, name, skeleton, parts, palette, personality: { energy, curiosity, blurb } });

const P = {
  // Generated live by gemini-3.1-flash-lite from the prompts in the comments.
  lavi: { shellHi: "#E6CCFF", shellLo: "#8A5CD6", plateHi: "#C4A0F0", plateLo: "#6B3FA8", visorHi: "#241040", visorLo: "#0D0518", lit: "#9BE8FF" },
  obsidian: { shellHi: "#8E93A8", shellLo: "#31344A", plateHi: "#5E6379", plateLo: "#22243440".slice(0, 7), visorHi: "#12131C", visorLo: "#07080C", lit: "#7FE6C4" },
  frog: { shellHi: "#C6F58A", shellLo: "#4E8C22", plateHi: "#9CD65C", plateLo: "#356316", visorHi: "#14240A", visorLo: "#080F04", lit: "#EAFF6B" },
  sand: { shellHi: "#EBD9B4", shellLo: "#A07F4C", plateHi: "#D2B885", plateLo: "#7A5C31", visorHi: "#2A1F10", visorLo: "#120C06", lit: "#FFD98A" },
  umbra: { shellHi: "#9A8FC4", shellLo: "#3B2F63", plateHi: "#6E5FA0", plateLo: "#291F47", visorHi: "#120C24", visorLo: "#07040F", lit: "#B98BFF" },
  ember: { shellHi: "#FFC7A3", shellLo: "#C4552A", plateHi: "#F0996B", plateLo: "#8E3A18", visorHi: "#2E1108", visorLo: "#150703", lit: "#FFB04D" },
  tide: { shellHi: "#A8E4F0", shellLo: "#2A7B96", plateHi: "#6FC4DC", plateLo: "#1B566B", visorHi: "#0C2733", visorLo: "#051318", lit: "#6BF0FF" },
  rose: { shellHi: "#FFC2D6", shellLo: "#B24A73", plateHi: "#F08CAF", plateLo: "#7E3050", visorHi: "#2E0F1C", visorLo: "#15060D", lit: "#FF8FB8" },
} as const;

const PETS: PetSpec[] = [
  { ...REFERENCE_PET, name: "Terminal" },
  spec("Lavi", "stout", { crown: "fin", head: "blob", torso: "egg", arms: "noodle", feet: "paws", face: "eyes" }, P.lavi, 0.1, 0.4, "Drifts through the digital currents."),
  spec("Obsidian", "balanced", { crown: "ears", head: "cat", torso: "capsule", arms: "noodle", feet: "paws", face: "eyes" }, P.obsidian, 0.7, 0.95, "Watches. Judges. Occasionally approves."),
  spec("AcidHop", "bigHead", { crown: "none", head: "blob", torso: "egg", arms: "noodle", feet: "paws", face: "goggles" }, P.frog, 0.95, 0.85, "Vibrating at all times."),
  spec("Sand-Sifter", "longBody", { crown: "horn", head: "boxy", torso: "boxy", arms: "stub", feet: "pads", face: "visor" }, P.sand, 0.35, 0.5, "Sun-warmed and unbothered."),
  spec("Umbra", "balanced", { crown: "horn", head: "blob", torso: "capsule", arms: "noodle", feet: "none", face: "eyes" }, P.umbra, 0.45, 0.7, "Made mostly of shadow and opinion."),
  spec("Ember", "stout", { crown: "fin", head: "round", torso: "egg", arms: "stub", feet: "pads", face: "goggles" }, P.ember, 0.8, 0.6, "Runs hot."),
  spec("Tide", "longBody", { crown: "fin", head: "blob", torso: "capsule", arms: "noodle", feet: "none", face: "visor" }, P.tide, 0.3, 0.8, "Moves like it is still underwater."),
  spec("Rosette", "bigHead", { crown: "ears", head: "cat", torso: "egg", arms: "stub", feet: "paws", face: "eyes" }, P.rose, 0.6, 1, "Extremely interested in you."),
  spec("Bolt", "balanced", { crown: "antenna", head: "boxy", torso: "boxy", arms: "stub", feet: "pads", face: "visor" }, P.tide, 1, 0.9, "Twitchy."),
  spec("Moss", "stout", { crown: "none", head: "round", torso: "egg", arms: "none", feet: "pads", face: "eyes" }, P.frog, 0.15, 0.3, "Has not moved in some time."),
  spec("Quill", "longBody", { crown: "horn", head: "cat", torso: "boxy", arms: "noodle", feet: "paws", face: "goggles" }, P.umbra, 0.55, 0.75, "Sharp about it."),
];

const grid = document.getElementById("grid")!;
const status = document.getElementById("status")!;
const rigs: PetRig[] = [];
let reduced = false;

function card(s: PetSpec) {
  const cell = document.createElement("div");
  cell.className = "cell";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cell.appendChild(svg);

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = s.name;

  const sw = document.createElement("div");
  sw.className = "swatch";
  for (const c of Object.values(s.palette)) {
    const i = document.createElement("i");
    i.style.background = c;
    sw.appendChild(i);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const gate = validatePetPalette(s.palette);
  meta.textContent = `${s.skeleton} · e${s.personality.energy} c${s.personality.curiosity}\n${gate.ok ? "gate ✓" : "gate ✗"}`;
  meta.style.whiteSpace = "pre";

  cell.append(name, sw, meta);
  grid.appendChild(cell);

  const rig = new PetRig(svg, s, { reducedMotion: reduced });
  rigs.push(rig);

  // Drag: feed real pointer velocity into the rig, exactly as the widget will.
  let dragging = false;
  let last = { x: 0, y: 0, t: 0 };
  cell.addEventListener("pointerdown", (e) => {
    dragging = true;
    cell.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    rig.setState({ dragging: true, pressed: true });
  });
  cell.addEventListener("pointermove", (e) => {
    if (dragging) {
      const now = performance.now();
      const dt = Math.max(now - last.t, 8) / 1000;
      rig.setVelocity((e.clientX - last.x) / dt, (e.clientY - last.y) / dt);
      last = { x: e.clientX, y: e.clientY, t: now };
    }
    rig.setPointer(e.clientX, e.clientY);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    rig.setVelocity(0, 0);
    rig.setState({ dragging: false, pressed: false });
  };
  cell.addEventListener("pointerup", stop);
  cell.addEventListener("pointercancel", stop);
  cell.addEventListener("pointerenter", () => rig.setState({ hovered: true }));
  cell.addEventListener("pointerleave", () => {
    rig.setState({ hovered: false });
    stop();
  });
  return rig;
}

PETS.forEach(card);

// Gaze works page-wide, so the pets watch the cursor even while still.
window.addEventListener("pointermove", (e) => {
  for (const r of rigs) r.setPointer(e.clientX, e.clientY);
}, { passive: true });

// The contrast gate, shown rather than asserted: same pets, white and near-black.
for (const [id, sub] of [["on-white", PETS.slice(0, 6)], ["on-black", PETS.slice(0, 6)]] as const) {
  const host = document.getElementById(id)!;
  for (const s of sub) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.appendChild(svg);
    rigs.push(new PetRig(svg, s, { gaze: false }));
  }
}

document.getElementById("swap")!.addEventListener("click", () => {
  // Hot-swap: geometry and palette change under a still-running spring chain.
  rigs.forEach((r, i) => r.setSpec(PETS[(i + 1) % PETS.length]!));
  status.textContent = "swapped — springs never stopped";
});

document.getElementById("shove")!.addEventListener("click", () => {
  for (const r of rigs) r.setVelocity(900, -200);
  setTimeout(() => rigs.forEach((r) => r.setVelocity(0, 0)), 120);
  status.textContent = "shoved — watch the crowns settle last";
});

document.getElementById("reduce")!.addEventListener("click", () => {
  reduced = !reduced;
  status.textContent = reduced ? "reduced motion ON" : "reduced motion off";
  location.hash = reduced ? "reduced" : "";
  location.reload();
});

if (location.hash === "#reduced") {
  reduced = true;
  status.textContent = "reduced motion ON";
}

status.textContent ||= `${rigs.length} live rigs`;
