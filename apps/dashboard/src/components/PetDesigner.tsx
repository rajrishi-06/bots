"use client";

import type { PetSpec } from "@bots/core/pet";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LivePet } from "./LivePet";

/**
 * Prompt → spec → live preview → save.
 *
 * The preview is a real running rig, not a picture of one, so what you approve
 * is exactly what a visitor gets. Generation does not save: re-rolling a pet you
 * do not like should not leave it in the collection.
 */
export function PetDesigner({ botId }: { botId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [spec, setSpec] = useState<PetSpec | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch(`/api/bots/${botId}/pets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json()) as { spec?: PetSpec; attempts?: number; error?: string };
      if (!res.ok || !body.spec) throw new Error(body.error ?? "Generation failed.");
      setSpec(body.spec);
      setAttempts(body.attempts ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!spec || busy) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/bots/${botId}/pets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, name: spec.name }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Save failed.");
      setSpec(null);
      setPrompt("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="designer">
      <form onSubmit={generate} className="ask">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="a sleepy lavender axolotl"
          aria-label="Describe a pet"
        />
        <button className="btn primary" disabled={busy !== null || !prompt.trim()}>
          {busy === "generate" ? "Designing" : "Design"}
        </button>
      </form>

      {error && <p className="status err">{error}</p>}

      {spec && (
        <div className="preview">
          <LivePet spec={spec} gaze />
          <div className="meta">
            <div className="u-data name">{spec.name}</div>
            <div className="u-label">{spec.skeleton} · {Object.values(spec.parts).join(" / ")}</div>
            <div className="swatch">
              {Object.entries(spec.palette).map(([k, c]) => (
                <i key={k} style={{ background: c }} title={`${k} ${c}`} />
              ))}
            </div>
            <p className="blurb">{spec.personality.blurb}</p>
            <p className="u-label">
              energy {spec.personality.energy} · curiosity {spec.personality.curiosity}
              {attempts > 1 && ` · ${attempts} attempts to pass the contrast gate`}
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setSpec(null)} disabled={busy !== null}>
                Discard
              </button>
              <button className="btn primary" onClick={() => void save()} disabled={busy !== null}>
                {busy === "save" ? "Saving" : "Add to collection"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .designer { margin-bottom: 28px; }
        .ask { display: flex; gap: 8px; margin-bottom: 12px; }
        .ask input { flex: 1; }
        .preview {
          display: flex; gap: 24px; align-items: flex-start;
          border: 1px solid var(--line); padding: 20px; background: var(--surface);
        }
        .preview :global(svg) { width: 140px; height: 140px; flex: 0 0 140px; }
        .meta { min-width: 0; }
        .name { font-size: 1rem; color: var(--ink); margin-bottom: 2px; }
        .swatch { display: flex; gap: 2px; margin: 10px 0; }
        .swatch i { width: 22px; height: 8px; display: block; }
        .blurb { font-size: 0.875rem; color: var(--muted); margin: 0 0 8px; }
        .actions { display: flex; gap: 8px; margin-top: 14px; }
      `}</style>
    </div>
  );
}
