// Admin → Security & Activity Log: overview, activity log, who is signed in,
// and backups. Server side: security.js (/api/admin/security/…).

const SEC = { view: 'overview', log: { q: '', from: '', to: '', outcome: '', page: 1 } };

const secEsc = v => escapeHtml(v ?? '');
const secWhen = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const secSize = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function secInit() {
  const root = document.getElementById('sec-root');
  if (!root) return;
  root.innerHTML = `<div class="en-tabs">
      ${[['overview', 'Overview'], ['log', 'Activity Log'], ['sessions', 'Who Is Signed In'], ['backups', 'Backups']]
        .map(([k, l]) => `<button class="en-tab${SEC.view === k ? ' active' : ''}" onclick="SEC.view='${k}'; secInit()">${l}</button>`).join('')}
    </div><div id="sec-body"><div class="sr-empty">Loading…</div></div>`;
  ({ overview: secOverview, log: secLog, sessions: secSessions, backups: secBackups }[SEC.view])();
}

const secCard = (title, body) => `<div class="card sec-card"><div class="card-head"><span class="card-title">${title}</span></div><div class="card-body">${body}</div></div>`;
const secTile = (value, label, tone) => `<div class="stu-counter ${tone}"><div><strong>${value}</strong><span>${label}</span></div></div>`;

async function secOverview() {
  let d;
  try { d = await apiFetch('/api/admin/security/overview'); } catch (err) { return showToast(err.message); }
  const body = document.getElementById('sec-body');
  if (!body) return;
  const me = d.admins.find(a => a.id === d.me);
  const last = d.backups[0];
  const backupAge = last ? (Date.now() - Date.parse(last.at)) / 36e5 : Infinity;
  body.innerHTML = `
    ${secCard('Security at a glance', `<div class="stu-counters">
      ${secTile(me?.twoStep.required ? 'ON' : 'OFF', 'Two-step sign-in (your account)', me?.twoStep.required ? 'green' : 'red')}
      ${secTile(d.email ? 'Ready' : 'Not set up', 'Email sending', d.email ? 'green' : 'amber')}
      ${secTile(d.offsite.configured ? (d.offsite.lastOk ? secWhen(d.offsite.lastOk) : 'Waiting') : 'Not set up', 'Off-site backup', d.offsite.configured && !d.offsite.lastError ? 'green' : 'red')}
      ${secTile(last ? secWhen(last.at) : 'None yet', 'Copy on this server', backupAge < 30 ? 'green' : 'red')}
      ${secTile(d.failedSignIns7d, 'Failed sign-ins (7 days)', d.failedSignIns7d > 20 ? 'red' : 'slate')}
    </div>
    ${!me?.twoStep.required ? `<div class="spf-note"><strong>Two-step sign-in is off for you:</strong> ${secEsc(me?.twoStep.reason)}. ${!d.email ? 'Ask whoever manages the server to fill in the email settings (SMTP).' : ''} ${!me?.email ? 'Add your email address under My Profile.' : ''}</div>` : ''}
    <div class="spf-note">People are signed out automatically after <strong>${d.idleMinutes.admin} minutes</strong> without activity (staff) or <strong>${d.idleMinutes.student} minutes</strong> (pupils).</div>`)}

    ${secCard('Passwords', `<p class="sec-p">Accounts still on a password set by an administrator (or a weak one) must choose their own at their next sign-in.</p>
      <table class="stu-info"><tbody>
        <tr><td>Admins waiting to change</td><td>${d.passwords.admin}</td></tr>
        <tr><td>Staff waiting to change</td><td>${d.passwords.teacher}</td></tr>
        <tr><td>Pupils waiting to change</td><td>${d.passwords.student}</td></tr>
      </tbody></table>
      <div class="spf-actions"><button class="btn-outline btn-sm" onclick="secForce('teacher')">Make all staff choose a new password</button><button class="btn-outline btn-sm" onclick="secForce('student')">Make all pupils choose a new password</button></div>`)}

    ${secCard('Admin accounts', `<div class="spf-table-wrap"><table class="data-table"><thead><tr><th>Admin</th><th>Email</th><th>Account</th><th>Two-step sign-in</th></tr></thead><tbody>
      ${d.admins.map(a => `<tr><td><strong>${secEsc(a.name)}</strong><div class="en-hint">${secEsc(a.id)}</div></td><td>${secEsc(a.email || '—')}</td>
        <td><span class="sr-pill ${a.active ? 'accepted' : 'rejected'}">${a.active ? 'Active' : 'Switched off'}</span></td>
        <td>${a.twoStep.required ? '<span class="sr-pill accepted">On</span>' : `<span class="sr-pill pending">Off</span><div class="en-hint">${secEsc(a.twoStep.reason)}</div>`}</td></tr>`).join('')}
    </tbody></table></div>`)}

    ${secCard('Devices remembered for your account', `${d.devices.length ? `<table class="data-table"><thead><tr><th>Device</th><th>Remembered</th><th>Until</th></tr></thead><tbody>
        ${d.devices.map(x => `<tr><td>${secEsc(x.label)}</td><td>${secWhen(x.createdAt)}</td><td>${secWhen(x.expiresAt)}</td></tr>`).join('')}</tbody></table>
        <div class="spf-actions"><button class="btn-outline btn-sm" onclick="secForgetDevices()">Forget all my devices</button></div>`
      : '<div class="sr-empty spf-left">No remembered devices. You will be asked for an emailed code each time you sign in.</div>'}`)}`;
}

async function secForce(role) {
  if (!confirm(`Everyone in this group will have to choose a new password the next time they sign in. Continue?`)) return;
  try { const r = await apiFetch('/api/admin/security/force-change', { method: 'POST', body: JSON.stringify({ role }) }); showToast(`${r.updated} account(s) will choose a new password at next sign-in`); secOverview(); } catch (err) { showToast(err.message); }
}

async function secForgetDevices() {
  try { await apiFetch('/api/admin/security/devices/forget', { method: 'POST', body: '{}' }); showToast('Devices forgotten'); secOverview(); } catch (err) { showToast(err.message); }
}

// ── Activity log ──
async function secLog() {
  const f = SEC.log;
  const qs = new URLSearchParams({ q: f.q, from: f.from, to: f.to, outcome: f.outcome, page: f.page });
  let d;
  try { d = await apiFetch(`/api/admin/security/audit?${qs}`); } catch (err) { return showToast(err.message); }
  const body = document.getElementById('sec-body');
  if (!body) return;
  const pages = Math.max(1, Math.ceil(d.total / d.perPage));
  body.innerHTML = secCard('Activity Log', `
    <p class="sec-p">Every sign-in, failed sign-in, change to records, and every time someone opens a pupil's profile, documents or results is recorded here, with the time, person, computer address (IP) and device.</p>
    <div class="spf-filters four">
      ${enField('Search', `<input class="field-input" id="sec-q" value="${secEsc(f.q)}" placeholder="Name, ID, action, IP…">`)}
      ${enField('From', `<input class="field-input" type="date" id="sec-from" value="${secEsc(f.from)}">`)}
      ${enField('To', `<input class="field-input" type="date" id="sec-to" value="${secEsc(f.to)}">`)}
      ${enField('Show', `<select class="ctrl-select" id="sec-outcome"><option value="">Everything</option><option value="failed"${f.outcome === 'failed' ? ' selected' : ''}>Only failures / refused</option></select>`)}
    </div>
    <div class="spf-actions"><button class="post-btn btn-sm" onclick="secLogApply()">Apply</button><button class="btn-outline btn-sm" onclick="SEC.log={q:'',from:'',to:'',outcome:'',page:1}; secLog()">Clear</button>
      <button class="btn-outline btn-sm" onclick="location.href='/api/admin/security/audit.csv?'+new URLSearchParams({q:SEC.log.q,from:SEC.log.from,to:SEC.log.to,outcome:SEC.log.outcome})">Export CSV</button></div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>IP / Device</th></tr></thead><tbody>
      ${d.rows.length ? d.rows.map(r => `<tr class="${r.outcome === 'failed' ? 'sec-failed' : ''}"><td class="stu-mono">${secWhen(r.at)}</td>
        <td>${r.userName ? `<strong>${secEsc(r.userName)}</strong>` : ''}<div class="en-hint">${secEsc(r.userId || 'System')}${r.role ? ` · ${secEsc(r.role)}` : ''}</div></td>
        <td>${r.outcome === 'failed' ? '<span class="sr-pill rejected">Failed</span> ' : ''}${secEsc(r.action)}</td><td>${secEsc(r.detail)}</td>
        <td class="stu-mono">${secEsc(r.ip)}<div class="en-hint">${secEsc(r.device)}</div></td></tr>`).join('') : '<tr><td colspan="5" class="sr-empty">Nothing recorded yet</td></tr>'}
    </tbody></table></div>
    <div class="sr-foot"><span>${d.total} record(s)</span><div class="sr-pages">
      <button ${f.page <= 1 ? 'disabled' : ''} onclick="SEC.log.page--; secLog()">&lsaquo; Prev</button><span class="sec-page">Page ${f.page} of ${pages}</span><button ${f.page >= pages ? 'disabled' : ''} onclick="SEC.log.page++; secLog()">Next &rsaquo;</button>
    </div></div>`);
}

function secLogApply() {
  Object.assign(SEC.log, { q: document.getElementById('sec-q').value.trim(), from: document.getElementById('sec-from').value, to: document.getElementById('sec-to').value, outcome: document.getElementById('sec-outcome').value, page: 1 });
  secLog();
}

// ── Who is signed in ──
async function secSessions() {
  let d;
  try { d = await apiFetch('/api/admin/security/sessions'); } catch (err) { return showToast(err.message); }
  const body = document.getElementById('sec-body');
  if (!body) return;
  body.innerHTML = secCard('Who Is Signed In', `
    <p class="sec-p">If you see a sign-in you don't recognise, end it here, then change that person's password.</p>
    <div class="spf-actions"><button class="btn-danger btn-sm" onclick="secEnd({all:true}, 'Sign out everyone except you?')">Sign out everyone except me</button></div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>Person</th><th>Role</th><th>Signed in</th><th>Last active</th><th>IP / Device</th><th></th></tr></thead><tbody>
      ${d.sessions.length ? d.sessions.map(s => `<tr><td><strong>${secEsc(s.name)}</strong><div class="en-hint">${secEsc(s.userId)}</div></td><td style="text-transform:capitalize">${secEsc(s.role)}</td>
        <td>${secWhen(s.createdAt)}</td><td>${secWhen(s.lastSeen)}</td><td class="stu-mono">${secEsc(s.ip || '')}<div class="en-hint">${secEsc(s.device || '')}</div></td>
        <td>${s.current ? '<span class="sr-pill accepted">This is you</span>' : `<button class="btn-outline btn-sm" onclick="secEnd({ref:'${s.ref}'}, 'End this sign-in?')">Sign out</button>`}</td></tr>`).join('') : '<tr><td colspan="6" class="sr-empty">No one is signed in</td></tr>'}
    </tbody></table></div>`);
}

async function secEnd(payload, question) {
  if (!confirm(question)) return;
  try { const r = await apiFetch('/api/admin/security/sessions/end', { method: 'POST', body: JSON.stringify(payload) }); showToast(`${r.ended} sign-in(s) ended`); secSessions(); } catch (err) { showToast(err.message); }
}

// ── Backups ──
async function secBackups() {
  let d;
  try { d = await apiFetch('/api/admin/security/overview'); } catch (err) { return showToast(err.message); }
  const body = document.getElementById('sec-body');
  if (!body) return;
  const o = d.offsite;
  const age = o.lastOk ? (Date.now() - Date.parse(o.lastOk)) / 36e5 : Infinity;
  body.innerHTML = secCard('Automatic Off-site Backup', o.configured ? `
      <div class="stu-counters">
        ${secTile(o.lastOk ? secWhen(o.lastOk) : 'Not yet', 'Last copy sent', age < 3 ? 'green' : age < 26 ? 'amber' : 'red')}
        ${secTile(secEsc(o.bucket), `Storage: ${secEsc(o.endpointHost)}`, 'slate')}
        ${secTile(o.filesTracked, 'Photos / documents / PDFs copied', 'blue')}
      </div>
      ${o.lastError ? `<div class="spf-note sec-bad"><strong>Last problem:</strong> ${secEsc(o.lastError)}</div>` : ''}
      <p class="sec-p">Every hour, and a couple of minutes after any change, an <strong>encrypted</strong> copy of the database and any new photos, documents and result PDFs is sent to separate cloud storage.
        Copies are kept for the last 2 days (all), 90 days (one per day) and 3 years (one per month). Admins are emailed if a backup fails.</p>
      <div class="spf-actions"><button class="post-btn btn-sm" onclick="secOffsite('run', this)">Send a copy now</button><button class="btn-outline btn-sm" onclick="secOffsite('test', this)">Test connection</button></div>`
    : `<div class="spf-note sec-bad"><strong>Not set up yet.</strong> Until it is, the only copies are on the same server as the portal.</div>
      <p class="sec-p">Whoever manages the server adds these settings (secrets) once: ${o.missing.map(m => `<code>${secEsc(m)}</code>`).join(', ')}.</p>`)
  + secCard('Copies on this server', `
    <p class="sec-p">A copy of the whole database (pupils, staff, results, fees, attendance) is also made on the server every day, and the last 14 are kept. You can also download a full backup yourself at any time.</p>
    <div class="spf-actions"><button class="post-btn btn-sm" onclick="secBackupNow(this)">Back up now</button>
      <button class="btn-outline btn-sm" onclick="location.href='/api/admin/security/backups/full.zip'">Download full backup (database + photos + result PDFs)</button></div>
    <div class="spf-table-wrap"><table class="data-table"><thead><tr><th>Backup</th><th>Made</th><th>Size</th><th></th></tr></thead><tbody>
      ${d.backups.length ? d.backups.map(b => `<tr><td class="stu-mono">${secEsc(b.name)}</td><td>${secWhen(b.at)}</td><td>${secSize(b.size)}</td>
        <td><button class="btn-outline btn-sm" onclick="location.href='/api/admin/security/backups/${encodeURIComponent(b.name)}'">Download</button></td></tr>`).join('') : '<tr><td colspan="4" class="sr-empty">No backups yet — press "Back up now"</td></tr>'}
    </tbody></table></div>
    <div class="spf-note">Backup files contain everyone's personal information. Store downloaded copies somewhere only the head of school and the administrator can open, and never send them by email or WhatsApp.</div>`);
}

async function secOffsite(action, btn) {
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/security/offsite/${action}`, { method: 'POST', body: '{}' });
    showToast(action === 'test' ? 'Connection works — a test file was saved, read back and removed' : 'Copy sent to off-site storage');
    secBackups();
  } catch (err) { showToast(err.message); btn.disabled = false; }
}

async function secBackupNow(btn) {
  btn.disabled = true;
  try { await apiFetch('/api/admin/security/backups', { method: 'POST', body: '{}' }); showToast('Backup made'); secBackups(); } catch (err) { showToast(err.message); btn.disabled = false; }
}
