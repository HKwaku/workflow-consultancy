'use client';

/**
 * Single-pane view of one process. Inline step rename is supported
 * (click the name to edit) so trivial tweaks don't need a chat
 * round-trip; deeper edits (decision branches, costs, systems list)
 * still defer to the chat at /workspace/map?edit=<processId>.
 */

import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function pickProcesses(d) {
  if (!d || typeof d !== 'object') return [];
  if (Array.isArray(d.rawProcesses) && d.rawProcesses.length) return d.rawProcesses;
  if (Array.isArray(d.processes)    && d.processes.length)    return d.processes;
  if (Array.isArray(d.steps))       return [{ processName: d.processName || 'Process', steps: d.steps }];
  return [];
}

function stepSummary(step) {
  if (!step) return null;
  const sys = Array.isArray(step.systems) ? step.systems.join(', ') : null;
  const work = step.workMinutes != null ? `${step.workMinutes}m work` : null;
  const wait = step.waitMinutes != null ? `${step.waitMinutes}m wait` : null;
  return [step.department, sys, work, wait].filter(Boolean).join(' · ');
}

function EditableStepName({ initial, fallback, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(initial);
  const [busy, setBusy]       = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    const next = value.trim();
    if (!next || next === initial) { setEditing(false); setValue(initial); return; }
    setBusy(true);
    try {
      await onSave?.(next);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="ws-design-step-name ws-design-step-name--editable"
        onClick={() => setEditing(true)}
        title="Click to rename"
      >{initial || fallback}</button>
    );
  }

  return (
    <form className="ws-design-step-rename" onSubmit={submit}>
      <input
        autoFocus
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setValue(initial); } }}
      />
    </form>
  );
}

function ProcessList({ data, editable, onRenameStep }) {
  const processes = pickProcesses(data);
  if (!processes.length) {
    return <div className="ws-design-empty">No steps recorded yet.</div>;
  }
  return (
    <div className="ws-design-side">
      {processes.map((proc, pi) => (
        <div key={pi} className="ws-design-process">
          <h3>{proc.processName || proc.name || `Process ${pi + 1}`}</h3>
          <ol className="ws-design-steps">
            {(proc.steps || []).map((s, si) => (
              <li key={si} className="ws-design-step">
                {editable ? (
                  <EditableStepName
                    initial={s.name || ''}
                    fallback={`Step ${si + 1}`}
                    onSave={(next) => onRenameStep?.({ processIndex: pi, stepIndex: si, newName: next })}
                  />
                ) : (
                  <div className="ws-design-step-name">{s.name || `Step ${si + 1}`}</div>
                )}
                <div className="ws-design-step-meta">{stepSummary(s) || '-'}</div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export default function ProcessDesignSurface({ report, accessToken, canEdit, onChanged }) {
  const flow = report?.flow_data || report?.diagnostic_data || null;

  const summary = useMemo(() => {
    const procs = pickProcesses(flow);
    const steps = procs.reduce((s, p) => s + (p.steps?.length || 0), 0);
    return { processes: procs.length, steps };
  }, [flow]);

  const renameStep = async ({ processIndex, stepIndex, newName }) => {
    if (!report?.id || !flow || !Array.isArray(flow.rawProcesses)) return;
    const next = JSON.parse(JSON.stringify(flow));
    if (!next.rawProcesses[processIndex]?.steps?.[stepIndex]) return;
    next.rawProcesses[processIndex].steps[stepIndex].name = newName;

    await apiFetch('/api/update-diagnostic', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: report.id, updates: { rawProcesses: next.rawProcesses } }),
    }, accessToken);
    onChanged?.();
  };

  return (
    <section className="ws-design">
      <div className="ws-design-summary">
        <span><strong>{summary.processes}</strong> process{summary.processes === 1 ? '' : 'es'} · <strong>{summary.steps}</strong> step{summary.steps === 1 ? '' : 's'}</span>
      </div>

      <ProcessList
        data={flow}
        editable={canEdit}
        onRenameStep={renameStep}
      />
    </section>
  );
}
