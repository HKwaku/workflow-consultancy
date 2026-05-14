-- ============================================================
-- Rename capabilities → functions
--
-- "Capability" was business-architecture jargon. "Function" is what
-- people actually say ("Finance function", "Sales function") and
-- carries no extra learning cost. This migration is mechanical:
-- rename the table, columns, indexes, trigger, and RLS policies.
-- No data shape changes; no backfill needed.
--
-- The user explicitly authorised loss of existing capability rows
-- (none filed in production yet), but ALTER RENAME preserves them
-- anyway. Safe either way.
-- ============================================================

-- ---------- The main table ----------
ALTER TABLE public.capabilities RENAME TO functions;
ALTER TABLE public.functions    RENAME COLUMN parent_capability_id TO parent_function_id;

-- ---------- FK columns on related tables ----------
ALTER TABLE public.diagnostic_reports RENAME COLUMN capability_id  TO function_id;
ALTER TABLE public.process_systems    RENAME COLUMN capability_id  TO function_id;
ALTER TABLE public.model_roles        RENAME COLUMN capability_ids TO function_ids;

-- ---------- Indexes ----------
ALTER INDEX IF EXISTS idx_capabilities_model      RENAME TO idx_functions_model;
ALTER INDEX IF EXISTS idx_capabilities_parent     RENAME TO idx_functions_parent;
ALTER INDEX IF EXISTS idx_reports_capability      RENAME TO idx_reports_function;
ALTER INDEX IF EXISTS idx_proc_sys_capability     RENAME TO idx_proc_sys_function;
ALTER INDEX IF EXISTS idx_model_roles_caps_gin    RENAME TO idx_model_roles_funcs_gin;

-- ---------- updated_at trigger ----------
DROP TRIGGER IF EXISTS capabilities_updated_at ON public.functions;
CREATE TRIGGER functions_updated_at
  BEFORE UPDATE ON public.functions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

-- ---------- RLS policies (drop + recreate with new names) ----------
DROP POLICY IF EXISTS capabilities_member_read ON public.functions;
CREATE POLICY functions_member_read
  ON public.functions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = functions.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS capabilities_admin_write ON public.functions;
CREATE POLICY functions_admin_write
  ON public.functions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = functions.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = functions.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
         AND om.is_org_admin = true
    )
  );

-- model_roles policy references the table by name only, not by column
-- (capability_ids is queried via GIN index but the policy reads the
-- parent operating_model). No change needed there.

COMMENT ON TABLE public.functions IS
  'Hierarchical function taxonomy for an operating model. Processes (diagnostic_reports) attach to a function via diagnostic_reports.function_id.';
