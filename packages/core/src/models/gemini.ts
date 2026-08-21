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
 * deploy. Defaults are the ids verified working against the live API.
 */
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.1-flash";
const FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? "gemini-3.1-flash-lite";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-2";

/** Gemini's own cap on inputs per embedContent batch. */
const EMBED_BATCH = 100;

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
      const res = await this.#client.models.embedContent({
        model: EMBED_MODEL,
        contents: batch.map((t) => ({ parts: [{ text: t }] })),
        config: {
          taskType: TASK_TYPE[kind],
          // Requested server-side, NOT truncated here — see EMBED_DIM. The API
          // returns these already unit-normalised, which the ip_ops index relies on.
          outputDimensionality: EMBED_DIM,
        },
      });
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
    const stream = await this.#client.models.generateContentStream({
      model: CHAT_MODEL,
      contents: toContents(opts.messages),
      config: {
        systemInstruction: opts.system,
        maxOutputTokens: opts.maxOutputTokens ?? 1024,
        // Budget goes to the visible answer, not to hidden reasoning. Grounded
        // answers over retrieved context do not need a scratchpad.
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: opts.signal,
      },
    });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const res = await this.#client.models.generateContent({
      model: FAST_MODEL,
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseSchema: opts.schema as never,
        abortSignal: opts.signal,
      },
    });
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

    const res = await this.#client.models.generateContent({
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
    });

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
