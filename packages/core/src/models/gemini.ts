import { GoogleGenAI, Type, type Content } from "@google/genai";
import {
  EMBED_DIM,
  type EmbedKind,
  type GenerateJsonOptions,
  type GenerateOptions,
  type ModelProvider,
  type RerankResult,
  type Reranker,
} from "./provider.js";

/**
 * Gemini adapter.
 *
 * Model ids come from env so a rename upstream is a config change, not a
 * deploy. Defaults are ids confirmed present on the live models endpoint and
 * exercised by `gemini.live.test.ts` — `gemini-3.1-flash` was assumed earlier
 * and does not exist, which is exactly why that test is worth having.
 */
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.7-flash";
const FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? "gemini-3.1-flash-lite";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-2";

/**
 * Retry transient upstream failures.
 *
 * These models shed load with 503 UNAVAILABLE ("high demand") and 429 under
 * normal conditions, not just during incidents — it showed up immediately on
 * first contact. Without this every such blip becomes a failed user message or
 * a failed ingest batch. Only retries statuses that are actually transient: a
 * 400 or 404 is a bug and retrying it just delays the error.
 */
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const MAX_ATTEMPTS = 4;

function isTransient(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return RETRY_STATUSES.some((s) => text.includes(String(s)));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (signal?.aborted || attempt === MAX_ATTEMPTS || !isTransient(err)) break;
      // Exponential backoff with jitter, so a fleet of workers hitting the same
      // overloaded model does not retry in lockstep and re-create the spike.
      const delay = 300 * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(
    `${label} failed after ${MAX_ATTEMPTS} attempts: ${last instanceof Error ? last.message : String(last)}`,
    { cause: last },
  );
}

/** Gemini's own cap on inputs per embedContent batch. */
const EMBED_BATCH = 100;

/**
 * Headroom added on top of the caller's answer budget for thinking tokens.
 *
 * MEASURED: `gemini-3.7-flash` IGNORES `thinkingConfig.thinkingBudget: 0` and
 * spends ~120-140 tokens thinking anyway — and those tokens come out of
 * `maxOutputTokens`. At maxOutputTokens=128 the model burned 119 on thinking,
 * left 5 for the answer, and returned "EU refunds take 1" — truncated mid-word,
 * with finishReason STOP and no error of any kind.
 *
 * Callers reason about how long an ANSWER should be. The API counts thinking
 * against the same number. This closes that gap so a caller asking for 1024
 * tokens of answer gets 1024 tokens of answer. `gemini-3.1-flash-lite` does
 * honour a zero budget (measured 0 thinking tokens), so this is pure headroom
 * there and costs nothing.
 */
const THINKING_HEADROOM = 512;

/**
 * MEASURED, and contrary to what the API's acceptance of the parameter implies:
 * `gemini-embedding-2` currently IGNORES `taskType`. Embedding the same string
 * as RETRIEVAL_DOCUMENT, as RETRIEVAL_QUERY, as SEMANTIC_SIMILARITY, and with
 * the field omitted entirely all return vectors with pairwise cosine 0.9999997
 * — identical to float precision. The request 200s, so nothing surfaces.
 *
 * Asymmetric embedding is therefore NOT in effect on this provider, and the
 * retrieval pipeline is running symmetric whether it means to or not. The field
 * is still sent: it is free, it is correct on providers that honour it (NeMo's
 * `input_type`, Cohere's), and `gemini.live.test.ts` pins the current behaviour
 * so we find out if it ever starts working.
 */
const TASK_TYPE: Record<EmbedKind, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

function toContents(messages: readonly { role: string; content: string }[]): Content[] {
  return messages.map((m) => ({
    // Gemini says "model" where the rest of the world says "assistant".
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export class GeminiProvider implements ModelProvider {
  readonly name = "gemini";
  #client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. In deployed environments it is injected " +
          "from AWS Secrets Manager as an ECS task secret — never from a .env file.",
      );
    }
    this.#client = new GoogleGenAI({ apiKey });
  }

  async embed(texts: readonly string[], kind: EmbedKind): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const res = await withRetry("embed", () => this.#client.models.embedContent({
        model: EMBED_MODEL,
        contents: batch.map((t) => ({ parts: [{ text: t }] })),
        config: {
          taskType: TASK_TYPE[kind],
          // Requested server-side, NOT truncated here — see EMBED_DIM. The API
          // returns these already unit-normalised, which the ip_ops index relies on.
          outputDimensionality: EMBED_DIM,
        },
      }));
      const vectors = res.embeddings ?? [];
      if (vectors.length !== batch.length) {
        throw new Error(`Embedding count mismatch: sent ${batch.length}, got ${vectors.length}`);
      }
      for (const v of vectors) {
        const values = v.values;
        if (!values || values.length !== EMBED_DIM) {
          throw new Error(`Expected ${EMBED_DIM}-dim embedding, got ${values?.length ?? 0}`);
        }
        out.push(values);
      }
    }
    return out;
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<string> {
    // Retry wraps only stream ESTABLISHMENT. Once deltas are flowing a failure
    // is not safely retryable — the user has already seen half an answer.
    const stream = await withRetry("generateStream", () => this.#client.models.generateContentStream({
      model: CHAT_MODEL,
      contents: toContents(opts.messages),
      config: {
        systemInstruction: opts.system,
        // Answer budget PLUS thinking headroom — see THINKING_HEADROOM. Asking
        // for exactly the answer length silently truncates on thinking models.
        maxOutputTokens: (opts.maxOutputTokens ?? 1024) + THINKING_HEADROOM,
        // Honoured by flash-lite, ignored by 3.7-flash. Sent anyway: where it
        // works it saves the tokens, and where it does not the headroom covers it.
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: opts.signal,
      },
    }), opts.signal);

    let produced = false;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        produced = true;
        yield text;
      }
    }
    // A stream that completes having emitted only thinking tokens is the
    // starvation case above. Fail loudly — silently returning "" renders as an
    // empty assistant bubble the visitor cannot distinguish from a broken bot.
    if (!produced) {
      throw new Error(
        "Model produced no visible text (thinking tokens may have consumed the output budget).",
      );
    }
  }

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const res = await withRetry("generateJson", () => this.#client.models.generateContent({
      model: FAST_MODEL,
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseSchema: opts.schema as never,
        abortSignal: opts.signal,
      },
    }), opts.signal);
    const text = res.text;
    if (!text) throw new Error("Model returned no JSON.");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Model returned invalid JSON: ${text.slice(0, 200)}`);
    }
    // Constrained decoding is not a guarantee — validate anyway.
    return opts.parse(raw);
  }
}

/**
 * LLM reranker: scores every candidate against the query in ONE structured call.
 *
 * This is the working stand-in for a cross-encoder. It is a real precision
 * lever — the model sees query and passage together, which is exactly what bi-
 * encoder retrieval cannot do — but it is not free.
 *
 * ponytail: one call carrying ~50 passages, so cost scales with candidate count
 * and context, not with round trips. Swap in NeMo Retriever / Cohere rerank
 * (implement `Reranker`, change one line of wiring) when a real cross-encoder
 * is reachable; it will be both cheaper and better.
 */
export class GeminiReranker implements Reranker {
  readonly name = "gemini-llm-rerank";
  #client: GoogleGenAI;
  /** Passages are truncated before scoring; the lead of a chunk decides relevance. */
  #maxChars: number;

  constructor(apiKey = process.env.GEMINI_API_KEY, maxChars = 1200) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
    this.#client = new GoogleGenAI({ apiKey });
    this.#maxChars = maxChars;
  }

  async rerank(
    query: string,
    candidates: readonly string[],
    opts: { signal?: AbortSignal } = {},
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    const numbered = candidates
      .map((c, i) => `<passage id="${i}">\n${c.slice(0, this.#maxChars)}\n</passage>`)
      .join("\n\n");

    const res = await withRetry("rerank", () => this.#client.models.generateContent({
      model: FAST_MODEL,
      contents: [
        { role: "user", parts: [{ text: `QUERY:\n${query}\n\nPASSAGES:\n${numbered}` }] },
      ],
      config: {
        systemInstruction:
          "You score passages for relevance to a query. For EVERY passage id given, " +
          "return a score from 0.0 to 1.0: 1.0 answers the query directly, 0.5 is " +
          "related background, 0.0 is unrelated. Judge only whether the passage helps " +
          "answer THIS query — not whether it is well written. Never omit an id.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scores: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  score: { type: Type.NUMBER },
                },
                required: ["id", "score"],
              },
            },
          },
          required: ["scores"],
        },
        abortSignal: opts.signal,
      },
    }), opts.signal);

    const text = res.text;
    if (!text) throw new Error("Reranker returned no JSON.");
    const parsed = JSON.parse(text) as { scores?: { id: number; score: number }[] };

    // Default to 0, then fill in what came back. A passage the model skipped
    // ranks last rather than throwing away the whole query.
    const scores = new Array<number>(candidates.length).fill(0);
    for (const s of parsed.scores ?? []) {
      if (Number.isInteger(s.id) && s.id >= 0 && s.id < candidates.length) {
        scores[s.id] = Math.min(1, Math.max(0, s.score));
      }
    }
    return scores
      .map((score, index) => ({ index, score }))
      .sort((a, b) => b.score - a.score);
  }
}
