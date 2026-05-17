/**
 * Parse Mermaid `gantt` source into the structured plan shape the
 * interactive GanttChart consumes, so legacy (type=mermaid) gantts —
 * and anything emitted before the structured `gantt` skill shipped —
 * still render as an interactive chart instead of a static image.
 * Returns null if it isn't a gantt.
 *
 * Pure + dependency-free so it can be unit-tested without the React
 * component. Re-exported from components/workspace/GanttChart.jsx.
 *
 * Mermaid task grammar (after the colon, comma-separated):
 *   Name : [done|active|crit|milestone,] [id,] (date | after ids), [dur]
 */
export function parseMermaidGantt(src) {
  const text = String(src || '').trim();
  if (!/^gantt\b/.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const STATUS = new Set(['done', 'active', 'crit', 'milestone']);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const DUR = /^-?\d+(\.\d+)?\s*[dwhm]$/i;
  const toDays = (tok) => {
    const m = /^(-?\d+(?:\.\d+)?)\s*([dwhm])$/i.exec(tok);
    if (!m) return 1;
    const n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'w') return Math.max(1, Math.round(n * 7));
    if (u === 'h') return Math.max(1, Math.round(n / 24));
    if (u === 'm') return 1;
    return Math.max(1, Math.round(n));
  };

  const plan = { title: '', sections: [] };
  let cur = null;
  let auto = 0;
  for (const line of lines) {
    if (/^gantt\b/.test(line)) continue;
    if (/^(dateFormat|axisFormat|excludes|tickInterval|todayMarker|weekday)\b/i.test(line)) continue;
    const titleM = /^title\s+(.+)$/i.exec(line);
    if (titleM) { plan.title = titleM[1].trim(); continue; }
    const secM = /^section\s+(.+)$/i.exec(line);
    if (secM) { cur = { name: secM[1].trim(), tasks: [] }; plan.sections.push(cur); continue; }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (!cur) { cur = { name: 'Plan', tasks: [] }; plan.sections.push(cur); }
    const name = line.slice(0, colon).trim();
    const toks = line.slice(colon + 1).split(',').map((s) => s.trim()).filter(Boolean);
    const task = { name, after: [] };
    let milestone = false; let crit = false;
    for (const tk of toks) {
      const low = tk.toLowerCase();
      if (STATUS.has(low)) { if (low === 'milestone') milestone = true; if (low === 'crit') crit = true; continue; }
      if (/^after\s+/i.test(tk)) { task.after = tk.replace(/^after\s+/i, '').split(/\s+/).filter(Boolean); continue; }
      if (DATE.test(tk)) { task.start = tk; continue; }
      if (DUR.test(tk)) { task.duration = toDays(tk); continue; }
      if (!task.id && /^[A-Za-z][\w-]*$/.test(tk)) { task.id = tk; continue; }
    }
    if (!task.id) task.id = `t${(auto += 1)}`;
    if (milestone) task.milestone = true;
    if (crit) task.crit = true;
    if (!task.milestone && !(task.duration > 0)) task.duration = 1;
    if (!task.after.length) delete task.after;
    cur.tasks.push(task);
  }
  const total = plan.sections.reduce((s, x) => s + x.tasks.length, 0);
  if (!plan.sections.length || total === 0) return null;
  return plan;
}
