-- Row-level security: defence in depth behind the bot_id pre-filter.
--
-- Every retrieval query already filters on bot_id. This makes forgetting that
-- filter return ZERO rows instead of somebody else's documents. A cross-tenant
-- leak is the one bug that kills this product outright, so it does not rest on
-- remembering a WHERE clause in a hot path that will be edited many times.
--
-- The connection sets exactly one of these per transaction:
--     SET LOCAL app.bot_id = '<uuid>'   -- widget traffic, one bot
--     SET LOCAL app.org_id = '<uuid>'   -- dashboard traffic, one org
--
-- current_setting(..., true) returns NULL when unset, and `col = NULL` is NULL,
-- so an unscoped connection sees nothing. Fail-closed is the entire point.
--
-- ⚠ NONE OF THIS APPLIES TO A SUPERUSER. FORCE ROW LEVEL SECURITY binds the
-- table owner, but nothing binds a superuser — and the default Postgres master
-- user (docker's POSTGRES_USER, RDS's master user) is one. If the API or worker
-- connects with that account, every policy below is inert and the isolation is
-- theatre. The API and worker MUST connect as `bots_app`.
-- `src/isolation.test.ts` asserts both halves of this.

CREATE ROLE bots_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO bots_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bots_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bots_app;
--> statement-breakpoint

-- Bot-scoped tables. These are the ones the public widget path touches.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pets','documents','chunks','conversations','messages','eval_questions','usage_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so the table owner is bound by the policy too. Without this, the
    -- migration role silently bypasses RLS and the protection is theatre.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (bot_id::text = current_setting('app.bot_id', true))
        WITH CHECK (bot_id::text = current_setting('app.bot_id', true))
    $f$, t);
  END LOOP;
END $$;
--> statement-breakpoint

-- `bots` is scoped by org, not by bot: the dashboard lists an org's bots, and
-- the widget resolves one bot by public key before it has a bot_id to set.
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON bots
  USING (
    org_id::text = current_setting('app.org_id', true)
    OR id::text = current_setting('app.bot_id', true)
  )
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
