/**
 * GET /api/operating-models/[id]/analysis
 *
 * Model-level rollup of process-report findings: recommendations,
 * bottlenecks, automation pipeline, risk hotspots, cost concentration,
 * and the redesign roadmap. Powers the workspace's Analysis tab.
 */

import { NextResponse } from 'next/server';
import { isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { loadAnalysis } from '@/lib/operatingModel/analysis';

export const maxDuration = 15;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const analysis = await loadAnalysis(id);
  return NextResponse.json(analysis || {
    topRecommendations: [], bottlenecks: [], automationPipeline: [],
    riskHotspots: { manualNoSystem: [], sopFailures: [], shadowSteps: [] },
    costConcentration: { topProcesses: [], topSteps: [] },
    roadmap: null,
    counts: { reports: 0 },
  });
}
