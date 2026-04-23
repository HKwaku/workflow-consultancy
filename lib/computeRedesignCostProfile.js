/**
 * Server-side computation of a redesign's cost impact.
 * Replicates the frontend processBreakdown logic so it can run at save time.
 */

function toHourlyRate(rateInput, rateType) {
  const v = rateInput || 0;
  if (rateType === 'daily') return v / 8;
  if (rateType === 'annual') return v / 2080;
  return v;
}

/**
 * @param {object} diagnosticData  - diagnostic_data from the report
 * @param {object} redesign        - the redesign object (changes, costSummary, …)
 * @returns {{ processCosts, totalCurrentCost, totalRedesignedCost, totalSavings,
 *             overallSavingsPct, stepsRemoved, stepsAutomated, timeSavedPct, computedAt }}
 */
export function computeRedesignCostProfile(diagnosticData, redesign) {
  const costAnalysis = diagnosticData.costAnalysis || {};
  const rawProcesses = diagnosticData.rawProcesses || diagnosticData.processes || [];

  const labourRates = costAnalysis.labourRates || [];
  const blendedRate = costAnalysis.blendedRate || 50;
  const onCostMultiplier = costAnalysis.onCostMultiplier || 1.25;
  const processCostDrivers = costAnalysis.processCostDrivers || {};
  const defaultRate = blendedRate * onCostMultiplier;

  const rateByDept = labourRates.reduce((acc, r) => {
    const hr = toHourlyRate(r.rateInput ?? r.hourlyRate, r.rateType);
    if (r.department && hr > 0) acc[r.department] = hr * (r.utilisation ?? 0.85);
    return acc;
  }, {});

  const changes = redesign?.changes || [];
  const costSummary = redesign?.costSummary || {};

  const processCosts = rawProcesses.map((raw, i) => {
    const costs = raw.costs || {};
    const steps = raw.steps || [];
    const processName = raw.processName || raw.name || `Process ${i + 1}`;

    const hours = costs.hoursPerInstance ?? 4;
    const teamSize = costs.teamSize ?? 1;
    const annual = costs.annual ?? (raw.frequency?.annual ?? 12);
    const depts = [...new Set(steps.map(s => s.department).filter(Boolean))];
    const deptRates = depts.map(d => rateByDept[d] ?? defaultRate);
    const avgRate = deptRates.length > 0
      ? deptRates.reduce((a, b) => a + b, 0) / deptRates.length
      : defaultRate;

    const drivers = processCostDrivers[i] || {};
    const errorRate = Math.min(0.5, Number(drivers.errorRate) || 0);
    const waitCostPct = Math.min(0.5, Number(drivers.waitCostPct) || 0);
    const annualLabour = hours * avgRate * annual * teamSize;
    const trueAnnualCost = annualLabour + annualLabour * errorRate * 0.5 + annualLabour * waitCostPct;

    // Derive redesign savings for this process from changes
    const processChanges = changes.filter(c => c.process === processName);
    const totalTimeSaved = processChanges.reduce((sum, c) => sum + (c.estimatedTimeSavedMinutes || 0), 0);
    const totalMins = steps.reduce((sum, s) => sum + (s.workMinutes || 0) + (s.waitMinutes || 0), 0);
    const redesignSavingsPct = totalMins > 0
      ? Math.min(75, Math.round(totalTimeSaved / totalMins * 100))
      : (costSummary.estimatedCostSavedPercent || 0);

    const savingsAmount = Math.round(trueAnnualCost * redesignSavingsPct / 100);

    return {
      processName,
      currentAnnualCost: Math.round(trueAnnualCost),
      redesignedAnnualCost: Math.round(trueAnnualCost) - savingsAmount,
      savingsAmount,
      savingsPct: redesignSavingsPct,
    };
  });

  const totalCurrentCost = processCosts.reduce((sum, p) => sum + p.currentAnnualCost, 0);
  const totalRedesignedCost = processCosts.reduce((sum, p) => sum + p.redesignedAnnualCost, 0);
  const totalSavings = totalCurrentCost - totalRedesignedCost;

  return {
    processCosts,
    totalCurrentCost,
    totalRedesignedCost,
    totalSavings,
    overallSavingsPct: totalCurrentCost > 0 ? Math.round(totalSavings / totalCurrentCost * 100) : 0,
    stepsRemoved: costSummary.stepsRemoved || 0,
    stepsAutomated: costSummary.stepsAutomated || 0,
    timeSavedPct: costSummary.estimatedTimeSavedPercent || 0,
    computedAt: new Date().toISOString(),
  };
}
