-- Performance indexes for hot WHERE patterns observed in the codebase.
--
-- Each index targets a query that runs on every authenticated page load
-- or every chat turn. Without these, Postgres falls back to sequential
-- scans on tables that already have meaningful row counts (especially
-- chat_messages, deal_findings, and audit_logs).
--
-- Safe to re-run: every CREATE INDEX is IF NOT EXISTS. CONCURRENTLY is
-- omitted so this can run in a transaction; if you have meaningful
-- production load, run each statement separately with CONCURRENTLY.

-- ── Deals + deal-scoped reads ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deal_participants_deal_id
  ON public.deal_participants (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_flows_deal_id
  ON public.deal_flows (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_flows_report_id
  ON public.deal_flows (report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_analyses_deal_id_created_at
  ON public.deal_analyses (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_analyses_status
  ON public.deal_analyses (status) WHERE status = 'pending' OR status = 'running';
CREATE INDEX IF NOT EXISTS idx_deal_documents_deal_id
  ON public.deal_documents (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_documents_status
  ON public.deal_documents (status) WHERE status <> 'ready';
CREATE INDEX IF NOT EXISTS idx_deal_qa_items_deal_id
  ON public.deal_qa_items (deal_id);

-- ── Findings + reviews + comments (heavy analysis-scoped reads) ────────
CREATE INDEX IF NOT EXISTS idx_deal_findings_analysis_id
  ON public.deal_findings (analysis_id);
CREATE INDEX IF NOT EXISTS idx_deal_findings_deal_id
  ON public.deal_findings (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_finding_reviews_analysis_finding
  ON public.deal_finding_reviews (analysis_id, finding_key);
CREATE INDEX IF NOT EXISTS idx_deal_finding_comments_analysis_finding
  ON public.deal_finding_comments (analysis_id, finding_key);

-- ── Connector sync paths ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deal_connector_bindings_deal_id
  ON public.deal_connector_bindings (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_connector_bindings_due
  ON public.deal_connector_bindings (next_sync_after)
  WHERE sync_status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_integrations_org_provider
  ON public.org_integrations (org_id, provider) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_deal_documents_connector_binding
  ON public.deal_documents (connector_binding_id) WHERE connector_binding_id IS NOT NULL;

-- ── Chat (every turn fans out into these) ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id_updated
  ON public.chat_sessions (user_id, updated_at DESC) WHERE archived = false;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_email_updated
  ON public.chat_sessions (email, updated_at DESC) WHERE archived = false;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_deal_id
  ON public.chat_sessions (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_report_id
  ON public.chat_sessions (report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON public.chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_artefacts_session_id
  ON public.chat_artefacts (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_artefacts_message_id
  ON public.chat_artefacts (message_id) WHERE message_id IS NOT NULL;

-- ── Reports (single-row reads + per-deal joins) ───────────────────────
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_user_id_created
  ON public.diagnostic_reports (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_email_created
  ON public.diagnostic_reports (contact_email, created_at DESC) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_deal_id
  ON public.diagnostic_reports (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_organization_id
  ON public.diagnostic_reports (organization_id) WHERE organization_id IS NOT NULL;

-- ── Org members (auth + membership lookups on every authenticated req) ─
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
  ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_email
  ON public.organization_members (email);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id
  ON public.organization_members (organization_id);

-- ── Audit log + token ledger (large tables, frequently scanned) ───────
CREATE INDEX IF NOT EXISTS idx_audit_logs_deal_id_created
  ON public.audit_logs (deal_id, created_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON public.audit_logs (organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_usage_org_created
  ON public.token_usage_ledger (organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

-- ── Customer keys + audit ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_api_keys_org_vendor_status
  ON public.customer_api_keys (organization_id, vendor, status);
CREATE INDEX IF NOT EXISTS idx_customer_api_key_audit_org_created
  ON public.customer_api_key_audit (organization_id, created_at DESC);

-- ── Cron + GDPR ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_pending_due
  ON public.user_deletion_requests (expunge_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followup_events_pending_due
  ON public.followup_events (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cron_run_log_job_started
  ON public.cron_run_log (job_name, started_at DESC);

-- ── Document chunks (search + RAG) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deal_document_chunks_document_id
  ON public.deal_document_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_deal_document_chunks_deal_id
  ON public.deal_document_chunks (deal_id);
-- Full-text search index on content. GIN over the existing tsvector.
CREATE INDEX IF NOT EXISTS idx_deal_document_chunks_content_fts
  ON public.deal_document_chunks USING gin (content_fts);

-- ── Process / followup scaffolding ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_diagnostic_progress_user_id
  ON public.diagnostic_progress (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_report_id
  ON public.process_instances (report_id) WHERE report_id IS NOT NULL;
