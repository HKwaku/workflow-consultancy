'use client';

/**
 * AreaChart — pure-SVG time-series chart.
 *
 * No chart library dependency. Smooth curve, gradient fill, hover dots
 * with tooltip, sparse axis labels.
 *
 * Props:
 *   data       — [{ key: string (ISO date), total: number, calls?: number }]
 *   formatVal  — function(n) -> string for tooltip + y-axis (default identity)
 *   height     — SVG height (default 220)
 *   accent     — primary stroke colour (default reads from CSS --accent)
 *
 * Renders nothing (or empty state) when data is empty.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

const PAD = { top: 18, right: 12, bottom: 28, left: 44 };

function smoothPath(points) {
  if (points.length < 2) return '';
  // Catmull–Rom → cubic Bezier for a smooth-but-not-overshooting curve.
  const path = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return path.join(' ');
}

function fmtAxisDate(iso) {
  if (typeof iso !== 'string') return '';
  // YYYY-MM-DD → "Apr 12"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AreaChart({
  data,
  formatVal = (n) => String(Math.round(n)),
  height = 220,
}) {
  const wrapRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [width, setWidth] = useState(800);

  // Track wrapper width for responsive layout.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth);
    };
    update();
    window.addEventListener('resize', update);
    // ResizeObserver catches container changes the window 'resize' event misses.
    let ro;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      ro = new ResizeObserver(update);
      ro.observe(wrapRef.current);
    }
    return () => {
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
    };
  }, []);

  const { points, max, yTicks } = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) {
      return { points: [], max: 0, yTicks: [] };
    }
    const innerW = Math.max(width - PAD.left - PAD.right, 100);
    const innerH = height - PAD.top - PAD.bottom;
    const max = Math.max(1, ...data.map((d) => d.total || 0));
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
    const points = data.map((d, i) => ({
      x: PAD.left + i * stepX,
      y: PAD.top + (1 - (d.total || 0) / max) * innerH,
      raw: d,
    }));
    // 4 y-ticks at 0, 25, 50, 75, 100% of max
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: max * t,
      y: PAD.top + (1 - t) * innerH,
    }));
    return { points, max, yTicks };
  }, [data, width, height]);

  if (!data || data.length === 0) {
    return <div className="byo-chart-empty">No usage in this window.</div>;
  }

  // Sparse x-axis: roughly every Nth label so they don't collide
  const xLabelEvery = Math.max(1, Math.ceil(data.length / 7));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  // Area path = line path + close to baseline.
  const linePath = smoothPath(points);
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${PAD.top + innerH} L ${points[0].x} ${PAD.top + innerH} Z`
    : '';

  // Snap hover to nearest point based on mouse x.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (points.length === 0) return;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - px);
      if (d < best) { best = d; nearest = i; }
    }
    setHoverIdx(nearest);
  };
  const onLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const tooltipLeft = hover ? Math.min(Math.max(hover.x - 60, 4), width - 124) : 0;
  const tooltipTop = hover ? Math.max(hover.y - 56, 4) : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        className="byo-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          <linearGradient id="byo-chart-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y grid + labels */}
        <g className="byo-chart-grid">
          {yTicks.map((t, i) => (
            <line key={i} x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} />
          ))}
        </g>
        <g className="byo-chart-axis">
          {yTicks.map((t, i) => (
            <text key={i} x={PAD.left - 8} y={t.y + 3} textAnchor="end">
              {formatVal(t.value)}
            </text>
          ))}
        </g>

        {/* Area + line */}
        {areaPath && <path className="byo-chart-area" d={areaPath} />}
        {linePath && <path className="byo-chart-line" d={linePath} />}

        {/* X axis labels (sparse) */}
        <g className="byo-chart-axis">
          {points.map((p, i) => (i % xLabelEvery === 0 || i === points.length - 1) ? (
            <text key={i} x={p.x} y={height - 8} textAnchor="middle">
              {fmtAxisDate(p.raw.key)}
            </text>
          ) : null)}
        </g>

        {/* Hover dot + crosshair */}
        {hover && (
          <g>
            <line
              x1={hover.x} x2={hover.x}
              y1={PAD.top} y2={height - PAD.bottom}
              stroke="var(--border-strong)"
              strokeDasharray="2 3"
            />
            <circle cx={hover.x} cy={hover.y} r="5" className="byo-chart-dot" style={{ opacity: 1 }} />
          </g>
        )}
      </svg>

      {hover && (
        <div className="byo-chart-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
          <div className="byo-chart-tooltip-when">{fmtAxisDate(hover.raw.key)}</div>
          <div className="byo-chart-tooltip-val">{formatVal(hover.raw.total || 0)} tokens</div>
          {hover.raw.calls != null && (
            <div style={{ color: 'var(--text-mid)', fontSize: 10 }}>{hover.raw.calls} calls</div>
          )}
        </div>
      )}
    </div>
  );
}
