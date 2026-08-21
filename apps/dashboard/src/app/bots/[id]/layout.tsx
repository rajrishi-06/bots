import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getBot } from "@/lib/data";

export default async function BotLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <Shell
      botId={id}
      crumbs={
        <>
          <Link href="/" className="muted">Bots</Link>
          <span className="sep">/</span>
          <strong>{bot.name}</strong>
          {bot.groundingMode !== "strict" && (
            <span className="badge warn" style={{ marginLeft: 4 }}>
              {bot.groundingMode}
              {bot.groundingModeAckAt ? "" : " · unacknowledged"}
            </span>
          )}
        </>
      }
    >
      {children}
    </Shell>
  );
}
