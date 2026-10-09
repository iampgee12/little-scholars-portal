// Admin → People → View Students and Students Registry (server: students-api.js),
// plus the pupil profile pop-up both pages open.

const VS = { rows: [], shown: [], view: 'list', page: 1, perPage: 30, search: '', selected: new Set(), rules: [], loaded: false, sessions: null, activeSession: '' };
const REG = { rows: [], counts: {}, page: 1, perPage: 25, search: '', status: 'all', gender: 'all', year: '' };

const VS_FIELDS = [
  ['regNo', 'Reg. No.'], ['id', 'Student ID'], ['name', 'Full Name'], ['surname', 'Surname'], ['firstName', 'First Name'],
  ['otherNames', 'Other Names'], ['gender', 'Gender'], ['dob', 'Date of Birth'], ['classLabel', 'Class'], ['classArmName', 'Class Arm'],
  ['email', 'Email'], ['phone', 'Contact Phone'], ['account', 'Account Status'], ['enrolledOn', 'Date Enrolled'], ['session', 'Enrolled Session'],
  ['rollNo', 'Roll No'], ['religion', 'Religion'], ['nationality', 'Nationality'], ['state', 'State of Origin'], ['lga', 'LGA'],
  ['town', 'Town'], ['residentialAddress', 'Residential Address'], ['permanentAddress', 'Permanent Address'], ['bloodGroup', 'Blood Group'],
  ['genotype', 'Genotype'], ['nin', 'NIN / Birth Cert. No.'], ['parent1', 'Parent / Guardian 1'], ['parent1Phone', 'Parent 1 Phone'],
  ['parent2', 'Parent / Guardian 2'], ['parent2Phone', 'Parent 2 Phone'], ['parentEmail', 'Parent Email'],
];

function vsValue(r, key) {
  const p = r.parents || [];
  switch (key) {
    case 'gender': return r.gender === 'M' ? 'Male' : r.gender === 'F' ? 'Female' : '';
    case 'classLabel': return r.classLabel || r.classCode || '';
    case 'account': return r.active ? 'Active' : 'Deactivated';
    case 'parent1': return p[0] ? `${p[0].name}${p[0].relationship ? ` (${p[0].relationship})` : ''}` : '';
    case 'parent1Phone': return p[0]?.phone || '';
    case 'parent2': return p[1] ? `${p[1].name}${p[1].relationship ? ` (${p[1].relationship})` : ''}` : '';
    case 'parent2Phone': return p[1]?.phone || '';
    case 'dob': return stuDate(r.dob);
    case 'enrolledOn': return stuDate(r.enrolledOn);
    default: return r[key] ?? '';
  }
}

function stuDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

const STU_ICON = {
  users: '<path d="M5.5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M1 14c0-2.5 2-4.5 4.5-4.5S10 11.5 10 14"/><path d="M11 2.2a2.5 2.5 0 0 1 0 4.6"/><path d="M12.5 9.6c1.5.6 2.5 2.2 2.5 4.4"/>',
  female: '<circle cx="8" cy="5.5" r="3.5"/><line x1="8" y1="9" x2="8" y2="15"/><line x1="5.5" y1="12.5" x2="10.5" y2="12.5"/>',
  male: '<circle cx="6.5" cy="9.5" r="4"/><line x1="9.5" y1="6.5" x2="14" y2="2"/><polyline points="10.5 2 14 2 14 5.5"/>',
  check: '<circle cx="8" cy="8" r="6.5"/><polyline points="5 8.2 7 10.2 11 6"/>',
  off: '<circle cx="8" cy="8" r="6.5"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><polyline points="2 2 2 5 5 5"/><polyline points="8 5 8 8 10 9.5"/>',
};
const stuIcon = name => `<svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${STU_ICON[name]}</svg>`;

function stuCounters(items) {
  return `<div class="stu-counters">${items.map(([icon, value, label, tone]) => `<div class="stu-counter ${tone}"><span class="stu-counter-icon">${stuIcon(icon)}</span><div><strong>${value}</strong><span>${label}</span></div></div>`).join('')}</div>`;
}

function stuDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function stuExport(format, headers, rows, fileName, title) {
  if (format === 'csv') {
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    return stuDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
  }
  if (format === 'xlsx') {
    const res = await fetch('/api/admin/view-students/xlsx', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headers, rows, fileName }) });
    if (!res.ok) return showToast('Could not build the Excel file');
    return stuDownload(await res.blob(), `${fileName}.xlsx`);
  }
  const table = `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px;"><thead><tr>${headers.map(h => `<th style="background:#16a34a;color:#fff;text-align:left;">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h3 style="font-family:Arial,sans-serif;">${escapeHtml(title)}</h3>${table}</body></html>`;
  if (format === 'doc') return stuDownload(new Blob(['﻿' + html], { type: 'application/msword' }), `${fileName}.doc`);
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// ── View Students ───────────────────────────────────────────────────────
async function vsInit() {
  const root = document.getElementById('vs-root');
  if (!root) return;
  if (!VS.sessions) {
    try {
      const meta = await apiFetch('/api/admin/enrol/meta');
      VS.sessions = meta.sessions;
      VS.activeSession = meta.activeSession;
    } catch { VS.sessions = []; }
  }
  const classes = (state.setup?.classes || []).filter(c => !c.archived);
  root.innerHTML = `<div class="card"><div class="card-head"><span class="card-title">Select Class to View</span></div><div class="card-body">
      <div class="vs-filters">
        ${enField('Academic Session', `<select class="ctrl-select" id="vs-session">${enrolOptions(VS.sessions, VS.activeSession, 'Select Session')}</select>`, { required: true })}
        ${enField('Class', `<select class="ctrl-select" id="vs-class" onchange="vsClassChanged()"><option value="">Select Class</option><option value="all">All Classes</option>${classes.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('')}<option value="unassigned">Not Assigned to Class yet</option><option value="archived">Archived Students</option></select>`, { required: true })}
        ${enField('Class Arm', '<select class="ctrl-select" id="vs-arm"><option value="">Select Class First</option></select>', { required: true })}
        ${enField('Account Status', '<select class="ctrl-select" id="vs-account"><option value="all">All</option><option value="active">Active</option><option value="deactivated">Deactivated</option></select>', { required: true })}
        <div class="en-field"><label class="field-label">&nbsp;</label><button class="post-btn" onclick="vsLoad(this)">View Students</button></div>
      </div>
    </div></div>
    <div id="vs-results"></div>`;
}

function vsClassChanged() {
  const code = document.getElementById('vs-class').value;
  const sel = document.getElementById('vs-arm');
  if (!code) { sel.innerHTML = '<option value="">Select Class First</option>'; return; }
  const arms = code === 'all' || code === 'unassigned' || code === 'archived' ? [] : (state.setup?.classArms || []).filter(a => a.classCode === code);
  sel.innerHTML = `<option value="all">All</option>${arms.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}${code === 'archived' ? '' : '<option value="unassigned">Not Assigned to Class Arm</option>'}`;
}

async function vsLoad(btn) {
  const session = document.getElementById('vs-session')?.value;
  const classCode = document.getElementById('vs-class')?.value;
  if (!session) return showToast('Choose the academic session');
  if (!classCode) return showToast('Choose the class');
  if (btn) btn.disabled = true;
  try {
    const qs = new URLSearchParams({ session, classCode, arm: document.getElementById('vs-arm').value || 'all', account: document.getElementById('vs-account').value });
    const data = await apiFetch(`/api/admin/view-students?${qs}`);
    VS.rows = data.students;
    VS.isCurrent = data.isCurrent;
    VS.archivedView = classCode === 'archived';
    VS.page = 1;
    VS.selected = new Set();
    VS.loaded = true;
    vsRenderResults();
  } catch (err) { showToast(err.message); } finally { if (btn) btn.disabled = false; }
}

// Re-run the current search after other pages change pupils (keeps the old
// populateStudents() hook working)
function populateStudents() {
  if (VS.loaded && document.getElementById('vs-results')) vsLoad();
}

function vsFiltered() {
  const q = VS.search.toLowerCase();
  return VS.rows.filter(r => {
    if (q && ![r.name, r.regNo, r.id, r.email, r.classLabel, r.classArmName].some(v => String(v || '').toLowerCase().includes(q))) return false;
    return VS.rules.every(rule => {
      const v = String(vsValue(r, rule.field)).toLowerCase();
      const want = String(rule.value || '').toLowerCase();
      switch (rule.op) {
        case 'equals': return v === want;
        case 'starts': return v.startsWith(want);
        case 'not': return !v.includes(want);
        case 'empty': return !v.trim();
        case 'filled': return !!v.trim();
        default: return v.includes(want);
      }
    });
  });
}

function vsRenderResults() {
  const box = document.getElementById('vs-results');
  if (!box) return;
  const rows = VS.rows;
  const count = fn => rows.filter(fn).length;
  box.innerHTML = `<div class="card vs-card"><div class="card-head"><span class="card-title">Students List</span></div><div class="card-body">
    <div class="vs-top">
      ${stuCounters([['users', rows.length, 'Total', 'slate'], ['female', count(r => r.gender === 'F'), 'F', 'pink'], ['male', count(r => r.gender === 'M'), 'M', 'blue'], ['check', count(r => r.active), 'Active', 'green'], ['off', count(r => !r.active), 'Deactivated', 'red']])}
      <div class="vs-top-right">
        <div class="stu-dd"><button class="post-btn btn-sm" onclick="stuToggleDd(this)">+ Add Student &#9662;</button>
          <div class="stu-dd-menu"><button onclick="enrolOpen('enroll')">Add New Student</button><button onclick="enrolOpen('bulk')">Bulk Import Students</button></div></div>
        <div class="vs-viewtoggle"><button class="${VS.view === 'list' ? 'active' : ''}" onclick="VS.view='list'; vsRenderResults()">List Table View</button><button class="${VS.view === 'album' ? 'active' : ''}" onclick="VS.view='album'; vsRenderResults()">Photo Album View</button></div>
      </div>
    </div>
    <div class="vs-toolbar">
      <div class="stu-dd"><button class="btn-outline btn-sm" onclick="stuToggleDd(this)">Action on Selected &#9662;</button>
        <div class="stu-dd-menu">
          <button onclick="vsAction('activate')">Activate Selected Accounts</button>
          <button onclick="vsAction('deactivate')">De-activate Selected Accounts</button>
          ${VS.archivedView ? '<button onclick="vsAction(\'unarchive\')">Restore Selected (Unarchive)</button>' : '<button onclick="vsAction(\'archive\')">Archive Selected Accounts</button>'}
          <button onclick="vsAction('set-session')">Set Active Academic Session</button>
        </div></div>
      <div class="stu-dd"><button class="btn-outline btn-sm" onclick="stuToggleDd(this)">Print / Export List &#9662;</button>
        <div class="stu-dd-menu"><button onclick="vsExportList('print')">Print</button><button onclick="vsExportList('doc')">Word (.doc)</button><button onclick="vsExportList('csv')">CSV</button><button onclick="vsExportList('xlsx')">Excel (.xlsx)</button></div></div>
      <button class="btn-outline btn-sm" onclick="vsAdvancedExport()">Advanced Export</button>
      <button class="btn-outline btn-sm" onclick="vsAdvancedFilter()">Advanced Filter${VS.rules.length ? ` <span class="en-badge">${VS.rules.length} rule${VS.rules.length === 1 ? '' : 's'}</span>` : ''}</button>
    </div>
    <div class="sr-tools">
      <label><select class="ctrl-select" onchange="VS.perPage=Number(this.value); VS.page=1; vsPaint()">${[10, 30, 50, 100, 1000].map(n => `<option value="${n}"${n === VS.perPage ? ' selected' : ''}>${n === 1000 ? 'All' : n}</option>`).join('')}</select> records per page</label>
      <input class="search-input" placeholder="Search" value="${escapeHtml(VS.search)}" oninput="VS.search=this.value; VS.page=1; vsPaint()">
    </div>
    <div id="vs-list"></div>
    <div class="sr-foot"><span id="vs-showing"></span><div class="sr-pages" id="vs-pages"></div></div>
  </div></div>`;
  vsPaint();
}

function vsPaint() {
  const rows = vsFiltered();
  VS.shown = rows;
  const pages = Math.max(1, Math.ceil(rows.length / VS.perPage));
  VS.page = Math.min(VS.page, pages);
  const start = (VS.page - 1) * VS.perPage;
  const page = rows.slice(start, start + VS.perPage);
  const list = document.getElementById('vs-list');
  if (!list) return;
  const parentsText = r => (r.parents || []).map(p => `<div>${escapeHtml(p.name)}${p.relationship ? ` <span class="en-hint">(${escapeHtml(p.relationship)})</span>` : ''}${p.phone ? `<div class="en-hint">${escapeHtml(p.phone)}</div>` : ''}</div>`).join('') || (r.parentEmail ? escapeHtml(r.parentEmail) : '<span class="en-hint">—</span>');
  const classText = r => `${escapeHtml(r.classLabel || r.classCode || '—')}${r.classArmName ? ` / ${escapeHtml(r.classArmName)}` : ''}`;
  if (VS.view === 'album') {
    list.innerHTML = page.length ? `<div class="vs-album">${page.map(r => `<div class="vs-photo-card${VS.selected.has(r.id) ? ' picked' : ''}">
        <label class="vs-photo-check"><input type="checkbox" ${VS.selected.has(r.id) ? 'checked' : ''} onchange="vsPick('${escapeHtml(r.id)}', this.checked); this.closest('.vs-photo-card').classList.toggle('picked', this.checked)"></label>
        <button class="vs-photo" onclick="stuProfile('${escapeHtml(r.id)}')">${r.photoPath ? `<img src="/${escapeHtml(r.photoPath)}" alt="" loading="lazy">` : `<span>${escapeHtml((r.firstName || r.name || '?')[0])}${escapeHtml((r.surname || '')[0] || '')}</span>`}</button>
        <button class="vs-photo-name" onclick="stuProfile('${escapeHtml(r.id)}')">${escapeHtml(r.name)}</button>
        <div class="en-hint">${escapeHtml(r.regNo || r.id)}</div><div class="en-hint">${classText(r)}</div></div>`).join('')}</div>` : '<div class="sr-empty">No data available in table</div>';
  } else {
    list.innerHTML = `<div class="sr-table-wrap"><table class="data-table"><thead><tr><th><input type="checkbox" onchange="vsSelectPage(this.checked)" ${page.length && page.every(r => VS.selected.has(r.id)) ? 'checked' : ''}></th><th>#</th><th>Photo</th><th>Name</th><th>G</th><th>Reg. No.</th><th>Class / Class Arm</th><th>Email</th><th>Account Status</th><th>Parents / Guardian</th><th></th></tr></thead>
      <tbody>${page.length ? page.map((r, i) => `<tr>
        <td><input type="checkbox" ${VS.selected.has(r.id) ? 'checked' : ''} onchange="vsPick('${escapeHtml(r.id)}', this.checked)"></td>
        <td>${start + i + 1}</td>
        <td><button class="stu-photo-link" onclick="stuProfile('${escapeHtml(r.id)}')" title="View profile">${pupilAvatar(r)}</button></td>
        <td><button class="stu-name-link" onclick="stuProfile('${escapeHtml(r.id)}')">${escapeHtml(r.name)}</button></td>
        <td>${escapeHtml(r.gender || '')}</td>
        <td class="stu-mono">${escapeHtml(r.regNo || r.id)}</td>
        <td>${classText(r)}</td>
        <td>${escapeHtml(r.email || '')}</td>
        <td><span class="sr-pill ${r.active ? 'accepted' : 'rejected'}">${r.active ? 'Active' : 'Deactivated'}</span>${r.archived ? ' <span class="sr-pill bypassed">Archived</span>' : ''}</td>
        <td class="stu-parents">${parentsText(r)}</td>
        <td><button class="btn-outline btn-sm" onclick="enrolEdit('${escapeHtml(r.id)}')">Edit</button></td>
      </tr>`).join('') : '<tr><td colspan="11" class="sr-empty">No data available in table</td></tr>'}</tbody></table></div>`;
  }
  document.getElementById('vs-showing').textContent = `Showing ${rows.length ? start + 1 : 0} to ${start + page.length} of ${rows.length} entries${VS.selected.size ? ` · ${VS.selected.size} selected` : ''}`;
  const btn = (label, p, disabled) => `<button class="btn-outline btn-sm" ${disabled ? 'disabled' : ''} onclick="VS.page=${p}; vsPaint()">${label}</button>`;
  document.getElementById('vs-pages').innerHTML = btn('&laquo;', 1, VS.page === 1) + btn('&lsaquo;', VS.page - 1, VS.page === 1) + `<span>${VS.page} / ${pages}</span>` + btn('&rsaquo;', VS.page + 1, VS.page === pages) + btn('&raquo;', pages, VS.page === pages);
}

function vsPick(id, on) {
  if (on) VS.selected.add(id); else VS.selected.delete(id);
  const showing = document.getElementById('vs-showing');
  if (showing) showing.textContent = showing.textContent.replace(/ · \d+ selected$/, '') + (VS.selected.size ? ` · ${VS.selected.size} selected` : '');
}

function vsSelectPage(on) {
  const start = (VS.page - 1) * VS.perPage;
  VS.shown.slice(start, start + VS.perPage).forEach(r => (on ? VS.selected.add(r.id) : VS.selected.delete(r.id)));
  vsPaint();
}

function stuToggleDd(btn) {
  const menu = btn.nextElementSibling;
  const open = !menu.classList.contains('open');
  document.querySelectorAll('.stu-dd-menu.open').forEach(m => m.classList.remove('open'));
  if (open) menu.classList.add('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.stu-dd')) document.querySelectorAll('.stu-dd-menu.open').forEach(m => m.classList.remove('open'));
});

async function vsAction(action) {
  document.querySelectorAll('.stu-dd-menu.open').forEach(m => m.classList.remove('open'));
  if (!VS.selected.size) return showToast('Tick at least one student first');
  const label = { activate: 'activate', deactivate: 'de-activate', archive: 'archive', unarchive: 'restore', 'set-session': 'set the active academic session for' }[action];
  if (!confirm(`${label[0].toUpperCase()}${label.slice(1)} ${VS.selected.size} selected student${VS.selected.size === 1 ? '' : 's'}?`)) return;
  try {
    const data = await apiFetch('/api/admin/view-students/action', { method: 'POST', body: JSON.stringify({ ids: [...VS.selected], action }) });
    if (data.setup) state.setup = data.setup;
    showToast(`${data.updated} student${data.updated === 1 ? '' : 's'} updated`);
    await vsLoad();
  } catch (err) { showToast(err.message); }
}

const VS_LIST_COLS = [['#', null], ['Name', 'name'], ['Gender', 'gender'], ['Reg. No.', 'regNo'], ['Class', 'classLabel'], ['Class Arm', 'classArmName'], ['Email', 'email'], ['Account Status', 'account'], ['Parent / Guardian 1', 'parent1'], ['Parent 1 Phone', 'parent1Phone']];

function vsExportList(format) {
  document.querySelectorAll('.stu-dd-menu.open').forEach(m => m.classList.remove('open'));
  const rows = vsFiltered();
  if (!rows.length) return showToast('There are no students to export');
  stuExport(format, VS_LIST_COLS.map(c => c[0]), rows.map((r, i) => VS_LIST_COLS.map(([, key]) => (key ? vsValue(r, key) : i + 1))), 'students-list', 'Students List');
}

function vsAdvancedExport() {
  if (!VS.rows.length) return showToast('View some students first');
  const modal = document.createElement('div');
  modal.className = 'en-modal';
  modal.style.display = 'flex';
  const defaults = new Set(['regNo', 'name', 'gender', 'dob', 'classLabel', 'classArmName', 'email', 'parent1', 'parent1Phone']);
  modal.innerHTML = `<div class="en-modal-box"><div class="en-modal-head"><span>Advanced Export</span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
    <div class="en-modal-body">
      <div class="en-hint">Choose the columns to include. ${vsFiltered().length} student${vsFiltered().length === 1 ? '' : 's'} (the current list, after search and filters) will be exported.</div>
      <div class="vs-col-actions"><button class="en-link" onclick="this.closest('.en-modal').querySelectorAll('.vs-col').forEach(c => c.checked = true)">Select all</button><button class="en-link" onclick="this.closest('.en-modal').querySelectorAll('.vs-col').forEach(c => c.checked = false)">Select none</button></div>
      <div class="vs-cols">${VS_FIELDS.map(([k, l]) => `<label class="en-check"><input type="checkbox" class="vs-col" value="${k}"${defaults.has(k) ? ' checked' : ''}> ${escapeHtml(l)}</label>`).join('')}</div>
      ${enField('Format', '<select class="ctrl-select" id="vs-ax-format"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="doc">Word (.doc)</option><option value="print">Print</option></select>')}
    </div>
    <div class="en-modal-foot"><button class="btn-outline" onclick="this.closest('.en-modal').remove()">Cancel</button><button class="post-btn" id="vs-ax-go">Export</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#vs-ax-go').onclick = () => {
    const keys = [...modal.querySelectorAll('.vs-col:checked')].map(c => c.value);
    if (!keys.length) return showToast('Choose at least one column');
    const headers = keys.map(k => VS_FIELDS.find(f => f[0] === k)[1]);
    stuExport(modal.querySelector('#vs-ax-format').value, headers, vsFiltered().map(r => keys.map(k => vsValue(r, k))), 'students-export', 'Students');
    modal.remove();
  };
}

function vsAdvancedFilter() {
  const modal = document.createElement('div');
  modal.className = 'en-modal';
  modal.style.display = 'flex';
  const ops = [['contains', 'contains'], ['equals', 'is exactly'], ['starts', 'starts with'], ['not', 'does not contain'], ['empty', 'is empty'], ['filled', 'is not empty']];
  const ruleRow = (r = {}) => `<div class="vs-rule">
      <select class="ctrl-select vs-rule-field">${VS_FIELDS.map(([k, l]) => `<option value="${k}"${r.field === k ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
      <select class="ctrl-select vs-rule-op">${ops.map(([k, l]) => `<option value="${k}"${r.op === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input class="field-input vs-rule-value" placeholder="Value" value="${escapeHtml(r.value || '')}">
      <button class="en-link danger" onclick="this.closest('.vs-rule').remove()">Remove</button></div>`;
  modal.innerHTML = `<div class="en-modal-box wide"><div class="en-modal-head"><span>Advanced Filter</span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
    <div class="en-modal-body"><div class="en-hint">Show only students who match <strong>all</strong> of these rules.</div>
      <div id="vs-rules">${(VS.rules.length ? VS.rules : [{}]).map(ruleRow).join('')}</div>
      <button class="en-link" id="vs-add-rule">+ Add Rule</button></div>
    <div class="en-modal-foot"><button class="btn-outline" id="vs-clear-rules">Clear Rules</button><button class="post-btn" id="vs-apply-rules">Apply</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#vs-add-rule').onclick = () => modal.querySelector('#vs-rules').insertAdjacentHTML('beforeend', ruleRow());
  const done = rules => { VS.rules = rules; VS.page = 1; modal.remove(); vsRenderResults(); };
  modal.querySelector('#vs-clear-rules').onclick = () => done([]);
  modal.querySelector('#vs-apply-rules').onclick = () => done([...modal.querySelectorAll('.vs-rule')].map(row => ({
    field: row.querySelector('.vs-rule-field').value, op: row.querySelector('.vs-rule-op').value, value: row.querySelector('.vs-rule-value').value.trim(),
  })).filter(r => r.value || r.op === 'empty' || r.op === 'filled'));
}

// ── Students Registry ───────────────────────────────────────────────────
function regInit() {
  const root = document.getElementById('reg-root');
  if (!root) return;
  root.innerHTML = `<div class="card"><div class="card-head"><span class="card-title">Student Registry - Historical Records of all Students</span></div><div class="card-body">
    <div class="vs-filters reg-filters">
      ${enField('Enrollment Status', `<select class="ctrl-select" id="reg-status">${enrolOptions([['all', 'All Enrollment Statuses'], ['active', 'Active'], ['left', 'Left / Historical'], ['graduated', 'Graduated']], REG.status, '').replace('<option value=""></option>', '')}</select>`)}
      ${enField('Gender', `<select class="ctrl-select" id="reg-gender">${enrolOptions([['all', 'All Genders'], ['M', 'Male'], ['F', 'Female']], REG.gender, '').replace('<option value=""></option>', '')}</select>`)}
      ${enField('Admission/Enrollment Year', `<input class="field-input" id="reg-year" placeholder="Admission Year" inputmode="numeric" maxlength="4" value="${escapeHtml(REG.year)}">`)}
      <div class="en-field"><label class="field-label">&nbsp;</label><div class="reg-btns"><button class="post-btn" onclick="regApply()">Apply</button><button class="btn-outline" onclick="regClear()">Clear</button></div></div>
    </div>
    <div id="reg-counters"></div>
    <div class="reg-sync"><button class="btn-outline btn-sm" onclick="regSync(this)" title="Pupils in an archived class are marked Left; class history is brought up to date">&#8635; Sync Enrollment Status</button></div>
    <div class="sr-tools">
      <label><select class="ctrl-select" onchange="REG.perPage=Number(this.value); REG.page=1; regPaint()">${[10, 25, 50, 100].map(n => `<option${n === REG.perPage ? ' selected' : ''}>${n}</option>`).join('')}</select> records per page</label>
      <input class="search-input" placeholder="Search" value="${escapeHtml(REG.search)}" oninput="REG.search=this.value; REG.page=1; regPaint()">
    </div>
    <div class="sr-table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Reg. No</th><th>Custom Student ID</th><th>Enrollment Status</th><th>Archived Status</th><th>Gender</th><th>Date of Birth</th><th>Date Enrolled</th><th></th></tr></thead><tbody id="reg-tbody"><tr><td colspan="10" class="sr-empty">Loading…</td></tr></tbody></table></div>
    <div class="sr-foot"><span id="reg-showing"></span><div class="sr-pages" id="reg-pages"></div></div>
  </div></div>`;
  regLoad();
}

function regApply() {
  REG.status = document.getElementById('reg-status').value;
  REG.gender = document.getElementById('reg-gender').value;
  REG.year = document.getElementById('reg-year').value.trim();
  REG.page = 1;
  regLoad();
}

function regClear() {
  Object.assign(REG, { status: 'all', gender: 'all', year: '', search: '', page: 1 });
  regInit();
}

async function regLoad() {
  try {
    const qs = new URLSearchParams({ status: REG.status, gender: REG.gender, year: REG.year });
    const data = await apiFetch(`/api/admin/registry?${qs}`);
    REG.rows = data.students;
    const c = data.counts;
    document.getElementById('reg-counters').innerHTML = stuCounters([['users', c.total, 'Total', 'slate'], ['check', c.active, 'Active', 'green'], ['history', c.left, 'Left / Historical', 'amber'], ['check', c.graduated, 'Graduated', 'blue'], ['male', c.male, 'Male', 'blue'], ['female', c.female, 'Female', 'pink']]);
    regPaint();
  } catch (err) { showToast(err.message); }
}

function regPaint() {
  const q = REG.search.toLowerCase();
  const rows = REG.rows.filter(r => !q || [r.name, r.regNo, r.id].some(v => String(v || '').toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(rows.length / REG.perPage));
  REG.page = Math.min(REG.page, pages);
  const start = (REG.page - 1) * REG.perPage;
  const page = rows.slice(start, start + REG.perPage);
  const statusLabel = s => ({ active: 'Active', left: 'Left / Historical', graduated: 'Graduated' }[s] || s || '—');
  const statusTone = s => ({ active: 'accepted', left: 'pending', graduated: 'bypassed' }[s] || '');
  document.getElementById('reg-tbody').innerHTML = page.length ? page.map((r, i) => `<tr>
      <td>${start + i + 1}</td>
      <td><button class="stu-name-link" onclick="stuProfile('${escapeHtml(r.id)}')">${escapeHtml(r.name)}</button></td>
      <td class="stu-mono">${escapeHtml(r.regNo || '')}</td>
      <td class="stu-mono">${escapeHtml(r.id)}</td>
      <td><span class="sr-pill ${statusTone(r.status)}">${statusLabel(r.status)}</span></td>
      <td>${r.archived ? 'Archived' : 'Not Archived'}</td>
      <td>${r.gender === 'M' ? 'Male' : r.gender === 'F' ? 'Female' : ''}</td>
      <td>${stuDate(r.dob)}</td>
      <td>${stuDate(r.enrolledOn)}</td>
      <td><button class="en-link" onclick="stuClassHistory('${escapeHtml(r.id)}', '${escapeHtml(r.name).replace(/'/g, '&#39;')}')">${stuIcon('history')} Class History</button></td>
    </tr>`).join('') : '<tr><td colspan="10" class="sr-empty">No data available in table</td></tr>';
  document.getElementById('reg-showing').textContent = `Showing ${rows.length ? start + 1 : 0} to ${start + page.length} of ${rows.length} entries`;
  const btn = (label, p, disabled) => `<button class="btn-outline btn-sm" ${disabled ? 'disabled' : ''} onclick="REG.page=${p}; regPaint()">${label}</button>`;
  document.getElementById('reg-pages').innerHTML = btn('&laquo;', 1, REG.page === 1) + btn('&lsaquo;', REG.page - 1, REG.page === 1) + `<span>${REG.page} / ${pages}</span>` + btn('&rsaquo;', REG.page + 1, REG.page === pages) + btn('&raquo;', pages, REG.page === pages);
}

async function regSync(btn) {
  btn.disabled = true;
  try {
    const data = await apiFetch('/api/admin/registry/sync', { method: 'POST', body: '{}' });
    showToast(data.updated ? `${data.updated} enrollment status${data.updated === 1 ? '' : 'es'} updated` : 'Enrollment statuses are already up to date');
    await regLoad();
  } catch (err) { showToast(err.message); } finally { btn.disabled = false; }
}

async function stuClassHistory(id, name) {
  try {
    const { history } = await apiFetch(`/api/admin/registry/history?id=${encodeURIComponent(id)}`);
    const modal = document.createElement('div');
    modal.className = 'en-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="en-modal-box"><div class="en-modal-head"><span>Student Class History | ${escapeHtml(name)}</span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
      <div class="en-modal-body"><table class="data-table"><thead><tr><th>Session</th><th>Class Arm</th><th>Form Teacher</th></tr></thead><tbody>
        ${history.length ? history.map(h => `<tr><td>${escapeHtml(String(h.session).replace('/', '-'))}</td><td>${escapeHtml(h.classText)}</td><td>${escapeHtml(h.formTeacher || '')}</td></tr>`).join('') : '<tr><td colspan="3" class="sr-empty">No class history recorded yet</td></tr>'}
      </tbody></table></div>
      <div class="en-modal-foot"><button class="btn-outline" onclick="this.closest('.en-modal').remove()">Close</button></div></div>`;
    document.body.appendChild(modal);
  } catch (err) { showToast(err.message); }
}

// ── Student Information card ────────────────────────────────────────────
// Opened by clicking a pupil's name or photo (View Students, Students
// Registry). Mirrors SchoolsFocus's Student Information pop-up.
let STU_CARD = null; // last loaded profile data

function stuAge(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const born = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
  if (now.getDate() < born.getDate()) months -= 1;
  if (months < 0) return '';
  return `${Math.floor(months / 12)}yrs, ${months % 12}m`;
}

function stuWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '');
}

function stuModal(id, title, body, foot = '', wide = true) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.className = 'en-modal';
  modal.id = id;
  modal.style.display = 'flex';
  modal.innerHTML = `<div class="en-modal-box${wide ? ' wide' : ''}"><div class="en-modal-head"><span>${title}</span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
    <div class="en-modal-body">${body}</div>
    <div class="en-modal-foot">${foot}<button class="btn-outline" onclick="this.closest('.en-modal').remove()">Close</button></div></div>`;
  document.body.appendChild(modal);
  return modal;
}

const STU_ICON_MAIL = '<svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><polyline points="2.5 4.5 8 8.5 13.5 4.5"/></svg>';

async function stuProfile(id) {
  try {
    STU_CARD = await apiFetch(`/api/admin/view-students/profile?id=${encodeURIComponent(id)}`);
  } catch (err) { return showToast(err.message); }
  const { student: s, groups, tags, tagIds, family, school } = STU_CARD;
  const name = [s.surname, s.firstName, s.otherNames].filter(Boolean).join(' ').toUpperCase();
  const row = (label, value) => `<tr><td>${escapeHtml(label)}</td><td>${value}</td></tr>`;
  const txt = v => escapeHtml(v || '') || '<span class="en-hint">—</span>';
  const btn = (label, onclick, icon = 'history') => `<button class="stu-mini-btn" onclick="${onclick}">${stuIcon(icon)} ${label}</button>`;
  const tagNames = tags.filter(t => tagIds.includes(t.id)).map(t => `<span class="en-badge">${escapeHtml(t.name)}</span>`).join(' ');
  const registered = s.enrolledAt ? `On : ${escapeHtml(stuWhen(s.enrolledAt))}${s.registeredByName ? `<br>By : ${escapeHtml(s.registeredByName.toUpperCase())} (${escapeHtml(s.registeredByRole === 'admin' ? 'Admin' : s.registeredByRole || '')})` : ''}` : '<span class="en-hint">—</span>';
  const contact = c => c && (c.name || c.phone) ? [c.name, c.relationship && `(${c.relationship})`, c.phone, c.email].filter(Boolean).map(escapeHtml).join(' · ') : '';
  const more = [
    ['Contact Phone', s.phone], ['N.ID / Birth Cert. No.', s.nin], ['Blood Group', s.bloodGroup], ['Genotype', s.genotype],
    ['Province/State (of Origin)', s.state], ['ZIP/LGA (of Origin)', s.lga], ['Town (of Origin)', s.town],
    ['Residential / Contact Address', s.residentialAddress], ['Permanent / Home Town Address', s.permanentAddress],
    ['Enrolled Session', s.session], ['Roll No', s.rollNo], ['Bio / Remark', s.bio],
    ['Next of Kin', contact(s.nextOfKin)], ['Emergency Contact', contact(s.emergency)],
  ].filter(([, v]) => v);
  const parents = family?.parents || [];
  const body = `
    <div class="stu-letterhead">
      <div class="stu-lh-name">${escapeHtml(String(school.name || '').toUpperCase())}</div>
      <div>${escapeHtml(String(school.address || '').toUpperCase())}</div>
      <div>Email: ${escapeHtml(school.email || '')} &nbsp; Tel: ${escapeHtml(school.phone || '')}</div>
      <div class="stu-lh-refs"><span>Our Ref.: _____________________</span><span>Your Ref.: ____________________</span></div>
      <div class="stu-lh-title">Student Profile</div>
    </div>
    <div class="stu-card">
      <div class="stu-card-banner"></div>
      <div class="stu-card-photo">${s.photoPath ? `<img src="/${escapeHtml(s.photoPath)}" alt="">` : `<span>${escapeHtml((s.firstName || '?')[0] + (s.surname || '')[0])}</span>`}</div>
      <div class="stu-card-name">${escapeHtml(name)}</div>
      <span class="stu-card-badge">Student</span>
      <div class="stu-card-icons">${s.studentEmail ? `<a href="mailto:${escapeHtml(s.studentEmail)}" title="Email ${escapeHtml(s.studentEmail)}">${STU_ICON_MAIL}</a>` : ''}</div>
    </div>
    <div class="stu-card-go"><button class="post-btn" onclick="stuGoToProfile('${escapeHtml(s.id)}')">Go to profile page &rarr;</button></div>
    <div class="stu-sec">Student Biodata</div>
    <table class="stu-info"><tbody>
      ${row('Surname', txt(s.surname))}${row('First Name', txt(s.firstName))}${row('Other Names', txt(s.otherNames))}
      ${row('Gender', txt(s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : ''))}${row('Date of Birth', txt(stuDate(s.dob)))}
      ${row('Age', txt(stuAge(s.dob)))}${row('Email', txt(s.studentEmail))}${row('Nationality', txt(s.nationality))}${row('Religion', txt(String(s.religion || '').toUpperCase()))}
    </tbody></table>
    <div class="stu-sec">Academic Information</div>
    <table class="stu-info"><tbody>
      ${row('Adm. / Reg. No.', txt(s.regNo))}
      ${row('Current Class Category', txt(String(s.category || '').toUpperCase()))}
      ${row('Current Class', `${txt(String(s.classLabel || '').toUpperCase())}<div>${btn('Class History', `stuClassHistory('${escapeHtml(s.id)}', '${escapeHtml(name).replace(/'/g, '&#39;')}')`)}</div>`)}
      ${row('Current Class Arm', txt(String(s.armName || '').toUpperCase()))}
      ${row('Current Activity Groups', `${groups.length ? groups.map(g => escapeHtml(g.name)).join(', ') : '<span class="en-hint">—</span>'}<div>${btn('Activity Group History', 'stuGroupHistory()')}</div>`)}
      ${row('Tags', `${tagNames ? `<div class="stu-tags">${tagNames}</div>` : ''}<div>${btn('Update Student Tags', 'stuTagsModal()', 'check')}</div>`)}
      ${row('Admission Date', txt(stuDate(s.admissionDate)))}
      ${row('Date Registered in Portal', registered)}
      ${row('Account Status', `<button type="button" class="rsp-toggle ${s.active ? 'on' : 'off'}" id="stu-acc-toggle" onclick="stuToggleAccount('${escapeHtml(s.id)}', this)"><span>${s.active ? 'ON' : 'OFF'}</span></button>`)}
      ${row('Fees', btn('Fees &amp; Payment History', `crcFees('${escapeHtml(s.id)}')`, 'users'))}
      ${row('Results', btn('Academic Results History', 'stuResultsHistory()', 'check'))}
    </tbody></table>
    <div class="stu-sec">More Details</div>
    ${more.length ? `<table class="stu-info"><tbody>${more.map(([l, v]) => row(l, escapeHtml(v))).join('')}</tbody></table>` : ''}
    <div class="stu-sec">Parents / Guardian</div>
    <div class="stu-parents-list">${parents.length ? parents.map(p => `<div class="stu-parent">
        <button class="stu-name-link" onclick="familyCard()">${escapeHtml([p.title, p.fullName].filter(Boolean).join(' ').toUpperCase())}</button>
        ${p.relationship ? `<span class="en-hint">(${escapeHtml(p.relationship)})</span>` : ''}
        <div class="stu-card-icons">${p.email ? `<a href="mailto:${escapeHtml(p.email)}" title="Email ${escapeHtml(p.email)}">${STU_ICON_MAIL}</a>` : ''}${p.phone ? `<span class="en-hint">${escapeHtml(p.phone)}</span>` : ''}</div>
      </div>`).join('') : '<span class="en-hint">No family linked yet — open the profile page to choose or create one.</span>'}</div>
    <div class="stu-card-foot"><button class="post-btn" onclick="stuGoToProfile('${escapeHtml(s.id)}')">Go to profile page &rarr;</button><button class="btn-outline" onclick="stuPrintCard()">Print</button></div>`;
  stuModal('stu-card-modal', 'Student Information', body, '', false);
}

function stuGoToProfile(id) {
  document.querySelectorAll('.en-modal').forEach(m => m.remove());
  enrolEdit(id);
}

async function stuToggleAccount(id, btn) {
  const turnOn = btn.classList.contains('off');
  try {
    await apiFetch('/api/admin/view-students/action', { method: 'POST', body: JSON.stringify({ ids: [id], action: turnOn ? 'activate' : 'deactivate' }) });
    btn.className = `rsp-toggle ${turnOn ? 'on' : 'off'}`;
    btn.firstElementChild.textContent = turnOn ? 'ON' : 'OFF';
    const row = VS.rows.find(r => r.id === id);
    if (row) { row.active = turnOn; if (document.getElementById('vs-list')) vsRenderResults(); }
    showToast(turnOn ? 'Account activated' : 'Account deactivated');
  } catch (err) { showToast(err.message); }
}

function stuGroupHistory() {
  const { student: s, groups } = STU_CARD;
  stuModal('stu-groups-modal', `Activity Group History | ${escapeHtml(s.firstName)} ${escapeHtml(s.surname)}`,
    `<table class="data-table"><thead><tr><th>Activity Group</th><th>Joined</th></tr></thead><tbody>
      ${groups.length ? groups.map(g => `<tr><td>${escapeHtml(g.name)}</td><td>${escapeHtml(stuDate(String(g.joinedAt || '').slice(0, 10)))}</td></tr>`).join('') : '<tr><td colspan="2" class="sr-empty">Not in any extracurricular group yet</td></tr>'}
    </tbody></table>`, '', false);
}

function stuTagsModal() {
  const { student: s, tags, tagIds } = STU_CARD;
  const modal = stuModal('stu-tags-modal', `Update Student Tags | ${escapeHtml(s.firstName)} ${escapeHtml(s.surname)}`,
    tags.length ? `<div class="stu-tag-pick">${tags.map(t => `<label class="en-tag"><input type="checkbox" value="${t.id}"${tagIds.includes(t.id) ? ' checked' : ''}> ${escapeHtml(t.name)}</label>`).join('')}</div>`
      : '<div class="sr-empty">No tags yet. Create tags under People → Students → Student Tags.</div>',
    tags.length ? '<button class="post-btn" id="stu-tags-save">Save Tags</button>' : '', false);
  modal.querySelector('#stu-tags-save')?.addEventListener('click', async e => {
    const ids = [...modal.querySelectorAll('input:checked')].map(i => Number(i.value));
    e.target.disabled = true;
    try {
      await apiFetch('/api/admin/view-students/tags', { method: 'POST', body: JSON.stringify({ id: s.id, tags: ids }) });
      modal.remove();
      showToast('Tags updated');
      stuProfile(s.id);
    } catch (err) { showToast(err.message); e.target.disabled = false; }
  });
}

function stuResultsHistory() {
  const { student: s, results } = STU_CARD;
  stuModal('stu-results-modal', `Academic Results History | ${escapeHtml(s.firstName)} ${escapeHtml(s.surname)}`,
    `<table class="data-table"><thead><tr><th>Session</th><th>Term</th><th>Exam</th><th>Class</th><th>Published</th><th></th></tr></thead><tbody>
      ${results.length ? results.map(r => `<tr><td>${escapeHtml(String(r.session).replace('/', '-'))}</td><td>${escapeHtml(r.term)}</td><td>${escapeHtml(r.examType)}</td><td>${escapeHtml(r.classLabel || '')}</td><td>${escapeHtml(stuDate(String(r.publishedAt || '').slice(0, 10)))}</td>
        <td><button class="btn-outline btn-sm" onclick="window.open('/api/admin/reports/${r.id}/pdf', '_blank')">View Result</button></td></tr>`).join('') : '<tr><td colspan="6" class="sr-empty">No published results yet</td></tr>'}
    </tbody></table>`);
}

function stuPrintCard() {
  const card = document.querySelector('#stu-card-modal .en-modal-body');
  if (!card) return;
  const css = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>Student Profile</title>${css}<style>body{background:#fff;padding:24px;font-family:'DM Sans',sans-serif}.stu-letterhead{display:block!important}.stu-card-go,.stu-card-foot,.stu-mini-btn,.rsp-toggle{display:none!important}</style></head><body>${card.innerHTML}<script>setTimeout(() => window.print(), 400);<\/script></body></html>`);
  win.document.close();
}

// ── Family card (parent name in the Student Information card) ──
function familyCard() {
  const fam = STU_CARD?.family;
  if (!fam) return;
  const activeWards = fam.wards.filter(w => w.active).length;
  const wards = fam.wards.map(w => `<div class="fam-ward">
      <div class="fam-ward-top"><div class="fam-ward-photo">${w.photoPath ? `<img src="/${escapeHtml(w.photoPath)}" alt="">` : `<span>${escapeHtml(w.initials || '')}</span>`}</div>
        <div class="fam-ward-name">${escapeHtml(String(w.name).toUpperCase())} <span class="en-hint">(${escapeHtml(w.gender || '')})</span></div></div>
      <div class="fam-ward-grid"><div><span>Class</span><strong>${escapeHtml(String(w.classLabel || '').toUpperCase())}</strong></div><div><span>Class Arm</span><strong>${escapeHtml(String(w.armName || '—').toUpperCase())}</strong></div><div><span>Reg. No</span><strong>${escapeHtml(w.regNo || '')}</strong></div></div>
      <div class="fam-ward-actions"><button class="en-link" onclick="stuClassHistory('${escapeHtml(w.id)}', '${escapeHtml(w.name).replace(/'/g, '&#39;')}')">Class History</button><button class="en-link" onclick="document.getElementById('fam-modal').remove(); stuProfile('${escapeHtml(w.id)}')">View Profile</button></div>
    </div>`).join('');
  const parents = fam.parents.map(p => `<div class="fam-parent">
      <div class="stu-card"><div class="stu-card-banner"></div><div class="stu-card-photo"><span>${escapeHtml((p.fullName || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join(''))}</span></div>
        <div class="stu-card-name">${escapeHtml(String([p.title, p.fullName].filter(Boolean).join(' ')).toUpperCase())}</div><span class="stu-card-badge">Parent</span>
        <div class="stu-card-icons">${p.email ? `<a href="mailto:${escapeHtml(p.email)}">${STU_ICON_MAIL}</a>` : ''}</div></div>
      <table class="stu-info"><tbody>
        <tr><td>Name</td><td>${escapeHtml(String(p.fullName).toUpperCase())}</td></tr>
        <tr><td>Relationship with Ward(s)</td><td>${escapeHtml(p.relationship || '—')}</td></tr>
        <tr><td>Occupation / Profession</td><td>${escapeHtml(String(p.occupation || '').toUpperCase() || '—')}</td></tr>
        <tr><td>Email</td><td>${escapeHtml(p.email || '—')}</td></tr>
        <tr><td>Phone</td><td>${escapeHtml(p.phone || '—')}</td></tr>
        <tr><td>Address</td><td>${escapeHtml(String(p.address || '').toUpperCase() || '—')}</td></tr>
      </tbody></table></div>`).join('');
  stuModal('fam-modal', escapeHtml(fam.name), `
    <div class="fam-manage"><button class="btn-outline btn-sm" onclick="familyManageFromCard()">Manage Family Members</button></div>
    <div class="fam-head">Wards <span class="en-badge">${activeWards}</span> / <span class="en-badge">${fam.wards.length}</span></div>
    <div class="fam-wards">${wards}</div>
    <div class="fam-head">Parents <span class="en-badge">${fam.parents.length}</span></div>
    <div class="fam-parents">${parents}</div>`);
}

async function familyManageFromCard() {
  const fam = STU_CARD?.family;
  if (!fam) return;
  try { await enrolLoadMeta(); } catch (err) { return showToast(err.message); }
  familyModalOpen('manage', fam.id);
}

// After Manage Family saves, reload the open cards
async function familyCardRefresh() {
  if (!STU_CARD?.student) return;
  const famOpen = !!document.getElementById('fam-modal');
  await stuProfile(STU_CARD.student.id);
  if (famOpen) familyCard();
}
