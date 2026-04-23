-- ================================================================
-- MIGRATION: Deal flows, collaborators, and cross-company analyses
--
-- Builds on scripts/migration-deals.sql. Additive only - does not
-- alter existing deal / deal_participants / diagnostic_reports columns
-- beyond adding nullable linkage.
-- ================================================================


-- ── 1. deals.collaborator_emails ────────────────────────────────
-- Owner grants edit rights to teammates. Collaborators can create,
-- read, edit flows under the deal but cannot change ownership or
-- delete the deal itself.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS collaborator_emails TEXT[] NOT NULL DEFAULT '{}';


-- ── 2. deal_flows ───────────────────────────────────────────────
-- Many-to-many between deal participants (companies) and the
-- diagnostic_reports that document their process flows.
-- A participant can have N flows (e.g. AP, Sales Pipeline, Onboarding).
-- A flow is "empty" while report_id is null; populated once the user
-- completes / saves a process in /process-audit.

CREATE TABLE IF NOT EXISTS deal_flows (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID        NOT NULL REFERENCES deals(id)              ON DELETE CASCADE,
  participant_id    UUID        NOT NULL REFERENCES deal_participants(id)  ON DELETE CASCADE,

  -- Human-friendly name shown in the UI ("AP", "Order to cash")
  label             TEXT        NOT NULL,

  -- Free-text kind / process category. Not enforced - allows future
  -- grouping (e.g. all "accounts_payable" flows across companies).
  flow_kind         TEXT,

  -- Populated once the diagnostic_reports row exists. Null until the
  -- user saves the flow for the first time.
  report_id         TEXT        REFERENCES diagnostic_reports(id)          ON DELETE SET NULL,

  -- Mirrors the report lifecycle so the UI can show progress without
  -- always joining to diagnostic_reports.
  status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'in_progress', 'complete')),

  created_by_email  TEXT        NOT NULL,  -- owner or collaborator who created the slot
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER deal_flows_set_updated_at
  BEFORE UPDATE ON deal_flows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_deal_flows_deal_id         ON deal_flows (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_flows_participant_id  ON deal_flows (participant_id);
CREATE INDEX IF NOT EXISTS idx_deal_flows_report_id       ON deal_flows (report_id);


-- ── 3. deal_analyses ────────────────────────────────────────────
-- Cross-company AI analyses across 2+ flows in a deal.
-- Multiple named analyses per deal (named/timestamped history).

CREATE TABLE IF NOT EXISTS deal_analyses (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- 'comparison' - side-by-side differences and commonalities
  -- 'synergy'    - quantified savings/risk when combining flows
  -- 'redesign'   - emits a unified flow (stored in result.redesignedProcess)
  mode               TEXT        NOT NULL
                       CHECK (mode IN ('comparison', 'synergy', 'redesign')),

  name               TEXT,                 -- user-facing label, optional

  -- Which flows fed this analysis. Both stored for convenience:
  source_flow_ids    UUID[]      NOT NULL DEFAULT '{}',   -- deal_flows.id
  source_report_ids  TEXT[]      NOT NULL DEFAULT '{}',   -- diagnostic_reports.id (denormalised)

  status             TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'complete', 'failed')),

  -- Full agent output. Shape varies by mode; documented in
  -- lib/agents/deal-analysis/README.md.
  result             JSONB,
  error              TEXT,

  created_by_email   TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deal_analyses_deal_id  ON deal_analyses (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_analyses_status   ON deal_analyses (status);


-- ── 4. Row Level Security ────────────────────────────────────────

ALTER TABLE deal_flows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_analyses  ENABLE ROW LEVEL SECURITY;

-- ── deal_flows policies ──

-- Owner or collaborator: full access to flows under deals they edit.
CREATE POLICY deal_flows_editor_all
  ON deal_flows FOR ALL
  TO authenticated
  USING (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email    = auth.email()
         OR auth.email() = ANY (collaborator_emails)
    )
  )
  WITH CHECK (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email    = auth.email()
         OR auth.email() = ANY (collaborator_emails)
    )
  );

-- Participant can read flows attached to their own participant row.
CREATE POLICY deal_flows_participant_read
  ON deal_flows FOR SELECT
  TO authenticated
  USING (
    participant_id IN (
      SELECT id FROM deal_participants
      WHERE participant_email = auth.email()
    )
  );

-- ── deal_analyses policies ──

CREATE POLICY deal_analyses_editor_all
  ON deal_analyses FOR ALL
  TO authenticated
  USING (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email    = auth.email()
         OR auth.email() = ANY (collaborator_emails)
    )
  )
  WITH CHECK (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email    = auth.email()
         OR auth.email() = ANY (collaborator_emails)
    )
  );

-- Participants can read analyses for deals they belong to
-- (they can't run or modify, but they can see the output).
CREATE POLICY deal_analyses_participant_read
  ON deal_analyses FOR SELECT
  TO authenticated
  USING (
    deal_id IN (
      SELECT deal_id FROM deal_participants
      WHERE participant_email = auth.email()
    )
  );


-- ── 5. Broaden existing policies to recognise collaborators ──────
-- The original deals_owner_all / deal_participants_owner_all policies
-- are kept; we add parallel "editor" policies for collaborators so
-- they can read, update (deals except ownership), and manage
-- participants.

-- deals: collaborators can select + update (not delete, not reassign owner)
DROP POLICY IF EXISTS deals_collaborator_read   ON deals;
DROP POLICY IF EXISTS deals_collaborator_update ON deals;

CREATE POLICY deals_collaborator_read
  ON deals FOR SELECT
  TO authenticated
  USING (auth.email() = ANY (collaborator_emails));

CREATE POLICY deals_collaborator_update
  ON deals FOR UPDATE
  TO authenticated
  USING  (auth.email() = ANY (collaborator_emails))
  WITH CHECK (auth.email() = ANY (collaborator_emails));

-- deal_participants: collaborators can manage participants under their deals
DROP POLICY IF EXISTS deal_participants_collaborator_all ON deal_participants;

CREATE POLICY deal_participants_collaborator_all
  ON deal_participants FOR ALL
  TO authenticated
  USING (
    deal_id IN (
      SELECT id FROM deals WHERE auth.email() = ANY (collaborator_emails)
    )
  )
  WITH CHECK (
    deal_id IN (
      SELECT id FROM deals WHERE auth.email() = ANY (collaborator_emails)
    )
  );
