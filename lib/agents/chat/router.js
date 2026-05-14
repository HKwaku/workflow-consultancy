/**
 * pickAgent — chooses which chat agent serves the current turn.
 *
 * Three modes:
 *   - process: a specific process (report) is anchored — full step-editing toolset
 *   - deal:    a deal is anchored, no specific process — deal workspace tools
 *   - model:   an operating model is anchored, no deal, no process — model workspace tools
 *   - default: nothing anchored — onboarding (same prompt + tools as process)
 *
 * Process wins because if the user is inside a specific flow, that flow is
 * what they care about — even if a deal or model is also in context.
 */

export function pickAgent({ editingReportId, viewOnlyProcessId, dealId, operatingModelId, chatScope }) {
  // A specific process is open — always the process agent, regardless
  // of what other anchors are set.
  if (editingReportId || viewOnlyProcessId) return 'process';

  // Explicit override from the client. The client knows what surface
  // the user is actively on (canvas overlay scope, URL route) and can
  // resolve the deal-vs-model precedence better than we can from
  // anchors alone. Only respected for non-process modes.
  if (chatScope === 'deal'  && dealId)             return 'deal';
  if (chatScope === 'model' && operatingModelId)   return 'model';
  if (chatScope === 'deal'  && !dealId)            return 'process';  // user asked for deal mode but no deal — fall through
  if (chatScope === 'model' && !operatingModelId)  return 'process';

  // No explicit scope — fall back to precedence. Deal wins because
  // a deal anchor implies a specific deliberation surface; an
  // operating-model anchor can be the user's default and isn't a
  // strong intent signal.
  if (dealId)              return 'deal';
  if (operatingModelId)    return 'model';
  return 'process';
}
