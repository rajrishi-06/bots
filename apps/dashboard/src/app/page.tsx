import Link from "next/link";
import { CreateBot } from "@/components/CreateBot";
import { Card, Shell } from "@/components/Shell";
import { listBots } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const bots = await listBots();

  return (
    <Shell crumbs={<strong>All bots</strong>} actions={<CreateBot />}>
      <Card
        title="Bots"
        description={bots.length === 1 ? "1 bot" : `${bots.length} bots`}
        flush
      >
        {bots.length === 0 ? (
          <div className="empty">
            <strong>No bots yet</strong>
            Create one, design a pet, and feed it some documents.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pet</th>
                  <th>Grounding</th>
                  <th>Embed</th>
                  <th className="num">Docs</th>
                  <th className="num">Chunks</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/bots/${b.id}`} className="row-link">
                        {b.name}
                      </Link>
                      <div className="mono" style={{ color: "var(--fg-lighter)", fontSize: 12 }}>
                        {b.publicKey}
                      </div>
                    </td>
                    <td className="muted">{b.activePetName ?? "—"}</td>
                    <td>
                      {/* A bot outside strict wears a permanent badge — leaving
                          strict has cost and liability consequences the owner
                          accepted, and they should keep seeing that. */}
                      <span className={`badge ${b.groundingMode === "strict" ? "ok" : "warn"}`}>
                        {b.groundingMode}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${b.allowedOrigins.length === 0 ? "warn" : "ok"}`}>
                        {b.allowedOrigins.length === 0
                          ? "any origin"
                          : `${b.allowedOrigins.length} allowed`}
                      </span>
                    </td>
                    <td className="num">{b.documents}</td>
                    <td className="num">{b.chunks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
