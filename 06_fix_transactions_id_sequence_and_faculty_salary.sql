-- =============================================================================
-- PRAGAMENT LEDGER: FIX TRANSACTIONS ID SEQUENCE AND FACULTY SALARY DISBURSEMENT
-- Migration: 06_fix_transactions_id_sequence_and_faculty_salary.sql
-- =============================================================================
--
-- PURPOSE:
--   1. Ensures public.transactions has an auto-incrementing sequence (transactions_id_seq)
--      set as its column default so that inserts omitting 'id' never trigger
--      "null value in column 'id' of relation 'transactions' violates not-null constraint" (error 23502).
--   2. Updates public.pay_faculty_salary to:
--      a) Explicitly and safely determine the next transaction ID (compatible with or without sequence).
--      b) Normalize payment_mode to comply with check constraint:
--         ('cash', 'bank_transfer', 'cheque', 'upi', 'other')
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create and attach transactions_id_seq to public.transactions(id)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_max_id integer;
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'transactions' 
      AND column_name = 'id'
  ) THEN
    -- Create sequence if it does not already exist
    CREATE SEQUENCE IF NOT EXISTS public.transactions_id_seq;

    -- Synchronize sequence with current maximum transaction ID
    SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.transactions;
    PERFORM setval('public.transactions_id_seq', GREATEST(v_max_id, 1), true);

    -- Set sequence as column default if not already configured
    ALTER TABLE public.transactions 
      ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq');

    -- Attempt to set sequence ownership
    BEGIN
      ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;
    EXCEPTION WHEN OTHERS THEN
      -- In case sequence ownership cannot be set, ignore and proceed
      NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Update pay_faculty_salary RPC with robust id generation & mode normalization
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
  v_normalized_mode text;
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

  -- Normalize payment mode to match check constraint:
  -- ('cash', 'bank_transfer', 'cheque', 'upi', 'other')
  v_normalized_mode := lower(trim(COALESCE(p_payment_mode, 'cash')));
  IF v_normalized_mode IN ('bank', 'bank_transfer', 'bank transfer', 'neft', 'rtgs', 'imps') THEN
    v_normalized_mode := 'bank_transfer';
  ELSIF v_normalized_mode IN ('cheque', 'check') THEN
    v_normalized_mode := 'cheque';
  ELSIF v_normalized_mode IN ('upi', 'qr') THEN
    v_normalized_mode := 'upi';
  ELSIF v_normalized_mode IN ('cash') THEN
    v_normalized_mode := 'cash';
  ELSE
    v_normalized_mode := 'other';
  END IF;

  -- 2. Determine next transaction id safely
  -- Tries sequence first if assigned, else falls back to MAX(id) + 1
  SELECT COALESCE(
    CASE 
      WHEN pg_get_serial_sequence('public.transactions', 'id') IS NOT NULL 
      THEN nextval(pg_get_serial_sequence('public.transactions', 'id'))
      ELSE (SELECT COALESCE(MAX(id), 0) + 1 FROM public.transactions)
    END,
    1
  ) INTO v_transaction_id;

  -- 3. Insert into transactions table
  INSERT INTO public.transactions (
    id,
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
    v_transaction_id,
    v_school_id,
    'expense',
    p_payment_date,
    p_voucher_number,
    COALESCE(p_remarks, 'Faculty Salary Payment'),
    p_amount,
    COALESCE(p_transaction_head, 'Expenses'),
    COALESCE(p_transaction_main_category, 'Faculty Expenses'),
    COALESCE(p_transaction_sub_category, 'Salary'),
    v_user_id,
    v_user_id::text
  );

  -- 4. Insert into faculty_expense_payments
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
    v_normalized_mode,
    p_remarks,
    v_user_id,
    v_user_id
  ) RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_faculty_salary TO authenticated;

COMMIT;

SELECT 'SUCCESS: transactions_id_seq created/attached and pay_faculty_salary updated.' AS result;
