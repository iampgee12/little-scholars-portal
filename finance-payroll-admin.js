// Finance › HRM / Payroll pages (SchoolsFocus layout): Monthly Salaries
// Processing, Salary Payment Schedule, Payroll Settings (Salary Scale, Salary
// Positions, Staff Contracts, PAYE Config, Staff Pay Profiles) and Staff Loans &
// Advances (All Loans, Loan Settings).
(function () {
  const { esc, money, date, dateTime, field, select, val, badge, stats, card, modal, table, options } = FIN;
  const S = { msp: {}, sps: {}, ps: { tab: 'scale' }, sl: { tab: 'loans' } };
  const now = new Date();
  const monthOpts = FIN.MONTHS_LONG.map((m, i) => [String(i + 1), m]);
  const period = (m, y) => `${y}-${String(m).padStart(2, '0')}`;
  const meta = fresh => FIN.payrollMeta(fresh);

  // ══ Monthly Salaries Processing ═══════════════════════════════════════
  FIN.page('monthlySalariesProcessing', async el => {
    const m = await meta(true);
    const st = S.msp;
    el.innerHTML = `${FIN.header('Payroll: Monthly Salary Processing')}
      ${card('⛃ Select Month for Salary Processing', `<div class="fin-grid">
        ${field('Employee Type', select('msp-type', [['all', 'All Staff'], ...m.staffTypes.map(t => [t.key, t.label])], st.type || '', 'Select'), { required: true })}
        ${field('Month', select('msp-month', monthOpts, st.month || String(now.getMonth() + 1), 'Select Salary Month'), { required: true })}
        ${field('Year', FIN.input('msp-year', { type: 'number', value: st.year || now.getFullYear() }), { required: true })}
      </div><div style="text-align:center;margin-top:14px"><button class="fin-btn" onclick="FIN.payroll.mspLoad()">Load List</button></div>
      ${m.paye.engine ? '<div class="fin-note" style="margin-top:12px">PAYE Engine is <b>on</b> — PAYE Tax, Pension, NHIS and NHF are worked out automatically (Payroll Settings › PAYE Config).</div>' : ''}`)}
      <div id="msp-out"></div>`;
    if (st.loaded) mspLoad();
  });
  async function mspLoad() {
    const st = S.msp;
    Object.assign(st, { type: val('msp-type'), month: val('msp-month'), year: val('msp-year') });
    if (!st.type) return showToast('Please select Employee Type');
    if (!st.month) return showToast('Select the salary month');
    st.loaded = true;
    const d = await FIN.get(`/api/admin/payroll/compute?period=${period(st.month, st.year)}&type=${st.type}`);
    st.rows = d.rows;
    st.period = d.period;
    mspDraw();
  }
  function lineCell(i, kind, lines, locked) {
    return `<div id="msp-${kind}-${i}">${lines.map((l, j) => `<div style="display:flex;gap:4px;margin-bottom:4px">
        <input class="field-input" style="padding:5px 7px;font-size:11px" value="${esc(l.name)}" ${locked || l.statutory || l.loanId ? 'disabled' : ''} oninput="FIN.payroll.setLine(${i},'${kind}',${j},'name',this.value)">
        <input class="field-input" type="number" style="padding:5px 7px;font-size:11px;width:95px" value="${l.amount}" ${locked || l.statutory ? 'disabled' : ''} oninput="FIN.payroll.setLine(${i},'${kind}',${j},'amount',this.value)">
        ${locked || l.statutory ? '' : `<button class="fin-btn red sm" onclick="FIN.payroll.dropLine(${i},'${kind}',${j})">✕</button>`}</div>`).join('')}
      ${locked ? '' : `<button class="fin-btn plain sm" onclick="FIN.payroll.addLine(${i},'${kind}')">+Add</button>`}</div>`;
  }
  function mspDraw() {
    const st = S.msp;
    const tot = r => { r.totalAllowances = r.allowances.reduce((s, x) => s + (Number(x.amount) || 0), 0); r.totalDeductions = r.deductions.reduce((s, x) => s + (Number(x.amount) || 0), 0); r.net = (Number(r.basic) || 0) + r.totalAllowances - r.totalDeductions; };
    st.rows.forEach(tot);
    const typeLabel = st.type === 'all' ? 'All Staff' : (FIN.cache.payMeta.staffTypes.find(t => t.key === st.type) || {}).label;
    const included = st.rows.filter(r => !r.excluded);
    document.getElementById('msp-out').innerHTML = `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">▦ Computing ${FIN.monthLabel(st.period)} Salary | Employee Type : ${esc(typeLabel)}</div>
        <div class="fin-actions"><span class="muted">Gross ${money(included.reduce((s, r) => s + r.basic + r.totalAllowances, 0))} · Net ${money(included.reduce((s, r) => s + r.net, 0))}</span></div></div>
      <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>#</th><th>Employee</th><th>Grade Level &amp; Step</th><th>Salary Bank</th><th>Basic Salary</th><th>Allowances</th><th>Deductions</th><th class="num">Total Allowances</th><th class="num">Total Deductions</th><th class="num">Net Salary</th><th>Exclude</th></tr></thead>
      <tbody>${st.rows.map((r, i) => {
        const locked = r.status === 'paid';
        return `<tr style="${r.excluded ? 'opacity:.5' : ''}"><td>${i + 1}</td><td>${esc(r.name)}<div>${badge(r.roleLabel || '', 'grey')}</div><div class="muted">${r.saved ? (locked ? 'Paid' : 'Saved') : 'Not processed'}</div></td>
          <td>${esc(r.gradeLabel || '—')}</td><td class="muted">${esc(r.paymentChannel || 'Cash Payment')}</td>
          <td><input class="field-input" type="number" style="width:110px;padding:5px 7px" value="${r.basic}" ${locked ? 'disabled' : ''} oninput="FIN.payroll.setBasic(${i}, this.value)"></td>
          <td style="min-width:220px">${lineCell(i, 'allowances', r.allowances, locked)}</td><td style="min-width:220px">${lineCell(i, 'deductions', r.deductions, locked)}</td>
          <td class="num" id="msp-ta-${i}">${money(r.totalAllowances)}</td><td class="num" id="msp-td-${i}">${money(r.totalDeductions)}</td><td class="num" id="msp-net-${i}"><b>${money(r.net)}</b></td>
          <td><label class="fin-check" style="color:var(--red)"><input type="checkbox" ${r.excluded ? 'checked' : ''} ${locked ? 'disabled' : ''} onchange="FIN.payroll.exclude(${i}, this.checked)"> Exclude</label></td></tr>`;
      }).join('') || '<tr><td colspan="11" class="fin-empty">No staff records found for the selected criteria.</td></tr>'}</tbody></table></div>
      <div class="fin-foot"><span>Showing ${st.rows.length} entries</span><button class="fin-btn green" onclick="FIN.payroll.mspSave()">Save Computed Salaries</button></div></div>`;
  }
  function refreshRow(i) {
    const r = S.msp.rows[i];
    r.totalAllowances = r.allowances.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    r.totalDeductions = r.deductions.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    r.net = (Number(r.basic) || 0) + r.totalAllowances - r.totalDeductions;
    document.getElementById(`msp-ta-${i}`).textContent = money(r.totalAllowances);
    document.getElementById(`msp-td-${i}`).textContent = money(r.totalDeductions);
    document.getElementById(`msp-net-${i}`).innerHTML = `<b>${money(r.net)}</b>`;
  }
  const P = {
    setBasic(i, v) { S.msp.rows[i].basic = Number(v) || 0; refreshRow(i); },
    setLine(i, kind, j, k, v) { S.msp.rows[i][kind][j][k] = k === 'amount' ? Number(v) || 0 : v; refreshRow(i); },
    addLine(i, kind) { S.msp.rows[i][kind].push({ name: kind === 'allowances' ? 'Allowance' : 'Deduction', amount: 0 }); mspDraw(); },
    dropLine(i, kind, j) { S.msp.rows[i][kind].splice(j, 1); mspDraw(); },
    exclude(i, on) { S.msp.rows[i].excluded = on; mspDraw(); },
  };
  async function mspSave() {
    const st = S.msp;
    const entries = st.rows.filter(r => r.status !== 'paid').map(r => ({ staffId: r.staffId, basic: r.basic, allowances: r.allowances, deductions: r.deductions, excluded: r.excluded }));
    if (!entries.length) return showToast('Nothing to save');
    const r = await FIN.post('/api/admin/payroll/salaries/generate', { period: st.period, entries });
    showToast(`Saved ${r.processed} salary record(s) for ${FIN.monthLabel(st.period)}${r.problems && r.problems.length ? ` — ${r.problems.length} not saved: ${r.problems[0]}` : ''}`);
    mspLoad();
  }

  // ══ Salary Payment Schedule ═══════════════════════════════════════════
  FIN.page('salaryPaymentSchedule', async el => {
    const m = await meta();
    const st = S.sps;
    el.innerHTML = `${FIN.header('Payroll: Salary Payment Schedule')}
      ${card('⛃ Select Salary Payment Schedule to View', `<div class="fin-grid">
        ${field('Employee Type', select('sps-type', [['all', 'All'], ...m.staffTypes.map(t => [t.key, t.label])], st.type || 'all'), { required: true })}
        ${field('Salary Month', select('sps-month', monthOpts, st.month || String(now.getMonth() + 1), 'Select'), { required: true })}
        ${field('Salary Year', FIN.input('sps-year', { type: 'number', value: st.year || now.getFullYear() }), { required: true })}
        ${field('Payment Channel', select('sps-channel', [['all', 'All'], ...m.banks], st.channel || 'all'), { required: true })}
      </div><div style="text-align:center;margin-top:14px"><button class="fin-btn" onclick="FIN.payroll.spsLoad()">🔍 View Salary Payment Schedule</button></div>`)}
      <div id="sps-out"></div>`;
    if (st.loaded) spsLoad();
  });
  async function spsLoad() {
    const st = S.sps;
    Object.assign(st, { type: val('sps-type'), month: val('sps-month'), year: val('sps-year'), channel: val('sps-channel'), loaded: true });
    if (!st.month) return showToast('Please select a Salary Month');
    const p = period(st.month, st.year);
    const d = await FIN.get(`/api/admin/payroll/schedule?period=${p}&type=${st.type}&channel=${encodeURIComponent(st.channel)}`);
    const m = await meta();
    document.getElementById('sps-out').innerHTML = `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">Salary Payment Schedule — ${FIN.monthLabel(p)}</div>
        <div class="fin-actions">${d.byChannel.map(c => badge(`${c.channel}: ${FIN.plain(money(c.amount))}`, 'blue')).join(' ')}</div></div><div id="sps-table"></div></div>`;
    S.spsTable = table(document.getElementById('sps-table'), {
      title: `Salary Payment Schedule ${FIN.monthLabel(p)}`, rows: d.rows, selectable: true, perPage: 100, emptyText: 'No records found. Process this month\'s salaries first from Monthly Salaries Processing.',
      toolbar: () => `<span class="muted">Pay selected from</span> <select class="ctrl-select" style="width:auto" id="sps-acct">${options(m.accounts.map(a => [a.id, a.label]), m.paye.payrollAccountId || (m.accounts.find(a => a.isDefault) || {}).id)}</select> <button class="fin-btn green sm" onclick="FIN.payroll.spsPay()">Mark Paid</button>`,
      columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Employee' }, { key: 'paymentChannel', label: 'Bank / Channel' },
        { key: 'accountNumber', label: 'Account Number', render: r => esc(r.accountNumber || '—') }, { key: 'accountName', label: 'Account Name', render: r => esc(r.accountName || '—') },
        { key: 'basic', label: 'Basic', num: true, render: r => money(r.basic), exportValue: r => r.basic, total: true },
        { key: 'totalAllowances', label: 'Allowances', num: true, render: r => money(r.totalAllowances), exportValue: r => r.totalAllowances, total: true },
        { key: 'totalDeductions', label: 'Deductions', num: true, render: r => `${money(r.totalDeductions)}<div class="muted">${r.deductions.map(x => `${esc(x.name)} ${FIN.whole(x.amount)}`).join(', ')}</div>`, exportValue: r => r.totalDeductions, total: true },
        { key: 'net', label: 'Net Salary', num: true, render: r => `<b>${money(r.net)}</b>`, exportValue: r => r.net, total: true },
        { key: 'status', label: 'Status', render: r => (r.status === 'paid' ? `${badge('Paid', 'green')}<div class="muted">${date(r.paidAt)}</div>` : badge('Pending', 'amber')), exportValue: r => r.status },
        { key: 'slip', label: 'Payslip', noExport: true, sortable: false, render: r => `<button class="fin-btn plain sm" onclick="FIN.payroll.payslip(${r.id})">Payslip</button>` },
      ],
    });
    S.sps.rows = d.rows;
  }
  async function spsPay() {
    const ids = S.spsTable.picked();
    if (!ids.length) return showToast('Tick the salaries to mark paid');
    if (!await FIN.confirm(`Mark ${ids.length} salary(ies) as paid? Each will be recorded under Expenses (Salaries & Staff Wages).`)) return;
    const r = await FIN.post('/api/admin/payroll/salaries/pay', { ids, accountId: val('sps-acct') });
    showToast(`${r.count} salary(ies) marked paid`); spsLoad();
  }
  function payslip(id) {
    const r = S.sps.rows.find(x => x.id === id);
    FIN.print(`Payslip ${r.name}`, `${FIN.schoolHeader()}<h3 style="text-align:center">PAYSLIP — ${FIN.monthLabel(r.period)}</h3>
      <table><tr><th>Employee</th><td>${esc(r.name)} (${esc(r.staffId)})</td><th>Grade</th><td>${esc(r.gradeLabel || '—')}</td></tr><tr><th>Bank</th><td>${esc(r.paymentChannel)}</td><th>Account</th><td>${esc(r.accountNumber || '—')} ${esc(r.accountName || '')}</td></tr></table><br>
      <table><thead><tr><th>Earnings</th><th class="num">Amount</th><th>Deductions</th><th class="num">Amount</th></tr></thead><tbody>
      ${Array.from({ length: Math.max(r.allowances.length + 1, r.deductions.length) }, (_, i) => { const e = i === 0 ? { name: 'Basic Salary', amount: r.basic } : r.allowances[i - 1]; const dd = r.deductions[i]; return `<tr><td>${e ? esc(e.name) : ''}</td><td class="num">${e ? money(e.amount) : ''}</td><td>${dd ? esc(dd.name) : ''}</td><td class="num">${dd ? money(dd.amount) : ''}</td></tr>`; }).join('')}
      <tr><th>Gross Pay</th><th class="num">${money(r.basic + r.totalAllowances)}</th><th>Total Deductions</th><th class="num">${money(r.totalDeductions)}</th></tr></tbody></table>
      <h3 style="text-align:right">Net Pay: ${money(r.net)}</h3>`);
  }

  // ══ Payroll Settings ══════════════════════════════════════════════════
  FIN.page('payrollSettings', async el => {
    el.innerHTML = `${FIN.header('Payroll Settings')}<div class="fin-card">${FIN.tabs('ps', [['scale', '▁▃▅ Salary Scale'], ['positions', '💼 Salary Positions'], ['contracts', '🗎 Staff Contracts'], ['paye', '▦ PAYE Config'], ['profiles', '👤 Staff Pay Profiles']], S.ps.tab, k => { S.ps.tab = k; psDraw(); })}<div class="fin-card-body" id="ps-body"></div></div>`;
    psDraw();
  });
  async function psDraw() {
    const m = await meta(true);
    const body = document.getElementById('ps-body');
    const tab = S.ps.tab;
    if (tab === 'scale') {
      body.innerHTML = `<div class="fin-grid two" style="align-items:start"><div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">☰ Grade Levels</div><button class="fin-btn sm" onclick="FIN.payroll.gradeEdit()">⊞ Add Grade Level</button></div><div id="ps-levels"></div></div>
        <div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">☰ Grade Level Steps</div><button class="fin-btn sm" onclick="FIN.payroll.stepEdit()">⊞ Add Grade Level Step</button></div>
          <div class="fin-card-body" style="padding-bottom:0"><div class="fin-grid">${field('', select('ps-step-filter', [['', 'All Grade Levels'], ...m.levels.map(l => [l.id, l.name])], S.ps.level || ''))}<div><button class="fin-btn outline sm" onclick="FIN.payroll.stepFilter()">⛃ Apply</button> <button class="fin-btn plain sm" onclick="FIN.payroll.stepFilter(true)">✕ Clear</button></div></div></div><div id="ps-steps"></div></div></div>`;
      table(document.getElementById('ps-levels'), { title: 'Grade Levels', rows: m.levels, perPage: 25, columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Grade Level Name' }, { key: 'numeric', label: 'Grade Level Numeric', num: true },
        { key: 'a', label: '', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'Edit',onClick:()=>FIN.payroll.gradeEdit(${r.id})},{label:'Delete',danger:true,onClick:()=>FIN.payroll.remove('grade-levels',${r.id})}])">Actions ▾</button>` }] });
      table(document.getElementById('ps-steps'), { title: 'Grade Level Steps', rows: m.steps.filter(s => !S.ps.level || String(s.gradeLevelId) === String(S.ps.level)), perPage: 25, columns: [
        { key: '#', label: '#', sortable: false }, { key: 'gradeName', label: 'Grade Level' }, { key: 'name', label: 'Step Name' }, { key: 'numeric', label: 'Step Numeric', num: true },
        { key: 'basicSalary', label: 'Basic Salary', num: true, render: r => money(r.basicSalary), exportValue: r => r.basicSalary },
        { key: 'a', label: '', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'Edit',onClick:()=>FIN.payroll.stepEdit(${r.id})},{label:'Delete',danger:true,onClick:()=>FIN.payroll.remove('grade-steps',${r.id})}])">Actions ▾</button>` }] });
    } else if (tab === 'positions') {
      body.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>Salary Positions</b><button class="fin-btn" onclick="FIN.payroll.positionEdit()">+ Add Position</button></div>
        <div class="fin-grid" style="max-width:420px">${field('', select('ps-pos-status', [['', 'All Statuses'], ['active', 'Active'], ['inactive', 'Inactive']], S.ps.posStatus || '', null, 'onchange="FIN.payroll.posFilter(this.value)"'))}</div><div id="ps-pos"></div>`;
      table(document.getElementById('ps-pos'), { title: 'Salary Positions', rows: m.positions.filter(p => !S.ps.posStatus || p.status === S.ps.posStatus), perPage: 25, columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Position Name' }, { key: 'department', label: 'Department', render: r => esc(r.department || '—') },
        { key: 'defaultGradeName', label: 'Default Grade Level', render: r => esc(r.defaultGradeName || '—') }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'active' ? 'green' : 'grey') },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.payroll.positionEdit(${r.id})">Edit</button> <button class="fin-btn red sm" onclick="FIN.payroll.remove('positions',${r.id})">✕</button>` }] });
    } else if (tab === 'contracts') {
      const d = await FIN.get('/api/admin/payroll/contracts');
      S.ps.contracts = d.contracts;
      body.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>Staff Employment Contracts</b><button class="fin-btn" onclick="FIN.payroll.contractEdit()">+ Add Contract</button></div><div id="ps-con"></div>`;
      table(document.getElementById('ps-con'), { title: 'Staff Employment Contracts', rows: d.contracts, perPage: 25, columns: [
        { key: 'name', label: 'Staff Member' }, { key: 'positionName', label: 'Position', render: r => esc(r.positionName || '—') }, { key: 'contractType', label: 'Contract Type', render: r => esc(FIN.cap(r.contractType)) },
        { key: 'startDate', label: 'Start Date', render: r => date(r.startDate) }, { key: 'endDate', label: 'End Date', render: r => date(r.endDate) },
        { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'active' ? 'green' : r.status === 'expired' ? 'red' : 'grey') },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.payroll.contractEdit(${r.id})">Edit</button> <button class="fin-btn red sm" onclick="FIN.payroll.remove('contracts',${r.id})">✕</button>` }] });
    } else if (tab === 'paye') {
      const d = await FIN.get('/api/admin/payroll/paye-configs');
      S.ps.paye = d.configs;
      body.innerHTML = `<b>⚙ PAYE Settings</b><div class="fin-grid two" style="margin-top:12px">
          ${field('PAYE Engine', select('pp-engine', [['0', 'Disabled — manage deductions manually'], ['1', 'Enabled — calculate statutory deductions automatically']], m.paye.engine ? '1' : '0'), { hint: 'Enabling the PAYE Engine will automatically calculate statutory deductions (PAYE Tax, Pension, NHIS, and NHF) on each salary based on the active PAYE configuration. You can still add non-statutory deductions (and benefits) via recurring payroll items, but statutory deductions will be auto-managed by the system.' })}
          ${field('Minimum Net Pay (%)', FIN.input('pp-min', { type: 'number', value: m.paye.minNetPct }), { hint: 'Non-statutory deductions are capped so that net pay never falls below this percentage of gross pay. Default: 46.67% (Nigerian Labour Act - one-third rule). Set to 0 to disable the limit.' })}
          ${field('Payroll Bank Account', select('pp-acct', m.accounts.map(a => [a.id, a.label]), m.paye.payrollAccountId || '', '— Not configured —'), { hint: 'The account used as the payroll wallet / salary bank when posting disbursements to the expense ledger and General Ledger.' })}
          <div><button class="fin-btn" style="width:100%;justify-content:center" onclick="FIN.payroll.payeSave()">💾 Save Settings</button></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 10px"><b>PAYE Tax Band Configurations <span class="muted">— PITA Tax Bands &amp; Statutory Rates</span></b><button class="fin-btn" onclick="FIN.payroll.payeEdit()">+ Add Configuration</button></div>
        <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Effective From</th><th>Pension (Emp)</th><th>Pension (Er)</th><th>NHIS</th><th>NHF</th><th>CRA Fixed</th><th>Tax Bands</th><th>Notes</th><th></th></tr></thead>
        <tbody>${d.configs.map(c => `<tr><td>${date(c.effective_from)}</td><td>${c.pension_emp}%</td><td>${c.pension_er}%</td><td>${c.nhis}%</td><td>${c.nhf}%</td><td>${money(c.cra_fixed)}</td><td>${c.bands.length} bands<div class="muted">${c.bands.map(b => `${b.limit == null ? 'Rest' : FIN.whole(b.limit)} @ ${b.rate}%`).join(', ')}</div></td><td class="muted">${esc(c.notes || '')}</td>
          <td><button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'Edit',onClick:()=>FIN.payroll.payeEdit(${c.id})},{label:'Delete',danger:true,onClick:()=>FIN.payroll.remove('paye-configs',${c.id})}])">Actions ▾</button></td></tr>`).join('')}</tbody></table></div>`;
    } else {
      const d = await FIN.get('/api/admin/payroll/profiles');
      S.ps.staff = d.staff;
      body.innerHTML = '<div class="fin-note" style="margin-bottom:12px">Each staff member\'s grade (which sets the basic salary), salary bank and recurring allowances / deductions. These are the defaults used in Monthly Salaries Processing. A basic salary typed here overrides the grade step.</div><div id="ps-prof"></div>';
      table(document.getElementById('ps-prof'), { title: 'Staff Pay Profiles', rows: d.staff, perPage: 50, columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Employee', render: r => `${esc(r.name)}<div class="muted">${esc(r.staffTypeLabel)}</div>` },
        { key: 'gradeLabel', label: 'Grade Level & Step', render: r => esc(r.gradeLabel || '—') }, { key: 'positionName', label: 'Position', render: r => esc(r.positionName || '—') },
        { key: 'paymentChannel', label: 'Salary Bank', render: r => `${esc(r.paymentChannel)}<div class="muted">${esc(r.accountNumber || '')} ${esc(r.accountName || '')}</div>` },
        { key: 'basic', label: 'Basic Salary', num: true, render: r => money(r.basic), exportValue: r => r.basic },
        { key: 'items', label: 'Allowances / Deductions', render: r => r.items.map(i => `${badge(i.kind === 'allowance' ? '+' : '−', i.kind === 'allowance' ? 'green' : 'red')} ${esc(i.name)} ${FIN.whole(i.amount)}`).join('<br>') || '—', exportValue: r => r.items.map(i => `${i.kind} ${i.name} ${i.amount}`).join('; ') },
        { key: 'a', label: '', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.payroll.profileEdit(${jsArg(r.id)})">Edit</button>` }] });
    }
  }
  async function gradeEdit(id) {
    const m = await meta();
    const g = id ? m.levels.find(x => x.id === id) : {};
    modal({ title: `${id ? 'Edit' : 'Add'} Grade Level`, body: `<div class="fin-grid two">${field('Grade Level Name', FIN.input('gl-name', { value: g.name || '', placeholder: 'e.g. GRADE LEVEL ELEVEN' }), { required: true })}${field('Grade Level Numeric', FIN.input('gl-num', { type: 'number', value: g.numeric || m.levels.length + 1 }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { name: val('gl-name'), numeric: val('gl-num') }; id ? await FIN.put(`/api/admin/payroll/grade-levels/${id}`, b) : await FIN.post('/api/admin/payroll/grade-levels', b); showToast('Saved'); close(); psDraw(); } }] });
  }
  async function stepEdit(id) {
    const m = await meta();
    const s = id ? m.steps.find(x => x.id === id) : {};
    modal({ title: `${id ? 'Edit' : 'Add'} Grade Level Step`, body: `<div class="fin-grid two">${field('Grade Level', select('gs-level', m.levels.map(l => [l.id, l.name]), s.gradeLevelId || S.ps.level || '', 'Select'), { required: true, span: 2 })}
      ${field('Step Name', FIN.input('gs-name', { value: s.name || '', placeholder: 'e.g. STEP THREE' }), { required: true })}${field('Step Numeric', FIN.input('gs-num', { type: 'number', value: s.numeric || 1 }))}
      ${field('Basic Salary (₦ per month)', FIN.input('gs-basic', { type: 'number', value: s.basicSalary || 0 }), { required: true, span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { gradeLevelId: val('gs-level'), name: val('gs-name'), numeric: val('gs-num'), basicSalary: val('gs-basic') }; id ? await FIN.put(`/api/admin/payroll/grade-steps/${id}`, b) : await FIN.post('/api/admin/payroll/grade-steps', b); showToast('Saved'); close(); psDraw(); } }] });
  }
  async function positionEdit(id) {
    const m = await meta();
    const p = id ? m.positions.find(x => x.id === id) : {};
    modal({ title: `${id ? 'Edit' : 'Add'} Position`, body: `<div class="fin-grid two">${field('Position Name', FIN.input('po-name', { value: p.name || '' }), { required: true })}${field('Department', FIN.input('po-dept', { value: p.department || '' }))}
      ${field('Default Grade Level', select('po-grade', m.levels.map(l => [l.id, l.name]), p.defaultGradeLevelId || '', 'None'))}${field('Status', select('po-status', [['active', 'Active'], ['inactive', 'Inactive']], p.status || 'active'))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { name: val('po-name'), department: val('po-dept'), defaultGradeLevelId: val('po-grade'), status: val('po-status') }; id ? await FIN.put(`/api/admin/payroll/positions/${id}`, b) : await FIN.post('/api/admin/payroll/positions', b); showToast('Saved'); close(); psDraw(); } }] });
  }
  async function contractEdit(id) {
    const m = await meta();
    const prof = (await FIN.get('/api/admin/payroll/profiles')).staff;
    const c = id ? S.ps.contracts.find(x => x.id === id) : {};
    modal({ title: `${id ? 'Edit' : 'Add'} Contract`, body: `<div class="fin-grid two">${field('Staff Member', select('co-staff', prof.map(s => [s.id, s.name]), c.staffId || '', 'Select'), { required: true })}${field('Position', select('co-pos', m.positions.map(p => [p.id, p.name]), c.positionId || '', 'None'))}
      ${field('Contract Type', select('co-type', [['permanent', 'Permanent'], ['temporary', 'Temporary'], ['contract', 'Fixed-term Contract'], ['part_time', 'Part-time'], ['probation', 'Probation']], c.contractType || 'permanent'))}${field('Status', select('co-status', [['active', 'Active'], ['ended', 'Ended'], ['terminated', 'Terminated']], c.status === 'expired' ? 'active' : c.status || 'active'))}
      ${field('Start Date', FIN.input('co-start', { type: 'date', value: c.startDate || '' }))}${field('End Date', FIN.input('co-end', { type: 'date', value: c.endDate || '' }))}
      ${field('Probation Ends', FIN.input('co-prob', { type: 'date', value: c.probationEnd || '' }))}${field('Notes', FIN.input('co-notes', { value: c.notes || '' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { staffId: val('co-staff'), positionId: val('co-pos'), contractType: val('co-type'), status: val('co-status'), startDate: val('co-start'), endDate: val('co-end'), probationEnd: val('co-prob'), notes: val('co-notes') }; id ? await FIN.put(`/api/admin/payroll/contracts/${id}`, b) : await FIN.post('/api/admin/payroll/contracts', b); showToast('Saved'); close(); psDraw(); } }] });
  }
  async function payeSave() {
    await FIN.put('/api/admin/payroll/paye-settings', { engine: val('pp-engine') === '1', minNetPct: val('pp-min'), payrollAccountId: val('pp-acct') });
    showToast('PAYE settings saved'); FIN.cache.payMeta = null;
  }
  function payeEdit(id) {
    const c = id ? S.ps.paye.find(x => x.id === id) : { effective_from: FIN.today(), pension_emp: 8, pension_er: 10, nhis: 1.75, nhf: 2.5, cra_fixed: 200000, bands: [{ limit: 300000, rate: 7 }, { limit: 300000, rate: 11 }, { limit: 500000, rate: 15 }, { limit: 500000, rate: 19 }, { limit: 1600000, rate: 21 }, { limit: null, rate: 24 }] };
    const band = b => `<tr><td><input class="field-input" type="number" data-k="limit" value="${b.limit == null ? '' : b.limit}" placeholder="Rest of income"></td><td><input class="field-input" type="number" step="0.01" data-k="rate" value="${b.rate}"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()">✕</button></td></tr>`;
    P._band = band;
    modal({ title: `${id ? 'Edit' : 'Add'} PAYE Configuration`, size: 'wide', body: `<div class="fin-grid">${field('Effective From', FIN.input('pc-from', { type: 'date', value: c.effective_from }), { required: true })}
      ${field('Pension (Employee) %', FIN.input('pc-pe', { type: 'number', value: c.pension_emp }))}${field('Pension (Employer) %', FIN.input('pc-pr', { type: 'number', value: c.pension_er }))}
      ${field('NHIS %', FIN.input('pc-nhis', { type: 'number', value: c.nhis }))}${field('NHF %', FIN.input('pc-nhf', { type: 'number', value: c.nhf }))}${field('CRA Fixed (₦ per year)', FIN.input('pc-cra', { type: 'number', value: c.cra_fixed }))}</div>
      <div class="fin-section-label">Annual Tax Bands (applied in order; leave the last limit empty for "the rest")</div>
      <table class="fin-table fin-lines"><thead><tr><th>Band Size (₦ per year)</th><th>Rate %</th><th></th></tr></thead><tbody id="pc-bands">${c.bands.map(band).join('')}</tbody></table>
      <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('pc-bands').insertAdjacentHTML('beforeend', FIN.payroll._band({limit:'',rate:0}))">+ Add Band</button>
      <div style="margin-top:12px">${field('Notes', FIN.input('pc-notes', { value: c.notes || '' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const bands = [...document.querySelectorAll('#pc-bands tr')].map(tr => ({ limit: tr.querySelector('[data-k=limit]').value, rate: tr.querySelector('[data-k=rate]').value }));
        const b = { effectiveFrom: val('pc-from'), pensionEmp: val('pc-pe'), pensionEr: val('pc-pr'), nhis: val('pc-nhis'), nhf: val('pc-nhf'), craFixed: val('pc-cra'), bands, notes: val('pc-notes') };
        id ? await FIN.put(`/api/admin/payroll/paye-configs/${id}`, b) : await FIN.post('/api/admin/payroll/paye-configs', b); showToast('Saved'); close(); psDraw();
      } }] });
  }
  async function profileEdit(staffId) {
    const m = await meta();
    const s = S.ps.staff.find(x => x.id === staffId);
    const line = i => `<tr><td><select class="ctrl-select" data-k="kind">${options([['allowance', 'Allowance'], ['deduction', 'Deduction']], i.kind || 'allowance')}</select></td><td><input class="field-input" data-k="name" value="${esc(i.name || '')}" placeholder="e.g. Housing"></td><td><input class="field-input" type="number" data-k="amount" value="${i.amount || ''}"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()">✕</button></td></tr>`;
    P._payLine = line;
    modal({ title: `Pay Profile — ${esc(s.name)}`, size: 'wide', body: `<div class="fin-grid two">
        ${field('Grade Level & Step', select('pf-step', m.steps.map(x => [x.id, `${x.gradeName} / ${x.name} — ${FIN.plain(money(x.basicSalary))}`]), s.gradeStepId || '', 'None'))}
        ${field('Position', select('pf-pos', m.positions.map(p => [p.id, p.name]), s.positionId || '', 'None'))}
        ${field('Basic Salary override (₦)', FIN.input('pf-basic', { type: 'number', value: s.baseOverride || 0 }), { hint: 'Leave 0 to use the grade step\'s basic salary.' })}
        ${field('Salary Bank / Payment Channel', `<input class="field-input" id="pf-bank" list="pf-banks" value="${esc(s.paymentChannel)}"><datalist id="pf-banks">${m.banks.map(b => `<option value="${esc(b)}">`).join('')}</datalist>`)}
        ${field('Account Number', FIN.input('pf-accno', { value: s.accountNumber || '' }))}${field('Account Name', FIN.input('pf-accname', { value: s.accountName || s.name }))}</div>
      <div class="fin-section-label">Recurring Allowances & Deductions (every month)</div>
      <table class="fin-table fin-lines"><thead><tr><th style="width:140px">Type</th><th>Name</th><th style="width:140px">Amount (₦)</th><th></th></tr></thead><tbody id="pf-lines">${s.items.map(line).join('')}</tbody></table>
      <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('pf-lines').insertAdjacentHTML('beforeend', FIN.payroll._payLine({}))">+ Add Line</button>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const items = [...document.querySelectorAll('#pf-lines tr')].map(tr => ({ kind: tr.querySelector('[data-k=kind]').value, name: tr.querySelector('[data-k=name]').value, amount: tr.querySelector('[data-k=amount]').value }));
        await FIN.put(`/api/admin/payroll/profiles/${encodeURIComponent(staffId)}`, { gradeStepId: val('pf-step'), positionId: val('pf-pos'), baseSalary: val('pf-basic'), paymentChannel: val('pf-bank'), accountNumber: val('pf-accno'), accountName: val('pf-accname'), items });
        showToast('Pay profile saved'); close(); psDraw();
      } }] });
  }
  async function remove(kind, id) {
    if (!await FIN.confirm('Delete this?')) return;
    try { await FIN.del(`/api/admin/payroll/${kind}/${id}`); showToast('Deleted'); FIN.cache.payMeta = null; psDraw(); } catch (err) { showToast(err.message); }
  }

  // ══ Staff Loans & Advances ════════════════════════════════════════════
  const LOAN_TYPE = { loan: 'Loan', advance: 'Salary Advance', grant: 'Grant' };
  const loanBadge = s => badge(FIN.cap(s), { pending: 'amber', reviewed: 'cyan', approved: 'blue', active: 'green', settled: 'grey', rejected: 'red' }[s] || 'grey');
  FIN.page('staffLoansAdvances', async el => {
    el.innerHTML = `${FIN.header('Staff Loans & Advances')}<div class="fin-card">${FIN.tabs('sl', [['loans', '☰ All Loans'], ['settings', '⚙ Loan Settings']], S.sl.tab, k => { S.sl.tab = k; slDraw(); })}<div class="fin-card-body" id="sl-body"></div></div>`;
    slDraw();
  });
  async function slDraw() {
    const body = document.getElementById('sl-body');
    if (S.sl.tab === 'settings') return loanSettings(body);
    body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b>↘ Staff Loans & Advances</b><button class="fin-btn" onclick="FIN.payroll.loanApply()">+ Apply for Loan</button></div>
      <div class="fin-grid">${field('Status', select('sl-status', [['', 'All Statuses'], ['pending', 'Pending'], ['reviewed', 'Reviewed'], ['approved', 'Approved'], ['active', 'Active'], ['settled', 'Settled'], ['rejected', 'Rejected']], S.sl.status || ''))}
        ${field('Loan Type', select('sl-type', [['', 'All Types'], ['loan', 'Loan'], ['advance', 'Advance'], ['grant', 'Grant']], S.sl.type || ''))}
        <div><button class="fin-btn outline" onclick="FIN.payroll.slLoad()">⛃ Apply</button> <button class="fin-btn plain" onclick="document.getElementById('sl-status').value='';document.getElementById('sl-type').value='';FIN.payroll.slLoad()">✕ Clear</button></div></div>
      <div id="sl-table" style="margin-top:12px"></div>`;
    slLoad();
  }
  async function slLoad() {
    Object.assign(S.sl, { status: val('sl-status'), type: val('sl-type') });
    const d = await FIN.get(`/api/admin/payroll/loans${FIN.qs({ status: S.sl.status, type: S.sl.type })}`);
    S.sl.rows = d.loans;
    table(document.getElementById('sl-table'), { title: 'Staff Loans & Advances', rows: d.loans, perPage: 25, columns: [
      { key: '#', label: '#', sortable: false }, { key: 'loanCode', label: 'Loan Code' }, { key: 'name', label: 'Applicant', render: r => `${esc(r.name)}<div class="muted">${date(r.issuedAt)}</div>` },
      { key: 'loanType', label: 'Type', render: r => esc(LOAN_TYPE[r.loanType] || r.loanType) },
      { key: 'amountRequested', label: 'Amount Req.', num: true, render: r => money(r.amountRequested), exportValue: r => r.amountRequested },
      { key: 'amountApproved', label: 'Amount Approved', num: true, render: r => (r.amountApproved != null ? money(r.amountApproved) : '—'), exportValue: r => r.amountApproved },
      { key: 'balance', label: 'Balance', num: true, render: r => (r.balance != null ? `${money(r.balance)}<div class="muted">${r.monthlyDeduction ? `${FIN.whole(r.monthlyDeduction)}/month` : ''}</div>` : '—'), exportValue: r => r.balance },
      { key: 'status', label: 'Status', render: r => loanBadge(r.status) },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.payroll.loanMenu(this, ${r.id})">Actions ▾</button>` }] });
  }
  function loanMenu(btn, id) {
    const l = S.sl.rows.find(x => x.id === id);
    const act = a => () => loanAction(id, a);
    FIN.menu(btn, [
      { label: 'View', onClick: () => loanView(id) },
      ...(l.status === 'pending' ? [{ label: 'Mark Reviewed', onClick: act('review') }] : []),
      ...(['pending', 'reviewed'].includes(l.status) ? [{ label: 'Approve', onClick: () => loanApprove(id) }] : []),
      ...(['pending', 'reviewed', 'approved'].includes(l.status) ? [{ label: 'Reject', danger: true, onClick: act('reject') }] : []),
      ...(l.status === 'approved' ? [{ label: 'Disburse', onClick: () => loanDisburse(id) }] : []),
      ...(l.status === 'active' && l.loanType !== 'grant' ? [{ label: 'Record Repayment', onClick: () => loanRepay(id) }] : []),
    ]);
  }
  async function loanAction(id, action) {
    const note = action === 'reject' ? await (window.uiPrompt ? uiPrompt('Reason for rejecting (optional):') : prompt('Reason:')) : '';
    if (note === null) return;
    try { await FIN.post(`/api/admin/payroll/loans/${id}/action`, { action, note }); showToast(`Loan ${action === 'review' ? 'marked reviewed' : 'rejected'}`); slLoad(); } catch (err) { showToast(err.message); }
  }
  function loanView(id) {
    const l = S.sl.rows.find(x => x.id === id);
    modal({ title: `${esc(l.loanCode)} — ${esc(l.name)}`, size: 'wide', body: `<dl class="fin-kv"><dt>Type</dt><dd>${esc(LOAN_TYPE[l.loanType])}</dd><dt>Status</dt><dd>${loanBadge(l.status)}</dd><dt>Purpose</dt><dd>${esc(l.purpose || '—')}</dd>
      <dt>Requested</dt><dd>${money(l.amountRequested)}</dd><dt>Approved</dt><dd>${l.amountApproved != null ? money(l.amountApproved) : '—'}</dd><dt>Interest</dt><dd>${l.interestRate || 0}%</dd><dt>Total Repayable</dt><dd>${money(l.totalRepayable)}</dd>
      <dt>Monthly Deduction</dt><dd>${money(l.monthlyDeduction)}${l.repaymentMonths ? ` × ${l.repaymentMonths} months` : ''}${l.startMonth ? ` from ${FIN.MONTHS_LONG[l.startMonth - 1]} ${l.startYear}` : ''}</dd>
      <dt>Repaid</dt><dd>${money(l.repaid)}</dd><dt>Balance</dt><dd>${l.balance != null ? money(l.balance) : '—'}</dd><dt>Disbursement Bank</dt><dd>${esc(l.disbBank || '—')} ${esc(l.disbAccountNumber || '')} ${esc(l.disbAccountName || '')}</dd>
      <dt>Guarantor</dt><dd>${esc(l.guarantorName || '—')} ${l.guarantorRelationship ? `(${esc(l.guarantorRelationship)})` : ''} ${esc(l.guarantorPhone || '')} ${esc(l.guarantorEmail || '')}</dd><dt>Document</dt><dd>${FIN.docLink(l.documentPath)}</dd><dt>Note</dt><dd>${esc(l.decisionNote || '—')}</dd></dl>
      ${l.repayments.length ? `<div class="fin-section-label">Repayments</div><table class="fin-table"><thead><tr><th>Date</th><th>Source</th><th class="num">Amount</th><th>Note</th></tr></thead><tbody>${l.repayments.map(p => `<tr><td>${date(p.paidAt)}</td><td>${esc(FIN.cap(p.source))}</td><td class="num">${money(p.amount)}</td><td>${esc(p.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}`,
      buttons: [{ label: 'Close', cls: 'plain' }] });
  }
  function loanApprove(id) {
    const l = S.sl.rows.find(x => x.id === id);
    modal({ title: `Approve ${esc(l.loanCode)}`, body: `<div class="fin-grid two">${field('Amount Approved (₦)', FIN.input('la-amt', { type: 'number', value: l.amountRequested }), { required: true })}${field('Interest Rate %', FIN.input('la-rate', { type: 'number', value: l.interestRate || 0 }), { hint: 'Only changeable when allowed in Loan Settings' })}
      ${l.loanType === 'grant' ? '' : `${field('Repayment Months', FIN.input('la-months', { type: 'number', value: l.repaymentMonths || '' }))}${field('Monthly Deduction (₦)', FIN.input('la-monthly', { type: 'number', placeholder: 'Worked out from months if empty' }))}`}
      ${field('Note / Reason', FIN.input('la-note'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Approve', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/payroll/loans/${id}/action`, { action: 'approve', amountApproved: val('la-amt'), interestRate: val('la-rate'), repaymentMonths: val('la-months'), monthlyDeduction: val('la-monthly'), note: val('la-note') }); showToast('Loan approved'); close(); slLoad(); } }] });
  }
  async function loanDisburse(id) {
    const m = await meta();
    modal({ title: 'Disburse', body: `${field('Paid From', select('ld-acct', m.accounts.map(a => [a.id, a.label]), m.paye.payrollAccountId || (m.accounts.find(a => a.isDefault) || {}).id))}<div class="fin-note" style="margin-top:12px">The money is recorded under Expenses (Staff Loans & Advances Disbursed). Repayments are then deducted from salary each month.</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Disburse', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/payroll/loans/${id}/action`, { action: 'disburse', accountId: val('ld-acct') }); showToast('Loan disbursed'); close(); slLoad(); } }] });
  }
  async function loanRepay(id) {
    const m = await meta();
    const l = S.sl.rows.find(x => x.id === id);
    modal({ title: `Repayment — ${esc(l.loanCode)}`, body: `<div class="fin-note" style="margin-bottom:10px">Outstanding: <b>${money(l.balance)}</b></div><div class="fin-grid two">${field('Amount (₦)', FIN.input('lr-amt', { type: 'number', value: l.balance }), { required: true })}${field('Method', select('lr-method', ['Cash', 'Bank', 'Transfer'], 'Cash'))}
      ${field('Received Into', select('lr-acct', m.accounts.map(a => [a.id, a.label]), (m.accounts.find(a => a.isDefault) || {}).id))}${field('Note', FIN.input('lr-note'))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Record Repayment', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/payroll/loans/${id}/repay`, { amount: val('lr-amt'), method: val('lr-method'), accountId: val('lr-acct'), note: val('lr-note') }); showToast('Repayment recorded'); close(); slLoad(); } }] });
  }
  async function loanApply() {
    const m = await meta();
    const prof = (await FIN.get('/api/admin/payroll/profiles')).staff;
    const s = m.loanSettings;
    P._staff = prof;
    modal({ title: '🗎 New Loan Application', size: 'wide', body: `<div class="fin-grid two">
        ${field('Staff Type', select('ln-stype', m.staffTypes.map(t => [t.key, t.label]), '', '— Select —', 'onchange="FIN.payroll.loanStaff()"'), { required: true })}
        ${field('Staff Member', select('ln-staff', [], '', '— Select staff type first —', 'onchange="FIN.payroll.loanLimit()"'), { required: true })}
        ${field('Loan Type', select('ln-type', [['loan', 'Loan'], ['advance', 'Salary Advance'], ['grant', 'Grant (non-repayable)']].filter(([k]) => s.enabledTypes.includes(k)), '', '— Select —', 'onchange="FIN.payroll.loanLimit()"'), { required: true })}
        ${field('Amount Requested', FIN.input('ln-amt', { type: 'number', placeholder: '₦ 0.00' }), { required: true, hint: '<span id="ln-limit">Your effective limit: —</span>' })}
        ${field('Purpose', '<textarea class="field-input" id="ln-purpose" rows="2" placeholder="Briefly describe the reason for this loan request"></textarea>', { required: true, span: 2 })}
        ${field('Bank Account for Disbursement', '<div class="field-input" id="ln-bank" style="background:var(--black-3)">— Select staff member first —</div>', { required: true, span: 2, hint: 'Loaded after selecting a staff member above.' })}
      </div>
      <div class="fin-section-label">▤ Repayment Preference</div><div class="fin-grid">
        ${field('Preferred Repayment Months (optional)', FIN.input('ln-months', { type: 'number' }), { required: s.requireRepaymentPreference })}
        ${field('Preferred Start Month (optional)', select('ln-smonth', FIN.MONTHS.map((x, i) => [i + 1, x]), '', '— Month —'))}
        ${field('Preferred Start Year (optional)', FIN.input('ln-syear', { type: 'number', value: now.getFullYear() }))}
        <div><button class="fin-btn plain sm" onclick="FIN.payroll.loanCheck()">Run Payroll Checks</button><div id="ln-check" class="muted" style="margin-top:4px"></div></div></div>
      <div class="fin-section-label">⚇ Guarantor Information ${s.requireGuarantor ? '(required)' : '(optional)'}</div><div class="fin-grid two">
        ${field('Guarantor Name', FIN.input('ln-gname'))}${field('Relationship', FIN.input('ln-grel', { placeholder: 'e.g. Colleague, Supervisor' }))}${field('Phone', FIN.input('ln-gphone'))}${field('Email', FIN.input('ln-gemail'))}</div>
      <div style="margin-top:12px">${field(`Supporting Document ${s.requireDocument ? '' : '(optional)'}`, '<input type="file" class="field-input" id="ln-doc" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png">', { hint: 'Accepted: PDF, DOC, DOCX, JPG, PNG. Max: 5MB.' })}</div>`,
      buttons: [{ label: 'Close', cls: 'plain' }, { label: 'Submit Application', onClick: async (o, close) => {
        const document_ = await FIN.fileToDataUrl(document.getElementById('ln-doc'));
        await FIN.api('/api/admin/payroll/loans', { method: 'POST', body: { staffId: val('ln-staff'), loanType: val('ln-type'), amount: val('ln-amt'), purpose: val('ln-purpose'), repaymentMonths: val('ln-months'), startMonth: val('ln-smonth'), startYear: val('ln-syear'),
          guarantorName: val('ln-gname'), guarantorRelationship: val('ln-grel'), guarantorPhone: val('ln-gphone'), guarantorEmail: val('ln-gemail'), document: document_ } });
        showToast('Loan application submitted'); close(); slLoad();
      } }] });
  }
  function loanStaff() {
    const type = val('ln-stype');
    document.getElementById('ln-staff').innerHTML = options(P._staff.filter(s => s.staffType === type).map(s => [s.id, s.name]), '', '— Select —');
  }
  async function loanLimit() {
    const id = val('ln-staff');
    if (!id) return;
    const d = await FIN.get(`/api/admin/payroll/loans/limit?staffId=${encodeURIComponent(id)}&type=${val('ln-type') || 'loan'}`);
    document.getElementById('ln-limit').textContent = `Your effective limit: ${d.limit == null ? 'No limit set' : FIN.plain(money(d.limit))}`;
    const s = d.staff || {};
    document.getElementById('ln-bank').textContent = `${s.paymentChannel || 'Cash Payment'} ${s.accountNumber || ''} ${s.accountName || ''}`;
  }
  async function loanCheck() {
    const id = val('ln-staff');
    const months = Number(val('ln-months'));
    const amt = Number(val('ln-amt'));
    if (!id || !months || !amt) return showToast('Choose the staff member, amount and repayment months first');
    const s = P._staff.find(x => x.id === id);
    const monthly = amt / months;
    const ok = !s.basic || monthly <= s.basic * 0.5;
    document.getElementById('ln-check').innerHTML = `${FIN.plain(money(monthly))}/month = ${s.basic ? `${(monthly / s.basic * 100).toFixed(1)}% of basic salary` : 'no basic salary set'} ${ok ? '<span style="color:var(--green)">✓ OK</span>' : '<span style="color:var(--red)">✕ more than half of basic salary</span>'}`;
  }
  async function loanSettings(body) {
    const { settings: s } = await FIN.get('/api/admin/payroll/loan-settings');
    const m = await meta();
    const chk = (id, on, label, hint = '') => `<label class="fin-check" style="display:flex;align-items:flex-start;margin:6px 0"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> <span><b>${label}</b>${hint ? `<div class="muted">${hint}</div>` : ''}</span></label>`;
    body.innerHTML = `<b>⚙ Loan Application Settings</b>
      ${card('⊙ Enabled Loan Types', `<div class="muted" style="margin-bottom:6px">Select which loan types staff may apply for. Only enabled types will appear on the application form. Disable a type at any time to close that window — existing loans are not affected. At least one type must be enabled, otherwise applications cannot be submitted.</div>
        <div class="fin-grid">${chk('ls-loan', s.enabledTypes.includes('loan'), 'Loan', 'Standard repayable loan — governed by salary multiple & interest rate policy')}${chk('ls-advance', s.enabledTypes.includes('advance'), 'Salary Advance', 'Advance against salary — governed by max advance months setting')}${chk('ls-grant', s.enabledTypes.includes('grant'), 'Grant', 'Non-repayable grant — no interest, no repayment schedule')}</div>`)}
      ${card('⚇ Allowed Staff Types', `<div class="muted">Which staff types can submit loan applications.</div>${chk('ls-all', s.allowedStaffTypes.includes('all'), 'All Staff Types')}<div class="fin-grid">${m.staffTypes.map(t => chk(`ls-st-${t.key}`, s.allowedStaffTypes.includes(t.key), t.label)).join('')}</div>`)}
      ${card('▤ Contract Eligibility for Loans', `<div class="muted">By default, only permanent staff who have completed probation may apply. Tick below to extend eligibility.</div><div class="fin-grid">${chk('ls-prob', s.allowProbation, 'Allow staff on probation', 'Staff whose probation period has not yet ended can apply.')}${chk('ls-temp', s.allowTemporary, 'Allow temporary contract staff', 'Staff on temporary contracts can apply.')}</div>`)}
      ${card('₦ Limits & Interest', `<div class="fin-grid">${field('Salary Multiple (0 = disabled)', FIN.input('ls-mult', { type: 'number', value: s.salaryMultiple }))}${field('Hard Ceiling / Cap (0 = no cap)', FIN.input('ls-cap', { type: 'number', value: s.hardCap }))}${field('Max Salary Advance Months (0 = no cap)', FIN.input('ls-adv', { type: 'number', value: s.maxAdvanceMonths }))}
        ${field('Interest Rate Mode', select('ls-mode', [['per_type', 'Per type — different rates for Loan vs Salary Advance'], ['flat', 'Single flat rate — one rate for all loan types and amounts'], ['bands', 'Amount bands — tiered rates by loan amount for Loan type']], s.interestMode))}
        ${field('Loan Rate % (0 = interest-free)', FIN.input('ls-lr', { type: 'number', value: s.loanRate }))}${field('Salary Advance Rate %', FIN.input('ls-ar', { type: 'number', value: s.advanceRate }))}${field('Flat Rate %', FIN.input('ls-fr', { type: 'number', value: s.flatRate }))}${field('Loan fallback rate % (if no band matches)', FIN.input('ls-fb', { type: 'number', value: s.fallbackRate }))}</div>
        <div class="fin-section-label">Amount Bands (for "Amount bands" mode)</div><table class="fin-table fin-lines"><thead><tr><th>From (₦)</th><th>To (₦)</th><th>Rate %</th><th></th></tr></thead><tbody id="ls-bands">${(s.bands || []).map(b => `<tr><td><input class="field-input" type="number" data-k="min" value="${b.min}"></td><td><input class="field-input" type="number" data-k="max" value="${b.max || ''}"></td><td><input class="field-input" type="number" data-k="rate" value="${b.rate}"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()">✕</button></td></tr>`).join('')}</tbody></table>
        <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('ls-bands').insertAdjacentHTML('beforeend','<tr><td><input class=&quot;field-input&quot; type=&quot;number&quot; data-k=&quot;min&quot;></td><td><input class=&quot;field-input&quot; type=&quot;number&quot; data-k=&quot;max&quot;></td><td><input class=&quot;field-input&quot; type=&quot;number&quot; data-k=&quot;rate&quot;></td><td></td></tr>')">+ Add Band</button>
        <div class="fin-grid" style="margin-top:12px">${chk('ls-override', s.allowRateOverride, 'Allow approver to change the interest rate')}${chk('ls-reason', s.requireOverrideReason, 'Require a reason when rate is overridden')}</div>`)}
      ${card('▤ Application Form', `<div class="fin-grid">${chk('ls-doc', s.requireDocument, 'Supporting Document Upload', 'Make a supporting document required')}${chk('ls-guar', s.requireGuarantor, 'Guarantor Information', 'Make guarantor information required')}${chk('ls-rp', s.requireRepaymentPreference, 'Repayment Preference', 'Make repayment months required')}</div>`)}
      <button class="fin-btn" onclick="FIN.payroll.loanSettingsSave()">💾 Save Settings</button>`;
  }
  async function loanSettingsSave() {
    const m = await meta();
    const on = id => document.getElementById(id).checked;
    const body = {
      enabledTypes: ['loan', 'advance', 'grant'].filter(t => on(`ls-${t}`)),
      allowedStaffTypes: on('ls-all') ? ['all'] : m.staffTypes.map(t => t.key).filter(k => on(`ls-st-${k}`)),
      allowProbation: on('ls-prob'), allowTemporary: on('ls-temp'), salaryMultiple: val('ls-mult'), hardCap: val('ls-cap'), maxAdvanceMonths: val('ls-adv'),
      interestMode: val('ls-mode'), loanRate: val('ls-lr'), advanceRate: val('ls-ar'), flatRate: val('ls-fr'), fallbackRate: val('ls-fb'),
      bands: [...document.querySelectorAll('#ls-bands tr')].map(tr => ({ min: Number(tr.querySelector('[data-k=min]').value) || 0, max: Number(tr.querySelector('[data-k=max]').value) || null, rate: Number(tr.querySelector('[data-k=rate]').value) || 0 })),
      allowRateOverride: on('ls-override'), requireOverrideReason: on('ls-reason'), requireDocument: on('ls-doc'), requireGuarantor: on('ls-guar'), requireRepaymentPreference: on('ls-rp'),
    };
    await FIN.put('/api/admin/payroll/loan-settings', body);
    showToast('Loan settings saved'); FIN.cache.payMeta = null;
  }

  FIN.payroll = Object.assign(P, { mspLoad, mspSave, spsLoad, spsPay, payslip, gradeEdit, stepEdit, stepFilter: clear => { S.ps.level = clear ? '' : val('ps-step-filter'); psDraw(); }, posFilter: v => { S.ps.posStatus = v; psDraw(); },
    positionEdit, contractEdit, payeSave, payeEdit, profileEdit, remove, slLoad, loanMenu, loanApply, loanStaff, loanLimit, loanCheck, loanSettingsSave });
})();
