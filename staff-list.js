// Staff / Employees list — filters, type cards, selection, paging, sorting,
// exports (DOC/CSV/XLS/XLSX + Advanced Export), Advanced Filter, Bulk Import
// and Staff Designations. Modelled on the SchoolsFocus staff list, in this
// site's own style. Uses helpers from admin-api.js (state, apiFetch,
// escapeHtml, showToast, staffCategory, staffAssignments, accountStatusToggle…).

// A value for inline click code: a JS string literal, made safe for the HTML attribute, so names with
// apostrophes (O'Brien) or crafted text can't end the string and run as code
function jsArg(value) {
  return JSON.stringify(String(value ?? '')).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}


const SL_TYPES = [
  'Teacher', 'Accountant/Bursary Officer', 'Librarian', 'Registrar', 'Transport Manager',
  'Hostel Manager', 'Store Manager', 'General Staff / Others',
];
const SL_CARD_STYLE = {
  Teacher: 'teacher', 'Accountant/Bursary Officer': 'accountant', Librarian: 'librarian', Registrar: 'registrar',
  'Transport Manager': 'transport', 'Hostel Manager': 'hostel', 'Store Manager': 'store', 'General Staff / Others': 'general',
};
const slView = {
  type: 'All Staff', employment: 'Active', archive: 'Not Archived', account: 'All',
  search: '', sort: { key: 'name', dir: 1 }, page: 1, perPage: 30,
  selected: new Set(), rules: [],
};

// ── Field catalogue (Advanced Export + Advanced Filter) ──
function slAge(dob) {
  const d = dob ? new Date(dob) : null;
  if (!d || isNaN(d)) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
  return String(age);
}
function slNameParts(s) {
  const parts = String(s.name || '').split(/\s+/).filter(Boolean);
  // a record saved with no surname keeps its own first / other names
  const structured = !!s.surname || (!!s.firstName && [s.firstName, s.otherNames].filter(Boolean).join(' ') === s.name);
  return {
    first: structured ? s.firstName : parts[0] || '',
    surname: structured ? s.surname || '' : (parts.length > 1 ? parts[parts.length - 1] : ''),
    other: structured ? s.otherNames || '' : parts.slice(1, -1).join(' '),
  };
}
const SL_FIELDS = [
  { key: 'sn', label: 'S/N', group: 'Extras', exportOnly: true },
  { key: 'age', label: 'Age (calculated from date of birth)', group: 'Extras', get: s => slAge(s.dob) },
  { key: 'staffTypeLabel', label: 'Staff Role / Type', group: 'Extras', get: s => staffCategory(s) },
  { key: 'title', label: 'Title', group: 'Staff Bio Data' },
  { key: 'initials', label: 'Initials', group: 'Staff Bio Data' },
  { key: 'name', label: 'Full Name', group: 'Staff Bio Data' },
  { key: 'surname', label: 'Surname', group: 'Staff Bio Data', get: s => slNameParts(s).surname },
  { key: 'firstName', label: 'First Name', group: 'Staff Bio Data', get: s => slNameParts(s).first },
  { key: 'otherNames', label: 'Other Names', group: 'Staff Bio Data', get: s => slNameParts(s).other },
  { key: 'gender', label: 'Gender', group: 'Staff Bio Data' },
  { key: 'phone', label: 'Phone', group: 'Staff Bio Data' },
  { key: 'email', label: 'Email', group: 'Staff Bio Data' },
  { key: 'dob', label: 'Date of Birth', group: 'Personal Information', date: true },
  { key: 'religion', label: 'Religion', group: 'Personal Information' },
  { key: 'bloodGroup', label: 'Blood Group', group: 'Personal Information' },
  { key: 'genotype', label: 'Genotype', group: 'Personal Information' },
  { key: 'nationality', label: 'Nationality', group: 'Personal Information' },
  { key: 'stateOfOrigin', label: 'State', group: 'Personal Information' },
  { key: 'lga', label: 'Locality / LGA', group: 'Personal Information' },
  { key: 'town', label: 'Town', group: 'Personal Information' },
  { key: 'address', label: 'Address', group: 'Personal Information' },
  { key: 'permanentAddress', label: 'Permanent Address', group: 'Personal Information' },
  { key: 'id', label: 'Staff No.', group: 'Employment Information' },
  { key: 'designation', label: 'Designation', group: 'Employment Information', get: s => s.designation || s.roleLabel || '' },
  { key: 'department', label: 'Department', group: 'Employment Information' },
  { key: 'areaOfWork', label: 'Area of Work', group: 'Employment Information' },
  { key: 'qualifications', label: 'Qualification', group: 'Employment Information' },
  { key: 'teacherType', label: 'Teacher Type', group: 'Employment Information', get: s => (s.teacherType === 'class_teacher' ? 'Class Teacher' : s.teacherType === 'subject_teacher' ? 'Subject Teacher' : '') },
  { key: 'assignments', label: 'Classes / Subjects', group: 'Employment Information', get: s => (s.role === 'teacher' ? staffAssignments(s) : '') },
  { key: 'accountStatus', label: 'Account Status', group: 'Employment Information', get: s => (s.canSignIn === false ? 'No login' : s.active ? 'Active' : 'Deactivated') },
  { key: 'dateOfAppointment', label: 'Date of Appointment', group: 'Lifecycle', date: true },
  { key: 'dateStarted', label: 'Date of Starting', group: 'Lifecycle', date: true },
  { key: 'dateOfLeaving', label: 'Date of Leaving', group: 'Lifecycle', date: true },
  { key: 'reasonForLeaving', label: 'Reason for Leaving', group: 'Lifecycle' },
  { key: 'employmentStatus', label: 'Employment Status', group: 'Lifecycle' },
  { key: 'archived', label: 'Archived', group: 'Lifecycle', get: s => (s.archived ? 'Yes' : 'No') },
  { key: 'canSignIn', label: 'Portal Login', group: 'Account & IDs', get: s => (s.canSignIn === false ? 'No' : 'Yes') },
  { key: 'nokName', label: 'Next of Kin Name', group: 'Next of Kin' },
  { key: 'nokRelationship', label: 'Next of Kin Relationship', group: 'Next of Kin' },
  { key: 'nokPhone', label: 'Next of Kin Phone', group: 'Next of Kin' },
  { key: 'nokEmail', label: 'Next of Kin Email', group: 'Next of Kin' },
  { key: 'nokAddress', label: 'Next of Kin Address', group: 'Next of Kin' },
  { key: 'emergencyName', label: 'Emergency Contact Name', group: 'Emergency Contact' },
  { key: 'emergencyRelationship', label: 'Emergency Contact Relationship', group: 'Emergency Contact' },
  { key: 'emergencyPhone', label: 'Emergency Contact Phone', group: 'Emergency Contact' },
  { key: 'emergencyEmail', label: 'Emergency Contact Email', group: 'Emergency Contact' },
  { key: 'emergencyAddress', label: 'Emergency Contact Address', group: 'Emergency Contact' },
];
const SL_FIELD = Object.fromEntries(SL_FIELDS.map(f => [f.key, f]));
function slValue(staff, key) {
  const field = SL_FIELD[key];
  if (!field) return '';
  return String((field.get ? field.get(staff) : staff[key]) ?? '');
}

// ── Which staff are showing ──
function slMatchesFilters(s, ignoreType) {
  if (!ignoreType && slView.type !== 'All Staff' && staffCategory(s) !== slView.type) return false;
  const employment = s.employmentStatus || 'Active';
  if (slView.employment === 'Active' && employment !== 'Active') return false;
  if (slView.employment === 'Not Active' && employment === 'Active') return false;
  if (!['All', 'Active', 'Not Active'].includes(slView.employment) && employment !== slView.employment) return false;
  if (slView.archive === 'Not Archived' && s.archived) return false;
  if (slView.archive === 'Archived' && !s.archived) return false;
  if (slView.account === 'Active' && !(s.canSignIn !== false && s.active)) return false;
  if (slView.account === 'Deactivated' && !(s.canSignIn !== false && !s.active)) return false;
  return slView.rules.every(rule => slRuleMatches(s, rule));
}

function slRuleMatches(staff, rule) {
  if (!rule.field || !rule.op) return true;
  const value = slValue(staff, rule.field).trim().toLowerCase();
  const target = String(rule.value || '').trim().toLowerCase();
  switch (rule.op) {
    case 'contains': return value.includes(target);
    case 'not_contains': return !value.includes(target);
    case 'equals': return value === target;
    case 'not_equals': return value !== target;
    case 'starts': return value.startsWith(target);
    case 'empty': return !value;
    case 'not_empty': return !!value;
    case 'before': return !!value && value < target;
    case 'after': return !!value && value > target;
    case 'gt': return value !== '' && Number(value) > Number(target);
    case 'lt': return value !== '' && Number(value) < Number(target);
    default: return true;
  }
}

function slSortValue(s, key) {
  if (key === 'name') return String(s.name || '').toLowerCase();
  if (key === 'designation') return slValue(s, 'designation').toLowerCase();
  if (key === 'phone') return String(s.phone || '');
  return slValue(s, key).toLowerCase();
}

function slVisibleRows() {
  const q = slView.search.trim().toLowerCase();
  return (state.setup.staff || [])
    .filter(s => slMatchesFilters(s))
    .filter(s => !q || `${s.name} ${s.id} ${s.email || ''} ${s.phone || ''} ${slValue(s, 'designation')} ${staffCategory(s)} ${staffAssignments(s)}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const av = slSortValue(a, slView.sort.key);
      const bv = slSortValue(b, slView.sort.key);
      // blanks always last
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av.localeCompare(bv, undefined, { numeric: true }) * slView.sort.dir;
    });
}

// ── Rendering ──
// Some older records have an email or full name saved as "initials";
// those (and titles like "MR.") fall back to letters from the name.
function slInitials(s) {
  const saved = String(s.initials || '').trim();
  if (/^[A-Za-z]{1,3}$/.test(saved)) return saved.toUpperCase();
  const words = String(s.name || '').split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, ''))
    .filter(w => w && !/^(mr|mrs|miss|ms|dr|prof|rev|engr|chief|barrister|alhaji|alhaja)$/i.test(w));
  const letters = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2));
  return letters.toUpperCase();
}

function slAvatar(s) {
  if (s.photoPath) return `<img class="sl-avatar" src="/${escapeHtml(s.photoPath)}" alt="">`;
  return `<span class="sl-avatar sl-avatar-initials">${escapeHtml(slInitials(s))}</span>`;
}

function slRenderCards() {
  const wrap = document.getElementById('sl-cards');
  if (!wrap) return;
  const pool = (state.setup.staff || []).filter(s => slMatchesFilters(s, true));
  const counts = { 'All Staff': pool.length };
  pool.forEach(s => { const c = staffCategory(s); counts[c] = (counts[c] || 0) + 1; });
  wrap.innerHTML = ['All Staff', ...SL_TYPES].map(type => `
    <button type="button" class="staff-summary-card ${type === 'All Staff' ? '' : SL_CARD_STYLE[type]} ${slView.type === type ? 'active' : ''}" onclick="slSetType(${jsArg(type)})" title="Show ${escapeHtml(type)}">
      <span class="staff-summary-icon">${staffFilterIcon(type)}</span>
      <div><div class="staff-summary-count">${counts[type] || 0}</div><div class="staff-summary-label">${escapeHtml(type).replace(/\//g, '/<wbr>')}</div></div>
    </button>`).join('');
}

function populateStaff() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;
  // forget ticks for staff that no longer exist
  const ids = new Set((state.setup.staff || []).map(s => s.id));
  [...slView.selected].forEach(id => { if (!ids.has(id)) slView.selected.delete(id); });
  slRenderCards();
  const rows = slVisibleRows();
  const perPage = slView.perPage || rows.length || 1;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  slView.page = Math.min(Math.max(1, slView.page), pages);
  const start = (slView.page - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);
  tbody.innerHTML = pageRows.length ? pageRows.map((staff, i) => {
    const category = staffCategory(staff);
    const typeLabel = category === 'Teacher' ? 'Teacher' : category === 'General Staff / Others' ? (staff.role === 'admin' ? 'Admin' : 'Staff') : category.replace('Accountant/Bursary Officer', 'Accountant');
    const designation = slValue(staff, 'designation') || (staff.role === 'admin' ? 'Administrator' : 'Staff');
    const badges = [
      staff.role === 'admin' ? `<span class="staff-main-pill">${staffLevelLabel(staff)}</span>` : '',
      staff.archived ? '<span class="sl-badge sl-badge-muted">Archived</span>' : '',
      (staff.employmentStatus || 'Active') !== 'Active' ? `<span class="sl-badge sl-badge-warn">${escapeHtml(staff.employmentStatus)}</span>` : '',
    ].join('');
    return `<tr class="${slView.selected.has(staff.id) ? 'sl-row-selected' : ''}">
      <td class="sl-check"><input type="checkbox" aria-label="Select ${escapeHtml(staff.name)}" ${slView.selected.has(staff.id) ? 'checked' : ''} onchange="slToggleOne(${jsArg(staff.id)}, this.checked)"></td>
      <td class="staff-index">${start + i + 1}</td>
      <td>
        <div class="sl-name-cell">${slAvatar(staff)}<div>
          <div class="staff-table-name">${escapeHtml(staff.name)}</div>
          <div class="staff-table-sub">${escapeHtml(staff.email || staff.id)}</div>
          ${badges}
        </div></div>
      </td>
      <td><span class="staff-type-pill">${escapeHtml(typeLabel)}</span></td>
      <td><div class="staff-designation">${escapeHtml(designation)}</div></td>
      <td class="staff-phone">${escapeHtml(staff.phone || '-')}</td>
      <td><button class="staff-profile-btn" title="Open staff profile" onclick="openStaffProfile(${jsArg(staff.id)})">...</button></td>
      <td>${staff.canSignIn === false ? '<span class="staff-table-sub">No login</span>' : staff.id === state.user.id ? '<span class="staff-status-on">ON</span>' : canManageAccount(staff) ? accountStatusToggle(staff.id, staff.active) : `<span class="${staff.active ? 'staff-status-on' : 'staff-table-sub'}" title="Only a higher admin can change this account">${staff.active ? 'ON' : 'OFF'}</span>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="sl-empty">No staff match these filters.</td></tr>';

  const all = document.getElementById('sl-check-all');
  if (all) {
    const onPage = pageRows.filter(s => slView.selected.has(s.id)).length;
    all.checked = pageRows.length > 0 && onPage === pageRows.length;
    all.indeterminate = onPage > 0 && onPage < pageRows.length;
  }
  document.querySelectorAll('#tab-staff th.sl-sort').forEach(th => {
    th.classList.toggle('asc', th.dataset.sort === slView.sort.key && slView.sort.dir === 1);
    th.classList.toggle('desc', th.dataset.sort === slView.sort.key && slView.sort.dir === -1);
  });
  const info = document.getElementById('sl-info');
  if (info) info.textContent = rows.length
    ? `Showing ${start + 1} to ${start + pageRows.length} of ${rows.length} entries${slView.selected.size ? ` · ${slView.selected.size} selected` : ''}`
    : 'Showing 0 entries';
  slRenderPages(pages);
  slRenderRuleBanner();
}

function slRenderPages(pages) {
  const el = document.getElementById('sl-pages');
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ''; return; }
  const p = slView.page;
  const nums = [...new Set([1, p - 1, p, p + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button type="button" ${p === 1 ? 'disabled' : ''} onclick="slGoPage(${p - 1})" aria-label="Previous page">&lsaquo;</button>`;
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) html += '<span class="sl-gap">…</span>';
    html += `<button type="button" class="${n === p ? 'active' : ''}" onclick="slGoPage(${n})">${n}</button>`;
  });
  html += `<button type="button" ${p === pages ? 'disabled' : ''} onclick="slGoPage(${p + 1})" aria-label="Next page">&rsaquo;</button>`;
  el.innerHTML = html;
}

function slRenderRuleBanner() {
  const banner = document.getElementById('sl-adv-banner');
  const badge = document.getElementById('sl-adv-count');
  const n = slView.rules.filter(r => r.field && r.op).length;
  if (badge) badge.textContent = n ? ` (${n})` : '';
  if (!banner) return;
  banner.hidden = !n;
  banner.innerHTML = n ? `Advanced filter on: ${slView.rules.filter(r => r.field && r.op).map(r => escapeHtml(slRuleText(r))).join(' · ')} <button type="button" class="sf-add-new" onclick="slClearRules()">Clear</button>` : '';
}

// ── Controls ──
function slFillFilterSelects() {
  const type = document.getElementById('sl-f-type');
  if (type && !type.options.length) {
    type.innerHTML = ['All Staff', ...SL_TYPES].map(t => `<option>${escapeHtml(t)}</option>`).join('');
  }
  if (type) type.value = slView.type;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('sl-f-employment', slView.employment);
  set('sl-f-archive', slView.archive);
  set('sl-f-account', slView.account);
}

function slApplyFilters() {
  slView.type = document.getElementById('sl-f-type').value;
  slView.employment = document.getElementById('sl-f-employment').value;
  slView.archive = document.getElementById('sl-f-archive').value;
  slView.account = document.getElementById('sl-f-account').value;
  slView.page = 1;
  populateStaff();
}

function slSetType(type) {
  slView.type = type;
  slView.page = 1;
  slFillFilterSelects();
  populateStaff();
}

function filterStaff() { // search box
  slView.search = document.getElementById('staff-search')?.value || '';
  slView.page = 1;
  populateStaff();
}

function slSetPerPage(value) {
  slView.perPage = value === 'All' ? 0 : Number(value) || 30;
  slView.page = 1;
  populateStaff();
}

function slGoPage(page) {
  slView.page = page;
  populateStaff();
  document.querySelector('#tab-staff .staff-table')?.scrollIntoView({ block: 'nearest' });
}

function slSort(key) {
  slView.sort = { key, dir: slView.sort.key === key ? -slView.sort.dir : 1 };
  populateStaff();
}

function slToggleOne(id, on) {
  if (on) slView.selected.add(id); else slView.selected.delete(id);
  populateStaff();
}

function slToggleAll(on) {
  const rows = slVisibleRows();
  const perPage = slView.perPage || rows.length;
  rows.slice((slView.page - 1) * perPage, slView.page * perPage).forEach(s => { if (on) slView.selected.add(s.id); else slView.selected.delete(s.id); });
  populateStaff();
}

function slToggleMenu(id, event) {
  event?.stopPropagation();
  document.querySelectorAll('.sl-menu').forEach(m => { if (m.id !== id) m.hidden = true; });
  const menu = document.getElementById(id);
  if (menu) menu.hidden = !menu.hidden;
}
document.addEventListener('click', event => {
  if (!event.target.closest('.sl-menu-wrap')) document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
});

async function slBulk(action) {
  document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
  const ids = [...slView.selected];
  if (!ids.length) return showToast('Tick at least one staff member first');
  const words = { activate: 'Activate', deactivate: 'Deactivate', archive: 'Archive', restore: 'Restore' };
  const extra = action === 'archive' ? ' Archived staff are hidden from the list and their portal login is switched off.' : action === 'deactivate' ? ' They will be signed out and unable to sign in.' : '';
  if (!await uiConfirm(`${words[action]} ${ids.length} selected staff?${extra}`, { confirmLabel: words[action], danger: action === 'archive' || action === 'deactivate' })) return;
  try {
    const data = await apiFetch('/api/admin/staff/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
    state.setup = data.setup;
    slView.selected.clear();
    populateStaff();
    populateAdminControls();
    showToast(`${data.done} staff ${({ activate: 'activated', deactivate: 'deactivated', archive: 'archived', restore: 'restored' })[action]}`, 'success');
    if (data.skipped?.length) await uiNotice('Some staff were skipped', data.skipped.join('\n'));
  } catch (err) {
    showToast(err.message);
  }
}

function slOpenSelfRegistration() {
  const nav = document.querySelector('.sub-nav-item[data-tab="selfRegistration"]');
  switchTab('selfRegistration', nav);
  if (typeof sregOpen === 'function') sregOpen('staff');
}

// ── Exports ──
function slDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slFormatDate(value, format) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const [y, m, d] = value.slice(0, 10).split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return { 'd-Mon-YYYY': `${d}-${mon}-${y}`, 'DD/MM/YYYY': `${d}/${m}/${y}`, 'MM/DD/YYYY': `${m}/${d}/${y}` }[format] || `${y}-${m}-${d}`;
}

// columns: [{ key, label }]; returns { headers, rows }
function slTable(staffRows, columns, dateFormat) {
  return {
    headers: columns.map(c => c.label),
    rows: staffRows.map((s, i) => columns.map(c => {
      if (c.key === 'sn') return String(i + 1);
      const v = slValue(s, c.key);
      return SL_FIELD[c.key]?.date ? slFormatDate(v, dateFormat) : v;
    })),
  };
}

async function slExport(format, table, baseName = 'staff-employees') {
  document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
  if (!table.rows.length) return showToast('There are no staff to export');
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (format === 'csv') {
    const csv = [table.headers, ...table.rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    return slDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`);
  }
  if (format === 'xls' || format === 'doc') {
    // Excel and Word both open an HTML table saved with these extensions
    const html = `<html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt}th,td{border:1px solid #bfbfbf;padding:4px 6px;vertical-align:top}th{background:#1f497d;color:#fff}</style></head><body>${format === 'doc' ? `<h3>Staff / Employees</h3>` : ''}<table><thead><tr>${table.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    const type = format === 'xls' ? 'application/vnd.ms-excel' : 'application/msword';
    return slDownload(new Blob(['﻿' + html], { type }), `${baseName}.${format}`);
  }
  try {
    const res = await fetch('/api/admin/staff/export.xlsx', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers: table.headers, rows: table.rows, sheetName: 'Staff' }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
    slDownload(await res.blob(), `${baseName}.xlsx`);
  } catch (err) {
    showToast(err.message);
  }
}

// Export List ▾ — the list as it is filtered now
function exportStaffList(format = 'csv') {
  const columns = ['sn', 'name', 'id', 'staffTypeLabel', 'designation', 'phone', 'email', 'assignments', 'employmentStatus', 'accountStatus']
    .map(key => ({ key, label: key === 'id' ? 'Staff ID' : SL_FIELD[key].label }));
  slExport(format, slTable(slVisibleRows(), columns, 'd-Mon-YYYY'));
}

// ── Advanced Export (3 steps) ──
const AE_KEY = 'staffExportTemplates';
const ae = { step: 1, type: 'All Staff', fields: ['sn', 'name', 'staffTypeLabel', 'designation', 'phone', 'email'], labels: {}, sorts: [{ key: 'name', dir: 1 }], dateFormat: 'd-Mon-YYYY' };

function aeTemplates() {
  try { return JSON.parse(localStorage.getItem(AE_KEY) || '{}'); } catch { return {}; }
}
function aeSaveTemplates(all) {
  try { localStorage.setItem(AE_KEY, JSON.stringify(all)); } catch { /* storage blocked: templates just won't persist */ }
}

function aeRows() {
  const rows = (state.setup.staff || []).filter(s => slMatchesFilters(s, true) && (ae.type === 'All Staff' || staffCategory(s) === ae.type));
  return rows.sort((a, b) => {
    for (const sort of ae.sorts) {
      const c = slSortValue(a, sort.key).localeCompare(slSortValue(b, sort.key), undefined, { numeric: true }) * sort.dir;
      if (c) return c;
    }
    return 0;
  });
}

function openAdvancedExport() {
  ae.step = 1;
  ae.type = slView.type;
  slShowModal('ae-modal');
  aeRender();
}

function aeGoTo(step) {
  if (step > 1 && !ae.fields.length) return showToast('Tick at least one field to export');
  ae.step = step;
  aeRender();
}

function aeRender() {
  const modal = document.getElementById('ae-modal');
  modal.querySelectorAll('.sf-steps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === ae.step);
    li.classList.toggle('done', n < ae.step);
  });
  modal.querySelectorAll('.sf-step').forEach(s => s.classList.toggle('active', Number(s.dataset.step) === ae.step));
  document.getElementById('ae-back').style.visibility = ae.step === 1 ? 'hidden' : '';
  document.getElementById('ae-next').style.display = ae.step === 3 ? 'none' : '';
  document.getElementById('ae-export').style.display = ae.step === 3 ? '' : 'none';
  const count = aeRows().length;
  document.getElementById('ae-count').textContent = `${count} staff record${count === 1 ? '' : 's'} will be exported`;
  if (ae.step === 1) aeRenderFields();
  if (ae.step === 2) aeRenderOrder();
  if (ae.step === 3) aeRenderSave();
}

function aeRenderFields() {
  const typeSel = document.getElementById('ae-type');
  typeSel.innerHTML = ['All Staff', ...SL_TYPES].map(t => `<option ${t === ae.type ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const fieldOpts = sel => SL_FIELDS.filter(f => !f.exportOnly).map(f => `<option value="${f.key}" ${f.key === sel ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
  document.getElementById('ae-sorts').innerHTML = ae.sorts.map((s, i) => `
    <div class="ae-sort-row"><span class="sf-hint">${i ? 'then by' : 'Sort by'}</span>
      <select class="ctrl-select" onchange="ae.sorts[${i}].key=this.value;aeRender()">${fieldOpts(s.key)}</select>
      <select class="ctrl-select ae-dir" onchange="ae.sorts[${i}].dir=Number(this.value);aeRender()"><option value="1" ${s.dir === 1 ? 'selected' : ''}>A → Z</option><option value="-1" ${s.dir === -1 ? 'selected' : ''}>Z → A</option></select>
      ${i ? `<button type="button" class="staff-profile-close" onclick="ae.sorts.splice(${i},1);aeRender()" aria-label="Remove sort level">&times;</button>` : ''}
    </div>`).join('');
  document.getElementById('ae-add-sort').style.display = ae.sorts.length >= 3 ? 'none' : '';
  document.getElementById('ae-date').value = ae.dateFormat;
  const templates = aeTemplates();
  document.getElementById('ae-template').innerHTML = '<option value="">— Choose a template —</option>' + Object.keys(templates).sort().map(n => `<option>${escapeHtml(n)}</option>`).join('');
  const q = (document.getElementById('ae-field-search').value || '').toLowerCase();
  const groups = [...new Set(SL_FIELDS.map(f => f.group))];
  document.getElementById('ae-fields').innerHTML = groups.map(group => {
    const fields = SL_FIELDS.filter(f => f.group === group && (!q || f.label.toLowerCase().includes(q)));
    if (!fields.length) return '';
    const allOn = fields.every(f => ae.fields.includes(f.key));
    return `<div class="ae-group"><label class="ae-group-title"><input type="checkbox" ${allOn ? 'checked' : ''} onchange="aeToggleGroup(${jsArg(group)}, this.checked)"> ${escapeHtml(group)}</label>
      <div class="ae-group-fields">${fields.map(f => `<label class="sf-check"><input type="checkbox" ${ae.fields.includes(f.key) ? 'checked' : ''} onchange="aeToggleField(${jsArg(f.key)}, this.checked)"> ${escapeHtml(f.label)}</label>`).join('')}</div></div>`;
  }).join('') || '<p class="sf-hint">No fields match.</p>';
}

function aeToggleField(key, on) {
  ae.fields = ae.fields.filter(k => k !== key);
  if (on) ae.fields.push(key);
  aeRender();
}
function aeToggleGroup(group, on) {
  SL_FIELDS.filter(f => f.group === group).forEach(f => {
    ae.fields = ae.fields.filter(k => k !== f.key);
    if (on) ae.fields.push(f.key);
  });
  aeRender();
}
function aeSelectAll(on) {
  ae.fields = on ? SL_FIELDS.map(f => f.key) : [];
  aeRender();
}

function aeApplyTemplate() {
  const name = document.getElementById('ae-template').value;
  const t = aeTemplates()[name];
  if (!t) return showToast('Choose a saved template first');
  Object.assign(ae, JSON.parse(JSON.stringify({ fields: t.fields, labels: t.labels || {}, sorts: t.sorts || [{ key: 'name', dir: 1 }], dateFormat: t.dateFormat || 'd-Mon-YYYY' })));
  ae.fields = ae.fields.filter(k => SL_FIELD[k]);
  aeRender();
  showToast(`Template “${name}” applied`, 'success');
}
async function aeDeleteTemplate() {
  const name = document.getElementById('ae-template').value;
  if (!name) return showToast('Choose a saved template first');
  if (!await uiConfirm(`Delete export template “${name}”?`)) return;
  const all = aeTemplates();
  delete all[name];
  aeSaveTemplates(all);
  aeRender();
}

function aeRenderOrder() {
  document.getElementById('ae-order').innerHTML = ae.fields.map((key, i) => `
    <div class="ae-order-row">
      <span class="ae-order-n">${i + 1}</span>
      <span class="ae-order-name">${escapeHtml(SL_FIELD[key].label)}</span>
      <input class="field-input" value="${escapeHtml(ae.labels[key] || SL_FIELD[key].label)}" aria-label="Column heading for ${escapeHtml(SL_FIELD[key].label)}" oninput="ae.labels[${jsArg(key)}]=this.value">
      <button type="button" class="btn-outline" ${i === 0 ? 'disabled' : ''} onclick="aeMove(${i},-1)" aria-label="Move up">&uarr;</button>
      <button type="button" class="btn-outline" ${i === ae.fields.length - 1 ? 'disabled' : ''} onclick="aeMove(${i},1)" aria-label="Move down">&darr;</button>
    </div>`).join('');
}
function aeMove(i, delta) {
  const j = i + delta;
  [ae.fields[i], ae.fields[j]] = [ae.fields[j], ae.fields[i]];
  aeRenderOrder();
}

function aeRenderSave() {
  document.getElementById('ae-summary').textContent = `${ae.fields.length} column${ae.fields.length === 1 ? '' : 's'}: ${ae.fields.map(k => ae.labels[k] || SL_FIELD[k].label).join(', ')}`;
}

function aeSaveTemplate() {
  const name = document.getElementById('ae-template-name').value.trim();
  if (!name) return showToast('Type a name for the template');
  const all = aeTemplates();
  all[name] = { fields: ae.fields, labels: ae.labels, sorts: ae.sorts, dateFormat: ae.dateFormat };
  aeSaveTemplates(all);
  showToast(`Template “${name}” saved`, 'success');
}

function aeExport() {
  const columns = ae.fields.map(key => ({ key, label: (ae.labels[key] || SL_FIELD[key].label).trim() || SL_FIELD[key].label }));
  const file = (document.getElementById('ae-file').value.trim() || 'staff-export').replace(/[^\w\- ]+/g, '').trim() || 'staff-export';
  slExport(document.getElementById('ae-format').value, slTable(aeRows(), columns, ae.dateFormat), file);
}

// ── Advanced Filter ──
const AF_KEY = 'staffFilterPresets';
let afDraft = [];
const AF_OPS = [
  ['contains', 'contains'], ['not_contains', 'does not contain'], ['equals', 'is'], ['not_equals', 'is not'],
  ['starts', 'starts with'], ['empty', 'is empty'], ['not_empty', 'is not empty'],
  ['before', 'is before (date)'], ['after', 'is after (date)'], ['gt', 'is more than'], ['lt', 'is less than'],
];
function slRuleText(r) {
  const op = AF_OPS.find(([k]) => k === r.op)?.[1] || r.op;
  return `${SL_FIELD[r.field]?.label || r.field} ${op}${['empty', 'not_empty'].includes(r.op) ? '' : ` “${r.value || ''}”`}`;
}
function afPresets() {
  try { return JSON.parse(localStorage.getItem(AF_KEY) || '{}'); } catch { return {}; }
}

function openAdvancedFilter() {
  afDraft = slView.rules.length ? JSON.parse(JSON.stringify(slView.rules)) : [{ field: '', op: 'contains', value: '' }];
  slShowModal('af-modal');
  afRender();
}

function afRender() {
  const fieldOpts = sel => '<option value="">Select field…</option>' + SL_FIELDS.filter(f => !f.exportOnly).map(f => `<option value="${f.key}" ${f.key === sel ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
  document.getElementById('af-rules').innerHTML = afDraft.map((r, i) => {
    const date = SL_FIELD[r.field]?.date;
    return `<div class="af-rule">
      <select class="ctrl-select" onchange="afDraft[${i}].field=this.value;afRender()">${fieldOpts(r.field)}</select>
      <select class="ctrl-select" onchange="afDraft[${i}].op=this.value;afRender()">${AF_OPS.map(([k, l]) => `<option value="${k}" ${k === r.op ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input class="field-input" ${['empty', 'not_empty'].includes(r.op) ? 'disabled placeholder="—"' : ''} type="${date && ['before', 'after'].includes(r.op) ? 'date' : 'text'}" value="${escapeHtml(r.value || '')}" placeholder="Value" oninput="afDraft[${i}].value=this.value">
      <button type="button" class="staff-profile-close" onclick="afDraft.splice(${i},1);if(!afDraft.length)afDraft.push({field:'',op:'contains',value:''});afRender()" aria-label="Remove rule">&times;</button>
    </div>`;
  }).join('');
  const presets = afPresets();
  document.getElementById('af-preset').innerHTML = '<option value="">Load a saved preset…</option>' + Object.keys(presets).sort().map(n => `<option>${escapeHtml(n)}</option>`).join('');
  document.getElementById('af-preview').textContent = '';
}

function afAddRule() {
  afDraft.push({ field: '', op: 'contains', value: '' });
  afRender();
}
function afLoadPreset(name) {
  const p = afPresets()[name];
  if (!p) return;
  afDraft = JSON.parse(JSON.stringify(p));
  afRender();
}
function afSavePreset() {
  const name = document.getElementById('af-preset-name').value.trim();
  const rules = afDraft.filter(r => r.field && r.op);
  if (!name) return showToast('Type a name for the preset');
  if (!rules.length) return showToast('Add at least one rule first');
  const all = afPresets();
  all[name] = rules;
  try { localStorage.setItem(AF_KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
  afRender();
  showToast(`Preset “${name}” saved`, 'success');
}
function afPreviewCount() {
  const saved = slView.rules;
  slView.rules = afDraft.filter(r => r.field && r.op);
  const n = slVisibleRows().length;
  slView.rules = saved;
  document.getElementById('af-preview').textContent = `${n} staff match`;
}
function afClear() {
  afDraft = [{ field: '', op: 'contains', value: '' }];
  afRender();
}
function afApply() {
  slView.rules = afDraft.filter(r => r.field && r.op);
  slView.page = 1;
  slCloseModal('af-modal');
  populateStaff();
}
function slClearRules() {
  slView.rules = [];
  slView.page = 1;
  populateStaff();
}

// ── Bulk Import ──
function openStaffImport() {
  document.getElementById('si-file').value = '';
  document.getElementById('si-password').value = '';
  document.getElementById('si-file-name').textContent = 'No file chosen';
  document.getElementById('si-result').innerHTML = '';
  document.getElementById('si-form').hidden = false;
  slShowModal('si-modal');
}

async function siImport() {
  const file = document.getElementById('si-file').files?.[0];
  if (!file) return showToast('Choose the filled-in staff spreadsheet first');
  if (!/\.xlsx$/i.test(file.name)) return showToast('Use the .xlsx template (save it as Excel Workbook)');
  const button = document.getElementById('si-import');
  button.disabled = true;
  try {
    const fileDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
    const data = await apiFetch('/api/admin/staff/import', {
      method: 'POST',
      body: JSON.stringify({ fileDataUrl, defaultPassword: document.getElementById('si-password').value.trim() }),
    });
    state.setup = data.setup;
    populateStaff();
    populateAdminControls();
    siShowResult(data);
  } catch (err) {
    showToast(err.message);
  } finally {
    button.disabled = false;
  }
}

let siLastCreated = [];
function siShowResult(data) {
  siLastCreated = data.created || [];
  const withPasswords = siLastCreated.some(c => c.password);
  document.getElementById('si-form').hidden = true;
  document.getElementById('si-result').innerHTML = `
    <div class="si-summary"><strong>${siLastCreated.length}</strong> staff added${data.errors?.length ? ` · <strong>${data.errors.length}</strong> row${data.errors.length === 1 ? '' : 's'} not imported` : ''}</div>
    ${siLastCreated.length ? `<table class="staff-table si-table"><thead><tr><th>Row</th><th>Name</th><th>Type</th><th>Staff ID</th>${withPasswords ? '<th>Password</th>' : ''}</tr></thead><tbody>
      ${siLastCreated.map(c => `<tr><td>${c.row}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.type || '')}</td><td>${escapeHtml(c.id)}</td>${withPasswords ? `<td>${escapeHtml(c.password || '—')}</td>` : ''}</tr>`).join('')}</tbody></table>` : ''}
    ${withPasswords ? '<p class="sf-note">These generated passwords are shown only now. Download the list before closing.</p>' : ''}
    ${data.errors?.length ? `<h3 class="sf-section-title">Rows not imported</h3><ul class="si-errors">${data.errors.map(e => `<li>Row ${e.row}: ${escapeHtml(e.message)}</li>`).join('')}</ul>` : ''}
    <div class="sf-foot si-result-foot">
      ${siLastCreated.length ? '<button type="button" class="btn-outline" onclick="siDownloadResult()">Download list (CSV)</button>' : ''}
      <button type="button" class="post-btn" onclick="openStaffImport()">Import another file</button>
    </div>`;
}
function siDownloadResult() {
  slExport('csv', { headers: ['Row', 'Name', 'Type', 'Staff ID', 'Password'], rows: siLastCreated.map(c => [c.row, c.name, c.type || '', c.id, c.password || '']) }, 'imported-staff');
}

// ── Staff Designations ──
let sdEditing = null;
function openDesignations() {
  sdEditing = null;
  document.getElementById('sd-search').value = '';
  document.getElementById('sd-new').value = '';
  slShowModal('sd-modal');
  sdRender();
}
function sdRender() {
  const q = document.getElementById('sd-search').value.trim().toLowerCase();
  const rows = (state.setup.staffDesignationRows || []).filter(r => !q || r.name.toLowerCase().includes(q));
  document.getElementById('sd-tbody').innerHTML = rows.length ? rows.map((r, i) => sdEditing === r.id
    ? `<tr><td>${i + 1}</td><td colspan="2"><input class="field-input" id="sd-edit-input" value="${escapeHtml(r.name)}" onkeydown="if(event.key==='Enter')sdSaveEdit(${r.id})"></td>
        <td class="sd-actions"><button type="button" class="post-btn" onclick="sdSaveEdit(${r.id})">Save</button><button type="button" class="btn-outline" onclick="sdEditing=null;sdRender()">Cancel</button></td></tr>`
    : `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="sf-hint">${r.staffCount ? `${r.staffCount} staff` : ''}</td>
        <td class="sd-actions"><button type="button" class="btn-outline" onclick="sdEditing=${r.id};sdRender();document.getElementById('sd-edit-input')?.focus()">Edit</button><button type="button" class="del-btn" onclick="sdDelete(${r.id})">Delete</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="sl-empty">No designations yet.</td></tr>';
}
async function sdAdd() {
  const name = document.getElementById('sd-new').value.trim();
  if (!name) return showToast('Type the designation name');
  try {
    await apiFetch('/api/admin/staff-designations', { method: 'POST', body: JSON.stringify({ name }) });
    await loadResultSetup();
    document.getElementById('sd-new').value = '';
    sdRender();
    showToast('Designation added', 'success');
  } catch (err) { showToast(err.message); }
}
async function sdSaveEdit(id) {
  const name = document.getElementById('sd-edit-input').value.trim();
  try {
    const data = await apiFetch(`/api/admin/staff-designations/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    state.setup = data.setup;
    sdEditing = null;
    sdRender();
    populateStaff();
    showToast('Designation renamed', 'success');
  } catch (err) { showToast(err.message); }
}
async function sdDelete(id) {
  const row = (state.setup.staffDesignationRows || []).find(r => r.id === id);
  if (!row) return;
  const note = row.staffCount ? ` ${row.staffCount} staff keep it on their record, but it won't be offered in the list any more.` : '';
  if (!await uiConfirm(`Delete designation “${row.name}”?${note}`)) return;
  try {
    const data = await apiFetch(`/api/admin/staff-designations/${id}`, { method: 'DELETE' });
    state.setup = data.setup;
    sdRender();
    showToast('Designation deleted', 'success');
  } catch (err) { showToast(err.message); }
}

// ── Shared pop-up open/close ──
function slShowModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}
function slCloseModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('.ui-dialog-overlay')) return;
  ['ae-modal', 'af-modal', 'si-modal', 'sd-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m && m.style.display !== 'none') slCloseModal(id);
  });
});

document.addEventListener('DOMContentLoaded', slFillFilterSelects);
if (document.readyState !== 'loading') slFillFilterSelects();
