-- Migration: add contributor_emails column to diagnostic_reports
-- Contributors are people who should receive the report and can view it in their portal.

ALTER TABLE diagnostic_reports
ADD COLUMN IF NOT EXISTS contributor_emails text[] DEFAULT '{}';

-- GIN index for efficient array containment queries (cs / @>)
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_contributor_emails
  ON diagnostic_reports USING GIN (contributor_emails);
