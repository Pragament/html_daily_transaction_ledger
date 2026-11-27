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
            window.currentFacultyList = currentFacultyList;
            updateFacultyKPIs(currentFacultyList);
            populateDepartmentFilter(currentFacultyList);
            filterFacultyTable();
            if (typeof window.stitchFacultyToTransactions === 'function') {
                window.stitchFacultyToTransactions();
            }
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

    // --- Pay Salary / Faculty Expense ---

    function generateFacultyVoucherNo() {
        let maxSeq = 1000;
        const payments = Array.isArray(currentReportPayments) ? currentReportPayments : [];
        payments.forEach(p => {
            const m = String(p.voucher_number || '').match(/VCH-(\d+)/i);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n) && n >= maxSeq) maxSeq = n + 1;
            }
        });
        return `VCH-${maxSeq}`;
    }

    window.openPaySalaryModal = async function(id) {
        const faculty = currentFacultyList.find(f => f.id === id);
        if (!faculty) return;

        if (faculty.status === 'inactive') {
            if (window.showToast) {
                window.showToast(`⚠️ ${faculty.name} is marked Inactive. Re-activate before issuing payments.`, 'warning');
            }
        }

        const form = document.getElementById('paySalaryForm');
        if (form) form.reset();

        document.getElementById('paySalaryFacultyId').value = faculty.id;

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
                        <div style="font-weight: 700; font-size: 15px; color: #0b2a4a;">${escapeHtml(faculty.name)} ${faculty.status === 'inactive' ? '<span style="color:#b91c1c; font-size:11px;">(Inactive)</span>' : ''}</div>
                        <div style="font-size: 12px; color: #5e6f8a;">ID: ${escapeHtml(faculty.employee_id)} • ${escapeHtml(faculty.designation)} (${escapeHtml(faculty.department)})</div>
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

        const today = new Date().toISOString().split('T')[0];
        const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        const dateEl = document.getElementById('paySalaryDate');
        if (dateEl) dateEl.value = today;

        const voucherEl = document.getElementById('paySalaryVoucher');
        if (voucherEl) voucherEl.value = generateFacultyVoucherNo();

        const monthEl = document.getElementById('paySalaryMonth');
        if (monthEl) monthEl.value = currentMonth;

        if (faculty.base_salary) {
            document.getElementById('paySalaryAmount').value = faculty.base_salary;
        }

        const remarksInput = document.getElementById('paySalaryRemarks');
        if (remarksInput) {
            remarksInput.value = `Salary disbursement for ${currentMonth}`;
        }

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
        const methodEl = document.getElementById('paySalaryMethod');
        const method = methodEl ? methodEl.value.toLowerCase() : 'cash';
        const bankGrp = document.getElementById('paySalaryBankGrp');
        if (!bankGrp) return;
        if (method === 'bank_transfer' || method === 'bank' || method === 'cheque' || method === 'upi' || method === 'other') {
            bankGrp.style.display = 'block';
            const label = bankGrp.querySelector('label');
            if (label) {
                label.textContent = method === 'upi'
                    ? 'UPI Transaction ID / Ref'
                    : (method === 'cheque' ? 'Cheque Number' : (method === 'other' ? 'Reference / Note' : 'Bank Reference / UTR'));
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

        const facultyId = document.getElementById('paySalaryFacultyId').value;
        const faculty = currentFacultyList.find(f => f.id === facultyId);
        if (!faculty) {
            if (window.showToast) window.showToast('Selected faculty member not found.', 'error');
            return;
        }
        if (faculty.status === 'inactive') {
            if (window.showToast) window.showToast('Cannot record payment for an inactive faculty member.', 'error');
            return;
        }

        const catSelect = document.getElementById('paySalaryCategory');
        const selectedCatText = catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0]
            ? catSelect.selectedOptions[0].textContent : 'Salary';
        const voucherVal = document.getElementById('paySalaryVoucher') ? document.getElementById('paySalaryVoucher').value.trim() : '';
        const salaryMonthVal = document.getElementById('paySalaryMonth') ? document.getElementById('paySalaryMonth').value.trim() : '';
        const methodVal = document.getElementById('paySalaryMethod').value || 'cash';
        const refVal = document.getElementById('paySalaryRef') ? document.getElementById('paySalaryRef').value.trim() : '';
        const remarksVal = document.getElementById('paySalaryRemarks') ? document.getElementById('paySalaryRemarks').value.trim() : '';
        const amountVal = parseFloat(document.getElementById('paySalaryAmount').value);

        if (!voucherVal) {
            if (window.showToast) window.showToast('Voucher number is required.', 'error');
            return;
        }
        if (isNaN(amountVal) || amountVal <= 0) {
            if (window.showToast) window.showToast('Please enter a valid payment amount greater than zero.', 'error');
            return;
        }
        if ((methodVal === 'bank_transfer' || methodVal === 'cheque' || methodVal === 'upi') && !refVal) {
            if (window.showToast) window.showToast('Transaction / Cheque / UPI reference number is required for non-cash mode.', 'error');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px;"></span> Processing...';
        }

        const payload = {
            faculty_id: facultyId,
            faculty_name: faculty.name || faculty.faculty_name || '',
            employee_id: faculty.employee_id || '',
            department: faculty.department || '',
            designation: faculty.designation || '',
            payment_date: document.getElementById('paySalaryDate').value,
            amount: amountVal,
            expense_category_id: catSelect && catSelect.value ? parseInt(catSelect.value, 10) : null,
            expense_category_name: selectedCatText,
            payment_method: methodVal,
            payment_mode: methodVal,
            voucher_number: voucherVal,
            salary_month: salaryMonthVal || null,
            reference: refVal || null,
            reference_number: refVal || null,
            remarks: remarksVal || `${selectedCatText} — ${faculty.name} (${faculty.employee_id})`,
            particulars: `${selectedCatText} - ${faculty.name} (${faculty.employee_id})`
        };

        try {
            await window.DataService.payFacultySalary(payload);
            if (window.showToast) {
                window.showToast(`✅ ${selectedCatText} disbursement (${voucherVal}) recorded for ${faculty.name}!`, "success");
            }
            hidePaySalaryModal();
            if (typeof window.syncAllFromSupabase === 'function') {
                await window.syncAllFromSupabase();
            } else if (typeof window.loadDataFromSupabase === 'function') {
                await window.loadDataFromSupabase();
            }
            if (typeof window.stitchFacultyToTransactions === 'function') {
                window.stitchFacultyToTransactions();
            }
            if (typeof window.renderTransactions === 'function') {
                window.renderTransactions();
            }
            if (typeof window.renderExpenseList === 'function') {
                window.renderExpenseList();
            }
            if (typeof window.refreshDashboard === 'function') {
                window.refreshDashboard();
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
                window.showToast("❌ Error recording payment: " + (e.message || e), "error");
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = oldText;
            }
        }
    };

    // --- Tabbed Faculty Payment History, Financial Summary & Profile ---

    function classifyFacultyCategory(catName) {
        const lower = (catName || 'salary').toLowerCase().trim();
        if (lower === 'salary') return 'salary';
        if (lower === 'advance salary' || lower === 'advance') return 'advances';
        return 'other';
    }

    window.openFacultyHistoryModal = async function(id) {
        if (!currentFacultyList || currentFacultyList.length === 0) {
            try {
                const raw = localStorage.getItem('school_accountant_faculty');
                if (raw) currentFacultyList = JSON.parse(raw);
            } catch (e) {}
        }
        if (!currentFacultyList || currentFacultyList.length === 0) {
            try {
                currentFacultyList = await window.DataService.getFaculty();
            } catch (e) {}
        }
        const faculty = (currentFacultyList || []).find(f => f.id === id || f.employee_id === id);
        if (!faculty) return;

        window._activeFacultyHistoryState = {
            faculty,
            history: [],
            activeTab: 'all',
            filtered: []
        };

        document.getElementById('facultyHistoryTitle').innerText = `📜 Financial Ledger: ${faculty.name}`;

        const summaryCard = document.getElementById('facultyHistorySummary');
        if (summaryCard) {
            summaryCard.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:#f8fafc; border:1px solid #e2e8f0; padding:12px 16px; border-radius:12px;">
                    <div>
                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(faculty.name)} <span style="font-family:monospace; color:#1e40af;">(${escapeHtml(faculty.employee_id || '')})</span></div>
                        <div style="font-size:12px; color:#64748b;">${escapeHtml(faculty.department || '')} • ${escapeHtml(faculty.designation || '')} • Base Salary: ${formatCurrency(faculty.base_salary || faculty.salary || 0)}</div>
                    </div>
                    <div style="display:flex; gap:14px; flex-wrap:wrap; text-align:right;">
                        <div><div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Salary Paid</div><div id="fHistSumSalary" style="font-size:14px; font-weight:700; color:#0f7b3a;">₹0.00</div></div>
                        <div><div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Advances</div><div id="fHistSumAdvance" style="font-size:14px; font-weight:700; color:#b45309;">₹0.00</div></div>
                        <div><div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Other Expenses</div><div id="fHistSumOther" style="font-size:14px; font-weight:700; color:#1e40af;">₹0.00</div></div>
                        <div><div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Grand Total</div><div id="historyTotalDisbursed" style="font-size:14px; font-weight:700; color:#b91c1c;">Loading...</div></div>
                    </div>
                </div>
            `;
        }

        const catFilter = document.getElementById('fHistCategoryFilter');
        if (catFilter) {
            let opts = ['Salary', 'Advance Salary', 'Bonus', 'Incentives', 'Travel Expense', 'Reimbursements', 'Gifts / Goodies', 'Training / Workshop Expenses', 'Other Faculty Expenses'];
            try {
                if (window.DataService && typeof window.DataService.getFacultyExpenseCategories === 'function') {
                    const cats = await window.DataService.getFacultyExpenseCategories({ includeInactive: false });
                    if (Array.isArray(cats) && cats.length > 0) {
                        opts = cats.map(c => c.name);
                    }
                }
            } catch (e) {}
            catFilter.innerHTML = '<option value="all">All Categories</option>' + opts.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
            catFilter.value = 'all';
        }
        if (document.getElementById('fHistDateFrom')) document.getElementById('fHistDateFrom').value = '';
        if (document.getElementById('fHistDateTo')) document.getElementById('fHistDateTo').value = '';
        if (document.getElementById('fHistModeFilter')) document.getElementById('fHistModeFilter').value = 'all';

        const tbody = document.getElementById('facultyHistoryBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#64748b;">⏳ Loading payment history...</td></tr>';
        document.getElementById('facultyHistoryModal').style.display = 'flex';
        switchFacultyHistoryTab('all');

        try {
            const history = await window.DataService.getFacultySalaryHistory(faculty.id);
            window._activeFacultyHistoryState.history = Array.isArray(history) ? history : [];

            let salSum = 0, advSum = 0, othSum = 0;
            window._activeFacultyHistoryState.history.forEach(h => {
                const amt = parseFloat(h.transactions ? h.transactions.amount : h.amount) || 0;
                const bucket = classifyFacultyCategory(h.expense_category);
                if (bucket === 'salary') salSum += amt;
                else if (bucket === 'advances') advSum += amt;
                else othSum += amt;
            });

            if (document.getElementById('fHistSumSalary')) document.getElementById('fHistSumSalary').textContent = formatCurrency(salSum);
            if (document.getElementById('fHistSumAdvance')) document.getElementById('fHistSumAdvance').textContent = formatCurrency(advSum);
            if (document.getElementById('fHistSumOther')) document.getElementById('fHistSumOther').textContent = formatCurrency(othSum);
            if (document.getElementById('historyTotalDisbursed')) document.getElementById('historyTotalDisbursed').textContent = formatCurrency(salSum + advSum + othSum);

            renderFacultyHistoryView();
        } catch (e) {
            console.error("Error loading faculty history:", e);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:28px; color:#b91c1c;">❌ Failed to load history from Supabase: ${escapeHtml(e.message || String(e))}</td></tr>`;
            }
        }
    };

    window.switchFacultyHistoryTab = function(tabName) {
        if (window._activeFacultyHistoryState) {
            window._activeFacultyHistoryState.activeTab = tabName;
        }
        document.querySelectorAll('#facultyHistoryTabs .sub-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fhistTab === tabName);
        });
        const isDetail = tabName === 'summary' || tabName === 'profile';
        const filterBar = document.getElementById('facultyHistoryFiltersBar');
        const tablePanel = document.getElementById('facultyHistoryTablePanel');
        const detailPanel = document.getElementById('facultyHistoryDetailPanel');
        if (filterBar) filterBar.style.display = isDetail ? 'none' : 'flex';
        if (tablePanel) tablePanel.style.display = isDetail ? 'none' : 'block';
        if (detailPanel) detailPanel.style.display = isDetail ? 'block' : 'none';
        renderFacultyHistoryView();
    };

    window.resetFacultyHistoryFilters = function() {
        if (document.getElementById('fHistDateFrom')) document.getElementById('fHistDateFrom').value = '';
        if (document.getElementById('fHistDateTo')) document.getElementById('fHistDateTo').value = '';
        if (document.getElementById('fHistCategoryFilter')) document.getElementById('fHistCategoryFilter').value = 'all';
        if (document.getElementById('fHistModeFilter')) document.getElementById('fHistModeFilter').value = 'all';
        renderFacultyHistoryView();
    };

    window.renderFacultyHistoryView = function() {
        const state = window._activeFacultyHistoryState;
        if (!state) return;
        const { faculty, history, activeTab } = state;

        if (activeTab === 'profile') {
            const detail = document.getElementById('facultyHistoryDetailPanel');
            if (!detail) return;
            detail.innerHTML = `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Full Name</div><div style="font-weight:700; color:#0b2a4a;">${escapeHtml(faculty.name)}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Employee ID</div><div style="font-family:monospace; font-weight:700;">${escapeHtml(faculty.employee_id || '—')}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Department &amp; Designation</div><div>${escapeHtml(faculty.department || '—')} / ${escapeHtml(faculty.designation || '—')}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Base Salary</div><div style="font-weight:700; color:#0f7b3a;">${formatCurrency(faculty.base_salary || faculty.salary || 0)}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Phone</div><div>${escapeHtml(faculty.phone || '—')}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Email</div><div>${escapeHtml(faculty.email || '—')}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Joining Date</div><div>${escapeHtml(faculty.joining_date || '—')}</div></div>
                    <div><div style="font-size:11px; color:#64748b; text-transform:uppercase;">Status</div><div><span class="badge-status ${faculty.status === 'inactive' ? 'pending' : 'paid'}">${escapeHtml((faculty.status || 'active').toUpperCase())}</span></div></div>
                </div>
            `;
            return;
        }

        if (activeTab === 'summary') {
            const detail = document.getElementById('facultyHistoryDetailPanel');
            if (!detail) return;
            const byCat = {};
            const nowPrefix = new Date().toISOString().slice(0, 7);
            let curMonthSal = 0;
            history.forEach(h => {
                const cat = h.expense_category || 'Salary';
                const amt = parseFloat(h.transactions ? h.transactions.amount : h.amount) || 0;
                byCat[cat] = (byCat[cat] || 0) + amt;
                const dt = (h.transactions && h.transactions.date) || h.payment_date || '';
                if (cat.toLowerCase() === 'salary' && dt.startsWith(nowPrefix)) curMonthSal += amt;
            });
            const base = Number(faculty.base_salary || faculty.salary) || 0;
            const curPendingSal = Math.max(0, base - curMonthSal);
            const catCards = Object.keys(byCat).length === 0
                ? '<div class="text-muted">No disbursements recorded yet.</div>'
                : Object.keys(byCat).sort().map(c => `
                    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px;">
                        <div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase;">${escapeHtml(c)}</div>
                        <div style="font-size:16px; font-weight:700; color:#0b2a4a; margin-top:4px;">${formatCurrency(byCat[c])}</div>
                    </div>
                `).join('');
            detail.innerHTML = `
                <div style="margin-bottom:14px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:14px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                    <div><b>Current Month (${nowPrefix}) Base Salary:</b> ${formatCurrency(base)}</div>
                    <div><b>Salary Paid (Excludes Advances/Expenses):</b> <span style="color:#0f7b3a; font-weight:700;">${formatCurrency(curMonthSal)}</span></div>
                    <div><b>Salary Balance Remaining:</b> <span style="color:${curPendingSal > 0 ? '#b91c1c' : '#0f7b3a'}; font-weight:700;">${formatCurrency(curPendingSal)}</span></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px;">
                    ${catCards}
                </div>
            `;
            return;
        }

        const from = document.getElementById('fHistDateFrom')?.value || '';
        const to = document.getElementById('fHistDateTo')?.value || '';
        const catF = document.getElementById('fHistCategoryFilter')?.value || 'all';
        const modeF = document.getElementById('fHistModeFilter')?.value || 'all';

        const filtered = history.filter(r => {
            const cat = r.expense_category || 'Salary';
            const bucket = classifyFacultyCategory(cat);
            if (activeTab === 'salary' && bucket !== 'salary') return false;
            if (activeTab === 'advances' && bucket !== 'advances') return false;
            if (activeTab === 'other' && bucket !== 'other') return false;

            const txData = r.transactions || {};
            const dt = txData.date || r.payment_date || '';
            const mode = (r.payment_mode || 'cash').toLowerCase();
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            if (catF !== 'all' && cat.toLowerCase() !== catF.toLowerCase()) return false;
            if (modeF !== 'all' && mode !== modeF.toLowerCase()) return false;
            return true;
        });
        state.filtered = filtered;

        const tbody = document.getElementById('facultyHistoryBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:#64748b;">No disbursement records match the active tab/filters.</td></tr>`;
            return;
        }

        filtered.forEach(record => {
            const txData = record.transactions || {};
            const dt = txData.date || record.payment_date || '-';
            const dateStr = dt !== '-' ? new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
            const amountVal = parseFloat(txData.amount !== undefined ? txData.amount : record.amount) || 0;
            const modeLabel = (record.payment_mode || 'cash').replace(/_/g, ' ').toUpperCase();
            const partText = record.remarks || record.particulars || txData.particulars || '—';
            const refText = record.reference_number ? ` • Ref: ${record.reference_number}` : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:10px 12px; font-size:13px;">${escapeHtml(dateStr)}</td>
                <td style="padding:10px 12px; font-family:monospace; font-size:12px;">${escapeHtml(record.voucher_number || '—')}</td>
                <td style="padding:10px 12px;"><span class="badge-status partial">${escapeHtml(record.expense_category || 'Salary')}</span></td>
                <td style="padding:10px 12px; font-size:12px; color:#475569;">${escapeHtml(partText + refText)}</td>
                <td style="padding:10px 12px; font-weight:700; color:#b91c1c; text-align:right; font-family:monospace;">${formatCurrency(amountVal)}</td>
                <td style="padding:10px 12px; font-size:12px;">${escapeHtml(modeLabel)}</td>
                <td style="padding:10px 12px; text-align:center; white-space:nowrap;">
                    <button type="button" class="btn btn-outline btn-xs btn-fh-voucher" title="Print Voucher">🖨️</button>
                    ${record.transaction_id ? `<button type="button" class="btn btn-outline btn-xs btn-fh-tx" style="margin-left:4px;" title="Open in Transactions Ledger">Ledger</button>` : ''}
                </td>
            `;
            tr.querySelector('.btn-fh-voucher')?.addEventListener('click', () => printFacultyVoucher(faculty, record, amountVal, dt));
            tr.querySelector('.btn-fh-tx')?.addEventListener('click', () => {
                hideFacultyHistoryModal();
                const txBtn = document.querySelector('#tabNav button[data-tab="transactions"]');
                if (txBtn) txBtn.click();
                const txFacEl = document.getElementById('txFilterFaculty');
                if (txFacEl) {
                    txFacEl.value = faculty.id;
                    if (typeof window.renderTransactions === 'function') window.renderTransactions();
                }
            });
            tbody.appendChild(tr);
        });
    };

    function printFacultyVoucher(faculty, record, amountVal, dateVal) {
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
            <html><head><title>Payment Voucher ${escapeHtml(record.voucher_number || '')}</title>
            <style>body{font-family:'Segoe UI',sans-serif;padding:28px;color:#0f172a}.box{border:2px solid #0b2a4a;border-radius:10px;padding:20px;max-width:680px;margin:auto}h2{margin:0 0 8px;color:#0b2a4a}.row{display:flex;justify-content:space-between;margin:8px 0;font-size:14px;border-bottom:1px dashed #cbd5e1;padding-bottom:6px}</style>
            </head><body onload="window.print()">
            <div class="box">
                <h2>FACULTY EXPENSE / SALARY VOUCHER</h2>
                <div class="row"><span><b>Voucher No:</b> ${escapeHtml(record.voucher_number || '—')}</span><span><b>Date:</b> ${escapeHtml(dateVal)}</span></div>
                <div class="row"><span><b>Payee:</b> ${escapeHtml(faculty.name)} (${escapeHtml(faculty.employee_id || '')})</span><span><b>Department:</b> ${escapeHtml(faculty.department || '')}</span></div>
                <div class="row"><span><b>Category:</b> ${escapeHtml(record.expense_category || 'Salary')}</span><span><b>Mode:</b> ${escapeHtml((record.payment_mode || 'cash').toUpperCase())} ${record.reference_number ? '(' + escapeHtml(record.reference_number) + ')' : ''}</span></div>
                <div class="row"><span><b>Particulars / Month:</b> ${escapeHtml(record.remarks || record.salary_month || '—')}</span></div>
                <div class="row" style="font-size:18px;font-weight:700;color:#0b2a4a;border:none;"><span>Total Amount Paid</span><span>${formatCurrency(amountVal)}</span></div>
                <div style="display:flex;justify-content:space-between;margin-top:42px;font-size:12px;"><span>Receiver Signature</span><span>Accountant / Principal</span></div>
            </div>
            </body></html>
        `);
        win.document.close();
    }

    window.exportFacultyHistoryCSV = function() {
        const state = window._activeFacultyHistoryState;
        if (!state || !state.faculty) return;
        const rows = state.filtered && state.filtered.length > 0 ? state.filtered : state.history;
        const csvRows = [['Date', 'Voucher', 'Category', 'Mode', 'Reference', 'Amount', 'Remarks']];
        rows.forEach(r => {
            const txData = r.transactions || {};
            const dt = txData.date || r.payment_date || '';
            const amt = parseFloat(txData.amount !== undefined ? txData.amount : r.amount) || 0;
            csvRows.push([dt, r.voucher_number || '', r.expense_category || 'Salary', r.payment_mode || '', r.reference_number || '', amt.toFixed(2), r.remarks || '']);
        });
        const csv = csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        safeCsvDownload(csv, `faculty_history_${state.faculty.employee_id || 'staff'}.csv`);
    };

    window.printFacultyHistory = function() {
        const state = window._activeFacultyHistoryState;
        if (!state || !state.faculty) return;
        const tbl = document.getElementById('facultyHistoryBody')?.closest('table')?.outerHTML || '';
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
            <html><head><title>Faculty History - ${escapeHtml(state.faculty.name)}</title>
            <style>body{font-family:'Segoe UI',sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}</style>
            </head><body onload="window.print()">
            <h2>Faculty Payment History — ${escapeHtml(state.faculty.name)} (${escapeHtml(state.faculty.employee_id || '')})</h2>
            ${tbl}
            </body></html>
        `);
        win.document.close();
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
        populateReportFacultyPersons();
        await renderFacultyReports();
    };

    function populateReportFacultyPersons() {
        const sel = document.getElementById('facultyReportPersonSelect');
        if (!sel) return;
        const cur = sel.value;
        const sorted = [...currentFacultyList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        sel.innerHTML = '<option value="">Select Faculty Member...</option>' +
            sorted.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${escapeHtml(f.employee_id || '')})</option>`).join('');
        if (cur && sorted.some(f => f.id === cur)) sel.value = cur;
    }

    function populateReportMonths() {
        const select = document.getElementById('facultyReportMonthSelect');
        if (!select) return;

        const currentVal = select.value;
        const now = new Date();
        const monthsList = [];

        for (let i = 0; i < 18; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            monthsList.push({ val, label });
        }

        let html = monthsList.map(m => `<option value="${m.val}">${m.label}</option>`).join('');
        html += `<option value="all">Full Year / All Time</option>`;
        select.innerHTML = html;

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

    function isSalaryPayment(p) {
        return ((p.expense_category || 'Salary').toLowerCase().trim() === 'salary');
    }

    // Render active report
    window.renderFacultyReports = async function() {
        const typeSelect = document.getElementById('facultyReportTypeSelect');
        const monthSelect = document.getElementById('facultyReportMonthSelect');
        const deptSelect = document.getElementById('facultyReportDeptSelect');
        const statusSelect = document.getElementById('facultyReportStatusSelect');
        const personSelect = document.getElementById('facultyReportPersonSelect');

        const monthGroup = document.getElementById('facultyReportMonthGroup');
        const deptGroup = document.getElementById('facultyReportDeptGroup');
        const statusGroup = document.getElementById('facultyReportStatusGroup');
        const personGroup = document.getElementById('facultyReportPersonGroup');

        const rType = typeSelect ? typeSelect.value : 'salary-register';
        const selectedMonth = monthSelect ? monthSelect.value : 'all';
        const selectedDept = deptSelect ? deptSelect.value : 'all';
        const selectedStatus = statusSelect ? statusSelect.value : 'all';
        const selectedPersonId = personSelect ? personSelect.value : '';

        if (personGroup) personGroup.style.display = rType === 'individual-history' ? 'block' : 'none';
        if (monthGroup) monthGroup.style.display = rType === 'monthly-summary' ? 'none' : 'block';
        if (deptGroup) deptGroup.style.display = (rType === 'dept-summary' || rType === 'individual-history') ? 'none' : 'block';
        if (statusGroup) statusGroup.style.display = rType === 'salary-register' ? 'block' : 'none';

        const tbody = document.getElementById('facultyReportsTableBody');
        const thead = document.getElementById('facultyReportsTableHead');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: #64748b;">⏳ Generating ${escapeHtml(rType.replace(/-/g, ' '))}...</td></tr>`;
        }
        if (tfoot) tfoot.innerHTML = '';

        try {
            if (!currentFacultyList || currentFacultyList.length === 0) {
                const fl = await window.DataService.getFaculty();
                if (Array.isArray(fl)) {
                    currentFacultyList = fl;
                    window.currentFacultyList = fl;
                }
            }
            currentReportPayments = await window.DataService.getAllFacultyPayments();
            if (!Array.isArray(currentReportPayments)) currentReportPayments = [];

            if (rType === 'salary-register') {
                renderSalaryRegisterReport(selectedMonth, selectedDept, selectedStatus);
            } else if (rType === 'monthly-summary') {
                renderMonthlySummaryReport(selectedDept);
            } else if (rType === 'dept-summary') {
                renderDeptSummaryReport(selectedMonth);
            } else if (rType === 'faculty-total') {
                renderFacultyTotalExpensesReport(selectedMonth, selectedDept);
            } else if (rType === 'category-summary') {
                renderFacultyCategorySummaryReport(selectedMonth, selectedDept);
            } else if (rType === 'travel-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['travel expense'], 'Travel Expense Report');
            } else if (rType === 'reimbursement-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['reimbursements', 'reimbursement'], 'Reimbursements Report');
            } else if (rType === 'bonus-incentive-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['bonus', 'incentives', 'incentive'], 'Bonus & Incentives Report');
            } else if (rType === 'advance-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['advance salary', 'advance'], 'Advance Salary Report');
            } else if (rType === 'gifts-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['gifts / goodies', 'gifts', 'goodies'], 'Gifts / Goodies Report');
            } else if (rType === 'training-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['training / workshop expenses', 'training'], 'Training / Workshop Expenses Report');
            } else if (rType === 'other-faculty-report') {
                renderCategoryExpenseReport(selectedMonth, selectedDept, ['other faculty expenses', 'other'], 'Other Faculty Expenses Report');
            } else if (rType === 'salary-vs-nonsalary') {
                renderSalaryVsNonSalaryReport(selectedMonth, selectedDept);
            } else if (rType === 'individual-history') {
                renderIndividualHistoryReport(selectedPersonId, selectedMonth);
            }
        } catch (e) {
            console.error("Error rendering faculty report:", e);
            if (thead) thead.innerHTML = '';
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: #b91c1c;">❌ Database error loading report: ${escapeHtml(e.message || String(e))}</td></tr>`;
            }
            const countEl = document.getElementById('facultyReportTableCount');
            if (countEl) countEl.textContent = 'Report error';
        }
    };

    // ─── REPORT 1: SALARY REGISTER (STRICTLY SALARY ONLY) ───
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
                <th style="padding: 10px 14px; text-align: right; width: 115px;">Salary Paid</th>
                <th style="padding: 10px 14px; text-align: right; width: 115px;">Pending</th>
                <th style="padding: 10px 14px; text-align: center; width: 100px;">Status</th>
                <th style="padding: 10px 14px; width: 160px;">Last Salary Voucher</th>
                <th style="padding: 10px 14px; text-align: center; width: 95px;">Action</th>
            </tr>
        `;

        let activeStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        if (dept !== 'all') {
            activeStaff = activeStaff.filter(f => f.department === dept);
        }

        let totalCommitted = 0, totalDisbursed = 0, totalPending = 0, displayedRows = 0;

        const rowsHtml = activeStaff.map(faculty => {
            const baseSalary = faculty.salary !== undefined ? Number(faculty.salary) : (Number(faculty.base_salary) || 0);
            const staffPayments = currentReportPayments.filter(p => {
                if (!isSalaryPayment(p)) return false;
                const matchId = (p.faculty_id === faculty.id || (p.employee_id && p.employee_id === faculty.employee_id));
                if (!matchId) return false;
                if (month !== 'all') return p.payment_date && p.payment_date.startsWith(month);
                return true;
            });

            const disbursed = staffPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const pending = Math.max(0, baseSalary - disbursed);

            let rowStatus = 'unpaid';
            if (disbursed >= baseSalary && baseSalary > 0) rowStatus = 'paid';
            else if (disbursed > 0) rowStatus = 'partial';
            if (statusFilter !== 'all' && rowStatus !== statusFilter) return '';

            totalCommitted += baseSalary;
            totalDisbursed += disbursed;
            totalPending += pending;
            displayedRows++;

            const statusBadge = rowStatus === 'paid'
                ? '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;">🟢 Paid</span>'
                : (rowStatus === 'partial'
                    ? '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">🟡 Partial</span>'
                    : '<span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;">🔴 Unpaid</span>');

            let lastPayText = '<span style="color: #94a3b8; font-size: 11px;">No salary vouchers</span>';
            if (staffPayments.length > 0) {
                const last = staffPayments[0];
                const dtStr = last.payment_date ? new Date(last.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-';
                lastPayText = `
                    <div style="font-size: 12px; font-weight: 600; color: #1e293b;">${dtStr} (${escapeHtml(last.payment_mode || 'Cash')})</div>
                    <div style="font-size: 11px; color: #64748b;">${escapeHtml(last.voucher_number || 'Salary')}</div>
                `;
            }

            const initials = getInitials(faculty.name);
            const avatarBg = getAvatarColor(faculty.name);

            return `
                <tr>
                    <td style="padding: 10px 14px; font-weight: 700; font-family: monospace; color: #0b2a4a;">${escapeHtml(faculty.employee_id || '-')}</td>
                    <td style="padding: 10px 14px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 28px; height: 28px; border-radius: 50%; background: ${avatarBg}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0;">${initials}</div>
                            <a href="#" onclick="openFacultyHistoryModal('${faculty.id}'); return false;" style="font-weight: 600; color: #1e293b; text-decoration:none;">${escapeHtml(faculty.name)}</a>
                        </div>
                    </td>
                    <td style="padding: 10px 14px; font-size: 12px; color: #475569;">
                        <div><b>${escapeHtml(faculty.department)}</b></div>
                        <div style="color: #64748b; font-size: 11px;">${escapeHtml(faculty.designation)}</div>
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 600; font-family: monospace;">${formatCurrency(baseSalary)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #16a34a; font-family: monospace;">${formatCurrency(disbursed)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${pending > 0 ? '#b91c1c' : '#64748b'}; font-family: monospace;">${formatCurrency(pending)}</td>
                    <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 10px 14px;">${lastPayText}</td>
                    <td style="padding: 10px 14px; text-align: center;">
                        ${pending > 0 ? `<button class="btn btn-outline btn-sm" onclick="openPaySalaryModal('${faculty.id}')" style="padding: 3px 8px; font-size: 11px; color: #0284c7; border-color: #bae6fd;">Pay</button>` : `<span style="color: #10b981; font-size: 13px;">✔</span>`}
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = displayedRows === 0
            ? `<tr><td colspan="9" style="text-align: center; padding: 36px; color: #64748b;">No faculty records match the selected filters.</td></tr>`
            : rowsHtml;

        tfoot.innerHTML = `
            <tr>
                <td colspan="3" style="padding: 12px 14px; text-align: right; font-size: 13px;">SALARY TOTALS (${displayedRows} Staff):</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #0b2a4a; font-size: 13px;">${formatCurrency(totalCommitted)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #16a34a; font-size: 13px;">${formatCurrency(totalDisbursed)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #b91c1c; font-size: 13px;">${formatCurrency(totalPending)}</td>
                <td colspan="3" style="padding: 12px 14px; text-align: left; font-size: 12px; color: #475569;">
                    Salary Payout Rate: <b>${totalCommitted > 0 ? (totalDisbursed / totalCommitted * 100).toFixed(1) : 0}%</b>
                </td>
            </tr>
        `;
        updateReportKpis(displayedRows, totalCommitted, totalDisbursed, totalPending);
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing ${displayedRows} staff salary records (excludes non-salary expenses)`;
    }

    // ─── REPORT 2: MONTHLY SALARY SUMMARY (STRICTLY SALARY ONLY) ───
    function renderMonthlySummaryReport(deptFilter) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 10px 14px;">Month &amp; Year</th>
                <th style="padding: 10px 14px; text-align: center; width: 110px;">Staff in Scope</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Base Payroll</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Salary Disbursed</th>
                <th style="padding: 10px 14px; text-align: right; width: 140px;">Pending Balance</th>
                <th style="padding: 10px 14px; text-align: center; width: 130px;">Disbursement %</th>
                <th style="padding: 10px 14px; text-align: center; width: 110px;">Vouchers</th>
            </tr>
        `;

        let scopedStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        if (deptFilter !== 'all') scopedStaff = scopedStaff.filter(f => f.department === deptFilter);
        const monthlyStaffCommitment = scopedStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);

        const salaryPayments = currentReportPayments.filter(isSalaryPayment);
        const monthSet = new Set();
        salaryPayments.forEach(p => {
            if (p.payment_date && p.payment_date.length >= 7) monthSet.add(p.payment_date.slice(0, 7));
        });
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const sortedMonths = Array.from(monthSet).sort().reverse();

        let sumDisbursed = 0, sumCommitted = 0, sumPending = 0, totalVouchers = 0;
        const rowsHtml = sortedMonths.map(mStr => {
            const [y, m] = mStr.split('-');
            const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            const mPayments = salaryPayments.filter(p => {
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
                    <td style="padding: 10px 14px; text-align: center;"><span class="badge-status ${Number(pct) >= 100 ? 'paid' : (Number(pct) > 0 ? 'partial' : 'pending')}">${pct}%</span></td>
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
        if (countEl) countEl.textContent = `Showing monthly Salary summary across ${sortedMonths.length} cycles`;
    }

    // ─── REPORT 3: DEPARTMENT-WISE SUMMARY (SALARY vs NON-SALARY) ───
    function renderDeptSummaryReport(month) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 10px 14px;">Department</th>
                <th style="padding: 10px 14px; text-align: center;">Staff</th>
                <th style="padding: 10px 14px; text-align: right;">Payroll Budget</th>
                <th style="padding: 10px 14px; text-align: right;">Salary Paid</th>
                <th style="padding: 10px 14px; text-align: right;">Non-Salary Expenses</th>
                <th style="padding: 10px 14px; text-align: right;">Total Disbursed</th>
                <th style="padding: 10px 14px; text-align: right;">Pending Salary</th>
                <th style="padding: 10px 14px; text-align: center;">Payroll Share</th>
            </tr>
        `;

        const activeStaff = currentFacultyList.filter(f => f.status !== 'inactive');
        const totalSchoolPayroll = activeStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);
        const deptGroups = {};
        activeStaff.forEach(f => {
            const d = f.department || 'General';
            if (!deptGroups[d]) deptGroups[d] = [];
            deptGroups[d].push(f);
        });
        const sortedDepts = Object.keys(deptGroups).sort();

        let sumStaff = 0, sumBudget = 0, sumSalary = 0, sumOther = 0, sumPending = 0;

        const rowsHtml = sortedDepts.map(deptName => {
            const staffList = deptGroups[deptName];
            const count = staffList.length;
            const budget = staffList.reduce((acc, f) => acc + (Number(f.salary || f.base_salary) || 0), 0);
            const staffIds = new Set(staffList.map(f => f.id));
            const staffEmpIds = new Set(staffList.map(f => f.employee_id));

            const deptPayments = currentReportPayments.filter(p => {
                if (!(staffIds.has(p.faculty_id) || staffEmpIds.has(p.employee_id))) return false;
                return month === 'all' || (p.payment_date && p.payment_date.startsWith(month));
            });

            const salPaid = deptPayments.filter(isSalaryPayment).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
            const otherPaid = deptPayments.filter(p => !isSalaryPayment(p)).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
            const pending = Math.max(0, budget - salPaid);
            const sharePct = totalSchoolPayroll > 0 ? (budget / totalSchoolPayroll * 100).toFixed(1) : 0;

            sumStaff += count; sumBudget += budget; sumSalary += salPaid; sumOther += otherPaid; sumPending += pending;
            const deptStyle = getDeptColor(deptName);

            return `
                <tr>
                    <td style="padding: 10px 14px;"><span style="display:inline-block; padding:3px 10px; border-radius:6px; font-weight:600; font-size:12px; background:${deptStyle.bg}; color:${deptStyle.text}; border:1px solid ${deptStyle.border};">🏛️ ${escapeHtml(deptName)}</span></td>
                    <td style="padding: 10px 14px; text-align: center; font-weight: 600;">${count}</td>
                    <td style="padding: 10px 14px; text-align: right; font-family: monospace;">${formatCurrency(budget)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #16a34a; font-family: monospace;">${formatCurrency(salPaid)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 600; color: #1e40af; font-family: monospace;">${formatCurrency(otherPaid)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; font-family: monospace;">${formatCurrency(salPaid + otherPaid)}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${pending > 0 ? '#b91c1c' : '#64748b'}; font-family: monospace;">${formatCurrency(pending)}</td>
                    <td style="padding: 10px 14px; text-align: center; font-weight: 700; color: #0b2a4a;">${sharePct}%</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = sortedDepts.length ? rowsHtml : `<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No departments found.</td></tr>`;
        tfoot.innerHTML = `
            <tr>
                <td style="padding: 12px 14px; font-size: 13px;">TOTAL (${sortedDepts.length} Depts):</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">${sumStaff}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace;">${formatCurrency(sumBudget)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #16a34a;">${formatCurrency(sumSalary)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #1e40af;">${formatCurrency(sumOther)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace;">${formatCurrency(sumSalary + sumOther)}</td>
                <td style="padding: 12px 14px; text-align: right; font-family: monospace; color: #b91c1c;">${formatCurrency(sumPending)}</td>
                <td style="padding: 12px 14px; text-align: center; font-weight: 700;">100%</td>
            </tr>
        `;
        updateReportKpis(sumStaff, sumBudget, sumSalary + sumOther, sumPending);
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing department expense breakdown across ${sortedDepts.length} departments`;
    }

    // ─── REPORT 4: FACULTY-WISE TOTAL EXPENSES ───
    function renderFacultyTotalExpensesReport(month, dept) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th>Emp ID</th><th>Faculty Name</th><th>Department</th>
                <th style="text-align:right;">Salary Paid</th><th style="text-align:right;">Advances</th>
                <th style="text-align:right;">Other Expenses</th><th style="text-align:right;">Total Expenses</th>
                <th style="text-align:center;">Tx Count</th><th style="text-align:center;">History</th>
            </tr>
        `;

        let staff = currentFacultyList.filter(f => dept === 'all' || f.department === dept);
        let grandSal = 0, grandAdv = 0, grandOth = 0, grandBase = 0;

        const rows = staff.map(f => {
            const pays = currentReportPayments.filter(p =>
                (p.faculty_id === f.id || (p.employee_id && p.employee_id === f.employee_id)) &&
                (month === 'all' || (p.payment_date && p.payment_date.startsWith(month)))
            );
            let sal = 0, adv = 0, oth = 0;
            pays.forEach(p => {
                const amt = Number(p.amount) || 0;
                const b = classifyFacultyCategory(p.expense_category);
                if (b === 'salary') sal += amt;
                else if (b === 'advances') adv += amt;
                else oth += amt;
            });
            grandSal += sal; grandAdv += adv; grandOth += oth;
            grandBase += Number(f.base_salary || f.salary) || 0;
            return `
                <tr>
                    <td style="font-family:monospace; font-weight:700;">${escapeHtml(f.employee_id || '-')}</td>
                    <td><b>${escapeHtml(f.name)}</b></td>
                    <td>${escapeHtml(f.department || '-')}</td>
                    <td style="text-align:right; color:#16a34a; font-weight:600;">${formatCurrency(sal)}</td>
                    <td style="text-align:right; color:#b45309; font-weight:600;">${formatCurrency(adv)}</td>
                    <td style="text-align:right; color:#1e40af; font-weight:600;">${formatCurrency(oth)}</td>
                    <td style="text-align:right; font-weight:700; color:#b91c1c;">${formatCurrency(sal + adv + oth)}</td>
                    <td style="text-align:center;">${pays.length}</td>
                    <td style="text-align:center;"><button type="button" class="btn btn-outline btn-xs" onclick="openFacultyHistoryModal('${f.id}')">View</button></td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = staff.length ? rows : '<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No faculty records found.</td></tr>';
        tfoot.innerHTML = `<tr><td colspan="3" style="text-align:right;">TOTALS:</td><td style="text-align:right;">${formatCurrency(grandSal)}</td><td style="text-align:right;">${formatCurrency(grandAdv)}</td><td style="text-align:right;">${formatCurrency(grandOth)}</td><td style="text-align:right; color:#b91c1c;">${formatCurrency(grandSal + grandAdv + grandOth)}</td><td colspan="2"></td></tr>`;
        updateReportKpis(staff.length, grandBase, grandSal + grandAdv + grandOth, Math.max(0, grandBase - grandSal));
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing total faculty expenses across ${staff.length} staff`;
    }

    // ─── REPORT 4B: SUBCATEGORY-WISE FACULTY EXPENSE SUMMARY ───
    function renderFacultyCategorySummaryReport(month, dept) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th>Faculty Expense Subcategory</th>
                <th style="text-align:center;">Type</th>
                <th style="text-align:center;">Vouchers</th>
                <th style="text-align:center;">Staff Count</th>
                <th style="text-align:right;">Total Amount</th>
                <th style="text-align:center;">Share %</th>
            </tr>
        `;

        const scopedPayments = currentReportPayments.filter(p => {
            if (month !== 'all' && (!p.payment_date || !p.payment_date.startsWith(month))) return false;
            if (dept !== 'all') {
                const fac = currentFacultyList.find(f => f.id === p.faculty_id || f.employee_id === p.employee_id);
                if (!fac || fac.department !== dept) return false;
            }
            return true;
        });

        const canonicalNames = ['Salary', 'Advance Salary', 'Bonus', 'Incentives', 'Travel Expense', 'Reimbursements', 'Gifts / Goodies', 'Training / Workshop Expenses', 'Other Faculty Expenses'];
        const buckets = new Map();
        canonicalNames.forEach(n => buckets.set(n.toLowerCase(), { name: n, count: 0, total: 0, staff: new Set() }));

        let grandTotal = 0;
        let grandCount = 0;
        const grandStaff = new Set();
        scopedPayments.forEach(p => {
            const raw = String(p.expense_category || 'Salary').trim();
            const key = raw.toLowerCase();
            if (!buckets.has(key)) buckets.set(key, { name: raw, count: 0, total: 0, staff: new Set() });
            const b = buckets.get(key);
            const amt = Number(p.amount) || 0;
            b.count++;
            b.total += amt;
            if (p.faculty_id) {
                b.staff.add(p.faculty_id);
                grandStaff.add(p.faculty_id);
            }
            grandTotal += amt;
            grandCount++;
        });

        const list = Array.from(buckets.values());
        tbody.innerHTML = list.map(b => {
            const bucketType = classifyFacultyCategory(b.name);
            const typeBadge = bucketType === 'salary'
                ? '<span class="badge-status paid">Salary</span>'
                : (bucketType === 'advances' ? '<span class="badge-status partial">Advance</span>' : '<span class="badge-status pending">Non-Salary</span>');
            const pct = grandTotal > 0 ? ((b.total / grandTotal) * 100).toFixed(1) : '0.0';
            return `
                <tr>
                    <td><b>${escapeHtml(b.name)}</b></td>
                    <td style="text-align:center;">${typeBadge}</td>
                    <td style="text-align:center;">${b.count}</td>
                    <td style="text-align:center;">${b.staff.size}</td>
                    <td style="text-align:right; font-weight:700; color:${b.total > 0 ? '#b91c1c' : '#64748b'};">${formatCurrency(b.total)}</td>
                    <td style="text-align:center;"><b>${pct}%</b></td>
                </tr>
            `;
        }).join('');

        tfoot.innerHTML = `<tr><td colspan="2" style="text-align:right;">TOTAL (${list.length} Subcategories):</td><td style="text-align:center;">${grandCount}</td><td style="text-align:center;">${grandStaff.size}</td><td style="text-align:right; color:#b91c1c;">${formatCurrency(grandTotal)}</td><td style="text-align:center;">100%</td></tr>`;
        updateReportKpis(grandStaff.size, 0, grandTotal, 0);
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing ${list.length} faculty expense subcategories`;
    }

    // ─── REPORT 5-8: CATEGORY-SPECIFIC REPORTS ───
    function renderCategoryExpenseReport(month, dept, targetCategories, titleLabel) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th>Date</th><th>Voucher</th><th>Emp ID</th><th>Faculty Name</th><th>Department</th><th>Category</th><th>Mode &amp; Ref</th><th>Remarks</th><th style="text-align:right;">Amount</th>
            </tr>
        `;

        const matches = currentReportPayments.filter(p => {
            const catLower = (p.expense_category || '').toLowerCase().trim();
            if (!targetCategories.includes(catLower)) return false;
            if (month !== 'all' && (!p.payment_date || !p.payment_date.startsWith(month))) return false;
            if (dept !== 'all') {
                const fac = currentFacultyList.find(f => f.id === p.faculty_id || f.employee_id === p.employee_id);
                if (!fac || fac.department !== dept) return false;
            }
            return true;
        });

        let total = 0;
        const staffSet = new Set();
        tbody.innerHTML = matches.length === 0
            ? `<tr><td colspan="9" class="text-center text-muted" style="padding:28px;">No ${escapeHtml(titleLabel)} records found for selected filters.</td></tr>`
            : matches.map(p => {
                const amt = Number(p.amount) || 0;
                total += amt;
                if (p.faculty_id) staffSet.add(p.faculty_id);
                const fac = currentFacultyList.find(f => f.id === p.faculty_id || f.employee_id === p.employee_id);
                return `
                    <tr>
                        <td>${escapeHtml(p.payment_date || '-')}</td>
                        <td style="font-family:monospace;">${escapeHtml(p.voucher_number || '—')}</td>
                        <td style="font-family:monospace;">${escapeHtml(p.employee_id || (fac && fac.employee_id) || '-')}</td>
                        <td><b>${escapeHtml(p.faculty_name || (fac && fac.name) || '-')}</b></td>
                        <td>${escapeHtml(p.department || (fac && fac.department) || '-')}</td>
                        <td><span class="badge-status partial">${escapeHtml(p.expense_category || '')}</span></td>
                        <td>${escapeHtml((p.payment_mode || 'cash').toUpperCase())}${p.reference_number ? ' (' + escapeHtml(p.reference_number) + ')' : ''}</td>
                        <td>${escapeHtml(p.remarks || p.particulars || '—')}</td>
                        <td style="text-align:right; font-weight:700; color:#b91c1c;">${formatCurrency(amt)}</td>
                    </tr>
                `;
            }).join('');

        tfoot.innerHTML = `<tr><td colspan="8" style="text-align:right;">TOTAL (${matches.length} records):</td><td style="text-align:right; color:#b91c1c;">${formatCurrency(total)}</td></tr>`;
        updateReportKpis(staffSet.size, 0, total, 0);
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `${titleLabel}: ${matches.length} disbursement(s) totalling ${formatCurrency(total)}`;
    }

    // ─── REPORT 9: SALARY VS NON-SALARY BREAKDOWN ───
    function renderSalaryVsNonSalaryReport(month, dept) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th>Emp ID</th><th>Faculty Name</th><th>Department</th>
                <th style="text-align:right;">Salary Only</th>
                <th style="text-align:right;">Advances</th>
                <th style="text-align:right;">Non-Salary Other</th>
                <th style="text-align:right;">Grand Total</th>
                <th style="text-align:center;">Salary Share %</th>
            </tr>
        `;
        const staff = currentFacultyList.filter(f => dept === 'all' || f.department === dept);
        let sumSal = 0, sumAdv = 0, sumNon = 0;

        tbody.innerHTML = staff.length === 0
            ? '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No staff found.</td></tr>'
            : staff.map(f => {
                const pays = currentReportPayments.filter(p =>
                    (p.faculty_id === f.id || (p.employee_id && p.employee_id === f.employee_id)) &&
                    (month === 'all' || (p.payment_date && p.payment_date.startsWith(month)))
                );
                let sal = 0, adv = 0, non = 0;
                pays.forEach(p => {
                    const a = Number(p.amount) || 0;
                    const b = classifyFacultyCategory(p.expense_category);
                    if (b === 'salary') sal += a;
                    else if (b === 'advances') adv += a;
                    else non += a;
                });
                const tot = sal + adv + non;
                const share = tot > 0 ? ((sal / tot) * 100).toFixed(1) : '0.0';
                sumSal += sal; sumAdv += adv; sumNon += non;
                return `
                    <tr>
                        <td style="font-family:monospace;">${escapeHtml(f.employee_id || '-')}</td>
                        <td><b>${escapeHtml(f.name)}</b></td>
                        <td>${escapeHtml(f.department || '-')}</td>
                        <td style="text-align:right; color:#0f7b3a; font-weight:700;">${formatCurrency(sal)}</td>
                        <td style="text-align:right; color:#b45309;">${formatCurrency(adv)}</td>
                        <td style="text-align:right; color:#1e40af;">${formatCurrency(non)}</td>
                        <td style="text-align:right; font-weight:700;">${formatCurrency(tot)}</td>
                        <td style="text-align:center;"><b>${share}%</b></td>
                    </tr>
                `;
            }).join('');

        tfoot.innerHTML = `<tr><td colspan="3" style="text-align:right;">TOTALS:</td><td style="text-align:right; color:#0f7b3a;">${formatCurrency(sumSal)}</td><td style="text-align:right; color:#b45309;">${formatCurrency(sumAdv)}</td><td style="text-align:right; color:#1e40af;">${formatCurrency(sumNon)}</td><td style="text-align:right;">${formatCurrency(sumSal + sumAdv + sumNon)}</td><td style="text-align:center;">${(sumSal + sumAdv + sumNon) > 0 ? ((sumSal / (sumSal + sumAdv + sumNon)) * 100).toFixed(1) : 0}%</td></tr>`;
        updateReportKpis(staff.length, 0, sumSal + sumAdv + sumNon, 0);
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Salary vs Non-Salary separation for ${staff.length} staff`;
    }

    // ─── REPORT 10: INDIVIDUAL FACULTY HISTORY ───
    function renderIndividualHistoryReport(personId, month) {
        const thead = document.getElementById('facultyReportsTableHead');
        const tbody = document.getElementById('facultyReportsTableBody');
        const tfoot = document.getElementById('facultyReportsTableFoot');

        thead.innerHTML = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th>Date</th><th>Voucher</th><th>Category</th><th>Salary Month</th><th>Mode &amp; Ref</th><th>Remarks</th><th style="text-align:right;">Amount</th>
            </tr>
        `;
        if (!personId) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:28px;">Select a Faculty Member above to view individual payment history.</td></tr>';
            updateReportKpis(0, 0, 0, 0);
            return;
        }
        const fac = currentFacultyList.find(f => f.id === personId);
        const pays = currentReportPayments.filter(p =>
            (p.faculty_id === personId || (fac && p.employee_id === fac.employee_id)) &&
            (month === 'all' || (p.payment_date && p.payment_date.startsWith(month)))
        );
        let sal = 0, total = 0;
        tbody.innerHTML = pays.length === 0
            ? '<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">No payments recorded for this faculty member in selected period.</td></tr>'
            : pays.map(p => {
                const a = Number(p.amount) || 0;
                total += a;
                if (isSalaryPayment(p)) sal += a;
                return `
                    <tr>
                        <td>${escapeHtml(p.payment_date || '-')}</td>
                        <td style="font-family:monospace;">${escapeHtml(p.voucher_number || '—')}</td>
                        <td><span class="badge-status partial">${escapeHtml(p.expense_category || 'Salary')}</span></td>
                        <td>${escapeHtml(p.salary_month || '—')}</td>
                        <td>${escapeHtml((p.payment_mode || 'cash').toUpperCase())}${p.reference_number ? ' (' + escapeHtml(p.reference_number) + ')' : ''}</td>
                        <td>${escapeHtml(p.remarks || p.particulars || '—')}</td>
                        <td style="text-align:right; font-weight:700; color:#b91c1c;">${formatCurrency(a)}</td>
                    </tr>
                `;
            }).join('');

        const base = fac ? (Number(fac.base_salary || fac.salary) || 0) : 0;
        tfoot.innerHTML = `<tr><td colspan="6" style="text-align:right;">TOTAL (${pays.length} payments):</td><td style="text-align:right; color:#b91c1c;">${formatCurrency(total)}</td></tr>`;
        updateReportKpis(fac ? 1 : 0, base, total, Math.max(0, base - sal));
        const countEl = document.getElementById('facultyReportTableCount');
        if (countEl) countEl.textContent = `Showing ${pays.length} payment(s) for ${fac ? fac.name : 'faculty'}`;
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
        if (!window.currentUser) return;
        try {
            const facultyList = await window.DataService.getFaculty();
            const allPayments = await window.DataService.getAllFacultyPayments();

            const activeStaff = (facultyList || []).filter(f => f.status !== 'inactive');
            const committed = activeStaff.reduce((sum, f) => sum + (Number(f.salary || f.base_salary) || 0), 0);

            const now = new Date();
            const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const nowMonthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

            const monthPayments = (allPayments || []).filter(p =>
                p.payment_date && p.payment_date.startsWith(currentMonthStr) && isSalaryPayment(p)
            );
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
