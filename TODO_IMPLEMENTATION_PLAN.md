# School Ledger Implementation Plan — Academic Year 2026–27

Objective: support all 23 functional scenarios and six validation checks for student fees, staff payments, daily accounting, and financial reports.

Status: planning checklist based on source and SQL review. Existing features are not considered passed until verified in the browser and against a disposable database. No production migrations or application changes are authorized by this document alone.

## 1. Establish a repeatable baseline

- [ ] Record current behavior for TC01–TC23 with actual result, evidence, and pass/fail status.
- [ ] Create isolated test data for new/existing students and staff, 2025–26 dues, and 2026–27 activity.
- [ ] Repair the test setup: provide documented dependencies and commands; resolve the missing `syncService.js` reference in `test_batch_writes.js` and external SQL prerequisites in `test_phase3_pglite.mjs`.
- [ ] Keep fixtures consistent with the application's admission-number student keys and school ownership model.
- [ ] Confirm deployed schema, role policies, and migration prerequisites before changing SQL. Use an additive migration with preflight checks and a rollback/recovery procedure.

Acceptance: tests run from a documented setup without accessing production data; existing supported workflows have recorded baseline results.

## 2. Fix transaction integrity and cloud salary posting — priority P0

Files: `app.js`, `dataService.js`, `faculty.js`, and a new SQL migration.

- [ ] Define one canonical transaction contract for positive finite amounts, date, school, reference, payment mode, and linked student/staff IDs.
- [ ] Reject zero, negative, nonfinite, and malformed transaction amounts in entry, edit, import, service, and database paths. Treat opening balances separately so an overdraft can be represented deliberately.
- [ ] Normalize payment modes to `cash`, `bank_transfer`, `cheque`, `upi`, and `other` at the service boundary and validate them in SQL.
- [ ] Fix transaction ID allocation for the salary RPC and browser writes. Avoid collisions between browser, offline, and database-generated IDs; synchronize any sequence with existing IDs.
- [ ] Correct faculty upserts to match `(school_id, employee_id)` and confirm the conflict target is supported by the actual unique index.
- [ ] Resolve faculty categories using real school-scoped database IDs; remove reliance on hardcoded fallback UUIDs.
- [ ] Make salary posting atomic: one linked payment, one expense transaction, and an audit event, or no changes.
- [ ] Prevent retries, double clicks, concurrent requests, and offline replay from duplicating a payment using a persistent operation/idempotency key.
- [ ] Surface failed writes accurately; restore local state after rejected edits or cancellations and await synchronization before refreshing success totals.
- [ ] Fail clearly when required financial columns are absent instead of silently dropping required data during schema fallback.

Acceptance: TC10, TC11, TC16, and TC17 work against the migrated database; rejected or retried writes leave consistent balances and payment history.

## 3. Enforce identifiers and document numbering — priority P0

- [ ] Enforce unique student admission numbers and staff employee IDs within a school in forms, imports, and SQL.
- [ ] Define document-number namespaces for fee receipts, salary vouchers, refunds, and transfers; opening entries must not consume receipt numbers.
- [ ] Generate document numbers atomically on the server and enforce school/document-type uniqueness. Retain numbers after cancellation.
- [ ] Audit existing duplicate references before adding constraints; produce a reviewable remediation report without silently renumbering issued documents.
- [ ] Flag repeated manual receipt/voucher numbers with a useful error; preserve entered form data.
- [ ] Give offline entries provisional identifiers and allocate final numbers once on successful synchronization.

Acceptance: TC07 and unique-ID/document-number validation pass, including simultaneous requests and repeated imports.

## 4. Complete student fee workflows — priority P1

Files: `app.js`, `index.html`, fee tables/RPCs.

- [ ] Add or complete a new-student admission workflow with explicit admission-fee assignment and collection, linked to the created student.
- [ ] Make student creation plus admission collection atomic, or provide an explicit recoverable unpaid-admission state if payment fails.
- [ ] Collect tuition against the selected student, fee category, academic year, and applicable month; print the persisted receipt after success.
- [ ] Support previous-year dues collection with the old academic year retained while recording actual cash receipt on the current payment date.
- [ ] Verify partial payments, remaining dues, and overpayment handling; show any credit explicitly.
- [ ] Add a dedicated payment-mode control and required bank/UPI references to student fee entry and receipts.
- [ ] Verify fee frequency calculations for monthly, yearly, and one-time assignments, including months with no payments.

Acceptance: TC01–TC06 pass for new/existing students; old dues decrease without being counted as current-year fee charges.

## 5. Add cancellations, refunds, and consistent audit history — priority P1

- [ ] Define distinct cancellation and refund operations with reason, actor, timestamp, original-entry link, and authorization checks.
- [ ] Cancel an incorrect unrefunded entry without losing its document number or history; exclude it consistently from active totals.
- [ ] Record a real fee refund as a linked outflow/reversal, preserving the original receipt and explicitly defining whether dues reopen or charges are waived.
- [ ] Prevent refunds exceeding the refundable paid balance and prevent repeated cancellation/refund requests.
- [ ] Reconcile salary payment status with the linked ledger transaction so cancelled salaries no longer count as disbursed in staff history or reports.
- [ ] Preserve append-only audit records and revisions; remove ordinary financial hard-delete paths.
- [ ] Protect finalized/reconciled transactions from silent edits; use controlled corrections where needed.

Acceptance: TC08, TC15, and TC22 pass; dashboard, student dues, staff payable, reports, and audit history agree after every operation.

## 6. Implement salary periods, advances, and partial payments — priority P1

- [ ] Store the salary period separately from the disbursement date and record the payable amount for that period.
- [ ] Track staff advances with issue date, original amount, repayments/deductions, and outstanding balance.
- [ ] Implement advance recovery as a noncash allocation: net cash payment = salary settled minus advance deduction. Avoid recording the recovered advance as a second cash expense.
- [ ] Support partial salary settlement and show the remaining period payable accurately.
- [ ] Keep reimbursements and other staff expenses separate from salary and advances when calculating payroll paid/pending totals.
- [ ] Preserve historical salary obligations when a staff salary changes; define joining/leaving-month treatment explicitly.
- [ ] Calculate multi-month reports from period obligations rather than subtracting all payments from one month's current base salary.
- [ ] Reverse advance recovery and reopen the appropriate salary payable when a salary payment is cancelled.

Acceptance: TC12–TC14 pass, including advance issue, partial recovery, partial net payment, later settlement, and cancellation.

## 7. Implement cash/bank accounts and transfers — priority P1

- [ ] Introduce explicit cash and bank accounts and assign each monetary movement to its account. Map UPI to the receiving/paying bank account.
- [ ] Replace hardcoded income `bankAmount: 0` and expense `bankAmount: amount` behavior with actual account allocations.
- [ ] Define account reconciliation for legacy transactions; flag unknown allocations instead of guessing.
- [ ] Add atomic cash-to-bank and bank-to-cash transfers with paired account movements and a single linked transfer reference.
- [ ] Exclude transfers from income and expense totals while including them in account balances.
- [ ] Reverse both sides of a cancelled transfer atomically and retain its audit trail.

Acceptance: TC18 and separate cash/bank validation pass; a transfer changes account balances but leaves combined funds and income/expense totals unchanged.

## 8. Implement daily/monthly statements and balance carry-forward — priority P1

- [ ] Calculate opening balance for a selected day from the initial account opening plus all earlier active movements.
- [ ] Carry each day's closing forward automatically, including dates with no activity. Do not create a new income entry for every carried opening.
- [ ] Recalculate subsequent balances after a permitted backdated correction.
- [ ] Provide daily statements with opening, receipts, payments, transfer movements, and closing for each account and combined funds.
- [ ] Provide monthly summaries derived from the same canonical transaction data; reconcile them to daily statements.
- [ ] Add academic-year scope to dashboard and reports. Use 1 April 2026–31 March 2027 for 2026–27 and retain incoming opening funds separately from that year's income.
- [ ] Apply consistent school, date, account, and active/cancelled filters across screen, print, and CSV outputs.

Acceptance: TC19–TC21 and TC23 pass; no double-counted openings, and monthly totals equal the sum of daily activity.

## 9. Enforce permissions and define offline behavior — priority P0 before release

- [ ] Document the role matrix for viewing, collecting, paying, editing, cancelling, refunding, and managing master data; explicitly resolve principal permissions.
- [ ] Enforce permissions and school ownership in SQL/RPCs, not only through UI controls.
- [ ] Test unauthenticated, unauthorized, and cross-school mutations, including direct API calls.
- [ ] Review student-directory and receipt-storage policies, which are not fully covered by Phase 3 ledger policies.
- [ ] Decide and document offline financial-write behavior. Provisional local entries must be visibly pending and must not claim server authorization or final posting.
- [ ] If offline writes remain supported, post salary payments into the same local ledger model and synchronize linked records exactly once after role validation.
- [ ] Reconcile pending, rejected, and accepted operations without losing audit links or reporting failed cloud operations as finalized payments.

Acceptance: only allowed roles can modify/cancel server financial records; offline status and totals are explicit and reconcile after reconnecting.

## 10. Execute the acceptance suite and release checks

- [ ] TC01–TC08: new admission, new/existing tuition, old dues, partial payment, payment modes, duplicate receipt, cancellation/refund.
- [ ] TC09–TC15: new staff, first/existing salary, advance issue/recovery, partial salary, cancellation with retained history.
- [ ] TC16–TC23: fee income, ordinary expense, transfer, closing formula, daily/monthly statements, audited correction, next-day opening.
- [ ] Validate all six rules: unique person IDs; positive transaction amounts; unique document numbers; separate cash/bank balances; cancelled-entry exclusion; authorized modification/cancellation.
- [ ] Run browser workflows and database integration checks for each supported online/offline mode; include reload persistence and reconnection.
- [ ] Add focused regression coverage for concurrent numbering, retry idempotency, rejected mutations, refund limits, and linked salary cancellation.
- [ ] Verify academic-year boundaries on 31 March/1 April and previous-year collections paid in 2026–27.
- [ ] Update `README.md` and `SUPABASE_SCHEMA.md` with migrations, setup, permissions, offline guarantees, and remaining limitations.

### Required end-to-end fixture

| Entry | Receipts (₹) | Payments (₹) |
| --- | ---: | ---: |
| Opening funds | 10,000 (opening only) | — |
| New student admission | 5,000 | — |
| Existing student tuition | 3,000 | — |
| New staff salary | — | 4,000 |
| Existing staff salary | — | 3,000 |
| Electricity | — | 1,000 |

- [ ] Confirm operating receipts = ₹8,000, payments = ₹8,000, and closing funds = ₹10,000.
- [ ] Confirm both salary payments appear in the main ledger and the correct staff histories.
- [ ] Confirm cash plus bank equals ₹10,000 and next-day opening equals ₹10,000.
- [ ] Repeat with a transfer, cancelled entry, refund, and backdated correction; verify the corresponding expected balances independently.

Release gate: all 23 functional cases and six validation checks have recorded passing results in the supported configuration; unresolved cases remain explicitly open in this checklist.
