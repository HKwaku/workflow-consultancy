'use client';

/**
 * WorkspaceOutputsTab - the "Outputs" scope, to the right of
 * Analytics. This is the workspace's version of the right-hand
 * artefacts panel in a Claude chat: generated content the assistant
 * produces during interaction that has no home in the app schema.
 *
 * (Distinct from the chat rail's "Artefacts" panel, which is an
 * ephemeral, per-session list of flow snapshots / report / cost
 * pointers. This panel is persistent and model-wide. The two are
 * intentionally kept separate; this one is named "Outputs" so the
 * label doesn't collide with the rail.)
 *
 * Everywhere else the workspace enforces a schema (functions,
 * processes, roles, systems). When the agent needs to produce
 * something that has no home in that schema - a comparison table, a
 * draft policy, an exec summary, a SQL query, a JSON dataset, a
 * mermaid diagram - it calls the emit_artefact tool. The output is
 * saved server side and surfaces here, live, as the user interacts.
 *
 * Self-contained: resolves the model id from /api/me/operating-model
 * when one isn't passed, and listens for `vesno:artefact-created`
 * (dispatched by DiagnosticWorkspace when the chat stream emits an
 * `artefact` event - internal event name kept as-is) so new outputs
 * appear without a refresh.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useAuth } from '@/lib/useAuth';
import { apiFetch, invalidateApiCache } from '@/lib/api-fetch';
import GanttChart, { parseMermaidGantt } from '@/components/workspace/GanttChart';

const REMARK = [remarkGfm];
const REHYPE = [rehypeHighlight];

const TYPE_LABEL = {
  markdown: 'Doc', code: 'Code', table: 'Table', json: 'JSON',
  csv: 'CSV', html: 'HTML', mermaid: 'Diagram', gantt: 'Plan', text: 'Text', svg: 'SVG',
  pptx: 'Slides', docx: 'Word', xlsx: 'Excel',
};
const OFFICE_TYPES = new Set(['pptx', 'docx', 'xlsx']);

function relTime(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Best-effort CSV → rows[] (handles quoted cells, commas, newlines). */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

function DataTable({ columns, rows }) {
  return (
    <div className="ws-out-tablewrap">
      <table className="ws-out-table">
        <thead>
          <tr>{columns.map((c, i) => <th key={i}>{String(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => <td key={ci}>{r[ci] == null ? '' : String(r[ci])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// mermaid is heavy + browser-only — dynamic-import it so it never
// touches the SSR/main bundle and only loads when a diagram is viewed.
// The diagram is interactive: wheel to zoom at the cursor, drag to
// pan, plus zoom / fit / reset controls.
const Z_MIN = 0.2;
const Z_MAX = 5;

function MermaidView({ code }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const tf = useRef({ scale: 1, x: 0, y: 0 });   // live transform (avoids stale closures)
  const drag = useRef(null);
  const [err, setErr] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const [pct, setPct] = useState(100);           // for the control readout

  const apply = useCallback(() => {
    const { scale, x, y } = tf.current;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    setPct(Math.round(scale * 100));
  }, []);

  const setTransform = useCallback((next) => {
    const s = Math.min(Z_MAX, Math.max(Z_MIN, next.scale ?? tf.current.scale));
    tf.current = {
      scale: s,
      x: next.x ?? tf.current.x,
      y: next.y ?? tf.current.y,
    };
    apply();
  }, [apply]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const svg = contentRef.current?.querySelector('svg');
    if (!vp || !svg) return;
    const vpW = vp.clientWidth - 24;
    const cW = svg.getBoundingClientRect().width / (tf.current.scale || 1);
    const scale = cW > 0 ? Math.min(1, vpW / cW) : 1;
    setTransform({ scale, x: 12, y: 12 });
  }, [setTransform]);

  // Render the diagram.
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          themeVariables: { fontSize: '15px' },
          gantt: {
            fontSize: 14, barHeight: 26, barGap: 6, topPadding: 50,
            leftPadding: 220, gridLineStartPadding: 40, useWidth: 1400,
          },
          flowchart: { useMaxWidth: false, htmlLabels: true, padding: 16 },
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled || !contentRef.current) return;
        // Strip mermaid's inline max-width so the SVG keeps its natural
        // size — our own transform handles scaling now.
        contentRef.current.innerHTML = svg.replace(/max-width:\s*[\d.]+px;?/g, '');
        const el = contentRef.current.querySelector('svg');
        if (el) { el.style.maxWidth = 'none'; el.style.height = 'auto'; }
        tf.current = { scale: 1, x: 12, y: 12 };
        apply();
        requestAnimationFrame(() => { if (!cancelled) fit(); });
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not render this diagram');
      }
    })();
    return () => { cancelled = true; };
  }, [code, apply, fit]);

  // Wheel-zoom anchored at the cursor. Native listener so we can
  // preventDefault (React's onWheel is passive and can't).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { scale, x, y } = tf.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = Math.min(Z_MAX, Math.max(Z_MIN, scale * factor));
      // Keep the point under the cursor fixed.
      const nx = px - ((px - x) * (ns / scale));
      const ny = py - ((py - y) * (ns / scale));
      setTransform({ scale: ns, x: nx, y: ny });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [setTransform]);

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: tf.current.x, oy: tf.current.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setTransform({
      x: drag.current.ox + (e.clientX - drag.current.sx),
      y: drag.current.oy + (e.clientY - drag.current.sy),
    });
  };
  const endDrag = (e) => {
    drag.current = null;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
  };
  const zoomBy = (f) => setTransform({ scale: tf.current.scale * f });

  if (err) {
    return (
      <div>
        <div className="ws-error" style={{ fontSize: 12, marginBottom: 8 }}>
          Diagram didn&apos;t render ({err}). Showing source:
        </div>
        <pre className="ws-out-pre">{code}</pre>
      </div>
    );
  }
  return (
    <div className="ws-out-diagramwrap">
      <div className="ws-out-diagram-bar">
        <div className="ws-out-zoomctl" role="group" aria-label="Diagram zoom">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <span className="ws-out-zoompct">{pct}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
          <button type="button" onClick={fit} title="Fit to width">Fit</button>
          <button type="button" onClick={() => setTransform({ scale: 1, x: 12, y: 12 })} title="Actual size">1:1</button>
        </div>
        <button type="button" className="ws-out-srcbtn" onClick={() => setShowSource((s) => !s)}>
          {showSource ? 'Show diagram' : 'Show source'}
        </button>
      </div>
      <div
        className="ws-out-diagram-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ display: showSource ? 'none' : 'block' }}
      >
        <div className="ws-out-diagram-content" ref={contentRef} />
      </div>
      {showSource && <pre className="ws-out-pre">{code}</pre>}
    </div>
  );
}

function ArtefactBody({ artefact, modelId }) {
  const { type, content, language } = artefact;
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  if (OFFICE_TYPES.has(type)) {
    const f = artefact.meta?.file;
    // Only a file with a real stored path is downloadable. If the
    // binary build/upload didn't complete, meta.file is absent or just
    // { pending:true } — DO NOT link to /file (it would 404 a JSON body
    // that the browser saves as ".pptx"). Show an honest failure state.
    const hasBinary = !!(f && f.path);
    const buildStatus = artefact.meta?.build?.status; // 'building' | 'failed' | 'ready'
    const isBuilding = !hasBinary && buildStatus === 'building';
    const href = (hasBinary && modelId) ? `/api/operating-models/${modelId}/artefacts/${artefact.id}/file` : null;
    const kb = f?.bytes ? Math.max(1, Math.round(f.bytes / 1024)) : null;
    return (
      <div className="ws-out-filecard">
        <div className="ws-out-fileicon" aria-hidden>{(TYPE_LABEL[type] || type).toUpperCase()}</div>
        <div className="ws-out-filemeta">
          <div className="ws-out-filename">{f?.filename || `${artefact.title || 'artefact'}.${type}`}</div>
          <div className="ws-out-filesub">
            {TYPE_LABEL[type] || type} document{kb ? ` · ${kb} KB` : ''}
            {artefact.meta?.summary ? ` · ${artefact.meta.summary}` : ''}
          </div>
          {hasBinary && (
            <a className="ws-cta" href={href} target="_blank" rel="noopener noreferrer" download>Download</a>
          )}
          {isBuilding && (
            <div className="ws-out-filesub" style={{ color: 'var(--accent, #0d9488)' }}>
              Building your {(TYPE_LABEL[type] || type)}… this can take a minute. It becomes
              downloadable here automatically — no need to wait or re-ask.
            </div>
          )}
          {!hasBinary && !isBuilding && (
            <div className="ws-out-filesub" style={{ color: '#dc2626' }}>
              The {(TYPE_LABEL[type] || type)} file didn&apos;t finish building, so there is nothing to download.
              Ask the assistant to regenerate it (a tighter, more compact brief helps).
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === 'markdown') {
    return (
      <div className="s7-md ws-out-md">
        <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE}>{text}</ReactMarkdown>
      </div>
    );
  }

  if (type === 'code') {
    // Reuse the markdown code path so highlight.js styles apply.
    const fenced = `\`\`\`${language || ''}\n${text}\n\`\`\``;
    return (
      <div className="s7-md ws-out-md">
        <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE}>{fenced}</ReactMarkdown>
      </div>
    );
  }

  if (type === 'json') {
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show raw */ }
    return <pre className="ws-out-pre">{pretty}</pre>;
  }

  if (type === 'table') {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data) && data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
        const columns = [...new Set(data.flatMap((o) => Object.keys(o)))];
        return <DataTable columns={columns} rows={data.map((o) => columns.map((c) => o[c]))} />;
      }
      if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) {
        return <DataTable columns={data.columns} rows={data.rows} />;
      }
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return <DataTable columns={data[0]} rows={data.slice(1)} />;
      }
    } catch { /* fall through */ }
    return <pre className="ws-out-pre">{text}</pre>;
  }

  if (type === 'csv') {
    const rows = parseCsv(text);
    if (rows.length) return <DataTable columns={rows[0]} rows={rows.slice(1)} />;
    return <pre className="ws-out-pre">{text}</pre>;
  }

  if (type === 'html' || type === 'svg') {
    // Sandboxed, no scripts: render generated markup without giving it
    // access to the app (no allow-scripts / allow-same-origin).
    return (
      <iframe
        className="ws-out-frame"
        title={artefact.title || 'artefact'}
        sandbox=""
        srcDoc={text}
      />
    );
  }

  if (type === 'gantt') {
    let plan = null;
    try { plan = JSON.parse(text); } catch { /* fall through */ }
    if (plan && Array.isArray(plan.sections)) return <GanttChart plan={plan} />;
    return <pre className="ws-out-pre">{text}</pre>;
  }

  if (type === 'mermaid') {
    // Legacy gantts were stored as mermaid source — parse them into
    // the structured plan so they render interactively too. Other
    // mermaid diagrams (flowcharts, etc.) keep the diagram view.
    const ganttPlan = parseMermaidGantt(text);
    if (ganttPlan) return <GanttChart plan={ganttPlan} />;
    return <MermaidView code={text} />;
  }

  // text / unknown → show the source verbatim.
  return <pre className="ws-out-pre">{text}</pre>;
}

export default function WorkspaceOutputsTab({ modelId: modelIdProp = null, accessToken: tokenProp = null }) {
  const { accessToken: authToken } = useAuth();
  const accessToken = tokenProp || authToken;

  const [modelId, setModelId]     = useState(modelIdProp);
  const [resolving, setResolving] = useState(!modelIdProp);
  const [artefacts, setArtefacts] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError]         = useState(null);
  const selectRef = useRef(null);
  selectRef.current = selectedId;
  const listRef = useRef(null);
  // A rail-slider click can ask this tab to open a specific artefact.
  // It may arrive before the list has loaded (the tab is mounting from
  // the same click), so we stash the id and apply it once it's present.
  const pendingSelectRef = useRef(
    (typeof window !== 'undefined' && window.__vesnoPendingOutputArtefact) || null,
  );

  // Resolve the org's default model when one wasn't handed down.
  useEffect(() => {
    if (modelIdProp) { setModelId(modelIdProp); setResolving(false); return undefined; }
    if (!accessToken) { setResolving(false); return undefined; }
    let cancelled = false;
    setResolving(true);
    apiFetch('/api/me/operating-model', {}, accessToken)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`me/operating-model ${r.status}`))))
      .then((d) => { if (!cancelled) setModelId(d?.modelId || null); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [modelIdProp, accessToken]);

  const listUrl = modelId ? `/api/operating-models/${modelId}/artefacts` : null;

  const load = useCallback(async ({ selectNewest = false } = {}) => {
    if (!listUrl || !accessToken) return;
    try {
      const r = await apiFetch(listUrl, { dedupe: false }, accessToken);
      if (!r.ok) throw new Error(`artefacts ${r.status}`);
      const d = await r.json();
      const list = Array.isArray(d.artefacts) ? d.artefacts : [];
      setArtefacts(list);
      listRef.current = list;
      if (!list.length) return;
      const pending = pendingSelectRef.current;
      if (pending && list.some((a) => a.id === pending)) {
        // An explicit "open this one" request (rail slider) wins over
        // both the current selection and select-newest.
        setSelectedId(pending);
        pendingSelectRef.current = null;
        if (typeof window !== 'undefined') window.__vesnoPendingOutputArtefact = null;
      } else if (selectNewest || !selectRef.current || !list.some((a) => a.id === selectRef.current)) {
        setSelectedId(list[0].id);
      }
    } catch (e) { setError(e.message); }
  }, [listUrl, accessToken]);

  useEffect(() => { if (listUrl) load(); }, [listUrl, load]);

  // Live: the chat stream emitted an artefact -> refetch + select it.
  useEffect(() => {
    if (!listUrl) return undefined;
    const onCreated = () => {
      if (listUrl) invalidateApiCache(listUrl, accessToken);
      load({ selectNewest: true });
    };
    window.addEventListener('vesno:artefact-created', onCreated);
    return () => window.removeEventListener('vesno:artefact-created', onCreated);
  }, [listUrl, accessToken, load]);

  // Office artefacts build async (Inngest). While any row is still
  // "building", poll so the finished file appears on its own — the
  // user never has to re-ask or refresh. Stops as soon as none are.
  const anyBuilding = (artefacts || []).some(
    (a) => a?.meta?.build?.status === 'building' && !(a?.meta?.file?.path),
  );
  useEffect(() => {
    if (!listUrl || !anyBuilding) return undefined;
    const t = setInterval(() => {
      invalidateApiCache(listUrl, accessToken);
      load();
    }, 9000);
    return () => clearInterval(t);
  }, [listUrl, accessToken, anyBuilding, load]);

  // The rail "Artefacts" slider lists every artefact and routes the
  // selected one here. If it's already in the loaded list, select it
  // immediately; otherwise stash + refetch (covers a just-created one).
  useEffect(() => {
    const onOpen = (e) => {
      const id = e?.detail?.id;
      if (!id) return;
      const cur = listRef.current;
      if (cur && cur.some((a) => a.id === id)) {
        setSelectedId(id);
        pendingSelectRef.current = null;
        if (typeof window !== 'undefined') window.__vesnoPendingOutputArtefact = null;
      } else {
        pendingSelectRef.current = id;
        if (listUrl) invalidateApiCache(listUrl, accessToken);
        load();
      }
    };
    window.addEventListener('vesno:open-output-artefact', onOpen);
    return () => window.removeEventListener('vesno:open-output-artefact', onOpen);
  }, [listUrl, accessToken, load]);

  const remove = useCallback(async (id) => {
    if (!modelId) return;
    setArtefacts((prev) => (prev || []).filter((a) => a.id !== id));
    if (selectRef.current === id) setSelectedId(null);
    try {
      await apiFetch(`/api/operating-models/${modelId}/artefacts/${id}`, { method: 'DELETE' }, accessToken);
      if (listUrl) invalidateApiCache(listUrl, accessToken);
    } catch { load(); }
  }, [modelId, accessToken, listUrl, load]);

  const selected = useMemo(
    () => (artefacts || []).find((a) => a.id === selectedId) || null,
    [artefacts, selectedId],
  );

  // Version lineage. A revision carries meta.supersedes = the id it
  // replaces; we derive chains so the list shows only the latest of
  // each (with a vN badge) and the viewer offers a version switcher.
  const lineage = useMemo(() => {
    const arr = artefacts || [];
    const byId = new Map(arr.map((a) => [a.id, a]));
    const supersededIds = new Set(
      arr.map((a) => a.meta?.supersedes).filter((p) => p && byId.has(p)),
    );
    const tips = arr.filter((a) => !supersededIds.has(a.id)); // nobody replaces these
    const versionsByTip = new Map();
    const tipOfId = new Map();
    for (const tip of tips) {
      const chain = [];
      const seen = new Set();
      let cur = tip;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        chain.push(cur);
        const par = cur.meta?.supersedes;
        cur = par && byId.has(par) ? byId.get(par) : null;
      }
      chain.reverse(); // oldest → newest
      versionsByTip.set(tip.id, chain);
      for (const c of chain) tipOfId.set(c.id, tip.id);
    }
    return { tips, versionsByTip, tipOfId };
  }, [artefacts]);

  const selectedTipId = (selectedId && lineage.tipOfId.get(selectedId)) || selectedId;
  const selectedVersions = lineage.versionsByTip.get(selectedTipId)
    || (selected ? [selected] : []);
  const selectedVersionIdx = selectedVersions.findIndex((v) => v.id === selectedId);
  const isOldVersion = selectedVersions.length > 1
    && selectedVersionIdx !== selectedVersions.length - 1;

  const copy = () => {
    if (selected && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(selected.content || '').catch(() => {});
    }
  };
  const isOffice = !!(selected && OFFICE_TYPES.has(selected.type));
  const officeReady = !!(isOffice && selected.meta?.file?.path);
  const fileUrl = (officeReady && modelId)
    ? `/api/operating-models/${modelId}/artefacts/${selected.id}/file`
    : null;
  const download = () => {
    if (!selected || typeof document === 'undefined') return;
    if (fileUrl) { window.open(fileUrl, '_blank', 'noopener'); return; }
    // Never dump an office artefact's text/JSON `content` as a ".pptx":
    // the binary just isn't there. The body already explains this.
    if (isOffice) return;
    const ext = ({ markdown: 'md', code: selected.language || 'txt', json: 'json', csv: 'csv', html: 'html', svg: 'svg', mermaid: 'mmd', gantt: 'json' }[selected.type]) || 'txt';
    const blob = new Blob([selected.content || ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(selected.title || 'output').replace(/[^\w.-]+/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── Render gates ───────────────────────────────────────────── */
  if (resolving) return <section className="ws-pane ws-empty">Loading outputs…</section>;
  if (!modelId) {
    return (
      <section className="ws-pane ws-empty">
        <h1>Outputs</h1>
        <p>This panel is scoped to your operating model. Join or create an org with a default model to collect outputs.</p>
      </section>
    );
  }

  const list = artefacts || [];

  return (
    <section className="ws-pane ws-out-tab ws-out-tab--full">
      <div className="ws-out-layout ws-out-layout--canvasonly">
        <main className="ws-out-view">
          {error && <div className="ws-error" style={{ fontSize: 12, margin: '8px 12px' }}>{error}</div>}
          {!selected ? (
            <div className="ws-empty-inline" style={{ margin: 'auto', maxWidth: 380, textAlign: 'center' }}>
              {list.length
                ? 'Open an artefact from the Artefacts slider in the rail to view it here.'
                : 'No outputs yet. Ask the assistant for something concrete — “draft a RACI table”, “write the SQL for that cohort”, “summarise this as a one-pager” — then open it from the Artefacts slider in the rail.'}
            </div>
          ) : (
            <>
              <header className="ws-out-view-head">
                <div className="ws-out-view-titles">
                  <h3>{selected.title || 'Untitled'}</h3>
                  <p>
                    <span className={`ws-out-badge ws-out-badge--${selected.type}`}>
                      {TYPE_LABEL[selected.type] || selected.type}
                    </span>
                    {selected.meta?.summary ? <span className="ws-out-summary"> {selected.meta.summary}</span> : null}
                  </p>
                  {selectedVersions.length > 1 && (
                    <div className="ws-out-versions" role="group" aria-label="Versions">
                      <span className="ws-out-versions-label">Versions</span>
                      {selectedVersions.map((v, i) => (
                        <button
                          key={v.id}
                          type="button"
                          className={`ws-out-vchip${v.id === selectedId ? ' ws-out-vchip--active' : ''}`}
                          onClick={() => setSelectedId(v.id)}
                          title={`${relTime(v.created_at)}${i === selectedVersions.length - 1 ? ' (latest)' : ''}`}
                        >v{i + 1}</button>
                      ))}
                      {isOldVersion && <span className="ws-out-vold">older version</span>}
                    </div>
                  )}
                </div>
                <div className="ws-out-view-actions">
                  <button type="button" className="ws-cta ws-cta--ghost" onClick={copy}>Copy</button>
                  {!(isOffice && !officeReady) && (
                    <button type="button" className="ws-cta ws-cta--ghost" onClick={download}>Download</button>
                  )}
                  <button
                    type="button" className="ws-out-del"
                    onClick={() => remove(selected.id)}
                    aria-label="Delete output" title="Delete"
                  >×</button>
                </div>
              </header>
              <div className="ws-out-body">
                <ArtefactBody artefact={selected} modelId={modelId} />
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
