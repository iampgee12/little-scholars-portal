// Finance › HRM / Payroll — salary scale (grade levels & steps), positions,
// staff contracts, each staff member's pay profile (grade, bank, recurring
// allowances / deductions), PAYE (Nigerian PITA bands, pension, NHIS, NHF),
// monthly salary computation with named lines and Exclude, the payment
// schedule (paying posts the salary to Expenses) and staff loans & advances
// (apply → review → approve → disburse → repaid through payroll).

module.exports = function createPayroll(ctx, F) {
  const { one, all, run, cleanText, readJson, sendJson, requireUser, STAFF_TYPES } = ctx;
  const { round2, money, posMoney, flag, nowIso, today } = F;

  const BANKS = [
    'Cash Payment', 'Access Bank Plc', 'Access Bank Plc (Diamond)', 'Citibank Nigeria', 'Ecobank Nigeria', 'Fidelity Bank Plc', 'First Bank of Nigeria Plc',
    'First City Monument Bank (FCMB)', 'Globus Bank', 'Guaranty Trust Bank Plc', 'Heritage Bank', 'Jaiz Bank', 'Keystone Bank', 'Kuda Microfinance Bank',
    'Lotus Bank', 'Moniepoint Microfinance Bank', 'Opay (Paycom)', 'Optimus Bank', 'Palmpay', 'Parallex Bank', 'Polaris Bank', 'Premium Trust Bank',
    'Providus Bank', 'Signature Bank', 'Stanbic IBTC Bank', 'Standard Chartered Bank', 'Sterling Bank', 'SunTrust Bank', 'TAJ Bank', 'Titan Trust Bank',
    'Union Bank of Nigeria', 'United Bank for Africa (UBA)', 'Unity Bank', 'VFD Microfinance Bank', 'Wema Bank', 'Zenith Bank Plc',
  ];
  const LOAN_DEFAULTS = {
    enabledTypes: ['loan', 'advance', 'grant'], allowedStaffTypes: ['all'], allowProbation: false, allowTemporary: false,
    salaryMultiple: 0, hardCap: 0, maxAdvanceMonths: 0, interestMode: 'per_type', loanRate: 0, advanceRate: 0, grantRate: 0, flatRate: 0,
    bands: [], fallbackRate: 0, allowRateOverride: false, requireOverrideReason: false, requireDocument: false, requireGuarantor: false, requireRepaymentPreference: false,
  };
  const PAYE_DEFAULTS = { engine: false, minNetPct: 46.67, payrollAccountId: null };

  const staffTypeLabel = key => (STAFF_TYPES.find(([k]) => k === key) || [key, key])[1];
  const staffTypeOf = u => u.staffType || (u.role === 'teacher' ? 'teacher' : u.role === 'admin' ? 'admin' : 'general_staff');

  function staffList() {
    return all(
      `SELECT u.id, u.name, u.role, u.teacher_type AS teacherType, u.staff_type AS staffType, u.designation, u.employment_status AS employmentStatus,
              p.grade_step_id AS gradeStepId, p.position_id AS positionId, p.payment_channel AS paymentChannel, p.account_number AS accountNumber, p.account_name AS accountName,
              gs.name AS stepName, gs.basic_salary AS stepSalary, gl.name AS gradeName, pos.name AS positionName,
              r.base_salary AS baseOverride
       FROM users u
       LEFT JOIN staff_payroll_profiles p ON p.staff_id = u.id
       LEFT JOIN pay_grade_steps gs ON gs.id = p.grade_step_id
       LEFT JOIN pay_grade_levels gl ON gl.id = gs.grade_level_id
       LEFT JOIN pay_positions pos ON pos.id = p.position_id
       LEFT JOIN staff_pay_rates r ON r.staff_id = u.id
       WHERE u.role IN ('teacher','admin','staff') AND COALESCE(u.archived,0) = 0 AND COALESCE(u.active,1) = 1
         AND COALESCE(u.employment_status,'Active') IN ('Active','')
       ORDER BY u.name`
    ).map(s => ({
      ...s, staffType: staffTypeOf(s), staffTypeLabel: staffTypeLabel(staffTypeOf(s)),
      roleLabel: s.designation || (s.role === 'teacher' ? (s.teacherType === 'subject_teacher' ? 'Subject Teacher' : 'Classroom Teacher') : staffTypeLabel(staffTypeOf(s))),
      gradeLabel: s.gradeName ? `${s.gradeName} / ${s.stepName}` : '',
      basic: round2(s.baseOverride != null && s.baseOverride > 0 ? s.baseOverride : (s.stepSalary || 0)),
      paymentChannel: s.paymentChannel || 'Cash Payment',
      items: all('SELECT id, kind, name, amount FROM staff_pay_items WHERE staff_id = ? ORDER BY kind, id', s.id).map(i => ({ ...i, amount: round2(i.amount) })),
    }));
  }

  // ── PAYE ───────────────────────────────────────────────────────────────
  function payeSettings() { return F.getJsonMeta('payroll_paye_settings', PAYE_DEFAULTS); }
  function payeConfig(period) {
    const date = `${period}-01`;
    const row = one('SELECT * FROM paye_configs WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1', date) || one('SELECT * FROM paye_configs ORDER BY effective_from LIMIT 1');
    return row ? { ...row, bands: JSON.parse(row.bands || '[]') } : null;
  }
  // Monthly statutory figures for a monthly basic + allowances.
  function statutory(basic, gross, period) {
    const cfg = payeConfig(period);
    if (!cfg) return { paye: 0, pensionEmp: 0, pensionEr: 0, nhis: 0, nhf: 0 };
    const pensionEmp = round2(gross * cfg.pension_emp / 100);
    const pensionEr = round2(gross * cfg.pension_er / 100);
    const nhis = round2(basic * cfg.nhis / 100);
    const nhf = round2(basic * cfg.nhf / 100);
    const annualGross = gross * 12;
    const cra = Math.max(cfg.cra_fixed, annualGross * 0.01) + annualGross * 0.2;
    let taxable = annualGross - cra - (pensionEmp + nhis + nhf) * 12;
    let tax = 0;
    if (taxable > 0) {
      for (const band of cfg.bands) {
        const slice = band.limit == null ? taxable : Math.min(taxable, band.limit);
        tax += slice * band.rate / 100;
        taxable -= slice;
        if (taxable <= 0) break;
      }
    }
    tax = Math.max(tax, annualGross * 0.01); // minimum tax: 1% of gross income
    return { paye: round2(tax / 12), pensionEmp, pensionEr, nhis, nhf };
  }

  // ── Loans ──────────────────────────────────────────────────────────────
  function loanSettings() { return F.getJsonMeta('payroll_loan_settings', LOAN_DEFAULTS); }
  function loanRow(l) {
    const repaid = round2(one('SELECT COALESCE(SUM(amount),0) AS s FROM loan_repayments WHERE loan_id = ?', l.id).s);
    const owed = l.loan_type === 'grant' ? 0 : round2(l.total_repayable != null ? l.total_repayable : (l.amount_approved || l.amount));
    return {
      id: l.id, loanCode: l.loan_code, staffId: l.staff_id, name: l.name, staffType: l.staffType, loanType: l.loan_type,
      amountRequested: round2(l.amount), amountApproved: l.amount_approved != null ? round2(l.amount_approved) : null, interestRate: l.interest_rate,
      totalRepayable: owed, repaid, balance: ['active', 'settled'].includes(l.status) ? round2(Math.max(0, owed - repaid)) : null,
      purpose: l.reason, monthlyDeduction: round2(l.monthly_deduction), repaymentMonths: l.repayment_months, startMonth: l.start_month, startYear: l.start_year,
      status: l.status, disbBank: l.disb_bank, disbAccountNumber: l.disb_account_number, disbAccountName: l.disb_account_name,
      guarantorName: l.guarantor_name, guarantorRelationship: l.guarantor_relationship, guarantorPhone: l.guarantor_phone, guarantorEmail: l.guarantor_email,
      documentPath: l.document_path, decisionNote: l.decision_note, issuedAt: l.issued_at, reviewedAt: l.reviewed_at, approvedAt: l.approved_at, disbursedAt: l.disbursed_at,
      repayments: all('SELECT id, amount, source, note, paid_at AS paidAt FROM loan_repayments WHERE loan_id = ? ORDER BY paid_at', l.id),
    };
  }
  function loans(f = {}) {
    let sql = 'SELECT l.*, u.name, u.staff_type AS staffType FROM staff_loans l JOIN users u ON u.id = l.staff_id WHERE 1=1';
    const p = [];
    if (f.status) { sql += ' AND l.status = ?'; p.push(f.status); }
    if (f.type) { sql += ' AND l.loan_type = ?'; p.push(f.type); }
    if (f.staffId) { sql += ' AND l.staff_id = ?'; p.push(f.staffId); }
    return all(`${sql} ORDER BY l.issued_at DESC`, ...p).map(loanRow);
  }
  function rateFor(type, amount) {
    const s = loanSettings();
    if (type === 'grant') return 0;
    if (s.interestMode === 'flat') return Number(s.flatRate) || 0;
    if (s.interestMode === 'bands' && type === 'loan') {
      const band = (s.bands || []).find(b => amount >= Number(b.min || 0) && (!b.max || amount <= Number(b.max)));
      return band ? Number(band.rate) || 0 : Number(s.fallbackRate) || 0;
    }
    return Number(type === 'advance' ? s.advanceRate : s.loanRate) || 0;
  }
  function loanLimit(staffId, type) {
    const s = loanSettings();
    const st = staffList().find(x => x.id === staffId);
    const basic = st ? st.basic : 0;
    let limit = Infinity;
    if (type === 'loan' && s.salaryMultiple > 0) limit = Math.min(limit, basic * s.salaryMultiple);
    if (type === 'advance' && s.maxAdvanceMonths > 0) limit = Math.min(limit, basic * s.maxAdvanceMonths);
    if (s.hardCap > 0) limit = Math.min(limit, s.hardCap);
    return limit === Infinity ? null : round2(limit);
  }
  // Monthly repayment lines due from each active loan in a period.
  function loanDeductions(staffId, period) {
    return loans({ staffId, status: 'active' }).filter(l => l.loanType !== 'grant' && l.balance > 0).filter(l => {
      if (!l.startYear || !l.startMonth) return true;
      return period >= `${l.startYear}-${String(l.startMonth).padStart(2, '0')}`;
    }).map(l => ({ name: `Loan Repayment (${l.loanCode})`, amount: round2(Math.min(l.monthlyDeduction || l.balance, l.balance)), loanId: l.id, system: true }))
      .filter(x => x.amount > 0);
  }

  // ── Salary computation ─────────────────────────────────────────────────
  function salaryRecord(s) {
    const lines = s.lines ? JSON.parse(s.lines) : { allowances: s.allowances ? [{ name: 'Allowances', amount: s.allowances }] : [], deductions: s.deductions ? [{ name: 'Deductions', amount: s.deductions }] : [] };
    return {
      id: s.id, staffId: s.staff_id, name: s.name, period: s.period, basic: round2(s.base_salary), allowances: lines.allowances || [], deductions: lines.deductions || [],
      totalAllowances: round2(s.allowances), totalDeductions: round2(s.deductions), net: round2(s.net_salary), status: s.status, paidAt: s.paid_at,
      excluded: !!s.excluded, paymentChannel: s.payment_channel || 'Cash Payment', accountNumber: s.account_number, accountName: s.account_name,
      gradeLabel: s.grade_label, staffType: s.staff_type, paye: round2(s.paye), pensionEmp: round2(s.pension_emp), pensionEr: round2(s.pension_er), nhis: round2(s.nhis), nhf: round2(s.nhf),
    };
  }
  function savedSalaries(period) {
    return all('SELECT s.*, u.name FROM staff_salaries s JOIN users u ON u.id = s.staff_id WHERE s.period = ? ORDER BY u.name', period).map(salaryRecord);
  }
  function computeRow(st, period, settings) {
    const allowances = st.items.filter(i => i.kind === 'allowance').map(i => ({ name: i.name, amount: i.amount }));
    const deductions = st.items.filter(i => i.kind === 'deduction').map(i => ({ name: i.name, amount: i.amount }));
    loanDeductions(st.id, period).forEach(l => deductions.push(l));
    const gross = st.basic + allowances.reduce((s, a) => s + a.amount, 0);
    if (settings.engine && gross > 0) {
      const t = statutory(st.basic, gross, period);
      [['PAYE Tax', t.paye], ['Pension (Employee)', t.pensionEmp], ['NHIS', t.nhis], ['NHF', t.nhf]].forEach(([n, a]) => a > 0 && deductions.push({ name: n, amount: a, statutory: true }));
    }
    return { allowances, deductions };
  }
  function totalsOf(basic, allowances, deductions) {
    const ta = round2(allowances.reduce((s, a) => s + money(a.amount), 0));
    const td = round2(deductions.reduce((s, a) => s + money(a.amount), 0));
    return { totalAllowances: ta, totalDeductions: td, net: round2(basic + ta - td), gross: round2(basic + ta) };
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    if (!p.startsWith('/api/admin/payroll')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const g = k => cleanText(url.searchParams.get(k));

    if (m === 'GET' && p === '/api/admin/payroll/meta') {
      const levels = all('SELECT id, name, numeric_level AS numeric FROM pay_grade_levels ORDER BY numeric_level, id');
      const steps = all(`SELECT s.id, s.grade_level_id AS gradeLevelId, l.name AS gradeName, s.name, s.numeric_step AS numeric, s.basic_salary AS basicSalary
                         FROM pay_grade_steps s JOIN pay_grade_levels l ON l.id = s.grade_level_id ORDER BY l.numeric_level, s.numeric_step, s.id`);
      return sendJson(res, 200, {
        staffTypes: STAFF_TYPES.map(([key, label]) => ({ key, label })), banks: BANKS, levels, steps,
        positions: all(`SELECT p.id, p.name, p.department, p.default_grade_level_id AS defaultGradeLevelId, l.name AS defaultGradeName, p.status
                        FROM pay_positions p LEFT JOIN pay_grade_levels l ON l.id = p.default_grade_level_id ORDER BY p.name`),
        paye: payeSettings(), accounts: F.finAccounts({ activeOnly: true }), loanSettings: loanSettings(),
      }), true;
    }

    // Salary scale
    if (m === 'POST' && p === '/api/admin/payroll/grade-levels') {
      const b = await readJson(req);
      const name = cleanText(b.name).toUpperCase();
      if (!name) return sendJson(res, 400, { error: 'Grade level name is required' }), true;
      run('INSERT INTO pay_grade_levels (name, numeric_level) VALUES (?, ?)', name, Number(b.numeric) || 1);
      return sendJson(res, 200, { ok: true }), true;
    }
    const glMatch = p.match(/^\/api\/admin\/payroll\/grade-levels\/(\d+)$/);
    if (glMatch && m === 'PUT') {
      const b = await readJson(req);
      run('UPDATE pay_grade_levels SET name = ?, numeric_level = ? WHERE id = ?', cleanText(b.name).toUpperCase(), Number(b.numeric) || 1, Number(glMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (glMatch && m === 'DELETE') {
      if (one('SELECT 1 FROM staff_payroll_profiles p JOIN pay_grade_steps s ON s.id = p.grade_step_id WHERE s.grade_level_id = ?', Number(glMatch[1]))) {
        return sendJson(res, 400, { error: 'Staff are on this grade level — move them first' }), true;
      }
      run('DELETE FROM pay_grade_levels WHERE id = ?', Number(glMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/payroll/grade-steps') {
      const b = await readJson(req);
      if (!Number(b.gradeLevelId) || !cleanText(b.name)) return sendJson(res, 400, { error: 'Choose the grade level and name the step' }), true;
      run('INSERT INTO pay_grade_steps (grade_level_id, name, numeric_step, basic_salary) VALUES (?, ?, ?, ?)', Number(b.gradeLevelId), cleanText(b.name).toUpperCase(), Number(b.numeric) || 1, money(b.basicSalary));
      return sendJson(res, 200, { ok: true }), true;
    }
    const gsMatch = p.match(/^\/api\/admin\/payroll\/grade-steps\/(\d+)$/);
    if (gsMatch && m === 'PUT') {
      const b = await readJson(req);
      run('UPDATE pay_grade_steps SET grade_level_id = ?, name = ?, numeric_step = ?, basic_salary = ? WHERE id = ?', Number(b.gradeLevelId), cleanText(b.name).toUpperCase(), Number(b.numeric) || 1, money(b.basicSalary), Number(gsMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (gsMatch && m === 'DELETE') {
      if (one('SELECT 1 FROM staff_payroll_profiles WHERE grade_step_id = ?', Number(gsMatch[1]))) return sendJson(res, 400, { error: 'Staff are on this step — move them first' }), true;
      run('DELETE FROM pay_grade_steps WHERE id = ?', Number(gsMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    // Positions
    if (m === 'POST' && p === '/api/admin/payroll/positions') {
      const b = await readJson(req);
      if (!cleanText(b.name)) return sendJson(res, 400, { error: 'Position name is required' }), true;
      run('INSERT INTO pay_positions (name, department, default_grade_level_id, status) VALUES (?, ?, ?, ?)', cleanText(b.name), cleanText(b.department) || null, Number(b.defaultGradeLevelId) || null, b.status === 'inactive' ? 'inactive' : 'active');
      return sendJson(res, 200, { ok: true }), true;
    }
    const posMatch = p.match(/^\/api\/admin\/payroll\/positions\/(\d+)$/);
    if (posMatch && m === 'PUT') {
      const b = await readJson(req);
      run('UPDATE pay_positions SET name = ?, department = ?, default_grade_level_id = ?, status = ? WHERE id = ?', cleanText(b.name), cleanText(b.department) || null, Number(b.defaultGradeLevelId) || null, b.status === 'inactive' ? 'inactive' : 'active', Number(posMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (posMatch && m === 'DELETE') { run('DELETE FROM pay_positions WHERE id = ?', Number(posMatch[1])); return sendJson(res, 200, { ok: true }), true; }
    // Contracts
    if (m === 'GET' && p === '/api/admin/payroll/contracts') {
      const rows = all(`SELECT c.id, c.staff_id AS staffId, u.name, c.position_id AS positionId, p.name AS positionName, c.contract_type AS contractType,
                               c.start_date AS startDate, c.end_date AS endDate, c.probation_end AS probationEnd, c.status, c.notes
                        FROM staff_contracts c JOIN users u ON u.id = c.staff_id LEFT JOIN pay_positions p ON p.id = c.position_id ORDER BY u.name`)
        .map(c => ({ ...c, status: c.status === 'active' && c.endDate && c.endDate < today() ? 'expired' : c.status }));
      return sendJson(res, 200, { contracts: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/payroll/contracts') {
      const b = await readJson(req);
      if (!cleanText(b.staffId)) return sendJson(res, 400, { error: 'Choose the staff member' }), true;
      run('INSERT INTO staff_contracts (staff_id, position_id, contract_type, start_date, end_date, probation_end, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        cleanText(b.staffId), Number(b.positionId) || null, cleanText(b.contractType) || 'permanent', cleanText(b.startDate) || null, cleanText(b.endDate) || null,
        cleanText(b.probationEnd) || null, cleanText(b.status) || 'active', cleanText(b.notes) || null, nowIso());
      return sendJson(res, 200, { ok: true }), true;
    }
    const conMatch = p.match(/^\/api\/admin\/payroll\/contracts\/(\d+)$/);
    if (conMatch && m === 'PUT') {
      const b = await readJson(req);
      run('UPDATE staff_contracts SET staff_id = ?, position_id = ?, contract_type = ?, start_date = ?, end_date = ?, probation_end = ?, status = ?, notes = ? WHERE id = ?',
        cleanText(b.staffId), Number(b.positionId) || null, cleanText(b.contractType) || 'permanent', cleanText(b.startDate) || null, cleanText(b.endDate) || null,
        cleanText(b.probationEnd) || null, cleanText(b.status) || 'active', cleanText(b.notes) || null, Number(conMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (conMatch && m === 'DELETE') { run('DELETE FROM staff_contracts WHERE id = ?', Number(conMatch[1])); return sendJson(res, 200, { ok: true }), true; }

    // Staff pay profiles
    if (m === 'GET' && p === '/api/admin/payroll/profiles') return sendJson(res, 200, { staff: staffList() }), true;
    const profMatch = p.match(/^\/api\/admin\/payroll\/profiles\/([A-Za-z0-9-]+)$/);
    if (profMatch && m === 'PUT') {
      const staffId = profMatch[1].toUpperCase();
      if (!one("SELECT id FROM users WHERE id = ? AND role IN ('teacher','admin','staff')", staffId)) return sendJson(res, 404, { error: 'Staff member not found' }), true;
      const b = await readJson(req);
      const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ kind: i.kind === 'deduction' ? 'deduction' : 'allowance', name: cleanText(i.name), amount: money(i.amount) })).filter(i => i.name && i.amount > 0);
      F.tx(() => {
        run(`INSERT INTO staff_payroll_profiles (staff_id, grade_step_id, position_id, payment_channel, account_number, account_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(staff_id) DO UPDATE SET grade_step_id = excluded.grade_step_id, position_id = excluded.position_id, payment_channel = excluded.payment_channel,
             account_number = excluded.account_number, account_name = excluded.account_name, updated_at = excluded.updated_at`,
          staffId, Number(b.gradeStepId) || null, Number(b.positionId) || null, cleanText(b.paymentChannel) || 'Cash Payment', cleanText(b.accountNumber) || null, cleanText(b.accountName) || null, nowIso());
        run(`INSERT INTO staff_pay_rates (staff_id, base_salary, allowances, deductions, updated_at) VALUES (?, ?, 0, 0, ?)
             ON CONFLICT(staff_id) DO UPDATE SET base_salary = excluded.base_salary, updated_at = excluded.updated_at`, staffId, money(b.baseSalary), nowIso());
        run('DELETE FROM staff_pay_items WHERE staff_id = ?', staffId);
        items.forEach(i => run('INSERT INTO staff_pay_items (staff_id, kind, name, amount) VALUES (?, ?, ?, ?)', staffId, i.kind, i.name, i.amount));
      });
      return sendJson(res, 200, { ok: true }), true;
    }

    // PAYE
    if (m === 'PUT' && p === '/api/admin/payroll/paye-settings') {
      const b = await readJson(req);
      const pct = Number(b.minNetPct);
      F.setJsonMeta('payroll_paye_settings', { engine: !!b.engine, minNetPct: Number.isFinite(pct) && pct >= 0 && pct < 100 ? pct : 46.67, payrollAccountId: Number(b.payrollAccountId) || null });
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'GET' && p === '/api/admin/payroll/paye-configs') {
      return sendJson(res, 200, { configs: all('SELECT * FROM paye_configs ORDER BY effective_from DESC').map(c => ({ ...c, bands: JSON.parse(c.bands || '[]') })) }), true;
    }
    const payeMatch = p.match(/^\/api\/admin\/payroll\/paye-configs(?:\/(\d+))?$/);
    if (payeMatch && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const bands = (Array.isArray(b.bands) ? b.bands : []).map(x => ({ limit: x.limit === '' || x.limit == null ? null : money(x.limit), rate: Number(x.rate) || 0 }));
      if (!cleanText(b.effectiveFrom) || !bands.length) return sendJson(res, 400, { error: 'Effective date and at least one tax band are required' }), true;
      const vals = [cleanText(b.effectiveFrom), Number(b.pensionEmp) || 0, Number(b.pensionEr) || 0, Number(b.nhis) || 0, Number(b.nhf) || 0, money(b.craFixed), JSON.stringify(bands), cleanText(b.notes) || null];
      if (m === 'POST') run('INSERT INTO paye_configs (effective_from, pension_emp, pension_er, nhis, nhf, cra_fixed, bands, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...vals);
      else run('UPDATE paye_configs SET effective_from = ?, pension_emp = ?, pension_er = ?, nhis = ?, nhf = ?, cra_fixed = ?, bands = ?, notes = ? WHERE id = ?', ...vals, Number(payeMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (payeMatch && payeMatch[1] && m === 'DELETE') {
      if (one('SELECT COUNT(*) AS c FROM paye_configs').c <= 1) return sendJson(res, 400, { error: 'Keep at least one PAYE configuration' }), true;
      run('DELETE FROM paye_configs WHERE id = ?', Number(payeMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }

    // Monthly Salaries Processing
    if (m === 'GET' && p === '/api/admin/payroll/compute') {
      const period = g('period');
      if (!/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { error: 'Choose the month and year' }), true;
      const type = g('type');
      const settings = payeSettings();
      const saved = savedSalaries(period);
      const rows = staffList().filter(s => !type || type === 'all' || s.staffType === type).map(s => {
        const existing = saved.find(x => x.staffId === s.id);
        if (existing) return { ...existing, roleLabel: s.roleLabel, gradeLabel: existing.gradeLabel || s.gradeLabel, paymentChannel: existing.paymentChannel || s.paymentChannel, saved: true };
        const c = computeRow(s, period, settings);
        return { staffId: s.id, name: s.name, roleLabel: s.roleLabel, gradeLabel: s.gradeLabel, paymentChannel: s.paymentChannel, basic: s.basic, ...c, ...totalsOf(s.basic, c.allowances, c.deductions), excluded: false, status: 'not processed', saved: false };
      });
      return sendJson(res, 200, { period, rows, paye: settings }), true;
    }
    if (m === 'POST' && p === '/api/admin/payroll/salaries/generate') {
      const b = await readJson(req);
      const period = cleanText(b.period);
      if (!/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { error: 'A valid period (YYYY-MM) is required' }), true;
      const entries = Array.isArray(b.entries) ? b.entries : [];
      if (!entries.length) return sendJson(res, 400, { error: 'Nothing to save' }), true;
      const settings = payeSettings();
      const staff = staffList();
      const problems = [];
      let processed = 0;
      F.tx(() => entries.forEach(e => {
        const s = staff.find(x => x.id === cleanText(e.staffId).toUpperCase());
        if (!s) return;
        const existing = one('SELECT id, status FROM staff_salaries WHERE staff_id = ? AND period = ?', s.id, period);
        if (existing && existing.status === 'paid') return;
        const basic = money(e.basic);
        const clean = list => (Array.isArray(list) ? list : []).map(x => ({ name: cleanText(x.name), amount: money(x.amount), ...(x.loanId ? { loanId: Number(x.loanId) } : {}), ...(x.statutory ? { statutory: true } : {}) })).filter(x => x.name && x.amount > 0);
        const allowances = clean(e.allowances);
        const deductions = clean(e.deductions);
        const t = totalsOf(basic, allowances, deductions);
        const nonStatutory = deductions.filter(d => !d.statutory).reduce((sum, d) => sum + d.amount, 0);
        const statutoryTotal = t.totalDeductions - nonStatutory;
        if (!e.excluded && settings.minNetPct > 0 && t.gross > 0 && t.gross - statutoryTotal - nonStatutory < t.gross * settings.minNetPct / 100 - 0.01 && nonStatutory > 0) {
          problems.push(`${s.name}: deductions take net pay below ${settings.minNetPct}% of gross`);
          return;
        }
        const st = settings.engine && t.gross > 0 ? statutory(basic, t.gross, period) : { paye: 0, pensionEmp: 0, pensionEr: 0, nhis: 0, nhf: 0 };
        const vals = [basic, t.totalAllowances, t.totalDeductions, t.net, user.id, nowIso(), JSON.stringify({ allowances, deductions }), e.excluded ? 1 : 0,
          s.paymentChannel, s.accountNumber || null, s.accountName || null, s.gradeLabel || null, s.staffType,
          deductions.find(d => d.name === 'PAYE Tax')?.amount || 0, deductions.find(d => d.name === 'Pension (Employee)')?.amount || 0, settings.engine ? st.pensionEr : 0,
          deductions.find(d => d.name === 'NHIS')?.amount || 0, deductions.find(d => d.name === 'NHF')?.amount || 0];
        if (existing) {
          run(`UPDATE staff_salaries SET base_salary = ?, allowances = ?, deductions = ?, net_salary = ?, created_by = ?, created_at = ?, lines = ?, excluded = ?,
               payment_channel = ?, account_number = ?, account_name = ?, grade_label = ?, staff_type = ?, paye = ?, pension_emp = ?, pension_er = ?, nhis = ?, nhf = ? WHERE id = ?`, ...vals, existing.id);
        } else {
          run(`INSERT INTO staff_salaries (base_salary, allowances, deductions, net_salary, created_by, created_at, lines, excluded, payment_channel, account_number, account_name,
               grade_label, staff_type, paye, pension_emp, pension_er, nhis, nhf, staff_id, period, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, ...vals, s.id, period);
        }
        processed += 1;
      }));
      return sendJson(res, problems.length && !processed ? 400 : 200, problems.length && !processed ? { error: problems.join(' · ') } : { ok: true, processed, problems }), true;
    }
    // Salary Payment Schedule
    if (m === 'GET' && p === '/api/admin/payroll/schedule') {
      const period = g('period');
      if (!/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { error: 'Choose the salary month and year' }), true;
      const type = g('type');
      const channel = g('channel');
      const rows = savedSalaries(period).filter(s => !s.excluded)
        .filter(s => !type || type === 'all' || s.staffType === type)
        .filter(s => !channel || channel === 'all' || s.paymentChannel === channel);
      const by = new Map();
      rows.forEach(r => { const k = r.paymentChannel; by.set(k, round2((by.get(k) || 0) + r.net)); });
      return sendJson(res, 200, { rows, total: round2(rows.reduce((s, r) => s + r.net, 0)), byChannel: [...by.entries()].map(([channel, amount]) => ({ channel, amount })) }), true;
    }
    if (m === 'POST' && p === '/api/admin/payroll/salaries/pay') {
      const b = await readJson(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      const list = ids.map(id => one('SELECT s.*, u.name FROM staff_salaries s JOIN users u ON u.id = s.staff_id WHERE s.id = ?', id)).filter(s => s && s.status !== 'paid' && !s.excluded);
      if (!list.length) return sendJson(res, 400, { error: 'Select unpaid salaries' }), true;
      const accountId = Number(b.accountId) || payeSettings().payrollAccountId || F.defaultFinAccountId();
      const date = cleanText(b.date) || today();
      F.tx(() => list.forEach(s => {
        run("UPDATE staff_salaries SET status = 'paid', paid_at = ?, paid_from_account_id = ?, paid_by = ? WHERE id = ?", `${date}T12:00:00.000Z`, accountId, user.id, s.id);
        F.addExpense({ category: 'Salaries & Staff Wages', title: `Salary — ${s.name}`, item: 'Net Salary', description: `Salary for ${s.period} — ${s.name}`, amount: s.net_salary, date, userId: user.id, source: 'salary', sourceId: s.id, accountId, method: s.payment_channel === 'Cash Payment' ? 'Cash' : 'Bank', paidTo: s.name });
        const lines = s.lines ? JSON.parse(s.lines) : { deductions: [] };
        (lines.deductions || []).filter(d => d.loanId).forEach(d => run("INSERT INTO loan_repayments (loan_id, amount, source, salary_id, note, paid_at, recorded_by) VALUES (?, ?, 'payroll', ?, ?, ?, ?)", d.loanId, d.amount, s.id, `Payroll ${s.period}`, nowIso(), user.id));
        settleLoans();
      }));
      return sendJson(res, 200, { ok: true, count: list.length }), true;
    }

    // Loans
    if (m === 'GET' && p === '/api/admin/payroll/loans') return sendJson(res, 200, { loans: loans({ status: g('status'), type: g('type') }) }), true;
    if (m === 'GET' && p === '/api/admin/payroll/loans/limit') {
      return sendJson(res, 200, { limit: loanLimit(g('staffId').toUpperCase(), g('type') || 'loan'), staff: staffList().find(x => x.id === g('staffId').toUpperCase()) || null }), true;
    }
    if (m === 'GET' && p === '/api/admin/payroll/loan-settings') return sendJson(res, 200, { settings: loanSettings() }), true;
    if (m === 'PUT' && p === '/api/admin/payroll/loan-settings') {
      const b = await readJson(req);
      const s = { ...LOAN_DEFAULTS, ...b };
      s.enabledTypes = (Array.isArray(b.enabledTypes) ? b.enabledTypes : []).filter(t => ['loan', 'advance', 'grant'].includes(t));
      if (!s.enabledTypes.length) return sendJson(res, 400, { error: 'At least one loan type must be enabled' }), true;
      ['salaryMultiple', 'hardCap', 'maxAdvanceMonths', 'loanRate', 'advanceRate', 'grantRate', 'flatRate', 'fallbackRate'].forEach(k => { s[k] = Math.max(0, Number(b[k]) || 0); });
      F.setJsonMeta('payroll_loan_settings', s);
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/payroll/loans') {
      const b = await F.readBigJson(req);
      const s = loanSettings();
      const staffId = cleanText(b.staffId).toUpperCase();
      const st = staffList().find(x => x.id === staffId);
      if (!st) return sendJson(res, 400, { error: 'Choose the staff member' }), true;
      const type = ['loan', 'advance', 'grant'].includes(b.loanType) ? b.loanType : null;
      if (!type || !s.enabledTypes.includes(type)) return sendJson(res, 400, { error: 'Choose an enabled loan type' }), true;
      if (!s.allowedStaffTypes.includes('all') && !s.allowedStaffTypes.includes(st.staffType)) return sendJson(res, 400, { error: `${st.staffTypeLabel} staff cannot apply for loans` }), true;
      const contract = one("SELECT contract_type AS t, probation_end AS pe FROM staff_contracts WHERE staff_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", staffId);
      if (contract && !s.allowProbation && contract.pe && contract.pe > today()) return sendJson(res, 400, { error: 'Staff on probation cannot apply' }), true;
      if (contract && !s.allowTemporary && /temp|contract/i.test(contract.t)) return sendJson(res, 400, { error: 'Temporary contract staff cannot apply' }), true;
      const amount = posMoney(b.amount);
      if (!amount) return sendJson(res, 400, { error: 'Enter the amount requested' }), true;
      const limit = loanLimit(staffId, type);
      if (limit != null && amount > limit) return sendJson(res, 400, { error: `The effective limit is ₦${limit.toLocaleString()}` }), true;
      if (!cleanText(b.purpose)) return sendJson(res, 400, { error: 'Purpose is required' }), true;
      if (s.requireGuarantor && !cleanText(b.guarantorName)) return sendJson(res, 400, { error: 'Guarantor information is required' }), true;
      if (s.requireDocument && !cleanText(b.document)) return sendJson(res, 400, { error: 'A supporting document is required' }), true;
      let doc = null;
      try { doc = F.saveDocument(b.document, 'loan'); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
      const months = Number(b.repaymentMonths) || null;
      const rate = rateFor(type, amount);
      const total = type === 'grant' ? 0 : round2(amount * (1 + rate / 100));
      run(`INSERT INTO staff_loans (loan_code, staff_id, loan_type, amount, interest_rate, total_repayable, reason, monthly_deduction, repayment_months, start_month, start_year,
           repayment_status, status, disb_bank, disb_account_number, disb_account_name, guarantor_name, guarantor_relationship, guarantor_phone, guarantor_email, document_path, issued_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'outstanding', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        F.sequenceCode('staff_loans', 'loan_code', 'LN-', 5), staffId, type, amount, rate, total, cleanText(b.purpose), months ? round2(total / months) : 0, months,
        Number(b.startMonth) || null, Number(b.startYear) || null, st.paymentChannel, st.accountNumber || null, st.accountName || null,
        cleanText(b.guarantorName) || null, cleanText(b.guarantorRelationship) || null, cleanText(b.guarantorPhone) || null, cleanText(b.guarantorEmail) || null, doc, nowIso(), user.id);
      return sendJson(res, 200, { ok: true }), true;
    }
    const loanAct = p.match(/^\/api\/admin\/payroll\/loans\/(\d+)\/(action|repay)$/);
    if (m === 'POST' && loanAct) {
      const l = one('SELECT l.*, u.name FROM staff_loans l JOIN users u ON u.id = l.staff_id WHERE l.id = ?', Number(loanAct[1]));
      if (!l) return sendJson(res, 404, { error: 'Loan not found' }), true;
      const b = await readJson(req);
      if (loanAct[2] === 'repay') {
        const amount = posMoney(b.amount);
        const row = loanRow({ ...l });
        if (l.status !== 'active' || !amount || amount > row.balance + 0.01) return sendJson(res, 400, { error: 'Enter an amount up to the outstanding balance of an active loan' }), true;
        F.tx(() => {
          run("INSERT INTO loan_repayments (loan_id, amount, source, note, paid_at, recorded_by) VALUES (?, ?, 'manual', ?, ?, ?)", l.id, amount, cleanText(b.note) || 'Manual repayment', nowIso(), user.id);
          F.addIncome({ category: 'Staff Loan Repayments Received', description: `${l.loan_code} — ${l.name}`, amount, date: today(), userId: user.id, source: 'loan_repayment', sourceId: l.id, accountId: Number(b.accountId) || null, method: cleanText(b.method) || 'Cash', receivedFrom: l.name });
          settleLoans();
        });
        return sendJson(res, 200, { ok: true }), true;
      }
      const action = cleanText(b.action);
      const s = loanSettings();
      if (action === 'review' && l.status === 'pending') run("UPDATE staff_loans SET status = 'reviewed', reviewed_by = ?, reviewed_at = ?, decision_note = ? WHERE id = ?", user.id, nowIso(), cleanText(b.note) || null, l.id);
      else if (action === 'reject' && ['pending', 'reviewed', 'approved'].includes(l.status)) run("UPDATE staff_loans SET status = 'rejected', decision_note = ? WHERE id = ?", cleanText(b.note) || null, l.id);
      else if (action === 'approve' && ['pending', 'reviewed'].includes(l.status)) {
        const approved = posMoney(b.amountApproved) || l.amount;
        let rate = rateFor(l.loan_type, approved);
        if (b.interestRate !== undefined && b.interestRate !== '' && Number(b.interestRate) !== rate) {
          if (!s.allowRateOverride) return sendJson(res, 400, { error: 'Changing the interest rate is switched off in Loan Settings' }), true;
          if (s.requireOverrideReason && !cleanText(b.note)) return sendJson(res, 400, { error: 'Give a reason for changing the rate' }), true;
          rate = Number(b.interestRate) || 0;
        }
        const total = l.loan_type === 'grant' ? 0 : round2(approved * (1 + rate / 100));
        const months = Number(b.repaymentMonths) || l.repayment_months || null;
        const monthly = posMoney(b.monthlyDeduction) || (months ? round2(total / months) : 0);
        if (l.loan_type !== 'grant' && !monthly) return sendJson(res, 400, { error: 'Set the monthly deduction or repayment months' }), true;
        run("UPDATE staff_loans SET status = 'approved', amount_approved = ?, interest_rate = ?, total_repayable = ?, monthly_deduction = ?, repayment_months = ?, approved_by = ?, approved_at = ?, decision_note = COALESCE(?, decision_note) WHERE id = ?",
          approved, rate, total, monthly, months, user.id, nowIso(), cleanText(b.note) || null, l.id);
      } else if (action === 'disburse' && l.status === 'approved') {
        F.tx(() => {
          const accountId = Number(b.accountId) || F.defaultFinAccountId();
          run("UPDATE staff_loans SET status = ?, disbursed_at = ?, disbursed_account_id = ?, repayment_status = 'outstanding' WHERE id = ?", l.loan_type === 'grant' ? 'settled' : 'active', nowIso(), accountId, l.id);
          F.addExpense({ category: 'Staff Loans & Advances Disbursed', title: `${l.loan_code} — ${l.name}`, item: l.loan_type === 'grant' ? 'Grant' : l.loan_type === 'advance' ? 'Salary Advance' : 'Loan', description: l.reason, amount: l.amount_approved || l.amount, date: today(), userId: user.id, source: 'loan_disbursement', sourceId: l.id, accountId, method: 'Bank', paidTo: l.name });
        });
      } else return sendJson(res, 400, { error: `Cannot ${action} a ${l.status} loan` }), true;
      return sendJson(res, 200, { ok: true }), true;
    }
    return false;
  }

  function settleLoans() {
    loans({ status: 'active' }).forEach(l => { if (l.loanType !== 'grant' && l.balance <= 0.01) run("UPDATE staff_loans SET status = 'settled', repayment_status = 'repaid' WHERE id = ?", l.id); });
  }

  return { handle, statutory, savedSalaries, loans };
};
