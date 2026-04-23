-- ============================================================
-- Chat history: real-time persistence + organised history
--
-- Two tables:
--   chat_sessions  - one row per conversation (user × process/redesign)
--   chat_messages  - one row per turn, FK'd to chat_sessions
--
-- Flow: each time the user sends or the assistant replies, the client
-- POSTs to /api/chat-messages which upserts the session and appends
-- the message. Survives cleared browser and crosses devices.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  report_id    text REFERENCES public.diagnostic_reports(id) ON DELETE SET NULL,
  kind         text NOT NULL DEFAULT 'map'
               CHECK (kind IN ('map', 'redesign', 'cost', 'copilot')),
  title        text,
  summary      text,
  last_message text,
  message_count integer NOT NULL DEFAULT 0,
  pinned       boolean NOT NULL DEFAULT false,
  starred      boolean NOT NULL DEFAULT false,
  archived     boolean NOT NULL DEFAULT false,
  last_message_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user   ON public.chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_email  ON public.chat_sessions (lower(email));
CREATE INDEX IF NOT EXISTS idx_chat_sessions_report ON public.chat_sessions (report_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON public.chat_sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_title_trgm
  ON public.chat_sessions USING gin (title gin_trgm_ops);

-- Full-text search column on title + last_message + summary.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title, '') || ' ' ||
        coalesce(last_message, '') || ' ' ||
        coalesce(summary, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_tsv
  ON public.chat_sessions USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content    text NOT NULL,
  actions    jsonb,
  suggestions jsonb,
  attachments jsonb,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON public.chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_trgm
  ON public.chat_messages USING gin (content gin_trgm_ops);

-- Trigger to keep chat_sessions.updated_at + last_message_at fresh whenever
-- a message is inserted. Also bumps message_count and stores a short preview.
CREATE OR REPLACE FUNCTION public.chat_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.chat_sessions
     SET last_message    = left(NEW.content, 240),
         last_message_at = NEW.created_at,
         updated_at      = NEW.created_at,
         message_count   = message_count + 1
   WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_after_insert ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_after_insert
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_after_insert();

-- Row-level security: users see only their own sessions and messages.
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_sessions_own ON public.chat_sessions;
CREATE POLICY chat_sessions_own
  ON public.chat_sessions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS chat_messages_own ON public.chat_messages;
CREATE POLICY chat_messages_own
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions s
       WHERE s.id = chat_messages.session_id
         AND (s.user_id = auth.uid() OR lower(s.email) = lower(auth.jwt() ->> 'email'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions s
       WHERE s.id = chat_messages.session_id
         AND (s.user_id = auth.uid() OR lower(s.email) = lower(auth.jwt() ->> 'email'))
    )
  );
