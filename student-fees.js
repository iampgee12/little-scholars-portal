// Pupil portal › School Fees: the pupil's invoices (balance, items, payments),
// printable invoice with the school's bank details, "I have paid" upload of a
// payment proof for the bursary to review, and class fees the school lets
// pupils generate for themselves.
(function () {
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const money = n => `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const STATUS = { paid: ['Paid', 'var(--green)', 'var(--green-bg)'], partial: ['Part Paid', 'var(--amber)', 'var(--amber-bg)'], unpaid: ['Unpaid', 'var(--red)', 'var(--red-bg)'],
    successful: ['Successful', 'var(--green)', 'var(--green-bg)'], pending: ['Under Review', 'var(--amber)', 'var(--amber-bg)'], failed: ['Rejected', 'var(--red)', 'var(--red-bg)'], rejected: ['Rejected', 'var(--red)', 'var(--red-bg)'] };
  const pill = s => { const [l, c, b] = STATUS[s] || [s, 'var(--text-2)', 'var(--black-3)']; return `<span class="sf-pill" style="color:${c};background:${b}">${esc(l)}</span>`; };
  let data = null;

  document.head.insertAdjacentHTML('beforeend', `<style>
    .sf-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:16px; }
    .sf-stat { background:var(--black-2); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; }
    .sf-stat .v { font-size:18px; font-weight:700; font-family:'DM Mono',monospace; }
    .sf-stat .l { font-size:11px; color:var(--text-3); margin-top:2px; }
    .sf-pill { display:inline-block; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:600; }
    .sf-btn { border:1px solid var(--border-2); background:var(--black); color:var(--text-1); border-radius:var(--radius-sm); padding:6px 11px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; }
    .sf-btn.primary { background:#0d6efd; border-color:#0d6efd; color:#fff; }
    .sf-btn:hover { opacity:.85; }
    .sf-table-wrap { overflow-x:auto; }
    .sf-overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:1000; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto; }
    .sf-modal { background:var(--black); border-radius:var(--radius); width:100%; max-width:560px; box-shadow:0 20px 50px rgba(0,0,0,.2); }
    .sf-modal.wide { max-width:780px; }
    .sf-modal-head { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--border); font-weight:700; font-size:14px; }
    .sf-modal-body { padding:16px 18px; }
    .sf-modal-foot { padding:12px 18px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; }
    .sf-field { margin-bottom:12px; } .sf-field label { display:block; font-size:11px; font-weight:600; color:var(--text-2); margin-bottom:4px; }
    .sf-field input, .sf-field select, .sf-field textarea { width:100%; padding:8px 10px; border:1px solid var(--border-2); border-radius:var(--radius-sm); font-family:inherit; font-size:12px; background:var(--black); color:var(--text-1); box-sizing:border-box; }
    .sf-note { background:var(--blue-bg); border:1px solid rgba(37,99,235,.2); border-radius:var(--radius-sm); padding:10px 12px; font-size:12px; color:var(--text-2); margin-bottom:12px; }
  </style>`);

  function modal(title, body, buttons = [], wide) {
    const ov = document.createElement('div');
    ov.className = 'sf-overlay';
    ov.innerHTML = `<div class="sf-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="sf-modal-head"><span>${title}</span><button class="sf-btn" aria-label="Close">✕</button></div><div class="sf-modal-body">${body}</div>${buttons.length ? '<div class="sf-modal-foot"></div>' : ''}</div>`;
    const close = () => ov.remove();
    ov.querySelector('.sf-modal-head .sf-btn').onclick = close;
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = `sf-btn ${b.primary ? 'primary' : ''}`;
      btn.textContent = b.label;
      btn.onclick = async () => { if (!b.onClick) return close(); btn.disabled = true; try { await b.onClick(close); } catch (err) { showToast(err.message); } finally { btn.disabled = false; } };
      ov.querySelector('.sf-modal-foot').appendChild(btn);
    });
    document.body.appendChild(ov);
    return ov;
  }

  async function load() {
    const box = document.getElementById('fees-body');
    try { data = await apiFetch('/api/student/fees'); } catch (err) { box.innerHTML = `<div class="sf-note">${esc(err.message)}</div>`; return; }
    const s = data.summary;
    const pendingProofs = data.payments.filter(p => p.status === 'pending');
    box.innerHTML = `<div class="sf-stats">
        <div class="sf-stat"><div class="v">${money(s.total)}</div><div class="l">Total Billed</div></div>
        <div class="sf-stat"><div class="v" style="color:var(--green)">${money(s.paid)}</div><div class="l">Total Paid</div></div>
        <div class="sf-stat"><div class="v" style="color:var(--red)">${money(s.due)}</div><div class="l">Outstanding Balance</div></div>
        <div class="sf-stat"><div class="v" style="color:var(--amber)">${pendingProofs.length}</div><div class="l">Payment Proofs Under Review</div></div></div>
      ${data.selfTemplates.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><span class="card-title">Fees available to generate</span></div><div class="card-body">
        <p style="font-size:12px;color:var(--text-2);margin-bottom:10px">The school has published these fees for your class. Generate the invoice to see it below and pay.</p>
        ${data.selfTemplates.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><div><b style="font-size:12px">${esc(t.title)}</b><div style="font-size:11px;color:var(--text-3)">${esc(t.termLabel || '')} ${esc(t.sessionLabel || '')} · ${money(t.total)}</div></div><button class="sf-btn primary" onclick="StudentFees.generate(${t.id})">Generate Invoice</button></div>`).join('')}</div></div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="card-head"><span class="card-title">My Invoices</span></div><div class="sf-table-wrap"><table class="results-table">
        <thead><tr><th>Invoice</th><th>Session / Term</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due Date</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.invoices.map(i => `<tr><td><b>${esc(i.title)}</b><div style="font-size:10px;color:var(--text-3)">${esc(i.invoiceNo || '')}</div></td><td>${esc(i.sessionLabel || '')}<div style="font-size:10px;color:var(--text-3)">${esc(i.termLabel || '')}</div></td>
          <td>${money(i.amount)}</td><td style="color:var(--green)">${money(i.paid)}</td><td style="color:${i.balance > 0 ? 'var(--red)' : 'inherit'}">${money(i.balance)}</td><td>${fmtDate(i.dueDate)}${i.overdue ? '<div style="font-size:10px;color:var(--red)">Overdue</div>' : ''}</td><td>${pill(i.status)}</td>
          <td style="white-space:nowrap"><button class="sf-btn" onclick="StudentFees.view(${i.id})">View</button>${i.balance > 0 ? ` <button class="sf-btn primary" onclick="StudentFees.proof(${i.id})">I Have Paid</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:24px">No invoices yet.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-head"><span class="card-title">Payment History</span></div><div class="sf-table-wrap"><table class="results-table">
        <thead><tr><th>Date</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead>
        <tbody>${data.payments.map(p => `<tr><td>${fmtDate(p.paymentDate || p.recordedAt)}</td><td>${esc(p.title)}<div style="font-size:10px;color:var(--text-3)">${esc(p.invoiceNo || '')}</div></td><td>${money(p.amount)}</td><td>${esc(p.method || '')}</td><td>${esc(p.reference || '—')}</td><td>${pill(p.status)}${p.status === 'failed' && p.note ? `<div style="font-size:10px;color:var(--text-3)">${esc(p.note)}</div>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:24px">No payments yet.</td></tr>'}</tbody></table></div></div>`;
  }

  function invoiceHtml(i) {
    const sch = data.school || {};
    const pays = data.payments.filter(p => p.invoiceId === i.id && p.status === 'successful');
    return `<div style="text-align:center;margin-bottom:10px"><img src="/report_assets/school-logo.png" onerror="this.remove()" style="height:52px"><div style="font-weight:800;font-size:15px">${esc(sch.name || '')}</div><div style="font-size:11px;color:#64748b">${esc(sch.address || '')}</div></div>
      <h3 style="text-align:center;margin:6px 0 12px">INVOICE ${esc(i.invoiceNo || '')}</h3>
      <table style="width:100%;font-size:12px;margin-bottom:10px"><tr><td><b>Pupil:</b> ${esc(i.studentName)} (${esc(i.regNo || i.studentId)})</td><td style="text-align:right"><b>Class:</b> ${esc(i.classLabel || '')} ${esc(i.armName || '')}</td></tr>
        <tr><td><b>Fee:</b> ${esc(i.fullTitle)}</td><td style="text-align:right"><b>Due:</b> ${fmtDate(i.dueDate)}</td></tr></table>
      <table class="results-table" style="border:1px solid var(--border)"><thead><tr><th>Item</th><th style="text-align:right">Amount</th></tr></thead><tbody>
        ${(i.items.length ? i.items : [{ name: i.title, amount: i.subtotal }]).map(it => `<tr><td>${esc(it.name)}</td><td style="text-align:right">${money(it.amount)}</td></tr>`).join('')}
        ${i.discount ? `<tr><td>Discount</td><td style="text-align:right">-${money(i.discount)}</td></tr>` : ''}
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(i.amount)}</b></td></tr><tr><td>Paid</td><td style="text-align:right">${money(i.paid)}</td></tr><tr><td><b>Balance</b></td><td style="text-align:right"><b>${money(i.balance)}</b></td></tr></tbody></table>
      ${pays.length ? `<p style="font-size:11px;margin-top:10px"><b>Payments:</b> ${pays.map(p => `${fmtDate(p.paymentDate)} — ${money(p.amount)} (${esc(p.method || '')})`).join('; ')}</p>` : ''}
      ${data.banks.length ? `<div style="margin-top:12px;font-size:12px"><b>Pay into:</b>${data.banks.map(b => `<div>${esc(b.bankName || '')} — ${esc(b.accountNumber)} — ${esc(b.accountName || b.name)}</div>`).join('')}</div>` : ''}
      <p style="font-size:11px;color:#64748b;margin-top:10px">${i.partPayment ? 'Part payment is allowed on this invoice.' : 'Please pay the full balance.'}</p>`;
  }

  function view(id) {
    const i = data.invoices.find(x => x.id === id);
    modal(esc(i.title), invoiceHtml(i), [{ label: '🖶 Print', onClick: () => printInvoice(i) }, ...(i.balance > 0 ? [{ label: 'I Have Paid', primary: true, onClick: close => { close(); proof(id); } }] : [])], true);
  }
  function printInvoice(i) {
    const w = window.open('', '_blank', 'width=900,height=750');
    if (!w) return showToast('Allow pop-ups to print');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.invoiceNo || 'Invoice')}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}.results-table{width:100%;border-collapse:collapse}.results-table th,.results-table td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}</style></head><body>${invoiceHtml(i)}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  }

  function proof(id) {
    const i = data.invoices.find(x => x.id === id);
    const pending = data.payments.filter(p => p.invoiceId === id && p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    const left = Math.max(0, i.balance - pending);
    if (!left) return showToast('Your payment proof for this invoice is already under review');
    modal('Upload Payment Proof', `<div class="sf-note">Paid by bank transfer or at the bank? Send the receipt here. The bursary will check it and your invoice will be updated once it is approved.${pending ? `<br><b>${money(pending)}</b> is already under review.` : ''}</div>
      ${data.banks.length ? `<div class="sf-note" style="background:var(--black-3);border-color:var(--border)"><b>School account(s):</b>${data.banks.map(b => `<div>${esc(b.bankName || '')} — ${esc(b.accountNumber)} — ${esc(b.accountName || b.name)}</div>`).join('')}</div>` : ''}
      <div class="sf-field"><label>Amount Paid (₦) *</label><input type="number" id="sf-amt" min="1" step="0.01" value="${left}" ${i.partPayment ? '' : 'readonly'}></div>
      <div class="sf-field"><label>Date Paid *</label><input type="date" id="sf-date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="sf-field"><label>Payment Method</label><select id="sf-method">${data.methods.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="sf-field"><label>Transaction Reference / Teller No</label><input id="sf-ref"></div>
      <div class="sf-field"><label>Receipt / Proof (PDF or image, max 5MB) *</label><input type="file" id="sf-file" accept=".pdf,.png,.jpg,.jpeg"></div>
      <div class="sf-field"><label>Note (optional)</label><textarea id="sf-note" rows="2"></textarea></div>`,
    [{ label: 'Cancel' }, { label: 'Submit Proof', primary: true, onClick: async close => {
      const f = document.getElementById('sf-file').files[0];
      if (!f) throw new Error('Attach the payment receipt or proof');
      if (f.size > 5 * 1024 * 1024) throw new Error('The file is larger than 5MB');
      const attachment = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
      await apiFetch(`/api/student/fees/invoices/${id}/proof`, { method: 'POST', body: JSON.stringify({ amount: document.getElementById('sf-amt').value, paymentDate: document.getElementById('sf-date').value, method: document.getElementById('sf-method').value, reference: document.getElementById('sf-ref').value, note: document.getElementById('sf-note').value, attachment }) });
      showToast('Payment proof sent — the bursary will review it'); close(); load();
    } }]);
  }

  async function generate(id) {
    const ok = window.uiConfirm ? await uiConfirm('Generate this invoice for yourself?') : confirm('Generate this invoice for yourself?');
    if (!ok) return;
    try { await apiFetch(`/api/student/fees/templates/${id}/generate`, { method: 'POST', body: '{}' }); showToast('Invoice created'); load(); } catch (err) { showToast(err.message); }
  }

  window.StudentFees = { load, view, proof, generate };
  TAB_META.fees = { title: 'School Fees', sub: 'Invoices & payments' };
  const baseSwitch = window.switchTab;
  window.switchTab = function (tab, trigger) { baseSwitch(tab, trigger); if (tab === 'fees') load(); };
})();
