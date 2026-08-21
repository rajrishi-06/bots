"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Two ways in, and they behave differently on purpose.
 *
 * A snippet indexes inline and the page refreshes with it live — an owner
 * pasting a corrected answer is fixing something now. A crawl is queued, because
 * fifty pages takes minutes and no HTTP request should be held open for that.
 */
export function IngestForm({ botId }: { botId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"snippet" | "crawl">("snippet");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const payload = tab === "snippet" ? { kind: "snippet", title, text } : { kind: "crawl", url };
      const res = await fetch(`/api/bots/${botId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { chunks?: number; queued?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed.");
      setNote({
        tone: "ok",
        text: body.queued ? "Queued — the worker will index it." : `Indexed as ${body.chunks} chunk(s).`,
      });
      setTitle("");
      setText("");
      setUrl("");
      router.refresh();
    } catch (err) {
      setNote({ tone: "err", text: err instanceof Error ? err.message : "Failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ingest">
      <div className="switch">
        <button type="button" data-active={tab === "snippet"} onClick={() => setTab("snippet")}>
          Paste an answer
        </button>
        <button type="button" data-active={tab === "crawl"} onClick={() => setTab("crawl")}>
          Crawl a site
        </button>
      </div>

      {tab === "snippet" ? (
        <>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Refund policy" aria-label="Title"
          />
          <textarea
            rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="EU customers may request a refund within 14 days of purchase."
            aria-label="Answer"
          />
        </>
      ) : (
        <input
          type="text" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.example.com/" aria-label="URL"
        />
      )}

      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Working" : tab === "snippet" ? "Index now" : "Queue crawl"}
        </button>
        {note && <span className={`status ${note.tone}`}>{note.text}</span>}
      </div>

      <style jsx>{`
        .ingest { display: flex; flex-direction: column; gap: 8px; margin-bottom: 28px; }
        .switch { display: flex; gap: 8px; margin-bottom: 4px; }
        .switch button {
          background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer;
          font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.14em;
          text-transform: uppercase; color: var(--faint); padding: 4px 0; margin-right: 12px;
        }
        .switch button[data-active="true"] { color: var(--ink); border-bottom-color: var(--ink); }
        .row { display: flex; align-items: center; gap: 12px; }
      `}</style>
    </form>
  );
}
