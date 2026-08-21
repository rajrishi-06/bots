"use client";

import {
  PART_OPTIONS, REFERENCE_PET, SKELETONS, THEMES,
  describePaletteIssues, validatePetPalette,
  type PetPalette, type PetSpec, type Theme,
} from "@bots/core/pet";
import { PET_SLOTS, partThumbSvg, type PetSlot } from "@bots/pet-engine";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { LivePet } from "./LivePet";

/**
 * Direct-manipulation pet editor.
 *
 * The useful half of Figma, without the half that would be a security hole:
 * a canvas you click into, a layer list, and a properties panel for whatever is
 * selected. What it does NOT have is free-form vector editing, because the model
 * never emits raw SVG and neither should a user — a pet is a selection from a
 * vetted parts library, which is what makes it ~430 bytes and impossible to
 * render as script.
 *
 * Two things here that a generic design tool cannot do:
 *  - Option pickers show the REAL geometry for that slot, so you choose a shape
 *    rather than guess at the word "boxy".
 *  - The contrast gate runs on every keystroke, against both grounds, so an
 *    illegible palette is visible while you are making it rather than at save.
 */

type Selection =
  | { kind: "slot"; slot: PetSlot }
  | { kind: "theme" }
  | { kind: "skeleton" }
  | { kind: "palette" }
  | { kind: "personality" };

const PALETTE_KEYS = [
  ["shellHi", "Shell light"], ["shellLo", "Shell dark"],
  ["plateHi", "Plate light"], ["plateLo", "Plate dark"],
  ["visorHi", "Visor light"], ["visorLo", "Visor dark"],
  ["lit", "Lit"],
] as const;

/**
 * Undo/redo over whole specs.
 *
 * Snapshots, not reversible operations: a spec is ~430 bytes, so storing 100 of
 * them costs less than the code to invert every edit — and inverting a palette
 * change correctly is exactly the kind of thing that quietly gets it wrong.
 *
 * Stack and cursor live in ONE state object because they must move together.
 * Two setters can interleave, and a cursor pointing past a trimmed stack is an
 * undo that jumps to the wrong version.
 */
const HISTORY_LIMIT = 100;

function useHistory(initial: PetSpec) {
  const [{ stack, at }, setState] = useState<{ stack: PetSpec[]; at: number }>({
    stack: [initial],
    at: 0,
  });

  const push = useCallback((next: PetSpec) => {
    setState(({ stack: s, at: a }) => {
      // Editing after an undo forks: the redo tail is discarded.
      const grown = [...s.slice(0, a + 1), next];
      const overflow = Math.max(0, grown.length - HISTORY_LIMIT);
      return { stack: grown.slice(overflow), at: grown.length - 1 - overflow };
    });
  }, []);

  return {
    current: stack[at]!,
    push,
    undo: () => setState((v) => ({ ...v, at: Math.max(0, v.at - 1) })),
    redo: () => setState((v) => ({ ...v, at: Math.min(v.stack.length - 1, v.at + 1) })),
    canUndo: at > 0,
    canRedo: at < stack.length - 1,
  };
}

export function PetEditor({
  botId, initial, petId,
}: { botId: string; initial?: PetSpec; petId?: string }) {
  const router = useRouter();
  const history = useHistory(initial ?? REFERENCE_PET);
  const spec = history.current;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [ground, setGround] = useState<"light" | "dark">("light");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<PetSpec>) => history.push({ ...spec, ...patch });
  const setPart = (slot: PetSlot, value: string) =>
    set({ parts: { ...spec.parts, [slot]: value } });

  const verdict = useMemo(() => validatePetPalette(spec.palette), [spec.palette]);
  const selectedSlot = selection?.kind === "slot" ? selection.slot : null;

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch(`/api/bots/${botId}/pets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json()) as { spec?: PetSpec; error?: string };
      if (!res.ok || !body.spec) throw new Error(body.error ?? "Generation failed.");
      // Generation seeds the editor rather than replacing it wholesale — the
      // point of this screen is that AI gives you a starting point you then own.
      history.push(body.spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save(asNew: boolean) {
    if (busy) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/bots/${botId}/pets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, name: spec.name, petId: asNew ? undefined : petId }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Save failed.");
      router.push(`/bots/${botId}/pets`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="editor">
      <div className="ed-bar">
        <input
          className="ed-name" value={spec.name} aria-label="Pet name"
          onChange={(e) => set({ name: e.target.value.slice(0, 48) })}
        />
        <div className="ed-bar-right">
          {/* The server re-runs this gate and rejects a failing palette, so
              blocking here turns a 400 into feedback already on screen. */}
          {!verdict.ok && <span className="badge warn">palette not legible</span>}
          <button className="btn" onClick={history.undo} disabled={!history.canUndo}>Undo</button>
          <button className="btn" onClick={history.redo} disabled={!history.canRedo}>Redo</button>
          <button className="btn" onClick={() => save(true)} disabled={!!busy || !verdict.ok}>
            {petId ? "Save as new" : "Save"}
          </button>
          {petId && (
            <button className="btn primary" onClick={() => save(false)} disabled={!!busy || !verdict.ok}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      <div className="ed-body">
        {/* ── Layers ──────────────────────────────────────────────────── */}
        <aside className="ed-layers">
          <div className="nav-label">Design</div>
          <LayerRow label="Theme" value={spec.theme}
                    active={selection?.kind === "theme"} onClick={() => setSelection({ kind: "theme" })} />
          <LayerRow label="Skeleton" value={spec.skeleton}
                    active={selection?.kind === "skeleton"} onClick={() => setSelection({ kind: "skeleton" })} />

          <div className="nav-label">Parts</div>
          {PET_SLOTS.map((slot) => (
            <LayerRow
              key={slot}
              label={slot[0]!.toUpperCase() + slot.slice(1)}
              value={spec.parts[slot]}
              active={selectedSlot === slot}
              onClick={() => setSelection({ kind: "slot", slot })}
            />
          ))}

          <div className="nav-label">Style</div>
          <LayerRow label="Palette" value={verdict.ok ? "legible" : "check"} warn={!verdict.ok}
                    active={selection?.kind === "palette"} onClick={() => setSelection({ kind: "palette" })} />
          <LayerRow label="Personality" value={`e${spec.personality.energy.toFixed(1)}`}
                    active={selection?.kind === "personality"} onClick={() => setSelection({ kind: "personality" })} />
        </aside>

        {/* ── Canvas ──────────────────────────────────────────────────── */}
        <div className="ed-canvas" data-ground={ground}>
          <div className="ed-stage">
            {/* Clicking the background deselects, exactly as a canvas should. */}
            <LivePet
              spec={spec}
              gaze
              selection={selectedSlot}
              onPick={(slot) => setSelection(slot ? { kind: "slot", slot } : null)}
            />
          </div>
          <div className="ed-ground">
            {(["light", "dark"] as const).map((g) => (
              <button key={g} className="btn" data-on={ground === g} onClick={() => setGround(g)}>{g}</button>
            ))}
            <span className="muted small">
              {/* The pet ships onto pages we do not control; checking it against
                  both grounds is the point, not a nicety. */}
              the pet lands on pages you don&apos;t control
            </span>
          </div>
        </div>

        {/* ── Properties ──────────────────────────────────────────────── */}
        <aside className="ed-props">
          {selection === null && (
            <div className="ed-empty">
              <strong>Nothing selected</strong>
              Click a part of the pet, or pick a layer.
              <form className="ed-ask" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)}
                       placeholder="a sleepy lavender axolotl" aria-label="Describe a pet" />
                <button className="btn" disabled={!prompt.trim() || !!busy}>
                  {busy === "generate" ? "Designing…" : "Ask AI"}
                </button>
              </form>
            </div>
          )}

          {selection?.kind === "theme" && (
            <Group title="Theme" hint="Changes the silhouette. Parts you have chosen carry over.">
              <div className="ed-choices">
                {THEMES.map((t) => (
                  <button key={t} className="ed-choice" data-on={spec.theme === t}
                          onClick={() => set({ theme: t as Theme })}>
                    <Thumb theme={t as Theme} slot="head" option={spec.parts.head} palette={spec.palette} />
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            </Group>
          )}

          {selection?.kind === "skeleton" && (
            <Group title="Skeleton" hint="Proportions. Joints never move — that is what keeps a swap instant.">
              <div className="ed-choices wide">
                {SKELETONS.map((s) => (
                  <button key={s} className="ed-choice" data-on={spec.skeleton === s}
                          onClick={() => set({ skeleton: s })}>
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </Group>
          )}

          {selectedSlot && (
            <Group title={selectedSlot} hint="Click the pet to select a different part.">
              <div className="ed-choices">
                {PART_OPTIONS[selectedSlot].map((option) => (
                  <button key={option} className="ed-choice"
                          data-on={spec.parts[selectedSlot] === option}
                          onClick={() => setPart(selectedSlot, option)}>
                    {option === "none"
                      ? <span className="ed-none">none</span>
                      : <Thumb theme={spec.theme} slot={selectedSlot} option={option} palette={spec.palette} />}
                    <span>{option}</span>
                  </button>
                ))}
              </div>
            </Group>
          )}

          {selection?.kind === "palette" && (
            <Group title="Palette" hint="Checked against white and near-black as you type.">
              {PALETTE_KEYS.map(([key, label]) => (
                <label key={key} className="ed-swatch">
                  <input type="color" value={spec.palette[key]}
                         onChange={(e) => set({ palette: { ...spec.palette, [key]: e.target.value.toUpperCase() } })} />
                  <span>{label}</span>
                  <code className="mono small">{spec.palette[key]}</code>
                </label>
              ))}
              <div className={`ed-gate ${verdict.ok ? "ok" : "bad"}`}>
                {verdict.ok
                  ? "Legible on both light and dark pages."
                  : describePaletteIssues(verdict.issues)}
              </div>
            </Group>
          )}

          {selection?.kind === "personality" && (
            <Group title="Personality" hint="Wired to real behaviour — watch the pet, not the numbers.">
              <Slider label="Energy" value={spec.personality.energy}
                      hint="Breathing tempo and how stiffly it springs back."
                      onChange={(v) => set({ personality: { ...spec.personality, energy: v } })} />
              <Slider label="Curiosity" value={spec.personality.curiosity}
                      hint="How far the eyes travel to follow your cursor."
                      onChange={(v) => set({ personality: { ...spec.personality, curiosity: v } })} />
              <label className="ed-field">
                <span className="label">Blurb</span>
                <textarea rows={3} value={spec.personality.blurb} maxLength={160}
                          onChange={(e) => set({ personality: { ...spec.personality, blurb: e.target.value } })} />
              </label>
            </Group>
          )}

          {error && <p className="badge err">{error}</p>}
        </aside>
      </div>
    </div>
  );
}

function LayerRow({
  label, value, active, warn, onClick,
}: { label: string; value: string; active: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button className="ed-layer" data-on={active} onClick={onClick}>
      <span>{label}</span>
      <span className={warn ? "badge warn" : "muted small"}>{value}</span>
    </button>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="ed-group">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      {children}
    </div>
  );
}

/** A real part, not an icon of one. */
function Thumb({
  theme, slot, option, palette,
}: { theme: Theme; slot: PetSlot; option: string; palette: PetPalette }) {
  // Safe to inject: every string in here is either library geometry or a hex
  // colour the schema has already validated. Nothing user-authored reaches it.
  const html = useMemo(
    () => partThumbSvg(theme, slot, option, palette),
    [theme, slot, option, palette],
  );
  return <span className="ed-thumb" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Slider({
  label, value, hint, onChange,
}: { label: string; value: number; hint: string; onChange: (v: number) => void }) {
  return (
    <label className="ed-field">
      <span className="label">{label} <em className="mono">{value.toFixed(2)}</em></span>
      <input type="range" min={0} max={1} step={0.05} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
      <span className="muted small">{hint}</span>
    </label>
  );
}
