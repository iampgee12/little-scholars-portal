async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401) {
    window.location.replace('index.html');
    throw new Error('Authentication required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function init() {
  const session = await apiFetch('/api/session');
  if (session.user.role !== 'student') {
    window.location.replace('index.html');
    return;
  }
  const acct = session.user;
  document.getElementById('s-avatar').textContent = acct.initials;
  document.getElementById('s-name').textContent = acct.name;
  document.getElementById('s-grade').textContent = acct.grade || 'Student Portal';
  document.title = `Little Scholars - ${acct.firstName}`;

  const hr = new Date().getHours();
  const gr = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('s-greeting').textContent = `${gr}, ${acct.firstName}.`;
}

const TAB_META = {
  dashboard: { title: 'Dashboard', sub: 'Wednesday, 13 May 2026' },
  timetable: { title: 'Timetable', sub: 'Class Schedule' },
  assignments: { title: 'Assignments', sub: '4 pending - 2 submitted' },
  courses: { title: 'Courses & Grades', sub: 'Term 2 - 2025/2026' },
  results: { title: 'Exam Results', sub: 'Mid-Term & Final Exams' },
};

function switchTab(tab, trigger) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (trigger) trigger.classList.add('active');
  const m = TAB_META[tab] || {};
  document.getElementById('topbar-title').textContent = m.title || tab;
  document.getElementById('topbar-sub').textContent = m.sub || '';
}

function switchResult(type, btn) {
  document.querySelectorAll('.result-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('result-midterm').style.display = type === 'midterm' ? '' : 'none';
  document.getElementById('result-final').style.display = type === 'final' ? '' : 'none';
}

function filterAssign(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.assign-card').forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
  });
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ls_user_id');
  localStorage.removeItem('ls_user_role');
  window.location.href = 'index.html';
}

init();
