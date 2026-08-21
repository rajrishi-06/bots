import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { resolveBot, withBot } from "../db.js";
import { originAllowed } from "../limits.js";

/**
 * POST /v1/feedback — a thumb on an answer.
 *
 * The point is not a satisfaction metric. A thumbs-down on a specific message
 * is a question the bot got wrong WITH the retrieval that produced it already
 * recorded, which is a ready-made eval case — see the promotion query in the
 * dashboard's unanswered view.
 */
export function registerFeedback(app: FastifyInstance, { sql }: { sql: Sql }): void {
  app.post("/v1/feedback", async (request, reply) => {
    const body = (request.body ?? {}) as {
      botKey?: string;
      messageId?: string;
      conversationId?: string;
      helpful?: boolean;
    };

    if (!body.botKey || typeof body.helpful !== "boolean") {
      return reply.code(400).send({ error: "botKey and helpful are required." });
    }

    const bot = await resolveBot(sql, body.botKey);
    if (!bot || !originAllowed(request.headers.origin, bot.allowed_origins)) {
      return reply.code(403).send({ error: "Not authorised for this origin." });
    }

    const updated = await withBot(sql, bot.id, async (tx) => {
      if (body.messageId) {
        return tx`
          UPDATE messages SET helpful = ${body.helpful!}
          WHERE id = ${body.messageId} AND role = 'assistant' RETURNING id`;
      }
      // No message id: mark the latest assistant turn in the conversation. The
      // widget knows its conversation but not individual message ids.
      if (body.conversationId) {
        return tx`
          UPDATE messages SET helpful = ${body.helpful!}
          WHERE id = (
            SELECT id FROM messages
            WHERE conversation_id = ${body.conversationId} AND role = 'assistant'
            ORDER BY created_at DESC LIMIT 1
          ) RETURNING id`;
      }
      return [];
    });

    if ((updated as unknown[]).length === 0) {
      return reply.code(404).send({ error: "No such message." });
    }
    return reply.send({ ok: true });
  });
}
