-- =============================================================================
-- PRAGAMENT PHASE 3 LEDGER CONTAINMENT / ROLLBACK
-- Single school + shared Supabase
-- =============================================================================
-- DEFAULT MODE: CONTAINMENT
--   Keeps RLS, ownership columns, restrictive audit FKs and append-only history.
--   Removes normal hard-delete capability.
--
-- REVERSION MODE:
--   Only restores selected pre-Phase-3 foreign-key behavior after explicit
--   operator approval. It does NOT grant Principal or Accountant financial
--   hard-delete rights.
--
-- To perform containment only: run as-is.
-- To enable legacy FK restoration: uncomment:
--   SET LOCAL rollback.confirm_reversion = 'true';
-- =============================================================================

BEGIN;

-- SET LOCAL rollback.confirm_reversion = 'true';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.schools) <> 1 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: expected exactly one school.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Ensure Ledger remains restricted to active Ledger access.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rollback_ledger_access()
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
      AND a.school_id = (SELECT id FROM public.schools LIMIT 1)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.rollback_ledger_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_ledger_access() TO authenticated;

-- ---------------------------------------------------------------------------
-- Rebuild policies into conservative containment mode.
-- Accountant: operational write.
-- Principal: read/audit.
-- Admin: explicit administrative exception.
-- No financial hard delete for normal roles.
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
      FOR p IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
      END LOOP;

      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

CREATE POLICY rollback_transactions_select
ON public.transactions
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_transactions_insert
ON public.transactions
FOR INSERT TO authenticated
WITH CHECK (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
);

CREATE POLICY rollback_transactions_update
ON public.transactions
FOR UPDATE TO authenticated
USING (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
)
WITH CHECK (
  public.rollback_ledger_access()
  AND school_id = (SELECT id FROM public.schools LIMIT 1)
);

CREATE POLICY rollback_fee_payments_select
ON public.fee_payments
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_fee_payments_insert
ON public.fee_payments
FOR INSERT TO authenticated
WITH CHECK (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
);

CREATE POLICY rollback_fee_payments_update
ON public.fee_payments
FOR UPDATE TO authenticated
USING (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
)
WITH CHECK (school_id = (SELECT id FROM public.schools LIMIT 1));

CREATE POLICY rollback_assignments_select
ON public.student_fee_assignments
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_assignments_insert
ON public.student_fee_assignments
FOR INSERT TO authenticated
WITH CHECK (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
);

CREATE POLICY rollback_assignments_update
ON public.student_fee_assignments
FOR UPDATE TO authenticated
USING (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
)
WITH CHECK (school_id = (SELECT id FROM public.schools LIMIT 1));

CREATE POLICY rollback_revisions_select
ON public.transaction_revisions
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_revisions_insert
ON public.transaction_revisions
FOR INSERT TO authenticated
WITH CHECK (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('accountant','admin','super_admin')
      AND is_active = true
  )
  AND user_id = auth.uid()
);

CREATE POLICY rollback_activity_select
ON public.activity_history
FOR SELECT TO authenticated
USING (
  public.rollback_ledger_access()
  AND EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('principal','admin','super_admin')
      AND is_active = true
  )
);

CREATE POLICY rollback_activity_insert
ON public.activity_history
FOR INSERT TO authenticated
WITH CHECK (
  public.rollback_ledger_access()
  AND user_id = auth.uid()
);

CREATE POLICY rollback_categories_select
ON public.categories
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_categories_admin_write
ON public.categories
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('admin','super_admin')
      AND is_active = true
  )
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools LIMIT 1)
);

CREATE POLICY rollback_tags_select
ON public.tags
FOR SELECT TO authenticated
USING (public.rollback_ledger_access());

CREATE POLICY rollback_tags_admin_write
ON public.tags
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = auth.uid()
      AND app_name = 'ledger'
      AND app_role IN ('admin','super_admin')
      AND is_active = true
  )
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools LIMIT 1)
);

CREATE POLICY rollback_user_profiles_select
ON public.user_profiles
FOR SELECT TO authenticated
USING (
  email = (SELECT email FROM public.users WHERE id = auth.uid())
  OR (
    public.rollback_ledger_access()
    AND EXISTS (
      SELECT 1 FROM public.app_access
      WHERE user_id = auth.uid()
        AND app_name = 'ledger'
        AND app_role IN ('principal','admin','super_admin')
        AND is_active = true
    )
  )
);

CREATE POLICY rollback_user_profiles_self_update
ON public.user_profiles
FOR UPDATE TO authenticated
USING (email = (SELECT email FROM public.users WHERE id = auth.uid()))
WITH CHECK (email = (SELECT email FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Activity history remains append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rollback_protect_activity_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ROLLBACK_CONTAINMENT: activity_history remains append-only.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ledger_activity_history ON public.activity_history;
DROP TRIGGER IF EXISTS trg_rollback_protect_activity_history ON public.activity_history;

CREATE TRIGGER trg_rollback_protect_activity_history
BEFORE UPDATE OR DELETE ON public.activity_history
FOR EACH ROW EXECUTE FUNCTION public.rollback_protect_activity_history();

-- ---------------------------------------------------------------------------
-- Optional FK reversion. This is deliberately gated and does not change RLS.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_confirmed text := coalesce(
    current_setting('rollback.confirm_reversion', true),
    'false'
  );
BEGIN
  IF v_confirmed = 'true' THEN
    ALTER TABLE public.fee_payments
      DROP CONSTRAINT IF EXISTS fk_fee_payments_tx_school;

    ALTER TABLE public.fee_payments
      ADD CONSTRAINT fk_fee_payments_transaction_id_fkey
      FOREIGN KEY (transaction_id)
      REFERENCES public.transactions(id)
      ON DELETE CASCADE;

    ALTER TABLE public.transaction_revisions
      DROP CONSTRAINT IF EXISTS fk_revisions_tx_school;

    ALTER TABLE public.transaction_revisions
      ADD CONSTRAINT fk_revisions_transaction_id_fkey
      FOREIGN KEY (transaction_id)
      REFERENCES public.transactions(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Remove anon/public table access.
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

SELECT 'LEDGER ROLLBACK/CONTAINMENT APPLIED: single school / shared Supabase.' AS result;
