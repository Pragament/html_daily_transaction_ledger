        // ─── Single Application Configuration ───
        const APP_CONFIG = {
            supabase: {
                url: "",
                key: "",
                table: "transactions",
                bucket: "receipts"
            }
        };

        // ─── Utility: HTML Escaping ───
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // ─── Load Configuration from .env file ───
        async function loadEnvConfig() {
            try {
                // Primary: Fetch .env directly
                const response = await fetch('.env');
                if (response.ok) {
                    const text = await response.text();
                    const envVars = {};
                    text.split(/\r?\n/).forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return;
                        const eqIndex = trimmed.indexOf('=');
                        if (eqIndex !== -1) {
                            const key = trimmed.slice(0, eqIndex).trim();
                            let val = trimmed.slice(eqIndex + 1).trim();
                            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                                val = val.slice(1, -1);
                            }
                            envVars[key] = val;
                        }
                    });

                    const supaUrl = envVars.SUPABASE_URL;
                    const supaKey = envVars.SUPABASE_ANON_KEY || envVars.SUPABASE_KEY;

                    if (supaUrl && supaKey) {
                        APP_CONFIG.supabase.url = supaUrl;
                        APP_CONFIG.supabase.key = supaKey;
                        if (envVars.SUPABASE_TABLE) APP_CONFIG.supabase.table = envVars.SUPABASE_TABLE;
                        if (envVars.SUPABASE_BUCKET) APP_CONFIG.supabase.bucket = envVars.SUPABASE_BUCKET;
                        console.log("✅ Configuration loaded successfully from .env file.");
                        return;
                    }
                }
            } catch (e) {
                console.warn("Could not fetch .env file directly:", e);
            }

            // Fallback: window.APP_CONFIG_ENV if provided
            if (window.APP_CONFIG_ENV && window.APP_CONFIG_ENV.supabase) {
                Object.assign(APP_CONFIG.supabase, window.APP_CONFIG_ENV.supabase);
                console.log("Configuration loaded from window.APP_CONFIG_ENV fallback.");
                return;
            }

            console.warn("No Supabase configuration found in .env.");
            showToast("Configuration not found. Please check your .env file.", "error");
        }

        // ─── Auth State ───
        let supabaseAuthListenerAttached = false;
        let initialSessionResolved = false;

        // ════════════════════════════════════════════════════════════════
        //  STATE
        // ════════════════════════════════════════════════════════════════
        let transactions = [];
        let nextId = 1;
        const STORAGE_KEY = 'school_accountant_data';
        const CONFIG_KEY = 'school_accountant_config';
        const CATEGORIES_KEY = 'school_accountant_categories';
        const TAGS_KEY = 'school_accountant_tags';
        const STUDENTS_KEY = 'school_accountant_students';
        const REVISIONS_KEY = 'school_accountant_revisions';
        const ACTIVITIES_KEY = 'school_accountant_activities';
        const FEE_STRUCTURES_KEY = 'school_accountant_fee_structures';
        const FEE_PAYMENTS_KEY = 'school_accountant_fee_payments';
        let feeStructures = [];
        let feePayments = [];
        const STUDENT_FEE_ASSIGNMENTS_KEY = 'school_accountant_student_fee_assignments';
        let studentFeeAssignments = [];

        function getCurrentAcademicYear(dateStr) {
            const date = dateStr ? new Date(dateStr) : new Date();
            if (isNaN(date.getTime())) return '2026-27'; // safe fallback
            const year = date.getFullYear();
            const month = date.getMonth(); // 0-indexed: Jan is 0, Apr is 3
            if (month >= 3) {
                return `${year}-${String(year + 1).slice(-2)}`;
            } else {
                return `${year - 1}-${String(year).slice(-2)}`;
            }
        }

        function extractMonthFromParticulars(particulars) {
            if (!particulars) return '';
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
                            'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            for (const m of months) {
                const regex = new RegExp(`\\b${m}\\b`, 'i');
                if (regex.test(particulars)) {
                    const idx = months.indexOf(m) % 12;
                    const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                    return fullMonths[idx];
                }
            }
            return '';
        }

        let categories = [];
        let tags = [];
        let students = [];
        const LAST_IMPORTED_KEY = 'school_accountant_students_last_imported';
        let studentsLastImported = localStorage.getItem(LAST_IMPORTED_KEY) || '';

        // Student Directory State
        let studentSortBy = 'name';
        let studentSortOrder = 'asc';
        let studentCurrentPage = 1;
        let studentPageSize = 25;
        let revisions = [];
        let activities = [];
        let currentUser = null;
        let userProfileData = null;

        const DEFAULT_CATEGORIES = [
            { id: 1, name: 'Fees', parent_id: null, type: 'all' },
            { id: 2, name: 'Registration', parent_id: 1, type: 'all' },
            { id: 3, name: 'Tuition', parent_id: 1, type: 'all' },
            { id: 4, name: 'Hostel', parent_id: 1, type: 'all' },
            { id: 5, name: 'Transport', parent_id: 1, type: 'all' },
            { id: 6, name: 'Exam', parent_id: 1, type: 'all' },
            { id: 7, name: 'Operations', parent_id: null, type: 'all' },
            { id: 8, name: 'Bank Deposit', parent_id: 7, type: 'all' },
            { id: 9, name: 'Refreshment', parent_id: 7, type: 'all' },
            { id: 10, name: 'Stationary', parent_id: 7, type: 'all' },
            { id: 11, name: 'Equipment', parent_id: null, type: 'all' },
            { id: 12, name: 'Event', parent_id: null, type: 'all' },
            { id: 13, name: 'Medical', parent_id: null, type: 'all' }
        ];

        const DEFAULT_TAGS = ['semester1', 'semester2', 'cash', 'cheque', 'online', 'draft', 'urgent', 'pending', 'reimbursement'];

        // ─── Supabase client ───
        let supabaseClient = null;
        let supaConfig = APP_CONFIG.supabase;

        // ─── Authentication Functions ───

        window.loginWithGoogle = async function() {
            try {
                if (!supabaseClient) {
                    showToast('Supabase client not initialized.', 'error');
                    return;
                }
                const googleBtn = document.getElementById('auth-google-btn');
                if (googleBtn) {
                    googleBtn.disabled = true;
                    googleBtn.innerHTML = '<span class="spinner"></span> Connecting to Google...';
                }
                const basePath = window.location.pathname.replace(/\/[^/]*$/, '/');
                const redirectTo = window.location.origin + basePath + 'index.html';
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: redirectTo,
                        queryParams: {
                            prompt: 'select_account'
                        }
                    }
                });
                if (error) throw error;
            } catch (e) {
                const googleBtn = document.getElementById('auth-google-btn');
                if (googleBtn) {
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = '<span>Continue with Google</span>';
                }
                showToast('Google Sign-In failed: ' + e.message, 'error');
                console.error('Google Sign-In error:', e);
            }
        };

        let currentAuthTab = 'login';
        window.switchAuthTab = function(tab) {
            currentAuthTab = tab;
            const loginBtn = document.getElementById('tab-login-btn');
            const signupBtn = document.getElementById('tab-signup-btn');
            const submitBtn = document.getElementById('auth-submit-btn');
            const nameGroup = document.getElementById('register-name-group');
            const nameInput = document.getElementById('auth-name');
            
            if (tab === 'login') {
                loginBtn.classList.add('active');
                signupBtn.classList.remove('active');
                submitBtn.textContent = 'Sign In';
                if (nameGroup) nameGroup.style.display = 'none';
                if (nameInput) nameInput.removeAttribute('required');
            } else {
                loginBtn.classList.remove('active');
                signupBtn.classList.add('active');
                submitBtn.textContent = 'Register Account';
                if (nameGroup) nameGroup.style.display = 'block';
                if (nameInput) nameInput.setAttribute('required', '');
            }
        };

        window.handleAuthSubmit = async function(event) {
            event.preventDefault();
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const submitBtn = document.getElementById('auth-submit-btn');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Working...';
            
            try {
                if (currentAuthTab === 'login') {
                    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    showToast('Signed in successfully!', 'success');
                } else {
                    const name = document.getElementById('auth-name').value.trim();
                    const { data, error } = await supabaseClient.auth.signUp({
                        email,
                        password,
                        options: { data: { full_name: name || '' } }
                    });
                    if (error) throw error;
                    if (data.session) {
                        showToast('Account created successfully!', 'success');
                    } else {
                        showToast('Verification email sent! Please check your inbox.', 'success');
                        switchAuthTab('login');
                    }
                }
            } catch (err) {
                showToast(err.message || 'Authentication failed. Please try again.', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        };

        async function logout() {

            currentUser = null;
            userProfileData = null;

            const loginView = document.getElementById('loginView');
            const dashboardView = document.getElementById('dashboardView');
            const userProfile = document.getElementById('userProfile');

            if (dashboardView) dashboardView.style.display = 'none';
            if (loginView) loginView.style.display = 'block';
            if (userProfile) userProfile.style.display = 'none';

            try {
                await supabaseClient.auth.signOut();
                showToast('Signed out successfully', 'success');
            } catch (e) {
                showToast('Sign out failed: ' + e.message, 'error');
                console.error(e);
            }
        }



        async function pushFeeStructure(struct) {
            if (!supabaseClient || !supaConfig || !navigator.onLine) return;
            try {
                const dbData = {
                    academic_year: struct.academic_year,
                    class: struct.class,
                    fee_type: struct.fee_type,
                    amount: struct.amount,
                    frequency: struct.frequency
                };
                if (struct.id) {
                    dbData.id = struct.id;
                }
                const { data, error } = await supabaseClient
                    .from('fee_structures')
                    .upsert(dbData)
                    .select();
                if (error) throw error;
                if (data && data[0] && !struct.id) {
                    struct.id = data[0].id;
                    localStorage.setItem(FEE_STRUCTURES_KEY, JSON.stringify(feeStructures));
                }
            } catch (e) {
                console.error("Failed to push fee structure to Supabase:", e);
            }
        }

        async function syncAllFromSupabase() {
            if (!supabaseClient || !supaConfig) return;
            try {
                showToast('⏳ Syncing from Supabase...', 'info', 3000);

                // Upload local fee structures to Supabase first if online
                if (navigator.onLine) {
                    for (let struct of feeStructures) {
                        await pushFeeStructure(struct);
                    }
                }

                // Upload local student fee assignments to Supabase in batches if online
                if (navigator.onLine && supabaseClient && studentFeeAssignments.length > 0) {
                    
                        const BATCH_SIZE = 50;
                        for (let i = 0; i < studentFeeAssignments.length; i += BATCH_SIZE) {
                            const chunk = studentFeeAssignments.slice(i, i + BATCH_SIZE);
                            try {
                                await supabaseClient
                                    .from('student_fee_assignments')
                                    .upsert(chunk, { onConflict: 'student_id,academic_year,fee_category_id' });
                            } catch (e) {
                                console.error("Failed to batch upload student fee assignments to Supabase:", e);
                            }
                        }
                }

                // 1. Fetch categories
                const { data: remoteCats, error: catErr } = await supabaseClient
                    .from('categories')
                    .select('*');
                if (!catErr && remoteCats && remoteCats.length > 0) {
                    categories = remoteCats;
                    saveCategories();
                }

                // 2. Fetch tags
                const { data: remoteTags, error: tagErr } = await supabaseClient
                    .from('tags')
                    .select('*');
                if (!tagErr && remoteTags && remoteTags.length > 0) {
                    tags = remoteTags.map(t => t.name);
                    saveTags();
                }

                // 3. Fetch students
                const studentsCleared = localStorage.getItem('school_accountant_students_cleared') === 'true';
                if (!studentsCleared) {
                    const { data: remoteStuds, error: studErr } = await supabaseClient
                        .from('students')
                        .select('*');
                    if (!studErr && remoteStuds) {
                        students = remoteStuds.map(s => ({
                            admissionNumber: s.admission_number,
                            name: s.name,
                            rollNumber: s.roll_number || '',
                            class: s.class || '',
                            section: s.section || '',
                            fatherName: s.father_name || '',
                            phone: s.phone || ''
                        }));
                        saveStudents();
                        updateStudentCountDisplay();
                        if (typeof renderStudentDirectory === 'function') {
                            populateStudentFilters();
                            renderStudentDirectory();
                        }
                    }
                } else {
                    console.log("[Sync] Skipping fetching students since school_accountant_students_cleared is true");
                }

                // 4. Fetch revisions
                const { data: remoteRevs, error: revErr } = await supabaseClient
                    .from('transaction_revisions')
                    .select('*');
                if (!revErr && remoteRevs) {
                    revisions = remoteRevs.map(r => ({
                        id: r.id,
                        transaction_id: r.transaction_id,
                        action: r.action,
                        old_values: r.old_values,
                        new_values: r.new_values,
                        created_by: r.created_by,
                        created_at: r.created_at
                    }));
                    saveRevisions();
                }

                // 4.5. Fetch activities
                try {
                    const { data: remoteActs, error: actErr } = await supabaseClient
                        .from('activity_history')
                        .select('*');
                    if (!actErr && remoteActs) {
                        remoteActs.forEach(ra => {
                            const localIdx = activities.findIndex(la => la.id === ra.id);
                            const mappedAct = {
                                id: ra.id,
                                timestamp: ra.timestamp,
                                date: ra.date,
                                time: ra.time,
                                userName: ra.user_name,
                                userEmail: ra.user_email,
                                userId: ra.auth_user_id,
                                activityType: ra.activity_type,
                                transactionId: ra.transaction_id,
                                description: ra.description,
                                deviceStatus: ra.device_status,
                                syncStatus: ra.sync_status || 'synced'
                            };
                            if (localIdx === -1) {
                                activities.push(mappedAct);
                            } else {
                                activities[localIdx] = mappedAct;
                            }
                        });
                        saveActivities();
                        renderActivities();
                    }
                } catch (actErr) {
                    console.warn("Could not sync activity history from Supabase:", actErr);
                }

                // 4.7. Fetch user profile
                if (currentUser && currentUser.email) {
                    try {
                        const { data: profile, error: profErr } = await supabaseClient
                            .from('user_profiles')
                            .select('*')
                            .eq('email', currentUser.email)
                            .maybeSingle();
                        if (!profErr && profile) {
                            const mappedProfile = {
                                email: profile.email,
                                fullName: profile.full_name,
                                userId: profile.auth_user_id
                            };
                            localStorage.setItem('user_profile_' + currentUser.email, JSON.stringify(mappedProfile));
                            userProfileData = mappedProfile;
                            const nameEl = document.getElementById('userName');
                            if (nameEl && mappedProfile.fullName) nameEl.textContent = mappedProfile.fullName;
                        }
                    } catch (profErr) {
                        console.warn("Could not sync user profile from Supabase:", profErr);
                    }
                }

                // 4.8. Fetch fee_structures
                try {
                    const { data: remoteStructs, error: structErr } = await supabaseClient
                        .from('fee_structures')
                        .select('*');
                    if (!structErr && remoteStructs) {
                        feeStructures = remoteStructs.map(s => ({
                            id: s.id,
                            academic_year: s.academic_year,
                            class: s.class,
                            fee_type: s.fee_type,
                            amount: parseFloat(s.amount),
                            frequency: s.frequency
                        }));
                        localStorage.setItem(FEE_STRUCTURES_KEY, JSON.stringify(feeStructures));
                    }
                } catch (structErr) {
                    console.warn("Could not sync fee structures from Supabase:", structErr);
                }

                // 4.8.5. Fetch student_fee_assignments and merge without overwriting newer pending local assignments
                try {
                    const { data: remoteAssignments, error: assignErr } = await supabaseClient
                        .from('student_fee_assignments')
                        .select('*');
                    if (!assignErr && remoteAssignments) {
                        // Collect keys of assignments currently pending in sync queue
                        const pendingQueue = typeof getSyncQueue === 'function' ? getSyncQueue() : [];
                        const pendingKeys = new Set();
                        pendingQueue.forEach(op => {
                            if (op.entity === 'student_fee_assignments' || op.entity === 'fee_assignments') {
                                if (op.action === 'BATCH_UPSERT' && op.payload && Array.isArray(op.payload.items)) {
                                    op.payload.items.forEach(item => {
                                        if (item.student_id && item.academic_year && item.fee_category_id) {
                                            pendingKeys.add(`${item.student_id}-${item.academic_year}-${item.fee_category_id}`);
                                        }
                                    });
                                } else if (op.payload && op.payload.assignment) {
                                    const a = op.payload.assignment;
                                    if (a.student_id && a.academic_year && a.fee_category_id) {
                                        pendingKeys.add(`${a.student_id}-${a.academic_year}-${a.fee_category_id}`);
                                    }
                                }
                            }
                        });

                        const mergedMap = new Map();

                        // 1. Seed with current local assignments
                        studentFeeAssignments.forEach(localAssign => {
                            const key = `${localAssign.student_id}-${localAssign.academic_year}-${localAssign.fee_category_id}`;
                            mergedMap.set(key, localAssign);
                        });

                        // 2. Merge remote assignments: update only if NOT currently pending newer local modifications
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

                        studentFeeAssignments = Array.from(mergedMap.values());
                        localStorage.setItem(STUDENT_FEE_ASSIGNMENTS_KEY, JSON.stringify(studentFeeAssignments));
                    }
                } catch (assignErr) {
                    console.warn("Could not sync student fee assignments from Supabase:", assignErr);
                }

                // 4.9. Fetch fee_payments
                try {
                    const { data: remotePayments, error: paymentErr } = await supabaseClient
                        .from('fee_payments')
                        .select('*');
                    if (!paymentErr && remotePayments) {
                        feePayments = remotePayments.map(p => ({
                            transaction_id: p.transaction_id,
                            student_admission_number: p.student_admission_number,
                            academic_year: p.academic_year,
                            fee_month: p.fee_month,
                            fee_type: p.fee_type
                        }));
                        localStorage.setItem(FEE_PAYMENTS_KEY, JSON.stringify(feePayments));
                    }
                } catch (paymentErr) {
                    console.warn("Could not sync fee payments metadata from Supabase:", paymentErr);
                }

                // 5. Fetch transactions
                const { data: remoteTxs, error: txErr } = await supabaseClient
                    .from(supaConfig.table)
                    .select('*');

                if (txErr) throw txErr;

                if (remoteTxs) {
                    remoteTxs.forEach(rt => {
                        const localIdx = transactions.findIndex(lt => lt.id === rt.id);
                        const mappedTx = {
                            id: rt.id,
                            type: rt.type,
                            date: rt.date,
                            reference: rt.reference,
                            particulars: rt.particulars,
                            amount: rt.amount,
                            head: rt.head,
                            bankAmount: rt.bank_amount || 0,
                            chequeCount: rt.cheque_count || 0,
                            mainCategory: rt.main_category,
                            subCategory: rt.sub_category,
                            tags: rt.tags || [],
                            createdBy: rt.created_by,
                            createdAt: rt.created_at,
                            updatedBy: rt.updated_by,
                            updatedAt: rt.updated_at,
                            deletedBy: rt.deleted_by,
                            isDeleted: rt.is_deleted || false,
                            attachments: rt.attachments || []
                        };

                        // Stitch fee metadata back in-memory from fee_payments
                        const paymentMeta = feePayments.find(fp => fp.transaction_id === rt.id);
                        if (paymentMeta) {
                            mappedTx.student = students.find(s => s.admissionNumber === paymentMeta.student_admission_number);
                            mappedTx.academicYear = paymentMeta.academic_year;
                            mappedTx.feeMonth = paymentMeta.fee_month;
                        }

                        if (localIdx === -1) {
                            transactions.push(mappedTx);
                        } else {
                            const localTx = transactions[localIdx];
                            const localTime = new Date(localTx.updatedAt || 0).getTime();
                            const remoteTime = new Date(rt.updated_at || 0).getTime();
                            if (remoteTime > localTime) {
                                if (localTx && localTx.attachments) {
                                    mappedTx.attachments = mappedTx.attachments.map(rmA => {
                                        const matchedLoc = localTx.attachments.find(locA => locA.name === rmA.name && locA.size === rmA.size);
                                        if (matchedLoc && matchedLoc.data) {
                                            rmA.data = matchedLoc.data;
                                        }
                                        return rmA;
                                    });
                                }
                                transactions[localIdx] = mappedTx;
                            }
                        }
                    });

                    if (transactions.length > 0) {
                        nextId = Math.max(...transactions.map(t => t.id)) + 1;
                    }
                    saveData();
                }

                // 6. Sync faculty data
                if (window.DataService && typeof window.DataService.getFaculty === 'function') {
                    try {
                        await window.DataService.getFaculty();
                        if (typeof window.loadFaculty === 'function') {
                            await window.loadFaculty();
                        }
                    } catch (facSyncErr) {
                        console.warn("Could not sync faculty from Supabase:", facSyncErr);
                    }
                }

                showToast('✅ Synced with Supabase!', 'success');
                renderAll();
            } catch (e) {
                console.error("Failed to sync from Supabase:", e);
                showToast('Sync failed: ' + e.message, 'error');
            }
        }

        function handleAuthStateChange(event, session) {
            console.log('Auth state change:', event, session);
            const loginView = document.getElementById('loginView');
            const dashboardView = document.getElementById('dashboardView');
            const userProfile = document.getElementById('userProfile');

            if (session && session.user) {
                const wasSignedOut = !currentUser;
                currentUser = session.user;
                window.currentUser = session.user;
                if (loginView) loginView.style.display = 'none';
                if (dashboardView) dashboardView.style.display = 'block';

                if (userProfile) {
                    userProfile.style.display = 'inline-flex';
                }

                const user = session.user;
                const metadata = user.user_metadata || {};

                const avatarEl = document.getElementById('userAvatar');
                if (avatarEl) {
                    avatarEl.src = metadata.avatar_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                }

                const nameEl = document.getElementById('userName');
                if (nameEl) {
                    nameEl.textContent = metadata.full_name || user.email.split('@')[0];
                }

                const emailEl = document.getElementById('userEmail');
                if (emailEl) {
                    emailEl.textContent = user.email;
                }

                checkUserProfile(user, wasSignedOut);
            } else {
                currentUser = null;
                userProfileData = null;
                if (dashboardView) dashboardView.style.display = 'none';
                if (loginView) loginView.style.display = 'block';

                if (userProfile) {
                    userProfile.style.display = 'none';
                }
            }
        }

        window.continueOffline = function() {
            const session = {
                user: {
                    email: 'admin@school.local',
                    user_metadata: {
                        full_name: 'Administrator (Offline)',
                        avatar_url: ''
                    }
                }
            };
            handleAuthStateChange('SIGNED_IN', session);
        };

        async function checkSessionAndSetupAuth() {
            const loginView = document.getElementById('loginView');
            const dashboardView = document.getElementById('dashboardView');

            if (!supabaseClient) {
                console.warn('Supabase client not ready for auth check.');
                handleAuthStateChange('SIGNED_OUT', null);
                return;
            }

            try {
                if (!supabaseAuthListenerAttached) {
                    supabaseAuthListenerAttached = true;
                    supabaseClient.auth.onAuthStateChange((event, session) => {
                        console.log('Auth state change event:', event, session ? session.user.email : null);
                        // Ignore null-session events that fire before the initial getSession resolves
                        // (Supabase v2 fires SIGNED_OUT briefly before INITIAL_SESSION)
                        if (!initialSessionResolved && !session) return;
                        if (session && session.user) {
                            handleAuthStateChange('SIGNED_IN', session);
                        } else {
                            handleAuthStateChange('SIGNED_OUT', null);
                        }
                    });
                }

                // Explicitly retrieve/restore session (also processes URL hash from OAuth redirect)
                const { data, error } = await supabaseClient.auth.getSession();
                initialSessionResolved = true;

                if (error) {
                    console.warn('getSession error:', error);
                }

                const session = data ? data.session : null;
                if (session && session.user) {
                    handleAuthStateChange('SIGNED_IN', session);
                    // Clean URL hash if it contains OAuth tokens
                    if (window.location.hash && window.location.hash.includes('access_token')) {
                        history.replaceState(null, '', window.location.pathname + window.location.search);
                    }
                } else {
                    handleAuthStateChange('SIGNED_OUT', null);
                }
            } catch (e) {
                initialSessionResolved = true;
                console.error('Session check failed:', e);
                showToast('Authentication error: ' + e.message, 'error');
                handleAuthStateChange('SIGNED_OUT', null);
            }
        }

        // ─── DOM refs ───
        const $ = (s) => document.querySelector(s);
        const $$ = (s) => document.querySelectorAll(s);

        // ─── Toast ───
        function showToast(msg, type = 'info', duration = 3000) {
            const t = $('#toast');
            t.textContent = msg;
            t.className = 'toast show ' + type;
            clearTimeout(t._hide);
            t._hide = setTimeout(() => { t.classList.remove('show'); }, duration);
        }

        // ════════════════════════════════════════════════════════════════
        //  DATA LAYER
        // ════════════════════════════════════════════════════════════════
        function saveCategories() {
            localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
        }

        function saveTags() {
            localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
        }

        function saveStudents() {
            localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
        }

        function saveRevisions() {
            localStorage.setItem(REVISIONS_KEY, JSON.stringify(revisions));
        }

        function generateUUID() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID();
            }
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        function trackRevision(action, oldTx, newTx) {
            if (!currentUser) return;

            const author = currentUser.email;
            const timestamp = new Date().toISOString();
            const rev = {
                id: generateUUID(),
                transaction_id: oldTx ? oldTx.id : newTx.id,
                action: action,
                old_values: oldTx ? JSON.parse(JSON.stringify(oldTx)) : null,
                new_values: newTx ? JSON.parse(JSON.stringify(newTx)) : null,
                created_by: author,
                created_at: timestamp
            };
            revisions.push(rev);
            saveRevisions();
            return rev;
        }

        // ─── ACTIVITY HISTORY & AUDIT LOG SERVICE ───
        function saveActivities() {
            localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities));
        }

        function loadActivities() {
            const raw = localStorage.getItem(ACTIVITIES_KEY);
            if (raw) {
                try {
                    activities = JSON.parse(raw);
                } catch (e) {
                    activities = [];
                }
            } else {
                activities = [];
            }
        }

        function logActivity(activityType, txId = null, description = '') {
            if (!currentUser) {
                console.warn('Cannot log activity: user not authenticated');
                return;
            }
            const currentUserName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || currentUser.email;

            const authorName = userProfileData ? userProfileData.fullName : currentUserName;
            const authorEmail = currentUser.email;
            const now = new Date();
            
            const activity = {
                id: generateUUID(),
                timestamp: now.toISOString(),
                date: now.toISOString().slice(0, 10),
                time: now.toLocaleTimeString(),
                userName: authorName,
                userEmail: authorEmail,
                userId: currentUser ? currentUser.id : null,
                activityType: activityType,
                transactionId: txId,
                description: description,
                deviceStatus: (navigator.onLine && supabaseClient) ? 'Online' : 'Offline',
                syncStatus: 'pending'
            };

            activities.push(activity);
            saveActivities();
            renderActivities();

            if (navigator.onLine && syncStatus === 'Connected') {
                uploadActivity(activity).catch(e => console.error("Failed to upload activity:", e));
            }
        }
        async function uploadActivity(activity) {
            if (!supabaseClient || !supaConfig) {
                throw new Error("Supabase is not configured");
            }
            
            const dbData = {
                id: activity.id,
                timestamp: activity.timestamp,
                date: activity.date,
                time: activity.time,
                user_name: activity.userName,
                user_email: activity.userEmail,
                auth_user_id: activity.userId,
                activity_type: activity.activityType,
                transaction_id: activity.transactionId,
                description: activity.description,
                device_status: activity.deviceStatus,
                sync_status: 'synced'
            };

            try {
                const { error } = await supabaseClient
                    .from('activity_history')
                    .insert(dbData);
                if (error) {
                    if (error.code === '42P01' || error.status === 404 || error.status === 403 || error.status === 400) {
                        console.warn("Table 'activity_history' is not accessible. Skipping activity insert.", error);
                    } else {
                        throw error;
                    }
                }
            } catch (e) {
                console.warn("Error inserting activity history (ignoring to prevent blocking sync):", e);
            }
        }

        function renderActivities() {
            const userSelect = document.getElementById('activityFilterUser');
            const typeFilterEl = document.getElementById('activityFilterType');
            const dateFilterEl = document.getElementById('activityFilterDate');
            
            const userFilter = userSelect ? userSelect.value : 'all';
            const typeFilter = typeFilterEl ? typeFilterEl.value : 'all';
            const dateFilter = dateFilterEl ? dateFilterEl.value : '';

            // Populate unique users dynamically
            if (userSelect) {
                const currentVal = userSelect.value;
                const uniqueEmails = [...new Set(activities.map(a => a.userEmail).filter(Boolean))];
                userSelect.innerHTML = '<option value="all">All Users</option>';
                uniqueEmails.forEach(email => {
                    const opt = document.createElement('option');
                    opt.value = email;
                    opt.textContent = email;
                    userSelect.appendChild(opt);
                });
                if (uniqueEmails.includes(currentVal)) {
                    userSelect.value = currentVal;
                } else {
                    userSelect.value = 'all';
                }
            }

            let filtered = [...activities];

            // Filter by user
            const activeUserFilter = userSelect ? userSelect.value : 'all';
            if (activeUserFilter !== 'all') {
                filtered = filtered.filter(a => a.userEmail === activeUserFilter);
            }

            // Filter by type
            if (typeFilter !== 'all') {
                filtered = filtered.filter(a => a.activityType === typeFilter);
            }

            // Filter by date
            if (dateFilter) {
                filtered = filtered.filter(a => a.date === dateFilter);
            }

            // Sort newest first
            filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            const tbody = document.getElementById('activityTableBody');
            if (!tbody) return;

            tbody.innerHTML = '';
            filtered.forEach(act => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.onclick = () => showActivityDetail(act.id);

                const localTimeStr = new Date(act.timestamp).toLocaleString();

                const devColorBg = act.deviceStatus === 'Online' ? '#d4edda' : '#f8d7da';
                const devColorTxt = act.deviceStatus === 'Online' ? '#0f7b3a' : '#721c24';
                const syncColorBg = act.syncStatus === 'synced' ? '#d4edda' : '#fff3cd';
                const syncColorTxt = act.syncStatus === 'synced' ? '#0f7b3a' : '#856404';

                tr.innerHTML = `
                    <td>${localTimeStr}</td>
                    <td style="font-weight: 600;">${act.activityType}</td>
                    <td>${escapeHtml(act.userName)} <br/><small class="text-muted">${escapeHtml(act.userEmail)}</small></td>
                    <td>${escapeHtml(act.description)}</td>
                    <td><span class="badge" style="background: ${devColorBg}; color: ${devColorTxt}; padding: 2px 8px; border-radius: 12px; font-size: 11px; display: inline-block;">${act.deviceStatus}</span></td>
                    <td><span class="badge" style="background: ${syncColorBg}; color: ${syncColorTxt}; padding: 2px 8px; border-radius: 12px; font-size: 11px; display: inline-block;">${act.syncStatus}</span></td>
                `;
                tbody.appendChild(tr);
            });

            const countDisplay = document.getElementById('activityCountDisplay');
            if (countDisplay) {
                countDisplay.textContent = `Showing ${filtered.length} of ${activities.length} activity logs.`;
            }
        }

        window.showActivityDetail = function (id) {
            const act = activities.find(a => a.id === id);
            if (!act) return;

            const content = document.getElementById('activityDetailContent');
            if (!content) return;

            const localTimeStr = new Date(act.timestamp).toLocaleString();

            content.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:8px; font-size:14px; line-height:1.5;">
                    <div><strong>Activity ID:</strong> <span style="font-family:monospace; font-size:12px; color:#555;">${act.id}</span></div>
                    <div><strong>Timestamp:</strong> ${localTimeStr}</div>
                    <div><strong>Date / Time:</strong> ${act.date} / ${act.time}</div>
                    <div><strong>Activity Type:</strong> <span style="font-weight:600; color:#1d4b6e;">${act.activityType}</span></div>
                    <div><strong>Description:</strong> <span style="color:#2c3e50; font-weight:500;">${escapeHtml(act.description)}</span></div>
                    <div><strong>Transaction ID:</strong> ${act.transactionId !== null ? `<span style="background:#eef2f8; padding:2px 6px; border-radius:4px; font-family:monospace;">${act.transactionId}</span>` : 'N/A'}</div>
                    <hr style="border: 0; border-top: 1px solid #e9edf4; margin: 8px 0;"/>
                    <div><strong>User Name:</strong> ${escapeHtml(act.userName)}</div>
                    <div><strong>User Email:</strong> ${escapeHtml(act.userEmail)}</div>
                    <div><strong>User ID:</strong> <span style="font-family:monospace; font-size:12px; color:#555;">${escapeHtml(act.userId || 'N/A')}</span></div>
                    <hr style="border: 0; border-top: 1px solid #e9edf4; margin: 8px 0;"/>
                    <div style="display:flex; gap:12px; align-items:center;">
                        options: <strong>Device Status:</strong>
                        <span style="background: ${act.deviceStatus === 'Online' ? '#d4edda' : '#f8d7da'}; color: ${act.deviceStatus === 'Online' ? '#0f7b3a' : '#721c24'}; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${act.deviceStatus}</span>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center; margin-top:4px;">
                        <strong>Sync Status:</strong>
                        <span style="background: ${act.syncStatus === 'synced' ? '#d4edda' : '#fff3cd'}; color: ${act.syncStatus === 'synced' ? '#0f7b3a' : '#856404'}; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${act.syncStatus}</span>
                    </div>
                </div>
            `;

            const modal = document.getElementById('activityDetailModal');
            if (modal) modal.style.display = 'block';
        };

        window.hideActivityDetailModal = function () {
            const modal = document.getElementById('activityDetailModal');
            if (modal) modal.style.display = 'none';
        };

        window.resetActivityFilters = function () {
            const userSelect = document.getElementById('activityFilterUser');
            const typeFilter = document.getElementById('activityFilterType');
            const dateFilter = document.getElementById('activityFilterDate');
            
            if (userSelect) userSelect.value = 'all';
            if (typeFilter) typeFilter.value = 'all';
            if (dateFilter) dateFilter.value = '';
            
            renderActivities();
        };

        let syncStatus = 'Connected'; // 'Connected' | 'Disconnected' | 'Syncing'

        async function uploadTxAttachments(tx) {
            if (!supabaseClient || !supaConfig || !navigator.onLine) return;
            if (!tx.attachments || tx.attachments.length === 0) return;

            console.log(`[Attachment][Storage][Upload] Initializing attachment upload pipeline for transaction ID: ${tx.id}`);

            let updated = false;
            const globalTx = transactions.find(t => t.id === tx.id);

            for (let attach of tx.attachments) {
                if (attach.data && attach.data.startsWith('data:')) {
                    try {
                        const blob = await dataURLtoBlob(attach.data);
                        const cleanName = attach.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                        const path = `${tx.id}/${Date.now()}_${cleanName}`;

                        const { data: uploadResp, error: uploadError } = await supabaseClient.storage
                            .from(supaConfig.bucket)
                            .upload(path, blob, { contentType: attach.type, upsert: true });

                        if (uploadError) {
                            console.error('[Attachment][Storage][Upload] Error:', uploadError);
                            showToast("❌ Supabase Storage error: " + (uploadError.message || uploadError), 'error');
                            throw uploadError;
                        }

                        const { data } = supabaseClient.storage
                            .from(supaConfig.bucket)
                            .getPublicUrl(path);
                        
                        attach.storagePath = path;
                        attach.url = data.publicUrl;
                        attach.uploadedAt = new Date().toISOString();
                        attach.synced = true;
                        attach.pendingSync = false;

                        if (globalTx && globalTx.attachments) {
                            const globalAttach = globalTx.attachments.find(a => a.name === attach.name);
                            if (globalAttach) {
                                globalAttach.storagePath = path;
                                globalAttach.url = data.publicUrl;
                                globalAttach.uploadedAt = attach.uploadedAt;
                                globalAttach.synced = true;
                                globalAttach.pendingSync = false;
                            }
                        }
                        updated = true;
                    } catch (e) {
                        console.error(`Pipeline failed for attachment "${attach.name}":`, e);
                        throw e;
                    }
                }
            }
            if (updated) {
                saveData();
                renderTransactions();
                const modal = document.getElementById('attachmentModal');
                if (modal && modal.style.display === 'flex') {
                    viewAttachments(tx.id);
                }
            }
        }

        async function uploadTransactionAndRevision(tx, rev, action) {
            if (!supabaseClient || !supaConfig) {
                throw new Error("Supabase is not configured");
            }
            
            if (action === 'PERMANENT_DELETE') {
                try {
                    await supabaseClient
                        .from('fee_payments')
                        .delete()
                        .eq('transaction_id', tx.id);
                } catch (e) {
                    console.warn("Could not delete fee metadata from Supabase:", e);
                }

                const { error: txError } = await supabaseClient
                    .from(supaConfig.table)
                    .delete()
                    .eq('id', tx.id);
                if (txError) throw txError;

                if (rev) {
                    try {
                        const { error: revError } = await supabaseClient
                            .from('transaction_revisions')
                            .insert({
                                id: rev.id,
                                transaction_id: rev.transaction_id,
                                action: rev.action,
                                old_values: rev.old_values,
                                new_values: rev.new_values,
                                created_by: rev.created_by,
                                created_at: rev.created_at
                            });
                        if (revError && revError.code !== '42P01') {
                            console.warn("Error inserting revision:", revError);
                        }
                    } catch (e) {
                        console.warn("Error inserting revision:", e);
                    }
                }
                return;
            }
            
            if (tx.attachments && tx.attachments.length > 0) {
                await uploadTxAttachments(tx);
            }

            const txData = { ...tx };
            const supaAttachments = (txData.attachments || []).map(a => {
                const copy = { ...a };
                delete copy.data;
                return copy;
            });

            const dbData = {
                id: txData.id,
                type: txData.type,
                date: txData.date,
                reference: txData.reference,
                particulars: txData.particulars,
                amount: txData.amount,
                head: txData.head || txData.mainCategory || 'General',
                bank_amount: txData.bankAmount,
                cheque_count: txData.chequeCount,
                main_category: txData.mainCategory,
                sub_category: txData.subCategory,
                tags: txData.tags || [],
                created_by: txData.createdBy,
                created_at: txData.createdAt,
                updated_by: txData.updatedBy,
                updated_at: txData.updatedAt,
                deleted_by: txData.deletedBy || null,
                is_deleted: txData.isDeleted || false,
                attachments: supaAttachments
            };

            let retries = 0;
            const maxRetries = 15;
            while (retries < maxRetries) {
                const { error: txError } = await supabaseClient
                    .from(supaConfig.table)
                    .upsert(dbData);
                
                if (!txError) break;
                
                if (txError.code === 'PGRST204') {
                    const match = txError.message.match(/Could not find the '([^']+)' column/);
                    if (match && match[1]) {
                        const missingCol = match[1];
                        console.warn(`Column '${missingCol}' not found on Supabase. Retrying without it...`);
                        delete dbData[missingCol];
                        retries++;
                        continue;
                    }
                }
                throw txError;
            }

            if (tx.type === 'income' && tx.mainCategory === 'Fees' && tx.student && tx.student.admissionNumber) {
                if (tx.isDeleted) {
                    try {
                        await supabaseClient
                            .from('fee_payments')
                            .delete()
                            .eq('transaction_id', tx.id);
                    } catch (e) {
                        console.warn("Could not delete from fee_payments:", e);
                    }
                } else {
                    const feeData = {
                        transaction_id: tx.id,
                        student_admission_number: tx.student.admissionNumber,
                        academic_year: tx.academicYear || getCurrentAcademicYear(tx.date),
                        fee_month: tx.feeMonth || extractMonthFromParticulars(tx.particulars) || '',
                        fee_type: tx.subCategory || ''
                    };
                    try {
                        const { error: feeErr } = await supabaseClient
                            .from('fee_payments')
                            .upsert(feeData);
                        if (feeErr) throw feeErr;
                    } catch (e) {
                        console.warn("Failed to upsert fee payment:", e);
                    }
                }
            } else if (tx.id) {
                try {
                    await supabaseClient
                        .from('fee_payments')
                        .delete()
                        .eq('transaction_id', tx.id);
                } catch (e) {
                    // Ignore cleanup error
                }
            }

            if (rev) {
                try {
                    await supabaseClient
                        .from('transaction_revisions')
                        .insert({
                            id: rev.id,
                            transaction_id: rev.transaction_id,
                            action: rev.action,
                            old_values: rev.old_values,
                            new_values: rev.new_values,
                            created_by: rev.created_by,
                            created_at: rev.created_at
                        });
                } catch (e) {
                    console.warn("Error inserting transaction revision:", e);
                }
            }
        }

        async function pushOrQueueMutation(action, tx, rev) {
            if (!supabaseClient || !supaConfig) {
                showToast("Database disconnected. Cannot save.", "error");
                throw new Error("Offline");
            }
            try {
                await uploadTransactionAndRevision(tx, rev, action);
                syncStatus = 'Connected';
                updateSupabaseStatus();
            } catch (e) {
                console.error("Direct upload failed:", e);
                showToast("Database Error: " + (e.message || e), "error");
                throw e;
            }
        }

        // ─── USER PROFILE DISPLAY ───

        async function checkUserProfile(user, wasSignedOut) {
            if (!user) return;
            try {
                const fullName = user.user_metadata?.full_name || user.email.split('@')[0];
                const nameEl = document.getElementById('userName');
                if (nameEl) nameEl.textContent = fullName;

                userProfileData = {
                    email: user.email,
                    fullName: fullName,
                    userId: user.id
                };

                if (supabaseClient) {
                    const { data } = await supabaseClient
                        .from('user_profiles')
                        .select('full_name')
                        .eq('email', user.email)
                        .maybeSingle();
                    if (data && data.full_name) {
                        userProfileData.fullName = data.full_name;
                        if (nameEl) nameEl.textContent = data.full_name;
                    }
                }
            } catch (e) {
                console.error("Error setting user profile:", e);
            }
        }

        window.submitFirstTimeProfile = function() {};

        window.showProfileModal = function() {
            if (!currentUser) return;
            const modal = document.getElementById('profileModal');
            if (!modal) return;

            const avatarEl = document.getElementById('profileModalAvatar');
            if (avatarEl) avatarEl.src = currentUser.user_metadata?.avatar_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

            const emailEl = document.getElementById('profileModalEmail');
            if (emailEl) emailEl.value = currentUser.email;

            const nameEl = document.getElementById('profileModalFullName');
            if (nameEl) {
                nameEl.value = userProfileData?.fullName || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
            }

            modal.style.display = 'flex';
        };

        window.hideProfileModal = function() {
            const modal = document.getElementById('profileModal');
            if (modal) modal.style.display = 'none';
        };

        window.enableProfileEdit = function() {};
        window.saveProfileChanges = function() {};


        function loadData() {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    transactions = parsed.transactions || [];
                    nextId = parsed.nextId || 1;
                } catch (e) {
                    transactions = [];
                    nextId = 1;
                }
            } else {
                transactions = [];
                nextId = 1;
                saveData();
            }

            // Load categories list
            const rawCats = localStorage.getItem(CATEGORIES_KEY);
            if (rawCats) {
                try { categories = JSON.parse(rawCats); } catch (e) { categories = [...DEFAULT_CATEGORIES]; }
            } else {
                categories = [...DEFAULT_CATEGORIES];
                saveCategories();
            }

            // Load tags list
            const rawTags = localStorage.getItem(TAGS_KEY);
            if (rawTags) {
                try { tags = JSON.parse(rawTags); } catch (e) { tags = [...DEFAULT_TAGS]; }
            } else {
                tags = [...DEFAULT_TAGS];
                saveTags();
            }

            // Load students list
            const rawStuds = localStorage.getItem(STUDENTS_KEY);
            if (rawStuds) {
                try { students = JSON.parse(rawStuds); } catch (e) { students = []; }
            } else {
                students = [];
            }

            // Load revisions
            const rawRevs = localStorage.getItem(REVISIONS_KEY);
            if (rawRevs) {
                try { revisions = JSON.parse(rawRevs); } catch (e) { revisions = []; }
            } else {
                revisions = [];
            }

            // Load fee structures
            const rawStructs = localStorage.getItem(FEE_STRUCTURES_KEY);
            if (rawStructs) {
                try { feeStructures = JSON.parse(rawStructs); } catch (e) { feeStructures = []; }
            } else {
                feeStructures = [];
            }

            // Load fee payments
            let rawPayments = localStorage.getItem(FEE_PAYMENTS_KEY);
            if (rawPayments) {
                try { feePayments = JSON.parse(rawPayments); } catch (e) { feePayments = []; }
            } else {
                feePayments = [];
            }

            // Load student fee assignments
            const rawAssignments = localStorage.getItem(STUDENT_FEE_ASSIGNMENTS_KEY);
            if (rawAssignments) {
                try {
                    const loaded = JSON.parse(rawAssignments);
                    const uniqueLoaded = [];
                    const seenLoaded = new Set();
                    loaded.forEach(a => {
                        const key = `${a.student_id}-${a.academic_year}-${a.fee_category_id}`;
                        if (!seenLoaded.has(key)) {
                            seenLoaded.add(key);
                            uniqueLoaded.push(a);
                        }
                    });
                    studentFeeAssignments = uniqueLoaded;
                } catch (e) {
                    studentFeeAssignments = [];
                }
            } else {
                studentFeeAssignments = [];
            }

            let feePaymentsModified = false;

            // Ensure backward compatibility of transactions structure
            transactions.forEach(t => {
                if (!t.attachments) t.attachments = [];
                if (t.bankAmount === undefined) t.bankAmount = 0;
                if (t.chequeCount === undefined) t.chequeCount = 0;
                if (t.isDeleted === undefined) t.isDeleted = false;

                // Map head to main category & sub category if missing
                if (!t.mainCategory) {
                    if (t.head === 'Registration') {
                        t.mainCategory = 'Fees';
                        t.subCategory = 'Registration';
                    } else if (t.head === 'Tuition') {
                        t.mainCategory = 'Fees';
                        t.subCategory = 'Tuition';
                    } else if (t.head === 'Bank Deposit') {
                        t.mainCategory = 'Operations';
                        t.subCategory = 'Bank Deposit';
                    } else if (t.head === 'Stationary') {
                        t.mainCategory = 'Operations';
                        t.subCategory = 'Stationary';
                    } else if (t.head === 'Refreshment') {
                        t.mainCategory = 'Operations';
                        t.subCategory = 'Refreshment';
                    } else {
                        t.mainCategory = t.head || 'General';
                        t.subCategory = '';
                    }
                }
                if (!t.tags) {
                    t.tags = [];
                }
                if (!t.createdBy) {
                    t.createdBy = 'System';
                    t.createdAt = new Date().toISOString();
                    t.updatedBy = 'System';
                    t.updatedAt = t.createdAt;
                }

                // Self-heal and resolve student details from particulars at load time if missing
                if (t.mainCategory === 'Fees' && !t.isDeleted && !t.student) {
                    const parsed = extractMetadataFromParticulars(t.particulars, t.tags || [], null);
                    if (parsed.studentObj) {
                        t.student = parsed.studentObj;
                    }
                }

                // In-memory stitching: bind student details and period back onto the transaction
                const paymentMeta = feePayments.find(fp => fp.transaction_id === t.id);
                if (paymentMeta) {
                    t.student = students.find(s => s.admissionNumber === paymentMeta.student_admission_number);
                    t.academicYear = paymentMeta.academic_year;
                    t.feeMonth = paymentMeta.fee_month;
                } else if (t.student && t.student.admissionNumber && t.mainCategory === 'Fees' && !t.isDeleted) {
                    // Auto-migrate legacy data format to normalized feePayments list
                    const autoPayment = {
                        transaction_id: t.id,
                        student_admission_number: t.student.admissionNumber,
                        academic_year: t.academicYear || getCurrentAcademicYear(t.date),
                        fee_month: t.feeMonth || extractMonthFromParticulars(t.particulars) || '',
                        fee_type: t.subCategory || ''
                    };
                    feePayments.push(autoPayment);
                    t.academicYear = autoPayment.academic_year;
                    t.feeMonth = autoPayment.fee_month;
                    feePaymentsModified = true;
                }
            });

            if (feePaymentsModified) {
                localStorage.setItem(FEE_PAYMENTS_KEY, JSON.stringify(feePayments));
            }

            loadActivities();
        }

        function saveData() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ transactions, nextId }));
            localStorage.setItem(FEE_STRUCTURES_KEY, JSON.stringify(feeStructures));
            localStorage.setItem(FEE_PAYMENTS_KEY, JSON.stringify(feePayments));
            localStorage.setItem(STUDENT_FEE_ASSIGNMENTS_KEY, JSON.stringify(studentFeeAssignments));
            updateLocalStatus();
            refreshDashboard();
            renderIncomeList();
            renderExpenseList();
            renderTransactions();
            updatePreviewCounts();
            refreshFeesUI();
        }

        function getNextId() { return nextId++; }

        async function addTransaction(tx) {
            if (!currentUser) {
                showToast('Your session has expired. Please sign in again.', 'error');
                return null;
            }
            const currentUserName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || currentUser.email;

            tx.id = getNextId();
            tx.attachments = tx.attachments || [];
            tx.isDeleted = false;
            tx.createdBy = currentUser.email;
            tx.createdAt = new Date().toISOString();
            tx.updatedBy = tx.createdBy;
            tx.updatedAt = tx.createdAt;

            const rev = trackRevision('CREATE', null, tx);
            
            // Try pushing first
            try {
                await pushOrQueueMutation('CREATE', tx, rev);
            } catch (e) {
                return null;
            }

            // If Fees income transaction, record details in local feePayments metadata cache
            if (tx.type === 'income' && tx.mainCategory === 'Fees' && tx.student && tx.student.admissionNumber) {
                tx.academicYear = tx.academicYear || getCurrentAcademicYear(tx.date);
                tx.feeMonth = tx.feeMonth || extractMonthFromParticulars(tx.particulars) || '';
                const feePaymentRec = {
                    transaction_id: tx.id,
                    student_admission_number: tx.student.admissionNumber,
                    academic_year: tx.academicYear,
                    fee_month: tx.feeMonth,
                    fee_type: tx.subCategory || ''
                };
                const existingIdx = feePayments.findIndex(fp => fp.transaction_id === tx.id);
                if (existingIdx !== -1) {
                    feePayments[existingIdx] = feePaymentRec;
                } else {
                    feePayments.push(feePaymentRec);
                }
            }

            transactions.push(tx);
            saveData();
            logActivity('Create Transaction', tx.id, `Created transaction: ${tx.type === 'income' ? 'Income' : 'Expense'} - ${tx.particulars} (₹${tx.amount.toFixed(2)})`);
            return tx;
        }

        async function deleteTransaction(id) {
            if (!currentUser) {
                showToast('Your session has expired. Please sign in again.', 'error');
                return;
            }
            const currentUserName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || currentUser.email;

            const tx = transactions.find(t => t.id === id);
            if (!tx) return;
            const oldTx = JSON.parse(JSON.stringify(tx));

            tx.isDeleted = true;
            tx.deletedBy = currentUser.email;
            tx.updatedBy = tx.deletedBy;
            tx.updatedAt = new Date().toISOString();
            const rev = trackRevision('DELETE', oldTx, tx);

            try {
                await pushOrQueueMutation('DELETE', tx, rev);
            } catch (e) {
                // Revert
                tx.isDeleted = oldTx.isDeleted;
                return;
            }

            // Clean up mapping in feePayments since transaction is soft-deleted
            feePayments = feePayments.filter(fp => fp.transaction_id !== id);
            saveData();
            logActivity('Archive Transaction', id, `Archived transaction (soft delete) for ID: ${id}`);
        }

        function updateTransaction(id, updates) {
            if (!currentUser) {
                showToast('Your session has expired. Please sign in again.', 'error');
                return;
            }
            const currentUserName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || currentUser.email;

            const idx = transactions.findIndex(t => t.id === id);
            if (idx === -1) return null;
            const oldTx = JSON.parse(JSON.stringify(transactions[idx]));

            transactions[idx] = {
                ...transactions[idx],
                ...updates,
                updatedBy: currentUser.email,
                updatedAt: new Date().toISOString()
            };

            const tx = transactions[idx];
            
            // Clean out and rebuild normalized metadata record
            feePayments = feePayments.filter(fp => fp.transaction_id !== id);
            if (tx.type === 'income' && tx.mainCategory === 'Fees' && tx.student && tx.student.admissionNumber && !tx.isDeleted) {
                tx.academicYear = tx.academicYear || getCurrentAcademicYear(tx.date);
                tx.feeMonth = tx.feeMonth || extractMonthFromParticulars(tx.particulars) || '';
                feePayments.push({
                    transaction_id: tx.id,
                    student_admission_number: tx.student.admissionNumber,
                    academic_year: tx.academicYear,
                    fee_month: tx.feeMonth,
                    fee_type: tx.subCategory || ''
                });
            }

            saveData();
            const rev = trackRevision('UPDATE', oldTx, transactions[idx]);
            pushOrQueueMutation('UPDATE', transactions[idx], rev);

            logActivity('Edit Transaction', id, `Updated transaction details for ID: ${id}`);

            return transactions[idx];
        }

        function getTransactions(filters = {}) {
            let list = [...transactions];

            // Filter by type
            if (filters.type && filters.type !== 'all') {
                list = list.filter(t => t.type === filters.type);
            }

            // Filter by date range
            if (filters.dateFrom) {
                list = list.filter(t => t.date >= filters.dateFrom);
            }
            if (filters.dateTo) {
                list = list.filter(t => t.date <= filters.dateTo);
            }

            // Filter by category
            if (filters.mainCategory && filters.mainCategory !== 'all') {
                list = list.filter(t => t.mainCategory === filters.mainCategory);
            }
            if (filters.subCategory && filters.subCategory !== 'all') {
                list = list.filter(t => t.subCategory === filters.subCategory);
            }

            // Filter by amount range
            if (filters.amountFrom !== undefined && filters.amountFrom !== '') {
                list = list.filter(t => t.amount >= parseFloat(filters.amountFrom));
            }
            if (filters.amountTo !== undefined && filters.amountTo !== '') {
                list = list.filter(t => t.amount <= parseFloat(filters.amountTo));
            }

            // Filter by soft deletes
            if (!filters.showDeleted) {
                list = list.filter(t => !t.isDeleted);
            }

            // Parse search term (particulars, reference, @student, #tag)
            if (filters.search) {
                let searchTags = [];
                let searchStudents = [];
                let plainSearch = filters.search;

                // Extract #tags
                const tagMatches = plainSearch.match(/#([^\s,#]+)/g);
                if (tagMatches) {
                    tagMatches.forEach(m => {
                        searchTags.push(m.substring(1).toLowerCase());
                        plainSearch = plainSearch.replace(m, '');
                    });
                }

                // Extract @students
                const studentMatches = plainSearch.match(/@([^\s,@]+)/g);
                if (studentMatches) {
                    studentMatches.forEach(m => {
                        searchStudents.push(m.substring(1).toLowerCase());
                        plainSearch = plainSearch.replace(m, '');
                    });
                }

                plainSearch = plainSearch.trim().toLowerCase();

                // Match tags
                if (searchTags.length > 0) {
                    list = list.filter(t => searchTags.every(st => t.tags && t.tags.some(tag => tag.toLowerCase().includes(st))));
                }

                // Match students
                if (searchStudents.length > 0) {
                    list = list.filter(t => searchStudents.every(ss => t.student && (
                        t.student.name.toLowerCase().includes(ss) ||
                        t.student.admissionNumber.toLowerCase().includes(ss) ||
                        (t.student.rollNumber && t.student.rollNumber.toLowerCase().includes(ss))
                    )));
                }

                // Match plain description or reference
                if (plainSearch) {
                    list = list.filter(t => t.particulars.toLowerCase().includes(plainSearch) || t.reference.toLowerCase().includes(plainSearch));
                }
            }

            // Sorting
            const sortBy = filters.sortBy || 'id';
            const sortOrder = filters.sortOrder || 'desc';

            list.sort((a, b) => {
                let valA, valB;

                if (sortBy === 'date') {
                    valA = a.date || '';
                    valB = b.date || '';
                } else if (sortBy === 'student') {
                    valA = a.student ? a.student.name.toLowerCase() : '';
                    valB = b.student ? b.student.name.toLowerCase() : '';
                } else if (sortBy === 'amount') {
                    valA = a.amount || 0;
                    valB = b.amount || 0;
                } else if (sortBy === 'category') {
                    valA = (a.mainCategory || '').toLowerCase();
                    valB = (b.mainCategory || '').toLowerCase();
                } else if (sortBy === 'subcategory') {
                    valA = (a.subCategory || '').toLowerCase();
                    valB = (b.subCategory || '').toLowerCase();
                } else if (sortBy === 'createdAt') {
                    valA = a.createdAt || '';
                    valB = b.createdAt || '';
                } else if (sortBy === 'updatedAt') {
                    valA = a.updatedAt || '';
                    valB = b.updatedAt || '';
                } else if (sortBy === 'tags') {
                    valA = a.tags && a.tags.length > 0 ? [...a.tags].sort().join(', ').toLowerCase() : '';
                    valB = b.tags && b.tags.length > 0 ? [...b.tags].sort().join(', ').toLowerCase() : '';
                } else {
                    valA = a.id || 0;
                    valB = b.id || 0;
                }

                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });

            return list;
        }

        // ─── Dashboard calculations ───
        function calcDashboard() {
            const activeTxs = transactions.filter(t => !t.isDeleted);
            const opening = activeTxs.filter(t => t.type === 'income' && t.head === 'Opening');
            const openingBal = opening.reduce((sum, t) => sum + t.amount, 0);
            const income = activeTxs.filter(t => t.type === 'income' && t.head !== 'Opening');
            const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
            const expenses = activeTxs.filter(t => t.type === 'expense');
            const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
            const closing = openingBal + totalIncome - totalExpense;
            const net = totalIncome - totalExpense;
            return { openingBal, totalIncome, totalExpense, closing, net, count: activeTxs.length };
        }

        function refreshDashboard() {
            const d = calcDashboard();
            document.getElementById('dashOpening').textContent = d.openingBal.toFixed(2);
            document.getElementById('dashIncome').textContent = d.totalIncome.toFixed(2);
            document.getElementById('dashExpense').textContent = d.totalExpense.toFixed(2);
            document.getElementById('dashClosing').textContent = d.closing.toFixed(2);
            const netEl = document.getElementById('dashNet');
            netEl.textContent = d.net.toFixed(2);
            netEl.className = 'value ' + (d.net >= 0 ? 'positive' : 'negative');
            document.getElementById('dashCount').textContent = d.count;
            // update dashboard faculty & pending salary metrics
            if (typeof window.updateDashboardFacultyMetrics === 'function') {
                window.updateDashboardFacultyMetrics(d.totalExpense);
            }
            // last sync
            const lastSync = localStorage.getItem('school_accountant_last_sync');
            if (lastSync) {
                document.getElementById('dashLastSync').textContent = 'Last sync: ' + new Date(parseInt(lastSync))
                    .toLocaleString();
            } else {
                document.getElementById('dashLastSync').textContent = 'Last sync: never';
            }
        }

        function updateLocalStatus() {
            const el = document.getElementById('localStatus');
            if (el) el.textContent = '💾 Local (No Queue)';
        }

        // ─── Preview counts ───
        function updatePreviewCounts() {
            const inc = transactions.filter(t => !t.isDeleted && t.type === 'income' && t.head !== 'Opening');
            const exp = transactions.filter(t => !t.isDeleted && t.type === 'expense');
            document.getElementById('incomePreview').textContent = '📊 Income entries: ' + inc.length +
                '  |  Total: ₹' + inc.reduce((s, t) => s + t.amount, 0).toFixed(2);
            document.getElementById('expensePreview').textContent = '📊 Expense entries: ' + exp.length +
                '  |  Total: ₹' + exp.reduce((s, t) => s + t.amount, 0).toFixed(2);
        }

        // ════════════════════════════════════════════════════════════════
        //  INCOME BULK
        // ════════════════════════════════════════════════════════════════
        let incomeRowCount = 0;

        function updateIncomeAttachmentColumnVisibility() {
            const table = document.getElementById('incomeTable');
            if (!table) return;
            const rows = table.querySelectorAll('#incomeTableBody tr');
            const ths = table.querySelectorAll('thead th');
            const attachmentTh = ths[4]; // 5th th (Attachment)

            let allFees = true;
            let hasRows = rows.length > 0;

            rows.forEach(row => {
                const mainSel = row.querySelector('.inc-main-category');
                if (mainSel && mainSel.value !== 'Fees') {
                    allFees = false;
                }
            });

            if (hasRows && allFees) {
                if (attachmentTh) attachmentTh.style.display = 'none';
                rows.forEach(row => {
                    const fileInput = row.querySelector('.inc-file');
                    if (fileInput) {
                        const fileTd = fileInput.closest('td');
                        if (fileTd) fileTd.style.display = 'none';
                    }
                });
            } else {
                if (attachmentTh) attachmentTh.style.display = '';
                rows.forEach(row => {
                    const mainSel = row.querySelector('.inc-main-category');
                    const fileInput = row.querySelector('.inc-file');
                    if (fileInput) {
                        const fileTd = fileInput.closest('td');
                        if (fileTd) {
                            fileTd.style.display = '';
                            if (mainSel && mainSel.value === 'Fees') {
                                fileInput.style.display = 'none';
                            } else {
                                fileInput.style.display = '';
                            }
                        }
                    }
                });
            }
        }

        function addIncomeRow(data = {}) {
            const tbody = document.getElementById('incomeTableBody');
            const row = document.createElement('tr');
            const idx = incomeRowCount++;
            row.dataset.idx = idx;

            if (data.tags) {
                row.dataset.tags = JSON.stringify(data.tags);
            } else {
                row.dataset.tags = "[]";
            }
            if (data.student) {
                row.dataset.studentAdmission = data.student.admissionNumber;
                row.dataset.studentName = data.student.name;
                row.dataset.studentRoll = data.student.rollNumber || '';
            }
            if (data.academicYear) {
                row.dataset.academicYear = data.academicYear;
            }
            if (data.feeMonth) {
                row.dataset.feeMonth = data.feeMonth;
            }

            row.innerHTML = `
            <td><input type="text" class="inc-ref" value="${data.reference || ''}" placeholder="Receipt No." /></td>
            <td>
                <input type="text" class="inc-particulars" value="${data.particulars || ''}" placeholder="Description" />
                <div class="row-badges" style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;"></div>
            </td>
            <td><input type="number" class="inc-amount" value="${data.amount || ''}" step="0.01" placeholder="0.00" /></td>
            <td>
                <select class="inc-main-category" style="margin-bottom:4px;"></select>
                <select class="inc-sub-category" disabled></select>
            </td>
            <td><input type="file" class="inc-file" accept="image/*,application/pdf" multiple /></td>
            <td><button class="btn btn-danger btn-xs" onclick="removeIncomeRow(this)">✕</button></td>
          `;
            tbody.appendChild(row);

            const mainSel = row.querySelector('.inc-main-category');
            const subSel = row.querySelector('.inc-sub-category');

            populateMainCategoryDropdown(mainSel, 'income', data.mainCategory || '');
            populateSubCategoryDropdown(subSel, data.mainCategory || '', data.subCategory || '');
            renderRowBadges(row);
            updateIncomeAttachmentColumnVisibility();
        }

        function removeIncomeRow(btn) {
            const row = btn.closest('tr');
            row.remove();
            updateIncomeAttachmentColumnVisibility();
        }

        function submitIncomeBulk() {
            const date = document.getElementById('incomeDate').value;
            if (!date) { showToast('Please select a date.', 'error'); return; }
            const openingInput = document.getElementById('incomeOpening');
            const openingVal = parseFloat(openingInput.value);
            if (!isNaN(openingVal) && openingVal !== 0) {
                // add opening balance as income
                addTransaction({
                    type: 'income',
                    date: date,
                    reference: 'OPEN',
                    particulars: 'Opening balance',
                    amount: openingVal,
                    head: 'Opening',
                    mainCategory: 'Opening',
                    subCategory: '',
                    tags: [],
                    bankAmount: 0,
                    chequeCount: 0,
                    attachments: []
                });
                openingInput.value = '';
                showToast('✅ Opening balance added: ₹' + openingVal.toFixed(2), 'success');
            }

            const rows = document.querySelectorAll('#incomeTableBody tr');
            let added = 0;
            const promises = [];
            const feeTxIds = []; // Track fee transaction IDs for auto-receipt

            rows.forEach(row => {
                const ref = row.querySelector('.inc-ref').value.trim();
                const particulars = row.querySelector('.inc-particulars').value.trim();
                const amount = parseFloat(row.querySelector('.inc-amount').value);
                const mainCategory = row.querySelector('.inc-main-category').value;
                const subCategory = row.querySelector('.inc-sub-category').value;
                const fileInput = row.querySelector('.inc-file');

                const tagsList = row.dataset.tags ? JSON.parse(row.dataset.tags) : [];
                let studentObj = null;
                if (row.dataset.studentAdmission) {
                    studentObj = {
                        admissionNumber: row.dataset.studentAdmission,
                        name: row.dataset.studentName,
                        rollNumber: row.dataset.studentRoll || ''
                    };
                }

                if (!ref || !particulars || isNaN(amount) || amount === 0) {
                    return;
                }

                const filePromises = [];
                // Only process file attachments for non-fee categories
                if (mainCategory !== 'Fees' && fileInput && fileInput.files.length > 0) {
                    for (let f of fileInput.files) {
                        filePromises.push(readFileAsBase64(f));
                    }
                }

                const txData = {
                    type: 'income',
                    date: date,
                    reference: ref,
                    particulars: particulars,
                    amount: amount,
                    head: mainCategory || 'General',
                    mainCategory: mainCategory || 'General',
                    subCategory: subCategory || '',
                    tags: tagsList,
                    student: studentObj,
                    academicYear: row.dataset.academicYear || '',
                    feeMonth: row.dataset.feeMonth || '',
                    bankAmount: 0,
                    chequeCount: 0,
                    attachments: []
                };

                if (filePromises.length > 0) {
                    const p = Promise.all(filePromises).then(async results => {
                        const attachData = results.map((data, i) => ({
                            name: fileInput.files[i].name,
                            type: fileInput.files[i].type,
                            data: data,
                            size: fileInput.files[i].size
                        }));
                        txData.attachments = attachData;
                        const createdTx = await addTransaction(txData);
                        if (createdTx) {
                            if (mainCategory === 'Fees') feeTxIds.push(createdTx.id);
                            added++;
                        }
                    });
                    promises.push(p);
                } else {
                    const p = addTransaction(txData).then(createdTx => {
                        if (createdTx) {
                            if (mainCategory === 'Fees') feeTxIds.push(createdTx.id);
                            added++;
                        }
                    });
                    promises.push(p);
                }
            });

            function finishSubmit() {
                clearIncomeRows();
                renderIncomeList();
                renderTransactions();
                refreshDashboard();
                updatePreviewCounts();
                // Auto-print fee receipts if any fee transactions were added
                if (feeTxIds.length > 0) {
                    setTimeout(() => printFeeReceipts(feeTxIds), 400);
                }
            }

            if (promises.length > 0) {
                Promise.all(promises).then(() => {
                    showToast('✅ ' + added + ' income entries added!', 'success');
                    finishSubmit();
                }).catch(err => {
                    showToast('Error: ' + err.message, 'error');
                });
            } else {
                if (added > 0) {
                    showToast('✅ ' + added + ' income entries added!', 'success');
                    finishSubmit();
                } else {
                    if (!document.querySelector('#incomeTableBody tr')) {
                        showToast('No entries to submit. Add some rows first.', 'error');
                    } else {
                        showToast('Please fill in all fields (Reference, Particulars, Amount).', 'error');
                    }
                }
            }
        }

        function readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
        }

        function clearIncomeRows() {
            document.getElementById('incomeTableBody').innerHTML = '';
            incomeRowCount = 0;
            // add one empty row
            addIncomeRow();
            updateIncomeAttachmentColumnVisibility();
        }

        // ─── Render Income List ───
        function renderIncomeList() {
            const list = transactions.filter(t => !t.isDeleted && t.type === 'income' && t.head !== 'Opening')
                .sort((a, b) => b.id - a.id)
                .slice(0, 20);
            const container = document.getElementById('incomeList');
            if (list.length === 0) {
                container.innerHTML = '<div class="empty-state"><span class="emoji">📭</span>No income entries yet.</div>';
                return;
            }
            container.innerHTML = list.map(t => {
                const categoryLabel = t.subCategory ? `${t.mainCategory} ➔ ${t.subCategory}` : t.mainCategory;
                let tagsHtml = '';
                if (t.tags && t.tags.length > 0) {
                    tagsHtml = t.tags.map(tag => `<span style="background: #f1f3f4; color: #5e6f8a; font-size: 10px; padding: 1px 6px; border-radius: 10px; margin-left: 4px;">#${escapeHtml(tag)}</span>`).join('');
                }
                let studentHtml = t.student ? `<span style="background: #e8f0fe; color: #1a73e8; font-size: 10px; padding: 1px 6px; border-radius: 10px; margin-left: 4px;">👤 ${escapeHtml(t.student.name)}</span>` : '';

                return `
                <div class="tx-item">
                  <span class="tx-type income">Income</span>
                  <span class="tx-date">${t.date}</span>
                  <span class="tx-particulars" style="flex: 2 1 180px;">
                      ${escapeHtml(t.reference)} — ${escapeHtml(t.particulars)}
                      ${studentHtml}
                      ${tagsHtml}
                  </span>
                  <span class="tx-amount income">+₹${t.amount.toFixed(2)}</span>
                  <span class="tx-head">${escapeHtml(categoryLabel)}</span>
                  ${t.attachments && t.attachments.length > 0 ? `<span class="tx-attach">📎${t.attachments.length}</span>` : ''}
                  <div class="tx-actions">
                    ${t.mainCategory === 'Fees' ? `<button class="btn btn-outline btn-xs" style="color:#4A1510;border-color:#4A1510;" onclick="printReceiptForTransaction(${t.id})">🖨️ Print Receipt</button>` : ''}
                    <button class="btn btn-danger btn-xs" onclick="deleteTransaction(${t.id});renderIncomeList();renderTransactions();refreshDashboard();updatePreviewCounts();">Delete</button>
                  </div>
                </div>
              `;
            }).join('');
        }

        // ════════════════════════════════════════════════════════════════
        //  EXPENSE BULK
        // ════════════════════════════════════════════════════════════════
        let expenseRowCount = 0;

        function addExpenseRow(data = {}) {
            const tbody = document.getElementById('expenseTableBody');
            const row = document.createElement('tr');
            const idx = expenseRowCount++;
            row.dataset.idx = idx;

            if (data.tags) {
                row.dataset.tags = JSON.stringify(data.tags);
            } else {
                row.dataset.tags = "[]";
            }
            if (data.student) {
                row.dataset.studentAdmission = data.student.admissionNumber;
                row.dataset.studentName = data.student.name;
                row.dataset.studentRoll = data.student.rollNumber || '';
            }

            row.innerHTML = `
            <td><input type="text" class="exp-ref" value="${data.reference || ''}" placeholder="Voucher No." /></td>
            <td>
                <input type="text" class="exp-particulars" value="${data.particulars || ''}" placeholder="Description" />
                <div class="row-badges" style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;"></div>
            </td>
            <td><input type="number" class="exp-amount" value="${data.amount || ''}" step="0.01" placeholder="0.00" /></td>
            <td><input type="number" class="exp-cheques" value="${data.chequeCount || 0}" step="1" min="0" placeholder="0" /></td>
            <td>
                <select class="exp-main-category" style="margin-bottom:4px;"></select>
                <select class="exp-sub-category" disabled></select>
            </td>
            <td><input type="file" class="exp-file" accept="image/*,application/pdf" multiple /></td>
            <td><button class="btn btn-danger btn-xs" onclick="removeExpenseRow(this)">✕</button></td>
          `;
            tbody.appendChild(row);

            const mainSel = row.querySelector('.exp-main-category');
            const subSel = row.querySelector('.exp-sub-category');

            populateMainCategoryDropdown(mainSel, 'expense', data.mainCategory || '');
            populateSubCategoryDropdown(subSel, data.mainCategory || '', data.subCategory || '');
            renderRowBadges(row);
        }

        function removeExpenseRow(btn) {
            const row = btn.closest('tr');
            row.remove();
        }

        function submitExpenseBulk() {
            const date = document.getElementById('expenseDate').value;
            if (!date) { showToast('Please select a date.', 'error'); return; }

            const rows = document.querySelectorAll('#expenseTableBody tr');
            let added = 0;
            const promises = [];

            rows.forEach(row => {
                const ref = row.querySelector('.exp-ref').value.trim();
                const particulars = row.querySelector('.exp-particulars').value.trim();
                const amount = parseFloat(row.querySelector('.exp-amount').value);
                const chequeCount = parseInt(row.querySelector('.exp-cheques').value) || 0;
                const mainCategory = row.querySelector('.exp-main-category').value;
                const subCategory = row.querySelector('.exp-sub-category').value;
                const fileInput = row.querySelector('.exp-file');

                const tagsList = row.dataset.tags ? JSON.parse(row.dataset.tags) : [];
                let studentObj = null;
                if (row.dataset.studentAdmission) {
                    studentObj = {
                        admissionNumber: row.dataset.studentAdmission,
                        name: row.dataset.studentName,
                        rollNumber: row.dataset.studentRoll || ''
                    };
                }

                if (!ref || !particulars || isNaN(amount) || amount === 0) {
                    return;
                }

                const filePromises = [];
                if (fileInput && fileInput.files.length > 0) {
                    for (let f of fileInput.files) {
                        filePromises.push(readFileAsBase64(f));
                    }
                }

                const txData = {
                    type: 'expense',
                    date: date,
                    reference: ref,
                    particulars: particulars,
                    amount: amount,
                    head: mainCategory || 'General',
                    mainCategory: mainCategory || 'General',
                    subCategory: subCategory || '',
                    tags: tagsList,
                    student: studentObj,
                    bankAmount: amount,
                    chequeCount: chequeCount,
                    attachments: []
                };

                if (filePromises.length > 0) {
                    const p = Promise.all(filePromises).then(results => {
                        const attachData = results.map((data, i) => ({
                            name: fileInput.files[i].name,
                            type: fileInput.files[i].type,
                            data: data,
                            size: fileInput.files[i].size
                        }));
                        txData.attachments = attachData;
                        addTransaction(txData);
                        added++;
                    });
                    promises.push(p);
                } else {
                    addTransaction(txData);
                    added++;
                }
            });

            if (promises.length > 0) {
                Promise.all(promises).then(() => {
                    showToast('✅ ' + added + ' expense entries added!', 'success');
                    clearExpenseRows();
                    renderExpenseList();
                    renderTransactions();
                    refreshDashboard();
                    updatePreviewCounts();
                }).catch(err => {
                    showToast('Error: ' + err.message, 'error');
                });
            } else {
                if (added > 0) {
                    showToast('✅ ' + added + ' expense entries added!', 'success');
                    clearExpenseRows();
                    renderExpenseList();
                    renderTransactions();
                    refreshDashboard();
                    updatePreviewCounts();
                } else {
                    if (!document.querySelector('#expenseTableBody tr')) {
                        showToast('No entries to submit. Add some rows first.', 'error');
                    } else {
                        showToast('Please fill in all fields (Voucher, Particulars, Amount).', 'error');
                    }
                }
            }
        }

        function clearExpenseRows() {
            document.getElementById('expenseTableBody').innerHTML = '';
            expenseRowCount = 0;
            addExpenseRow();
        }

        // ─── Render Expense List ───
        function renderExpenseList() {
            const list = transactions.filter(t => !t.isDeleted && t.type === 'expense')
                .sort((a, b) => b.id - a.id)
                .slice(0, 20);
            const container = document.getElementById('expenseList');
            if (list.length === 0) {
                container.innerHTML = '<div class="empty-state"><span class="emoji">📭</span>No expense entries yet.</div>';
                return;
            }
            container.innerHTML = list.map(t => {
                const categoryLabel = t.subCategory ? `${t.mainCategory} ➔ ${t.subCategory}` : t.mainCategory;
                let tagsHtml = '';
                if (t.tags && t.tags.length > 0) {
                    tagsHtml = t.tags.map(tag => `<span style="background: #f1f3f4; color: #5e6f8a; font-size: 10px; padding: 1px 6px; border-radius: 10px; margin-left: 4px;">#${escapeHtml(tag)}</span>`).join('');
                }
                let studentHtml = t.student ? `<span style="background: #e8f0fe; color: #1a73e8; font-size: 10px; padding: 1px 6px; border-radius: 10px; margin-left: 4px;">👤 ${escapeHtml(t.student.name)}</span>` : '';

                return `
                <div class="tx-item">
                  <span class="tx-type expense">Expense</span>
                  <span class="tx-date">${t.date}</span>
                  <span class="tx-particulars" style="flex: 2 1 180px;">
                      ${escapeHtml(t.reference)} — ${escapeHtml(t.particulars)}
                      ${studentHtml}
                      ${tagsHtml}
                  </span>
                  <span class="tx-amount expense">-₹${t.amount.toFixed(2)}</span>
                  <span class="tx-head">${escapeHtml(categoryLabel)}</span>
                  ${t.attachments && t.attachments.length > 0 ? `<span class="tx-attach">📎${t.attachments.length}</span>` : ''}
                  <div class="tx-actions">
                    <button class="btn btn-danger btn-xs" onclick="deleteTransaction(${t.id});renderExpenseList();renderTransactions();refreshDashboard();updatePreviewCounts();">Delete</button>
                  </div>
                </div>
              `;
            }).join('');
        }

        // ════════════════════════════════════════════════════════════════
        //  TRANSACTIONS (full list)
        // ════════════════════════════════════════════════════════════════
        function renderTransactions() {
            const type = document.getElementById('txFilterType').value;
            const dateFrom = document.getElementById('txFilterDateFrom').value;
            const dateTo = document.getElementById('txFilterDateTo').value;
            const amountMin = document.getElementById('txFilterAmountMin').value;
            const amountMax = document.getElementById('txFilterAmountMax').value;
            const mainCategory = document.getElementById('txFilterMainCategory').value;
            const subCategory = document.getElementById('txFilterSubCategory').value;
            const search = document.getElementById('txFilterSearch').value;
            const sortBy = document.getElementById('txSortBy').value;
            const sortOrder = document.getElementById('txSortOrder').value;
            const showDeleted = document.getElementById('txFilterShowDeleted').checked;

            const filtered = getTransactions({
                type, dateFrom, dateTo, search,
                amountFrom: amountMin, amountTo: amountMax,
                mainCategory, subCategory, sortBy, sortOrder, showDeleted
            });
            const container = document.getElementById('transactionList');
            document.getElementById('txCountDisplay').textContent = 'Showing ' + filtered.length + ' transactions';

            if (filtered.length === 0) {
                container.innerHTML = '<div class="empty-state"><span class="emoji">📭</span>No transactions found.</div>';
                return;
            }

            container.innerHTML = filtered.map(t => {
                const isIncome = t.type === 'income';
                const sign = isIncome ? '+' : '-';
                const cls = isIncome ? 'income' : 'expense';

                // Construct tags HTML
                let tagsHtml = '';
                if (t.tags && t.tags.length > 0) {
                    tagsHtml = t.tags.map(tag => `
                        <span style="background: #f1f3f4; color: #5e6f8a; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px;">#${escapeHtml(tag)}</span>
                    `).join('');
                }

                // Construct student HTML
                let studentHtml = '';
                if (t.student) {
                    studentHtml = `
                        <span style="background: #e8f0fe; color: #1a73e8; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px;">
                            👤 ${escapeHtml(t.student.name)} (${escapeHtml(t.student.admissionNumber)})
                        </span>
                    `;
                }

                // Construct audit string
                const creator = t.createdBy || 'Unknown';
                const createdTime = t.createdAt ? new Date(t.createdAt).toLocaleString() : 'Unknown';
                const updater = t.updatedBy || creator;
                const updatedTime = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : createdTime;

                let auditHtml = `
                    <div style="font-size: 11px; color: #7f8c8d; margin-top: 4px;">
                        Created by <b>${escapeHtml(creator)}</b> on ${createdTime}
                        ${updater !== creator || updatedTime !== createdTime ? ` | Last updated by <b>${escapeHtml(updater)}</b> on ${updatedTime}` : ''}
                        ${t.isDeleted ? ` | <span style="color:#b13e3e; font-weight:bold;">Archived (Deleted) by ${escapeHtml(t.deletedBy || 'unknown')}</span>` : ''}
                    </div>
                `;

                const categoryLabel = t.subCategory ? `${t.mainCategory} ➔ ${t.subCategory}` : t.mainCategory;

                const attachInfo = t.attachments && t.attachments.length > 0 ?
                    `<span class="tx-attach" onclick="viewAttachments(${t.id})">📎${t.attachments.length}</span>` :
                    '';

                return `
              <div class="tx-item" style="${t.isDeleted ? 'opacity: 0.6; border-style: dashed; background: #faf5f5;' : ''}">
                <span class="tx-type ${cls}">${isIncome ? 'Income' : 'Expense'}</span>
                <span class="tx-date">${t.date}</span>
                <div class="tx-particulars" style="display:flex; flex-direction:column; gap:4px; flex: 2 1 180px;">
                    <div>${escapeHtml(t.reference)} — ${escapeHtml(t.particulars)}</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                        ${studentHtml}
                        ${tagsHtml}
                    </div>
                    ${auditHtml}
                </div>
                <span class="tx-amount ${cls}">${sign}₹${t.amount.toFixed(2)}</span>
                <span class="tx-head" style="font-weight:600; font-size:12px; max-width:180px; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(categoryLabel)}</span>
                ${attachInfo}
                <div class="tx-actions" style="display:flex; gap:4px; align-items:center; margin-left:auto;">
                  ${t.isDeleted ? `
                     <button class="btn btn-outline btn-xs" onclick="restoreTransaction(${t.id})">Restore</button>
                     <button class="btn btn-danger btn-xs" onclick="permanentlyDeleteTransaction(${t.id})">Delete Permanently</button>
                  ` : `
                     <button class="btn btn-outline btn-xs" onclick="showEditTxModal(${t.id})">Edit</button>
                     <button class="btn btn-danger btn-xs" onclick="deleteTransaction(${t.id});renderTransactions();refreshDashboard();updatePreviewCounts();renderIncomeList();renderExpenseList();">Delete</button>
                  `}
                  ${(!t.isDeleted && t.mainCategory === 'Fees') ? `<button class="btn btn-outline btn-xs" style="color:#4A1510;border-color:#4A1510;" onclick="printReceiptForTransaction(${t.id})">🖨️ Print Receipt</button>` : ''}
                  <button class="btn btn-outline btn-xs" onclick="showHistoryTxModal(${t.id})">History</button>
                </div>
              </div>
            `;
            }).join('');
        }

        window.restoreTransaction = function (id) {
            const tx = transactions.find(t => t.id === id);
            if (!tx) return;
            const oldTx = JSON.parse(JSON.stringify(tx));

            tx.isDeleted = false;
            delete tx.deletedBy;
            tx.updatedBy = currentUser ? currentUser.email : 'System';
            tx.updatedAt = new Date().toISOString();

            saveData();
            const rev = trackRevision('RESTORE', oldTx, tx);
            pushOrQueueMutation('RESTORE', tx, rev);

            logActivity('Restore Transaction', id, `Restored transaction for ID: ${id}`);

            renderTransactions();
            refreshDashboard();
            updatePreviewCounts();
            renderIncomeList();
            renderExpenseList();
        };

        window.permanentlyDeleteTransaction = function (id) {
            if (!confirm('⚠️ Permanently delete this transaction? This action is irreversible and will delete it from Supabase as well!')) return;
            const idx = transactions.findIndex(t => t.id === id);
            if (idx === -1) return;
            const tx = transactions[idx];
            
            transactions.splice(idx, 1);
            saveData();

            // Track revision as a DELETE log (with old values but new values as null)
            const rev = trackRevision('DELETE', tx, null); 
            
            // Queue/Push the permanent delete mutation
            pushOrQueueMutation('PERMANENT_DELETE', tx, rev);

            logActivity('Permanent Delete', id, `Permanently deleted transaction for ID: ${id}`);

            renderTransactions();
            refreshDashboard();
            updatePreviewCounts();
            updateLocalStatus();
            renderIncomeList();
            renderExpenseList();
        };

        function resetTxFilters() {
            document.getElementById('txFilterDateFrom').value = '';
            document.getElementById('txFilterDateTo').value = '';
            document.getElementById('txFilterAmountMin').value = '';
            document.getElementById('txFilterAmountMax').value = '';
            document.getElementById('txFilterMainCategory').value = '';
            populateSubCategoryDropdown(document.getElementById('txFilterSubCategory'), '');
            document.getElementById('txFilterSearch').value = '';
            document.getElementById('txSortBy').value = 'id';
            document.getElementById('txSortOrder').value = 'desc';
            document.getElementById('txFilterType').value = 'all';
            document.getElementById('txFilterShowDeleted').checked = false;
            renderTransactions();
        }

        // ─── View attachments ───
        window.viewAttachments = function(id) {
            const tx = transactions.find(t => t.id === id);
            if (!tx || !tx.attachments || tx.attachments.length === 0) {
                showToast('No attachments for this transaction.', 'info');
                return;
            }

            const container = document.getElementById('attachmentListContainer');
            if (!container) return;
            container.innerHTML = '';

            tx.attachments.forEach(a => {
                const isLocal = a.data && a.data.startsWith('data:') && !a.url;
                const statusText = isLocal ? 'Local (Pending Sync)' : 'Synced';
                const statusColor = isLocal ? '#856404' : '#0f7b3a';
                const statusBg = isLocal ? '#fff3cd' : '#d4edda';
                const sizeText = a.size ? (a.size / 1024).toFixed(1) + ' KB' : 'Unknown size';
                
                // Determine file icon
                let fileIcon = '📄';
                const type = (a.type || '').toLowerCase();
                if (type.includes('image')) fileIcon = '🖼️';
                else if (type.includes('pdf')) fileIcon = '📕';

                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px;
                    border: 1px solid #eef2f8;
                    border-radius: 12px;
                    background: #f8fafc;
                    gap: 12px;
                `;
                
                row.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                        <span style="font-size: 24px; flex-shrink: 0;">${fileIcon}</span>
                        <div style="min-width: 0; flex: 1;">
                            <div class="attach-file-title" style="font-weight: 600; color: #0b2a4a; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 11px;">
                                <span style="color: #5e6f8a;">${sizeText}</span>
                                <span style="background: ${statusBg}; color: ${statusColor}; padding: 1px 6px; border-radius: 8px; font-weight: 600;">${statusText}</span>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                        <button class="btn btn-outline btn-attach-view" style="padding: 6px 10px; font-size: 12px; border-radius: 8px; justify-content: center; height: auto;">👁️ View</button>
                        <button class="btn btn-outline btn-attach-download" style="padding: 6px 10px; font-size: 12px; border-radius: 8px; justify-content: center; height: auto;">📥 Download</button>
                        <button class="btn btn-danger btn-attach-remove" style="padding: 6px 10px; font-size: 12px; border-radius: 8px; justify-content: center; height: auto; min-width: auto; width: 30px;">✕</button>
                    </div>
                `;
                const titleDiv = row.querySelector('.attach-file-title');
                titleDiv.textContent = a.name;
                titleDiv.title = a.name;
                row.querySelector('.btn-attach-view').addEventListener('click', () => viewAttachmentFile(tx.id, a.name));
                row.querySelector('.btn-attach-download').addEventListener('click', () => downloadAttachmentFile(tx.id, a.name));
                row.querySelector('.btn-attach-remove').addEventListener('click', () => removeAttachmentFile(tx.id, a.name));
                container.appendChild(row);
            });

            document.getElementById('attachmentModal').style.display = 'flex';
        };

        window.hideAttachmentModal = function() {
            const modal = document.getElementById('attachmentModal');
            if (modal) {
                modal.style.display = 'none';
            }
        };

        window.viewAttachmentFile = async function(txId, attachName) {
            const tx = transactions.find(t => t.id === txId);
            if (!tx || !tx.attachments) return;
            const attach = tx.attachments.find(a => a.name === attachName);
            if (!attach) return;

            const type = (attach.type || '').toLowerCase();
            const allowedViewTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
            const isSupported = allowedViewTypes.some(t => type.startsWith(t)) || 
                                 /\.(pdf|png|jpe?g|webp)$/i.test(attach.name);

            if (!isSupported) {
                showToast("Viewing not supported for this file type. Please download instead.", "info");
                return;
            }

            try {
                if (attach.data && attach.data.startsWith('data:')) {
                    const blob = await dataURLtoBlob(attach.data);
                    const blobUrl = URL.createObjectURL(blob);
                    window.open(blobUrl, '_blank');
                } else if (supabaseClient && supaConfig && (attach.storagePath || attach.url)) {
                    const path = attach.storagePath || attach.url.split(`/${supaConfig.bucket}/`)[1];
                    showToast("⏳ Fetching file preview from storage...", "info");
                    const { data, error } = await supabaseClient.storage
                        .from(supaConfig.bucket)
                        .download(path);
                    if (error) throw error;
                    const blobUrl = URL.createObjectURL(data);
                    window.open(blobUrl, '_blank');
                } else if (attach.url) {
                    window.open(attach.url, '_blank');
                } else {
                    showToast("Failed to view attachment: file data missing.", "error");
                }
            } catch (e) {
                console.error("Failed to view attachment:", e);
                showToast("Failed to view attachment.", "error");
            }
        };

        window.downloadAttachmentFile = async function(txId, attachName) {
            const tx = transactions.find(t => t.id === txId);
            if (!tx || !tx.attachments) return;
            const attach = tx.attachments.find(a => a.name === attachName);
            if (!attach) return;

            try {
                if (attach.data && attach.data.startsWith('data:')) {
                    const blob = await dataURLtoBlob(attach.data);
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = attach.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                } else if (supabaseClient && supaConfig && (attach.storagePath || attach.url)) {
                    const path = attach.storagePath || attach.url.split(`/${supaConfig.bucket}/`)[1];
                    showToast("⏳ Downloading file from storage...", "info");
                    const { data, error } = await supabaseClient.storage
                        .from(supaConfig.bucket)
                        .download(path);
                    if (error) throw error;
                    const blobUrl = URL.createObjectURL(data);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = attach.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                } else if (attach.url) {
                    await downloadFileFromUrlOrData(attach.url, attach.name);
                } else {
                    showToast("Failed to download: file source missing.", "error");
                }
            } catch (e) {
                console.error("Download failed:", e);
                showToast("Failed to download attachment.", "error");
            }
        };

        window.removeAttachmentFile = async function(txId, attachName) {
            if (!confirm(`Are you sure you want to remove the attachment "${attachName}"?`)) return;
            const tx = transactions.find(t => t.id === txId);
            if (!tx) return;

            const oldTx = JSON.parse(JSON.stringify(tx));
            tx.attachments = tx.attachments.filter(a => a.name !== attachName);
            tx.updatedAt = new Date().toISOString();
            if (currentUser) {
                tx.updatedBy = currentUser.email;
            }

            saveData();
            const rev = trackRevision('UPDATE', oldTx, tx);
            await pushOrQueueMutation('UPDATE', tx, rev);

            renderAll();
            
            // If there are still attachments, refresh modal, else close it
            if (tx.attachments.length > 0) {
                viewAttachments(txId);
            } else {
                hideAttachmentModal();
            }

            showToast("Attachment removed successfully.", "success");
        };

        async function downloadFileFromUrlOrData(urlOrData, filename) {
            try {
                let blob;
                if (urlOrData.startsWith('data:')) {
                    blob = await dataURLtoBlob(urlOrData);
                } else {
                    const res = await fetch(urlOrData);
                    blob = await res.blob();
                }
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            } catch (e) {
                console.error("Download failed:", e);
                showToast("Failed to download attachment.", "error");
            }
        }

        // ════════════════════════════════════════════════════════════════
        //  SUPABASE
        // ════════════════════════════════════════════════════════════════
        async function fetchConfigFromDNS(domain) {
            return null; // Defined as fallback no-op to prevent ReferenceErrors if called anywhere
        }

        function loadSupabaseConfig() {
            initSupabase();
            return supaConfig;
        }

        function initSupabase() {
            if (supaConfig && supaConfig.url && supaConfig.key && supaConfig.url !== 'YOUR_SUPABASE_URL') {
                try {
                    supabaseClient = supabase.createClient(supaConfig.url, supaConfig.key);
                    window.supabaseClient = supabaseClient;
                } catch (e) {
                    supabaseClient = null;
                    window.supabaseClient = null;
                }
            } else {
                supabaseClient = null;
                window.supabaseClient = null;
            }
            updateSupabaseStatus();
        }

        function updateSupabaseStatus() {
            updateLocalStatus();
            const el = document.getElementById('supaStatusDetail');
            const badge = document.getElementById('supaStatus');

            if (syncStatus === 'Syncing') {
                if (el) {
                    el.textContent = '⏳ Syncing transactions...';
                    el.className = 'status connected';
                }
                if (badge) {
                    badge.textContent = '☁️ Syncing...';
                    badge.style.background = '#d1ecf1';
                    badge.style.color = '#0c5460';
                }
            } else if (supabaseClient && supaConfig && syncStatus === 'Connected') {
                if (el) {
                    el.textContent = '✅ Connected to ' + supaConfig.url;
                    el.className = 'status connected';
                }
                if (badge) {
                    badge.textContent = '☁️ Connected';
                    badge.style.background = '#d4edda';
                    badge.style.color = '#0f7b3a';
                }
            } else {
                if (el) {
                    el.textContent = '⛔ Disconnected.';
                    el.className = 'status disconnected';
                }
                if (badge) {
                    badge.textContent = '☁️ Disconnected';
                    badge.style.background = '#f8d7da';
                    badge.style.color = '#721c24';
                }
            }
        }

        async function pushToSupabase() {
            if (!supabaseClient || !supaConfig) {
                showToast('Please configure Supabase in Settings first.', 'error');
                return;
            }
            if (transactions.length === 0) {
                showToast('No transactions to push.', 'info');
                return;
            }

            // Confirm
            if (!confirm('Push all ' + transactions.length + ' transactions to Supabase? This will overwrite remote data.'))
                return;

            try {
                showToast('⏳ Pushing to Supabase...', 'info', 10000);

                // For each transaction, if it has attachments, upload them to storage
                const txWithFiles = transactions.filter(t => t.attachments && t.attachments.length > 0);
                let uploadedCount = 0;

                for (let tx of transactions) {
                    const txData = { ...tx };
                    // Remove attachments from the data payload (we'll handle separately)
                    const attachments = txData.attachments || [];
                    delete txData.attachments;

                    const dbData = {
                        id: txData.id,
                        type: txData.type,
                        date: txData.date,
                        reference: txData.reference,
                        particulars: txData.particulars,
                        amount: txData.amount,
                        head: txData.head || txData.mainCategory || 'General',
                        bank_amount: txData.bankAmount,
                        cheque_count: txData.chequeCount,
                        main_category: txData.mainCategory,
                        sub_category: txData.subCategory,
                        tags: txData.tags || [],
                        created_by: txData.createdBy,
                        created_at: txData.createdAt,
                        updated_by: txData.updatedBy,
                        updated_at: txData.updatedAt,
                        deleted_by: txData.deletedBy || null,
                        is_deleted: txData.isDeleted || false
                    };

                    // Insert transaction
                    const { error: insertError } = await supabaseClient
                        .from(supaConfig.table)
                        .upsert(dbData);

                    if (insertError) throw insertError;

                    // Upload attachments
                    if (attachments.length > 0) {
                        for (let attach of attachments) {
                            if (attach.data && attach.data.startsWith('data:')) {
                                // Convert data URL to blob
                                const blob = await dataURLtoBlob(attach.data);
                                const path = tx.id + '/' + Date.now() + '_' + attach.name;
                                const { error: uploadError } = await supabaseClient.storage
                                    .from(supaConfig.bucket)
                                    .upload(path, blob, { contentType: attach.type, upsert: true });
                                if (uploadError) {
                                    console.warn('Upload error for ' + attach.name + ':', uploadError);
                                } else {
                                    uploadedCount++;
                                }
                            }
                        }
                    }
                }

                localStorage.setItem('school_accountant_last_sync', Date.now().toString());
                showToast('✅ Pushed ' + transactions.length + ' transactions to Supabase! (' + uploadedCount +
                    ' files uploaded)', 'success');
                refreshDashboard();

            } catch (e) {
                showToast('❌ Error pushing to Supabase: ' + e.message, 'error');
                console.error(e);
            }
        }

        function dataURLtoBlob(dataURL) {
            return fetch(dataURL).then(res => res.blob());
        }

        // ════════════════════════════════════════════════════════════════
        //  CSV EXPORT / IMPORT
        // ════════════════════════════════════════════════════════════════
        function exportCSV() {
            if (transactions.length === 0) {
                showToast('No data to export.', 'error');
                return;
            }
            const headers = ['id', 'type', 'date', 'reference', 'particulars', 'amount', 'head', 'bankAmount',
                'chequeCount'
            ];
            const rows = transactions.map(t => [
                t.id, t.type, t.date, t.reference, t.particulars, t.amount, t.head, t.bankAmount || 0, t.chequeCount || 0
            ]);
            const csv = Papa.unparse({ fields: headers, data: rows });
            downloadFile(csv, 'transactions_export.csv', 'text/csv');
            showToast('✅ CSV exported!', 'success');
        }

        function importCSV(event) {
            const file = event.target.files[0];
            if (!file) return;
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: function (results) {
                    if (results.errors.length > 0) {
                        showToast('⚠️ CSV parse errors: ' + results.errors.length, 'error');
                        console.warn(results.errors);
                    }
                    const data = results.data.filter(row => row.id && row.type);
                    let imported = 0;
                    data.forEach(row => {
                        const tx = {
                            type: row.type.trim().toLowerCase(),
                            date: row.date.trim(),
                            reference: row.reference.trim(),
                            particulars: row.particulars.trim(),
                            amount: parseFloat(row.amount) || 0,
                            head: (row.head || 'General').trim(),
                            bankAmount: parseFloat(row.bankAmount) || 0,
                            chequeCount: parseInt(row.chequeCount) || 0,
                            attachments: []
                        };
                        if (tx.type !== 'income' && tx.type !== 'expense') return;
                        if (!tx.date || !tx.reference || !tx.particulars || tx.amount === 0) return;
                        // check for duplicate by id
                        const existing = transactions.find(t => t.id === parseInt(row.id));
                        if (existing) {
                            // update
                            Object.assign(existing, tx);
                        } else {
                            tx.id = parseInt(row.id) || getNextId();
                            transactions.push(tx);
                        }
                        imported++;
                    });
                    saveData();
                    showToast('✅ Imported ' + imported + ' transactions from CSV.', 'success');
                    renderAll();
                },
                error: function (err) {
                    showToast('❌ CSV import failed: ' + err.message, 'error');
                }
            });
            event.target.value = '';
        }

        function downloadFile(content, filename, mimeType) {
            const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }

        // ════════════════════════════════════════════════════════════════
        //  JSON EXPORT / IMPORT (Full data)
        // ════════════════════════════════════════════════════════════════
        function exportAllData() {
            const data = { transactions, nextId, exportedAt: new Date().toISOString() };
            const json = JSON.stringify(data, null, 2);
            downloadFile(json, 'school_accountant_backup.json', 'application/json');
            showToast('✅ Full data exported!', 'success');
        }

        function importAllData(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.transactions && Array.isArray(data.transactions)) {
                        transactions = data.transactions;
                        nextId = data.nextId || 1;
                        saveData();
                        showToast('✅ Imported ' + transactions.length + ' transactions from backup.', 'success');
                        renderAll();
                    } else {
                        showToast('❌ Invalid backup file format.', 'error');
                    }
                } catch (err) {
                    showToast('❌ Failed to parse JSON: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        }

        function clearAllLocalData() {
            if (!confirm('⚠️ Delete ALL local transactions? This cannot be undone!')) return;
            if (!confirm('Are you sure? All data will be permanently removed from your browser.')) return;
            transactions = [];
            nextId = 1;
            saveData();
            renderAll();
            showToast('🗑️ All local data cleared.', 'info');
        }

        // ════════════════════════════════════════════════════════════════
        //  RENDER ALL
        // ════════════════════════════════════════════════════════════════
        function renderAll() {
            refreshDashboard();
            renderIncomeList();
            renderExpenseList();
            renderTransactions();
            updatePreviewCounts();
            updateLocalStatus();
            refreshFeesUI();
        }

        // ════════════════════════════════════════════════════════════════
        //  AUTOCOMPLETE & BADGES & METADATA EXTRACTION
        // ════════════════════════════════════════════════════════════════
        let activeInput = null;
        let activeRow = null;
        let triggerChar = null;
        let triggerIndex = -1;
        let selectedIndex = 0;
        let filteredOptions = [];

        // Attach event listeners to inputs for autocomplete
        document.addEventListener('input', handleAutocompleteInput);
        document.addEventListener('keydown', handleAutocompleteKeydown);
        document.addEventListener('click', function (e) {
            const dropdown = document.getElementById('autocompleteDropdown');
            if (dropdown && !dropdown.contains(e.target) && e.target !== activeInput) {
                dropdown.style.display = 'none';
            }
        });

        function handleAutocompleteInput(e) {
            const input = e.target;
            if (!input.classList.contains('inc-particulars') &&
                !input.classList.contains('exp-particulars') &&
                input.id !== 'editTxParticulars' &&
                input.id !== 'txFilterSearch') {
                return;
            }

            activeInput = input;
            activeRow = input.closest('tr');

            const cursor = input.selectionStart;
            const text = input.value.substring(0, cursor);

            // Find last @ or #
            const lastAt = text.lastIndexOf('@');
            const lastHash = text.lastIndexOf('#');

            let trigger = null;
            let index = -1;

            if (lastAt !== -1 && (lastHash === -1 || lastAt > lastHash)) {
                const after = text.substring(lastAt + 1);
                if (!after.includes(' ') && !after.includes('\n')) {
                    trigger = '@';
                    index = lastAt;
                }
            } else if (lastHash !== -1 && (lastAt === -1 || lastHash > lastAt)) {
                const after = text.substring(lastHash + 1);
                if (!after.includes(' ') && !after.includes('\n')) {
                    trigger = '#';
                    index = lastHash;
                }
            }

            if (trigger) {
                triggerChar = trigger;
                triggerIndex = index;
                const query = text.substring(index + 1).toLowerCase();
                showAutocompleteDropdown(query);
            } else {
                hideAutocompleteDropdown();
            }
        }

        function showAutocompleteDropdown(query) {
            const dropdown = document.getElementById('autocompleteDropdown');
            if (!dropdown) return;

            if (triggerChar === '@') {
                // filter students using prefix and word-start matching (like GitHub / YouTube)
                filteredOptions = students.filter(s => {
                    if (query === '') return true;
                    const nameLower = s.name.toLowerCase();
                    const admLower = s.admissionNumber.toLowerCase();
                    const rollLower = (s.rollNumber || '').toLowerCase();

                    const nameWords = nameLower.split(/\s+/);
                    const nameMatches = nameWords.some(word => word.startsWith(query));

                    return nameMatches || admLower.startsWith(query) || rollLower.startsWith(query);
                });
                // sort startsWith name first
                filteredOptions.sort((a, b) => {
                    const aStart = a.name.toLowerCase().startsWith(query);
                    const bStart = b.name.toLowerCase().startsWith(query);
                    if (aStart && !bStart) return -1;
                    if (!aStart && bStart) return 1;
                    return a.name.localeCompare(b.name);
                });
                filteredOptions = filteredOptions.slice(0, 10);
            } else {
                // filter tags using startsWith prefix matching
                filteredOptions = tags.filter(t => {
                    if (query === '') return true;
                    return t.toLowerCase().startsWith(query);
                });
                filteredOptions.sort((a, b) => {
                    const aStart = a.toLowerCase().startsWith(query);
                    const bStart = b.toLowerCase().startsWith(query);
                    if (aStart && !bStart) return -1;
                    if (!aStart && bStart) return 1;
                    return a.localeCompare(b);
                });
                filteredOptions = filteredOptions.slice(0, 10);
            }

            if (filteredOptions.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            selectedIndex = 0;
            renderAutocompleteOptions();

            const rect = activeInput.getBoundingClientRect();
            dropdown.style.top = (window.scrollY + rect.bottom) + 'px';
            dropdown.style.left = (window.scrollX + rect.left) + 'px';
            dropdown.style.display = 'block';
        }

        function renderAutocompleteOptions() {
            const dropdown = document.getElementById('autocompleteDropdown');
            if (!dropdown) return;

            dropdown.innerHTML = filteredOptions.map((opt, i) => {
                const isSelected = i === selectedIndex;
                const highlightStyle = isSelected ? 'background: #e8f0fe; font-weight: 600;' : '';

                if (triggerChar === '@') {
                    const rollPart = opt.rollNumber ? `, Roll: ${escapeHtml(opt.rollNumber)}` : '';
                    return `
                        <div class="auto-opt" data-idx="${i}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f4fa; font-size: 13px; ${highlightStyle}">
                            👤 <b>${escapeHtml(opt.name)}</b> <span style="color:#5e6f8a; font-size:11px;">(Adm: ${escapeHtml(opt.admissionNumber)}${rollPart})</span>
                        </div>
                    `;
                } else {
                    return `
                        <div class="auto-opt" data-idx="${i}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f4fa; font-size: 13px; ${highlightStyle}">
                            🏷️ <b>#${escapeHtml(opt)}</b>
                        </div>
                    `;
                }
            }).join('');

            dropdown.querySelectorAll('.auto-opt').forEach(el => {
                el.addEventListener('click', function () {
                    selectedIndex = parseInt(this.dataset.idx);
                    selectAutocompleteOption();
                });
            });
        }

        function selectAutocompleteOption() {
            if (selectedIndex < 0 || selectedIndex >= filteredOptions.length) return;
            const option = filteredOptions[selectedIndex];
            const input = activeInput;

            const cursor = input.selectionStart;
            const beforeTrigger = input.value.substring(0, triggerIndex);
            const afterCursor = input.value.substring(cursor);

            if (triggerChar === '@') {
                const insertText = `@${option.name} `;
                input.value = beforeTrigger + insertText + afterCursor;
                input.focus();

                const newCursorPos = triggerIndex + insertText.length;
                input.setSelectionRange(newCursorPos, newCursorPos);

                if (activeRow) {
                    activeRow.dataset.studentAdmission = option.admissionNumber;
                    activeRow.dataset.studentName = option.name;
                    activeRow.dataset.studentRoll = option.rollNumber || '';
                    renderRowBadges(activeRow);
                } else if (input.id === 'editTxParticulars') {
                    input.dataset.studentAdmission = option.admissionNumber;
                    input.dataset.studentName = option.name;
                    input.dataset.studentRoll = option.rollNumber || '';
                    renderEditTxBadges();
                }
            } else {
                const insertText = `#${option} `;
                input.value = beforeTrigger + insertText + afterCursor;
                input.focus();

                const newCursorPos = triggerIndex + insertText.length;
                input.setSelectionRange(newCursorPos, newCursorPos);

                if (activeRow) {
                    const tagsList = JSON.parse(activeRow.dataset.tags || '[]');
                    if (!tagsList.includes(option)) {
                        tagsList.push(option);
                    }
                    activeRow.dataset.tags = JSON.stringify(tagsList);
                    renderRowBadges(activeRow);
                } else if (input.id === 'editTxParticulars') {
                    const tagsList = JSON.parse(input.dataset.tags || '[]');
                    if (!tagsList.includes(option)) {
                        tagsList.push(option);
                    }
                    input.dataset.tags = JSON.stringify(tagsList);
                    renderEditTxBadges();
                }
            }

            hideAutocompleteDropdown();

            if (input.id === 'txFilterSearch') {
                renderTransactions();
            }
        }

        function hideAutocompleteDropdown() {
            const dropdown = document.getElementById('autocompleteDropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
            }
        }

        function handleAutocompleteKeydown(e) {
            const dropdown = document.getElementById('autocompleteDropdown');
            if (!dropdown || dropdown.style.display === 'none') return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % filteredOptions.length;
                renderAutocompleteOptions();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + filteredOptions.length) % filteredOptions.length;
                renderAutocompleteOptions();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                selectAutocompleteOption();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideAutocompleteDropdown();
            }
        }

        function renderRowBadges(row) {
            const badgesContainer = row.querySelector('.row-badges');
            if (!badgesContainer) return;
            badgesContainer.innerHTML = '';

            if (row.dataset.studentName) {
                const sBadge = document.createElement('span');
                sBadge.style = "background: #e8f0fe; color: #1a73e8; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; margin-top: 4px;";
                
                const labelSpan = document.createElement('span');
                labelSpan.textContent = '👤 ' + row.dataset.studentName;
                sBadge.appendChild(labelSpan);

                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove';
                removeSpan.style = "cursor:pointer; color:#b13e3e; margin-left:4px; font-weight:bold;";
                removeSpan.textContent = '✕';
                removeSpan.addEventListener('click', () => {
                    delete row.dataset.studentAdmission;
                    delete row.dataset.studentName;
                    delete row.dataset.studentRoll;
                    renderRowBadges(row);
                });
                sBadge.appendChild(removeSpan);
                badgesContainer.appendChild(sBadge);
            }

            const tagsList = JSON.parse(row.dataset.tags || '[]');
            tagsList.forEach(tag => {
                const tBadge = document.createElement('span');
                tBadge.style = "background: #f1f3f4; color: #5e6f8a; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; margin-top: 4px;";
                
                const tagSpan = document.createElement('span');
                tagSpan.textContent = '#' + tag;
                tBadge.appendChild(tagSpan);

                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove';
                removeSpan.style = "cursor:pointer; color:#b13e3e; margin-left:4px; font-weight:bold;";
                removeSpan.textContent = '✕';
                removeSpan.addEventListener('click', () => {
                    const newTags = tagsList.filter(t => t !== tag);
                    row.dataset.tags = JSON.stringify(newTags);
                    renderRowBadges(row);
                });
                tBadge.appendChild(removeSpan);
                badgesContainer.appendChild(tBadge);
            });
        }

        function renderEditTxBadges() {
            const input = document.getElementById('editTxParticulars');
            const badgesContainer = document.getElementById('editTxBadges');
            if (!badgesContainer || !input) return;
            badgesContainer.innerHTML = '';

            if (input.dataset.studentName) {
                const sBadge = document.createElement('span');
                sBadge.style = "background: #e8f0fe; color: #1a73e8; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; margin-top: 4px;";
                
                const labelSpan = document.createElement('span');
                labelSpan.textContent = '👤 ' + input.dataset.studentName;
                sBadge.appendChild(labelSpan);

                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove';
                removeSpan.style = "cursor:pointer; color:#b13e3e; margin-left:4px; font-weight:bold;";
                removeSpan.textContent = '✕';
                removeSpan.addEventListener('click', () => {
                    delete input.dataset.studentAdmission;
                    delete input.dataset.studentName;
                    delete input.dataset.studentRoll;
                    renderEditTxBadges();
                });
                sBadge.appendChild(removeSpan);
                badgesContainer.appendChild(sBadge);
            }

            const tagsList = JSON.parse(input.dataset.tags || '[]');
            tagsList.forEach(tag => {
                const tBadge = document.createElement('span');
                tBadge.style = "background: #f1f3f4; color: #5e6f8a; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; margin-top: 4px;";
                
                const tagSpan = document.createElement('span');
                tagSpan.textContent = '#' + tag;
                tBadge.appendChild(tagSpan);

                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove';
                removeSpan.style = "cursor:pointer; color:#b13e3e; margin-left:4px; font-weight:bold;";
                removeSpan.textContent = '✕';
                removeSpan.addEventListener('click', () => {
                    const newTags = tagsList.filter(t => t !== tag);
                    input.dataset.tags = JSON.stringify(newTags);
                    renderEditTxBadges();
                });
                tBadge.appendChild(removeSpan);
                badgesContainer.appendChild(tBadge);
            });
        }

        // Extracts tags and student details from plain text if datasets are missing
        function extractMetadataFromParticulars(particulars, currentTagsList, currentStudentObj) {
            let tagsList = [...currentTagsList];
            let studentObj = currentStudentObj ? { ...currentStudentObj } : null;

            const tagMatches = particulars.match(/#([^\s,#]+)/g);
            if (tagMatches) {
                tagMatches.forEach(m => {
                    const tagName = m.substring(1).toLowerCase();
                    if (!tagsList.includes(tagName)) {
                        tagsList.push(tagName);
                    }
                });
            }

            const studentMatches = particulars.match(/@([^\s,@]+)/g);
            if (studentMatches && !studentObj) {
                const query = studentMatches[0].substring(1).toLowerCase();
                const found = students.find(s => 
                    s.name.toLowerCase().includes(query) || 
                    s.admissionNumber.toLowerCase() === query || 
                    (s.rollNumber && s.rollNumber.toLowerCase() === query)
                );
                if (found) {
                    studentObj = found;
                }
            }
            return { tagsList, studentObj };
        }

        // ════════════════════════════════════════════════════════════════
        //  CATEGORIES & TAGS IN BULK INPUTS
        // ════════════════════════════════════════════════════════════════
        function populateMainCategoryDropdown(selectEl, type, defaultValue) {
            if (!selectEl) return;
            selectEl.innerHTML = '';

            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.textContent = selectEl.id === 'txFilterMainCategory' ? 'All Categories' : 'Select Category';
            selectEl.appendChild(defOpt);

            const mainCats = categories.filter(c => c.parent_id === null);
            mainCats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                selectEl.appendChild(opt);
            });

            if (defaultValue) {
                selectEl.value = defaultValue;
            }

            // Re-bind change handler dynamically for row inputs
            if (selectEl.classList.contains('inc-main-category') || selectEl.classList.contains('exp-main-category') || selectEl.id === 'editTxMainCategory') {
                selectEl.onchange = function () {
                    const row = this.closest('tr') || document.getElementById('editTxModal');
                    const subSel = row.querySelector('.inc-sub-category') || row.querySelector('.exp-sub-category') || document.getElementById('editTxSubCategory');
                    populateSubCategoryDropdown(subSel, this.value, '');

                    // Update attachment column visibility for income rows
                    if (this.classList.contains('inc-main-category')) {
                        updateIncomeAttachmentColumnVisibility();
                    }
                };
            }

            // Apply initial visibility for attachment column on Fees
            if (selectEl.classList.contains('inc-main-category')) {
                updateIncomeAttachmentColumnVisibility();
            }
        }

        function populateSubCategoryDropdown(selectEl, mainCategoryName, defaultValue) {
            if (!selectEl) return;
            selectEl.innerHTML = '';

            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.textContent = selectEl.id === 'txFilterSubCategory' ? 'All Subs' : 'Select Subcategory';
            selectEl.appendChild(defOpt);

            if (!mainCategoryName) {
                selectEl.disabled = true;
                return;
            }

            const parent = categories.find(c => c.name === mainCategoryName && c.parent_id === null);
            if (!parent) {
                selectEl.disabled = true;
                return;
            }

            const subs = categories.filter(c => c.parent_id === parent.id);
            if (subs.length === 0) {
                selectEl.disabled = true;
                return;
            }

            selectEl.disabled = false;
            subs.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.name;
                opt.textContent = s.name;
                selectEl.appendChild(opt);
            });

            if (defaultValue) {
                selectEl.value = defaultValue;
            }
        }

        // ════════════════════════════════════════════════════════════════
        //  SETTINGS: CATEGORIES & TAGS EDITORS
        // ════════════════════════════════════════════════════════════════
        window.showAddCategoryPrompt = function () {
            const name = prompt("Enter new Main Category name:");
            if (!name || !name.trim()) return;

            const trimmed = name.trim();
            const existing = categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase() && c.parent_id === null);
            if (existing) {
                showToast("Main Category already exists!", "error");
                return;
            }

            const nextCatId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
            categories.push({ id: nextCatId, name: trimmed, parent_id: null, type: 'all' });
            saveCategories();
            renderSettingsCategories();

            if (supabaseClient && supaConfig) {
                supabaseClient.from('categories').insert({ id: nextCatId, name: trimmed, parent_id: null, type: 'all' }).then(({ error }) => {
                    if (error) console.error("Supabase category insert failed:", error);
                });
            }
            populateMainCategoryDropdown(document.getElementById('txFilterMainCategory'), 'all', '');
        };

        window.addSubCategoryPrompt = function (parentId) {
            const name = prompt("Enter subcategory name:");
            if (!name || !name.trim()) return;
            const trimmed = name.trim();

            const existing = categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase() && c.parent_id === parentId);
            if (existing) {
                showToast("Subcategory already exists!", "error");
                return;
            }

            const nextCatId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
            categories.push({ id: nextCatId, name: trimmed, parent_id: parentId, type: 'all' });
            saveCategories();
            renderSettingsCategories();

            if (supabaseClient && supaConfig) {
                supabaseClient.from('categories').insert({ id: nextCatId, name: trimmed, parent_id: parentId, type: 'all' }).then(({ error }) => {
                    if (error) console.error("Supabase subcategory insert failed:", error);
                });
            }
        };

        window.deleteCategory = function (id) {
            if (!confirm("Are you sure you want to delete this category? Deleting a main category will also delete its subcategories.")) return;

            const toDeleteIds = [id];
            categories.forEach(c => {
                if (c.parent_id === id) {
                    toDeleteIds.push(c.id);
                }
            });

            categories = categories.filter(c => !toDeleteIds.includes(c.id));
            saveCategories();
            renderSettingsCategories();

            if (supabaseClient && supaConfig) {
                supabaseClient.from('categories').delete().in('id', toDeleteIds).then(({ error }) => {
                    if (error) console.error("Supabase category delete failed:", error);
                });
            }
            populateMainCategoryDropdown(document.getElementById('txFilterMainCategory'), 'all', '');
        };

        function renderSettingsCategories() {
            const container = document.getElementById('settingsCategoriesList');
            if (!container) return;

            const mainCats = categories.filter(c => c.parent_id === null);
            if (mainCats.length === 0) {
                container.innerHTML = '<div class="text-muted">No categories defined.</div>';
                return;
            }

            container.innerHTML = mainCats.map(parent => {
                const subs = categories.filter(c => c.parent_id === parent.id);
                const subsHtml = subs.map(sub => `
                    <div style="margin-left: 20px; display: flex; align-items: center; gap: 8px; padding: 2px 0;">
                        <span>↳ ${escapeHtml(sub.name)}</span>
                        <button class="btn btn-danger btn-xs" style="padding: 0px 4px; font-size: 9px;" onclick="deleteCategory(${sub.id})">✕</button>
                    </div>
                `).join('');

                return `
                    <div style="background:#f9fbfe; padding:8px 12px; border-radius:8px; border: 1px solid #e6ecf3; margin-bottom: 8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#0b2a4a;">
                            <span>📁 ${escapeHtml(parent.name)}</span>
                            <div style="display:flex; gap:4px;">
                                <button class="btn btn-primary btn-xs" style="font-size:10px; padding:1px 6px;" onclick="addSubCategoryPrompt(${parent.id})">+ Add Sub</button>
                                <button class="btn btn-danger btn-xs" style="font-size:10px; padding:1px 6px;" onclick="deleteCategory(${parent.id})">✕</button>
                            </div>
                        </div>
                        <div style="margin-top:4px;">
                            ${subsHtml || '<div style="margin-left:20px; font-size:11px; color:#95a5a6; font-style:italic;">No subcategories</div>'}
                        </div>
                    </div>
                `;
            }).join('');
        }

        window.showAddTagPrompt = function () {
            const name = prompt("Enter new tag (without #):");
            if (!name || !name.trim()) return;
            const trimmed = name.trim().toLowerCase().replace(/#/g, '');
            if (tags.includes(trimmed)) {
                showToast("Tag already exists!", "error");
                return;
            }
            tags.push(trimmed);
            saveTags();
            renderSettingsTags();

            if (supabaseClient && supaConfig) {
                supabaseClient.from('tags').insert({ name: trimmed }).then(({ error }) => {
                    if (error) console.error("Supabase tag insert failed:", error);
                });
            }
        };

        window.deleteTag = function (tag) {
            if (!confirm(`Are you sure you want to delete tag #${tag}?`)) return;
            tags = tags.filter(t => t !== tag);
            saveTags();
            renderSettingsTags();

            if (supabaseClient && supaConfig) {
                supabaseClient.from('tags').delete().eq('name', tag).then(({ error }) => {
                    if (error) console.error("Supabase tag delete failed:", error);
                });
            }
        };

        function renderSettingsTags() {
            const container = document.getElementById('settingsTagsList');
            if (!container) return;
            container.innerHTML = '';

            if (tags.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'text-muted';
                empty.textContent = 'No tags defined.';
                container.appendChild(empty);
                return;
            }

            tags.forEach(tag => {
                const span = document.createElement('span');
                span.style = 'background: #eef2f8; color: #1a2634; padding: 4px 10px; border-radius: 40px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #d7dfe9;';

                const label = document.createElement('span');
                label.textContent = '#' + tag;
                span.appendChild(label);

                const delBtn = document.createElement('span');
                delBtn.style = 'cursor:pointer; color:#b13e3e; font-weight:bold; margin-left:2px;';
                delBtn.textContent = '✕';
                delBtn.addEventListener('click', () => deleteTag(tag));
                span.appendChild(delBtn);

                container.appendChild(span);
            });
        }

        // ════════════════════════════════════════════════════════════════
        //  STUDENT DIRECTORY VIEW RESUMES
        // ════════════════════════════════════════════════════════════════

        window.openStudentDirectory = function() {
            // Reset filters & page size dropdown on open to clean up state
            document.getElementById('studentSearchInput').value = '';
            
            // Set up page size selector
            const sizeSelect = document.getElementById('studentPageSizeSelect');
            if (sizeSelect) {
                sizeSelect.value = '25';
            }
            studentPageSize = 25;
            studentCurrentPage = 1;
            studentSortBy = 'name';
            studentSortOrder = 'asc';

            // Populate class/section dropdown filters
            populateStudentFilters();

            // Open Modal
            document.getElementById('studentDirectoryModal').style.display = 'flex';

            // Render table
            renderStudentDirectory();
        };

        window.hideStudentDirectoryModal = function() {
            document.getElementById('studentDirectoryModal').style.display = 'none';
        };

        window.resetStudentFilters = function() {
            document.getElementById('studentSearchInput').value = '';
            document.getElementById('studentFilterClass').value = '';
            document.getElementById('studentFilterSection').value = '';
            studentCurrentPage = 1;
            
            // Re-populate cascade filters
            populateSectionFilter();
            
            renderStudentDirectory();
        };

        window.populateStudentFilters = function() {
            const classSelect = document.getElementById('studentFilterClass');
            if (!classSelect) return;

            const currentClass = classSelect.value;

            // Extract unique class values from loaded students list
            const classes = new Set();
            students.forEach(s => {
                if (s.class && s.class.trim() !== '') {
                    classes.add(s.class.trim());
                }
            });

            // Sort classes alphanumerically
            const sortedClasses = Array.from(classes).sort((a, b) => {
                const numA = parseFloat(a);
                const numB = parseFloat(b);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return numA - numB;
                }
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            classSelect.innerHTML = '<option value="">All Classes</option>' +
                sortedClasses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

            if (classes.has(currentClass)) {
                classSelect.value = currentClass;
            } else {
                classSelect.value = '';
            }

            // Populate section dropdown based on class selection
            populateSectionFilter();
        };

        window.populateSectionFilter = function() {
            const classSelect = document.getElementById('studentFilterClass');
            const sectionSelect = document.getElementById('studentFilterSection');
            if (!classSelect || !sectionSelect) return;

            const selectedClass = classSelect.value;
            const currentSection = sectionSelect.value;

            const sections = new Set();
            students.forEach(s => {
                // If a class filter is active, only extract sections of students in that class
                if (selectedClass && s.class !== selectedClass) return;
                
                if (s.section && s.section.trim() !== '') {
                    sections.add(s.section.trim());
                }
            });

            // Sort sections alphanumerically
            const sortedSections = Array.from(sections).sort((a, b) => {
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            sectionSelect.innerHTML = '<option value="">All Sections</option>' +
                sortedSections.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

            // Preserve selection if it's still available, otherwise reset
            if (sections.has(currentSection)) {
                sectionSelect.value = currentSection;
            } else {
                sectionSelect.value = '';
            }
        };

        window.handleStudentPageSizeChange = function() {
            const val = document.getElementById('studentPageSizeSelect').value;
            if (val === 'all') {
                studentPageSize = students.length || 100000;
            } else {
                studentPageSize = parseInt(val, 10);
            }
            studentCurrentPage = 1;
            renderStudentDirectory();
        };

        window.handleStudentSort = function(field) {
            if (studentSortBy === field) {
                studentSortOrder = studentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                studentSortBy = field;
                studentSortOrder = 'asc';
            }
            studentCurrentPage = 1; // reset to page 1 on sort change
            renderStudentDirectory();
        };

        window.changeStudentPage = function(page) {
            studentCurrentPage = page;
            renderStudentDirectory();
        };

        window.viewStudentTransactions = function(admissionNumber, name) {
            hideStudentDirectoryModal();

            // Switch to All Transactions Tab by clicking it
            const tabBtn = document.querySelector('button[data-tab="transactions"]');
            if (tabBtn) {
                tabBtn.click();
            }

            // Set the search input filter and apply it
            const searchInput = document.getElementById('txFilterSearch');
            if (searchInput) {
                searchInput.value = `@${admissionNumber}`;
                renderTransactions();
            }
        };

        window.renderStudentDirectory = function() {
            const searchVal = document.getElementById('studentSearchInput').value.trim().toLowerCase();
            const classVal = document.getElementById('studentFilterClass').value;
            const sectionVal = document.getElementById('studentFilterSection').value;

            const totalCount = students.length;

            // Compute unique classes & unique class-section combinations for stats
            const classesSet = new Set();
            const classSectionSet = new Set();
            students.forEach(s => {
                const cls = (s.class || '').trim();
                const sec = (s.section || '').trim();
                if (cls) classesSet.add(cls);
                if (cls || sec) classSectionSet.add(`${cls}_${sec}`);
            });

            // Update stats cards in Directory modal
            const totalEl = document.getElementById('directoryTotalStudents');
            const classesEl = document.getElementById('directoryTotalClasses');
            const sectionsEl = document.getElementById('directoryTotalSections');
            const importedEl = document.getElementById('directoryLastImported');

            if (totalEl) totalEl.textContent = totalCount;
            if (classesEl) classesEl.textContent = classesSet.size;
            if (sectionsEl) sectionsEl.textContent = classSectionSet.size;
            if (importedEl) {
                importedEl.textContent = studentsLastImported ? studentsLastImported : 'Never';
                importedEl.title = studentsLastImported ? studentsLastImported : 'Never';
            }

            const tableWrap = document.querySelector('#studentDirectoryModal .bulk-table-wrap');
            const paginationEl = document.getElementById('studentDirectoryPagination');
            const summaryEl = document.getElementById('studentDirectorySummary');
            const tableBody = document.getElementById('studentDirectoryTableBody');

            // Handle empty state at database level
            if (totalCount === 0) {
                if (tableWrap) tableWrap.style.display = 'none';
                if (paginationEl) paginationEl.innerHTML = '';
                if (summaryEl) summaryEl.innerHTML = '';
                
                let emptyEl = document.getElementById('studentDirectoryEmptyState');
                if (!emptyEl) {
                    emptyEl = document.createElement('div');
                    emptyEl.id = 'studentDirectoryEmptyState';
                    emptyEl.className = 'empty-state';
                    emptyEl.innerHTML = '<span class="emoji">📭</span>No students imported yet.<br>Import a Student CSV to begin.';
                    tableWrap.parentNode.insertBefore(emptyEl, tableWrap);
                } else {
                    emptyEl.style.display = 'block';
                }
                return;
            } else {
                if (tableWrap) tableWrap.style.display = 'block';
                const emptyEl = document.getElementById('studentDirectoryEmptyState');
                if (emptyEl) emptyEl.style.display = 'none';
            }

            // Filter students
            let filtered = students.filter(s => {
                if (classVal && s.class !== classVal) return false;
                if (sectionVal && s.section !== sectionVal) return false;

                if (searchVal) {
                    const name = (s.name || '').toLowerCase();
                    const adm = (s.admissionNumber || '').toLowerCase();
                    const roll = (s.rollNumber || '').toLowerCase();
                    if (!name.includes(searchVal) && !adm.includes(searchVal) && !roll.includes(searchVal)) {
                        return false;
                    }
                }
                return true;
            });

            // Sort students
            filtered.sort((a, b) => {
                let valA = a[studentSortBy] || '';
                let valB = b[studentSortBy] || '';

                if (studentSortBy === 'admissionNumber' || studentSortBy === 'rollNumber') {
                    const numA = parseInt(valA, 10);
                    const numB = parseInt(valB, 10);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return studentSortOrder === 'asc' ? numA - numB : numB - numA;
                    }
                }

                // Default string alphanumeric sort
                const comparison = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                return studentSortOrder === 'asc' ? comparison : -comparison;
            });

            // Update Sort UI indicators in table headers
            ['admissionNumber', 'name', 'class', 'section'].forEach(col => {
                const iconEl = document.getElementById('sort-icon-' + col);
                if (iconEl) {
                    if (studentSortBy === col) {
                        iconEl.textContent = studentSortOrder === 'asc' ? ' ▲' : ' ▼';
                        iconEl.style.color = '#1d4b6e';
                    } else {
                        iconEl.textContent = '';
                    }
                }
            });

            // Paginate
            const totalFiltered = filtered.length;
            const totalPages = Math.ceil(totalFiltered / studentPageSize) || 1;

            if (studentCurrentPage > totalPages) {
                studentCurrentPage = totalPages;
            }
            if (studentCurrentPage < 1) {
                studentCurrentPage = 1;
            }

            const startIndex = (studentCurrentPage - 1) * studentPageSize;
            const endIndex = Math.min(startIndex + studentPageSize, totalFiltered);
            const pageItems = filtered.slice(startIndex, endIndex);

            // Render table body rows
            if (totalFiltered === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 40px; color: #5e6f8a;">
                            No matching students found.
                        </td>
                    </tr>
                `;
                if (summaryEl) summaryEl.textContent = 'Showing 0 to 0 of 0 students (filtered)';
                if (paginationEl) paginationEl.innerHTML = '';
                return;
            }

            tableBody.innerHTML = pageItems.map(s => `
                <tr>
                    <td data-label="Admission No"><b>${escapeHtml(s.admissionNumber)}</b></td>
                    <td data-label="Student Name">${escapeHtml(s.name)}</td>
                    <td data-label="Roll Number">${escapeHtml(s.rollNumber || '—')}</td>
                    <td data-label="Class">${escapeHtml(s.class || '—')}</td>
                    <td data-label="Section">${escapeHtml(s.section || '—')}</td>
                    <td data-label="Father Name">${escapeHtml(s.fatherName || '—')}</td>
                    <td data-label="Phone Number">${escapeHtml(s.phone || '—')}</td>
                    <td data-label="Actions">
                        <button class="btn btn-outline btn-xs btn-view-student-tx" data-admission="${escapeHtml(s.admissionNumber)}" data-name="${escapeHtml(s.name)}">🔍 View Transactions</button>
                    </td>
                </tr>
            `).join('');

            tableBody.querySelectorAll('.btn-view-student-tx').forEach(btn => {
                btn.addEventListener('click', () => {
                    viewStudentTransactions(btn.dataset.admission, btn.dataset.name);
                });
            });

            // Update footer pagination controls & summary text
            if (summaryEl) {
                summaryEl.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} students` +
                    (totalFiltered !== totalCount ? ` (filtered from ${totalCount})` : '');
            }

            if (paginationEl) {
                let html = '';
                
                // Prev page
                html += `<button class="btn btn-outline btn-xs" ${studentCurrentPage === 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="changeStudentPage(${studentCurrentPage - 1})">◀ Prev</button>`;

                // Visible page buttons
                const maxVisiblePages = 5;
                let startPage = Math.max(1, studentCurrentPage - 2);
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

                if (endPage - startPage < maxVisiblePages - 1) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }

                if (startPage > 1) {
                    html += `<button class="btn btn-outline btn-xs" onclick="changeStudentPage(1)">1</button>`;
                    if (startPage > 2) {
                        html += `<span style="padding: 0 4px; color: #5e6f8a;">...</span>`;
                    }
                }

                for (let p = startPage; p <= endPage; p++) {
                    const isActive = p === studentCurrentPage;
                    html += `<button class="btn btn-xs ${isActive ? 'btn-primary' : 'btn-outline'}" onclick="changeStudentPage(${p})">${p}</button>`;
                }

                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                        html += `<span style="padding: 0 4px; color: #5e6f8a;">...</span>`;
                    }
                    html += `<button class="btn btn-outline btn-xs" onclick="changeStudentPage(${totalPages})">${totalPages}</button>`;
                }

                // Next page
                html += `<button class="btn btn-outline btn-xs" ${studentCurrentPage === totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="changeStudentPage(${studentCurrentPage + 1})">Next ▶</button>`;

                paginationEl.innerHTML = html;
            }
        };

        // ════════════════════════════════════════════════════════════════
        //  SETTINGS: STUDENT CSV IMPORT
        // ════════════════════════════════════════════════════════════════
        window.importStudentCSV = function (event) {
            if (!window.isImportingStudentCSV) {
                console.warn("[Import] Blocked automated CSV import event on page load.");
                event.target.value = '';
                return;
            }
            window.isImportingStudentCSV = false;
            const file = event.target.files[0];
            if (!file) return;

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: async function (results) {
                    const rows = results.data;
                    if (rows.length === 0) {
                        showToast('CSV file is empty.', 'error');
                        return;
                    }

                    const standardKeys = ['admission_no', 'admission no', 'admission number', 'admissionno', 'adm no', 'adm_no', 'adm', 'student_name', 'student name', 'name', 'class', 'section', 'father_name', 'father name', 'father', 'phone', 'phone number', 'phone_number', 'contact', 'roll_number', 'roll number', 'roll_no', 'roll no', 'roll'];
                    const headers = Object.keys(rows[0]);
                    const feeColumns = [];

                    function cleanFeeHeader(header) {
                        let clean = header.trim();
                        clean = clean.replace(/\s+(fees?|remarks?|reasons?|notes?)$/i, '');
                        clean = clean.replace(/\s+fee$/i, '');
                        if (clean.length > 0) {
                            clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                        }
                        return clean;
                    }

                    headers.forEach(header => {
                        const lower = header.trim().toLowerCase();
                        if (!standardKeys.includes(lower)) {
                            const cleanName = cleanFeeHeader(header);
                            const isRemarks = /remarks?|reason|note/i.test(lower);
                            if (isRemarks) {
                                feeColumns.push({
                                    originalHeader: header,
                                    cleanName: cleanName + ' Remarks',
                                    isRemarks: true,
                                    parentFeeName: cleanName
                                });
                            } else {
                                feeColumns.push({
                                    originalHeader: header,
                                    cleanName: cleanName,
                                    isRemarks: false
                                });
                            }
                        }
                    });

                    const parsedData = [];
                    rows.forEach(row => {
                        const admKey = Object.keys(row).find(k => k.trim() === 'admission_no' || /admission|adm/i.test(k));
                        const nameKey = Object.keys(row).find(k => k.trim() === 'student_name' || /name/i.test(k));
                        const rollKey = Object.keys(row).find(k => k.trim() === 'roll_number' || /roll/i.test(k));
                        const classKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'class');
                        const sectionKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'section');
                        const fatherKey = Object.keys(row).find(k => k.trim() === 'father_name' || /father/i.test(k));
                        const phoneKey = Object.keys(row).find(k => k.trim() === 'phone' || /phone|contact/i.test(k));

                        const admissionNumber = admKey && row[admKey] ? row[admKey].trim() : '';
                        const name = nameKey && row[nameKey] ? row[nameKey].trim() : '';
                        const rollNumber = rollKey && row[rollKey] ? row[rollKey].trim() : '';
                        const className = classKey && row[classKey] ? row[classKey].trim() : '';
                        const section = sectionKey && row[sectionKey] ? row[sectionKey].trim() : '';
                        const fatherName = fatherKey && row[fatherKey] ? row[fatherKey].trim() : '';
                        const phone = phoneKey && row[phoneKey] ? row[phoneKey].trim() : '';

                        if (admissionNumber && name) {
                            const studentFees = {};
                            const studentRemarks = {};
                            feeColumns.forEach(col => {
                                if (col.isRemarks) {
                                    studentRemarks[col.parentFeeName] = row[col.originalHeader] ? row[col.originalHeader].trim() : '';
                                } else {
                                    studentFees[col.cleanName] = parseFloat(row[col.originalHeader]) || 0;
                                }
                            });

                            parsedData.push({
                                student: {
                                    admissionNumber,
                                    name,
                                    rollNumber,
                                    class: className,
                                    section,
                                    fatherName,
                                    phone
                                },
                                fees: studentFees,
                                remarks: studentRemarks
                            });
                        }
                    });

                    if (parsedData.length > 0) {
                        showCsvPreview(parsedData, feeColumns);
                    } else {
                        showToast('No valid students found. Ensure CSV headers contain Name and Admission Number.', 'error');
                    }
                },
                error: function (err) {
                    showToast('CSV parsing failed: ' + err.message, 'error');
                }
            });
            event.target.value = '';
        };

        window.clearAllStudentData = async function () {
            if (!confirm('Are you sure you want to clear all student directory data?')) return;
            
            localStorage.setItem('school_accountant_students_cleared', 'true');
            students = [];
            saveStudents();
            
            studentsLastImported = '';
            localStorage.removeItem(LAST_IMPORTED_KEY);
            
            updateStudentCountDisplay();
            
            if (typeof renderStudentDirectory === 'function') {
                populateStudentFilters();
                renderStudentDirectory();
            }
            
            showToast('Student directory cleared locally.', 'info');

            if (supabaseClient && supaConfig) {
                if (navigator.onLine) {
                    try {
                        const { error } = await supabaseClient.from('students').delete().neq('admission_number', '');
                        if (error) throw error;
                        showToast('Deleted from local & remote.', 'success');
                    } catch (err) {
                        console.error(err);
                        showToast('Remote student delete failed. Queued for sync.', 'warning');
                    }
                } else {
                    showToast('Offline. Queued remote student deletion for sync.', 'warning');
                }
            }
        };

        function updateStudentCountDisplay() {
            const el = document.getElementById('settingsStudentCount');
            if (el) {
                el.textContent = `Total Students Loaded: ${students.length}`;
            }
            const lastImportedEl = document.getElementById('settingsStudentLastImported');
            if (lastImportedEl) {
                lastImportedEl.textContent = `Last Imported: ${studentsLastImported ? studentsLastImported : 'Never'}`;
            }
        }

        // ════════════════════════════════════════════════════════════════
        //  EDIT TRANSACTION MODAL HANDLERS
        // ════════════════════════════════════════════════════════════════
        window.showEditTxModal = function (id) {
            const tx = transactions.find(t => t.id === id);
            if (!tx) return;

            document.getElementById('editTxId').value = tx.id;
            document.getElementById('editTxDate').value = tx.date;
            document.getElementById('editTxRef').value = tx.reference;
            document.getElementById('editTxParticulars').value = tx.particulars;
            document.getElementById('editTxAmount').value = tx.amount;
            document.getElementById('editTxBankAmount').value = tx.bankAmount;
            document.getElementById('editTxCheques').value = tx.chequeCount;

            const mainSel = document.getElementById('editTxMainCategory');
            const subSel = document.getElementById('editTxSubCategory');

            populateMainCategoryDropdown(mainSel, tx.type, tx.mainCategory || '');
            populateSubCategoryDropdown(subSel, tx.mainCategory || '', tx.subCategory || '');

            const particularsInput = document.getElementById('editTxParticulars');
            particularsInput.dataset.tags = JSON.stringify(tx.tags || []);
            if (tx.student) {
                particularsInput.dataset.studentAdmission = tx.student.admissionNumber;
                particularsInput.dataset.studentName = tx.student.name;
                particularsInput.dataset.studentRoll = tx.student.rollNumber || '';
            } else {
                delete particularsInput.dataset.studentAdmission;
                delete particularsInput.dataset.studentName;
                delete particularsInput.dataset.studentRoll;
            }

            renderEditTxBadges();
            document.getElementById('editTxModal').style.display = 'flex';
        };

        window.hideEditTxModal = function () {
            document.getElementById('editTxModal').style.display = 'none';
        };

        window.saveEditedTx = function () {
            const id = parseInt(document.getElementById('editTxId').value);
            const date = document.getElementById('editTxDate').value;
            const reference = document.getElementById('editTxRef').value.trim();
            const particulars = document.getElementById('editTxParticulars').value.trim();
            const amount = parseFloat(document.getElementById('editTxAmount').value) || 0;
            const bankAmount = parseFloat(document.getElementById('editTxBankAmount').value) || 0;
            const chequeCount = parseInt(document.getElementById('editTxCheques').value) || 0;
            const mainCategory = document.getElementById('editTxMainCategory').value;
            const subCategory = document.getElementById('editTxSubCategory').value;

            if (!date || !reference || !particulars || amount === 0) {
                showToast('Please fill in Date, Reference, Particulars, and Amount.', 'error');
                return;
            }

            const particularsInput = document.getElementById('editTxParticulars');
            const initialTags = particularsInput.dataset.tags ? JSON.parse(particularsInput.dataset.tags) : [];
            let initialStudent = null;
            if (particularsInput.dataset.studentAdmission) {
                initialStudent = {
                    admissionNumber: particularsInput.dataset.studentAdmission,
                    name: particularsInput.dataset.studentName,
                    rollNumber: particularsInput.dataset.studentRoll || ''
                };
            }

            const { tagsList, studentObj } = extractMetadataFromParticulars(particulars, initialTags, initialStudent);

            const updates = {
                date,
                reference,
                particulars,
                amount,
                bankAmount,
                chequeCount,
                mainCategory,
                subCategory,
                tags: tagsList,
                student: studentObj,
                head: mainCategory || 'General'
            };

            updateTransaction(id, updates);
            hideEditTxModal();
            renderTransactions();
            refreshDashboard();
            updatePreviewCounts();
            renderIncomeList();
            renderExpenseList();
            showToast('✅ Transaction updated successfully!', 'success');
        };

        // ════════════════════════════════════════════════════════════════
        //  REVISION HISTORY TIMELINE HANDLERS
        // ════════════════════════════════════════════════════════════════
        window.showHistoryTxModal = function (id) {
            const txRevs = revisions.filter(r => r.transaction_id === id)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            const container = document.getElementById('historyTxTimeline');
            if (!container) return;

            if (txRevs.length === 0) {
                container.innerHTML = '<div class="empty-state">No revisions logged for this transaction.</div>';
            } else {
                container.innerHTML = txRevs.map(r => {
                    let diffHtml = '';
                    if (r.action === 'UPDATE' && r.old_values && r.new_values) {
                        const changes = [];
                        const trackKeys = ['date', 'reference', 'particulars', 'amount', 'mainCategory', 'subCategory', 'tags', 'student'];
                        trackKeys.forEach(k => {
                            const oldVal = JSON.stringify(r.old_values[k]);
                            const newVal = JSON.stringify(r.new_values[k]);
                            if (oldVal !== newVal) {
                                let displayOld = '';
                                let displayNew = '';
                                if (k === 'student') {
                                    displayOld = r.old_values[k] ? `${escapeHtml(r.old_values[k].name)} (${escapeHtml(r.old_values[k].admissionNumber)})` : 'none';
                                    displayNew = r.new_values[k] ? `${escapeHtml(r.new_values[k].name)} (${escapeHtml(r.new_values[k].admissionNumber)})` : 'none';
                                } else if (k === 'tags') {
                                    displayOld = r.old_values[k] && r.old_values[k].length > 0 ? r.old_values[k].map(escapeHtml).join(', ') : 'none';
                                    displayNew = r.new_values[k] && r.new_values[k].length > 0 ? r.new_values[k].map(escapeHtml).join(', ') : 'none';
                                } else {
                                    displayOld = r.old_values[k] !== undefined && r.old_values[k] !== null ? escapeHtml(String(r.old_values[k])) : 'none';
                                    displayNew = r.new_values[k] !== undefined && r.new_values[k] !== null ? escapeHtml(String(r.new_values[k])) : 'none';
                                }
                                changes.push(`<div><b>${k}</b>: <span style="text-decoration: line-through; color: #b13e3e;">${displayOld}</span> ➔ <span style="color: #0f7b3a; font-weight: bold;">${displayNew}</span></div>`);
                            }
                        });
                        if (changes.length > 0) {
                            diffHtml = `<div style="font-size:12px; margin-top:6px; background:#f8f9fa; padding:8px; border-radius:8px; border-left: 3px solid #1a73e8; line-height: 1.4;">${changes.join('')}</div>`;
                        }
                    } else if (r.action === 'CREATE') {
                        diffHtml = `<div style="font-size:12px; margin-top:4px; color:#5e6f8a;">Created transaction with amount ₹${(r.new_values?.amount || 0).toFixed(2)}.</div>`;
                    } else if (r.action === 'DELETE') {
                        diffHtml = `<div style="font-size:12px; margin-top:4px; color:#b13e3e; font-weight:bold;">Transaction soft-deleted (archived).</div>`;
                    } else if (r.action === 'RESTORE') {
                        diffHtml = `<div style="font-size:12px; margin-top:4px; color:#0f7b3a; font-weight:bold;">Transaction restored to active list.</div>`;
                    }

                    let badgeCls = 'accent';
                    if (r.action === 'CREATE') badgeCls = 'positive';
                    if (r.action === 'DELETE') badgeCls = 'negative';
                    if (r.action === 'RESTORE') badgeCls = 'positive';

                    return `
                      <div style="border-bottom: 1px solid #eef2f8; padding-bottom: 12px; margin-bottom: 4px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                          <span class="badge" style="font-size:10px; font-weight: 700; text-transform:uppercase; background:${badgeCls === 'positive' ? '#d4edda' : badgeCls === 'negative' ? '#f8dddd' : '#eef2f8'}; color:${badgeCls === 'positive' ? '#0f7b3a' : badgeCls === 'negative' ? '#b13e3e' : '#1d4b6e'}; padding: 2px 10px; border-radius: 20px;">${r.action}</span>
                          <span style="font-size:12px; color:#5e6f8a;">${new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        <div style="font-size:13px; margin-top:4px;">By <b>${escapeHtml(r.created_by)}</b></div>
                        ${diffHtml}
                      </div>
                    `;
                }).join('');
            }
            document.getElementById('historyTxModal').style.display = 'flex';
        };

        window.hideHistoryTxModal = function () {
            document.getElementById('historyTxModal').style.display = 'none';
        };

        // ════════════════════════════════════════════════════════════════
        //  TAB SWITCHING
        // ════════════════════════════════════════════════════════════════
        // ════════════════════════════════════════════════════════════════
        //  FEE MANAGEMENT ERP MODULE LOGIC
        // ════════════════════════════════════════════════════════════════
        
        function refreshFeesUI() {
            if (typeof renderFeesOverview === 'function') {
                renderFeesOverview();
                const activeTabBtn = document.querySelector('#tabNav button.active');
                if (activeTabBtn && activeTabBtn.dataset.tab === 'fees') {
                    const activeSubBtn = document.querySelector('#feesSubTabNav .sub-tab-btn.active');
                    if (activeSubBtn) {
                        renderFeesSubTab(activeSubBtn.dataset.subtab);
                    }
                }
                const ledgerModal = document.getElementById('feeLedgerModal');
                if (ledgerModal && ledgerModal.style.display === 'flex') {
                    const activeAdm = document.getElementById('ledgerAdmissionNo').textContent;
                    if (activeAdm) {
                        showFeeLedger(activeAdm);
                    }
                }
            }
        }

        function initSubTabs() {
            const btns = document.querySelectorAll('#feesSubTabNav .sub-tab-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', () => {
                    btns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    const subtab = btn.dataset.subtab;
                    const contents = document.querySelectorAll('#tab-fees .sub-tab-content');
                    contents.forEach(content => {
                        if (content.id === `subtab-${subtab}`) {
                            content.classList.add('active');
                        } else {
                            content.classList.remove('active');
                        }
                    });
                    
                    renderFeesSubTab(subtab);
                });
            });
        }

        function renderFeesSubTab(subtab) {
            if (subtab === 'fees-overview') renderFeesOverview();
            else if (subtab === 'fees-status') {
                populateFeesStatusFilters();
                renderFeesStatus();
            }
            else if (subtab === 'fees-assignments') {
                populateAssignFilters();
                renderStudentFeeAssignments();
            }
            else if (subtab === 'fees-reports') {
                populateReportsCategoryFilter();
                renderFeesReports();
            }
            else if (subtab === 'fees-types') renderFeesTypes();
        }

        function getClassesList() {
            const classes = new Set();
            students.forEach(s => {
                if (s.class && s.class.trim() !== '') classes.add(s.class.trim());
            });
            return Array.from(classes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }

        function getSectionsList(className) {
            const sections = new Set();
            students.forEach(s => {
                if (s.section && s.section.trim() !== '' && (!className || s.class === className)) {
                    sections.add(s.section.trim());
                }
            });
            return Array.from(sections).sort();
        }

        function getFeesParentCategory() {
            return categories.find(c => c.name.toLowerCase() === 'fees' && c.parent_id === null) || categories.find(c => c.id === 1);
        }

        function getActiveFeeTypes() {
            const parent = getFeesParentCategory();
            if (!parent) return ['Tuition', 'Hostel', 'Transport', 'Exam', 'Registration'];
            return categories.filter(c => c.parent_id === parent.id).map(c => c.name);
        }

        function getCategoryFrequency(cat) {
            if (cat && cat.frequency) return cat.frequency;
            const name = cat ? (cat.name || '').toLowerCase() : '';
            if (name === 'tuition' || name === 'transport' || name === 'hostel') {
                return 'Monthly';
            }
            return 'Yearly';
        }

        // Calculation of student structured dues and paid amounts
        window.getStudentFeeDues = function(student, academicYear) {
            const dues = [];
            if (!student) return dues;
            
            const rawAssignments = studentFeeAssignments.filter(a => a.student_id === student.admissionNumber && a.academic_year === academicYear);
            
            // Deduplicate assignments by category to prevent duplicate calculations
            const assignments = [];
            const seenCategories = new Set();
            rawAssignments.forEach(a => {
                if (!seenCategories.has(a.fee_category_id)) {
                    seenCategories.add(a.fee_category_id);
                    assignments.push(a);
                }
            });
            
            const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
            
            assignments.forEach(assign => {
                const cat = categories.find(c => c.id === assign.fee_category_id);
                if (!cat) return;
                
                const feeType = cat.name;
                const freq = getCategoryFrequency(cat);
                const totalAmount = assign.assigned_amount;
                
                const txs = transactions
                    .filter(t => !t.isDeleted &&
                                 t.type === 'income' &&
                                 t.mainCategory === 'Fees' &&
                                 t.subCategory && t.subCategory.toLowerCase() === feeType.toLowerCase() &&
                                 t.student && t.student.admissionNumber === student.admissionNumber &&
                                 t.academicYear === academicYear);
                
                const totalPaid = txs.reduce((sum, t) => sum + t.amount, 0);
                
                if (totalPaid === 0) {
                    dues.push({
                        fee_type: feeType,
                        frequency: freq,
                        month: 'April',
                        structured_amount: totalAmount,
                        paid_amount: 0,
                        due_amount: totalAmount
                    });
                } else {
                    const monthPayments = {};
                    txs.forEach(t => {
                        const m = t.feeMonth || 'April';
                        monthPayments[m] = (monthPayments[m] || 0) + t.amount;
                    });
                    
                    Object.keys(monthPayments).forEach(m => {
                        dues.push({
                            fee_type: feeType,
                            frequency: freq,
                            month: m,
                            structured_amount: monthPayments[m],
                            paid_amount: monthPayments[m],
                            due_amount: 0
                        });
                    });
                    
                    const unpaid = totalAmount - totalPaid;
                    if (unpaid > 0) {
                        const AprilDue = dues.find(d => d.fee_type === feeType && d.month === 'April');
                        if (AprilDue) {
                            AprilDue.structured_amount += unpaid;
                            AprilDue.due_amount += unpaid;
                        } else {
                            dues.push({
                                fee_type: feeType,
                                frequency: freq,
                                month: 'April',
                                structured_amount: unpaid,
                                paid_amount: 0,
                                due_amount: unpaid
                            });
                        }
                    } else if (unpaid < 0) {
                        const AprilDue = dues.find(d => d.fee_type === feeType && d.month === 'April');
                        if (AprilDue) {
                            AprilDue.structured_amount = Math.max(0, AprilDue.structured_amount + unpaid);
                            AprilDue.due_amount = Math.max(0, AprilDue.due_amount + unpaid);
                        } else {
                            const firstDue = dues.find(d => d.fee_type === feeType);
                            if (firstDue) {
                                firstDue.structured_amount = Math.max(0, firstDue.structured_amount + unpaid);
                                firstDue.due_amount = Math.max(0, firstDue.due_amount + unpaid);
                            }
                        }
                    }
                }
            });
            
            return dues;
        };

        function renderFeesOverview() {
            populateFeesAcademicYears();
            const year = document.getElementById('feesOverviewAcademicYear').value;
            if (!year) return;
            
            const stats = {
                totalStudents: students.length,
                paid: 0,
                pending: 0,
                partial: 0,
                outstanding: 0,
                todayCollection: 0,
                monthCollection: 0
            };
            
            const todayStr = new Date().toISOString().split('T')[0];
            const currentMonth = new Date().getMonth();
            const currentYear = new Date().getFullYear();
            
            students.forEach(student => {
                const dues = getStudentFeeDues(student, year);
                const totalDue = dues.reduce((sum, d) => sum + d.structured_amount, 0);
                const totalPaid = dues.reduce((sum, d) => sum + d.paid_amount, 0);
                const outstanding = dues.reduce((sum, d) => sum + d.due_amount, 0);
                
                stats.outstanding += outstanding;
                
                if (totalDue > 0) {
                    if (outstanding === 0) {
                        stats.paid++;
                    } else if (totalPaid === 0) {
                        stats.pending++;
                    } else {
                        stats.partial++;
                    }
                } else {
                    stats.paid++;
                }
            });
            
            transactions.forEach(t => {
                if (t.type === 'income' && t.mainCategory === 'Fees' && !t.isDeleted) {
                    const tDate = new Date(t.date);
                    if (t.date === todayStr) {
                        stats.todayCollection += t.amount;
                    }
                    if (tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear) {
                        stats.monthCollection += t.amount;
                    }
                }
            });
            
            const statsGrid = document.getElementById('feesOverviewStats');
            statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="label">Total Students</div>
                    <div class="value accent">${stats.totalStudents}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Fully Paid</div>
                    <div class="value positive">${stats.paid}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Partially Paid</div>
                    <div class="value warning">${stats.partial}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Fully Pending</div>
                    <div class="value negative">${stats.pending}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Today's Collection</div>
                    <div class="value positive">₹${stats.todayCollection.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Month's Collection</div>
                    <div class="value positive">₹${stats.monthCollection.toFixed(2)}</div>
                </div>
                <div class="stat-card" style="border: 2px solid #f8dddd;">
                    <div class="label" style="color:#b13e3e; font-weight:700;">Pending Fees</div>
                    <div class="value negative">₹${stats.outstanding.toFixed(2)}</div>
                </div>
            `;
            
            const breakdownContainer = document.getElementById('feesOverviewTypeBreakdown');
            breakdownContainer.innerHTML = '';
            
            const activeTypes = getActiveFeeTypes();
            const collectionsByType = {};
            activeTypes.forEach(type => collectionsByType[type] = 0);
            
            transactions.forEach(t => {
                if (t.type === 'income' && t.mainCategory === 'Fees' && !t.isDeleted && t.subCategory) {
                    const matchedType = activeTypes.find(at => at.toLowerCase() === t.subCategory.toLowerCase());
                    if (matchedType) {
                        collectionsByType[matchedType] += t.amount;
                    }
                }
            });
            
            const maxCollection = Math.max(...Object.values(collectionsByType), 1);
            
            activeTypes.forEach(type => {
                const amt = collectionsByType[type];
                const pct = (amt / maxCollection) * 100;
                
                const item = document.createElement('div');
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; color:#3d5068; margin-bottom:4px;">
                        <span>${escapeHtml(type)}</span>
                        <span>₹${amt.toFixed(2)}</span>
                    </div>
                    <div style="background:#eef2f8; height:8px; border-radius:4px; overflow:hidden;">
                        <div style="background:#0b2a4a; width:${pct}%; height:100%; border-radius:4px;"></div>
                    </div>
                `;
                breakdownContainer.appendChild(item);
            });
            
            const recentContainer = document.getElementById('feesOverviewRecentCollections');
            recentContainer.innerHTML = '';
            
            const recentFeeTxs = transactions
                .filter(t => t.type === 'income' && t.mainCategory === 'Fees' && !t.isDeleted)
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 5);
                
            if (recentFeeTxs.length === 0) {
                recentContainer.innerHTML = `<div class="text-muted text-center" style="padding:20px;">No recent fee collections found.</div>`;
            } else {
                recentFeeTxs.forEach(t => {
                    const studentName = t.student ? t.student.name : 'Unknown Student';
                    const rollClass = t.student ? `(Class ${t.student.class})` : '';
                    const item = document.createElement('div');
                    item.className = 'tx-item';
                    item.style = 'display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eef2f8; padding:10px 0;';
                    item.innerHTML = `
                        <div style="text-align:left;">
                            <div style="font-weight:600; color:#1a2634; font-size:13px;">${escapeHtml(studentName)} <span style="font-size:11px; color:#5e6f8a;">${escapeHtml(rollClass)}</span></div>
                            <div style="font-size:11px; color:#8c9ba5; margin-top:2px;">
                                ${escapeHtml(t.subCategory || 'General')} | Month: ${escapeHtml(t.feeMonth || 'N/A')} | ${escapeHtml(t.date)}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-weight:700; color:#0f7b3a; font-size:14px;">+₹${t.amount.toFixed(2)}</div>
                            <span class="badge-status paid" style="font-size:9px; padding:1px 5px; margin-top:3px;">${escapeHtml(t.reference || 'Receipt')}</span>
                        </div>
                    `;
                    recentContainer.appendChild(item);
                });
            }
        }

        function populateFeesAcademicYears() {
            const selects = ['feesOverviewAcademicYear', 'feesStatusAcademicYear', 'structAcademicYear', 'reportsAcademicYear'];
            const years = new Set([getCurrentAcademicYear()]);
            feeStructures.forEach(s => years.add(s.academic_year));
            studentFeeAssignments.forEach(a => years.add(a.academic_year));
            feePayments.forEach(p => years.add(p.academic_year));
            
            const sortedYears = Array.from(years).sort().reverse();
            selects.forEach(selId => {
                const el = document.getElementById(selId);
                if (el) {
                    const currentVal = el.value;
                    el.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
                    if (currentVal && sortedYears.includes(currentVal)) {
                        el.value = currentVal;
                    } else {
                        el.value = getCurrentAcademicYear();
                    }
                }
            });
        }

        window.populateFeesStatusFilters = function() {
            const classSelect = document.getElementById('feesStatusClass');
            if (!classSelect) return;
            const classes = getClassesList();
            const curClass = classSelect.value;
            classSelect.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c}">${c}</option>`).join('');
            if (classes.includes(curClass)) {
                classSelect.value = curClass;
            }
            
            populateFeesStatusSectionFilter();
            
            const typeSelect = document.getElementById('feesStatusType');
            if (typeSelect) {
                const activeTypes = getActiveFeeTypes();
                const curType = typeSelect.value;
                typeSelect.innerHTML = '<option value="">All Fee Types</option>' + activeTypes.map(t => `<option value="${t}">${t}</option>`).join('');
                if (activeTypes.includes(curType)) {
                    typeSelect.value = curType;
                }
            }
        };

        window.populateFeesStatusSectionFilter = function() {
            const classSelect = document.getElementById('feesStatusClass');
            const sectionSelect = document.getElementById('feesStatusSection');
            if (!classSelect || !sectionSelect) return;
            const cls = classSelect.value;
            const curSec = sectionSelect.value;
            const sections = getSectionsList(cls);
            
            sectionSelect.innerHTML = '<option value="">All Sections</option>' + sections.map(s => `<option value="${s}">${s}</option>`).join('');
            if (sections.includes(curSec)) {
                sectionSelect.value = curSec;
            }
        };

        window.resetFeesStatusFilters = function() {
            document.getElementById('feesStatusClass').value = '';
            populateFeesStatusSectionFilter();
            document.getElementById('feesStatusSection').value = '';
            document.getElementById('feesStatusType').value = '';
            document.getElementById('feesStatusMonth').value = '';
            document.getElementById('feesStatusFilter').value = 'all';
            renderFeesStatus();
        };

        function renderFeesStatus() {
            const year = document.getElementById('feesStatusAcademicYear').value;
            if (!year) return;
            
            const clsFilter = document.getElementById('feesStatusClass').value;
            const secFilter = document.getElementById('feesStatusSection').value;
            const typeFilter = document.getElementById('feesStatusType').value;
            const monthFilter = document.getElementById('feesStatusMonth').value;
            const statusFilter = document.getElementById('feesStatusFilter').value;
            
            let filteredStudents = students.filter(s => {
                if (clsFilter && s.class !== clsFilter) return false;
                if (secFilter && s.section !== secFilter) return false;
                return true;
            });
            
            const feeTypesCols = typeFilter ? [typeFilter] : getActiveFeeTypes();
            const header = document.getElementById('feesStatusMatrixHeader');
            header.innerHTML = `
                <tr>
                    <th style="min-width:180px; text-align:left;">Student Details</th>
                    ${feeTypesCols.map(t => `<th style="min-width:110px;">${escapeHtml(t)}</th>`).join('')}
                    <th style="min-width:90px;">Total Due</th>
                    <th style="min-width:90px;">Paid</th>
                    <th style="min-width:90px;">Pending Fees</th>
                    <th style="min-width:90px;">Status</th>
                </tr>
            `;
            
            const tbody = document.getElementById('feesStatusMatrixBody');
            tbody.innerHTML = '';
            
            let matchedCount = 0;
            let totalStructuredAll = 0;
            let totalPaidAll = 0;
            let totalOutstandingAll = 0;
            
            filteredStudents.forEach(s => {
                const dues = getStudentFeeDues(s, year);
                
                let sDues = dues.filter(d => {
                    if (typeFilter && d.fee_type.toLowerCase() !== typeFilter.toLowerCase()) return false;
                    if (monthFilter && d.month !== monthFilter) return false;
                    return true;
                });
                
                const sStructured = sDues.reduce((sum, d) => sum + d.structured_amount, 0);
                const sPaid = sDues.reduce((sum, d) => sum + d.paid_amount, 0);
                const sOutstanding = sDues.reduce((sum, d) => sum + d.due_amount, 0);
                
                let sStatus = 'Pending';
                if (sStructured > 0) {
                    if (sOutstanding === 0) sStatus = 'Paid';
                    else if (sPaid > 0) sStatus = 'Partial';
                } else {
                    sStatus = 'Paid';
                }
                
                if (statusFilter !== 'all' && sStatus !== statusFilter) return;
                
                matchedCount++;
                totalStructuredAll += sStructured;
                totalPaidAll += sPaid;
                totalOutstandingAll += sOutstanding;
                
                const cellsHtml = feeTypesCols.map(type => {
                    const typeDues = sDues.filter(d => d.fee_type.toLowerCase() === type.toLowerCase());
                    const typeStructured = typeDues.reduce((sum, d) => sum + d.structured_amount, 0);
                    const typePaid = typeDues.reduce((sum, d) => sum + d.paid_amount, 0);
                    const typeOutstanding = typeDues.reduce((sum, d) => sum + d.due_amount, 0);
                    
                    if (typeStructured === 0) {
                        return `<td><span class="text-muted">–</span></td>`;
                    }
                    
                    if (typeOutstanding === 0) {
                        return `<td><span class="badge-status paid">₹${typePaid} Paid</span></td>`;
                    } else if (typePaid === 0) {
                        return `<td><span class="badge-status pending">₹${typeOutstanding} Due</span></td>`;
                    } else {
                        return `<td><span class="badge-status partial">₹${typePaid}/₹${typeStructured}</span></td>`;
                    }
                }).join('');
                
                let statusBadgeClass = 'pending';
                if (sStatus === 'Paid') statusBadgeClass = 'paid';
                else if (sStatus === 'Partial') statusBadgeClass = 'partial';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="text-align:left;">
                        <a href="#" class="student-ledger-link" style="font-weight:700; color:#0b2a4a; text-decoration:none;">${escapeHtml(s.name)}</a>
                        <div style="font-size:11px; color:#5e6f8a; margin-top:2px;">Adm: ${escapeHtml(s.admissionNumber)} | Cls: ${escapeHtml(s.class)}-${escapeHtml(s.section)}</div>
                    </td>
                    ${cellsHtml}
                    <td>₹${sStructured.toFixed(0)}</td>
                    <td>₹${sPaid.toFixed(0)}</td>
                    <td style="color:${sOutstanding > 0 ? '#b13e3e' : 'inherit'}; font-weight:${sOutstanding > 0 ? '700' : 'bold'};">₹${sOutstanding.toFixed(0)}</td>
                    <td><span class="badge-status ${statusBadgeClass}">${escapeHtml(sStatus)}</span></td>
                `;
                const ledgerLink = row.querySelector('.student-ledger-link');
                if (ledgerLink) {
                    ledgerLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        showFeeLedger(s.admissionNumber);
                    });
                }
                tbody.appendChild(row);
            });
            
            document.getElementById('feesStatusSummary').innerHTML = `Showing <b>${matchedCount}</b> students of <b>${filteredStudents.length}</b>. Grand Totals – Structured: <b>₹${totalStructuredAll.toFixed(2)}</b> | Paid: <b>₹${totalPaidAll.toFixed(2)}</b> | Pending Fees: <strong class="negative">₹${totalOutstandingAll.toFixed(2)}</strong>`;
        }

        window.renderStudentFeeAssignments = function() {
            populateAssignAcademicYears();
            const year = document.getElementById('assignAcademicYear').value;
            if (!year) return;
            
            const clsFilter = document.getElementById('assignClass').value;
            const secFilter = document.getElementById('assignSection').value;
            const searchVal = document.getElementById('assignSearchInput').value.toLowerCase().trim();
            
            let filteredStudents = students.filter(s => {
                if (clsFilter && s.class !== clsFilter) return false;
                if (secFilter && s.section !== secFilter) return false;
                if (searchVal) {
                    const nameMatch = s.name.toLowerCase().includes(searchVal);
                    const admMatch = s.admissionNumber.toLowerCase().includes(searchVal);
                    return nameMatch || admMatch;
                }
                return true;
            });
            
            const activeFeeTypes = getActiveFeeTypes();
            const parent = getFeesParentCategory();
            
            const header = document.getElementById('assignMatrixHeader');
            header.innerHTML = `
                <tr>
                    <th style="min-width:180px; text-align:left;">Student</th>
                    <th style="min-width:100px;">Admission No</th>
                    <th style="min-width:80px;">Class</th>
                    ${activeFeeTypes.map(t => `<th style="min-width:100px;">${escapeHtml(t)}</th>`).join('')}
                    <th style="min-width:120px;">Total Assigned Fee</th>
                    <th style="min-width:90px;">Actions</th>
                </tr>
            `;
            
            const tbody = document.getElementById('assignMatrixBody');
            tbody.innerHTML = '';
            
            let matchedCount = 0;
            let grandTotalAssigned = 0;
            
            filteredStudents.forEach(student => {
                const sAssignments = studentFeeAssignments.filter(a => a.student_id === student.admissionNumber && a.academic_year === year);
                
                let studentTotal = 0;
                
                const cellsHtml = activeFeeTypes.map(type => {
                    const cat = categories.find(c => c.name.toLowerCase() === type.toLowerCase() && c.parent_id === parent.id);
                    if (!cat) return `<td><span>₹0</span></td>`;
                    
                    const assign = sAssignments.find(a => a.fee_category_id === cat.id);
                    const amount = assign ? assign.assigned_amount : 0;
                    const remarks = assign ? (assign.remarks || '') : '';
                    studentTotal += amount;
                    
                    const remarksTooltip = remarks ? ` title="${escapeHtml(remarks)}"` : '';
                    const remarksIndicator = remarks ? ` <span style="font-size:10px; color:#5e6f8a; cursor:help;" title="${escapeHtml(remarks)}">📝</span>` : '';
                    return `<td><span${remarksTooltip}>₹${amount.toFixed(0)}${remarksIndicator}</span></td>`;
                }).join('');
                
                grandTotalAssigned += studentTotal;
                matchedCount++;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="text-align:left; font-weight:600; color:#0b2a4a;">${escapeHtml(student.name)}</td>
                    <td>${escapeHtml(student.admissionNumber)}</td>
                    <td>Class ${escapeHtml(student.class)}-${escapeHtml(student.section || 'N/A')}</td>
                    ${cellsHtml}
                    <td style="font-weight:700; color:#1d4b6e;">₹${studentTotal.toFixed(0)}</td>
                    <td>
                        <button class="btn btn-outline btn-xs btn-edit-student-fees">Edit</button>
                    </td>
                `;
                const editBtn = row.querySelector('.btn-edit-student-fees');
                if (editBtn) {
                    editBtn.addEventListener('click', () => {
                        showEditStudentFees(student.admissionNumber, year);
                    });
                }
                tbody.appendChild(row);
            });
            
            document.getElementById('assignSummary').innerHTML = `Showing <b>${matchedCount}</b> students of <b>${filteredStudents.length}</b>. Grand Total Assigned Fees: <strong>₹${grandTotalAssigned.toFixed(2)}</strong>`;
        };

        window.populateAssignFilters = function() {
            const classSelect = document.getElementById('assignClass');
            if (!classSelect) return;
            const classes = getClassesList();
            const curClass = classSelect.value;
            classSelect.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c}">${c}</option>`).join('');
            if (classes.includes(curClass)) {
                classSelect.value = curClass;
            }
            populateAssignSectionFilter();
        };
        
        window.populateAssignSectionFilter = function() {
            const classSelect = document.getElementById('assignClass');
            const sectionSelect = document.getElementById('assignSection');
            if (!classSelect || !sectionSelect) return;
            const cls = classSelect.value;
            const curSec = sectionSelect.value;
            const sections = getSectionsList(cls);
            
            sectionSelect.innerHTML = '<option value="">All Sections</option>' + sections.map(s => `<option value="${s}">${s}</option>`).join('');
            if (sections.includes(curSec)) {
                sectionSelect.value = curSec;
            }
        };
        
        window.resetAssignFilters = function() {
            document.getElementById('assignClass').value = '';
            populateAssignSectionFilter();
            document.getElementById('assignSection').value = '';
            document.getElementById('assignSearchInput').value = '';
            renderStudentFeeAssignments();
        };
        
        function populateAssignAcademicYears() {
            const el = document.getElementById('assignAcademicYear');
            if (!el) return;
            const years = new Set([getCurrentAcademicYear()]);
            studentFeeAssignments.forEach(a => years.add(a.academic_year));
            feePayments.forEach(p => years.add(p.academic_year));
            
            const sortedYears = Array.from(years).sort().reverse();
            const currentVal = el.value;
            el.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
            if (currentVal && sortedYears.includes(currentVal)) {
                el.value = currentVal;
            } else {
                el.value = getCurrentAcademicYear();
            }
        }

        window.showEditStudentFees = function(admissionNo, year) {
            const student = students.find(s => s.admissionNumber === admissionNo);
            if (!student) return;
            
            document.getElementById('editStudentFeesAdmissionNo').value = admissionNo;
            document.getElementById('editStudentFeesAcademicYear').value = year;
            document.getElementById('editStudentFeesTitle').textContent = `Edit Student Fees: ${student.name}`;
            
            const fieldsContainer = document.getElementById('editStudentFeesFields');
            fieldsContainer.innerHTML = '';
            
            const activeFeeTypes = getActiveFeeTypes();
            const sAssignments = studentFeeAssignments.filter(a => a.student_id === admissionNo && a.academic_year === year);
            const parent = getFeesParentCategory();
            
            activeFeeTypes.forEach(type => {
                const cat = categories.find(c => c.name.toLowerCase() === type.toLowerCase() && c.parent_id === parent.id);
                if (!cat) return;
                
                const assign = sAssignments.find(a => a.fee_category_id === cat.id);
                const amount = assign ? assign.assigned_amount : 0;
                const remarks = assign ? (assign.remarks || '') : '';
                
                const field = document.createElement('div');
                field.className = 'field';
                field.style = 'display:flex; flex-direction:column; gap:4px; margin-bottom:10px;';
                
                const label = document.createElement('label');
                label.style = 'font-size:11px; font-weight:600; color:#5e6f8a;';
                label.textContent = type;
                field.appendChild(label);

                const inputRow = document.createElement('div');
                inputRow.style = 'display:flex; gap:10px;';

                const numInput = document.createElement('input');
                numInput.type = 'number';
                numInput.className = 'student-fee-input';
                numInput.dataset.categoryId = String(cat.id);
                numInput.value = String(amount);
                numInput.placeholder = 'Amount (₹)';
                numInput.style = 'flex: 2; padding:10px 14px; border:1px solid #d7dfe9; border-radius:10px; font-size:14px;';
                numInput.min = '0';
                numInput.step = 'any';
                inputRow.appendChild(numInput);

                const remInput = document.createElement('input');
                remInput.type = 'text';
                remInput.className = 'student-fee-remarks';
                remInput.dataset.categoryId = String(cat.id);
                remInput.value = remarks;
                remInput.placeholder = 'Remarks (e.g. Scholarship)';
                remInput.style = 'flex: 3; padding:10px 14px; border:1px solid #d7dfe9; border-radius:10px; font-size:14px;';
                inputRow.appendChild(remInput);

                field.appendChild(inputRow);
                fieldsContainer.appendChild(field);
            });
            
            document.getElementById('editStudentFeesModal').style.display = 'flex';
        };
        
        window.hideEditStudentFeesModal = function() {
            document.getElementById('editStudentFeesModal').style.display = 'none';
        };

        window.saveStudentFees = async function() {
            const admissionNo = document.getElementById('editStudentFeesAdmissionNo').value;
            const year = document.getElementById('editStudentFeesAcademicYear').value;
            if (!admissionNo || !year) return;
            
            const inputs = document.querySelectorAll('#editStudentFeesFields .student-fee-input');
            const newAssignments = [];
            
            for (let input of inputs) {
                const categoryId = parseInt(input.dataset.categoryId);
                const amount = parseFloat(input.value) || 0;
                const remarksInput = document.querySelector(`#editStudentFeesFields .student-fee-remarks[data-category-id="${categoryId}"]`);
                const remarksVal = remarksInput ? remarksInput.value.trim() : '';
                
                newAssignments.push({
                    student_id: admissionNo,
                    academic_year: year,
                    fee_category_id: categoryId,
                    assigned_amount: amount,
                    remarks: remarksVal
                });
            }
            
            studentFeeAssignments = studentFeeAssignments.filter(a => !(a.student_id === admissionNo && a.academic_year === year));
            for (let assign of newAssignments) {
                studentFeeAssignments.push(assign);
            }
            saveData();
            
            if (newAssignments.length > 0) {
                if (navigator.onLine && supabaseClient) {
                    try {
                        await supabaseClient
                            .from('student_fee_assignments')
                            .upsert(newAssignments, { onConflict: 'student_id,academic_year,fee_category_id' });
                    } catch (e) {
                        console.error("Failed to upsert assignments to Supabase:", e);
                    }
                }
            }
            showToast("✅ Student fee assignments updated.", "success");
            hideEditStudentFeesModal();
            renderStudentFeeAssignments();
            renderFeesOverview();
            renderFeesStatus();
        };

        window.showBulkFeeAssignment = function() {
            populateBulkAssignFilters();
            document.getElementById('bulkFeeAssignmentModal').style.display = 'flex';
        };
        
        window.hideBulkFeeAssignmentModal = function() {
            document.getElementById('bulkFeeAssignmentModal').style.display = 'none';
        };
        
        function populateBulkAssignFilters() {
            const yearEl = document.getElementById('bulkAssignAcademicYear');
            const classEl = document.getElementById('bulkAssignClass');
            const catEl = document.getElementById('bulkAssignCategory');
            
            const years = new Set([getCurrentAcademicYear()]);
            studentFeeAssignments.forEach(a => years.add(a.academic_year));
            feePayments.forEach(p => years.add(p.academic_year));
            yearEl.innerHTML = Array.from(years).sort().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
            
            const classes = getClassesList();
            classEl.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
            
            const activeFeeTypes = getActiveFeeTypes();
            const parent = getFeesParentCategory();
            catEl.innerHTML = activeFeeTypes.map(type => {
                const cat = categories.find(c => c.name.toLowerCase() === type.toLowerCase() && c.parent_id === parent.id);
                return cat ? `<option value="${cat.id}">${type}</option>` : '';
            }).join('');
        }

        window.executeBulkFeeAssignment = async function() {
            const year = document.getElementById('bulkAssignAcademicYear').value;
            const cls = document.getElementById('bulkAssignClass').value;
            const categoryId = parseInt(document.getElementById('bulkAssignCategory').value);
            const amount = parseFloat(document.getElementById('bulkAssignAmount').value);
            const overwrite = document.getElementById('bulkAssignOverwrite').checked;
            
            if (!year || !cls || isNaN(categoryId) || isNaN(amount) || amount < 0) {
                showToast("Please fill all fields with valid values.", "warning");
                return;
            }
            
            const targetStudents = students.filter(s => s.class === cls);
            if (targetStudents.length === 0) {
                showToast(`No students found in Class ${cls}.`, "warning");
                return;
            }
            
            const actionText = overwrite ? "assign and overwrite existing" : "assign (skipping students with existing assignments)";
            if (!confirm(`Apply fee ₹${amount} to all eligible students of Class ${cls}? This will ${actionText}.`)) {
                return;
            }
            
            let count = 0;
            const assignmentsToUpsert = [];

            for (let student of targetStudents) {
                const existingIdx = studentFeeAssignments.findIndex(a => a.student_id === student.admissionNumber && a.academic_year === year && a.fee_category_id === categoryId);
                
                if (existingIdx !== -1) {
                    if (!overwrite) {
                        continue;
                    } else {
                        const existing = studentFeeAssignments[existingIdx];
                        const assign = {
                            student_id: student.admissionNumber,
                            academic_year: year,
                            fee_category_id: categoryId,
                            assigned_amount: amount,
                            remarks: existing.remarks || ''
                        };
                        if (existing.id) assign.id = existing.id;
                        studentFeeAssignments[existingIdx] = assign;
                        assignmentsToUpsert.push(assign);
                        count++;
                    }
                } else {
                    const assign = {
                        student_id: student.admissionNumber,
                        academic_year: year,
                        fee_category_id: categoryId,
                        assigned_amount: amount,
                        remarks: ''
                    };
                    studentFeeAssignments.push(assign);
                    assignmentsToUpsert.push(assign);
                    count++;
                }
            }
            
            saveData();

            if (assignmentsToUpsert.length > 0) {
                if (navigator.onLine && supabaseClient) {
                    const BATCH_SIZE = 50;
                    for (let i = 0; i < assignmentsToUpsert.length; i += BATCH_SIZE) {
                        const chunk = assignmentsToUpsert.slice(i, i + BATCH_SIZE);
                        try {
                            await supabaseClient
                                .from('student_fee_assignments')
                                .upsert(chunk, { onConflict: 'student_id,academic_year,fee_category_id' });
                        } catch (e) {
                            console.error("Failed to batch upsert assignments to Supabase:", e);
                        }
                    }
                }
            }
            
            showToast(`✅ Successfully bulk-assigned fee to ${count} students in Class ${cls}.`, "success");
            hideBulkFeeAssignmentModal();
            renderStudentFeeAssignments();
            renderFeesOverview();
            renderFeesStatus();
        };

        async function pushStudentFeeAssignment(assign) {
            if (!supabaseClient || !supaConfig || !navigator.onLine) {
                return;
            }
            try {
                const dbData = {
                    student_id: assign.student_id,
                    academic_year: assign.academic_year,
                    fee_category_id: assign.fee_category_id,
                    assigned_amount: parseFloat(assign.assigned_amount) || 0,
                    remarks: assign.remarks || ''
                };
                if (assign.id) {
                    dbData.id = assign.id;
                }
                const { data, error } = await supabaseClient
                    .from('student_fee_assignments')
                    .upsert(dbData, { onConflict: 'student_id,academic_year,fee_category_id' })
                    .select();
                if (error) throw error;
                if (data && data[0] && !assign.id) {
                    assign.id = data[0].id;
                    localStorage.setItem(STUDENT_FEE_ASSIGNMENTS_KEY, JSON.stringify(studentFeeAssignments));
                }
            } catch (e) {
                console.warn("Direct fee assignment push failed, queueing instead:", e);
            }
        }

        window.showCsvPreview = function(parsedData, feeColumns) {
            window.tempParsedData = parsedData;
            window.tempFeeColumns = feeColumns.filter(c => !c.isRemarks);
            window.tempAllFeeColumns = feeColumns;
            
            const previewYearSelect = document.getElementById('previewAcademicYearSelect');
            const years = new Set([getCurrentAcademicYear()]);
            studentFeeAssignments.forEach(a => years.add(a.academic_year));
            feePayments.forEach(p => years.add(p.academic_year));
            previewYearSelect.innerHTML = Array.from(years).sort().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
            previewYearSelect.value = getCurrentAcademicYear();
            
            const theadTr = document.getElementById('csvPreviewTableHeader');
            theadTr.innerHTML = `
                <th>Admission No</th>
                <th>Student</th>
                ${window.tempFeeColumns.map(col => `<th>${escapeHtml(col.cleanName)}</th>`).join('')}
                <th style="width: 80px; text-align: center;">Import?</th>
            `;
            
            const tbody = document.getElementById('csvPreviewTableBody');
            tbody.innerHTML = '';
            
            parsedData.forEach((item, index) => {
                const tr = document.createElement('tr');
                
                const feeCellsHtml = window.tempFeeColumns.map(col => {
                    const amt = item.fees[col.cleanName] || 0;
                    const remarksText = item.remarks[col.cleanName] || '';
                    const remarksAttr = remarksText ? ` title="${escapeHtml(remarksText)}"` : '';
                    const remarksIndicator = remarksText ? ` <span style="font-size: 10px; color: #5e6f8a; cursor: help;" title="${escapeHtml(remarksText)}">📝</span>` : '';
                    return `<td><span${remarksAttr}>₹${amt.toFixed(0)}${remarksIndicator}</span></td>`;
                }).join('');
                
                tr.innerHTML = `
                    <td><b>${escapeHtml(item.student.admissionNumber)}</b></td>
                    <td>
                        <div style="font-weight: 600; color: #0b2a4a;">${escapeHtml(item.student.name)}</div>
                        <div style="font-size: 11px; color: #5e6f8a;">Class ${escapeHtml(item.student.class)}-${escapeHtml(item.student.section || 'N/A')}</div>
                    </td>
                    ${feeCellsHtml}
                    <td style="text-align: center;">
                        <input type="checkbox" class="csv-row-import-checkbox" checked style="cursor: pointer; transform: scale(1.1);" />
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            document.getElementById('csvPreviewCount').innerHTML = `Ready to import <b>${parsedData.length}</b> student records.`;
            document.getElementById('csvPreviewModal').style.display = 'flex';
        };

        window.hideCsvPreviewModal = function() {
            document.getElementById('csvPreviewModal').style.display = 'none';
        };

        window.confirmImportCSV = async function() {
            const academicYear = document.getElementById('previewAcademicYearSelect').value;
            const parent = getFeesParentCategory();
            if (!parent) {
                showToast("Parent category 'Fees' not found.", "error");
                return;
            }
            
            const feeTypesList = window.tempFeeColumns;
            const categoryMap = {};
            
            for (let col of feeTypesList) {
                let cat = categories.find(c => c.name.toLowerCase() === col.cleanName.toLowerCase() && c.parent_id === parent.id);
                if (!cat) {
                    const newId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
                    cat = {
                        id: newId,
                        name: col.cleanName,
                        parent_id: parent.id,
                        type: 'all',
                        frequency: (col.cleanName.toLowerCase() === 'tuition' || col.cleanName.toLowerCase() === 'transport' || col.cleanName.toLowerCase() === 'hostel') ? 'Monthly' : 'Yearly'
                    };
                    categories.push(cat);
                    saveCategories();
                    
                    if (navigator.onLine && supabaseClient) {
                        try {
                            await supabaseClient.from('categories').insert(cat);
                        } catch (e) {
                            console.error("Failed to sync new category to Supabase:", e);
                        }
                    }
                }
                categoryMap[col.cleanName] = cat.id;
            }
            
            let studentsImported = 0;
            const checkboxes = document.querySelectorAll('.csv-row-import-checkbox');
            const studentsToUpsert = [];
            const assignmentsToUpsert = [];
            
            for (let i = 0; i < window.tempParsedData.length; i++) {
                const cb = checkboxes[i];
                if (cb && !cb.checked) continue;
                
                const item = window.tempParsedData[i];
                const newStud = item.student;
                
                const existingIdx = students.findIndex(s => s.admissionNumber === newStud.admissionNumber);
                if (existingIdx !== -1) {
                    students[existingIdx] = newStud;
                } else {
                    students.push(newStud);
                }
                studentsToUpsert.push(newStud);
                
                studentFeeAssignments = studentFeeAssignments.filter(a => !(a.student_id === newStud.admissionNumber && a.academic_year === academicYear));
                
                for (let col of feeTypesList) {
                    const amount = item.fees[col.cleanName] || 0;
                    const remarksVal = item.remarks[col.cleanName] || '';
                    const categoryId = categoryMap[col.cleanName];
                    if (categoryId === undefined) continue;
                    
                    const assign = {
                        student_id: newStud.admissionNumber,
                        academic_year: academicYear,
                        fee_category_id: categoryId,
                        assigned_amount: amount,
                        remarks: remarksVal
                    };
                    
                    studentFeeAssignments.push(assign);
                    assignmentsToUpsert.push(assign);
                }
                
                studentsImported++;
            }
            
            saveStudents();
            saveData();

            // Batch upsert students in chunks of 50
            if (studentsToUpsert.length > 0) {
                if (navigator.onLine && supabaseClient) {
                    const BATCH_SIZE = 50;
                    for (let i = 0; i < studentsToUpsert.length; i += BATCH_SIZE) {
                        const chunk = studentsToUpsert.slice(i, i + BATCH_SIZE);
                        try {
                            const cleanChunk = chunk.map(s => ({
                                admission_number: s.admissionNumber,
                                name: s.name,
                                roll_number: s.rollNumber || '',
                                class: s.class || '',
                                section: s.section || '',
                                father_name: s.fatherName || '',
                                phone: s.phone || '',
                                updated_at: new Date().toISOString()
                            }));
                            await supabaseClient.from('students').upsert(cleanChunk, { onConflict: 'admission_number' });
                        } catch (e) {
                            console.error("Failed to batch upsert students during import:", e);
                        }
                    }
                }
            }

            // Batch upsert fee assignments in chunks of 50
            if (assignmentsToUpsert.length > 0) {
                if (navigator.onLine && supabaseClient) {
                    const BATCH_SIZE = 50;
                    for (let i = 0; i < assignmentsToUpsert.length; i += BATCH_SIZE) {
                        const chunk = assignmentsToUpsert.slice(i, i + BATCH_SIZE);
                        try {
                            await supabaseClient
                                .from('student_fee_assignments')
                                .upsert(chunk, { onConflict: 'student_id,academic_year,fee_category_id' });
                        } catch (e) {
                            console.error("Failed to batch upsert assignments during import:", e);
                        }
                    }
                }
            }
            
            const now = new Date();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const day = String(now.getDate()).padStart(2, '0');
            const month = months[now.getMonth()];
            const year = now.getFullYear();
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            studentsLastImported = `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
            localStorage.setItem(LAST_IMPORTED_KEY, studentsLastImported);
            
            updateStudentCountDisplay();
            
            if (typeof renderStudentDirectory === 'function') {
                populateStudentFilters();
                renderStudentDirectory();
            }
            
            showToast(`✅ Successfully imported ${studentsImported} students and fee assignments.`, 'success');
            hideCsvPreviewModal();
        };



        window.populateReportsCategoryFilter = function() {
            const select = document.getElementById('reportsCategory');
            if (!select) return;
            const currentVal = select.value;
            const activeCategories = getActiveFeeTypes();
            
            select.innerHTML = '<option value="">All Fee Categories</option>' + 
                activeCategories.map(name => `<option value="${name}">${name}</option>`).join('');
                
            if (currentVal && activeCategories.includes(currentVal)) {
                select.value = currentVal;
            } else {
                select.value = "";
            }
        };

        window.renderFeesReports = function() {
            populateFeesAcademicYears();
            
            const classSelect = document.getElementById('reportsClass');
            const classes = getClassesList();
            const curClass = classSelect.value;
            classSelect.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c}">${c}</option>`).join('');
            if (classes.includes(curClass)) {
                classSelect.value = curClass;
            }
            
            populateReportsSectionFilter();
            
            const rType = document.getElementById('reportsSelectType').value;
            const year = document.getElementById('reportsAcademicYear').value;
            const cls = document.getElementById('reportsClass').value;
            const sec = document.getElementById('reportsSection').value;
            const catFilter = document.getElementById('reportsCategory') ? document.getElementById('reportsCategory').value : '';
            
            const header = document.getElementById('feesReportsHeader');
            const tbody = document.getElementById('feesReportsBody');
            header.innerHTML = '';
            tbody.innerHTML = '';
            
            if (rType === 'monthly-aggregate' || rType === 'type-aggregate') {
                document.getElementById('reportsClassField').style.display = 'none';
                document.getElementById('reportsSectionField').style.display = 'none';
            } else {
                document.getElementById('reportsClassField').style.display = 'block';
                document.getElementById('reportsSectionField').style.display = 'block';
            }
            
            if (rType === 'defaulters') {
                const structHeaderName = catFilter ? `${catFilter} Fee` : 'Structured Dues';
                header.innerHTML = `
                    <tr>
                        <th>Admission No</th>
                        <th>Student Name</th>
                        <th>Class &amp; Section</th>
                        <th>${structHeaderName} (₹)</th>
                        <th>Paid (₹)</th>
                        <th>Pending Fees (₹)</th>
                    </tr>
                `;
                
                let count = 0;
                students.forEach(student => {
                    if (cls && student.class !== cls) return;
                    if (sec && student.section !== sec) return;
                    
                    const dues = getStudentFeeDues(student, year);
                    let targetDues = dues;
                    if (catFilter) {
                        targetDues = dues.filter(d => d.fee_type.toLowerCase() === catFilter.toLowerCase());
                    }
                    const totalDue = targetDues.reduce((sum, d) => sum + d.structured_amount, 0);
                    const totalPaid = targetDues.reduce((sum, d) => sum + d.paid_amount, 0);
                    const outstanding = targetDues.reduce((sum, d) => sum + d.due_amount, 0);
                    
                    if (outstanding > 0) {
                        count++;
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td><b>${escapeHtml(student.admissionNumber)}</b></td>
                            <td><a href="#" class="student-ledger-link" style="font-weight:700; color:#0b2a4a; text-decoration:none;">${escapeHtml(student.name)}</a></td>
                            <td>Class ${escapeHtml(student.class)} - ${escapeHtml(student.section || 'N/A')}</td>
                            <td>₹${totalDue.toFixed(2)}</td>
                            <td>₹${totalPaid.toFixed(2)}</td>
                            <td style="color:#b13e3e; font-weight:700;">₹${outstanding.toFixed(2)}</td>
                        `;
                        const ledgerLink = tr.querySelector('.student-ledger-link');
                        if (ledgerLink) {
                            ledgerLink.addEventListener('click', (e) => {
                                e.preventDefault();
                                showFeeLedger(student.admissionNumber);
                            });
                        }
                        tbody.appendChild(tr);
                    }
                });
                
                if (count === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">No defaulters found.</td></tr>`;
                }
            } else if (rType === 'class-aggregate') {
                const structHeaderName = catFilter ? `${escapeHtml(catFilter)} Fee` : 'Total Structured';
                header.innerHTML = `
                    <tr>
                        <th>Class &amp; Section</th>
                        <th>Total Students</th>
                        <th>${structHeaderName} (₹)</th>
                        <th>Collected Amount (₹)</th>
                        <th>Pending Fees (₹)</th>
                        <th>Collection %</th>
                    </tr>
                `;
                
                const groups = {};
                students.forEach(student => {
                    const combo = `${student.class}-${student.section || 'General'}`;
                    if (!groups[combo]) groups[combo] = [];
                    groups[combo].push(student);
                });
                
                const combos = Object.keys(groups).sort();
                let count = 0;
                
                combos.forEach(combo => {
                    const list = groups[combo];
                    const clsVal = list[0].class;
                    if (cls && clsVal !== cls) return;
                    
                    count++;
                    let sumDue = 0;
                    let sumPaid = 0;
                    let sumOut = 0;
                    
                    list.forEach(student => {
                        const dues = getStudentFeeDues(student, year);
                        let targetDues = dues;
                        if (catFilter) {
                            targetDues = dues.filter(d => d.fee_type.toLowerCase() === catFilter.toLowerCase());
                        }
                        sumDue += targetDues.reduce((sum, d) => sum + d.structured_amount, 0);
                        sumPaid += targetDues.reduce((sum, d) => sum + d.paid_amount, 0);
                        sumOut += targetDues.reduce((sum, d) => sum + d.due_amount, 0);
                    });
                    
                    const pct = sumDue > 0 ? (sumPaid / sumDue) * 100 : 100;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><b>Class ${escapeHtml(combo)}</b></td>
                        <td>${list.length}</td>
                        <td>₹${sumDue.toFixed(2)}</td>
                        <td style="color:#0f7b3a; font-weight:600;">₹${sumPaid.toFixed(2)}</td>
                        <td style="color:${sumOut > 0 ? '#b13e3e' : 'inherit'};">₹${sumOut.toFixed(2)}</td>
                        <td><b>${pct.toFixed(1)}%</b></td>
                    `;
                    tbody.appendChild(tr);
                });
                
                if (count === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">No class aggregate reports generated.</td></tr>`;
                }
            } else if (rType === 'type-aggregate') {
                header.innerHTML = `
                    <tr>
                        <th>Fee Type (Sub-category)</th>
                        <th>Collected Amount (₹)</th>
                        <th>Transaction Count</th>
                    </tr>
                `;
                
                const activeTypes = catFilter ? [catFilter] : getActiveFeeTypes();
                const typeAmounts = {};
                const typeCounts = {};
                activeTypes.forEach(t => {
                    typeAmounts[t] = 0;
                    typeCounts[t] = 0;
                });
                
                transactions.forEach(t => {
                    if (t.type === 'income' && t.mainCategory === 'Fees' && !t.isDeleted && t.subCategory) {
                        const matchType = activeTypes.find(at => at.toLowerCase() === t.subCategory.toLowerCase());
                        if (matchType) {
                            typeAmounts[matchType] += t.amount;
                            typeCounts[matchType]++;
                        }
                    }
                });
                
                activeTypes.forEach(t => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><b>${escapeHtml(t)}</b></td>
                        <td style="color:#0f7b3a; font-weight:700;">₹${typeAmounts[t].toFixed(2)}</td>
                        <td>${typeCounts[t]} collections</td>
                    `;
                    tbody.appendChild(tr);
                });
            } else if (rType === 'monthly-aggregate') {
                header.innerHTML = `
                    <tr>
                        <th>Month</th>
                        <th>Collected Amount (₹)</th>
                        <th>Transaction Count</th>
                    </tr>
                `;
                
                const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
                const monthAmounts = {};
                const monthCounts = {};
                months.forEach(m => {
                    monthAmounts[m] = 0;
                    monthCounts[m] = 0;
                });
                
                transactions.forEach(t => {
                    if (t.type === 'income' && t.mainCategory === 'Fees' && !t.isDeleted && t.feeMonth) {
                        if (catFilter && (!t.subCategory || t.subCategory.toLowerCase() !== catFilter.toLowerCase())) return;
                        if (monthAmounts[t.feeMonth] !== undefined) {
                            monthAmounts[t.feeMonth] += t.amount;
                            monthCounts[t.feeMonth]++;
                        }
                    }
                });
                
                months.forEach(m => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><b>${escapeHtml(m)}</b></td>
                        <td style="color:#0f7b3a; font-weight:700;">₹${monthAmounts[m].toFixed(2)}</td>
                        <td>${monthCounts[m]} collections</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        };

        window.populateReportsSectionFilter = function() {
            const classSelect = document.getElementById('reportsClass');
            const sectionSelect = document.getElementById('reportsSection');
            if (!classSelect || !sectionSelect) return;
            const cls = classSelect.value;
            const curSec = sectionSelect.value;
            const sections = getSectionsList(cls);
            
            sectionSelect.innerHTML = '<option value="">All Sections</option>' + sections.map(s => `<option value="${s}">${s}</option>`).join('');
            if (sections.includes(curSec)) {
                sectionSelect.value = curSec;
            }
        };

        window.exportFeesReportCSV = function() {
            const rType = document.getElementById('reportsSelectType').value;
            const year = document.getElementById('reportsAcademicYear').value;
            
            const rows = [['School ERP Fee Report - ' + rType.toUpperCase(), 'Academic Year: ' + year]];
            
            const tableHeaders = document.querySelectorAll('#feesReportsTable thead th');
            const headers = Array.from(tableHeaders).map(th => th.textContent.trim());
            rows.push(headers);
            
            const tableRows = document.querySelectorAll('#feesReportsTable tbody tr');
            tableRows.forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
                if (cells.length > 0) rows.push(cells);
            });
            
            const csvContent = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fee_report_${rType}_${year}.csv`;
            a.click();
        };

        window.printFeesReport = function() {
            const rType = document.getElementById('reportsSelectType').value;
            const year = document.getElementById('reportsAcademicYear').value;
            const reportHTML = document.getElementById('feesReportsTable').outerHTML;
            
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>Print Report - Fee Management</title>
                    <style>
                        body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 30px; color: #1a2634; }
                        h2 { color: #0b2a4a; margin-bottom: 5px; }
                        p { margin: 0 0 20px 0; color: #5e6f8a; font-size: 14px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { border: 1px solid #d7dfe9; padding: 10px 12px; text-align: left; font-size: 13px; }
                        th { background: #f0f4fa; color: #0b2a4a; font-weight: bold; }
                        tr:nth-child(even) { background: #fafbfc; }
                        b { color: #0b2a4a; }
                    </style>
                </head>
                <body onload="window.print()">
                    <h2>School Accountant ERP – Fee Management Report</h2>
                    <p>Report Type: <b>${rType.toUpperCase()}</b> | Academic Year: <b>${year}</b> | Generated: ${new Date().toLocaleString()}</p>
                    ${reportHTML}
                </body>
                </html>
            `);
            printWindow.document.close();
        };

        window.renderFeesTypes = function() {
            const container = document.getElementById('feeTypesListContainer');
            if (!container) return;
            container.innerHTML = '';
            
            const activeTypes = getActiveFeeTypes();
            
            activeTypes.forEach(type => {
                const badge = document.createElement('div');
                badge.style = 'background:#f0f4fa; border:1px solid #d7dfe9; border-radius:20px; padding:6px 14px; font-size:13px; font-weight:600; color:#0b2a4a; display:flex; align-items:center; gap:8px;';
                
                const span = document.createElement('span');
                span.textContent = type;
                badge.appendChild(span);

                const removeBtn = document.createElement('a');
                removeBtn.href = '#';
                removeBtn.style = 'color:#b13e3e; text-decoration:none; font-weight:bold; font-size:12px;';
                removeBtn.title = 'Remove Fee Type';
                removeBtn.textContent = '✕';
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    deleteFeeType(type);
                });
                badge.appendChild(removeBtn);

                container.appendChild(badge);
            });
        };

        window.addFeeType = async function() {
            const input = document.getElementById('newFeeTypeName');
            const name = input.value.trim();
            if (!name) {
                showToast("Please enter a fee type name.", "warning");
                return;
            }
            const parent = getFeesParentCategory();
            if (!parent) {
                showToast("Parent 'Fees' category not found.", "error");
                return;
            }
            
            const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.parent_id === parent.id);
            if (existing) {
                showToast("Fee type already exists.", "warning");
                return;
            }
            
            const newId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
            const newCat = {
                id: newId,
                name: name,
                parent_id: parent.id,
                type: 'all'
            };
            
            categories.push(newCat);
            saveCategories();
            
            if (navigator.onLine && supabaseClient) {
                try {
                    await supabaseClient.from('categories').insert(newCat);
                } catch (e) {
                    console.error("Failed to sync category to Supabase:", e);
                }
            }
            
            input.value = '';
            showToast(`✅ Fee type '${name}' added successfully.`, "success");
            renderFeesTypes();
        };

        window.deleteFeeType = async function(name) {
            if (!confirm(`⚠️ Are you sure you want to delete fee type '${name}'? This won't delete historical transactions but they will no longer match this fee structure.`)) return;
            const parent = getFeesParentCategory();
            if (!parent) return;
            
            const cat = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.parent_id === parent.id);
            if (!cat) return;
            
            categories = categories.filter(c => c.id !== cat.id);
            saveCategories();
            
            if (navigator.onLine && supabaseClient) {
                try {
                    await supabaseClient.from('categories').delete().eq('id', cat.id);
                } catch (e) {
                    console.error("Failed to delete category from Supabase:", e);
                }
            }
            
            showToast(`🗑️ Fee type '${name}' removed.`, "info");
            renderFeesTypes();
        };

        window.showFeeLedger = function(admissionNo) {
            const student = students.find(s => s.admissionNumber === admissionNo);
            if (!student) {
                showToast("Student not found.", "error");
                return;
            }
            
            document.getElementById('ledgerStudentName').textContent = student.name;
            document.getElementById('ledgerAdmissionNo').textContent = student.admissionNumber;
            document.getElementById('ledgerRollNo').textContent = student.rollNumber || 'N/A';
            document.getElementById('ledgerClassSec').textContent = `${student.class} - ${student.section}`;
            document.getElementById('ledgerFatherName').textContent = student.fatherName || 'N/A';
            document.getElementById('ledgerPhone').textContent = student.phone || 'N/A';
            
            const year = document.getElementById('feesStatusAcademicYear').value || getCurrentAcademicYear();
            const dues = getStudentFeeDues(student, year);
            const totalOutstanding = dues.reduce((sum, d) => sum + d.due_amount, 0);
            
            document.getElementById('ledgerOutstandingAmount').textContent = `₹${totalOutstanding.toFixed(2)}`;
            
            const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
            const matrixHeader = document.querySelector('#ledgerMatrixTable thead');
            const matrixBody = document.querySelector('#ledgerMatrixTable tbody');
            
            matrixHeader.innerHTML = '';
            const headerTr = document.createElement('tr');
            
            const typeTh = document.createElement('th');
            typeTh.style.textAlign = 'left';
            typeTh.textContent = 'Fee Type';
            headerTr.appendChild(typeTh);
            
            months.forEach(m => {
                const th = document.createElement('th');
                th.textContent = m.substring(0,3);
                headerTr.appendChild(th);
            });
            
            const totalTh = document.createElement('th');
            totalTh.textContent = 'Pending Fees';
            headerTr.appendChild(totalTh);
            
            matrixHeader.appendChild(headerTr);
            
            matrixBody.innerHTML = '';
            
            const feeTypes = Array.from(new Set(dues.map(d => d.fee_type)));
            
            if (feeTypes.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 14;
                td.className = 'text-center text-muted';
                td.style.padding = '15px';
                td.textContent = `No fee structures defined for Class ${student.class}.`;
                tr.appendChild(td);
                matrixBody.appendChild(tr);
            } else {
                feeTypes.forEach(type => {
                    const rowDues = dues.filter(d => d.fee_type === type);
                    let rowOutstanding = 0;
                    
                    const tr = document.createElement('tr');
                    
                    const nameTd = document.createElement('td');
                    nameTd.style.textAlign = 'left';
                    nameTd.style.fontWeight = '600';
                    nameTd.textContent = type;
                    tr.appendChild(nameTd);
                    
                    months.forEach(m => {
                        const td = document.createElement('td');
                        const item = rowDues.find(d => d.month === m);
                        if (!item) {
                            const span = document.createElement('span');
                            span.className = 'text-muted';
                            span.textContent = '–';
                            td.appendChild(span);
                        } else {
                            rowOutstanding += item.due_amount;
                            const span = document.createElement('span');
                            if (item.due_amount === 0) {
                                span.className = 'badge-status paid';
                                span.title = `Paid ₹${item.paid_amount}`;
                                span.textContent = 'P';
                            } else if (item.paid_amount === 0) {
                                span.className = 'badge-status pending';
                                span.title = `Pending ₹${item.due_amount} due`;
                                span.textContent = 'D';
                            } else {
                                span.className = 'badge-status partial';
                                span.title = `Paid ₹${item.paid_amount} of ₹${item.structured_amount}`;
                                span.textContent = 'PP';
                            }
                            td.appendChild(span);
                        }
                        tr.appendChild(td);
                    });
                    
                    const outTd = document.createElement('td');
                    outTd.style.fontWeight = '700';
                    if (rowOutstanding > 0) {
                        outTd.style.color = '#b13e3e';
                    }
                    outTd.textContent = `₹${rowOutstanding.toFixed(0)}`;
                    tr.appendChild(outTd);
                    
                    matrixBody.appendChild(tr);
                });
            }
            
            const paymentsBody = document.getElementById('ledgerPaymentsTableBody');
            paymentsBody.innerHTML = '';
            
            const studPayments = feePayments.filter(fp => fp.student_admission_number === student.admissionNumber && fp.academic_year === year);
            const ledgerTxs = transactions.filter(t => studPayments.some(sp => sp.transaction_id === t.id) && !t.isDeleted);
            
            ledgerTxs.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            if (ledgerTxs.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 6;
                td.className = 'text-center text-muted';
                td.style.padding = '20px';
                td.textContent = 'No historical payment transactions found.';
                tr.appendChild(td);
                paymentsBody.appendChild(tr);
            } else {
                ledgerTxs.forEach(t => {
                    const tr = document.createElement('tr');
                    
                    const refTd = document.createElement('td');
                    refTd.textContent = t.reference || 'Receipt';
                    tr.appendChild(refTd);
                    
                    const dateTd = document.createElement('td');
                    dateTd.textContent = t.date;
                    tr.appendChild(dateTd);
                    
                    const typeTd = document.createElement('td');
                    const typeSpan = document.createElement('span');
                    typeSpan.style.fontWeight = '600';
                    typeSpan.textContent = t.subCategory;
                    typeTd.appendChild(typeSpan);
                    tr.appendChild(typeTd);
                    
                    const partTd = document.createElement('td');
                    partTd.textContent = t.particulars;
                    tr.appendChild(partTd);
                    
                    const amtTd = document.createElement('td');
                    amtTd.style.fontWeight = '700';
                    amtTd.style.color = '#0f7b3a';
                    amtTd.textContent = `₹${t.amount.toFixed(2)}`;
                    tr.appendChild(amtTd);
                    
                    const actTd = document.createElement('td');
                    
                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn btn-outline btn-xs';
                    editBtn.style.padding = '2px 8px';
                    editBtn.style.fontSize = '11px';
                    editBtn.style.marginRight = '4px';
                    editBtn.textContent = 'Edit';
                    editBtn.onclick = function() {
                        hideFeeLedger();
                        showEditTxModal(t.id);
                    };
                    actTd.appendChild(editBtn);
                    
                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-outline btn-xs';
                    delBtn.style.padding = '2px 8px';
                    delBtn.style.fontSize = '11px';
                    delBtn.style.color = '#b13e3e';
                    delBtn.style.borderColor = '#f8dddd';
                    delBtn.textContent = 'Delete';
                    delBtn.onclick = function() {
                        if (confirm('Delete transaction?')) {
                            hideFeeLedger();
                            deleteTransaction(t.id);
                            renderFeesStatus();
                        }
                    };
                    actTd.appendChild(delBtn);

                    // Add Print Receipt button for fee transactions
                    const printBtn = document.createElement('button');
                    printBtn.className = 'btn btn-outline btn-xs';
                    printBtn.style.padding = '2px 8px';
                    printBtn.style.fontSize = '11px';
                    printBtn.style.color = '#4A1510';
                    printBtn.style.borderColor = '#4A1510';
                    printBtn.style.marginLeft = '4px';
                    printBtn.textContent = '🖨️ Print Receipt';
                    printBtn.onclick = function() {
                        printReceiptForTransaction(t.id);
                    };
                    actTd.appendChild(printBtn);
                    
                    tr.appendChild(actTd);
                    
                    paymentsBody.appendChild(tr);
                });
            }
            
            document.getElementById('feeLedgerModal').style.display = 'flex';
        };

        window.hideFeeLedger = function() {
            document.getElementById('feeLedgerModal').style.display = 'none';
        };

        // ════════════════════════════════════════════════════════════════
        //  FEE RECEIPT GENERATION & PRINTING
        // ════════════════════════════════════════════════════════════════

        /**
         * Convert a number to Indian-English words for Rupees.
         * e.g. 25000 → "Twenty Five Thousand Rupees Only"
         * e.g. 25000.50 → "Twenty Five Thousand Rupees and Fifty Paise Only"
         */
        function numberToWords(num) {
            if (num === 0) return 'Zero Rupees Only';

            const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
                'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

            function twoDigits(n) {
                if (n < 20) return ones[n];
                return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
            }

            function threeDigits(n) {
                if (n >= 100) {
                    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + twoDigits(n % 100) : '');
                }
                return twoDigits(n);
            }

            // Indian numbering: Crore, Lakh, Thousand, Hundred
            function indianWords(n) {
                if (n === 0) return '';
                let result = '';

                if (n >= 10000000) {
                    result += threeDigits(Math.floor(n / 10000000)) + ' Crore ';
                    n %= 10000000;
                }
                if (n >= 100000) {
                    result += twoDigits(Math.floor(n / 100000)) + ' Lakh ';
                    n %= 100000;
                }
                if (n >= 1000) {
                    result += twoDigits(Math.floor(n / 1000)) + ' Thousand ';
                    n %= 1000;
                }
                if (n > 0) {
                    result += threeDigits(n);
                }
                return result.trim();
            }

            const rupees = Math.floor(Math.abs(num));
            const paiseRaw = Math.round((Math.abs(num) - rupees) * 100);

            let words = '';
            if (rupees > 0) {
                words += indianWords(rupees) + ' Rupees';
            }
            if (paiseRaw > 0) {
                words += (rupees > 0 ? ' and ' : '') + indianWords(paiseRaw) + ' Paise';
            }
            if (!words) words = 'Zero Rupees';
            words += ' Only';
            return words;
        }

        /**
         * Get the fee type label for the receipt based on subcategory.
         */
        function getFeeTypeLabel(subCategory) {
            if (!subCategory) return 'FEE';
            return subCategory.toUpperCase() + ' FEE';
        }

        /**
         * Build the school crest SVG (simplified recreation of the Delhi Secondary School logo).
         */
        function getSchoolCrestSVG() {
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="80" height="80">
                <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" stroke-width="4"/>
                <circle cx="100" cy="100" r="85" fill="none" stroke="currentColor" stroke-width="2"/>
                <!-- Outer ring text -->
                <defs>
                    <path id="topArc" d="M 30,100 A 70,70 0 0,1 170,100"/>
                    <path id="bottomArc" d="M 170,115 A 70,70 0 0,1 30,115"/>
                </defs>
                <text font-size="13" fill="currentColor" font-weight="700" font-family="system-ui, -apple-system, sans-serif" letter-spacing="3">
                    <textPath href="#topArc" startOffset="50%" text-anchor="middle">DELHI SECONDARY SCHOOL</textPath>
                </text>
                <text font-size="10" fill="currentColor" font-weight="600" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">
                    <textPath href="#bottomArc" startOffset="50%" text-anchor="middle">KNOWLEDGE IS POWER</textPath>
                </text>
                <!-- Shield / Book emblem in center -->
                <g transform="translate(100,95)">
                    <!-- Shield outline -->
                    <path d="M0,-40 L28,-28 L28,10 Q28,35 0,45 Q-28,35 -28,10 L-28,-28 Z" fill="none" stroke="currentColor" stroke-width="2.5"/>
                    <!-- Open book -->
                    <path d="M-16,-8 Q-8,-14 0,-8 Q8,-14 16,-8 L16,14 Q8,8 0,14 Q-8,8 -16,14 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="0" y1="-8" x2="0" y2="14" stroke="currentColor" stroke-width="1"/>
                    <!-- Flame / torch above book -->
                    <ellipse cx="0" cy="-20" rx="5" ry="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="0" y1="-12" x2="0" y2="-8" stroke="currentColor" stroke-width="1.5"/>
                </g>
            </svg>`;
        }

        /**
         * Parse payment details from transaction particulars and tags.
         */
        function getPaymentDetails(tx) {
            let chequeNo = '';
            let bank = '';
            
            const particulars = tx.particulars || '';
            const tags = tx.tags || [];
            
            tags.forEach(tag => {
                const cleaned = tag.toLowerCase().trim();
                if (['sbi', 'hdfc', 'icici', 'axis', 'pnb', 'bob', 'yesbank', 'kotak', 'canara', 'union', 'sbi-bank', 'hdfc-bank'].includes(cleaned)) {
                    bank = tag.toUpperCase();
                } else if (/^chq-?\d+$/.test(cleaned)) {
                    chequeNo = cleaned.replace('chq-', '').replace('chq', '');
                } else if (/^\d{6}$/.test(cleaned)) {
                    chequeNo = cleaned;
                }
            });
            
            if (!chequeNo) {
                const chqMatch = particulars.match(/(?:chq|cheque|cheq)\.?\s*(?:no\.?|number)?\s*#?\s*([0-9]{6,8})/i);
                if (chqMatch) {
                    chequeNo = chqMatch[1];
                }
            }
            
            if (!bank) {
                const bankMatch = particulars.match(/(?:bank|bk)\.?\s*:?\s*([a-zA-Z\s]{2,15})(?:\s+chq|cheque|cheq|amount|rs|no|\d|$)/i);
                if (bankMatch) {
                    bank = bankMatch[1].trim();
                } else {
                    const commonBanks = ['SBI', 'HDFC', 'ICICI', 'AXIS', 'PNB', 'BOB', 'CANARA', 'KOTAK', 'YES BANK', 'UNION BANK', 'STATE BANK OF INDIA'];
                    for (let b of commonBanks) {
                        const regex = new RegExp('\\b' + b + '\\b', 'i');
                        if (regex.test(particulars)) {
                            bank = b;
                            break;
                        }
                    }
                }
            }
            
            let isCash = false;
            let isOnline = false;
            tags.forEach(tag => {
                const cleaned = tag.toLowerCase().trim();
                if (cleaned === 'cash') isCash = true;
                if (cleaned === 'online' || cleaned === 'netbanking' || cleaned === 'upi' || cleaned === 'gpay') isOnline = true;
            });
            
            if (particulars.toLowerCase().includes('cash')) isCash = true;
            if (particulars.toLowerCase().includes('online') || particulars.toLowerCase().includes('upi') || particulars.toLowerCase().includes('gpay')) isOnline = true;
            
            return { chequeNo, bank, isCash, isOnline };
        }

        /**
         * Extract and format common data required by all receipt templates.
         */
        function getReceiptCommonData(tx) {
            const receiptNo = tx.reference || '';
            const txDate = tx.date || '';
            const amount = tx.amount || 0;
            
            // Determine student name, class, section
            let studentName = '';
            let classSection = '';
            let studentClass = '';
            if (tx.student) {
                studentName = tx.student.name || '';
                studentClass = tx.student.class || '';
                const sec = tx.student.section || '';
                classSection = studentClass ? (sec ? `${studentClass} - ${sec}` : studentClass) : '';
            } else {
                studentName = (tx.particulars || '').replace(/@/g, '').replace(/#\S+/g, '').trim();
            }

            // Split amount into rupees and paise
            const rupees = Math.floor(amount);
            const paise = Math.round((amount - rupees) * 100);
            const rupeesStr = rupees.toLocaleString('en-IN');
            const paiseStr = paise > 0 ? String(paise).padStart(2, '0') : '00';
            const amountInWords = numberToWords(amount);

            // Format date
            let dateFormatted = '';
            if (txDate) {
                try {
                    const d = new Date(txDate + 'T00:00:00');
                    dateFormatted = d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
                } catch(e) { 
                    dateFormatted = txDate; 
                }
            }
            
            // Parse payment details
            const payment = getPaymentDetails(tx);

            // Format Cash/Cheque No & Bank values
            let cashChequeVal = '&nbsp;';
            if (payment.isCash) {
                cashChequeVal = 'CASH';
            } else if (payment.isOnline) {
                cashChequeVal = 'ONLINE';
            } else if (payment.chequeNo) {
                cashChequeVal = payment.chequeNo;
            }
            
            let bankVal = payment.bank || '&nbsp;';

            return {
                receiptNo: escapeHtml(receiptNo),
                dateFormatted: escapeHtml(dateFormatted),
                studentName: escapeHtml(studentName),
                studentClass: escapeHtml(studentClass),
                classSection: escapeHtml(classSection),
                rupeesStr,
                paiseStr,
                amountInWords: escapeHtml(amountInWords),
                cashChequeVal: payment.chequeNo ? escapeHtml(payment.chequeNo) : cashChequeVal,
                bankVal: payment.bank ? escapeHtml(payment.bank) : bankVal
            };
        }

        /**
         * Renders the Red Tuition Fee Receipt (Tuition template).
         */
        function renderTuitionReceipt(tx) {
            const data = getReceiptCommonData(tx);
            return `
            <div class="fee-receipt theme-red">
                <!-- Header -->
                <div class="receipt-header">
                    <div class="receipt-school-info">
                        <div class="receipt-school-name">Delhi Secondary School</div>
                        <div class="receipt-school-address">
                            Survey No.239A/1, Kulapur Village,<br>
                            Shadnagar Mandal & District, Telangana
                        </div>
                        <div class="receipt-school-phones">
                            📞 6301553531 / 9848571866.
                        </div>
                    </div>
                    <div class="receipt-crest">
                        ${getSchoolCrestSVG()}
                    </div>
                </div>

                <!-- TUITION FEE RECEIPT title -->
                <div class="receipt-title-box">
                    <span>TUITION FEE RECEIPT</span>
                </div>

                <!-- Field rows: No. and Date -->
                <div class="receipt-field-row">
                    <span class="rf-label">No.</span>
                    <span class="rf-value" style="max-width: 220px;">${data.receiptNo}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Date:</span>
                    <span class="rf-value">${data.dateFormatted}</span>
                </div>

                <!-- Student Name -->
                <div class="receipt-field-row">
                    <span class="rf-label">Student Name:</span>
                    <span class="rf-value">${data.studentName}</span>
                </div>

                <!-- Class / Section -->
                <div class="receipt-field-row">
                    <span class="rf-label">Class/Section:</span>
                    <span class="rf-value">${data.classSection}</span>
                </div>

                <!-- Cash / Cheq. No -->
                <div class="receipt-field-row">
                    <span class="rf-label">Cash/Cheq. No.</span>
                    <span class="rf-value">${data.cashChequeVal}</span>
                </div>

                <!-- Bank -->
                <div class="receipt-field-row">
                    <span class="rf-label">Bank:</span>
                    <span class="rf-value">${data.bankVal}</span>
                </div>

                <!-- Particulars Table -->
                <table class="receipt-table">
                    <thead>
                        <tr>
                            <th>PARTICULARS</th>
                            <th>Rs.</th>
                            <th>Ps.</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="particulars-cell">
                                <div style="display: flex; flex-direction: column; min-height: 180px; height: 100%;">
                                    <div class="fee-type-label">TUITION FEE</div>
                                    <div class="term-checkboxes">
                                        <label><span class="term-box"></span> 1<sup>st</sup> Term</label>
                                        <label><span class="term-box"></span> 2<sup>nd</sup> Term</label>
                                        <label><span class="term-box"></span> 3<sup>rd</sup> Term</label>
                                    </div>
                                    <div style="margin-top: auto; padding-top: 30px;">
                                        <span class="non-refundable">NON REFUNDABLE</span>
                                    </div>
                                </div>
                            </td>
                            <td class="rs-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.rupeesStr}
                            </td>
                            <td class="ps-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.paiseStr}
                            </td>
                        </tr>
                        <tr class="total-row">
                            <td>TOTAL</td>
                            <td class="rs-cell">${data.rupeesStr}</td>
                            <td class="ps-cell">${data.paiseStr}</td>
                        </tr>
                    </tbody>
                </table>

                <!-- Amount in words -->
                <div class="receipt-amount-words">
                    <span class="rf-label">Amount in words</span>
                    <span class="rf-value">${data.amountInWords}</span>
                </div>

                <!-- Footer -->
                <div class="receipt-footer">
                    <div class="footer-left">Cheques subject to realisation</div>
                    <div class="footer-right">Cashier / Accountant</div>
                </div>
            </div>
            `;
        }

        /**
         * Renders the Blue Bus Fee Receipt (Transport template).
         */
        function renderTransportReceipt(tx) {
            const data = getReceiptCommonData(tx);
            return `
            <div class="fee-receipt theme-blue">
                <!-- Header -->
                <div class="receipt-header">
                    <div class="receipt-school-info">
                        <div class="receipt-school-name">Delhi Secondary School</div>
                        <div class="receipt-school-address">
                            Survey No.239A/1, Kulapur Village,<br>
                            Shadnagar Mandal & District, Telangana
                        </div>
                        <div class="receipt-school-phones">
                            📞 6301553531 / 9848571866.
                        </div>
                    </div>
                    <div class="receipt-crest">
                        ${getSchoolCrestSVG()}
                    </div>
                </div>

                <!-- BUS FEE RECEIPT title -->
                <div style="text-align: center; margin: 10px 0 14px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 20px; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px;">BUS</div>
                    <div class="receipt-title-box" style="margin: 0;">
                        <span>FEE RECEIPT</span>
                    </div>
                </div>

                <!-- Field rows: No. TRA and Date -->
                <div class="receipt-field-row">
                    <span class="rf-label">No. TRA</span>
                    <span class="rf-value" style="max-width: 220px;">${data.receiptNo}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Date :</span>
                    <span class="rf-value">${data.dateFormatted}</span>
                </div>

                <!-- Student Name & Class -->
                <div class="receipt-field-row">
                    <span class="rf-label">Student Name :</span>
                    <span class="rf-value">${data.studentName}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Class :</span>
                    <span class="rf-value">${data.studentClass || data.classSection}</span>
                </div>

                <!-- Cash / Cheq. No & Bank -->
                <div class="receipt-field-row">
                    <span class="rf-label">Cash/Cheq. No.</span>
                    <span class="rf-value">${data.cashChequeVal}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Bank:</span>
                    <span class="rf-value">${data.bankVal}</span>
                </div>

                <!-- Particulars Table -->
                <table class="receipt-table">
                    <thead>
                        <tr>
                            <th>PARTICULARS</th>
                            <th>Rs.</th>
                            <th>Ps.</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="particulars-cell">
                                <div style="display: flex; flex-direction: column; min-height: 180px; height: 100%;">
                                    <div class="fee-type-label">TRANSPORT FEE</div>
                                    <div class="term-checkboxes">
                                        <label><span class="term-box"></span> 1<sup>st</sup> Term</label>
                                        <label><span class="term-box"></span> 2<sup>nd</sup> Term</label>
                                    </div>
                                    <div style="margin-top: auto; padding-top: 30px;">
                                        <span class="non-refundable">NON REFUNDABLE</span>
                                    </div>
                                </div>
                            </td>
                            <td class="rs-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.rupeesStr}
                            </td>
                            <td class="ps-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.paiseStr}
                            </td>
                        </tr>
                        <tr class="total-row">
                            <td>TOTAL</td>
                            <td class="rs-cell">${data.rupeesStr}</td>
                            <td class="ps-cell">${data.paiseStr}</td>
                        </tr>
                    </tbody>
                </table>

                <!-- Amount in words -->
                <div class="receipt-amount-words">
                    <span class="rf-label">Amount in words</span>
                    <span class="rf-value">${data.amountInWords}</span>
                </div>

                <!-- Footer -->
                <div class="receipt-footer">
                    <div class="footer-left">Cheques subject to realisation</div>
                    <div class="footer-right">Cashier / Accountant</div>
                </div>
            </div>
            `;
        }

        /**
         * Renders the Default Fee Receipt (fallback).
         */
        function renderDefaultFeeReceipt(tx) {
            const data = getReceiptCommonData(tx);
            const subCategory = tx.subCategory || '';
            const feeLabel = subCategory ? `${subCategory.toUpperCase()} FEE` : 'FEE';
            return `
            <div class="fee-receipt theme-maroon">
                <!-- Header -->
                <div class="receipt-header">
                    <div class="receipt-school-info">
                        <div class="receipt-school-name">Delhi Secondary School</div>
                        <div class="receipt-school-address">
                            Survey No.239A/1, Kulapur Village,<br>
                            Shadnagar Mandal & District, Telangana
                        </div>
                        <div class="receipt-school-phones">
                            📞 6301553531 / 9848571866.
                        </div>
                    </div>
                    <div class="receipt-crest">
                        ${getSchoolCrestSVG()}
                    </div>
                </div>

                <!-- Title -->
                <div class="receipt-title-box">
                    <span>${feeLabel} RECEIPT</span>
                </div>

                <!-- Field rows: No. and Date -->
                <div class="receipt-field-row">
                    <span class="rf-label">No.</span>
                    <span class="rf-value" style="max-width: 220px;">${data.receiptNo}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Date:</span>
                    <span class="rf-value">${data.dateFormatted}</span>
                </div>

                <!-- Student Name -->
                <div class="receipt-field-row">
                    <span class="rf-label">Student Name:</span>
                    <span class="rf-value">${data.studentName}</span>
                </div>

                <!-- Class / Section -->
                <div class="receipt-field-row">
                    <span class="rf-label">Class/Section:</span>
                    <span class="rf-value">${data.classSection}</span>
                </div>

                <!-- Cash / Cheq. No & Bank -->
                <div class="receipt-field-row">
                    <span class="rf-label">Cash/Cheq. No.</span>
                    <span class="rf-value">${data.cashChequeVal}</span>
                    <span class="rf-spacer"></span>
                    <span class="rf-label">Bank:</span>
                    <span class="rf-value">${data.bankVal}</span>
                </div>

                <!-- Particulars Table -->
                <table class="receipt-table">
                    <thead>
                        <tr>
                            <th>PARTICULARS</th>
                            <th>Rs.</th>
                            <th>Ps.</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="particulars-cell">
                                <div style="display: flex; flex-direction: column; min-height: 180px; height: 100%;">
                                    <div class="fee-type-label">${feeLabel}</div>
                                    <div class="term-checkboxes">
                                        <label><span class="term-box"></span> 1<sup>st</sup> Term</label>
                                        <label><span class="term-box"></span> 2<sup>nd</sup> Term</label>
                                        <label><span class="term-box"></span> 3<sup>rd</sup> Term</label>
                                    </div>
                                    <div style="margin-top: auto; padding-top: 30px;">
                                        <span class="non-refundable">NON REFUNDABLE</span>
                                    </div>
                                </div>
                            </td>
                            <td class="rs-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.rupeesStr}
                            </td>
                            <td class="ps-cell" style="vertical-align: top; padding-top: 14px; font-weight: 600; font-size: 15px;">
                                ${data.paiseStr}
                            </td>
                        </tr>
                        <tr class="total-row">
                            <td>TOTAL</td>
                            <td class="rs-cell">${data.rupeesStr}</td>
                            <td class="ps-cell">${data.paiseStr}</td>
                        </tr>
                    </tbody>
                </table>

                <!-- Amount in words -->
                <div class="receipt-amount-words">
                    <span class="rf-label">Amount in words</span>
                    <span class="rf-value">${data.amountInWords}</span>
                </div>

                <!-- Footer -->
                <div class="receipt-footer">
                    <div class="footer-left">Cheques subject to realisation</div>
                    <div class="footer-right">Cashier / Accountant</div>
                </div>
            </div>
            `;
        }

        /**
         * Template selection registry object.
         */
        const ReceiptTemplates = {
            "Tuition": renderTuitionReceipt,
            "Transport": renderTransportReceipt
        };

        /**
         * Reusable Receipt Template Engine.
         */
        function renderReceipt(transaction) {
            if (transaction.head !== "Fees" && transaction.mainCategory !== "Fees") {
                return "";
            }
            const templateFn = ReceiptTemplates[transaction.subCategory];
            if (templateFn) {
                return templateFn(transaction);
            }
            return renderDefaultFeeReceipt(transaction);
        }

        /**
         * Generate the full HTML for a fee receipt. Delegated to renderReceipt.
         */
        function generateReceiptHTML(txData) {
            return renderReceipt(txData);
        }

        /**
         * Print receipt(s) for given transaction IDs.
         * Populates the print container and triggers window.print().
         */
        function printFeeReceipts(txIds) {
            const container = document.getElementById('receiptPrintContainer');
            if (!container) return;

            const ids = Array.isArray(txIds) ? txIds : [txIds];
            let html = '';

            ids.forEach(id => {
                const tx = transactions.find(t => t.id === id);
                if (!tx) return;
                html += generateReceiptHTML(tx);
            });

            if (!html) {
                showToast('No fee transactions found to print.', 'error');
                return;
            }

            container.innerHTML = html;
            container.style.display = 'block';

            // Small delay to ensure DOM render before printing
            setTimeout(() => {
                window.print();
                // Hide the container after print dialog closes
                setTimeout(() => {
                    container.style.display = 'none';
                }, 500);
            }, 300);
        }

        /**
         * Print receipt for a single transaction ID. Exposed globally.
         */
        window.printReceiptForTransaction = function(id) {
            printFeeReceipts(id);
        };



        function initTabs() {
            const tabs = document.querySelectorAll('#tabNav button');
            tabs.forEach(btn => {
                btn.addEventListener('click', function () {
                    tabs.forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
                    const target = document.getElementById('tab-' + this.dataset.tab);
                    if (target) target.classList.add('active');
                    // refresh lists when switching
                    if (this.dataset.tab === 'income') renderIncomeList();
                    if (this.dataset.tab === 'expense') renderExpenseList();
                    if (this.dataset.tab === 'transactions') renderTransactions();
                    if (this.dataset.tab === 'dashboard') refreshDashboard();
                    if (this.dataset.tab === 'activity') renderActivities();
                    if (this.dataset.tab === 'fees') {
                        renderFeesSubTab('fees-overview');
                        const subbtns = document.querySelectorAll('#feesSubTabNav .sub-tab-btn');
                        subbtns.forEach((sb, idx) => {
                            if (idx === 0) sb.classList.add('active');
                            else sb.classList.remove('active');
                        });
                        const subcontents = document.querySelectorAll('#tab-fees .sub-tab-content');
                        subcontents.forEach((sc, idx) => {
                            if (idx === 0) sc.classList.add('active');
                            else sc.classList.remove('active');
                        });
                    }
                    if (this.dataset.tab === 'faculty') {
                        if (typeof window.initFacultyTab === 'function') {
                            window.initFacultyTab();
                        }
                    }
                    if (this.dataset.tab === 'settings') {
                        renderSettingsCategories();
                        renderSettingsTags();
                        updateStudentCountDisplay();
                    }
                });
            });
        }

        // ─── Auto-run ───
        async function init() {
            // Load environment variables from .env
            await loadEnvConfig();

            // Supabase auth handles everything directly
            // Set default dates
            const today = new Date().toISOString().slice(0, 10);
            document.getElementById('incomeDate').value = today;
            document.getElementById('expenseDate').value = today;

            // Clear student import file input to prevent browser state restoration on reload
            const studentImportInput = document.getElementById('studentCsvImportInput');
            if (studentImportInput) {
                studentImportInput.value = '';
            }

            // Load data
            loadData();

            // Load Supabase config
            loadSupabaseConfig();

            // Initialize synchronization queue service

            // Clean up stale auth tokens from other/old Supabase projects in localStorage
            try {
                const targetRef = (APP_CONFIG.supabase && APP_CONFIG.supabase.url) 
                    ? new URL(APP_CONFIG.supabase.url).hostname.split('.')[0] 
                    : '';
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                        if (targetRef && !key.includes(targetRef)) {
                            console.log('Clearing old Supabase project session:', key);
                            localStorage.removeItem(key);
                        }
                    }
                }
            } catch (e) {
                console.warn('Error checking old project sessions:', e);
            }

            // Check session and setup authentication
            await checkSessionAndSetupAuth();

            // Init tabs
            initTabs();
            
            // Init fee management sub tabs
            initSubTabs();

            // Populate filter main category dropdown
            populateMainCategoryDropdown(document.getElementById('txFilterMainCategory'), 'all', '');

            // Add initial rows
            clearIncomeRows();
            clearExpenseRows();

            // Render all
            renderAll();

            // Update student count
            updateStudentCountDisplay();

            // Auto-sync status
            updateSupabaseStatus();

            console.log('📘 School Accountant initialized. Transactions:', transactions.length);
        }

        // ─── Auto-run ───
        document.addEventListener('DOMContentLoaded', init);
