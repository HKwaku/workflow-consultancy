/**
 * dealProposals — adapter between chat-side `propose_*` tools and the
 * `changes` table.
 *
 * Each `propose_*` case in lib/agents/chat/graph.js stages a deal mutation
 * via an SSE `deal_proposal` event and returns a string response to the
 * model. This file bridges those proposals into a relational `changes` row
 * so the deal's longitudinal "what was suggested, by whom, why, did it land"
 * timeline is queryable, mirroring what we already do for redesign agent
 * changes.
 *
 * Pattern:
 *   1. Tool case validates input + verifies referenced rows exist.
 *   2. Tool case calls `recordDealProposal(...)` here, which inserts a
 *      `changes` row at state='proposed' and returns the row id.
 *   3. Tool case bakes the change_id into the SSE payload so the client's
 *      Apply button can echo it to the apply endpoint.
 *   4. Apply endpoint calls `recordTransition({ id, state: 'applied' })`
 *      after the underlying mutation succeeds.
 *
 * The `upload_document` proposal bypasses this - it's a navigation
 * hint, not a mutation. Tracking it as a "change" would be lying.
 */

import { recordChanges } from './repo.js';

/**
 * Maps the SSE `kind` (the proposal verb the chat client switches on) to
 * the (subject_type, kind) pair the `changes` table requires.
 *
 * KEEP IN SYNC with the propose_* cases in lib/agents/chat/graph.js.
 */
// run_analysis + generate_report removed: both proposal verbs targeted
// deal_analyses / redesign snapshot artefacts that the living-workspace
// migration dropped, AND mapped to subject_type='redesign' which the
// post-migration changes_subject_type_check forbids. The agent's
// propose_run_analysis / propose_generate_report cases now return a
// "removed" string without firing a proposal — these handlers are dead
// either way, but kept gone here so a future re-introduction must pick
// a valid subject_type explicitly.
const PROPOSAL_TO_CHANGE = {
  invite_participant:           { subject_type: 'participant',  kind: 'added'    },
  reprocess_document:           { subject_type: 'document',     kind: 'modified' },
  link_participant_report:      { subject_type: 'participant',  kind: 'modified' },
  undo_link_participant_report: { subject_type: 'participant',  kind: 'reverted' },
};

/**
 * @returns {string[]} the SSE proposal kinds this adapter knows how to
 *                     persist. Useful for tests + introspection.
 */
export function trackedProposalKinds() {
  return Object.keys(PROPOSAL_TO_CHANGE);
}

/**
 * Insert a `changes` row for one chat-staged deal proposal.
 *
 * @param {object} args
 * @param {object} args.ctx          — chat-graph executor ctx ({ dealId, session })
 * @param {string} args.sseKind      — the proposal verb (e.g. 'finding_review')
 * @param {object} args.subject_ref  — JSONB locator (finding_key + analysis_id, etc.)
 * @param {string|null} [args.rationale]      — free-text "why"
 * @param {Array}  [args.evidence_refs]       — [{kind, id, snippet?}]
 * @param {object|null} [args.expected_impact]
 * @returns {Promise<string|null>} the new change id, or null on failure
 */
export async function recordDealProposal({
  ctx, sseKind,
  subject_ref, rationale = null,
  evidence_refs = [], expected_impact = null,
}) {
  const map = PROPOSAL_TO_CHANGE[sseKind];
  if (!map) return null;
  if (!ctx?.dealId || !ctx.dealAccessVerified) return null;

  const { ids } = await recordChanges([{
    subject_type: map.subject_type,
    subject_ref: subject_ref || {},
    kind: map.kind,
    state: 'proposed',
    rationale,
    evidence_refs: Array.isArray(evidence_refs) ? evidence_refs : [],
    expected_impact,
    deal_id: ctx.dealId,
    actor_kind: 'agent',
    agent_name: 'chat',
    actor_email: ctx?.session?.email || null,
  }]);
  return ids[0] || null;
}
