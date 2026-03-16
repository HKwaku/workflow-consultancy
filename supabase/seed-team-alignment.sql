-- ============================================================
-- Seed Team Alignment Data
-- One process per company, four submissions per team.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Idempotent: skips team insert if ACME01 exists; replaces responses.
-- To fully reset: DELETE FROM team_responses WHERE team_id IN
--   (SELECT id FROM team_diagnostics WHERE team_code='ACME01');
--   DELETE FROM team_diagnostics WHERE team_code='ACME01';
-- Then run this script again.
-- ============================================================

DO $$
BEGIN
  -- Insert team (skip if ACME01 already exists)
  INSERT INTO public.team_diagnostics (
    id,
    team_code,
    created_by_email,
    created_by_name,
    process_name,
    company,
    description,
    status,
    closed_at,
    created_at
  )
  SELECT
    gen_random_uuid(),
    'ACME01',
    'hope.tettey@gmail.com',
    'Hope Tettey',
    'New customer onboarding',
    'Acme Corp',
    NULL,
    'closed',
    now(),
    now() - interval '1 day'
  WHERE NOT EXISTS (SELECT 1 FROM public.team_diagnostics WHERE team_code = 'ACME01');

  -- Delete existing responses for this team (idempotent re-run)
  DELETE FROM public.team_responses
  WHERE team_id IN (SELECT id FROM public.team_diagnostics WHERE team_code = 'ACME01');

  -- Four submissions with varying metrics (alignment gaps)
  INSERT INTO public.team_responses (id, team_id, respondent_name, respondent_email, respondent_department, response_data, created_at)
  VALUES
    (
      gen_random_uuid(),
      (SELECT id FROM public.team_diagnostics WHERE team_code = 'ACME01' LIMIT 1),
      'Alex Chen',
      NULL,
      'Operations',
      '{
        "processData": {
          "processName": "New customer onboarding",
          "steps": [
            {"name": "Receive request", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Validate information", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Assign to team", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Review documents", "department": "Legal", "isDecision": false, "branches": []},
            {"name": "Approve or reject", "department": "Operations", "isDecision": true, "branches": []},
            {"name": "Update system", "department": "IT", "isDecision": false, "branches": []}
          ],
          "handoffs": [
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "clear"},
            {"method": "System", "clarity": "clear"},
            {"method": "Email", "clarity": "clear"}
          ],
          "lastExample": {"elapsedDays": 8},
          "userTime": {"total": 12}
        },
        "metrics": {
          "elapsedDays": 8,
          "stepsCount": 6,
          "handoffCount": 5,
          "poorHandoffs": 0,
          "totalUserHours": 12
        }
      }'::jsonb,
      now() - interval '4 hours'
    ),
    (
      gen_random_uuid(),
      (SELECT id FROM public.team_diagnostics WHERE team_code = 'ACME01' LIMIT 1),
      'Jordan Taylor',
      NULL,
      'Finance',
      '{
        "processData": {
          "processName": "New customer onboarding",
          "steps": [
            {"name": "Receive request", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Validate information", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Assign to team", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Review documents", "department": "Legal", "isDecision": false, "branches": []},
            {"name": "Approve or reject", "department": "Operations", "isDecision": true, "branches": []},
            {"name": "Update system", "department": "IT", "isDecision": false, "branches": []},
            {"name": "Notify stakeholder", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Archive record", "department": "Operations", "isDecision": false, "branches": []}
          ],
          "handoffs": [
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "yes-major"},
            {"method": "System", "clarity": "clear"},
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "clear"}
          ],
          "lastExample": {"elapsedDays": 12},
          "userTime": {"total": 18}
        },
        "metrics": {
          "elapsedDays": 12,
          "stepsCount": 8,
          "handoffCount": 7,
          "poorHandoffs": 1,
          "totalUserHours": 18
        }
      }'::jsonb,
      now() - interval '3 hours'
    ),
    (
      gen_random_uuid(),
      (SELECT id FROM public.team_diagnostics WHERE team_code = 'ACME01' LIMIT 1),
      'Sam Williams',
      NULL,
      'HR',
      '{
        "processData": {
          "processName": "New customer onboarding",
          "steps": [
            {"name": "Receive request", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Validate information", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Assign to team", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Review documents", "department": "Legal", "isDecision": false, "branches": []},
            {"name": "Approve or reject", "department": "Operations", "isDecision": true, "branches": []},
            {"name": "Update system", "department": "IT", "isDecision": false, "branches": []},
            {"name": "Notify stakeholder", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Archive record", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Generate report", "department": "Finance", "isDecision": false, "branches": []},
            {"name": "Schedule follow-up", "department": "Sales", "isDecision": false, "branches": []}
          ],
          "handoffs": [
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "clear"},
            {"method": "System", "clarity": "clear"},
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "clear"},
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"}
          ],
          "lastExample": {"elapsedDays": 20},
          "userTime": {"total": 24}
        },
        "metrics": {
          "elapsedDays": 20,
          "stepsCount": 10,
          "handoffCount": 9,
          "poorHandoffs": 0,
          "totalUserHours": 24
        }
      }'::jsonb,
      now() - interval '2 hours'
    ),
    (
      gen_random_uuid(),
      (SELECT id FROM public.team_diagnostics WHERE team_code = 'ACME01' LIMIT 1),
      'Casey Morgan',
      NULL,
      'Legal',
      '{
        "processData": {
          "processName": "New customer onboarding",
          "steps": [
            {"name": "Receive request", "department": "Sales", "isDecision": false, "branches": []},
            {"name": "Validate information", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Assign to team", "department": "Operations", "isDecision": false, "branches": []},
            {"name": "Review documents", "department": "Legal", "isDecision": false, "branches": []},
            {"name": "Approve or reject", "department": "Operations", "isDecision": true, "branches": []},
            {"name": "Update system", "department": "IT", "isDecision": false, "branches": []},
            {"name": "Notify stakeholder", "department": "Sales", "isDecision": false, "branches": []}
          ],
          "handoffs": [
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"},
            {"method": "Meeting", "clarity": "clear"},
            {"method": "System", "clarity": "clear"},
            {"method": "Email", "clarity": "clear"},
            {"method": "Slack", "clarity": "clear"}
          ],
          "lastExample": {"elapsedDays": 6},
          "userTime": {"total": 10}
        },
        "metrics": {
          "elapsedDays": 6,
          "stepsCount": 7,
          "handoffCount": 6,
          "poorHandoffs": 0,
          "totalUserHours": 10
        }
      }'::jsonb,
      now() - interval '1 hour'
    );

  RAISE NOTICE 'Seeded team alignment: Acme Corp | New customer onboarding | code: ACME01';
  RAISE NOTICE 'Log in at /portal with hope.tettey@gmail.com, then view /team-results?code=ACME01';
END $$;
