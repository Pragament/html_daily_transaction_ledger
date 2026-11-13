const test = require('node:test');
const assert = require('node:assert/strict');
const { appHarness, facultyHarness } = require('./helpers.cjs');
const defect = reason => process.env.LEDGER_STRICT_TESTS ? {} : { todo: reason };
const fee = (overrides = {}) => ({
  type: 'income', date: '2026-06-15', reference: 'REC-001', particulars: 'Tuition',
  amount: 3000, head: 'Fees', mainCategory: 'Fees', subCategory: 'Tuition',
  student: { admissionNumber: 'ADM001', name: 'Test Student' }, ...overrides
});
const salary = (overrides = {}) => ({
  faculty_id: 'staff-001', expense_category_id: 'salary-category',
  expense_category_name: 'Salary', payment_date: '2026-06-15', amount: 4000,
  payment_method: 'Cash', reference: 'SAL-001', ...overrides
});

test('TC19: sample opening + receipts - payments closes at ₹10,000', async () => {
  const app = appHarness();
  for (const tx of [
    { type: 'income', head: 'Opening', amount: 10000 },
    fee({ reference: 'ADM-001', amount: 5000 }), fee(),
    { type: 'expense', amount: 4000 }, { type: 'expense', amount: 3000 },
    { type: 'expense', amount: 1000 }
  ]) await app.addTransaction(tx);
  const totals = app.calcDashboard();
  assert.equal(totals.openingBal, 10000);
  assert.equal(totals.totalIncome, 8000);
  assert.equal(totals.totalExpense, 8000);
  assert.equal(totals.closing, 10000);
  // Salary amounts above are ledger entries; salary service integration is tested below.
});

test('TC02/03: fee posting retains student/year linkage and persists ledger', async () => {
  const app = appHarness();
  const tx = await app.addTransaction(fee());
  assert.equal(app.transactions.length, 1);
  assert.equal(app.persisted()[0].amount, 3000);
  assert.equal(app.feePayments[0].transaction_id, tx.id);
  assert.equal(app.feePayments[0].student_admission_number, 'ADM001');
  assert.equal(app.feePayments[0].academic_year, '2026-27');
  assert.equal(app.mutations[0].action, 'CREATE');
  assert.equal(app.calcDashboard().totalIncome, 3000);
});

test('TC04: old-year collection keeps old-year allocation and current receipt date', async () => {
  const app = appHarness();
  await app.addTransaction(fee({ academicYear: '2025-26' }));
  assert.equal(app.feePayments[0].academic_year, '2025-26');
  assert.equal(app.transactions[0].date, '2026-06-15');
});

test('academic year changes at April 1', () => {
  const app = appHarness();
  for (const [date, year] of [['2026-03-31', '2025-26'], ['2026-04-01', '2026-27'],
    ['2027-03-31', '2026-27'], ['2027-04-01', '2027-28']]) {
    assert.equal(app.getCurrentAcademicYear(`${date}T12:00:00`), year);
  }
});

test('TC08: soft cancellation removes fee from active totals and retains audit history', async () => {
  const app = appHarness();
  const tx = await app.addTransaction(fee());
  await app.deleteTransaction(tx.id);
  assert.equal(app.calcDashboard().totalIncome, 0);
  assert.equal(app.transactions[0].isDeleted, true);
  assert.equal(app.feePayments.length, 0);
  assert.equal(app.revisions.at(-1).action, 'DELETE');
  assert.equal(app.revisions.at(-1).old.isDeleted, false);
});

test('rejected fee cloud write does not post local income or fee metadata', async () => {
  const app = appHarness({ pushOrQueueMutation: async () => { throw Error('Denied'); } });
  assert.equal(await app.addTransaction(fee()), null);
  assert.equal(app.transactions.length, 0);
  assert.equal(app.feePayments.length, 0);
});

test('TC10/11: salary service sends staff, amount and voucher to RPC', async () => {
  const h = facultyHarness({ online: true });
  await h.service.payFacultySalary(salary());
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'pay_faculty_salary');
  assert.equal(h.calls[0].payload.p_faculty_id, 'staff-001');
  assert.equal(h.calls[0].payload.p_amount, 4000);
  assert.equal(h.calls[0].payload.p_voucher_number, 'SAL-001');
  assert.equal(JSON.parse(h.storage.get('school_accountant_faculty_payments'))[0].amount, 4000);
});

test('salary RPC rejection leaves no successful local payment', async () => {
  const h = facultyHarness({ online: true, rpc: () => ({ error: { message: 'Denied' } }) });
  await assert.rejects(h.service.payFacultySalary(salary()));
  assert.equal(h.storage.has('school_accountant_faculty_payments'), false);
});

test('validation: negative fee must not post', defect('addTransaction lacks positive amount validation'), async () => {
  const app = appHarness();
  try { await app.addTransaction(fee({ amount: -100 })); } catch {}
  assert.equal(app.transactions.length, 0);
});

test('TC07: duplicate receipt must not create a second transaction', defect('receipt references are not unique'), async () => {
  const app = appHarness();
  await app.addTransaction(fee());
  try { await app.addTransaction(fee()); } catch {}
  assert.equal(app.transactions.length, 1);
});

test('salary mode must use database canonical value', defect('UI Cash is passed directly instead of cash'), async () => {
  const h = facultyHarness({ online: true });
  await h.service.payFacultySalary(salary());
  assert.equal(h.calls[0].payload.p_payment_mode, 'cash');
});

test('offline salary must affect the main ledger expense balance', defect('offline salary only writes faculty payment cache'), async () => {
  const app = appHarness();
  const h = facultyHarness();
  // Both services share the same browser storage in production. Inspect all writes
  // here so a faculty-only cache cannot masquerade as a main ledger posting.
  await h.service.payFacultySalary(salary());
  const records = [...h.storage.entries()].filter(([key]) => key !== 'school_accountant_faculty_payments')
    .flatMap(([, value]) => { const data = JSON.parse(value); return Array.isArray(data) ? data : data.transactions || []; });
  app.transactions.push(...records);
  assert.equal(app.calcDashboard().totalExpense, 4000);
});
