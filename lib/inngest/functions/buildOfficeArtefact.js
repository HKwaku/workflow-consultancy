/**
 * buildOfficeArtefact
 *
 * Async office-file (.pptx/.docx/.xlsx) generation. emit_artefact
 * creates a placeholder workspace_artefacts row (meta.build.status =
 * 'building'), returns to the chat immediately, and fires
 * `artefact/office.requested`. This worker does the slow part (model +
 * code-execution sandbox) off the request path and flips the row to
 * ready/failed. The Outputs panel polls while anything is building, so
 * the finished file appears on its own — the user never waits.
 *
 * One step (the build is a single long model+sandbox call that can't be
 * meaningfully chunked); it only returns small JSON, never the binary.
 */

import { inngest } from '../client';
import { runOfficeArtefactBuild } from '@/lib/operatingModel/officeArtefactBuild';
import { logger } from '@/lib/logger';

export const buildOfficeArtefact = inngest.createFunction(
  {
    id: 'build-office-artefact',
    name: 'Build office artefact (pptx/docx/xlsx)',
    retries: 1, // a failed build is usually a bad brief, not transient
    concurrency: { limit: 5 }, // Inngest free-tier cap
  },
  { event: 'artefact/office.requested' },
  async ({ event, step }) => {
    const d = event.data || {};
    if (!d.modelId || !d.artefactId || !d.skillId) {
      logger.warn('buildOfficeArtefact: missing event data', { data: Object.keys(d) });
      return { ok: false, error: 'missing event data' };
    }
    // Single step: the whole generate→store→link unit. Returns only a
    // small {ok}/{error} so nothing binary crosses the step boundary.
    return step.run('build', () => runOfficeArtefactBuild({
      modelId: d.modelId,
      artefactId: d.artefactId,
      skillId: d.skillId,
      title: d.title,
      spec: d.spec,
      context: d.context,
      apiKey: d.apiKey,
      createdByEmail: d.createdByEmail,
      userId: d.userId,
      summary: d.summary,
      supersedes: d.supersedes,
    }));
  },
);
