'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const STATUS_CYCLE = ['not-started', 'in-progress', 'done'];
const STATUS_META = {
  'not-started': { label: 'Not started', cls: 'tracker-not-started', icon: '○' },
  'in-progress':  { label: 'In progress', cls: 'tracker-in-progress',  icon: '◑' },
  'done':         { label: 'Done',        cls: 'tracker-done',         icon: '●' },
};

export default function ImplementationTracker({ recs, currentStatus, reportId, accessToken }) {
  const [status, setStatus] = useState(currentStatus || {});
  const [saving, setSaving] = useState(null);

  const handleToggle = useCallback(async (key) => {
    const current = status[key] || 'not-started';
    const nextIdx = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
    const next = STATUS_CYCLE[nextIdx];
    setStatus((prev) => ({ ...prev, [key]: next }));
    setSaving(key);
    try {
      await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        body: JSON.stringify({ reportId, updates: { implementationStatus: { [key]: next } } }),
      }, accessToken);
    } catch {
      // revert on failure
      setStatus((prev) => ({ ...prev, [key]: current }));
    } finally {
      setSaving(null);
    }
  }, [status, reportId, accessToken]);

  if (!recs || recs.length === 0) {
    return <p style={{ color: 'var(--text-mid)', fontSize: '0.9rem' }}>No recommendations to track yet.</p>;
  }

  const counts = STATUS_CYCLE.reduce((acc, s) => {
    acc[s] = recs.filter((_, i) => (status[String(i)] || 'not-started') === s).length;
    return acc;
  }, {});

  return (
    <div className="impl-tracker">
      <div className="impl-tracker-summary">
        {STATUS_CYCLE.map((s) => (
          <span key={s} className={`impl-tracker-pill ${STATUS_META[s].cls}`}>
            {STATUS_META[s].icon} {counts[s]} {STATUS_META[s].label}
          </span>
        ))}
      </div>
      <div className="impl-tracker-list">
        {recs.map((rec, i) => {
          const key = String(i);
          const st = status[key] || 'not-started';
          const meta = STATUS_META[st];
          return (
            <div key={i} className={`impl-tracker-row ${meta.cls}`}>
              <button
                type="button"
                className="impl-tracker-toggle"
                onClick={() => handleToggle(key)}
                disabled={saving === key}
                title={`Mark as ${STATUS_CYCLE[(STATUS_CYCLE.indexOf(st) + 1) % STATUS_CYCLE.length]}`}
              >
                {saving === key ? '…' : meta.icon}
              </button>
              <div className="impl-tracker-content">
                {rec.process && <span className="impl-tracker-process">{rec.process}</span>}
                <p className="impl-tracker-text">{rec.action || rec.text}</p>
              </div>
              <span className={`impl-tracker-status ${meta.cls}`}>{meta.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
