// Public self-registration (students, parents, staff). The admin turns each
// one on, chooses its fields and shares an access code (Self Registration →
// Settings). Every submission waits for the admin to accept it.

const RG = { staffOnly: new URLSearchParams(location.search).get('for') === 'staff', kind: '', code: '', form: null, children: 0 };
const rgBody = () => document.getElementById('rg-body');

async function rgPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong — please try again');
  return data;
}

function rgMsg(text, type = 'err') {
  return text ? `<div class="rg-msg ${type}">${enrolEsc(text)}</div>` : '';
}

async function rgStart() {
  let status = { student: false, parent: false, staff: false };
  try { status = await (await fetch('/api/register/status')).json(); } catch {}
  if (status.school) document.getElementById('rg-school').textContent = status.school;
  if (RG.staffOnly) {
    document.getElementById('rg-sub').textContent = 'Staff Registration';
    if (!status.staff) return rgClosed();
    RG.kind = 'staff';
    return rgCodeStep();
  }
  if (!status.student && !status.parent) return rgClosed();
  rgBody().innerHTML = `<div class="rg-group">What are you registering as?</div>
    <div class="rg-types">
      <button class="rg-type" ${status.student ? '' : 'disabled'} onclick="RG.kind='student'; rgCodeStep()"><strong>Student</strong><span>${status.student ? 'Register a pupil' : 'Not open at the moment'}</span></button>
      <button class="rg-type" ${status.parent ? '' : 'disabled'} onclick="RG.kind='parent'; rgCodeStep()"><strong>Parent / Guardian</strong><span>${status.parent ? 'Register yourself and your children' : 'Not open at the moment'}</span></button>
    </div>`;
}

function rgClosed() {
  rgBody().innerHTML = '<div class="rg-done"><h2>Registration is closed</h2><p>Online registration is not open at the moment. Please contact the school office.</p></div>';
}

function rgCodeStep(error = '') {
  rgBody().innerHTML = `${rgMsg(error)}
    <label class="field-label" for="rg-code">Access Code</label>
    <input class="field-input" id="rg-code" placeholder="Enter the code the school gave you" autocomplete="off" style="text-transform:uppercase;font-family:'DM Mono',monospace;">
    <div class="rg-actions">${RG.staffOnly ? '<span></span>' : '<button class="btn btn-line" onclick="rgStart()">&larr; Back</button>'}<button class="btn btn-green" onclick="rgOpen(this)">Continue</button></div>`;
  document.getElementById('rg-code').addEventListener('keydown', e => { if (e.key === 'Enter') rgOpen(); });
}

async function rgOpen(btn) {
  RG.code = document.getElementById('rg-code').value.trim().toUpperCase();
  if (!RG.code) return rgCodeStep('Enter the access code');
  if (btn) btn.disabled = true;
  try {
    RG.form = await rgPost('/api/register/open', { code: RG.code, kind: RG.kind });
    rgRenderForm();
  } catch (err) {
    rgCodeStep(err.message);
  }
}

// One input for a configured field. `id` is the element id, `key` the field key.
function rgInput(key, id, f, value = '') {
  const req = f.required ? ' <span class="rg-req">*</span>' : '';
  const wrap = (inner, wide = false) => `<div class="en-field${wide ? ' wide' : ''}"><label class="field-label" for="${id}">${enrolEsc(f.label)}${req}</label>${inner}</div>`;
  const plain = key.replace(/^c_/, '');
  if (plain === 'gender') return wrap(`<select class="ctrl-select" id="${id}">${enrolOptions([['M', 'Male'], ['F', 'Female']], value, 'Select')}</select>`);
  if (plain === 'dob') return wrap(`<input class="field-input" type="date" id="${id}">`);
  if (plain === 'blood_group') return wrap(`<select class="ctrl-select" id="${id}">${enrolOptions(ENROL_BLOOD_GROUPS, value, 'Select')}</select>`);
  if (plain === 'genotype') return wrap(`<select class="ctrl-select" id="${id}">${enrolOptions(ENROL_GENOTYPES, value, 'Select')}</select>`);
  if (plain === 'nationality') return wrap(`<select class="ctrl-select" id="${id}">${enrolOptions(ENROL_COUNTRIES, value, '-Select Country -')}</select>`);
  if (plain === 'relationship' && RG.kind === 'parent') return wrap(`<select class="ctrl-select" id="${id}">${enrolOptions(ENROL_RELATIONSHIPS, value, 'Select')}</select>`);
  if (plain.endsWith('phone')) return enrolPhoneField(id, value, f.label).replace('</label>', `${req}</label>`);
  if (plain.endsWith('email')) return wrap(`<input class="field-input" type="email" id="${id}">`);
  if (plain === 'address' || plain.endsWith('_address')) return wrap(`<textarea class="field-input" rows="2" id="${id}"></textarea>`, true);
  if (plain === 'class') return wrap(`<select class="ctrl-select" id="${id}" onchange="rgArms('${id}')">${enrolOptions(RG.form.classes.map(c => [c.code, c.label]), value, 'Select')}</select>`);
  if (plain === 'class_arm') return wrap(`<select class="ctrl-select" id="${id}"><option value="">Select Class First</option></select>`);
  return wrap(`<input class="field-input" id="${id}">`);
}

function rgArms(classId) {
  const armId = classId.replace(/class$/, 'class_arm');
  const sel = document.getElementById(armId);
  if (!sel) return;
  const code = document.getElementById(classId).value;
  const arms = RG.form.arms.filter(a => a.classCode === code);
  sel.innerHTML = !code ? '<option value="">Select Class First</option>' : arms.length ? enrolOptions(arms.map(a => [a.id, a.name]), '', 'Select') : '<option value="">— No Arms —</option>';
}

function rgSection(fields, idPrefix) {
  let html = '';
  let group = '';
  for (const f of fields.filter(x => x.show)) {
    if (f.group !== group) {
      if (group) html += '</div>';
      group = f.group;
      html += `<div class="rg-group">${enrolEsc(group === 'Next Of Kin' ? 'Next of Kin' : group)}</div><div class="rg-grid">`;
    }
    html += rgInput(f.key, `${idPrefix}${f.key}`, f);
  }
  return html + (group ? '</div>' : '');
}

function rgRenderForm(error = '') {
  const f = RG.form;
  const title = { student: 'Student Registration', parent: 'Parent / Guardian Registration', staff: 'Staff Registration' }[RG.kind];
  document.getElementById('rg-sub').textContent = title;
  let html = rgMsg(error);
  if (RG.kind === 'staff') {
    html += `<div class="rg-group">Staff Type</div><div class="rg-grid"><div class="en-field"><label class="field-label" for="rg-staff_type">Registering As <span class="rg-req">*</span></label>
      <select class="ctrl-select" id="rg-staff_type">${enrolOptions(f.staffTypes.map(t => [t.value, t.label]), '', 'Select')}</select></div></div>`;
  }
  if (RG.kind === 'parent') {
    html += rgSection(f.fields.filter(x => !x.key.startsWith('c_')), 'rg-');
    html += `<div class="rg-group">Children${f.requireChild ? ' <span class="rg-req">*</span>' : ''}</div><div id="rg-children"></div>
      <button type="button" class="rg-link" onclick="rgAddChild()">+ Add a Child</button>`;
  } else {
    html += rgSection(f.fields, 'rg-');
  }
  html += `<div class="rg-actions"><button class="btn btn-line" onclick="${RG.staffOnly ? 'rgCodeStep()' : 'rgStart()'}">&larr; Back</button><button class="btn btn-green" onclick="rgSubmit(this)">Submit Registration</button></div>`;
  rgBody().innerHTML = html;
  if (RG.kind === 'parent') { RG.children = 0; rgAddChild(); }
}

function rgAddChild() {
  RG.children += 1;
  const n = RG.children;
  const childFields = [
    ...RG.form.fields.filter(x => x.key.startsWith('c_') && x.key !== 'c_class_arm'),
    { key: 'c_class', label: 'Class', group: 'Child', show: true, required: true },
    ...RG.form.fields.filter(x => x.key === 'c_class_arm'),
  ];
  const div = document.createElement('div');
  div.className = 'rg-child';
  div.dataset.child = n;
  div.innerHTML = `<div class="rg-child-head"><span>Child</span><button type="button" class="rg-link danger" onclick="this.closest('.rg-child').remove()">Remove</button></div>
    <div class="rg-grid">${childFields.filter(x => x.show).map(x => rgInput(x.key, `rgc${n}-${x.key}`, x)).join('')}</div>`;
  document.getElementById('rg-children').appendChild(div);
}

function rgRead(prefix, fields) {
  const out = {};
  for (const f of fields.filter(x => x.show)) {
    const id = `${prefix}${f.key}`;
    const key = f.key.replace(/^c_/, '');
    out[key] = key.endsWith('phone') ? enrolReadPhone(id) : (document.getElementById(id)?.value || '').trim();
  }
  return out;
}

async function rgSubmit(btn) {
  const f = RG.form;
  let data;
  if (RG.kind === 'parent') {
    data = rgRead('rg-', f.fields.filter(x => !x.key.startsWith('c_')));
    const childFields = [...f.fields.filter(x => x.key.startsWith('c_')), { key: 'c_class', show: true }];
    data.children = [...document.querySelectorAll('.rg-child')].map(div => rgRead(`rgc${div.dataset.child}-`, childFields));
  } else {
    data = rgRead('rg-', f.fields);
    if (RG.kind === 'staff') data.staff_type = document.getElementById('rg-staff_type').value;
  }
  btn.disabled = true;
  try {
    await rgPost('/api/register/submit', { code: RG.code, kind: RG.kind, data });
    rgBody().innerHTML = `<div class="rg-done"><h2>Registration submitted</h2>
      <p>Thank you. Your registration has been sent to the school and is waiting for review.<br>The school will contact you once it has been accepted.</p></div>`;
  } catch (err) {
    btn.disabled = false;
    const msg = document.querySelector('.rg-msg');
    if (msg) msg.remove();
    rgBody().insertAdjacentHTML('afterbegin', rgMsg(err.message));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

rgStart();
