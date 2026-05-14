-- Living-workspace migration — Phase 2: RLS policy realignment
--
-- Run AFTER Phase 1 and AFTER the application code has been switched
-- to read from `processes` directly (no longer relying on the
-- diagnostic_reports compat view).
--
-- This drops and re-creates RLS policies that referenced the old
-- table / column names. Adjust the policy bodies if your existing
-- policies have org-scoped or participant-scoped clauses you need to
-- preserve — this file gives the canonical shape, not a verbatim
-- copy of what's deployed.

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- processes (was diagnostic_reports)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diagnostic_reports_select_owner  ON public.processes;
DROP POLICY IF EXISTS diagnostic_reports_select_org    ON public.processes;
DROP POLICY IF EXISTS diagnostic_reports_select_deal   ON public.processes;
DROP POLICY IF EXISTS diagnostic_reports_insert_owner  ON public.processes;
DROP POLICY IF EXISTS diagnostic_reports_update_owner  ON public.processes;
DROP POLICY IF EXISTS diagnostic_reports_delete_owner  ON public.processes;

CREATE POLICY processes_select_owner ON public.processes
  FOR SELECT USING (
    user_id = auth.uid()
    OR contact_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY processes_select_org ON public.processes
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY processes_select_deal ON public.processes
  FOR SELECT USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );

CREATE POLICY processes_insert_owner ON public.processes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR contact_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY processes_update_owner ON public.processes
  FOR UPDATE USING (
    user_id = auth.uid()
    OR contact_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY processes_delete_owner ON public.processes
  FOR DELETE USING (
    user_id = auth.uid()
    OR contact_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ──────────────────────────────────────────────────────────────────
-- deal_findings / deal_finding_reviews / deal_finding_comments
-- (now hang directly on deal_id — analysis_id is gone)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.deal_findings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_finding_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_finding_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_findings_select  ON public.deal_findings;
DROP POLICY IF EXISTS deal_findings_modify  ON public.deal_findings;
DROP POLICY IF EXISTS deal_finding_reviews_select  ON public.deal_finding_reviews;
DROP POLICY IF EXISTS deal_finding_reviews_modify  ON public.deal_finding_reviews;
DROP POLICY IF EXISTS deal_finding_comments_select ON public.deal_finding_comments;
DROP POLICY IF EXISTS deal_finding_comments_modify ON public.deal_finding_comments;

CREATE POLICY deal_findings_select ON public.deal_findings
  FOR SELECT USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );

CREATE POLICY deal_findings_modify ON public.deal_findings
  FOR ALL USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );

-- Same shape for reviews + comments.
CREATE POLICY deal_finding_reviews_select ON public.deal_finding_reviews
  FOR SELECT USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );
CREATE POLICY deal_finding_reviews_modify ON public.deal_finding_reviews
  FOR ALL USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );

CREATE POLICY deal_finding_comments_select ON public.deal_finding_comments
  FOR SELECT USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );
CREATE POLICY deal_finding_comments_modify ON public.deal_finding_comments
  FOR ALL USING (
    deal_id IN (
      SELECT id FROM public.deals
      WHERE owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
         OR lower(coalesce(auth.jwt() ->> 'email', '')) = ANY (collaborator_emails)
    )
  );

COMMIT;
