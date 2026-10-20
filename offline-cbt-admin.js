// E-Class › CBT › Offline CBT (LAN): exam-server kit, exam packs, results upload.
let ocData = { schedules: [], packs: [] };

// Shows the Windows app downloads once the deploy has built them
async function ocAppInfo() {
  try {
    const { appSize, setupSize } = await apiFetch('/api/admin/cbt/offline/app-info');
    const mb = n => (n ? `(${Math.round(n / 1e6)} MB)` : '');
    document.getElementById('oc-app-ready').hidden = !appSize;
    document.getElementById('oc-app-missing').hidden = !!appSize;
    document.querySelector('a[href$="/setup.exe"]').hidden = !setupSize;
    document.getElementById('oc-setup-size').textContent = mb(setupSize);
    document.getElementById('oc-app-size').textContent = mb(appSize);
  } catch { /* leave the buttons as they are */ }
}

async function ocInit() {
  ocAppInfo();
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
