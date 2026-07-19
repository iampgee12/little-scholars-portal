const EXAM_TYPES = ['Continuous Assessment', 'Mid-Term Exam', 'Final Exam'];
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
const state = {
  user: null,
  academic: null,
  contexts: [],
  currentContext: null,
  currentExam: 'Mid-Term Exam',
  students: [],
  resultsByKey: {},
  skillRatingsByKey: {},
  gridSearch: '',
  currentStudentIndex: null,
};

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
  if (s === null || s === '' || s === undefined || s === '-') return '-';
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

function gradeColor(g) {
  if (!g || g === '-') return 'var(--text-3)';
  if (g.startsWith('A')) return 'var(--green)';
  if (g.startsWith('B')) return 'var(--blue)';
  if (g.startsWith('C')) return 'var(--amber)';
  return 'var(--red)';
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
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function entryKey(contextId, examType) {
  return `${contextId}|${examType}`;
}

function skillsKey(contextId, examType) {
  return `${contextId}|${examType}`;
}

function resultFor(contextId, examType) {
  return state.resultsByKey[entryKey(contextId, examType)] || { entries: {}, savedAt: '' };
}

function skillRatingsFor(contextId, examType) {
  return state.skillRatingsByKey[skillsKey(contextId, examType)] || {};
}

function canRateSkills(ctx = state.currentContext) {
  return ctx?.teacherType === 'class_teacher';
}

async function loadSkillRatingsForContext(ctx = state.currentContext, examType = state.currentExam) {
  if (!canRateSkills(ctx) || !examType) return;
  const data = await apiFetch(`/api/teacher/skills?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`);
  state.skillRatingsByKey[skillsKey(ctx.id, examType)] = data.ratings || {};
}

function uniqueStudents() {
  const seen = new Map();
  state.contexts.forEach(ctx => {
    (ctx.students || []).forEach(stu => {
      const key = `${ctx.classCode}|${stu.id}`;
      if (!seen.has(key)) seen.set(key, { ...stu, cls: ctx.classCode });
    });
  });
  return Array.from(seen.values());
}

function uniqueContextClasses() {
  const seen = new Map();
  state.contexts.forEach(ctx => {
    if (!seen.has(ctx.classCode)) seen.set(ctx.classCode, ctx.classLabel || `Class ${ctx.classCode}`);
  });
  return Array.from(seen, ([code, label]) => ({ code, label }));
}

function subjectOptionsForClass(classCode) {
  const seen = new Map();
  state.contexts.filter(ctx => ctx.classCode === classCode).forEach(ctx => {
    if (!seen.has(ctx.subjectId)) seen.set(ctx.subjectId, ctx.subjectName);
  });
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function populateClassAndSubjectControls(preferredContext = state.contexts[0]) {
  const classSelect = document.getElementById('re-class');
  const subjectSelect = document.getElementById('re-subject');
  classSelect.innerHTML = '<option value="">Select class...</option>';
  subjectSelect.innerHTML = '<option value="">Select subject...</option>';

  const classes = uniqueContextClasses();
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls.code;
    opt.textContent = cls.label;
    classSelect.appendChild(opt);
  });

  if (preferredContext) classSelect.value = preferredContext.classCode;
  classSelect.disabled = classes.length <= 1;
  populateSubjectControl(preferredContext?.subjectId);
}

function populateSubjectControl(preferredSubjectId) {
  const classCode = document.getElementById('re-class').value;
  const subjectSelect = document.getElementById('re-subject');
  subjectSelect.innerHTML = '<option value="">Select subject...</option>';
  if (!classCode) {
    subjectSelect.disabled = true;
    return;
  }
  const subjects = subjectOptionsForClass(classCode);
  subjects.forEach(subject => {
    const opt = document.createElement('option');
    opt.value = subject.id;
    opt.textContent = subject.name;
    subjectSelect.appendChild(opt);
  });
  if (preferredSubjectId && subjects.some(subject => String(subject.id) === String(preferredSubjectId))) {
    subjectSelect.value = String(preferredSubjectId);
  } else if (subjects.length === 1) {
    subjectSelect.value = String(subjects[0].id);
  }
  subjectSelect.disabled = subjects.length <= 1;
}

function findSelectedContext() {
  const classCode = document.getElementById('re-class').value;
  const subjectId = Number(document.getElementById('re-subject').value);
  return state.contexts.find(ctx => ctx.classCode === classCode && Number(ctx.subjectId) === subjectId) || null;
}

async function refreshAllResults() {
  const calls = [];
  state.contexts.forEach(ctx => {
    EXAM_TYPES.forEach(examType => {
      calls.push(apiFetch(`/api/teacher/results?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`)
        .then(data => {
          state.resultsByKey[entryKey(ctx.id, examType)] = data.result;
        }));
    });
  });
  await Promise.all(calls);
}

async function init() {
  try {
    const session = await apiFetch('/api/session');
    if (session.user.role !== 'teacher') {
      window.location.replace('index.html');
      return;
    }
    state.user = session.user;

    const setup = await apiFetch('/api/teacher/result-contexts');
    state.academic = setup.academic;
    state.contexts = setup.contexts || [];

    const teacher = setup.teacher || state.user;
    document.getElementById('t-avatar').textContent = teacher.initials;
    document.getElementById('t-name').textContent = teacher.name;
    document.getElementById('t-chip').textContent = teacher.chip || teacher.name.toUpperCase();
    document.getElementById('t-greeting').textContent = `${greeting()}, ${teacher.firstName}.`;
    document.title = `Little Scholars - ${teacher.name}`;

    const subjects = [...new Set(state.contexts.map(ctx => ctx.subjectName))];
    document.getElementById('t-subj').textContent = subjects.join(', ') || 'No assignments';
    document.getElementById('ctx-session').textContent = `${state.academic.sessionLabel} - ${state.academic.termLabel}`;
    document.getElementById('re-examtype').value = 'Mid-Term Exam';

    if (!state.contexts.length) {
      document.getElementById('results-main').innerHTML = `<div class="ep-wrap"><div class="ep-icon">!</div><div class="ep-title">No Assignments</div><div class="ep-desc">Ask the admin to assign classes and subjects before uploading results.</div></div>`;
      populateDashboard();
      populateStudents();
      renderPublished();
      return;
    }

    populateClassAndSubjectControls(state.contexts[0]);
    await refreshAllResults();
    populateDashboard();
    populateStudents();
    renderPublished();
    await onContextChange();
  } catch (err) {
    showToast(err.message);
  }
}

function populateDashboard() {
  const assignedStudents = uniqueStudents();
  document.getElementById('d-students').textContent = assignedStudents.length;

  let pending = 0;
  let published = 0;
  state.contexts.forEach(ctx => {
    EXAM_TYPES.forEach(exam => {
      const result = resultFor(ctx.id, exam);
      const count = Object.keys(result.entries || {}).length;
      if (count) published++;
      else pending++;
    });
  });
  document.getElementById('d-pending').textContent = pending;
  document.getElementById('pending-badge').textContent = pending;
  document.getElementById('d-pub').textContent = published;

  const avg = assignedStudents.length
    ? Math.round(assignedStudents.reduce((sum, stu) => sum + Number(stu.avg || 0), 0) / assignedStudents.length)
    : 0;
  document.getElementById('d-avg').textContent = assignedStudents.length ? `${avg}%` : '-';

  const colors = ['var(--green-bg)', 'var(--blue-bg)', 'var(--amber-bg)'];
  const cvals = ['var(--green)', 'var(--blue)', 'var(--amber)'];
  document.getElementById('d-classes').innerHTML = state.contexts.map((ctx, i) => {
    const result = resultFor(ctx.id, 'Mid-Term Exam');
    const entered = Object.keys(result.entries || {}).length;
    return `<div class="class-item" onclick="setContextFromCard(${ctx.id})">
      <div class="class-icon" style="background:${colors[i % colors.length]};color:${cvals[i % cvals.length]};">#</div>
      <div><div class="class-name">${escapeHtml(ctx.subjectName)} - ${escapeHtml(ctx.classLabel)}</div><div class="class-sub">${ctx.students.length} students</div></div>
      <div class="class-meta"><div class="class-avg" style="color:${cvals[i % cvals.length]};">${entered}/${ctx.students.length}</div><div class="class-count">mid-term saved</div></div>
    </div>`;
  }).join('') || '<div style="color:var(--text-3);font-size:12px;">No assigned contexts.</div>';

  const activities = [];
  state.contexts.forEach(ctx => {
    EXAM_TYPES.forEach(exam => {
      const result = resultFor(ctx.id, exam);
      if (Object.keys(result.entries || {}).length) {
        activities.push({
          text: `<strong>${escapeHtml(exam)}</strong> results saved for ${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)}`,
          time: result.savedAt,
          iso: result.savedAtIso || '',
        });
      }
    });
  });
  activities.sort((a, b) => String(b.iso).localeCompare(String(a.iso)));
  document.getElementById('d-activity').innerHTML = (activities.length ? activities : [{ text: 'No recent activity recorded yet.', time: '' }]).map(a =>
    `<div class="activity-item"><span class="act-dot" style="background:var(--green);"></span><div><div class="act-text">${a.text}</div>${a.time ? `<div class="act-time">${escapeHtml(a.time)}</div>` : ''}</div></div>`
  ).join('');

  const sorted = [...assignedStudents].sort((a, b) => Number(b.avg) - Number(a.avg));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  document.getElementById('d-stats').innerHTML = `
    <div class="perf-row"><span class="perf-key">Top Student</span><span class="perf-val pv-green">${top ? escapeHtml(top.name) : '-'}</span></div>
    <div class="perf-row"><span class="perf-key">Top Score</span><span class="perf-val pv-green">${top ? `${top.avg}%` : '-'}</span></div>
    <div class="perf-row"><span class="perf-key">Needs Support</span><span class="perf-val pv-red">${low ? escapeHtml(low.name) : '-'}</span></div>
    <div class="perf-row"><span class="perf-key">Contexts</span><span class="perf-val">${state.contexts.length}</span></div>`;

  const dist = {};
  assignedStudents.forEach(stu => {
    const grade = scoreToGrade(stu.avg);
    dist[grade] = (dist[grade] || 0) + 1;
  });
  const total = assignedStudents.length || 1;
  document.getElementById('d-grades').innerHTML = Object.entries(dist).map(([grade, count]) =>
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;">
      <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:${gradeColor(grade)};width:22px;">${grade}</span>
      <div style="flex:1;height:6px;background:var(--black-4);border-radius:99px;overflow:hidden;">
        <div style="width:${Math.round(count / total * 100)}%;height:100%;background:${gradeColor(grade)};border-radius:99px;"></div>
      </div>
      <span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;width:20px;text-align:right;">${count}</span>
    </div>`
  ).join('');
}

function populateStudents() {
  const tbody = document.getElementById('stu-tbody');
  const all = uniqueStudents().sort((a, b) => Number(b.avg) - Number(a.avg));
  tbody.innerHTML = '';
  all.forEach((student, i) => {
    const grade = scoreToGrade(student.avg);
    const tr = document.createElement('tr');
    tr.dataset.name = student.name.toLowerCase();
    tr.dataset.id = student.id.toLowerCase();
    tr.innerHTML = `
      <td><span style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px;">${i + 1}</span></td>
      <td><span class="stu-av">${escapeHtml(student.initials)}</span><strong>${escapeHtml(student.name)}</strong></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-3);">${escapeHtml(student.id)}</td>
      <td style="color:var(--text-2);">Class ${escapeHtml(student.cls)}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:700;">${student.avg}%</td>
      <td><span class="grade-pill ${gradeClass(student.avg)}">${grade}</span></td>
      <td><div class="att-bar"><div class="att-track"><div class="att-fill" style="width:${student.att}%;background:${student.att >= 90 ? 'var(--green)' : student.att >= 75 ? 'var(--amber)' : 'var(--red)'};"></div></div><span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${student.att}%</span></div></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('stu-subtitle').textContent = `${all.length} assigned students`;
  document.getElementById('stu-card-title').textContent = 'Assigned Student Roster';
}

function filterStudents() {
  const q = document.getElementById('stu-search').value.toLowerCase();
  document.querySelectorAll('#stu-tbody tr').forEach(tr => {
    tr.style.display = (tr.dataset.name.includes(q) || tr.dataset.id.includes(q)) ? '' : 'none';
  });
}

async function setContextFromCard(contextId) {
  const ctx = state.contexts.find(item => Number(item.id) === Number(contextId));
  if (!ctx) return;
  document.getElementById('re-class').value = ctx.classCode;
  populateSubjectControl(ctx.subjectId);
  document.getElementById('re-subject').value = String(ctx.subjectId);
  switchTab('results', null);
  await onContextChange();
}

async function onContextChange() {
  const classCode = document.getElementById('re-class').value;
  const previousSubject = document.getElementById('re-subject').value;
  populateSubjectControl(previousSubject);
  const examSelect = document.getElementById('re-examtype');
  if (!examSelect.value) examSelect.value = 'Mid-Term Exam';

  state.currentContext = findSelectedContext();
  state.currentExam = examSelect.value;
  state.currentStudentIndex = null;
  state.gridSearch = '';

  if (!state.currentContext || !state.currentExam) {
    document.getElementById('results-main').innerHTML = `<div class="ep-wrap"><div class="ep-icon">#</div><div class="ep-title">No Context Selected</div><div class="ep-desc">Choose one of your admin-assigned class and subject contexts.</div></div>`;
    return;
  }

  const students = await apiFetch(`/api/teacher/result-contexts/${state.currentContext.id}/students`);
  const result = await apiFetch(`/api/teacher/results?contextId=${encodeURIComponent(state.currentContext.id)}&examType=${encodeURIComponent(state.currentExam)}`);
  state.students = students.students || [];
  state.resultsByKey[entryKey(state.currentContext.id, state.currentExam)] = result.result;
  if (canRateSkills()) await loadSkillRatingsForContext();
  renderResultsGrid();
}

function renderResultsGrid() {
  const ctx = state.currentContext;
  const saved = resultFor(ctx.id, state.currentExam);
  const students = state.students;
  const entered = students.filter(student => saved.entries?.[student.id]?.total != null).length;
  const pct = students.length ? Math.round((entered / students.length) * 100) : 0;
  const q = state.gridSearch.toLowerCase();
  const filtered = q
    ? students.filter(student => student.name.toLowerCase().includes(q) || student.id.toLowerCase().includes(q))
    : students;

  const cards = filtered.map(student => {
    const idx = students.indexOf(student);
    const rec = saved.entries?.[student.id];
    const hasVal = rec && rec.total != null;
    return `<div class="stu-card ${hasVal ? 'sc-saved' : ''}" onclick="openStudentPanel(${idx})">
      ${hasVal ? `<span class="sc-score" style="color:${gradeColor(scoreToGrade(rec.total))};">${rec.total}</span>` : ''}
      <div class="sc-avatar">${escapeHtml(student.initials)}</div>
      <div class="sc-name">${escapeHtml(student.name)}</div>
      <div class="sc-id">${escapeHtml(student.id)}</div>
      <div class="sc-status"><span class="rs-dot ${hasVal ? 'rs-saved' : 'rs-missing'}"></span><span style="color:${hasVal ? 'var(--green)' : 'var(--text-3)'};">${hasVal ? 'Saved' : 'Empty'}</span></div>
    </div>`;
  }).join('');

  document.getElementById('results-main').innerHTML = `
    <div class="prog-wrap">
      <div class="prog-top">
        <span class="prog-title">${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)} - ${escapeHtml(state.currentExam)}</span>
        <span class="prog-count">${entered} / ${students.length} students entered</span>
      </div>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%;"></div></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-3);">${filtered.length} student${filtered.length !== 1 ? 's' : ''}</span>
      <input class="grid-search" id="grid-search-input" placeholder="Search student..." value="${escapeHtml(state.gridSearch)}" oninput="state.gridSearch=this.value;renderResultsGrid();" style="margin-left:auto;">
      <button class="vt-btn" onclick="switchToBulk()" title="Switch to bulk table view" style="white-space:nowrap;">Bulk Entry</button>
    </div>
    <div class="stu-grid">${cards || '<div style="color:var(--text-3);font-size:12px;padding:20px 0;">No students match your search.</div>'}</div>`;
}

async function openStudentPanel(idx) {
  state.currentStudentIndex = idx;
  if (canRateSkills()) await loadSkillRatingsForContext();
  renderStudentPanel();
}

function renderStudentPanel() {
  const idx = state.currentStudentIndex;
  const student = state.students[idx];
  const ctx = state.currentContext;
  const saved = resultFor(ctx.id, state.currentExam);
  const rec = saved.entries?.[student.id];
  const isCA = state.currentExam === 'Continuous Assessment';
  const caVal = rec ? rec.ca ?? '' : '';
  const exVal = rec ? rec.exam ?? '' : '';
  const total = rec ? rec.total : null;
  const grade = total != null ? scoreToGrade(total) : '-';
  const color = gradeColor(grade);
  const remark = total == null ? '' : total >= 80 ? 'Excellent' : total >= 65 ? 'Very Good' : total >= 50 ? 'Good' : 'Below Average';
  const remarkClass = total == null ? '' : total >= 80 ? 'rm-ex' : total >= 65 ? 'rm-vg' : total >= 50 ? 'rm-gd' : 'rm-av';

  document.getElementById('results-main').innerHTML = `
    <div class="entry-panel">
      <div class="ep-nav">
        <button class="ep-back-btn" onclick="backToGrid()">Back to Students</button>
        <span style="font-size:11px;color:var(--text-3);">Student ${idx + 1} of ${state.students.length}</span>
        <div class="ep-nav-arrows">
          <button class="ep-arr-btn" onclick="navigateStudent(-1)" ${idx <= 0 ? 'disabled' : ''} title="Previous student">&lt;</button>
          <button class="ep-arr-btn" onclick="navigateStudent(1)" ${idx >= state.students.length - 1 ? 'disabled' : ''} title="Next student">&gt;</button>
        </div>
      </div>
      <div class="ep-who">
        <div class="ep-who-av">${escapeHtml(student.initials)}</div>
        <div><div class="ep-who-name">${escapeHtml(student.name)}</div><div class="ep-who-id">${escapeHtml(student.id)}</div></div>
        <div class="ep-who-pos"><div class="ep-pos-num">${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)}</div><div class="ep-pos-num" style="margin-top:2px;">${escapeHtml(state.currentExam)}</div></div>
      </div>
      <div class="ep-score-row">
        <div class="ep-score-box">
          <div class="ep-score-lbl">Continuous Assessment <span style="opacity:0.5;">(max 30)</span></div>
          <input type="number" min="0" max="30" id="ep-ca" class="ep-input-big${caVal !== '' ? ' has-val' : ''}" value="${caVal}" placeholder="-" oninput="epCalc('${student.id}','${isCA ? 'ca' : 'both'}')">
          <div class="ep-max-lbl">out of 30</div>
        </div>
        ${!isCA ? `<div class="ep-score-box">
          <div class="ep-score-lbl">Examination Score <span style="opacity:0.5;">(max 70)</span></div>
          <input type="number" min="0" max="70" id="ep-ex" class="ep-input-big${exVal !== '' ? ' has-val' : ''}" value="${exVal}" placeholder="-" oninput="epCalc('${student.id}','both')">
          <div class="ep-max-lbl">out of 70</div>
        </div>` : `<div class="ep-score-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;"><div style="font-size:11px;color:var(--text-3);">CA-only exam</div><div style="font-size:11px;color:var(--text-3);">No exam score required</div></div>`}
      </div>
      <div class="ep-result-box">
        <div class="ep-total-block"><div class="ep-total-num" id="ep-total" style="color:${color};">${total != null ? total : '-'}</div><div class="ep-total-lbl">Total Score</div></div>
        <div style="width:1px;height:50px;background:var(--border);"></div>
        <div class="ep-grade-block"><div class="ep-grade-lbl2">Grade</div><div class="ep-grade-big" id="ep-grade" style="color:${color};">${grade}</div></div>
        <div style="width:1px;height:50px;background:var(--border);"></div>
        <div class="ep-remark">${remark ? `<span class="ep-remark-tag remark-tag ${remarkClass}" id="ep-remark-tag">${remark}</span>` : `<span id="ep-remark-tag" style="font-size:11px;color:var(--text-3);">Enter scores to see remark</span>`}</div>
        <div style="margin-left:auto;font-size:10px;color:${rec ? 'var(--green)' : 'var(--text-3)'};font-family:'DM Mono',monospace;" id="ep-saved-at">${rec ? `Saved - ${escapeHtml(saved.savedAt)}` : 'Unsaved'}</div>
      </div>
      ${renderSkillRatingsPanel(student)}
      <div class="ep-actions">
        <button class="ep-clear-btn" onclick="epClear('${student.id}')">Clear</button>
        <button class="ep-save-btn" onclick="epSave('${student.id}', '${isCA ? 'ca' : 'both'}')">Save Score</button>
      </div>
    </div>`;
}

function renderSkillRatingsPanel(student) {
  if (!canRateSkills()) return '';
  const ratings = skillRatingsFor(state.currentContext.id, state.currentExam)[student.id] || {};
  const groupHtml = SKILL_GROUPS.map(group => `
    <div style="background:var(--black-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-1);">${escapeHtml(group.title)}</div>
        <span style="font-size:9px;color:var(--text-3);font-family:'DM Mono',monospace;">Scale 1-5</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
        ${group.skills.map(([key, label]) => {
          const value = ratings[group.key]?.[key] ?? '';
          return `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--black-3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;">
            <span style="font-size:11px;color:var(--text-2);line-height:1.25;">${escapeHtml(label)}</span>
            <select class="ctrl-select" id="skill-${group.key}-${key}" style="min-width:64px;width:64px;padding:6px 8px;font-family:'DM Mono',monospace;">
              <option value="">-</option>
              ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(value) === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>`;
        }).join('')}
      </div>
    </div>`).join('');
  return `
    <div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--text-1);">Class Teacher Skills Rating</div>
          <div style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;margin-top:2px;">These ratings print on the PDF result.</div>
        </div>
        <button class="ep-save-btn" onclick="saveSkillRatings('${escapeHtml(student.id)}')" style="padding:8px 16px;font-size:12px;">Save Skills</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">${groupHtml}</div>
      <div style="font-size:10px;color:${ratings.updatedAt ? 'var(--green)' : 'var(--text-3)'};font-family:'DM Mono',monospace;margin-top:8px;" id="skill-saved-at">${ratings.updatedAt ? `Skills saved - ${escapeHtml(ratings.updatedAt)}` : 'Skills not saved yet'}</div>
    </div>`;
}

function epCalc(stuId, mode) {
  const caEl = document.getElementById('ep-ca');
  const exEl = document.getElementById('ep-ex');
  const totalEl = document.getElementById('ep-total');
  const gradeEl = document.getElementById('ep-grade');
  const remarkEl = document.getElementById('ep-remark-tag');
  const savedEl = document.getElementById('ep-saved-at');
  const ca = caEl ? parseInt(caEl.value, 10) : NaN;
  const ex = exEl ? parseInt(exEl.value, 10) : NaN;

  if (caEl) {
    caEl.classList.toggle('err-val', caEl.value !== '' && (Number.isNaN(ca) || ca < 0 || ca > 30));
    caEl.classList.toggle('has-val', caEl.value !== '' && !caEl.classList.contains('err-val'));
  }
  if (exEl) {
    exEl.classList.toggle('err-val', exEl.value !== '' && (Number.isNaN(ex) || ex < 0 || ex > 70));
    exEl.classList.toggle('has-val', exEl.value !== '' && !exEl.classList.contains('err-val'));
  }

  let total = null;
  if (mode === 'ca' && caEl.value !== '' && !Number.isNaN(ca)) total = ca;
  if (mode === 'both' && caEl.value !== '' && !Number.isNaN(ca) && exEl?.value !== '' && !Number.isNaN(ex)) total = ca + ex;

  if (total != null) {
    const grade = scoreToGrade(total);
    const color = gradeColor(grade);
    const remark = total >= 80 ? 'Excellent' : total >= 65 ? 'Very Good' : total >= 50 ? 'Good' : 'Below Average';
    const remarkClass = total >= 80 ? 'rm-ex' : total >= 65 ? 'rm-vg' : total >= 50 ? 'rm-gd' : 'rm-av';
    totalEl.textContent = total;
    totalEl.style.color = color;
    gradeEl.textContent = grade;
    gradeEl.style.color = color;
    remarkEl.textContent = remark;
    remarkEl.className = `ep-remark-tag remark-tag ${remarkClass}`;
    savedEl.textContent = 'Unsaved';
    savedEl.style.color = 'var(--amber)';
  } else {
    totalEl.textContent = '-';
    totalEl.style.color = 'var(--text-3)';
    gradeEl.textContent = '-';
    gradeEl.style.color = 'var(--text-3)';
    remarkEl.textContent = 'Enter scores to see remark';
    remarkEl.className = '';
    savedEl.textContent = 'Unsaved';
    savedEl.style.color = 'var(--text-3)';
  }
}

async function epSave(stuId, mode) {
  const caEl = document.getElementById('ep-ca');
  const exEl = document.getElementById('ep-ex');
  const ca = caEl && caEl.value !== '' ? parseInt(caEl.value, 10) : null;
  const ex = exEl && exEl.value !== '' ? parseInt(exEl.value, 10) : null;
  if (ca === null) return showToast('Enter a CA score');
  if (ca < 0 || ca > 30) return showToast('CA score must be 0-30');
  if (mode === 'both' && ex === null) return showToast('Enter an exam score');
  if (mode === 'both' && (ex < 0 || ex > 70)) return showToast('Exam score must be 0-70');

  try {
    const data = await apiFetch('/api/teacher/results', {
      method: 'POST',
      body: JSON.stringify({
        contextId: state.currentContext.id,
        examType: state.currentExam,
        replaceAll: false,
        entries: [{ studentId: stuId, ca, exam: ex }],
      }),
    });
    state.resultsByKey[entryKey(state.currentContext.id, state.currentExam)] = data.result;
    showToast(`Score saved for ${state.students[state.currentStudentIndex].name}`);
    populateDashboard();
    renderPublished();
    if (state.currentStudentIndex < state.students.length - 1) {
      setTimeout(() => {
        state.currentStudentIndex += 1;
        renderStudentPanel();
      }, 500);
    } else {
      renderStudentPanel();
    }
  } catch (err) {
    showToast(err.message);
  }
}

function collectSkillRatings() {
  const payload = { affective: {}, psychomotor: {} };
  for (const group of SKILL_GROUPS) {
    for (const [key, label] of group.skills) {
      const el = document.getElementById(`skill-${group.key}-${key}`);
      const value = Number(el?.value);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error(`Rate ${label} from 1 to 5`);
      }
      payload[group.key][key] = value;
    }
  }
  return payload;
}

async function saveSkillRatings(stuId) {
  if (!canRateSkills()) return showToast('Only class teachers can save skill ratings');
  let ratings;
  try {
    ratings = collectSkillRatings();
  } catch (err) {
    showToast(err.message);
    return;
  }
  try {
    const data = await apiFetch('/api/teacher/skills', {
      method: 'POST',
      body: JSON.stringify({
        contextId: state.currentContext.id,
        examType: state.currentExam,
        studentId: stuId,
        ...ratings,
      }),
    });
    const key = skillsKey(state.currentContext.id, state.currentExam);
    state.skillRatingsByKey[key] = {
      ...(state.skillRatingsByKey[key] || {}),
      [stuId]: data.rating,
    };
    const savedAt = document.getElementById('skill-saved-at');
    if (savedAt) {
      savedAt.textContent = `Skills saved - ${data.rating.updatedAt}`;
      savedAt.style.color = 'var(--green)';
    }
    showToast('Skill ratings saved');
  } catch (err) {
    showToast(err.message);
  }
}

function epClear(stuId) {
  const caEl = document.getElementById('ep-ca');
  const exEl = document.getElementById('ep-ex');
  if (caEl) {
    caEl.value = '';
    caEl.classList.remove('has-val', 'err-val');
  }
  if (exEl) {
    exEl.value = '';
    exEl.classList.remove('has-val', 'err-val');
  }
  epCalc(stuId, exEl ? 'both' : 'ca');
}

function backToGrid() {
  state.currentStudentIndex = null;
  renderResultsGrid();
}

function navigateStudent(dir) {
  const next = state.currentStudentIndex + dir;
  if (next < 0 || next >= state.students.length) return;
  state.currentStudentIndex = next;
  renderStudentPanel();
}

function switchToBulk() {
  const ctx = state.currentContext;
  const saved = resultFor(ctx.id, state.currentExam);
  const isCA = state.currentExam === 'Continuous Assessment';
  const students = state.students;
  const vals = Object.values(saved.entries || {}).map(entry => entry.total).filter(value => value != null);
  const avg = vals.length ? Math.round(vals.reduce((sum, value) => sum + value, 0) / vals.length) : 0;

  const rows = students.map(student => {
    const rec = saved.entries?.[student.id];
    const caV = rec ? rec.ca ?? '' : '';
    const exV = rec ? rec.exam ?? '' : '';
    const total = rec ? rec.total : '';
    const grade = total !== '' && total != null ? scoreToGrade(total) : '-';
    const color = gradeColor(grade);
    return `<tr id="row-${student.id}">
      <td><div class="stu-cell"><span class="stu-av">${escapeHtml(student.initials)}</span><div><div class="stu-full">${escapeHtml(student.name)}</div><div class="stu-id">${escapeHtml(student.id)}</div></div></div></td>
      <td><div class="score-wrap"><input type="number" min="0" max="30" class="score-input${caV !== '' ? ' has-val' : ''}" id="ca-${student.id}" value="${caV}" placeholder="-" oninput="calcRow('${student.id}','${isCA ? 'ca' : 'both'}')"><span class="max-lbl">/30</span></div></td>
      ${!isCA ? `<td><div class="score-wrap"><input type="number" min="0" max="70" class="score-input${exV !== '' ? ' has-val' : ''}" id="ex-${student.id}" value="${exV}" placeholder="-" oninput="calcRow('${student.id}','both')"><span class="max-lbl">/70</span></div></td>` : ''}
      <td class="tot-cell" id="tot-${student.id}" style="color:${total !== '' && total != null ? color : 'var(--text-3)'};">${total !== '' && total != null ? total : '-'}</td>
      <td class="grade-cell"><span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:${color};" id="grd-${student.id}">${grade}</span></td>
      <td class="stat-cell" id="sta-${student.id}"><span class="rs-dot ${rec ? 'rs-saved' : 'rs-missing'}"></span><span class="rs-lbl" style="color:${rec ? 'var(--green)' : 'var(--text-3)'};">${rec ? 'Saved' : 'Empty'}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('results-main').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <button class="ep-back-btn" onclick="renderResultsGrid()">Back to Student Grid</button>
      <span style="font-size:11px;color:var(--text-3);margin-left:4px;">Bulk entry: ${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)} - ${escapeHtml(state.currentExam)}</span>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)} - ${escapeHtml(state.currentExam)}</span><span style="font-size:10px;color:${saved.savedAt ? 'var(--green)' : 'var(--amber)'};font-family:'DM Mono',monospace;">${saved.savedAt ? `Saved - ${escapeHtml(saved.savedAt)}` : 'Not yet saved'}</span></div>
      <div style="padding:14px 18px 0;"><div class="summary-bar"><div class="sb-item"><div class="sb-val">${students.length}</div><div class="sb-lbl">Students</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${avg || '-'}</div><div class="sb-lbl">Class Avg</div></div></div></div>
      <div style="padding:0 18px;overflow-x:auto;"><table class="entry-table"><thead><tr><th style="min-width:200px;">Student</th><th class="c">CA /30</th>${!isCA ? '<th class="c">Exam /70</th>' : ''}<th class="c">Total</th><th class="c">Grade</th><th class="c">Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="padding:12px 18px 18px;" class="tbl-actions"><button class="act-btn btn-clear" onclick="clearSheet()">Clear All</button><button class="act-btn btn-exp" onclick="showToast('Export feature coming soon')">Export CSV</button><button class="act-btn btn-save" onclick="saveResults()">Save All</button></div>
    </div>`;
}

function calcRow(stuId, mode) {
  const caEl = document.getElementById(`ca-${stuId}`);
  const exEl = document.getElementById(`ex-${stuId}`);
  const totalEl = document.getElementById(`tot-${stuId}`);
  const gradeEl = document.getElementById(`grd-${stuId}`);
  const statusEl = document.getElementById(`sta-${stuId}`);
  const ca = caEl ? parseInt(caEl.value, 10) : NaN;
  const ex = exEl ? parseInt(exEl.value, 10) : NaN;

  if (caEl) {
    caEl.classList.toggle('err-val', caEl.value !== '' && (Number.isNaN(ca) || ca < 0 || ca > 30));
    caEl.classList.toggle('has-val', caEl.value !== '' && !caEl.classList.contains('err-val'));
  }
  if (exEl) {
    exEl.classList.toggle('err-val', exEl.value !== '' && (Number.isNaN(ex) || ex < 0 || ex > 70));
    exEl.classList.toggle('has-val', exEl.value !== '' && !exEl.classList.contains('err-val'));
  }

  let total = null;
  if (mode === 'ca' && caEl.value !== '' && !Number.isNaN(ca)) total = ca;
  if (mode === 'both' && caEl.value !== '' && !Number.isNaN(ca) && exEl?.value !== '' && !Number.isNaN(ex)) total = ca + ex;

  if (total != null) {
    const grade = scoreToGrade(total);
    totalEl.textContent = total;
    totalEl.style.color = gradeColor(grade);
    gradeEl.textContent = grade;
    gradeEl.style.color = gradeColor(grade);
    statusEl.innerHTML = '<span class="rs-dot rs-unsaved"></span><span class="rs-lbl" style="color:var(--amber);">Unsaved</span>';
  } else {
    totalEl.textContent = '-';
    totalEl.style.color = 'var(--text-3)';
    gradeEl.textContent = '-';
    gradeEl.style.color = 'var(--text-3)';
    statusEl.innerHTML = '<span class="rs-dot rs-missing"></span><span class="rs-lbl" style="color:var(--text-3);">Empty</span>';
  }
}

async function saveResults() {
  const entries = [];
  for (const student of state.students) {
    const caEl = document.getElementById(`ca-${student.id}`);
    const exEl = document.getElementById(`ex-${student.id}`);
    if (!caEl || caEl.value === '') continue;
    entries.push({
      studentId: student.id,
      ca: parseInt(caEl.value, 10),
      exam: exEl && exEl.value !== '' ? parseInt(exEl.value, 10) : null,
    });
  }
  if (!entries.length) return showToast('Enter at least one score before saving');
  try {
    const data = await apiFetch('/api/teacher/results', {
      method: 'POST',
      body: JSON.stringify({
        contextId: state.currentContext.id,
        examType: state.currentExam,
        replaceAll: true,
        entries,
      }),
    });
    state.resultsByKey[entryKey(state.currentContext.id, state.currentExam)] = data.result;
    populateDashboard();
    renderPublished();
    showToast(`${entries.length} result${entries.length === 1 ? '' : 's'} saved successfully`);
    switchToBulk();
  } catch (err) {
    showToast(err.message);
  }
}

function clearSheet() {
  state.students.forEach(student => {
    ['ca', 'ex'].forEach(prefix => {
      const el = document.getElementById(`${prefix}-${student.id}`);
      if (el) {
        el.value = '';
        el.classList.remove('has-val', 'err-val');
      }
    });
    const totalEl = document.getElementById(`tot-${student.id}`);
    const gradeEl = document.getElementById(`grd-${student.id}`);
    const statusEl = document.getElementById(`sta-${student.id}`);
    if (totalEl) {
      totalEl.textContent = '-';
      totalEl.style.color = 'var(--text-3)';
    }
    if (gradeEl) {
      gradeEl.textContent = '-';
      gradeEl.style.color = 'var(--text-3)';
    }
    if (statusEl) statusEl.innerHTML = '<span class="rs-dot rs-missing"></span><span class="rs-lbl" style="color:var(--text-3);">Empty</span>';
  });
}

function renderPublished() {
  const container = document.getElementById('pub-content');
  const records = [];
  state.contexts.forEach(ctx => {
    EXAM_TYPES.forEach(exam => {
      const result = resultFor(ctx.id, exam);
      if (Object.keys(result.entries || {}).length) records.push({ ctx, exam, result });
    });
  });

  if (!records.length) {
    container.innerHTML = `<div class="card"><div class="card-body"><div class="ep-wrap"><div class="ep-icon">#</div><div class="ep-title">No Published Results Yet</div><div class="ep-desc">Save results from the Results Entry tab and they will appear here.</div></div></div></div>`;
    return;
  }

  container.innerHTML = records.map(({ ctx, exam, result }) => {
    const studentsById = Object.fromEntries((ctx.students || []).map(student => [student.id, student]));
    const ranked = Object.entries(result.entries).map(([studentId, entry]) => ({
      student: studentsById[studentId],
      entry,
    })).filter(row => row.student).sort((a, b) => Number(b.entry.total) - Number(a.entry.total));
    const totals = ranked.map(row => Number(row.entry.total));
    const avg = totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0;
    const pass = totals.filter(value => value >= 50).length;
    const hasExam = exam !== 'Continuous Assessment';
    return `<div class="card" style="margin-bottom:14px;">
      <div class="card-head"><span class="card-title">${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)} - ${escapeHtml(exam)}</span><span style="font-size:10px;color:var(--green);font-family:'DM Mono',monospace;">Saved ${escapeHtml(result.savedAt)}</span></div>
      <div style="padding:12px 18px 4px;display:flex;gap:10px;flex-wrap:wrap;"><div class="sb-item"><div class="sb-val">${ranked.length}</div><div class="sb-lbl">Entries</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${avg}%</div><div class="sb-lbl">Avg Score</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${pass}/${ranked.length}</div><div class="sb-lbl">Passed</div></div></div>
      <div class="card-body" style="padding:0 18px 18px;"><div class="pub-table-wrap"><table class="pub-table">
        <thead><tr><th>#</th><th>Student</th>${hasExam ? '<th>CA /30</th><th>Exam /70</th>' : '<th>Score /30</th>'}<th>Total</th><th>Grade</th><th>Remark</th></tr></thead>
        <tbody>${ranked.map((row, i) => {
          const grade = scoreToGrade(row.entry.total);
          const color = gradeColor(grade);
          const remark = row.entry.total >= 80 ? 'Excellent' : row.entry.total >= 65 ? 'Very Good' : row.entry.total >= 50 ? 'Good' : 'Below Average';
          const remarkClass = row.entry.total >= 80 ? 'rm-ex' : row.entry.total >= 65 ? 'rm-vg' : row.entry.total >= 50 ? 'rm-gd' : 'rm-av';
          return `<tr><td style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px;">${i + 1}</td><td><span class="stu-av" style="margin-right:6px;">${escapeHtml(row.student.initials)}</span><strong>${escapeHtml(row.student.name)}</strong></td>${hasExam ? `<td style="font-family:'DM Mono',monospace;">${row.entry.ca}</td><td style="font-family:'DM Mono',monospace;">${row.entry.exam ?? '-'}</td>` : `<td style="font-family:'DM Mono',monospace;">${row.entry.ca}</td>`}<td style="font-family:'DM Mono',monospace;font-weight:700;color:${color};">${row.entry.total}</td><td><span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:${color};">${grade}</span></td><td><span class="remark-tag ${remarkClass}">${remark}</span></td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>`;
  }).join('');
}

const TAB_META = {
  dashboard: { title: 'Dashboard', sub: 'Wednesday, 13 May 2026' },
  students: { title: 'Students', sub: 'Class Roster' },
  results: { title: 'Results Entry', sub: 'Enter Examination Scores' },
  published: { title: 'Published Results', sub: 'Saved Exam Records' },
  announcements: { title: 'Announcements', sub: 'School Notices' },
};

function switchTab(tab, trigger) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (trigger) trigger.classList.add('active');
  const meta = TAB_META[tab] || {};
  document.getElementById('topbar-title').textContent = meta.title || tab;
  document.getElementById('topbar-sub').textContent = meta.sub || '';
  if (tab === 'published') renderPublished();
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ls_user_id');
  localStorage.removeItem('ls_user_role');
  window.location.href = 'index.html';
}

init();
