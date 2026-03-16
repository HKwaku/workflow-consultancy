import { getDeptColor as getDC } from './shared.js';

export function buildListHTML(process) {
  const steps = process.steps || [];
  const handoffs = process.handoffs || [];
  const startLabel = process.definition?.startsWhen || 'Start';
  const endLabel = process.definition?.completesWhen || 'Complete';

  if (steps.length === 0) return '';

  function getDeptColor(dept) {
    return getDC(dept).stroke;
  }

  let html = '<div class="flow-list-view">';
  html += `<div class="flow-list-start">${escapeHtml(startLabel)}</div>`;

  steps.forEach((s, i) => {
    const dept = s.department || 'Other';
    const color = getDeptColor(dept);
    const handoff = handoffs[i];
    const handoffLabel = handoff?.method ? handoff.method.replace(/-/g, ' ') : null;

    html += '<div class="flow-list-step" data-step-index="' + i + '">';
    html += '<span class="flow-list-num">' + (i + 1) + '</span>';
    html += '<span class="flow-list-dept" style="background:' + color + '20;color:' + color + ';border-color:' + color + '">' + escapeHtml(dept) + '</span>';
    html += '<span class="flow-list-name">' + escapeHtml(s.name || 'Step ' + (i + 1)) + '</span>';
    if (s.isDecision && s.branches?.length) {
      html += '<span class="flow-list-branch">' + escapeHtml(s.branches.map((b) => b.label || b).join(' / ')) + '</span>';
    }
    if (s.isExternal) html += '<span class="flow-list-ext">External</span>';
    html += '</div>';

    if (handoffLabel && i < steps.length - 1) {
      html += '<div class="flow-list-handoff">→ ' + escapeHtml(handoffLabel) + (handoff?.clarity === 'yes-multiple' || handoff?.clarity === 'yes-major' ? ' <span class="flow-list-clarity">(clarification issues)</span>' : '') + '</div>';
    }
  });

  html += `<div class="flow-list-end">${escapeHtml(endLabel)}</div>`;
  html += '</div>';
  return html;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
