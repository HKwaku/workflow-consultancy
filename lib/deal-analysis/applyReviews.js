/**
 * Apply review decisions to an analysis result so the rendered report
 * reflects the approval state.
 *
 * Hide rules (in this order):
 *   - rejected           -> always hidden
 *   - pending or needs_revision -> hidden when viewerMode='public'
 *                                   shown (with status badge) when viewerMode='editor'
 *   - approved           -> always shown
 *   - no review row      -> treated as 'pending'
 *
 * Edited title/body in the review row override the AI-generated values.
 *
 * Pure / synchronous; safe to call on the server during render or on the
 * client after fetching reviews.
 */

const HIDDEN_FOR_PUBLIC = new Set(['pending', 'rejected', 'needs_revision']);
const HIDDEN_FOR_EDITOR = new Set(['rejected']);

const FINDING_PATHS = [
  'findings',
  'mergeRecommendations',
  'opportunities',
  'integrationRisks',
  'risks',
  'redFlags',
  'keyFindings',
  'technologyLandscape',
  'operationalFootprint',
  'organisation',
];

const SINGLETON_PATHS = ['executiveSummary'];

export function applyReviewsToAnalysis(analysisResult, reviews, viewerMode = 'public') {
  if (!analysisResult || typeof analysisResult !== 'object') return analysisResult;
  const reviewMap = new Map();
  for (const r of reviews || []) {
    if (r?.finding_key) reviewMap.set(r.finding_key, r);
  }
  const hidden = viewerMode === 'editor' ? HIDDEN_FOR_EDITOR : HIDDEN_FOR_PUBLIC;

  const decorate = (f) => {
    if (!f || !f.key) return f;
    const review = reviewMap.get(f.key);
    const status = review?.status || 'pending';
    if (hidden.has(status)) return null;
    if (!review) return { ...f, _review: { status: 'pending' } };
    return {
      ...f,
      title: review.edited_title || f.title,
      body:  review.edited_body  || f.body,
      _review: {
        status,
        reviewer_note: review.reviewer_note,
        decided_by_email: review.decided_by_email,
        decided_at: review.decided_at,
      },
    };
  };

  const out = { ...analysisResult };
  for (const path of FINDING_PATHS) {
    const arr = analysisResult[path];
    if (!Array.isArray(arr)) continue;
    out[path] = arr.map(decorate).filter(Boolean);
  }
  for (const path of SINGLETON_PATHS) {
    const f = analysisResult[path];
    if (f && typeof f === 'object' && !Array.isArray(f)) {
      const decorated = decorate(f);
      // For singletons we keep null (gives the renderer a chance to hide the
      // section entirely) rather than omitting the key.
      out[path] = decorated;
    }
  }
  return out;
}

/** Convenience: count findings by status for a header badge. */
export function summariseReviewStatus(analysisResult, reviews) {
  const reviewMap = new Map((reviews || []).map((r) => [r.finding_key, r.status]));
  const counts = { approved: 0, pending: 0, rejected: 0, needs_revision: 0, total: 0 };
  const tally = (f) => {
    if (!f?.key) return;
    counts.total += 1;
    counts[reviewMap.get(f.key) || 'pending'] += 1;
  };
  for (const path of FINDING_PATHS) {
    const arr = analysisResult?.[path];
    if (Array.isArray(arr)) arr.forEach(tally);
  }
  for (const path of SINGLETON_PATHS) {
    tally(analysisResult?.[path]);
  }
  return counts;
}
