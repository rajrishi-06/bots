import postgres, { type Sql, type TransactionSql } from "postgres";

/**
 * Every request runs inside a transaction that has declared which tenant it is
 * for. That declaration is what the RLS policies read.
 *
 * The connection MUST be a non-superuser (`bots_app`). A superuser bypasses row
 * level security entirely, even with FORCE — see packages/db/migrations/0001.
 */

export function createPool(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set.");
  // prepare:false — pgbouncer/RDS Proxy in transaction mode cannot carry
  // prepared statements across pooled connections.
  return postgres(url, { prepare: false, max: 20, idle_timeout: 30 });
}

/** Run `fn` scoped to one bot. Outside this, queries see nothing. */
export function withBot<T>(sql: Sql, botId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    // SET LOCAL, so the scope dies with the transaction and can never leak into
    // the next request that borrows this pooled connection.
    await tx.unsafe(`SET LOCAL app.bot_id = '${botId}'`);
    return fn(tx);
  }) as Promise<T>;
}

/** Run `fn` scoped to one organization (dashboard traffic). */
export function withOrg<T>(sql: Sql, orgId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    return fn(tx);
  }) as Promise<T>;
}

export interface BotRow {
  id: string;
  name: string;
  system_prompt: string;
  fallback_message: string;
  grounding_mode: "strict" | "blended" | "open";
  gate_threshold: string;
  allowed_origins: string[];
  monthly_message_quota: number;
  suggested_prompts: string[];
}

/**
 * Resolve a bot by its public key.
 *
 * Goes through a SECURITY DEFINER function rather than reading `bots` directly,
 * because this is the one query with no tenant context to run under — resolving
 * the key is what PRODUCES the scope. Reading the table here returns zero rows,
 * correctly and silently. See migrations/0002.
 */
export async function resolveBot(sql: Sql, publicKey: string): Promise<BotRow | null> {
  const rows = await sql<BotRow[]>`SELECT * FROM resolve_bot_by_key(${publicKey})`;
  return rows[0] ?? null;
}
