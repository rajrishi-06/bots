/**
 * Structure-aware chunking.
 *
 * Fixed-size windows are the default everywhere and they are the reason so many
 * RAG systems retrieve half a sentence and a table with no header. This splits
 * on document structure instead:
 *
 *   - Heading boundaries start new chunks, and the heading STACK becomes
 *     `headingPath` ("Billing › Refunds › EU"), which is prepended before
 *     embedding. Most pipelines parse headings and then throw them away; that
 *     path is the single cheapest precision signal available.
 *   - Code fences and tables are atomic. A table split from its header row is
 *     worse than useless — it retrieves as authoritative and reads as noise.
 *
 * Sizes are measured in approximate tokens.
 * ponytail: words × 1.3, no tokenizer dependency. Real tokenizers put English
 * prose within ~10% of this, and the target is a soft one — a chunk 15% over
 * budget costs nothing, while shipping a 2MB WASM tokenizer to size a string
 * costs a dependency forever. Swap in a real one only if a corpus shows drift.
 */

export interface Chunk {
  ordinal: number;
  headingPath: string;
  content: string;
}

export interface ChunkOptions {
  /** Soft target. A chunk closes once adding the next block would exceed it. */
  targetTokens?: number;
  /** Trailing context carried into the next chunk, as a fraction of target. */
  overlap?: number;
  /** Chunks below this are folded into their neighbour rather than emitted —
   *  a heading with one line under it is not worth its own vector. */
  minTokens?: number;
}

const DEFAULTS = { targetTokens: 500, overlap: 0.15, minTokens: 40 } as const;

export const estimateTokens = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
};

type BlockKind = "heading" | "code" | "table" | "text";

interface Block {
  kind: BlockKind;
  text: string;
  /** Heading level, 1-6. Only set for headings. */
  level?: number;
  /** Never split, whatever the size. */
  atomic: boolean;
}

/**
 * Split markdown into blocks. Deliberately not a full CommonMark parser — it
 * needs to find fences, tables and headings, and be wrong about nothing else.
 */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushText = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ kind: "text", text, atomic: false });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Fenced code. Consume to the closing fence so nothing inside is parsed.
    const fence = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flushText();
      const marker = fence[2]!;
      const body = [line];
      i++;
      while (i < lines.length) {
        body.push(lines[i]!);
        if (lines[i]!.trimStart().startsWith(marker.slice(0, 3))) break;
        i++;
      }
      blocks.push({ kind: "code", text: body.join("\n"), atomic: true });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushText();
      blocks.push({
        kind: "heading",
        text: heading[2]!.trim(),
        level: heading[1]!.length,
        atomic: true,
      });
      continue;
    }

    // A pipe table: a header row followed by a delimiter row. Take the whole run.
    if (line.includes("|") && /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? "")) {
      flushText();
      const body = [line];
      i++;
      while (i < lines.length && lines[i]!.includes("|")) {
        body.push(lines[i]!);
        i++;
      }
      i--;
      blocks.push({ kind: "table", text: body.join("\n"), atomic: true });
      continue;
    }

    if (!line.trim()) {
      flushText();
      continue;
    }
    buffer.push(line);
  }
  flushText();
  return blocks;
}

/**
 * Split a text block that is on its own larger than the target.
 *
 * Without this, one oversized block sails through the accumulator untouched and
 * becomes a single enormous chunk. That is not a corner case: extracted PDF and
 * HTML text routinely arrives as long runs with no blank lines, so the common
 * ingest path is exactly the one that hits it.
 *
 * Splits on sentence boundaries, and falls back to word boundaries for a "sentence"
 * that is still too long (minified text, a URL wall, a language this regex does
 * not punctuate).
 */
function splitLongText(text: string, targetTokens: number): string[] {
  if (estimateTokens(text) <= targetTokens) return [text];

  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  const flush = () => {
    const joined = buf.join(" ").trim();
    if (joined) out.push(joined);
    buf = [];
    bufTokens = 0;
  };

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const t = estimateTokens(s);

    if (t > targetTokens) {
      flush();
      const words = s.split(/\s+/);
      const per = Math.max(1, Math.floor(targetTokens / 1.3));
      for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(" "));
      continue;
    }

    if (bufTokens > 0 && bufTokens + t > targetTokens) flush();
    buf.push(s);
    bufTokens += t;
  }
  flush();
  return out;
}

/** Last `n` tokens' worth of text, cut at a sentence boundary where possible. */
function tail(text: string, tokens: number): string {
  const words = text.trim().split(/\s+/);
  const take = Math.min(words.length, Math.ceil(tokens / 1.3));
  const slice = words.slice(words.length - take).join(" ");
  // Prefer starting the overlap at a sentence, so it reads as context and not
  // as a fragment glued to the front of the next chunk.
  const boundary = slice.search(/(?<=[.!?])\s+/);
  return boundary > 0 && boundary < slice.length / 2 ? slice.slice(boundary).trim() : slice;
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const { targetTokens, overlap, minTokens } = { ...DEFAULTS, ...opts };
  const blocks = parseBlocks(markdown);

  const chunks: Chunk[] = [];
  /** Heading stack, indexed by level-1. */
  const stack: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let pathAtStart = "";

  const pathNow = () => stack.filter(Boolean).join(" › ");

  const flush = () => {
    const content = current.join("\n\n").trim();
    current = [];
    currentTokens = 0;
    if (!content) return;

    // Too small to stand alone: append to the previous chunk instead of
    // emitting a vector that carries almost no signal.
    const prev = chunks[chunks.length - 1];
    if (estimateTokens(content) < minTokens && prev && prev.headingPath === pathAtStart) {
      prev.content = `${prev.content}\n\n${content}`;
      return;
    }
    chunks.push({ ordinal: chunks.length, headingPath: pathAtStart, content });
  };

  // Expand any oversized non-atomic block into target-sized pieces before the
  // accumulator sees it, so the loop below only ever handles blocks it can place.
  const sized: Block[] = blocks.flatMap((b) =>
    b.atomic || estimateTokens(b.text) <= targetTokens
      ? [b]
      : splitLongText(b.text, targetTokens).map((text) => ({ ...b, text })),
  );

  for (const block of sized) {
    if (block.kind === "heading") {
      // A new heading always starts a new chunk: it is a real topic boundary,
      // and it changes the path that the following content will be filed under.
      flush();
      const level = block.level!;
      stack.length = level - 1;
      stack[level - 1] = block.text;
      pathAtStart = pathNow();
      continue;
    }

    const blockTokens = estimateTokens(block.text);

    // An atomic block bigger than the whole target gets its own chunk rather
    // than being split — a half table or half function is not retrievable.
    if (block.atomic && blockTokens > targetTokens) {
      flush();
      if (!pathAtStart) pathAtStart = pathNow();
      chunks.push({ ordinal: chunks.length, headingPath: pathNow(), content: block.text });
      continue;
    }

    if (currentTokens > 0 && currentTokens + blockTokens > targetTokens) {
      const carry = overlap > 0 ? tail(current.join("\n\n"), targetTokens * overlap) : "";
      flush();
      pathAtStart = pathNow();
      if (carry) {
        current.push(carry);
        currentTokens = estimateTokens(carry);
      }
    }

    if (current.length === 0) pathAtStart = pathNow();
    current.push(block.text);
    currentTokens += blockTokens;
  }
  flush();

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

/**
 * The text that gets EMBEDDED, which is not the text that gets shown.
 *
 * Heading path first (topical anchor), then the ingest-time context sentence if
 * one was written, then the chunk. The reader only ever sees `content`.
 */
export function embeddableText(chunk: Chunk, context?: string | null): string {
  return [chunk.headingPath, context, chunk.content].filter(Boolean).join("\n");
}
