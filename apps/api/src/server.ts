import { GeminiProvider, GeminiReranker, type ModelProvider, type Reranker } from "@bots/core";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import { createPool } from "./db.js";
import { createRedis } from "./limits.js";
import { registerChat } from "./routes/chat.js";
import { registerConfig } from "./routes/config.js";
import { registerFeedback } from "./routes/feedback.js";

export interface ServerDeps {
  sql?: Sql;
  redis?: Redis;
  provider?: ModelProvider;
  reranker?: Reranker;
}

/**
 * Dependencies are injectable so the integration tests can drive the real
 * routes — origin checks, rate limits, the gate — against a real Postgres and
 * Redis with a deterministic model. Testing those boundaries through mocks of
 * the routes themselves would test the mocks.
 */
export async function buildServer(deps: ServerDeps = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Behind an ALB, so request.ip must come from X-Forwarded-For or every
    // per-IP rate limit would key on the load balancer and be useless.
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  const sql = deps.sql ?? createPool();
  const redis = deps.redis ?? createRedis();
  const provider = deps.provider ?? new GeminiProvider();
  const reranker = deps.reranker ?? new GeminiReranker();
  const ownsResources = !deps.sql;

  // The widget runs on customers' domains, so the browser preflights. Actual
  // authorisation is the per-bot origin allowlist, not this header.
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Headers", "Content-Type, If-None-Match");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") reply.code(204).send();
  });

  app.get("/health", async () => {
    // Actually touch both dependencies — a health check that only proves the
    // process is running gets a container replaced for the wrong reason.
    const [dbOk, redisOk] = await Promise.allSettled([sql`SELECT 1`, redis.ping()]);
    const healthy = dbOk.status === "fulfilled" && redisOk.status === "fulfilled";
    return healthy
      ? { status: "ok", db: "up", redis: "up" }
      : {
          status: "degraded",
          db: dbOk.status === "fulfilled" ? "up" : "down",
          redis: redisOk.status === "fulfilled" ? "up" : "down",
        };
  });

  registerConfig(app, { sql });
  registerChat(app, { sql, redis, provider, reranker });
  registerFeedback(app, { sql });

  app.addHook("onClose", async () => {
    // Only tear down what we created — a test owning the pool closes it itself.
    if (ownsResources) {
      await sql.end();
      redis.disconnect();
    }
  });

  return app;
}

// Started directly (not imported by a test).
if (process.argv[1]?.endsWith("server.ts")) {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: "0.0.0.0" });
}
