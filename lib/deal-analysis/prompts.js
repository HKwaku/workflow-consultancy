/**
 * Prompt builders for the cross-company deal analysis agent.
 *
 * One entry point: buildAnalysisPrompt({ mode, deal, companyData, documentExcerpts }).
 *
 * companyData shape (built in app/api/deals/[id]/analyse/route.js):
 *   [{ companyName, role, processName, stepCount, steps: [{ name, department, isDecision, isExternal }] }]
 *
 * documentExcerpts (optional) is the result of search_deal_chunks pre-fetched for the
 * analysis question. When provided, the model is required to cite chunk_ids it uses
 * inside finding.evidence[].
 */

import { FINDINGS_SHAPE_PROMPT_BLOCK } from './findingsShape';

function formatDocumentExcerpts(excerpts) {
  if (!Array.isArray(excerpts) || excerpts.length === 0) return '';
  const lines = excerpts.slice(0, 30).map((e, i) => {
    const loc = [
      e.filename,
      e.page_number ? `p.${e.page_number}` : null,
      e.slide_number ? `slide ${e.slide_number}` : null,
      e.sheet_name ? `sheet ${e.sheet_name}` : null,
      e.cell_range ? `range ${e.cell_range}` : null,
      e.section_path,
    ].filter(Boolean).join(', ');
    const snippet = String(e.content || '').replace(/\s+/g, ' ').slice(0, 600);
    return `[${i + 1}] chunk_id=${e.chunk_id} document_id=${e.document_id} (${loc})\n    ${snippet}`;
  }).join('\n');
  return `\n\nRelevant document excerpts (cite chunk_id in evidence[] when using):\n${lines}\n`;
}

function formatCompanySections(companyData) {
  return companyData.map((c) => {
    const stepList = c.steps.map((s, i) =>
      `  ${i + 1}. ${s.name}${s.department ? ` [${s.department}]` : ''}${s.isDecision ? ' [DECISION POINT]' : ''}${s.isExternal ? ' [EXTERNAL]' : ''}`
    ).join('\n');
    return `Company: ${c.companyName}\nRole: ${c.role}\nSteps (${c.steps.length}):\n${stepList}`;
  }).join('\n\n---\n\n');
}

function buildComparisonPrompt({ deal, companyData, documentExcerpts }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);

  const systemPrompt = `You are a process excellence consultant for a private equity firm. You compare process maps from portfolio companies to identify standardisation, consolidation, and efficiency opportunities. Your analysis must be data-driven, specific, and actionable. Output only valid JSON.

${FINDINGS_SHAPE_PROMPT_BLOCK}`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of companies: ${companyData.length}

Process maps:

${companySections}${formatDocumentExcerpts(documentExcerpts)}

Analyse these process maps across all ${companyData.length} companies. Identify:
1. Steps that appear across multiple or all companies (standardisation candidates)
2. Steps unique to individual companies (review for necessity)
3. Specific recommendations for consolidating into a single standard process
4. A proposed standard process the PE portfolio should adopt

Return ONLY this JSON with no markdown fences, no commentary before or after:
{
  "summary": "2-3 sentence executive summary of the key findings and opportunity",
  "commonSteps": [
    {
      "name": "descriptive step name",
      "presentAt": ["Company A", "Company B"],
      "presentAtAll": true,
      "departments": ["Finance"],
      "varianceNote": "how this step differs between companies, or empty string if identical"
    }
  ],
  "uniqueSteps": [
    {
      "name": "step name",
      "companyName": "Company A",
      "recommendation": "keep",
      "reason": "brief reason this step is unique and what to do with it"
    }
  ],
  "mergeRecommendations": [
    {
      "finding": "clear description of the standardisation opportunity",
      "affectedSteps": ["step name 1", "step name 2"],
      "action": "specific, concrete action to take",
      "estimatedSavingPct": 15
    }
  ],
  "proposedProcess": [
    {
      "stepNumber": 1,
      "name": "step name",
      "source": "common",
      "department": "Finance",
      "notes": "standardisation or implementation note"
    }
  ]
}

recommendation values must be one of: keep, review, remove
source values must be the company name or "common" or "merged"`;

  return { systemPrompt, userPrompt };
}

function buildSynergyPrompt({ deal, companyData, documentExcerpts }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);
  const totalSteps = companyData.reduce((sum, c) => sum + c.steps.length, 0);

  const systemPrompt = `You are an integration partner at a PE firm. Your job is to quantify the synergy opportunity when these portfolio companies' processes are consolidated. Bias toward conservative, defensible numbers with clear reasoning. Output only valid JSON.

${FINDINGS_SHAPE_PROMPT_BLOCK}`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of companies: ${companyData.length}
Total process steps across companies: ${totalSteps}

Process maps:

${companySections}${formatDocumentExcerpts(documentExcerpts)}

Quantify the integration synergy opportunity. For each opportunity, give a realistic savings percentage range and an effort label. Focus on:
1. Duplicate steps that can be consolidated into a single shared service
2. Redundant approval / handoff layers that disappear post-integration
3. Systems/tooling consolidation implied by these processes
4. Headcount or FTE overlap implied by identical step patterns

Do NOT fabricate dollar figures without evidence. If you cite savings, express as a percentage of the process-related cost base unless a unit count is directly derivable from the step list.

Return ONLY this JSON with no markdown fences, no commentary before or after:
{
  "summary": "2-3 sentence executive summary of the total synergy opportunity and where it concentrates",
  "overallSavingPct": {
    "low": 8,
    "base": 15,
    "high": 22
  },
  "opportunities": [
    {
      "title": "short opportunity name",
      "rationale": "1-2 sentence evidence-based explanation grounded in the step lists",
      "affectedCompanies": ["Company A", "Company B"],
      "affectedSteps": ["step name 1", "step name 2"],
      "savingPct": { "low": 5, "base": 10, "high": 15 },
      "effort": "low",
      "timeHorizon": "0-6m",
      "risks": ["short risk factor if any"]
    }
  ],
  "fteOverlap": [
    {
      "function": "e.g. Accounts Payable clerks, Field engineers",
      "duplicatedAcross": ["Company A", "Company B"],
      "reasoning": "brief - what in the step lists suggests this overlap",
      "estimatedReducibleFte": 2
    }
  ],
  "systemsConsolidation": [
    {
      "topic": "e.g. CRM, invoicing tool",
      "recommendation": "consolidate to a single system across the platform",
      "reasoning": "brief"
    }
  ],
  "integrationRisks": [
    {
      "risk": "short description",
      "severity": "medium",
      "mitigation": "brief"
    }
  ]
}

effort values must be one of: low, medium, high
timeHorizon values must be one of: 0-6m, 6-12m, 12-24m
severity values must be one of: low, medium, high
estimatedReducibleFte is an integer >= 0. Leave the array empty if there is insufficient evidence.
All savingPct numbers are integers 0-60. If insufficient evidence, omit the opportunity rather than guessing.`;

  return { systemPrompt, userPrompt };
}

function buildRedesignPrompt({ deal, companyData, documentExcerpts }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);
  const avgSteps = Math.round(
    companyData.reduce((sum, c) => sum + c.steps.length, 0) / Math.max(1, companyData.length)
  );

  const systemPrompt = `You are a post-merger integration lead writing the design document the integration team will execute against. You must:
- Be decisive: pick a single unified process, never offer alternatives in-line.
- Show your work: every step needs evidence-backed rationale plus a quantified impact estimate.
- Connect the design to outcomes: name the benefits, the trade-offs you accepted, the assumptions you made, and the KPIs that will tell you it worked.
- Favour the strongest pattern in the inputs rather than averaging. Cite the source company by name when an idea came from them.

The reader is an executive sponsor and the operations leads who will roll this out. Avoid generic consultant-speak; use specifics from the source maps.

Output only valid JSON.

${FINDINGS_SHAPE_PROMPT_BLOCK}`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of source companies: ${companyData.length}
Average steps per source company: ${avgSteps}

Source process maps:

${companySections}${formatDocumentExcerpts(documentExcerpts)}

Design the single unified target process for the combined entity. For each step of the proposed process, you must:
- Assign a changeType: 'kept' (lifted from one company intact), 'merged' (combines steps from multiple companies), 'new' (added to address a gap), or 'moved' (retained but re-sequenced).
- Record which source step(s) it came from with their original names and owning companies.
- State a substantive rationale (3-5 sentences): why this version won, what was wrong with the alternatives, what evidence from the source maps supports the call.
- State expectedImpact: 1-2 sentences quantifying the change vs. today (time saved per cycle, FTE freed, error rate reduction, automation candidate, etc.). Use ranges or order-of-magnitude when exact numbers aren't supportable, but always include a number.
- State the owner (which department/role is accountable for the step).

Separately, list steps from the source processes that are REMOVED, with the reason.

Also produce:
- A 3-5 item keyBenefits list at the deal level — each benefit with a one-line description AND a one-line measurement (how you'll know it landed).
- A tradeoffs list — choices that consciously give up something. Each entry: what was decided, what was accepted as a cost, and the alternative that was rejected.
- An assumptions list — non-trivial things this design assumes about the combined entity (system availability, headcount, customer behaviour, data continuity, etc.).
- A 2-4 item kpis list — measurable indicators with baseline (best estimate from source data), target after rollout, and review frequency.
- A 2-4 phase phasing plan. Each phase needs deliverables (what gets shipped), prerequisites (what must be true to start), and successMeasures (what proves the phase is done).
- adoptionNotes — change-management considerations, training gaps, comms milestones.
- risks — for each: severity, probability, leadingIndicators (early-warning signals), and a concrete mitigation + a contingency if mitigation fails.

Return ONLY this JSON with no markdown fences, no commentary before or after:
{
  "summary": "4-6 sentence exec summary covering: what the new process is, the biggest changes from today, the measurable wins, and the headline risk",
  "processName": "name of the unified process",
  "changeOverview": {
    "kept": 4,
    "merged": 3,
    "new": 1,
    "removed": 2,
    "totalSteps": 8
  },
  "keyBenefits": [
    {
      "benefit": "short headline (max 60 chars)",
      "description": "1-2 sentences on why this matters",
      "measurement": "specific metric and how to read it"
    }
  ],
  "tradeoffs": [
    {
      "decision": "what we chose",
      "accepted": "what we gave up",
      "alternative": "the design we rejected and why"
    }
  ],
  "assumptions": [
    "one non-trivial assumption per entry, written as a falsifiable statement"
  ],
  "kpis": [
    {
      "kpi": "what we measure",
      "baseline": "today's value or best estimate from inputs",
      "target": "post-rollout target",
      "frequency": "weekly | monthly | quarterly"
    }
  ],
  "redesignedProcess": [
    {
      "stepNumber": 1,
      "name": "step name",
      "department": "Finance",
      "owner": "Role or team accountable for the step",
      "isDecision": false,
      "changeType": "merged",
      "sourceSteps": [
        { "companyName": "Company A", "originalName": "Approve invoice" },
        { "companyName": "Company B", "originalName": "Review & approve AP" }
      ],
      "rationale": "3-5 sentence evidence-based reason citing source companies and what alternatives were considered",
      "expectedImpact": "1-2 sentences with a quantified estimate (time saved, FTE freed, error reduction, automation candidate, etc.)",
      "notes": "optional implementation guidance, system requirements, hand-off changes"
    }
  ],
  "removedSteps": [
    {
      "name": "step name",
      "companyName": "Company A",
      "reason": "2-3 sentence justification for dropping this step including what replaces it (or why nothing needs to)"
    }
  ],
  "phasing": [
    {
      "phase": 1,
      "label": "Foundations",
      "timeframe": "0-3m",
      "goals": ["goal 1", "goal 2"],
      "deliverables": ["what ships in this phase"],
      "prerequisites": ["what must already be true to start"],
      "successMeasures": ["what tells you the phase is done"]
    }
  ],
  "adoptionNotes": [
    "structured change-management consideration: who needs what training, when, in what format"
  ],
  "risks": [
    {
      "risk": "short description",
      "severity": "medium",
      "probability": "medium",
      "leadingIndicators": ["early warning signal 1", "signal 2"],
      "mitigation": "concrete preventive action with an owner",
      "contingency": "what to do if the mitigation fails"
    }
  ]
}

changeType values must be one of: kept, merged, new, moved
severity values must be one of: low, medium, high
probability values must be one of: low, medium, high
timeframe values must be one of: 0-3m, 3-6m, 6-12m
frequency values must be one of: weekly, monthly, quarterly
stepNumber values are 1-indexed integers in order.
sourceSteps may be empty only when changeType is "new".
redesignedProcess should have 4-20 steps; err on the concise side.

DEPTH BAR: every rationale, expectedImpact, mitigation, contingency, and tradeoff field must contain content the reader couldn't have predicted from the source maps alone. Generic boilerplate is a failure of this analysis.`;

  return { systemPrompt, userPrompt };
}

/**
 * Document-primary diligence analysis. Where the other modes treat process
 * maps as the primary signal and documents as supporting evidence, this mode
 * inverts that: the data room is the source, process maps (if any) supplement
 * it. Output mirrors the article's slide template:
 * Exec Summary / Tech Landscape / Ops Footprint / Org / Red Flags /
 * Day-1 / TSA / Separation.
 */
function buildDiligencePrompt({ deal, companyData, documentExcerpts }) {
  const companySections = companyData?.length
    ? `\n\nProcess maps available as supplementary context:\n${formatCompanySections(companyData)}`
    : '\n\n(No process maps submitted yet — analysis is data-room-only.)';

  const systemPrompt = `You are a transaction services partner producing a diligence memo for ${deal.name || 'this deal'}. Your readers are deal team members (M&A, PE) who will use this as input to investment-committee discussion. Be specific, evidence-grounded, and decisive. Output only valid JSON.

${FINDINGS_SHAPE_PROMPT_BLOCK}`;

  const userPrompt = `Deal: ${deal.name}${deal.process_name ? `\nProcess focus: ${deal.process_name}` : ''}${companySections}${formatDocumentExcerpts(documentExcerpts)}

Produce a diligence memo organised as a slide deck. Sections (each MUST follow the canonical finding shape):

- "executiveSummary": single object with title, body, severity, confidence, impact[], evidence[], recommendations[]. Body is the 2-3 sentence partner-facing summary.
- "technologyLandscape": findings[] covering core systems, integrations, technology debt, system of record, key dependencies inside the transaction boundary.
- "operationalFootprint": findings[] covering sites, key processes, customer concentration, supplier concentration, capacity constraints.
- "organisation": findings[] covering org-chart shape, key-person dependency, headcount distribution, leadership gaps.
- "redFlags": findings[] - the things that would change the bid or kill the deal. Severity should skew high/critical here.
- "keyFindings": findings[] - top 3-5 takeaways across all sections, ranked by importance. Each impact[] axis must reflect when the finding bites.

Each findings[] array should hold 2-6 items. Empty an array entirely if the data room provides no support for a section - do NOT pad.

Citation requirements (HARD):
- Every claim above the "obvious from filename" threshold needs at least one evidence entry.
- For document_chunk evidence, ref MUST include chunk_id and document_id taken verbatim from the excerpts above.
- If a finding has no document_chunk evidence and no process_step evidence, drop the finding rather than fabricate.

Return ONLY this JSON, no markdown fences, no commentary:
{
  "summary": "2-3 sentence overall memo summary",
  "executiveSummary": { ...one finding... },
  "technologyLandscape": [ ...findings... ],
  "operationalFootprint": [ ...findings... ],
  "organisation": [ ...findings... ],
  "redFlags": [ ...findings... ],
  "keyFindings": [ ...findings... ]
}`;

  return { systemPrompt, userPrompt };
}

export function buildAnalysisPrompt({ mode, deal, companyData, documentExcerpts }) {
  if (mode === 'synergy')   return buildSynergyPrompt({ deal, companyData, documentExcerpts });
  if (mode === 'redesign')  return buildRedesignPrompt({ deal, companyData, documentExcerpts });
  if (mode === 'diligence') return buildDiligencePrompt({ deal, companyData, documentExcerpts });
  return buildComparisonPrompt({ deal, companyData, documentExcerpts });
}
