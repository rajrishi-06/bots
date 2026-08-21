import { Section } from "@/components/Shell";
import { IngestForm } from "@/components/IngestForm";
import { listDocuments } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Real per-stage status. No shimmer — DESIGN.md forbids a fake loading state
 *  where a real fraction exists. */
const STAGES = ["queued", "parsing", "chunking", "contextualizing", "embedding", "indexed"] as const;

function tone(status: string): "ok" | "warn" | "err" | "idle" {
  if (status === "indexed") return "ok";
  if (status === "failed") return "err";
  if (status === "queued") return "idle";
  return "warn";
}

export default async function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docs = await listDocuments(id);
  const flagged = docs.reduce((n, d) => n + d.flagged, 0);

  return (
    <Section
      n="04"
      label="Knowledge"
      title="Documents"
      aside={
        flagged > 0 ? (
          <p className="u-data" style={{ marginTop: 12 }}>
            <span className="status warn">{flagged} flagged</span>
          </p>
        ) : undefined
      }
    >
      <IngestForm botId={id} />

      {docs.length === 0 ? (
        <p className="empty-note">
          Nothing indexed yet. Upload a file, crawl a site, or paste an answer.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Stage</th>
                <th className="num">Chunks</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td className="u-data" style={{ color: "var(--faint)" }}>
                    {d.sourceUrl ?? d.sourceType}
                  </td>
                  <td>
                    <span className={`status ${tone(d.status)}`}>{d.status}</span>
                    {d.status !== "indexed" && d.status !== "failed" && (
                      <span className="u-label" style={{ marginLeft: 8 }}>
                        {STAGES.indexOf(d.status as (typeof STAGES)[number]) + 1}/{STAGES.length}
                      </span>
                    )}
                  </td>
                  <td className="num">{d.chunkCount || "—"}</td>
                  <td className="u-data" style={{ color: "var(--faint)" }}>
                    {d.error ? (
                      <span className="status err">{d.error.slice(0, 60)}</span>
                    ) : d.flagged > 0 ? (
                      // Flagged chunks are still indexed — documentation
                      // discusses prompts often enough that dropping them loses
                      // real answers. The owner gets to see the flag.
                      <span className="status warn">{d.flagged} chunk(s) contain instructions</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
