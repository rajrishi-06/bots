import {
  applyGate,
  buildSystemPrompt,
  screenInbound,
  validateCitations,
  type ModelProvider,
  type Reranker,
} from "@bots/core";
import { retrieve } from "@bots/rag";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import { resolveBot, withBot } from "../db.js";
import { checkQuota, checkRateLimit, originAllowed } from "../limits.js";

/**
 * POST /v1/chat — the endpoint the widget talks to.
 *
 * The SSE frame shape is `{type:'delta'|'error'|'done'}`, carried over verbatim
 * from the portfolio so its `consumeSSE` client parser ports without changes.
 */

const MAX_TURNS = 20;

interface ChatBody {
  botKey?: string;
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  conversationId?: string;
  /** Set by the playground. Returns the retrieval trace alongside the answer. */
  debug?: boolean;
}

function sse(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Proxies buffer text/event-stream by default and the answer arrives in one
    // lump at the end, which reads as a hang.
    "X-Accel-Buffering": "no",
  });
}

function send(reply: FastifyReply, data: unknown): void {
  if (reply.raw.writableEnded) return;
  try {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client vanished mid-write */
  }
}

export interface ChatDeps {
  sql: Sql;
  redis: Redis;
  provider: ModelProvider;
  reranker: Reranker;
}

export function registerChat(app: FastifyInstance, deps: ChatDeps): void {
  const { sql, redis, provider, reranker } = deps;

  app.post("/v1/chat", async (request, reply) => {
    const body = (request.body ?? {}) as ChatBody;
    const botKey = typeof body.botKey === "string" ? body.botKey : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!botKey || !message) {
      return reply.code(400).send({ error: "botKey and message are required." });
    }

    const bot = await resolveBot(sql, botKey);
    // Same response for an unknown key and a disallowed origin — distinguishing
    // them tells a prober which keys exist.
    if (!bot) return reply.code(403).send({ error: "Not authorised for this origin." });

    const origin = request.headers.origin;
    if (!originAllowed(origin, bot.allowed_origins)) {
      return reply.code(403).send({ error: "Not authorised for this origin." });
    }

    const ip = request.ip;
    const limit = await checkRateLimit(redis, bot.id, ip);
    if (!limit.allowed) {
      return reply
        .code(429)
        .header("Retry-After", String(limit.retryAfterSeconds ?? 60))
        .send({ error: "Too many requests. Please slow down." });
    }

    // Cheap screening BEFORE the expensive model — this is the whole point of
    // running it here rather than relying on the system prompt to decline.
    const screened = screenInbound(message);
    if (screened.blocked) {
      sse(reply);
      send(reply, { type: "delta", text: screened.message });
      send(reply, { type: "done", blocked: screened.kind });
      reply.raw.end();
      return reply;
    }

    const quota = await checkQuota(redis, bot.id, bot.monthly_message_quota);
    if (!quota.allowed) {
      return reply.code(429).send({ error: "This assistant has reached its monthly limit." });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_TURNS)
      : [];

    // Abort the upstream model call when the visitor closes the tab. Without
    // this a closed tab keeps burning tokens until the model finishes.
    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());

    try {
      const result = await withBot(sql, bot.id, async (tx) => {
        const { chunks, trace } = await retrieve({
          sql: tx,
          provider,
          reranker,
          botId: bot.id,
          query: message,
          history,
          mode: bot.grounding_mode,
          threshold: Number(bot.gate_threshold),
          signal: controller.signal,
        });
        return { chunks, trace };
      });

      const { chunks, trace } = result;
      const gate = applyGate({
        mode: bot.grounding_mode,
        topScore: chunks[0]?.score,
        threshold: Number(bot.gate_threshold),
      });

      sse(reply);
      if (body.debug) send(reply, { type: "trace", trace, chunks: chunks.map(summarise) });

      // Strict mode below the threshold: return the fallback verbatim and never
      // reach the model. This is what stops confident hallucination on an
      // out-of-scope question, and it is also free.
      if (gate.refuse) {
        send(reply, { type: "delta", text: bot.fallback_message });
        send(reply, { type: "done", gated: true });
        reply.raw.end();
        return reply;
      }

      const context = gate.useContext ? chunks : [];
      const system = buildSystemPrompt({
        mode: bot.grounding_mode,
        persona: bot.system_prompt,
        chunks: context.map((c, i) => ({
          id: `c${i + 1}`,
          headingPath: c.headingPath,
          content: c.content,
        })),
        fallbackMessage: bot.fallback_message,
      });

      const allowedIds = context.map((_, i) => `c${i + 1}`);
      let buffered = "";
      for await (const delta of provider.generateStream({
        system,
        messages: [...history, { role: "user", content: message }],
        signal: controller.signal,
      })) {
        buffered += delta;
        // Citations are validated against what was actually supplied. A model
        // WILL occasionally cite an id it invented, and an unresolvable citation
        // is worse than none — it looks like evidence.
        const { text } = validateCitations(delta, allowedIds);
        if (text) send(reply, { type: "delta", text });
      }

      const { dropped } = validateCitations(buffered, allowedIds);
      send(reply, {
        type: "done",
        citations: allowedIds.filter((id) => buffered.includes(`[${id}]`)),
        ...(dropped.length ? { droppedCitations: dropped } : {}),
      });
      reply.raw.end();
      return reply;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      request.log.error({ err, botId: bot.id }, "chat failed");
      if (!reply.raw.headersSent) {
        return reply.code(500).send({ error: "The assistant hit an error." });
      }
      // Already streaming — the visitor has seen partial output, so the error
      // has to arrive in-band rather than as a status code.
      send(reply, { type: "error", message: controller.signal.aborted ? "Cancelled." : detail });
      reply.raw.end();
      return reply;
    }
  });
}

function summarise(c: { id: string; headingPath: string; content: string; score: number; fusedScore: number; ranks: (number | null)[] }) {
  return {
    id: c.id,
    headingPath: c.headingPath,
    preview: c.content.slice(0, 240),
    score: c.score,
    fusedScore: c.fusedScore,
    ranks: c.ranks,
  };
}
