"use client";

import type { Action, Appearance } from "@bots/core/widget/defaults";
import { useState } from "react";

/**
 * Widget appearance and quick actions.
 *
 * The choices are enumerated rather than free-form. Letting an owner ship CSS
 * into a shadow root they do not control is a support burden at best and a
 * defacement vector at worst, and the interesting variation is between a few
 * coherent looks, not in arbitrary overrides.
 */

const OPTIONS = {
  header: [
    ["branded", "Pet, name and status"],
    ["minimal", "Name only"],
    ["traffic", "macOS traffic lights"],
  ],
  corner: [["soft", "Soft"], ["round", "Round"], ["square", "Square"]],
  bubbles: [["bordered", "Bordered"], ["filled", "Filled"], ["minimal", "Minimal"]],
  density: [["comfortable", "Comfortable"], ["compact", "Compact"]],
} as const;

export function AppearanceEditor({
  botId, initialAppearance, initialActions,
}: { botId: string; initialAppearance: Appearance; initialActions: Action[] }) {
  const [a, setA] = useState<Appearance>(initialAppearance);
  const [actions, setActions] = useState<Action[]>(initialActions);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/bots/${botId}/appearance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: a, actions }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed.");
      setNote({ tone: "ok", text: "Saved — embedded widgets pick it up within 30 seconds." });
    } catch (err) {
      setNote({ tone: "err", text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setSaving(false);
    }
  }

  const addAction = () =>
    setActions((prev) =>
      prev.length >= 4
        ? prev
        : [...prev, { id: `a${Date.now().toString(36)}`, label: "", kind: "prompt", value: "" }],
    );

  return (
    <div>
      {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map((key) => (
        <div className="field" key={key}>
          <span className="u-label">{key}</span>
          <div className="choices">
            {OPTIONS[key].map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-active={a[key] === value}
                onClick={() => setA({ ...a, [key]: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="field">
        <span className="u-label">accent</span>
        <div className="choices">
          <button type="button" data-active={a.accent === "pet"} onClick={() => setA({ ...a, accent: "pet" })}>
            From the pet
          </button>
          <input
            type="color"
            aria-label="Custom accent"
            value={a.accent === "pet" ? "#5B5BD6" : a.accent}
            onChange={(e) => setA({ ...a, accent: e.target.value.toUpperCase() })}
          />
        </div>
      </div>

      <div className="field">
        <span className="u-label">launcher</span>
        <div className="choices">
          <input
            type="range" min={44} max={96} step={2} value={a.launcherSize}
            onChange={(e) => setA({ ...a, launcherSize: Number(e.target.value) })}
            style={{ width: 180 }}
          />
          <span className="u-data">{a.launcherSize}px</span>
        </div>
      </div>

      <div className="field">
        <span className="u-label">feedback</span>
        <div className="choices">
          <button type="button" data-active={a.feedback} onClick={() => setA({ ...a, feedback: true })}>
            Show thumbs
          </button>
          <button type="button" data-active={!a.feedback} onClick={() => setA({ ...a, feedback: false })}>
            Hide
          </button>
        </div>
      </div>

      <h2 style={{ marginTop: 28 }}>Quick actions</h2>
      <p className="u-data" style={{ color: "var(--faint)", margin: "0 0 12px" }}>
        Up to four, shown under the greeting. Links must be <strong style={{ color: "var(--ink)" }}>https</strong> —
        the widget renders these into a page you do not own.
      </p>

      {actions.map((action, i) => (
        <div className="action-row" key={action.id}>
          <select
            value={action.kind}
            onChange={(e) =>
              setActions(actions.map((x, j) => (j === i ? { ...x, kind: e.target.value as Action["kind"] } : x)))
            }
          >
            <option value="prompt">Ask</option>
            <option value="link">Link</option>
          </select>
          <input
            type="text" placeholder="Label" value={action.label}
            onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <input
            type="text"
            placeholder={action.kind === "link" ? "https://…" : "The question to ask"}
            value={action.value}
            onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button className="btn" onClick={() => setActions(actions.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button className="btn" onClick={addAction} disabled={actions.length >= 4}>
          Add action
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </button>
        {note && <span className={`status ${note.tone}`}>{note.text}</span>}
      </div>

      <style jsx>{`
        .field { display: flex; align-items: center; gap: 16px; padding: 10px 0;
                 border-bottom: 1px solid var(--line); }
        .field > :global(.u-label) { width: 96px; flex: 0 0 96px; }
        .choices { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .choices button {
          border: 1px solid var(--line); background: transparent; color: var(--muted);
          font-size: 0.8125rem; padding: 5px 11px; border-radius: 2px; cursor: pointer;
        }
        .choices button[data-active="true"] { border-color: var(--ink); color: var(--ink);
                                              background: var(--surface); }
        .choices input[type="color"] { width: 36px; height: 28px; padding: 0; border: 1px solid var(--line); }
        .action-row { display: grid; grid-template-columns: 90px 1fr 1.6fr auto; gap: 8px;
                      margin-bottom: 8px; align-items: center; }
      `}</style>
    </div>
  );
}
