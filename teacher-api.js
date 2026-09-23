const EXAM_TYPES = ['Mid-Term Exam', 'Final Exam'];
function caMaxForExamType(examType) {
  return examType === 'Mid-Term Exam' ? 40 : 30;
}
function totalMaxForExamType(examType) {
  return examType === 'Final Exam' ? 100 : caMaxForExamType(examType);
}
function pctForExam(total, examType) {
  if (total == null) return null;
  const max = totalMaxForExamType(examType);
  return max === 100 ? total : Math.round((total / max) * 100);
}
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
  commentsByKey: {},
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

function exportResultsCsv() {
  const ctx = state.contexts.find(c => c.id === state.currentContext);
  const name = ctx ? `${ctx.classLabel}-${ctx.subjectName}-${state.currentExam}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'results';
  exportTableToCsv('#entry-table-el', `${name}.csv`);
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

function commentFor(contextId, examType, studentId) {
  return (state.commentsByKey[skillsKey(contextId, examType)] || {})[studentId]?.comment || '';
}

async function loadCommentsForContext(ctx = state.currentContext, examType = state.currentExam) {
  if (!canRateSkills(ctx) || !examType) return;
  const data = await apiFetch(`/api/teacher/report-comments?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`);
  state.commentsByKey[skillsKey(ctx.id, examType)] = data.comments || {};
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

async function loadTopbarSession() {
  try {
    const active = await apiFetch('/api/active-term');
    if (!active || !active.sessionLabel) return;
    const el  = document.getElementById('tsi-session');
    const el2 = document.getElementById('tsi-term');
    const box = document.getElementById('topbar-session-info');
    if (el)  el.textContent  = active.sessionLabel || '—';
    if (el2) el2.textContent = active.termLabel    || '—';
    if (box) box.style.display = 'flex';
  } catch(e) {}
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
    const chipEl = document.getElementById('t-chip'); if (chipEl) chipEl.textContent = teacher.chip || teacher.name.toUpperCase();
    document.getElementById('t-greeting').textContent = `${greeting()}, ${teacher.firstName}.`;
    document.title = `Unique Children's School - ${teacher.name}`;
    loadTopbarSession();

    const subjects = [...new Set(state.contexts.map(ctx => ctx.subjectName))];
    document.getElementById('t-subj').textContent = subjects.join(', ') || 'No assignments';
    document.getElementById('ctx-session').textContent = `${state.academic.sessionLabel} - ${state.academic.termLabel}`;
    document.getElementById('re-examtype').value = 'Mid-Term Exam';

    if (!state.contexts.length) {
      document.getElementById('results-main').innerHTML = `<div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"/><line x1="8" y1="5" x2="8" y2="9.2"/><circle cx="8" cy="11.3" r="0.2" fill="currentColor" stroke="none"/></svg></div><div class="ep-title">No Assignments</div><div class="ep-desc">Ask the admin to assign classes and subjects before uploading results.</div></div>`;
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
    document.getElementById('results-main').innerHTML = `<div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12.5" rx="1.5"/><line x1="5.5" y1="7" x2="10.5" y2="7"/><line x1="5.5" y1="10" x2="10.5" y2="10"/><line x1="5.5" y1="4.5" x2="8" y2="4.5"/></svg></div><div class="ep-title">No Context Selected</div><div class="ep-desc">Choose one of your admin-assigned class and subject contexts.</div></div>`;
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
  const isCA = state.currentExam !== 'Final Exam';
  const caMax = caMaxForExamType(state.currentExam);
  const students = state.students;
  const entered = students.filter(student => saved.entries?.[student.id]?.total != null).length;
  const pct = students.length ? Math.round((entered / students.length) * 100) : 0;
  const vals = Object.values(saved.entries || {}).map(entry => entry.total).filter(value => value != null);
  const avg = vals.length ? Math.round(vals.reduce((sum, value) => sum + value, 0) / vals.length) : null;

  const q = state.gridSearch.toLowerCase();
  const filtered = q
    ? students.filter(student => student.name.toLowerCase().includes(q) || student.id.toLowerCase().includes(q))
    : students;

  const rows = filtered.map(student => {
    const idx = students.indexOf(student);
    const rec = saved.entries?.[student.id];
    const caV = rec ? rec.ca ?? '' : '';
    const exV = rec ? rec.exam ?? '' : '';
    const total = rec ? rec.total : null;
    const scorePct = pctForExam(total, state.currentExam);
    const grade = scorePct != null ? scoreToGrade(scorePct) : '-';
    const color = gradeColor(grade);
    const statusChip = rec ? '<span class="chip-green">Saved</span>' : '<span class="chip-gray">Empty</span>';
    return `<tr id="row-${student.id}" class="${rec ? 'row-saved' : ''}">
      <td><div class="stu-cell"><span class="stu-av">${escapeHtml(student.initials)}</span><div><div class="stu-full">${escapeHtml(student.name)}</div><div class="stu-id">${escapeHtml(student.id)}</div></div></div></td>
      <td><div class="score-wrap"><input type="number" min="0" max="${caMax}" class="score-input${caV !== '' ? ' has-val' : ''}" id="ca-${student.id}" value="${caV}" placeholder="-" oninput="calcRow('${student.id}','${isCA ? 'ca' : 'both'}')"><span class="max-lbl">/${caMax}</span></div></td>
      ${!isCA ? `<td><div class="score-wrap"><input type="number" min="0" max="70" class="score-input${exV !== '' ? ' has-val' : ''}" id="ex-${student.id}" value="${exV}" placeholder="-" oninput="calcRow('${student.id}','both')"><span class="max-lbl">/70</span></div></td>` : ''}
      <td class="tot-cell" id="tot-${student.id}" style="color:${total != null ? color : 'var(--text-3)'};">${total != null ? total : '-'}</td>
      <td class="grade-cell"><span class="grade-pill ${scorePct != null ? gradeClass(scorePct) : ''}" id="grd-${student.id}" style="${total == null ? 'background:var(--black-3);color:var(--text-3);' : ''}">${grade}</span></td>
      <td class="stat-cell" id="sta-${student.id}">${statusChip}</td>
      <td class="act-cell"><button class="row-open-btn" onclick="openStudentPanel(${idx})" title="Open focused entry for ${escapeHtml(student.name)}">Open</button></td>
    </tr>`;
  }).join('');

  document.getElementById('results-main').innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <span class="card-title">${escapeHtml(ctx.classLabel)} &middot; ${escapeHtml(ctx.subjectName)} &middot; ${escapeHtml(state.currentExam)}</span>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px;font-family:'DM Mono',monospace;">${entered} / ${students.length} entered${avg != null ? ` &middot; Class avg ${avg}` : ''}</div>
        </div>
        <span class="${saved.savedAt ? 'chip-green' : 'chip-amber'}">${saved.savedAt ? `Saved - ${escapeHtml(saved.savedAt)}` : 'Not yet saved'}</span>
      </div>
      <div class="card-body">
        <div class="prog-track" style="margin-bottom:16px;"><div class="prog-fill" style="width:${pct}%;"></div></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--text-3);">${filtered.length} student${filtered.length !== 1 ? 's' : ''}</span>
          <input class="grid-search" id="grid-search-input" placeholder="Search student..." value="${escapeHtml(state.gridSearch)}" oninput="state.gridSearch=this.value;renderResultsGrid();" style="margin-left:auto;">
        </div>
        <div class="entry-table-wrap">
          <table class="entry-table" id="entry-table-el">
            <thead><tr>
              <th style="min-width:190px;">Student</th>
              <th class="c">CA /${caMax}</th>
              ${!isCA ? '<th class="c">Exam /70</th>' : ''}
              <th class="c">Total</th>
              <th class="c">Grade</th>
              <th class="c">Status</th>
              <th class="c">&nbsp;</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:24px;background:var(--black-2);">No students match your search.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="tbl-actions"><button class="act-btn btn-clear" onclick="clearSheet()">Clear All</button><button class="act-btn btn-exp" onclick="exportResultsCsv()">Export CSV</button><button class="act-btn btn-save" onclick="saveResults()">Save All</button></div>
      </div>
    </div>`;
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
  const isCA = state.currentExam !== 'Final Exam';
  const caMax = caMaxForExamType(state.currentExam);
  const caLabel = isCA ? 'Mid-Term Score' : 'Continuous Assessment';
  const caVal = rec ? rec.ca ?? '' : '';
  const exVal = rec ? rec.exam ?? '' : '';
  const total = rec ? rec.total : null;
  const scorePct = pctForExam(total, state.currentExam);
  const grade = scorePct != null ? scoreToGrade(scorePct) : '-';
  const color = gradeColor(grade);
  const remark = scorePct == null ? '' : scorePct >= 80 ? 'Excellent' : scorePct >= 65 ? 'Very Good' : scorePct >= 50 ? 'Good' : 'Below Average';
  const remarkClass = scorePct == null ? '' : scorePct >= 80 ? 'rm-ex' : scorePct >= 65 ? 'rm-vg' : scorePct >= 50 ? 'rm-gd' : 'rm-av';

  document.getElementById('results-main').innerHTML = `
    <div class="entry-panel">
      <div class="ep-nav">
        <button class="ep-back-btn" onclick="backToGrid()">&larr; Back to Grid</button>
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
          <div class="ep-score-lbl">${caLabel} <span style="opacity:0.5;">(max ${caMax})</span></div>
          <input type="number" min="0" max="${caMax}" id="ep-ca" class="ep-input-big${caVal !== '' ? ' has-val' : ''}" value="${caVal}" placeholder="-" oninput="epCalc('${student.id}','${isCA ? 'ca' : 'both'}')">
          <div class="ep-max-lbl">out of ${caMax}</div>
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
  const caMax = caMaxForExamType(state.currentExam);

  if (caEl) {
    caEl.classList.toggle('err-val', caEl.value !== '' && (Number.isNaN(ca) || ca < 0 || ca > caMax));
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
    const scorePct = pctForExam(total, state.currentExam);
    const grade = scoreToGrade(scorePct);
    const color = gradeColor(grade);
    const remark = scorePct >= 80 ? 'Excellent' : scorePct >= 65 ? 'Very Good' : scorePct >= 50 ? 'Good' : 'Below Average';
    const remarkClass = scorePct >= 80 ? 'rm-ex' : scorePct >= 65 ? 'rm-vg' : scorePct >= 50 ? 'rm-gd' : 'rm-av';
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
  const caMax = caMaxForExamType(state.currentExam);
  if (ca === null) return showToast('Enter a CA score');
  if (ca < 0 || ca > caMax) return showToast(`CA score must be 0-${caMax}`);
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

function calcRow(stuId, mode) {
  const caEl = document.getElementById(`ca-${stuId}`);
  const exEl = document.getElementById(`ex-${stuId}`);
  const totalEl = document.getElementById(`tot-${stuId}`);
  const gradeEl = document.getElementById(`grd-${stuId}`);
  const statusEl = document.getElementById(`sta-${stuId}`);
  const ca = caEl ? parseInt(caEl.value, 10) : NaN;
  const ex = exEl ? parseInt(exEl.value, 10) : NaN;
  const caMax = caMaxForExamType(state.currentExam);

  if (caEl) {
    caEl.classList.toggle('err-val', caEl.value !== '' && (Number.isNaN(ca) || ca < 0 || ca > caMax));
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
    const scorePct = pctForExam(total, state.currentExam);
    const grade = scoreToGrade(scorePct);
    totalEl.textContent = total;
    totalEl.style.color = gradeColor(grade);
    gradeEl.textContent = grade;
    gradeEl.className = `grade-pill ${gradeClass(scorePct)}`;
    gradeEl.style.cssText = '';
    statusEl.innerHTML = '<span class="chip-amber">Unsaved</span>';
  } else {
    totalEl.textContent = '-';
    totalEl.style.color = 'var(--text-3)';
    gradeEl.textContent = '-';
    gradeEl.className = 'grade-pill';
    gradeEl.style.cssText = 'background:var(--black-3);color:var(--text-3);';
    statusEl.innerHTML = '<span class="chip-gray">Empty</span>';
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
    renderResultsGrid();
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
    const rowEl = document.getElementById(`row-${student.id}`);
    if (rowEl) rowEl.classList.remove('row-saved');
    const totalEl = document.getElementById(`tot-${student.id}`);
    const gradeEl = document.getElementById(`grd-${student.id}`);
    const statusEl = document.getElementById(`sta-${student.id}`);
    if (totalEl) {
      totalEl.textContent = '-';
      totalEl.style.color = 'var(--text-3)';
    }
    if (gradeEl) {
      gradeEl.textContent = '-';
      gradeEl.className = 'grade-pill';
      gradeEl.style.cssText = 'background:var(--black-3);color:var(--text-3);';
    }
    if (statusEl) statusEl.innerHTML = '<span class="chip-gray">Empty</span>';
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
    container.innerHTML = `<div class="card"><div class="card-body"><div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><polyline points="5,8.5 7,10.5 11.5,6"/></svg></div><div class="ep-title">No Published Results Yet</div><div class="ep-desc">Save results from the Results Entry tab and they will appear here.</div></div></div></div>`;
    return;
  }

  container.innerHTML = records.map(({ ctx, exam, result }) => {
    const studentsById = Object.fromEntries((ctx.students || []).map(student => [student.id, student]));
    const ranked = Object.entries(result.entries).map(([studentId, entry]) => ({
      student: studentsById[studentId],
      entry,
    })).filter(row => row.student).sort((a, b) => Number(b.entry.total) - Number(a.entry.total));
    const examCaMax = caMaxForExamType(exam);
    const pcts = ranked.map(row => pctForExam(Number(row.entry.total), exam));
    const avg = pcts.length ? Math.round(pcts.reduce((sum, value) => sum + value, 0) / pcts.length) : 0;
    const pass = pcts.filter(value => value >= 50).length;
    const hasExam = exam === 'Final Exam';
    return `<div class="card" style="margin-bottom:14px;">
      <div class="card-head"><span class="card-title">${escapeHtml(ctx.classLabel)} - ${escapeHtml(ctx.subjectName)} - ${escapeHtml(exam)}</span><span style="font-size:10px;color:var(--green);font-family:'DM Mono',monospace;">Saved ${escapeHtml(result.savedAt)}</span></div>
      <div style="padding:12px 18px 4px;display:flex;gap:10px;flex-wrap:wrap;"><div class="sb-item"><div class="sb-val">${ranked.length}</div><div class="sb-lbl">Entries</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${avg}%</div><div class="sb-lbl">Avg Score</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${pass}/${ranked.length}</div><div class="sb-lbl">Passed</div></div></div>
      <div class="card-body" style="padding:0 18px 18px;"><div class="pub-table-wrap"><table class="pub-table">
        <thead><tr><th>#</th><th>Student</th>${hasExam ? '<th>CA /30</th><th>Exam /70</th>' : `<th>Score /${examCaMax}</th>`}<th>Total</th><th>Grade</th><th>Remark</th></tr></thead>
        <tbody>${ranked.map((row, i) => {
          const scorePct = pctForExam(Number(row.entry.total), exam);
          const grade = scoreToGrade(scorePct);
          const color = gradeColor(grade);
          const remark = scorePct >= 80 ? 'Excellent' : scorePct >= 65 ? 'Very Good' : scorePct >= 50 ? 'Good' : 'Below Average';
          const remarkClass = scorePct >= 80 ? 'rm-ex' : scorePct >= 65 ? 'rm-vg' : scorePct >= 50 ? 'rm-gd' : 'rm-av';
          return `<tr><td style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px;">${i + 1}</td><td><span class="stu-av" style="margin-right:6px;">${escapeHtml(row.student.initials)}</span><strong>${escapeHtml(row.student.name)}</strong></td>${hasExam ? `<td style="font-family:'DM Mono',monospace;">${row.entry.ca}</td><td style="font-family:'DM Mono',monospace;">${row.entry.exam ?? '-'}</td>` : `<td style="font-family:'DM Mono',monospace;">${row.entry.ca}</td>`}<td style="font-family:'DM Mono',monospace;font-weight:700;color:${color};">${row.entry.total}</td><td><span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:${color};">${grade}</span></td><td><span class="remark-tag ${remarkClass}">${remark}</span></td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>`;
  }).join('');
}

const EP_NO_CTX_HTML = `<div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12.5" rx="1.5"/><line x1="5.5" y1="7" x2="10.5" y2="7"/><line x1="5.5" y1="10" x2="10.5" y2="10"/><line x1="5.5" y1="4.5" x2="8" y2="4.5"/></svg></div><div class="ep-title">No Context Selected</div><div class="ep-desc">Choose a class, subject, and exam type above.</div></div>`;

// ── SHARED: class-arm option helpers ──
function armOptionsForClass(classCode) {
  const ctx = state.contexts.find(c => c.classCode === classCode);
  const seen = new Map();
  (ctx?.students || []).forEach(s => {
    if (s.classArmId && !seen.has(s.classArmId)) seen.set(s.classArmId, s.classArmName);
  });
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function armOptionsAcrossContexts() {
  const seen = new Map();
  uniqueStudents().forEach(s => {
    if (s.classArmId && !seen.has(s.classArmId)) seen.set(s.classArmId, s.classArmName);
  });
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

// ── STUDENT RESULT CHECKER ──
function srcInit() {
  const sel = document.getElementById('src-student');
  if (sel.dataset.loaded) return;
  const armSel = document.getElementById('src-arm');
  if (armSel) {
    armSel.innerHTML = '<option value="">— All Arms —</option>' + armOptionsAcrossContexts()
      .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }
  sel.innerHTML = '<option value="">Select student…</option>' + uniqueStudents()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${escapeHtml(s.id)}" data-arm="${s.classArmId || ''}">${escapeHtml(s.name)} (${escapeHtml(s.id)}) - Class ${escapeHtml(s.cls)}</option>`).join('');
  sel.dataset.loaded = '1';
}

function srcFilterByArm() {
  const armId = document.getElementById('src-arm').value;
  const sel = document.getElementById('src-student');
  [...sel.options].forEach(opt => {
    if (!opt.value) return;
    opt.hidden = !!armId && opt.dataset.arm !== armId;
  });
  if (sel.selectedOptions[0]?.hidden) sel.value = '';
}

async function srcCheck() {
  const studentId = document.getElementById('src-student').value;
  const examType = document.getElementById('src-examtype').value;
  if (!studentId || !examType) return showToast('Select a student and exam type');
  const box = document.getElementById('src-results');
  box.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-3);">Checking…</div></div>';
  try {
    const data = await apiFetch(`/api/teacher/result-checker/student?studentId=${encodeURIComponent(studentId)}&examType=${encodeURIComponent(examType)}`);
    if (!data.published) {
      box.innerHTML = `<div class="card"><div class="card-body"><div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"/><line x1="8" y1="5" x2="8" y2="9.2"/><circle cx="8" cy="11.3" r="0.2" fill="currentColor" stroke="none"/></svg></div><div class="ep-title">Not Yet Published</div><div class="ep-desc">${escapeHtml(data.studentName)}'s ${escapeHtml(examType)} result has not been published yet.</div></div></div></div>`;
      return;
    }
    const rows = data.rows || [];
    const max = totalMaxForExamType(examType);
    const counted = rows.filter(r => !r.isAbsent);
    const totalScore = counted.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const avgPct = counted.length ? Math.round((totalScore / (counted.length * max)) * 100) : 0;
    box.innerHTML = `<div class="card">
      <div class="card-head"><span class="card-title">${escapeHtml(data.studentName)} &middot; ${escapeHtml(examType)}</span><span style="font-size:10px;color:var(--green);font-family:'DM Mono',monospace;">Published ${escapeHtml(data.publishedAt)}</span></div>
      <div style="padding:12px 18px 4px;display:flex;gap:10px;flex-wrap:wrap;"><div class="sb-item"><div class="sb-val">${rows.length}</div><div class="sb-lbl">Subjects</div></div><div class="sb-item"><div class="sb-val" style="color:var(--green);">${avgPct}%</div><div class="sb-lbl">Average</div></div></div>
      <div class="card-body" style="padding:0 18px 18px;"><div class="pub-table-wrap"><table class="pub-table">
        <thead><tr><th>Subject</th><th>Total</th><th>Grade</th><th>Teacher</th></tr></thead>
        <tbody>${rows.map(r => {
          const scorePct = r.isAbsent ? null : pctForExam(Number(r.total), examType);
          const grade = r.isAbsent ? 'ABS' : (scorePct != null ? scoreToGrade(scorePct) : '-');
          const color = r.isAbsent ? 'var(--text-3)' : gradeColor(grade);
          return `<tr><td>${escapeHtml(r.subjectName)}</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:${color};">${r.isAbsent ? 'ABS' : (r.total ?? '-')}</td><td><span style="font-family:'DM Mono',monospace;font-weight:700;color:${color};">${grade}</span></td><td style="color:var(--text-2);">${escapeHtml(r.teacherName)}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>`;
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red);">${escapeHtml(err.message)}</div></div>`;
  }
}

// ── CLASS RESULT CHECKER ──
function crcInit() {
  const sel = document.getElementById('crc-class');
  if (sel.dataset.loaded) return;
  sel.innerHTML = '<option value="">Select class…</option>' + uniqueContextClasses()
    .map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
  sel.dataset.loaded = '1';
}

function crcLoadArms() {
  const classCode = document.getElementById('crc-class').value;
  const armSel = document.getElementById('crc-arm');
  if (!armSel) return;
  armSel.innerHTML = '<option value="">— All Arms —</option>' + armOptionsForClass(classCode)
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

async function crcCheck() {
  const classCode = document.getElementById('crc-class').value;
  const examType = document.getElementById('crc-examtype').value;
  const classArmId = document.getElementById('crc-arm')?.value || '';
  if (!classCode || !examType) return showToast('Select a class and exam type');
  const box = document.getElementById('crc-results');
  box.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-3);">Checking…</div></div>';
  try {
    const armParam = classArmId ? `&classArmId=${encodeURIComponent(classArmId)}` : '';
    const data = await apiFetch(`/api/teacher/result-checker/class?classCode=${encodeURIComponent(classCode)}&examType=${encodeURIComponent(examType)}${armParam}`);
    const students = data.students || [];
    const publishedCount = students.filter(s => s.published).length;
    box.innerHTML = `<div class="card">
      <div class="card-head"><span class="card-title">${escapeHtml(classCode)} &middot; ${escapeHtml(examType)}</span><span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">${publishedCount} / ${students.length} published</span></div>
      <div class="card-body" style="padding:0 18px 18px;"><div class="pub-table-wrap"><table class="pub-table">
        <thead><tr><th>#</th><th>Student</th><th>Status</th><th>Subjects</th><th>Average</th></tr></thead>
        <tbody>${students.map((s, i) => `<tr><td style="color:var(--text-3);font-family:'DM Mono',monospace;font-size:11px;">${i + 1}</td><td><strong>${escapeHtml(s.name)}</strong></td><td>${s.published ? '<span class="chip-green">Published</span>' : '<span class="chip-gray">Not Published</span>'}</td><td style="font-family:'DM Mono',monospace;">${s.published ? s.subjectCount : '-'}</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:${s.published ? gradeColor(scoreToGrade(s.avgPct)) : 'var(--text-3)'};">${s.published ? s.avgPct + '%' : '-'}</td></tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px;">No students in this class.</td></tr>`}</tbody>
      </table></div></div>
    </div>`;
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red);">${escapeHtml(err.message)}</div></div>`;
  }
}

// ── RESULTS GRADE BOOK ──
function gbInit() {
  const classSelect = document.getElementById('gb-class');
  if (!classSelect.dataset.loaded) {
    classSelect.innerHTML = '<option value="">Select…</option>' + uniqueContextClasses()
      .map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
    classSelect.dataset.loaded = '1';
  }
}

// A teacher can be registered as class_teacher for a class under several of
// their own subject contexts (one row per subject) — any one of those
// flags being class_teacher means they're the class's homeroom teacher.
function isClassTeacherForClass(classCode) {
  return state.contexts.some(ctx => ctx.classCode === classCode && ctx.teacherType === 'class_teacher');
}

function gbOnClassChange() {
  const classCode = document.getElementById('gb-class').value;
  const subjectSelect = document.getElementById('gb-subject');
  const armSelect = document.getElementById('gb-arm');
  if (armSelect) {
    armSelect.innerHTML = '<option value="">— All Arms —</option>' + armOptionsForClass(classCode)
      .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }
  if (!classCode) {
    subjectSelect.innerHTML = '<option value="">Select…</option>';
    subjectSelect.disabled = true;
    gbLoad();
    return;
  }
  const isClassTeacher = isClassTeacherForClass(classCode);
  const subjects = subjectOptionsForClass(classCode);
  subjectSelect.innerHTML = isClassTeacher
    ? '<option value="">All Subjects (Full Class Result)</option>'
    : '<option value="">Select…</option>';
  subjects.forEach(subject => {
    const opt = document.createElement('option');
    opt.value = subject.id;
    opt.textContent = subject.name;
    subjectSelect.appendChild(opt);
  });
  subjectSelect.disabled = !isClassTeacher && subjects.length <= 1;
  if (!isClassTeacher && subjects.length === 1) subjectSelect.value = String(subjects[0].id);
  gbLoad();
}

function gbFindContext() {
  const classCode = document.getElementById('gb-class').value;
  const subjectId = Number(document.getElementById('gb-subject').value);
  return state.contexts.find(ctx => ctx.classCode === classCode && Number(ctx.subjectId) === subjectId) || null;
}

async function gbLoad() {
  const classCode = document.getElementById('gb-class').value;
  const subjectVal = document.getElementById('gb-subject').value;
  const examType = document.getElementById('gb-examtype').value;
  const box = document.getElementById('gb-results');
  if (!classCode || !examType) {
    box.innerHTML = EP_NO_CTX_HTML;
    return;
  }

  // Subject teachers only ever see their one subject's scores for the whole
  // class (already a per-class view). Class teachers get an "All Subjects"
  // option that shows the class's entire result across every subject they
  // themselves are assigned to teach there, laid out as one row per student.
  if (!subjectVal && isClassTeacherForClass(classCode)) {
    const contexts = state.contexts.filter(ctx => ctx.classCode === classCode);
    box.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-3);">Loading…</div></div>';
    try {
      await Promise.all(contexts.map(ctx =>
        apiFetch(`/api/teacher/results?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`)
          .then(data => { state.resultsByKey[entryKey(ctx.id, examType)] = data.result; })
      ));
      gbRenderClassOverview(classCode, examType, contexts);
    } catch (err) {
      box.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red);">${escapeHtml(err.message)}</div></div>`;
    }
    return;
  }

  const ctx = gbFindContext();
  if (!ctx) {
    box.innerHTML = EP_NO_CTX_HTML;
    return;
  }
  box.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-3);">Loading…</div></div>';
  try {
    const data = await apiFetch(`/api/teacher/results?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`);
    state.resultsByKey[entryKey(ctx.id, examType)] = data.result;
    gbRender(ctx, examType);
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red);">${escapeHtml(err.message)}</div></div>`;
  }
}

function gbRenderClassOverview(classCode, examType, contexts) {
  const classLabel = (contexts[0] || {}).classLabel || classCode;
  const classArmId = document.getElementById('gb-arm')?.value || '';
  const students = (contexts[0]?.students || [])
    .filter(student => !classArmId || String(student.classArmId) === String(classArmId))
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  const subjectCols = contexts.slice().sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  const max = totalMaxForExamType(examType);

  const rows = students.map(student => {
    let total = 0;
    let counted = 0;
    const cells = subjectCols.map(ctx => {
      const result = resultFor(ctx.id, examType);
      const rec = result.entries?.[student.id];
      const isAbsent = !!rec?.isAbsent;
      const isExcluded = !!rec?.isExcluded;
      const score = rec ? rec.total : null;
      if (!isAbsent && !isExcluded && score != null) { total += score; counted++; }
      const scorePct = (!isAbsent && !isExcluded && score != null) ? pctForExam(score, examType) : null;
      const grade = scorePct != null ? scoreToGrade(scorePct) : '-';
      const color = (isAbsent || isExcluded) ? 'var(--text-3)' : gradeColor(grade);
      const display = isAbsent ? 'ABS' : isExcluded ? 'Exc' : (score != null ? score : '-');
      return `<td class="c" style="color:${color};font-family:'DM Mono',monospace;">${display}</td>`;
    }).join('');
    const avgPct = counted ? Math.round((total / (counted * max)) * 100) : null;
    return `<tr>
      <td><div class="stu-cell"><span class="stu-av">${escapeHtml(student.initials)}</span><div><div class="stu-full">${escapeHtml(student.name)}</div><div class="stu-id">${escapeHtml(student.id)}</div></div></div></td>
      ${cells}
      <td class="c" style="font-weight:700;">${avgPct != null ? avgPct + '%' : '-'}</td>
      <td class="c" style="white-space:nowrap;">
        <button class="row-open-btn" onclick="previewTeacherReport('${escapeHtml(student.id)}','${escapeHtml(classCode)}','${escapeHtml(examType)}')" title="Preview the final PDF result">&#x1F50D; Preview</button>
        ${isClassTeacherForClass(classCode) ? `<button class="row-open-btn" onclick="gbOpenCommentModal('${escapeHtml(student.id)}')" title="Write a comment based on overall performance">&#x1F4AC; Comment</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  document.getElementById('gb-results').innerHTML = `<div class="card">
    <div class="card-head">
      <span class="card-title">${escapeHtml(classLabel)} &middot; Full Class Result &middot; ${escapeHtml(examType)}</span>
      <span style="font-size:10px;color:var(--text-3);">Read-only overview across your subjects — pick one subject above to enter scores or mark Absent/Exclude</span>
    </div>
    <div class="card-body" style="padding:0 18px 18px;"><div class="entry-table-wrap"><table class="entry-table">
      <thead><tr><th style="min-width:190px;">Student</th>${subjectCols.map(c => `<th class="c">${escapeHtml(c.subjectName)}</th>`).join('')}<th class="c">Avg</th><th class="c">&nbsp;</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${subjectCols.length + 3}" style="text-align:center;color:var(--text-3);padding:24px;">No students in this class.</td></tr>`}</tbody>
    </table></div></div>
  </div>`;
}

function previewTeacherReport(studentId, classCode, examType) {
  const params = new URLSearchParams({ studentId, classCode, examType });
  window.open(`/api/teacher/reports/preview?${params.toString()}`, '_blank', 'noopener');
}

// Class Teacher's Comment, written against the student's OVERALL performance
// across every subject in the class — not tied to any one subject context.
async function gbOpenCommentModal(studentId) {
  const classCode = document.getElementById('gb-class').value;
  const examType = document.getElementById('gb-examtype').value;
  const contexts = state.contexts.filter(ctx => ctx.classCode === classCode);
  if (!contexts.length) return;
  const anchorCtx = contexts[0];
  const student = (anchorCtx.students || []).find(s => s.id === studentId);
  if (!student) return;

  await loadCommentsForContext(anchorCtx, examType);

  const max = totalMaxForExamType(examType);
  let total = 0;
  let counted = 0;
  const subjectRows = contexts.slice().sort((a, b) => a.subjectName.localeCompare(b.subjectName)).map(ctx => {
    const result = resultFor(ctx.id, examType);
    const rec = result.entries?.[studentId];
    const isAbsent = !!rec?.isAbsent;
    const isExcluded = !!rec?.isExcluded;
    const score = rec ? rec.total : null;
    if (!isAbsent && !isExcluded && score != null) { total += score; counted++; }
    const scorePct = (!isAbsent && !isExcluded && score != null) ? pctForExam(score, examType) : null;
    const grade = scorePct != null ? scoreToGrade(scorePct) : '-';
    const display = isAbsent ? 'ABS' : isExcluded ? 'Excluded' : (score != null ? score : '-');
    return { name: ctx.subjectName, display, grade };
  });
  const avgPct = counted ? Math.round((total / (counted * max)) * 100) : null;

  state.gbCommentTarget = { studentId, examType, anchorContextId: anchorCtx.id };
  document.getElementById('gb-comment-modal-title').textContent = `Comment — ${student.name}`;
  const comment = commentFor(anchorCtx.id, examType, studentId);
  document.getElementById('gb-comment-modal-body').innerHTML = `
    <div style="padding:18px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div class="stu-av" style="width:36px;height:36px;font-size:13px;">${escapeHtml(student.initials)}</div>
        <div>
          <div style="font-weight:700;font-size:14px;">${escapeHtml(student.name)}</div>
          <div style="font-size:11px;color:var(--text-3);">${escapeHtml(student.id)} &middot; ${escapeHtml(examType)}</div>
        </div>
        <div style="margin-left:auto;text-align:right;">
          <div style="font-size:20px;font-weight:700;color:${avgPct != null ? gradeColor(scoreToGrade(avgPct)) : 'var(--text-3)'};">${avgPct != null ? avgPct + '%' : '-'}</div>
          <div style="font-size:10px;color:var(--text-3);">Overall Average</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px;">
        ${subjectRows.map(r => `<div style="background:var(--black-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;">
          <div style="font-size:10px;color:var(--text-3);margin-bottom:2px;">${escapeHtml(r.name)}</div>
          <div style="font-size:13px;font-weight:700;">${r.display}${r.grade !== '-' ? ` <span style="font-size:10px;color:var(--text-3);">(${r.grade})</span>` : ''}</div>
        </div>`).join('')}
      </div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Class Teacher's Comment</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;">Base this on the student's overall performance across all subjects, not one subject alone. Leave blank to auto-fill from the comments bank.</div>
      <textarea id="gb-comment-input" rows="4" placeholder="e.g. A well-rounded term overall — keep up the consistent effort across subjects." style="width:100%;font-family:inherit;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;resize:vertical;">${escapeHtml(comment)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;">
        <button class="ep-save-btn" onclick="gbSaveComment()">Save Comment</button>
      </div>
    </div>`;
  document.getElementById('gb-comment-modal').style.display = 'flex';
}

function gbCloseCommentModal() {
  document.getElementById('gb-comment-modal').style.display = 'none';
  state.gbCommentTarget = null;
}

async function gbSaveComment() {
  const target = state.gbCommentTarget;
  if (!target) return;
  const comment = document.getElementById('gb-comment-input')?.value || '';
  try {
    await apiFetch('/api/teacher/report-comments', {
      method: 'POST',
      body: JSON.stringify({ contextId: target.anchorContextId, examType: target.examType, studentId: target.studentId, comment }),
    });
    const key = skillsKey(target.anchorContextId, target.examType);
    state.commentsByKey[key] = { ...(state.commentsByKey[key] || {}), [target.studentId]: { comment } };
    showToast('Comment saved');
    gbCloseCommentModal();
  } catch (err) {
    showToast(err.message);
  }
}

function gbRender(ctx, examType) {
  const result = resultFor(ctx.id, examType);
  const classArmId = document.getElementById('gb-arm')?.value || '';
  const students = (ctx.students || [])
    .filter(student => !classArmId || String(student.classArmId) === String(classArmId))
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = students.map(student => {
    const rec = result.entries?.[student.id];
    const isAbsent = !!rec?.isAbsent;
    const isExcluded = !!rec?.isExcluded;
    const total = rec ? rec.total : null;
    const scorePct = (!isAbsent && !isExcluded && total != null) ? pctForExam(total, examType) : null;
    const grade = scorePct != null ? scoreToGrade(scorePct) : '-';
    const color = (isAbsent || isExcluded) ? 'var(--text-3)' : gradeColor(grade);
    const totalDisplay = isAbsent ? 'ABS' : isExcluded ? 'Excluded' : (total != null ? total : '-');
    return `<tr>
      <td><div class="stu-cell"><span class="stu-av">${escapeHtml(student.initials)}</span><div><div class="stu-full">${escapeHtml(student.name)}</div><div class="stu-id">${escapeHtml(student.id)}</div></div></div></td>
      <td class="tot-cell" style="color:${color};">${totalDisplay}</td>
      <td class="grade-cell"><span class="grade-pill" style="${(isAbsent || isExcluded) ? 'background:var(--black-3);color:var(--text-3);' : ''}">${(isAbsent || isExcluded) ? '-' : grade}</span></td>
      <td><button class="gb-flag absent ${isAbsent ? 'active' : ''}" type="button" onclick="gbToggleFlag('${escapeHtml(student.id)}','absent',${isAbsent ? 'false' : 'true'})" ${isExcluded ? 'disabled' : ''}><span></span>${isAbsent ? 'Unmark' : 'Absent'}</button></td>
      <td><button class="gb-flag exclude ${isExcluded ? 'active' : ''}" type="button" onclick="gbToggleFlag('${escapeHtml(student.id)}','excluded',${isExcluded ? 'false' : 'true'})"><span></span>${isExcluded ? 'Include' : 'Exclude'}</button></td>
    </tr>`;
  }).join('');
  document.getElementById('gb-results').innerHTML = `<div class="card">
    <div class="card-head"><span class="card-title">${escapeHtml(ctx.classLabel)} &middot; ${escapeHtml(ctx.subjectName)} &middot; ${escapeHtml(examType)}</span></div>
    <div class="card-body" style="padding:0 18px 18px;"><div class="entry-table-wrap"><table class="entry-table">
      <thead><tr><th style="min-width:190px;">Student</th><th class="c">Total</th><th class="c">Grade</th><th class="c">Absent</th><th class="c">Exclude</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:24px;">No students in this class.</td></tr>`}</tbody>
    </table></div></div>
  </div>`;
}

async function gbToggleFlag(studentId, field, value) {
  const ctx = gbFindContext();
  const examType = document.getElementById('gb-examtype').value;
  if (!ctx || !examType) return;
  try {
    const data = await apiFetch('/api/teacher/gradebook/entries/flag', {
      method: 'PUT',
      body: JSON.stringify({ contextId: ctx.id, examType, studentId, field, value }),
    });
    state.resultsByKey[entryKey(ctx.id, examType)] = data.result;
    gbRender(ctx, examType);
    populateDashboard();
    renderPublished();
    showToast(`${field === 'absent' ? 'Absent' : 'Exclude'} flag updated`);
  } catch (err) {
    showToast(err.message);
  }
}

// ── COGNITIVE SKILLS ASSESSMENT (class-wide) ──
function cogClassTeacherContexts() {
  const seen = new Map();
  state.contexts.filter(ctx => ctx.teacherType === 'class_teacher').forEach(ctx => {
    if (!seen.has(ctx.classCode)) seen.set(ctx.classCode, ctx);
  });
  return Array.from(seen.values());
}

function cogInit() {
  const sel = document.getElementById('cog-class');
  if (sel.dataset.loaded) return;
  const ctxs = cogClassTeacherContexts();
  sel.innerHTML = '<option value="">Select class…</option>' + ctxs.map(c => `<option value="${escapeHtml(c.classCode)}">${escapeHtml(c.classLabel)}</option>`).join('');
  sel.dataset.loaded = '1';
  if (!ctxs.length) {
    sel.disabled = true;
    document.getElementById('cog-examtype').disabled = true;
    document.getElementById('cog-results').innerHTML = `<div class="card"><div class="card-body"><div class="ep-wrap"><div class="ep-icon"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"/><line x1="8" y1="5" x2="8" y2="9.2"/><circle cx="8" cy="11.3" r="0.2" fill="currentColor" stroke="none"/></svg></div><div class="ep-title">Not a Class Teacher</div><div class="ep-desc">Only class teachers can rate cognitive skills. You are not assigned as a class teacher for any class.</div></div></div></div>`;
  }
}

async function cogLoad() {
  const classCode = document.getElementById('cog-class').value;
  const examType = document.getElementById('cog-examtype').value;
  const box = document.getElementById('cog-results');
  if (!classCode || !examType) { box.innerHTML = ''; return; }
  const ctx = cogClassTeacherContexts().find(c => c.classCode === classCode);
  if (!ctx) return;
  box.innerHTML = '<div class="card"><div class="card-body" style="color:var(--text-3);">Loading…</div></div>';
  try {
    const data = await apiFetch(`/api/teacher/skills?contextId=${encodeURIComponent(ctx.id)}&examType=${encodeURIComponent(examType)}`);
    state.skillRatingsByKey[skillsKey(ctx.id, examType)] = data.ratings || {};
    cogRender(ctx, examType);
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="card-body" style="color:var(--red);">${escapeHtml(err.message)}</div></div>`;
  }
}

function cogRender(ctx, examType) {
  const ratings = skillRatingsFor(ctx.id, examType);
  const students = (ctx.students || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = students.map(student => {
    const r = ratings[student.id];
    return `<tr>
      <td><div class="stu-cell"><span class="stu-av">${escapeHtml(student.initials)}</span><div><div class="stu-full">${escapeHtml(student.name)}</div><div class="stu-id">${escapeHtml(student.id)}</div></div></div></td>
      <td>${r ? `<span class="chip-green">Rated - ${escapeHtml(r.updatedAt)}</span>` : '<span class="chip-gray">Not Rated</span>'}</td>
      <td class="act-cell"><button class="row-open-btn" onclick="cogOpenModal('${escapeHtml(ctx.classCode)}','${escapeHtml(examType)}','${escapeHtml(student.id)}')">Rate</button></td>
    </tr>`;
  }).join('');
  document.getElementById('cog-results').innerHTML = `<div class="card">
    <div class="card-head"><span class="card-title">${escapeHtml(ctx.classLabel)} &middot; ${escapeHtml(examType)}</span></div>
    <div class="card-body" style="padding:0 18px 18px;"><div class="entry-table-wrap"><table class="entry-table">
      <thead><tr><th style="min-width:190px;">Student</th><th>Status</th><th class="c">&nbsp;</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:24px;">No students in this class.</td></tr>`}</tbody>
    </table></div></div>
  </div>`;
}

function cogOpenModal(classCode, examType, studentId) {
  const ctx = cogClassTeacherContexts().find(c => c.classCode === classCode);
  const student = (ctx?.students || []).find(s => s.id === studentId);
  if (!ctx || !student) return;
  state.cogModal = { ctx, examType, studentId };
  const ratings = skillRatingsFor(ctx.id, examType)[studentId] || {};
  document.getElementById('cog-modal-title').textContent = `Rate ${student.name}`;
  const groupHtml = SKILL_GROUPS.map(group => `
    <div style="background:var(--black-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:var(--text-1);margin-bottom:10px;">${escapeHtml(group.title)} <span style="opacity:.5;font-weight:400;">(Scale 1-5)</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
        ${group.skills.map(([key, label]) => {
          const value = ratings[group.key]?.[key] ?? '';
          return `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--black-3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;">
            <span style="font-size:11px;color:var(--text-2);">${escapeHtml(label)}</span>
            <select class="ctrl-select" id="cog-skill-${group.key}-${key}" style="min-width:64px;width:64px;padding:6px 8px;">
              <option value="">-</option>
              ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(value) === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>`;
        }).join('')}
      </div>
    </div>`).join('');
  document.getElementById('cog-modal-body').innerHTML = `
    ${groupHtml}
    <div style="font-size:10px;color:${ratings.updatedAt ? 'var(--green)' : 'var(--text-3)'};font-family:'DM Mono',monospace;margin-bottom:12px;" id="cog-modal-saved-at">${ratings.updatedAt ? `Saved - ${escapeHtml(ratings.updatedAt)}` : 'Not saved yet'}</div>
    <button class="ep-save-btn" style="width:100%;" onclick="cogSave()">Save Ratings</button>
  `;
  document.getElementById('cog-modal').style.display = 'flex';
}

function cogCloseModal() {
  document.getElementById('cog-modal').style.display = 'none';
  state.cogModal = null;
}

function collectCogSkillRatings() {
  const payload = { affective: {}, psychomotor: {} };
  for (const group of SKILL_GROUPS) {
    for (const [key, label] of group.skills) {
      const el = document.getElementById(`cog-skill-${group.key}-${key}`);
      const value = Number(el?.value);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error(`Rate ${label} from 1 to 5`);
      }
      payload[group.key][key] = value;
    }
  }
  return payload;
}

async function cogSave() {
  const m = state.cogModal;
  if (!m) return;
  let ratings;
  try {
    ratings = collectCogSkillRatings();
  } catch (err) {
    showToast(err.message);
    return;
  }
  try {
    const data = await apiFetch('/api/teacher/skills', {
      method: 'POST',
      body: JSON.stringify({ contextId: m.ctx.id, examType: m.examType, studentId: m.studentId, ...ratings }),
    });
    const key = skillsKey(m.ctx.id, m.examType);
    state.skillRatingsByKey[key] = { ...(state.skillRatingsByKey[key] || {}), [m.studentId]: data.rating };
    const savedAt = document.getElementById('cog-modal-saved-at');
    if (savedAt) { savedAt.textContent = `Saved - ${data.rating.updatedAt}`; savedAt.style.color = 'var(--green)'; }
    showToast('Skill ratings saved');
    cogRender(m.ctx, m.examType);
  } catch (err) {
    showToast(err.message);
  }
}

const TAB_META = {
  dashboard: { title: 'Dashboard', sub: 'Wednesday, 13 May 2026' },
  students: { title: 'Students', sub: 'Class Roster' },
  results: { title: 'Results Entry', sub: 'Enter Examination Scores' },
  published: { title: 'Published Results', sub: 'Saved Exam Records' },
  studentResultChecker: { title: 'Student Result Checker', sub: 'Look Up a Published Result' },
  classResultChecker: { title: 'Class Result Checker', sub: 'Class Publication Status' },
  resultsGradebook: { title: 'Results Grade Book', sub: 'Review, Mark Absent / Exclude' },
  cognitiveSkills: { title: 'Cognitive Skills Assessment', sub: 'Affective & Psychomotor Ratings' },
  cbtGradebook: { title: 'CBT Grade Book', sub: 'Computer-Based Test Scores' },
  dailyGradebook: { title: 'Daily Grade Book', sub: 'Day-to-Day Scoring' },
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
  if (tab === 'studentResultChecker') srcInit();
  if (tab === 'classResultChecker') crcInit();
  if (tab === 'resultsGradebook') gbInit();
  if (tab === 'cognitiveSkills') cogInit();
}

function mobStaggerItems(sidebar) {
  var els = Array.from(sidebar.querySelectorAll('.sidebar-logo,.user-pill,.nav-item'));
  els.forEach(function(el) { el.style.opacity = '0'; el.style.animation = 'none'; });
  els.forEach(function(el, i) {
    el.style.animation = 'mobNavIn 0.38s cubic-bezier(0.4,0,0.2,1) ' + (120 + i * 48) + 'ms both';
  });
}
function mobClearStagger(sidebar) {
  sidebar.querySelectorAll('.sidebar-logo,.user-pill,.nav-item').forEach(function(el) {
    el.style.animation = '';
    el.style.opacity = '';
  });
}
function deskToggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
}

function openAccountSettings() {
  const u = state.user || {};
  document.getElementById('as-avatar').textContent = u.initials || '';
  document.getElementById('as-name').textContent = u.name || '';
  document.getElementById('as-role').textContent = u.role === 'teacher' ? 'Teacher' : (u.role || '');
  document.getElementById('as-email').value = u.email || '';
  document.getElementById('as-pw-current').value = '';
  document.getElementById('as-pw-new').value = '';
  document.getElementById('as-pw-confirm').value = '';

  const rows = [['Staff ID', u.id || '—'], ['Role', u.role === 'teacher' ? 'Teacher' : (u.role || '—')]];
  if (u.teacherType) rows.push(['Type', u.teacherType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]);
  rows.push(['Email', u.email || 'Not set']);
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
  if (tab === 'edit') renderAccountSigPreview();
}

function renderAccountSigPreview() {
  const preview = document.getElementById('as-sig-preview');
  if (!preview) return;
  if (state.user?.signaturePath) { preview.src = '/' + state.user.signaturePath; preview.style.display = ''; }
  else { preview.style.display = 'none'; }
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

async function saveAccountSignature() {
  try {
    const dataUrl = await fileToDataUrl('as-signature-file');
    if (!dataUrl) return showToast('Choose a signature image');
    const data = await apiFetch('/api/account/signature', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    state.user.signaturePath = data.signaturePath;
    document.getElementById('as-signature-file').value = '';
    renderAccountSigPreview();
    showToast('Signature saved');
  } catch (err) {
    showToast(err.message);
  }
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
document.getElementById('sidebar-overlay').addEventListener('click', mobCloseSidebar);
document.addEventListener('click', function(e) {
  if (window.innerWidth > 768) return;
  const leafLink = e.target.closest('[onclick*="switchTab"]');
  if (leafLink) setTimeout(mobCloseSidebar, 180);
});

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ls_user_id');
  localStorage.removeItem('ls_user_role');
  window.location.href = 'index.html';
}

init();
