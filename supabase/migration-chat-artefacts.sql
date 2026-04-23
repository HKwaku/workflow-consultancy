-- ============================================================
-- chat_artefacts: inline artefacts attached to chat messages
--
-- Artefacts are the durable outputs produced during a chat session:
--   flow_snapshot  - inlined snapshot of processData at a point in time
--   report         - reference to diagnostic_reports.id (text id)
--   cost_analysis  - reference to a cost result (uuid or text)
--   deal_analysis  - reference to deal_analyses.id (uuid)
--
-- Reports / analyses are referenced (not duplicated) via ref_id.
-- Flow snapshots are inlined in the snapshot jsonb so they survive
-- later edits to the live canvas.
--
-- One artefact per message: chat_messages.artefact_id points to the
-- artefact row that "belongs" to that turn. Snapshots are only taken
-- on meaningful events (redesign applied, report generated, explicit
-- pin), not every keystroke.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chat_artefacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  message_id       uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  kind             text NOT NULL
                   CHECK (kind IN ('flow_snapshot', 'report', 'cost_analysis', 'deal_analysis')),
  ref_id           text,
  snapshot         jsonb,
  label            text,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_artefacts_session ON public.chat_artefacts (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_artefacts_message ON public.chat_artefacts (message_id);
CREATE INDEX IF NOT EXISTS idx_chat_artefacts_kind    ON public.chat_artefacts (kind);
CREATE INDEX IF NOT EXISTS idx_chat_artefacts_ref     ON public.chat_artefacts (ref_id);

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS artefact_id uuid
    REFERENCES public.chat_artefacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_artefact ON public.chat_messages (artefact_id);

COMMENT ON TABLE public.chat_artefacts IS
  'Durable artefacts (flow snapshots, reports, analyses) attached to chat turns. Referenced items use ref_id; flows inline into snapshot.';
COMMENT ON COLUMN public.chat_artefacts.ref_id IS
  'External id: diagnostic_reports.id (text) for report, analyses.id (uuid) for deal_analysis/cost_analysis. No FK - cleanup is app-level.';
COMMENT ON COLUMN public.chat_artefacts.snapshot IS
  'For flow_snapshot kind: inlined processData so reopening preserves the exact state at that turn.';
COMMENT ON COLUMN public.chat_messages.artefact_id IS
  'Optional pointer to the artefact this turn produced (one-artefact-per-message).';

-- RLS mirrors chat_messages_own: access if the owning session belongs to the user.
ALTER TABLE public.chat_artefacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_artefacts_own ON public.chat_artefacts;
CREATE POLICY chat_artefacts_own
  ON public.chat_artefacts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions s
       WHERE s.id = chat_artefacts.session_id
         AND (s.user_id = auth.uid() OR lower(s.email) = lower(auth.jwt() ->> 'email'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions s
       WHERE s.id = chat_artefacts.session_id
         AND (s.user_id = auth.uid() OR lower(s.email) = lower(auth.jwt() ->> 'email'))
    )
  );
