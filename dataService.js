// dataService.js
// Supabase-first Data Access Layer for Pragament School Ledger

(function (window) {
    'use strict';

    const FACULTY_CACHE_KEY = 'school_accountant_faculty';
    const FACULTY_PAYMENTS_CACHE_KEY = 'school_accountant_faculty_payments';
    const FACULTY_CATEGORIES_CACHE_KEY = 'school_accountant_faculty_categories';

    const DEFAULT_CATEGORIES = [
        { id: '46e24515-e4ed-4f47-9de9-ad205e3bf1b7', name: 'Salary', is_active: true },
        { id: '974ee126-bda8-44c3-b45f-8996ec637fa4', name: 'Advance Salary', is_active: true },
        { id: '13e77825-29ce-4805-b8e8-3f97705e9634', name: 'Bonus', is_active: true },
        { id: 'c5fcac12-17dc-44a1-99b2-53d99b8305a1', name: 'Incentives', is_active: true },
        { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Travel Expense', is_active: true },
        { id: 'ce6b1874-922a-4a7c-ab36-6f5328bdc13f', name: 'Reimbursements', is_active: true },
        { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Gifts / Goodies', is_active: true },
        { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'Training / Workshop Expenses', is_active: true },
        { id: 'ce3cb120-923c-41d3-be2e-8ee37b34160b', name: 'Other Faculty Expenses', is_active: true }
    ];

    const CANONICAL_FACULTY_ORDER = [
        'salary',
        'advance salary',
        'bonus',
        'incentives',
        'travel expense',
        'reimbursements',
        'gifts / goodies',
        'training / workshop expenses',
        'other faculty expenses'
    ];

    function dedupeAndSortFacultyCategories(rawList, includeParent = false) {
        const byKey = new Map();
        (rawList || []).forEach(c => {
            if (!c || (!includeParent && c.parent_id === null)) return;
            const name = String(c.name || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!byKey.has(key)) {
                byKey.set(key, { ...c, name });
            }
        });
        return Array.from(byKey.values()).sort((a, b) => {
            const ia = CANONICAL_FACULTY_ORDER.indexOf(a.name.toLowerCase());
            const ib = CANONICAL_FACULTY_ORDER.indexOf(b.name.toLowerCase());
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    function getClient() {
        return window.supabaseClient || null;
    }

    function getLocalFaculty() {
        try {
            const raw = localStorage.getItem(FACULTY_CACHE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn('Error reading local faculty cache:', e);
            return [];
        }
    }

    function saveLocalFaculty(list) {
        try {
            localStorage.setItem(FACULTY_CACHE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('Error writing local faculty cache:', e);
        }
    }

    function getLocalPayments() {
        try {
            const raw = localStorage.getItem(FACULTY_PAYMENTS_CACHE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveLocalPayment(payment) {
        try {
            const payments = getLocalPayments();
            const existingIdx = payments.findIndex(p => p.id === payment.id || (payment.transaction_id && p.transaction_id === payment.transaction_id));
            if (existingIdx >= 0) {
                payments[existingIdx] = payment;
            } else {
                payments.unshift(payment);
            }
            localStorage.setItem(FACULTY_PAYMENTS_CACHE_KEY, JSON.stringify(payments));
        } catch (e) {
            console.warn('Error saving local payment:', e);
        }
    }

    function isDemoOfflineMode() {
        return Boolean(
            window.currentUser &&
            window.currentUser.email === 'admin@school.local'
        );
    }

    function isRealAuth() {
        return Boolean(
            window.supabaseClient &&
            window.currentUser &&
            window.currentUser.email &&
            window.currentUser.email !== 'admin@school.local' &&
            window.currentUser.id &&
            window.currentUser.id !== '00000000-0000-0000-0000-000000000000'
        );
    }

    function normalizePaymentMode(raw) {
        const rawMode = String(raw || 'cash').toLowerCase().trim();
        if (rawMode.includes('bank') || rawMode.includes('neft') || rawMode.includes('rtgs') || rawMode.includes('imps') || rawMode.includes('transfer')) {
            return 'bank_transfer';
        }
        if (rawMode.includes('cheque') || rawMode.includes('check')) {
            return 'cheque';
        }
        if (rawMode.includes('upi') || rawMode.includes('qr')) {
            return 'upi';
        }
        if (rawMode === 'cash') {
            return 'cash';
        }
        return 'other';
    }

    function formatSupabaseError(err, fallbackMsg) {
        if (!err) return fallbackMsg || 'Unknown database error';
        const msg = err.message || err.error_description || String(err);
        if (msg.includes('DUPLICATE_RECEIPT')) return msg.replace(/^.*DUPLICATE_RECEIPT:\s*/i, '');
        if (msg.includes('DUPLICATE_VOUCHER') || msg.includes('uq_faculty_payment_school_voucher')) {
            return msg.includes('DUPLICATE_VOUCHER:')
                ? msg.replace(/^.*DUPLICATE_VOUCHER:\s*/i, '')
                : 'A voucher with this number already exists.';
        }
        if (msg.includes('OVERPAYMENT_REJECTED')) return msg.replace(/^.*OVERPAYMENT_REJECTED:\s*/i, '');
        if (msg.includes('INACTIVE_STUDENT')) return msg.replace(/^.*INACTIVE_STUDENT:\s*/i, '');
        if (msg.includes('INACTIVE_FACULTY')) return msg.replace(/^.*INACTIVE_FACULTY:\s*/i, '');
        if (msg.includes('LEDGER_ACCESS_DENIED') || msg.includes('LEDGER_PERMISSION_DENIED') || err.code === '42501') {
            return 'Access denied: Your account is not authorized to perform this Ledger operation.';
        }
        return msg;
    }

    const DataService = {
        isRealAuth,
        isDemoOfflineMode,
        normalizePaymentMode,
        formatSupabaseError,

        // --- STUDENT FEE PAYMENT RPC ---
        async recordStudentFeePayment(payload) {
            const supabase = getClient();
            if (isDemoOfflineMode()) {
                return null; // Caller handles explicit Demo Offline Mode locally
            }
            if (!supabase || !isRealAuth()) {
                throw new Error('Authentication required. Please sign in to record fee payments in Supabase.');
            }
            if (!navigator.onLine) {
                throw new Error('You appear to be offline. Fee payments require an active Supabase connection.');
            }

            const rpcParams = {
                p_student_id: payload.student_id,
                p_academic_year: payload.academic_year,
                p_fee_assignment_id: payload.fee_assignment_id || null,
                p_fee_category_id: payload.fee_category_id || null,
                p_fee_month: payload.fee_month || '',
                p_payment_date: payload.payment_date,
                p_amount: Number(payload.amount),
                p_payment_mode: normalizePaymentMode(payload.payment_mode),
                p_receipt_number: String(payload.receipt_number || '').trim(),
                p_reference_number: payload.reference_number ? String(payload.reference_number).trim() : null,
                p_remarks: payload.remarks ? String(payload.remarks).trim() : null
            };

            const { data, error } = await supabase.rpc('record_student_fee_payment', rpcParams);
            if (error) {
                throw new Error(formatSupabaseError(error, 'Failed to record student fee payment.'));
            }
            return data;
        },

        // --- FACULTY API ---
        async getFaculty(options = {}) {
            const supabase = getClient();
            if (isDemoOfflineMode()) {
                return getLocalFaculty();
            }
            if (!supabase || !isRealAuth()) {
                throw new Error('Authentication required to load faculty directory.');
            }

            const { data, error } = await supabase
                .from('faculty')
                .select('*')
                .order('faculty_name', { ascending: true });

            if (error) {
                throw new Error(formatSupabaseError(error, 'Failed to fetch faculty directory from Supabase.'));
            }

            const mapped = (data || []).map(f => ({
                id: f.id,
                employee_id: f.employee_id,
                name: f.faculty_name,
                faculty_name: f.faculty_name,
                department: f.department,
                designation: f.designation,
                mobile_number: f.mobile_number,
                email: f.email,
                joining_date: f.joining_date,
                base_salary: f.salary !== undefined && f.salary !== null ? parseFloat(f.salary) : 0,
                salary: f.salary !== undefined && f.salary !== null ? parseFloat(f.salary) : 0,
                status: f.status || 'active'
            }));
            saveLocalFaculty(mapped);
            window.currentFacultyList = mapped;
            return mapped;
        },

        async getFacultyExpenseCategories(options = {}) {
            const includeInactive = Boolean(options.includeInactive);
            const includeParent = Boolean(options.includeParent);
            const supabase = getClient();

            if (isDemoOfflineMode()) {
                try {
                    const cached = localStorage.getItem(FACULTY_CATEGORIES_CACHE_KEY);
                    if (cached) {
                        const list = JSON.parse(cached);
                        const filtered = includeInactive ? list : list.filter(c => c.is_active !== false);
                        return dedupeAndSortFacultyCategories(filtered, includeParent);
                    }
                } catch (e) {}
                return dedupeAndSortFacultyCategories(DEFAULT_CATEGORIES, includeParent);
            }

            if (supabase && isRealAuth()) {
                let query = supabase
                    .from('faculty_expense_categories')
                    .select('id, parent_id, name, is_active')
                    .order('name', { ascending: true });

                if (!includeInactive) {
                    query = query.eq('is_active', true);
                }

                const { data, error } = await query;
                if (error) {
                    throw new Error(formatSupabaseError(error, 'Failed to load faculty expense categories.'));
                }
                const list = dedupeAndSortFacultyCategories(data || [], includeParent);
                try {
                    localStorage.setItem(FACULTY_CATEGORIES_CACHE_KEY, JSON.stringify(list));
                } catch (e) {}
                return list;
            }

            return dedupeAndSortFacultyCategories(DEFAULT_CATEGORIES, includeParent);
        },

        async saveFacultyExpenseCategory({ id = null, name, is_active = true }) {
            const cleanName = String(name || '').trim();
            if (!cleanName) throw new Error('Category name is required.');

            if (isDemoOfflineMode()) {
                const list = await this.getFacultyExpenseCategories({ includeInactive: true });
                if (id) {
                    const item = list.find(c => c.id === id);
                    if (item) {
                        item.name = cleanName;
                        item.is_active = is_active;
                    }
                } else {
                    list.push({ id: 'demo_' + Date.now(), name: cleanName, is_active: true });
                }
                localStorage.setItem(FACULTY_CATEGORIES_CACHE_KEY, JSON.stringify(list));
                return list;
            }

            const supabase = getClient();
            if (!supabase || !isRealAuth()) throw new Error('Authentication required.');

            if (id) {
                const { data, error } = await supabase
                    .from('faculty_expense_categories')
                    .update({ name: cleanName, is_active, updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .select()
                    .single();
                if (error) throw new Error(formatSupabaseError(error, 'Failed to update faculty expense category.'));
                return data;
            }

            // Resolve parent 'Faculty Expenses' category
            const { data: parentRow } = await supabase
                .from('faculty_expense_categories')
                .select('id, school_id')
                .is('parent_id', null)
                .ilike('name', 'Faculty Expenses')
                .limit(1)
                .maybeSingle();

            if (!parentRow) {
                throw new Error('Root Faculty Expenses category was not found.');
            }

            const { data, error } = await supabase
                .from('faculty_expense_categories')
                .insert([{
                    school_id: parentRow.school_id,
                    parent_id: parentRow.id,
                    name: cleanName,
                    is_active: true
                }])
                .select()
                .single();
            if (error) throw new Error(formatSupabaseError(error, 'Failed to create faculty expense category.'));
            return data;
        },

        async saveFaculty(facultyData) {
            const supabase = getClient();
            const salaryNum = (facultyData.base_salary !== null && facultyData.base_salary !== undefined && !isNaN(facultyData.base_salary))
                ? parseFloat(facultyData.base_salary)
                : 0;

            const payload = {
                employee_id: facultyData.employee_id,
                faculty_name: facultyData.name || facultyData.faculty_name,
                department: facultyData.department || 'General',
                designation: facultyData.designation || 'Faculty',
                mobile_number: facultyData.mobile_number || '0000000000',
                email: facultyData.email || null,
                joining_date: facultyData.joining_date || new Date().toISOString().slice(0, 10),
                salary: salaryNum,
                status: facultyData.status || 'active'
            };

            let savedRecord = null;

            if (isRealAuth()) {
                if (!supabase) throw new Error('Supabase client is not initialized.');
                if (facultyData.id && !String(facultyData.id).startsWith('fac_')) {
                    const { data, error } = await supabase
                        .from('faculty')
                        .update(payload)
                        .eq('id', facultyData.id)
                        .select()
                        .single();
                    if (error) throw new Error(formatSupabaseError(error, 'Failed to update faculty profile.'));
                    savedRecord = data;
                } else {
                    const { data, error } = await supabase
                        .from('faculty')
                        .insert([payload])
                        .select()
                        .single();
                    if (error) throw new Error(formatSupabaseError(error, 'Failed to save new faculty profile.'));
                    savedRecord = data;
                }
            } else if (!isDemoOfflineMode()) {
                throw new Error('Authentication required to save faculty records.');
            }

            const list = getLocalFaculty();
            const record = {
                id: (savedRecord && savedRecord.id) || facultyData.id || ('fac_' + Date.now()),
                employee_id: payload.employee_id,
                name: payload.faculty_name,
                faculty_name: payload.faculty_name,
                department: payload.department,
                designation: payload.designation,
                mobile_number: payload.mobile_number,
                email: payload.email,
                joining_date: payload.joining_date,
                base_salary: payload.salary,
                salary: payload.salary,
                status: payload.status
            };

            const idx = list.findIndex(f => f.id === record.id || f.employee_id === record.employee_id);
            if (idx >= 0) {
                list[idx] = record;
            } else {
                list.push(record);
            }
            saveLocalFaculty(list);

            return record;
        },

        async importFacultyBatch(records, options = { updateDuplicates: true }) {
            const updateDuplicates = options.updateDuplicates !== false;
            const supabase = getClient();
            const list = getLocalFaculty();
            let insertedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;

            const recordsToUpsertSupabase = [];

            records.forEach(item => {
                const salaryNum = (item.salary !== null && item.salary !== undefined && !isNaN(item.salary))
                    ? parseFloat(item.salary)
                    : (item.base_salary ? parseFloat(item.base_salary) : 0);

                const existingIdx = list.findIndex(f => f.employee_id === item.employee_id);

                if (existingIdx >= 0) {
                    if (updateDuplicates) {
                        const existing = list[existingIdx];
                        const updated = {
                            ...existing,
                            name: item.name || item.faculty_name || existing.name,
                            faculty_name: item.name || item.faculty_name || existing.faculty_name,
                            department: item.department || existing.department || 'General',
                            designation: item.designation || existing.designation || 'Faculty',
                            mobile_number: item.mobile_number || existing.mobile_number || '0000000000',
                            email: item.email !== undefined ? item.email : existing.email,
                            joining_date: item.joining_date || existing.joining_date || new Date().toISOString().slice(0, 10),
                            base_salary: salaryNum,
                            salary: salaryNum,
                            status: item.status || existing.status || 'active'
                        };
                        list[existingIdx] = updated;
                        updatedCount++;
                        recordsToUpsertSupabase.push({
                            employee_id: updated.employee_id,
                            faculty_name: updated.faculty_name,
                            department: updated.department,
                            designation: updated.designation,
                            mobile_number: updated.mobile_number,
                            email: updated.email,
                            joining_date: updated.joining_date,
                            salary: updated.salary,
                            status: updated.status
                        });
                    } else {
                        skippedCount++;
                    }
                } else {
                    const newRecord = {
                        id: item.id || ('fac_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                        employee_id: item.employee_id,
                        name: item.name || item.faculty_name,
                        faculty_name: item.name || item.faculty_name,
                        department: item.department || 'General',
                        designation: item.designation || 'Faculty',
                        mobile_number: item.mobile_number || '0000000000',
                        email: item.email || null,
                        joining_date: item.joining_date || new Date().toISOString().slice(0, 10),
                        base_salary: salaryNum,
                        salary: salaryNum,
                        status: item.status || 'active'
                    };
                    list.push(newRecord);
                    insertedCount++;
                    recordsToUpsertSupabase.push({
                        employee_id: newRecord.employee_id,
                        faculty_name: newRecord.faculty_name,
                        department: newRecord.department,
                        designation: newRecord.designation,
                        mobile_number: newRecord.mobile_number,
                        email: newRecord.email,
                        joining_date: newRecord.joining_date,
                        salary: newRecord.salary,
                        status: newRecord.status
                    });
                }
            });

            if (isRealAuth() && supabase && recordsToUpsertSupabase.length > 0) {
                const BATCH_SIZE = 50;
                for (let i = 0; i < recordsToUpsertSupabase.length; i += BATCH_SIZE) {
                    const chunk = recordsToUpsertSupabase.slice(i, i + BATCH_SIZE);
                    const { error } = await supabase
                        .from('faculty')
                        .upsert(chunk, { onConflict: 'school_id,employee_id' });

                    if (error) {
                        // Retry on legacy employee_id conflict constraint if school_id conflict target differs
                        const { error: retryErr } = await supabase
                            .from('faculty')
                            .upsert(chunk, { onConflict: 'employee_id' });
                        if (retryErr) {
                            throw new Error(formatSupabaseError(retryErr, 'Supabase faculty batch import failed.'));
                        }
                    }
                }
            } else if (!isDemoOfflineMode()) {
                throw new Error('Authentication required to import faculty records.');
            }

            saveLocalFaculty(list);

            return {
                total: records.length,
                inserted: insertedCount,
                updated: updatedCount,
                skipped: skippedCount
            };
        },

        async recordFacultyExpense(payload) {
            const supabase = getClient();

            if (!payload.faculty_id) {
                throw new Error('Please select a valid faculty member.');
            }
            if (!payload.amount || isNaN(payload.amount) || Number(payload.amount) <= 0) {
                throw new Error('Expense amount must be greater than zero.');
            }

            const voucherNo = String(payload.voucher_number || payload.reference || '').trim() || ('VCH-' + Date.now().toString().slice(-6));
            const mode = normalizePaymentMode(payload.payment_method || payload.payment_mode || 'cash');

            if (isDemoOfflineMode()) {
                const txId = typeof window.getNextId === 'function' ? window.getNextId() : Math.floor(Date.now() / 1000);
                const paymentRecord = {
                    id: 'pay_' + Date.now(),
                    transaction_id: txId,
                    faculty_id: payload.faculty_id,
                    faculty_name: payload.faculty_name || '',
                    employee_id: payload.employee_id || '',
                    department: payload.department || '',
                    designation: payload.designation || '',
                    expense_category_id: payload.expense_category_id,
                    expense_category: payload.expense_category_name || 'Salary',
                    category: payload.expense_category_name || 'Salary',
                    payment_date: payload.payment_date,
                    amount: Number(payload.amount),
                    payment_mode: mode,
                    voucher_number: voucherNo,
                    reference_number: payload.reference_number || null,
                    salary_month: payload.salary_month || null,
                    particulars: payload.particulars || payload.remarks || '',
                    remarks: payload.remarks || '',
                    status: 'completed'
                };
                saveLocalPayment(paymentRecord);
                return paymentRecord;
            }

            if (!supabase || !isRealAuth()) {
                throw new Error('Authentication required. Please sign in to record faculty expenses in Supabase.');
            }
            if (!navigator.onLine) {
                throw new Error('You appear to be offline. Faculty expenses require an active Supabase connection.');
            }

            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            let categoryId = payload.expense_category_id;
            if (!categoryId || !uuidRegex.test(categoryId)) {
                const targetName = payload.expense_category_name || 'Salary';
                const { data: cat } = await supabase
                    .from('faculty_expense_categories')
                    .select('id, name')
                    .ilike('name', targetName)
                    .eq('is_active', true)
                    .limit(1)
                    .maybeSingle();
                categoryId = cat ? cat.id : null;
            }
            if (!categoryId) {
                throw new Error('Selected faculty expense category was not found or is inactive.');
            }

            const { data, error } = await supabase.rpc('record_faculty_expense', {
                p_faculty_id: payload.faculty_id,
                p_expense_category_id: categoryId,
                p_payment_date: payload.payment_date,
                p_voucher_number: voucherNo,
                p_amount: Number(payload.amount),
                p_payment_mode: mode,
                p_reference_number: payload.reference_number ? String(payload.reference_number).trim() : null,
                p_salary_month: payload.salary_month ? String(payload.salary_month).trim() : null,
                p_particulars: payload.particulars ? String(payload.particulars).trim() : null,
                p_remarks: payload.remarks ? String(payload.remarks).trim() : null
            });

            if (error) {
                throw new Error(formatSupabaseError(error, 'Failed to record faculty expense.'));
            }

            const resultRecord = {
                id: data.payment_id,
                payment_id: data.payment_id,
                transaction_id: data.transaction_id,
                faculty_id: data.faculty_id,
                faculty_name: data.faculty_name || payload.faculty_name || '',
                employee_id: data.employee_id || payload.employee_id || '',
                department: data.department || payload.department || '',
                designation: data.designation || payload.designation || '',
                expense_category_id: data.expense_category_id || categoryId,
                expense_category: data.expense_category || payload.expense_category_name || 'Salary',
                category: data.expense_category || payload.expense_category_name || 'Salary',
                payment_date: data.payment_date || payload.payment_date,
                amount: Number(data.amount || payload.amount),
                payment_mode: data.payment_mode || mode,
                voucher_number: data.voucher_number || voucherNo,
                reference_number: data.reference_number || payload.reference_number || '',
                salary_month: data.salary_month || payload.salary_month || '',
                particulars: data.particulars || payload.particulars || '',
                remarks: data.remarks || payload.remarks || '',
                created_by: data.created_by || window.currentUser.email,
                status: 'completed'
            };

            saveLocalPayment(resultRecord);
            return resultRecord;
        },

        async payFacultySalary(payload) {
            return await this.recordFacultyExpense({
                ...payload,
                voucher_number: payload.voucher_number || payload.reference || ('SAL-' + Date.now().toString().slice(-6)),
                reference_number: payload.reference_number || (payload.payment_method !== 'Cash' ? payload.reference : null),
                expense_category_name: payload.expense_category_name || 'Salary'
            });
        },

        async getFacultySalaryHistory(facultyId) {
            const supabase = getClient();
            if (isDemoOfflineMode()) {
                const localPayments = getLocalPayments().filter(p => p.faculty_id === facultyId);
                return localPayments.map(p => ({
                    id: p.id,
                    transaction_id: p.transaction_id,
                    expense_category: p.expense_category || p.category || 'Salary',
                    payment_date: p.payment_date,
                    amount: Number(p.amount) || 0,
                    remarks: p.remarks || '',
                    particulars: p.particulars || p.remarks || '',
                    voucher_number: p.voucher_number || '',
                    reference_number: p.reference_number || '',
                    salary_month: p.salary_month || '',
                    payment_mode: p.payment_mode || 'cash',
                    status: p.status || 'completed',
                    transactions: {
                        date: p.payment_date,
                        amount: p.amount,
                        particulars: p.particulars || p.remarks || `${p.expense_category || 'Salary'} (${p.voucher_number})`,
                        reference: p.voucher_number
                    }
                }));
            }

            if (!supabase || !isRealAuth()) {
                throw new Error('Authentication required to view faculty financial history.');
            }

            const { data, error } = await supabase
                .from('faculty_expense_payments')
                .select(`
                    id,
                    transaction_id,
                    payment_date,
                    amount,
                    payment_mode,
                    voucher_number,
                    reference_number,
                    salary_month,
                    particulars,
                    remarks,
                    status,
                    created_by,
                    faculty_expense_categories (
                        id,
                        name
                    )
                `)
                .eq('faculty_id', facultyId)
                .order('payment_date', { ascending: false });

            if (error) {
                throw new Error(formatSupabaseError(error, 'Failed to fetch faculty payment history.'));
            }

            return (data || []).map(r => ({
                id: r.id,
                transaction_id: r.transaction_id,
                expense_category: r.faculty_expense_categories ? r.faculty_expense_categories.name : 'Salary',
                payment_date: r.payment_date,
                amount: parseFloat(r.amount) || 0,
                remarks: r.remarks || '',
                particulars: r.particulars || r.remarks || '',
                voucher_number: r.voucher_number || '',
                reference_number: r.reference_number || '',
                salary_month: r.salary_month || '',
                payment_mode: r.payment_mode || 'cash',
                status: r.status || 'completed',
                created_by: r.created_by,
                transactions: {
                    date: r.payment_date,
                    amount: r.amount,
                    particulars: r.particulars || r.remarks || `Voucher (${r.voucher_number})`,
                    reference: r.voucher_number
                }
            }));
        },

        async getAllFacultyPayments() {
            const supabase = getClient();
            if (isDemoOfflineMode()) {
                const localPayments = getLocalPayments();
                const localFaculty = getLocalFaculty();
                const facultyMap = new Map(localFaculty.map(f => [f.id, f]));
                return localPayments.map(p => {
                    const fac = facultyMap.get(p.faculty_id);
                    return {
                        id: p.id,
                        transaction_id: p.transaction_id,
                        faculty_id: p.faculty_id,
                        employee_id: fac?.employee_id || p.employee_id || '',
                        faculty_name: fac?.name || fac?.faculty_name || p.faculty_name || '',
                        department: fac?.department || p.department || '',
                        designation: fac?.designation || p.designation || '',
                        base_salary: parseFloat(fac?.salary || fac?.base_salary) || 0,
                        payment_date: p.payment_date,
                        amount: parseFloat(p.amount) || 0,
                        payment_mode: p.payment_mode || 'cash',
                        voucher_number: p.voucher_number || '',
                        reference_number: p.reference_number || '',
                        salary_month: p.salary_month || '',
                        particulars: p.particulars || p.remarks || '',
                        expense_category: p.expense_category || p.category || 'Salary',
                        category: p.expense_category || p.category || 'Salary',
                        remarks: p.remarks || '',
                        status: p.status || 'completed'
                    };
                });
            }

            if (!supabase || !isRealAuth()) {
                throw new Error('Authentication required to load faculty payments.');
            }

            const { data, error } = await supabase
                .from('faculty_expense_payments')
                .select(`
                    id,
                    transaction_id,
                    faculty_id,
                    payment_date,
                    amount,
                    payment_mode,
                    voucher_number,
                    reference_number,
                    salary_month,
                    particulars,
                    remarks,
                    status,
                    faculty_expense_categories (
                        id,
                        name
                    ),
                    faculty (
                        id,
                        employee_id,
                        faculty_name,
                        department,
                        designation,
                        salary,
                        status
                    )
                `)
                .order('payment_date', { ascending: false });

            if (error) {
                throw new Error(formatSupabaseError(error, 'Failed to fetch faculty expense payments from Supabase.'));
            }

            const mapped = (data || []).map(r => ({
                id: r.id,
                transaction_id: r.transaction_id,
                faculty_id: r.faculty_id,
                employee_id: r.faculty?.employee_id || '',
                faculty_name: r.faculty?.faculty_name || '',
                department: r.faculty?.department || '',
                designation: r.faculty?.designation || '',
                base_salary: parseFloat(r.faculty?.salary) || 0,
                payment_date: r.payment_date,
                amount: parseFloat(r.amount) || 0,
                payment_mode: r.payment_mode || 'cash',
                voucher_number: r.voucher_number || '',
                reference_number: r.reference_number || '',
                salary_month: r.salary_month || '',
                particulars: r.particulars || r.remarks || '',
                expense_category: r.faculty_expense_categories?.name || 'Salary',
                category: r.faculty_expense_categories?.name || 'Salary',
                remarks: r.remarks || '',
                status: r.status || 'completed'
            }));
            try {
                localStorage.setItem(FACULTY_PAYMENTS_CACHE_KEY, JSON.stringify(mapped));
            } catch (e) {}
            return mapped;
        }
    };

    window.DataService = DataService;
})(typeof window !== 'undefined' ? window : globalThis);
