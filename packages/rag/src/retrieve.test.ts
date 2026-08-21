import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retrieve, rewriteQuery, CANDIDATE_K } from "./retrieve.js";
import { FakeProvider, FakeReranker, fakeEmbed } from "./testing.js";

/**
 * The pipeline against a real Postgres with real pgvector and real tsvector
 * search. The MODEL is faked; the retrieval is not.
 *
 * Requires: docker compose up -d && pnpm --filter @bots/db migrate
 */

const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? "postgres://bots:bots@localhost:5433/bots";

let sql: postgres.Sql;
let orgId: string;
let botId: string;
let otherBotId: string;
const provider = new FakeProvider();
const reranker = new FakeReranker();

const CORPUS = [
  ["Billing › Refunds › EU", "EU customers may request a refund within 14 days of purchase under distance selling rules."],
  ["Billing › Refunds › US", "US customers may request a refund within 30 days of purchase."],
  ["Billing › Invoices", "Invoices are issued monthly and emailed to the billing contact on the account."],
  ["Onboarding › Setup", "Install the CLI, run the init command, and connect your first data source."],
  ["Security › SSO", "Single sign-on is available on enterprise plans via SAML and OIDC."],
] as const;

async function seedChunk(bot: string, doc: string, ordinal: number, path: string, content: string) {
  // Embed exactly what the ingest pipeline embeds: heading path + content.
  const vec = fakeEmbed(`${path}\n${content}`);
  await sql`
    INSERT INTO chunks (bot_id, document_id, ordinal, heading_path, content, embedding)
    VALUES (${bot}, ${doc}, ${ordinal}, ${path}, ${content}, ${`[${vec.join(",")}]`}::vector)`;
}

beforeAll(async () => {
  sql = postgres(OWNER_URL, { max: 4 });
  const [org] = await sql`INSERT INTO organizations (name) VALUES ('RagTest') RETURNING id`;
  orgId = org!.id;
  const [b] = await sql`INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'Main', 'pb_live_rag') RETURNING id`;
  const [o] = await sql`INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'Other', 'pb_live_other') RETURNING id`;
  botId = b!.id;
  otherBotId = o!.id;

  const [doc] = await sql`
    INSERT INTO documents (bot_id, source_type, title, checksum) VALUES (${botId}, 'upload', 'Handbook', 'h1') RETURNING id`;
  for (const [i, [path, content]] of CORPUS.entries()) {
    await seedChunk(botId, doc!.id, i, path, content);
  }

  const [odoc] = await sql`
    INSERT INTO documents (bot_id, source_type, title, checksum) VALUES (${otherBotId}, 'upload', 'Secrets', 'h2') RETURNING id`;
  await seedChunk(otherBotId, odoc!.id, 0, "Secret", "The other tenant's refund policy is no refunds ever.");
});

afterAll(async () => {
  if (sql && orgId) await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  await sql?.end();
});

const run = (query: string, over: Partial<Parameters<typeof retrieve>[0]> = {}) =>
  retrieve({ sql, provider, reranker, botId, query, mode: "strict", ...over });

describe("retrieval", () => {
  it("finds the right chunk for a direct question", async () => {
    const { chunks } = await run("How long do EU customers have to request a refund?");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.content).toContain("14 days");
    expect(chunks[0]!.headingPath).toBe("Billing › Refunds › EU");
  });

  it("returns at most CONTEXT_K chunks, ordered by post-rerank score", async () => {
    const { chunks } = await run("refund");
    expect(chunks.length).toBeLessThanOrEqual(5);
    const scores = chunks.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("records both retrievers' contributions and the per-chunk ranks", async () => {
    const { chunks, trace } = await run("refund within 14 days");
    expect(trace.denseCount).toBeGreaterThan(0);
    expect(trace.bm25Count).toBeGreaterThan(0);
    // ranks is [dense, bm25]; the top chunk should have been found by at least one.
    expect(chunks[0]!.ranks.some((r) => r !== null)).toBe(true);
  });

  it("keeps the pre-rerank score alongside the final one, so the panel can show movement", async () => {
    const { chunks } = await run("single sign-on SAML");
    expect(chunks[0]!.fusedScore).toBeGreaterThan(0);
    expect(chunks[0]!.score).toBeGreaterThanOrEqual(0);
  });

  it("times every stage", async () => {
    const { trace } = await run("invoices");
    expect(Object.keys(trace.timings).sort()).toEqual(["embed", "rerank", "rewrite", "search"]);
  });

  it("lexical search catches an exact term the fake embedder would blur", async () => {
    // "SAML" is a single rare token — precisely the case BM25 exists for.
    const { chunks } = await run("SAML");
    expect(chunks.some((c) => c.content.includes("SAML"))).toBe(true);
  });
});

describe("the relevance gate", () => {
  it("fires in strict mode for an out-of-scope question", async () => {
    const { trace } = await run("What is the capital of France?");
    expect(trace.gate.refuse).toBe(true);
    expect(trace.gate.useContext).toBe(false);
    expect(trace.gate.reason).toMatch(/strict: refused/);
  });

  it("answers the same question in blended mode instead of refusing", async () => {
    const { trace } = await run("What is the capital of France?", { mode: "blended" });
    expect(trace.gate.refuse).toBe(false);
    expect(trace.gate.reason).toMatch(/blended: answering unaided/);
  });

  it("does not fire for an in-scope question", async () => {
    const { trace } = await run("How long do EU customers have to request a refund?");
    expect(trace.gate.refuse).toBe(false);
    expect(trace.gate.useContext).toBe(true);
  });

  it("refuses in strict when the corpus is empty for that bot", async () => {
    const [empty] = await sql`
      INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'Empty', 'pb_live_empty') RETURNING id`;
    const { chunks, trace } = await run("anything at all", { botId: empty!.id });
    expect(chunks).toEqual([]);
    expect(trace.gate.refuse).toBe(true);
    expect(trace.fusedCount).toBe(0);
  });
});

describe("tenant isolation through the pipeline", () => {
  it("never returns another bot's chunks, even for a query that matches them well", async () => {
    const { chunks } = await run("no refunds ever other tenant");
    expect(chunks.every((c) => !c.content.includes("other tenant's"))).toBe(true);
  });

  it("the other bot sees only its own chunk", async () => {
    const { chunks } = await run("refund policy", { botId: otherBotId });
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain("no refunds ever");
  });
});

describe("query rewriting", () => {
  it("skips the model call entirely when there is no history", async () => {
    const before = provider.calls.generateJson;
    const out = await rewriteQuery(provider, "What is the refund window?", []);
    expect(out).toBe("What is the refund window?");
    expect(provider.calls.generateJson).toBe(before);
  });

  it("condenses a follow-up into a standalone query", async () => {
    const condensing = new FakeProvider({ json: { query: "EU refund window" } });
    const out = await rewriteQuery(condensing, "what about the EU one?", [
      { role: "user", content: "What is the US refund window?" },
      { role: "assistant", content: "30 days." },
    ]);
    expect(out).toBe("EU refund window");
  });

  it("falls back to the original query when the rewrite comes back unusable", async () => {
    const broken = new FakeProvider({ json: { query: "   " } });
    const out = await rewriteQuery(broken, "what about the EU one?", [
      { role: "user", content: "US refunds?" },
    ]);
    expect(out).toBe("what about the EU one?");
  });

  it("searches with the rewritten query, and the follow-up then retrieves correctly", async () => {
    const condensing = new FakeProvider({ json: { query: "EU customers refund 14 days" } });
    const { chunks, trace } = await run("what about the EU one?", {
      provider: condensing,
      history: [
        { role: "user", content: "How long do US customers have for a refund?" },
        { role: "assistant", content: "30 days." },
      ],
    });
    expect(trace.rewrittenQuery).toBe("EU customers refund 14 days");
    expect(chunks[0]!.content).toContain("14 days");
  });
});

describe("candidate depth", () => {
  it("asks each retriever for CANDIDATE_K before fusing", () => {
    // Guards the constant against being quietly lowered: rerank quality depends
    // on the reranker seeing a deep-enough candidate pool to reorder.
    expect(CANDIDATE_K).toBeGreaterThanOrEqual(50);
  });
});
