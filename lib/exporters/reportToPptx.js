/**
 * Build a presentation-ready .pptx from a stored diagnostic report.
 *
 * Five sections (matches the structure of /report):
 *   1. Cover
 *   2. Executive summary
 *   3. Operational footprint (per-process: steps, handoffs, departments)
 *   4. Key findings & recommendations (grouped by quick-win / medium / project,
 *      with severity, dealStage tag, and source citations when present)
 *   5. Roadmap / next steps
 *
 * Used by /api/export-pptx. The shape of `report` matches the response of
 * /api/get-diagnostic ({ report: { id, contactName, company, diagnosticData, ... } }).
 */
import PptxGenJS from 'pptxgenjs';

const COLORS = {
  primary: '0F766E',      // teal
  primaryDark: '0B132B',
  text: '1E293B',
  muted: '64748B',
  border: 'E2E8F0',
  bgSoft: 'F8FAFC',
  high: 'DC2626',
  medium: 'D97706',
  low: '64748B',
  approved: '16A34A',
  rejected: 'DC2626',
};

const STAGE_LABEL = {
  day1: 'Day 1',
  tsa: 'TSA',
  separation: 'Separation',
  'post-close': 'Post-close',
};
const STAGE_COLOR = {
  day1: 'DC2626',
  tsa: '7C3AED',
  separation: '0891B2',
  'post-close': '16A34A',
};

function fmt(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

function money(n) {
  if (!n || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  if (num >= 1_000_000) return `£${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `£${(num / 1_000).toFixed(0)}K`;
  return `£${num.toFixed(0)}`;
}

function addCover(pres, { contactName, company, diagnosticData, createdAt }) {
  const slide = pres.addSlide();
  slide.background = { color: COLORS.primaryDark };

  slide.addText('Process Diagnostic Report', {
    x: 0.5, y: 1.6, w: 9, h: 0.6,
    fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Calibri',
  });
  slide.addText(company || diagnosticData?.contact?.company || contactName || 'Diagnostic', {
    x: 0.5, y: 2.3, w: 9, h: 0.5,
    fontSize: 22, color: 'CBD5E1', fontFace: 'Calibri',
  });
  if (createdAt) {
    slide.addText(`Generated ${new Date(createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, {
      x: 0.5, y: 3.0, w: 9, h: 0.4,
      fontSize: 13, color: '94A3B8', fontFace: 'Calibri',
    });
  }
  slide.addText('Vesno  ·  Process Audit', {
    x: 0.5, y: 6.6, w: 9, h: 0.3,
    fontSize: 11, color: '94A3B8', fontFace: 'Calibri', italic: true,
  });
}

function addSectionHeader(pres, title, subtitle) {
  const slide = pres.addSlide();
  slide.addText(title, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 26, bold: true, color: COLORS.primary, fontFace: 'Calibri' });
  if (subtitle) slide.addText(subtitle, { x: 0.5, y: 1.0, w: 9, h: 0.4, fontSize: 13, color: COLORS.muted, fontFace: 'Calibri' });
  return slide;
}

function addExecutiveSummary(pres, dd) {
  const summary = dd.summary || {};
  const automation = dd.automationScore || {};
  const slide = addSectionHeader(pres, 'Executive Summary', 'At-a-glance performance and headline numbers.');

  const rows = [
    ['Processes analysed', fmt(summary.totalProcesses)],
    ['Total annual cost', money(summary.totalAnnualCost)],
    ['Identified savings potential', money(summary.potentialSavings)],
    ['Automation score', automation.percentage ? `${automation.percentage}% (${automation.grade || 'N/A'})` : 'N/A'],
  ];
  slide.addTable(rows.map((r) => [
    { text: r[0], options: { bold: true, color: COLORS.text, fontFace: 'Calibri', fontSize: 13, fill: { color: COLORS.bgSoft } } },
    { text: r[1], options: { color: COLORS.text, fontFace: 'Calibri', fontSize: 13 } },
  ]), {
    x: 0.5, y: 1.6, w: 9, colW: [3.5, 5.5], rowH: 0.45,
    border: { type: 'solid', pt: 0.5, color: COLORS.border },
  });

  const recs = Array.isArray(dd.recommendations) ? dd.recommendations : [];
  const high = recs.filter((r) => r?.severity === 'high').slice(0, 3);
  if (high.length) {
    slide.addText('Top high-severity findings', { x: 0.5, y: 4.2, w: 9, h: 0.4, fontSize: 14, bold: true, color: COLORS.text, fontFace: 'Calibri' });
    slide.addText(high.map((r, i) => ({ text: `${i + 1}. ${r.text || r.action || r.finding || ''}`, options: { bullet: false, fontSize: 12, color: COLORS.text } })), {
      x: 0.5, y: 4.6, w: 9, h: 2.0, fontFace: 'Calibri', valign: 'top', paraSpaceAfter: 6,
    });
  }
}

function addOperationalFootprint(pres, dd) {
  const procs = Array.isArray(dd.processes) ? dd.processes : [];
  if (!procs.length) return;
  addSectionHeader(pres, 'Operational Footprint', `${procs.length} process${procs.length === 1 ? '' : 'es'} analysed.`);

  procs.forEach((p) => {
    const slide = pres.addSlide();
    slide.addText(fmt(p.name || p.processName, 'Process'), { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 22, bold: true, color: COLORS.primary, fontFace: 'Calibri' });

    const stepCount = (p.steps || []).length;
    const handoffCount = p.handoffCount ?? (p.handoffs || []).length;
    const depts = p.departments || [];
    const meta = [
      stepCount ? `${stepCount} step${stepCount === 1 ? '' : 's'}` : null,
      handoffCount ? `${handoffCount} handoff${handoffCount === 1 ? '' : 's'}` : null,
      depts.length ? `${depts.length} department${depts.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join('  ·  ');
    if (meta) slide.addText(meta, { x: 0.5, y: 1.0, w: 9, h: 0.4, fontSize: 12, color: COLORS.muted, fontFace: 'Calibri' });

    const stepRows = [[
      { text: '#', options: { bold: true, fill: { color: COLORS.bgSoft } } },
      { text: 'Step', options: { bold: true, fill: { color: COLORS.bgSoft } } },
      { text: 'Department', options: { bold: true, fill: { color: COLORS.bgSoft } } },
    ]];
    (p.steps || []).slice(0, 14).forEach((s, i) => {
      stepRows.push([
        { text: String(s.number ?? i + 1), options: { fontSize: 11 } },
        { text: fmt(s.name), options: { fontSize: 11 } },
        { text: fmt(s.department, ''), options: { fontSize: 11, color: COLORS.muted } },
      ]);
    });
    if ((p.steps || []).length > 14) {
      stepRows.push([{ text: `+ ${(p.steps || []).length - 14} more steps`, options: { italic: true, color: COLORS.muted, colspan: 3 } }, '', '']);
    }
    slide.addTable(stepRows, {
      x: 0.5, y: 1.6, w: 9, colW: [0.6, 6.0, 2.4],
      border: { type: 'solid', pt: 0.5, color: COLORS.border },
      fontFace: 'Calibri',
    });
  });
}

function addFindings(pres, dd) {
  const recs = Array.isArray(dd.recommendations) ? dd.recommendations : [];
  if (!recs.length) return;

  addSectionHeader(pres, 'Key Findings & Recommendations', `${recs.length} recommendation${recs.length === 1 ? '' : 's'} ranked by impact and effort.`);

  const groups = { 'quick-win': [], medium: [], project: [], other: [] };
  recs.forEach((r) => {
    const k = ['quick-win', 'medium', 'project'].includes(r.effortLevel) ? r.effortLevel : 'other';
    groups[k].push(r);
  });
  const groupLabels = { 'quick-win': 'Quick Wins', medium: 'Medium-term', project: 'Longer-term', other: 'Other' };

  for (const key of ['quick-win', 'medium', 'project', 'other']) {
    const items = groups[key];
    if (!items.length) continue;

    // Up to 4 recs per slide for legibility.
    const PER_SLIDE = 4;
    for (let pi = 0; pi < items.length; pi += PER_SLIDE) {
      const chunk = items.slice(pi, pi + PER_SLIDE);
      const slide = pres.addSlide();
      slide.addText(groupLabels[key], { x: 0.5, y: 0.35, w: 9, h: 0.5, fontSize: 20, bold: true, color: COLORS.primary, fontFace: 'Calibri' });
      slide.addText(`${pi + 1}–${pi + chunk.length} of ${items.length}`, { x: 0.5, y: 0.85, w: 9, h: 0.3, fontSize: 11, color: COLORS.muted, fontFace: 'Calibri' });

      chunk.forEach((r, i) => {
        const top = 1.3 + i * 1.45;
        // Severity / dealStage / review badges as a single text block of inline runs.
        const runs = [];
        if (r.severity) runs.push({ text: ` ${String(r.severity).toUpperCase()} `, options: { bold: true, fontSize: 9, color: 'FFFFFF', highlight: r.severity === 'high' ? COLORS.high : r.severity === 'medium' ? COLORS.medium : COLORS.low } });
        if (r.dealStage && STAGE_LABEL[r.dealStage]) runs.push({ text: `  ${STAGE_LABEL[r.dealStage]} `, options: { bold: true, fontSize: 9, color: STAGE_COLOR[r.dealStage] } });
        if (r.reviewStatus && r.reviewStatus !== 'pending') runs.push({ text: `  ${r.reviewStatus === 'approved' ? '✓ Approved' : '✗ Rejected'} `, options: { bold: true, fontSize: 9, color: r.reviewStatus === 'approved' ? COLORS.approved : COLORS.rejected } });
        if (r.process) runs.push({ text: `   ${r.process}`, options: { fontSize: 9, color: COLORS.muted, italic: true } });
        if (runs.length) slide.addText(runs, { x: 0.5, y: top, w: 9, h: 0.3, fontFace: 'Calibri' });

        const headline = r.text || r.action || r.finding || '';
        slide.addText(headline, { x: 0.5, y: top + 0.3, w: 9, h: 0.4, fontSize: 13, bold: true, color: COLORS.text, fontFace: 'Calibri' });

        const sub = [];
        if (r.action && r.action !== headline) sub.push(r.action);
        if (r.estimatedTimeSavedMinutes > 0) sub.push(`~${r.estimatedTimeSavedMinutes} min saved per run`);
        if (r.frameworkRef) sub.push(r.frameworkRef);
        if (sub.length) slide.addText(sub.join('  ·  '), { x: 0.5, y: top + 0.65, w: 9, h: 0.35, fontSize: 10, color: COLORS.muted, fontFace: 'Calibri' });

        const sources = Array.isArray(r.sources) ? r.sources.filter(Boolean) : [];
        if (sources.length) {
          const sLine = sources.slice(0, 3).map((s) => `📎 ${[s.docName, s.locator].filter(Boolean).join(' · ') || 'Source'}`).join('   ');
          slide.addText(sLine, { x: 0.5, y: top + 0.95, w: 9, h: 0.3, fontSize: 9, color: COLORS.primary, fontFace: 'Calibri', italic: true });
        }
      });
    }
  }
}

function addRoadmap(pres, dd) {
  const roadmap = dd.roadmap;
  const recs = Array.isArray(dd.recommendations) ? dd.recommendations : [];

  // Synthesise a simple roadmap if structured data isn't present: quick-wins → medium → project.
  const groups = { 'quick-win': [], medium: [], project: [] };
  recs.forEach((r) => {
    const k = ['quick-win', 'medium', 'project'].includes(r.effortLevel) ? r.effortLevel : 'medium';
    groups[k].push(r);
  });

  const slide = addSectionHeader(pres, 'Roadmap & Next Steps', 'Suggested sequence — start with quick wins, then plan the rest.');

  const blocks = [
    { label: '0–30 days  ·  Quick wins', recs: groups['quick-win'].slice(0, 4), color: COLORS.approved },
    { label: '30–90 days  ·  Medium-term', recs: groups['medium'].slice(0, 4), color: COLORS.medium },
    { label: '90+ days  ·  Longer-term', recs: groups['project'].slice(0, 4), color: COLORS.high },
  ];

  blocks.forEach((b, idx) => {
    const x = 0.5 + idx * 3.05;
    slide.addShape('rect', { x, y: 1.6, w: 2.85, h: 0.45, fill: { color: b.color }, line: { color: b.color } });
    slide.addText(b.label, { x, y: 1.6, w: 2.85, h: 0.45, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: 'Calibri', align: 'center' });
    slide.addText(b.recs.length ? b.recs.map((r) => ({ text: r.text || r.action || r.finding || '', options: { bullet: { type: 'bullet' }, fontSize: 11, color: COLORS.text } })) : [{ text: 'No items in this band.', options: { italic: true, color: COLORS.muted, fontSize: 11 } }], {
      x, y: 2.2, w: 2.85, h: 4.5, fontFace: 'Calibri', paraSpaceAfter: 6, valign: 'top',
    });
  });

  if (roadmap && typeof roadmap === 'object' && Object.keys(roadmap).length > 0) {
    slide.addText('Custom roadmap notes', { x: 0.5, y: 6.7, w: 9, h: 0.3, fontSize: 10, color: COLORS.muted, fontFace: 'Calibri', italic: true });
  }
}

/**
 * Build a Buffer containing a .pptx file from a stored report.
 * @param {{ id: string, contactName?: string, company?: string, diagnosticData: object, createdAt?: string }} report
 * @returns {Promise<Buffer>}
 */
export async function buildReportPptx(report) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = `${report.company || report.contactName || 'Diagnostic'} — Process Audit`;
  pres.author = 'Vesno';
  pres.company = 'Vesno';

  const dd = report.diagnosticData || {};
  addCover(pres, report);
  addExecutiveSummary(pres, dd);
  addOperationalFootprint(pres, dd);
  addFindings(pres, dd);
  addRoadmap(pres, dd);

  const data = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}
