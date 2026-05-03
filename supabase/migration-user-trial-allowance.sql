-- migration-user-trial-allowance.sql
--
-- Per-user trial allowance — bridges the gap between anonymous play (capped
-- by per-IP rate-limits) and paid org usage (capped by `organizations.
-- monthly_token_budget`). A signed-in user without an org membership gets
-- ~50,000 platform-paid tokens to demonstrate value (one process audit + a
-- few chat turns). Once exhausted, the chat / analyse / categorise paths
-- block with a "create an organisation and paste your Anthropic key" gate.
--
-- Distinct from `organizations.monthly_token_budget` because:
--   • Org budget is per-(org, month) and resets monthly.
--   • Trial allowance is per-user and never resets — the conversion path
--     is BYO API key, not waiting out the cooldown.

CREATE TABLE IF NOT EXISTS public.user_trial_allowance (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              text        NOT NULL,
  granted_tokens     bigint      NOT NULL DEFAULT 50000,
  consumed_tokens    bigint      NOT NULL DEFAULT 0,
  exhausted_at       timestamptz,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  -- Free-form notes for support credits / extensions / promos.
  notes              text
);

CREATE INDEX IF NOT EXISTS idx_user_trial_allowance_email
  ON public.user_trial_allowance (email);

COMMENT ON TABLE public.user_trial_allowance IS
  'Per-user one-shot trial allowance against the platform LLM keys. Distinct from org budgets — conversion path is BYO API key, not a reset.';

-- ──────────────────────────────────────────────────────────────────────
-- Atomic increment RPC. Mirrors organizations.bump_token_usage.
-- Inserts the row on first call (so users created before this migration
-- still get an allowance), increments thereafter. Sets exhausted_at the
-- moment we cross the threshold. Returns the post-bump state so callers
-- can decide whether the next call should be allowed.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_user_trial_usage(
  p_user_id uuid,
  p_email   text,
  p_tokens  bigint
) RETURNS TABLE (
  consumed       bigint,
  granted        bigint,
  exhausted      boolean,
  just_exhausted boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_consumed       bigint;
  v_granted        bigint;
  v_was_exhausted  boolean;
  v_now_exhausted  boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF p_tokens < 0 THEN
    p_tokens := 0;
  END IF;

  -- Insert-or-bump in one statement. Capture the previous exhausted flag
  -- via a CTE so we can tell callers whether THIS bump tipped us over.
  WITH prev AS (
    SELECT (consumed_tokens >= granted_tokens) AS was_exhausted
      FROM public.user_trial_allowance
     WHERE user_id = p_user_id
  ), upserted AS (
    INSERT INTO public.user_trial_allowance (user_id, email, consumed_tokens)
    VALUES (p_user_id, lower(trim(p_email)), p_tokens)
    ON CONFLICT (user_id) DO UPDATE
      SET consumed_tokens = public.user_trial_allowance.consumed_tokens + EXCLUDED.consumed_tokens,
          exhausted_at = CASE
            WHEN public.user_trial_allowance.consumed_tokens + EXCLUDED.consumed_tokens
                 >= public.user_trial_allowance.granted_tokens
              AND public.user_trial_allowance.exhausted_at IS NULL
            THEN now()
            ELSE public.user_trial_allowance.exhausted_at
          END
    RETURNING consumed_tokens, granted_tokens
  )
  SELECT u.consumed_tokens, u.granted_tokens,
         (u.consumed_tokens >= u.granted_tokens),
         COALESCE((SELECT was_exhausted FROM prev), false)
    INTO v_consumed, v_granted, v_now_exhausted, v_was_exhausted
    FROM upserted u;

  RETURN QUERY SELECT
    v_consumed,
    v_granted,
    v_now_exhausted,
    (v_now_exhausted AND NOT v_was_exhausted);
END
$$;

REVOKE ALL ON FUNCTION public.bump_user_trial_usage(uuid,text,bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.bump_user_trial_usage(uuid,text,bigint) TO service_role;

COMMENT ON FUNCTION public.bump_user_trial_usage(uuid,text,bigint) IS
  'Atomic increment of a user trial allowance. Returns post-bump (consumed, granted, exhausted, just_exhausted). Service-role only.';

-- Default-allowance read helper. RPC so the API can resolve "do they have
-- a row yet?" + "what does the row say?" in one call instead of a SELECT
-- + maybe-INSERT race.
CREATE OR REPLACE FUNCTION public.get_user_trial_allowance(
  p_user_id uuid,
  p_email   text
) RETURNS TABLE (
  granted_tokens   bigint,
  consumed_tokens  bigint,
  exhausted        boolean,
  granted_at       timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Lazy-create on first read so existing accounts get the trial automatically.
  INSERT INTO public.user_trial_allowance (user_id, email)
  VALUES (p_user_id, lower(trim(p_email)))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY
    SELECT a.granted_tokens, a.consumed_tokens,
           (a.consumed_tokens >= a.granted_tokens), a.granted_at
      FROM public.user_trial_allowance a
     WHERE a.user_id = p_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.get_user_trial_allowance(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_trial_allowance(uuid,text) TO service_role;
