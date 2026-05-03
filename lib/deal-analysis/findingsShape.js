/**
 * Canonical shape for AI-generated findings in deal analyses.
 *
 * Every finding the model emits MUST carry:
 *   - title           - short headline
 *   - body            - 1-3 sentence explanation
 *   - category        - free-form bucket (e.g. "systems", "headcount", "contracts")
 *   - severity        - low | medium | high | critical
 *   - confidence      - 0..1; gates the human-review queue
 *   - impact[]        - array of: 'day_one' | 'tsa' | 'separation' | 'long_term'
 *   - evidence[]      - source pointers; see EVIDENCE_KINDS
 *   - recommendations - array of short action strings
 *
 * Stable per-finding id ("finding_key") is computed by `findingKey()` from
 * (category + title). The same finding produced by a re-run keeps the same
 * key, so reviewer decisions in deal_finding_reviews carry forward.
 */

import crypto from 'node:crypto';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const IMPACT_AXES = ['day_one', 'tsa', 'separation', 'long_term'];
export const EVIDENCE_KINDS = [
  'document_chunk', // ref = { chunk_id, document_id, page|slide|sheet|range, snippet }
  'process_step',   // ref = { report_id, step_index, step_name }
  'chat_turn',      // ref = { session_id, message_id }
  'metric',         // ref = { source: 'cost_analysis'|'diagnostic_report', report_id, field }
];

/** Stable id for a finding within an analysis result. 12-char sha1 prefix. */
export function findingKey({ category, title }) {
  const seed = `${(category || '').trim().toLowerCase()}::${(title || '').trim().toLowerCase()}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

/**
 * Validate + normalise a single finding. Returns { ok, finding, error }.
 * Tolerant: missing optional fields default; obviously bad shapes are rejected.
 */
export function normaliseFinding(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not an object' };
  const title = String(raw.title || '').trim();
  const body  = String(raw.body || raw.description || '').trim();
  if (!title) return { ok: false, error: 'Missing title' };

  const category = String(raw.category || 'general').trim().toLowerCase();
  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : 'medium';
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  const impact = Array.isArray(raw.impact)
    ? raw.impact.filter((i) => IMPACT_AXES.includes(i))
    : [];

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter((e) => e && typeof e === 'object' && EVIDENCE_KINDS.includes(e.kind))
        .map((e) => ({
          kind: e.kind,
          ref: e.ref || {},
          snippet: typeof e.snippet === 'string' ? e.snippet.slice(0, 400) : undefined,
        }))
    : [];

  const recommendations = Array.isArray(raw.recommendations)
    ? raw.recommendations.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim())
    : [];

  const finding = {
    key: findingKey({ category, title }),
    title,
    body,
    category,
    severity,
    confidence,
    impact,
    evidence,
    recommendations,
    // Stripped before persistence by the caller. Used by verifyEvidence() to
    // distinguish "had no evidence to begin with" from "all evidence was
    // invalidated post-hoc".
    _originalEvidenceCount: evidence.length,
  };
  return { ok: true, finding };
}

/** Walk an analysis result, normalise every finding, attach .key. Returns { findings, perPath }. */
export function normaliseFindings(analysisResult) {
  if (!analysisResult || typeof analysisResult !== 'object') return { findings: [], perPath: {} };

  // Finding-bearing arrays we look for inside the result, by mode.
  const FINDING_PATHS = [
    'findings',              // generic / future mode
    'mergeRecommendations',  // comparison mode
    'opportunities',         // synergy mode
    'integrationRisks',      // synergy mode
    'risks',                 // redesign mode
    'redFlags',              // diligence mode
    'keyFindings',           // diligence mode
    'technologyLandscape',   // diligence mode
    'operationalFootprint',  // diligence mode
    'organisation',          // diligence mode
  ];

  const findings = [];
  const perPath = {};

  // Some sections hold a single finding rather than an array — normalise
  // those in place so the renderer doesn't need a special case.
  const SINGLETON_PATHS = ['executiveSummary'];
  for (const path of SINGLETON_PATHS) {
    const raw = analysisResult[path];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const { ok, finding } = normaliseFinding({
        ...raw,
        title: raw.title || raw.finding || raw.risk || raw.name || 'Executive Summary',
        body:  raw.body  || raw.rationale || raw.description || '',
        category: raw.category || path,
      });
      if (ok) {
        analysisResult[path] = finding; // mutate caller-supplied object
        findings.push(finding);
      }
    }
  }

  for (const path of FINDING_PATHS) {
    const arr = analysisResult[path];
    if (!Array.isArray(arr)) continue;
    perPath[path] = [];
    for (const raw of arr) {
      const { ok, finding } = normaliseFinding({
        ...raw,
        title: raw.title || raw.finding || raw.risk || raw.name,
        body:  raw.body  || raw.rationale || raw.description || raw.mitigation || raw.action || '',
        category: raw.category || path,
      });
      if (!ok) continue;
      findings.push(finding);
      perPath[path].push(finding);
    }
  }
  return { findings, perPath };
}

/**
 * Verify that document_chunk evidence pointers resolve to real chunks and
 * that the snippet (if present) appears in the chunk's content. Mutates the
 * findings array in place — drops findings whose ALL evidence pointers are
 * invalid; downgrades confidence on findings whose snippets don't match.
 *
 * Why this exists: the model is prompted to cite chunk_ids from the excerpts
 * we showed it, but nothing structurally prevents it from making them up.
 * This validator is the cheap belt-and-braces check the Anthropic-native
 * Citations API would give us — see the SDK landscape note in
 * DIAGNOSTICS_CAPABILITIES.md for why we didn't switch to that.
 *
 * Strictness levers (sensible defaults; tune from telemetry):
 *   - Invalid chunk_id           -> drop the evidence pointer
 *   - Snippet mismatch (no overlap)  -> drop the evidence pointer + downgrade confidence by 0.2
 *   - Snippet partial match (>=60%)  -> keep, no downgrade (model often paraphrases)
 *   - Finding with zero surviving evidence pointers -> dropped entirely
 *
 * Non-document_chunk evidence (process_step / chat_turn / metric) is
 * pass-through. We can't cheaply verify those without more context.
 *
 * @param {{findings, perPath}} findingsBundle  Output of normaliseFindings()
 * @param {Map<string, {content: string, document_id: string}>} chunkIndex
 *        Keyed by chunk_id. Caller fetches before calling.
 * @returns {{droppedFindings, downgradedFindings, droppedEvidence}}
 */
export function verifyEvidence(findingsBundle, chunkIndex) {
  if (!findingsBundle || !findingsBundle.findings) {
    return { droppedFindings: 0, downgradedFindings: 0, droppedEvidence: 0 };
  }
  const stats = { droppedFindings: 0, downgradedFindings: 0, droppedEvidence: 0 };

  const verifyOne = (finding) => {
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) return finding;

    const surviving = [];
    let downgraded = false;

    for (const ev of finding.evidence) {
      if (ev.kind !== 'document_chunk') {
        // Pass-through for kinds we can't verify here.
        surviving.push(ev);
        continue;
      }

      const chunkId = ev?.ref?.chunk_id;
      const chunk = chunkId ? chunkIndex.get(chunkId) : null;
      if (!chunk) {
        // Invalid pointer — drop and downgrade.
        stats.droppedEvidence += 1;
        downgraded = true;
        continue;
      }

      // Snippet check (only when the model gave one).
      if (ev.snippet && ev.snippet.length > 12) {
        const score = snippetOverlap(ev.snippet, chunk.content);
        if (score < 0.6) {
          stats.droppedEvidence += 1;
          downgraded = true;
          continue;
        }
      }
      surviving.push(ev);
    }

    if (downgraded) {
      finding.confidence = Math.max(0, (finding.confidence ?? 0.5) - 0.2);
      stats.downgradedFindings += 1;
    }
    finding.evidence = surviving;
    return finding;
  };

  const SECTION_PATHS = [
    'findings', 'mergeRecommendations', 'opportunities', 'integrationRisks',
    'risks', 'redFlags', 'keyFindings',
    'technologyLandscape', 'operationalFootprint', 'organisation',
  ];

  for (const path of SECTION_PATHS) {
    const arr = findingsBundle.perPath?.[path];
    if (!Array.isArray(arr)) continue;
    const kept = [];
    for (const f of arr) {
      const verified = verifyOne(f);
      // Drop the finding only when (a) it originally claimed evidence and
      // (b) every pointer was invalidated. Findings that legitimately had
      // empty evidence to begin with stay (the renderer flags them with the
      // "⚠ no evidence cited" warning).
      if (verified.evidence.length === 0 && (f._originalEvidenceCount ?? 0) > 0) {
        stats.droppedFindings += 1;
        continue;
      }
      kept.push(verified);
    }
    findingsBundle.perPath[path] = kept;
  }

  // Rebuild the flat list from perPath so callers see the post-validation set.
  findingsBundle.findings = Object.values(findingsBundle.perPath).flat();

  // Singleton executiveSummary lives outside perPath but inside the original
  // result object — caller is responsible for verifying it separately.
  return stats;
}

/**
 * Convenience: run verifyEvidence over a single finding (e.g. the singleton
 * executiveSummary). Returns the (possibly-mutated) finding or null if it
 * should be dropped.
 */
export function verifyEvidenceForFinding(finding, chunkIndex) {
  if (!finding) return null;
  const originalCount = (finding.evidence || []).length;
  const bundle = { findings: [finding], perPath: { _singleton: [finding] } };
  // Tag for the drop-rule
  finding._originalEvidenceCount = originalCount;
  verifyEvidence(bundle, chunkIndex);
  delete finding._originalEvidenceCount;
  return bundle.perPath._singleton[0] || null;
}

/**
 * Lightweight overlap score between a snippet and a chunk's full content.
 * Strategy: case-insensitive longest-common-substring length / snippet length.
 * Returns 0..1. Cheap; not a perfect fuzzy match but catches obvious
 * hallucinations while tolerating paraphrasing.
 */
function snippetOverlap(snippet, content) {
  if (!snippet || !content) return 0;
  const s = snippet.toLowerCase().replace(/\s+/g, ' ').trim();
  const c = content.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s || !c) return 0;
  if (c.includes(s)) return 1;

  // Sliding-window of 5+ word phrases — count how many appear in content.
  const words = s.split(' ');
  if (words.length < 3) {
    // Tiny snippet; fall back to char-substring at length 16 minimum
    const probe = s.slice(0, Math.min(16, s.length));
    return c.includes(probe) ? 0.7 : 0;
  }
  const window = 5;
  let hits = 0, total = 0;
  for (let i = 0; i + window <= words.length; i++) {
    total += 1;
    if (c.includes(words.slice(i, i + window).join(' '))) hits += 1;
  }
  if (total === 0) return 0;
  return hits / total;
}

/**
 * Block of prompt text to inject into every analysis system prompt. Tells the
 * model the new required fields. Keep terse — long instructions degrade
 * structured-output reliability.
 */
export const FINDINGS_SHAPE_PROMPT_BLOCK = `
Every finding-like object you emit (mergeRecommendations / opportunities / risks / integrationRisks / keyFindings / redFlags) MUST include:
- "title": short headline
- "body": 1-3 sentence explanation
- "severity": one of: low, medium, high, critical
- "confidence": number 0.0-1.0 reflecting how well the source evidence supports the claim
- "impact": array of axes from: ["day_one","tsa","separation","long_term"]
- "evidence": array of source pointers. Each pointer:
    { "kind": "document_chunk"|"process_step"|"chat_turn"|"metric",
      "ref":   {...},
      "snippet": "<=400 chars verbatim from source" }
  - For document_chunk, ref MUST include chunk_id and document_id from the search results provided (along with page/slide/sheet/range when known).
  - For process_step, ref includes report_id and step_index.
  - Do NOT fabricate evidence. If you have no source for a claim, lower confidence and set evidence: [].
- "recommendations": array of 1-3 short action strings.

Findings without evidence will be filtered out of the rendered report. Prefer fewer, well-supported findings over many speculative ones.
`.trim();
