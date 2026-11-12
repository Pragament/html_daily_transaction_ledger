# Supabase schema reference

Derived from `app.js`, `dataService.js`, `faculty.js`, and the checked-in SQL migrations. This is a source-code reference, not an introspection of the deployed database. All application tables below use the `public` schema unless qualified otherwise.

## Sources and migration dependencies

| File | Purpose |
| --- | --- |
| `migrations.sql` | Legacy ledger, categories, tags, students, audit logs, profiles, and receipt storage |
| `migrations_fees.sql` | Fee structures, payments, assignments, and category frequency |
| `01_phase3_ledger_preflight_single_school.sql` | Checks prerequisites in the existing shared database |
| `02_phase3_ledger_migration_single_school.sql` | School ownership, role helpers, integrity constraints, triggers, and authenticated RLS |
| `03_phase3_ledger_rollback_single_school.sql` | Rollback; not a forward setup step |
| `04_phase3_ledger_pglite_regression_single_school.sql` | Regression checks; not an application migration |
| `05_faculty_directory_salary_expenses.sql` | Faculty directory, expense payments, reports, and salary RPC |
| `roles_query.sql` | Examples of shared user and Ledger access provisioning |

The legacy scripts describe the original application schema. Phase 3 assumes an existing shared database containing `schools`, `users`, and `app_access`, and requires exactly one school. Its prerequisites are not fully created by these application migrations. For an existing deployment, inspect its schema and run the preflight before applying Phase 3, then apply the faculty migration. Do not run `mock_schema.sql` in Supabase: it replaces auth helpers and contains test data and deliberately simplified legacy tables.

## Shared identity and access prerequisites

These are only the columns referenced by this repository; their complete production DDL is not supplied here.

| Object | Required referenced columns | Usage |
| --- | --- | --- |
| `auth.users` | `id`, `email` | Supabase authentication identity |
| `public.schools` | `id` (UUID) | Exactly one school for the Phase 3 model |
| `public.users` | `id` (UUID), `email`, `school_id` | Shared user record; role provisioning copies the auth user ID |
| `public.app_access` | `user_id`, `school_id`, `app_name`, `app_role`, `is_active`, `updated_at` | Active access where `app_name = 'ledger'`; provisioning expects uniqueness on `(user_id, school_id, app_name)` |

## Application tables

The following SQL blocks reproduce the table definitions from the repository. Later alterations are called out separately; these blocks alone are not a complete setup script. `SERIAL` supplies an integer sequence; the legacy transaction ID has no sequence/default.

### `categories`

```sql
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('income', 'expense', 'all')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (name, parent_id)
);
```

### `tags`

```sql
CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### `students`

```sql
CREATE TABLE IF NOT EXISTS students (
    admission_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    roll_number TEXT,
    class TEXT,
    section TEXT,
    father_name TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### `transactions`

```sql
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    date DATE NOT NULL,
    reference TEXT,
    particulars TEXT,
    amount NUMERIC NOT NULL,
    head TEXT,
    main_category TEXT,
    sub_category TEXT,
    tags TEXT[] DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    bank_amount NUMERIC DEFAULT 0,
    cheque_count INTEGER DEFAULT 0,
    attachments JSONB DEFAULT '[]'::jsonb
);
```

### `transaction_revisions`

```sql
CREATE TABLE IF NOT EXISTS transaction_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE')),
    old_values JSONB,
    new_values JSONB,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### `activity_history`

```sql
CREATE TABLE IF NOT EXISTS activity_history (
    id UUID PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    date DATE NOT NULL,
    time TEXT NOT NULL,
    user_name TEXT,
    user_email TEXT,
    firebase_uid TEXT,
    activity_type TEXT NOT NULL,
    transaction_id INTEGER,
    description TEXT,
    device_status TEXT NOT NULL,
    sync_status TEXT DEFAULT 'synced'
);
```

### `user_profiles`

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
    email TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    profession TEXT NOT NULL,
    firebase_uid TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### `fee_structures`

```sql
CREATE TABLE IF NOT EXISTS fee_structures (
    id SERIAL PRIMARY KEY,
    academic_year TEXT NOT NULL,
    class TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('Monthly', 'Yearly', 'One-Time')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (academic_year, class, fee_type)
);
```

### `fee_payments`

```sql
CREATE TABLE IF NOT EXISTS fee_payments (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    student_admission_number TEXT NOT NULL REFERENCES students(admission_number) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    fee_month TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### `student_fee_assignments`

```sql
CREATE TABLE IF NOT EXISTS student_fee_assignments (
    id SERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(admission_number) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    fee_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    assigned_amount NUMERIC NOT NULL,
    remarks TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (student_id, academic_year, fee_category_id)
);
```

### `faculty`

```sql
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
```

### `faculty_expense_categories`

```sql
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
```

### `faculty_expense_payments`

```sql
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
```

## Additions and constraints after table creation

- `categories.frequency`: `text DEFAULT 'Yearly'`, checked against `Monthly`, `Yearly`, and `One-Time` by the fee migration.
- Phase 3 adds `school_id uuid REFERENCES schools(id)` to `transactions`, `transaction_revisions`, `categories`, `tags`, `activity_history`, `fee_payments`, and `student_fee_assignments`. It backfills and marks these columns `NOT NULL`.
- Phase 3 adds nullable `user_id uuid REFERENCES users(id)` to `transactions`, `transaction_revisions`, and `activity_history`.
- If `fee_structures` exists, Phase 3 adds and backfills `school_id uuid REFERENCES schools(id)` and replaces its policies.
- Category parent deletion changes from `CASCADE` to `RESTRICT`.
- `transactions` gains `UNIQUE (id, school_id)`. Revisions and fee payments gain composite foreign keys `(transaction_id, school_id)` to that key with `ON DELETE RESTRICT`. The earlier fee payment transaction foreign key also remains.
- Faculty payments gain `transaction_id -> transactions.id ON DELETE RESTRICT` when the transactions ID column exists. This is an integer foreign key, not a composite school key.
- Faculty employee IDs are unique within a school: `(school_id, employee_id)`. Payment vouchers are unique within a school: `(school_id, voucher_number)`.
- Faculty category uniqueness is `(school_id, parent_id, name)` using a regular unique index. Nullable root `parent_id` values do not prevent duplicate root names.

## Relationships and app field mapping

| Relationship / mapping | Meaning |
| --- | --- |
| `categories.parent_id -> categories.id` | Hierarchy used for main/subcategories and fees |
| `transactions.main_category`, `sub_category`, `head` | Text snapshots; no category foreign keys |
| `transactions.tags` | Text array; no foreign key to `tags` |
| `fee_payments.transaction_id -> transactions.id` | One fee metadata row per transaction; payment amount/date come from the transaction |
| `fee_payments.student_admission_number -> students.admission_number` | Legacy student business key |
| `student_fee_assignments.student_id -> students.admission_number` | Legacy text student key, not a UUID in the fee migration |
| `student_fee_assignments.fee_category_id -> categories.id` | Assigned fee category; unique per student/year/category |
| `faculty_expense_payments.faculty_id -> faculty.id` | Faculty payment history |
| `faculty_expense_payments.expense_category_id -> faculty_expense_categories.id` | Enables the nested category query in `dataService.js` |
| `faculty_expense_categories.parent_id -> faculty_expense_categories.id` | Faculty expense hierarchy |
| App `mainCategory`, `subCategory`, `bankAmount`, `chequeCount` | Stored as `main_category`, `sub_category`, `bank_amount`, `cheque_count` |
| App faculty `name`, `base_salary` | Stored as `faculty_name`, `salary`; mapped back by `DataService` |

`created_by`/`updated_by` on legacy ledger tables are text metadata. They differ from UUID ownership `user_id` and the UUID audit fields on faculty tables. Legacy `firebase_uid` fields remain in activity/profile storage despite Supabase authentication.

## Indexes

- Legacy ledger: transaction deletion state, main category, subcategory; revision transaction ID; student `(name, admission_number, roll_number)`; activity timestamp, user email, and activity type.
- Fees: fee structure `(class, academic_year)`; payment `(student_admission_number, academic_year)` and `fee_month`; assignment `(student_id, academic_year)` plus its unique business key.
- Faculty: unique `(school_id, employee_id)`; `(school_id, faculty_name)`, `(school_id, department)`, `(school_id, status)`.
- Faculty categories: unique `(school_id, parent_id, name)` and school lookup.
- Faculty payments: unique `(school_id, voucher_number)`; `(school_id, faculty_id, payment_date DESC)`, `(school_id, expense_category_id, payment_date DESC)`, `(school_id, payment_date DESC)`.

## Functions, triggers, and access

Phase 3 defines `ledger_school_id()`, `has_ledger_access()`, `is_ledger_accountant()`, `is_ledger_principal()`, `is_ledger_admin()`, and `is_ledger_reader()`. These are security-definer helpers with `search_path = public, pg_temp`. Active Ledger access is resolved through `app_access`, rather than the UI profile profession.

`set_ledger_context()` runs before inserts/updates on the seven school-owned ledger tables. It requires authentication and active Ledger access, fills or validates the sole school, and fills/validates `user_id` on transactions, revisions, and activity history. `protect_ledger_activity_history()` blocks updates/deletes to activity history.

Faculty triggers fill/validate school context, populate audit identities, and validate that payment faculty and active expense category belong to the same school. `set_faculty_context()` also updates the faculty `updated_at` timestamp. Other timestamp defaults do not imply automatic refresh on updates.

The Phase 3 and faculty scripts enable and force RLS on their protected tables and revoke anonymous/public table access. The earlier scripts contain permissive anonymous policies. The effective deployed policies depend on which migrations have actually run.

| Table group | Read | Insert/update | Delete |
| --- | --- | --- | --- |
| Transactions, fee payments, fee assignments | Ledger reader | Accountant helper or admin | No normal policy |
| Transaction revisions | Ledger reader | Insert by accountant helper or admin; no update policy | No policy |
| Activity history | Principal or admin | Insert by accountant helper or admin with own `user_id`; updates blocked | Blocked |
| Categories, tags | Active Ledger access | Admin | Admin |
| Optional fee structures | Ledger reader | Admin | Admin |
| User profiles | Own email, or principal/admin | Own email | No Phase 3 delete policy |
| Faculty | Active Ledger access | Accountant, principal, or admin | No policy; use inactive status |
| Faculty expense categories | Active Ledger access | Admin | Admin |
| Faculty expense payments | Ledger reader | Accountant, principal, or admin | No policy |

**Actual role behavior:** `is_ledger_accountant()` includes both `accountant` and `principal`. Therefore principals can perform the writes guarded by that helper, despite comments describing principals as read-only. Admin roles are `admin` and `super_admin`.

The legacy `students` definition enables anonymous CRUD. Phase 3 does not redefine student policies; student access in the shared database must be assessed separately.

## Salary payment RPC

```sql
public.pay_faculty_salary(
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
) RETURNS uuid
```

Called by `DataService.payFacultySalary()`. This security-definer function requires authenticated active Ledger access and an accountant/principal/admin role. It atomically inserts an expense transaction and its linked faculty payment, returning the payment UUID. It uses the caller UUID as transaction `user_id` and faculty audit identity. The SQL function does not insert a transaction revision or activity history record.

The migration seeds a root `Faculty Expenses` category and six children: `Salary`, `Advance Salary`, `Bonus`, `Incentives`, `Reimbursements`, and `Other Faculty Expenses`. Seed IDs are generated UUIDs.

## Reporting views

All four faculty views use `security_invoker = true`.

| View | Output |
| --- | --- |
| `faculty_salary_register` | Payment ID/school, employee ID/name/department/designation/status, date, voucher, amount, expense category, payment mode, remarks, creation time; includes all faculty expense categories |
| `faculty_monthly_salary_report` | School/month, payment count, summed amount for category name `Salary` |
| `faculty_department_expense_report` | School/department/category, payment count, summed amount |
| `faculty_dashboard_summary` | School, total/active faculty, current-month salary paid, total faculty expenses |

## Receipt storage and local data

The configured defaults in `app.js` are table `transactions` and storage bucket `receipts`; environment configuration can override both. `migrations.sql` creates a public `receipts` bucket and SELECT/INSERT/UPDATE/DELETE object policies for `anon` and `authenticated` restricted to that bucket. Phase 3 does not replace these storage policies.

Transaction attachment metadata is stored in `transactions.attachments` as JSONB. File contents are uploaded through the Storage API. Browser localStorage caches and offline IDs such as `fac_*` and `pay_*` are client state, not additional Supabase tables.

## Compatibility gaps visible in the source

1. **Transaction ID generation:** `transactions.id` is an integer primary key without a default in `migrations.sql`. The browser supplies IDs, but `pay_faculty_salary()` omits the ID. The RPC requires a compatible database-side ID default that is not provided by these migrations.
2. **Faculty upsert conflict target:** `dataService.js` uses `onConflict: 'employee_id'`. The supplied unique index is on `(school_id, employee_id)`, so that conflict target does not match it.
3. **Payment mode casing:** the database accepts `cash`, `bank_transfer`, `cheque`, `upi`, `other`. The service passes UI values directly and defaults to `Cash`; the RPC does not normalize this value.
4. **Student schema variants:** `mock_schema.sql` uses UUID student IDs and extra UUID linkage columns. The application and `migrations_fees.sql` use admission-number text keys. The mock is not an authoritative replacement for the application schema.
5. **Hard deletes:** the app attempts fee payment deletions and permanent transaction deletion, but Phase 3 supplies no ordinary DELETE policies for these tables and adds restrictive references.
6. **Faculty fallback categories:** the service has hardcoded fallback UUIDs, while SQL seeds generated UUIDs. A fallback UUID is not guaranteed to reference a database category.
7. **Schema fallback:** transaction upload retries can drop missing columns after PostgREST errors. A successful upload therefore does not prove the deployed schema contains every field documented here.

These differences are documented as found; this file does not change application behavior or apply database migrations.
