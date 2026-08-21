import { EMBED_DIM } from "@bots/core/models";
import { GROUNDING_MODES } from "@bots/core";
import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Postgres 16 + pgvector.
 *
 * Two invariants in here are the ones that would sink the product if they broke,
 * so they are enforced by the database rather than by application code:
 *
 *   1. `bot_id` isolation. Every retrieval pre-filters on it AND row-level
 *      security enforces it. A cross-tenant leak is the single bug that kills
 *      this product outright, so it does not rest on remembering a WHERE clause.
 *   2. Exactly one active pet per bot, via a partial unique index. "Which row is
 *      active" is the entire swap mechanism; two active rows would make the
 *      widget's rendered pet depend on row order.
 */

/** tsvector has no first-class Drizzle type; BM25 needs one. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const groundingMode = pgEnum("grounding_mode", GROUNDING_MODES);
export const documentStatus = pgEnum("document_status", [
  "queued",
  "parsing",
  "chunking",
  "contextualizing",
  "embedding",
  "indexed",
  "failed",
]);
export const sourceType = pgEnum("source_type", ["upload", "crawl", "snippet"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Clerk's user id. The auth provider owns identity; we only mirror it. */
    externalId: text("external_id").notNull(),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_external_id_key").on(t.externalId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_key").on(t.orgId, t.userId)],
);

export const bots = pgTable(
  "bots",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `pb_live_…`. An IDENTIFIER, not a secret — it ships in the embed snippet.
     *  Origin allowlist + rate limits are what actually protect the endpoint. */
    publicKey: text("public_key").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    fallbackMessage: text("fallback_message")
      .notNull()
      .default("I don't have that in my knowledge base yet."),
    groundingMode: groundingMode("grounding_mode").notNull().default("strict"),
    /** Set when a human accepted the cost/liability risks of leaving strict.
     *  Null while strict. Never cleared silently — it is an audit record. */
    groundingModeAckAt: timestamp("grounding_mode_ack_at", { withTimezone: true }),
    groundingModeAckBy: uuid("grounding_mode_ack_by").references(() => users.id, {
      onDelete: "set null",
    }),
    gateThreshold: text("gate_threshold").notNull().default("0.45"),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    monthlyMessageQuota: integer("monthly_message_quota").notNull().default(2000),
    suggestedPrompts: text("suggested_prompts").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bots_public_key_key").on(t.publicKey),
    index("bots_org_id_idx").on(t.orgId),
  ],
);

/**
 * A bot owns a COLLECTION of pets, one active — swappable like a wallpaper.
 * Modelled as rows rather than a `pet_spec` column on `bots` from day one,
 * because retrofitting a collection onto a single column means migrating every
 * bot and rewriting the config endpoint.
 */
export const pets = pgTable(
  "pets",
  {
    id: id(),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A validated `PetSpec`. ~370 bytes, which is why hot-swap is a data change. */
    spec: jsonb("spec").notNull(),
    createdFromPrompt: text("created_from_prompt"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("pets_bot_id_idx").on(t.botId),
    // Exactly one active pet per bot. Partial, so inactive pets are unconstrained.
    uniqueIndex("pets_one_active_per_bot")
      .on(t.botId)
      .where(sql`${t.isActive}`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    sourceType: sourceType("source_type").notNull(),
    title: text("title").notNull(),
    /** Null for snippets, which have no object behind them. */
    s3Key: text("s3_key"),
    sourceUrl: text("source_url"),
    status: documentStatus("status").notNull().default("queued"),
    error: text("error"),
    /** Content hash. Makes re-ingesting the same bytes a no-op and lets a
     *  re-upload swap versions atomically instead of duplicating chunks. */
    checksum: text("checksum").notNull(),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: createdAt(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
  },
  (t) => [
    index("documents_bot_id_idx").on(t.botId),
    uniqueIndex("documents_bot_checksum_key").on(t.botId, t.checksum),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    /** Denormalised from `documents` on purpose: it lets every retrieval query
     *  pre-filter without a join, which is the hot path. */
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    /** "Billing › Refunds › EU". Prepended before embedding — the cheapest
     *  precision win available, and most pipelines throw it away. */
    headingPath: text("heading_path").notNull().default(""),
    /** The chunk as retrieved and shown to the user. */
    content: text("content").notNull(),
    /** 1-2 sentences situating the chunk in its parent document, written once at
     *  ingest and prepended before embedding only. Never shown to the reader. */
    context: text("context"),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    /** Maintained by Postgres, not by us. A generated column cannot drift out of
     *  sync with `content` the way a trigger or an application write can, and it
     *  deletes the "remember to recompute the tsvector" step from ingest entirely.
     *  `to_tsvector(regconfig, text)` is IMMUTABLE, which is what makes it legal here. */
    tsv: tsvector("tsv").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${chunks.headingPath}, '') || ' ' || ${chunks.content})`,
    ),
    /** Set by the ingest-time injection scan. Chunks are still indexed — this is
     *  legitimate content often enough — but the owner gets to see the flag. */
    injectionFlags: text("injection_flags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    index("chunks_bot_id_idx").on(t.botId),
    index("chunks_document_id_idx").on(t.documentId),
    // vector_ip_ops is valid ONLY because embeddings arrive unit-normalised from
    // the API (outputDimensionality request). With |v|=1, inner product and
    // cosine rank identically and IP is marginally cheaper. If the provider ever
    // returns un-normalised vectors, this index silently ranks wrong.
    index("chunks_embedding_hnsw")
      .using("hnsw", t.embedding.op("vector_ip_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("chunks_tsv_gin").using("gin", t.tsv),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    /** Opaque per-visitor id from the widget. Never a user identifier. */
    visitorId: text("visitor_id"),
    origin: text("origin"),
    createdAt: createdAt(),
  },
  (t) => [index("conversations_bot_id_idx").on(t.botId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** What retrieval actually returned. Powers citations, the debug panel, and
     *  turning a real conversation into an eval case. */
    retrievedChunkIds: uuid("retrieved_chunk_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Top post-rerank score and the gate's verdict, stored as they were at
     *  answer time — thresholds change, and a stored score must not re-decide. */
    topScore: text("top_score"),
    gateDecision: text("gate_decision"),
    /** null = no feedback, true = thumbs up. Feeds the eval set. */
    helpful: boolean("helpful"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_id_idx").on(t.conversationId),
    index("messages_bot_id_idx").on(t.botId),
  ],
);

export const evalQuestions = pgTable(
  "eval_questions",
  {
    id: id(),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** Chunks a correct answer must retrieve. The golden set. */
    expectedChunkIds: uuid("expected_chunk_ids").array().notNull().default(sql`'{}'::uuid[]`),
    expectedAnswer: text("expected_answer"),
    /** True when this came from a real thumbs-down rather than being authored. */
    fromFeedback: boolean("from_feedback").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("eval_questions_bot_id_idx").on(t.botId)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_bot_created_idx").on(t.botId, t.createdAt)],
);
