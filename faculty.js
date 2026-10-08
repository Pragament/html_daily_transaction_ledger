// faculty.js
// Handles UI logic for Faculty Directory and Salary features with rich aesthetics and responsive design

(function(window) {
    'use strict';

    let currentFacultyList = [];

    const currencyFormatter = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2
    });

    function formatCurrency(val) {
        if (val === null || val === undefined || isNaN(val)) return '₹0.00';
        return currencyFormatter.format(Number(val));
    }

    function getInitials(name) {
        if (!name) return 'F';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function getAvatarColor(str) {
        const colors = [
            'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            'linear-gradient(135deg, #10b981, #047857)',
            'linear-gradient(135deg, #8b5cf6, #6d28d9)',
            'linear-gradient(135deg, #f59e0b, #d97706)',
            'linear-gradient(135deg, #ec4899, #be185d)',
            'linear-gradient(135deg, #06b6d4, #0e7490)',
            'linear-gradient(135deg, #6366f1, #4338ca)'
        ];
        let hash = 0;
        for (let i = 0; i < (str || '').length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    function getDeptColor(dept) {
        const d = (dept || '').toLowerCase();
        if (d.includes('sci')) return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' };
        if (d.includes('math')) return { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe' };
        if (d.includes('eng')) return { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
        if (d.includes('comp') || d.includes('it')) return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' };
        if (d.includes('art') || d.includes('music')) return { bg: '#fce7f3', text: '#be185d', border: '#fbcfe8' };
        if (d.includes('admin') || d.includes('acc')) return { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' };
        return { bg: '#f3f4f6', text: '#4b5563', border: '#e5e7eb' };
    }

    // Initialize Faculty Tab
    window.initFacultyTab = async function() {
        await loadFaculty();
    };

    // Load Faculty Data
    window.loadFaculty = async function() {
        const tbody = document.getElementById('facultyTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 48px 16px; color: #64748b;">
                        <div style="font-size: 32px; margin-bottom: 10px; animation: spin 1.5s linear infinite; display: inline-block;">⏳</div>
                        <div style="font-size: 15px; font-weight: 600; color: #1e293b;">Loading faculty directory...</div>
                        <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Retrieving faculty profiles & salary records</div>
                    </td>
                </tr>
            `;
        }

        try {
            const data = await window.DataService.getFaculty();
            currentFacultyList = Array.isArray(data) ? data : [];
            updateFacultyKPIs(currentFacultyList);
            populateDepartmentFilter(currentFacultyList);
            filterFacultyTable();
        } catch (e) {
            console.error("Error loading faculty:", e);
            if (window.showToast) {
                window.showToast("Error loading faculty: " + (e.message || e), 'error');
            }
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 48px 16px;">
                            <div style="font-size: 36px; margin-bottom: 8px;">⚠️</div>
                            <div style="font-size: 16px; font-weight: 600; color: #b91c1c;">Failed to load faculty directory</div>
                            <div style="font-size: 13px; color: #64748b; margin-top: 4px; max-width: 440px; margin-left: auto; margin-right: auto;">
                                ${e.message || 'Please check your connection and ensure you have permissions to view faculty.'}
                            </div>
                            <button class="btn btn-outline btn-sm" onclick="loadFaculty()" style="margin-top: 16px;">Try Again</button>
                        </td>
                    </tr>
                `;
            }
        }
    };

    function updateFacultyKPIs(list) {
        const total = list.length;
        const active = list.filter(f => (f.status || 'active').toLowerCase() === 'active');
        const totalSalary = active.reduce((sum, f) => sum + (parseFloat(f.base_salary) || 0), 0);
        
        const depts = new Set();
        list.forEach(f => {
            if (f.department && f.department.trim()) {
                depts.add(f.department.trim());
            }
        });

        const elTotal = document.getElementById('facultyCountTotal');
        const elActive = document.getElementById('facultyCountActive');
        const elPayroll = document.getElementById('facultyTotalPayroll');
        const elDepts = document.getElementById('facultyCountDepts');
        const elPercent = document.getElementById('facultyActivePercent');

        if (elTotal) elTotal.textContent = total;
        if (elActive) elActive.textContent = active.length;
        if (elPayroll) elPayroll.textContent = formatCurrency(totalSalary);
        if (elDepts) elDepts.textContent = depts.size;
        if (elPercent) {
            const pct = total > 0 ? Math.round((active.length / total) * 100) : 0;
            elPercent.textContent = pct + '%';
        }
    }

    function populateDepartmentFilter(list) {
        const select = document.getElementById('facultyDeptFilter');
        if (!select) return;

        const currentVal = select.value;
        const depts = new Set();
        list.forEach(f => {
            if (f.department && f.department.trim()) depts.add(f.department.trim());
        });

        const sortedDepts = Array.from(depts).sort();
        select.innerHTML = '<option value="all">All Departments</option>';
        sortedDepts.forEach(d => {
            const count = list.filter(f => (f.department || '').trim() === d).length;
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = `${d} (${count})`;
            select.appendChild(opt);
        });

        if (sortedDepts.includes(currentVal)) {
            select.value = currentVal;
        } else {
            select.value = 'all';
        }
    }

    window.filterFacultyTable = function() {
        const searchInput = document.getElementById('facultySearchInput');
        const deptFilter = document.getElementById('facultyDeptFilter');
        const statusFilter = document.getElementById('facultyStatusFilter');
        const sortSelect = document.getElementById('facultySortSelect');

        const q = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const dept = deptFilter ? deptFilter.value : 'all';
        const status = statusFilter ? statusFilter.value : 'all';
        const sortBy = sortSelect ? sortSelect.value : 'name-asc';

        let filtered = currentFacultyList.filter(f => {
            const matchSearch = !q || 
                (f.name && f.name.toLowerCase().includes(q)) ||
                (f.employee_id && f.employee_id.toLowerCase().includes(q)) ||
                (f.department && f.department.toLowerCase().includes(q)) ||
                (f.designation && f.designation.toLowerCase().includes(q)) ||
                (f.mobile_number && f.mobile_number.includes(q)) ||
                (f.email && f.email.toLowerCase().includes(q));

            const matchDept = dept === 'all' || (f.department && f.department.trim() === dept);
            const facultyStatus = (f.status || 'active').toLowerCase();
            const matchStatus = status === 'all' || facultyStatus === status.toLowerCase();

            return matchSearch && matchDept && matchStatus;
        });

        // Sorting
        filtered.sort((a, b) => {
            if (sortBy === 'name-asc') return (a.name || '').localeCompare(b.name || '');
            if (sortBy === 'name-desc') return (b.name || '').localeCompare(a.name || '');
            if (sortBy === 'salary-desc') return (parseFloat(b.base_salary) || 0) - (parseFloat(a.base_salary) || 0);
            if (sortBy === 'salary-asc') return (parseFloat(a.base_salary) || 0) - (parseFloat(b.base_salary) || 0);
            if (sortBy === 'empid') return (a.employee_id || '').localeCompare(b.employee_id || '');
            if (sortBy === 'date-desc') return new Date(b.joining_date || 0) - new Date(a.joining_date || 0);
            return 0;
        });

        renderFacultyTable(filtered);
    };

    window.resetFacultyFilters = function() {
        const searchInput = document.getElementById('facultySearchInput');
        const deptFilter = document.getElementById('facultyDeptFilter');
        const statusFilter = document.getElementById('facultyStatusFilter');
        const sortSelect = document.getElementById('facultySortSelect');

        if (searchInput) searchInput.value = '';
        if (deptFilter) deptFilter.value = 'all';
        if (statusFilter) statusFilter.value = 'all';
        if (sortSelect) sortSelect.value = 'name-asc';

        filterFacultyTable();
    };

    window.copyFacultyEmpId = function(empId) {
        if (!empId) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(empId).then(() => {
                if (window.showToast) window.showToast(`Copied ${empId} to clipboard!`, 'info');
            });
        }
    };

    // Render Faculty Table
    function renderFacultyTable(facultyData) {
        const tbody = document.getElementById('facultyTableBody');
        const countEl = document.getElementById('facultyTableCount');
        const payrollEl = document.getElementById('facultyFilteredPayroll');
        if (!tbody) return;

        tbody.innerHTML = '';

        const visiblePayroll = facultyData
            .filter(f => (f.status || 'active').toLowerCase() === 'active')
            .reduce((sum, f) => sum + (parseFloat(f.base_salary) || 0), 0);

        if (countEl) {
            countEl.textContent = `Showing ${facultyData.length} of ${currentFacultyList.length} faculty members`;
        }
        if (payrollEl) {
            payrollEl.textContent = `Filtered Active Payroll: ${formatCurrency(visiblePayroll)}`;
        }

        if (!facultyData || facultyData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 56px 16px; color: #64748b;">
                        <div style="font-size: 42px; margin-bottom: 12px;">👨‍🏫</div>
                        <div style="font-size: 16px; font-weight: 600; color: #1e293b;">No faculty members found</div>
                        <div style="font-size: 13px; color: #64748b; margin-top: 4px; max-width: 400px; margin-left: auto; margin-right: auto;">
                            ${currentFacultyList.length === 0 ? 'Start building your faculty registry by adding your first teacher or staff member.' : 'No faculty members match your selected search or filter criteria.'}
                        </div>
                        <div style="margin-top: 18px; display: flex; gap: 8px; justify-content: center;">
                            ${currentFacultyList.length === 0 ? `
                                <button class="btn btn-primary" onclick="showFacultyModal()">
                                    ➕ Add First Faculty Member
                                </button>
                            ` : `
                                <button class="btn btn-outline btn-sm" onclick="resetFacultyFilters()">
                                    Reset Filters
                                </button>
                            `}
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        facultyData.forEach(faculty => {
            const tr = document.createElement('tr');
            tr.className = 'faculty-table-row';
            tr.style.transition = 'background-color 0.15s ease';

            const isActive = (faculty.status || 'active').toLowerCase() === 'active';
            if (!isActive) {
                tr.style.opacity = '0.75';
            }

            const salaryDisplay = faculty.base_salary ? formatCurrency(faculty.base_salary) : '₹0.00';
            const initials = getInitials(faculty.name);
            const avatarBg = getAvatarColor(faculty.name || faculty.employee_id);
            const deptStyle = getDeptColor(faculty.department);

            const joiningFormatted = faculty.joining_date ? new Date(faculty.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

            tr.innerHTML = `
                <td style="padding: 14px 16px; vertical-align: middle;">
                    <div style="display: inline-flex; align-items: center; gap: 6px;">
                        <span class="faculty-empid-chip" onclick="copyFacultyEmpId('${faculty.employee_id}')" title="Click to copy Employee ID">
                            ${faculty.employee_id || 'N/A'}
                        </span>
                    </div>
                </td>
                <td style="padding: 14px 16px; vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="faculty-avatar" style="background: ${avatarBg};">
                            ${initials}
                        </div>
                        <div>
                            <div style="font-weight: 600; color: #0f172a; font-size: 14px; letter-spacing: -0.2px;">
                                ${faculty.name}
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px; font-size: 11px; color: #64748b;">
                                ${joiningFormatted ? `<span>📅 Joined ${joiningFormatted}</span>` : ''}
                                ${faculty.mobile_number ? `<span>📞 ${faculty.mobile_number}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </td>
                <td style="padding: 14px 16px; vertical-align: middle;">
                    ${faculty.department ? `
                        <span class="faculty-dept-badge" style="background: ${deptStyle.bg}; color: ${deptStyle.text}; border-color: ${deptStyle.border};">
                            ${faculty.department}
                        </span>
                    ` : '<span style="color:#94a3b8;">-</span>'}
                </td>
                <td style="padding: 14px 16px; vertical-align: middle; color: #334155; font-size: 13px; font-weight: 500;">
                    ${faculty.designation || '-'}
                </td>
                <td style="padding: 14px 16px; vertical-align: middle; text-align: right;">
                    <div style="font-weight: 700; color: #0b2a4a; font-size: 14px; font-family: monospace;">
                        ${salaryDisplay}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8;">/ month</div>
                </td>
                <td style="padding: 14px 16px; vertical-align: middle; text-align: center;">
                    <span class="faculty-status-pill ${isActive ? 'active' : 'inactive'}">
                        <span class="status-dot"></span>
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td style="padding: 14px 16px; vertical-align: middle; text-align: right;">
                    <div class="faculty-action-buttons">
                        ${isActive ? `
                            <button class="btn btn-sm btn-pay-salary" onclick="openPaySalaryModal('${faculty.id}')" title="Disburse Salary / Record Expense">
                                <span>💳</span> Pay Salary
                            </button>
                        ` : ''}
                        <button class="btn btn-sm btn-outline" onclick="editFaculty('${faculty.id}')" title="Edit Faculty Profile">
                            ✏️ Edit
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="openFacultyHistoryModal('${faculty.id}')" title="View Salary Disbursements History">
                            📜 History
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- Add/Edit Faculty ---

    window.showFacultyModal = function() {
        const form = document.getElementById('facultyForm');
        if (form) form.reset();
        const idEl = document.getElementById('facultyId');
        if (idEl) idEl.value = '';
        const titleEl = document.getElementById('facultyModalTitle');
        if (titleEl) titleEl.innerText = '➕ Add Faculty Member';
        const joinDateEl = document.getElementById('facultyJoinDate');
        if (joinDateEl) joinDateEl.value = new Date().toISOString().slice(0, 10);
        const statusEl = document.getElementById('facultyStatus');
        if (statusEl) statusEl.value = 'active';
        
        // Auto-generate employee ID hint if empty
        const empIdEl = document.getElementById('facultyEmpId');
        if (empIdEl && !empIdEl.value) {
            const nextSeq = (currentFacultyList.length + 1).toString().padStart(3, '0');
            empIdEl.value = `FAC-${nextSeq}`;
        }

        const modal = document.getElementById('facultyModal');
        if (modal) modal.style.display = 'flex';
    };

    window.hideFacultyModal = function() {
        const modal = document.getElementById('facultyModal');
        if (modal) modal.style.display = 'none';
    };

    window.editFaculty = function(id) {
        const faculty = currentFacultyList.find(f => f.id === id);
        if (!faculty) return;

        document.getElementById('facultyId').value = faculty.id;
        document.getElementById('facultyEmpId').value = faculty.employee_id || '';
        document.getElementById('facultyName').value = faculty.name || '';
        document.getElementById('facultyDept').value = faculty.department || '';
        document.getElementById('facultyDesig').value = faculty.designation || '';
        document.getElementById('facultyMobile').value = faculty.mobile_number || '';
        document.getElementById('facultyEmail').value = faculty.email || '';
        document.getElementById('facultyJoinDate').value = faculty.joining_date || '';
        document.getElementById('facultyBaseSalary').value = faculty.base_salary || '';
        document.getElementById('facultyStatus').value = faculty.status || 'active';

        document.getElementById('facultyModalTitle').innerText = '✏️ Edit Faculty Member';
        document.getElementById('facultyModal').style.display = 'flex';
    };

    window.saveFaculty = async function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        
        const form = document.getElementById('facultyForm');
        const saveBtn = (event && event.target && event.target.querySelector)
            ? event.target.querySelector('button[type="submit"]')
            : (form ? form.querySelector('button[type="submit"]') : null);
        const oldText = saveBtn ? saveBtn.innerHTML : 'Save Faculty';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px;"></span> Saving...';
        }

        const facultyData = {
            id: document.getElementById('facultyId').value || null,
            employee_id: document.getElementById('facultyEmpId').value.trim(),
            name: document.getElementById('facultyName').value.trim(),
            department: document.getElementById('facultyDept').value.trim(),
            designation: document.getElementById('facultyDesig').value.trim(),
            mobile_number: document.getElementById('facultyMobile').value.trim(),
            email: document.getElementById('facultyEmail').value.trim() || null,
            joining_date: document.getElementById('facultyJoinDate').value || new Date().toISOString().slice(0, 10),
            base_salary: document.getElementById('facultyBaseSalary').value ? parseFloat(document.getElementById('facultyBaseSalary').value) : 0,
            status: document.getElementById('facultyStatus').value
        };

        if (!facultyData.employee_id || !facultyData.name || !facultyData.mobile_number) {
            if (window.showToast) {
                window.showToast('Employee ID, Full Name, and Mobile Number are required.', 'error');
            }
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = oldText;
            }
            return;
        }

        try {
            await window.DataService.saveFaculty(facultyData);
            if (window.showToast) {
                window.showToast("Faculty profile saved successfully!", "success");
            }
            hideFacultyModal();
            await loadFaculty();
        } catch (e) {
            console.error(e);
            if (window.showToast) {
                window.showToast("Error saving faculty: " + e.message, "error");
            }
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = oldText;
            }
        }
    };

    // --- Pay Salary ---

    window.openPaySalaryModal = async function(id) {
        const faculty = currentFacultyList.find(f => f.id === id);
        if (!faculty) return;

        const form = document.getElementById('paySalaryForm');
        if (form) form.reset();
        
        document.getElementById('paySalaryFacultyId').value = faculty.id;
        
        // Populate preview banner
        const bannerEl = document.getElementById('paySalaryRecipientBanner');
        if (bannerEl) {
            const initials = getInitials(faculty.name);
            const avatarBg = getAvatarColor(faculty.name);
            bannerEl.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 42px; height: 42px; border-radius: 50%; background: ${avatarBg}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex-shrink: 0;">
                        ${initials}
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 15px; color: #0b2a4a;">${faculty.name}</div>
                        <div style="font-size: 12px; color: #5e6f8a;">ID: ${faculty.employee_id} • ${faculty.designation} (${faculty.department})</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Base Salary</div>
                    <div style="font-size: 16px; font-weight: 700; color: #0b2a4a; font-family: monospace;">${formatCurrency(faculty.base_salary)}</div>
                </div>
            `;
        }

        const nameInput = document.getElementById('paySalaryFacultyName');
        if (nameInput) {
            nameInput.value = `${faculty.name} (${faculty.employee_id || ''})`;
        }
        
        // Default to today
        document.getElementById('paySalaryDate').value = new Date().toISOString().split('T')[0];
        
        // Default to base salary if set
        if (faculty.base_salary) {
            document.getElementById('paySalaryAmount').value = faculty.base_salary;
        }

        // Set default remarks
        const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        const remarksInput = document.getElementById('paySalaryRemarks');
        if (remarksInput) {
            remarksInput.value = `Salary disbursement for ${currentMonth}`;
        }

        // Populate categories dynamically
        try {
            const categories = await window.DataService.getFacultyExpenseCategories();
            const catSelect = document.getElementById('paySalaryCategory');
            if (catSelect && categories && categories.length > 0) {
                catSelect.innerHTML = '';
                categories.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    if (c.name.toLowerCase() === 'salary') opt.selected = true;
                    catSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn("Could not load categories dynamically:", err);
        }

        togglePaySalaryBankOpts();
        document.getElementById('paySalaryModal').style.display = 'flex';
    };

    window.hidePaySalaryModal = function() {
        const modal = document.getElementById('paySalaryModal');
        if (modal) modal.style.display = 'none';
    };

    window.togglePaySalaryBankOpts = function() {
        const method = document.getElementById('paySalaryMethod').value;
        const bankGrp = document.getElementById('paySalaryBankGrp');
        if (!bankGrp) return;
        if (method === 'Bank' || method === 'Cheque' || method === 'UPI') {
            bankGrp.style.display = 'block';
            const label = bankGrp.querySelector('label');
            if (label) {
                label.textContent = method === 'UPI' ? 'UPI Transaction ID / Ref' : (method === 'Cheque' ? 'Cheque Number' : 'Bank Reference / UTR');
            }
        } else {
            bankGrp.style.display = 'none';
        }
    };

    window.submitFacultySalary = async function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();

        const form = document.getElementById('paySalaryForm');
        const submitBtn = (event && event.target && event.target.querySelector)
            ? event.target.querySelector('button[type="submit"]')
            : (form ? form.querySelector('button[type="submit"]') : null);
        const oldText = submitBtn ? submitBtn.innerHTML : 'Submit Payment';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px;"></span> Processing...';
        }

        const catSelect = document.getElementById('paySalaryCategory');
        const selectedCatText = catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0] ? catSelect.selectedOptions[0].textContent : 'Salary';

        const payload = {
            faculty_id: document.getElementById('paySalaryFacultyId').value,
            payment_date: document.getElementById('paySalaryDate').value,
            amount: parseFloat(document.getElementById('paySalaryAmount').value),
            expense_category_id: catSelect ? catSelect.value : null,
            expense_category_name: selectedCatText,
            payment_method: document.getElementById('paySalaryMethod').value,
            reference: document.getElementById('paySalaryRef') ? document.getElementById('paySalaryRef').value.trim() : null,
            remarks: document.getElementById('paySalaryRemarks') ? document.getElementById('paySalaryRemarks').value.trim() : null
        };

        if (isNaN(payload.amount) || payload.amount <= 0) {
            if (window.showToast) {
                window.showToast('Please enter a valid payment amount greater than zero.', 'error');
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = oldText;
            }
            return;
        }

        try {
            await window.DataService.payFacultySalary(payload);
            if (window.showToast) {
                window.showToast("Salary disbursement recorded successfully!", "success");
            }
            hidePaySalaryModal();
            // Refresh global transactions in app.js
            if (typeof window.syncAllFromSupabase === 'function') {
                window.syncAllFromSupabase();
            } else if (typeof window.loadDataFromSupabase === 'function') {
                await window.loadDataFromSupabase();
            }
            if (typeof window.updateDashboardFacultyMetrics === 'function') {
                window.updateDashboardFacultyMetrics();
            }
            const reportsSubtab = document.getElementById('subtab-faculty-reports');
            if (reportsSubtab && reportsSubtab.classList.contains('active')) {
                renderFacultyReports();
            }
        } catch (e) {
            console.error(e);
            if (window.showToast) {
                window.showToast("Error recording payment: " + (e.message || e), "error");
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = oldText;
            }
        }
    };

    // --- Salary History ---

    window.openFacultyHistoryModal = async function(id) {
        const faculty = currentFacultyList.find(f => f.id === id);
        if (!faculty) return;

        document.getElementById('facultyHistoryTitle').innerText = `📜 Payment History: ${faculty.name}`;
        
        const summaryCard = document.getElementById('facultyHistorySummary');
        if (summaryCard) {
            summaryCard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 12px; margin-bottom: 12px;">
                    <div>
                        <div style="font-weight: 700; color: #0f172a;">${faculty.name} (${faculty.employee_id})</div>
                        <div style="font-size: 12px; color: #64748b;">${faculty.designation} • Base: ${formatCurrency(faculty.base_salary)}</div>
                    </div>
                    <div style="text-align: right;" id="historyTotalDisbursedWrap">
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Total Disbursed</div>
                        <div style="font-size: 16px; font-weight: 700; color: #b91c1c; font-family: monospace;" id="historyTotalDisbursed">Loading...</div>
                    </div>
                </div>
            `;
        }

        const tbody = document.getElementById('facultyHistoryBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 32px; color: #64748b;">⏳ Loading payment history...</td></tr>';
        document.getElementById('facultyHistoryModal').style.display = 'flex';

        try {
            const history = await window.DataService.getFacultySalaryHistory(id);
            tbody.innerHTML = '';
            
            let totalAmount = 0;
            if (Array.isArray(history)) {
                totalAmount = history.reduce((sum, h) => sum + (parseFloat(h.transactions ? h.transactions.amount : h.amount) || 0), 0);
            }

            const totalEl = document.getElementById('historyTotalDisbursed');
            if (totalEl) totalEl.textContent = formatCurrency(totalAmount);

            if (!history || history.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 48px 16px; color: #64748b;">
                            <div style="font-size: 32px; margin-bottom: 8px;">💸</div>
                            <div style="font-weight: 600; color: #1e293b; font-size: 15px;">No disbursement records found</div>
                            <div style="font-size: 13px; margin-top: 4px; color: #64748b;">No salary or expense payments have been issued to ${faculty.name} yet.</div>
                        </td>
                    </tr>
                `;
                return;
            }

            history.forEach(record => {
                const tr = document.createElement('tr');
                const txData = record.transactions || {};
                const dateStr = txData.date ? new Date(txData.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : (record.payment_date || '-');
                const amountVal = parseFloat(txData.amount !== undefined ? txData.amount : record.amount) || 0;
                const amount = formatCurrency(amountVal);
                
                tr.innerHTML = `
                    <td style="padding: 12px 14px; font-size: 13px; font-weight: 500; color: #1e293b;">${dateStr}</td>
                    <td style="padding: 12px 14px;">
                        <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;">
                            ${record.expense_category || 'Salary'}
                        </span>
                    </td>
                    <td style="padding: 12px 14px; font-size: 12px; color: #475569;">
                        ${record.payment_mode || 'Cash'}
                    </td>
                    <td style="padding: 12px 14px; font-weight: 700; color: #b91c1c; text-align: right; font-family: monospace; font-size: 14px;">
                        ${amount}
                    </td>
                    <td style="padding: 12px 14px; font-size: 12px; color: #64748b;">
                        ${record.remarks || txData.particulars || '-'}
                        ${record.voucher_number ? ` <span style="font-size: 11px; color: #94a3b8;">(${record.voucher_number})</span>` : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error("Error loading history:", e);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 28px; color: #b91c1c;">Failed to load history: ${e.message}</td></tr>`;
        }
    };

    window.hideFacultyHistoryModal = function() {
        const modal = document.getElementById('facultyHistoryModal');
        if (modal) modal.style.display = 'none';
    };

    // ════════════════════════════════════════════════════════════════
    //  FACULTY CSV IMPORT & EXPORT
    // ════════════════════════════════════════════════════════════════

    function safeCsvDownload(content, filename, type = 'text/csv;charset=utf-8;') {
        if (typeof window.downloadFile === 'function') {
            window.downloadFile(content, filename, type);
            return;
        }
        const blob = new Blob([content], { type: type });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // Trigger file dialog
    window.triggerFacultyCsvImport = function() {
        window.isImportingFacultyCSV = true;
        const input = document.getElementById('facultyCsvImportInput');
        if (input) {
            input.value = '';
            input.click();
        }
    };

    // Handle CSV file selection
    window.handleFacultyCsvSelected = function(event) {
        if (!window.isImportingFacultyCSV) {
            if (event.target) event.target.value = '';
            return;
        }
        window.isImportingFacultyCSV = false;

        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (typeof Papa === 'undefined') {
            if (window.showToast) window.showToast("PapaParse library not found. Please refresh page.", "error");
            return;
        }

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                const rows = results.data;
                if (!rows || rows.length === 0) {
                    if (window.showToast) window.showToast('The selected CSV file contains no data rows.', 'error');
                    return;
                }
                processParsedFacultyCsv(rows);
            },
            error: function(err) {
                console.error("CSV parse error:", err);
                if (window.showToast) window.showToast('CSV parsing error: ' + (err.message || err), 'error');
            }
        });

        event.target.value = '';
    };

    function findMatchingKey(row, aliases) {
        const keys = Object.keys(row);
        return keys.find(k => {
            const clean = k.trim().toLowerCase().replace(/[\s_-]+/g, '');
            return aliases.some(alias => clean === alias.replace(/[\s_-]+/g, ''));
        });
    }

    function processParsedFacultyCsv(rawRows) {
        const existingEmpMap = new Map();
        currentFacultyList.forEach(f => {
            if (f.employee_id) existingEmpMap.set(String(f.employee_id).trim().toLowerCase(), f);
        });

        const seenInFile = new Set();
        const parsedRows = [];

        rawRows.forEach((row, idx) => {
            const empKey = findMatchingKey(row, ['employee_id', 'employee id', 'empid', 'emp_id', 'emp id', 'id', 'staff_id', 'staff id', 'code']);
            const nameKey = findMatchingKey(row, ['faculty_name', 'faculty name', 'name', 'full_name', 'full name', 'staff_name', 'staff name', 'teacher_name', 'teacher name']);
            const deptKey = findMatchingKey(row, ['department', 'dept', 'stream', 'subject']);
            const desigKey = findMatchingKey(row, ['designation', 'role', 'position', 'title', 'post']);
            const mobileKey = findMatchingKey(row, ['mobile_number', 'mobile number', 'mobile', 'phone', 'phone_number', 'phone number', 'contact', 'contact_no', 'cell']);
            const emailKey = findMatchingKey(row, ['email', 'email_id', 'email id', 'mail', 'email address']);
            const joinKey = findMatchingKey(row, ['joining_date', 'joining date', 'date_of_joining', 'date of joining', 'doj', 'join_date']);
            const salaryKey = findMatchingKey(row, ['salary', 'basic_salary', 'basic salary', 'base_salary', 'base salary', 'monthly_salary', 'monthly salary', 'pay', 'amount']);
            const statusKey = findMatchingKey(row, ['status', 'active_status', 'state']);

            const employeeId = empKey && row[empKey] ? String(row[empKey]).trim() : '';
            const facultyName = nameKey && row[nameKey] ? String(row[nameKey]).trim() : '';
            const department = deptKey && row[deptKey] ? String(row[deptKey]).trim() : 'General';
            const designation = desigKey && row[desigKey] ? String(row[desigKey]).trim() : 'Faculty';
            const mobileNumber = mobileKey && row[mobileKey] ? String(row[mobileKey]).trim() : '';
            const email = emailKey && row[emailKey] ? String(row[emailKey]).trim() : '';
            
            let joiningDate = joinKey && row[joinKey] ? String(row[joinKey]).trim() : '';
            if (joiningDate) {
                // If format is DD-MM-YYYY or DD/MM/YYYY, convert to YYYY-MM-DD
                const matchDmy = joiningDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
                if (matchDmy) {
                    joiningDate = `${matchDmy[3]}-${matchDmy[2].padStart(2, '0')}-${matchDmy[1].padStart(2, '0')}`;
                }
            } else {
                joiningDate = new Date().toISOString().slice(0, 10);
            }

            const rawSalary = salaryKey && row[salaryKey] ? String(row[salaryKey]).replace(/[^0-9.]/g, '') : '0';
            const salary = parseFloat(rawSalary) || 0;

            let status = statusKey && row[statusKey] ? String(row[statusKey]).trim().toLowerCase() : 'active';
            if (status !== 'inactive') status = 'active';

            // Determine Row Status
            let rowStatus = 'new';
            let validationError = '';

            if (!employeeId) {
                rowStatus = 'invalid';
                validationError = 'Missing Employee ID';
            } else if (!facultyName) {
                rowStatus = 'invalid';
                validationError = 'Missing Faculty Name';
            } else {
                const lowerId = employeeId.toLowerCase();
                if (seenInFile.has(lowerId)) {
                    rowStatus = 'duplicate_file';
                    validationError = 'Duplicate ID in CSV';
                } else {
                    seenInFile.add(lowerId);
                    if (existingEmpMap.has(lowerId)) {
                        rowStatus = 'existing';
                    }
                }
            }

            parsedRows.push({
                index: idx,
                employee_id: employeeId,
                name: facultyName,
                faculty_name: facultyName,
                department: department || 'General',
                designation: designation || 'Faculty',
                mobile_number: mobileNumber || '0000000000',
                email: email || null,
                joining_date: joiningDate,
                salary: salary,
                base_salary: salary,
                status: status,
                rowStatus: rowStatus,
                validationError: validationError,
                selected: (rowStatus === 'new' || rowStatus === 'existing')
            });
        });

        window.facultyCsvParsedRows = parsedRows;
        showFacultyCsvPreview(parsedRows);
    }

    window.showFacultyCsvPreview = function(parsedRows) {
        window.currentCsvFilter = 'all';

        const modal = document.getElementById('facultyCsvPreviewModal');
        if (!modal) return;

        updateFacultyCsvPreviewStats();
        renderFacultyCsvPreviewRows();

        modal.style.display = 'flex';
    };

    window.hideFacultyCsvPreviewModal = function() {
        const modal = document.getElementById('facultyCsvPreviewModal');
        if (modal) modal.style.display = 'none';
        window.facultyCsvParsedRows = [];
    };

    function updateFacultyCsvPreviewStats() {
        const rows = window.facultyCsvParsedRows || [];
        const total = rows.length;
        const newCount = rows.filter(r => r.rowStatus === 'new').length;
        const updateCount = rows.filter(r => r.rowStatus === 'existing').length;
        const fileDupes = rows.filter(r => r.rowStatus === 'duplicate_file').length;
        const invalidCount = rows.filter(r => r.rowStatus === 'invalid').length;
        const selectedCount = rows.filter(r => r.selected).length;

        const summaryEl = document.getElementById('facultyCsvSummaryText');
        if (summaryEl) {
            summaryEl.innerHTML = `Found <b>${total}</b> records: <span style="color:#047857;">${newCount} new</span>, <span style="color:#0369a1;">${updateCount} existing</span>, <span style="color:#b91c1c;">${invalidCount + fileDupes} with issues</span>. Selected <b>${selectedCount}</b> for import.`;
        }

        const pillAll = document.getElementById('csvPillAll');
        const pillNew = document.getElementById('csvPillNew');
        const pillUpdates = document.getElementById('csvPillUpdates');
        const pillIssues = document.getElementById('csvPillIssues');

        if (pillAll) pillAll.textContent = `All (${total})`;
        if (pillNew) pillNew.textContent = `New (${newCount})`;
        if (pillUpdates) pillUpdates.textContent = `Updates (${updateCount})`;
        if (pillIssues) pillIssues.textContent = `Issues (${invalidCount + fileDupes})`;

        const confirmBtn = document.getElementById('facultyCsvConfirmBtn');
        if (confirmBtn) {
            confirmBtn.innerHTML = `<span>📥</span> Import ${selectedCount} Faculty`;
            confirmBtn.disabled = (selectedCount === 0);
        }
    }

    window.filterFacultyCsvPreview = function(filterType) {
        window.currentCsvFilter = filterType;
        ['all', 'new', 'existing', 'issues'].forEach(f => {
            const btn = document.getElementById('csvFilterBtn_' + f);
            if (btn) {
                if (f === filterType) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
        renderFacultyCsvPreviewRows();
    };

    function renderFacultyCsvPreviewRows() {
        const tbody = document.getElementById('facultyCsvPreviewTableBody');
        if (!tbody) return;

        const rows = window.facultyCsvParsedRows || [];
        const filter = window.currentCsvFilter || 'all';

        const filtered = rows.filter(r => {
            if (filter === 'new') return r.rowStatus === 'new';
            if (filter === 'existing') return r.rowStatus === 'existing';
            if (filter === 'issues') return r.rowStatus === 'invalid' || r.rowStatus === 'duplicate_file';
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: #64748b;">No records match this filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            let badgeHtml = '';
            let rowBg = '';

            if (item.rowStatus === 'new') {
                badgeHtml = `<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;">🟢 New</span>`;
            } else if (item.rowStatus === 'existing') {
                badgeHtml = `<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd;">🔵 Existing</span>`;
            } else if (item.rowStatus === 'duplicate_file') {
                badgeHtml = `<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #fef3c7; color: #b45309; border: 1px solid #fde68a;" title="${escapeHtml(item.validationError)}">⚠️ Dupl. in CSV</span>`;
                rowBg = 'background: #fffbeb;';
            } else {
                badgeHtml = `<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;" title="${escapeHtml(item.validationError)}">❌ Invalid</span>`;
                rowBg = 'background: #fef2f2;';
            }

            const isCheckDisabled = (item.rowStatus === 'invalid');
            const isChecked = item.selected ? 'checked' : '';

            return `
                <tr style="${rowBg}">
                    <td style="text-align: center; padding: 8px 10px;">
                        <input type="checkbox" onchange="toggleFacultyCsvRowSelection(${item.index}, this.checked)" ${isChecked} ${isCheckDisabled ? 'disabled' : ''} style="cursor: pointer; transform: scale(1.1);" />
                    </td>
                    <td style="padding: 8px 10px;">${badgeHtml}</td>
                    <td style="padding: 8px 10px; font-weight: 700; color: #0b2a4a; font-family: monospace;">${escapeHtml(item.employee_id || '-')}</td>
                    <td style="padding: 8px 10px;">
                        <div style="font-weight: 600; color: #1e293b;">${escapeHtml(item.name || '-')}</div>
                        ${item.validationError ? `<div style="font-size: 11px; color: #b91c1c;">${escapeHtml(item.validationError)}</div>` : ''}
                    </td>
                    <td style="padding: 8px 10px; font-size: 12px; color: #475569;">${escapeHtml(item.department)}</td>
                    <td style="padding: 8px 10px; font-size: 12px; color: #475569;">${escapeHtml(item.designation)}</td>
                    <td style="padding: 8px 10px; font-size: 12px; color: #475569;">
                        <div>📞 ${escapeHtml(item.mobile_number)}</div>
                        ${item.email ? `<div style="color: #64748b; font-size: 11px;">✉️ ${escapeHtml(item.email)}</div>` : ''}
                    </td>
                    <td style="padding: 8px 10px; font-weight: 700; color: #047857; text-align: right; font-family: monospace;">
                        ${formatCurrency(item.salary)}
                    </td>
                    <td style="padding: 8px 10px; text-align: center;">
                        <span style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; ${item.status === 'active' ? 'background:#dcfce7; color:#15803d;' : 'background:#f1f5f9; color:#64748b;'}">
                            ${escapeHtml(item.status)}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.toggleFacultyCsvRowSelection = function(index, checked) {
        if (!window.facultyCsvParsedRows) return;
        const row = window.facultyCsvParsedRows.find(r => r.index === index);
        if (row && row.rowStatus !== 'invalid') {
            row.selected = checked;
        }
        updateFacultyCsvPreviewStats();
    };

    window.toggleSelectAllFacultyCsv = function(checked) {
        if (!window.facultyCsvParsedRows) return;
        window.facultyCsvParsedRows.forEach(row => {
            if (row.rowStatus !== 'invalid') {
                row.selected = checked;
            }
        });
        renderFacultyCsvPreviewRows();
        updateFacultyCsvPreviewStats();
    };

    window.confirmImportFacultyCSV = async function() {
        const rows = window.facultyCsvParsedRows || [];
        const selected = rows.filter(r => r.selected && r.rowStatus !== 'invalid');

        if (selected.length === 0) {
            if (window.showToast) window.showToast('Please select at least one valid faculty row to import.', 'warning');
            return;
        }

        const updateExistingCheckbox = document.getElementById('facultyCsvUpdateExisting');
        const updateDuplicates = updateExistingCheckbox ? updateExistingCheckbox.checked : true;

        const confirmBtn = document.getElementById('facultyCsvConfirmBtn');
        const oldHtml = confirmBtn ? confirmBtn.innerHTML : 'Import';
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px;"></span> Importing...';
        }

        try {
            const result = await window.DataService.importFacultyBatch(selected, { updateDuplicates });
            
            if (window.showToast) {
                window.showToast(`✅ Successfully imported ${result.inserted + result.updated} faculty (${result.inserted} added, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ''}).`, 'success');
            }

            hideFacultyCsvPreviewModal();
            await loadFaculty();
        } catch (e) {
            console.error("Faculty CSV Import error:", e);
            if (window.showToast) {
                window.showToast('Import failed: ' + (e.message || e), 'error');
            }
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = oldHtml;
            }
        }
    };

    // Download Sample Template CSV
    window.downloadFacultySampleCSV = function() {
        const sampleHeaders = ['employee_id', 'faculty_name', 'department', 'designation', 'mobile_number', 'email', 'joining_date', 'salary', 'status'];
        const sampleRows = [
            ['EMP101', 'Dr. Rajesh Sharma', 'Science', 'Senior Lecturer', '9876543210', 'rajesh.sharma@school.edu', '2023-04-15', '45000', 'active'],
            ['EMP102', 'Pooja Verma', 'Mathematics', 'Associate Professor', '9876543211', 'pooja.verma@school.edu', '2022-07-01', '40000', 'active'],
            ['EMP103', 'Sunil Kumar', 'Physical Education', 'Sports Coach', '9876543212', 'sunil.kumar@school.edu', '2024-01-10', '28000', 'active']
        ];

        let csvContent = sampleHeaders.join(',') + '\n';
        sampleRows.forEach(row => {
            csvContent += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        safeCsvDownload(csvContent, 'faculty_sample_template.csv');
        if (window.showToast) window.showToast('📥 Downloaded Faculty CSV template.', 'info');
    };

    // Export Faculty CSV
    window.exportFacultyCSV = function() {
        const list = currentFacultyList || [];
        if (list.length === 0) {
            if (window.showToast) window.showToast('No faculty records to export.', 'info');
            return;
        }

        const headers = ['employee_id', 'faculty_name', 'department', 'designation', 'mobile_number', 'email', 'joining_date', 'salary', 'status'];
        let csvContent = headers.join(',') + '\n';

        list.forEach(f => {
            const row = [
                f.employee_id || '',
                f.name || f.faculty_name || '',
                f.department || '',
                f.designation || '',
                f.mobile_number || '',
                f.email || '',
                f.joining_date || '',
                f.salary !== undefined ? f.salary : (f.base_salary || 0),
                f.status || 'active'
            ];
            csvContent += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        safeCsvDownload(csvContent, `faculty_directory_export_${new Date().toISOString().slice(0, 10)}.csv`);
        if (window.showToast) window.showToast(`✅ Exported ${list.length} faculty records to CSV.`, 'success');
    };

    // ════════════════════════════════════════════════════════════════
    //  FACULTY REPORTING & SALARY REGISTERS
    // ════════════════════════════════════════════════════════════════

    let currentReportPayments = [];

    // Switch between Directory sub-tab and Reports sub-tab
    window.switchFacultySubTab = function(tabName) {
        const btnDir = document.getElementById('btnFacultySubtabDir');
        const btnReports = document.getElementById('btnFacultySubtabReports');
        const contentDir = document.getElementById('subtab-faculty-directory');
        const contentReports = document.getElementById('subtab-faculty-reports');

        if (tabName === 'reports') {
            if (btnDir) btnDir.classList.remove('active');
            if (btnReports) btnReports.classList.add('active');
            if (contentDir) {
                contentDir.classList.remove('active');
                contentDir.style.display = 'none';
            }
            if (contentReports) {
                contentReports.classList.add('active');
                contentReports.style.display = 'block';
            }
            initFacultyReports();
        } else {
            if (btnDir) btnDir.classList.add('active');
            if (btnReports) btnReports.classList.remove('active');
            if (contentDir) {
                contentDir.classList.add('active');
                contentDir.style.display = 'block';
            }
            if (contentReports) {
                contentReports.classList.remove('active');
                contentReports.style.display = 'none';
            }
        }
    };

    // Initialize Report Filters
    window.initFacultyReports = async function() {
        populateReportMonths();
        populateReportDepartments();
        await renderFacultyReports();
    };

    function populateReportMonths() {
        const select = document.getElementById('facultyReportMonthSelect');
        if (!select) return;

        const currentVal = select.value;
        const now = new Date();
        const monthsList = [];

        // Generate past 18 months
        for (let i = 0; i < 18; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            monthsList.push({ val, label });
        }

        let html = monthsList.map(m => `<option value="${m.val}">${m.label}</option>`).join('');
        html += `<option value="all">Full Year / All Time</option>`;
        select.innerHTML = html;

        // Default to current month
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            select.value = currentVal;
        } else {
            select.value = thisMonth;
        }
    }

    function populateReportDepartments() {
        const select = document.getElementById('facultyReportDeptSelect');
        if (!select) return;

        const depts = new Set();
        currentFacultyList.forEach(f => {
            if (f.department && f.department.trim()) depts.add(f.department.trim());
        });

        const sorted = Array.from(depts).sort();
        let html = '<option value="all">All Departments</option>';
        sorted.forEach(d => {
            html += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`;
        });
        select.innerHTML = html;
    }

    // Render active report
    window.renderFacultyReports = async function() {
        const typeSelect = document.getElementById('facultyReportTypeSelect');
        const monthSelect = document.getElementById('facultyReportMonthSelect');
        const deptSelect = document.getElementById('facultyReportDeptSelect');
        const statusSelect = document.getElementById('facultyReportStatusSelect');

        const monthGroup = document.getElementById('facultyReportMonthGroup');
        const deptGroup = document.getElementById('facultyReportDeptGroup');
        const statusGroup = document.getElementById('facultyReportStatusGroup');

        const rType = typeSelect ? typeSelect.value : 'salary-register';
        const selectedMonth = monthSelect ? monthSelect.value : 'all';
        const selectedDept = deptSelect ? deptSelect.value : 'all';
        const selectedStatus = statusSelect ? statusSelect.value : 'all';

        // Adapt filter toolbar controls according to report type
        if (rType === 'monthly-summary') {
            if (monthGroup) monthGroup.style.display = 'none';
            if (deptGroup) deptGroup.style.display = 'block';
            if (statusGroup) statusGroup.style.display = 'none';
        } else if (rType === 'dept-summary') {
            if (monthGroup) monthGroup.style.display = 'block';
            if (deptGroup) deptGroup.style.display = 'none';
            if (statusGroup) statusGroup.style.display = 'none';
        } else {
            if (monthGroup) monthGroup.style.display = 'block';
            if (deptGroup) deptGroup.style.display = 'block';
            if (statusGroup) statusGroup.style.display = 'block';
        }

        const tbody = document.getElementById('facultyReportsTableBody');
        const thead = document.getElementById('facultyReportsTableHead');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: #64748b;">⏳ Generating ${rType.replace('-', ' ')}...</td></tr>`;
        }

        try {
            // Load payments across all faculty
            currentReportPayments = await window.DataService.getAllFacultyPayments();
            if (!Array.isArray(currentReportPayments)) currentReportPayments = [];

            if (rType === 'salary-register') {
                renderSalaryRegisterReport(selectedMonth, selectedDept, selectedStatus);
            } else if (rType === 'monthly-summary') {
                renderMonthlySummaryReport(selectedDept);
            } else if (rType === 'dept-summary') {
                renderDeptSummaryReport(selectedMonth);
            }
        } catch (e) {
            console.error("Error rendering faculty report:", e);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: #b91c1c;">⚠️ Error generating report: ${escapeHtml(e.message || String(e))}</td></tr>`;
            }
        }
    };

    // ─── REPORT 1: SALARY REGISTER ───
    function renderSalaryRegisterReport(month, dept, statusFilter) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 10px 14px; width: 90px;">Emp ID</th>
                <th style="padding: 10px 14px;">Faculty Member</th>
                <th style="padding: 10px 14px;">Department &amp; Role</th>
                <th style="padding: 10px 14px; text-align: right; width: 115px;">Base Salary</th>
                <th style="padding: 10px 14px; text-align: right; width: 115px;">Disbursed</th>
                <th style="padding: 10px 14px; text-align: right; width: 115px;">Pending</th>
                <th style="padding: 10px 14px; text-align: center; width: 100px;">Status</th>
                <th style="padding: 10px 14px; width: 160px;">Last Payment</th>
                <th style="padding: 10px 14px; text-align: center; width: 95px;">Action</th>
            </tr>
        `;

        let activeStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        if (dept !== 'all') {
            activeStaff = activeStaff.filter(f => f.department === dept);
        }

        let totalCommitted = 0;
        let totalDisbursed = 0;
        let totalPending = 0;
        let displayedRows = 0;

        const rowsHtml = activeStaff.map(faculty => {
            const baseSalary = faculty.salary !== undefined ? Number(faculty.salary) : (Number(faculty.base_salary) || 0);
            
            // Filter payments for this staff member in this month
            const staffPayments = currentReportPayments.filter(p => {
                const matchId = (p.faculty_id === faculty.id || (p.employee_id && p.employee_id === faculty.employee_id));
                if (!matchId) return false;
                if (month !== 'all') {
                    return p.payment_date && p.payment_date.startsWith(month);
                }
                return true;
            });

            const disbursed = staffPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const pending = Math.max(0, baseSalary - disbursed);

            let rowStatus = 'unpaid';
            if (disbursed >= baseSalary && baseSalary > 0) {
                rowStatus = 'paid';
            } else if (disbursed > 0) {
                rowStatus = 'partial';
            }

            // Apply status filter
            if (statusFilter !== 'all' && rowStatus !== statusFilter) {
                return '';
            }

            totalCommitted += baseSalary;
            totalDisbursed += disbursed;
            totalPending += pending;
            displayedRows++;

            // Status Badge
            let statusBadge = '';
            if (rowStatus === 'paid') {
                statusBadge = '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;">🟢 Paid</span>';
            } else if (rowStatus === 'partial') {
                statusBadge = '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">🟡 Partial</span>';
            } else {
                statusBadge = '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;">🔴 Unpaid</span>';
            }

            // Last Payment Detail
            let lastPayText = '<span style="color: #94a3b8; font-size: 11px;">No records</span>';
            if (staffPayments.length > 0) {
                const last = staffPayments[0];
                const dtStr = last.payment_date ? new Date(last.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-';
                lastPayText = `
                    <div style="font-size: 12px; font-weight: 600; color: #1e293b;">${dtStr} (${last.payment_mode || 'Cash'})</div>
                    <div style="font-size: 11px; color: #64748b;">${escapeHtml(last.voucher_number || last.category || '')}</div>
                `;
            }

            const initials = getInitials(faculty.name);
            const avatarBg = getAvatarColor(faculty.name);

            return `
                <tr>
                    <td style="padding: 10px 14px; font-weight: 700; font-family: monospace; color: #0b2a4a;">${escapeHtml(faculty.employee_id || '-')}</td>
                    <td style="padding: 10px 14px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 28px; height: 28px; border-radius: 50%; background: ${avatarBg}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0;">
                                ${initials}
                            </div>
                            <span style="font-weight: 600; color: #1e293b;">${escapeHtml(faculty.name)}</span>
                        </div>
                    </td>
                    <td style="padding: 10px 14px; font-size: 12px; color: #475569;">
                        <div><b>${escapeHtml(faculty.department)}</b></div>
                        <div style="color: #64748b; font-size: 11px;">${escapeHtml(faculty.designation)}</div>
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 600; font-family: monospace;">
                        ${formatCurrency(baseSalary)}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #16a34a; font-family: monospace;">
                        ${formatCurrency(disbursed)}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${pending > 0 ? '#b91c1c' : '#64748b'}; font-family: monospace;">
                        ${formatCurrency(pending)}
                    </td>
                    <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 10px 14px;">${lastPayText}</td>
                    <td style="padding: 10px 14px; text-align: center;">
                        ${pending > 0 ? `<button class="btn btn-outline btn-sm" onclick="openPaySalaryModal('${faculty.id}')" style="padding: 3px 8px; font-size: 11px; color: #0284c7; border-color: #bae6fd;">Pay</button>` : `<span style="color: #10b981; font-size: 13px;">✔</span>`}
                    </td>
                </tr>
            `;
        }).join('');

        if (displayedRows === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 36px; color: #64748b;">No faculty records match the selected month/department/status filters.</td></tr>`;
        } else {
            tbody.innerHTML = rowsHtml;
        }

        // Footer Totals
        tfoot.innerHTML = `
            <tr>
                <td colspan="3" style="padding: 12px 14px; text-align: right; font-size: 13px;">TOTALS (${displayedRows} Staff):</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #0b2a4a; font-size: 13px;">${formatCurrency(totalCommitted)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #16a34a; font-size: 13px;">${formatCurrency(totalDisbursed)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #b91c1c; font-size: 13px;">${formatCurrency(totalPending)}</td>
                <td colspan="3" style="padding: 12px 14px; text-align: left; font-size: 12px; color: #475569;">
                    Payout Rate: <b>${totalCommitted > 0 ? (totalDisbursed / totalCommitted * 100).toFixed(1) : 0}%</b>
                </td>
            </tr>
        `;

        // Update Report KPI Cards
        updateReportKpis(displayedRows, totalCommitted, totalDisbursed, totalPending);
        
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing ${displayedRows} staff salary records`;
    }

    // ─── REPORT 2: MONTHLY SUMMARY ───
    function renderMonthlySummaryReport(deptFilter) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 10px 14px;">Month &amp; Year</th>
                <th style="padding: 10px 14px; text-align: center; width: 110px;">Staff in Scope</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Base Payroll</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Disbursed</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Pending Balance</th>
                <th style="padding: 10px 14px; text-align: center; width: 130px;">Disbursement %</th>
                <th style="padding: 10px 14px; text-align: center; width: 110px;">Vouchers</th>
            </tr>
        `;

        let scopedStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        if (deptFilter !== 'all') {
            scopedStaff = scopedStaff.filter(f => f.department === deptFilter);
        }
        const monthlyStaffCommitment = scopedStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);

        // Gather all distinct months from payments + last 12 months
        const monthSet = new Set();
        currentReportPayments.forEach(p => {
            if (p.payment_date && p.payment_date.length >= 7) {
                monthSet.add(p.payment_date.slice(0, 7));
            }
        });
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        const sortedMonths = Array.from(monthSet).sort().reverse();

        let sumDisbursed = 0;
        let sumCommitted = 0;
        let sumPending = 0;
        let totalVouchers = 0;

        const rowsHtml = sortedMonths.map(mStr => {
            const [y, m] = mStr.split('-');
            const dateObj = new Date(Number(y), Number(m) - 1, 1);
            const monthLabel = dateObj.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

            // Payments in this month
            const mPayments = currentReportPayments.filter(p => {
                if (!p.payment_date || !p.payment_date.startsWith(mStr)) return false;
                if (deptFilter !== 'all') {
                    const fac = currentFacultyList.find(f => f.id === p.faculty_id || f.employee_id === p.employee_id);
                    return fac && fac.department === deptFilter;
                }
                return true;
            });

            const disbursed = mPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
            const committed = monthlyStaffCommitment;
            const pending = Math.max(0, committed - disbursed);
            const pct = committed > 0 ? (disbursed / committed * 100).toFixed(1) : (disbursed > 0 ? 100 : 0);

            sumDisbursed += disbursed;
            sumCommitted += committed;
            sumPending += pending;
            totalVouchers += mPayments.length;

            return `
                <tr>
                    <td style="padding: 10px 14px; font-weight: 700; color: #0b2a4a;">${monthLabel}</td>
                    <td style="padding: 10px 14px; text-align: center; color: #475569;">${scopedStaff.length}</td>
                    <td style="padding: 10px 14px; text-align: right; font-family: monospace;">${formatCurrency(committed)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #16a34a; font-family: monospace;">${formatCurrency(disbursed)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${pending > 0 ? '#b91c1c' : '#64748b'}; font-family: monospace;">${formatCurrency(pending)}</td>
                    <td style="padding: 10px 14px; text-align: center;">
                        <span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; ${Number(pct) >= 100 ? 'background:#dcfce7; color:#15803d;' : (Number(pct) > 0 ? 'background:#fef3c7; color:#b45309;' : 'background:#fee2e2; color:#b91c1c;')}">
                            ${pct}%
                        </span>
                    </td>
                    <td style="padding: 10px 14px; text-align: center; font-weight: 600; color: #475569;">${mPayments.length}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        tfoot.innerHTML = `
            <tr>
                <td style="padding: 12px 14px; font-size: 13px;">TOTAL (${sortedMonths.length} Months):</td>
                <td style="padding: 12px 14px; text-align: center;">-</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace;">${formatCurrency(sumCommitted)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #16a34a;">${formatCurrency(sumDisbursed)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #b91c1c;">${formatCurrency(sumPending)}</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">${sumCommitted > 0 ? (sumDisbursed / sumCommitted * 100).toFixed(1) : 0}%</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">${totalVouchers}</td>
            </tr>
        `;

        updateReportKpis(scopedStaff.length, sumCommitted, sumDisbursed, sumPending);

        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing monthly summary across ${sortedMonths.length} historical cycles`;
    }

    // ─── REPORT 3: DEPARTMENT-WISE SUMMARY ───
    function renderDeptSummaryReport(month) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 10px 14px;">Department</th>
                <th style="padding: 10px 14px; text-align: center; width: 100px;">Faculty Count</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Monthly Budget</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Disbursed</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Pending Balance</th>
                <th style="padding: 10px 14px; text-align: right; width: 120px;">Average Salary</th>
                <th style="padding: 10px 14px; text-align: center; width: 110px;">Payroll Share</th>
            </tr>
        `;

        const activeStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        const totalSchoolPayroll = activeStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);

        // Group by department
        const deptGroups = {};
        activeStaff.forEach(f => {
            const d = f.department || 'General';
            if (!deptGroups[d]) deptGroups[d] = [];
            deptGroups[d].push(f);
        });

        const sortedDepts = Object.keys(deptGroups).sort();

        let sumStaff = 0;
        let sumBudget = 0;
        let sumDisbursed = 0;
        let sumPending = 0;

        const rowsHtml = sortedDepts.map(deptName => {
            const staffList = deptGroups[deptName];
            const count = staffList.length;
            const budget = staffList.reduce((acc, f) => acc + (Number(f.salary || f.base_salary) || 0), 0);
            const staffIds = new Set(staffList.map(f => f.id));
            const staffEmpIds = new Set(staffList.map(f => f.employee_id));

            // Payments to this dept
            const deptPayments = currentReportPayments.filter(p => {
                const match = staffIds.has(p.faculty_id) || staffEmpIds.has(p.employee_id);
                if (!match) return false;
                if (month !== 'all') {
                    return p.payment_date && p.payment_date.startsWith(month);
                }
                return true;
            });

            const disbursed = deptPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
            const pending = Math.max(0, budget - disbursed);
            const avgSalary = count > 0 ? (budget / count) : 0;
            const sharePct = totalSchoolPayroll > 0 ? (budget / totalSchoolPayroll * 100).toFixed(1) : 0;

            sumStaff += count;
            sumBudget += budget;
            sumDisbursed += disbursed;
            sumPending += pending;

            const deptStyle = getDeptColor(deptName);

            return `
                <tr>
                    <td style="padding: 10px 14px;">
                        <span style="display: inline-block; padding: 3px 10px; border-radius: 6px; font-weight: 600; font-size: 12px; background: ${deptStyle.bg}; color: ${deptStyle.text}; border: 1px solid ${deptStyle.border};">
                            🏛️ ${escapeHtml(deptName)}
                        </span>
                    </td>
                    <td style="padding: 10px 14px; text-align: center; font-weight: 600;">${count}</td>
                    <td style="padding: 10px 14px; text-align: right; font-family: monospace;">${formatCurrency(budget)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #16a34a; font-family: monospace;">${formatCurrency(disbursed)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${pending > 0 ? '#b91c1c' : '#64748b'}; font-family: monospace;">${formatCurrency(pending)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-family: monospace; color: #475569;">${formatCurrency(avgSalary)}</td>
                    <td style="padding: 10px 14px; text-align: center; font-weight: 700; color: #0b2a4a;">${sharePct}%</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        tfoot.innerHTML = `
            <tr>
                <td style="padding: 12px 14px; font-size: 13px;">TOTAL (${sortedDepts.length} Departments):</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">${sumStaff}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace;">${formatCurrency(sumBudget)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #16a34a;">${formatCurrency(sumDisbursed)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #b91c1c;">${formatCurrency(sumPending)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace;">${formatCurrency(sumStaff > 0 ? sumBudget / sumStaff : 0)}</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">100%</td>
            </tr>
        `;

        updateReportKpis(sumStaff, sumBudget, sumDisbursed, sumPending);

        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing department breakdown across ${sortedDepts.length} departments`;
    }

    function updateReportKpis(staffCount, committed, disbursed, pending) {
        const staffEl = document.getElementById('reportKpiStaffCount');
        const commEl = document.getElementById('reportKpiCommitted');
        const disbEl = document.getElementById('reportKpiDisbursed');
        const pendEl = document.getElementById('reportKpiPending');
        const pendSub = document.getElementById('reportKpiPendingSub');

        if (staffEl) staffEl.textContent = staffCount;
        if (commEl) commEl.textContent = formatCurrency(committed);
        if (disbEl) disbEl.textContent = formatCurrency(disbursed);
        if (pendEl) pendEl.textContent = formatCurrency(pending);

        if (pendSub) {
            const pct = committed > 0 ? (disbursed / committed * 100).toFixed(1) : (disbursed > 0 ? 100 : 0);
            pendSub.textContent = `${pct}% fulfillment rate`;
        }
    }

    // ─── EXPORT REPORT TO CSV ───
    window.exportFacultyReportCSV = function() {
        const table = document.getElementById('facultyReportsTable');
        if (!table) return;

        const typeSelect = document.getElementById('facultyReportTypeSelect');
        const monthSelect = document.getElementById('facultyReportMonthSelect');
        const rType = typeSelect ? typeSelect.value : 'faculty-report';
        const rMonth = monthSelect ? monthSelect.value : 'all';

        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length <= 1) {
            if (window.showToast) window.showToast('No report data to export.', 'info');
            return;
        }

        let csv = '';
        rows.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('th, td')).map(cell => {
                let text = cell.innerText.replace(/\n+/g, ' ').trim();
                return `"${text.replace(/"/g, '""')}"`;
            });
            csv += cells.join(',') + '\n';
        });

        safeCsvDownload(csv, `${rType}_${rMonth}_${new Date().toISOString().slice(0, 10)}.csv`);
        if (window.showToast) window.showToast(`✅ Exported ${rType.replace('-', ' ')} to CSV.`, 'success');
    };

    // ─── PRINT REPORT WINDOW ───
    window.printFacultyReport = function() {
        const table = document.getElementById('facultyReportsTable');
        if (!table) return;

        const typeSelect = document.getElementById('facultyReportTypeSelect');
        const monthSelect = document.getElementById('facultyReportMonthSelect');
        const deptSelect = document.getElementById('facultyReportDeptSelect');

        const rTypeTitle = typeSelect ? typeSelect.options[typeSelect.selectedIndex].text : 'Faculty Salary Report';
        const rPeriod = monthSelect ? monthSelect.options[monthSelect.selectedIndex].text : 'All Time';
        const rDept = deptSelect ? deptSelect.options[deptSelect.selectedIndex].text : 'All Departments';

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            if (window.showToast) window.showToast('Unable to open print preview. Please allow popups.', 'error');
            return;
        }

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        const staffVal = document.getElementById('reportKpiStaffCount')?.textContent || '0';
        const commVal = document.getElementById('reportKpiCommitted')?.textContent || '₹0.00';
        const disbVal = document.getElementById('reportKpiDisbursed')?.textContent || '₹0.00';
        const pendVal = document.getElementById('reportKpiPending')?.textContent || '₹0.00';

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${escapeHtml(rTypeTitle)}</title>
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 28px; color: #1e293b; background: #fff; line-height: 1.4; }
                    .header { border-bottom: 2px solid #0b2a4a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
                    .header h1 { font-size: 22px; margin: 0; color: #0b2a4a; font-weight: 800; letter-spacing: 0.5px; }
                    .header p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
                    .meta-grid { display: flex; gap: 20px; margin-bottom: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
                    .meta-item { flex: 1; }
                    .meta-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 2px; }
                    .meta-val { font-size: 14px; font-weight: 700; color: #0b2a4a; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
                    th { background: #f1f5f9; color: #334155; font-weight: 700; }
                    tfoot td { background: #f8fafc; font-weight: 700; }
                    .footer-signatures { display: flex; justify-content: space-between; margin-top: 50px; padding-top: 20px; }
                    .sig-block { border-top: 1px solid #94a3b8; width: 220px; text-align: center; font-size: 12px; color: #475569; padding-top: 6px; }
                    @media print {
                        body { padding: 12px; }
                        button { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <h1>PRAGAMENT SCHOOL FINANCIAL LEDGER</h1>
                        <p>${escapeHtml(rTypeTitle)} • Academic Session 2026-2027</p>
                    </div>
                    <div style="text-align: right; font-size: 12px; color: #64748b;">
                        Generated: ${dateStr} ${timeStr}<br>
                        Scope: ${escapeHtml(rPeriod)} • ${escapeHtml(rDept)}
                    </div>
                </div>

                <div class="meta-grid">
                    <div class="meta-item">
                        <div class="meta-label">Staff Count</div>
                        <div class="meta-val">${escapeHtml(staffVal)}</div>
                    </div>
                    <div class="meta-item">
                        <div class="meta-label">Committed Payroll</div>
                        <div class="meta-val">${escapeHtml(commVal)}</div>
                    </div>
                    <div class="meta-item">
                        <div class="meta-label">Total Disbursed</div>
                        <div class="meta-val" style="color:#16a34a;">${escapeHtml(disbVal)}</div>
                    </div>
                    <div class="meta-item">
                        <div class="meta-label">Pending Balance</div>
                        <div class="meta-val" style="color:#dc2626;">${escapeHtml(pendVal)}</div>
                    </div>
                </div>

                ${table.outerHTML}

                <div class="footer-signatures">
                    <div class="sig-block">Prepared by (Accountant)</div>
                    <div class="sig-block">Audited &amp; Verified by</div>
                    <div class="sig-block">Approved by (Principal / Director)</div>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    };

    // ════════════════════════════════════════════════════════════════
    //  DASHBOARD INTEGRATION: PENDING SALARY & FACULTY EXPENSES
    // ════════════════════════════════════════════════════════════════

    window.navigateToFacultyTab = function(subtab = 'directory') {
        const facBtn = document.querySelector('button[data-tab="faculty"]');
        if (facBtn) facBtn.click();
        if (typeof window.switchFacultySubTab === 'function') {
            window.switchFacultySubTab(subtab);
        }
    };

    window.updateDashboardFacultyMetrics = async function(totalSchoolExpense = 0) {
        try {
            const facultyList = await window.DataService.getFaculty();
            const allPayments = await window.DataService.getAllFacultyPayments();

            const activeStaff = (facultyList || []).filter(f => f.status !== 'inactive');
            const committed = activeStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);

            const now = new Date();
            const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const nowMonthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

            const monthPayments = (allPayments || []).filter(p => p.payment_date && p.payment_date.startsWith(currentMonthStr));
            const disbursed = monthPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const pending = Math.max(0, committed - disbursed);

            let unpaidStaffCount = 0;
            activeStaff.forEach(f => {
                const paid = monthPayments
                    .filter(p => p.faculty_id === f.id || (p.employee_id && p.employee_id === f.employee_id))
                    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
                const base = Number(f.salary || f.base_salary) || 0;
                if (paid < base) unpaidStaffCount++;
            });

            // Update Dashboard DOM elements
            const commEl = document.getElementById('dashFacultyCommitted');
            const disbEl = document.getElementById('dashFacultyDisbursed');
            const pendEl = document.getElementById('dashFacultyPending');
            const staffCountEl = document.getElementById('dashFacultyStaffCount');
            const expShareEl = document.getElementById('dashFacultyExpenseShare');
            const fulfillEl = document.getElementById('dashFacultyFulfillmentRate');

            if (commEl) commEl.textContent = formatCurrency(committed);
            if (disbEl) disbEl.textContent = formatCurrency(disbursed);
            if (pendEl) pendEl.textContent = formatCurrency(pending);

            if (staffCountEl) staffCountEl.textContent = `${activeStaff.length} active staff members`;

            if (expShareEl) {
                if (totalSchoolExpense > 0 && disbursed > 0) {
                    const share = (disbursed / totalSchoolExpense * 100).toFixed(1);
                    expShareEl.textContent = `${share}% of school expenses`;
                } else {
                    expShareEl.textContent = `Disbursed for ${nowMonthName}`;
                }
            }

            if (fulfillEl) {
                const pct = committed > 0 ? (disbursed / committed * 100).toFixed(1) : (disbursed > 0 ? 100 : 0);
                fulfillEl.textContent = `${pct}% fulfilled (${unpaidStaffCount} pending)`;
            }

            // Pending Salary Callout Alert Banner
            const alertBanner = document.getElementById('dashPendingSalaryAlert');
            const alertTitle = document.getElementById('dashPendingAlertTitle');
            const alertText = document.getElementById('dashPendingAlertText');

            if (alertBanner) {
                if (pending > 0 && activeStaff.length > 0) {
                    alertBanner.style.display = 'flex';
                    if (alertTitle) alertTitle.textContent = `⏳ Pending Faculty Salary: ${formatCurrency(pending)} (${nowMonthName})`;
                    if (alertText) alertText.textContent = `${unpaidStaffCount} of ${activeStaff.length} faculty members have outstanding salary payments due for this month.`;
                } else {
                    alertBanner.style.display = 'none';
                }
            }
        } catch (err) {
            console.warn("Could not update dashboard faculty metrics:", err);
        }
    };

    // Auto-listen to tab navigation
    document.addEventListener('DOMContentLoaded', () => {
        const tabNav = document.getElementById('tabNav');
        if (tabNav) {
            tabNav.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (btn && btn.getAttribute('data-tab') === 'faculty') {
                    initFacultyTab();
                }
            });
        }
    });

})(window);
