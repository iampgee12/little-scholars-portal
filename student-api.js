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

const REMARK_CLASS = {
  Excellent: 'rm-ex',
  'Very Good': 'rm-vg',
  Good: 'rm-gd',
  Average: 'rm-av',
  Poor: 'rm-av',
};

const GRADE_TAG_CLASS = {
  'A+': 'gt-a', A: 'gt-a', 'A-': 'gt-a',
  'B+': 'gt-b', B: 'gt-b', 'B-': 'gt-b',
  'C+': 'gt-c', C: 'gt-c', 'C-': 'gt-c',
  D: 'gt-c', F: 'gt-c',
};

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function ordinal(n) {
  if (n === null || n === undefined) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── DASHBOARD ──
let dashboardData = null;

async function loadDashboard() {
  try {
    const data = await apiFetch('/api/student/dashboard');
    dashboardData = data;

    document.getElementById('stat-attendance').textContent = `${data.attendanceRate}%`;
    document.getElementById('stat-subjects').textContent = data.subjectsCount;
    document.getElementById('stat-subjects-label').textContent =
      `Subjects · ${data.academic.termLabel || ''}`;
    document.getElementById('stat-assignments').textContent = 'N/A';

    if (data.hasPublishedResults) {
      document.getElementById('stat-grade').textContent = data.overallGrade;
      document.getElementById('stat-position').textContent =
        data.classPosition ? `${ordinal(data.classPosition)} / ${data.classSize}` : '—';
    } else {
      document.getElementById('stat-grade').textContent = '—';
      document.getElementById('stat-position').textContent = 'No results yet';
    }

    const ttSub = document.getElementById('timetable-sub');
    if (ttSub) ttSub.textContent = `${data.student.classLabel} · ${data.academic.termLabel} · ${data.academic.sessionLabel}`;
    const coursesSub = document.getElementById('courses-sub');
    if (coursesSub) coursesSub.textContent = `${data.academic.termLabel} · ${data.academic.sessionLabel}`;
    const resultsSub = document.getElementById('results-sub');
    if (resultsSub) resultsSub.textContent = `Mid-Term & Final Exams · ${data.academic.termLabel} · ${data.academic.sessionLabel}`;
  } catch (e) {
    console.error('Failed to load dashboard summary', e);
  }
}

// ── COURSES & GRADES ──
async function loadCourses() {
  const container = document.getElementById('course-rows');
  try {
    const data = await apiFetch('/api/student/courses');
    if (!data.courses.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><div class="empty-title">No Subjects Assigned Yet</div><div class="empty-desc">Your class has no subjects set up yet.</div></div>`;
    } else {
      container.innerHTML = data.courses.map(c => {
        if (!c.published) {
          return `<div class="course-row"><div class="course-top"><div><div class="course-name">${escapeHtml(c.subjectName)}</div><div class="course-sub">${escapeHtml(c.teacherName)}</div></div><span class="grade-tag" style="color:var(--text-3);background:var(--black-3);">Not yet published</span></div></div>`;
        }
        const gtClass = GRADE_TAG_CLASS[c.grade] || 'gt-b';
        return `<div class="course-row">
          <div class="course-top">
            <div><div class="course-name">${escapeHtml(c.subjectName)}</div><div class="course-sub">${escapeHtml(c.teacherName)}</div></div>
            <span class="grade-tag ${gtClass}">${escapeHtml(c.grade)} · ${c.pct}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${c.pct}%;"></div></div>
          <div class="course-foot"><span>${escapeHtml(c.examType)}</span><span>${c.total} / ${c.max}</span></div>
        </div>`;
      }).join('');
    }

    const s = data.summary;
    document.getElementById('course-overall-pct').textContent = s.overallPct !== null ? `${s.overallPct}%` : '—';
    document.getElementById('course-overall-label').textContent = `Overall average · ${data.academic.termLabel}`;
    document.getElementById('course-position').textContent = s.classPosition ? `${ordinal(s.classPosition)} / ${s.classSize}` : '—';
    document.getElementById('course-best').textContent = s.bestSubject || '—';
    document.getElementById('course-worst').textContent = s.needsAttention || '—';
    document.getElementById('course-passed').textContent = s.subjectsPublished
      ? `${s.subjectsPassed} / ${s.subjectsPublished}`
      : '—';
  } catch (e) {
    console.error('Failed to load courses', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Couldn't Load Courses</div><div class="empty-desc">Please refresh the page to try again.</div></div>`;
  }
}

// ── RESULTS ──
const resultCache = {};
const RESULT_TARGET = {
  'Mid-Term Exam': 'result-midterm',
  'Final Exam': 'result-final',
};

function renderResultEmpty(targetId, examType) {
  document.getElementById(targetId).innerHTML = `
    <div class="card"><div class="card-body">
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Results Not Yet Available</div>
        <div class="empty-desc">Your ${escapeHtml(examType)} results have not been published yet. Check back once your school publishes them.</div>
      </div>
    </div></div>`;
}

function renderResult(targetId, data) {
  const rowsHtml = data.rows.map(r => {
    const gradeColor = { Excellent: 'var(--green)', 'Very Good': 'var(--blue)', Good: 'var(--amber)' }[r.remark] || 'var(--red)';
    const remarkCls = REMARK_CLASS[r.remark] || 'rm-av';
    return `<tr>
      <td>${escapeHtml(r.subjectName)}</td>
      <td class="score-mono" style="color:var(--text-3);">${r.max}</td>
      <td class="score-mono">${r.total}</td>
      <td class="score-mono">${r.pct}%</td>
      <td><span class="grade-mono" style="color:${gradeColor};">${escapeHtml(r.grade)}</span></td>
      <td><span class="remark-tag ${remarkCls}">${escapeHtml(r.remark)}</span></td>
    </tr>`;
  }).join('');

  const t = data.totals;
  const totalGradeColor = { Excellent: 'var(--green)', 'Very Good': 'var(--blue)', Good: 'var(--amber)' }[t.remark] || 'var(--red)';
  const totalRemarkCls = REMARK_CLASS[t.remark] || 'rm-av';

  document.getElementById(targetId).innerHTML = `
    <div class="grid-2" style="align-items:start;">
      <div class="card">
        <div class="card-head"><span class="card-title">${escapeHtml(data.examType)}</span><span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;">Published ${escapeHtml(data.publishedAt)}</span></div>
        <div class="card-body" style="padding:0;"><div style="overflow-x:auto;padding:0 18px 18px;">
          <table class="results-table">
            <thead><tr><th>Subject</th><th>Max</th><th>Score</th><th>%</th><th>Grade</th><th>Remark</th></tr></thead>
            <tbody>
              ${rowsHtml}
              <tr class="total-row"><td>Total / Average</td><td class="score-mono">${t.max}</td><td class="score-mono" style="color:var(--green);">${t.score}</td><td class="score-mono" style="color:var(--green);">${t.pct}%</td><td><span class="grade-mono" style="color:${totalGradeColor};">${escapeHtml(t.grade)}</span></td><td><span class="remark-tag ${totalRemarkCls}">${escapeHtml(t.remark)}</span></td></tr>
            </tbody>
          </table>
        </div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card">
          <div class="card-head"><span class="card-title">Summary</span></div>
          <div class="card-body">
            <div style="margin-bottom:14px;"><div class="summary-big">${t.pct}%</div><div class="summary-label">${escapeHtml(data.examType)} Average</div></div>
            <div class="perf-row"><span class="perf-key">Total Score</span><span class="perf-val">${t.score} / ${t.max}</span></div>
            <div class="perf-row"><span class="perf-key">Class Position</span><span class="perf-val pv-green">${data.classPosition ? `${ordinal(data.classPosition)} / ${data.classSize}` : '—'}</span></div>
            <div class="perf-row"><span class="perf-key">Highest Score</span><span class="perf-val pv-amber">${data.highestSubject ? `${escapeHtml(data.highestSubject.subjectName)} · ${data.highestSubject.total}` : '—'}</span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">Principal's Remark</span></div>
          <div class="card-body">
            <div class="empty-state" style="padding:20px 8px;">
              <div class="empty-icon">✎</div>
              <div class="empty-title">Not Yet Available</div>
              <div class="empty-desc">A remark has not been added for this exam yet.</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

async function loadResult(examType) {
  const targetId = RESULT_TARGET[examType];
  if (!targetId) return;
  if (resultCache[examType]) {
    resultCache[examType].published ? renderResult(targetId, resultCache[examType]) : renderResultEmpty(targetId, examType);
    return;
  }
  try {
    const data = await apiFetch(`/api/student/results?examType=${encodeURIComponent(examType)}`);
    resultCache[examType] = data;
    if (data.published) {
      renderResult(targetId, data);
    } else {
      renderResultEmpty(targetId, examType);
    }
  } catch (e) {
    console.error('Failed to load results', e);
    document.getElementById(targetId).innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Couldn't Load Results</div><div class="empty-desc">Please refresh the page to try again.</div></div></div></div>`;
  }
}

async function loadAllResults() {
  await Promise.all([loadResult('Mid-Term Exam'), loadResult('Final Exam')]);
}

async function init() {
  const session = await apiFetch('/api/session');
  if (session.user.role !== 'student') {
    window.location.replace('index.html');
    return;
  }
  const acct = session.user;
  document.getElementById('s-avatar').textContent = acct.initials;
  document.getElementById('s-name').textContent = acct.name;
  document.getElementById('s-grade').textContent = acct.grade || 'Student Portal';
  document.title = `Little Scholars - ${acct.firstName}`;

  const hr = new Date().getHours();
  const gr = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('s-greeting').textContent = `${gr}, ${acct.firstName}.`;

  const today = new Date();
  const sub = document.getElementById('topbar-sub');
  if (sub) {
    sub.textContent = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  loadTopbarSession();
  loadDashboard();
  loadCourses();
  loadAllResults();
}

const TAB_META = {
  dashboard: { title: 'Dashboard', sub: "Today's summary" },
  timetable: { title: 'Timetable', sub: 'Class Schedule' },
  assignments: { title: 'Assignments', sub: 'Coming soon' },
  courses: { title: 'Courses & Grades', sub: '' },
  results: { title: 'Exam Results', sub: '' },
};

function switchTab(tab, trigger) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (trigger) trigger.classList.add('active');
  const m = TAB_META[tab] || {};
  document.getElementById('topbar-title').textContent = m.title || tab;
  if (m.sub) document.getElementById('topbar-sub').textContent = m.sub;
}

function switchResult(examType, btn) {
  document.querySelectorAll('.result-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('result-midterm').style.display = examType === 'Mid-Term Exam' ? '' : 'none';
  document.getElementById('result-final').style.display = examType === 'Final Exam' ? '' : 'none';
}

function filterAssign(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.assign-card').forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
  });
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ls_user_id');
  localStorage.removeItem('ls_user_role');
  window.location.href = 'index.html';
}

init();
