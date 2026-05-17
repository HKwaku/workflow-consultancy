/**
 * Office-artefact build: generate the binary, store it, and flip the
 * placeholder row to ready (or failed). Shared by the Inngest worker
 * (the normal async path) and a synchronous fallback in the chat
 * executor for environments without Inngest configured.
 *
 * The placeholder workspace_artefacts row already exists (created by
 * emit_artefact) with meta.build.status = 'building'. This function
 * only ever PATCHes that row — it never creates one.
 */

import { logger } from '../logger.js';

/**
 * @param {object} a
 * @param {string} a.modelId
 * @param {string} a.artefactId   placeholder row id
 * @param {string} a.skillId
 * @param {string} a.title
 * @param {string} a.spec
 * @param {string} [a.context]
 * @param {string} [a.apiKey]     BYO key passthrough
 * @param {string} [a.createdByEmail]
 * @param {string} [a.userId]
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
export async function runOfficeArtefactBuild({
  modelId, artefactId, skillId, title, spec, context,
  apiKey, createdByEmail, userId, summary = null, supersedes = null,
}) {
  const { getSkill } = await import('../agents/artefacts/skills.js');
  const { generateOfficeArtefact } = await import('../agents/artefacts/generate.js');
  const { uploadArtefactFile, updateArtefact } = await import('./artefacts.js');

  // Preserve the summary / version-lineage that emit_artefact stamped
  // on the placeholder (updateArtefact replaces meta wholesale).
  const baseMeta = { skill: skillId };
  if (summary) baseMeta.summary = summary;
  if (supersedes) baseMeta.supersedes = supersedes;

  const skill = getSkill(skillId);
  const fail = async (error) => {
    await updateArtefact(modelId, artefactId, {
      meta: { ...baseMeta, build: { status: 'failed', error: String(error).slice(0, 300) } },
    }).catch(() => {});
    return { ok: false, error: String(error) };
  };

  if (!skill || !skill.office) return fail('not an office skill');

  let gen;
  try {
    gen = await generateOfficeArtefact({ skill, title, spec, context, apiKey });
  } catch (e) {
    return fail(`generation threw: ${e.message}`);
  }
  if (gen?.error) return fail(gen.error);
  if (!gen?.file) return fail('build returned no file');

  const path = await uploadArtefactFile(modelId, artefactId, gen.type, gen.file, gen.mime);
  if (!path) return fail('could not store the built file');

  // Preserve summary/supersedes that emit_artefact stamped on the row;
  // re-reading them would be a round-trip, so the caller passes the
  // base meta and we only set file + clear the build flag here.
  const ok = await updateArtefact(modelId, artefactId, {
    meta: {
      ...baseMeta,
      build: { status: 'ready' },
      file: {
        bucket: 'workspace-artefacts',
        path,
        filename: gen.filename,
        mime: gen.mime,
        bytes: gen.file.length,
      },
    },
  });
  if (!ok?.ok) {
    // The bytes are stored but the pointer didn't land — the row would
    // be undownloadable. Fail loudly so the UI shows the retry state.
    return fail('built the file but could not link it to the Outputs panel');
  }

  // Meter sub-agent / code-execution spend. Best-effort.
  try {
    const ut = (gen.usage?.input_tokens || 0) + (gen.usage?.output_tokens || 0);
    if (ut > 0 && (createdByEmail || userId)) {
      const { recordTokenUsage, getOrgIdForUser } = await import('../costGuard.js');
      const orgId = await getOrgIdForUser({ email: createdByEmail, userId });
      await recordTokenUsage({
        orgId,
        vendor: 'anthropic',
        model: 'office-artefact',
        surface: `artefact:${skillId}`,
        refId: modelId,
        inputTokens: gen.usage.input_tokens || 0,
        outputTokens: gen.usage.output_tokens || 0,
        userEmail: createdByEmail,
        userId,
      });
    }
  } catch (e) {
    logger.warn('Office artefact usage metering failed', { skill: skillId, error: e.message });
  }

  return { ok: true };
}
