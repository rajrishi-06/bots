import Link from "next/link";
import { CreateBot } from "@/components/CreateBot";
import { Section, Shell } from "@/components/Shell";
import { listBots } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const bots = await listBots();

  return (
    <Shell>
      <Section n="01" label="Bots" title="Your bots">
        <CreateBot />

        {bots.length === 0 ? (
          <p className="empty-note">
            No bots yet. Create one, design a pet, and feed it some documents.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Name</th>
                <th>Pet</th>
                <th>Grounding</th>
                <th className="num">Docs</th>
                <th className="num">Chunks</th>
                <th>Embed</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b, i) => (
                <tr key={b.id}>
                  <td className="num" style={{ color: "var(--faint)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <Link href={`/bots/${b.id}`} style={{ color: "var(--ink)" }}>
                      {b.name}
                    </Link>
                  </td>
                  <td className="u-data">{b.activePetName ?? "—"}</td>
                  <td>
                    {/* A bot outside strict mode carries a permanent badge, not
                        a dismissible toast — see DESIGN.md and the grounding
                        mode acknowledgement. */}
                    <span className={`status ${b.groundingMode === "strict" ? "ok" : "warn"}`}>
                      {b.groundingMode}
                    </span>
                  </td>
                  <td className="num">{b.documents}</td>
                  <td className="num">{b.chunks}</td>
                  <td>
                    <span className={`status ${b.allowedOrigins.length === 0 ? "warn" : "ok"}`}>
                      {b.allowedOrigins.length === 0 ? "any origin" : `${b.allowedOrigins.length} allowed`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}
