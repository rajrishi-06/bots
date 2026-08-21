import { Section } from "@/components/Shell";
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
      <Section n="05" label="Embed" title="One script tag">
        <EmbedSnippet
          snippet={`<script src="${cdn}/petbot.js" data-bot-id="${bot.publicKey}"></script>`}
        />
        <p className="u-data" style={{ color: "var(--faint)", marginTop: 16 }}>
          The public key is an <strong style={{ color: "var(--ink)" }}>identifier, not a secret</strong> —
          it ships in the snippet and anyone can read it. What actually binds this
          bot to your site is the origin allowlist below.
        </p>

        <h2 style={{ marginTop: 28 }}>Allowed origins</h2>
        {bot.allowedOrigins.length === 0 ? (
          <p className="u-data">
            <span className="status warn">any origin</span>{" "}
            <span style={{ color: "var(--faint)" }}>
              — anyone can embed this bot on any site. Add your domains before launch.
            </span>
          </p>
        ) : (
          <ul className="u-data" style={{ paddingLeft: 18, color: "var(--muted)" }}>
            {bot.allowedOrigins.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section n="06" label="Appearance" title="How the widget looks">
        <AppearanceEditor
          botId={bot.id}
          initialAppearance={bot.appearance}
          initialActions={bot.actions}
        />
      </Section>

      <Section n="07" label="Grounding" title="What the bot is allowed to answer">
        <GroundingControl
          botId={bot.id}
          mode={bot.groundingMode}
          acknowledgedAt={bot.groundingModeAckAt ? bot.groundingModeAckAt.toISOString() : null}
        />
      </Section>
    </>
  );
}
