import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * One pooled client per process.
 *
 * `prepare: false` because pgbouncer in transaction mode (which RDS Proxy also
 * behaves like) cannot carry prepared statements across pooled connections.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { prepare: false, max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];
