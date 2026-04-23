'use client';

import { useDiagnostic } from './DiagnosticContext';
import { calculateProcessQuality } from '@/lib/diagnostic';

export default function ProgressBar({ currentScreen: screenProp }) {
  const {
    currentScreen: ctxScreen,
    diagnosticMode,
    teamMode,
    processData,
    completedProcesses,
    SCREEN_LABELS,
    MAP_ONLY_SCREENS,
    MAP_ONLY_STEP_LABELS,
    COMPREHENSIVE_SCREENS,
    COMPREHENSIVE_STEP_LABELS,
    TOTAL_SCREENS,
  } = useDiagnostic();

  const currentScreen = screenProp ?? ctxScreen;
  const screenList = MAP_ONLY_SCREENS;
  const labelMap = MAP_ONLY_STEP_LABELS;

  let text = '';
  if (currentScreen === -1 || currentScreen === -2) {
    text = '';
  } else if (currentScreen === 0) {
    text = '';
  } else if (currentScreen === TOTAL_SCREENS) {
    text = 'Complete!';
  } else {
    const stepIdx = screenList.indexOf(currentScreen);
    const teamPrefix = teamMode ? 'Team: ' : '';
    if (stepIdx >= 0) {
      text = `${teamPrefix}Step ${stepIdx + 1} of ${screenList.length}: ${labelMap[currentScreen] || SCREEN_LABELS[currentScreen] || ''}`;
    } else {
      text = `${teamPrefix}${SCREEN_LABELS[currentScreen] || ''}`;
    }
  }

  let pct = 0;
  const stepIdx = screenList.indexOf(currentScreen);
  if (stepIdx >= 0) {
    pct = (stepIdx / (screenList.length - 1)) * 100;
  } else if (currentScreen === TOTAL_SCREENS) {
    pct = 100;
  }
  pct = Math.min(pct, 100);

  const processesForHealth = completedProcesses.length > 0 ? completedProcesses : (processData ? [processData] : []);
  const healthScore = processesForHealth.length > 0
    ? Math.round(processesForHealth.reduce((s, p) => s + (calculateProcessQuality(p)?.score ?? 70), 0) / processesForHealth.length)
    : null;
  const showHealthScore = currentScreen > 2 && healthScore !== null;

  return (
    <div className="progress-bar">
      <div className="progress-bar-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: pct + '%' }} />
        </div>
      </div>
      {text && <div className="progress-text">{text}</div>}
      {showHealthScore && (
        <div className="health-score-bar">
          <span>Audit Depth</span>
          <div className="health-score-track">
            <div className={`health-score-fill ${healthScore >= 70 ? 'health-score-fill-green' : healthScore >= 50 ? 'health-score-fill-amber' : 'health-score-fill-red'}`} style={{ width: `${healthScore}%` }} />
          </div>
          <span className="health-score-value">{healthScore}%</span>
        </div>
      )}
    </div>
  );
}
