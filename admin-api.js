const state = {
  user: null,
  setup: null,
  editingStudentId: null,
  pendingDeleteStudentId: null,
  editingStaffId: null,
  editingAssignmentId: null,
  staffFilter: 'All Staff',
  gradebookBatch: null,
  cognitiveRatings: {},
  cognitiveStudentId: null,
  cognitiveExamType: 'Mid-Term Exam',
};

const DEFAULT_STUDENT_PASSWORD = '1234';
const SKILL_GROUPS = [
  {
    key: 'affective',
    title: 'Affective Skills Rating',
    skills: [
      ['punctuality', 'Punctuality'],
      ['attentiveness', 'Attentiveness'],
      ['neatness', 'Neatness'],
      ['honesty', 'Honesty'],
      ['politeness', 'Politeness'],
      ['perseverance', 'Perseverance'],
      ['relationshipWithOthers', 'Relationship with Others'],
      ['organizationAbility', 'Organization Ability'],
    ],
  },
  {
    key: 'psychomotor',
    title: 'Psychomotor Skills Rating',
    skills: [
      ['handWriting', 'Hand Writing'],
      ['drawingAndPainting', 'Drawing and Painting'],
      ['speechVerbalFluency', 'Speech / Verbal Fluency'],
      ['quantitativeReasoning', 'Quantitative Reasoning'],
      ['processingSpeed', 'Processing Speed'],
      ['retentiveness', 'Retentiveness'],
      ['visualMemory', 'Visual Memory'],
      ['publicSpeaking', 'Public Speaking'],
      ['sportsAndGames', 'Sports and Games'],
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401) {
    window.location.replace('index.html');
    throw new Error('Authentication required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function scoreToGrade(s) {
  s = parseInt(s, 10);
  if (s >= 80) return 'A';
  if (s >= 75) return 'A-';
  if (s >= 70) return 'B+';
  if (s >= 65) return 'B';
  if (s >= 60) return 'B-';
  if (s >= 55) return 'C+';
  if (s >= 50) return 'C';
  if (s >= 40) return 'D';
  return 'F';
}

function gradeClass(avg) {
  if (avg >= 80) return 'gp-a';
  if (avg >= 65) return 'gp-b';
  if (avg >= 50) return 'gp-c';
  return 'gp-d';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.style.display = 'none', 3000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function nowDateString() {
  const d = new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function priorityColor(p) {
  if (p === 'urgent') return 'var(--red)';
  if (p === 'important') return 'var(--amber)';
  return 'var(--green)';
}

function fileToDataUrl(inputId) {
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

let announcements = [
  { id: Date.now() + 1, title: 'Results Submission Deadline', body: 'All teachers must submit Term 2 results by Friday 30 May 2026. Contact the Registrar if you need an extension.', date: '13 MAY 2026', priority: 'urgent' },
  { id: Date.now() + 2, title: 'Inter-School Sports Day', body: 'All staff required on duty on Friday 17 May. PE teachers to report by 7:00 AM.', date: '12 MAY 2026', priority: 'important' },
  { id: Date.now() + 3, title: 'Staff Development Meeting', body: 'Mandatory professional development session: Saturday 24 May, 9 AM - 12 PM in the Assembly Hall.', date: '11 MAY 2026', priority: 'normal' },
  { id: Date.now() + 4, title: 'Mid-Term Break Notice', body: 'School closes Friday 23 May. Staff to use break for marking and report preparation. Resumes Monday 2 June.', date: '10 MAY 2026', priority: 'normal' },
];

async function init() {
  try {
    const session = await apiFetch('/api/session');
    if (session.user.role !== 'admin') {
      window.location.replace('index.html');
      return;
    }
    state.user = session.user;
    document.getElementById('a-avatar').textContent = state.user.initials;
    document.getElementById('a-name').textContent = state.user.name;
    document.getElementById('a-greeting').textContent = `${greeting()}, ${state.user.firstName}.`;
    document.title = `Unique Children's School - ${state.user.name}`;

    await loadResultSetup();
    loadGradeScaleFromServer();
    loadTopbarSession();
    populateDashboard();
    populateStudents();
    populateParents();
    clearStudentForm();
    populateStaff();
    renderAnnouncements();
    bootstrapBroadsheetFocusMode();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadTopbarSession() {
  try {
    const data = await apiFetch('/api/admin/academic-sessions');
    const active = (data.sessions || []).find(s => s.isActive);
    if (!active) return;
    var el = document.getElementById('tsi-session');
    var el2 = document.getElementById('tsi-term');
    var box = document.getElementById('topbar-session-info');
    if (el) el.textContent = active.sessionLabel || '—';
    if (el2) el2.textContent = active.termLabel || '—';
    if (box) box.style.display = 'flex';
  } catch(e) {}
}

async function loadResultSetup() {
  state.setup = await apiFetch('/api/admin/result-setup');
  populateAdminControls();
  populateGradebookControls();
  populateCognitiveControls();
  renderAssignments();
  renderPublications();
  renderEmailConfigStatus();
  renderEmailQueue();
  populateClasses();
  populateSubjects();
}

function fmtRelativeDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function renderPdChart(containerId, items, color) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:20px;">No data yet.</div>'; return; }
  const max = Math.max(1, ...items.map(i => Number(i.value) || 0));
  el.innerHTML = `<div class="pd-chart" style="min-width:${Math.max(items.length * 42, 260)}px;">` + items.map(i => `
    <div class="pd-col">
      <span class="pd-val">${i.value}</span>
      <div class="pd-bar-wrap"><div class="pd-bar-fill" style="height:${Math.round((Number(i.value) || 0) / max * 100)}%;background:${color};"></div></div>
      <span class="pd-lbl">${escapeHtml(i.label)}</span>
    </div>`).join('') + `</div>`;
}

function renderFinanceTrend(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:20px;">No income or expense records yet.</div>'; return; }
  const W = Math.max(600, rows.length * 50), H = 180, padL = 44, padB = 24, padT = 10;
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.income, r.expenses)));
  const stepX = rows.length > 1 ? (W - padL - 15) / (rows.length - 1) : 0;
  const scaleY = v => H - padB - (v / maxVal) * (H - padB - padT);
  const pointsFor = key => rows.map((r, i) => `${padL + i * stepX},${scaleY(r[key])}`).join(' ');
  const monthLbl = m => {
    const [y, mo] = String(m).split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };
  const labels = rows.map((r, i) => `<text x="${padL + i * stepX}" y="${H - 6}" font-size="8" fill="var(--text-3)" text-anchor="middle">${monthLbl(r.month)}</text>`).join('');
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">
      <line x1="${padL}" y1="${H - padB}" x2="${W - 5}" y2="${H - padB}" stroke="var(--border)" stroke-width="1"/>
      <polyline points="${pointsFor('income')}" fill="none" stroke="var(--green)" stroke-width="2"/>
      <polyline points="${pointsFor('expenses')}" fill="none" stroke="var(--red)" stroke-width="2"/>
      ${labels}
    </svg>
    <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--text-2);">
      <span><span style="display:inline-block;width:9px;height:9px;background:var(--green);border-radius:2px;margin-right:5px;"></span>Income</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:var(--red);border-radius:2px;margin-right:5px;"></span>Expenditure</span>
    </div>`;
}

function renderFeesSummary(containerId, data) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const s = (data && data.summary) || { totalInvoiced: 0, totalPaid: 0, totalBalance: 0 };
  const total = s.totalInvoiced || 0;
  const paidPct = total ? Math.round((s.totalPaid / total) * 100) : 0;
  const duePct = total ? 100 - paidPct : 0;
  el.innerHTML = `
    <div class="fees-track"><div class="fees-fill-paid" style="width:${paidPct}%;"></div><div class="fees-fill-due" style="width:${duePct}%;"></div></div>
    <div class="fees-legend-row"><span class="perf-key">Total Invoiced</span><span class="perf-val">${fmtNaira(total)}</span></div>
    <div class="fees-legend-row"><span class="perf-key">Paid (${paidPct}%)</span><span class="perf-val pv-green">${fmtNaira(s.totalPaid)}</span></div>
    <div class="fees-legend-row"><span class="perf-key">Due (${duePct}%)</span><span class="perf-val pv-red">${fmtNaira(s.totalBalance)}</span></div>`;
}

async function populateDashboard() {
  const setup = state.setup || {};
  const academic = setup.academic || {};
  const students = setup.students || [];
  const staff = setup.staff || [];
  const classes = setup.classes || [];

  const sub = document.getElementById('a-greeting-sub');
  if (sub) {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    sub.textContent = `School overview · ${[academic.sessionLabel, academic.termLabel].filter(Boolean).join(', ')} · ${today}`;
  }

  // ── People ──
  const parentEmails = new Set(students.map(s => (s.parentEmail || '').toLowerCase()).filter(Boolean));
  document.getElementById('d-students').textContent = students.length;
  document.getElementById('d-staff').textContent = staff.length;
  document.getElementById('d-parents').textContent = parentEmails.size;
  document.getElementById('d-active-classes').textContent = classes.filter(c => (c.studentCount || 0) > 0).length;

  // ── Population distribution ──
  renderPdChart('d-pop-classes', classes.map(c => ({ label: c.label, value: c.studentCount || 0 })), 'var(--blue)');
  const catMap = new Map();
  classes.forEach(c => {
    const cat = c.category || 'Uncategorized';
    catMap.set(cat, (catMap.get(cat) || 0) + (c.studentCount || 0));
  });
  renderPdChart('d-pop-categories', [...catMap.entries()].map(([label, value]) => ({ label, value })), 'var(--cyan)');

  // ── Staff breakdown ──
  const academicStaffCount = staff.filter(s => s.role === 'teacher').length;
  const adminStaffCount = staff.filter(s => s.role === 'admin').length;
  document.getElementById('d-staff-breakdown').innerHTML = `
    <div class="perf-row"><span class="perf-key">Academic Staff</span><span class="perf-val">${academicStaffCount}</span></div>
    <div class="perf-row"><span class="perf-key">Admin Staff</span><span class="perf-val">${adminStaffCount}</span></div>
    <div class="perf-row"><span class="perf-key">Total Staff</span><span class="perf-val pv-green">${staff.length}</span></div>`;

  // ── Recent activity (from real saved result batches) ──
  const batches = [...(setup.resultBatches || [])]
    .sort((a, b) => String(b.savedAtIso || '').localeCompare(String(a.savedAtIso || '')))
    .slice(0, 6);
  document.getElementById('d-activity').innerHTML = batches.length
    ? batches.map(b => `<div class="activity-item"><span class="act-dot" style="background:var(--green);"></span><div><div class="act-text"><strong>${escapeHtml(b.teacherName)}</strong> saved ${escapeHtml(b.examType)} results for ${escapeHtml(b.classLabel)} — ${escapeHtml(b.subjectName)}</div><div class="act-time">${escapeHtml(fmtRelativeDateTime(b.savedAtIso))}</div></div></div>`).join('')
    : '<div style="color:var(--text-3);font-size:12px;">No recent activity recorded yet.</div>';

  // ── School-wide performance + attendance by grade (real, per-class) ──
  const classCounts = new Map();
  students.forEach(student => {
    classCounts.set(student.classCode, (classCounts.get(student.classCode) || 0) + 1);
  });
  const classData = classes.map(cls => {
    const clsStudents = students.filter(student => student.classCode === cls.code);
    const avg = clsStudents.length ? Math.round(clsStudents.reduce((sum, student) => sum + Number(student.avg || 0), 0) / clsStudents.length) : 0;
    const att = clsStudents.length ? Math.round(clsStudents.reduce((sum, student) => sum + Number(student.att || 0), 0) / clsStudents.length) : 0;
    return { name: cls.label, avg, students: classCounts.get(cls.code) || 0, att };
  });
  const colors = ['var(--green)', 'var(--blue)', 'var(--cyan)', 'var(--amber)'];
  document.getElementById('d-class-perf').innerHTML = classData.map((c, i) => `
    <div style="margin-bottom:13px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;">${escapeHtml(c.name)}</span>
        <span style="font-size:12px;font-family:'DM Mono',monospace;font-weight:700;color:${colors[i % colors.length]};">${c.avg}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${c.avg}%;background:${colors[i % colors.length]};"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;"><span>${c.students} students</span><span>Att: ${c.att}%</span></div>
    </div>`).join('');

  document.getElementById('d-attendance').innerHTML = classData.map(c => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="font-size:11px;color:var(--text-2);width:55px;">${escapeHtml(c.name)}</span>
      <div style="flex:1;height:5px;background:var(--black-4);border-radius:99px;overflow:hidden;"><div style="width:${c.att}%;height:100%;background:${c.att >= 92 ? 'var(--green)' : c.att >= 85 ? 'var(--amber)' : 'var(--red)'};border-radius:99px;"></div></div>
      <span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;width:34px;text-align:right;">${c.att}%</span>
    </div>`).join('');

  // ── Finance (async) ──
  try {
    const fin = await apiFetch('/api/admin/finance/analytics');
    const fmtWhole = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
    document.getElementById('fin-received-today').textContent = fmtWhole(fin.today.income);
    document.getElementById('fin-spent-today').textContent = fmtWhole(fin.today.expenses);
    document.getElementById('fin-received-30d').textContent = fmtWhole(fin.last30Days.income);
    document.getElementById('fin-spent-30d').textContent = fmtWhole(fin.last30Days.expenses);
    renderFinanceTrend('d-finance-trend', fin.monthlyTrend || []);
  } catch (e) {}

  // ── Fees summary (async) ──
  try {
    const feesData = await apiFetch(`/api/admin/fees/invoices${academic.id ? `?academicId=${academic.id}` : ''}`);
    renderFeesSummary('d-fees-summary', feesData);
  } catch (e) {}
}

function populateStudents() {
  const tbody = document.getElementById('stu-tbody');
  const all = [...(state.setup.students || [])].sort((a, b) => Number(b.avg) - Number(a.avg));
  tbody.innerHTML = '';
  document.getElementById('stu-count-label').textContent = `Student Directory - ${all.length} records`;
  all.forEach(student => {
    const grade = scoreToGrade(student.avg);
    const tr = document.createElement('tr');
    tr.dataset.name = student.name.toLowerCase();
    tr.dataset.id = student.id.toLowerCase();
    tr.innerHTML = `
      <td>${student.photoPath ? `<img class="stu-av-photo" src="/${escapeHtml(student.photoPath)}" alt="">` : `<span class="stu-av">${escapeHtml(student.initials)}</span>`}<strong>${escapeHtml(student.name)}</strong></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-3);">${escapeHtml(student.id)}</td>
      <td style="color:var(--text-2);">Class ${escapeHtml(student.classCode)}</td>
      <td style="color:var(--text-3);">${student.gender === 'F' ? 'Female' : 'Male'}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:700;">${student.avg}%</td>
      <td><span class="grade-pill ${gradeClass(student.avg)}">${grade}</span></td>
      <td><div class="att-bar"><div class="att-track"><div class="att-fill" style="width:${student.att}%;background:${student.att >= 90 ? 'var(--green)' : student.att >= 75 ? 'var(--amber)' : 'var(--red)'};"></div></div><span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${student.att}%</span></div></td>
      <td style="color:var(--text-3);font-size:12px;">${escapeHtml(student.parentEmail || '-')}</td>
      <td>${accountStatusToggle(student.id, student.active)}</td>
      <td><button class="post-btn" style="padding:6px 10px;" onclick="editStudent('${escapeHtml(student.id)}')">Edit</button></td>`;
    tbody.appendChild(tr);
  });
}

function filterStudents() {
  const q = document.getElementById('stu-search').value.toLowerCase();
  document.querySelectorAll('#stu-tbody tr').forEach(tr => {
    tr.style.display = (tr.dataset.name.includes(q) || tr.dataset.id.includes(q)) ? '' : 'none';
  });
}

// ── STUDENT TAGS ──

let stTagsCache = [];
let stCurrentTagId = null;

async function stInit() {
  document.getElementById('st-detail-card').style.display = 'none';
  stLoad();
}

async function stLoad() {
  const tbody = document.getElementById('st-tbody');
  try {
    const data = await apiFetch('/api/admin/student-tags');
    stTagsCache = data.tags || [];
    tbody.innerHTML = stTagsCache.length ? stTagsCache.map(t => `
      <tr>
        <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(t.color || '#2563eb')};display:inline-block;"></span><a href="javascript:void(0)" onclick="stOpenDetail(${t.id})">${escapeHtml(t.name)}</a></span></td>
        <td>${t.studentCount}</td>
        <td>${escapeHtml((t.createdAt || '').slice(0, 10))}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="stDeleteTag(${t.id})">Delete</button></td>
      </tr>
    `).join('') : '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No tags yet</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function stOpenNewTag() {
  document.getElementById('stn-name').value = '';
  document.getElementById('stn-color').value = '#2563eb';
  document.getElementById('st-new-modal').style.display = 'flex';
}
function stCloseNewTag() { document.getElementById('st-new-modal').style.display = 'none'; }
async function stSubmitNewTag() {
  const name = document.getElementById('stn-name').value.trim();
  const color = document.getElementById('stn-color').value;
  if (!name) { showToast('Tag name is required'); return; }
  try {
    await apiFetch('/api/admin/student-tags', { method: 'POST', body: JSON.stringify({ name, color }) });
    showToast('Tag created');
    stCloseNewTag();
    stLoad();
  } catch (err) { showToast(err.message); }
}
async function stDeleteTag(id) {
  if (!confirm('Delete this tag? Students will be unassigned from it.')) return;
  try {
    await apiFetch(`/api/admin/student-tags/${id}`, { method: 'DELETE' });
    showToast('Tag deleted');
    stLoad();
  } catch (err) { showToast(err.message); }
}

async function stOpenDetail(id) {
  stCurrentTagId = id;
  try {
    const data = await apiFetch(`/api/admin/student-tags/${id}`);
    const tag = data.tag;
    document.getElementById('st-detail-title').textContent = tag.name;
    document.getElementById('st-detail-card').style.display = 'block';
    const assignedIds = new Set(tag.students.map(s => s.id));
    const addSel = document.getElementById('st-add-student');
    addSel.innerHTML = '<option value="">Select a student</option>' +
      (state.setup.students || []).filter(s => !assignedIds.has(s.id)).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.classCode)})</option>`).join('');
    const tbody = document.getElementById('st-detail-tbody');
    tbody.innerHTML = tag.students.length ? tag.students.map(s => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.classLabel || s.classCode)}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="stUnassignStudent('${escapeHtml(s.id)}')">Remove</button></td>
      </tr>
    `).join('') : '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--text-3)">No students tagged yet</td></tr>';
  } catch (err) { showToast(err.message); }
}
function stCloseDetail() {
  stCurrentTagId = null;
  document.getElementById('st-detail-card').style.display = 'none';
}
async function stAssignStudent() {
  const studentId = document.getElementById('st-add-student').value;
  if (!studentId) { showToast('Select a student'); return; }
  try {
    await apiFetch(`/api/admin/student-tags/${stCurrentTagId}/students`, { method: 'POST', body: JSON.stringify({ studentId }) });
    stOpenDetail(stCurrentTagId);
    stLoad();
  } catch (err) { showToast(err.message); }
}
async function stUnassignStudent(studentId) {
  try {
    await apiFetch(`/api/admin/student-tags/${stCurrentTagId}/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
    stOpenDetail(stCurrentTagId);
    stLoad();
  } catch (err) { showToast(err.message); }
}

// ── CLASS ALLOCATION / TRANSFER / GRADUATION ──

function caInit() {
  if (!state.setup) return;
  const fromSel = document.getElementById('ca-from-class');
  const toSel = document.getElementById('ca-to-class');
  // "From" can be an archived class too (so any students still sitting in a
  // retired class can be moved out of it); "To" only ever offers active
  // classes, so nobody can be promoted/transferred into a hidden class.
  const allOptions = (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}${c.archived ? ' (Archived)' : ''}</option>`).join('');
  const activeOptions = (state.setup.classes || []).filter(c => !c.archived).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  fromSel.innerHTML = '<option value="">Select Class</option>' + allOptions;
  toSel.innerHTML = '<option value="">Select Class</option>' + activeOptions;
  document.getElementById('ca-students-list').innerHTML = '<span style="font-size:12px;color:var(--text-3);">Select a class to load students.</span>';
  caLoadStatusList();
}

async function caLoadStudents() {
  const classCode = document.getElementById('ca-from-class').value;
  const wrap = document.getElementById('ca-students-list');
  if (!classCode) { wrap.innerHTML = '<span style="font-size:12px;color:var(--text-3);">Select a class to load students.</span>'; return; }
  wrap.innerHTML = '<span style="font-size:12px;color:var(--text-3);">Loading…</span>';
  try {
    const data = await apiFetch(`/api/admin/students/by-class?classCode=${encodeURIComponent(classCode)}&status=active`);
    const students = data.students || [];
    wrap.innerHTML = students.length ? students.map(s => `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;"><input type="checkbox" class="ca-student-check" value="${escapeHtml(s.id)}"> ${escapeHtml(s.name)} <span style="color:var(--text-3);">(${escapeHtml(s.id)})</span></label>
    `).join('') : '<span style="font-size:12px;color:var(--text-3);">No active students in this class.</span>';
  } catch (err) { wrap.innerHTML = `<span style="font-size:12px;color:var(--red);">${escapeHtml(err.message)}</span>`; }
}

function caToggleAll(box) {
  document.querySelectorAll('.ca-student-check').forEach(cb => cb.checked = box.checked);
}
function caSelectedIds() {
  return [...document.querySelectorAll('.ca-student-check:checked')].map(cb => cb.value);
}

async function caPromote() {
  const toClassCode = document.getElementById('ca-to-class').value;
  const studentIds = caSelectedIds();
  if (!toClassCode) { showToast('Select a destination class'); return; }
  if (!studentIds.length) { showToast('Select at least one student'); return; }
  if (!confirm(`Move ${studentIds.length} student(s) to the selected class?`)) return;
  try {
    const data = await apiFetch('/api/admin/students/promote', { method: 'POST', body: JSON.stringify({ toClassCode, studentIds }) });
    showToast(`${data.moved} student(s) moved`);
    await loadResultSetup();
    caLoadStudents();
  } catch (err) { showToast(err.message); }
}

async function caGraduate(status) {
  const studentIds = caSelectedIds();
  if (!studentIds.length) { showToast('Select at least one student'); return; }
  const label = status === 'left' ? 'mark as left' : 'graduate';
  if (!confirm(`Are you sure you want to ${label} ${studentIds.length} student(s)? Their portal login will be deactivated.`)) return;
  try {
    await apiFetch('/api/admin/students/graduate', { method: 'POST', body: JSON.stringify({ studentIds, status }) });
    showToast(`${studentIds.length} student(s) updated`);
    await loadResultSetup();
    caLoadStudents();
    caLoadStatusList();
  } catch (err) { showToast(err.message); }
}

async function caLoadStatusList() {
  const status = document.getElementById('ca-status-filter').value;
  const tbody = document.getElementById('ca-status-tbody');
  tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const data = await apiFetch(`/api/admin/students/by-status?status=${status}`);
    const rows = data.students || [];
    tbody.innerHTML = rows.length ? rows.map(s => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.classLabel || s.classCode || '—')}</td>
        <td style="text-transform:capitalize;">${escapeHtml(s.status)}</td>
        <td><button class="post-btn" style="padding:4px 10px;font-size:11px;" onclick="caOpenReinstate('${escapeHtml(s.id)}')">Reinstate</button></td>
      </tr>
    `).join('') : `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No ${escapeHtml(status)} students</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function caOpenReinstate(studentId) {
  document.getElementById('car-student-id').value = studentId;
  const classSel = document.getElementById('car-class');
  classSel.innerHTML = '<option value="">Select Class</option>' +
    (state.setup.classes || []).filter(c => !c.archived).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  document.getElementById('ca-reinstate-modal').style.display = 'flex';
}
function caCloseReinstate() { document.getElementById('ca-reinstate-modal').style.display = 'none'; }
async function caSubmitReinstate() {
  const studentId = document.getElementById('car-student-id').value;
  const classCode = document.getElementById('car-class').value;
  if (!classCode) { showToast('Select a class'); return; }
  try {
    await apiFetch('/api/admin/students/reinstate', { method: 'POST', body: JSON.stringify({ studentIds: [studentId], classCode }) });
    showToast('Student reinstated');
    caCloseReinstate();
    await loadResultSetup();
    caLoadStatusList();
  } catch (err) { showToast(err.message); }
}

// ── ENROLLMENT HISTORY ──

function ehInit() {
  if (!state.setup) return;
  const sel = document.getElementById('eh-class');
  sel.innerHTML = '<option value="">All Classes</option>' + (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  ehLoad();
}
async function ehLoad() {
  const classCode = document.getElementById('eh-class').value;
  const tbody = document.getElementById('eh-tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const params = new URLSearchParams();
    if (classCode) params.set('classCode', classCode);
    const data = await apiFetch(`/api/admin/students/enrollment-history?${params.toString()}`);
    const rows = data.students || [];
    tbody.innerHTML = rows.length ? rows.map(s => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.gender === 'F' ? 'Female' : 'Male'}</td>
        <td>${escapeHtml(s.classLabel || s.classCode)}</td>
        <td style="text-transform:capitalize;">${escapeHtml(s.status)}</td>
        <td>${s.enrolledAt ? escapeHtml(s.enrolledAt.slice(0, 10)) : '<span style="color:var(--text-3);">Unknown</span>'}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3)">No students found</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ── STUDENTS REGISTRY ──

let srCache = [];

function srInit() {
  if (!state.setup) return;
  const sel = document.getElementById('sr-class');
  sel.innerHTML = '<option value="">All Classes</option>' + (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  srLoad();
}
async function srLoad() {
  const classCode = document.getElementById('sr-class').value;
  const status = document.getElementById('sr-status').value;
  const tbody = document.getElementById('sr-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ status });
    if (classCode) params.set('classCode', classCode);
    const data = await apiFetch(`/api/admin/students/registry?${params.toString()}`);
    srCache = data.students || [];
    tbody.innerHTML = srCache.length ? srCache.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.regNo)}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.gender === 'F' ? 'Female' : 'Male'}</td>
        <td>${escapeHtml(s.classLabel || s.classCode)}</td>
        <td>${escapeHtml(s.parentEmail || '—')}</td>
        <td>${s.enrolledAt ? escapeHtml(s.enrolledAt.slice(0, 10)) : '—'}</td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--text-3)">No students found</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}
function srPrint() {
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>Students Registry</title></head><body>${document.getElementById('sr-table').outerHTML}</body></html>`);
  win.document.close();
  win.print();
}
function srExportCsv() {
  const headers = ['#', 'Reg No', 'Name', 'Gender', 'Class', 'Parent Email', 'Enrolled'];
  const rows = srCache.map((s, i) => [i + 1, s.regNo, s.name, s.gender === 'F' ? 'Female' : 'Male', s.classLabel || s.classCode, s.parentEmail || '', s.enrolledAt ? s.enrolledAt.slice(0, 10) : '']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'students-registry.csv';
  a.click();
}

// ── COMMUNICATION BOOK ──

function cbkInit() {
  if (!state.setup) return;
  const classSel = document.getElementById('cbk-class');
  classSel.innerHTML = '<option value="">All Classes</option>' + (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  document.getElementById('cbk-student').innerHTML = '<option value="">All Students</option>' +
    (state.setup.students || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  cbkLoad();
}
function cbkOnClassChange() {
  const classCode = document.getElementById('cbk-class').value;
  const studentSel = document.getElementById('cbk-student');
  const students = (state.setup.students || []).filter(s => !classCode || s.classCode === classCode);
  studentSel.innerHTML = '<option value="">All Students</option>' + students.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  cbkLoad();
}
async function cbkLoad() {
  const studentId = document.getElementById('cbk-student').value;
  const classCode = document.getElementById('cbk-class').value;
  const tbody = document.getElementById('cbk-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const params = new URLSearchParams();
    if (studentId) params.set('studentId', studentId);
    if (classCode) params.set('classCode', classCode);
    const data = await apiFetch(`/api/admin/communication-book?${params.toString()}`);
    const rows = data.entries || [];
    tbody.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td>${escapeHtml((r.createdAt || '').slice(0, 10))}</td>
        <td>${escapeHtml(r.studentName)}</td>
        <td>${escapeHtml(r.category || '—')}</td>
        <td style="max-width:320px;white-space:normal;">${escapeHtml(r.message)}</td>
        <td>${escapeHtml(r.addedBy || '—')}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="cbkDelete(${r.id})">Delete</button></td>
      </tr>
    `).join('') : '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-3)">No entries found</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}
function cbkOpenNew() {
  const sel = document.getElementById('cbkn-student');
  sel.innerHTML = (state.setup.students || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.classCode)})</option>`).join('');
  document.getElementById('cbkn-category').value = '';
  document.getElementById('cbkn-message').value = '';
  document.getElementById('cbk-new-modal').style.display = 'flex';
}
function cbkCloseNew() { document.getElementById('cbk-new-modal').style.display = 'none'; }
async function cbkSubmitNew() {
  const studentId = document.getElementById('cbkn-student').value;
  const category = document.getElementById('cbkn-category').value.trim();
  const message = document.getElementById('cbkn-message').value.trim();
  if (!studentId || !message) { showToast('Student and message are required'); return; }
  try {
    await apiFetch('/api/admin/communication-book', { method: 'POST', body: JSON.stringify({ studentId, category, message }) });
    showToast('Entry added');
    cbkCloseNew();
    cbkLoad();
  } catch (err) { showToast(err.message); }
}
async function cbkDelete(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await apiFetch(`/api/admin/communication-book/${id}`, { method: 'DELETE' });
    showToast('Deleted');
    cbkLoad();
  } catch (err) { showToast(err.message); }
}

// ── EXTRACURRICULAR GROUPS ──

let ecgCurrentGroupId = null;

function ecgInit() {
  document.getElementById('ecg-detail-card').style.display = 'none';
  ecgLoad();
}
async function ecgLoad() {
  const tbody = document.getElementById('ecg-tbody');
  try {
    const data = await apiFetch('/api/admin/extracurricular-groups');
    const rows = data.groups || [];
    tbody.innerHTML = rows.length ? rows.map(g => `
      <tr>
        <td><a href="javascript:void(0)" onclick="ecgOpenDetail(${g.id})">${escapeHtml(g.name)}</a></td>
        <td style="max-width:280px;white-space:normal;">${escapeHtml(g.description || '—')}</td>
        <td>${escapeHtml(g.teacherInChargeName || '—')}</td>
        <td>${g.memberCount}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="ecgDelete(${g.id})">Delete</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3)">No groups yet</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}
function ecgOpenNew() {
  document.getElementById('ecgn-name').value = '';
  document.getElementById('ecgn-description').value = '';
  const teacherSel = document.getElementById('ecgn-teacher');
  teacherSel.innerHTML = '<option value="">— None —</option>' + (state.setup.teachers || state.setup.staff || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  document.getElementById('ecg-new-modal').style.display = 'flex';
}
function ecgCloseNew() { document.getElementById('ecg-new-modal').style.display = 'none'; }
async function ecgSubmitNew() {
  const name = document.getElementById('ecgn-name').value.trim();
  const description = document.getElementById('ecgn-description').value.trim();
  const teacherInChargeId = document.getElementById('ecgn-teacher').value;
  if (!name) { showToast('Group name is required'); return; }
  try {
    await apiFetch('/api/admin/extracurricular-groups', { method: 'POST', body: JSON.stringify({ name, description, teacherInChargeId }) });
    showToast('Group created');
    ecgCloseNew();
    ecgLoad();
  } catch (err) { showToast(err.message); }
}
async function ecgDelete(id) {
  if (!confirm('Delete this group?')) return;
  try {
    await apiFetch(`/api/admin/extracurricular-groups/${id}`, { method: 'DELETE' });
    showToast('Group deleted');
    ecgLoad();
  } catch (err) { showToast(err.message); }
}
async function ecgOpenDetail(id) {
  ecgCurrentGroupId = id;
  try {
    const data = await apiFetch(`/api/admin/extracurricular-groups/${id}`);
    const group = data.group;
    document.getElementById('ecg-detail-title').textContent = group.name;
    document.getElementById('ecg-detail-card').style.display = 'block';
    const memberIds = new Set(group.members.map(m => m.id));
    const addSel = document.getElementById('ecg-add-student');
    addSel.innerHTML = '<option value="">Select a student</option>' +
      (state.setup.students || []).filter(s => !memberIds.has(s.id)).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.classCode)})</option>`).join('');
    const tbody = document.getElementById('ecg-detail-tbody');
    tbody.innerHTML = group.members.length ? group.members.map(m => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.classLabel || m.classCode)}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="ecgUnassignStudent('${escapeHtml(m.id)}')">Remove</button></td>
      </tr>
    `).join('') : '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--text-3)">No members yet</td></tr>';
  } catch (err) { showToast(err.message); }
}
function ecgCloseDetail() {
  ecgCurrentGroupId = null;
  document.getElementById('ecg-detail-card').style.display = 'none';
}
async function ecgAssignStudent() {
  const studentId = document.getElementById('ecg-add-student').value;
  if (!studentId) { showToast('Select a student'); return; }
  try {
    await apiFetch(`/api/admin/extracurricular-groups/${ecgCurrentGroupId}/members`, { method: 'POST', body: JSON.stringify({ studentId }) });
    ecgOpenDetail(ecgCurrentGroupId);
    ecgLoad();
  } catch (err) { showToast(err.message); }
}
async function ecgUnassignStudent(studentId) {
  try {
    await apiFetch(`/api/admin/extracurricular-groups/${ecgCurrentGroupId}/members/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
    ecgOpenDetail(ecgCurrentGroupId);
    ecgLoad();
  } catch (err) { showToast(err.message); }
}

function populateParents() {
  const tbody = document.getElementById('parents-tbody');
  if (!tbody) return;
  const rows = [...(state.setup.students || [])]
    .filter(student => student.parentEmail)
    .sort((a, b) => String(a.parentEmail).localeCompare(String(b.parentEmail)));
  const label = document.getElementById('parents-count-label');
  if (label) label.textContent = `${rows.length} parent contact${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-3);padding:16px;">No parent email records yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(student => `
    <tr data-search="${escapeHtml(`${student.parentEmail} ${student.name} ${student.id} ${student.classCode}`.toLowerCase())}">
      <td><strong>${escapeHtml(student.parentEmail)}</strong></td>
      <td>${escapeHtml(student.name)}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--text-3);">${escapeHtml(student.id)}</td>
      <td>${escapeHtml(student.classCode)}</td>
      <td><span style="font-size:11px;color:var(--green);font-family:'DM Mono',monospace;">Linked</span></td>
    </tr>`).join('');
}

function filterParents() {
  const q = document.getElementById('parents-search').value.toLowerCase();
  document.querySelectorAll('#parents-tbody tr').forEach(tr => {
    tr.style.display = !q || (tr.dataset.search || '').includes(q) ? '' : 'none';
  });
}

// ── ADMISSION APPLICATIONS ──
let admissionConvertId = null;

async function loadAdmissions() {
  const classSel = document.getElementById('adm-class');
  if (classSel && !classSel.dataset.filled) {
    classSel.innerHTML = '<option value="">Select…</option>' +
      (state.setup.classes || []).map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
    classSel.dataset.filled = '1';
  }
  try {
    const data = await apiFetch('/api/admin/admissions');
    renderAdmissions(data);
  } catch (err) {
    showToast(err.message);
  }
}

function admissionStatusPill(status) {
  const map = {
    pending: ['var(--amber-bg)', 'var(--amber)', 'Pending'],
    approved: ['var(--green-bg)', 'var(--green)', 'Approved'],
    rejected: ['var(--red-bg)', 'var(--red)', 'Rejected'],
  };
  const [bg, color, label] = map[status] || map.pending;
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:0.3px;background:${bg};color:${color};font-family:'DM Mono',monospace;">${label}</span>`;
}

function renderAdmissions(data) {
  const apps = data.applications || [];
  const s = data.summary || { total: 0, pending: 0, approved: 0, rejected: 0, converted: 0 };
  document.getElementById('adm-total').textContent = s.total;
  document.getElementById('adm-pending').textContent = s.pending || 0;
  document.getElementById('adm-approved').textContent = s.approved || 0;
  document.getElementById('adm-converted').textContent = s.converted || 0;

  const tbody = document.getElementById('adm-tbody');
  if (!apps.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-3);padding:20px;text-align:center;">No applications recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = apps.map(a => {
    const contactParts = [a.parentName, a.parentPhone, a.parentEmail].filter(Boolean);
    let actions = '';
    if (a.convertedStudentId) {
      actions = `<span style="font-size:11px;color:var(--green);font-family:'DM Mono',monospace;">→ ${escapeHtml(a.convertedStudentId)}</span>`;
    } else if (a.status === 'pending') {
      actions = `
        <button class="post-btn" style="padding:5px 9px;font-size:11px;background:var(--green);" onclick="updateAdmissionStatus(${a.id},'approved')">Approve</button>
        <button class="post-btn" style="padding:5px 9px;font-size:11px;background:var(--red);" onclick="updateAdmissionStatus(${a.id},'rejected')">Reject</button>`;
    } else if (a.status === 'approved') {
      actions = `<button class="post-btn" style="padding:5px 9px;font-size:11px;" onclick="openConvertModal(${a.id},'${escapeHtml(a.applicantName)}')">Convert to Student</button>`;
    } else {
      actions = `<button class="post-btn" style="padding:5px 9px;font-size:11px;background:var(--amber);" onclick="updateAdmissionStatus(${a.id},'pending')">Reopen</button>`;
    }
    return `<tr>
      <td><strong>${escapeHtml(a.applicantName)}</strong>${a.gender ? ` <span style="color:var(--text-3);font-size:11px;">(${escapeHtml(a.gender)})</span>` : ''}</td>
      <td style="color:var(--text-2);">${escapeHtml(a.classLabel || a.classCode || '—')}</td>
      <td style="color:var(--text-3);font-size:12px;">${escapeHtml(contactParts.join(' · ') || '—')}</td>
      <td>${admissionStatusPill(a.status)}</td>
      <td style="color:var(--text-3);font-size:11px;font-family:'DM Mono',monospace;">${escapeHtml(fmtRelativeDateTime(a.submittedAt))}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${actions}</td>
    </tr>`;
  }).join('');
}

function openAdmissionForm() {
  document.getElementById('adm-form-card').style.display = '';
  document.getElementById('adm-name').value = '';
  document.getElementById('adm-gender').value = '';
  document.getElementById('adm-class').value = '';
  document.getElementById('adm-parent-name').value = '';
  document.getElementById('adm-parent-phone').value = '';
  document.getElementById('adm-parent-email').value = '';
  document.getElementById('adm-notes').value = '';
}

function closeAdmissionForm() {
  document.getElementById('adm-form-card').style.display = 'none';
}

async function submitAdmissionApplication() {
  const applicantName = document.getElementById('adm-name').value.trim();
  if (!applicantName) { showToast('Applicant name is required'); return; }
  try {
    await apiFetch('/api/admin/admissions', {
      method: 'POST',
      body: JSON.stringify({
        applicantName,
        gender: document.getElementById('adm-gender').value,
        classCode: document.getElementById('adm-class').value,
        parentName: document.getElementById('adm-parent-name').value.trim(),
        parentPhone: document.getElementById('adm-parent-phone').value.trim(),
        parentEmail: document.getElementById('adm-parent-email').value.trim(),
        notes: document.getElementById('adm-notes').value.trim(),
      }),
    });
    showToast('Application recorded');
    closeAdmissionForm();
    loadAdmissions();
  } catch (err) {
    showToast(err.message);
  }
}

async function updateAdmissionStatus(id, status) {
  try {
    await apiFetch(`/api/admin/admissions/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    showToast(`Application ${status}`);
    loadAdmissions();
  } catch (err) {
    showToast(err.message);
  }
}

function openConvertModal(id, name) {
  admissionConvertId = id;
  document.getElementById('adm-convert-name').textContent = `Applicant: ${name}`;
  document.getElementById('adm-convert-id').value = '';
  document.getElementById('adm-convert-initials').value = '';
  document.getElementById('admission-convert-modal').style.display = 'flex';
}

function closeConvertModal() {
  document.getElementById('admission-convert-modal').style.display = 'none';
  admissionConvertId = null;
}

async function submitConvertApplication() {
  if (!admissionConvertId) return;
  const id = document.getElementById('adm-convert-id').value.trim().toUpperCase();
  if (!id) { showToast('Student ID is required'); return; }
  try {
    const data = await apiFetch(`/api/admin/admissions/${admissionConvertId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ id, initials: document.getElementById('adm-convert-initials').value.trim() }),
    });
    state.setup = data.setup;
    showToast(`Student ${data.studentId} created`);
    closeConvertModal();
    loadAdmissions();
    populateStudents();
    populateParents();
    populateDashboard();
  } catch (err) {
    showToast(err.message);
  }
}

function accountStatusToggle(id, active) {
  return `<span class="staff-status-toggle">
    <button type="button" class="${active ? 'on-active' : ''}" onclick="toggleAccountStatus('${escapeHtml(id)}', true)">ON</button>
    <button type="button" class="${!active ? 'off-active' : ''}" onclick="toggleAccountStatus('${escapeHtml(id)}', false)">OFF</button>
  </span>`;
}

async function toggleAccountStatus(id, makeActive) {
  try {
    await apiFetch(`/api/admin/account-status/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ active: makeActive }),
    });
    showToast(makeActive ? `${id} reactivated` : `${id} deactivated`);
    await loadResultSetup();
    populateStaff();
    populateStudents();
  } catch (err) {
    showToast(err.message);
  }
}

function populateStaff() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const staffRows = state.setup.staff || [];
  const categories = [
    'All Staff',
    'Teacher',
    'Accountant/Bursary Officer',
    'Librarian',
    'Registrar',
    'Transport Manager',
    'Hostel Manager',
    'Store Manager',
    'General Staff / Others',
  ];
  const counts = Object.fromEntries(categories.map(category => [category, category === 'All Staff' ? staffRows.length : 0]));
  staffRows.forEach(staff => {
    const category = staffCategory(staff);
    counts[category] = (counts[category] || 0) + 1;
  });
  const countMap = {
    'staff-count-all': counts['All Staff'],
    'staff-count-teacher': counts.Teacher,
    'staff-count-accountant': counts['Accountant/Bursary Officer'],
    'staff-count-librarian': counts.Librarian,
    'staff-count-registrar': counts.Registrar,
    'staff-count-transport': counts['Transport Manager'],
  };
  Object.entries(countMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || 0;
  });
  const filters = document.getElementById('staff-role-filters');
  if (filters) {
    filters.innerHTML = categories.map(category => `
      <button type="button" class="staff-filter-pill ${state.staffFilter === category ? 'active' : ''}" data-category="${escapeHtml(category)}" onclick="setStaffFilter('${escapeHtml(category)}')">
        <span>${staffFilterIcon(category)}</span>${escapeHtml(category)}
      </button>`).join('');
  }

  staffRows.forEach((staff, index) => {
    const category = staffCategory(staff);
    const areas = staffAssignments(staff);
    const typeLabel = category === 'Teacher' ? 'Teacher' : category === 'General Staff / Others' ? (staff.role === 'admin' ? 'Admin' : 'Staff') : category.replace('Accountant/Bursary Officer', 'Accountant');
    const designation = staff.roleLabel || (staff.role === 'admin' ? 'Administrator' : 'Staff');
    const tr = document.createElement('tr');
    tr.dataset.search = `${staff.name} ${staff.id} ${staff.roleLabel} ${staff.role} ${category} ${areas}`.toLowerCase();
    tr.dataset.category = category;
    tr.innerHTML = `
      <td class="staff-index">${index + 1}</td>
      <td>
        <div class="staff-table-name">${escapeHtml(staff.name)}</div>
        <div class="staff-table-sub">${escapeHtml(staff.id)}</div>
        ${staff.role === 'admin' ? '<span class="staff-main-pill">Main Account</span>' : ''}
      </td>
      <td><span class="staff-type-pill">${escapeHtml(typeLabel)}</span></td>
      <td><div class="staff-designation">${escapeHtml(designation)}</div></td>
      <td class="staff-phone">-</td>
      <td><button class="staff-profile-btn" title="Open staff profile" onclick="openStaffProfile('${escapeHtml(staff.id)}')">...</button></td>
      <td>${staff.id === state.user.id ? '<span class="staff-status-on">ON</span>' : accountStatusToggle(staff.id, staff.active)}</td>`;
    tbody.appendChild(tr);
  });
  filterStaff();
}

function filterStaff() {
  const q = (document.getElementById('staff-search')?.value || '').toLowerCase();
  document.querySelectorAll('#staff-tbody tr').forEach(tr => {
    const matchesSearch = !q || (tr.dataset.search || '').includes(q);
    const matchesCategory = state.staffFilter === 'All Staff' || tr.dataset.category === state.staffFilter;
    tr.style.display = matchesSearch && matchesCategory ? '' : 'none';
  });
}

function staffAssignments(staff) {
  return (state.setup.assignments || [])
    .filter(assignment => assignment.teacherId === staff.id)
    .map(assignment => `${assignment.classCode} ${assignment.subjectName}`)
    .join(', ') || (staff.role === 'admin' ? 'All' : 'Not assigned');
}

function staffCategory(staff) {
  const raw = `${staff.roleLabel || ''} ${staff.name || ''} ${staff.role || ''}`.toLowerCase();
  if (staff.role === 'teacher' || raw.includes('teacher')) return 'Teacher';
  if (raw.includes('account') || raw.includes('bursar') || raw.includes('bursary')) return 'Accountant/Bursary Officer';
  if (raw.includes('librarian') || raw.includes('library')) return 'Librarian';
  if (raw.includes('registrar')) return 'Registrar';
  if (raw.includes('transport')) return 'Transport Manager';
  if (raw.includes('hostel')) return 'Hostel Manager';
  if (raw.includes('store')) return 'Store Manager';
  return 'General Staff / Others';
}

function staffFilterIcon(category) {
  const icons = {
    'All Staff': 'G',
    Teacher: 'T',
    'Accountant/Bursary Officer': 'B',
    Librarian: 'L',
    Registrar: 'R',
    'Transport Manager': 'M',
    'Hostel Manager': 'H',
    'Store Manager': 'S',
    'General Staff / Others': 'O',
  };
  return icons[category] || 'P';
}

function setStaffFilter(category) {
  state.staffFilter = category;
  document.querySelectorAll('.staff-filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });
  filterStaff();
}

function exportStaffList() {
  const rows = [['Name', 'Staff ID', 'Type', 'Designation', 'Assignments', 'Status']];
  (state.setup.staff || []).forEach(staff => {
    rows.push([
      staff.name,
      staff.id,
      staffCategory(staff),
      staff.roleLabel || '',
      staffAssignments(staff),
      'ON',
    ]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'staff-employees.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function populateGradebookControls() {
  const sessionSelect = document.getElementById('gb-session');
  const examSelect = document.getElementById('gb-exam');
  const classSelect = document.getElementById('gb-class');
  const subjectSelect = document.getElementById('gb-subject');
  if (!sessionSelect || !examSelect || !classSelect) return;

  const academic = state.setup.academic || {};
  sessionSelect.innerHTML = '<option value="">Select session...</option>';
  if (academic.sessionLabel) sessionSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(academic.sessionLabel)}">${escapeHtml(academic.sessionLabel)}</option>`);
  examSelect.innerHTML = '<option value="">Select exam...</option>' +
    (state.setup.examTypes || []).map(exam => `<option value="${escapeHtml(exam)}">${escapeHtml(exam)}</option>`).join('');
  classSelect.innerHTML = '<option value="">Select class...</option>' +
    (state.setup.classes || []).map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
  if (subjectSelect) subjectSelect.innerHTML = '<option value="">All Subjects</option>' +
    (state.setup.subjects || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  gbLoadArms();
}

function gbLoadArms() {
  const classCode = document.getElementById('gb-class')?.value || '';
  const armSel = document.getElementById('gb-arm');
  const label = document.getElementById('gb-arm-label');
  if (!armSel) return;
  const hasArms = (state.setup.classArms || []).some(a => a.classCode === classCode);
  armSel.innerHTML = hasArms ? attArmOptions(classCode, '— All Arms —') : '<option value="">— No Arms —</option>';
  armSel.disabled = !hasArms;
  if (label) label.textContent = hasArms ? 'Class Arm *' : 'Class Arm';
}

function gradebookSelection() {
  const classCode = document.getElementById('gb-class')?.value || '';
  const cls = (state.setup.classes || []).find(item => item.code === classCode) || {};
  const subjectSelect = document.getElementById('gb-subject');
  const subjectId = subjectSelect?.value || '';
  return {
    session: document.getElementById('gb-session')?.value || '',
    examType: document.getElementById('gb-exam')?.value || '',
    classCode,
    classLabel: cls.label || classCode || 'Selected Class',
    subjectId,
    subjectName: subjectId ? (subjectSelect.selectedOptions[0]?.textContent || '') : '',
    classArmId: document.getElementById('gb-arm')?.value || '',
    includeArchived: Boolean(document.getElementById('gb-archived')?.checked),
  };
}

function findGradebookBatch(selection) {
  return (state.setup.resultBatches || []).find(batch =>
    batch.classCode === selection.classCode
    && batch.examType === selection.examType
    && batch.subjectName === selection.subjectName
  );
}

function gradebookIsPublished(selection) {
  return (state.setup.publications || []).some(row => row.classCode === selection.classCode && row.examType === selection.examType);
}

function updateGradebookSummary(selection, batch) {
  const classText = document.getElementById('gb-selected-class');
  const subjectText = document.getElementById('gb-selected-subject');
  const examText = document.getElementById('gb-selected-exam');
  const stateBox = document.getElementById('gb-readonly-box');
  const unpublish = document.getElementById('gb-unpublish-btn');
  const subjects = batch?.subjects || [];
  if (classText) classText.textContent = `${selection.classLabel} Students`;
  if (subjectText) subjectText.textContent = selection.subjectName
    ? `Score Entry for ${selection.subjectName}`
    : 'Score Entry for All Subjects';
  if (examText) examText.textContent = `Exam : ${selection.examType} (${selection.session})`;
  const published = gradebookIsPublished(selection);
  if (stateBox) {
    stateBox.style.display = published ? 'block' : 'none';
    stateBox.innerHTML = '<strong>READ ONLY MODE</strong><br>This result has already been published and can no longer be altered from here.';
  }
  if (unpublish) {
    unpublish.style.display = published ? '' : 'none';
    unpublish.textContent = '🔓 Unpublish this Result';
  }
  const saved = document.getElementById('gb-batch-status');
  if (saved) {
    saved.textContent = batch && subjects.length
      ? `Uploaded across ${subjects.length} subject${subjects.length === 1 ? '' : 's'}`
      : 'No uploaded score batch found for this selection yet.';
  }
}

async function manageGradebookScores() {
  const card = document.getElementById('gb-entry-card');
  if (card) card.style.display = '';
  const selection = gradebookSelection();
  const body = document.getElementById('gb-score-tbody');
  if (!selection.classCode || !selection.examType) {
    if (body) body.innerHTML = '<tr><td colspan="11" style="padding:18px;color:var(--text-3);">Select a class and exam first.</td></tr>';
    showToast('Select a class and exam first', 'warn');
    return;
  }
  if (body) body.innerHTML = '<tr><td colspan="10" style="padding:18px;color:var(--text-3);">Loading grade book...</td></tr>';
  try {
    const data = await apiFetch(`/api/admin/gradebook?classCode=${encodeURIComponent(selection.classCode)}&examType=${encodeURIComponent(selection.examType)}`);
    state.gradebookBatch = data.gradebook;
    renderGradebookTable(selection, data.gradebook);
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="10" style="padding:18px;color:#f87171;">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message);
  }
}

function renderGradebookTable(selection = gradebookSelection(), gradebook = state.gradebookBatch) {
  const tbody = document.getElementById('gb-score-tbody');
  if (!tbody) return;
  updateGradebookSummary(selection, gradebook);
  const students = (gradebook?.students || []).filter(student =>
    (selection.includeArchived || student.active !== false)
    && (!selection.classArmId || String(student.classArmId) === String(selection.classArmId))
  );
  const subjects = (gradebook?.subjects || []).filter(subject => !selection.subjectId || String(subject.id) === String(selection.subjectId));
  const matrix = gradebook?.scoreMatrix || {};
  const isFinal = selection.examType === 'Final Exam';
  const published = gradebookIsPublished(selection);
  const caMax = isFinal ? 30 : 40;
  const examMax = 70;
  const header = document.querySelector('.gb-score-table thead tr');
  if (header) {
    header.innerHTML = `
      <th>#</th><th>Student</th><th>Subject</th>
      <th>CA (${caMax}%)<small>Max Score : ${caMax}</small></th>
      <th class="gb-exam-column" style="display:${isFinal ? '' : 'none'};">Examination (${examMax}%)<small>Max Score : ${examMax}</small></th>
      <th>Total Score<small>Max Total Score : ${isFinal ? 100 : caMax}</small></th>
      <th id="gb-grade-th" style="display:none;">Total Score Grade</th>
      <th>Subject Teacher's Comment / Progress Report</th><th>Subject Teacher's Recommendation</th>
      <th>Absent</th><th>Exclude</th>`;
  }
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:18px;color:var(--text-3);">No students found for this class.</td></tr>';
    return;
  }
  if (!subjects.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:18px;color:var(--text-3);">No score batch found for ${selection.subjectName ? escapeHtml(selection.subjectName) : 'any subject'} in this class and exam.</td></tr>`;
    return;
  }
  const pctMode = document.getElementById('gb-pct-mode')?.checked;
  const gradeCol = document.getElementById('gb-grade-col')?.checked;
  const gradingSystem = state.setup.gradingSystem || [];

  function getGrade(score) {
    if (score === '' || score === null || score === undefined) return '-';
    const n = Number(score);
    const found = gradingSystem.find(g => n >= g.min && n <= g.max);
    return found ? found.grade : '-';
  }

  function pctToScaled(pct, max) {
    if (pct === '' || max === undefined || max === 0) return '';
    return Math.round((Number(pct) / 100) * max);
  }

  const showExcluded = document.getElementById('gb-show-excluded')?.checked;
  let rowIndex = 0;
  tbody.innerHTML = students.flatMap(student => subjects.map(subject => {
    const entry = matrix[student.id]?.[subject.id] || {};
    if (entry.isExcluded && !showExcluded) return '';
    const isAbsent = !!entry.isAbsent;
    const isExcluded = !!entry.isExcluded;
    const locked = published || isAbsent || isExcluded;
    const ca = entry.ca ?? '';
    const exam = entry.ex ?? '';
    const total = entry.tot ?? (ca !== '' && (!isFinal || exam !== '') ? Number(ca) + (isFinal ? Number(exam) : 0) : '');
    const grade = isAbsent || isExcluded ? '-' : getGrade(total);
    const caScaled = ca !== '' ? pctToScaled(ca, caMax) : '';
    const examScaled = exam !== '' ? pctToScaled(exam, examMax) : '';
    const totalDisplay = isAbsent ? 'ABS' : isExcluded ? 'Excluded' : (total === '' ? '-' : escapeHtml(String(total)));
    return `
      <tr class="${isExcluded ? 'gb-row-excluded' : ''}" data-student-id="${escapeHtml(student.id)}" data-batch-id="${escapeHtml(String(subject.batchId))}" data-search="${escapeHtml(`${student.name} ${student.id} ${subject.name}`.toLowerCase())}">
        <td>${++rowIndex}</td>
        <td><strong>${escapeHtml(student.name)}</strong><div class="gb-student-id">${escapeHtml(student.id)}</div></td>
        <td>${escapeHtml(subject.name)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="gb-score-input" type="number" min="0" max="${caMax}" value="${escapeHtml(String(ca))}" data-score="ca" oninput="if(this.value.length>2)this.value=this.value.slice(0,2)" ${locked ? 'disabled' : ''}>
            <span class="gb-score-pct-label" style="display:${pctMode ? '' : 'none'};font-size:11px;color:var(--text-3);">%</span>
          </div>
          <div class="gb-score-scaled" style="display:${pctMode ? '' : 'none'};font-size:11px;color:var(--text-3);padding-left:4px;">${caScaled}</div>
        </td>
        <td class="gb-exam-column" style="display:${isFinal ? '' : 'none'};">
          <div style="display:flex;align-items:center;gap:4px;">
            <input class="gb-score-input gb-exam-input" type="number" min="0" max="${examMax}" value="${escapeHtml(String(exam))}" data-score="exam" oninput="if(this.value.length>2)this.value=this.value.slice(0,2)" ${locked ? 'disabled' : ''}>
            <span class="gb-score-pct-label" style="display:${pctMode ? '' : 'none'};font-size:11px;color:var(--text-3);">%</span>
          </div>
          <div class="gb-score-scaled" style="display:${pctMode ? '' : 'none'};font-size:11px;color:var(--text-3);padding-left:4px;">${examScaled}</div>
        </td>
        <td class="gb-total">${totalDisplay}</td>
        <td class="gb-grade-cell" style="display:${gradeCol ? '' : 'none'};">${grade}</td>
        <td><input class="gb-comment-input" readonly></td>
        <td><input class="gb-comment-input" readonly></td>
        <td><button class="gb-flag absent ${isAbsent ? 'active' : ''}" type="button" onclick="toggleGradebookFlag('${escapeHtml(student.id)}', ${subject.batchId}, 'absent', ${isAbsent ? 'false' : 'true'})" ${published || isExcluded ? 'disabled' : ''}><span></span>${isAbsent ? 'Unmark' : 'Absent'}</button></td>
        <td><button class="gb-flag exclude ${isExcluded ? 'active' : ''}" type="button" onclick="toggleGradebookFlag('${escapeHtml(student.id)}', ${subject.batchId}, 'excluded', ${isExcluded ? 'false' : 'true'})" ${published ? 'disabled' : ''}><span></span>${isExcluded ? 'Include' : 'Exclude'}</button></td>
      </tr>`;
  })).join('');
  tbody.querySelectorAll('input[data-score]').forEach(input => {
    input.addEventListener('input', () => scheduleGradebookScoreSave(input));
  });
  applyGradebookModes();
}

const gradebookSaveTimers = new WeakMap();

function scheduleGradebookScoreSave(input) {
  const existing = gradebookSaveTimers.get(input);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => saveGradebookScore(input), 450);
  gradebookSaveTimers.set(input, timer);
}

async function saveGradebookScore(input) {
  const selection = gradebookSelection();
  const row = input.closest('tr[data-student-id]');
  if (!row) return;
  const status = document.getElementById('gb-batch-status');
  if (status) status.textContent = 'Saving score...';
  try {
    const data = await apiFetch('/api/admin/gradebook/scores', {
      method: 'POST',
      body: JSON.stringify({
        classCode: selection.classCode,
        examType: selection.examType,
        entries: [{
          batchId: Number(row.dataset.batchId),
          studentId: row.dataset.studentId,
          ca: row.querySelector('[data-score="ca"]')?.value ?? '',
          exam: selection.examType === 'Final Exam' ? (row.querySelector('[data-score="exam"]')?.value ?? '') : null,
        }],
      }),
    });
    state.gradebookBatch = data.gradebook;
    const ca = row.querySelector('[data-score="ca"]')?.value ?? '';
    const exam = selection.examType === 'Final Exam' ? (row.querySelector('[data-score="exam"]')?.value ?? '') : '';
    const total = ca !== '' && (selection.examType !== 'Final Exam' || exam !== '')
      ? Number(ca) + (selection.examType === 'Final Exam' ? Number(exam) : 0)
      : '-';
    const totalCell = row.querySelector('.gb-total');
    if (totalCell) totalCell.textContent = String(total);
    if (status) status.textContent = 'Score saved.';
  } catch (err) {
    if (status) status.textContent = `Could not save score: ${err.message}`;
    showToast(err.message, 'warn');
  }
}

async function toggleGradebookFlag(studentId, batchId, field, value) {
  try {
    const data = await apiFetch('/api/admin/gradebook/entries/flag', {
      method: 'PUT',
      body: JSON.stringify({ batchId, studentId, field, value }),
    });
    state.gradebookBatch = data.gradebook;
    renderGradebookTable();
    showToast(value ? `Marked ${field}` : `Cleared ${field}`);
  } catch (err) { showToast(err.message); }
}

function filterGradebookRows() {
  const q = (document.getElementById('gb-search')?.value || '').toLowerCase();
  document.querySelectorAll('#gb-score-tbody tr').forEach(tr => {
    tr.style.display = !q || (tr.dataset.search || '').includes(q) ? '' : 'none';
  });
}

function applyGradebookModes() {
  const pctMode = document.getElementById('gb-pct-mode')?.checked;
  const gradeCol = document.getElementById('gb-grade-col')?.checked;

  // Grade column header
  const gradeThEl = document.getElementById('gb-grade-th');
  if (gradeThEl) gradeThEl.style.display = gradeCol ? '' : 'none';

  // Per-row: show/hide grade cell, show/hide % suffix and scaled value
  document.querySelectorAll('#gb-score-tbody tr[data-student-id]').forEach(tr => {
    // Grade cell
    const gradeCell = tr.querySelector('.gb-grade-cell');
    if (gradeCell) gradeCell.style.display = gradeCol ? '' : 'none';

    // Percentage mode: show % labels and scaled values
    tr.querySelectorAll('.gb-score-pct-label').forEach(el => { el.style.display = pctMode ? '' : 'none'; });
    tr.querySelectorAll('.gb-score-scaled').forEach(el => { el.style.display = pctMode ? '' : 'none'; });
  });
}

function toggleOfflinePanel() {
  const panel = document.getElementById('gb-offline-panel');
  if (panel) panel.classList.toggle('open');
}

function exportBroadsheetCsv() {
  const selection = gradebookSelection();
  const rows = [['Subject', 'Student', 'Student ID', 'CA', 'Examination', 'Total Score']];
  (state.setup.subjects || []).forEach(subject => {
    (state.setup.students || []).forEach(stu => {
      rows.push([subject.name, stu.name, stu.id, '', '', '']);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `broadsheet-${selection.classLabel}-${selection.examType}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function uploadGradebookFile(input, mode) {
  if (!input.files[0]) return;
  showToast(`File "${input.files[0].name}" selected for upload (${mode}). Upload parsing coming soon.`, 'info');
  input.value = '';
}

function exportGradebookCsv() {
  const selection = gradebookSelection();
  const rows = [['Student', 'Student ID', 'Subject', 'CA', 'Examination', 'Total Score']];
  document.querySelectorAll('#gb-score-tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 5) return;
    rows.push([
      cells[1].querySelector('strong')?.textContent || '',
      cells[1].querySelector('.gb-student-id')?.textContent || '',
      cells[2].textContent || '',
      cells[3].querySelector('input')?.value || '',
      cells[4].querySelector('input')?.value || '',
      cells[5].textContent || '',
    ]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${selection.classCode}-${selection.examType}-gradebook.csv`.replace(/[^a-z0-9_.-]+/gi, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function populateCognitiveControls() {
  const classSelect = document.getElementById('cog-class');
  const armSelect = document.getElementById('cog-arm');
  if (!classSelect) return;
  const previous = classSelect.value;
  const classes = state.setup?.classes || [];
  classSelect.innerHTML = classes.map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
  if (previous && classes.some(cls => cls.code === previous)) classSelect.value = previous;
  if (armSelect) {
    armSelect.innerHTML = '<option value="main">Main Division</option><option value="all">All Students</option>';
  }
  renderCognitiveTable();
}

function cognitiveSelection() {
  const classCode = document.getElementById('cog-class')?.value || (state.setup?.classes || [])[0]?.code || '';
  const cls = (state.setup?.classes || []).find(item => item.code === classCode) || {};
  return {
    classCode,
    classLabel: cls.label || classCode || 'Selected Class',
    arm: document.getElementById('cog-arm')?.value || 'main',
    examType: state.cognitiveExamType || 'Mid-Term Exam',
  };
}

function resetCognitiveView() {
  state.cognitiveRatings = {};
  renderCognitiveTable();
}

async function viewCognitiveClass() {
  const selection = cognitiveSelection();
  if (!selection.classCode) return;
  const tbody = document.getElementById('cog-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">Loading cognitive skills records...</td></tr>';
  try {
    const data = await apiFetch(`/api/admin/skills?classCode=${encodeURIComponent(selection.classCode)}&examType=${encodeURIComponent(selection.examType)}`);
    state.cognitiveRatings = data.ratings || {};
    renderCognitiveTable();
  } catch (err) {
    showToast(err.message);
    renderCognitiveTable();
  }
}

function cognitiveClassLabel(selection) {
  return `${selection.classLabel} - ${selection.arm === 'main' ? 'Main Division' : 'All Students'}`;
}

function renderCognitiveTable() {
  const tbody = document.getElementById('cog-tbody');
  if (!tbody) return;
  const selection = cognitiveSelection();
  const title = document.getElementById('cog-list-title');
  const countLabel = document.getElementById('cog-count-label');
  if (title) title.textContent = 'Students Cognitive Skills Assessment';
  const students = (state.setup?.students || []).filter(student => student.classCode === selection.classCode);
  if (countLabel) countLabel.textContent = `${students.length} student${students.length === 1 ? '' : 's'} - ${selection.examType}`;
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No students found for this class.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map((student, index) => `
    <tr data-search="${escapeHtml(`${student.name} ${student.id} ${selection.classLabel}`.toLowerCase())}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(student.name)}</strong></td>
      <td class="cog-reg">${escapeHtml(student.id)}</td>
      <td>${escapeHtml(cognitiveClassLabel(selection))}</td>
      <td><button type="button" class="cog-action-btn" title="View Student Cognitive Skills" onclick="openCognitiveSkillsModal('${escapeHtml(student.id)}', false)"><span class="cog-action-icon view"></span></button></td>
      <td><button type="button" class="cog-action-btn edit" title="Update Student Cognitive Skills Record" onclick="openCognitiveSkillsModal('${escapeHtml(student.id)}', true)"><span class="cog-action-icon edit"></span></button></td>
    </tr>`).join('');
  filterCognitiveRows();
}

function filterCognitiveRows() {
  const q = (document.getElementById('cog-search')?.value || '').toLowerCase();
  document.querySelectorAll('#cog-tbody tr').forEach(tr => {
    tr.style.display = !q || (tr.dataset.search || '').includes(q) ? '' : 'none';
  });
}

function openCognitiveSkillsModal(studentId, editMode) {
  const student = (state.setup?.students || []).find(item => item.id === studentId);
  if (!student) return showToast('Student record not found');
  state.cognitiveStudentId = studentId;
  const rating = state.cognitiveRatings[studentId] || {};
  const modal = document.getElementById('cog-modal');
  const title = document.getElementById('cog-modal-title');
  const sub = document.getElementById('cog-modal-subtitle');
  const body = document.getElementById('cog-modal-body');
  const save = document.getElementById('cog-modal-save');
  const status = document.getElementById('cog-modal-status');
  if (!modal || !body) return;
  const selection = cognitiveSelection();
  if (title) title.textContent = editMode ? 'Update Student Cognitive Skills Record' : 'View Student Cognitive Skills';
  if (sub) sub.textContent = `${student.name} · ${student.id} · ${selection.examType}`;
  if (save) { save.textContent = 'Update'; save.style.display = editMode ? 'inline-flex' : 'none'; }
  if (status) status.textContent = rating.updatedAt ? `Last updated: ${rating.updatedAt}` : 'No saved skill rating yet.';
  body.innerHTML = renderCognitiveModalBody(student, rating, editMode, selection);
  modal.style.display = 'flex';
}

function renderCognitiveModalBody(student, rating, editMode, selection) {
  const classObj = (state.setup?.classes || []).find(c => c.code === student.classCode);
  const classLabel = classObj ? classObj.label : student.classCode;

  const photoHtml = student.photoPath
    ? `<img class="cog-student-photo" src="${escapeHtml(student.photoPath)}" alt="${escapeHtml(student.name)}">`
    : `<div class="cog-student-photo-placeholder">${escapeHtml(student.initials)}</div>`;

  const infoRows = [
    ['Name',              student.name],
    ['Registration No.',  student.id],
    ['Gender',            student.gender || '—'],
    ['Current Class',     classLabel],
    ['Exam Type',         selection.examType],
    ['Avg Score',         student.avg != null ? student.avg + '%' : '—'],
    ['Attendance',        student.att != null ? student.att + '%' : '—'],
    ['Parent Email',      student.parentEmail || '—'],
    ['Roll No.',          '—'],
    ['Admission Date',    '—'],
    ['Account Status',    student.active === false ? 'Deactivated' : 'Active'],
    ['Nationality',       '—'],
    ['Date of Birth',     '—'],
    ['Blood Group',       '—'],
    ['Religion',          '—'],
    ['Phone',             '—'],
    ['Permanent Address', '—'],
    ['Hostel',            '—'],
    ['Transport',         '—'],
    ['Parent/Guardian',   '—'],
  ];

  const profilePanel = `
    <div class="cog-student-panel">
      <div class="cog-photo-wrap">
        ${photoHtml}
        <div class="cog-photo-name-overlay">
          <div class="name">${escapeHtml(student.name)}</div>
          <span class="badge">Student</span>
        </div>
      </div>
      <div class="cog-student-icons">
        <span title="Email">✉</span>
        <span title="Message">💬</span>
      </div>
      <table class="cog-info-table">
        ${infoRows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join('')}
      </table>
      <div class="cog-panel-actions">
        <button class="cog-profile-btn">Go to profile page ›</button>
        <button class="cog-print-btn" onclick="window.print()">🖨 Print</button>
      </div>
    </div>`;

  const barIcon = `<span class="cog-bar-icon" aria-hidden="true">
    <span style="height:4px;"></span>
    <span style="height:7px;"></span>
    <span style="height:10px;"></span>
    <span style="height:13px;"></span>
  </span>`;

  const skillsPanel = `
    <div class="cog-skills-panel">
      ${SKILL_GROUPS.map(group => renderCognitiveSkillTable(group, rating, editMode, barIcon)).join('')}
      <button class="cog-history-btn">View Student's Skills Score History / Over-time Changes</button>
    </div>`;

  return profilePanel + skillsPanel;
}

function renderCognitiveSkillTable(group, rating, editMode, barIcon) {
  const rows = group.skills.map(([key, label]) => {
    const value = Number(rating[group.key]?.[key]) || 0;

    const scoreCell = value
      ? `<span class="cog-score-val">${value}</span>`
      : `<span style="color:var(--text-3);">—</span>`;

    const radioCells = [1, 2, 3, 4, 5].map(n => {
      if (!editMode) {
        return `<td><span class="cog-dot${value === n ? ' selected' : ''}"></span></td>`;
      }
      return `<td><input class="cog-radio" type="radio" name="cog-${group.key}-${key}" value="${n}"${value === n ? ' checked' : ''}></td>`;
    }).join('');

    return `<tr>
      <td class="td-skill">${escapeHtml(label)}</td>
      <td>${scoreCell}</td>
      ${radioCells}
    </tr>`;
  }).join('');

  return `
    <div>
      <div class="cog-skill-group-title">${escapeHtml(group.title)}</div>
      <table class="cog-skill-table">
        <colgroup>
          <col class="col-skill">
          <col class="col-score">
          <col class="col-radio"><col class="col-radio"><col class="col-radio"><col class="col-radio"><col class="col-radio">
        </colgroup>
        <thead>
          <tr>
            <th class="th-skill">Skill</th>
            <th class="th-score">Score ${barIcon}</th>
            <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCognitiveSkillGroups(rating, editMode) {
  return SKILL_GROUPS.map(group => `
    <div class="cog-skill-group">
      <div class="cog-skill-group-head">
        <strong>${escapeHtml(group.title)}</strong>
        <span>Scale 1-5</span>
      </div>
      <div class="cog-skill-grid">
        ${group.skills.map(([key, label]) => {
          const value = rating[group.key]?.[key] ?? '';
          return `<div class="cog-skill-row"><span>${escapeHtml(label)}</span><strong>${value ? escapeHtml(String(value)) : '-'}</strong></div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function closeCognitiveModal() {
  const modal = document.getElementById('cog-modal');
  if (modal) modal.style.display = 'none';
  state.cognitiveStudentId = null;
}

function collectCognitiveRatings() {
  const payload = { affective: {}, psychomotor: {} };
  for (const group of SKILL_GROUPS) {
    for (const [key, label] of group.skills) {
      const checked = document.querySelector(`input[name="cog-${group.key}-${key}"]:checked`);
      const value = checked ? Number(checked.value) : NaN;
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`Rate "${label}" from 1 to 5`);
      payload[group.key][key] = value;
    }
  }
  return payload;
}

async function saveCognitiveSkills() {
  if (!state.cognitiveStudentId) return;
  let ratings;
  try {
    ratings = collectCognitiveRatings();
  } catch (err) {
    showToast(err.message);
    return;
  }
  const selection = cognitiveSelection();
  try {
    const data = await apiFetch('/api/admin/skills', {
      method: 'POST',
      body: JSON.stringify({
        classCode: selection.classCode,
        examType: selection.examType,
        studentId: state.cognitiveStudentId,
        ...ratings,
      }),
    });
    state.cognitiveRatings = {
      ...state.cognitiveRatings,
      [state.cognitiveStudentId]: data.rating,
    };
    renderCognitiveTable();
    openCognitiveSkillsModal(state.cognitiveStudentId, true);
    showToast('Cognitive skills record saved');
  } catch (err) {
    showToast(err.message);
  }
}

function renderEmailQueue() {
  const tbody = document.getElementById('email-queue-tbody');
  if (!tbody) return;
  const rows = state.setup.publications || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:16px;color:var(--text-3);">No published report emails yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.studentName)}</strong><div style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${escapeHtml(row.studentId)}</div></td>
      <td>${escapeHtml(row.classCode)}</td>
      <td>${escapeHtml(row.examType)}</td>
      <td>${escapeHtml(row.parentEmail || '-')}</td>
      <td style="color:${row.emailStatus === 'sent' ? 'var(--green)' : row.emailStatus === 'email_failed' ? 'var(--red)' : 'var(--amber)'};">${escapeHtml(emailStatusLabel(row.emailStatus))}</td>
      <td>${escapeHtml(row.publishedAt || '')}</td>
    </tr>`).join('');
}

function populateAdminControls() {
  const teacherSelect = document.getElementById('assign-teacher');
  const classSelect = document.getElementById('assign-class');
  const subjectSelect = document.getElementById('assign-subject');

  if (teacherSelect) {
    teacherSelect.innerHTML = '<option value="">Select teacher...</option>' + state.setup.teachers.map(teacher =>
      `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} (${escapeHtml(teacher.id)})</option>`
    ).join('');
  }
  if (classSelect) {
    classSelect.innerHTML = '<option value="">Select class...</option>' + state.setup.classes.map(cls =>
      `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`
    ).join('');
  }
  if (subjectSelect) {
    subjectSelect.innerHTML = '<option value="">Select subject...</option>' + state.setup.subjects.map(subject =>
      `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`
    ).join('');
  }

  const studentClassSelect = document.getElementById('new-student-class');
  if (studentClassSelect) {
    // Archived classes are hidden from new selection, but if the student
    // currently being edited is still sitting in one, keep it selectable so
    // the edit form doesn't silently blank out their class.
    const currentlyEditingClass = state.editingStudentId
      ? (state.setup.students || []).find(s => s.id === state.editingStudentId)?.classCode
      : null;
    studentClassSelect.innerHTML = '<option value="">Select class...</option>' + state.setup.classes
      .filter(cls => !cls.archived || cls.code === currentlyEditingClass)
      .map(cls =>
        `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}${cls.archived ? ' (Archived)' : ''}</option>`
      ).join('');
  }

  const publishClassSelect = document.getElementById('publish-class');
  if (publishClassSelect) {
    publishClassSelect.innerHTML = '<option value="">Select class...</option>' + state.setup.classes.map(cls =>
      `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`
    ).join('');
  }
  const publishExamSelect = document.getElementById('publish-exam');
  if (publishExamSelect) {
    publishExamSelect.innerHTML = state.setup.examTypes.map(exam =>
      `<option value="${escapeHtml(exam)}">${escapeHtml(exam)}</option>`
    ).join('');
    publishExamSelect.value = 'Mid-Term Exam';
  }
  const signatureTeacherSelect = document.getElementById('signature-teacher');
  if (signatureTeacherSelect) {
    signatureTeacherSelect.innerHTML = '<option value="">Select teacher...</option>' + state.setup.teachers.map(teacher =>
      `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} (${escapeHtml(teacher.id)})</option>`
    ).join('');
  }
  const assetStudentSelect = document.getElementById('asset-student');
  if (assetStudentSelect) {
    assetStudentSelect.innerHTML = '<option value="">Select student...</option>' + state.setup.students.map(student =>
      `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)} (${escapeHtml(student.classCode)})</option>`
    ).join('');
  }
  syncStudentAssetFields();
}

function teacherTypeLabel(type) {
  return type === 'subject_teacher' ? 'Subject Teacher' : 'Class Teacher';
}

function renderAssignments() {
  const tbody = document.getElementById('assignment-tbody');
  const summary = document.getElementById('setup-summary');
  if (!tbody) return;
  summary.textContent = `${state.setup.academic.sessionLabel} - ${state.setup.academic.termLabel} - ${state.setup.assignments.length} assignments`;
  tbody.innerHTML = state.setup.assignments.map(assignment => `
    <tr>
      <td><strong>${escapeHtml(assignment.teacherName)}</strong><div style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${escapeHtml(assignment.teacherId)}</div></td>
      <td style="color:var(--text-2);">${teacherTypeLabel(assignment.teacherType)}</td>
      <td style="color:var(--text-2);">${escapeHtml(assignment.classLabel)}</td>
      <td style="color:var(--text-2);">${escapeHtml(assignment.subjectName)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;"><button class="post-btn" style="padding:6px 10px;" onclick="editAssignment(${assignment.id})">Edit</button><button class="ann-del" style="font-size:11px;" onclick="deleteAssignment(${assignment.id})">Delete</button></td>
    </tr>`).join('');
}

function editAssignment(id) {
  const assignment = state.setup.assignments.find(item => Number(item.id) === Number(id));
  if (!assignment) return;
  state.editingAssignmentId = assignment.id;
  document.getElementById('assign-teacher').value = assignment.teacherId;
  document.getElementById('assign-type').value = assignment.teacherType;
  document.getElementById('assign-class').value = assignment.classCode;
  document.getElementById('assign-subject').value = assignment.subjectId;
  document.getElementById('assign-save-label').textContent = 'Update Assignment';
}

function clearAssignmentForm() {
  state.editingAssignmentId = null;
  ['assign-teacher', 'assign-class', 'assign-subject'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('assign-type').value = 'class_teacher';
  document.getElementById('assign-save-label').textContent = 'Save Assignment';
}

async function saveAssignment() {
  const payload = {
    id: state.editingAssignmentId,
    teacherId: document.getElementById('assign-teacher').value,
    teacherType: document.getElementById('assign-type').value,
    classCode: document.getElementById('assign-class').value,
    subjectId: Number(document.getElementById('assign-subject').value),
  };
  if (!payload.teacherId || !payload.classCode || !payload.subjectId) {
    showToast('Choose a teacher, class, and subject');
    return;
  }
  try {
    const data = await apiFetch('/api/admin/teacher-assignments', {
      method: state.editingAssignmentId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    state.setup = data.setup;
    populateStaff();
    populateAdminControls();
    renderAssignments();
    clearAssignmentForm();
    showToast('Assignment saved');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteAssignment(id) {
  try {
    const data = await apiFetch(`/api/admin/teacher-assignments/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateStaff();
    populateAdminControls();
    renderAssignments();
    clearAssignmentForm();
    showToast('Assignment deleted');
  } catch (err) {
    showToast(err.message);
  }
}

function renderPublications() {
  const tbody = document.getElementById('publications-tbody');
  if (!tbody) {
    renderEmailQueue();
    return;
  }
  const rows = state.setup.publications || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);padding:16px;">No published reports yet.</td></tr>';
    renderEmailQueue();
    return;
  }
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.studentName)}</strong><div style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${escapeHtml(row.studentId)}</div></td>
      <td>${escapeHtml(row.classCode)}</td>
      <td>${escapeHtml(row.examType)}</td>
      <td>${escapeHtml(row.parentEmail || '-')}</td>
      <td title="${escapeHtml(row.emailError || '')}" style="color:${row.emailStatus === 'sent' ? 'var(--green)' : row.emailStatus === 'email_failed' ? 'var(--red)' : 'var(--amber)'};">${escapeHtml(emailStatusLabel(row.emailStatus))}</td>
      <td>${escapeHtml(row.publishedAt)}</td>
      <td><a class="post-btn" style="padding:6px 10px;text-decoration:none;display:inline-block;" href="/api/admin/reports/${row.id}/pdf" target="_blank">Download PDF</a></td>
    </tr>`).join('');
  renderEmailQueue();
}

function emailStatusLabel(status) {
  const labels = {
    sent: 'Sent',
    email_failed: 'Email failed',
    email_not_configured: 'Email not configured',
    missing_parent_email: 'Missing parent email',
    missing_email_address: 'Missing email address',
  };
  return labels[status] || status || '-';
}

function renderEmailConfigStatus() {
  const box = document.getElementById('email-config-status');
  if (!box) return;
  const config = state.setup.emailConfig || {};
  const color = config.configured ? 'var(--green)' : 'var(--amber)';
  const bg = config.configured ? 'var(--green-bg)' : 'var(--amber-bg)';
  const title = config.configured ? 'Email is configured' : 'Email is not configured';
  const detail = config.configured
    ? `Reports will be sent from ${config.from} through ${config.host}:${config.port}.`
    : `Missing ${(config.missing || []).join(', ') || 'SMTP settings'}. PDFs will still publish and download, but emails will not send.`;
  box.innerHTML = `
    <div style="border:1px solid ${color};background:${bg};border-radius:var(--radius-sm);padding:10px 12px;">
      <div style="font-size:12px;font-weight:700;color:${color};">${escapeHtml(title)}</div>
      <div style="font-size:11px;color:var(--text-2);line-height:1.45;margin-top:3px;">${escapeHtml(detail)}</div>
    </div>`;
}

async function publishReports() {
  const payload = {
    classCode: document.getElementById('publish-class').value,
    examType: document.getElementById('publish-exam').value,
  };
  if (!payload.classCode || !payload.examType) {
    showToast('Choose a class and exam to publish');
    return;
  }
  try {
    const data = await apiFetch('/api/admin/reports/publish', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.setup = data.setup;
    renderPublications();
    renderEmailQueue();
    renderEmailConfigStatus();
    const sent = data.published.filter(row => row.emailStatus === 'sent').length;
    const notConfigured = data.published.filter(row => row.emailStatus === 'email_not_configured').length;
    const failed = data.published.filter(row => row.emailStatus === 'email_failed').length;
    if (sent) showToast(`${data.published.length} report PDFs published, ${sent} emailed`);
    else if (notConfigured) showToast(`${data.published.length} PDFs published. Email is not configured.`);
    else if (failed) showToast(`${data.published.length} PDFs published. Email sending failed.`);
    else showToast(`${data.published.length} report PDFs published`);
  } catch (err) {
    showToast(err.message);
  }
}

function renderSignaturesPanel() {
  const setup = state.setup;
  if (!setup) return;
  const settings = setup.settings || {};

  const headPreview = document.getElementById('head-sig-preview');
  if (headPreview) {
    if (settings.headSignaturePath) { headPreview.src = '/' + settings.headSignaturePath; headPreview.style.display = ''; }
    else { headPreview.style.display = 'none'; }
  }
  const headName = document.getElementById('head-name');
  if (headName && !headName.value) headName.value = settings.headOfSchoolName || '';

  const teacherSel = document.getElementById('signature-teacher');
  if (teacherSel) {
    const teachers = setup.teachers || [];
    const prevValue = teacherSel.value;
    teacherSel.innerHTML = '<option value="">— Select Teacher —</option>' +
      teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${escapeHtml(t.id)})</option>`).join('');
    if (prevValue && teachers.some(t => t.id === prevValue)) teacherSel.value = prevValue;
    if (!teacherSel.dataset.wired) {
      teacherSel.dataset.wired = '1';
      teacherSel.addEventListener('change', renderTeacherSigPreview);
    }
    renderTeacherSigPreview();
  }
}

function renderTeacherSigPreview() {
  const teacherSel = document.getElementById('signature-teacher');
  const wrap = document.getElementById('teacher-sig-preview-wrap');
  const img = document.getElementById('teacher-sig-preview');
  if (!teacherSel || !wrap || !img) return;
  const teacher = (state.setup.teachers || []).find(t => t.id === teacherSel.value);
  if (teacher && teacher.signaturePath) {
    img.src = '/' + teacher.signaturePath;
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
  }
}

async function uploadHeadSignature() {
  try {
    const dataUrl = await fileToDataUrl('head-signature-file');
    if (!dataUrl) return showToast('Choose a head signature image');
    const data = await apiFetch('/api/admin/signatures', {
      method: 'POST',
      body: JSON.stringify({
        role: 'head',
        headName: document.getElementById('head-name').value,
        dataUrl,
      }),
    });
    state.setup = data.setup;
    document.getElementById('head-signature-file').value = '';
    renderSignaturesPanel();
    showToast('Head signature uploaded');
  } catch (err) {
    showToast(err.message);
  }
}

async function uploadTeacherSignature() {
  try {
    const teacherId = document.getElementById('signature-teacher').value;
    const dataUrl = await fileToDataUrl('teacher-signature-file');
    if (!teacherId) return showToast('Choose a teacher');
    if (!dataUrl) return showToast('Choose a teacher signature image');
    const data = await apiFetch('/api/admin/signatures', {
      method: 'POST',
      body: JSON.stringify({ role: 'teacher', teacherId, dataUrl }),
    });
    state.setup = data.setup;
    document.getElementById('teacher-signature-file').value = '';
    renderSignaturesPanel();
    showToast('Teacher signature uploaded');
  } catch (err) {
    showToast(err.message);
  }
}

function syncStudentAssetFields() {
  const select = document.getElementById('asset-student');
  const email = document.getElementById('asset-parent-email');
  if (!select || !email) return;
  const student = state.setup.students.find(item => item.id === select.value);
  email.value = student?.parentEmail || '';
}

async function updateStudentAssets() {
  const studentId = document.getElementById('asset-student').value;
  if (!studentId) return showToast('Choose a student');
  let photoDataUrl = '';
  try {
    photoDataUrl = await fileToDataUrl('asset-student-photo');
  } catch (err) {
    showToast(err.message);
    return;
  }
  try {
    const data = await apiFetch(`/api/admin/students/${encodeURIComponent(studentId)}/assets`, {
      method: 'POST',
      body: JSON.stringify({
        parentEmail: document.getElementById('asset-parent-email').value,
        photoDataUrl,
      }),
    });
    state.setup = data.setup;
    populateStudents();
    populateAdminControls();
    renderPublications();
    document.getElementById('asset-student').value = studentId;
    syncStudentAssetFields();
    document.getElementById('asset-student-photo').value = '';
    showToast('Student details updated');
  } catch (err) {
    showToast(err.message);
  }
}

function updateStudentFormChrome(editing, student = null) {
  const pageTitle = document.getElementById('stu-form-page-title');
  const pageSub = document.getElementById('stu-form-page-sub');
  const deleteBtn = document.getElementById('student-delete-btn');
  const cancel = document.getElementById('student-cancel-label');
  const title = document.getElementById('student-form-title');
  const save = document.getElementById('student-save-label');

  if (pageTitle) pageTitle.textContent = editing && student ? `Edit Student - ${student.name}` : 'Add Student';
  if (pageSub) {
    pageSub.textContent = editing && student
      ? `Update ${student.name}'s record, reset password, or remove the student.`
      : 'First name, surname, class, and class arm are required — everything else is optional.';
  }
  if (deleteBtn) deleteBtn.style.display = editing ? 'inline-flex' : 'none';
  if (cancel) cancel.textContent = editing ? 'Discard Changes' : 'Clear';
  if (title) title.textContent = editing && student ? `Edit Student - ${student.name}` : 'Add Student';
  if (save) save.textContent = editing ? 'Save Student Changes' : 'Add Student';
}

function clearStudentForm() {
  state.editingStudentId = null;
  ['new-student-id', 'new-student-firstname', 'new-student-surname', 'new-student-othernames', 'new-student-initials', 'new-student-password', 'new-student-avg', 'new-student-att', 'new-student-parent-email'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const id = document.getElementById('new-student-id');
  const cls = document.getElementById('new-student-class');
  const gender = document.getElementById('new-student-gender');
  if (id) id.disabled = false;
  const password = document.getElementById('new-student-password');
  if (password) {
    password.value = DEFAULT_STUDENT_PASSWORD;
    password.placeholder = `Auto password: ${DEFAULT_STUDENT_PASSWORD}`;
    password.readOnly = true;
  }
  if (cls) cls.value = '';
  if (gender) gender.value = 'F';
  const photo = document.getElementById('new-student-photo');
  if (photo) photo.value = '';
  stuLoadArms();
  updateStudentFormChrome(false);
}

function stuLoadArms() {
  const classCode = document.getElementById('new-student-class')?.value || '';
  const armSel = document.getElementById('new-student-arm');
  const hasArms = (state.setup?.classArms || []).some(a => a.classCode === classCode);
  if (armSel) {
    armSel.innerHTML = hasArms ? attArmOptions(classCode, '— Select Arm —') : '<option value="">— This class has no arms —</option>';
    armSel.disabled = !hasArms;
  }
  const label = document.getElementById('new-student-arm-label');
  if (label) label.textContent = hasArms ? 'Class Arm *' : 'Class Arm';
}

function clearStaffForm() {
  state.editingStaffId = null;
  ['new-staff-id', 'new-staff-name', 'new-staff-initials', 'new-staff-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const id = document.getElementById('new-staff-id');
  const role = document.getElementById('new-staff-role');
  const type = document.getElementById('new-staff-teacher-type');
  const title = document.getElementById('staff-form-title');
  const save = document.getElementById('staff-save-label');
  if (id) id.disabled = false;
  const password = document.getElementById('new-staff-password');
  if (password) password.placeholder = 'Temporary password';
  if (role) role.value = 'teacher';
  if (type) {
    type.value = 'class_teacher';
    type.disabled = false;
  }
  if (title) title.textContent = 'Add Staff';
  if (save) save.textContent = 'Add Staff';
}

function syncStaffRoleFields() {
  const role = document.getElementById('new-staff-role')?.value;
  const type = document.getElementById('new-staff-teacher-type');
  if (!type) return;
  type.disabled = role !== 'teacher';
  if (role !== 'teacher') type.value = '';
  else if (!type.value) type.value = 'class_teacher';
}

// Best-effort split of a stored full name into first/other/surname for the
// edit form's separate fields — we only ever store the combined `name`, so
// this is a starting point the admin can correct, not a source of truth.
function splitNameParts(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', otherNames: '', surname: '' };
  if (parts.length === 1) return { firstName: parts[0], otherNames: '', surname: '' };
  return { firstName: parts[0], otherNames: parts.slice(1, -1).join(' '), surname: parts[parts.length - 1] };
}

function editStudent(id) {
  const student = state.setup.students.find(item => item.id === id);
  if (!student) return showToast('Student not found');
  state.editingStudentId = student.id;
  switchTab('addStudent', document.querySelector('[data-tab="addStudent"]'), 'Edit Student', `Edit ${student.name}`);
  const { firstName, otherNames, surname } = splitNameParts(student.name);
  document.getElementById('new-student-id').value = student.id;
  document.getElementById('new-student-id').disabled = true;
  document.getElementById('new-student-firstname').value = firstName;
  document.getElementById('new-student-surname').value = surname;
  document.getElementById('new-student-othernames').value = otherNames;
  document.getElementById('new-student-initials').value = student.initials || '';
  const password = document.getElementById('new-student-password');
  password.value = '';
  password.placeholder = 'Leave blank to keep current password';
  password.readOnly = false;
  document.getElementById('new-student-gender').value = student.gender || 'F';
  document.getElementById('new-student-class').value = student.classCode || '';
  stuLoadArms();
  document.getElementById('new-student-arm').value = student.classArmId || '';
  document.getElementById('new-student-parent-email').value = student.parentEmail || '';
  document.getElementById('new-student-avg').value = student.avg ?? '';
  document.getElementById('new-student-att').value = student.att ?? '';
  document.getElementById('new-student-photo').value = '';
  updateStudentFormChrome(true, student);
  document.getElementById('new-student-firstname').focus();
}

async function saveStudent() {
  let photoDataUrl = '';
  try {
    photoDataUrl = await fileToDataUrl('new-student-photo');
  } catch (err) {
    showToast(err.message);
    return;
  }
  const firstName = document.getElementById('new-student-firstname').value.trim();
  const surname = document.getElementById('new-student-surname').value.trim();
  const otherNames = document.getElementById('new-student-othernames').value.trim();
  const classCode = document.getElementById('new-student-class').value;
  const classArmId = document.getElementById('new-student-arm').value || null;
  if (!firstName || !surname) {
    showToast('First name and surname are required');
    return;
  }
  if (!classCode) {
    showToast('Class is required');
    return;
  }
  const classHasArms = (state.setup.classArms || []).some(a => a.classCode === classCode);
  if (!classArmId && classHasArms) {
    showToast('Class arm is required');
    return;
  }
  const name = [firstName, otherNames, surname].filter(Boolean).join(' ');
  const payload = {
    id: document.getElementById('new-student-id').value,
    name,
    firstName,
    initials: document.getElementById('new-student-initials').value,
    password: state.editingStudentId ? document.getElementById('new-student-password').value : DEFAULT_STUDENT_PASSWORD,
    gender: document.getElementById('new-student-gender').value,
    classCode,
    classArmId,
    parentEmail: document.getElementById('new-student-parent-email').value,
    avg: document.getElementById('new-student-avg').value,
    att: document.getElementById('new-student-att').value,
    photoDataUrl,
  };
  try {
    const url = state.editingStudentId
      ? `/api/admin/students/${encodeURIComponent(state.editingStudentId)}`
      : '/api/admin/students';
    const data = await apiFetch(url, {
      method: state.editingStudentId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    state.setup = data.setup;
    populateDashboard();
    populateStudents();
    populateParents();
    populateAdminControls();
    renderPublications();
    const action = state.editingStudentId ? 'updated' : 'added';
    clearStudentForm();
    switchTab('students', document.querySelector('[data-tab="students"]'), 'Students', 'Student Records');
    showToast(`Student ${action}`);
  } catch (err) {
    showToast(err.message);
  }
}

function openStudentDeleteModal() {
  const id = state.editingStudentId;
  const student = state.setup.students.find(item => item.id === id);
  if (!student) return showToast('Open a student record before deleting');
  state.pendingDeleteStudentId = student.id;
  const body = document.getElementById('student-delete-body');
  const modal = document.getElementById('student-delete-modal');
  if (body) {
    body.textContent = `This will permanently remove ${student.name} (${student.id}), including the student's login account, result entries, and published report records.`;
  }
  if (modal) modal.style.display = 'flex';
  document.getElementById('student-delete-confirm')?.focus();
}

function closeStudentDeleteModal() {
  state.pendingDeleteStudentId = null;
  const modal = document.getElementById('student-delete-modal');
  if (modal) modal.style.display = 'none';
}

async function confirmDeleteStudent() {
  const id = state.pendingDeleteStudentId;
  if (!id) return closeStudentDeleteModal();
  await deleteStudent(id);
}

async function deleteStudent(id) {
  const student = state.setup.students.find(item => item.id === id);
  if (!student) return showToast('Student not found');
  try {
    const data = await apiFetch(`/api/admin/students/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateDashboard();
    populateStudents();
    populateParents();
    populateAdminControls();
    renderPublications();
    if (state.editingStudentId === id) {
      clearStudentForm();
      switchTab('students', document.querySelector('[data-tab="students"]'), 'Students', 'Student Records');
    }
    closeStudentDeleteModal();
    showToast('Student removed');
  } catch (err) {
    showToast(err.message);
  }
}

async function addStudent() {
  return saveStudent();
}

// ── IMPORT STUDENT RECORDS (.xlsx) ──

function impInit() {
  const fileInput = document.getElementById('imp-file');
  if (fileInput) fileInput.value = '';
  const status = document.getElementById('imp-status');
  if (status) status.textContent = '';
  document.getElementById('imp-review-card').style.display = 'none';
  const resultCard = document.getElementById('imp-result-card');
  resultCard.style.display = 'none';
  resultCard.innerHTML = '';
  state.importPreview = null;
  state.importClasses = null;
}

async function impPreview() {
  const fileInput = document.getElementById('imp-file');
  if (!fileInput?.files?.[0]) return showToast('Choose a .xlsx file first');
  const status = document.getElementById('imp-status');
  status.textContent = 'Reading file…';
  try {
    const fileDataUrl = await fileToDataUrl('imp-file');
    const data = await apiFetch('/api/admin/students/import/preview', {
      method: 'POST',
      body: JSON.stringify({ fileDataUrl }),
    });
    state.importClasses = data.classes || [];
    state.importPreview = (data.preview || []).map(row => ({ ...row, included: row.ready }));
    renderImportPreview();
    const ready = state.importPreview.filter(r => r.ready).length;
    status.textContent = `${data.totalRows} row${data.totalRows === 1 ? '' : 's'} found — ${ready} ready, ${data.totalRows - ready} need review before they can be imported.`;
  } catch (err) {
    status.textContent = '';
    showToast(err.message);
  }
}

function impClassOptions(selectedCode) {
  return '<option value="">— Select —</option>' + (state.importClasses || []).map(c =>
    `<option value="${escapeHtml(c.code)}" ${c.code === selectedCode ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
  ).join('');
}

function renderImportPreview() {
  const rows = state.importPreview || [];
  const card = document.getElementById('imp-review-card');
  card.style.display = rows.length ? '' : 'none';
  document.getElementById('imp-tbody').innerHTML = rows.map((r, i) => {
    const name = [r.firstName, r.otherNames, r.surname].filter(Boolean).join(' ') || '(no name)';
    return `<tr style="${r.ready ? '' : 'background:var(--red-bg);'}">
      <td><input type="checkbox" ${r.included ? 'checked' : ''} ${r.ready ? '' : 'disabled'} onchange="impToggleRow(${i}, this.checked)"></td>
      <td style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px;">${r.rowNumber}</td>
      <td>${escapeHtml(name)}</td>
      <td><select class="ctrl-select" style="min-width:70px;" onchange="impUpdateRow(${i},'gender',this.value)">
        <option value="" ${!r.gender ? 'selected' : ''}>—</option>
        <option value="F" ${r.gender === 'F' ? 'selected' : ''}>Female</option>
        <option value="M" ${r.gender === 'M' ? 'selected' : ''}>Male</option>
      </select></td>
      <td><select class="ctrl-select" style="min-width:140px;${r.classCode ? '' : 'border-color:var(--red);'}" onchange="impUpdateRow(${i},'classCode',this.value)">${impClassOptions(r.classCode)}</select></td>
      <td>
        <input class="field-input" style="min-width:110px;${r.armName ? '' : 'border-color:var(--red);'}" value="${escapeHtml(r.armName)}" onchange="impUpdateRow(${i},'armName',this.value)" placeholder="Arm name">
        ${r.armWillCreate ? '<div style="font-size:10px;color:var(--amber);">will create this arm</div>' : ''}
      </td>
      <td style="font-size:11px;color:var(--text-3);">${escapeHtml(r.parentEmail || '-')}</td>
      <td>${r.ready ? '<span class="chip-green">Ready</span>' : '<span class="chip-amber">Needs Review</span>'}</td>
    </tr>`;
  }).join('');
}

function impToggleRow(i, checked) {
  const row = state.importPreview?.[i];
  if (!row) return;
  row.included = checked;
}

function impUpdateRow(i, field, value) {
  const row = state.importPreview?.[i];
  if (!row) return;
  row[field] = value;
  if (field === 'classCode') {
    const armExists = (state.importClasses || []).find(c => c.code === value)?.arms?.some(a => a.toLowerCase() === (row.armName || '').toLowerCase());
    row.armWillCreate = !!(value && row.armName && !armExists);
  }
  if (field === 'armName') {
    const armExists = (state.importClasses || []).find(c => c.code === row.classCode)?.arms?.some(a => a.toLowerCase() === value.toLowerCase());
    row.armWillCreate = !!(row.classCode && value && !armExists);
  }
  row.ready = !!(row.firstName && row.surname && row.classCode && row.armName);
  row.included = row.ready;
  renderImportPreview();
}

async function impCommit() {
  const rows = (state.importPreview || []).filter(r => r.included && r.ready);
  if (!rows.length) return showToast('No ready, checked rows to import');
  const btn = document.getElementById('imp-commit-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const data = await apiFetch('/api/admin/students/import/commit', {
      method: 'POST',
      body: JSON.stringify({
        rows: rows.map(r => ({
          rowNumber: r.rowNumber, firstName: r.firstName, surname: r.surname, otherNames: r.otherNames,
          gender: r.gender, parentEmail: r.parentEmail, classCode: r.classCode, armName: r.armName,
        })),
      }),
    });
    state.setup = data.setup;
    populateDashboard();
    populateStudents();
    populateParents();
    populateAdminControls();
    renderPublications();

    const resultCard = document.getElementById('imp-result-card');
    resultCard.style.display = '';
    resultCard.innerHTML = `<div class="card">
      <div class="card-head"><span class="card-title">Import Complete</span></div>
      <div class="card-body">
        <p style="color:var(--green);font-weight:700;">${data.created.length} student${data.created.length === 1 ? '' : 's'} created.</p>
        ${data.failed.length ? `<p style="color:var(--red);margin-top:10px;">${data.failed.length} row${data.failed.length === 1 ? '' : 's'} failed:</p><ul style="font-size:12px;color:var(--text-3);">${data.failed.map(f => `<li>Row ${f.rowNumber}: ${escapeHtml(f.error)}</li>`).join('')}</ul>` : ''}
        <button class="post-btn" onclick="switchTab('students', document.querySelector('[data-tab=&quot;students&quot;]'), 'Students', 'Student Records')" style="margin-top:12px;">Go to Student Directory</button>
      </div>
    </div>`;

    const importedRowNumbers = new Set(rows.map(r => r.rowNumber));
    state.importPreview = (state.importPreview || []).filter(r => !importedRowNumbers.has(r.rowNumber));
    renderImportPreview();
    showToast(`${data.created.length} student(s) imported`);
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Selected Students';
  }
}

function editStaff(id) {
  const staff = state.setup.staff.find(item => item.id === id);
  if (!staff) return showToast('Staff account not found');
  state.editingStaffId = staff.id;
  document.getElementById('new-staff-id').value = staff.id;
  document.getElementById('new-staff-id').disabled = true;
  document.getElementById('new-staff-name').value = staff.name || '';
  document.getElementById('new-staff-initials').value = staff.initials || '';
  document.getElementById('new-staff-password').value = '';
  document.getElementById('new-staff-password').placeholder = 'Leave blank to keep current password';
  document.getElementById('new-staff-role').value = staff.role || 'teacher';
  document.getElementById('new-staff-teacher-type').value = staff.teacherType || (staff.role === 'teacher' ? 'class_teacher' : '');
  syncStaffRoleFields();
  const title = document.getElementById('staff-form-title');
  const save = document.getElementById('staff-save-label');
  if (title) title.textContent = `Edit Staff - ${staff.name}`;
  if (save) save.textContent = 'Save Staff Changes';
  document.getElementById('staff-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('new-staff-name').focus();
}

let staffProfileId = '';

function openStaffProfile(id) {
  const staff = (state.setup.staff || []).find(item => item.id === id);
  if (!staff) return showToast('Staff account not found');
  staffProfileId = staff.id;
  const modal = document.getElementById('staff-profile-modal');
  if (!modal) return;
  document.getElementById('staff-profile-name').textContent = staff.name || staff.id;
  document.getElementById('staff-profile-role').textContent = staff.roleLabel || (staff.role === 'admin' ? 'Administrator' : 'Staff');
  modal.style.display = 'flex';
  renderStaffProfileTab('profile');
}

function closeStaffProfile() {
  const modal = document.getElementById('staff-profile-modal');
  if (modal) modal.style.display = 'none';
  staffProfileId = '';
}

function renderStaffProfileTab(tab) {
  const staff = (state.setup.staff || []).find(item => item.id === staffProfileId);
  if (!staff) return closeStaffProfile();
  document.querySelectorAll('#staff-profile-modal .staff-profile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.profileTab === tab);
  });
  const body = document.getElementById('staff-profile-body');
  if (!body) return;
  if (tab === 'subjects') return renderStaffProfileSubjects(staff);
  if (tab === 'formClass') {
    body.innerHTML = `<div class="staff-profile-empty"><strong>Form Class</strong><span>${escapeHtml(staff.teacherType === 'class_teacher' ? 'Class teacher assignments are listed under Subjects.' : 'No form class is currently assigned.')}</span></div>`;
    return;
  }
  if (tab === 'activity') {
    body.innerHTML = '<div class="staff-profile-empty"><strong>Activity</strong><span>No staff activity records are available yet.</span></div>';
    return;
  }
  const assignments = staffAssignments(staff);
  const rows = [
    ['Name', staff.name || ''],
    ['Staff ID / Number', staff.id || ''],
    ['Account Status', staff.active === false ? 'Deactivated' : 'Active'],
    ['Profile Type', staff.role === 'admin' ? 'Administrator' : 'Teacher'],
    ['Designation', staff.roleLabel || (staff.role === 'admin' ? 'Administrator' : 'Staff')],
    ['Teacher Type', staff.teacherType === 'subject_teacher' ? 'Subject Teacher' : staff.teacherType === 'class_teacher' ? 'Class Teacher' : ''],
    ['Assignments', assignments],
  ];
  body.innerHTML = `<div class="staff-profile-details">${rows.map(([label, value]) => `<div class="staff-profile-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Not set')}</strong></div>`).join('')}</div>`;
}

function renderStaffProfileSubjects(staff) {
  const body = document.getElementById('staff-profile-body');
  if (!body) return;
  const assignments = (state.setup.assignments || []).filter(item => item.teacherId === staff.id);
  body.innerHTML = `
    <div class="staff-subjects-toolbar">
      <span>Teacher: <strong>${escapeHtml(staff.name)}</strong></span>
      <button type="button" class="post-btn" onclick="openTeacherSubjectsManager('${escapeHtml(staff.id)}')">Assign / Manage Teacher's Subjects</button>
    </div>
    <table class="data-table staff-subjects-table">
      <thead><tr><th>#</th><th>Subject</th><th>Class</th><th>Role</th></tr></thead>
      <tbody>${assignments.length ? assignments.map((assignment, index) => `<tr><td>${index + 1}.</td><td>${escapeHtml(assignment.subjectName)}</td><td>${escapeHtml(assignment.classLabel || assignment.classCode)}</td><td>${escapeHtml(assignment.teacherType === 'class_teacher' ? 'Class Teacher' : 'Subject Teacher')}</td></tr>`).join('') : '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No subjects assigned.</td></tr>'}</tbody>
    </table>`;
}

function openTeacherSubjectsManager(id) {
  staffProfileId = id;
  const manager = document.getElementById('teacher-subjects-modal');
  if (!manager) return;
  const staff = (state.setup.staff || []).find(item => item.id === id);
  document.getElementById('teacher-subjects-title').textContent = `Teacher Subjects | ${staff?.name || id}`;
  manager.style.display = 'flex';
  populateTeacherSubjectForm();
  renderTeacherSubjectsManager();
}

function closeTeacherSubjectsManager() {
  const manager = document.getElementById('teacher-subjects-modal');
  if (manager) manager.style.display = 'none';
  renderStaffProfileTab('subjects');
}

function renderTeacherSubjectsManager() {
  const tbody = document.getElementById('teacher-subjects-tbody');
  if (!tbody) return;
  const assignments = (state.setup.assignments || []).filter(item => item.teacherId === staffProfileId);
  tbody.innerHTML = assignments.length ? assignments.map((assignment, index) => `
    <tr>
      <td>${index + 1}.</td>
      <td>${escapeHtml(assignment.subjectName)}</td>
      <td>${escapeHtml(assignment.classLabel || assignment.classCode)}</td>
      <td><select class="ctrl-select staff-assignment-role" onchange="changeStaffAssignmentRole(${assignment.id}, this.value)">
        <option value="subject_teacher"${assignment.teacherType === 'subject_teacher' ? ' selected' : ''}>Subject Teacher</option>
        <option value="class_teacher"${assignment.teacherType === 'class_teacher' ? ' selected' : ''}>Class Teacher</option>
      </select></td>
      <td><button type="button" class="ann-del" onclick="removeStaffAssignment(${assignment.id})">Remove</button></td>
    </tr>`).join('') : '<tr><td colspan="5" style="padding:18px;color:var(--text-3);">No subjects assigned.</td></tr>';
}

function populateTeacherSubjectForm() {
  const classSelect = document.getElementById('staff-new-subject-class');
  const subjectSelect = document.getElementById('staff-new-subject-subject');
  if (classSelect) classSelect.innerHTML = '<option value="">Select class...</option>' +
    (state.setup.classes || []).map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join('');
  if (subjectSelect) subjectSelect.innerHTML = '<option value="">Select subject...</option>' +
    (state.setup.subjects || []).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
}

async function changeStaffAssignmentRole(id, teacherType) {
  const assignment = (state.setup.assignments || []).find(item => Number(item.id) === Number(id));
  if (!assignment) return;
  try {
    const data = await apiFetch('/api/admin/teacher-assignments', {
      method: 'PUT',
      body: JSON.stringify({ id: assignment.id, teacherId: assignment.teacherId, teacherType, classCode: assignment.classCode, subjectId: assignment.subjectId }),
    });
    state.setup = data.setup;
    renderTeacherSubjectsManager();
    populateStaff();
    showToast('Teacher assignment role updated');
  } catch (err) { showToast(err.message, 'warn'); }
}

async function removeStaffAssignment(id) {
  try {
    const data = await apiFetch(`/api/admin/teacher-assignments/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    renderTeacherSubjectsManager();
    populateStaff();
    showToast('Subject assignment removed');
  } catch (err) { showToast(err.message, 'warn'); }
}

async function bulkManageStaffRoles() {
  const teacherType = document.getElementById('staff-bulk-role')?.value;
  const assignments = (state.setup.assignments || []).filter(item => item.teacherId === staffProfileId);
  if (!teacherType || !assignments.length) return;
  try {
    for (const assignment of assignments) {
      await apiFetch('/api/admin/teacher-assignments', {
        method: 'PUT',
        body: JSON.stringify({ id: assignment.id, teacherId: assignment.teacherId, teacherType, classCode: assignment.classCode, subjectId: assignment.subjectId }),
      });
    }
    state.setup = await apiFetch('/api/admin/result-setup');
    renderTeacherSubjectsManager();
    populateStaff();
    showToast('Assignment roles updated');
  } catch (err) { showToast(err.message, 'warn'); }
}

async function assignStaffSubject() {
  const classCode = document.getElementById('staff-new-subject-class')?.value;
  const subjectId = Number(document.getElementById('staff-new-subject-subject')?.value || 0);
  const teacherType = document.getElementById('staff-new-subject-role')?.value;
  if (!classCode || !subjectId || !teacherType) return showToast('Choose a subject, class, and role', 'warn');
  try {
    const data = await apiFetch('/api/admin/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify({ teacherId: staffProfileId, teacherType, classCode, subjectId }),
    });
    state.setup = data.setup;
    renderTeacherSubjectsManager();
    populateStaff();
    showToast('Subject assigned to teacher');
  } catch (err) { showToast(err.message, 'warn'); }
}

async function saveStaff() {
  const payload = {
    id: document.getElementById('new-staff-id').value,
    name: document.getElementById('new-staff-name').value,
    initials: document.getElementById('new-staff-initials').value,
    password: document.getElementById('new-staff-password').value,
    role: document.getElementById('new-staff-role').value,
    teacherType: document.getElementById('new-staff-teacher-type').value,
  };
  if (!payload.id || !payload.name || !payload.role || (!state.editingStaffId && !payload.password)) {
    showToast('Staff ID, name, role, and password are required');
    return;
  }
  if (payload.role === 'teacher' && !payload.teacherType) {
    showToast('Choose a teacher type');
    return;
  }
  try {
    const url = state.editingStaffId
      ? `/api/admin/staff/${encodeURIComponent(state.editingStaffId)}`
      : '/api/admin/staff';
    const data = await apiFetch(url, {
      method: state.editingStaffId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    state.setup = data.setup;
    populateStaff();
    populateAdminControls();
    renderAssignments();
    const action = state.editingStaffId ? 'updated' : 'added';
    clearStaffForm();
    showToast(`Staff account ${action}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function addStaff() {
  return saveStaff();
}

function renderAnnouncements() {
  const list = document.getElementById('ann-list');
  const countLabel = document.getElementById('ann-count-label');
  const badge = document.getElementById('ann-badge');
  if (!announcements.length) {
    list.innerHTML = `<div style="padding:32px 0;text-align:center;color:var(--text-3);font-size:13px;">No announcements posted yet.</div>`;
    countLabel.textContent = '0 active';
    badge.textContent = '0';
    return;
  }
  countLabel.textContent = `${announcements.length} active`;
  badge.textContent = announcements.length;
  list.innerHTML = announcements.map(ann => `
    <div class="ann-item" id="ann-${ann.id}">
      <div class="ann-line" style="background:${priorityColor(ann.priority)};"></div>
      <div style="flex:1;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;"><div class="ann-title">${escapeHtml(ann.title)}</div><button class="ann-del" onclick="deleteAnnouncement(${ann.id})" title="Delete">x</button></div><div class="ann-desc">${escapeHtml(ann.body)}</div><div style="display:flex;gap:10px;align-items:center;margin-top:5px;"><span class="ann-date">${escapeHtml(ann.date)}</span><span style="font-size:9px;font-weight:700;font-family:'DM Mono',monospace;padding:1px 6px;border-radius:3px;text-transform:uppercase;background:${ann.priority === 'urgent' ? 'var(--red-bg)' : ann.priority === 'important' ? 'var(--amber-bg)' : 'var(--green-bg)'};color:${priorityColor(ann.priority)};">${escapeHtml(ann.priority)}</span></div></div>
    </div>`).join('');
}

function postAnnouncement() {
  const title = document.getElementById('ann-title-in').value.trim();
  const body = document.getElementById('ann-body-in').value.trim();
  const priority = document.querySelector('input[name="priority"]:checked')?.value || 'normal';
  if (!title) return showToast('Please enter a title for the announcement');
  if (!body) return showToast('Please enter the announcement message');
  announcements.unshift({ id: Date.now(), title, body, date: nowDateString(), priority });
  renderAnnouncements();
  document.getElementById('ann-title-in').value = '';
  document.getElementById('ann-body-in').value = '';
  document.querySelector('input[name="priority"][value="normal"]').checked = true;
  showToast('Announcement posted successfully');
}

function deleteAnnouncement(id) {
  announcements = announcements.filter(a => a.id !== id);
  renderAnnouncements();
  showToast('Announcement removed');
}

const TAB_META = {
  dashboard: { title: 'Dashboard', sub: 'School Overview' },
  admissions: { title: 'Admission', sub: 'Applications Summary' },
  students: { title: 'Admission', sub: 'Student Directory' },
  staff: { title: 'People', sub: 'Teachers and Staff' },
  parents: { title: 'Parents', sub: 'Parent and Guardian Records' },
  selfRegistration: { title: 'Self Registration', sub: 'Registration Requests' },
  announcements: { title: 'Admin', sub: 'Post and Manage Notices' },
  resultChecker: { title: 'Result Checker', sub: 'Published Reports and Downloads' },
  cbtGradebook: { title: 'CBT Grade Book', sub: 'Computer-Based Test Scores' },
  dailyGradebook: { title: 'Daily Grade Book', sub: 'Daily Assessment Scores' },
  resultsGradebook: { title: 'Results Grade Book', sub: 'Result Score Entry' },
  cognitiveSkills: { title: 'Cognitive Skills Assessment', sub: 'Skills Assessment Records' },
  publish: { title: 'Review And Publish Results', sub: 'Review and Publish Student Reports' },
  emailQueue: { title: 'Results Email Delivery Queue', sub: 'Published Report Email Status' },
  settings: { title: 'Result Settings', sub: 'Staff, Students, and Result Assignments' },
  academics: { title: 'Academics', sub: 'Academic Activities' },
  classes: { title: 'Classes', sub: 'Classes and class arms' },
  subjects: { title: 'Subjects', sub: 'Class subjects and subject bank' },
  exams: { title: 'Exams', sub: 'Exam Activities' },
  eclass: { title: 'E-Class', sub: 'Digital Classroom' },
  questionBank: { title: 'Question Bank', sub: 'CBT Questions by Class and Subject' },
  instructionSets: { title: 'Instruction Sets', sub: 'Reusable CBT Exam Instructions' },
  cbtSchedules: { title: 'CBT Schedules', sub: 'Computer-Based Test Schedules' },
  cbtScores: { title: 'CBT Scores', sub: 'Computer-Based Test Results' },
  examPractice: { title: 'Exam Practice', sub: 'Self-Paced CBT Practice' },
  studentTags: { title: 'Student Tags', sub: 'Group and Filter Students by Tag' },
  classAllocation: { title: 'Class Allocation / Transfer / Graduation', sub: 'Promote, Transfer, or Graduate Students' },
  enrollmentHistory: { title: 'Enrollment History', sub: 'Student Enrollment Timeline' },
  studentsRegistry: { title: 'Students Registry', sub: 'Printable Student Roster' },
  communicationBook: { title: 'Communication Book', sub: 'Student and Parent Communication Log' },
  extracurricularGroups: { title: 'Extracurricular Groups', sub: 'Clubs, Teams, and Groups' },
  invoiceList: { title: 'Invoice List', sub: 'All Student Fee Invoices' },
  classInvoiceHistory: { title: 'Class Invoice History', sub: 'Invoice History by Class' },
  familyFeesHistory: { title: 'Family Fees History', sub: 'Fee Payment History by Family' },
  reviewPaymentProofs: { title: 'Review Payment Proofs', sub: 'Proof of Payment Submissions' },
  verifyPaymentStatus: { title: 'Verify Payment Status', sub: 'Confirm and Reconcile Payments' },
  successfulPayments: { title: 'Successful Payments', sub: 'Completed Fee Payments' },
  allPaymentAttempts: { title: 'All Payment Attempts', sub: 'All Fee Payment Attempts' },
  feesDebtors: { title: 'Fees Debtors', sub: 'Outstanding Fee Balances' },
  expenseRequests: { title: 'Expense Requests', sub: 'Pending and Approved Expense Requests' },
  expenses: { title: 'Expenses', sub: 'Recorded School Expenses' },
  income: { title: 'Income', sub: 'Recorded School Income' },
  incomeExpensesAnalytics: { title: 'Income & Expenses Analytics', sub: 'Income and Expense Trends' },
  monthlySalariesProcessing: { title: 'Monthly Salaries Processing', sub: 'Process Monthly Staff Salaries' },
  salaryPaymentSchedule: { title: 'Salary Payment Schedule', sub: 'Scheduled Salary Payment Dates' },
  payrollSettings: { title: 'Payroll Settings', sub: 'Payroll Configuration' },
  staffLoansAdvances: { title: 'Staff Loans & Advances', sub: 'Staff Loan and Advance Records' },
  visitStorefront: { title: 'Visit Storefront', sub: 'Public-Facing Storefront' },
  posTerminal: { title: 'Point-of-Sale Terminal', sub: 'In-Person Sales Terminal' },
  ordersSales: { title: 'Orders & Sales', sub: 'Store Orders and Sales' },
  products: { title: 'Products', sub: 'Store Product Catalog' },
  categories: { title: 'Categories', sub: 'Product Categories' },
  inventorySupply: { title: 'Inventory & Supply', sub: 'Stock Levels and Supply Records' },
  storeSettings: { title: 'Store Settings', sub: 'Store Configuration' },
  storefrontBanners: { title: 'Storefront Banners', sub: 'Promotional Storefront Banners' },
  storefrontHomepageSections: { title: 'Storefront Homepage Sections', sub: 'Storefront Homepage Layout' },
  internalRequisitions: { title: 'Internal Requisitions', sub: 'Internal Stock Requisitions' },
  chartOfAccounts: { title: 'Chart of Accounts', sub: 'Financial Account List' },
  journalEntries: { title: 'Journal Entries', sub: 'Manual Accounting Journal Entries' },
  accountLedger: { title: 'Account Ledger', sub: 'General Ledger of Account Activity' },
  trialBalance: { title: 'Trial Balance', sub: 'Trial Balance Summary' },
  contactsBillsInvoices: { title: 'Contacts, Bills & Invoices', sub: 'Vendor and Customer Records' },
  budgets: { title: 'Budgets', sub: 'Budget Planning and Tracking' },
  bankReconciliation: { title: 'Bank Reconciliation', sub: 'Reconcile Bank Statements' },
  taxCompliance: { title: 'Tax & Compliance', sub: 'Tax Filings and Compliance' },
  financialReports: { title: 'Financial Reports', sub: 'Generated Financial Reports' },
  attendance: { title: 'Attendance', sub: 'Attendance Records' },
  markDailyAttendance: { title: 'Mark Daily Attendance', sub: 'Mark student daily attendance' },
  dailyAttendanceReport: { title: 'Daily Attendance Report', sub: 'View student attendance report' },
  markLessonAttendance: { title: 'Mark Lesson Attendance', sub: 'Mark student lesson attendance' },
  lessonAttendanceReport: { title: 'Lesson Attendance Report', sub: 'View lesson attendance report' },
  markStaffAttendance: { title: 'Mark Staff Attendance', sub: 'Mark staff daily attendance' },
  staffAttendanceReport: { title: 'Staff Attendance Report', sub: 'View staff attendance report' },
};

function showAdminSection(section, trigger) {
  document.querySelectorAll('.rail-item').forEach(item => item.classList.remove('active'));
  if (trigger) trigger.classList.add('active');
  document.querySelectorAll('.sub-menu').forEach(menu => menu.classList.remove('active'));
  const menu = document.querySelector(`.sub-menu[data-menu="${section}"]`);
  if (menu) menu.classList.add('active');
  // Clear any active sub-nav highlight — content only changes when sub-menu is clicked
  document.querySelectorAll('.sub-nav-item').forEach(item => item.classList.remove('active'));
  const search = document.querySelector('.admin-quick-search input');
  if (search) filterAdminSidebar(search.value);
}

function toggleDropdown(childId, chevId, btn) {
  const children = document.getElementById(childId);
  const chev = document.getElementById(chevId);
  if (!children) return;
  const open = children.classList.contains('open');
  // close all siblings first
  const parent = btn.closest('.sub-menu');
  if (parent) {
    parent.querySelectorAll('.result-gradebook-children').forEach(el => {
      if (el !== children) {
        el.classList.remove('open');
        el.style.display = '';
      }
    });
    parent.querySelectorAll('.sub-chev').forEach(el => {
      if (el.id !== chevId) el.classList.remove('open');
    });
    parent.querySelectorAll('.sub-nav-item').forEach(el => {
      if (el !== btn) el.classList.remove('active');
    });
  }
  if (open) {
    children.classList.remove('open');
    if (chev) chev.classList.remove('open');
  } else {
    // must be display:block for max-height transition to work
    children.style.display = 'block';
    requestAnimationFrame(() => children.classList.add('open'));
    if (chev) chev.classList.add('open');
  }
  btn.classList.toggle('active', !open);
}

function filterAdminSidebar(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('.sub-nav-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function syncSidebarForTab(tab, trigger) {
  const direct = document.querySelector(`.sub-nav-item[data-tab="${tab}"]`);
  const item = trigger?.classList?.contains('sub-nav-item') ? trigger : direct;
  if (!item) return;
  document.querySelectorAll('.sub-nav-item').forEach(nav => nav.classList.remove('active'));
  item.classList.add('active');
  const menu = item.closest('.sub-menu');
  if (!menu) return;
  document.querySelectorAll('.sub-menu').forEach(candidate => candidate.classList.remove('active'));
  menu.classList.add('active');
  const section = menu.dataset.menu;
  document.querySelectorAll('.rail-item').forEach(rail => {
    rail.classList.toggle('active', rail.dataset.section === section);
  });
}

function switchTab(tab, trigger, titleOverride, subOverride) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById(`tab-${tab}`);
  if (!panel) return;
  panel.classList.add('active');
  if (trigger?.classList?.contains('nav-item')) trigger.classList.add('active');
  syncSidebarForTab(tab, trigger);
  const meta = TAB_META[tab] || {};
  document.getElementById('topbar-title').textContent = titleOverride || trigger?.dataset?.title || meta.title || tab;
  document.getElementById('topbar-sub').textContent = subOverride || trigger?.dataset?.sub || meta.sub || '';
  if (tab === 'settings') renderAssignments();
  if (tab === 'resultsGradebook') {
    const card = document.getElementById('gb-entry-card');
    if (card) card.style.display = 'none';
    populateGradebookControls();
  }
  if (tab === 'cognitiveSkills') {
    populateCognitiveControls();
    viewCognitiveClass();
  }
  if (tab === 'emailQueue') renderEmailQueue();
  if (tab === 'admissions') loadAdmissions();
  if (tab === 'importStudents') impInit();
  if (tab === 'studentResultChecker') srcInit();
  if (tab === 'classResultChecker') crcInit();
  if (tab === 'markDailyAttendance') mdaInit();
  if (tab === 'dailyAttendanceReport') darInit();
  if (tab === 'markLessonAttendance') mlaInit();
  if (tab === 'lessonAttendanceReport') larInit();
  if (tab === 'markStaffAttendance') msaInit();
  if (tab === 'staffAttendanceReport') sarInit();
  if (tab === 'invoiceList') ilInit();
  if (tab === 'classInvoiceHistory') cihInit();
  if (tab === 'familyFeesHistory') ffhInit();
  if (tab === 'reviewPaymentProofs') rppInit();
  if (tab === 'successfulPayments') fspInit();
  if (tab === 'allPaymentAttempts') apInit();
  if (tab === 'feesDebtors') fdInit();
  if (tab === 'expenseRequests') erInit();
  if (tab === 'expenses') expInit();
  if (tab === 'income') incInit();
  if (tab === 'incomeExpensesAnalytics') ieaInit();
  if (tab === 'monthlySalariesProcessing') mspInit();
  if (tab === 'salaryPaymentSchedule') spsInit();
  if (tab === 'payrollSettings') prInit();
  if (tab === 'staffLoansAdvances') slInit();
  if (tab === 'publish') {
    const sec = document.getElementById('bs-results-section');
    if (sec) sec.style.display = 'none';
    renderPublications();
    populateBroadsheetControls();
  }
  if (tab === 'classes') populateClasses();
  if (tab === 'subjects') populateSubjects();
  if (tab === 'systemSettings') loadSystemSettings();
  if (tab === 'academicTerms') { loadAcademicTermsTab(); loadCalendarTab(); }
  if (tab === 'scoreDivisions') sdInit();
  if (tab === 'commentsBank') cbLoadComments();
  if (tab === 'resultPrefs') { switchRspTab('sheet'); renderSignaturesPanel(); }
  if (tab === 'scheduleExam') populateScheduleExamSelects();
  if (tab === 'examTimetable') loadExamTimetable();
  if (tab === 'questionBank') qbInit();
  if (tab === 'instructionSets') isInit();
  if (tab === 'cbtSchedules') csInit();
  if (tab === 'cbtScores') cscInit();
  if (tab === 'studentTags') stInit();
  if (tab === 'classAllocation') caInit();
  if (tab === 'enrollmentHistory') ehInit();
  if (tab === 'studentsRegistry') srInit();
  if (tab === 'communicationBook') cbkInit();
  if (tab === 'extracurricularGroups') ecgInit();
  if (tab === 'gradingSystems') initGradingSystemsTab();
  if (tab === 'configCognitive') initSkillsConfigTab();
  // ── Finance: Store & Inventory / Accounting ──
  if (tab === 'visitStorefront') finVisitStorefrontInit();
  if (tab === 'posTerminal') finPosInit();
  if (tab === 'ordersSales') finOrdersInit();
  if (tab === 'products') finProductsInit();
  if (tab === 'categories') finCategoriesInit();
  if (tab === 'inventorySupply') finInventoryInit();
  if (tab === 'storeSettings') finStoreSettingsInit();
  if (tab === 'storefrontBanners') finBannersInit();
  if (tab === 'storefrontHomepageSections') finSectionsInit();
  if (tab === 'internalRequisitions') finRequisitionsInit();
  if (tab === 'chartOfAccounts') finAccountsInit();
  if (tab === 'journalEntries') finJournalInit();
  if (tab === 'accountLedger') finLedgerInit();
  if (tab === 'trialBalance') finTrialBalanceInit();
  if (tab === 'contactsBillsInvoices') finContactsBillsInit();
  if (tab === 'budgets') finBudgetsInit();
  if (tab === 'bankReconciliation') finBankRecInit();
  if (tab === 'taxCompliance') finTaxInit();
  if (tab === 'financialReports') finReportsInit();
}

// ── GENERIC INNER SUB-TABS (finance placeholder pages) ──

function switchInnerTab(prefix, view, btn) {
  document.querySelectorAll(`.${prefix}-tab`).forEach(b => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.style.borderBottomColor = active ? '#2563eb' : 'transparent';
    b.style.color = active ? '#2563eb' : 'var(--text-2)';
  });
  document.querySelectorAll(`.${prefix}-view`).forEach(v => {
    v.style.display = v.dataset.view === view ? '' : 'none';
  });
}

function openAccountSettings() {
  const u = state.user || {};
  document.getElementById('as-avatar').textContent = u.initials || '';
  document.getElementById('as-name').textContent = u.name || '';
  document.getElementById('as-role').textContent = u.role === 'admin' ? 'Administration' : (u.role || '');
  document.getElementById('as-email').value = u.email || '';
  document.getElementById('as-pw-current').value = '';
  document.getElementById('as-pw-new').value = '';
  document.getElementById('as-pw-confirm').value = '';

  const rows = [
    ['Staff ID', u.id || '—'],
    ['Role', u.role === 'admin' ? 'Administration' : (u.role || '—')],
    ['Email', u.email || 'Not set'],
  ];
  document.getElementById('as-info-table').innerHTML = rows.map(([k, v]) =>
    `<div class="as-info-row"><span class="as-info-key">${k}</span><span class="as-info-val">${escapeHtml(String(v))}</span></div>`
  ).join('');

  switchAsTab('view', document.getElementById('as-tab-view'));
  document.getElementById('account-settings-modal').style.display = 'flex';
}

function closeAccountSettings() {
  document.getElementById('account-settings-modal').style.display = 'none';
}

function switchAsTab(tab, btn) {
  document.querySelectorAll('.as-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById(`as-panel-${tab}`).classList.add('active');
}

function toggleAsPw(inputId, btn) {
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l12 12"/><path d="M1 8s2.5-4.5 7-4.5c1.1 0 2.1.25 3 .65M15 8s-1 1.8-2.9 3.15M9.4 9.4a2 2 0 0 1-2.8-2.8"/></svg>';
}

async function saveAccountEmail() {
  const email = document.getElementById('as-email').value.trim();
  try {
    const data = await apiFetch('/api/account', { method: 'PUT', body: JSON.stringify({ email }) });
    state.user = data.user;
    showToast('Email updated');
  } catch (err) {
    showToast(err.message);
  }
}

async function changeAccountPassword() {
  const currentPassword = document.getElementById('as-pw-current').value;
  const newPassword = document.getElementById('as-pw-new').value;
  const confirm = document.getElementById('as-pw-confirm').value;
  if (!currentPassword || !newPassword) {
    showToast('Fill in both password fields');
    return;
  }
  if (newPassword !== confirm) {
    showToast('New passwords do not match');
    return;
  }
  try {
    await apiFetch('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    showToast('Password updated');
    document.getElementById('as-pw-current').value = '';
    document.getElementById('as-pw-new').value = '';
    document.getElementById('as-pw-confirm').value = '';
  } catch (err) {
    showToast(err.message);
  }
}

function openVerifyPaymentModal() {
  const m = document.getElementById('verify-payment-modal');
  if (m) m.style.display = 'flex';
}

function closeVerifyPaymentModal() {
  const m = document.getElementById('verify-payment-modal');
  if (m) m.style.display = 'none';
}

async function submitVerifyPayment() {
  const method = document.getElementById('vp-method')?.value;
  const ref = document.getElementById('vp-reference')?.value?.trim();
  if (!method) { showToast('Select a payment method'); return; }
  if (!ref) { showToast('Enter a payment / transaction reference'); return; }
  try {
    const data = await apiFetch(`/api/admin/fees/payments?reference=${encodeURIComponent(ref)}&method=${encodeURIComponent(method)}`);
    const match = (data.payments || [])[0];
    if (!match) { showToast(`No ${method} payment found with reference "${ref}"`); return; }
    if (match.status === 'successful') {
      showToast(`Payment already verified — ${match.studentName}, ${fmtNaira(match.amount)}`);
      closeVerifyPaymentModal();
      return;
    }
    await apiFetch(`/api/admin/fees/payments/${match.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'successful' }) });
    showToast(`Verified: ${match.studentName} — ${fmtNaira(match.amount)} marked successful`);
    closeVerifyPaymentModal();
  } catch (e) {
    showToast(e.message);
  }
}

// ── ATTENDANCE HELPERS ──

function attSessionOptions() {
  const academic = state.setup.academic;
  const sessions = [...new Set((state.setup.resultBatches || [])
    .map(b => { const m = (b.examType||'').match(/\d{4}-\d{4}/); return m ? m[0] : null; })
    .filter(Boolean))];
  if (academic && !sessions.includes(academic.sessionLabel)) sessions.unshift(academic.sessionLabel || '2025-2026');
  if (!sessions.length) sessions.push('2025-2026');
  return sessions.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function attClassOptions(placeholder) {
  return `<option value="">${escapeHtml(placeholder || 'Select Class')}</option>` +
    (state.setup.classes || []).map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
}

function attArmOptions(classCode, placeholder) {
  const arms = (state.setup.classArms || []).filter(a => a.classCode === classCode);
  return `<option value="">${escapeHtml(placeholder || '-Select-')}</option>` +
    arms.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

// ── ATTENDANCE (shared helpers) ──

const ATT_STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', permission: 'Permission' };

async function attFetchRecords(params) {
  const qs = new URLSearchParams(params).toString();
  const data = await apiFetch(`/api/admin/attendance?${qs}`);
  return data.records || [];
}

function attRadioRow(prefix, personId, existingStatus) {
  return ['present', 'absent', 'late', 'permission'].map(status =>
    `<td style="text-align:center;"><input type="radio" name="${prefix}-${personId}" value="${status}"${existingStatus === status || (!existingStatus && status === 'present') ? ' checked' : ''}></td>`
  ).join('');
}

function attCollectRadios(prefix, ids) {
  const records = [];
  ids.forEach(id => {
    const checked = document.querySelector(`input[name="${prefix}-${id}"]:checked`);
    if (checked) records.push({ personId: String(id), status: checked.value });
  });
  return records;
}

function subjectOptionsForClass(classCode, placeholder) {
  const seen = new Map();
  (state.setup.classSubjects || []).filter(cs => cs.classCode === classCode).forEach(cs => {
    if (!seen.has(cs.subjectId)) seen.set(cs.subjectId, cs.subjectName);
  });
  // Fall back to the full subject bank when this class has no explicit
  // subject linkage set up yet, so attendance marking isn't blocked on it.
  if (!seen.size) {
    (state.setup.subjects || []).forEach(s => seen.set(s.id, s.name));
  }
  return `<option value="">${escapeHtml(placeholder || 'Select Subject')}</option>` +
    [...seen.entries()].map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
}

function attAggregate(students, records) {
  const byStudent = new Map();
  records.forEach(r => {
    if (!byStudent.has(r.personId)) byStudent.set(r.personId, { present: 0, absent: 0, late: 0, permission: 0 });
    const bucket = byStudent.get(r.personId);
    if (bucket[r.status] != null) bucket[r.status] += 1;
  });
  return students.map(s => {
    const c = byStudent.get(s.id) || { present: 0, absent: 0, late: 0, permission: 0 };
    const total = c.present + c.absent + c.late + c.permission;
    const pct = total ? ((c.present / total) * 100).toFixed(1) + '%' : '—';
    return { student: s, ...c, total, pct };
  });
}

function renderAttReportRows(rows) {
  return rows.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td style="font-weight:500;">${escapeHtml(r.student.name)}</td>
    <td style="font-family:'DM Mono',monospace;font-size:12px;">${escapeHtml(r.student.id || '')}</td>
    <td style="text-align:center;">${r.present}</td>
    <td style="text-align:center;">${r.absent}</td>
    <td style="text-align:center;">${r.late}</td>
    <td style="text-align:center;">${r.permission}</td>
    <td style="text-align:center;">${r.total}</td>
    <td style="text-align:center;font-weight:600;color:${r.total && r.present / r.total >= 0.75 ? 'var(--green)' : r.total ? 'var(--red)' : 'var(--text-3)'};">${r.pct}</td>
  </tr>`).join('');
}

// ── MARK DAILY ATTENDANCE ──

function mdaInit() {
  document.getElementById('mda-session').innerHTML = attSessionOptions();
  document.getElementById('mda-class').innerHTML = attClassOptions('Select Class');
  document.getElementById('mda-arm').innerHTML = '<option value="">-Select-</option>';
  document.getElementById('mda-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('mda-list-card').style.display = 'none';
}

function mdaLoadArms() {
  const classCode = document.getElementById('mda-class').value;
  document.getElementById('mda-arm').innerHTML = attArmOptions(classCode, '-Select-');
}

async function mdaLoad() {
  const classCode = document.getElementById('mda-class').value;
  const date = document.getElementById('mda-date').value;
  if (!classCode) return showToast('Please select a class');
  if (!date) return showToast('Please select a date');
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const classes = state.setup.classes || [];
  const classLabel = (classes.find(c => c.code === classCode) || {}).label || classCode;
  const tbody = document.getElementById('mda-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:16px;">No students in this class</td></tr>';
    document.getElementById('mda-list-card').style.display = 'block';
    return;
  }
  let existing = [];
  try {
    existing = await attFetchRecords({ personType: 'student', sessionType: 'daily', classCode, from: date, to: date });
  } catch (err) { showToast(err.message); }
  const byId = new Map(existing.map(r => [r.personId, r.status]));
  tbody.innerHTML = students.map((s, i) => `<tr>
    <td>${i + 1}</td>
    <td style="font-weight:500;">${escapeHtml(s.name)}</td>
    <td style="font-family:'DM Mono',monospace;font-size:12px;">${escapeHtml(s.id || '')}</td>
    <td>${escapeHtml(classLabel)}</td>
    ${attRadioRow('att', s.id, byId.get(s.id))}
  </tr>`).join('');
  document.getElementById('mda-list-card').style.display = 'block';
}

async function mdaSave() {
  const classCode = document.getElementById('mda-class').value;
  const date = document.getElementById('mda-date').value;
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const records = attCollectRadios('att', students.map(s => s.id));
  if (!records.length) return showToast('Nothing to save');
  try {
    await apiFetch('/api/admin/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({ date, personType: 'student', sessionType: 'daily', classCode, records }),
    });
    showToast('Attendance saved successfully');
  } catch (err) {
    showToast(err.message);
  }
}

// ── DAILY ATTENDANCE REPORT ──

function darInit() {
  document.getElementById('dar-class').innerHTML = attClassOptions('Select Class');
  document.getElementById('dar-arm').innerHTML = '<option value="">-Select Class First-</option>';
  document.getElementById('dar-session').innerHTML = attSessionOptions();
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  document.getElementById('dar-from').value = firstOfMonth.toISOString().slice(0, 10);
  document.getElementById('dar-to').value = today.toISOString().slice(0, 10);
  document.getElementById('dar-report-card').style.display = 'none';
}

function darLoadArms() {
  const classCode = document.getElementById('dar-class').value;
  document.getElementById('dar-arm').innerHTML = attArmOptions(classCode, '-Select Class First-');
}

async function darShow() {
  const classCode = document.getElementById('dar-class').value;
  const from = document.getElementById('dar-from').value;
  const to = document.getElementById('dar-to').value;
  if (!classCode) return showToast('Please select a class');
  if (!from || !to) return showToast('Please select a date range');
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const tbody = document.getElementById('dar-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:16px;">No students found</td></tr>';
    document.getElementById('dar-report-card').style.display = 'block';
    return;
  }
  let records = [];
  try {
    records = await attFetchRecords({ personType: 'student', sessionType: 'daily', classCode, from, to });
  } catch (err) { showToast(err.message); }
  tbody.innerHTML = renderAttReportRows(attAggregate(students, records));
  document.getElementById('dar-report-card').style.display = 'block';
}

// ── MARK LESSON ATTENDANCE ──

function mlaInit() {
  document.getElementById('mla-session').innerHTML = attSessionOptions();
  document.getElementById('mla-class').innerHTML = attClassOptions('Select Class');
  document.getElementById('mla-arm').innerHTML = '<option value="">Select Class Fir...</option>';
  document.getElementById('mla-subject').innerHTML = '<option value="">Select Class First</option>';
  document.getElementById('mla-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('mla-list-card').style.display = 'none';
}

function mlaLoadArms() {
  const classCode = document.getElementById('mla-class').value;
  document.getElementById('mla-arm').innerHTML = attArmOptions(classCode, 'Select Class Fir...');
  document.getElementById('mla-subject').innerHTML = subjectOptionsForClass(classCode, 'Select Subject');
}

async function mlaLoad() {
  const classCode = document.getElementById('mla-class').value;
  const subjectId = document.getElementById('mla-subject').value;
  const date = document.getElementById('mla-date').value;
  if (!classCode) return showToast('Please select a class');
  if (!subjectId) return showToast('Please select a subject');
  if (!date) return showToast('Please select a date');
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const classes = state.setup.classes || [];
  const classLabel = (classes.find(c => c.code === classCode) || {}).label || classCode;
  const tbody = document.getElementById('mla-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:16px;">No students in this class</td></tr>';
    document.getElementById('mla-list-card').style.display = 'block';
    return;
  }
  let existing = [];
  try {
    existing = await attFetchRecords({ personType: 'student', sessionType: 'lesson', classCode, subjectId, from: date, to: date });
  } catch (err) { showToast(err.message); }
  const byId = new Map(existing.map(r => [r.personId, r.status]));
  tbody.innerHTML = students.map((s, i) => `<tr>
    <td>${i + 1}</td>
    <td style="font-weight:500;">${escapeHtml(s.name)}</td>
    <td style="font-family:'DM Mono',monospace;font-size:12px;">${escapeHtml(s.id || '')}</td>
    <td>${escapeHtml(classLabel)}</td>
    ${attRadioRow('latt', s.id, byId.get(s.id))}
  </tr>`).join('');
  document.getElementById('mla-list-card').style.display = 'block';
}

async function mlaSave() {
  const classCode = document.getElementById('mla-class').value;
  const subjectId = document.getElementById('mla-subject').value;
  const date = document.getElementById('mla-date').value;
  if (!subjectId) return showToast('Please select a subject');
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const records = attCollectRadios('latt', students.map(s => s.id));
  if (!records.length) return showToast('Nothing to save');
  try {
    await apiFetch('/api/admin/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({ date, personType: 'student', sessionType: 'lesson', classCode, subjectId, records }),
    });
    showToast('Lesson attendance saved successfully');
  } catch (err) {
    showToast(err.message);
  }
}

// ── LESSON ATTENDANCE REPORT ──

function larInit() {
  document.getElementById('lar-class').innerHTML = attClassOptions('Select Class');
  document.getElementById('lar-arm').innerHTML = '<option value="">-Select Class First-</option>';
  document.getElementById('lar-subject').innerHTML = '<option value="">All Subjects</option>';
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  document.getElementById('lar-from').value = firstOfMonth.toISOString().slice(0, 10);
  document.getElementById('lar-to').value = today.toISOString().slice(0, 10);
  document.getElementById('lar-report-card').style.display = 'none';
}

function larLoadArms() {
  const classCode = document.getElementById('lar-class').value;
  document.getElementById('lar-arm').innerHTML = attArmOptions(classCode, '-Select Class First-');
  document.getElementById('lar-subject').innerHTML = subjectOptionsForClass(classCode, 'All Subjects');
}

async function larShow() {
  const classCode = document.getElementById('lar-class').value;
  const subjectId = document.getElementById('lar-subject').value;
  const from = document.getElementById('lar-from').value;
  const to = document.getElementById('lar-to').value;
  if (!classCode) return showToast('Please select a class');
  if (!from || !to) return showToast('Please select a date range');
  const students = (state.setup.students || []).filter(s => s.classCode === classCode);
  const tbody = document.getElementById('lar-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:16px;">No students found</td></tr>';
    document.getElementById('lar-report-card').style.display = 'block';
    return;
  }
  let records = [];
  try {
    records = await attFetchRecords({ personType: 'student', sessionType: 'lesson', classCode, ...(subjectId ? { subjectId } : {}), from, to });
  } catch (err) { showToast(err.message); }
  tbody.innerHTML = renderAttReportRows(attAggregate(students, records));
  document.getElementById('lar-report-card').style.display = 'block';
}

// ── MARK STAFF ATTENDANCE ──

function msaInit() {
  document.getElementById('msa-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('msa-list-card').style.display = 'none';
}

async function msaLoad() {
  const date = document.getElementById('msa-date').value;
  if (!date) return showToast('Please select a date');
  const staff = state.setup.staff || [];
  const tbody = document.getElementById('msa-tbody');
  if (!staff.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-3);padding:16px;">No staff found</td></tr>';
    document.getElementById('msa-list-card').style.display = 'block';
    return;
  }
  let morning = [], afternoon = [];
  try {
    [morning, afternoon] = await Promise.all([
      attFetchRecords({ personType: 'staff', sessionType: 'morning', from: date, to: date }),
      attFetchRecords({ personType: 'staff', sessionType: 'afternoon', from: date, to: date }),
    ]);
  } catch (err) { showToast(err.message); }
  const moMap = new Map(morning.map(r => [r.personId, r.status]));
  const afMap = new Map(afternoon.map(r => [r.personId, r.status]));
  const radio = (prefix, id, value, existing) =>
    `<input type="radio" name="${prefix}-${id}" value="${value}"${existing === value ? ' checked' : ''}>`;

  tbody.innerHTML = staff.map((s, i) => {
    const mo = moMap.get(String(s.id));
    const af = afMap.get(String(s.id));
    return `<tr data-staff-id="${escapeHtml(String(s.id))}">
      <td>${i + 1}</td>
      <td>
        <div style="font-weight:500;">${escapeHtml(s.name)}</div>
        <div style="font-size:11px;color:var(--text-3);background:var(--black-3);border-radius:4px;display:inline-block;padding:1px 6px;margin-top:2px;">${escapeHtml(s.roleLabel || s.role || '')}</div>
      </td>
      <td style="text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:var(--text-3);">${escapeHtml(String(s.id))}</td>
      <td style="text-align:center;">${radio('msa-mo', s.id, 'present', mo)}</td>
      <td style="text-align:center;">${radio('msa-mo', s.id, 'absent', mo)}</td>
      <td style="text-align:center;">${radio('msa-mo', s.id, 'permission', mo)}</td>
      <td style="text-align:center;">${radio('msa-mo', s.id, 'late', mo)}</td>
      <td style="text-align:center;">${radio('msa-af', s.id, 'present', af)}</td>
      <td style="text-align:center;">${radio('msa-af', s.id, 'absent', af)}</td>
      <td style="text-align:center;">${radio('msa-af', s.id, 'permission', af)}</td>
      <td style="text-align:center;">${radio('msa-af', s.id, 'late', af)}</td>
    </tr>`;
  }).join('');
  document.getElementById('msa-list-card').style.display = 'block';
}

function msaFilter() {
  const q = (document.getElementById('msa-search').value || '').toLowerCase();
  document.querySelectorAll('#msa-tbody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function msaMarkAll(session, value) {
  const staff = state.setup.staff || [];
  staff.forEach(s => {
    const prefix = session === 'morning' ? `msa-mo-${s.id}` : `msa-af-${s.id}`;
    if (!value) {
      document.querySelectorAll(`input[name="${prefix}"]`).forEach(r => r.checked = false);
    } else {
      const radio = document.querySelector(`input[name="${prefix}"][value="${value}"]`);
      if (radio) radio.checked = true;
    }
  });
}

async function msaSave() {
  const date = document.getElementById('msa-date').value;
  const staff = state.setup.staff || [];
  const ids = staff.map(s => s.id);
  const morningRecords = attCollectRadios('msa-mo', ids);
  const afternoonRecords = attCollectRadios('msa-af', ids);
  if (!morningRecords.length && !afternoonRecords.length) return showToast('Nothing to save');
  try {
    if (morningRecords.length) {
      await apiFetch('/api/admin/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({ date, personType: 'staff', sessionType: 'morning', records: morningRecords }),
      });
    }
    if (afternoonRecords.length) {
      await apiFetch('/api/admin/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({ date, personType: 'staff', sessionType: 'afternoon', records: afternoonRecords }),
      });
    }
    showToast('Staff attendance saved successfully');
  } catch (err) {
    showToast(err.message);
  }
}

// ── STAFF ATTENDANCE REPORT ──

function sarInit() {
  const now = new Date();
  document.getElementById('sar-month').value = String(now.getMonth() + 1);
  document.getElementById('sar-year').value = now.getFullYear();
  document.getElementById('sar-report-wrap').style.display = 'none';
}

const ATT_CODE = { present: 'P', absent: 'A', late: 'L', permission: 'O' };
const ATT_COLOR = { present: 'var(--green)', absent: 'var(--red)', late: 'var(--amber)', permission: 'var(--blue)' };

async function sarShow() {
  const month = parseInt(document.getElementById('sar-month').value);
  const year = parseInt(document.getElementById('sar-year').value);
  const typeFilter = document.getElementById('sar-type').value;
  if (!year) return showToast('Please enter a year');
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month - 1];
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const staff = state.setup.staff || [];
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let morning = [], afternoon = [];
  try {
    const wantMorning = typeFilter !== 'afternoon';
    const wantAfternoon = typeFilter !== 'morning';
    [morning, afternoon] = await Promise.all([
      wantMorning ? attFetchRecords({ personType: 'staff', sessionType: 'morning', from, to }) : Promise.resolve([]),
      wantAfternoon ? attFetchRecords({ personType: 'staff', sessionType: 'afternoon', from, to }) : Promise.resolve([]),
    ]);
  } catch (err) { showToast(err.message); }

  const key = (personId, date) => `${personId}|${date}`;
  const moMap = new Map(morning.map(r => [key(r.personId, r.date), r.status]));
  const afMap = new Map(afternoon.map(r => [key(r.personId, r.date), r.status]));
  const showMo = typeFilter !== 'afternoon';
  const showAf = typeFilter !== 'morning';
  const subCols = (showMo ? 1 : 0) + (showAf ? 1 : 0);

  const dayHeaders = Array.from({length: daysInMonth}, (_, i) => {
    const d = new Date(year, month - 1, i + 1);
    return `<th colspan="${subCols}" style="text-align:center;font-size:11px;border-left:1px solid var(--border-1);">${dayNames[d.getDay()]}<br>${i + 1}</th>`;
  }).join('');
  const subHeaders = Array.from({length: daysInMonth}, () =>
    (showMo ? '<th style="font-size:10px;padding:2px;border-left:1px solid var(--border-1);">Mo</th>' : '') +
    (showAf ? '<th style="font-size:10px;padding:2px;">Af</th>' : '')
  ).join('');

  document.getElementById('sar-thead').innerHTML = `
    <tr><th rowspan="2" style="text-align:right;padding:4px 8px;">Date →<br><span style="font-weight:400;color:var(--text-3);">Employee ↓</span></th>${dayHeaders}</tr>
    <tr>${subHeaders}</tr>`;

  const cell = (status, borderLeft) => {
    const style = `text-align:center;font-size:11px;font-weight:700;${borderLeft ? 'border-left:1px solid var(--border-1);' : ''}${status ? `color:${ATT_COLOR[status]};` : ''}`;
    return `<td style="${style}">${status ? ATT_CODE[status] : ''}</td>`;
  };

  document.getElementById('sar-tbody').innerHTML = staff.map(s => {
    const days = Array.from({length: daysInMonth}, (_, i) => {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      const mo = moMap.get(key(String(s.id), dateStr));
      const af = afMap.get(key(String(s.id), dateStr));
      return (showMo ? cell(mo, true) : '') + (showAf ? cell(af, !showMo) : '');
    }).join('');
    return `<tr>
      <td style="white-space:nowrap;">
        <div style="font-weight:500;font-size:12px;">${escapeHtml(s.name)}</div>
        <div style="font-size:10px;background:var(--black-3);border-radius:3px;display:inline-block;padding:1px 5px;color:var(--text-3);">${escapeHtml(s.roleLabel || '')}</div>
      </td>
      ${days}
    </tr>`;
  }).join('');

  document.getElementById('sar-report-title').textContent = `Employees Attendance Report | ${monthName}, ${year}`;
  document.getElementById('sar-report-wrap').style.display = 'block';
}

function sarExport() {
  const title = (document.getElementById('sar-report-title')?.textContent || 'staff-attendance').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  exportTableToCsv('#sar-table', `${title}.csv`);
}

// ── STUDENT RESULT CHECKER ──

function srcInit() {
  if (!state.setup) return;
  const sel = document.getElementById('src-class');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes || []).map(c => `<option value="${c.code}">${c.label}</option>`).join('');
  document.getElementById('src-arm').innerHTML = '<option value="">— Select Arm —</option>';
  document.getElementById('src-list-card').style.display = 'none';
}

function srcPopulateArms() {
  const classCode = document.getElementById('src-class').value;
  document.getElementById('src-arm').innerHTML = attArmOptions(classCode, '— All Arms —');
  document.getElementById('src-list-card').style.display = 'none';
}

function srcLoadList() {
  const classCode = document.getElementById('src-class').value;
  const armId = document.getElementById('src-arm').value;
  if (!classCode) { showToast('Please select a class', 'warn'); return; }

  const classLabel = (state.setup.classes || []).find(c => c.code === classCode)?.label || classCode;
  const students = (state.setup.students || []).filter(st => {
    if (st.classCode !== classCode) return false;
    if (armId && String(st.classArmId || '') !== String(armId)) return false;
    return true;
  });

  const card = document.getElementById('src-list-card');
  const tbody = document.getElementById('src-tbody');
  card.style.display = '';

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3)">No students found for this class.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map((st, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${st.name}</td>
      <td style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px">${st.id}</td>
      <td>${classLabel}</td>
      <td><button class="bs-preview-btn" onclick="srcViewResult('${st.id}')">View Result</button></td>
    </tr>`).join('');
}

function srcFilterList() {
  const q = (document.getElementById('src-search').value || '').toLowerCase();
  document.querySelectorAll('#src-tbody tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

function srcViewResult(studentId) {
  const student = (state.setup.students || []).find(s => s.id === studentId);
  if (!student) return;
  const examType = document.getElementById('src-examtype')?.value;
  if (!examType) return showToast('Select an exam type first', 'warn');
  const params = new URLSearchParams({ studentId, classCode: student.classCode, examType });
  window.open(`/api/admin/reports/preview?${params.toString()}`, '_blank', 'noopener');
}

// ── CLASS RESULT CHECKER ──

function crcInit() {
  if (!state.setup) return;

  const sessions = [...new Set((state.setup.resultBatches || []).map(b => b.classLabel ? b : null)
    .filter(Boolean).map(b => {
      const term = state.setup.academic;
      return term ? `${term.session_label || ''}` : '';
    }))].filter(Boolean);

  const sessionSel = document.getElementById('crc-session');
  const examSel    = document.getElementById('crc-exam');
  const classSel   = document.getElementById('crc-class');

  // Derive unique session labels from academic_terms (use active term info)
  const academic = state.setup.academic;
  sessionSel.innerHTML = academic
    ? `<option value="${academic.session_label || '2025-2026'}">${academic.session_label || '2025-2026'}</option>`
    : '<option value="">No active session</option>';

  const exams = [...new Set((state.setup.resultBatches || []).map(b => b.examType))].filter(Boolean);
  examSel.innerHTML = '<option value="">— Select Exam —</option>' +
    exams.map(e => `<option value="${e}">${e}</option>`).join('');

  classSel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes || []).map(c => `<option value="${c.code}">${c.label}</option>`).join('');
  document.getElementById('crc-arm').innerHTML = '<option value="">— All Arms —</option>';

  document.getElementById('crc-availability').style.display = 'none';
  document.getElementById('crc-view-btn').style.display = 'none';
  document.getElementById('crc-results-area').innerHTML = '';
}

function crcLoadArms() {
  const classCode = document.getElementById('crc-class').value;
  document.getElementById('crc-arm').innerHTML = attArmOptions(classCode, '— All Arms —');
  crcCheckAvailability();
}

function crcCheckAvailability() {
  const classCode = document.getElementById('crc-class').value;
  const examType  = document.getElementById('crc-exam').value;
  const avail = document.getElementById('crc-availability');
  const btn   = document.getElementById('crc-view-btn');

  if (!classCode || !examType) { avail.style.display = 'none'; btn.style.display = 'none'; return; }

  const hasResults = (state.setup.resultBatches || []).some(b => b.classCode === classCode && b.examType === examType);
  avail.style.display = '';
  if (hasResults) {
    avail.style.background = '#16a34a22';
    avail.style.color = '#16a34a';
    avail.style.border = '1px solid #16a34a44';
    avail.textContent = '✔ This Result is Available';
    btn.style.display = '';
  } else {
    avail.style.background = '#f8717122';
    avail.style.color = '#f87171';
    avail.style.border = '1px solid #f8717144';
    avail.textContent = '✖ No results found for this class and exam.';
    btn.style.display = 'none';
  }
}

async function crcBulkView() {
  const classCode = document.getElementById('crc-class').value;
  const examType  = document.getElementById('crc-exam').value;
  const classArmId = document.getElementById('crc-arm')?.value || '';
  if (!classCode || !examType) return;

  const area = document.getElementById('crc-results-area');
  area.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-3)">Loading results…</div>';

  try {
    const armParam = classArmId ? `&classArmId=${encodeURIComponent(classArmId)}` : '';
    const data = await fetch(`/api/admin/broadsheet?classCode=${classCode}&examType=${encodeURIComponent(examType)}${armParam}`).then(r => r.json());
    if (data.error) throw new Error(data.error);

    const students = data.students || [];
    const subjects  = data.subjects || [];
    const matrix    = data.scoreMatrix || {};

    if (!students.length) {
      area.innerHTML = '<div class="card"><div class="card-body" style="padding:24px;color:var(--text-3);text-align:center">No student results available.</div></div>';
      return;
    }

    const classLabel = (state.setup.classes || []).find(c => c.code === classCode)?.label || classCode;

    area.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button class="bs-print-btn" onclick="window.print()">&#x1F5A8; Print all Results</button>
      </div>` +
      students.map(st => {
        const scores = matrix[st.id] || {};
        const rows = subjects.map(s => {
          const sc = scores[s.id];
          const tot = sc?.tot ?? null;
          const g = tot != null ? bsGrade(tot) : null;
          return `<tr>
            <td style="text-align:left;font-weight:500">${s.name}</td>
            <td>${sc?.ca ?? '—'}</td>
            <td>${sc?.ex ?? '—'}</td>
            <td style="font-weight:700">${tot ?? '—'}</td>
            <td>${g?.grade ?? '—'}</td>
            <td style="color:var(--text-3)">${g?.remark ?? '—'}</td>
          </tr>`;
        }).join('');

        return `<div class="card crc-report-card">
          <div class="card-head" style="flex-wrap:wrap;gap:8px;">
            <span class="card-title">${st.name}</span>
            <span style="color:var(--text-3);font-size:11px;font-family:'DM Mono',monospace">${st.id}</span>
            <span style="margin-left:auto;font-size:12px;color:var(--text-2)">${classLabel} · ${examType}</span>
          </div>
          <div class="card-body" style="padding:0 0 2px;">
            <table class="data-table">
              <thead><tr><th style="text-align:left">Subject</th><th>C.A (40%)</th><th>Exam (60%)</th><th>Total</th><th>Grade</th><th>Remark</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr style="background:var(--surface-2)">
                <td style="font-weight:700;text-align:left">Summary</td>
                <td colspan="2"></td>
                <td style="font-weight:700">${st.grandTotal}</td>
                <td colspan="2" style="color:var(--text-3)">Avg: ${st.avgPct}% · Pos: ${st.position}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>`;
      }).join('');
  } catch(e) {
    area.innerHTML = `<div class="card"><div class="card-body" style="padding:24px;color:#f87171;text-align:center">${e.message}</div></div>`;
  }
}

// ── BROADSHEET ──

let _bsData = null;
let _bsView = 'full';
let _bsStudentsById = {};
let _bsCommentBank = null;

let GRADE_SCALE = [
  { min:80, grade:'A', remark:'Excellent', gradePoint:5.0 },
  { min:65, grade:'B', remark:'Very Good', gradePoint:4.0 },
  { min:55, grade:'C', remark:'Good', gradePoint:3.0 },
  { min:45, grade:'D', remark:'Fair', gradePoint:2.0 },
  { min:0,  grade:'F', remark:'Fail', gradePoint:0.0 },
];
function bsGrade(pct) { return GRADE_SCALE.find(g => pct >= g.min) || GRADE_SCALE.at(-1); }

// Older saved grade scales may predate the gradePoint field; fall back to the
// conventional 5/4/3/2/0 scale by letter so GPA never silently comes out as 0.
const GRADE_POINT_FALLBACK = { A: 5, B: 4, C: 3, D: 2, F: 0 };
function gradePointFor(band) {
  return Number.isFinite(band.gradePoint) ? band.gradePoint : (GRADE_POINT_FALLBACK[band.grade] ?? 0);
}

async function loadGradeScaleFromServer() {
  try {
    const data = await apiFetch('/api/admin/grade-scale');
    if (Array.isArray(data.gradeScale) && data.gradeScale.length) {
      GRADE_SCALE = data.gradeScale.map(r => ({ min: Number(r.min), grade: r.grade, remark: r.remark, gradePoint: Number(r.gradePoint) }));
    }
    return data.gradeScale;
  } catch (err) {
    return null;
  }
}

function renderGradingTable(rows) {
  const tbody = document.querySelector('#grading-table tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td><input class="field-input grading-grade" value="${escapeHtml(r.grade)}" style="width:50px"></td>
    <td><input class="field-input grading-min" value="${r.min}" style="width:70px" type="number"></td>
    <td><input class="field-input grading-max" value="${r.max}" style="width:70px" type="number"></td>
    <td><input class="field-input grading-remark" value="${escapeHtml(r.remark || '')}"></td>
    <td><input class="field-input grading-point" value="${r.gradePoint != null ? r.gradePoint : ''}" style="width:70px"></td>
  </tr>`).join('');
}

async function initGradingSystemsTab() {
  try {
    const data = await apiFetch('/api/admin/grade-scale');
    renderGradingTable(data.gradeScale || []);
  } catch (err) {
    showToast(err.message);
  }
}

async function saveGradingSystem() {
  const rows = Array.from(document.querySelectorAll('#grading-table tbody tr')).map(tr => ({
    grade: tr.querySelector('.grading-grade').value.trim(),
    min: Number(tr.querySelector('.grading-min').value),
    max: Number(tr.querySelector('.grading-max').value),
    remark: tr.querySelector('.grading-remark').value.trim(),
    gradePoint: Number(tr.querySelector('.grading-point').value),
  }));
  try {
    const data = await apiFetch('/api/admin/grade-scale', { method: 'POST', body: JSON.stringify({ gradeScale: rows }) });
    GRADE_SCALE = data.gradeScale.map(r => ({ min: Number(r.min), grade: r.grade, remark: r.remark, gradePoint: Number(r.gradePoint) }));
    renderGradingTable(data.gradeScale);
    showToast('Grading system saved');
  } catch (err) {
    showToast(err.message);
  }
}

function togglePublishBody() {
  const body = document.getElementById('pub-body');
  const chev = document.getElementById('pub-chev');
  body.classList.toggle('open');
  chev.innerHTML = body.classList.contains('open') ? '&#9650;' : '&#9660;';
}

function populateBroadsheetControls() {
  if (!state.setup) return;
  const sessionSel = document.getElementById('bs-session-sel');
  const examSel    = document.getElementById('bs-exam-sel');
  const classSel   = document.getElementById('bs-class-sel');
  if (!classSel || !examSel) return;

  if (sessionSel) {
    const academic = state.setup.academic || {};
    sessionSel.innerHTML = '<option value="">— Select Session —</option>' +
      (academic.sessionLabel ? `<option value="${escapeHtml(academic.sessionLabel)}">${escapeHtml(academic.sessionLabel)}</option>` : '');
  }

  classSel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes||[]).map(c=>`<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');

  const exams = [...new Set((state.setup.examTypes||[]).concat((state.setup.resultBatches||[]).map(b=>b.examType)))].filter(Boolean);
  examSel.innerHTML = '<option value="">— Select Exam —</option>' +
    exams.map(e=>`<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');

  renderBsEmailNote();
}

function renderBsEmailNote() {
  const note = document.getElementById('bs-publish-email-note');
  if (!note) return;
  const config = state.setup?.emailConfig || {};
  note.textContent = config.configured
    ? `Parent emails will be sent from ${config.from} through ${config.host}:${config.port}.`
    : 'SMTP is not configured — reports will still publish, but parent emails will not be sent.';
}

async function publishBroadsheet() {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examType = document.getElementById('bs-exam-sel')?.value;
  if (!classCode || !examType) {
    showToast('Select a class and exam first');
    return;
  }
  const btn = document.getElementById('bs-publish-btn');
  const label = document.getElementById('bs-publish-label');
  const originalLabel = label ? label.textContent : 'Publish';
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Publishing…';
  try {
    const data = await apiFetch('/api/admin/reports/publish', {
      method: 'POST',
      body: JSON.stringify({ classCode, examType }),
    });
    state.setup = data.setup;
    renderBsEmailNote();

    const published = data.published || [];
    const skipped = data.skipped || [];
    const sent = published.filter(row => row.emailStatus === 'sent').length;
    const notConfigured = published.filter(row => row.emailStatus === 'email_not_configured').length;
    const failed = published.filter(row => row.emailStatus === 'email_failed').length;
    const noParentEmail = published.filter(row => row.emailStatus === 'missing_parent_email' || row.emailStatus === 'missing_email_address').length;
    const count = published.length;
    const noun = `report${count === 1 ? '' : 's'}`;

    let msg;
    if (notConfigured && notConfigured === count) {
      msg = `Published ${count} ${noun} — email not sent, SMTP not configured`;
    } else if (sent === count && count > 0) {
      msg = `Published ${count} ${noun} — ${sent} parent email${sent === 1 ? '' : 's'} sent`;
    } else {
      const parts = [];
      if (sent) parts.push(`${sent} emailed`);
      if (notConfigured) parts.push(`${notConfigured} skipped (SMTP not configured)`);
      if (noParentEmail) parts.push(`${noParentEmail} skipped (no parent email on file)`);
      if (failed) parts.push(`${failed} email failed`);
      msg = `Published ${count} ${noun}${parts.length ? ' — ' + parts.join(', ') : ''}`;
    }
    if (skipped.length) msg += ` (${skipped.length} student${skipped.length === 1 ? '' : 's'} had no results, skipped)`;
    showToast(msg);

    const unpubBtn = document.getElementById('bs-unpublish-btn');
    if (unpubBtn) unpubBtn.style.display = count ? '' : 'none';
  } catch (err) {
    showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = originalLabel;
  }
}

function viewBroadsheet() {
  const sec = document.getElementById('bs-results-section');
  if (sec) sec.style.display = '';

  // Populate school header
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examLabel = document.getElementById('bs-exam-sel')?.value;
  const cls = (state.setup.classes||[]).find(c => c.code === classCode);
  const session = document.getElementById('bs-session-sel')?.value || state.setup.academic?.sessionLabel || '';
  const info = state.setup.schoolInfo || {};
  const schoolName = info.name || 'UNIQUE CHILDREN SCHOOL';
  const address = info.address || '';
  const email = info.email || '';
  const phone = info.phone || '';
  const website = info.website || '';

  const hdrName = document.getElementById('bs-hdr-name');
  const hdrAddr = document.getElementById('bs-hdr-address');
  const hdrContact = document.getElementById('bs-hdr-contact');
  const hdrTitle = document.getElementById('bs-hdr-title');

  if (hdrName) hdrName.textContent = schoolName.toUpperCase();
  if (hdrAddr) hdrAddr.textContent = address;
  if (hdrContact) {
    const parts = [];
    if (website) parts.push(`Website: ${website}`);
    if (phone) parts.push(`Phone: ${phone}`);
    if (email) parts.push(`Email: ${email}`);
    hdrContact.textContent = parts.join('  |  ');
  }
  if (hdrTitle) {
    const clsLabel = cls ? `${cls.label}` : classCode || '';
    hdrTitle.textContent = `${clsLabel} Students Result for ${examLabel} (${session})  —  Master / Broad Sheet`;
  }

  // Show/hide unpublish button based on published state
  const published = (state.setup.publications||[]).some(p => p.classCode === classCode && p.examType === examLabel);
  const unpubBtn = document.getElementById('bs-unpublish-btn');
  if (unpubBtn) unpubBtn.style.display = published ? '' : 'none';

  loadBroadsheet();
}

async function unpublishBroadsheet() {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examType = document.getElementById('bs-exam-sel')?.value;
  if (!classCode || !examType) {
    showToast('Select a class and exam first');
    return;
  }
  if (!confirm(`Unpublish ${examType} results for this class? Parents will no longer be able to view or have been sent these reports.`)) return;
  const btn = document.getElementById('bs-unpublish-btn');
  if (btn) btn.disabled = true;
  try {
    const data = await apiFetch('/api/admin/reports/unpublish', {
      method: 'POST',
      body: JSON.stringify({ classCode, examType }),
    });
    state.setup = data.setup;
    showToast(`Unpublished ${data.unpublishedCount} report${data.unpublishedCount === 1 ? '' : 's'}`);
    if (btn) btn.style.display = 'none';
  } catch (err) {
    showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function previewBroadsheetResults() {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examLabel = document.getElementById('bs-exam-sel')?.value;
  const session = document.getElementById('bs-session-sel')?.value || '';
  if (!classCode || !examLabel) {
    showToast('Select a class and exam first');
    return;
  }
  const params = new URLSearchParams({ bsFocus: '1', classCode, examType: examLabel, session });
  window.open(`admin-portal.html?${params.toString()}`, '_blank', 'noopener');
}

// If opened via the "View Results" link with bsFocus params, jump straight into a
// clean, read-only broadsheet view in this new tab (sidebar/filters/actions hidden).
function bootstrapBroadsheetFocusMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('bsFocus') !== '1') return;
  const classCode = params.get('classCode') || '';
  const examType = params.get('examType') || '';
  if (!classCode || !examType) return;

  document.body.classList.add('bs-focus-mode');
  switchTab('publish', document.querySelector('[data-tab="publish"]'));

  const sessionSel = document.getElementById('bs-session-sel');
  const examSel = document.getElementById('bs-exam-sel');
  const classSel = document.getElementById('bs-class-sel');
  if (sessionSel && params.get('session')) sessionSel.value = params.get('session');
  if (examSel) examSel.value = examType;
  if (classSel) classSel.value = classCode;

  viewBroadsheet();
}

function setBsView(v) {
  _bsView = v;
  document.getElementById('bs-btn-full').classList.toggle('active', v==='full');
  document.getElementById('bs-btn-min').classList.toggle('active', v==='minimal');
  if (_bsData) renderBroadsheetTable(_bsData);
}

async function loadBroadsheet() {
  const classCode = document.getElementById('bs-class-sel').value;
  const examLabel = document.getElementById('bs-exam-sel').value;
  if (!classCode || !examLabel) return;

  document.getElementById('bs-table-outer').innerHTML =
    '<div style="padding:40px;text-align:center;color:var(--text-3);font-size:13px;">Loading broadsheet…</div>';
  document.getElementById('bs-summary').style.display = 'none';

  try {
    const res = await fetch(`/api/admin/broadsheet?classCode=${classCode}&examType=${encodeURIComponent(examLabel)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    _bsData = data;
    if (!_bsCommentBank) {
      try {
        const cb = await apiFetch('/api/admin/comment-bank');
        _bsCommentBank = cb.comments || [];
      } catch (e) { _bsCommentBank = []; }
    }
    renderBroadsheetPills(data);
    renderBroadsheetTable(data);
    renderBroadsheetSummary(data);
  } catch(e) {
    document.getElementById('bs-table-outer').innerHTML =
      `<div style="padding:40px;text-align:center;color:#f87171;font-size:13px;">${e.message}</div>`;
  }
}

function renderBroadsheetPills(data) {
  const bar = document.getElementById('bs-pills');
  if (!bar) return;
  bar.innerHTML = (data.subjects||[]).map(s=>{
    const label = s.name.length>13 ? s.name.slice(0,12)+'…' : s.name;
    return `<span class="bs-pill" title="${s.name}">${label}</span>`;
  }).join('');
}

function previewStudentReport(studentId) {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examType = document.getElementById('bs-exam-sel')?.value;
  if (!classCode || !examType) {
    showToast('Select a class and exam first');
    return;
  }
  const params = new URLSearchParams({ studentId, classCode, examType });
  window.open(`/api/admin/reports/preview?${params.toString()}`, '_blank', 'noopener');
}

async function saveHeadComment(studentId, textareaEl) {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examType = document.getElementById('bs-exam-sel')?.value;
  if (!classCode || !examType) return;
  const comment = textareaEl.value;
  try {
    await apiFetch('/api/admin/report-comments', {
      method: 'PUT',
      body: JSON.stringify({ studentId, classCode, examType, comment }),
    });
    showToast('Head of School comment saved');
  } catch (err) {
    showToast(err.message);
  }
}

function autoFillHeadRemark(studentId) {
  const select = document.getElementById(`bs-head-remark-${studentId}`);
  const student = _bsStudentsById[studentId];
  if (!select || !student) return;
  const suggestion = student.suggestedComment || '';
  if (suggestion && !Array.from(select.options).some(o => o.value === suggestion)) {
    const opt = document.createElement('option');
    opt.value = suggestion;
    opt.textContent = suggestion.length > 60 ? suggestion.slice(0,60)+'…' : suggestion;
    select.insertBefore(opt, select.firstChild);
  }
  select.value = suggestion;
  saveHeadComment(studentId, select);
}

function renderBroadsheetTable(data) {
  const subj     = data.subjects || [];
  const students = data.students || [];
  const matrix   = data.scoreMatrix || {};
  const subjectRanks = data.subjectRanks || {};
  const examType = data.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const isFinal  = examType === 'Final Exam';
  const subjMax  = data.subjMax || (isFinal ? 100 : 40);
  const minimal  = _bsView === 'minimal' || !isFinal;
  _bsStudentsById = {};
  students.forEach(st => { _bsStudentsById[st.id] = st; });

  function ordinal(n) {
    if (n == null) return '';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function remarkSelectHtml(studentId, currentValue) {
    const bank = _bsCommentBank || [];
    const current = currentValue || '';
    const matchesBank = bank.some(c => c.text === current);
    const customOption = (!matchesBank && current)
      ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current.length > 60 ? current.slice(0,60)+'…' : current)}</option>`
      : '';
    const bankOptions = bank.map(c =>
      `<option value="${escapeHtml(c.text)}" ${c.text === current ? 'selected' : ''}>${escapeHtml(c.text.length > 60 ? c.text.slice(0,60)+'…' : c.text)}</option>`
    ).join('');
    return `<select class="bs-remark-select" id="bs-head-remark-${escapeHtml(studentId)}" data-student-id="${escapeHtml(studentId)}" onchange="saveHeadComment('${escapeHtml(studentId)}', this)">
      ${!current ? '<option value="">- Select Preset Comment -</option>' : ''}
      ${customOption}${bankOptions}
    </select>`;
  }

  function getGradeLetter(score) {
    if (score == null || score === '') return '—';
    const n = (Number(score) / subjMax) * 100;
    const found = GRADE_SCALE.find(g => n >= g.min);
    return found ? found.grade : '—';
  }

  const subjCols = minimal ? 1 : 3;

  // Row 1: sticky cols (rowspan 3) + subject group headers + trailing cols (rowspan 3)
  let thGroup = `
    <th class="bs-sticky bs-sticky-h bs-th-num" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">#</th>
    <th class="bs-sticky bs-sticky-h bs-th-name" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;text-align:left;">Students &#x2193;</th>
    <th class="bs-sticky bs-sticky-h bs-th-reg" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Reg. No.</th>`;
  subj.forEach(s => {
    thGroup += `<th class="bs-th-subj" colspan="${subjCols}">${escapeHtml(s.name)}<button type="button" class="bs-subj-edit-btn" title="Edit assessment setup for ${escapeHtml(s.name)}" onclick="switchTab('scoreDivisions', document.querySelector('[data-tab=scoreDivisions]'))">&#x270E;</button></th>`;
  });
  thGroup += `
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:55px;">Grand<br>Total</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:55px;">Grade<br>Point<br>Average</th>
    <th rowspan="3" class="bs-avg-cell" style="vertical-align:bottom;padding-bottom:8px;">Total Score Average %<br><small style="color:#2563eb;font-weight:400;font-size:9px;">(performance ranking)</small></th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:80px;">Result<br>Summary</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Position</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:180px;">Form Teacher's Remark</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:180px;">Head of School's Remark</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:70px;">Cognitive<br>Skills Report</th>
    <th class="bs-th-subj" colspan="3" style="min-width:90px;">Daily Attendance<br>Report</th>
    <th class="bs-th-subj" colspan="3" style="min-width:90px;">Lesson Attendance<br>Report</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Preview<br>Result</th>`;

  // Row 2: rotated sub-col headers for subjects + attendance/cog sub-cols
  let thSub = '';
  if (!minimal) {
    subj.forEach(() => {
      thSub += `<th class="bs-th-rotated">Mid-Term Test (30%)<small style="display:block;font-size:8px;">(30)</small></th>
        <th class="bs-th-rotated">Examination (70%)<small style="display:block;font-size:8px;">(70)</small></th>
        <th class="bs-th-rotated">Total Score<small style="display:block;font-size:8px;">(100)</small></th>`;
    });
  } else {
    subj.forEach(() => {
      thSub += `<th class="bs-th-rotated">Total Score<small style="display:block;font-size:8px;">(${subjMax})</small></th>`;
    });
  }
  // Attendance sub-cols (T/P/A) — Daily then Lesson
  for (let i = 0; i < 2; i++) {
    thSub += `<th class="bs-th-rotated">T<small style="display:block;font-size:8px;">Total</small></th>
      <th class="bs-th-rotated">P<small style="display:block;font-size:8px;">Present</small></th>
      <th class="bs-th-rotated">A<small style="display:block;font-size:8px;">Absent</small></th>`;
  }

  // Row 3: score limits under subject sub-cols (blank for attendance)
  let thLimit = '';
  if (!minimal) {
    subj.forEach(() => {
      thLimit += `<th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(30)</th>
        <th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(70)</th>
        <th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(100)</th>`;
    });
  } else {
    subj.forEach(() => { thLimit += `<th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(${subjMax})</th>`; });
  }
  for (let i = 0; i < 6; i++) thLimit += `<th></th>`;

  // Compute grand totals for ranking
  const studentTotals = students.map(st => {
    const scores = matrix[st.id] || {};
    let gt = 0, count = 0;
    subj.forEach(s => { const sc = scores[s.id]; if (sc && sc.tot != null) { gt += sc.tot; count++; } });
    return { st, gt, count };
  });
  studentTotals.sort((a,b) => b.gt - a.gt);
  const rankMap = {};
  studentTotals.forEach((item, i) => { rankMap[item.st.id] = i + 1; });

  // Body rows
  let tbody = '';
  students.forEach((st, idx) => {
    const scores = matrix[st.id] || {};
    let grandTotal = 0, subjectCount = 0, gpaSum = 0;

    let scoreCells = '';
    subj.forEach(s => {
      const sc = scores[s.id];
      if (sc && sc.tot != null) {
        grandTotal += sc.tot; subjectCount++;
        gpaSum += gradePointFor(bsGrade((sc.tot / subjMax) * 100));
      }
      const grade = sc && sc.tot != null ? getGradeLetter(sc.tot) : '';
      const hasScore = sc && sc.tot != null;
      const subjRank = hasScore ? subjectRanks[s.id]?.[st.id] : null;
      const rankBadge = subjRank ? `<br><small class="bs-subj-rank">${ordinal(subjRank)}</small>` : '';
      if (minimal) {
        scoreCells += `<td style="text-align:center;">${hasScore
          ? `<strong>${sc.tot}</strong><span class="bs-grade-badge">(${grade})</span>${rankBadge}`
          : '<span class="bs-excluded">—</span>'}</td>`;
      } else {
        const excluded = !hasScore;
        scoreCells += `<td style="text-align:center;">${excluded ? '<span class="bs-excluded">Excluded</span>' : (sc.ca ?? '—')}</td>`;
        scoreCells += `<td style="text-align:center;">${excluded ? '<span class="bs-excluded">—</span>' : (sc.ex ?? '—')}</td>`;
        scoreCells += `<td class="bs-score-total" style="text-align:center;">${hasScore
          ? `<strong>${sc.tot}</strong><span class="bs-grade-badge">(${grade})</span>${rankBadge}`
          : '<span class="bs-excluded">—</span>'}</td>`;
      }
    });

    const maxPossible = subjectCount * subjMax;
    const avgPct = maxPossible > 0 ? (grandTotal / maxPossible * 100).toFixed(3) : '0.000';
    const avgNum = parseFloat(avgPct);
    const gpa = subjectCount ? (gpaSum / subjectCount).toFixed(3) : '0.000';
    const g = bsGrade(avgNum);
    const pos = rankMap[st.id] || idx + 1;
    const posLabel = pos===1?'1st':pos===2?'2nd':pos===3?'3rd':`${pos}th`;
    const posClass = pos===1?'top1':pos===2?'top2':pos===3?'top3':'';
    const badgeClass = avgNum >= 70 ? '' : avgNum >= 50 ? 'fair' : 'poor';

    tbody += `<tr>
      <td class="bs-sticky bs-col-num">${idx + 1}</td>
      <td class="bs-sticky bs-col-name bs-td-name">
        ${st.photoPath
          ? `<img class="bs-avatar" src="/${escapeHtml(st.photoPath)}" alt="">`
          : `<span class="bs-avatar bs-avatar-fallback">${escapeHtml((st.initials || st.name || '?').slice(0,2))}</span>`}
        <span>${escapeHtml(st.name)}</span>
      </td>
      <td class="bs-sticky bs-col-reg bs-td-reg">${escapeHtml(st.id||'—')}</td>
      ${scoreCells}
      <td class="bs-score-total" style="text-align:center;">${grandTotal}${subjectCount?`<br><small style="color:var(--text-3);font-size:9px;">/ ${subjectCount*subjMax}</small>`:''}</td>
      <td style="text-align:center;font-weight:700;">${gpa}</td>
      <td class="bs-avg-cell">
        <div class="bs-avg-pct">${avgPct}%</div>
        <div class="bs-avg-sub">(${g.grade})</div>
        <div class="bs-avg-track"><div class="bs-avg-fill" style="width:${Math.min(avgNum,100)}%"></div></div>
      </td>
      <td style="text-align:center;"><span class="bs-summary-badge ${badgeClass}">${g.remark}</span></td>
      <td style="text-align:center;"><span class="bs-pos-badge ${posClass}">${posLabel}</span></td>
      <td class="bs-remark-td" style="font-size:10px;color:var(--text-2);">${escapeHtml(st.teacherComment || '')}</td>
      <td class="bs-remark-td">
        ${remarkSelectHtml(st.id, st.headComment)}
        <button type="button" class="bs-auto-remark-btn" title="Fill with a suggested remark based on this student's score" onclick="autoFillHeadRemark('${escapeHtml(st.id)}')">&#x21bb; Auto Remark</button>
      </td>
      <td style="text-align:center;"><button class="bs-preview-btn" title="Open Cognitive Skills Assessment" onclick="switchTab('cognitiveSkills', document.querySelector('[data-tab=cognitiveSkills]'))">&#x1F393;</button></td>
      <td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.total ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.present ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.absent ?? 0}</td>
      <td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.total ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.present ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.absent ?? 0}</td>
      <td style="text-align:center;"><button class="bs-preview-btn" title="Preview result" onclick="previewStudentReport('${escapeHtml(st.id)}')">&#x1F50D;</button></td>
    </tr>`;
  });

  const html = `<table class="bs-table" id="bs-table-el">
    <thead>
      <tr>${thGroup}</tr>
      <tr>${thSub}</tr>
      <tr>${thLimit}</tr>
    </thead>
    <tbody>${tbody || '<tr><td colspan="99" style="padding:30px;text-align:center;color:var(--text-3)">No results found.</td></tr>'}</tbody>
  </table>`;

  document.getElementById('bs-table-outer').innerHTML = html;
}

function filterBroadsheetTable() {
  const q = (document.getElementById('bs-search').value||'').toLowerCase();
  const tbl = document.getElementById('bs-table-el');
  if (!tbl) return;
  tbl.querySelectorAll('tbody tr').forEach(tr => {
    const name = (tr.cells[1]?.textContent||'').toLowerCase();
    const reg  = (tr.cells[2]?.textContent||'').toLowerCase();
    tr.style.display = (name.includes(q)||reg.includes(q)) ? '' : 'none';
  });
}

function renderBroadsheetSummary(data) {
  const subj = data.subjects || [];
  const stats = data.stats || {};
  const subjectStats = data.subjectStats || [];
  const students = data.students || [];
  const matrix = data.scoreMatrix || {};
  const studentCount = students.length;
  const examType = data.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax = data.subjMax || (examType === 'Final Exam' ? 100 : 40);

  // Compute per-subject totals for stats table
  const subjTotals = {};
  const subjBest = {};  // {name, score}
  const subjWorst = {}; // {name, score}
  subj.forEach(s => {
    subjTotals[s.id] = 0;
    subjBest[s.id] = null;
    subjWorst[s.id] = null;
  });
  students.forEach(st => {
    const scores = matrix[st.id] || {};
    subj.forEach(s => {
      const sc = scores[s.id];
      if (!sc || sc.tot == null) return;
      subjTotals[s.id] += sc.tot;
      if (!subjBest[s.id] || sc.tot > subjBest[s.id].score) subjBest[s.id] = { name: st.name, score: sc.tot };
      if (!subjWorst[s.id] || sc.tot < subjWorst[s.id].score) subjWorst[s.id] = { name: st.name, score: sc.tot };
    });
  });

  // Compute student grand totals for best-in-class
  const studentGT = students.map(st => {
    const scores = matrix[st.id] || {};
    let gt = 0, cnt = 0;
    subj.forEach(s => { const sc = scores[s.id]; if (sc && sc.tot != null) { gt += sc.tot; cnt++; } });
    return { name: st.name, gt, avg: cnt > 0 ? (gt / cnt).toFixed(2) : '0.00' };
  });
  studentGT.sort((a, b) => b.gt - a.gt);
  const best = studentGT[0];

  // Subject score averages
  const subjAvgs = subj.map(s => {
    const total = subjTotals[s.id] || 0;
    const cnt = students.filter(st => { const sc = (matrix[st.id]||{})[s.id]; return sc && sc.tot != null; }).length;
    return { s, total, cnt, avg: cnt > 0 ? (total / cnt).toFixed(2) : '0.00' };
  });

  const grandTotalSubjAvg = subjAvgs.reduce((a, v) => a + parseFloat(v.avg), 0).toFixed(2);
  const classScoreAvg = subj.length > 0 ? (parseFloat(grandTotalSubjAvg) / subj.length).toFixed(2) : '0.00';

  // Stats table
  const statsTbody = document.getElementById('bs-stats-tbody');
  if (statsTbody) {
    statsTbody.innerHTML = subjAvgs.map((item, i) => {
      const teacherEntry = (subjectStats[i] || {}).teacherName || '—';
      const best = subjBest[item.s.id];
      const worst = subjWorst[item.s.id];
      return `<tr>
        <td style="font-weight:600;">${escapeHtml(item.s.name)}</td>
        <td style="text-align:center;">${item.total}</td>
        <td style="text-align:center;">${item.cnt}</td>
        <td style="text-align:center;font-weight:700;font-family:'DM Mono',monospace;">${item.avg}</td>
        <td style="text-align:center;"><button class="bs-rank-btn" title="View ranking for ${escapeHtml(item.s.name)}" onclick="showSubjectRanking(${item.s.id}, '${escapeHtml(item.s.name)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button></td>
        <td style="color:#16a34a;font-size:11px;">${best ? `${escapeHtml(best.name)} (${best.score})` : '—'}</td>
        <td style="color:#dc2626;font-size:11px;">${worst && worst !== best ? `${escapeHtml(worst.name)} (${worst.score})` : '—'}</td>
        <td style="color:var(--text-3);">${teacherEntry}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--text-3)">No subject data.</td></tr>`;
  }

  // Footer stats
  const footAvg = document.getElementById('bs-foot-avg');
  const footCount = document.getElementById('bs-foot-count');
  const footClassAvg = document.getElementById('bs-foot-class-avg');
  if (footAvg) footAvg.textContent = grandTotalSubjAvg;
  if (footCount) footCount.textContent = studentCount;
  if (footClassAvg) footClassAvg.textContent = classScoreAvg;

  // Best student row
  const bestRow = document.getElementById('bs-best-student-row');
  if (bestRow && best) {
    bestRow.innerHTML = `
      <span>${escapeHtml(best.name)}</span>
      <span>${best.gt} / ${subj.length * subjMax}</span>
      <span>${best.avg}</span>`;
  }

  document.getElementById('bs-summary').style.display = '';
}

function showSubjectRanking(subjectId, subjectName) {
  if (!_bsData) return;
  const students = _bsData.students || [];
  const matrix   = _bsData.scoreMatrix || {};
  const examType = _bsData.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax  = _bsData.subjMax || (examType === 'Final Exam' ? 100 : 40);

  const ranked = students
    .map(st => ({ name: st.name, score: matrix[st.id]?.[subjectId]?.tot ?? null }))
    .filter(r => r.score !== null)
    .sort((a, b) => b.score - a.score);

  const rows = ranked.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const color = i === 0 ? 'var(--amber)' : i < 3 ? 'var(--text-2)' : 'var(--text-3)';
    return `<tr>
      <td class="rank-num" style="color:${color};">${medal || (i + 1)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="rank-score" style="color:${i === 0 ? 'var(--green)' : 'var(--text-1)'};">${r.score}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--text-3);">No scores recorded.</td></tr>`;

  const modal = document.createElement('div');
  modal.className = 'rank-modal-overlay';
  modal.innerHTML = `
    <div class="rank-modal">
      <div class="rank-modal-head">
        <span class="rank-modal-title">Performance Ranking — ${escapeHtml(subjectName)}</span>
        <button class="rank-modal-close" onclick="this.closest('.rank-modal-overlay').remove()">&#x2715;</button>
      </div>
      <div class="rank-modal-body">
        <table class="rank-table">
          <thead><tr><th>#</th><th>Student</th><th>Score / ${subjMax}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function exportBroadsheetCSV() {
  if (!_bsData) { showToast('Load a broadsheet first','warn'); return; }
  const subj     = _bsData.subjects || [];
  const students = _bsData.students || [];
  const matrix   = _bsData.scoreMatrix || {};
  const examType = _bsData.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax  = _bsData.subjMax || (examType === 'Final Exam' ? 100 : 40);

  const headers = ['#','Name','Reg No',...subj.map(s=>s.name+' Total'),'Grand Total','Avg%'];
  const rows = students.map((st,i) => {
    const scores = matrix[st.id]||{};
    const totals = subj.map(s => scores[s.id]?.tot ?? '');
    const grand  = totals.reduce((a,v) => a + (Number(v)||0), 0);
    const maxP   = subj.length * subjMax;
    const avg    = maxP > 0 ? Math.round(grand/maxP*100) : 0;
    return [i+1, st.name, st.id||'', ...totals, grand, avg+'%'];
  });

  const csv = [headers, ...rows].map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'broadsheet.csv';
  a.click();
}

// ── SYSTEM SETTINGS ──

function populateScheduleExamSelects() {
  if (!state.setup) return;
  const classSel = document.getElementById('sched-exam-class');
  const subjSel  = document.getElementById('sched-exam-subject');
  if (classSel) classSel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes||[]).map(c=>`<option value="${c.code}">${c.label}</option>`).join('');
  if (subjSel) subjSel.innerHTML = '<option value="">— Select Subject —</option>' +
    (state.setup.subjects||[]).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

async function submitScheduleExam() {
  const title = document.getElementById('sched-exam-title').value.trim();
  const classCode = document.getElementById('sched-exam-class').value;
  const subjectId = document.getElementById('sched-exam-subject').value;
  const examDate = document.getElementById('sched-exam-date').value;
  const startTime = document.getElementById('sched-exam-start').value;
  const endTime = document.getElementById('sched-exam-end').value;
  const venue = document.getElementById('sched-exam-venue').value.trim();
  if (!title || !classCode || !examDate) {
    showToast('Exam title, class, and date are required');
    return;
  }
  try {
    await apiFetch('/api/admin/exam-schedule', {
      method: 'POST',
      body: JSON.stringify({ title, classCode, subjectId, examDate, startTime, endTime, venue }),
    });
    showToast('Exam added to timetable');
    document.getElementById('sched-exam-title').value = '';
    document.getElementById('sched-exam-venue').value = '';
  } catch (err) {
    showToast(err.message);
  }
}

async function loadExamTimetable() {
  const tbody = document.getElementById('examTimetable-tbody');
  try {
    const data = await apiFetch('/api/admin/exam-schedule');
    const rows = data.schedule || [];
    tbody.innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td>${escapeHtml(r.examDate)}</td>
          <td>${escapeHtml([r.startTime, r.endTime].filter(Boolean).join(' – '))}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.classLabel)}</td>
          <td>${escapeHtml(r.subjectName || '—')}</td>
          <td>${escapeHtml(r.venue || '—')}</td>
          <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="deleteExamScheduleEntry(${r.id})">Remove</button></td>
        </tr>`).join('')
      : '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--text-3)">No exams scheduled yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function deleteExamScheduleEntry(id) {
  if (!confirm('Remove this exam from the timetable?')) return;
  try {
    await apiFetch(`/api/admin/exam-schedule/${id}`, { method: 'DELETE' });
    showToast('Removed from timetable');
    loadExamTimetable();
  } catch (err) {
    showToast(err.message);
  }
}

// ── E-CLASS: CBT QUESTION BANK ──

let qbQuestions = [];

function qbInit() {
  if (!state.setup) return;
  const classSel = document.getElementById('qb-class');
  const subjSel = document.getElementById('qb-subject');
  if (classSel) classSel.innerHTML = '<option value="">Select Class</option>' +
    (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  if (subjSel) subjSel.innerHTML = '<option value="">Select Subject</option>' +
    (state.setup.subjects || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('qb-bank-card').style.display = 'none';
}

async function qbGoToBank() {
  const classSel = document.getElementById('qb-class');
  const subjSel = document.getElementById('qb-subject');
  const classCode = classSel.value;
  const subjectId = subjSel.value;
  if (!classCode || !subjectId) { showToast('Select a class and subject first'); return; }
  const card = document.getElementById('qb-bank-card');
  card.style.display = 'block';
  const classLabel = classSel.selectedOptions[0]?.textContent || classCode;
  const subjectName = subjSel.selectedOptions[0]?.textContent || '';
  document.getElementById('qb-bank-title').textContent = `QUESTION BANK : ${subjectName.toUpperCase()} | ${classLabel.toUpperCase()}`;
  const tbody = document.getElementById('qb-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const data = await apiFetch(`/api/admin/cbt/questions?classCode=${encodeURIComponent(classCode)}&subjectId=${encodeURIComponent(subjectId)}`);
    qbQuestions = data.questions || [];
    qbPopulateTagFilter();
    qbRender();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function qbPopulateTagFilter() {
  const sel = document.getElementById('qbf-tag');
  const tags = new Set();
  qbQuestions.forEach(q => (q.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t)));
  const current = sel.value;
  sel.innerHTML = '<option value="">All Tags</option>' + [...tags].sort().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  sel.value = current;
}

function qbToggleFilters() {
  const el = document.getElementById('qb-filters');
  el.style.display = el.style.display === 'grid' ? 'none' : 'grid';
}

function qbRender() {
  const tbody = document.getElementById('qb-tbody');
  const pag = document.getElementById('qb-pagination');
  const q = (document.getElementById('qb-search')?.value || '').toLowerCase();
  const perPage = Number(document.getElementById('qb-per-page')?.value || 25);
  const takenFilter = document.getElementById('qbf-taken')?.value ?? '';
  const vettedFilter = document.getElementById('qbf-vetted')?.value ?? '';
  const archivedFilter = document.getElementById('qbf-archived')?.value ?? '';
  const tagFilter = document.getElementById('qbf-tag')?.value ?? '';
  const fromFilter = document.getElementById('qbf-from')?.value ?? '';
  const toFilter = document.getElementById('qbf-to')?.value ?? '';

  let rows = qbQuestions;
  if (q) rows = rows.filter(r => r.questionText.toLowerCase().includes(q));
  if (takenFilter !== '') rows = rows.filter(r => String(r.takenBefore ? 1 : 0) === takenFilter);
  if (vettedFilter !== '') rows = rows.filter(r => String(r.vetted ? 1 : 0) === vettedFilter);
  if (archivedFilter !== '') rows = rows.filter(r => String(r.archived ? 1 : 0) === archivedFilter);
  if (tagFilter) rows = rows.filter(r => (r.tags || '').split(',').map(t => t.trim()).includes(tagFilter));
  if (fromFilter) rows = rows.filter(r => r.createdAt >= fromFilter);
  if (toFilter) rows = rows.filter(r => r.createdAt <= toFilter + 'T23:59:59');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">No questions / match found</td></tr>';
    pag.innerHTML = 'Showing 0 to 0 of 0 entries';
    return;
  }
  const page = rows.slice(0, perPage);
  tbody.innerHTML = page.map(r => `
    <tr>
      <td><input type="checkbox" class="qb-row-check" value="${r.id}"></td>
      <td>
        <a href="javascript:void(0)" onclick="qbOpenEditQuestion(${r.id})">${escapeHtml(r.questionText)}</a>
        <div style="font-size:11px;color:var(--text-3);">${r.marks} Mark${Number(r.marks) === 1 ? '' : 's'}${r.archived ? ' &middot; <span style="color:var(--red);">Archived</span>' : ''}</div>
      </td>
      <td>${escapeHtml(r.questionType)}</td>
      <td>${r.optionCount || 0}</td>
      <td>${r.vetted ? '<span style="color:var(--green);font-weight:700;">Yes</span>' : '<span style="color:var(--text-3);">No</span>'}</td>
      <td>${r.takenBefore ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(r.addedBy || '—')}</td>
      <td>
        <button class="post-btn" style="padding:4px 10px;font-size:11px;" onclick="qbToggleVet(${r.id})">${r.vetted ? 'Unvet' : 'Vet'}</button>
        <button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="qbDeleteQuestion(${r.id})">Delete</button>
      </td>
    </tr>
  `).join('');
  pag.innerHTML = `Showing 1 to ${page.length} of ${rows.length} entries`;
}

function qbToggleAll(box) {
  document.querySelectorAll('.qb-row-check').forEach(cb => cb.checked = box.checked);
}

function qbSelectedIds() {
  return [...document.querySelectorAll('.qb-row-check:checked')].map(cb => Number(cb.value));
}

async function qbApplyBulk() {
  const action = document.getElementById('qb-bulk-action').value;
  const ids = qbSelectedIds();
  if (!ids.length) { showToast('Select at least one question'); return; }
  if (!action) { showToast('Choose an action'); return; }
  if (action === 'print') { qbPrintSelected(ids); return; }
  if (action === 'delete' && !confirm(`Delete ${ids.length} question(s)? This cannot be undone.`)) return;
  try {
    await apiFetch('/api/admin/cbt/questions/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
    showToast('Done');
    qbGoToBank();
  } catch (err) { showToast(err.message); }
}

function qbPrintSelected(ids) {
  const selected = qbQuestions.filter(q => ids.includes(q.id));
  const win = window.open('', '_blank');
  const html = selected.map((q, i) => `
    <div style="margin-bottom:20px;">
      <p><strong>${i + 1}. ${escapeHtml(q.questionText)}</strong> (${q.marks} mark${Number(q.marks) === 1 ? '' : 's'})</p>
      ${(q.options || []).map((o, j) => `<p style="margin-left:20px;">${String.fromCharCode(65 + j)}. ${escapeHtml(o.text)}</p>`).join('')}
    </div>
  `).join('');
  win.document.write(`<html><head><title>Question Paper</title></head><body>${html}</body></html>`);
  win.document.close();
  win.print();
}

function qbOpenNewQuestion() {
  const classCode = document.getElementById('qb-class').value;
  const subjectId = document.getElementById('qb-subject').value;
  if (!classCode || !subjectId) { showToast('Select a class and subject first'); return; }
  document.getElementById('qbn-modal-title').textContent = 'Add New Question';
  document.getElementById('qbn-save-btn').textContent = 'Save Question';
  document.getElementById('qbn-id').value = '';
  document.getElementById('qbn-text').value = '';
  document.getElementById('qbn-hint').value = '';
  document.getElementById('qbn-tags').value = '';
  document.getElementById('qbn-marks').value = '1';
  document.getElementById('qbn-explanation').value = '';
  document.getElementById('qbn-type').value = 'Multiple Choice Question';
  document.getElementById('qbn-option-count').value = '4';
  qbToggleOptionsUI();
  qbRenderOptionRows();
  document.getElementById('qb-question-modal').style.display = 'flex';
}

function qbOpenEditQuestion(id) {
  const q = qbQuestions.find(x => x.id === id);
  if (!q) return;
  document.getElementById('qbn-modal-title').textContent = 'Update Question';
  document.getElementById('qbn-save-btn').textContent = 'Update Question';
  document.getElementById('qbn-id').value = q.id;
  document.getElementById('qbn-text').value = q.questionText;
  document.getElementById('qbn-hint').value = q.helperHint || '';
  document.getElementById('qbn-tags').value = q.tags || '';
  document.getElementById('qbn-marks').value = q.marks;
  document.getElementById('qbn-explanation').value = q.answerExplanation || '';
  document.getElementById('qbn-type').value = q.questionType;
  document.getElementById('qbn-option-count').value = String(Math.max(1, (q.options || []).length || 4));
  qbToggleOptionsUI();
  qbRenderOptionRows(q.options || []);
  document.getElementById('qb-question-modal').style.display = 'flex';
}

function qbCloseNewQuestion() {
  document.getElementById('qb-question-modal').style.display = 'none';
}

function qbToggleOptionsUI() {
  const type = document.getElementById('qbn-type').value;
  document.getElementById('qbn-options-wrap').style.display = type === 'Multiple Choice Question' ? 'block' : 'none';
}

function qbRenderOptionRows(existing) {
  const count = Number(document.getElementById('qbn-option-count').value);
  const wrap = document.getElementById('qbn-option-rows');
  wrap.innerHTML = Array.from({ length: count }).map((_, i) => {
    const opt = existing && existing[i] ? existing[i] : { text: '', correct: false };
    return `
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="radio" name="qbn-correct-radio" value="${i}" ${opt.correct ? 'checked' : ''}>
        <input type="text" class="field-input qbn-option-text" style="flex:1;" placeholder="Option ${String.fromCharCode(65 + i)}" value="${escapeHtml(opt.text)}">
      </div>
    `;
  }).join('');
}

async function qbSubmitQuestion() {
  const id = document.getElementById('qbn-id').value;
  const classCode = document.getElementById('qb-class').value;
  const subjectId = document.getElementById('qb-subject').value;
  const questionType = document.getElementById('qbn-type').value;
  const questionText = document.getElementById('qbn-text').value.trim();
  const marks = document.getElementById('qbn-marks').value;
  const helperHint = document.getElementById('qbn-hint').value.trim();
  const tags = document.getElementById('qbn-tags').value.trim();
  const answerExplanation = document.getElementById('qbn-explanation').value.trim();
  let options = [];
  if (questionType === 'Multiple Choice Question') {
    const correctIndex = document.querySelector('input[name="qbn-correct-radio"]:checked')?.value;
    options = [...document.querySelectorAll('.qbn-option-text')].map((input, i) => ({
      text: input.value.trim(),
      correct: String(i) === correctIndex,
    })).filter(o => o.text);
  }
  if (!questionText) { showToast('Question text is required'); return; }
  const payload = { classCode, subjectId, questionType, questionText, marks, helperHint, tags, answerExplanation, options };
  try {
    if (id) {
      await apiFetch(`/api/admin/cbt/questions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Question updated');
    } else {
      await apiFetch('/api/admin/cbt/questions', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Question added');
    }
    qbCloseNewQuestion();
    qbGoToBank();
  } catch (err) {
    showToast(err.message);
  }
}
async function qbToggleVet(id) {
  try {
    await apiFetch(`/api/admin/cbt/questions/${id}/vet`, { method: 'PUT' });
    qbGoToBank();
  } catch (err) { showToast(err.message); }
}
async function qbDeleteQuestion(id) {
  if (!confirm('Delete this question?')) return;
  try {
    await apiFetch(`/api/admin/cbt/questions/${id}`, { method: 'DELETE' });
    showToast('Question deleted');
    qbGoToBank();
  } catch (err) { showToast(err.message); }
}

// ── E-CLASS: INSTRUCTION SETS ──

let isCache = [];

function isInit() {
  isLoad();
}
async function isLoad() {
  const tbody = document.getElementById('is-tbody');
  try {
    const data = await apiFetch('/api/admin/cbt/instruction-sets');
    isCache = data.instructionSets || [];
    tbody.innerHTML = isCache.length ? isCache.map(r => `
      <tr>
        <td><a href="javascript:void(0)" onclick="isPreview(${r.id})">${escapeHtml(r.title)}</a></td>
        <td style="max-width:360px;white-space:normal;">${escapeHtml((r.instructions || '').slice(0, 140))}${(r.instructions || '').length > 140 ? '…' : ''}</td>
        <td>${escapeHtml((r.createdAt || '').slice(0, 10))}</td>
        <td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="isDelete(${r.id})">Delete</button></td>
      </tr>
    `).join('') : '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No instruction sets yet</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}
function isPreview(id) {
  const row = isCache.find(r => r.id === id);
  if (!row) return;
  alert(`${row.title}\n\n${row.instructions}`);
}
function isOpenNew() {
  document.getElementById('isn-title').value = '';
  document.getElementById('isn-text').value = '';
  document.getElementById('is-modal').style.display = 'flex';
}
function isCloseNew() { document.getElementById('is-modal').style.display = 'none'; }
async function isSubmitNew() {
  const title = document.getElementById('isn-title').value.trim();
  const instructions = document.getElementById('isn-text').value.trim();
  if (!title || !instructions) { showToast('Title and instruction are required'); return; }
  try {
    await apiFetch('/api/admin/cbt/instruction-sets', {
      method: 'POST',
      body: JSON.stringify({ title, instructions }),
    });
    showToast('Instruction set saved');
    isCloseNew();
    isLoad();
  } catch (err) { showToast(err.message); }
}
async function isDelete(id) {
  if (!confirm('Delete this instruction set?')) return;
  try {
    await apiFetch(`/api/admin/cbt/instruction-sets/${id}`, { method: 'DELETE' });
    showToast('Deleted');
    isLoad();
  } catch (err) { showToast(err.message); }
}

// ── E-CLASS: CBT SCHEDULES ──

let csSchedulesCache = [];
let csCurrentScheduleId = null;
let csCurrentSubjectsCache = [];

async function csInit() {
  if (!state.setup) return;
  const classSel = document.getElementById('cs-class');
  if (classSel) classSel.innerHTML = '<option value="">All</option>' +
    (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  const csForExam = document.getElementById('cs-for-exam');
  if (csForExam) csForExam.innerHTML = '<option value="">All</option>' +
    (state.setup.examTypes || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  const csnForExam = document.getElementById('csn-for-exam');
  if (csnForExam) csnForExam.innerHTML = '<option value="">— Select —</option>' +
    (state.setup.examTypes || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  const classesWrap = document.getElementById('csn-classes');
  if (classesWrap) classesWrap.innerHTML = (state.setup.classes || []).filter(c => !c.archived).map(c => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
      <input type="checkbox" class="csn-class-check" value="${c.code}"> ${escapeHtml(c.label)}
    </label>
  `).join('');
  try {
    const data = await apiFetch('/api/admin/academic-sessions');
    const sessions = [...new Set((data.sessions || []).map(s => s.sessionLabel))];
    const sessSel = document.getElementById('cs-session');
    if (sessSel) {
      sessSel.innerHTML = '<option value="">All</option>' + sessions.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      const activeSession = state.setup.academic?.sessionLabel;
      if (activeSession) sessSel.value = activeSession;
    }
  } catch (err) { /* non-fatal */ }
  csdClose();
  csLoadSchedules();
}

async function csLoadSchedules() {
  const list = document.getElementById('cs-list');
  const title = document.getElementById('cs-list-title');
  const session = document.getElementById('cs-session').value;
  const forExam = document.getElementById('cs-for-exam').value;
  const classCode = document.getElementById('cs-class').value;
  const archived = document.getElementById('cs-archived').checked ? '1' : '0';
  title.textContent = `${(session || 'ALL SESSIONS').toUpperCase()} TESTS & EXAM SCHEDULES`;
  list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);grid-column:1/-1;">Loading…</div>';
  try {
    const params = new URLSearchParams();
    if (session) params.set('session', session);
    if (forExam) params.set('forExam', forExam);
    if (classCode) params.set('classCode', classCode);
    params.set('archived', archived);
    const data = await apiFetch(`/api/admin/cbt/schedules?${params.toString()}`);
    csSchedulesCache = data.schedules || [];
    if (!csSchedulesCache.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);grid-column:1/-1;">No exam schedules found</div>';
      return;
    }
    list.innerHTML = csSchedulesCache.map(s => `
      <div class="card" style="margin:0;">
        <div class="card-body">
          <div style="font-weight:700;font-size:13px;">${escapeHtml(s.title)} <span style="color:var(--text-3);font-weight:400;">| ${escapeHtml(s.termLabel)} ${escapeHtml(s.sessionLabel)}</span></div>
          <div style="font-size:12px;color:var(--text-2);margin-top:6px;">Mode: ${escapeHtml(s.mode)}</div>
          <div style="font-size:12px;color:var(--text-2);">Starts: ${escapeHtml(s.startDate || 'No date set')}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
            <span style="background:var(--black-3);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">Classes: ${s.classCount}</span>
            <div style="display:flex;gap:6px;">
              <button class="post-btn" style="padding:4px 10px;font-size:11px;" onclick="csdOpen(${s.id})">View Schedule &rsaquo;</button>
              <button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="csArchiveToggle(${s.id}, ${s.archived})">${s.archived ? 'Unarchive' : 'Archive'}</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red);grid-column:1/-1;">${escapeHtml(err.message)}</div>`;
  }
}

function csOpenNew() {
  document.getElementById('csn-title').value = '';
  document.getElementById('csn-session').value = state.setup?.academic?.sessionLabel || '';
  document.getElementById('csn-term').value = state.setup?.academic?.termLabel || '';
  document.getElementById('csn-for-exam').value = '';
  document.getElementById('csn-start-date').value = '';
  document.querySelectorAll('.csn-class-check').forEach(cb => cb.checked = false);
  document.getElementById('cs-new-modal').style.display = 'flex';
}
function csCloseNew() { document.getElementById('cs-new-modal').style.display = 'none'; }

async function csSubmitNew() {
  const title = document.getElementById('csn-title').value.trim();
  const sessionLabel = document.getElementById('csn-session').value.trim();
  const termLabel = document.getElementById('csn-term').value.trim();
  const forExam = document.getElementById('csn-for-exam').value;
  const startDate = document.getElementById('csn-start-date').value;
  const classCodes = [...document.querySelectorAll('.csn-class-check:checked')].map(cb => cb.value);
  if (!title || !sessionLabel || !termLabel || !startDate || !classCodes.length) {
    showToast('Title, session, term, start date, and at least one class are required');
    return;
  }
  try {
    await apiFetch('/api/admin/cbt/schedules', {
      method: 'POST',
      body: JSON.stringify({ title, sessionLabel, termLabel, forExam, mode: 'Computer Based', startDate, classCodes }),
    });
    showToast('Exam schedule created');
    csCloseNew();
    csLoadSchedules();
  } catch (err) { showToast(err.message); }
}

async function csArchiveToggle(id, archived) {
  try {
    await apiFetch(`/api/admin/cbt/schedules/${id}/archive`, { method: 'PUT' });
    showToast(archived ? 'Schedule unarchived' : 'Schedule archived');
    csLoadSchedules();
  } catch (err) { showToast(err.message); }
}

// ── Schedule detail: per-class, per-subject exam entries ──

async function csdOpen(scheduleId) {
  csCurrentScheduleId = scheduleId;
  try {
    const data = await apiFetch(`/api/admin/cbt/schedules/${scheduleId}`);
    const s = data.schedule;
    document.getElementById('cs-detail-title').textContent = `Schedule for: ${s.title} | ${s.termLabel} | ${s.sessionLabel}`;
    document.getElementById('cs-list-card').style.display = 'none';
    document.getElementById('cs-list-card-2').style.display = 'none';
    document.getElementById('cs-detail-card').style.display = 'block';
    const classSel = document.getElementById('csd-class');
    classSel.innerHTML = '<option value="">Select Class</option>' +
      s.classes.map(c => `<option value="${c.classCode}">${escapeHtml(c.classLabel)}</option>`).join('');
    document.getElementById('csd-arm').innerHTML = '<option value="">All</option>';
    document.getElementById('csd-mode').value = 'All';
    document.getElementById('csd-tbody').innerHTML = '<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--text-3)">Select a class to view scheduled subjects.</td></tr>';
  } catch (err) { showToast(err.message); }
}

function csdClose() {
  csCurrentScheduleId = null;
  const detail = document.getElementById('cs-detail-card');
  if (detail) detail.style.display = 'none';
  const list1 = document.getElementById('cs-list-card');
  const list2 = document.getElementById('cs-list-card-2');
  if (list1) list1.style.display = 'block';
  if (list2) list2.style.display = 'block';
}

function csdOnClassChange() {
  const classCode = document.getElementById('csd-class').value;
  const armSel = document.getElementById('csd-arm');
  armSel.innerHTML = '<option value="">All</option>' +
    (state.setup.classArms || []).filter(a => a.classCode === classCode).map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  csdLoadSubjects();
}

async function csdLoadSubjects() {
  const tbody = document.getElementById('csd-tbody');
  const classCode = document.getElementById('csd-class').value;
  if (!classCode || !csCurrentScheduleId) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--text-3)">Select a class to view scheduled subjects.</td></tr>';
    return;
  }
  const classArmId = document.getElementById('csd-arm').value;
  const mode = document.getElementById('csd-mode').value;
  tbody.innerHTML = '<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ classCode });
    if (classArmId) params.set('classArmId', classArmId);
    if (mode && mode !== 'All') params.set('mode', mode);
    const data = await apiFetch(`/api/admin/cbt/schedules/${csCurrentScheduleId}/subjects?${params.toString()}`);
    csCurrentSubjectsCache = data.subjects || [];
    if (!csCurrentSubjectsCache.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--text-3)">No subjects scheduled yet for this class.</td></tr>';
      return;
    }
    tbody.innerHTML = csCurrentSubjectsCache.map(r => `
      <tr>
        <td><input type="checkbox" class="csd-row-check" value="${r.id}"></td>
        <td>${escapeHtml(r.examDate || 'No date set')}<br><span style="color:var(--text-3);font-size:11px;">${escapeHtml(r.examTime || 'No time set')}</span><br><span style="background:var(--blue-bg);color:var(--blue);border-radius:10px;padding:1px 8px;font-size:10px;">${r.status === 'live' ? 'Live' : r.status === 'closed' ? 'Closed' : 'Upcoming'}</span></td>
        <td>${escapeHtml(r.subjectName)}</td>
        <td>${escapeHtml(r.classLabel)}${r.classArmName ? ' - ' + escapeHtml(r.classArmName) : ''}<br><span style="color:var(--text-3);font-size:11px;">${r.candidateCount} Total Candidates</span></td>
        <td>${escapeHtml(r.mode)}<br><span style="color:var(--text-3);font-size:11px;">Submissions ${r.submissionCount}</span></td>
        <td>${r.durationMinutes} mins<br><span style="background:var(--black-3);border-radius:10px;padding:1px 8px;font-size:10px;">${r.questionCount} Questions</span></td>
        <td>${escapeHtml(r.venue || '—')}</td>
        <td>${escapeHtml(r.supervisorName || '—')}</td>
        <td>${r.visibleToStudents ? 'Yes' : 'No'}</td>
        <td>
          <button class="post-btn" style="padding:3px 8px;font-size:11px;" onclick="csdSetStatus(${r.id},'live')" ${r.status === 'live' ? 'disabled' : ''} title="Start">&#9654;</button>
          <button class="del-btn" style="padding:3px 8px;font-size:11px;" onclick="csdSetStatus(${r.id},'closed')" ${r.status === 'closed' ? 'disabled' : ''} title="Stop">&#9632;</button>
        </td>
        <td>
          <select class="ctrl-select" style="font-size:11px;padding:4px;" onchange="csdRowOptionSelected(this, ${r.id})">
            <option value="">&hellip;</option>
            <option value="manage">Manage CBT / Edit</option>
            <option value="submissions">View Submissions</option>
            <option value="delete">Delete</option>
          </select>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function csdToggleAll(box) {
  document.querySelectorAll('.csd-row-check').forEach(cb => cb.checked = box.checked);
}

async function csdApplyBulk() {
  const action = document.getElementById('csd-bulk-action').value;
  const ids = [...document.querySelectorAll('.csd-row-check:checked')].map(cb => Number(cb.value));
  if (!ids.length) { showToast('Select at least one row'); return; }
  if (action === 'delete') {
    if (!confirm(`Delete ${ids.length} scheduled subject(s)?`)) return;
    try {
      await Promise.all(ids.map(id => apiFetch(`/api/admin/cbt/schedule-subjects/${id}`, { method: 'DELETE' })));
      showToast('Deleted');
      csdLoadSubjects();
    } catch (err) { showToast(err.message); }
  }
}

function csdRowOptionSelected(select, id) {
  const action = select.value;
  select.value = '';
  if (action === 'manage') csdOpenEdit(id);
  if (action === 'submissions') csdViewSubmissions(id);
  if (action === 'delete') csdDeleteRow(id);
}

async function csdSetStatus(id, status) {
  try {
    await apiFetch(`/api/admin/cbt/schedule-subjects/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    csdLoadSubjects();
  } catch (err) { showToast(err.message); }
}

async function csdDeleteRow(id) {
  if (!confirm('Delete this scheduled subject?')) return;
  try {
    await apiFetch(`/api/admin/cbt/schedule-subjects/${id}`, { method: 'DELETE' });
    showToast('Deleted');
    csdLoadSubjects();
  } catch (err) { showToast(err.message); }
}

function csdViewSubmissions(id) {
  const row = csCurrentSubjectsCache.find(r => r.id === id);
  if (!row) return;
  switchTab('cbtScores', document.querySelector('.sub-nav-item[data-tab="cbtScores"]'));
  setTimeout(() => cscPreselect(row), 150);
}

// ── Add Exam Subjects modal ──

function csdOpenAddSubjects() {
  const classCode = document.getElementById('csd-class').value;
  if (!classCode) { showToast('Select a class first'); return; }
  const armsWrap = document.getElementById('csda-arms');
  armsWrap.innerHTML = (state.setup.classArms || []).filter(a => a.classCode === classCode).map(a => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" class="csda-arm-check" value="${a.id}"> ${escapeHtml(a.name)}</label>
  `).join('') || '<span style="font-size:12px;color:var(--text-3);">No class arms set up for this class.</span>';
  const subjWrap = document.getElementById('csda-subjects');
  const subjectIds = new Set((state.setup.classSubjects || []).filter(cs => cs.classCode === classCode).map(cs => cs.subjectId));
  const subjects = (state.setup.subjects || []).filter(s => subjectIds.has(s.id));
  subjWrap.innerHTML = subjects.map(s => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" class="csda-subject-check" value="${s.id}"> ${escapeHtml(s.name)}</label>
  `).join('') || '<span style="font-size:12px;color:var(--text-3);">No subjects set up for this class.</span>';
  const supervisorSel = document.getElementById('csda-supervisor');
  supervisorSel.innerHTML = (state.setup.teachers || state.setup.staff || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  document.getElementById('csda-duration').value = '30';
  document.getElementById('csda-date').value = '';
  document.getElementById('csda-time').value = '';
  document.getElementById('csda-mode').value = 'Computer Based';
  document.getElementById('csda-venue').value = '';
  document.getElementById('csda-visible').value = '1';
  document.getElementById('csd-add-modal').style.display = 'flex';
}
function csdCloseAddSubjects() { document.getElementById('csd-add-modal').style.display = 'none'; }

async function csdSubmitAddSubjects() {
  const classCode = document.getElementById('csd-class').value;
  const classArmIds = [...document.querySelectorAll('.csda-arm-check:checked')].map(cb => Number(cb.value));
  const subjectIds = [...document.querySelectorAll('.csda-subject-check:checked')].map(cb => Number(cb.value));
  const durationMinutes = document.getElementById('csda-duration').value;
  const examDate = document.getElementById('csda-date').value;
  const examTime = document.getElementById('csda-time').value;
  const supervisorId = document.getElementById('csda-supervisor').value;
  const mode = document.getElementById('csda-mode').value;
  const venue = document.getElementById('csda-venue').value.trim();
  const visibleToStudents = document.getElementById('csda-visible').value === '1';
  if (!subjectIds.length || !durationMinutes) {
    showToast('Subject(s) and duration are required');
    return;
  }
  try {
    await apiFetch(`/api/admin/cbt/schedules/${csCurrentScheduleId}/subjects`, {
      method: 'POST',
      body: JSON.stringify({ classCode, classArmIds, subjectIds, durationMinutes, examDate, examTime, supervisorId, mode, venue, visibleToStudents }),
    });
    showToast('Exam subject(s) added');
    csdCloseAddSubjects();
    csdLoadSubjects();
  } catch (err) { showToast(err.message); }
}

// ── Manage CBT / Edit scheduled subject modal ──

function csdOpenEdit(id) {
  const row = csCurrentSubjectsCache.find(r => r.id === id);
  if (!row) return;
  document.getElementById('csde-id').value = row.id;
  document.getElementById('csde-duration').value = row.durationMinutes;
  document.getElementById('csde-date').value = row.examDate || '';
  document.getElementById('csde-time').value = row.examTime || '';
  const supervisorSel = document.getElementById('csde-supervisor');
  supervisorSel.innerHTML = (state.setup.teachers || state.setup.staff || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  supervisorSel.value = row.supervisorId || '';
  document.getElementById('csde-mode').value = row.mode;
  document.getElementById('csde-venue').value = row.venue || '';
  document.getElementById('csde-visible').value = row.visibleToStudents ? '1' : '0';
  document.getElementById('csd-edit-modal').style.display = 'flex';
}
function csdCloseEdit() { document.getElementById('csd-edit-modal').style.display = 'none'; }

async function csdSubmitEdit() {
  const id = document.getElementById('csde-id').value;
  const durationMinutes = document.getElementById('csde-duration').value;
  const examDate = document.getElementById('csde-date').value;
  const examTime = document.getElementById('csde-time').value;
  const supervisorId = document.getElementById('csde-supervisor').value;
  const mode = document.getElementById('csde-mode').value;
  const venue = document.getElementById('csde-venue').value.trim();
  const visibleToStudents = document.getElementById('csde-visible').value === '1';
  if (!durationMinutes) { showToast('Duration is required'); return; }
  try {
    await apiFetch(`/api/admin/cbt/schedule-subjects/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ durationMinutes, examDate, examTime, supervisorId, mode, venue, visibleToStudents }),
    });
    showToast('Saved');
    csdCloseEdit();
    csdLoadSubjects();
  } catch (err) { showToast(err.message); }
}

// ── E-CLASS: CBT SCORES ──

async function cscInit() {
  if (!state.setup) return;
  const classSel = document.getElementById('csc-class');
  if (classSel) classSel.innerHTML = '<option value="">Select Class</option>' +
    (state.setup.classes || []).map(c => `<option value="${c.code}">${escapeHtml(c.label)}</option>`).join('');
  document.getElementById('csc-arm').innerHTML = '<option value="">All</option>';
  document.getElementById('csc-subject').innerHTML = '<option value="">Select Exam First</option>';
  document.getElementById('csc-results-card').style.display = 'none';
  document.getElementById('csc-upload-card').style.display = 'none';
  const examSel = document.getElementById('csc-exam');
  try {
    const data = await apiFetch('/api/admin/academic-sessions');
    const sessions = data.sessions || [];
    examSel.innerHTML = '<option value="">Select</option>' +
      sessions.map(s => `<option value="${escapeHtml(s.sessionLabel)}|${escapeHtml(s.termLabel)}">${escapeHtml(s.termLabel)}, ${escapeHtml(s.sessionLabel)} (TERMLY EXAMINATION)</option>`).join('');
  } catch (err) { /* non-fatal */ }
  const examTypeSel = document.getElementById('cscu-exam-type');
  if (examTypeSel) examTypeSel.innerHTML = (state.setup.examTypes || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

function cscOnExamChange() {
  document.getElementById('csc-subject').innerHTML = '<option value="">Select Exam First</option>';
  cscOnClassChange();
}

async function cscOnClassChange() {
  const classCode = document.getElementById('csc-class').value;
  const armSel = document.getElementById('csc-arm');
  const subjSel = document.getElementById('csc-subject');
  if (armSel.dataset.classCode !== classCode) {
    armSel.innerHTML = '<option value="">All</option>' +
      (state.setup.classArms || []).filter(a => a.classCode === classCode).map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    armSel.dataset.classCode = classCode;
  }
  const examValue = document.getElementById('csc-exam').value;
  if (!classCode || !examValue) {
    subjSel.innerHTML = '<option value="">Select Exam First</option>';
    return;
  }
  const [sessionLabel, termLabel] = examValue.split('|');
  const classArmId = armSel.value;
  try {
    const params = new URLSearchParams({ classCode, session: sessionLabel, term: termLabel });
    if (classArmId) params.set('classArmId', classArmId);
    const data = await apiFetch(`/api/admin/cbt/subject-options?${params.toString()}`);
    const options = data.options || [];
    subjSel.innerHTML = options.length
      ? '<option value="">-Select-</option>' + options.map(o => `<option value="${o.id}">${escapeHtml(o.subjectName)} | ${escapeHtml(o.scheduleTitle)}</option>`).join('')
      : '<option value="">No scheduled CBT subjects</option>';
  } catch (err) { showToast(err.message); }
}

async function cscViewScores() {
  const scheduleSubjectId = document.getElementById('csc-subject').value;
  const classSel = document.getElementById('csc-class');
  const subjSel = document.getElementById('csc-subject');
  if (!scheduleSubjectId) { showToast('Select exam, class, and subject'); return; }
  const card = document.getElementById('csc-results-card');
  const uploadCard = document.getElementById('csc-upload-card');
  const tbody = document.getElementById('csc-tbody');
  card.style.display = 'block';
  uploadCard.style.display = 'block';
  tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';
  try {
    const data = await apiFetch(`/api/admin/cbt/scores?scheduleSubjectId=${scheduleSubjectId}`);
    const rows = data.scores || [];
    document.getElementById('csc-results-title').textContent =
      `CBT Scores — ${classSel.selectedOptions[0]?.textContent || ''} / ${subjSel.selectedOptions[0]?.textContent || ''}`;
    tbody.innerHTML = rows.length ? rows.map(r => {
      const pct = r.score != null && r.totalMarks ? Math.round((r.score / r.totalMarks) * 100) : null;
      return `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td><input type="number" class="field-input" style="width:70px;" id="csc-score-${escapeHtml(r.studentId)}" value="${r.score ?? ''}" min="0"></td>
        <td><input type="number" class="field-input" style="width:70px;" id="csc-total-${escapeHtml(r.studentId)}" value="${r.totalMarks ?? 100}" min="1"></td>
        <td><input type="number" class="field-input" style="width:60px;" id="csc-present-${escapeHtml(r.studentId)}" value="${r.questionsPresented ?? ''}" min="0"></td>
        <td><input type="number" class="field-input" style="width:60px;" id="csc-attempted-${escapeHtml(r.studentId)}" value="${r.questionsAttempted ?? ''}" min="0"></td>
        <td>${pct != null ? pct + '%' : '—'}</td>
        <td>${escapeHtml((r.recordedAt || '').slice(0, 10)) || '—'}</td>
        <td>
          <button class="post-btn" style="padding:4px 10px;font-size:11px;" onclick="cscSaveScore('${r.studentId}')">Save</button>
          ${r.submittedAt ? `<button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="cscAllowRetake('${escapeHtml(r.studentId)}')" title="Clear this student's locked attempt so they can sit this exam again">Allow Retake</button>` : ''}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">No students / match found</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function cscSaveScore(studentId) {
  const scheduleSubjectId = document.getElementById('csc-subject').value;
  const score = document.getElementById(`csc-score-${studentId}`).value;
  const totalMarks = document.getElementById(`csc-total-${studentId}`).value;
  const questionsPresented = document.getElementById(`csc-present-${studentId}`).value;
  const questionsAttempted = document.getElementById(`csc-attempted-${studentId}`).value;
  if (score === '') { showToast('Enter a score'); return; }
  try {
    await apiFetch('/api/admin/cbt/scores', {
      method: 'POST',
      body: JSON.stringify({ scheduleSubjectId, studentId, score, totalMarks, questionsPresented, questionsAttempted }),
    });
    showToast('Score saved');
    cscViewScores();
  } catch (err) { showToast(err.message); }
}

async function cscAllowRetake(studentId) {
  const scheduleSubjectId = document.getElementById('csc-subject').value;
  if (!confirm('Clear this student\'s submitted attempt so they can sit the exam again? Their previous answers will be gone.')) return;
  try {
    await apiFetch(`/api/admin/cbt/schedule-subjects/${scheduleSubjectId}/students/${encodeURIComponent(studentId)}/retake`, { method: 'POST' });
    showToast('Retake allowed — the student can start this exam again');
    cscViewScores();
  } catch (err) { showToast(err.message); }
}

async function cscUpload() {
  const scheduleSubjectId = document.getElementById('csc-subject').value;
  const examType = document.getElementById('cscu-exam-type').value;
  const rescaleTotal = document.getElementById('cscu-new-total').value;
  if (!scheduleSubjectId || !examType) { showToast('Select a subject and exam type first'); return; }
  try {
    const data = await apiFetch('/api/admin/cbt/scores/upload-to-gradebook', {
      method: 'POST',
      body: JSON.stringify({ scheduleSubjectId, examType, rescaleTotal }),
    });
    showToast(`Uploaded ${data.uploaded} score(s) to the Results Grade Book`);
  } catch (err) { showToast(err.message); }
}

async function cscPreselect(row) {
  document.getElementById('csc-exam').value = `${row.sessionLabel}|${row.termLabel}`;
  document.getElementById('csc-class').value = row.classCode;
  await cscOnClassChange();
  const armSel = document.getElementById('csc-arm');
  if (row.classArmId) {
    armSel.value = row.classArmId;
    await cscOnClassChange();
  }
  document.getElementById('csc-subject').value = row.id;
  cscViewScores();
}

// ── ACADEMIC TERMS TAB ──

function atFilterTable(tbodyId, q) {
  const lq = q.toLowerCase();
  document.querySelectorAll(`#${tbodyId} tr`).forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

// ── ACADEMIC TERMS TAB STATE ──
let _atSessions = [];
let _atFiltered = [];
let _atPage = 1;

async function loadAcademicTermsTab() {
  try {
    const data = await apiFetch('/api/admin/academic-sessions');
    _atSessions = data.sessions || [];
    _atFiltered = [..._atSessions];
    _atPage = 1;

    const active = _atSessions.find(s => s.isActive);
    const atSess = document.getElementById('at-sess-label');
    const atYear = document.getElementById('at-year-label');
    const atTerm = document.getElementById('at-term-label');
    if (atSess) atSess.textContent = active ? active.sessionLabel : '—';
    if (atYear) atYear.textContent = active ? (active.sessionLabel || '').split('-')[0] || '—' : '—';
    if (atTerm) atTerm.textContent = active ? (active.termLabel || '—') : '—';

    // Populate topbar session info widget
    var tsiSession = document.getElementById('tsi-session');
    var tsiTerm    = document.getElementById('tsi-term');
    var tsiBox     = document.getElementById('topbar-session-info');
    if (tsiSession) tsiSession.textContent = active ? active.sessionLabel : '—';
    if (tsiTerm)    tsiTerm.textContent    = active ? (active.termLabel || '—') : '—';
    if (tsiBox)     tsiBox.style.display   = 'flex';

    atRenderSessions();
  } catch(e) {
    const tbody = document.getElementById('at-sessions-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:#dc2626">${e.message}</td></tr>`;
  }
}

function atSearchSessions(q) {
  const query = (q || '').toLowerCase();
  _atFiltered = !query ? [..._atSessions] : _atSessions.filter(s =>
    (s.sessionLabel || '').toLowerCase().includes(query)
  );
  _atPage = 1;
  atRenderSessions();
}

function atRenderSessions() {
  const tbody = document.getElementById('at-sessions-tbody');
  const info  = document.getElementById('at-sessions-info');
  const pages = document.getElementById('at-sessions-pages');
  if (!tbody) return;

  const perPage = Number(document.getElementById('at-per-page')?.value || 20);
  const total   = _atFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (_atPage > totalPages) _atPage = totalPages;

  const start = (_atPage - 1) * perPage;
  const slice = _atFiltered.slice(start, start + perPage);

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-3)">No academic sessions found.</td></tr>';
    if (info) info.textContent = 'Showing 0 to 0 of 0 entries';
    if (pages) pages.innerHTML = '';
    return;
  }

  tbody.innerHTML = slice.map((s, idx) => {
    const [startY, endY] = (s.sessionLabel || '').split('/');
    const statusBadge = s.isActive
      ? '<span style="background:#dbeafe;color:#1d4ed8;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid #bfdbfe;">Active Academic Session</span>'
      : '';
    const actionBtn = !s.isActive
      ? `<button title="Set as active" style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border-2);background:var(--black-3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;transition:all .15s" onclick="setActiveSession(${s.id})" onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border-2)'">&#9998;</button>`
      : '';
    return `<tr>
      <td style="color:var(--text-3);font-family:'DM Mono',monospace;">${start + idx + 1}</td>
      <td style="font-weight:600">${escapeHtml(s.sessionLabel)}</td>
      <td>${escapeHtml(startY || '—')}</td>
      <td>${escapeHtml(endY || '—')}</td>
      <td>${statusBadge}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  if (info) info.textContent = `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} entries`;

  // Pagination buttons
  if (pages) {
    const btnStyle = (active) => `style="min-width:30px;height:30px;border-radius:4px;border:1px solid var(--border-2);background:${active ? 'var(--blue)' : 'var(--black-3)'};color:${active ? '#fff' : 'var(--text-2)'};cursor:pointer;font-size:12px;font-family:'DM Mono',monospace;transition:all .15s"`;
    let html = `<button ${btnStyle(false)} onclick="atGoPage(1)" ${_atPage===1?'disabled':''}>&#171;</button>`;
    html += `<button ${btnStyle(false)} onclick="atGoPage(${_atPage-1})" ${_atPage===1?'disabled':''}>&#8249;</button>`;
    for (let p = Math.max(1, _atPage-2); p <= Math.min(totalPages, _atPage+2); p++) {
      html += `<button ${btnStyle(p===_atPage)} onclick="atGoPage(${p})">${p}</button>`;
    }
    html += `<button ${btnStyle(false)} onclick="atGoPage(${_atPage+1})" ${_atPage===totalPages?'disabled':''}>&#8250;</button>`;
    html += `<button ${btnStyle(false)} onclick="atGoPage(${totalPages})" ${_atPage===totalPages?'disabled':''}>&#187;</button>`;
    pages.innerHTML = html;
  }
}

function atGoPage(p) {
  const perPage = Number(document.getElementById('at-per-page')?.value || 20);
  const totalPages = Math.max(1, Math.ceil(_atFiltered.length / perPage));
  _atPage = Math.max(1, Math.min(p, totalPages));
  atRenderSessions();
}

// ── SCHOOL CALENDAR ──
let _calAcademicId = null;
let _calData = { startDate: '', endDate: '', schoolDays: null, holidays: [] };

async function loadCalendarTab() {
  const active = (state.setup && state.setup.academic) || _atSessions.find(s => s.isActive);
  if (!active) return;
  _calAcademicId = active.id;
  try {
    const data = await apiFetch(`/api/admin/academic-sessions/${_calAcademicId}/holidays`);
    _calData = data;
    renderCalendarPanel();
  } catch (e) {
    showToast(e.message, true);
  }
}

function renderCalendarPanel() {
  document.getElementById('cal-start-date').value = _calData.startDate || '';
  document.getElementById('cal-end-date').value = _calData.endDate || '';

  const summary = document.getElementById('cal-days-summary');
  const noDates = document.getElementById('cal-no-dates');
  if (_calData.startDate && _calData.endDate) {
    summary.style.display = '';
    noDates.style.display = 'none';
    document.getElementById('cal-days-count').textContent = _calData.schoolDays ?? '0';
  } else {
    summary.style.display = 'none';
    noDates.style.display = '';
  }

  renderCalendarMonths();
}

async function saveCalendarDates() {
  const startDate = document.getElementById('cal-start-date').value;
  const endDate = document.getElementById('cal-end-date').value;
  if (!startDate || !endDate) return showToast('Choose both a start and end date', true);
  try {
    const data = await apiFetch(`/api/admin/academic-sessions/${_calAcademicId}/dates`, {
      method: 'PUT', body: JSON.stringify({ startDate, endDate }),
    });
    _calData = data;
    renderCalendarPanel();
    showToast('Term dates saved — Nigerian public holidays in range were added automatically');
  } catch (e) {
    showToast(e.message, true);
  }
}

function renderCalendarMonths() {
  const wrap = document.getElementById('cal-months');
  if (!_calData.startDate || !_calData.endDate) { wrap.innerHTML = ''; return; }

  const holidayMap = {};
  (_calData.holidays || []).forEach(h => { holidayMap[h.date] = h; });

  const start = new Date(_calData.startDate + 'T00:00:00Z');
  const end = new Date(_calData.endDate + 'T00:00:00Z');
  const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let html = '';
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= lastMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    html += `<div class="cal-month"><div class="cal-month-title">${monthNames[month]} ${year}</div><div class="cal-grid">`;
    dow.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-day cal-empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayDate = new Date(Date.UTC(year, month, day));
      const inRange = iso >= _calData.startDate && iso <= _calData.endDate;
      const weekday = dayDate.getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const holiday = holidayMap[iso];
      if (!inRange) {
        html += `<div class="cal-day cal-empty"></div>`;
      } else if (holiday) {
        html += `<div class="cal-day cal-holiday" title="${escapeHtml(holiday.label)} — click to remove" onclick="toggleCalendarDay('${iso}')">${day}<span class="cal-holiday-dot"></span></div>`;
      } else if (isWeekend) {
        html += `<div class="cal-day cal-weekend" title="Weekend">${day}</div>`;
      } else {
        html += `<div class="cal-day cal-schoolday" title="School day — click to mark closed" onclick="toggleCalendarDay('${iso}')">${day}</div>`;
      }
    }
    html += `</div></div>`;
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  wrap.innerHTML = html;
}

async function toggleCalendarDay(iso) {
  const existing = (_calData.holidays || []).find(h => h.date === iso);
  try {
    let data;
    if (existing) {
      data = await apiFetch(`/api/admin/academic-sessions/${_calAcademicId}/holidays/${existing.id}`, { method: 'DELETE' });
    } else {
      data = await apiFetch(`/api/admin/academic-sessions/${_calAcademicId}/holidays`, {
        method: 'POST', body: JSON.stringify({ date: iso, label: 'Closed Day' }),
      });
    }
    _calData = { ..._calData, schoolDays: data.schoolDays, holidays: data.holidays };
    renderCalendarPanel();
  } catch (e) {
    showToast(e.message, true);
  }
}

function openAddHolidayModal() {
  document.getElementById('cal-holiday-date').value = _calData.startDate || '';
  document.getElementById('cal-holiday-label').value = '';
  document.getElementById('cal-holiday-modal').style.display = 'flex';
}
function closeAddHolidayModal() { document.getElementById('cal-holiday-modal').style.display = 'none'; }

async function saveCustomHoliday() {
  const date = document.getElementById('cal-holiday-date').value;
  const label = document.getElementById('cal-holiday-label').value.trim() || 'Closed Day';
  if (!date) return showToast('Choose a date', true);
  try {
    const data = await apiFetch(`/api/admin/academic-sessions/${_calAcademicId}/holidays`, {
      method: 'POST', body: JSON.stringify({ date, label }),
    });
    _calData = { ..._calData, schoolDays: data.schoolDays, holidays: data.holidays };
    renderCalendarPanel();
    closeAddHolidayModal();
    showToast('Closed day added');
  } catch (e) {
    showToast(e.message, true);
  }
}

// id-in-html → meta key mapping
const SYS_FIELD_MAP = {
  'sys-school-name':   'school_name',
  'sys-motto':         'school_motto',
  'sys-mission':       'school_mission',
  'sys-vision':        'school_vision',
  'sys-values':        'school_values',
  'sys-head-title':    'head_staff_title',
  'sys-student-term':  'student_term',
  'sys-reg-prefix':    'reg_prefix',
  'sys-address':       'school_address',
  'sys-city':          'school_city',
  'sys-country':       'school_country',
  'sys-email':         'school_email',
  'sys-email-alt':     'school_email_alt',
  'sys-phone':         'school_phone',
  'sys-phone-alt':     'school_phone_alt',
  'sys-whatsapp':      'school_whatsapp',
  'sys-wa-btn':        'wa_chat_btn',
  'sys-wa-msg':        'wa_chat_msg',
  'sys-fees-desk':     'fees_desk',
  'sys-admission-desk':'admission_desk',
  'sys-services':      'active_services',
  'sys-ga':            'ga_tag',
  'sys-website':       'website_url',
  'sys-contact-url':   'contact_url',
  'sys-currency':      'currency',
  'sys-timezone':      'timezone',
  'sys-multitz':       'multi_timezone',
  'sys-att-alert':     'att_alert',
  'sys-att-channel':   'att_channel',
  'sys-new-user-email':'new_user_email',
};

async function loadSystemSettings() {
  try {
    const { settings } = await apiFetch('/api/admin/system-settings');
    Object.entries(SYS_FIELD_MAP).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el || settings[key] === undefined || settings[key] === '') return;
      el.value = settings[key];
    });
  } catch (e) {
    showToast('Could not load settings from server', 'error');
  }
}

function sysFilterSettings(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('#tab-systemSettings .sys-section').forEach(sec => {
    const label = (sec.dataset.label || '');
    const text = (label + ' ' + sec.innerText).toLowerCase();
    sec.style.display = !lq || text.includes(lq) ? '' : 'none';
  });
}

async function saveSystemSettings() {
  const body = {};
  Object.entries(SYS_FIELD_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) body[key] = el.value;
  });
  try {
    await apiFetch('/api/admin/system-settings', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    showToast('Settings saved successfully', 'success');
  } catch (e) {
    showToast('Failed to save settings', 'error');
  }
}

// Nigerian school sessions run roughly September-to-July, so the session
// "rolls over" to a new start year from September. Generates a window wide
// enough to always include the current session plus several years ahead,
// recomputed live from today's date so it never needs manual upkeep.
function rollingAcademicSessions() {
  const now = new Date();
  const currentStartYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const sessions = [];
  for (let y = currentStartYear - 3; y <= currentStartYear + 5; y++) sessions.push(`${y}/${y + 1}`);
  return { sessions, currentStartYear };
}

function openCreateSessionModal() {
  const { sessions, currentStartYear } = rollingAcademicSessions();
  const active = _atSessions.find(s => s.isActive);
  const defaultSession = active ? active.sessionLabel : `${currentStartYear}/${currentStartYear + 1}`;
  const sel = document.getElementById('ss-modal-session');
  sel.innerHTML = sessions.map(s => `<option ${s === defaultSession ? 'selected' : ''}>${s}</option>`).join('');
  document.getElementById('ss-modal-term').value = (active && active.termLabel) || 'Term 1';
  document.getElementById('ss-modal').style.display = 'flex';
}

function closeSessionModal() {
  document.getElementById('ss-modal').style.display = 'none';
}

async function createSessionFromModal() {
  const sessionLabel = document.getElementById('ss-modal-session').value;
  const termLabel = document.getElementById('ss-modal-term').value;
  try {
    await apiFetch('/api/admin/academic-sessions/set-current', { method: 'POST', body: JSON.stringify({ sessionLabel, termLabel }) });
    closeSessionModal();
    showToast('Current session and term updated');
    loadAcademicTermsTab();
    loadResultSetup();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function setActiveSession(id) {
  try {
    await apiFetch(`/api/admin/academic-sessions/${id}/activate`, { method: 'PUT' });
    showToast('Active session updated');
    loadAcademicTermsTab();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function deleteAcademicSession(id) {
  if (!confirm('Delete this session? This cannot be undone.')) return;
  try {
    await apiFetch(`/api/admin/academic-sessions/${id}`, { method: 'DELETE' });
    showToast('Session deleted');
    loadAcademicTermsTab();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ls_user_id');
  localStorage.removeItem('ls_user_role');
  window.location.href = 'index.html';
}

/* ── CLASSES & SUBJECTS ── */
state.editingClassCode = null;
state.editingClassArmId = null;
state.editingSubjectId = null;
state.editingClassSubjectId = null;

function switchClassesView(view, trigger) {
  document.querySelectorAll('#tab-classes .academics-subtab').forEach(btn => {
    const active = btn === trigger;
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--blue,#2563eb)' : 'var(--text-2)';
    btn.style.borderBottomColor = active ? 'var(--blue,#2563eb)' : 'transparent';
  });
  document.getElementById('classes-view-classes').style.display = view === 'classes' ? '' : 'none';
  document.getElementById('classes-view-categories').style.display = view === 'categories' ? '' : 'none';
  if (view === 'categories') renderClassCategoriesTable();
}

function switchSubjectsView(view, trigger) {
  document.querySelectorAll('#tab-subjects .academics-subtab').forEach(btn => {
    const active = btn === trigger;
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--blue,#2563eb)' : 'var(--text-2)';
    btn.style.borderBottomColor = active ? 'var(--blue,#2563eb)' : 'transparent';
  });
  ['classSubjects', 'subjectTeachers', 'subjectBank', 'subjectTypes'].forEach(name => {
    const el = document.getElementById(`subjects-view-${name}`);
    if (el) el.style.display = name === view ? '' : 'none';
  });
  if (view === 'subjectTeachers') renderSubjectTeachersTable();
  if (view === 'subjectBank') renderSubjectBankTable();
  if (view === 'subjectTypes') renderSubjectTypesTable();
  if (view === 'classSubjects') renderClassSubjectsTable();
}

function populateClassArmFilterOptions(selectId, classCode, includeAll = true) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const previous = select.value;
  const arms = (state.setup.classArms || []).filter(arm => !classCode || arm.classCode === classCode);
  select.innerHTML = (includeAll ? '<option value="">All</option>' : '<option value="">All Arms</option>') +
    arms.map(arm => `<option value="${arm.id}">${escapeHtml(arm.name)}</option>`).join('');
  if (previous && arms.some(arm => String(arm.id) === previous)) select.value = previous;
}

function populateClasses() {
  if (!state.setup) return;
  const classes = state.setup.classes || [];
  const categories = state.setup.classCategories || [];

  const categoryFilter = document.getElementById('class-category-filter');
  if (categoryFilter) {
    const previous = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All Class Categories</option>' +
      categories.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if (categories.includes(previous)) categoryFilter.value = previous;
  }

  const classFormCategory = document.getElementById('class-form-category');
  if (classFormCategory) {
    classFormCategory.innerHTML = '<option value="">Select Category</option>' +
      categories.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  }

  const armClassFilter = document.getElementById('class-arm-class-filter');
  if (armClassFilter) {
    const previous = armClassFilter.value;
    armClassFilter.innerHTML = '<option value="">All Classes</option>' +
      classes.map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
    if (classes.some(cls => cls.code === previous)) armClassFilter.value = previous;
  }

  const armFormClass = document.getElementById('class-arm-form-class');
  if (armFormClass) {
    armFormClass.innerHTML = '<option value="">Select Class</option>' +
      classes.map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
  }

  const armFormTeacher = document.getElementById('class-arm-form-teacher');
  if (armFormTeacher) {
    armFormTeacher.innerHTML = '<option value="">No form teacher</option>' +
      (state.setup.teachers || []).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  }

  renderClassesTable();
  renderClassArmsTable();
  renderClassCategoriesTable();
}

function renderClassesTable() {
  const tbody = document.getElementById('classes-tbody');
  if (!tbody) return;
  const categoryFilter = document.getElementById('class-category-filter')?.value || '';
  const search = (document.getElementById('class-search')?.value || '').toLowerCase();
  const showArchived = document.getElementById('class-show-archived')?.checked;
  const rows = (state.setup.classes || []).filter(cls => {
    if (!showArchived && cls.archived) return false;
    if (categoryFilter && cls.category !== categoryFilter) return false;
    if (search && !`${cls.label} ${cls.code}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No classes found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((cls, i) => `
    <tr style="${cls.archived ? 'opacity:.6;' : ''}">
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(cls.label)}</strong>${cls.category ? `<div style="font-size:10px;color:var(--text-3);">(${escapeHtml(cls.category)})</div>` : ''}${cls.archived ? '<span style="margin-left:6px;background:var(--black-3);color:var(--text-2);border-radius:10px;padding:1px 8px;font-size:10px;font-weight:700;">Archived</span>' : ''}</td>
      <td>${cls.studentCount || 0}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="editClass('${escapeHtml(cls.code)}')">Edit</button>
        <button class="ann-del" style="margin-left:6px;" onclick="archiveClass('${escapeHtml(cls.code)}', ${cls.archived ? 'true' : 'false'})">${cls.archived ? 'Unarchive' : 'Archive'}</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="deleteClass('${escapeHtml(cls.code)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function renderClassArmsTable() {
  const tbody = document.getElementById('class-arms-tbody');
  if (!tbody) return;
  const classFilter = document.getElementById('class-arm-class-filter')?.value || '';
  const search = (document.getElementById('class-arm-search')?.value || '').toLowerCase();
  const rows = (state.setup.classArms || []).filter(arm => {
    if (classFilter && arm.classCode !== classFilter) return false;
    if (search && !`${arm.classLabel} ${arm.name} ${arm.formTeacherName || ''}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No class arms found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((arm, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(arm.classLabel)}</td>
      <td>${escapeHtml(arm.name)}</td>
      <td>${arm.formTeacherName ? escapeHtml(arm.formTeacherName) : '-'}</td>
      <td>${arm.studentCount || 0}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="editClassArm(${arm.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="deleteClassArm(${arm.id})">Delete</button>
      </td>
    </tr>`).join('');
}

function renderClassCategoriesTable() {
  const tbody = document.getElementById('class-categories-tbody');
  if (!tbody) return;
  const categories = state.setup.classCategories || [];
  const classes = state.setup.classes || [];
  if (!categories.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No class categories yet.</td></tr>';
    return;
  }
  tbody.innerHTML = categories.map((name, i) => {
    const count = classes.filter(cls => cls.category === name).length;
    return `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(name)}</td>
      <td>${count}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="deleteClassCategory('${escapeHtml(name)}')">Delete</button></td>
    </tr>`;
  }).join('');
}

function openClassModal() {
  state.editingClassCode = null;
  document.getElementById('class-modal-title').textContent = 'Add Class';
  document.getElementById('class-form-code').value = '';
  document.getElementById('class-form-code').disabled = false;
  document.getElementById('class-form-label').value = '';
  document.getElementById('class-form-category').value = '';
  document.getElementById('class-modal').style.display = 'flex';
}

function editClass(code) {
  const cls = (state.setup.classes || []).find(item => item.code === code);
  if (!cls) return showToast('Class not found');
  state.editingClassCode = cls.code;
  document.getElementById('class-modal-title').textContent = `Edit Class - ${cls.label}`;
  document.getElementById('class-form-code').value = cls.code;
  document.getElementById('class-form-code').disabled = true;
  document.getElementById('class-form-label').value = cls.label || '';
  document.getElementById('class-form-category').value = cls.category || '';
  document.getElementById('class-modal').style.display = 'flex';
}

function closeClassModal() {
  document.getElementById('class-modal').style.display = 'none';
}

async function saveClass() {
  const payload = {
    code: document.getElementById('class-form-code').value,
    label: document.getElementById('class-form-label').value,
    category: document.getElementById('class-form-category').value,
  };
  if (!payload.code || !payload.label) return showToast('Class code and label are required');
  try {
    const url = state.editingClassCode
      ? `/api/admin/classes/${encodeURIComponent(state.editingClassCode)}`
      : '/api/admin/classes';
    const data = await apiFetch(url, { method: state.editingClassCode ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.setup = data.setup;
    populateClasses();
    populateAdminControls();
    closeClassModal();
    showToast(`Class ${state.editingClassCode ? 'updated' : 'added'}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteClass(code) {
  const cls = (state.setup.classes || []).find(item => item.code === code);
  if (!cls) return;
  if (!confirm(`Delete class "${cls.label}"? This cannot be undone.`)) return;
  try {
    const data = await apiFetch(`/api/admin/classes/${encodeURIComponent(code)}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateClasses();
    populateAdminControls();
    showToast('Class deleted');
  } catch (err) {
    showToast(err.message);
  }
}

async function archiveClass(code, currentlyArchived) {
  const cls = (state.setup.classes || []).find(item => item.code === code);
  if (!cls) return;
  const verb = currentlyArchived ? 'unarchive' : 'archive';
  const warning = currentlyArchived
    ? `Unarchive "${cls.label}"? It will reappear in class pickers for new enrollment, promotion, and scheduling.`
    : `Archive "${cls.label}"? It will be hidden from pickers used for new enrollment, promotion, and scheduling, but existing students, results, and records linked to it stay fully intact and visible everywhere else.`;
  if (!confirm(warning)) return;
  try {
    const data = await apiFetch(`/api/admin/classes/${encodeURIComponent(code)}/archive`, { method: 'PUT' });
    state.setup = data.setup;
    renderClassesTable();
    populateAdminControls();
    showToast(`Class ${verb}d`);
  } catch (err) {
    showToast(err.message);
  }
}

function openClassArmModal() {
  state.editingClassArmId = null;
  document.getElementById('class-arm-modal-title').textContent = 'Add Class Arm';
  document.getElementById('class-arm-form-class').value = '';
  document.getElementById('class-arm-form-name').value = '';
  document.getElementById('class-arm-form-teacher').value = '';
  document.getElementById('class-arm-modal').style.display = 'flex';
}

function editClassArm(id) {
  const arm = (state.setup.classArms || []).find(item => item.id === id);
  if (!arm) return showToast('Class arm not found');
  state.editingClassArmId = arm.id;
  document.getElementById('class-arm-modal-title').textContent = `Edit Class Arm - ${arm.name}`;
  document.getElementById('class-arm-form-class').value = arm.classCode;
  document.getElementById('class-arm-form-name').value = arm.name || '';
  document.getElementById('class-arm-form-teacher').value = arm.formTeacherId || '';
  document.getElementById('class-arm-modal').style.display = 'flex';
}

function closeClassArmModal() {
  document.getElementById('class-arm-modal').style.display = 'none';
}

async function saveClassArm() {
  const payload = {
    classCode: document.getElementById('class-arm-form-class').value,
    name: document.getElementById('class-arm-form-name').value,
    formTeacherId: document.getElementById('class-arm-form-teacher').value,
  };
  if (!payload.classCode || !payload.name) return showToast('Class and arm name are required');
  try {
    const url = state.editingClassArmId ? `/api/admin/class-arms/${state.editingClassArmId}` : '/api/admin/class-arms';
    const data = await apiFetch(url, { method: state.editingClassArmId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.setup = data.setup;
    populateClasses();
    closeClassArmModal();
    showToast(`Class arm ${state.editingClassArmId ? 'updated' : 'added'}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteClassArm(id) {
  if (!confirm('Delete this class arm?')) return;
  try {
    const data = await apiFetch(`/api/admin/class-arms/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateClasses();
    showToast('Class arm deleted');
  } catch (err) {
    showToast(err.message);
  }
}

async function saveClassCategory() {
  const input = document.getElementById('new-class-category-name');
  const name = input.value.trim();
  if (!name) return showToast('Enter a category name');
  try {
    const data = await apiFetch('/api/admin/class-categories', { method: 'POST', body: JSON.stringify({ name }) });
    state.setup = data.setup;
    input.value = '';
    populateClasses();
    showToast('Class category added');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteClassCategory(name) {
  if (!confirm(`Delete category "${name}"?`)) return;
  try {
    const data = await apiFetch(`/api/admin/class-categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateClasses();
    showToast('Class category deleted');
  } catch (err) {
    showToast(err.message);
  }
}

/* ── SUBJECTS ── */

function populateSubjects() {
  if (!state.setup) return;
  const classes = state.setup.classes || [];
  const subjects = state.setup.subjects || [];
  const subjectTypes = state.setup.subjectTypes || [];
  const teachers = state.setup.teachers || [];

  const csFilterClass = document.getElementById('cs-filter-class');
  if (csFilterClass) {
    const previous = csFilterClass.value;
    csFilterClass.innerHTML = '<option value="">Select Class</option>' +
      classes.map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
    if (classes.some(cls => cls.code === previous)) csFilterClass.value = previous;
    populateClassArmFilterOptions('cs-filter-arm', csFilterClass.value);
  }

  const csmSubject = document.getElementById('csm-subject');
  if (csmSubject) {
    csmSubject.innerHTML = '<option value="">Select Subject</option>' +
      subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  }
  const csmClass = document.getElementById('csm-class');
  if (csmClass) {
    csmClass.innerHTML = '<option value="">Select Class</option>' +
      classes.map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
  }
  const csmTeacher = document.getElementById('csm-teacher-in-charge');
  if (csmTeacher) {
    csmTeacher.innerHTML = '<option value="">No teacher assigned</option>' +
      teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  }
  const csmAssisting = document.getElementById('csm-assisting-teachers');
  if (csmAssisting) {
    csmAssisting.innerHTML = teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  }

  const subjectFormType = document.getElementById('subject-form-type');
  if (subjectFormType) {
    subjectFormType.innerHTML = '<option value="">Select Type</option>' +
      subjectTypes.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  }

  renderClassSubjectsTable();
  renderSubjectTeachersTable();
  renderSubjectBankTable();
  renderSubjectTypesTable();
}

function renderClassSubjectsTable() {
  const tbody = document.getElementById('class-subjects-tbody');
  if (!tbody) return;
  const classFilter = document.getElementById('cs-filter-class')?.value || '';
  const armFilter = document.getElementById('cs-filter-arm')?.value || '';
  const termFilter = document.getElementById('cs-filter-term')?.value || '';
  const search = (document.getElementById('cs-search')?.value || '').toLowerCase();
  const rows = (state.setup.classSubjects || []).filter(row => {
    if (classFilter && row.classCode !== classFilter) return false;
    if (armFilter && String(row.classArmId || '') !== armFilter) return false;
    if (termFilter && row.term !== termFilter) return false;
    if (search && !`${row.subjectName} ${row.subjectCode || ''} ${row.classLabel}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:18px;color:var(--text-3);">No class subjects found. Select a class and click "Add Subject" to assign one.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(row.subjectName)}</strong></td>
      <td>${escapeHtml(row.subjectCode || '-')}</td>
      <td>${escapeHtml(row.classLabel)}</td>
      <td>${row.classArmName ? escapeHtml(row.classArmName) : 'All'}</td>
      <td>${escapeHtml(row.term || '-')}</td>
      <td>${row.passMark ?? '-'} / ${row.fullMark ?? '-'}</td>
      <td>${escapeHtml(row.attributes || '-')}</td>
      <td>${row.teacherInChargeName ? escapeHtml(row.teacherInChargeName) : '-'}</td>
      <td>${row.assistingTeacherNames ? escapeHtml(row.assistingTeacherNames) : '-'}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="editClassSubject(${row.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="deleteClassSubject(${row.id})">Delete</button>
      </td>
    </tr>`).join('');
}

function renderSubjectTeachersTable() {
  const tbody = document.getElementById('subject-teachers-tbody');
  if (!tbody) return;
  const search = (document.getElementById('st-search')?.value || '').toLowerCase();
  const rows = [];
  (state.setup.classSubjects || []).forEach(row => {
    if (row.teacherInChargeId) {
      rows.push({ teacherName: row.teacherInChargeName, role: 'Teacher in Charge', subjectName: row.subjectName, classLabel: row.classLabel, classArmName: row.classArmName });
    }
    (row.assistingTeacherNames || '').split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
      rows.push({ teacherName: name, role: 'Assisting Teacher', subjectName: row.subjectName, classLabel: row.classLabel, classArmName: row.classArmName });
    });
  });
  const filtered = rows.filter(row => !search || `${row.teacherName} ${row.subjectName} ${row.classLabel}`.toLowerCase().includes(search));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No subject teachers assigned yet. Use "Add Subject" under Class Subjects to assign one.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((row, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(row.teacherName)}</strong></td>
      <td>${escapeHtml(row.role)}</td>
      <td>${escapeHtml(row.subjectName)}</td>
      <td>${escapeHtml(row.classLabel)}</td>
      <td>${row.classArmName ? escapeHtml(row.classArmName) : 'All'}</td>
    </tr>`).join('');
}

function renderSubjectBankTable() {
  const tbody = document.getElementById('subject-bank-tbody');
  if (!tbody) return;
  const search = (document.getElementById('sb-search')?.value || '').toLowerCase();
  const rows = (state.setup.subjects || []).filter(s => !search || `${s.name} ${s.code || ''}`.toLowerCase().includes(search));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:18px;color:var(--text-3);">No subjects in the bank yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.code || '-')}</td>
      <td>${escapeHtml(s.type || '-')}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="editSubject(${s.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="deleteSubject(${s.id})">Delete</button>
      </td>
    </tr>`).join('');
}

function renderSubjectTypesTable() {
  const tbody = document.getElementById('subject-types-tbody');
  if (!tbody) return;
  const types = state.setup.subjectTypes || [];
  const subjects = state.setup.subjects || [];
  if (!types.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No subject types yet.</td></tr>';
    return;
  }
  tbody.innerHTML = types.map((name, i) => {
    const count = subjects.filter(s => s.type === name).length;
    return `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(name)}</td>
      <td>${count}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="deleteSubjectType('${escapeHtml(name)}')">Delete</button></td>
    </tr>`;
  }).join('');
}

function openSubjectModal() {
  state.editingSubjectId = null;
  document.getElementById('subject-modal-title').textContent = 'Add Subject';
  document.getElementById('subject-form-name').value = '';
  document.getElementById('subject-form-code').value = '';
  document.getElementById('subject-form-type').value = '';
  document.getElementById('subject-modal').style.display = 'flex';
}

function editSubject(id) {
  const subject = (state.setup.subjects || []).find(item => item.id === id);
  if (!subject) return showToast('Subject not found');
  state.editingSubjectId = subject.id;
  document.getElementById('subject-modal-title').textContent = `Edit Subject - ${subject.name}`;
  document.getElementById('subject-form-name').value = subject.name || '';
  document.getElementById('subject-form-code').value = subject.code || '';
  document.getElementById('subject-form-type').value = subject.type || '';
  document.getElementById('subject-modal').style.display = 'flex';
}

function closeSubjectModal() {
  document.getElementById('subject-modal').style.display = 'none';
}

async function saveSubject() {
  const payload = {
    name: document.getElementById('subject-form-name').value,
    code: document.getElementById('subject-form-code').value,
    type: document.getElementById('subject-form-type').value,
  };
  if (!payload.name) return showToast('Subject name is required');
  try {
    const url = state.editingSubjectId ? `/api/admin/subjects/${state.editingSubjectId}` : '/api/admin/subjects';
    const data = await apiFetch(url, { method: state.editingSubjectId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.setup = data.setup;
    populateSubjects();
    closeSubjectModal();
    showToast(`Subject ${state.editingSubjectId ? 'updated' : 'added'}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteSubject(id) {
  if (!confirm('Delete this subject from the subject bank?')) return;
  try {
    const data = await apiFetch(`/api/admin/subjects/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateSubjects();
    showToast('Subject deleted');
  } catch (err) {
    showToast(err.message);
  }
}

async function saveSubjectType() {
  const input = document.getElementById('new-subject-type-name');
  const name = input.value.trim();
  if (!name) return showToast('Enter a subject type name');
  try {
    const data = await apiFetch('/api/admin/subject-types', { method: 'POST', body: JSON.stringify({ name }) });
    state.setup = data.setup;
    input.value = '';
    populateSubjects();
    showToast('Subject type added');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteSubjectType(name) {
  if (!confirm(`Delete subject type "${name}"?`)) return;
  try {
    const data = await apiFetch(`/api/admin/subject-types/${encodeURIComponent(name)}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateSubjects();
    showToast('Subject type deleted');
  } catch (err) {
    showToast(err.message);
  }
}

function openClassSubjectModal() {
  state.editingClassSubjectId = null;
  document.getElementById('class-subject-modal-title').textContent = 'Add Class Subject';
  document.getElementById('csm-subject').value = '';
  const presetClass = document.getElementById('cs-filter-class')?.value || '';
  document.getElementById('csm-class').value = presetClass;
  populateClassArmFilterOptions('csm-arm', presetClass);
  document.getElementById('csm-arm').value = document.getElementById('cs-filter-arm')?.value || '';
  document.getElementById('csm-term').value = document.getElementById('cs-filter-term')?.value || '';
  document.getElementById('csm-pass-mark').value = '';
  document.getElementById('csm-full-mark').value = '';
  document.getElementById('csm-attributes').value = '';
  document.getElementById('csm-teacher-in-charge').value = '';
  Array.from(document.getElementById('csm-assisting-teachers').options).forEach(opt => { opt.selected = false; });
  document.getElementById('class-subject-modal').style.display = 'flex';
}

function editClassSubject(id) {
  const row = (state.setup.classSubjects || []).find(item => item.id === id);
  if (!row) return showToast('Class subject not found');
  state.editingClassSubjectId = row.id;
  document.getElementById('class-subject-modal-title').textContent = `Edit Class Subject - ${row.subjectName}`;
  document.getElementById('csm-subject').value = row.subjectId;
  document.getElementById('csm-class').value = row.classCode;
  populateClassArmFilterOptions('csm-arm', row.classCode);
  document.getElementById('csm-arm').value = row.classArmId || '';
  document.getElementById('csm-term').value = row.term || '';
  document.getElementById('csm-pass-mark').value = row.passMark ?? '';
  document.getElementById('csm-full-mark').value = row.fullMark ?? '';
  document.getElementById('csm-attributes').value = row.attributes || '';
  document.getElementById('csm-teacher-in-charge').value = row.teacherInChargeId || '';
  const assistingIds = (row.assistingTeacherIds || '').split(',').filter(Boolean);
  Array.from(document.getElementById('csm-assisting-teachers').options).forEach(opt => {
    opt.selected = assistingIds.includes(opt.value);
  });
  document.getElementById('class-subject-modal').style.display = 'flex';
}

function closeClassSubjectModal() {
  document.getElementById('class-subject-modal').style.display = 'none';
}

async function saveClassSubject() {
  const subjectId = Number(document.getElementById('csm-subject').value);
  const classCode = document.getElementById('csm-class').value;
  if (!subjectId || !classCode) return showToast('Subject and class are required');
  const payload = {
    subjectId,
    classCode,
    classArmId: document.getElementById('csm-arm').value || null,
    term: document.getElementById('csm-term').value,
    passMark: document.getElementById('csm-pass-mark').value,
    fullMark: document.getElementById('csm-full-mark').value,
    attributes: document.getElementById('csm-attributes').value,
    teacherInChargeId: document.getElementById('csm-teacher-in-charge').value,
    assistingTeacherIds: Array.from(document.getElementById('csm-assisting-teachers').selectedOptions).map(opt => opt.value),
  };
  try {
    const url = state.editingClassSubjectId ? `/api/admin/class-subjects/${state.editingClassSubjectId}` : '/api/admin/class-subjects';
    const data = await apiFetch(url, { method: state.editingClassSubjectId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.setup = data.setup;
    populateSubjects();
    closeClassSubjectModal();
    showToast(`Class subject ${state.editingClassSubjectId ? 'updated' : 'added'}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteClassSubject(id) {
  if (!confirm('Remove this subject from the class?')) return;
  try {
    const data = await apiFetch(`/api/admin/class-subjects/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    populateSubjects();
    showToast('Class subject removed');
  } catch (err) {
    showToast(err.message);
  }
}

init();

// ── RESULT SHEET PREFERENCES ──

function switchRspTab(tab) {
  ['sheet','comments','promo'].forEach(t => {
    document.getElementById('rsp-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('rsp-btn-'+t).classList.toggle('active', t===tab);
  });
  if (tab === 'promo') loadPromotionCriteria();
}

let _promoImageData = { yes: null, no: null };

async function loadPromotionCriteria() {
  try {
    const { settings } = await apiFetch('/api/admin/system-settings');
    document.getElementById('promo-threshold').value = settings.promo_threshold || 50;
    const toggle = document.getElementById('promo-auto-toggle');
    const isOn = settings.promo_auto !== 'off';
    toggle.classList.toggle('on', isOn);
    toggle.classList.toggle('off', !isOn);
    toggle.querySelector('span').textContent = isOn ? 'ON' : 'OFF';
    if (settings.promo_image_promoted) {
      document.getElementById('promo-img-yes-wrap').innerHTML = `<img src="/${settings.promo_image_promoted}" style="width:100%;height:100%;object-fit:cover;">`;
    }
    if (settings.promo_image_not_promoted) {
      document.getElementById('promo-img-no-wrap').innerHTML = `<img src="/${settings.promo_image_not_promoted}" style="width:100%;height:100%;object-fit:cover;">`;
    }
  } catch (err) {
    showToast(err.message);
  }
}

function promoToggleAuto(btn) {
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  btn.classList.toggle('off', isOn);
  btn.querySelector('span').textContent = isOn ? 'OFF' : 'ON';
}

function promoPreviewImage(input, wrapId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    if (wrapId === 'promo-img-yes-wrap') _promoImageData.yes = dataUrl;
    else _promoImageData.no = dataUrl;
    document.getElementById(wrapId).innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

async function savePromotionCriteria() {
  const body = {
    promo_auto: document.getElementById('promo-auto-toggle').classList.contains('on') ? 'on' : 'off',
    promo_threshold: document.getElementById('promo-threshold').value,
  };
  if (_promoImageData.yes) body.promoImagePromotedData = _promoImageData.yes;
  if (_promoImageData.no) body.promoImageNotPromotedData = _promoImageData.no;
  try {
    await apiFetch('/api/admin/system-settings', { method: 'POST', body: JSON.stringify(body) });
    showToast('Promotion criteria saved');
    _promoImageData = { yes: null, no: null };
  } catch (err) {
    showToast(err.message);
  }
}

const _rspPrefs = JSON.parse(localStorage.getItem('rspPrefs')||'{}');

function rspToggle(btn, key) {
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  btn.classList.toggle('off', isOn);
  btn.querySelector('span').textContent = isOn ? 'OFF' : 'ON';
  _rspPrefs[key] = !isOn;
  localStorage.setItem('rspPrefs', JSON.stringify(_rspPrefs));
}

function rspFilter(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('#rsp-prefs-list .rsp-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
  document.querySelectorAll('#rsp-prefs-list .rsp-section-head').forEach(h => {
    h.style.display = '';
  });
}

// ── SCORE DIVISIONS ──

function sdInit() {
  if (!state.setup) return;
  const classSel = document.getElementById('sd-class');
  const examSel  = document.getElementById('sd-exam');
  const sessSel  = document.getElementById('sd-session');
  if (!classSel) return;
  classSel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes||[]).map(c=>`<option value="${c.code}">${c.label}</option>`).join('');
  const academic = state.setup.academic;
  sessSel.innerHTML = academic
    ? `<option value="${academic.session_label||'2025-2026'}">${academic.session_label||'2025-2026'}</option>`
    : '<option value="">No active session</option>';
  const exams = [...new Set((state.setup.resultBatches||[]).map(b=>b.examType))].filter(Boolean);
  examSel.innerHTML = '<option value="">— Select Exam —</option>' +
    exams.map(e=>`<option value="${e}">${e}</option>`).join('');
  document.getElementById('sd-format-card').style.display = 'none';
  document.getElementById('sd-divisions-card').style.display = 'none';
}

let _sdDivisions = [];
let _sdEditing = false;

async function sdViewDivisions() {
  const classCode = document.getElementById('sd-class').value;
  const examType  = document.getElementById('sd-exam').value;
  if (!classCode || !examType) { showToast('Select a class and exam first','warn'); return; }
  const classLabel = (state.setup.classes||[]).find(c=>c.code===classCode)?.label || classCode;
  document.getElementById('sd-format-label').textContent = `${classLabel} | ${examType} Result`;
  document.getElementById('sd-format-card').style.display = '';
  document.getElementById('sd-divisions-card').style.display = '';
  document.getElementById('sd-divisions-title').textContent = `Assessments / Score Divisions For: ${classLabel} | ${examType} Result`;
  _sdEditing = false;
  try {
    const data = await apiFetch(`/api/admin/score-divisions?classCode=${classCode}&examType=${encodeURIComponent(examType)}`);
    _sdDivisions = data.divisions;
    sdRenderTable();
  } catch (err) {
    showToast(err.message);
  }
}

function sdRenderTable() {
  const editBtn = document.getElementById('sd-edit-btn');
  if (editBtn) editBtn.textContent = _sdEditing ? '✓ Save Divisions' : '✎ Edit Score Divisions';
  document.getElementById('sd-tbody').innerHTML = _sdDivisions.map((d,i)=> _sdEditing ? `
    <tr>
      <td>${i+1}</td>
      <td><input class="field-input sd-name" value="${escapeHtml(d.name)}"></td>
      <td><input class="field-input sd-max" type="number" min="0" value="${d.maxMark}" style="width:80px"></td>
      <td><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="sd-enabled" ${d.enabled ? 'checked' : ''}> Enabled</label></td>
    </tr>` : `
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(d.name)}</td>
      <td>${d.maxMark}</td>
      <td><span class="${d.enabled?'sd-enabled':'sd-disabled'}">${d.enabled?'Enabled':'Disabled'}</span></td>
    </tr>`).join('');
}

async function sdToggleEdit() {
  if (!_sdEditing) {
    _sdEditing = true;
    sdRenderTable();
    return;
  }
  const rows = Array.from(document.querySelectorAll('#sd-tbody tr')).map(tr => ({
    name: tr.querySelector('.sd-name').value.trim(),
    maxMark: Number(tr.querySelector('.sd-max').value),
    enabled: tr.querySelector('.sd-enabled').checked,
  })).filter(r => r.name);
  const classCode = document.getElementById('sd-class').value;
  const examType  = document.getElementById('sd-exam').value;
  try {
    await apiFetch('/api/admin/score-divisions', {
      method: 'POST',
      body: JSON.stringify({ classCode, examType, divisions: rows }),
    });
    _sdDivisions = rows.map((r, i) => ({ ...r, id: i }));
    _sdEditing = false;
    sdRenderTable();
    showToast('Score divisions saved');
  } catch (err) {
    showToast(err.message);
  }
}

// ── SKILLS SET CONFIG (Affective / Psychomotor) ──
let _skillsData = { affective: [], psychomotor: [] };
let _skillsEditing = { affective: false, psychomotor: false };

async function initSkillsConfigTab() {
  try {
    const data = await apiFetch('/api/admin/skill-labels');
    _skillsData = data;
    skillsRenderSection('affective');
    skillsRenderSection('psychomotor');
  } catch (err) {
    showToast(err.message);
  }
}

function skillsRenderSection(section) {
  const editing = _skillsEditing[section];
  const btn = document.getElementById(`skills-${section}-edit-btn`);
  if (btn) btn.innerHTML = editing ? '&#x2713; Save Skills Set' : '&#x270E; Edit Skills Set';
  const offset = section === 'psychomotor' ? _skillsData.affective.length : 0;
  document.getElementById(`skills-${section}-tbody`).innerHTML = _skillsData[section].map((s, i) => editing ? `
    <tr>
      <td>${offset + i + 1}</td>
      <td><input class="field-input skills-${section}-label" data-key="${escapeHtml(s.key)}" value="${escapeHtml(s.label)}"></td>
      <td><input class="field-input skills-${section}-desc" value="${escapeHtml(s.description || '')}" placeholder="Optional description"></td>
    </tr>` : `
    <tr>
      <td>${offset + i + 1}</td>
      <td>${escapeHtml(s.label)}</td>
      <td style="color:var(--text-3);">${escapeHtml(s.description || '')}</td>
    </tr>`).join('');
}

async function skillsToggleEdit(section) {
  if (!_skillsEditing[section]) {
    _skillsEditing[section] = true;
    skillsRenderSection(section);
    return;
  }
  const rows = Array.from(document.querySelectorAll(`#skills-${section}-tbody tr`)).map(tr => ({
    key: tr.querySelector(`.skills-${section}-label`).dataset.key,
    label: tr.querySelector(`.skills-${section}-label`).value.trim(),
    description: tr.querySelector(`.skills-${section}-desc`).value.trim(),
  }));
  try {
    await apiFetch('/api/admin/skill-labels', { method: 'POST', body: JSON.stringify({ skills: rows }) });
    _skillsData[section] = rows;
    _skillsEditing[section] = false;
    skillsRenderSection(section);
    showToast('Skills set saved');
  } catch (err) {
    showToast(err.message);
  }
}

// ── COMMENTS BANK ──
// Grade-range fallback comments, used to auto-fill a student's report when
// neither the class teacher nor the head of school has typed one in for
// that student. Persisted server-side (server.js /api/admin/comment-bank)
// so it actually feeds report generation, not just its own management page.

let _cbComments = [];
let _cbEditIdx = null;

async function cbLoadComments() {
  const tbody = document.getElementById('cb-tbody');
  try {
    const data = await apiFetch('/api/admin/comment-bank');
    _cbComments = data.comments || [];
  } catch (err) {
    showToast(err.message);
    return;
  }
  if (!tbody) return;
  if (!_cbComments.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No comments yet. Click Add Comment to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = _cbComments.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td style="max-width:480px;word-break:break-word">${escapeHtml(c.text)}</td>
      <td class="cb-score-range">${c.min} -to- ${c.max}</td>
      <td style="white-space:nowrap;"><button class="bs-preview-btn" onclick="cbEditComment(${i})">&#x270E; Edit</button> <button class="bs-preview-btn" onclick="cbDeleteComment(${i})">&#x1F5D1; Delete</button></td>
    </tr>`).join('');
}

async function cbDeleteComment(i) {
  const c = _cbComments[i];
  if (!c || !confirm('Delete this comment?')) return;
  try {
    await apiFetch(`/api/admin/comment-bank/${c.id}`, { method: 'DELETE' });
    await cbLoadComments();
    showToast('Comment deleted');
  } catch (err) {
    showToast(err.message);
  }
}

function cbFilterComments(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('#cb-table tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

function openAddCommentModal() {
  _cbEditIdx = null;
  document.getElementById('cb-modal-title').textContent = 'Add Comment';
  document.getElementById('cb-text').value = '';
  document.getElementById('cb-min').value = '80';
  document.getElementById('cb-max').value = '100';
  document.getElementById('cb-modal').style.display = 'flex';
}

function cbEditComment(i) {
  _cbEditIdx = i;
  const c = _cbComments[i];
  document.getElementById('cb-modal-title').textContent = 'Edit Comment';
  document.getElementById('cb-text').value = c.text;
  document.getElementById('cb-min').value = c.min;
  document.getElementById('cb-max').value = c.max;
  document.getElementById('cb-modal').style.display = 'flex';
}

function closeCbModal() { document.getElementById('cb-modal').style.display = 'none'; }

async function saveCbComment() {
  const text = document.getElementById('cb-text').value.trim();
  const min  = parseInt(document.getElementById('cb-min').value);
  const max  = parseInt(document.getElementById('cb-max').value);
  if (!text) { showToast('Comment text is required','warn'); return; }
  if (isNaN(min)||isNaN(max)||min>max) { showToast('Invalid score range','warn'); return; }
  try {
    if (_cbEditIdx !== null) {
      const id = _cbComments[_cbEditIdx].id;
      await apiFetch(`/api/admin/comment-bank/${id}`, { method: 'PUT', body: JSON.stringify({ text, min, max }) });
    } else {
      await apiFetch('/api/admin/comment-bank', { method: 'POST', body: JSON.stringify({ text, min, max }) });
    }
    closeCbModal();
    await cbLoadComments();
    showToast('Comment saved','success');
  } catch (err) {
    showToast(err.message);
  }
}

// ── FEES / BURSARY (Finance MVP) ─────────────────────────────────────────────
// Backs Invoice List, Class Invoice History, Family Fees History, Review
// Payment Proofs, Verify Payment Status, Successful Payments, All Payment
// Attempts, and Fees Debtors. All of it talks to the /api/admin/fees/* routes
// added in server.js. Kept as one self-contained section (own state, own
// helpers) so it doesn't need to touch any of the result/academics code above.

let _feesTermsCache = null;
async function feesTermsList() {
  if (_feesTermsCache) return _feesTermsCache;
  try {
    const data = await apiFetch('/api/admin/academic-sessions');
    _feesTermsCache = data.sessions || [];
  } catch (e) {
    _feesTermsCache = [];
  }
  return _feesTermsCache;
}

async function populateFeeTermSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const previous = select.value;
  const placeholder = select.querySelector('option[value=""]')?.outerHTML || '<option value="">All Terms</option>';
  const terms = await feesTermsList();
  select.innerHTML = placeholder + terms.map(t =>
    `<option value="${t.id}">${escapeHtml(t.sessionLabel)} - ${escapeHtml(t.termLabel)}${t.isActive ? ' (Active)' : ''}</option>`
  ).join('');
  if (terms.some(t => String(t.id) === previous)) select.value = previous;
}

function populateFeeClassSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const previous = select.value;
  const placeholder = select.querySelector('option[value=""]')?.outerHTML || '<option value="">All Classes</option>';
  const classes = state.setup.classes || [];
  select.innerHTML = placeholder + classes.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
  if (classes.some(c => c.code === previous)) select.value = previous;
}

function populateFeeStudentSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const students = [...(state.setup.students || [])].sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = '<option value="">Select Student</option>' +
    students.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)}) - ${escapeHtml(s.classCode)}</option>`).join('');
}

function exportTableToCsv(tableSelector, filename) {
  const table = typeof tableSelector === 'string' ? document.querySelector(tableSelector) : tableSelector;
  if (!table) { showToast('Nothing to export'); return; }
  const rows = Array.from(table.querySelectorAll('tr')).filter(tr => tr.querySelectorAll('th,td').length);
  if (!rows.length) { showToast('Nothing to export'); return; }
  const csv = rows.map(tr =>
    Array.from(tr.querySelectorAll('th,td')).map(cell => {
      const text = cell.textContent.replace(/\s+/g, ' ').trim();
      return `"${text.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export downloaded');
}

function fmtNaira(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function feeFmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function invoiceStatusBadge(inv) {
  const map = {
    paid:    ['var(--green-bg)', 'var(--green)', 'Paid'],
    partial: ['var(--amber-bg)', 'var(--amber)', 'Part Paid'],
    unpaid:  ['var(--red-bg)', 'var(--red)', 'Unpaid'],
  };
  const [bg, color, label] = map[inv.status] || map.unpaid;
  const overdueTag = inv.overdue ? ` <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--red-bg);color:var(--red);">Overdue</span>` : '';
  return `<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:${bg};color:${color};white-space:nowrap;">${label}</span>${overdueTag}`;
}

function paymentStatusBadge(status) {
  const map = {
    successful: ['var(--green-bg)', 'var(--green)', 'Successful'],
    pending:    ['var(--amber-bg)', 'var(--amber)', 'Pending'],
    failed:     ['var(--red-bg)', 'var(--red)', 'Failed'],
  };
  const [bg, color, label] = map[status] || map.pending;
  return `<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:${bg};color:${color};white-space:nowrap;">${label}</span>`;
}

// ── New Invoice modal ──
function openNewInvoiceModal() {
  populateFeeStudentSelect('ni-student');
  populateFeeClassSelect('ni-class');
  document.getElementById('ni-mode').value = 'student';
  document.getElementById('ni-description').value = '';
  document.getElementById('ni-amount').value = '';
  document.getElementById('ni-due-date').value = '';
  niToggleMode();
  document.getElementById('new-invoice-modal').style.display = 'flex';
}
function closeNewInvoiceModal() {
  document.getElementById('new-invoice-modal').style.display = 'none';
}
function niToggleMode() {
  const mode = document.getElementById('ni-mode').value;
  document.getElementById('ni-student-wrap').style.display = mode === 'student' ? '' : 'none';
  document.getElementById('ni-class-wrap').style.display = mode === 'class' ? '' : 'none';
}
async function submitNewInvoice() {
  const mode = document.getElementById('ni-mode').value;
  const feeType = document.getElementById('ni-fee-type').value;
  const description = document.getElementById('ni-description').value.trim();
  const amount = document.getElementById('ni-amount').value;
  const dueDate = document.getElementById('ni-due-date').value;
  const body = { feeType, description, amount, dueDate };
  if (mode === 'student') {
    const studentId = document.getElementById('ni-student').value;
    if (!studentId) return showToast('Select a student');
    body.studentId = studentId;
  } else {
    const classCode = document.getElementById('ni-class').value;
    if (!classCode) return showToast('Select a class');
    body.classCode = classCode;
  }
  try {
    const data = await apiFetch('/api/admin/fees/invoices', { method: 'POST', body: JSON.stringify(body) });
    showToast(`Created ${data.count} invoice${data.count === 1 ? '' : 's'}`);
    closeNewInvoiceModal();
    if (document.getElementById('tab-invoiceList')?.classList.contains('active')) ilViewList();
  } catch (e) {
    showToast(e.message);
  }
}

// ── Record Payment modal (opened from any invoice row) ──
let _rpInvoiceId = null;
let _rpOnDone = null;
function openRecordPaymentModal(invoiceId, label, onDone) {
  _rpInvoiceId = invoiceId;
  _rpOnDone = onDone || null;
  document.getElementById('rp-invoice-label').textContent = label || '';
  document.getElementById('rp-amount').value = '';
  document.getElementById('rp-reference').value = '';
  document.getElementById('rp-note').value = '';
  document.getElementById('record-payment-modal').style.display = 'flex';
}
function closeRecordPaymentModal() {
  document.getElementById('record-payment-modal').style.display = 'none';
}
async function submitRecordPayment() {
  const amount = document.getElementById('rp-amount').value;
  const method = document.getElementById('rp-method').value;
  const reference = document.getElementById('rp-reference').value.trim();
  const note = document.getElementById('rp-note').value.trim();
  if (!_rpInvoiceId) return;
  try {
    await apiFetch(`/api/admin/fees/invoices/${_rpInvoiceId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount, method, reference, note, status: 'successful' }),
    });
    showToast('Payment recorded');
    closeRecordPaymentModal();
    if (typeof _rpOnDone === 'function') _rpOnDone();
  } catch (e) {
    showToast(e.message);
  }
}

// ── Fee History modal (a student's, or a whole family's, invoices/payments) ──
async function openFeeHistoryModal(query) {
  const modal = document.getElementById('fee-history-modal');
  const body = document.getElementById('fh-body');
  document.getElementById('fh-title').textContent = 'Fee History';
  body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);">Loading...</div>';
  modal.style.display = 'flex';
  try {
    const qs = query.studentId ? `studentId=${encodeURIComponent(query.studentId)}` : `parentEmail=${encodeURIComponent(query.parentEmail)}`;
    const data = await apiFetch(`/api/admin/fees/history?${qs}`);
    const students = data.students || [];
    document.getElementById('fh-title').textContent = students.length === 1 ? `${students[0].name} - Fee History` : `Family Fee History (${students.length} students)`;
    body.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
        <div style="flex:1;min-width:110px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;"><div style="font-size:15px;font-weight:800;">${fmtNaira(data.totals.invoiced)}</div><div style="font-size:10px;color:var(--text-3);">Invoiced</div></div>
        <div style="flex:1;min-width:110px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;"><div style="font-size:15px;font-weight:800;color:var(--green);">${fmtNaira(data.totals.paid)}</div><div style="font-size:10px;color:var(--text-3);">Paid</div></div>
        <div style="flex:1;min-width:110px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;"><div style="font-size:15px;font-weight:800;color:${data.totals.balance > 0 ? 'var(--red)' : 'var(--green)'};">${fmtNaira(data.totals.balance)}</div><div style="font-size:10px;color:var(--text-3);">Balance</div></div>
      </div>
      ${students.map(s => `
        <div style="margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-1);margin-bottom:8px;">${escapeHtml(s.name)} <span style="color:var(--text-3);font-weight:400;">(${escapeHtml(s.id)} - ${escapeHtml(s.classCode)})</span></div>
          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;">
              <thead><tr><th>Fee Type</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${s.invoices.length ? s.invoices.map(inv => `
                  <tr>
                    <td>${escapeHtml(inv.feeType)}${inv.description ? `<br><span style="color:var(--text-3);font-size:11px;">${escapeHtml(inv.description)}</span>` : ''}</td>
                    <td>${fmtNaira(inv.amount)}</td>
                    <td>${fmtNaira(inv.paid)}</td>
                    <td>${fmtNaira(inv.balance)}</td>
                    <td>${feeFmtDate(inv.dueDate)}</td>
                    <td>${invoiceStatusBadge(inv)}</td>
                    <td>${inv.balance > 0 ? `<button class="bs-export-btn" style="position:static;" onclick="openRecordPaymentModal(${inv.id}, '${escapeHtml(s.name)} — ${escapeHtml(inv.feeType)} (Balance: ${fmtNaira(inv.balance)})', () => openFeeHistoryModal(${query.studentId ? `{studentId:'${query.studentId}'}` : `{parentEmail:'${query.parentEmail}'}`}))">Record Payment</button>` : ''}</td>
                  </tr>`).join('') : `<tr><td colspan="7" style="padding:14px;text-align:center;color:var(--text-3);">No invoices yet</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`).join('')}
    `;
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-3);">${escapeHtml(e.message)}</div>`;
  }
}
function closeFeeHistoryModal() {
  document.getElementById('fee-history-modal').style.display = 'none';
}

// ── Invoice List ──
let _ilData = [];
async function ilInit() {
  populateFeeClassSelect('il-class');
  await populateFeeTermSelect('il-term');
}
async function ilViewList() {
  const classCode = document.getElementById('il-class').value;
  const academicId = document.getElementById('il-term').value;
  const status = document.getElementById('il-status').value;
  const params = new URLSearchParams();
  if (classCode) params.set('classCode', classCode);
  if (academicId) params.set('academicId', academicId);
  if (status) params.set('status', status);
  try {
    const data = await apiFetch(`/api/admin/fees/invoices?${params.toString()}`);
    _ilData = data.invoices || [];
    ilRenderTable();
  } catch (e) {
    showToast(e.message);
  }
}
function ilRenderTable() {
  const q = (document.getElementById('il-search').value || '').toLowerCase();
  const rows = _ilData.filter(inv => !q ||
    inv.studentName.toLowerCase().includes(q) ||
    inv.studentId.toLowerCase().includes(q) ||
    (inv.feeType || '').toLowerCase().includes(q));
  const tbody = document.getElementById('il-tbody');
  tbody.innerHTML = rows.length ? rows.map((inv, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(inv.studentName)}</strong><br><span style="color:var(--text-3);font-size:11px;">${escapeHtml(inv.studentId)}</span></td>
      <td>${escapeHtml(inv.classLabel)}</td>
      <td>${escapeHtml(inv.feeType)}</td>
      <td>${fmtNaira(inv.amount)}</td>
      <td>${fmtNaira(inv.paid)}</td>
      <td>${fmtNaira(inv.balance)}</td>
      <td>${feeFmtDate(inv.dueDate)}</td>
      <td>${invoiceStatusBadge(inv)}</td>
      <td>
        <button class="bs-export-btn" style="position:static;" onclick="openFeeHistoryModal({studentId:'${inv.studentId}'})">View</button>
        ${inv.balance > 0 ? `<button class="bs-export-btn" style="position:static;border-color:#2563eb;color:#2563eb;margin-left:4px;" onclick="openRecordPaymentModal(${inv.id}, '${escapeHtml(inv.studentName)} — ${escapeHtml(inv.feeType)} (Balance: ${fmtNaira(inv.balance)})', ilViewList)">Pay</button>` : ''}
      </td>
    </tr>`).join('') : `<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--text-3);">No invoices match these filters.</td></tr>`;
  const totals = rows.reduce((acc, inv) => ({ invoiced: acc.invoiced + inv.amount, paid: acc.paid + inv.paid, balance: acc.balance + inv.balance }), { invoiced: 0, paid: 0, balance: 0 });
  document.getElementById('il-summary').textContent = rows.length
    ? `${rows.length} invoice${rows.length === 1 ? '' : 's'} — Invoiced ${fmtNaira(totals.invoiced)} · Paid ${fmtNaira(totals.paid)} · Balance ${fmtNaira(totals.balance)}`
    : '';
}

// ── Class Invoice History ──
async function cihInit() {
  await populateFeeTermSelect('cih-term');
  populateFeeClassSelect('cih-class');
}
async function cihLoadList() {
  const academicId = document.getElementById('cih-term').value;
  const classCode = document.getElementById('cih-class').value;
  if (!classCode) return showToast('Select a class');
  const params = new URLSearchParams({ classCode });
  if (academicId) params.set('academicId', academicId);
  try {
    const data = await apiFetch(`/api/admin/fees/invoices?${params.toString()}`);
    const invoices = data.invoices || [];
    document.getElementById('cih-results-card').style.display = '';
    const tbody = document.getElementById('cih-tbody');
    tbody.innerHTML = invoices.length ? invoices.map((inv, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(inv.studentName)}</td>
        <td>${escapeHtml(inv.feeType)}</td>
        <td>${fmtNaira(inv.amount)}</td>
        <td>${fmtNaira(inv.paid)}</td>
        <td>${fmtNaira(inv.balance)}</td>
        <td>${feeFmtDate(inv.dueDate)}</td>
        <td>${invoiceStatusBadge(inv)}</td>
      </tr>`).join('') : `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-3);">No invoices for this class/term.</td></tr>`;
    document.getElementById('cih-summary').textContent = `${data.summary.count} invoices — Invoiced ${fmtNaira(data.summary.totalInvoiced)} · Paid ${fmtNaira(data.summary.totalPaid)} · Balance ${fmtNaira(data.summary.totalBalance)}`;
  } catch (e) {
    showToast(e.message);
  }
}

// ── Family Fees History ──
let _ffhData = [];
async function ffhInit() {
  try {
    const data = await apiFetch('/api/admin/fees/families');
    _ffhData = data.families || [];
    const totalBalance = _ffhData.reduce((sum, f) => sum + f.totals.balance, 0);
    const withBalance = _ffhData.filter(f => f.totals.balance > 0).length;
    document.getElementById('ffh-stats').innerHTML = `
      <div style="flex:1;min-width:130px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;"><div style="font-size:20px;font-weight:800;color:var(--text-1);">${_ffhData.length}</div><div style="font-size:11px;color:var(--text-3);">Families</div></div>
      <div style="flex:1;min-width:130px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;"><div style="font-size:20px;font-weight:800;color:var(--amber);">${withBalance}</div><div style="font-size:11px;color:var(--text-3);">With Balance Due</div></div>
      <div style="flex:1;min-width:130px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;"><div style="font-size:20px;font-weight:800;color:var(--red);">${fmtNaira(totalBalance)}</div><div style="font-size:11px;color:var(--text-3);">Total Outstanding</div></div>
    `;
    ffhRenderTable();
  } catch (e) {
    showToast(e.message);
  }
}
function ffhRenderTable() {
  const q = (document.getElementById('ffh-search').value || '').toLowerCase();
  const rows = _ffhData.filter(f => !q ||
    f.parentEmail.toLowerCase().includes(q) ||
    f.students.some(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)));
  const tbody = document.getElementById('ffh-tbody');
  tbody.innerHTML = rows.length ? rows.map((f, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(f.parentEmail)}</td>
      <td>${f.students.map(s => `${escapeHtml(s.name)} <span style="color:var(--text-3);">(${escapeHtml(s.classCode)})</span>`).join('<br>')}</td>
      <td>${fmtNaira(f.totals.invoiced)}</td>
      <td>${fmtNaira(f.totals.paid)}</td>
      <td style="${f.totals.balance > 0 ? 'color:var(--red);font-weight:700;' : ''}">${fmtNaira(f.totals.balance)}</td>
      <td><button class="bs-export-btn" style="position:static;" onclick="openFeeHistoryModal({parentEmail:'${escapeHtml(f.parentEmail)}'})">Fees Records</button></td>
    </tr>`).join('') : `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-3);">No families with a parent email on file yet.</td></tr>`;
}

// ── Review Payment Proofs (log a reported payment + review queue) ──
async function rppInit() {
  populateFeeStudentSelect('rpp-student');
  document.getElementById('rpp-invoice').innerHTML = '<option value="">Select Student First</option>';
  await rppLoadQueue();
}
async function rppLoadInvoices() {
  const studentId = document.getElementById('rpp-student').value;
  const select = document.getElementById('rpp-invoice');
  if (!studentId) { select.innerHTML = '<option value="">Select Student First</option>'; return; }
  try {
    const data = await apiFetch(`/api/admin/fees/invoices?studentId=${encodeURIComponent(studentId)}`);
    const open = (data.invoices || []).filter(inv => inv.balance > 0);
    select.innerHTML = open.length
      ? open.map(inv => `<option value="${inv.id}">${escapeHtml(inv.feeType)} — Balance ${fmtNaira(inv.balance)}</option>`).join('')
      : '<option value="">No outstanding invoices for this student</option>';
  } catch (e) {
    showToast(e.message);
  }
}
async function submitPaymentProof() {
  const invoiceId = document.getElementById('rpp-invoice').value;
  const amount = document.getElementById('rpp-amount').value;
  const method = document.getElementById('rpp-method').value;
  const reference = document.getElementById('rpp-reference').value.trim();
  const note = document.getElementById('rpp-note').value.trim();
  if (!invoiceId) return showToast('Select an invoice');
  try {
    await apiFetch(`/api/admin/fees/invoices/${invoiceId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount, method, reference, note, status: 'pending' }),
    });
    showToast('Submitted for review');
    document.getElementById('rpp-amount').value = '';
    document.getElementById('rpp-reference').value = '';
    document.getElementById('rpp-note').value = '';
    rppLoadQueue();
  } catch (e) {
    showToast(e.message);
  }
}
async function rppLoadQueue() {
  const tbody = document.getElementById('rpp-tbody');
  try {
    const data = await apiFetch('/api/admin/fees/payments?status=pending');
    const rows = data.payments || [];
    tbody.innerHTML = rows.length ? rows.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.studentName)}</td>
        <td>${escapeHtml(p.feeType)}</td>
        <td>${fmtNaira(p.amount)}</td>
        <td>${escapeHtml(p.method)}</td>
        <td>${escapeHtml(p.reference || '-')}</td>
        <td>${feeFmtDate(p.recordedAt)}</td>
        <td>
          <button class="bs-export-btn" style="position:static;border-color:var(--green);color:var(--green);" onclick="rppReview(${p.id}, 'successful')">Approve</button>
          <button class="bs-export-btn" style="position:static;border-color:var(--red);color:var(--red);margin-left:4px;" onclick="rppReview(${p.id}, 'failed')">Reject</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-3);">Nothing awaiting review.</td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-3);">${escapeHtml(e.message)}</td></tr>`;
  }
}
async function rppReview(paymentId, status) {
  try {
    await apiFetch(`/api/admin/fees/payments/${paymentId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    showToast(status === 'successful' ? 'Payment approved' : 'Payment rejected');
    rppLoadQueue();
  } catch (e) {
    showToast(e.message);
  }
}

// ── Successful Payments ──
// NOTE: ids/functions are prefixed `fsp` (not `sp`) because the pre-existing
// Payroll "Staff Positions" screen already uses id="sp-tbody"/"sp-showing" —
// this avoids colliding with that (out-of-scope, sibling-owned) markup.
let _fspData = [];
function fspInit() {
  document.getElementById('fsp-results-card').style.display = 'none';
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('fsp-date-to').value = today;
  const past = new Date(); past.setDate(past.getDate() - 30);
  document.getElementById('fsp-date-from').value = past.toISOString().slice(0, 10);
}
async function fspViewReport() {
  const from = document.getElementById('fsp-date-from').value;
  const to = document.getElementById('fsp-date-to').value;
  const channel = document.getElementById('fsp-channel').value;
  if (!from || !to) { showToast('Please select a date range'); return; }
  const fmt = d => d.split('-').reverse().join('-');
  document.getElementById('fsp-results-title').textContent = `Report of Fees Received Between ${fmt(from)} — ${fmt(to)}`;
  const params = new URLSearchParams({ from, to, status: 'successful' });
  if (channel) params.set('method', channel);
  try {
    const data = await apiFetch(`/api/admin/fees/payments?${params.toString()}`);
    _fspData = data.payments || [];
    document.getElementById('fsp-results-card').style.display = '';
    fspRenderTable();
  } catch (e) {
    showToast(e.message);
  }
}
function fspRenderTable() {
  const q = (document.getElementById('fsp-search').value || '').toLowerCase();
  const rows = _fspData.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const tbody = document.getElementById('fsp-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${feeFmtDate(r.recordedAt)}</td><td>${escapeHtml(r.studentName)}</td><td>${escapeHtml(r.classLabel)}</td><td>${escapeHtml(r.feeType)}</td><td>${fmtNaira(r.amount)}</td><td>${escapeHtml(r.method)}</td><td>${escapeHtml(r.reference || '-')}</td><td>${escapeHtml(r.recordedByName || '-')}</td></tr>`).join('')
    : `<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--text-3);">No data available in table</td></tr>`;
  document.getElementById('fsp-showing').textContent = `Showing ${rows.length} of ${_fspData.length} entries`;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  document.getElementById('fsp-total').textContent = `Total : ${fmtNaira(total)}`;
}

// ── All Payment Attempts ──
let _apData = [];
function apInit() {
  document.getElementById('ap-results-card').style.display = 'none';
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('ap-date-to').value = today;
  const past = new Date(); past.setDate(past.getDate() - 183);
  document.getElementById('ap-date-from').value = past.toISOString().slice(0, 10);
}
async function apViewLog() {
  const from = document.getElementById('ap-date-from').value;
  const to = document.getElementById('ap-date-to').value;
  const status = document.getElementById('ap-status').value;
  const method = document.getElementById('ap-channel').value;
  if (!from || !to) { showToast('Please select a date range'); return; }
  const fmt = d => d.split('-').reverse().join('-');
  document.getElementById('ap-results-title').textContent = `Payment Attempts Log  |  ${fmt(from)}  -  ${fmt(to)}`;
  const params = new URLSearchParams({ from, to });
  if (status && status !== 'all') params.set('status', status);
  if (method) params.set('method', method);
  try {
    const data = await apiFetch(`/api/admin/fees/payments?${params.toString()}`);
    _apData = data.payments || [];
    document.getElementById('ap-results-card').style.display = '';
    apRenderTable();
  } catch (e) {
    showToast(e.message);
  }
}
function apRenderTable() {
  const q = (document.getElementById('ap-search').value || '').toLowerCase();
  const rows = _apData.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const tbody = document.getElementById('ap-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${feeFmtDate(r.recordedAt)}</td><td>${escapeHtml(r.studentName)}</td><td>${escapeHtml(r.classLabel)}</td><td>${escapeHtml(r.feeType)}</td><td>${escapeHtml(r.method)}</td><td>${fmtNaira(r.amount)}</td><td>${escapeHtml(r.reference || '-')}</td><td>${paymentStatusBadge(r.status)}</td></tr>`).join('')
    : `<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--text-3);">No matching records found</td></tr>`;
  document.getElementById('ap-showing').textContent = `Showing ${rows.length} of ${_apData.length} entries`;
  const total = rows.filter(r => r.status === 'successful').reduce((sum, r) => sum + r.amount, 0);
  document.getElementById('ap-total').textContent = `Total Successful : ${fmtNaira(total)}`;
}

// ── Fees Debtors ──
let _fdData = [];
async function fdInit() {
  document.getElementById('fd-results-card').style.display = 'none';
  await populateFeeTermSelect('fd-term');
  populateFeeClassSelect('fd-class');
}
async function fdLoadDebtors() {
  const academicId = document.getElementById('fd-term').value;
  const classCode = document.getElementById('fd-class').value;
  const params = new URLSearchParams();
  if (academicId) params.set('academicId', academicId);
  if (classCode) params.set('classCode', classCode);
  try {
    const data = await apiFetch(`/api/admin/fees/debtors?${params.toString()}`);
    _fdData = data.debtors || [];
    document.getElementById('fd-results-card').style.display = '';
    fdRenderTable();
  } catch (e) {
    showToast(e.message);
  }
}
function fdRenderTable() {
  const q = (document.getElementById('fd-search').value || '').toLowerCase();
  const rows = _fdData.filter(r => !q || r.studentName.toLowerCase().includes(q) || r.studentId.toLowerCase().includes(q));
  const tbody = document.getElementById('fd-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.studentName)}</td><td>${escapeHtml(r.studentId)}</td><td>${escapeHtml(r.classLabel)}</td><td>${r.invoiceCount}</td><td>${fmtNaira(r.totalInvoiced)}</td><td>${fmtNaira(r.totalPaid)}</td><td style="color:var(--red);font-weight:700;">${fmtNaira(r.balance)}</td><td>${feeFmtDate(r.dueDate)}${r.overdue ? ' <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--red-bg);color:var(--red);">Overdue</span>' : ''}</td><td><button class="bs-export-btn" style="position:static;" onclick="openFeeHistoryModal({studentId:'${r.studentId}'})">View</button></td></tr>`).join('')
    : `<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--text-3);">No outstanding balances for these filters.</td></tr>`;
  document.getElementById('fd-showing').textContent = `Showing ${rows.length} of ${_fdData.length} entries`;
  const total = rows.reduce((sum, r) => sum + r.balance, 0);
  document.getElementById('fd-total').textContent = `Total Balance Due : ${fmtNaira(total)}`;
}

// Auto-open date picker on click/focus anywhere in the portal
document.addEventListener('click', function(e) {
  if (e.target && e.target.type === 'date') {
    try { e.target.showPicker(); } catch(_) {}
  }
});
document.addEventListener('focus', function(e) {
  if (e.target && e.target.type === 'date') {
    try { e.target.showPicker(); } catch(_) {}
  }
}, true);

// ── FINANCE: HRM/PAYROLL + INCOME & EXPENSES (feature/finance-payroll-expenses) ──
// Self-contained: own state, own helpers, own DOM ids. Kept separate from the
// rest of admin-api.js so it merges cleanly alongside sibling finance branches.

function finMoney(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function finToday() {
  return new Date().toISOString().slice(0, 10);
}
function finStaffOptions(selectedId) {
  const staff = (state.setup && state.setup.staff) || [];
  return staff.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.roleLabel || s.role)})</option>`).join('');
}
function finStatusPill(status, map) {
  const colors = map || { pending: '#d97706', outstanding: '#d97706', approved: '#2563eb', repaying: '#2563eb', dispensed: '#059669', paid: '#059669', repaid: '#059669', rejected: '#ef4444' };
  const c = colors[status] || 'var(--text-2)';
  return `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${c}22;color:${c};text-transform:capitalize;">${escapeHtml(status)}</span>`;
}

// ── EXPENSE REQUESTS (approval workflow) ──
let _erData = [];
async function erInit() {
  document.getElementById('er-tbody').innerHTML = '<tr><td colspan="9" style="padding:28px;text-align:center;color:var(--text-3);">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/admin/finance/expense-requests');
    _erData = data.requests || [];
  } catch (err) {
    _erData = [];
    showToast(err.message || 'Failed to load expense requests');
  }
  erRenderTable();
}
function erRenderTable() {
  const statusFilter = (document.getElementById('er-status') || {}).value || '';
  const search = ((document.getElementById('er-search') || {}).value || '').toLowerCase();
  const rows = _erData.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search && !(`${r.title} ${r.category} ${r.requestedByName}`.toLowerCase().includes(search))) return false;
    return true;
  });
  const tbody = document.getElementById('er-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:28px;text-align:center;color:var(--text-3);">No expense requests found.</td></tr>';
  } else {
    tbody.innerHTML = rows.map((r, i) => {
      let actions = '';
      if (r.status === 'pending') {
        actions = `<button class="bs-toggle-btn" style="padding:4px 10px;font-size:10px;color:#059669;" onclick="erDecide(${r.id},'approve')">Approve</button> <button class="bs-toggle-btn" style="padding:4px 10px;font-size:10px;color:#ef4444;" onclick="erDecide(${r.id},'reject')">Reject</button>`;
      } else if (r.status === 'approved') {
        actions = `<button class="bs-toggle-btn" style="padding:4px 10px;font-size:10px;color:#2563eb;" onclick="erDecide(${r.id},'dispense')">Mark Dispensed</button>`;
      } else {
        actions = '—';
      }
      return `<tr><td>${i + 1}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.category || '')}</td><td>${finMoney(r.amount)}</td><td>${escapeHtml(r.requestedByName)}</td><td>${new Date(r.requestedAt).toLocaleDateString()}</td><td>${finStatusPill(r.status)}</td><td>${escapeHtml(r.approvedByName || '—')}</td><td>${actions}</td></tr>`;
    }).join('');
  }
  document.getElementById('er-showing').textContent = `Showing ${rows.length} of ${_erData.length} entries`;

  const sum = (pred) => _erData.filter(pred).reduce((t, r) => t + Number(r.amount), 0);
  const count = (pred) => _erData.filter(pred).length;
  document.getElementById('er-stat-total').textContent = finMoney(_erData.reduce((t, r) => t + Number(r.amount), 0));
  document.getElementById('er-stat-total-count').textContent = `${_erData.length} Entries`;
  document.getElementById('er-stat-pending').textContent = finMoney(sum(r => r.status === 'pending'));
  document.getElementById('er-stat-pending-count').textContent = `${count(r => r.status === 'pending')} Requests`;
  document.getElementById('er-stat-approved').textContent = finMoney(sum(r => r.status === 'approved'));
  document.getElementById('er-stat-approved-count').textContent = `${count(r => r.status === 'approved')} Requests`;
  document.getElementById('er-stat-dispensed').textContent = finMoney(sum(r => r.status === 'dispensed'));
  document.getElementById('er-stat-dispensed-count').textContent = `${count(r => r.status === 'dispensed')} Requests`;
}
function erOpenModal() {
  ['er-form-title', 'er-form-category', 'er-form-amount', 'er-form-reason'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('er-modal').style.display = 'flex';
}
function erCloseModal() { document.getElementById('er-modal').style.display = 'none'; }
async function erSubmit() {
  const title = document.getElementById('er-form-title').value.trim();
  const amount = Number(document.getElementById('er-form-amount').value);
  if (!title || !amount || amount <= 0) { showToast('Title and a positive amount are required'); return; }
  try {
    await apiFetch('/api/admin/finance/expense-requests', {
      method: 'POST',
      body: JSON.stringify({
        title,
        category: document.getElementById('er-form-category').value.trim(),
        amount,
        reason: document.getElementById('er-form-reason').value.trim(),
      }),
    });
    erCloseModal();
    showToast('Expense request submitted');
    erInit();
  } catch (err) { showToast(err.message || 'Failed to submit request'); }
}
async function erDecide(id, action) {
  try {
    await apiFetch(`/api/admin/finance/expense-requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) });
    showToast(action === 'approve' ? 'Request approved' : action === 'reject' ? 'Request rejected' : 'Marked dispensed');
    erInit();
  } catch (err) { showToast(err.message || 'Action failed'); }
}

// ── EXPENSES (Expenditures) ──
let _expData = [];
async function expInit() {
  document.getElementById('exp-tbody').innerHTML = '<tr><td colspan="7" style="padding:28px;text-align:center;color:var(--text-3);">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/admin/finance/expenses');
    _expData = data.expenses || [];
  } catch (err) {
    _expData = [];
    showToast(err.message || 'Failed to load expenses');
  }
  const catSel = document.getElementById('exp-category');
  const cats = [...new Set(_expData.map(e => e.category))].sort();
  const prevVal = catSel.value;
  catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = cats.includes(prevVal) ? prevVal : '';
  expRenderTable();
}
function expRenderTable() {
  const catFilter = (document.getElementById('exp-category') || {}).value || '';
  const search = ((document.getElementById('exp-search') || {}).value || '').toLowerCase();
  const rows = _expData.filter(e => {
    if (catFilter && e.category !== catFilter) return false;
    if (search && !((e.description || '').toLowerCase().includes(search))) return false;
    return true;
  });
  const tbody = document.getElementById('exp-tbody');
  tbody.innerHTML = rows.length ? rows.map((e, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.description || '—')}</td><td>${finMoney(e.amount)}</td><td>${e.expenseDate}</td><td>${escapeHtml(e.recordedByName)}</td><td>${e.requestId ? 'Expense Request #' + e.requestId : 'Direct entry'}</td></tr>`).join('')
    : '<tr><td colspan="7" style="padding:28px;text-align:center;color:var(--text-3);">No expenses recorded yet.</td></tr>';

  const total = _expData.reduce((t, e) => t + Number(e.amount), 0);
  const today = finToday();
  const month = today.slice(0, 7);
  document.getElementById('exp-stat-total').textContent = finMoney(total);
  document.getElementById('exp-stat-total-count').textContent = `${_expData.length} Entries`;
  document.getElementById('exp-stat-avg').textContent = finMoney(_expData.length ? total / _expData.length : 0);
  document.getElementById('exp-stat-today').textContent = finMoney(_expData.filter(e => e.expenseDate === today).reduce((t, e) => t + Number(e.amount), 0));
  document.getElementById('exp-stat-month').textContent = finMoney(_expData.filter(e => (e.expenseDate || '').slice(0, 7) === month).reduce((t, e) => t + Number(e.amount), 0));
  document.getElementById('exp-total-label').textContent = finMoney(rows.reduce((t, e) => t + Number(e.amount), 0));

  const catMap = new Map();
  _expData.forEach(e => catMap.set(e.category, (catMap.get(e.category) || { amount: 0, count: 0 })));
  _expData.forEach(e => { const c = catMap.get(e.category); c.amount += Number(e.amount); c.count += 1; });
  const catRows = [...catMap.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const catTbody = document.getElementById('exp-cat-tbody');
  catTbody.innerHTML = catRows.length ? catRows.map(([cat, v], i) => `<tr><td>${i + 1}</td><td>${escapeHtml(cat)}</td><td>${finMoney(v.amount)}</td><td>${v.count}</td><td>${total ? Math.round(v.amount / total * 100) : 0}%</td></tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3);">No expense data available.</td></tr>';
}
function expOpenModal() {
  ['exp-form-category', 'exp-form-description', 'exp-form-amount'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('exp-form-date').value = finToday();
  document.getElementById('exp-modal').style.display = 'flex';
}
function expCloseModal() { document.getElementById('exp-modal').style.display = 'none'; }
async function expSubmit() {
  const category = document.getElementById('exp-form-category').value.trim();
  const amount = Number(document.getElementById('exp-form-amount').value);
  if (!category || !amount || amount <= 0) { showToast('Category and a positive amount are required'); return; }
  try {
    await apiFetch('/api/admin/finance/expenses', {
      method: 'POST',
      body: JSON.stringify({
        category,
        description: document.getElementById('exp-form-description').value.trim(),
        amount,
        date: document.getElementById('exp-form-date').value || finToday(),
      }),
    });
    expCloseModal();
    showToast('Expense recorded');
    expInit();
  } catch (err) { showToast(err.message || 'Failed to record expense'); }
}

function switchIeView(viewId, btn) {
  const panel = btn.closest('.tab-panel');
  panel.querySelectorAll('[id^="ie-view-"]').forEach(v => v.style.display = 'none');
  const el = document.getElementById('ie-view-' + viewId);
  if (el) el.style.display = '';
  panel.querySelectorAll('.ie-inner-tab').forEach(t => {
    t.style.borderBottomColor = 'transparent';
    t.style.color = 'var(--text-2)';
    t.style.fontWeight = '700';
  });
  btn.style.borderBottomColor = '#2563eb';
  btn.style.color = '#2563eb';
  if (viewId === 'expHeads') financeCategoryLoad('expense');
  if (viewId === 'incomeHeads') financeCategoryLoad('income');
}

async function financeCategoryLoad(type) {
  const tbody = document.getElementById(type === 'expense' ? 'exp-heads-tbody' : 'inc-heads-tbody');
  if (!tbody) return;
  try {
    const data = await apiFetch(`/api/admin/finance/categories?type=${type}`);
    const rows = data.categories || [];
    tbody.innerHTML = rows.length
      ? rows.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td><button class="del-btn" style="padding:4px 10px;font-size:11px;" onclick="financeCategoryDelete(${c.id},'${type}')">Remove</button></td></tr>`).join('')
      : '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--text-3);">No categories added yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--red);">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function financeCategoryAdd(type) {
  const input = document.getElementById(type === 'expense' ? 'exp-head-name' : 'inc-head-name');
  const name = input.value.trim();
  if (!name) { showToast('Enter a category name'); return; }
  try {
    await apiFetch('/api/admin/finance/categories', { method: 'POST', body: JSON.stringify({ type, name }) });
    input.value = '';
    showToast('Category added');
    financeCategoryLoad(type);
  } catch (err) {
    showToast(err.message);
  }
}

async function financeCategoryDelete(id, type) {
  if (!confirm('Remove this category?')) return;
  try {
    await apiFetch(`/api/admin/finance/categories/${id}`, { method: 'DELETE' });
    financeCategoryLoad(type);
  } catch (err) {
    showToast(err.message);
  }
}

// ── INCOME ──
let _incData = [];
async function incInit() {
  document.getElementById('inc-tbody').innerHTML = '<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text-3);">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/admin/finance/income');
    _incData = data.income || [];
  } catch (err) {
    _incData = [];
    showToast(err.message || 'Failed to load income');
  }
  const catSel = document.getElementById('inc-category');
  const cats = [...new Set(_incData.map(e => e.category))].sort();
  const prevVal = catSel.value;
  catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = cats.includes(prevVal) ? prevVal : '';
  incRenderTable();
}
function incRenderTable() {
  const catFilter = (document.getElementById('inc-category') || {}).value || '';
  const search = ((document.getElementById('inc-search') || {}).value || '').toLowerCase();
  const rows = _incData.filter(e => {
    if (catFilter && e.category !== catFilter) return false;
    if (search && !((e.description || '').toLowerCase().includes(search))) return false;
    return true;
  });
  const tbody = document.getElementById('inc-tbody');
  tbody.innerHTML = rows.length ? rows.map((e, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.description || '—')}</td><td>${finMoney(e.amount)}</td><td>${e.incomeDate}</td><td>${escapeHtml(e.recordedByName)}</td></tr>`).join('')
    : '<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text-3);">No income recorded yet.</td></tr>';

  const total = _incData.reduce((t, e) => t + Number(e.amount), 0);
  const today = finToday();
  const month = today.slice(0, 7);
  document.getElementById('inc-stat-total').textContent = finMoney(total);
  document.getElementById('inc-stat-total-count').textContent = `${_incData.length} Entries`;
  document.getElementById('inc-stat-avg').textContent = finMoney(_incData.length ? total / _incData.length : 0);
  document.getElementById('inc-stat-today').textContent = finMoney(_incData.filter(e => e.incomeDate === today).reduce((t, e) => t + Number(e.amount), 0));
  document.getElementById('inc-stat-month').textContent = finMoney(_incData.filter(e => (e.incomeDate || '').slice(0, 7) === month).reduce((t, e) => t + Number(e.amount), 0));
  document.getElementById('inc-total-label').textContent = finMoney(rows.reduce((t, e) => t + Number(e.amount), 0));

  const catMap = new Map();
  _incData.forEach(e => catMap.set(e.category, (catMap.get(e.category) || { amount: 0, count: 0 })));
  _incData.forEach(e => { const c = catMap.get(e.category); c.amount += Number(e.amount); c.count += 1; });
  const catRows = [...catMap.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const catTbody = document.getElementById('inc-cat-tbody');
  catTbody.innerHTML = catRows.length ? catRows.map(([cat, v], i) => `<tr><td>${i + 1}</td><td>${escapeHtml(cat)}</td><td>${finMoney(v.amount)}</td><td>${v.count}</td><td>${total ? Math.round(v.amount / total * 100) : 0}%</td></tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3);">No income data available.</td></tr>';
}
function incOpenModal() {
  ['inc-form-category', 'inc-form-description', 'inc-form-amount'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inc-form-date').value = finToday();
  document.getElementById('inc-modal').style.display = 'flex';
}
function incCloseModal() { document.getElementById('inc-modal').style.display = 'none'; }
async function incSubmit() {
  const category = document.getElementById('inc-form-category').value.trim();
  const amount = Number(document.getElementById('inc-form-amount').value);
  if (!category || !amount || amount <= 0) { showToast('Category and a positive amount are required'); return; }
  try {
    await apiFetch('/api/admin/finance/income', {
      method: 'POST',
      body: JSON.stringify({
        category,
        description: document.getElementById('inc-form-description').value.trim(),
        amount,
        date: document.getElementById('inc-form-date').value || finToday(),
      }),
    });
    incCloseModal();
    showToast('Income recorded');
    incInit();
  } catch (err) { showToast(err.message || 'Failed to record income'); }
}

// ── INCOME & EXPENSES ANALYTICS ──
async function ieaInit() {
  let data;
  try {
    data = await apiFetch('/api/admin/finance/analytics');
  } catch (err) {
    showToast(err.message || 'Failed to load analytics');
    return;
  }
  document.getElementById('iea-total-income').textContent = finMoney(data.totalIncome);
  document.getElementById('iea-income-txn').textContent = `${data.incomeCount} Transactions`;
  document.getElementById('iea-total-exp').textContent = finMoney(data.totalExpenses);
  document.getElementById('iea-exp-txn').textContent = `${data.expenseCount} Transactions`;
  document.getElementById('iea-net').textContent = finMoney(data.net);
  const netLabel = document.getElementById('iea-net-label');
  netLabel.style.color = data.net >= 0 ? '#059669' : '#ef4444';
  netLabel.textContent = data.net >= 0 ? 'Surplus' : 'Deficit';

  const expTbody = document.getElementById('iea-exp-tbody');
  expTbody.innerHTML = data.expensesByCategory.length ? data.expensesByCategory.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.category)}</td><td>${finMoney(c.amount)}</td><td>${c.count}</td><td>${data.totalExpenses ? Math.round(c.amount / data.totalExpenses * 100) : 0}%</td></tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3);">No Data Found</td></tr>';

  const incTbody = document.getElementById('iea-inc-tbody');
  incTbody.innerHTML = data.incomeByCategory.length ? data.incomeByCategory.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.category)}</td><td>${finMoney(c.amount)}</td><td>${c.count}</td><td>${data.totalIncome ? Math.round(c.amount / data.totalIncome * 100) : 0}%</td></tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-3);">No Data Found</td></tr>';

  const trendTbody = document.getElementById('iea-trend-tbody');
  trendTbody.innerHTML = data.monthlyTrend.length ? data.monthlyTrend.map(m => `<tr><td>${m.month}</td><td>${finMoney(m.income)}</td><td>${finMoney(m.expenses)}</td><td style="color:${m.net >= 0 ? '#059669' : '#ef4444'};">${finMoney(m.net)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3);">No Data Found</td></tr>';
}
function switchIeaTab(tabId, btn) {
  document.querySelectorAll('[id^="iea-tab-"]').forEach(t => t.style.display = 'none');
  const el = document.getElementById('iea-tab-' + tabId);
  if (el) el.style.display = '';
  btn.closest('.card').querySelectorAll('.iea-tab').forEach(t => {
    t.style.borderBottomColor = 'transparent';
    t.style.color = 'var(--text-2)';
  });
  btn.style.borderBottomColor = '#2563eb';
  btn.style.color = '#2563eb';
}

// ── MONTHLY SALARIES PROCESSING ──
function finPeriodFromSelects(monthId, yearId) {
  const month = document.getElementById(monthId).value;
  const year = document.getElementById(yearId).value;
  return month && year ? `${year}-${String(month).padStart(2, '0')}` : '';
}
function finMatchesEmpType(role, emptype) {
  if (!emptype || emptype === 'all') return true;
  if (emptype === 'teacher') return role === 'teacher';
  if (emptype === 'non-teaching') return role === 'admin';
  return true;
}
let _mspRates = [], _mspSalaries = [];
function mspInit() {
  const now = new Date();
  document.getElementById('msp-month').value = String(now.getMonth() + 1);
  document.getElementById('msp-year').value = String(now.getFullYear());
  document.getElementById('msp-results-card').style.display = 'none';
}
async function mspLoadList() {
  const emptype = document.getElementById('msp-emptype').value;
  if (!emptype) { showToast('Please select Employee Type'); return; }
  const period = finPeriodFromSelects('msp-month', 'msp-year');
  const monthSel = document.getElementById('msp-month');
  const monthName = monthSel.options[monthSel.selectedIndex].text;
  const year = document.getElementById('msp-year').value;
  const emptypeLabel = document.getElementById('msp-emptype').options[document.getElementById('msp-emptype').selectedIndex].text;
  document.getElementById('msp-period-label').textContent = `Computing ${monthName} ${year} Salary`;
  document.getElementById('msp-emptype-label').textContent = `Employee Type : ${emptypeLabel}`;
  document.getElementById('msp-results-card').style.display = '';
  try {
    const [ratesData, salariesData] = await Promise.all([
      apiFetch('/api/admin/payroll/rates'),
      apiFetch(`/api/admin/payroll/salaries?period=${encodeURIComponent(period)}`),
    ]);
    _mspRates = ratesData.rates || [];
    _mspSalaries = salariesData.salaries || [];
  } catch (err) {
    showToast(err.message || 'Failed to load payroll data');
    _mspRates = []; _mspSalaries = [];
  }
  mspRenderTable(emptype, period);
}
function mspRenderTable(emptype, period) {
  const tbody = document.getElementById('msp-tbody');
  const rows = _mspRates.filter(s => finMatchesEmpType(s.role, emptype));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-3);">No staff records found for the selected criteria.</td></tr>';
    document.getElementById('msp-showing').textContent = 'Showing 0 entries';
    return;
  }
  tbody.innerHTML = rows.map((s, i) => {
    const existing = _mspSalaries.find(sal => sal.staffId === s.staffId);
    const base = existing ? existing.baseSalary : s.baseSalary;
    const allow = existing ? existing.allowances : s.allowances;
    const ded = existing ? existing.deductions : s.deductions;
    const locked = existing && existing.status === 'paid';
    const roleLabel = s.role === 'admin' ? 'Admin' : (s.teacherType === 'subject_teacher' ? 'Subject Teacher' : 'Class Teacher');
    return `<tr data-staff="${s.staffId}">
      <td>${i + 1}</td>
      <td><div style="font-weight:600;font-size:12px;">${escapeHtml(s.name)}</div><div style="font-size:10px;color:var(--text-3);">${s.staffId}</div></td>
      <td style="font-size:11px;color:var(--text-3);">${roleLabel}</td>
      <td><input type="number" class="msp-base" value="${base}" ${locked ? 'disabled' : ''} style="width:100px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="mspRecalc('${s.staffId}')"/></td>
      <td><input type="number" class="msp-allow" value="${allow}" ${locked ? 'disabled' : ''} style="width:90px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="mspRecalc('${s.staffId}')"/></td>
      <td><input type="number" class="msp-ded" value="${ded}" ${locked ? 'disabled' : ''} style="width:90px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="mspRecalc('${s.staffId}')"/></td>
      <td class="msp-net" style="font-weight:700;">${finMoney(base + allow - ded)}</td>
      <td>${existing ? finStatusPill(existing.status) : finStatusPill('not processed', { 'not processed': 'var(--text-3)' })}</td>
    </tr>`;
  }).join('');
  document.getElementById('msp-showing').textContent = `Showing ${rows.length} entries`;
  tbody.dataset.period = period;
}
function mspRecalc(staffId) {
  const row = document.querySelector(`#msp-tbody tr[data-staff="${staffId}"]`);
  if (!row) return;
  const base = Number(row.querySelector('.msp-base').value) || 0;
  const allow = Number(row.querySelector('.msp-allow').value) || 0;
  const ded = Number(row.querySelector('.msp-ded').value) || 0;
  row.querySelector('.msp-net').textContent = finMoney(base + allow - ded);
}
async function mspProcess() {
  const tbody = document.getElementById('msp-tbody');
  const period = tbody.dataset.period;
  if (!period) { showToast('Load a list first'); return; }
  const entries = [...tbody.querySelectorAll('tr[data-staff]')].map(row => ({
    staffId: row.dataset.staff,
    baseSalary: Number(row.querySelector('.msp-base').value) || 0,
    allowances: Number(row.querySelector('.msp-allow').value) || 0,
    deductions: Number(row.querySelector('.msp-ded').value) || 0,
  }));
  if (!entries.length) { showToast('Nothing to process'); return; }
  try {
    const data = await apiFetch('/api/admin/payroll/salaries/generate', {
      method: 'POST',
      body: JSON.stringify({ period, entries }),
    });
    showToast(`Processed ${data.processed} salary record(s) for ${period}`);
    _mspSalaries = data.salaries || [];
    const emptype = document.getElementById('msp-emptype').value;
    mspRenderTable(emptype, period);
  } catch (err) { showToast(err.message || 'Failed to process salaries'); }
}

// ── SALARY PAYMENT SCHEDULE ──
let _spsData = [];
function spsInit() {
  const now = new Date();
  document.getElementById('sps-month').value = String(now.getMonth() + 1);
  document.getElementById('sps-year').value = String(now.getFullYear());
  document.getElementById('sps-results-card').style.display = 'none';
}
async function spsView() {
  const month = document.getElementById('sps-month').value;
  if (!month) { showToast('Please select a Salary Month'); return; }
  const period = finPeriodFromSelects('sps-month', 'sps-year');
  const monthSel = document.getElementById('sps-month');
  const monthName = monthSel.options[monthSel.selectedIndex].text;
  const year = document.getElementById('sps-year').value;
  document.getElementById('sps-period-label').textContent = 'Salary Payment Schedule — ' + monthName + ' ' + year;
  document.getElementById('sps-results-card').style.display = '';
  try {
    const data = await apiFetch(`/api/admin/payroll/salaries?period=${encodeURIComponent(period)}`);
    _spsData = data.salaries || [];
  } catch (err) {
    _spsData = [];
    showToast(err.message || 'Failed to load salary schedule');
  }
  spsRenderTable();
}
function spsRenderTable() {
  const emptype = document.getElementById('sps-emptype').value;
  const search = ((document.getElementById('sps-search') || {}).value || '').toLowerCase();
  const rows = _spsData.filter(s => finMatchesEmpType(s.role, emptype) && (!search || s.name.toLowerCase().includes(search)));
  const tbody = document.getElementById('sps-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--text-3);">No records found. Process this month\'s salaries first from Monthly Salaries Processing.</td></tr>';
  } else {
    tbody.innerHTML = rows.map((s, i) => {
      const roleLabel = s.role === 'admin' ? 'Admin' : (s.teacherType === 'subject_teacher' ? 'Subject Teacher' : 'Class Teacher');
      const action = s.status === 'paid' ? '—' : `<button class="bs-toggle-btn" style="padding:4px 10px;font-size:10px;color:#059669;" onclick="spsMarkPaid(${s.id})">Mark Paid</button>`;
      return `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${roleLabel}</td><td>${finMoney(s.baseSalary)}</td><td>${finMoney(s.allowances)}</td><td>${finMoney(s.deductions)}</td><td style="font-weight:700;">${finMoney(s.netSalary)}</td><td>${finStatusPill(s.status)}</td><td>${action}</td></tr>`;
    }).join('');
  }
  document.getElementById('sps-showing').textContent = `Showing ${rows.length} of ${_spsData.length} entries`;
}
async function spsMarkPaid(id) {
  try {
    await apiFetch(`/api/admin/payroll/salaries/${id}/pay`, { method: 'POST' });
    showToast('Salary marked as paid');
    spsView();
  } catch (err) { showToast(err.message || 'Failed to mark paid'); }
}

// ── PAYROLL SETTINGS (Pay Rates) ──
let _prRates = [];
async function prInit() {
  switchPrTab('scale', document.getElementById('pr-tab-scale'));
  document.getElementById('pr-tbody').innerHTML = '<tr><td colspan="8" style="padding:28px;text-align:center;color:var(--text-3);">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/admin/payroll/rates');
    _prRates = data.rates || [];
  } catch (err) {
    _prRates = [];
    showToast(err.message || 'Failed to load pay rates');
  }
  prRenderTable();
}
function prRenderTable() {
  const tbody = document.getElementById('pr-tbody');
  if (!_prRates.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:28px;text-align:center;color:var(--text-3);">No staff found.</td></tr>';
    return;
  }
  tbody.innerHTML = _prRates.map((s, i) => {
    const roleLabel = s.role === 'admin' ? 'Admin' : (s.teacherType === 'subject_teacher' ? 'Subject Teacher' : 'Class Teacher');
    return `<tr data-staff="${s.staffId}">
      <td>${i + 1}</td>
      <td>${escapeHtml(s.name)}</td>
      <td style="font-size:11px;color:var(--text-3);">${roleLabel}</td>
      <td><input type="number" class="pr-base" value="${s.baseSalary}" style="width:100px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="prRecalc('${s.staffId}')"/></td>
      <td><input type="number" class="pr-allow" value="${s.allowances}" style="width:90px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="prRecalc('${s.staffId}')"/></td>
      <td><input type="number" class="pr-ded" value="${s.deductions}" style="width:90px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;" oninput="prRecalc('${s.staffId}')"/></td>
      <td class="pr-net" style="font-weight:700;">${finMoney(s.baseSalary + s.allowances - s.deductions)}</td>
      <td><button class="bs-toggle-btn" style="padding:4px 10px;font-size:11px;" onclick="prSave('${s.staffId}')">Save</button></td>
    </tr>`;
  }).join('');
}
function prRecalc(staffId) {
  const row = document.querySelector(`#pr-tbody tr[data-staff="${staffId}"]`);
  if (!row) return;
  const base = Number(row.querySelector('.pr-base').value) || 0;
  const allow = Number(row.querySelector('.pr-allow').value) || 0;
  const ded = Number(row.querySelector('.pr-ded').value) || 0;
  row.querySelector('.pr-net').textContent = finMoney(base + allow - ded);
}
async function prSave(staffId) {
  const row = document.querySelector(`#pr-tbody tr[data-staff="${staffId}"]`);
  if (!row) return;
  const baseSalary = Number(row.querySelector('.pr-base').value) || 0;
  const allowances = Number(row.querySelector('.pr-allow').value) || 0;
  const deductions = Number(row.querySelector('.pr-ded').value) || 0;
  try {
    await apiFetch('/api/admin/payroll/rates', {
      method: 'POST',
      body: JSON.stringify({ staffId, baseSalary, allowances, deductions }),
    });
    showToast('Pay rate saved');
  } catch (err) { showToast(err.message || 'Failed to save pay rate'); }
}
function switchPrTab(view, btn) {
  ['scale', 'positions', 'contracts', 'paye'].forEach(function (v) {
    var el = document.getElementById('pr-view-' + v);
    if (el) el.style.display = 'none';
    var tb = document.getElementById('pr-tab-' + v);
    if (tb) { tb.style.borderBottomColor = 'transparent'; tb.style.color = 'var(--text-2)'; }
  });
  var active = document.getElementById('pr-view-' + view);
  if (active) active.style.display = '';
  if (btn) { btn.style.borderBottomColor = '#2563eb'; btn.style.color = '#2563eb'; }
}

// ── STAFF LOANS & ADVANCES ──
let _slData = [];
async function slInit() {
  switchSlTab('loans', document.querySelector('.sl-tab'));
  document.getElementById('sl-tbody').innerHTML = '<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--text-3);">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/admin/payroll/loans');
    _slData = data.loans || [];
  } catch (err) {
    _slData = [];
    showToast(err.message || 'Failed to load loans');
  }
  slRenderTable();
}
function switchSlTab(view, btn) {
  ['loans', 'settings'].forEach(function (v) {
    var el = document.getElementById('sl-view-' + v);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.sl-tab').forEach(function (t) {
    t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--text-2)';
  });
  var el = document.getElementById('sl-view-' + view);
  if (el) el.style.display = '';
  if (btn) { btn.style.borderBottomColor = '#2563eb'; btn.style.color = '#2563eb'; }
}
function slRenderTable() {
  const statusFilter = (document.getElementById('sl-status') || {}).value || '';
  const typeFilter = (document.getElementById('sl-type') || {}).value || '';
  const rows = _slData.filter(l => (!statusFilter || l.repaymentStatus === statusFilter) && (!typeFilter || l.loanType === typeFilter));
  const tbody = document.getElementById('sl-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--text-3);">No data available in table</td></tr>';
  } else {
    tbody.innerHTML = rows.map((l, i) => {
      const nextStatus = l.repaymentStatus === 'outstanding' ? 'repaying' : (l.repaymentStatus === 'repaying' ? 'repaid' : null);
      const actionBtn = nextStatus
        ? `<button class="bs-toggle-btn" style="padding:4px 10px;font-size:10px;" onclick="slAdvanceStatus(${l.id},'${nextStatus}')">Mark ${nextStatus === 'repaying' ? 'Repaying' : 'Repaid'}</button>`
        : '—';
      return `<tr><td>${i + 1}</td><td>${escapeHtml(l.name)}</td><td style="text-transform:capitalize;">${escapeHtml(l.loanType)}</td><td>${finMoney(l.amount)}</td><td>${finMoney(l.monthlyDeduction)}</td><td style="max-width:200px;font-size:11px;color:var(--text-2);">${escapeHtml(l.reason || '—')}</td><td>${finStatusPill(l.repaymentStatus)}</td><td>${new Date(l.issuedAt).toLocaleDateString()}</td><td>${actionBtn}</td></tr>`;
    }).join('');
  }
  document.getElementById('sl-showing').textContent = `Showing ${rows.length} of ${_slData.length} entries`;
}
function slClear() {
  document.getElementById('sl-status').value = '';
  document.getElementById('sl-type').value = '';
  slRenderTable();
}
function slOpenModal() {
  document.getElementById('sl-form-staff').innerHTML = finStaffOptions();
  document.getElementById('sl-form-type').value = 'loan';
  ['sl-form-amount', 'sl-form-deduction', 'sl-form-reason'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sl-modal').style.display = 'flex';
}
function slCloseModal() { document.getElementById('sl-modal').style.display = 'none'; }
async function slSubmit() {
  const staffId = document.getElementById('sl-form-staff').value;
  const amount = Number(document.getElementById('sl-form-amount').value);
  if (!staffId || !amount || amount <= 0) { showToast('Staff member and a positive amount are required'); return; }
  try {
    await apiFetch('/api/admin/payroll/loans', {
      method: 'POST',
      body: JSON.stringify({
        staffId,
        loanType: document.getElementById('sl-form-type').value,
        amount,
        monthlyDeduction: Number(document.getElementById('sl-form-deduction').value) || 0,
        reason: document.getElementById('sl-form-reason').value.trim(),
      }),
    });
    slCloseModal();
    showToast('Loan recorded');
    slInit();
  } catch (err) { showToast(err.message || 'Failed to record loan'); }
}
async function slAdvanceStatus(id, status) {
  try {
    await apiFetch(`/api/admin/payroll/loans/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    showToast('Loan status updated');
    slInit();
  } catch (err) { showToast(err.message || 'Failed to update status'); }
}

// ── MOBILE SIDEBAR TOGGLE ──
function mobStaggerItems(sidebar) {
  var els = Array.from(sidebar.querySelectorAll('.sidebar-logo,.user-pill,.admin-quick-search,.rail-item,.sub-nav-item'));
  els.forEach(function(el) { el.style.opacity = '0'; el.style.animation = 'none'; });
  els.forEach(function(el, i) {
    el.style.animation = 'mobNavIn 0.38s cubic-bezier(0.4,0,0.2,1) ' + (120 + i * 48) + 'ms both';
  });
}
function mobClearStagger(sidebar) {
  sidebar.querySelectorAll('.sidebar-logo,.user-pill,.admin-quick-search,.rail-item,.sub-nav-item').forEach(function(el) {
    el.style.animation = '';
    el.style.opacity = '';
  });
}
function deskToggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
}

function mobToggleSidebar() {
  var sidebar = document.getElementById('main-sidebar');
  var overlay = document.getElementById('sidebar-overlay');
  var btn = document.getElementById('mob-hamburger');
  var isOpen = sidebar.classList.contains('mob-open');
  if (isOpen) {
    sidebar.classList.remove('mob-open');
    overlay.classList.remove('open');
    if (btn) btn.classList.remove('is-open');
    mobClearStagger(sidebar);
  } else {
    sidebar.classList.add('mob-open');
    overlay.classList.add('open');
    if (btn) btn.classList.add('is-open');
    mobStaggerItems(sidebar);
  }
}
function mobCloseSidebar() {
  var sidebar = document.getElementById('main-sidebar');
  sidebar.classList.remove('mob-open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  var btn = document.getElementById('mob-hamburger');
  if (btn) btn.classList.remove('is-open');
  mobClearStagger(sidebar);
}
// Close on overlay click
document.getElementById('sidebar-overlay').addEventListener('click', mobCloseSidebar);
// Only close sidebar when a leaf tab item is clicked (not dropdowns or section headers)
document.addEventListener('click', function(e) {
  if (window.innerWidth > 768) return;
  const leafLink = e.target.closest('[onclick*="switchTab"]');
  if (leafLink) setTimeout(mobCloseSidebar, 180);
});

// ══════════════════════════════════════════════════════════════════════
// FINANCE: STORE & INVENTORY / ACCOUNTING
// Self-contained module for the Finance > Store & Inventory and
// Finance > Accounting sidebar sections. Fetches/renders/saves against
// the /api/admin/store/* and /api/admin/acct/* routes in server.js.
// Kept namespaced (state.fin / state.pos / state.je, fin*-prefixed
// functions) so it doesn't collide with the Fees/Payroll finance work
// landing in sibling branches.
// ══════════════════════════════════════════════════════════════════════

state.fin = {
  categories: [], products: [], orders: [], requisitions: [], settings: {},
  banners: [], sections: [], storefront: null,
  accounts: [], journalEntries: [], contacts: [], bills: [],
  budgets: [], bankTxns: [], taxRecords: [], stockMovements: [],
};
state.pos = { cart: [] };
state.je = { lines: [] };

function finMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Generic CRUD modal ──
const finModalState = { fields: [], onSubmit: null };

function finFieldHtml(f, val) {
  const id = `fm-${f.key}`;
  const span = f.full ? 'grid-column:1 / -1;' : '';
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    return `<div style="${span}"><label class="field-label">${escapeHtml(f.label)}</label><select class="ctrl-select" id="${id}" style="width:100%;" ${f.disabled ? 'disabled' : ''}>${f.placeholder ? `<option value="">${escapeHtml(f.placeholder)}</option>` : ''}${opts}</select></div>`;
  }
  if (f.type === 'textarea') {
    return `<div style="${span}"><label class="field-label">${escapeHtml(f.label)}</label><textarea class="field-input" id="${id}" rows="3" style="width:100%;resize:vertical;">${escapeHtml(val || '')}</textarea></div>`;
  }
  if (f.type === 'checkbox') {
    return `<div style="${span}display:flex;align-items:center;gap:8px;padding-top:18px;"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> <label class="field-label" style="margin:0;" for="${id}">${escapeHtml(f.label)}</label></div>`;
  }
  return `<div style="${span}"><label class="field-label">${escapeHtml(f.label)}</label><input class="field-input" id="${id}" type="${f.type || 'text'}" ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} value="${escapeHtml(val ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}" style="width:100%;" ${f.disabled ? 'disabled' : ''}></div>`;
}

function openFinModal({ title, fields, values = {}, onSubmit, saveLabel }) {
  finModalState.fields = fields;
  finModalState.onSubmit = onSubmit;
  document.getElementById('fin-modal-title').textContent = title;
  document.getElementById('fin-modal-save').textContent = saveLabel || 'Save';
  document.getElementById('fin-modal-body').innerHTML = fields.map(f => finFieldHtml(f, values[f.key])).join('');
  document.getElementById('fin-modal').style.display = 'flex';
}

function closeFinModal() {
  document.getElementById('fin-modal').style.display = 'none';
}

async function submitFinModal() {
  const values = {};
  finModalState.fields.forEach(f => {
    const el = document.getElementById(`fm-${f.key}`);
    if (!el) return;
    if (f.type === 'checkbox') values[f.key] = el.checked;
    else if (f.type === 'number') values[f.key] = el.value === '' ? null : Number(el.value);
    else values[f.key] = el.value;
  });
  try {
    await finModalState.onSubmit(values);
    closeFinModal();
  } catch (err) {
    showToast(err.message);
  }
}

// ── STORE: CATEGORIES ──
async function finLoadCategories() {
  const data = await apiFetch('/api/admin/store/categories');
  state.fin.categories = data.categories;
}

async function finCategoriesInit() {
  try {
    await finLoadCategories();
    finCategoriesRender();
  } catch (err) { showToast(err.message); }
}

function finCategoriesRender() {
  const tbody = document.getElementById('cat-tbody');
  if (!tbody) return;
  const rows = state.fin.categories;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:18px;color:var(--text-3);">No categories yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.description || '-')}</td>
      <td>${c.productCount}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="finDeleteCategory(${c.id})">Delete</button></td>
    </tr>`).join('');
}

async function finSaveCategory() {
  const name = document.getElementById('cat-new-name').value.trim();
  const description = document.getElementById('cat-new-description').value.trim();
  if (!name) return showToast('Category name is required');
  try {
    await apiFetch('/api/admin/store/categories', { method: 'POST', body: JSON.stringify({ name, description }) });
    document.getElementById('cat-new-name').value = '';
    document.getElementById('cat-new-description').value = '';
    await finLoadCategories();
    finCategoriesRender();
    showToast('Category added');
  } catch (err) { showToast(err.message); }
}

async function finDeleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  try {
    await apiFetch(`/api/admin/store/categories/${id}`, { method: 'DELETE' });
    await finLoadCategories();
    finCategoriesRender();
    showToast('Category deleted');
  } catch (err) { showToast(err.message); }
}

// ── STORE: PRODUCTS ──
async function finLoadProducts() {
  const data = await apiFetch('/api/admin/store/products');
  state.fin.products = data.products;
}

async function finProductsInit() {
  try {
    await Promise.all([finLoadCategories(), finLoadProducts()]);
    const filter = document.getElementById('prod-category-filter');
    if (filter) {
      filter.innerHTML = '<option value="">All Categories</option>' + state.fin.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }
    finProductsRender();
  } catch (err) { showToast(err.message); }
}

function finProductsRender() {
  const tbody = document.getElementById('prod-tbody');
  if (!tbody) return;
  const catFilter = document.getElementById('prod-category-filter')?.value || '';
  const search = (document.getElementById('prod-search')?.value || '').toLowerCase();
  const rows = state.fin.products.filter(p => {
    if (catFilter && String(p.categoryId) !== catFilter) return false;
    if (search && !`${p.name} ${p.sku || ''}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:18px;color:var(--text-3);">No products found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.sku || '-')}</td>
      <td>${escapeHtml(p.categoryName || '-')}</td>
      <td>${finMoney(p.price)}</td>
      <td>${finMoney(p.cost)}</td>
      <td>${p.stockQty} ${p.lowStock ? '<span style="color:var(--red);font-weight:700;font-size:10px;">LOW</span>' : ''}</td>
      <td>${p.isActive ? '<span style="color:var(--green,#16a34a);">Active</span>' : '<span style="color:var(--text-3);">Inactive</span>'}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="finOpenProductModal(${p.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteProduct(${p.id})">Delete</button>
      </td>
    </tr>`).join('');
}

function finOpenProductModal(id) {
  const product = id ? state.fin.products.find(p => p.id === id) : null;
  openFinModal({
    title: product ? `Edit Product - ${product.name}` : 'Add Product',
    fields: [
      { key: 'name', label: 'Product Name', full: true },
      { key: 'sku', label: 'SKU' },
      { key: 'categoryId', label: 'Category', type: 'select', placeholder: 'No Category', options: state.fin.categories.map(c => ({ value: c.id, label: c.name })) },
      { key: 'price', label: 'Selling Price', type: 'number', step: '0.01', min: 0 },
      { key: 'cost', label: 'Cost Price', type: 'number', step: '0.01', min: 0 },
      { key: 'unit', label: 'Unit', placeholder: 'piece' },
      ...(product ? [] : [{ key: 'stockQty', label: 'Opening Stock', type: 'number', min: 0 }]),
      { key: 'reorderLevel', label: 'Reorder Level', type: 'number', min: 0 },
      { key: 'isActive', label: 'Active', type: 'checkbox' },
    ],
    values: product ? { ...product } : { unit: 'piece', reorderLevel: 5, isActive: true },
    onSubmit: async (values) => {
      const payload = {
        name: values.name, sku: values.sku, categoryId: values.categoryId || null,
        price: values.price, cost: values.cost, unit: values.unit,
        reorderLevel: values.reorderLevel, isActive: values.isActive,
      };
      if (!product) payload.stockQty = values.stockQty;
      const url = product ? `/api/admin/store/products/${product.id}` : '/api/admin/store/products';
      await apiFetch(url, { method: product ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      await finLoadProducts();
      finProductsRender();
      showToast(`Product ${product ? 'updated' : 'added'}`);
    },
  });
}

async function finDeleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try {
    await apiFetch(`/api/admin/store/products/${id}`, { method: 'DELETE' });
    await finLoadProducts();
    finProductsRender();
    showToast('Product deleted');
  } catch (err) { showToast(err.message); }
}

// ── STORE: INVENTORY & SUPPLY ──
async function finInventoryInit() {
  try {
    await finLoadProducts();
    const data = await apiFetch('/api/admin/store/stock-movements');
    state.fin.stockMovements = data.movements;
    finInventoryRender();
  } catch (err) { showToast(err.message); }
}

function finInventoryRender() {
  const tbody = document.getElementById('inv-tbody');
  if (tbody) {
    const lowOnly = document.getElementById('inv-low-only')?.checked;
    const search = (document.getElementById('inv-search')?.value || '').toLowerCase();
    const rows = state.fin.products.filter(p => {
      if (lowOnly && !p.lowStock) return false;
      if (search && !p.name.toLowerCase().includes(search)) return false;
      return true;
    });
    tbody.innerHTML = rows.length ? rows.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.stockQty}</td>
        <td>${p.reorderLevel}</td>
        <td>${p.lowStock ? '<span style="color:var(--red);font-weight:700;">Low Stock</span>' : '<span style="color:var(--green,#16a34a);">OK</span>'}</td>
        <td><button class="post-btn" style="padding:6px 10px;" onclick="finOpenStockAdjustModal(${p.id})">Adjust Stock</button></td>
      </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No products found.</td></tr>';
  }
  const mv = document.getElementById('inv-movements-tbody');
  if (mv) {
    mv.innerHTML = state.fin.stockMovements.length ? state.fin.stockMovements.map(m => `
      <tr>
        <td>${new Date(m.createdAt).toLocaleString()}</td>
        <td>${escapeHtml(m.productName)}</td>
        <td style="color:${m.changeQty < 0 ? 'var(--red)' : 'var(--green,#16a34a)'};font-weight:700;">${m.changeQty > 0 ? '+' : ''}${m.changeQty}</td>
        <td>${escapeHtml(m.reason || '-')}</td>
      </tr>`).join('') : '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No stock movements yet.</td></tr>';
  }
}

function finOpenStockAdjustModal(productId) {
  const product = state.fin.products.find(p => p.id === productId);
  if (!product) return;
  openFinModal({
    title: `Adjust Stock - ${product.name} (current: ${product.stockQty})`,
    fields: [
      { key: 'delta', label: 'Quantity Change (use negative to remove)', type: 'number', full: true },
      { key: 'reason', label: 'Reason', full: true, placeholder: 'e.g. New delivery, damaged stock, stock count correction' },
    ],
    values: { delta: '', reason: '' },
    onSubmit: async (values) => {
      await apiFetch(`/api/admin/store/products/${productId}/stock-adjust`, { method: 'POST', body: JSON.stringify(values) });
      await finInventoryInit();
      finProductsRender();
      showToast('Stock adjusted');
    },
  });
}

// ── STORE: ORDERS & SALES ──
async function finLoadOrders() {
  const data = await apiFetch('/api/admin/store/orders');
  state.fin.orders = data.orders;
}

async function finOrdersInit() {
  try {
    await finLoadOrders();
    finOrdersRender();
  } catch (err) { showToast(err.message); }
}

function finOrdersRender() {
  const tbody = document.getElementById('os-tbody');
  if (!tbody) return;
  const search = (document.getElementById('os-search')?.value || '').toLowerCase();
  const rows = state.fin.orders.filter(o => !search || `${o.orderNo} ${o.customerName || ''}`.toLowerCase().includes(search));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:18px;color:var(--text-3);">No orders yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(o => `
    <tr>
      <td>${escapeHtml(o.orderNo)}</td>
      <td>${new Date(o.createdAt).toLocaleDateString()}</td>
      <td>${escapeHtml(o.customerName || '-')}</td>
      <td>${escapeHtml(o.channel)}</td>
      <td>${o.itemCount}</td>
      <td>${finMoney(o.total)}</td>
      <td>${escapeHtml(o.paymentMethod || '-')}</td>
      <td>${escapeHtml(o.status)}</td>
      <td><button class="post-btn" style="padding:6px 10px;" onclick="finViewOrder(${o.id})">View</button></td>
    </tr>`).join('');
}

async function finViewOrder(id) {
  try {
    const data = await apiFetch(`/api/admin/store/orders/${id}`);
    const lines = data.items.map(it => `${it.qty} x ${it.productName} @ ${finMoney(it.unitPrice)} = ${finMoney(it.lineTotal)}`).join('\n');
    alert(`Order ${data.order.orderNo}\nCustomer: ${data.order.customerName || '-'}\nDate: ${new Date(data.order.createdAt).toLocaleString()}\n\n${lines}\n\nSubtotal: ${finMoney(data.order.subtotal)}\nDiscount: ${finMoney(data.order.discount)}\nTotal: ${finMoney(data.order.total)}`);
  } catch (err) { showToast(err.message); }
}

// ── STORE: POS TERMINAL ──
async function finPosInit() {
  try {
    await finLoadProducts();
    state.pos.cart = [];
    document.getElementById('pos-customer-name').value = '';
    document.getElementById('pos-discount').value = 0;
    finPosRenderProducts();
    finPosRenderCart();
  } catch (err) { showToast(err.message); }
}

function finPosRenderProducts() {
  const grid = document.getElementById('pos-products-grid');
  if (!grid) return;
  const search = (document.getElementById('pos-search')?.value || '').toLowerCase();
  const rows = state.fin.products.filter(p => p.isActive && (!search || `${p.name} ${p.sku || ''}`.toLowerCase().includes(search)));
  grid.innerHTML = rows.length ? rows.map(p => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;${p.stockQty <= 0 ? 'opacity:.5;pointer-events:none;' : ''}" onclick="finPosAddToCart(${p.id})">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHtml(p.name)}</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:4px;">${escapeHtml(p.sku || '')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--blue,#2563eb);">${finMoney(p.price)}</div>
      <div style="font-size:10px;color:var(--text-3);">Stock: ${p.stockQty}</div>
    </div>`).join('') : '<div style="padding:20px;color:var(--text-3);grid-column:1 / -1;">No products found.</div>';
}

function finPosAddToCart(productId) {
  const product = state.fin.products.find(p => p.id === productId);
  if (!product) return;
  const existing = state.pos.cart.find(c => c.productId === productId);
  const currentQty = existing ? existing.qty : 0;
  if (currentQty + 1 > product.stockQty) return showToast(`Only ${product.stockQty} in stock`);
  if (existing) existing.qty += 1;
  else state.pos.cart.push({ productId, name: product.name, price: product.price, qty: 1 });
  finPosRenderCart();
}

function finPosSetQty(productId, qty) {
  const product = state.fin.products.find(p => p.id === productId);
  const item = state.pos.cart.find(c => c.productId === productId);
  if (!item) return;
  qty = Math.max(0, Number(qty) || 0);
  if (product && qty > product.stockQty) { showToast(`Only ${product.stockQty} in stock`); qty = product.stockQty; }
  if (qty === 0) state.pos.cart = state.pos.cart.filter(c => c.productId !== productId);
  else item.qty = qty;
  finPosRenderCart();
}

function finPosRenderCart() {
  const tbody = document.getElementById('pos-cart-tbody');
  if (!tbody) return;
  if (!state.pos.cart.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:14px;color:var(--text-3);">Cart is empty</td></tr>';
  } else {
    tbody.innerHTML = state.pos.cart.map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><input type="number" min="0" value="${c.qty}" style="width:56px;" onchange="finPosSetQty(${c.productId}, this.value)"></td>
        <td>${finMoney(c.price * c.qty)}</td>
        <td><button class="ann-del" style="color:var(--red);" onclick="finPosSetQty(${c.productId}, 0)">Remove</button></td>
      </tr>`).join('');
  }
  const subtotal = state.pos.cart.reduce((s, c) => s + c.price * c.qty, 0);
  const discount = Math.max(0, Number(document.getElementById('pos-discount')?.value) || 0);
  const total = Math.max(0, subtotal - discount);
  document.getElementById('pos-subtotal').textContent = finMoney(subtotal);
  document.getElementById('pos-total').textContent = finMoney(total);
}

async function finPosCheckout() {
  if (!state.pos.cart.length) return showToast('Cart is empty');
  const payload = {
    items: state.pos.cart.map(c => ({ productId: c.productId, qty: c.qty })),
    customerName: document.getElementById('pos-customer-name').value.trim() || 'Walk-in Customer',
    discount: Number(document.getElementById('pos-discount').value) || 0,
    paymentMethod: document.getElementById('pos-payment-method').value,
    channel: 'pos',
  };
  try {
    const data = await apiFetch('/api/admin/store/orders', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Sale recorded: ${data.orderNo}`);
    state.pos.cart = [];
    await finLoadProducts();
    finPosRenderProducts();
    finPosRenderCart();
  } catch (err) { showToast(err.message); }
}

// ── STORE: INTERNAL REQUISITIONS ──
async function finLoadRequisitions() {
  const data = await apiFetch('/api/admin/store/requisitions');
  state.fin.requisitions = data.requisitions;
}

async function finRequisitionsInit() {
  try {
    await finLoadRequisitions();
    finRequisitionsRender();
  } catch (err) { showToast(err.message); }
}

function finRequisitionsRender() {
  const tbody = document.getElementById('req-tbody');
  if (!tbody) return;
  const statusFilter = document.getElementById('req-status-filter')?.value || '';
  const rows = state.fin.requisitions.filter(r => !statusFilter || r.status === statusFilter);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:18px;color:var(--text-3);">No requisitions found.</td></tr>';
    return;
  }
  const statusColor = { pending: 'var(--text-2)', approved: '#2563eb', rejected: 'var(--red)', fulfilled: 'var(--green,#16a34a)' };
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.itemDescription)}</td>
      <td>${r.quantity}</td>
      <td>${escapeHtml(r.department || '-')}</td>
      <td>${escapeHtml(r.requestedByName || r.requestedBy || '-')}</td>
      <td style="color:${statusColor[r.status] || 'var(--text-2)'};font-weight:700;text-transform:capitalize;">${escapeHtml(r.status)}</td>
      <td>
        ${r.status === 'pending' ? `
          <button class="post-btn" style="padding:6px 10px;" onclick="finSetRequisitionStatus(${r.id}, 'approved')">Approve</button>
          <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finSetRequisitionStatus(${r.id}, 'rejected')">Reject</button>
        ` : ''}
        ${r.status === 'approved' ? `<button class="post-btn" style="padding:6px 10px;" onclick="finSetRequisitionStatus(${r.id}, 'fulfilled')">Mark Fulfilled</button>` : ''}
      </td>
    </tr>`).join('');
}

function finOpenRequisitionModal() {
  openFinModal({
    title: 'New Requisition',
    fields: [
      { key: 'itemDescription', label: 'Item Description', full: true },
      { key: 'quantity', label: 'Quantity', type: 'number', min: 1 },
      { key: 'department', label: 'Department' },
      { key: 'reason', label: 'Reason', full: true, type: 'textarea' },
    ],
    values: {},
    onSubmit: async (values) => {
      await apiFetch('/api/admin/store/requisitions', { method: 'POST', body: JSON.stringify(values) });
      await finLoadRequisitions();
      finRequisitionsRender();
      showToast('Requisition submitted');
    },
  });
}

async function finSetRequisitionStatus(id, status) {
  try {
    await apiFetch(`/api/admin/store/requisitions/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    await finLoadRequisitions();
    finRequisitionsRender();
    showToast(`Requisition ${status}`);
  } catch (err) { showToast(err.message); }
}

// ── STORE: SETTINGS ──
async function finStoreSettingsInit() {
  try {
    const data = await apiFetch('/api/admin/store/settings');
    state.fin.settings = data;
    document.getElementById('ss-store-name').value = data.storeName;
    document.getElementById('ss-currency').value = data.currency;
    document.getElementById('ss-low-stock').value = data.lowStockThreshold;
    document.getElementById('ss-tax-rate').value = data.taxRate;
    document.getElementById('ss-contact-email').value = data.contactEmail;
  } catch (err) { showToast(err.message); }
}

async function finSaveStoreSettings() {
  const payload = {
    storeName: document.getElementById('ss-store-name').value.trim(),
    currency: document.getElementById('ss-currency').value.trim(),
    lowStockThreshold: Number(document.getElementById('ss-low-stock').value) || 0,
    taxRate: Number(document.getElementById('ss-tax-rate').value) || 0,
    contactEmail: document.getElementById('ss-contact-email').value.trim(),
  };
  try {
    await apiFetch('/api/admin/store/settings', { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Store settings saved');
  } catch (err) { showToast(err.message); }
}

// ── STORE: BANNERS ──
async function finLoadBanners() {
  const data = await apiFetch('/api/admin/store/banners');
  state.fin.banners = data.banners;
}

async function finBannersInit() {
  try { await finLoadBanners(); finBannersRender(); } catch (err) { showToast(err.message); }
}

function finBannersRender() {
  const tbody = document.getElementById('ban-tbody');
  if (!tbody) return;
  const rows = state.fin.banners;
  tbody.innerHTML = rows.length ? rows.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(b.title)}</strong></td>
      <td>${escapeHtml(b.subtitle || '-')}</td>
      <td>${b.sortOrder}</td>
      <td>${b.isActive ? '<span style="color:var(--green,#16a34a);">Active</span>' : '<span style="color:var(--text-3);">Inactive</span>'}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="finOpenBannerModal(${b.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteBanner(${b.id})">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No banners yet.</td></tr>';
}

function finOpenBannerModal(id) {
  const banner = id ? state.fin.banners.find(b => b.id === id) : null;
  openFinModal({
    title: banner ? 'Edit Banner' : 'Add Banner',
    fields: [
      { key: 'title', label: 'Title', full: true },
      { key: 'subtitle', label: 'Subtitle', full: true },
      { key: 'imageUrl', label: 'Image URL', full: true },
      { key: 'linkUrl', label: 'Link URL', full: true },
      { key: 'sortOrder', label: 'Sort Order', type: 'number' },
      { key: 'isActive', label: 'Active', type: 'checkbox' },
    ],
    values: banner || { sortOrder: 0, isActive: true },
    onSubmit: async (values) => {
      const url = banner ? `/api/admin/store/banners/${banner.id}` : '/api/admin/store/banners';
      await apiFetch(url, { method: banner ? 'PUT' : 'POST', body: JSON.stringify(values) });
      await finLoadBanners();
      finBannersRender();
      showToast(`Banner ${banner ? 'updated' : 'added'}`);
    },
  });
}

async function finDeleteBanner(id) {
  if (!confirm('Delete this banner?')) return;
  try {
    await apiFetch(`/api/admin/store/banners/${id}`, { method: 'DELETE' });
    await finLoadBanners();
    finBannersRender();
    showToast('Banner deleted');
  } catch (err) { showToast(err.message); }
}

// ── STORE: HOMEPAGE SECTIONS ──
async function finLoadSections() {
  const data = await apiFetch('/api/admin/store/homepage-sections');
  state.fin.sections = data.sections;
}

async function finSectionsInit() {
  try { await finLoadSections(); finSectionsRender(); } catch (err) { showToast(err.message); }
}

function finSectionsRender() {
  const tbody = document.getElementById('sec-tbody');
  if (!tbody) return;
  const rows = state.fin.sections;
  tbody.innerHTML = rows.length ? rows.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(s.title)}</strong></td>
      <td>${escapeHtml(s.sectionType)}</td>
      <td>${s.sortOrder}</td>
      <td>${s.isActive ? '<span style="color:var(--green,#16a34a);">Active</span>' : '<span style="color:var(--text-3);">Inactive</span>'}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="finOpenSectionModal(${s.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteSection(${s.id})">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No homepage sections yet.</td></tr>';
}

function finOpenSectionModal(id) {
  const section = id ? state.fin.sections.find(s => s.id === id) : null;
  openFinModal({
    title: section ? 'Edit Section' : 'Add Section',
    fields: [
      { key: 'title', label: 'Title', full: true },
      { key: 'sectionType', label: 'Type', placeholder: 'e.g. featured, promo, custom' },
      { key: 'sortOrder', label: 'Sort Order', type: 'number' },
      { key: 'content', label: 'Content', full: true, type: 'textarea' },
      { key: 'isActive', label: 'Active', type: 'checkbox' },
    ],
    values: section || { sectionType: 'custom', sortOrder: 0, isActive: true },
    onSubmit: async (values) => {
      const url = section ? `/api/admin/store/homepage-sections/${section.id}` : '/api/admin/store/homepage-sections';
      await apiFetch(url, { method: section ? 'PUT' : 'POST', body: JSON.stringify(values) });
      await finLoadSections();
      finSectionsRender();
      showToast(`Section ${section ? 'updated' : 'added'}`);
    },
  });
}

async function finDeleteSection(id) {
  if (!confirm('Delete this section?')) return;
  try {
    await apiFetch(`/api/admin/store/homepage-sections/${id}`, { method: 'DELETE' });
    await finLoadSections();
    finSectionsRender();
    showToast('Section deleted');
  } catch (err) { showToast(err.message); }
}

// ── STORE: VISIT STOREFRONT (live read-only preview) ──
async function finVisitStorefrontInit() {
  try {
    state.fin.storefront = await apiFetch('/api/admin/store/storefront');
    document.getElementById('vs-store-name').textContent = state.fin.storefront.storeName;
    const catFilter = document.getElementById('vs-category-filter');
    catFilter.innerHTML = '<option value="">All Categories</option>' + state.fin.storefront.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const bannerCard = document.getElementById('vs-banner-card');
    const bannerBody = document.getElementById('vs-banner-body');
    if (state.fin.storefront.banners.length) {
      bannerCard.style.display = '';
      bannerBody.innerHTML = state.fin.storefront.banners.map(b => `<div style="margin-bottom:8px;"><div style="font-size:16px;font-weight:700;">${escapeHtml(b.title)}</div>${b.subtitle ? `<div style="font-size:12px;opacity:.9;">${escapeHtml(b.subtitle)}</div>` : ''}</div>`).join('');
    } else {
      bannerCard.style.display = 'none';
    }
    const sections = document.getElementById('vs-sections');
    sections.innerHTML = state.fin.storefront.sections.map(s => `
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${escapeHtml(s.title)}</div>
        <div style="font-size:12px;color:var(--text-2);">${escapeHtml(s.content || '')}</div>
      </div>`).join('');
    finVisitStorefrontRender();
  } catch (err) { showToast(err.message); }
}

function finVisitStorefrontRender() {
  const grid = document.getElementById('vs-products-grid');
  const empty = document.getElementById('vs-empty');
  if (!grid || !state.fin.storefront) return;
  const catFilter = document.getElementById('vs-category-filter')?.value || '';
  const search = (document.getElementById('vs-search')?.value || '').toLowerCase();
  const rows = state.fin.storefront.products.filter(p => {
    if (catFilter && String(p.categoryId) !== catFilter) return false;
    if (search && !p.name.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    grid.style.display = 'none';
    empty.style.display = '';
    return;
  }
  grid.style.display = '';
  empty.style.display = 'none';
  grid.innerHTML = rows.map(p => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;">
      <div style="height:80px;background:var(--black-3,#1a1a1a);border-radius:6px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:10px;">${escapeHtml(p.categoryName || 'Product')}</div>
      <div style="font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHtml(p.name)}</div>
      <div style="font-size:13px;font-weight:700;color:var(--blue,#2563eb);">${finMoney(p.price)}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px;">${p.stockQty > 0 ? 'In stock' : 'Out of stock'}</div>
    </div>`).join('');
}

// ── ACCOUNTING: CHART OF ACCOUNTS ──
async function finLoadAccounts() {
  const data = await apiFetch('/api/admin/acct/accounts');
  state.fin.accounts = data.accounts;
}

async function finAccountsInit() {
  try { await finLoadAccounts(); finAccountsRender(); } catch (err) { showToast(err.message); }
}

function finAccountsRender() {
  const tbody = document.getElementById('coa-tbody');
  if (!tbody) return;
  const typeFilter = document.getElementById('coa-type-filter')?.value || '';
  const search = (document.getElementById('coa-search')?.value || '').toLowerCase();
  const rows = state.fin.accounts.filter(a => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (search && !`${a.code} ${a.name}`.toLowerCase().includes(search)) return false;
    return true;
  });
  tbody.innerHTML = rows.length ? rows.map(a => `
    <tr>
      <td>${escapeHtml(a.code)}</td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td style="text-transform:capitalize;">${escapeHtml(a.type)}</td>
      <td style="text-transform:capitalize;">${escapeHtml(a.normalBalance)}</td>
      <td>${a.isActive ? '<span style="color:var(--green,#16a34a);">Active</span>' : '<span style="color:var(--text-3);">Inactive</span>'}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="finOpenAccountModal(${a.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteAccount(${a.id})">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No accounts found.</td></tr>';
}

const FIN_ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

function finOpenAccountModal(id) {
  const account = id ? state.fin.accounts.find(a => a.id === id) : null;
  openFinModal({
    title: account ? `Edit Account - ${account.name}` : 'Add Account',
    fields: [
      { key: 'code', label: 'Account Code', disabled: !!account },
      { key: 'name', label: 'Account Name' },
      { key: 'type', label: 'Type', type: 'select', options: FIN_ACCOUNT_TYPES, disabled: !!account },
      { key: 'normalBalance', label: 'Normal Balance', type: 'select', options: [{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }], disabled: !!account },
      { key: 'isActive', label: 'Active', type: 'checkbox' },
    ],
    values: account || { isActive: true },
    onSubmit: async (values) => {
      if (account) {
        await apiFetch(`/api/admin/acct/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify(values) });
      } else {
        await apiFetch('/api/admin/acct/accounts', { method: 'POST', body: JSON.stringify(values) });
      }
      await finLoadAccounts();
      finAccountsRender();
      showToast(`Account ${account ? 'updated' : 'added'}`);
    },
  });
}

async function finDeleteAccount(id) {
  if (!confirm('Delete this account?')) return;
  try {
    await apiFetch(`/api/admin/acct/accounts/${id}`, { method: 'DELETE' });
    await finLoadAccounts();
    finAccountsRender();
    showToast('Account deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: JOURNAL ENTRIES ──
async function finLoadJournalEntries() {
  const data = await apiFetch('/api/admin/acct/journal-entries');
  state.fin.journalEntries = data.entries;
}

async function finJournalInit() {
  try {
    await Promise.all([finLoadAccounts(), finLoadJournalEntries()]);
    document.getElementById('je-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('je-memo').value = '';
    state.je.lines = [{ accountId: '', debit: '', credit: '', description: '' }, { accountId: '', debit: '', credit: '', description: '' }];
    finRenderJournalLines();
    finJournalEntriesRender();
  } catch (err) { showToast(err.message); }
}

function finAccountOptionsHtml(selected) {
  return '<option value="">Select Account</option>' + state.fin.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`).join('');
}

function finAddJournalLine() {
  state.je.lines.push({ accountId: '', debit: '', credit: '', description: '' });
  finRenderJournalLines();
}

function finRemoveJournalLine(index) {
  state.je.lines.splice(index, 1);
  finRenderJournalLines();
}

function finUpdateJournalLine(index, key, value) {
  state.je.lines[index][key] = value;
  if (key === 'debit' && value) state.je.lines[index].credit = '';
  if (key === 'credit' && value) state.je.lines[index].debit = '';
  finRenderJournalLines(true);
}

function finRenderJournalLines(skipFullRerender) {
  const tbody = document.getElementById('je-lines-tbody');
  if (!tbody) return;
  if (!skipFullRerender) {
    tbody.innerHTML = state.je.lines.map((line, i) => `
      <tr>
        <td><select class="ctrl-select" style="width:100%;" onchange="finUpdateJournalLine(${i}, 'accountId', this.value)">${finAccountOptionsHtml(line.accountId)}</select></td>
        <td><input class="field-input" style="width:100%;" value="${escapeHtml(line.description)}" onchange="finUpdateJournalLine(${i}, 'description', this.value)"></td>
        <td><input class="field-input" type="number" min="0" step="0.01" style="width:100%;" value="${line.debit}" onchange="finUpdateJournalLine(${i}, 'debit', this.value)"></td>
        <td><input class="field-input" type="number" min="0" step="0.01" style="width:100%;" value="${line.credit}" onchange="finUpdateJournalLine(${i}, 'credit', this.value)"></td>
        <td>${state.je.lines.length > 2 ? `<button class="ann-del" style="color:var(--red);" onclick="finRemoveJournalLine(${i})">Remove</button>` : ''}</td>
      </tr>`).join('');
  }
  const totalDebit = state.je.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = state.je.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  document.getElementById('je-total-debit').textContent = finMoney(totalDebit);
  document.getElementById('je-total-credit').textContent = finMoney(totalCredit);
  const flag = document.getElementById('je-balance-flag');
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  flag.textContent = totalDebit === 0 && totalCredit === 0 ? '' : (balanced ? 'Balanced' : 'Not balanced');
  flag.style.color = balanced ? 'var(--green,#16a34a)' : 'var(--red)';
}

async function finSaveJournalEntry() {
  const date = document.getElementById('je-date').value;
  const memo = document.getElementById('je-memo').value.trim();
  const lines = state.je.lines
    .filter(l => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
    .map(l => ({ accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description }));
  if (lines.length < 2) return showToast('A journal entry needs at least two complete lines');
  try {
    const data = await apiFetch('/api/admin/acct/journal-entries', { method: 'POST', body: JSON.stringify({ date, memo, lines }) });
    showToast(`Journal entry posted: ${data.entryNo}`);
    document.getElementById('je-memo').value = '';
    state.je.lines = [{ accountId: '', debit: '', credit: '', description: '' }, { accountId: '', debit: '', credit: '', description: '' }];
    finRenderJournalLines();
    await finLoadJournalEntries();
    finJournalEntriesRender();
  } catch (err) { showToast(err.message); }
}

function finJournalEntriesRender() {
  const tbody = document.getElementById('je-entries-tbody');
  if (!tbody) return;
  const rows = state.fin.journalEntries;
  tbody.innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td>${escapeHtml(e.entryNo)}</td>
      <td>${escapeHtml(e.entryDate)}</td>
      <td>${escapeHtml(e.memo || '-')}</td>
      <td>${e.lines.length}</td>
      <td>${finMoney(e.totalDebit)}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="finDeleteJournalEntry(${e.id})">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No journal entries posted yet.</td></tr>';
}

async function finDeleteJournalEntry(id) {
  if (!confirm('Delete this journal entry? This cannot be undone.')) return;
  try {
    await apiFetch(`/api/admin/acct/journal-entries/${id}`, { method: 'DELETE' });
    await finLoadJournalEntries();
    finJournalEntriesRender();
    showToast('Journal entry deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: LEDGER ──
async function finLedgerInit() {
  try {
    await finLoadAccounts();
    const select = document.getElementById('ledger-account');
    const previous = select.value;
    select.innerHTML = '<option value="">Select Account</option>' + state.fin.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`).join('');
    if (previous) select.value = previous;
    finLedgerRender();
  } catch (err) { showToast(err.message); }
}

async function finLedgerRender() {
  const accountId = document.getElementById('ledger-account')?.value;
  const tbody = document.getElementById('ledger-tbody');
  const summary = document.getElementById('ledger-summary');
  if (!accountId) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">Select an account to view its ledger.</td></tr>';
    summary.style.display = 'none';
    return;
  }
  try {
    const data = await apiFetch(`/api/admin/acct/ledger?accountId=${accountId}`);
    summary.style.display = '';
    summary.innerHTML = `<strong>${escapeHtml(data.account.code)} - ${escapeHtml(data.account.name)}</strong> &nbsp;|&nbsp; Closing balance: <strong>${finMoney(data.closingBalance)}</strong> (${escapeHtml(data.account.normalBalance)} normal)`;
    tbody.innerHTML = data.lines.length ? data.lines.map(l => `
      <tr>
        <td>${escapeHtml(l.entryDate)}</td>
        <td>${escapeHtml(l.entryNo)}</td>
        <td>${escapeHtml(l.description || l.entryMemo || '-')}</td>
        <td>${l.debit ? finMoney(l.debit) : '-'}</td>
        <td>${l.credit ? finMoney(l.credit) : '-'}</td>
        <td>${finMoney(l.runningBalance)}</td>
      </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No activity on this account yet.</td></tr>';
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: TRIAL BALANCE ──
async function finTrialBalanceInit() {
  try {
    const data = await apiFetch('/api/admin/acct/trial-balance');
    const tbody = document.getElementById('tb-tbody');
    tbody.innerHTML = data.accounts.map(a => `
      <tr>
        <td>${escapeHtml(a.code)}</td>
        <td>${escapeHtml(a.name)}</td>
        <td style="text-transform:capitalize;">${escapeHtml(a.type)}</td>
        <td>${a.totalDebit ? finMoney(a.totalDebit) : '-'}</td>
        <td>${a.totalCredit ? finMoney(a.totalCredit) : '-'}</td>
      </tr>`).join('');
    document.getElementById('tb-total-debit').textContent = finMoney(data.totalDebit);
    document.getElementById('tb-total-credit').textContent = finMoney(data.totalCredit);
    const flag = document.getElementById('tb-balance-flag');
    flag.textContent = data.balanced ? 'Balanced' : 'Not Balanced';
    flag.style.color = data.balanced ? 'var(--green,#16a34a)' : 'var(--red)';
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: CONTACTS, BILLS & INVOICES ──
async function finLoadContacts() {
  const data = await apiFetch('/api/admin/acct/contacts');
  state.fin.contacts = data.contacts;
}
async function finLoadBills() {
  const data = await apiFetch('/api/admin/acct/bills');
  state.fin.bills = data.bills;
}

async function finContactsBillsInit() {
  try {
    await Promise.all([finLoadContacts(), finLoadBills()]);
    finContactsRender();
    finBillsRender();
  } catch (err) { showToast(err.message); }
}

function finContactsRender() {
  const tbody = document.getElementById('con-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.fin.contacts.length ? state.fin.contacts.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td style="text-transform:capitalize;">${escapeHtml(c.type)}</td>
      <td>${escapeHtml(c.email || '-')}</td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="finOpenContactModal(${c.id})">Edit</button>
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteContact(${c.id})">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No contacts yet.</td></tr>';
}

function finOpenContactModal(id) {
  const contact = id ? state.fin.contacts.find(c => c.id === id) : null;
  openFinModal({
    title: contact ? 'Edit Contact' : 'Add Contact',
    fields: [
      { key: 'name', label: 'Name', full: true },
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'vendor', label: 'Vendor' }, { value: 'customer', label: 'Customer' }] },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address', full: true, type: 'textarea' },
    ],
    values: contact || { type: 'vendor' },
    onSubmit: async (values) => {
      const url = contact ? `/api/admin/acct/contacts/${contact.id}` : '/api/admin/acct/contacts';
      await apiFetch(url, { method: contact ? 'PUT' : 'POST', body: JSON.stringify(values) });
      await finLoadContacts();
      finContactsRender();
      showToast(`Contact ${contact ? 'updated' : 'added'}`);
    },
  });
}

async function finDeleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try {
    await apiFetch(`/api/admin/acct/contacts/${id}`, { method: 'DELETE' });
    await finLoadContacts();
    finContactsRender();
    showToast('Contact deleted');
  } catch (err) { showToast(err.message); }
}

function finBillsRender() {
  const tbody = document.getElementById('bill-tbody');
  if (!tbody) return;
  const statusFilter = document.getElementById('bill-status-filter')?.value || '';
  const rows = state.fin.bills.filter(b => !statusFilter || b.status === statusFilter);
  const statusColor = { unpaid: 'var(--text-2)', paid: 'var(--green,#16a34a)', overdue: 'var(--red)' };
  tbody.innerHTML = rows.length ? rows.map(b => `
    <tr>
      <td>${escapeHtml(b.docNo || '-')}</td>
      <td style="text-transform:capitalize;">${escapeHtml(b.docType)}</td>
      <td>${escapeHtml(b.contactName || '-')}</td>
      <td>${escapeHtml(b.issueDate)}</td>
      <td>${escapeHtml(b.dueDate || '-')}</td>
      <td>${finMoney(b.amount)}</td>
      <td style="color:${statusColor[b.status] || 'var(--text-2)'};font-weight:700;text-transform:capitalize;">${escapeHtml(b.status)}</td>
      <td>
        ${b.status !== 'paid' ? `<button class="post-btn" style="padding:6px 10px;" onclick="finMarkBillPaid(${b.id})">Mark Paid</button>` : ''}
        <button class="ann-del" style="color:var(--red);margin-left:6px;" onclick="finDeleteBill(${b.id})">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="8" style="padding:18px;color:var(--text-3);">No bills or invoices yet.</td></tr>';
}

function finOpenBillModal() {
  openFinModal({
    title: 'Add Bill / Invoice',
    fields: [
      { key: 'docType', label: 'Type', type: 'select', options: [{ value: 'bill', label: 'Bill (we owe)' }, { value: 'invoice', label: 'Invoice (owed to us)' }] },
      { key: 'contactId', label: 'Contact', type: 'select', placeholder: 'No contact', options: state.fin.contacts.map(c => ({ value: c.id, label: c.name })) },
      { key: 'docNo', label: 'Document #' },
      { key: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0 },
      { key: 'issueDate', label: 'Issue Date', type: 'date' },
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }] },
      { key: 'notes', label: 'Notes', full: true, type: 'textarea' },
    ],
    values: { docType: 'bill', issueDate: new Date().toISOString().slice(0, 10), status: 'unpaid' },
    onSubmit: async (values) => {
      await apiFetch('/api/admin/acct/bills', { method: 'POST', body: JSON.stringify(values) });
      await finLoadBills();
      finBillsRender();
      showToast('Bill / invoice added');
    },
  });
}

async function finMarkBillPaid(id) {
  const bill = state.fin.bills.find(b => b.id === id);
  if (!bill) return;
  try {
    await apiFetch(`/api/admin/acct/bills/${id}`, { method: 'PUT', body: JSON.stringify({ ...bill, status: 'paid' }) });
    await finLoadBills();
    finBillsRender();
    showToast('Marked as paid');
  } catch (err) { showToast(err.message); }
}

async function finDeleteBill(id) {
  if (!confirm('Delete this bill / invoice?')) return;
  try {
    await apiFetch(`/api/admin/acct/bills/${id}`, { method: 'DELETE' });
    await finLoadBills();
    finBillsRender();
    showToast('Deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: BUDGETS ──
async function finLoadBudgets() {
  const data = await apiFetch('/api/admin/acct/budgets');
  state.fin.budgets = data.budgets;
}

async function finBudgetsInit() {
  try {
    await Promise.all([finLoadAccounts(), finLoadBudgets()]);
    finBudgetsRender();
  } catch (err) { showToast(err.message); }
}

function finBudgetsRender() {
  const tbody = document.getElementById('bud-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.fin.budgets.length ? state.fin.budgets.map(b => `
    <tr>
      <td>${escapeHtml(b.periodLabel)}</td>
      <td>${escapeHtml(b.accountCode)} - ${escapeHtml(b.accountName)}</td>
      <td>${finMoney(b.amount)}</td>
      <td>${finMoney(b.actual)}</td>
      <td style="color:${b.variance >= 0 ? 'var(--green,#16a34a)' : 'var(--red)'};font-weight:700;">${finMoney(b.variance)}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="finDeleteBudget(${b.id})">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No budgets yet.</td></tr>';
}

function finOpenBudgetModal() {
  openFinModal({
    title: 'Add Budget',
    fields: [
      { key: 'accountId', label: 'Account', type: 'select', options: state.fin.accounts.map(a => ({ value: a.id, label: `${a.code} - ${a.name}` })) },
      { key: 'periodLabel', label: 'Period', placeholder: 'e.g. 2025/2026 Term 2' },
      { key: 'amount', label: 'Budgeted Amount', type: 'number', step: '0.01', min: 0 },
      { key: 'notes', label: 'Notes', full: true, type: 'textarea' },
    ],
    values: {},
    onSubmit: async (values) => {
      await apiFetch('/api/admin/acct/budgets', { method: 'POST', body: JSON.stringify(values) });
      await finLoadBudgets();
      finBudgetsRender();
      showToast('Budget added');
    },
  });
}

async function finDeleteBudget(id) {
  if (!confirm('Delete this budget?')) return;
  try {
    await apiFetch(`/api/admin/acct/budgets/${id}`, { method: 'DELETE' });
    await finLoadBudgets();
    finBudgetsRender();
    showToast('Budget deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: BANK RECONCILIATION ──
async function finLoadBankTxns() {
  const data = await apiFetch('/api/admin/acct/bank-transactions');
  state.fin.bankTxns = data.transactions;
}

async function finBankRecInit() {
  try { await finLoadBankTxns(); finBankRecRender(); } catch (err) { showToast(err.message); }
}

function finBankRecRender() {
  const tbody = document.getElementById('bank-tbody');
  if (!tbody) return;
  const rows = state.fin.bankTxns;
  tbody.innerHTML = rows.length ? rows.map(t => `
    <tr>
      <td>${escapeHtml(t.txnDate)}</td>
      <td>${escapeHtml(t.description || '-')}</td>
      <td style="text-transform:capitalize;">${escapeHtml(t.txnType)}</td>
      <td>${finMoney(t.amount)}</td>
      <td><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" ${t.reconciled ? 'checked' : ''} onchange="finToggleReconciled(${t.id}, this.checked)"> ${t.reconciled ? 'Reconciled' : 'Pending'}</label></td>
      <td><button class="ann-del" style="color:var(--red);" onclick="finDeleteBankTxn(${t.id})">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No bank transactions yet.</td></tr>';
  const reconciledCount = rows.filter(t => t.reconciled).length;
  document.getElementById('bank-summary').textContent = `${reconciledCount} of ${rows.length} transactions reconciled`;
}

function finOpenBankTxnModal() {
  openFinModal({
    title: 'Add Bank Transaction',
    fields: [
      { key: 'txnDate', label: 'Date', type: 'date' },
      { key: 'txnType', label: 'Type', type: 'select', options: [{ value: 'debit', label: 'Debit (money in)' }, { value: 'credit', label: 'Credit (money out)' }] },
      { key: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0 },
      { key: 'description', label: 'Description', full: true },
    ],
    values: { txnDate: new Date().toISOString().slice(0, 10) },
    onSubmit: async (values) => {
      await apiFetch('/api/admin/acct/bank-transactions', { method: 'POST', body: JSON.stringify(values) });
      await finLoadBankTxns();
      finBankRecRender();
      showToast('Transaction added');
    },
  });
}

async function finToggleReconciled(id, reconciled) {
  try {
    await apiFetch(`/api/admin/acct/bank-transactions/${id}`, { method: 'PUT', body: JSON.stringify({ reconciled }) });
    await finLoadBankTxns();
    finBankRecRender();
  } catch (err) { showToast(err.message); }
}

async function finDeleteBankTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  try {
    await apiFetch(`/api/admin/acct/bank-transactions/${id}`, { method: 'DELETE' });
    await finLoadBankTxns();
    finBankRecRender();
    showToast('Transaction deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: TAX & COMPLIANCE ──
async function finLoadTaxRecords() {
  const data = await apiFetch('/api/admin/acct/tax-records');
  state.fin.taxRecords = data.records;
}

async function finTaxInit() {
  try { await finLoadTaxRecords(); finTaxRender(); } catch (err) { showToast(err.message); }
}

function finTaxRender() {
  const tbody = document.getElementById('tax-tbody');
  if (!tbody) return;
  const statusColor = { pending: 'var(--text-2)', filed: '#2563eb', paid: 'var(--green,#16a34a)', overdue: 'var(--red)' };
  tbody.innerHTML = state.fin.taxRecords.length ? state.fin.taxRecords.map(t => `
    <tr>
      <td>${escapeHtml(t.periodLabel)}</td>
      <td>${escapeHtml(t.taxType)}</td>
      <td>${finMoney(t.amountDue)}</td>
      <td>${finMoney(t.amountPaid)}</td>
      <td style="color:${statusColor[t.status] || 'var(--text-2)'};font-weight:700;text-transform:capitalize;">${escapeHtml(t.status)}</td>
      <td>${escapeHtml(t.dueDate || '-')}</td>
      <td><button class="ann-del" style="color:var(--red);" onclick="finDeleteTaxRecord(${t.id})">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="7" style="padding:18px;color:var(--text-3);">No tax records yet.</td></tr>';
}

function finOpenTaxModal() {
  openFinModal({
    title: 'Add Tax Record',
    fields: [
      { key: 'periodLabel', label: 'Period', placeholder: 'e.g. 2026 Q1' },
      { key: 'taxType', label: 'Tax Type', placeholder: 'e.g. PAYE, VAT' },
      { key: 'amountDue', label: 'Amount Due', type: 'number', step: '0.01', min: 0 },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', step: '0.01', min: 0 },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'pending', label: 'Pending' }, { value: 'filed', label: 'Filed' }, { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }] },
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'notes', label: 'Notes', full: true, type: 'textarea' },
    ],
    values: { status: 'pending' },
    onSubmit: async (values) => {
      await apiFetch('/api/admin/acct/tax-records', { method: 'POST', body: JSON.stringify(values) });
      await finLoadTaxRecords();
      finTaxRender();
      showToast('Tax record added');
    },
  });
}

async function finDeleteTaxRecord(id) {
  if (!confirm('Delete this tax record?')) return;
  try {
    await apiFetch(`/api/admin/acct/tax-records/${id}`, { method: 'DELETE' });
    await finLoadTaxRecords();
    finTaxRender();
    showToast('Tax record deleted');
  } catch (err) { showToast(err.message); }
}

// ── ACCOUNTING: FINANCIAL REPORTS ──
async function finReportsInit() {
  try {
    const data = await apiFetch('/api/admin/acct/financial-reports');
    document.getElementById('fr-empty-card').style.display = data.hasData ? 'none' : '';
    document.getElementById('fr-content').style.display = data.hasData ? '' : 'none';
    if (!data.hasData) return;
    document.getElementById('fr-income').textContent = finMoney(data.totalIncome);
    document.getElementById('fr-expense').textContent = finMoney(data.totalExpense);
    document.getElementById('fr-net').textContent = finMoney(data.netIncome);
    document.getElementById('fr-net').style.color = data.netIncome >= 0 ? 'var(--green,#16a34a)' : 'var(--red)';
    document.getElementById('fr-assets').textContent = finMoney(data.totalAssets);
    document.getElementById('fr-liabilities').textContent = finMoney(data.totalLiabilities);
    document.getElementById('fr-equity').textContent = finMoney(data.totalEquity);
  } catch (err) { showToast(err.message); }
}
