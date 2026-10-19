// People › Parents: Guardian / Parents and Families pages, modelled on the
// SchoolsFocus Parents and Families pages, in this site's own style.
// Parent records only (parents don't sign in). Uses helpers from
// admin-api.js and staff-list.js (apiFetch, escapeHtml, showToast,
// slExport, slToggleMenu, uiConfirm, stuProfile, stuClassHistory…).

const PF_RELATIONS = ['Father', 'Mother', 'Stepfather', 'Stepmother', 'Guardian', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Brother', 'Sister', 'Spouse', 'Sponsor', 'Other'];
const PF_TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Rev', 'Engr', 'Chief', 'Barrister', 'Alhaji', 'Alhaja'];
let pfParents = null;
let pfFamilies = null;
const plView = { type: 'all', search: '', page: 1, perPage: 10, sortDir: 1, rules: [] };
const fmView = { filter: 'all', search: '', page: 1, perPage: 10, rules: [], selected: new Set() };

const pfName = p => [p.title, p.fullName].filter(Boolean).join(' ');
const pfRelation = p => (p.relationship === 'Other' && p.relationshipOther) ? p.relationshipOther : p.relationship;
const pfInitials = name => {
  const words = String(name || '').split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w && !/^(mr|mrs|miss|ms|dr|prof|rev|engr|chief|barrister|alhaji|alhaja)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};
const pfActive = w => (w.status || 'active') === 'active';
const pfStatusPill = w => pfActive(w) ? '<span class="pf-pill pf-pill-in">In</span>' : `<span class="pf-pill pf-pill-out">${escapeHtml(w.status === 'graduated' ? 'Graduated' : 'Left')}</span>`;

async function pfLoad(force) {
  const [p, f] = await Promise.all([
    force || !pfParents ? apiFetch('/api/admin/parents/list') : { parents: pfParents },
    force || !pfFamilies ? apiFetch('/api/admin/families/list') : { families: pfFamilies },
  ]);
  pfParents = p.parents;
  pfFamilies = f.families;
}

// admin-api.js calls this after any setup reload; refresh only if a page is showing
function populateParents() {
  pfParents = null;
  pfFamilies = null;
  if (document.getElementById('tab-parents')?.classList.contains('active')) plInit();
  if (document.getElementById('tab-families')?.classList.contains('active')) fmInit();
}

async function pfRefresh() {
  await pfLoad(true);
  if (document.getElementById('tab-parents')?.classList.contains('active')) plRender();
  if (document.getElementById('tab-families')?.classList.contains('active')) fmRender();
}

// ── Shared: paging + rule filters ──
function pfPages(elId, view, pages, rerender) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ''; return; }
  const p = view.page;
  const nums = [...new Set([1, p - 1, p, p + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button type="button" ${p === 1 ? 'disabled' : ''} data-page="${p - 1}" aria-label="Previous page">&lsaquo;</button>`;
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) html += '<span class="sl-gap">…</span>';
    html += `<button type="button" class="${n === p ? 'active' : ''}" data-page="${n}">${n}</button>`;
  });
  html += `<button type="button" ${p === pages ? 'disabled' : ''} data-page="${p + 1}" aria-label="Next page">&rsaquo;</button>`;
  el.innerHTML = html;
  el.querySelectorAll('button[data-page]').forEach(b => b.addEventListener('click', () => { view.page = Number(b.dataset.page); rerender(); }));
}

const PF_RULE_OPS = [['contains', 'contains'], ['not_contains', 'does not contain'], ['equals', 'is'], ['not_equals', 'is not'], ['empty', 'is empty'], ['not_empty', 'is not empty'], ['gt', 'is more than'], ['lt', 'is less than']];
const PF_FIELDS = {
  parents: [
    ['name', 'Guardian\'s Name', p => pfName(p)], ['email', 'Email', p => p.email], ['phone', 'Phone', p => p.phone],
    ['relationship', 'Relationship', p => pfRelation(p)], ['occupation', 'Occupation', p => p.occupation], ['address', 'Address', p => p.address],
    ['family', 'Family', p => p.families.map(f => f.name).join(', ')], ['wards', 'Ward names', p => p.wards.map(w => w.name).join(', ')],
    ['wardCount', 'Number of wards', p => String(p.wards.length)],
  ],
  families: [
    ['name', 'Family name', f => f.name], ['parents', 'Parent names', f => f.parents.map(pfName).join(', ')],
    ['emails', 'Parent emails', f => f.parents.map(p => p.email).filter(Boolean).join(', ')], ['phones', 'Parent phones', f => f.parents.map(p => p.phone).filter(Boolean).join(', ')],
    ['wards', 'Ward names', f => f.wards.map(w => w.name).join(', ')], ['classes', 'Ward classes', f => f.wards.map(w => w.classLabel).join(', ')],
    ['wardCount', 'Number of wards', f => String(f.wards.length)], ['activeCount', 'Number of active wards', f => String(f.wards.filter(pfActive).length)],
  ],
};
function pfRuleMatches(row, rule, page) {
  const field = PF_FIELDS[page].find(f => f[0] === rule.field);
  if (!field) return true;
  const v = String(field[2](row) || '').toLowerCase();
  const t = String(rule.value || '').toLowerCase().trim();
  return {
    contains: () => v.includes(t), not_contains: () => !v.includes(t), equals: () => v === t, not_equals: () => v !== t,
    empty: () => !v, not_empty: () => !!v, gt: () => v !== '' && Number(v) > Number(t), lt: () => v !== '' && Number(v) < Number(t),
  }[rule.op]?.() ?? true;
}
function pfRuleText(rule, page) {
  const label = PF_FIELDS[page].find(f => f[0] === rule.field)?.[1] || rule.field;
  const op = PF_RULE_OPS.find(o => o[0] === rule.op)?.[1] || rule.op;
  return `${label} ${op}${['empty', 'not_empty'].includes(rule.op) ? '' : ` “${rule.value || ''}”`}`;
}
function pfRuleBanner(page) {
  const view = page === 'parents' ? plView : fmView;
  const prefix = page === 'parents' ? 'pl' : 'fm';
  const banner = document.getElementById(`${prefix}-rule-banner`);
  document.getElementById(`${prefix}-rule-count`).textContent = view.rules.length ? ` (${view.rules.length})` : '';
  banner.hidden = !view.rules.length;
  banner.innerHTML = view.rules.length ? `Advanced filter on: ${view.rules.map(r => escapeHtml(pfRuleText(r, page))).join(' · ')} <button type="button" class="sf-add-new" onclick="${prefix}View.rules=[];${prefix}View.page=1;${page === 'parents' ? 'plRender' : 'fmRender'}()">Clear</button>` : '';
}

// ── Guardian / Parents page ──
async function plInit() {
  try { await pfLoad(); } catch (err) { showToast(err.message); return; }
  plRender();
}
function plRows() {
  const q = plView.search.trim().toLowerCase();
  return (pfParents || [])
    .filter(p => plView.type !== 'nofamily' || !p.families.length)
    .filter(p => !q || `${pfName(p)} ${p.email} ${p.phone} ${pfRelation(p)} ${p.families.map(f => f.name).join(' ')} ${p.wards.map(w => w.name).join(' ')}`.toLowerCase().includes(q))
    .filter(p => plView.rules.every(r => pfRuleMatches(p, r, 'parents')))
    .sort((a, b) => a.fullName.localeCompare(b.fullName) * plView.sortDir);
}
function plSort() { plView.sortDir = -plView.sortDir; plRender(); }
function plRender() {
  const rows = plRows();
  const perPage = plView.perPage || rows.length || 1;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  plView.page = Math.min(Math.max(1, plView.page), pages);
  const start = (plView.page - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);
  document.getElementById('pl-tbody').innerHTML = pageRows.length ? pageRows.map((p, i) => `
    <tr>
      <td class="staff-index">${start + i + 1}</td>
      <td><span class="sl-avatar sl-avatar-initials">${escapeHtml(pfInitials(p.fullName))}</span></td>
      <td><div class="staff-table-name">${escapeHtml(pfName(p))}</div>
        ${p.families.length ? `<div class="staff-table-sub">${escapeHtml(p.families.map(f => f.name).join(', '))}</div>` : '<span class="pf-pill pf-pill-warn">No Family</span>'}</td>
      <td>${escapeHtml(p.email || '-')}</td>
      <td class="staff-phone">${escapeHtml(p.phone || '-')}</td>
      <td>${escapeHtml(pfRelation(p) || '-')}</td>
      <td>${p.wards.length ? p.wards.map(w => `<div class="pf-ward-line">${escapeHtml(w.name)} <span class="staff-table-sub">${escapeHtml(w.classLabel)}</span></div>`).join('') : '<span class="staff-table-sub">—</span>'}</td>
      <td class="pf-actions"><button class="staff-profile-btn" title="Open parent profile" onclick="openParentProfile(${p.id})">...</button>
        ${p.families.length ? '' : `<button type="button" class="sf-add-new" onclick="openCreateFamily(${p.id})">Create Family</button>`}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="sl-empty">No parents match.</td></tr>';
  document.getElementById('pl-info').textContent = rows.length ? `Showing ${start + 1} to ${start + pageRows.length} of ${rows.length} entries` : 'Showing 0 entries';
  pfPages('pl-pages', plView, pages, plRender);
  pfRuleBanner('parents');
}
function plExport(format) {
  const rows = plRows();
  slExport(format, {
    headers: ['S/N', "Guardian's Name", 'Email', 'Phone', 'Relationship', 'Occupation', 'Address', 'Family', 'Ward(s)'],
    rows: rows.map((p, i) => [i + 1, pfName(p), p.email, p.phone, pfRelation(p), p.occupation, p.address, p.families.map(f => f.name).join(', '), p.wards.map(w => `${w.name} (${w.classLabel})`).join(', ')]),
  }, 'guardians-parents');
}

// ── Families page ──
async function fmInit() {
  try { await pfLoad(); } catch (err) { showToast(err.message); return; }
  fmRender();
}
function fmRows() {
  const q = fmView.search.trim().toLowerCase();
  const tests = {
    all: () => true,
    active: f => f.wards.some(pfActive),
    someLeft: f => f.wards.some(w => !pfActive(w)),
    allLeft: f => f.wards.length > 0 && f.wards.every(w => !pfActive(w)),
    allActive: f => f.wards.length > 0 && f.wards.every(pfActive),
  };
  return (pfFamilies || [])
    .filter(tests[fmView.filter] || tests.all)
    .filter(f => !q || `${f.name} ${f.parents.map(p => `${pfName(p)} ${p.email} ${p.phone}`).join(' ')} ${f.wards.map(w => `${w.name} ${w.regNo} ${w.classLabel}`).join(' ')}`.toLowerCase().includes(q))
    .filter(f => fmView.rules.every(r => pfRuleMatches(f, r, 'families')));
}
function fmRender() {
  const all = fmRows();
  const ids = new Set((pfFamilies || []).map(f => f.id));
  [...fmView.selected].forEach(id => { if (!ids.has(id)) fmView.selected.delete(id); });
  const perPage = fmView.perPage || all.length || 1;
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  fmView.page = Math.min(Math.max(1, fmView.page), pages);
  const start = (fmView.page - 1) * perPage;
  const pageRows = all.slice(start, start + perPage);
  document.getElementById('fm-tbody').innerHTML = pageRows.length ? pageRows.map((f, i) => `
    <tr class="${fmView.selected.has(f.id) ? 'sl-row-selected' : ''}">
      <td class="sl-check"><input type="checkbox" aria-label="Select ${escapeHtml(f.name)}" ${fmView.selected.has(f.id) ? 'checked' : ''} onchange="fmToggleOne(${f.id}, this.checked)"></td>
      <td class="staff-index">${start + i + 1}</td>
      <td><div class="pf-family-name">${escapeHtml(f.name)}</div>
        ${f.parents.map(p => `<div class="pf-person"><span class="pf-pill pf-pill-rel">${escapeHtml(pfRelation(p) || 'Parent')}</span> ${escapeHtml(pfName(p))}
          <div class="staff-table-sub">${escapeHtml([p.email, p.phone].filter(Boolean).join(' · ') || 'No contact on file')}</div></div>`).join('')}</td>
      <td>${f.wards.length ? f.wards.map(w => `<div class="pf-ward-line">${pfStatusPill(w)} ${escapeHtml(w.name)} <span class="staff-table-sub">${escapeHtml(w.classLabel)}</span></div>`).join('') : '<span class="staff-table-sub">No wards linked</span>'}
        <div class="pf-links"><button type="button" class="sf-add-new" onclick="openManageFamily(${f.id})">Manage Wards / Members</button><button type="button" class="sf-add-new" onclick="openViewFamily(${f.id})">View Family</button></div></td>
      <td><div class="pf-links pf-links-col"><button type="button" class="sf-add-new" onclick="fmFeesRecords(${f.id})">Fees Records</button></div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="sl-empty">No families match.</td></tr>';
  const allBox = document.getElementById('fm-check-all');
  const onPage = pageRows.filter(f => fmView.selected.has(f.id)).length;
  allBox.checked = pageRows.length > 0 && onPage === pageRows.length;
  allBox.indeterminate = onPage > 0 && onPage < pageRows.length;
  document.getElementById('fm-info').textContent = all.length
    ? `Showing ${start + 1} to ${start + pageRows.length} of ${all.length} entries${all.length !== (pfFamilies || []).length ? ` (filtered from ${(pfFamilies || []).length} total)` : ''}${fmView.selected.size ? ` · ${fmView.selected.size} selected` : ''}`
    : 'Showing 0 entries';
  pfPages('fm-pages', fmView, pages, fmRender);
  pfRuleBanner('families');
}
function fmToggleOne(id, on) { if (on) fmView.selected.add(id); else fmView.selected.delete(id); fmRender(); }
function fmToggleAll(on) {
  const rows = fmRows();
  const perPage = fmView.perPage || rows.length;
  rows.slice((fmView.page - 1) * perPage, fmView.page * perPage).forEach(f => { if (on) fmView.selected.add(f.id); else fmView.selected.delete(f.id); });
  fmRender();
}
async function fmWardAccounts(active) {
  document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
  const familyIds = [...fmView.selected];
  if (!familyIds.length) return showToast('Tick at least one family first');
  const pupils = (pfFamilies || []).filter(f => fmView.selected.has(f.id)).reduce((n, f) => n + f.wards.length, 0);
  if (!await uiConfirm(`${active ? 'Activate' : 'Deactivate'} the portal accounts of ${pupils} ward${pupils === 1 ? '' : 's'} in ${familyIds.length} famil${familyIds.length === 1 ? 'y' : 'ies'}?${active ? '' : ' They will be signed out and unable to sign in.'}`, { confirmLabel: active ? 'Activate' : 'Deactivate', danger: !active })) return;
  try {
    const data = await apiFetch('/api/admin/families/wards-accounts', { method: 'POST', body: JSON.stringify({ familyIds, active }) });
    fmView.selected.clear();
    await pfRefresh();
    showToast(`${data.changed} ward account${data.changed === 1 ? '' : 's'} ${active ? 'activated' : 'deactivated'}`, 'success');
  } catch (err) { showToast(err.message); }
}
function fmFeesRecords(id) {
  const fam = pfFamilies.find(f => f.id === id);
  const email = fam?.parents.find(p => p.email)?.email || '';
  switchTab('familyFeesHistory', document.querySelector('.sub-nav-item[data-tab="familyFeesHistory"]'));
  setTimeout(() => {
    const box = document.getElementById('ffh-search');
    if (box && email) { box.value = email; box.dispatchEvent(new Event('input', { bubbles: true })); }
  }, 300);
  if (!email) showToast('This family has no parent email, so its fees records cannot be matched yet');
}
const FM_EXPORT_FIELDS = [
  ['name', 'Family Name', f => f.name],
  ['p1name', 'Parent 1 Name', f => f.parents[0] ? pfName(f.parents[0]) : ''], ['p1rel', 'Parent 1 Relationship', f => f.parents[0] ? pfRelation(f.parents[0]) : ''],
  ['p1phone', 'Parent 1 Phone', f => f.parents[0]?.phone || ''], ['p1email', 'Parent 1 Email', f => f.parents[0]?.email || ''],
  ['p1occ', 'Parent 1 Occupation', f => f.parents[0]?.occupation || ''], ['p1addr', 'Parent 1 Address', f => f.parents[0]?.address || ''],
  ['p2name', 'Parent 2 Name', f => f.parents[1] ? pfName(f.parents[1]) : ''], ['p2rel', 'Parent 2 Relationship', f => f.parents[1] ? pfRelation(f.parents[1]) : ''],
  ['p2phone', 'Parent 2 Phone', f => f.parents[1]?.phone || ''], ['p2email', 'Parent 2 Email', f => f.parents[1]?.email || ''],
  ['p2occ', 'Parent 2 Occupation', f => f.parents[1]?.occupation || ''], ['p2addr', 'Parent 2 Address', f => f.parents[1]?.address || ''],
  ['wards', 'Wards', f => f.wards.map(w => w.name).join(', ')], ['wardsClasses', 'Wards with Classes', f => f.wards.map(w => `${w.name} (${w.classLabel})`).join(', ')],
  ['regNos', 'Wards Reg. Nos', f => f.wards.map(w => w.regNo || w.id).join(', ')],
  ['wardCount', 'Number of Wards', f => f.wards.length], ['activeCount', 'Active Wards', f => f.wards.filter(pfActive).length],
];
function fmExport(format, keys = ['name', 'p1name', 'p1rel', 'p1phone', 'p1email', 'p2name', 'p2rel', 'p2phone', 'p2email', 'wardsClasses'], file = 'families') {
  const cols = keys.map(k => FM_EXPORT_FIELDS.find(f => f[0] === k)).filter(Boolean);
  const rows = fmRows();
  slExport(format, { headers: ['S/N', ...cols.map(c => c[1])], rows: rows.map((f, i) => [i + 1, ...cols.map(c => c[2](f))]) }, file);
}

// ── Pop-up helpers ──
function pfModal(title, body, foot, wide) {
  const host = document.getElementById('pf-modal-host');
  host.innerHTML = `<div class="sf-modal" id="pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-modal-title" style="display:flex;">
    <div class="sf-dialog${wide ? ' pf-dialog-wide' : ''}">
      <div class="sf-head"><strong id="pf-modal-title">${title}</strong><button type="button" class="staff-profile-close" onclick="pfCloseModal()" aria-label="Close">&times;</button></div>
      <div class="sf-body">${body}</div>
      ${foot ? `<div class="sf-foot">${foot}</div>` : ''}
    </div></div>`;
  host.querySelector('#pf-modal').addEventListener('mousedown', e => { if (e.target.id === 'pf-modal') pfCloseModal(); });
}
function pfCloseModal() { document.getElementById('pf-modal-host').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('pf-modal') && !document.querySelector('.ui-dialog-overlay')) pfCloseModal(); });

function pfParentFields(prefix, p = {}, required = true) {
  const opt = (list, sel) => list.map(v => `<option ${v === sel ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
  return `<div class="sf-grid">
    <div><label class="field-label" for="${prefix}-title">Title</label><select class="ctrl-select" id="${prefix}-title"><option value=""></option>${opt(PF_TITLES, p.title)}</select></div>
    <div class="sf-span-2"><label class="field-label" for="${prefix}-name">Full Name${required ? ' *' : ''}</label><input class="field-input" id="${prefix}-name" value="${escapeHtml(p.fullName || '')}"></div>
    <div><label class="field-label" for="${prefix}-rel">Relationship (with ward(s))</label><select class="ctrl-select" id="${prefix}-rel" onchange="document.getElementById('${prefix}-rel-other-wrap').hidden=this.value!=='Other'"><option value="">— Select —</option>${opt(PF_RELATIONS, p.relationship)}</select></div>
    <div id="${prefix}-rel-other-wrap" ${p.relationship === 'Other' ? '' : 'hidden'}><label class="field-label" for="${prefix}-rel-other">Relationship (other)</label><input class="field-input" id="${prefix}-rel-other" value="${escapeHtml(p.relationshipOther || '')}"></div>
    <div><label class="field-label" for="${prefix}-occ">Occupation / Profession</label><input class="field-input" id="${prefix}-occ" value="${escapeHtml(p.occupation || '')}"></div>
    <div><label class="field-label" for="${prefix}-phone">Phone</label><input class="field-input" id="${prefix}-phone" type="tel" value="${escapeHtml(p.phone || '')}"></div>
    <div><label class="field-label" for="${prefix}-email">Email</label><input class="field-input" id="${prefix}-email" type="email" value="${escapeHtml(p.email || '')}"></div>
    <div class="sf-span-3"><label class="field-label" for="${prefix}-addr">Address</label><textarea class="field-input" id="${prefix}-addr" rows="2">${escapeHtml(p.address || '')}</textarea></div>
  </div>`;
}
function pfReadParent(prefix) {
  const v = id => document.getElementById(`${prefix}-${id}`)?.value.trim() || '';
  return { title: v('title'), fullName: v('name'), relationship: v('rel'), relationshipOther: v('rel') === 'Other' ? v('rel-other') : '', occupation: v('occ'), phone: v('phone'), email: v('email'), address: v('addr') };
}
function pfValidEmail(prefix) {
  const el = document.getElementById(`${prefix}-email`);
  if (el?.value.trim() && !el.checkValidity()) { el.focus(); showToast('Enter a valid email address'); return false; }
  return true;
}

// A parent slot: create a new parent or pick an existing one
function pfSlot(slot, label, required, preset) {
  return `<div class="pf-slot" id="pf-slot-${slot}" data-mode="${preset ? 'existing' : 'new'}" ${preset ? `data-existing="${preset.id}"` : ''}>
    <div class="pf-slot-head"><h3 class="sf-section-title" style="margin:0;">${label}${required ? ' *' : ''}</h3>
      <div class="pf-seg"><button type="button" class="${preset ? '' : 'active'}" onclick="pfSlotMode('${slot}','new')">Create New Parent</button><button type="button" class="${preset ? 'active' : ''}" onclick="pfSlotMode('${slot}','existing')">Search Existing Parent</button></div></div>
    <div class="pf-slot-new" ${preset ? 'hidden' : ''}>${pfParentFields(`pf-${slot}`, {}, required)}</div>
    <div class="pf-slot-existing" ${preset ? '' : 'hidden'}>
      <div class="pf-picked" id="pf-${slot}-picked">${preset ? pfPickedHtml(slot, preset) : ''}</div>
      <div class="pf-search-wrap" ${preset ? 'hidden' : ''}><input class="field-input" id="pf-${slot}-q" placeholder="Search by name, email or phone" oninput="pfSearchParents('${slot}', this.value)"><div class="pf-results" id="pf-${slot}-results"></div></div>
    </div>
  </div>`;
}
function pfPickedHtml(slot, p) {
  return `<div class="pf-picked-card"><b>${escapeHtml(pfName(p))}</b> <span class="staff-table-sub">${escapeHtml([pfRelation(p), p.email, p.phone].filter(Boolean).join(' · '))}</span>
    <button type="button" class="sf-add-new" onclick="pfUnpick('${slot}')">Change</button></div>`;
}
function pfSlotMode(slot, mode) {
  const el = document.getElementById(`pf-slot-${slot}`);
  el.dataset.mode = mode;
  el.querySelector('.pf-slot-new').hidden = mode !== 'new';
  el.querySelector('.pf-slot-existing').hidden = mode !== 'existing';
  el.querySelectorAll('.pf-seg button').forEach((b, i) => b.classList.toggle('active', (i === 0) === (mode === 'new')));
  if (mode === 'existing' && !el.dataset.existing) setTimeout(() => document.getElementById(`pf-${slot}-q`)?.focus(), 30);
}
let pfSearchTimer = null;
function pfSearchParents(slot, q) {
  clearTimeout(pfSearchTimer);
  const box = document.getElementById(`pf-${slot}-results`);
  if (q.trim().length < 2) { box.innerHTML = ''; return; }
  pfSearchTimer = setTimeout(async () => {
    try {
      const { parents } = await apiFetch(`/api/admin/parents/search?q=${encodeURIComponent(q.trim())}`);
      box.innerHTML = parents.length ? parents.map(p => `<button type="button" class="pf-result" onclick='pfPick("${slot}", ${JSON.stringify(p).replace(/'/g, '&#39;')})'><b>${escapeHtml(pfName(p))}</b> <span class="staff-table-sub">${escapeHtml([pfRelation(p), p.email, p.phone].filter(Boolean).join(' · '))}</span></button>`).join('') : '<div class="staff-table-sub" style="padding:8px;">No parent found. Use "Create New Parent".</div>';
    } catch (err) { box.innerHTML = `<div class="staff-table-sub" style="padding:8px;">${escapeHtml(err.message)}</div>`; }
  }, 250);
}
function pfPick(slot, p) {
  const el = document.getElementById(`pf-slot-${slot}`);
  el.dataset.existing = p.id;
  document.getElementById(`pf-${slot}-picked`).innerHTML = pfPickedHtml(slot, p);
  el.querySelector('.pf-search-wrap').hidden = true;
}
function pfUnpick(slot) {
  const el = document.getElementById(`pf-slot-${slot}`);
  delete el.dataset.existing;
  document.getElementById(`pf-${slot}-picked`).innerHTML = '';
  el.querySelector('.pf-search-wrap').hidden = false;
  document.getElementById(`pf-${slot}-q`).value = '';
  document.getElementById(`pf-${slot}-results`).innerHTML = '';
  document.getElementById(`pf-${slot}-q`).focus();
}
// Returns {existingId} | {parent fields} | null (empty), or throws a message
function pfReadSlot(slot, required) {
  const el = document.getElementById(`pf-slot-${slot}`);
  if (el.dataset.mode === 'existing') {
    if (el.dataset.existing) return { existingId: Number(el.dataset.existing) };
    if (required) throw new Error('Search for and pick the existing parent, or switch to "Create New Parent"');
    return null;
  }
  const p = pfReadParent(`pf-${slot}`);
  if (!p.fullName) { if (required) throw new Error("Parent 1's full name is required"); return null; }
  if (!pfValidEmail(`pf-${slot}`)) throw new Error('');
  return p;
}

// ── Create Family ──
function openCreateFamily(presetParentId) {
  const preset = presetParentId ? (pfParents || []).find(p => p.id === presetParentId) : null;
  pfModal('Create New Family', `
    <div class="sf-grid sf-grid-2"><div><label class="field-label" for="pf-family-name">Family name <span class="sf-hint">(optional — worked out from the surnames)</span></label><input class="field-input" id="pf-family-name" placeholder="e.g. ADEKOYA Family"></div></div>
    ${pfSlot('p1', 'Parent 1', true, preset)}
    ${pfSlot('p2', 'Parent 2', false, null)}`,
    '<button type="button" class="btn-outline" onclick="pfCloseModal()">Cancel</button><button type="button" class="post-btn" id="pf-create-btn" onclick="pfCreateFamily()">Create Family</button>', true);
}
async function pfCreateFamily() {
  let parent1;
  let parent2;
  try {
    parent1 = pfReadSlot('p1', true);
    parent2 = pfReadSlot('p2', false);
  } catch (err) { if (err.message) showToast(err.message); return; }
  if (parent1?.existingId && parent1.existingId === parent2?.existingId) return showToast('Parent 1 and Parent 2 are the same person');
  const btn = document.getElementById('pf-create-btn');
  btn.disabled = true;
  try {
    const data = await apiFetch('/api/admin/families', { method: 'POST', body: JSON.stringify({ name: document.getElementById('pf-family-name').value.trim(), parent1, parent2 }) });
    await pfRefresh();
    showToast('Family created', 'success');
    openManageFamily(data.familyId); // next: link the wards
  } catch (err) {
    showToast(err.message);
    btn.disabled = false;
  }
}

// ── View Family ──
function openViewFamily(id) {
  const f = pfFamilies.find(x => x.id === id);
  if (!f) return;
  pfModal(`${escapeHtml(f.name)}`, `
    <h3 class="sf-section-title">Wards (${f.wards.length})</h3>
    ${f.wards.length ? `<div class="fam-cards">${f.wards.map(w => `<div class="fam-card">
      <div class="fam-card-top"><span class="sl-avatar sl-avatar-initials">${escapeHtml(pfInitials(w.name))}</span><div><b>${escapeHtml(w.name)}</b><div class="staff-table-sub">${escapeHtml([w.regNo || w.id, w.classLabel].filter(Boolean).join(' · '))}</div>${pfStatusPill(w)}${w.accountActive ? '' : ' <span class="pf-pill pf-pill-out">Account off</span>'}</div></div>
      <div class="pf-links"><button type="button" class="sf-add-new" onclick="stuClassHistory('${escapeHtml(w.id)}', '${escapeHtml(w.name).replace(/'/g, '&#39;')}')">Class History</button><button type="button" class="sf-add-new" onclick="stuProfile('${escapeHtml(w.id)}')">View Profile</button><button type="button" class="sf-add-new" onclick="pfCloseModal();stuGoToProfile('${escapeHtml(w.id)}')">Go to Profile Page</button></div>
    </div>`).join('')}</div>` : '<p class="staff-table-sub">No wards linked yet.</p>'}
    <h3 class="sf-section-title">Parents (${f.parents.length})</h3>
    <div class="fam-cards">${f.parents.map(p => `<div class="fam-card"><div class="fam-card-top"><span class="sl-avatar sl-avatar-initials">${escapeHtml(pfInitials(p.fullName))}</span><div><b>${escapeHtml(pfName(p))}</b> <span class="pf-pill pf-pill-rel">${escapeHtml(pfRelation(p) || 'Parent')}</span>
      <div class="staff-table-sub">${escapeHtml([p.phone, p.email].filter(Boolean).join(' · ') || 'No contact on file')}</div>${p.occupation ? `<div class="staff-table-sub">${escapeHtml(p.occupation)}</div>` : ''}${p.address ? `<div class="staff-table-sub">${escapeHtml(p.address)}</div>` : ''}</div></div>
      <div class="pf-links"><button type="button" class="sf-add-new" onclick="openParentProfile(${p.id}, true)">Edit Details</button></div></div>`).join('')}</div>`,
    `<button type="button" class="btn-outline" onclick="pfCloseModal()">Close</button><button type="button" class="post-btn" onclick="openManageFamily(${f.id})">Manage Family Members</button>`, true);
}

// ── Manage Family Members ──
function openManageFamily(id) {
  const f = pfFamilies.find(x => x.id === id);
  if (!f) return;
  pfModal(`Manage Family Members — ${escapeHtml(f.name)}`, `
    <table class="staff-table pf-members"><thead><tr><th>Name</th><th>Member</th><th>Action</th></tr></thead><tbody>
      ${f.parents.map(p => `<tr><td>${escapeHtml(pfName(p))}</td><td>${escapeHtml(pfRelation(p) || 'Parent')}</td><td>${f.parents.length > 1 ? `<button type="button" class="del-btn" onclick="pfRemoveParent(${f.id}, ${p.id})">Remove</button>` : '<span class="staff-table-sub">Only parent</span>'}</td></tr>`).join('')}
      ${f.wards.map(w => `<tr><td>${escapeHtml(w.name)} <span class="staff-table-sub">${escapeHtml(w.classLabel)}</span></td><td>Ward</td><td><button type="button" class="del-btn" onclick="pfUnlinkWard(${f.id}, '${escapeHtml(w.id)}')">Unlink</button></td></tr>`).join('')}
    </tbody></table>
    <h3 class="sf-section-title">Link Ward / Student(s)</h3>
    <input class="field-input" id="pf-ward-q" placeholder="Search pupils by name, Reg. No. or class" oninput="pfSearchWards(${f.id}, this.value)">
    <div class="pf-results" id="pf-ward-results"></div>
    <h3 class="sf-section-title">Add Parent / Guardian</h3>
    ${f.parents.length >= 2 ? '<p class="staff-table-sub">This family already has two parents. Remove one to add another.</p>' : `${pfSlot('add', 'New member', false, null)}<button type="button" class="post-btn" style="margin-top:8px;" onclick="pfAddParent(${f.id})">Add to Family</button>`}`,
    `<button type="button" class="post-btn" onclick="pfCloseModal()">Done</button>`, true);
}
function pfSearchWards(familyId, q) {
  const box = document.getElementById('pf-ward-results');
  const term = q.trim().toLowerCase();
  if (term.length < 2) { box.innerHTML = ''; return; }
  const famOf = new Map((pfFamilies || []).flatMap(f => f.wards.map(w => [w.id, f])));
  const classLabel = code => (state.setup.classes || []).find(c => c.code === code)?.label || code || '';
  const hits = (state.setup.students || [])
    .filter(s => `${s.name} ${s.id} ${s.regNo || ''} ${classLabel(s.classCode)}`.toLowerCase().includes(term))
    .slice(0, 12);
  box.innerHTML = hits.length ? hits.map(s => {
    const fam = famOf.get(s.id);
    const here = fam?.id === familyId;
    return `<div class="pf-result pf-result-row"><span><b>${escapeHtml(s.name)}</b> <span class="staff-table-sub">${escapeHtml([s.regNo || s.id, classLabel(s.classCode)].filter(Boolean).join(' · '))}${fam && !here ? ` · now in ${escapeHtml(fam.name)}` : ''}</span></span>
      ${here ? '<span class="staff-table-sub">Already in this family</span>' : `<button type="button" class="post-btn" onclick="pfLinkWard(${familyId}, '${escapeHtml(s.id)}', ${fam ? `'${escapeHtml(fam.name).replace(/'/g, '&#39;')}'` : 'null'})">${fam ? 'Move here' : 'Add'}</button>`}</div>`;
  }).join('') : '<div class="staff-table-sub" style="padding:8px;">No pupil found.</div>';
}
async function pfLinkWard(familyId, studentId, fromFamily) {
  if (fromFamily && !await uiConfirm(`Move this pupil from ${fromFamily} to this family?`, { confirmLabel: 'Move' })) return;
  try {
    await apiFetch(`/api/admin/families/${familyId}/wards`, { method: 'POST', body: JSON.stringify({ studentId }) });
    await pfRefresh();
    showToast('Ward linked', 'success');
    openManageFamily(familyId);
  } catch (err) { showToast(err.message); }
}
async function pfUnlinkWard(familyId, studentId) {
  if (!await uiConfirm('Unlink this pupil from the family? Their record stays; they just won\'t belong to this family.', { confirmLabel: 'Unlink' })) return;
  try {
    await apiFetch(`/api/admin/families/${familyId}/wards/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
    await pfRefresh();
    showToast('Ward unlinked', 'success');
    openManageFamily(familyId);
  } catch (err) { showToast(err.message); }
}
async function pfRemoveParent(familyId, parentId) {
  if (!await uiConfirm('Remove this parent from the family? Their parent record stays on file.', { confirmLabel: 'Remove' })) return;
  try {
    await apiFetch(`/api/admin/families/${familyId}/parents/${parentId}`, { method: 'DELETE' });
    await pfRefresh();
    showToast('Parent removed from family', 'success');
    openManageFamily(familyId);
  } catch (err) { showToast(err.message); }
}
async function pfAddParent(familyId) {
  let slot;
  try { slot = pfReadSlot('add', false); } catch (err) { if (err.message) showToast(err.message); return; }
  if (!slot) return showToast('Enter the parent\'s full name, or pick an existing parent');
  try {
    await apiFetch(`/api/admin/families/${familyId}/parents`, { method: 'POST', body: JSON.stringify(slot) });
    await pfRefresh();
    showToast('Parent added to family', 'success');
    openManageFamily(familyId);
  } catch (err) { showToast(err.message); }
}

// ── Parent profile / edit ──
function openParentProfile(id, editing) {
  const p = (pfParents || []).find(x => x.id === id) || (pfFamilies || []).flatMap(f => f.parents).find(x => x.id === id);
  if (!p) return;
  const full = (pfParents || []).find(x => x.id === id) || { ...p, families: [], wards: [] };
  if (editing) {
    pfModal(`Edit ${escapeHtml(pfName(p))}`, pfParentFields('pf-edit', p, true),
      `<button type="button" class="btn-outline" onclick="openParentProfile(${id})">Cancel</button><button type="button" class="post-btn" onclick="pfSaveParent(${id})">Save Changes</button>`, true);
    return;
  }
  const row = (label, value) => `<div class="staff-profile-detail"><span>${escapeHtml(label)}</span><strong>${value || '<span class="staff-table-sub">Not set</span>'}</strong></div>`;
  pfModal(escapeHtml(pfName(p)), `
    <div class="staff-profile-details">
      ${row('Relationship with ward(s)', escapeHtml(pfRelation(p)))}${row('Phone', escapeHtml(p.phone))}${row('Email', escapeHtml(p.email))}
      ${row('Occupation', escapeHtml(p.occupation))}${row('Address', escapeHtml(p.address))}
      ${row('Family', full.families.length ? full.families.map(f => `<button type="button" class="sf-add-new" onclick="openViewFamily(${f.id})">${escapeHtml(f.name)}</button>`).join(' ') : '<span class="pf-pill pf-pill-warn">No Family</span>')}
      ${row('Ward(s)', full.wards.map(w => `${escapeHtml(w.name)} <span class="staff-table-sub">${escapeHtml(w.classLabel)}</span>`).join('<br>'))}
    </div>`,
    `${full.families.length ? '' : `<button type="button" class="btn-outline" onclick="openCreateFamily(${id})">Create Family</button>`}<button type="button" class="post-btn" onclick="openParentProfile(${id}, true)">Edit Details</button>`, true);
}
async function pfSaveParent(id) {
  const p = pfReadParent('pf-edit');
  if (!p.fullName) return showToast('Full name is required');
  if (!pfValidEmail('pf-edit')) return;
  try {
    await apiFetch(`/api/admin/parents/${id}`, { method: 'PUT', body: JSON.stringify(p) });
    await pfRefresh();
    showToast('Parent details saved', 'success');
    openParentProfile(id);
  } catch (err) { showToast(err.message); }
}

// ── Advanced Filter (both pages) ──
let pfRuleDraft = [];
let pfRulePage = 'parents';
function openRuleFilter(page) {
  pfRulePage = page;
  const view = page === 'parents' ? plView : fmView;
  pfRuleDraft = view.rules.length ? JSON.parse(JSON.stringify(view.rules)) : [{ field: '', op: 'contains', value: '' }];
  pfRenderRules();
}
function pfRuleKey() { return `pfFilterPresets-${pfRulePage}`; }
function pfRulePresets() { try { return JSON.parse(localStorage.getItem(pfRuleKey()) || '{}'); } catch { return {}; } }
function pfRenderRules() {
  const fields = PF_FIELDS[pfRulePage];
  const presets = pfRulePresets();
  pfModal(`Advanced Filter — ${pfRulePage === 'parents' ? 'Parents' : 'Families'}`, `
    <div class="sf-grid sf-grid-2">
      <div><select class="ctrl-select" aria-label="Load a saved preset" onchange="if(this.value){pfRuleDraft=JSON.parse(JSON.stringify(pfRulePresets()[this.value]));pfRenderRules();}"><option value="">Load a saved preset…</option>${Object.keys(presets).sort().map(n => `<option>${escapeHtml(n)}</option>`).join('')}</select></div>
      <div class="ae-inline"><input class="field-input" id="pf-preset-name" placeholder="Preset name…" aria-label="Preset name"><button type="button" class="btn-outline" onclick="pfSavePreset()">Save Preset</button></div>
    </div>
    ${pfRuleDraft.map((r, i) => `<div class="af-rule">
      <select class="ctrl-select" onchange="pfRuleDraft[${i}].field=this.value"><option value="">Select field…</option>${fields.map(([k, l]) => `<option value="${k}" ${k === r.field ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
      <select class="ctrl-select" onchange="pfRuleDraft[${i}].op=this.value;pfRenderRules()">${PF_RULE_OPS.map(([k, l]) => `<option value="${k}" ${k === r.op ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input class="field-input" value="${escapeHtml(r.value || '')}" placeholder="Value" ${['empty', 'not_empty'].includes(r.op) ? 'disabled' : ''} oninput="pfRuleDraft[${i}].value=this.value">
      <button type="button" class="staff-profile-close" aria-label="Remove rule" onclick="pfRuleDraft.splice(${i},1);if(!pfRuleDraft.length)pfRuleDraft.push({field:'',op:'contains',value:''});pfRenderRules()">&times;</button>
    </div>`).join('')}
    <button type="button" class="sf-add-new" onclick="pfRuleDraft.push({field:'',op:'contains',value:''});pfRenderRules()">+ Add Rule</button>
    <span class="af-preview" id="pf-rule-preview"></span>`,
    `<button type="button" class="btn-outline" onclick="pfRuleDraft=[{field:'',op:'contains',value:''}];pfRenderRules()">Clear All</button><button type="button" class="btn-outline" onclick="pfCloseModal()">Cancel</button><span class="af-spacer"></span><button type="button" class="btn-outline" onclick="pfPreviewRules()">Preview Count</button><button type="button" class="post-btn" onclick="pfApplyRules()">Apply Filter</button>`);
}
function pfPreviewRules() {
  const view = pfRulePage === 'parents' ? plView : fmView;
  const saved = view.rules;
  view.rules = pfRuleDraft.filter(r => r.field && r.op);
  const n = (pfRulePage === 'parents' ? plRows() : fmRows()).length;
  view.rules = saved;
  document.getElementById('pf-rule-preview').textContent = `${n} ${pfRulePage === 'parents' ? 'parent' : 'famil'}${pfRulePage === 'parents' ? (n === 1 ? '' : 's') : (n === 1 ? 'y' : 'ies')} match`;
}
function pfSavePreset() {
  const name = document.getElementById('pf-preset-name').value.trim();
  const rules = pfRuleDraft.filter(r => r.field && r.op);
  if (!name) return showToast('Type a name for the preset');
  if (!rules.length) return showToast('Add at least one rule first');
  const all = pfRulePresets();
  all[name] = rules;
  try { localStorage.setItem(pfRuleKey(), JSON.stringify(all)); } catch { /* storage blocked */ }
  showToast(`Preset “${name}” saved`, 'success');
  pfRenderRules();
}
function pfApplyRules() {
  const view = pfRulePage === 'parents' ? plView : fmView;
  view.rules = pfRuleDraft.filter(r => r.field && r.op);
  view.page = 1;
  pfCloseModal();
  if (pfRulePage === 'parents') plRender(); else fmRender();
}

// ── Advanced Export (families) ──
let fmExportKeys = ['name', 'p1name', 'p1rel', 'p1phone', 'p1email', 'p2name', 'p2rel', 'p2phone', 'p2email', 'wardsClasses'];
function openFamilyAdvancedExport() {
  pfModal('Advanced Families Export', `
    <p class="oc-text" style="margin:0 0 10px;">Tick the columns to export. The export follows the families showing now (filters and search apply).</p>
    <div class="ae-field-tools"><button type="button" class="btn-outline" onclick="fmExportKeys=FM_EXPORT_FIELDS.map(f=>f[0]);openFamilyAdvancedExport()">Select All</button><button type="button" class="btn-outline" onclick="fmExportKeys=[];openFamilyAdvancedExport()">Deselect All</button></div>
    <div class="ae-group-fields" style="padding-left:0;">${FM_EXPORT_FIELDS.map(([k, l]) => `<label class="sf-check"><input type="checkbox" ${fmExportKeys.includes(k) ? 'checked' : ''} onchange="fmExportKeys=fmExportKeys.filter(x=>x!=='${k}');if(this.checked)fmExportKeys.push('${k}')"> ${escapeHtml(l)}</label>`).join('')}</div>
    <div class="sf-grid sf-grid-2" style="margin-top:14px;">
      <div><label class="field-label" for="fm-ae-file">File name</label><input class="field-input" id="fm-ae-file" value="families-export"></div>
      <div><label class="field-label" for="fm-ae-format">Format</label><select class="ctrl-select" id="fm-ae-format"><option value="xlsx">Excel (.xlsx)</option><option value="xls">Excel 97–2003 (.xls)</option><option value="csv">CSV (.csv)</option><option value="doc">Word (.doc)</option></select></div>
    </div>`,
    '<button type="button" class="btn-outline" onclick="pfCloseModal()">Cancel</button><button type="button" class="post-btn" onclick="fmAdvancedExport()">Export</button>', true);
}
function fmAdvancedExport() {
  if (!fmExportKeys.length) return showToast('Tick at least one column');
  const keys = FM_EXPORT_FIELDS.map(f => f[0]).filter(k => fmExportKeys.includes(k));
  const file = (document.getElementById('fm-ae-file').value.trim() || 'families-export').replace(/[^\w\- ]+/g, '') || 'families-export';
  fmExport(document.getElementById('fm-ae-format').value, keys, file);
}
