-- ============================================================
-- Comprehensive seed for the two demo deals.
--
--   1. M&A: "Apex Bank acquires Lumen Digital"
--      - Acquirer: Apex Bank (10,000 employees, traditional)
--      - Target:   Lumen Digital (digital-native challenger)
--
--   2. PE roll-up: "Helix Health platform consolidation"
--      - Platform:  Helix Health Group
--      - Portfolio: BrightPath Clinics, MedSouth Group, Caregiver Plus
--
-- Every participant gets multiple processes; every process spans
-- multiple departments (which the deal workspace synth turns into
-- sub-functions); every step carries department, workMinutes,
-- waitMinutes, and systems[]. The result populates List / Map /
-- Graph / FTE / Canonical inventory / Insights with realistic data
-- across ~25 processes and ~180 steps.
--
-- WIPE_FIRST = true (default) DELETEs the two demo deals + their
-- linked process rows before rebuilding so re-running gives a
-- fresh dataset. Set to false to keep existing rows.
--
-- OWNER: change OWNER_EMAIL below if you want a different owner.
-- ============================================================

DO $$
DECLARE
  -- Customise these two if needed.
  OWNER_EMAIL  text := 'hope.tettey@gmail.com';
  WIPE_FIRST   boolean := true;

  v_deal_ma           uuid;
  v_deal_pe           uuid;
  v_part_apex         uuid;
  v_part_lumen        uuid;
  v_part_helix        uuid;
  v_part_brightpath   uuid;
  v_part_medsouth     uuid;
  v_part_caregiver    uuid;
  v_report_id         text;
BEGIN

  -- ---------------------------------------------------------------
  -- 0. Optional wipe so re-runs produce a clean dataset.
  -- ---------------------------------------------------------------
  IF WIPE_FIRST THEN
    -- Delete process rows linked through flows or directly via
    -- participants BEFORE deleting the deals (cascade handles
    -- deal_participants and deal_flows; processes has no FK back to deals).
    DELETE FROM public.processes
     WHERE id IN (
       SELECT df.process_id
         FROM public.deal_flows df
         JOIN public.deals d ON d.id = df.deal_id
        WHERE d.name IN ('Apex Bank acquires Lumen Digital',
                         'Helix Health platform consolidation')
          AND df.process_id IS NOT NULL
       UNION
       SELECT dp.process_id
         FROM public.deal_participants dp
         JOIN public.deals d ON d.id = dp.deal_id
        WHERE d.name IN ('Apex Bank acquires Lumen Digital',
                         'Helix Health platform consolidation')
          AND dp.process_id IS NOT NULL
     );
    DELETE FROM public.deals
     WHERE name IN ('Apex Bank acquires Lumen Digital',
                    'Helix Health platform consolidation');
    RAISE NOTICE 'Wiped existing demo deals + linked reports.';
  END IF;

  -- ===============================================================
  -- 1. M&A deal: Apex Bank -> Lumen Digital
  -- ===============================================================
  INSERT INTO public.deals
    (type, name, process_name, owner_email, status, settings)
  VALUES
    ('ma',
     'Apex Bank acquires Lumen Digital',
     'Day-1 integration baseline',
     OWNER_EMAIL,
     'collecting',
     jsonb_build_object(
       'canonicalStart', 'LOI signed',
       'canonicalEnd',   'Day 90 integration complete'))
  RETURNING id INTO v_deal_ma;
  RAISE NOTICE 'Created M&A deal %', v_deal_ma;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_ma, 'acquirer', 'Apex Bank', 'Apex Integration Team', 'in_progress')
  RETURNING id INTO v_part_apex;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_ma, 'target', 'Lumen Digital', 'Lumen CTO', 'in_progress')
  RETURNING id INTO v_part_lumen;

  -- ----- APEX BANK: 5 processes spanning 8 departments -----

  -- A1. Retail customer onboarding (Branch ops -> Compliance -> Cards)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Apex Integration Team', 'Apex Bank',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Retail customer onboarding', 'costs', jsonb_build_object('hoursPerInstance', 3, 'teamSize', 4, 'annual', 960), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Branch greeter intake',     'department', 'Branch ops',  'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Branch portal')),
         jsonb_build_object('name', 'Form completion assistance','department', 'Branch ops',  'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('Branch portal','Forms repository')),
         jsonb_build_object('name', 'KYC document collection',   'department', 'Compliance',  'workMinutes', 40, 'waitMinutes',    0, 'systems', jsonb_build_array('KYC portal','Document scanner')),
         jsonb_build_object('name', 'Manual ID verification',    'department', 'Compliance',  'workMinutes', 30, 'waitMinutes', 1440, 'systems', jsonb_build_array('KYC portal','PEP screening')),
         jsonb_build_object('name', 'Sanctions screening',       'department', 'Compliance',  'workMinutes', 20, 'waitMinutes',  240, 'systems', jsonb_build_array('Sanctions DB')),
         jsonb_build_object('name', 'Account opening in core',   'department', 'Branch ops',  'workMinutes', 35, 'waitMinutes',    0, 'systems', jsonb_build_array('Core banking')),
         jsonb_build_object('name', 'Card issuance request',     'department', 'Cards',       'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('Card mgmt')),
         jsonb_build_object('name', 'Physical card production',  'department', 'Cards',       'workMinutes', 10, 'waitMinutes', 4320, 'systems', jsonb_build_array('Card mgmt','Embossing vendor')),
         jsonb_build_object('name', 'Welcome pack mailout',      'department', 'Branch ops',  'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Mailroom'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_apex, 'Retail customer onboarding (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- A2. Mortgage underwriting (Mortgage -> Underwriting -> Risk -> Treasury)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Apex Integration Team', 'Apex Bank',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Mortgage underwriting', 'costs', jsonb_build_object('hoursPerInstance', 5, 'teamSize', 3, 'annual', 576), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Application receipt',       'department', 'Mortgage',     'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('LOS')),
         jsonb_build_object('name', 'Document checklist build',  'department', 'Mortgage',     'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('LOS','Forms repository')),
         jsonb_build_object('name', 'Credit pull',               'department', 'Underwriting', 'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('Bureau API')),
         jsonb_build_object('name', 'Income verification',       'department', 'Underwriting', 'workMinutes', 45, 'waitMinutes', 2880, 'systems', jsonb_build_array('Open banking API')),
         jsonb_build_object('name', 'Property valuation order',  'department', 'Underwriting', 'workMinutes', 20, 'waitMinutes', 7200, 'systems', jsonb_build_array('Valuation vendor')),
         jsonb_build_object('name', 'Risk score calculation',    'department', 'Risk',         'workMinutes', 30, 'waitMinutes',    0, 'systems', jsonb_build_array('Risk engine')),
         jsonb_build_object('name', 'Manual underwriter review', 'department', 'Underwriting', 'workMinutes', 90, 'waitMinutes',  240),
         jsonb_build_object('name', 'Affordability stress test', 'department', 'Risk',         'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Risk engine')),
         jsonb_build_object('name', 'Funding allocation',        'department', 'Treasury',     'workMinutes', 30, 'waitMinutes',  720, 'systems', jsonb_build_array('Treasury portal')),
         jsonb_build_object('name', 'Approve + draw funds',      'department', 'Mortgage',     'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Core banking','Treasury portal'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_apex, 'Mortgage underwriting (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- A3. Customer dispute resolution (Customer service -> Branch ops -> Compliance)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Apex Integration Team', 'Apex Bank',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Customer dispute resolution', 'costs', jsonb_build_object('hoursPerInstance', 2.5, 'teamSize', 2, 'annual', 992), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Inbound complaint logged',      'department', 'Customer service', 'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('CRM','Phone IVR')),
         jsonb_build_object('name', 'Initial triage + categorise',   'department', 'Customer service', 'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('CRM')),
         jsonb_build_object('name', 'Branch case assignment',        'department', 'Branch ops',       'workMinutes', 10, 'waitMinutes',  480, 'systems', jsonb_build_array('CRM','Branch portal')),
         jsonb_build_object('name', 'Investigation + evidence pull', 'department', 'Branch ops',       'workMinutes', 60, 'waitMinutes', 2880, 'systems', jsonb_build_array('Core banking','Document scanner')),
         jsonb_build_object('name', 'Compliance second review',      'department', 'Compliance',       'workMinutes', 45, 'waitMinutes', 1440, 'systems', jsonb_build_array('Compliance system')),
         jsonb_build_object('name', 'Resolution decision',           'department', 'Customer service', 'workMinutes', 30, 'waitMinutes',    0, 'systems', jsonb_build_array('CRM')),
         jsonb_build_object('name', 'Customer comms + closure',      'department', 'Customer service', 'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('CRM','Email gateway'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_apex, 'Customer dispute resolution (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- A4. Branch cash management (Branch ops -> Treasury -> IT)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Apex Integration Team', 'Apex Bank',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Branch cash management', 'costs', jsonb_build_object('hoursPerInstance', 1.5, 'teamSize', 2, 'annual', 960), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Daily cash count',          'department', 'Branch ops', 'workMinutes', 30, 'waitMinutes',    0, 'systems', jsonb_build_array('Cash mgmt')),
         jsonb_build_object('name', 'Reconciliation to core',    'department', 'Branch ops', 'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Cash mgmt','Core banking')),
         jsonb_build_object('name', 'Treasury sweep request',    'department', 'Treasury',   'workMinutes', 15, 'waitMinutes',  240, 'systems', jsonb_build_array('Treasury portal')),
         jsonb_build_object('name', 'CIT pickup scheduled',      'department', 'Treasury',   'workMinutes', 10, 'waitMinutes', 1440, 'systems', jsonb_build_array('CIT vendor')),
         jsonb_build_object('name', 'Vault transaction logged',  'department', 'Branch ops', 'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Cash mgmt')),
         jsonb_build_object('name', 'GL posting + audit trail',  'department', 'IT',         'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('GL system','Audit logs'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_apex, 'Branch cash management (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- A5. Card issuance + delivery (Cards -> Compliance -> IT)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Apex Integration Team', 'Apex Bank',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Card issuance + delivery', 'costs', jsonb_build_object('hoursPerInstance', 2, 'teamSize', 2, 'annual', 1060), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Card request received',     'department', 'Cards',      'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Card mgmt')),
         jsonb_build_object('name', 'Risk eligibility check',    'department', 'Compliance', 'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('Risk engine')),
         jsonb_build_object('name', 'Card design + personalise', 'department', 'Cards',      'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('Card mgmt','Embossing vendor')),
         jsonb_build_object('name', 'Bureau notification',       'department', 'Compliance', 'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Bureau API')),
         jsonb_build_object('name', 'PIN mail prepared',         'department', 'Cards',      'workMinutes', 10, 'waitMinutes',  720, 'systems', jsonb_build_array('PIN gateway')),
         jsonb_build_object('name', 'Card production batch',     'department', 'Cards',      'workMinutes', 10, 'waitMinutes', 4320, 'systems', jsonb_build_array('Embossing vendor')),
         jsonb_build_object('name', 'Activation logged in core', 'department', 'IT',         'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Core banking','Audit logs'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_apex, 'Card issuance + delivery (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- ----- LUMEN DIGITAL: 4 processes, digital-native shape -----

  -- L1. App-based account opening (Product -> Risk -> Engineering -> Treasury)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Lumen CTO', 'Lumen Digital',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'App-based account opening', 'costs', jsonb_build_object('hoursPerInstance', 0.5, 'teamSize', 2, 'annual', 2880), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'App download + signup',      'department', 'Product',     'workMinutes',  3, 'waitMinutes', 0, 'systems', jsonb_build_array('Mobile app','Auth0')),
         jsonb_build_object('name', 'Email + phone verify',       'department', 'Product',     'workMinutes',  2, 'waitMinutes', 0, 'systems', jsonb_build_array('Twilio','SendGrid')),
         jsonb_build_object('name', 'Selfie + ID auto-verify',    'department', 'Risk',        'workMinutes',  5, 'waitMinutes', 0, 'systems', jsonb_build_array('Onfido')),
         jsonb_build_object('name', 'Sanctions screening',        'department', 'Risk',        'workMinutes',  3, 'waitMinutes', 0, 'systems', jsonb_build_array('ComplyAdvantage')),
         jsonb_build_object('name', 'Account provisioned',        'department', 'Engineering', 'workMinutes',  2, 'waitMinutes', 0, 'systems', jsonb_build_array('Core ledger')),
         jsonb_build_object('name', 'Treasury liquidity reserve', 'department', 'Treasury',    'workMinutes',  4, 'waitMinutes', 0, 'systems', jsonb_build_array('Treasury platform')),
         jsonb_build_object('name', 'Virtual card issued',        'department', 'Engineering', 'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Marqeta')),
         jsonb_build_object('name', 'Welcome push notification',  'department', 'Product',     'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Mobile app','OneSignal'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_lumen, 'App-based account opening (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- L2. In-app support resolution (Support -> Engineering -> Product)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Lumen CTO', 'Lumen Digital',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'In-app support resolution', 'costs', jsonb_build_object('hoursPerInstance', 0.5, 'teamSize', 2, 'annual', 1520), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'AI chat triage',           'department', 'Support',     'workMinutes',  5, 'waitMinutes',  0, 'systems', jsonb_build_array('Intercom','OpenAI')),
         jsonb_build_object('name', 'Knowledge base lookup',    'department', 'Support',     'workMinutes',  3, 'waitMinutes',  0, 'systems', jsonb_build_array('Notion','Algolia')),
         jsonb_build_object('name', 'Bug ticket auto-create',   'department', 'Engineering', 'workMinutes',  2, 'waitMinutes',  0, 'systems', jsonb_build_array('Linear','Sentry')),
         jsonb_build_object('name', 'Human escalation',         'department', 'Support',     'workMinutes', 25, 'waitMinutes', 60, 'systems', jsonb_build_array('Intercom')),
         jsonb_build_object('name', 'Resolution + survey',      'department', 'Support',     'workMinutes',  5, 'waitMinutes',  0, 'systems', jsonb_build_array('Intercom','Delighted')),
         jsonb_build_object('name', 'Product feedback logged',  'department', 'Product',     'workMinutes',  3, 'waitMinutes',  0, 'systems', jsonb_build_array('Productboard'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_lumen, 'In-app support resolution (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- L3. FX wallet top-up (Treasury -> Engineering -> Support)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Lumen CTO', 'Lumen Digital',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'FX wallet top-up', 'costs', jsonb_build_object('hoursPerInstance', 0.2, 'teamSize', 2, 'annual', 2600), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'User picks currency',        'department', 'Product',     'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Mobile app')),
         jsonb_build_object('name', 'Quote streamed to client',   'department', 'Treasury',    'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Wise FX API')),
         jsonb_build_object('name', 'User confirms quote',        'department', 'Product',     'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Mobile app')),
         jsonb_build_object('name', 'Funds debited from GBP',     'department', 'Engineering', 'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Core ledger')),
         jsonb_build_object('name', 'FX leg settled',             'department', 'Treasury',    'workMinutes',  2, 'waitMinutes', 0, 'systems', jsonb_build_array('Wise FX API','Treasury platform')),
         jsonb_build_object('name', 'Wallet credit confirmed',    'department', 'Engineering', 'workMinutes',  1, 'waitMinutes', 0, 'systems', jsonb_build_array('Core ledger','OneSignal'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_lumen, 'FX wallet top-up (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- L4. Card dispute auto-handle (Risk -> Compliance -> Support)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Lumen CTO', 'Lumen Digital',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Card dispute auto-handle', 'costs', jsonb_build_object('hoursPerInstance', 0.3, 'teamSize', 2, 'annual', 2080), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'In-app dispute raised',       'department', 'Product',    'workMinutes',  2, 'waitMinutes',   0, 'systems', jsonb_build_array('Mobile app')),
         jsonb_build_object('name', 'Auto-classify reason code',   'department', 'Risk',       'workMinutes',  1, 'waitMinutes',   0, 'systems', jsonb_build_array('OpenAI','Risk engine')),
         jsonb_build_object('name', 'Provisional credit posted',   'department', 'Compliance', 'workMinutes',  3, 'waitMinutes',   0, 'systems', jsonb_build_array('Core ledger','Marqeta')),
         jsonb_build_object('name', 'Network chargeback initiated','department', 'Risk',       'workMinutes',  4, 'waitMinutes', 720, 'systems', jsonb_build_array('Marqeta')),
         jsonb_build_object('name', 'Evidence package uploaded',   'department', 'Compliance', 'workMinutes',  6, 'waitMinutes',   0, 'systems', jsonb_build_array('Marqeta','Document store')),
         jsonb_build_object('name', 'Outcome reconciliation',      'department', 'Risk',       'workMinutes',  4, 'waitMinutes',1440, 'systems', jsonb_build_array('Marqeta','Core ledger')),
         jsonb_build_object('name', 'Customer notified',           'department', 'Support',    'workMinutes',  2, 'waitMinutes',   0, 'systems', jsonb_build_array('Intercom','OneSignal'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_ma, v_part_lumen, 'Card dispute auto-handle (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- ===============================================================
  -- 2. PE roll-up: Helix Health Group + 3 portfolio companies
  -- ===============================================================
  INSERT INTO public.deals
    (type, name, process_name, owner_email, status, settings)
  VALUES
    ('pe_rollup',
     'Helix Health platform consolidation',
     'Patient intake harmonisation',
     OWNER_EMAIL,
     'collecting',
     jsonb_build_object(
       'canonicalStart', 'Patient enquiry received',
       'canonicalEnd',   'Patient seen + recorded in EMR'))
  RETURNING id INTO v_deal_pe;
  RAISE NOTICE 'Created PE roll-up deal %', v_deal_pe;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_pe, 'platform_company', 'Helix Health Group', 'Helix Operating Partner', 'in_progress')
  RETURNING id INTO v_part_helix;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_pe, 'portfolio_company', 'BrightPath Clinics', 'BrightPath COO', 'in_progress')
  RETURNING id INTO v_part_brightpath;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_pe, 'portfolio_company', 'MedSouth Group', 'MedSouth Director', 'in_progress')
  RETURNING id INTO v_part_medsouth;

  INSERT INTO public.deal_participants
    (deal_id, role, company_name, participant_name, status)
  VALUES
    (v_deal_pe, 'portfolio_company', 'Caregiver Plus', 'Caregiver Plus Lead', 'in_progress')
  RETURNING id INTO v_part_caregiver;

  -- ----- HELIX HEALTH (platform): 4 canonical processes -----

  -- H1. Patient intake (canonical) - Front desk -> Billing -> Clinical
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Helix Operating Partner', 'Helix Health Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Patient intake (canonical)', 'costs', jsonb_build_object('hoursPerInstance', 2, 'teamSize', 2, 'annual', 1280), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Online booking',           'department', 'Front desk', 'workMinutes',  4, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal')),
         jsonb_build_object('name', 'Insurance auto-verify',    'department', 'Billing',    'workMinutes',  3, 'waitMinutes',    0, 'systems', jsonb_build_array('Eligibility API')),
         jsonb_build_object('name', 'Reminder + check-in link', 'department', 'Front desk', 'workMinutes',  2, 'waitMinutes', 1440, 'systems', jsonb_build_array('SMS gateway','Helix portal')),
         jsonb_build_object('name', 'Self check-in',            'department', 'Front desk', 'workMinutes',  3, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal')),
         jsonb_build_object('name', 'Vitals captured',          'department', 'Clinical',   'workMinutes',  8, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic')),
         jsonb_build_object('name', 'Clinician sees patient',   'department', 'Clinical',   'workMinutes', 25, 'waitMinutes',    0),
         jsonb_build_object('name', 'EMR notes auto-summary',   'department', 'Clinical',   'workMinutes',  6, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic','OpenAI')),
         jsonb_build_object('name', 'Claim auto-submitted',     'department', 'Billing',    'workMinutes',  4, 'waitMinutes',    0, 'systems', jsonb_build_array('Claims clearinghouse'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_helix, 'Patient intake (canonical platform standard)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- H2. Insurance pre-authorization - Billing -> Clinical -> Compliance
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Helix Operating Partner', 'Helix Health Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Insurance pre-authorization', 'costs', jsonb_build_object('hoursPerInstance', 2, 'teamSize', 2, 'annual', 840), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Procedure code captured',   'department', 'Clinical',   'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic')),
         jsonb_build_object('name', 'Eligibility check',         'department', 'Billing',    'workMinutes',  3, 'waitMinutes',    0, 'systems', jsonb_build_array('Eligibility API')),
         jsonb_build_object('name', 'Pre-auth packet built',     'department', 'Billing',    'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('Claims clearinghouse','Document store')),
         jsonb_build_object('name', 'Clinical justification',    'department', 'Clinical',   'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic')),
         jsonb_build_object('name', 'Submit to payer',           'department', 'Billing',    'workMinutes',  5, 'waitMinutes', 4320, 'systems', jsonb_build_array('Claims clearinghouse')),
         jsonb_build_object('name', 'Compliance audit trail',    'department', 'Compliance', 'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Audit logs')),
         jsonb_build_object('name', 'Approval recorded',         'department', 'Billing',    'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_helix, 'Insurance pre-authorization (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- H3. Lab results review - Clinical -> IT -> Front desk
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Helix Operating Partner', 'Helix Health Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Lab results review', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 2, 'annual', 1160), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Lab result ingested',       'department', 'IT',         'workMinutes',  2, 'waitMinutes',    0, 'systems', jsonb_build_array('LIS','HL7 gateway')),
         jsonb_build_object('name', 'Auto-flag abnormal values', 'department', 'IT',         'workMinutes',  1, 'waitMinutes',    0, 'systems', jsonb_build_array('LIS','Rules engine')),
         jsonb_build_object('name', 'Clinician review',          'department', 'Clinical',   'workMinutes', 15, 'waitMinutes',  240, 'systems', jsonb_build_array('Epic')),
         jsonb_build_object('name', 'Patient comms drafted',     'department', 'Clinical',   'workMinutes',  8, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic','OpenAI')),
         jsonb_build_object('name', 'Result published in portal','department', 'IT',         'workMinutes',  2, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal')),
         jsonb_build_object('name', 'Follow-up call scheduled',  'department', 'Front desk', 'workMinutes',  6, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal','SMS gateway'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_helix, 'Lab results review (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- H4. Patient discharge + follow-up - Clinical -> Billing -> Operations
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Helix Operating Partner', 'Helix Health Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Patient discharge + follow-up', 'costs', jsonb_build_object('hoursPerInstance', 1.5, 'teamSize', 2, 'annual', 960), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Discharge plan drafted',     'department', 'Clinical',   'workMinutes', 12, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic')),
         jsonb_build_object('name', 'Medication reconciliation',  'department', 'Clinical',   'workMinutes', 15, 'waitMinutes',    0, 'systems', jsonb_build_array('Epic','Pharmacy system')),
         jsonb_build_object('name', 'Final billing reconciled',   'department', 'Billing',    'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Claims clearinghouse')),
         jsonb_build_object('name', 'Patient signs discharge',    'department', 'Clinical',   'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal')),
         jsonb_build_object('name', 'Discharge summary sent',     'department', 'Operations', 'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Email gateway')),
         jsonb_build_object('name', 'Follow-up reminder',         'department', 'Operations', 'workMinutes',  3, 'waitMinutes', 7200, 'systems', jsonb_build_array('SMS gateway')),
         jsonb_build_object('name', 'Outcome survey logged',      'department', 'Operations', 'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Helix portal'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_helix, 'Patient discharge + follow-up (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- ----- BRIGHTPATH CLINICS: 3 processes, close to platform standard -----

  -- B1. Patient intake (current)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'BrightPath COO', 'BrightPath Clinics',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Patient intake (BrightPath)', 'costs', jsonb_build_object('hoursPerInstance', 1.6, 'teamSize', 2, 'annual', 1050), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Online booking',           'department', 'Front desk', 'workMinutes',  6, 'waitMinutes',    0, 'systems', jsonb_build_array('Acuity')),
         jsonb_build_object('name', 'Insurance manual verify',  'department', 'Billing',    'workMinutes', 18, 'waitMinutes',  240, 'systems', jsonb_build_array('Phone','Eligibility portal')),
         jsonb_build_object('name', 'Reminder call',            'department', 'Front desk', 'workMinutes',  5, 'waitMinutes', 1440, 'systems', jsonb_build_array('Phone')),
         jsonb_build_object('name', 'Manual check-in',          'department', 'Front desk', 'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Athena')),
         jsonb_build_object('name', 'Clinician sees patient',   'department', 'Clinical',   'workMinutes', 25, 'waitMinutes',    0),
         jsonb_build_object('name', 'EMR notes typed',          'department', 'Clinical',   'workMinutes', 18, 'waitMinutes',    0, 'systems', jsonb_build_array('Athena')),
         jsonb_build_object('name', 'Claim submitted',          'department', 'Billing',    'workMinutes',  8, 'waitMinutes',    0, 'systems', jsonb_build_array('Athena'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_brightpath, 'Patient intake (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- B2. Appointment scheduling
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'BrightPath COO', 'BrightPath Clinics',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Appointment scheduling', 'costs', jsonb_build_object('hoursPerInstance', 0.5, 'teamSize', 2, 'annual', 1360), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Patient request received',  'department', 'Front desk', 'workMinutes',  3, 'waitMinutes',  0, 'systems', jsonb_build_array('Acuity','Phone')),
         jsonb_build_object('name', 'Slot availability lookup',  'department', 'Front desk', 'workMinutes',  4, 'waitMinutes',  0, 'systems', jsonb_build_array('Acuity')),
         jsonb_build_object('name', 'Confirmation sent',         'department', 'IT',         'workMinutes',  2, 'waitMinutes',  0, 'systems', jsonb_build_array('SMS gateway','Email gateway')),
         jsonb_build_object('name', 'Calendar synced to EMR',    'department', 'IT',         'workMinutes',  2, 'waitMinutes',  0, 'systems', jsonb_build_array('Acuity','Athena')),
         jsonb_build_object('name', '48h reminder',              'department', 'Front desk', 'workMinutes',  2, 'waitMinutes', 2880, 'systems', jsonb_build_array('SMS gateway'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_brightpath, 'Appointment scheduling (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- B3. Insurance verification
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'BrightPath COO', 'BrightPath Clinics',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Insurance verification (BrightPath)', 'costs', jsonb_build_object('hoursPerInstance', 0.8, 'teamSize', 2, 'annual', 950), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Card photo collected',      'department', 'Front desk', 'workMinutes',  3, 'waitMinutes',   0, 'systems', jsonb_build_array('Acuity')),
         jsonb_build_object('name', 'Eligibility lookup',        'department', 'Billing',    'workMinutes', 12, 'waitMinutes',   0, 'systems', jsonb_build_array('Eligibility portal')),
         jsonb_build_object('name', 'Coverage gaps flagged',     'department', 'Billing',    'workMinutes',  8, 'waitMinutes',   0, 'systems', jsonb_build_array('Eligibility portal','Athena')),
         jsonb_build_object('name', 'Patient cost-share calc',   'department', 'Billing',    'workMinutes',  5, 'waitMinutes',   0, 'systems', jsonb_build_array('Athena')),
         jsonb_build_object('name', 'Estimate sent to patient',  'department', 'Front desk', 'workMinutes',  4, 'waitMinutes', 480, 'systems', jsonb_build_array('Email gateway')),
         jsonb_build_object('name', 'Acceptance recorded',       'department', 'Front desk', 'workMinutes',  3, 'waitMinutes',   0, 'systems', jsonb_build_array('Athena'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_brightpath, 'Insurance verification (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- ----- MEDSOUTH GROUP: 3 paper-heavy processes, big remediation upside -----

  -- M1. Patient intake (current) - heavy paper trail
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'MedSouth Director', 'MedSouth Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Patient intake (MedSouth)', 'costs', jsonb_build_object('hoursPerInstance', 2.5, 'teamSize', 2, 'annual', 1216), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Phone booking',            'department', 'Front desk', 'workMinutes', 12, 'waitMinutes',    0, 'systems', jsonb_build_array('Phone')),
         jsonb_build_object('name', 'Paper form mailed',        'department', 'Records',    'workMinutes',  8, 'waitMinutes', 4320, 'systems', jsonb_build_array('Mailroom')),
         jsonb_build_object('name', 'Fax insurance forms',      'department', 'Billing',    'workMinutes', 25, 'waitMinutes', 1440, 'systems', jsonb_build_array('Fax')),
         jsonb_build_object('name', 'Manual eligibility check', 'department', 'Billing',    'workMinutes', 30, 'waitMinutes',  480, 'systems', jsonb_build_array('Phone','Eligibility portal')),
         jsonb_build_object('name', 'Paper file pulled',        'department', 'Records',    'workMinutes', 10, 'waitMinutes',    0, 'systems', jsonb_build_array('Filing cabinet')),
         jsonb_build_object('name', 'Manual check-in form',     'department', 'Front desk', 'workMinutes', 12, 'waitMinutes',    0, 'systems', jsonb_build_array('Paper forms')),
         jsonb_build_object('name', 'Clinician sees patient',   'department', 'Clinical',   'workMinutes', 30, 'waitMinutes',    0),
         jsonb_build_object('name', 'Notes typed into EMR',     'department', 'Clinical',   'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('eClinicalWorks'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_medsouth, 'Patient intake (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- M2. Manual records pull
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'MedSouth Director', 'MedSouth Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Manual records pull', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 2, 'annual', 960), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Records request received', 'department', 'Front desk', 'workMinutes',  8, 'waitMinutes',    0, 'systems', jsonb_build_array('Phone','Paper forms')),
         jsonb_build_object('name', 'Filing room search',       'department', 'Records',    'workMinutes', 35, 'waitMinutes',    0, 'systems', jsonb_build_array('Filing cabinet')),
         jsonb_build_object('name', 'Photocopy + redact',       'department', 'Records',    'workMinutes', 25, 'waitMinutes',    0, 'systems', jsonb_build_array('Photocopier')),
         jsonb_build_object('name', 'Fax to clinician',         'department', 'Records',    'workMinutes', 10, 'waitMinutes',  720, 'systems', jsonb_build_array('Fax')),
         jsonb_build_object('name', 'Clinician annotates',      'department', 'Clinical',   'workMinutes', 20, 'waitMinutes',    0, 'systems', jsonb_build_array('Paper forms')),
         jsonb_build_object('name', 'File returned to records', 'department', 'Front desk', 'workMinutes',  5, 'waitMinutes',    0, 'systems', jsonb_build_array('Filing cabinet'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_medsouth, 'Manual records pull (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- M3. Phone-based scheduling
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'MedSouth Director', 'MedSouth Group',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Phone-based scheduling', 'costs', jsonb_build_object('hoursPerInstance', 0.5, 'teamSize', 2, 'annual', 1520), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Patient calls in',          'department', 'Front desk', 'workMinutes',  5, 'waitMinutes',  0, 'systems', jsonb_build_array('Phone')),
         jsonb_build_object('name', 'Manual diary lookup',       'department', 'Front desk', 'workMinutes',  8, 'waitMinutes',  0, 'systems', jsonb_build_array('Paper diary')),
         jsonb_build_object('name', 'Slot pencil-booked',        'department', 'Records',    'workMinutes',  5, 'waitMinutes',  0, 'systems', jsonb_build_array('Paper diary')),
         jsonb_build_object('name', 'Confirmation letter typed', 'department', 'Records',    'workMinutes', 10, 'waitMinutes',  0, 'systems', jsonb_build_array('Word processor','Photocopier')),
         jsonb_build_object('name', 'Letter posted',             'department', 'Records',    'workMinutes',  5, 'waitMinutes', 4320, 'systems', jsonb_build_array('Mailroom'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_medsouth, 'Phone-based scheduling (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  -- ----- CAREGIVER PLUS: 1 in-progress process -----

  -- C1. Caregiver visit scheduling (Operations -> Front desk)
  v_report_id := gen_random_uuid()::text;
  INSERT INTO public.processes
    (id, contact_email, contact_name, company,
     flow_data, created_at, updated_at)
  VALUES
    (v_report_id, OWNER_EMAIL, 'Caregiver Plus Lead', 'Caregiver Plus',
     jsonb_build_object('rawProcesses', jsonb_build_array(
       jsonb_build_object('name', 'Caregiver visit scheduling', 'costs', jsonb_build_object('hoursPerInstance', 1, 'teamSize', 2, 'annual', 1160), 'steps', jsonb_build_array(
         jsonb_build_object('name', 'Care request intake',     'department', 'Front desk', 'workMinutes',  8, 'waitMinutes',   0, 'systems', jsonb_build_array('Phone','CRM')),
         jsonb_build_object('name', 'Caregiver availability',  'department', 'Operations', 'workMinutes', 12, 'waitMinutes', 240, 'systems', jsonb_build_array('Roster app')),
         jsonb_build_object('name', 'Visit slot confirmed',    'department', 'Operations', 'workMinutes',  5, 'waitMinutes',   0, 'systems', jsonb_build_array('Roster app','SMS gateway')),
         jsonb_build_object('name', 'Care plan handover',      'department', 'Operations', 'workMinutes', 10, 'waitMinutes',   0, 'systems', jsonb_build_array('CRM','Email gateway')),
         jsonb_build_object('name', 'Visit completed + signed','department', 'Front desk', 'workMinutes',  6, 'waitMinutes',   0, 'systems', jsonb_build_array('Mobile app'))
       ))
     )), now(), now());
  INSERT INTO public.deal_flows
    (deal_id, participant_id, label, flow_kind, process_id, status, created_by_email)
  VALUES
    (v_deal_pe, v_part_caregiver, 'Caregiver visit scheduling (current)', 'current', v_report_id, 'complete', OWNER_EMAIL);

  RAISE NOTICE 'Demo deals seed complete. M&A=%  PE=%', v_deal_ma, v_deal_pe;
END $$;
