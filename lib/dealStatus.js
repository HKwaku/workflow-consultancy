/**
 * Living-workspace migration: deal status no longer transitions to 'complete'.
 *
 * In the old report-gen model, a deal moved to 'complete' once every
 * participant had submitted their diagnostic. That terminal state has been
 * removed — participants edit their processes on the canvas indefinitely,
 * and deals stay open for the life of the engagement.
 *
 * Kept as a no-op export so any straggler import doesn't break the build.
 * Delete once every callsite has been migrated off.
 */
export async function maybeCompleteDeal() {
  return;
}
