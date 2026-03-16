/**
 * Build process map observations from actual process data.
 * Ensures consistency with tile metrics (steps, handoffs, teams) by deriving
 * observations from the same source of truth.
 */

function generateRuleBasedRecs(processes) {
  const recs = [];
  processes.forEach((p) => {
    const steps = p.steps || [];
    const handoffs = p.handoffs || [];
    const systems = p.systems || [];
    const knowledge = p.knowledge || {};

    const confusedHandoffs = handoffs.filter((h) => h.clarity === 'yes-multiple' || h.clarity === 'yes-major');
    const informalHandoffs = handoffs.filter((h) => h.method === 'they-knew' || h.method === 'verbal');
    if (confusedHandoffs.length > 0) {
      const examples = confusedHandoffs.slice(0, 2).map((h) => (h.from?.name ? `"${h.from.name}"` : null)).filter(Boolean);
      recs.push({
        type: 'handoff',
        process: p.processName,
        text: `${confusedHandoffs.length} handoff${confusedHandoffs.length > 1 ? 's' : ''} triggered repeated clarification${examples.length ? ` (at ${examples.join(', ')})` : ''}. Define a "handoff-ready" checklist for these transitions.`,
      });
    } else if (informalHandoffs.length > 0) {
      recs.push({
        type: 'handoff',
        process: p.processName,
        text: `${informalHandoffs.length} handoff${informalHandoffs.length > 1 ? 's' : ''} rely on verbal or assumed communication. Replace with a logged notification so there's always a record of when work transferred.`,
      });
    }

    const allStepSystemNames = [...new Set(steps.flatMap((s) => s.systems || []))];
    if (allStepSystemNames.length >= 3) {
      let systemSwitches = 0;
      for (let i = 1; i < steps.length; i++) {
        const prevSys = steps[i - 1].systems || [];
        const currSys = steps[i].systems || [];
        const overlap = prevSys.some((s) => currSys.includes(s));
        if (prevSys.length > 0 && currSys.length > 0 && !overlap) systemSwitches++;
      }
      if (systemSwitches >= 2) {
        recs.push({
          type: 'integration',
          process: p.processName,
          text: `${allStepSystemNames.length} systems in use with ${systemSwitches} points where adjacent steps use different tools. Each switch is a likely manual copy-paste step  -  and an integration candidate.`,
        });
      }
    } else if (allStepSystemNames.length >= 2) {
      recs.push({
        type: 'integration',
        process: p.processName,
        text: `${allStepSystemNames.length} systems in use. Unless integrated, data is likely moving between them manually. Mapping where data transfers happen is the first step to eliminating them.`,
      });
    }

    if (knowledge?.vacationImpact === 'stops' || knowledge?.vacationImpact === 'slows-down') {
      recs.push({ type: 'knowledge', process: p.processName, text: `"${p.processName}" has critical knowledge risk.` });
    }
  });
  return recs;
}

/**
 * Build observations from process data. Returns array of { type, process, text, icon, color }
 * for consistent display with tile metrics.
 */
export function buildMapObservations(processes) {
  if (!processes || processes.length === 0) return [];

  const items = [];

  processes.forEach((p) => {
    const steps = p.steps || [];
    const handoffs = p.handoffs || [];
    const namedSteps = steps.filter((s) => s.name && s.name.trim());
    const allSystems = [...new Set(namedSteps.flatMap((s) => s.systems || []))];
    const depts = [...new Set(namedSteps.map((s) => s.department).filter(Boolean))];
    const extSteps = namedSteps.filter((s) => s.isExternal);
    const decisionSteps = namedSteps.filter((s) => s.isDecision);

    const pLabel = processes.length > 1 ? `${p.processName}: ` : '';

    // Structure
    if (namedSteps.length >= 15) {
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${namedSteps.length} steps  -  massively long. Consider consolidating consecutive tasks into a single step with a checklist of sub-tasks performed by one team before handover. This reduces handoff overhead and keeps related work together.`,
        icon: '⚠',
        color: '#d97706',
      });
    } else if (namedSteps.length >= 12) {
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${namedSteps.length} steps  -  high complexity. Processes this long are harder to train and have more failure points.`,
        icon: '⚠',
        color: '#d97706',
      });
    } else if (namedSteps.length >= 7) {
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${namedSteps.length} steps documented  -  well-scoped process with good visibility.`,
        icon: '✓',
        color: '#059669',
      });
    } else if (namedSteps.length > 0) {
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${namedSteps.length} steps captured. Adding more detail (8+ steps) will surface friction points.`,
        icon: '↑',
        color: '#0891b2',
      });
    }

    // Team span (uses same depts as tile)
    if (depts.length >= 4) {
      items.push({
        type: 'handoff',
        process: p.processName,
        text: `${pLabel}Spans ${depts.length} teams (${depts.join(', ')}). Processes crossing 4+ team boundaries have high coordination overhead.`,
        icon: '⚠',
        color: '#d97706',
      });
    } else if (depts.length >= 2) {
      items.push({
        type: 'handoff',
        process: p.processName,
        text: `${pLabel}Involves ${depts.length} teams: ${depts.join(', ')}. ${depts.length - 1} handoff point${depts.length - 1 > 1 ? 's' : ''} where work transitions between teams.`,
        icon: '◉',
        color: '#0891b2',
      });
    } else if (depts.length === 1) {
      items.push({
        type: 'handoff',
        process: p.processName,
        text: `${pLabel}Process stays within a single team (${depts[0]}). Minimal coordination overhead.`,
        icon: '✓',
        color: '#059669',
      });
    }

    // Decision points
    if (decisionSteps.length > 0) {
      const decNames = decisionSteps.slice(0, 3).map((s) => `"${s.name}"`).join(', ');
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${decisionSteps.length} decision point${decisionSteps.length > 1 ? 's' : ''} (${decNames}${decisionSteps.length > 3 ? '…' : ''}). Document criteria for each branch.`,
        icon: '◆',
        color: '#7c3aed',
      });
    }

    // External parties
    if (extSteps.length > 0) {
      const extDepts = [...new Set(extSteps.map((s) => s.department).filter(Boolean))];
      items.push({
        type: 'general',
        process: p.processName,
        text: `${pLabel}${extSteps.length} step${extSteps.length > 1 ? 's' : ''} involve external parties${extDepts.length ? ` (${extDepts.join(', ')})` : ''}. Automate follow-up and set explicit response expectations.`,
        icon: '↔',
        color: '#ea580c',
      });
    }

    // Back-and-forth
    const bounceDepts = new Set();
    for (let i = 2; i < namedSteps.length; i++) {
      const d = namedSteps[i].department;
      if (d && d === namedSteps[i - 2].department && d !== namedSteps[i - 1].department) bounceDepts.add(d);
    }
    if (bounceDepts.size > 0) {
      items.push({
        type: 'handoff',
        process: p.processName,
        text: `${pLabel}Back-and-forth detected  -  ${[...bounceDepts].join(', ')} appear${bounceDepts.size === 1 ? 's' : ''} multiple times with other teams in between. Define "done" criteria at each exit point.`,
        icon: '↩',
        color: '#be185d',
      });
    }

    // Handoff quality
    if (handoffs.length > 0) {
      const clarityIssues = handoffs.filter((h) => h.clarity === 'yes-multiple' || h.clarity === 'yes-major');
      const informalHandoffs = handoffs.filter((h) => h.method === 'verbal' || h.method === 'they-knew');
      const cleanHandoffs = handoffs.filter((h) => h.clarity === 'no');

      if (clarityIssues.length > 0) {
        items.push({
          type: 'handoff',
          process: p.processName,
          text: `${clarityIssues.length} handoff${clarityIssues.length > 1 ? 's' : ''} triggered clarification rounds. Define "handoff-ready" criteria.`,
          icon: '⚠',
          color: '#d97706',
        });
      }
      if (informalHandoffs.length > 0) {
        const theyKnew = handoffs.filter((h) => h.method === 'they-knew').length;
        if (theyKnew > 0) {
          items.push({
            type: 'handoff',
            process: p.processName,
            text: `${theyKnew} handoff${theyKnew > 1 ? 's' : ''} rely on someone "just knowing" to check. Replace with a visible notification.`,
            icon: '⚠',
            color: '#d97706',
          });
        }
      }
      if (clarityIssues.length === 0 && informalHandoffs.length === 0 && cleanHandoffs.length > 0) {
        items.push({
          type: 'handoff',
          process: p.processName,
          text: `${cleanHandoffs.length} of ${handoffs.length} handoffs required no clarification. Clean handoffs mean work transfers without back-and-forth.`,
          icon: '✓',
          color: '#059669',
        });
      }
    }

    // System fragmentation
    if (allSystems.length >= 2) {
      let switches = 0;
      const switchPairs = [];
      for (let i = 1; i < namedSteps.length; i++) {
        const prev = namedSteps[i - 1].systems || [];
        const curr = namedSteps[i].systems || [];
        if (prev.length > 0 && curr.length > 0) {
          const overlap = prev.some((a) => curr.map((b) => b.toLowerCase()).includes(a.toLowerCase()));
          if (!overlap) {
            switches++;
            if (switchPairs.length < 2) switchPairs.push(`"${namedSteps[i - 1].name}" → "${namedSteps[i].name}"`);
          }
        }
      }
      if (switches >= 2) {
        items.push({
          type: 'integration',
          process: p.processName,
          text: `${switches} system-to-system switches (e.g. ${switchPairs[0]}${switchPairs[1] ? `; ${switchPairs[1]}` : ''}). Each switch without integration is a manual copy-paste step.`,
          icon: '⚠',
          color: '#d97706',
        });
      } else {
        items.push({
          type: 'integration',
          process: p.processName,
          text: `${allSystems.length} systems in use (${allSystems.slice(0, 5).join(', ')}${allSystems.length > 5 ? '…' : ''}). Map where data transfers happen to eliminate manual steps.`,
          icon: '◉',
          color: '#0891b2',
        });
      }

      const multiSysSteps = namedSteps.filter((s) => s.systems && s.systems.length >= 2);
      if (multiSysSteps.length > 0) {
        items.push({
          type: 'integration',
          process: p.processName,
          text: `${multiSysSteps.length} step${multiSysSteps.length > 1 ? 's' : ''} use 2+ systems simultaneously. A unified view or API sync would reduce cognitive load.`,
          icon: '◆',
          color: '#7c3aed',
        });
      }
    }

    // Rule-based specific findings
    const recs = generateRuleBasedRecs([p]).filter((r) => r.type !== 'general');
    recs.forEach((r) => items.push({ ...r, icon: '→', color: '#0891b2' }));
  });

  if (items.length === 0) {
    const p0 = processes[0];
    const steps0 = p0?.steps || [];
    const sys0 = [...new Set(steps0.flatMap((s) => s.systems || []))];
    const d0 = [...new Set(steps0.map((s) => s.department).filter(Boolean))];
    items.push({
      type: 'general',
      process: p0?.processName,
      text: `${steps0.length} steps documented across ${d0.length > 0 ? `${d0.length} team${d0.length > 1 ? 's' : ''}` : 'the process'}${sys0.length > 0 ? ` using ${sys0.length} system${sys0.length > 1 ? 's' : ''}` : ''}. No structural friction detected. Run full analysis for cost and automation opportunities.`,
      icon: '✓',
      color: '#059669',
    });
  }

  return items;
}
