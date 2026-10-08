-- =============================================================================
-- PRAGAMENT LEDGER: FACULTY DIRECTORY + FACULTY EXPENSES + SALARY HISTORY
-- Single school / shared Supabase
-- =============================================================================
--
-- PURPOSE
--   Adds first-class faculty management to the existing Ledger application.
--
-- MODEL
--   faculty
--       1 ────────< faculty_expense_payments
--                         |
--                         └──── faculty_expense_categories
--
--   faculty_expense_payments may optionally reference the existing
--   public.transactions table so faculty expenses participate in the same
--   Ledger transaction/audit/reporting workflow.
--
-- IMPORTANT
--   This migration assumes Phase 3 Ledger RLS has already created:
--     public.ledger_school_id()
--     public.has_ledger_access()
--     public.is_ledger_accountant()
--     public.is_ledger_principal()
--     public.is_ledger_admin()
--
--   If those helpers are not present, run the single-school Ledger migration
--   first.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Faculty Directory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.faculty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL
    REFERENCES public.schools(id)
    ON DELETE RESTRICT,

  employee_id text NOT NULL,
  faculty_name text NOT NULL,
  department text NOT NULL,
  designation text NOT NULL,
  mobile_number text NOT NULL,
  email text,
  joining_date date NOT NULL,

  -- Current/base salary. Payment history is stored separately.
  salary numeric(14,2) NOT NULL DEFAULT 0
    CHECK (salary >= 0),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),

  CONSTRAINT faculty_employee_id_not_blank
    CHECK (btrim(employee_id) <> ''),

  CONSTRAINT faculty_name_not_blank
    CHECK (btrim(faculty_name) <> '')
);

-- Employee ID is the stable business identifier within the school.
CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_school_employee_id
  ON public.faculty (school_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_faculty_school_name
  ON public.faculty (school_id, faculty_name);

CREATE INDEX IF NOT EXISTS idx_faculty_school_department
  ON public.faculty (school_id, department);

CREATE INDEX IF NOT EXISTS idx_faculty_school_status
  ON public.faculty (school_id, status);

-- ---------------------------------------------------------------------------
-- 2. Faculty Expense Categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.faculty_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL
    REFERENCES public.schools(id)
    ON DELETE RESTRICT,

  parent_id uuid
    REFERENCES public.faculty_expense_categories(id)
    ON DELETE RESTRICT,

  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT faculty_expense_category_name_not_blank
    CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_expense_category_school_parent_name
  ON public.faculty_expense_categories (
    school_id,
    parent_id,
    name
  );

CREATE INDEX IF NOT EXISTS idx_faculty_expense_categories_school
  ON public.faculty_expense_categories(school_id);

-- ---------------------------------------------------------------------------
-- 3. Seed required Faculty Expenses hierarchy
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_set_faculty_category_context ON public.faculty_expense_categories;

DO $$
DECLARE
  v_school uuid;
  v_parent uuid;
  v_name text;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'FACULTY MIGRATION ABORTED: no school exists.';
  END IF;

  INSERT INTO public.faculty_expense_categories
    (school_id, parent_id, name)
  VALUES
    (v_school, NULL, 'Faculty Expenses')
  ON CONFLICT (school_id, parent_id, name) DO UPDATE
    SET is_active = true
  RETURNING id INTO v_parent;

  IF v_parent IS NULL THEN
    SELECT id
    INTO v_parent
    FROM public.faculty_expense_categories
    WHERE school_id = v_school
      AND parent_id IS NULL
      AND name = 'Faculty Expenses'
    LIMIT 1;
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'Salary',
    'Advance Salary',
    'Bonus',
    'Incentives',
    'Reimbursements',
    'Other Faculty Expenses'
  ] LOOP
    INSERT INTO public.faculty_expense_categories
      (school_id, parent_id, name)
    VALUES
      (v_school, v_parent, v_name)
    ON CONFLICT (school_id, parent_id, name) DO UPDATE
      SET is_active = true;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Faculty Expense / Salary Payment History
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.faculty_expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL
    REFERENCES public.schools(id)
    ON DELETE RESTRICT,

  faculty_id uuid NOT NULL
    REFERENCES public.faculty(id)
    ON DELETE RESTRICT,

  expense_category_id uuid NOT NULL
    REFERENCES public.faculty_expense_categories(id)
    ON DELETE RESTRICT,

  -- Optional link into the existing Ledger transaction table.
  transaction_id integer,

  payment_date date NOT NULL DEFAULT CURRENT_DATE,

  voucher_number text NOT NULL,

  amount numeric(14,2) NOT NULL
    CHECK (amount > 0),

  payment_mode text NOT NULL
    CHECK (
      payment_mode IN (
        'cash',
        'bank_transfer',
        'cheque',
        'upi',
        'other'
      )
    ),

  remarks text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_payment_school_voucher
  ON public.faculty_expense_payments(school_id, voucher_number);

CREATE INDEX IF NOT EXISTS idx_faculty_payments_faculty_date
  ON public.faculty_expense_payments(
    school_id,
    faculty_id,
    payment_date DESC
  );

CREATE INDEX IF NOT EXISTS idx_faculty_payments_category
  ON public.faculty_expense_payments(
    school_id,
    expense_category_id,
    payment_date DESC
  );

CREATE INDEX IF NOT EXISTS idx_faculty_payments_date
  ON public.faculty_expense_payments(
    school_id,
    payment_date DESC
  );

-- ---------------------------------------------------------------------------
-- 5. Link faculty payment to existing transaction when the column shape allows
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.faculty_expense_payments
      DROP CONSTRAINT IF EXISTS fk_faculty_payment_transaction;

    ALTER TABLE public.faculty_expense_payments
      ADD CONSTRAINT fk_faculty_payment_transaction
      FOREIGN KEY (transaction_id)
      REFERENCES public.transactions(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Faculty payment must belong to the same school as the faculty member
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_faculty_payment_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_faculty_school uuid;
  v_category_school uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FACULTY_AUTH_REQUIRED: authenticated Ledger user required.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'FACULTY_LEDGER_ACCESS_DENIED: active Ledger access required.';
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := public.ledger_school_id();
  END IF;

  IF NEW.school_id <> public.ledger_school_id() THEN
    RAISE EXCEPTION 'FACULTY_SCHOOL_MISMATCH: invalid school_id.';
  END IF;

  SELECT school_id
  INTO v_faculty_school
  FROM public.faculty
  WHERE id = NEW.faculty_id;

  IF v_faculty_school IS NULL THEN
    RAISE EXCEPTION 'FACULTY_NOT_FOUND: faculty member does not exist.';
  END IF;

  IF v_faculty_school <> NEW.school_id THEN
    RAISE EXCEPTION 'FACULTY_CROSS_SCHOOL_REFERENCE: faculty belongs to another school.';
  END IF;

  SELECT school_id
  INTO v_category_school
  FROM public.faculty_expense_categories
  WHERE id = NEW.expense_category_id
    AND is_active = true;

  IF v_category_school IS NULL THEN
    RAISE EXCEPTION 'FACULTY_EXPENSE_CATEGORY_NOT_FOUND: active expense category required.';
  END IF;

  IF v_category_school <> NEW.school_id THEN
    RAISE EXCEPTION 'FACULTY_CATEGORY_CROSS_SCHOOL_REFERENCE: category belongs to another school.';
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF NEW.created_by <> auth.uid() AND NOT public.is_ledger_admin() THEN
    RAISE EXCEPTION 'FACULTY_IDENTITY_SPOOFING: created_by cannot be another user.';
  END IF;

  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_faculty_payment_context
  ON public.faculty_expense_payments;

CREATE TRIGGER trg_validate_faculty_payment_context
BEFORE INSERT OR UPDATE
ON public.faculty_expense_payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_faculty_payment_context();

-- ---------------------------------------------------------------------------
-- 7. Faculty directory context
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_faculty_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FACULTY_AUTH_REQUIRED: authenticated Ledger user required.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'FACULTY_LEDGER_ACCESS_DENIED: active Ledger access required.';
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := public.ledger_school_id();
  END IF;

  IF NEW.school_id <> public.ledger_school_id() THEN
    RAISE EXCEPTION 'FACULTY_SCHOOL_MISMATCH: invalid school_id.';
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  NEW.updated_by := auth.uid();
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_faculty_context ON public.faculty;

CREATE TRIGGER trg_set_faculty_context
BEFORE INSERT OR UPDATE
ON public.faculty
FOR EACH ROW
EXECUTE FUNCTION public.set_faculty_context();

-- ---------------------------------------------------------------------------
-- 8. Faculty category context
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_faculty_category_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_school uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FACULTY_AUTH_REQUIRED: authenticated Ledger user required.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'FACULTY_LEDGER_ACCESS_DENIED: active Ledger access required.';
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := public.ledger_school_id();
  END IF;

  IF NEW.school_id <> public.ledger_school_id() THEN
    RAISE EXCEPTION 'FACULTY_SCHOOL_MISMATCH: invalid school_id.';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT school_id
    INTO v_parent_school
    FROM public.faculty_expense_categories
    WHERE id = NEW.parent_id;

    IF v_parent_school IS NULL THEN
      RAISE EXCEPTION 'FACULTY_CATEGORY_PARENT_NOT_FOUND.';
    END IF;

    IF v_parent_school <> NEW.school_id THEN
      RAISE EXCEPTION 'FACULTY_CATEGORY_CROSS_SCHOOL_PARENT.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_faculty_category_context
  ON public.faculty_expense_categories;

CREATE TRIGGER trg_set_faculty_category_context
BEFORE INSERT OR UPDATE
ON public.faculty_expense_categories
FOR EACH ROW
EXECUTE FUNCTION public.set_faculty_category_context();

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty FORCE ROW LEVEL SECURITY;

ALTER TABLE public.faculty_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_expense_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.faculty_expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_expense_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faculty_select ON public.faculty;
DROP POLICY IF EXISTS faculty_insert ON public.faculty;
DROP POLICY IF EXISTS faculty_update ON public.faculty;
DROP POLICY IF EXISTS faculty_delete ON public.faculty;

DROP POLICY IF EXISTS faculty_categories_select
  ON public.faculty_expense_categories;
DROP POLICY IF EXISTS faculty_categories_insert
  ON public.faculty_expense_categories;
DROP POLICY IF EXISTS faculty_categories_update
  ON public.faculty_expense_categories;
DROP POLICY IF EXISTS faculty_categories_delete
  ON public.faculty_expense_categories;

DROP POLICY IF EXISTS faculty_payments_select
  ON public.faculty_expense_payments;
DROP POLICY IF EXISTS faculty_payments_insert
  ON public.faculty_expense_payments;
DROP POLICY IF EXISTS faculty_payments_update
  ON public.faculty_expense_payments;
DROP POLICY IF EXISTS faculty_payments_delete
  ON public.faculty_expense_payments;

-- Faculty directory:
-- Accountant: read/write
-- Principal: read/supervision
-- Admin: controlled write
CREATE POLICY faculty_select
ON public.faculty
FOR SELECT TO authenticated
USING (public.has_ledger_access());

CREATE POLICY faculty_insert
ON public.faculty
FOR INSERT TO authenticated
WITH CHECK (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
);

CREATE POLICY faculty_update
ON public.faculty
FOR UPDATE TO authenticated
USING (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
)
WITH CHECK (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
);

-- No hard delete of faculty records.
-- Set status='inactive' instead.

-- Faculty expense categories:
CREATE POLICY faculty_categories_select
ON public.faculty_expense_categories
FOR SELECT TO authenticated
USING (public.has_ledger_access());

CREATE POLICY faculty_categories_insert
ON public.faculty_expense_categories
FOR INSERT TO authenticated
WITH CHECK (public.is_ledger_admin());

CREATE POLICY faculty_categories_update
ON public.faculty_expense_categories
FOR UPDATE TO authenticated
USING (public.is_ledger_admin())
WITH CHECK (public.is_ledger_admin());

CREATE POLICY faculty_categories_delete
ON public.faculty_expense_categories
FOR DELETE TO authenticated
USING (public.is_ledger_admin());

-- Salary/faculty expense history:
-- Accountant: operational entry/update
-- Principal: read/reporting
-- No hard delete.
CREATE POLICY faculty_payments_select
ON public.faculty_expense_payments
FOR SELECT TO authenticated
USING (public.is_ledger_reader());

CREATE POLICY faculty_payments_insert
ON public.faculty_expense_payments
FOR INSERT TO authenticated
WITH CHECK (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
);

CREATE POLICY faculty_payments_update
ON public.faculty_expense_payments
FOR UPDATE TO authenticated
USING (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
)
WITH CHECK (
  public.is_ledger_accountant()
  OR public.is_ledger_principal()
  OR public.is_ledger_admin()
);

-- No DELETE policy.

-- ---------------------------------------------------------------------------
-- 10. No anon/public access
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.faculty FROM anon;
REVOKE ALL ON TABLE public.faculty FROM PUBLIC;

REVOKE ALL ON TABLE public.faculty_expense_categories FROM anon;
REVOKE ALL ON TABLE public.faculty_expense_categories FROM PUBLIC;

REVOKE ALL ON TABLE public.faculty_expense_payments FROM anon;
REVOKE ALL ON TABLE public.faculty_expense_payments FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 11. Useful reporting views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.faculty_salary_register
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.school_id,
  f.employee_id,
  f.faculty_name,
  f.department,
  f.designation,
  f.status AS faculty_status,
  p.payment_date,
  p.voucher_number,
  p.amount,
  c.name AS expense_category,
  p.payment_mode,
  p.remarks,
  p.created_at
FROM public.faculty_expense_payments p
JOIN public.faculty f
  ON f.id = p.faculty_id
JOIN public.faculty_expense_categories c
  ON c.id = p.expense_category_id;

CREATE OR REPLACE VIEW public.faculty_monthly_salary_report
WITH (security_invoker = true)
AS
SELECT
  p.school_id,
  date_trunc('month', p.payment_date)::date AS month,
  count(*) AS payment_count,
  sum(p.amount) AS total_amount
FROM public.faculty_expense_payments p
JOIN public.faculty_expense_categories c
  ON c.id = p.expense_category_id
WHERE c.name = 'Salary'
GROUP BY
  p.school_id,
  date_trunc('month', p.payment_date)::date;

CREATE OR REPLACE VIEW public.faculty_department_expense_report
WITH (security_invoker = true)
AS
SELECT
  p.school_id,
  f.department,
  c.name AS expense_category,
  count(*) AS payment_count,
  sum(p.amount) AS total_amount
FROM public.faculty_expense_payments p
JOIN public.faculty f
  ON f.id = p.faculty_id
JOIN public.faculty_expense_categories c
  ON c.id = p.expense_category_id
GROUP BY
  p.school_id,
  f.department,
  c.name;

-- ---------------------------------------------------------------------------
-- 12. Dashboard summary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.faculty_dashboard_summary
WITH (security_invoker = true)
AS
SELECT
  f.school_id,
  count(*) AS total_faculty,
  count(*) FILTER (WHERE f.status = 'active') AS active_faculty,
  coalesce((
    SELECT sum(p.amount)
    FROM public.faculty_expense_payments p
    JOIN public.faculty_expense_categories c
      ON c.id = p.expense_category_id
    WHERE p.school_id = f.school_id
      AND c.name = 'Salary'
      AND date_trunc('month', p.payment_date)
          = date_trunc('month', CURRENT_DATE)
  ), 0)::numeric(14,2) AS monthly_salary_paid,
  coalesce((
    SELECT sum(p.amount)
    FROM public.faculty_expense_payments p
    WHERE p.school_id = f.school_id
  ), 0)::numeric(14,2) AS total_faculty_expenses
FROM public.faculty f
GROUP BY f.school_id;

-- ---------------------------------------------------------------------------
-- 13. Atomic RPC for Faculty Salary / Transaction
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pay_faculty_salary(
  p_faculty_id uuid,
  p_expense_category_id uuid,
  p_payment_date date,
  p_voucher_number text,
  p_amount numeric,
  p_payment_mode text,
  p_remarks text,
  p_transaction_head text,
  p_transaction_main_category text,
  p_transaction_sub_category text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id uuid;
  v_transaction_id integer;
  v_payment_id uuid;
  v_user_id uuid;
BEGIN
  -- 1. Validate Access
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'Ledger access denied';
  END IF;
  
  -- Check roles
  IF NOT (public.is_ledger_accountant() OR public.is_ledger_principal() OR public.is_ledger_admin()) THEN
    RAISE EXCEPTION 'Insufficient permissions to pay salary';
  END IF;

  v_school_id := public.ledger_school_id();

  -- 2. Insert into transactions table
  INSERT INTO public.transactions (
    school_id,
    type,
    date,
    reference,
    particulars,
    amount,
    head,
    main_category,
    sub_category,
    user_id,
    created_by
  ) VALUES (
    v_school_id,
    'expense',
    p_payment_date,
    p_voucher_number,
    COALESCE(p_remarks, 'Faculty Salary Payment'),
    p_amount,
    p_transaction_head,
    p_transaction_main_category,
    p_transaction_sub_category,
    v_user_id,
    v_user_id::text
  ) RETURNING id INTO v_transaction_id;

  -- 3. Insert into faculty_expense_payments
  INSERT INTO public.faculty_expense_payments (
    school_id,
    faculty_id,
    expense_category_id,
    transaction_id,
    payment_date,
    voucher_number,
    amount,
    payment_mode,
    remarks,
    created_by,
    updated_by
  ) VALUES (
    v_school_id,
    p_faculty_id,
    p_expense_category_id,
    v_transaction_id,
    p_payment_date,
    p_voucher_number,
    p_amount,
    p_payment_mode,
    p_remarks,
    v_user_id,
    v_user_id
  ) RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

COMMIT;

SELECT
  'FACULTY MODULE CREATED: directory, expense categories, salary/payment history, RLS and reporting views.' AS result;
