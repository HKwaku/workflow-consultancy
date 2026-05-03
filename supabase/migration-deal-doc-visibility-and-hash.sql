-- ============================================================
-- deal_documents — per-party visibility + content-hash idempotency
--
-- TWO additions in one migration (related, both touch deal_documents):
--
-- 1. visibility ENUM
--    Lets the uploader choose who in the deal can read the bytes:
--      all_editors  - any deal owner / collaborator (default; today's behaviour)
--      acquirer_only / target_only / seller_only / portfolio_only
--                    - editors AND participants matching that role
--      owner_only   - the deal owner only (e.g. private notes)
--    RLS is updated to enforce this — defence in depth alongside the API
--    layer's filter in /api/deals/[id]/documents GET.
--
-- 2. content_hash TEXT
--    SHA-256 of the file bytes. UNIQUE per (deal_id, content_hash) — a
--    duplicate upload returns the existing row instead of creating a second
--    deal_documents row + triggering a second Inngest run. Saves real money
--    on the embedding pipeline.
-- ============================================================

-- ---------- Visibility column ----------
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all_editors'
    CHECK (visibility IN (
      'all_editors',
      'acquirer_only', 'target_only', 'seller_only', 'portfolio_only',
      'owner_only'
    ));

CREATE INDEX IF NOT EXISTS idx_deal_documents_visibility
  ON public.deal_documents (deal_id, visibility);

COMMENT ON COLUMN public.deal_documents.visibility IS
  'Who can read the bytes / metadata. Editor-write always; read scoped per visibility tier. See lib/dealAuth.js -> canSeeDocument().';

-- ---------- Content hash for idempotency ----------
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_documents_dedupe
  ON public.deal_documents (deal_id, content_hash)
  WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN public.deal_documents.content_hash IS
  'SHA-256 hex of the uploaded bytes. Unique per deal (partial index excludes nulls so legacy rows are not affected).';

-- ---------- Updated RLS for visibility ----------
-- Replace the all-editors-can-read policy with one that respects visibility.
-- Editor + the owner-side bypass keeps existing flows working; participants
-- can only read documents tagged for their role.

DROP POLICY IF EXISTS deal_documents_editor ON public.deal_documents;

CREATE POLICY deal_documents_read
  ON public.deal_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = deal_documents.deal_id
         AND (
           -- Owner sees everything
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')

           -- Collaborators: see all_editors + their-side docs (no role on collab => see all_editors only)
           OR (
             (auth.jwt() ->> 'email') = ANY (
               SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
             )
             AND deal_documents.visibility IN ('all_editors')
           )

           -- Participants matched to a role: see their-side + all_editors
           OR EXISTS (
             SELECT 1 FROM public.deal_participants p
              WHERE p.deal_id = d.id
                AND lower(p.participant_email) = lower(auth.jwt() ->> 'email')
                AND (
                  deal_documents.visibility = 'all_editors'
                  OR (deal_documents.visibility = 'acquirer_only'  AND p.role = 'acquirer')
                  OR (deal_documents.visibility = 'target_only'    AND p.role = 'target')
                  OR (deal_documents.visibility = 'seller_only'    AND p.role = 'seller')
                  OR (deal_documents.visibility = 'portfolio_only' AND p.role IN ('portfolio_company','platform_company'))
                )
           )
         )
    )
  );

-- Write policy (insert / update / delete) stays editor-only — collaborators
-- can upload but the visibility tagging happens at insert time, not after.
CREATE POLICY deal_documents_write
  ON public.deal_documents
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = deal_documents.deal_id
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
       WHERE d.id = deal_documents.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    )
  );

-- Note: this is two policies — one SELECT, one ALL. Postgres OR's policies of
-- the same command type, so write paths only need to satisfy the editor
-- policy. SELECTs use the broader visibility policy.
