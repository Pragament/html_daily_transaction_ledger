// dataService.js
// Supabase-first Data Access Layer with offline local caching

(function (window) {
    'use strict';

    const FACULTY_CACHE_KEY = 'school_accountant_faculty';
    const FACULTY_PAYMENTS_CACHE_KEY = 'school_accountant_faculty_payments';

    const DEFAULT_CATEGORIES = [
        { id: '46e24515-e4ed-4f47-9de9-ad205e3bf1b7', name: 'Salary' },
        { id: '974ee126-bda8-44c3-b45f-8996ec637fa4', name: 'Advance Salary' },
        { id: '13e77825-29ce-4805-b8e8-3f97705e9634', name: 'Bonus' },
        { id: 'c5fcac12-17dc-44a1-99b2-53d99b8305a1', name: 'Incentives' },
        { id: 'ce6b1874-922a-4a7c-ab36-6f5328bdc13f', name: 'Reimbursements' },
        { id: 'ce3cb120-923c-41d3-be2e-8ee37b34160b', name: 'Other Faculty Expenses' }
    ];

    function getClient() {
        return window.supabaseClient || null;
    }

    function getLocalFaculty() {
        try {
            const raw = localStorage.getItem(FACULTY_CACHE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn("Error reading local faculty cache:", e);
            return [];
        }
    }

    function saveLocalFaculty(list) {
        try {
            localStorage.setItem(FACULTY_CACHE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn("Error writing local faculty cache:", e);
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
            payments.unshift(payment);
            localStorage.setItem(FACULTY_PAYMENTS_CACHE_KEY, JSON.stringify(payments));
        } catch (e) {
            console.warn("Error saving local payment:", e);
        }
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

    const DataService = {
        async insertTransaction(tx, rev) {
            // Placeholder: Migrated progressively into app.js
        },

        // --- FACULTY API ---
        async getFaculty() {
            const supabase = getClient();
            if (supabase && isRealAuth()) {
                try {
                    // Check if there are unsynced offline faculty records to push
                    const localList = getLocalFaculty();
                    const unsynced = localList.filter(f => f.id && String(f.id).startsWith('fac_'));
                    if (unsynced.length > 0) {
                        try {
                            const upsertPayload = unsynced.map(f => ({
                                employee_id: f.employee_id,
                                faculty_name: f.name || f.faculty_name,
                                department: f.department || 'General',
                                designation: f.designation || 'Faculty',
                                mobile_number: f.mobile_number || '0000000000',
                                email: f.email || null,
                                joining_date: f.joining_date || new Date().toISOString().slice(0, 10),
                                salary: parseFloat(f.salary !== undefined ? f.salary : f.base_salary) || 0,
                                status: f.status || 'active'
                            }));
                            await supabase.from('faculty').upsert(upsertPayload, { onConflict: 'employee_id' });
                        } catch (pushErr) {
                            console.warn("Could not auto-push offline faculty to Supabase:", pushErr);
                        }
                    }

                    const { data, error } = await supabase
                        .from('faculty')
                        .select('*')
                        .order('faculty_name', { ascending: true });

                    if (!error && data) {
                        const mapped = data.map(f => ({
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
                        return mapped;
                    }
                    if (error) {
                        console.warn("Supabase getFaculty returned error, using local cache:", error.message);
                    }
                } catch (err) {
                    console.warn("Supabase fetch faculty error:", err);
                }
            }

            // Fallback to local cache
            return getLocalFaculty();
        },

        async getFacultyExpenseCategories() {
            const supabase = getClient();
            if (supabase) {
                try {
                    const { data, error } = await supabase
                        .from('faculty_expense_categories')
                        .select('id, name')
                        .eq('is_active', true)
                        .order('name', { ascending: true });
                    if (!error && data && data.length > 0) {
                        return data;
                    }
                } catch (e) {
                    console.warn("Could not fetch expense categories from Supabase:", e);
                }
            }
            return DEFAULT_CATEGORIES;
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
            let onlineSuccess = false;

            if (isRealAuth()) {
                try {
                    if (facultyData.id) {
                        const { data, error } = await supabase
                            .from('faculty')
                            .update(payload)
                            .eq('id', facultyData.id)
                            .select()
                            .single();
                        if (error) throw error;
                        savedRecord = data;
                        onlineSuccess = true;
                    } else {
                        const { data, error } = await supabase
                            .from('faculty')
                            .insert([payload])
                            .select()
                            .single();
                        if (error) throw error;
                        savedRecord = data;
                        onlineSuccess = true;
                    }
                } catch (err) {
                    console.error("Supabase saveFaculty error:", err);
                    throw err;
                }
            }

            // Sync with local cache
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
                            id: existing.id && !existing.id.startsWith('fac_') ? existing.id : undefined,
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
                        id: item.id || ('fac_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
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

            saveLocalFaculty(list);

            if (isRealAuth() && supabase && recordsToUpsertSupabase.length > 0) {
                try {
                    const BATCH_SIZE = 50;
                    for (let i = 0; i < recordsToUpsertSupabase.length; i += BATCH_SIZE) {
                        const chunk = recordsToUpsertSupabase.slice(i, i + BATCH_SIZE);
                        const cleanChunk = chunk.map(r => {
                            const obj = {
                                employee_id: r.employee_id,
                                faculty_name: r.faculty_name,
                                department: r.department,
                                designation: r.designation,
                                mobile_number: r.mobile_number,
                                email: r.email,
                                joining_date: r.joining_date,
                                salary: r.salary,
                                status: r.status
                            };
                            if (r.id) obj.id = r.id;
                            return obj;
                        });

                        const { error } = await supabase
                            .from('faculty')
                            .upsert(cleanChunk, { onConflict: 'employee_id' });

                        if (error) {
                            console.warn("Supabase batch upsert error (fallback to local):", error.message);
                        }
                    }
                } catch (supaErr) {
                    console.warn("Supabase batch import failed, saved in local storage:", supaErr);
                }
            }

            return {
                total: records.length,
                inserted: insertedCount,
                updated: updatedCount,
                skipped: skippedCount
            };
        },

        async payFacultySalary(payload) {
            const supabase = getClient();
            let categoryId = payload.expense_category_id;

            if (isRealAuth()) {
                if (!categoryId) {
                    const { data: cat } = await supabase
                        .from('faculty_expense_categories')
                        .select('id')
                        .ilike('name', '%Salary%')
                        .limit(1)
                        .maybeSingle();
                    categoryId = cat ? cat.id : null;
                }

                if (!categoryId) {
                    const { data: anyCat } = await supabase
                        .from('faculty_expense_categories')
                        .select('id')
                        .limit(1)
                        .maybeSingle();
                    categoryId = anyCat ? anyCat.id : null;
                }

                if (!categoryId) {
                    categoryId = DEFAULT_CATEGORIES[0].id;
                }

                const voucherNo = payload.reference || ('VCH-' + Date.now().toString().slice(-6));

                const { data, error } = await supabase.rpc('pay_faculty_salary', {
                    p_faculty_id: payload.faculty_id,
                    p_expense_category_id: categoryId,
                    p_payment_date: payload.payment_date,
                    p_voucher_number: voucherNo,
                    p_amount: Number(payload.amount),
                    p_payment_mode: payload.payment_method || 'Cash',
                    p_remarks: payload.remarks || '',
                    p_transaction_head: 'Expenses',
                    p_transaction_main_category: 'Faculty Expenses',
                    p_transaction_sub_category: payload.expense_category_name || 'Salary'
                });

                if (error) throw error;

                // Also record in local history cache
                saveLocalPayment({
                    id: 'pay_' + Date.now(),
                    faculty_id: payload.faculty_id,
                    expense_category: payload.expense_category_name || 'Salary',
                    payment_date: payload.payment_date,
                    amount: payload.amount,
                    payment_mode: payload.payment_method || 'Cash',
                    voucher_number: voucherNo,
                    remarks: payload.remarks || ''
                });

                return data;
            } else {
                // Offline fallback recording
                const voucherNo = payload.reference || ('VCH-OFFLINE-' + Date.now().toString().slice(-6));
                const paymentRecord = {
                    id: 'pay_' + Date.now(),
                    faculty_id: payload.faculty_id,
                    expense_category: payload.expense_category_name || 'Salary',
                    payment_date: payload.payment_date,
                    amount: payload.amount,
                    payment_mode: payload.payment_method || 'Cash',
                    voucher_number: voucherNo,
                    remarks: payload.remarks || ''
                };
                saveLocalPayment(paymentRecord);
                return { success: true, payment: paymentRecord };
            }
        },

        async getFacultySalaryHistory(facultyId) {
            const supabase = getClient();
            if (isRealAuth()) {
                try {
                    const { data, error } = await supabase
                        .from('faculty_expense_payments')
                        .select(`
                            id,
                            payment_date,
                            amount,
                            payment_mode,
                            voucher_number,
                            remarks,
                            faculty_expense_categories (
                                id,
                                name
                            )
                        `)
                        .eq('faculty_id', facultyId)
                        .order('payment_date', { ascending: false });

                    if (!error && data) {
                        return data.map(r => ({
                            id: r.id,
                            expense_category: r.faculty_expense_categories ? r.faculty_expense_categories.name : 'Salary',
                            remarks: r.remarks,
                            voucher_number: r.voucher_number,
                            payment_mode: r.payment_mode,
                            transactions: {
                                date: r.payment_date,
                                amount: r.amount,
                                particulars: r.remarks || `Salary payout (${r.voucher_number})`,
                                reference: r.voucher_number
                            }
                        }));
                    }
                } catch (e) {
                    console.warn("Supabase fetch salary history error:", e);
                }
            }

            // Fallback to local payment history
            const localPayments = getLocalPayments().filter(p => p.faculty_id === facultyId);
            return localPayments.map(p => ({
                id: p.id,
                expense_category: p.expense_category,
                remarks: p.remarks,
                voucher_number: p.voucher_number,
                payment_mode: p.payment_mode,
                transactions: {
                    date: p.payment_date,
                    amount: p.amount,
                    particulars: p.remarks || `Salary payout (${p.voucher_number})`,
                    reference: p.voucher_number
                }
            }));
        },

        async getAllFacultyPayments() {
            const supabase = getClient();
            if (isRealAuth() && supabase) {
                try {
                    const { data, error } = await supabase
                        .from('faculty_expense_payments')
                        .select(`
                            id,
                            faculty_id,
                            payment_date,
                            amount,
                            payment_mode,
                            voucher_number,
                            remarks,
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

                    if (!error && data) {
                        return data.map(r => ({
                            id: r.id,
                            faculty_id: r.faculty_id,
                            employee_id: r.faculty?.employee_id || '',
                            faculty_name: r.faculty?.faculty_name || '',
                            department: r.faculty?.department || '',
                            designation: r.faculty?.designation || '',
                            base_salary: parseFloat(r.faculty?.salary) || 0,
                            payment_date: r.payment_date,
                            amount: parseFloat(r.amount) || 0,
                            payment_mode: r.payment_mode || 'Cash',
                            voucher_number: r.voucher_number || '',
                            category: r.faculty_expense_categories?.name || 'Salary',
                            remarks: r.remarks || ''
                        }));
                    }
                } catch (e) {
                    console.warn("Error fetching all payments from Supabase:", e);
                }
            }

            // Fallback to local payment cache
            const localPayments = getLocalPayments();
            const localFaculty = getLocalFaculty();
            const facultyMap = new Map(localFaculty.map(f => [f.id, f]));

            return localPayments.map(p => {
                const fac = facultyMap.get(p.faculty_id);
                return {
                    id: p.id,
                    faculty_id: p.faculty_id,
                    employee_id: fac?.employee_id || '',
                    faculty_name: fac?.name || fac?.faculty_name || '',
                    department: fac?.department || '',
                    designation: fac?.designation || '',
                    base_salary: parseFloat(fac?.salary || fac?.base_salary) || 0,
                    payment_date: p.payment_date,
                    amount: parseFloat(p.amount) || 0,
                    payment_mode: p.payment_mode || 'Cash',
                    voucher_number: p.voucher_number || '',
                    category: p.expense_category || 'Salary',
                    remarks: p.remarks || ''
                };
            });
        }
    };

    window.DataService = DataService;
})(typeof window !== 'undefined' ? window : globalThis);
