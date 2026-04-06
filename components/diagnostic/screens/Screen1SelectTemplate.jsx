'use client';

import { PROCESS_TEMPLATES } from '@/lib/diagnostic/processTemplates';
import { useDiagnostic } from '../DiagnosticContext';

export default function Screen1SelectTemplate() {
  const { updateProcessData, goToScreen } = useDiagnostic();

  const handleSelect = (template) => {
    updateProcessData({
      processName: template.label,
      steps: template.steps.map((s, i) => ({
        number: i + 1,
        name: s.name || '',
        department: s.department || '',
        systems: s.systems || [],
        workMinutes: s.workMinutes,
        waitMinutes: s.waitMinutes,
        isDecision: false,
        isMerge: false,
        isExternal: false,
        branches: [],
        contributor: '',
        checklist: [],
      })),
    });
    goToScreen(2);
  };

  const handleSkip = () => {
    goToScreen(2);
  };

  return (
    <div className="screen-template-select">
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Start from a template</h2>
        <p style={{ fontSize: 14, color: 'var(--text-mid)', margin: 0 }}>
          Pick a common process to pre-fill your steps, then edit to match what actually happens.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
        {PROCESS_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelect(t)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
              padding: '14px 16px',
              borderRadius: 10,
              border: '1.5px solid var(--border, #334155)',
              background: 'var(--bg-2, #1e293b)',
              color: 'var(--text, #e8e8e8)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #0d9488)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #334155)'; }}
          >
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{t.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.4 }}>
              {t.steps.length} steps
            </span>
          </button>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          type="button"
          onClick={handleSkip}
          style={{
            padding: '10px 28px',
            borderRadius: 8,
            border: '1px solid var(--border, #334155)',
            background: 'transparent',
            color: 'var(--text-mid)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Skip — map steps manually
        </button>
      </div>
    </div>
  );
}
