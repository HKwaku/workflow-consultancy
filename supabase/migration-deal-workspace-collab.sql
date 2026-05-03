-- migration-deal-workspace-collab.sql
--
-- Bundles four independent additions that together turn the deal workspace
-- from a read-mostly modal into a real working surface for diligence:
--
--   1. deal_qa_items         — structured "questions to seller" queue
--   2. deal_finding_comments — threaded discussion on each finding
--   3. deal_findings.tags    — per-finding tags beyond severity
--   4. deal_findings.stale   — staleness flag triggered when cited docs change
--
-- All four are independent, but bundling avoids a five-migration churn for
-- one logical feature drop ("workspace collaboration").

-- ──────────────────────────────────────────────────────────────────────
-- 1. Q&A queue
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_qa_items (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                  uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,

  question                 text        NOT NULL,
  asked_by_email           text        NOT NULL,
  asked_at                 timestamptz NOT NULL DEFAULT now(),

  -- Optional routing — which participant (company role) this is for.
  assigned_participant_id  uuid        REFERENCES public.deal_participants(id) ON DELETE SET NULL,
  assigned_company         text,        -- denormalised label for display when participant is later removed

  -- Lifecycle: open → answered | skipped | obsolete.
  status                   text        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'answered', 'skipped', 'obsolete')),

  answer_text              text,
  answered_by_email        text,
  answered_at              timestamptz,

  -- Optional supporting evidence pulled from the data room.
  evidence_chunk_ids       uuid[]      DEFAULT '{}',
  evidence_document_ids    uuid[]      DEFAULT '{}',

  -- Optional linkage to a finding the question is investigating.
  related_finding_key      text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_qa_deal_status   ON public.deal_qa_items (deal_id, status, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_qa_assigned      ON public.deal_qa_items (assigned_participant_id) WHERE assigned_participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_qa_finding       ON public.deal_qa_items (deal_id, related_finding_key) WHERE related_finding_key IS NOT NULL;
COMMENT ON TABLE public.deal_qa_items IS
  'Structured Q&A list per deal — the queue of questions to ask the seller and where the answers landed.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Finding comments
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_finding_comments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid        NOT NULL REFERENCES public.deal_analyses(id) ON DELETE CASCADE,
  deal_id         uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  finding_key     text        NOT NULL,
  author_email    text        NOT NULL,
  body            text        NOT NULL,

  -- Optional @-mention list. Free-form emails so external counsel can be
  -- mentioned without first being a system user.
  mentions        text[]      DEFAULT '{}',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_finding_comments_finding
  ON public.deal_finding_comments (analysis_id, finding_key, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_deal_finding_comments_deal
  ON public.deal_finding_comments (deal_id, created_at DESC);
COMMENT ON TABLE public.deal_finding_comments IS
  'Threaded discussion on individual findings. Distinct from deal_finding_reviews.reviewer_note, which is a single per-reviewer note tied to status.';

-- ──────────────────────────────────────────────────────────────────────
-- 3. Finding tags + staleness
--
-- Depends on migration #24 (migration-deal-findings-table.sql), which
-- creates public.deal_findings. Wrapped in a DO block so this migration
-- is safe to run on a database that hasn't yet applied #24 — the Q&A
-- and comments tables above will still be created. Re-run this migration
-- after applying #24 to get the deal_findings columns + indexes.
-- ──────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'deal_findings'
  ) THEN
    ALTER TABLE public.deal_findings
      ADD COLUMN IF NOT EXISTS tags         text[]      NOT NULL DEFAULT '{}';
    ALTER TABLE public.deal_findings
      ADD COLUMN IF NOT EXISTS stale        boolean     NOT NULL DEFAULT false;
    ALTER TABLE public.deal_findings
      ADD COLUMN IF NOT EXISTS stale_reason text;
    ALTER TABLE public.deal_findings
      ADD COLUMN IF NOT EXISTS stale_at     timestamptz;

    -- GIN index on tags so cross-deal portfolio queries ("every finding
    -- tagged deal_breaker") stay fast.
    CREATE INDEX IF NOT EXISTS idx_deal_findings_tags
      ON public.deal_findings USING GIN (tags);
    -- Partial index for the workspace's "show stale findings" filter.
    CREATE INDEX IF NOT EXISTS idx_deal_findings_stale
      ON public.deal_findings (deal_id) WHERE stale = true;

    COMMENT ON COLUMN public.deal_findings.tags IS
      'Free-form tags beyond severity. Recommended vocabulary: deal_breaker, re_trade, disclose, mitigate, monitor.';
    COMMENT ON COLUMN public.deal_findings.stale IS
      'true when an evidence document has been reprocessed or replaced after this finding was generated. The finding may no longer reflect current data.';
  ELSE
    RAISE NOTICE 'public.deal_findings does not exist — skipping tags/stale columns. Apply migration-deal-findings-table.sql (#24) first, then re-run this migration.';
  END IF;
END
$$;
