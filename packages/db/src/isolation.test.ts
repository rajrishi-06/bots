import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The two invariants the database enforces rather than the application.
 *
 * These are acceptance criteria, not unit tests: a cross-tenant leak kills the
 * product, and two active pets makes the widget's rendered pet depend on row
 * order. Both are cheap to assert and expensive to discover in production.
 *
 * Requires the local stack: `docker compose up -d && pnpm --filter @bots/db migrate`.
 */

// The owner connection is the PRIVILEGED one — it grants bots_app its password
// and seeds fixtures. DATABASE_URL is bots_app itself, which can do neither.
const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? "postgres://bots:bots@localhost:5433/bots";
const APP_URL = process.env.DATABASE_URL ?? "postgres://bots_app:test@localhost:5433/bots";

let owner: postgres.Sql;
let app: postgres.Sql;
let orgId: string;
let botA: string;
let botB: string;

/** Run with an ORG scope set, exactly as the dashboard does. */
async function asOrg<T>(orgId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    if (orgId) await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    return fn(tx);
  }) as Promise<T>;
}

/** Run one statement with a tenant scope set, exactly as the API does. */
async function asBot<T>(botId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    if (botId) await tx.unsafe(`SET LOCAL app.bot_id = '${botId}'`);
    return fn(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  owner = postgres(OWNER_URL, { max: 1 });

  // The app role ships NOLOGIN from the migration — production gives it a
  // Secrets Manager password via CDK. The test grants its own.
  await owner.unsafe(`ALTER ROLE bots_app WITH LOGIN PASSWORD 'test'`);
  app = postgres(APP_URL, { max: 2 });

  const [org] = await owner`INSERT INTO organizations (name) VALUES ('Acme') RETURNING id`;
  orgId = org!.id;
  const [a] = await owner`INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'A', 'pb_live_a') RETURNING id`;
  const [b] = await owner`INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'B', 'pb_live_b') RETURNING id`;
  botA = a!.id;
  botB = b!.id;

  for (const [botId, title, body] of [
    [botA, "A doc", "Acme refunds take 14 days in the EU."],
    [botB, "B doc", "Beta corp offers no refunds whatsoever."],
  ] as const) {
    const [doc] = await owner`
      INSERT INTO documents (bot_id, source_type, title, checksum)
      VALUES (${botId}, 'upload', ${title}, ${title}) RETURNING id`;
    await owner`
      INSERT INTO chunks (bot_id, document_id, ordinal, heading_path, content)
      VALUES (${botId}, ${doc!.id}, 0, 'Billing', ${body})`;
  }
});

afterAll(async () => {
  // Cascades through bots → documents → chunks → pets, so the run leaves nothing.
  if (owner && orgId) await owner`DELETE FROM organizations WHERE id = ${orgId}`;
  await owner?.end();
  await app?.end();
});

describe("tenant isolation", () => {
  it("a superuser BYPASSES rls entirely — this is the trap, not the protection", async () => {
    // FORCE ROW LEVEL SECURITY binds the table owner, but nothing binds a
    // superuser. The default docker/RDS master user is one. If the API ever
    // connects with it, every policy in 0001 is inert.
    //
    // Scoped to this test's two bots rather than counting the whole table:
    // suites in other packages run concurrently against the same database, and
    // the claim under test is "sees BOTH tenants", not "the database is empty".
    // An RLS-bound role with no scope set returns 0 here.
    const rows = await owner`SELECT bot_id FROM chunks WHERE bot_id IN (${botA}, ${botB})`;
    expect(rows.length).toBe(2);

    const [role] = await owner`SELECT usesuper FROM pg_user WHERE usename = current_user`;
    expect(role!.usesuper).toBe(true);
  });

  it("scoped to bot A, an unfiltered SELECT returns only bot A's chunks", async () => {
    // Deliberately no WHERE clause: this is the "someone forgot the filter" case.
    const rows = await asBot(botA, (tx) => tx`SELECT bot_id, content FROM chunks`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.bot_id).toBe(botA);
    expect(rows[0]!.content).toContain("Acme");
  });

  it("scoped to bot B, the same query returns only bot B's chunks", async () => {
    const rows = await asBot(botB, (tx) => tx`SELECT bot_id, content FROM chunks`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.bot_id).toBe(botB);
  });

  it("bot A's scope cannot reach bot B's chunks even when it names them explicitly", async () => {
    const rows = await asBot(botA, (tx) => tx`SELECT id FROM chunks WHERE bot_id = ${botB}`);
    expect(rows.length).toBe(0);
  });

  it("an unscoped connection sees nothing — fail closed", async () => {
    const rows = await asBot(null, (tx) => tx`SELECT id FROM chunks`);
    expect(rows.length).toBe(0);
  });

  it("refuses to write a row into another tenant", async () => {
    await expect(
      asBot(botA, async (tx) => {
        const [doc] = await tx`SELECT id FROM documents LIMIT 1`;
        return tx`
          INSERT INTO chunks (bot_id, document_id, ordinal, content)
          VALUES (${botB}, ${doc!.id}, 99, 'smuggled')`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("isolates conversations and messages too, not just chunks", async () => {
    const [conv] = await owner`
      INSERT INTO conversations (bot_id, visitor_id) VALUES (${botB}, 'v1') RETURNING id`;
    await owner`
      INSERT INTO messages (conversation_id, bot_id, role, content)
      VALUES (${conv!.id}, ${botB}, 'user', 'secret question')`;

    const convs = await asBot(botA, (tx) => tx`SELECT id FROM conversations`);
    const msgs = await asBot(botA, (tx) => tx`SELECT id FROM messages`);
    expect(convs.length).toBe(0);
    expect(msgs.length).toBe(0);
  });
});

describe("org scope — the dashboard's view", () => {
  // The child tables key on app.bot_id, which is right for the widget: it serves
  // one bot. But the dashboard lists an ORG's bots and counts their documents in
  // one query, with no single bot_id to set — and every count came back 0.
  // Silently empty is the worst way for an authorisation rule to be wrong.
  it("sees the children of every bot in its own org", async () => {
    const rows = await asOrg(orgId, (tx) => tx`SELECT bot_id FROM chunks`);
    expect(rows.length).toBe(2); // one from bot A, one from bot B
  });

  it("does NOT see another org's children", async () => {
    const [other] = await owner`INSERT INTO organizations (name) VALUES ('Rival') RETURNING id`;
    try {
      const rows = await asOrg(other!.id, (tx) => tx`SELECT id FROM chunks`);
      expect(rows.length).toBe(0);
    } finally {
      await owner`DELETE FROM organizations WHERE id = ${other!.id}`;
    }
  });

  it("still returns nothing with no scope at all", async () => {
    const rows = await asOrg(null, (tx) => tx`SELECT id FROM chunks`);
    expect(rows.length).toBe(0);
  });

  it("a bot scope stays narrow even though the org branch exists", async () => {
    // The widget path sets only app.bot_id, so the org branch must not widen it.
    const rows = await asBot(botA, (tx) => tx`SELECT bot_id FROM chunks`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.bot_id).toBe(botA);
  });
});

describe("exactly one active pet per bot", () => {
  const spec = { v: 1, name: "t", skeleton: "balanced" };

  it("allows many inactive pets", async () => {
    for (const n of ["p1", "p2", "p3"]) {
      await owner`INSERT INTO pets (bot_id, name, spec, is_active) VALUES (${botA}, ${n}, ${owner.json(spec)}, false)`;
    }
    const rows = await owner`SELECT count(*)::int AS n FROM pets WHERE bot_id = ${botA}`;
    expect(rows[0]!.n).toBe(3);
  });

  it("allows one active pet", async () => {
    await owner`INSERT INTO pets (bot_id, name, spec, is_active) VALUES (${botA}, 'active', ${owner.json(spec)}, true)`;
    const rows = await owner`SELECT count(*)::int AS n FROM pets WHERE bot_id = ${botA} AND is_active`;
    expect(rows[0]!.n).toBe(1);
  });

  it("rejects a SECOND active pet for the same bot", async () => {
    await expect(
      owner`INSERT INTO pets (bot_id, name, spec, is_active) VALUES (${botA}, 'second', ${owner.json(spec)}, true)`,
    ).rejects.toThrow(/pets_one_active_per_bot|duplicate key/i);
  });

  it("lets a DIFFERENT bot have its own active pet", async () => {
    await owner`INSERT INTO pets (bot_id, name, spec, is_active) VALUES (${botB}, 'b-active', ${owner.json(spec)}, true)`;
    const rows = await owner`
      SELECT count(*)::int AS n FROM pets WHERE is_active AND bot_id IN (${botA}, ${botB})`;
    expect(rows[0]!.n).toBe(2);
  });
});
