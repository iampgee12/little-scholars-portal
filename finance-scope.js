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
  // finance pages left out of the bursar's menu
  const HIDDEN_FINANCE_TABS = ['visitStorefront'];
  const PEOPLE_TABS =['students', 'studentsRegistry', 'enrollmentHistory', 'parents', 'families', 'staff', 'studentProfile', 'staffProfile'];
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
    HIDDEN_FINANCE_TABS.forEach(t => tabs.add(t));
    return tabs;
  }
  // Line icons (16×16, same stroke style as the group icons) for each finance page.
  const LEDGER = '<path d="M2.5 2.5h4a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5h-4z"/><path d="M13.5 2.5h-4A1.5 1.5 0 0 0 8 4v10a1.5 1.5 0 0 1 1.5-1.5h4z"/>';
  const SLIDERS = '<line x1="1.5" y1="4.5" x2="14.5" y2="4.5"/><line x1="1.5" y1="11.5" x2="14.5" y2="11.5"/><circle cx="5.5" cy="4.5" r="1.8"/><circle cx="10.5" cy="11.5" r="1.8"/>';
  const TAB_ICONS = {
    invoiceList: '<path d="M4 1.5h5.5l3 3v10H4z"/><path d="M9.5 1.5v3h3"/><line x1="6" y1="8" x2="10.5" y2="8"/><line x1="6" y1="10.5" x2="10.5" y2="10.5"/>',
    classInvoiceHistory: '<rect x="2" y="3.5" width="9" height="11" rx="1"/><path d="M5 1.5h8a1 1 0 0 1 1 1v10"/><line x1="4.5" y1="7.5" x2="8.5" y2="7.5"/><line x1="4.5" y1="10.5" x2="8.5" y2="10.5"/>',
    familyFeesHistory: '<circle cx="5.5" cy="5" r="2.2"/><circle cx="11" cy="6" r="1.8"/><path d="M1.5 13.5a4 4 0 0 1 8 0"/><path d="M9.5 10a3.2 3.2 0 0 1 5 3"/>',
    reviewPaymentProofs: '<path d="M4 1.5h5.5l3 3v10H4z"/><path d="M9.5 1.5v3h3"/><polyline points="6 9.5 7.7 11.2 10.7 8"/>',
    verifyPaymentStatus: '<path d="M8 1.5l5.5 2v4c0 3.3-2.3 5.8-5.5 7-3.2-1.2-5.5-3.7-5.5-7v-4z"/><polyline points="5.5 8 7.3 9.8 10.5 6.5"/>',
    successfulPayments: '<circle cx="8" cy="8" r="6.3"/><polyline points="5.2 8.2 7.2 10.2 10.8 6.3"/>',
    allPaymentAttempts: '<line x1="5.5" y1="4" x2="14" y2="4"/><line x1="5.5" y1="8" x2="14" y2="8"/><line x1="5.5" y1="12" x2="14" y2="12"/><circle cx="2.5" cy="4" r=".8"/><circle cx="2.5" cy="8" r=".8"/><circle cx="2.5" cy="12" r=".8"/>',
    feesDebtors: '<path d="M8 2l6.5 11.5h-13z"/><line x1="8" y1="6.5" x2="8" y2="9.5"/><line x1="8" y1="11.6" x2="8" y2="11.7"/>',
    expenseRequests: '<rect x="3" y="2.5" width="10" height="12" rx="1.2"/><rect x="5.5" y="1.5" width="5" height="2.2" rx=".6"/><line x1="5.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="5.5" y1="10.5" x2="9" y2="10.5"/>',
    expenses: '<polyline points="1.5 4.5 6 9 9 6 14.5 11.5"/><polyline points="14.5 7.5 14.5 11.5 10.5 11.5"/>',
    income: '<polyline points="1.5 11.5 6 7 9 10 14.5 4.5"/><polyline points="10.5 4.5 14.5 4.5 14.5 8.5"/>',
    incomeExpensesAnalytics: '<path d="M8 1.7a6.3 6.3 0 1 0 6.3 6.3H8z"/><path d="M10 1.9a6.3 6.3 0 0 1 4.1 4.1H10z"/>',
    bankBalanceReport: '<path d="M1.5 6L8 2l6.5 4z"/><line x1="3.5" y1="7.5" x2="3.5" y2="12"/><line x1="6.5" y1="7.5" x2="6.5" y2="12"/><line x1="9.5" y1="7.5" x2="9.5" y2="12"/><line x1="12.5" y1="7.5" x2="12.5" y2="12"/><line x1="1.5" y1="14" x2="14.5" y2="14"/>',
    cashFlowStatement: '<line x1="2" y1="5" x2="13" y2="5"/><polyline points="10.5 2.5 13 5 10.5 7.5"/><line x1="14" y1="11" x2="3" y2="11"/><polyline points="5.5 8.5 3 11 5.5 13.5"/>',
    ieAccountLedger: LEDGER,
    monthlySalariesProcessing: '<rect x="1.5" y="4" width="13" height="8" rx="1.2"/><circle cx="8" cy="8" r="1.8"/><line x1="4" y1="8" x2="4.01" y2="8"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    salaryPaymentSchedule: '<rect x="1.5" y="3" width="13" height="11.5" rx="1.2"/><line x1="1.5" y1="6.5" x2="14.5" y2="6.5"/><line x1="5" y1="1.5" x2="5" y2="4.5"/><line x1="11" y1="1.5" x2="11" y2="4.5"/>',
    payrollSettings: SLIDERS,
    staffLoansAdvances: '<ellipse cx="6.5" cy="5" rx="4.5" ry="2"/><path d="M2 5v3c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V5"/><path d="M6 12.3c.6.5 1.9.9 3.5.9 2.5 0 4.5-.9 4.5-2V8"/>',
    posTerminal: '<rect x="3" y="1.5" width="10" height="13" rx="1.2"/><rect x="5" y="3.5" width="6" height="3"/><line x1="5.5" y1="9" x2="5.51" y2="9"/><line x1="8" y1="9" x2="8.01" y2="9"/><line x1="10.5" y1="9" x2="10.51" y2="9"/><line x1="5.5" y1="11.8" x2="5.51" y2="11.8"/><line x1="8" y1="11.8" x2="8.01" y2="11.8"/><line x1="10.5" y1="11.8" x2="10.51" y2="11.8"/>',
    ordersSales: '<circle cx="6" cy="13.5" r="1"/><circle cx="12" cy="13.5" r="1"/><path d="M1.5 2h2l1.6 8.2h8l1.4-5.7H4.2"/>',
    products: '<path d="M8 1.5l6 3v7l-6 3-6-3v-7z"/><polyline points="2 4.5 8 7.5 14 4.5"/><line x1="8" y1="7.5" x2="8" y2="14.5"/>',
    categories: '<path d="M1.5 8.3V2.5a1 1 0 0 1 1-1h5.8l6.2 6.2-6.8 6.8z"/><circle cx="5" cy="5" r="1.1"/>',
    inventorySupply: '<rect x="1.5" y="3.5" width="8.5" height="7.5"/><path d="M10 6h2.6l1.9 2.5V11H10"/><circle cx="4.5" cy="12.5" r="1.3"/><circle cx="11.8" cy="12.5" r="1.3"/>',
    inventoryReports: '<line x1="1.5" y1="14" x2="14.5" y2="14"/><rect x="2" y="9" width="3" height="5"/><rect x="6.5" y="6" width="3" height="8"/><rect x="11" y="3" width="3" height="11"/>',
    storeSettings: SLIDERS,
    storefrontBanners: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.2"/><circle cx="5.5" cy="6" r="1.2"/><polyline points="14.5 10.5 10.5 7 3 13.5"/>',
    storefrontHomepageSections: '<rect x="1.5" y="1.5" width="13" height="13" rx="1.2"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><line x1="7" y1="6" x2="7" y2="14.5"/>',
    internalRequisitions: '<path d="M5.5 3h-2a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-2"/><rect x="5.5" y="1.5" width="5" height="3" rx=".6"/><polyline points="5.5 9.5 7.2 11.2 10.5 7.8"/>',
    chartOfAccounts: '<rect x="5.5" y="1.5" width="5" height="3.5" rx=".6"/><rect x="1.5" y="11" width="5" height="3.5" rx=".6"/><rect x="9.5" y="11" width="5" height="3.5" rx=".6"/><path d="M8 5v3M4 11V8h8v3"/>',
    journalEntries: '<path d="M11 1.8l3.2 3.2L6 13.2l-3.7.5.5-3.7z"/><line x1="9.5" y1="3.3" x2="12.7" y2="6.5"/>',
    accountLedger: LEDGER,
    trialBalance: '<line x1="8" y1="2" x2="8" y2="14"/><line x1="5" y1="14" x2="11" y2="14"/><line x1="2.5" y1="4" x2="13.5" y2="4"/><path d="M2.5 4L1 8.5a1.6 1.6 0 0 0 3 0z"/><path d="M13.5 4L12 8.5a1.6 1.6 0 0 0 3 0z"/>',
    contactsBillsInvoices: '<rect x="2.5" y="1.5" width="11" height="13" rx="1.2"/><circle cx="8" cy="6.5" r="2"/><path d="M4.8 12a3.3 3.3 0 0 1 6.4 0"/>',
    budgets: '<path d="M2 4.5h11a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M2 4.5L10.5 2v2.5"/><circle cx="11" cy="9.3" r=".8"/>',
    bankReconciliation: '<path d="M13.5 6A5.5 5.5 0 0 0 3 4.5"/><polyline points="2.5 1.5 2.5 5 6 5"/><path d="M2.5 10a5.5 5.5 0 0 0 10.5 1.5"/><polyline points="13.5 14.5 13.5 11 10 11"/>',
    taxCompliance: '<circle cx="8" cy="8" r="6.3"/><line x1="5.5" y1="10.5" x2="10.5" y2="5.5"/><circle cx="6" cy="6" r=".8"/><circle cx="10" cy="10" r=".8"/>',
    financialReports: '<path d="M4 1.5h5.5l3 3v10H4z"/><path d="M9.5 1.5v3h3"/><line x1="6.3" y1="12" x2="6.3" y2="10"/><line x1="8.3" y1="12" x2="8.3" y2="8"/><line x1="10.3" y1="12" x2="10.3" y2="9"/>',
  };
  const tabIcon = tab => `<span class="sub-nav-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[tab] || '<circle cx="8" cy="8" r="1.6"/>'}</svg></span>`;

  // Each Finance folding group (Fees / Bursary, Accounting…) becomes its own main menu
  // item, and the pages inside it become that item's plain sub-menu.
  function splitFinanceMenu() {
    const rail = document.querySelector('.rail-item[data-section="finance"]');
    const menu = document.querySelector('.sub-menu[data-menu="finance"]');
    if (!rail || !menu) return;
    let after = rail;
    menu.querySelectorAll(':scope > .result-gradebook-children').forEach(group => {
      const toggle = group.previousElementSibling;
      const section = 'fin-' + group.id.replace(/-children$/, '');
      const label = toggle.querySelector('span:not(.sub-nav-icon):not(.sub-chev)').textContent.trim();
      const svg = toggle.querySelector('.sub-nav-icon svg').outerHTML.replace(/ width="\d+"| height="\d+"/g, '');
      after.insertAdjacentHTML('afterend', `<button type="button" class="rail-item" data-section="${section}" onclick="showAdminSection('${section}', this)"><span class="rail-icon" aria-hidden="true">${svg}</span><span class="rail-label">${esc(label)}</span></button>`);
      after = after.nextElementSibling;
      const sub = document.createElement('div');
      sub.className = 'sub-menu';
      sub.dataset.menu = section;
      group.querySelectorAll('.sub-nav-item').forEach(item => {
        if (HIDDEN_FINANCE_TABS.includes(item.dataset.tab)) return item.remove();
        item.classList.remove('result-child');
        item.insertAdjacentHTML('afterbegin', tabIcon(item.dataset.tab));
        sub.appendChild(item);
      });
      menu.parentElement.insertBefore(sub, menu);
    });
    rail.style.display = 'none';
    menu.remove();
    // a page already open (reopened from the address) now lights up its new menu
    if (activeTab() && activeTab() !== 'dashboard') syncSidebarForTab(activeTab());
  }

  function applyFinanceView() {
    financeView = true;
    splitFinanceMenu();
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

  const reveal = () => document.documentElement.classList.remove('portal-pending');
  function whenUserKnown(fn, tries = 0) {
    if (me()) return fn();
    if (tries < 750) setTimeout(() => whenUserKnown(fn, tries + 1), 20);
    else reveal();
  }
  whenUserKnown(() => {
    try { if (me().scope === 'finance') applyFinanceView(); } finally { reveal(); }
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
