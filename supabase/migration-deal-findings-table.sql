-- ============================================================
-- Findings as a relational table
--
-- Today every deal_analyses row's `result` JSONB carries the findings as
-- arrays inside per-section keys (executiveSummary, technologyLandscape,
-- operationalFootprint, organisation, redFlags, keyFindings, opportunities,
-- integrationRisks, risks, mergeRecommendations). That works but:
--   - "Find every approved finding across all my deals" is a JSONB walk
--   - Query planning can't index the arrays
--   - deal_finding_reviews keys on (analysis_id, finding_key) which is fine
--     but couples reviewers to a fragile string match
--
-- This migration introduces deal_findings as the canonical relational
-- store. The JSONB stays in deal_analyses.result as the AUDIT ARCHIVE —
-- the raw model output before normalisation. The relational table is
-- what every read path uses going forward.
--
-- Backfill step at the bottom seeds deal_findings from existing JSONB
-- rows so nothing in production goes blank after migration.
-- ============================================================

-- ---------- The table ----------
CREATE TABLE IF NOT EXISTS public.deal_findings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid        NOT NULL REFERENCES public.deal_analyses(id) ON DELETE CASCADE,
  deal_id         uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,

  -- Stable id within an analysis. sha1(category+title)[:12]. The same key
  -- across re-runs of the same analysis means UPSERT semantics — preserves
  -- linkage to deal_finding_reviews.
  finding_key     text        NOT NULL,

  -- Which section bucket of the canonical shape this belongs to.
  -- 'executiveSummary' is a singleton (one row per analysis); all others
  -- are arrays. The hydrator (lib/deal-analysis/findingsRepo.js) groups
  -- these back into the JSONB-ish shape the renderer expects.
  section         text        NOT NULL CHECK (section IN (
                    'executiveSummary',
                    'technologyLandscape', 'operationalFootprint', 'organisation',
                    'redFlags', 'keyFindings',
                    'opportunities', 'integrationRisks', 'risks',
                    'mergeRecommendations'
                  )),

  -- Display order within the section (preserves the model's emission order).
  order_index     integer     NOT NULL DEFAULT 0,

  -- Canonical fields — see lib/deal-analysis/findingsShape.js
  title           text        NOT NULL,
  body            text        DEFAULT '',
  category        text        DEFAULT 'general',
  severity        text        NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  confidence      real        NOT NULL DEFAULT 0.5,

  -- Arrays + objects stored as jsonb for flexibility — these don't need
  -- to be queryable individually.
  impact          jsonb       NOT NULL DEFAULT '[]'::jsonb,    -- string[] of impact axes
  evidence        jsonb       NOT NULL DEFAULT '[]'::jsonb,    -- {kind, ref, snippet}[]
  recommendations jsonb       NOT NULL DEFAULT '[]'::jsonb,    -- string[]

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Same-analysis re-runs UPSERT on this — preserves review-row linkage
  -- when the model emits the same finding twice.
  UNIQUE (analysis_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_deal_findings_analysis  ON public.deal_findings (analysis_id, section, order_index);
CREATE INDEX IF NOT EXISTS idx_deal_findings_deal      ON public.deal_findings (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_findings_severity  ON public.deal_findings (deal_id, severity) WHERE severity IN ('high', 'critical');

COMMENT ON TABLE public.deal_findings IS
  'Relational store for AI-generated findings. The deal_analyses.result JSONB remains as the raw model output for audit; this table is what reads use.';

-- ---------- Updated_at trigger (re-uses helper from earlier migrations) ----------
DROP TRIGGER IF EXISTS deal_findings_updated_at ON public.deal_findings;
CREATE TRIGGER deal_findings_updated_at
  BEFORE UPDATE ON public.deal_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- ---------- RLS ----------
-- Same access model as deal_analyses: editor read+write, participant read.
-- Defence in depth — the API also filters via deal access.
ALTER TABLE public.deal_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_findings_editor ON public.deal_findings;
CREATE POLICY deal_findings_editor
  ON public.deal_findings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = deal_findings.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = deal_findings.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    )
  );

-- ---------- Backfill ----------
-- Walk every existing deal_analyses row and seed deal_findings from the
-- JSONB. Idempotent — uses ON CONFLICT DO NOTHING so re-running is safe.
--
-- The mapping mirrors lib/deal-analysis/findingsShape.js -> normaliseFindings.
-- We trust that previously-persisted findings already have stable `key`
-- fields (the analyse route has computed these for some weeks now).
DO $$
DECLARE
  v_analysis    record;
  v_section     text;
  v_arr         jsonb;
  v_finding     jsonb;
  v_idx         integer;
  v_key         text;
  v_section_paths text[] := ARRAY[
    'mergeRecommendations', 'opportunities', 'integrationRisks', 'risks',
    'redFlags', 'keyFindings',
    'technologyLandscape', 'operationalFootprint', 'organisation'
  ];
BEGIN
  FOR v_analysis IN
    SELECT id, deal_id, result FROM public.deal_analyses
     WHERE result IS NOT NULL
  LOOP
    -- Singleton: executiveSummary
    IF jsonb_typeof(v_analysis.result -> 'executiveSummary') = 'object' THEN
      v_finding := v_analysis.result -> 'executiveSummary';
      v_key := COALESCE(v_finding ->> 'key', encode(digest(
        lower(coalesce(v_finding ->> 'category', 'general')) || '::' ||
        lower(coalesce(v_finding ->> 'title', '')),
        'sha1'), 'hex'));
      v_key := substr(v_key, 1, 12);

      INSERT INTO public.deal_findings (
        analysis_id, deal_id, finding_key, section, order_index,
        title, body, category, severity, confidence,
        impact, evidence, recommendations
      )
      VALUES (
        v_analysis.id, v_analysis.deal_id, v_key, 'executiveSummary', 0,
        coalesce(v_finding ->> 'title', 'Executive Summary'),
        coalesce(v_finding ->> 'body', ''),
        coalesce(v_finding ->> 'category', 'executiveSummary'),
        coalesce(v_finding ->> 'severity', 'medium'),
        coalesce((v_finding ->> 'confidence')::real, 0.5),
        coalesce(v_finding -> 'impact',          '[]'::jsonb),
        coalesce(v_finding -> 'evidence',        '[]'::jsonb),
        coalesce(v_finding -> 'recommendations', '[]'::jsonb)
      )
      ON CONFLICT (analysis_id, finding_key) DO NOTHING;
    END IF;

    -- Arrays
    FOREACH v_section IN ARRAY v_section_paths LOOP
      v_arr := v_analysis.result -> v_section;
      IF jsonb_typeof(v_arr) = 'array' THEN
        v_idx := 0;
        FOR v_finding IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
          v_key := COALESCE(v_finding ->> 'key', encode(digest(
            lower(coalesce(v_finding ->> 'category', v_section)) || '::' ||
            lower(coalesce(v_finding ->> 'title', '')),
            'sha1'), 'hex'));
          v_key := substr(v_key, 1, 12);

          IF coalesce(v_finding ->> 'title', '') <> '' THEN
            INSERT INTO public.deal_findings (
              analysis_id, deal_id, finding_key, section, order_index,
              title, body, category, severity, confidence,
              impact, evidence, recommendations
            )
            VALUES (
              v_analysis.id, v_analysis.deal_id, v_key, v_section, v_idx,
              v_finding ->> 'title',
              coalesce(v_finding ->> 'body', ''),
              coalesce(v_finding ->> 'category', v_section),
              coalesce(v_finding ->> 'severity', 'medium'),
              coalesce((v_finding ->> 'confidence')::real, 0.5),
              coalesce(v_finding -> 'impact',          '[]'::jsonb),
              coalesce(v_finding -> 'evidence',        '[]'::jsonb),
              coalesce(v_finding -> 'recommendations', '[]'::jsonb)
            )
            ON CONFLICT (analysis_id, finding_key) DO NOTHING;
            v_idx := v_idx + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Sanity report — number of analyses backfilled vs total
DO $$
DECLARE
  v_with_findings integer;
  v_total         integer;
BEGIN
  SELECT count(DISTINCT analysis_id) INTO v_with_findings FROM public.deal_findings;
  SELECT count(*) INTO v_total FROM public.deal_analyses WHERE result IS NOT NULL;
  RAISE NOTICE 'Backfill done: % of % analyses have findings in deal_findings.', v_with_findings, v_total;
END $$;
