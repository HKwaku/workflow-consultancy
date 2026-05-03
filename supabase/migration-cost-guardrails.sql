-- ============================================================
-- Cost guardrails: per-organisation token budget
--
-- Prevents an unbounded LLM bill: a user uploading a 5,000-page deal
-- and re-running diligence 10× can quietly cost $50-$200. This adds a
-- soft + hard cap per organisation, reset monthly.
--
-- Columns added to organizations:
--   monthly_token_budget       - hard cap (BIGINT, NULL = unlimited)
--   tokens_consumed_this_month - running tally; reset on the 1st via cron
--   budget_period_started_at   - when the current period began
--   budget_alerted_at_80pct    - debounce flag for the soft warning
--
-- A separate per-call ledger lets us debug "where did the spend come from?"
-- without parsing app logs. The ledger is append-only and can be aggregated
-- for analytics.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS monthly_token_budget       BIGINT,
  ADD COLUMN IF NOT EXISTS tokens_consumed_this_month BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_period_started_at   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  ADD COLUMN IF NOT EXISTS budget_alerted_at_80pct    TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.monthly_token_budget IS
  'Hard cap on tokens (Anthropic input+output + Voyage embedding) per calendar month. NULL = unlimited (legacy / trusted orgs).';
COMMENT ON COLUMN public.organizations.tokens_consumed_this_month IS
  'Running tally; reset to 0 by the monthly cron.';

-- ---------- Per-call ledger ----------
CREATE TABLE IF NOT EXISTS public.token_usage_ledger (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_email      text,
  vendor          text        NOT NULL CHECK (vendor IN ('anthropic', 'voyage')),
  model           text,
  surface         text        NOT NULL,                  -- 'deal_analysis' | 'diagnostic_chat' | 'embedding' | 'recommendations' | ...
  ref_id          text,                                  -- deal_id, report_id, document_id, etc.
  input_tokens    integer     NOT NULL DEFAULT 0,
  output_tokens   integer     NOT NULL DEFAULT 0,
  total_tokens    integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_org_time
  ON public.token_usage_ledger (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_surface
  ON public.token_usage_ledger (surface, created_at DESC);

COMMENT ON TABLE public.token_usage_ledger IS
  'Append-only per-call token usage. Aggregated into organizations.tokens_consumed_this_month for the running total.';

-- ---------- Atomic check + increment helper ----------
-- Returns the post-increment total. If the org has no budget set, increments
-- without checking. If incrementing would exceed the budget, raises an
-- exception (caught by the API layer and surfaced as a 402).
CREATE OR REPLACE FUNCTION public.bump_token_usage(
  p_org_id    uuid,
  p_tokens    bigint
)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_budget   bigint;
  v_current  bigint;
  v_new      bigint;
BEGIN
  IF p_org_id IS NULL THEN
    -- Pre-org-membership users (early adopters); just no-op.
    RETURN 0;
  END IF;

  SELECT monthly_token_budget, tokens_consumed_this_month
    INTO v_budget, v_current
    FROM public.organizations
   WHERE id = p_org_id
   FOR UPDATE;

  v_new := COALESCE(v_current, 0) + p_tokens;

  IF v_budget IS NOT NULL AND v_new > v_budget THEN
    RAISE EXCEPTION 'token_budget_exceeded'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('budget=%s consumed=%s requested=%s', v_budget, v_current, p_tokens);
  END IF;

  UPDATE public.organizations
     SET tokens_consumed_this_month = v_new
   WHERE id = p_org_id;

  RETURN v_new;
END;
$$;

COMMENT ON FUNCTION public.bump_token_usage IS
  'Atomic check + increment. Raises check_violation when over-budget; caller catches and returns 402.';

-- ---------- Monthly reset (called by cron, see /api/cron/reset-budgets) ----------
CREATE OR REPLACE FUNCTION public.reset_monthly_budgets()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.organizations
     SET tokens_consumed_this_month = 0,
         budget_period_started_at   = date_trunc('month', now()),
         budget_alerted_at_80pct    = NULL
   WHERE budget_period_started_at < date_trunc('month', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
