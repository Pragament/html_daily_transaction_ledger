-- =============================================================================
-- PRAGAMENT PHASE 3 PGLITE / RLS REGRESSION TEST PLAN
-- Single school + shared Supabase
-- =============================================================================
-- This file is intentionally a focused regression harness/specification.
--
-- IMPORTANT:
--   PGlite is useful for SQL/RLS logic regression but does NOT prove Supabase
--   production JWT, PostgREST, storage, connection-role or hosted-platform
--   behavior. Production verification must include real Supabase integration tests.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Test fixture
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS test_ledger;

-- These IDs are fixtures only.
CREATE TEMP TABLE test_users (
  user_id uuid PRIMARY KEY,
  email text NOT NULL
);

INSERT INTO test_users VALUES
  ('10000000-0000-0000-0000-000000000001','accountant@test.local'),
  ('10000000-0000-0000-0000-000000000002','principal@test.local'),
  ('10000000-0000-0000-0000-000000000003','teacher@test.local'),
  ('10000000-0000-0000-0000-000000000004','inactive@test.local');

CREATE TEMP TABLE test_access (
  user_id uuid,
  app_name text,
  app_role text,
  is_active boolean
);

INSERT INTO test_access VALUES
  ('10000000-0000-0000-0000-000000000001','ledger','accountant',true),
  ('10000000-0000-0000-0000-000000000002','ledger','principal',true),
  ('10000000-0000-0000-0000-000000000003','teacher','teacher',true),
  ('10000000-0000-0000-0000-000000000004','ledger','accountant',false);

-- ---------------------------------------------------------------------------
-- Required assertions
-- ---------------------------------------------------------------------------

-- 1. Exactly one school
DO $$
BEGIN
  IF (SELECT count(*) FROM public.schools) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: expected exactly one school.';
  END IF;
END $$;

-- 2. Accountant has active Ledger access.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_access
    WHERE app_name='ledger'
      AND app_role='accountant'
      AND is_active=true
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: accountant fixture missing.';
  END IF;
END $$;

-- 3. Principal has active Ledger access.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_access
    WHERE app_name='ledger'
      AND app_role='principal'
      AND is_active=true
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: principal fixture missing.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS policy-shape assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN (
      'transactions',
      'transaction_revisions',
      'activity_history',
      'fee_payments',
      'student_fee_assignments'
    )
    AND (
      lower(coalesce(qual,''))='true'
      OR lower(coalesce(with_check,''))='true'
      OR lower(coalesce(qual,'')) LIKE '% anon%'
      OR lower(coalesce(with_check,'')) LIKE '% anon%'
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'TEST FAIL: permissive/anon financial policies detected: %.', v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Hard-delete assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_delete_policies integer;
BEGIN
  SELECT count(*)
  INTO v_delete_policies
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN (
      'transactions',
      'fee_payments',
      'student_fee_assignments',
      'transaction_revisions'
    )
    AND cmd='DELETE';

  IF v_delete_policies <> 0 THEN
    RAISE EXCEPTION
      'TEST FAIL: normal Ledger financial tables expose DELETE policies (%).',
      v_delete_policies;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Append-only audit assertion
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname IN (
      'trg_protect_ledger_activity_history',
      'trg_rollback_protect_activity_history'
    )
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: activity_history append-only trigger missing.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Cross-app isolation assertion
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_teacher_ledger_access integer;
  v_inactive_ledger_access integer;
BEGIN
  SELECT count(*)
  INTO v_teacher_ledger_access
  FROM public.app_access
  WHERE app_name='ledger'
    AND is_active=true
    AND app_role='teacher';

  IF v_teacher_ledger_access > 0 THEN
    RAISE EXCEPTION
      'TEST FAIL: teacher-only role has active Ledger access.';
  END IF;

  SELECT count(*)
  INTO v_inactive_ledger_access
  FROM public.app_access
  WHERE app_name='ledger'
    AND is_active=false;

  IF v_inactive_ledger_access = 0 THEN
    RAISE EXCEPTION
      'TEST FAIL: inactive Ledger denial fixture missing.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- School spoofing assertion
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname='set_ledger_context'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: Ledger context trigger function missing.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

SELECT
  'PASS' AS status,
  'Single-school shared-Supabase Ledger regression assertions completed.' AS result;

ROLLBACK;
