import { Card } from "@/components/Shell";
import { Playground } from "@/components/Playground";
import { getBot } from "@/lib/data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <Card
      title="Ask, and watch the retrieval"
      description="Runs the same pipeline the embedded bot does."
      flush
    >
      <Playground botId={bot.id} threshold={bot.gateThreshold} mode={bot.groundingMode} />
    </Card>
  );
}
