# Live Supabase Deployment & End-to-End Verification Report

**Project**: Pragament School Accountant — Income & Expense Ledger  
**Branch**: `feature/merge`  
**Date**: 2026-11-25

---

## 1. Target Supabase Project Identification & Access Scope

- **Configured Supabase URL**: `https://ndajyhculegzhxqwythx.supabase.co` (referenced in `.env` and `config/schools.v1.json` for `DPSS` and `GHS`).
- **Credentials Present in Workspace**: `.env` contains `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TABLE`, `SUPABASE_BUCKET`. No `SERVICE_ROLE_KEY`, DB connection string, Supabase CLI session, or authenticated test user JWTs/passwords exist in the workspace.
- **Isolated Test Project Status**: No separate isolated test Supabase project is configured in the workspace. To protect live school data, **no test writes were executed against `ndajyhculegzhxqwythx.supabase.co`**.

---

## 2. Deployment Status for Migrations 08 & 09

| Migration | Status on `ndajyhculegzhxqwythx.supabase.co` | Evidence |
| :--- | :---: | :--- |
| `08_fix_student_import_and_fee_assignments_rls.sql` | **DEPLOYED** | Live unauthenticated REST `GET` on `students`, `student_fee_assignments`, `fee_structures`, and `fee_payments` changed from `200 []` (pre-deploy) to `401` (post-deploy). |
| `09_student_fee_faculty_expense_indexing.sql` | **DEPLOYED (Patch Pending Re-run)** | Live unauthenticated REST `POST /rest/v1/rpc/...` for `record_student_fee_payment`, `record_faculty_expense`, and `pay_faculty_salary` all return `401` (`42501: permission denied for function`). Two post-audit hardening fixes were added locally to `09` and should be re-applied in SQL Editor. |

---

## 3. Migration Safety & Atomic Operations Audit

### 3.1 Migration Safety Review (`08` & `09`)
- **Destructive Operations / Data Loss**: None. Uses `ADD COLUMN IF NOT EXISTS`, `ON DELETE RESTRICT` on financial FKs, and additive backfills (`WHERE ... IS NULL`).
- **Authorization Helpers (`09` lines 37–156)**: Removes `OR TRUE` bypasses in `has_ledger_access()` and `is_ledger_accountant()`. All helpers are `SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`, and explicitly `REVOKE ... FROM PUBLIC, anon` / `GRANT ... TO authenticated`. Legitimate users with active `app_access` (`app_name = 'ledger'`, `is_active = true`) retain access; `teacher`-only (`diary`), inactive, anon, and cross-school users are blocked.
- **Idempotency & SQL Editor Compatibility**:
  - `DISABLE/ENABLE TRIGGER` brackets backfill `UPDATE` statements on `student_fee_assignments`, `fee_payments`, `transactions`, and `faculty_expense_categories`, and `DROP TRIGGER IF EXISTS trg_students_ledger_context` precedes `students` backfill before recreating the trigger.
  - All constraints, indexes, and policies use `IF NOT EXISTS` or `DROP ... IF EXISTS`.
- **Rollback Feasibility**: Additive columns/indexes/RPCs are non-breaking; rollback only requires restoring prior function/policy definitions if needed, without data loss.

### 3.2 Atomic Financial Operations Review
- **`record_student_fee_payment`**:
  - Locks `student_fee_assignments` row with `FOR UPDATE` (prevents concurrent payments on the same assignment from racing past `v_prev_balance`).
  - Validates `auth.uid()`, `has_ledger_access()`, `is_ledger_accountant() OR is_ledger_admin()`, active student status, positive amount, non-empty unique receipt (`uq_fee_payments_school_receipt` partial unique index), and `p_amount <= v_prev_balance`.
  - Atomically inserts `transactions`, `fee_payments`, `transaction_revisions`, and `activity_history` in one PL/pgSQL transaction.
- **`record_faculty_expense` & `pay_faculty_salary`**:
  - `pay_faculty_salary` delegates directly to `record_faculty_expense`.
  - Validates `auth.uid()`, role, active faculty, active `faculty_expense_categories`, positive amount, and unique voucher number.
  - Atomically inserts `transactions`, `faculty_expense_payments`, `transaction_revisions`, and `activity_history`.

---

## 4. Bugs Found & Fixed During Audit

1. **SQL Editor Backfill Trigger Failure (`LEDGER_AUTH_REQUIRED`)** — *Fixed*:
   - **Root Cause**: Backfill `UPDATE` statements in `09` fired `set_ledger_context()` triggers when existing rows were present while `auth.uid()` was `NULL` in Supabase SQL Editor.
   - **Fix**: Bracketed backfill `UPDATE`s in `09` with `DISABLE/ENABLE TRIGGER` (and `DROP TRIGGER IF EXISTS` before `students` backfill).
2. **NULL-Boolean Assignment Mismatch Trap in `record_student_fee_payment`** — *Fixed in local `09`*:
   - **Root Cause**: Line 725 used `IF v_assign.student_id <> v_student.admission_number AND v_assign.student_uuid <> p_student_id`, which evaluates to `NULL` (skipped) if `v_assign.student_uuid IS NULL` and `p_fee_assignment_id` belongs to another student.
   - **Fix**: Replaced with explicit NULL-safe check `(v_assign.student_uuid IS NOT NULL AND v_assign.student_uuid <> p_student_id) OR (v_assign.student_uuid IS NULL AND v_assign.student_id <> v_student.admission_number)`.
3. **Case-Insensitive Concurrent Voucher Constraint** — *Fixed in local `09`*:
   - **Root Cause**: `05` enforced case-sensitive `uq_faculty_payment_school_voucher(school_id, voucher_number)`, whereas `record_faculty_expense` checked `lower(btrim(voucher_number))`.
   - **Fix**: Added `uq_faculty_payment_school_voucher_ci` on `(school_id, lower(btrim(voucher_number)))`.

---

## 5. Verification Results by Environment

### 5.1 Live Anonymous Supabase API Tests — **PASS**
Executed unauthenticated HTTP REST checks against `https://ndajyhculegzhxqwythx.supabase.co`:
- All 14 tables (`students`, `student_fee_assignments`, `fee_structures`, `fee_payments`, `transactions`, `transaction_revisions`, `categories`, `tags`, `activity_history`, `user_profiles`, `faculty`, `faculty_expense_categories`, `faculty_expense_payments`, `app_access`): **HTTP `401`** (`PASS`).
- All 3 RPCs (`record_student_fee_payment`, `record_faculty_expense`, `pay_faculty_salary`): **HTTP `401` (`42501`: permission denied for function)** (`PASS`).

### 5.2 PGlite PostgreSQL Simulation — **PASS**
`node test_student_fee_faculty_expense_pglite.mjs` (re-run after audit fixes):
- Migrations `02, 05, 06, 07, 08, 09` + idempotent re-run: **PASS**.
- All 9 faculty expense subcategories seeded without duplicates: **PASS**.
- Student UUID & assignment linkage: **PASS**.
- Student fee payment RPC validations, atomic audit/revision, overpayment/zero/duplicate/inactive blocks: **PASS**.
- Faculty expense RPC, duplicate voucher, inactive faculty, Salary-only report view separation: **PASS**.
- Simulated RLS blocking `anon`, `teacher`-only, inactive user, cross-school, and identity spoofing: **PASS**.

### 5.3 Frontend & DataService Unit Tests — **PASS**
`node test_workflows_unit.mjs` (re-run after audit fixes):
- `dataService.js` RPC normalization & explicit DB error propagation (no fake success): **PASS**.
- Fee dues discount math, overdue flagging, soft-delete exclusion & zero double-counting: **PASS**.
- Receipt rendering, balance summary, `REPRINT` tag & deleted transaction guard: **PASS**.
- Faculty Salary-only dashboard metrics & report separation (Travel/Advance excluded from Salary): **PASS**.
- Fee Reports (`defaulters`, `partial-payments`, `student-history`): **PASS**.

### 5.4 Live Authenticated RLS, Financial Reconciliation & Browser E2E Tests — **BLOCKED**

| Area | Status | Reason |
| :--- | :---: | :--- |
| Live Authenticated RLS (Accountant, Principal, Teacher-only, Inactive, Cross-school, Spoofing) | **BLOCKED** | No isolated test Supabase project or test user JWTs/credentials available in workspace. |
| Live Student Fee Payment & Concurrency E2E | **BLOCKED** | Cannot execute test financial writes against `ndajyhculegzhxqwythx.supabase.co` without isolated test project/test accounts. |
| Live Faculty Expense & Reconciliation E2E | **BLOCKED** | Same as above. |
| Browser End-to-End UI Tests (Student & Faculty flows) | **BLOCKED** | Requires live authenticated session on an isolated Supabase test project. |

---

## 6. Remaining Blockers & Production Deployment Recommendation

- **Recommendation**: **CONDITIONAL GO (Complete Staging Verification First)**
  1. Re-run the updated [09_student_fee_faculty_expense_indexing.sql](file:///c:/Users/prana/Projects/pragamant/Supabase_merge/html_daily_transaction_ledger/09_student_fee_faculty_expense_indexing.sql) in Supabase SQL Editor so the `student_uuid IS NULL` mismatch guard and `uq_faculty_payment_school_voucher_ci` index are active on the target DB.
  2. Provision an isolated test/staging Supabase project (or dedicated test school + test accounts for `accountant`, `principal`, `teacher`, and inactive user) and execute the Section 5, 6, 7, and 8 test flows end-to-end before production cutover.
  3. Confirm active `app_access` rows (`app_name = 'ledger'`, `is_active = true`) exist for all legitimate accountants/principals before deploying the frontend bundle.
