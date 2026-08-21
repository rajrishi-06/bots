import { scanChunkForInjection, type ModelProvider } from "@bots/core";
import type { Sql } from "postgres";
import { chunkMarkdown, embeddableText, type Chunk, type ChunkOptions } from "./chunk.js";

/**
 * parse → chunk → contextualise → embed → index.
 *
 * Runs inside the worker, one document at a time. Idempotent by document id:
 * re-ingesting deletes the previous chunks in the same transaction that writes
 * the new ones, so a re-upload swaps versions atomically instead of leaving a
 * half-updated corpus that retrieval would happily serve from.
 */

/** Chunks contextualised per model call. Batched rather than one call each —
 *  a 400-chunk document is 400 round trips otherwise, which dominates ingest
 *  wall-clock and cost for no quality gain. */
const CONTEXT_BATCH = 20;
/** Passages per embedding request. Matches the provider's own batch ceiling. */
const EMBED_BATCH = 100;

export interface IngestInput {
  sql: Sql;
  provider: ModelProvider;
  botId: string;
  documentId: string;
  /** Document text, already converted to markdown by the parser. */
  markdown: string;
  /** Shown to the model as the document's identity when writing context lines. */
  title: string;
  /** Contextual retrieval. Off makes ingest much cheaper and retrieval worse. */
  contextualize?: boolean;
  chunkOptions?: ChunkOptions;
  signal?: AbortSignal;
}

export interface IngestResult {
  chunkCount: number;
  /** Chunks whose text tripped the injection scan. Indexed anyway — see below. */
  flaggedCount: number;
  contextualized: boolean;
}

/**
 * Write one sentence per chunk situating it in its parent document.
 *
 * This is the "contextual retrieval" step, and it is a large, well-documented
 * recall win: a chunk reading "It takes 14 days." is unretrievable on its own,
 * but embeds usefully once prefixed with what "it" refers to. The sentence is
 * prepended before embedding ONLY — the reader never sees it.
 */
async function writeContexts(
  provider: ModelProvider,
  title: string,
  chunks: readonly Chunk[],
  signal?: AbortSignal,
): Promise<(string | null)[]> {
  const out = new Array<string | null>(chunks.length).fill(null);

  for (let i = 0; i < chunks.length; i += CONTEXT_BATCH) {
    const batch = chunks.slice(i, i + CONTEXT_BATCH);
    const rendered = batch
      .map((c, j) => `<chunk id="${j}" path="${c.headingPath}">\n${c.content.slice(0, 1500)}\n</chunk>`)
      .join("\n\n");

    try {
      const res = await provider.generateJson<{ contexts: { id: number; context: string }[] }>({
        system:
          "You situate excerpts within their parent document so they can be understood alone. " +
          "For EVERY chunk id, write ONE short sentence saying what part of the document it is " +
          "from and what it is about, resolving pronouns and vague references. Do not summarise " +
          "the content and do not add facts. Never omit an id.",
        prompt: `DOCUMENT: ${title}\n\n${rendered}`,
        schema: {
          type: "OBJECT",
          properties: {
            contexts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { id: { type: "INTEGER" }, context: { type: "STRING" } },
                required: ["id", "context"],
              },
            },
          },
          required: ["contexts"],
        },
        parse: (raw) => raw as { contexts: { id: number; context: string }[] },
        signal,
      });

      for (const c of res.contexts ?? []) {
        if (Number.isInteger(c.id) && c.id >= 0 && c.id < batch.length && c.context) {
          out[i + c.id] = c.context.trim();
        }
      }
    } catch (err) {
      // A failed context batch degrades retrieval for those chunks. It must not
      // fail the whole ingest — an indexed document without context lines is far
      // better than a document that never landed.
      console.warn(`[ingest] context batch ${i} failed, continuing without:`, err);
    }
  }
  return out;
}

export async function ingestDocument({
  sql,
  provider,
  botId,
  documentId,
  markdown,
  title,
  contextualize = true,
  chunkOptions,
  signal,
}: IngestInput): Promise<IngestResult> {
  const chunks = chunkMarkdown(markdown, chunkOptions);

  if (chunks.length === 0) {
    await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
    await sql`UPDATE documents SET status = 'indexed', chunk_count = 0, indexed_at = now() WHERE id = ${documentId}`;
    return { chunkCount: 0, flaggedCount: 0, contextualized: false };
  }

  await sql`UPDATE documents SET status = 'contextualizing' WHERE id = ${documentId}`;
  const contexts = contextualize
    ? await writeContexts(provider, title, chunks, signal)
    : new Array<string | null>(chunks.length).fill(null);

  await sql`UPDATE documents SET status = 'embedding' WHERE id = ${documentId}`;
  const texts = chunks.map((c, i) => embeddableText(c, contexts[i]));
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    vectors.push(...(await provider.embed(texts.slice(i, i + EMBED_BATCH), "document")));
  }
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedded ${vectors.length} vectors for ${chunks.length} chunks.`);
  }

  // An uploaded document is untrusted input. Flagged chunks are still indexed —
  // legitimate documentation discusses prompts and instructions often enough
  // that dropping them would lose real answers — but the owner gets to see it,
  // and the prompt-level defence in @bots/core is the second layer.
  const flags = chunks.map((c) => scanChunkForInjection(c.content).matched);

  await sql.begin(async (tx) => {
    // Same transaction as the insert: a re-upload never leaves the corpus in a
    // state where the old chunks are gone and the new ones have not landed.
    await tx`DELETE FROM chunks WHERE document_id = ${documentId}`;
    for (const [i, chunk] of chunks.entries()) {
      await tx`
        INSERT INTO chunks (bot_id, document_id, ordinal, heading_path, content, context, embedding, injection_flags)
        VALUES (
          ${botId}, ${documentId}, ${chunk.ordinal}, ${chunk.headingPath}, ${chunk.content},
          ${contexts[i] ?? null}, ${`[${vectors[i]!.join(",")}]`}::vector, ${flags[i]!}
        )`;
    }
    await tx`
      UPDATE documents
      SET status = 'indexed', chunk_count = ${chunks.length}, indexed_at = now(), error = NULL
      WHERE id = ${documentId}`;
  });

  return {
    chunkCount: chunks.length,
    flaggedCount: flags.filter((f) => f.length > 0).length,
    contextualized: contextualize,
  };
}
