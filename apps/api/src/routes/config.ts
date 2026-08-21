import { REFERENCE_PET, petSpecSchema } from "@bots/core/pet";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { resolveBot, withBot } from "../db.js";
import { originAllowed } from "../limits.js";

/**
 * GET /v1/bot/:key/config
 *
 * The widget's first call: the active pet plus the copy it renders. ETagged so
 * the hot-swap path is a 304 in the common case — the widget can poll cheaply
 * and the pet morphs when the owner activates a different one, with no reload.
 */
export function registerConfig(app: FastifyInstance, { sql }: { sql: Sql }): void {
  app.get<{ Params: { key: string } }>("/v1/bot/:key/config", async (request, reply) => {
    const bot = await resolveBot(sql, request.params.key);
    if (!bot) return reply.code(404).send({ error: "Unknown bot." });

    if (!originAllowed(request.headers.origin, bot.allowed_origins)) {
      return reply.code(403).send({ error: "Not authorised for this origin." });
    }

    const pets = await withBot(sql, bot.id, (tx) =>
      tx<{ spec: unknown; name: string }[]>`
        SELECT spec, name FROM pets WHERE bot_id = ${bot.id} AND is_active LIMIT 1`,
    );

    // A bot with no pet yet still renders — falling back to the reference rather
    // than 404ing means "created a bot, haven't designed a pet" is a working
    // state, not a broken embed.
    const parsed = petSpecSchema.safeParse(pets[0]?.spec);
    const pet = parsed.success ? parsed.data : REFERENCE_PET;

    const config = {
      name: bot.name,
      pet,
      greeting: `Hi — ask me anything about ${bot.name}.`,
      suggestedPrompts: bot.suggested_prompts,
      groundingMode: bot.grounding_mode,
    };

    const etag = `W/"${createHash("sha1").update(JSON.stringify(config)).digest("base64url")}"`;
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();

    return reply
      .header("ETag", etag)
      // Short max-age so an activated pet appears promptly; the ETag makes the
      // revalidation itself nearly free.
      .header("Cache-Control", "public, max-age=30, must-revalidate")
      .send(config);
  });
}
