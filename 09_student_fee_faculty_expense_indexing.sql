-- =============================================================================
-- PRAGAMENT LEDGER: STUDENT-INDEXED FEES & FACULTY-INDEXED EXPENSES
-- Migration: 09_student_fee_faculty_expense_indexing.sql
-- =============================================================================
--
-- PURPOSE:
--   1. Restores strict role-based Ledger authorization helpers (no OR TRUE
--      bypass; blocks anon, teacher-only, inactive, and cross-school users).
--   2. Upgrades students table with permanent UUID id, school_id, status, and
--      unique admission_number per school.
--   3. Upgrades student_fee_assignments with student_uuid FK, discount_amount,
--      and due_date with automatic student_uuid <-> admission_number sync.
--   4. Upgrades fee_payments with UUID id, student_id FK, fee_assignment_id FK,
--      fee_category_id FK, amount, payment_date, payment_mode, unique
--      receipt_number per school, reference_number, remarks, status, and audit
--      creator metadata.
--   5. Upgrades transactions with nullable student_id FK, faculty_id FK, and
--      payment_mode for direct person-indexed ledger integration.
--   6. Seeds missing Faculty Expense subcategories (Travel Expense,
--      Gifts / Goodies, Training / Workshop Expenses) without duplicates and
--      extends faculty_expense_payments with reference_number, salary_month,
--      particulars, and status.
--   7. Installs atomic PostgreSQL RPCs:
--      - public.record_student_fee_payment(...) -> jsonb
--      - public.record_faculty_expense(...) -> jsonb
--      - public.pay_faculty_salary(...) -> uuid (delegates cleanly)
--   8. Enforces strict authenticated-only RLS across all Ledger tables and
--      revokes all anon/PUBLIC table access.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Strict Single-School & Role Authorization Helpers
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

CREATE OR REPLACE FUNCTION public.has_ledger_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.app_access a
      WHERE a.user_id = auth.uid()
        AND a.app_name = 'ledger'
        AND a.is_active = true
        AND a.school_id = public.ledger_school_id()
    )
  );
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
    AND EXISTS (
      SELECT 1
      FROM public.app_access a
      WHERE a.user_id = auth.uid()
        AND a.app_name = 'ledger'
        AND a.app_role IN ('accountant', 'principal', 'admin', 'super_admin')
        AND a.is_active = true
        AND a.school_id = public.ledger_school_id()
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
    AND EXISTS (
      SELECT 1
      FROM public.app_access a
      WHERE a.user_id = auth.uid()
        AND a.app_name = 'ledger'
        AND a.app_role IN ('principal', 'admin', 'super_admin')
        AND a.is_active = true
        AND a.school_id = public.ledger_school_id()
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
    AND EXISTS (
      SELECT 1
      FROM public.app_access a
      WHERE a.user_id = auth.uid()
        AND a.app_name = 'ledger'
        AND a.app_role IN ('admin', 'super_admin')
        AND a.is_active = true
        AND a.school_id = public.ledger_school_id()
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

REVOKE EXECUTE ON FUNCTION public.ledger_school_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_ledger_access() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ledger_accountant() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ledger_principal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ledger_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ledger_reader() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ledger_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_ledger_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_accountant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_principal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ledger_reader() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Strict Ledger Trigger Context (No Unauthenticated / Cross-School Writes)
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

  IF TG_TABLE_NAME IN ('transactions', 'transaction_revisions', 'activity_history') THEN
    IF NEW.user_id IS NULL THEN
      NEW.user_id := auth.uid();
    ELSIF NEW.user_id <> auth.uid() AND NOT public.is_ledger_admin() THEN
      RAISE EXCEPTION 'LEDGER_IDENTITY_SPOOFING: user_id cannot be another user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ledger_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ledger_context() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Upgrade Students Table (Stable UUID ID + Status + School Isolation)
-- ---------------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DROP TRIGGER IF EXISTS trg_students_ledger_context ON public.students;

UPDATE public.students SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE public.students SET school_id = public.ledger_school_id() WHERE school_id IS NULL;
UPDATE public.students SET status = 'active' WHERE status IS NULL;

ALTER TABLE public.students ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.students ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.students ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.students ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.students'::regclass AND conname = 'students_status_check'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'inactive'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.students'::regclass AND conname = 'uq_students_id'
  ) THEN
    ALTER TABLE public.students ADD CONSTRAINT uq_students_id UNIQUE (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.students'::regclass AND conname = 'uq_students_school_admission_number'
  ) THEN
    ALTER TABLE public.students ADD CONSTRAINT uq_students_school_admission_number UNIQUE (school_id, admission_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_school_name ON public.students(school_id, name);
CREATE INDEX IF NOT EXISTS idx_students_school_class_sec ON public.students(school_id, class, section);
CREATE INDEX IF NOT EXISTS idx_students_school_status ON public.students(school_id, status);

DROP TRIGGER IF EXISTS trg_students_ledger_context ON public.students;
CREATE TRIGGER trg_students_ledger_context
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.set_ledger_context();

-- ---------------------------------------------------------------------------
-- 4. Upgrade Student Fee Assignments (student_uuid FK + discount + due_date)
-- ---------------------------------------------------------------------------

ALTER TABLE public.student_fee_assignments
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS student_uuid uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.student_fee_assignments DISABLE TRIGGER trg_fee_assignments_ledger_context;

UPDATE public.student_fee_assignments
SET school_id = public.ledger_school_id()
WHERE school_id IS NULL;

UPDATE public.student_fee_assignments a
SET student_uuid = s.id
FROM public.students s
WHERE a.student_uuid IS NULL
  AND a.student_id = s.admission_number
  AND (a.school_id IS NULL OR a.school_id = s.school_id);

ALTER TABLE public.student_fee_assignments ENABLE TRIGGER trg_fee_assignments_ledger_context;

ALTER TABLE public.student_fee_assignments
  ALTER COLUMN school_id SET NOT NULL,
  ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.student_fee_assignments'::regclass AND conname = 'student_fee_assignments_discount_check'
  ) THEN
    ALTER TABLE public.student_fee_assignments
      ADD CONSTRAINT student_fee_assignments_discount_check CHECK (discount_amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fee_assignments_student_uuid_year
  ON public.student_fee_assignments(school_id, student_uuid, academic_year);

CREATE OR REPLACE FUNCTION public.sync_fee_assignment_student_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id uuid;
  v_adm text;
  v_school uuid;
BEGIN
  IF NEW.student_uuid IS NOT NULL THEN
    SELECT id, admission_number, school_id
    INTO v_student_id, v_adm, v_school
    FROM public.students
    WHERE id = NEW.student_uuid;

    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND: referenced student_uuid does not exist.';
    END IF;
    IF v_school <> NEW.school_id THEN
      RAISE EXCEPTION 'STUDENT_SCHOOL_MISMATCH: student belongs to another school.';
    END IF;
    NEW.student_id := v_adm;
  ELSIF NEW.student_id IS NOT NULL THEN
    SELECT id, school_id
    INTO v_student_id, v_school
    FROM public.students
    WHERE admission_number = NEW.student_id
      AND school_id = NEW.school_id
    LIMIT 1;

    IF v_student_id IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND: admission_number % not found in school.', NEW.student_id;
    END IF;
    NEW.student_uuid := v_student_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_fee_assignment_student ON public.student_fee_assignments;
CREATE TRIGGER trg_sync_fee_assignment_student
BEFORE INSERT OR UPDATE ON public.student_fee_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_fee_assignment_student_context();

-- ---------------------------------------------------------------------------
-- 5. Upgrade Fee Payments (UUID id, student_id FK, assignment FK, unique receipt)
-- ---------------------------------------------------------------------------

ALTER TABLE public.fee_payments
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fee_assignment_id integer REFERENCES public.student_fee_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fee_category_id integer REFERENCES public.categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS receipt_number text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id);

ALTER TABLE public.fee_payments DISABLE TRIGGER trg_fee_payments_ledger_context;

UPDATE public.fee_payments SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE public.fee_payments SET school_id = public.ledger_school_id() WHERE school_id IS NULL;

-- Backfill fee_payments metadata from students, transactions, categories & assignments
UPDATE public.fee_payments fp
SET student_id = s.id
FROM public.students s
WHERE fp.student_id IS NULL
  AND fp.student_admission_number = s.admission_number
  AND fp.school_id = s.school_id;

UPDATE public.fee_payments fp
SET amount = t.amount,
    payment_date = t.date,
    receipt_number = COALESCE(NULLIF(btrim(fp.receipt_number), ''), NULLIF(btrim(t.reference), '')),
    remarks = COALESCE(fp.remarks, t.particulars)
FROM public.transactions t
WHERE fp.transaction_id = t.id
  AND (fp.amount IS NULL OR fp.payment_date IS NULL OR fp.receipt_number IS NULL);

UPDATE public.fee_payments fp
SET fee_category_id = c.id
FROM public.categories c
WHERE fp.fee_category_id IS NULL
  AND lower(c.name) = lower(fp.fee_type)
  AND c.parent_id IS NOT NULL;

UPDATE public.fee_payments fp
SET fee_assignment_id = a.id
FROM public.student_fee_assignments a
WHERE fp.fee_assignment_id IS NULL
  AND fp.student_admission_number = a.student_id
  AND fp.academic_year = a.academic_year
  AND fp.fee_category_id = a.fee_category_id;

ALTER TABLE public.fee_payments ENABLE TRIGGER trg_fee_payments_ledger_context;

ALTER TABLE public.fee_payments ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.fee_payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.fee_payments ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.fee_payments ALTER COLUMN school_id SET DEFAULT public.ledger_school_id();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fee_payments'::regclass AND conname = 'uq_fee_payments_id'
  ) THEN
    ALTER TABLE public.fee_payments ADD CONSTRAINT uq_fee_payments_id UNIQUE (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fee_payments'::regclass AND conname = 'fee_payments_amount_check'
  ) THEN
    ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_amount_check CHECK (amount IS NULL OR amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fee_payments'::regclass AND conname = 'fee_payments_mode_check'
  ) THEN
    ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_mode_check
      CHECK (payment_mode IS NULL OR payment_mode IN ('cash', 'bank_transfer', 'cheque', 'upi', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fee_payments'::regclass AND conname = 'fee_payments_status_check'
  ) THEN
    ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_status_check
      CHECK (status IN ('completed', 'reversed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_payments_school_receipt
  ON public.fee_payments (school_id, lower(btrim(receipt_number)))
  WHERE receipt_number IS NOT NULL AND btrim(receipt_number) <> '' AND status = 'completed';

CREATE INDEX IF NOT EXISTS idx_fee_payments_student_id_year
  ON public.fee_payments(school_id, student_id, academic_year);

CREATE INDEX IF NOT EXISTS idx_fee_payments_assignment
  ON public.fee_payments(school_id, fee_assignment_id);

CREATE INDEX IF NOT EXISTS idx_fee_payments_date
  ON public.fee_payments(school_id, payment_date DESC);

-- ---------------------------------------------------------------------------
-- 6. Upgrade Transactions Table (Person-Indexed FKs + Payment Mode)
-- ---------------------------------------------------------------------------

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS faculty_id uuid REFERENCES public.faculty(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_mode text;

-- Ensure transactions.id sequence default exists
DO $$
DECLARE
  v_max_id integer;
BEGIN
  CREATE SEQUENCE IF NOT EXISTS public.transactions_id_seq;
  SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.transactions;
  PERFORM setval('public.transactions_id_seq', GREATEST(v_max_id, 1), true);
  ALTER TABLE public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq');
END $$;

-- Backfill student_id and faculty_id onto existing transactions
ALTER TABLE public.transactions DISABLE TRIGGER trg_transactions_ledger_context;

UPDATE public.transactions t
SET student_id = fp.student_id
FROM public.fee_payments fp
WHERE t.student_id IS NULL
  AND t.id = fp.transaction_id
  AND fp.student_id IS NOT NULL;

UPDATE public.transactions t
SET faculty_id = fep.faculty_id
FROM public.faculty_expense_payments fep
WHERE t.faculty_id IS NULL
  AND t.id = fep.transaction_id
  AND fep.faculty_id IS NOT NULL;

ALTER TABLE public.transactions ENABLE TRIGGER trg_transactions_ledger_context;

CREATE INDEX IF NOT EXISTS idx_transactions_student_id
  ON public.transactions(school_id, student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_faculty_id
  ON public.transactions(school_id, faculty_id)
  WHERE faculty_id IS NOT NULL;

-- Ensure activity_history & transactions have school_id/user_id columns defensively
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

ALTER TABLE public.transaction_revisions
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

ALTER TABLE public.activity_history
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- ---------------------------------------------------------------------------
-- 7. Seed Missing Faculty Expense Subcategories & Extend Faculty Payments
-- ---------------------------------------------------------------------------

ALTER TABLE public.faculty_expense_payments
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS salary_month text,
  ADD COLUMN IF NOT EXISTS particulars text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.faculty_expense_payments'::regclass AND conname = 'faculty_payments_status_check'
  ) THEN
    ALTER TABLE public.faculty_expense_payments
      ADD CONSTRAINT faculty_payments_status_check CHECK (status IN ('completed', 'reversed'));
  END IF;
END $$;

ALTER TABLE public.faculty_expense_categories DISABLE TRIGGER trg_set_faculty_category_context;

DO $$
DECLARE
  v_school uuid;
  v_parent uuid;
  v_name text;
BEGIN
  v_school := public.ledger_school_id();

  SELECT id INTO v_parent
  FROM public.faculty_expense_categories
  WHERE school_id = v_school
    AND parent_id IS NULL
    AND name = 'Faculty Expenses'
  LIMIT 1;

  IF v_parent IS NULL THEN
    INSERT INTO public.faculty_expense_categories (school_id, parent_id, name, is_active)
    VALUES (v_school, NULL, 'Faculty Expenses', true)
    ON CONFLICT (school_id, parent_id, name) DO UPDATE SET is_active = true
    RETURNING id INTO v_parent;
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'Salary',
    'Advance Salary',
    'Bonus',
    'Incentives',
    'Travel Expense',
    'Reimbursements',
    'Gifts / Goodies',
    'Training / Workshop Expenses',
    'Other Faculty Expenses'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.faculty_expense_categories
      WHERE school_id = v_school
        AND parent_id = v_parent
        AND lower(btrim(name)) = lower(btrim(v_name))
    ) THEN
      INSERT INTO public.faculty_expense_categories (school_id, parent_id, name, is_active)
      VALUES (v_school, v_parent, v_name, true);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.faculty_expense_categories ENABLE TRIGGER trg_set_faculty_category_context;

-- Enforce case-insensitive unique voucher numbers per school under concurrent writes
CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_payment_school_voucher_ci
  ON public.faculty_expense_payments(school_id, lower(btrim(voucher_number)));

-- Prevent hard deletion of categories still referenced by payments or assignments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.student_fee_assignments'::regclass
      AND conname = 'student_fee_assignments_fee_category_id_fkey'
  ) THEN
    ALTER TABLE public.student_fee_assignments
      DROP CONSTRAINT student_fee_assignments_fee_category_id_fkey;
    ALTER TABLE public.student_fee_assignments
      ADD CONSTRAINT student_fee_assignments_fee_category_id_fkey
      FOREIGN KEY (fee_category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Atomic RPC: record_student_fee_payment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_student_fee_payment(
  p_student_id uuid,
  p_academic_year text,
  p_fee_assignment_id integer DEFAULT NULL,
  p_fee_category_id integer DEFAULT NULL,
  p_fee_month text DEFAULT '',
  p_payment_date date DEFAULT CURRENT_DATE,
  p_amount numeric DEFAULT NULL,
  p_payment_mode text DEFAULT 'cash',
  p_receipt_number text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
  v_school_id uuid;
  v_student record;
  v_assign record;
  v_fee_type text;
  v_net_assigned numeric(14,2);
  v_already_paid numeric(14,2);
  v_prev_balance numeric(14,2);
  v_rem_balance numeric(14,2);
  v_normalized_mode text;
  v_receipt text;
  v_tx_id integer;
  v_payment_id uuid;
  v_particulars text;
  v_tx_json jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AUTH_REQUIRED: Please sign in to record fee payments.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'LEDGER_ACCESS_DENIED: Active Ledger access required.';
  END IF;

  IF NOT (public.is_ledger_accountant() OR public.is_ledger_admin()) THEN
    RAISE EXCEPTION 'LEDGER_PERMISSION_DENIED: Only authorized accountants or admins can record fee payments.';
  END IF;

  v_school_id := public.ledger_school_id();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Payment amount must be greater than zero.';
  END IF;

  v_receipt := btrim(COALESCE(p_receipt_number, ''));
  IF v_receipt = '' THEN
    RAISE EXCEPTION 'RECEIPT_REQUIRED: Receipt number is required.';
  END IF;

  IF p_academic_year IS NULL OR btrim(p_academic_year) = '' THEN
    RAISE EXCEPTION 'ACADEMIC_YEAR_REQUIRED: Academic year is required.';
  END IF;

  -- Check unique receipt number
  IF EXISTS (
    SELECT 1 FROM public.fee_payments
    WHERE school_id = v_school_id
      AND lower(btrim(receipt_number)) = lower(v_receipt)
      AND status = 'completed'
  ) OR EXISTS (
    SELECT 1 FROM public.transactions
    WHERE school_id = v_school_id
      AND is_deleted = false
      AND type = 'income'
      AND main_category = 'Fees'
      AND lower(btrim(COALESCE(reference, ''))) = lower(v_receipt)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_RECEIPT: Receipt number "%" already exists.', v_receipt;
  END IF;

  -- Lookup & validate student
  SELECT id, admission_number, name, class, section, status, school_id
  INTO v_student
  FROM public.students
  WHERE id = p_student_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: Selected student record does not exist.';
  END IF;

  IF v_student.school_id <> v_school_id THEN
    RAISE EXCEPTION 'STUDENT_SCHOOL_MISMATCH: Student belongs to a different school.';
  END IF;

  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'INACTIVE_STUDENT: Cannot collect fees for inactive student % (%).', v_student.name, v_student.admission_number;
  END IF;

  -- Resolve & lock assignment
  IF p_fee_assignment_id IS NOT NULL THEN
    SELECT *
    INTO v_assign
    FROM public.student_fee_assignments
    WHERE id = p_fee_assignment_id
      AND school_id = v_school_id
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_assign
    FROM public.student_fee_assignments
    WHERE school_id = v_school_id
      AND (student_uuid = p_student_id OR student_id = v_student.admission_number)
      AND academic_year = p_academic_year
      AND fee_category_id = p_fee_category_id
    FOR UPDATE;
  END IF;

  IF v_assign.id IS NULL THEN
    RAISE EXCEPTION 'FEE_ASSIGNMENT_NOT_FOUND: Student has no fee assignment for the selected fee head and academic year.';
  END IF;

  IF (v_assign.student_uuid IS NOT NULL AND v_assign.student_uuid <> p_student_id)
     OR (v_assign.student_uuid IS NULL AND v_assign.student_id <> v_student.admission_number) THEN
    RAISE EXCEPTION 'FEE_ASSIGNMENT_MISMATCH: Fee assignment does not belong to selected student.';
  END IF;

  SELECT name INTO v_fee_type
  FROM public.categories
  WHERE id = v_assign.fee_category_id;

  IF v_fee_type IS NULL THEN
    RAISE EXCEPTION 'FEE_CATEGORY_NOT_FOUND: Fee category does not exist.';
  END IF;

  v_net_assigned := GREATEST(0, COALESCE(v_assign.assigned_amount, 0) - COALESCE(v_assign.discount_amount, 0));

  SELECT COALESCE(SUM(fp.amount), 0)
  INTO v_already_paid
  FROM public.fee_payments fp
  JOIN public.transactions t ON t.id = fp.transaction_id
  WHERE fp.school_id = v_school_id
    AND (fp.fee_assignment_id = v_assign.id OR (
      fp.student_admission_number = v_student.admission_number
      AND fp.academic_year = v_assign.academic_year
      AND fp.fee_category_id = v_assign.fee_category_id
    ))
    AND fp.status = 'completed'
    AND t.is_deleted = false;

  v_prev_balance := GREATEST(0, v_net_assigned - v_already_paid);

  IF p_amount > v_prev_balance THEN
    RAISE EXCEPTION 'OVERPAYMENT_REJECTED: Payment ₹% exceeds outstanding balance ₹% for %.', p_amount, v_prev_balance, v_fee_type;
  END IF;

  v_rem_balance := v_prev_balance - p_amount;

  -- Normalize payment mode
  v_normalized_mode := lower(trim(COALESCE(p_payment_mode, 'cash')));
  IF v_normalized_mode IN ('bank', 'bank_transfer', 'bank transfer', 'neft', 'rtgs', 'imps') THEN
    v_normalized_mode := 'bank_transfer';
  ELSIF v_normalized_mode IN ('cheque', 'check') THEN
    v_normalized_mode := 'cheque';
  ELSIF v_normalized_mode IN ('upi', 'qr') THEN
    v_normalized_mode := 'upi';
  ELSIF v_normalized_mode = 'cash' THEN
    v_normalized_mode := 'cash';
  ELSE
    v_normalized_mode := 'other';
  END IF;

  SELECT u.email, COALESCE(up.full_name, u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  LEFT JOIN public.user_profiles up ON up.email = u.email
  WHERE u.id = v_user_id;

  v_user_email := COALESCE(v_user_email, v_user_id::text);
  v_user_name := COALESCE(v_user_name, v_user_email);

  v_particulars := v_fee_type || ' Fee - ' || v_student.name || ' (' || v_student.admission_number || ')';
  IF COALESCE(btrim(p_fee_month), '') <> '' THEN
    v_particulars := v_particulars || ' [' || btrim(p_fee_month) || ']';
  END IF;
  IF COALESCE(btrim(p_remarks), '') <> '' THEN
    v_particulars := v_particulars || ' - ' || btrim(p_remarks);
  END IF;

  SELECT COALESCE(
    CASE
      WHEN pg_get_serial_sequence('public.transactions', 'id') IS NOT NULL
      THEN nextval(pg_get_serial_sequence('public.transactions', 'id'))
      ELSE (SELECT COALESCE(MAX(id), 0) + 1 FROM public.transactions)
    END,
    1
  ) INTO v_tx_id;

  INSERT INTO public.transactions (
    id, school_id, type, date, reference, particulars, amount, head,
    main_category, sub_category, tags, bank_amount, cheque_count,
    student_id, payment_mode, user_id, created_by, updated_by, is_deleted
  ) VALUES (
    v_tx_id,
    v_school_id,
    'income',
    COALESCE(p_payment_date, CURRENT_DATE),
    v_receipt,
    v_particulars,
    p_amount,
    'Fees',
    'Fees',
    v_fee_type,
    ARRAY[v_normalized_mode],
    CASE WHEN v_normalized_mode IN ('bank_transfer', 'upi', 'cheque') THEN p_amount ELSE 0 END,
    CASE WHEN v_normalized_mode = 'cheque' THEN 1 ELSE 0 END,
    p_student_id,
    v_normalized_mode,
    v_user_id,
    v_user_email,
    v_user_email,
    false
  );

  INSERT INTO public.fee_payments (
    id, transaction_id, school_id, student_id, student_admission_number,
    fee_assignment_id, fee_category_id, academic_year, fee_month, fee_type,
    amount, payment_date, payment_mode, receipt_number, reference_number,
    remarks, status, created_by, updated_by
  ) VALUES (
    gen_random_uuid(),
    v_tx_id,
    v_school_id,
    p_student_id,
    v_student.admission_number,
    v_assign.id,
    v_assign.fee_category_id,
    v_assign.academic_year,
    COALESCE(btrim(p_fee_month), ''),
    v_fee_type,
    p_amount,
    COALESCE(p_payment_date, CURRENT_DATE),
    v_normalized_mode,
    v_receipt,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    NULLIF(btrim(COALESCE(p_remarks, '')), ''),
    'completed',
    v_user_id,
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  v_tx_json := jsonb_build_object(
    'id', v_tx_id,
    'type', 'income',
    'date', COALESCE(p_payment_date, CURRENT_DATE),
    'reference', v_receipt,
    'particulars', v_particulars,
    'amount', p_amount,
    'mainCategory', 'Fees',
    'subCategory', v_fee_type,
    'paymentMode', v_normalized_mode,
    'studentId', p_student_id,
    'admissionNumber', v_student.admission_number
  );

  INSERT INTO public.transaction_revisions (
    id, school_id, transaction_id, action, old_values, new_values, user_id, created_by
  ) VALUES (
    gen_random_uuid(), v_school_id, v_tx_id, 'CREATE', NULL, v_tx_json, v_user_id, v_user_email
  );

  INSERT INTO public.activity_history (
    id, school_id, date, time, user_name, user_email, user_id, auth_user_id,
    activity_type, transaction_id, description, device_status, sync_status
  ) VALUES (
    gen_random_uuid(),
    v_school_id,
    COALESCE(p_payment_date, CURRENT_DATE),
    to_char(clock_timestamp(), 'HH12:MI:SS AM'),
    v_user_name,
    v_user_email,
    v_user_id,
    v_user_id,
    'Collect Student Fee',
    v_tx_id,
    'Collected ₹' || p_amount::text || ' (' || v_fee_type || ') from ' || v_student.name || ' [' || v_student.admission_number || '], Receipt #' || v_receipt,
    'Online',
    'synced'
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'transaction_id', v_tx_id,
    'student_id', p_student_id,
    'admission_number', v_student.admission_number,
    'fee_assignment_id', v_assign.id,
    'fee_category_id', v_assign.fee_category_id,
    'fee_type', v_fee_type,
    'academic_year', v_assign.academic_year,
    'fee_month', COALESCE(btrim(p_fee_month), ''),
    'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
    'amount', p_amount,
    'payment_mode', v_normalized_mode,
    'receipt_number', v_receipt,
    'reference_number', NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    'remarks', NULLIF(btrim(COALESCE(p_remarks, '')), ''),
    'previous_balance', v_prev_balance,
    'remaining_balance', v_rem_balance,
    'created_by', v_user_email
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_student_fee_payment(uuid, text, integer, integer, text, date, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_student_fee_payment(uuid, text, integer, integer, text, date, numeric, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Atomic RPC: record_faculty_expense & Unified pay_faculty_salary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_faculty_expense(
  p_faculty_id uuid,
  p_expense_category_id uuid,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_voucher_number text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_payment_mode text DEFAULT 'cash',
  p_reference_number text DEFAULT NULL,
  p_salary_month text DEFAULT NULL,
  p_particulars text DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
  v_school_id uuid;
  v_faculty record;
  v_cat record;
  v_voucher text;
  v_normalized_mode text;
  v_tx_id integer;
  v_payment_id uuid;
  v_tx_particulars text;
  v_tx_json jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AUTH_REQUIRED: Please sign in to record faculty expenses.';
  END IF;

  IF NOT public.has_ledger_access() THEN
    RAISE EXCEPTION 'LEDGER_ACCESS_DENIED: Active Ledger access required.';
  END IF;

  IF NOT (public.is_ledger_accountant() OR public.is_ledger_admin()) THEN
    RAISE EXCEPTION 'LEDGER_PERMISSION_DENIED: Insufficient permissions to record faculty expenses.';
  END IF;

  v_school_id := public.ledger_school_id();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expense amount must be greater than zero.';
  END IF;

  v_voucher := btrim(COALESCE(p_voucher_number, ''));
  IF v_voucher = '' THEN
    RAISE EXCEPTION 'VOUCHER_REQUIRED: Voucher number is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.faculty_expense_payments
    WHERE school_id = v_school_id
      AND lower(btrim(voucher_number)) = lower(v_voucher)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_VOUCHER: Voucher number "%" already exists.', v_voucher;
  END IF;

  SELECT id, employee_id, faculty_name, department, designation, status, school_id
  INTO v_faculty
  FROM public.faculty
  WHERE id = p_faculty_id;

  IF v_faculty.id IS NULL THEN
    RAISE EXCEPTION 'FACULTY_NOT_FOUND: Selected faculty member does not exist.';
  END IF;

  IF v_faculty.school_id <> v_school_id THEN
    RAISE EXCEPTION 'FACULTY_SCHOOL_MISMATCH: Faculty belongs to another school.';
  END IF;

  IF v_faculty.status <> 'active' THEN
    RAISE EXCEPTION 'INACTIVE_FACULTY: Cannot record expense for inactive faculty member % (%).', v_faculty.faculty_name, v_faculty.employee_id;
  END IF;

  SELECT id, name, is_active, school_id
  INTO v_cat
  FROM public.faculty_expense_categories
  WHERE id = p_expense_category_id;

  IF v_cat.id IS NULL OR v_cat.is_active = false THEN
    RAISE EXCEPTION 'FACULTY_EXPENSE_CATEGORY_NOT_FOUND: Active faculty expense category is required.';
  END IF;

  IF v_cat.school_id <> v_school_id THEN
    RAISE EXCEPTION 'FACULTY_CATEGORY_SCHOOL_MISMATCH: Expense category belongs to another school.';
  END IF;

  v_normalized_mode := lower(trim(COALESCE(p_payment_mode, 'cash')));
  IF v_normalized_mode IN ('bank', 'bank_transfer', 'bank transfer', 'neft', 'rtgs', 'imps') THEN
    v_normalized_mode := 'bank_transfer';
  ELSIF v_normalized_mode IN ('cheque', 'check') THEN
    v_normalized_mode := 'cheque';
  ELSIF v_normalized_mode IN ('upi', 'qr') THEN
    v_normalized_mode := 'upi';
  ELSIF v_normalized_mode = 'cash' THEN
    v_normalized_mode := 'cash';
  ELSE
    v_normalized_mode := 'other';
  END IF;

  SELECT u.email, COALESCE(up.full_name, u.email)
  INTO v_user_email, v_user_name
  FROM public.users u
  LEFT JOIN public.user_profiles up ON up.email = u.email
  WHERE u.id = v_user_id;

  v_user_email := COALESCE(v_user_email, v_user_id::text);
  v_user_name := COALESCE(v_user_name, v_user_email);

  v_tx_particulars := COALESCE(NULLIF(btrim(p_particulars), ''), NULLIF(btrim(p_remarks), ''), v_cat.name || ' - ' || v_faculty.faculty_name || ' (' || v_faculty.employee_id || ')');

  SELECT COALESCE(
    CASE
      WHEN pg_get_serial_sequence('public.transactions', 'id') IS NOT NULL
      THEN nextval(pg_get_serial_sequence('public.transactions', 'id'))
      ELSE (SELECT COALESCE(MAX(id), 0) + 1 FROM public.transactions)
    END,
    1
  ) INTO v_tx_id;

  INSERT INTO public.transactions (
    id, school_id, type, date, reference, particulars, amount, head,
    main_category, sub_category, tags, bank_amount, cheque_count,
    faculty_id, payment_mode, user_id, created_by, updated_by, is_deleted
  ) VALUES (
    v_tx_id,
    v_school_id,
    'expense',
    COALESCE(p_payment_date, CURRENT_DATE),
    v_voucher,
    v_tx_particulars,
    p_amount,
    'Expenses',
    'Faculty Expenses',
    v_cat.name,
    ARRAY[v_normalized_mode],
    CASE WHEN v_normalized_mode IN ('bank_transfer', 'upi', 'cheque') THEN p_amount ELSE 0 END,
    CASE WHEN v_normalized_mode = 'cheque' THEN 1 ELSE 0 END,
    p_faculty_id,
    v_normalized_mode,
    v_user_id,
    v_user_email,
    v_user_email,
    false
  );

  INSERT INTO public.faculty_expense_payments (
    school_id, faculty_id, expense_category_id, transaction_id,
    payment_date, voucher_number, amount, payment_mode,
    reference_number, salary_month, particulars, remarks,
    status, created_by, updated_by
  ) VALUES (
    v_school_id,
    p_faculty_id,
    p_expense_category_id,
    v_tx_id,
    COALESCE(p_payment_date, CURRENT_DATE),
    v_voucher,
    p_amount,
    v_normalized_mode,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    NULLIF(btrim(COALESCE(p_salary_month, '')), ''),
    NULLIF(btrim(COALESCE(p_particulars, '')), ''),
    NULLIF(btrim(COALESCE(p_remarks, '')), ''),
    'completed',
    v_user_id,
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  v_tx_json := jsonb_build_object(
    'id', v_tx_id,
    'type', 'expense',
    'date', COALESCE(p_payment_date, CURRENT_DATE),
    'reference', v_voucher,
    'particulars', v_tx_particulars,
    'amount', p_amount,
    'mainCategory', 'Faculty Expenses',
    'subCategory', v_cat.name,
    'paymentMode', v_normalized_mode,
    'facultyId', p_faculty_id,
    'employeeId', v_faculty.employee_id
  );

  INSERT INTO public.transaction_revisions (
    id, school_id, transaction_id, action, old_values, new_values, user_id, created_by
  ) VALUES (
    gen_random_uuid(), v_school_id, v_tx_id, 'CREATE', NULL, v_tx_json, v_user_id, v_user_email
  );

  INSERT INTO public.activity_history (
    id, school_id, date, time, user_name, user_email, user_id, auth_user_id,
    activity_type, transaction_id, description, device_status, sync_status
  ) VALUES (
    gen_random_uuid(),
    v_school_id,
    COALESCE(p_payment_date, CURRENT_DATE),
    to_char(clock_timestamp(), 'HH12:MI:SS AM'),
    v_user_name,
    v_user_email,
    v_user_id,
    v_user_id,
    'Faculty Expense',
    v_tx_id,
    'Recorded ₹' || p_amount::text || ' (' || v_cat.name || ') for ' || v_faculty.faculty_name || ' [' || v_faculty.employee_id || '], Voucher #' || v_voucher,
    'Online',
    'synced'
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'transaction_id', v_tx_id,
    'faculty_id', p_faculty_id,
    'employee_id', v_faculty.employee_id,
    'faculty_name', v_faculty.faculty_name,
    'department', v_faculty.department,
    'designation', v_faculty.designation,
    'expense_category_id', p_expense_category_id,
    'expense_category', v_cat.name,
    'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
    'amount', p_amount,
    'payment_mode', v_normalized_mode,
    'voucher_number', v_voucher,
    'reference_number', NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    'salary_month', NULLIF(btrim(COALESCE(p_salary_month, '')), ''),
    'particulars', v_tx_particulars,
    'remarks', NULLIF(btrim(COALESCE(p_remarks, '')), ''),
    'created_by', v_user_email
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_faculty_expense(uuid, uuid, date, text, numeric, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_faculty_expense(uuid, uuid, date, text, numeric, text, text, text, text, text) TO authenticated;

-- Update pay_faculty_salary to delegate to record_faculty_expense for complete validation + audit integrity
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
  v_res jsonb;
BEGIN
  v_res := public.record_faculty_expense(
    p_faculty_id => p_faculty_id,
    p_expense_category_id => p_expense_category_id,
    p_payment_date => p_payment_date,
    p_voucher_number => p_voucher_number,
    p_amount => p_amount,
    p_payment_mode => p_payment_mode,
    p_reference_number => NULL,
    p_salary_month => NULL,
    p_particulars => COALESCE(p_remarks, p_transaction_sub_category),
    p_remarks => p_remarks
  );
  RETURN (v_res->>'payment_id')::uuid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pay_faculty_salary(uuid, uuid, date, text, numeric, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_faculty_salary(uuid, uuid, date, text, numeric, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Re-assert Strict Authenticated-Only RLS & Revoke Anon/Public
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'students',
    'student_fee_assignments',
    'fee_structures',
    'fee_payments',
    'transactions',
    'transaction_revisions',
    'categories',
    'tags',
    'activity_history',
    'user_profiles',
    'faculty',
    'faculty_expense_categories',
    'faculty_expense_payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC;', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- Ensure students & fee tables have strict authenticated policies
DROP POLICY IF EXISTS ledger_students_select ON public.students;
DROP POLICY IF EXISTS ledger_students_insert ON public.students;
DROP POLICY IF EXISTS ledger_students_update ON public.students;
DROP POLICY IF EXISTS ledger_students_delete ON public.students;
CREATE POLICY ledger_students_select ON public.students FOR SELECT TO authenticated
  USING (public.has_ledger_access() AND school_id = public.ledger_school_id());
CREATE POLICY ledger_students_insert ON public.students FOR INSERT TO authenticated
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());
CREATE POLICY ledger_students_update ON public.students FOR UPDATE TO authenticated
  USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());
CREATE POLICY ledger_students_delete ON public.students FOR DELETE TO authenticated
  USING (public.is_ledger_admin() AND school_id = public.ledger_school_id());

DROP POLICY IF EXISTS ledger_fee_payments_select ON public.fee_payments;
DROP POLICY IF EXISTS ledger_fee_payments_insert ON public.fee_payments;
DROP POLICY IF EXISTS ledger_fee_payments_update ON public.fee_payments;
CREATE POLICY ledger_fee_payments_select ON public.fee_payments FOR SELECT TO authenticated
  USING (public.is_ledger_reader() AND school_id = public.ledger_school_id());
CREATE POLICY ledger_fee_payments_insert ON public.fee_payments FOR INSERT TO authenticated
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());
CREATE POLICY ledger_fee_payments_update ON public.fee_payments FOR UPDATE TO authenticated
  USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

DROP POLICY IF EXISTS ledger_fee_assignments_select ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_insert ON public.student_fee_assignments;
DROP POLICY IF EXISTS ledger_fee_assignments_update ON public.student_fee_assignments;
CREATE POLICY ledger_fee_assignments_select ON public.student_fee_assignments FOR SELECT TO authenticated
  USING (public.is_ledger_reader() AND school_id = public.ledger_school_id());
CREATE POLICY ledger_fee_assignments_insert ON public.student_fee_assignments FOR INSERT TO authenticated
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());
CREATE POLICY ledger_fee_assignments_update ON public.student_fee_assignments FOR UPDATE TO authenticated
  USING ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id())
  WITH CHECK ((public.is_ledger_accountant() OR public.is_ledger_admin()) AND school_id = public.ledger_school_id());

-- Ensure faculty_salary_register view appends new columns cleanly without breaking column order
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
  p.created_at,
  p.transaction_id,
  p.faculty_id,
  p.reference_number,
  p.salary_month,
  p.particulars,
  p.status
FROM public.faculty_expense_payments p
JOIN public.faculty f
  ON f.id = p.faculty_id
JOIN public.faculty_expense_categories c
  ON c.id = p.expense_category_id
WHERE p.status = 'completed';

GRANT SELECT ON public.faculty_salary_register TO authenticated;
GRANT SELECT ON public.faculty_monthly_salary_report TO authenticated;
GRANT SELECT ON public.faculty_department_expense_report TO authenticated;
GRANT SELECT ON public.faculty_dashboard_summary TO authenticated;

-- Salary-only summary view (excludes Travel, Gifts, Reimbursements, Advance Salary, etc.)
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
WHERE lower(btrim(c.name)) = 'salary'
  AND p.status = 'completed'
GROUP BY
  p.school_id,
  date_trunc('month', p.payment_date)::date;

COMMIT;

SELECT 'MIGRATION 09 COMPLETE: Student-indexed fee payments & faculty-indexed expenses schema, RPCs, and strict RLS active.' AS result;
