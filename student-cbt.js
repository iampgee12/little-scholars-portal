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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let examsCache = [];
let currentExam = null;
let timerInterval = null;

async function init() {
  try {
    const session = await apiFetch('/api/session');
    if (session.user.role !== 'student') {
      window.location.replace('index.html');
      return;
    }
    document.getElementById('cbt-student-name').textContent = session.user.name;
    await loadExams();
  } catch (err) {
    console.error(err);
  }
}

async function loadExams() {
  const data = await apiFetch('/api/student/cbt/exams');
  examsCache = data.exams || [];
  renderExamList();
}

function renderExamList() {
  const wrap = document.getElementById('cbt-exam-list');
  const empty = document.getElementById('cbt-empty-msg');
  if (!examsCache.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  wrap.innerHTML = examsCache.map(e => {
    let statusBadge = '';
    let actionHtml = '';
    if (e.attemptStatus === 'submitted') {
      statusBadge = '<span class="cbt-badge cbt-badge-done">Completed</span>';
      const pct = e.totalMarks ? Math.round((e.score / e.totalMarks) * 100) : 0;
      actionHtml = `<div class="cbt-score">Score: ${e.score} / ${e.totalMarks} (${pct}%)</div>`;
    } else if (e.attemptStatus === 'in_progress') {
      statusBadge = '<span class="cbt-badge cbt-badge-live">In Progress</span>';
      actionHtml = `<button class="cbt-btn" onclick="startExam(${e.id})">Continue Exam</button>`;
    } else if (e.status === 'live') {
      statusBadge = '<span class="cbt-badge cbt-badge-live">Live</span>';
      actionHtml = e.questionCount > 0
        ? `<button class="cbt-btn" onclick="startExam(${e.id})">Start Exam</button>`
        : '<span class="cbt-muted">No questions available yet</span>';
    } else if (e.status === 'upcoming') {
      statusBadge = '<span class="cbt-badge cbt-badge-upcoming">Upcoming</span>';
      actionHtml = '<span class="cbt-muted">Not yet available</span>';
    } else {
      statusBadge = '<span class="cbt-badge cbt-badge-closed">Closed</span>';
      actionHtml = '<span class="cbt-muted">Exam closed</span>';
    }
    return `
      <div class="cbt-exam-card">
        <div class="cbt-exam-card-head">
          <strong>${escapeHtml(e.subjectName)}</strong>
          ${statusBadge}
        </div>
        <div class="cbt-muted">${escapeHtml(e.scheduleTitle)} &middot; ${escapeHtml(e.termLabel)} ${escapeHtml(e.sessionLabel)}</div>
        <div class="cbt-muted">${e.durationMinutes} mins &middot; ${e.questionCount} question${e.questionCount === 1 ? '' : 's'}</div>
        <div class="cbt-exam-card-foot">${actionHtml}</div>
      </div>`;
  }).join('');
}

async function startExam(scheduleSubjectId) {
  try {
    const data = await apiFetch(`/api/student/cbt/exams/${scheduleSubjectId}/start`, { method: 'POST' });
    currentExam = {
      id: scheduleSubjectId,
      ...data,
      currentIndex: 0,
      answersMap: new Map((data.answers || []).map(a => [a.questionId, a.selectedOption])),
    };
    renderExamView();
    document.getElementById('cbt-list-view').style.display = 'none';
    document.getElementById('cbt-result-view').style.display = 'none';
    document.getElementById('cbt-exam-view').style.display = 'block';
    startTimer();
  } catch (err) {
    alert(err.message);
  }
}

// One question per screen: a numbered strip to jump to any question (green
// once answered, blue for the one currently open), plus Previous/Next
// buttons under the question itself — Next becomes Submit on the last one.
function renderExamView() {
  renderQuestionNav();
  renderCurrentQuestion();
}

function renderQuestionNav() {
  const nav = document.getElementById('cbt-question-nav');
  if (!currentExam.questions.length) { nav.innerHTML = ''; return; }
  nav.innerHTML = currentExam.questions.map((q, i) => {
    const answered = currentExam.answersMap.has(q.id);
    const active = i === currentExam.currentIndex;
    const cls = ['cbt-qnum', answered ? 'cbt-qnum-answered' : '', active ? 'cbt-qnum-active' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" onclick="goToQuestion(${i})">${i + 1}</button>`;
  }).join('');
}

function renderCurrentQuestion() {
  const wrap = document.getElementById('cbt-questions');
  if (!currentExam.questions.length) {
    wrap.innerHTML = '<div class="cbt-empty">No questions have been added to this exam yet.</div>';
    return;
  }
  const i = currentExam.currentIndex;
  const q = currentExam.questions[i];
  const isLast = i === currentExam.questions.length - 1;
  wrap.innerHTML = `
    <div class="cbt-question-card">
      <div class="cbt-question-text"><strong>Question ${i + 1} of ${currentExam.questions.length}</strong> <span class="cbt-muted">(${q.marks} mark${Number(q.marks) === 1 ? '' : 's'})</span></div>
      <div class="cbt-question-text">${escapeHtml(q.questionText)}</div>
      <div class="cbt-options">
        ${q.options.map((opt, j) => `
          <label class="cbt-option">
            <input type="radio" name="q-${q.id}" value="${j}" ${currentExam.answersMap.get(q.id) === j ? 'checked' : ''} onchange="saveAnswer(${q.id}, ${j})">
            <span>${String.fromCharCode(65 + j)}. ${escapeHtml(opt)}</span>
          </label>
        `).join('')}
      </div>
    </div>
    <div class="cbt-nav-buttons">
      <button class="cbt-btn cbt-btn-secondary" onclick="goToQuestion(${i - 1})" ${i === 0 ? 'disabled' : ''}>&larr; Previous</button>
      ${isLast
        ? `<button class="cbt-btn cbt-submit-btn" style="margin:0;width:auto;" onclick="confirmSubmit()">Submit Exam</button>`
        : `<button class="cbt-btn" onclick="goToQuestion(${i + 1})">Next &rarr;</button>`}
    </div>
  `;
}

function goToQuestion(i) {
  if (!currentExam || i < 0 || i >= currentExam.questions.length) return;
  currentExam.currentIndex = i;
  renderExamView();
}

async function saveAnswer(questionId, selectedOption) {
  currentExam.answersMap.set(questionId, selectedOption);
  renderQuestionNav();
  try {
    await apiFetch(`/api/student/cbt/exams/${currentExam.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId, selectedOption }),
    });
  } catch (err) {
    if (String(err.message).includes('Time is up')) {
      submitExam(true);
    }
  }
}

function startTimer() {
  clearInterval(timerInterval);
  const deadline = new Date(currentExam.deadline).getTime();
  const timerEl = document.getElementById('cbt-timer');
  function tick() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timerEl.textContent = '00:00';
      clearInterval(timerInterval);
      submitExam(true);
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function confirmSubmit() {
  const unanswered = currentExam.questions.filter(q => !currentExam.answersMap.has(q.id)).length;
  const msg = unanswered
    ? `You have ${unanswered} unanswered question(s). Submit anyway? You cannot change your answers after this.`
    : 'Submit your exam? You cannot change your answers after this.';
  if (confirm(msg)) submitExam(false);
}

async function submitExam(auto) {
  clearInterval(timerInterval);
  try {
    const data = await apiFetch(`/api/student/cbt/exams/${currentExam.id}/submit`, { method: 'POST' });
    showResultView(data, auto);
  } catch (err) {
    alert(err.message);
  }
}

function showResultView(data, auto) {
  document.getElementById('cbt-exam-view').style.display = 'none';
  document.getElementById('cbt-result-view').style.display = 'block';
  const pct = data.totalMarks ? Math.round((data.score / data.totalMarks) * 100) : 0;
  document.getElementById('cbt-result-score').innerHTML = `
    ${auto ? '<p class="cbt-muted">Time was up — your exam was submitted automatically.</p>' : ''}
    <div class="cbt-result-big">${data.score} / ${data.totalMarks}</div>
    <div class="cbt-muted">${pct}% &middot; ${data.questionsAttempted} of ${data.questionsPresented} questions answered</div>
  `;
}

function showListView() {
  document.getElementById('cbt-result-view').style.display = 'none';
  document.getElementById('cbt-exam-view').style.display = 'none';
  document.getElementById('cbt-list-view').style.display = 'block';
  currentExam = null;
  loadExams();
}

async function signOut() {
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  window.location.replace('index.html');
}

init();
