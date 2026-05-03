-- ============================================================
-- cron_run_log (SOC 2 CC4.1 / CC7.2 / A1.2)
--
-- Records every execution of a cron route. Today crons return 200/JSON and
-- the only history is in Vercel Cron logs (which expire and aren't readily
-- exportable to an auditor). This table gives us:
--
--   * monthly evidence pull for SOC 2 ("here are 30 days of cron runs, all
--     succeeded except these 3 which we investigated")
--   * UI surface for the admin dashboard ("last gdpr-erasure cron at 03:01
--     processed 2 accounts in 4.2s")
--   * alertable signal — any row with status='failed' triggers Sentry capture
--     in the cron wrapper
--
-- One row per cron execution. Wrap every cron handler with a helper that
-- inserts a 'started' row up front, then UPDATEs status + completed_at +
-- counts on exit.
--
-- Append-mostly (only the wrapper UPDATEs to flip status from 'started' to
-- 'success'/'failed' on completion). RLS read by org admins (none — crons
-- are platform-wide, no org scoping).
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifies the cron. By convention matches the route segment, e.g.
  -- 'expunge-deleted-accounts', 'reap-stuck-documents', 'reset-budgets',
  -- 'key-rotation-reminders'.
  job_name        text        NOT NULL,

  -- 'started' is written up front; the wrapper UPDATEs to one of the
  -- terminal values on exit. 'timed_out' is set by a separate sweeper for
  -- rows still 'started' after >10× the expected duration (defence-in-depth
  -- for crashes that never returned).
  status          text        NOT NULL DEFAULT 'started'
                              CHECK (status IN ('started', 'success', 'failed', 'timed_out')),

  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,

  -- Free-form counters the cron emits. e.g. expunge writes
  -- {"accounts_processed": 2, "deals_transferred": 1}. UI renders the JSON
  -- as-is; auditors get structured rollup.
  metrics         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- On failure, the .message of the thrown error. Stack traces stay in
  -- Sentry (linked via request_id below). Truncated to 2000 chars.
  error_message   text,

  -- Vercel sends an x-vercel-id header per invocation; we also generate a
  -- request_id ourselves so the row links back to Sentry / log lines.
  request_id      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- Indexes ----------
-- Job-history queries ("when did expunge last run?"):
CREATE INDEX IF NOT EXISTS idx_cron_run_log_job_time
  ON public.cron_run_log (job_name, started_at DESC);

-- Failed-runs scans ("any failures this week?"):
CREATE INDEX IF NOT EXISTS idx_cron_run_log_status_time
  ON public.cron_run_log (status, started_at DESC) WHERE status IN ('failed', 'timed_out');

-- Sweeper for stuck 'started' rows:
CREATE INDEX IF NOT EXISTS idx_cron_run_log_started_open
  ON public.cron_run_log (started_at) WHERE status = 'started';

-- ---------- RLS ----------
-- Crons are platform-wide; no org scoping. Read access via service-role
-- (admin dashboard, evidence script). No tenant should see this directly.
ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

-- Platform admins (PLATFORM_ADMIN_EMAILS env, enforced in the API layer)
-- read via service-role client, which bypasses RLS. No authenticated-role
-- policy means non-platform users see nothing — correct posture for an
-- ops-only table.

-- ---------- Helper RPCs ----------
-- Open a run row. Returns the id so the wrapper can UPDATE it on exit.
CREATE OR REPLACE FUNCTION public.cron_run_open(
  p_job_name   text,
  p_request_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_job_name IS NULL OR length(trim(p_job_name)) = 0 THEN
    RAISE EXCEPTION 'cron_run_open: job_name is required';
  END IF;

  INSERT INTO public.cron_run_log (job_name, request_id, status, started_at)
  VALUES (
    trim(p_job_name),
    NULLIF(left(coalesce(p_request_id, ''), 64), ''),
    'started',
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Close a run row. Computes duration_ms server-side so cron handlers don't
-- have to track it.
CREATE OR REPLACE FUNCTION public.cron_run_close(
  p_id            uuid,
  p_status        text,
  p_metrics       jsonb DEFAULT '{}'::jsonb,
  p_error_message text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('success', 'failed', 'timed_out') THEN
    RAISE EXCEPTION 'cron_run_close: status must be success | failed | timed_out (got %)', p_status;
  END IF;

  UPDATE public.cron_run_log
     SET status        = p_status,
         completed_at  = now(),
         duration_ms   = EXTRACT(EPOCH FROM (now() - started_at))::integer * 1000,
         metrics       = coalesce(p_metrics, '{}'::jsonb),
         error_message = NULLIF(left(coalesce(p_error_message, ''), 2000), '')
   WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cron_run_open  TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_run_close TO service_role;

-- ---------- Convenience view: 30-day rollup per job ----------
-- Powers the SOC 2 evidence script and the ops dashboard.
CREATE OR REPLACE VIEW public.cron_run_log_30d_rollup AS
  SELECT
    job_name,
    count(*)                                  AS runs,
    count(*) FILTER (WHERE status = 'success')   AS successes,
    count(*) FILTER (WHERE status = 'failed')    AS failures,
    count(*) FILTER (WHERE status = 'timed_out') AS timed_out,
    max(started_at)                           AS last_run_at,
    avg(duration_ms)::integer                 AS avg_duration_ms,
    max(duration_ms)                          AS max_duration_ms
  FROM public.cron_run_log
 WHERE started_at >= now() - interval '30 days'
 GROUP BY job_name;
GRANT SELECT ON public.cron_run_log_30d_rollup TO service_role;

COMMENT ON TABLE public.cron_run_log IS
  'Per-execution log for cron routes. Open via cron_run_open(), close via cron_run_close(). See lib/cronWrapper.js for the helper that wraps every handler. SOC 2: CC4.1, CC7.2, A1.2.';
