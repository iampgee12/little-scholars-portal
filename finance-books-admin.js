// Finance › Income & Expenses pages (SchoolsFocus layout): Expense Requests,
// Expenses, Income (each with heads / sub-heads), Income & Expenses
// Analytics, Bank Balance Report, Cash Flow Statement and Account Ledger.
(function () {
  const { esc, money, date, dateTime, field, select, val, badge, stats, card, modal, table, options, pct } = FIN;
  const S = { er: { quick: 'this_year', status: 'active' }, expenses: { quick: 'this_year', view: 'item', tab: 'main' }, income: { quick: 'this_year', tab: 'main' }, iea: { period: 'this_session' }, bb: {}, cf: {}, al: {} };
  const meta = fresh => FIN.financeMeta(fresh);
  const headOptions = (m, type, sel, placeholder) => options((type === 'expense' ? m.expenseHeads : m.incomeHeads).map(h => [h.name, h.name]), sel, placeholder);
  const accountOptions = (m, sel, placeholder) => options(m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), sel, placeholder);
  const glBadge = s => badge(s, s === 'Posted' ? 'green' : 'grey');

  // date filter block shared by the lists
  function dateFilter(prefix, st) {
    return `${field('Quick Date Filters', select(`${prefix}-quick`, FIN.QUICK, st.quick, null, `onchange="FIN.books.quick('${prefix}', this.value)"`))}
      <div id="${prefix}-custom" style="${st.quick === 'custom' ? '' : 'display:none'};grid-column:span 2">${field('From — To', `<div style="display:flex;gap:6px;align-items:center"><input type="date" class="field-input" id="${prefix}-from" value="${st.from || ''}"><span class="muted">TO</span><input type="date" class="field-input" id="${prefix}-to" value="${st.to || ''}"></div>`)}</div>`;
  }
  function readDates(prefix, st) {
    st.quick = val(`${prefix}-quick`);
    if (st.quick === 'custom') { st.from = val(`${prefix}-from`); st.to = val(`${prefix}-to`); } else Object.assign(st, FIN.quickRange(st.quick));
  }
  function quick(prefix, v) { document.getElementById(`${prefix}-custom`).style.display = v === 'custom' ? '' : 'none'; }

  // item picker: existing sub-heads of the chosen head, or type a new one
  function itemField(prefix, m, type, head, value) {
    const h = (type === 'expense' ? m.expenseHeads : m.incomeHeads).find(x => x.name === head);
    return `<input class="field-input" id="${prefix}-item" list="${prefix}-items" value="${esc(value || '')}" placeholder="Type Or Select Item"><datalist id="${prefix}-items">${(h ? h.items : []).map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>`;
  }
  async function refreshItems(prefix, type) {
    const m = await meta();
    const h = (type === 'expense' ? m.expenseHeads : m.incomeHeads).find(x => x.name === val(`${prefix}-head`));
    document.getElementById(`${prefix}-items`).innerHTML = (h ? h.items : []).map(i => `<option value="${esc(i.name)}">`).join('');
  }
  async function newVoucher(id) { const r = await FIN.get('/api/admin/finance/voucher-no'); document.getElementById(id).value = r.voucherNo; }
  const voucherField = (id, value) => `<div style="display:flex;gap:6px"><input class="field-input" id="${id}" value="${esc(value || '')}" placeholder="E.G. #EXP-20260219-AB7X"><button type="button" class="fin-btn plain sm" onclick="FIN.books.newVoucher('${id}')">⤮ Generate</button></div>`;
  const coaWarn = (m, accountId) => {
    const a = m.accounts.find(x => String(x.id) === String(accountId));
    return a && !a.coaAccountId ? '⚠ This account has no Chart of Accounts mapping. GL posting will use the default Cash/Bank account until it is mapped. <a href="javascript:void(0)" onclick="FIN.goTab(\'chartOfAccounts\')">Configure in Accounting Settings.</a>' : '';
  };

  // ══ Expense Requests ══════════════════════════════════════════════════
  FIN.page('expenseRequests', async el => {
    const m = await meta(true);
    const st = S.er;
    el.innerHTML = `${FIN.header('Expense Requests')}
      <div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">⊟ Cash Requests <span class="muted">(${esc(FIN.quickLabel(st.quick))})</span></div>
        <button class="fin-btn" onclick="FIN.books.erNew()">+ New Expenses Request</button></div>
        <div class="fin-card-body"><div id="er-stats"></div>
        <div class="fin-grid">${dateFilter('er', st)}
          ${field('Session', select('er-session', [['', 'All'], ...m.sessions.map(s => s.sessionLabel).filter((v, i, a) => a.indexOf(v) === i)], st.session || ''))}
          ${field('Expense Head / Category', select('er-head', [['', 'All Expense Heads / Categories'], ...m.expenseHeads.map(h => [h.name, h.name])], st.head || ''))}
          ${field('Status', select('er-status', [['active', 'Active Requests'], ['pending', 'Pending'], ['approved', 'Approved — Awaiting Disbursement'], ['dispensed', 'Dispensed (History)'], ['rejected', 'Declined'], ['all', 'All Statuses']], st.status))}
          ${field('Method', select('er-method', [['', 'All Methods'], ...m.methods.slice(0, 5)], st.method || ''))}
          <div><button class="fin-btn" onclick="FIN.books.erLoad()">⛃ Apply</button></div></div></div>
        <div id="er-table"></div></div>`;
    erLoad();
  });
  async function erLoad() {
    const st = S.er;
    readDates('er', st);
    Object.assign(st, { session: val('er-session'), head: val('er-head'), status: val('er-status'), method: val('er-method') });
    const d = await FIN.get(`/api/admin/finance/expense-requests${FIN.qs({ from: st.from, to: st.to, session: st.session, head: st.head, status: st.status, method: st.method })}`);
    const s = d.stats;
    document.getElementById('er-stats').innerHTML = stats([
      { label: 'Total Requests', value: money(s.total), sub: `${s.totalCount} Entries`, icon: '₦', bg: 'var(--red-bg)', color: 'var(--red)', valueColor: 'var(--red)' },
      { label: 'Pending Approval', value: money(s.pending), sub: `${s.pendingCount} Requests`, icon: '⧗', bg: 'var(--amber-bg)', color: 'var(--amber)', valueColor: 'var(--amber)' },
      { label: 'Approved Awaiting Disbursement', value: money(s.approved), sub: `${s.approvedCount} Requests`, icon: '✓', bg: 'var(--cyan-bg)', color: 'var(--cyan)', valueColor: 'var(--cyan)' },
      { label: 'Dispensed', value: money(s.dispensed), sub: `${s.dispensedCount} Requests`, icon: '$', bg: 'var(--green-bg)', color: 'var(--green)', valueColor: 'var(--green)' },
    ]);
    const m = await meta();
    S.erTable = table(document.getElementById('er-table'), {
      title: 'Cash Requests', rows: d.requests, selectable: true, perPage: 25,
      toolbar: () => `<span class="muted">With Selected :</span> <select class="ctrl-select" style="width:auto" id="er-pay-from">${accountOptions(m, '', '— Select Account —')}</select> <button class="fin-btn green sm" onclick="FIN.books.erBulkDispense()">Mark Dispensed</button> <button class="fin-btn plain sm" onclick="FIN.books.erLoad()">⟳ Refresh</button>`,
      columns: [
        { key: '#', label: '#', sortable: false },
        { key: 'title', label: 'Title', render: r => `${esc(r.item || r.title)}<div class="muted">${esc(r.voucherNo || '')}</div><div class="muted">${esc(r.description || r.reason || '')}</div>` },
        { key: 'category', label: 'Expense Head / Category' },
        { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
        { key: 'requestedByName', label: 'Paid To', render: r => esc(r.requestedByName || '') },
        { key: 'method', label: 'Method', render: r => esc(r.method || '—') },
        { key: 'transactionDate', label: 'Transaction Date', render: r => date(r.transactionDate) },
        { key: 'requestedAt', label: 'Date Added', render: r => dateTime(r.requestedAt) },
        { key: 'approvedByName', label: 'Approved By', render: r => esc(r.approvedByName || '—') },
        { key: 'approved', label: 'Approved', render: r => ({ pending: badge('Pending', 'amber'), rejected: badge('Declined', 'red') }[r.status] || badge('Approved', 'green')), exportValue: r => r.status },
        { key: 'dispensed', label: 'Dispensed', render: r => (r.status === 'dispensed' ? `${badge('Dispensed', 'green')}<div class="muted">${date(r.dispensedAt)}${r.accountName ? ` · ${esc(r.accountName)}` : ''}</div>` : '—'), exportValue: r => (r.status === 'dispensed' ? 'Yes' : 'No') },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => (r.status === 'pending' ? `<button class="fin-btn green sm" onclick="FIN.books.erDecide(${r.id},'approve')">Approve</button> <button class="fin-btn red sm" onclick="FIN.books.erDecide(${r.id},'reject')">Decline</button> <button class="fin-btn plain sm" onclick="FIN.books.erDelete(${r.id})">✕</button>` : r.status === 'approved' ? `<button class="fin-btn green sm" onclick="FIN.books.erDispense(${r.id})">Mark Dispensed</button>` : '—') },
      ],
    });
  }
  async function erNew() {
    const m = await meta();
    modal({
      title: '⊞ Make Cash Request',
      body: `<div class="fin-grid two">
        ${field('Voucher ID', voucherField('er-voucher', m.voucherNo), { span: 2 })}
        ${field('Expense Head / Category', select('er-f-head', m.expenseHeads.map(h => [h.name, h.name]), '', 'Select Expense Head / Category', `onchange="FIN.books.refreshItems('er-f','expense')"`), { required: true, span: 2 })}
        ${field('Item', itemField('er-f', m, 'expense', ''), { required: true, span: 2, hint: 'Select from existing items (sub-heads). If desired item is not found, then type it in and select it.' })}
        ${field('Description', FIN.input('er-desc', { placeholder: 'E.g. 3 packs of board marker' }), { required: true, span: 2 })}
        ${field('Amount (₦)', FIN.input('er-amount', { type: 'number', attrs: 'min="1"' }), { required: true })}
        ${field('Transaction Date', FIN.input('er-date', { type: 'date', value: FIN.today() }), { required: true })}
        ${field('Method', select('er-f-method', m.methods.slice(0, 5), '', 'Select Method'), { required: true })}
        ${field('Requested By', FIN.input('er-by', { placeholder: 'Person / organization' }), { required: true })}
      </div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        await FIN.post('/api/admin/finance/expense-requests', { voucherNo: val('er-voucher'), category: val('er-f-head'), item: val('er-f-item'), description: val('er-desc'), amount: val('er-amount'), transactionDate: val('er-date'), method: val('er-f-method'), requestedBy: val('er-by') });
        showToast('Expense request submitted'); close(); FIN.cache.finMeta = null; erLoad();
      } }],
    });
  }
  async function erDecide(id, action) {
    try { await FIN.post(`/api/admin/finance/expense-requests/${id}/decision`, { action }); showToast(action === 'approve' ? 'Request approved' : 'Request declined'); erLoad(); } catch (err) { showToast(err.message); }
  }
  async function erDispense(id) {
    const m = await meta();
    modal({ title: 'Mark Dispensed', body: field('Paid From', select('erd-acct', m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), (m.accounts.find(a => a.isDefault) || {}).id)) + '<div class="fin-note" style="margin-top:12px">Dispensing records the money as an expense, paid out of this account.</div>',
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Mark Dispensed', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/finance/expense-requests/${id}/decision`, { action: 'dispense', accountId: val('erd-acct') }); showToast('Marked dispensed'); close(); erLoad(); } }] });
  }
  async function erBulkDispense() {
    const ids = S.erTable.picked();
    if (!ids.length) return showToast('Tick approved requests first');
    try { const r = await FIN.post('/api/admin/finance/expense-requests/dispense', { ids, accountId: val('er-pay-from') }); showToast(`${r.count} request(s) marked dispensed`); erLoad(); } catch (err) { showToast(err.message); }
  }
  async function erDelete(id) { if (!await FIN.confirm('Delete this request?')) return; await FIN.del(`/api/admin/finance/expense-requests/${id}`); showToast('Request deleted'); erLoad(); }

  // ══ Expenses & Income (same page shape) ═══════════════════════════════
  function entriesPage(tab, type) {
    const isExp = type === 'expense';
    const api = isExp ? 'expenses' : 'income';
    FIN.page(tab, async el => {
      const m = await meta(true);
      const st = S[tab];
      el.innerHTML = `${FIN.header(isExp ? 'Expenses' : 'Financials : Income')}
        <div class="fin-card">${FIN.tabs(`${tab}-tabs`, [['main', isExp ? '▥ Expenditure' : '▥ Income'], ['heads', `☰ ${isExp ? 'Expense' : 'Income'} Heads / Categories`]], st.tab, k => { st.tab = k; draw(); })}<div id="${tab}-body"></div></div>`;
      const draw = () => (st.tab === 'heads' ? headsView(tab, type) : mainView(tab, type, m));
      draw();
    });
    async function mainView(t, typ, m) {
      const st = S[t];
      const body = document.getElementById(`${t}-body`);
      body.innerHTML = `<div class="fin-card-body"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><b>⊟ ${isExp ? 'Expenditures' : 'Income List'} <span class="muted">(${esc(FIN.quickLabel(st.quick))})</span></b>
          ${FIN.menuButton(`+ Post ${isExp ? 'Expenses' : 'Income'}`, [{ label: 'Single Posting', onClick: () => single(t, typ) }, ...(isExp ? [{ label: 'Multi Posting', onClick: () => multiPost(t, typ) }] : []), { label: 'Import from Excel', onClick: () => importXlsx(t, typ) }], '')}</div>
        <div id="${t}-stats"></div>
        <div class="fin-grid">${dateFilter(t, st)}
          ${field('Session', select(`${t}-session`, [['', 'All'], ...[...new Set(m.sessions.map(s => s.sessionLabel))]], st.session || ''))}
          ${field(`${isExp ? 'Expense' : 'Income'} Head / Category`, select(`${t}-head`, [['', `All ${isExp ? 'Expense' : 'Income'} Heads / Categories`], ...(isExp ? m.expenseHeads : m.incomeHeads).map(h => [h.name, h.name])], st.head || ''))}
          ${field(isExp ? 'Paid From' : 'Account', select(`${t}-acct`, [['', 'All Accounts'], ...m.accounts.map(a => [a.id, a.label])], st.accountId || ''))}
          ${field('Method', select(`${t}-method`, [['', 'All Methods'], ...m.methods], st.method || ''))}
          <div><button class="fin-btn" onclick="FIN.books.load('${t}')">⛃ Apply</button></div></div></div>
        <div id="${t}-table"></div>
        <div class="fin-card-body"><div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">${isExp ? 'Expenses' : 'Income'} Summary</div><button class="fin-btn plain sm" onclick="FIN.print('${isExp ? 'Expenses' : 'Income'} Summary', FIN.schoolHeader() + document.getElementById('${t}-summary').innerHTML)">Print Summary</button></div>
          ${FIN.tabs(`${t}-sum`, [['cat', `${isExp ? 'Expenses' : 'Income'} By Categories`], ['acct', `${isExp ? 'Expenses' : 'Income'} By Account`], ['month', `Monthly ${isExp ? 'Expenses' : 'Income'} Trend`]], st.sum || 'cat', k => { st.sum = k; summary(t); })}
          <div class="fin-card-body" id="${t}-summary"></div></div></div>`;
      load(t);
    }
  }
  async function load(t) {
    const isExp = t === 'expenses';
    const st = S[t];
    readDates(t, st);
    Object.assign(st, { session: val(`${t}-session`), head: val(`${t}-head`), accountId: val(`${t}-acct`), method: val(`${t}-method`) });
    const d = await FIN.get(`/api/admin/finance/${isExp ? 'expenses' : 'income'}${FIN.qs({ from: st.from, to: st.to, session: st.session, head: st.head, accountId: st.accountId, method: st.method })}`);
    st.data = d;
    const s = d.summary;
    const c = isExp ? ['var(--red)', 'var(--red-bg)'] : ['var(--green)', 'var(--green-bg)'];
    document.getElementById(`${t}-stats`).innerHTML = stats([
      { label: `Total ${isExp ? 'Expenditure' : 'Income'}`, value: money(s.total), sub: `${s.count} Entries`, icon: '₦', bg: c[1], color: c[0], valueColor: c[0] },
      { label: 'Avg Per Entry', value: money(s.avg), icon: '∿', bg: 'var(--amber-bg)', color: 'var(--amber)', valueColor: 'var(--amber)' },
      { label: 'Today', value: money(s.today), sub: `${s.todayCount} Entries`, icon: '▦', bg: 'var(--cyan-bg)', color: 'var(--cyan)', valueColor: 'var(--cyan)' },
      { label: 'This Month', value: money(s.month), sub: `${s.monthCount} Entries`, icon: '▦', bg: 'var(--blue-bg)', color: 'var(--blue)', valueColor: 'var(--blue)' },
    ]);
    let rows = d.rows;
    if (isExp && st.view === 'voucher') {
      const by = new Map();
      rows.forEach(r => { const k = r.voucherNo || `#${r.id}`; const v = by.get(k) || { ...r, id: k, amount: 0, lines: 0, title: '', voucherNo: k }; v.amount += r.amount; v.lines += 1; v.title = v.title ? `${v.title}, ${r.item || r.title}` : (r.item || r.title); by.set(k, v); });
      rows = [...by.values()];
    }
    const sourceLabel = r => ({ manual: '', fee_payment: 'Fee payment', salary: 'Payroll', request: 'Expense request', store_sale: 'Store sale', loan_disbursement: 'Loan disbursed', loan_repayment: 'Loan repayment', vendor_payment: 'Vendor bill', customer_receipt: 'Customer invoice', payroll_remittance: 'Statutory remittance' }[r.source] || '');
    table(document.getElementById(`${t}-table`), {
      title: isExp ? 'Expenditures' : 'Income List', rows, perPage: 25,
      toolbar: () => `<button class="fin-btn plain sm" onclick="FIN.books.load('${t}')">⟳ Refresh</button>${isExp ? ` <span class="fin-actions" style="margin-left:6px"><button class="fin-btn ${st.view === 'voucher' ? 'plain' : ''} sm" onclick="FIN.books.view('item')">☰ By Item</button><button class="fin-btn ${st.view === 'voucher' ? '' : 'plain'} sm" onclick="FIN.books.view('voucher')">🗎 By Voucher</button></span>` : ''}`,
      columns: [
        { key: '#', label: '#', sortable: false },
        ...(isExp ? [{ key: 'voucherNo', label: 'Reference', render: r => esc(r.voucherNo || '—') }] : []),
        { key: 'title', label: 'Title', render: r => `${esc(r.item || r.title || r.description || '')}${sourceLabel(r) ? `<div>${badge(sourceLabel(r), 'blue')}</div>` : ''}${r.description && r.description !== r.item ? `<div class="muted">${esc(r.description)}</div>` : ''}${r.lines > 1 ? `<div class="muted">${r.lines} items</div>` : ''}`, exportValue: r => r.item || r.title || r.description },
        { key: 'category', label: `${isExp ? 'Expense' : 'Income'} Head / Category` },
        { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
        ...(isExp ? [{ key: 'paidTo', label: 'Paid To', render: r => esc(r.paidTo || '—') }] : [{ key: 'voucherNo', label: 'Voucher Id', render: r => esc(r.voucherNo || '—') }]),
        { key: 'method', label: 'Method', render: r => esc(r.method || '—') },
        { key: 'date', label: 'Transaction Date', render: r => date(r.date) },
        { key: 'createdAt', label: 'Date Added', render: r => dateTime(r.createdAt) },
        { key: isExp ? 'approvedByName' : 'recordedByName', label: isExp ? 'Approved By' : 'Added By', render: r => esc((isExp ? r.approvedByName : r.recordedByName) || '—') },
        { key: 'glStatus', label: 'GL Status', render: r => glBadge(r.glStatus) },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => (st.view === 'voucher' ? '' : `<button class="fin-btn plain sm" onclick="FIN.books.rowMenu(this,'${t}',${r.id})">⋯</button>`) },
      ],
    });
    summary(t);
  }
  function summary(t) {
    const st = S[t];
    const s = st.data && st.data.summary;
    if (!s) return;
    const k = st.sum || 'cat';
    const list = k === 'cat' ? s.byCategory : k === 'acct' ? s.byAccount : s.byMonth;
    const title = k === 'cat' ? `${t === 'expenses' ? 'Expense' : 'Income'} Breakdown By Head / Category` : k === 'acct' ? 'By Account' : 'Monthly Trend';
    const max = Math.max(1, ...list.map(x => x.amount));
    document.getElementById(`${t}-summary`).innerHTML = `<div class="fin-grid two" style="align-items:start"><div><b>${title}</b><table class="fin-table" style="margin-top:8px"><thead><tr><th>#</th><th>${k === 'month' ? 'Month' : k === 'acct' ? 'Account' : 'Head / Category'}</th><th class="num">Amount</th><th class="num">Count</th><th class="num">Percentage</th></tr></thead>
      <tbody>${list.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(k === 'month' ? FIN.monthLabel(x.name) : x.name)}</td><td class="num">${money(x.amount)}</td><td class="num">${x.count}</td><td class="num">${x.share.toFixed(2)}%</td></tr>`).join('') || '<tr><td colspan="5" class="fin-empty">No Data Found</td></tr>'}</tbody></table></div>
      <div><b>${k === 'month' ? 'Trend' : `Top ${t === 'expenses' ? 'Expense' : 'Income'} Heads / Categories`}</b><div style="margin-top:10px">${list.slice(0, 12).map(x => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:11px"><span style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k === 'month' ? FIN.monthLabel(x.name) : x.name)}</span><div style="flex:1;height:8px;background:var(--black-3);border-radius:9px"><div style="width:${(x.amount / max * 100).toFixed(1)}%;height:100%;background:${t === 'expenses' ? 'var(--red)' : 'var(--green)'};border-radius:9px"></div></div><span>${FIN.whole(x.amount)}</span></div>`).join('') || '<div class="muted">No Data Found</div>'}</div></div></div>`;
  }
  function rowMenu(btn, t, id) {
    const r = S[t].data.rows.find(x => x.id === id);
    const isExp = t === 'expenses';
    FIN.menu(btn, [
      { label: 'View', onClick: () => viewEntry(t, r) },
      ...(r.glStatus !== 'Posted' ? [{ label: 'Post to Ledger', onClick: async () => { try { await FIN.post(`/api/admin/finance/${isExp ? 'expenses' : 'income'}/${id}/post`); showToast('Posted to ledger'); load(t); } catch (err) { showToast(err.message); } } }] : []),
      ...(r.source === 'manual' ? [{ label: 'Edit', onClick: () => single(t, isExp ? 'expense' : 'income', r) }, { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this record?')) return; try { await FIN.del(`/api/admin/finance/${isExp ? 'expenses' : 'income'}/${id}`); showToast('Deleted'); load(t); } catch (err) { showToast(err.message); } } }] : []),
    ]);
  }
  function viewEntry(t, r) {
    const isExp = t === 'expenses';
    modal({ title: isExp ? 'Expense Record' : 'Income Record', body: `<dl class="fin-kv"><dt>Reference</dt><dd>${esc(r.voucherNo || '—')}</dd><dt>Head / Category</dt><dd>${esc(r.category)}</dd><dt>Item</dt><dd>${esc(r.item || '—')}</dd>
      <dt>Description</dt><dd>${esc(r.description || '—')}</dd><dt>Amount</dt><dd>${money(r.amount)}</dd><dt>Transaction Date</dt><dd>${date(r.date)}</dd><dt>Method</dt><dd>${esc(r.method || '—')}</dd>
      <dt>${isExp ? 'Paid To' : 'Received From'}</dt><dd>${esc((isExp ? r.paidTo : r.receivedFrom) || '—')}</dd><dt>${isExp ? 'Paid From' : 'Paid Into'}</dt><dd>${esc(r.accountName || '—')}</dd>
      ${isExp ? `<dt>Approved By</dt><dd>${esc(r.approvedByName || '—')}</dd>` : ''}<dt>Recorded By</dt><dd>${esc(r.recordedByName || '—')} · ${dateTime(r.createdAt)}</dd><dt>GL Status</dt><dd>${glBadge(r.glStatus)}</dd><dt>Attachment</dt><dd>${FIN.docLink(r.attachmentPath)}</dd></dl>`, buttons: [{ label: 'Close', cls: 'plain' }] });
  }
  async function single(t, type, row) {
    const m = await meta();
    const isExp = type === 'expense';
    const r = row || {};
    const p = `${t}-f`;
    modal({
      title: `⊞ ${row ? 'Edit' : 'Add'} ${isExp ? 'Expenses' : 'Income'} Record`,
      body: `<div class="fin-grid two">
        ${field('Voucher ID', voucherField(`${p}-voucher`, r.voucherNo || (row ? '' : m.voucherNo)), { span: 2 })}
        ${field(`${isExp ? 'Expense' : 'Income'} Head / Category`, select(`${p}-head`, (isExp ? m.expenseHeads : m.incomeHeads).map(h => [h.name, h.name]), r.category || '', `Select ${isExp ? 'Expense' : 'Income'} Head / Category`, `onchange="FIN.books.refreshItems('${p}','${type}')"`), { required: true, span: 2 })}
        ${field('Item', itemField(p, m, type, r.category, r.item), { required: isExp, span: 2, hint: 'Select from existing items (sub-heads). If desired item is not found, then type it in and select it.' })}
        ${field('Description', FIN.input(`${p}-desc`, { value: r.description || '', placeholder: 'E.g. 3 packs of board marker' }), { required: isExp, span: 2 })}
        ${field('Amount (₦)', FIN.input(`${p}-amount`, { type: 'number', value: r.amount || '', attrs: 'min="1" step="0.01"' }), { required: true })}
        ${field('Transaction Date', FIN.input(`${p}-date`, { type: 'date', value: r.date || FIN.today() }), { required: true })}
        ${field('Method', select(`${p}-method`, m.methods, r.method || '', 'Select Method'), { required: isExp })}
        ${field(isExp ? 'Paid To' : 'Received from', FIN.input(`${p}-party`, { value: (isExp ? r.paidTo : r.receivedFrom) || '', placeholder: 'Person / organization' }), { required: isExp })}
        ${field(isExp ? 'Paid From' : 'Paid Into', select(`${p}-acct`, m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), r.accountId || (m.accounts.find(a => a.isDefault) || {}).id, 'Select Account (optional)', `onchange="document.getElementById('${p}-warn').innerHTML=FIN.books.coaWarnFor(this.value)"`), { span: 2 })}
        <div id="${p}-warn" class="hint warn" style="grid-column:span 2;font-size:11px;color:var(--amber)">${coaWarn(m, r.accountId || (m.accounts.find(a => a.isDefault) || {}).id)}</div>
        ${row ? '' : field('Attachment / Receipt', `<input type="file" class="field-input" id="${p}-file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx">`, { span: 2, hint: 'Allowed Formats: Jpg, Png, Pdf, Doc, Docx, Xls, Xlsx (max 5mb)' })}
        ${isExp ? field('Approved By', select(`${p}-approver`, m.approvers.map(a => [a.id, a.name]), r.approvedBy || '', 'Select Approver'), { span: 2 }) : ''}
      </div>`,
      buttons: [
        ...(row ? [] : [{ label: '⤒ Save & Post to Ledger', cls: 'warn', onClick: (o, close) => save(true, close) }]),
        { label: 'Save', onClick: (o, close) => save(false, close) }, { label: 'Cancel', cls: 'plain' },
      ],
    });
    async function save(post, close) {
      const body = { voucherNo: val(`${p}-voucher`), category: val(`${p}-head`), item: val(`${p}-item`), description: val(`${p}-desc`), amount: val(`${p}-amount`), date: val(`${p}-date`), method: val(`${p}-method`),
        paidTo: val(`${p}-party`), receivedFrom: val(`${p}-party`), accountId: val(`${p}-acct`), approvedBy: isExp ? val(`${p}-approver`) : '', postToLedger: post };
      if (row) await FIN.put(`/api/admin/finance/${isExp ? 'expenses' : 'income'}/${row.id}`, body);
      else { body.attachment = await FIN.fileToDataUrl(document.getElementById(`${p}-file`)); await FIN.api(`/api/admin/finance/${isExp ? 'expenses' : 'income'}`, { method: 'POST', body }); }
      showToast(post ? 'Saved and posted to ledger' : 'Saved'); close(); FIN.cache.finMeta = null; load(t);
    }
  }
  async function multiPost(t, type) {
    const m = await meta();
    const line = () => `<tr><td><select class="ctrl-select" data-k="category">${headOptions(m, type, '', 'Head')}</select></td><td><input class="field-input" data-k="item" placeholder="Item"></td><td><input class="field-input" data-k="description" placeholder="Description"></td><td><input class="field-input" type="number" data-k="amount" min="1"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()">✕</button></td></tr>`;
    FIN.books._line = line;
    modal({
      title: '⊞ Multi Posting', size: 'xwide',
      body: `<div class="fin-grid">${field('Voucher ID', voucherField('mp-voucher', m.voucherNo))}${field('Transaction Date', FIN.input('mp-date', { type: 'date', value: FIN.today() }), { required: true })}
          ${field('Method', select('mp-method', m.methods, 'Cash'), { required: true })}${field('Paid To', FIN.input('mp-party', { placeholder: 'Person / organization' }), { required: true })}
          ${field('Paid From', select('mp-acct', m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), (m.accounts.find(a => a.isDefault) || {}).id))}${field('Approved By', select('mp-approver', m.approvers.map(a => [a.id, a.name]), '', 'Select Approver'))}</div>
        <div class="fin-section-label">Lines (one voucher, several items)</div><table class="fin-table fin-lines"><thead><tr><th>Expense Head</th><th>Item</th><th>Description</th><th style="width:130px">Amount</th><th></th></tr></thead><tbody id="mp-lines">${line()}${line()}</tbody></table>
        <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('mp-lines').insertAdjacentHTML('beforeend', FIN.books._line())">+ Add Line</button>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save All', onClick: async (o, close) => {
        const rows = [...document.querySelectorAll('#mp-lines tr')].map(tr => { const x = {}; tr.querySelectorAll('[data-k]').forEach(i => { x[i.dataset.k] = i.value.trim(); }); return x; }).filter(x => x.category || x.amount);
        const r = await FIN.post('/api/admin/finance/expenses/multi', { voucherNo: val('mp-voucher'), date: val('mp-date'), method: val('mp-method'), paidTo: val('mp-party'), accountId: val('mp-acct'), approvedBy: val('mp-approver'), rows });
        showToast(`${r.count} expense line(s) posted`); close(); FIN.cache.finMeta = null; load(t);
      } }],
    });
  }
  async function importXlsx(t, type) {
    const m = await meta();
    const isExp = type === 'expense';
    const headers = ['Transaction Date', `${isExp ? 'Expense' : 'Income'} Head`, 'Item', 'Description', 'Amount', 'Method', isExp ? 'Paid To' : 'Received From', 'Voucher ID'];
    modal({
      title: `Import ${isExp ? 'Expenses' : 'Income'} from Excel`,
      body: `<div class="fin-note">Use an .xlsx file with these columns: <b>${headers.join(', ')}</b>. "Head" and "Amount" are required; new heads and items are created automatically. <a href="javascript:void(0)" onclick="FIN.exportRows('xlsx',{title:'${isExp ? 'expenses' : 'income'} import template',headers:${JSON.stringify(headers).replace(/"/g, '&quot;')},rows:[['${FIN.today()}','${isExp ? 'Utilities' : 'Other Income'}','${isExp ? 'Diesel' : 'Hall rental'}','','10000','Cash','','']]})">Download the template</a></div>
        <div class="fin-grid two" style="margin-top:12px">${field('Excel file (.xlsx)', '<input type="file" class="field-input" id="ix-file" accept=".xlsx">', { required: true })}${field(isExp ? 'Paid From' : 'Paid Into', select('ix-acct', m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), (m.accounts.find(a => a.isDefault) || {}).id))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Import', onClick: async (o, close) => {
        const file = await FIN.fileToDataUrl(document.getElementById('ix-file'));
        if (!file) return showToast('Choose the Excel file'), false;
        const r = await FIN.api(`/api/admin/finance/${isExp ? 'expenses' : 'income'}/import`, { method: 'POST', body: { file, accountId: val('ix-acct') } });
        showToast(`${r.count} record(s) imported`); close(); FIN.cache.finMeta = null; load(t);
      } }],
    });
  }

  // heads & sub-heads (items)
  async function headsView(t, type) {
    const isExp = type === 'expense';
    const [h, accts] = await Promise.all([FIN.get(`/api/admin/finance/heads?type=${type}`), FIN.get('/api/admin/acct/accounts')]);
    const coa = accts.accounts.filter(a => !a.isGroup && a.isActive);
    S[t] = S[t] || {}; S[t].heads = h.heads; S[t].coa = coa; S[t].type = type;
    const body = document.getElementById(`${t}-body`);
    const items = h.heads.flatMap(x => x.items.map(i => ({ ...i, head: x.name, headId: x.id })));
    body.innerHTML = `<div class="fin-card-body"><div class="fin-grid two" style="align-items:start">
      <div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">▰ ${isExp ? 'Expense' : 'Income'} Heads / Categories</div><div class="fin-actions"><button class="fin-btn plain sm" onclick="FIN.books.headImport('${t}','${type}')">⤒ Bulk Import</button><button class="fin-btn outline sm" onclick="FIN.books.headEdit('${t}','${type}')">+ New ${isExp ? 'Expense' : 'Income'} Head / Category</button></div></div><div id="${t}-heads"></div></div>
      <div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">🏷 Sub Heads (Items) — <span id="${t}-items-of">All</span></div><button class="fin-btn outline sm" onclick="FIN.books.headEdit('${t}','${type}',null,true)">+ Add Sub Head (Item)</button></div><div id="${t}-items"></div></div></div></div>`;
    table(document.getElementById(`${t}-heads`), {
      title: `${isExp ? 'Expense' : 'Income'} Heads`, rows: h.heads, perPage: 25,
      columns: [
        { key: 'name', label: `${isExp ? 'Expense' : 'Income'} Head / Category Name`, render: r => `${esc(r.name)}${r.isSystem ? `<div>${badge('System', 'grey')}</div>` : ''}` },
        { key: 'code', label: 'Code', render: r => (r.code ? `<span class="fin-badge grey" style="font-family:'DM Mono',monospace">${esc(r.code)}</span>` : '-') },
        { key: 'coaCode', label: 'Ledger / CoA Account', render: r => (r.coaCode ? `${badge(r.coaCode, 'amber')} ${esc(r.coaName)}` : '<span class="muted">Global default</span>') },
        { key: 'items', label: 'Sub Heads (Items)', sort: r => r.items.length, render: r => (r.items.length ? `<a href="javascript:void(0)" onclick="FIN.books.showItems('${t}',${r.id})">${r.items.length} item(s)</a>` : `<a href="javascript:void(0)" onclick="FIN.books.headEdit('${t}','${type}',null,true,${r.id})">⊕ Add</a>`), exportValue: r => r.items.map(i => i.name).join('; ') },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'Manage Sub Items',onClick:()=>FIN.books.showItems('${t}',${r.id})},{label:'Add Sub Item',onClick:()=>FIN.books.headEdit('${t}','${type}',null,true,${r.id})},{label:'Edit',onClick:()=>FIN.books.headEdit('${t}','${type}',${r.id})}${r.isSystem ? '' : `,{label:'Delete',danger:true,onClick:()=>FIN.books.headDelete('${t}','${type}',${r.id})}`}])">⋯</button>` },
      ],
    });
    showItems(t, null, items);
  }
  function showItems(t, headId, all) {
    const heads = S[t].heads;
    const items = all || heads.flatMap(x => x.items.map(i => ({ ...i, head: x.name, headId: x.id })));
    const rows = headId ? items.filter(i => i.parentId === headId) : items;
    document.getElementById(`${t}-items-of`).textContent = headId ? heads.find(h => h.id === headId).name : 'All';
    const type = S[t].type;
    table(document.getElementById(`${t}-items`), {
      title: 'Sub Heads (Items)', rows, perPage: 25,
      columns: [
        { key: 'name', label: 'Sub Head (Item) Name' }, { key: 'code', label: 'Code', render: r => esc(r.code || '-') },
        { key: 'coaCode', label: 'Ledger / CoA Account', render: r => (r.coaCode ? `${badge(r.coaCode, 'amber')} ${esc(r.coaName)}` : '-') },
        { key: 'head', label: `${type === 'expense' ? 'Expense' : 'Income'} Head / Category`, render: r => esc(r.head || (heads.find(h => h.id === r.parentId) || {}).name || '') },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.books.headEdit('${t}','${type}',${r.id},true,${r.parentId})">Edit</button> <button class="fin-btn red sm" onclick="FIN.books.headDelete('${t}','${type}',${r.id})">✕</button>` },
      ],
    });
  }
  function headEdit(t, type, id, isItem, parentId) {
    const heads = S[t].heads;
    const all = heads.flatMap(h => [h, ...h.items]);
    const r = id ? all.find(x => x.id === id) : {};
    modal({
      title: `${id ? 'Edit' : 'New'} ${isItem ? 'Sub Head (Item)' : `${type === 'expense' ? 'Expense' : 'Income'} Head / Category`}`,
      body: `<div class="fin-grid two">${isItem ? field('Head / Category', select('hd-parent', heads.map(h => [h.id, h.name]), parentId || r.parentId || '', 'Select'), { required: true, span: 2 }) : ''}
        ${field('Name', FIN.input('hd-name', { value: r.name || '' }), { required: true })}${field('Code', FIN.input('hd-code', { value: r.code || '', placeholder: 'Optional' }))}
        ${field('Ledger / CoA Account', select('hd-coa', S[t].coa.filter(a => a.type === (type === 'expense' ? 'expense' : 'income') || a.code === '1500').map(a => [a.id, `${a.code} ${a.name}`]), r.coaAccountId || '', 'Global default'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const body = { type, name: val('hd-name'), code: val('hd-code'), coaAccountId: val('hd-coa'), parentId: isItem ? val('hd-parent') : null };
        if (id) await FIN.put(`/api/admin/finance/heads/${id}`, body); else await FIN.post('/api/admin/finance/heads', body);
        showToast('Saved'); close(); FIN.cache.finMeta = null; headsView(t, type);
      } }],
    });
  }
  async function headDelete(t, type, id) {
    if (!await FIN.confirm('Remove this?')) return;
    try { await FIN.del(`/api/admin/finance/heads/${id}`); showToast('Removed'); FIN.cache.finMeta = null; headsView(t, type); } catch (err) { showToast(err.message); }
  }
  function headImport(t, type) {
    modal({ title: 'Bulk Import Heads', body: `<div class="fin-note">An .xlsx file with columns <b>Name</b>, <b>Code</b> (optional) and <b>Item</b> (optional — a sub head under that head).</div><div style="margin-top:12px">${field('Excel file (.xlsx)', '<input type="file" class="field-input" id="hi-file" accept=".xlsx">', { required: true })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Import', onClick: async (o, close) => {
        const file = await FIN.fileToDataUrl(document.getElementById('hi-file'));
        const r = await FIN.api('/api/admin/finance/heads/import', { method: 'POST', body: { type, file } });
        showToast(`${r.added} head(s) added`); close(); FIN.cache.finMeta = null; headsView(t, type);
      } }] });
  }

  // ══ Income & Expense Analytics ════════════════════════════════════════
  FIN.page('incomeExpensesAnalytics', async el => {
    const m = await meta();
    const st = S.iea;
    el.innerHTML = `${FIN.header('Income & Expense Analytics')}
      ${card('▥ Income & Expense Analytics', `<div class="fin-grid">${field('Period', select('iea-period', FIN.QUICK.filter(q => q[0] !== 'all'), st.period, null, `onchange="document.getElementById('iea-custom').style.display=this.value==='custom'?'':'none'"`))}
        <div id="iea-custom" style="${st.period === 'custom' ? '' : 'display:none'}">${field('From — To', `<div style="display:flex;gap:6px"><input type="date" class="field-input" id="iea-from" value="${st.from || ''}"><input type="date" class="field-input" id="iea-to" value="${st.to || ''}"></div>`)}</div>
        ${field('Account', select('iea-acct', [['', 'All Accounts'], ...m.accounts.map(a => [a.id, a.label])], st.accountId || ''))}
        <div><button class="fin-btn" onclick="FIN.books.ieaLoad()">⛃ View Analytics</button></div></div>`)}
      <div id="iea-out"></div>`;
    ieaLoad();
  });
  async function ieaLoad() {
    const st = S.iea;
    st.period = val('iea-period'); st.accountId = val('iea-acct');
    const r = st.period === 'custom' ? { from: val('iea-from'), to: val('iea-to') } : FIN.quickRange(st.period);
    Object.assign(st, r);
    const d = await FIN.get(`/api/admin/finance/analytics${FIN.qs({ from: r.from, to: r.to, accountId: st.accountId })}`);
    const breakdown = (list, total, label) => `<div class="fin-grid two" style="align-items:start"><div><b>${label} Breakdown By Head / Category</b><table class="fin-table" style="margin-top:8px"><thead><tr><th>#</th><th>${label} Head / Category</th><th class="num">Amount</th><th class="num">Count</th><th class="num">Percentage</th></tr></thead>
      <tbody>${list.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="num">${money(x.amount)}</td><td class="num">${x.count}</td><td class="num">${x.share.toFixed(2)}%</td></tr>`).join('') || '<tr><td colspan="5" class="fin-empty">No Data Found</td></tr>'}</tbody></table></div>
      <div class="fin-tile"><b>Top ${label} Heads / Categories</b>${list.slice(0, 8).map(x => `<div style="margin-top:8px;font-size:11px">${esc(x.name)}<div style="height:8px;background:var(--black-3);border-radius:9px"><div style="width:${x.share}%;height:100%;background:${label === 'Expense' ? 'var(--red)' : 'var(--green)'};border-radius:9px"></div></div></div>`).join('') || '<div class="muted" style="margin-top:8px">No Data Found</div>'}</div></div>`;
    const maxM = Math.max(1, ...d.monthlyTrend.map(x => Math.max(x.income, x.expenses)));
    const views = {
      exp: breakdown(d.expensesByCategory, d.totalExpenses, 'Expense'),
      inc: breakdown(d.incomeByCategory, d.totalIncome, 'Income'),
      acct: `<table class="fin-table"><thead><tr><th>Account</th><th class="num">Income</th><th class="num">Count</th><th class="num">Expenses</th><th class="num">Count</th><th class="num">Net</th></tr></thead><tbody>${d.byAccount.map(a => `<tr><td>${esc(a.name)}</td><td class="num">${money(a.income)}</td><td class="num">${a.incomeCount}</td><td class="num">${money(a.expenses)}</td><td class="num">${a.expenseCount}</td><td class="num">${money(a.income - a.expenses)}</td></tr>`).join('') || '<tr><td colspan="6" class="fin-empty">No Data Found</td></tr>'}</tbody></table>`,
      trend: `<table class="fin-table"><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th><th style="width:40%">Comparison</th></tr></thead><tbody>${d.monthlyTrend.map(x => `<tr><td>${FIN.monthLabel(x.month)}</td><td class="num">${money(x.income)}</td><td class="num">${money(x.expenses)}</td><td class="num" style="color:${x.net >= 0 ? 'var(--green)' : 'var(--red)'}">${money(x.net)}</td>
        <td><div style="height:7px;background:var(--green);border-radius:9px;width:${(x.income / maxM * 100).toFixed(1)}%"></div><div style="height:7px;background:var(--red);border-radius:9px;width:${(x.expenses / maxM * 100).toFixed(1)}%;margin-top:3px"></div></td></tr>`).join('') || '<tr><td colspan="5" class="fin-empty">No Data Found</td></tr>'}</tbody></table>`,
    };
    S.iea.views = views;
    document.getElementById('iea-out').innerHTML = card(`Period : ${esc(FIN.quickLabel(st.period))} (${date(r.from)} - ${date(r.to)})`, `<div class="fin-grid">
        <div><div class="muted">Total Income</div><div class="fin-big" style="color:var(--green)">${money(d.totalIncome)}</div><div class="muted">${d.incomeCount} Transactions</div></div>
        <div><div class="muted">Total Expenses</div><div class="fin-big" style="color:var(--red)">${money(d.totalExpenses)}</div><div class="muted">${d.expenseCount} Transactions</div></div>
        <div><div class="muted">Net Balance</div><div class="fin-big" style="color:var(--blue)">${money(d.net)}</div><div style="color:${d.net >= 0 ? 'var(--green)' : 'var(--red)'};font-size:11px">${d.net >= 0 ? '↑ Surplus' : '↓ Deficit'}</div></div></div>`)
      + `<div class="fin-card">${FIN.tabs('iea-t', [['exp', '⊖ Expense Heads / Categories'], ['inc', '⊕ Income Heads / Categories'], ['acct', '🏛 By Account'], ['trend', '↗ Monthly Trend']], st.view || 'exp', k => { st.view = k; document.getElementById('iea-view').innerHTML = S.iea.views[k]; })}<div class="fin-card-body" id="iea-view">${views[st.view || 'exp']}</div></div>`;
  }

  // ══ Bank Balance Report ═══════════════════════════════════════════════
  FIN.page('bankBalanceReport', async el => {
    const m = await meta(true);
    const st = S.bb;
    el.innerHTML = `${FIN.header('Bank Balance Report')}
      ${card('🏛 Bank Balance Report', `<div class="fin-grid">${field('Account', select('bb-acct', [['', 'All Accounts'], ...m.accounts.map(a => [a.id, a.label])], st.accountId || ''))}
        ${field('Session', select('bb-session', [['', 'All Time'], ...[...new Set(m.sessions.map(s => s.sessionLabel))]], st.session || ''))}
        <div><button class="fin-btn" onclick="FIN.books.bbLoad()">⛃ Filter</button> <button class="fin-btn plain" onclick="FIN.books.transfer()">⇄ Transfer</button> <button class="fin-btn plain" onclick="FIN.books.adjust()">± Adjustment</button></div></div>`)}
      <div id="bb-out"></div>`;
    bbLoad();
  });
  async function bbLoad() {
    const st = S.bb;
    st.accountId = val('bb-acct'); st.session = val('bb-session');
    const d = await FIN.get(`/api/admin/finance/bank-balance${FIN.qs({ accountId: st.accountId, session: st.session })}`);
    document.getElementById('bb-out').innerHTML = `<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">
        <div><div class="muted">Total Balance</div><div class="fin-big" style="color:var(--blue)">${money(d.totals.all)}</div></div>
        <div><div class="muted">Bank Accounts</div><div class="fin-big" style="color:var(--green)">${money(d.totals.bank)}</div></div>
        <div><div class="muted">Cash Accounts</div><div class="fin-big" style="color:var(--amber)">${money(d.totals.cash)}</div></div></div></div><div id="bb-table"></div></div>`;
    table(document.getElementById('bb-table'), {
      title: 'Bank Balance Report', rows: d.accounts, perPage: 50, emptyText: 'No Accounts with Balance Tracking Enabled<br><span class="muted">Enable Balance Tracking on Accounts to See Them Here (Accounting › Chart of Accounts › Operating Accounts)</span>',
      columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Account Name' }, { key: 'bankName', label: 'Bank', render: r => esc(r.bankName || '—') },
        { key: 'accountNumber', label: 'Account Number', render: r => esc(r.accountNumber || '—') }, { key: 'type', label: 'Type', render: r => badge(FIN.cap(r.type), r.type === 'bank' ? 'blue' : 'amber') },
        { key: 'opening', label: 'Opening Balance', num: true, render: r => money(r.opening), exportValue: r => r.opening, total: true },
        { key: 'totalIncome', label: 'Total Income', num: true, render: r => money(r.totalIncome), exportValue: r => r.totalIncome, total: true },
        { key: 'totalExpense', label: 'Total Expense', num: true, render: r => money(r.totalExpense), exportValue: r => r.totalExpense, total: true },
        { key: 'current', label: 'Current Balance', num: true, render: r => `<b>${money(r.current)}</b>`, exportValue: r => r.current, total: true },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.books.openLedger(${r.id})">Ledger</button>` },
      ],
    });
  }
  async function transfer() {
    const m = await meta();
    const opts = m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]);
    modal({ title: 'Transfer Between Accounts', body: `<div class="fin-grid two">${field('From Account', select('tr-from', opts, ''), { required: true })}${field('To Account', select('tr-to', opts, ''), { required: true })}
      ${field('Amount (₦)', FIN.input('tr-amount', { type: 'number' }), { required: true })}${field('Date', FIN.input('tr-date', { type: 'date', value: FIN.today() }))}${field('Note', FIN.input('tr-note'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Transfer', onClick: async (o, close) => { await FIN.post('/api/admin/finance/transfers', { fromAccountId: val('tr-from'), toAccountId: val('tr-to'), amount: val('tr-amount'), date: val('tr-date'), note: val('tr-note') }); showToast('Transfer recorded'); close(); bbLoad(); } }] });
  }
  async function adjust() {
    const m = await meta();
    modal({ title: 'Balance Adjustment', body: `<div class="fin-grid two">${field('Account', select('ad-acct', m.accounts.filter(a => a.isActive).map(a => [a.id, a.label]), ''), { required: true, span: 2 })}
      ${field('Direction', select('ad-kind', [['adj_credit', 'Increase balance (credit)'], ['adj_debit', 'Reduce balance (debit)']], 'adj_credit'))}${field('Amount (₦)', FIN.input('ad-amount', { type: 'number' }), { required: true })}
      ${field('Date', FIN.input('ad-date', { type: 'date', value: FIN.today() }))}${field('Reason', FIN.input('ad-note', { placeholder: 'e.g. Bank charges' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { await FIN.post('/api/admin/finance/adjustments', { accountId: val('ad-acct'), kind: val('ad-kind'), amount: val('ad-amount'), date: val('ad-date'), note: val('ad-note') }); showToast('Adjustment recorded'); close(); bbLoad(); } }] });
  }

  // ══ Cash Flow Statement ═══════════════════════════════════════════════
  FIN.page('cashFlowStatement', async el => {
    const m = await meta();
    const st = S.cf;
    const r = FIN.quickRange('this_month');
    el.innerHTML = `${FIN.header('Cash Flow Statement')}
      ${card('↗ Cash Flow Statement', `<div class="fin-grid">${field('From', FIN.input('cf-from', { type: 'date', value: st.from || r.from }))}${field('To', FIN.input('cf-to', { type: 'date', value: st.to || r.to }))}
        ${field('Account', select('cf-acct', [['', 'All Accounts'], ...m.accounts.map(a => [a.id, a.label])], st.accountId || ''))}<div><button class="fin-btn" onclick="FIN.books.cfLoad()">⛃ View Report</button></div></div>`)}
      <div id="cf-out"></div>`;
    cfLoad();
  });
  async function cfLoad() {
    const st = S.cf;
    Object.assign(st, { from: val('cf-from'), to: val('cf-to'), accountId: val('cf-acct') });
    const d = await FIN.get(`/api/admin/finance/cash-flow${FIN.qs(st)}`);
    const box = (title, color, rows, total, totalLabel) => `<div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title" style="color:${color}">${title}</div></div><div class="fin-card-body"><table class="fin-table">${rows.map(([l, v]) => `<tr><td>${l}</td><td class="num" style="color:${color}">${money(v)}</td></tr>`).join('')}
      <tr><td style="background:${color};color:#fff;font-weight:700">${totalLabel}</td><td class="num" style="background:${color};color:#fff;font-weight:700">${money(total)}</td></tr></table></div></div>`;
    const html = `<div class="fin-card"><div class="fin-card-body"><b>Period : ${date(d.from)} - ${date(d.to)}</b></div></div>
      <div class="fin-grid two" style="align-items:start">${box('↓ Cash Inflows', 'var(--green)', [['Income', d.inflows.income], ['Transfer in', d.inflows.transferIn], ['Adjustments (credit)', d.inflows.adjCredit]], d.totalIn, 'Total Inflows')}
        ${box('↑ Cash Outflows', 'var(--red)', [['Expenses', d.outflows.expenses], ['Transfer Out', d.outflows.transferOut], ['Adjustments (debit)', d.outflows.adjDebit]], d.totalOut, 'Total Outflows')}</div>
      <div class="fin-card" style="margin-top:16px"><div class="fin-card-body" style="text-align:center"><div class="muted">Net Cash Flow</div><div class="fin-big" style="color:${d.net >= 0 ? 'var(--green)' : 'var(--red)'}">${money(d.net)}</div><div style="font-size:11px;color:${d.net >= 0 ? 'var(--green)' : 'var(--red)'}">${d.net >= 0 ? '↑ Positive Cash Flow' : '↓ Negative Cash Flow'}</div>
        <button class="fin-btn plain sm fin-no-print" style="margin-top:10px" onclick="FIN.print('Cash Flow Statement', FIN.schoolHeader() + document.getElementById('cf-out').innerHTML)">🖶 Print</button></div></div>`;
    document.getElementById('cf-out').innerHTML = html;
  }

  // ══ Account Ledger (bank / cash account statement) ════════════════════
  FIN.page('ieAccountLedger', async el => {
    const m = await meta();
    const st = S.al;
    el.innerHTML = `${FIN.header('Account Ledger')}
      ${card('▤ Account Ledger', `<div class="fin-grid">${field('Account', select('al-acct', m.accounts.map(a => [a.id, a.label]), st.accountId || '', 'Select Account'), { required: true })}
        ${field('From', FIN.input('al-from', { type: 'date', value: st.from || '' }))}${field('To', FIN.input('al-to', { type: 'date', value: st.to || '' }))}
        ${field('Session', select('al-session', [['', 'All'], ...[...new Set(m.sessions.map(s => s.sessionLabel))]], st.session || ''))}
        <div><button class="fin-btn" onclick="FIN.books.alLoad()">🔍 View</button></div></div>`)}
      <div id="al-out">${st.accountId ? '' : '<div class="fin-note" style="text-align:center">ⓘ<br>Select an Account to View Its Transaction Ledger</div>'}</div>`;
    if (st.accountId) alLoad();
  });
  async function alLoad() {
    const st = S.al;
    Object.assign(st, { accountId: val('al-acct'), from: val('al-from'), to: val('al-to'), session: val('al-session') });
    if (!st.accountId) return showToast('Select an account');
    const d = await FIN.get(`/api/admin/finance/account-ledger${FIN.qs(st)}`);
    document.getElementById('al-out').innerHTML = `<div class="fin-card"><div class="fin-card-body">${stats([
        { label: 'Opening Balance', value: money(d.opening), icon: '▭', bg: 'var(--black-3)', color: 'var(--text-2)' }, { label: 'Money In', value: money(d.totalIn), icon: '↓', bg: 'var(--green-bg)', color: 'var(--green)', valueColor: 'var(--green)' },
        { label: 'Money Out', value: money(d.totalOut), icon: '↑', bg: 'var(--red-bg)', color: 'var(--red)', valueColor: 'var(--red)' }, { label: 'Closing Balance', value: money(d.closing), icon: '₦', bg: 'var(--blue-bg)', color: 'var(--blue)', valueColor: 'var(--blue)' }])}</div><div id="al-table"></div></div>`;
    table(document.getElementById('al-table'), {
      title: `Account Ledger — ${d.account.name}`, rows: d.rows, rowKey: 'k', perPage: 100,
      columns: [
        { key: 'date', label: 'Date', render: r => date(r.date) }, { key: 'kind', label: 'Type', render: r => badge(FIN.cap(r.kind), r.inflow ? 'green' : 'red') },
        { key: 'category', label: 'Head / Category', render: r => esc(FIN.cap(r.category)) }, { key: 'description', label: 'Description', render: r => esc(r.description || '') }, { key: 'ref', label: 'Reference', render: r => esc(r.ref || '') },
        { key: 'inflow', label: 'Money In', num: true, render: r => (r.inflow ? money(r.inflow) : ''), exportValue: r => r.inflow, total: true },
        { key: 'outflow', label: 'Money Out', num: true, render: r => (r.outflow ? money(r.outflow) : ''), exportValue: r => r.outflow, total: true },
        { key: 'balance', label: 'Balance', num: true, render: r => money(r.balance), exportValue: r => r.balance },
      ],
    });
  }
  function openLedger(id) { S.al = { accountId: String(id) }; FIN.goTab('ieAccountLedger'); }

  FIN.books = { quick, newVoucher, refreshItems, erLoad, erNew, erDecide, erDispense, erBulkDispense, erDelete, load, view: v => { S.expenses.view = v; load('expenses'); }, rowMenu, headEdit, headDelete, headImport, showItems, headsView,
    ieaLoad, bbLoad, transfer, adjust, cfLoad, alLoad, openLedger, coaWarnFor: id => coaWarn(FIN.cache.finMeta, id) };
  entriesPage('expenses', 'expense');
  entriesPage('income', 'income');
})();
