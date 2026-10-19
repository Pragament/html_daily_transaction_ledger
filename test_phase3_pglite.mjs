import { PGlite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactsDir = path.resolve(__dirname, '..');

// Strict assertion utilities that abort test run immediately on failure
function assert(condition, message) {
    if (!condition) {
        console.error(`\n[ASSERTION FAILED] ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function assertThrowsAsync(fn, expectedSubstring, context) {
    try {
        await fn();
        throw new Error(`[ASSERTION FAILED] Expected error containing "${expectedSubstring}", but statement succeeded! Context: ${context}`);
    } catch (err) {
        if (err.message.startsWith('[ASSERTION FAILED]')) throw err;
        if (expectedSubstring && !err.message.includes(expectedSubstring)) {
            throw new Error(`[ASSERTION FAILED] Expected error containing "${expectedSubstring}", but received: "${err.message}". Context: ${context}`);
        }
        console.log(`     [PASS] Correctly rejected: "${err.message.split('\n')[0]}"`);
    }
}

async function main() {
    console.log('================================================================');
    console.log('STARTING HARDENED PHASE 3 RLS & SECURITY TEST HARNESS');
    console.log('================================================================\n');

    const db = new PGlite();

    // 1. Setup Phase 0 Mock Schema
    console.log('[Step 1] Loading Phase 0 Mock Database Schema...');
    const mockSqlPath = path.join(__dirname, 'mock_schema.sql');
    let mockSql = await fs.readFile(mockSqlPath, 'utf-8');
    await db.exec(mockSql);
    console.log('[OK] Mock database schema loaded.');

    // 2. Add Legacy Ledger Schema (from migrations.sql & migrations_fees.sql)
    console.log('\n[Step 2] Injecting Legacy Ledger Tables & Sample Records...');
    const legacyLedgerSql = `
        CREATE TABLE IF NOT EXISTS public.categories (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES public.categories(id) ON DELETE CASCADE,
            type TEXT CHECK (type IN ('income', 'expense', 'all')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            frequency TEXT DEFAULT 'Yearly',
            UNIQUE (name, parent_id)
        );

        CREATE TABLE IF NOT EXISTS public.tags (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.transactions (
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
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_by TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            deleted_by TEXT,
            is_deleted BOOLEAN DEFAULT FALSE,
            bank_amount NUMERIC DEFAULT 0,
            cheque_count INTEGER DEFAULT 0,
            attachments JSONB DEFAULT '[]'::jsonb
        );

        CREATE TABLE IF NOT EXISTS public.transaction_revisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_id INTEGER NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
            action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE')),
            old_values JSONB,
            new_values JSONB,
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.activity_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            timestamp TIMESTAMPTZ DEFAULT NOW(),
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

        CREATE TABLE IF NOT EXISTS public.user_profiles (
            email TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            profession TEXT NOT NULL,
            firebase_uid TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public.fee_structures (
            id SERIAL PRIMARY KEY,
            academic_year TEXT NOT NULL,
            class TEXT NOT NULL,
            fee_type TEXT NOT NULL,
            amount NUMERIC NOT NULL,
            frequency TEXT NOT NULL CHECK (frequency IN ('Monthly', 'Yearly', 'One-Time')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (academic_year, class, fee_type)
        );

        ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS transaction_id INTEGER;
        
        -- Insert initial baseline records
        INSERT INTO public.categories (id, name, parent_id, type) VALUES 
        (1, 'Academic Fees', null, 'income'),
        (2, 'Tuition Fee', 1, 'income'),
        (3, 'Office Expenses', null, 'expense')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.tags (id, name) VALUES (1, 'Cash'), (2, 'Bank Transfer')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.transactions (id, type, date, reference, particulars, amount, main_category, created_by) VALUES
        (101, 'income', '2026-10-01', 'REC-001', 'Tuition Fee Payment', 100.00, 'Fees', 'accountant@school1.edu'),
        (102, 'income', '2026-10-02', 'REC-002', 'Another Tuition', 200.00, 'Fees', 'accountant@school1.edu')
        ON CONFLICT DO NOTHING;

        UPDATE public.fee_payments SET transaction_id = 101 WHERE student_admission_number = 'A001';
        UPDATE public.fee_payments SET transaction_id = 102 WHERE student_admission_number = 'A002';

        INSERT INTO public.transaction_revisions (id, transaction_id, action, created_by) VALUES
        (gen_random_uuid(), 101, 'CREATE', 'accountant@school1.edu');

        INSERT INTO public.activity_history (id, date, time, user_name, user_email, activity_type, transaction_id, device_status) VALUES
        (gen_random_uuid(), '2026-10-01', '10:00:00', 'Accountant Alice', 'accountant@school1.edu', 'CREATE_TRANSACTION', 101, 'online');

        INSERT INTO public.fee_structures (academic_year, class, fee_type, amount, frequency) VALUES
        ('2026-2027', 'Class 10', 'Tuition', 5000.00, 'Yearly')
        ON CONFLICT DO NOTHING;

        -- Standard Supabase privileges for anon and authenticated
        GRANT USAGE ON SCHEMA public TO anon, authenticated;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
        GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;
        GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    `;
    await db.exec(legacyLedgerSql);
    console.log('[OK] Legacy Ledger tables and initial records created.');

    // 3. Run Phase 1 Foundation
    console.log('\n[Step 3] Executing Phase 1 Identity & Access Foundation...');
    const p1Path = path.join(artifactsDir, '01_phase1_identity_access.sql');
    let p1Sql = await fs.readFile(p1Path, 'utf-8');
    p1Sql = p1Sql.replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/ig, '');
    p1Sql = p1Sql.replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/ig, '');
    await db.exec(p1Sql);
    console.log('[OK] Phase 1 Foundation successfully executed.');

    // 4. Run Phase 2 Shared Master Data Migration
    console.log('\n[Step 4] Executing Phase 2 Shared Master Data Migration...');
    const p2Path = path.join(artifactsDir, '02_phase2_shared_master_data.sql');
    let p2Sql = await fs.readFile(p2Path, 'utf-8');
    p2Sql = p2Sql.replace(/-- SET LOCAL migration.confirm_default_school = 'true';/ig, "SET LOCAL migration.confirm_default_school = 'true';");
    await db.exec(p2Sql);
    console.log('[OK] Phase 2 Migration successfully executed.');

    // 5. Provision Users and Multi-School Environment
    console.log('\n[Step 5] Provisioning Test Role Identifiers in app_access...');
    const defaultSchool = '00000000-0000-0000-0000-000000000001';
    const school2       = '00000000-0000-0000-0000-000000000002';

    await db.exec(`
        INSERT INTO public.schools (id, name) VALUES ('${school2}', 'Branch School Two') ON CONFLICT DO NOTHING;
    `);

    const accountantUser = '11111111-1111-1111-1111-111111111111';
    const principalUser  = '22222222-2222-2222-2222-222222222222';
    const teacherUser    = '33333333-3333-3333-3333-333333333333';
    const school2Admin   = '44444444-4444-4444-4444-444444444444';
    const multiSchoolUser = '55555555-5555-5555-5555-555555555555';
    const inactiveUser   = '66666666-6666-6666-6666-666666666666';
    const teacherAdmin   = '77777777-7777-7777-7777-777777777777';
    const inactiveAdmin  = '88888888-8888-8888-8888-888888888888';
    const superAdminUser = '99999999-9999-9999-9999-999999999999';

    await db.exec(`
        INSERT INTO auth.users (id, email) VALUES 
        ('${accountantUser}', 'accountant@school1.edu'),
        ('${principalUser}', 'principal@school1.edu'),
        ('${teacherUser}', 'teacher@school1.edu'),
        ('${school2Admin}', 'admin@school2.edu'),
        ('${multiSchoolUser}', 'multi@schools.edu'),
        ('${inactiveUser}', 'inactive@school1.edu'),
        ('${teacherAdmin}', 'teacheradmin@school1.edu'),
        ('${inactiveAdmin}', 'inactiveadmin@school1.edu'),
        ('${superAdminUser}', 'superadmin@system.edu')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.users (id, email, school_id, role) VALUES
        ('${accountantUser}', 'accountant@school1.edu', '${defaultSchool}', 'accountant'),
        ('${principalUser}', 'principal@school1.edu', '${defaultSchool}', 'principal'),
        ('${teacherUser}', 'teacher@school1.edu', '${defaultSchool}', 'teacher'),
        ('${school2Admin}', 'admin@school2.edu', '${school2}', 'admin'),
        ('${multiSchoolUser}', 'multi@schools.edu', '${defaultSchool}', 'accountant'),
        ('${inactiveUser}', 'inactive@school1.edu', '${defaultSchool}', 'accountant'),
        ('${teacherAdmin}', 'teacheradmin@school1.edu', '${defaultSchool}', 'admin'),
        ('${inactiveAdmin}', 'inactiveadmin@school1.edu', '${defaultSchool}', 'admin'),
        ('${superAdminUser}', 'superadmin@system.edu', '${defaultSchool}', 'admin')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.app_access (user_id, school_id, app_name, app_role, is_active) VALUES
        ('${accountantUser}', '${defaultSchool}', 'ledger', 'accountant', true),
        ('${principalUser}', '${defaultSchool}', 'ledger', 'principal', true),
        ('${teacherUser}', '${defaultSchool}', 'teacher', 'teacher', true),
        ('${school2Admin}', '${school2}', 'ledger', 'admin', true),
        -- Multi-school membership for ambiguity testing:
        ('${multiSchoolUser}', '${defaultSchool}', 'ledger', 'accountant', true),
        ('${multiSchoolUser}', '${school2}', 'ledger', 'accountant', true),
        -- Inactive ledger user:
        ('${inactiveUser}', '${defaultSchool}', 'ledger', 'accountant', false),
        -- Teacher App Admin (tests cross-app boundary on user_profiles):
        ('${teacherAdmin}', '${defaultSchool}', 'teacher', 'admin', true),
        -- Inactive Ledger Admin:
        ('${inactiveAdmin}', '${defaultSchool}', 'ledger', 'admin', false),
        -- Super Admin:
        ('${superAdminUser}', '${defaultSchool}', 'ledger', 'super_admin', true)
        ON CONFLICT DO NOTHING;

        -- Seed user profile
        INSERT INTO public.user_profiles (email, full_name, profession) VALUES
        ('accountant@school1.edu', 'Alice Accountant', 'Accountant'),
        ('principal@school1.edu', 'Peter Principal', 'Principal')
        ON CONFLICT (email) DO NOTHING;
    `);
    console.log('[OK] Test users provisioned (Accountant, Principal, Teacher, School 2 Admin, Multi-School User, Inactive User, Teacher Admin, Inactive Admin, Super Admin).');

    // 6. Run Phase 3 Preflight Checks
    console.log('\n[Step 6] Running Phase 3 Preflight Checks...');
    const preflightPath = path.join(artifactsDir, '03_phase3_ledger_preflight.sql');
    let preflightSql = await fs.readFile(preflightPath, 'utf-8');
    await db.exec(preflightSql);
    console.log('[OK] Phase 3 Preflight script executed without errors.');

    // 7. Test Fail-Closed Approval Gate
    console.log('\n[Step 7] Testing Phase 3 Fail-Closed Approval Gate (without confirmation)...');
    const migrationPath = path.join(artifactsDir, '03_phase3_ledger_migration.sql');
    let migrationSqlRaw = await fs.readFile(migrationPath, 'utf-8');
    await assertThrowsAsync(
        () => db.exec(migrationSqlRaw),
        'MIGRATION ABORTED [MANUAL APPROVAL GATE]',
        'Unconfirmed migration in multi-school setup'
    );
    try { await db.exec('ROLLBACK;'); } catch (rbe) {}

    // 8. Execute Phase 3 Migration with Approval Gate Enabled
    console.log('\n[Step 8] Executing Phase 3 Migration with Operator Approval Gate...');
    let migrationSqlApproved = migrationSqlRaw.replace(
        /-- SET LOCAL migration.confirm_ledger_ownership = 'true';/ig,
        "SET LOCAL migration.confirm_ledger_ownership = 'true';"
    );
    await db.exec(migrationSqlApproved);
    console.log('[OK] Phase 3 Migration applied successfully.');

    // 9. Verify Idempotency
    console.log('\n[Step 9] Verifying Phase 3 Migration Idempotency (second execution)...');
    await db.exec(migrationSqlApproved);
    console.log('[PASS] Phase 3 Migration is completely idempotent.');

    // Helper to run actual SQL queries under simulated Supabase session context
    async function runAs(userId, role, sql) {
        await db.exec(`
            CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
            BEGIN RETURN ${userId ? `'${userId}'::uuid` : 'NULL'}; END;
            $$ LANGUAGE plpgsql;
            
            CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
            BEGIN RETURN '${role}'; END;
            $$ LANGUAGE plpgsql;
            
            SET ROLE ${role};
        `);
        try {
            const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
            let lastResult = { rows: [], rowCount: 0 };
            for (const stmt of statements) {
                lastResult = await db.query(stmt);
            }
            return lastResult;
        } finally {
            await db.exec(`SET ROLE postgres;`);
        }
    }

    // 10. Comprehensive Security & RLS Policy Enforcement Tests
    console.log('\n[Step 10] Running Comprehensive Real-Query RLS Security Tests...');

    // TEST 1: Unauthenticated (anon) Access Denial
    console.log('  -> Test 1: Anonymous (anon) access denial across all tables...');
    let res = await runAs(null, 'anon', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'anon must receive 0 rows from transactions');

    await assertThrowsAsync(
        () => runAs(null, 'anon', `INSERT INTO public.transactions (id, type, date, amount) VALUES (999, 'income', '2026-10-06', 50);`),
        null,
        'anon insert into transactions must fail'
    );

    res = await runAs(null, 'anon', `SELECT * FROM public.activity_history;`);
    assert(res.rows.length === 0, 'anon must receive 0 rows from activity_history');

    res = await runAs(null, 'anon', `SELECT * FROM public.categories;`);
    assert(res.rows.length === 0, 'anon must receive 0 rows from categories');

    // TEST 2: Teacher App User Denial
    console.log('  -> Test 2: Teacher App user denial from Ledger tables...');
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'Teacher must receive 0 rows from transactions');

    await assertThrowsAsync(
        () => runAs(teacherUser, 'authenticated', `INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (998, 'income', '2026-10-06', 50, '${defaultSchool}');`),
        null,
        'Teacher insert into transactions must fail'
    );

    // TEST 3: Accountant Scope & Restrictions (Own School CRUD, No Delete, No Audit Read, No Category Insert)
    console.log('  -> Test 3: Accountant role permissions & isolation...');
    
    // Insert a transaction in School 2 as admin for cross-school testing
    await runAs(school2Admin, 'authenticated', `
        INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (201, 'income', '2026-10-06', 300, '${school2}');
    `);

    // School 1 Accountant reads transactions: must ONLY see School 1 transactions
    res = await runAs(accountantUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length > 0, 'Accountant must be able to read own school transactions');
    const crossSchoolRows = res.rows.filter(r => r.school_id === school2);
    assert(crossSchoolRows.length === 0, 'Accountant must NEVER see School 2 transactions');
    console.log(`     [PASS] Cross-school read isolated: 0 of ${res.rows.length} rows belonged to School 2.`);

    // Accountant creates transaction for own school: must succeed
    await runAs(accountantUser, 'authenticated', `
        INSERT INTO public.transactions (id, type, date, amount) VALUES (103, 'expense', '2026-10-06', 45);
    `);
    const createdTx = await db.query(`SELECT school_id, user_id FROM public.transactions WHERE id = 103;`);
    assert(createdTx.rows[0].school_id === defaultSchool, 'Auto-inferred school_id must match School 1');
    assert(createdTx.rows[0].user_id === accountantUser, 'Auto-inferred user_id must match accountantUser');
    console.log('     [PASS] Accountant transaction insert succeeded with unambiguous auto-inference.');

    // Accountant attempts to insert transaction for School 2: must fail
    await assertThrowsAsync(
        () => runAs(accountantUser, 'authenticated', `
            INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (104, 'expense', '2026-10-06', 45, '${school2}');
        `),
        null,
        'Accountant inserting transaction into School 2 must be rejected'
    );

    // Accountant attempts hard delete of transaction: must fail (Accountant has no DELETE policy)
    res = await runAs(accountantUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 103;`);
    assert(res.rowCount === 0, 'Accountant DELETE must affect 0 rows under RLS');
    console.log('     [PASS] Accountant hard-delete attempt blocked by RLS.');

    // Accountant attempts to read audit logs: must receive 0 rows
    res = await runAs(accountantUser, 'authenticated', `SELECT * FROM public.activity_history;`);
    assert(res.rows.length === 0, 'Accountant must receive 0 rows from activity_history');
    console.log('     [PASS] Accountant reading activity audit logs returned 0 rows.');

    // Accountant attempts to insert categories: must be rejected (categories manage is admin-only)
    await assertThrowsAsync(
        () => runAs(accountantUser, 'authenticated', `
            INSERT INTO public.categories (name, school_id, type) VALUES ('Accountant Cat', '${defaultSchool}', 'expense');
        `),
        null,
        'Accountant category management must be rejected'
    );

    // TEST 4: Principal Permissions (Audit Read, Own-School Category CRUD, Hard Delete)
    console.log('  -> Test 4: Principal permissions & restrictions...');
    
    // Principal reads activity history: must see School 1 audit logs
    res = await runAs(principalUser, 'authenticated', `SELECT * FROM public.activity_history;`);
    assert(res.rows.length > 0, 'Principal must be able to read own school activity history');
    console.log(`     [PASS] Principal successfully read ${res.rows.length} audit history records.`);

    // Principal creates category for own school: must succeed
    await runAs(principalUser, 'authenticated', `
        INSERT INTO public.categories (id, name, school_id, type) VALUES (301, 'Principal Lab Fees', '${defaultSchool}', 'income');
    `);
    console.log('     [PASS] Principal successfully created category for own school.');

        // Sync sequence
        await db.exec(`
            SELECT setval('public.categories_id_seq', COALESCE((SELECT MAX(id) FROM public.categories), 1));
            SELECT setval('public.tags_id_seq', COALESCE((SELECT MAX(id) FROM public.tags), 1));
        `);

        // Principal attempts to create category in School 2: must fail
        await assertThrowsAsync(
            () => runAs(principalUser, 'authenticated', `
                INSERT INTO public.categories (name, school_id, type) VALUES ('Unauthorized School 2 Cat', '${school2}', 'income');
            `),
            'UNAUTHORIZED_SCHOOL',
            'Principal cannot create categories for another school'
        );

        // Principal attempts to delete a transaction with linked fee payments: must be blocked by RESTRICT key
        await assertThrowsAsync(
            () => runAs(principalUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 101;`),
            'fk_fee_payments_tx_school',
            'Hard delete of transaction with dependent fee payments must be blocked by RESTRICT constraint'
        );

    // Principal deletes a transaction without dependent records (id = 103): must succeed
    res = await runAs(principalUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 103;`);
    assert(res.rowCount === 1, 'Principal must be able to delete independent own-school transaction');
    console.log('     [PASS] Principal deleted independent transaction cleanly.');

    // TEST 5: Complete Category Parent/Child Matrix (5 Permutations)
    console.log('  -> Test 5: Category Parent/Child ownership matrix (5 permutations)...');

    // Permutation 1: Global child -> Global parent (allowed for Super Admin)
    await runAs(superAdminUser, 'authenticated', `
        INSERT INTO public.categories (id, name, school_id, type) VALUES (10, 'Global Parent', null, 'all');
        INSERT INTO public.categories (id, name, parent_id, school_id, type) VALUES (11, 'Global Child', 10, null, 'all');
    `);
    console.log('     [PASS] Permutation 1 (Global -> Global): Allowed.');

    // Permutation 2: Global child -> School A parent (FORBIDDEN)
    await assertThrowsAsync(
        () => runAs(superAdminUser, 'authenticated', `
            INSERT INTO public.categories (name, parent_id, school_id, type) VALUES ('Bad Global Child', 301, null, 'all');
        `),
        'GLOBAL_CHILD_CANNOT_HAVE_LOCAL_PARENT',
        'Global child category under school-specific parent must be forbidden'
    );

    // Permutation 3: School A child -> School A parent (ALLOWED)
    await runAs(principalUser, 'authenticated', `
        INSERT INTO public.categories (id, name, parent_id, school_id, type) VALUES (302, 'Sub Lab Fees', 301, '${defaultSchool}', 'income');
    `);
    console.log('     [PASS] Permutation 3 (School A -> School A): Allowed.');

    // Permutation 4: School A child -> Global parent (ALLOWED)
    await runAs(principalUser, 'authenticated', `
        INSERT INTO public.categories (id, name, parent_id, school_id, type) VALUES (303, 'School A Under Global', 10, '${defaultSchool}', 'income');
    `);
    console.log('     [PASS] Permutation 4 (School A -> Global): Allowed.');

    // Permutation 5: School A child -> School B parent (FORBIDDEN)
    await runAs(school2Admin, 'authenticated', `
        INSERT INTO public.categories (id, name, school_id, type) VALUES (200, 'School 2 Parent Category', '${school2}', 'income');
    `);
    await assertThrowsAsync(
        () => runAs(principalUser, 'authenticated', `
            INSERT INTO public.categories (name, parent_id, school_id, type) VALUES ('Cross School Link', 200, '${defaultSchool}', 'income');
        `),
        'CROSS_SCHOOL_CATEGORY_LINKAGE',
        'School A child category under School B parent must be forbidden'
    );

    // TEST 6: Multi-School Membership Context Inference Rejection
    console.log('  -> Test 6: Multi-school membership context ambiguity rejection...');
    await assertThrowsAsync(
        () => runAs(multiSchoolUser, 'authenticated', `
            INSERT INTO public.transactions (id, type, date, amount) VALUES (501, 'expense', '2026-10-06', 20);
        `),
        'AMBIGUOUS_SCHOOL_CONTEXT',
        'Multi-school user omitting school_id must be rejected without guessing'
    );

    // Multi-school user supplying explicit school_id: succeeds
    await runAs(multiSchoolUser, 'authenticated', `
        INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (502, 'expense', '2026-10-06', 20, '${defaultSchool}');
    `);
    console.log('     [PASS] Multi-school user with explicit school_id succeeded.');

    // TEST 7: Append-Only Audit Immutability Protection
    console.log('  -> Test 7: Append-only audit history immutability...');
    await assertThrowsAsync(
        () => db.exec(`UPDATE public.activity_history SET description = 'tampered' WHERE true;`),
        'TAMPER PROTECTION: activity_history is append-only',
        'UPDATE on activity_history must fail'
    );
    await assertThrowsAsync(
        () => db.exec(`DELETE FROM public.activity_history WHERE true;`),
        'TAMPER PROTECTION: activity_history is append-only',
        'DELETE on activity_history must fail'
    );

    // 11. Test Comprehensive Rollback Suite (Atomicity, Containment, and Reversion)
    console.log('\n[Step 11] Testing Comprehensive Rollback Suite...');

    const rollbackPath = path.join(artifactsDir, '03_phase3_ledger_rollback.sql');
    let rollbackSqlRaw = await fs.readFile(rollbackPath, 'utf-8');

    // 11A. Test Rollback Transaction Atomicity (Real Mid-Execution Failure Injection)
    console.log('  -> Test 11A: Rollback Transaction Atomicity via Real Script Failure Injection...');
    const rollbackFailureSql = rollbackSqlRaw.replace(
        /-- SET LOCAL rollback\.inject_test_failure = 'true';/i,
        "SET LOCAL rollback.inject_test_failure = 'true';"
    );

    try {
        await db.exec(rollbackFailureSql);
        throw new Error('Rollback failure injection should have aborted the transaction!');
    } catch (err) {
        assert(err.message.includes('TEST_INJECTED_ROLLBACK_FAILURE'), `Must abort with injected error, got: ${err.message}`);
        try { await db.exec('ROLLBACK;'); } catch (rbe) {}
        console.log('     [PASS] Injected mid-rollback failure aborted cleanly.');
    }

    // Verify database state remained 100% intact after the aborted rollback
    const preCheckFunc = await db.query(`SELECT to_regproc('public.has_ledger_access') as fn;`);
    assert(preCheckFunc.rows[0].fn !== null, 'Helper function has_ledger_access must still exist');

    const preCheckUQ = await db.query(`SELECT COUNT(*) as cnt FROM pg_constraint WHERE conname = 'uq_transactions_id_school';`);
    assert(parseInt(preCheckUQ.rows[0].cnt) === 1, 'Composite unique constraint must remain intact');

    const preCheckPol = await db.query(`
        SELECT COUNT(*) as cnt FROM pg_policies 
        WHERE tablename = 'transactions' AND policyname = 'Ledger users read transactions';
    `);
    assert(parseInt(preCheckPol.rows[0].cnt) === 1, 'Phase 3 policies must remain intact');
    console.log('     [PASS] Atomicity verified: Database schema and policies unchanged after aborted rollback.');


    // 11B. Test Mode 1: Emergency Containment Rollback
    console.log('  -> Test 11B: Mode 1 (Emergency Containment / Lockdown)...');
    await db.exec(rollbackSqlRaw); // Default mode is containment
    console.log('     [PASS] Mode 1 Containment executed cleanly.');

    // Verify 11B.1 Anonymous Access Denied
    await assertThrowsAsync(
        () => runAs(null, 'anon', `SELECT * FROM public.transactions;`),
        'permission denied',
        'Containment must block all anon reads with permission denied'
    );
    await assertThrowsAsync(
        () => runAs(null, 'anon', `INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (996, 'income', '2026-10-06', 10, '${defaultSchool}');`),
        'permission denied',
        'Containment must block all anon writes with permission denied'
    );
    console.log('     [PASS] Anonymous access completely blocked in Containment mode.');

    // Verify 11B.2 Teacher User Blocked (Has school_id in users, but app_name = 'teacher')
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'Teacher user must receive 0 transactions in Containment mode');
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.fee_payments;`);
    assert(res.rows.length === 0, 'Teacher user must receive 0 fee_payments in Containment mode');
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.transaction_revisions;`);
    assert(res.rows.length === 0, 'Teacher user must receive 0 transaction_revisions in Containment mode');
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.fee_structures;`);
    assert(res.rows.length === 0, 'Teacher user must receive 0 fee_structures in Containment mode');

    await assertThrowsAsync(
        () => runAs(teacherUser, 'authenticated', `
            INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (997, 'expense', '2026-10-06', 50, '${defaultSchool}');
        `),
        null,
        'Teacher user inserting transaction must be blocked by RLS'
    );
    await assertThrowsAsync(
        () => runAs(teacherUser, 'authenticated', `
            INSERT INTO public.fee_payments (transaction_id, student_admission_number, school_id, amount)
            VALUES (101, 'A001', '${defaultSchool}', 100);
        `),
        null,
        'Teacher user inserting fee payment must be blocked by RLS'
    );
    console.log('     [PASS] Teacher user with only teacher-app access strictly denied all Ledger operations.');

    // Verify 11B.3 Inactive Ledger User Blocked
    res = await runAs(inactiveUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'Inactive ledger user must receive 0 transactions');
    await assertThrowsAsync(
        () => runAs(inactiveUser, 'authenticated', `
            INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (998, 'expense', '2026-10-06', 50, '${defaultSchool}');
        `),
        null,
        'Inactive ledger user inserting transaction must be blocked'
    );
    console.log('     [PASS] Inactive ledger user strictly denied all operations.');

    // Verify 11B.4 Tenant Isolation for Accountant
    res = await runAs(accountantUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length > 0, 'Accountant can read own school data in containment');
    assert(res.rows.filter(r => r.school_id === school2).length === 0, 'Containment must enforce school isolation');
    console.log(`     [PASS] School isolation verified in containment: 0 of ${res.rows.length} rows belonged to School 2.`);

    // Verify 11B.5 Containment Lockdown: Hard Deletes Frozen for All Roles
    res = await runAs(accountantUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 101;`);
    assert(res.rowCount === 0, 'Accountant cannot delete in containment mode');
    res = await runAs(principalUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 101;`);
    assert(res.rowCount === 0, 'Principal cannot delete in containment mode (hard deletes frozen)');
    console.log('     [PASS] Hard deletes frozen for all roles in containment mode.');

    // Verify 11B.6 Audit Forgery Prevention in Containment Mode
    // Forged audit insert (Accountant attempts to attribute action to Principal)
    await assertThrowsAsync(
        () => runAs(accountantUser, 'authenticated', `
            INSERT INTO public.activity_history (id, date, time, user_name, user_email, user_id, activity_type, school_id, device_status)
            VALUES (gen_random_uuid(), '2026-10-06', '12:00:00', 'Forged Principal', 'principal@school1.edu', '${principalUser}', 'FORGERY_ATTEMPT', '${defaultSchool}', 'online');
        `),
        null,
        'Forged activity_history insert with spoofed user_id/email must be rejected by RLS'
    );

    // Legitimate audit insert by Accountant (own identity)
    await runAs(accountantUser, 'authenticated', `
        INSERT INTO public.activity_history (id, date, time, user_name, user_email, user_id, activity_type, school_id, device_status)
        VALUES (gen_random_uuid(), '2026-10-06', '12:00:00', 'Alice Accountant', 'accountant@school1.edu', '${accountantUser}', 'LEGIT_ACTION', '${defaultSchool}', 'online');
    `);
    console.log('     [PASS] Audit forgery blocked and genuine audit entry permitted in containment mode.');

    // Containment catalog lockdown checks
    const frozen = await db.query(`
        SELECT tablename FROM pg_policies
        WHERE schemaname='public' AND cmd IN ('DELETE','ALL')
          AND tablename IN ('transactions','transaction_revisions','categories','tags','fee_payments','student_fee_assignments','fee_structures','activity_history');
    `);
    assert(frozen.rows.length === 0, 'Containment must install no DELETE/ALL policy on any protected table');
    const taxo = await db.query(`
        SELECT tablename FROM pg_policies
        WHERE schemaname='public' AND tablename IN ('categories','tags','fee_structures') AND cmd <> 'SELECT';
    `);
    assert(taxo.rows.length === 0, 'Containment must freeze taxonomy and fee-structure writes');
    console.log('     [PASS] Containment installs zero DELETE policies and zero taxonomy/fee-structure write policies.');

    // Verify 11B.7 User Profiles Application Boundary Isolation
    res = await runAs(teacherAdmin, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 0, 'Teacher app admin must NOT access Ledger user profiles');

    res = await runAs(inactiveAdmin, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 0, 'Inactive ledger admin must NOT access user profiles');

    res = await runAs(principalUser, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 1, 'Active Ledger Principal must read own school user profiles');

    res = await runAs(accountantUser, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 1, 'User must read own user profile');
    console.log('     [PASS] User profiles cross-app boundary and role isolation verified in containment mode.');


    // 11C. Test Mode 2: Complete Schema Reversion Rollback
    console.log('  -> Test 11C: Mode 2 (Complete Schema & Constraint Reversion)...');
    let rollbackReversionSql = rollbackSqlRaw.replace(
        /-- SET LOCAL rollback.mode = 'reversion';/ig,
        "SET LOCAL rollback.mode = 'reversion';"
    );
    await db.exec(rollbackReversionSql);
    console.log('     [PASS] Mode 2 Reversion executed cleanly.');

    // Verify Anonymous Access Denied in Reversion Mode
    await assertThrowsAsync(
        () => runAs(null, 'anon', `SELECT * FROM public.transactions;`),
        'permission denied',
        'Reversion must block all anon reads with permission denied'
    );
    await assertThrowsAsync(
        () => runAs(null, 'anon', `INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (995, 'income', '2026-10-06', 10, '${defaultSchool}');`),
        'permission denied',
        'Reversion must block all anon writes with permission denied'
    );
    console.log('     [PASS] Anonymous access completely blocked in Reversion mode.');

    // Verify 11C.1 Catalog Constraint Restoration (Exact CASCADE Verification)
    const fkFeeCheck = await db.query(`
        SELECT confdeltype FROM pg_constraint 
        WHERE conrelid = 'public.fee_payments'::regclass AND conname = 'fee_payments_transaction_id_fkey';
    `);
    assert(fkFeeCheck.rows.length === 1 && fkFeeCheck.rows[0].confdeltype === 'c', 'fee_payments_transaction_id_fkey must have ON DELETE CASCADE (confdeltype = "c")');

    const fkRevCheck = await db.query(`
        SELECT confdeltype FROM pg_constraint 
        WHERE conrelid = 'public.transaction_revisions'::regclass AND conname = 'transaction_revisions_transaction_id_fkey';
    `);
    assert(fkRevCheck.rows.length === 1 && fkRevCheck.rows[0].confdeltype === 'c', 'transaction_revisions_transaction_id_fkey must have ON DELETE CASCADE (confdeltype = "c")');

    const uqCompCheck = await db.query(`SELECT COUNT(*) as cnt FROM pg_constraint WHERE conname = 'uq_transactions_id_school';`);
    assert(parseInt(uqCompCheck.rows[0].cnt) === 0, 'uq_transactions_id_school must be dropped in Mode 2');
    console.log('     [PASS] Exact pre-Phase 3 foreign keys (ON DELETE CASCADE) verified in database catalog.');

    // Verify 11C.2 Verified CASCADE Behavior
    // Principal inserts transaction and referencing fee payment
    await runAs(principalUser, 'authenticated', `
        INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (777, 'income', '2026-10-06', 75, '${defaultSchool}');
        INSERT INTO public.fee_payments (transaction_id, student_admission_number, school_id, amount)
        VALUES (777, 'A001', '${defaultSchool}', 75);
        INSERT INTO public.transaction_revisions (id, transaction_id, action, created_by, user_id, school_id)
        VALUES (gen_random_uuid(), 777, 'CREATE', 'principal@school1.edu', '${principalUser}', '${defaultSchool}');
    `);

    // Principal deletes parent transaction: references must CASCADE
    await runAs(principalUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 777;`);
    const cascadeFeeRes = await db.query(`SELECT * FROM public.fee_payments WHERE transaction_id = 777;`);
    assert(cascadeFeeRes.rows.length === 0, 'Dependent fee_payments must be cascaded on transaction deletion');
    const cascadeRevRes = await db.query(`SELECT * FROM public.transaction_revisions WHERE transaction_id = 777;`);
    assert(cascadeRevRes.rows.length === 0, 'Dependent transaction_revisions must be cascaded on transaction deletion');
    console.log('     [PASS] ON DELETE CASCADE behavior verified on restored foreign keys.');

    // Verify 11C.3 Append-Only Immutability Preserved in Reversion Mode
    await assertThrowsAsync(
        () => db.exec(`UPDATE public.activity_history SET description = 'tampered' WHERE true;`),
        'TAMPER PROTECTION: activity_history is append-only',
        'UPDATE on activity_history must fail in reversion mode'
    );
    await assertThrowsAsync(
        () => db.exec(`DELETE FROM public.activity_history WHERE true;`),
        'TAMPER PROTECTION: activity_history is append-only',
        'DELETE on activity_history must fail in reversion mode'
    );
    console.log('     [PASS] Append-only audit log protection verified intact in reversion mode.');

    // Verify 11C.4 Teacher and Inactive Denial in Reversion Mode
    res = await runAs(teacherUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'Teacher user denied transactions in Reversion mode');
    res = await runAs(inactiveUser, 'authenticated', `SELECT * FROM public.transactions;`);
    assert(res.rows.length === 0, 'Inactive user denied transactions in Reversion mode');
    console.log('     [PASS] Teacher and inactive users strictly denied in Reversion mode.');

    // Verify 11C.5 Role Separation on Writes in Reversion Mode
    // Accountant cannot delete transactions
    res = await runAs(accountantUser, 'authenticated', `DELETE FROM public.transactions WHERE id = 101;`);
    assert(res.rowCount === 0, 'Accountant cannot delete transactions in reversion mode');

    // Accountant cannot insert fee structures (Admins only)
    await assertThrowsAsync(
        () => runAs(accountantUser, 'authenticated', `
            INSERT INTO public.fee_structures (academic_year, class, fee_type, amount, frequency, school_id)
            VALUES ('2026-2027', 'Class 12', 'Library', 300, 'Yearly', '${defaultSchool}');
        `),
        null,
        'Accountant cannot manage fee structures in reversion mode'
    );

    // Principal can insert fee structures
    await runAs(principalUser, 'authenticated', `
        INSERT INTO public.fee_structures (academic_year, class, fee_type, amount, frequency, school_id)
        VALUES ('2026-2027', 'Class 12', 'Library', 300, 'Yearly', '${defaultSchool}');
    `);
    console.log('     [PASS] Role separation on writes verified in Reversion mode.');

    // Verify 11C.6 User Profiles Boundary Isolation in Reversion Mode
    res = await runAs(teacherAdmin, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 0, 'Teacher app admin denied access to Ledger user profiles in reversion mode');
    res = await runAs(principalUser, 'authenticated', `SELECT * FROM public.user_profiles WHERE email = 'accountant@school1.edu';`);
    assert(res.rows.length === 1, 'Active Ledger Principal reads user profile in reversion mode');
    console.log('     [PASS] User profiles cross-app boundary protection verified in reversion mode.');


    // 11C.7 Cross-school referential integrity (composite FK dropped in reversion; policies must compensate)
    await db.exec(`INSERT INTO public.transactions (id, type, date, amount, school_id) VALUES (888, 'income', '2026-10-06', 10, '${school2}');`);
    await assertThrowsAsync(
        () => runAs(principalUser, 'authenticated', `
            INSERT INTO public.transaction_revisions (id, transaction_id, action, created_by, user_id, school_id)
            VALUES (gen_random_uuid(), 888, 'UPDATE', 'principal@school1.edu', '${principalUser}', '${defaultSchool}');
        `),
        null,
        'Revision referencing another school\'s transaction must be rejected'
    );
    await assertThrowsAsync(
        () => runAs(principalUser, 'authenticated', `
            INSERT INTO public.activity_history (id, date, time, user_name, user_email, user_id, activity_type, school_id, transaction_id, device_status)
            VALUES (gen_random_uuid(), '2026-10-06', '12:00:00', 'P', 'principal@school1.edu', '${principalUser}', 'X', '${defaultSchool}', 888, 'online');
        `),
        null,
        'Audit entry referencing another school\'s transaction must be rejected'
    );
    await assertThrowsAsync(
        () => runAs(principalUser, 'authenticated', `
            INSERT INTO public.fee_payments (transaction_id, student_admission_number, school_id, amount)
            VALUES (888, 'A001', '${defaultSchool}', 10);
        `),
        null,
        'Fee payment referencing another school\'s transaction must be rejected'
    );
    // School reassignment via UPDATE must be rejected
    await assertThrowsAsync(
        () => runAs(principalUser, 'authenticated', `UPDATE public.transactions SET school_id = '${school2}' WHERE id = 101;`),
        null,
        'Moving a transaction to another school must be rejected'
    );
    console.log('     [PASS] Cross-school references and school reassignment rejected in reversion mode.');

    // 11D intro

    console.log('  -> Test 11D: Preflight Schema & Column Dependency Validation Guard...');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS public.broken_partially_migrated_table (
            id SERIAL PRIMARY KEY,
            data TEXT
        );
    `);
    const brokenRollbackSql = rollbackSqlRaw.replace(
        /'student_fee_assignments', 'user_profiles'/i,
        "'student_fee_assignments', 'user_profiles', 'broken_partially_migrated_table'"
    );
    await assertThrowsAsync(
        () => db.exec(brokenRollbackSql),
        'PREFLIGHT ROLLBACK FAILURE',
        'Rollback must abort immediately when required column school_id is missing on a table'
    );
    try { await db.exec('ROLLBACK;'); } catch (e) {}
    await db.exec('DROP TABLE IF EXISTS public.broken_partially_migrated_table;');
    console.log('     [PASS] Preflight schema guard detected missing columns and aborted cleanly.');

    console.log('\n================================================================');
    console.log('ALL PHASE 3 HARDENED SECURITY, RLS & ROLLBACK TESTS PASSED!');
    console.log('================================================================\n');
}

main().catch(err => {
    console.error('\n[FATAL TEST FAILURE]:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
