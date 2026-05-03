/**
 * Build a presentation-ready .pptx from a `mode='diligence'` deal analysis.
 *
 * Slide ordering mirrors the article's template + DealDiligenceReport.jsx so
 * the export is faithful to what the reviewer just signed off in the UI:
 *
 *   1. Cover
 *   2. Executive summary (single finding)
 *   3. Technology Landscape (one slide per finding)
 *   4. Operational Footprint
 *   5. Organisation
 *   6. Red Flags
 *   7. Day-1 / TSA / Separation cross-cut (single slide, three columns)
 *   8. Key Takeaways
 *
 * Only APPROVED findings are exported. Pending / rejected / needs_revision
 * findings are filtered upstream by applyReviewsToAnalysis(viewerMode='public').
 *
 * Each finding slide includes:
 *   - title + severity + confidence + impact chips
 *   - body
 *   - recommendations (bulleted)
 *   - evidence list with locator + snippet (source-citation guarantee)
 */

import PptxGenJS from 'pptxgenjs';

const COLORS = {
  primary: '0F766E',
  primaryDark: '0B132B',
  text: '1E293B',
  muted: '64748B',
  border: 'E2E8F0',
  bgSoft: 'F8FAFC',
  white: 'FFFFFF',
};

const SEVERITY_COLOR = {
  low:      '22C55E',
  medium:   'F59E0B',
  high:     'EF4444',
  critical: '7F1D1D',
};

const IMPACT_LABEL = {
  day_one:    'Day 1',
  tsa:        'TSA',
  separation: 'Separation',
  long_term:  'Long-term',
};

const IMPACT_COLOR = {
  day_one:    'DC2626',
  tsa:        '9333EA',
  separation: '0891B2',
  long_term:  '475569',
};

function trunc(s, n) {
  if (!s) return '';
  const t = String(s);
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

function evidenceLine(ev) {
  if (!ev) return '';
  const r = ev.ref || {};
  if (ev.kind === 'document_chunk') {
    const loc = [
      r.filename,
      r.page_number ? `p.${r.page_number}` : null,
      r.slide_number ? `slide ${r.slide_number}` : null,
      r.sheet_name ? `sheet ${r.sheet_name}` : null,
      r.cell_range ? `range ${r.cell_range}` : null,
      r.section_path,
    ].filter(Boolean).join(' · ');
    return loc || `chunk ${String(r.chunk_id || '').slice(0, 8)}`;
  }
  if (ev.kind === 'process_step') return `Step ${r.step_index ?? '?'}${r.step_name ? ` – ${r.step_name}` : ''}`;
  if (ev.kind === 'chat_turn')    return `Chat message ${String(r.message_id || '').slice(0, 8)}`;
  if (ev.kind === 'metric')       return `${r.source || ''} · ${r.field || ''}`;
  return ev.kind;
}

/* ── Slide builders ───────────────────────────────────────────── */

function addCover(pres, { dealName, completedAt }) {
  const slide = pres.addSlide();
  slide.background = { color: COLORS.primaryDark };
  slide.addText('Diligence Memo', {
    x: 0.6, y: 1.6, w: 9.0, h: 0.8,
    fontSize: 36, bold: true, color: COLORS.white, fontFace: 'Calibri',
  });
  slide.addText(dealName || 'Deal', {
    x: 0.6, y: 2.5, w: 9.0, h: 0.5,
    fontSize: 22, color: COLORS.white, fontFace: 'Calibri',
  });
  if (completedAt) {
    slide.addText(`Generated ${new Date(completedAt).toLocaleDateString()}`, {
      x: 0.6, y: 5.0, w: 9.0, h: 0.4,
      fontSize: 12, color: 'CBD5E1', fontFace: 'Calibri',
    });
  }
}

function addSectionDivider(pres, label) {
  const slide = pres.addSlide();
  slide.background = { color: COLORS.bgSoft };
  slide.addText(label, {
    x: 0.6, y: 2.6, w: 9, h: 0.8,
    fontSize: 30, bold: true, color: COLORS.primary, fontFace: 'Calibri',
  });
}

function addFindingSlide(pres, finding, { sectionLabel } = {}) {
  if (!finding) return;
  const slide = pres.addSlide();

  // Section ribbon
  if (sectionLabel) {
    slide.addText(sectionLabel.toUpperCase(), {
      x: 0.4, y: 0.25, w: 9.2, h: 0.3,
      fontSize: 10, color: COLORS.primary, bold: true, fontFace: 'Calibri', charSpacing: 80,
    });
  }

  // Title
  slide.addText(finding.title || 'Finding', {
    x: 0.4, y: 0.6, w: 7.6, h: 0.7,
    fontSize: 22, bold: true, color: COLORS.text, fontFace: 'Calibri',
  });

  // Severity badge (top-right)
  slide.addShape(pres.ShapeType.roundRect, {
    x: 8.3, y: 0.65, w: 1.2, h: 0.4, rectRadius: 0.05,
    fill: { color: SEVERITY_COLOR[finding.severity] || COLORS.muted },
    line: { type: 'none' },
  });
  slide.addText((finding.severity || 'medium').toUpperCase(), {
    x: 8.3, y: 0.65, w: 1.2, h: 0.4,
    fontSize: 10, bold: true, color: COLORS.white, align: 'center', valign: 'middle', fontFace: 'Calibri',
  });

  // Confidence + impact chips row
  const chipY = 1.35;
  const conf = typeof finding.confidence === 'number' ? `Confidence ${Math.round(finding.confidence * 100)}%` : '';
  let chipX = 0.4;
  if (conf) {
    slide.addText(conf, {
      x: chipX, y: chipY, w: 1.6, h: 0.3,
      fontSize: 9, bold: true, color: COLORS.muted, fontFace: 'Calibri',
    });
    chipX += 1.7;
  }
  for (const axis of finding.impact || []) {
    const label = IMPACT_LABEL[axis] || axis;
    slide.addShape(pres.ShapeType.roundRect, {
      x: chipX, y: chipY, w: 1.0, h: 0.3, rectRadius: 0.15,
      fill: { color: COLORS.white },
      line: { color: IMPACT_COLOR[axis] || COLORS.muted, width: 1 },
    });
    slide.addText(label, {
      x: chipX, y: chipY, w: 1.0, h: 0.3,
      fontSize: 9, bold: true, color: IMPACT_COLOR[axis] || COLORS.muted,
      align: 'center', valign: 'middle', fontFace: 'Calibri',
    });
    chipX += 1.1;
  }

  // Body
  slide.addText(trunc(finding.body, 700), {
    x: 0.4, y: 1.85, w: 9.2, h: 1.6,
    fontSize: 13, color: COLORS.text, fontFace: 'Calibri', valign: 'top',
  });

  // Recommendations
  const recs = (finding.recommendations || []).slice(0, 5);
  if (recs.length) {
    slide.addText('Recommendations', {
      x: 0.4, y: 3.55, w: 9.2, h: 0.3,
      fontSize: 11, bold: true, color: COLORS.primary, fontFace: 'Calibri',
    });
    slide.addText(recs.map((r) => ({ text: r, options: { bullet: true } })), {
      x: 0.4, y: 3.85, w: 9.2, h: 1.2,
      fontSize: 12, color: COLORS.text, fontFace: 'Calibri', valign: 'top',
    });
  }

  // Evidence
  const ev = (finding.evidence || []).slice(0, 4);
  if (ev.length) {
    slide.addText('Source evidence', {
      x: 0.4, y: 5.15, w: 9.2, h: 0.3,
      fontSize: 11, bold: true, color: COLORS.primary, fontFace: 'Calibri',
    });
    const lines = ev.map((e) => {
      const loc = evidenceLine(e);
      const snip = e.snippet ? ` — “${trunc(e.snippet, 120)}”` : '';
      return { text: `${loc}${snip}`, options: { bullet: true, fontSize: 10, color: COLORS.muted } };
    });
    slide.addText(lines, {
      x: 0.4, y: 5.45, w: 9.2, h: 1.8,
      fontFace: 'Calibri', valign: 'top',
    });
  } else {
    slide.addText('⚠ No source evidence cited.', {
      x: 0.4, y: 5.15, w: 9.2, h: 0.3,
      fontSize: 10, italic: true, color: SEVERITY_COLOR.high, fontFace: 'Calibri',
    });
  }
}

function addAxisCrossCut(pres, { day1, tsa, sep }) {
  const slide = pres.addSlide();
  slide.addText('Transition Lens — Day 1 / TSA / Separation', {
    x: 0.4, y: 0.3, w: 9.2, h: 0.5,
    fontSize: 20, bold: true, color: COLORS.text, fontFace: 'Calibri',
  });
  const cols = [
    { label: 'Day 1',      items: day1, x: 0.4 },
    { label: 'TSA',        items: tsa,  x: 3.6 },
    { label: 'Separation', items: sep,  x: 6.8 },
  ];
  for (const c of cols) {
    slide.addText(`${c.label} (${c.items.length})`, {
      x: c.x, y: 1.0, w: 3.0, h: 0.4,
      fontSize: 14, bold: true, color: COLORS.primary, fontFace: 'Calibri',
    });
    if (c.items.length === 0) {
      slide.addText('Nothing flagged.', {
        x: c.x, y: 1.5, w: 3.0, h: 0.4,
        fontSize: 11, italic: true, color: COLORS.muted, fontFace: 'Calibri',
      });
    } else {
      slide.addText(c.items.slice(0, 12).map((f) => ({
        text: trunc(f.title, 80),
        options: { bullet: true, color: SEVERITY_COLOR[f.severity] || COLORS.text, fontSize: 11 },
      })), {
        x: c.x, y: 1.5, w: 3.0, h: 5.5,
        fontFace: 'Calibri', valign: 'top',
      });
    }
  }
}

/* ── Public API ───────────────────────────────────────────────── */

const SECTIONS = [
  { key: 'technologyLandscape',  label: 'Technology Landscape' },
  { key: 'operationalFootprint', label: 'Operational Footprint' },
  { key: 'organisation',         label: 'Organisation' },
  { key: 'redFlags',             label: 'Red Flags' },
];

const DAY1 = 'day_one';
const TSA  = 'tsa';
const SEP  = 'separation';

/**
 * @param {object} args
 * @param {string} args.dealName
 * @param {string} args.completedAt - ISO date
 * @param {object} args.result      - normalised + reviews-applied analysis result
 *                                    (see applyReviewsToAnalysis with viewerMode='public')
 * @returns {Promise<Buffer>}
 */
export async function buildDealDiligencePptx({ dealName, completedAt, result }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = `${dealName || 'Deal'} - Diligence Memo`;

  addCover(pres, { dealName, completedAt });

  // Exec summary
  if (result.executiveSummary?.key) {
    addSectionDivider(pres, 'Executive Summary');
    addFindingSlide(pres, result.executiveSummary, { sectionLabel: 'Executive Summary' });
  }

  // Body sections
  for (const s of SECTIONS) {
    const arr = Array.isArray(result[s.key]) ? result[s.key] : [];
    if (arr.length === 0) continue;
    addSectionDivider(pres, s.label);
    for (const f of arr) addFindingSlide(pres, f, { sectionLabel: s.label });
  }

  // Day-1 / TSA / Separation cross-cut
  const allFindings = [];
  if (result.executiveSummary?.key) allFindings.push(result.executiveSummary);
  for (const s of SECTIONS) {
    const arr = result[s.key];
    if (Array.isArray(arr)) allFindings.push(...arr);
  }
  if (Array.isArray(result.keyFindings)) allFindings.push(...result.keyFindings);

  const day1 = allFindings.filter((f) => f.impact?.includes(DAY1));
  const tsa  = allFindings.filter((f) => f.impact?.includes(TSA));
  const sep  = allFindings.filter((f) => f.impact?.includes(SEP));
  if (day1.length || tsa.length || sep.length) {
    addAxisCrossCut(pres, { day1, tsa, sep });
  }

  // Key takeaways
  if (Array.isArray(result.keyFindings) && result.keyFindings.length > 0) {
    addSectionDivider(pres, 'Key Takeaways');
    for (const f of result.keyFindings) addFindingSlide(pres, f, { sectionLabel: 'Key Takeaways' });
  }

  // PptxGenJS returns a Promise<Buffer> when output type is 'nodebuffer'
  return await pres.write({ outputType: 'nodebuffer' });
}
