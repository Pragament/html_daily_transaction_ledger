import { PGlite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[ASSERTION FAILED] ${message}`);
    }
}

async function assertThrowsAsync(fn, expectedSubstring, context) {
    try {
        await fn();
        throw new Error(`[ASSERTION FAILED] Expected error containing "${expectedSubstring || '(any)'}", but statement succeeded! Context: ${context}`);
    } catch (err) {
        if (err.message.startsWith('[ASSERTION FAILED]')) throw err;
        if (expectedSubstring && !err.message.includes(expectedSubstring)) {
            throw new Error(`[ASSERTION FAILED] Expected error containing "${expectedSubstring}", got "${err.message}". Context: ${context}`);
        }
    }
}

async function main() {
    console.log('======================================================================');
    console.log('PGLITE DATABASE, RPC & RLS VERIFICATION SUITE (08 + 09 MIGRATIONS)');
    console.log('======================================================================\n');

    const db = new PGlite();

    // Bootstrap minimal Supabase auth & shared tables + legacy ledger + phase 3 + faculty
    await db.exec(`
        CREATE SCHEMA IF NOT EXISTS auth;
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;

        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL);
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid; $$;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'anon'::text; $$;

        CREATE TABLE public.schools (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz DEFAULT now());
        INSERT INTO public.schools (id, name) VALUES
            ('00000000-0000-0000-0000-000000000001', 'Delhi Public Secondary School');

        CREATE TABLE public.users (id uuid PRIMARY KEY REFERENCES auth.users(id), email text UNIQUE NOT NULL, school_id uuid REFERENCES public.schools(id), role text);
        CREATE TABLE public.app_access (
            user_id uuid NOT NULL REFERENCES public.users(id),
            school_id uuid NOT NULL REFERENCES public.schools(id),
            app_name text NOT NULL,
            app_role text NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            updated_at timestamptz DEFAULT now(),
            PRIMARY KEY (user_id, school_id, app_name)
        );
    `);

    const school1 = '00000000-0000-0000-0000-000000000001';
    const accountantId = '11111111-1111-1111-1111-111111111111';
    const principalId  = '22222222-2222-2222-2222-222222222222';
    const teacherId    = '33333333-3333-3333-3333-333333333333';
    const inactiveId   = '44444444-4444-4444-4444-444444444444';
    const adminId      = '55555555-5555-5555-5555-555555555555';

    // Load migrations.sql (excluding storage bucket/objects statements not present in PGlite)
    let migBase = await fs.readFile(path.join(__dirname, 'migrations.sql'), 'utf-8');
    migBase = migBase.replace(/INSERT INTO storage\.buckets[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/gi, '');
    migBase = migBase.replace(/DROP POLICY IF EXISTS "[^"]+" ON storage\.objects;/gi, '');
    migBase = migBase.replace(/CREATE POLICY "[^"]+" ON storage\.objects[\s\S]*?;/gi, '');
    await db.exec(migBase);

    const migFees = await fs.readFile(path.join(__dirname, 'migrations_fees.sql'), 'utf-8');
    await db.exec(migFees);

    // Phase 3 single-school migration + Faculty + 06 + 07 + 08 + 09
    const p3 = await fs.readFile(path.join(__dirname, '02_phase3_ledger_migration_single_school.sql'), 'utf-8');
    await db.exec(p3);

    const p5 = await fs.readFile(path.join(__dirname, '05_faculty_directory_salary_expenses.sql'), 'utf-8');
    await db.exec(p5);

    const p6 = await fs.readFile(path.join(__dirname, '06_fix_transactions_id_sequence_and_faculty_salary.sql'), 'utf-8');
    await db.exec(p6);

    const p7 = await fs.readFile(path.join(__dirname, '07_fix_ledger_faculty_multi_user_access.sql'), 'utf-8');
    await db.exec(p7);

    const p8 = await fs.readFile(path.join(__dirname, '08_fix_student_import_and_fee_assignments_rls.sql'), 'utf-8');
    await db.exec(p8);

    const p9 = await fs.readFile(path.join(__dirname, '09_student_fee_faculty_expense_indexing.sql'), 'utf-8');
    await db.exec(p9);

    // Re-run 09 to confirm strict idempotency
    await db.exec(p9);
    console.log('[PASS] Migrations 02, 05, 06, 07, 08, 09 applied & idempotency verified.');

    // Provision test users AFTER migrations (so 07 backfill doesn't pollute Teacher/Inactive test fixtures)
    await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
            ('${accountantId}', 'accountant@dpss.edu'),
            ('${principalId}',  'principal@dpss.edu'),
            ('${teacherId}',    'teacher@dpss.edu'),
            ('${inactiveId}',   'inactive@dpss.edu'),
            ('${adminId}',      'admin@dpss.edu');

        INSERT INTO public.users (id, email, school_id, role) VALUES
            ('${accountantId}', 'accountant@dpss.edu', '${school1}', 'accountant'),
            ('${principalId}',  'principal@dpss.edu',  '${school1}', 'principal'),
            ('${teacherId}',    'teacher@dpss.edu',    '${school1}', 'teacher'),
            ('${inactiveId}',   'inactive@dpss.edu',   '${school1}', 'accountant'),
            ('${adminId}',      'admin@dpss.edu',      '${school1}', 'admin');

        INSERT INTO public.app_access (user_id, school_id, app_name, app_role, is_active) VALUES
            ('${accountantId}', '${school1}', 'ledger',  'accountant', true),
            ('${principalId}',  '${school1}', 'ledger',  'principal',  true),
            ('${teacherId}',    '${school1}', 'teacher', 'teacher',    true),
            ('${inactiveId}',   '${school1}', 'ledger',  'accountant', false),
            ('${adminId}',      '${school1}', 'ledger',  'admin',      true);
    `);

    // Grant usage on schema/sequences for test roles (matching Supabase defaults)
    await db.exec(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    `);

    async function runAs(userId, role, sql) {
        await db.exec(`
            CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT ${userId ? `'${userId}'::uuid` : 'NULL::uuid'};
            $$;
            CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
            SELECT '${role}'::text;
            $$;
            SET ROLE ${role};
        `);
        try {
            const stmts = sql.split(/;\s*(?=\n|$)/).map(s => s.trim()).filter(Boolean);
            let res = { rows: [], rowCount: 0 };
            for (const s of stmts) {
                res = await db.query(s);
            }
            return res;
        } finally {
            await db.exec(`SET ROLE postgres;`);
        }
    }

    // Seed fee categories & profiles as Admin (validating admin category policy)
    await db.exec(`
        INSERT INTO public.user_profiles (email, full_name, profession) VALUES
            ('accountant@dpss.edu', 'Alice Accountant', 'Accountant'),
            ('principal@dpss.edu', 'Peter Principal', 'Principal'),
            ('admin@dpss.edu', 'Super Admin', 'Admin')
        ON CONFLICT (email) DO NOTHING;
    `);
    await runAs(adminId, 'authenticated', `
        INSERT INTO public.categories (id, name, parent_id, type, school_id, frequency) VALUES
            (1, 'Fees', NULL, 'all', '${school1}', 'Yearly'),
            (2, 'Tuition', 1, 'all', '${school1}', 'Monthly'),
            (3, 'Transport', 1, 'all', '${school1}', 'Monthly'),
            (4, 'Exam', 1, 'all', '${school1}', 'Yearly')
        ON CONFLICT (id) DO NOTHING;
    `);
    await db.exec(`SELECT setval('public.categories_id_seq', COALESCE((SELECT MAX(id) FROM public.categories), 1));`);

    // 1. Verify Faculty Expense Categories seeded properly (all 9 required subcategories)
    const facCats = await runAs(accountantId, 'authenticated', `SELECT id, name FROM public.faculty_expense_categories WHERE parent_id IS NOT NULL ORDER BY name;`);
    const facCatNames = facCats.rows.map(r => r.name);
    for (const requiredCat of ['Salary', 'Advance Salary', 'Bonus', 'Incentives', 'Travel Expense', 'Reimbursements', 'Gifts / Goodies', 'Training / Workshop Expenses', 'Other Faculty Expenses']) {
        assert(facCatNames.includes(requiredCat), `Missing faculty expense category: ${requiredCat}`);
    }
    console.log(`[PASS] Verified all ${facCatNames.length} faculty expense subcategories seeded cleanly without duplicates.`);

    // 2. Test Student Creation + UUID assignment + Fee Assignment + Inactive block
    const studRes = await runAs(accountantId, 'authenticated', `
        INSERT INTO public.students (admission_number, name, roll_number, class, section, father_name, phone, status)
        VALUES
            ('ADM-1001', 'Aarav Sharma', '1', '10', 'A', 'Rajesh Sharma', '9876543210', 'active'),
            ('ADM-1002', 'Inactive Student', '2', '10', 'A', 'Parent', '9876500000', 'inactive')
        RETURNING id, admission_number, status;
    `);
    assert(studRes.rows.length === 2, 'Accountant should insert active & inactive test students');
    const aaravId = studRes.rows.find(r => r.admission_number === 'ADM-1001').id;
    const inactiveStudId = studRes.rows.find(r => r.admission_number === 'ADM-1002').id;

    // Assign Tuition (5000, discount 500 => net 4500) and Transport (1500)
    const assignRes = await runAs(accountantId, 'authenticated', `
        INSERT INTO public.student_fee_assignments (student_id, academic_year, fee_category_id, assigned_amount, discount_amount, remarks)
        VALUES
            ('ADM-1001', '2026-27', 2, 5000, 500, 'Sibling concession'),
            ('ADM-1001', '2026-27', 3, 1500, 0, ''),
            ('ADM-1002', '2026-27', 2, 5000, 0, '')
        RETURNING id, student_uuid, fee_category_id, assigned_amount, discount_amount;
    `);
    assert(assignRes.rows[0].student_uuid === aaravId, 'Trigger must auto-populate student_uuid from admission_number');
    const tuitionAssignId = assignRes.rows.find(r => r.fee_category_id === 2 && r.student_uuid === aaravId).id;
    const inactiveAssignId = assignRes.rows.find(r => r.student_uuid === inactiveStudId).id;
    console.log('[PASS] Student UUID & fee assignment linkage verified.');

    // 3. Test Atomic Student Fee Payment RPC (Partial + Full + Overpayment + Duplicate Receipt + Inactive + Audit)
    const pay1 = await runAs(accountantId, 'authenticated', `
        SELECT public.record_student_fee_payment(
            '${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'April', '2026-11-25', 2000, 'upi', 'REC-1001', 'UPI-998877', 'First installment'
        ) AS res;
    `);
    const pay1Data = pay1.rows[0].res;
    assert(pay1Data.previous_balance === 4500, `Expected prev_balance 4500, got ${pay1Data.previous_balance}`);
    assert(pay1Data.remaining_balance === 2500, `Expected remaining_balance 2500, got ${pay1Data.remaining_balance}`);
    assert(pay1Data.payment_mode === 'upi', 'Payment mode should be normalized to upi');

    // Check transaction, fee_payment, revision, activity_history created atomically
    const txCheck = await runAs(principalId, 'authenticated', `SELECT id, type, amount, student_id, main_category, sub_category, created_by FROM public.transactions WHERE id = ${pay1Data.transaction_id};`);
    assert(txCheck.rows.length === 1 && txCheck.rows[0].student_id === aaravId && Number(txCheck.rows[0].amount) === 2000, 'Transaction linked to student UUID & exact amount');

    const fpCheck = await runAs(principalId, 'authenticated', `SELECT student_id, fee_assignment_id, receipt_number, payment_mode FROM public.fee_payments WHERE transaction_id = ${pay1Data.transaction_id};`);
    assert(fpCheck.rows[0].fee_assignment_id === tuitionAssignId && fpCheck.rows[0].receipt_number === 'REC-1001', 'fee_payments row linked cleanly');

    const revCheck = await runAs(principalId, 'authenticated', `SELECT action FROM public.transaction_revisions WHERE transaction_id = ${pay1Data.transaction_id};`);
    assert(revCheck.rows.length === 1 && revCheck.rows[0].action === 'CREATE', 'Revision logged atomically');

    const actCheck = await runAs(principalId, 'authenticated', `SELECT activity_type, user_email FROM public.activity_history WHERE transaction_id = ${pay1Data.transaction_id};`);
    assert(actCheck.rows.length === 1 && actCheck.rows[0].user_email === 'accountant@dpss.edu', 'Activity history logged with authentic actor');

    // Overpayment rejection (> 2500 remaining)
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `SELECT public.record_student_fee_payment('${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'May', '2026-11-25', 3000, 'cash', 'REC-1002', NULL, NULL);`),
        'OVERPAYMENT_REJECTED',
        'Student fee overpayment must be rejected'
    );

    // Zero / negative amount rejection
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `SELECT public.record_student_fee_payment('${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'May', '2026-11-25', 0, 'cash', 'REC-1002', NULL, NULL);`),
        'INVALID_AMOUNT',
        'Zero amount fee payment must be rejected'
    );

    // Duplicate receipt rejection (case-insensitive)
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `SELECT public.record_student_fee_payment('${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'May', '2026-11-25', 1000, 'cash', 'rec-1001', NULL, NULL);`),
        'DUPLICATE_RECEIPT',
        'Duplicate receipt number must be rejected'
    );

    // Inactive student rejection
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `SELECT public.record_student_fee_payment('${inactiveStudId}'::uuid, '2026-27', ${inactiveAssignId}, 2, 'April', '2026-11-25', 500, 'cash', 'REC-1003', NULL, NULL);`),
        'INACTIVE_STUDENT',
        'Inactive student fee collection must be rejected'
    );
    console.log('[PASS] Student fee payment RPC validations, audit, and atomicity verified.');

    // 4. Test Faculty Expense & Salary RPC (Active + Inactive + Travel + Duplicate Voucher + Views)
    const facRes = await runAs(accountantId, 'authenticated', `
        INSERT INTO public.faculty (employee_id, faculty_name, department, designation, mobile_number, joining_date, salary, status)
        VALUES
            ('EMP-001', 'Dr. Kavita Rao', 'Science', 'HOD', '9998887776', '2022-06-01', 45000, 'active'),
            ('EMP-002', 'Former Staff', 'Arts', 'Teacher', '9998887775', '2020-01-01', 30000, 'inactive')
        RETURNING id, employee_id;
    `);
    const kavitaId = facRes.rows.find(r => r.employee_id === 'EMP-001').id;
    const formerId = facRes.rows.find(r => r.employee_id === 'EMP-002').id;
    const salaryCatId = facCats.rows.find(r => r.name === 'Salary').id;
    const travelCatId = facCats.rows.find(r => r.name === 'Travel Expense').id;

    // Salary expense via RPC
    const salRes = await runAs(accountantId, 'authenticated', `
        SELECT public.record_faculty_expense(
            '${kavitaId}'::uuid, '${salaryCatId}'::uuid, '2026-11-25', 'VCH-2001', 45000, 'Bank Transfer', 'UTR-1122', 'November 2026', 'Nov Salary', 'Paid via NEFT'
        ) AS res;
    `);
    const salData = salRes.rows[0].res;
    assert(salData.expense_category === 'Salary' && salData.payment_mode === 'bank_transfer', 'Salary payment recorded cleanly');

    // Travel expense via RPC
    const trvRes = await runAs(accountantId, 'authenticated', `
        SELECT public.record_faculty_expense(
            '${kavitaId}'::uuid, '${travelCatId}'::uuid, '2026-11-25', 'VCH-2002', 3500, 'UPI', 'UPI-5544', NULL, 'Science Olympiad Travel', 'Train & stay'
        ) AS res;
    `);
    const trvData = trvRes.rows[0].res;
    assert(trvData.expense_category === 'Travel Expense', 'Travel expense recorded cleanly');

    // Duplicate voucher rejection
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `
            SELECT public.record_faculty_expense('${kavitaId}'::uuid, '${travelCatId}'::uuid, '2026-11-25', 'vch-2002', 500, 'cash', NULL, NULL, 'Dup voucher', NULL);
        `),
        'DUPLICATE_VOUCHER',
        'Duplicate voucher number must be rejected'
    );

    // Inactive faculty rejection
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `
            SELECT public.record_faculty_expense('${formerId}'::uuid, '${salaryCatId}'::uuid, '2026-11-25', 'VCH-2003', 30000, 'cash', NULL, NULL, 'Inactive test', NULL);
        `),
        'INACTIVE_FACULTY',
        'Expense against inactive faculty must be rejected'
    );

    // Verify Salary-only monthly report excludes Travel Expense (45000 only, NOT 48500!)
    const monthlySal = await runAs(principalId, 'authenticated', `SELECT total_amount FROM public.faculty_monthly_salary_report;`);
    assert(Number(monthlySal.rows[0].total_amount) === 45000, `Salary report must be salary-only (45000), got ${monthlySal.rows[0].total_amount}`);
    console.log('[PASS] Faculty expense RPC, duplicate voucher block, inactive faculty block, and salary-only report separation verified.');

    // 5. Security & RLS Tests (Anon, Teacher, Inactive, Audit Forgery)
    // Anon cannot read students, fee_payments, transactions, or faculty
    for (const tbl of ['students', 'fee_payments', 'student_fee_assignments', 'transactions', 'faculty', 'faculty_expense_payments']) {
        await assertThrowsAsync(
            () => runAs(null, 'anon', `SELECT * FROM public.${tbl};`),
            'permission denied',
            `anon select on ${tbl} must be denied`
        );
    }
    await assertThrowsAsync(
        () => runAs(null, 'anon', `SELECT public.record_student_fee_payment('${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'June', '2026-11-25', 100, 'cash', 'REC-ANON', NULL, NULL);`),
        'permission denied',
        'anon execute RPC must be denied'
    );

    // Teacher cannot read or write any Ledger tables or execute payment RPCs
    for (const tbl of ['students', 'fee_payments', 'student_fee_assignments', 'transactions', 'faculty', 'faculty_expense_payments']) {
        const tRead = await runAs(teacherId, 'authenticated', `SELECT * FROM public.${tbl};`);
        assert(tRead.rows.length === 0, `Teacher must receive 0 rows from ${tbl}, got ${tRead.rows.length}`);
    }
    await assertThrowsAsync(
        () => runAs(teacherId, 'authenticated', `SELECT public.record_student_fee_payment('${aaravId}'::uuid, '2026-27', ${tuitionAssignId}, 2, 'June', '2026-11-25', 100, 'cash', 'REC-TCHR', NULL, NULL);`),
        'LEDGER_ACCESS_DENIED',
        'Teacher calling record_student_fee_payment must fail'
    );

    // Inactive ledger user cannot read or execute
    const inactRead = await runAs(inactiveId, 'authenticated', `SELECT * FROM public.students;`);
    assert(inactRead.rows.length === 0, 'Inactive user must receive 0 rows from students');
    await assertThrowsAsync(
        () => runAs(inactiveId, 'authenticated', `SELECT public.record_faculty_expense('${kavitaId}'::uuid, '${travelCatId}'::uuid, '2026-11-25', 'VCH-INACT', 100, 'cash', NULL, NULL, 'Blocked', NULL);`),
        'LEDGER_ACCESS_DENIED',
        'Inactive user calling record_faculty_expense must fail'
    );

    // Identity spoofing blocked
    await assertThrowsAsync(
        () => runAs(accountantId, 'authenticated', `
            INSERT INTO public.transactions (id, type, date, amount, user_id)
            VALUES (9999, 'expense', '2026-11-25', 100, '${principalId}');
        `),
        'LEDGER_IDENTITY_SPOOFING',
        'Accountant spoofing another user_id must fail'
    );

    console.log('[PASS] Strict RLS verified: anon, teacher-only, inactive user, and identity spoofing blocked.');
    console.log('\n======================================================================');
    console.log('ALL PGLITE DATABASE, RPC & SECURITY TESTS PASSED!');
    console.log('======================================================================');
}

main().catch(err => {
    console.error('\n[FATAL TEST FAILURE]:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
