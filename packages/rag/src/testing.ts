import { EMBED_DIM, type EmbedKind, type GenerateJsonOptions, type GenerateOptions, type ModelProvider, type RerankResult, type Reranker } from "@bots/core";

/**
 * Deterministic stand-ins, so the pipeline can be tested against a real
 * Postgres without a network call or an API key.
 *
 * The embedder is a real hashing bag-of-words, not random noise: documents
 * sharing vocabulary genuinely land near each other, so dense retrieval is
 * exercised rather than mocked away. It is obviously far weaker than a trained
 * model — which is the point. Pipeline behaviour that depends on embedding
 * QUALITY is not something these tests should be asserting.
 */

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** FNV-1a, so the bucket for a token is stable across processes and runs. */
function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Unit-normalised, because the whole index depends on |v| = 1. */
export function fakeEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const t of tokenize(text)) v[hash(t) % EMBED_DIM]! += 1;
  const norm = Math.hypot(...v);
  return norm === 0 ? v.fill(1 / Math.sqrt(EMBED_DIM)) : v.map((x) => x / norm);
}

export interface FakeProviderOptions {
  /** Canned reply for generateJson, keyed by nothing — tests set what they need. */
  json?: unknown;
  /** Text the stream yields. */
  stream?: string[];
}

export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  calls = { embed: 0, generateJson: 0, generateStream: 0 };
  constructor(private opts: FakeProviderOptions = {}) {}

  async embed(texts: readonly string[], _kind: EmbedKind): Promise<number[][]> {
    this.calls.embed++;
    return texts.map(fakeEmbed);
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<string> {
    this.calls.generateStream++;
    for (const s of this.opts.stream ?? ["ok"]) yield s;
    void opts;
  }

  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    this.calls.generateJson++;
    // Default: echo the query back unchanged, i.e. "already standalone".
    return opts.parse(this.opts.json ?? {});
  }
}

/**
 * Reranker stand-in: lexical overlap between query and passage.
 *
 * Crude on purpose. It is a real signal (so ordering assertions mean
 * something) and it is deterministic (so they do not flake), but no test here
 * should depend on it being clever.
 */
export class FakeReranker implements Reranker {
  readonly name = "fake-overlap";
  async rerank(query: string, candidates: readonly string[]): Promise<RerankResult[]> {
    const q = new Set(tokenize(query));
    return candidates
      .map((text, index) => {
        const words = tokenize(text);
        if (words.length === 0 || q.size === 0) return { index, score: 0 };
        const hits = words.filter((w) => q.has(w)).length;
        // Saturating, so a long passage does not win on length alone.
        return { index, score: Math.min(1, hits / q.size) };
      })
      .sort((a, b) => b.score - a.score);
  }
}
