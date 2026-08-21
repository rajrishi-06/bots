import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Run migrations.
 *
 * `CREATE EXTENSION` happens here rather than inside a migration because it is
 * a bootstrap concern, not a schema change: it must exist before the first
 * migration's `vector(1024)` column can parse, and it is idempotent.
 */
export async function runMigrations(
  // MIGRATION_DATABASE_URL first, and it matters: DATABASE_URL points at
  // `bots_app`, which migrations are the thing that CREATES. Running them as the
  // application user is a chicken-and-egg that fails with a bare
  // "password authentication failed" and no hint about why.
  url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
): Promise<void> {
  if (!url) throw new Error("Set MIGRATION_DATABASE_URL (the privileged connection).");
  // max: 1 — migrations must run on a single connection, in order.
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await migrate(db, {
      migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"),
    });
  } finally {
    await client.end();
  }
}

// `node --experimental-strip-types src/migrate.ts` or via the package script.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
