'use client';

/**
 * GanttChart — an INTERACTIVE project-plan chart (not a rendered image).
 *
 * Modelled on WorkspaceGraph's interaction grammar:
 *   - every task/milestone is a real DOM node with hover + click
 *   - hovering (or pinning by click) a task highlights its full
 *     dependency lineage (predecessors + successors) and dims the rest
 *   - SVG connectors draw the dependency edges; edges on the focused
 *     lineage are emphasised
 *   - click empty space clears the pin
 *   - zoom controls change the day scale (timeline density)
 *
 * Input is the structured `gantt` artefact:
 *   { title, sections: [ { name, tasks: [
 *       { id, name, start? "YYYY-MM-DD", after? [ids], duration? days,
 *         milestone? bool, crit? bool } ] } ] }
 *
 * Scheduling: explicit `start` anchors; `after` tasks start at the
 * max end-date of their deps. Dates are calendar days (weekends not
 * excluded — the plan stays legible and durations are indicative).
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { parseMermaidGantt } from '@/lib/artefacts/mermaidGantt';

// Re-exported so existing consumers keep importing it from here.
export { parseMermaidGantt };

const LABEL_W = 240;
const AXIS_H  = 36;
const ROW_H   = 30;
const SEC_H   = 30;
const BAR_H   = 16;
const MIN_BARW = 6;
const PAD_DAYS = 2;

const DAY = 86400000;
function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function addDays(ms, n) { return ms + n * DAY; }
function dayDiff(a, b) { return Math.round((b - a) / DAY); }
function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function monthStartsBetween(min, max) {
  const out = [];
  const d = new Date(min);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  // first of the month at/after min
  let cur = Date.UTC(y, m, 1);
  if (cur < min) { m += 1; if (m > 11) { m = 0; y += 1; } cur = Date.UTC(y, m, 1); }
  while (cur <= max) {
    out.push(cur);
    m += 1; if (m > 11) { m = 0; y += 1; }
    cur = Date.UTC(y, m, 1);
  }
  return out;
}

// Resolve every task's start/end. Pure; returns flat task list + the
// min/max date span and section grouping.
function schedule(plan) {
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  const flat = [];
  sections.forEach((sec, si) => {
    (sec.tasks || []).forEach((t, ti) => {
      const after = Array.isArray(t.after) ? t.after : (t.after ? [t.after] : []);
      flat.push({
        ...t,
        after,
        sectionIdx: si,
        sectionName: sec.name,
        order: ti,
        milestone: !!t.milestone,
        duration: t.milestone ? 0 : Math.max(1, Number(t.duration) || 1),
      });
    });
  });
  const byId = new Map(flat.map((t) => [t.id, t]));

  const explicitStarts = flat.map((t) => parseYMD(t.start)).filter((v) => v != null);
  const projectStart = explicitStarts.length ? Math.min(...explicitStarts)
    : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  const startCache = new Map();
  const resolveStart = (t, seen = new Set()) => {
    if (startCache.has(t.id)) return startCache.get(t.id);
    if (seen.has(t.id)) return projectStart; // cycle guard
    seen.add(t.id);
    let s = parseYMD(t.start);
    if (s == null) {
      if (t.after.length) {
        let mx = projectStart;
        for (const dep of t.after) {
          const d = byId.get(dep);
          if (!d) continue;
          const ds = resolveStart(d, seen);
          const de = d.milestone ? ds : addDays(ds, d.duration);
          if (de > mx) mx = de;
        }
        s = mx;
      } else {
        s = projectStart;
      }
    }
    startCache.set(t.id, s);
    return s;
  };

  let minD = projectStart;
  let maxD = projectStart;
  for (const t of flat) {
    t.startMs = resolveStart(t);
    t.endMs = t.milestone ? t.startMs : addDays(t.startMs, t.duration);
    if (t.startMs < minD) minD = t.startMs;
    if (t.endMs > maxD) maxD = t.endMs;
  }
  minD = addDays(minD, -PAD_DAYS);
  maxD = addDays(maxD, PAD_DAYS);
  return { flat, byId, minD, maxD, totalDays: Math.max(1, dayDiff(minD, maxD)) };
}

// Undirected dependency closure so hovering a task lights its whole
// lineage (every predecessor AND successor), like the graph view's
// neighbour highlight but transitive.
function buildLineage(flat) {
  const preds = new Map();   // id -> Set(dep ids)
  const succs = new Map();   // id -> Set(dependent ids)
  for (const t of flat) {
    preds.set(t.id, new Set(t.after));
    for (const a of t.after) {
      if (!succs.has(a)) succs.set(a, new Set());
      succs.get(a).add(t.id);
    }
  }
  const closure = (id) => {
    const out = new Set([id]);
    const walk = (m, x) => {
      for (const n of (m.get(x) || [])) {
        if (!out.has(n)) { out.add(n); walk(m, n); }
      }
    };
    walk(preds, id);
    walk(succs, id);
    return out;
  };
  return { closure };
}

// Critical Path Method: forward pass is the resolved schedule
// (earliest start/finish honouring deps + anchors); this is the
// backward pass — a task is critical when it has zero float, i.e.
// any slip pushes the whole programme. Computed, not trusted from
// the model's `crit` hints, so the highlighted path is real.
function computeCritical(flat) {
  if (!flat.length) return new Set();
  const byId = new Map(flat.map((t) => [t.id, t]));
  const succ = new Map();
  for (const t of flat) {
    for (const a of t.after) {
      if (!byId.has(a)) continue;
      if (!succ.has(a)) succ.set(a, []);
      succ.get(a).push(t.id);
    }
  }
  const projFinish = Math.max(...flat.map((t) => t.endMs));
  const lf = new Map(flat.map((t) => [t.id, projFinish])); // latest finish
  for (let pass = 0; pass <= flat.length; pass += 1) {
    let changed = false;
    for (const t of flat) {
      const ss = succ.get(t.id);
      let val = projFinish;
      if (ss && ss.length) {
        val = Infinity;
        for (const sid of ss) {
          const s = byId.get(sid);
          const sDur = s.milestone ? 0 : s.duration * DAY;
          val = Math.min(val, lf.get(sid) - sDur);
        }
      }
      if (val !== lf.get(t.id)) { lf.set(t.id, val); changed = true; }
    }
    if (!changed) break;
  }
  const crit = new Set();
  for (const t of flat) {
    const dur = t.milestone ? 0 : t.duration * DAY;
    const latestStart = lf.get(t.id) - dur;
    if ((latestStart - t.startMs) / DAY <= 0.5) crit.add(t.id);
  }
  return crit;
}

// parseMermaidGantt moved to lib/artefacts/mermaidGantt.js (pure +
// unit-tested); imported and re-exported at the top of this file.

export default function GanttChart({ plan }) {
  const sched = useMemo(() => schedule(plan), [plan]);
  const { closure } = useMemo(() => buildLineage(sched.flat), [sched.flat]);
  const [pxPerDay, setPxPerDay] = useState(14);
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const scrollRef = useRef(null);

  const focus = pinned || hovered;
  const inFocus = useMemo(() => (focus ? closure(focus) : null), [focus, closure]);

  const criticalSet = useMemo(() => computeCritical(sched.flat), [sched.flat]);
  const anyDeps = useMemo(() => sched.flat.some((t) => t.after.length), [sched.flat]);
  // Computed critical path is authoritative; only fall back to the
  // model's crit hints when there are no dependencies to analyse.
  const isCrit = useCallback(
    (t) => (anyDeps ? criticalSet.has(t.id) : !!t.crit),
    [anyDeps, criticalSet],
  );

  const summary = useMemo(() => {
    const starts = sched.flat.map((t) => t.startMs);
    const ends = sched.flat.map((t) => t.endMs);
    const s = Math.min(...starts);
    const e = Math.max(...ends);
    return {
      start: s, end: e,
      weeks: Math.max(1, Math.round(dayDiff(s, e) / 7)),
      tasks: sched.flat.filter((t) => !t.milestone).length,
      milestones: sched.flat.filter((t) => t.milestone).length,
      critical: sched.flat.filter((t) => isCrit(t)).length,
    };
  }, [sched.flat, isCrit]);

  // "Today" marker (UTC midnight) when within the plan window.
  const todayMs = useMemo(() => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  }, []);

  // Fit the day scale to the viewport on first render / span change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientWidth - LABEL_W - 24;
    if (avail > 0 && sched.totalDays > 0) {
      const fit = avail / sched.totalDays;
      setPxPerDay(Math.max(4, Math.min(28, fit)));
    }
  }, [sched.totalDays]);

  // Build display rows: a section header then its tasks, in order.
  const rows = useMemo(() => {
    const r = [];
    const bySection = new Map();
    for (const t of sched.flat) {
      if (!bySection.has(t.sectionIdx)) bySection.set(t.sectionIdx, []);
      bySection.get(t.sectionIdx).push(t);
    }
    [...bySection.keys()].sort((a, b) => a - b).forEach((si) => {
      const tasks = bySection.get(si).sort((a, b) => a.order - b.order);
      r.push({ kind: 'section', name: tasks[0].sectionName, id: `sec_${si}` });
      for (const t of tasks) r.push({ kind: 'task', task: t, id: t.id });
    });
    return r;
  }, [sched.flat]);

  const rowTop = useCallback((idx) => {
    let y = AXIS_H;
    for (let i = 0; i < idx; i += 1) y += rows[i].kind === 'section' ? SEC_H : ROW_H;
    return y;
  }, [rows]);

  const totalHeight = AXIS_H + rows.reduce((s, r) => s + (r.kind === 'section' ? SEC_H : ROW_H), 0) + 8;
  const chartW = sched.totalDays * pxPerDay;
  const totalW = LABEL_W + chartW;
  const xFor = (ms) => LABEL_W + dayDiff(sched.minD, ms) * pxPerDay;

  const rowIndexById = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => { if (r.kind === 'task') m.set(r.id, i); });
    return m;
  }, [rows]);

  // Dependency edges: predecessor end → successor start.
  const edges = useMemo(() => {
    const es = [];
    for (const r of rows) {
      if (r.kind !== 'task') continue;
      const t = r.task;
      for (const dep of t.after) {
        const d = sched.byId.get(dep);
        if (!d) continue;
        const fi = rowIndexById.get(dep);
        const ti = rowIndexById.get(t.id);
        if (fi == null || ti == null) continue;
        es.push({ id: `${dep}->${t.id}`, fromId: dep, toId: t.id, fi, ti, d, t });
      }
    }
    return es;
  }, [rows, sched.byId, rowIndexById]);

  if (!sched.flat.length) {
    return <div className="ws-empty-inline" style={{ margin: 0 }}>Empty plan — no tasks to schedule.</div>;
  }

  const dim = (id) => inFocus && !inFocus.has(id);
  const edgeHot = (e) => focus && inFocus && inFocus.has(e.fromId) && inFocus.has(e.toId);

  return (
    <div className="ws-gantt">
      {/* One compact bar — the panel header already shows the title +
          summary, so don't repeat them here. */}
      <div className="ws-gantt-toolbar">
        <span className="ws-gantt-stats">
          {fmtDate(summary.start)} → {fmtDate(summary.end)} · ~{summary.weeks}w · {summary.tasks} tasks
          {summary.milestones ? ` · ${summary.milestones} milestones` : ''}
          {summary.critical ? ` · ${summary.critical} critical` : ''}
        </span>
        <div className="ws-gantt-legend">
          <span><i className="ws-gantt-sw ws-gantt-sw--task" /> Task</span>
          <span><i className="ws-gantt-sw ws-gantt-sw--crit" /> Critical</span>
          <span><i className="ws-gantt-sw ws-gantt-sw--ms" /> Milestone</span>
          <span className="ws-gantt-hint">hover to trace · click to pin</span>
        </div>
        <div className="ws-gantt-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" onClick={() => setPxPerDay((p) => Math.max(4, p / 1.3))} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setPxPerDay((p) => Math.min(40, p * 1.3))} aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="ws-gantt-scroll" ref={scrollRef}>
        <div
          className="ws-gantt-canvas"
          style={{ width: totalW, height: totalHeight }}
          onClick={(e) => { if (e.target === e.currentTarget) setPinned(null); }}
        >
          {/* Axis: month gridlines + labels */}
          <div className="ws-gantt-axis" style={{ height: AXIS_H, width: totalW }}>
            <div className="ws-gantt-axis-corner" style={{ width: LABEL_W }}>
              {plan?.title ? <span title={plan.title}>{plan.title}</span> : 'Plan'}
            </div>
          </div>
          {monthStartsBetween(sched.minD, sched.maxD).map((ms) => {
            const x = xFor(ms);
            return (
              <div key={ms}>
                <div className="ws-gantt-gridline" style={{ left: x, top: AXIS_H, height: totalHeight - AXIS_H }} />
                <div className="ws-gantt-monthlbl" style={{ left: x + 4, top: 8 }}>
                  {new Date(ms).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })}
                </div>
              </div>
            );
          })}

          {/* Today marker */}
          {todayMs >= sched.minD && todayMs <= sched.maxD && (
            <>
              <div className="ws-gantt-today" style={{ left: xFor(todayMs), top: AXIS_H, height: totalHeight - AXIS_H }} />
              <div className="ws-gantt-todaylbl" style={{ left: xFor(todayMs) + 3, top: AXIS_H - 14 }}>today</div>
            </>
          )}

          {/* SVG dependency connectors (behind bars) */}
          <svg className="ws-gantt-svg" width={totalW} height={totalHeight} aria-hidden>
            <defs>
              <marker id="ws-gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="ws-gantt-arrowhead" />
              </marker>
              <marker id="ws-gantt-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className="ws-gantt-arrowhead--hot" />
              </marker>
            </defs>
            {/* alternating month bands for readability */}
            {monthStartsBetween(sched.minD, sched.maxD).map((ms, i) => {
              if (i % 2 === 1) return null;
              const x = xFor(ms);
              const nextMs = addDays(ms, 31);
              const x2 = xFor(Math.min(nextMs, sched.maxD));
              return (
                <rect key={`band_${ms}`} x={x} y={AXIS_H} width={Math.max(0, x2 - x)} height={totalHeight - AXIS_H} className="ws-gantt-band" />
              );
            })}
            {edges.map((e) => {
              const x1 = xFor(e.d.milestone ? e.d.startMs : e.d.endMs);
              const y1 = rowTop(e.fi) + ROW_H / 2;
              const x2 = xFor(e.t.startMs);
              const y2 = rowTop(e.ti) + ROW_H / 2;
              const midX = Math.max(x1 + 12, (x1 + x2) / 2);
              const hot = edgeHot(e);
              const faded = focus && !hot;
              return (
                <path
                  key={e.id}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  className={`ws-gantt-edge${hot ? ' ws-gantt-edge--hot' : ''}${faded ? ' ws-gantt-edge--dim' : ''}`}
                  markerEnd={`url(#ws-gantt-arrow${hot ? '-hot' : ''})`}
                  fill="none"
                />
              );
            })}
          </svg>

          {/* Rows: labels (sticky left) + bars */}
          {rows.map((r, idx) => {
            const top = rowTop(idx);
            if (r.kind === 'section') {
              return (
                <div key={r.id} className="ws-gantt-secrow" style={{ top, height: SEC_H, width: totalW }}>
                  <div className="ws-gantt-seclabel" style={{ width: LABEL_W }}>{r.name}</div>
                </div>
              );
            }
            const t = r.task;
            const crit = isCrit(t);
            const isDim = dim(t.id);
            const isHot = focus && inFocus?.has(t.id);
            const left = xFor(t.startMs);
            const w = t.milestone ? 0 : Math.max(MIN_BARW, t.duration * pxPerDay);
            const tip = t.milestone
              ? `${t.name} — milestone ${fmtDate(t.startMs)}${crit ? ' · on critical path' : ''}${t.after.length ? ` · after ${t.after.join(', ')}` : ''}`
              : `${t.name} — ${fmtDate(t.startMs)} → ${fmtDate(t.endMs)} (${t.duration}d)${crit ? ' · on critical path' : ''}${t.after.length ? ` · after ${t.after.join(', ')}` : ''}`;
            const cls = [
              'ws-gantt-row',
              isDim ? 'ws-gantt-row--dim' : '',
              isHot ? 'ws-gantt-row--hot' : '',
            ].filter(Boolean).join(' ');
            return (
              <div key={r.id} className={cls} style={{ top, height: ROW_H, width: totalW }}>
                <div
                  className="ws-gantt-tasklabel"
                  style={{ width: LABEL_W }}
                  title={t.name}
                  onMouseEnter={() => setHovered(t.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(e) => { e.stopPropagation(); setPinned((p) => (p === t.id ? null : t.id)); }}
                >
                  {crit && <span className="ws-gantt-critdot" aria-hidden />}
                  {t.name}
                </div>
                {t.milestone ? (
                  <div
                    className="ws-gantt-ms"
                    style={{ left: left - 9, top: (ROW_H - 18) / 2 }}
                    title={tip}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={(e) => { e.stopPropagation(); setPinned((p) => (p === t.id ? null : t.id)); }}
                  >◆</div>
                ) : (
                  <div
                    className={`ws-gantt-bar${crit ? ' ws-gantt-bar--crit' : ''}`}
                    style={{ left, width: w, top: (ROW_H - BAR_H) / 2, height: BAR_H }}
                    title={tip}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={(e) => { e.stopPropagation(); setPinned((p) => (p === t.id ? null : t.id)); }}
                  >
                    <span className="ws-gantt-bar-name">{t.name}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
