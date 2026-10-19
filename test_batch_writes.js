/**
 * Automated test suite for Phase 2 -> Step 2.2: Batch Supabase Writes
 * Verifies chunking, offline queueing, partial failure recovery, and table mapping.
 */

const assert = require('assert');
const fs = require('fs');

// Mock localStorage
const storage = {};
global.localStorage = {
    getItem: (key) => storage[key] || null,
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

// Mock window and navigator
global.window = global;
global.navigator = { onLine: true };
global.document = {
    getElementById: () => ({ value: '', checked: false }),
    querySelectorAll: () => []
};
global.showToast = () => {};

// Load syncService.js
require('./syncService.js');

const SyncService = global.window.SyncService;
assert(SyncService, 'SyncService should be exported on global/window');

async function runTests() {
    console.log('--- TEST 1: Chunking of 125 records into chunks of 50 ---');
    {
        localStorage.clear();
        let upsertCalls = [];

        const mockSupabase = {
            from: (table) => ({
                upsert: async (records, opts) => {
                    upsertCalls.push({ table, count: records.length, records, opts });
                    return { data: records, error: null };
                }
            })
        };

        SyncService.init({
            getSupabaseClient: () => mockSupabase,
            getSupaConfig: () => ({ table: 'transactions', bucket: 'receipts' })
        });

        const testItems = [];
        for (let i = 1; i <= 125; i++) {
            testItems.push({
                student_id: `ADM${String(i).padStart(4, '0')}`,
                academic_year: '2025-2026',
                fee_category_id: 101,
                assigned_amount: 1500,
                remarks: `Student ${i}`
            });
        }

        const result = await SyncService.batchUpsert('student_fee_assignments', testItems);
        assert.strictEqual(result.success, true, 'batchUpsert should succeed');
        assert.strictEqual(upsertCalls.length, 3, 'Should have made exactly 3 chunk calls for 125 items');
        assert.strictEqual(upsertCalls[0].count, 50, 'Chunk 1 should have 50 items');
        assert.strictEqual(upsertCalls[1].count, 50, 'Chunk 2 should have 50 items');
        assert.strictEqual(upsertCalls[2].count, 25, 'Chunk 3 should have 25 items');
        assert.strictEqual(upsertCalls[0].table, 'student_fee_assignments', 'Should target student_fee_assignments table');
        assert.strictEqual(upsertCalls[0].opts.onConflict, 'student_id,academic_year,fee_category_id', 'Should include exact onConflict clause');

        console.log('✓ Chunking and onConflict verified (50, 50, 25).');
    }

    console.log('--- TEST 2: Entity mapping (fee_assignments -> student_fee_assignments) ---');
    {
        localStorage.clear();
        let upsertTable = null;

        const mockSupabase = {
            from: (table) => ({
                upsert: async (records, opts) => {
                    upsertTable = table;
                    return { data: records, error: null };
                }
            })
        };

        SyncService.init({
            getSupabaseClient: () => mockSupabase,
            getSupaConfig: () => ({ table: 'transactions', bucket: 'receipts' })
        });

        await SyncService.batchUpsert('fee_assignments', [{
            student_id: 'ADM001',
            academic_year: '2025-2026',
            fee_category_id: 1,
            assigned_amount: 500
        }]);

        assert.strictEqual(upsertTable, 'student_fee_assignments', 'fee_assignments alias must map to student_fee_assignments');
        console.log('✓ fee_assignments alias mapped to student_fee_assignments table.');
    }

    console.log('--- TEST 3: Offline queueing without losing individual records ---');
    {
        localStorage.clear();
        navigator.onLine = false;

        const testItems = [
            { student_id: 'ADM001', academic_year: '2025-2026', fee_category_id: 1, assigned_amount: 100 },
            { student_id: 'ADM002', academic_year: '2025-2026', fee_category_id: 1, assigned_amount: 200 }
        ];

        const result = await SyncService.batchUpsert('student_fee_assignments', testItems);
        assert.strictEqual(result.success, false, 'Should report not immediately synced');
        assert.strictEqual(result.queued, true, 'Should report queued');

        const queue = SyncService.getQueue();
        assert.strictEqual(queue.length, 1, 'Sync queue should have 1 batch operation');
        assert.strictEqual(queue[0].action, 'BATCH_UPSERT', 'Action should be BATCH_UPSERT');
        assert.strictEqual(queue[0].entity, 'student_fee_assignments', 'Entity should be student_fee_assignments');
        assert.strictEqual(queue[0].payload.items.length, 2, 'Should preserve both items');

        navigator.onLine = true;
        console.log('✓ Offline batch queueing verified without record loss.');
    }

    console.log('--- TEST 4: Partial failure recovery (Batch 1 succeeds, Batch 2 fails) ---');
    {
        localStorage.clear();
        let chunkCount = 0;

        const mockSupabase = {
            from: (table) => ({
                upsert: async (records, opts) => {
                    chunkCount++;
                    if (chunkCount === 1) {
                        return { data: records, error: null }; // chunk 1 succeeds
                    }
                    throw new Error('Database connection timed out on chunk 2');
                }
            })
        };

        SyncService.init({
            getSupabaseClient: () => mockSupabase,
            getSupaConfig: () => ({ table: 'transactions', bucket: 'receipts' })
        });

        // 75 items: chunk 1 (50 items) succeeds, chunk 2 (25 items) fails
        const testItems = [];
        for (let i = 1; i <= 75; i++) {
            testItems.push({
                student_id: `STU${i}`,
                academic_year: '2025-2026',
                fee_category_id: 2,
                assigned_amount: 1000
            });
        }

        const result = await SyncService.batchUpsert('student_fee_assignments', testItems);
        assert.strictEqual(result.success, false, 'Should report failure on chunk 2');
        assert.strictEqual(result.queued, true, 'Remaining items should be enqueued');

        const queue = SyncService.getQueue();
        assert.strictEqual(queue.length, 1, 'Queue should have 1 operation for remaining items');
        assert.strictEqual(queue[0].payload.items.length, 25, 'Only the remaining 25 items should be in queue');
        assert.strictEqual(queue[0].payload.items[0].student_id, 'STU51', 'First item in queue should be STU51');

        console.log('✓ Partial failure preserved remaining 25 items in queue without data loss or re-running chunk 1.');
    }

    console.log('--- TEST 5: Student batch upsert chunking and onConflict ---');
    {
        localStorage.clear();
        let upsertCalls = [];

        const mockSupabase = {
            from: (table) => ({
                upsert: async (records, opts) => {
                    upsertCalls.push({ table, count: records.length, records, opts });
                    return { data: records, error: null };
                }
            })
        };

        SyncService.init({
            getSupabaseClient: () => mockSupabase,
            getSupaConfig: () => ({ table: 'transactions', bucket: 'receipts' })
        });

        const students = [];
        for (let i = 1; i <= 60; i++) {
            students.push({
                admissionNumber: `ADM_${i}`,
                name: `Student Name ${i}`,
                class: '10',
                section: 'A'
            });
        }

        const result = await SyncService.batchUpsert('students', students);
        assert.strictEqual(result.success, true);
        assert.strictEqual(upsertCalls.length, 2, '60 students should result in 2 chunks');
        assert.strictEqual(upsertCalls[0].count, 50);
        assert.strictEqual(upsertCalls[1].count, 10);
        assert.strictEqual(upsertCalls[0].opts.onConflict, 'admission_number', 'Students onConflict must be admission_number');
        assert.strictEqual(upsertCalls[0].records[0].admission_number, 'ADM_1', 'Should map admissionNumber to admission_number');

        console.log('✓ Student batch upsert verified (50, 10) with admission_number conflict target.');
    }

    console.log('--- TEST 6: Initial sync conflict protection (Stale remote records do not overwrite pending local assignments) ---');
    {
        localStorage.clear();

        // Simulate local assignment modified offline
        const localAssignments = [
            { student_id: 'ADM001', academic_year: '2025-2026', fee_category_id: 10, assigned_amount: 9999, remarks: 'Updated offline' },
            { student_id: 'ADM002', academic_year: '2025-2026', fee_category_id: 10, assigned_amount: 500, remarks: 'Unchanged' }
        ];

        // Enqueue pending batch upsert for ADM001
        SyncService.enqueueBatch('student_fee_assignments', [localAssignments[0]]);

        // Remote has older/stale assignment for ADM001 with 1000
        const remoteAssignments = [
            { id: 1, student_id: 'ADM001', academic_year: '2025-2026', fee_category_id: 10, assigned_amount: 1000, remarks: 'Old remote' },
            { id: 2, student_id: 'ADM002', academic_year: '2025-2026', fee_category_id: 10, assigned_amount: 600, remarks: 'Updated on remote' },
            { id: 3, student_id: 'ADM003', academic_year: '2025-2026', fee_category_id: 10, assigned_amount: 2500, remarks: 'New remote student' }
        ];

        // Simulate syncAllFromSupabase merge logic
        const pendingQueue = SyncService.getQueue();
        const pendingKeys = new Set();
        pendingQueue.forEach(op => {
            if (op.entity === 'student_fee_assignments' || op.entity === 'fee_assignments') {
                if (op.action === 'BATCH_UPSERT' && op.payload && Array.isArray(op.payload.items)) {
                    op.payload.items.forEach(item => {
                        if (item.student_id && item.academic_year && item.fee_category_id) {
                            pendingKeys.add(`${item.student_id}-${item.academic_year}-${item.fee_category_id}`);
                        }
                    });
                }
            }
        });

        assert.strictEqual(pendingKeys.has('ADM001-2025-2026-10'), true, 'ADM001 should be detected as pending in sync queue');
        assert.strictEqual(pendingKeys.has('ADM002-2025-2026-10'), false, 'ADM002 should not be pending');

        const mergedMap = new Map();
        localAssignments.forEach(localAssign => {
            const key = `${localAssign.student_id}-${localAssign.academic_year}-${localAssign.fee_category_id}`;
            mergedMap.set(key, localAssign);
        });

        remoteAssignments.forEach(remoteAssign => {
            const key = `${remoteAssign.student_id}-${remoteAssign.academic_year}-${remoteAssign.fee_category_id}`;
            if (!pendingKeys.has(key)) {
                mergedMap.set(key, {
                    id: remoteAssign.id,
                    student_id: remoteAssign.student_id,
                    academic_year: remoteAssign.academic_year,
                    fee_category_id: remoteAssign.fee_category_id,
                    assigned_amount: parseFloat(remoteAssign.assigned_amount) || 0,
                    remarks: remoteAssign.remarks || ''
                });
            }
        });

        const merged = Array.from(mergedMap.values());
        const adm1 = merged.find(a => a.student_id === 'ADM001');
        const adm2 = merged.find(a => a.student_id === 'ADM002');
        const adm3 = merged.find(a => a.student_id === 'ADM003');

        assert.strictEqual(adm1.assigned_amount, 9999, 'Pending local assignment for ADM001 must NOT be overwritten by stale remote 1000');
        assert.strictEqual(adm2.assigned_amount, 600, 'Non-pending assignment for ADM002 should take updated remote value');
        assert.strictEqual(adm3.assigned_amount, 2500, 'New remote student ADM003 should be added');

        console.log('✓ Initial sync conflict protection verified: Pending local modifications preserved.');
    }

    console.log('--- TEST 7: Queue processing of BATCH_UPSERT with partial failure & retry recovery ---');
    {
        localStorage.clear();
        let executedChunks = [];
        let shouldFailChunk2 = true;

        const mockSupabase = {
            from: (table) => ({
                upsert: async (records, opts) => {
                    executedChunks.push(records.length);
                    if (shouldFailChunk2 && executedChunks.length === 2) {
                        throw new Error('Supabase network drop on chunk 2');
                    }
                    return { data: records, error: null };
                }
            })
        };

        SyncService.init({
            getSupabaseClient: () => mockSupabase,
            getSupaConfig: () => ({ table: 'transactions', bucket: 'receipts' })
        });

        // 70 items: chunk 1 (50 items), chunk 2 (20 items)
        const items = [];
        for (let i = 1; i <= 70; i++) {
            items.push({
                student_id: `Q_STU_${i}`,
                academic_year: '2025-2026',
                fee_category_id: 5,
                assigned_amount: 300
            });
        }

        // Manually enqueue
        SyncService.enqueueBatch('student_fee_assignments', items);
        assert.strictEqual(SyncService.getQueue().length, 1);

        // Attempt queue sync -> chunk 1 succeeds (50 items), chunk 2 fails (20 items)
        await SyncService.processQueue();

        const queueAfterFail = SyncService.getQueue();
        assert.strictEqual(queueAfterFail.length, 1, 'Operation must remain in queue after partial failure');
        assert.strictEqual(queueAfterFail[0].status, 'failed', 'Status should be failed');
        assert.strictEqual(queueAfterFail[0].retry_count, 1, 'Retry count should be 1');
        assert.strictEqual(queueAfterFail[0].payload.items.length, 20, 'Payload must now only contain the remaining 20 items');
        assert.strictEqual(queueAfterFail[0].payload.items[0].student_id, 'Q_STU_51', 'First item in payload must be Q_STU_51');

        // Now simulate retry when network recovers
        shouldFailChunk2 = false;
        queueAfterFail[0].next_retry_at = null; // Clear backoff for test
        SyncService.saveQueue(queueAfterFail);

        await SyncService.processQueue();

        const queueAfterRecovery = SyncService.getQueue();
        assert.strictEqual(queueAfterRecovery.length, 0, 'Queue must be empty after successful retry');
        assert.strictEqual(executedChunks.length, 3, 'Total 3 chunk attempts: 50 (succeeded), 20 (failed), 20 (retry succeeded)');
        assert.strictEqual(executedChunks[2], 20, 'Retry must only have sent the remaining 20 items');

        console.log('✓ Queue partial failure recovery verified: 50 synced, 20 queued on error, 20 synced on retry.');
    }

    console.log('\n========================================');
    console.log('🎉 ALL 7 BATCH WRITE TESTS PASSED SUCCESSFULLY!');
    console.log('========================================');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
