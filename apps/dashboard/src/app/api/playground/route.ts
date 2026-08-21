import { GeminiProvider, GeminiReranker } from "@bots/core";
import { retrieve } from "@bots/rag";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

/**
 * The playground's retrieval call.
 *
 * Runs the SAME `retrieve()` the API serves from — a playground that used its
 * own query path would show you a pipeline nobody is actually running.
 */

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;

export async function POST(request: Request) {
  const { orgId } = await getSession();
  const { botId, query, history } = (await request.json()) as {
    botId?: string;
    query?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  if (!botId || !query?.trim()) {
    return NextResponse.json({ error: "botId and query are required." }, { status: 400 });
  }

  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });

  try {
    const result = await pool.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
      // Ownership is enforced by RLS, not by a WHERE clause here: an id from
      // another org simply returns no row.
      const bots = await tx<{ id: string; grounding_mode: "strict" | "blended" | "open"; gate_threshold: string }[]>`
        SELECT id, grounding_mode, gate_threshold FROM bots WHERE id = ${botId}`;
      const bot = bots[0];
      if (!bot) return null;

      await tx.unsafe(`SET LOCAL app.bot_id = '${bot.id}'`);
      return retrieve({
        sql: tx,
        provider: new GeminiProvider(),
        reranker: new GeminiReranker(),
        botId: bot.id,
        query: query.trim(),
        history: history ?? [],
        mode: bot.grounding_mode,
        threshold: Number(bot.gate_threshold),
      });
    });

    if (!result) return NextResponse.json({ error: "Unknown bot." }, { status: 404 });

    return NextResponse.json({
      trace: result.trace,
      chunks: result.chunks.map((c) => ({
        id: c.id,
        headingPath: c.headingPath,
        preview: c.content.slice(0, 400),
        score: c.score,
        fusedScore: c.fusedScore,
        ranks: c.ranks,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retrieval failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
