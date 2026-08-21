import { Redis } from "ioredis";

/**
 * Abuse guards that run before anything expensive.
 *
 * These are not user-editable in any grounding mode. Leaving strict mode opens
 * an interactive LLM on a public page, and these are what stop that from
 * becoming an unbounded bill.
 */

export interface LimitConfig {
  /** Requests per window, per bot. */
  perBot: number;
  /** Requests per window, per IP — one abuser must not exhaust a bot's budget. */
  perIp: number;
  windowSeconds: number;
}

export const DEFAULT_LIMITS: LimitConfig = { perBot: 60, perIp: 15, windowSeconds: 60 };

export interface LimitVerdict {
  allowed: boolean;
  /** Which limit tripped, for the response header and the dashboard counter. */
  scope?: "bot" | "ip" | "quota";
  retryAfterSeconds?: number;
}

export function createRedis(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error("REDIS_URL is not set.");
  return new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
}

/**
 * Sliding-window counter over a sorted set.
 *
 * A fixed window would let an abuser send 2× the limit across a boundary, which
 * for a token-metered endpoint is a real bill rather than a rounding error. The
 * whole thing is one pipeline round trip.
 */
async function slidingWindow(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, cutoff)
    // A unique member per request; the score is the timestamp we prune against.
    .zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 10)}`)
    .zcard(key)
    .expire(key, windowSeconds + 1)
    .exec();
  const count = (results?.[2]?.[1] as number | undefined) ?? 0;
  return count <= limit;
}

export async function checkRateLimit(
  redis: Redis,
  botId: string,
  ip: string,
  config: LimitConfig = DEFAULT_LIMITS,
): Promise<LimitVerdict> {
  const [botOk, ipOk] = await Promise.all([
    slidingWindow(redis, `rl:bot:${botId}`, config.perBot, config.windowSeconds),
    slidingWindow(redis, `rl:ip:${botId}:${ip}`, config.perIp, config.windowSeconds),
  ]);
  if (!ipOk) return { allowed: false, scope: "ip", retryAfterSeconds: config.windowSeconds };
  if (!botOk) return { allowed: false, scope: "bot", retryAfterSeconds: config.windowSeconds };
  return { allowed: true };
}

/**
 * Hard monthly message quota. Counted in Redis rather than Postgres because it
 * is read on every single message and written on most of them.
 *
 * ponytail: the key expires 40 days out and the month is part of the key, so
 * there is no reset job. Move to a usage_events rollup when billing needs an
 * auditable number rather than a limiter.
 */
export async function checkQuota(redis: Redis, botId: string, quota: number): Promise<LimitVerdict> {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `quota:${botId}:${month}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 60 * 60 * 24 * 40);
  return used <= quota ? { allowed: true } : { allowed: false, scope: "quota" };
}

/**
 * Origin allowlist.
 *
 * The public key is an identifier, not a secret — it ships in the embed snippet
 * and anyone can read it. This is what actually binds a bot to its site.
 *
 * An empty allowlist means "not configured yet" and is permitted, so a bot
 * works the moment it is created. The dashboard flags it.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false; // configured but the request did not say — refuse
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    // "*.example.com" matches any subdomain but NOT the bare apex, matching how
    // people read it. "example.com" matches only the apex.
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      return host.endsWith(suffix);
    }
    return host === pattern;
  });
}
