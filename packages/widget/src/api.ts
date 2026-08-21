import type { PetSpec } from "@bots/core/pet";
import type { Action, Appearance } from "@bots/core/widget/defaults";

/**
 * Thin client for the bot backend.
 *
 * `consumeSSE` is carried over from the portfolio unchanged — the frame shape
 * `{type:'delta'|'error'|'done'}` is the same on the wire, deliberately.
 */

export interface BotConfig {
  name: string;
  pet: PetSpec;
  greeting: string;
  suggestedPrompts: string[];
  groundingMode: "strict" | "blended" | "open";
  appearance: Appearance;
  actions: Action[];
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export class StreamError extends Error {}

/**
 * A stable per-browser id, so a returning visitor's conversations group together.
 * Random and stored locally — it identifies a browser, never a person, and it is
 * never derived from anything about them.
 */
function visitorId(): string {
  const KEY = "petbot:visitor";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "v_anon"; // private mode
  }
}

async function consumeSSE(
  res: Response,
  onDelta: (t: string) => void,
  onDone?: (info: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      /* not JSON — keep the status message */
    }
    throw new StreamError(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. Anything after the last one is
    // a partial frame and stays in the buffer.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      let evt: { type: string; text?: string; message?: string };
      try {
        evt = JSON.parse(json);
      } catch {
        continue;
      }
      if (evt.type === "delta" && evt.text) onDelta(evt.text);
      else if (evt.type === "error") throw new StreamError(evt.message || "The assistant hit an error.");
      else if (evt.type === "done") onDone?.(evt as Record<string, unknown>);
    }
  }
}

export class BotClient {
  constructor(
    private base: string,
    private botKey: string,
  ) {}

  async config(): Promise<BotConfig> {
    const res = await fetch(`${this.base}/v1/bot/${encodeURIComponent(this.botKey)}/config`);
    if (!res.ok) throw new StreamError(`Could not load this assistant (${res.status}).`);
    return (await res.json()) as BotConfig;
  }

  async chat(
    message: string,
    history: Turn[],
    opts: {
      onDelta: (t: string) => void;
      onDone?: (i: Record<string, unknown>) => void;
      signal?: AbortSignal;
      conversationId?: string;
    },
  ): Promise<void> {
    const res = await fetch(`${this.base}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botKey: this.botKey, message, history,
        conversationId: opts.conversationId,
        visitorId: visitorId(),
      }),
      signal: opts.signal,
    });
    await consumeSSE(res, opts.onDelta, opts.onDone);
  }

  /** Fire-and-forget: a failed thumb must never surface to the visitor. */
  async feedback(conversationId: string, helpful: boolean): Promise<void> {
    try {
      await fetch(`${this.base}/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botKey: this.botKey, conversationId, helpful }),
      });
    } catch {
      /* the visitor already told us what they think; the record is our problem */
    }
  }
}
