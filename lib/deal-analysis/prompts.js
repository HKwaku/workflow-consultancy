/**
 * Prompt builders for the cross-company deal analysis agent.
 *
 * One entry point: buildAnalysisPrompt({ mode, deal, companyData }).
 *
 * companyData shape (built in app/api/deals/[id]/analyse/route.js):
 *   [{ companyName, role, processName, stepCount, steps: [{ name, department, isDecision, isExternal }] }]
 */

function formatCompanySections(companyData) {
  return companyData.map((c) => {
    const stepList = c.steps.map((s, i) =>
      `  ${i + 1}. ${s.name}${s.department ? ` [${s.department}]` : ''}${s.isDecision ? ' [DECISION POINT]' : ''}${s.isExternal ? ' [EXTERNAL]' : ''}`
    ).join('\n');
    return `Company: ${c.companyName}\nRole: ${c.role}\nSteps (${c.steps.length}):\n${stepList}`;
  }).join('\n\n---\n\n');
}

function buildComparisonPrompt({ deal, companyData }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);

  const systemPrompt = `You are a process excellence consultant for a private equity firm. You compare process maps from portfolio companies to identify standardisation, consolidation, and efficiency opportunities. Your analysis must be data-driven, specific, and actionable. Output only valid JSON.`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of companies: ${companyData.length}

Process maps:

${companySections}

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

function buildSynergyPrompt({ deal, companyData }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);
  const totalSteps = companyData.reduce((sum, c) => sum + c.steps.length, 0);

  const systemPrompt = `You are an integration partner at a PE firm. Your job is to quantify the synergy opportunity when these portfolio companies' processes are consolidated. Bias toward conservative, defensible numbers with clear reasoning. Output only valid JSON.`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of companies: ${companyData.length}
Total process steps across companies: ${totalSteps}

Process maps:

${companySections}

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

function buildRedesignPrompt({ deal, companyData }) {
  const processName = deal.process_name || companyData[0]?.processName || 'the process';
  const companySections = formatCompanySections(companyData);
  const avgSteps = Math.round(
    companyData.reduce((sum, c) => sum + c.steps.length, 0) / Math.max(1, companyData.length)
  );

  const systemPrompt = `You are a post-merger integration lead. Your task is to design the single unified process that all companies will adopt. You must be decisive, assign clear lineage to every step, and explain the rationale for each change. Favour the strongest pattern in the inputs rather than averaging. Output only valid JSON.`;

  const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of source companies: ${companyData.length}
Average steps per source company: ${avgSteps}

Source process maps:

${companySections}

Design the single unified target process for the combined entity. For each step of the proposed process, you must:
- Assign a changeType: 'kept' (lifted from one company intact), 'merged' (combines steps from multiple companies), 'new' (added to address a gap), or 'moved' (retained but re-sequenced).
- Record which source step(s) it came from with their original names and owning companies.
- State the rationale - why this version won.

Separately, list steps from the source processes that are REMOVED, with the reason.

Also produce:
- A short phasing plan (1-3 phases) for rolling the unified process out across the platform.
- Adoption notes - change-management or training considerations.

Return ONLY this JSON with no markdown fences, no commentary before or after:
{
  "summary": "2-3 sentence exec summary of the unified design and what changes from today",
  "processName": "name of the unified process",
  "changeOverview": {
    "kept": 4,
    "merged": 3,
    "new": 1,
    "removed": 2,
    "totalSteps": 8
  },
  "redesignedProcess": [
    {
      "stepNumber": 1,
      "name": "step name",
      "department": "Finance",
      "isDecision": false,
      "changeType": "merged",
      "sourceSteps": [
        { "companyName": "Company A", "originalName": "Approve invoice" },
        { "companyName": "Company B", "originalName": "Review & approve AP" }
      ],
      "rationale": "1-2 sentence evidence-based reason for this choice",
      "notes": "optional implementation guidance"
    }
  ],
  "removedSteps": [
    {
      "name": "step name",
      "companyName": "Company A",
      "reason": "short reason this step drops"
    }
  ],
  "phasing": [
    {
      "phase": 1,
      "label": "Foundations",
      "timeframe": "0-3m",
      "goals": ["goal 1", "goal 2"]
    }
  ],
  "adoptionNotes": [
    "short change-management or training consideration"
  ],
  "risks": [
    {
      "risk": "short description",
      "severity": "medium",
      "mitigation": "brief"
    }
  ]
}

changeType values must be one of: kept, merged, new, moved
severity values must be one of: low, medium, high
timeframe values must be one of: 0-3m, 3-6m, 6-12m
stepNumber values are 1-indexed integers in order.
sourceSteps may be empty only when changeType is "new".
redesignedProcess should have 4-20 steps; err on the concise side.`;

  return { systemPrompt, userPrompt };
}

export function buildAnalysisPrompt({ mode, deal, companyData }) {
  if (mode === 'synergy')  return buildSynergyPrompt({ deal, companyData });
  if (mode === 'redesign') return buildRedesignPrompt({ deal, companyData });
  return buildComparisonPrompt({ deal, companyData });
}
