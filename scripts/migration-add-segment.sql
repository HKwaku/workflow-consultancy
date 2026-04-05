-- Add segment column to diagnostic_reports for direct querying
-- Segment is also stored in diagnostic_data->contact->segment (JSONB)
-- This promoted column enables efficient filtering and analytics without JSONB extraction

ALTER TABLE diagnostic_reports
  ADD COLUMN IF NOT EXISTS segment TEXT
  CHECK (segment IN ('scaling', 'ma', 'pe', 'highstakes'));

-- Backfill from JSONB for existing rows
UPDATE diagnostic_reports
SET segment = diagnostic_data->'contact'->>'segment'
WHERE segment IS NULL
  AND diagnostic_data->'contact'->>'segment' IS NOT NULL
  AND diagnostic_data->'contact'->>'segment' IN ('scaling', 'ma', 'pe', 'highstakes');

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_segment
  ON diagnostic_reports (segment)
  WHERE segment IS NOT NULL;

-- Note: update send-diagnostic-report/route.js to populate this column
-- by adding `segment: contact.segment || null` to the reportPayload.
