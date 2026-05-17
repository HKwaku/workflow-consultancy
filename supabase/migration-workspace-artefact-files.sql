-- ============================================================
-- workspace-artefacts storage bucket
--
-- Depends on: migration-workspace-artefacts.sql.
--
-- Office-skill artefacts (.pptx/.docx/.xlsx) are binaries built in
-- the code-execution sandbox. They do NOT fit workspace_artefacts.
-- content (text); the row stores a pointer in `meta.file` and the
-- bytes live here, in a PRIVATE bucket. Object path:
--   <operating_model_id>/<artefact_id>.<ext>
--
-- All reads/writes go through the service role (the
-- /api/operating-models/[id]/artefacts/[artefactId]/file route
-- enforces member access before streaming), so no public access and
-- no per-object RLS policy are granted — the service key bypasses
-- storage RLS and the API route is the only reader.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-artefacts', 'workspace-artefacts', false)
ON CONFLICT (id) DO NOTHING;
