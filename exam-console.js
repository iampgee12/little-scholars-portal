// Exam Console for the offline (LAN) CBT exam computer.
const root = document.getElementById('ec-root');
let overview = null;
let openPaperId = null;
let refreshTimer = null;

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
const when = iso => (iso ? new Date(iso).toLocaleString() : '');

async function start() {
  clearInterval(refreshTimer);
  let status;
  try { status = await api('/api/exam/status'); } catch (err) { root.innerHTML = `<div class="ec-card ec-error">${esc(err.message)}</div>`; return; }
  if (!status.setUp) return renderLoadPack(true);
  let session = null;
  try { session = await api('/api/session'); } catch { /* not signed in */ }
  if (!session?.user || session.user.role !== 'admin') return renderSignIn(status);
  document.getElementById('ec-top-actions').innerHTML = `<span class="ec-hint">${esc(session.user.name)}</span><button class="btn-outline" onclick="signOut()">Sign out</button>`;
  await refresh();
  refreshTimer = setInterval(refresh, 10000);
}

function renderLoadPack(firstTime) {
  root.innerHTML = `
    <div class="ec-card">
      <h2>${firstTime ? 'Set up this exam computer' : 'Load a different exam pack'}</h2>
      <p class="ec-muted">Load the exam pack downloaded from the online portal (<b>E-Class › CBT › Offline CBT (LAN)</b>). It holds the papers, questions and pupils' sign-in details.</p>
      <div class="ec-field"><label for="ec-file">Exam pack file (.ucscbt)</label><input class="ec-input" type="file" id="ec-file" accept=".ucscbt"></div>
      <div class="ec-field"><label for="ec-pass">Passphrase</label><input class="ec-input" type="password" id="ec-pass" autocomplete="off"></div>
      ${firstTime ? '' : '<label class="ec-check"><input type="checkbox" id="ec-replace"> Replace this computer\'s current exams and results</label>'}
      <div style="margin-top:16px;display:flex;gap:8px;"><button class="post-btn" id="ec-load" onclick="loadPack()">Load Exam Pack</button>${firstTime ? '' : '<button class="btn-outline" onclick="start()">Cancel</button>'}</div>
      <div class="ec-error" id="ec-err"></div>
    </div>`;
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
    await uiNotice('Exam pack loaded', `${data.loaded.papers} paper(s), ${data.loaded.students} pupil(s), ${data.loaded.questions} question(s).\n\nNow sign in with your admin ID and password to open the Exam Console.`);
    start();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Load Exam Pack';
  }
}

function renderSignIn(status) {
  document.getElementById('ec-top-actions').innerHTML = '';
  root.innerHTML = `
    <div class="ec-card">
      <h2>Sign in to run the exams</h2>
      <p class="ec-muted">Exam pack loaded${status.pack ? ` (${esc((status.pack.schedules || []).map(s => s.title).join(', '))})` : ''}. Sign in as <b>Admin</b> with your usual admin ID and password.</p>
      <a class="post-btn" style="display:inline-block;text-decoration:none;margin-top:8px;" href="/signin">Go to Sign In</a>
      ${addressBlock(status.lanAddresses)}
    </div>`;
}

function addressBlock(addresses) {
  return `<div class="ec-field"><label>Pupils open this address on the school Wi-Fi</label>
    <div class="ec-address">${(addresses || []).map(a => `<code>${esc(a)}</code>`).join('') || '<span class="ec-error">This computer is not connected to a network yet. Connect it to the school router/Wi-Fi.</span>'}</div></div>`;
}

async function refresh() {
  try {
    overview = await api('/api/exam/overview');
  } catch (err) {
    if (err.status === 401 || err.status === 403) return start();
    return;
  }
  const pack = overview.pack || {};
  const papers = overview.papers || [];
  const totals = papers.reduce((t, p) => ({ started: t.started + p.started, submitted: t.submitted + p.submitted }), { started: 0, submitted: 0 });
  root.innerHTML = `
    <div class="ec-card">
      <div class="ec-flex">
        <div>
          <h2>${esc((pack.schedules || []).map(s => s.title).join(', ') || 'Exam pack')}</h2>
          <div class="ec-hint">Pack made ${esc(when(pack.createdAt))}${pack.createdBy ? ` by ${esc(pack.createdBy.name)}` : ''} · loaded ${esc(when(pack.loadedAt))}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="post-btn" onclick="exportResults()">Export Results</button>
          <button class="btn-outline" onclick="renderLoadPack(false)">Load another pack</button>
        </div>
      </div>
      ${addressBlock(overview.lanAddresses)}
      <p class="ec-hint" style="margin-top:10px;">${totals.submitted} handed in · ${totals.started - totals.submitted} still writing${overview.exportedAt ? ` · results last exported ${esc(when(overview.exportedAt))}` : ' · results not exported yet'}</p>
    </div>
    <div class="ec-card">
      <h2>Papers</h2>
      <p class="ec-muted">Click <b>Open</b> when it's time to start a paper and <b>Close</b> when it ends. Closing hands in every paper still being written.</p>
      <div style="overflow-x:auto;"><table class="ec-table">
        <thead><tr><th>Class</th><th>Subject</th><th class="ec-hide-sm">When</th><th>Time</th><th class="ec-hide-sm">Questions</th><th>Pupils</th><th>Started</th><th>Handed in</th><th>Status</th><th></th></tr></thead>
        <tbody>${papers.map(p => `
          <tr class="${p.id === openPaperId ? 'ec-row-active' : ''}">
            <td>${esc(p.classLabel)}${p.armName ? ` ${esc(p.armName)}` : ''}</td>
            <td><b>${esc(p.subjectName)}</b><div class="ec-hint">${esc(p.scheduleTitle)}</div></td>
            <td class="ec-hide-sm">${esc([p.examDate, p.examTime].filter(Boolean).join(' '))}</td>
            <td>${p.durationMinutes} min</td>
            <td class="ec-hide-sm">${p.questions}${p.questions ? '' : ' <span class="ec-error">none!</span>'}</td>
            <td>${p.pupils}</td><td>${p.started}</td><td>${p.submitted}</td>
            <td><span class="ec-pill ${esc(p.status)}">${p.status === 'live' ? 'Open' : p.status === 'closed' ? 'Closed' : 'Not open'}</span></td>
            <td class="ec-actions">
              ${p.status !== 'live' ? `<button class="post-btn" onclick="setStatus(${p.id}, 'live')">${p.status === 'closed' ? 'Reopen' : 'Open'}</button>` : `<button class="btn-danger" onclick="setStatus(${p.id}, 'closed')">Close</button>`}
              <button class="btn-outline" onclick="showPupils(${p.id})">Pupils</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="10" class="ec-hint">This pack has no papers.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div id="ec-pupils"></div>`;
  if (openPaperId) showPupils(openPaperId, true);
}

async function setStatus(id, status) {
  const paper = overview.papers.find(p => p.id === id);
  if (status === 'closed') {
    const writing = paper.started - paper.submitted;
    if (!await uiConfirm(`Close ${paper.subjectName} for ${paper.classLabel}?${writing ? ` ${writing} pupil(s) still writing will have their papers handed in now.` : ''}`, { confirmLabel: 'Close paper', danger: true })) return;
  }
  try {
    const data = await api(`/api/exam/papers/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    if (data.autoSubmitted) await uiNotice('Paper closed', `${data.autoSubmitted} paper(s) still being written were handed in and marked.`);
    refresh();
  } catch (err) { uiNotice('Could not change the paper', err.message); }
}

async function showPupils(id, quiet) {
  openPaperId = id;
  const paper = overview.papers.find(p => p.id === id);
  const box = document.getElementById('ec-pupils');
  if (!paper || !box) return;
  try {
    const { pupils } = await api(`/api/exam/papers/${id}/pupils`);
    box.innerHTML = `<div class="ec-card">
      <div class="ec-flex"><h2>${esc(paper.classLabel)} — ${esc(paper.subjectName)}: pupils</h2><button class="btn-outline" onclick="openPaperId=null;document.getElementById('ec-pupils').innerHTML=''">Hide</button></div>
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
  try {
    await api(`/api/exam/papers/${id}/reset`, { method: 'POST', body: JSON.stringify({ studentId }) });
    refresh();
  } catch (err) { uiNotice('Could not reset', err.message); }
}

async function exportResults() {
  const writing = (overview.papers || []).reduce((n, p) => n + p.started - p.submitted, 0);
  if (writing && !await uiConfirm(`${writing} pupil(s) are still writing. Their papers are not in the export until they hand in or the paper is closed. Export anyway?`, { confirmLabel: 'Export' })) return;
  try {
    const res = await fetch('/api/exam/results-file', { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'cbt-results.ucsres';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    await uiNotice('Results exported', `Saved as ${name}.\n\nCopy it to a computer with internet, then upload it on the online portal: E-Class › CBT › Offline CBT (LAN) › Upload Results, using the same passphrase.`);
    refresh();
  } catch (err) { uiNotice('Could not export', err.message); }
}

async function signOut() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.href = '/signin';
}

start();
