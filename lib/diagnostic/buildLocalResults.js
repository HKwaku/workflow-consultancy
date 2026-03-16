import { classifyAutomation } from '@/lib/flows';

/**
 * Calculate automation readiness score from processes (always computed).
 */
export function calculateAutomationScore(processes) {
  if (!processes || processes.length === 0) {
    return { percentage: 0, grade: 'N/A', insight: 'No process data.' };
  }
  let totalSteps = 0;
  const counts = { simple: 0, agent: 0, 'human-loop': 0, 'multi-agent': 0 };
  processes.forEach((p) => {
    const steps = p.steps || [];
    totalSteps += steps.length;
    steps.forEach((s, i) => {
      const auto = classifyAutomation(s, i, p);
      if (auto) counts[auto.key]++;
    });
  });
  const totalAutomatable = counts.simple + counts.agent + counts['human-loop'] + counts['multi-agent'];
  const percentage = totalSteps > 0 ? Math.round((totalAutomatable / totalSteps) * 100) : 0;
  let grade = 'N/A';
  if (percentage >= 70) grade = 'High';
  else if (percentage >= 40) grade = 'Moderate';
  else if (percentage > 0) grade = 'Low';
  const insight = totalSteps > 0
    ? `${totalAutomatable} of ${totalSteps} steps classified as automatable.`
    : 'Add steps to see automation readiness.';
  return { percentage, grade, insight };
}

export function calculateProcessQuality(p) {
  let score = 50;
  const flags = [];
  const steps = p.steps || [];
  const handoffs = p.handoffs || [];

  if (steps.length >= 8) score += 15;
  else if (steps.length >= 5) score += 10;
  else if (steps.length >= 3) score += 5;
  else { flags.push('Limited step detail'); }

  const depts = new Set(steps.map((s) => s.department).filter(Boolean));
  if (depts.size > 0) score += 10;

  if (handoffs.length > 0) score += 5;
  const systemSteps = steps.filter((s) => s.systems?.length > 0).length;
  if (systemSteps > 0) score += 5;

  if (p.costs?.totalAnnualCost > 0) score += 5;
  if (p.costs?.cycleDays > 0) score += 5;
  if (p.bottleneck?.reason) score += 5;
  if (p.lastExample?.name) score += 5;

  score = Math.max(0, Math.min(100, score));
  return { score, grade: score > 85 ? 'HIGH' : score > 65 ? 'MEDIUM' : 'LOW', flags };
}

export function generateRuleBasedRecommendations(processes) {
  const recs = [];

  // Track cross-process patterns
  const handoffProblems = [];
  const multiSystemSteps = [];

  processes.forEach((p) => {
    const poorHandoffs = (p.handoffs || []).filter(
      (h) => h.clarity === 'yes-multiple' || h.clarity === 'yes-major' || h.method === 'they-knew'
    );
    if (poorHandoffs.length > 0) {
      handoffProblems.push({ process: p.processName, count: poorHandoffs.length });
    }

    const stepsWithManySystems = (p.steps || []).filter((s) => (s.systems || []).length > 1);
    if (stepsWithManySystems.length >= 2) {
      multiSystemSteps.push({ process: p.processName, count: stepsWithManySystems.length });
    }

    if (p.knowledge?.vacationImpact === 'stops' || p.knowledge?.vacationImpact === 'slows-down') {
      const severity = p.knowledge.vacationImpact === 'stops' ? 'high' : 'medium';
      recs.push({
        type: 'knowledge',
        severity,
        process: p.processName,
        finding: `"${p.processName}" depends on one or two people  -  the process slows or stops when they are unavailable.`,
        action: 'Document the end-to-end process in a shared runbook (Notion, Confluence, or even a Google Doc) so any team member can cover. Identify the two or three steps only one person knows and cross-train a backup.',
        estimatedTimeSavedMinutes: 0,
        effortLevel: 'medium',
        text: `"${p.processName}" has a knowledge concentration risk  -  document it and cross-train a backup to remove the single point of failure.`,
      });
    }

    if (p.userTime?.waiting > p.userTime?.execution) {
      const waitMins = Math.round((p.userTime.waiting || 0) * 60);
      recs.push({
        type: 'automation',
        severity: 'high',
        process: p.processName,
        finding: `In "${p.processName}", waiting time (${p.userTime.waiting}h) exceeds active execution time (${p.userTime.execution}h)  -  most time is spent waiting for approvals or responses.`,
        action: 'Identify the approval or hand-off step causing the longest wait. Set a clear SLA (e.g. 24h response), add an automated reminder if the deadline is missed, and consider whether the approver can be replaced with a rules-based check.',
        estimatedTimeSavedMinutes: Math.round(waitMins * 0.4),
        effortLevel: 'quick-win',
        text: `In "${p.processName}", waiting time exceeds execution time  -  set approval SLAs and add automated reminders to cut idle time by ~40%.`,
      });
    }

    const decisionSteps = (p.steps || []).filter((s) => s.isDecision);
    const lateDecisions = decisionSteps.filter((s, i, arr) => {
      const stepIndex = (p.steps || []).indexOf(s);
      return stepIndex > (p.steps || []).length * 0.6;
    });
    if (lateDecisions.length > 0) {
      recs.push({
        type: 'approval',
        severity: 'medium',
        process: p.processName,
        finding: `"${p.processName}" has ${lateDecisions.length} decision/rejection point(s) positioned late in the flow  -  work is done before cases are screened.`,
        action: `Move the earliest rejection check (e.g. "${lateDecisions[0]?.name || 'eligibility check'}") to the first or second step so ineligible cases are caught before expensive downstream work begins.`,
        estimatedTimeSavedMinutes: lateDecisions.length * 30,
        effortLevel: 'quick-win',
        text: `Move rejection checks earlier in "${p.processName}" to stop wasted work on cases that will be declined  -  saves ~${lateDecisions.length * 30} min per rejected instance.`,
      });
    }
  });

  // Cross-process: handoff clarity
  if (handoffProblems.length >= 2) {
    const total = handoffProblems.reduce((s, p) => s + p.count, 0);
    recs.push({
      type: 'handoff',
      severity: 'high',
      process: 'Cross-process',
      finding: `${total} unclear handoffs across ${handoffProblems.length} processes (${handoffProblems.map(p => p.process).join(', ')})  -  information is lost or duplicated at each step boundary.`,
      action: 'Introduce a standard handoff checklist (what information must be passed, who receives it, and what the recipient must do). Use a shared task tool (Asana, Monday, or Jira) instead of email so each hand-off is tracked and visible.',
      estimatedTimeSavedMinutes: total * 20,
      effortLevel: 'medium',
      text: `${total} handoffs across ${handoffProblems.length} processes lack clear information transfer  -  standardise with a shared task tool to save ~${total * 20} min total per run.`,
    });
  } else if (handoffProblems.length === 1) {
    const p = handoffProblems[0];
    recs.push({
      type: 'handoff',
      severity: 'medium',
      process: p.process,
      finding: `${p.count} handoff(s) in "${p.process}" lack clear information transfer  -  the receiving team may not know what action is needed or by when.`,
      action: 'Define a standard handoff format for this process: what information is passed, to whom, by what method, and with what deadline. Replace open-ended email with a tracked task or form submission.',
      estimatedTimeSavedMinutes: p.count * 20,
      effortLevel: 'quick-win',
      text: `${p.count} handoff(s) in "${p.process}" show poor information transfer  -  standardise them with a tracked handoff template to save ~${p.count * 20} min per run.`,
    });
  }

  // Cross-process: multi-system manual work
  if (multiSystemSteps.length >= 2) {
    const total = multiSystemSteps.reduce((s, p) => s + p.count, 0);
    recs.push({
      type: 'integration',
      severity: 'medium',
      process: 'Cross-process',
      finding: `${total} steps across ${multiSystemSteps.length} processes require manual data entry into multiple systems  -  a sign of missing integrations.`,
      action: 'Audit which system pairs require the most re-entry. Start with the highest-frequency pair and connect them via a native integration or a no-code tool (Zapier, Make) to eliminate the manual copy step.',
      estimatedTimeSavedMinutes: total * 15,
      effortLevel: 'medium',
      text: `${total} steps across ${multiSystemSteps.length} processes involve manual data entry across multiple systems  -  connecting them via integration could save ~${total * 15} min per run.`,
    });
  } else if (multiSystemSteps.length === 1) {
    const p = multiSystemSteps[0];
    recs.push({
      type: 'integration',
      severity: 'low',
      process: p.process,
      finding: `${p.count} steps in "${p.process}" require data entry into multiple systems  -  manual re-entry is a common source of errors and wasted time.`,
      action: 'Identify the two systems most frequently used together in this process and check if they have a native integration or an API. A no-code connector (Zapier, Make) can often automate the data transfer with no development work.',
      estimatedTimeSavedMinutes: p.count * 15,
      effortLevel: 'medium',
      text: `${p.count} steps in "${p.process}" involve multiple systems  -  connect them via integration to eliminate manual re-entry and save ~${p.count * 15} min per run.`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      type: 'general',
      severity: 'low',
      process: 'Overall',
      finding: 'No critical issues detected in the current process data.',
      action: 'Add more detail to your process steps  -  include systems used, step durations, and handoff methods  -  to unlock deeper analysis and more specific recommendations.',
      estimatedTimeSavedMinutes: 0,
      effortLevel: 'quick-win',
      text: 'Enrich your process steps with systems, durations, and handoff details to enable more targeted recommendations.',
    });
  }

  // Sort: high severity first, then by estimated time saved
  const severityOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => {
    const sd = (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1);
    if (sd !== 0) return sd;
    return (b.estimatedTimeSavedMinutes || 0) - (a.estimatedTimeSavedMinutes || 0);
  });

  return recs;
}

/**
 * Build diagnostic results client-side (fallback when API fails).
 * @param {{ processes: object[], contact?: object }} params
 * @returns Same shape as /api/process-diagnostic response
 */
export function buildLocalResults({ processes, contact }) {
  if (!processes || processes.length === 0) {
    return { success: false, error: 'No processes provided' };
  }

  const processResults = processes.map((p) => {
    const quality = calculateProcessQuality(p);
    return {
      name: p.processName,
      type: p.processType,
      elapsedDays: p.costs?.cycleDays || p.lastExample?.elapsedDays || 0,
      annualCost: p.costs?.totalAnnualCost || 0,
      annualInstances: p.frequency?.annual || 0,
      teamSize: p.costs?.teamSize || 1,
      stepsCount: (p.steps || []).length,
      quality,
      bottleneck: p.bottleneck || {},
      priority: p.priority || {},
    };
  });

  const totalCost = processResults.reduce((sum, p) => sum + p.annualCost, 0);
  const totalSavings = processes.reduce((sum, p) => {
    const cost = p.costs?.totalAnnualCost || 0;
    const pct = p.savings?.percent || 30;
    return sum + cost * (pct / 100);
  }, 0);
  const recommendations = generateRuleBasedRecommendations(processes);
  const avgQuality =
    processResults.length > 0
      ? processResults.reduce((s, p) => s + (p.quality?.score ?? 70), 0) / processResults.length
      : 70;

  const automationScore = calculateAutomationScore(processes);

  return {
    success: true,
    processes: processResults,
    totalCost,
    potentialSavings: totalSavings,
    recommendations,
    automationScore,
    flowDiagramUrl: null,
    qualityScore: { averageScore: Math.round(avgQuality) },
    analysisType: 'rule-based',
    timestamp: new Date().toISOString(),
  };
}
