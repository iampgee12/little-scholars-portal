const PORTALS = {
  student: 'student-portal.html',
  teacher: 'teacher-portal.html',
  admin:   'admin-portal.html',
};

const ROLE_META = {
  admin: {
    title:       'Admin Login',
    badge:       'ADMIN',
    badgeClass:  'admin',
    idLabel:     'Admin ID',
    placeholder: 'e.g. ADM-001',
    prefix:      'ADM-',
    color:       'var(--blue)',
    portalLabel: 'Admin Portal',
  },
  teacher: {
    title:       'Staff Login',
    badge:       'STAFF',
    badgeClass:  'teacher',
    idLabel:     'Staff ID',
    placeholder: 'e.g. TCH-001',
    prefix:      'TCH-',
    color:       'var(--amber)',
    portalLabel: 'Teacher Portal',
  },
  student: {
    title:       'Pupil Login',
    badge:       'PUPIL',
    badgeClass:  'student',
    idLabel:     'Student ID',
    placeholder: 'e.g. STU-2024-0421',
    prefix:      'STU-',
    color:       'var(--green)',
    portalLabel: 'Student Portal',
  },
};

let selectedRole = null;

function selectRole(role) {
  selectedRole = role;
  const meta = ROLE_META[role];

  // Populate login form for chosen role
  document.getElementById('login-title').textContent  = meta.title;
  document.getElementById('id-label').textContent     = meta.idLabel;
  document.getElementById('sid').placeholder          = meta.placeholder;
  document.getElementById('sid').value                = '';
  document.getElementById('pw').value                 = '';

  // Clear any previous errors
  ['sid','pw'].forEach(id => document.getElementById(id).classList.remove('error'));
  ['sid-err','pw-err','alert'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('show');
    el.textContent = '';
  });

  // Transition
  const s1 = document.getElementById('step-select');
  const s2 = document.getElementById('step-login');
  s1.classList.add('hidden');
  s2.classList.remove('hidden');
  s2.classList.remove('anim-in');
  void s2.offsetWidth; // force reflow
  s2.classList.add('anim-in');
}

function goBack() {
  const s1 = document.getElementById('step-select');
  const s2 = document.getElementById('step-login');
  s2.classList.add('hidden');
  s1.classList.remove('hidden');
  s1.classList.remove('anim-in');
  void s1.offsetWidth;
  s1.classList.add('anim-in');
  selectedRole = null;
}

// Signed in: go to the right portal
function finishSignIn(data) {
  const user = data.user;
  const meta = ROLE_META[selectedRole] || ROLE_META[user.role];
  // Server-side role mismatch guard (belt-and-suspenders)
  if (selectedRole && user.role !== selectedRole) {
    fetch('/api/logout', { method: 'POST' }).catch(() => {});
    throw new Error(`This account does not have ${meta.badge.toLowerCase()} access. Please go back and choose the correct portal.`);
  }
  localStorage.setItem('ls_user_id',   user.id);
  localStorage.setItem('ls_user_role', user.role);
  document.getElementById('redirect-role').textContent  = meta.portalLabel;
  document.getElementById('redirect-role').style.color  = meta.color;
  document.getElementById('redirect-overlay').classList.add('show');
  setTimeout(() => { window.location.href = data.portal || PORTALS[user.role]; }, 500);
}

// ── Extra sign-in step: emailed code (admins) or choosing a new password ──
let extraState = null; // { pending, step }

function showStep(showId) {
  ['step-select', 'step-login', 'step-extra'].forEach(id => document.getElementById(id).classList.toggle('hidden', id !== showId));
  const el = document.getElementById(showId);
  el.classList.remove('anim-in');
  void el.offsetWidth;
  el.classList.add('anim-in');
}

function extraAlert(text, info = false) {
  const el = document.getElementById('extra-alert');
  el.textContent = text || '';
  el.classList.toggle('show', !!text);
  el.classList.toggle('info', info);
}

function showExtraStep(data) {
  extraState = { pending: data.pending, step: data.step };
  const isCode = data.step === 'code';
  document.getElementById('extra-title').textContent = isCode ? 'Check your email' : 'Choose a new password';
  document.getElementById('extra-sub').textContent = isCode ? 'Two-step sign-in' : 'One more step to sign in';
  document.getElementById('extra-code').style.display = isCode ? '' : 'none';
  document.getElementById('extra-change').style.display = isCode ? 'none' : '';
  document.getElementById('extra-btn-txt').textContent = isCode ? 'Verify code' : 'Save and sign in';
  if (isCode) document.getElementById('extra-code-note').textContent = `We've emailed a 6-digit code to ${data.sentTo}. Enter it below to finish signing in. It expires in 10 minutes.`;
  else document.getElementById('extra-rules').textContent = data.rules || '';
  ['otp', 'np1', 'np2'].forEach(id => { document.getElementById(id).value = ''; });
  extraAlert('');
  showStep('step-extra');
  setTimeout(() => document.getElementById(isCode ? 'otp' : 'np1').focus(), 50);
}

function extraBack() {
  extraState = null;
  showStep('step-login');
}

async function extraCall(path, payload) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending: extraState.pending, ...payload }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.restart) extraState = null;
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

async function extraSubmit() {
  if (!extraState) return extraBack();
  const btn = document.getElementById('extra-btn');
  let path, payload;
  if (extraState.step === 'code') {
    const code = document.getElementById('otp').value.replace(/\D/g, '');
    if (code.length !== 6) return extraAlert('Enter the 6-digit code from the email.');
    path = '/api/login/code';
    payload = { code, remember: document.getElementById('otp-remember').checked };
  } else {
    const a = document.getElementById('np1').value;
    const b = document.getElementById('np2').value;
    if (!a) return extraAlert('Enter a new password.');
    if (a !== b) return extraAlert('The two passwords are not the same.');
    path = '/api/login/change';
    payload = { newPassword: a };
  }
  btn.disabled = true;
  try {
    const data = await extraCall(path, payload);
    if (data.step) return showExtraStep(data);
    finishSignIn(data);
  } catch (err) {
    extraAlert(err.message);
    if (!extraState) setTimeout(extraBack, 1800);
  } finally {
    btn.disabled = false;
  }
}

async function extraResend() {
  if (!extraState) return extraBack();
  try {
    const data = await extraCall('/api/login/resend', {});
    extraState.pending = data.pending;
    extraAlert(`A new code has been sent to ${data.sentTo}.`, true);
  } catch (err) { extraAlert(err.message); }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && extraState && !document.getElementById('step-extra').classList.contains('hidden')) extraSubmit();
});

function togglePw() {
  const p    = document.getElementById('pw');
  const icon = document.getElementById('eye-icon');
  if (p.type === 'password') {
    p.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    p.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

function setLoading(isLoading) {
  const btn = document.getElementById('btn');
  btn.disabled = isLoading;
  document.getElementById('btn-txt').textContent  = isLoading ? 'Signing in...' : 'Sign In';
  document.getElementById('btn-arr').style.display = isLoading ? 'none' : '';
  document.getElementById('spin').style.display    = isLoading ? 'block' : 'none';
}

async function handleLogin() {
  if (!selectedRole) return;

  const sidEl  = document.getElementById('sid');
  const pwEl   = document.getElementById('pw');
  const sidErr = document.getElementById('sid-err');
  const pwErr  = document.getElementById('pw-err');
  const alertEl = document.getElementById('alert');
  const meta   = ROLE_META[selectedRole];

  const sid = sidEl.value.trim();
  const pw  = pwEl.value.trim();

  // Reset
  [sidEl, pwEl].forEach(el => el.classList.remove('error'));
  [sidErr, pwErr, alertEl].forEach(el => { el.classList.remove('show'); el.textContent = ''; });

  let valid = true;
  if (!sid) {
    sidEl.classList.add('error');
    sidErr.textContent = 'Please enter your ID.';
    sidErr.classList.add('show');
    valid = false;
  } else if (!sid.toUpperCase().startsWith(meta.prefix)) {
    // ID does not belong to the selected role
    sidEl.classList.add('error');
    sidErr.textContent = `${meta.idLabel}s start with "${meta.prefix}". Check your ID or go back.`;
    sidErr.classList.add('show');
    valid = false;
  }
  if (!pw) {
    pwEl.classList.add('error');
    pwErr.textContent = 'Please enter your password.';
    pwErr.classList.add('show');
    valid = false;
  }
  if (!valid) return;

  setLoading(true);
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Incorrect ID or password. Please try again.' : (data.error || 'Sign-in failed. Please try again.'));
    }
    if (data.step) {
      setLoading(false);
      pwEl.value = '';
      return showExtraStep(data);
    }
    finishSignIn(data);
  } catch (err) {
    setLoading(false);
    alertEl.textContent = err.message.includes('Failed to fetch')
      ? 'Cannot reach the server. Make sure the Node server is running.'
      : err.message;
    alertEl.classList.add('show');
    sidEl.classList.add('error');
    pwEl.classList.add('error');
  }
}

function openForgotModal() {
  const idEl = document.getElementById('forgot-id');
  idEl.value = selectedRole ? document.getElementById('sid').value : '';
  const alertEl = document.getElementById('forgot-alert');
  alertEl.classList.remove('show');
  alertEl.style.color = '';
  alertEl.style.background = '';
  alertEl.style.borderColor = '';
  document.getElementById('forgot-modal').style.display = 'flex';
}

function closeForgotModal() {
  document.getElementById('forgot-modal').style.display = 'none';
}

async function submitForgotPassword() {
  const idEl = document.getElementById('forgot-id');
  const alertEl = document.getElementById('forgot-alert');
  const btn = document.getElementById('forgot-btn');
  const btnTxt = document.getElementById('forgot-btn-txt');
  const id = idEl.value.trim();

  alertEl.classList.remove('show');
  if (!id) {
    alertEl.style.color = '';
    alertEl.style.background = '';
    alertEl.style.borderColor = '';
    alertEl.textContent = 'Please enter your ID.';
    alertEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btnTxt.textContent = 'Sending...';
  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    alertEl.style.color = 'var(--green)';
    alertEl.style.background = 'var(--green-bg)';
    alertEl.style.borderColor = 'rgba(22,163,74,0.2)';
    alertEl.textContent = data.message || 'If an email address is on file, a reset link has been sent.';
    alertEl.classList.add('show');
  } catch (err) {
    alertEl.style.color = '';
    alertEl.style.background = '';
    alertEl.style.borderColor = '';
    alertEl.textContent = err.message.includes('Failed to fetch')
      ? 'Cannot reach the server. Make sure the Node server is running.'
      : err.message;
    alertEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btnTxt.textContent = 'Send Reset Link';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && selectedRole && !document.getElementById('step-login').classList.contains('hidden')) handleLogin();
  if (e.key === 'Escape') {
    if (document.getElementById('forgot-modal').style.display === 'flex') {
      closeForgotModal();
    } else {
      goBack();
    }
  }
});

// Clear any stale session on page load
localStorage.removeItem('ls_user_id');
localStorage.removeItem('ls_user_role');
fetch('/api/logout', { method: 'POST' }).catch(() => {});
