// Admin portal extras for Finance, and the Accountant / Bursary Officer view.
//
// For everyone in the admin portal:
//   - a count badge on "Review Payment Proofs" while proofs are waiting;
//   - the sidebar search also finds a pupil by name or Reg. No. and opens their fees.
//
// For an accountant / bursary officer (session user scope 'finance'):
//   - Academics, E-Class, Results (with CBT), Attendance and Admin are hidden;
//   - People can be looked at but not changed (no add / edit / delete controls);
//   - the Dashboard is a finance home page; a "Bursary" label sits by their name.
// The server enforces the same limits (finance-access.js); hiding is for a clean screen.
(function () {
  const HIDDEN_SECTIONS = ['academics', 'eclass', 'results', 'attendance', 'admin', 'admission'];
  const HIDDEN_PEOPLE_TABS = ['addStudent', 'pupilPhotos', 'studentTags', 'communicationBook', 'extracurricularGroups', 'classAllocation', 'selfRegistration'];
  const PEOPLE_TABS = ['students', 'studentsRegistry', 'enrollmentHistory', 'parents', 'families', 'staff', 'studentProfile', 'staffProfile'];
  // buttons and links that change People records
  const EDITING = /^(\+|create|add\b|edit|update|delete|remove|deactivate|activate|archive|restore|reset|bulk import|import|self registration|staff designations|manage wards|sync|promote|move|upload|assign|change|save|mark|reinstate|graduate|on$|off$|generate|regenerate|unlink|link\b|convert|enrol|action on selected)/i;
  let financeView = false;

  const css = document.createElement('style');
  css.textContent = `
    body.scope-finance .rail-item[data-section="${HIDDEN_SECTIONS.join('"], body.scope-finance .rail-item[data-section="')}"],
    body.scope-finance .sub-menu[data-menu="${HIDDEN_SECTIONS.join('"], body.scope-finance .sub-menu[data-menu="')}"],
    body.scope-finance .sub-nav-item[data-tab="${HIDDEN_PEOPLE_TABS.join('"], body.scope-finance .sub-nav-item[data-tab="')}"],
    body.scope-finance .fin-readonly-hide { display:none !important; }
    .scope-label { display:inline-block; margin-left:6px; font-size:9px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:var(--green); background:var(--green-bg); border:1px solid rgba(22,163,74,.25); border-radius:20px; padding:1px 7px; vertical-align:1px; }
    .proof-badge { display:inline-block; min-width:16px; margin-left:6px; padding:0 5px; border-radius:10px; background:var(--green); color:#fff; font-size:9px; font-weight:700; line-height:16px; text-align:center; }
    .fh-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-bottom:16px; }
    .fh-tile { background:var(--black-2); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; text-align:left; cursor:pointer; font-family:'DM Sans',sans-serif; transition:border-color .15s ease, transform .15s ease; }
    .fh-tile:hover { border-color:var(--border-2); transform:translateY(-1px); }
    .fh-tile .v { font-size:20px; font-weight:700; font-family:'DM Mono',monospace; letter-spacing:-.5px; color:var(--text-1); }
    .fh-tile .l { font-size:10px; color:var(--text-3); text-transform:uppercase; letter-spacing:.5px; margin-top:4px; font-weight:600; }
    .fh-tile .s { font-size:11px; color:var(--text-2); margin-top:6px; display:flex; align-items:center; gap:6px; }
    .fh-tile.alert .v { color:var(--amber); }
  `;
  document.head.appendChild(css);

  // state is a top-level let in admin-api.js, so it is reached by name, not through window
  const appState = () => (typeof state !== 'undefined' ? state : null);
  const me = () => (appState() && appState().user) || null;
  const esc = v => escapeHtml(v == null ? '' : String(v));
  const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const icon = name => `<i class="fi fi-${name}" aria-hidden="true"></i>`;

  // ── Finance home (replaces the academic dashboard for accountants) ──────
  async function renderHome() {
    const panel = document.getElementById('tab-dashboard');
    if (!panel) return;
    [...panel.children].forEach(c => { if (c.id !== 'fin-home') c.style.display = 'none'; });
    let box = document.getElementById('fin-home');
    if (!box) { box = document.createElement('div'); box.id = 'fin-home'; panel.prepend(box); }
    let d;
    try { d = await apiFetch('/api/admin/finance/home'); } catch (err) { box.innerHTML = `<div class="fin-note red">${esc(err.message)}</div>`; return; }
    const first = (me() && me().firstName) || '';
    const tile = (tab, value, label, sub, ic, alert) => `<button type="button" class="fh-tile${alert ? ' alert' : ''}" onclick="FIN.goTab('${tab}')"><div class="v">${value}</div><div class="l">${esc(label)}</div><div class="s">${icon(ic)} ${esc(sub)}</div></button>`;
    box.innerHTML = `<div class="page-header"><h2>${esc(first ? `Welcome, ${first}` : 'Finance')}</h2><p>${d.academic ? `${esc(d.academic.sessionLabel)} · ${esc(d.academic.termLabel)} · ` : ''}${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="fh-grid">
        ${tile('successfulPayments', naira(d.collectedToday), 'Fees collected today', `${d.paymentsToday} payment(s)`, 'wallet')}
        ${tile('feesDebtors', naira(d.termOutstanding), 'Outstanding this term', `${naira(d.termPaid)} paid of ${naira(d.termBilled)}`, 'warn')}
        ${tile('reviewPaymentProofs', d.pendingProofs, 'Payment proofs to review', d.pendingProofs ? 'Waiting for you' : 'All reviewed', 'doc', d.pendingProofs > 0)}
        ${tile('expenseRequests', d.pendingExpenseRequests, 'Expense requests to approve', `${d.approvedToDispense} approved, not yet paid out`, 'check', d.pendingExpenseRequests > 0)}
        ${tile('income', naira(d.incomeThisMonth), 'Income this month', 'All income records', 'trend-up')}
        ${tile('expenses', naira(d.expensesThisMonth), 'Expenses this month', 'All expense records', 'trend-down')}
        ${tile('inventoryReports', d.lowStock, 'Store items low on stock', d.lowStock ? 'Re-order soon' : 'Stock levels fine', 'bag', d.lowStock > 0)}
        ${tile('invoiceList', d.termInvoices, 'Fee invoices this term', 'Open the invoice list', 'list')}
      </div>
      <div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">${icon('history')} Latest fee payments</div><button class="fin-btn plain sm" onclick="FIN.goTab('successfulPayments')">View all</button></div>
        <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Date</th><th>Pupil</th><th>Fee</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>
        ${d.recentPayments.map(p => `<tr><td>${esc(FIN.date(p.date))}</td><td><a href="javascript:void(0)" onclick="spfOpen(${esc(JSON.stringify(p.studentId))}, 'fees')">${esc(p.studentName)}</a></td><td>${esc(p.title)}</td><td>${esc(p.method || '')}</td><td class="num">${naira(p.amount)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="fin-empty">No fee payments yet.</td></tr>'}</tbody></table></div></div>`;
  }

  // ── Payment-proof badge (everyone) ──────────────────────────────────────
  async function refreshBadge() {
    const item = document.querySelector('.sub-nav-item[data-tab="reviewPaymentProofs"]');
    if (!item || !me()) return;
    let n = 0;
    try { n = (await apiFetch('/api/admin/finance/home')).pendingProofs || 0; } catch { return; }
    let badge = item.querySelector('.proof-badge');
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'proof-badge'; item.appendChild(badge); }
    badge.textContent = n > 99 ? '99+' : n;
    badge.title = `${n} payment proof(s) waiting for review`;
  }

  // ── Read-only People ────────────────────────────────────────────────────
  function activeTab() { return document.querySelector('.tab-panel.active')?.id.replace(/^tab-/, '') || ''; }
  function hideEditing(root) {
    if (!financeView || !PEOPLE_TABS.includes(activeTab())) return;
    root.querySelectorAll('button, a, .fin-switch, [role="menuitem"], label.switch, .toggle, input[type="checkbox"][onchange*="active" i]').forEach(el => {
      if (el.closest('.sidebar, aside, .topbar, .rail')) return;
      const text = (el.innerText || el.value || el.title || '').replace(/^[^A-Za-z+]+/, '').trim().replace(/\s+/g, ' ');
      if (text && EDITING.test(text)) el.classList.add('fin-readonly-hide');
    });
  }
  const observer = new MutationObserver(muts => {
    if (!financeView) return;
    muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) hideEditing(n.parentElement || n); }));
  });

  // ── Apply once the signed-in user is known ──────────────────────────────
  function blockedTabs() {
    const tabs = new Set(HIDDEN_PEOPLE_TABS);
    HIDDEN_SECTIONS.forEach(s => document.querySelectorAll(`.sub-menu[data-menu="${s}"] [data-tab]`).forEach(el => tabs.add(el.dataset.tab)));
    // a page a visible menu also links to stays open (Admissions links to Students too)
    document.querySelectorAll('.sub-menu[data-menu] [data-tab]').forEach(el => {
      const menu = el.closest('.sub-menu').dataset.menu;
      if (!HIDDEN_SECTIONS.includes(menu) && !HIDDEN_PEOPLE_TABS.includes(el.dataset.tab)) tabs.delete(el.dataset.tab);
    });
    tabs.delete('dashboard');
    return tabs;
  }
  function applyFinanceView() {
    financeView = true;
    document.body.classList.add('scope-finance');
    const name = document.getElementById('a-name');
    if (name && !name.querySelector('.scope-label')) name.insertAdjacentHTML('beforeend', '<span class="scope-label">Bursary</span>');
    const sub = document.querySelector('.admin-user-card .u-sub');
    if (sub) sub.textContent = 'Accountant / Bursary';
    // the pupil card shows Profile and Fees only
    if (Array.isArray(window.SPF_TABS)) for (let i = SPF_TABS.length - 1; i >= 0; i--) if (!['profile', 'fees'].includes(SPF_TABS[i][0])) SPF_TABS.splice(i, 1);
    const blocked = blockedTabs();
    const baseSwitch = window.switchTab;
    window.switchTab = function (tab, ...rest) {
      if (blocked.has(tab)) tab = 'dashboard';
      const out = baseSwitch(tab, ...rest);
      if (tab === 'dashboard') renderHome();
      setTimeout(() => hideEditing(document.body), 0);
      return out;
    };
    window.populateDashboard = renderHome;
    observer.observe(document.body, { childList: true, subtree: true });
    // the page reopens the tab named in the address itself; only step in for a hidden one
    const wanted = location.hash.slice(1) || activeTab();
    if (blocked.has(wanted) || blocked.has(activeTab())) switchTab('dashboard', document.querySelector('.sub-nav-item[data-tab="dashboard"]'));
    else if (activeTab() === 'dashboard') renderHome();
    hideEditing(document.body);
  }

  // SPF_TABS is a top-level const in student-profile.js: reach it by name
  try { if (typeof SPF_TABS !== 'undefined') window.SPF_TABS = SPF_TABS; } catch {}

  function whenUserKnown(fn, tries = 0) {
    if (me()) return fn();
    if (tries < 200) setTimeout(() => whenUserKnown(fn, tries + 1), 100);
  }
  whenUserKnown(() => {
    if (me().scope === 'finance') applyFinanceView();
    refreshBadge();
    setInterval(refreshBadge, 60000);
    const baseSwitch = window.switchTab;
    window.switchTab = function (tab, ...rest) { const out = baseSwitch(tab, ...rest); if (tab === 'reviewPaymentProofs' || tab === 'dashboard') refreshBadge(); return out; };
  });

  // ── Pupil search in the sidebar box: open the pupil's fees ──────────────
  if (window.menuSearch) {
    window.menuSearch.extra = query => {
      const q = String(query || '').trim().toLowerCase();
      if (q.length < 2 || !appState() || !appState().setup) return [];
      return (appState().setup.students || [])
        .filter(s => String(s.name || '').toLowerCase().includes(q) || String(s.regNo || '').toLowerCase().includes(q) || String(s.id).toLowerCase() === q)
        .slice(0, 4)
        .map(s => ({ label: s.name, path: `Pupil · ${s.regNo || s.id} · open fees`, run: () => spfOpen(s.id, 'fees') }));
    };
  }
})();
