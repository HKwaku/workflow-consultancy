'use client';

/**
 * Lightbox-style workspace pane that surfaces the most-used parts of the
 * deal dashboard (participants / data room / latest findings) without
 * leaving the chat surface. Opened from the chat-deal-chip's "Open workspace"
 * link or the briefcase popover.
 *
 * Read-only v1 — clicking a row hands off to existing surfaces:
 *   * doc filename → inline viewer (signed URL → new tab fallback)
 *   * finding title → /deals/[id]?focusFinding=<key> in a new tab
 *   * participant row → currently informational
 *
 * All fetches are gated by `resolveDealAccess` server-side via the existing
 * endpoints; failures degrade to "—" so the modal still renders.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import DealConnectorBindings from './DealConnectorBindings';
import WorkspaceSearchBar from './WorkspaceSearchBar';
import DealActivityTimeline from './DealActivityTimeline';

const SEVERITY_PILL = {
  critical: 'sev--critical',
  high:     'sev--high',
  medium:   'sev--medium',
  low:      'sev--low',
  info:     'sev--info',
};

// Cross-cut axes — must match DealDiligenceReport's constants so the same
// finding's `impact` array slots into the same columns.
const DAY1_AXIS = 'day_one';
const TSA_AXIS  = 'tsa';
const SEP_AXIS  = 'separation';

/**
 * One-line summary banner for the analysis's executiveSummary finding.
 * Always expanded — it's the headline read.
 */
function ExecSummaryBanner({ finding, review }) {
  const title = review?.edited_title || finding.title;
  const body  = review?.edited_body  || finding.body || '';
  return (
    <div className="deal-workspace-exec">
      <div className="deal-workspace-exec-title">★ {title}</div>
      {body && <div className="deal-workspace-exec-body">{body}</div>}
    </div>
  );
}

/**
 * Inline evidence row with an "Inspect" toggle that lazy-loads the chunk
 * content + 1 neighbour either side from the preview endpoint. Reviewers
 * can verify a finding without leaving the workspace — the target chunk is
 * highlighted and locator metadata (page / sheet / range / section) is shown.
 *
 * The original "open the file in a new tab" affordance lives next to it so
 * deep verification is still one click away.
 */
function EvidenceRow({ ev, dealId, accessToken }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openingDoc, setOpeningDoc] = useState(false);

  const loc = [
    ev.filename,
    ev.page_number ? `p.${ev.page_number}` : null,
    ev.slide_number ? `slide ${ev.slide_number}` : null,
    ev.sheet_name ? `sheet ${ev.sheet_name}` : null,
    ev.cell_range,
    ev.section_path,
  ].filter(Boolean).join(' · ');

  const inspect = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data || !ev.document_id || !ev.chunk_id) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/documents/${ev.document_id}/preview?chunk_id=${encodeURIComponent(ev.chunk_id)}&context=1`,
        {},
        accessToken,
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setErr(e?.message || 'Failed to load evidence.');
    } finally {
      setLoading(false);
    }
  };

  const openInTab = async () => {
    if (!ev.document_id || openingDoc) return;
    setOpeningDoc(true);
    try {
      const r = await apiFetch(`/api/deals/${dealId}/documents/${ev.document_id}/signed-url`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.url) window.open(j.url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningDoc(false);
    }
  };

  const inspectable = Boolean(ev.document_id && ev.chunk_id);

  return (
    <li className="deal-workspace-detail-evidence-row">
      <div className="deal-workspace-detail-evidence-head">
        <span className="deal-workspace-detail-evidence-loc">{loc || 'Source'}</span>
        <span className="deal-workspace-detail-evidence-actions">
          {inspectable && (
            <button type="button" className="deal-workspace-evidence-btn" onClick={inspect}>
              {open ? 'Hide' : 'Inspect'}
            </button>
          )}
          {ev.document_id && (
            <button
              type="button"
              className="deal-workspace-evidence-btn"
              onClick={openInTab}
              disabled={openingDoc}
              title="Open the source document in a new tab"
            >Open</button>
          )}
        </span>
      </div>
      {ev.snippet && !open && (
        <span className="deal-workspace-detail-evidence-snip">"{ev.snippet}"</span>
      )}
      {open && (
        <div className="deal-workspace-evidence-drawer">
          {loading && <div className="deal-workspace-evidence-loading">Loading…</div>}
          {err && <div className="deal-workspace-evidence-error">{err}</div>}
          {data && (
            <ol className="deal-workspace-evidence-chunks">
              {data.chunks.map((c) => (
                <li
                  key={c.id}
                  className={`deal-workspace-evidence-chunk${c.id === data.target_chunk_id ? ' is-target' : ''}`}
                >
                  <div className="deal-workspace-evidence-chunk-loc">
                    {[
                      c.page_number ? `p.${c.page_number}` : null,
                      c.slide_number ? `slide ${c.slide_number}` : null,
                      c.sheet_name ? `sheet ${c.sheet_name}` : null,
                      c.cell_range,
                      c.section_path,
                    ].filter(Boolean).join(' · ') || `chunk ${c.chunk_index}`}
                  </div>
                  <div className="deal-workspace-evidence-chunk-text">{c.content}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One-page deal scorecard: thesis, key risks, mitigants, recommended action,
 * doc coverage. Auto-filled from /api/deals/[id]/scorecard. Read-only — the
 * source of truth is the underlying findings + reviews; this view exists so
 * partners can paste a clean summary into IC decks without rebuilding it.
 *
 * `onJumpToFinding(key)` lets each top risk deep-link back to its finding
 * row in the workspace so reviewers can verify before accepting the
 * scorecard's framing.
 */
function DealScorecard({ loading, error, card, onJumpToFinding }) {
  if (loading) return <div className="deal-workspace-loading">Building scorecard…</div>;
  if (error)   return <div className="deal-workspace-error">{error}</div>;
  if (!card)   return null;

  const sev = card.severityCounts || { critical: 0, high: 0, medium: 0, low: 0 };
  const cov = card.coverage || { total: 0, ready: 0, stored: 0, pending: 0, byCategory: [] };

  return (
    <div className="deal-scorecard">
      <div className="deal-scorecard-head">
        <div>
          <div className="deal-scorecard-eyebrow">Scorecard</div>
          <h2 className="deal-scorecard-title">{card.deal?.name || 'Deal'}</h2>
          <div className="deal-scorecard-sub">
            {card.deal?.deal_code ? `${card.deal.deal_code} · ` : ''}{card.deal?.type}
            {card.analysis ? ` · analysis ${card.analysis.completed_at?.slice(0, 10)}${card.analysis.auto_triggered ? ' (auto)' : ''}` : ' · no analysis yet'}
          </div>
        </div>
        <div className="deal-scorecard-score">
          <div className="deal-scorecard-score-num">{card.riskScore ?? 0}</div>
          <div className="deal-scorecard-score-label">Risk score</div>
        </div>
      </div>

      <div className="deal-scorecard-sevbar">
        {(['critical', 'high', 'medium', 'low']).map((s) => (
          <span key={s} className={`deal-scorecard-sev deal-scorecard-sev--${s}`}>
            {sev[s]} {s}
          </span>
        ))}
      </div>

      {card.recommendedAction && (
        <div className="deal-scorecard-rec">
          <div className="deal-scorecard-block-label">Recommended action</div>
          <div className="deal-scorecard-rec-body">{card.recommendedAction}</div>
        </div>
      )}

      {card.thesis && (
        <div className="deal-scorecard-block">
          <div className="deal-scorecard-block-label">Thesis / executive summary</div>
          <h4 className="deal-scorecard-thesis-title">{card.thesis.title}</h4>
          {card.thesis.body && <p className="deal-scorecard-thesis-body">{card.thesis.body}</p>}
        </div>
      )}

      {card.keyTakeaways?.length > 0 && (
        <div className="deal-scorecard-block">
          <div className="deal-scorecard-block-label">Key takeaways</div>
          <ul className="deal-scorecard-list">
            {card.keyTakeaways.map((t) => (
              <li key={t.finding_key}>
                <strong>{t.title}</strong>
                {t.body && <span className="deal-scorecard-list-body"> — {t.body}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.keyRisks?.length > 0 && (
        <div className="deal-scorecard-block">
          <div className="deal-scorecard-block-label">Top risks (by severity × confidence)</div>
          <ol className="deal-scorecard-risks">
            {card.keyRisks.map((r) => (
              <li key={r.finding_key}>
                <button
                  type="button"
                  className="deal-scorecard-risk-link"
                  onClick={() => onJumpToFinding?.(r.finding_key)}
                  title="Jump to this finding"
                >{r.title}</button>
                <span className={`deal-workspace-sev ${r.severity ? `sev--${r.severity}` : ''}`}>{r.severity}</span>
                <span className="deal-scorecard-risk-weight">{r.weight}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {card.mitigants?.length > 0 && (
        <div className="deal-scorecard-block">
          <div className="deal-scorecard-block-label">Mitigants / next actions</div>
          <ul className="deal-scorecard-list">
            {card.mitigants.slice(0, 12).map((m, i) => (
              <li key={i}>
                <span className="deal-scorecard-list-body">{m.action}</span>
                <span className="deal-scorecard-mit-source"> — from <em>{m.finding_title}</em></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="deal-scorecard-block">
        <div className="deal-scorecard-block-label">Data room coverage</div>
        <div className="deal-scorecard-cov-counts">
          {cov.total} docs · {cov.ready} indexed · {cov.stored} stored-only{cov.pending ? ` · ${cov.pending} processing` : ''}{cov.failed ? ` · ${cov.failed} failed` : ''}
        </div>
        {cov.byCategory?.length > 0 && (
          <div className="deal-scorecard-cov-cats">
            {cov.byCategory.map((c) => (
              <span key={c.category} className="deal-scorecard-cov-cat">{c.category} <strong>{c.count}</strong></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Quick-toggle chips for the recommended finding-tag vocabulary. */
function FindingTagsChips({ tags, disabled, onToggle }) {
  const ALL = [
    { id: 'deal_breaker', label: 'Deal-breaker', cls: 'critical' },
    { id: 're_trade',     label: 'Re-trade',     cls: 'high' },
    { id: 'disclose',     label: 'Disclose',     cls: 'medium' },
    { id: 'mitigate',     label: 'Mitigate',     cls: 'medium' },
    { id: 'monitor',      label: 'Monitor',      cls: 'low' },
  ];
  const set = new Set(tags || []);
  return (
    <div className="deal-finding-tags">
      <span className="deal-finding-tags-label">Tags:</span>
      {ALL.map((t) => {
        const on = set.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className={`deal-finding-tag deal-finding-tag--${t.cls}${on ? ' is-on' : ''}`}
            onClick={() => !disabled && onToggle(t.id)}
            disabled={disabled}
            aria-pressed={on}
          >{t.label}</button>
        );
      })}
    </div>
  );
}

/** Threaded comments on a finding. Lazy-loads on first render via onLoad. */
function FindingCommentThread({ comments, draft, onLoad, onDraftChange, onPost }) {
  useEffect(() => { if (comments === undefined) onLoad?.(); /* lazy */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = comments || [];
  return (
    <div className="deal-finding-comments">
      <div className="deal-finding-comments-label">Discussion {list.length > 0 ? `(${list.length})` : ''}</div>
      {list.length > 0 && (
        <ul className="deal-finding-comments-list">
          {list.map((c) => (
            <li key={c.id} className="deal-finding-comment">
              <div className="deal-finding-comment-meta">
                <strong>{c.author_email}</strong>
                <span className="deal-finding-comment-when">{new Date(c.created_at).toLocaleString()}</span>
              </div>
              <div className="deal-finding-comment-body">{c.body}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="deal-finding-comment-composer">
        <textarea
          className="deal-finding-comment-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Add a comment… use @email to mention someone."
          rows={2}
        />
        <button type="button" className="deal-finding-comment-post" onClick={onPost} disabled={!draft.trim()}>Post</button>
      </div>
    </div>
  );
}

/**
 * Expanded detail for a body finding: prose body, recommendations list,
 * confidence + evidence rows. Mirrors the deal page's FindingCard but
 * read-only (edits go through the existing ✏ flow above).
 */
function FindingDetail({ finding, review, displayedBody, dealId, accessToken }) {
  const recs = Array.isArray(finding.recommendations) ? finding.recommendations : [];
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  const confidence = typeof finding.confidence === 'number' ? Math.round(finding.confidence * 100) : null;

  return (
    <div className="deal-workspace-detail">
      {displayedBody && (
        <div className="deal-workspace-detail-body">{displayedBody}</div>
      )}
      {recs.length > 0 && (
        <div className="deal-workspace-detail-block">
          <div className="deal-workspace-detail-label">Recommendations</div>
          <ul className="deal-workspace-detail-recs">
            {recs.map((r, i) => (<li key={i}>{r}</li>))}
          </ul>
        </div>
      )}
      {(evidence.length > 0 || confidence != null) && (
        <div className="deal-workspace-detail-block">
          <div className="deal-workspace-detail-label">
            Evidence{evidence.length > 0 ? ` (${evidence.length})` : ''}
            {confidence != null && <span className="deal-workspace-detail-conf"> · model confidence {confidence}%</span>}
          </div>
          {evidence.length > 0 && (
            <ul className="deal-workspace-detail-evidence">
              {evidence.map((ev, i) => (
                <EvidenceRow key={i} ev={ev} dealId={dealId} accessToken={accessToken} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CrosscutColumns({ findings, reviewsByKey, dealId }) {
  const byAxis = (axis) => findings.filter((f) => Array.isArray(f.impact) && f.impact.includes(axis));
  const day1 = byAxis(DAY1_AXIS);
  const tsa  = byAxis(TSA_AXIS);
  const sep  = byAxis(SEP_AXIS);

  if (!day1.length && !tsa.length && !sep.length) {
    return (
      <p className="deal-workspace-empty">
        No findings tagged with Day-1, TSA, or Separation impact. The analysis sets these tags during diligence runs — re-run if findings predate the cross-cut feature.
      </p>
    );
  }

  return (
    <div className="deal-workspace-crosscut">
      <CrosscutCol label="Day 1"      findings={day1} reviewsByKey={reviewsByKey} dealId={dealId} />
      <CrosscutCol label="TSA"        findings={tsa}  reviewsByKey={reviewsByKey} dealId={dealId} />
      <CrosscutCol label="Separation" findings={sep}  reviewsByKey={reviewsByKey} dealId={dealId} />
    </div>
  );
}

function CrosscutCol({ label, findings, reviewsByKey, dealId }) {
  return (
    <div className="deal-workspace-crosscut-col">
      <h4 className="deal-workspace-crosscut-col-title">{label} <span>{findings.length}</span></h4>
      {findings.length === 0 ? (
        <p className="deal-workspace-crosscut-empty">Nothing flagged.</p>
      ) : (
        <ul className="deal-workspace-crosscut-list">
          {findings.map((f) => {
            const key = f.key || f.finding_key;
            const review = reviewsByKey?.[key];
            const status = review?.status || 'pending';
            return (
              <li key={key} className="deal-workspace-crosscut-item">
                {f.severity && (
                  <span className={`deal-workspace-sev ${SEVERITY_PILL[f.severity] || ''}`}>{f.severity}</span>
                )}
                <a
                  className="deal-workspace-name deal-workspace-name--link"
                  href={`/process-audit?deal=${encodeURIComponent(dealId)}&focusFinding=${encodeURIComponent(key)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: '1 1 auto' }}
                >
                  {review?.edited_title || f.title}
                </a>
                <span className={`deal-workspace-review deal-workspace-review--${status}`}>{status}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Tiny module-level cache so re-opening the same deal modal is instant.
// Holds the last successful payload per dealId; the modal renders the
// cached snapshot immediately and kicks off a background refresh. TTL is
// long because we invalidate on mutations rather than on time.
const _modalCache = new Map(); // dealId -> { data, qaItems, qaSummary }
const MODAL_CACHE_MAX = 8;
function readModalCache(dealId) { return dealId ? _modalCache.get(dealId) : null; }
function writeModalCache(dealId, snap) {
  if (!dealId) return;
  _modalCache.set(dealId, snap);
  if (_modalCache.size > MODAL_CACHE_MAX) {
    const oldest = _modalCache.keys().next().value;
    if (oldest) _modalCache.delete(oldest);
  }
}

export default function DealWorkspaceModal({ open, onClose, dealId, accessToken, focusFindingKey = null }) {
  // Per-section loading flags so the modal renders progressively. Deal +
  // docs + Q&A all share `loadingCore`; findings have their own flag so
  // the rest of the surface paints while the analysis fetch is in flight.
  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [data, setData] = useState({ deal: null, participants: [], documents: [], findings: [], analysis: null, reviewsByKey: {}, newFindingKeys: new Set() });
  // Per-deal-type "expected docs" checklist. Lazy-loaded after the main
  // payload so the modal renders immediately; null while loading or empty.
  const [checklist, setChecklist] = useState(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // Auto-filled scorecard. Lazy-loaded the first time the user opens it;
  // re-fetched whenever the analysis ref changes so a fresh delta run
  // refreshes the scorecard without a manual refresh.
  const [scorecard, setScorecard] = useState(null);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState(null);

  // Q&A queue — questions to seller. Loaded with the rest of the modal
  // payload so the section can show counts on first paint. Mutations
  // refresh just this slice, not the full modal.
  const [qaItems, setQaItems] = useState([]);
  const [qaSummary, setQaSummary] = useState({ open: 0, answered: 0, skipped: 0, obsolete: 0 });
  const [qaDraft, setQaDraft] = useState('');
  const [qaAssignParticipant, setQaAssignParticipant] = useState('');
  const [qaBusy, setQaBusy] = useState(false);
  const [qaAnswerDraft, setQaAnswerDraft] = useState({}); // { [itemId]: text }
  // Per-finding comment thread state. Lazy-loaded when a finding is expanded.
  const [findingComments, setFindingComments] = useState({}); // { [key]: [comment...] }
  const [findingCommentDraft, setFindingCommentDraft] = useState({}); // { [key]: text }
  const [error, setError] = useState(null);
  const [openingDocId, setOpeningDocId] = useState(null);
  const [reviewBusyKey, setReviewBusyKey] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragHover, setDragHover] = useState(false);
  const [openNoteKey, setOpenNoteKey] = useState(null);
  const [noteDraftByKey, setNoteDraftByKey] = useState({});
  const [openEditKey, setOpenEditKey] = useState(null);
  const [editDraftByKey, setEditDraftByKey] = useState({}); // { [key]: { title, body } }
  const [editPartId, setEditPartId] = useState(null);
  const [partDraftById, setPartDraftById] = useState({}); // { [id]: { companyName, role, email, name } }
  const [partBusyId, setPartBusyId] = useState(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState(null);

  const PARTICIPANT_ROLES = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

  const [findingsLens, setFindingsLens] = useState('list'); // 'list' | 'crosscut'
  const [expandedFindingKeys, setExpandedFindingKeys] = useState(() => new Set());
  const [pulseFindingKey, setPulseFindingKey] = useState(null);

  const editable = Boolean(data.deal?.canEdit);

  useEffect(() => {
    if (!open || !dealId || !accessToken) return undefined;
    let cancelled = false;
    setError(null);

    // Optimistic render from the in-memory cache. The user sees the last
    // snapshot immediately; the background refresh below replaces it once
    // fresh data lands. If there's no cache, we still show the loading
    // state but core sections (deal/participants/docs/QA) only block on
    // their own data — findings have a separate flag.
    const cached = readModalCache(dealId);
    if (cached) {
      setData(cached.data || { deal: null, participants: [], documents: [], findings: [], analysis: null, reviewsByKey: {}, newFindingKeys: new Set() });
      setQaItems(cached.qaItems || []);
      setQaSummary(cached.qaSummary || { open: 0, answered: 0, skipped: 0, obsolete: 0 });
      setLoadingCore(false);
    } else {
      setLoadingCore(true);
    }
    setLoadingFindings(true);

    // ──────────────────────────────────────────────────────────────────
    // Fire ALL initial calls in parallel. Findings are no longer gated
    // on the deal payload — we always issue the analyses query and
    // discard if it returns nothing. Q&A is no longer a separate
    // post-mount fetch — it lands in the same wave.
    // ──────────────────────────────────────────────────────────────────
    const dealP   = apiFetch(`/api/deals/${dealId}`, {}, accessToken).then((r) => r.json()).catch(() => null);
    const docsP   = apiFetch(`/api/deals/${dealId}/documents`, {}, accessToken).then((r) => r.ok ? r.json() : null).catch(() => null);
    const qaP     = apiFetch(`/api/deals/${dealId}/qa`, {}, accessToken).then((r) => r.ok ? r.json() : null).catch(() => null);
    const lresP   = apiFetch(`/api/deals/${dealId}/analyses?status=complete&limit=2`, {}, accessToken)
      .then((r) => r.ok ? r.json() : null).catch(() => null);

    // ── Core: deal + docs + QA → progressive paint as soon as ready ──
    Promise.all([dealP, docsP, qaP]).then(([dealResp, docsResp, qaResp]) => {
      if (cancelled) return;
      const deal = dealResp?.deal || null;
      const participants = dealResp?.participants || [];
      const documents = (docsResp?.documents || docsResp || []).slice(0, 50);
      setData((prev) => ({ ...prev, deal, participants, documents }));
      if (qaResp?.items) {
        setQaItems(qaResp.items);
        setQaSummary(qaResp.summary || { open: 0, answered: 0, skipped: 0, obsolete: 0 });
      }
      setLoadingCore(false);
    }).catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load deal.'); });

    // ── Findings: independent path, paints when ready ────────────────
    lresP.then(async (ldata) => {
      try {
        const completed = ldata?.analyses || [];
        const latest = completed[0];
        const previous = completed[1];
        if (!latest?.id) {
          if (!cancelled) {
            setData((prev) => ({ ...prev, findings: [], analysis: null, reviewsByKey: {}, newFindingKeys: new Set() }));
            setLoadingFindings(false);
          }
          return;
        }
        const calls = [
          apiFetch(`/api/deals/${dealId}/analyses/${latest.id}`, {}, accessToken),
          apiFetch(`/api/deals/${dealId}/analyses/${latest.id}/reviews`, {}, accessToken),
        ];
        if (previous?.id) {
          calls.push(apiFetch(`/api/deals/${dealId}/analyses/${previous.id}`, {}, accessToken));
        }
        const [fresp, rresp, presp] = await Promise.all(calls);
        if (cancelled) return;
        const fdata = fresp.ok ? await fresp.json() : null;
        const findings = (fdata?.analysis?.findings || []).slice(0, 30);
        const rdata = rresp.ok ? await rresp.json() : null;
        const reviewsByKey = {};
        for (const r of rdata?.reviews || []) reviewsByKey[r.finding_key] = r;
        let newFindingKeys = new Set();
        if (presp) {
          const pdata = presp.ok ? await presp.json() : null;
          const prevKeys = new Set(
            (pdata?.analysis?.findings || []).map((f) => f.key || f.finding_key).filter(Boolean),
          );
          newFindingKeys = new Set(
            findings.map((f) => f.key || f.finding_key).filter((k) => k && !prevKeys.has(k)),
          );
        }
        if (!cancelled) {
          setData((prev) => ({ ...prev, findings, analysis: latest, reviewsByKey, newFindingKeys }));
        }
      } catch { /* swallow — modal still works without findings */ }
      finally { if (!cancelled) setLoadingFindings(false); }
    });

    return () => { cancelled = true; };
  }, [open, dealId, accessToken]);

  // Persist to cache whenever the payload settles. The cache speeds the
  // *next* open of the same deal; the current modal already rendered.
  useEffect(() => {
    if (!open || !dealId) return;
    if (loadingCore) return;
    writeModalCache(dealId, { data, qaItems, qaSummary });
  }, [open, dealId, loadingCore, data, qaItems, qaSummary]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Q&A refresh — the initial fetch is bundled into the main parallel
  // load above. This callback re-fetches just Q&A after a mutation, so
  // we don't need to invalidate the whole modal payload.
  const loadQa = useCallback(async () => {
    if (!open || !dealId || !accessToken) return;
    try {
      const r = await apiFetch(`/api/deals/${dealId}/qa`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.items) {
        setQaItems(j.items);
        setQaSummary(j.summary || { open: 0, answered: 0, skipped: 0, obsolete: 0 });
      }
    } catch { /* swallow */ }
  }, [open, dealId, accessToken]);

  const askQuestion = async () => {
    const text = qaDraft.trim();
    if (!text) return;
    setQaBusy(true);
    try {
      const body = { question: text };
      if (qaAssignParticipant) {
        const part = data.participants.find((p) => p.id === qaAssignParticipant);
        body.assigned_participant_id = qaAssignParticipant;
        if (part) body.assigned_company = part.company_name || part.companyName || null;
      }
      const r = await apiFetch(
        `/api/deals/${dealId}/qa`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        accessToken,
      );
      if (r.ok) { setQaDraft(''); setQaAssignParticipant(''); await loadQa(); }
    } finally {
      setQaBusy(false);
    }
  };

  const updateQa = async (itemId, patch) => {
    setQaBusy(true);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/qa`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemId, ...patch }) },
        accessToken,
      );
      if (r.ok) await loadQa();
    } finally {
      setQaBusy(false);
    }
  };

  const submitAnswer = async (itemId) => {
    const text = (qaAnswerDraft[itemId] || '').trim();
    if (!text) return;
    await updateQa(itemId, { answer_text: text, status: 'answered' });
    setQaAnswerDraft((d) => ({ ...d, [itemId]: '' }));
  };

  // Per-finding comments — lazy-load when a finding expands.
  const loadFindingComments = useCallback(async (findingKey) => {
    if (!data.analysis?.id || findingComments[findingKey]) return;
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/analyses/${data.analysis.id}/findings/${encodeURIComponent(findingKey)}/comments`,
        {},
        accessToken,
      );
      const j = r.ok ? await r.json() : null;
      if (j?.comments) setFindingComments((s) => ({ ...s, [findingKey]: j.comments }));
    } catch { /* swallow */ }
  }, [dealId, accessToken, data.analysis?.id, findingComments]);

  const postFindingComment = async (findingKey) => {
    const text = (findingCommentDraft[findingKey] || '').trim();
    if (!text || !data.analysis?.id) return;
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/analyses/${data.analysis.id}/findings/${encodeURIComponent(findingKey)}/comments`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }) },
        accessToken,
      );
      const j = r.ok ? await r.json() : null;
      if (j?.comment) {
        setFindingComments((s) => ({
          ...s,
          [findingKey]: [...(s[findingKey] || []), j.comment],
        }));
        setFindingCommentDraft((d) => ({ ...d, [findingKey]: '' }));
      }
    } catch { /* swallow */ }
  };

  // Tag mutation — toggles a tag on a finding via PATCH.
  const toggleFindingTag = async (findingKey, tag) => {
    if (!data.analysis?.id) return;
    const current = data.findings.find((f) => (f.key || f.finding_key) === findingKey);
    const tags = new Set(Array.isArray(current?.tags) ? current.tags : []);
    if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/analyses/${data.analysis.id}/findings/${encodeURIComponent(findingKey)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: [...tags] }) },
        accessToken,
      );
      if (!r.ok) return;
      const j = await r.json();
      const updated = j?.finding;
      if (updated) {
        setData((prev) => ({
          ...prev,
          findings: prev.findings.map((f) => (
            (f.key || f.finding_key) === findingKey
              ? { ...f, tags: updated.tags, stale: updated.stale, stale_reason: updated.stale_reason }
              : f
          )),
        }));
      }
    } catch { /* swallow */ }
  };

  // Lazy-fetch the scorecard on first open + whenever the underlying
  // analysis id changes (so a fresh auto-trigger run refreshes it).
  useEffect(() => {
    if (!open || !scorecardOpen || !dealId || !accessToken) return undefined;
    let cancelled = false;
    setScorecardLoading(true);
    setScorecardError(null);
    apiFetch(`/api/deals/${dealId}/scorecard`, {}, accessToken)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setScorecardError(j?.error || 'Failed to load scorecard.');
        else setScorecard(j);
      })
      .catch((e) => { if (!cancelled) setScorecardError(e?.message || 'Network error.'); })
      .finally(() => { if (!cancelled) setScorecardLoading(false); });
    return () => { cancelled = true; };
  }, [open, scorecardOpen, dealId, accessToken, data.analysis?.id]);

  // Refresh the expected-docs checklist whenever the document list changes —
  // newly uploaded / categorised docs may now satisfy a checklist item.
  useEffect(() => {
    if (!open || !dealId || !accessToken) return undefined;
    let cancelled = false;
    apiFetch(`/api/deals/${dealId}/checklist`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.checklist) setChecklist(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, dealId, accessToken, data.documents.length]);

  // Poll the documents endpoint every 5s while any doc is in a transient
  // status (pending/parsing/embedding). Stops when all are terminal (ready,
  // stored, or failed). The deal page's DealDocumentsPanel does the same.
  useEffect(() => {
    if (!open || !dealId || !accessToken) return undefined;
    const transient = (data.documents || []).some((d) => ['pending', 'parsing', 'embedding'].includes(d.status));
    if (!transient) return undefined;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/deals/${dealId}/documents`, {}, accessToken);
        const j = r.ok ? await r.json() : null;
        if (cancelled || !j) return;
        const fresh = j.documents || j || [];
        setData((prev) => ({ ...prev, documents: fresh.slice(0, 50) }));
      } catch { /* swallow — try again next tick */ }
    }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [open, dealId, accessToken, data.documents]);

  // When the modal opens with a focusFindingKey (deep-link from chat / legacy
  // page redirect), expand that finding and pulse it once findings are loaded.
  // Waits on `loadingFindings` since the focus target lives in that slice.
  useEffect(() => {
    if (!open || !focusFindingKey || loadingFindings) return;
    setExpandedFindingKeys((s) => new Set([...s, focusFindingKey]));
    const t = setTimeout(() => {
      const el = document.getElementById(`workspace-finding-${focusFindingKey}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPulseFindingKey(focusFindingKey);
      setTimeout(() => setPulseFindingKey(null), 2400);
    }, 200);
    return () => clearTimeout(t);
  }, [open, focusFindingKey, loadingFindings]);

  const openDoc = async (d) => {
    if (!d?.id) return;
    setOpeningDocId(d.id);
    try {
      const r = await apiFetch(`/api/deals/${dealId}/documents/${d.id}/signed-url`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.url) window.open(j.url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningDocId(null);
    }
  };

  // Quick status change: don't touch the note. Existing note (if any) is
  // preserved server-side because we don't send `reviewer_note` at all.
  const submitReview = (findingKey, status) => submitReviewWithNote(findingKey, status, undefined);

  const uploadOne = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api/deals/${dealId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `Upload failed (${r.status})`);
    return j?.document || null;
  };

  const onUpload = async (filesIn) => {
    const files = Array.isArray(filesIn) ? filesIn : (filesIn ? [filesIn] : []);
    if (!files.length || !dealId) return;
    setUploading(true);
    setUploadError(null);
    const errors = [];
    const newDocs = [];
    // Sequential — easier to surface per-file errors and avoids hammering the
    // route with N concurrent multipart bodies.
    for (const f of files) {
      try {
        const doc = await uploadOne(f);
        if (doc) newDocs.push(doc);
      } catch (e) {
        errors.push(`${f.name}: ${e?.message || 'failed'}`);
      }
    }
    if (newDocs.length) {
      setData((prev) => ({ ...prev, documents: [...newDocs, ...prev.documents] }));
    }
    if (errors.length) setUploadError(errors.join(' · '));
    setUploading(false);
  };

  // Single PATCH path. Pass only the fields you want to change — omitted
  // fields are preserved server-side. status is required by the endpoint
  // shape, so callers should pass the current status when they're not
  // changing it.
  const submitReviewPatch = async (findingKey, status, extras = {}) => {
    if (!data.analysis?.id) return;
    setReviewBusyKey(findingKey);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/analyses/${data.analysis.id}/reviews`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finding_key: findingKey, status, ...extras }),
        },
        accessToken,
      );
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        const next = body?.review || { finding_key: findingKey, status, ...extras };
        setData((prev) => ({ ...prev, reviewsByKey: { ...prev.reviewsByKey, [findingKey]: next } }));
      }
    } finally {
      setReviewBusyKey(null);
    }
  };

  const submitReviewWithNote  = (key, status, reviewerNote) =>
    submitReviewPatch(key, status, reviewerNote != null ? { reviewer_note: reviewerNote } : {});
  const submitReviewWithEdits = (key, status, { editedTitle, editedBody } = {}) =>
    submitReviewPatch(key, status, {
      ...(editedTitle != null ? { edited_title: editedTitle } : {}),
      ...(editedBody  != null ? { edited_body:  editedBody  } : {}),
    });

  const savePartEdit = async (pid, draft) => {
    setPartBusyId(pid);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/participants/${pid}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName: draft.companyName,
            role: draft.role,
            participantEmail: draft.email || null,
            participantName: draft.name || null,
          }),
        },
        accessToken,
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Update failed (${r.status})`);
      // Optimistic merge: update by id; tolerate snake_case from server.
      setData((prev) => ({
        ...prev,
        participants: prev.participants.map((p) => p.id === pid ? {
          ...p,
          company_name: j.participant?.company_name ?? draft.companyName,
          companyName: j.participant?.company_name ?? draft.companyName,
          role: j.participant?.role ?? draft.role,
          participant_email: j.participant?.participant_email ?? (draft.email || null),
          participant_name: j.participant?.participant_name ?? (draft.name || null),
        } : p),
      }));
      setEditPartId(null);
    } catch (e) {
      setUploadError(e?.message || 'Update failed'); // reuse the modal error band
    } finally {
      setPartBusyId(null);
    }
  };

  const deletePart = async (pid) => {
    setPartBusyId(pid);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/participants/${pid}`,
        { method: 'DELETE' },
        accessToken,
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Delete failed (${r.status})`);
      }
      setData((prev) => ({ ...prev, participants: prev.participants.filter((p) => p.id !== pid) }));
      setConfirmDeletePart(null);
    } catch (e) {
      setUploadError(e?.message || 'Delete failed');
    } finally {
      setPartBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="deal-workspace-overlay" role="dialog" aria-modal aria-label="Deal workspace" onClick={onClose}>
      <div className="deal-workspace-frame" onClick={(e) => e.stopPropagation()}>
        <div className="deal-workspace-bar">
          <div className="deal-workspace-bar-left">
            <span className="deal-workspace-bar-eyebrow">Deal workspace</span>
            <span className="deal-workspace-bar-name">{data.deal?.name || 'Loading…'}</span>
          </div>
          <div className="deal-workspace-bar-actions">
            {/* CSV exports — anchor with the Bearer token in a fetch + blob
                so we don't need a server-side token-in-URL flow. */}
            <button
              type="button"
              className="deal-doc-viewer-btn"
              onClick={async () => {
                const r = await fetch(`/api/deals/${dealId}/export.csv?type=findings`, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!r.ok) return;
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = (data.deal?.deal_code || 'deal') + '-findings.csv';
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
              }}
              title="Download findings as CSV"
            >Findings CSV</button>
            <button
              type="button"
              className="deal-doc-viewer-btn"
              onClick={async () => {
                const r = await fetch(`/api/deals/${dealId}/export.csv?type=qa`, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!r.ok) return;
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = (data.deal?.deal_code || 'deal') + '-qa.csv';
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
              }}
              title="Download Q&A as CSV"
            >Q&amp;A CSV</button>
            <button
              type="button"
              className="deal-doc-viewer-btn"
              onClick={() => setScorecardOpen((v) => !v)}
              aria-pressed={scorecardOpen}
              title="One-page deal summary auto-filled from the latest analysis"
            >{scorecardOpen ? 'Close scorecard' : 'Scorecard'}</button>
            <button type="button" className="deal-doc-viewer-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </div>

        <div className="deal-workspace-body">
          {error && <div className="deal-workspace-error">{error}</div>}

          {loadingCore && !data.deal ? (
            <div className="deal-workspace-loading">Loading deal…</div>
          ) : scorecardOpen ? (
            <DealScorecard
              loading={scorecardLoading}
              error={scorecardError}
              card={scorecard}
              onJumpToFinding={(key) => {
                setScorecardOpen(false);
                setExpandedFindingKeys((s) => new Set([...s, key]));
                setPulseFindingKey(key);
                requestAnimationFrame(() => {
                  document.getElementById(`workspace-finding-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
              }}
            />
          ) : (
            <div className="deal-workspace-grid">
              {/* Participants */}
              <section className="deal-workspace-section">
                <h3 className="deal-workspace-section-title">
                  Participants <span className="deal-workspace-section-count">{data.participants.length}</span>
                </h3>
                {data.participants.length === 0 ? (
                  <p className="deal-workspace-empty">No participants yet.</p>
                ) : (
                  <ul className="deal-workspace-list">
                    {data.participants.map((p) => {
                      const company = p.companyName || p.company_name;
                      const email   = p.participant_email || p.participantEmail || '';
                      const name    = p.participant_name  || p.participantName  || '';
                      const isEditing = editPartId === p.id;
                      const draft = partDraftById[p.id] || { companyName: company, role: p.role, email, name };
                      const busy = partBusyId === p.id;
                      const dirty = draft.companyName !== company || draft.role !== p.role || draft.email !== email || draft.name !== name;
                      return (
                        <li key={p.id} className="deal-workspace-row deal-workspace-row--finding">
                          <div className="deal-workspace-row-main">
                            <span className={`deal-workspace-status deal-workspace-status--${p.status}`}>{p.status}</span>
                            <span className="deal-workspace-name">{company}</span>
                            <span className="deal-workspace-sub">
                              {p.role}{email ? ` · ${email}` : ''}{name ? ` · ${name}` : ''}
                            </span>
                            {editable && (
                              <span className="deal-workspace-review-actions">
                                <button type="button" className="deal-workspace-review-btn"
                                  title="Edit participant"
                                  disabled={busy}
                                  onClick={() => {
                                    setConfirmDeletePart(null);
                                    setEditPartId(isEditing ? null : p.id);
                                    setPartDraftById((s) => ({ ...s, [p.id]: { companyName: company, role: p.role, email, name } }));
                                  }}
                                >✏</button>
                                <button type="button" className="deal-workspace-review-btn deal-workspace-review-btn--no"
                                  title="Remove participant"
                                  disabled={busy}
                                  onClick={() => { setEditPartId(null); setConfirmDeletePart(p.id); }}
                                >✕</button>
                              </span>
                            )}
                          </div>
                          {isEditing && editable && (
                            <div className="deal-workspace-note">
                              <input
                                className="deal-workspace-note-input"
                                value={draft.companyName}
                                onChange={(e) => setPartDraftById((s) => ({ ...s, [p.id]: { ...draft, companyName: e.target.value } }))}
                                placeholder="Company name"
                                disabled={busy}
                              />
                              <select
                                className="deal-workspace-note-input"
                                value={draft.role}
                                onChange={(e) => setPartDraftById((s) => ({ ...s, [p.id]: { ...draft, role: e.target.value } }))}
                                disabled={busy}
                              >
                                {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <input
                                className="deal-workspace-note-input"
                                type="email"
                                value={draft.email}
                                onChange={(e) => setPartDraftById((s) => ({ ...s, [p.id]: { ...draft, email: e.target.value } }))}
                                placeholder="Contact email (optional)"
                                disabled={busy}
                              />
                              <input
                                className="deal-workspace-note-input"
                                value={draft.name}
                                onChange={(e) => setPartDraftById((s) => ({ ...s, [p.id]: { ...draft, name: e.target.value } }))}
                                placeholder="Contact name (optional)"
                                disabled={busy}
                              />
                              <div className="deal-workspace-note-actions">
                                <button type="button"
                                  className="deal-workspace-note-btn deal-workspace-note-btn--primary"
                                  disabled={busy || !dirty || !draft.companyName.trim()}
                                  onClick={() => savePartEdit(p.id, draft)}
                                >{busy ? 'Saving…' : 'Save changes'}</button>
                                <button type="button"
                                  className="deal-workspace-note-btn"
                                  disabled={busy}
                                  onClick={() => setEditPartId(null)}
                                >Cancel</button>
                              </div>
                            </div>
                          )}
                          {confirmDeletePart === p.id && editable && (
                            <div className="deal-workspace-note">
                              <div className="deal-workspace-note-preview" title="Confirm delete">
                                <span className="deal-workspace-note-preview-label">Confirm:</span> Remove <strong>{company}</strong> from this deal? Their slot, flow links, and any in-progress work will be cascaded — the deal and the participant's diagnostic report itself stay intact.
                              </div>
                              <div className="deal-workspace-note-actions">
                                <button type="button"
                                  className="deal-workspace-note-btn deal-workspace-note-btn--primary"
                                  style={{ background: '#dc2626', borderColor: '#dc2626' }}
                                  disabled={busy}
                                  onClick={() => deletePart(p.id)}
                                >{busy ? 'Removing…' : 'Yes, remove'}</button>
                                <button type="button"
                                  className="deal-workspace-note-btn"
                                  disabled={busy}
                                  onClick={() => setConfirmDeletePart(null)}
                                >Keep</button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Documents */}
              <section
                className={`deal-workspace-section${editable && dragHover ? ' deal-workspace-section--drop' : ''}`}
                onDragOver={editable ? (e) => { e.preventDefault(); setDragHover(true); } : undefined}
                onDragLeave={editable ? () => setDragHover(false) : undefined}
                onDrop={editable ? (e) => {
                  e.preventDefault();
                  setDragHover(false);
                  const fs = Array.from(e.dataTransfer?.files || []);
                  if (fs.length) onUpload(fs);
                } : undefined}
              >
                {/* Hybrid search across the entire data room — debounced
                    against /api/deals/[id]/search; clicking a hit opens the
                    matching document via the existing signed-URL path. */}
                <WorkspaceSearchBar
                  dealId={dealId}
                  accessToken={accessToken}
                  onOpenDoc={(d) => {
                    const full = data.documents.find((x) => x.id === d.id);
                    if (full) openDoc(full);
                    else openDoc(d);
                  }}
                />
                <h3 className="deal-workspace-section-title">
                  Data room <span className="deal-workspace-section-count">{data.documents.length}</span>
                  {editable && (
                    <label className="deal-workspace-upload">
                      <input
                        type="file"
                        multiple
                        onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) onUpload(fs); e.target.value = ''; }}
                        disabled={uploading}
                        style={{ display: 'none' }}
                      />
                      <span className="deal-workspace-upload-btn">{uploading ? 'Uploading…' : '+ Upload'}</span>
                    </label>
                  )}
                </h3>
                {editable && (
                  <div className="deal-workspace-drop-hint">Drag files anywhere in this section to add them. Any format accepted.</div>
                )}
                {uploadError && <div className="deal-workspace-error" style={{ padding: '4px 0' }}>{uploadError}</div>}

                {/* Connector bindings — sync from SharePoint / Drive folders.
                    Sits above the doc list so the source-of-truth is obvious
                    before the synced files appear below. */}
                <DealConnectorBindings dealId={dealId} accessToken={accessToken} editable={editable} />

                {/* Expected-docs checklist — collapsed by default. The header
                    counter ("3 / 12 received") gives the at-a-glance state;
                    expanding lists each item with received docs linked. */}
                {checklist && checklist.checklist?.length > 0 && (
                  <div className={`deal-workspace-checklist${checklistOpen ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="deal-workspace-checklist-toggle"
                      onClick={() => setChecklistOpen((v) => !v)}
                      aria-expanded={checklistOpen}
                    >
                      <span aria-hidden>{checklistOpen ? '−' : '+'}</span>
                      <span>Expected documents</span>
                      <span className="deal-workspace-checklist-count">
                        {checklist.summary.received} / {checklist.summary.total} received
                      </span>
                    </button>
                    {checklistOpen && (
                      <ul className="deal-workspace-checklist-list">
                        {checklist.checklist.map((item) => {
                          const has = item.matched.length > 0;
                          return (
                            <li key={item.id} className={`deal-workspace-checklist-item${has ? ' is-matched' : ' is-missing'}`}>
                              <span className="deal-workspace-checklist-mark" aria-hidden>{has ? '✓' : '○'}</span>
                              <span className="deal-workspace-checklist-label">{item.label}</span>
                              {has && (
                                <span className="deal-workspace-checklist-matched">
                                  {item.matched.slice(0, 2).map((m, i) => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className="deal-workspace-checklist-doclink"
                                      onClick={() => {
                                        const full = data.documents.find((d) => d.id === m.id);
                                        if (full) openDoc(full);
                                      }}
                                      title={m.filename}
                                    >{m.filename.length > 32 ? `${m.filename.slice(0, 30)}…` : m.filename}{i < Math.min(item.matched.length, 2) - 1 ? ', ' : ''}</button>
                                  ))}
                                  {item.matched.length > 2 && <span className="deal-workspace-checklist-more"> +{item.matched.length - 2}</span>}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {data.documents.length === 0 ? (
                  <p className="deal-workspace-empty">No documents yet.</p>
                ) : (
                  <ul className="deal-workspace-list">
                    {data.documents.map((d) => {
                      // `ready` and `stored` are both terminal/openable; only
                      // `failed` and the in-flight statuses block the link.
                      const openable = d.status === 'ready' || d.status === 'stored';
                      return (
                        <li key={d.id} className="deal-workspace-row">
                          <span className={`deal-workspace-status deal-workspace-status--${d.status}`} title={d.processing_error || d.status}>{d.status}</span>
                          {openable ? (
                            <button
                              type="button"
                              className="deal-workspace-name deal-workspace-name--link"
                              onClick={() => openDoc(d)}
                              disabled={openingDocId === d.id}
                            >
                              {d.filename}
                            </button>
                          ) : (
                            <span className="deal-workspace-name">{d.filename}</span>
                          )}
                          <span className="deal-workspace-sub">
                            {[
                              d.category,
                              d.source_party,
                              d.page_count ? `${d.page_count}p` : null,
                              d.byte_size ? `${(d.byte_size / 1024).toFixed(0)} KB` : null,
                            ].filter(Boolean).join(' · ')}
                            {openingDocId === d.id && ' · opening…'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Q&A queue — questions to seller + their answers. Distinct
                  from the chat (free-form) and findings (model-generated). */}
              <section className="deal-workspace-section">
                <h3 className="deal-workspace-section-title">
                  Q&amp;A
                  <span className="deal-workspace-section-count">{qaSummary.open}</span>
                  <span className="deal-workspace-section-sub">
                    {qaSummary.open} open · {qaSummary.answered} answered{qaSummary.skipped ? ` · ${qaSummary.skipped} skipped` : ''}
                  </span>
                </h3>
                {editable && (
                  <div className="deal-qa-composer">
                    <textarea
                      className="deal-qa-input"
                      value={qaDraft}
                      onChange={(e) => setQaDraft(e.target.value)}
                      placeholder="Ask the seller a question…"
                      rows={2}
                      disabled={qaBusy}
                    />
                    <div className="deal-qa-composer-row">
                      {data.participants.length > 0 && (
                        <select
                          className="deal-qa-assign"
                          value={qaAssignParticipant}
                          onChange={(e) => setQaAssignParticipant(e.target.value)}
                          disabled={qaBusy}
                        >
                          <option value="">Unassigned</option>
                          {data.participants.map((p) => (
                            <option key={p.id} value={p.id}>{p.company_name || p.companyName} · {p.role}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="deal-qa-submit"
                        onClick={askQuestion}
                        disabled={qaBusy || !qaDraft.trim()}
                      >Ask</button>
                    </div>
                  </div>
                )}
                {qaItems.length === 0 ? (
                  <p className="deal-workspace-empty">No questions yet.</p>
                ) : (
                  <ul className="deal-qa-list">
                    {qaItems.map((q) => {
                      // Server enforces who can PATCH (editor or assigned
                      // participant). We over-show the answer composer for
                      // editors; participants will see it via their own deal
                      // workspace and the server will accept their PATCH.
                      const canAnswer = editable;
                      return (
                        <li key={q.id} className={`deal-qa-item deal-qa-item--${q.status}`}>
                          <div className="deal-qa-head">
                            <span className={`deal-qa-status deal-qa-status--${q.status}`}>{q.status}</span>
                            <span className="deal-qa-question">{q.question}</span>
                            {q.assigned_company && (
                              <span className="deal-qa-assignee" title="Assigned to">→ {q.assigned_company}</span>
                            )}
                          </div>
                          <div className="deal-qa-meta">
                            asked by {q.asked_by_email} · {new Date(q.asked_at).toLocaleDateString()}
                            {q.answered_at && ` · answered ${new Date(q.answered_at).toLocaleDateString()}`}
                          </div>
                          {q.answer_text && (
                            <div className="deal-qa-answer">{q.answer_text}</div>
                          )}
                          {q.status === 'open' && canAnswer && (
                            <div className="deal-qa-answer-composer">
                              <textarea
                                className="deal-qa-input deal-qa-input--answer"
                                value={qaAnswerDraft[q.id] || ''}
                                onChange={(e) => setQaAnswerDraft((d) => ({ ...d, [q.id]: e.target.value }))}
                                placeholder="Answer…"
                                rows={2}
                                disabled={qaBusy}
                              />
                              <div className="deal-qa-composer-row">
                                <button type="button" className="deal-qa-submit" onClick={() => submitAnswer(q.id)} disabled={qaBusy || !(qaAnswerDraft[q.id] || '').trim()}>Submit answer</button>
                                {editable && (
                                  <button type="button" className="deal-qa-skip" onClick={() => updateQa(q.id, { status: 'skipped' })} disabled={qaBusy}>Skip</button>
                                )}
                              </div>
                            </div>
                          )}
                          {editable && q.status !== 'open' && (
                            <div className="deal-qa-actions">
                              <button type="button" className="deal-qa-skip" onClick={() => updateQa(q.id, { status: 'open', answer_text: null })} disabled={qaBusy}>Reopen</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Findings */}
              {(() => {
                // Split findings by section so we can render the exec summary
                // and key takeaways as their own blocks (matches DealDiligenceReport).
                const exec = data.findings.find((f) => f.section === 'executiveSummary') || null;
                const keyTakeaways = data.findings.filter((f) => f.section === 'keyFindings');
                const bodyFindings = data.findings.filter((f) => f.section !== 'executiveSummary' && f.section !== 'keyFindings');
                return (
                  <section className="deal-workspace-section">
                    <h3 className="deal-workspace-section-title">
                      Findings <span className="deal-workspace-section-count">{data.findings.length}</span>
                      {data.analysis && <span className="deal-workspace-section-sub">{data.analysis.mode} · {data.analysis.created_at?.slice(0, 10)}{data.analysis.auto_triggered ? ' · auto' : ''}</span>}
                      {data.newFindingKeys?.size > 0 && (
                        <span className="deal-workspace-new-badge" title="Findings added in this run that weren't in the previous run">
                          {data.newFindingKeys.size} new
                        </span>
                      )}
                      {data.findings.length > 0 && (
                        <span className="deal-workspace-tabs" role="tablist" aria-label="Findings view">
                          <button type="button" role="tab" aria-selected={findingsLens === 'list'}
                            className={`deal-workspace-tab${findingsLens === 'list' ? ' active' : ''}`}
                            onClick={() => setFindingsLens('list')}>List</button>
                          <button type="button" role="tab" aria-selected={findingsLens === 'crosscut'}
                            className={`deal-workspace-tab${findingsLens === 'crosscut' ? ' active' : ''}`}
                            onClick={() => setFindingsLens('crosscut')}>Day-1 / TSA / Separation</button>
                        </span>
                      )}
                    </h3>

                    {/* Executive summary banner */}
                    {exec && findingsLens === 'list' && (
                      <ExecSummaryBanner finding={exec} review={data.reviewsByKey[exec.finding_key || exec.key]} />
                    )}

                    {data.findings.length === 0 ? (
                      loadingFindings ? (
                        <p className="deal-workspace-empty">Loading findings…</p>
                      ) : (
                        <p className="deal-workspace-empty">No findings yet — run a diligence analysis to surface them.</p>
                      )
                    ) : findingsLens === 'crosscut' ? (
                      <CrosscutColumns findings={bodyFindings} reviewsByKey={data.reviewsByKey} dealId={dealId} />
                    ) : (
                  <ul className="deal-workspace-list">
                    {bodyFindings.map((f) => {
                      const key = f.key || f.finding_key;
                      const review = data.reviewsByKey[key];
                      const status = review?.status || 'pending';
                      const busy = reviewBusyKey === key;
                      const noteOpen = openNoteKey === key;
                      const editOpen = openEditKey === key;
                      const noteDraft = noteDraftByKey[key] ?? (review?.reviewer_note || '');
                      const hasNote = Boolean((review?.reviewer_note || '').trim());
                      // Display = edited values when the reviewer has overridden,
                      // else the agent's original. Mirror DealDiligenceReport.
                      const displayedTitle = review?.edited_title || f.title;
                      const displayedBody  = review?.edited_body  || f.body || '';
                      const editDraft = editDraftByKey[key] || { title: displayedTitle, body: displayedBody };
                      const isEdited = Boolean((review?.edited_title || review?.edited_body || '').trim());
                      const editDirty = editDraft.title !== displayedTitle || editDraft.body !== displayedBody;
                      const expanded = expandedFindingKeys.has(key);
                      const pulse    = pulseFindingKey === key;

                      return (
                        <li
                          key={key}
                          id={`workspace-finding-${key}`}
                          className={`deal-workspace-row deal-workspace-row--finding${pulse ? ' deal-workspace-row--pulse' : ''}`}
                        >
                          <div className="deal-workspace-row-main">
                            <button
                              type="button"
                              className={`deal-workspace-expand${expanded ? ' deal-workspace-expand--open' : ''}`}
                              onClick={() => setExpandedFindingKeys((s) => {
                                const n = new Set(s);
                                if (n.has(key)) n.delete(key); else n.add(key);
                                return n;
                              })}
                              aria-label={expanded ? 'Collapse finding details' : 'Expand finding details'}
                              aria-expanded={expanded}
                            >▸</button>
                            {f.severity && (
                              <span className={`deal-workspace-sev ${SEVERITY_PILL[f.severity] || ''}`}>{f.severity}</span>
                            )}
                            <button
                              type="button"
                              className="deal-workspace-name deal-workspace-name--link"
                              onClick={() => setExpandedFindingKeys((s) => {
                                const n = new Set(s);
                                if (n.has(key)) n.delete(key); else n.add(key);
                                return n;
                              })}
                              style={{ flex: '1 1 auto', minWidth: 120 }}
                            >
                              {data.newFindingKeys?.has(key) && (
                                <span className="deal-workspace-finding-new" title="New since last analysis">NEW</span>
                              )}
                              {f.stale && (
                                <span
                                  className="deal-workspace-finding-stale"
                                  title={f.stale_reason || 'Cited document changed — verify before relying on this finding.'}
                                >STALE</span>
                              )}
                              {displayedTitle}
                              {isEdited && <span className="deal-workspace-edited-flag" title="Edited by reviewer">·edited</span>}
                            </button>
                            <span className="deal-workspace-sub">{f.section || f.category || ''}</span>
                            <span className={`deal-workspace-review deal-workspace-review--${status}`}>{status}</span>
                            {editable && (
                              <span className="deal-workspace-review-actions">
                                <button type="button" className="deal-workspace-review-btn deal-workspace-review-btn--ok"
                                  onClick={() => submitReview(key, 'approved')} disabled={busy || status === 'approved'}
                                  title="Approve">✓</button>
                                <button type="button" className="deal-workspace-review-btn deal-workspace-review-btn--no"
                                  onClick={() => submitReview(key, 'rejected')} disabled={busy || status === 'rejected'}
                                  title="Reject">✕</button>
                                <button type="button" className="deal-workspace-review-btn"
                                  onClick={() => submitReview(key, 'needs_revision')} disabled={busy || status === 'needs_revision'}
                                  title="Needs revision">?</button>
                                <button type="button"
                                  className={`deal-workspace-review-btn${hasNote ? ' deal-workspace-review-btn--has-note' : ''}`}
                                  onClick={() => { setOpenEditKey(null); setOpenNoteKey(noteOpen ? null : key); }}
                                  title={hasNote ? 'Edit reviewer note' : 'Add reviewer note'}
                                >✎</button>
                                <button type="button"
                                  className={`deal-workspace-review-btn${isEdited ? ' deal-workspace-review-btn--has-note' : ''}`}
                                  onClick={() => { setOpenNoteKey(null); setOpenEditKey(editOpen ? null : key); }}
                                  title={isEdited ? 'Edit finding text (already overridden)' : 'Edit finding title / body'}
                                >✏</button>
                              </span>
                            )}
                          </div>

                          {expanded && (
                            <>
                              <FindingDetail
                                finding={f}
                                review={review}
                                displayedBody={displayedBody}
                                dealId={dealId}
                                accessToken={accessToken}
                              />
                              <FindingTagsChips
                                tags={Array.isArray(f.tags) ? f.tags : []}
                                disabled={!editable}
                                onToggle={(tag) => toggleFindingTag(key, tag)}
                              />
                              {f.stale && editable && (
                                <div className="deal-workspace-stale-bar">
                                  <span>{f.stale_reason || 'Cited document changed.'}</span>
                                  <button
                                    type="button"
                                    className="deal-workspace-stale-clear"
                                    onClick={async () => {
                                      if (!data.analysis?.id) return;
                                      const r = await apiFetch(
                                        `/api/deals/${dealId}/analyses/${data.analysis.id}/findings/${encodeURIComponent(key)}`,
                                        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stale: false }) },
                                        accessToken,
                                      );
                                      if (r.ok) {
                                        setData((prev) => ({
                                          ...prev,
                                          findings: prev.findings.map((x) => (
                                            (x.key || x.finding_key) === key
                                              ? { ...x, stale: false, stale_reason: null }
                                              : x
                                          )),
                                        }));
                                      }
                                    }}
                                  >Mark verified</button>
                                </div>
                              )}
                              <FindingCommentThread
                                comments={findingComments[key]}
                                draft={findingCommentDraft[key] || ''}
                                onLoad={() => loadFindingComments(key)}
                                onDraftChange={(text) => setFindingCommentDraft((d) => ({ ...d, [key]: text }))}
                                onPost={() => postFindingComment(key)}
                              />
                            </>
                          )}

                          {noteOpen && editable && (
                            <div className="deal-workspace-note">
                              <textarea
                                className="deal-workspace-note-input"
                                value={noteDraft}
                                onChange={(e) => setNoteDraftByKey((s) => ({ ...s, [key]: e.target.value }))}
                                placeholder="Reviewer note (visible to other editors)…"
                                rows={3}
                                disabled={busy}
                              />
                              <div className="deal-workspace-note-actions">
                                <button
                                  type="button"
                                  className="deal-workspace-note-btn deal-workspace-note-btn--primary"
                                  disabled={busy || noteDraft === (review?.reviewer_note || '')}
                                  onClick={async () => {
                                    await submitReviewWithNote(key, status, noteDraft);
                                    setOpenNoteKey(null);
                                  }}
                                >
                                  {busy ? 'Saving…' : 'Save note'}
                                </button>
                                <button
                                  type="button"
                                  className="deal-workspace-note-btn"
                                  onClick={() => {
                                    setNoteDraftByKey((s) => ({ ...s, [key]: review?.reviewer_note || '' }));
                                    setOpenNoteKey(null);
                                  }}
                                  disabled={busy}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {editOpen && editable && (
                            <div className="deal-workspace-note">
                              <input
                                className="deal-workspace-note-input"
                                value={editDraft.title}
                                onChange={(e) => setEditDraftByKey((s) => ({ ...s, [key]: { ...editDraft, title: e.target.value } }))}
                                placeholder="Finding title"
                                disabled={busy}
                              />
                              <textarea
                                className="deal-workspace-note-input"
                                value={editDraft.body}
                                onChange={(e) => setEditDraftByKey((s) => ({ ...s, [key]: { ...editDraft, body: e.target.value } }))}
                                placeholder="Finding body — explanation, impact, evidence cited inline…"
                                rows={5}
                                disabled={busy}
                              />
                              <div className="deal-workspace-note-actions">
                                <button
                                  type="button"
                                  className="deal-workspace-note-btn deal-workspace-note-btn--primary"
                                  disabled={busy || !editDirty}
                                  onClick={async () => {
                                    await submitReviewWithEdits(key, status, {
                                      editedTitle: editDraft.title,
                                      editedBody:  editDraft.body,
                                    });
                                    setOpenEditKey(null);
                                  }}
                                >
                                  {busy ? 'Saving…' : 'Save edits'}
                                </button>
                                {isEdited && (
                                  <button
                                    type="button"
                                    className="deal-workspace-note-btn"
                                    onClick={async () => {
                                      // Revert: send empty strings to clear the override.
                                      await submitReviewWithEdits(key, status, { editedTitle: '', editedBody: '' });
                                      setEditDraftByKey((s) => ({ ...s, [key]: { title: f.title, body: f.body || '' } }));
                                      setOpenEditKey(null);
                                    }}
                                    disabled={busy}
                                    title="Revert to the original agent-generated text"
                                  >
                                    Revert to original
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="deal-workspace-note-btn"
                                  onClick={() => {
                                    setEditDraftByKey((s) => ({ ...s, [key]: { title: displayedTitle, body: displayedBody } }));
                                    setOpenEditKey(null);
                                  }}
                                  disabled={busy}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {!noteOpen && hasNote && (
                            <div className="deal-workspace-note-preview" title={review.reviewer_note}>
                              <span className="deal-workspace-note-preview-label">Note:</span> {review.reviewer_note}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                    {/* Key Takeaways block */}
                    {findingsLens === 'list' && keyTakeaways.length > 0 && (
                      <div className="deal-workspace-takeaways">
                        <h4 className="deal-workspace-takeaways-title">📌 Key Takeaways</h4>
                        <ul className="deal-workspace-list">
                          {keyTakeaways.map((f) => {
                            const key = f.key || f.finding_key;
                            const review = data.reviewsByKey[key];
                            const status = review?.status || 'pending';
                            return (
                              <li key={key} className="deal-workspace-row">
                                {f.severity && (
                                  <span className={`deal-workspace-sev ${SEVERITY_PILL[f.severity] || ''}`}>{f.severity}</span>
                                )}
                                <span className="deal-workspace-name" style={{ flex: '1 1 auto' }}>{review?.edited_title || f.title}</span>
                                <span className={`deal-workspace-review deal-workspace-review--${status}`}>{status}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* Per-deal activity timeline — collapsed by default. Lazy-loaded
                  on first expand so the modal first paint isn't slowed. */}
              <DealActivityTimeline dealId={dealId} accessToken={accessToken} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
