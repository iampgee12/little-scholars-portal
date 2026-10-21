// The exam server's pupil sign-in (EXAM_MODE /signin): username and password only.
// The computers are shared by pupils, so opening this page signs the last one out.
const form = document.getElementById('signin');
const alertEl = document.getElementById('alert');
const btn = document.getElementById('go');

function showError(text) {
  alertEl.textContent = text;
  alertEl.classList.add('show');
}

document.getElementById('eye').addEventListener('click', () => {
  const pw = document.getElementById('pw');
  pw.type = pw.type === 'password' ? 'text' : 'password';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  alertEl.classList.remove('show');
  const id = document.getElementById('user').value.trim();
  const password = document.getElementById('pw').value;
  if (!id) return showError('Please enter your username.');
  if (!password) return showError('Please enter your password.');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password, role: 'student' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error === 'Incorrect ID or password' ? 'Incorrect username or password.' : data.error || 'Could not sign in. Please try again.');
    // admins sign in from the exam server app, which has no extra steps here
    if (!data.user) throw new Error('Please sign in from the UCS Exam Server app.');
    window.location.replace(data.portal || '/student');
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Brought back from the browser's memory (Back button): ready for the next pupil
window.addEventListener('pageshow', e => {
  if (!e.persisted) return;
  btn.disabled = false;
  btn.textContent = 'Sign In';
  fetch('/api/logout', { method: 'POST' }).catch(() => {});
});
fetch('/api/logout', { method: 'POST' }).catch(() => {});
document.getElementById('user').focus();
