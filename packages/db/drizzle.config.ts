import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // drizzle-kit introspects and writes schema, so it needs the privileged
  // connection — not the application user.
  dbCredentials: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgres://bots:bots@localhost:5433/bots",
  },
});
