const fs = require('fs');
const css = `
   /* ═══════════════════════════════════════════════════
      PORTAL CAROUSEL - light theme product preview slides
      ═══════════════════════════════════════════════════ */

   .portal-carousel {
     flex: 1; position: relative; overflow: hidden;
     min-height: 280px;
   }

   /* Slide shell */
   .portal-slide {
     position: absolute; inset: 0;
     display: flex; flex-direction: column;
     background: #ffffff;
     border: 1px solid rgba(0,0,0,0.09);
     border-radius: 8px;
     overflow: hidden;
     opacity: 0; transform: translateX(28px);
     transition: opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1);
     pointer-events: none;
   }
   .portal-slide.active  { opacity: 1; transform: translateX(0); pointer-events: auto; }
   .portal-slide.exiting { opacity: 0; transform: translateX(-28px); transition-duration: 0.4s; }

   /* Window chrome bar */
   .ps-bar {
     display: flex; align-items: center; gap: 5px;
     padding: 7px 10px;
     background: #f1f5f9;
     border-bottom: 1px solid rgba(0,0,0,0.07);
     flex-shrink: 0;
   }
   .ps-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
   .ps-dot.r { background: #ff5f57; }
   .ps-dot.y { background: #febc2e; }
   .ps-dot.g { background: #28c840; }
   .ps-bar-title {
     font-size: 0.58rem; color: #94a3b8;
     letter-spacing: 0.2px; margin-left: 5px; flex: 1;
     white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
   }
   .ps-bar-grade {
     font-size: 0.62rem; font-weight: 700; color: #0d9488;
     background: rgba(13,148,136,0.1); border: 1px solid rgba(13,148,136,0.25);
     border-radius: 4px; padding: 1px 6px; flex-shrink: 0;
   }
   .ps-bar-chip {
     font-size: 0.52rem; color: #94a3b8;
     background: rgba(0,0,0,0.05); border-radius: 3px;
     padding: 1px 5px; flex-shrink: 0;
   }

   /* Slide body */
   .ps-body {
     flex: 1; display: flex; flex-direction: column;
     padding: 10px 10px 10px; gap: 8px; overflow: hidden;
   }

   /* ────────────────────
      SLIDE 1 - DIAGNOSTIC
      ──────────────────── */

   .ps-d-top { display: flex; align-items: center; gap: 10px; }

   .ps-ring-wrap { position: relative; flex-shrink: 0; }
   .ps-ring-label {
     position: absolute; inset: 0;
     display: flex; flex-direction: column; align-items: center; justify-content: center;
     font-size: 0.72rem; font-weight: 700; color: #0d9488; line-height: 1;
   }
   .ps-ring-label span { font-size: 0.42rem; color: #94a3b8; font-weight: 400; margin-top: 2px; }

   .ps-kpis { display: flex; gap: 5px; flex: 1; }
   .ps-kpi {
     flex: 1; background: #f8fafc; border: 1px solid #e2e8f0;
     border-radius: 6px; padding: 7px 5px; text-align: center;
   }
   .ps-kpi-v { font-size: 0.95rem; font-weight: 700; color: #0f172a; display: block; line-height: 1; }
   .ps-kpi-l { font-size: 0.44rem; color: #94a3b8; display: block; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
   .ps-kpi--warn .ps-kpi-v { color: #d97706; }

   .ps-proc-list { display: flex; flex-direction: column; gap: 0; flex: 1; }
   .ps-proc {
     display: grid; grid-template-columns: 7px 1fr 56px 24px;
     align-items: center; gap: 7px;
     padding: 6px 0; border-bottom: 1px solid #f1f5f9;
   }
   .ps-proc:last-child { border-bottom: none; }
   .ps-proc-dot  { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
   .ps-proc-name { font-size: 0.6rem; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
   .ps-proc-bar  { height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
   .ps-proc-fill { height: 100%; border-radius: 3px; }
   .ps-proc-pct  { font-size: 0.52rem; color: #94a3b8; text-align: right; }

   .ps-d-footer {
     display: flex; align-items: center; justify-content: space-between;
     padding-top: 7px; border-top: 1px solid #e2e8f0; flex-shrink: 0;
   }
   .ps-d-total { font-size: 0.58rem; color: #64748b; }
   .ps-d-opp   { font-size: 0.58rem; color: #0d9488; font-weight: 600; }

   /* ──────────────────────
      SLIDE 2 - FLOW CANVAS
      ────────────────────── */

   .ps-body--canvas {
     padding: 0; gap: 0; background: #f1f5f9; position: relative;
   }

   /* Swimlane strip headers */
   .ps-lanes-bg {
     position: absolute; inset: 0; pointer-events: none;
     display: flex; flex-direction: column;
   }
   .ps-lane-stripe {
     flex: 1; display: flex; align-items: stretch;
     border-bottom: 1px solid #e2e8f0;
   }
   .ps-lane-stripe:last-child { border-bottom: none; }
   .ps-lane-hdr {
     width: 48px; flex-shrink: 0;
     background: #e8edf2; border-right: 1px solid #e2e8f0;
     display: flex; align-items: center; justify-content: center;
     writing-mode: horizontal-tb; padding: 0 4px;
   }
   .ps-lane-hdr span {
     font-size: 0.5rem; color: #94a3b8; font-weight: 600;
     text-transform: uppercase; letter-spacing: 0.5px;
   }
   .ps-lane-body-bg { flex: 1; }
   .ps-lane-stripe--finance   .ps-lane-body-bg { background: rgba(13,148,136,0.03); }
   .ps-lane-stripe--approval  .ps-lane-body-bg { background: rgba(59,130,246,0.03); }
   .ps-lane-stripe--ops       .ps-lane-body-bg { background: rgba(245,158,11,0.03); }

   /* Flow grid - overlaid on swimlane bg */
   .ps-flow-grid {
     position: absolute; inset: 0;
     display: grid;
     grid-template-areas:
       "lbl1 a  ar1 d  ar2 c  ."
       "lbl2 .  .   v  .   .  ."
       "lbl2 .  .   e  .   .  .";
     grid-template-columns: 48px 1fr 12px 44px 12px 1fr 1fr;
     grid-template-rows: 1fr 20px 1fr;
     align-content: center;
     padding: 0;
   }

   /* Lane label cells */
   .ps-lane-lbl {
     grid-column: 1; display: flex; align-items: center; justify-content: center;
     font-size: 0.48rem; color: #94a3b8; font-weight: 600;
     text-transform: uppercase; letter-spacing: 0.5px;
     border-right: 1px solid #e2e8f0;
   }
   .ps-lane-lbl-1 { grid-area: lbl1; grid-row: 1; border-bottom: 1px solid #e2e8f0; }
   .ps-lane-lbl-2 { grid-area: lbl2; grid-row: 2 / 4; }

   /* Step nodes */
   .ps-fn {
     background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 7px;
     min-height: 46px; display: flex; align-items: stretch;
     position: relative; overflow: hidden; margin: 8px 4px;
   }
   .ps-fn--bot { border-color: #ef4444; }
   .ps-fn-bar  { width: 3.5px; background: var(--fc,#0d9488); border-radius: 7px 0 0 7px; flex-shrink: 0; }
   .ps-fn-ghost {
     position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
     font-size: 1.6rem; font-weight: 800; color: rgba(8,145,178,0.2);
     pointer-events: none; letter-spacing: -1px;
   }
   .ps-fn-meta {
     flex: 1; padding: 5px 5px 5px 7px; display: flex; flex-direction: column;
     justify-content: center; position: relative; z-index: 1; min-width: 0;
   }
   .ps-fn-num  { font-size: 0.42rem; color: #94a3b8; font-weight: 700; line-height: 1; }
   .ps-fn-lbl  { font-size: 0.57rem; color: #0f172a; font-weight: 600; line-height: 1.3; }
   .ps-fn-dept { font-size: 0.42rem; color: #94a3b8; line-height: 1; margin-top: 1px; }
   .ps-fn-check { position: absolute; right: 5px; top: 5px; font-size: 0.5rem; color: #16a34a; }
   .ps-fn-warn  { position: absolute; right: 5px; top: 5px; font-size: 0.55rem; color: #d97706; }

   /* Decision diamond */
   .ps-dm {
     grid-area: d; width: 44px; height: 44px;
     display: flex; align-items: center; justify-content: center;
     justify-self: center; align-self: center;
   }
   .ps-dm-in {
     width: 100%; height: 100%;
     background: #ffffff; border: 1.5px solid #94a3b8; border-radius: 5px;
     transform: rotate(45deg);
     display: flex; flex-direction: column; align-items: center; justify-content: center;
   }
   .ps-dm-num { transform: rotate(-45deg); font-size: 0.38rem; color: #94a3b8; font-weight: 700; line-height: 1; }
   .ps-dm-lbl { transform: rotate(-45deg); font-size: 0.42rem; color: #475569; text-align: center; line-height: 1.2; white-space: nowrap; font-weight: 600; }

   /* Horizontal edge arrow */
   .ps-eh { height: 1.5px; background: #cbd5e1; position: relative; align-self: center; }
   .ps-eh::after {
     content: ''; position: absolute; right: -1px; top: -3.5px;
     border: 4px solid transparent; border-left: 5px solid #cbd5e1;
   }
   .ps-eh--yes::before {
     content: 'Yes'; position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
     font-size: 0.4rem; color: #94a3b8;
   }

   /* Vertical edge (No branch) */
   .ps-ev {
     grid-area: v; justify-self: center; width: 1.5px; height: 100%;
     background: #cbd5e1; position: relative;
   }
   .ps-ev::after {
     content: ''; position: absolute; bottom: -1px; left: -3.5px;
     border: 4px solid transparent; border-top: 5px solid #cbd5e1;
   }
   .ps-ev-lbl {
     position: absolute; left: 4px; top: 50%; transform: translateY(-50%);
     font-size: 0.4rem; color: #94a3b8; white-space: nowrap;
   }

   /* Canvas footer */
   .ps-canvas-footer {
     position: absolute; bottom: 0; left: 0; right: 0;
     display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
     padding: 5px 10px; background: rgba(255,255,255,0.9);
     border-top: 1px solid #e2e8f0; font-size: 0.5rem;
   }
   .ps-cf-dept { display: flex; align-items: center; gap: 3px; color: #64748b; }
   .ps-cf-dept::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dc,#888); display: inline-block; }
   .ps-cf-dept--warn { color: #d97706; }
   .ps-cf-div  { flex: 1; }
   .ps-cf-warn { color: #d97706; font-size: 0.48rem; }

   /* ──────────────────────────
      SLIDE 3 - COST ANALYSIS
      ────────────────────────── */

   .ps-cost-head  { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; flex-shrink: 0; }
   .ps-cost-true  { display: flex; flex-direction: column; }
   .ps-cost-val   { font-size: 1.4rem; font-weight: 700; color: #0f172a; letter-spacing: -0.5px; line-height: 1; }
   .ps-cost-lbl   { font-size: 0.5rem; color: #94a3b8; margin-top: 3px; }
   .ps-cost-chips { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }
   .ps-chip        { font-size: 0.5rem; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
   .ps-chip--warn  { background: rgba(217,119,6,0.1); color: #d97706; border: 1px solid rgba(217,119,6,0.2); }
   .ps-chip--muted { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }

   .ps-sc-tabs { display: flex; border: 1px solid #e2e8f0; border-radius: 7px; overflow: hidden; flex-shrink: 0; }
   .ps-sc-tab  { flex: 1; text-align: center; padding: 5px 0; font-size: 0.52rem; color: #94a3b8; border-right: 1px solid #e2e8f0; }
   .ps-sc-tab:last-child { border-right: none; }
   .ps-sc-tab--active { background: rgba(13,148,136,0.08); color: #0d9488; font-weight: 600; }

   .ps-sc-body    { display: flex; flex-direction: column; gap: 6px; flex: 1; }
   .ps-sc-saving  { display: flex; flex-direction: column; }
   .ps-sc-amt     { font-size: 1.15rem; font-weight: 700; color: #0d9488; letter-spacing: -0.5px; line-height: 1; }
   .ps-sc-sub     { font-size: 0.5rem; color: #64748b; margin-top: 2px; }
   .ps-sc-bar-wrap  { display: flex; flex-direction: column; gap: 4px; }
   .ps-sc-bar-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
   .ps-sc-bar-fill  { height: 100%; border-radius: 3px; background: #0d9488; }
   .ps-sc-bar-label { font-size: 0.46rem; color: #94a3b8; }

   .ps-roi-row { display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
   .ps-roi-m   { text-align: center; flex: 1; }
   .ps-roi-m + .ps-roi-m { border-left: 1px solid #e2e8f0; }
   .ps-roi-v   { font-size: 0.9rem; font-weight: 700; color: #0d9488; display: block; line-height: 1; }
   .ps-roi-l   { font-size: 0.44rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 3px; display: block; }

   /* Carousel indicator dots */
   .ps-dots { position: absolute; bottom: 7px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; align-items: center; z-index: 10; }
   .ps-dot-ind { width: 5px; height: 5px; border-radius: 50%; background: rgba(0,0,0,0.15); transition: background 0.3s, transform 0.3s; }
   .ps-dot-ind--active { background: #0d9488; transform: scale(1.3); }
`;
fs.appendFileSync('C:/workflow/workflow-consultancy/app/marketing.css', css, 'utf8');
console.log('Done');
