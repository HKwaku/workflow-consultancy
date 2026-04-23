-- ================================================================
-- MIGRATION: Deal concept
-- Tables:    deals, deal_participants
-- Alters:    diagnostic_reports (deal_id, deal_role)
-- ================================================================


-- ── Helpers ─────────────────────────────────────────────────────

-- Readable 8-char deal code from unambiguous chars (no 0/O/1/I)
CREATE OR REPLACE FUNCTION generate_deal_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i      INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, (floor(random() * length(chars))::int) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Reusable updated_at trigger function (CREATE OR REPLACE is safe if it already exists)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ── 1. deals ────────────────────────────────────────────────────
-- One deal = one initiative (PE roll-up / M&A / Scaling).
-- Groups multiple diagnostic_reports from different entities/roles.

CREATE TABLE IF NOT EXISTS deals (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Short human-readable code shown in the portal and shared links
  deal_code      TEXT        NOT NULL DEFAULT generate_deal_code() UNIQUE,

  -- 'pe_rollup'  - PE firm / platform co maps process across portfolio companies
  -- 'ma'         - Acquirer + Target each map their version; decision layer follows
  -- 'scaling'    - Single company, kept here for future grouping / multi-process
  type           TEXT        NOT NULL
                   CHECK (type IN ('pe_rollup', 'ma', 'scaling')),

  name           TEXT        NOT NULL,   -- "Project Falcon", "Roll-up Wave 1"
  process_name   TEXT,                   -- process being mapped (nullable: set later or per-participant)

  owner_email    TEXT        NOT NULL,   -- PE firm / acquirer email
  owner_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 'draft'      - created, not yet shared
  -- 'collecting' - invites sent, participants mapping
  -- 'complete'   - all participants done; deal-level analysis available
  status         TEXT        NOT NULL DEFAULT 'collecting'
                   CHECK (status IN ('draft', 'collecting', 'complete')),

  -- Type-specific config stored as JSONB so each type can evolve independently
  --   pe_rollup: { "benchmark_participant_id": "<uuid>" }
  --   ma:        { "step_decisions": [{ "step_id", "decision", "new_step" }] }
  settings       JSONB       NOT NULL DEFAULT '{}',

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER deals_set_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2. deal_participants ─────────────────────────────────────────
-- One row per entity invited to contribute a diagnostic to the deal.
-- Each participant gets a unique invite token → /process-audit?participant=<token>
-- When they complete their audit, report_id is written back here.

CREATE TABLE IF NOT EXISTS deal_participants (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- pe_rollup:  'platform_company' | 'portfolio_company'
  -- ma:         'acquirer' | 'target'
  -- scaling:    'self'
  role               TEXT        NOT NULL
                       CHECK (role IN (
                         'platform_company',
                         'portfolio_company',
                         'acquirer',
                         'target',
                         'self'
                       )),

  company_name       TEXT        NOT NULL,   -- "Acme Corp", "Platform Co"
  participant_email  TEXT,                   -- email to send invite to (nullable until known)
  participant_name   TEXT,

  -- 36-char hex token; lives only in the invite URL - unguessable, URL-safe
  invite_token       TEXT        NOT NULL UNIQUE
                       DEFAULT encode(gen_random_bytes(18), 'hex'),

  -- Set when participant completes their diagnostic
  report_id          TEXT        REFERENCES diagnostic_reports(id) ON DELETE SET NULL,

  -- 'invited'     - email sent, not yet started
  -- 'in_progress' - opened invite link, started mapping
  -- 'complete'    - diagnostic submitted, report_id populated
  status             TEXT        NOT NULL DEFAULT 'invited'
                       CHECK (status IN ('invited', 'in_progress', 'complete')),

  invited_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 3. Link diagnostic_reports to a deal ────────────────────────

ALTER TABLE diagnostic_reports
  ADD COLUMN IF NOT EXISTS deal_id   UUID REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_role TEXT;
-- deal_role mirrors the participant's role at time of submission
-- so it's preserved even if the deal_participants row changes


-- ── 4. Indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_deals_owner_email
  ON deals (owner_email);

CREATE INDEX IF NOT EXISTS idx_deals_owner_user_id
  ON deals (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_deals_status
  ON deals (status);

CREATE INDEX IF NOT EXISTS idx_deal_participants_deal_id
  ON deal_participants (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_participants_participant_email
  ON deal_participants (participant_email);

CREATE INDEX IF NOT EXISTS idx_deal_participants_invite_token
  ON deal_participants (invite_token);

CREATE INDEX IF NOT EXISTS idx_deal_participants_report_id
  ON deal_participants (report_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_deal_id
  ON diagnostic_reports (deal_id);


-- ── 5. Row Level Security ────────────────────────────────────────

ALTER TABLE deals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_participants ENABLE ROW LEVEL SECURITY;

-- ── deals policies ──

-- Owner (authenticated) has full access
CREATE POLICY deals_owner_all
  ON deals FOR ALL
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR owner_email = auth.email()
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    OR owner_email = auth.email()
  );

-- Authenticated participants can read any deal they're invited to
CREATE POLICY deals_participant_read
  ON deals FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT deal_id
      FROM deal_participants
      WHERE participant_email = auth.email()
    )
  );

-- Anon read: needed so the invite landing page (/process-audit?participant=TOKEN)
-- can resolve deal name + process for the gate pre-fill before the user signs in.
-- Row-level filtering (by deal_code or via participant token join) happens in the API.
CREATE POLICY deals_anon_read
  ON deals FOR SELECT
  TO anon
  USING (true);

-- ── deal_participants policies ──

-- Deal owner manages all participants under their deals
CREATE POLICY deal_participants_owner_all
  ON deal_participants FOR ALL
  TO authenticated
  USING (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email   = auth.email()
    )
  )
  WITH CHECK (
    deal_id IN (
      SELECT id FROM deals
      WHERE owner_user_id = auth.uid()
         OR owner_email   = auth.email()
    )
  );

-- Participant can read their own row (to check status, see deal info)
CREATE POLICY deal_participants_self_read
  ON deal_participants FOR SELECT
  TO authenticated
  USING (participant_email = auth.email());

-- Participant can update their own status (e.g. in_progress → complete)
CREATE POLICY deal_participants_self_update
  ON deal_participants FOR UPDATE
  TO authenticated
  USING  (participant_email = auth.email())
  WITH CHECK (participant_email = auth.email());

-- Anon read: needed to resolve invite_token on the landing page.
-- The token is a 144-bit random secret so exposure here is not a risk.
CREATE POLICY deal_participants_anon_read
  ON deal_participants FOR SELECT
  TO anon
  USING (true);
