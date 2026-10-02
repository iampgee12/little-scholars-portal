async function apiFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch {
    const err = new Error('No internet connection');
    err.network = true;
    throw err;
  }
  if (res.status === 401) {
    window.location.replace('index.html');
    throw new Error('Authentication required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let examsCache = [];
let currentExam = null;
let timerInterval = null;

// ── Small helpers ──
let toastTimer = null;
function toast(message, kind = '', ms = 3500) {
  document.querySelector('.cbt-toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = `cbt-toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

function showOnly(viewId) {
  ['cbt-list-view', 'cbt-lobby-view', 'cbt-exam-view', 'cbt-result-view'].forEach(id => {
    document.getElementById(id).style.display = id === viewId ? 'block' : 'none';
  });
  window.scrollTo(0, 0);
}

function examWhen(e) {
  if (!e.examDate) return '';
  const d = new Date(`${e.examDate}T${e.examTime || '00:00'}`);
  if (isNaN(d)) return e.examDate;
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return e.examTime ? `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day;
}

// ── Exam list ──
async function init() {
  try {
    const session = await apiFetch('/api/session');
    if (session.user.role !== 'student') {
      window.location.replace('index.html');
      return;
    }
    document.getElementById('cbt-student-name').textContent = session.user.name;
    document.getElementById('cbt-hello').textContent = `Hello, ${session.user.firstName || session.user.name}!`;
    await loadExams();
  } catch (err) {
    document.getElementById('cbt-exam-list').innerHTML = `<div class="cbt-empty">${escapeHtml(err.network ? 'No internet connection. Check your connection and refresh the page.' : err.message)}</div>`;
  }
}

async function loadExams() {
  const data = await apiFetch('/api/student/cbt/exams');
  examsCache = data.exams || [];
  renderExamList();
}

function examCardHtml(e, group) {
  const facts = [`${e.durationMinutes} min`, `${e.questionCount} question${e.questionCount === 1 ? '' : 's'}`];
  if (e.paperMarks) facts.push(`${e.paperMarks} mark${e.paperMarks === 1 ? '' : 's'}`);
  let badge = '';
  let action = '';
  if (group === 'ready') {
    badge = e.attemptStatus === 'in_progress'
      ? '<span class="cbt-badge cbt-badge-upcoming">In progress</span>'
      : '<span class="cbt-badge cbt-badge-live">Ready</span>';
    action = e.questionCount > 0
      ? `<button class="cbt-btn cbt-btn-block ${e.attemptStatus === 'in_progress' ? '' : 'cbt-btn-green'}" onclick="openLobby(${e.id})">${e.attemptStatus === 'in_progress' ? 'Continue Exam' : 'Start Exam'}</button>`
      : '<span class="cbt-muted">Your teacher hasn\'t added the questions yet.</span>';
  } else if (group === 'upcoming') {
    badge = '<span class="cbt-badge cbt-badge-upcoming">Upcoming</span>';
    action = `<span class="cbt-muted">${e.examDate ? `Scheduled for <strong>${escapeHtml(examWhen(e))}</strong>. ` : ''}It will open here when your teacher starts it.</span>`;
  } else if (group === 'done') {
    const pct = e.totalMarks ? Math.round((e.score / e.totalMarks) * 100) : 0;
    badge = '<span class="cbt-badge cbt-badge-done">Completed</span>';
    action = `<div class="cbt-score">Score: ${e.score} / ${e.totalMarks} (${pct}%)</div>`;
  } else {
    badge = '<span class="cbt-badge cbt-badge-closed">Closed</span>';
    action = '<span class="cbt-muted">This exam has closed.</span>';
  }
  return `<div class="cbt-exam-card ${group === 'ready' ? 'ready' : ''}">
    <div class="cbt-exam-card-head"><span>${escapeHtml(e.subjectName)}</span>${badge}</div>
    <div class="cbt-muted">${escapeHtml(e.scheduleTitle)} · ${escapeHtml(e.termLabel)} ${escapeHtml(e.sessionLabel)}</div>
    <div class="cbt-facts">${facts.map(f => `<span class="cbt-fact">${f}</span>`).join('')}</div>
    <div class="cbt-exam-card-foot">${action}</div>
  </div>`;
}

function renderExamList() {
  const wrap = document.getElementById('cbt-exam-list');
  if (!examsCache.length) {
    wrap.innerHTML = '<div class="cbt-empty">No CBT exams have been set for your class yet.</div>';
    return;
  }
  const groups = { ready: [], upcoming: [], done: [], closed: [] };
  examsCache.forEach(e => {
    if (e.attemptStatus === 'submitted') groups.done.push(e);
    else if (e.status === 'live') groups.ready.push(e);
    else if (e.status === 'upcoming') groups.upcoming.push(e);
    else groups.closed.push(e);
  });
  const titles = { ready: 'Ready to take', upcoming: 'Coming up', done: 'Completed', closed: 'Closed' };
  wrap.innerHTML = Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) => `
    <div class="cbt-group-title">${titles[key]} (${list.length})</div>
    <div class="cbt-exam-grid">${list.map(e => examCardHtml(e, key)).join('')}</div>`).join('');
}

// ── Before you start ──
function openLobby(id) {
  const e = examsCache.find(x => x.id === id);
  if (!e) return;
  const resuming = e.attemptStatus === 'in_progress';
  const custom = (e.instructions || []).map(set => `
    <div class="cbt-instructions"><h3>${escapeHtml(set.title)}</h3><p>${escapeHtml(set.text)}</p></div>`).join('');
  document.getElementById('cbt-lobby-view').innerHTML = `
    <div class="cbt-lobby">
      <div class="cbt-muted">${escapeHtml(e.scheduleTitle)}</div>
      <h2>${escapeHtml(e.subjectName)}</h2>
      <div class="cbt-lobby-facts">
        <div class="cbt-lobby-fact"><strong>${e.durationMinutes}</strong><span>minutes</span></div>
        <div class="cbt-lobby-fact"><strong>${e.questionCount}</strong><span>questions</span></div>
        <div class="cbt-lobby-fact"><strong>${e.paperMarks || '—'}</strong><span>marks</span></div>
      </div>
      ${resuming ? '<div class="cbt-resume-note">You already started this exam. Your answers are saved and the timer has kept running — continue now.</div><br>' : ''}
      ${custom}
      <div class="cbt-instructions">
        <h3>How it works</h3>
        <ul>
          <li>Tap an answer to choose it. You can change it any time before you submit.</li>
          <li>Your answers save by themselves — watch for <strong>✓ Saved</strong> at the top.</li>
          <li>Not sure? Tap <strong>Mark for review</strong> and come back to it later.</li>
          <li>The numbers at the top take you to any question. Green means answered.</li>
          <li>When you finish, tap <strong>Review &amp; Submit</strong> to check everything before submitting.</li>
          <li>If time runs out, your exam is submitted for you with the answers you have chosen.</li>
        </ul>
      </div>
      <div class="cbt-lobby-actions">
        <button class="cbt-btn cbt-btn-secondary" onclick="showListView()">&larr; Back</button>
        <button class="cbt-btn cbt-btn-green" id="cbt-begin-btn" onclick="beginExam(${e.id}, this)">${resuming ? 'Continue Exam' : 'Begin Exam'} &rarr;</button>
      </div>
    </div>`;
  showOnly('cbt-lobby-view');
}

async function beginExam(id, btn) {
  const meta = examsCache.find(x => x.id === id) || {};
  if (btn) btn.disabled = true;
  try {
    const data = await apiFetch(`/api/student/cbt/exams/${id}/start`, { method: 'POST' });
    currentExam = {
      id,
      subjectName: meta.subjectName || 'Exam',
      ...data,
      currentIndex: 0,
      mode: 'question',
      answersMap: new Map((data.answers || []).filter(a => a.selectedOption !== null).map(a => [a.questionId, a.selectedOption])),
      flagged: new Set(loadFlags(data.attemptId)),
      warned: {},
    };
    // Resume at the first unanswered question
    const firstOpen = currentExam.questions.findIndex(q => !currentExam.answersMap.has(q.id));
    currentExam.currentIndex = firstOpen === -1 ? 0 : firstOpen;
    document.getElementById('cbt-exam-title').textContent = currentExam.subjectName;
    showOnly('cbt-exam-view');
    renderExamView();
    startTimer();
  } catch (err) {
    toast(err.network ? 'No internet connection — check it and try again.' : err.message, 'danger');
    if (err.status === 409) { await loadExams(); showListView(); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Flags (kept on this device only) ──
function loadFlags(attemptId) {
  try { return JSON.parse(localStorage.getItem(`cbt-flags-${attemptId}`) || '[]'); } catch { return []; }
}
function saveFlags() {
  try { localStorage.setItem(`cbt-flags-${currentExam.attemptId}`, JSON.stringify([...currentExam.flagged])); } catch { /* storage unavailable */ }
}
function toggleFlag(questionId) {
  if (currentExam.flagged.has(questionId)) currentExam.flagged.delete(questionId);
  else currentExam.flagged.add(questionId);
  saveFlags();
  renderExamView();
}

// ── Exam screen ──
function renderExamView() {
  renderProgress();
  renderQuestionNav();
  const inReview = currentExam.mode === 'review';
  document.getElementById('cbt-questions').style.display = inReview ? 'none' : 'block';
  document.getElementById('cbt-review').style.display = inReview ? 'block' : 'none';
  if (inReview) renderReview(); else renderCurrentQuestion();
  renderNavButtons();
}

function renderProgress() {
  const total = currentExam.questions.length;
  const done = currentExam.questions.filter(q => currentExam.answersMap.has(q.id)).length;
  document.getElementById('cbt-progress-text').textContent = `${done} of ${total} answered`;
  document.getElementById('cbt-progress-fill').style.width = total ? `${(done / total) * 100}%` : '0';
}

function qnumClass(q, i) {
  return ['cbt-qnum',
    currentExam.answersMap.has(q.id) ? 'cbt-qnum-answered' : '',
    currentExam.flagged.has(q.id) ? 'cbt-qnum-flagged' : '',
    currentExam.mode === 'question' && i === currentExam.currentIndex ? 'cbt-qnum-active' : ''].filter(Boolean).join(' ');
}

function renderQuestionNav() {
  const nav = document.getElementById('cbt-question-nav');
  nav.innerHTML = currentExam.questions.map((q, i) =>
    `<button class="${qnumClass(q, i)}" onclick="goToQuestion(${i})" aria-label="Question ${i + 1}${currentExam.answersMap.has(q.id) ? ', answered' : ''}">${i + 1}</button>`).join('');
  nav.querySelector('.cbt-qnum-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderCurrentQuestion() {
  const wrap = document.getElementById('cbt-questions');
  if (!currentExam.questions.length) {
    wrap.innerHTML = '<div class="cbt-empty">No questions have been added to this exam yet.</div>';
    return;
  }
  const i = currentExam.currentIndex;
  const q = currentExam.questions[i];
  const chosen = currentExam.answersMap.get(q.id);
  const flagged = currentExam.flagged.has(q.id);
  wrap.innerHTML = `
    <div class="cbt-question-card">
      <div class="cbt-question-head">
        <strong>Question ${i + 1} of ${currentExam.questions.length}</strong>
        <span>${q.marks} mark${Number(q.marks) === 1 ? '' : 's'}</span>
      </div>
      <div class="cbt-question-text">${escapeHtml(q.questionText)}</div>
      <div class="cbt-options" role="radiogroup" aria-label="Answers">
        ${q.options.map((opt, j) => `
          <button type="button" class="cbt-option ${chosen === j ? 'selected' : ''}" role="radio" aria-checked="${chosen === j}" onclick="selectAnswer(${q.id}, ${j})">
            <span class="cbt-option-letter">${String.fromCharCode(65 + j)}</span><span>${escapeHtml(opt)}</span>
          </button>`).join('')}
      </div>
      <div class="cbt-question-tools">
        <button type="button" class="cbt-tool-btn ${flagged ? 'on' : ''}" onclick="toggleFlag(${q.id})">&#9873; ${flagged ? 'Marked for review' : 'Mark for review'}</button>
        ${chosen !== undefined ? `<button type="button" class="cbt-tool-btn" onclick="selectAnswer(${q.id}, null)">Clear my answer</button>` : ''}
        <button type="button" class="cbt-tool-btn" onclick="showReview()">Review &amp; Submit &rarr;</button>
      </div>
    </div>`;
}

function renderNavButtons() {
  const inner = document.getElementById('cbt-nav-inner');
  if (currentExam.mode === 'review') {
    inner.innerHTML = `<button class="cbt-btn cbt-btn-secondary" onclick="backToQuestions()">&larr; Back to questions</button>
      <button class="cbt-btn cbt-btn-green" onclick="askSubmit()">Submit Exam</button>`;
    return;
  }
  const i = currentExam.currentIndex;
  const isLast = i === currentExam.questions.length - 1;
  inner.innerHTML = `<button class="cbt-btn cbt-btn-secondary" onclick="goToQuestion(${i - 1})" ${i === 0 ? 'disabled' : ''}>&larr; Previous</button>
    ${isLast
      ? '<button class="cbt-btn cbt-btn-green" onclick="showReview()">Review &amp; Submit</button>'
      : `<button class="cbt-btn" onclick="goToQuestion(${i + 1})">Next &rarr;</button>`}`;
}

function goToQuestion(i) {
  if (!currentExam || i < 0 || i >= currentExam.questions.length) return;
  currentExam.currentIndex = i;
  currentExam.mode = 'question';
  renderExamView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToQuestions() {
  currentExam.mode = 'question';
  renderExamView();
}

function showReview() {
  currentExam.mode = 'review';
  currentExam.confirming = false;
  renderExamView();
  window.scrollTo(0, 0);
}

function renderReview() {
  const qs = currentExam.questions;
  const answered = qs.filter(q => currentExam.answersMap.has(q.id)).length;
  const unanswered = qs.length - answered;
  const flagged = qs.filter(q => currentExam.flagged.has(q.id)).length;
  const pending = saveQueue.size;
  document.getElementById('cbt-review').innerHTML = `
    <div class="cbt-question-card">
      <h2>Review your answers</h2>
      <div class="cbt-muted">Tap any number to go back to that question.</div>
      <div class="cbt-review-stats">
        <div class="cbt-review-stat answered"><strong>${answered}</strong>Answered</div>
        <div class="cbt-review-stat unanswered"><strong>${unanswered}</strong>Not answered</div>
        <div class="cbt-review-stat flagged"><strong>${flagged}</strong>Marked for review</div>
      </div>
      ${unanswered ? `<div class="cbt-warn-box">You have <strong>${unanswered}</strong> question${unanswered === 1 ? '' : 's'} not answered. You can still go back and answer ${unanswered === 1 ? 'it' : 'them'}.</div>` : ''}
      ${pending ? `<div class="cbt-warn-box">${pending} answer${pending === 1 ? ' is' : 's are'} still saving. Check your internet connection.</div>` : ''}
      <div class="cbt-review-grid">${qs.map((q, i) => `<button class="${qnumClass(q, i)}" onclick="goToQuestion(${i})">${i + 1}</button>`).join('')}</div>
      <div id="cbt-confirm"></div>
    </div>`;
  if (currentExam.confirming) renderConfirm();
}

function askSubmit() {
  currentExam.confirming = true;
  renderConfirm();
  document.getElementById('cbt-confirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderConfirm() {
  const box = document.getElementById('cbt-confirm');
  if (!box) return;
  box.innerHTML = `<div class="cbt-warn-box" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">
      <strong>Are you sure you want to submit?</strong> You can't change your answers after this.
    </div>
    <div class="cbt-lobby-actions" style="margin-top:0;">
      <button class="cbt-btn cbt-btn-secondary" onclick="currentExam.confirming=false;renderReview();">Not yet</button>
      <button class="cbt-btn cbt-btn-green" id="cbt-final-submit" onclick="finishExam(false, this)">Yes, submit my exam</button>
    </div>`;
}

// ── Saving answers: queued, retried until the server has them ──
const saveQueue = new Map(); // questionId -> selectedOption (null = cleared)
let saving = false;
let saveFailed = false;
let retryTimer = null;

function selectAnswer(questionId, option) {
  if (!currentExam || currentExam.submitting) return;
  if (option === null) currentExam.answersMap.delete(questionId);
  else currentExam.answersMap.set(questionId, option);
  saveQueue.set(questionId, option);
  renderExamView();
  processSaveQueue();
}

function renderSaveState() {
  const el = document.getElementById('cbt-save-state');
  if (!el) return;
  if (saveFailed && saveQueue.size) { el.className = 'cbt-save-state bad'; el.textContent = 'Not saved — retrying…'; }
  else if (saving || saveQueue.size) { el.className = 'cbt-save-state busy'; el.textContent = 'Saving…'; }
  else { el.className = 'cbt-save-state ok'; el.textContent = '✓ Saved'; }
}

async function processSaveQueue() {
  if (saving || !currentExam || !saveQueue.size) { renderSaveState(); return; }
  saving = true;
  clearTimeout(retryTimer);
  renderSaveState();
  try {
    while (saveQueue.size && currentExam) {
      const [questionId, selectedOption] = saveQueue.entries().next().value;
      await apiFetch(`/api/student/cbt/exams/${currentExam.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ questionId, selectedOption }),
      });
      // only drop it if the pupil hasn't changed the answer meanwhile
      if (saveQueue.get(questionId) === selectedOption) saveQueue.delete(questionId);
      saveFailed = false;
    }
  } catch (err) {
    if (err.status === 410) { saveQueue.clear(); saving = false; finishExam(true); return; }
    if (err.status === 409) { saveQueue.clear(); saving = false; toast('This exam has already been submitted.', 'danger'); showListView(); return; }
    saveFailed = true;
    retryTimer = setTimeout(processSaveQueue, 3000);
  } finally {
    saving = false;
    renderSaveState();
    if (currentExam?.mode === 'review') renderReview();
  }
}

async function flushSaves(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (saveQueue.size && Date.now() < until) {
    if (!saving) await processSaveQueue();
    if (saveQueue.size) await new Promise(r => setTimeout(r, 400));
  }
  return saveQueue.size === 0;
}

window.addEventListener('online', () => processSaveQueue());

// ── Timer ──
function startTimer() {
  clearInterval(timerInterval);
  const deadline = new Date(currentExam.deadline).getTime();
  const timerEl = document.getElementById('cbt-timer');
  function tick() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timerEl.textContent = '00:00';
      clearInterval(timerInterval);
      finishExam(true);
      return;
    }
    const totalSecs = Math.floor(remaining / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    timerEl.textContent = `${hrs ? `${hrs}:` : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    timerEl.classList.toggle('warn', remaining <= 5 * 60000 && remaining > 60000);
    timerEl.classList.toggle('danger', remaining <= 60000);
    if (remaining <= 60000 && !currentExam.warned.one) {
      currentExam.warned.one = currentExam.warned.five = true;
      toast('1 minute left! Check your answers.', 'danger', 6000);
    } else if (remaining <= 5 * 60000 && !currentExam.warned.five) {
      currentExam.warned.five = true;
      toast('5 minutes left.', 'warn', 5000);
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ── Submitting ──
async function finishExam(auto, btn) {
  if (!currentExam || currentExam.submitting) return;
  currentExam.submitting = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  if (!auto) {
    const allSaved = await flushSaves(8000);
    if (!allSaved) {
      currentExam.submitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Yes, submit my exam'; }
      toast('Some answers haven\'t saved yet. Check your internet connection, then try again.', 'danger', 6000);
      return;
    }
  } else {
    await flushSaves(4000); // time is up: send what we can, then submit
  }
  clearInterval(timerInterval);
  clearTimeout(retryTimer);
  try {
    const data = await apiFetch(`/api/student/cbt/exams/${currentExam.id}/submit`, { method: 'POST' });
    try { localStorage.removeItem(`cbt-flags-${currentExam.attemptId}`); } catch { /* ignore */ }
    showResultView(data, auto);
  } catch (err) {
    if (err.status === 409) { toast('This exam was already submitted.'); showListView(); return; }
    currentExam.submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, submit my exam'; }
    toast(err.network ? 'No internet connection — your answers are saved. Try submitting again.' : err.message, 'danger', 6000);
    if (auto) setTimeout(() => finishExam(true), 4000); // keep trying after time is up
  }
}

function showResultView(data, auto) {
  const pct = data.totalMarks ? Math.round((data.score / data.totalMarks) * 100) : 0;
  const cheer = pct >= 70 ? ['', 'Excellent work!'] : pct >= 50 ? ['', 'Good effort!'] : ['', 'Keep practising — you can do it!'];
  document.getElementById('cbt-result-score').innerHTML = `
        <h2>${cheer[1]}</h2>
    ${auto ? '<p class="cbt-muted">Time was up, so your exam was submitted automatically.</p>' : '<p class="cbt-muted">Your exam has been submitted.</p>'}
    <div class="cbt-result-big">${data.score} / ${data.totalMarks}</div>
    <div class="cbt-result-pct">${pct}%</div>
    <div class="cbt-muted" style="margin-top:6px;">You answered ${data.questionsAttempted} of ${data.questionsPresented} questions.</div>`;
  currentExam = null;
  showOnly('cbt-result-view');
}

function showListView() {
  clearInterval(timerInterval);
  currentExam = null;
  showOnly('cbt-list-view');
  loadExams().catch(err => toast(err.message, 'danger'));
}

async function signOut() {
  if (currentExam && !confirm('You are in the middle of an exam. Your answers are saved, but the timer keeps running. Sign out anyway?')) return;
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  window.location.replace('index.html');
}

// ── Keyboard: A–E / 1–5 answer, ← → move, F flag ──
document.addEventListener('keydown', e => {
  if (!currentExam || currentExam.mode !== 'question' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const q = currentExam.questions[currentExam.currentIndex];
  if (!q) return;
  const key = e.key.toLowerCase();
  const letter = 'abcde'.indexOf(key);
  const digit = '12345'.indexOf(key);
  const option = letter !== -1 ? letter : digit;
  if (option !== -1 && option < q.options.length) { selectAnswer(q.id, option); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goToQuestion(currentExam.currentIndex + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { goToQuestion(currentExam.currentIndex - 1); e.preventDefault(); }
  else if (key === 'f') { toggleFlag(q.id); e.preventDefault(); }
});

// Warn before leaving mid-exam (answers are saved, but the timer keeps going)
window.addEventListener('beforeunload', e => {
  if (currentExam && !currentExam.submitting) { e.preventDefault(); e.returnValue = ''; }
});

init();
