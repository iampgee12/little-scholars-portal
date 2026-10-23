// E-Class › CBT › Offline CBT (LAN): exam-server kit, exam packs, results upload.
let ocData = { schedules: [], packs: [] };

// Shows the Windows app downloads once the deploy has built them
async function ocAppInfo() {
  try {
    const { setupSize } = await apiFetch('/api/admin/cbt/offline/app-info');
    const mb = n => (n ? `(${Math.round(n / 1e6)} MB)` : '');
    document.getElementById('oc-app-ready').hidden = !setupSize;
    document.getElementById('oc-app-missing').hidden = !!setupSize;
    document.getElementById('oc-setup-size').textContent = mb(setupSize);
  } catch { /* leave the buttons as they are */ }
}

// ── School API keys (one set, generated once, that every UCS Exam Server uses) ──
const ocWhen = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
async function ocLoadConnections() {
  const box = document.getElementById('oc-key-box');
  try {
    const { canManage, key, machines } = await apiFetch('/api/admin/exam-servers');
    document.getElementById('oc-conn-new').hidden = !(canManage && !key);
    document.getElementById('oc-conn-who').textContent = canManage ? '' : 'Only a super admin can generate or reset the keys.';
    box.innerHTML = key ? `<div class="oc-key-summary">
        <div><span class="oc-hint">API Number</span><b class="oc-key-num">${escapeHtml(key.apiNumber)}</b></div>
        <div><span class="oc-hint">Generated</span><b>${ocWhen(key.createdAt)}</b><span class="oc-hint">by ${escapeHtml(key.createdBy || '')}</span></div>
        <div><span class="oc-hint">Last used</span><b>${ocWhen(key.lastUsedAt)}</b></div>
        ${canManage ? '<div class="oc-key-reset"><button type="button" class="sf-add-new ts-danger" onclick="ocResetKeys()">Reset Keys</button></div>' : ''}
      </div>
      <p class="oc-hint" style="margin:8px 0 0;">The Authentication Key and Secret Key are not shown again. If they are lost, a super admin can reset them, and every exam computer must then enter the new keys.</p>`
      : `<div class="ts-note">No API keys yet. ${canManage ? 'Click <b>Generate API Keys</b> once, then write the keys down.' : 'Ask a super admin to generate them.'}</div>`;
    document.getElementById('oc-machines-wrap').hidden = !key;
    document.getElementById('oc-conns').innerHTML = machines.length ? machines.map(c => `<tr>
        <td><b>${escapeHtml(c.machine)}</b>${c.lastIp ? `<div class="oc-hint">${escapeHtml(c.lastIp)}</div>` : ''}</td>
        <td>${ocWhen(c.firstSeen)}</td><td>${ocWhen(c.lastSeen)}</td><td>${ocWhen(c.lastSyncAt)}</td><td>${ocWhen(c.lastPushAt)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="padding:18px;color:var(--text-3);">No exam computer has connected yet.</td></tr>';
  } catch (err) {
    box.innerHTML = `<p class="oc-hint">${escapeHtml(err.message)}</p>`;
  }
}
function ocConnModal(title, body, foot) {
  document.getElementById('oc-conn-modal-host').innerHTML = `<div class="sf-modal" id="oc-conn-modal" role="dialog" aria-modal="true" aria-labelledby="oc-conn-title" style="display:flex;">
    <div class="sf-dialog"><div class="sf-head"><strong id="oc-conn-title">${title}</strong><button type="button" class="staff-profile-close" onclick="ocCloseConnModal()" aria-label="Close">&times;</button></div>
    <div class="sf-body">${body}</div><div class="sf-foot">${foot}</div></div></div>`;
}
function ocCloseConnModal() { document.getElementById('oc-conn-modal-host').innerHTML = ''; }
// The keys are shown once: closing needs the "I've written them down" tick
function ocShowKeys(keys, title) {
  const row = (label, value, id) => `<div class="oc-key-row"><label class="field-label" for="${id}">${label}</label>
    <div class="ae-inline"><input class="field-input oc-key" id="${id}" value="${escapeHtml(value)}" readonly onclick="this.select()"><button type="button" class="btn-outline" onclick="ocCopyKey('${id}')">Copy</button></div></div>`;
  ocConnModal(title, `
    <div class="ts-note"><b>Write these down now and keep them safe.</b> They are shown only this once; the portal keeps no readable copy of the Secret Key. Type them into each UCS Exam Server's “Connect School Account” screen. Anyone with these keys can pull pupil and exam data, so don't share them.</div>
    ${row('API Number', keys.apiNumber, 'oc-k1')}${row('API Authentication Key', keys.authKey, 'oc-k2')}${row('API Secret Key', keys.secret, 'oc-k3')}
    <label class="sf-check" style="margin-top:14px;"><input type="checkbox" id="oc-k-noted" onchange="document.getElementById('oc-k-done').disabled=!this.checked"> I have written these keys down somewhere safe</label>`,
  '<button type="button" class="btn-outline" onclick="ocPrintKeys()">Print</button><button type="button" class="post-btn" id="oc-k-done" disabled onclick="ocCloseConnModal()">Done</button>');
  // closing with × or the background is not allowed until they're noted
  document.querySelector('#oc-conn-modal .staff-profile-close').onclick = () => { if (document.getElementById('oc-k-noted').checked) ocCloseConnModal(); else showToast('Tick the box once you have written the keys down'); };
}
function ocPrintKeys() {
  const v = id => escapeHtml(document.getElementById(id).value);
  const w = window.open('', '_blank', 'width=640,height=480');
  if (!w) return showToast('Allow pop-ups to print');
  w.document.write(`<!DOCTYPE html><title>School API keys</title><body style="font-family:'DM Sans',Arial,sans-serif;padding:32px;">
    <h2 style="margin:0 0 6px;">${escapeHtml(document.title.split(' - ')[0] || 'School')} — UCS Exam Server API keys</h2><p style="color:#555;">Printed ${new Date().toLocaleString('en-GB')}. Keep this somewhere safe.</p>
    <table style="font-size:15px;border-collapse:collapse;">${[['API Number', 'oc-k1'], ['API Authentication Key', 'oc-k2'], ['API Secret Key', 'oc-k3']].map(([l, id]) => `<tr><td style="padding:8px 16px 8px 0;color:#555;">${l}</td><td style="padding:8px 0;font-family:monospace;font-size:16px;">${v(id)}</td></tr>`).join('')}</table>
    <script>window.print()<\/script></body>`);
  w.document.close();
}
async function ocGenerateKeys() {
  if (!await uiConfirm('Generate the school\'s API keys? They are shown only once, so have somewhere ready to write them down.', { confirmLabel: 'Generate' })) return;
  try {
    const { keys } = await apiFetch('/api/admin/exam-servers', { method: 'POST' });
    ocShowKeys(keys, 'School API keys');
    ocLoadConnections();
  } catch (err) { showToast(err.message); }
}
function ocResetKeys() {
  ocConnModal('Reset School API Keys', `
    <div class="ts-note"><b>Only do this if the keys are lost or someone who shouldn't have them does.</b> The current keys stop working straight away, and every exam computer must enter the new keys before it can sync or push results again.</div>
    <label class="field-label" for="oc-reset-confirm">Type RESET to confirm</label><input class="field-input" id="oc-reset-confirm" autocomplete="off">`,
  '<button type="button" class="btn-outline" onclick="ocCloseConnModal()">Cancel</button><button type="button" class="post-btn ts-danger" onclick="ocDoReset()">Reset Keys</button>');
}
async function ocDoReset() {
  try {
    const { keys } = await apiFetch('/api/admin/exam-servers/reset', { method: 'POST', body: JSON.stringify({ confirm: document.getElementById('oc-reset-confirm').value }) });
    ocShowKeys(keys, 'New School API keys');
    ocLoadConnections();
  } catch (err) { showToast(err.message); }
}
async function ocCopyKey(id) {
  const el = document.getElementById(id);
  try { await navigator.clipboard.writeText(el.value); } catch { el.select(); document.execCommand('copy'); }
  showToast('Copied', 'success');
}

// "Allow CBT exams online": off means pupils can't start a CBT exam on this portal, even
// if a paper is set to Live; the exam servers always run exams either way
async function ocLoadWhere() {
  const box = document.getElementById('oc-where');
  if (!box) return;
  try {
    const s = await apiFetch('/api/admin/cbt/online-setting');
    box.innerHTML = `<div class="oc-where-row">
        <div class="oc-where-text">
          <b>Allow CBT exams online</b>
          <span class="oc-hint">${s.allowed
            ? 'On: pupils can write papers set to <b>Live</b> on this portal, from anywhere, as well as at school on the exam server.'
            : 'Off: pupils write CBT exams only at school, on the exam server. A paper set to Live here by mistake still can\'t be written online.'}</span>
          <span class="oc-hint">Exams on the exam server work either way.${s.changedAt ? ` Last changed ${escapeHtml(new Date(s.changedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${s.changedBy ? ` by ${escapeHtml(s.changedBy)}` : ''}.` : ''}</span>
        </div>
        <label class="oc-switch" title="${s.canChange ? '' : 'Only a super admin can change this'}">
          <input type="checkbox" ${s.allowed ? 'checked' : ''} ${s.canChange ? '' : 'disabled'} onchange="ocSetOnline(this)">
          <span class="oc-switch-track"></span><span class="oc-switch-label">${s.allowed ? 'On' : 'Off'}</span>
        </label>
      </div>`;
  } catch (err) { box.innerHTML = `<p class="oc-hint">${escapeHtml(err.message)}</p>`; }
}
async function ocSetOnline(input) {
  const allowed = input.checked;
  const ok = await uiConfirm(allowed
    ? 'Allow pupils to write CBT exams online? Any paper set to Live on this portal can then be written from anywhere, not only at school.'
    : 'Stop CBT exams online? Pupils will write CBT exams only at school, on the exam server. Anyone already writing online can still finish.',
    { confirmLabel: allowed ? 'Allow online' : 'Stop online', danger: allowed });
  if (!ok) { input.checked = !allowed; return; }
  input.disabled = true;
  try {
    await apiFetch('/api/admin/cbt/online-setting', { method: 'PUT', body: JSON.stringify({ allowed }) });
    showToast(allowed ? 'CBT exams can now be written online' : 'CBT exams are now written at school only', 'success');
  } catch (err) { showToast(err.message, 'warn'); }
  ocLoadWhere();
}

async function ocInit() {
  ocAppInfo();
  ocLoadConnections();
  ocLoadWhere();
  try {
    ocData = await apiFetch('/api/admin/cbt/offline/overview');
  } catch (err) {
    showToast(err.message);
    return;
  }
  const box = document.getElementById('oc-schedules');
  box.innerHTML = ocData.schedules.length
    ? ocData.schedules.map(s => `<label class="oc-schedule ${s.papers ? '' : 'oc-disabled'}">
        <input type="checkbox" value="${s.id}" ${s.papers ? '' : 'disabled'}>
        <span><b>${escapeHtml(s.title)}</b><span class="oc-hint">${escapeHtml([s.session, s.term].filter(Boolean).join(' · '))} · ${s.papers} computer-based paper${s.papers === 1 ? '' : 's'}</span></span>
      </label>`).join('')
    : '<span class="oc-text">No CBT schedules yet. Create one under E-Class › CBT › CBT Schedules first.</span>';
  document.getElementById('oc-packs').innerHTML = ocData.packs.length
    ? ocData.packs.map(p => `<tr>
        <td>${escapeHtml(new Date(p.created_at).toLocaleString())}</td>
        <td>${escapeHtml(p.createdByName || p.created_by || '')}</td>
        <td>${p.paper_count}</td><td>${p.student_count}</td><td>${p.question_count}</td>
        <td>${p.results_uploaded_at ? `${p.results_count} · ${escapeHtml(new Date(p.results_uploaded_at).toLocaleString())}` : '<span style="color:var(--text-3)">Not yet</span>'}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="padding:18px;color:var(--text-3);">No exam packs made yet.</td></tr>';
}

async function ocDownloadPack() {
  const scheduleIds = [...document.querySelectorAll('#oc-schedules input:checked')].map(i => Number(i.value));
  const passphrase = document.getElementById('oc-pass').value;
  if (!scheduleIds.length) return showToast('Tick at least one CBT schedule');
  if (passphrase.length < 6) return showToast('Choose a passphrase of at least 6 characters');
  if (passphrase !== document.getElementById('oc-pass2').value) return showToast('The two passphrases are different');
  const btn = document.getElementById('oc-pack-btn');
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const res = await fetch('/api/admin/cbt/offline/pack', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleIds, passphrase }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not make the exam pack');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'cbt-exam-pack.ucscbt';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById('oc-pass').value = '';
    document.getElementById('oc-pass2').value = '';
    showToast('Exam pack downloaded', 'success');
    ocInit();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Exam Pack';
  }
}

async function ocUploadResults() {
  const file = document.getElementById('oc-results-file').files?.[0];
  const passphrase = document.getElementById('oc-results-pass').value;
  if (!file) return showToast('Choose the results file from the exam computer');
  if (!passphrase) return showToast('Type the passphrase used for the exam pack');
  const btn = document.getElementById('oc-results-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const fileDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
    const { report } = await apiFetch('/api/admin/cbt/offline/results', { method: 'POST', body: JSON.stringify({ fileDataUrl, passphrase }) });
    const list = (title, items, cls = '') => items.length ? `<p class="oc-report-title ${cls}">${title}</p><ul class="oc-report-list">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
    document.getElementById('oc-report').innerHTML = `<div class="oc-report">
      <p><b>${report.imported}</b> result${report.imported === 1 ? '' : 's'} added${report.alreadyUploaded ? ` · ${report.alreadyUploaded} already uploaded before` : ''}${report.notSubmitted ? ` · ${report.notSubmitted} never handed in on the exam computer` : ''}.</p>
      ${list('Kept the online result (pupil also wrote online):', report.conflicts, 'oc-warn')}
      ${list('Score recalculated:', report.scoreChanged)}
      ${list('Skipped:', report.skipped, 'oc-warn')}
    </div>`;
    document.getElementById('oc-results-file').value = '';
    document.getElementById('oc-results-pass').value = '';
    showToast(`${report.imported} CBT result${report.imported === 1 ? '' : 's'} uploaded`, 'success');
    ocInit();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Results';
  }
}
