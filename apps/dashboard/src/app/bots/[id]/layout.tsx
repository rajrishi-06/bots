import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getBot } from "@/lib/data";
import { BotTabs } from "@/components/BotTabs";

export default async function BotLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <Shell>
      <div style={{ padding: "24px 0 0" }}>
        <div className="u-label">§ Bot</div>
        <h1>{bot.name}</h1>
        <p className="u-data" style={{ color: "var(--faint)", margin: "4px 0 20px" }}>
          {bot.publicKey}
          {bot.groundingMode !== "strict" && (
            <>
              {"  ·  "}
              <span className="status warn">
                {bot.groundingMode}
                {bot.groundingModeAckAt ? "" : " · UNACKNOWLEDGED"}
              </span>
            </>
          )}
        </p>
        <BotTabs id={id} />
      </div>
      {children}
    </Shell>
  );
}
