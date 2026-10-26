// Finance › Accounting pages (SchoolsFocus layout): Chart of Accounts (with
// Expense Heads, Income Heads, Operating Accounts, Auto-Posting Config,
// Period Management and Currencies), Journal Entries, Account Ledger, Trial
// Balance, Contacts / Bills & Invoices, Budgets, Bank Reconciliation, Tax &
// Compliance and the Financial Reports hub.
(function () {
  const { esc, money, date, dateTime, field, select, val, badge, stats, card, modal, table, menuButton } = FIN;
  const firstOfMonth = () => `${FIN.today().slice(0, 8)}01`;
  const S = { coa: { tab: 'coa', type: '', status: 'active' }, je: {}, al: {}, tb: {}, hub: { tab: 'contacts' }, bud: {}, rec: {}, tax: { tab: 'overview' }, fr: {} };
  const TYPE_COLOR = { asset: 'blue', liability: 'amber', equity: 'cyan', income: 'green', expense: 'red' };
  const ENTRY_LABEL = { manual: 'Manual', accrual: 'Accrual', opening_balance: 'Opening Balance', adjustment: 'Adjustment', fee_payment: 'Fee Payment', payroll: 'Payroll', storefront_sale: 'Storefront Sale', pos_sale: 'POS Sale', requisition: 'Requisition', vendor_invoice: 'Vendor Invoice', vendor_payment: 'Vendor Payment', bank_recon: 'Bank Recon', accrual_reversal: 'Accrual Reversal' };
  const acts = items => menuButton('Actions', items.filter(Boolean));
  const backToJournal = '<button class="fin-btn plain" onclick="FIN.goTab(\'journalEntries\')"><i class=fi-arrow-left></i> Back to Journal</button>';
  async function coaList(fresh) {
    if (fresh || !FIN.cache.coa) FIN.cache.coa = (await FIN.get('/api/admin/acct/accounts')).accounts;
    return FIN.cache.coa;
  }
  const postable = list => list.filter(a => !a.isGroup && a.isActive);
  const coaOptions = (list, sel, ph = '— Search for an account —') => FIN.options(list.map(a => [a.id, `${a.code} — ${a.name}`]), sel, ph);

  // ══ Chart of Accounts (7 tabs) ════════════════════════════════════════
  const COA_TABS = [['coa', 'Chart of Accounts'], ['exp', 'Expense Heads'], ['inc', 'Income Heads'], ['ops', 'Operating Accounts'], ['auto', 'Auto-Posting Config'], ['periods', 'Period Management'], ['cur', 'Currencies']];
  FIN.page('chartOfAccounts', async el => {
    el.innerHTML = `${FIN.header('Chart of Accounts')}<div class="fin-card">${FIN.tabs('coa', COA_TABS, S.coa.tab, k => { S.coa.tab = k; coaDraw(); })}<div id="coa-body"></div></div>`;
    coaDraw();
  });
  async function coaDraw() {
    const box = document.getElementById('coa-body');
    const t = S.coa.tab;
    if (t === 'exp' || t === 'inc') { box.innerHTML = `<div id="coa${t}-body"></div>`; return FIN.books.headsView(`coa${t}`, t === 'exp' ? 'expense' : 'income'); }
    if (t === 'coa') return coaAccounts(box);
    if (t === 'ops') return opsAccounts(box);
    if (t === 'auto') return autoPosting(box);
    if (t === 'periods') return periods(box);
    if (t === 'cur') return currencies(box);
  }
  async function coaAccounts(box) {
    const st = S.coa;
    box.innerHTML = `<div class="fin-card-body"><div class="fin-grid">${field('Account Type', select('coa-type', [['', 'All Types'], ['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expense']], st.type, null, 'onchange="FIN.acct.coaLoad()"'))}
      ${field('Status', select('coa-status', [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']], st.status, null, 'onchange="FIN.acct.coaLoad()"'))}<div style="text-align:right"><button class="fin-btn" onclick="FIN.acct.coaEdit()">+ Add Account</button></div></div></div><div id="coa-t"></div>`;
    coaLoad();
  }
  async function coaLoad() {
    Object.assign(S.coa, { type: val('coa-type'), status: val('coa-status') });
    const list = await coaList(true);
    const rows = list.filter(a => (!S.coa.type || a.type === S.coa.type) && (!S.coa.status || (S.coa.status === 'active') === a.isActive));
    table(document.getElementById('coa-t'), { title: 'Chart of Accounts', rows, perPage: 50, columns: [
      { key: '#', label: '#', sortable: false }, { key: 'code', label: 'Code', render: r => `<b style="font-family:'DM Mono',monospace">${esc(r.code)}</b>` },
      { key: 'name', label: 'Account Name', render: r => `<span style="padding-left:${r.parentId ? 14 : 0}px;font-weight:${r.isGroup ? 800 : 500}">${esc(r.name)}</span>${r.description ? `<div class="muted">${esc(r.description)}</div>` : ''}` },
      { key: 'type', label: 'Type', render: r => badge(FIN.cap(r.type), TYPE_COLOR[r.type]) }, { key: 'isSystem', label: 'Source', render: r => (r.isSystem ? badge('System', 'grey') : badge('Custom', 'blue')), exportValue: r => (r.isSystem ? 'System' : 'Custom') },
      { key: 'parentCode', label: 'Parent Account', render: r => (r.parentCode ? `${esc(r.parentCode)} ${esc(r.parentName)}` : '—') },
      { key: 'isGroup', label: 'Posting', render: r => (r.isGroup ? badge('Group', 'amber') : badge('Postable', 'green')), exportValue: r => (r.isGroup ? 'Group' : 'Postable') },
      { key: 'isActive', label: 'Status', render: r => (r.isActive ? badge('Active', 'green') : badge('Inactive', 'grey')), exportValue: r => (r.isActive ? 'Active' : 'Inactive') },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => coaEdit(r.id) }, !r.isGroup && { label: 'View Ledger', onClick: () => ledger(r.id) }, !r.isSystem && { label: 'Delete', danger: true, onClick: () => coaDelete(r.id) }]) }] });
  }
  async function coaEdit(id) {
    const list = await coaList();
    const a = id ? list.find(x => x.id === id) : { type: 'expense', isActive: true };
    modal({ title: id ? `Edit ${esc(a.code)} ${esc(a.name)}` : 'Add Account', body: `<div class="fin-grid two">
        ${field('Account Code', FIN.input('ca-code', { value: a.code || '', attrs: a.isSystem ? 'readonly' : '' }), { required: true })}${field('Account Name', FIN.input('ca-name', { value: a.name || '' }), { required: true })}
        ${field('Account Type', select('ca-type', [['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expense']], a.type, null, a.isSystem ? 'disabled' : ''), { required: true })}
        ${field('Normal Balance', select('ca-normal', [['', 'Default for the type'], ['debit', 'Debit'], ['credit', 'Credit']], a.normalBalance || ''))}
        ${field('Parent Account', `<select class="ctrl-select" id="ca-parent">${coaOptions(list.filter(x => x.isGroup && x.id !== id), a.parentId || '', 'None (top level)')}</select>`)}
        ${field('Status', select('ca-active', [['1', 'Active'], ['0', 'Inactive']], a.isActive ? '1' : '0'))}
        ${field('Description', FIN.input('ca-desc', { value: a.description || '' }), { span: 2 })}
        <label class="fin-check" style="grid-column:span 2"><input type="checkbox" id="ca-group" ${a.isGroup ? 'checked' : ''}> This is a group (header) account — entries cannot be posted to it</label></div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { code: val('ca-code'), name: val('ca-name'), type: val('ca-type'), normalBalance: val('ca-normal'), parentId: val('ca-parent'), isActive: val('ca-active') === '1', description: val('ca-desc'), isGroup: val('ca-group') };
        id ? await FIN.put(`/api/admin/acct/accounts/${id}`, b) : await FIN.post('/api/admin/acct/accounts', b);
        showToast('Account saved'); close(); coaLoad();
      } }] });
  }
  async function coaDelete(id) { if (!await FIN.confirm('Delete this account?')) return; try { await FIN.del(`/api/admin/acct/accounts/${id}`); showToast('Account deleted'); coaLoad(); } catch (err) { showToast(err.message); } }

  async function opsAccounts(box) {
    const [d, list] = await Promise.all([FIN.get('/api/admin/finance/accounts'), coaList()]);
    S.ops = d.accounts;
    box.innerHTML = `<div class="fin-card-body"><div class="fin-note">Operating accounts are the cash and bank accounts money is received into and paid from (fees, income, expenses, salaries). Accounts with <b>Show on invoice</b> are printed on fee invoices as payment details.</div>
      <div style="text-align:right;margin-top:10px"><button class="fin-btn" onclick="FIN.acct.opsEdit()">+ Add Account</button></div></div><div id="ops-t"></div>`;
    table(document.getElementById('ops-t'), { title: 'Operating Accounts', rows: d.accounts, perPage: 25, columns: [
      { key: 'name', label: 'Account', render: r => `<b>${esc(r.name)}</b>${r.isDefault ? ` ${badge('Default', 'blue')}` : ''}` }, { key: 'type', label: 'Type', render: r => FIN.cap(r.type) },
      { key: 'bankName', label: 'Bank Details', render: r => (r.bankName ? `${esc(r.bankName)}<div class="muted">${esc(r.accountNumber || '')} · ${esc(r.accountName || '')}</div>` : '—'), exportValue: r => [r.bankName, r.accountNumber, r.accountName].filter(Boolean).join(' / ') },
      { key: 'openingBalance', label: 'Opening Balance', num: true, render: r => money(r.openingBalance), exportValue: r => r.openingBalance },
      { key: 'trackBalance', label: 'Track Balance', render: r => (r.trackBalance ? 'Yes' : 'No') }, { key: 'showOnInvoice', label: 'Show on Invoice', render: r => (r.showOnInvoice ? 'Yes' : 'No') },
      { key: 'coaCode', label: 'GL Account', render: r => (r.coaCode ? `${esc(r.coaCode)} ${esc(r.coaName)}` : '<span class="muted">Not mapped</span>') },
      { key: 'isActive', label: 'Status', render: r => (r.isActive ? badge('Active', 'green') : badge('Off', 'grey')), exportValue: r => (r.isActive ? 'Active' : 'Off') },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => opsEdit(r.id) }, { label: 'Delete', danger: true, onClick: () => opsDelete(r.id) }]) }] });
    S.opsCoa = list.filter(a => a.type === 'asset' && !a.isGroup);
  }
  function opsEdit(id) {
    const a = id ? S.ops.find(x => x.id === id) : { type: 'bank', trackBalance: true, showOnInvoice: true, isActive: true, openingBalance: 0 };
    modal({ title: id ? `Edit ${esc(a.name)}` : 'Add Operating Account', size: 'wide', body: `<div class="fin-grid two">
        ${field('Account Name', FIN.input('oa-name', { value: a.name || '', placeholder: 'e.g. SCHOOL FEES — ACCESS BANK' }), { required: true })}${field('Type', select('oa-type', [['bank', 'Bank'], ['cash', 'Cash']], a.type))}
        ${field('Bank Name', FIN.input('oa-bank', { value: a.bankName || '' }))}${field('Account Number', FIN.input('oa-no', { value: a.accountNumber || '' }))}
        ${field('Account Name (as on the bank)', FIN.input('oa-acname', { value: a.accountName || '' }))}${field('Opening Balance (₦)', FIN.input('oa-open', { type: 'number', value: a.openingBalance }))}
        ${field('GL Account (Chart of Accounts)', `<select class="ctrl-select" id="oa-coa">${coaOptions(S.opsCoa, a.coaAccountId || '', 'Not mapped')}</select>`, { span: 2 })}
        <label class="fin-check"><input type="checkbox" id="oa-track" ${a.trackBalance ? 'checked' : ''}> Track balance</label><label class="fin-check"><input type="checkbox" id="oa-show" ${a.showOnInvoice ? 'checked' : ''}> Show on invoice</label>
        <label class="fin-check"><input type="checkbox" id="oa-active" ${a.isActive ? 'checked' : ''}> Active</label><label class="fin-check"><input type="checkbox" id="oa-default" ${a.isDefault ? 'checked' : ''}> Default account</label></div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { name: val('oa-name'), type: val('oa-type'), bankName: val('oa-bank'), accountNumber: val('oa-no'), accountName: val('oa-acname'), openingBalance: val('oa-open'), coaAccountId: val('oa-coa'),
          trackBalance: val('oa-track'), showOnInvoice: val('oa-show'), isActive: val('oa-active'), isDefault: val('oa-default') };
        id ? await FIN.put(`/api/admin/finance/accounts/${id}`, b) : await FIN.post('/api/admin/finance/accounts', b);
        FIN.cache.finMeta = null; FIN.cache.feesMeta = null; showToast('Account saved'); close(); coaDraw();
      } }] });
  }
  async function opsDelete(id) { if (!await FIN.confirm('Delete this account?')) return; try { await FIN.del(`/api/admin/finance/accounts/${id}`); FIN.cache.finMeta = null; showToast('Account deleted'); coaDraw(); } catch (err) { showToast(err.message); } }

  async function autoPosting(box) {
    const d = await FIN.get('/api/admin/acct/auto-posting');
    S.auto = d;
    box.innerHTML = `<div class="fin-card-body"><h3 style="margin-bottom:10px">Auto-Posting Configuration</h3>
      <div class="fin-note ${d.enabled ? '' : 'warn'}" style="margin-bottom:14px"><b>Auto-Posting is currently ${d.enabled ? 'ENABLED' : 'DISABLED'}</b> — When enabled, fee payments, payroll, storefront sales, and requisitions automatically post to the General Ledger. Disable during initial CoA configuration to prevent incomplete postings.
        <div style="margin-top:10px"><button class="fin-btn ${d.enabled ? 'warn' : 'green'} sm" onclick="FIN.acct.autoToggle(${!d.enabled})">${d.enabled ? 'Disable Auto-Posting' : 'Enable Auto-Posting'}</button>
        ${d.enabled ? ' <button class="fin-btn outline sm" onclick="FIN.acct.autoBackfill()">Post earlier records to the ledger</button>' : ''}</div></div>
      <b>Fee Destination Accounts → General Ledger Account</b><p class="muted" style="margin:4px 0 10px">Map each fee destination account to its corresponding asset account in the Chart of Accounts. When a payment is received, the system will debit this CoA account.</p>
      <table class="fin-table"><thead><tr><th>Fee Destination Account</th><th>Type</th><th>Maps to CoA Account (DR when payment received)</th></tr></thead>
      <tbody>${d.accounts.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${FIN.cap(a.type)}</td><td><select class="ctrl-select" data-acc="${a.id}">${coaOptions(d.assetAccounts, a.coaAccountId || '', 'Default (cash / bank)')}</select></td></tr>`).join('')}</tbody></table>
      <button class="fin-btn" style="margin-top:12px" onclick="FIN.acct.autoSave()"><i class=fi-save></i> Save Account Mapping</button></div>`;
  }
  async function autoToggle(on) { await FIN.put('/api/admin/acct/auto-posting', { enabled: on }); showToast(`Auto-Posting ${on ? 'enabled' : 'disabled'}`); coaDraw(); }
  async function autoSave() {
    const mappings = [...document.querySelectorAll('#coa-body select[data-acc]')].map(s => ({ accountId: s.dataset.acc, coaAccountId: s.value }));
    await FIN.put('/api/admin/acct/auto-posting', { mappings }); FIN.cache.finMeta = null; showToast('Account mapping saved');
  }
  async function autoBackfill() {
    if (!await FIN.confirm('Post every income and expense record that is not yet in the General Ledger?')) return;
    const r = await FIN.post('/api/admin/acct/auto-posting/backfill'); showToast(`${r.posted} record(s) posted to the ledger`);
  }

  async function periods(box) {
    const d = await FIN.get('/api/admin/acct/periods');
    S.periods = d.periods;
    const sessions = [...new Set(d.periods.map(p => p.sessionLabel))];
    box.innerHTML = `<div class="fin-card-body"><div class="fin-note">Lock accounting &amp; GL posting for academic periods that have been fully completed, balanced, and audited. This is a recommended practice to prevent accidental or backdated entries that can affect records of such periods. Locking a period prevents new journal entries, income/expense records, and payroll runs from being posted to dates in that period. Existing records remain readable.</div>
      <div class="fin-grid" style="margin-top:12px">${field('Filter by Session', select('pm-sess', [['', 'All Sessions'], ...sessions], S.pmSess || '', null, 'onchange="FIN.acct.pmFilter()"'))}<div style="text-align:right"><button class="fin-btn" onclick="FIN.acct.pmLock()"><i class=fi-lock></i> Lock a Period</button></div></div></div><div id="pm-t"></div>`;
    pmFilter();
  }
  function pmFilter() {
    S.pmSess = val('pm-sess');
    table(document.getElementById('pm-t'), { title: 'Period Management', rows: S.periods.filter(p => !S.pmSess || p.sessionLabel === S.pmSess), rowKey: 'termLabel', perPage: 25, columns: [
      { key: '#', label: '#', sortable: false }, { key: 'sessionLabel', label: 'Session' }, { key: 'termLabel', label: 'Term' }, { key: 'datesOnFile', label: 'Dates on File', render: r => esc(r.datesOnFile || '—') },
      { key: 'fromDate', label: 'Locked Range', render: r => (r.fromDate ? `${date(r.fromDate)} – ${date(r.toDate)}` : '—') },
      { key: 'status', label: 'Status', render: r => (r.status === 'locked' ? badge('Locked', 'red') : badge('Open', 'green')) },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => (r.status === 'locked' ? `<button class="fin-btn plain sm" onclick='FIN.acct.pmUnlock(${JSON.stringify(r.sessionLabel)},${JSON.stringify(r.termLabel)})'><i class=fi-unlock></i> Unlock</button>` : `<button class="fin-btn plain sm" onclick='FIN.acct.pmLock(${JSON.stringify(r.sessionLabel)},${JSON.stringify(r.termLabel)})'><i class=fi-lock></i> Lock</button>`) }] });
  }
  function pmLock(sess, term) {
    const list = S.periods;
    const p = list.find(x => x.sessionLabel === sess && x.termLabel === term) || {};
    modal({ title: 'Lock a Period', body: `<div class="fin-grid two">${field('Session / Term', select('pl-period', list.map(x => [`${x.sessionLabel}|${x.termLabel}`, `${x.sessionLabel} — ${x.termLabel}`]), sess ? `${sess}|${term}` : '', 'Select'), { required: true, span: 2 })}
      ${field('From Date', FIN.input('pl-from', { type: 'date', value: p.fromDate || '' }), { required: true })}${field('To Date', FIN.input('pl-to', { type: 'date', value: p.toDate || '' }), { required: true })}</div>
      <div class="fin-note warn" style="margin-top:10px">No income, expense, journal entry or payroll can be recorded with a date inside this range until it is unlocked.</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: '<i class=fi-lock></i> Lock Period', cls: 'warn', onClick: async (o, close) => {
        const [s, t] = val('pl-period').split('|');
        await FIN.post('/api/admin/acct/periods/lock', { sessionLabel: s, termLabel: t, fromDate: val('pl-from'), toDate: val('pl-to') }); showToast('Period locked'); close(); coaDraw();
      } }] });
  }
  async function pmUnlock(sess, term) { if (!await FIN.confirm(`Unlock ${sess} — ${term}?`)) return; await FIN.post('/api/admin/acct/periods/unlock', { sessionLabel: sess, termLabel: term }); showToast('Period unlocked'); coaDraw(); }

  async function currencies(box) {
    const d = await FIN.get('/api/admin/acct/currencies');
    S.cur = d.currencies;
    box.innerHTML = `<div class="fin-card-body"><div class="fin-note"><b>Base Currency: NGN (₦)</b> — The base currency is the school's official accounting currency. All General Ledger entries and financial reports remain in this currency. Add foreign currencies below to enable multi-currency invoicing and billing.</div>
      <div class="fin-card-head" style="padding:12px 0 0"><div class="fin-card-title">Foreign Currencies</div><button class="fin-btn" onclick="FIN.acct.curEdit()">+ Add Currency</button></div></div><div id="cur-t"></div>`;
    table(document.getElementById('cur-t'), { title: 'Currencies', rows: d.currencies, perPage: 25, emptyText: 'No foreign currencies added yet.', columns: [
      { key: '#', label: '#', sortable: false }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'symbol', label: 'Symbol', render: r => esc(r.symbol || '—') },
      { key: 'rate', label: 'Default Rate (Indicative)', num: true, render: r => `₦${Number(r.rate).toLocaleString()}` }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'active' ? 'green' : 'grey') },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => curEdit(r.id) }, { label: 'Delete', danger: true, onClick: async () => { await FIN.del(`/api/admin/acct/currencies/${r.id}`); showToast('Deleted'); coaDraw(); } }]) }] });
  }
  function curEdit(id) {
    const c = id ? S.cur.find(x => x.id === id) : { status: 'active', rate: 1 };
    modal({ title: id ? 'Edit Currency' : 'Add Currency', body: `<div class="fin-grid two">${field('Code', FIN.input('cu-code', { value: c.code || '', placeholder: 'USD' }), { required: true })}${field('Name', FIN.input('cu-name', { value: c.name || '', placeholder: 'US Dollar' }), { required: true })}
      ${field('Symbol', FIN.input('cu-sym', { value: c.symbol || '' }))}${field('Default Rate (₦ per 1 unit)', FIN.input('cu-rate', { type: 'number', value: c.rate }))}${field('Status', select('cu-status', [['active', 'Active'], ['inactive', 'Inactive']], c.status))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { code: val('cu-code'), name: val('cu-name'), symbol: val('cu-sym'), rate: val('cu-rate'), status: val('cu-status') }; id ? await FIN.put(`/api/admin/acct/currencies/${id}`, b) : await FIN.post('/api/admin/acct/currencies', b); showToast('Currency saved'); close(); coaDraw(); } }] });
  }

  // ══ Journal Entries ═══════════════════════════════════════════════════
  FIN.page('journalEntries', async el => {
    const st = S.je;
    el.innerHTML = `${FIN.header('Journal Entries')}
      <div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">General Journal</div><div class="fin-actions"><button class="fin-btn plain" onclick="FIN.goTab('trialBalance')"><i class=fi-scale></i> Trial Balance</button>
        ${menuButton('+ New Entry', [{ label: 'New Entry', onClick: () => jeEdit() }, { label: 'Import from Excel', onClick: jeImport }], '')}</div></div>
      <div class="fin-card-body"><div class="fin-grid">${field('Status', select('je-status', [['', 'All Statuses'], ['draft', 'Draft'], ['posted', 'Posted'], ['reversed', 'Reversed']], st.status || ''))}
        ${field('Type', select('je-type', [['', 'All Types'], ...Object.entries(ENTRY_LABEL)], st.type || ''))}${field('From Date', FIN.input('je-from', { type: 'date', value: st.from || '' }))}${field('To Date', FIN.input('je-to', { type: 'date', value: st.to || '' }))}
        <div><button class="fin-btn" onclick="FIN.acct.jeLoad()">Apply</button> <button class="fin-btn plain" onclick="FIN.acct.jeClear()">Clear</button></div></div></div><div id="je-t"></div></div>`;
    jeLoad();
  });
  async function jeLoad() {
    Object.assign(S.je, { status: val('je-status'), type: val('je-type'), from: val('je-from'), to: val('je-to') });
    const d = await FIN.get(`/api/admin/acct/journal-entries${FIN.qs(S.je)}`);
    S.jeRows = d.entries;
    table(document.getElementById('je-t'), { title: 'Journal Entries', rows: d.entries, perPage: 30, exportFormats: ['csv', 'xlsx', 'doc'], emptyText: 'No journal entries yet.', columns: [
      { key: 'entryNo', label: 'Entry Code', render: r => `<a href="javascript:void(0)" onclick="FIN.acct.jeView(${r.id})"><b>${esc(r.entryNo)}</b></a>` }, { key: 'entryDate', label: 'Date', render: r => date(r.entryDate) },
      { key: 'memo', label: 'Description', render: r => esc(r.memo || '—') }, { key: 'entryType', label: 'Type', render: r => esc(ENTRY_LABEL[r.entryType] || FIN.cap(r.entryType)) },
      { key: 'totalDebit', label: 'Debits', num: true, render: r => money(r.totalDebit), exportValue: r => r.totalDebit }, { key: 'totalCredit', label: 'Credits', num: true, render: r => money(r.totalCredit), exportValue: r => r.totalCredit },
      { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), { draft: 'amber', posted: 'green', reversed: 'grey' }[r.status]) },
      { key: 'createdByName', label: 'Created By', render: r => esc(r.createdByName || 'System') }, { key: 'postedByName', label: 'Posted By', render: r => esc(r.postedByName || '—') },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'View', onClick: () => jeView(r.id) },
        r.status === 'draft' && { label: 'Post', onClick: () => jeAct(r.id, 'post') }, r.status === 'posted' && { label: 'Reverse', onClick: () => jeAct(r.id, 'reverse') },
        r.status === 'draft' && { label: 'Delete', danger: true, onClick: () => jeAct(r.id, 'delete') }]) }] });
  }
  async function jeAct(id, action) {
    const msg = { post: 'Post this entry to the ledger?', reverse: 'Reverse this entry? A new entry with the debits and credits swapped will be posted.', delete: 'Delete this draft?' }[action];
    if (!await FIN.confirm(msg)) return;
    try { action === 'delete' ? await FIN.del(`/api/admin/acct/journal-entries/${id}`) : await FIN.post(`/api/admin/acct/journal-entries/${id}/${action}`); showToast('Done'); jeLoad(); } catch (err) { showToast(err.message); }
  }
  function jeView(id) {
    const e = S.jeRows.find(x => x.id === id);
    const body = `<dl class="fin-kv"><dt>Date</dt><dd>${date(e.entryDate)}</dd><dt>Type</dt><dd>${esc(ENTRY_LABEL[e.entryType] || e.entryType)}</dd><dt>Status</dt><dd>${esc(FIN.cap(e.status))}</dd><dt>Description</dt><dd>${esc(e.memo || '—')}</dd></dl>
      <table class="fin-table" style="margin-top:12px"><thead><tr><th>Account</th><th>Line Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${e.lines.map(l => `<tr><td>${esc(l.accountCode)} ${esc(l.accountName)}</td><td>${esc(l.description || '')}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${money(e.totalDebit)}</td><td class="num">${money(e.totalCredit)}</td></tr></tfoot></table>`;
    modal({ title: `Journal Entry ${esc(e.entryNo)}`, size: 'wide', body, buttons: [{ label: '<i class=fi-print></i> Print', cls: 'plain', onClick: () => { FIN.print(e.entryNo, `${FIN.schoolHeader()}<h3>Journal Entry ${esc(e.entryNo)}</h3>${body}`); return false; } }, { label: 'Close', cls: 'plain' }] });
  }
  async function jeEdit() {
    const list = postable(await coaList(true));
    S.jeAccts = list;
    modal({ title: 'New Journal Entry', size: 'xwide', body: `<div class="fin-grid">${field('Date', FIN.input('jn-date', { type: 'date', value: FIN.today() }), { required: true })}${field('Type', select('jn-type', Object.entries(ENTRY_LABEL).filter(([k]) => ['manual', 'accrual', 'opening_balance', 'adjustment', 'accrual_reversal'].includes(k)), 'manual'))}
        ${field('Description', FIN.input('jn-memo'), { span: 2 })}</div>
      <table class="fin-table fin-lines" style="margin-top:12px"><thead><tr><th>Account</th><th>Line Description</th><th style="width:140px">Debit</th><th style="width:140px">Credit</th><th></th></tr></thead><tbody id="jn-lines">${jnLine()}${jnLine()}</tbody>
      <tfoot><tr><td colspan="2"><button class="fin-btn plain sm" onclick="document.getElementById('jn-lines').insertAdjacentHTML('beforeend', FIN.acct._jnLine())">+ Add Line</button></td><td class="num" id="jn-td">₦0.00</td><td class="num" id="jn-tc">₦0.00</td><td></td></tr></tfoot></table>
      <div id="jn-bal" class="muted" style="margin-top:6px"></div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save as Draft', cls: 'outline', onClick: (o, close) => jnSave(true, close) }, { label: 'Post Entry', onClick: (o, close) => jnSave(false, close) }] });
  }
  const jnLine = () => `<tr><td><select class="ctrl-select" data-k="accountId">${coaOptions(S.jeAccts, '')}</select></td><td><input class="field-input" data-k="description"></td>
    <td><input class="field-input" type="number" min="0" step="0.01" data-k="debit" oninput="FIN.acct._jnTotals()"></td><td><input class="field-input" type="number" min="0" step="0.01" data-k="credit" oninput="FIN.acct._jnTotals()"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove();FIN.acct._jnTotals()"><i class=fi-x></i></button></td></tr>`;
  const jnRead = () => [...document.querySelectorAll('#jn-lines tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value])));
  function jnTotals() {
    const l = jnRead();
    const d = l.reduce((s, x) => s + (Number(x.debit) || 0), 0); const c = l.reduce((s, x) => s + (Number(x.credit) || 0), 0);
    document.getElementById('jn-td').textContent = FIN.plain(money(d)); document.getElementById('jn-tc').textContent = FIN.plain(money(c));
    document.getElementById('jn-bal').innerHTML = Math.abs(d - c) < 0.01 ? (d ? badge('Balanced', 'green') : '') : badge(`Out of balance by ${FIN.plain(money(Math.abs(d - c)))}`, 'red');
  }
  async function jnSave(draft, close) {
    await FIN.post('/api/admin/acct/journal-entries', { date: val('jn-date'), entryType: val('jn-type'), memo: val('jn-memo'), lines: jnRead(), draft });
    showToast(draft ? 'Saved as draft' : 'Entry posted'); close(); jeLoad();
  }
  function jeImport() {
    const headers = ['Entry', 'Date', 'Description', 'Account Code', 'Line Description', 'Debit', 'Credit'];
    modal({ title: 'Import Journal Entries from Excel', body: `<div class="fin-note">An .xlsx file with columns <b>${headers.join(', ')}</b>. Rows with the same "Entry" value form one entry; each entry must balance. Imported entries are saved as <b>drafts</b> for you to review and post.
        <a href="javascript:void(0)" onclick="FIN.exportRows('xlsx',{title:'journal import template',headers:${JSON.stringify(headers).replace(/"/g, '&quot;')},rows:[['JE1','2026-10-01','Opening balances','1200','Bank','500000',''],['JE1','2026-10-01','Opening balances','3000','Fund balance','','500000']]})">Download the template</a></div>
      <div style="margin-top:12px">${field('Excel file (.xlsx)', '<input type="file" class="field-input" id="ji-file" accept=".xlsx">', { required: true })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Import', onClick: async (o, close) => { const file = await FIN.fileToDataUrl(document.getElementById('ji-file')); const r = await FIN.api('/api/admin/acct/journal-entries/import', { method: 'POST', body: { file } }); showToast(`${r.count} draft entr${r.count === 1 ? 'y' : 'ies'} imported`); close(); jeLoad(); } }] });
  }

  // ══ Account Ledger ════════════════════════════════════════════════════
  FIN.page('accountLedger', async el => {
    const list = postable(await coaList(true));
    const st = S.al;
    el.innerHTML = `${FIN.header('Account Ledger')}<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">
      ${field('Account', `<select class="ctrl-select" id="al2-acc">${coaOptions(list, st.accountId || '')}</select>`, { required: true, span: 2 })}
      ${field('From Date', FIN.input('al2-from', { type: 'date', value: st.from || firstOfMonth() }), { required: true })}${field('To Date', FIN.input('al2-to', { type: 'date', value: st.to || FIN.today() }), { required: true })}
      <div><button class="fin-btn" onclick="FIN.acct.alLoad()">Load Ledger</button> ${backToJournal}</div></div></div><div id="al2-out"></div></div>`;
    if (st.accountId) alLoad();
  });
  async function alLoad() {
    Object.assign(S.al, { accountId: val('al2-acc'), from: val('al2-from'), to: val('al2-to') });
    if (!S.al.accountId) return showToast('Select an account');
    const d = await FIN.get(`/api/admin/acct/ledger${FIN.qs(S.al)}`);
    const out = document.getElementById('al2-out');
    out.innerHTML = `<div class="fin-card-body">${stats([{ label: 'Opening Balance', value: money(d.opening) }, { label: 'Total Debits', value: money(d.lines.reduce((s, l) => s + l.debit, 0)), color: 'var(--green)' }, { label: 'Total Credits', value: money(d.lines.reduce((s, l) => s + l.credit, 0)), color: 'var(--red)' }, { label: 'Closing Balance', value: money(d.closingBalance) }])}</div><div id="al2-t"></div>`;
    table(document.getElementById('al2-t'), { title: `Ledger — ${d.account.code} ${d.account.name}`, caption: `${esc(d.account.code)} ${esc(d.account.name)} · ${date(S.al.from)} – ${date(S.al.to)}`, rows: d.lines, perPage: 50, emptyText: 'No posted entries in this period.', columns: [
      { key: 'entryDate', label: 'Date', render: r => date(r.entryDate) }, { key: 'entryNo', label: 'Entry Code' }, { key: 'entryMemo', label: 'Description', render: r => esc(r.description || r.entryMemo || '') },
      { key: 'entryType', label: 'Type', render: r => esc(ENTRY_LABEL[r.entryType] || r.entryType) },
      { key: 'debit', label: 'Debit', num: true, render: r => (r.debit ? money(r.debit) : ''), exportValue: r => r.debit, total: true }, { key: 'credit', label: 'Credit', num: true, render: r => (r.credit ? money(r.credit) : ''), exportValue: r => r.credit, total: true },
      { key: 'runningBalance', label: 'Balance', num: true, render: r => money(r.runningBalance), exportValue: r => r.runningBalance }] });
  }
  function ledger(accountId) { S.al.accountId = accountId; FIN.goTab('accountLedger'); }

  // ══ Trial Balance ═════════════════════════════════════════════════════
  FIN.page('trialBalance', async el => {
    el.innerHTML = `${FIN.header('Trial Balance')}<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">${field('As at Date', FIN.input('tb-asat', { type: 'date', value: S.tb.asAt || FIN.today() }), { required: true })}
      <div><button class="fin-btn" onclick="FIN.acct.tbLoad()">Generate</button> ${backToJournal}</div></div></div><div id="tb-out"></div></div>`;
    tbLoad();
  });
  async function tbLoad() {
    S.tb.asAt = val('tb-asat');
    const d = await FIN.get(`/api/admin/acct/trial-balance${FIN.qs(S.tb)}`);
    document.getElementById('tb-out').innerHTML = `<div class="fin-card-body">${d.balanced ? badge('Balanced — debits equal credits', 'green') : badge('NOT balanced', 'red')}</div><div id="tb-t"></div>`;
    table(document.getElementById('tb-t'), { title: `Trial Balance as at ${d.asAt}`, caption: `Trial Balance as at ${date(d.asAt)}`, rows: d.accounts, perPage: 'all', emptyText: 'No posted entries yet.', columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Account Name', render: r => `<a href="javascript:void(0)" onclick="FIN.acct.ledger(${r.id})">${esc(r.name)}</a>`, exportValue: r => r.name },
      { key: 'type', label: 'Type', render: r => badge(FIN.cap(r.type), TYPE_COLOR[r.type]) },
      { key: 'totalDebit', label: 'Debit', num: true, render: r => (r.totalDebit ? money(r.totalDebit) : ''), exportValue: r => r.totalDebit, total: true },
      { key: 'totalCredit', label: 'Credit', num: true, render: r => (r.totalCredit ? money(r.totalCredit) : ''), exportValue: r => r.totalCredit, total: true }] });
  }

  // ══ Contacts, Bills & Invoices ════════════════════════════════════════
  const HUB_TABS = [['contacts', 'Contacts'], ['bills', 'Vendor Bills (AP)'], ['invoices', 'Customer Invoices (AR)'], ['apAge', 'Aged Payables'], ['arAge', 'Aged Receivables']];
  FIN.page('contactsBillsInvoices', async el => {
    el.innerHTML = `${FIN.header('Contacts & Invoices')}<div class="fin-card">${FIN.tabs('hub', HUB_TABS, S.hub.tab, k => { S.hub.tab = k; hubDraw(); })}<div id="hub-body"></div></div>`;
    hubDraw();
  });
  function hubDraw() {
    const box = document.getElementById('hub-body');
    const t = S.hub.tab;
    if (t === 'contacts') return contactsView(box, '', hubDraw);
    if (t === 'bills' || t === 'invoices') return billsView(box, t === 'bills' ? 'bill' : 'invoice', hubDraw);
    return ageingView(box, t === 'apAge' ? 'bill' : 'invoice');
  }
  async function contactsView(el, fixedType, refresh) {
    const key = `ct${fixedType || 'all'}`;
    const st = S[key] = S[key] || { type: fixedType, status: '' };
    el.innerHTML = `<div class="fin-card-body"><div class="fin-grid">${fixedType ? '' : field('Type', select(`${key}-type`, [['', 'All Types'], ['vendor', 'Vendor'], ['customer', 'Customer']], st.type))}
      ${field('Status', select(`${key}-status`, [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']], st.status))}
      <div><button class="fin-btn" id="${key}-apply">Apply</button> <button class="fin-btn plain" id="${key}-clear">Clear</button></div><div style="text-align:right"><button class="fin-btn" id="${key}-add">+ Add ${fixedType === 'vendor' ? 'Vendor' : 'Contact'}</button></div></div></div><div id="${key}-t"></div>`;
    document.getElementById(`${key}-apply`).onclick = () => { st.type = fixedType || val(`${key}-type`); st.status = val(`${key}-status`); contactsView(el, fixedType, refresh); };
    document.getElementById(`${key}-clear`).onclick = () => { S[key] = null; contactsView(el, fixedType, refresh); };
    document.getElementById(`${key}-add`).onclick = () => contactEdit(null, fixedType, refresh);
    const d = await FIN.get(`/api/admin/acct/contacts${FIN.qs({ type: st.type, status: st.status })}`);
    S.contacts = d.contacts;
    table(document.getElementById(`${key}-t`), { title: fixedType === 'vendor' ? 'Vendors' : 'Contacts', rows: d.contacts, perPage: 50, emptyText: 'No contacts yet.', columns: [
      { key: 'code', label: 'Code', render: r => esc(r.code || '—') }, { key: 'name', label: 'Business Name', render: r => `<b>${esc(r.name)}</b>${r.address ? `<div class="muted">${esc(r.address)}</div>` : ''}` },
      { key: 'type', label: 'Type', render: r => badge(FIN.cap(r.type), r.type === 'vendor' ? 'amber' : 'blue') }, { key: 'contactPerson', label: 'Contact Person', render: r => esc(r.contactPerson || '—') },
      { key: 'phone', label: 'Phone', render: r => esc(r.phone || '—') }, { key: 'email', label: 'Email', render: r => esc(r.email || '—') }, { key: 'termsDays', label: 'Terms (Days)', num: true },
      { key: 'payable', label: 'Balance', num: true, render: r => money(r.type === 'vendor' ? r.payable : r.receivable), exportValue: r => (r.type === 'vendor' ? r.payable : r.receivable) },
      { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'active' ? 'green' : 'grey') },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => contactEdit(r.id, fixedType, refresh) },
        { label: r.type === 'vendor' ? 'New Bill' : 'New Invoice', onClick: () => billEdit(null, r.type === 'vendor' ? 'bill' : 'invoice', refresh, r.id) },
        { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this contact?')) return; try { await FIN.del(`/api/admin/acct/contacts/${r.id}`); showToast('Deleted'); refresh(); } catch (err) { showToast(err.message); } } }]) }] });
  }
  function contactEdit(id, fixedType, refresh) {
    const c = id ? S.contacts.find(x => x.id === id) : { type: fixedType || 'vendor', status: 'active', termsDays: 30 };
    modal({ title: id ? `Edit ${esc(c.name)}` : 'Add Contact', size: 'wide', body: `<div class="fin-grid two">${field('Business Name', FIN.input('cn-name', { value: c.name || '' }), { required: true })}${field('Type', select('cn-type', [['vendor', 'Vendor (Supplier)'], ['customer', 'Customer']], c.type, null, fixedType ? 'disabled' : ''), { required: true })}
      ${field('Contact Person', FIN.input('cn-person', { value: c.contactPerson || '' }))}${field('Phone', FIN.input('cn-phone', { value: c.phone || '' }))}${field('Email', FIN.input('cn-email', { type: 'email', value: c.email || '' }))}
      ${field('Payment Terms (Days)', FIN.input('cn-terms', { type: 'number', value: c.termsDays }))}${field('Address', FIN.input('cn-addr', { value: c.address || '' }), { span: 2 })}${field('Status', select('cn-status', [['active', 'Active'], ['inactive', 'Inactive']], c.status))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { name: val('cn-name'), type: fixedType || val('cn-type'), contactPerson: val('cn-person'), phone: val('cn-phone'), email: val('cn-email'), termsDays: val('cn-terms'), address: val('cn-addr'), status: val('cn-status') };
        id ? await FIN.put(`/api/admin/acct/contacts/${id}`, b) : await FIN.post('/api/admin/acct/contacts', b); showToast('Contact saved'); close(); refresh();
      } }] });
  }
  const BILL_STATUS = { unpaid: 'amber', partial: 'cyan', paid: 'green', overdue: 'red', void: 'grey' };
  async function billsView(el, docType, refresh) {
    const isBill = docType === 'bill';
    const key = `bl${docType}`;
    const st = S[key] = S[key] || {};
    el.innerHTML = `<div class="fin-card-body"><div class="fin-grid">${field('Status', select(`${key}-status`, [['', 'All Statuses'], ['unpaid', 'Unpaid'], ['partial', 'Part Paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']], st.status || ''))}
      ${field('From Date', FIN.input(`${key}-from`, { type: 'date', value: st.from || '' }))}${field('To Date', FIN.input(`${key}-to`, { type: 'date', value: st.to || '' }))}
      <div><button class="fin-btn" id="${key}-apply">Apply</button></div><div style="text-align:right"><button class="fin-btn" id="${key}-add">+ New ${isBill ? 'Vendor Bill' : 'Customer Invoice'}</button></div></div></div><div id="${key}-t"></div>`;
    document.getElementById(`${key}-apply`).onclick = () => { Object.assign(st, { status: val(`${key}-status`), from: val(`${key}-from`), to: val(`${key}-to`) }); billsView(el, docType, refresh); };
    document.getElementById(`${key}-add`).onclick = () => billEdit(null, docType, refresh);
    const d = await FIN.get(`/api/admin/acct/bills${FIN.qs({ type: docType, ...st })}`);
    S.bills = d.bills;
    const sum = k => d.bills.filter(b => b.status !== 'void').reduce((s, b) => s + b[k], 0);
    el.querySelector('.fin-card-body').insertAdjacentHTML('beforeend', stats([{ label: isBill ? 'Total Billed' : 'Total Invoiced', value: money(sum('amount')) }, { label: 'Paid', value: money(sum('paid')), color: 'var(--green)', bg: 'var(--green-bg)' }, { label: 'Outstanding', value: money(sum('outstanding')), color: 'var(--red)', bg: 'var(--red-bg)' }]));
    table(document.getElementById(`${key}-t`), { title: isBill ? 'Vendor Bills (AP)' : 'Customer Invoices (AR)', rows: d.bills, perPage: 25, emptyText: `No ${isBill ? 'vendor bills' : 'customer invoices'} yet.`, columns: [
      { key: 'docNo', label: isBill ? 'Bill No' : 'Invoice No', render: r => `<b>${esc(r.docNo || '—')}</b>${r.grnId ? `<div>${badge('From GRN', 'grey')}</div>` : ''}` }, { key: 'contactName', label: isBill ? 'Vendor' : 'Customer' },
      { key: 'description', label: 'Description', render: r => esc(r.description || '—') }, { key: 'issueDate', label: 'Date', render: r => date(r.issueDate) },
      { key: 'dueDate', label: 'Due Date', render: r => `${date(r.dueDate)}${r.daysOverdue && r.status !== 'paid' && r.status !== 'void' ? `<div class="muted" style="color:var(--red)">${r.daysOverdue} day(s) overdue</div>` : ''}` },
      { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true }, { key: 'paid', label: 'Paid', num: true, render: r => money(r.paid), exportValue: r => r.paid, total: true },
      { key: 'outstanding', label: 'Outstanding', num: true, render: r => money(r.outstanding), exportValue: r => r.outstanding, total: true },
      { key: 'status', label: 'Status', render: r => badge(r.status === 'partial' ? 'Part Paid' : FIN.cap(r.status), BILL_STATUS[r.status]) },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([
        r.outstanding > 0 && r.status !== 'void' && { label: isBill ? 'Record Payment' : 'Record Receipt', onClick: () => billPay(r.id, refresh) },
        r.status !== 'void' && { label: 'Edit', onClick: () => billEdit(r.id, docType, refresh) },
        !r.paid && r.status !== 'void' && { label: 'Void', onClick: async () => { await FIN.post(`/api/admin/acct/bills/${r.id}/void`); showToast('Voided'); refresh(); } },
        !r.paid && !r.grnId && { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this document?')) return; await FIN.del(`/api/admin/acct/bills/${r.id}`); showToast('Deleted'); refresh(); } }]) }] });
  }
  async function billEdit(id, docType, refresh, contactId) {
    const isBill = docType === 'bill';
    const [c, list] = await Promise.all([FIN.get(`/api/admin/acct/contacts?type=${isBill ? 'vendor' : 'customer'}&status=active`), coaList()]);
    if (!c.contacts.length) return showToast(`Add a ${isBill ? 'vendor' : 'customer'} first (Contacts tab)`);
    const b = id ? S.bills.find(x => x.id === id) : { contactId, issueDate: FIN.today() };
    const glList = postable(list).filter(a => a.type === (isBill ? 'expense' : 'income') || (isBill && a.type === 'asset'));
    modal({ title: id ? `Edit ${esc(b.docNo)}` : `New ${isBill ? 'Vendor Bill' : 'Customer Invoice'}`, size: 'wide', body: `<div class="fin-grid two">
        ${field(isBill ? 'Vendor' : 'Customer', select('bl-contact', c.contacts.map(x => [x.id, x.name]), b.contactId || '', 'Select'), { required: true })}${field(isBill ? 'Bill No (from vendor)' : 'Invoice No', FIN.input('bl-no', { value: b.docNo || '', placeholder: 'Leave blank to number automatically' }))}
        ${field('Date', FIN.input('bl-issue', { type: 'date', value: b.issueDate || '' }), { required: true })}${field('Due Date', FIN.input('bl-due', { type: 'date', value: b.dueDate || '' }), { hint: 'Blank = date + the contact’s payment terms' })}
        ${field('Amount (₦)', FIN.input('bl-amt', { type: 'number', value: b.amount || '' }), { required: true })}${id ? '' : field(isBill ? 'Expense Account' : 'Income Account', `<select class="ctrl-select" id="bl-gl">${coaOptions(glList, '', 'Default')}</select>`, { hint: 'Used when Auto-Posting is on' })}
        ${field('Description', FIN.input('bl-desc', { value: b.description || '' }), { span: 2 })}${field('Notes', FIN.input('bl-notes', { value: b.notes || '' }), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const body = { docType, contactId: val('bl-contact'), docNo: val('bl-no'), issueDate: val('bl-issue'), dueDate: val('bl-due'), amount: val('bl-amt'), description: val('bl-desc'), notes: val('bl-notes'), [isBill ? 'expenseAccountId' : 'incomeAccountId']: val('bl-gl') };
        id ? await FIN.put(`/api/admin/acct/bills/${id}`, body) : await FIN.post('/api/admin/acct/bills', body); showToast('Saved'); close(); refresh();
      } }] });
  }
  async function billPay(id, refresh) {
    const b = S.bills.find(x => x.id === id);
    const isBill = b.docType === 'bill';
    const meta = await FIN.financeMeta();
    modal({ title: `${isBill ? 'Pay' : 'Receive Payment for'} ${esc(b.docNo)} — ${esc(b.contactName)}`, body: `<div class="fin-note" style="margin-bottom:10px">Outstanding: <b>${money(b.outstanding)}</b>. The payment is also recorded under ${isBill ? 'Expenses' : 'Income'}.</div><div class="fin-grid two">
        ${field('Amount (₦)', FIN.input('bp-amt', { type: 'number', value: b.outstanding }), { required: true })}${field('Date', FIN.input('bp-date', { type: 'date', value: FIN.today() }), { required: true })}
        ${field(isBill ? 'Paid From' : 'Received Into', select('bp-acc', meta.accounts.filter(a => a.isActive).map(a => [a.id, a.label || a.name]), (meta.accounts.find(a => a.isDefault) || {}).id || ''))}${field('Method', select('bp-method', meta.methods || ['Bank Transfer', 'Cash', 'Cheque', 'POS'], 'Bank Transfer'))}
        ${field('Reference', FIN.input('bp-ref'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save Payment', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/acct/bills/${id}/pay`, { amount: val('bp-amt'), date: val('bp-date'), accountId: val('bp-acc'), method: val('bp-method'), reference: val('bp-ref') }); showToast('Payment recorded'); close(); refresh(); } }] });
  }
  async function ageingView(el, type) {
    const d = await FIN.get(`/api/admin/acct/ageing?type=${type}`);
    el.innerHTML = `<div class="fin-card-body"><b>${type === 'bill' ? 'Aged Payables' : 'Aged Receivables'}</b> <span class="muted">— outstanding ${type === 'bill' ? 'vendor bills' : 'customer invoices'} by days past the due date (Current, 1–30, 31–60, 61–90, 90+ days)</span>
      ${stats(d.buckets.map(k => ({ label: k === 'Current' ? 'Current' : `${k} days`, value: money(d.totals[k]), color: k === 'Current' ? 'var(--green)' : k === '90+' ? 'var(--red)' : 'var(--amber)' })))}</div><div id="age-t"></div>`;
    table(document.getElementById('age-t'), { title: type === 'bill' ? 'Aged Payables' : 'Aged Receivables', rows: d.rows, rowKey: 'contact', perPage: 50, emptyText: 'Nothing outstanding.', columns: [
      { key: 'contact', label: type === 'bill' ? 'Vendor' : 'Customer' },
      ...d.buckets.map(k => ({ key: k, label: k === 'Current' ? 'Current' : `${k} days`, num: true, render: r => (r[k] ? money(r[k]) : '—'), exportValue: r => r[k], total: true })),
      { key: 'total', label: 'Total', num: true, render: r => `<b>${money(r.total)}</b>`, exportValue: r => r.total, total: true }] });
  }

  // ══ Budgets ═══════════════════════════════════════════════════════════
  FIN.page('budgets', async el => {
    el.innerHTML = `${FIN.header('Budget Periods')}<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">${field('Status', select('bu-status', [['', 'All Statuses'], ['draft', 'Draft'], ['approved', 'Approved'], ['closed', 'Closed']], S.bud.status || ''))}
      <div><button class="fin-btn" onclick="FIN.acct.budLoad()">Apply</button> <button class="fin-btn plain" onclick="FIN.acct.budClear()">Clear</button></div><div style="text-align:right"><button class="fin-btn" onclick="FIN.acct.budEdit()">+ Create Budget</button></div></div></div><div id="bu-t"></div></div>`;
    budLoad();
  });
  async function budLoad() {
    S.bud.status = val('bu-status');
    const d = await FIN.get(`/api/admin/acct/budgets${FIN.qs(S.bud)}`);
    S.budRows = d.budgets;
    table(document.getElementById('bu-t'), { title: 'Budget Periods', rows: d.budgets, perPage: 25, emptyText: 'No budgets yet.', columns: [
      { key: 'name', label: 'Budget Name', render: r => `<a href="javascript:void(0)" onclick="FIN.acct.budView(${r.id})"><b>${esc(r.name)}</b></a>`, exportValue: r => r.name },
      { key: 'periodFrom', label: 'Period', render: r => `${date(r.periodFrom)} – ${date(r.periodTo)}` }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), { draft: 'amber', approved: 'green', closed: 'grey' }[r.status]) },
      { key: 'lines', label: 'Lines', num: true, sort: r => r.lines.length, render: r => r.lines.length, exportValue: r => r.lines.length },
      { key: 'budgeted', label: 'Budgeted', num: true, render: r => money(r.budgeted), exportValue: r => r.budgeted }, { key: 'actual', label: 'Actual', num: true, render: r => money(r.actual), exportValue: r => r.actual },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Budget vs Actual', onClick: () => budView(r.id) }, { label: 'Edit', onClick: () => budEdit(r.id) }, { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this budget?')) return; await FIN.del(`/api/admin/acct/budgets/${r.id}`); showToast('Deleted'); budLoad(); } }]) }] });
  }
  function budView(id) {
    const b = S.budRows.find(x => x.id === id);
    const m = modal({ title: `${esc(b.name)} — Budget vs Actual`, size: 'xwide', body: `<p class="muted" style="margin-bottom:8px">${date(b.periodFrom)} – ${date(b.periodTo)} · actuals are from posted General Ledger entries</p><div id="bv-t"></div>` });
    table(m.body.querySelector('#bv-t'), { title: `${b.name} budget vs actual`, rows: b.lines, perPage: 'all', columns: [
      { key: 'accountCode', label: 'Account', render: r => `${esc(r.accountCode)} ${esc(r.accountName)}`, exportValue: r => `${r.accountCode} ${r.accountName}` }, { key: 'type', label: 'Type', render: r => esc(FIN.cap(r.type)) },
      { key: 'amount', label: 'Budgeted', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true }, { key: 'actual', label: 'Actual', num: true, render: r => money(r.actual), exportValue: r => r.actual, total: true },
      { key: 'variance', label: 'Variance', num: true, render: r => `<span style="color:${r.variance < 0 ? 'var(--red)' : 'var(--green)'}">${money(r.variance)}</span>`, exportValue: r => r.variance, total: true },
      { key: 'usedPct', label: 'Used', num: true, render: r => `${r.usedPct}%` }, { key: 'notes', label: 'Notes', render: r => esc(r.notes || '') }] });
  }
  async function budEdit(id) {
    const list = postable(await coaList()).filter(a => ['income', 'expense'].includes(a.type));
    S.budAccts = list;
    const b = id ? S.budRows.find(x => x.id === id) : { status: 'draft', lines: [] };
    modal({ title: id ? `Edit ${esc(b.name)}` : 'Create Budget', size: 'xwide', body: `<div class="fin-grid">${field('Budget Name', FIN.input('bd-name', { value: b.name || '', placeholder: 'e.g. 2026/2027 Session Budget' }), { required: true })}
        ${field('Period From', FIN.input('bd-from', { type: 'date', value: b.periodFrom || '' }), { required: true })}${field('Period To', FIN.input('bd-to', { type: 'date', value: b.periodTo || '' }), { required: true })}
        ${field('Status', select('bd-status', [['draft', 'Draft'], ['approved', 'Approved'], ['closed', 'Closed']], b.status))}${field('Notes', FIN.input('bd-notes', { value: b.notes || '' }), { span: 2 })}</div>
      <table class="fin-table fin-lines" style="margin-top:12px"><thead><tr><th>Account (Income / Expense)</th><th style="width:170px">Budgeted Amount</th><th>Notes</th><th></th></tr></thead><tbody id="bd-lines">${(b.lines.length ? b.lines : [{}, {}]).map(budLine).join('')}</tbody></table>
      <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('bd-lines').insertAdjacentHTML('beforeend', FIN.acct._budLine())">+ Add Line</button>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save Budget', onClick: async (o, close) => {
        const lines = [...document.querySelectorAll('#bd-lines tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value])));
        const body = { name: val('bd-name'), periodFrom: val('bd-from'), periodTo: val('bd-to'), status: val('bd-status'), notes: val('bd-notes'), lines };
        id ? await FIN.put(`/api/admin/acct/budgets/${id}`, body) : await FIN.post('/api/admin/acct/budgets', body); showToast('Budget saved'); close(); budLoad();
      } }] });
  }
  const budLine = (l = {}) => `<tr><td><select class="ctrl-select" data-k="accountId">${coaOptions(S.budAccts, l.accountId || '', 'Select account')}</select></td><td><input class="field-input" type="number" min="0" data-k="amount" value="${l.amount || ''}"></td><td><input class="field-input" data-k="notes" value="${esc(l.notes || '')}"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()"><i class=fi-x></i></button></td></tr>`;

  // ══ Bank Reconciliation ═══════════════════════════════════════════════
  FIN.page('bankReconciliation', async el => {
    const meta = await FIN.financeMeta(true);
    S.recAccounts = meta.accounts;
    el.innerHTML = `${FIN.header('Bank Reconciliation')}<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">${field('Account', select('rc-acc', meta.accounts.map(a => [a.id, a.name]), S.rec.accountId || '', '— All Accounts —', 'onchange="FIN.acct.recLoad()"'))}
      ${field('Period', FIN.input('rc-period', { type: 'month', value: S.rec.period || '', attrs: 'onchange="FIN.acct.recLoad()"' }))}<div><button class="fin-btn plain" onclick="FIN.acct.recClear()">Clear</button></div>
      <div style="text-align:right"><button class="fin-btn" onclick="FIN.acct.recNew()">+ New Reconciliation</button></div></div></div><div id="rc-t"></div></div>`;
    recLoad();
  });
  async function recLoad() {
    Object.assign(S.rec, { accountId: val('rc-acc'), period: val('rc-period') });
    const d = await FIN.get(`/api/admin/acct/reconciliations${FIN.qs(S.rec)}`);
    table(document.getElementById('rc-t'), { title: 'Bank Reconciliations', rows: d.reconciliations, perPage: 25, emptyText: 'No reconciliations yet.', columns: [
      { key: 'accountName', label: 'Account' }, { key: 'period', label: 'Period', render: r => FIN.monthLabel(r.period) },
      { key: 'opening', label: 'Opening', num: true, render: r => money(r.opening), exportValue: r => r.opening }, { key: 'closing', label: 'Closing', num: true, render: r => money(r.closing), exportValue: r => r.closing },
      { key: 'difference', label: 'Difference', num: true, render: r => `<span style="color:${Math.abs(r.difference) > 0.01 ? 'var(--red)' : 'var(--green)'}">${money(r.difference)}</span>`, exportValue: r => r.difference },
      { key: 'status', label: 'Status', render: r => badge(r.status === 'completed' ? 'Completed' : 'Open', r.status === 'completed' ? 'green' : 'amber') },
      { key: 'openedAt', label: 'Opened', render: r => `${dateTime(r.openedAt)}<div class="muted">${esc(r.openedBy || '')}</div>` },
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: r.status === 'completed' ? 'View' : 'Reconcile', onClick: () => recOpen(r.id) }, { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this reconciliation?')) return; await FIN.del(`/api/admin/acct/reconciliations/${r.id}`); showToast('Deleted'); recLoad(); } }]) }] });
  }
  function recNew() {
    modal({ title: 'New Reconciliation', body: `<div class="fin-grid two">${field('Account', select('rn-acc', S.recAccounts.map(a => [a.id, a.name]), S.rec.accountId || '', 'Select'), { required: true, span: 2 })}
      ${field('Month & Year', FIN.input('rn-period', { type: 'month', value: FIN.today().slice(0, 7) }), { required: true, span: 2 })}
      ${field('Statement Opening Balance (₦)', FIN.input('rn-open', { type: 'number', value: 0 }))}${field('Statement Closing Balance (₦)', FIN.input('rn-close', { type: 'number', value: 0 }), { required: true })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Start', onClick: async (o, close) => { const r = await FIN.post('/api/admin/acct/reconciliations', { accountId: val('rn-acc'), period: val('rn-period'), opening: val('rn-open'), closing: val('rn-close') }); close(); recLoad(); recOpen(r.id); } }] });
  }
  async function recOpen(id) {
    const d = (await FIN.get(`/api/admin/acct/reconciliations/${id}`)).reconciliation;
    const done = d.status === 'completed';
    const m = modal({ title: `Reconcile ${esc(d.accountName)} — ${FIN.monthLabel(d.period)}`, size: 'xwide', body: '<div id="rc-sum"></div><div id="rc-items"></div>', onClose: recLoad,
      buttons: done ? [{ label: 'Reopen', cls: 'warn', onClick: async (o, close) => { await FIN.post(`/api/admin/acct/reconciliations/${id}/reopen`); close(); recOpen(id); } }]
        : [{ label: 'Edit Balances', cls: 'plain', onClick: () => { recBalances(d); return false; } }, { label: '<i class=fi-check></i> Complete Reconciliation', cls: 'green', onClick: async (o, close) => { await FIN.post(`/api/admin/acct/reconciliations/${id}/complete`); showToast('Reconciliation completed'); close(); } }] });
    const drawSum = x => { m.body.querySelector('#rc-sum').innerHTML = stats([{ label: 'Statement Opening', value: money(x.opening) }, { label: 'Cleared In', value: money(x.clearedIn), color: 'var(--green)' }, { label: 'Cleared Out', value: money(x.clearedOut), color: 'var(--red)' }, { label: 'Statement Closing', value: money(x.closing) }, { label: 'Difference', value: money(x.difference), valueColor: Math.abs(x.difference) > 0.01 ? 'var(--red)' : 'var(--green)' }]); };
    drawSum(d);
    S.recItems = d.items;
    m.body.querySelector('#rc-items').innerHTML = `<p class="muted" style="margin:6px 0">Tick each transaction that appears on the bank statement. When the difference is ₦0.00 the reconciliation can be completed.</p>
      <table class="fin-table"><thead><tr><th style="width:30px"><i class=fi-check></i></th><th>Date</th><th>Description</th><th>Reference</th><th class="num">Money In</th><th class="num">Money Out</th></tr></thead>
      <tbody>${d.items.map((i, n) => `<tr><td><input type="checkbox" data-n="${n}" ${i.cleared ? 'checked' : ''} ${done ? 'disabled' : ''}></td><td>${date(i.date)}</td><td>${esc(i.description || i.category || '')}</td><td>${esc(i.ref || '')}</td><td class="num">${i.inflow ? money(i.inflow) : ''}</td><td class="num">${i.outflow ? money(i.outflow) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="fin-empty">No transactions on this account in the month.</td></tr>'}</tbody></table>`;
    m.body.querySelectorAll('input[data-n]').forEach(cb => { cb.onchange = async () => { const i = S.recItems[cb.dataset.n]; const r = await FIN.post(`/api/admin/acct/reconciliations/${id}/toggle`, { kind: i.kind, refId: i.id, cleared: cb.checked }); drawSum(r.reconciliation); }; });
  }
  function recBalances(d) {
    modal({ title: 'Statement Balances', body: `<div class="fin-grid two">${field('Opening (₦)', FIN.input('rb-open', { type: 'number', value: d.opening }))}${field('Closing (₦)', FIN.input('rb-close', { type: 'number', value: d.closing }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { await FIN.put(`/api/admin/acct/reconciliations/${d.id}`, { opening: val('rb-open'), closing: val('rb-close') }); close(); document.querySelectorAll('.fin-overlay').forEach(x => x.remove()); recLoad(); recOpen(d.id); } }] });
  }

  // ══ Tax & Compliance ══════════════════════════════════════════════════
  const TAX_TABS = [['overview', 'Overview'], ['records', 'Tax Remittances'], ['payroll', 'Payroll Remittances'], ['codes', 'Tax Codes'], ['types', 'Tax Types'], ['regulators', 'Regulators']];
  const TAX_STATUS = { remitted: ['Remitted', 'green'], part: ['Part Remitted', 'amber'], due: ['Due', 'red'], no_data: ['No Data', 'grey'] };
  FIN.page('taxCompliance', async el => {
    el.innerHTML = `${FIN.header('Tax & Compliance')}<div class="fin-card">${FIN.tabs('tax', TAX_TABS, S.tax.tab, k => { S.tax.tab = k; taxDraw(); })}<div id="tax-body"></div></div>`;
    taxDraw();
  });
  async function taxDraw() {
    const box = document.getElementById('tax-body');
    const t = S.tax.tab;
    if (t === 'overview') {
      const per = S.tax.period || FIN.today().slice(0, 7);
      const y = Number(per.slice(0, 4));
      box.innerHTML = `<div class="fin-card-body"><div class="fin-grid">${field('Month', select('tx-m', FIN.MONTHS_LONG.map((mn, i) => [String(i + 1).padStart(2, '0'), mn]), per.slice(5, 7)))}${field('Year', select('tx-y', [y - 2, y - 1, y, y + 1].map(String), String(y)))}
        <div><button class="fin-btn" onclick="FIN.acct.taxPeriod()">Load</button></div></div></div><div id="tx-out"></div>`;
      const d = await FIN.get(`/api/admin/acct/tax/overview?period=${per}`);
      S.taxOv = d;
      const out = document.getElementById('tx-out');
      out.innerHTML = `<div class="fin-card-body"><b>Payroll Obligations</b> <span class="muted">— ${FIN.monthLabel(d.period)}</span></div><div id="tx-ob"></div>
        <div class="fin-card-body"><b>Total Payroll Liability: ${money(d.totalPayroll)}</b> <span class="muted">(employee side ${money(d.employeeSide)} · employer side ${money(d.employerSide)})</span></div>
        <div class="fin-card-body"><b>Tax Code GL Balances</b></div><div id="tx-codes"></div><div class="fin-card-body"><b>Total Tax Liability: ${money(d.totalTax)}</b></div>`;
      table(document.getElementById('tx-ob'), { title: 'Payroll Obligations', rows: d.obligations, rowKey: 'obligation', perPage: 'all', noExport: false, columns: [
        { key: 'obligation', label: 'Obligation' }, { key: 'regulator', label: 'Regulator' }, { key: 'employee', label: 'Employee Side', num: true, render: r => money(r.employee), exportValue: r => r.employee },
        { key: 'employer', label: 'Employer Side', num: true, render: r => money(r.employer), exportValue: r => r.employer }, { key: 'total', label: 'Total Owed', num: true, render: r => money(r.total), exportValue: r => r.total },
        { key: 'status', label: 'Status', render: r => badge(...TAX_STATUS[r.status]), exportValue: r => TAX_STATUS[r.status][0] }, { key: 'dateRemitted', label: 'Date Remitted', render: r => (r.dateRemitted ? date(r.dateRemitted) : '—') },
        { key: 'reference', label: 'Reference', render: r => esc(r.reference || '—') },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => acts([{ label: 'View Sources', onClick: () => taxSources(d.period, r.obligation) }, r.total > 0 && { label: 'Record Remittance', onClick: () => remitEdit({ period: d.period, obligation: r.obligation, regulator: r.regulator, amount: r.total - r.remitted }) }]) }] });
      table(document.getElementById('tx-codes'), { title: 'Tax Code GL Balances', rows: d.codes, perPage: 'all', emptyText: 'No active tax codes.', columns: [
        { key: 'glName', label: 'GL Account', render: r => esc(r.glName || r.name) }, { key: 'acctCode', label: 'Acct Code', render: r => esc(r.acctCode || '—') },
        { key: 'accumulated', label: 'Accumulated', num: true, render: r => money(r.accumulated), exportValue: r => r.accumulated }, { key: 'remitted', label: 'Remitted', num: true, render: r => money(r.remitted), exportValue: r => r.remitted },
        { key: 'outstanding', label: 'Outstanding', num: true, render: r => money(r.outstanding), exportValue: r => r.outstanding }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'cleared' ? 'green' : 'red') },
        { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => (r.glAccountId ? `<button class="fin-btn plain sm" onclick="FIN.acct.ledger(${r.glAccountId})">View Ledger</button>` : '—') }] });
      return;
    }
    if (t === 'records') {
      const d = await FIN.get('/api/admin/acct/tax-records');
      S.taxRecs = d.records;
      box.innerHTML = '<div class="fin-card-body" style="text-align:right"><button class="fin-btn" onclick="FIN.acct.trEdit()">+ Record Tax Remittance</button></div><div id="tr-t"></div>';
      return table(document.getElementById('tr-t'), { title: 'Tax Remittances', rows: d.records, perPage: 25, emptyText: 'No tax remittances recorded yet.', columns: [
        { key: 'periodLabel', label: 'Period' }, { key: 'taxType', label: 'Tax Type' }, { key: 'amountDue', label: 'Amount Due', num: true, render: r => money(r.amountDue), exportValue: r => r.amountDue, total: true },
        { key: 'amountPaid', label: 'Amount Paid', num: true, render: r => money(r.amountPaid), exportValue: r => r.amountPaid, total: true }, { key: 'dueDate', label: 'Due Date', render: r => date(r.dueDate) },
        { key: 'datePaid', label: 'Date Paid', render: r => date(r.datePaid) }, { key: 'reference', label: 'Reference', render: r => esc(r.reference || '—') },
        { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), { paid: 'green', 'part paid': 'amber', pending: 'red' }[r.status]) },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => trEdit(r.id) }, { label: 'Delete', danger: true, onClick: async () => { await FIN.del(`/api/admin/acct/tax-records/${r.id}`); showToast('Deleted'); taxDraw(); } }]) }] });
    }
    if (t === 'payroll') {
      const d = await FIN.get('/api/admin/acct/tax/payroll-remittances');
      box.innerHTML = '<div class="fin-card-body" style="text-align:right"><button class="fin-btn" onclick="FIN.acct.remitEdit()">+ Record Payroll Remittance</button></div><div id="pr-t2"></div>';
      return table(document.getElementById('pr-t2'), { title: 'Payroll Remittances', rows: d.remittances, perPage: 25, emptyText: 'No payroll remittances recorded yet.', columns: [
        { key: 'period', label: 'Period', render: r => FIN.monthLabel(r.period) }, { key: 'obligation', label: 'Obligation' }, { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
        { key: 'date_remitted', label: 'Date Remitted', render: r => date(r.date_remitted) }, { key: 'reference', label: 'Reference', render: r => esc(r.reference || '—') }, { key: 'createdByName', label: 'Recorded By', render: r => esc(r.createdByName || '') }] });
    }
    return taxSimple(box, t);
  }
  async function taxSources(period, obligation) {
    const d = await FIN.get(`/api/admin/acct/tax/sources${FIN.qs({ period, obligation })}`);
    const m = modal({ title: `${esc(obligation)} — ${FIN.monthLabel(period)}`, size: 'wide', body: '<div id="ts-t"></div>' });
    table(m.body.querySelector('#ts-t'), { title: `${obligation} sources ${period}`, rows: d.rows, rowKey: 'staffId', perPage: 'all', emptyText: 'No processed salaries for this month.', columns: [
      { key: 'name', label: 'Staff' }, { key: 'basic', label: 'Basic', num: true, render: r => money(r.basic), exportValue: r => r.basic }, { key: 'gross', label: 'Gross', num: true, render: r => money(r.gross), exportValue: r => r.gross },
      { key: 'amount', label: obligation, num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true }] });
  }
  async function remitEdit(pre = {}) {
    const meta = await FIN.financeMeta();
    modal({ title: 'Record Payroll Remittance', body: `<div class="fin-grid two">${field('Month', FIN.input('rm-period', { type: 'month', value: pre.period || FIN.today().slice(0, 7) }), { required: true })}
      ${field('Obligation', select('rm-ob', ['PAYE Tax', 'Pension', 'Health Insurance', 'Housing Fund'], pre.obligation || 'PAYE Tax'), { required: true })}
      ${field('Amount (₦)', FIN.input('rm-amt', { type: 'number', value: pre.amount ? Math.round(pre.amount * 100) / 100 : '' }), { required: true })}${field('Date Remitted', FIN.input('rm-date', { type: 'date', value: FIN.today() }))}
      ${field('Reference / Receipt No', FIN.input('rm-ref'))}${field('Paid From', select('rm-acc', meta.accounts.filter(a => a.isActive).map(a => [a.id, a.label || a.name]), (meta.accounts.find(a => a.isDefault) || {}).id || ''))}
      <label class="fin-check" style="grid-column:span 2"><input type="checkbox" id="rm-exp" checked> Also record it under Expenses (Payroll Statutory Remittances)</label></div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        await FIN.post('/api/admin/acct/tax/payroll-remittances', { period: val('rm-period'), obligation: val('rm-ob'), regulator: pre.regulator, amount: val('rm-amt'), dateRemitted: val('rm-date'), reference: val('rm-ref'), accountId: val('rm-acc'), recordExpense: val('rm-exp') });
        showToast('Remittance recorded'); close(); taxDraw();
      } }] });
  }
  function trEdit(id) {
    const r = id ? S.taxRecs.find(x => x.id === id) : {};
    modal({ title: id ? 'Edit Tax Remittance' : 'Record Tax Remittance', body: `<div class="fin-grid two">${field('Period', FIN.input('tr-period', { value: r.periodLabel || '', placeholder: 'e.g. October 2026 / Q3 2026' }), { required: true })}
      ${field('Tax Type', FIN.input('tr-type', { value: r.taxType || '', placeholder: 'VAT, WHT, PAYE …' }), { required: true })}${field('Amount Due (₦)', FIN.input('tr-due', { type: 'number', value: r.amountDue || '' }))}${field('Amount Paid (₦)', FIN.input('tr-paid', { type: 'number', value: r.amountPaid || '' }))}
      ${field('Due Date', FIN.input('tr-dd', { type: 'date', value: r.dueDate || '' }))}${field('Date Paid', FIN.input('tr-dp', { type: 'date', value: r.datePaid || '' }))}${field('Reference', FIN.input('tr-ref', { value: r.reference || '' }))}${field('Notes', FIN.input('tr-notes', { value: r.notes || '' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { periodLabel: val('tr-period'), taxType: val('tr-type'), amountDue: val('tr-due'), amountPaid: val('tr-paid'), dueDate: val('tr-dd'), datePaid: val('tr-dp'), reference: val('tr-ref'), notes: val('tr-notes') };
        id ? await FIN.put(`/api/admin/acct/tax-records/${id}`, b) : await FIN.post('/api/admin/acct/tax-records', b); showToast('Saved'); close(); taxDraw();
      } }] });
  }
  const TAX_SIMPLE = {
    codes: { title: 'Tax Codes', cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'rate', label: 'Rate', num: true, render: r => `${r.rate}%` }, { key: 'acctCode', label: 'GL Account', render: r => (r.acctCode ? `${esc(r.acctCode)} ${esc(r.glName)}` : '—') }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), r.status === 'active' ? 'green' : 'grey') }] },
    types: { title: 'Tax Types', cols: [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description', render: r => esc(r.description || '—') }, { key: 'regulatorName', label: 'Regulator', render: r => esc(r.regulatorName || '—') }] },
    regulators: { title: 'Regulators', cols: [{ key: 'name', label: 'Name' }, { key: 'short_name', label: 'Short Name', render: r => esc(r.short_name || '—') }, { key: 'contact', label: 'Contact', render: r => esc(r.contact || '—') }] },
  };
  async function taxSimple(box, kind) {
    const d = await FIN.get(`/api/admin/acct/tax/${kind}`);
    S.taxSimple = d.rows;
    const cfg = TAX_SIMPLE[kind];
    box.innerHTML = `<div class="fin-card-body" style="text-align:right"><button class="fin-btn" onclick="FIN.acct.tsEdit('${kind}')">+ Add</button></div><div id="tsx-t"></div>`;
    table(document.getElementById('tsx-t'), { title: cfg.title, rows: d.rows, perPage: 25, columns: [...cfg.cols,
      { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => acts([{ label: 'Edit', onClick: () => tsEdit(kind, r.id) }, { label: 'Delete', danger: true, onClick: async () => { if (!await FIN.confirm('Delete this?')) return; await FIN.del(`/api/admin/acct/tax/${kind}/${r.id}`); showToast('Deleted'); taxDraw(); } }]) }] });
  }
  async function tsEdit(kind, id) {
    const r = id ? S.taxSimple.find(x => x.id === id) : { status: 'active' };
    let body;
    if (kind === 'codes') {
      const list = postable(await coaList()).filter(a => a.type === 'liability' || a.type === 'asset');
      body = `${field('Code', FIN.input('tx-code', { value: r.code || '' }), { required: true })}${field('Name', FIN.input('tx-name', { value: r.name || '' }), { required: true })}${field('Rate (%)', FIN.input('tx-rate', { type: 'number', value: r.rate || '' }))}
        ${field('GL Account', `<select class="ctrl-select" id="tx-gl">${coaOptions(list, r.gl_account_id || '', 'None')}</select>`)}${field('Status', select('tx-status', [['active', 'Active'], ['inactive', 'Inactive']], r.status))}`;
    } else if (kind === 'types') {
      const regs = (await FIN.get('/api/admin/acct/tax/regulators')).rows;
      body = `${field('Name', FIN.input('tx-name', { value: r.name || '' }), { required: true })}${field('Regulator', select('tx-reg', regs.map(x => [x.id, x.name]), r.regulator_id || '', 'None'))}${field('Description', FIN.input('tx-desc', { value: r.description || '' }), { span: 2 })}`;
    } else body = `${field('Name', FIN.input('tx-name', { value: r.name || '' }), { required: true, span: 2 })}${field('Short Name', FIN.input('tx-short', { value: r.short_name || '' }))}${field('Contact', FIN.input('tx-contact', { value: r.contact || '' }))}`;
    modal({ title: `${id ? 'Edit' : 'Add'} ${TAX_SIMPLE[kind].title.replace(/s$/, '')}`, body: `<div class="fin-grid two">${body}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { name: val('tx-name'), code: val('tx-code'), rate: val('tx-rate'), glAccountId: val('tx-gl'), status: val('tx-status'), regulatorId: val('tx-reg'), description: val('tx-desc'), shortName: val('tx-short'), contact: val('tx-contact') };
        id ? await FIN.put(`/api/admin/acct/tax/${kind}/${id}`, b) : await FIN.post(`/api/admin/acct/tax/${kind}`, b); showToast('Saved'); close(); taxDraw();
      } }] });
  }

  // ══ Financial Reports hub ═════════════════════════════════════════════
  const goHub = tab => () => { S.hub.tab = tab; FIN.goTab('contactsBillsInvoices'); };
  const REPORT_GROUPS = [
    ['FEE & STUDENT REPORTS', [
      ['Fees Payment Report', 'Date-range payment collections report. Select a period and payment gateway to see all received payments.', () => FIN.goTab('successfulPayments')],
      ['Termly Class Invoice History', 'Class-by-class invoices, payments and balances for a term.', () => FIN.goTab('classInvoiceHistory')],
      ['Family Fees History', 'Invoices and payments for a family (siblings sharing a parent).', () => FIN.goTab('familyFeesHistory')],
      ['Termly Debtors List', 'Pupils still owing for the selected term, with reminders.', () => FIN.goTab('feesDebtors')],
      ['Fee Debtor Aged Analysis', 'Students with outstanding balances grouped by overdue age buckets.', () => frShow('feeAgeing')],
      ['Debtor Group Analysis', 'Outstanding fees grouped by session, with the number of debtors.', () => frShow('debtorGroups')]]],
    ['BOOKKEEPING & CASH FLOW', [
      ['Income Records', 'Complete income register — system-posted fee collections and manually recorded income entries.', () => FIN.goTab('income')],
      ['Expense Records', 'Complete expense register — paid salaries, dispensed requests, vendor payments and manual expenses.', () => FIN.goTab('expenses')],
      ['Income & Expenses Analytics', 'Charts and summaries of money in and money out over any period.', () => FIN.goTab('incomeExpensesAnalytics')]]],
    ['FINANCIAL STATEMENTS', [
      ['Income & Expenditure', 'P&L for any date range. Optional budget vs. actual overlay.', () => frShow('pnl')],
      ['Balance Sheet', 'Assets, liabilities, and equity as at any date including retained earnings.', () => frShow('bs')],
      ['Trial Balance', 'Debit and credit balances of every account as at a date.', () => FIN.goTab('trialBalance')]]],
    ['CUSTOMER & RECEIVABLES', [
      ['Aged Receivables', 'Current, 1–30, 31–60, 61–90, 90+ days', goHub('arAge')], ['Customer Invoices (AR)', 'Invoices raised to customers and what they have paid.', goHub('invoices')], ['Contacts Hub', 'Vendors and customers with their balances.', goHub('contacts')]]],
    ['SUPPLIER & PAYABLES REPORTS', [['Aged Payables', 'Current, 1–30, 31–60, 61–90, 90+ days', goHub('apAge')], ['Vendor Bills (AP)', 'Bills from suppliers and what has been paid.', goHub('bills')]]],
    ['PAYROLL & STATUTORY REPORTS', [
      ['Staff Loans & Advances', 'Loans given to staff, repayments and balances.', () => FIN.goTab('staffLoansAdvances')],
      ['Payroll Remittance Schedules', 'PAYE, pension, NHIS and NHF deducted per staff for a month.', () => frShow('payrollRemit')],
      ['Tax Liabilities Overview', 'Payroll obligations and tax code balances owed to regulators.', () => { S.tax.tab = 'overview'; FIN.goTab('taxCompliance'); }]]],
    ['INVENTORY & STOCK', [['Inventory Reports', 'Stock movement, valuation, requisitions, adjustments, receipts, low stock and POS shifts.', () => FIN.goTab('inventoryReports')]]],
    ['ONLINE PAYMENTS & SETTLEMENTS', [['Gateway Settlement Log', 'Online payment gateway payouts — settlements received, pending, and upcoming disbursements.', () => frShow('gateway')]]],
  ];
  FIN.page('financialReports', async el => {
    S.fr.view = null;
    const d = await FIN.get('/api/admin/acct/financial-reports');
    FIN._frActions = REPORT_GROUPS.flatMap(g => g[1].map(r => r[2]));
    let n = 0;
    el.innerHTML = `${FIN.header('Financial Reports')}<div id="fr-hub">
      ${stats([{ label: 'Total Income (GL)', value: money(d.totalIncome), color: 'var(--green)', bg: 'var(--green-bg)' }, { label: 'Total Expenses (GL)', value: money(d.totalExpense), color: 'var(--red)', bg: 'var(--red-bg)' }, { label: 'Net Income', value: money(d.netIncome) }, { label: 'Total Assets', value: money(d.totalAssets) }])}
      ${d.hasData ? '' : '<div class="fin-note warn" style="margin-bottom:14px">The General Ledger has no entries yet. Statements on the ledger basis will be empty until Auto-Posting is enabled (Chart of Accounts › Auto-Posting Config) or journal entries are posted. Income &amp; Expenditure can still be run on the records basis.</div>'}
      ${REPORT_GROUPS.map(([g, list]) => `<div class="fin-section-label" style="margin:16px 0 8px">${esc(g)}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${list.map(([t, desc]) => `<button type="button" class="fin-tile" style="text-align:left;cursor:pointer;font-family:'DM Sans',sans-serif" onclick="FIN._frActions[${n++}]()"><h4>${esc(t)}</h4><p>${esc(desc)}</p></button>`).join('')}</div>`).join('')}</div><div id="fr-view"></div>`;
  });
  async function frShow(kind) {
    const hub = document.getElementById('fr-hub'); const box = document.getElementById('fr-view');
    hub.style.display = 'none';
    const back = '<button class="fin-btn plain" onclick="FIN.acct.frBack()"><i class=fi-arrow-left></i> Back to Reports</button>';
    const st = S.fr;
    if (kind === 'pnl') {
      const budgets = (await FIN.get('/api/admin/acct/budgets')).budgets;
      box.innerHTML = card('Income & Expenditure', `<div class="fin-grid">${field('From', FIN.input('fr-from', { type: 'date', value: st.from || `${FIN.today().slice(0, 4)}-01-01` }))}${field('To', FIN.input('fr-to', { type: 'date', value: st.to || FIN.today() }))}
        ${field('Basis', select('fr-basis', [['records', 'Income & expense records'], ['ledger', 'General Ledger']], st.basis || 'records'))}${field('Budget overlay (ledger basis)', select('fr-bud', budgets.map(b => [b.id, b.name]), st.budgetId || '', 'None'))}
        <div><button class="fin-btn" onclick="FIN.acct.frRun('pnl')">Generate</button> ${back}</div></div>`) + '<div id="fr-out"></div>';
      return frRun('pnl');
    }
    if (kind === 'bs') {
      box.innerHTML = card('Balance Sheet', `<div class="fin-grid">${field('As at', FIN.input('fr-asat', { type: 'date', value: st.asAt || FIN.today() }))}<div><button class="fin-btn" onclick="FIN.acct.frRun('bs')">Generate</button> ${back}</div></div>`) + '<div id="fr-out"></div>';
      return frRun('bs');
    }
    if (kind === 'payrollRemit') {
      box.innerHTML = card('Payroll Remittance Schedules', `<div class="fin-grid">${field('Month', FIN.input('fr-per', { type: 'month', value: st.period || FIN.today().slice(0, 7) }))}<div><button class="fin-btn" onclick="FIN.acct.frRun('payrollRemit')">Generate</button> ${back}</div></div>`) + '<div id="fr-out"></div>';
      return frRun('payrollRemit');
    }
    if (kind === 'gateway') {
      box.innerHTML = card('Gateway Settlement Log', `<div class="fin-note">No online payment gateway is connected to this school portal, so there are no gateway settlements to show. Fee payments recorded by the bursary (bank transfer, cash, POS, payment proofs) are listed under <a href="javascript:void(0)" onclick="FIN.goTab('successfulPayments')">Successful Payments</a> and every attempt under <a href="javascript:void(0)" onclick="FIN.goTab('allPaymentAttempts')">All Payment Attempts</a>.</div><div style="margin-top:12px">${back}</div>`);
      return;
    }
    box.innerHTML = card(kind === 'feeAgeing' ? 'Fee Debtor Aged Analysis' : 'Debtor Group Analysis', back) + '<div id="fr-out"></div>';
    return frRun(kind);
  }
  async function frRun(kind) {
    const out = document.getElementById('fr-out');
    const st = S.fr;
    if (kind === 'pnl') {
      Object.assign(st, { from: val('fr-from'), to: val('fr-to'), basis: val('fr-basis'), budgetId: val('fr-bud') });
      const d = await FIN.get(`/api/admin/acct/reports/pnl${FIN.qs(st)}`);
      const withBud = d.budget && d.basis === 'ledger';
      const rows = [...d.income.map(r => ({ ...r, section: 'Income' })), { name: 'Total Income', amount: d.totalIncome, section: 'Income', strong: true }, ...d.expense.map(r => ({ ...r, section: 'Expenditure' })), { name: 'Total Expenditure', amount: d.totalExpense, section: 'Expenditure', strong: true }, { name: d.net >= 0 ? 'Surplus' : 'Deficit', amount: d.net, section: '', strong: true }];
      out.innerHTML = '<div class="fin-card" id="fr-t"></div>';
      return table(document.getElementById('fr-t'), { title: `Income and Expenditure ${d.from} to ${d.to}`, caption: `Income &amp; Expenditure — ${date(d.from)} to ${date(d.to)} (${d.basis === 'ledger' ? 'General Ledger' : 'records'} basis)`, rows, rowKey: 'name', perPage: 'all', columns: [
        { key: 'section', label: 'Section', sortable: false }, { key: 'name', label: 'Line', sortable: false, render: r => (r.strong ? `<b>${esc(r.name)}</b>` : esc(r.name)) },
        { key: 'amount', label: 'Actual', num: true, sortable: false, render: r => (r.strong ? `<b>${money(r.amount)}</b>` : money(r.amount)), exportValue: r => r.amount },
        ...(withBud ? [{ key: 'budget', label: 'Budget', num: true, sortable: false, render: r => (r.accountId && d.budget[r.accountId] != null ? money(d.budget[r.accountId]) : ''), exportValue: r => (r.accountId ? d.budget[r.accountId] ?? '' : '') },
          { key: 'var', label: 'Variance', num: true, sortable: false, render: r => (r.accountId && d.budget[r.accountId] != null ? money(d.budget[r.accountId] - r.amount) : ''), exportValue: r => (r.accountId && d.budget[r.accountId] != null ? d.budget[r.accountId] - r.amount : '') }] : [])] });
    }
    if (kind === 'bs') {
      st.asAt = val('fr-asat');
      const d = await FIN.get(`/api/admin/acct/reports/balance-sheet${FIN.qs({ asAt: st.asAt })}`);
      const rows = [...d.assets.map(r => ({ ...r, section: 'Assets' })), { name: 'Total Assets', amount: d.totalAssets, section: 'Assets', strong: true },
        ...d.liabilities.map(r => ({ ...r, section: 'Liabilities' })), { name: 'Total Liabilities', amount: d.totalLiabilities, section: 'Liabilities', strong: true },
        ...d.equity.map(r => ({ ...r, section: 'Equity' })), { name: 'Retained Earnings (surplus to date)', amount: d.retained, section: 'Equity' }, { name: 'Total Equity', amount: d.totalEquity, section: 'Equity', strong: true },
        { name: 'Total Liabilities + Equity', amount: d.totalLiabilities + d.totalEquity, section: '', strong: true }];
      out.innerHTML = `<div class="fin-card"><div class="fin-card-body">${d.balanced ? badge('Balanced', 'green') : badge('Not balanced — check opening balances', 'red')}</div><div id="fr-t"></div></div>`;
      return table(document.getElementById('fr-t'), { title: `Balance Sheet as at ${d.asAt}`, caption: `Balance Sheet as at ${date(d.asAt)}`, rows, rowKey: 'name', perPage: 'all', columns: [
        { key: 'section', label: 'Section', sortable: false }, { key: 'name', label: 'Line', sortable: false, render: r => (r.strong ? `<b>${esc(r.name)}</b>` : esc(r.name)) },
        { key: 'amount', label: 'Amount', num: true, sortable: false, render: r => (r.strong ? `<b>${money(r.amount)}</b>` : money(r.amount)), exportValue: r => r.amount }] });
    }
    if (kind === 'payrollRemit') {
      st.period = val('fr-per');
      const d = await FIN.get(`/api/admin/acct/reports/payroll-remittance?period=${st.period}`);
      out.innerHTML = '<div class="fin-card" id="fr-t"></div>';
      return table(document.getElementById('fr-t'), { title: `Payroll Remittance Schedule ${d.period}`, caption: `Payroll Remittance Schedule — ${FIN.monthLabel(d.period)}`, rows: d.rows, rowKey: 'staffId', perPage: 'all', emptyText: 'No processed salaries for this month.', columns: [
        { key: 'name', label: 'Staff' }, { key: 'gross', label: 'Gross Pay', num: true, render: r => money(r.gross), exportValue: r => r.gross, total: true },
        ...[['paye', 'PAYE'], ['pensionEmp', 'Pension (Employee)'], ['pensionEr', 'Pension (Employer)'], ['nhis', 'NHIS'], ['nhf', 'NHF']].map(([k, l]) => ({ key: k, label: l, num: true, render: r => money(r[k]), exportValue: r => r[k], total: true }))] });
    }
    const d = await FIN.get('/api/admin/acct/reports/fee-ageing');
    out.innerHTML = '<div class="fin-card" id="fr-t"></div>';
    if (kind === 'feeAgeing') {
      return table(document.getElementById('fr-t'), { title: 'Fee Debtor Aged Analysis', rows: d.rows, rowKey: 'studentId', perPage: 50, emptyText: 'No outstanding fees.', columns: [
        { key: 'name', label: 'Student' }, { key: 'classLabel', label: 'Class' },
        ...d.buckets.map(k => ({ key: k, label: k === 'Current' ? 'Current' : `${k} days`, num: true, render: r => (r[k] ? money(r[k]) : '—'), exportValue: r => r[k], total: true })),
        { key: 'total', label: 'Total', num: true, render: r => `<b>${money(r.total)}</b>`, exportValue: r => r.total, total: true }] });
    }
    return table(document.getElementById('fr-t'), { title: 'Debtor Group Analysis', rows: d.groups, rowKey: 'session', perPage: 'all', emptyText: 'No outstanding fees.', columns: [
      { key: 'session', label: 'Session' }, { key: 'students', label: 'Debtors', num: true, total: rows => rows.reduce((s, r) => s + r.students, 0) },
      { key: 'total', label: 'Outstanding', num: true, render: r => money(r.total), exportValue: r => r.total, total: true }] });
  }
  function frBack() { document.getElementById('fr-view').innerHTML = ''; document.getElementById('fr-hub').style.display = ''; }

  FIN.acct = { coaLoad, coaEdit, opsEdit, autoToggle, autoSave, autoBackfill, pmFilter, pmLock, pmUnlock, curEdit, jeLoad, jeClear: () => { S.je = {}; FIN.open('journalEntries'); }, jeView,
    _jnLine: jnLine, _jnTotals: jnTotals, alLoad, ledger, tbLoad, contactsView, billsView, budLoad, budClear: () => { S.bud = {}; FIN.open('budgets'); }, budView, budEdit, _budLine: () => budLine(),
    recLoad, recClear: () => { S.rec = {}; FIN.open('bankReconciliation'); }, recNew, taxPeriod: () => { S.tax.period = `${val('tx-y')}-${val('tx-m')}`; taxDraw(); }, remitEdit, trEdit, tsEdit, frRun, frBack };
})();
