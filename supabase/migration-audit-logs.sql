-- ============================================================
-- General-purpose audit_logs (SOC 2 CC2.1 / CC4.2 / CC6.7)
--
-- One append-only ledger for security-relevant events across the platform.
-- Supplements customer_api_key_audit (which only records BYO-key events) by
-- giving auditors a single place to sample "who did what when" for:
--
--   * deal access      — read/write/export of deal_documents, deal_findings,
--                        deal_finding_reviews, deal_analyses
--   * member changes   — invite, role/entitlement change, removal
--   * org admin acts   — model allowlist edits, budget changes, key sets
--   * GDPR             — erasure requested, granted, completed
--   * service-role     — any write that bypassed RLS via service role
--
-- Append-only by RLS — no UPDATE / DELETE policy. INSERT is via the
-- audit_log_event() RPC (SECURITY DEFINER) so callers can't forge a
-- different actor.
--
-- Retention: 12 months minimum for SOC 2 sampling. A retention cron may
-- archive rows older than that to cold storage, but never deletes them.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- The ledger ----------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who. actor_user_id is from auth.uid() if available; actor_email is the
  -- normalised lower(trim()) form. Both are nullable because background jobs
  -- (cron, Inngest worker) act on behalf of "the system".
  actor_user_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email     text,
  actor_kind      text        NOT NULL DEFAULT 'user'
                              CHECK (actor_kind IN ('user', 'system', 'cron', 'worker', 'service_role')),

  -- What. action is freeform but conventionally lower_snake (e.g. 'deal.read',
  -- 'member.role_changed', 'gdpr.erasure_requested'). target_type / target_id
  -- locate the affected row when relevant.
  action          text        NOT NULL,
  target_type     text,
  target_id       text,

  -- Where. organization_id scopes the event for multi-tenant filtering.
  -- deal_id is denormalised so deal-scoped queries don't need a join.
  organization_id uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  deal_id         uuid        REFERENCES public.deals(id) ON DELETE SET NULL,

  -- How / additional context. request_id ties to the API request log line in
  -- Sentry. ip / user_agent are best-effort. details is freeform JSON.
  request_id      text,
  ip              inet,
  user_agent      text,
  outcome         text        NOT NULL DEFAULT 'success'
                              CHECK (outcome IN ('success', 'denied', 'error')),
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- Indexes for the queries the auditor will actually run ----------
-- Recent events per org (Drata-style "last 30 days for org X"):
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time
  ON public.audit_logs (organization_id, created_at DESC);

-- "Who touched this deal?" — used by the deal access trail in the UI:
CREATE INDEX IF NOT EXISTS idx_audit_logs_deal_time
  ON public.audit_logs (deal_id, created_at DESC) WHERE deal_id IS NOT NULL;

-- "What did user X do across all orgs?" — used by HR/security investigations:
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time
  ON public.audit_logs (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;

-- Action-class scans (e.g. "all gdpr.* events in the last 90 days"):
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time
  ON public.audit_logs (action, created_at DESC);

-- ---------- RLS ----------
-- Append-only via the RPC. Reads are scoped to org admins. Platform admins
-- bypass via service-role client.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_org_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_org_admin_read
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = audit_logs.organization_id
         AND m.is_org_admin = true
         AND (m.user_id = auth.uid()
              OR lower(m.email) = lower(auth.jwt() ->> 'email'))
    )
  );

-- No INSERT / UPDATE / DELETE policies → only service-role + the RPC below
-- can write. Auditors should never see direct row mutation.

-- ---------- Append RPC ----------
-- The single sanctioned write path. Trims and normalises inputs, snaps the
-- request_id length, and returns the new row id so callers can correlate.
CREATE OR REPLACE FUNCTION public.audit_log_event(
  p_action          text,
  p_actor_user_id   uuid    DEFAULT NULL,
  p_actor_email     text    DEFAULT NULL,
  p_actor_kind      text    DEFAULT 'user',
  p_target_type     text    DEFAULT NULL,
  p_target_id       text    DEFAULT NULL,
  p_organization_id uuid    DEFAULT NULL,
  p_deal_id         uuid    DEFAULT NULL,
  p_request_id      text    DEFAULT NULL,
  p_ip              inet    DEFAULT NULL,
  p_user_agent      text    DEFAULT NULL,
  p_outcome         text    DEFAULT 'success',
  p_details         jsonb   DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RAISE EXCEPTION 'audit_log_event: action is required';
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id, actor_email, actor_kind,
    action, target_type, target_id,
    organization_id, deal_id,
    request_id, ip, user_agent,
    outcome, details
  ) VALUES (
    p_actor_user_id,
    NULLIF(lower(trim(coalesce(p_actor_email, ''))), ''),
    coalesce(p_actor_kind, 'user'),
    trim(p_action),
    p_target_type,
    p_target_id,
    p_organization_id,
    p_deal_id,
    NULLIF(left(coalesce(p_request_id, ''), 64), ''),
    p_ip,
    NULLIF(left(coalesce(p_user_agent, ''), 512), ''),
    coalesce(p_outcome, 'success'),
    coalesce(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_log_event TO service_role;
-- Authenticated users can also call (e.g. UI fires "deal.exported"):
GRANT EXECUTE ON FUNCTION public.audit_log_event TO authenticated;

-- ---------- Convenience view for the most-common 30-day query ----------
-- Used by the SOC 2 evidence script and the admin UI's "recent activity" tab.
CREATE OR REPLACE VIEW public.audit_logs_recent_30d AS
  SELECT *
    FROM public.audit_logs
   WHERE created_at >= now() - interval '30 days';
GRANT SELECT ON public.audit_logs_recent_30d TO authenticated;

COMMENT ON TABLE  public.audit_logs IS
  'Append-only security audit ledger. Write via audit_log_event() RPC only. See compliance/CONTROLS_MATRIX.md (CC2.1, CC4.2).';
COMMENT ON COLUMN public.audit_logs.action IS
  'Conventional dotted-snake action name: deal.read, member.role_changed, gdpr.erasure_requested, etc.';
COMMENT ON COLUMN public.audit_logs.outcome IS
  'success | denied | error. denied = authz check rejected; error = downstream failure.';
