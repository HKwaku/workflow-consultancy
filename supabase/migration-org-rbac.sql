-- ============================================================
-- Organizations, org-scoped admins, and fine-grained entitlements
-- Run in Supabase SQL Editor after reviewing.
-- ============================================================

-- Lookup auth user id by email (service_role only) - used when inviting existing accounts
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
STABLE
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_email text
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  is_org_admin boolean NOT NULL DEFAULT false,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_email_lower CHECK (email = lower(trim(email))),
  CONSTRAINT organization_members_org_user_unique UNIQUE (organization_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_org_email
  ON public.organization_members (organization_id, lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members (organization_id);

-- Optional: tie reports to an org (nullable; backfill later)
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_org ON public.diagnostic_reports (organization_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- No policies: block direct anon/authenticated access; API uses service_role which bypasses RLS.

COMMENT ON TABLE public.organizations IS 'Tenant / customer org container';
COMMENT ON TABLE public.organization_members IS 'Membership: org admin flag + entitlements JSON (cost_analyst, etc.)';
COMMENT ON COLUMN public.diagnostic_reports.organization_id IS 'Optional scoping to an organization';
