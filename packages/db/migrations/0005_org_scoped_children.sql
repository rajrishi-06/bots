-- Let an org-scoped connection see its own bots' children.
--
-- The child tables (pets, documents, chunks, …) key only on app.bot_id, which
-- is exactly right for the widget: it serves one bot and must never see another.
-- But the dashboard lists an ORG's bots and counts their documents and pets in
-- one query, and there is no single bot_id to set for that. Every count came
-- back 0 — not an error, just silently empty, which is the worst way for an
-- authorisation rule to be wrong.
--
-- The org branch is guarded on app.org_id being set, so the widget path (which
-- sets only app.bot_id) never evaluates the subquery at all.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pets','documents','chunks','conversations','messages','eval_questions','usage_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (
          bot_id::text = current_setting('app.bot_id', true)
          OR (
            current_setting('app.org_id', true) IS NOT NULL
            AND bot_id IN (
              SELECT b.id FROM bots b
              WHERE b.org_id::text = current_setting('app.org_id', true)
            )
          )
        )
        WITH CHECK (
          bot_id::text = current_setting('app.bot_id', true)
          OR (
            current_setting('app.org_id', true) IS NOT NULL
            AND bot_id IN (
              SELECT b.id FROM bots b
              WHERE b.org_id::text = current_setting('app.org_id', true)
            )
          )
        )
    $f$, t);
  END LOOP;
END $$;
