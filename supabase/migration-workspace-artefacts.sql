-- ============================================================
-- workspace_artefacts: backs the workspace "Outputs" panel
--
-- (Table name stays workspace_artefacts; the user-facing tab is named
-- "Outputs" so it doesn't collide with the chat rail's separate,
-- session-scoped "Artefacts" panel. The agent's emit_artefact tool
-- and the SSE/event names also keep the "artefact" wording — only the
-- visible label is "Outputs".)
--
-- Depends on: migration-operating-model.sql (operating_models),
--             migration-org-rbac.sql (organization_members),
--             migration-chat-history.sql (chat_sessions).
--
-- Everywhere else in the workspace, items respect a schema:
-- functions/capabilities, processes, roles, systems are typed,
-- validated and roll up into the canonical operating model.
--
-- Sometimes the agent needs to produce something that has NO home in
-- that schema: a comparison table, a draft policy, an exec summary, a
-- SQL query, a JSON dataset, a mermaid diagram. Those are artefacts.
-- They behave like the right-hand artefacts panel in a Claude chat:
-- generated as the user interacts, parked here, viewable any time.
--
-- Deliberately schema-light:
--   type     - free text content type ('markdown','code','table',
--              'json','html','text','mermaid','csv','svg', …). No
--              CHECK on purpose — new types must not need a migration.
--   content  - the artefact payload, always a string (table/json
--              hold a JSON string the viewer parses).
--   language - syntax hint for 'code' artefacts.
--   meta     - anything else the producer wants to stash (free jsonb).
--
-- Scoped to an operating model (the panel is org/model-scoped) and
-- optionally to the chat_session that produced it, so a conversation's
-- artefacts can be grouped. Member-write, not admin-gated: generating
-- an artefact never mutates the canonical model.
-- ============================================================

-- An earlier iteration of this feature shipped a different
-- `workspace_artefacts` shape (kind/label/body — the "Simulate"
-- sandbox). That shape was never released and is fully superseded by
-- the artefacts panel below, so drop it rather than ALTER it column by
-- column. Safe: the table holds no production data. CASCADE clears the
-- old RLS policy + indexes too.
DROP TABLE IF EXISTS public.workspace_artefacts CASCADE;

CREATE TABLE IF NOT EXISTS public.workspace_artefacts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_model_id  uuid        NOT NULL REFERENCES public.operating_models(id) ON DELETE CASCADE,
  -- Which conversation produced it. SET NULL (not CASCADE): an artefact
  -- outlives the chat thread it came from, like a Claude artefact does.
  session_id          uuid        REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  type                text        NOT NULL DEFAULT 'markdown',
  title               text,
  content             text        NOT NULL DEFAULT '',
  language            text,
  -- 'agent' (emitted by a chat tool) | 'user' (manually created).
  source              text        NOT NULL DEFAULT 'agent',
  meta                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_email    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_artefacts_model
  ON public.workspace_artefacts (operating_model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_artefacts_session
  ON public.workspace_artefacts (session_id);

COMMENT ON TABLE public.workspace_artefacts IS
  'Backs the workspace "Outputs" panel: freeform generated outputs (tables, docs, code, diagrams, datasets) that have no home in the canonical model schema. Like a Claude chat artefacts panel — schema-light by design (free text type, string content, jsonb meta, no CHECKs).';
COMMENT ON COLUMN public.workspace_artefacts.type IS
  'Free-text content type: markdown/code/table/json/html/text/mermaid/csv/svg/… Drives how the viewer renders it. No CHECK so new types do not need a migration.';
COMMENT ON COLUMN public.workspace_artefacts.content IS
  'Always a string. table/json/csv hold a JSON or CSV string the viewer parses.';

-- RLS mirrors capabilities/model_roles: any member of the parent
-- model's org can read AND write. NOT admin-gated (unlike
-- capabilities_admin_write) — emitting an artefact never mutates the
-- canonical model.
ALTER TABLE public.workspace_artefacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_artefacts_member_all ON public.workspace_artefacts;
CREATE POLICY workspace_artefacts_member_all
  ON public.workspace_artefacts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = workspace_artefacts.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = workspace_artefacts.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );
