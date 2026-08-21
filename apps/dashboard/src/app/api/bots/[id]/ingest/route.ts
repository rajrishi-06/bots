import { GeminiProvider } from "@bots/core/models";
import { ingestDocument } from "@bots/rag";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

/**
 * Ingest from the studio.
 *
 * Snippets and pasted text run INLINE — they are one chunk and an owner pasting
 * a corrected answer expects it live immediately, not queued.
 *
 * Crawls and file uploads are queued to the worker instead: a fifty-page crawl
 * takes minutes and would hold an HTTP request open past every sane timeout.
 */

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;
function db(): postgres.Sql {
  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });
  return pool;
}

const checksum = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await getSession();
  const body = (await request.json()) as {
    kind?: "snippet" | "crawl";
    title?: string;
    text?: string;
    url?: string;
    maxPages?: number;
  };

  if (body.kind === "snippet") {
    if (!body.title?.trim() || !body.text?.trim()) {
      return NextResponse.json({ error: "Title and text are required." }, { status: 400 });
    }
    try {
      const result = await db().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
        await tx.unsafe(`SET LOCAL app.bot_id = '${id}'`);
        const rows = await tx<{ id: string }[]>`
          INSERT INTO documents (bot_id, source_type, title, checksum)
          VALUES (${id}, 'snippet', ${body.title!}, ${checksum(body.title! + body.text!)})
          ON CONFLICT (bot_id, checksum) DO UPDATE SET title = EXCLUDED.title
          RETURNING id`;
        return ingestDocument({
          sql: tx as unknown as postgres.Sql,
          provider: new GeminiProvider(),
          botId: id,
          documentId: rows[0]!.id,
          markdown: `# ${body.title}\n\n${body.text}`,
          title: body.title!,
          // A snippet is already self-contained — an owner writes one to patch a
          // wrong answer. Situating it in a parent document adds nothing.
          contextualize: false,
        });
      });
      return NextResponse.json({ chunks: result.chunkCount });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Ingest failed." },
        { status: 500 },
      );
    }
  }

  if (body.kind === "crawl") {
    if (!body.url?.trim()) return NextResponse.json({ error: "A URL is required." }, { status: 400 });
    try {
      new URL(body.url);
    } catch {
      return NextResponse.json({ error: "That is not a valid URL." }, { status: 400 });
    }

    const queueUrl = process.env.INGEST_QUEUE_URL;
    if (!queueUrl) {
      return NextResponse.json(
        { error: "No ingest queue configured. Set INGEST_QUEUE_URL and run the worker." },
        { status: 503 },
      );
    }

    // Imported lazily so the dashboard does not load the AWS SDK on every
    // request just to have it available for this one branch.
    const { SendMessageCommand, SQSClient } = await import("@aws-sdk/client-sqs");
    await new SQSClient({}).send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          kind: "crawl", botId: id, url: body.url, maxPages: body.maxPages,
        }),
      }),
    );
    return NextResponse.json({ queued: true });
  }

  return NextResponse.json({ error: "Unknown ingest kind." }, { status: 400 });
}
