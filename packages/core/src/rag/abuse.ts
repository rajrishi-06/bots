/**
 * Cheap inbound guards that run BEFORE the expensive model.
 *
 * These are non-negotiable and not user-editable in any grounding mode. They
 * are regex-and-length checks on purpose: they cost microseconds, they block
 * the overwhelmingly common abuse, and anything they miss still hits the
 * per-bot quota behind them.
 *
 * ponytail: heuristics, not a classifier. Upgrade to a small classifier model
 * if real traffic shows these being routed around — but measure first, because
 * a model call here would cost more than the abuse it prevents.
 */

export interface AbuseVerdict {
  blocked: boolean;
  /** Category, for the dashboard's abuse counter. */
  kind?: "length" | "off-purpose" | "prompt-extraction";
  /** Shown to the visitor. Deliberately bland — never a hint about the bypass. */
  message?: string;
}

/** Long enough for a real pasted error log, short enough to stop essay farming. */
export const MAX_MESSAGE_CHARS = 4000;

/** Bulk-generation asks. The tell is a large explicit quantity plus a produce verb. */
const BULK_GENERATION =
  /\b(write|generate|produce|create|compose|draft)\b[^.?!]{0,60}?\b(\d{3,}|\d+\s*(k|thousand|hundred))\b[^.?!]{0,40}?\b(words?|lines?|characters?|paragraphs?|pages?|items?|examples?)\b/i;

/** "act as", "pretend you are", "you are now" — persona replacement. */
const PERSONA_HIJACK =
  /\b(ignore|disregard|forget)\b[^.?!]{0,30}\b(previous|prior|above|earlier|all)\b[^.?!]{0,20}\b(instruction|prompt|rule|direction)/i;

const PROMPT_EXTRACTION =
  /\b(reveal|show|print|repeat|output|display|what (is|are|was))\b[^.?!]{0,40}\b(your |the )?(system |initial |original )?(prompt|instructions?|rules?|directive)/i;

/** Standalone coding tasks. Asking ABOUT code in the docs is fine; asking the
 *  bot to BE a code generator is what this catches. */
const CODE_FARMING =
  /\b(write|implement|code|build|refactor|debug)\b[^.?!]{0,40}\b(function|script|program|class|component|app|website|algorithm)\b/i;

export function screenInbound(message: string): AbuseVerdict {
  const text = message.trim();

  if (text.length > MAX_MESSAGE_CHARS) {
    return {
      blocked: true,
      kind: "length",
      message: `That message is too long — please keep it under ${MAX_MESSAGE_CHARS} characters.`,
    };
  }

  if (PROMPT_EXTRACTION.test(text) || PERSONA_HIJACK.test(text)) {
    return {
      blocked: true,
      kind: "prompt-extraction",
      message: "I can't help with that. Ask me something about the documents I know.",
    };
  }

  if (BULK_GENERATION.test(text) || CODE_FARMING.test(text)) {
    return {
      blocked: true,
      kind: "off-purpose",
      message: "I'm here to answer questions about this site's documents, not to write content.",
    };
  }

  return { blocked: false };
}

/**
 * Scan an INGESTED chunk for embedded instructions.
 *
 * An uploaded document is untrusted input. In blended/open a malicious PDF is a
 * live instruction channel into the model, and the prompt-level defence in
 * prompts.ts is the second layer, not the first. Flagged chunks are still
 * indexed — they are legitimate content often enough — but the dashboard shows
 * the flag so an owner can see what is in their corpus.
 */
export function scanChunkForInjection(content: string): { suspicious: boolean; matched: string[] } {
  const patterns: [string, RegExp][] = [
    ["instruction-override", PERSONA_HIJACK],
    ["prompt-extraction", PROMPT_EXTRACTION],
    ["role-reassignment", /\b(you are now|from now on,? you|act as (a|an)|new instructions?:)/i],
    ["exfiltration", /\b(send|post|email|upload|forward)\b[^.?!]{0,40}\b(to|at)\b[^.?!]{0,20}(https?:\/\/|@)/i],
  ];
  const matched = patterns.filter(([, re]) => re.test(content)).map(([name]) => name);
  return { suspicious: matched.length > 0, matched };
}
