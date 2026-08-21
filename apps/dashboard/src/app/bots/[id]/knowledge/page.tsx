import { Card } from "@/components/Shell";
import { IngestForm } from "@/components/IngestForm";
import { listDocuments } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Real per-stage status. No shimmer — DESIGN.md forbids a fake loading state
 *  where a real fraction exists. */
const STAGES = ["queued", "parsing", "chunking", "contextualizing", "embedding", "indexed"] as const;

/** "" is the badge's neutral style, which is what a queued document deserves —
 *  it is not a warning, it just has not started. */
function tone(status: string): "ok" | "warn" | "err" | "" {
  if (status === "indexed") return "ok";
  if (status === "failed") return "err";
  if (status === "queued") return "";
  return "warn";
}

export default async function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docs = await listDocuments(id);
  const flagged = docs.reduce((n, d) => n + d.flagged, 0);

  return (
    <>
      <Card title="Add knowledge" description="Upload a file, crawl a site, or paste an answer.">
        <IngestForm botId={id} />
      </Card>

      <Card
        title="Documents"
        description={docs.length === 1 ? "1 document" : `${docs.length} documents`}
        actions={flagged > 0 ? <span className="badge warn">{flagged} flagged</span> : undefined}
        flush
      >
        {docs.length === 0 ? (
          <div className="empty">
            <strong>Nothing indexed yet</strong>
            Upload a file, crawl a site, or paste an answer above.
          </div>
        ) : (
          <div className="table-wrap">
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
                    <td className="muted small">{d.sourceUrl ?? d.sourceType}</td>
                    <td>
                      <span className={`badge ${tone(d.status)}`}>{d.status}</span>
                      {d.status !== "indexed" && d.status !== "failed" && (
                        <span className="muted small" style={{ marginLeft: 8 }}>
                          {STAGES.indexOf(d.status as (typeof STAGES)[number]) + 1}/{STAGES.length}
                        </span>
                      )}
                    </td>
                    <td className="num">{d.chunkCount || "—"}</td>
                    <td className="muted small">
                      {d.error ? (
                        <span className="badge err">{d.error.slice(0, 60)}</span>
                      ) : d.flagged > 0 ? (
                        // Flagged chunks are still indexed — documentation
                        // discusses prompts often enough that dropping them loses
                        // real answers. The owner gets to see the flag.
                        <span className="badge warn">{d.flagged} chunk(s) contain instructions</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
