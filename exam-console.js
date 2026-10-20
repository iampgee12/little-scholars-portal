// UCS Exam Server — the app's screens (runs on the exam computer, EXAM_MODE).
// Setup: Connect School Account → first Refresh → Sign in. Then a portal-style
// shell: Dashboard, Exam Console, CBT Schedules, Push Results, Archive, Refresh
// Data, Sync Report, Connection & Files, Students, Staff, Check for Updates.
const rootEl = document.getElementById('ea-root');
const state = { page: 'dashboard', user: null, status: null, sync: null, dash: null, overview: null, openPaperId: null, timer: null };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Request failed'); err.status = res.status; throw err; }
  return data;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const initials = name => String(name || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(mr|mrs|miss|ms|dr)\.?$/i.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

// ── pop-up with a body and buttons (keeps the portal's look) ──
function modal(title, body, foot) {
  closeModal();
  const el = document.createElement('div');
  el.className = 'ea-modal';
  el.id = 'ea-modal';
  el.innerHTML = `<div class="ea-dialog" role="dialog" aria-modal="true"><div class="ea-dialog-head"><span>${title}</span><button type="button" aria-label="Close" onclick="closeModal()">&times;</button></div>
    <div class="ea-dialog-body">${body}</div><div class="ea-dialog-foot">${foot}</div></div>`;
  document.body.appendChild(el);
}
function closeModal() { document.getElementById('ea-modal')?.remove(); }

// ══ START ══
async function start() {
  clearInterval(state.timer);
  try {
    [state.status, state.sync] = await Promise.all([api('/api/exam/status'), api('/api/exam/sync-status')]);
  } catch (err) { return setupScreen('Something went wrong', `<p class="ec-error">${esc(err.message)}</p>`); }
  if (!state.status.setUp) return state.sync.connected ? renderFirstRefresh() : renderConnect();
  let session = null;
  try { session = await api('/api/session'); } catch { /* not signed in */ }
  if (!session?.user || session.user.role !== 'admin') return renderSignIn();
  state.user = session.user;
  go(location.hash.slice(1) || 'dashboard');
}

// ══ SETUP SCREENS ══
function setupScreen(title, body) {
  rootEl.innerHTML = `<div class="ea-setup"><div class="ea-setup-card">
    <div class="ea-setup-head"><img src="/report_assets/exam-app-icon.png" alt=""><div><b>${esc(state.sync?.school || "Unique Children's School")}</b><small>UCS Exam Server · Offline CBT</small></div></div>
    <div class="ea-setup-body"><h2>${title}</h2>${body}</div></div></div>`;
}
function renderConnect(error = '') {
  const s = state.sync || {};
  setupScreen('Connect School Account', `
    <p class="ec-muted">Type the school's API keys. They were written down when a super admin generated them on the online portal (<b>E-Class › CBT › Offline CBT (LAN) › School API keys</b>). Every exam computer uses the same keys.</p>
    <div class="ec-field"><label for="ec-api">API Number <span class="ec-req">*</span></label><input class="ec-input" id="ec-api" placeholder="UCS12345678" autocomplete="off"></div>
    <div class="ec-field"><label for="ec-auth">API Authentication Key <span class="ec-req">*</span></label><input class="ec-input" id="ec-auth" autocomplete="off"></div>
    <div class="ec-field"><label for="ec-secret">API Secret Key <span class="ec-req">*</span></label><input class="ec-input" id="ec-secret" type="password" autocomplete="off"></div>
    <details style="margin-top:12px;"><summary class="ec-hint" style="cursor:pointer;">Advanced: portal address</summary>
      <div class="ec-field"><label for="ec-portal">Online portal address</label><input class="ec-input" id="ec-portal" value="${esc(s.portal || s.defaultPortal || '')}"></div></details>
    <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap;"><button class="post-btn" id="ec-connect" onclick="connectPortal()">Connect</button></div>
    <div class="ec-error" id="ec-err">${esc(error)}</div>
    <p class="ec-hint" style="margin-top:14px;">No internet here? <a href="#" onclick="renderLoadPack(true);return false;">Set up with an exam pack file instead</a>.</p>`);
  setTimeout(() => document.getElementById('ec-api')?.focus(), 50);
}
async function connectPortal() {
  const v = id => document.getElementById(id).value.trim();
  const body = { apiNumber: v('ec-api'), authKey: v('ec-auth'), secret: document.getElementById('ec-secret').value.trim(), portal: v('ec-portal') };
  const err = document.getElementById('ec-err');
  if (!body.apiNumber || !body.authKey || !body.secret) { err.textContent = 'Enter all three keys.'; return; }
  const btn = document.getElementById('ec-connect');
  btn.disabled = true; btn.textContent = 'Connecting…'; err.textContent = '';
  try {
    await api('/api/exam/connect', { method: 'POST', body: JSON.stringify(body) });
    if (state.user) { closeModal(); showToastish('Connected to the school portal'); return go('connection'); }
    state.sync = await api('/api/exam/sync-status');
    renderFirstRefresh();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Connect';
  }
}
function renderFirstRefresh() {
  setupScreen('Fetch your school\'s data', `
    <p class="ec-muted">Connected to <b>${esc(state.sync.school || 'the school portal')}</b>. Now copy pupils, staff and CBT papers from the online portal onto this computer.</p>
    <label class="ec-check"><input type="checkbox" id="ec-confirm"> I confirm that I want to fetch all necessary data from the online portal</label>
    <div style="margin-top:16px;"><button class="post-btn" id="ec-go" onclick="firstRefresh()">Fetch Data</button></div>
    <div id="ec-progress"></div><div class="ec-error" id="ec-err"></div>`);
}
async function firstRefresh() {
  if (!document.getElementById('ec-confirm').checked) { document.getElementById('ec-err').textContent = 'Tick the box to confirm.'; return; }
  const btn = document.getElementById('ec-go');
  btn.disabled = true;
  document.getElementById('ec-progress').innerHTML = '<p class="ec-hint" style="margin-top:12px;">Connecting to the online school portal to fetch data… Please be patient.</p><div class="ea-progress"><i></i></div>';
  try {
    const { report } = await api('/api/exam/refresh', { method: 'POST', body: JSON.stringify({ confirm: true, group: 'all' }) });
    setupScreen('Data fetched', `${reportTable(report)}<p class="ec-muted" style="margin-top:14px;">Now sign in with your usual <b>admin ID or email and password</b>.</p>
      <a class="post-btn" style="display:inline-block;text-decoration:none;margin-top:6px;" href="/signin">Sign In</a>`);
  } catch (e) {
    document.getElementById('ec-progress').innerHTML = '';
    document.getElementById('ec-err').textContent = e.message;
    btn.disabled = false;
  }
}
function renderSignIn() {
  setupScreen('Sign in to run the exams', `
    <p class="ec-muted">This exam computer is ready. Sign in with your usual <b>admin ID or email and password</b>.</p>
    <a class="post-btn" style="display:inline-block;text-decoration:none;margin-top:6px;" href="/signin">Sign In</a>
    ${addressBlock(state.status.lanAddresses)}`);
}
function renderLoadPack(firstTime) {
  const body = `
    <p class="ec-muted">Load the exam pack downloaded from the online portal (<b>E-Class › CBT › Offline CBT (LAN) › Download Exam Pack</b>), with its passphrase.</p>
    <div class="ec-field"><label for="ec-file">Exam pack file (.ucscbt)</label><input class="ec-input" type="file" id="ec-file" accept=".ucscbt"></div>
    <div class="ec-field"><label for="ec-pass">Passphrase</label><input class="ec-input" type="password" id="ec-pass" autocomplete="off"></div>
    ${firstTime ? '' : '<label class="ec-check"><input type="checkbox" id="ec-replace"> Replace this computer\'s exams and results that haven\'t been sent</label>'}
    <div class="ec-error" id="ec-err"></div>`;
  if (firstTime) {
    setupScreen('Set up with an exam pack file', `${body}<div style="margin-top:12px;display:flex;gap:8px;"><button class="post-btn" id="ec-load" onclick="loadPack()">Load Exam Pack</button><button class="btn-outline" onclick="renderConnect()">Back</button></div>`);
  } else {
    modal('Load an exam pack file', body, '<button class="btn-outline" onclick="closeModal()">Cancel</button><button class="post-btn" id="ec-load" onclick="loadPack()">Load Exam Pack</button>');
  }
}
async function loadPack() {
  const file = document.getElementById('ec-file').files?.[0];
  const passphrase = document.getElementById('ec-pass').value;
  const errEl = document.getElementById('ec-err');
  errEl.textContent = '';
  if (!file) { errEl.textContent = 'Choose the exam pack file.'; return; }
  if (!passphrase) { errEl.textContent = 'Type the passphrase.'; return; }
  const btn = document.getElementById('ec-load');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const data = await api('/api/exam/import', { method: 'POST', body: JSON.stringify({ fileDataUrl: await readFileAsDataUrl(file), passphrase, replaceResults: !!document.getElementById('ec-replace')?.checked }) });
    closeModal();
    await uiNotice('Exam pack loaded', `${plural(data.loaded.papers, 'paper')}, ${plural(data.loaded.students, 'pupil')}, ${plural(data.loaded.questions, 'question')}.`);
    start();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Load Exam Pack';
  }
}

// ══ APP SHELL ══
const MENU = [
  [null, [['dashboard', 'Dashboard']]],
  ['Computer-Based Tests', [['console', 'Exam Console'], ['schedules', 'CBT Schedules'], ['push', 'Push Results Online'], ['archive', 'Submissions Archive']]],
  ['Data Management & Sync', [['refresh', 'Refresh Data'], ['report', 'Sync Report'], ['connection', 'Connection & Files']]],
  ['People', [['students', 'Students'], ['staff', 'Staff']]],
  ['Help', [['updates', 'Check for Updates']]],
];
const TITLES = {
  dashboard: ['Dashboard', 'This exam computer at a glance'], console: ['Exam Console', 'Open and close papers, watch pupils, allow retakes'],
  schedules: ['CBT Schedules', 'Papers copied from the online portal'], push: ['Push Results Online', 'Send finished exams to the online portal'],
  archive: ['Submissions Archive', 'Every exam written on this computer'], refresh: ['Refresh Data', 'Copy the latest data from the online portal'],
  report: ['Sync Report', 'What the last refresh copied'], connection: ['Connection & Files', 'The school portal link, and the file backup'],
  students: ['Students', 'Read-only list copied from the portal'], staff: ['Staff', 'Read-only list copied from the portal'],
  updates: ['Check for Updates', 'Keep the exam server up to date'],
};
function shell() {
  const t = state.dash?.term;
  const addr = (state.dash?.lanAddresses || state.status?.lanAddresses || [])[0];
  rootEl.innerHTML = `<div class="ea-shell" id="ea-shell">
    <aside class="ea-side">
      <div class="ea-brand"><img src="/report_assets/exam-app-icon.png" alt=""><div><b>${esc(state.sync?.school || "Unique Children's School")}</b><small>UCS Exam Server</small></div></div>
      <div class="ea-user"><span class="ea-avatar">${esc(initials(state.user.name))}</span><div><b>${esc(state.user.name)}</b><small>Administration</small></div></div>
      <nav class="ea-nav">${MENU.map(([group, items]) => `${group ? `<h4>${group}</h4>` : ''}${items.map(([k, l]) => `<button type="button" data-page="${k}" class="${state.page === k ? 'active' : ''}" onclick="go('${k}')">${l}${k === 'push' && state.sync?.unpushed ? `<span class="ea-badge">${state.sync.unpushed}</span>` : ''}</button>`).join('')}`).join('')}</nav>
      <div class="ea-side-foot"><button type="button" class="btn-outline" onclick="signOut()">Sign Out</button><div class="ea-version">${state.dash?.app?.version ? `v${esc(state.dash.app.version)} · ${esc(state.dash.app.build)}` : 'UCS Exam Server'}</div></div>
    </aside>
    <div class="ea-main">
      <header class="ea-top">
        <button class="ea-menu-btn" aria-label="Menu" onclick="document.getElementById('ea-shell').classList.toggle('menu-open')">☰</button>
        <div><h1>${TITLES[state.page][0]}</h1><div class="sub">${TITLES[state.page][1]}</div></div>
        <div class="right">${addr ? `<span class="ea-addr-chip" title="Pupils open this address">${esc(addr.replace(/^https?:\/\//, ''))}</span>` : ''}
          <div class="ea-term">Academic Session <b>${esc(t?.session || '—')}</b><br>Active Term <b class="blue">${esc(t?.term || '—')}</b></div></div>
      </header>
      <main class="ea-wrap" id="ea-page"><div class="ec-muted">Loading…</div></main>
    </div></div>`;
}
async function go(page) {
  if (!TITLES[page]) page = 'dashboard';
  clearInterval(state.timer);
  state.page = page;
  history.replaceState(null, '', `#${page}`);
  try {
    [state.dash, state.sync] = await Promise.all([api('/api/exam/dashboard'), api('/api/exam/sync-status')]);
  } catch (err) { if (err.status === 401 || err.status === 403) return start(); }
  shell();
  const render = { dashboard: renderDashboard, console: renderConsole, schedules: renderSchedules, push: renderPush, archive: renderArchive, refresh: renderRefresh, report: renderReport, connection: renderConnection, students: renderStudents, staff: renderStaff, updates: renderUpdates }[page];
  await render();
}
const pageEl = () => document.getElementById('ea-page');
function showToastish(text) { if (typeof uiNotice === 'function') uiNotice(text, ''); }
function addressBlock(addresses) {
  return `<div class="ec-field"><label>Pupils open this address on the school Wi-Fi</label>
    <div class="ec-address">${(addresses || []).map(a => `<code>${esc(a)}</code>`).join('') || '<span class="ec-error">This computer is not connected to a network yet. Connect it to the school router/Wi-Fi.</span>'}</div></div>`;
}

// ── Dashboard ──
async function renderDashboard() {
  const d = state.dash;
  const p = d.papers || {};
  pageEl().innerHTML = `
    <div class="ec-card">${addressBlock(d.lanAddresses)}<p class="ec-hint" style="margin-top:8px;">Access from client / pupil computers on the same network. Pupils choose <b>Pupil</b> and sign in with their usual ID or email and password.</p></div>
    <div class="ec-stats">
      <div class="ec-stat green"><small>Active pupils</small><b>${d.activeStudents}</b><em>signed in, last 10 minutes</em></div>
      <div class="ec-stat"><small>Total pupils</small><b>${d.totalStudents}</b><em>on this computer</em></div>
      <div class="ec-stat blue"><small>Papers open</small><b>${p.live || 0} / ${p.total || 0}</b><em>${d.writing} writing now</em></div>
      <div class="ec-stat ${d.unpushed ? 'amber' : 'green'}"><small>Results to push</small><b>${d.unpushed}</b><em>${d.handedIn} handed in altogether</em></div>
    </div>
    <div class="ec-grid-2">
      <div class="ec-card"><h2>School portal</h2>
        ${d.connected ? `<p class="ec-muted">Connected with the school's API keys to <span class="ec-mono">${esc(d.portal)}</span>.</p>` : '<p class="ec-muted">Not connected. This computer was set up with an exam pack file.</p>'}
        <p class="ec-hint">Last refresh: ${d.synced ? `${when(d.synced.at)} (${esc(d.synced.scope)})` : 'never'} · Last push: ${d.lastPush ? when(d.lastPush.at) : 'never'}</p>
        <div class="ec-actions" style="margin-top:10px;">${d.connected ? `<button class="post-btn" onclick="go('push')">Push Results Online</button><button class="btn-outline" onclick="go('refresh')">Refresh Data</button>` : '<button class="post-btn" onclick="go(\'connection\')">Connect School Account</button>'}</div>
      </div>
      <div class="ec-card"><h2>Exam day</h2>
        <p class="ec-muted">Open each paper in the <b>Exam Console</b> when it's time to start, and close it when it ends. Closing hands in every paper still being written.</p>
        <div class="ec-actions" style="margin-top:10px;"><button class="post-btn" onclick="go('console')">Open Exam Console</button></div>
      </div>
    </div>`;
}

// ── Exam Console (papers) ──
async function renderConsole() {
  await refreshConsole();
  state.timer = setInterval(refreshConsole, 10000);
}
async function refreshConsole() {
  let overview;
  try { overview = await api('/api/exam/overview'); } catch (err) { if (err.status === 401 || err.status === 403) return start(); return; }
  state.overview = overview;
  const papers = overview.papers || [];
  const totals = papers.reduce((t, p) => ({ started: t.started + p.started, submitted: t.submitted + p.submitted }), { started: 0, submitted: 0 });
  if (state.page !== 'console') return;
  pageEl().innerHTML = `
    <div class="ec-stats">
      <div class="ec-stat blue"><small>Papers open</small><b>${papers.filter(p => p.status === 'live').length} / ${papers.length}</b></div>
      <div class="ec-stat green"><small>Handed in</small><b>${totals.submitted}</b></div>
      <div class="ec-stat amber"><small>Still writing</small><b>${totals.started - totals.submitted}</b></div>
    </div>
    <div class="ec-card">
      <div class="ec-flex"><h2>Papers</h2><span class="ec-hint">Updates every 10 seconds</span></div>
      <p class="ec-muted">Click <b>Open</b> when it's time to start a paper and <b>Close</b> when it ends. Closing hands in every paper still being written.</p>
      <div style="overflow-x:auto;"><table class="ec-table">
        <thead><tr><th>Class</th><th>Subject</th><th>When</th><th>Time</th><th>Questions</th><th>Pupils</th><th>Started</th><th>Handed in</th><th>Status</th><th></th></tr></thead>
        <tbody>${papers.map(p => `
          <tr class="${p.id === state.openPaperId ? 'ec-row-active' : ''}">
            <td>${esc(p.classLabel)}${p.armName ? ` ${esc(p.armName)}` : ''}</td>
            <td><b>${esc(p.subjectName)}</b><div class="ec-hint">${esc(p.scheduleTitle)}</div></td>
            <td>${esc([p.examDate, p.examTime].filter(Boolean).join(' '))}</td>
            <td>${p.durationMinutes} min</td>
            <td>${p.questions}${p.questions ? '' : ' <span class="ec-pill bad">none</span>'}</td>
            <td>${p.pupils}</td><td>${p.started}</td><td>${p.submitted}</td>
            <td><span class="ec-pill ${esc(p.status)}">${p.status === 'live' ? 'Open' : p.status === 'closed' ? 'Closed' : 'Not open'}</span></td>
            <td class="ec-actions">
              ${p.status !== 'live' ? `<button class="post-btn" onclick="setStatus(${p.id}, 'live')">${p.status === 'closed' ? 'Reopen' : 'Open'}</button>` : `<button class="btn-danger" onclick="setStatus(${p.id}, 'closed')">Close</button>`}
              <button class="btn-outline" onclick="showPupils(${p.id})">Pupils</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="10" class="ec-hint">No papers yet. Refresh CBT / Exams data, or load an exam pack.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div id="ec-pupils"></div>`;
  if (state.openPaperId) showPupils(state.openPaperId, true);
}
async function setStatus(id, status) {
  const paper = state.overview.papers.find(p => p.id === id);
  if (status === 'closed') {
    const writing = paper.started - paper.submitted;
    if (!await uiConfirm(`Close ${paper.subjectName} for ${paper.classLabel}?${writing ? ` ${plural(writing, 'pupil')} still writing will have their papers handed in now.` : ''}`, { confirmLabel: 'Close paper', danger: true })) return;
  }
  try {
    const data = await api(`/api/exam/papers/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    if (data.autoSubmitted) await uiNotice('Paper closed', `${plural(data.autoSubmitted, 'paper')} still being written were handed in and marked.`);
    refreshConsole();
  } catch (err) { uiNotice('Could not change the paper', err.message); }
}
async function showPupils(id, quiet) {
  state.openPaperId = id;
  const paper = state.overview.papers.find(p => p.id === id);
  const box = document.getElementById('ec-pupils');
  if (!paper || !box) return;
  try {
    const { pupils } = await api(`/api/exam/papers/${id}/pupils`);
    box.innerHTML = `<div class="ec-card">
      <div class="ec-flex"><h2>${esc(paper.classLabel)} — ${esc(paper.subjectName)}: pupils</h2><button class="btn-outline" onclick="state.openPaperId=null;document.getElementById('ec-pupils').innerHTML=''">Hide</button></div>
      <div style="overflow-x:auto;"><table class="ec-table">
        <thead><tr><th>#</th><th>Pupil</th><th>ID</th><th>Progress</th><th>Score</th><th></th></tr></thead>
        <tbody>${pupils.map((s, i) => `<tr>
          <td>${i + 1}</td><td>${esc(s.name)}</td><td class="ec-hint">${esc(s.id)}</td>
          <td>${s.submittedAt ? `<span class="ec-pill live">Handed in</span> <span class="ec-hint">${esc(when(s.submittedAt))}</span>` : s.startedAt ? `<span class="ec-pill upcoming">Writing</span> <span class="ec-hint">${s.answered}/${paper.questions} answered</span>` : '<span class="ec-hint">Not started</span>'}</td>
          <td>${s.submittedAt ? `${s.score} / ${s.totalMarks}` : ''}</td>
          <td>${s.startedAt ? `<button class="btn-outline" style="padding:5px 10px;font-size:11px;" onclick="allowRetake(${id}, '${esc(s.id)}', '${esc(s.name).replace(/'/g, '&#39;')}')">Allow retake</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="ec-hint">No pupils in this class.</td></tr>'}</tbody>
      </table></div></div>`;
    if (!quiet) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { box.innerHTML = `<div class="ec-card ec-error">${esc(err.message)}</div>`; }
}
async function allowRetake(id, studentId, name) {
  if (!await uiConfirm(`Clear ${name}'s attempt so they can start this paper again? Their answers and score for it will be removed.`, { confirmLabel: 'Allow retake', danger: true })) return;
  try { await api(`/api/exam/papers/${id}/reset`, { method: 'POST', body: JSON.stringify({ studentId }) }); refreshConsole(); } catch (err) { uiNotice('Could not reset', err.message); }
}

// ── CBT Schedules (read-only) ──
async function renderSchedules() {
  const { rows } = await api('/api/exam/schedules');
  const groups = new Map();
  rows.forEach(r => { if (!groups.has(r.id)) groups.set(r.id, { title: r.title, session: r.session, term: r.term, papers: [] }); groups.get(r.id).papers.push(r); });
  pageEl().innerHTML = [...groups.values()].map(g => `<div class="ec-card">
      <div class="ec-flex"><h2>${esc(g.title)}</h2><span class="ec-hint">${esc([g.session, g.term].filter(Boolean).join(' · '))}</span></div>
      <div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>Class</th><th>Subject</th><th>Date</th><th>Time</th><th>Duration</th><th>Questions</th><th>Status</th></tr></thead><tbody>
      ${g.papers.map(p => `<tr><td>${esc(p.classLabel)}${p.armName ? ` ${esc(p.armName)}` : ''}</td><td><b>${esc(p.subject)}</b></td><td>${esc(p.examDate || '—')}</td><td>${esc(p.examTime || '—')}</td><td>${p.durationMinutes} min</td><td>${p.questions}</td>
        <td><span class="ec-pill ${esc(p.status)}">${p.status === 'live' ? 'Open' : p.status === 'closed' ? 'Closed' : 'Not open'}</span></td></tr>`).join('')}
      </tbody></table></div></div>`).join('') || '<div class="ec-card ec-muted">No CBT schedules on this computer yet. Refresh CBT / Exams data.</div>';
}

// ── Push results ──
async function renderPush() {
  const s = state.sync;
  const last = s.lastPush;
  pageEl().innerHTML = `
    <div class="ec-stats"><div class="ec-stat ${s.unpushed ? 'amber' : 'green'}"><small>Waiting to push</small><b>${s.unpushed}</b><em>finished exams not yet on the portal</em></div></div>
    <div class="ec-card"><h2>Push Completed CBT Submissions Online</h2>
      <p class="ec-muted">Sends every finished exam on this computer to the online portal, where scores appear in <b>CBT Scores</b> and the <b>CBT Grade Book</b>. Pushing twice is safe: nothing is counted twice.</p>
      ${s.connected ? `<button class="post-btn" id="ec-push" onclick="doPush()" ${s.unpushed ? '' : 'disabled'}>Push ${s.unpushed ? plural(s.unpushed, 'Result') : 'Results'} Online</button>` : '<div class="ec-note warn">Not connected to the school portal. Connect in <b>Connection & Files</b>, or export a results file there instead.</div>'}
      <div id="ec-push-out"></div></div>
    ${last ? `<div class="ec-card"><h2>Last push</h2>${pushSummary(last)}</div>` : ''}`;
}
function pushSummary(r) {
  return `<p class="ec-hint">${when(r.at)}</p>
    <div class="ec-stats"><div class="ec-stat green"><small>Recorded online</small><b>${r.imported}</b></div><div class="ec-stat"><small>Already online</small><b>${r.alreadyUploaded}</b></div><div class="ec-stat ${r.left ? 'amber' : 'green'}"><small>Still to push</small><b>${r.left}</b></div></div>
    ${r.error ? `<div class="ec-note warn">${esc(r.error)}</div>` : ''}
    ${[...(r.conflicts || []), ...(r.skipped || []), ...(r.scoreChanged || [])].map(x => `<div class="ec-note">${esc(x)}</div>`).join('')}`;
}
async function doPush() {
  const btn = document.getElementById('ec-push');
  btn.disabled = true; btn.textContent = 'Pushing…';
  document.getElementById('ec-push-out').innerHTML = '<p class="ec-hint" style="margin-top:12px;">Uploading data to the online school portal… Please be patient.</p><div class="ea-progress"><i></i></div>';
  try {
    const { result } = await api('/api/exam/push', { method: 'POST' });
    await uiNotice(result.left ? 'Some results were not pushed' : 'Results pushed', result.left ? `${result.imported} recorded online. ${result.left} still waiting${result.error ? `: ${result.error}` : ''}. Try again when the internet is working.` : `${plural(result.imported, 'result')} recorded on the portal${result.alreadyUploaded ? `, ${result.alreadyUploaded} already there` : ''}.`);
  } catch (err) { await uiNotice('Could not push', err.message); }
  go('push');
}

// ── Archive ──
async function renderArchive(from, to) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const data = await api(`/api/exam/archive?${q}`);
  pageEl().innerHTML = `<div class="ec-card">
    <div class="ec-filters"><div><label class="ec-label" for="ec-from">Taken between</label><input class="ec-input" type="date" id="ec-from" value="${esc(data.from)}"></div>
      <div><label class="ec-label" for="ec-to">and</label><input class="ec-input" type="date" id="ec-to" value="${esc(data.to)}"></div>
      <button class="post-btn" onclick="renderArchive(document.getElementById('ec-from').value, document.getElementById('ec-to').value)">View Archive</button></div>
    <div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>#</th><th>Pupil</th><th>Class</th><th>Subject</th><th>Handed in</th><th>Score</th><th>Portal</th></tr></thead><tbody>
    ${data.rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.studentName || r.studentId)}</b><div class="ec-hint">${esc(r.studentId)}</div></td><td>${esc(r.classLabel || '')}</td><td>${esc(r.subject || '')}<div class="ec-hint">${esc(r.schedule || '')}</div></td>
      <td>${when(r.submittedAt)}</td><td>${r.score == null ? '—' : `${r.score} / ${r.totalMarks}`}</td>
      <td>${r.pushedAt ? `<span class="ec-pill ok">Pushed</span> <span class="ec-hint">${when(r.pushedAt)}</span>${r.pushNote && r.pushNote !== 'imported' && r.pushNote !== 'already' ? ` <span class="ec-pill warn">${esc(r.pushNote)}</span>` : ''}` : '<span class="ec-pill warn">Not pushed</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="ec-hint">No exams were handed in on this computer between these dates.</td></tr>'}
    </tbody></table></div></div>`;
}

// ── Refresh data ──
const GROUPS = [['students', 'Refresh Students', 'Pupils, their classes and sign-in details'], ['staff', 'Refresh Staff', 'Admins (who sign in here) and the staff list'],
  ['cbt', 'Refresh CBT / Exams', 'Schedules, papers, questions, terms and subjects'], ['images', 'Refresh Images', 'Pupil and staff photos'], ['all', 'Refresh All', 'All of the above — use this before an exam']];
async function renderRefresh() {
  const s = state.sync;
  pageEl().innerHTML = `<div class="ec-card"><h2>Refresh data from the online school portal</h2>
    <p class="ec-muted">Each refresh copies records from the portal and overwrites the matching data on this computer. Results written here are never removed by a refresh.</p>
    ${s.connected ? `<div class="ec-refresh-grid">${GROUPS.map(([k, l, d]) => `<button type="button" class="ec-refresh ${k === 'all' ? 'all' : ''}" onclick="askRefresh('${k}')"><b>${l}</b><small>${d}</small></button>`).join('')}</div>`
      : '<div class="ec-note warn">Not connected to the school portal. Connect in <b>Connection & Files</b>.</div>'}
    <p class="ec-hint" style="margin-top:12px;">Last refresh: ${s.synced ? `${when(s.synced.at)} (${esc(s.synced.scope)})` : 'never'}</p></div>`;
}
function askRefresh(group) {
  const [, label] = GROUPS.find(g => g[0] === group);
  modal(label, `<p class="ec-muted">This fetches ${group === 'all' ? 'all necessary data' : label.replace('Refresh ', '').toLowerCase() + ' records'} from your online school portal into this exam server, overwriting the corresponding data currently here.</p>
    <label class="ec-check"><input type="checkbox" id="ec-rconfirm"> I confirm that I want to proceed with this action</label>
    <div id="ec-rprogress"></div><div class="ec-error" id="ec-rerr"></div>`,
  `<button class="btn-outline" onclick="closeModal()">Close</button><button class="post-btn" id="ec-rgo" onclick="doRefresh('${group}')">Refresh Data</button>`);
}
async function doRefresh(group) {
  if (!document.getElementById('ec-rconfirm').checked) { document.getElementById('ec-rerr').textContent = 'Tick the box to confirm.'; return; }
  document.getElementById('ec-rgo').disabled = true;
  document.getElementById('ec-rprogress').innerHTML = '<p class="ec-hint" style="margin-top:12px;">Connecting to the online school portal to fetch data… Please be patient.</p><div class="ea-progress"><i></i></div>';
  try {
    await api('/api/exam/refresh', { method: 'POST', body: JSON.stringify({ confirm: true, group }) });
    closeModal();
    go('report');
  } catch (err) {
    document.getElementById('ec-rprogress').innerHTML = '';
    document.getElementById('ec-rerr').textContent = err.message;
    document.getElementById('ec-rgo').disabled = false;
  }
}
function reportTable(r) {
  return `<div class="ec-stats"><div class="ec-stat"><small>Datasets synced</small><b>${r.datasets.length}</b></div><div class="ec-stat green"><small>Successful</small><b>${r.ok}</b></div><div class="ec-stat ${r.failed ? 'red' : ''}"><small>Failed</small><b>${r.failed}</b></div></div>
    <p class="ec-hint">Completed at ${when(r.completedAt)} · Scope: ${esc(r.scope)}${r.by ? ` · by ${esc(r.by)}` : ''}</p>
    <div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>#</th><th>Dataset</th><th>Records</th><th>Status</th></tr></thead><tbody>
    ${r.datasets.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.label)}</td><td>${d.rows}</td><td>${d.status === 'ok' ? '<span class="ec-pill ok">OK</span>' : `<span class="ec-pill warn">${esc(d.note || d.status)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>`;
}
async function renderReport() {
  const { report } = await api('/api/exam/sync-report');
  pageEl().innerHTML = report ? `<div class="ec-card"><div class="ec-flex"><h2>Data Refresh Report</h2><button class="btn-outline" onclick="window.print()">Print Report</button></div>${reportTable(report)}
    <div class="ec-actions" style="margin-top:12px;"><button class="post-btn" onclick="go('dashboard')">Go to Dashboard</button></div></div>`
    : '<div class="ec-card ec-muted">No refresh has run on this computer yet.</div>';
}

// ── Connection & files ──
async function renderConnection() {
  const s = state.sync;
  pageEl().innerHTML = `
    <div class="ec-card"><h2>School portal connection</h2>
      ${s.connected ? `<p class="ec-muted">Connected with the school's API keys. This computer shows on the portal as <b>${esc(s.machine || 'this computer')}</b>.</p>
        <table class="ec-table" style="max-width:640px;"><tbody><tr><td class="ec-hint">Portal</td><td class="ec-mono">${esc(s.portal)}</td></tr><tr><td class="ec-hint">API Number</td><td class="ec-mono">${esc(s.apiNumber)}</td></tr></tbody></table>
        <div class="ec-actions" style="margin-top:12px;"><button class="btn-outline" onclick="openReconnect()">Change Keys</button><button class="btn-danger" onclick="disconnect()">Disconnect</button></div>`
      : `<p class="ec-muted">Not connected. Connect to sync data and push results over the internet.</p><button class="post-btn" onclick="openReconnect()">Connect School Account</button>`}
    </div>
    <div class="ec-card"><h2>Backup: exam files</h2>
      <p class="ec-muted">For days without internet at sync time: load an exam pack file made on the portal, and export a results file to upload on the portal (both need the pack's passphrase).</p>
      <div class="ec-actions"><button class="btn-outline" onclick="renderLoadPack(false)">Load Exam Pack File</button><button class="btn-outline" onclick="exportResults()" ${state.dash?.pack ? '' : 'disabled title="Only for computers set up with an exam pack file"'}>Export Results File</button></div>
    </div>`;
}
function openReconnect() {
  modal('Connect School Account', `
    <div class="ec-field" style="margin-top:0;"><label for="ec-api">API Number <span class="ec-req">*</span></label><input class="ec-input" id="ec-api" autocomplete="off"></div>
    <div class="ec-field"><label for="ec-auth">API Authentication Key <span class="ec-req">*</span></label><input class="ec-input" id="ec-auth" autocomplete="off"></div>
    <div class="ec-field"><label for="ec-secret">API Secret Key <span class="ec-req">*</span></label><input class="ec-input" id="ec-secret" type="password" autocomplete="off"></div>
    <div class="ec-field"><label for="ec-portal">Online portal address</label><input class="ec-input" id="ec-portal" value="${esc(state.sync.portal || state.sync.defaultPortal || '')}"></div>
    <div class="ec-error" id="ec-err"></div>`,
  '<button class="btn-outline" onclick="closeModal()">Cancel</button><button class="post-btn" id="ec-connect" onclick="connectPortal()">Connect</button>');
}
async function disconnect() {
  if (!await uiConfirm('Disconnect this exam server from the school portal? Exams and results here stay; you can connect again with keys later.', { confirmLabel: 'Disconnect', danger: true })) return;
  try { await api('/api/exam/disconnect', { method: 'POST' }); go('connection'); } catch (err) { uiNotice('Could not disconnect', err.message); }
}
async function exportResults() {
  try {
    const res = await fetch('/api/exam/results-file', { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'cbt-results.ucsres';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    await uiNotice('Results exported', `Saved as ${name}. Upload it on the portal: E-Class › CBT › Offline CBT (LAN) › Upload Results, with the same passphrase.`);
  } catch (err) { uiNotice('Could not export', err.message); }
}

// ── People (read-only) ──
async function renderStudents(classCode = '', armId = '') {
  const q = new URLSearchParams({ classCode, armId });
  const data = await api(`/api/exam/people/students?${q}`);
  const arms = data.arms.filter(a => a.classCode === classCode);
  pageEl().innerHTML = `<div class="ec-card">
    <div class="ec-filters"><div><label class="ec-label" for="ec-cls">Class</label><select class="ec-select" id="ec-cls" onchange="renderStudents(this.value, '')"><option value="">All classes</option>${data.classes.map(c => `<option value="${esc(c.code)}" ${c.code === classCode ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div><label class="ec-label" for="ec-arm">Class arm</label><select class="ec-select" id="ec-arm" onchange="renderStudents('${esc(classCode)}', this.value)" ${arms.length ? '' : 'disabled'}><option value="">All arms</option>${arms.map(a => `<option value="${a.id}" ${String(a.id) === String(armId) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <span class="ec-hint">${plural(data.students.length, 'pupil')}</span></div>
    <div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>#</th><th>Photo</th><th>Name</th><th>Reg. No.</th><th>Class</th><th>Gender</th></tr></thead><tbody>
    ${data.students.map((s, i) => `<tr><td>${i + 1}</td><td>${s.photo ? `<img class="ec-photo" src="/${esc(s.photo)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="ea-avatar">${esc(initials(s.name))}</span>`}</td><td><b>${esc(s.name)}</b></td><td class="ec-mono">${esc(s.regNo || s.id)}</td><td>${esc(s.classLabel || '')}${s.armName ? ` ${esc(s.armName)}` : ''}</td><td>${esc(s.gender || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="ec-hint">No pupils. Refresh Students data.</td></tr>'}
    </tbody></table></div></div>`;
}
async function renderStaff() {
  const { staff } = await api('/api/exam/people/staff');
  const role = s => (s.role === 'admin' ? 'Administrator' : s.role === 'teacher' ? 'Teacher' : 'Staff');
  pageEl().innerHTML = `<div class="ec-card"><span class="ec-hint">${plural(staff.length, 'staff member')} · only administrators can sign in to this exam server</span>
    <div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>#</th><th>Photo</th><th>Name</th><th>Role</th><th>Designation</th><th>Phone</th><th>Email</th></tr></thead><tbody>
    ${staff.map((s, i) => `<tr><td>${i + 1}</td><td>${s.photo ? `<img class="ec-photo" src="/${esc(s.photo)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="ea-avatar">${esc(initials(s.name))}</span>`}</td><td><b>${esc(s.name)}</b><div class="ec-hint">${esc(s.id)}</div></td>
      <td><span class="ec-pill ${s.role === 'admin' ? 'ok' : 'muted'}">${role(s)}</span></td><td>${esc(s.designation || '')}</td><td>${esc(s.phone || '')}</td><td>${esc(s.email || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="ec-hint">No staff. Refresh Staff data.</td></tr>'}
    </tbody></table></div></div>`;
}

// ── Updates ──
async function renderUpdates() {
  const app = state.dash?.app || {};
  pageEl().innerHTML = `<div class="ec-card"><h2>Software version</h2>
    <p class="ec-muted">Current version: <b class="ec-mono">${esc(app.version || 'not running as the app')}</b>${app.build ? ` <span class="ec-hint ec-mono">(${esc(app.build)})</span>` : ''}</p>
    ${state.sync.connected ? '<button class="post-btn" id="ec-check" onclick="checkUpdates()">Check for Updates</button>' : '<div class="ec-note warn">Connect to the school portal to check for updates.</div>'}
    <div id="ec-update-out"></div></div>`;
}
async function checkUpdates() {
  const out = document.getElementById('ec-update-out');
  out.innerHTML = '<div class="ea-progress"><i></i></div>';
  try {
    const r = await api('/api/exam/update-check');
    if (!r.insideApp) { out.innerHTML = '<div class="ec-note">This exam server isn\'t running as the UCS Exam Server app, so it can\'t update itself. Download the app from the portal\'s Offline CBT (LAN) page.</div>'; return; }
    out.innerHTML = !r.latest || !r.setupSize
      ? '<div class="ec-note warn">The school portal has no exam server app to offer yet, so there is nothing to compare with.</div>'
      : r.available
        ? `<div class="ec-note">A new version is available (${esc(r.latest.build)}, built ${when(r.latest.builtAt)}, ${Math.round(r.setupSize / 1e6)} MB).</div><button class="post-btn" onclick="installUpdate()">Download and Install</button>`
        : `<div class="ec-note">You have the latest version (${esc(r.latest.build)}).</div>`;
  } catch (err) { out.innerHTML = `<div class="ec-note warn">${esc(err.message)}</div>`; }
}
async function installUpdate() {
  const writing = state.dash?.writing || 0;
  if (!await uiConfirm(`Install the update now? The exam server closes while the new version installs${writing ? `, and ${plural(writing, 'pupil')} still writing will be disconnected` : ''}. Push results first if you can.`, { confirmLabel: 'Install', danger: !!writing })) return;
  document.getElementById('ec-update-out').innerHTML = '<p class="ec-hint">Downloading the update… The installer opens by itself, then the exam server closes.</p><div class="ea-progress"><i></i></div>';
  try { await api('/api/exam/update-install', { method: 'POST' }); } catch (err) { document.getElementById('ec-update-out').innerHTML = `<div class="ec-note warn">${esc(err.message)}</div>`; }
}

async function signOut() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/signin';
}

start();
