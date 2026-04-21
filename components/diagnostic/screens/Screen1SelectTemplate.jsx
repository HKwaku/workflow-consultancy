'use client';

import { PROCESS_TEMPLATES } from '@/lib/diagnostic/processTemplates';
import { getModule } from '@/lib/modules/index';
import { useDiagnostic } from '../DiagnosticContext';

export default function Screen1SelectTemplate() {
  const { updateProcessData, goToScreen, moduleId } = useDiagnostic();
  const moduleConfig = moduleId ? getModule(moduleId) : null;

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

  // Build ordered template list: module-specific starters first, then shared templates
  const moduleTemplates = moduleConfig?.templates || [];
  const sharedTemplates = PROCESS_TEMPLATES.filter((t) => {
    if (!t.modules) return true; // no modules array = show everywhere
    return t.modules.includes(moduleId) || t.modules.length === 0;
  });

  const allTemplates = [...moduleTemplates, ...sharedTemplates];

  return (
    <div className="screen-template-select">
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Start from a template</h2>
        <p style={{ fontSize: 14, color: 'var(--text-mid)', margin: 0 }}>
          Pick a common process to pre-fill your steps, then edit to match what actually happens.
        </p>
      </div>

      {moduleTemplates.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: moduleConfig.color || 'var(--text-light)', marginBottom: 10 }}>
            {moduleConfig.label} starters
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
            {moduleTemplates.map((t) => (
              <TemplateButton key={t.id} template={t} accentColor={moduleConfig.color} onSelect={handleSelect} />
            ))}
          </div>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-light)', marginBottom: 10 }}>
            Other templates
          </p>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
        {sharedTemplates.map((t) => (
          <TemplateButton key={t.id} template={t} onSelect={handleSelect} />
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

function TemplateButton({ template, accentColor, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        padding: '14px 16px',
        borderRadius: 10,
        border: `1.5px solid ${accentColor ? accentColor + '44' : 'var(--border, #334155)'}`,
        background: accentColor ? accentColor + '0d' : 'var(--bg-2, #1e293b)',
        color: 'var(--text, #e8e8e8)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accentColor || 'var(--accent, #0d9488)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = accentColor ? accentColor + '44' : 'var(--border, #334155)';
      }}
    >
      <span style={{ fontSize: 20 }}>{template.icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{template.label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.4 }}>
        {template.steps.length} steps
      </span>
    </button>
  );
}
