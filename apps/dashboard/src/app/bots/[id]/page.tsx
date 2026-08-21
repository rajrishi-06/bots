import { Section } from "@/components/Shell";
import { getBot } from "@/lib/data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  const rows: [string, string][] = [
    ["documents", String(bot.documents)],
    ["chunks", String(bot.chunks)],
    ["active pet", bot.activePetName ?? "none"],
    ["grounding", bot.groundingMode],
    ["gate threshold", bot.gateThreshold.toFixed(2)],
    ["allowed origins", bot.allowedOrigins.length ? bot.allowedOrigins.join(", ") : "any (unrestricted)"],
  ];

  return (
    <Section n="01" label="Overview" title="Characteristics">
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="u-label" style={{ width: 200 }}>{k}</td>
              <td className="u-data">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 28 }}>Persona</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9375rem" }}>
        {bot.systemPrompt || <span className="empty-note">No persona set.</span>}
      </p>

      <h2 style={{ marginTop: 20 }}>Fallback</h2>
      <p className="u-data" style={{ color: "var(--muted)" }}>{bot.fallbackMessage}</p>
    </Section>
  );
}
