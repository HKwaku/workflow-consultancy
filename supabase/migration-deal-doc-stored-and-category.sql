-- migration-deal-doc-stored-and-category.sql
--
-- Two additions to deal_documents to support the open-format dataroom:
--
--   1. status `stored` — terminal state for files we've accepted into the
--      data room but cannot text-extract (images, audio, video, archives,
--      proprietary formats). They're downloadable + previewable but not
--      searchable. Distinct from `failed`, which means a real error.
--
--   2. category — AI-suggested or user-overridable bucket so the doc list
--      can be grouped by Financial / Legal / HR / IP / Tech / Commercial /
--      Operational / Other. Free-text rather than enum so the taxonomy
--      can evolve without a migration.

ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_status_check;

ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_status_check
  CHECK (status IN ('pending','parsing','embedding','ready','failed','stored'));

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_deal_documents_category
  ON public.deal_documents (deal_id, category);

COMMENT ON COLUMN public.deal_documents.category IS
  'AI-suggested or user-set category (Financial, Legal, HR, IP, Tech, Commercial, Operational, Other). Used by the dataroom UI to group documents.';
