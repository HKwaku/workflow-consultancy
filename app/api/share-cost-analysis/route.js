import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const ShareSchema = z.object({
  reportId: z.string().min(1).max(64),
  managerEmail: z.string().email().max(254),
  costUrl: z.string().url().max(2048),
  contactName: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
});

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = ShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { reportId, managerEmail, costUrl, contactName, company } = parsed.data;

  const { sent } = await triggerWebhook({
    requestType: 'cost-analysis-share',
    reportId,
    managerEmail,
    costUrl,
    contactName: contactName || '',
    company: company || '',
    timestamp: new Date().toISOString(),
  }, { envSuffix: 'COST_ANALYSIS_SHARE', requestId: getRequestId(request) });

  if (!sent) {
    logger.warn('cost-analysis-share webhook not sent', { requestId: getRequestId(request), reportId });
  }

  return NextResponse.json({ success: true, sent });
}
