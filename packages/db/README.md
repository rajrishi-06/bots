# @bots/db

Postgres 16 + pgvector. Drizzle schema, migrations, and the two invariants the
database enforces instead of the application.

```bash
docker compose up -d                      # postgres:5433, redis:6380
pnpm --filter @bots/db migrate            # extension + schema + RLS
pnpm --filter @bots/db test               # proves isolation + one-active-pet
```

## Connect as `bots_app`, never as the master user

The master user is a **superuser**, and superusers bypass row-level security
even with `FORCE ROW LEVEL SECURITY`. Serving traffic with it silently disables
every tenant-isolation policy. `src/isolation.test.ts` asserts both halves.

The API sets exactly one scope per transaction:

```sql
SET LOCAL app.bot_id = '<uuid>';   -- widget traffic
SET LOCAL app.org_id = '<uuid>';   -- dashboard traffic
```

Unset means zero rows, not all rows.

## Migrations, not push

`drizzle-kit push` diffs the live database against `schema.ts` and would try to
"fix" the generated `tsv` column and drop the hand-written RLS policies, which
it cannot see. The `push` script is deliberately absent.
