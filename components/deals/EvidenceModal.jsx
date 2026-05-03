'use client';

/**
 * EvidenceModal
 *
 * Opens when a user clicks an evidence row in FindingCard. Two views:
 *
 * 1. Chunk view (default): the cited chunk + 1 chunk either side for context,
 *    with the target chunk highlighted. Lets the user verify the citation
 *    without leaving the page.
 *
 * 2. Source view: a signed Storage URL pointing at the original bytes.
 *    Renders inline for browser-supported types (PDF), falls back to a
 *    download link otherwise.
 *
 * Only renders for `kind: 'document_chunk'` evidence — other kinds (chat,
 * process_step, metric) are click-through-only inside their own surfaces.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function buildLocator(meta) {
  if (!meta) return '';
  return [
    meta.filename,
    meta.page_number ? `p.${meta.page_number}` : null,
    meta.slide_number ? `slide ${meta.slide_number}` : null,
    meta.sheet_name ? `sheet ${meta.sheet_name}` : null,
    meta.cell_range ? `range ${meta.cell_range}` : null,
    meta.section_path,
  ].filter(Boolean).join(' · ');
}

function isInlineable(mime) {
  if (!mime) return false;
  return mime === 'application/pdf'
      || mime.startsWith('image/')
      || mime.startsWith('text/');
}

export default function EvidenceModal({ dealId, evidence, accessToken, onClose }) {
  const [view, setView] = useState('chunks'); // 'chunks' | 'source'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawUrl, setRawUrl] = useState(null);
  const [rawLoading, setRawLoading] = useState(false);

  const ref = evidence?.ref || {};
  const docId   = ref.document_id;
  const chunkId = ref.chunk_id;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!dealId || !docId || !accessToken) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const url = chunkId
          ? `/api/deals/${dealId}/documents/${docId}/preview?chunk_id=${chunkId}&context=1`
          : `/api/deals/${dealId}/documents/${docId}/preview?context=0`;
        const resp = await apiFetch(url, {}, accessToken);
        const json = await resp.json();
        if (cancelled) return;
        if (!resp.ok) setError(json.error || 'Failed to load preview.');
        else setData(json);
      } catch {
        if (!cancelled) setError('Network error loading preview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [dealId, docId, chunkId, accessToken]);

  const loadRaw = async () => {
    if (rawUrl || rawLoading) { setView('source'); return; }
    setRawLoading(true);
    try {
      const resp = await apiFetch(`/api/deals/${dealId}/documents/${docId}/preview?raw=1`, {}, accessToken);
      const json = await resp.json();
      if (resp.ok) {
        setRawUrl(json);
        setView('source');
      } else {
        setError(json.error || 'Failed to load source file.');
      }
    } catch {
      setError('Network error loading source file.');
    } finally {
      setRawLoading(false);
    }
  };

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!evidence) return null;

  const targetChunkId = data?.target_chunk_id;
  const filename = data?.document?.filename || ref.filename || '';
  const mime     = data?.document?.mime_type || '';

  return (
    <div className="evmodal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="evmodal" onClick={(e) => e.stopPropagation()}>
        <header className="evmodal-header">
          <div className="evmodal-title-block">
            <h3 className="evmodal-title">{filename || 'Source evidence'}</h3>
            <p className="evmodal-locator">{buildLocator({ filename, ...ref })}</p>
          </div>
          <div className="evmodal-tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={view === 'chunks'}
              className={`evmodal-tab ${view === 'chunks' ? 'evmodal-tab--active' : ''}`}
              onClick={() => setView('chunks')}
            >
              Cited passage
            </button>
            <button
              type="button" role="tab" aria-selected={view === 'source'}
              className={`evmodal-tab ${view === 'source' ? 'evmodal-tab--active' : ''}`}
              onClick={loadRaw}
              disabled={rawLoading}
            >
              {rawLoading ? 'Loading…' : 'Source file'}
            </button>
          </div>
          <button type="button" className="evmodal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="evmodal-body">
          {error && <div className="evmodal-error">{error}</div>}

          {view === 'chunks' && (
            loading ? (
              <p className="evmodal-loading">Loading…</p>
            ) : data ? (
              <div className="evmodal-chunks">
                {(data.chunks || []).map((c) => {
                  const isTarget = c.id === targetChunkId;
                  return (
                    <div key={c.id} className={`evmodal-chunk ${isTarget ? 'evmodal-chunk--target' : ''}`}>
                      <div className="evmodal-chunk-loc">
                        {buildLocator(c)}
                        {isTarget && <span className="evmodal-chunk-target-pill">Cited</span>}
                      </div>
                      <pre className="evmodal-chunk-body">{c.content}</pre>
                    </div>
                  );
                })}
              </div>
            ) : null
          )}

          {view === 'source' && rawUrl && (
            isInlineable(mime || rawUrl.mime_type) ? (
              <iframe
                title={filename}
                src={rawUrl.url}
                className="evmodal-iframe"
              />
            ) : (
              <div className="evmodal-download-fallback">
                <p>{filename} cannot be previewed inline.</p>
                <a className="deal-btn deal-btn--primary" href={rawUrl.url} target="_blank" rel="noopener noreferrer">
                  Open / download
                </a>
              </div>
            )
          )}
        </div>

        <footer className="evmodal-footer">
          <span className="evmodal-foot-note">
            Source link expires in {Math.round((rawUrl?.expires_in || 300) / 60)} min — re-open the modal to refresh.
          </span>
          <button type="button" className="deal-btn" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
