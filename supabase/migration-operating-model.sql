-- ============================================================
-- Operating model as the workspace primitive
--
-- Today the product is funnel-shaped: chat → diagnostic → /report. The
-- report is the destination; once arrived, the journey is done. Each
-- diagnostic_report is a one-off snapshot. Nothing aggregates "these N
-- processes ARE the company's operating model." The portal is a list of
-- past audits, not a living surface.
--
-- This migration introduces the operating-model layer the workspace will
-- be built on:
--
--   operating_models  – one row per model. 1:N with organization so a
--                       holding co or consultant can manage multiples
--                       (parent_model_id supports nesting). Each org gets
--                       a default model created during backfill.
--
--   capabilities      – the model's structural anatomy (Finance, Sales,
--                       Operations …). Hierarchical via parent_capability_id
--                       (Finance → AR → Cash collection). Each existing
--                       process will eventually attach to one.
--
--   model_roles       – named roles with headcount + capability scope.
--                       Lets the workspace answer "who owns what" without
--                       scraping per-step owners. Headcount is a number,
--                       not a user-record FK — keeps it a design surface
--                       rather than a directory (next migration can lift
--                       that if needed).
--
--   model_systems     – normalised system inventory. step.systems[] is a
--                       free-text array today; this is the canonical row
--                       so cross-process queries ("every process touching
--                       Salesforce") work. A future migration will add a
--                       process_systems join table for fast lookup; until
--                       then, callers walk the JSONB.
--
-- Touches on existing tables:
--   diagnostic_reports gains operating_model_id + capability_id +
--     target_data + state_kind + design_owner_email (all nullable).
--     diagnostic_data stays as the canonical "current state". target_data
--     is the designed target. The `changes` table holds the in-flight
--     transformation between current and target.
--   organizations gains default_operating_model_id.
--   deals can optionally bind operating_model_id (e.g. "this deal is
--     designing the post-merger combined entity").
--
-- Backfill: for every organization, create a default model and link the
-- org's existing diagnostic_reports to it. capability_id stays NULL until
-- the user files processes into capabilities. Trial/no-org users get
-- nothing — their reports keep working as today; they don't have a
-- workspace yet.
--
-- Idempotent: every CREATE/ALTER uses IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS; backfill DO-block guards against re-creation.
-- ============================================================

-- ---------- operating_models ----------
CREATE TABLE IF NOT EXISTS public.operating_models (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NOT NULL — every model belongs to an org. Trial users don't get a
  -- model until they create / join one. RLS chains through this column.
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name                text        NOT NULL,
  kind                text        NOT NULL DEFAULT 'single_entity'
                        CHECK (kind IN ('single_entity', 'holding', 'business_unit', 'portfolio_company')),
  -- Lets a holding company own per-portco models; nests at most a few levels.
  parent_model_id     uuid        REFERENCES public.operating_models(id) ON DELETE SET NULL,

  status              text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'design_only')),

  -- Free-text mission / strategy summary surfaced on the workspace home.
  description         text,

  -- Free-form design vocabulary (decision-rights matrix, role taxonomy,
  -- KPI definitions, etc.). Consumers should treat unknown keys as opaque.
  settings            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_by_email    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_models_org    ON public.operating_models (organization_id);
CREATE INDEX IF NOT EXISTS idx_op_models_parent ON public.operating_models (parent_model_id) WHERE parent_model_id IS NOT NULL;

COMMENT ON TABLE public.operating_models IS
  'Top-level entity for the workspace. Aggregates capabilities, roles, systems, and the processes (diagnostic_reports) the org owns.';


-- ---------- capabilities ----------
CREATE TABLE IF NOT EXISTS public.capabilities (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_model_id    uuid        NOT NULL REFERENCES public.operating_models(id) ON DELETE CASCADE,

  name                  text        NOT NULL,
  -- Hierarchical: Finance → AR → Cash collection. NULL = top-level.
  parent_capability_id  uuid        REFERENCES public.capabilities(id) ON DELETE SET NULL,

  layer                 text        NOT NULL DEFAULT 'value_chain'
                          CHECK (layer IN ('value_chain', 'enabling', 'governance', 'unspecified')),
  status                text        NOT NULL DEFAULT 'live'
                          CHECK (status IN ('design', 'live', 'transitioning', 'sunset')),

  owner_email           text,
  description           text,
  -- Sort order within siblings. Picker UI honours this.
  order_index           integer     NOT NULL DEFAULT 0,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capabilities_model  ON public.capabilities (operating_model_id, order_index);
CREATE INDEX IF NOT EXISTS idx_capabilities_parent ON public.capabilities (parent_capability_id) WHERE parent_capability_id IS NOT NULL;

COMMENT ON TABLE public.capabilities IS
  'Hierarchical capability taxonomy for an operating model. Processes (diagnostic_reports) attach to a capability via diagnostic_reports.capability_id.';


-- ---------- model_roles ----------
CREATE TABLE IF NOT EXISTS public.model_roles (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_model_id    uuid        NOT NULL REFERENCES public.operating_models(id) ON DELETE CASCADE,

  name                  text        NOT NULL,
  -- Number, not a directory FK. v1 is a design surface, not a HR system.
  headcount             integer     NOT NULL DEFAULT 1 CHECK (headcount >= 0),
  owner_email           text,

  -- A role can span capabilities (e.g. "Operations Manager" covers
  -- ops + planning). Indexed via GIN so "roles spanning capability X"
  -- is a fast lookup.
  capability_ids        uuid[]      NOT NULL DEFAULT '{}'::uuid[],

  description           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_roles_model     ON public.model_roles (operating_model_id);
CREATE INDEX IF NOT EXISTS idx_model_roles_caps_gin  ON public.model_roles USING gin (capability_ids);

COMMENT ON TABLE public.model_roles IS
  'Named roles with headcount + capability scope. v1 stores headcount as a number; not yet linked to user records.';


-- ---------- model_systems ----------
CREATE TABLE IF NOT EXISTS public.model_systems (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_model_id    uuid        NOT NULL REFERENCES public.operating_models(id) ON DELETE CASCADE,

  name                  text        NOT NULL,
  vendor                text,
  category              text,
  layer                 text        NOT NULL DEFAULT 'other'
                          CHECK (layer IN ('system_of_record', 'productivity', 'workflow', 'analytics', 'comms', 'other')),
  owner_email           text,
  description           text,

  -- Lower-cased name for matching against the free-text step.systems[]
  -- array on existing diagnostic_reports JSONB. Generated column = no
  -- trigger to maintain.
  match_key             text        GENERATED ALWAYS AS (lower(name)) STORED,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Names collide intentionally — "Salesforce" and "salesforce" should be
  -- the same row.
  UNIQUE (operating_model_id, match_key)
);

CREATE INDEX IF NOT EXISTS idx_model_systems_model ON public.model_systems (operating_model_id);

COMMENT ON TABLE public.model_systems IS
  'Normalised system inventory per operating model. Cross-process queries ("every process touching Salesforce") will join through here once migration 38 lands a process_systems table.';


-- ---------- updated_at triggers (helper from earlier migrations) ----------
DROP TRIGGER IF EXISTS operating_models_updated_at ON public.operating_models;
CREATE TRIGGER operating_models_updated_at
  BEFORE UPDATE ON public.operating_models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS capabilities_updated_at ON public.capabilities;
CREATE TRIGGER capabilities_updated_at
  BEFORE UPDATE ON public.capabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS model_roles_updated_at ON public.model_roles;
CREATE TRIGGER model_roles_updated_at
  BEFORE UPDATE ON public.model_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS model_systems_updated_at ON public.model_systems;
CREATE TRIGGER model_systems_updated_at
  BEFORE UPDATE ON public.model_systems
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();


-- ---------- diagnostic_reports — anchor + design surface columns ----------
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS operating_model_id   uuid REFERENCES public.operating_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capability_id        uuid REFERENCES public.capabilities(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_data          jsonb,
  ADD COLUMN IF NOT EXISTS state_kind           text DEFAULT 'current_only'
    CHECK (state_kind IN ('current_only', 'with_target', 'transitioning', 'archived')),
  ADD COLUMN IF NOT EXISTS design_owner_email   text;

CREATE INDEX IF NOT EXISTS idx_reports_op_model    ON public.diagnostic_reports (operating_model_id) WHERE operating_model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_capability  ON public.diagnostic_reports (capability_id)       WHERE capability_id       IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_state_kind  ON public.diagnostic_reports (state_kind);

COMMENT ON COLUMN public.diagnostic_reports.target_data IS
  'Designed target state (JSONB shape mirrors diagnostic_data). Populated when the user opens the design surface; stays NULL for read-only / unmodelled processes. The `changes` table holds the in-flight transformation between diagnostic_data (current) and target_data (target).';

COMMENT ON COLUMN public.diagnostic_reports.state_kind IS
  'Workspace lifecycle: current_only (snapshot, no target), with_target (current + target both designed), transitioning (target promoted to in-flight rollout), archived (superseded by a newer process).';


-- ---------- organizations.default_operating_model_id ----------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_operating_model_id uuid REFERENCES public.operating_models(id) ON DELETE SET NULL;


-- ---------- deals.operating_model_id (optional binding) ----------
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS operating_model_id uuid REFERENCES public.operating_models(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_op_model ON public.deals (operating_model_id) WHERE operating_model_id IS NOT NULL;


-- ---------- RLS — anchor on org membership via operating_model.organization_id ----------
-- Read: any org member. Write: org admin (same gate as organizations).
-- Defence in depth — the API also enforces this.

ALTER TABLE public.operating_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capabilities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_systems    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operating_models_member_read ON public.operating_models;
CREATE POLICY operating_models_member_read
  ON public.operating_models
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
       WHERE om.organization_id = operating_models.organization_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS operating_models_admin_write ON public.operating_models;
CREATE POLICY operating_models_admin_write
  ON public.operating_models
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
       WHERE om.organization_id = operating_models.organization_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
       WHERE om.organization_id = operating_models.organization_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  );

-- Capabilities/roles/systems mirror the parent model's policy via a join.
-- Member read (any org member of the parent's org), admin write.

DROP POLICY IF EXISTS capabilities_member_read ON public.capabilities;
CREATE POLICY capabilities_member_read
  ON public.capabilities
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = capabilities.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS capabilities_admin_write ON public.capabilities;
CREATE POLICY capabilities_admin_write
  ON public.capabilities
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = capabilities.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = capabilities.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  );

DROP POLICY IF EXISTS model_roles_member_read ON public.model_roles;
CREATE POLICY model_roles_member_read
  ON public.model_roles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_roles.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS model_roles_admin_write ON public.model_roles;
CREATE POLICY model_roles_admin_write
  ON public.model_roles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_roles.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_roles.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  );

DROP POLICY IF EXISTS model_systems_member_read ON public.model_systems;
CREATE POLICY model_systems_member_read
  ON public.model_systems
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_systems.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS model_systems_admin_write ON public.model_systems;
CREATE POLICY model_systems_admin_write
  ON public.model_systems
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_systems.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = model_systems.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  );


-- ---------- Backfill: a default model per existing organization ----------
DO $$
DECLARE
  v_org      record;
  v_model_id uuid;
  v_admin    text;
BEGIN
  FOR v_org IN
    SELECT id, name FROM public.organizations WHERE default_operating_model_id IS NULL
  LOOP
    -- Pick the most-likely "creator" email so the model has provenance.
    -- Prefer an org admin; fall back to the first member; null if neither.
    SELECT lower(om.email) INTO v_admin
      FROM public.organization_members om
     WHERE om.organization_id = v_org.id
     ORDER BY om.is_org_admin DESC, om.created_at ASC
     LIMIT 1;

    INSERT INTO public.operating_models
      (organization_id, name, kind, status, description, created_by_email)
    VALUES
      (v_org.id,
       coalesce(v_org.name, 'Untitled') || ' operating model',
       'single_entity',
       'active',
       'Default model created by migration 37. Edit name + add capabilities to start designing.',
       v_admin)
    RETURNING id INTO v_model_id;

    UPDATE public.organizations
       SET default_operating_model_id = v_model_id
     WHERE id = v_org.id;

    -- Anchor every existing diagnostic_report owned by this org to the
    -- default model. capability_id stays NULL until the user files it.
    UPDATE public.diagnostic_reports
       SET operating_model_id = v_model_id
     WHERE organization_id = v_org.id AND operating_model_id IS NULL;
  END LOOP;
END $$;

-- Sanity report.
DO $$
DECLARE
  v_model_count    integer;
  v_org_count      integer;
  v_anchored_count integer;
BEGIN
  SELECT count(*) INTO v_model_count    FROM public.operating_models;
  SELECT count(*) INTO v_org_count      FROM public.organizations;
  SELECT count(*) INTO v_anchored_count FROM public.diagnostic_reports WHERE operating_model_id IS NOT NULL;
  RAISE NOTICE 'Backfill done: % operating_models created (% orgs total). % diagnostic_reports anchored.',
    v_model_count, v_org_count, v_anchored_count;
END $$;
