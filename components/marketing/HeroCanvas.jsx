'use client';

import { useRef, useEffect } from 'react';

/**
 * Hero canvas — animated process-flow diagram.
 *
 * Tells Sharpin's story visually:
 *   1. CHAOS   — a multi-lane business-process pipeline with bottleneck nodes
 *                pulsing amber, particles queueing up before blocked steps.
 *   2. SCAN    — a diagnostic sweep moves left → right, "discovering" the issues.
 *   3. FIX     — as the sweep passes each stuck node it resolves (amber → teal),
 *                particles accelerate through the freed path.
 *   4. CLEAN   — the whole pipeline runs fast and clear.
 *   Cycle repeats with fresh bottlenecks.
 */
export default function HeroCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    /* ── palette ──────────────────────────────────────────────────────── */
    const TEAL  = [45,  212, 191];
    const AMBER = [251, 191, 36];
    const GREEN = [52,  211, 153];
    const GOLD  = [201, 169, 110];

    const rgba  = ([r,g,b], a) => `rgba(${r},${g},${b},${a})`;
    const lerp3 = (a, b, t) => [
      a[0] + (b[0]-a[0])*t,
      a[1] + (b[1]-a[1])*t,
      a[2] + (b[2]-a[2])*t,
    ];

    /* ── process-step labels per lane ──────────────────────────────────── */
    const LABELS = [
      ['Receive', 'Review',   'Approve',  'Process',  'Deliver'],
      ['Request', 'Assess',   'Validate', 'Handoff',  'Output' ],
      ['Intake',  'Check',    'Escalate', 'Execute',  'Close'  ],
    ];

    /* ── state ─────────────────────────────────────────────────────────── */
    let nodes = [], edges = [], particles = [];
    let animId, lastTs = 0;
    // phases: 0=chaos  1=scan  2=fix  3=clean
    let phase = 0, phaseStart = 0;
    const PHASE_MS = [5200, 2800, 4500, 4000];
    let sweepX = -200; // diagnostic sweep line x-position

    /* ── build graph ───────────────────────────────────────────────────── */
    const init = () => {
      const W = canvas.width, H = canvas.height;
      const numLanes = W < 520 ? 2 : 3;
      const numSteps = W < 480 ? 4 : 5;

      nodes = []; edges = []; particles = [];

      // Vertical positions — use upper ~60 % so they're visible above gradient overlay
      const topY  = H * 0.04;
      const spanY = H * 0.50;
      const laneGap = numLanes > 1 ? spanY / (numLanes - 1) : 0;

      // Horizontal positions
      const leftX  = W * 0.10;
      const spanX  = W * 0.80;
      const stepGap = spanX / (numSteps - 1);

      for (let l = 0; l < numLanes; l++) {
        for (let s = 0; s < numSteps; s++) {
          // Slight jitter so it looks organic rather than a rigid grid
          const jx = (Math.random() - 0.5) * stepGap * 0.08;
          const jy = (Math.random() - 0.5) * laneGap * 0.18;
          const isMiddle = s > 0 && s < numSteps - 1;
          nodes.push({
            x:    leftX + s * stepGap + jx,
            y:    topY  + l * laneGap + jy,
            label: LABELS[l % 3][s],
            lane: l, step: s,
            r: 4,
            // stuck nodes exist in middle steps only
            stuck:       isMiddle && Math.random() < 0.48,
            fixProgress: 0,   // 0→1 while fixing
            phase:       Math.random() * Math.PI * 2, // pulse offset
          });
        }
      }

      // Sequential edges within each lane
      for (let l = 0; l < numLanes; l++) {
        for (let s = 0; s < numSteps - 1; s++) {
          edges.push({ a: l*numSteps + s, b: l*numSteps + s + 1 });
        }
      }

      // 1–2 subtle cross-lane edges for depth
      if (numLanes >= 2) edges.push({ a: 0*numSteps+2, b: 1*numSteps+3, cross: true });
      if (numLanes >= 3) edges.push({ a: 1*numSteps+1, b: 2*numSteps+2, cross: true });

      // Seed particles
      edges.forEach(e => {
        if (e.cross && Math.random() < 0.5) return; // fewer particles on cross edges
        const count = e.cross ? 1 : 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < count; k++) {
          particles.push({
            edge: e,
            t: Math.random(),
            baseSpeed: 0.008 + Math.random() * 0.006, // edge-traversal fraction per 60fps frame
          });
        }
      });
    };

    /* ── phase transition ──────────────────────────────────────────────── */
    const advance = (ts) => {
      phase = (phase + 1) % 4;
      phaseStart = ts;

      if (phase === 1) sweepX = canvas.width * -0.15;

      if (phase === 0) {
        // Re-introduce bottlenecks for the next cycle
        nodes.forEach(n => {
          if (n.step > 0 && n.step < (canvas.width < 480 ? 3 : 4)) {
            n.stuck       = Math.random() < 0.48;
            n.fixProgress = 0;
          }
        });
      }
    };

    /* ── draw loop ─────────────────────────────────────────────────────── */
    const draw = (ts) => {
      animId = requestAnimationFrame(draw);
      if (!lastTs) { lastTs = ts; phaseStart = ts; }
      const dt = Math.min(ts - lastTs, 50); // cap at 50 ms to avoid jump on tab-restore
      lastTs = ts;

      const elapsed  = ts - phaseStart;
      const progress = Math.min(elapsed / PHASE_MS[phase], 1);
      if (progress >= 1) advance(ts);

      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      /* --- update sweep (phase 1) & fix wave (phase 2) --- */
      if (phase === 1) {
        sweepX = W * -0.15 + (W * 1.3) * progress;
      }

      if (phase === 2) {
        // As sweep continues through phase 2, fix nodes it has passed
        sweepX = W * -0.15 + (W * 1.3) * progress;
        nodes.forEach(n => {
          if (n.stuck && n.x < sweepX) {
            n.fixProgress = Math.min(1, n.fixProgress + dt * 0.00045);
            if (n.fixProgress >= 1) n.stuck = false;
          }
        });
      }

      if (phase === 3) {
        // Ensure any lingering fixProgress finishes
        nodes.forEach(n => {
          if (n.fixProgress > 0 && n.fixProgress < 1)
            n.fixProgress = Math.min(1, n.fixProgress + dt * 0.001);
        });
      }

      /* --- draw edges --- */
      edges.forEach(e => {
        const a = nodes[e.a], b = nodes[e.b];
        if (!a || !b) return;
        const blocked = b.stuck && b.fixProgress < 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = blocked
          ? rgba(AMBER, e.cross ? 0.10 : 0.16)
          : rgba(TEAL,  e.cross ? 0.08 : 0.13);
        ctx.lineWidth = e.cross ? 0.6 : 0.9;
        ctx.setLineDash(e.cross ? [3,5] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      /* --- diagnostic sweep line (phases 1 & 2) --- */
      if ((phase === 1 || phase === 2) && sweepX > -50) {
        const g = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 20, 0);
        g.addColorStop(0, 'rgba(45,212,191,0)');
        g.addColorStop(0.65, 'rgba(45,212,191,0.07)');
        g.addColorStop(1, 'rgba(45,212,191,0.02)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.max(0, sweepX - 80), 0, 100, H);

        ctx.beginPath();
        ctx.moveTo(sweepX, 0);
        ctx.lineTo(sweepX, H);
        ctx.strokeStyle = rgba(TEAL, 0.28);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      /* --- draw particles --- */
      const tSec = ts * 0.001;
      particles.forEach(p => {
        const a = nodes[p.edge.a], b = nodes[p.edge.b];
        if (!a || !b) return;
        const blocked = b.stuck && b.fixProgress < 0.5;
        let sp = p.baseSpeed;
        if (blocked)    sp *= 0.08;             // back up before bottleneck
        else if (phase === 3) sp *= 2.4;        // fly through in clean phase

        p.t = (p.t + sp * dt / 16.67) % 1;

        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const col = blocked ? AMBER : TEAL;

        const grd = ctx.createRadialGradient(x, y, 0, x, y, 7);
        grd.addColorStop(0, rgba(col, 0.38));
        grd.addColorStop(1, rgba(col, 0));
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, 0.92);
        ctx.fill();
      });

      /* --- draw nodes --- */
      nodes.forEach(n => {
        const pulse  = 0.5 + 0.5 * Math.sin(tSec * 2.2 + n.phase);
        const isLast = n.step === (canvas.width < 480 ? 3 : 4);
        const fixing = n.fixProgress > 0 && n.fixProgress < 1;

        let col;
        if (n.stuck && n.fixProgress === 0) {
          col = AMBER;
        } else if (fixing) {
          col = lerp3(AMBER, TEAL, n.fixProgress);
        } else if (isLast) {
          col = GREEN;
        } else if (n.step === 0) {
          col = GOLD;
        } else {
          col = TEAL;
        }

        const isBottleneck = n.stuck && n.fixProgress < 0.5;
        const glowR = n.r * (isBottleneck ? 7 : 5);
        const glowA = isBottleneck ? 0.22 * pulse : (phase === 3 ? 0.14 : 0.10);

        // Outer glow
        const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
        grd.addColorStop(0, rgba(col, glowA));
        grd.addColorStop(1, rgba(col, 0));
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Outer ring (more visible for bottlenecks)
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, isBottleneck ? 0.35 * pulse : 0.22);
        ctx.lineWidth = 1;
        ctx.stroke();

        // Core
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, 0.88);
        ctx.fill();

        // Step label (only on wider viewports, very subtle)
        if (W > 620 && n.label) {
          ctx.font = `${W > 960 ? 10 : 9}px system-ui,sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = rgba(col, isBottleneck ? 0.55 : 0.28);
          ctx.fillText(n.label, n.x, n.y + n.r + 14);
        }
      });
    };

    /* ── boot ──────────────────────────────────────────────────────────── */
    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      init();
    };

    resize();
    animId = requestAnimationFrame(draw);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        opacity: 0.82,
      }}
    />
  );
}
