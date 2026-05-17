/**
 * Artefact skill registry.
 *
 * Each skill is a small declarative unit the artefact sub-agent
 * (lib/agents/artefacts/generate.js) is specialised into for one
 * class of deliverable. Adding a new artefact type = adding an entry
 * here; no schema/migration churn because workspace_artefacts.type is
 * free text and `meta` is jsonb (the table is schema-light by design).
 *
 * Shape:
 *   id          stable key (also the `skill` enum value on the tool)
 *   label       human label for the Outputs panel
 *   type        workspace_artefacts.type → drives panel rendering
 *   language    syntax hint for type='code'
 *   whenToUse   one line; aggregated into the emit_artefact tool desc
 *   instructions the output contract handed to the sub-agent
 *   validate(content) → { ok, content?, error? }
 *                structural check + cheap auto-repair (fence strip,
 *                etc). Repaired content is returned in `content`.
 */

const MERMAID_HEADS = [
  'graph', 'flowchart', 'gantt', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey', 'pie',
  'mindmap', 'timeline', 'quadrantChart', 'gitGraph',
];

/** Strip a single leading/trailing ``` fence (``` or ```lang). */
function stripFences(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  return s;
}

function okText(content) {
  const s = stripFences(content);
  if (!s) return { ok: false, error: 'empty content' };
  return { ok: true, content: s };
}

function okJson(content) {
  const s = stripFences(content);
  try { JSON.parse(s); return { ok: true, content: s }; }
  catch (e) { return { ok: false, error: `not valid JSON: ${e.message}` }; }
}

// Accepts array-of-objects, {columns,rows}, or array-of-arrays.
function okTable(content) {
  const s = stripFences(content);
  let data;
  try { data = JSON.parse(s); }
  catch (e) { return { ok: false, error: `table must be a JSON string: ${e.message}` }; }
  const shaped =
    (Array.isArray(data) && data.length && typeof data[0] === 'object') ||
    (data && Array.isArray(data.columns) && Array.isArray(data.rows));
  if (!shaped) return { ok: false, error: 'table JSON must be an array of row objects or {columns,rows}' };
  return { ok: true, content: s };
}

function okCsv(content) {
  const s = stripFences(content);
  const lines = s.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { ok: false, error: 'CSV needs a header row and at least one data row' };
  if (!lines[0].includes(',')) return { ok: false, error: 'CSV header has no columns (no commas)' };
  return { ok: true, content: s };
}

function okMermaid(content) {
  const s = stripFences(content).replace(/^```mermaid\s*/i, '').trim();
  const head = s.split(/\s|\n/)[0] || '';
  if (!MERMAID_HEADS.includes(head)) {
    return { ok: false, error: `mermaid must start with a diagram keyword (got "${head}")` };
  }
  return { ok: true, content: s };
}

function okCode(content) {
  const s = stripFences(content);
  if (!s) return { ok: false, error: 'empty code' };
  return { ok: true, content: s };
}

// Gantt is structured DATA, not a mermaid image — it renders as an
// interactive chart (hover/pin/dependency highlight). Validate the
// shape AND a quality bar (sections, a real dependency sequence,
// milestones, resolvable deps). Failures trigger the one repair pass.
function okGanttData(content) {
  const base = okJson(content);
  if (!base.ok) return base;
  let plan;
  try { plan = JSON.parse(base.content); } catch (e) { return { ok: false, error: e.message }; }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, error: 'top level must be a JSON object { title, sections:[...] }' };
  }
  const sections = Array.isArray(plan.sections) ? plan.sections : null;
  if (!sections || sections.length < 3) {
    return { ok: false, error: `need at least 3 sections (got ${sections ? sections.length : 0})` };
  }
  const ids = new Set();
  const allTasks = [];
  for (const sec of sections) {
    if (!sec || typeof sec.name !== 'string' || !sec.name.trim()) {
      return { ok: false, error: 'every section needs a non-empty "name"' };
    }
    if (!Array.isArray(sec.tasks) || sec.tasks.length === 0) {
      return { ok: false, error: `section "${sec.name}" has no tasks` };
    }
    for (const t of sec.tasks) {
      if (!t || typeof t.id !== 'string' || !t.id.trim()) return { ok: false, error: 'every task needs a string "id"' };
      if (ids.has(t.id)) return { ok: false, error: `duplicate task id "${t.id}"` };
      ids.add(t.id);
      if (typeof t.name !== 'string' || !t.name.trim()) return { ok: false, error: `task "${t.id}" needs a "name"` };
      allTasks.push(t);
    }
  }
  if (allTasks.length < 6) {
    return { ok: false, error: `only ${allTasks.length} tasks — too thin for a real plan (aim 20-32)` };
  }
  let deps = 0; let milestones = 0; let hasAnchor = false;
  for (const t of allTasks) {
    const after = Array.isArray(t.after) ? t.after : (t.after ? [t.after] : []);
    if (after.length) {
      deps += 1;
      for (const a of after) {
        if (!ids.has(a)) return { ok: false, error: `task "${t.id}" depends on unknown id "${a}"` };
      }
    }
    if (typeof t.start === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.start)) return { ok: false, error: `task "${t.id}".start must be YYYY-MM-DD` };
      hasAnchor = true;
    }
    if (t.milestone) milestones += 1;
    else if (!(Number(t.duration) > 0)) {
      return { ok: false, error: `task "${t.id}" needs a positive "duration" (days) or "milestone": true` };
    }
    if (!t.start && !after.length) {
      // A non-anchored task with no deps would float to day 0 — usually
      // a modelling mistake. Allow only if it's explicitly the start.
      hasAnchor = hasAnchor || true;
    }
  }
  if (!hasAnchor) return { ok: false, error: 'at least one task needs an explicit "start" (YYYY-MM-DD) to anchor the timeline' };
  if (deps < Math.max(3, Math.floor(allTasks.length / 3))) {
    return { ok: false, error: `only ${deps} tasks have "after" dependencies — most work must chain so the plan shows a real sequence, not everything at once` };
  }
  if (milestones < 1) {
    return { ok: false, error: 'no milestones — mark phase gates / go-lives with "milestone": true' };
  }
  // Normalised, compact.
  return { ok: true, content: JSON.stringify(plan) };
}

/* ── Registry ─────────────────────────────────────────────────────── */

// Structured-output JSON Schema for any gantt-shaped skill. Kept in
// the supported subset (no recursion, no min/max/length,
// additionalProperties:false on every object) so the sub-agent
// returns a parseable, correctly-shaped plan first-shot; okGanttData
// then enforces the SEMANTIC bar (dependency density, milestones,
// anchor). Shared by `gantt`, `hundred_day_plan`, `automation_roadmap`.
const GANTT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sections'],
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'tasks'],
        properties: {
          name: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                start: { type: 'string' },
                after: { type: 'array', items: { type: 'string' } },
                duration: { type: 'number' },
                milestone: { type: 'boolean' },
                owner: { type: 'string' },
                crit: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
};

export const ARTEFACT_SKILLS = {
  /* Plans & diagrams */
  gantt: {
    id: 'gantt', label: 'Project plan (Gantt)', type: 'gantt',
    whenToUse: 'a timeline / project plan / rollout schedule with phases, dependencies and milestones',
    instructions: [
      'Output ONLY a JSON object (no prose, no code fences) describing an interactive project plan. Schema:',
      '{',
      '  "title": "string — specific, not generic",',
      '  "sections": [',
      '    { "name": "Delivery phase name (named after the work, not \\"Phase 1\\")",',
      '      "tasks": [',
      '        { "id": "short_stable_id", "name": "≤6-word concrete task",',
      '          "start": "YYYY-MM-DD",            // OR "after": ["id", ...]',
      '          "duration": 14,                    // working days, omit for milestones',
      '          "after": ["otherId"],              // dependency ids (preferred over start)',
      '          "milestone": false,                // true = zero-duration gate/go-live',
      '          "owner": "Role/team (optional)",   // optional',
      '          "crit": false }                    // optional hint; the renderer COMPUTES the real critical path from dependencies',
      '      ] }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- 4–6 sections; 4–7 tasks each; 20–32 tasks total. Section + task names grounded in the ACTUAL work in the CONTEXT (the named bottlenecks / recommendations / processes) — never generic.',
      '- Sequencing is the point: most tasks use "after" to chain into a real critical path (discovery → redesign → tooling/rollout → measurement). Only genuinely parallel tracks share a "start". Exactly one (or a few parallel) starting task(s) carry an explicit "start" date to anchor the timeline.',
      '- Durations realistic in working days and proportional to scope — do NOT make everything the same length.',
      '- One "milestone": true task at the end of each phase / each go-live (give it "after" of the phase\'s last tasks; no duration).',
      '- The critical path is COMPUTED from your dependency graph by the renderer — you do not need to flag it. Spend the effort making "after" links accurate and durations realistic instead; that is what makes the computed path correct.',
      '- Ground phases in the CONTEXT figures (bottleneck count, recommendation count, cost, automation %). If the CONTEXT gives no start date, anchor the first task to the 1st of next month.',
      '- Valid JSON only: double-quoted keys/strings, no trailing commas, no comments in the actual output.',
    ].join('\n'),
    validate: okGanttData,
    jsonSchema: GANTT_SCHEMA,
  },
  flow_diagram: {
    id: 'flow_diagram', label: 'Flow / process diagram', type: 'mermaid',
    whenToUse: 'a process flow, decision tree, or system diagram',
    instructions:
      'Output a Mermaid `flowchart TD` (or `graph LR`) and nothing else. Use clear node labels, decision diamonds `{}` for branches, and labelled edges. No prose, no code fences.',
    validate: okMermaid,
  },

  /* Docs & memos */
  one_pager: {
    id: 'one_pager', label: 'Executive one-pager', type: 'markdown',
    whenToUse: 'a concise exec summary / one-pager of a situation or recommendation',
    instructions:
      'Output GitHub-flavoured Markdown only. Structure: a bold one-line thesis, then `## Situation`, `## Findings` (bulleted, quantified), `## Recommendation`, `## Next steps` (numbered, owner + timeframe). Tight and skimmable; under ~500 words.',
    validate: okText,
  },
  policy: {
    id: 'policy', label: 'Policy / SOP', type: 'markdown',
    whenToUse: 'a policy, standard operating procedure, or controlled process document',
    instructions:
      'Output Markdown only. Include: `# Title`, Purpose, Scope, Definitions, Procedure (numbered steps with owners), Controls, Exceptions, Review cadence. Formal, unambiguous, imperative voice.',
    validate: okText,
  },
  decision_memo: {
    id: 'decision_memo', label: 'Decision memo', type: 'markdown',
    whenToUse: 'a memo framing a decision with options and a recommendation',
    instructions:
      'Output Markdown only. Structure: `# Decision`, Context, Options (a `###` per option with pros/cons + rough cost/impact), Recommendation (which + why), Risks & mitigations, Decision owner & by-when.',
    validate: okText,
  },
  raci: {
    id: 'raci', label: 'RACI matrix', type: 'markdown',
    whenToUse: 'a responsibility assignment (RACI) matrix across activities and roles',
    instructions:
      'Output a single Markdown table only. First column = Activity; remaining columns = roles. Cells contain exactly one of R, A, C, I (every row has exactly one A). A one-line legend below the table is allowed. No other prose.',
    validate: okText,
  },

  /* Structured data */
  comparison_table: {
    id: 'comparison_table', label: 'Comparison table', type: 'table',
    whenToUse: 'a side-by-side comparison of options/vendors/processes on criteria',
    instructions:
      'Output ONLY a JSON array of row objects (one object per option/row), every object sharing the same keys. First key should identify the row (e.g. "Option"). Numeric values as numbers, not strings. No prose, no code fences.',
    validate: okTable,
  },
  risk_register: {
    id: 'risk_register', label: 'Risk register', type: 'table',
    whenToUse: 'a risk register: risks with likelihood, impact, owner, mitigation',
    instructions:
      'Output ONLY a JSON array of row objects with keys: id, risk, category, likelihood (1-5), impact (1-5), score (likelihood*impact), owner, mitigation, status. No prose, no code fences.',
    validate: okTable,
  },
  dataset: {
    id: 'dataset', label: 'Dataset (CSV)', type: 'csv',
    whenToUse: 'a tabular dataset the user may export to a spreadsheet',
    instructions:
      'Output ONLY CSV: a header row then data rows. Quote fields containing commas/newlines with double quotes. No prose, no code fences, no commentary.',
    validate: okCsv,
  },

  /* Analytical / code */
  scenario_model: {
    id: 'scenario_model', label: 'Scenario / financial model', type: 'json',
    whenToUse: 'a what-if / financial model: scenarios x metrics with computed totals',
    instructions:
      'Output ONLY a JSON object: { "assumptions": { ...key:value }, "columns": ["Metric","Base","Scenario A",...], "rows": [["Annual cost", 612000, 540000], ...] }. Numbers as numbers. Include a final row for the net/total. State assumptions explicitly. No prose, no code fences.',
    validate: okJson,
  },
  sql: {
    id: 'sql', label: 'SQL query', type: 'code', language: 'sql',
    whenToUse: 'a SQL query (cohort, metric, extract) for the user to run',
    instructions:
      'Output ONLY the SQL. Use CTEs for readability, comment non-obvious logic with `--`, qualify columns. Assume standard ANSI SQL unless the spec names a dialect. No prose, no code fences.',
    validate: okCode,
  },
  kpi_tree: {
    id: 'kpi_tree', label: 'KPI tree', type: 'mermaid',
    whenToUse: 'a KPI / driver tree decomposing a top metric into drivers',
    instructions:
      'Output a Mermaid `flowchart TD` only, with the north-star metric at the top decomposing into driver sub-metrics (and their inputs). Label edges with the relationship where useful. No prose, no code fences.',
    validate: okMermaid,
  },

  /* Plans & analysis (inline, no infra) */
  project_charter: {
    id: 'project_charter', label: 'Project charter', type: 'markdown',
    whenToUse: 'a project/initiative charter: goal, scope, stakeholders, milestones, risks',
    instructions:
      'Output Markdown only. Sections: `# Charter`, Objective, In/Out of scope, Success metrics, Key stakeholders, Milestones (dated), Budget/resources, Risks & assumptions, Governance.',
    validate: okText,
  },
  business_case: {
    id: 'business_case', label: 'Business case', type: 'markdown',
    whenToUse: 'a business case justifying an investment with costs, benefits and options',
    instructions:
      'Output Markdown only. Sections: `# Business case`, Problem/opportunity, Options considered, Recommended option, Costs (one-off + run), Benefits (quantified, with payback/ROI), Risks, Recommendation & ask. Ground figures in CONTEXT.',
    validate: okText,
  },
  swot: {
    id: 'swot', label: 'SWOT analysis', type: 'markdown',
    whenToUse: 'a SWOT (strengths, weaknesses, opportunities, threats) analysis',
    instructions:
      'Output Markdown only: a 2x2 with `## Strengths`, `## Weaknesses`, `## Opportunities`, `## Threats`, each a tight bulleted list grounded in CONTEXT, then a one-paragraph `## So what` of implications.',
    validate: okText,
  },
  board_pack: {
    id: 'board_pack', label: 'Board / steering pack', type: 'markdown',
    whenToUse: 'a board or steering-committee update pack',
    instructions:
      'Output Markdown only. Sections: Executive summary (3 bullets), Progress vs plan, KPIs (a small table), Risks & issues (RAG), Decisions requested, Next period focus. Skimmable; quantified.',
    validate: okText,
  },
  test_plan: {
    id: 'test_plan', label: 'Test plan', type: 'markdown',
    whenToUse: 'a test/validation plan for a change or rollout',
    instructions:
      'Output Markdown only. Sections: Scope, Approach, Environments, Entry/exit criteria, Test cases (a table: id, scenario, steps, expected, priority), Risks, Sign-off.',
    validate: okText,
  },
  raid_log: {
    id: 'raid_log', label: 'RAID log', type: 'table',
    whenToUse: 'a RAID log (risks, assumptions, issues, dependencies)',
    instructions:
      'Output ONLY a JSON array of row objects with keys: id, type ("Risk"|"Assumption"|"Issue"|"Dependency"), description, owner, impact ("High"|"Medium"|"Low"), status, mitigation. No prose, no code fences.',
    validate: okTable,
  },
  stakeholder_map: {
    id: 'stakeholder_map', label: 'Stakeholder map', type: 'table',
    whenToUse: 'a stakeholder analysis (interest vs influence, stance, engagement)',
    instructions:
      'Output ONLY a JSON array of row objects with keys: stakeholder, role, interest ("High"|"Medium"|"Low"), influence ("High"|"Medium"|"Low"), stance ("Champion"|"Supporter"|"Neutral"|"Sceptic"|"Blocker"), engagement_action, owner. No prose, no code fences.',
    validate: okTable,
  },
  okrs: {
    id: 'okrs', label: 'OKRs', type: 'table',
    whenToUse: 'objectives and key results for a team/initiative',
    instructions:
      'Output ONLY a JSON array of row objects with keys: objective, key_result, metric, baseline, target, owner, quarter. Group key results under the same objective string. No prose, no code fences.',
    validate: okTable,
  },
  comms_plan: {
    id: 'comms_plan', label: 'Communications plan', type: 'table',
    whenToUse: 'a stakeholder communications plan',
    instructions:
      'Output ONLY a JSON array of row objects with keys: audience, key_message, channel, frequency, owner, timing. No prose, no code fences.',
    validate: okTable,
  },
  data_dictionary: {
    id: 'data_dictionary', label: 'Data dictionary', type: 'table',
    whenToUse: 'a data dictionary describing fields/columns of a dataset or table',
    instructions:
      'Output ONLY a JSON array of row objects with keys: field, type, description, example, source, pii ("Yes"|"No"), notes. No prose, no code fences.',
    validate: okTable,
  },

  /* Deal / M&A diligence */
  red_flag_register: {
    id: 'red_flag_register', label: 'Red-flag register', type: 'table',
    whenToUse: 'a diligence red-flag register: findings, severity, evidence, recommendation',
    instructions:
      'Output ONLY a JSON array of row objects with keys: id, finding, area, severity ("High"|"Medium"|"Low"), evidence, recommendation, owner, status. No prose, no code fences.',
    validate: okTable,
  },
  dd_checklist: {
    id: 'dd_checklist', label: 'Diligence checklist', type: 'table',
    whenToUse: 'a due-diligence request list with received/missing status per workstream',
    instructions:
      'Output ONLY a JSON array of row objects with keys: workstream, item, priority ("High"|"Medium"|"Low"), requested ("Yes"|"No"), received ("Yes"|"No"|"Partial"), owner, notes. No prose, no code fences.',
    validate: okTable,
  },
  qofe_summary: {
    id: 'qofe_summary', label: 'Quality-of-earnings summary', type: 'markdown',
    whenToUse: 'a quality-of-earnings adjustments summary for a target',
    instructions:
      'Output Markdown only. Sections: `# Quality of earnings`, Reported vs adjusted EBITDA (a table of adjustments with rationale), One-offs/normalisations, Run-rate considerations, Working-capital notes, Key questions. Ground figures in CONTEXT; state assumptions.',
    validate: okText,
  },
  hundred_day_plan: {
    id: 'hundred_day_plan', label: 'Day-1 / 100-day plan', type: 'gantt',
    whenToUse: 'a post-deal Day-1 / 100-day integration or value-creation plan',
    instructions: [
      'Output ONLY a JSON object describing an interactive plan (same schema as a project plan).',
      'Phases for a 100-day plan: Day-1 readiness, Stabilise, Quick wins, Integration workstreams, Value-creation initiatives, Governance & tracking. Name sections after the work.',
      'Most tasks chain via "after"; one (or a few parallel) anchor task(s) carry an explicit "start" date; one milestone per phase (Day 1, Day 30, Day 60, Day 100). Durations realistic in working days. Ground scope in the CONTEXT.',
      'Valid JSON only: double-quoted keys/strings, no trailing commas, no comments.',
    ].join('\n'),
    validate: okGanttData,
    jsonSchema: GANTT_SCHEMA,
  },

  /* Operating model */
  target_operating_model: {
    id: 'target_operating_model', label: 'Target operating model', type: 'markdown',
    whenToUse: 'a target operating model (TOM) blueprint',
    instructions:
      'Output Markdown only. Sections: `# Target operating model`, Design principles, Value chain / capabilities, Process model (key end-to-end processes), Organisation & roles, Technology & data, Governance & KPIs, Transition summary. Ground in CONTEXT.',
    validate: okText,
  },
  capability_map: {
    id: 'capability_map', label: 'Capability map', type: 'mermaid',
    whenToUse: 'a value-chain / business-capability map',
    instructions:
      'Output a Mermaid `flowchart LR` only: top-level value-chain stages as subgraphs, the capabilities within each as nodes. No prose, no code fences.',
    validate: okMermaid,
  },
  automation_roadmap: {
    id: 'automation_roadmap', label: 'Automation roadmap', type: 'gantt',
    whenToUse: 'a roadmap sequencing automation/improvement initiatives by ROI and dependency',
    instructions: [
      'Output ONLY a JSON object describing an interactive plan (same schema as a project plan).',
      'Sequence initiatives by ROI and dependency across phases (e.g. Quick wins, Core automations, Platform/integration, Scale & optimise). Most tasks chain via "after"; anchor the first with an explicit "start"; a milestone per phase. Durations realistic in working days. Ground initiatives in the CONTEXT (named bottlenecks / recommendations).',
      'Valid JSON only: double-quoted keys/strings, no trailing commas, no comments.',
    ].join('\n'),
    validate: okGanttData,
    jsonSchema: GANTT_SCHEMA,
  },
  benefits_realisation: {
    id: 'benefits_realisation', label: 'Benefits realisation plan', type: 'table',
    whenToUse: 'a benefits-realisation plan: benefit, metric, baseline, target, owner, timing',
    instructions:
      'Output ONLY a JSON array of row objects with keys: benefit, metric, baseline, target, owner, timing, dependency, status. Numbers as numbers where applicable. No prose, no code fences.',
    validate: okTable,
  },

  /* Change & delivery */
  change_impact: {
    id: 'change_impact', label: 'Change impact assessment', type: 'table',
    whenToUse: 'a change-impact assessment across processes/systems/people',
    instructions:
      'Output ONLY a JSON array of row objects with keys: area, change, impact ("High"|"Medium"|"Low"), affected_groups, action, owner, timing. No prose, no code fences.',
    validate: okTable,
  },
  cutover_runbook: {
    id: 'cutover_runbook', label: 'Cutover runbook', type: 'markdown',
    whenToUse: 'a go-live / cutover runbook with rollback',
    instructions:
      'Output Markdown only. Sections: `# Cutover runbook`, Pre-cutover checklist, Cutover steps (a numbered table: seq, step, owner, start/finish, dependency), Validation checks, Rollback plan, Go/no-go criteria, Comms. Concrete and time-ordered.',
    validate: okText,
  },
  status_report: {
    id: 'status_report', label: 'Status report', type: 'markdown',
    whenToUse: 'a periodic project status / RAG update',
    instructions:
      'Output Markdown only. Sections: Overall RAG + one-line summary, Progress this period, Planned next period, Risks & issues (RAG), Decisions/asks. Skimmable; quantified against plan.',
    validate: okText,
  },
  decision_log: {
    id: 'decision_log', label: 'Decision log', type: 'table',
    whenToUse: 'a decision log: decision, rationale, owner, date, status',
    instructions:
      'Output ONLY a JSON array of row objects with keys: id, decision, rationale, alternatives_considered, owner, date, status. No prose, no code fences.',
    validate: okTable,
  },

  /* Diagrams (mermaid) */
  swimlane: {
    id: 'swimlane', label: 'Swimlane diagram', type: 'mermaid',
    whenToUse: 'a cross-functional process as swimlanes (who does what, in order)',
    instructions:
      'Output a Mermaid `flowchart LR` only, with one `subgraph` per lane (role/team) and the steps that role performs inside it; connect steps across lanes to show handoffs. No prose, no code fences.',
    validate: okMermaid,
  },
  sequence_diagram: {
    id: 'sequence_diagram', label: 'Sequence diagram', type: 'mermaid',
    whenToUse: 'an interaction/sequence between actors or systems over time',
    instructions:
      'Output a Mermaid `sequenceDiagram` only: declare participants, then ordered messages with `->>` / `-->>`, `alt`/`opt` blocks where useful. No prose, no code fences.',
    validate: okMermaid,
  },
  er_diagram: {
    id: 'er_diagram', label: 'Entity-relationship diagram', type: 'mermaid',
    whenToUse: 'a data model / entity-relationship diagram',
    instructions:
      'Output a Mermaid `erDiagram` only: entities with key attributes and typed relationships (`||--o{` etc.) and relationship labels. No prose, no code fences.',
    validate: okMermaid,
  },
  roadmap_timeline: {
    id: 'roadmap_timeline', label: 'Roadmap timeline', type: 'mermaid',
    whenToUse: 'a high-level themed roadmap (not a task-level Gantt)',
    instructions:
      'Output a Mermaid `timeline` only: a `title`, then time buckets (e.g. quarters) each followed by 2-4 themed items. For a dependency/duration-level plan use the gantt skill instead. No prose, no code fences.',
    validate: okMermaid,
  },
  quadrant_2x2: {
    id: 'quadrant_2x2', label: '2x2 quadrant', type: 'mermaid',
    whenToUse: 'a 2x2 prioritisation (e.g. effort vs impact, reach vs risk)',
    instructions:
      'Output a Mermaid `quadrantChart` only: a title, the two axis labels, the four quadrant labels, then plotted points with `[x, y]` in 0-1. No prose, no code fences.',
    validate: okMermaid,
  },

  /* Office files (built in the code-execution sandbox, stored as binaries) */
  ic_memo: {
    id: 'ic_memo', label: 'Investment-committee memo (DOCX)', type: 'docx',
    office: true, format: 'docx',
    whenToUse: 'an investment-committee / deal memo as a formatted Word document',
    instructions:
      'Build a polished Word IC memo with python-docx: title page header, Executive summary, Investment thesis, The opportunity/target, Diligence findings & red flags, Financials & returns (a table), Risks & mitigations, Recommendation & ask. Heading hierarchy, tables where they aid clarity, professional styling. Ground figures in CONTEXT.',
    validate: () => ({ ok: true }),
  },
  process_sop: {
    id: 'process_sop', label: 'SOP (DOCX)', type: 'docx',
    office: true, format: 'docx',
    whenToUse: 'a controlled standard-operating-procedure as a formatted Word document',
    instructions:
      'Build a controlled SOP with python-docx: title + document-control table (owner, version, date, review cadence), Purpose, Scope, Definitions, Procedure (numbered steps with responsible role), Controls, Exceptions, References. Formal, imperative voice, clean styling.',
    validate: () => ({ ok: true }),
  },
  synergy_model: {
    id: 'synergy_model', label: 'Synergy model (XLSX)', type: 'xlsx',
    office: true, format: 'xlsx',
    whenToUse: 'a deal synergy model workbook (cost + revenue synergies, phasing)',
    instructions:
      'Build an Excel synergy model with openpyxl: sheets for Cost synergies, Revenue synergies, Phasing (by quarter/year), and a Summary sheet that references them with real formulas (run-rate, cumulative, net of one-off costs). Bold frozen headers, number formatting. Ground all figures in CONTEXT; state assumptions on an Assumptions sheet.',
    validate: () => ({ ok: true }),
  },
  cost_baseline: {
    id: 'cost_baseline', label: 'Cost baseline (XLSX)', type: 'xlsx',
    office: true, format: 'xlsx',
    whenToUse: 'a per-function cost baseline workbook with rollups',
    instructions:
      'Build an Excel cost-baseline workbook with openpyxl: a detail sheet (function, cost line, driver, annual cost) and a Summary sheet rolling cost up by function with real SUMIF/formula totals. Bold frozen header, currency formatting, an Assumptions sheet. Ground all figures in CONTEXT.',
    validate: () => ({ ok: true }),
  },

  /* Office files (built in the code-execution sandbox, stored as binaries) */
  deck: {
    id: 'deck', label: 'Slide deck (PPTX)', type: 'pptx',
    office: true, format: 'pptx',
    whenToUse: 'a PowerPoint deck — exec readout, steering pack, diligence summary',
    instructions:
      'Build a clean PowerPoint with python-pptx: a title slide, an agenda, then one idea per slide (concise headline + supporting bullets/table), an executive-summary slide near the front, and a clear "recommendation / next steps" close. Consistent fonts and a restrained colour accent. Use tables for figures; embed a matplotlib chart image where a trend matters. No lorem text.',
    validate: () => ({ ok: true }),
  },
  document: {
    id: 'document', label: 'Word document (DOCX)', type: 'docx',
    office: true, format: 'docx',
    whenToUse: 'a formatted Word report, SOP, policy, or board memo',
    instructions:
      'Build a polished Word document with python-docx: a title, a heading hierarchy (Heading 1/2), numbered sections, a short executive summary up top, tables where they aid clarity, and consistent professional styling. Page-appropriate length for the spec; no placeholder text.',
    validate: () => ({ ok: true }),
  },
  workbook: {
    id: 'workbook', label: 'Excel workbook (XLSX)', type: 'xlsx',
    office: true, format: 'xlsx',
    whenToUse: 'an Excel workbook — model, register, or multi-sheet dataset',
    instructions:
      'Build a usable Excel workbook with openpyxl: clearly named sheets, a bold frozen header row, sensible column widths, number formatting, and real formulas for any totals/derived cells (not hard-coded). Include a "Summary" sheet that references the others. Ground all figures in CONTEXT.',
    validate: () => ({ ok: true }),
  },

  /* Generic fallback — anything not covered by a specific skill */
  custom: {
    id: 'custom', label: 'Document', type: 'markdown',
    whenToUse: 'a deliverable that does not match any specific skill above',
    instructions:
      'Produce the artefact described in the spec. Default to clean GitHub-flavoured Markdown unless the spec clearly implies another format. Output ONLY the artefact body — no preamble, no sign-off, no code fences (unless the artefact itself is code).',
    validate: okText,
  },
};

/** Special non-generated skill: the calling agent supplies content directly. */
export const RAW_SKILL = 'raw';

export function getSkill(id) {
  return ARTEFACT_SKILLS[id] || null;
}

export function skillIds() {
  return [...Object.keys(ARTEFACT_SKILLS), RAW_SKILL];
}

/** One-line catalogue for the emit_artefact tool description. */
export function skillCatalogue() {
  return Object.values(ARTEFACT_SKILLS)
    .map((s) => `${s.id} — ${s.whenToUse}`)
    .join('; ');
}

/** Validate arbitrary content for a known type (used by the raw path). */
export function validateForType(type, content) {
  switch (type) {
    case 'table':   return okTable(content);
    case 'json':    return okJson(content);
    case 'csv':     return okCsv(content);
    case 'mermaid': return okMermaid(content);
    case 'code':    return okCode(content);
    default:        return okText(content);
  }
}
