-- resolve_bot_by_key gains the new columns.
--
-- The function has a fixed RETURNS TABLE signature, so adding a column to
-- `bots` does not reach the widget until this is replaced. CREATE OR REPLACE
-- cannot change a return type, hence the drop.
DROP FUNCTION IF EXISTS resolve_bot_by_key(text);
--> statement-breakpoint

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
  suggested_prompts text[],
  appearance jsonb,
  actions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.name, b.system_prompt, b.fallback_message, b.grounding_mode,
         b.gate_threshold, b.allowed_origins, b.monthly_message_quota,
         b.suggested_prompts, b.appearance, b.actions
  FROM bots b
  WHERE b.public_key = p_key
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_bot_by_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_bot_by_key(text) TO bots_app;
