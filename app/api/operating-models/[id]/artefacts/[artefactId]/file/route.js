/**
 * GET /api/operating-models/[id]/artefacts/[artefactId]/file
 *
 * Streams the binary for an Office-skill artefact (.pptx/.docx/.xlsx)
 * out of the private workspace-artefacts Storage bucket. Member-gated
 * (resolveModelAccess); the bucket itself is private and only the
 * service role reads it — this route is the only door.
 */

import { isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { getArtefact, downloadArtefactFile } from '@/lib/operatingModel/artefacts';

export const maxDuration = 20;

export async function GET(request, { params }) {
  const { id, artefactId } = await params;
  if (!isValidUUID(id) || !isValidUUID(artefactId)) {
    return new Response(JSON.stringify({ error: 'Valid ids required.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await requireAuth(request);
  if (auth.error) {
    return new Response(JSON.stringify(auth.error.body), {
      status: auth.error.status, headers: { 'Content-Type': 'application/json' },
    });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) {
    return new Response(JSON.stringify({ error: access.error }), {
      status: access.status, headers: { 'Content-Type': 'application/json' },
    });
  }

  const row = await getArtefact(id, artefactId);
  const file = row?.meta?.file;
  if (!row || !file || !file.path) {
    return new Response(JSON.stringify({ error: 'No file for this artefact.' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  const got = await downloadArtefactFile(file.path);
  if (!got) {
    return new Response(JSON.stringify({ error: 'File unavailable.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  const filename = (file.filename || `${row.title || 'artefact'}.${row.type || 'bin'}`)
    .replace(/[\r\n"]/g, '_');
  return new Response(got.bytes, {
    status: 200,
    headers: {
      'Content-Type': file.mime || got.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(got.bytes.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
