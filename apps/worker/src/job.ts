import { createHash } from "node:crypto";
import type { ModelProvider } from "@bots/core";
import { ingestDocument } from "@bots/rag";
import type { Sql } from "postgres";
import { crawl } from "./crawl.js";
import { UnsupportedType, parse } from "./parse.js";

/**
 * One ingest job.
 *
 * Job handling is separated from the SQS loop so it can be tested directly.
 * There is no queue interface with two implementations here — the loop is six
 * lines of polling and the work is all in `processJob`.
 */

export type Job =
  | { kind: "upload"; botId: string; documentId: string; s3Key: string }
  | { kind: "crawl"; botId: string; url: string; maxPages?: number; pathPrefix?: string }
  | { kind: "snippet"; botId: string; documentId: string; title: string; text: string };

export interface JobDeps {
  sql: Sql;
  provider: ModelProvider;
  /** Fetch an uploaded object. Injected so the pipeline is testable without S3. */
  getObject: (key: string) => Promise<{ body: Buffer; contentType: string }>;
  contextualize?: boolean;
}

export interface JobResult {
  documents: number;
  chunks: number;
}

const checksum = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Move a document to `failed` with the reason attached, for the dashboard. */
async function fail(sql: Sql, documentId: string, err: unknown): Promise<never> {
  const message = err instanceof Error ? err.message : String(err);
  await sql`UPDATE documents SET status = 'failed', error = ${message} WHERE id = ${documentId}`;
  throw err;
}

export async function processJob(job: Job, deps: JobDeps): Promise<JobResult> {
  const { sql, provider, contextualize = true } = deps;

  if (job.kind === "upload") {
    await sql`UPDATE documents SET status = 'parsing' WHERE id = ${job.documentId}`;
    try {
      const { body, contentType } = await deps.getObject(job.s3Key);
      const parsed = await parse(body, contentType, job.s3Key);
      if (parsed.title) {
        await sql`UPDATE documents SET title = ${parsed.title} WHERE id = ${job.documentId}`;
      }
      const res = await ingestDocument({
        sql, provider, botId: job.botId, documentId: job.documentId,
        markdown: parsed.markdown, title: parsed.title ?? job.s3Key, contextualize,
      });
      return { documents: 1, chunks: res.chunkCount };
    } catch (err) {
      // An unsupported type is the user's problem to see, not a retry loop's —
      // re-queueing a scanned PDF forever changes nothing.
      if (err instanceof UnsupportedType) {
        const message = err.message;
        await sql`UPDATE documents SET status = 'failed', error = ${message} WHERE id = ${job.documentId}`;
        return { documents: 0, chunks: 0 };
      }
      return fail(sql, job.documentId, err);
    }
  }

  if (job.kind === "snippet") {
    try {
      const res = await ingestDocument({
        sql, provider, botId: job.botId, documentId: job.documentId,
        markdown: `# ${job.title}\n\n${job.text}`, title: job.title,
        // Snippets are already self-contained — an owner writes one to patch a
        // wrong answer. Situating it in a parent document adds nothing.
        contextualize: false,
      });
      return { documents: 1, chunks: res.chunkCount };
    } catch (err) {
      return fail(sql, job.documentId, err);
    }
  }

  // Crawl: each page becomes its own document, so a re-crawl updates pages
  // individually and the dashboard can show which URL failed.
  const pages = await crawl(job.url, { maxPages: job.maxPages, pathPrefix: job.pathPrefix });
  let chunks = 0;
  let documents = 0;

  for (const page of pages) {
    const sum = checksum(page.markdown);
    // Content-addressed: a page whose text has not changed since the last crawl
    // is skipped entirely rather than re-embedded.
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM documents
      WHERE bot_id = ${job.botId} AND checksum = ${sum} AND status = 'indexed' LIMIT 1`;
    if (existing.length > 0) continue;

    const rows = await sql<{ id: string }[]>`
      INSERT INTO documents (bot_id, source_type, title, source_url, checksum)
      VALUES (${job.botId}, 'crawl', ${page.title}, ${page.url}, ${sum})
      ON CONFLICT (bot_id, checksum) DO UPDATE SET title = EXCLUDED.title
      RETURNING id`;
    const documentId = rows[0]!.id;

    try {
      const res = await ingestDocument({
        sql, provider, botId: job.botId, documentId,
        markdown: page.markdown, title: page.title, contextualize,
      });
      chunks += res.chunkCount;
      documents += 1;
    } catch (err) {
      // One bad page must not abandon the rest of the crawl.
      const message = err instanceof Error ? err.message : String(err);
      await sql`UPDATE documents SET status = 'failed', error = ${message} WHERE id = ${documentId}`;
    }
  }

  return { documents, chunks };
}
