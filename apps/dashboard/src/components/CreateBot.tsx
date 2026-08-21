"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateBot() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Could not create the bot.");
      // Straight into the new bot — creating one is never the goal, it is the
      // first step of designing a pet and feeding it something.
      router.push(`/bots/${body.id}/pets`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the bot.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="create">
      <input
        type="text" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Northwind Support" aria-label="Bot name"
      />
      <button className="btn primary" disabled={busy || !name.trim()}>
        {busy ? "Creating" : "Create bot"}
      </button>
      {error && <span className="badge err">{error}</span>}
      <style jsx>{`
        .create { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; }
        .create input { max-width: 280px; }
      `}</style>
    </form>
  );
}
