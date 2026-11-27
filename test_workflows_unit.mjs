// test_workflows_unit.mjs
// Unit & mocked-Supabase integration tests covering dataService.js, app.js (fee workflows/receipts),
// and faculty.js (salary-only separation, 10 reports, history classification, dashboard metrics).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createMockElement(tag = 'div', id = '') {
    const attrs = {};
    const children = [];
    const classes = new Set();
    const listeners = {};
    const el = {
        tagName: tag.toUpperCase(),
        id,
        value: '',
        checked: false,
        disabled: false,
        innerHTML: '',
        innerText: '',
        textContent: '',
        style: {},
        dataset: {},
        options: [],
        selectedIndex: 0,
        selectedOptions: [],
        title: '',
        min: '',
        max: '',
        children,
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            toggle: (c, force) => {
                const has = classes.has(c);
                const next = force !== undefined ? force : !has;
                if (next) classes.add(c); else classes.delete(c);
                return next;
            },
            contains: (c) => classes.has(c)
        },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => attrs[k] ?? null,
        appendChild: (c) => { children.push(c); return c; },
        addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
        dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach(fn => fn(ev)); },
        querySelector: (sel) => {
            if (tag.toLowerCase() === 'tr' && sel) {
                el._subEls ||= new Map();
                if (!el._subEls.has(sel)) el._subEls.set(sel, createMockElement(sel.includes('sel') || sel.includes('category') || sel.includes('mode') ? 'select' : 'input'));
                return el._subEls.get(sel);
            }
            return null;
        },
        querySelectorAll: () => [],
        closest: () => el,
        focus: () => {},
        click: () => {}
    };
    return el;
}

function buildSandbox() {
    const store = new Map();
    const elements = new Map();
    const ensureEl = (id, tag = 'div') => {
        if (!elements.has(id)) elements.set(id, createMockElement(tag, id));
        return elements.get(id);
    };

    // Pre-register key DOM IDs touched by app.js & faculty.js functions
    [
        'receiptPrintContainer', 'feesOverviewAcademicYear', 'feesOverviewStats', 'feesOverviewTypeBreakdown',
        'feesOverviewRecentCollections', 'feesStatusAcademicYear', 'feesStatusSearch', 'feesStatusClass',
        'feesStatusSection', 'feesStatusType', 'feesStatusMonth', 'feesStatusBalanceFilter', 'feesStatusFilter',
        'feesStatusMatrixHeader', 'feesStatusMatrixBody', 'feesStatusSummary', 'reportsSelectType',
        'reportsAcademicYear', 'reportsClass', 'reportsSection', 'reportsCategory', 'reportsDateFrom',
        'reportsDateTo', 'feesReportsHeader', 'feesReportsBody', 'feesReportsStatusBanner',
        'reportsClassField', 'reportsSectionField', 'facultyReportTypeSelect', 'facultyReportMonthSelect',
        'facultyReportDeptSelect', 'facultyReportStatusSelect', 'facultyReportPersonSelect',
        'facultyReportMonthGroup', 'facultyReportDeptGroup', 'facultyReportStatusGroup', 'facultyReportPersonGroup',
        'facultyReportsTableHead', 'facultyReportsTableBody', 'facultyReportsTableFoot',
        'facultyReportTableCount', 'reportKpiStaffCount', 'reportKpiCommitted', 'reportKpiDisbursed',
        'reportKpiPending', 'reportKpiPendingSub', 'dashFacultyCommitted', 'dashFacultyDisbursed',
        'dashFacultyPending', 'dashFacultyStaffCount', 'dashFacultyExpenseShare', 'dashFacultyFulfillmentRate',
        'dashPendingSalaryAlert', 'dashPendingAlertTitle', 'dashPendingAlertText', 'tabNav',
        'incModeBtnGeneral', 'incModeBtnStudentFee', 'incomeGeneralControls', 'incomeGeneralPanel',
        'incomeStudentFeePanel', 'incomeDate', 'incFeeAcademicYear', 'incFeeStudentSearch',
        'incFeeStudentDropdown', 'incFeeStudentUuid', 'incFeeStudentAdm', 'incFeeSelectedStudentBanner',
        'incFeeMultiMode', 'incFeeHeadsBody', 'incFeeAllocHeader', 'incFeeReceiptNo', 'incFeeAmountGroup',
        'incFeeAmount', 'incFeeMonth', 'incFeeMode', 'incFeeRefGroup', 'incFeeRefNo', 'incFeeRemarks',
        'incFeeValidationPreview', 'incFeeSubmitBtn', 'expModeBtnGeneral', 'expModeBtnFaculty',
        'expenseDate', 'expenseTableBody', 'expenseSubmitAllBtn', 'incomePreview', 'expensePreview',
        'incomeList', 'expenseList', 'transactionList', 'txCountDisplay', 'dashOpening', 'dashIncome',
        'dashExpense', 'dashClosing', 'dashNet', 'dashBankDeposits', 'dashPendingDues', 'dashCount',
        'txFilterType', 'txFilterDateFrom', 'txFilterDateTo', 'txFilterAmountMin', 'txFilterAmountMax',
        'txFilterMainCategory', 'txFilterSubCategory', 'txFilterSearch', 'txSortBy', 'txSortOrder',
        'txFilterShowDeleted', 'feesOverviewTypeBreakdown', 'feesOverviewRecentCollections',
        'assignAcademicYear', 'feeTypesListContainer', 'localStatus', 'dashLastSync', 'incomeOpening',
        'incomeTableBody', 'incomeSubmitAllBtn', 'feesStatusMatrixHeader', 'feesStatusMatrixBody',
        'feesStatusAcademicYear', 'feesStatusClass', 'feesStatusSection', 'feesStatusType',
        'feesStatusMonth', 'feesStatusBalanceFilter', 'feesStatusFilter', 'feesStatusSummary'
    ].forEach(id => ensureEl(id));

    const toasts = [];
    const printCalls = [];

    const windowObj = {
        currentUser: null,
        supabaseClient: null,
        App: { school: { schoolCode: 'DPSS', schoolName: 'Delhi Public Secondary School' } },
        showToast: (msg, type) => toasts.push({ msg, type }),
        print: () => printCalls.push('printed'),
        open: () => ({
            document: { write: () => {}, close: () => {} },
            focus: () => {},
            print: () => {}
        }),
        addEventListener: () => {}
    };
    windowObj.window = windowObj;

    const documentObj = {
        getElementById: (id) => ensureEl(id),
        createElement: (tag) => createMockElement(tag),
        querySelector: (sel) => {
            if (sel && sel.startsWith('#')) return ensureEl(sel.slice(1).split(' ')[0]);
            return createMockElement();
        },
        querySelectorAll: () => [],
        addEventListener: () => {}
    };

    const localStorageObj = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };

    const context = {
        document: documentObj,
        localStorage: localStorageObj,
        navigator: { onLine: true },
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
        Blob: function(parts, opts) { this.parts = parts; this.opts = opts; },
        alert: () => {},
        confirm: () => true,
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        console,
        Date, Math, JSON, Array, Object, Set, Map, Number, String, Boolean, Error, Promise, RegExp, parseFloat, parseInt, isNaN, encodeURIComponent, decodeURIComponent
    };
    Object.assign(context, windowObj);
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    return { context, windowObj: context, documentObj, elements, toasts, printCalls };
}

async function runTests() {
    console.log('======================================================================');
    console.log('FRONTEND & DATASERVICE UNIT TEST SUITE');
    console.log('======================================================================\n');

    const { context, windowObj, documentObj, elements, toasts, printCalls } = buildSandbox();

    // Load real scripts into sandbox
    const dataServiceSrc = fs.readFileSync('dataService.js', 'utf8');
    const facultySrc = fs.readFileSync('faculty.js', 'utf8');
    const appSrc = fs.readFileSync('app.js', 'utf8');

    vm.runInContext(dataServiceSrc, context, { filename: 'dataService.js' });
    vm.runInContext(facultySrc, context, { filename: 'faculty.js' });
    vm.runInContext(appSrc, context, { filename: 'app.js' });

    const origShowToast = windowObj.showToast;
    windowObj.showToast = (msg, type, dur) => {
        toasts.push({ msg, type });
        if (typeof origShowToast === 'function') origShowToast(msg, type, dur);
    };
    context.showToast = windowObj.showToast;

    assert.ok(windowObj.DataService, 'DataService should be attached to window');
    assert.equal(typeof windowObj.DataService.recordStudentFeePayment, 'function');
    assert.equal(typeof windowObj.DataService.recordFacultyExpense, 'function');
    assert.equal(typeof windowObj.getStudentFeeDues, 'function');
    assert.equal(typeof windowObj.renderFeesReports, 'function');
    assert.equal(typeof windowObj.renderFacultyReports, 'function');
    console.log('[PASS] Loaded dataService.js, faculty.js, and app.js cleanly.');

    // ─── TEST 1: DataService Real Auth RPC Success & Failure (NO FAKE SUCCESS) ───
    windowObj.currentUser = { id: 'user-uuid-1', email: 'accountant@dpss.edu' };
    const rpcCalls = [];
    windowObj.supabaseClient = {
        rpc: async (fnName, params) => {
            rpcCalls.push({ fnName, params });
            if (fnName === 'record_student_fee_payment') {
                if (params.p_receipt_number === 'REC-DUP') {
                    return { data: null, error: { message: 'Duplicate receipt number' } };
                }
                return {
                    data: {
                        payment_id: 'fp-uuid-1',
                        transaction_id: 901,
                        student_id: params.p_student_id,
                        amount: params.p_amount,
                        receipt_number: params.p_receipt_number
                    },
                    error: null
                };
            }
            if (fnName === 'record_faculty_expense') {
                if (params.p_voucher_number === 'VCH-FAIL') {
                    return { data: null, error: { message: 'Inactive faculty member' } };
                }
                return {
                    data: {
                        payment_id: 'fep-uuid-1',
                        transaction_id: 902,
                        faculty_id: params.p_faculty_id,
                        amount: params.p_amount,
                        payment_mode: params.p_payment_mode
                    },
                    error: null
                };
            }
            return { data: null, error: null };
        },
        from: (tbl) => {
            const chain = {
                ilike: () => chain,
                eq: () => chain,
                limit: () => chain,
                order: async () => ({ data: null, error: { message: 'DB read forbidden (RLS)' } }),
                maybeSingle: async () => ({
                    data: tbl === 'faculty_expense_categories'
                        ? { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Travel Expense' }
                        : null,
                    error: null
                })
            };
            return { select: () => chain };
        }
    };

    const okFee = await windowObj.DataService.recordStudentFeePayment({
        student_id: 'stu-uuid-1',
        academic_year: '2026-27',
        fee_category_id: 101,
        amount: 4500,
        payment_mode: 'UPI',
        receipt_number: 'REC-5001',
        reference_number: 'UTR-11'
    });
    assert.equal(okFee.transaction_id, 901);
    assert.equal(rpcCalls[0].params.p_payment_mode, 'upi', 'Payment mode should normalize to upi');

    await assert.rejects(
        () => windowObj.DataService.recordStudentFeePayment({
            student_id: 'stu-uuid-1',
            academic_year: '2026-27',
            fee_category_id: 101,
            amount: 4500,
            payment_mode: 'cash',
            receipt_number: 'REC-DUP'
        }),
        /Duplicate receipt number/,
        'Duplicate receipt error must propagate (no fake offline success)'
    );

    const okFac = await windowObj.DataService.recordFacultyExpense({
        faculty_id: 'fac-uuid-1',
        faculty_name: 'Priya Nair',
        employee_id: 'EMP-01',
        expense_category_name: 'Travel Expense',
        payment_date: '2026-11-25',
        voucher_number: 'VCH-2001',
        amount: 2500,
        payment_method: 'Bank Transfer',
        reference_number: 'NEFT-99'
    });
    assert.equal(okFac.transaction_id, 902);
    assert.equal(okFac.payment_mode, 'bank_transfer');

    await assert.rejects(
        () => windowObj.DataService.recordFacultyExpense({
            faculty_id: 'fac-uuid-inactive',
            voucher_number: 'VCH-FAIL',
            amount: 1000
        }),
        /Inactive faculty member/
    );

    // Real auth read failure must throw instead of silently returning []
    await assert.rejects(
        () => windowObj.DataService.getAllFacultyPayments(),
        /DB read forbidden/
    );
    await assert.rejects(
        () => windowObj.DataService.getFacultySalaryHistory('fac-uuid-1'),
        /DB read forbidden/
    );
    console.log('[PASS] DataService authoritative Supabase RPCs & explicit error propagation verified.');

    // ─── TEST 2: Student Dues, Discounts, Overdue & Zero Double-Counting ───
    vm.runInContext(`
        categories = [
            { id: 1, name: 'Fees', parent_id: null, type: 'income' },
            { id: 101, name: 'Tuition', parent_id: 1, type: 'income', frequency: 'Monthly' },
            { id: 102, name: 'Transport', parent_id: 1, type: 'income', frequency: 'Monthly' }
        ];
        students = [
            { id: 'stu-uuid-1', admissionNumber: 'ADM-2026-001', name: 'Aarav Sharma', rollNumber: '12', class: '10', section: 'A', status: 'active' },
            { id: 'stu-uuid-2', admissionNumber: 'ADM-2026-002', name: 'Diya Verma', rollNumber: '04', class: '10', section: 'A', status: 'active' }
        ];
        studentFeeAssignments = [
            { id: 'asg-1', student_id: 'ADM-2026-001', student_uuid: 'stu-uuid-1', academic_year: '2026-27', fee_category_id: 101, assigned_amount: 10000, discount_amount: 1000, due_date: '2025-01-01', remarks: 'Sibling discount' },
            { id: 'asg-2', student_id: 'ADM-2026-001', student_uuid: 'stu-uuid-1', academic_year: '2026-27', fee_category_id: 102, assigned_amount: 4000, discount_amount: 0, due_date: '2099-12-31' },
            { id: 'asg-3', student_id: 'ADM-2026-002', student_uuid: 'stu-uuid-2', academic_year: '2026-27', fee_category_id: 101, assigned_amount: 10000, discount_amount: 0 }
        ];
        feePayments = [
            { id: 'fp-1', transaction_id: 1001, student_id: 'stu-uuid-1', student_admission_number: 'ADM-2026-001', fee_assignment_id: 'asg-1', fee_category_id: 101, academic_year: '2026-27', fee_month: 'April', fee_type: 'Tuition', amount: 4000, payment_date: '2026-11-20', payment_mode: 'upi', receipt_number: 'REC-1001', reference_number: 'UTR-777', remarks: '1st installment' }
        ];
        transactions = [
            { id: 1001, date: '2026-11-20', type: 'income', mainCategory: 'Fees', subCategory: 'Tuition', amount: 4000, reference: 'REC-1001', academicYear: '2026-27', feeMonth: 'April', studentId: 'stu-uuid-1', paymentMode: 'upi', student: students[0], isDeleted: false },
            { id: 1002, date: '2026-11-21', type: 'income', mainCategory: 'Fees', subCategory: 'Tuition', amount: 5000, reference: 'REC-1002', academicYear: '2026-27', feeMonth: 'May', studentId: 'stu-uuid-1', paymentMode: 'cash', student: students[0], isDeleted: true }
        ];
    `, context);

    const aarav = vm.runInContext('students[0]', context);
    const dues = windowObj.getStudentFeeDues(aarav, '2026-27');
    const tuitionDues = dues.filter(d => d.fee_type === 'Tuition');
    const transportDues = dues.filter(d => d.fee_type === 'Transport');

    const tuitionPaid = tuitionDues.reduce((s, d) => s + d.paid_amount, 0);
    const tuitionBalance = tuitionDues.reduce((s, d) => s + d.due_amount, 0);
    assert.equal(tuitionPaid, 4000, 'Paid must count tx 1001 once (not double-counted and ignoring soft-deleted tx 1002)');
    assert.equal(tuitionBalance, 5000, 'Net 9000 (10000 - 1000 discount) minus 4000 paid must equal 5000 due');
    assert.equal(tuitionDues.some(d => d.is_overdue), true, 'Past due_date with unpaid balance must flag overdue');
    assert.equal(transportDues.reduce((s, d) => s + d.due_amount, 0), 4000, 'Transport full 4000 should remain due');
    console.log('[PASS] Fee dues discount math, overdue detection, soft-delete exclusion & zero double-counting verified.');

    // ─── TEST 3: Fee Receipt Generation, Metadata & Reprint Protection ───
    printCalls.length = 0;
    windowObj.printReceiptForTransaction(1001);
    const containerHtml1 = elements.get('receiptPrintContainer').innerHTML;
    assert.ok(containerHtml1.includes('REC-1001'), 'Receipt should include receipt number');
    assert.ok(containerHtml1.includes('ADM-2026-001'), 'Receipt should include admission number');
    assert.ok(containerHtml1.includes('UPI: UTR-777'), 'Receipt should include payment mode & ref');
    assert.ok(containerHtml1.includes('Remaining Balance:'), 'Receipt should include balance summary');
    assert.ok(!containerHtml1.includes('REPRINT'), 'First print must not display REPRINT badge');

    windowObj.printReceiptForTransaction(1001);
    const containerHtml2 = elements.get('receiptPrintContainer').innerHTML;
    assert.ok(containerHtml2.includes('REPRINT'), 'Second print should mark receipt as REPRINT');

    printCalls.length = 0;
    windowObj.printReceiptForTransaction(1002); // Soft-deleted tx
    assert.equal(printCalls.length, 0, 'Soft-deleted transaction must not trigger receipt printing');
    console.log('[PASS] Student fee receipt rendering, balance fields, REPRINT badge & deleted tx guard verified.');

    // ─── TEST 4: Faculty Salary-Only Report & Dashboard Metrics Separation ───
    const todayPrefix = new Date().toISOString().slice(0, 7);
    const todayDate = new Date().toISOString().slice(0, 10);
    const mockFacultyList = [
        { id: 'fac-1', employee_id: 'EMP-01', name: 'Priya Nair', department: 'Mathematics', designation: 'Senior Teacher', base_salary: 50000, status: 'active' }
    ];
    const mockFacultyPayments = [
        { id: 'p-1', faculty_id: 'fac-1', employee_id: 'EMP-01', faculty_name: 'Priya Nair', department: 'Mathematics', expense_category: 'Salary', payment_date: todayDate, amount: 30000, payment_mode: 'bank_transfer', voucher_number: 'VCH-1001' },
        { id: 'p-2', faculty_id: 'fac-1', employee_id: 'EMP-01', faculty_name: 'Priya Nair', department: 'Mathematics', expense_category: 'Travel Expense', payment_date: todayDate, amount: 15000, payment_mode: 'cash', voucher_number: 'VCH-1002' },
        { id: 'p-3', faculty_id: 'fac-1', employee_id: 'EMP-01', faculty_name: 'Priya Nair', department: 'Mathematics', expense_category: 'Advance Salary', payment_date: todayDate, amount: 10000, payment_mode: 'upi', voucher_number: 'VCH-1003' }
    ];

    windowObj.DataService.getFaculty = async () => mockFacultyList;
    windowObj.DataService.getAllFacultyPayments = async () => mockFacultyPayments;

    // Dashboard metrics must ONLY count Salary (30,000), leaving 20,000 Pending Salary (NOT counting 15k travel + 10k advance!)
    await windowObj.updateDashboardFacultyMetrics(100000);
    assert.equal(elements.get('dashFacultyCommitted').textContent, '₹50,000.00');
    assert.equal(elements.get('dashFacultyDisbursed').textContent, '₹30,000.00', 'Dashboard salary disbursed must exclude travel & advance');
    assert.equal(elements.get('dashFacultyPending').textContent, '₹20,000.00', 'Pending salary must remain 20,000');

    // Sync faculty.js internal currentFacultyList by calling initFacultyTab if available or testing all 10 report types
    windowObj.DataService.getFaculty = async () => mockFacultyList;
    if (typeof windowObj.loadFaculty === 'function') {
        await windowObj.loadFaculty();
    }
    elements.get('facultyReportMonthSelect').value = todayPrefix;
    elements.get('facultyReportDeptSelect').value = 'all';
    elements.get('facultyReportStatusSelect').value = 'all';

    // Salary Register report -> Salary only (₹30,000)
    elements.get('facultyReportTypeSelect').value = 'salary-register';
    await windowObj.renderFacultyReports();
    assert.equal(elements.get('reportKpiDisbursed').textContent, '₹30,000.00');
    assert.equal(elements.get('reportKpiPending').textContent, '₹20,000.00');

    // Travel Report -> Travel only (₹15,000)
    elements.get('facultyReportTypeSelect').value = 'travel-report';
    await windowObj.renderFacultyReports();
    assert.equal(elements.get('reportKpiDisbursed').textContent, '₹15,000.00');

    // Advance Salary Report -> Advance only (₹10,000)
    elements.get('facultyReportTypeSelect').value = 'advance-report';
    await windowObj.renderFacultyReports();
    assert.equal(elements.get('reportKpiDisbursed').textContent, '₹10,000.00');

    // Faculty-wise Total Report -> Grand Total (30k + 15k + 10k = ₹55,000)
    elements.get('facultyReportTypeSelect').value = 'faculty-total';
    await windowObj.renderFacultyReports();
    assert.equal(elements.get('reportKpiDisbursed').textContent, '₹55,000.00');

    // Salary vs Non-Salary report -> Salary 30k, Advance 10k, Other 15k
    elements.get('facultyReportTypeSelect').value = 'salary-vs-nonsalary';
    await windowObj.renderFacultyReports();
    assert.ok(elements.get('facultyReportsTableBody').innerHTML.includes('30,000'));
    assert.ok(elements.get('facultyReportsTableBody').innerHTML.includes('15,000'));
    assert.ok(elements.get('facultyReportsTableBody').innerHTML.includes('10,000'));

    // Error state distinction when DB read throws
    windowObj.DataService.getAllFacultyPayments = async () => { throw new Error('Permission denied (42501)'); };
    await windowObj.renderFacultyReports();
    assert.ok(elements.get('facultyReportsTableBody').innerHTML.includes('Database error loading report'), 'Error state must render distinct DB error banner');

    console.log('[PASS] Faculty Salary-only report separation, non-salary isolation, and DB error states verified.');

    // Verify explicit error toast on blocked deleted receipt print
    assert.ok(toasts.some(t => t.type === 'error'), 'Expected explicit error toast on blocked deleted receipt print');

    // ─── TEST 5: Fee Reports Rendering & Balance Filtering ───
    elements.get('reportsAcademicYear').value = '2026-27';
    elements.get('reportsClass').value = '';
    elements.get('reportsSection').value = '';
    elements.get('reportsCategory').value = '';

    elements.get('reportsSelectType').value = 'defaulters';
    windowObj.renderFeesReports();
    assert.ok(elements.get('feesReportsStatusBanner').textContent.includes('2 student(s)'), 'Defaulters report should find 2 students with pending dues');
    const defaultersHtml = elements.get('feesReportsBody').children.map(c => c.innerHTML).join('');
    assert.ok(defaultersHtml.includes('ADM-2026-001'));

    elements.get('reportsSelectType').value = 'partial-payments';
    windowObj.renderFeesReports();
    assert.ok(elements.get('feesReportsStatusBanner').textContent.includes('1 student(s)'), 'Only Aarav has partial payment (4k paid / 13k net)');

    elements.get('reportsSelectType').value = 'student-history';
    windowObj.renderFeesReports();
    assert.ok(elements.get('feesReportsStatusBanner').textContent.includes('1 payment(s)'), 'Student history must exclude soft-deleted tx 1002');
    console.log('[PASS] Fee reports (defaulters, partial-payments, student-history) verified.');

    // ─── TEST 6: Integrated Income Student Fee Mode & Real-Time Reflection ───
    vm.runInContext("currentUser = window.currentUser = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@school.local' };", context);
    windowObj.switchIncomeEntryMode('student-fee');
    assert.equal(elements.get('incomeStudentFeePanel').style.display, 'block');
    assert.equal(elements.get('incomeGeneralPanel').style.display, 'none');

    // Select Aarav (ADM-2026-001 -> remaining Tuition 5000, Transport 4000)
    windowObj.selectCollectFeeStudent('ADM-2026-001', 'incFee');
    assert.equal(elements.get('incFeeStudentUuid').value, 'stu-uuid-1');
    elements.get('incomeDate').value = '2026-11-26';
    elements.get('incFeeAcademicYear').value = '2026-27';
    elements.get('incFeeMode').value = 'upi';
    elements.get('incFeeRefNo').value = 'UPI-9988';
    elements.get('incFeeReceiptNo').value = 'REC-9001';
    elements.get('incFeeRemarks').value = 'Real-time Tuition collection via Income tab';

    // Simulate checked radio for Tuition (cat 101, bal 5000)
    const origQuerySelector = documentObj.querySelector;
    documentObj.querySelector = (sel) => {
        if (sel === 'input[name="incFeeHeadChoice"]:checked') {
            return { dataset: { catId: '101', bal: '5000.00' } };
        }
        return origQuerySelector(sel);
    };
    elements.get('incFeeAmount').value = '3000';
    printCalls.length = 0;

    elements.get('feesStatusBalanceFilter').value = 'all';
    elements.get('feesStatusFilter').value = 'all';
    await windowObj.submitIncomeFeeCollection();

    const txsAfter = vm.runInContext('transactions', context);
    const matchingRec9001 = txsAfter.filter(t => t.reference === 'REC-9001');
    assert.equal(matchingRec9001.length, 1, 'Exactly one central income transaction should exist for REC-9001');
    assert.equal(matchingRec9001[0].studentId, 'stu-uuid-1');
    assert.equal(matchingRec9001[0].bankAmount, 3000, 'UPI payment should increase Bank Deposits by ₹3,000');

    const duesAfter = windowObj.getStudentFeeDues(aarav, '2026-27');
    const aaravRemaining = duesAfter.reduce((s, d) => s + d.due_amount, 0);
    assert.equal(aaravRemaining, 6000, 'Aarav balance must decrease from 9000 to 6000 (Tuition 2000 + Transport 4000)');
    assert.equal(elements.get('dashBankDeposits').textContent, '3000.00', 'Dashboard Bank Deposits must reflect ₹3,000 immediately');
    assert.equal(printCalls.length, 1, 'Receipt should auto-print once on successful collection');

    // Verify Student Fee Status matrix updated in real time to Partially Paid (even with overdue due_date)
    const statusRowsHtml = elements.get('feesStatusMatrixBody').children.map(r => r.innerHTML).join('');
    assert.ok(statusRowsHtml.includes('ADM-2026-001'), 'Student Fee Status must render Aarav in real time');
    assert.ok(statusRowsHtml.includes('Partially Paid'), 'Partial payment must update status to Partially Paid in real time');
    assert.ok(statusRowsHtml.includes('₹7000/₹9000'), 'Tuition column must show updated partial amount ₹7000/₹9000');

    // Duplicate receipt check
    elements.get('incFeeReceiptNo').value = 'REC-9001';
    elements.get('incFeeAmount').value = '1000';
    elements.get('feesStatusBalanceFilter').value = 'all';
    elements.get('feesStatusFilter').value = 'all';
    await windowObj.submitIncomeFeeCollection();
    assert.equal(vm.runInContext('transactions', context).filter(t => t.reference === 'REC-9001').length, 1, 'Duplicate receipt submission must be blocked');

    // Overpayment check
    elements.get('incFeeReceiptNo').value = 'REC-9002';
    elements.get('incFeeAmount').value = '9999';
    elements.get('feesStatusBalanceFilter').value = 'all';
    elements.get('feesStatusFilter').value = 'all';
    await windowObj.submitIncomeFeeCollection();
    assert.equal(vm.runInContext('transactions', context).filter(t => t.reference === 'REC-9002').length, 0, 'Overpayment above head balance must be blocked');

    // Expense mode toggle state check + subcategory deduplication check
    vm.runInContext(`
        window.facultyExpenseCategoriesCache = [
            { id: '1', parent_id: 'p', name: 'Travel Expense', is_active: true },
            { id: '2', parent_id: 'p', name: 'travel expense', is_active: true },
            { id: '3', parent_id: 'p', name: 'Salary', is_active: true },
            { id: '4', parent_id: 'p', name: 'Gifts / Goodies', is_active: true },
            { id: '5', parent_id: 'p', name: 'Salary', is_active: true }
        ];
    `, context);
    const facListDeduped = vm.runInContext('getFacultyExpenseCategoryList()', context);
    assert.equal(facListDeduped.length, 3, 'Duplicate faculty subcategories must be deduplicated');
    assert.equal(facListDeduped[0].name, 'Salary', 'Canonical ordering must place Salary first');

    await windowObj.switchExpenseEntryMode('faculty');
    assert.ok(elements.get('expModeBtnFaculty').classList.contains('active'));
    assert.equal(elements.get('expModeBtnGeneral').classList.contains('active'), false);
    documentObj.querySelector = origQuerySelector;
    console.log('[PASS] Integrated Income Student Fee Collection, Balance Reflection, Overpayment & Duplicate guards verified.');

    console.log('\n======================================================================');
    console.log('ALL FRONTEND & DATASERVICE UNIT TESTS PASSED!');
    console.log('======================================================================');
}

runTests().catch(err => {
    console.error('❌ UNIT TEST FAILED:', err);
    process.exit(1);
});
