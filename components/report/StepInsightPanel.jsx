'use client';

import { useMemo } from 'react';
import { prepareSteps } from '@/lib/flows/shared.js';

/**
 * Panel shown when a user clicks a flow diagram node.
 * Displays step insights: name, department, automation suggestion, checklist, handoff, etc.
 */
export default function StepInsightPanel({ stepIndex, process, onClose }) {
  const { step, handoffs } = useMemo(() => {
    if (!process) return { step: null, handoffs: [] };
    const { allSteps, handoffMap } = prepareSteps(process);
    const step = allSteps[stepIndex] || null;
    const handoffs = process.handoffs || [];
    return { step, handoffs };
  }, [process, stepIndex]);

  if (!step) return null;

  const handoff = handoffs[stepIndex];
  const prevHandoff = stepIndex > 0 ? handoffs[stepIndex - 1] : null;
  const isDecision = step.isDecision && (step.branches || []).length > 0;
  const checklist = step.checklist || [];
  const checklistDone = checklist.filter(c => c.checked).length;
  const checklistTotal = checklist.length;

  const isBottleneck = process?.bottleneck?.longestStep != null &&
    parseInt(String(process.bottleneck.longestStep).replace('step-', ''), 10) === stepIndex;

  return (
    <div className="step-insight-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="step-insight-panel" onClick={e => e.stopPropagation()}>
        <div className="step-insight-header">
          <span className="step-insight-step-num">Step {stepIndex + 1}</span>
          <button type="button" className="step-insight-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <h4 className="step-insight-title">{step.name || `Step ${stepIndex + 1}`}</h4>

        <div className="step-insight-body">
          {step.department && (
            <div className="step-insight-row">
              <span className="step-insight-label">Team</span>
              <span className="step-insight-value">{step.department}</span>
            </div>
          )}

          {isDecision && (
            <div className="step-insight-row">
              <span className="step-insight-label">Type</span>
              <span className="step-insight-value step-insight-badge decision">Decision point</span>
            </div>
          )}

          {step.auto && (
            <div className="step-insight-row step-insight-auto">
              <span className="step-insight-label">Automation opportunity</span>
              <div>
                <span className="step-insight-badge" style={{ background: step.auto.bg || '#eff6ff', color: step.auto.color || '#2563eb', marginLeft: 0 }}>
                  {step.auto.label} ({step.auto.badge})
                </span>
                {step.auto.reason && (
                  <p className="step-insight-reason">{step.auto.reason}</p>
                )}
              </div>
            </div>
          )}

          {checklistTotal > 0 && (
            <div className="step-insight-row">
              <span className="step-insight-label">Checklist</span>
              <span className="step-insight-value">{checklistDone} of {checklistTotal} complete</span>
            </div>
          )}

          {handoff && (
            <div className="step-insight-row">
              <span className="step-insight-label">Handoff to next step</span>
              <span className="step-insight-value">{handoff.method || '—'}</span>
              {(handoff.clarity === 'yes-multiple' || handoff.clarity === 'yes-major') && (
                <span className="step-insight-badge warning">Clarity issue</span>
              )}
            </div>
          )}

          {prevHandoff && stepIndex > 0 && (
            <div className="step-insight-row">
              <span className="step-insight-label">Handoff from previous</span>
              <span className="step-insight-value">{prevHandoff.method || '—'}</span>
            </div>
          )}

          {isBottleneck && stepIndex === parseInt(String(process.bottleneck.longestStep).replace('step-', ''), 10) && (
            <div className="step-insight-row step-insight-bottleneck">
              <span className="step-insight-label">Bottleneck</span>
              <span className="step-insight-value">{process.bottleneck.reason || 'Longest step in cycle'}</span>
            </div>
          )}

          {(step.systems || []).length > 0 && (
            <div className="step-insight-row">
              <span className="step-insight-label">Systems</span>
              <span className="step-insight-value">{(step.systems || []).join(', ')}</span>
            </div>
          )}

          {isDecision && step.branches?.length > 0 && (
            <div className="step-insight-row">
              <span className="step-insight-label">Branches</span>
              <ul className="step-insight-branches">
                {step.branches.map((br, i) => (
                  <li key={i}>{br.label || br.target || `Branch ${i + 1}`}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
