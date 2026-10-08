-- =============================================================================
-- PRAGAMENT PHASE 3 LEDGER RLS
-- Single school + shared Supabase with Teacher Diary
-- =============================================================================
-- BUSINESS MODEL
--   Accountant: Ledger operational entry/update; no hard delete.
--   Principal: Ledger supervision/read/audit; no normal operational writes.
--   Teacher-only users: no Ledger access.
--   Inactive Ledger users: no Ledger access.
--
-- IMPORTANT
--   This migration intentionally does NOT implement multi-school inference.
--   school_id is retained for integrity/future expansion, but exactly one school
--   is enforced by this migration.
--
-- NOTE
--   The currently supplied Ledger schema does not expose a faculty-salary table.
--   Salary data should receive the same Accountant-write / Principal-read policy
--   once the real table name/schema is supplied.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Require exactly one school
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF (SELECT count(*) FROM public.schools) <> 1 THEN
    RAISE EXCEPTION
      'LEDGER MIGRATION ABORTED: this shared Supabase project must contain exactly one school.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Authoritative role helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.schools LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_ledger_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_access a
    WHERE a.user_id = auth.uid()
      AND a.app_name = 'ledger'
      AND a.is_active = true
      AND a.school_id = public.ledger_school_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_accountant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_access a
    WHERE a.user_id = auth.uid()
      AND a.app_name = 'ledger'
      AND a.app_role IN ('accountant', 'principal')
      AND a.is_active = true
      AND a.school_id = public.ledger_school_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_principal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_access a
    WHERE a.user_id = auth.uid()
      AND a.app_name = 'ledger'
      AND a.app_role = 'principal'
      AND a.is_active = true
      AND a.school_id = public.ledger_school_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_access a
    WHERE a.user_id = auth.uid()
      AND a.app_name = 'ledger'
      AND a.app_role IN ('admin', 'super_admin')
      AND a.is_active = true
      AND a.school_id = public.ledger_school_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ledger_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_ledger_accountant()
      OR public.is_ledger_principal()
      OR public.is_ledger_admin();
$$;

REVOKE EXECUTE ON FUNCTION public.ledger_school_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_ledger_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_ledger_accountant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_ledger_principal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_ledger_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_ledger_reader() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ledger_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_ledger_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_accountant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_principal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_reader() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ownership columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

ALTER TABLE public.transaction_revisions
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

ALTER TABLE public.activity_history
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

ALTER TABLE public.fee_payments
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

ALTER TABLE public.student_fee_assignments
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

-- ---------------------------------------------------------------------------
-- 4. Single-school backfill
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school uuid;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;

  UPDATE public.transactions
  SET school_id = v_school
  WHERE school_id IS NULL;

  UPDATE public.transactions t
  SET user_id = u.id
  FROM public.users u
  WHERE t.user_id IS NULL
    AND t.created_by = u.email;

  UPDATE public.categories SET school_id = v_school WHERE school_id IS NULL;
  UPDATE public.tags SET school_id = v_school WHERE school_id IS NULL;

  UPDATE public.transaction_revisions r
  SET school_id = t.school_id
  FROM public.transactions t
  WHERE r.school_id IS NULL
    AND r.transaction_id = t.id;

  UPDATE public.transaction_revisions r
  SET user_id = u.id
  FROM public.users u
  WHERE r.user_id IS NULL
    AND r.created_by = u.email;

  UPDATE public.activity_history a
  SET school_id = t.school_id
  FROM public.transactions t
  WHERE a.school_id IS NULL
    AND a.transaction_id = t.id;

  UPDATE public.activity_history a
  SET school_id = v_school
  WHERE a.school_id IS NULL;

  UPDATE public.activity_history a
  SET user_id = u.id
  FROM public.users u
  WHERE a.user_id IS NULL
    AND a.user_email = u.email;

  UPDATE public.fee_payments
  SET school_id = v_school
  WHERE school_id IS NULL;

  UPDATE public.student_fee_assignments
  SET school_id = v_school
  WHERE school_id IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Fail if any ownership value is still unresolved
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
  v_bad integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'fee_payments',
    'student_fee_assignments'
  ] LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE school_id IS NULL OR school_id <> public.ledger_school_id()',
      v_table
    ) INTO v_bad;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'LEDGER MIGRATION ABORTED: public.% still contains % NULL/wrong-school rows.',
        v_table, v_bad;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Referential protection
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE public.categories
    DROP CONSTRAINT IF EXISTS categories_parent_id_fkey;

  ALTER TABLE public.categories
    ADD CONSTRAINT categories_parent_id_fkey
    FOREIGN KEY (parent_id)
    REFERENCES public.categories(id)
    ON DELETE RESTRICT;

  ALTER TABLE public.transactions
    DROP CONSTRAINT IF EXISTS uq_transactions_id_school;

  ALTER TABLE public.transactions
    ADD CONSTRAINT uq_transactions_id_school UNIQUE (id, school_id);

  ALTER TABLE public.transaction_revisions
    DROP CONSTRAINT IF EXISTS fk_revisions_tx_school;

  ALTER TABLE public.transaction_revisions
    ADD CONSTRAINT fk_revisions_tx_school
    FOREIGN KEY (transaction_id, school_id)
    REFERENCES public.transactions(id, school_id)
    ON DELETE RESTRICT;

  ALTER TABLE public.fee_payments
    DROP CONSTRAINT IF EXISTS fk_fee_payments_tx_school;

  ALTER TABLE public.fee_payments
    ADD CONSTRAINT fk_fee_payments_tx_school
    FOREIGN KEY (transaction_id, school_id)
    REFERENCES public.transactions(id, school_id)
    ON DELETE RESTRICT;
END $$;

ALTER TABLE public.transactions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.transaction_revisions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.categories ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.tags ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.activity_history ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.fee_payments ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.student_fee_assignments ALTER COLUMN school_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Auto-bind new rows to the sole school and current authenticated user
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_ledger_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AUTH_REQUIRED: Ledger writes require an authenticated user.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'LEDGER_ACCESS_DENIED: caller has no active Ledger access.';
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := public.ledger_school_id();
  ELSIF NEW.school_id <> public.ledger_school_id() THEN
    RAISE EXCEPTION 'LEDGER_SCHOOL_MISMATCH: school_id must belong to the current Ledger school.';
  END IF;

  IF TG_TABLE_NAME IN ('transactions','transaction_revisions','activity_history') THEN
    IF NEW.user_id IS NULL THEN
      NEW.user_id := auth.uid();
    ELSIF NEW.user_id <> auth.uid() AND NOT public.is_ledger_admin() THEN
      RAISE EXCEPTION 'LEDGER_IDENTITY_SPOOFING: user_id cannot be another user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ledger_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ledger_context() TO authenticated;

DROP TRIGGER IF EXISTS trg_transactions_ledger_context ON public.transactions;
CREATE TRIGGER trg_transactions_ledger_context
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_revisions_ledger_context ON public.transaction_revisions;
CREATE TRIGGER trg_revisions_ledger_context
BEFORE INSERT OR UPDATE ON public.transaction_revisions
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_activity_ledger_context ON public.activity_history;
CREATE TRIGGER trg_activity_ledger_context
BEFORE INSERT ON public.activity_history
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_fee_payments_ledger_context ON public.fee_payments;
CREATE TRIGGER trg_fee_payments_ledger_context
BEFORE INSERT OR UPDATE ON public.fee_payments
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_fee_assignments_ledger_context ON public.student_fee_assignments;
CREATE TRIGGER trg_fee_assignments_ledger_context
BEFORE INSERT OR UPDATE ON public.student_fee_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_categories_ledger_context ON public.categories;
CREATE TRIGGER trg_categories_ledger_context
BEFORE INSERT OR UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

DROP TRIGGER IF EXISTS trg_tags_ledger_context ON public.tags;
CREATE TRIGGER trg_tags_ledger_context
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

-- ---------------------------------------------------------------------------
-- 8. Activity history is append-only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_ledger_activity_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'LEDGER_AUDIT_APPEND_ONLY: activity_history cannot be updated or deleted.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_ledger_activity_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_ledger_activity_history() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_ledger_activity_history ON public.activity_history;
CREATE TRIGGER trg_protect_ledger_activity_history
BEFORE UPDATE OR DELETE ON public.activity_history
FOR EACH ROW EXECUTE FUNCTION public.protect_ledger_activity_history();

-- ---------------------------------------------------------------------------
-- 9. Replace all Ledger RLS policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  p record;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'fee_structures',
    'fee_payments',
    'student_fee_assignments',
    'user_profiles'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

      FOR p IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Transactions
--     Accountant = read/write
--     Principal = read only
--     Admin = controlled exception
--     Nobody gets normal hard delete
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_transactions_select
ON public.transactions
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

CREATE POLICY ledger_transactions_insert
ON public.transactions
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

CREATE POLICY ledger_transactions_update
ON public.transactions
FOR UPDATE TO authenticated
USING (public.is_ledger_accountant() OR public.is_ledger_admin())
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

-- Deliberately NO DELETE policy.

-- ---------------------------------------------------------------------------
-- 11. Fee payments
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_fee_payments_select
ON public.fee_payments
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

CREATE POLICY ledger_fee_payments_insert
ON public.fee_payments
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

CREATE POLICY ledger_fee_payments_update
ON public.fee_payments
FOR UPDATE TO authenticated
USING (public.is_ledger_accountant() OR public.is_ledger_admin())
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

-- Deliberately NO DELETE policy.

-- ---------------------------------------------------------------------------
-- 12. Student fee assignments
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_fee_assignments_select
ON public.student_fee_assignments
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

CREATE POLICY ledger_fee_assignments_insert
ON public.student_fee_assignments
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

CREATE POLICY ledger_fee_assignments_update
ON public.student_fee_assignments
FOR UPDATE TO authenticated
USING (public.is_ledger_accountant() OR public.is_ledger_admin())
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

-- Deliberately NO DELETE policy.

-- ---------------------------------------------------------------------------
-- 13. Revisions
--     Principal can read history; normal revision creation belongs to the
--     operational/accounting workflow.
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_revisions_select
ON public.transaction_revisions
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

CREATE POLICY ledger_revisions_insert
ON public.transaction_revisions
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_accountant() OR public.is_ledger_admin());

-- Deliberately NO DELETE policy.

-- ---------------------------------------------------------------------------
-- 14. Activity history
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_activity_select
ON public.activity_history
FOR SELECT TO authenticated
USING (public.is_ledger_principal() OR public.is_ledger_admin());

CREATE POLICY ledger_activity_insert
ON public.activity_history
FOR INSERT TO authenticated
WITH CHECK (
  (public.is_ledger_accountant() OR public.is_ledger_admin())
  AND user_id = auth.uid()
);

-- No UPDATE/DELETE policies.

-- ---------------------------------------------------------------------------
-- 15. Categories and tags
--     Read for Ledger users. Master-data mutation is an admin-only exception.
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_categories_select
ON public.categories
FOR SELECT TO authenticated
USING (public.has_ledger_access());

CREATE POLICY ledger_categories_insert
ON public.categories
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_admin());

CREATE POLICY ledger_categories_update
ON public.categories
FOR UPDATE TO authenticated
USING (public.is_ledger_admin())
WITH CHECK (public.is_ledger_admin());

CREATE POLICY ledger_categories_delete
ON public.categories
FOR DELETE TO authenticated
USING (public.is_ledger_admin());

CREATE POLICY ledger_tags_select
ON public.tags
FOR SELECT TO authenticated
USING (public.has_ledger_access());

CREATE POLICY ledger_tags_insert
ON public.tags
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_admin());

CREATE POLICY ledger_tags_update
ON public.tags
FOR UPDATE TO authenticated
USING (public.is_ledger_admin())
WITH CHECK (public.is_ledger_admin());

CREATE POLICY ledger_tags_delete
ON public.tags
FOR DELETE TO authenticated
USING (public.is_ledger_admin());

-- ---------------------------------------------------------------------------
-- 16. Fee structures, if present
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.fee_structures') IS NOT NULL THEN
    EXECUTE $p$
      ALTER TABLE public.fee_structures
      ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)
    $p$;

    EXECUTE $p$
      UPDATE public.fee_structures
      SET school_id = public.ledger_school_id()
      WHERE school_id IS NULL
    $p$;

    EXECUTE $p$
      ALTER TABLE public.fee_structures ALTER COLUMN school_id SET NOT NULL
    $p$;

    EXECUTE $p$
      CREATE POLICY ledger_fee_structures_select
      ON public.fee_structures
      FOR SELECT TO authenticated
      USING (public.is_ledger_reader())
    $p$;

    EXECUTE $p$
      CREATE POLICY ledger_fee_structures_insert
      ON public.fee_structures
      FOR INSERT TO authenticated
      WITH CHECK (public.is_ledger_admin())
    $p$;

    EXECUTE $p$
      CREATE POLICY ledger_fee_structures_update
      ON public.fee_structures
      FOR UPDATE TO authenticated
      USING (public.is_ledger_admin())
      WITH CHECK (public.is_ledger_admin())
    $p$;

    EXECUTE $p$
      CREATE POLICY ledger_fee_structures_delete
      ON public.fee_structures
      FOR DELETE TO authenticated
      USING (public.is_ledger_admin())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 17. User profiles
--     Ledger principal/admin may inspect users belonging to the one school.
--     A user may still read/update their own profile.
-- ---------------------------------------------------------------------------

CREATE POLICY ledger_user_profiles_select
ON public.user_profiles
FOR SELECT TO authenticated
USING (
  email = (SELECT email FROM public.users WHERE id = auth.uid())
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
);

CREATE POLICY ledger_user_profiles_update_self
ON public.user_profiles
FOR UPDATE TO authenticated
USING (email = (SELECT email FROM public.users WHERE id = auth.uid()))
WITH CHECK (email = (SELECT email FROM public.users WHERE id = auth.uid()));

CREATE POLICY ledger_user_profiles_insert_self
ON public.user_profiles
FOR INSERT TO authenticated
WITH CHECK (email = (SELECT email FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 18. Remove direct anon/public access
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'fee_structures',
    'fee_payments',
    'student_fee_assignments',
    'user_profiles'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

SELECT 'PHASE 3 LEDGER RLS APPLIED: single school / shared Supabase.' AS result;
