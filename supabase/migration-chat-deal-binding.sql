-- ============================================================
-- chat_sessions.deal_id — bind a copilot chat thread to a deal
--
-- The deals briefcase in the chat rail (DealsRailButton) lets a user pick a
-- deal to scope the conversation. Without persistent binding, switching
-- deals reuses whatever thread the user happens to have open. With this
-- column we can find-or-create a per-(user, deal) session so each deal
-- has its own thread that resumes on refresh / re-selection.
--
-- Idempotent. Adds a partial index for the find-or-create lookup.
-- ============================================================

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS deal_id uuid
    REFERENCES public.deals(id) ON DELETE SET NULL;

-- Lookup: "give me this user's most-recent copilot session for deal X".
-- Partial because deal_id is null for the vast majority of rows.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_deal_user
  ON public.chat_sessions (deal_id, user_id, last_message_at DESC)
  WHERE deal_id IS NOT NULL;

COMMENT ON COLUMN public.chat_sessions.deal_id IS
  'When set, this chat session is the deal copilot thread for (user_id, deal_id). Find-or-create via lib/chatPersistence.findOrCreateDealChatSession().';
