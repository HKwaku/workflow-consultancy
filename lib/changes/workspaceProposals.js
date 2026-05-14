/**
 * workspaceProposals — adapter for chat-side `propose_add_*` tools that
 * mutate the operating-model workspace (functions / roles / systems).
 *
 * Today this module only persists nothing — phase 1 ships without an audit
 * row in the `changes` table because that table's CHECK constraint requires
 * either report_id or deal_id, and workspace mutations are scoped to an
 * operating_model_id. A follow-up migration will:
 *   1. Add `operating_model_id uuid REFERENCES operating_models(id)`.
 *   2. Relax the CHECK to allow operating_model_id alone.
 *   3. Add 'capability'/'role'/'system' to SUBJECT_TYPES in repo.js.
 * After that, recordWorkspaceProposal will mirror recordDealProposal and
 * insert a row at state='proposed', returning the change id so the client's
 * Confirm button can echo it back to the apply endpoint.
 *
 * Until then: tools call this, get a null change id, the SSE payload omits
 * change_id, and the apply endpoint writes the entity directly without
 * patching the changes table. The audit gap is acceptable for the first
 * cut — proposals are still ephemerally visible in the chat thread.
 */

const PROPOSAL_KINDS = new Set(['add_function', 'add_role', 'add_system']);

export function trackedWorkspaceProposalKinds() {
  return Array.from(PROPOSAL_KINDS);
}

/**
 * Stub — see file header. Returns null so callers don't bake a fake change_id
 * into the SSE payload.
 *
 * @param {object} args
 * @param {object} args.ctx          — chat-graph executor ctx
 * @param {string} args.sseKind      — proposal verb (e.g. 'add_function')
 * @returns {Promise<null>}
 */
export async function recordWorkspaceProposal({ ctx, sseKind }) {
  if (!PROPOSAL_KINDS.has(sseKind)) return null;
  if (!ctx?.operatingModelId) return null;
  // No-op until the changes-table migration lands. See header for plan.
  return null;
}
