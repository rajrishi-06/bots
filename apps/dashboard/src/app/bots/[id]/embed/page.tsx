import { Card } from "@/components/Shell";
import { AppearanceEditor } from "@/components/AppearanceEditor";
import { EmbedSnippet } from "@/components/EmbedSnippet";
import { GroundingControl } from "@/components/GroundingControl";
import { getBot } from "@/lib/data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  const cdn = process.env.NEXT_PUBLIC_WIDGET_CDN ?? "https://cdn.petbot.dev";

  return (
    <>
      <Card title="One script tag" description="Paste this anywhere in the page.">
        <EmbedSnippet
          snippet={`<script src="${cdn}/petbot.js" data-bot-id="${bot.publicKey}"></script>`}
        />
        <p className="muted small" style={{ marginTop: 16 }}>
          The public key is an <strong>identifier, not a secret</strong> — it ships
          in the snippet and anyone can read it. What actually binds this bot to
          your site is the origin allowlist.
        </p>
      </Card>

      {/* Its own card rather than a heading inside the snippet card: this is the
          control that actually protects the bot, and burying it under a code
          block is how it stays unset until someone finds the embed on a
          competitor's site. */}
      <Card
        title="Allowed origins"
        description="The only thing stopping this bot being embedded elsewhere."
        actions={
          <span className={`badge ${bot.allowedOrigins.length === 0 ? "warn" : "ok"}`}>
            {bot.allowedOrigins.length === 0 ? "any origin" : `${bot.allowedOrigins.length} allowed`}
          </span>
        }
      >
        {bot.allowedOrigins.length === 0 ? (
          <p className="muted">
            Anyone can embed this bot on any site. Add your domains before launch.
          </p>
        ) : (
          <ul className="mono small" style={{ paddingLeft: 18, margin: 0 }}>
            {bot.allowedOrigins.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Appearance" description="How the widget looks on your site.">
        <AppearanceEditor
          botId={bot.id}
          initialAppearance={bot.appearance}
          initialActions={bot.actions}
        />
      </Card>

      <Card title="Grounding" description="What the bot is allowed to answer.">
        <GroundingControl
          botId={bot.id}
          mode={bot.groundingMode}
          acknowledgedAt={bot.groundingModeAckAt ? bot.groundingModeAckAt.toISOString() : null}
        />
      </Card>
    </>
  );
}
