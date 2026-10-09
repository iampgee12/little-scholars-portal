// Admin → Student Profile page ("Go to profile page" on the Student Information
// card). Mirrors SchoolsFocus's student profile: Profile, Attendance, Fees,
// Results, Subjects, Documents, Update Profile, Password Update, PIN Update
// and Hostel. Server side: students-api.js (/api/admin/view-students/…).

const SPF = { id: null, tab: 'profile', from: 'students', month: '', fees: null, feeFilter: { session: 'all', term: 'all', type: 'all', status: 'all', page: 1, perPage: 20, search: '', picked: new Set() }, resOrder: 'newest', results: null };

const SPF_TABS = [
  ['profile', 'Profile', '<circle cx="8" cy="5" r="3"/><path d="M2.5 14.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>'],
  ['attendance', 'Attendance', '<rect x="2" y="3" width="12" height="11" rx="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5"/><line x1="5.5" y1="1.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="1.5" x2="10.5" y2="4.5"/><polyline points="5.5 10 7.2 11.6 10.5 8.6"/>'],
  ['fees', 'Fees', '<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><circle cx="8" cy="8.2" r="1.8"/><line x1="4" y1="6.5" x2="4" y2="10"/><line x1="12" y1="6.5" x2="12" y2="10"/>'],
  ['results', 'Results', '<path d="M4 1.5h5.5L13 5v9.5H4z"/><polyline points="9.5 1.5 9.5 5 13 5"/><line x1="6" y1="8.5" x2="11" y2="8.5"/><line x1="6" y1="11" x2="11" y2="11"/>'],
  ['subjects', 'Subjects', '<path d="M2 3.5c2-1 4-1 6 .5 2-1.5 4-1.5 6-.5v9.5c-2-1-4-1-6 .5-2-1.5-4-1.5-6-.5z"/><line x1="8" y1="4" x2="8" y2="13.5"/>'],
  ['documents', 'Documents', '<path d="M2 4.5V13h12V6H7.5L6 4.5z"/>'],
  ['edit', 'Update Profile', '<path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/><line x1="9.5" y1="4" x2="12" y2="6.5"/>'],
  ['password', 'Password Update', '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>'],
  ['pin', 'PIN Update', '<rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/><circle cx="5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="11" cy="8" r=".8"/>'],
  ['hostel', 'Hostel', '<path d="M2 14V6.5L8 2l6 4.5V14"/><rect x="6" y="9" width="4" height="5"/>'],
];

const spfSvg = path => `<svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const spfEsc = v => escapeHtml(v ?? '');
const spfName = () => { const s = STU_CARD.student; return [s.surname, s.firstName, s.otherNames].filter(Boolean).join(' ').toUpperCase(); };

function spfShowing(id) {
  return SPF.id === id && document.getElementById('tab-studentProfile')?.classList.contains('active');
}

// ── Open / reload ───────────────────────────────────────────────────────
async function spfOpen(id, tab = 'profile') {
  const current = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
  if (current && current !== 'studentProfile') SPF.from = current;
  try {
    STU_CARD = await apiFetch(`/api/admin/view-students/profile?id=${encodeURIComponent(id)}`);
  } catch (err) { return showToast(err.message); }
  if (SPF.id !== id) { SPF.fees = null; SPF.results = null; SPF.feeFilter.picked = new Set(); SPF.feeFilter.page = 1; }
  SPF.id = id;
  SPF.tab = tab;
  SPF.data = STU_CARD;
  try { sessionStorage.setItem('spf_id', id); } catch {}
  switchTab('studentProfile', visibleNavItem(SPF.from), 'Student Profile', spfName());
}

// switchTab hook: draws the page (or reopens the last pupil after a refresh)
function spfInit() {
  if (SPF.data && SPF.id === SPF.data.student.id) { STU_CARD = SPF.data; return spfRender(); }
  let id = '';
  try { id = sessionStorage.getItem('spf_id') || ''; } catch {}
  if (id) return spfOpen(id);
  switchTab('students', visibleNavItem('students'));
}

async function spfReload() {
  try {
    STU_CARD = SPF.data = await apiFetch(`/api/admin/view-students/profile?id=${encodeURIComponent(SPF.id)}`);
  } catch (err) { return showToast(err.message); }
  spfRenderHead();
  // keep a half-filled Update Profile form; everything else redraws
  if (SPF.tab !== 'edit') spfTab(SPF.tab);
}

function spfBack() {
  switchTab(SPF.from, visibleNavItem(SPF.from));
}

function spfRender() {
  const root = document.getElementById('spf-root');
  if (!root) return;
  root.innerHTML = `<div class="spf-head card"><div class="card-body" id="spf-head"></div></div>
    <div class="spf-wrap">
      <div class="spf-tabs card">
        <button class="spf-back" onclick="spfBack()">&larr; Back to Students List</button>
        ${SPF_TABS.map(([key, label, icon]) => `<button class="spf-tab" data-spf="${key}" onclick="spfTab('${key}')">${spfSvg(icon)}<span>${label}</span></button>`).join('')}
      </div>
      <div class="spf-body card"><div class="card-body" id="spf-body"></div></div>
    </div>`;
  spfRenderHead();
  spfTab(SPF.tab);
}

function spfRenderHead() {
  const head = document.getElementById('spf-head');
  if (!head) return;
  const s = STU_CARD.student;
  const line = [s.category, s.classLabel, s.armName].filter(Boolean).map(v => String(v).toUpperCase()).join(' - ');
  head.innerHTML = `<div class="spf-head-row">
      <div class="spf-avatar">${s.photoPath ? `<img src="/${spfEsc(s.photoPath)}" alt="">` : `<span>${spfEsc((s.firstName || '?')[0] + (s.surname || '')[0])}</span>`}</div>
      <div><div class="spf-head-name">${spfEsc(spfName())}</div><div class="spf-head-class">${spfEsc(line || 'Not assigned to a class')}</div>
        <div class="spf-head-tags"><span class="sr-pill ${s.active ? 'accepted' : 'rejected'}">${s.active ? 'Active' : 'Deactivated'}</span>${s.archived ? ' <span class="sr-pill bypassed">Archived</span>' : ''} <span class="stu-mono">${spfEsc(s.regNo || s.id)}</span></div></div>
    </div>`;
  const sub = document.getElementById('topbar-sub');
  if (sub) sub.textContent = spfName();
}

function spfTab(key) {
  SPF.tab = key;
  document.querySelectorAll('.spf-tab').forEach(b => b.classList.toggle('active', b.dataset.spf === key));
  const body = document.getElementById('spf-body');
  if (!body) return;
  // the Update Profile form reuses the enrol wizard's field ids, so the
  // Enroll Students page must not hold a second copy of them
  if (key === 'edit') { const er = document.getElementById('enrol-root'); if (er) er.innerHTML = ''; }
  ({
    profile: spfProfile, attendance: spfAttendance, fees: spfFees, results: spfResults, subjects: spfSubjects,
    documents: spfDocuments, edit: spfEdit, password: spfPassword, pin: spfPin, hostel: spfHostel,
  }[key] || spfProfile)(body);
}

const spfTitle = (title, extra = '') => `<div class="spf-title"><h3>${title}</h3>${extra}</div>`;
const spfLoading = body => { body.innerHTML = '<div class="sr-empty">Loading…</div>'; };

// ── Profile ─────────────────────────────────────────────────────────────
function spfProfile(body) {
  body.innerHTML = `<div id="spf-profile-body" class="spf-profile">${stuInfoBody(true)}</div>`;
}

async function spfDelete() {
  const s = STU_CARD.student;
  if (!(state.setup?.students || []).some(x => x.id === s.id)) {
    try { state.setup = await apiFetch('/api/admin/result-setup'); } catch {}
  }
  state.editingStudentId = s.id;
  openStudentDeleteModal();
}

async function spfArchive(archive) {
  const s = STU_CARD.student;
  if (archive && !confirm(`Archive ${spfName()}? The account is hidden from class lists until it is restored.`)) return;
  try {
    await apiFetch('/api/admin/view-students/action', { method: 'POST', body: JSON.stringify({ ids: [s.id], action: archive ? 'archive' : 'unarchive' }) });
    showToast(archive ? 'Account archived' : 'Account restored');
    if (typeof populateStudents === 'function') populateStudents();
    spfReload();
  } catch (err) { showToast(err.message); }
}

// ── Attendance ──────────────────────────────────────────────────────────
const SPF_ATT = { present: ['P', 'Present'], absent: ['A', 'Absent'], late: ['L', 'Late'], permission: ['E', 'Excused (permission)'] };

async function spfAttendance(body) {
  if (!SPF.month) SPF.month = new Date().toISOString().slice(0, 7);
  body.innerHTML = `${spfTitle('Attendance Report')}
    <div class="spf-filters">${enField('Month', `<input type="month" class="field-input" id="spf-month" value="${SPF.month}" onchange="SPF.month=this.value; spfTab('attendance')">`, { required: true })}</div>
    <div id="spf-att"><div class="sr-empty">Loading…</div></div>`;
  let data;
  try { data = await apiFetch(`/api/admin/view-students/attendance?id=${encodeURIComponent(SPF.id)}&month=${SPF.month}`); } catch (err) { return showToast(err.message); }
  const box = document.getElementById('spf-att');
  if (!box) return;
  const [y, mo] = SPF.month.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const label = new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const iso = d => `${SPF.month}-${String(d).padStart(2, '0')}`;
  const holidays = new Map(data.holidays.map(h => [h.date, h.label]));
  const inTerm = date => !data.terms.length || data.terms.some(t => date >= t.start && date <= t.end);
  const dayKind = d => {
    const date = iso(d);
    const wd = new Date(y, mo - 1, d).getDay();
    if (holidays.has(date)) return 'holiday';
    if (wd === 0 || wd === 6) return 'na';
    if (!inTerm(date)) return 'outside';
    return '';
  };
  const headRow = `<tr><th class="spf-att-name">Students</th>${Array.from({ length: days }, (_, i) => {
    const wd = new Date(y, mo - 1, i + 1).toLocaleString('en-GB', { weekday: 'short' });
    return `<th class="${dayKind(i + 1)}">${wd}<br>${i + 1}</th>`;
  }).join('')}</tr>`;
  const cellFor = (recs, d) => {
    const kind = dayKind(d);
    const marks = recs.filter(r => r.date === iso(d));
    const text = marks.map(r => `<span class="spf-att-${r.status}" title="${spfEsc(SPF_ATT[r.status]?.[1] || r.status)}${r.sessionType !== 'daily' && r.sessionType !== 'lesson' ? ` (${spfEsc(r.sessionType)})` : ''}">${SPF_ATT[r.status]?.[0] || '?'}</span>`).join('/');
    return `<td class="${kind}"${holidays.has(iso(d)) ? ` title="${spfEsc(holidays.get(iso(d)))}"` : ''}>${text}</td>`;
  };
  const daily = data.records.filter(r => r.sessionType !== 'lesson');
  const lesson = data.records.filter(r => r.sessionType === 'lesson');
  const count = (recs, st) => recs.filter(r => r.status === st).length;
  const totals = recs => `<div class="stu-counters">${[['check', count(recs, 'present'), 'Present', 'green'], ['off', count(recs, 'absent'), 'Absent', 'red'], ['history', count(recs, 'late'), 'Late', 'amber'], ['users', count(recs, 'permission'), 'Excused', 'blue']]
    .map(([icon, v, l, tone]) => `<div class="stu-counter ${tone}"><span class="stu-counter-icon">${stuIcon(icon)}</span><div><strong>${v}</strong><span>${l}</span></div></div>`).join('')}</div>`;
  const key = `<div class="spf-att-key"><strong>Key:</strong> <span><i class="na"></i>Non-applicable day</span><span><i class="outside"></i>Outside academic period</span><span><i class="holiday"></i>School holiday</span>
    ${Object.values(SPF_ATT).map(([l, t]) => `<span><b>${l}</b> ${t}</span>`).join('')}</div>`;
  const subjects = [...new Set(lesson.map(r => r.subject || 'Lesson'))].sort();
  box.innerHTML = `
    <div class="spf-sub-head">Daily Attendance Report <span>${spfEsc(label)}</span></div>
    ${totals(daily)}
    <div class="spf-att-scroll"><table class="spf-att-table"><thead>${headRow}</thead><tbody>
      <tr><td class="spf-att-name">${spfEsc(spfName())}</td>${Array.from({ length: days }, (_, i) => cellFor(daily, i + 1)).join('')}</tr>
    </tbody></table></div>${key}
    <div class="spf-sub-head">Class Attendance Report <span>${spfEsc(label)}</span></div>
    ${totals(lesson)}
    <div class="spf-att-scroll"><table class="spf-att-table"><thead>${headRow.replace('>Students<', '>Subject / Lesson<')}</thead><tbody>
      ${subjects.length ? subjects.map(sub => `<tr><td class="spf-att-name">${spfEsc(sub)}</td>${Array.from({ length: days }, (_, i) => cellFor(lesson.filter(r => (r.subject || 'Lesson') === sub), i + 1)).join('')}</tr>`).join('')
        : `<tr><td class="spf-att-name">${spfEsc(spfName())}</td><td colspan="${days}" class="sr-empty">No lesson attendance marked this month</td></tr>`}
    </tbody></table></div>${key}`;
}

// ── Fees ────────────────────────────────────────────────────────────────
async function spfFees(body) {
  spfLoading(body);
  try {
    const [inv, terms] = await Promise.all([apiFetch(`/api/admin/fees/invoices?studentId=${encodeURIComponent(SPF.id)}`), feesTermsList()]);
    const termOf = new Map(terms.map(t => [t.id, t]));
    SPF.fees = inv.invoices.map(i => ({ ...i, session: termOf.get(i.academicId)?.sessionLabel || '', term: termOf.get(i.academicId)?.termLabel || '' }));
    SPF.feeTerms = terms;
  } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  const f = SPF.feeFilter;
  const sessions = [...new Set(SPF.feeTerms.map(t => t.sessionLabel))];
  const termLabels = [...new Set(SPF.feeTerms.map(t => t.termLabel))];
  const types = [...new Set(SPF.fees.map(i => i.feeType).filter(Boolean))].sort();
  const opt = (list, val) => `<option value="all">All</option>${list.map(v => `<option value="${spfEsc(v)}"${v === val ? ' selected' : ''}>${spfEsc(v)}</option>`).join('')}`;
  body.innerHTML = `${spfTitle(`Student Fees Invoice List | ${spfEsc(spfName())}`)}
    <div class="spf-filters four">
      ${enField('Fees Session', `<select class="ctrl-select" id="spf-f-session">${opt(sessions, f.session)}</select>`, { required: true })}
      ${enField('Fees Term', `<select class="ctrl-select" id="spf-f-term">${opt(termLabels, f.term)}</select>`, { required: true })}
      ${enField('Filter By Invoice Type', `<select class="ctrl-select" id="spf-f-type">${opt(types, f.type)}</select>`)}
      ${enField('Filter By Payment Status', `<select class="ctrl-select" id="spf-f-status"><option value="all">All</option>${[['unpaid', 'Unpaid'], ['partial', 'Partly Paid'], ['paid', 'Total Paid']].map(([v, l]) => `<option value="${v}"${f.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    </div>
    <div class="spf-actions"><button class="post-btn btn-sm" onclick="spfFeesApply()">Apply Filter</button></div>
    <div class="spf-sub-head">Admission Fees</div>
    <div class="sr-empty spf-left">No admission application fee record found for ${spfEsc(spfName())}</div>
    <div id="spf-fees-list"></div>`;
  spfFeesPaint();
}

function spfFeesApply() {
  const f = SPF.feeFilter;
  f.session = document.getElementById('spf-f-session').value;
  f.term = document.getElementById('spf-f-term').value;
  f.type = document.getElementById('spf-f-type').value;
  f.status = document.getElementById('spf-f-status').value;
  f.page = 1;
  spfFeesPaint();
}

function spfFeesRows() {
  const f = SPF.feeFilter;
  const q = f.search.toLowerCase();
  return (SPF.fees || []).filter(i => (f.session === 'all' || i.session === f.session) && (f.term === 'all' || i.term === f.term)
    && (f.type === 'all' || i.feeType === f.type) && (f.status === 'all' || i.status === f.status)
    && (!q || [i.feeType, i.description, i.classLabel, `INV-${i.id}`].some(v => String(v || '').toLowerCase().includes(q))));
}

function spfFeesPaint() {
  const box = document.getElementById('spf-fees-list');
  if (!box) return;
  const f = SPF.feeFilter;
  const rows = spfFeesRows();
  const sum = k => rows.reduce((t, i) => t + Number(i[k] || 0), 0);
  const total = sum('amount'); const paid = sum('paid'); const due = sum('balance');
  const pct = v => total ? `${(v / total * 100).toFixed(2)}%` : '0.00%';
  const pages = Math.max(1, Math.ceil(rows.length / f.perPage));
  f.page = Math.min(f.page, pages);
  const start = (f.page - 1) * f.perPage;
  const page = rows.slice(start, start + f.perPage);
  const count = st => rows.filter(i => i.status === st).length;
  box.innerHTML = `
    <div class="spf-sub-head">Student Fees Invoice List</div>
    <div class="spf-note"><strong>NOTE:</strong> The full details (breakdown) of each invoice are available inside the invoice itself — click <em>View</em>.</div>
    <div class="stu-counters">
      <div class="stu-counter slate"><div><strong>${fmtNaira(total)}</strong><span>Total in list</span></div></div>
      <div class="stu-counter green"><div><strong>${fmtNaira(paid)}</strong><span>Total Paid · ${pct(paid)}</span></div></div>
      <div class="stu-counter red"><div><strong>${fmtNaira(due)}</strong><span>Total Due · ${pct(due)}</span></div></div>
    </div>
    <div class="vs-toolbar">
      <div class="stu-dd"><button class="btn-outline btn-sm" onclick="stuToggleDd(this)">Action on Selected &#9662;</button>
        <div class="stu-dd-menu"><button onclick="spfFeesPrint(true, true)">Print Selected Invoices</button><button onclick="spfFeesExport('csv', true)">Export Selected (CSV)</button><button onclick="SPF.feeFilter.picked = new Set(); spfFeesPaint()">Cancel Selection</button></div></div>
      <div class="stu-dd"><button class="btn-outline btn-sm" onclick="stuToggleDd(this)">Export List &#9662;</button>
        <div class="stu-dd-menu"><button onclick="spfFeesExport('doc')">DOC</button><button onclick="spfFeesExport('csv')">CSV</button><button onclick="spfFeesExport('xls')">XLS</button><button onclick="spfFeesExport('xlsx')">XLSX</button></div></div>
      <div class="stu-dd"><button class="btn-outline btn-sm" onclick="stuToggleDd(this)">Print List &#9662;</button>
        <div class="stu-dd-menu"><button onclick="spfFeesPrint(false)">Print List Only</button><button onclick="spfFeesPrint(true)">Print List with Summary</button></div></div>
    </div>
    <div class="sr-tools">
      <label><select class="ctrl-select" onchange="SPF.feeFilter.perPage=Number(this.value); SPF.feeFilter.page=1; spfFeesPaint()">${[10, 20, 25, 50, 100, 200, 500].map(n => `<option value="${n}"${n === f.perPage ? ' selected' : ''}>${n}</option>`).join('')}</select> records per page</label>
      <input class="search-input" placeholder="Search" value="${spfEsc(f.search)}" oninput="SPF.feeFilter.search=this.value; SPF.feeFilter.page=1; spfFeesPaint(); const el=document.querySelector('#spf-fees-list .search-input'); el.focus(); el.setSelectionRange(el.value.length, el.value.length)">
    </div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr>
      <th><input type="checkbox" ${page.length && page.every(i => f.picked.has(i.id)) ? 'checked' : ''} onchange="spfFeesPickAll(this.checked)"></th><th>#</th><th>Student</th><th>Fee</th><th>Class</th><th>Invoice ID</th><th>Invoice Title</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th><th>Created</th><th>Collection</th><th>Action</th>
    </tr></thead><tbody>
      ${page.length ? page.map((i, n) => `<tr>
        <td><input type="checkbox" ${f.picked.has(i.id) ? 'checked' : ''} onchange="spfFeesPick(${i.id}, this.checked)"></td>
        <td>${start + n + 1}</td><td>${spfEsc(spfName())}</td><td>${spfEsc(i.feeType)}</td><td>${spfEsc(i.classLabel)}</td>
        <td class="stu-mono">INV-${i.id}</td><td>${spfEsc(i.description || i.feeType)}<div class="en-hint">${spfEsc([i.session, i.term].filter(Boolean).join(' · '))}</div></td>
        <td>${fmtNaira(i.amount)}</td><td>${fmtNaira(i.paid)}</td><td>${fmtNaira(i.balance)}</td><td>${invoiceStatusBadge(i)}${i.overdue ? ' <span class="en-hint">overdue</span>' : ''}</td>
        <td>${feeFmtDate(i.createdAt)}</td>
        <td>${i.balance > 0 ? `<button class="post-btn btn-sm" onclick="spfFeesPay(${i.id})" title="Record Offline Or Direct Bank Payment">Record Payment</button>` : '<span class="en-hint">Fully paid</span>'}</td>
        <td><button class="btn-outline btn-sm" onclick="spfInvoice(${i.id})">View</button></td>
      </tr>`).join('') : '<tr><td colspan="14" class="sr-empty">No records found</td></tr>'}
    </tbody><tfoot><tr><th colspan="7">Total</th><th>${fmtNaira(total)}</th><th>${fmtNaira(paid)}</th><th>${fmtNaira(due)}</th><th colspan="4">${count('unpaid')} Unpaid, ${count('partial')} Partly Paid, ${count('paid')} Paid</th></tr></tfoot></table></div>
    <div class="sr-foot"><span>Showing ${rows.length ? start + 1 : 0} to ${start + page.length} of ${rows.length} entries</span>
      <div class="sr-pages">${Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === f.page ? 'active' : ''}" onclick="SPF.feeFilter.page=${i + 1}; spfFeesPaint()">${i + 1}</button>`).join('')}</div></div>`;
}

function spfFeesPick(id, on) { const s = SPF.feeFilter.picked; on ? s.add(id) : s.delete(id); }
function spfFeesPickAll(on) {
  const f = SPF.feeFilter;
  const start = (f.page - 1) * f.perPage;
  spfFeesRows().slice(start, start + f.perPage).forEach(i => on ? f.picked.add(i.id) : f.picked.delete(i.id));
  spfFeesPaint();
}

function spfFeesPay(id) {
  const inv = SPF.fees.find(i => i.id === id);
  openRecordPaymentModal(id, `${spfName()} — ${inv.feeType} (Balance: ${fmtNaira(inv.balance)})`, () => spfTab('fees'));
}

function spfFeesTable(rows) {
  const headers = ['#', 'Fee', 'Class', 'Invoice ID', 'Invoice Title', 'Session', 'Term', 'Total', 'Paid', 'Due', 'Status', 'Created'];
  const data = rows.map((i, n) => [n + 1, i.feeType, i.classLabel, `INV-${i.id}`, i.description || i.feeType, i.session, i.term, fmtNaira(i.amount), fmtNaira(i.paid), fmtNaira(i.balance),
    { paid: 'Paid', partial: 'Part Paid', unpaid: 'Unpaid' }[i.status] || i.status, feeFmtDate(i.createdAt)]);
  return { headers, data };
}

function spfFeesExport(format, onlyPicked = false) {
  const rows = spfFeesRows().filter(i => !onlyPicked || SPF.feeFilter.picked.has(i.id));
  if (onlyPicked && !rows.length) return showToast('Tick at least one invoice first');
  const { headers, data } = spfFeesTable(rows);
  const name = `fees-${SPF.id}`;
  stuExport(format === 'xls' ? 'doc' : format, headers, data, name, `Student Fees Invoice List | ${spfName()}`);
}

function spfLetterhead(title) {
  const school = STU_CARD.school || {};
  return `<div style="text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;margin-bottom:12px;">
    <div style="font-size:18px;font-weight:700;color:#1d5c9b;">${spfEsc(String(school.name || '').toUpperCase())}</div>
    <div>${spfEsc(String(school.address || '').toUpperCase())}</div>
    <div>Email: ${spfEsc(school.email || '')} &nbsp; Tel: ${spfEsc(school.phone || '')}</div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;"><span>Our Ref.: _____________________</span><span>Your Ref.: ____________________</span></div>
    <div style="font-size:15px;font-weight:700;margin-top:8px;text-decoration:underline;">${title}</div></div>`;
}

function spfPrintHtml(title, html) {
  const win = window.open('', '_blank');
  if (!win) return showToast('Allow pop-ups to print');
  win.document.write(`<html><head><meta charset="utf-8"><title>${spfEsc(title)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px} table{border-collapse:collapse;width:100%;margin:8px 0}
    th,td{border:1px solid #999;padding:5px 6px;text-align:left} th{background:#16a34a;color:#fff} h4{margin:16px 0 4px}
    .sum{display:flex;gap:24px;margin:8px 0} .sum div{border:1px solid #ccc;padding:6px 10px;border-radius:4px}
  </style></head><body>${html}<script>setTimeout(() => window.print(), 400);<\/script></body></html>`);
  win.document.close();
}

function spfFeesPrint(withSummary, onlyPicked = false) {
  const rows = spfFeesRows().filter(i => !onlyPicked || SPF.feeFilter.picked.has(i.id));
  if (onlyPicked && !rows.length) return showToast('Tick at least one invoice first');
  const { headers, data } = spfFeesTable(rows);
  const sum = k => rows.reduce((t, i) => t + Number(i[k] || 0), 0);
  const title = `Student Fees Invoice List | ${spfName()}`;
  spfPrintHtml(title, `${spfLetterhead(spfEsc(title))}
    ${withSummary ? `<div class="sum"><div>Total in list: <b>${fmtNaira(sum('amount'))}</b></div><div>Total Paid: <b>${fmtNaira(sum('paid'))}</b></div><div>Total Due: <b>${fmtNaira(sum('balance'))}</b></div></div>` : ''}
    <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${data.map(r => `<tr>${r.map(v => `<td>${spfEsc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">No records found</td></tr>`}</tbody></table>`);
}

async function spfInvoice(id) {
  let inv;
  try { inv = (await apiFetch(`/api/admin/fees/invoices/${id}`)).invoice; } catch (err) { return showToast(err.message); }
  const row = (l, v) => `<tr><td>${l}</td><td>${v}</td></tr>`;
  const body = `<div id="spf-invoice-print">
    <table class="stu-info"><tbody>
      ${row('Invoice ID', `INV-${inv.id}`)}${row('Student', spfEsc(inv.studentName))}${row('Class', spfEsc(inv.classLabel))}
      ${row('Fee', spfEsc(inv.feeType))}${row('Description', spfEsc(inv.description || '—'))}
      ${row('Amount', fmtNaira(inv.amount))}${row('Paid', fmtNaira(inv.paid))}${row('Balance', fmtNaira(inv.balance))}
      ${row('Due Date', feeFmtDate(inv.dueDate))}${row('Status', invoiceStatusBadge(inv))}${row('Created', feeFmtDate(inv.createdAt))}
    </tbody></table>
    <div class="spf-sub-head">Payment History</div>
    <table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Note</th></tr></thead><tbody>
      ${inv.payments.length ? inv.payments.map(p => `<tr><td>${feeFmtDate(p.recordedAt)}</td><td>${fmtNaira(p.amount)}</td><td>${spfEsc(p.method)}</td><td>${spfEsc(p.reference || '—')}</td><td style="text-transform:capitalize">${spfEsc(p.status)}</td><td>${spfEsc(p.note || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="sr-empty">No payments yet</td></tr>'}
    </tbody></table></div>`;
  const modal = stuModal('spf-invoice-modal', `Invoice INV-${inv.id}`, body,
    `<button class="btn-outline" id="spf-inv-print">Print</button>${inv.balance > 0 ? '<button class="post-btn" id="spf-inv-pay">Record Payment</button>' : ''}`);
  modal.querySelector('#spf-inv-print').onclick = () => spfPrintHtml(`Invoice INV-${inv.id}`, `${spfLetterhead(`Invoice INV-${inv.id}`)}${document.getElementById('spf-invoice-print').innerHTML}`);
  modal.querySelector('#spf-inv-pay')?.addEventListener('click', () => { modal.remove(); spfFeesPay(inv.id); });
}

// ── Results ─────────────────────────────────────────────────────────────
async function spfResults(body) {
  spfLoading(body);
  try { SPF.results = await apiFetch(`/api/admin/view-students/results?id=${encodeURIComponent(SPF.id)}`); } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  const { results } = SPF.results;
  const list = SPF.resOrder === 'oldest' ? results : [...results].reverse();
  const max = results[0]?.maxPoint ?? Math.max(...(SPF.results.scale || []).map(g => Number(g.gradePoint || 0)), 0);
  body.innerHTML = `${spfTitle('Student Results')}
    <div class="spf-filters four">
      ${enField('Results Display Order', `<select class="ctrl-select" onchange="SPF.resOrder=this.value; spfTab('results')"><option value="newest"${SPF.resOrder === 'newest' ? ' selected' : ''}>Newest Results First</option><option value="oldest"${SPF.resOrder === 'oldest' ? ' selected' : ''}>Oldest Results First</option></select>`)}
      <div class="en-field"><label class="field-label">Academic Transcript</label><button class="post-btn" onclick="spfTranscript()" ${results.length ? '' : 'disabled'}>Generate Transcript</button></div>
    </div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Class / Class Arm</th><th>Exam</th><th>Average</th><th>Grade Point Average (GPA) [Max: ${Number(max).toFixed(2)}]</th><th>Cummulative Grade Point Average (CGPA)</th><th>Print</th></tr></thead><tbody>
      ${list.length ? list.map(r => `<tr><td>${spfEsc(spfName())}</td><td>${spfEsc(r.classText)}</td><td>${spfEsc(String(r.session).replace('/', '-'))} · ${spfEsc(r.term)}<br><strong>${spfEsc(r.examType)}</strong></td>
        <td>${r.average ?? '—'}${r.average != null ? '%' : ''}</td><td><strong>${r.gpa != null ? r.gpa.toFixed(2) : '—'}</strong></td><td>${r.cgpa.toFixed(2)}</td>
        <td><button class="btn-outline btn-sm" onclick="window.open('/api/admin/reports/${r.id}/pdf?inline=1', '_blank')">Print</button> <a class="en-link" href="#spf-res-${r.id}" onclick="event.preventDefault(); document.getElementById('spf-res-${r.id}')?.scrollIntoView({behavior:'smooth'})">View</a></td></tr>`).join('')
        : '<tr><td colspan="7" class="sr-empty">No published results yet</td></tr>'}
    </tbody></table></div>
    ${list.length ? `<div class="spf-note">Viewing results in bulk takes a bit more time to load. Please be patient while the result sheets load.</div>
      ${list.map(r => `<div class="spf-res-sheet" id="spf-res-${r.id}"><div class="spf-sub-head">${spfEsc(r.examType)} <span>${spfEsc(String(r.session).replace('/', '-'))} · ${spfEsc(r.term)} · ${spfEsc(r.classText)}</span></div>
        <iframe loading="lazy" src="/api/admin/reports/${r.id}/pdf?inline=1" title="${spfEsc(r.examType)} result"></iframe></div>`).join('')}
      <div class="spf-actions"><button class="btn-outline btn-sm" onclick="document.getElementById('spf-body').scrollIntoView({behavior:'smooth'})">Back to Top</button></div>` : ''}`;
}

function spfTranscript() {
  const { results } = SPF.results;
  const s = STU_CARD.student;
  const final = results.length ? results[results.length - 1].cgpa : 0;
  const html = `${spfLetterhead('Academic Transcript')}
    <table><tbody>
      <tr><td><b>Name</b></td><td>${spfEsc(spfName())}</td><td><b>Adm. / Reg. No.</b></td><td>${spfEsc(s.regNo || s.id)}</td></tr>
      <tr><td><b>Gender</b></td><td>${s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : ''}</td><td><b>Date of Birth</b></td><td>${spfEsc(stuDate(s.dob))}</td></tr>
      <tr><td><b>Current Class</b></td><td>${spfEsc([s.classLabel, s.armName].filter(Boolean).join(' - ').toUpperCase())}</td><td><b>Admission Date</b></td><td>${spfEsc(stuDate(s.admissionDate))}</td></tr>
    </tbody></table>
    ${results.map(r => `<h4>${spfEsc(String(r.session).replace('/', '-'))} · ${spfEsc(r.term)} · ${spfEsc(r.examType)} — ${spfEsc(r.classText)}</h4>
      <table><thead><tr><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th><th>Remark</th><th>Grade Point</th></tr></thead><tbody>
        ${r.subjects.map(x => `<tr><td>${spfEsc(x.name)}</td><td>${x.ca ?? ''}</td><td>${x.exam ?? ''}</td><td>${x.total ?? ''}</td><td>${spfEsc(x.grade)}</td><td>${spfEsc(x.remark)}</td><td>${x.point.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="7">No subject scores on record</td></tr>'}
      </tbody></table>
      <div>Average: <b>${r.average ?? '—'}${r.average != null ? '%' : ''}</b> &nbsp; GPA: <b>${r.gpa != null ? r.gpa.toFixed(2) : '—'}</b> &nbsp; CGPA: <b>${r.cgpa.toFixed(2)}</b></div>`).join('')}
    <h4>Cumulative Grade Point Average (CGPA): ${final.toFixed(2)}</h4>
    <div style="display:flex;justify-content:space-between;margin-top:48px;"><span>______________________<br>Registrar / Admin</span><span>______________________<br>Principal / Head Teacher</span></div>`;
  spfPrintHtml(`Academic Transcript — ${spfName()}`, html);
}

// ── Subjects ────────────────────────────────────────────────────────────
async function spfSubjects(body) {
  spfLoading(body);
  let terms = [];
  try { terms = await feesTermsList(); } catch {}
  const active = terms.find(t => t.isActive);
  const session = active?.sessionLabel || '';
  const sessTerms = terms.filter(t => t.sessionLabel === session).map(t => t.termLabel).sort();
  if (!SPF.subTerm || !sessTerms.includes(SPF.subTerm)) SPF.subTerm = active?.termLabel || sessTerms[0] || '';
  let data;
  try { data = await apiFetch(`/api/admin/view-students/subjects?id=${encodeURIComponent(SPF.id)}&term=${encodeURIComponent(SPF.subTerm)}`); } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  body.innerHTML = `${spfTitle('Subject Registration')}
    <div class="spf-filters four">
      <div class="en-field"><label class="field-label">Academic Session</label><div class="spf-static">${spfEsc(String(session).replace('/', '-') || '—')}</div></div>
      ${enField('Select Term', `<select class="ctrl-select" onchange="SPF.subTerm=this.value; spfTab('subjects')">${sessTerms.map(t => `<option${t === SPF.subTerm ? ' selected' : ''}>${spfEsc(t)}</option>`).join('')}</select>`)}
    </div>
    <div class="spf-note">Subjects are automatically assigned to this student based on class enrollment (Academics → Class Subjects).</div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Subject</th><th>Code</th><th>Subject Teacher</th><th>Status</th></tr></thead><tbody>
      ${data.subjects.length ? data.subjects.map((s, i) => `<tr><td>${i + 1}</td><td>${spfEsc(String(s.name).toUpperCase())}</td><td class="stu-mono">${spfEsc(s.code || '')}</td><td>${spfEsc(s.teacher || '—')}</td><td><span class="sr-pill accepted">Active</span></td></tr>`).join('')
        : '<tr><td colspan="5" class="sr-empty">No subjects set up for this class yet</td></tr>'}
    </tbody><tfoot><tr><th colspan="5">${data.subjects.length} Subject(s)</th></tr></tfoot></table></div>`;
}

// ── Documents ───────────────────────────────────────────────────────────
async function spfDocuments(body) {
  spfLoading(body);
  let data;
  try { data = await apiFetch(`/api/admin/view-students/documents?id=${encodeURIComponent(SPF.id)}`); } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  SPF.admission = data.admission;
  const a = data.admission;
  const size = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  body.innerHTML = `${spfTitle('Admission Letter &amp; Slip')}
    ${a ? `<table class="stu-info"><tbody>
        <tr><td>Applicant</td><td>${spfEsc(a.name)}</td></tr><tr><td>Class Applied For</td><td>${spfEsc(a.classLabel || '—')}</td></tr>
        <tr><td>Parent / Guardian</td><td>${spfEsc(a.parentName || '—')}</td></tr><tr><td>Submitted</td><td>${spfEsc(feeFmtDate(a.submittedAt))}</td></tr>
        <tr><td>Status</td><td style="text-transform:capitalize">${spfEsc(a.status)}${a.reviewedAt ? ` (${spfEsc(feeFmtDate(a.reviewedAt))})` : ''}</td></tr></tbody></table>
        <div class="spf-actions"><button class="btn-outline btn-sm" onclick="spfAdmissionPrint('slip')">Print Admission Slip</button><button class="post-btn btn-sm" onclick="spfAdmissionPrint('letter')">Print Admission Letter</button></div>`
      : '<div class="sr-empty spf-left">No admission application record found for this student</div>'}
    ${spfTitle("Student's Documents")}
    <div class="spf-upload">
      ${enField('Document Title', '<input class="field-input" id="spf-doc-title" placeholder="e.g. Birth Certificate">', { required: true })}
      ${enField('File', '<input type="file" class="field-input" id="spf-doc-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/png,image/jpeg">', { required: true, hint: 'PDF, Word, Excel, text or image · 6 MB max' })}
      <div class="en-field"><label class="field-label">&nbsp;</label><button class="post-btn" onclick="spfDocUpload(this)">Upload Document</button></div>
    </div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Title</th><th>File</th><th>Size</th><th>Uploaded</th><th>By</th><th></th></tr></thead><tbody>
      ${data.documents.length ? data.documents.map((d, i) => `<tr><td>${i + 1}</td><td><strong>${spfEsc(d.title)}</strong></td><td>${spfEsc(d.fileName)}</td><td>${size(d.size)}</td><td>${spfEsc(feeFmtDate(d.uploadedAt))}</td><td>${spfEsc(d.uploadedBy || '')}</td>
        <td class="spf-row-btns"><button class="btn-outline btn-sm" onclick="window.open('/api/admin/view-students/document?docId=${d.id}', '_blank')">View</button><button class="btn-outline btn-sm" onclick="location.href='/api/admin/view-students/document?docId=${d.id}&download=1'">Download</button><button class="btn-danger btn-sm" onclick="spfDocDelete(${d.id})">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="sr-empty">No Documents Found for this User</td></tr>'}
    </tbody></table></div>`;
}

async function spfDocUpload(btn) {
  const title = document.getElementById('spf-doc-title').value.trim();
  const file = document.getElementById('spf-doc-file').files?.[0];
  if (!title) return showToast('Give the document a title');
  if (!file) return showToast('Choose the file to upload');
  if (file.size > 6 * 1024 * 1024) return showToast('File is too large (6 MB max)');
  btn.disabled = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file')); r.readAsDataURL(file); });
    await apiFetch('/api/admin/view-students/documents', { method: 'POST', body: JSON.stringify({ id: SPF.id, title, fileName: file.name, dataUrl }) });
    showToast('Document uploaded');
    spfTab('documents');
  } catch (err) { showToast(err.message); btn.disabled = false; }
}

async function spfDocDelete(id) {
  if (!confirm('Delete this document?')) return;
  try { await apiFetch(`/api/admin/view-students/document?docId=${id}`, { method: 'DELETE' }); showToast('Document deleted'); spfTab('documents'); } catch (err) { showToast(err.message); }
}

function spfAdmissionPrint(kind) {
  const a = SPF.admission;
  const s = STU_CARD.student;
  const school = STU_CARD.school || {};
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = kind === 'slip'
    ? `${spfLetterhead('Admission Slip')}<table><tbody>
        <tr><td><b>Name</b></td><td>${spfEsc(spfName())}</td></tr><tr><td><b>Adm. / Reg. No.</b></td><td>${spfEsc(s.regNo || s.id)}</td></tr>
        <tr><td><b>Class</b></td><td>${spfEsc([s.classLabel, s.armName].filter(Boolean).join(' - ').toUpperCase())}</td></tr>
        <tr><td><b>Admission Date</b></td><td>${spfEsc(stuDate(s.admissionDate))}</td></tr><tr><td><b>Application Status</b></td><td style="text-transform:capitalize">${spfEsc(a.status)}</td></tr>
      </tbody></table>`
    : `${spfLetterhead('Letter of Admission')}<p>${today}</p>
      <p>Dear Parent / Guardian of <b>${spfEsc(spfName())}</b>,</p>
      <p>We are pleased to offer your ward admission into <b>${spfEsc([s.classLabel, s.armName].filter(Boolean).join(' - ').toUpperCase())}</b> at ${spfEsc(school.name || 'our school')}${s.admissionDate ? `, with effect from <b>${spfEsc(stuDate(s.admissionDate))}</b>` : ''}.
      Your ward's admission / registration number is <b>${spfEsc(s.regNo || s.id)}</b>.</p>
      <p>Please complete the payment of the applicable fees and submit the required documents at the school office.</p>
      <p>Congratulations, and welcome to the ${spfEsc(school.name || 'school')} family.</p>
      <p style="margin-top:48px;">______________________<br>Principal / Head Teacher</p>`;
  spfPrintHtml(kind === 'slip' ? 'Admission Slip' : 'Admission Letter', html);
}

// ── Update Profile ──────────────────────────────────────────────────────
async function spfEdit(body) {
  spfLoading(body);
  let r;
  try {
    const [{ student }] = await Promise.all([apiFetch(`/api/admin/enrol/student/${encodeURIComponent(SPF.id)}`), EN.meta ? Promise.resolve() : enrolLoadMeta()]);
    r = student;
  } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  SPF.record = r;
  EN.photoDataUrl = '';
  const meta = EN.meta;
  const classes = (state.setup?.classes || []).filter(c => !c.archived || c.code === r.classCode);
  const nok = r.nextOfKin || {};
  const em = r.emergency || {};
  const contact = (prefix, c, title) => `<div class="en-sub-head">${title}</div><div class="en-grid">
      ${enField(`${title === 'Next of Kin' ? "Next of Kin's" : "Emergency Contact Person's"} Name`, enCaseInput(`${prefix}-name`, c.name))}
      ${enField('Relationship to Student', enInput(`${prefix}-rel`, c.relationship))}
      ${enrolPhoneField(`${prefix}-phone`, c.phone, `${title === 'Next of Kin' ? "Next of Kin's" : "Emergency Contact Person's"} Phone`)}
      ${enField(`${title === 'Next of Kin' ? "Next of Kin's Contact" : "Emergency Contact Person's"} Email`, enInput(`${prefix}-email`, c.email, 'type="email"'))}
      ${enField(`${title === 'Next of Kin' ? "Next of Kin's" : "Emergency Contact Person's"} Address`, enInput(`${prefix}-address`, c.address), { wide: true })}
    </div>`;
  const s = STU_CARD.student;
  body.innerHTML = `${spfTitle('Update Profile')}
    <h3 class="en-head">SECTION A - Student Parents / Guardian :</h3>
    <div class="en-family-row">
      ${enField('Select Family', `<input class="field-input en-family-search" id="en-family-search" placeholder="Type to search families…" oninput="enrolFilterFamilies()">
        <select class="ctrl-select" id="en-family" onchange="enrolFamilyChanged()"></select>`, { required: true, wide: true })}
      <div class="en-family-btns"><button type="button" class="btn-outline" onclick="familyModalOpen('create')">+ Create Family</button><button type="button" class="btn-outline" id="en-manage-family" onclick="familyModalOpen('manage')">Manage Family</button></div>
    </div>
    <div id="en-family-card"></div>

    <h3 class="en-head">SECTION B - Student Information :</h3>
    <div class="en-photo-row">
      <div class="en-photo" id="en-photo-preview">${r.photoPath ? `<img src="/${spfEsc(r.photoPath)}" alt="">` : '<span>Photo</span>'}</div>
      <div><div class="field-label">Photo</div><label class="btn-outline en-photo-btn">New Photo<input type="file" accept="image/*" hidden onchange="enrolPhotoChosen(this)"></label></div>
    </div>
    <div class="en-grid">
      ${enField('Surname', enCaseInput('en-surname', r.surname), { required: true })}
      ${enField('First Name', enCaseInput('en-first', r.firstName), { required: true })}
      ${enField('Other Names', enCaseInput('en-other', r.otherNames))}
      ${enField('Date of Birth', enInput('en-dob', r.dob, 'type="date"'))}
      ${enField('Gender', `<select class="ctrl-select" id="en-gender">${enrolOptions([['M', 'Male'], ['F', 'Female']], r.gender, 'Select')}</select>`, { required: true })}
      ${enField('Genotype', `<select class="ctrl-select" id="en-genotype">${enrolOptions(ENROL_GENOTYPES, r.genotype, 'Select')}</select>`)}
      ${enField('Blood Group', `<select class="ctrl-select" id="en-blood">${enrolOptions(ENROL_BLOOD_GROUPS, r.bloodGroup, 'Select')}</select>`)}
      ${enrolPhoneField('en-phone', r.phone, 'Contact Phone')}
      ${enField('N.ID / Birth Cert. No.', enInput('en-nin', r.nin))}
      ${enField('Religion', enInput('en-religion', r.religion))}
      ${enField('Nationality', `<select class="ctrl-select" id="en-nationality">${enrolOptions(ENROL_COUNTRIES, r.nationality, '-Select Country -')}</select>`)}
      ${enField('Province/State (of Origin)', enInput('en-state', r.state))}
      ${enField('ZIP/LGA (of Origin)', enInput('en-lga', r.lga))}
      ${enField('Town (of Origin)', enInput('en-town', r.town))}
      ${enField('Permanent / Home Town Address', `<textarea class="field-input" id="en-perm" rows="2">${spfEsc(r.permanentAddress)}</textarea>`, { wide: true })}
      ${enField('Residential / Contact Address', `<textarea class="field-input" id="en-res" rows="2">${spfEsc(r.residentialAddress)}</textarea>`, { wide: true })}
      ${enField('Email', enInput('en-email', r.studentEmail, 'type="email"'), { required: true })}
      ${enField('Tags', `<div class="en-tags" id="en-tags"></div><button type="button" class="en-link" onclick="enrolNewTag()">+ New Tag</button>`)}
      ${enField('Bio / Remark', `<textarea class="field-input" id="en-bio" rows="2">${spfEsc(r.bio)}</textarea>`, { wide: true })}
    </div>
    ${contact('en-nok', nok, 'Next of Kin')}
    ${contact('en-em', em, 'Emergency Contact Person')}

    <h3 class="en-head">SECTION C - Academic Data : <span class="en-hint">for ${spfEsc(String(r.session || '').replace('/', '-'))} (${spfEsc([s.classLabel, s.armName].filter(Boolean).join(' - ').toUpperCase())})</span></h3>
    <div class="en-grid">
      ${enField('Class', `<select class="ctrl-select" id="en-class" onchange="enrolClassChanged()">${enrolOptions(classes.map(c => [c.code, c.label]), r.classCode, 'Select')}</select>`, { required: true })}
      ${enField('Class Arm', '<select class="ctrl-select" id="en-arm"></select>', { required: true })}
      ${enField('Admission Date', enInput('en-admission', r.admissionDate, 'type="date"'))}
      ${enField('Registration No', `${enInput('en-regno', r.regNo)}${enCheck('spf-gen-reg', 'Generate New Registration No.', false, 'spfGenReg(this)')}`)}
      ${enField('Roll No', enInput('en-roll', r.rollNo))}
    </div>
    <div class="spf-actions end"><button class="post-btn" onclick="spfEditSave(this)">Save Changes</button></div>`;
  enrolFilterFamilies(r.familyId);
  enrolClassChanged(r.classArmId);
  enrolRenderTags(r.tags || []);
}

async function spfGenReg(box) {
  const input = document.getElementById('en-regno');
  if (!box.checked) { input.value = SPF.record.regNo || ''; input.readOnly = false; return; }
  try {
    const next = await apiFetch(`/api/admin/enrol/next?${new URLSearchParams({ session: SPF.record.session || '' })}`);
    input.value = next.regNo;
    input.readOnly = true;
  } catch (err) { showToast(err.message); box.checked = false; }
}

async function spfEditSave(btn) {
  const v = id => document.getElementById(id)?.value.trim() || '';
  if (!v('en-family')) return showToast("Select the student's family (or create one)");
  if (!v('en-surname') || !v('en-first')) return showToast('Surname and first name are required');
  if (!v('en-gender')) return showToast('Choose a gender');
  if (!v('en-class')) return showToast('Choose the class');
  const armSel = document.getElementById('en-arm');
  if (!armSel.disabled && !armSel.value) return showToast('Choose the class arm');
  const r = SPF.record;
  const payload = {
    familyId: v('en-family'), surname: v('en-surname'), firstName: v('en-first'), otherNames: v('en-other'), gender: v('en-gender'),
    studentEmail: v('en-email'), password: '', active: STU_CARD.student.active,
    session: r.session, classCode: v('en-class'), classArmId: v('en-arm'),
    tags: [...document.querySelectorAll('#en-tags input:checked')].map(i => Number(i.value)),
    admissionDate: v('en-admission'), regNo: v('en-regno'),
    phone: enrolReadPhone('en-phone'), dob: v('en-dob'), nin: v('en-nin'), religion: v('en-religion'), bloodGroup: v('en-blood'),
    genotype: v('en-genotype'), nationality: v('en-nationality'), state: v('en-state'), lga: v('en-lga'), town: v('en-town'),
    residentialAddress: v('en-res'), permanentAddress: v('en-perm'), bio: v('en-bio'), rollNo: v('en-roll'),
    nextOfKin: enrolContact('en-nok'), emergency: enrolContact('en-em'), photoDataUrl: EN.photoDataUrl,
  };
  btn.disabled = true;
  try {
    const data = await apiFetch(`/api/admin/enrol/student/${encodeURIComponent(SPF.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    state.setup = data.setup;
    EN.photoDataUrl = '';
    if (typeof populateStudents === 'function') populateStudents();
    if (typeof populateDashboard === 'function') populateDashboard();
    showToast('Profile updated');
    SPF.tab = 'profile';
    await spfReload();
  } catch (err) { showToast(err.message); } finally { btn.disabled = false; }
}

// ── Password / PIN ──────────────────────────────────────────────────────
const spfSecret = (id, label) => enField(label, `<div class="en-pass-wrap"><input class="field-input" id="${id}" type="password" autocomplete="new-password"><button type="button" class="en-case-btn" onclick="enrolShowHide('${id}', this)">Show</button></div>`, { required: true });

function spfPassword(body) {
  body.innerHTML = `${spfTitle("Update User's Account Password")}
    <div class="spf-narrow">${spfSecret('spf-pass1', 'New Password')}${spfSecret('spf-pass2', 'Confirm New Password')}
      <div class="spf-actions"><button class="post-btn" onclick="spfSecretSave('password', this)">Update Password</button></div>
      <div class="spf-note">This is a temporary password (at least 6 characters). The pupil is signed out everywhere, and must choose their own new password the next time they sign in.</div></div>`;
}

async function spfPin(body) {
  spfLoading(body);
  let hasPin = false;
  try { hasPin = (await apiFetch(`/api/admin/view-students/pin?id=${encodeURIComponent(SPF.id)}`)).hasPin; } catch {}
  body.innerHTML = `${spfTitle('Update Pin', `<span class="sr-pill ${hasPin ? 'accepted' : 'pending'}">${hasPin ? 'PIN is set' : 'No PIN set yet'}</span>`)}
    <div class="spf-narrow">${spfSecret('spf-pass1', 'New Pin')}${spfSecret('spf-pass2', 'Confirm New Pin')}
      <div class="en-hint">4 to 6 digits</div>
      <div class="spf-actions"><button class="post-btn" onclick="spfSecretSave('pin', this)">Update Pin</button><button class="btn-outline" onclick="spfTab('pin')">Start over</button>
        ${hasPin ? '<button class="btn-danger" onclick="spfPinReset()">Remove PIN</button>' : ''}</div></div>`;
  document.querySelectorAll('#spf-pass1, #spf-pass2').forEach(i => { i.inputMode = 'numeric'; i.maxLength = 6; });
}

async function spfSecretSave(kind, btn) {
  const value = document.getElementById('spf-pass1').value;
  const confirm = document.getElementById('spf-pass2').value;
  if (!value) return showToast(kind === 'pin' ? 'Enter the new PIN' : 'Enter the new password');
  if (value !== confirm) return showToast('The two entries do not match');
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/view-students/${kind}`, { method: 'POST', body: JSON.stringify({ id: SPF.id, value, confirm }) });
    showToast(kind === 'pin' ? 'PIN updated' : 'Password updated');
    spfTab(kind);
  } catch (err) { showToast(err.message); btn.disabled = false; }
}

async function spfPinReset() {
  if (!confirm("Remove this pupil's PIN?")) return;
  try { await apiFetch('/api/admin/view-students/pin/reset', { method: 'POST', body: JSON.stringify({ id: SPF.id }) }); showToast('PIN removed'); spfTab('pin'); } catch (err) { showToast(err.message); }
}

// ── Hostel ──────────────────────────────────────────────────────────────
async function spfHostel(body) {
  spfLoading(body);
  let data;
  try { data = await apiFetch(`/api/admin/view-students/hostel?id=${encodeURIComponent(SPF.id)}`); } catch (err) { body.innerHTML = `<div class="sr-empty">${spfEsc(err.message)}</div>`; return; }
  SPF.hostel = data;
  const current = data.allocations.find(a => a.status === 'allocated');
  body.innerHTML = `${spfTitle('Hostel Application / Allocation Details')}
    ${current ? `<table class="stu-info"><tbody><tr><td>Current Hostel / House</td><td><strong>${spfEsc(current.hostel)}</strong></td></tr><tr><td>Room</td><td>${spfEsc(current.room || '—')}</td></tr><tr><td>Bed Space</td><td>${spfEsc(current.bed || '—')}</td></tr><tr><td>Session</td><td>${spfEsc(String(current.session).replace('/', '-'))}</td></tr></tbody></table>`
      : '<div class="sr-empty spf-left">No hostel allocation for this student</div>'}
    <div class="spf-sub-head" id="spf-hostel-form-head">New Application / Allocation</div>
    <input type="hidden" id="spf-h-id">
    <datalist id="spf-h-list">${data.hostels.map(h => `<option value="${spfEsc(h)}">`).join('')}</datalist>
    <div class="spf-filters four">
      ${enField('Session', `<input class="field-input" id="spf-h-session" value="${spfEsc(data.session)}">`, { required: true })}
      ${enField('Hostel / House', '<input class="field-input" id="spf-h-hostel" list="spf-h-list" placeholder="e.g. Blue House">', { required: true })}
      ${enField('Room', '<input class="field-input" id="spf-h-room">')}
      ${enField('Bed Space', '<input class="field-input" id="spf-h-bed">')}
      ${enField('Status', '<select class="ctrl-select" id="spf-h-status"><option value="allocated">Allocated</option><option value="applied">Applied (awaiting allocation)</option><option value="vacated">Vacated</option></select>')}
      ${enField('Note', '<input class="field-input" id="spf-h-note">', { wide: true })}
    </div>
    <div class="spf-actions"><button class="post-btn btn-sm" onclick="spfHostelSave(this)">Save</button><button class="btn-outline btn-sm" onclick="spfTab('hostel')">Clear</button></div>
    <div class="spf-sub-head">Hostel History</div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>Session</th><th>Hostel / House</th><th>Room</th><th>Bed</th><th>Status</th><th>Note</th><th>Recorded</th><th></th></tr></thead><tbody>
      ${data.allocations.length ? data.allocations.map(a => `<tr><td>${spfEsc(String(a.session).replace('/', '-'))}</td><td>${spfEsc(a.hostel)}</td><td>${spfEsc(a.room || '')}</td><td>${spfEsc(a.bed || '')}</td>
        <td><span class="sr-pill ${a.status === 'allocated' ? 'accepted' : a.status === 'applied' ? 'pending' : 'bypassed'}" style="text-transform:capitalize">${spfEsc(a.status)}</span></td><td>${spfEsc(a.note || '')}</td>
        <td>${spfEsc(feeFmtDate(a.recordedAt))}${a.recordedBy ? `<div class="en-hint">${spfEsc(a.recordedBy)}</div>` : ''}</td>
        <td class="spf-row-btns"><button class="btn-outline btn-sm" onclick="spfHostelEdit(${a.id})">Edit</button><button class="btn-danger btn-sm" onclick="spfHostelDelete(${a.id})">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="8" class="sr-empty">No hostel records yet</td></tr>'}
    </tbody></table></div>`;
}

function spfHostelEdit(hid) {
  const a = SPF.hostel.allocations.find(x => x.id === hid);
  if (!a) return;
  document.getElementById('spf-h-id').value = a.id;
  document.getElementById('spf-h-session').value = a.session;
  document.getElementById('spf-h-hostel').value = a.hostel;
  document.getElementById('spf-h-room').value = a.room || '';
  document.getElementById('spf-h-bed').value = a.bed || '';
  document.getElementById('spf-h-status').value = a.status;
  document.getElementById('spf-h-note').value = a.note || '';
  const head = document.getElementById('spf-hostel-form-head');
  head.textContent = 'Edit Hostel Record';
  head.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function spfHostelSave(btn) {
  const v = id => document.getElementById(id).value.trim();
  if (!v('spf-h-hostel')) return showToast('Enter the hostel / house name');
  btn.disabled = true;
  try {
    await apiFetch('/api/admin/view-students/hostel', { method: 'POST', body: JSON.stringify({
      id: SPF.id, hid: v('spf-h-id') || null, session: v('spf-h-session'), hostel: v('spf-h-hostel'), room: v('spf-h-room'), bed: v('spf-h-bed'), status: v('spf-h-status'), note: v('spf-h-note'),
    }) });
    showToast('Hostel record saved');
    spfTab('hostel');
  } catch (err) { showToast(err.message); btn.disabled = false; }
}

async function spfHostelDelete(hid) {
  if (!confirm('Delete this hostel record?')) return;
  try { await apiFetch(`/api/admin/view-students/hostel?hid=${hid}`, { method: 'DELETE' }); showToast('Hostel record deleted'); spfTab('hostel'); } catch (err) { showToast(err.message); }
}
