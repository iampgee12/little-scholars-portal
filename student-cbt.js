// On the exam server this page is /student itself and there is no portal to go back to
if (location.pathname === '/student') document.getElementById('cbt-back-portal')?.remove();

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
    window.location.replace('/signin');
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
const pupil = { name: '', classLabel: '', role: 'student' };

// The same page runs three ways: a pupil's real exam; a tester's trial paper on
// the exam computer (trial accounts: nothing counts); and "Try as a pupil" for
// teachers and admins online (?try: answers stay in the browser, nothing is
// saved, and there's no time limit). Testers and teachers end on a report of
// each answer they picked next to the one marked correct.
let MODE = 'pupil';
const PATHS = {
  pupil: { list: '/api/student/cbt/exams', paper: id => `/api/student/cbt/exams/${id}` },
  trial: { list: '/api/trial/papers', paper: id => `/api/trial/papers/${id}` },
  try: { list: '/api/cbt-try/papers', paper: id => `/api/cbt-try/papers/${encodeURIComponent(id)}` },
};
const findExam = id => examsCache.find(x => String(x.id) === String(id));

// Top bar: "Hi, name" and the class; during an exam the subject, then the name
// and class, on the left and the timer on the right
function renderHeader() {
  const inExam = !!currentExam && document.getElementById('cbt-exam-view').style.display !== 'none';
  document.getElementById('cbt-who-main').textContent = inExam ? currentExam.subjectName : (pupil.name ? `Hi, ${pupil.name}` : 'Hi there');
  document.getElementById('cbt-who-sub').textContent = (inExam ? [pupil.name, currentExam.classLabel || pupil.classLabel] : [pupil.classLabel]).filter(Boolean).join(' · ');
  document.getElementById('cbt-timer').style.display = inExam && MODE !== 'try' ? '' : 'none';
  for (const id of ['cbt-back-portal', 'cbt-signout']) {
    const el = document.getElementById(id);
    if (el) el.style.display = inExam ? 'none' : '';
  }
}

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
  ['cbt-list-view', 'cbt-lobby-view', 'cbt-exam-view', 'cbt-result-view', 'cbt-report-view'].forEach(id => {
    document.getElementById(id).style.display = id === viewId ? 'block' : 'none';
  });
  renderHeader();
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
    const role = session.user.role;
    if (role === 'student') MODE = session.user.trial ? 'trial' : 'pupil';
    else if (['teacher', 'admin'].includes(role) && new URLSearchParams(location.search).has('try')) MODE = 'try';
    else {
      window.location.replace('/signin');
      return;
    }
    pupil.name = session.user.name;
    pupil.role = role;
    renderHeader();
    document.getElementById('cbt-hello').textContent = MODE === 'try' ? 'Try your questions as a pupil' : `Hello, ${session.user.firstName || session.user.name}!`;
    if (MODE !== 'pupil') {
      const banner = document.getElementById('cbt-mode-banner');
      banner.textContent = MODE === 'trial'
        ? 'TRIAL RUN · Nothing here counts. Trial answers and scores are never saved as real results.'
        : 'PRACTICE · You see the questions exactly as pupils will. Nothing is saved, and there is no time limit.';
      banner.style.display = '';
      document.querySelector('#cbt-list-view .cbt-sub').innerHTML = MODE === 'trial'
        ? 'Pick a paper to try it, as often as you like. At the end you\'ll see any answer that is marked wrongly.'
        : 'Pick a class and subject to go through its questions. At the end you\'ll see each answer you picked next to the one marked correct.';
      const portal = document.getElementById('cbt-back-portal');
      if (portal) portal.href = role === 'admin' ? '/admin' : '/teacher';
    }
    // testers: keep the Trial Run page's "Connected computers" up to date
    if (MODE === 'trial') setInterval(pingExamServer, 15000);
    await loadExams();
  } catch (err) {
    document.getElementById('cbt-exam-list').innerHTML = `<div class="cbt-empty">${escapeHtml(err.network ? 'No internet connection. Check your connection and refresh the page.' : err.message)}</div>`;
  }
}

let lastPing = '';
async function pingExamServer() {
  const t0 = performance.now();
  try {
    await fetch(`/api/check/ping?rtt=${lastPing}`, { cache: 'no-store' });
    lastPing = Math.round(performance.now() - t0);
  } catch { lastPing = ''; }
}

async function loadExams() {
  const data = await apiFetch(PATHS[MODE].list);
  examsCache = data.exams || [];
  pupil.name = data.student?.name || pupil.name;
  pupil.classLabel = data.student?.classLabel || '';
  renderHeader();
  if (MODE === 'pupil') renderExamList(); else renderTrialList();
}

// Testers and teachers: every paper they can try, grouped by class (a tester's
// own subjects first), each one as often as they like
function renderTrialList() {
  const wrap = document.getElementById('cbt-exam-list');
  if (!examsCache.length) {
    wrap.innerHTML = `<div class="cbt-empty">${MODE === 'trial'
      ? 'No papers are open for the trial yet. Ask IT to turn Trial on for some papers on the exam server.'
      : 'You have no classes and subjects with CBT questions yet.'}</div>`;
    return;
  }
  const groups = new Map();
  examsCache.forEach(e => {
    const key = MODE === 'trial' && e.mine ? 'Your subjects' : e.classLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  wrap.innerHTML = [...groups].map(([title, list]) => `
    <div class="cbt-group-title">${escapeHtml(title)} (${list.length})</div>
    <div class="cbt-exam-grid">${list.map(e => {
      const facts = [
        MODE === 'try' ? (e.durationMinutes ? `Pupils get ${e.durationMinutes} min` : 'No time limit') : `${e.durationMinutes} min`,
        `${e.questionCount} question${e.questionCount === 1 ? '' : 's'}`,
      ];
      if (e.paperMarks) facts.push(`${e.paperMarks} mark${e.paperMarks === 1 ? '' : 's'}`);
      return `<div class="cbt-exam-card ready">
        <div class="cbt-exam-card-head"><span>${escapeHtml(e.subjectName)}</span><span class="cbt-badge ${e.attemptStatus === 'in_progress' ? 'cbt-badge-upcoming' : 'cbt-badge-live'}">${e.attemptStatus === 'in_progress' ? 'In progress' : escapeHtml(e.classLabel)}</span></div>
        <div class="cbt-muted">${escapeHtml(e.classLabel)}${e.scheduleTitle ? ` · ${escapeHtml(e.scheduleTitle)}` : ''}${e.lastScore !== null && e.lastScore !== undefined ? ` · Last try: ${e.lastScore} / ${e.lastTotal}` : ''}</div>
        <div class="cbt-facts">${facts.map(f => `<span class="cbt-fact">${f}</span>`).join('')}</div>
        <div class="cbt-exam-card-foot">${e.questionCount > 0
          ? `<button class="cbt-btn cbt-btn-block cbt-btn-green" onclick="openLobby('${escapeHtml(String(e.id))}')">${e.attemptStatus === 'in_progress' ? 'Continue' : 'Try it'}</button>`
          : '<span class="cbt-muted">No questions have been added yet.</span>'}</div>
      </div>`;
    }).join('')}</div>`).join('');
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
  const e = findExam(id);
  if (!e) return;
  const resuming = e.attemptStatus === 'in_progress';
  const note = MODE === 'trial'
    ? '<div class="cbt-resume-note">This is a trial paper. Nothing counts, and you can try it as often as you like. The timer is real, so you see what pupils will.</div><br>'
    : MODE === 'try'
      ? `<div class="cbt-resume-note">This is a practice run of your questions. Nothing is saved, and there is no time limit${e.durationMinutes ? ` (pupils get ${e.durationMinutes} minutes)` : ''}.</div><br>`
      : '';
  const custom = (e.instructions || []).map(set => `
    <div class="cbt-instructions"><h3>${escapeHtml(set.title)}</h3><p>${escapeHtml(set.text)}</p></div>`).join('');
  document.getElementById('cbt-lobby-view').innerHTML = `
    <div class="cbt-lobby">
      <div class="cbt-muted">${escapeHtml([e.classLabel, e.scheduleTitle].filter(Boolean).join(' · '))}</div>
      <h2>${escapeHtml(e.subjectName)}</h2>
      <div class="cbt-lobby-facts">
        <div class="cbt-lobby-fact"><strong>${e.durationMinutes || '—'}</strong><span>minutes</span></div>
        <div class="cbt-lobby-fact"><strong>${e.questionCount}</strong><span>questions</span></div>
        <div class="cbt-lobby-fact"><strong>${e.paperMarks || '—'}</strong><span>marks</span></div>
      </div>
      ${note || (resuming ? '<div class="cbt-resume-note">You already started this exam. Your answers are saved and the timer has kept running — continue now.</div><br>' : '')}
      ${custom}
      <div class="cbt-instructions">
        <h3>Instructions</h3>
        <ul>
          <li>Read each question carefully before you choose an answer.</li>
          <li>Choose only <strong>one</strong> answer for each question. The next question comes up by itself.</li>
          <li>Do not talk to anyone or copy from anyone.</li>
          <li>Keep an eye on the timer at the top of the screen.</li>
          <li>Not sure? Tap <strong>Mark for review</strong> and come back to it later.</li>
          <li>The numbers at the bottom take you to any question. Green means answered.</li>
          <li>Raise your hand if you need help. Do not close or refresh the page.</li>
          <li>When you finish, check your answers, then tap <strong>Review &amp; Submit</strong>.</li>
          <li>If time runs out, your exam is handed in for you.</li>
        </ul>
      </div>
      <div class="cbt-lobby-actions">
        <button class="cbt-btn cbt-btn-secondary" onclick="showListView()">Back</button>
        <button class="cbt-btn cbt-btn-green" id="cbt-begin-btn" onclick="beginExam('${escapeHtml(String(e.id))}', this)">${resuming ? 'Continue Exam' : 'Begin Exam'}</button>
      </div>
    </div>`;
  showOnly('cbt-lobby-view');
}

async function beginExam(id, btn) {
  const meta = findExam(id) || {};
  if (btn) btn.disabled = true;
  try {
    const data = await apiFetch(`${PATHS[MODE].paper(id)}/start`, { method: 'POST' });
    currentExam = {
      id,
      subjectName: meta.subjectName || 'Exam',
      classLabel: MODE === 'pupil' ? '' : meta.classLabel || '',
      ...data,
      // trial and practice runs keep their unsent answers and flags apart from real exams
      attemptId: MODE === 'pupil' ? data.attemptId : `${MODE}-${data.attemptId}`,
      currentIndex: 0,
      mode: 'question',
      answersMap: new Map((data.answers || []).filter(a => a.selectedOption !== null).map(a => [a.questionId, a.selectedOption])),
      flagged: new Set(loadFlags(data.attemptId)),
      warned: {},
    };
    // Resume at the first unanswered question
    const restored = restorePendingAnswers();
    if (restored) toast(`${restored} answer${restored === 1 ? '' : 's'} kept on this device ${restored === 1 ? 'was' : 'were'} restored and ${restored === 1 ? 'is' : 'are'} being saved.`, 'warn', 6000);
    const firstOpen = currentExam.questions.findIndex(q => !currentExam.answersMap.has(q.id));
    currentExam.currentIndex = firstOpen === -1 ? 0 : firstOpen;
    showOnly('cbt-exam-view');
    renderExamView();
    if (MODE !== 'try') startTimer();
    if (saveQueue.size) processSaveQueue();
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
      </div>
    </div>`;
}

// The bottom dock only shows while answering; the review screen has its own buttons
function renderNavButtons() {
  const inReview = currentExam.mode === 'review';
  document.getElementById('cbt-nav-buttons').style.display = inReview ? 'none' : '';
  if (inReview) return;
  const i = currentExam.currentIndex;
  const isLast = i === currentExam.questions.length - 1;
  document.getElementById('cbt-prev-slot').innerHTML = `<button class="cbt-btn cbt-btn-secondary" onclick="goToQuestion(${i - 1})" ${i === 0 ? 'disabled' : ''}>&#8592; Previous</button>`;
  document.getElementById('cbt-next-slot').innerHTML = isLast
    ? '<button class="cbt-btn cbt-btn-green" onclick="showReview()">Review &amp; Submit</button>'
    : `<button class="cbt-btn" onclick="goToQuestion(${i + 1})">Next &#8594;</button>`;
}

function goToQuestion(i) {
  clearTimeout(advanceTimer);
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
  clearTimeout(advanceTimer);
  currentExam.mode = 'review';
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
      ${pending ? `<div class="cbt-warn-box">${pending} answer${pending === 1 ? ' is' : 's are'} still being sent. ${saveOffline ? 'You\'re offline — they are kept safely on this device.' : 'Please wait a moment.'}</div>` : ''}
      <div class="cbt-review-grid">${qs.map((q, i) => `<button class="${qnumClass(q, i)}" onclick="goToQuestion(${i})">${i + 1}</button>`).join('')}</div>
      <div class="cbt-legend" style="margin-bottom:18px;"><span><i class="l-answered"></i>Answered</span><span><i></i>Not answered</span><span><i class="l-flagged"></i>Marked for review</span></div>
      <div class="cbt-review-actions">
        <button class="cbt-btn cbt-btn-secondary" onclick="backToQuestions()">&#8592; Back to questions</button>
        <button class="cbt-btn cbt-btn-green" onclick="askSubmit()">Submit</button>
      </div>
    </div>`;
}

// The final check: a card in the middle of a dimmed screen, so the buttons never
// swap under a pupil's finger and a double tap can't hand the exam in by mistake
function askSubmit() {
  closeConfirm();
  const qs = currentExam.questions;
  const answered = qs.filter(q => currentExam.answersMap.has(q.id)).length;
  const missing = qs.length - answered;
  const back = document.createElement('div');
  back.className = 'cbt-modal-back';
  back.id = 'cbt-confirm';
  back.innerHTML = `<div class="cbt-modal" role="dialog" aria-modal="true" aria-labelledby="cbt-confirm-title">
      <h2 id="cbt-confirm-title">Are you sure you're finished?</h2>
      <p>You answered <strong>${answered}</strong> of <strong>${qs.length}</strong> questions.</p>
      ${missing ? `<p class="cbt-modal-missing">${missing} question${missing === 1 ? ' is' : 's are'} not answered.</p>` : ''}
      <p>You can't change your answers after this.</p>
      <div class="cbt-modal-actions">
        <button class="cbt-btn cbt-btn-secondary" onclick="closeConfirm()">No, go back</button>
        <button class="cbt-btn cbt-btn-green" id="cbt-final-submit" onclick="finishExam(false, this)">Yes, submit</button>
      </div>
    </div>`;
  back.addEventListener('click', e => { if (e.target === back && !currentExam?.submitting) closeConfirm(); });
  document.body.appendChild(back);
  back.querySelector('.cbt-btn-secondary').focus();
}

function closeConfirm() {
  document.getElementById('cbt-confirm')?.remove();
}

// ── Saving answers: queued, retried until the server has them ──
const saveQueue = new Map(); // questionId -> selectedOption (null = cleared)
let saving = false;
let saveFailed = false;
let saveOffline = false; // last failure was the connection, not the server
let retryTimer = null;

// Unsent answers are also kept on the device, so a refresh, crash or restart
// while the connection is down loses nothing; they're re-sent on return.
function pendingKey(attemptId = currentExam?.attemptId) { return `cbt-pending-${attemptId}`; }
function persistQueue() {
  if (!currentExam) return;
  try {
    if (saveQueue.size) localStorage.setItem(pendingKey(), JSON.stringify([...saveQueue]));
    else localStorage.removeItem(pendingKey());
  } catch { /* storage unavailable: answers still retry while the page is open */ }
}
function restorePendingAnswers() {
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(pendingKey()) || '[]'); } catch { pending = []; }
  const ids = new Set(currentExam.questions.map(q => q.id));
  pending.filter(([questionId]) => ids.has(questionId)).forEach(([questionId, option]) => {
    if (option === null) currentExam.answersMap.delete(questionId);
    else currentExam.answersMap.set(questionId, option);
    saveQueue.set(questionId, option);
  });
  return saveQueue.size;
}
function clearPending(attemptId) {
  saveQueue.clear();
  try { localStorage.removeItem(pendingKey(attemptId)); } catch { /* ignore */ }
}

// Young pupils: choosing an answer moves on to the next question by itself, after a
// moment so they see their choice marked. The last question stays put.
let advanceTimer = null;
function selectAnswer(questionId, option) {
  if (!currentExam || currentExam.submitting) return;
  if (option === null) currentExam.answersMap.delete(questionId);
  else currentExam.answersMap.set(questionId, option);
  // practice runs keep answers in the browser only
  if (MODE !== 'try') {
    saveQueue.set(questionId, option);
    persistQueue();
  }
  renderExamView();
  if (MODE !== 'try') processSaveQueue();
  clearTimeout(advanceTimer);
  const i = currentExam.currentIndex;
  if (option !== null && currentExam.mode === 'question' && i < currentExam.questions.length - 1) {
    advanceTimer = setTimeout(() => { if (currentExam?.mode === 'question' && currentExam.currentIndex === i) goToQuestion(i + 1); }, 700);
  }
}

function renderSaveState() {
  const el = document.getElementById('cbt-save-state');
  if (!el) return;
  if (saveFailed && saveOffline && saveQueue.size) { el.className = 'cbt-save-state bad'; el.textContent = 'Offline — your answers are kept on this device'; }
  else if (saveFailed && saveQueue.size) { el.className = 'cbt-save-state bad'; el.textContent = 'Not saved — retrying…'; }
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
      await apiFetch(`${PATHS[MODE].paper(currentExam.id)}/answer`, {
        method: 'POST',
        body: JSON.stringify({ questionId, selectedOption }),
      });
      // only drop it if the pupil hasn't changed the answer meanwhile
      if (saveQueue.get(questionId) === selectedOption) saveQueue.delete(questionId);
      persistQueue();
      saveFailed = false;
      saveOffline = false;
    }
  } catch (err) {
    if (err.status === 410) { clearPending(); saving = false; finishExam(true); return; }
    if (err.status === 409) { clearPending(); saving = false; toast('This exam has already been submitted.', 'danger'); showListView(); return; }
    saveFailed = true;
    saveOffline = !!err.network;
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
      if (btn) { btn.disabled = false; btn.textContent = 'Yes, submit'; }
      toast(saveOffline ? 'You\'re offline. Your answers are safe on this device — submit again when the connection is back.' : 'Some answers haven\'t saved yet. Wait a moment, then try again.', 'danger', 7000);
      return;
    }
  } else {
    await flushSaves(4000); // time is up: send what we can, then submit
  }
  clearInterval(timerInterval);
  clearTimeout(retryTimer);
  try {
    const paper = PATHS[MODE].paper(currentExam.id);
    const data = MODE === 'try'
      ? await apiFetch(`${paper}/check`, { method: 'POST', body: JSON.stringify({ answers: [...currentExam.answersMap] }) })
      : await apiFetch(`${paper}/submit`, { method: 'POST' });
    try { localStorage.removeItem(`cbt-flags-${currentExam.attemptId}`); } catch { /* ignore */ }
    clearPending(currentExam.attemptId);
    if (MODE === 'pupil') showResultView(data, auto); else showReport(data);
  } catch (err) {
    if (err.status === 409) { toast('This exam was already submitted.'); showListView(); return; }
    currentExam.submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, submit'; }
    toast(err.network ? `Connection lost — your answers are safe. ${auto ? 'Handing in again automatically…' : 'Try submitting again in a moment.'}` : err.message, 'danger', 6000);
    if (auto) setTimeout(() => finishExam(true), 4000); // keep trying after time is up
  }
}

// Name, class, subject, then the score: nothing else
function showResultView(data) {
  closeConfirm();
  const pct = data.totalMarks ? Math.round((data.score / data.totalMarks) * 100) : 0;
  document.getElementById('cbt-result-score').innerHTML = `
    <div class="cbt-result-name">${escapeHtml(pupil.name)}${pupil.classLabel ? `<span class="cbt-result-class">${escapeHtml(pupil.classLabel)}</span>` : ''}</div>
    <div class="cbt-result-subject">${escapeHtml(currentExam.subjectName)}</div>
    <div class="cbt-result-label">Score</div>
    <div class="cbt-result-big">${data.score} / ${data.totalMarks}</div>
    <div class="cbt-result-pct">${pct}%</div>`;
  currentExam = null;
  showOnly('cbt-result-view');
}

// Testers and teachers: "Check your questions": each answer picked next to the one
// marked correct, with warnings for badly made questions. Problems first.
function showReport(data) {
  closeConfirm();
  const items = data.review || [];
  const count = s => items.filter(i => i.status === s).length;
  const problems = items.filter(i => i.status === 'mismatch' || i.warnings.length);
  const letter = i => String.fromCharCode(65 + i);
  const card = i => `<div class="cbt-rq ${i.status === 'mismatch' ? 'bad' : i.warnings.length ? 'warn' : ''}">
      <div class="cbt-rq-head"><strong>Question ${i.number}</strong>
        <span class="cbt-badge ${i.status === 'match' ? 'cbt-badge-live' : i.status === 'mismatch' ? 'cbt-badge-bad' : 'cbt-badge-closed'}">${i.status === 'match' ? 'Matches the marked answer' : i.status === 'mismatch' ? 'Different from the marked answer' : 'Not answered'}</span></div>
      <div class="cbt-rq-text">${escapeHtml(i.questionText)}</div>
      <ul class="cbt-rq-options">${i.options.map((o, j) => `<li class="${i.correct.includes(j) ? 'correct' : ''} ${i.picked === j ? 'picked' : ''}">
        <span class="cbt-option-letter">${letter(j)}</span><span class="cbt-rq-opt">${escapeHtml(o) || '<em>(empty)</em>'}</span>
        ${i.correct.includes(j) ? '<span class="cbt-rq-tag ok">Marked correct</span>' : ''}${i.picked === j ? `<span class="cbt-rq-tag ${i.correct.includes(j) ? 'ok' : 'bad'}">You picked</span>` : ''}</li>`).join('')}</ul>
      ${i.warnings.length ? `<div class="cbt-warn-box">${i.warnings.map(w => `⚠ ${escapeHtml(w)}`).join('<br>')}</div>` : ''}
    </div>`;
  const fixHint = MODE === 'try' && pupil.role === 'teacher'
    ? '<p class="cbt-sub">To fix a question, open <strong>My CBT Questions</strong> in your portal, then try again.</p>'
    : MODE === 'try' ? '<p class="cbt-sub">To fix a question, open the <strong>Question Bank</strong> for this class and subject, then try again.</p>'
      : '<p class="cbt-sub">Tell the subject teacher about any question marked below, so they can fix it online before exam day.</p>';
  document.getElementById('cbt-report-view').innerHTML = `
    <div class="cbt-lobby" style="max-width:820px;">
      <div class="cbt-muted">${escapeHtml(currentExam.classLabel)}</div>
      <h2>Check your questions: ${escapeHtml(currentExam.subjectName)}</h2>
      ${fixHint}
      <div class="cbt-review-stats" style="grid-template-columns:repeat(4,1fr);">
        <div class="cbt-review-stat answered"><strong>${count('match')}</strong>Match</div>
        <div class="cbt-review-stat unanswered"><strong>${count('mismatch')}</strong>Different</div>
        <div class="cbt-review-stat"><strong>${count('skipped')}</strong>Not answered</div>
        <div class="cbt-review-stat flagged"><strong>${items.filter(i => i.warnings.length).length}</strong>With warnings</div>
      </div>
      <p class="cbt-muted">Score as a pupil would get it: <strong>${data.score} / ${data.totalMarks}</strong></p>
      ${problems.length ? `<div class="cbt-group-title">Needs a look (${problems.length})</div>${problems.map(card).join('')}` : '<div class="cbt-resume-note" style="background:var(--green-bg);color:var(--green);">No problems found: every answer you picked matches the marked answer, and no question has warnings.</div>'}
      ${items.length > problems.length ? `<details class="cbt-rq-all"><summary>All questions (${items.length})</summary>${items.map(card).join('')}</details>` : ''}
      <div class="cbt-lobby-actions"><button class="cbt-btn cbt-btn-green" onclick="showListView()">Back to papers</button></div>
    </div>`;
  currentExam = null;
  showOnly('cbt-report-view');
}

function showListView() {
  closeConfirm();
  clearInterval(timerInterval);
  currentExam = null;
  showOnly('cbt-list-view');
  loadExams().catch(err => toast(err.message, 'danger'));
}

async function signOut() {
  if (currentExam && !await uiConfirm('You are in the middle of an exam. Your answers are saved, but the timer keeps running. Sign out anyway?')) return;
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  window.location.replace('/signin');
}

// ── Keyboard: A–E / 1–5 answer, ← → move, F flag ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('cbt-confirm') && !currentExam?.submitting) { closeConfirm(); return; }
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
