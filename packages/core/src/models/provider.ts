/**
 * The vendor boundary.
 *
 * Every model call in the product goes through this file. Nothing else imports
 * a vendor SDK. That is the whole point: the retrieval stack is the part being
 * judged, and it must not be welded to whoever is cheapest this quarter.
 *
 * Two things here are measured facts, not preferences — see the notes on
 * EMBED_DIM and on `Reranker`.
 */

/**
 * Embedding width, and it is a hard constraint rather than a tuning knob.
 *
 * pgvector stores up to 16,000 dimensions but **HNSW and IVFFlat only index up
 * to 2,000**. `gemini-embedding-2` is 3072 natively. So an unindexed 3072-wide
 * column would force a sequential scan on every query — truncation is
 * mandatory, not an optimisation.
 *
 * 1024 is requested server-side via `outputDimensionality` (Matryoshka
 * representation learning), which returns **unit-normalised** vectors. That is
 * what lets the index use `vector_ip_ops` — with |v| = 1, inner product and
 * cosine rank identically and IP is marginally cheaper.
 *
 * If you ever truncate client-side from 3072 instead, you MUST re-normalise
 * yourself or every distance in the system is silently wrong.
 */
export const EMBED_DIM = 1024;

/**
 * Passages and queries are embedded asymmetrically — the same text embedded as
 * a document and as a query produces different vectors on purpose, and mixing
 * them up costs real recall.
 */
export type EmbedKind = "document" | "query";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  system: string;
  messages: ChatTurn[];
  maxOutputTokens?: number;
  /** Abort when the visitor closes the tab — never leave an upstream call running. */
  signal?: AbortSignal;
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  /** JSON Schema for constrained decoding. The schema does the work, not the model. */
  schema: unknown;
  /** Runtime validation of the decoded object. Constrained decoding is not a guarantee. */
  parse: (raw: unknown) => T;
  signal?: AbortSignal;
}

export interface RerankResult {
  /** Index into the candidate array that was passed in. */
  index: number;
  /** Relevance, 0…1. Comparable within one call; not calibrated across calls. */
  score: number;
}

export interface ModelProvider {
  readonly name: string;
  /** Batch-embed. Returns one unit-normalised vector of EMBED_DIM per input, in order. */
  embed(texts: readonly string[], kind: EmbedKind): Promise<number[][]>;
  /** Stream a chat completion as text deltas. */
  generateStream(opts: GenerateOptions): AsyncIterable<string>;
  /** One-shot structured generation under a JSON Schema. */
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T>;
}

/**
 * Reranking is split from ModelProvider because it is a genuinely different
 * capability with genuinely different implementations, and the product has two:
 *
 *   - `GeminiReranker` — an LLM scoring (query, passage) pairs under a schema.
 *     Works today, verified against a reachable API.
 *   - a real cross-encoder (NVIDIA NeMo Retriever rerank, Cohere, Bedrock) —
 *     better and cheaper per query, but NVIDIA's endpoints are 403 at this
 *     network's egress proxy, so it cannot be verified from here.
 *
 * The retrieval pipeline depends on this interface and not on either one.
 */
export interface Reranker {
  readonly name: string;
  /** Score candidates against the query. Returns ALL candidates, best first. */
  rerank(
    query: string,
    candidates: readonly string[],
    opts?: { signal?: AbortSignal },
  ): Promise<RerankResult[]>;
}
