'use client';

import { useState, useMemo } from 'react';

const EVENT_META = {
  handover:    { icon: '↗', label: 'Handover',   cls: 'handover' },
  save:        { icon: '⬆', label: 'Save',       cls: 'save' },
  resume:      { icon: '↩', label: 'Resume',     cls: 'save' },
  edit:        { icon: '✎', label: 'Edit',       cls: 'edit' },
  submit:      { icon: '✓', label: 'Submit',     cls: 'submit' },
  step_add:    { icon: '+', label: 'Step Added',  cls: 'step' },
  step_remove: { icon: '−', label: 'Step Removed',cls: 'step' },
  step_edit:   { icon: '✎', label: 'Step Change', cls: 'step' },
  checklist:   { icon: '☑', label: 'Checklist',   cls: 'checklist' },
  navigate:    { icon: '→', label: 'Navigate',    cls: 'nav' },
  created:        { icon: '●', label: 'Session',         cls: 'session' },
  redesign_ai:    { icon: '◇', label: 'AI Redesign',     cls: 'redesign' },
  redesign_save:  { icon: '⬆', label: 'Redesign Saved', cls: 'save' },
  redesign_rename: { icon: '✎', label: 'Redesign Renamed', cls: 'edit' },
};

const FILTER_GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'steps', label: 'Steps', types: ['step_add', 'step_remove', 'step_edit'] },
  { key: 'checklist', label: 'Checklist', types: ['checklist'] },
  { key: 'redesigns', label: 'Redesigns', types: ['redesign_ai', 'redesign_save', 'redesign_rename'] },
  { key: 'workflow', label: 'Workflow', types: ['save', 'handover', 'resume', 'submit', 'edit', 'navigate', 'created', 'cost_edit'] },
];

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (diffMs < 30000) return `${timeStr} · Just now`;
  if (diffMs < 3600000) return `${timeStr} · ${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${timeStr} · ${Math.floor(diffMs / 3600000)}h ago`;

  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${dateStr} ${timeStr}`;
}

function groupByDate(events) {
  const groups = {};
  events.forEach(ev => {
    const d = new Date(ev.timestamp);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    let label;
    if (d.toDateString() === today.toDateString()) label = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    else label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(ev);
  });
  return groups;
}

export default function AuditTrailPanel({ auditTrail = [], onClose }) {
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    const events = [...auditTrail].reverse();
    if (filter === 'all') return events;
    const group = FILTER_GROUPS.find(g => g.key === filter);
    if (!group?.types) return events;
    return events.filter(ev => group.types.includes(ev.type));
  }, [auditTrail, filter]);

  const dateGroups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="audit-trail-panel">
      <div className="audit-trail-header">
        <h4>Activity Log <span className="audit-trail-count">{auditTrail.length}</span></h4>
        <button type="button" onClick={onClose}>×</button>
      </div>

      <div className="audit-trail-filters">
        {FILTER_GROUPS.map(g => (
          <button
            key={g.key}
            type="button"
            className={`audit-filter-btn${filter === g.key ? ' active' : ''}`}
            onClick={() => setFilter(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="audit-trail-body">
        {filtered.length === 0 ? (
          <p className="audit-trail-empty">No activity recorded{filter !== 'all' ? ' for this filter' : ''}</p>
        ) : Object.entries(dateGroups).map(([dateLabel, events]) => (
          <div key={dateLabel} className="audit-date-group">
            <div className="audit-date-label">{dateLabel}</div>
            {events.map((ev) => {
              const meta = EVENT_META[ev.type] || EVENT_META.created;
              return (
                <div key={ev.id || ev.timestamp} className={`audit-event audit-event--${meta.cls}`}>
                  <div className="audit-event-timeline">
                    <div className={`audit-event-dot ${meta.cls}`}>{meta.icon}</div>
                    <div className="audit-event-line" />
                  </div>
                  <div className="audit-event-content">
                    <div className="audit-event-text">{ev.detail || ev.description || meta.label}</div>
                    <div className="audit-event-meta">
                      <span className="audit-event-time">{formatTimestamp(ev.timestamp)}</span>
                      {ev.actor && <span className="audit-event-actor">{ev.actor}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
