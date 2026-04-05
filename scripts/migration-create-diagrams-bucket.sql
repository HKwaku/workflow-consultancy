-- Create the Supabase Storage bucket for rendered flow diagrams
-- Run this once in the Supabase SQL editor (or via supabase db push)

-- Insert the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'diagrams',
  'diagrams',
  true,           -- public read (no auth needed to view diagram URLs)
  5242880,        -- 5 MB per file
  ARRAY['image/png', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow public read access on all objects in the bucket
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'diagrams_public_read'
  ) THEN
    CREATE POLICY "diagrams_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'diagrams');
  END IF;
END $$;

-- Allow service-role uploads (the n8n workflow uses the service role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'diagrams_service_insert'
  ) THEN
    CREATE POLICY "diagrams_service_insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'diagrams');
  END IF;
END $$;
