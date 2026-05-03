-- ============================================================
-- GDPR Article 17: account deletion
--
-- Soft-delete a user without nuking shared data (a deal owned by them
-- shouldn't disappear for collaborators). The cron at
-- /api/cron/expunge-deleted-accounts hard-deletes / anonymises after the
-- 30-day grace window so the user can change their mind.
--
-- Lifecycle:
--   T+0       user clicks Delete account → user_deletion_requests row
--             written with status='pending'; auth.users.banned_until set so
--             they can't log in. Email-bearing rows tagged for redaction.
--   T+30 days expunge-deleted-accounts cron processes pending → anonymised:
--             auth.users.email          → 'deleted-{uuid}@deleted.invalid'
--             diagnostic_reports.contact_email/contact_name/company → redacted
--             chat_sessions.email/title  → redacted
--             chat_messages              → kept (could contain MNPI)
--             owned deals                → ownership transferred to platform
--                                          admin sentinel (so collaborators
--                                          retain access); metadata redacted.
--             status flips to 'completed'.
--
-- Columns added (forward-compat — existing data unchanged):
--   user_deletion_requests table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_deletion_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email_at_request text       NOT NULL,                  -- snapshot in case auth.users gets renamed
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'cancelled', 'completed', 'failed')),
  expunge_after   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  failure_reason  text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz,
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status
  ON public.user_deletion_requests (status, expunge_after);

COMMENT ON TABLE public.user_deletion_requests IS
  'GDPR Art. 17 soft-delete queue. The 30-day grace window lets the user cancel before expungement.';

-- RLS: a user can read their own row (so the UI can show "deletion scheduled").
-- Only the service role can insert/update.
ALTER TABLE public.user_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deletion_requests_self_read ON public.user_deletion_requests;
CREATE POLICY deletion_requests_self_read
  ON public.user_deletion_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
