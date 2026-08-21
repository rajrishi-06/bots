import "server-only";
import { GROUNDING_MODE_INFO, type GroundingMode } from "@bots/core/rag";
import { petSpecSchema, type PetSpec } from "@bots/core/pet";
import postgres from "postgres";
import { getSession } from "./session.js";

/**
 * Server-side data access.
 *
 * Every query runs inside a transaction scoped with `SET LOCAL app.org_id`, so
 * row-level security is the backstop even when a `WHERE org_id` is forgotten
 * here. The pool connects as `bots_app`, never the master user — the master is
 * a superuser and superusers bypass RLS entirely.
 */

let pool: postgres.Sql | undefined;
function sql(): postgres.Sql {
  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 8 });
  return pool;
}

async function scoped<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const { orgId } = await getSession();
  return sql().begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    return fn(tx);
  }) as Promise<T>;
}

/** Scoped to one bot, for the tables RLS keys on bot_id rather than org_id. */
async function scopedToBot<T>(botId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const { orgId } = await getSession();
  return sql().begin(async (tx) => {
    // Both, because this transaction touches `bots` (org-scoped) and its
    // children (bot-scoped), and the policies read different settings.
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    await tx.unsafe(`SET LOCAL app.bot_id = '${botId}'`);
    return fn(tx);
  }) as Promise<T>;
}

export interface BotSummary {
  id: string;
  name: string;
  publicKey: string;
  groundingMode: GroundingMode;
  groundingModeAckAt: Date | null;
  allowedOrigins: string[];
  documents: number;
  chunks: number;
  activePetName: string | null;
}

export async function listBots(): Promise<BotSummary[]> {
  return scoped(async (tx) => {
    const rows = await tx<
      {
        id: string; name: string; public_key: string; grounding_mode: GroundingMode;
        grounding_mode_ack_at: Date | null; allowed_origins: string[];
        documents: string; chunks: string; active_pet_name: string | null;
      }[]
    >`
      SELECT b.id, b.name, b.public_key, b.grounding_mode, b.grounding_mode_ack_at, b.allowed_origins,
             (SELECT count(*) FROM documents d WHERE d.bot_id = b.id) AS documents,
             (SELECT count(*) FROM chunks c WHERE c.bot_id = b.id) AS chunks,
             (SELECT p.name FROM pets p WHERE p.bot_id = b.id AND p.is_active LIMIT 1) AS active_pet_name
      FROM bots b
      ORDER BY b.created_at DESC`;
    return rows.map((r) => ({
      id: r.id, name: r.name, publicKey: r.public_key,
      groundingMode: r.grounding_mode, groundingModeAckAt: r.grounding_mode_ack_at,
      allowedOrigins: r.allowed_origins,
      documents: Number(r.documents), chunks: Number(r.chunks),
      activePetName: r.active_pet_name,
    }));
  });
}

export interface BotDetail extends BotSummary {
  systemPrompt: string;
  fallbackMessage: string;
  gateThreshold: number;
  suggestedPrompts: string[];
}

export async function getBot(botId: string): Promise<BotDetail | null> {
  return scopedToBot(botId, async (tx) => {
    const rows = await tx<Record<string, never>[]>`
      SELECT b.id, b.name, b.public_key, b.grounding_mode, b.grounding_mode_ack_at,
             b.allowed_origins, b.system_prompt, b.fallback_message, b.gate_threshold,
             b.suggested_prompts,
             (SELECT count(*) FROM documents d WHERE d.bot_id = b.id) AS documents,
             (SELECT count(*) FROM chunks c WHERE c.bot_id = b.id) AS chunks,
             (SELECT p.name FROM pets p WHERE p.bot_id = b.id AND p.is_active LIMIT 1) AS active_pet_name
      FROM bots b WHERE b.id = ${botId}`;
    const r = rows[0] as Record<string, string | string[] | Date | null> | undefined;
    if (!r) return null;
    return {
      id: r.id as string, name: r.name as string, publicKey: r.public_key as string,
      groundingMode: r.grounding_mode as GroundingMode,
      groundingModeAckAt: r.grounding_mode_ack_at as Date | null,
      allowedOrigins: r.allowed_origins as string[],
      systemPrompt: r.system_prompt as string,
      fallbackMessage: r.fallback_message as string,
      gateThreshold: Number(r.gate_threshold),
      suggestedPrompts: r.suggested_prompts as string[],
      documents: Number(r.documents), chunks: Number(r.chunks),
      activePetName: r.active_pet_name as string | null,
    };
  });
}

export interface DocumentRow {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  error: string | null;
  chunkCount: number;
  flagged: number;
  createdAt: Date;
}

export async function listDocuments(botId: string): Promise<DocumentRow[]> {
  return scopedToBot(botId, async (tx) => {
    const rows = await tx<Record<string, never>[]>`
      SELECT d.id, d.title, d.source_type, d.source_url, d.status, d.error,
             d.chunk_count, d.created_at,
             (SELECT count(*) FROM chunks c
               WHERE c.document_id = d.id AND cardinality(c.injection_flags) > 0) AS flagged
      FROM documents d WHERE d.bot_id = ${botId} ORDER BY d.created_at DESC`;
    return (rows as unknown as Record<string, string | number | Date | null>[]).map((r) => ({
      id: r.id as string, title: r.title as string, sourceType: r.source_type as string,
      sourceUrl: r.source_url as string | null, status: r.status as string,
      error: r.error as string | null, chunkCount: Number(r.chunk_count),
      flagged: Number(r.flagged), createdAt: r.created_at as Date,
    }));
  });
}

export interface PetRow {
  id: string;
  name: string;
  spec: PetSpec;
  isActive: boolean;
  createdFromPrompt: string | null;
}

export async function listPets(botId: string): Promise<PetRow[]> {
  return scopedToBot(botId, async (tx) => {
    const rows = await tx<
      { id: string; name: string; spec: unknown; is_active: boolean; created_from_prompt: string | null }[]
    >`SELECT id, name, spec, is_active, created_from_prompt FROM pets
      WHERE bot_id = ${botId} ORDER BY is_active DESC, created_at DESC`;
    return rows.flatMap((r) => {
      const parsed = petSpecSchema.safeParse(r.spec);
      // A spec that no longer validates (an old shape, a hand-edited row) is
      // skipped rather than crashing the gallery — the rest still render.
      if (!parsed.success) return [];
      return [{
        id: r.id, name: r.name, spec: parsed.data,
        isActive: r.is_active, createdFromPrompt: r.created_from_prompt,
      }];
    });
  });
}

export { GROUNDING_MODE_INFO };
