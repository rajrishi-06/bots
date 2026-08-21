import { Card } from "@/components/Shell";
import { getBot } from "@/lib/data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <>
      <div className="stat-row">
        <Stat label="Documents" value={String(bot.documents)} />
        <Stat label="Chunks" value={String(bot.chunks)} />
        <Stat label="Active pet" value={bot.activePetName ?? "none"} />
        <Stat label="Gate threshold" value={bot.gateThreshold.toFixed(2)} />
      </div>

      <Card title="Configuration" flush>
        <div className="table-wrap">
          <table>
            <tbody>
              <Row k="Public key" v={<span className="mono">{bot.publicKey}</span>} />
              <Row k="Grounding" v={<span className={`badge ${bot.groundingMode === "strict" ? "ok" : "warn"}`}>{bot.groundingMode}</span>} />
              <Row
                k="Allowed origins"
                v={
                  bot.allowedOrigins.length
                    ? bot.allowedOrigins.join(", ")
                    : <span className="badge warn">any origin</span>
                }
              />
              <Row k="Fallback" v={<span className="muted">{bot.fallbackMessage}</span>} />
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Persona" description="Prepended to every answer this bot gives.">
        <p className={bot.systemPrompt ? "" : "muted"}>
          {bot.systemPrompt || "No persona set."}
        </p>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <td className="label" style={{ width: 180 }}>{k}</td>
      <td>{v}</td>
    </tr>
  );
}
