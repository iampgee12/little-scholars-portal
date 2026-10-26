// Finance › Fees / Bursary and Fees Logs & Reports pages (SchoolsFocus layout):
// Invoice List, Publish / Manage Class Fees, the printable invoice, Class
// Invoice History, Family Fees History (families, wallets), Review Payment
// Proofs, Verify Payment Status, Successful Payments, All Payment Attempts and
// Fees Debtors.
(function () {
  const { esc, money, date, dateTime, field, select, val, badge, stats, card, modal, menu, table, options, pct } = FIN;
  const F = { il: {}, tpl: {}, cih: {}, ffh: { type: 'active' }, deb: {} };

  // ── Multi-select ("All (3)" dropdowns) ────────────────────────────────
  const multis = {};
  function multi(id, list, selected) {
    multis[id] = { list, selected: new Set(selected || list.map(x => x[0])) };
    return `<button type="button" class="ctrl-select" id="${id}" style="text-align:center" onclick="FIN.fees.multiOpen('${id}', this)">${multiLabel(id)}</button>`;
  }
  function multiLabel(id) {
    const m = multis[id];
    if (!m.list.length) return 'None';
    return m.selected.size === m.list.length ? `All (${m.list.length})` : m.selected.size ? m.list.filter(x => m.selected.has(x[0])).map(x => x[1]).join(', ').slice(0, 60) : 'None selected';
  }
  function multiOpen(id, btn) {
    const m = multis[id];
    const box = document.createElement('div');
    box.className = 'fin-menu';
    box.style.padding = '6px 10px';
    box.innerHTML = `<label class="fin-check" style="padding:4px 0"><input type="checkbox" data-all ${m.selected.size === m.list.length ? 'checked' : ''}> Select all</label>` +
      m.list.map(([v, l]) => `<label class="fin-check" style="display:flex;padding:4px 0"><input type="checkbox" value="${esc(v)}" ${m.selected.has(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('');
    document.body.appendChild(box);
    const r = btn.getBoundingClientRect();
    box.style.left = `${r.left}px`; box.style.top = `${r.bottom + 4}px`; box.style.minWidth = `${r.width}px`; box.style.maxHeight = '320px'; box.style.overflowY = 'auto';
    const sync = () => { btn.textContent = multiLabel(id); };
    box.addEventListener('change', e => {
      if (e.target.dataset.all !== undefined) { m.selected = new Set(e.target.checked ? m.list.map(x => x[0]) : []); box.querySelectorAll('input[value]').forEach(i => { i.checked = e.target.checked; }); }
      else { e.target.checked ? m.selected.add(e.target.value) : m.selected.delete(e.target.value); box.querySelector('[data-all]').checked = m.selected.size === m.list.length; }
      sync();
    });
    const off = e => { if (!box.contains(e.target) && e.target !== btn) { box.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
  }
  const multiVal = id => (multis[id] && multis[id].selected.size < multis[id].list.length ? [...multis[id].selected] : []);
  const TYPES = [['mandatory', 'Mandatory Invoices'], ['ondemand', 'On-demand Invoices'], ['other', 'Other Invoices (Hostel, Transport, Purchases, Course Reg., Admission, Etc.)']];
  const STATUSES = [['unpaid', 'Unpaid'], ['partial', 'Partly Paid'], ['paid', 'Total Paid']];

  // shared Class / Class Arm / Session / Term selects
  function periodFields(prefix, s, { requireClass = true, allClasses = false, allTerms = true } = {}, meta) {
    const sessions = FIN.sessionList(meta);
    const terms = FIN.termList(meta);
    const act = FIN.activeTerm();
    return `
      ${field('Class', `<select class="ctrl-select" id="${prefix}-class" onchange="document.getElementById('${prefix}-arm').innerHTML = FIN.armOptions(this.value, '')">${options([['', 'Select Class'], ...(allClasses ? [['ALL', 'All Classes']] : []), ...FIN.classes().map(c => [c.code, c.label])], s.classCode || '')}</select>`, { required: requireClass })}
      ${field('Class Arm', `<select class="ctrl-select" id="${prefix}-arm">${FIN.armOptions(s.classCode, s.armId || '')}</select>`, { required: requireClass })}
      ${field('Fees Session', select(`${prefix}-session`, sessions, s.session || act.sessionLabel), { required: true })}
      ${field('Fees Term', select(`${prefix}-term`, [...(allTerms ? [['all', 'All']] : []), ...terms], s.term || act.termLabel, allTerms ? null : 'Select Term'), { required: true })}`;
  }
  const readPeriod = prefix => ({ classCode: val(`${prefix}-class`), armId: val(`${prefix}-arm`), session: val(`${prefix}-session`), term: val(`${prefix}-term`) });
  const typeLabel = t => ({ mandatory: 'Mandatory', ondemand: 'On-demand', other: 'Other' }[t] || t);

  // ══ Invoice List ═══════════════════════════════════════════════════════
  FIN.page('invoiceList', async el => {
    const meta = await FIN.feesMeta();
    const s = F.il;
    el.innerHTML = `${FIN.header('Payment Collection : Invoice List')}
      ${card('<span><i class=fi-filter></i></span> Filter Invoices to View', `<div class="fin-grid">
        ${periodFields('il', s, { requireClass: false, allClasses: true }, meta)}
        ${field('View Invoices', `<span id="il-titles-box">${multi('il-titles', meta.titles.map(t => [t, t]), s.titles)}</span>`, { required: true })}
        ${field('Filter By Invoice Type', multi('il-types', TYPES, s.types))}
        ${field('Filter By Payment Status', multi('il-status', STATUSES, s.statuses))}
        <div><button class="fin-btn" onclick="FIN.fees.ilView()">View Invoice List</button></div></div>`)}
      ${card('', `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:260px">${field('Search Invoices', `<input class="field-input" id="il-search" placeholder="Search Invoices by Name, Email or Reg. No." onkeydown="if(event.key==='Enter')FIN.fees.ilView()">`)}</div>
          ${FIN.menuButton('+ New Invoice', [{ label: 'Quick Student Invoice', onClick: () => FIN.quickInvoice() }, { label: 'Publish / Manage Class Fees', onClick: () => FIN.goTab('feeTemplates') }], 'outline')}
        </div>`)}
      <div id="il-results"></div>`;
    if (s.loaded) ilView();
  });
  async function ilView() {
    const s = F.il;
    Object.assign(s, readPeriod('il'), { titles: multiVal('il-titles'), types: multiVal('il-types'), statuses: multiVal('il-status'), search: val('il-search'), loaded: true });
    if (s.classCode === 'ALL') s.classCode = '';
    const box = document.getElementById('il-results');
    box.innerHTML = '<div class="fin-empty">Loading…</div>';
    let data;
    try { data = await FIN.get(`/api/admin/fees/invoices${FIN.qs({ classCode: s.classCode, armId: s.armId, session: s.session, term: s.term, titles: s.titles, types: s.types, statuses: s.statuses, search: s.search })}`); } catch (err) { box.innerHTML = `<div class="fin-note red">${esc(err.message)}</div>`; return; }
    const sm = data.summary;
    const clsLabel = s.classCode ? (FIN.classes().find(c => c.code === s.classCode) || {}).label : 'All Classes';
    const heading = `Invoice List | ${s.term === 'all' ? 'All Terms' : esc(s.term)}, ${esc(s.session)} Academic Session | ${esc(clsLabel)}`;
    box.innerHTML = card(heading, `
        ${stats([
          { label: 'Total in list', value: money(sm.total), icon: '₦', bg: 'var(--black-3)', color: 'var(--text-2)' },
          { label: 'Total Paid', value: money(sm.paid), pct: pct(sm.paid, sm.total), icon: '<i class=fi-check></i>', bg: 'var(--green-bg)', color: 'var(--green)', valueColor: 'var(--green)' },
          { label: 'Total Due', value: money(sm.due), pct: pct(sm.due, sm.total), icon: '!', bg: 'var(--red-bg)', color: 'var(--red)', valueColor: 'var(--red)' },
        ])}`, { bodyStyle: 'padding-bottom:0' }) +
      `<div class="fin-card"><div id="il-table"></div></div>
       <div class="fin-grid two">
        ${card('Totals By Class', `<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Class</th><th class="num">Total Amount</th><th class="num">Total Discount</th><th class="num">Net Amount</th><th class="num">Total Paid</th><th class="num">Total Due</th></tr></thead>
          <tbody>${data.classTotals.map(c => `<tr><td>${esc(c.classLabel)}</td><td class="num">${money(c.subtotal)}</td><td class="num">${money(c.discount)}</td><td class="num">${money(c.total)}</td><td class="num">${money(c.paid)}</td><td class="num">${money(c.due)}</td></tr>`).join('') || '<tr><td colspan="6" class="fin-empty">No invoices</td></tr>'}</tbody></table></div>`)}
        ${card('Fees Summary By Fee Items', `<div class="fin-table-wrap" id="il-items"><table class="fin-table"><thead><tr><th>Fee Item</th><th class="num">Grand Total</th><th class="num">Share</th></tr></thead>
          <tbody>${data.itemSummary.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${money(i.amount)}</td><td class="num">(${i.share.toFixed(2)}%)</td></tr>`).join('') || '<tr><td colspan="3" class="fin-empty">No items</td></tr>'}</tbody></table></div>`,
          { actions: `<button class="fin-btn plain sm" onclick="FIN.print('Summary by fee items', FIN.schoolHeader() + '<h3>${esc(FIN.plain(heading)).replace(/'/g, '')}</h3>' + document.getElementById('il-items').innerHTML)">Print Summary</button>` })}
       </div>`;
    F.ilTable = table(document.getElementById('il-table'), {
      title: `Student Fees Invoice List | ${clsLabel} | ${s.session} | ${s.term}`, caption: `<i class=fi-doc></i> Student Fees Invoice List | ${esc(clsLabel)} | ${esc(s.session)} | ${s.term === 'all' ? 'All Terms' : esc(s.term)}`,
      rows: data.invoices, selectable: true, perPage: 20,
      toolbar: () => FIN.menuButton('With Selected', [
        { label: 'Show to Parents / Pupils', onClick: () => ilVisibility(false) }, { label: 'Hide from Parents / Pupils', onClick: () => ilVisibility(true) },
        { label: 'Print Selected Invoices', onClick: () => printInvoices(F.ilTable.picked()) },
      ]),
      printSummary: rows => { const t = rows.reduce((a, r) => ({ total: a.total + r.amount, paid: a.paid + r.paid, due: a.due + Math.max(0, r.balance) }), { total: 0, paid: 0, due: 0 }); return `<p>Total in list: <b>${money(t.total)}</b> · Total Paid: <b>${money(t.paid)}</b> · Total Due: <b>${money(t.due)}</b></p>`; },
      columns: [
        { key: '#', label: '#', sortable: false },
        { key: 'studentName', label: 'Student', render: r => `${esc(r.studentName)}<div class="muted">${esc(r.regNo || r.studentId)}</div>` },
        { key: 'classLabel', label: 'Fee Class', render: r => `${esc(r.classLabel)}${r.armName ? ` - ${esc(r.armName)}` : ''}<div class="muted">(${esc(r.sessionLabel)} | ${esc(r.termLabel)})</div>` },
        { key: 'invoiceNo', label: 'Invoice ID', render: r => `<span style="font-family:'DM Mono',monospace;font-size:11px">${esc(r.invoiceNo)}</span>` },
        { key: 'title', label: 'Invoice Title', render: r => `${esc(r.title)} | ${esc(r.termLabel)} | ${esc(r.sessionLabel)} ACADEMIC SESSION<div class="muted">${typeLabel(r.invoiceType)}</div>`, exportValue: r => r.fullTitle },
        { key: 'amount', label: 'Total', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
        { key: 'paid', label: 'Paid', num: true, render: r => `<span style="color:var(--green)">${money(r.paid)}</span>`, exportValue: r => r.paid, total: true },
        { key: 'balance', label: 'Due', num: true, render: r => `<span style="color:var(--red)">${money(r.balance)}</span>`, exportValue: r => r.balance, total: true },
        { key: 'status', label: 'Status', render: r => `${FIN.statusBadge(r.status)}${r.overdue ? `<div>${badge('Overdue', 'red')}</div>` : ''}<div title="${r.hidden ? 'Hidden from parent / pupil' : 'Visible to parent / pupil'}" style="cursor:pointer;margin-top:3px;font-size:13px;color:var(--text-3)" onclick="FIN.fees.toggleHidden(${r.id}, ${!r.hidden})">${r.hidden ? '<i class=fi-eye-off></i>' : '<i class=fi-eye></i>'}</div>`, exportValue: r => FIN.cap({ partial: 'Partly Paid', paid: 'Total Paid' }[r.status] || r.status) },
        { key: 'createdAt', label: 'Created', render: r => `<span class="muted">${dateTime(r.createdAt)}</span>`, exportValue: r => FIN.plain(dateTime(r.createdAt)) },
        { key: 'collect', label: 'Collection', sub: '(Record Offline Or Direct Bank Payment)', sortable: false, noExport: true, render: r => (r.balance > 0 ? `<button class="fin-btn green sm" onclick="FIN.recordPayment(${r.id}, FIN.fees.ilView)">Record Payment</button>` : '') },
        { key: 'action', label: 'Action', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.fees.invoiceMenu(this, ${r.id})"><i class=fi-dots></i></button>` },
      ],
    });
  }
  async function ilVisibility(hidden) {
    const ids = F.ilTable.picked();
    if (!ids.length) return showToast('Tick at least one invoice first');
    await FIN.post('/api/admin/fees/invoices/visibility', { ids, hidden });
    showToast(hidden ? 'Invoices hidden from parents' : 'Invoices shown to parents');
    ilView();
  }
  async function toggleHidden(id, hidden) {
    await FIN.post('/api/admin/fees/invoices/visibility', { ids: [id], hidden });
    showToast(hidden ? 'Invoice hidden from parent' : 'Invoice shown to parent');
    if (document.getElementById('il-table')) ilView();
  }
  function invoiceMenu(btn, id, after) {
    menu(btn, [
      { label: 'View Invoice', onClick: () => viewInvoice(id, after) },
      { label: 'Download / Share Invoice', onClick: () => printInvoices([id]) },
      { label: 'Edit Invoice', onClick: () => editInvoice(id, after) },
      { label: 'Delete Invoice', danger: true, onClick: () => deleteInvoice(id, after) },
    ]);
  }
  async function deleteInvoice(id, after) {
    if (!await FIN.confirm('Delete this invoice? This cannot be undone.')) return;
    try { await FIN.del(`/api/admin/fees/invoices/${id}`); showToast('Invoice deleted'); (after || ilView)(); } catch (err) { showToast(err.message); }
  }

  // ══ The invoice itself ══════════════════════════════════════════════════
  function invoiceHtml(inv, school, banks, { pos = false } = {}) {
    const photo = inv.photoPath ? `/${esc(inv.photoPath)}` : '/report_assets/student-placeholder.png';
    const status = { paid: badge('Paid', 'green'), partial: badge('Partly Paid', 'amber'), unpaid: badge('Unpaid', 'red') }[inv.status];
    const items = inv.items.map(i => `<tr><td>${esc(i.name)} <span class="muted">*</span></td><td>${esc(i.description || '')}</td><td class="num">${money(i.amount)}</td><td class="muted" style="font-size:10px">→ ${esc(i.accountName || 'DEFAULT FEES ACCOUNT')}</td></tr>`).join('');
    if (pos) {
      return `<div style="text-align:center"><b>${esc(school.name)}</b><br>${esc(school.address || '')}<br>${esc(school.phone || '')}</div><hr>
        <div>FEE INVOICE ${esc(inv.invoiceNo)}<br>${esc(inv.studentName)} (${esc(inv.regNo || inv.studentId)})<br>${esc(inv.classLabel)}${inv.armName ? ` - ${esc(inv.armName)}` : ''}<br>${esc(inv.fullTitle)}</div><hr>
        <table>${inv.items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${money(i.amount)}</td></tr>`).join('')}
        ${inv.discount ? `<tr><td>Discount</td><td class="num">-${money(inv.discount)}</td></tr>` : ''}<tr><td><b>Total</b></td><td class="num"><b>${money(inv.amount)}</b></td></tr>
        <tr><td>Paid</td><td class="num">${money(inv.paid)}</td></tr><tr><td><b>Balance</b></td><td class="num"><b>${money(inv.balance)}</b></td></tr></table><hr>
        <div style="text-align:center">${dateTime(new Date().toISOString())}</div>`;
    }
    return `<div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:18px;background:#fff;color:#0f172a">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div style="font-size:11px"><b>FEE INVOICE</b><br><span style="font-family:'DM Mono',monospace">${esc(inv.invoiceNo)}</span></div>
        <div style="text-align:center;font-size:11px;line-height:1.5"><b style="font-size:13px">${esc(school.name)}</b><br>${esc(school.address || '')}<br>${esc(school.phone || '')}<br>${esc(school.email || '')}</div>
        <img src="/report_assets/school-logo.png" onerror="this.remove()" style="height:60px">
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px;margin-top:14px;flex-wrap:wrap;border-top:1px solid #e2e8f0;padding-top:12px">
        <div style="display:flex;gap:12px"><img src="${photo}" style="width:68px;height:80px;object-fit:cover;border:1px solid #e2e8f0;border-radius:4px">
          <div style="font-size:11px;line-height:1.7"><b>Student :</b><br>Name : ${esc(inv.studentName)}<br>Reg. No : ${esc(inv.regNo || inv.studentId)}<br>Class (as at this Fee) : ${esc(inv.classLabel)}${inv.armName ? ` - ${esc(inv.armName)}` : ''}${inv.studentEmail || inv.parentEmail ? `<br>Email : ${esc(inv.studentEmail || inv.parentEmail)}` : ''}</div></div>
        <div style="font-size:11px;line-height:1.8;text-align:right">Invoice Generated at : ${dateTime(inv.createdAt)}<br>By : ${esc(inv.createdByName || '—')}<br>Status : ${status}
          ${inv.dueDate ? `<br>Due Date : <span style="color:${inv.overdue ? '#dc2626' : 'inherit'}">${date(inv.dueDate)}</span> ${inv.overdue ? badge('Overdue', 'red') : ''}` : ''}</div>
      </div>
      <h3 style="font-size:15px;margin:14px 0 8px">Fees Details</h3>
      <div style="background:#f1f5f9;padding:8px 10px;font-weight:700;font-size:12px">${esc(inv.fullTitle)}</div>
      <table class="fin-table"><thead><tr><th>Fee Item</th><th>Description</th><th class="num">Amount</th><th>Destination</th></tr></thead>
        <tbody>${inv.showBreakdown || !pos ? items : ''}</tbody>
        <tfoot><tr><td colspan="2">Sub-total</td><td class="num">${money(inv.subtotal)}</td><td></td></tr>
        ${inv.discount ? `<tr><td colspan="2">Discount</td><td class="num">-${money(inv.discount)}</td><td></td></tr>` : ''}
        <tr><td colspan="2">Total</td><td class="num">${money(inv.amount)}</td><td></td></tr>
        <tr><td colspan="2">Paid</td><td class="num" style="color:#16a34a">${money(inv.paid)}</td><td></td></tr>
        <tr><td colspan="2">Balance</td><td class="num" style="color:#dc2626">${money(inv.balance)}</td><td></td></tr></tfoot></table>
      ${banks.length ? `<h3 style="font-size:15px;margin:14px 0 8px">Bank Details</h3>
      <table class="fin-table"><thead><tr><th>#</th><th>Bank Country</th><th>Bank Name</th><th>Bank Account Number</th><th>Bank Account Name</th></tr></thead>
        <tbody>${banks.map((b, i) => `<tr><td>${i + 1}</td><td>Nigeria</td><td>${esc(b.bankName || b.name)}</td><td>${esc(b.accountNumber)}</td><td>${esc(b.accountName || '')}</td></tr>`).join('')}</tbody></table>
      <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-top:10px;font-size:11px;color:#dc2626">NOTE: For bank payment, ensure that the correct bank account information and the student/candidate's information <b>(especially the name)</b> are used. After Payment, submit a copy of this invoice and the payment proof/receipt for payment confirmation.</div>` : ''}
    </div>`;
  }
  async function viewInvoice(id, after) {
    const data = await FIN.get(`/api/admin/fees/invoices/${id}`);
    const inv = data.invoice;
    const pays = inv.payments.length ? `<h3 style="font-size:14px;margin:16px 0 8px">Payments</h3><div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Date</th><th>Txn ID</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Proof</th><th></th></tr></thead><tbody>
      ${inv.payments.map(p => `<tr><td>${date(p.paymentDate || p.recordedAt)}</td><td>${esc(p.txnCode)}</td><td class="num">${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '—')}</td><td>${payBadge(p)}</td><td>${FIN.docLink(p.attachmentPath)}</td>
        <td>${p.status === 'pending' ? `<button class="fin-btn green sm" onclick="FIN.fees.setPay(${p.id},'successful')">Approve</button> <button class="fin-btn red sm" onclick="FIN.fees.setPay(${p.id},'failed')">Reject</button>` : p.status === 'successful' ? `<button class="fin-btn plain sm" onclick="FIN.fees.receipt(${p.id})">Receipt</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
    const m = modal({
      title: 'Fee Invoice', size: 'wide',
      body: invoiceHtml(inv, data.school, data.banks) + pays,
      buttons: [
        ...(inv.balance > 0 ? [{ label: 'Pay Now', cls: 'green', onClick: (o, close) => { close(); FIN.recordPayment(inv.id, after || (() => viewInvoice(id))); } },
          { label: 'Upload Payment Proof', cls: 'outline', onClick: (o, close) => { close(); FIN.recordPayment(inv.id, after || (() => viewInvoice(id)), true); } }] : []),
        { label: '<i class=fi-download></i> Download / Share', cls: 'outline', onClick: () => { printInvoices([inv.id]); return false; } },
        { label: '<i class=fi-print></i> Print', cls: 'outline', onClick: () => { FIN.print(`Invoice ${inv.invoiceNo}`, invoiceHtml(inv, data.school, data.banks)); return false; } },
        { label: 'Print (POS)', cls: 'plain', onClick: () => { FIN.print(`Invoice ${inv.invoiceNo}`, invoiceHtml(inv, data.school, data.banks, { pos: true }), { pos: true }); return false; } },
        { label: 'Close', cls: 'plain' },
      ],
    });
    F.openInvoice = { id, after, close: m.close };
  }
  async function printInvoices(ids) {
    if (!ids.length) return showToast('Tick at least one invoice first');
    const list = await Promise.all(ids.map(id => FIN.get(`/api/admin/fees/invoices/${id}`)));
    const html = list.map(d => invoiceHtml(d.invoice, d.school, d.banks)).join('<div style="page-break-after:always;height:16px"></div>');
    FIN.print(ids.length === 1 ? `Invoice ${list[0].invoice.invoiceNo}` : 'Invoices', html);
    if (ids.length === 1 && navigator.share) {
      const i = list[0].invoice;
      navigator.share({ title: `Invoice ${i.invoiceNo}`, text: `${i.studentName} — ${i.fullTitle}: total ${money(i.amount)}, balance ${money(i.balance)}.` }).catch(() => {});
    }
  }
  function payBadge(p) {
    const s = p.displayStatus || p.status;
    return ({ successful: badge('Transaction Successful', 'green'), pending: badge('Pending Payment Completion', 'amber'), failed: badge('Transaction Unsuccessful', 'red'),
      proof_review: badge('Payment Proof Under Review', 'blue'), proof_rejected: badge('Payment Proof Rejected', 'red') }[s] || badge(FIN.cap(s)));
  }
  async function setPay(id, status) {
    const note = status === 'failed' ? await (window.uiPrompt ? uiPrompt('Reason (optional):') : prompt('Reason (optional):')) : '';
    if (note === null) return;
    try {
      await FIN.post(`/api/admin/fees/payments/${id}/status`, { status, note });
      showToast(status === 'successful' ? 'Payment approved' : 'Payment rejected');
      if (F.openInvoice) { F.openInvoice.close(); viewInvoice(F.openInvoice.id, F.openInvoice.after); }
      const tab = document.querySelector('.tab-panel.active');
      if (tab && F.payLogRefresh && tab.contains(document.getElementById('pl-table'))) F.payLogRefresh();
    } catch (err) { showToast(err.message); }
  }
  async function receipt(paymentId) {
    const d = await FIN.get(`/api/admin/fees/payments?status=all`);
    const p = d.payments.find(x => x.id === paymentId);
    if (!p) return;
    const school = FIN.cache.school || {};
    FIN.print(`Receipt ${p.txnCode}`, `${FIN.schoolHeader()}<h3 style="text-align:center">PAYMENT RECEIPT</h3>
      <table><tr><th>Receipt / Txn ID</th><td>${esc(p.txnCode)}</td></tr><tr><th>Date</th><td>${date(p.paymentDate || p.recordedAt)}</td></tr>
      <tr><th>Received from</th><td>${esc(p.studentName)} (${esc(p.regNo || p.studentId)})</td></tr><tr><th>Class</th><td>${esc(p.classLabel)}</td></tr>
      <tr><th>For</th><td>${esc(p.title)} | ${esc(p.termLabel || '')} | ${esc(p.sessionLabel || '')} (${esc(p.invoiceNo)})</td></tr>
      <tr><th>Amount</th><td><b>${money(p.amount)}</b></td></tr><tr><th>Method</th><td>${esc(p.method)}${p.reference ? ` — ${esc(p.reference)}` : ''}</td></tr>
      <tr><th>Received / Confirmed By</th><td>${esc(p.reviewedByName || p.recordedByName || '')}</td></tr></table><p class="muted" style="margin-top:20px;text-align:center">${esc(school.name || '')}</p>`);
  }

  // Record a payment / upload a proof
  FIN.recordPayment = async function (invoiceId, onDone, asProof = false) {
    const [{ invoice: inv }, meta] = await Promise.all([FIN.get(`/api/admin/fees/invoices/${invoiceId}`), FIN.feesMeta()]);
    modal({
      title: asProof ? 'Upload Payment Proof' : 'Record Payment (Offline Or Direct Bank Payment)',
      body: `<div class="fin-note" style="margin-bottom:14px">${esc(inv.studentName)} — ${esc(inv.fullTitle)}<br>Total ${money(inv.amount)} · Paid ${money(inv.paid)} · <b>Balance ${money(inv.balance)}</b>${inv.partPayment ? '' : '<br><b>Part payment is disabled on this invoice.</b>'}</div>
        <div class="fin-grid two">
          ${field('Amount (₦)', FIN.input('rp-amount', { type: 'number', value: inv.balance, attrs: 'min="1" step="0.01"' }), { required: true })}
          ${field('Payment Date', FIN.input('rp-date', { type: 'date', value: FIN.today() }), { required: true })}
          ${field('Payment Method', select('rp-method', meta.methods, asProof ? 'Bank Payment' : 'Cash'), { required: true })}
          ${field('Paid Into', select('rp-account', meta.accounts.map(a => [a.id, a.label]), (meta.accounts.find(a => a.isDefault) || {}).id))}
          ${field('Reference / Teller No.', FIN.input('rp-ref', { placeholder: 'Bank / transaction reference' }))}
          ${field('Note', FIN.input('rp-note', { placeholder: 'Optional' }))}
          ${field(asProof ? 'Payment Proof / Receipt' : 'Attachment / Receipt (optional)', '<input type="file" class="field-input" id="rp-file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx">', { required: asProof, hint: 'Allowed Formats: Jpg, Png, Pdf, Doc, Docx (max 5mb)' })}
        </div>${asProof ? '<div class="fin-note warn" style="margin-top:12px">The payment goes into the review queue as <b>Payment Proof Under Review</b> until it is approved.</div>' : ''}`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, {
        label: asProof ? 'Submit for Review' : 'Record Payment', cls: 'green', onClick: async (o, close) => {
          const attachment = await FIN.fileToDataUrl(document.getElementById('rp-file'));
          if (asProof && !attachment) return showToast('Attach the payment proof'), false;
          await FIN.post(`/api/admin/fees/invoices/${invoiceId}/payments`, {
            amount: val('rp-amount'), method: val('rp-method'), reference: val('rp-ref'), note: val('rp-note'), accountId: val('rp-account'),
            paymentDate: val('rp-date'), attachment, status: asProof ? 'pending' : 'successful', kind: asProof ? 'proof' : 'manual',
          });
          showToast(asProof ? 'Submitted for review' : 'Payment recorded');
          close();
          if (onDone) onDone();
        },
      }],
    });
  };
  window.openRecordPaymentModal = (id, label, onDone) => FIN.recordPayment(id, onDone);

  // Quick Student Invoice / class invoice
  function itemRowsHtml(prefix, items, meta) {
    return items.map((it, i) => `<tr>
      <td><input class="field-input" list="${prefix}-names" data-k="name" value="${esc(it.name || '')}" placeholder="e.g. SCHOOL FEES"></td>
      <td><input class="field-input" type="number" min="0" step="0.01" data-k="amount" value="${esc(it.amount || '')}" oninput="FIN.fees.itemsTotal('${prefix}')"></td>
      <td><input class="field-input" data-k="description" value="${esc(it.description || '')}" placeholder="Optional"></td>
      <td><select class="ctrl-select" data-k="accountId">${options(meta.accounts.map(a => [a.id, a.name]), it.accountId || (meta.accounts.find(a => a.isDefault) || {}).id)}</select></td>
      <td><button type="button" class="fin-btn red sm" onclick="this.closest('tr').remove(); FIN.fees.itemsTotal('${prefix}')"><i class=fi-x></i></button></td></tr>`).join('');
  }
  function itemsEditor(prefix, items, meta) {
    return `<datalist id="${prefix}-names">${meta.itemNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="fin-table-wrap"><table class="fin-table fin-lines"><thead><tr><th style="min-width:180px">Fee Item</th><th style="width:130px">Amount (₦)</th><th>Description</th><th style="min-width:150px">Destination Account</th><th></th></tr></thead>
      <tbody id="${prefix}-items">${itemRowsHtml(prefix, items.length ? items : [{}], meta)}</tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><button type="button" class="fin-btn plain sm" onclick="FIN.fees.addItem('${prefix}')">+ Add Fee Item</button><b id="${prefix}-total"></b></div>`;
  }
  function readItems(prefix) {
    return [...document.querySelectorAll(`#${prefix}-items tr`)].map(tr => {
      const o = {};
      tr.querySelectorAll('[data-k]').forEach(i => { o[i.dataset.k] = i.value.trim(); });
      return o;
    }).filter(i => i.name || i.amount);
  }
  async function addItem(prefix) {
    const meta = await FIN.feesMeta();
    document.getElementById(`${prefix}-items`).insertAdjacentHTML('beforeend', itemRowsHtml(prefix, [{}], meta));
  }
  function itemsTotal(prefix) {
    const sum = readItems(prefix).reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const disc = Number(val(`${prefix}-discount`)) || 0;
    const el = document.getElementById(`${prefix}-total`);
    if (el) el.textContent = `Total: ${money(sum)}${disc ? ` − ${money(disc)} = ${money(sum - disc)}` : ''}`;
  }
  FIN.quickInvoice = async function (pre = {}) {
    const meta = await FIN.feesMeta();
    const act = meta.sessions.find(s => s.isActive) || meta.sessions[0] || {};
    modal({
      title: 'Quick Student Invoice', size: 'wide',
      body: `<div class="fin-grid">
          ${field('Bill', select('qi-mode', [['student', 'A Single Student'], ['class', 'An Entire Class']], pre.classCode ? 'class' : 'student', null, `onchange="document.getElementById('qi-student-box').style.display=this.value==='student'?'':'none';document.getElementById('qi-class-box').style.display=this.value==='class'?'':'none'"`))}
          <div id="qi-student-box" style="${pre.classCode ? 'display:none' : ''}">${field('Student', select('qi-student', FIN.students().map(s => [s.id, `${s.name} (${s.regNo || s.id}) — ${s.classCode}`]), pre.studentId || '', 'Select Student'), { required: true })}</div>
          <div id="qi-class-box" style="${pre.classCode ? '' : 'display:none'}">${field('Class', `<select class="ctrl-select" id="qi-class" onchange="document.getElementById('qi-arm').innerHTML=FIN.armOptions(this.value,'')">${options([['', 'Select Class'], ...FIN.classes().map(c => [c.code, c.label])], pre.classCode || '')}</select>`, { required: true })}
            ${field('Class Arm', `<select class="ctrl-select" id="qi-arm">${FIN.armOptions(pre.classCode || '', '')}</select>`)}</div>
          ${field('Fees Session & Term', select('qi-term', meta.sessions.map(s => [s.id, `${s.sessionLabel} — ${s.termLabel}`]), act.id), { required: true })}
          ${field('Invoice Title', FIN.input('qi-title', { placeholder: 'e.g. EXCURSION FEE' }), { required: true })}
          ${field('Invoice Type', select('qi-type', [['ondemand', 'On-demand Invoice'], ['other', 'Other (Hostel, Transport, Purchases, Course Reg., Admission, Etc.)'], ['mandatory', 'Mandatory Invoice']], 'ondemand'))}
          ${field('Due Date', FIN.input('qi-due', { type: 'date' }))}
          ${field('Discount (₦)', FIN.input('qi-discount', { type: 'number', value: 0, attrs: `min="0" oninput="FIN.fees.itemsTotal('qi')"` }))}
          ${field('Part Payment', select('qi-part', [['1', 'Allowed'], ['0', 'Disabled']], '1'))}
        </div>
        <div class="fin-section-label">Fee Items</div>${itemsEditor('qi', [], meta)}`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, {
        label: 'Create Invoice', cls: 'green', onClick: async (o, close) => {
          const mode = val('qi-mode');
          const body = { academicId: val('qi-term'), title: val('qi-title'), invoiceType: val('qi-type'), dueDate: val('qi-due'), discount: val('qi-discount'), partPayment: val('qi-part') === '1', items: readItems('qi') };
          if (mode === 'student') body.studentId = val('qi-student'); else { body.classCode = val('qi-class'); body.armId = val('qi-arm') !== 'none' ? val('qi-arm') : ''; }
          const r = await FIN.post('/api/admin/fees/invoices', body);
          showToast(`Created ${r.count} invoice${r.count === 1 ? '' : 's'}`);
          close();
          FIN.cache.feesMeta = null;
          if (document.getElementById('il-results') && F.il.loaded) ilView();
        },
      }],
    });
    itemsTotal('qi');
  };
  window.openNewInvoiceModal = () => FIN.quickInvoice();
  async function editInvoice(id, after) {
    const [{ invoice: inv }, meta] = await Promise.all([FIN.get(`/api/admin/fees/invoices/${id}`), FIN.feesMeta()]);
    modal({
      title: `Edit Invoice ${esc(inv.invoiceNo)}`, size: 'wide',
      body: `<div class="fin-grid">${field('Invoice Title', FIN.input('ei-title', { value: inv.title }), { required: true })}${field('Due Date', FIN.input('ei-due', { type: 'date', value: inv.dueDate || '' }))}
        ${field('Discount (₦)', FIN.input('ei-discount', { type: 'number', value: inv.discount, attrs: `oninput="FIN.fees.itemsTotal('ei')"` }))}</div>
        ${inv.paid ? `<div class="fin-note warn" style="margin:10px 0">${money(inv.paid)} has been paid — the new total cannot be less than that.</div>` : ''}
        <div class="fin-section-label">Fee Items</div>${itemsEditor('ei', inv.items, meta)}`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, {
        label: 'Save Changes', cls: 'green', onClick: async (o, close) => {
          await FIN.put(`/api/admin/fees/invoices/${id}`, { title: val('ei-title'), dueDate: val('ei-due'), discount: val('ei-discount'), items: readItems('ei') });
          showToast('Invoice updated'); close(); (after || ilView)();
        },
      }],
    });
    itemsTotal('ei');
  }

  // ══ Publish / Manage Class Fees (fee templates) ═════════════════════════
  FIN.page('feeTemplates', async el => {
    const meta = await FIN.feesMeta();
    const s = F.tpl;
    el.innerHTML = `${FIN.header('Fees Invoice Templates')}
      ${card('<span><i class=fi-filter></i></span> Select Options to Manage Fees', `<div class="fin-grid">
          ${field('Class', `<select class="ctrl-select" id="tp-class" onchange="document.getElementById('tp-arm').innerHTML=FIN.armOptions(this.value,'','All')">${options([['ALL', 'All Classes'], ...FIN.classes().map(c => [c.code, c.label])], s.classCode || 'ALL')}</select>`, { required: true })}
          ${field('Class Arm', `<select class="ctrl-select" id="tp-arm">${FIN.armOptions(s.classCode && s.classCode !== 'ALL' ? s.classCode : '', s.armId || '', 'All')}</select>`, { required: true })}
          ${field('Fees Session', select('tp-session', FIN.sessionList(meta), s.session || FIN.activeTerm().sessionLabel), { required: true })}
          ${field('Fees Term', select('tp-term', [['all', 'All'], ...FIN.termList(meta)], s.term || FIN.activeTerm().termLabel), { required: true })}
        </div><div style="text-align:center;margin-top:14px"><button class="fin-btn" onclick="FIN.fees.tplLoad()">Go to Class Fees</button> <button class="fin-btn outline" onclick="FIN.fees.tplEdit()">+ New Fee Template</button></div>`)}
      <div id="tp-results"></div>`;
    tplLoad();
  });
  async function tplLoad() {
    const s = F.tpl;
    Object.assign(s, { classCode: val('tp-class'), armId: val('tp-arm'), session: val('tp-session'), term: val('tp-term') });
    const box = document.getElementById('tp-results');
    const data = await FIN.get(`/api/admin/fees/templates${FIN.qs({ classCode: s.classCode, armId: s.armId, session: s.session, term: s.term })}`);
    const clsLabel = s.classCode === 'ALL' ? 'All Classes' : (FIN.classes().find(c => c.code === s.classCode) || {}).label || '';
    const rowsOf = type => data.templates.filter(t => (type === 'mandatory' ? t.invoiceType === 'mandatory' : t.invoiceType !== 'mandatory'));
    const section = (type, title, note) => `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title"><i class=fi-doc></i> ${title}</div></div>
        <div class="fin-card-body"><div class="fin-note" style="margin-bottom:12px">${note}</div>
        <div style="font-weight:700;font-size:12px;margin-bottom:6px">${title} For: | ${esc(s.session)} ${esc(s.term === 'all' ? '' : s.term)} | ${esc(clsLabel)}</div></div>
        <div id="tp-table-${type}"></div></div>`;
    box.innerHTML = section('mandatory', 'Mandatory Invoice Templates', 'A Mandatory Fee Schedule (Invoice Template) comprises of fee items that are required to be paid by every student of the class. It may contain items like: Tuition, ICT Fee, Development Fee, etc. A Mandatory Fee Invoice (once the template is configured) is automatically generated for every student of the class, as well as for every new student that gets enrolled or promoted into the class in that academic session.')
      + section('ondemand', 'On-demand Invoice Templates', 'An On-demand Fee Schedule holds optional fees (e.g. excursion, uniform, club). With <b>Self-generate</b> switched on, parents / pupils of the class can generate the invoice themselves from the pupil portal; with <b>Auto-generate</b> on, every pupil gets it.');
    ['mandatory', 'ondemand'].forEach(type => table(document.getElementById(`tp-table-${type}`), {
      title: `${type === 'mandatory' ? 'Mandatory' : 'On-demand'} Invoice Templates`, rows: rowsOf(type), perPage: 50, noExport: false,
      columns: [
        { key: '#', label: '#', sortable: false },
        { key: 'for', label: 'For', sort: r => r.classes.map(c => c.classLabel).join(), render: r => `${r.classes.slice(0, 3).map(c => `${esc(c.classLabel)}${c.armName ? ` - ${esc(c.armName)}` : ''}`).join('<br>')}${r.classes.length > 3 ? `<br><a href="javascript:void(0)" onclick="FIN.fees.tplView(${r.id})">+${r.classes.length - 3} more</a>` : ''}`, exportValue: r => r.classes.map(c => c.classLabel + (c.armName ? ` - ${c.armName}` : '')).join('; ') },
        { key: 'title', label: 'Invoice Title', render: r => `${esc(r.title)} <button class="fin-btn plain sm" title="View" onclick="FIN.fees.tplView(${r.id})"><i class=fi-search></i></button>` },
        { key: 'total', label: 'Total Amount', num: true, render: r => money(r.total), exportValue: r => r.total },
        { key: 'sessionLabel', label: 'Fee Session' }, { key: 'termLabel', label: 'Fee Term' },
        { key: 'autoGenerate', label: 'Auto-generate Status', sub: '(Automaticaly generate this invoice for all eligible students of the class(es))', render: r => `${FIN.onOffSwitch(r.autoGenerate, `FIN.fees.tplToggle(${r.id},'autoGenerate',${!r.autoGenerate})`)}<div style="margin-top:6px"><button class="fin-btn plain sm" onclick="FIN.fees.tplGenerate(${r.id})">Generate Now</button></div>`, exportValue: r => (r.autoGenerate ? 'ON' : 'OFF') },
        { key: 'selfGenerate', label: 'Self-generate Status', sub: '(Allow parents/students of the class(es) to generate invoice from this template)', render: r => FIN.onOffSwitch(r.selfGenerate, `FIN.fees.tplToggle(${r.id},'selfGenerate',${!r.selfGenerate})`), exportValue: r => (r.selfGenerate ? 'ON' : 'OFF') },
        { key: 'generatedCount', label: 'Generated Invoices', render: r => `<div style="text-align:center"><b>${r.generatedCount}</b><br><button class="fin-btn plain sm" onclick="FIN.fees.tplInvoices(${r.id})">View Invoices</button></div>`, exportValue: r => r.generatedCount },
        { key: 'act', label: 'Action', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'View Invoice Template',onClick:()=>FIN.fees.tplView(${r.id})},{label:'Edit Template',onClick:()=>FIN.fees.tplEdit(${r.id})},{label:'Delete Template',danger:true,onClick:()=>FIN.fees.tplDelete(${r.id})}])"><i class=fi-dots></i></button>` },
      ],
    }));
  }
  async function tplToggle(id, field, value) {
    const r = await FIN.post(`/api/admin/fees/templates/${id}/toggle`, { field, value });
    showToast(`${field === 'autoGenerate' ? 'Auto-generate' : 'Self-generate'} switched ${value ? 'on' : 'off'}${r.generated ? ` — ${r.generated} invoice(s) generated` : ''}`);
    tplLoad();
  }
  async function tplGenerate(id) {
    const r = await FIN.post(`/api/admin/fees/templates/${id}/generate`);
    showToast(r.generated ? `${r.generated} invoice(s) generated` : 'Every eligible pupil already has this invoice');
    tplLoad();
  }
  async function tplDelete(id) {
    if (!await FIN.confirm('Delete this fee template and the unpaid invoices made from it?')) return;
    try { await FIN.del(`/api/admin/fees/templates/${id}`); showToast('Template deleted'); tplLoad(); } catch (err) { showToast(err.message); }
  }
  async function tplInvoices(id) {
    const { template: t } = await FIN.get(`/api/admin/fees/templates/${id}`);
    const cls = t.classes[0] || {};
    Object.assign(F.il, { classCode: t.classes.length === 1 ? cls.classCode : '', armId: '', session: t.sessionLabel, term: t.termLabel, titles: [t.title], loaded: true });
    FIN.goTab('invoiceList');
  }
  function templateHtml(t, school) {
    return `<div style="text-align:center"><b style="font-size:16px">${esc(school.name)}</b><br><span style="font-size:11px">${esc(school.address || '')}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin:8px 0"><div>Email: ${esc(school.email || '')}<br>Tel: ${esc(school.phone || '')}</div><img src="/report_assets/school-logo.png" onerror="this.remove()" style="height:46px"><div>Our Ref.: ____________<br>Your Ref.: ____________</div></div>
      <div style="border-top:3px double #15803d;margin:6px 0 10px"></div>
      <h3 style="text-align:center">Fee Schedule</h3><div style="font-size:12px">Title : ${esc(t.title)}<br>For Session : ${esc(t.sessionLabel)} › ${esc(t.termLabel)}</div>
      <h4 style="margin:12px 0 6px">Fees Breakdown</h4><div style="font-weight:700;font-size:12px;border-bottom:1px solid #e2e8f0;padding:6px 0">${esc(t.title)}</div>
      <table class="fin-table"><thead><tr><th>#</th><th>Fee Item</th><th class="num">Amount</th><th>Description</th><th>Destination</th></tr></thead>
      <tbody>${t.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="num">${money(i.amount)}</td><td>${esc(i.description || '')}</td><td class="muted" style="font-size:10px">→ ${esc(i.accountName || 'DEFAULT FEES ACCOUNT')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2" class="num">Total</td><td class="num">${money(t.subtotal)}</td><td colspan="2"></td></tr></tfoot></table>
      <table class="fin-table" style="max-width:460px;margin-top:12px"><tr><td>Discount :</td><td>-₦ ${money(t.discount).slice(1)}</td></tr><tr><td>Payable :</td><td><b>${money(t.total)}</b></td></tr>
      <tr><td>Part Payment :</td><td>${t.partPayment ? 'Allowed' : 'Disabled'}</td></tr><tr><td>Show Invoice Breakdown to Students / Parents :</td><td>${t.showBreakdown ? 'Yes' : 'No'}</td></tr>
      <tr><td>For Class(es) :</td><td>${t.classes.map(c => `${esc(c.classLabel)}${c.armName ? ` - ${esc(c.armName)}` : ''}`).join('<br>')}</td></tr></table>`;
  }
  async function tplView(id) {
    const { template: t, school } = await FIN.get(`/api/admin/fees/templates/${id}`);
    modal({ title: 'Fees Invoice Template', size: 'wide', body: templateHtml(t, school), buttons: [{ label: '<i class=fi-print></i> Print', cls: 'outline', onClick: () => { FIN.print(t.title, templateHtml(t, school)); return false; } }, { label: 'Close', cls: 'plain' }] });
  }
  async function tplEdit(id) {
    const meta = await FIN.feesMeta();
    const t = id ? (await FIN.get(`/api/admin/fees/templates/${id}`)).template : { items: [], classes: [], invoiceType: 'mandatory', discount: 0, partPayment: false, showBreakdown: true, autoGenerate: true, selfGenerate: false };
    const act = meta.sessions.find(s => s.isActive) || meta.sessions[0] || {};
    const picked = new Set(t.classes.map(c => `${c.classCode}|${c.classArmId || ''}`));
    const classBoxes = FIN.classes().map(c => {
      const arms = FIN.arms(c.code);
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><label class="fin-check"><input type="checkbox" data-cls="${esc(c.code)}|" ${picked.has(`${c.code}|`) ? 'checked' : ''}> <b>${esc(c.label)}</b> (whole class)</label>
        ${arms.map(a => `<label class="fin-check" style="margin-left:18px"><input type="checkbox" data-cls="${esc(c.code)}|${a.id}" ${picked.has(`${c.code}|${a.id}`) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>`;
    }).join('');
    modal({
      title: id ? 'Edit Fee Template' : 'New Fee Template (Publish Class Fees)', size: 'xwide',
      body: `<div class="fin-grid">
          ${field('Invoice Title', FIN.input('te-title', { value: t.title || '', placeholder: 'e.g. SCHOOL FEES' }), { required: true })}
          ${field('Fees Session & Term', select('te-term', meta.sessions.map(s => [s.id, `${s.sessionLabel} — ${s.termLabel}`]), t.academicId || act.id), { required: true })}
          ${field('Template Type', select('te-type', [['mandatory', 'Mandatory (every pupil pays)'], ['ondemand', 'On-demand (optional)'], ['other', 'Other (Hostel, Transport, Purchases, Course Reg., Admission, Etc.)']], t.invoiceType))}
          ${field('Due Date', FIN.input('te-due', { type: 'date', value: t.dueDate || '' }))}
          ${field('Discount (₦)', FIN.input('te-discount', { type: 'number', value: t.discount || 0, attrs: `oninput="FIN.fees.itemsTotal('te')"` }))}
          ${field('Part Payment', select('te-part', [['0', 'Disabled'], ['1', 'Allowed']], t.partPayment ? '1' : '0'))}
          ${field('Show Invoice Breakdown to Students / Parents', select('te-show', [['1', 'Yes'], ['0', 'No']], t.showBreakdown ? '1' : '0'))}
          ${field('Auto-generate', select('te-auto', [['1', 'ON — generate for every eligible pupil'], ['0', 'OFF']], t.autoGenerate ? '1' : '0'))}
          ${field('Self-generate', select('te-self', [['0', 'OFF'], ['1', 'ON — parents / pupils can generate it']], t.selfGenerate ? '1' : '0'))}
        </div>
        <div class="fin-section-label">Fee Items</div>${itemsEditor('te', t.items, meta)}
        <div class="fin-section-label">For Class(es)</div><div id="te-classes" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px 12px">${classBoxes}</div>
        ${id && t.generatedCount ? '<div class="fin-note warn" style="margin-top:12px">Changes flow into the invoices from this template that have no payment yet. Invoices already being paid keep their amounts.</div>' : ''}`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, {
        label: id ? 'Save Template' : 'Publish Fees', cls: 'green', onClick: async (o, close) => {
          const classes = [...document.querySelectorAll('#te-classes input:checked')].map(i => { const [classCode, armId] = i.dataset.cls.split('|'); return { classCode, armId }; });
          const body = { title: val('te-title'), academicId: val('te-term'), invoiceType: val('te-type'), dueDate: val('te-due'), discount: val('te-discount'),
            partPayment: val('te-part') === '1', showBreakdown: val('te-show') === '1', autoGenerate: val('te-auto') === '1', selfGenerate: val('te-self') === '1', items: readItems('te'), classes };
          const r = id ? await FIN.put(`/api/admin/fees/templates/${id}`, body) : await FIN.post('/api/admin/fees/templates', body);
          showToast(`Template saved${r.generated ? ` — ${r.generated} invoice(s) generated` : ''}`);
          FIN.cache.feesMeta = null;
          close(); if (document.getElementById('tp-results')) tplLoad();
        },
      }],
    });
    itemsTotal('te');
  }

  // ══ Class Invoice History ══════════════════════════════════════════════
  FIN.page('classInvoiceHistory', async el => {
    const meta = await FIN.feesMeta();
    const s = F.cih;
    el.innerHTML = `${FIN.header('Class Invoice History')}
      ${card('<span><i class=fi-filter></i></span> Select Options to View List', `<div class="fin-grid">
        ${field('Fees Session', select('cih-session', FIN.sessionList(meta), s.session || FIN.activeTerm().sessionLabel), { required: true })}
        ${field('Fees Term', select('cih-term', [...FIN.termList(meta), ['all', 'All']], s.term || FIN.activeTerm().termLabel, 'Select Term'), { required: true })}
        ${field('Class', `<select class="ctrl-select" id="cih-class" onchange="document.getElementById('cih-arm').innerHTML=FIN.armOptions(this.value,'')">${options([['', 'Select Class'], ...FIN.classes().map(c => [c.code, c.label])], s.classCode || '')}</select>`, { required: true })}
        ${field('Class Arm', `<select class="ctrl-select" id="cih-arm">${FIN.armOptions(s.classCode || '', s.armId || '')}</select>`, { required: true })}
        ${field('For Invoice Type', select('cih-type', [['', 'All'], ['mandatory', 'Mandatory'], ['ondemand', 'On-demand'], ['other', 'Other']], s.type || ''), { required: true })}
        ${field('For Invoice(s)', `<span>${multi('cih-titles', meta.titles.map(t => [t, t]), s.titles)}</span>`, { required: true })}
        ${field('Student Account Status', select('cih-status', [['', 'All'], ['active', 'Active'], ['deactivated', 'Deactivated']], s.studentStatus || ''), { required: true })}
      </div><div style="text-align:center;margin-top:14px"><button class="fin-btn" onclick="FIN.fees.cihLoad()">Load List</button></div>`)}
      <div id="cih-results"></div>`;
    if (s.loaded) cihLoad();
  });
  async function cihLoad() {
    const s = F.cih;
    Object.assign(s, { session: val('cih-session'), term: val('cih-term'), classCode: val('cih-class'), armId: val('cih-arm'), type: val('cih-type'), titles: multiVal('cih-titles'), studentStatus: val('cih-status') });
    if (!s.classCode) return showToast('Select a class');
    if (!s.term) return showToast('Select the term');
    s.loaded = true;
    const data = await FIN.get(`/api/admin/fees/class-history${FIN.qs({ classCode: s.classCode, armId: s.armId, session: s.session, term: s.term, types: s.type ? [s.type] : [], titles: s.titles, studentStatus: s.studentStatus })}`);
    const box = document.getElementById('cih-results');
    box.innerHTML = `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title"><i class=fi-list></i> Fees Invoice History</div></div>
      <div class="fin-card-body" style="padding-bottom:0"><div class="fin-section-label" style="margin-top:0">Quick Links</div>
        <div class="fin-actions"><button class="fin-btn plain" onclick="FIN.goTab('studentTags')"><i class=fi-user></i> Assign / Manage Student Tags</button><button class="fin-btn plain" onclick="FIN.goTab('feeTemplates')"><i class=fi-doc></i> Manage & Publish Fees</button></div></div>
      <div id="cih-table"></div></div>`;
    table(document.getElementById('cih-table'), {
      title: `Class Invoice History | ${s.session} | ${s.term}`, rows: data.students, rowKey: 'studentId', perPage: 100,
      columns: [
        { key: '#', label: '#', sortable: false },
        { key: 'name', label: 'Student', render: r => `<div style="display:flex;gap:8px;align-items:center"><img src="${r.photoPath ? `/${esc(r.photoPath)}` : '/report_assets/student-placeholder.png'}" style="width:30px;height:30px;border-radius:50%;object-fit:cover"><div>${esc(r.name)}<div class="muted">${esc(r.regNo || r.studentId)}</div></div></div>`, exportValue: r => `${r.name} (${r.regNo || r.studentId})` },
        { key: 'tags', label: "Student's Tags in Fees Session & Term", render: r => r.tags.map(t => badge(t, 'blue')).join(' ') || '—', exportValue: r => r.tags.join(', ') },
        { key: 'sessionTerm', label: 'Fees Session & Term', render: r => `${esc(s.session)}<br>${esc(s.term === 'all' ? 'All Terms' : s.term)}`, exportValue: () => `${s.session} ${s.term}` },
        { key: 'classLabel', label: "Student's Class / Class Arm in Fees Session" },
        { key: 'mandatory', label: 'Mandatory Invoices', num: true, total: rows => rows.reduce((a, r) => a + r.mandatory, 0) },
        { key: 'ondemand', label: 'On-Demand Invoices', num: true, total: rows => rows.reduce((a, r) => a + r.ondemand, 0) },
        { key: 'totalInvoiced', label: 'Total Invoiced Amount', num: true, render: r => money(r.totalInvoiced), exportValue: r => r.totalInvoiced, total: true },
        { key: 'totalDiscount', label: 'Total Discount Amount', num: true, render: r => money(r.totalDiscount), exportValue: r => r.totalDiscount, total: true },
        { key: 'netTotal', label: 'Net Total Amount', num: true, render: r => money(r.netTotal), exportValue: r => r.netTotal, total: true },
        { key: 'paid', label: 'Paid Amount', num: true, render: r => `<span style="color:var(--green)">${money(r.paid)}</span>`, exportValue: r => r.paid, total: true },
        { key: 'due', label: 'Due Amount', num: true, render: r => `<span style="color:var(--red)">${money(r.due)}</span>`, exportValue: r => r.due, total: true },
        { key: 'v', label: 'View Invoices', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.fees.studentInvoices(${jsArg(r.studentId)}, ${jsArg(r.name)})"><i class=fi-search></i> View Invoices</button>` },
      ],
    });
  }
  FIN.goClassHistory = function ({ session, term, classCode }) {
    Object.assign(F.cih, { session, term, classCode, armId: '', loaded: true });
    FIN.goTab('classInvoiceHistory');
  };

  // invoices of one pupil or one family, with filters and cards
  async function studentInvoices(studentId, name, familyKey) {
    const meta = await FIN.feesMeta();
    const m = modal({
      title: `<i class=fi-doc></i> ${familyKey ? 'Family Fees Invoice List' : `Fees Invoice List — ${esc(name)}`}`, size: 'xwide',
      body: `<div class="fin-grid">
          ${field('Fees Session', select('fr-session', [['all', 'All'], ...FIN.sessionList(meta)], 'all'), { required: true })}
          ${field('Fees Term', select('fr-term', [['all', 'All'], ...FIN.termList(meta)], 'all'), { required: true })}
          ${field('Filter By Invoice Type', multi('fr-types', TYPES))}
          ${field('Filter By Payment Status', multi('fr-status', STATUSES))}
          <div><button class="fin-btn" onclick="FIN.fees.frLoad()"><i class=fi-filter></i> Apply Filter</button></div></div>
        <div id="fr-adm" style="text-align:right;margin:10px 0"></div><div id="fr-body"></div>`,
    });
    F.fr = { studentId, familyKey, close: m.close, name };
    frLoad();
  }
  async function frLoad() {
    const f = F.fr;
    const d = await FIN.get(`/api/admin/fees/history${FIN.qs({ studentId: f.studentId, familyKey: f.familyKey, session: val('fr-session') === 'all' ? '' : val('fr-session'), term: val('fr-term') === 'all' ? '' : val('fr-term'), types: multiVal('fr-types'), statuses: multiVal('fr-status') })}`);
    document.getElementById('fr-adm').innerHTML = FIN.menuButton('<i class=fi-doc></i> Admission Fees', d.admissions.map(a => ({ label: a.found ? `${a.name}: admission application ${a.status} (${FIN.plain(date(a.submittedAt))})` : `No admission application record found for ${a.name}`, onClick: () => {} })), 'outline sm');
    const sm = d.summary;
    document.getElementById('fr-body').innerHTML = stats([
      { label: 'Total in list', value: money(sm.total), icon: '₦', bg: 'var(--black-3)', color: 'var(--text-2)' },
      { label: 'Total Paid', value: money(sm.paid), pct: pct(sm.paid, sm.total), icon: '<i class=fi-check></i>', bg: 'var(--green-bg)', color: 'var(--green)', valueColor: 'var(--green)' },
      { label: 'Total Due', value: money(sm.due), pct: pct(sm.due, sm.total), icon: '!', bg: 'var(--red-bg)', color: 'var(--red)', valueColor: 'var(--red)' },
    ]) + '<div id="fr-table" class="fin-card"></div>';
    table(document.getElementById('fr-table'), {
      title: f.familyKey ? 'Family Fees Invoice List' : `Fees Invoice List — ${f.name}`, caption: f.familyKey ? '<i class=fi-doc></i> Family Fees Invoice List' : '', rows: d.invoices, perPage: 20,
      columns: [
        { key: '#', label: '#', sortable: false }, { key: 'studentName', label: 'Student' },
        { key: 'classLabel', label: 'Fee Class', render: r => `${esc(r.classLabel)}${r.armName ? ` - ${esc(r.armName)}` : ''}<div class="muted">(${esc(r.sessionLabel)} | ${esc(r.termLabel)})</div>` },
        { key: 'invoiceNo', label: 'Invoice ID' }, { key: 'fullTitle', label: 'Invoice Title' },
        { key: 'amount', label: 'Total', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
        { key: 'paid', label: 'Paid', num: true, render: r => money(r.paid), exportValue: r => r.paid, total: true },
        { key: 'balance', label: 'Due', num: true, render: r => money(r.balance), exportValue: r => r.balance, total: true },
        { key: 'status', label: 'Status', render: r => FIN.statusBadge(r.status) },
        { key: 'createdAt', label: 'Created', render: r => dateTime(r.createdAt), exportValue: r => FIN.plain(dateTime(r.createdAt)) },
        { key: 'c', label: 'Collection', noExport: true, sortable: false, render: r => (r.balance > 0 ? `<button class="fin-btn green sm" onclick="FIN.recordPayment(${r.id}, FIN.fees.frLoad)">Record Payment</button>` : '') },
        { key: 'a', label: 'Action', noExport: true, sortable: false, render: r => `<button class="fin-btn plain sm" onclick="FIN.fees.invoiceMenu(this, ${r.id}, FIN.fees.frLoad)"><i class=fi-dots></i></button>` },
      ],
    });
  }

  // ══ Family Fees History ════════════════════════════════════════════════
  FIN.page('familyFeesHistory', async el => {
    el.innerHTML = `${FIN.header('Dedicated Fees Wallets & Accounts')}
      <div class="fin-card">${FIN.tabs('ffh', [['families', '<i class=fi-users></i> Family Fees & Wallets'], ['wallets', '<i class=fi-briefcase></i> Fees Wallet List & Balances'], ['about', '<i class=fi-info></i> About Fees Wallets']], F.ffh.tab || 'families', k => { F.ffh.tab = k; ffhDraw(); })}
      <div class="fin-card-body" id="ffh-body"></div></div>`;
    ffhDraw();
  });
  async function ffhDraw() {
    const body = document.getElementById('ffh-body');
    const tab = F.ffh.tab || 'families';
    if (tab === 'about') {
      body.innerHTML = `<div class="fin-hero"><h3 style="font-size:18px;margin-bottom:8px"><i class=fi-bank></i> Family Fees Wallet & Account</h3>
          <p>Still dealing with the bursary nightmare of dozens of daily bank transfers — and struggling to answer:</p>
          <div style="margin:8px 0"><span class="chip">Who made which payment?</span><span class="chip">For which student?</span><span class="chip">For what purpose?</span><span class="chip">Is this bank statement entry a fee payment or something else?</span></div>
          <div style="border-left:3px solid #fff;padding:10px 14px;background:rgba(255,255,255,.1);margin-top:10px"><b>There's a better way.</b> Each family has its own fees wallet here. Money a family sends ahead of time (or overpays) is kept in its wallet, and you use it to pay any of the family's invoices in one click — every naira stays tied to the right family and child.</div></div>
        <div class="fin-section-label"><i class=fi-star></i> What you get</div>
        <div class="fin-grid">${[['One Wallet Per Family', 'Every family has its own wallet, so deposits are always attributed to the right family.'], ['Instant Invoice Settlement', 'Apply wallet money to any child\'s outstanding invoice — it is recorded as a fee payment straight away.'],
          ['Seamless Reconciliation', 'Wallet payments flow into Income and the payments log just like cash or bank payments.'], ['Full Payment History & Reports', 'Every deposit and every use of wallet money is logged with who, when and for which invoice.']]
          .map(([h, p]) => `<div class="fin-tile"><h4>${h}</h4><p>${p}</p></div>`).join('')}</div>
        <div class="fin-note warn" style="margin-top:14px">Dedicated bank account numbers per family (the SchoolsFocus "SchoolRemit" gateway feature) need a payment gateway; on this site deposits are recorded by the bursary.</div>`;
      return;
    }
    if (tab === 'wallets') {
      const d = await FIN.get('/api/admin/fees/wallets');
      body.innerHTML = `<div class="fin-grid" style="margin-bottom:10px">${field('Wallet Owner Type', select('ffw-type', [['all', 'All'], ['family', 'Family']], 'all'))}
        <div><label class="fin-check"><input type="checkbox" id="ffw-detail" onchange="FIN.fees.ffhDraw()" ${F.ffh.detail ? 'checked' : ''}> Wallet account details list view</label></div></div><div id="ffw-table"></div>`;
      F.ffh.detail = val('ffw-detail');
      table(document.getElementById('ffw-table'), {
        title: 'Fees Wallet List & Balances', rows: d.wallets, rowKey: 'key', perPage: 30,
        columns: [
          { key: '#', label: '#', sortable: false },
          { key: 'owner', label: 'Owner', render: r => `${esc(r.owner)}<div class="muted">${r.wards.map(w => esc(w.name)).join(', ')}</div>` },
          { key: 'balance', label: 'Bal', num: true, render: r => `<b>${money(r.balance)}</b>`, exportValue: r => r.balance, total: true },
          { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => `<button class="fin-btn green sm" onclick="FIN.fees.walletDeposit(${jsArg(r.key)})">Add Money</button> <button class="fin-btn outline sm" onclick="FIN.fees.walletApply(${jsArg(r.key)})">Pay an Invoice</button>` },
          { key: 'fees', label: 'Owner(s) Fees', render: r => (r.fees ? `Invoiced ${money(r.fees.invoiced)} · Due <span style="color:var(--red)">${money(r.fees.balance)}</span>` : '—') },
          ...(F.ffh.detail ? [{ key: 'txns', label: 'Wallet Transactions', render: r => r.txns.slice(0, 5).map(t => `${date(t.createdAt)} ${t.kind === 'deposit' ? '+' : '−'}${money(t.amount)} ${esc(t.method || '')}`).join('<br>') }] : []),
        ],
      });
      return;
    }
    const d = await FIN.get(`/api/admin/fees/families?type=${F.ffh.type || 'active'}`);
    F.ffh.list = d.families;
    body.innerHTML = `<div style="font-weight:700;margin-bottom:12px"><i class=fi-users></i> Families</div>
      <div class="fin-grid" style="max-width:480px;margin:0 auto 16px">${field('Filter : Family List Type', select('ffh-type', [['all', 'All families'], ['active', 'Families with active wards (at least one ward still active)'], ['some_left', 'Families with wards who have graduated or left (at least one ward graduated or left)'], ['all_left', 'Families with wards who have all graduated or left (No ward still active)'], ['none_left', 'Families with no wards graduated yet or left (All wards still active)']], F.ffh.type || 'active', null, 'onchange="FIN.fees.ffhType(this.value)"'))}</div>
      ${stats([{ label: 'Families', value: d.stats.families, icon: '<i class=fi-home></i>', bg: 'var(--black-3)', color: 'var(--text-2)' }, { label: 'With 1 Parent', value: d.stats.oneParent, icon: '<i class=fi-user></i>', bg: 'var(--amber-bg)', color: 'var(--amber)' },
        { label: 'With 2 Parents', value: d.stats.twoParents, icon: '<i class=fi-users></i>', bg: 'var(--green-bg)', color: 'var(--green)' }, { label: 'Total Parents', value: d.stats.parents, icon: '<i class=fi-users></i>', bg: 'var(--green-bg)', color: 'var(--green)' }])}
      <div id="ffh-table"></div>`;
    F.ffhTable = table(document.getElementById('ffh-table'), {
      title: 'Families', rows: d.families, rowKey: 'key', selectable: true, perPage: 10,
      toolbar: () => FIN.menuButton('Action on selected', [{ label: 'Deactivate Wards Accounts', onClick: () => ffhAction('deactivate_wards') }, { label: 'Activate Wards Accounts', onClick: () => ffhAction('activate_wards') }], 'outline sm')
        + `<button class="fin-btn plain sm" onclick="FIN.fees.ffhAdvanced()">Advanced Export</button>`,
      columns: [
        { key: '#', label: '#', sortable: false },
        { key: 'parents', label: 'Parents', sort: r => (r.parents[0] || {}).name, render: r => r.parents.map(p => `<div style="margin-bottom:4px">${esc(p.name)} ${p.relationship ? `<i class="muted">(${esc(p.relationship)})</i>` : ''}<div class="muted">${esc(p.phone || '')}${p.phone && p.email ? ' · ' : ''}${esc(p.email || '')}</div></div>`).join(''), exportValue: r => r.parents.map(p => `${p.name} ${p.phone || ''} ${p.email || ''}`).join('; ') },
        { key: 'wards', label: 'Wards', sort: r => r.wards.length, render: r => r.wards.map((w, i) => `<div>${i + 1}. ${esc(w.name)} <span class="muted">(${w.graduated ? 'Graduated' : `In ${esc(w.classLabel)}${w.armName ? ` - ${esc(w.armName)}` : ''}`})</span> ${badge(w.active ? 'Active' : 'Inactive', w.active ? 'blue' : 'amber')}</div>`).join('') + `<div style="margin-top:6px"><button class="fin-btn plain sm" onclick="FIN.goTab('families')">Manage Wards / Members</button> <button class="fin-btn plain sm" onclick="FIN.fees.ffhView(${jsArg(r.key)})">View Family</button></div>`, exportValue: r => r.wards.map(w => w.name).join('; ') },
        { key: 'fees', label: 'Family Fees', sortable: false, render: r => `<div class="muted">Due ${money(r.totals.balance)}${r.walletBalance ? ` · Wallet ${money(r.walletBalance)}` : ''}</div><button class="fin-btn plain sm" onclick="FIN.fees.studentInvoices('', 'Family', ${jsArg(r.key)})">Fees Records</button> <button class="fin-btn outline sm" onclick="FIN.fees.ffhWallet(${jsArg(r.key)})">Family Fees Account / Wallet</button>`, exportValue: r => `Invoiced ${r.totals.invoiced}; Paid ${r.totals.paid}; Due ${r.totals.balance}` },
      ],
    });
  }
  async function ffhAction(action) {
    const keys = F.ffhTable.picked();
    if (!keys.length) return showToast('Tick at least one family first');
    if (!await FIN.confirm(`${action === 'deactivate_wards' ? 'Deactivate' : 'Activate'} the wards' portal accounts of ${keys.length} family(ies)?`)) return;
    const r = await FIN.post('/api/admin/fees/families/action', { action, keys });
    showToast(`${r.count} ward account(s) ${action === 'deactivate_wards' ? 'deactivated' : 'activated'}`);
    ffhDraw();
  }
  function ffhAdvanced() {
    const rows = (F.ffh.list || []).flatMap(f => f.wards.map(w => [f.parents.map(p => p.name).join(' & '), f.parents.map(p => p.phone).filter(Boolean).join(', '), f.parents.map(p => p.email).filter(Boolean).join(', '), w.name, w.classLabel, w.active ? 'Active' : 'Inactive', f.totals.invoiced, f.totals.paid, f.totals.balance, f.walletBalance]));
    FIN.exportRows('xlsx', { title: 'Families advanced export', headers: ['Parents', 'Phone', 'Email', 'Ward', 'Class', 'Ward Status', 'Family Invoiced', 'Family Paid', 'Family Due', 'Wallet Balance'], rows });
  }
  function ffhView(key) {
    const f = F.ffh.list.find(x => x.key === key);
    modal({ title: 'Family', body: `<dl class="fin-kv">${f.parents.map(p => `<dt>${esc(p.relationship || 'Parent')}</dt><dd>${esc(p.name)}<div class="muted">${esc(p.phone || '')} ${esc(p.email || '')}</div></dd>`).join('')}
      ${f.wards.map((w, i) => `<dt>Ward ${i + 1}</dt><dd>${esc(w.name)} <span class="muted">${esc(w.classLabel)}</span></dd>`).join('')}
      <dt>Invoiced</dt><dd>${money(f.totals.invoiced)}</dd><dt>Paid</dt><dd>${money(f.totals.paid)}</dd><dt>Due</dt><dd style="color:var(--red)">${money(f.totals.balance)}</dd><dt>Wallet</dt><dd>${money(f.walletBalance)}</dd></dl>`, buttons: [{ label: 'Close', cls: 'plain' }] });
  }
  function ffhWallet(key) {
    const f = F.ffh.list.find(x => x.key === key);
    modal({
      title: '<i class=fi-briefcase></i> Family Fees Wallet & Account', size: 'wide',
      body: `<div class="fin-grid two"><div class="fin-tile"><i class="muted">Parents:</i>${f.parents.map(p => `<div style="margin-top:6px">${esc(p.name)} <i class="muted">(${esc(p.relationship || '')})</i><div class="muted">${esc(p.phone || '')}<br>${esc(p.email || '')}</div></div>`).join('')}</div>
        <div class="fin-tile"><div class="muted">Wallet balance</div><div class="fin-big">${money(f.walletBalance)}</div><div class="muted" style="margin-top:6px">Family fees due: <b style="color:var(--red)">${money(f.totals.balance)}</b></div></div></div>
        <div class="fin-tile" style="margin-top:12px"><i class="muted">Wards:</i> <button class="fin-btn plain sm" onclick="FIN.goTab('families')"><i class=fi-edit></i> Manage Wards</button>${f.wards.map((w, i) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">${i + 1}. <b>${esc(w.name)}</b> <span class="muted">(${w.graduated ? 'Graduated' : `In ${esc(w.classLabel)}`})</span></div>`).join('')}</div>`,
      buttons: [{ label: 'Add Money to Wallet', cls: 'green', onClick: (o, close) => { close(); walletDeposit(key); } }, { label: 'Pay an Invoice from Wallet', cls: 'outline', onClick: (o, close) => { close(); walletApply(key); } }, { label: 'Close', cls: 'plain' }],
    });
  }
  async function walletDeposit(key) {
    const meta = await FIN.feesMeta();
    modal({
      title: 'Add Money to Family Wallet',
      body: `<div class="fin-grid two">${field('Amount (₦)', FIN.input('wd-amount', { type: 'number', attrs: 'min="1"' }), { required: true })}${field('Method', select('wd-method', meta.methods.filter(x => x !== 'Wallet'), 'Bank Payment'))}
        ${field('Received Into', select('wd-account', meta.accounts.map(a => [a.id, a.label]), (meta.accounts.find(a => a.isDefault) || {}).id))}${field('Reference', FIN.input('wd-ref'))}${field('Note', FIN.input('wd-note'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Add Money', cls: 'green', onClick: async (o, close) => {
        await FIN.post('/api/admin/fees/wallets/deposit', { key, amount: val('wd-amount'), method: val('wd-method'), accountId: val('wd-account'), reference: val('wd-ref'), note: val('wd-note') });
        showToast('Money added to wallet'); close(); ffhDraw();
      } }],
    });
  }
  async function walletApply(key) {
    const d = await FIN.get(`/api/admin/fees/history?familyKey=${encodeURIComponent(key)}`);
    const open = d.invoices.filter(i => i.balance > 0);
    if (!open.length) return showToast('This family has nothing outstanding');
    modal({
      title: 'Pay an Invoice from the Family Wallet',
      body: `<div class="fin-grid two">${field('Invoice', select('wa-inv', open.map(i => [i.id, `${i.studentName} — ${i.title} (${i.termLabel}) · due ${FIN.plain(money(i.balance))}`])), { required: true, span: 2 })}
        ${field('Amount (₦)', FIN.input('wa-amount', { type: 'number', placeholder: 'Leave empty to pay as much as possible' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Pay from Wallet', cls: 'green', onClick: async (o, close) => {
        const r = await FIN.post('/api/admin/fees/wallets/apply', { key, invoiceId: val('wa-inv'), amount: val('wa-amount') });
        showToast(`${FIN.plain(money(r.applied))} paid from wallet`); close(); ffhDraw();
      } }],
    });
  }

  // ══ Payments logs: Review Payment Proofs / All Payment Attempts / Successful Payments / Verify ══
  function payLogPage(tab, { title, preset, successful }) {
    FIN.page(tab, async el => {
      const meta = await FIN.feesMeta();
      const r = FIN.quickRange('last_30');
      const st = F[tab] = F[tab] || { from: preset === 'proof_review' ? FIN.quickRange('last_90').from : r.from, to: r.to, status: preset || 'all', method: '' };
      el.innerHTML = `${FIN.header(title)}
        ${tab === 'reviewPaymentProofs' ? card('Log a Reported Payment', `<div class="fin-note" style="margin-bottom:10px">Parents upload proofs themselves from the pupil portal (Fees page). Use this when a parent brings or sends the proof to the school instead.</div>
            <div class="fin-grid">${field('Student', select('lp-student', FIN.students().map(s => [s.id, `${s.name} (${s.regNo || s.id})`]), '', 'Select Student', 'onchange="FIN.fees.lpInvoices()"'), { required: true })}
            ${field('Invoice', select('lp-invoice', [], '', 'Select Student First'), { required: true })}<div><button class="fin-btn outline" onclick="FIN.fees.lpOpen()">Upload Payment Proof</button></div></div>`) : ''}
        ${card(`<i class=fi-filter></i> ${successful ? 'Select Date Range of Report to View' : 'Select Date Range to View Online Payment Transactions Log'}`, `<div class="fin-grid">
          ${field(successful ? 'Fees Received Between' : 'Transactions Initiated Between', `<div style="display:flex;gap:6px;align-items:center"><input type="date" class="field-input" id="pl-from" value="${st.from}"> <span class="muted">TO</span> <input type="date" class="field-input" id="pl-to" value="${st.to}"></div>`, { required: true, span: 2 })}
          ${successful ? '' : field('Transaction Status', select('pl-status', [['all', 'All'], ['pending', 'Pending Payment Completion'], ['successful', 'Transaction Successful'], ['failed', 'Transaction Unsuccessful'], ['proof_review', 'Payment Proof Under Review'], ['proof_rejected', 'Payment Proof Rejected']], st.status))}
          ${field('Payment Channel', `<span>${multi('pl-method', meta.methods.map(x => [x, x]), st.method ? st.method.split(',') : null)}</span>`, { hint: successful ? '' : '(Leave as All for all Channels)' })}
          <div><button class="fin-btn" onclick="FIN.fees.plLoad('${tab}')"><i class=fi-search></i> ${successful ? 'View Report' : 'View Log'}</button></div></div>`)}
        <div id="pl-results"></div>`;
      if (tab === 'verifyPaymentStatus') verifyModal();
      plLoad(tab);
    });
  }
  async function plLoad(tab) {
    const st = F[tab];
    Object.assign(st, { from: val('pl-from'), to: val('pl-to'), status: tab === 'successfulPayments' ? 'successful' : (val('pl-status') || 'all'), method: multiVal('pl-method').join(',') });
    F.payLogRefresh = () => plLoad(tab);
    const d = await FIN.get(`/api/admin/fees/payments${FIN.qs({ from: st.from, to: st.to, status: st.status, method: st.method })}`);
    const successful = tab === 'successfulPayments';
    const box = document.getElementById('pl-results');
    box.innerHTML = `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title"><i class=fi-history></i> ${successful ? 'Received Fees Report' : 'Online Payment Transactions Log'} | ${date(st.from)} - ${date(st.to)}</div></div><div id="pl-table"></div>
      <div style="text-align:right;padding:0 18px 14px;font-weight:700">Total Successful : ${money(d.total)}</div></div>`;
    const cols = successful ? [
      { key: '#', label: '#', sortable: false },
      { key: 'recordedAt', label: 'Payment Date & Time', render: r => dateTime(r.paymentDate && r.paymentDate !== r.recordedAt.slice(0, 10) ? r.paymentDate : r.recordedAt), exportValue: r => FIN.plain(dateTime(r.recordedAt)) },
      { key: 'studentName', label: 'Payment for', render: r => `${esc(r.studentName)}<div class="muted">${esc(r.regNo || r.studentId)}</div>` },
      { key: 'classLabel', label: 'Class' }, { key: 'title', label: 'Invoice Title', render: r => `${esc(r.title)} | ${esc(r.termLabel || '')} | ${esc(r.sessionLabel || '')}` },
      { key: 'invoiceNo', label: 'Invoice Code' },
      { key: 'amount', label: 'Payment Amount', num: true, render: r => money(r.amount), exportValue: r => r.amount, total: true },
      { key: 'v', label: 'View Invoice', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.viewInvoice(${r.invoiceId})">View</button> <button class="fin-btn plain sm" onclick="FIN.fees.receipt(${r.id})">Receipt</button>` },
      { key: 'method', label: 'Payment Mode' }, { key: 'reviewedByName', label: 'Received / Confirmed By', render: r => esc(r.reviewedByName || r.recordedByName || '') },
      { key: 'txnCode', label: 'Transaction ID' }, { key: 'reference', label: 'Gateway Tx Reference', render: r => esc(r.reference || '—') },
      { key: 'glStatus', label: 'GL Status', render: r => badge(r.glStatus, r.glStatus === 'Posted' ? 'green' : 'grey') },
    ] : [
      { key: '#', label: '#', sortable: false },
      { key: 'txnCode', label: 'Transaction', render: r => `<span style="font-family:'DM Mono',monospace;font-size:11px">${esc(r.txnCode)}</span><div class="muted">${dateTime(r.recordedAt)}</div>`, exportValue: r => `${r.txnCode} ${FIN.plain(dateTime(r.recordedAt))}` },
      { key: 'initiatedBy', label: 'Initiated By', render: r => esc(r.kind === 'proof' ? (r.submittedBy === r.studentId ? `${r.studentName} (parent / pupil)` : r.recordedByName) : r.recordedByName || '') },
      { key: 'studentName', label: 'For', render: r => `${esc(r.studentName)}<div class="muted">${esc(r.classLabel)}</div>` },
      { key: 'title', label: 'Fees Title', render: r => `${esc(r.title)}<div class="muted">${esc(r.invoiceNo)}</div>` },
      { key: 'reference', label: 'Gateway Tx Ref No', render: r => esc(r.reference || '—') },
      { key: 'method', label: 'Payment Gateway / Channel', render: r => `${esc(r.method)}${r.attachmentPath ? `<div>${FIN.docLink(r.attachmentPath)}</div>` : ''}` },
      { key: 'amount', label: 'Transaction Amount', num: true, render: r => `${money(r.amount)}<div>${payBadge(r)}</div>`, exportValue: r => r.amount },
      { key: 'v', label: 'View Invoice', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.viewInvoice(${r.invoiceId})">View</button>${r.status === 'pending' ? `<div style="margin-top:4px"><button class="fin-btn green sm" onclick="FIN.fees.setPay(${r.id},'successful')">Approve</button> <button class="fin-btn red sm" onclick="FIN.fees.setPay(${r.id},'failed')">Reject</button></div>` : ''}` },
      { key: 'glStatus', label: 'GL Status', render: r => badge(r.glStatus, r.glStatus === 'Posted' ? 'green' : 'grey') },
    ];
    table(document.getElementById('pl-table'), { title: successful ? 'Received Fees Report' : 'Online Payment Transactions Log', rows: d.payments, perPage: 100, columns: cols, exportFormats: ['xlsx', 'doc', 'csv', 'xls'] });
  }
  async function lpInvoices() {
    const id = val('lp-student');
    const sel = document.getElementById('lp-invoice');
    if (!id) { sel.innerHTML = '<option value="">Select Student First</option>'; return; }
    const d = await FIN.get(`/api/admin/fees/invoices?studentId=${encodeURIComponent(id)}`);
    const open = d.invoices.filter(i => i.balance > 0);
    sel.innerHTML = open.length ? open.map(i => `<option value="${i.id}">${esc(i.title)} (${esc(i.termLabel)} ${esc(i.sessionLabel)}) — due ${esc(FIN.plain(money(i.balance)))}</option>`).join('') : '<option value="">No outstanding invoices</option>';
  }
  function lpOpen() { const id = val('lp-invoice'); if (!id) return showToast('Select an invoice'); FIN.recordPayment(id, () => plLoad('reviewPaymentProofs'), true); }
  function verifyModal() {
    modal({
      title: 'Verify Payment',
      body: `${field('Payment Method', select('vp-method', [['Bank Payment', 'Bank Payment'], ['Bank Transfer', 'Bank Transfer'], ['POS / Card', 'POS / Card'], ['Cash', 'Cash'], ['Wallet', 'Wallet']], '', 'Select Payment Method'), { required: true })}
        <div style="height:12px"></div>${field('Payment / Transaction Reference', FIN.input('vp-ref', { placeholder: 'Reference, teller number or Txn ID (e.g. TXN0000012)' }), { required: true })}<div id="vp-out" style="margin-top:12px"></div>`,
      buttons: [{ label: 'Verify Transaction', onClick: async () => {
        if (!val('vp-method')) return showToast('Select a payment method'), false;
        const d = await FIN.post('/api/admin/fees/verify', { reference: val('vp-ref') });
        const out = document.getElementById('vp-out');
        out.innerHTML = d.payments.length ? d.payments.map(p => `<div class="fin-tile" style="margin-bottom:8px"><b>${esc(p.studentName)}</b> — ${esc(p.title)} (${esc(p.invoiceNo)})<br>${money(p.amount)} · ${esc(p.method)} · ${date(p.paymentDate || p.recordedAt)}<br>${payBadge(p)}
            ${p.status !== 'successful' ? `<div style="margin-top:6px"><button class="fin-btn green sm" onclick="FIN.fees.setPay(${p.id},'successful'); this.closest('.fin-tile').innerHTML='Confirmed'">Confirm Payment</button></div>` : ''}</div>`).join('')
          : '<div class="fin-note warn">No payment with this reference has been recorded or submitted. If the money is in the school account, record it from the invoice with <b>Record Payment</b>.</div>';
        return false;
      } }],
    });
  }
  payLogPage('reviewPaymentProofs', { title: 'Online Payment Transactions Log', preset: 'proof_review' });
  payLogPage('allPaymentAttempts', { title: 'Online Payment Transactions Log', preset: 'all' });
  payLogPage('successfulPayments', { title: 'Received Fees Report', successful: true });
  payLogPage('verifyPaymentStatus', { title: 'Online Payment Transactions Log', preset: 'all' });

  // ══ Fees Debtors ═══════════════════════════════════════════════════════
  FIN.page('feesDebtors', async el => {
    const meta = await FIN.feesMeta();
    const s = F.deb;
    el.innerHTML = `${FIN.header('Fees Debtors')}
      ${card('<i class=fi-list></i> Debtors List', `<div class="fin-section-label" style="margin-top:0"><i class=fi-filter></i> Select Options to View Debtors List</div><div class="fin-grid">
        ${field('Fees Session', select('fd-session', [['all', 'All'], ...FIN.sessionList(meta)], s.session || FIN.activeTerm().sessionLabel), { required: true })}
        ${field('Fees Term', select('fd-term', [...FIN.termList(meta), ['all', 'All']], s.term || FIN.activeTerm().termLabel, 'Select Term'), { required: true })}
        ${field('Class', `<select class="ctrl-select" id="fd-class" onchange="document.getElementById('fd-arm').innerHTML=FIN.armOptions(this.value,'')">${options([['', 'All Classes'], ...FIN.classes().map(c => [c.code, c.label])], s.classCode || '')}</select>`, { required: true })}
        ${field('Class Arm', `<select class="ctrl-select" id="fd-arm">${FIN.armOptions(s.classCode || '', s.armId || '')}</select>`, { required: true })}
        ${field('For Invoice Type', multi('fd-types', TYPES.map(([v, l]) => [v, l.split(' (')[0]]), s.types), { required: true })}
        ${field('For Invoice(s)', multi('fd-titles', meta.titles.map(t => [t, t]), s.titles), { required: true })}
        ${field('Student Account Status', select('fd-status', [['', 'All'], ['active', 'Active'], ['deactivated', 'Deactivated']], s.studentStatus || ''), { required: true })}
        <div><button class="fin-btn" onclick="FIN.fees.fdLoad()"><i class=fi-search></i> Load Debtors List</button></div></div>`)}
      <div id="fd-results"></div>`;
    if (s.loaded) fdLoad();
  });
  async function fdLoad() {
    const s = F.deb;
    Object.assign(s, { session: val('fd-session'), term: val('fd-term'), classCode: val('fd-class'), armId: val('fd-arm'), types: multiVal('fd-types'), titles: multiVal('fd-titles'), studentStatus: val('fd-status'), loaded: true });
    if (!s.term) return showToast('Select the term');
    const d = await FIN.get(`/api/admin/fees/debtors${FIN.qs({ session: s.session === 'all' ? '' : s.session, term: s.term === 'all' ? '' : s.term, classCode: s.classCode, armId: s.armId, types: s.types, titles: s.titles, studentStatus: s.studentStatus })}`);
    const meta = await FIN.feesMeta();
    document.getElementById('fd-results').innerHTML = `<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title"><i class=fi-list></i> Students Unpaid Fees List</div>
      <div class="fin-actions">${meta.smtp ? '' : '<span class="fin-badge amber">E-mail is not set up — reminders cannot be sent</span>'}<button class="fin-btn outline sm" onclick="FIN.fees.remind(FIN.tablePicked('fd-table'))"><i class=fi-bell></i> Send Reminder to Selected</button></div></div><div id="fd-table"></div></div>`;
    table(document.getElementById('fd-table'), {
      title: 'Students Unpaid Fees List', rows: d.debtors, rowKey: 'studentId', selectable: true, perPage: 100,
      columns: [
        { key: '#', label: '#', sortable: false }, { key: 'name', label: 'Name' }, { key: 'regNo', label: 'Reg No.', render: r => esc(r.regNo || r.studentId) },
        { key: 'classLabel', label: 'Current Class' },
        { key: 'unpaid', label: 'Total Unpaid Amount', num: true, render: r => money(r.unpaid), exportValue: r => r.unpaid, total: true },
        { key: 'overdue', label: 'Overdue', num: true, render: r => `<b style="color:var(--red)">${money(r.overdue)}</b>`, exportValue: r => r.overdue, total: true },
        { key: 'v', label: 'View Invoices', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.fees.studentInvoices(${jsArg(r.studentId)}, ${jsArg(r.name)})"><i class=fi-doc></i> Fees Invoice History</button>` },
        { key: 'reminder', label: 'Reminder', sortable: false, render: r => `<button class="fin-btn plain sm" ${r.parentEmail ? '' : 'disabled title="No parent e-mail on file"'} onclick="FIN.fees.remind([${jsArg(r.studentId)}])"><i class=fi-bell></i> Send</button>${r.lastReminder ? `<div class="muted">${r.lastReminder.status === 'sent' ? 'Sent' : FIN.cap(r.lastReminder.status)} ${date(r.lastReminder.sentAt)}</div>` : ''}`, exportValue: r => (r.lastReminder ? `${r.lastReminder.status} ${r.lastReminder.sentAt}` : '') },
      ],
    });
  }
  async function remind(ids) {
    if (!ids.length) return showToast('Tick at least one pupil first');
    if (!await FIN.confirm(`Send a fees reminder e-mail to the parents of ${ids.length} pupil(s)?`)) return;
    const r = await FIN.post('/api/admin/fees/reminders', { studentIds: ids });
    const failed = r.results.filter(x => x.status !== 'sent');
    showToast(`${r.sent} reminder(s) sent${failed.length ? `, ${failed.length} not sent: ${failed[0].error}` : ''}`, failed.length && !r.sent ? 'error' : '');
    fdLoad();
  }

  // term setup → fees shortcuts
  FIN.viewInvoice = (id, after) => viewInvoice(id, after);
  FIN.fees = { multiOpen, ilView, toggleHidden, invoiceMenu, setPay, receipt, addItem, itemsTotal, tplLoad, tplToggle, tplGenerate, tplDelete, tplInvoices, tplView, tplEdit,
    cihLoad, studentInvoices, frLoad, ffhDraw, ffhType: t => { F.ffh.type = t; ffhDraw(); }, ffhAdvanced, ffhView, ffhWallet, walletDeposit, walletApply, plLoad, lpInvoices, lpOpen, fdLoad, remind };
})();
