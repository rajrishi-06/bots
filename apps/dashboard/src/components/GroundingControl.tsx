"use client";

// Subpath, not the barrel: `@bots/core` re-exports the models module, which
// imports the Gemini SDK. In a CLIENT component that drags the whole SDK into
// the browser bundle — 41.8 kB for what is three buttons.
import { GROUNDING_MODE_INFO, GROUNDING_MODES, type GroundingMode } from "@bots/core/rag";
import { useState } from "react";

/**
 * Grounding mode, and the acknowledgement that leaving strict requires.
 *
 * The warning is a product feature, not fine print. Leaving strict opens an
 * interactive LLM on a public page: anyone who finds the embed can use it as a
 * free general assistant on the owner's token budget, and anything it invents
 * still carries their branding.
 *
 * So this is a blocking confirm naming both risks, the acknowledgement is
 * PERSISTED with who accepted it, and a bot outside strict wears a permanent
 * badge in the bot list. Not a dismissible toast.
 */
export function GroundingControl({
  botId, mode, acknowledgedAt,
}: { botId: string; mode: GroundingMode; acknowledgedAt: string | null }) {
  const [current, setCurrent] = useState<GroundingMode>(mode);
  const [pending, setPending] = useState<GroundingMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = GROUNDING_MODE_INFO[current];

  async function commit(next: GroundingMode) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bots/${botId}/grounding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next, acknowledged: GROUNDING_MODE_INFO[next].risks.length > 0 }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to save.");
      setCurrent(next);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="modes">
        {GROUNDING_MODES.map((m) => {
          const i = GROUNDING_MODE_INFO[m];
          const active = current === m;
          return (
            <button
              key={m}
              className="mode"
              data-active={active}
              onClick={() => {
                if (active) return;
                // Strict needs no acknowledgement — you are tightening, not loosening.
                if (i.risks.length === 0) void commit(m);
                else setPending(m);
              }}
            >
              <span className="label">{m}</span>
              <span className="label">{i.label}</span>
              <span className="gate">{i.gate}</span>
            </button>
          );
        })}
      </div>

      {current !== "strict" && (
        <p className="mono ack">
          <span className="badge warn">{current}</span>{" "}
          {acknowledgedAt ? (
            <span style={{ color: "var(--fg-lighter)" }}>
              risks acknowledged {new Date(acknowledgedAt).toLocaleDateString()}
            </span>
          ) : (
            <span className="badge err">not acknowledged</span>
          )}
        </p>
      )}

      {error && <p className="badge err">{error}</p>}

      {pending && (
        <div className="scrim" role="alertdialog" aria-label={`Confirm ${pending} mode`}>
          <div className="dialog">
            <span className="label">Leaving strict mode</span>
            <h3>{GROUNDING_MODE_INFO[pending].label}</h3>
            <ul>
              {GROUNDING_MODE_INFO[pending].risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mono note">
              Your acceptance is recorded against your account.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setPending(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void commit(pending)} disabled={saving}>
                {saving ? "Saving" : "I accept these risks"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modes { display: grid; gap: 1px; background: var(--border); border: 1px solid var(--border); }
        .mode {
          background: var(--bg); border: 0; text-align: left; cursor: pointer;
          padding: 14px 16px; display: flex; flex-direction: column; gap: 4px;
          border-left: 2px solid transparent;
        }
        .mode:hover { background: var(--surface); }
        .mode[data-active="true"] { background: var(--surface); border-left-color: var(--fg); }
        .label { font-size: 0.9375rem; color: var(--fg); }
        .gate { font-size: 0.8125rem; color: var(--fg-lighter); }
        .ack { margin: 14px 0 0; }
        .scrim {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
          display: grid; place-items: center; padding: 24px; z-index: 50;
        }
        .dialog {
          background: var(--bg); border: 1px solid var(--border-strong);
          padding: 24px; max-width: 460px; width: 100%;
        }
        .dialog h3 { font-family: var(--sans); font-size: 1.125rem; margin: 6px 0 12px; font-weight: 600; }
        .dialog ul { margin: 0 0 14px; padding-left: 18px; }
        .dialog li { font-size: 0.875rem; color: var(--fg-light); margin-bottom: 8px; line-height: 1.5; }
        .note { color: var(--fg-lighter); margin: 0 0 18px; }
        .actions { display: flex; gap: 8px; justify-content: flex-end; }
      `}</style>
    </div>
  );
}
