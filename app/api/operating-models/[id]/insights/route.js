/**
 * GET /api/operating-models/[id]/insights
 *
 * Bundle of cross-process aggregates that power the workspace's
 * Insights section. Returned as one payload so the client paints the
 * three cards in a single round-trip:
 *
 *   { systemInventory, functionHeatmap, changeRoi }
 *
 * Read-only; any org member of the model's org can see this.
 */

import { NextResponse } from 'next/server';
import { isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import {
  loadSystemInventory, loadFunctionHeatmap, loadChangeRoiSummary,
} from '@/lib/operatingModel/crossProcess';

export const maxDuration = 15;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  // All three queries are independent — fire in parallel.
  const [systemInventory, functionHeatmap, changeRoi] = await Promise.all([
    loadSystemInventory(id),
    loadFunctionHeatmap(id),
    loadChangeRoiSummary(id),
  ]);

  return NextResponse.json({
    systemInventory,
    functionHeatmap,
    changeRoi: changeRoi || { totals: {}, predicted: {}, realised: [], coverage: { withOutcomes: 0, withoutOutcomes: 0 } },
  });
}
