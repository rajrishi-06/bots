-- Bootstrap lookup for the public widget path.
--
-- RLS on `bots` admits a row only when app.org_id or app.bot_id already matches.
-- The widget has neither: it arrives with a public key and nothing else, and
-- resolving that key is what PRODUCES the scope. Unscoped, the lookup returned
-- zero rows and no bot could ever be served — a hole that failed closed and
-- silently, which is the good direction to fail but still broken.
--
-- SECURITY DEFINER runs this one query as the function owner, bypassing RLS for
-- exactly this lookup and nothing else. It is safe to expose because:
--   - it takes a public key and returns at most the single row matching it, so
--     it cannot enumerate bots;
--   - it returns only the fields the widget needs — no org_id, no internal state;
--   - search_path is pinned, so a caller cannot shadow `bots` with their own
--     table and trick the definer into reading it.
CREATE FUNCTION resolve_bot_by_key(p_key text)
RETURNS TABLE (
  id uuid,
  name text,
  system_prompt text,
  fallback_message text,
  grounding_mode grounding_mode,
  gate_threshold text,
  allowed_origins text[],
  monthly_message_quota integer,
  suggested_prompts text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.name, b.system_prompt, b.fallback_message, b.grounding_mode,
         b.gate_threshold, b.allowed_origins, b.monthly_message_quota, b.suggested_prompts
  FROM bots b
  WHERE b.public_key = p_key
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_bot_by_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_bot_by_key(text) TO bots_app;
