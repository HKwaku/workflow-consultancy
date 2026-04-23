/**
 * Intake phase state — drives the chat agent's question ordering.
 *
 * The diagnostic is split into ordered phases. Each phase has a "done"
 * threshold (minimum share of applicable slots filled). The current phase is
 * the first one that has not yet met its threshold. When all phases pass,
 * the diagnostic is overall complete.
 *
 * The phaseState is recomputed on every chat turn and passed into the system
 * prompt. The agent focuses its questions on the current phase's gaps but
 * remains free to execute any action the user requests.
 */

export const INTAKE_PHASES = [
  {
    id: 'structure',
    label: 'Process structure',
    ask: 'step names and sequence',
    threshold: 1, // at least 2 named steps
    applies: () => true,
    countApplicable: (steps) => Math.max(steps.length, 2),
    countFilled: (steps) => steps.filter((s) => (s.name || '').trim()).length,
  },
  {
    id: 'owners',
    label: 'Owners & departments',
    ask: 'who is responsible for each step',
    threshold: 0.8,
    applies: (steps) => steps.length >= 2,
    countApplicable: (steps) => steps.filter((s) => (s.name || '').trim()).length,
    countFilled: (steps) =>
      steps.filter((s) => (s.name || '').trim() && (s.department || s.owner)).length,
  },
  {
    id: 'timings',
    label: 'Timings',
    ask: 'how long each step takes (work vs wait)',
    threshold: 0.7,
    applies: (steps) => steps.length >= 2,
    countApplicable: (steps) => steps.filter((s) => (s.name || '').trim()).length,
    countFilled: (steps) =>
      steps.filter((s) => {
        if (!(s.name || '').trim()) return false;
        const hasWork = s.workMinutes != null && s.workMinutes !== '';
        const hasWait = s.waitMinutes != null && s.waitMinutes !== '';
        return hasWork || hasWait;
      }).length,
  },
  {
    id: 'systems',
    label: 'Systems & tools',
    ask: 'which systems or tools are used at each step',
    threshold: 0.6,
    applies: (steps) => steps.length >= 2,
    countApplicable: (steps) => steps.filter((s) => (s.name || '').trim()).length,
    countFilled: (steps) =>
      steps.filter((s) => (s.name || '').trim() && (s.systems || []).length > 0).length,
  },
  {
    id: 'handoffs',
    label: 'Handoffs',
    ask: 'how each step hands off to the next',
    threshold: 0.7,
    applies: (steps) => steps.length >= 2,
    countApplicable: (steps) => Math.max(steps.length - 1, 0),
    countFilled: (steps, handoffs) => {
      const n = Math.max(steps.length - 1, 0);
      let filled = 0;
      for (let i = 0; i < n; i++) {
        const h = (handoffs || [])[i] || {};
        if (h.method) filled++;
      }
      return filled;
    },
  },
];

export function computePhaseState({ steps = [], handoffs = [], skippedPhases = [] } = {}) {
  const namedSteps = steps.filter((s) => (s.name || '').trim());
  const phases = INTAKE_PHASES.map((p) => {
    const applicable = p.applies(namedSteps) ? p.countApplicable(namedSteps, handoffs) : 0;
    const filled = applicable > 0 ? p.countFilled(namedSteps, handoffs) : 0;
    const ratio = applicable > 0 ? filled / applicable : 1;
    const threshold = p.threshold <= 1 ? p.threshold : p.threshold / Math.max(applicable, 1);
    const met =
      applicable === 0 ||
      (p.id === 'structure' ? filled >= 2 : ratio >= p.threshold) ||
      skippedPhases.includes(p.id);
    return {
      id: p.id,
      label: p.label,
      ask: p.ask,
      applicable,
      filled,
      ratio,
      met,
      skipped: skippedPhases.includes(p.id),
    };
  });

  const current = phases.find((p) => !p.met) || null;
  const overallComplete = phases.every((p) => p.met);

  const gaps = current
    ? namedSteps
        .map((s, i) => {
          const missing = gapFieldsForPhase(current.id, s, handoffs?.[i], i, namedSteps.length);
          if (!missing.length) return null;
          return { stepIndex: i, stepName: s.name, missing };
        })
        .filter(Boolean)
    : [];

  return { phases, current, overallComplete, gaps };
}

function gapFieldsForPhase(phaseId, step, handoff, stepIndex, totalSteps) {
  const missing = [];
  switch (phaseId) {
    case 'owners':
      if (!step.department && !step.owner) missing.push('department/owner');
      break;
    case 'timings':
      if (step.workMinutes == null || step.workMinutes === '') missing.push('work time');
      if (step.waitMinutes == null || step.waitMinutes === '') missing.push('wait time');
      break;
    case 'systems':
      if (!(step.systems || []).length) missing.push('systems');
      break;
    case 'handoffs':
      if (stepIndex < totalSteps - 1 && !handoff?.method) missing.push('handoff');
      break;
    default:
      break;
  }
  return missing;
}

/** Render phaseState as a compact block for the system prompt. */
export function formatPhaseStateBlock(phaseState) {
  if (!phaseState) return '';
  const { phases, current, overallComplete, gaps } = phaseState;
  const lines = [];
  lines.push('INTAKE PHASE STATE:');
  phases.forEach((p) => {
    const marker = p.met ? '✓' : p === current ? '▶' : '·';
    const counter = p.applicable > 0 ? ` (${p.filled}/${p.applicable})` : '';
    lines.push(`  ${marker} ${p.label}${counter}${p.skipped ? ' [skipped]' : ''}`);
  });
  if (overallComplete) {
    lines.push('STATUS: All phases complete — announce completion ONCE and invite the user to Continue. Do not keep asking for more detail unless they request it.');
  } else if (current) {
    lines.push(`CURRENT PHASE: ${current.label} — ${current.ask}`);
    if (gaps.length) {
      const gapLines = gaps.slice(0, 6).map((g) => `  - Step ${g.stepIndex + 1} "${g.stepName}": ${g.missing.join(', ')}`);
      lines.push('REMAINING GAPS IN THIS PHASE:');
      lines.push(...gapLines);
      if (gaps.length > 6) lines.push(`  (+${gaps.length - 6} more)`);
    }
  }
  return lines.join('\n');
}
