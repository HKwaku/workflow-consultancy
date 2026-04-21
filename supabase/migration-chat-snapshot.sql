-- ============================================================
-- chat_sessions.process_snapshot
-- Stores the latest processData payload (steps, handoffs, processName, etc.)
-- so resuming a chat-only session reconstructs the full workspace —
-- not just the message thread.
-- ============================================================

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS process_snapshot jsonb;

COMMENT ON COLUMN public.chat_sessions.process_snapshot IS
  'Latest processData from the Screen 2 canvas. Updated on every message write; read on session resume.';
