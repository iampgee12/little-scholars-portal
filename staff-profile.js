// Admin → Staff Information card and Staff Profile page. Clicking a staff
// member's photo or name on Staff / Employees opens the card (like a pupil's
// on View Students); its "Go to profile page" opens the page: Profile,
// Classes & Subjects, Update Profile, Password Update and Activity.
// Styling is the pupil card's and profile page's (enrol.css, .stu-* / .spf-*).

const SFP = { id: null, tab: 'profile', from: 'staff' };

const SFP_TABS = [
  ['profile', 'Profile', '<circle cx="8" cy="5" r="3"/><path d="M2.5 14.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>'],
  ['subjects', 'Classes & Subjects', '<path d="M2 3.5c2-1 4-1 6 .5 2-1.5 4-1.5 6-.5v9.5c-2-1-4-1-6 .5-2-1.5-4-1.5-6-.5z"/><line x1="8" y1="4" x2="8" y2="13.5"/>'],
  ['edit', 'Update Profile', '<path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/><line x1="9.5" y1="4" x2="12" y2="6.5"/>'],
  ['password', 'Password Update', '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>'],
  ['activity', 'Activity', '<polyline points="1.5 8.5 4.5 8.5 6.5 3.5 9.5 12.5 11.5 7.5 14.5 7.5"/>'],
];

const sfpFind = id => (state.setup?.staff || []).find(s => s.id === id);
const sfpName = s => String([s.title, s.name].filter(Boolean).join(' ')).toUpperCase();
const sfpPhoto = s => (s.photoPath ? `<img src="/${escapeHtml(s.photoPath)}" alt="">` : `<span>${escapeHtml(slInitials(s))}</span>`);
const sfpTypeLabel = s => (isAdminAccount(s) ? staffLevelLabel(s) : s.staffTypeLabel || (s.role === 'teacher' ? 'Teacher' : 'Staff'));
// an accountant (Finance only) looks, but changes nothing here
const sfpCanChange = s => state.user?.scope !== 'finance' && (s.id === state.user?.id || canManageAccount(s));
// older records only have a full name: split it as the Edit Staff form does
function sfpNameParts(s) {
  const parts = String(s.name || '').split(/\s+/).filter(Boolean);
  const structured = !!s.surname || (!!s.firstName && [s.firstName, s.otherNames].filter(Boolean).join(' ') === s.name);
  return structured ? { surname: s.surname, firstName: s.firstName, otherNames: s.otherNames }
    : { firstName: parts[0] || '', surname: parts.length > 1 ? parts[parts.length - 1] : '', otherNames: parts.slice(1, -1).join(' ') };
}

// ── The card (pop-up) ─────────────────────────────────────────────────
function staffCard(id) {
  const s = sfpFind(id);
  if (!s) return showToast('Staff member not found');
  stuModal('staff-card-modal', 'Staff Information', staffInfoBody(s, false), '', false);
}

function staffGoToProfile(id) {
  document.getElementById('staff-card-modal')?.remove();
  sfpOpen(id);
}

// The card's content; inPage = the Profile tab of the staff profile page
function staffInfoBody(s, inPage) {
  const row = (label, value) => `<tr><td>${escapeHtml(label)}</td><td>${value}</td></tr>`;
  const txt = v => escapeHtml(v || '') || '<span class="en-hint">—</span>';
  const contact = (...parts) => parts.filter(Boolean).map(escapeHtml).join(' · ');
  const gender = { M: 'Male', F: 'Female' }[s.gender] || s.gender;
  const names = sfpNameParts(s);
  const teacher = s.role === 'teacher';
  const login = s.canSignIn === false ? 'No portal login (staff record only)'
    : s.id === state.user?.id ? 'ON (your own account)'
      : inPage && sfpCanChange(s) ? accountStatusToggle(s.id, s.active) : (s.active ? 'ON' : 'OFF');
  const more = [
    ['Residential Address', s.address], ['Permanent / Home Town Address', s.permanentAddress],
    ['Town (of Origin)', s.town], ['LGA (of Origin)', s.lga], ['State (of Origin)', s.stateOfOrigin],
    ['Next of Kin', contact(s.nokName, s.nokRelationship && `(${s.nokRelationship})`, s.nokPhone, s.nokEmail, s.nokAddress)],
    ['Emergency Contact', contact(s.emergencyName, s.emergencyRelationship && `(${s.emergencyRelationship})`, s.emergencyPhone, s.emergencyEmail, s.emergencyAddress)],
  ].filter(([, v]) => v);
  const left = [['Date of Leaving', stuDate(s.dateOfLeaving) || s.dateOfLeaving], ['Reason for Leaving', s.reasonForLeaving]].filter(([, v]) => v);
  return `
    <div class="stu-card">
      <div class="stu-card-banner"></div>
      <div class="stu-card-photo">${sfpPhoto(s)}</div>
      <div class="stu-card-name">${escapeHtml(sfpName(s))}</div>
      <span class="stu-card-badge">${escapeHtml(sfpTypeLabel(s))}</span>
      <div class="stu-card-icons">${s.email ? `<a href="mailto:${escapeHtml(s.email)}" title="Email ${escapeHtml(s.email)}">${STU_ICON_MAIL}</a>` : ''}</div>
    </div>
    ${inPage ? '' : `<div class="stu-card-go"><button class="post-btn" onclick="staffGoToProfile(${jsArg(s.id)})">Go to profile page</button></div>`}
    <div class="stu-sec">Staff Biodata</div>
    <table class="stu-info"><tbody>
      ${row('Title', txt(s.title))}${row('Surname', txt(names.surname))}${row('First Name', txt(names.firstName))}${row('Other Names', txt(names.otherNames))}
      ${row('Gender', txt(gender))}${row('Date of Birth', txt(stuDate(s.dob) || s.dob))}${row('Age', txt(stuAge(s.dob)))}
      ${row('Email', txt(s.email))}${row('Phone', txt(s.phone))}${row('Nationality', txt(s.nationality))}${row('Religion', txt(String(s.religion || '').toUpperCase()))}
      ${row('Blood Group', txt(s.bloodGroup))}${row('Genotype', txt(s.genotype))}
    </tbody></table>
    <div class="stu-sec">Employment Information</div>
    <table class="stu-info"><tbody>
      ${row('Staff ID', `<span class="stu-mono">${escapeHtml(s.id)}</span>`)}
      ${row('Staff Type', txt(s.staffTypeLabel))}
      ${row('Designation', txt(s.designation || s.roleLabel))}
      ${teacher ? row('Teacher Type', txt(s.teacherType === 'subject_teacher' ? 'Subject Teacher' : 'Class Teacher')) : ''}
      ${teacher ? row('Classes / Subjects', `${txt(staffAssignments(s))}${inPage ? '' : `<div><button class="stu-mini-btn" onclick="staffGoToProfile(${jsArg(s.id)}); sfpTab('subjects')">${stuIcon('history')} Classes &amp; Subjects</button></div>`}`) : ''}
      ${isAdminAccount(s) ? row('Admin Level', txt(staffLevelLabel(s))) : ''}
      ${row('Department', txt(s.department))}${row('Area of Work', txt(s.areaOfWork))}${row('Qualifications', txt(s.qualifications))}
      ${row('Date of Appointment', txt(stuDate(s.dateOfAppointment) || s.dateOfAppointment))}${row('Date Started', txt(stuDate(s.dateStarted) || s.dateStarted))}
      ${row('Employment Status', txt(s.employmentStatus))}
      ${left.map(([l, v]) => row(l, txt(v))).join('')}
      ${row('Portal Login', login)}
      ${s.archived ? row('Archived', 'Yes') : ''}
    </tbody></table>
    ${more.length ? `<div class="stu-sec">More Details</div><table class="stu-info"><tbody>${more.map(([l, v]) => row(l, escapeHtml(v))).join('')}</tbody></table>` : ''}
    ${inPage ? sfpProfileFoot(s)
      : `<div class="stu-card-foot"><button class="post-btn" onclick="staffGoToProfile(${jsArg(s.id)})">Go to profile page</button><button class="btn-outline" onclick="stuPrintCard('#staff-card-modal .en-modal-body')">Print</button></div>`}`;
}

function sfpProfileFoot(s) {
  const self = s.id === state.user?.id;
  const can = sfpCanChange(s);
  const owner = state.user?.adminLevel === 'owner' && isAdminAccount(s) && s.adminLevel !== 'owner';
  return `<div class="stu-card-foot spf-prof-foot"><button class="btn-outline" onclick="stuPrintCard('#sfp-profile-body')">Print</button>
    <span class="en-foot-gap"></span>
    ${owner ? `<button class="btn-outline" onclick="sfpSuperAdmin()">${s.adminLevel === 'super' ? 'Remove Super Admin' : 'Make Super Admin'}</button>` : ''}
    ${can && !self ? `${s.archived ? '<button class="btn-outline" onclick="sfpArchive(false)">Restore Account (Unarchive)</button>' : '<button class="btn-outline" onclick="sfpArchive(true)">Archive Account</button>'}
      <button class="btn-danger" onclick="sfpDelete()">Delete Account</button>` : ''}</div>`;
}

// ── The page ──────────────────────────────────────────────────────────
function sfpOpen(id, tab = 'profile') {
  const s = sfpFind(id);
  if (!s) return showToast('Staff member not found');
  const current = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
  if (current && current !== 'staffProfile') SFP.from = current;
  SFP.id = id;
  SFP.tab = tab;
  try { sessionStorage.setItem('sfp_id', id); } catch {}
  switchTab('staffProfile', visibleNavItem(SFP.from) || visibleNavItem('staff'), 'Staff Profile', sfpName(s));
  // the window keeps the staff list's scroll position: start the profile at the top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// switchTab hook: draws the page (or reopens the last staff member after a refresh)
function sfpInit() {
  if (!SFP.id) { try { SFP.id = sessionStorage.getItem('sfp_id') || null; } catch {} }
  if (!SFP.id || !sfpFind(SFP.id)) return switchTab('staff', visibleNavItem('staff'));
  sfpRender();
}

function sfpShowing() {
  return document.getElementById('tab-staffProfile')?.classList.contains('active');
}

// After a change elsewhere (staff form, subjects manager): redraw, following a new ID
function sfpRefresh(newId) {
  if (!sfpShowing()) return;
  if (newId && newId !== SFP.id && sfpFind(newId)) { SFP.id = newId; try { sessionStorage.setItem('sfp_id', newId); } catch {} }
  if (!sfpFind(SFP.id)) return sfpBack();
  sfpRenderHead();
  sfpTab(SFP.tab === 'edit' ? 'profile' : SFP.tab);
}

function sfpBack() {
  switchTab(SFP.from || 'staff', visibleNavItem(SFP.from) || visibleNavItem('staff'));
}

function sfpRender() {
  const root = document.getElementById('sfp-root');
  if (!root) return;
  const s = sfpFind(SFP.id);
  const tabs = SFP_TABS.filter(([key]) => (key !== 'subjects' || s.role === 'teacher')
    && (!['edit', 'password'].includes(key) || sfpCanChange(s))
    && (key !== 'password' || s.canSignIn !== false)
    && (key !== 'activity' || state.user?.scope !== 'finance'));
  if (!tabs.some(([key]) => key === SFP.tab)) SFP.tab = 'profile';
  root.innerHTML = `<div class="spf-head card"><div class="card-body" id="sfp-head"></div></div>
    <div class="spf-wrap">
      <div class="spf-tabs card">
        <button class="spf-back" onclick="sfpBack()">Back to Staff List</button>
        ${tabs.map(([key, label, icon]) => `<button class="spf-tab" data-sfp="${key}" onclick="sfpTab(${jsArg(key)})">${spfSvg(icon)}<span>${label}</span></button>`).join('')}
      </div>
      <div class="spf-body card"><div class="card-body" id="sfp-body"></div></div>
    </div>`;
  sfpRenderHead();
  sfpTab(SFP.tab);
}

function sfpRenderHead() {
  const head = document.getElementById('sfp-head');
  const s = sfpFind(SFP.id);
  if (!head || !s) return;
  const designation = s.designation || s.roleLabel;
  const line = [sfpTypeLabel(s), designation && designation.toLowerCase() !== sfpTypeLabel(s).toLowerCase() ? designation : ''].filter(Boolean).map(v => String(v).toUpperCase()).join(' - ');
  head.innerHTML = `<div class="spf-head-row">
      <div class="spf-avatar">${sfpPhoto(s)}</div>
      <div><div class="spf-head-name">${escapeHtml(sfpName(s))}</div><div class="spf-head-class">${escapeHtml(line)}</div>
        <div class="spf-head-tags">${s.canSignIn === false ? '<span class="sr-pill pending">No login</span>' : `<span class="sr-pill ${s.active ? 'accepted' : 'rejected'}">${s.active ? 'Active' : 'Deactivated'}</span>`}${s.archived ? ' <span class="sr-pill bypassed">Archived</span>' : ''} <span class="stu-mono">${escapeHtml(s.id)}</span></div></div>
    </div>`;
  const sub = document.getElementById('topbar-sub');
  if (sub) sub.textContent = sfpName(s);
}

function sfpTab(key) {
  const s = sfpFind(SFP.id);
  const body = document.getElementById('sfp-body');
  if (!s || !body) return;
  // Update Profile is the Add / Edit Staff form; the page stays on Profile behind it
  if (key === 'edit') { editStaff(s.id); key = SFP.tab === 'edit' ? 'profile' : SFP.tab; }
  SFP.tab = key;
  document.querySelectorAll('.spf-tab[data-sfp]').forEach(b => b.classList.toggle('active', b.dataset.sfp === key));
  ({ profile: sfpProfile, subjects: sfpSubjects, password: sfpPassword, activity: sfpActivity }[key] || sfpProfile)(body, s);
}

function sfpProfile(body, s) {
  body.innerHTML = `<div id="sfp-profile-body" class="spf-profile">${staffInfoBody(s, true)}</div>`;
}

function sfpSubjects(body, s) {
  body.innerHTML = `${spfTitle('Classes & Subjects')}<div id="sfp-subjects"></div>`;
  staffProfileId = s.id; // the subjects manager works on this staff member
  renderStaffProfileSubjects(s, document.getElementById('sfp-subjects'));
}

function sfpPassword(body, s) {
  body.innerHTML = `${spfTitle("Update User's Account Password")}
    <div class="spf-narrow">${spfSecret('sfp-pass1', 'New Password')}${spfSecret('sfp-pass2', 'Confirm New Password')}
      <div class="spf-actions"><button class="post-btn" onclick="sfpPasswordSave(this)">Update Password</button><button class="btn-outline" onclick="sfpPasswordSave(this, true)">Generate One</button></div>
      <div class="spf-note">This is a temporary password (at least 8 characters, with letters and numbers). ${escapeHtml(s.firstName || s.name)} is signed out everywhere, and must choose their own new password the next time they sign in.</div></div>`;
}

async function sfpPasswordSave(btn, generate = false) {
  const value = generate ? '' : document.getElementById('sfp-pass1').value;
  const confirm = generate ? '' : document.getElementById('sfp-pass2').value;
  if (!generate && !value) return showToast('Enter the new password');
  if (!generate && value !== confirm) return showToast('The two entries do not match');
  btn.disabled = true;
  try {
    const data = await apiFetch(`/api/admin/staff/${encodeURIComponent(SFP.id)}/password`, { method: 'POST', body: JSON.stringify({ value, confirm, generate }) });
    if (data.generatedPassword) await uiNotice('New password', `Staff ID: ${SFP.id}\nPassword: ${data.generatedPassword}\n\nGive this to the staff member. It is not shown again, and they must change it when they next sign in.`);
    else showToast('Password updated');
    state.setup = data.setup;
    populateStaff();
    sfpRefresh();
  } catch (err) { showToast(err.message); btn.disabled = false; }
}

async function sfpActivity(body, s) {
  body.innerHTML = `${spfTitle('Activity', '<span class="en-hint">Sign-ins and changes by or about this staff member, newest first</span>')}<div id="sfp-activity"><div class="sr-empty">Loading…</div></div>`;
  let data;
  try { data = await apiFetch(`/api/admin/security/audit?q=${encodeURIComponent(s.id)}`); } catch (err) {
    const box = document.getElementById('sfp-activity');
    if (box) box.innerHTML = `<div class="sr-empty">${escapeHtml(err.message)}</div>`;
    return;
  }
  const box = document.getElementById('sfp-activity');
  if (!box) return;
  box.innerHTML = data.rows.length ? `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>Device</th></tr></thead><tbody>
    ${data.rows.map(r => `<tr${r.outcome === 'failed' ? ' style="color:var(--red)"' : ''}><td style="white-space:nowrap">${escapeHtml(new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td>
      <td>${escapeHtml(r.userName || r.userId || '')}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.detail || '')}</td><td>${escapeHtml(r.device || '')}</td></tr>`).join('')}
    </tbody></table></div>${data.total > data.rows.length ? `<div class="spf-note">Showing the latest ${data.rows.length} of ${data.total}. The full list is under Security &amp; Activity Log.</div>` : ''}`
    : '<div class="sr-empty">No activity recorded yet.</div>';
}

async function sfpArchive(archive) {
  const s = sfpFind(SFP.id);
  if (archive && !await uiConfirm(`Archive ${s.name}? Their login is switched off and they are hidden from the staff list until restored.`)) return;
  try {
    const data = await apiFetch('/api/admin/staff/bulk', { method: 'POST', body: JSON.stringify({ ids: [s.id], action: archive ? 'archive' : 'restore' }) });
    if (data.skipped?.length) return showToast(data.skipped[0]);
    state.setup = data.setup;
    populateStaff();
    showToast(archive ? 'Account archived' : 'Account restored');
    sfpRefresh();
  } catch (err) { showToast(err.message); }
}

async function sfpDelete() {
  const id = SFP.id;
  await deleteTeacherAccount(id);
  if (!sfpFind(id)) sfpBack();
}

async function sfpSuperAdmin() {
  await toggleSuperAdmin(SFP.id);
  sfpRefresh();
}
