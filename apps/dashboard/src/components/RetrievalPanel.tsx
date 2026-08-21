"use client";

import type { RetrievalTrace } from "@bots/rag";

/**
 * The retrieval debug panel — the signature screen.
 *
 * Drawn as an instrument readout, not a JSON dump. Three things make it earn
 * that description, and all three are the reason it exists:
 *
 *  1. PAIRED score bars. Pre-rerank and post-rerank sit on the same row, so the
 *     cross-encoder's reordering is something you WATCH rather than something
 *     the UI asserts. A single bar would show a ranking; two show a decision.
 *  2. The gate threshold is a DRAWN LINE across the score column. You can see a
 *     query fall under it, which is the difference between "the bot refused"
 *     and understanding why it refused.
 *  3. Every chunk carries its `heading_path`, because that is what makes a
 *     retrieved fragment legible at a glance.
 *
 * Bars are the only non-achromatic element on the screen and they are drawn in
 * ink, not in a hue — see the governing rule in DESIGN.md.
 */

export interface DebugChunk {
  id: string;
  headingPath: string;
  preview: string;
  score: number;
  fusedScore: number;
  ranks: (number | null)[];
}

export interface RetrievalPanelProps {
  trace: RetrievalTrace;
  chunks: DebugChunk[];
  threshold: number;
}

/** Rank labels, so "dense #1, bm25 absent" is readable rather than "[1,null]". */
function rankLabel(ranks: (number | null)[]): string {
  const names = ["dense", "bm25"];
  return ranks
    .map((r, i) => `${names[i] ?? `r${i}`} ${r === null ? "—" : `#${r}`}`)
    .join("  ");
}

export function RetrievalPanel({ trace, chunks, threshold }: RetrievalPanelProps) {
  // Fused scores are ~1/60-scale RRF values, so they are normalised against the
  // top hit purely so the two bars are visually comparable. The NUMBER shown is
  // always the real one — a normalised number presented as a score would be a lie.
  const topFused = chunks[0]?.fusedScore || 1;
  const gated = trace.gate.refuse;

  return (
    <div>
      <div className="readout">
        <Stat label="rewritten" value={trace.rewrittenQuery} wide />
        <Stat label="dense" value={String(trace.denseCount)} />
        <Stat label="bm25" value={String(trace.bm25Count)} />
        <Stat label="fused" value={String(trace.fusedCount)} />
        <Stat label="threshold" value={threshold.toFixed(2)} />
        <Stat
          label="gate"
          value={gated ? "REFUSED" : trace.gate.useContext ? "PASSED" : "UNAIDED"}
          tone={gated ? "err" : trace.gate.useContext ? "ok" : "warn"}
        />
      </div>

      <p className="reason u-data">{trace.gate.reason}</p>

      {chunks.length === 0 ? (
        <p className="empty u-data">Retrieval returned nothing for this query.</p>
      ) : (
        <div className="bars">
          {/* The threshold, drawn where it actually falls in the score column. */}
          <div className="threshold" style={{ left: `${threshold * 100}%` }} aria-hidden>
            <span className="u-label">gate {threshold.toFixed(2)}</span>
          </div>

          {chunks.map((c, i) => (
            <div className={`chunk${c.score < threshold ? " under" : ""}`} key={c.id}>
              <div className="head">
                <span className="u-data ord">{String(i + 1).padStart(2, "0")}</span>
                <span className="u-data path">{c.headingPath || "—"}</span>
                <span className="u-data ranks">{rankLabel(c.ranks)}</span>
              </div>

              <div className="track" title={`fused ${c.fusedScore.toFixed(4)} → reranked ${c.score.toFixed(3)}`}>
                <div className="bar fused" style={{ width: `${Math.min(100, (c.fusedScore / topFused) * 100)}%` }} />
                <div className="bar final" style={{ width: `${Math.min(100, c.score * 100)}%` }} />
              </div>

              <div className="scores u-data">
                <span className="pre">pre {c.fusedScore.toFixed(4)}</span>
                <span className="post">post {c.score.toFixed(3)}</span>
              </div>

              <p className="preview">{c.preview}</p>
            </div>
          ))}
        </div>
      )}

      <div className="timings u-data">
        {Object.entries(trace.timings).map(([stage, ms]) => (
          <span key={stage}>
            {stage} <strong>{ms}ms</strong>
          </span>
        ))}
      </div>

      <style jsx>{`
        .readout {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 1px;
          background: var(--line);
          border: 1px solid var(--line);
          margin-bottom: 12px;
        }
        .reason {
          color: var(--faint);
          margin: 0 0 20px;
        }
        .empty {
          color: var(--faint);
          padding: 20px 0;
        }
        .bars {
          position: relative;
          border-top: 1px solid var(--line-strong);
          padding-top: 16px;
        }
        /* The drawn gate line. Full height, so a chunk falling under it is a
           spatial fact rather than a number you have to compare. */
        .threshold {
          position: absolute;
          top: 0;
          bottom: 28px;
          width: 1px;
          background: var(--ink);
          z-index: 1;
          pointer-events: none;
        }
        .threshold span {
          position: absolute;
          top: -2px;
          left: 6px;
          white-space: nowrap;
          background: var(--bg);
          padding: 0 4px;
        }
        .chunk {
          padding: 14px 0;
          border-bottom: 1px solid var(--line);
        }
        .chunk.under { opacity: 0.55; }
        .head {
          display: flex;
          gap: 12px;
          align-items: baseline;
          margin-bottom: 6px;
        }
        .ord { color: var(--faint); }
        .path { color: var(--ink); flex: 1; }
        .ranks { color: var(--faint); font-size: 0.6875rem; }
        .track {
          position: relative;
          height: 14px;
          background: var(--surface);
        }
        .bar {
          position: absolute;
          left: 0;
          height: 6px;
        }
        /* Pre-rerank sits above post-rerank so the movement between them reads
           as a single gesture rather than two unrelated measurements. */
        .bar.fused {
          top: 0;
          background: rgba(var(--overlay), 0.28);
        }
        .bar.final {
          top: 8px;
          background: var(--ink);
        }
        .scores {
          display: flex;
          gap: 16px;
          margin-top: 4px;
          color: var(--faint);
          font-size: 0.6875rem;
        }
        .post { color: var(--ink); }
        .preview {
          margin: 8px 0 0;
          font-size: 0.8125rem;
          line-height: 1.55;
          color: var(--muted);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .timings {
          display: flex;
          flex-wrap: wrap;
          gap: 18px;
          margin-top: 16px;
          color: var(--faint);
        }
        .timings strong {
          color: var(--ink);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}

function Stat({
  label, value, tone, wide,
}: { label: string; value: string; tone?: "ok" | "warn" | "err"; wide?: boolean }) {
  return (
    <div className="stat" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="u-label">{label}</span>
      <span className={tone ? `u-data v ${tone}` : "u-data v"}>{value}</span>
      <style jsx>{`
        .stat {
          background: var(--bg);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .v {
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .v.ok { color: var(--ok); }
        .v.warn { color: var(--warn); }
        .v.err { color: var(--err); }
      `}</style>
    </div>
  );
}
