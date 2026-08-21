"use client";

import type { RetrievalTrace } from "@bots/rag";
import { useState } from "react";
import { RetrievalPanel, type DebugChunk } from "./RetrievalPanel";

interface Result {
  trace: RetrievalTrace;
  chunks: DebugChunk[];
}

export function Playground({
  botId, threshold, mode,
}: { botId: string; threshold: number; mode: string }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, query }),
      });
      const body = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={run} className="ask">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="How long do EU customers have to request a refund?"
          aria-label="Question"
        />
        <button className="btn primary" disabled={busy || !query.trim()}>
          {busy ? "Retrieving" : "Retrieve"}
        </button>
      </form>

      <p className="u-data hint">
        grounding <strong>{mode}</strong> · gate threshold <strong>{threshold.toFixed(2)}</strong>
        {mode === "strict" && " · a query under the line returns the fallback and never reaches the model"}
      </p>

      {error && <p className="status err" style={{ margin: "16px 0" }}>{error}</p>}

      {result && (
        <RetrievalPanel trace={result.trace} chunks={result.chunks} threshold={threshold} />
      )}

      <style jsx>{`
        .ask { display: flex; gap: 8px; margin-bottom: 8px; }
        .ask input { flex: 1; }
        .hint { color: var(--faint); margin: 0 0 24px; }
        .hint strong { color: var(--ink); font-weight: 500; }
      `}</style>
    </div>
  );
}
