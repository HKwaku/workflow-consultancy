import React from 'react';
import { useDiagnostic } from './DiagnosticContext';
import { SCREEN_LABELS, SCREEN_PHASES, PHASES } from './constants';
import Screen0Welcome from './screens/Screen0Welcome';
import Screen1ProcessSelection from './screens/Screen1ProcessSelection';
import Screen2NameProcess from './screens/Screen2NameProcess';
import Screen3Boundaries from './screens/Screen3Boundaries';
import LegacyRedirect from './screens/LegacyRedirect';
import './diagnostic.css';

export default function DiagnosticFlow() {
  const { currentScreen, goToScreen, TOTAL_SCREENS } = useDiagnostic();

  const progress = (currentScreen / TOTAL_SCREENS) * 100;
  const showProgress = currentScreen >= 1 && currentScreen <= 18;
  const phase = SCREEN_PHASES[currentScreen] || '';
  const phaseIdx = PHASES.indexOf(phase);
  const progressText = currentScreen === 0
    ? SCREEN_LABELS[0]
    : currentScreen === TOTAL_SCREENS
      ? 'Complete!'
      : `Step ${currentScreen} of ${TOTAL_SCREENS - 1} — ${phase ? phase + ': ' : ''}${SCREEN_LABELS[currentScreen] || ''}`;

  const renderScreen = () => {
    switch (currentScreen) {
      case 0: return <Screen0Welcome />;
      case 1: return <Screen1ProcessSelection />;
      case 2: return <Screen2NameProcess />;
      case 3: return <Screen3Boundaries />;
      default: return <LegacyRedirect targetScreen={currentScreen} />;
    }
  };

  return (
    <div className="diagnostic-flow">
      <div className="top-bar">
        <div className="top-bar-inner">
          <a href="/">Workflow<span style={{ color: 'var(--gold)' }}>.</span></a>
          <span className="top-bar-badge">Process Diagnostic</span>
        </div>
      </div>

      {showProgress && (
        <div className="progress-bar">
          <div className="progress-bar-row">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="progress-text">{progressText}</div>
          <div id="phaseDots" className="phase-dots">
            {PHASES.map((p, idx) => (
              <span
                key={p}
                className={`phase-dot ${idx === phaseIdx ? 'phase-dot-active' : ''} ${idx < phaseIdx ? 'phase-dot-done' : ''}`}
              >
                <span className="phase-dot-num">{idx + 1}</span> {p}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="container">
        <div className="screen active">
          <div className="screen-card">
            {renderScreen()}
          </div>
        </div>
      </div>
    </div>
  );
}
