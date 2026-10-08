// Admin → People → Enroll Students (three tabs: Enroll a Student, Bulk Enroll
// Students, Self Registration) and People → Self Registration (management).
// Server side: enrol-api.js.

const EN = {
  meta: null,          // families, sessions, tags, next reg no
  tab: 'enroll',
  step: 1,
  editId: null,        // pupil being edited (null = new enrolment)
  record: null,        // loaded pupil record when editing
  photoDataUrl: '',
  family: { mode: 'create', id: null, slots: {} }, // family modal state
  sr: { view: 'dashboard', kind: 'student', status: 'pending', rows: [], page: 1, perPage: 25, search: '', from: '', to: '', selected: new Set() },
  sregSettings: null,
};

const EN_STEPS = ['Parents / Family', 'Basic Biodata', 'Academics', 'More Information', 'Next of Kin'];

async function enrolLoadMeta() {
  EN.meta = await apiFetch('/api/admin/enrol/meta');
  return EN.meta;
}

// ── Page shell ──────────────────────────────────────────────────────────
async function enrolOpen(tab = 'enroll') {
  EN.editId = null;
  EN.record = null;
  EN.tab = tab;
  enrolPlaceholder();
  const nav = document.querySelector('[data-tab="addStudent"]');
  switchTab('addStudent', nav, 'Enroll Students', tab === 'bulk' ? 'Bulk Enroll Students' : tab === 'self' ? 'Self Registration' : 'Enroll a Student');
  await enrolShowTab(tab);
}

async function enrolEdit(id) {
  try {
    const [{ student }] = await Promise.all([apiFetch(`/api/admin/enrol/student/${encodeURIComponent(id)}`), enrolLoadMeta()]);
    EN.editId = id;
    EN.record = student;
    state.editingStudentId = id;
    enrolPlaceholder();
    const nav = document.querySelector('[data-tab="addStudent"]');
    switchTab('addStudent', nav, 'Edit Student', `${student.firstName} ${student.surname}`);
    EN.tab = 'enroll';
    EN.step = 1;
    enrolRenderShell();
  } catch (err) {
    showToast(err.message);
  }
}

// Marks the page as drawn so switchTab's refresh hook doesn't draw it again
function enrolPlaceholder() {
  const root = document.getElementById('enrol-root');
  if (root && !document.getElementById('en-body')) root.innerHTML = '<div id="en-body"></div>';
}

async function enrolShowTab(tab) {
  EN.tab = tab;
  const sub = document.getElementById('topbar-sub');
  if (sub && !EN.editId) sub.textContent = { enroll: 'Enroll a Student', bulk: 'Bulk Enroll Students', self: 'Self Registration' }[tab];
  if (tab === 'enroll') {
    EN.step = 1;
    EN.photoDataUrl = '';
    try { await enrolLoadMeta(); } catch (err) { showToast(err.message); }
  }
  enrolRenderShell();
}

function enrolRenderShell() {
  const root = document.getElementById('enrol-root');
  if (!root) return;
  const editing = !!EN.editId;
  const tabs = editing ? '' : `<div class="en-tabs">
      ${[['enroll', 'Enroll a Student', '<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M2 14c0-3 2.7-5 6-5"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="9.5" y1="11.5" x2="14.5" y2="11.5"/>'],
         ['bulk', 'Bulk Enroll Students', '<path d="M8 11V2"/><polyline points="4.5 5.5 8 2 11.5 5.5"/><path d="M2 11v2.5h12V11"/>'],
         ['self', 'Self Registration', '<circle cx="6.5" cy="5" r="2.5"/><path d="M2 14c0-2.5 2-4.5 4.5-4.5"/><path d="M10 12.5l1.5 1.5 3-3.5"/>']]
        .map(([key, label, icon]) => `<button class="en-tab${EN.tab === key ? ' active' : ''}" onclick="enrolShowTab('${key}')"><svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</button>`).join('')}
    </div>`;
  root.innerHTML = `${tabs}<div id="en-body"></div>`;
  if (EN.tab === 'enroll') enrolRenderWizard();
  else if (EN.tab === 'bulk') bulkRender();
  else sregRenderList(document.getElementById('en-body'), 'student', true);
}

// ── Enroll a Student: 5-step wizard ─────────────────────────────────────
function enField(label, inner, { required = false, wide = false, hint = '' } = {}) {
  return `<div class="en-field${wide ? ' wide' : ''}"><label class="field-label">${enrolEsc(label)}${required ? ' <span class="en-req">*</span>' : ''}${hint ? ` <span class="en-hint">${hint}</span>` : ''}</label>${inner}</div>`;
}
function enInput(id, value = '', attrs = '') {
  return `<input class="field-input" id="${id}" value="${enrolEsc(value)}" ${attrs}>`;
}
function enCaseInput(id, value = '', attrs = '') {
  return `<div class="en-case-wrap">${enInput(id, value, attrs)}<button type="button" class="en-case-btn" title="Toggle case" onclick="enrolToggleCase('${id}')">Aa</button></div>`;
}
function enCheck(id, label, checked, onchange = '') {
  return `<label class="en-check"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}${onchange ? ` onchange="${onchange}"` : ''}> ${enrolEsc(label)}</label>`;
}

function enrolRenderWizard() {
  const body = document.getElementById('en-body');
  const r = EN.record || {};
  const meta = EN.meta || { families: [], sessions: [], tags: [] };
  const classes = (state.setup?.classes || []).filter(c => !c.archived || c.code === r.classCode);
  const nok = r.nextOfKin || {};
  const em = r.emergency || {};
  const contactBlock = (prefix, c, title) => `<div class="en-sub-head">${title}</div>
    <div class="en-grid">
      ${enField('Name', enCaseInput(`${prefix}-name`, c.name))}
      ${enField('Relationship to Student', enInput(`${prefix}-rel`, c.relationship))}
      ${enrolPhoneField(`${prefix}-phone`, c.phone, 'Contact Phone')}
      ${enField(prefix === 'en-nok' ? 'Contact Email' : 'Email', enInput(`${prefix}-email`, c.email, 'type="email"'))}
      ${enField('Address', enInput(`${prefix}-address`, c.address), { wide: true })}
    </div>`;

  body.innerHTML = `<div class="card en-card">
    <div class="en-stepper">${EN_STEPS.map((label, i) => `<button type="button" class="en-step${i + 1 === EN.step ? ' active' : ''}${i + 1 < EN.step ? ' done' : ''}" onclick="enrolGoStep(${i + 1})"><span class="en-step-no">${i + 1}</span><span class="en-step-label">${label}</span></button>`).join('<span class="en-step-line"></span>')}</div>

    <section class="en-panel" data-step="1">
      <h3 class="en-head">Student's Guardian / Parents :</h3>
      <div class="en-family-row">
        ${enField('Select Family', `<input class="field-input en-family-search" id="en-family-search" placeholder="Type to search families…" oninput="enrolFilterFamilies()">
          <select class="ctrl-select" id="en-family" onchange="enrolFamilyChanged()" size="1"></select>`, { required: true, wide: true })}
        <div class="en-family-btns">
          <button type="button" class="btn-outline" onclick="familyModalOpen('create')">+ Create Family</button>
          <button type="button" class="btn-outline" id="en-manage-family" onclick="familyModalOpen('manage')">Manage Family</button>
        </div>
      </div>
      <div id="en-family-card"></div>
      <div class="en-info">Select the student's family from the dropdown. Use <strong>Create Family</strong> to create a new family. To add a second parent to an already-existing family, use <strong>Manage Family</strong>.</div>
    </section>

    <section class="en-panel" data-step="2">
      <h3 class="en-head">Student's Basic Biodata :</h3>
      <div class="en-photo-row">
        <div class="en-photo" id="en-photo-preview">${r.photoPath ? `<img src="/${enrolEsc(r.photoPath)}" alt="">` : '<span>Photo</span>'}</div>
        <div>
          <div class="field-label">Student's Passport-sized Photo</div>
          <label class="btn-outline en-photo-btn">New Photo<input type="file" accept="image/*" hidden onchange="enrolPhotoChosen(this)"></label>
        </div>
      </div>
      <div class="en-grid">
        ${enField('Surname', enCaseInput('en-surname', r.surname), { required: true })}
        ${enField('First Name', enCaseInput('en-first', r.firstName), { required: true })}
        ${enField('Other Names', enCaseInput('en-other', r.otherNames))}
        ${enField('Gender', `<select class="ctrl-select" id="en-gender">${enrolOptions([['M', 'Male'], ['F', 'Female']], r.gender, 'Select')}</select>`, { required: true })}
        ${enField('Student Email', `${enInput('en-email', r.studentEmail, 'type="email"')}${enCheck('en-temp-email', 'Use Temporary Email Address', false, 'enrolTempEmailToggle(this)')}`)}
        ${enField('Password', `<div class="en-pass-wrap">${enInput('en-password', EN.editId ? '' : DEFAULT_STUDENT_PASSWORD, `type="password" placeholder="${EN.editId ? 'Leave blank to keep the current password' : ''}"`)}<button type="button" class="en-case-btn" onclick="enrolShowHide('en-password', this)">Show</button></div>${enCheck('en-auto-pass', 'Auto Generate Password', false, 'enrolAutoPass(this)')}`, { required: !EN.editId })}
      </div>
      <div class="en-activate">${enCheck('en-active', "Activate this Student's Account ?", EN.editId ? r.active : true)}</div>
    </section>

    <section class="en-panel" data-step="3">
      <h3 class="en-head">Student's Class / Academic Data :</h3>
      <div class="en-grid">
        ${enField('Enrolling Into Session', `<select class="ctrl-select" id="en-session" onchange="enrolRefreshNumbers()">${enrolOptions(meta.sessions, r.session || meta.activeSession, 'Select Academic Session')}</select>`, { required: true })}
        ${enField('Class', `<select class="ctrl-select" id="en-class" onchange="enrolClassChanged()">${enrolOptions(classes.map(c => [c.code, c.label]), r.classCode, 'Select')}</select>`, { required: true })}
        ${enField('Class Arm', '<select class="ctrl-select" id="en-arm" onchange="enrolRefreshNumbers()"></select>', { required: true })}
        ${enField('Tags', `<div class="en-tags" id="en-tags"></div><button type="button" class="en-link" onclick="enrolNewTag()">+ New Tag</button>`)}
        ${enField('Admission Date', enInput('en-admission', r.admissionDate || new Date().toISOString().slice(0, 10), 'type="date"'), { required: true })}
        ${enField('Registration / Admission No.', `${enInput('en-regno', r.regNo || meta.nextRegNo, EN.editId ? '' : 'readonly')}${EN.editId ? '' : enCheck('en-auto-reg', 'Auto Generate Registration No.', true, 'enrolAutoReg(this)')}`)}
      </div>
    </section>

    <section class="en-panel" data-step="4">
      <h3 class="en-head">Additional Profile Information :</h3>
      <div class="en-grid">
        ${enrolPhoneField('en-phone', r.phone, 'Contact Phone')}
        ${enField('Date of Birth', enInput('en-dob', r.dob, 'type="date"'))}
        ${enField('N.ID / Birth Cert. No.', enInput('en-nin', r.nin))}
        ${enField('Religion', enInput('en-religion', r.religion))}
        ${enField('Blood Group', `<select class="ctrl-select" id="en-blood">${enrolOptions(ENROL_BLOOD_GROUPS, r.bloodGroup, 'Select')}</select>`)}
        ${enField('Genotype', `<select class="ctrl-select" id="en-genotype">${enrolOptions(ENROL_GENOTYPES, r.genotype, 'Select')}</select>`)}
        ${enField('Nationality', `<select class="ctrl-select" id="en-nationality">${enrolOptions(ENROL_COUNTRIES, r.nationality, '-Select Country -')}</select>`)}
        ${enField('Province/State (of Origin)', enInput('en-state', r.state))}
        ${enField('ZIP/LGA (of Origin)', enInput('en-lga', r.lga))}
        ${enField('Town (of Origin)', enInput('en-town', r.town))}
        ${enField('Residential / Contact Address', `<textarea class="field-input" id="en-res" rows="2">${enrolEsc(r.residentialAddress)}</textarea>`, { wide: true })}
        ${enField('Permanent / Home Town Address', `<textarea class="field-input" id="en-perm" rows="2">${enrolEsc(r.permanentAddress)}</textarea>`, { wide: true })}
        ${enField('Bio / Remark', `<textarea class="field-input" id="en-bio" rows="2">${enrolEsc(r.bio)}</textarea>`, { wide: true })}
        ${enField('Roll No', `${enInput('en-roll', r.rollNo, `placeholder="Select Class, Class Arm and Academic Session first"${EN.editId ? '' : ' readonly'}`)}${EN.editId ? '' : enCheck('en-auto-roll', 'Auto Generate Roll No.', true, 'enrolAutoRoll(this)')}`, { hint: '(in class)' })}
      </div>
    </section>

    <section class="en-panel" data-step="5">
      <h3 class="en-head">Next of Kin &amp; Emergency Contact :</h3>
      ${contactBlock('en-nok', nok, 'Next of Kin')}
      ${contactBlock('en-em', em, 'Emergency Contact Person')}
    </section>

    <div class="en-foot">
      ${EN.editId ? '<button type="button" class="btn-danger" onclick="enrolDelete()">Delete Student</button>' : ''}
      <span class="en-foot-gap"></span>
      <button type="button" class="btn-outline" id="en-back" onclick="enrolGoStep(EN.step - 1)">&larr; Back</button>
      <button type="button" class="post-btn" id="en-next" onclick="enrolNext()">Next &rarr;</button>
      <button type="button" class="post-btn" id="en-save" onclick="enrolSave(this)">${EN.editId ? 'Save Changes' : 'Register Student'}</button>
    </div>
  </div>`;

  enrolFilterFamilies(r.familyId);
  enrolClassChanged(r.classArmId);
  enrolRenderTags(r.tags || []);
  enrolGoStep(EN.step);
}

function enrolFilterFamilies(selectId) {
  const sel = document.getElementById('en-family');
  if (!sel) return;
  const q = (document.getElementById('en-family-search')?.value || '').toLowerCase();
  const current = selectId !== undefined ? String(selectId || '') : sel.value;
  const fams = (EN.meta?.families || []).filter(f => !q || f.label.toLowerCase().includes(q) || String(f.id) === current);
  sel.innerHTML = `<option value="">${fams.length ? 'Select' : 'No family matches'}</option>` +
    fams.map(f => `<option value="${f.id}"${String(f.id) === current ? ' selected' : ''}>${enrolEsc(f.label)}</option>`).join('');
  enrolFamilyChanged();
}

function enrolFamilyChanged() {
  const id = Number(document.getElementById('en-family')?.value);
  const fam = (EN.meta?.families || []).find(f => f.id === id);
  document.getElementById('en-manage-family').disabled = !fam;
  const card = document.getElementById('en-family-card');
  if (!card) return;
  const parent = p => p ? `<div class="en-parent"><strong>${enrolEsc([p.title, p.fullName].filter(Boolean).join(' '))}</strong>${p.relationship ? ` <span class="en-badge">${enrolEsc(p.relationship)}</span>` : ''}
      <div>${[p.phone, p.email].filter(Boolean).map(enrolEsc).join(' · ') || '<em>No phone or email</em>'}</div>${p.occupation ? `<div>${enrolEsc(p.occupation)}</div>` : ''}</div>` : '';
  card.innerHTML = fam ? `<div class="en-family-card"><div class="en-family-name">${enrolEsc(fam.name)} <span>${fam.children} child${fam.children === 1 ? '' : 'ren'} enrolled</span></div><div class="en-parents">${parent(fam.parent1)}${parent(fam.parent2)}</div></div>` : '';
}

function enrolClassChanged(armId) {
  const classCode = document.getElementById('en-class')?.value || '';
  const sel = document.getElementById('en-arm');
  if (!sel) return;
  const hasArms = (state.setup?.classArms || []).some(a => a.classCode === classCode);
  sel.innerHTML = !classCode ? '<option value="">Select Class First</option>' : hasArms ? attArmOptions(classCode, 'Select') : '<option value="">— No Arms —</option>';
  sel.disabled = !hasArms;
  if (armId) sel.value = String(armId);
  enrolRefreshNumbers();
}

async function enrolRefreshNumbers() {
  if (EN.editId) return;
  const session = document.getElementById('en-session')?.value || '';
  const classCode = document.getElementById('en-class')?.value || '';
  const classArmId = document.getElementById('en-arm')?.value || '';
  try {
    const qs = new URLSearchParams({ session, classCode, classArmId });
    const next = await apiFetch(`/api/admin/enrol/next?${qs}`);
    if (document.getElementById('en-auto-reg')?.checked) document.getElementById('en-regno').value = next.regNo;
    if (document.getElementById('en-auto-roll')?.checked) document.getElementById('en-roll').value = classCode ? next.rollNo : '';
  } catch (err) { /* numbers are refreshed again on save */ }
}

function enrolRenderTags(selected = []) {
  const wrap = document.getElementById('en-tags');
  if (!wrap) return;
  const chosen = new Set(selected.map(String));
  wrap.innerHTML = (EN.meta?.tags || []).map(t => `<label class="en-tag"><input type="checkbox" value="${t.id}"${chosen.has(String(t.id)) ? ' checked' : ''}> ${enrolEsc(t.name)}</label>`).join('') || '<span class="en-hint">No tags yet</span>';
}

async function enrolNewTag() {
  const name = (prompt('New tag name (e.g. Returning, Scholarship):') || '').trim();
  if (!name) return;
  try {
    await apiFetch('/api/admin/student-tags', { method: 'POST', body: JSON.stringify({ name }) });
    const keep = [...document.querySelectorAll('#en-tags input:checked')].map(i => i.value);
    await enrolLoadMeta();
    const created = EN.meta.tags.find(t => t.name === name);
    enrolRenderTags([...keep, created?.id].filter(Boolean));
    showToast('Tag added');
  } catch (err) { showToast(err.message); }
}

function enrolTempEmailToggle(box) {
  const input = document.getElementById('en-email');
  if (box.checked) input.value = enrolTempEmail(document.getElementById('en-first').value, document.getElementById('en-surname').value);
  input.readOnly = box.checked;
}
function enrolAutoPass(box) {
  const input = document.getElementById('en-password');
  if (box.checked) { input.value = String(Math.floor(100000 + Math.random() * 900000)); input.type = 'text'; }
  input.readOnly = box.checked;
}
function enrolAutoReg(box) {
  document.getElementById('en-regno').readOnly = box.checked;
  if (box.checked) enrolRefreshNumbers();
}
function enrolAutoRoll(box) {
  document.getElementById('en-roll').readOnly = box.checked;
  if (box.checked) enrolRefreshNumbers();
}
function enrolShowHide(id, btn) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
}

async function enrolPhotoChosen(input) {
  try {
    EN.photoDataUrl = await imageToSmallDataUrl(input.files?.[0], 480);
    document.getElementById('en-photo-preview').innerHTML = `<img src="${EN.photoDataUrl}" alt="">`;
  } catch (err) { showToast(err.message); }
}

function enrolStepErrors(step) {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const errs = [];
  if (step === 1 && !v('en-family')) errs.push("Select the student's family (or create one)");
  if (step === 2) {
    if (!v('en-surname')) errs.push('Surname is required');
    if (!v('en-first')) errs.push('First name is required');
    if (!v('en-gender')) errs.push('Gender is required');
    if (!EN.editId && !v('en-password')) errs.push('Password is required');
  }
  if (step === 3) {
    if (!v('en-session')) errs.push('Choose the session');
    if (!v('en-class')) errs.push('Choose the class');
    const arm = document.getElementById('en-arm');
    if (arm && !arm.disabled && !arm.value) errs.push('Choose the class arm');
    if (!v('en-admission')) errs.push('Admission date is required');
  }
  return errs;
}

function enrolGoStep(step) {
  if (step < 1 || step > EN_STEPS.length) return;
  // Moving forward checks the steps being left behind
  for (let s = EN.step; s < step; s += 1) {
    const errs = enrolStepErrors(s);
    if (errs.length) { EN.step = s; enrolPaintStep(); return showToast(errs[0]); }
  }
  EN.step = step;
  enrolPaintStep();
}

function enrolPaintStep() {
  document.querySelectorAll('.en-panel').forEach(p => { p.style.display = Number(p.dataset.step) === EN.step ? '' : 'none'; });
  document.querySelectorAll('.en-step').forEach((b, i) => {
    b.classList.toggle('active', i + 1 === EN.step);
    b.classList.toggle('done', i + 1 < EN.step);
  });
  document.getElementById('en-back').style.visibility = EN.step === 1 ? 'hidden' : 'visible';
  document.getElementById('en-next').style.display = EN.step === EN_STEPS.length ? 'none' : '';
  document.getElementById('en-save').style.display = EN.editId || EN.step === EN_STEPS.length ? '' : 'none';
}

function enrolNext() { enrolGoStep(EN.step + 1); }

function enrolContact(prefix) {
  const v = id => document.getElementById(id)?.value.trim() || '';
  return { name: v(`${prefix}-name`), relationship: v(`${prefix}-rel`), phone: enrolReadPhone(`${prefix}-phone`), email: v(`${prefix}-email`), address: v(`${prefix}-address`) };
}

async function enrolSave(btn) {
  for (let s = 1; s <= EN_STEPS.length; s += 1) {
    const errs = enrolStepErrors(s);
    if (errs.length) { EN.step = s; enrolPaintStep(); return showToast(errs[0]); }
  }
  const v = id => document.getElementById(id)?.value.trim() || '';
  const payload = {
    familyId: v('en-family'), surname: v('en-surname'), firstName: v('en-first'), otherNames: v('en-other'), gender: v('en-gender'),
    studentEmail: v('en-email'), password: v('en-password'), active: document.getElementById('en-active').checked,
    session: v('en-session'), classCode: v('en-class'), classArmId: v('en-arm'),
    tags: [...document.querySelectorAll('#en-tags input:checked')].map(i => Number(i.value)),
    admissionDate: v('en-admission'), regNo: document.getElementById('en-auto-reg')?.checked ? '' : v('en-regno'),
    phone: enrolReadPhone('en-phone'), dob: v('en-dob'), nin: v('en-nin'), religion: v('en-religion'), bloodGroup: v('en-blood'),
    genotype: v('en-genotype'), nationality: v('en-nationality'), state: v('en-state'), lga: v('en-lga'), town: v('en-town'),
    residentialAddress: v('en-res'), permanentAddress: v('en-perm'), bio: v('en-bio'),
    rollNo: document.getElementById('en-auto-roll')?.checked ? '' : v('en-roll'),
    nextOfKin: enrolContact('en-nok'), emergency: enrolContact('en-em'), photoDataUrl: EN.photoDataUrl,
  };
  btn.disabled = true;
  try {
    const data = await apiFetch(EN.editId ? `/api/admin/enrol/student/${encodeURIComponent(EN.editId)}` : '/api/admin/enrol/student', {
      method: EN.editId ? 'PUT' : 'POST', body: JSON.stringify(payload),
    });
    state.setup = data.setup;
    if (typeof populateStudents === 'function') populateStudents();
    if (typeof populateParents === 'function') populateParents();
    if (typeof populateDashboard === 'function') populateDashboard();
    if (EN.editId) {
      showToast('Student updated');
      EN.editId = null;
      state.editingStudentId = null;
      switchTab('students', document.querySelector('[data-tab="students"]'), 'Students', 'Student Records');
    } else {
      showToast(`${data.student.name} enrolled — Reg. No. ${data.student.regNo}`);
      EN.photoDataUrl = '';
      await enrolShowTab('enroll');
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

function enrolDelete() {
  state.editingStudentId = EN.editId;
  openStudentDeleteModal();
}

// ── Create / Manage Family modal ────────────────────────────────────────
function familyModalOpen(mode) {
  const famId = Number(document.getElementById('en-family')?.value);
  const fam = mode === 'manage' ? (EN.meta?.families || []).find(f => f.id === famId) : null;
  if (mode === 'manage' && !fam) return showToast('Select a family first');
  EN.family = { mode, id: fam?.id || null, slots: { 1: fam?.parent1 ? { existing: fam.parent1, editing: true } : {}, 2: fam?.parent2 ? { existing: fam.parent2, editing: true } : null } };
  let modal = document.getElementById('family-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'family-modal';
    modal.className = 'en-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div class="en-modal-box">
    <div class="en-modal-head"><span>${mode === 'manage' ? 'Manage Family' : '+ Create New Family'}</span><button class="en-x" onclick="familyModalClose()" aria-label="Close">&times;</button></div>
    <div class="en-modal-body">
      ${enField('Family Name', enCaseInput('fm-name', fam?.name || '', 'placeholder="Leave blank to name it after Parent 1 (e.g. ADEKOYA Family)"'), { wide: true })}
      <div id="fm-slot-1"></div>
      <div id="fm-slot-2"></div>
    </div>
    <div class="en-modal-foot"><button class="btn-outline" onclick="familyModalClose()">Cancel</button><button class="post-btn" onclick="familySave(this)">${mode === 'manage' ? 'Save Family' : 'Create Family'}</button></div>
  </div>`;
  modal.style.display = 'flex';
  familyRenderSlot(1);
  familyRenderSlot(2);
}

function familyModalClose() {
  const modal = document.getElementById('family-modal');
  if (modal) modal.style.display = 'none';
}

function familyRenderSlot(n) {
  const wrap = document.getElementById(`fm-slot-${n}`);
  const slot = EN.family.slots[n];
  if (n === 2 && !slot) {
    wrap.innerHTML = '<button type="button" class="en-link" onclick="EN.family.slots[2] = {}; familyRenderSlot(2)">+ Add Second Parent / Guardian</button>';
    return;
  }
  const p = slot.existing && slot.editing ? slot.existing : (slot.draft || {});
  const head = `<div class="fm-slot-head"><span>Parent ${n}${n === 1 ? ' <span class="en-req">*</span>' : ''}</span>
    ${n === 2 ? `<button type="button" class="en-link danger" onclick="EN.family.slots[2] = null; familyRenderSlot(2)">Remove</button>` : ''}</div>`;
  if (slot.existing && !slot.editing) {
    wrap.innerHTML = `${head}<div class="en-parent picked"><strong>${enrolEsc([slot.existing.title, slot.existing.fullName].filter(Boolean).join(' '))}</strong>
      <div>${[slot.existing.relationship, slot.existing.phone, slot.existing.email].filter(Boolean).map(enrolEsc).join(' · ')}</div>
      <button type="button" class="en-link" onclick="EN.family.slots[${n}] = {}; familyRenderSlot(${n})">Change</button></div>`;
    return;
  }
  const searching = slot.mode === 'search';
  wrap.innerHTML = `${head}
    ${EN.family.mode === 'create' || !slot.existing ? `<div class="fm-mode"><button type="button" class="${searching ? 'btn-outline' : 'post-btn'} btn-sm" onclick="EN.family.slots[${n}].mode = 'new'; familyRenderSlot(${n})">Create New Parent</button>
      <button type="button" class="${searching ? 'post-btn' : 'btn-outline'} btn-sm" onclick="EN.family.slots[${n}].mode = 'search'; familyRenderSlot(${n})">Search Existing Parent</button></div>` : ''}
    ${searching ? `<input class="field-input" id="fm${n}-search" placeholder="Search By Name Or Email ..." oninput="familySearch(${n}, this.value)"><div class="fm-results" id="fm${n}-results"></div>` : `
    <div class="en-grid">
      ${enField('Title', `<select class="ctrl-select" id="fm${n}-title">${enrolOptions(ENROL_TITLES, p.title, '')}</select>`)}
      ${enField('Full Name', enCaseInput(`fm${n}-name`, p.fullName, `oninput="familySimilar(${n}, this.value)"`), { required: true })}
      <div class="fm-similar wide" id="fm${n}-similar"></div>
      ${enField('Relationship', `<select class="ctrl-select" id="fm${n}-rel" onchange="document.getElementById('fm${n}-rel-other').style.display = this.value === 'Other' ? '' : 'none'">${enrolOptions(ENROL_RELATIONSHIPS, p.relationship, '— Select —')}</select>
        <input class="field-input" id="fm${n}-rel-other" placeholder="Specify Relationship" value="${enrolEsc(p.relationshipOther)}" style="margin-top:6px;${p.relationship === 'Other' ? '' : 'display:none;'}">`, { hint: '(With Ward(s))' })}
      ${enField('Occupation / Profession', enInput(`fm${n}-occ`, p.occupation))}
      ${enrolPhoneField(`fm${n}-phone`, p.phone, 'Phone')}
      ${enField('Email', `${enInput(`fm${n}-email`, p.email, 'type="email"')}${enCheck(`fm${n}-temp`, 'Use Temporary Email Address', false, `familyTempEmail(${n}, this)`)}`)}
      ${enField('Address', `<textarea class="field-input" id="fm${n}-address" rows="2">${enrolEsc(p.address)}</textarea>`, { wide: true })}
    </div>`}`;
}

function familyTempEmail(n, box) {
  const input = document.getElementById(`fm${n}-email`);
  if (box.checked) input.value = enrolTempEmail(document.getElementById(`fm${n}-name`).value);
  input.readOnly = box.checked;
}

let _familySearchTimer = null;
function familySearch(n, q) {
  clearTimeout(_familySearchTimer);
  _familySearchTimer = setTimeout(async () => {
    const box = document.getElementById(`fm${n}-results`);
    if (!box) return;
    if (q.trim().length < 2) { box.innerHTML = ''; return; }
    const { parents } = await apiFetch(`/api/admin/parents/search?q=${encodeURIComponent(q.trim())}`);
    EN.family.found = Object.fromEntries(parents.map(p => [p.id, p]));
    box.innerHTML = parents.length ? parents.map(p => `<button type="button" class="fm-result" onclick="familyPick(${n}, ${p.id})"><strong>${enrolEsc([p.title, p.fullName].filter(Boolean).join(' '))}</strong><span>${[p.relationship, p.phone, p.email].filter(Boolean).map(enrolEsc).join(' · ')}</span></button>`).join('') : '<div class="en-hint">No parent found</div>';
  }, 250);
}

let _familySimilarTimer = null;
function familySimilar(n, q) {
  clearTimeout(_familySimilarTimer);
  _familySimilarTimer = setTimeout(async () => {
    const box = document.getElementById(`fm${n}-similar`);
    if (!box || EN.family.slots[n]?.existing) return;
    if (q.trim().length < 3) { box.innerHTML = ''; return; }
    const { parents } = await apiFetch(`/api/admin/parents/search?q=${encodeURIComponent(q.trim())}`);
    EN.family.found = { ...(EN.family.found || {}), ...Object.fromEntries(parents.map(p => [p.id, p])) };
    box.innerHTML = parents.length ? `<div class="fm-similar-box"><div class="fm-similar-title">Similar Parents Already Exist :</div>
      ${parents.slice(0, 5).map(p => `<button type="button" class="fm-result" onclick="familyPick(${n}, ${p.id})"><strong>${enrolEsc(p.fullName)}</strong><span>${[p.relationship, p.phone, p.email].filter(Boolean).map(enrolEsc).join(' · ')}</span></button>`).join('')}
      <button type="button" class="en-link" onclick="this.closest('.fm-similar').innerHTML = ''">None of These — Proceed to Create New</button></div>` : '';
  }, 400);
}

function familyPick(n, id) {
  const p = EN.family.found?.[id];
  if (!p) return;
  EN.family.slots[n] = { existing: p, editing: false };
  familyRenderSlot(n);
}

function familyReadSlot(n) {
  const slot = EN.family.slots[n];
  if (!slot) return null;
  if (slot.existing && !slot.editing) return { existingId: slot.existing.id };
  const v = id => document.getElementById(id)?.value.trim() || '';
  if (!document.getElementById(`fm${n}-name`)) return null;
  return {
    title: v(`fm${n}-title`), fullName: v(`fm${n}-name`), relationship: v(`fm${n}-rel`), relationshipOther: v(`fm${n}-rel-other`),
    occupation: v(`fm${n}-occ`), phone: enrolReadPhone(`fm${n}-phone`), email: v(`fm${n}-email`), address: v(`fm${n}-address`),
  };
}

async function familySave(btn) {
  const parent1 = familyReadSlot(1);
  const parent2 = familyReadSlot(2);
  if (!parent1 || (!parent1.existingId && !parent1.fullName)) return showToast("Parent 1's full name is required");
  if (parent2 && !parent2.existingId && !parent2.fullName) return showToast("Enter Parent 2's full name, or remove Parent 2");
  const name = document.getElementById('fm-name').value.trim();
  btn.disabled = true;
  try {
    let familyId = EN.family.id;
    if (EN.family.mode === 'manage') {
      const data = await apiFetch(`/api/admin/families/${familyId}`, { method: 'PUT', body: JSON.stringify({ name, parent1, parent2, removeParent2: !parent2 }) });
      EN.meta.families = data.families;
    } else {
      const data = await apiFetch('/api/admin/families', { method: 'POST', body: JSON.stringify({ name, parent1, parent2 }) });
      EN.meta.families = data.families;
      familyId = data.familyId;
    }
    familyModalClose();
    document.getElementById('en-family-search').value = '';
    enrolFilterFamilies(familyId);
    showToast(EN.family.mode === 'manage' ? 'Family updated' : 'Family created');
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ── Bulk Enroll Students ────────────────────────────────────────────────
function bulkRender(view = 'start', result = null) {
  const body = document.getElementById('en-body');
  if (view === 'start') {
    body.innerHTML = `<div class="en-bulk">
      <div class="card"><div class="card-head"><span class="card-title">Download Spreadsheet Template</span></div><div class="card-body en-prose">
        <p>An alternative to registering one student at a time, this enables you prepare the list of students to be enrolled into a class (in an Excel Spreadsheet) and import the list into the class.</p>
        <h4>Important To Note:</h4>
        <ul>
          <li>Use the provided Excel Spreadsheet Template (downloadable from the button below) to prepare the list.</li>
          <li>If you are importing students for different classes (e.g. Year 1 Indigo, Year 1 Violet, Year 2 Confluence, etc.), make a different list (the spreadsheet file) for each class. Do not combine all students of the different classes in one file.</li>
          <li>The Spreadsheet columns with yellow-colored headings are compulsory fields (the information have to be provided for each student).</li>
        </ul>
        <a class="post-btn en-dl" href="/api/admin/enrol/template.xlsx" download>Download Excel Template <svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9"/><polyline points="4.5 7.5 8 11 11.5 7.5"/><path d="M2 11v2.5h12V11"/></svg></a>
      </div></div>
      <div class="card"><div class="card-head"><span class="card-title">Upload Students</span></div><div class="card-body en-ready">
        <div class="en-ready-title">Ready to upload?</div>
        <button class="post-btn" onclick="bulkRender('import')">Import Students List <svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2"/><polyline points="4.5 5.5 8 2 11.5 5.5"/><path d="M2 11v2.5h12V11"/></svg></button>
      </div></div>
    </div>`;
    return;
  }
  const classes = (state.setup?.classes || []).filter(c => !c.archived);
  const meta = EN.meta || {};
  body.innerHTML = `<div class="card"><div class="card-head"><span class="card-title">Students Bulk Enroll - Import List</span><button class="btn-outline btn-sm" onclick="bulkRender('start')">&larr; Back</button></div><div class="card-body">
    <div class="en-grid three">
      ${enField('Class', `<select class="ctrl-select" id="bk-class" onchange="bulkClassChanged()">${enrolOptions(classes.map(c => [c.code, c.label]), '', 'Select')}</select>`, { required: true })}
      ${enField('Class Arm', '<select class="ctrl-select" id="bk-arm" disabled><option value="">Select Class First</option></select>', { required: true })}
      ${enField('Enrolling Into Academic Session', `<select class="ctrl-select" id="bk-session">${enrolOptions(meta.sessions || [], meta.activeSession, 'Select Academic Session')}</select>`, { required: true })}
      ${enField('Default Password', `<div class="en-pass-wrap">${enInput('bk-password', DEFAULT_STUDENT_PASSWORD, 'type="password"')}<button type="button" class="en-case-btn" onclick="enrolShowHide('bk-password', this)">Show</button></div>`, { hint: '(For all accounts to be created)' })}
      ${enField('Spreadsheet (Excel) file', '<input class="field-input" type="file" id="bk-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">', { required: true })}
      <div class="en-field"><label class="field-label">&nbsp;</label>${enCheck('bk-doubles', 'Filter Double Entries', true)}<span class="en-hint">Do not enroll students in the list whose exact names already exist in the students' record database.</span></div>
    </div>
    <div class="en-attention">
      <strong>Attention!</strong>
      <p>Double-check that the file you selected is the right list for the class you chose above.</p>
      <p>This helps you ensure the list is not imported into the wrong class.</p>
      <p>The import process is not reversible. Any mistakes would require deleting or editing the students' profiles individually.</p>
      ${enCheck('bk-sure', "I'm sure the list file is for the selected class.", false)}
    </div>
    <div class="en-after">
      <label class="en-check"><input type="radio" name="bk-after" value="stay" checked> Return to this page after import</label>
      <label class="en-check"><input type="radio" name="bk-after" value="list"> Go to class list after import</label>
    </div>
    <div class="en-center"><button class="post-btn" onclick="bulkImport(this)">Import</button></div>
    <div id="bk-result">${result ? bulkResultHtml(result) : ''}</div>
  </div></div>`;
}

function bulkClassChanged() {
  const classCode = document.getElementById('bk-class').value;
  const sel = document.getElementById('bk-arm');
  const hasArms = (state.setup?.classArms || []).some(a => a.classCode === classCode);
  sel.innerHTML = !classCode ? '<option value="">Select Class First</option>' : hasArms ? attArmOptions(classCode, 'Select') : '<option value="">— No Arms —</option>';
  sel.disabled = !hasArms;
}

function bulkFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

async function bulkImport(btn) {
  const v = id => document.getElementById(id)?.value || '';
  const file = document.getElementById('bk-file').files?.[0];
  if (!v('bk-class')) return showToast('Choose the class');
  const arm = document.getElementById('bk-arm');
  if (!arm.disabled && !arm.value) return showToast('Choose the class arm');
  if (!v('bk-session')) return showToast('Choose the academic session');
  if (!file) return showToast('Choose the spreadsheet file');
  if (!document.getElementById('bk-sure').checked) return showToast("Tick \"I'm sure the list file is for the selected class\" first");
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const data = await apiFetch('/api/admin/enrol/bulk', {
      method: 'POST',
      body: JSON.stringify({
        classCode: v('bk-class'), classArmId: arm.value, session: v('bk-session'), defaultPassword: v('bk-password'),
        fileDataUrl: await bulkFileToDataUrl(file), filterDoubles: document.getElementById('bk-doubles').checked, confirmed: true,
      }),
    });
    state.setup = data.setup;
    if (typeof populateStudents === 'function') populateStudents();
    showToast(`${data.enrolled.length} student${data.enrolled.length === 1 ? '' : 's'} enrolled`);
    if (document.querySelector('input[name="bk-after"]:checked').value === 'list' && data.enrolled.length) {
      switchTab('students', document.querySelector('[data-tab="students"]'), 'Students', 'Student Records');
      return;
    }
    bulkRender('import', data);
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

function bulkResultHtml(r) {
  const list = (rows, cls) => rows.map(x => `<li class="${cls}">Row ${x.row}: <strong>${enrolEsc(x.name)}</strong>${x.regNo ? ` — Reg. No. ${enrolEsc(x.regNo)}` : ''}${x.reason ? ` — ${enrolEsc(x.reason)}` : ''}</li>`).join('');
  return `<div class="en-result">
    <div class="en-result-stats"><span class="ok">${r.enrolled.length} enrolled</span><span class="skip">${r.skipped.length} skipped (already exist)</span><span class="bad">${r.errors.length} not enrolled</span></div>
    <ul>${list(r.errors, 'bad')}${list(r.skipped, 'skip')}${list(r.enrolled, 'ok')}</ul>
  </div>`;
}

// ── Self Registration (management) ──────────────────────────────────────
async function sregOpen(view = 'dashboard') {
  EN.sr.view = view;
  const root = document.getElementById('sr-root');
  if (!root) return;
  const tabs = [['dashboard', 'Dashboard'], ['student', 'Students'], ['parent', 'Parents'], ['staff', 'Staff'], ['settings', 'Settings']];
  root.innerHTML = `<div class="en-tabs">${tabs.map(([k, l]) => `<button class="en-tab${view === k ? ' active' : ''}" onclick="sregOpen('${k}')">${l}</button>`).join('')}</div><div id="sr-body"></div>`;
  const body = document.getElementById('sr-body');
  if (view === 'dashboard') return sregDashboard(body);
  if (view === 'settings') return sregSettings(body);
  return sregRenderList(body, view, false);
}

async function sregDashboard(body) {
  body.innerHTML = '<div class="card"><div class="card-body en-hint">Loading…</div></div>';
  try {
    const { counts } = await apiFetch('/api/admin/selfreg/summary');
    const pending = kind => counts.filter(c => c.kind === kind && c.status === 'pending').reduce((a, c) => a + c.n, 0);
    const card = (kind, title) => `<div class="card sr-dash-card"><div class="card-body">
      <div class="sr-dash-title">${title}</div><div class="sr-dash-sub">${pending(kind)} Pending Submission${pending(kind) === 1 ? '' : 's'}</div>
      <button class="post-btn btn-sm" onclick="sregOpen('${kind}')">View Submissions</button></div></div>`;
    body.innerHTML = `<div class="sr-dash">${card('student', 'Student Registrations')}${card('parent', 'Parent Registrations')}${card('staff', 'Staff Registrations')}</div>`;
  } catch (err) { body.innerHTML = `<div class="card"><div class="card-body">${enrolEsc(err.message)}</div></div>`; }
}

async function sregRenderList(body, kind, fromEnrol) {
  EN.sr.kind = kind;
  EN.sr.selected = new Set();
  EN.sr.page = 1;
  EN.sr.container = body;
  const statuses = [['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['bypassed', 'Bypassed']];
  const third = kind === 'parent' ? 'Children' : kind === 'staff' ? 'Staff Type' : 'Class';
  body.innerHTML = `<div class="card"><div class="card-head"><span class="card-title">Self Registration${kind === 'student' ? '' : ` — ${kind === 'parent' ? 'Parents' : 'Staff'}`}</span>
      <button class="btn-outline btn-sm" onclick="${fromEnrol ? "switchTab('selfRegistration', document.querySelector('[data-tab=selfRegistration]')); sregOpen('settings')" : "sregOpen('settings')"}">Settings</button></div>
    <div class="card-body">
      <div class="sr-status">${statuses.map(([k, l]) => `<button class="sr-status-btn${EN.sr.status === k ? ' active' : ''}" onclick="EN.sr.status='${k}'; sregLoad()" title="${k === 'bypassed' ? 'Submissions from someone already registered with the school (same email)' : ''}">${k === 'bypassed' ? '&#9888; ' : ''}${l}</button>`).join('')}</div>
      <div class="sr-filters">
        <label>From <input type="date" class="field-input" id="sr-from" value="${EN.sr.from}" onchange="EN.sr.from=this.value; sregPaint()"></label>
        <label>To <input type="date" class="field-input" id="sr-to" value="${EN.sr.to}" onchange="EN.sr.to=this.value; sregPaint()"></label>
        <button class="btn-outline btn-sm" title="Clear dates" onclick="EN.sr.from=''; EN.sr.to=''; document.getElementById('sr-from').value=''; document.getElementById('sr-to').value=''; sregPaint()">&times;</button>
      </div>
      <div class="sr-tools">
        <label><select class="ctrl-select" onchange="EN.sr.perPage=Number(this.value); EN.sr.page=1; sregPaint()">${[10, 25, 50, 100].map(n => `<option${n === EN.sr.perPage ? ' selected' : ''}>${n}</option>`).join('')}</select> records per page</label>
        <input class="search-input" placeholder="Search" value="${enrolEsc(EN.sr.search)}" oninput="EN.sr.search=this.value; EN.sr.page=1; sregPaint()">
      </div>
      <div class="sr-table-wrap"><table class="data-table"><thead><tr><th><input type="checkbox" id="sr-all" onchange="sregSelectAll(this.checked)"></th><th>Name</th><th>Email</th><th>Phone</th><th>${third}</th><th>Date Submitted</th><th>Status</th><th>Reviewed By</th><th>Actions</th></tr></thead><tbody id="sr-tbody"></tbody></table></div>
      <div class="sr-foot"><span id="sr-showing"></span><div class="sr-pages" id="sr-pages"></div></div>
      <div class="sr-bulk"><button class="btn-outline btn-sm" onclick="this.nextElementSibling.classList.toggle('open')">Action on Selected &#9662;</button>
        <div class="sr-bulk-menu">
          <button onclick="sregBulk('accept')">Bulk Review (Accept)</button>
          <button onclick="sregBulk('reject')">Bulk Reject</button>
          <button class="danger" onclick="sregBulk('delete')">Bulk Delete</button>
        </div></div>
    </div></div>`;
  await sregLoad();
}

async function sregLoad() {
  const body = EN.sr.container;
  body.querySelectorAll('.sr-status-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(EN.sr.status)));
  try {
    const { rows } = await apiFetch(`/api/admin/selfreg/list?kind=${EN.sr.kind}&status=${EN.sr.status}`);
    EN.sr.rows = rows;
    EN.sr.selected = new Set();
    EN.sr.page = 1;
    sregPaint();
  } catch (err) { showToast(err.message); }
}

function sregFiltered() {
  const q = EN.sr.search.toLowerCase();
  return EN.sr.rows.filter(r => {
    const day = String(r.submittedAt).slice(0, 10);
    if (EN.sr.from && day < EN.sr.from) return false;
    if (EN.sr.to && day > EN.sr.to) return false;
    return !q || [r.name, r.email, r.phone, r.classLabel].some(v => String(v || '').toLowerCase().includes(q));
  });
}

function sregPaint() {
  const rows = sregFiltered();
  const pages = Math.max(1, Math.ceil(rows.length / EN.sr.perPage));
  EN.sr.page = Math.min(EN.sr.page, pages);
  const start = (EN.sr.page - 1) * EN.sr.perPage;
  const shown = rows.slice(start, start + EN.sr.perPage);
  const tbody = document.getElementById('sr-tbody');
  if (!tbody) return;
  const fmt = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  tbody.innerHTML = shown.length ? shown.map(r => `<tr>
      <td><input type="checkbox" ${EN.sr.selected.has(r.id) ? 'checked' : ''} onchange="this.checked ? EN.sr.selected.add(${r.id}) : EN.sr.selected.delete(${r.id})"></td>
      <td><strong>${enrolEsc(r.name)}</strong></td><td>${enrolEsc(r.email)}</td><td>${enrolEsc(r.phone)}</td><td>${enrolEsc(r.classLabel)}</td>
      <td>${fmt(r.submittedAt)}</td><td><span class="sr-pill ${r.status}">${enrolEsc(r.status)}</span></td><td>${enrolEsc(r.reviewedBy || '')}</td>
      <td class="sr-actions"><button class="btn-outline btn-sm" onclick="sregView(${r.id})">View</button>${r.status !== 'accepted' ? `<button class="post-btn btn-sm" onclick="sregAct([${r.id}], 'accept')">Accept</button>` : ''}${r.status === 'pending' || r.status === 'bypassed' ? `<button class="del-btn btn-sm" onclick="sregAct([${r.id}], 'reject')">Reject</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="sr-empty">No data available in table</td></tr>';
  document.getElementById('sr-showing').textContent = `Showing ${rows.length ? start + 1 : 0} to ${start + shown.length} of ${rows.length} entries`;
  const btn = (label, page, disabled) => `<button class="btn-outline btn-sm" ${disabled ? 'disabled' : ''} onclick="EN.sr.page=${page}; sregPaint()">${label}</button>`;
  document.getElementById('sr-pages').innerHTML = btn('&laquo;', 1, EN.sr.page === 1) + btn('&lsaquo;', EN.sr.page - 1, EN.sr.page === 1) + `<span>${EN.sr.page} / ${pages}</span>` + btn('&rsaquo;', EN.sr.page + 1, EN.sr.page === pages) + btn('&raquo;', pages, EN.sr.page === pages);
  const all = document.getElementById('sr-all');
  if (all) all.checked = shown.length > 0 && shown.every(r => EN.sr.selected.has(r.id));
}

function sregSelectAll(on) {
  const rows = sregFiltered();
  const start = (EN.sr.page - 1) * EN.sr.perPage;
  rows.slice(start, start + EN.sr.perPage).forEach(r => (on ? EN.sr.selected.add(r.id) : EN.sr.selected.delete(r.id)));
  sregPaint();
}

function sregBulk(action) {
  document.querySelector('.sr-bulk-menu')?.classList.remove('open');
  if (!EN.sr.selected.size) return showToast('Tick at least one submission first');
  sregAct([...EN.sr.selected], action);
}

async function sregAct(ids, action, overrides) {
  if (action === 'delete' && !confirm(`Delete ${ids.length} submission${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
  let note = '';
  if (action === 'reject') {
    note = prompt('Reason for rejecting (optional):') ?? null;
    if (note === null) return;
  }
  if (action === 'accept' && !overrides && !confirm(`Accept ${ids.length} submission${ids.length === 1 ? '' : 's'}? Accepting creates the pupil, family or staff record.`)) return;
  try {
    const data = await apiFetch('/api/admin/selfreg/action', { method: 'POST', body: JSON.stringify({ ids, action, note, overrides }) });
    if (data.setup) state.setup = data.setup;
    const ok = data.results.filter(r => r.ok);
    const bad = data.results.filter(r => !r.ok);
    if (action === 'accept' && ok.length) alert(ok.map(r => r.message).join('\n'));
    if (bad.length) alert(`Not done:\n${bad.map(r => r.message).join('\n')}`);
    else showToast(action === 'accept' ? 'Accepted' : action === 'reject' ? 'Rejected' : 'Deleted');
    document.getElementById('sr-modal')?.remove();
    if (typeof populateStudents === 'function') populateStudents();
    await sregLoad();
  } catch (err) { showToast(err.message); }
}

async function sregView(id) {
  try {
    const { submission: s, fieldSets, staffTypes } = await apiFetch(`/api/admin/selfreg/${id}`);
    const fields = fieldSets[s.kind];
    const d = s.data;
    const classLabel = code => (state.setup?.classes || []).find(c => c.code === code)?.label || code || '';
    const armLabel = armId => (state.setup?.classArms || []).find(a => String(a.id) === String(armId))?.name || '';
    const show = (key, value) => {
      if (key === 'class') return classLabel(value);
      if (key === 'class_arm') return armLabel(value);
      if (key === 'gender') return value === 'M' ? 'Male' : value === 'F' ? 'Female' : value;
      return value;
    };
    const rowsFor = (list, src, strip = '') => list.filter(([k]) => String(src[strip ? k.slice(strip.length) : k] ?? '').trim()).map(([k, label, group]) => `<tr><td>${enrolEsc(group)}</td><td>${enrolEsc(label)}</td><td>${enrolEsc(show(strip ? k.slice(strip.length) : k, src[strip ? k.slice(strip.length) : k]))}</td></tr>`).join('');
    let detail = '';
    if (s.kind === 'parent') {
      detail = `<table class="data-table sr-detail">${rowsFor(fields.filter(([k]) => !k.startsWith('c_')), d)}</table>`
        + (d.children || []).map((c, i) => `<div class="en-sub-head">Child ${i + 1}: ${enrolEsc([c.first_name, c.surname].join(' '))} — ${enrolEsc(classLabel(c.class))}</div><table class="data-table sr-detail">${rowsFor(fields.filter(([k]) => k.startsWith('c_')), c, 'c_')}</table>`).join('');
    } else {
      detail = `<table class="data-table sr-detail">${s.kind === 'staff' ? `<tr><td>Staff</td><td>Staff Type</td><td>${enrolEsc(staffTypes.find(([k]) => k === d.staff_type)?.[1] || d.staff_type)}</td></tr>` : ''}${rowsFor(fields, d)}</table>`;
    }
    const classes = (state.setup?.classes || []).filter(c => !c.archived);
    const childPickers = s.kind === 'parent' && s.status !== 'accepted' ? (d.children || []).map((c, i) => `<div class="en-sub-head">Enrol ${enrolEsc(c.first_name || `child ${i + 1}`)} into</div><div class="en-grid">
        ${enField('Class', `<select class="ctrl-select" id="srv-c${i}-class" onchange="document.getElementById('srv-c${i}-arm').innerHTML = attArmOptions(this.value, 'Select')">${enrolOptions(classes.map(x => [x.code, x.label]), c.class, 'Select')}</select>`)}
        ${enField('Class Arm', `<select class="ctrl-select" id="srv-c${i}-arm">${attArmOptions(c.class, 'Select')}</select>`)}
      </div>`).join('') : '';
    const accept = s.status === 'accepted' ? '' : s.kind === 'parent' ? childPickers : s.kind === 'student' ? `<div class="en-grid">
        ${enField('Enrol into Class', `<select class="ctrl-select" id="srv-class" onchange="document.getElementById('srv-arm').innerHTML = attArmOptions(this.value, 'Select')">${enrolOptions(classes.map(c => [c.code, c.label]), d.class, 'Select')}</select>`)}
        ${enField('Class Arm', `<select class="ctrl-select" id="srv-arm">${attArmOptions(d.class, 'Select')}</select>`)}
      </div>` : s.kind === 'staff' && d.staff_type === 'teacher' ? `<div class="en-grid">${enField('Teacher Type', `<select class="ctrl-select" id="srv-ttype"><option value="subject_teacher">Subject Teacher</option><option value="class_teacher">Class Teacher</option></select>`)}</div>` : '';
    const modal = document.createElement('div');
    modal.id = 'sr-modal';
    modal.className = 'en-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="en-modal-box wide"><div class="en-modal-head"><span>${enrolEsc(s.name)} <span class="sr-pill ${s.status}">${enrolEsc(s.status)}</span></span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
      <div class="en-modal-body">${s.outcome ? `<div class="en-info">${enrolEsc(s.outcome)}</div>` : ''}${s.note ? `<div class="en-info">Rejection note: ${enrolEsc(s.note)}</div>` : ''}${detail}${accept}</div>
      <div class="en-modal-foot"><button class="btn-outline" onclick="this.closest('.en-modal').remove()">Close</button>
        ${s.status !== 'accepted' ? `<button class="del-btn" onclick="sregAct([${s.id}], 'reject')">Reject</button><button class="post-btn" onclick="sregAcceptFromView(${s.id})">Accept</button>` : ''}</div></div>`;
    document.body.appendChild(modal);
    if (d.class_arm && document.getElementById('srv-arm')) document.getElementById('srv-arm').value = d.class_arm;
    (d.children || []).forEach((c, i) => { const arm = document.getElementById(`srv-c${i}-arm`); if (arm && c.class_arm) arm.value = c.class_arm; });
    modal.dataset.children = String((d.children || []).length);
  } catch (err) { showToast(err.message); }
}

function sregAcceptFromView(id) {
  const overrides = {};
  const cls = document.getElementById('srv-class');
  if (cls) {
    overrides.classCode = cls.value;
    overrides.classArmId = document.getElementById('srv-arm').value;
  }
  const tt = document.getElementById('srv-ttype');
  if (tt) overrides.teacherType = tt.value;
  const kids = Number(document.getElementById('sr-modal')?.dataset.children || 0);
  if (kids) {
    overrides.children = Array.from({ length: kids }, (_, i) => ({
      classCode: document.getElementById(`srv-c${i}-class`)?.value || '', classArmId: document.getElementById(`srv-c${i}-arm`)?.value || '',
    }));
  }
  sregAct([id], 'accept', overrides);
}

// Settings
async function sregSettings(body) {
  body.innerHTML = '<div class="card"><div class="card-body en-hint">Loading…</div></div>';
  try {
    EN.sregSettings = await apiFetch('/api/admin/selfreg/settings');
  } catch (err) { body.innerHTML = enrolEsc(err.message); return; }
  const { settings: s, staffTypes } = EN.sregSettings;
  const origin = location.origin;
  const toggle = (id, on) => `<button type="button" class="rsp-toggle ${on ? 'on' : 'off'}" id="${id}" onclick="this.classList.toggle('on'); this.classList.toggle('off'); this.firstElementChild.textContent = this.classList.contains('on') ? 'ON' : 'OFF'"><span>${on ? 'ON' : 'OFF'}</span></button>`;
  const codeRow = (label, sub, code, which, link) => `<div class="sr-code"><div class="field-label">${label}</div><div class="en-hint">${sub}</div>
      <div class="sr-code-row"><input class="field-input" readonly value="${enrolEsc(code || '(Not generated yet)')}"><button class="btn-outline btn-sm" onclick="sregRegenerate('${which}')">&#8635; Regenerate</button></div></div>
    <div class="sr-code"><div class="field-label">${link[0]}</div><div class="en-hint">${link[1]}</div>
      <div class="sr-code-row"><input class="field-input" readonly id="sr-link-${which}" value="${enrolEsc(link[2])}"><button class="btn-outline btn-sm" onclick="sregCopy('sr-link-${which}')">Copy link</button></div></div>`;
  body.innerHTML = `<div class="sr-settings">
    <div class="card"><div class="card-head"><span class="card-title">Student &amp; Parent Registration</span></div><div class="card-body">
      <div class="sr-set-row"><span>Enable Student Self-Registration</span>${toggle('srs-student', s.student.enabled)}<button class="btn-outline btn-sm" onclick="sregFieldsModal('student')">Configure Form Fields</button></div>
      <div class="sr-set-row"><span>Enable Parent Self-Registration</span>${toggle('srs-parent', s.parent.enabled)}<button class="btn-outline btn-sm" onclick="sregFieldsModal('parent')">Configure Form Fields</button></div>
      ${codeRow('Access Code (Student &amp; Parent)', 'Share this code — and only this code — with students and parents', s.codes.studentParent, 'studentParent',
        ['Shareable Link (Student &amp; Parent)', 'Share with students and parents — they pick their registration type on the registration page', `${origin}/register.html`])}
    </div></div>
    <div class="card"><div class="card-head"><span class="card-title">Staff Registration</span></div><div class="card-body">
      <div class="sr-set-row"><span>Enable Staff Self-Registration</span>${toggle('srs-staff', s.staff.enabled)}<button class="btn-outline btn-sm" onclick="sregFieldsModal('staff')">Configure Form Fields</button></div>
      <div class="field-label" style="margin-top:12px;">Staff Types Allowed for Self-Registration</div><div class="en-hint">Select which staff types can self-register</div>
      <div class="sr-types">${staffTypes.map(([k, l]) => `<label class="en-check"><input type="checkbox" class="srs-type" value="${k}"${s.staff.types.includes(k) ? ' checked' : ''}> ${enrolEsc(l)}</label>`).join('')}</div>
      ${codeRow('Access Code (Staff Only)', 'Share this separately — only with staff. Never share with students or parents.', s.codes.staff, 'staff',
        ['Shareable Link (Staff Only)', 'Share exclusively with staff — this link leads to the staff registration form only', `${origin}/register.html?for=staff`])}
    </div></div>
    <div class="sr-notice"><strong>Important Security Notice</strong>
      <p>Enabling self-registration carries <strong>verification risks</strong>. Anyone with the link can submit a registration, including people who are not part of your school.</p>
      <ul><li>Never accept a submission without first verifying the identity of the person</li>
        <li>Staff submissions especially must be carefully validated — anyone can claim to be a teacher</li>
        <li><strong>Keep the two links separate</strong> — never share the staff link with students or parents</li>
        <li>Regenerate a code immediately if the link is shared beyond the intended audience</li>
        <li>This feature is <strong>disabled by default</strong> for this reason — only enable it when needed</li></ul>
      <p>All submissions go into a pending review queue. No account is created until an admin explicitly accepts the submission.</p>
    </div>
    <div class="en-center"><button class="post-btn" onclick="sregSaveSettings(this)">Save Settings</button></div>
  </div>`;
}

async function sregPostSettings(payload) {
  const data = await apiFetch('/api/admin/selfreg/settings', { method: 'POST', body: JSON.stringify(payload) });
  EN.sregSettings.settings = data.settings;
  return data.settings;
}

async function sregSaveSettings(btn) {
  const on = id => document.getElementById(id).classList.contains('on');
  btn.disabled = true;
  try {
    await sregPostSettings({
      student: { enabled: on('srs-student') }, parent: { enabled: on('srs-parent') },
      staff: { enabled: on('srs-staff'), types: [...document.querySelectorAll('.srs-type:checked')].map(i => i.value) },
    });
    showToast('Settings saved');
    sregSettings(document.getElementById('sr-body'));
  } catch (err) { showToast(err.message); } finally { btn.disabled = false; }
}

async function sregRegenerate(which) {
  if (!confirm('Generate a new access code? The old code stops working immediately.')) return;
  try {
    await apiFetch('/api/admin/selfreg/regenerate', { method: 'POST', body: JSON.stringify({ which }) });
    showToast('New code generated');
    sregSettings(document.getElementById('sr-body'));
  } catch (err) { showToast(err.message); }
}

function sregCopy(id) {
  const input = document.getElementById(id);
  navigator.clipboard?.writeText(input.value).then(() => showToast('Link copied'), () => { input.select(); document.execCommand('copy'); showToast('Link copied'); });
}

function sregFieldsModal(kind) {
  const { settings, fieldSets } = EN.sregSettings;
  const s = settings[kind];
  const title = { student: 'Student', parent: 'Parent', staff: 'Staff' }[kind];
  let lastGroup = '';
  const rows = fieldSets[kind].map(([key, label, group, locked]) => {
    const f = s.fields[key] || {};
    const head = group !== lastGroup ? `<tr class="sr-group"><td colspan="3">${enrolEsc(group)}</td></tr>` : '';
    lastGroup = group;
    const sw = (prop, on, disabled) => `<button type="button" class="rsp-toggle ${on ? 'on' : 'off'}" ${disabled ? 'disabled title="This field cannot be hidden"' : ''} onclick="sregFieldToggle('${kind}', '${key}', '${prop}', this)"><span>${on ? 'ON' : 'OFF'}</span></button>${disabled ? ' <span class="sr-lock" title="Locked">&#128274;</span>' : ''}`;
    return `${head}<tr><td>${enrolEsc(label)}</td><td>${sw('show', f.show, locked)}</td><td>${sw('required', f.required, locked)}</td></tr>`;
  }).join('');
  const setting = (prop, label, sub) => `<div class="sr-set-row"><div><strong>${label}</strong><div class="en-hint">${sub}</div></div><button type="button" class="rsp-toggle ${s[prop] ? 'on' : 'off'}" onclick="sregFlagToggle('${kind}', '${prop}', this)"><span>${s[prop] ? 'ON' : 'OFF'}</span></button></div>`;
  const modal = document.createElement('div');
  modal.className = 'en-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `<div class="en-modal-box wide"><div class="en-modal-head"><span>${title} — Form Fields</span><button class="en-x" onclick="this.closest('.en-modal').remove()">&times;</button></div>
    <div class="en-modal-body">
      ${kind === 'parent' ? setting('requireChild', 'Require at least one child', 'Parents must link or add at least one child before they can submit their registration.') : ''}
      ${setting('blockReReg', 'Block re-registration by enrolled users', `If enabled, users whose email already exists anywhere in the system will be blocked from submitting a new ${kind} registration.`)}
      <div class="en-sub-head">Form Fields / Dataset Configuration</div>
      <div class="en-hint" style="margin-bottom:8px;">Toggle fields on or off. Changes save instantly. Locked fields &#128274; cannot be hidden — they are essential.</div>
      <table class="data-table sr-fields"><thead><tr><th>Field</th><th>Show in Form</th><th>Required <span class="en-hint">(Must be provided when filling the form)</span></th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="en-modal-foot"><button class="btn-outline" onclick="this.closest('.en-modal').remove()">Close</button></div></div>`;
  document.body.appendChild(modal);
}

async function sregFieldToggle(kind, key, prop, btn) {
  const f = { ...EN.sregSettings.settings[kind].fields[key] };
  f[prop] = !f[prop];
  if (prop === 'show' && !f.show) f.required = false;
  if (prop === 'required' && f.required) f.show = true;
  try {
    const s = await sregPostSettings({ [kind]: { fields: { [key]: f } } });
    const row = btn.closest('tr');
    const [showBtn, reqBtn] = row.querySelectorAll('.rsp-toggle');
    const now = s[kind].fields[key];
    [[showBtn, now.show], [reqBtn, now.required]].forEach(([b, on]) => { b.className = `rsp-toggle ${on ? 'on' : 'off'}`; b.firstElementChild.textContent = on ? 'ON' : 'OFF'; });
  } catch (err) { showToast(err.message); }
}

async function sregFlagToggle(kind, prop, btn) {
  try {
    const s = await sregPostSettings({ [kind]: { [prop]: !EN.sregSettings.settings[kind][prop] } });
    const on = s[kind][prop];
    btn.className = `rsp-toggle ${on ? 'on' : 'off'}`;
    btn.firstElementChild.textContent = on ? 'ON' : 'OFF';
  } catch (err) { showToast(err.message); }
}

// Editing a pupil from the Student Directory opens the same wizard
window.editStudent = id => enrolEdit(id);
