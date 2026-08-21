import { Section } from "@/components/Shell";
import { Playground } from "@/components/Playground";
import { getBot } from "@/lib/data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <Section
      n="02"
      label="Playground"
      title="Ask, and watch the retrieval"
      aside={
        <p className="u-data" style={{ color: "var(--faint)", marginTop: 12 }}>
          Runs the same pipeline the embedded bot does.
        </p>
      }
    >
      <Playground botId={bot.id} threshold={bot.gateThreshold} mode={bot.groundingMode} />
    </Section>
  );
}
