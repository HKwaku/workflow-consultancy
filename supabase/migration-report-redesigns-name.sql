-- Add name column to report_redesigns for user-friendly version labels
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)

ALTER TABLE public.report_redesigns
  ADD COLUMN IF NOT EXISTS name text DEFAULT null;
