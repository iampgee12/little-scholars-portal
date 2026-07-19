const PORTALS = {
  student: 'student-portal.html',
  teacher: 'teacher-portal.html',
  admin: 'admin-portal.html',
};

const ROLE_META = {
  student: { color: 'var(--green)', label: 'Student account detected - Class portal' },
  teacher: { color: 'var(--amber)', label: 'Teacher account detected - Staff portal' },
  admin: { color: 'var(--blue)', label: 'Administrator account detected - Admin portal' },
};

function detectRole(val) {
  val = (val || '').trim().toUpperCase();
  const hint = document.getElementById('id-hint');
  const dot = document.getElementById('hint-dot');
  const txt = document.getElementById('hint-text');

  let role = null;
  if (val.startsWith('STU-')) role = 'student';
  else if (val.startsWith('TCH-')) role = 'teacher';
  else if (val.startsWith('ADM-')) role = 'admin';

  if (role) {
    const meta = ROLE_META[role];
    dot.style.background = meta.color;
    txt.style.color = meta.color;
    txt.textContent = meta.label;
    hint.classList.add('show');
  } else {
    hint.classList.remove('show');
  }
}

function togglePw() {
  const p = document.getElementById('pw');
  const icon = document.getElementById('eye-icon');
  if (p.type === 'password') {
    p.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    p.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

function fillDemo(id, pw) {
  document.getElementById('sid').value = id;
  document.getElementById('pw').value = pw;
  document.getElementById('pw').type = 'password';
  document.getElementById('eye-icon').innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  detectRole(id);
  ['sid', 'pw'].forEach(id => document.getElementById(id).classList.remove('error'));
  ['sid-err', 'pw-err', 'alert'].forEach(id => document.getElementById(id).classList.remove('show'));
}

function setLoading(isLoading) {
  const btn = document.getElementById('btn');
  btn.disabled = isLoading;
  document.getElementById('btn-txt').textContent = isLoading ? 'Signing in...' : 'Sign In';
  document.getElementById('btn-arr').style.display = isLoading ? 'none' : '';
  document.getElementById('spin').style.display = isLoading ? 'block' : 'none';
}

async function handleLogin() {
  const sidEl = document.getElementById('sid');
  const pwEl = document.getElementById('pw');
  const sidErr = document.getElementById('sid-err');
  const pwErr = document.getElementById('pw-err');
  const alert = document.getElementById('alert');

  const sid = sidEl.value.trim();
  const pw = pwEl.value.trim();

  [sidEl, pwEl].forEach(el => el.classList.remove('error'));
  [sidErr, pwErr, alert].forEach(el => el.classList.remove('show'));

  let valid = true;
  if (!sid) {
    sidEl.classList.add('error');
    sidErr.classList.add('show');
    valid = false;
  }
  if (!pw) {
    pwEl.classList.add('error');
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
    const portal = data.portal || PORTALS[user.role];

    localStorage.setItem('ls_user_id', user.id);
    localStorage.setItem('ls_user_role', user.role);

    const roleLabels = { student: 'Student Portal', teacher: 'Teacher Portal', admin: 'Admin Portal' };
    document.getElementById('redirect-role').textContent = roleLabels[user.role] || 'Portal';
    document.getElementById('redirect-role').style.color = ROLE_META[user.role]?.color || 'var(--green)';
    document.getElementById('redirect-overlay').classList.add('show');

    setTimeout(() => {
      window.location.href = `${portal}?uid=${encodeURIComponent(user.id)}`;
    }, 500);
  } catch (err) {
    setLoading(false);
    alert.textContent = err.message.includes('Failed to fetch')
      ? 'Start the Node server first, then sign in through http://localhost:3000.'
      : err.message;
    alert.classList.add('show');
    sidEl.classList.add('error');
    pwEl.classList.add('error');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

localStorage.removeItem('ls_user_id');
localStorage.removeItem('ls_user_role');
fetch('/api/logout', { method: 'POST' }).catch(() => {});
