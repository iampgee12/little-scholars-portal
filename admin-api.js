const state = {
  user: null,
  setup: null,
  editingStudentId: null,
  pendingDeleteStudentId: null,
  editingStaffId: null,
  editingAssignmentId: null,
  reviewingBatchId: null,
  batchReview: null,
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
    document.title = `Little Scholars - ${state.user.name}`;

    await loadResultSetup();
    populateDashboard();
    populateStudents();
    populateParents();
    clearStudentForm();
    populateStaff();
    renderAnnouncements();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadResultSetup() {
  state.setup = await apiFetch('/api/admin/result-setup');
  populateAdminControls();
  populateGradebookControls();
  populateCognitiveControls();
  renderAssignments();
  renderResultBatches();
  renderPublications();
  renderEmailConfigStatus();
  renderEmailQueue();
  populateClasses();
  populateSubjects();
}

function populateDashboard() {
  const classCounts = new Map();
  (state.setup.students || []).forEach(student => {
    classCounts.set(student.classCode, (classCounts.get(student.classCode) || 0) + 1);
  });
  const classData = (state.setup.classes || []).map(cls => {
    const students = (state.setup.students || []).filter(student => student.classCode === cls.code);
    const avg = students.length ? Math.round(students.reduce((sum, student) => sum + Number(student.avg || 0), 0) / students.length) : 0;
    const att = students.length ? Math.round(students.reduce((sum, student) => sum + Number(student.att || 0), 0) / students.length) : 0;
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
      <td><span class="stu-av">${escapeHtml(student.initials)}</span><strong>${escapeHtml(student.name)}</strong></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-3);">${escapeHtml(student.id)}</td>
      <td style="color:var(--text-2);">Class ${escapeHtml(student.classCode)}</td>
      <td style="color:var(--text-3);">${student.gender === 'F' ? 'Female' : 'Male'}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:700;">${student.avg}%</td>
      <td><span class="grade-pill ${gradeClass(student.avg)}">${grade}</span></td>
      <td><div class="att-bar"><div class="att-track"><div class="att-fill" style="width:${student.att}%;background:${student.att >= 90 ? 'var(--green)' : student.att >= 75 ? 'var(--amber)' : 'var(--red)'};"></div></div><span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${student.att}%</span></div></td>
      <td style="color:var(--text-3);font-size:12px;">${escapeHtml(student.parentEmail || '-')}</td>
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
      <td><div class="staff-designation">${escapeHtml(designation)}</div><div class="staff-table-sub">${escapeHtml(areas)}</div></td>
      <td class="staff-phone">-</td>
      <td><button class="staff-profile-btn" title="Edit profile" onclick="editStaff('${escapeHtml(staff.id)}')">...</button></td>
      <td><span class="staff-status-on">ON</span></td>`;
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
  const divisionSelect = document.getElementById('gb-division');
  const subjectSelect = document.getElementById('gb-subject');
  if (!sessionSelect || !examSelect || !classSelect || !subjectSelect) return;

  const academic = state.setup.academic || {};
  sessionSelect.innerHTML = `<option value="${escapeHtml(academic.sessionLabel || '')}">${escapeHtml(academic.sessionLabel || 'Active Session')}</option>`;
  examSelect.innerHTML = (state.setup.examTypes || []).map(exam => `<option value="${escapeHtml(exam)}">${escapeHtml(exam)}</option>`).join('');
  examSelect.value = (state.setup.examTypes || []).includes('Mid-Term Exam') ? 'Mid-Term Exam' : (state.setup.examTypes || [])[0] || '';
  classSelect.innerHTML = (state.setup.classes || []).map(cls => `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`).join('');
  subjectSelect.innerHTML = (state.setup.subjects || []).map(subject => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join('');
  if (divisionSelect) divisionSelect.innerHTML = '<option value="main">Main Division</option><option value="all">All Students</option>';
}

function gradebookSelection() {
  const subjectId = Number(document.getElementById('gb-subject')?.value || 0);
  const subject = (state.setup.subjects || []).find(item => Number(item.id) === subjectId) || (state.setup.subjects || [])[0] || {};
  const classCode = document.getElementById('gb-class')?.value || (state.setup.classes || [])[0]?.code || '';
  const cls = (state.setup.classes || []).find(item => item.code === classCode) || {};
  return {
    session: document.getElementById('gb-session')?.value || state.setup.academic?.sessionLabel || '',
    examType: document.getElementById('gb-exam')?.value || (state.setup.examTypes || [])[0] || '',
    classCode,
    classLabel: cls.label || classCode || 'Selected Class',
    division: document.getElementById('gb-division')?.value || 'main',
    subjectId,
    subjectName: subject.name || 'Selected Subject',
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
  if (classText) classText.textContent = `${selection.classLabel} Students`;
  if (subjectText) subjectText.innerHTML = `Score Entry for Subject : <strong>${escapeHtml(selection.subjectName.toUpperCase())}</strong>`;
  if (examText) examText.textContent = `Exam : ${selection.examType} (${selection.session})`;
  const published = gradebookIsPublished(selection);
  if (stateBox) {
    stateBox.style.display = published ? 'block' : 'none';
    stateBox.innerHTML = '<strong>READ ONLY MODE</strong><br>This result has already been published and can no longer be altered from here.';
  }
  if (unpublish) {
    unpublish.style.display = published ? '' : 'none';
    unpublish.textContent = published ? 'Published Result' : 'Unpublish this Result';
  }
  const saved = document.getElementById('gb-batch-status');
  if (saved) {
    saved.textContent = batch
      ? `${batch.vettedAt ? 'Vetted' : 'Uploaded'} by ${batch.teacherName || 'teacher'}${batch.savedAt ? ` - ${batch.savedAt}` : ''}`
      : 'No uploaded score batch found for this selection yet.';
  }
}

async function manageGradebookScores() {
  const selection = gradebookSelection();
  const body = document.getElementById('gb-score-tbody');
  if (body) body.innerHTML = '<tr><td colspan="9" style="padding:18px;color:var(--text-3);">Loading grade book...</td></tr>';
  const batchSummary = findGradebookBatch(selection);
  let batch = null;
  if (batchSummary) {
    try {
      const data = await apiFetch(`/api/admin/result-batches/${batchSummary.id}`);
      batch = data.batch;
    } catch (err) {
      showToast(err.message);
    }
  }
  state.gradebookBatch = batch;
  renderGradebookTable(selection, batch);
}

function renderGradebookTable(selection = gradebookSelection(), batch = state.gradebookBatch) {
  const tbody = document.getElementById('gb-score-tbody');
  if (!tbody) return;
  updateGradebookSummary(selection, batch);
  const entries = Object.fromEntries((batch?.entries || []).map(entry => [entry.studentId, entry]));
  const students = (state.setup.students || []).filter(student => student.classCode === selection.classCode);
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:18px;color:var(--text-3);">No students found for this class.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map((student, index) => {
    const entry = entries[student.id] || {};
    const ca = entry.ca ?? '';
    const exam = entry.exam ?? '';
    const total = entry.total ?? (ca !== '' && exam !== '' ? Number(ca) + Number(exam) : '');
    return `
      <tr data-search="${escapeHtml(`${student.name} ${student.id}`.toLowerCase())}">
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(student.name)}</strong><div class="gb-student-id">${escapeHtml(student.id)}</div></td>
        <td><input class="gb-score-input" value="${escapeHtml(ca)}" readonly></td>
        <td><input class="gb-score-input" value="${escapeHtml(exam)}" readonly></td>
        <td class="gb-total">${escapeHtml(total || '-')}</td>
        <td><input class="gb-comment-input" readonly></td>
        <td><input class="gb-comment-input" readonly></td>
        <td><button class="gb-flag absent" type="button" disabled><span></span>Absent</button></td>
        <td><button class="gb-flag exclude" type="button" disabled><span></span>Exclude</button></td>
      </tr>`;
  }).join('');
}

function filterGradebookRows() {
  const q = (document.getElementById('gb-search')?.value || '').toLowerCase();
  document.querySelectorAll('#gb-score-tbody tr').forEach(tr => {
    tr.style.display = !q || (tr.dataset.search || '').includes(q) ? '' : 'none';
  });
}

function exportGradebookCsv() {
  const selection = gradebookSelection();
  const rows = [['Student', 'Student ID', 'Mid Term Test', 'Examination', 'Total Score']];
  document.querySelectorAll('#gb-score-tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 5) return;
    rows.push([
      cells[1].querySelector('strong')?.textContent || '',
      cells[1].querySelector('.gb-student-id')?.textContent || '',
      cells[2].querySelector('input')?.value || '',
      cells[3].querySelector('input')?.value || '',
      cells[4].textContent || '',
    ]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${selection.classCode}-${selection.subjectName}-gradebook.csv`.replace(/[^a-z0-9_.-]+/gi, '_');
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
    ['Account Status',    '—'],
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
    studentClassSelect.innerHTML = '<option value="">Select class...</option>' + state.setup.classes.map(cls =>
      `<option value="${escapeHtml(cls.code)}">${escapeHtml(cls.label)}</option>`
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

function renderResultBatches() {
  const tbody = document.getElementById('vetting-tbody');
  if (!tbody) return;
  const batches = state.setup.resultBatches || [];
  if (!batches.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);padding:16px;">No teacher result submissions yet.</td></tr>';
    renderBatchReviewPanel();
    return;
  }
  tbody.innerHTML = batches.map(batch => `
    <tr>
      <td>${escapeHtml(batch.classLabel)}</td>
      <td>${escapeHtml(batch.examType)}</td>
      <td>${escapeHtml(batch.subjectName)}</td>
      <td>${escapeHtml(batch.teacherName)}</td>
      <td style="font-family:'DM Mono',monospace;">${batch.entryCount}</td>
      <td style="color:${batch.vettedAt ? 'var(--green)' : 'var(--amber)'};">${batch.vettedAt ? `Vetted ${escapeHtml(batch.vettedAt)}` : 'Pending vetting'}</td>
      <td><button class="post-btn" style="padding:6px 10px;" onclick="openBatchReview(${batch.id})">${batch.vettedAt ? 'View' : 'Review'}</button></td>
    </tr>`).join('');
  renderBatchReviewPanel();
}

function batchScoreColumns(examType) {
  if (examType === 'Continuous Assessment') return ['CA (30)', 'Total (30)'];
  return ['CA (30)', 'Exam (70)', 'Total (100)'];
}

function renderBatchReviewPanel() {
  const panel = document.getElementById('batch-review-panel');
  if (!panel) return;
  const batch = state.batchReview;
  if (!batch) {
    panel.innerHTML = `
      <div class="card-head"><span class="card-title">Review Uploaded Results</span></div>
      <div class="card-body" style="font-size:12px;color:var(--text-3);line-height:1.55;">
        Select <strong>Review</strong> beside a teacher upload to see every student's score before vetting it.
      </div>`;
    return;
  }

  const isCurrent = (state.setup.resultBatches || []).some(item => Number(item.id) === Number(batch.id));
  if (!isCurrent) {
    state.batchReview = null;
    state.reviewingBatchId = null;
    renderBatchReviewPanel();
    return;
  }

  const columns = batchScoreColumns(batch.examType);
  const rows = batch.entries || [];
  const statusText = batch.vettedAt ? `Vetted ${batch.vettedAt}` : 'Pending admin vetting';
  const statusColor = batch.vettedAt ? 'var(--green)' : 'var(--amber)';
  const entryRows = rows.length ? rows.map((entry, index) => {
    const scoreCells = batch.examType === 'Continuous Assessment'
      ? `<td style="text-align:center;font-family:'DM Mono',monospace;">${entry.ca ?? '-'}</td><td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;">${entry.total ?? '-'}</td>`
      : `<td style="text-align:center;font-family:'DM Mono',monospace;">${entry.ca ?? '-'}</td><td style="text-align:center;font-family:'DM Mono',monospace;">${entry.exam ?? '-'}</td><td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;">${entry.total ?? '-'}</td>`;
    return `
      <tr>
        <td style="font-family:'DM Mono',monospace;color:var(--text-3);">${index + 1}</td>
        <td><strong>${escapeHtml(entry.studentName)}</strong><div style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${escapeHtml(entry.studentId)}</div></td>
        <td style="color:var(--text-3);">${escapeHtml(entry.gender === 'F' ? 'Female' : entry.gender === 'M' ? 'Male' : entry.gender || '-')}</td>
        ${scoreCells}
      </tr>`;
  }).join('') : `<tr><td colspan="${columns.length + 3}" style="padding:14px;color:var(--text-3);">No student scores were found in this upload.</td></tr>`;

  panel.innerHTML = `
    <div class="card-head">
      <span class="card-title">Review Uploaded Results</span>
      <button class="post-btn" style="padding:6px 10px;background:var(--black-3);" onclick="closeBatchReview()">Close</button>
    </div>
    <div class="card-body">
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px;">
        <div><div style="font-size:10px;color:var(--text-3);text-transform:uppercase;">Class</div><strong>${escapeHtml(batch.classLabel)}</strong></div>
        <div><div style="font-size:10px;color:var(--text-3);text-transform:uppercase;">Exam</div><strong>${escapeHtml(batch.examType)}</strong></div>
        <div><div style="font-size:10px;color:var(--text-3);text-transform:uppercase;">Subject</div><strong>${escapeHtml(batch.subjectName)}</strong></div>
        <div><div style="font-size:10px;color:var(--text-3);text-transform:uppercase;">Teacher</div><strong>${escapeHtml(batch.teacherName)}</strong></div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--text-3);">Uploaded ${escapeHtml(batch.savedAt || '-')} • ${rows.length} student score${rows.length === 1 ? '' : 's'}</div>
        <div style="font-size:12px;font-weight:700;color:${statusColor};">${escapeHtml(statusText)}</div>
      </div>
      <div style="overflow-x:auto;border:1px solid var(--black-4);border-radius:var(--radius-sm);">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:42px;">#</th>
              <th>Student</th>
              <th>Gender</th>
              ${columns.map(column => `<th style="text-align:center;">${escapeHtml(column)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${entryRows}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;flex-wrap:wrap;">
        ${batch.vettedAt
          ? '<span style="font-size:12px;color:var(--text-3);align-self:center;">This upload is ready for publishing.</span>'
          : `<button class="post-btn" onclick="vetReviewedBatch()">Vet Reviewed Upload</button>`}
      </div>
    </div>`;
}

async function openBatchReview(id) {
  state.reviewingBatchId = Number(id);
  const panel = document.getElementById('batch-review-panel');
  if (panel) {
    panel.innerHTML = `
      <div class="card-head"><span class="card-title">Review Uploaded Results</span></div>
      <div class="card-body" style="font-size:12px;color:var(--text-3);">Loading uploaded student scores...</div>`;
  }
  try {
    const data = await apiFetch(`/api/admin/result-batches/${id}`);
    state.batchReview = data.batch;
    renderBatchReviewPanel();
    document.getElementById('batch-review-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showToast(err.message);
  }
}

function closeBatchReview() {
  state.reviewingBatchId = null;
  state.batchReview = null;
  renderBatchReviewPanel();
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

async function vetReviewedBatch() {
  const id = state.batchReview?.id || state.reviewingBatchId;
  if (!id) return showToast('Choose an upload to review first');
  try {
    const data = await apiFetch(`/api/admin/result-batches/${id}/vet`, { method: 'POST' });
    state.setup = data.setup;
    renderResultBatches();
    await openBatchReview(id);
    showToast('Reviewed result upload vetted');
  } catch (err) {
    showToast(err.message);
  }
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

function setStudentPageMode(mode, student = null) {
  const editing = mode === 'edit';
  const pageTitle = document.getElementById('student-page-title');
  const pageSub = document.getElementById('student-page-sub');
  const directory = document.getElementById('student-directory-card');
  const back = document.getElementById('student-back-btn');
  const deleteBtn = document.getElementById('student-delete-btn');
  const cancel = document.getElementById('student-cancel-label');
  const title = document.getElementById('student-form-title');
  const save = document.getElementById('student-save-label');

  if (pageTitle) pageTitle.textContent = editing ? 'Edit Student' : 'All Students';
  if (pageSub) {
    pageSub.textContent = editing && student
      ? `Update ${student.name}'s record, reset password, or remove the student.`
      : 'Complete student directory - Term 2, 2025/2026';
  }
  if (directory) directory.style.display = editing ? 'none' : '';
  if (back) back.style.display = editing ? 'inline-flex' : 'none';
  if (deleteBtn) deleteBtn.style.display = editing ? 'inline-flex' : 'none';
  if (cancel) cancel.textContent = editing ? 'Back to Directory' : 'Clear';
  if (title) title.textContent = editing && student ? `Edit Student - ${student.name}` : 'Add Student';
  if (save) save.textContent = editing ? 'Save Student Changes' : 'Add Student';
}

function clearStudentForm() {
  state.editingStudentId = null;
  ['new-student-id', 'new-student-name', 'new-student-initials', 'new-student-password', 'new-student-avg', 'new-student-att', 'new-student-parent-email'].forEach(id => {
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
  setStudentPageMode('directory');
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

function editStudent(id) {
  const student = state.setup.students.find(item => item.id === id);
  if (!student) return showToast('Student not found');
  state.editingStudentId = student.id;
  document.getElementById('new-student-id').value = student.id;
  document.getElementById('new-student-id').disabled = true;
  document.getElementById('new-student-name').value = student.name || '';
  document.getElementById('new-student-initials').value = student.initials || '';
  const password = document.getElementById('new-student-password');
  password.value = '';
  password.placeholder = 'Leave blank to keep current password';
  password.readOnly = false;
  document.getElementById('new-student-gender').value = student.gender || 'F';
  document.getElementById('new-student-class').value = student.classCode || '';
  document.getElementById('new-student-parent-email').value = student.parentEmail || '';
  document.getElementById('new-student-avg').value = student.avg ?? '';
  document.getElementById('new-student-att').value = student.att ?? '';
  document.getElementById('new-student-photo').value = '';
  setStudentPageMode('edit', student);
  document.getElementById('new-student-name').focus();
}

async function saveStudent() {
  let photoDataUrl = '';
  try {
    photoDataUrl = await fileToDataUrl('new-student-photo');
  } catch (err) {
    showToast(err.message);
    return;
  }
  const payload = {
    id: document.getElementById('new-student-id').value,
    name: document.getElementById('new-student-name').value,
    initials: document.getElementById('new-student-initials').value,
    password: state.editingStudentId ? document.getElementById('new-student-password').value : DEFAULT_STUDENT_PASSWORD,
    gender: document.getElementById('new-student-gender').value,
    classCode: document.getElementById('new-student-class').value,
    parentEmail: document.getElementById('new-student-parent-email').value,
    avg: document.getElementById('new-student-avg').value,
    att: document.getElementById('new-student-att').value,
    photoDataUrl,
  };
  if (!payload.id || !payload.name || !payload.classCode) {
    showToast('Student ID, name, and class are required');
    return;
  }
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
    renderResultBatches();
    renderPublications();
    if (state.editingStudentId === id) clearStudentForm();
    closeStudentDeleteModal();
    showToast('Student removed');
  } catch (err) {
    showToast(err.message);
  }
}

async function addStudent() {
  return saveStudent();
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
  publish: { title: 'Review And Publish Results', sub: 'Review, Vet, and Publish Student Reports' },
  emailQueue: { title: 'Results Email Delivery Queue', sub: 'Published Report Email Status' },
  settings: { title: 'Result Settings', sub: 'Staff, Students, and Result Assignments' },
  academics: { title: 'Academics', sub: 'Academic Activities' },
  classes: { title: 'Classes', sub: 'Classes and class arms' },
  subjects: { title: 'Subjects', sub: 'Class subjects and subject bank' },
  exams: { title: 'Exams', sub: 'Exam Activities' },
  eclass: { title: 'E-Class', sub: 'Digital Classroom' },
  finance: { title: 'Finance', sub: 'School Finance' },
  attendance: { title: 'Attendance', sub: 'Attendance Records' },
};

function showAdminSection(section, trigger, defaultTab) {
  document.querySelectorAll('.rail-item').forEach(item => item.classList.remove('active'));
  if (trigger) trigger.classList.add('active');
  document.querySelectorAll('.sub-menu').forEach(menu => menu.classList.remove('active'));
  const menu = document.querySelector(`.sub-menu[data-menu="${section}"]`);
  if (menu) menu.classList.add('active');
  const search = document.querySelector('.admin-quick-search input');
  if (search) filterAdminSidebar(search.value);
  if (defaultTab) {
    const target = menu?.querySelector('.sub-nav-item[data-default="true"]') || menu?.querySelector(`.sub-nav-item[data-tab="${defaultTab}"]`) || menu?.querySelector('.sub-nav-item');
    switchTab(defaultTab, target || null);
  }
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
    populateGradebookControls();
    manageGradebookScores();
  }
  if (tab === 'cognitiveSkills') {
    populateCognitiveControls();
    viewCognitiveClass();
  }
  if (tab === 'emailQueue') renderEmailQueue();
  if (tab === 'studentResultChecker') srcInit();
  if (tab === 'classResultChecker') crcInit();
  if (tab === 'publish') {
    renderResultBatches();
    renderPublications();
    populateBroadsheetControls();
  }
  if (tab === 'classes') populateClasses();
  if (tab === 'subjects') populateSubjects();
  if (tab === 'systemSettings') loadSystemSettings();
  if (tab === 'academicTerms') loadAcademicTermsTab();
  if (tab === 'scoreDivisions') sdInit();
  if (tab === 'commentsBank') cbLoadComments();
  if (tab === 'resultPrefs') switchRspTab('sheet');
  if (tab === 'scheduleExam') populateScheduleExamSelects();
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
  const armSel = document.getElementById('src-arm');
  const arms = (state.setup.classArms || []).filter(a => a.classCode === classCode);
  armSel.innerHTML = '<option value="">— All Arms —</option>' +
    arms.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  document.getElementById('src-list-card').style.display = 'none';
}

function srcLoadList() {
  const classCode = document.getElementById('src-class').value;
  const arm = document.getElementById('src-arm').value;
  if (!classCode) { showToast('Please select a class', 'warn'); return; }

  const classLabel = (state.setup.classes || []).find(c => c.code === classCode)?.label || classCode;
  const students = (state.setup.students || []).filter(st => {
    if (st.classCode !== classCode) return false;
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
  showToast(`Opening result for ${student.name}…`, 'info');
  // Switch to publish tab pre-filtered — placeholder for full report view
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

  document.getElementById('crc-availability').style.display = 'none';
  document.getElementById('crc-view-btn').style.display = 'none';
  document.getElementById('crc-results-area').innerHTML = '';
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
  if (!classCode || !examType) return;

  const area = document.getElementById('crc-results-area');
  area.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-3)">Loading results…</div>';

  try {
    const data = await fetch(`/api/admin/broadsheet?classCode=${classCode}&examType=${encodeURIComponent(examType)}`).then(r => r.json());
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

const GRADE_SCALE = [
  { min:80, grade:'A', remark:'Excellent' },
  { min:65, grade:'B', remark:'Very Good' },
  { min:55, grade:'C', remark:'Good' },
  { min:45, grade:'D', remark:'Fair' },
  { min:0,  grade:'F', remark:'Fail' },
];
function bsGrade(pct) { return GRADE_SCALE.find(g => pct >= g.min) || GRADE_SCALE.at(-1); }

function togglePublishBody() {
  const body = document.getElementById('pub-body');
  const chev = document.getElementById('pub-chev');
  body.classList.toggle('open');
  chev.innerHTML = body.classList.contains('open') ? '&#9650;' : '&#9660;';
}

function populateBroadsheetControls() {
  if (!state.setup) return;
  const classSel = document.getElementById('bs-class-sel');
  const examSel  = document.getElementById('bs-exam-sel');
  if (!classSel || !examSel) return;

  const prevClass = classSel.value;
  const prevExam  = examSel.value;

  classSel.innerHTML = '<option value="">— Select Class —</option>' +
    (state.setup.classes||[]).map(c=>`<option value="${c.code}">${c.label}</option>`).join('');
  if (prevClass) classSel.value = prevClass;

  const exams = [...new Set((state.setup.resultBatches||[]).map(b=>b.examType))].filter(Boolean);
  examSel.innerHTML = '<option value="">— Select Exam —</option>' +
    exams.map(e=>`<option value="${e}">${e}</option>`).join('');
  if (prevExam) examSel.value = prevExam;
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
    renderBroadsheetPills(data);
    renderBroadsheetTable(data);
    renderBroadsheetSummary(data);
  } catch(e) {
    document.getElementById('bs-table-outer').innerHTML =
      `<div style="padding:40px;text-align:center;color:#f87171;font-size:13px;">${e.message}</div>`;
  }
}

const PILL_COLORS = ['#2563eb','#16a34a','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#9a3412'];

function renderBroadsheetPills(data) {
  const bar = document.getElementById('bs-pills');
  bar.innerHTML = (data.subjects||[]).map((s,i)=>{
    const color = PILL_COLORS[i % PILL_COLORS.length];
    const label = s.name.length>14 ? s.name.slice(0,13)+'…' : s.name;
    return `<span class="bs-pill" style="background:${color}" title="${s.name}">${label}</span>`;
  }).join('');
}

function renderBroadsheetTable(data) {
  const subj     = data.subjects || [];
  const students = data.students || [];
  const matrix   = data.scoreMatrix || {};
  const minimal  = _bsView === 'minimal';

  // Header row 1 — group labels
  let thGroup = `<th class="bs-sticky bs-sticky-h bs-col-num" rowspan="2">#</th>
    <th class="bs-sticky bs-sticky-h bs-col-name" rowspan="2" style="left:36px">Student</th>
    <th class="bs-sticky bs-sticky-h bs-col-reg" rowspan="2" style="left:206px">Reg. No.</th>`;
  subj.forEach(s => {
    const cols = minimal ? 1 : 3;
    thGroup += `<th class="bs-th-group" colspan="${cols}">${s.name}</th>`;
  });
  thGroup += `<th rowspan="2">Grand<br>Total</th>
    <th rowspan="2">Avg %</th>
    <th rowspan="2">Position</th>
    <th rowspan="2">Remark</th>
    <th rowspan="2"></th>`;

  // Header row 2 — sub-cols
  let thSub = '';
  if (!minimal) {
    subj.forEach(() => {
      thSub += '<th>C.A<br><small style="color:var(--text-3)">40%</small></th>' +
               '<th>Exam<br><small style="color:var(--text-3)">60%</small></th>' +
               '<th>Total</th>';
    });
  } else {
    subj.forEach(() => { thSub += '<th>Total</th>'; });
  }

  // Body rows
  let tbody = '';
  students.forEach((st, idx) => {
    const scores = matrix[st.id] || {};
    let grandTotal = 0, subjectCount = 0;

    let scoreCells = '';
    subj.forEach(s => {
      const sc = scores[s.id];
      if (sc && sc.tot != null) { grandTotal += sc.tot; subjectCount++; }
      if (minimal) {
        scoreCells += `<td>${sc && sc.tot != null ? sc.tot : '<span class="bs-excluded">—</span>'}</td>`;
      } else {
        scoreCells += `<td>${sc && sc.ca  != null ? sc.ca  : '<span class="bs-excluded">—</span>'}</td>`;
        scoreCells += `<td>${sc && sc.ex  != null ? sc.ex  : '<span class="bs-excluded">—</span>'}</td>`;
        scoreCells += `<td class="bs-score-total">${sc && sc.tot != null ? sc.tot : '<span class="bs-excluded">—</span>'}</td>`;
      }
    });

    const maxPossible = subjectCount * 100;
    const avgPct = maxPossible > 0 ? Math.round(grandTotal / maxPossible * 100) : 0;
    const g = bsGrade(avgPct);
    const pos = idx + 1;
    const posClass = pos===1?'top1':pos===2?'top2':pos===3?'top3':'';

    tbody += `<tr>
      <td class="bs-sticky bs-col-num">${pos}</td>
      <td class="bs-sticky bs-col-name bs-td-name" style="left:36px">${st.name}</td>
      <td class="bs-sticky bs-col-reg bs-td-reg" style="left:206px">${st.id||'—'}</td>
      ${scoreCells}
      <td class="bs-score-total">${grandTotal}</td>
      <td class="bs-avg-bar-wrap">
        <div class="bs-avg-pct">${avgPct}%</div>
        <div class="bs-avg-grade">${g.grade}</div>
        <div class="bs-avg-track"><div class="bs-avg-fill" style="width:${avgPct}%"></div></div>
      </td>
      <td><span class="bs-pos-badge ${posClass}">${pos}</span></td>
      <td class="bs-remark-td" title="${g.remark}">${g.remark}</td>
      <td><button class="bs-preview-btn" onclick="alert('Preview coming soon')">Preview</button></td>
    </tr>`;
  });

  const html = `<table class="bs-table" id="bs-table-el">
    <thead>
      <tr>${thGroup}</tr>
      <tr>${thSub}</tr>
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
  const studentCount = (data.students||[]).length;

  const summaryGrid = document.getElementById('bs-summary-grid');
  summaryGrid.innerHTML = `
    <div class="bs-summary-card"><div class="bs-summary-label">Total Students</div><div class="bs-summary-val">${studentCount}</div></div>
    <div class="bs-summary-card"><div class="bs-summary-label">Subjects</div><div class="bs-summary-val">${subj.length}</div></div>
    <div class="bs-summary-card"><div class="bs-summary-label">Class Average</div><div class="bs-summary-val">${stats.classScoreAverage ?? '—'}%</div></div>
    <div class="bs-summary-card"><div class="bs-summary-label">Best Student</div><div class="bs-summary-val" style="font-size:13px;padding-top:4px">${stats.bestStudent?.name ?? '—'}</div></div>
    <div class="bs-summary-card"><div class="bs-summary-label">Best Score</div><div class="bs-summary-val">${stats.bestStudent?.avg ?? '—'}%</div></div>
    <div class="bs-summary-card"><div class="bs-summary-label">Active Students</div><div class="bs-summary-val">${stats.activeStudents ?? studentCount}</div></div>`;

  const statsTbody = document.querySelector('#bs-stats-table tbody');
  statsTbody.innerHTML = subjectStats.map(s => `
    <tr>
      <td style="font-weight:600">${s.name}</td>
      <td style="color:var(--text-3)">${s.teacherName||'—'}</td>
      <td><span style="font-weight:700;font-family:'DM Mono',monospace">${s.average??'—'}</span></td>
      <td style="color:var(--green);font-size:11px">${(s.topStudents||[]).join(', ') || '—'}</td>
      <td style="color:var(--text-3)">${(s.secondStudents||[]).join(', ') || '—'}</td>
      <td>${s.studentCount ?? '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text-3)">No subject data.</td></tr>';

  document.getElementById('bs-summary').style.display = '';
}

function exportBroadsheetCSV() {
  if (!_bsData) { showToast('Load a broadsheet first','warn'); return; }
  const subj     = _bsData.subjects || [];
  const students = _bsData.students || [];
  const matrix   = _bsData.scoreMatrix || {};

  const headers = ['#','Name','Reg No',...subj.map(s=>s.name+' Total'),'Grand Total','Avg%'];
  const rows = students.map((st,i) => {
    const scores = matrix[st.id]||{};
    const totals = subj.map(s => scores[s.id]?.tot ?? '');
    const grand  = totals.reduce((a,v) => a + (Number(v)||0), 0);
    const maxP   = subj.length * 100;
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

// ── ACADEMIC TERMS TAB ──

function atFilterTable(tbodyId, q) {
  const lq = q.toLowerCase();
  document.querySelectorAll(`#${tbodyId} tr`).forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

function openCreateTermModal() { showToast('Create new term/period coming soon', 'info'); }

function openNewPeriodModal() {
  const sel = document.getElementById('at-period-session');
  if (sel && state.setup) {
    sel.innerHTML = (state.setup.academic ? [`<option>${state.setup.academic.session_label || '2025-2026'}</option>`] : []).join('');
  }
  document.getElementById('at-period-modal').style.display = 'flex';
}
function closeNewPeriodModal() { document.getElementById('at-period-modal').style.display = 'none'; }
function saveNewPeriod() {
  const session = document.getElementById('at-period-session').value;
  const term    = document.getElementById('at-period-term').value;
  const start   = document.getElementById('at-period-start').value;
  const end     = document.getElementById('at-period-end').value;
  if (!session || !term || !start || !end) { showToast('All fields are required', 'warn'); return; }
  const tbody = document.getElementById('at-calendar-tbody');
  const rows  = tbody.querySelectorAll('tr[data-period]').length;
  tbody.innerHTML = tbody.innerHTML.replace('<td colspan="6"', '<td colspan="6" style="display:none"');
  const tr = document.createElement('tr');
  tr.setAttribute('data-period','1');
  tr.innerHTML = `<td>${rows+1}</td><td>${session}</td><td>${term}</td><td>${start}</td><td>${end}</td><td><button class="bs-preview-btn" onclick="this.closest('tr').remove();showToast('Period deleted','info')">Delete</button></td>`;
  tbody.appendChild(tr);
  tbody.querySelector('tr td[colspan="6"]')?.parentElement.remove();
  closeNewPeriodModal();
  showToast('Calendar period saved', 'success');
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
    const [startY, endY] = (s.sessionLabel || '').split('-');
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

const SS_KEY = 'lsSystemSettings';
function loadSystemSettings() {
  const saved = JSON.parse(localStorage.getItem(SS_KEY) || '{}');
  const fields = ['ss-school-name','ss-school-motto','ss-reg-number','ss-school-type','ss-education-level',
    'ss-school-address','ss-city','ss-state','ss-country','ss-phone','ss-email',
    'ss-website','ss-facebook','ss-twitter','ss-instagram',
    'ss-currency','ss-timezone','ss-date-format','ss-lang',
    'ss-notify-sms','ss-notify-email','ss-notify-portal'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = id.replace('ss-','');
    if (saved[key] !== undefined) {
      if (el.type === 'checkbox') el.checked = saved[key];
      else el.value = saved[key];
    }
  });
}
function saveSystemSettings() {
  const fields = ['ss-school-name','ss-school-motto','ss-reg-number','ss-school-type','ss-education-level',
    'ss-school-address','ss-city','ss-state','ss-country','ss-phone','ss-email',
    'ss-website','ss-facebook','ss-twitter','ss-instagram',
    'ss-currency','ss-timezone','ss-date-format','ss-lang',
    'ss-notify-sms','ss-notify-email','ss-notify-portal'];
  const data = {};
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = id.replace('ss-','');
    data[key] = el.type === 'checkbox' ? el.checked : el.value;
  });
  localStorage.setItem(SS_KEY, JSON.stringify(data));
  showToast('Settings saved successfully', 'success');
}

async function createAcademicSession() {
  const sessionLabel = document.getElementById('ss-new-session').value.trim();
  const termLabel = document.getElementById('ss-new-term').value.trim();
  if (!sessionLabel || !termLabel) return showToast('Please enter both session and term labels', true);
  try {
    await apiFetch('/api/admin/academic-sessions', { method: 'POST', body: JSON.stringify({ sessionLabel, termLabel }) });
    document.getElementById('ss-new-session').value = '';
    document.getElementById('ss-new-term').value = '';
    showToast('Session created');
    loadAcademicTermsTab();
  } catch (e) {
    showToast(e.message, true);
  }
}

function openCreateSessionModal() {
  document.getElementById('ss-modal').style.display = 'flex';
  document.getElementById('ss-modal-session').value = '';
  document.getElementById('ss-modal-term').value = '';
}

function closeSessionModal() {
  document.getElementById('ss-modal').style.display = 'none';
}

async function createSessionFromModal() {
  const sessionLabel = document.getElementById('ss-modal-session').value.trim();
  const termLabel = document.getElementById('ss-modal-term').value.trim();
  if (!sessionLabel || !termLabel) return showToast('Please enter both session and term labels', true);
  try {
    await apiFetch('/api/admin/academic-sessions', { method: 'POST', body: JSON.stringify({ sessionLabel, termLabel }) });
    closeSessionModal();
    showToast('Session created');
    loadAcademicTermsTab();
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
  const rows = (state.setup.classes || []).filter(cls => {
    if (categoryFilter && cls.category !== categoryFilter) return false;
    if (search && !`${cls.label} ${cls.code}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;color:var(--text-3);">No classes found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((cls, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(cls.label)}</strong>${cls.category ? `<div style="font-size:10px;color:var(--text-3);">(${escapeHtml(cls.category)})</div>` : ''}</td>
      <td>${cls.studentCount || 0}</td>
      <td>
        <button class="post-btn" style="padding:6px 10px;" onclick="editClass('${escapeHtml(cls.code)}')">Edit</button>
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

function sdViewDivisions() {
  const classCode = document.getElementById('sd-class').value;
  const examType  = document.getElementById('sd-exam').value;
  if (!classCode || !examType) { showToast('Select a class and exam first','warn'); return; }
  const classLabel = (state.setup.classes||[]).find(c=>c.code===classCode)?.label || classCode;
  document.getElementById('sd-format-label').textContent = `${classLabel} | ${examType} Result`;
  document.getElementById('sd-format-card').style.display = '';
  document.getElementById('sd-divisions-card').style.display = '';
  document.getElementById('sd-divisions-title').textContent = `Assessments / Score Divisions For: ${classLabel} | ${examType} Result`;
  const divisions = [
    { name:'Continuous Assessment', max:'', enabled:false },
    { name:'Mid Term Test (40%)', max:40, enabled:true },
    { name:'Examination (60%)', max:60, enabled:true },
    { name:'Project', max:'', enabled:false },
    { name:'Assignment', max:'', enabled:false },
    { name:'Practical', max:'', enabled:false },
    { name:'Oral', max:'', enabled:false },
  ];
  document.getElementById('sd-tbody').innerHTML = divisions.map((d,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${d.name}</td>
      <td>${d.max !== '' ? d.max : ''}</td>
      <td><span class="${d.enabled?'sd-enabled':'sd-disabled'}">${d.enabled?'Enabled':'Disabled'}</span></td>
    </tr>`).join('');
}

// ── COMMENTS BANK ──

let _cbComments = JSON.parse(localStorage.getItem('cbComments')||'null') || [
  { text:'You have always set a high standard with your remarkable academic performance. Well done!', min:80, max:100 },
  { text:'Your commitment to academic excellence is evident through your consistently stellar performance. Keep up the exceptional work!', min:80, max:100 },
  { text:'Bravo! Your academic achievements reflect your unwavering commitment to learning and setting high goals for yourself.', min:80, max:100 },
  { text:'You consistently go above and beyond in your academic pursuits. Your performance is truly exceptional.', min:80, max:100 },
  { text:'Your academic performance is exemplary, reflecting your immense talent and dedication. We are incredibly proud of you.', min:80, max:100 },
  { text:'Great Job! Your attention and performance have contributed to your well-deserved grade.', min:65, max:79 },
  { text:'Good effort! Keep pushing to improve further.', min:55, max:64 },
  { text:'You are making progress. More dedication will yield better results.', min:45, max:54 },
  { text:'You need to work harder. Please see your teacher for extra support.', min:0, max:44 },
];
let _cbEditIdx = null;

function cbLoadComments() {
  const tbody = document.getElementById('cb-tbody');
  if (!tbody) return;
  if (!_cbComments.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-3)">No comments yet. Click Add Comment to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = _cbComments.map((c,i)=>`
    <tr>
      <td>${i+1}</td>
      <td style="max-width:480px;word-break:break-word">${c.text}</td>
      <td class="cb-score-range">${c.min} -to- ${c.max}</td>
      <td><button class="bs-preview-btn" onclick="cbEditComment(${i})">&#x270E; Edit</button></td>
    </tr>`).join('');
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

function saveCbComment() {
  const text = document.getElementById('cb-text').value.trim();
  const min  = parseInt(document.getElementById('cb-min').value);
  const max  = parseInt(document.getElementById('cb-max').value);
  if (!text) { showToast('Comment text is required','warn'); return; }
  if (isNaN(min)||isNaN(max)||min>max) { showToast('Invalid score range','warn'); return; }
  if (_cbEditIdx !== null) {
    _cbComments[_cbEditIdx] = { text, min, max };
  } else {
    _cbComments.push({ text, min, max });
  }
  localStorage.setItem('cbComments', JSON.stringify(_cbComments));
  closeCbModal();
  cbLoadComments();
  showToast('Comment saved','success');
}
