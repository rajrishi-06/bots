import { z } from "zod";

/**
 * Grounding modes.
 *
 * Strict is the default, not a cage — users own their bot's system prompt. But
 * leaving strict has consequences that are the owner's to accept explicitly,
 * so the acknowledgement is persisted, not toasted.
 */

export const GROUNDING_MODES = ["strict", "blended", "open"] as const;
export const groundingModeSchema = z.enum(GROUNDING_MODES);
export type GroundingMode = z.infer<typeof groundingModeSchema>;

export interface GroundingModeInfo {
  mode: GroundingMode;
  label: string;
  gate: string;
  /** Shown in the confirm dialog. Empty for strict — nothing to accept. */
  risks: string[];
}

export const GROUNDING_MODE_INFO: Record<GroundingMode, GroundingModeInfo> = {
  strict: {
    mode: "strict",
    label: "Strict — knowledge base only",
    gate: "Below the relevance threshold the bot refuses and returns your fallback message.",
    risks: [],
  },
  blended: {
    mode: "blended",
    label: "Blended — knowledge base first, general knowledge allowed",
    gate: "Below the threshold the bot answers anyway, marking which claims came from your documents.",
    risks: [
      "Cost abuse: anyone who finds your embed can use the bot as a free general-purpose assistant on your token budget.",
      "Liability: answers the model invents still carry your branding, and you are accountable for them.",
    ],
  },
  open: {
    mode: "open",
    label: "Open — a general assistant that knows your documents",
    gate: "Retrieval is advisory. The bot answers everything.",
    risks: [
      "Cost abuse: anyone who finds your embed can use the bot as a free general-purpose assistant on your token budget.",
      "Liability: answers the model invents still carry your branding, and you are accountable for them.",
      "Prompt injection: instructions hidden inside an uploaded document become a live channel into the model.",
    ],
  },
};

/** Everything except strict requires a recorded acknowledgement. */
export function requiresAck(mode: GroundingMode): boolean {
  return GROUNDING_MODE_INFO[mode].risks.length > 0;
}

/**
 * Relevance gate.
 *
 * Default threshold is deliberately mid-scale: the reranker returns 1.0 for
 * "answers the query directly" and 0.5 for "related background", so 0.45 keeps
 * genuine background and drops everything the reranker called unrelated. It is
 * per-bot tunable because corpora differ — a narrow FAQ scores much higher
 * across the board than a sprawling wiki.
 */
export const DEFAULT_GATE_THRESHOLD = 0.45;

export interface GateInput {
  mode: GroundingMode;
  /** Top post-rerank score, or undefined when retrieval returned nothing. */
  topScore: number | undefined;
  threshold?: number;
}

export interface GateDecision {
  /** Whether retrieved context is stuffed into the prompt at all. */
  useContext: boolean;
  /** Whether to refuse outright and return the bot's fallback message. */
  refuse: boolean;
  /** Human-readable reason. Surfaced verbatim in the retrieval debug panel. */
  reason: string;
}

export function applyGate({
  mode,
  topScore,
  threshold = DEFAULT_GATE_THRESHOLD,
}: GateInput): GateDecision {
  const passed = topScore !== undefined && topScore >= threshold;

  if (passed) {
    return {
      useContext: true,
      refuse: false,
      reason: `top score ${topScore.toFixed(3)} ≥ threshold ${threshold.toFixed(2)}`,
    };
  }

  const got = topScore === undefined ? "no chunks retrieved" : `top score ${topScore.toFixed(3)}`;
  const under = `${got} < threshold ${threshold.toFixed(2)}`;

  // This branch is the entire reason confident hallucination does not happen in
  // strict mode: the model is never given weak context to rationalise from.
  if (mode === "strict") {
    return { useContext: false, refuse: true, reason: `${under} — strict: refused` };
  }
  if (mode === "blended") {
    return { useContext: false, refuse: false, reason: `${under} — blended: answering unaided` };
  }
  return { useContext: true, refuse: false, reason: `${under} — open: retrieval advisory` };
}
