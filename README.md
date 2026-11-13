# School Accountant – Income & Expense Manager

A browser-based school accounting app for daily income and expenses, student fees, and faculty salary payments. It uses plain HTML and JavaScript, Supabase for authentication/database/file storage, and localStorage for local records and caches.

## Features

- **Dashboard:** Income, expenses, balance, and faculty financial summaries.
- **Income and expenses:** Bulk entry, categories, subcategories, tags, bank amounts, cheque counts, and attachments.
- **Transaction management:** Search/filter records, edit transactions, view revision history, soft-delete/restore records, and export/import CSV.
- **Student directory:** Search and filter students, import student CSV files, and associate students with fee transactions.
- **Fee management:** Fee categories with monthly, yearly, or one-time frequency; individual and bulk student fee assignments; payment status, dues, student ledgers, and printable/CSV reports.
- **Receipts:** Print fee receipts with tuition, transport, and general fee layouts.
- **Faculty:** Directory with employee IDs, department/designation, salary, active/inactive status, CSV import/export, salary and expense payments, payment history, and printable/CSV financial reports.
- **Activity history:** Activity records and filters, subject to database access policies.
- **Authentication:** Email/password sign-in and registration, Google sign-in, and a “Continue Offline” option.
- **Cloud and local storage:** Supabase fetch/push operations, browser caches, and local fallback paths. Cloud writes depend on authentication, schema compatibility, and RLS permissions.

## Run locally

No build step or npm installation is required for the browser app. Use a modern browser and a static HTTP server. The Supabase JavaScript SDK v2 and PapaParse 5.4.1 load from CDNs, so loading these dependencies requires internet access.

1. Create a `.env` file in the repository root:

   ```env
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_ANON_KEY="your-public-anon-key"
   # Optional overrides:
   SUPABASE_TABLE="transactions"
   SUPABASE_BUCKET="receipts"
   ```

   `SUPABASE_KEY` is also accepted as a fallback for `SUPABASE_ANON_KEY`. The app fetches `.env` in the browser; these values are publicly accessible client configuration. Use the public anon key and enforce access through database policies. Never put a service-role key or other server secrets in this file.

2. Serve the repository, for example:

   ```sh
   python3 -m http.server 8000
   ```

3. Open [http://localhost:8000/index.html](http://localhost:8000/index.html). Use HTTP rather than opening the HTML file directly so configuration fetching works.
4. Sign in to use Supabase-backed features, or choose **Continue Offline** for local use. Offline mode does not grant database permissions or guarantee that every locally recorded operation will later synchronize.

### Alternative JavaScript configuration

If the host does not serve `.env`, copy `config.example.js` to `config.js`, fill in its public Supabase values, and add this script tag to `index.html` before the application scripts:

```html
<script src="config.js"></script>
```

The example defines `window.APP_CONFIG_ENV.supabase` with `url`, `key`, `table`, and `bucket`. `index.html` does not currently load `config.js` automatically. A valid `.env` configuration takes precedence over this fallback.

## Supabase setup

See [SUPABASE_SCHEMA.md](SUPABASE_SCHEMA.md) for table definitions, relationships, indexes, role policies, triggers, the salary RPC, reporting views, storage, and known app/schema compatibility gaps.

| File | Purpose |
| --- | --- |
| `migrations.sql` | Original ledger tables, student directory, audit/profile tables, and `receipts` storage bucket/policies |
| `migrations_fees.sql` | Fee tables and category frequency |
| `01_phase3_ledger_preflight_single_school.sql` | Preflight checks for the existing shared database |
| `02_phase3_ledger_migration_single_school.sql` | Single-school ownership, role helpers, authenticated RLS, and integrity constraints |
| `03_phase3_ledger_rollback_single_school.sql` | Phase 3 rollback |
| `04_phase3_ledger_pglite_regression_single_school.sql` | Regression checks |
| `05_faculty_directory_salary_expenses.sql` | Faculty tables, payment RPC, RLS, and reporting views |
| `roles_query.sql` | Example user/access provisioning queries; replace placeholder school/user values |

These files are not a complete fresh-project bootstrap. Phase 3 expects shared `public.schools`, `public.users`, and `public.app_access` tables and exactly one school. Inspect the existing database, run the preflight, apply Phase 3 after its prerequisites, then apply the faculty migration. `mock_schema.sql` is a test fixture, not a production migration.

Email/password authentication must be enabled in the Supabase project for those sign-in methods. For Google sign-in, configure the Google provider and allow the app's `index.html` redirect URL in Supabase Auth. Registering/signing in does not by itself provision the shared user record and active `ledger` app access required by Phase 3.

The original migrations grant permissive anonymous table/storage access. Phase 3 replaces policies for its protected ledger tables; student and receipt-storage policies require separate review. The supplied role helper currently includes principals in accountant permissions. Known salary integration gaps include transaction ID generation, faculty upsert conflict targets, and payment-mode casing; see the schema reference before relying on salary cloud writes.

## Imports, exports, and local data

- [test_students.csv](test_students.csv) shows student import columns: `admission_no`, `student_name`, `roll_number`, `class`, `section`, `father_name`, and `phone`.
- [test_fees.csv](test_fees.csv) shows student identifiers plus fee-name and fee-remarks columns for fee assignment imports.
- Faculty import provides a preview with validation and selectable rows; faculty directory and reports also support CSV export.
- **Export All Data (JSON)** currently exports only `transactions`, `nextId`, and an export timestamp. It does not back up the student/faculty directories, fee assignments, payment history, categories, tags, or activity/revision collections as separate datasets.
- JSON import replaces the local transaction collection. Browser localStorage belongs to the current browser profile and origin; changing the host/port or clearing browser data affects access to those local records.
- Receipt layouts currently contain hardcoded Delhi Secondary School branding in `app.js`; edit the receipt templates to change it.

## Code layout

| File | Responsibility |
| --- | --- |
| `index.html` | UI, styles, CDN dependencies, and application script loading |
| `app.js` | Configuration, auth, ledger, students, fees, receipts, local persistence, and Supabase synchronization |
| `dataService.js` | Faculty database operations, salary RPC calls, and local faculty/payment caches |
| `faculty.js` | Faculty forms, directory, CSV workflows, salary history, and reporting UI |
| `config.example.js` | Optional browser configuration template |
| `SUPABASE_SCHEMA.md` | Database reference derived from application code and SQL |

## Validation scripts

The self-contained milestone suite requires Node.js 20 or newer, with no dependency installation, network, browser, or Supabase credentials:

```sh
npm test
```

This executes current `app.js` functions and `dataService.js` in isolated Node VM contexts with mocked cloud calls and in-memory storage. It checks the ₹10,000 closing-balance example, student fee linkage/persistence, previous-year allocation, academic-year boundaries, soft cancellation, salary RPC payloads, and rejected writes. It does not prove browser behavior, actual database posting, RLS, receipt rendering, or synchronization.

The initial baseline has **8 passing tests and 4 executable TODO tests** exposing negative fee acceptance, duplicate receipts, salary mode casing, and missing offline salary ledger posting. TODO tests run their assertions and appear in the output, but do not fail the normal command. New failures outside these explicitly listed defects do fail it. To treat every known defect as a failure (the financial acceptance gate), run:

```sh
npm run test:strict
```

The strict command currently exits nonzero with those four failures. When fixing a defect, remove its TODO annotation and keep its regression assertion. See `tests/ledger.test.cjs`. The balance example posts salary amounts as ordinary expense transactions; salary service tests separately verify its current contract, not live SQL execution.

Legacy scripts are excluded from this suite: `test_phase3_pglite.mjs` imports `@electric-sql/pglite` and requires shared-schema SQL files outside this checkout. `test_batch_writes.js` references `syncService.js`, which is absent. They remain historical integration-test material, not passing coverage; repairing/replacing them with isolated database integration tests is a later task.

For a manual smoke check, serve the app, exercise offline transaction entry and reload persistence, then verify authenticated fetch/write flows against a configured development Supabase database. Check fee assignment/payment linkage, attachments, and faculty salary writes separately because their schemas and permissions differ.

## License

[MIT](LICENSE)
