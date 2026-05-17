-- ============================================================
-- Seed: Vesno org workspace test data
--
-- Creates (or finds) the Vesno organisation, its default operating model,
-- a representative function tree (Finance / Sales / Operations / Tech /
-- People / Customer Success with sub-functions), 4 roles, 5 systems, and
-- 8 processes filed under the functions.
--
-- Idempotent — safe to re-run. Each insert is guarded so duplicates
-- aren't created.
--
-- Schema-aware: detects whether the rename-to-functions migration has
-- been applied and uses the right table + column names either way.
--   * Pre-rename:  public.capabilities + parent_capability_id + capability_id(s)
--   * Post-rename: public.functions    + parent_function_id   + function_id(s)
-- All inserts use EXECUTE format() so the same script works for both.
--
-- Prerequisite: migration-operating-model.sql must be applied (creates
-- operating_models + capabilities/functions + model_roles + model_systems).
-- If neither table exists this script raises a clear error.
--
-- After running:
--   * Open /workspace as a Vesno member → see populated tree + processes
--   * Reina's chat sees the function tree in her system prompt
--   * Insights / heatmap / inventory all render with real numbers
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor).
-- ============================================================

DO $$
DECLARE
  -- Re-running is idempotent (INSERT ... WHERE NOT EXISTS on process
  -- name) — which means it never *updates* an already-seeded process.
  -- When true (default), delete the seeded processes for this model
  -- first so a re-run picks up flow_data changes (e.g. the per-process
  -- `costs` block that drives the cost heatmap). Scoped by model id +
  -- the known seeded name set, so user-created processes are untouched.
  REFRESH_PROCESSES  boolean := true;

  -- Schema detection
  v_caps_table       text;  -- 'functions' or 'capabilities'
  v_parent_col       text;  -- 'parent_function_id' or 'parent_capability_id'
  v_role_ids_col     text;  -- 'function_ids' or 'capability_ids'
  v_dr_fk_col        text;  -- 'function_id' or 'capability_id' on diagnostic_reports

  -- Resolved row ids
  v_org_id              uuid;
  v_model_id            uuid;
  v_finance_id          uuid;
  v_finance_ar_id       uuid;
  v_finance_ap_id       uuid;
  v_sales_id            uuid;
  v_sales_pipeline_id   uuid;
  v_ops_id              uuid;
  v_ops_fulfil_id       uuid;
  v_tech_id             uuid;
  v_people_id           uuid;
  v_cs_id               uuid;
  v_role_arm_id         uuid;
  v_role_seller_id      uuid;
  v_role_ops_lead_id    uuid;
  v_role_csm_id         uuid;
  v_role_ap_id          uuid;
  v_role_it_id          uuid;
  v_role_people_id      uuid;
BEGIN

  -- ---------- 0. Schema detection ----------
  IF to_regclass('public.functions') IS NOT NULL THEN
    v_caps_table   := 'functions';
    v_parent_col   := 'parent_function_id';
    v_role_ids_col := 'function_ids';
    v_dr_fk_col    := 'function_id';
    RAISE NOTICE 'Schema: post-rename (functions table)';
  ELSIF to_regclass('public.capabilities') IS NOT NULL THEN
    v_caps_table   := 'capabilities';
    v_parent_col   := 'parent_capability_id';
    v_role_ids_col := 'capability_ids';
    v_dr_fk_col    := 'capability_id';
    RAISE NOTICE 'Schema: pre-rename (capabilities table)';
  ELSE
    RAISE EXCEPTION 'Neither public.functions nor public.capabilities exists. Apply supabase/migration-operating-model.sql first.';
  END IF;

  -- ---------- 1. Vesno organisation ----------
  SELECT id INTO v_org_id FROM public.organizations WHERE lower(name) = 'vesno' LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name)
      VALUES ('Vesno')
      RETURNING id INTO v_org_id;
    RAISE NOTICE 'Created organization Vesno (%)', v_org_id;
  ELSE
    RAISE NOTICE 'Found existing organization Vesno (%)', v_org_id;
  END IF;

  -- ---------- 2. Default operating model ----------
  SELECT id INTO v_model_id
    FROM public.operating_models
   WHERE organization_id = v_org_id AND name = 'Vesno operating model'
   LIMIT 1;
  IF v_model_id IS NULL THEN
    INSERT INTO public.operating_models (organization_id, name, kind, status, description)
      VALUES (
        v_org_id,
        'Vesno operating model',
        'single_entity',
        'active',
        'Seeded test workspace covering Finance, Sales, Operations, Technology, People, and Customer Success.'
      )
      RETURNING id INTO v_model_id;
    RAISE NOTICE 'Created operating model Vesno (%)', v_model_id;
  END IF;

  UPDATE public.organizations
     SET default_operating_model_id = v_model_id
   WHERE id = v_org_id AND default_operating_model_id IS NULL;

  -- ---------- 3. Functions (top-level + nested) ----------
  -- Helper macro idea: lookup-or-insert. Done via EXECUTE format() so
  -- the same script handles both `functions` and `capabilities` tables.

  -- Top-level: Finance
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_finance_id USING v_model_id, 'Finance';
  IF v_finance_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_finance_id USING v_model_id, 'Finance', 'enabling', 'live', 'Books, billing, treasury, FP&A.', 0;
  END IF;

  -- Top-level: Sales
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_sales_id USING v_model_id, 'Sales';
  IF v_sales_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_sales_id USING v_model_id, 'Sales', 'value_chain', 'live', 'Lead → opportunity → closed-won.', 1;
  END IF;

  -- Top-level: Operations
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_ops_id USING v_model_id, 'Operations';
  IF v_ops_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_ops_id USING v_model_id, 'Operations', 'value_chain', 'live', 'Fulfilment, supply, service delivery.', 2;
  END IF;

  -- Top-level: Technology
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_tech_id USING v_model_id, 'Technology';
  IF v_tech_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_tech_id USING v_model_id, 'Technology', 'enabling', 'live', 'Engineering, product, infrastructure.', 3;
  END IF;

  -- Top-level: People
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_people_id USING v_model_id, 'People';
  IF v_people_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_people_id USING v_model_id, 'People', 'enabling', 'live', 'Hiring, onboarding, performance, payroll.', 4;
  END IF;

  -- Top-level: Customer Success
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I IS NULL LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_cs_id USING v_model_id, 'Customer Success';
  IF v_cs_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_caps_table
    ) INTO v_cs_id USING v_model_id, 'Customer Success', 'value_chain', 'live', 'Onboarding, support, renewals, expansion.', 5;
  END IF;

  -- Nested: Finance → Accounts Receivable
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_finance_ar_id USING v_model_id, 'Accounts Receivable', v_finance_id;
  IF v_finance_ar_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      v_caps_table, v_parent_col
    ) INTO v_finance_ar_id USING v_model_id, 'Accounts Receivable', v_finance_id, 'enabling', 'live', 'Invoicing through cash collection.', 0;
  END IF;

  -- Nested: Finance → Accounts Payable
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_finance_ap_id USING v_model_id, 'Accounts Payable', v_finance_id;
  IF v_finance_ap_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      v_caps_table, v_parent_col
    ) INTO v_finance_ap_id USING v_model_id, 'Accounts Payable', v_finance_id, 'enabling', 'live', 'Supplier invoices through payment.', 1;
  END IF;

  -- Nested: Sales → Pipeline
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_sales_pipeline_id USING v_model_id, 'Pipeline', v_sales_id;
  IF v_sales_pipeline_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      v_caps_table, v_parent_col
    ) INTO v_sales_pipeline_id USING v_model_id, 'Pipeline', v_sales_id, 'value_chain', 'live', 'Pipeline reviews + forecast hygiene.', 0;
  END IF;

  -- Nested: Operations → Fulfilment
  EXECUTE format(
    'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
    v_caps_table, v_parent_col
  ) INTO v_ops_fulfil_id USING v_model_id, 'Fulfilment', v_ops_id;
  IF v_ops_fulfil_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      v_caps_table, v_parent_col
    ) INTO v_ops_fulfil_id USING v_model_id, 'Fulfilment', v_ops_id, 'value_chain', 'live', 'Pick, pack, ship, returns.', 0;
  END IF;

  -- Sub-function rule: every top-level function MUST have at least one
  -- sub-function (even if it's a duplicate of the parent name). The graph
  -- view + role tagging treat sub-functions as the leaf granularity, so a
  -- function with no sub leaves a hole in the chart and breaks step-level
  -- ownership. Backfill the remaining top-level functions here so the
  -- whole tree has consistent depth. Sub-block has its own DECLARE so the
  -- temp ids stay local.
  DECLARE
    v_tech_eng_id      uuid;
    v_people_hiring_id uuid;
    v_cs_onboarding_id uuid;
  BEGIN
    -- Technology -> Engineering
    EXECUTE format(
      'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
      v_caps_table, v_parent_col
    ) INTO v_tech_eng_id USING v_model_id, 'Engineering', v_tech_id;
    IF v_tech_eng_id IS NULL THEN
      EXECUTE format(
        'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        v_caps_table, v_parent_col
      ) INTO v_tech_eng_id USING v_model_id, 'Engineering', v_tech_id, 'enabling', 'live', 'Product engineering + infrastructure.', 0;
    END IF;

    -- People -> Hiring
    EXECUTE format(
      'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
      v_caps_table, v_parent_col
    ) INTO v_people_hiring_id USING v_model_id, 'Hiring', v_people_id;
    IF v_people_hiring_id IS NULL THEN
      EXECUTE format(
        'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        v_caps_table, v_parent_col
      ) INTO v_people_hiring_id USING v_model_id, 'Hiring', v_people_id, 'enabling', 'live', 'Sourcing, interviews, offers, onboarding.', 0;
    END IF;

    -- Customer Success -> Onboarding
    EXECUTE format(
      'SELECT id FROM public.%I WHERE operating_model_id = $1 AND name = $2 AND %I = $3 LIMIT 1',
      v_caps_table, v_parent_col
    ) INTO v_cs_onboarding_id USING v_model_id, 'Onboarding', v_cs_id;
    IF v_cs_onboarding_id IS NULL THEN
      EXECUTE format(
        'INSERT INTO public.%I (operating_model_id, name, %I, layer, status, description, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        v_caps_table, v_parent_col
      ) INTO v_cs_onboarding_id USING v_model_id, 'Onboarding', v_cs_id, 'value_chain', 'live', 'New-customer activation + first-90-days success.', 0;
    END IF;
  END;

  -- ---------- 4. Roles ----------
  SELECT id INTO v_role_arm_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'AR Manager' LIMIT 1;
  IF v_role_arm_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_arm_id
      USING v_model_id, 'AR Manager', 2, 'sarah.hoyle@vesno.test', ARRAY[v_finance_ar_id], 'Owns invoicing + collections.';
  END IF;

  SELECT id INTO v_role_seller_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'Account Executive' LIMIT 1;
  IF v_role_seller_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_seller_id
      USING v_model_id, 'Account Executive', 6, 'lead.ae@vesno.test', ARRAY[v_sales_id, v_sales_pipeline_id], 'Hunters running outbound + closing.';
  END IF;

  SELECT id INTO v_role_ops_lead_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'Operations Lead' LIMIT 1;
  IF v_role_ops_lead_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_ops_lead_id
      USING v_model_id, 'Operations Lead', 1, 'ops.lead@vesno.test', ARRAY[v_ops_id, v_ops_fulfil_id], 'Site lead across fulfilment + service delivery.';
  END IF;

  SELECT id INTO v_role_csm_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'Customer Success Manager' LIMIT 1;
  IF v_role_csm_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_csm_id
      USING v_model_id, 'Customer Success Manager', 3, 'csm.lead@vesno.test', ARRAY[v_cs_id], 'Onboarding, QBRs, renewals.';
  END IF;

  -- Coverage roles so every functional area in the seeded processes has
  -- a real model_role to point its steps at. Without these, AP / IT /
  -- People-tagged steps inherit no department and the cost rollup loses
  -- per-step attribution.
  SELECT id INTO v_role_ap_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'AP Specialist' LIMIT 1;
  IF v_role_ap_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_ap_id
      USING v_model_id, 'AP Specialist', 1, 'ap.specialist@vesno.test', ARRAY[v_finance_ap_id], 'Supplier invoice intake + payment runs.';
  END IF;

  SELECT id INTO v_role_it_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'IT Engineer' LIMIT 1;
  IF v_role_it_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_it_id
      USING v_model_id, 'IT Engineer', 2, 'it.lead@vesno.test', ARRAY[v_tech_id], 'Provisioning, internal tooling, on-call escalations.';
  END IF;

  SELECT id INTO v_role_people_id FROM public.model_roles
   WHERE operating_model_id = v_model_id AND name = 'People Operations' LIMIT 1;
  IF v_role_people_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.model_roles (operating_model_id, name, headcount, owner_email, %I, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_role_ids_col
    ) INTO v_role_people_id
      USING v_model_id, 'People Operations', 2, 'people.ops@vesno.test', ARRAY[v_people_id], 'Hiring ops, onboarding, payroll handover.';
  END IF;

  -- ---------- 5. Systems ----------
  -- model_systems columns are unchanged by the rename migration.
  INSERT INTO public.model_systems (operating_model_id, name, vendor, category, layer, owner_email, description) VALUES
    (v_model_id, 'NetSuite',   'Oracle',     'ERP',      'system_of_record', 'finance.lead@vesno.test', 'Books + billing.'),
    (v_model_id, 'Salesforce', 'Salesforce', 'CRM',      'system_of_record', 'rev.ops@vesno.test',      'Pipeline, opportunities, quotes.'),
    (v_model_id, 'Stripe',     'Stripe',     'Payments', 'workflow',         'finance.lead@vesno.test', 'Card collections + payouts.'),
    (v_model_id, 'Zendesk',    'Zendesk',    'Support',  'workflow',         'cs.lead@vesno.test',      'Ticketing + macros.'),
    (v_model_id, 'Slack',      'Slack',      'Comms',    'comms',            'it.lead@vesno.test',      'Internal comms + handoffs.')
  ON CONFLICT (operating_model_id, match_key) DO NOTHING;

  -- ---------- 5b. Refresh seeded processes ----------
  -- Without this, the idempotent INSERT below skips processes that
  -- already exist (matched by name), so flow_data edits in this file
  -- never reach a previously-seeded database. Delete only the seeded
  -- set for THIS operating model — never user-created processes.
  IF REFRESH_PROCESSES THEN
    DELETE FROM public.processes
     WHERE operating_model_id = v_model_id
       AND COALESCE(
             flow_data->'rawProcesses'->0->>'name',
             flow_data->'processes'->0->>'name'
           ) IN (
             'Cash collection',
             'Supplier invoice processing',
             'Weekly pipeline review',
             'Lead-to-opportunity handoff',
             'Order fulfilment',
             'Returns processing',
             'New customer onboarding',
             'New starter laptop provisioning',
             'Quote-to-cash',
             'Hire-to-onboard',
             'Customer escalation'
           );
    RAISE NOTICE 'Refreshed seeded Vesno processes (REFRESH_PROCESSES = true).';
  END IF;

  -- ---------- 6. Processes (public.processes) ----------
  -- Post living-workspace schema: insert into public.processes with
  -- flow_data (not the diagnostic_reports compat view; the dropped
  -- diagnostic_mode / total_annual_cost / potential_savings /
  -- automation_percentage columns are gone — cost now derives from the
  -- per-process `costs` block in flow_data). Spanning processes carry
  -- per-step `functionId` tags so the heatmap / map credit work to the
  -- function it actually happens in (the JSONB key is read by
  -- deriveCostByFunction alongside capabilityId for older data).
  EXECUTE format($SQL$
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, operating_model_id, %I, created_at, updated_at)
  SELECT * FROM (VALUES
    (gen_random_uuid(),
     'finance.lead@vesno.test', 'Finance Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Cash collection', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 768), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Generate invoice',         'workMinutes', 15, 'systems', jsonb_build_array('NetSuite'),                                       'roleId', $12::text, 'department', 'AR Manager'),
         jsonb_build_object('name', 'Send invoice to customer', 'workMinutes',  5, 'systems', jsonb_build_array('NetSuite'),                                       'roleId', $12::text, 'department', 'AR Manager'),
         jsonb_build_object('name', 'Chase overdue',            'workMinutes', 30, 'waitMinutes', 1440, 'systems', jsonb_build_array('Salesforce'),                'roleId', $12::text, 'department', 'AR Manager')
       ))
     )),
     $1, $2, now(), now()),

    -- SPANS Operations (receiving + match) -> Finance/AP (approval + payment)
    (gen_random_uuid(),
     'finance.lead@vesno.test', 'Finance Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Supplier invoice processing', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 992), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Receive invoice', 'workMinutes',  5, 'systems', jsonb_build_array('NetSuite'),                                                'functionId', $4, 'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Three-way match', 'workMinutes', 25, 'systems', jsonb_build_array('NetSuite'),                                                'functionId', $4, 'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Approve + pay',   'workMinutes', 10, 'waitMinutes', 720, 'systems', jsonb_build_array('NetSuite', 'Stripe'),                  'functionId', $3, 'roleId', $16::text, 'department', 'AP Specialist')
       ))
     )),
     $1, $3, now(), now()),

    (gen_random_uuid(),
     'rev.ops@vesno.test', 'Rev Ops', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Weekly pipeline review', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 880), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Pull pipeline report', 'workMinutes',  20, 'systems', jsonb_build_array('Salesforce'),                                        'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Manager 1:1s',         'workMinutes', 240,                                                                                   'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Forecast roll-up',     'workMinutes',  60, 'systems', jsonb_build_array('Salesforce'),                                        'roleId', $13::text, 'department', 'Account Executive')
       ))
     )),
     $1, $5, now(), now()),

    (gen_random_uuid(),
     'rev.ops@vesno.test', 'Rev Ops', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Lead-to-opportunity handoff', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 1152), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Inbound qualification', 'workMinutes', 15, 'systems', jsonb_build_array('Salesforce'),                                        'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'AE assignment',         'workMinutes',  5, 'systems', jsonb_build_array('Salesforce', 'Slack'),                              'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Discovery call',        'workMinutes', 60, 'waitMinutes', 2880,                                                              'roleId', $13::text, 'department', 'Account Executive')
       ))
     )),
     $1, $6, now(), now()),

    -- SPANS Sales (order intake) -> Ops/Fulfil -> Finance/AR (invoice)
    (gen_random_uuid(),
     'ops.lead@vesno.test', 'Operations Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Order fulfilment', 'costs', jsonb_build_object('hoursPerInstance', 1.5, 'teamSize', 1, 'annual', 1280), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Order received',   'workMinutes',  5,                                                                                         'functionId', $6,  'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Pick + pack',      'workMinutes', 45,                                                                                         'functionId', $7,  'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Ship',             'workMinutes', 10, 'waitMinutes', 1440,                                                                   'functionId', $7,  'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Confirm delivery', 'workMinutes',  5,                                                                                         'functionId', $7,  'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Issue invoice',    'workMinutes', 15,                                                                                         'functionId', $2,  'roleId', $12::text, 'department', 'AR Manager')
       ))
     )),
     $1, $7, now(), now()),

    (gen_random_uuid(),
     'ops.lead@vesno.test', 'Operations Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Returns processing', 'costs', jsonb_build_object('hoursPerInstance', 0.75, 'teamSize', 1, 'annual', 960), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Return request received', 'workMinutes', 10, 'systems', jsonb_build_array('Zendesk'),                                          'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Inspect returned item',   'workMinutes', 20,                                                                                  'roleId', $14::text, 'department', 'Operations Lead'),
         jsonb_build_object('name', 'Issue refund',            'workMinutes', 10, 'systems', jsonb_build_array('Stripe'),                                          'roleId', $14::text, 'department', 'Operations Lead')
       ))
     )),
     $1, $8, now(), now()),

    -- SPANS Sales handoff -> CS welcome -> Tech provisioning -> Finance/AR billing
    (gen_random_uuid(),
     'cs.lead@vesno.test', 'CS Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'New customer onboarding', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 576), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Sales handover',      'workMinutes', 30,                                                                                      'functionId', $6,  'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Welcome call',        'workMinutes', 60,                                                                                      'functionId', $9,  'roleId', $15::text, 'department', 'Customer Success Manager'),
         jsonb_build_object('name', 'Provision workspace', 'workMinutes', 90, 'systems', jsonb_build_array('Slack'),                                              'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Set up billing',      'workMinutes', 20, 'systems', jsonb_build_array('NetSuite', 'Stripe'),                                'functionId', $2,  'roleId', $12::text, 'department', 'AR Manager'),
         jsonb_build_object('name', 'First-week check-in', 'workMinutes', 30, 'waitMinutes', 7200,                                                                'functionId', $9,  'roleId', $15::text, 'department', 'Customer Success Manager')
       ))
     )),
     $1, $9, now(), now()),

    -- SPANS People (HR trigger) -> Tech (procurement + imaging + handover)
    (gen_random_uuid(),
     'it.lead@vesno.test', 'IT Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'New starter laptop provisioning', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 448), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'New hire confirmed',       'workMinutes',  5,                                                                                  'functionId', $11, 'roleId', $18::text, 'department', 'People Operations'),
         jsonb_build_object('name', 'Order hardware',           'workMinutes', 10,                                                                                  'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Image laptop',             'workMinutes', 45,                                                                                  'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Hand over to new starter', 'workMinutes', 20, 'waitMinutes', 4320,                                                            'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer')
       ))
     )),
     $1, $10, now(), now()),

    -- SPANS Sales/Pipeline -> Finance/AR (quote -> invoice -> cash)
    (gen_random_uuid(),
     'rev.ops@vesno.test', 'Rev Ops', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Quote-to-cash', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 2, 'annual', 720), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Build quote',           'workMinutes', 30, 'systems', jsonb_build_array('Salesforce'),                                        'functionId', $5, 'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Customer signs',        'workMinutes',  5, 'waitMinutes', 2880,                                                              'functionId', $5, 'roleId', $13::text, 'department', 'Account Executive'),
         jsonb_build_object('name', 'Generate invoice',      'workMinutes', 15, 'systems', jsonb_build_array('NetSuite'),                                          'functionId', $2, 'roleId', $12::text, 'department', 'AR Manager'),
         jsonb_build_object('name', 'Apply payment',         'workMinutes', 10, 'systems', jsonb_build_array('NetSuite', 'Stripe'),                              'functionId', $2, 'roleId', $12::text, 'department', 'AR Manager')
       ))
     )),
     $1, $5, now(), now()),

    -- SPANS People (offer + ID) -> Tech (hardware + accounts) -> Finance/AR (payroll setup)
    (gen_random_uuid(),
     'people.lead@vesno.test', 'People Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Hire-to-onboard', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 544), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Offer accepted',        'workMinutes', 10,                                                                                    'functionId', $11, 'roleId', $18::text, 'department', 'People Operations'),
         jsonb_build_object('name', 'Right-to-work check',   'workMinutes', 25, 'waitMinutes', 1440,                                                              'functionId', $11, 'roleId', $18::text, 'department', 'People Operations'),
         jsonb_build_object('name', 'Provision laptop',      'workMinutes', 45,                                                                                    'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Create accounts',       'workMinutes', 20, 'systems', jsonb_build_array('Slack'),                                            'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Add to payroll',        'workMinutes', 15, 'systems', jsonb_build_array('NetSuite'),                                          'functionId', $2,  'roleId', $12::text, 'department', 'AR Manager'),
         jsonb_build_object('name', 'Day-1 induction',       'workMinutes', 60,                                                                                    'functionId', $11, 'roleId', $18::text, 'department', 'People Operations')
       ))
     )),
     $1, $11, now(), now()),

    -- SPANS Customer Success (triage + reply) -> Tech (bug fix) escalation loop
    (gen_random_uuid(),
     'cs.lead@vesno.test', 'CS Lead', 'Vesno',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Customer escalation', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 1, 'annual', 352), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Triage ticket',         'workMinutes', 15, 'systems', jsonb_build_array('Zendesk'),                                            'functionId', $9,  'roleId', $15::text, 'department', 'Customer Success Manager'),
         jsonb_build_object('name', 'Reproduce + log bug',   'workMinutes', 45,                                                                                    'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Patch + release',       'workMinutes', 90, 'waitMinutes', 4320,                                                              'functionId', $10, 'roleId', $17::text, 'department', 'IT Engineer'),
         jsonb_build_object('name', 'Reply to customer',     'workMinutes', 10, 'systems', jsonb_build_array('Zendesk'),                                            'functionId', $9,  'roleId', $15::text, 'department', 'Customer Success Manager')
       ))
     )),
     $1, $9, now(), now())
  ) AS seed(id, contact_email, contact_name, company,
            flow_data, operating_model_id, %I, created_at, updated_at)
  -- Idempotency: match on the process name across BOTH JSONB shapes
  -- ("rawProcesses" current, "processes" legacy from earlier seeds).
  WHERE NOT EXISTS (
    SELECT 1 FROM public.processes dr
     WHERE dr.operating_model_id = seed.operating_model_id
       AND COALESCE(
             dr.flow_data->'rawProcesses'->0->>'name',
             dr.flow_data->'processes'->0->>'name'
           ) = seed.flow_data->'rawProcesses'->0->>'name'
  )
  $SQL$,
    v_dr_fk_col, v_dr_fk_col
  ) USING
    v_model_id,            -- $1 operating_model_id
    v_finance_ar_id,       -- $2 Finance/AR
    v_finance_ap_id,       -- $3 Finance/AP
    v_ops_id,              -- $4 Operations (top-level, for AP receiving)
    v_sales_pipeline_id,   -- $5 Sales/Pipeline
    v_sales_id,            -- $6 Sales (top-level)
    v_ops_fulfil_id,       -- $7 Ops/Fulfilment
    v_ops_id,              -- $8 Operations (returns processing owner)
    v_cs_id,               -- $9 Customer Success
    v_tech_id,             -- $10 Technology
    v_people_id,           -- $11 People
    v_role_arm_id,         -- $12 AR Manager
    v_role_seller_id,      -- $13 Account Executive
    v_role_ops_lead_id,    -- $14 Operations Lead
    v_role_csm_id,         -- $15 Customer Success Manager
    v_role_ap_id,          -- $16 AP Specialist
    v_role_it_id,          -- $17 IT Engineer
    v_role_people_id;      -- $18 People Operations

  RAISE NOTICE 'Vesno seed complete: org=%, model=%, schema=%', v_org_id, v_model_id, v_caps_table;

END $$;
