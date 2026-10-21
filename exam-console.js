// UCS Exam Server — the app's screens (runs on the exam computer, EXAM_MODE).
// Setup: Connect School Account → first Refresh → Sign in. Then a portal-style
// shell: Dashboard, Exam Console, CBT Schedules, Push Results, Archive, Refresh
// Data, Sync Report, Connection & Files, Students Info-system, Teachers / General
// Staff, Administrator, Check for Updates.
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
    setupScreen('Data fetched', `${reportTable(report)}<p class="ec-muted" style="margin-top:14px;">Now sign in as an administrator.</p>
      <button class="post-btn" style="margin-top:6px;" onclick="renderSignIn()">Sign In</button>`);
  } catch (e) {
    document.getElementById('ec-progress').innerHTML = '';
    document.getElementById('ec-err').textContent = e.message;
    btn.disabled = false;
  }
}
// Only administrators sign in to the app (pupils sign in on their own devices)
function renderSignIn(note = '') {
  setupScreen('Administrator sign in', `
    ${note ? `<div class="ec-note">${note}</div>` : ''}
    <p class="ec-muted">Sign in with your usual <b>admin ID or email</b> and password.</p>
    <form onsubmit="adminSignIn(); return false;" autocomplete="on">
      <div class="ec-field"><label for="ec-sid">Admin ID or email</label><input class="ec-input" id="ec-sid" autocomplete="username"></div>
      <div class="ec-field"><label for="ec-pw">Password</label><input class="ec-input" id="ec-pw" type="password" autocomplete="current-password"></div>
      <div style="margin-top:16px;"><button class="post-btn" type="submit" id="ec-signin">Sign In</button></div>
    </form>
    <div class="ec-error" id="ec-err"></div>
    ${state.status?.lanAddresses ? addressBlock(state.status.lanNetworks || state.status.lanAddresses) : ''}`);
  setTimeout(() => document.getElementById('ec-sid')?.focus(), 50);
}
async function adminSignIn() {
  const id = document.getElementById('ec-sid').value.trim();
  const password = document.getElementById('ec-pw').value;
  const err = document.getElementById('ec-err');
  err.textContent = '';
  if (!id || !password) { err.textContent = 'Enter your admin ID or email and your password.'; return; }
  const btn = document.getElementById('ec-signin');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password, role: 'admin' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'Incorrect ID, email or password.' : (data.error || 'Sign-in failed.'));
    if (data.user && data.user.role !== 'admin') {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      throw new Error('Only administrators can sign in to the exam server app. Pupils sign in on their own devices.');
    }
    if (data.step) throw new Error('This account needs an extra sign-in step that the exam server can\'t do. Ask a super admin.');
    start();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Sign In';
  }
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
  ['Computer-Based Tests', [['console', 'Exam Console'], ['schedules', 'Computer Based Test / Exam Schedules'], ['push', 'Push Results Online'], ['archive', 'Submissions Archive']], { dropdown: 'cbt' }],
  ['Data Management & Sync', [['refresh', 'Refresh Data'], ['report', 'Sync Report'], ['connection', 'Connection & Files']], { dropdown: 'sync' }],
  ['Students', [['students', 'Students Info-system']], { dropdown: 'students', search: true }],
  ['Staff / Employees', [['teachers', 'Teachers / General Staff'], ['admins', 'Administrator']], { dropdown: 'staff' }],
  [null, [['updates', 'Check for Updates']]],
];
const TITLES = {
  dashboard: ['Dashboard', 'This exam computer at a glance'], console: ['Exam Console', 'Open and close papers, watch pupils, allow retakes'],
  schedules: ['Exam Schedules', 'View Exam Schedule — papers copied from the online portal'], push: ['Push Results Online', 'Send finished exams to the online portal'],
  archive: ['Submissions Archive', 'Every exam written on this computer'], refresh: ['Refresh Data', 'Copy the latest data from the online portal'],
  report: ['Sync Report', 'What the last refresh copied'], connection: ['Connection & Files', 'The school portal link, and the file backup'],
  students: ['Students Info-system', 'Pupils copied from the online portal'], teachers: ['Teachers / General Staff', 'Staff copied from the online portal'],
  admins: ['Administrator', 'Admins who can sign in to this exam server'],
  updates: ['Check for Updates', 'Keep the exam server up to date'],
};
// Menu groups marked as drop-downs open and close on click; the one holding
// the current page starts open
state.navOpen = new Set();
function navItem([k, l]) {
  return `<button type="button" data-page="${k}" class="${state.page === k ? 'active' : ''}" onclick="go('${k}')">${l}${k === 'push' && state.sync?.unpushed ? `<span class="ea-badge">${state.sync.unpushed}</span>` : ''}</button>`;
}
function navGroup([group, items, opt = {}]) {
  if (!opt.dropdown) return `${group ? `<h4>${group}</h4>` : ''}${items.map(navItem).join('')}`;
  const open = state.navOpen.has(opt.dropdown);
  const here = items.some(([k]) => k === state.page);
  return `<div class="ea-drop ${open ? 'open' : ''}" id="nav-${opt.dropdown}">
    <button type="button" class="ea-drop-head ${here ? 'here' : ''}" aria-expanded="${open}" onclick="toggleNav('${opt.dropdown}')">${group}${items.some(([k]) => k === 'push') && state.sync?.unpushed ? `<span class="ea-badge ea-head-badge" title="Results waiting to be pushed online">${state.sync.unpushed}</span>` : ''}<span class="ea-caret" aria-hidden="true"></span></button>
    <div class="ea-drop-body">${items.map(navItem).join('')}${opt.search ? studentSearchBox() : ''}</div></div>`;
}
function toggleNav(key) {
  const el = document.getElementById(`nav-${key}`);
  const open = !state.navOpen.has(key);
  if (open) state.navOpen.add(key); else state.navOpen.delete(key);
  el.classList.toggle('open', open);
  el.querySelector('.ea-drop-head').setAttribute('aria-expanded', open);
}
function shell() {
  const t = state.dash?.term;
  // the menu is redrawn on every page: keep it where the user had scrolled it
  const oldNav = document.querySelector('.ea-nav');
  const navScroll = oldNav?.scrollTop || 0;
  for (const [, items, opt] of MENU) if (opt?.dropdown && items.some(([k]) => k === state.page)) state.navOpen.add(opt.dropdown);
  const nets = state.dash?.lanNetworks || state.status?.lanNetworks || (state.dash?.lanAddresses || state.status?.lanAddresses || []).map(url => ({ url }));
  rootEl.innerHTML = `<div class="ea-shell" id="ea-shell">
    <aside class="ea-side">
      <div class="ea-brand"><img src="/report_assets/exam-app-icon.png" alt=""><div><b>${esc(state.sync?.school || "Unique Children's School")}</b><small>UCS Exam Server</small></div></div>
      <div class="ea-user"><span class="ea-avatar">${esc(initials(state.user.name))}</span><div><b>${esc(state.user.name)}</b><small>Administration</small></div></div>
      <nav class="ea-nav">${MENU.map(navGroup).join('')}</nav>
      <div class="ea-side-foot"><button type="button" class="btn-outline" onclick="signOut()">Sign Out</button><div class="ea-version">${state.dash?.app?.version ? `v${esc(state.dash.app.version)} · ${esc(state.dash.app.build)}` : 'UCS Exam Server'}</div></div>
    </aside>
    <div class="ea-main">
      <header class="ea-top">
        <button class="ea-menu-btn" aria-label="Menu" onclick="document.getElementById('ea-shell').classList.toggle('menu-open')">☰</button>
        <div><h1>${TITLES[state.page][0]}</h1><div class="sub">${TITLES[state.page][1]}</div></div>
        <div class="right">${nets.map(n => `<span class="ea-addr-chip" title="Pupils on ${esc(n.label || 'the network')} open this address">${n.label && nets.length > 1 ? `${esc(n.label)} · ` : ''}${esc(n.url.replace(/^https?:\/\//, ''))}</span>`).join('')}
          <button type="button" class="ea-reload" title="Refresh the app" aria-label="Refresh the app" onclick="reloadApp(this)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg></button>
          <div class="ea-term">Academic Session <b>${esc(t?.session || '—')}</b><br>Active Term <b class="blue">${esc(t?.term || '—')}</b></div></div>
      </header>
      <main class="ea-wrap" id="ea-page"><div class="ec-muted">Loading…</div></main>
    </div></div>`;
  const nav = document.querySelector('.ea-nav');
  nav.scrollTop = navScroll;
  // first draw: bring the current page's menu item into the middle of the menu
  const active = !oldNav && nav.querySelector('button.active');
  if (active) nav.scrollTop += active.getBoundingClientRect().top - nav.getBoundingClientRect().top - nav.clientHeight / 2;
}
// Reloads the whole app (like pull-to-refresh), e.g. after the internet comes
// back; the sign-in and the current page are kept
function reloadApp(btn) {
  btn.classList.add('spin');
  btn.disabled = true;
  location.reload();
}
async function go(page) {
  if (page === 'staff') page = 'teachers';
  if (!TITLES[page]) page = 'dashboard';
  clearInterval(state.timer);
  state.page = page;
  history.replaceState(null, '', `#${page}`);
  try {
    [state.dash, state.sync] = await Promise.all([api('/api/exam/dashboard'), api('/api/exam/sync-status')]);
  } catch (err) { if (err.status === 401 || err.status === 403) return start(); }
  shell();
  const render = { dashboard: renderDashboard, console: renderConsole, schedules: renderSchedules, push: renderPush, archive: renderArchive, refresh: renderRefresh, report: renderReport, connection: renderConnection, students: renderStudents, teachers: renderTeachers, admins: renderAdmins, updates: renderUpdates }[page];
  await render();
}
const pageEl = () => document.getElementById('ea-page');
function showToastish(text) { if (typeof uiNotice === 'function') uiNotice(text, ''); }
// one address per network this computer is on: pupils open the one for the network they're on
function addressBlock(networks) {
  const list = (networks || []).map(n => (typeof n === 'string' ? { url: n } : n));
  return `<div class="ec-field"><label>Pupils open this address (Wi-Fi or LAN cable, whichever they're connected to)</label>
    <div class="ec-address">${list.map(n => `<code>${n.label ? `<span class="ec-hint">${esc(n.label)}:</span> ` : ''}${esc(n.url)}</code>`).join('') || '<span class="ec-error">This computer is not connected to a network yet. Connect it to the school Wi-Fi or plug in the LAN cable.</span>'}</div>
    ${list.some(n => n.selfAssigned) ? '<p class="ec-hint" style="margin-top:6px;">A 169.254… address means the cable network has no router handing out addresses. It still works if the pupils\' computers are on the same switch, but a fixed address (e.g. 192.168.10.1) is easier to type.</p>' : ''}</div>`;
}

// ── Dashboard ──
async function renderDashboard() {
  const d = state.dash;
  const p = d.papers || {};
  pageEl().innerHTML = `
    <div class="ec-card">${addressBlock(d.lanNetworks || d.lanAddresses)}<p class="ec-hint" style="margin-top:8px;">Access from client / pupil computers on the same network. Pupils choose <b>Pupil</b> and sign in with their usual ID or email and password.</p></div>
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
// Pick a session, exam, class and arm, then View lists that exam's papers by mode
async function renderSchedules() {
  const [{ rows }, meta] = await Promise.all([api('/api/exam/schedules'), api('/api/exam/people/students?classCode=__none__')]);
  const exams = new Map();
  rows.forEach(r => { if (!exams.has(r.id)) exams.set(r.id, { id: r.id, title: r.title, session: r.session, papers: [] }); exams.get(r.id).papers.push(r); });
  state.sched = { exams: [...exams.values()], classes: meta.classes, arms: meta.arms };
  if (!state.sched.exams.length) { pageEl().innerHTML = '<div class="ec-card ec-muted">No CBT schedules on this computer yet. Refresh CBT / Exams data.</div>'; return; }
  const sessions = [...new Set(state.sched.exams.map(e => e.session))];
  const pick = state.schedPick || { session: sessions[0], examId: '', classCode: '', armId: '', mode: 'Computer Based' };
  pageEl().innerHTML = `<div class="ec-card"><h2>Select Exam Schedule to View</h2>
    <div class="ec-filters" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div><label class="ec-label" for="sc-ses">Session</label><select class="ec-select" id="sc-ses" onchange="schedExams()">${sessions.map(s => `<option ${s === pick.session ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div><label class="ec-label" for="sc-exam">For Exam</label><select class="ec-select" id="sc-exam"></select></div>
      <div><label class="ec-label" for="sc-cls">Class</label><select class="ec-select" id="sc-cls" onchange="schedArms()"><option value="">All</option>${state.sched.classes.map(c => `<option value="${esc(c.code)}" ${c.code === pick.classCode ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div><label class="ec-label" for="sc-arm">Class Arm</label><select class="ec-select" id="sc-arm"></select></div>
    </div>
    <div style="text-align:center;margin-top:16px;"><button class="post-btn" type="button" onclick="viewSchedule()">View</button></div></div>
    <div id="sc-out"></div>`;
  schedExams(pick.examId);
  schedArms(pick.armId);
  viewSchedule(pick.mode);
}
function schedExams(examId = '') {
  const session = document.getElementById('sc-ses').value;
  document.getElementById('sc-exam').innerHTML = state.sched.exams.filter(e => e.session === session)
    .map(e => `<option value="${e.id}" ${String(e.id) === String(examId) ? 'selected' : ''}>${esc(e.title)}</option>`).join('');
}
function schedArms(armId = '') {
  const code = document.getElementById('sc-cls').value;
  const sel = document.getElementById('sc-arm');
  sel.disabled = !code;
  sel.innerHTML = !code ? '<option value=""></option>'
    : `<option value="">All arms</option>${state.sched.arms.filter(a => a.classCode === code).map(a => `<option value="${a.id}" ${String(a.id) === String(armId) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
}
function viewSchedule(mode) {
  const pick = {
    session: document.getElementById('sc-ses').value, examId: document.getElementById('sc-exam').value,
    classCode: document.getElementById('sc-cls').value, armId: document.getElementById('sc-arm').value,
    mode: mode || document.getElementById('sc-mode')?.value || state.schedPick?.mode || 'Computer Based',
  };
  state.schedPick = pick;
  const exam = state.sched.exams.find(e => String(e.id) === pick.examId);
  const papers = (exam?.papers || []).filter(p => (!pick.classCode || p.classCode === pick.classCode)
    && (!pick.armId || !p.armId || String(p.armId) === pick.armId) && (p.mode || 'Computer Based') === pick.mode);
  document.getElementById('sc-out').innerHTML = `<div class="ec-card">
    <h2>${esc(pick.session.toUpperCase())} TESTS &amp; EXAM SCHEDULES${exam ? ` &nbsp;|&nbsp; ${esc(exam.title.toUpperCase())}` : ''}</h2>
    <div style="text-align:center;margin:14px 0;"><select class="ec-select" id="sc-mode" style="max-width:340px;" onchange="viewSchedule(this.value)">
      ${['Computer Based', 'Paper Based', 'Others'].map(m => `<option ${m === pick.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    ${papers.length ? `<div style="overflow-x:auto;"><table class="ec-table"><thead><tr><th>Class</th><th>Subject</th><th>Date</th><th>Time</th><th>Duration</th><th>Questions</th><th>Status</th></tr></thead><tbody>
      ${papers.map(p => `<tr><td>${esc(p.classLabel)}${p.armName ? ` ${esc(p.armName)}` : ''}</td><td><b>${esc(p.subject)}</b></td><td>${esc(p.examDate || '—')}</td><td>${esc(p.examTime || '—')}</td><td>${p.durationMinutes} min</td><td>${p.questions}</td>
        <td><span class="ec-pill ${esc(p.status)}">${p.status === 'live' ? 'Open' : p.status === 'closed' ? 'Closed' : 'Not open'}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ec-muted" style="text-align:center;padding:14px;">No papers for this selection.</div>'}</div>`;
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
const photoCell = p => (p.photo
  ? `<img class="ec-photo" src="/${esc(p.photo)}" alt="" onerror="this.outerHTML='<span class=&quot;ea-avatar&quot;>${esc(initials(p.name))}</span>'">`
  : `<span class="ea-avatar">${esc(initials(p.name))}</span>`);

// A list with "records per page", a search box and page buttons
state.tables = {};
function dataTable(id, { rows, head, row, match, empty }) {
  state.tables[id] = { rows, head, row, match, empty, page: 1, per: 10, q: '' };
  return `<div id="dt-${id}"></div>`;
}
function dtSet(id, changes) {
  Object.assign(state.tables[id], changes);
  dtDraw(id);
}
function dtSearch(id, input) {
  dtSet(id, { q: input.value, page: 1 });
  const el = document.querySelector(`#dt-${id} .ec-dt-search`);
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}
function dtDraw(id) {
  const t = state.tables[id];
  const box = document.getElementById(`dt-${id}`);
  if (!t || !box) return;
  const q = t.q.trim().toLowerCase();
  const list = q ? t.rows.filter(r => t.match(r).toLowerCase().includes(q)) : t.rows;
  const pages = Math.max(1, Math.ceil(list.length / t.per));
  t.page = Math.min(t.page, pages);
  const from = (t.page - 1) * t.per;
  const shown = list.slice(from, from + t.per);
  const nums = [];
  for (let n = Math.max(1, t.page - 2); n <= Math.min(pages, t.page + 2); n++) nums.push(n);
  box.innerHTML = `<div class="ec-dt-bar">
      <label class="ec-dt-per"><select class="ec-select" onchange="dtSet('${id}', { per: Number(this.value), page: 1 })">${[10, 25, 50, 100].map(n => `<option ${n === t.per ? 'selected' : ''}>${n}</option>`).join('')}</select> records per page</label>
      <input class="ec-input ec-dt-search" type="search" placeholder="Search" aria-label="Search" value="${esc(t.q)}" oninput="dtSearch('${id}', this)"></div>
    <div style="overflow-x:auto;"><table class="ec-table"><thead><tr>${t.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${shown.map((r, i) => t.row(r, from + i)).join('') || `<tr><td colspan="${t.head.length}" class="ec-hint">${q ? 'Nothing matches your search.' : t.empty}</td></tr>`}</tbody></table></div>
    <div class="ec-dt-foot"><span class="ec-hint">${list.length ? `Showing ${from + 1} to ${from + shown.length} of ${list.length} entries` : 'No entries'}</span>
      <div class="ec-pager"><button type="button" ${t.page <= 1 ? 'disabled' : ''} onclick="dtSet('${id}', { page: ${t.page - 1} })" aria-label="Previous page">‹</button>${nums.map(n => `<button type="button" class="${n === t.page ? 'on' : ''}" onclick="dtSet('${id}', { page: ${n} })">${n}</button>`).join('')}<button type="button" ${t.page >= pages ? 'disabled' : ''} onclick="dtSet('${id}', { page: ${t.page + 1} })" aria-label="Next page">›</button></div></div>`;
}

// Students Info-system: choose a class and arm, then View (or search from the menu)
function studentSearchBox() {
  return `<form class="ea-side-search" onsubmit="searchStudents(this.q.value); return false;"><input name="q" type="search" placeholder="Search student" value="${esc(state.studentSearch || '')}" aria-label="Search student"><button type="submit" aria-label="Search">&#9906;</button></form>`;
}
function searchStudents(q) {
  state.studentSearch = String(q || '').trim();
  go('students');
}
async function renderStudents() {
  const data = await api('/api/exam/people/students?classCode=__none__');
  state.peopleMeta = data;
  const pick = state.studentPick || {};
  const active = data.sessions.find(x => x.active)?.label || data.sessions[0]?.label || '';
  pageEl().innerHTML = `<div class="ec-card"><h2>Select Class</h2>
    <div class="ec-filters" style="margin-top:10px;">
      <div><label class="ec-label" for="ec-cls">Class <span class="ec-req">*</span></label><select class="ec-select" id="ec-cls" onchange="studentArms()"><option value="">Select Class</option>${data.classes.map(c => `<option value="${esc(c.code)}" ${c.code === pick.classCode ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div><label class="ec-label" for="ec-arm">Class Division / Arm <span class="ec-req">*</span></label><select class="ec-select" id="ec-arm"></select></div>
      <div><label class="ec-label" for="ec-ses">Academic Session <span class="ec-req">*</span></label><select class="ec-select" id="ec-ses">${data.sessions.map(x => `<option ${x.label === (pick.session || active) ? 'selected' : ''}>${esc(x.label)}</option>`).join('') || '<option value="">—</option>'}</select></div>
      <div><button class="post-btn" type="button" onclick="viewStudents()">View</button></div>
    </div><div class="ec-error" id="ec-err"></div></div>
    <div id="ec-students"></div>`;
  studentArms(pick.armId);
  if (state.studentSearch) return showStudents({ q: state.studentSearch }, `Search results for “${esc(state.studentSearch)}”`);
  if (pick.classCode) return showStudents({ classCode: pick.classCode, armId: pick.armId }, pick.title);
}
function studentArms(armId = '') {
  const code = document.getElementById('ec-cls').value;
  const arms = (state.peopleMeta?.arms || []).filter(a => a.classCode === code);
  const sel = document.getElementById('ec-arm');
  sel.disabled = !code;
  sel.innerHTML = !code ? '<option value="">Select Class First</option>'
    : `<option value="">All arms</option>${arms.map(a => `<option value="${a.id}" ${String(a.id) === String(armId) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
}
function viewStudents() {
  const classCode = document.getElementById('ec-cls').value;
  const armId = document.getElementById('ec-arm').value;
  const err = document.getElementById('ec-err');
  if (!classCode) { err.textContent = 'Select a class.'; return; }
  err.textContent = '';
  state.studentSearch = '';
  const box = document.querySelector('.ea-side-search input');
  if (box) box.value = '';
  const cls = state.peopleMeta.classes.find(c => c.code === classCode)?.label || classCode;
  const arm = state.peopleMeta.arms.find(a => String(a.id) === String(armId))?.name || '';
  const title = esc(`${cls}${arm ? ` ${arm}` : ''}`);
  state.studentPick = { classCode, armId, session: document.getElementById('ec-ses').value, title };
  showStudents({ classCode, armId }, title);
}
async function showStudents(params, title) {
  const out = document.getElementById('ec-students');
  out.innerHTML = '<div class="ec-card"><div class="ec-muted">Loading…</div></div>';
  const { students } = await api(`/api/exam/people/students?${new URLSearchParams(params)}`);
  out.innerHTML = `<div class="ec-card"><h2>${title}</h2>${dataTable('students', {
    rows: students, head: ['#', 'Photo', 'Name', 'Reg. No.', 'Class', 'Gender'], empty: 'No pupils found. Refresh Students data if this looks wrong.',
    match: p => `${p.name} ${p.regNo || ''} ${p.id}`,
    row: (p, i) => `<tr><td>${i + 1}</td><td>${photoCell(p)}</td><td><b>${esc(p.name)}</b></td><td class="ec-mono">${esc(p.regNo || p.id)}</td><td>${esc(p.classLabel || '')}${p.armName ? ` ${esc(p.armName)}` : ''}</td><td>${esc(p.gender || '')}</td></tr>`,
  })}</div>`;
  dtDraw('students');
}

// Staff / Employees
async function loadStaff() {
  const { staff } = await api('/api/exam/people/staff');
  state.staff = staff;
  return staff;
}
const numbered = items => (items.length ? `<ol class="ec-ol">${items.map(x => `<li>${x}</li>`).join('')}</ol>` : '<span class="ec-hint">—</span>');
const subjectItems = u => u.subjects.map(x => `${esc(x.subject)} <span class="ec-hint">(${esc(x.classLabel)})</span>`);
async function renderTeachers() {
  const staff = (await loadStaff()).filter(u => u.role !== 'admin');
  pageEl().innerHTML = `<div class="ec-card"><h2>Teacher / General Staff List</h2>${dataTable('teachers', {
    rows: staff, head: ['Photo', 'Name', 'Designation', 'Phone', 'Subject(s) in Charge', 'Form Class(es)', 'Profile', 'User Status'], empty: 'No staff. Refresh Staff data.',
    match: u => `${u.name} ${u.id} ${u.designation || ''} ${u.phone || ''} ${u.subjects.map(x => x.subject).join(' ')} ${u.formClasses.join(' ')}`,
    row: u => `<tr><td>${photoCell(u)}</td><td><b>${esc(u.name)}</b><div class="ec-hint">${esc(u.id)}</div></td><td>${esc(u.designation || (u.role === 'teacher' ? 'Teacher' : 'Staff'))}</td><td>${esc(u.phone || '')}</td>
      <td>${numbered(subjectItems(u))}</td><td>${numbered(u.formClasses.map(esc))}</td>
      <td><button class="btn-outline" style="padding:5px 12px;font-size:12px;" onclick="staffProfile('${esc(u.id)}')">View</button></td>
      <td><span class="ec-pill ${u.active === 0 ? 'bad' : 'ok'}">${u.active === 0 ? 'Inactive' : 'Active'}</span></td></tr>`,
  })}</div>`;
  dtDraw('teachers');
}
const levelLabel = u => (u.level === 'owner' || u.level === 'super' ? 'Super Admin' : 'Admin');
async function renderAdmins() {
  const admins = (await loadStaff()).filter(u => u.role === 'admin');
  pageEl().innerHTML = `<div class="ec-card"><h2>Admin List</h2><p class="ec-hint">Only these accounts can sign in to this exam server, with their usual portal password.</p>${dataTable('admins', {
    rows: admins, head: ['Photo', 'Name', 'Designation', 'Phone'], empty: 'No admins. Refresh Staff data.',
    match: u => `${u.name} ${u.id} ${u.email || ''} ${u.designation || ''} ${u.phone || ''} ${levelLabel(u)}`,
    row: u => `<tr><td>${photoCell(u)}</td><td><b>${esc(u.name)}</b>${u.email ? `<div><span class="ec-chip">${esc(u.email)}</span></div>` : ''}</td>
      <td>${levelLabel(u)}${u.designation ? `<div><span class="ec-chip">${esc(u.designation)}</span></div>` : ''}</td><td>${esc(u.phone || '')}</td></tr>`,
  })}</div>`;
  dtDraw('admins');
}
function staffProfile(id) {
  const u = (state.staff || []).find(x => x.id === id);
  if (!u) return;
  const line = (k, v) => (v ? `<tr><td class="ec-hint">${k}</td><td>${v}</td></tr>` : '');
  modal(esc(u.name), `<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;">${photoCell(u)}<div><b>${esc(u.name)}</b><div class="ec-hint">${esc(u.id)}</div></div></div>
    <table class="ec-table"><tbody>${line('Designation', esc(u.designation || ''))}${line('Department', esc(u.department || ''))}${line('Phone', esc(u.phone || ''))}${line('Email', esc(u.email || ''))}
    ${line('Gender', esc(u.gender || ''))}${line('Qualifications', esc(u.qualifications || ''))}${line('Date of appointment', esc(u.dateOfAppointment || ''))}
    ${line('Subject(s) in charge', u.subjects.length ? numbered(subjectItems(u)) : '')}${line('Form class(es)', u.formClasses.length ? numbered(u.formClasses.map(esc)) : '')}
    ${line('User status', u.active === 0 ? 'Inactive' : 'Active')}</tbody></table>`, '<button class="btn-outline" onclick="closeModal()">Close</button>');
}

// ── Updates ──
async function renderUpdates() {
  const app = state.dash?.app || {};
  pageEl().innerHTML = `<div class="ec-card"><h2>Software version</h2>
    <p class="ec-muted">Current version: <b class="ec-mono">${app.version ? `v${esc(app.version)}` : 'not running as the app'}</b>${app.build ? ` <span class="ec-hint ec-mono">(${esc(app.build)})</span>` : ''}</p>
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
        ? `<div class="ec-note">A new version is available: <b class="ec-mono">v${esc(r.latest.version)}</b> (${when(r.latest.builtAt)}, ${Math.round(r.setupSize / 1e6)} MB).</div><button class="post-btn" onclick="installUpdate()">Download and Install</button>`
        : `<div class="ec-note">You have the latest version (<span class="ec-mono">v${esc(r.latest.version)} · ${esc(r.latest.build)}</span>).</div>`;
  } catch (err) { out.innerHTML = `<div class="ec-note warn">${esc(err.message)}</div>`; }
}
async function installUpdate() {
  const writing = state.dash?.writing || 0;
  if (!await uiConfirm(`Install the update now? The exam server closes while the new version installs${writing ? `, and ${plural(writing, 'pupil')} still writing will be disconnected` : ''}. Push results first if you can.`, { confirmLabel: 'Install', danger: !!writing })) return;
  document.getElementById('ec-update-out').innerHTML = '<p class="ec-hint">Downloading the update… This window then closes and the installer opens. Click Finish at the end and the updated app opens.</p><div class="ea-progress"><i></i></div>';
  try { await api('/api/exam/update-install', { method: 'POST' }); } catch (err) { document.getElementById('ec-update-out').innerHTML = `<div class="ec-note warn">${esc(err.message)}</div>`; }
}

async function signOut() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.user = null;
  location.hash = '';
  start();
}

start();
