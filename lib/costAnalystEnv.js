/**
 * Default cost analysts — read from DEFAULT_COST_ANALYST_EMAILS.
 *
 * These emails are seeded into `costAuthorizedEmails` on every new report so
 * the in-house cost team can view data without each operator having to name
 * them explicitly. The per-report `costAnalystEmail` field passed at save
 * time is merged on top (it typically also receives the notification email).
 *
 * Comma-separated env var — whitespace trimmed, lowercased, duplicates
 * removed.
 */

function parseList(raw) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (const part of String(raw).split(',')) {
    const e = part.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** Default analyst emails from env — [] when unset. */
export function getDefaultCostAnalystEmails() {
  return parseList(process.env.DEFAULT_COST_ANALYST_EMAILS);
}

/**
 * Merge env defaults with request-supplied analyst email and any emails
 * already persisted on the report. Owner is excluded (they always have
 * access via ownership).
 *
 * @param {Object} input
 * @param {string} [input.costAnalystEmail]     From the request body.
 * @param {string[]} [input.existing]           From diagnostic_data.costAuthorizedEmails.
 * @param {string} [input.ownerEmail]           Report owner (contact_email) — filtered out.
 * @returns {string[]} lower-cased unique list (excluding owner).
 */
export function normalizeCostAuthorizedEmails({ costAnalystEmail, existing = [], ownerEmail = '' } = {}) {
  const owner = (ownerEmail || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];
  const push = (e) => {
    const v = (e || '').trim().toLowerCase();
    if (!v || v === owner || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  for (const e of getDefaultCostAnalystEmails()) push(e);
  if (costAnalystEmail) push(costAnalystEmail);
  for (const e of (existing || [])) push(e);

  return out;
}

/**
 * Who to notify when a cost-analysis link is generated server-side.
 * Prefers the per-report `costAnalystEmail`; falls back to env defaults.
 */
export function getCostAnalystNotificationTargets(costAnalystEmail) {
  const primary = (costAnalystEmail || '').trim().toLowerCase();
  if (primary) return [primary];
  return getDefaultCostAnalystEmails();
}
