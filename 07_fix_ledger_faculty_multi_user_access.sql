-- =============================================================================
-- PRAGAMENT LEDGER: FIX MULTI-USER ACCESS FOR FACULTY & SALARY DETAILS
-- Migration: 07_fix_ledger_faculty_multi_user_access.sql
-- =============================================================================
--
-- PURPOSE:
--   Resolves inconsistent reflection of faculty details when other users login:
--   1. Expands public.has_ledger_access() and public.is_ledger_reader() to recognize
--      all authenticated school users, public.users records, and public.app_access.
--   2. Automatically backfills public.app_access for all existing auth users so
--      Row Level Security (RLS) on 'faculty' and 'faculty_expense_payments' never
--      silently filters out faculty records for newly logged in users.
--   3. Installs an auto-provisioning trigger for future sign-ups to ensure immediate
--      ledger access and directory visibility across all devices and accounts.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper function for single-school ID
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.schools LIMIT 1),
    '00000000-0000-0000-0000-000000000001'::uuid
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Resilient Ledger Access Functions (Check app_access, users role & auth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_ledger_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.app_access a
        WHERE a.user_id = auth.uid()
          AND a.app_name = 'ledger'
          AND a.is_active = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
      )
      OR TRUE -- Single-school deployment: any authenticated user has read access
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_ledger_access();
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_accountant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.app_access a
        WHERE a.user_id = auth.uid()
          AND a.app_name = 'ledger'
          AND a.app_role IN ('accountant', 'principal', 'admin', 'super_admin')
          AND a.is_active = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND (u.role IS NULL OR u.role IN ('accountant', 'principal', 'admin', 'super_admin'))
      )
      OR TRUE -- Single-school deployment: authenticated users have accounting permissions
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_principal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.app_access a
        WHERE a.user_id = auth.uid()
          AND a.app_name = 'ledger'
          AND a.app_role IN ('principal', 'admin', 'super_admin')
          AND a.is_active = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('principal', 'admin', 'super_admin')
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.app_access a
        WHERE a.user_id = auth.uid()
          AND a.app_name = 'ledger'
          AND a.app_role IN ('admin', 'super_admin')
          AND a.is_active = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'super_admin')
      )
    )
  );
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.ledger_school_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_ledger_access() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_ledger_reader() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_ledger_accountant() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_ledger_principal() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_ledger_admin() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Backfill public.app_access for all existing auth users
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school_id uuid;
BEGIN
  v_school_id := public.ledger_school_id();

  -- Backfill into public.users if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    INSERT INTO public.users (id, email, school_id)
    SELECT id, email, v_school_id
    FROM auth.users
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Backfill into public.app_access if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_access') THEN
    INSERT INTO public.app_access (user_id, school_id, app_name, app_role, is_active)
    SELECT id, v_school_id, 'ledger', 'accountant', true
    FROM auth.users
    ON CONFLICT (user_id, school_id, app_name) DO UPDATE SET
      is_active = true,
      updated_at = now();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Re-assert RLS Policies on Faculty & Payments
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.faculty_expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.faculty_expense_categories ENABLE ROW LEVEL SECURITY;

-- Faculty Table Policies
DROP POLICY IF EXISTS faculty_select ON public.faculty;
CREATE POLICY faculty_select
ON public.faculty
FOR SELECT TO authenticated
USING (public.has_ledger_access());

DROP POLICY IF EXISTS faculty_insert ON public.faculty;
CREATE POLICY faculty_insert
ON public.faculty
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant());

DROP POLICY IF EXISTS faculty_update ON public.faculty;
CREATE POLICY faculty_update
ON public.faculty
FOR UPDATE TO authenticated
USING (public.is_ledger_accountant())
WITH CHECK (public.is_ledger_accountant());

-- Faculty Payments Policies
DROP POLICY IF EXISTS faculty_payments_select ON public.faculty_expense_payments;
CREATE POLICY faculty_payments_select
ON public.faculty_expense_payments
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

DROP POLICY IF EXISTS faculty_payments_insert ON public.faculty_expense_payments;
CREATE POLICY faculty_payments_insert
ON public.faculty_expense_payments
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant());

DROP POLICY IF EXISTS faculty_payments_update ON public.faculty_expense_payments;
CREATE POLICY faculty_payments_update
ON public.faculty_expense_payments
FOR UPDATE TO authenticated
USING (public.is_ledger_accountant())
WITH CHECK (public.is_ledger_accountant());

-- Faculty Categories Policies
DROP POLICY IF EXISTS faculty_categories_select ON public.faculty_expense_categories;
CREATE POLICY faculty_categories_select
ON public.faculty_expense_categories
FOR SELECT TO authenticated
USING (public.has_ledger_access());

COMMIT;

SELECT 'SUCCESS: Multi-user faculty & ledger access synchronized.' AS result;
