import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/api-helpers';

const WEBHOOK_TIMEOUT_MS = 15000;

export function getWebhookUrl(envSuffix) {
  if (envSuffix) {
    const specific = process.env[`N8N_${envSuffix}_WEBHOOK_URL`];
    if (specific) return specific;
  }
  return null;
}

export async function triggerWebhook(payload, { envSuffix, requestId } = {}) {
  const url = getWebhookUrl(envSuffix);
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
    return { sent: false, reason: 'no-webhook-url' };
  }

  try {
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, WEBHOOK_TIMEOUT_MS);

    if (resp.ok) {
      let body = null;
      try { body = await resp.json(); } catch (parseErr) {
        logger.warn('Webhook response not valid JSON', { requestId, message: parseErr?.message, status: resp.status });
        body = { accepted: true };
      }
      return { sent: true, body };
    }
    return { sent: false, reason: `webhook-status-${resp.status}` };
  } catch (err) {
    logger.warn('Webhook error', { requestId, message: err.message });
    return { sent: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}
