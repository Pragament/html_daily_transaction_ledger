-- =============================================================================
-- PRAGAMENT PHASE 3 PRE-FLIGHT
-- Single school + shared Supabase for Teacher Diary and Ledger
-- =============================================================================
-- PURPOSE
--   Validate the shared Supabase database before applying the Ledger RLS migration.
--
-- DESIGN
--   * One Supabase project
--   * One current school
--   * Diary and Ledger share Auth/users/school/app_access
--   * Ledger authorization is controlled by app_access(app_name='ledger')
--   * No multi-school inference is required
--
-- FAIL-CLOSED:
--   Any violation raises an exception and aborts this script.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_school_count integer;
  v_ledger_school_count integer;
  v_bad integer;
  v_table text;
  v_required text[] := ARRAY[
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'fee_payments',
    'student_fee_assignments',
    'user_profiles'
  ];
BEGIN
  SELECT count(*) INTO v_school_count FROM public.schools;

  IF v_school_count <> 1 THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: expected exactly one school in this shared Supabase project; found %.',
      v_school_count;
  END IF;

  SELECT count(DISTINCT school_id)
  INTO v_ledger_school_count
  FROM public.app_access
  WHERE app_name = 'ledger'
    AND is_active = true
    AND school_id IS NOT NULL;

  IF v_ledger_school_count > 1 THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: active Ledger access references more than one school (%).',
      v_ledger_school_count;
  END IF;

  FOREACH v_table IN ARRAY v_required LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = v_table
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT FAILED: required Ledger table public.% is missing.', v_table;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Legacy schema sanity
-- The migration itself adds school_id where it is missing, so preflight only
-- requires the business tables and validates any already-present ownership data.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school uuid;
  v_bad integer;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='transactions'
      AND column_name='school_id'
  ) THEN
    SELECT count(*) INTO v_bad
    FROM public.transactions
    WHERE school_id IS NULL OR school_id <> v_school;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'PREFLIGHT FAILED: existing transactions contain % NULL/wrong school_id values.',
        v_bad;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='fee_payments'
      AND column_name='school_id'
  ) THEN
    SELECT count(*) INTO v_bad
    FROM public.fee_payments
    WHERE school_id IS NULL OR school_id <> v_school;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'PREFLIGHT FAILED: existing fee_payments contain % NULL/wrong school_id values.',
        v_bad;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- No permissive legacy policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*)
  INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'transactions',
      'transaction_revisions',
      'categories',
      'tags',
      'activity_history',
      'fee_structures',
      'fee_payments',
      'student_fee_assignments',
      'user_profiles'
    )
    AND (
      lower(coalesce(qual, '')) = 'true'
      OR lower(coalesce(with_check, '')) = 'true'
      OR lower(coalesce(qual, '')) LIKE '%true%'
      OR lower(coalesce(with_check, '')) LIKE '%true%'
      OR lower(coalesce(roles::text, '')) LIKE '%anon%'
      OR lower(coalesce(roles::text, '')) LIKE '%public%'
    );

  IF v_bad > 0 THEN
    RAISE WARNING
      'PREFLIGHT WARNING: % permissive/anon/public Ledger policies detected. The upcoming migration script will DROP these.',
      v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Existing ownership columns, where already present, must agree with the sole
-- school. Legacy tables without school_id are intentionally handled by migration.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school uuid;
  v_table text;
  v_bad integer;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;

  FOREACH v_table IN ARRAY ARRAY[
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'fee_payments',
    'student_fee_assignments'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=v_table
        AND column_name='school_id'
    ) THEN
      EXECUTE format(
        'SELECT count(*) FROM public.%I WHERE school_id IS NULL OR school_id <> $1',
        v_table
      ) INTO v_bad USING v_school;

      IF v_bad > 0 THEN
        RAISE EXCEPTION
          'PREFLIGHT FAILED: public.% contains % rows with NULL/wrong school_id.',
          v_table, v_bad;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Referential sanity
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.transaction_revisions r
  LEFT JOIN public.transactions t ON t.id = r.transaction_id
  WHERE t.id IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: % orphan transaction_revisions.', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.fee_payments p
  LEFT JOIN public.transactions t ON t.id = p.transaction_id
  WHERE t.id IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: % fee_payments reference missing transactions.', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='school_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_payments' AND column_name='school_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.transactions t JOIN public.fee_payments p ON p.transaction_id = t.id WHERE t.school_id IS DISTINCT FROM p.school_id' INTO v_bad;
    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'PREFLIGHT FAILED: % transaction/fee_payment school ownership conflicts.',
        v_bad;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Active Ledger access must belong to the sole school.
-- Teacher-only access must not be reused as Ledger access.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school uuid;
  v_bad integer;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;

  SELECT count(*)
  INTO v_bad
  FROM public.app_access
  WHERE app_name = 'ledger'
    AND is_active = true
    AND (
      school_id IS DISTINCT FROM v_school
      OR school_id IS NULL
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: % active Ledger access rows are not bound to the sole school.',
      v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants must not expose Ledger tables to anon/public.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*)
  INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'transactions',
      'transaction_revisions',
      'categories',
      'tags',
      'activity_history',
      'fee_structures',
      'fee_payments',
      'student_fee_assignments',
      'user_profiles'
    )
    AND grantee IN ('anon', 'public');

  IF v_bad > 0 THEN
    RAISE WARNING
      'PREFLIGHT WARNING: % anon/public Ledger table grants detected. The upcoming migration script will REVOKE these.',
      v_bad;
  END IF;
END $$;

COMMIT;

SELECT 'PREFLIGHT PASSED: one school / shared Supabase Ledger baseline is valid.' AS result;
