/**
 * Compute process-level duration from step-level duration data.
 * Used when step durations exist to derive hoursPerInstance and elapsedDays.
 */

/**
 * @param {Array<{workMinutes?: number, waitMinutes?: number, durationMinutes?: number}>} steps
 * @returns {{ hoursPerInstance: number | null, cycleDays: number | null }}
 */
export function computeDurationFromSteps(steps) {
  if (!steps || steps.length === 0) return { hoursPerInstance: null, cycleDays: null };

  let workMin = 0;
  let totalMin = 0;
  let hasAnyDuration = false;

  for (const s of steps) {
    const w = s.workMinutes ?? 0;
    const wt = s.waitMinutes ?? 0;
    const d = s.durationMinutes ?? 0;

    if (w > 0 || wt > 0 || d > 0) hasAnyDuration = true;

    // Person-hours: sum of work time (or total when work/wait not split)
    if (w > 0 || wt > 0) {
      workMin += w;
    } else if (d > 0) {
      workMin += d;
    }

    // Cycle time: sum of (work + wait) or durationMinutes for sequential flow
    if (w > 0 || wt > 0) {
      totalMin += w + wt;
    } else if (d > 0) {
      totalMin += d;
    }
  }

  if (!hasAnyDuration || (workMin === 0 && totalMin === 0)) {
    return { hoursPerInstance: null, cycleDays: null };
  }

  return {
    hoursPerInstance: workMin / 60,
    cycleDays: totalMin / 60 / 24,
  };
}
