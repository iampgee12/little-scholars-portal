// Academics › New Term Setup (admin portal). Server side: term-setup.js.
// Uses admin-api.js / staff-list.js helpers: apiFetch, escapeHtml, showToast,
// uiConfirm, slExport, slToggleMenu, switchTab, state.

// A value for inline click code: a JS string literal, made safe for the HTML attribute, so names with
// apostrophes (O'Brien) or crafted text can't end the string and run as code
function jsArg(value) {
  return JSON.stringify(String(value ?? '')).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}


const TS_TABS = [
  ['sessions', 'Session & Term'], ['allocation', 'Student Class Allocation'], ['formTeachers', 'Class Teacher Allocation'],
  ['subjectTeachers', 'Subject Teacher Allocation'], ['leadership', 'Academic Leadership'], ['fees', 'Fees Setup'],
];
const TS_SUBTABS = [['active', 'Active Session / Term'], ['periods', 'Academic Calendar Periods'], ['sessions', 'Academic Sessions'], ['terms', 'Terms'], ['holidays', 'School Holidays']];
const TS_STEPS = [
  ['sessions', 'Sessions & Terms', 'Make sure the new session/term exists, then switch the portal to it'],
  ['allocation', 'Student Class Allocation', 'Promote, carry forward, or transfer pupils to their new classes'],
  ['formTeachers', 'Class Teacher Allocation', 'Assign or carry forward form teachers for each class arm'],
  ['subjectTeachers', 'Subject Teacher Allocation', 'Assign or carry forward subject teachers'],
  ['fees', 'Fees Setup', 'Publish fee invoices for the new term'],
];
const tsView = {
  tab: 'sessions', sub: 'active', data: null,
  alloc: { action: '', students: [], selected: new Set(), loaded: null },
  form: { session: '', classCode: '', rows: [], stats: null, search: '', page: 1 },
  subj: { session: '', classCode: '', rows: [], stats: null, search: '', page: 1 },
  lead: { session: '', sections: [], permissions: [] },
};
const TS_PAGE = 25;
const tsStatus = s => ({ direct: ['Direct', 'pf-pill-in'], inherited: ['Inherited', 'pf-pill-warn'], pending: ['Pending', 'pf-pill-out'], unassigned: ['Unassigned', 'pf-pill-rel'] }[s] || [s, 'pf-pill-rel']);
const tsPill = s => { const [label, cls] = tsStatus(s); return `<span class="pf-pill ${cls}">${label}</span>`; };
const tsDate = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const tsWhen = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const tsTeachers = () => (state.setup?.staff || []).filter(s => (s.role === 'teacher' || s.role === 'admin') && !s.archived).sort((a, b) => a.name.localeCompare(b.name));
const tsStaffAll = () => (state.setup?.staff || []).filter(s => !s.archived).sort((a, b) => a.name.localeCompare(b.name));
const tsClasses = () => (state.setup?.classes || []).filter(c => !c.archived);
const tsArms = code => (state.setup?.classArms || state.setup?.arms || []).filter(a => (a.classCode || a.class_code) === code);
const tsOpt = (value, label, sel) => `<option value="${escapeHtml(value)}" ${String(value) === String(sel) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
const tsSessionOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + (tsView.data?.sessions || []).map(s => tsOpt(s.label, `${s.label}${s.isActive ? ' (active)' : ''}`, sel)).join('');
const tsClassOpts = (sel, allLabel) => (allLabel ? tsOpt('', allLabel, sel) : '') + tsClasses().map(c => tsOpt(c.code, c.label, sel)).join('');
const tsInitials = name => `<span class="sl-avatar sl-avatar-initials">${escapeHtml(pfInitials(name))}</span>`;
// a missing photo falls back to initials
const tsAvatar = (name, photo) => (photo ? `<img class="sl-avatar" src="/${escapeHtml(photo)}" alt="" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${escapeHtml(tsInitials(name))}">` : tsInitials(name));

// ── Pop-ups ──
function tsModal(title, body, foot, wide) {
  const host = document.getElementById('ts-modal-host');
  host.innerHTML = `<div class="sf-modal" id="ts-modal" role="dialog" aria-modal="true" aria-labelledby="ts-modal-title" style="display:flex;">
    <div class="sf-dialog${wide ? ' pf-dialog-wide' : ''}">
      <div class="sf-head"><strong id="ts-modal-title">${title}</strong><button type="button" class="staff-profile-close" onclick="tsClose()" aria-label="Close">&times;</button></div>
      <div class="sf-body">${body}</div>${foot ? `<div class="sf-foot">${foot}</div>` : ''}
    </div></div>`;
  host.querySelector('#ts-modal').addEventListener('mousedown', e => { if (e.target.id === 'ts-modal') tsClose(); });
}
function tsClose() { document.getElementById('ts-modal-host').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('ts-modal') && !document.querySelector('.ui-dialog-overlay')) tsClose(); });
const tsVal = id => document.getElementById(id)?.value.trim() || '';

// ── Shell ──
async function tsInit() {
  try { tsView.data = await apiFetch('/api/admin/term-setup/overview'); } catch (err) { return showToast(err.message); }
  const active = tsView.data.active?.sessionLabel || '';
  ['form', 'subj', 'lead'].forEach(k => { if (!tsView[k].session) tsView[k].session = active; });
  tsRenderShell();
}
function tsRenderShell() {
  const root = document.getElementById('ts-root');
  let hideSteps = false;
  try { hideSteps = localStorage.getItem('tsHideSteps') === '1'; } catch { /* storage blocked */ }
  const a = tsView.data.active;
  root.innerHTML = `
    <div class="ts-active-strip"><span>Academic Session <b>${escapeHtml(a?.sessionLabel || '—')}</b></span><span>Active Term <b>${escapeHtml(a?.termLabel || '—')}</b></span></div>
    ${hideSteps ? '' : `<div class="ts-steps">
      <button type="button" class="staff-profile-close ts-steps-close" aria-label="Hide these steps" onclick="try{localStorage.setItem('tsHideSteps','1')}catch{};tsRenderShell()">&times;</button>
      <p class="ts-steps-lead">Getting ready for a new term or academic session? Complete these steps in order — each one takes you straight there.</p>
      <ol>${TS_STEPS.map(([tab, title, sub], i) => `<li><button type="button" onclick="tsGo(${jsArg(tab)})"><span class="ts-step-n">${i + 1}</span><span><b>${title}</b><small>${sub}</small></span></button></li>`).join('')}</ol>
    </div>`}
    <div class="card ts-tabs-card"><div class="ts-tabs" role="tablist">${TS_TABS.map(([k, l]) => `<button type="button" role="tab" class="ts-tab ${tsView.tab === k ? 'active' : ''}" onclick="tsGo(${jsArg(k)})">${l}</button>`).join('')}</div></div>
    <div id="ts-pane"></div>`;
  tsRenderPane();
}
function tsGo(tab) {
  tsView.tab = tab;
  document.querySelectorAll('#ts-root .ts-tab').forEach((b, i) => b.classList.toggle('active', TS_TABS[i][0] === tab));
  tsRenderPane();
}
function tsRenderPane() {
  ({ sessions: tsRenderSessions, allocation: tsRenderAllocation, formTeachers: () => tsLoadForm(), subjectTeachers: () => tsLoadSubj(), leadership: () => tsLoadLead(), fees: tsRenderFees })[tsView.tab]();
}
const tsPane = html => { document.getElementById('ts-pane').innerHTML = html; };
const tsSet = data => { if (data?.overview) tsView.data = data.overview; if (data?.setup) state.setup = data.setup; };

// ═══ 1. Session & Term ═══
function tsRenderSessions() {
  const d = tsView.data;
  const sub = tsView.sub;
  const subtabs = `<div class="ts-subtabs">${TS_SUBTABS.map(([k, l]) => `<button type="button" class="${sub === k ? 'active' : ''}" onclick="tsView.sub=${jsArg(k)};tsRenderSessions()">${l}</button>`).join('')}</div>`;
  const note = text => `<div class="ts-note">${text}</div>`;
  let body = '';
  if (sub === 'active') {
    const a = d.active;
    body = `<div class="ts-stat-row">
        <div class="ts-stat"><small>Active Term</small><b>${escapeHtml(a?.termLabel || '—')}</b></div>
        <div class="ts-stat"><small>Active Academic Session</small><b>${escapeHtml(a?.sessionLabel || '—')}</b></div>
        <div class="ts-stat"><small>Active Year</small><b>${escapeHtml(a?.year || '—')}</b></div>
        <div class="ts-stat"><small>Term Dates</small><b>${a?.startDate ? `${tsDate(a.startDate)} – ${tsDate(a.endDate)}` : 'Not set'}</b></div>
      </div>
      <button type="button" class="post-btn" onclick="tsOpenSwitch()">Switch Session / Term</button>`;
  } else if (sub === 'periods') {
    body = note('<b>What are calendar periods?</b> Each session + term has its own date range, so the portal knows when a term starts and ends. The term calendar and attendance school-day count use these dates. Create one entry per session + term and update it when needed.')
      + `<div class="sl-list-head"><div class="sl-card-title">Academic Calendar Periods</div><button type="button" class="post-btn sf-add-btn" onclick="tsOpenPeriod()">+ New Period</button></div>
      <div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Session</th><th>Term</th><th>Start Date</th><th>End Date</th><th>Actions</th></tr></thead><tbody>
      ${d.periods.filter(p => p.startDate).map((p, i) => `<tr><td class="staff-index">${i + 1}</td><td>${escapeHtml(p.sessionLabel)} ${p.isActive ? '<span class="pf-pill pf-pill-in">Active</span>' : ''}</td><td>${escapeHtml(p.termLabel)}</td><td>${tsDate(p.startDate)}</td><td>${tsDate(p.endDate)}</td>
        <td class="pf-actions"><button type="button" class="sf-add-new" onclick="tsOpenPeriod(${p.id})">Edit</button> <button type="button" class="sf-add-new ts-danger" onclick="tsDeletePeriod(${p.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="sl-empty">No calendar periods yet. Click “New Period” to add one.</td></tr>'}
      </tbody></table></div>`;
  } else if (sub === 'sessions') {
    body = note('<b>Self-managing:</b> when you switch to a new session (e.g. 2026/2027), the following session (2027/2028) is created for you in the background, so there is almost nothing to do here. Create one by hand only to plan far ahead or to give a session a name.')
      + `<div class="sl-list-head"><div class="sl-card-title">Academic Sessions List</div><button type="button" class="post-btn sf-add-btn" onclick="tsOpenSession()">+ Create New Academic Session</button></div>
      <div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Session</th><th>Start Year</th><th>End Year</th><th>Status</th><th>Action</th></tr></thead><tbody>
      ${d.sessions.map((s, i) => `<tr><td class="staff-index">${i + 1}</td><td><b>${escapeHtml(s.label)}</b>${s.alias ? ` <span class="staff-table-sub">${escapeHtml(s.alias)}</span>` : ''}</td><td>${s.startYear || ''}</td><td>${s.endYear || ''}</td>
        <td>${s.isActive ? '<span class="pf-pill pf-pill-in">Active Academic Session</span>' : ''}</td>
        <td class="pf-actions"><button type="button" class="sf-add-new" onclick="tsOpenSession(${jsArg(s.label)})">Edit</button>${s.isActive ? '' : ` <button type="button" class="sf-add-new ts-danger" onclick="tsDeleteSession(${jsArg(s.label)})">Delete</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (sub === 'terms') {
    body = note('<b>Set once, rarely changed:</b> this is the list of term names the school runs. The same list applies to every session. Add to it only if the school ever adds a term.')
      + `<div class="sl-list-head"><div class="sl-card-title">Academic Terms / Periods</div><button type="button" class="post-btn sf-add-btn" onclick="tsOpenTerm()">+ Create New Academic Term / Period</button></div>
      <table class="staff-table"><thead><tr><th>#</th><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody>
      ${d.terms.map((t, i) => `<tr><td class="staff-index">${i + 1}</td><td><b>${escapeHtml(t.name)}</b></td><td>${t.isActive ? '<span class="pf-pill pf-pill-in">Active Term / Period</span>' : ''}</td>
        <td>${['Term 1', 'Term 2', 'Term 3'].includes(t.name) || t.used ? '<span class="staff-table-sub">In use</span>' : `<button type="button" class="sf-add-new ts-danger" onclick="tsDeleteTerm(${jsArg(t.name)})">Delete</button>`}</td></tr>`).join('')}
      </tbody></table>`;
  } else {
    const who = { both: 'Students & Staff', students: 'Students', staff: 'Staff' };
    body = note('<b>School holidays and closures.</b> Each holiday has a date range, a category and who it applies to. Holidays that apply to pupils are taken off the term\'s school-day count.')
      + `<div class="sl-list-head"><div class="sl-card-title">School Holidays</div><button type="button" class="post-btn sf-add-btn" onclick="tsOpenHoliday()">+ New Holiday</button></div>
      <div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Holiday Name</th><th>Holiday Category</th><th>Holiday Date Range</th><th>Holiday Applies to</th><th>Actions</th></tr></thead><tbody>
      ${d.holidays.map((h, i) => `<tr><td class="staff-index">${i + 1}</td><td><b>${escapeHtml(h.name)}</b>${h.description ? `<div class="staff-table-sub">${escapeHtml(h.description)}</div>` : ''}</td><td>${escapeHtml(h.category)}</td>
        <td>${tsDate(h.startDate)}${h.endDate !== h.startDate ? ` – ${tsDate(h.endDate)}` : ''}</td><td>${who[h.appliesTo] || h.appliesTo}</td>
        <td class="pf-actions"><button type="button" class="sf-add-new" onclick="tsOpenHoliday(${h.id})">Edit</button> <button type="button" class="sf-add-new ts-danger" onclick="tsDeleteHoliday(${h.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="sl-empty">No holidays yet.</td></tr>'}
      </tbody></table></div>`;
  }
  tsPane(`<div class="staff-directory-shell">${subtabs}<div class="ts-sub-body">${body}</div></div>`);
}
async function tsPost(url, body, method = 'POST') {
  const data = await apiFetch(url, { method, body: body ? JSON.stringify(body) : undefined });
  tsSet(data);
  return data;
}
function tsOpenSwitch() {
  const a = tsView.data.active || {};
  const years = s => (s ? s.split('/').map(Number) : []);
  tsModal('Change Academic Session / Term', `
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="ts-sw-session">Active Academic Session <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-sw-session" onchange="document.getElementById('ts-sw-year').innerHTML=(this.value?this.value.split('/'):[]).map(y=>'<option>'+y+'</option>').join('')">${tsSessionOpts(a.sessionLabel, 'Select Academic Session')}</select></div>
      <div><label class="field-label" for="ts-sw-year">Active Session Year</label><select class="ctrl-select" id="ts-sw-year">${years(a.sessionLabel).map(y => tsOpt(y, y, a.year)).join('')}</select></div>
      <div><label class="field-label" for="ts-sw-term">Active Term / Period <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-sw-term"><option value="">Select Term / Period</option>${tsView.data.terms.map(t => tsOpt(t.name, t.name, a.termLabel)).join('')}</select></div>
    </div>
    <h3 class="sf-section-title">Official Term Date Range</h3>
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="ts-sw-start">Term Start Date</label><input class="field-input" type="date" id="ts-sw-start" value="${escapeHtml(a.startDate || '')}"></div>
      <div><label class="field-label" for="ts-sw-end">Term End Date</label><input class="field-input" type="date" id="ts-sw-end" value="${escapeHtml(a.endDate || '')}"></div>
    </div>
    <p class="staff-table-sub" style="margin-top:6px;">Leave blank if the dates are not known yet. Switching also applies any form and subject teachers you've already carried forward to that session.</p>`,
  '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSwitch()">Switch Over</button>');
}
async function tsSwitch() {
  const body = { sessionLabel: tsVal('ts-sw-session'), termLabel: tsVal('ts-sw-term'), year: tsVal('ts-sw-year'), startDate: tsVal('ts-sw-start'), endDate: tsVal('ts-sw-end') };
  if (!body.sessionLabel || !body.termLabel) return showToast('Choose the session and term');
  const a = tsView.data.active;
  if (a && (a.sessionLabel !== body.sessionLabel || a.termLabel !== body.termLabel) && !await uiConfirm(`Switch the whole portal to ${body.sessionLabel}, ${body.termLabel}? New results, attendance and invoices will be recorded against it.`, { confirmLabel: 'Switch Over' })) return;
  try {
    await tsPost('/api/admin/term-setup/switch', body);
    tsClose();
    if (typeof loadTopbarSession === 'function') loadTopbarSession();
    ['form', 'subj', 'lead'].forEach(k => { tsView[k].session = body.sessionLabel; });
    showToast(`The portal is now on ${body.sessionLabel}, ${body.termLabel}`, 'success');
    tsRenderShell();
  } catch (err) { showToast(err.message); }
}
function tsOpenPeriod(id) {
  const p = id ? tsView.data.periods.find(x => x.id === id) : {};
  tsModal(id ? 'Edit Academic Calendar Period' : 'New Academic Calendar Period', `
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="ts-pd-session">Academic Session <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-pd-session" ${id ? 'disabled' : ''}>${tsSessionOpts(p.sessionLabel || tsView.data.active?.sessionLabel, 'Select Session')}</select></div>
      <div><label class="field-label" for="ts-pd-term">Term <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-pd-term" ${id ? 'disabled' : ''}><option value="">Select Term</option>${tsView.data.terms.map(t => tsOpt(t.name, t.name, p.termLabel)).join('')}</select></div>
      <div><label class="field-label" for="ts-pd-start">Start Date <span class="sf-req">*</span></label><input class="field-input" type="date" id="ts-pd-start" value="${escapeHtml(p.startDate || '')}"></div>
      <div><label class="field-label" for="ts-pd-end">End Date <span class="sf-req">*</span></label><input class="field-input" type="date" id="ts-pd-end" value="${escapeHtml(p.endDate || '')}"></div>
    </div>`,
  `<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSavePeriod(${id || 0})">Save Period</button>`);
}
async function tsSavePeriod(id) {
  const body = { sessionLabel: tsVal('ts-pd-session'), termLabel: tsVal('ts-pd-term'), startDate: tsVal('ts-pd-start'), endDate: tsVal('ts-pd-end') };
  try {
    await tsPost(id ? `/api/admin/term-setup/periods/${id}` : '/api/admin/term-setup/periods', body, id ? 'PUT' : 'POST');
    tsClose(); showToast('Calendar period saved', 'success'); tsRenderSessions();
  } catch (err) { showToast(err.message); }
}
async function tsDeletePeriod(id) {
  if (!await uiConfirm('Delete this calendar period? The session and term stay; only their start and end dates are cleared.', { confirmLabel: 'Delete', danger: true })) return;
  try { await tsPost(`/api/admin/term-setup/periods/${id}`, null, 'DELETE'); showToast('Period deleted', 'success'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}
function tsOpenSession(label) {
  const s = label ? tsView.data.sessions.find(x => x.label === label) : null;
  const next = Math.max(new Date().getFullYear(), ...tsView.data.sessions.map(x => x.startYear || 0)) + (s ? 0 : 1);
  tsModal(s ? `Edit ${escapeHtml(s.label)}` : 'Add Academic / School Session', `
    <label class="field-label">Academic / School Session <span class="sf-req">*</span> <span class="sf-hint">(start year – end year)</span></label>
    <div class="ts-inline"><input class="field-input" type="number" id="ts-ss-start" value="${s ? s.startYear : next}" ${s ? 'disabled' : ''} oninput="document.getElementById('ts-ss-end').value=Number(this.value)+1"><span>–</span><input class="field-input" type="number" id="ts-ss-end" value="${s ? s.endYear : next + 1}" disabled></div>
    <label class="field-label" for="ts-ss-alias" style="margin-top:12px;">Session Name / Alias <span class="sf-hint">(if any — e.g. Summer, Batch A, Cohort 2)</span></label>
    <input class="field-input" id="ts-ss-alias" value="${escapeHtml(s?.alias || '')}">`,
  `<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSaveSession(${s ? jsArg(s.label) : 'null'})">${s ? 'Save' : 'Add'}</button>`);
}
async function tsSaveSession(label) {
  try {
    if (label) await tsPost(`/api/admin/term-setup/sessions/${label.replace('/', '-')}`, { alias: tsVal('ts-ss-alias') }, 'PUT');
    else await tsPost('/api/admin/term-setup/sessions', { startYear: tsVal('ts-ss-start'), endYear: tsVal('ts-ss-end'), alias: tsVal('ts-ss-alias') });
    tsClose(); showToast('Session saved', 'success'); tsRenderSessions();
  } catch (err) { showToast(err.message); }
}
async function tsDeleteSession(label) {
  if (!await uiConfirm(`Delete the ${label} session and its terms? This only works if nothing has been recorded against it yet.`, { confirmLabel: 'Delete', danger: true })) return;
  try { await tsPost(`/api/admin/term-setup/sessions/${label.replace('/', '-')}`, null, 'DELETE'); showToast('Session deleted', 'success'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}
function tsOpenTerm() {
  tsModal('Add Term / Period', '<label class="field-label" for="ts-tm-name">Name <span class="sf-req">*</span></label><input class="field-input" id="ts-tm-name" placeholder="e.g. Summer Term">',
    '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSaveTerm()">Add</button>');
}
async function tsSaveTerm() {
  try { await tsPost('/api/admin/term-setup/terms', { name: tsVal('ts-tm-name') }); tsClose(); showToast('Term added', 'success'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}
async function tsDeleteTerm(name) {
  if (!await uiConfirm(`Delete the term “${name}”?`, { confirmLabel: 'Delete', danger: true })) return;
  try { await tsPost(`/api/admin/term-setup/terms/${encodeURIComponent(name)}`, null, 'DELETE'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}
function tsOpenHoliday(id) {
  const h = id ? tsView.data.holidays.find(x => x.id === id) : { category: 'School Event', appliesTo: 'both' };
  tsModal(id ? 'Edit Holiday' : 'New Holiday', `
    <div class="sf-grid sf-grid-2">
      <div class="sf-span-3"><label class="field-label" for="ts-hd-name">Holiday Name <span class="sf-req">*</span></label><input class="field-input" id="ts-hd-name" value="${escapeHtml(h.name || '')}"></div>
      <div><label class="field-label" for="ts-hd-cat">Holiday Category <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-hd-cat">${tsView.data.categories.map(c => tsOpt(c, c, h.category)).join('')}</select></div>
      <div><label class="field-label" for="ts-hd-who">Holiday Applies to <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-hd-who">${tsOpt('both', 'Applies to Both', h.appliesTo)}${tsOpt('students', 'Applies to Students', h.appliesTo)}${tsOpt('staff', 'Applies to Staff', h.appliesTo)}</select></div>
      <div><label class="field-label" for="ts-hd-start">Start Date <span class="sf-req">*</span></label><input class="field-input" type="date" id="ts-hd-start" value="${escapeHtml(h.startDate || '')}" onchange="const e=document.getElementById('ts-hd-end');if(!e.value)e.value=this.value"></div>
      <div><label class="field-label" for="ts-hd-end">End Date <span class="sf-req">*</span></label><input class="field-input" type="date" id="ts-hd-end" value="${escapeHtml(h.endDate || '')}"></div>
      <div class="sf-span-3"><label class="field-label" for="ts-hd-desc">Description</label><textarea class="field-input" id="ts-hd-desc" rows="2">${escapeHtml(h.description || '')}</textarea></div>
    </div>`,
  `<button type="button" class="btn-outline" onclick="tsClose()">Cancel</button><button type="button" class="post-btn" onclick="tsSaveHoliday(${id || 0})">Save</button>`);
}
async function tsSaveHoliday(id) {
  const body = { name: tsVal('ts-hd-name'), category: tsVal('ts-hd-cat'), appliesTo: tsVal('ts-hd-who'), startDate: tsVal('ts-hd-start'), endDate: tsVal('ts-hd-end'), description: tsVal('ts-hd-desc') };
  try { await tsPost(id ? `/api/admin/term-setup/holidays/${id}` : '/api/admin/term-setup/holidays', body, id ? 'PUT' : 'POST'); tsClose(); showToast('Holiday saved', 'success'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}
async function tsDeleteHoliday(id) {
  if (!await uiConfirm('Delete this holiday?', { confirmLabel: 'Delete', danger: true })) return;
  try { await tsPost(`/api/admin/term-setup/holidays/${id}`, null, 'DELETE'); tsRenderSessions(); } catch (err) { showToast(err.message); }
}

// ═══ 2. Student Class Allocation ═══
const TS_ACTIONS = [
  ['promotion', 'New Session Class Allocation', 'Assign pupils to classes for a new academic session'],
  ['transfer', 'Same Session Class Transfer', 'Move pupils to a different class within the same session'],
  ['graduation', 'Graduate Students', 'Mark pupils as graduated from the school'],
  ['deallocation', 'De-allocate from Class', 'Remove pupils from their current class'],
];
function tsArmOpts(code, sel, allLabel) {
  const arms = tsArms(code);
  if (!code) return '<option value="">Select class first</option>';
  return (allLabel ? tsOpt('', allLabel, sel) : '<option value="">— Arm —</option>') + arms.map(a => tsOpt(a.id, a.name, sel)).join('');
}
function tsRenderAllocation() {
  const al = tsView.alloc;
  const active = tsView.data.active?.sessionLabel || '';
  const nextS = (tsView.data.sessions.find(s => s.startYear === Number(active.split('/')[0]) + 1) || {}).label || '';
  const moves = al.action === 'promotion' || al.action === 'transfer';
  tsPane(`<div class="staff-directory-shell">
    <div class="sl-list-head"><div class="sl-card-title">Select Students to Allocate / Transfer</div><button type="button" class="staff-export-btn" onclick="tsOpenAllocHistory()">Allocation History / Roll Back</button></div>
    <h3 class="ts-step-title"><span class="ts-step-n">1</span> Select Action</h3>
    <div class="ts-action-cards">${TS_ACTIONS.map(([k, t, s]) => `<button type="button" class="ts-action ${al.action === k ? 'active' : ''}" onclick="tsView.alloc.action=${jsArg(k)};tsView.alloc.loaded=null;tsRenderAllocation()"><b>${t}</b><small>${s}</small></button>`).join('')}</div>
    ${al.action ? `<h3 class="ts-step-title"><span class="ts-step-n">2</span> Select Source &amp; Destination</h3>
    <div class="ts-src-dst">
      <div class="ts-box"><h4>From (source)</h4><div class="sf-grid sf-grid-2">
        <div><label class="field-label" for="ts-al-from-session">From Academic Session</label><select class="ctrl-select" id="ts-al-from-session">${tsSessionOpts(active)}</select></div>
        <div><label class="field-label" for="ts-al-from-class">From Class <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-al-from-class" onchange="document.getElementById('ts-al-from-arm').innerHTML=tsArmOpts(this.value==='__UNALLOCATED__'?'':this.value,'','All arms')"><option value="">Select Class</option>${tsClassOpts()}${al.action !== 'deallocation' ? tsOpt('__UNALLOCATED__', 'Not in a class (de-allocated)', '') : ''}</select></div>
        <div><label class="field-label" for="ts-al-from-arm">From Class Arm</label><select class="ctrl-select" id="ts-al-from-arm"><option value="">Select class first</option></select></div>
      </div></div>
      ${moves ? `<div class="ts-box ts-box-to"><h4>To (destination)</h4><div class="sf-grid sf-grid-2">
        ${al.action === 'promotion' ? `<div><label class="field-label" for="ts-al-to-session">Transfer to Session <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-al-to-session">${tsSessionOpts(nextS, 'Select')}</select></div>` : ''}
        <div><label class="field-label" for="ts-al-to-class">Transfer to Class <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-al-to-class" onchange="document.getElementById('ts-al-to-arm').innerHTML=tsArmOpts(this.value)"><option value="">Select Class</option>${tsClassOpts()}</select></div>
        <div><label class="field-label" for="ts-al-to-arm">Transfer to Class Arm</label><select class="ctrl-select" id="ts-al-to-arm"><option value="">Select class first</option></select></div>
      </div></div>` : `<div class="ts-box ts-box-to"><h4>${al.action === 'graduation' ? 'Graduation' : 'De-allocation'}</h4><p class="staff-table-sub">${al.action === 'graduation' ? 'Ticked pupils are marked as graduated and their portal login is switched off. They move to Graduated / Left Students.' : 'Ticked pupils are taken out of their class. They keep their record and login, and you can put them in a class later by choosing “Not in a class” as the source.'}</p></div>`}
    </div>
    <div style="text-align:center;margin-top:14px;"><button type="button" class="post-btn" onclick="tsAllocLoad()">Next</button></div>` : ''}
    <div id="ts-al-students"></div>
  </div>`);
}
async function tsAllocLoad() {
  const al = tsView.alloc;
  const from = { session: tsVal('ts-al-from-session'), classCode: tsVal('ts-al-from-class'), armId: tsVal('ts-al-from-arm') };
  if (!from.classCode) return showToast('Choose the class the pupils are in now');
  const to = { session: tsVal('ts-al-to-session'), classCode: tsVal('ts-al-to-class'), armId: tsVal('ts-al-to-arm') };
  if (al.action === 'promotion' && !to.session) return showToast('Choose the session to move them into');
  if ((al.action === 'promotion' || al.action === 'transfer') && !to.classCode) return showToast('Choose the class to move them into');
  if ((al.action === 'promotion' || al.action === 'transfer') && to.classCode && tsArms(to.classCode).length && !to.armId) return showToast('Choose the class arm to move them into');
  try {
    const q = new URLSearchParams({ classCode: from.classCode, session: from.session });
    if (from.armId) q.set('armId', from.armId);
    const { students } = await apiFetch(`/api/admin/term-setup/allocation/students?${q}`);
    al.students = students;
    al.selected = new Set(students.map(s => s.id));
    al.loaded = { from, to };
    tsRenderAllocStudents();
  } catch (err) { showToast(err.message); }
}
function tsRenderAllocStudents() {
  const al = tsView.alloc;
  const { from, to } = al.loaded;
  const cls = code => (code === '__UNALLOCATED__' ? 'Not in a class' : tsClasses().find(c => c.code === code)?.label || code);
  const arm = id => tsArms(to.classCode).concat(tsArms(from.classCode)).find(a => String(a.id) === String(id))?.name || '';
  const verb = { promotion: 'Allocate', transfer: 'Transfer', graduation: 'Graduate', deallocation: 'De-allocate' }[al.action];
  document.getElementById('ts-al-students').innerHTML = `
    <h3 class="ts-step-title"><span class="ts-step-n">3</span> Select Students &amp; ${verb}</h3>
    <div class="ts-summary"><span><small>FROM</small> ${escapeHtml(from.session)} · ${escapeHtml(cls(from.classCode))}${from.armId ? ` · ${escapeHtml(arm(from.armId))}` : ''}</span>
      ${to.classCode ? `<span><small>TO</small> ${escapeHtml(to.session || from.session)} · ${escapeHtml(cls(to.classCode))}${to.armId ? ` · ${escapeHtml(arm(to.armId))}` : ''}</span>` : ''}</div>
    ${al.action === 'promotion' ? '<p class="staff-table-sub">Untick any pupil who is repeating the class. Promote after the session\'s results are published: a pupil\'s results stay with the class they were in.</p>' : ''}
    <div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>S/N</th><th class="sl-check"><input type="checkbox" aria-label="Select all" ${al.selected.size === al.students.length && al.students.length ? 'checked' : ''} onchange="tsView.alloc.selected=new Set(this.checked?tsView.alloc.students.map(s=>s.id):[]);tsRenderAllocStudents()"></th><th>Photo</th><th>Name</th><th>Current Class</th><th>Reg. No.</th><th>Date of Starting</th><th>${escapeHtml(from.session)} Average</th><th>Attendance %</th></tr></thead><tbody>
    ${al.students.map((s, i) => `<tr class="${al.selected.has(s.id) ? 'sl-row-selected' : ''}"><td class="staff-index">${i + 1}</td>
      <td class="sl-check"><input type="checkbox" aria-label="Select ${escapeHtml(s.name)}" ${al.selected.has(s.id) ? 'checked' : ''} onchange="this.checked?tsView.alloc.selected.add(${jsArg(s.id)}):tsView.alloc.selected.delete(${jsArg(s.id)});this.closest('tr').classList.toggle('sl-row-selected',this.checked);document.getElementById('ts-al-count').textContent=tsView.alloc.selected.size"></td>
      <td>${tsAvatar(s.name, s.photo)}</td><td><div class="staff-table-name">${escapeHtml(s.name)}</div></td><td>${escapeHtml(s.classText)}</td><td class="staff-phone">${escapeHtml(s.regNo || s.id)}</td>
      <td>${tsDate(s.enrolledAt)}</td><td>${s.average == null ? '<span class="staff-table-sub">No results</span>' : s.average}</td><td>${s.attendance == null ? '<span class="staff-table-sub">—</span>' : `${s.attendance}%`}</td></tr>`).join('') || '<tr><td colspan="9" class="sl-empty">No pupils found in that class.</td></tr>'}
    </tbody></table></div>
    ${al.students.length ? `<div style="text-align:center;margin-top:14px;"><button type="button" class="post-btn" onclick="tsAllocProceed()">Proceed (<span id="ts-al-count">${al.selected.size}</span> selected)</button></div>` : ''}`;
}
async function tsAllocProceed() {
  const al = tsView.alloc;
  const { from, to } = al.loaded;
  const ids = [...al.selected];
  if (!ids.length) return showToast('Tick at least one pupil');
  const what = { promotion: `move ${ids.length} pupil${ids.length === 1 ? '' : 's'} into ${to.session}`, transfer: `transfer ${ids.length} pupil${ids.length === 1 ? '' : 's'}`, graduation: `mark ${ids.length} pupil${ids.length === 1 ? '' : 's'} as graduated`, deallocation: `remove ${ids.length} pupil${ids.length === 1 ? '' : 's'} from their class` }[al.action];
  if (!await uiConfirm(`${what.charAt(0).toUpperCase()}${what.slice(1)}? You can undo this from Allocation History / Roll Back.`, { confirmLabel: 'Proceed', danger: al.action === 'graduation' || al.action === 'deallocation' })) return;
  try {
    const data = await apiFetch('/api/admin/term-setup/allocation', { method: 'POST', body: JSON.stringify({ type: al.action, studentIds: ids, fromSession: from.session, fromClass: from.classCode === '__UNALLOCATED__' ? '' : from.classCode, fromArmId: from.armId, toSession: to.session, toClass: to.classCode, toArmId: to.armId }) });
    tsSet(data);
    showToast(data.message, 'success');
    if (typeof populateStudents === 'function') populateStudents();
    tsView.alloc.loaded = null;
    tsRenderAllocation();
  } catch (err) { showToast(err.message); }
}
async function tsOpenAllocHistory() {
  try {
    const { history } = await apiFetch('/api/admin/term-setup/allocation/history');
    tsView.alloc.history = history;
    const type = t => ({ promotion: 'Promotion', transfer: 'Transfer', graduation: 'Graduation', deallocation: 'De-allocation' }[t] || t);
    tsModal('Class Allocation / Transfer / Graduation History', `<div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Type</th><th>Students</th><th>From</th><th>To</th><th>Date</th><th>By</th><th>Action</th></tr></thead><tbody>
      ${history.map((h, i) => `<tr><td class="staff-index">${i + 1}</td><td>${type(h.type)}</td><td>${h.count}${h.rolledBack ? ` <span class="pf-pill pf-pill-warn">${h.rolledBack} rolled back</span>` : ''}</td>
        <td>${escapeHtml(h.fromSession || '')}<div class="staff-table-sub">${escapeHtml(h.fromClass || '')}</div></td><td>${escapeHtml(h.toSession || '')}<div class="staff-table-sub">${escapeHtml(h.toClass || '')}</div></td>
        <td>${tsWhen(h.doneAt)}</td><td>${escapeHtml(h.doneBy || '')}</td>
        <td class="pf-actions">${h.rolledBack < h.count ? `<button type="button" class="sf-add-new" onclick="tsAllocPartial(${h.id})">View Students / Partial Roll Back</button> <button type="button" class="sf-add-new ts-danger" onclick="tsRollback(${h.id})">Roll Back / Undo</button>` : '<span class="staff-table-sub">Rolled back</span>'}</td></tr>`).join('') || '<tr><td colspan="8" class="sl-empty">No allocations yet. Moves made on this page are listed here.</td></tr>'}
    </tbody></table></div>`, '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button>', true);
  } catch (err) { showToast(err.message); }
}
function tsAllocPartial(id) {
  const h = tsView.alloc.history.find(x => x.id === id);
  tsModal(`Students in this ${h.type}`, `<p class="staff-table-sub">Tick the pupils to put back where they were before.</p>
    <table class="staff-table"><thead><tr><th></th><th>Name</th><th>Was in</th><th>Status</th></tr></thead><tbody>
    ${h.students.map(s => `<tr><td class="sl-check">${s.rolledBack ? '' : `<input type="checkbox" class="ts-rb" value="${escapeHtml(s.id)}" aria-label="Roll back ${escapeHtml(s.name)}">`}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.was || '')}</td><td>${s.rolledBack ? '<span class="pf-pill pf-pill-warn">Rolled back</span>' : ''}</td></tr>`).join('')}
    </tbody></table>`,
  `<button type="button" class="btn-outline" onclick="tsOpenAllocHistory()">Back</button><button type="button" class="post-btn" onclick="tsRollback(${id}, [...document.querySelectorAll('.ts-rb:checked')].map(c=>c.value))">Roll Back Selected</button>`, true);
}
async function tsRollback(id, studentIds) {
  if (studentIds && !studentIds.length) return showToast('Tick at least one pupil');
  if (!await uiConfirm(studentIds ? `Put ${studentIds.length} pupil${studentIds.length === 1 ? '' : 's'} back where they were?` : 'Undo this whole allocation and put every pupil back where they were?', { confirmLabel: 'Roll Back', danger: true })) return;
  try {
    const data = await apiFetch(`/api/admin/term-setup/allocation/history/${id}/rollback`, { method: 'POST', body: JSON.stringify({ studentIds }) });
    tsSet(data); showToast(data.message, 'success');
    if (typeof populateStudents === 'function') populateStudents();
    tsOpenAllocHistory();
  } catch (err) { showToast(err.message); }
}

// ═══ 3 & 4. Class / Subject teacher allocation ═══
function tsPager(view, total, rerender) {
  const pages = Math.max(1, Math.ceil(total / TS_PAGE));
  view.page = Math.min(Math.max(1, view.page), pages);
  if (pages <= 1) return '';
  return `<div class="sl-pages">${Array.from({ length: pages }, (_, i) => `<button type="button" class="${i + 1 === view.page ? 'active' : ''}" onclick="${rerender}(${i + 1})">${i + 1}</button>`).join('')}</div>`;
}
function tsAllocHead(kind) {
  const v = kind === 'form' ? tsView.form : tsView.subj;
  const s = v.stats || { total: 0, filled: 0, direct: 0, inherited: 0, pending: 0 };
  const pct = s.total ? Math.round((s.filled / s.total) * 100) : 0;
  const prefix = kind === 'form' ? 'tsf' : 'tss';
  return `<div class="ts-filter-row">
      <div><label class="field-label" for="${prefix}-session">Academic Session</label><select class="ctrl-select" id="${prefix}-session">${tsSessionOpts(v.session)}</select></div>
      <div><label class="field-label" for="${prefix}-class">Class</label><select class="ctrl-select" id="${prefix}-class">${tsClassOpts(v.classCode, 'All Classes')}</select></div>
      <button type="button" class="post-btn" onclick="${kind === 'form' ? 'tsLoadForm' : 'tsLoadSubj'}(true)">Load</button>
      <div class="sl-menu-wrap"><button type="button" class="staff-export-btn" onclick="slToggleMenu('${prefix}-cf-menu', event)">Carry Forward ▾</button>
        <div class="sf-add-menu sl-menu" id="${prefix}-cf-menu" role="menu" hidden><button type="button" role="menuitem" onclick="tsOpenCarry(${jsArg(kind)})">Copy allocations to another session…</button></div></div>
    </div>
    <div class="ts-stat-row">
      <div class="ts-stat"><b>${s.total}</b><small>Total ${kind === 'form' ? 'Arms' : 'Slots'}</small></div>
      <div class="ts-stat ts-stat-blue"><b>${s.filled}</b><small>Filled</small><em>${s.direct} direct · ${s.inherited} inherited</em></div>
      <div class="ts-stat ts-stat-red"><b>${s.pending}</b><small>Pending</small><em>Need assignment</em></div>
      <div class="ts-stat ts-stat-green"><b>${pct}%</b><small>Complete</small><span class="ts-bar"><i style="width:${pct}%"></i></span></div>
    </div>
    ${kind === 'subj' ? `<p class="staff-table-sub">${s.subjects || 0} unique subjects · ${s.teachers || 0} unique teachers assigned</p>` : ''}
    ${v.session !== tsView.data.active?.sessionLabel ? `<div class="ts-note">Viewing <b>${escapeHtml(v.session)}</b>. Changes here are saved for that session and take effect when the portal switches to it. <button type="button" class="sf-add-new" onclick="${kind === 'form' ? 'tsView.form' : 'tsView.subj'}.session=${jsArg(tsView.data.active?.sessionLabel || '')};${kind === 'form' ? 'tsLoadForm' : 'tsLoadSubj'}()">Back to current</button></div>` : ''}
    <div class="ts-filter-row ts-filter-row-2">
      <div class="sl-menu-wrap"><button type="button" class="staff-export-btn" onclick="slToggleMenu('${prefix}-export-menu', event)">Export List ▾</button>
        <div class="sf-add-menu sl-menu" id="${prefix}-export-menu" role="menu" hidden>${['doc', 'csv', 'xls', 'xlsx'].map(f => `<button type="button" role="menuitem" onclick="tsExport(${jsArg(kind)},${jsArg(f)})">${f.toUpperCase()}</button>`).join('')}</div></div>
      <input class="staff-search-light" placeholder="Search…" aria-label="Search" value="${escapeHtml(v.search)}" oninput="${kind === 'form' ? 'tsView.form' : 'tsView.subj'}.search=this.value;${kind === 'form' ? 'tsView.form' : 'tsView.subj'}.page=1;${kind === 'form' ? 'tsRenderFormRows' : 'tsRenderSubjRows'}()">
    </div>`;
}
const tsMatch = (text, q) => !q || text.toLowerCase().includes(q.toLowerCase());
async function tsLoadForm(fromControls) {
  const v = tsView.form;
  if (fromControls) { v.session = tsVal('tsf-session'); v.classCode = tsVal('tsf-class'); v.page = 1; }
  try {
    const q = new URLSearchParams({ session: v.session, classCode: v.classCode });
    const data = await apiFetch(`/api/admin/term-setup/form-teachers?${q}`);
    v.rows = data.rows; v.stats = data.stats;
    tsPane(`<div class="staff-directory-shell">${tsAllocHead('form')}<div id="tsf-rows"></div></div>`);
    tsRenderFormRows();
  } catch (err) { showToast(err.message); }
}
function tsFormRows() { const v = tsView.form; return v.rows.filter(r => tsMatch(`${r.classLabel} ${r.armName} ${r.teacher?.name || ''} ${r.status}`, v.search)); }
function tsRenderFormRows(page) {
  const v = tsView.form;
  if (page) v.page = page;
  const rows = tsFormRows();
  const pager = tsPager(v, rows.length, 'tsRenderFormRows');
  const start = (v.page - 1) * TS_PAGE;
  document.getElementById('tsf-rows').innerHTML = `<div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Session</th><th>Class</th><th>Class Arm</th><th>Form Teacher</th><th>Status</th><th>Action</th><th>History</th></tr></thead><tbody>
    ${rows.slice(start, start + TS_PAGE).map((r, i) => `<tr><td class="staff-index">${start + i + 1}</td><td>${escapeHtml(r.session)}</td><td>${escapeHtml(r.classLabel)}</td><td>${escapeHtml(r.armName || '—')}</td>
      <td>${r.teacher ? `<div class="sl-name-cell">${tsAvatar(r.teacher.name, r.teacher.photo)}<span>${escapeHtml(r.teacher.name)}</span></div>` : '<span class="staff-table-sub">Not assigned</span>'}</td>
      <td>${tsPill(r.status)}</td><td><button type="button" class="sf-add-new" onclick="tsOpenFormEdit(${jsArg(r.classCode)}, ${r.armId || 0})">Edit</button></td>
      <td><button type="button" class="sf-add-new" onclick="tsOpenFormHistory(${jsArg(r.classCode)}, ${r.armId || 0})">History</button></td></tr>`).join('') || '<tr><td colspan="8" class="sl-empty">Nothing matches.</td></tr>'}
  </tbody></table></div><div class="sl-footer"><span>Showing ${rows.length ? start + 1 : 0} to ${Math.min(start + TS_PAGE, rows.length)} of ${rows.length} entries</span>${pager}</div>`;
}
function tsOpenFormEdit(classCode, armId) {
  const r = tsView.form.rows.find(x => x.classCode === classCode && (x.armId || 0) === armId);
  const current = tsView.form.session === tsView.data.active?.sessionLabel;
  tsModal(`Assign Form Teacher`, `
    <p class="staff-table-sub" style="margin-top:0;">${escapeHtml(r.classLabel)}${r.armName ? ` · ${escapeHtml(r.armName)}` : ''} · ${escapeHtml(tsView.form.session)}</p>
    <label class="field-label" for="tsf-teacher">Form Teacher <span class="sf-req">*</span></label>
    <select class="ctrl-select" id="tsf-teacher"><option value="">— Unassigned —</option>${tsTeachers().map(t => tsOpt(t.id, `${t.name} (${t.id})`, r.teacher?.id)).join('')}</select>
    <p class="staff-table-sub">Choosing “Unassigned” removes the current teacher; the class arm then shows as unassigned.</p>
    <label class="field-label" for="tsf-notes">Notes (optional)</label><textarea class="field-input" id="tsf-notes" rows="2">${escapeHtml(r.notes || '')}</textarea>
    ${current ? `<h3 class="sf-section-title">Additional Options</h3>
    <label class="sf-check"><input type="checkbox" id="tsf-also"> Also assign this teacher to all subjects of this class arm <span class="sf-hint">(makes them the teacher in charge of each subject)</span></label>
    <label class="sf-check"><input type="checkbox" id="tsf-remove"> Remove the previous teacher from all subjects of this class arm <span class="sf-hint">(except subjects where they already have results saved)</span></label>` : ''}`,
  `<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSaveForm(${jsArg(classCode)}, ${armId})">Save Allocation</button>`);
}
async function tsSaveForm(classCode, armId) {
  try {
    const data = await apiFetch('/api/admin/term-setup/form-teachers', { method: 'PUT', body: JSON.stringify({ session: tsView.form.session, classCode, armId, teacherId: tsVal('tsf-teacher'), notes: tsVal('tsf-notes'), alsoSubjects: document.getElementById('tsf-also')?.checked, removePrevious: document.getElementById('tsf-remove')?.checked }) });
    tsSet(data); tsClose(); showToast(data.note || 'Form teacher saved', data.note ? 'info' : 'success'); tsLoadForm();
  } catch (err) { showToast(err.message); }
}
async function tsOpenFormHistory(classCode, armId) {
  const r = tsView.form.rows.find(x => x.classCode === classCode && (x.armId || 0) === armId);
  try {
    const { history } = await apiFetch(`/api/admin/term-setup/form-teachers/history?${new URLSearchParams({ classCode, armId: armId || '' })}`);
    tsHistoryModal(`Form Teacher History — ${escapeHtml(r.classLabel)}${r.armName ? ` · ${escapeHtml(r.armName)}` : ''}`, ['Session', 'Teacher', 'Notes', 'Allocated By', 'Date Assigned', 'Status'],
      history.map(h => ({ removed: h.removed, cells: [h.session, h.teacher, h.notes, h.by, tsWhen(h.at)] })));
  } catch (err) { showToast(err.message); }
}
function tsHistoryModal(title, headers, rows) {
  const render = showRemoved => rows.filter(r => showRemoved || !r.removed).map(r => `<tr>${r.cells.map(c => `<td>${escapeHtml(c || '')}</td>`).join('')}<td>${r.removed ? '<span class="pf-pill pf-pill-rel">Replaced</span>' : '<span class="pf-pill pf-pill-in">Current</span>'}</td></tr>`).join('') || `<tr><td colspan="${headers.length}" class="sl-empty">No allocation history yet.</td></tr>`;
  tsModal(title, `<label class="sf-check" style="margin:0 0 10px;"><input type="checkbox" onchange="document.getElementById('ts-hist-body').innerHTML=tsHistoryModal.render(this.checked)"> Show replaced</label>
    <div style="overflow-x:auto;"><table class="staff-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody id="ts-hist-body">${render(false)}</tbody></table></div>`,
  '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button>', true);
  tsHistoryModal.render = render;
}

async function tsLoadSubj(fromControls) {
  const v = tsView.subj;
  if (fromControls) { v.session = tsVal('tss-session'); v.classCode = tsVal('tss-class'); v.page = 1; }
  try {
    const data = await apiFetch(`/api/admin/term-setup/subject-teachers?${new URLSearchParams({ session: v.session, classCode: v.classCode })}`);
    v.rows = data.rows; v.stats = data.stats;
    tsPane(`<div class="staff-directory-shell">${tsAllocHead('subj')}<div id="tss-rows"></div></div>`);
    tsRenderSubjRows();
  } catch (err) { showToast(err.message); }
}
function tsSubjRows() { const v = tsView.subj; return v.rows.filter(r => tsMatch(`${r.classLabel} ${r.subject} ${r.armName} ${r.teachers.map(t => t.name).join(' ')} ${r.status}`, v.search)); }
function tsRenderSubjRows(page) {
  const v = tsView.subj;
  if (page) v.page = page;
  const rows = tsSubjRows();
  const pager = tsPager(v, rows.length, 'tsRenderSubjRows');
  const start = (v.page - 1) * TS_PAGE;
  document.getElementById('tss-rows').innerHTML = `<div style="overflow-x:auto;"><table class="staff-table"><thead><tr><th>#</th><th>Session</th><th>Class</th><th>Subject</th><th>Class Arm</th><th>Teachers</th><th>Status</th><th>Action</th><th>History</th></tr></thead><tbody>
    ${rows.slice(start, start + TS_PAGE).map((r, i) => `<tr><td class="staff-index">${start + i + 1}</td><td>${escapeHtml(r.session)}</td><td>${escapeHtml(r.classLabel)}</td><td><b>${escapeHtml(r.subject)}</b>${r.term ? `<div class="staff-table-sub">${escapeHtml(r.term)}</div>` : ''}</td><td>${escapeHtml(r.armName || '—')}</td>
      <td>${r.teachers.map(t => `<div class="pf-ward-line">${escapeHtml(t.name)}${t.inCharge ? ' <span class="pf-pill pf-pill-in">In charge</span>' : ''}</div>`).join('') || '<span class="staff-table-sub">Not assigned</span>'}</td>
      <td>${tsPill(r.status)}</td><td><button type="button" class="sf-add-new" onclick="tsOpenSubjAssign(${r.id})">Assign</button></td><td><button type="button" class="sf-add-new" onclick="tsOpenSubjHistory(${r.id})">History</button></td></tr>`).join('') || '<tr><td colspan="9" class="sl-empty">Nothing matches.</td></tr>'}
  </tbody></table></div><div class="sl-footer"><span>Showing ${rows.length ? start + 1 : 0} to ${Math.min(start + TS_PAGE, rows.length)} of ${rows.length} entries</span>${pager}</div>`;
}
function tsOpenSubjAssign(id) {
  const r = tsView.subj.rows.find(x => x.id === id);
  tsModal('Assign Subject Teachers', `
    <p class="staff-table-sub" style="margin-top:0;">${escapeHtml(r.subject)} · ${escapeHtml(r.classLabel)}${r.armName ? ` · ${escapeHtml(r.armName)}` : ''} · ${escapeHtml(tsView.subj.session)}</p>
    <h3 class="sf-section-title">Assigned Teachers</h3>
    ${r.teachers.length ? `<table class="staff-table"><tbody>${r.teachers.map(t => `<tr><td>${escapeHtml(t.name)} ${t.inCharge ? '<span class="pf-pill pf-pill-in">In charge</span>' : ''}</td><td style="text-align:right;"><button type="button" class="del-btn" onclick="tsSubjRemove(${id}, ${jsArg(t.id)})">Remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="staff-table-sub">No teachers assigned for this session.</p>'}
    <h3 class="sf-section-title">Add Teacher</h3>
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="tss-teacher">Teacher <span class="sf-req">*</span></label><select class="ctrl-select" id="tss-teacher"><option value="">— Select Teacher —</option>${tsTeachers().filter(t => !r.teachers.some(x => x.id === t.id)).map(t => tsOpt(t.id, `${t.name} (${t.id})`, '')).join('')}</select></div>
      <div style="align-self:end;"><label class="sf-check"><input type="checkbox" id="tss-incharge" ${r.teachers.length ? '' : 'checked'}> In-Charge</label></div>
    </div>
    <button type="button" class="post-btn" style="margin-top:10px;" onclick="tsSubjAdd(${id})">Add Teacher to Subject</button>`,
  '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button>');
}
async function tsSubjAdd(id) {
  const teacherId = tsVal('tss-teacher');
  if (!teacherId) return showToast('Choose a teacher');
  try {
    tsSet(await apiFetch(`/api/admin/term-setup/subject-teachers/${id}`, { method: 'POST', body: JSON.stringify({ session: tsView.subj.session, teacherId, inCharge: document.getElementById('tss-incharge').checked }) }));
    showToast('Teacher added', 'success'); await tsLoadSubj(); tsOpenSubjAssign(id);
  } catch (err) { showToast(err.message); }
}
async function tsSubjRemove(id, teacherId) {
  if (!await uiConfirm('Remove this teacher from the subject?', { confirmLabel: 'Remove' })) return;
  try {
    tsSet(await apiFetch(`/api/admin/term-setup/subject-teachers/${id}/${encodeURIComponent(teacherId)}?session=${encodeURIComponent(tsView.subj.session)}`, { method: 'DELETE' }));
    showToast('Teacher removed', 'success'); await tsLoadSubj(); tsOpenSubjAssign(id);
  } catch (err) { showToast(err.message); }
}
async function tsOpenSubjHistory(id) {
  const r = tsView.subj.rows.find(x => x.id === id);
  try {
    const { history } = await apiFetch(`/api/admin/term-setup/subject-teachers/history?classSubjectId=${id}`);
    tsHistoryModal(`Subject Teacher History — ${escapeHtml(r.subject)} · ${escapeHtml(r.classLabel)}`, ['Session', 'Teacher', 'Role', 'Allocated By', 'Date Assigned', 'Status'],
      history.map(h => ({ removed: h.removed, cells: [h.session, h.teacher, h.inCharge ? 'In charge' : 'Assisting', h.by, tsWhen(h.at)] })));
  } catch (err) { showToast(err.message); }
}
function tsExport(kind, format) {
  document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
  if (kind === 'form') {
    const rows = tsFormRows();
    slExport(format, { headers: ['S/N', 'Session', 'Class', 'Class Arm', 'Form Teacher', 'Status'], rows: rows.map((r, i) => [i + 1, r.session, r.classLabel, r.armName, r.teacher?.name || '', tsStatus(r.status)[0]]) }, 'form-teacher-allocation');
  } else {
    const rows = tsSubjRows();
    slExport(format, { headers: ['S/N', 'Session', 'Class', 'Subject', 'Class Arm', 'Teachers', 'Status'], rows: rows.map((r, i) => [i + 1, r.session, r.classLabel, r.subject, r.armName, r.teachers.map(t => `${t.name}${t.inCharge ? ' (in charge)' : ''}`).join(', '), tsStatus(r.status)[0]]) }, 'subject-teacher-allocation');
  }
}

// Carry forward (form / subject teachers): pick sessions → review → copy
function tsOpenCarry(kind) {
  document.querySelectorAll('.sl-menu').forEach(m => { m.hidden = true; });
  const v = kind === 'form' ? tsView.form : tsView.subj;
  const active = tsView.data.active?.sessionLabel || '';
  const nextS = (tsView.data.sessions.find(s => s.startYear === Number(active.split('/')[0]) + 1) || {}).label || '';
  tsModal(`Carry Forward: ${kind === 'form' ? 'Form Teacher' : 'Subject Teacher'} Allocations`, `
    <div class="sf-steps ts-cf-steps"><span class="active">1 Select Sessions</span><span>2 Review &amp; Assign</span></div>
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="ts-cf-from">Copy From (Source Session) <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-cf-from">${tsSessionOpts(v.session || active, '— Select —')}</select></div>
      <div><label class="field-label" for="ts-cf-to">Copy To (Target Session) <span class="sf-req">*</span></label><select class="ctrl-select" id="ts-cf-to">${tsSessionOpts(nextS, '— Select —')}</select></div>
    </div>`,
  `<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsCarryPreview(${jsArg(kind)})">Next</button>`, true);
}
async function tsCarryPreview(kind) {
  const from = tsVal('ts-cf-from');
  const to = tsVal('ts-cf-to');
  if (!from || !to) return showToast('Choose both sessions');
  if (from === to) return showToast('Choose two different sessions');
  try {
    const { rows } = await apiFetch(`/api/admin/term-setup/${kind}-teachers/carry-forward/preview`, { method: 'POST', body: JSON.stringify({ from, to }) });
    tsView.carry = { kind, from, to, rows };
    const teacherOpts = sel => `<option value="">— Unassign —</option>${tsTeachers().map(t => tsOpt(t.id, t.name, sel)).join('')}`;
    tsModal(`Carry Forward: ${from} → ${to}`, `
      <div class="sf-steps ts-cf-steps"><span class="done">1 Select Sessions</span><span class="active">2 Review &amp; Assign</span></div>
      <p class="staff-table-sub">Review each row. ${kind === 'form' ? 'Change the teacher in any row, or untick Include to skip it.' : 'Untick Include to skip a row.'} Rows marked “already set” have an allocation in ${escapeHtml(to)} — tick Override to replace it.</p>
      ${rows.length ? `<div style="overflow-x:auto;max-height:52vh;"><table class="staff-table"><thead><tr><th>Include</th><th>${kind === 'form' ? 'Class Arm' : 'Class · Subject'}</th><th>${kind === 'form' ? 'Teacher' : 'Teachers'}</th><th>In ${escapeHtml(to)}</th><th>Override</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.existing ? 'ts-cf-existing' : ''}"><td class="sl-check"><input type="checkbox" class="ts-cf-inc" data-i="${i}" ${r.existing ? '' : 'checked'}></td><td>${escapeHtml(r.label)}</td>
        <td>${kind === 'form' ? `<select class="ctrl-select ts-cf-teacher" data-i="${i}">${teacherOpts(r.teacherId)}</select>` : escapeHtml(r.teachers.map(t => `${t.name}${t.inCharge ? ' (in charge)' : ''}`).join(', '))}</td>
        <td>${r.existing ? `<span class="pf-pill pf-pill-warn">Already set</span> <span class="staff-table-sub">${escapeHtml(r.existing)}</span>` : '<span class="staff-table-sub">Empty</span>'}</td>
        <td class="sl-check">${r.existing ? `<input type="checkbox" class="ts-cf-ovr" data-i="${i}" onchange="if(this.checked)document.querySelector('.ts-cf-inc[data-i=&quot;${i}&quot;]').checked=true">` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="sl-empty">No allocations found in ${escapeHtml(from)}.</p>`}`,
    `<button type="button" class="btn-outline" onclick="tsOpenCarry(${jsArg(kind)})">Back</button>${rows.length ? `<button type="button" class="post-btn" onclick="tsCarryApply()">Confirm Copy</button>` : ''}`, true);
  } catch (err) { showToast(err.message); }
}
async function tsCarryApply() {
  const c = tsView.carry;
  const picked = [...document.querySelectorAll('.ts-cf-inc:checked')].map(el => Number(el.dataset.i));
  if (!picked.length) return showToast('Include at least one row');
  const rows = picked.map(i => {
    const r = c.rows[i];
    const override = !!document.querySelector(`.ts-cf-ovr[data-i="${i}"]`)?.checked;
    if (c.kind === 'form') return { classCode: r.classCode, armId: r.armId, teacherId: document.querySelector(`.ts-cf-teacher[data-i="${i}"]`).value, override };
    return { classSubjectId: r.classSubjectId, teachers: r.teachers, override };
  });
  const blocked = rows.filter((r, n) => c.rows[picked[n]].existing && !r.override).length;
  try {
    const data = await apiFetch(`/api/admin/term-setup/${c.kind}-teachers/carry-forward`, { method: 'POST', body: JSON.stringify({ from: c.from, to: c.to, rows }) });
    tsSet(data); tsClose();
    showToast(`Copied ${data.copied} allocation${data.copied === 1 ? '' : 's'} to ${c.to}${blocked ? ` (${blocked} already set, not overridden)` : ''}`, 'success');
    if (c.kind === 'form') { tsView.form.session = c.to; tsLoadForm(); } else { tsView.subj.session = c.to; tsLoadSubj(); }
  } catch (err) { showToast(err.message); }
}

// ═══ 5. Academic Leadership ═══
async function tsLoadLead(session) {
  const v = tsView.lead;
  if (session) v.session = session;
  try {
    const data = await apiFetch(`/api/admin/term-setup/leadership?session=${encodeURIComponent(v.session)}`);
    v.sections = data.sections; v.permissions = data.permissions;
    tsRenderLead();
  } catch (err) { showToast(err.message); }
}
function tsRenderLead() {
  const v = tsView.lead;
  const head = (h, empty) => (h ? `<div class="ts-head-line">${tsAvatar(h.staff?.name, h.staff?.photo)}<span><b>${escapeHtml(h.staff?.name || '')}</b>${h.title ? ` <span class="pf-pill pf-pill-rel">${escapeHtml(h.title)}</span>` : ''}<small>${h.permissions.length} permission${h.permissions.length === 1 ? '' : 's'}</small></span></div>` : `<span class="staff-table-sub">${empty}</span>`);
  tsPane(`<div class="staff-directory-shell">
    <div class="ts-filter-row"><div><label class="field-label" for="tsl-session">Academic Session</label><select class="ctrl-select" id="tsl-session" onchange="tsLoadLead(this.value)">${tsSessionOpts(v.session)}</select></div>
      <span class="af-spacer"></span><button type="button" class="staff-export-btn" onclick="tsOpenLeadCarry()">Carry Forward</button></div>
    <div class="ts-note">Section heads and class heads, with the access each one should have. These are saved as the school's leadership record for the session.</div>
    ${v.sections.map(s => `<div class="ts-section">
      <div class="ts-section-head"><span class="ts-section-title">${escapeHtml(s.label)}</span>${head(s.head, 'No sectional head assigned')}
        <span class="pf-actions"><button type="button" class="sf-add-new" onclick="tsOpenHead('section', ${jsArg(s.key)}, ${jsArg(s.label)})">Assign Head</button> <button type="button" class="sf-add-new" onclick="tsOpenHeadHistory('section', ${jsArg(s.key)}, ${jsArg(s.label)})">History</button></span></div>
      ${s.classes.map(c => `<div class="ts-class-row"><span class="ts-class-name">${escapeHtml(c.label)}</span>${head(c.head, 'No class head assigned')}
        <span class="pf-actions"><button type="button" class="sf-add-new" onclick="tsOpenHead('class', ${jsArg(c.key)}, ${jsArg(c.label)})">Assign Head</button> <button type="button" class="sf-add-new" onclick="tsOpenHeadHistory('class', ${jsArg(c.key)}, ${jsArg(c.label)})">History</button></span></div>`).join('')}
    </div>`).join('')}
  </div>`);
}
function tsOpenHead(scope, key, label) {
  const v = tsView.lead;
  const sec = v.sections.find(s => s.key === key);
  const h = scope === 'section' ? sec?.head : v.sections.flatMap(s => s.classes).find(c => c.key === key)?.head;
  const has = new Set(h?.permissions || []);
  tsModal(`Assign ${scope === 'section' ? 'Sectional' : 'Class'} Head`, `
    <p class="staff-table-sub" style="margin-top:0;">${scope === 'section' ? 'Section' : 'Class'}: ${escapeHtml(label)} · ${escapeHtml(v.session)}</p>
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="tsl-staff">Staff Member <span class="sf-req">*</span></label><select class="ctrl-select" id="tsl-staff"><option value="">— Select Staff —</option>${tsStaffAll().map(t => tsOpt(t.id, t.name, h?.staff?.id)).join('')}</select></div>
      <div><label class="field-label" for="tsl-title">Position Title</label><input class="field-input" id="tsl-title" value="${escapeHtml(h?.title || '')}" placeholder="${scope === 'section' ? 'e.g. Head of Primary' : 'e.g. Class Head'}"></div>
      <div class="sf-span-3"><label class="field-label" for="tsl-notes">Notes (optional)</label><textarea class="field-input" id="tsl-notes" rows="2">${escapeHtml(h?.notes || '')}</textarea></div>
    </div>
    <h3 class="sf-section-title">Access Permissions <label class="sf-check" style="display:inline-flex;margin:0 0 0 10px;"><input type="checkbox" onchange="document.querySelectorAll('.tsl-perm,.tsl-group').forEach(c=>c.checked=this.checked)"> Select All</label></h3>
    <div class="ts-perm-grid">${v.permissions.map(([group, items], g) => `<div class="ts-perm-group"><label class="sf-check"><input type="checkbox" class="tsl-group" onchange="document.querySelectorAll('.tsl-perm[data-g=&quot;${g}&quot;]').forEach(c=>c.checked=this.checked)"> <b>${escapeHtml(group)}</b> <span class="sf-hint">All</span></label>
      ${items.map(([k, l]) => `<label class="sf-check"><input type="checkbox" class="tsl-perm" data-g="${g}" value="${k}" ${has.has(k) ? 'checked' : ''}> ${escapeHtml(l)}</label>`).join('')}</div>`).join('')}</div>`,
  `${h ? `<button type="button" class="btn-outline ts-danger" onclick="tsRemoveHead(${jsArg(scope)}, ${jsArg(key)})">Unassign</button><span class="af-spacer"></span>` : ''}<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="post-btn" onclick="tsSaveHead(${jsArg(scope)}, ${jsArg(key)})">Save Head</button>`, true);
}
async function tsSaveHead(scope, key) {
  const staffId = tsVal('tsl-staff');
  if (!staffId) return showToast('Choose a staff member');
  try {
    const data = await apiFetch('/api/admin/term-setup/leadership', { method: 'PUT', body: JSON.stringify({ session: tsView.lead.session, scope, key, staffId, title: tsVal('tsl-title'), notes: tsVal('tsl-notes'), permissions: [...document.querySelectorAll('.tsl-perm:checked')].map(c => c.value) }) });
    tsView.lead.sections = data.sections; tsClose(); showToast('Head saved', 'success'); tsRenderLead();
  } catch (err) { showToast(err.message); }
}
async function tsRemoveHead(scope, key) {
  if (!await uiConfirm('Unassign this head for the session?', { confirmLabel: 'Unassign', danger: true })) return;
  try {
    const data = await apiFetch('/api/admin/term-setup/leadership', { method: 'DELETE', body: JSON.stringify({ session: tsView.lead.session, scope, key }) });
    tsView.lead.sections = data.sections; tsClose(); tsRenderLead();
  } catch (err) { showToast(err.message); }
}
async function tsOpenHeadHistory(scope, key, label) {
  try {
    const { history } = await apiFetch(`/api/admin/term-setup/leadership/history?${new URLSearchParams({ scope, key })}`);
    tsHistoryModal(`${scope === 'section' ? 'Sectional' : 'Class'} Head History — ${escapeHtml(label)}`, ['Session', 'Staff', 'Title', 'Allocated By', 'Date Assigned', 'Status'],
      history.map(h => ({ removed: h.removed, cells: [h.session, h.staff, h.title, h.by, tsWhen(h.at)] })));
  } catch (err) { showToast(err.message); }
}
function tsOpenLeadCarry() {
  const v = tsView.lead;
  tsModal('Carry Forward Academic Leadership', `<p class="staff-table-sub" style="margin-top:0;">Copies every section head and class head (with titles and permissions) from one session to another. Heads already set in the target session are kept.</p>
    <div class="sf-grid sf-grid-2">
      <div><label class="field-label" for="tsl-cf-from">From Session</label><select class="ctrl-select" id="tsl-cf-from">${tsSessionOpts(v.session)}</select></div>
      <div><label class="field-label" for="tsl-cf-to">To Session <span class="sf-req">*</span></label><select class="ctrl-select" id="tsl-cf-to">${tsSessionOpts('', '— Select target session —')}</select></div>
    </div><p id="tsl-cf-preview" class="af-preview" style="margin:10px 0 0;"></p>`,
  '<button type="button" class="btn-outline btn-close" onclick="tsClose()">Close</button><button type="button" class="btn-outline" onclick="tsLeadCarry(true)">Preview</button><button type="button" class="post-btn" onclick="tsLeadCarry(false)">Carry Forward</button>');
}
async function tsLeadCarry(preview) {
  const from = tsVal('tsl-cf-from');
  const to = tsVal('tsl-cf-to');
  if (!to || from === to) return showToast('Choose a different target session');
  try {
    const data = await apiFetch(`/api/admin/term-setup/leadership/carry-forward${preview ? '/preview' : ''}`, { method: 'POST', body: JSON.stringify({ from, to }) });
    if (preview) { document.getElementById('tsl-cf-preview').textContent = `${data.copy} head${data.copy === 1 ? '' : 's'} will be copied${data.skip ? `, ${data.skip} already set in ${to} will be kept` : ''}.`; return; }
    tsClose(); showToast(`Copied ${data.copied} head${data.copied === 1 ? '' : 's'} to ${to}`, 'success'); tsLoadLead(to);
  } catch (err) { showToast(err.message); }
}

// ═══ 6. Fees Setup ═══
function tsRenderFees() {
  const a = tsView.data.active || {};
  tsPane(`<div class="staff-directory-shell">
    <div class="sl-list-head"><div class="sl-card-title">Select Options to Manage Fees</div></div>
    <div class="sf-grid ts-fee-grid" style="margin-top:14px;">
      <div><label class="field-label" for="tsfee-class">Class <span class="sf-req">*</span></label><select class="ctrl-select" id="tsfee-class" onchange="document.getElementById('tsfee-arm').innerHTML=tsArmOpts(this.value,'','All arms')"><option value="">Select Class</option>${tsClassOpts()}</select></div>
      <div><label class="field-label" for="tsfee-arm">Class Arm</label><select class="ctrl-select" id="tsfee-arm"><option value="">Select class first</option></select></div>
      <div><label class="field-label" for="tsfee-session">Fees Session <span class="sf-req">*</span></label><select class="ctrl-select" id="tsfee-session">${tsSessionOpts(a.sessionLabel)}</select></div>
      <div><label class="field-label" for="tsfee-term">Fees Term <span class="sf-req">*</span></label><select class="ctrl-select" id="tsfee-term">${tsView.data.terms.map(t => tsOpt(t.name, t.name, a.termLabel)).join('')}</select></div>
    </div>
    <div style="text-align:center;margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button type="button" class="post-btn" onclick="tsGoFees()">Go to Class Fees</button>
      <button type="button" class="btn-outline" onclick="tsNewClassInvoice()">Create Class Invoice</button>
    </div>
    <p class="staff-table-sub" style="text-align:center;">“Go to Class Fees” opens the class's invoices for that session and term. New invoices are created for the active term.</p>
  </div>`);
}
async function tsGoFees() {
  const classCode = tsVal('tsfee-class');
  if (!classCode) return showToast('Choose the class');
  const period = tsView.data.periods.find(p => p.sessionLabel === tsVal('tsfee-session') && p.termLabel === tsVal('tsfee-term'));
  switchTab('classInvoiceHistory', document.querySelector('.sub-nav-item[data-tab="classInvoiceHistory"]'));
  await new Promise(r => setTimeout(r, 400));
  const term = document.getElementById('cih-term');
  if (term && period && [...term.options].some(o => o.value === String(period.id))) term.value = String(period.id);
  const cls = document.getElementById('cih-class');
  if (cls) cls.value = classCode;
  if (typeof cihLoadList === 'function') cihLoadList();
  if (!period) showToast('That session and term has no invoices yet, so all terms are shown');
}
function tsNewClassInvoice() {
  const classCode = tsVal('tsfee-class');
  if (typeof openNewInvoiceModal !== 'function') return;
  openNewInvoiceModal();
  document.getElementById('ni-mode').value = 'class';
  niToggleMode();
  if (classCode) document.getElementById('ni-class').value = classCode;
}
