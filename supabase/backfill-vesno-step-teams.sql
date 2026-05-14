-- ============================================================
-- Backfill: tag every seeded Vesno step with department + roleId
--
-- The Vesno seed previously wrote step-level departments via the
-- in-app step inspector (Reina's update_step / the manual picker).
-- Older runs of seed-vesno-functions-and-processes.sql shipped without
-- department / roleId on the JSONB steps, so the swimlane chart shows
-- everything in a single "Other" lane and the FTE rollup loses
-- attribution.
--
-- This script walks the diagnostic_reports rows for the Vesno operating
-- model and updates each known seeded step in place:
--   * `department` -> the human-readable role name (drives swimlanes)
--   * `roleId`     -> the model_roles uuid (drives step-driven FTE)
--
-- Idempotent: re-running just rewrites the same fields. Real user-added
-- steps are left alone (we only patch steps whose `name` matches a row
-- in the mapping table below).
--
-- Run AFTER seed-vesno-functions-and-processes.sql so the matching
-- model_roles already exist. Safe to re-run any time.
-- ============================================================

DO $$
DECLARE
  v_model_id   uuid;
  r_role_id    uuid;
  r_role_name  text;
  v_step_name  text;
BEGIN
  SELECT om.id INTO v_model_id
    FROM public.operating_models om
    JOIN public.organizations o ON o.id = om.organization_id
   WHERE lower(o.name) = 'vesno' AND om.name = 'Vesno operating model'
   LIMIT 1;

  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Vesno operating model not found. Run seed-vesno-functions-and-processes.sql first.';
  END IF;

  -- Mapping: step.name (case-insensitive) -> role name. The seed uses
  -- these exact step names; if you rename a step in the seed, update
  -- the mapping here too.
  --
  -- Walk each (step_name, role_name) pair, look up the role uuid in
  -- model_roles, then patch every matching step in every report under
  -- the Vesno model.
  FOR v_step_name, r_role_name IN
    SELECT * FROM (VALUES
      ('Generate invoice',         'AR Manager'),
      ('Send invoice to customer', 'AR Manager'),
      ('Chase overdue',            'AR Manager'),
      ('Receive invoice',          'Operations Lead'),
      ('Three-way match',          'Operations Lead'),
      ('Approve + pay',            'AP Specialist'),
      ('Pull pipeline report',     'Account Executive'),
      ('Manager 1:1s',             'Account Executive'),
      ('Forecast roll-up',         'Account Executive'),
      ('Inbound qualification',    'Account Executive'),
      ('AE assignment',            'Account Executive'),
      ('Discovery call',           'Account Executive'),
      ('Order received',           'Account Executive'),
      ('Pick + pack',              'Operations Lead'),
      ('Ship',                     'Operations Lead'),
      ('Confirm delivery',         'Operations Lead'),
      ('Issue invoice',            'AR Manager'),
      ('Return request received',  'Operations Lead'),
      ('Inspect returned item',    'Operations Lead'),
      ('Issue refund',             'Operations Lead'),
      ('Sales handover',           'Account Executive'),
      ('Welcome call',             'Customer Success Manager'),
      ('Provision workspace',      'IT Engineer'),
      ('Set up billing',           'AR Manager'),
      ('First-week check-in',      'Customer Success Manager'),
      ('New hire confirmed',       'People Operations'),
      ('Order hardware',           'IT Engineer'),
      ('Image laptop',             'IT Engineer'),
      ('Hand over to new starter', 'IT Engineer'),
      ('Build quote',              'Account Executive'),
      ('Customer signs',           'Account Executive'),
      ('Apply payment',            'AR Manager'),
      ('Offer accepted',           'People Operations'),
      ('Right-to-work check',      'People Operations'),
      ('Provision laptop',         'IT Engineer'),
      ('Create accounts',          'IT Engineer'),
      ('Add to payroll',           'AR Manager'),
      ('Day-1 induction',          'People Operations'),
      ('Triage ticket',            'Customer Success Manager'),
      ('Reproduce + log bug',      'IT Engineer'),
      ('Patch + release',          'IT Engineer'),
      ('Reply to customer',        'Customer Success Manager')
    ) AS m(step_name, role_name)
  LOOP
    SELECT id INTO r_role_id
      FROM public.model_roles
     WHERE operating_model_id = v_model_id
       AND name = r_role_name
     LIMIT 1;

    IF r_role_id IS NULL THEN
      RAISE NOTICE 'Skipping "%": role "%" not found in model_roles', v_step_name, r_role_name;
      CONTINUE;
    END IF;

    -- Walk every report under the Vesno model. For each one, rewrite
    -- diagnostic_data.rawProcesses[*].steps[*] by mapping each step:
    -- if the step's name matches v_step_name, merge in department +
    -- roleId; otherwise leave it untouched.
    --
    -- jsonb_set on a deeply nested element is awkward when the
    -- positional index varies row-to-row, so this rebuilds the
    -- rawProcesses array via a SQL expression. The trade-off: every
    -- iteration writes back the whole rawProcesses blob, but it's
    -- a one-shot backfill against ~12 rows so cost is negligible.
    UPDATE public.diagnostic_reports dr
       SET diagnostic_data = jsonb_set(
             dr.diagnostic_data,
             '{rawProcesses}',
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_set(
                   rp,
                   '{steps}',
                   COALESCE((
                     SELECT jsonb_agg(
                       CASE
                         WHEN lower(s->>'name') = lower(v_step_name)
                           THEN s
                                || jsonb_build_object('department', r_role_name)
                                || jsonb_build_object('roleId',     r_role_id::text)
                         ELSE s
                       END
                     )
                     FROM jsonb_array_elements(rp->'steps') AS s
                   ), '[]'::jsonb)
                 )
               )
               FROM jsonb_array_elements(dr.diagnostic_data->'rawProcesses') AS rp
             ), '[]'::jsonb)
           ),
           updated_at = now()
     WHERE dr.operating_model_id = v_model_id
       AND dr.diagnostic_data ? 'rawProcesses'
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(dr.diagnostic_data->'rawProcesses') AS rp,
                jsonb_array_elements(rp->'steps') AS s
          WHERE lower(s->>'name') = lower(v_step_name)
       );
  END LOOP;

  RAISE NOTICE 'Vesno step teams backfill complete (model=%)', v_model_id;
END $$;
