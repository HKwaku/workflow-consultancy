-- ============================================================
-- Inspect the demo deals seeded by seed-demo-deals.sql.
--
-- Read-only checks. Run any block on its own in the Supabase SQL
-- Editor to see what's there. Each query is parameterised on the
-- two demo deal names so it works whoever the OWNER_EMAIL was.
-- ============================================================

-- 1. Both demo deals at a glance.
SELECT
  d.id,
  d.deal_code,
  d.type,
  d.name,
  d.process_name,
  d.owner_email,
  d.status,
  d.created_at,
  (SELECT count(*) FROM public.deal_participants dp WHERE dp.deal_id = d.id) AS participant_count,
  (SELECT count(*) FROM public.deal_flows df WHERE df.deal_id = d.id)        AS flow_count
FROM public.deals d
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
ORDER BY d.created_at DESC;


-- 2. Participants per deal.
SELECT
  d.name AS deal_name,
  d.type AS deal_type,
  dp.role,
  dp.company_name,
  dp.participant_name,
  dp.status,
  dp.report_id,
  (SELECT count(*) FROM public.deal_flows df WHERE df.participant_id = dp.id) AS flow_count
FROM public.deal_participants dp
JOIN public.deals d ON d.id = dp.deal_id
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
ORDER BY d.name, dp.role, dp.company_name;


-- 3. Flows + which report they point at.
SELECT
  d.name           AS deal_name,
  dp.company_name  AS participant,
  df.label         AS flow_label,
  df.flow_kind,
  df.status        AS flow_status,
  df.report_id,
  r.total_annual_cost,
  r.potential_savings,
  r.automation_percentage,
  jsonb_array_length(COALESCE(r.diagnostic_data->'rawProcesses'->0->'steps', '[]'::jsonb)) AS step_count
FROM public.deal_flows df
JOIN public.deals d                ON d.id  = df.deal_id
LEFT JOIN public.deal_participants dp ON dp.id = df.participant_id
LEFT JOIN public.diagnostic_reports r ON r.id  = df.report_id
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
ORDER BY d.name, dp.company_name, df.label;


-- 4. Step-level detail for every flow (one row per step). Useful for
--    eyeballing the data the deal workspace's tabs render from.
SELECT
  d.name                                      AS deal_name,
  dp.company_name                             AS participant,
  df.label                                    AS flow_label,
  step_idx                                    AS step_position,
  step->>'name'                               AS step_name,
  step->>'department'                         AS department,
  (step->>'workMinutes')::numeric             AS work_minutes,
  (step->>'waitMinutes')::numeric             AS wait_minutes,
  step->'systems'                             AS systems
FROM public.deal_flows df
JOIN public.deals d                ON d.id  = df.deal_id
LEFT JOIN public.deal_participants dp ON dp.id = df.participant_id
JOIN public.diagnostic_reports r   ON r.id  = df.report_id,
LATERAL jsonb_array_elements(r.diagnostic_data->'rawProcesses'->0->'steps')
  WITH ORDINALITY AS s(step, step_idx)
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
ORDER BY d.name, dp.company_name, df.label, step_idx;


-- 5. Distinct (participant, department) pairs - this is exactly the
--    "sub-functions" the deal workspace synthesises from step.department.
SELECT
  d.name           AS deal_name,
  dp.company_name  AS participant,
  step->>'department' AS sub_function,
  count(*)         AS step_mentions,
  sum((step->>'workMinutes')::numeric) FILTER (WHERE step->>'workMinutes' IS NOT NULL) AS total_work_minutes
FROM public.deal_flows df
JOIN public.deals d                ON d.id  = df.deal_id
LEFT JOIN public.deal_participants dp ON dp.id = df.participant_id
JOIN public.diagnostic_reports r   ON r.id  = df.report_id,
LATERAL jsonb_array_elements(r.diagnostic_data->'rawProcesses'->0->'steps') AS step
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
  AND step->>'department' IS NOT NULL
  AND step->>'department' <> ''
GROUP BY d.name, dp.company_name, step->>'department'
ORDER BY d.name, dp.company_name, step->>'department';


-- 6. Distinct systems mentioned across each deal - what the workspace's
--    Canonical inventory tab will list.
SELECT
  d.name           AS deal_name,
  sys             AS system_name,
  count(DISTINCT dp.company_name) AS participants_using,
  count(*)        AS step_mentions
FROM public.deal_flows df
JOIN public.deals d                ON d.id  = df.deal_id
LEFT JOIN public.deal_participants dp ON dp.id = df.participant_id
JOIN public.diagnostic_reports r   ON r.id  = df.report_id,
LATERAL jsonb_array_elements(r.diagnostic_data->'rawProcesses'->0->'steps') AS step,
LATERAL jsonb_array_elements_text(COALESCE(step->'systems', '[]'::jsonb))   AS sys
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
GROUP BY d.name, sys
ORDER BY d.name, count(*) DESC, sys;


-- 7. Per-participant rollup - mirrors the FTE tab and the Insights
--    heatmap rows.
SELECT
  d.name                                AS deal_name,
  dp.company_name                       AS participant,
  dp.role,
  count(DISTINCT df.id)                 AS flow_count,
  sum(r.total_annual_cost)              AS annual_cost,
  sum(r.potential_savings)              AS potential_savings,
  round(avg(r.automation_percentage)::numeric, 1) AS avg_automation_pct
FROM public.deal_participants dp
JOIN public.deals d                ON d.id  = dp.deal_id
LEFT JOIN public.deal_flows df     ON df.participant_id = dp.id
LEFT JOIN public.diagnostic_reports r ON r.id = df.report_id
WHERE d.name IN (
  'Apex Bank acquires Lumen Digital',
  'Helix Health platform consolidation'
)
GROUP BY d.name, dp.company_name, dp.role
ORDER BY d.name, dp.role, dp.company_name;
