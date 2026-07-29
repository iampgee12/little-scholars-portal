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
  const badge = document.getElementById('role-badge');
  badge.textContent  = meta.badge;
  badge.className    = 'role-badge ' + meta.badgeClass;
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
    if (!res.ok) throw new Error('Incorrect ID or password. Please try again.');
    const data = await res.json();
    const user = data.user;

    // Server-side role mismatch guard (belt-and-suspenders)
    if (user.role !== selectedRole) {
      throw new Error(`This account does not have ${meta.badge.toLowerCase()} access. Please go back and choose the correct portal.`);
    }

    const portal = data.portal || PORTALS[user.role];
    localStorage.setItem('ls_user_id',   user.id);
    localStorage.setItem('ls_user_role', user.role);

    document.getElementById('redirect-role').textContent  = meta.portalLabel;
    document.getElementById('redirect-role').style.color  = meta.color;
    document.getElementById('redirect-overlay').classList.add('show');

    setTimeout(() => { window.location.href = portal; }, 500);
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

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && selectedRole) handleLogin();
  if (e.key === 'Escape') goBack();
});

// Clear any stale session on page load
localStorage.removeItem('ls_user_id');
localStorage.removeItem('ls_user_role');
fetch('/api/logout', { method: 'POST' }).catch(() => {});
