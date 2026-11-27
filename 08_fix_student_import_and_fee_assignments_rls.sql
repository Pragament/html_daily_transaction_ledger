-- =============================================================================
-- PRAGAMENT LEDGER: FIX STUDENT IMPORT & FEE MANAGEMENT RLS & ACCESS (HARDENED)
-- Migration: 08_fix_student_import_and_fee_assignments_rls.sql
-- =============================================================================
--
-- PURPOSE:
--   Resolves authenticated student import & fee management access while
--   enforcing strict authenticated-only Row Level Security (no anon access).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema Normalization & Defaults for Students and Fee Tables
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'students') THEN
    ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    ALTER TABLE public.students ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();
    UPDATE public.students SET school_id = public.ledger_school_id() WHERE school_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_fee_assignments') THEN
    ALTER TABLE public.student_fee_assignments ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    ALTER TABLE public.student_fee_assignments ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();
    UPDATE public.student_fee_assignments SET school_id = public.ledger_school_id() WHERE school_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fee_structures') THEN
    ALTER TABLE public.fee_structures ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    ALTER TABLE public.fee_structures ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();
    UPDATE public.fee_structures SET school_id = public.ledger_school_id() WHERE school_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fee_payments') THEN
    ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    ALTER TABLE public.fee_payments ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();
    UPDATE public.fee_payments SET school_id = public.ledger_school_id() WHERE school_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Revoke anon/PUBLIC Access & Grant Table Privileges Only to authenticated
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'students',
    'student_fee_assignments',
    'fee_structures',
    'fee_payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC;', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', t);
    END IF;
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Strict Authenticated RLS Policies: Students
-- ---------------------------------------------------------------------------

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select students" ON public.students;
DROP POLICY IF EXISTS "Insert students" ON public.students;
DROP POLICY IF EXISTS "Update students" ON public.students;
DROP POLICY IF EXISTS "Delete students" ON public.students;
DROP POLICY IF EXISTS "Allow all for authenticated on students" ON public.students;
DROP POLICY IF EXISTS "Allow all for anon on students" ON public.students;
DROP POLICY IF EXISTS "Students full access for authenticated" ON public.students;
DROP POLICY IF EXISTS "Students full access for anon" ON public.students;
DROP POLICY IF EXISTS ledger_students_select ON public.students;
DROP POLICY IF EXISTS ledger_students_insert ON public.students;
DROP POLICY IF EXISTS ledger_students_update ON public.students;
DROP POLICY IF EXISTS ledger_students_delete ON public.students;

CREATE POLICY ledger_students_select
ON public.students
FOR SELECT TO authenticated
USING (public.has_ledger_access() AND school_id = public.ledger_school_id());

CREATE POLICY ledger_students_insert
ON public.students
FOR INSERT TO authenticated
WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

CREATE POLICY ledger_students_update
ON public.students
FOR UPDATE TO authenticated
USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

CREATE POLICY ledger_students_delete
ON public.students
FOR DELETE TO authenticated
USING (public.is_ledger_admin() AND school_id = public.ledger_school_id());

-- ---------------------------------------------------------------------------
-- 4. Strict Authenticated RLS Policies: Student Fee Assignments
-- ---------------------------------------------------------------------------

ALTER TABLE public.student_fee_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_fee_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public student_fee_assignments" ON public.student_fee_assignments;
DROP POLICY IF EXISTS "Allow all for authenticated on student_fee_assignments" ON public.student_fee_assignments;
DROP POLICY IF EXISTS "Allow all for anon on student_fee_assignments" ON public.student_fee_assignments;
DROP POLICY IF EXISTS "Fee assignments full access for authenticated" ON public.student_fee_assignments;
DROP POLICY IF EXISTS "Fee assignments full access for anon" ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_select ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_insert ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_update ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_delete ON public.student_fee_assignments;

CREATE POLICY ledger_fee_assignments_select
ON public.student_fee_assignments
FOR SELECT TO authenticated
USING (public.is_ledger_reader() AND school_id = public.ledger_school_id());

CREATE POLICY ledger_fee_assignments_insert
ON public.student_fee_assignments
FOR INSERT TO authenticated
WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

CREATE POLICY ledger_fee_assignments_update
ON public.student_fee_assignments
FOR UPDATE TO authenticated
USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

-- ---------------------------------------------------------------------------
-- 5. Strict Authenticated RLS Policies: Fee Structures & Fee Payments
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fee_structures') THEN
    ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.fee_structures FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Public fee_structures" ON public.fee_structures;
    DROP POLICY IF EXISTS "Fee structures full access for authenticated" ON public.fee_structures;
    DROP POLICY IF EXISTS "Fee structures full access for anon" ON public.fee_structures;
    DROP POLICY IF EXISTS ledger_fee_structures_select ON public.fee_structures;
    DROP POLICY IF EXISTS ledger_fee_structures_insert ON public.fee_structures;
    DROP POLICY IF EXISTS ledger_fee_structures_update ON public.fee_structures;
    DROP POLICY IF EXISTS ledger_fee_structures_delete ON public.fee_structures;

    CREATE POLICY ledger_fee_structures_select
    ON public.fee_structures FOR SELECT TO authenticated
    USING (public.is_ledger_reader() AND school_id = public.ledger_school_id());

    CREATE POLICY ledger_fee_structures_insert
    ON public.fee_structures FOR INSERT TO authenticated
    WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

    CREATE POLICY ledger_fee_structures_update
    ON public.fee_structures FOR UPDATE TO authenticated
    USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
    WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

    CREATE POLICY ledger_fee_structures_delete
    ON public.fee_structures FOR DELETE TO authenticated
    USING (public.is_ledger_admin() AND school_id = public.ledger_school_id());
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fee_payments') THEN
    ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.fee_payments FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Public fee_payments" ON public.fee_payments;
    DROP POLICY IF EXISTS "Fee payments full access for authenticated" ON public.fee_payments;
    DROP POLICY IF EXISTS "Fee payments full access for anon" ON public.fee_payments;
    DROP POLICY IF EXISTS ledger_fee_payments_select ON public.fee_payments;
    DROP POLICY IF EXISTS ledger_fee_payments_insert ON public.fee_payments;
    DROP POLICY IF EXISTS ledger_fee_payments_update ON public.fee_payments;

    CREATE POLICY ledger_fee_payments_select
    ON public.fee_payments FOR SELECT TO authenticated
    USING (public.is_ledger_reader() AND school_id = public.ledger_school_id());

    CREATE POLICY ledger_fee_payments_insert
    ON public.fee_payments FOR INSERT TO authenticated
    WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

    CREATE POLICY ledger_fee_payments_update
    ON public.fee_payments FOR UPDATE TO authenticated
    USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
    WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());
  END IF;
END $$;

COMMIT;

SELECT 'MIGRATION 08 COMPLETE (HARDENED): authenticated-only student & fee RLS active.' AS result;
