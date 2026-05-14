-- ============================================================
-- Seed: a handful of changes + outcomes against Vesno processes.
--
-- The Change ROI card on the workspace Insights tab reads from
-- public.changes (predicted impact, lifecycle states) joined to
-- public.change_outcomes (realised metrics). Without rows, the card
-- shows zeros across the board. This seed gives the Vesno demo a
-- realistic mix of proposed -> applied -> live -> measured changes
-- so reviewers can see what the section looks like populated.
--
-- Idempotent: skips if any change already references a Vesno report.
-- Run once after seed-vesno-functions-and-processes.sql so the report
-- ids exist.
-- ============================================================

DO $$
DECLARE
  v_model_id          uuid;
  v_cash_collection   text;  -- diagnostic_reports.id is text
  v_supplier_invoice  text;
  v_quote_to_cash     text;
  v_order_fulfilment  text;
  v_existing_count    int;
  v_change_id_a       uuid;
  v_change_id_b       uuid;
  v_change_id_c       uuid;
BEGIN
  SELECT om.id INTO v_model_id
    FROM public.operating_models om
    JOIN public.organizations o ON o.id = om.organization_id
   WHERE lower(o.name) = 'vesno' AND om.name = 'Vesno operating model'
   LIMIT 1;

  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Vesno operating model not found. Run seed-vesno-functions-and-processes.sql first.';
  END IF;

  -- Bail early if Vesno already has change rows so re-runs don't duplicate.
  SELECT count(*) INTO v_existing_count
    FROM public.changes c
    JOIN public.diagnostic_reports r ON r.id = c.report_id
   WHERE r.operating_model_id = v_model_id;
  IF v_existing_count > 0 THEN
    RAISE NOTICE 'Vesno already has % change row(s); skipping seed.', v_existing_count;
    RETURN;
  END IF;

  -- Resolve the Vesno report ids by process name (the seed uses these
  -- exact names). Each lookup walks both the rawProcesses and processes
  -- JSONB shapes so it works against either form.
  SELECT id INTO v_cash_collection FROM public.diagnostic_reports
   WHERE operating_model_id = v_model_id
     AND COALESCE(diagnostic_data->'rawProcesses'->0->>'name',
                  diagnostic_data->'processes'->0->>'name') = 'Cash collection'
   LIMIT 1;
  SELECT id INTO v_supplier_invoice FROM public.diagnostic_reports
   WHERE operating_model_id = v_model_id
     AND COALESCE(diagnostic_data->'rawProcesses'->0->>'name',
                  diagnostic_data->'processes'->0->>'name') = 'Supplier invoice processing'
   LIMIT 1;
  SELECT id INTO v_quote_to_cash FROM public.diagnostic_reports
   WHERE operating_model_id = v_model_id
     AND COALESCE(diagnostic_data->'rawProcesses'->0->>'name',
                  diagnostic_data->'processes'->0->>'name') = 'Quote-to-cash'
   LIMIT 1;
  SELECT id INTO v_order_fulfilment FROM public.diagnostic_reports
   WHERE operating_model_id = v_model_id
     AND COALESCE(diagnostic_data->'rawProcesses'->0->>'name',
                  diagnostic_data->'processes'->0->>'name') = 'Order fulfilment'
   LIMIT 1;

  IF v_cash_collection IS NULL AND v_supplier_invoice IS NULL
     AND v_quote_to_cash IS NULL AND v_order_fulfilment IS NULL THEN
    RAISE NOTICE 'No Vesno reports found by name; nothing to seed.';
    RETURN;
  END IF;

  -- A: Cash collection -> automate "Chase overdue" reminders. Live, measured.
  IF v_cash_collection IS NOT NULL THEN
    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, principle, actor_kind, agent_name, confidence,
       expected_impact, report_id,
       proposed_at, decided_at, applied_at, live_at, measured_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Cash collection', 'step', 'Chase overdue'),
       'automated', 'measured',
       'Replace manual chase emails with templated reminders fired by NetSuite + Stripe webhook.',
       'automate-handoffs', 'agent', 'redesign', 0.82,
       jsonb_build_object('time_minutes', 2400, 'cost_pct', 12, 'fte', 0.4),
       v_cash_collection,
       now() - interval '42 days', now() - interval '38 days',
       now() - interval '30 days', now() - interval '21 days', now() - interval '7 days')
    RETURNING id INTO v_change_id_a;

    INSERT INTO public.change_outcomes (change_id, metric, unit, value_before, value_after, source, measured_at)
    VALUES
      (v_change_id_a, 'cycle_time_minutes', 'minutes', 1440, 720, 'manual', now() - interval '7 days'),
      (v_change_id_a, 'automation_pct',     'pct',     20,   60,  'manual', now() - interval '7 days');
  END IF;

  -- B: Supplier invoice processing -> consolidate two-stage approval. Live.
  IF v_supplier_invoice IS NOT NULL THEN
    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, principle, actor_kind, agent_name, confidence,
       expected_impact, report_id,
       proposed_at, decided_at, applied_at, live_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Supplier invoice processing', 'step', 'Approve + pay'),
       'merged', 'live',
       'Single approver with auto-pay below £10k threshold; reviewer notified asynchronously.',
       'consolidate', 'agent', 'redesign', 0.74,
       jsonb_build_object('time_minutes', 720, 'cost_pct', 8, 'fte', 0.2),
       v_supplier_invoice,
       now() - interval '21 days', now() - interval '18 days',
       now() - interval '12 days', now() - interval '5 days')
    RETURNING id INTO v_change_id_b;
  END IF;

  -- C: Quote-to-cash -> insert "Auto-validate quote" step. Applied + measured.
  IF v_quote_to_cash IS NOT NULL THEN
    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, principle, actor_kind, agent_name, confidence,
       expected_impact, report_id,
       proposed_at, decided_at, applied_at, measured_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Quote-to-cash', 'step', 'Build quote'),
       'automated', 'measured',
       'Validate pricing + discount rules before sending; halves rework loop.',
       'standardise', 'agent', 'redesign', 0.68,
       jsonb_build_object('time_minutes', 1200, 'error_rate_pct', -35),
       v_quote_to_cash,
       now() - interval '60 days', now() - interval '52 days',
       now() - interval '40 days', now() - interval '14 days')
    RETURNING id INTO v_change_id_c;

    INSERT INTO public.change_outcomes (change_id, metric, unit, value_before, value_after, source, measured_at)
    VALUES
      (v_change_id_c, 'rework_rate_pct', 'pct',     22, 9,  'manual', now() - interval '14 days');
  END IF;

  -- D, E, F: a couple of in-flight proposals so the funnel shows movement.
  IF v_order_fulfilment IS NOT NULL THEN
    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, actor_kind, agent_name, confidence,
       expected_impact, report_id, proposed_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Order fulfilment', 'step', 'Confirm delivery'),
       'automated', 'proposed',
       'Pull tracking webhook from carrier; remove the manual confirm step.',
       'agent', 'redesign', 0.71,
       jsonb_build_object('time_minutes', 600, 'cost_pct', 5, 'fte', 0.15),
       v_order_fulfilment, now() - interval '4 days');

    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, actor_kind, agent_name, confidence,
       expected_impact, report_id, proposed_at, decided_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Order fulfilment', 'step', 'Pick + pack'),
       'reordered', 'accepted',
       'Move pick before pack so warehouse staff can batch by zone.',
       'agent', 'redesign', 0.59,
       jsonb_build_object('time_minutes', 900, 'cost_pct', 3),
       v_order_fulfilment, now() - interval '11 days', now() - interval '9 days');
  END IF;

  IF v_cash_collection IS NOT NULL THEN
    INSERT INTO public.changes
      (subject_type, subject_ref, kind, state,
       rationale, actor_kind, agent_name, confidence,
       expected_impact, report_id, proposed_at, decided_at, applied_at)
    VALUES
      ('process_step', jsonb_build_object('process', 'Cash collection', 'step', 'Generate invoice'),
       'automated', 'applied',
       'Auto-generate invoice on contract sign; removes manual trigger.',
       'agent', 'redesign', 0.77,
       jsonb_build_object('time_minutes', 480, 'cost_pct', 4),
       v_cash_collection, now() - interval '14 days', now() - interval '11 days', now() - interval '6 days');
  END IF;

  RAISE NOTICE 'Vesno change ROI seed complete (model=%)', v_model_id;
END $$;
