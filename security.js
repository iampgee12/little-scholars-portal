// Portal security: password rules, forced password changes, two-step login
// for admins (emailed code), activity (audit) log, idle sign-out, per-IP
// login limits, browser security headers and daily database backups.
// server.js passes in its helpers (ctx) and calls these from its login
// routes, request wrapper and static file server.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOffsite } = require('./offsite-backup');

module.exports = function createSecurity(ctx) {
  const { db, one, all, run, ensureColumn, cleanText, readJson, sendJson, requireUser, hashPassword, verifyPassword,
    smtpConfigStatus, smtpSend, zipFiles, IS_PROD, DATA_DIR, UPLOAD_DIR, REPORT_DIR, COOKIE_NAME, parseCookies } = ctx;

  const nowIso = () => new Date().toISOString();
  const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');

  // Staff are signed out after this long without using the portal; pupils a bit later
  const IDLE_MINUTES = { admin: 30, teacher: 30, student: 60 };
  const SESSION_HOURS = { admin: 12, teacher: 24, student: 24 };
  const DEVICE_COOKIE = 'ls_device';
  const DEVICE_DAYS = 30;
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');
  const BACKUPS_KEPT = 14;
  // encrypted copies at a second storage company (offsite-backup.js)
  const offsite = createOffsite({ db, one, all, run, DATA_DIR, UPLOAD_DIR, REPORT_DIR, audit: (...a) => audit(...a), alertAdmins: (...a) => alertAdmins(...a) });

  function createSchema() {
    offsite.createSchema();
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT,
        role TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        ip TEXT,
        device TEXT,
        outcome TEXT NOT NULL DEFAULT 'ok'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at);
      CREATE TABLE IF NOT EXISTS trusted_devices (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    ensureColumn('sessions', 'last_seen_at', 'TEXT');
    ensureColumn('sessions', 'ip', 'TEXT');
    ensureColumn('sessions', 'device', 'TEXT');
    // NULL = set before these rules existed (judged at next sign-in);
    // 0 = set by an administrator (must be changed); 1 = chosen by the user
    ensureColumn('users', 'password_self_set', 'INTEGER');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS users_password_new AFTER INSERT ON users
      BEGIN UPDATE users SET password_self_set = 0 WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS users_password_reset AFTER UPDATE OF password ON users
      WHEN NEW.password IS NOT OLD.password
      BEGIN UPDATE users SET password_self_set = 0 WHERE id = NEW.id; END;
    `);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // keep a year of activity
    run('DELETE FROM audit_log WHERE at < ?', new Date(Date.now() - 365 * 864e5).toISOString());
  }

  // ── Request details ───────────────────────────────────────────────────
  function clientIp(req) {
    return String(req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 64);
  }
  function deviceLabel(req) {
    const ua = String(req.headers['user-agent'] || '');
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
    return `${browser} on ${os}`;
  }

  // ── Activity log ──────────────────────────────────────────────────────
  function audit(req, user, action, detail = '', outcome = 'ok') {
    try {
      run('INSERT INTO audit_log (at, user_id, user_name, role, action, detail, ip, device, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        nowIso(), user?.id || null, user?.name || null, user?.role || null, String(action).slice(0, 120), String(detail || '').slice(0, 500),
        req ? clientIp(req) : '', req ? deviceLabel(req) : '', outcome);
    } catch (err) { console.error('audit log failed', err.message); }
  }

  // Readable names for the changes the request wrapper records automatically
  const ACTION_LABELS = [
    [/^POST \/api\/admin\/enrol\/student$/, 'Enrolled a student'],
    [/^PUT \/api\/admin\/enrol\/student\//, 'Updated a student profile'],
    [/^DELETE \/api\/admin\/students\//, 'Deleted a student'],
    [/^POST \/api\/admin\/enrol\/bulk/, 'Bulk enrolled students'],
    [/^POST \/api\/admin\/view-students\/action/, 'Changed student accounts (activate / archive)'],
    [/^POST \/api\/admin\/view-students\/password/, "Changed a pupil's password"],
    [/^POST \/api\/admin\/view-students\/pin/, "Changed a pupil's PIN"],
    [/^POST \/api\/admin\/view-students\/documents/, 'Uploaded a student document'],
    [/^DELETE \/api\/admin\/view-students\/document/, 'Deleted a student document'],
    [/^(POST|DELETE) \/api\/admin\/view-students\/hostel/, 'Changed hostel record'],
    [/^POST \/api\/admin\/view-students\/tags/, 'Changed student tags'],
    [/^(POST|PUT) \/api\/admin\/families/, 'Created / changed a family'],
    [/^PUT \/api\/admin\/account-status\//, 'Switched an account on / off'],
    [/^POST \/api\/admin\/reports\/publish/, 'Published results'],
    [/^POST \/api\/admin\/reports\/unpublish/, 'Unpublished results'],
    [/^POST \/api\/admin\/reports\/email/, 'Emailed a result'],
    [/^POST \/api\/admin\/fees\/invoices\/\d+\/payments/, 'Recorded a fee payment'],
    [/^POST \/api\/admin\/fees\/invoices$/, 'Created fee invoices'],
    [/^POST \/api\/admin\/fees\/payments\/\d+\/status/, 'Changed a payment status'],
    [/^(POST|PUT|DELETE) \/api\/admin\/staff/, 'Created / changed staff'],
    [/^POST \/api\/admin\/security\//, 'Changed security settings'],
    [/^(POST|PUT|DELETE) \/api\/admin\/academic-sessions/, 'Changed academic sessions'],
    [/^(POST|PUT|DELETE) \/api\/admin\/selfreg/, 'Handled a self registration'],
    [/^(POST|PUT|DELETE) \/api\/teacher\/results/, 'Saved / changed result scores'],
    [/^(POST|PUT|DELETE) \/api\/teacher\//, 'Teacher change'],
    [/^POST \/api\/account\/password$/, 'Changed own password'],
  ];
  // Viewing or downloading pupil information is recorded too
  const VIEW_LABELS = [
    [/^GET \/api\/admin\/view-students\/profile$/, 'Viewed a student profile'],
    [/^GET \/api\/admin\/view-students\/document$/, 'Opened a student document'],
    [/^POST \/api\/admin\/view-students\/xlsx$/, 'Exported a student list'],
    [/^GET \/api\/admin\/reports\/\d+\/pdf$/, 'Opened a published result'],
    [/^GET \/api\/admin\/reports\/(preview|class-pdf)$/, 'Opened a result sheet'],
    [/^GET \/api\/admin\/fees\/history$/, 'Viewed fee history'],
    [/^GET \/api\/admin\/security\/backups\//, 'Downloaded a backup'],
    [/^GET \/api\/admin\/security\/audit\.csv$/, 'Exported the activity log'],
  ];
  const SKIP = /^\/api\/(login|logout|session|forgot-password|reset-password|public|selfreg)/;

  function autoAuditLabel(req, url) {
    if (SKIP.test(url.pathname)) return null;
    const key = `${req.method} ${url.pathname}`;
    if (req.method === 'GET') return (VIEW_LABELS.find(([re]) => re.test(key)) || [])[1] || null;
    return (ACTION_LABELS.find(([re]) => re.test(key)) || [])[1] || `${req.method === 'DELETE' ? 'Deleted' : 'Changed'}: ${url.pathname.replace(/^\/api\//, '')}`;
  }

  // Called by server.js for every /api request; records it once the reply is sent
  function trackRequest(req, res, url, actor) {
    // any saved change gets copied off-site a couple of minutes later
    if (req.method !== 'GET' && !SKIP.test(url.pathname)) res.on('finish', () => { if (res.statusCode < 400) offsite.markChanged(); });
    // pupils' everyday activity (CBT answers etc.) isn't logged, only their account changes
    if (!actor || (actor.role === 'student' && !url.pathname.startsWith('/api/account/'))) return;
    const label = autoAuditLabel(req, url);
    if (!label) return;
    const subject = [url.searchParams.get('id'), url.searchParams.get('studentId'), (url.pathname.match(/\/(STU-[\w-]+|TCH-[\w-]+|ADM-[\w-]+)/i) || [])[1]]
      .filter(Boolean).map(v => decodeURIComponent(v).toUpperCase())[0] || '';
    res.on('finish', () => {
      const ok = res.statusCode < 400;
      audit(req, actor, label, [subject && `Record: ${subject}`, ok ? '' : `Refused (${res.statusCode})`].filter(Boolean).join(' · '), ok ? 'ok' : 'failed');
    });
  }

  // ── Passwords ─────────────────────────────────────────────────────────
  const COMMON = new Set(['password', 'password1', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234',
    'admin123', 'admin1234', 'administrator', 'welcome1', 'welcome123', 'letmein1', 'iloveyou', 'school123', 'teacher123', 'teach123', 'teach456', 'student1',
    'student123', 'unique123', 'nigeria1', 'lagos123', 'jesus123', 'god12345', 'changeme', 'default1', 'test1234', 'amara123', 'kwame456', 'p@ssw0rd', 'pass1234',
    '123456', '1234567', '111111', '000000', '123123', '654321', '121212', 'abc123', 'qwerty', 'secret', 'monkey', 'football', 'princess', 'sunshine']);

  function weakPattern(pw) {
    const p = pw.toLowerCase();
    if (/^(.)\1+$/.test(p)) return true;                       // aaaaaa, 111111
    const digits = '01234567890', letters = 'abcdefghijklmnopqrstuvwxyz';
    if (p.length >= 4 && (digits.includes(p) || letters.includes(p) || [...digits].reverse().join('').includes(p))) return true;
    return COMMON.has(p);
  }

  // Returns '' when acceptable, otherwise the reason
  function passwordProblem(pw, user) {
    const value = String(pw || '');
    const staff = user?.role === 'admin' || user?.role === 'teacher';
    const min = staff ? 8 : 6;
    if (value.length < min) return `Use at least ${min} characters`;
    if (value.length > 128) return 'Password is too long';
    if (staff && (!/[a-z]/i.test(value) || !/\d/.test(value))) return 'Use both letters and numbers';
    if (weakPattern(value)) return 'That password is too common or easy to guess — choose another';
    const id = String(user?.id || '').toLowerCase();
    if (id && value.toLowerCase().includes(id)) return "Don't use your ID in your password";
    const first = String(user?.first_name || '').toLowerCase();
    if (first.length >= 3 && value.toLowerCase() === first) return "Don't use your name as your password";
    return '';
  }

  function passwordRulesText(role) {
    return role === 'admin' || role === 'teacher'
      ? 'At least 8 characters, with both letters and numbers. Avoid common passwords, your name and your ID.'
      : 'At least 6 characters. Avoid easy ones like 123456, your name and your ID.';
  }

  // Must this user choose a new password before getting in?
  function mustChangePassword(user, plainPassword) {
    if (user.password_self_set === 1) return false;
    if (user.password_self_set === 0) return true;
    // set before these rules: fine if it already meets them
    const weak = !!passwordProblem(plainPassword, user);
    if (!weak) run('UPDATE users SET password_self_set = 1 WHERE id = ?', user.id);
    return weak;
  }

  // The user chose this password themselves: store it and sign out elsewhere
  function setOwnPassword(userId, newPassword, keepToken = null) {
    run('UPDATE users SET password = ? WHERE id = ?', hashPassword(newPassword), userId);
    run('UPDATE users SET password_self_set = 1 WHERE id = ?', userId);
    if (keepToken) run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', userId, keepToken);
    else run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  // Emails every active admin who has an address (e.g. a failed backup)
  function alertAdmins(subject, text) {
    const config = smtpConfigStatus();
    if (!config.configured) return;
    for (const a of all("SELECT email, first_name, name FROM users WHERE role = 'admin' AND active = 1 AND COALESCE(email, '') <> ''")) {
      const message = [`From: ${config.from}`, `To: ${a.email}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
        `Hello ${a.first_name || a.name},\r\n\r\n${text}\r\n\r\nUnique Children School portal`].join('\r\n');
      smtpSend({ host: config.host, port: config.port, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: config.from, to: a.email, message }).catch(() => {});
    }
  }

  // Records an email change and warns the old address
  function emailChanged(req, user, oldEmail, newEmail) {
    audit(req, user, 'Changed own email address', `${oldEmail || '(none)'} → ${newEmail || '(none)'}`);
    const config = smtpConfigStatus();
    if (!oldEmail || !config.configured) return;
    const message = [
      `From: ${config.from}`, `To: ${oldEmail}`, 'Subject: Your school portal email address was changed', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
      `Hello ${user.first_name || user.name},\r\n\r\nThe email address on your school portal account (${user.id}) was just changed from this address to ${newEmail || 'no address'}.\r\n\r\nChanged from: ${deviceLabel(req)} (IP ${clientIp(req)}) at ${new Date().toUTCString()}.\r\n\r\nIf you did not do this, contact the school administrator immediately.\r\n\r\nUnique Children School`,
    ].join('\r\n');
    smtpSend({ host: config.host, port: config.port, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: config.from, to: oldEmail, message }).catch(() => {});
  }

  // ── Per-computer (IP) limit on wrong guesses ──────────────────────────
  const ipFailures = new Map(); // ip -> { count, first, lockedUntil }
  const IP_MAX = 25, IP_WINDOW = 15 * 60e3, IP_LOCK = 30 * 60e3;
  function ipBlocked(req) {
    const e = ipFailures.get(clientIp(req));
    return !!(e && e.lockedUntil > Date.now());
  }
  function ipFailed(req) {
    const ip = clientIp(req);
    const now = Date.now();
    let e = ipFailures.get(ip);
    if (!e || now - e.first > IP_WINDOW || (e.lockedUntil && e.lockedUntil <= now)) e = { count: 0, first: now, lockedUntil: 0 };
    e.count += 1;
    if (e.count >= IP_MAX) e.lockedUntil = now + IP_LOCK;
    ipFailures.set(ip, e);
    if (ipFailures.size > 5000) for (const [k, v] of ipFailures) if (now - v.first > IP_WINDOW && v.lockedUntil < now) ipFailures.delete(k);
  }

  // ── Sign-in steps (code check, new password) ──────────────────────────
  const pending = new Map(); // token -> { userId, needOtp, needChange, otpHash, otpExpires, tries, sends, created }
  const PENDING_MS = 15 * 60e3;

  function twoStepState(user) {
    if (user.role !== 'admin') return { required: false, reason: 'Only admin accounts use two-step login' };
    if (String(process.env.DISABLE_ADMIN_2FA || '').toLowerCase() === 'true') return { required: false, reason: 'Switched off on the server (DISABLE_ADMIN_2FA)' };
    if (!smtpConfigStatus().configured) return { required: false, reason: "The portal's email sending is not set up yet" };
    if (!user.email) return { required: false, reason: 'This admin account has no email address' };
    return { required: true, reason: '' };
  }

  function trustedDevice(req, userId) {
    const token = parseCookies(req)[DEVICE_COOKIE];
    if (!token) return false;
    return !!one('SELECT token_hash FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires_at > ?', sha(token), userId, nowIso());
  }

  const maskEmail = e => String(e).replace(/^(.)(.*)(.@.*)$/, (_, a, mid, b) => a + '*'.repeat(Math.min(mid.length, 6)) + b);

  async function sendCode(entry, user, req) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    entry.otpHash = sha(`${entry.token}:${code}`);
    entry.otpExpires = Date.now() + 10 * 60e3;
    entry.tries = 0;
    entry.sends = (entry.sends || 0) + 1;
    const config = smtpConfigStatus();
    const message = [
      `From: ${config.from}`, `To: ${user.email}`, `Subject: Your sign-in code: ${code}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
      `Hello ${user.first_name || user.name},\r\n\r\nYour code to finish signing in to the school portal is:\r\n\r\n    ${code}\r\n\r\nIt expires in 10 minutes.\r\n\r\nSign-in attempt from: ${deviceLabel(req)} (IP ${clientIp(req)}) at ${new Date().toUTCString()}.\r\n\r\nIf this was not you, someone knows your password. Sign in and change it straight away, and tell the school administrator.\r\n\r\nUnique Children School`,
    ].join('\r\n');
    await smtpSend({ host: config.host, port: config.port, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: config.from, to: user.email, message });
  }

  function createSession(req, user) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const hours = SESSION_HOURS[user.role] || 24;
    run('INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at, ip, device) VALUES (?, ?, ?, ?, ?, ?, ?)',
      token, user.id, now.toISOString(), new Date(now.getTime() + hours * 3600e3).toISOString(), now.toISOString(), clientIp(req), deviceLabel(req));
    return { token, cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${hours * 3600}${IS_PROD ? '; Secure' : ''}` };
  }

  // After the password is right: decide what else is needed, or sign in.
  // Returns { status, body, headers }.
  async function afterPassword(req, user, plainPassword, publicUser) {
    const needChange = mustChangePassword(user, plainPassword);
    const needOtp = twoStepState(user).required && !trustedDevice(req, user.id);
    if (!needChange && !needOtp) return finishLogin(req, user, publicUser);
    const token = crypto.randomBytes(24).toString('hex');
    const entry = { token, userId: user.id, needOtp, needChange, created: Date.now() };
    pending.set(token, entry);
    for (const [k, v] of pending) if (Date.now() - v.created > PENDING_MS) pending.delete(k);
    return nextStep(req, user, entry);
  }

  async function nextStep(req, user, entry) {
    if (entry.needOtp) {
      if (!entry.otpHash) {
        try { await sendCode(entry, user, req); } catch (err) {
          audit(req, user, 'Sign-in code could not be emailed', err.message, 'failed');
          return { status: 502, body: { error: "The sign-in code couldn't be emailed. Try again shortly, or ask whoever manages the server to check the email settings." } };
        }
        audit(req, user, 'Sign-in code emailed');
      }
      return { status: 200, body: { step: 'code', pending: entry.token, sentTo: maskEmail(user.email) } };
    }
    if (entry.needChange) return { status: 200, body: { step: 'change', pending: entry.token, rules: passwordRulesText(user.role) } };
    pending.delete(entry.token);
    return null;
  }

  function finishLogin(req, user, publicUser, extraCookies = []) {
    const s = createSession(req, user);
    audit(req, user, 'Signed in');
    return { status: 200, body: { user: publicUser(user), portal: `${user.role}-portal.html` }, headers: { 'Set-Cookie': [s.cookie, ...extraCookies] } };
  }

  function pendingEntry(body) {
    const entry = pending.get(String(body.pending || ''));
    if (!entry || Date.now() - entry.created > PENDING_MS) return null;
    return entry;
  }

  // Routes for the extra sign-in steps
  async function handleLoginSteps(req, res, url, publicUser) {
    const p = url.pathname;
    if (req.method !== 'POST' || !['/api/login/code', '/api/login/resend', '/api/login/change'].includes(p)) return false;
    if (ipBlocked(req)) return sendJson(res, 429, { error: 'Too many failed attempts from this network. Try again in 30 minutes.' }), true;
    const body = await readJson(req);
    const entry = pendingEntry(body);
    if (!entry) return sendJson(res, 400, { error: 'This sign-in has expired. Please start again.', restart: true }), true;
    const user = one('SELECT * FROM users WHERE id = ?', entry.userId);
    if (!user || !user.active) { pending.delete(entry.token); return sendJson(res, 400, { error: 'Please start again.', restart: true }), true; }
    const reply = r => (r ? sendJson(res, r.status, r.body, r.headers) : null);

    if (p === '/api/login/resend') {
      if (!entry.needOtp) return sendJson(res, 400, { error: 'No code is needed' }), true;
      if ((entry.sends || 0) >= 4) return sendJson(res, 429, { error: 'Too many codes sent. Please start again in a few minutes.' }), true;
      entry.otpHash = null;
      return reply(await nextStep(req, user, entry)), true;
    }
    if (p === '/api/login/code') {
      if (!entry.needOtp) return sendJson(res, 400, { error: 'No code is needed' }), true;
      const code = String(body.code || '').replace(/\D/g, '');
      if (!entry.otpExpires || Date.now() > entry.otpExpires) return sendJson(res, 400, { error: 'That code has expired. Press "Send a new code".' }), true;
      if (sha(`${entry.token}:${code}`) !== entry.otpHash) {
        entry.tries = (entry.tries || 0) + 1;
        ipFailed(req);
        audit(req, user, 'Wrong sign-in code entered', '', 'failed');
        if (entry.tries >= 5) { pending.delete(entry.token); return sendJson(res, 400, { error: 'Too many wrong codes. Please start again.', restart: true }), true; }
        return sendJson(res, 400, { error: `That code is not right. ${5 - entry.tries} tries left.` }), true;
      }
      entry.needOtp = false;
      const cookies = [];
      if (body.remember) {
        const devToken = crypto.randomBytes(32).toString('hex');
        run('INSERT INTO trusted_devices (token_hash, user_id, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
          sha(devToken), user.id, deviceLabel(req), nowIso(), new Date(Date.now() + DEVICE_DAYS * 864e5).toISOString());
        cookies.push(`${DEVICE_COOKIE}=${devToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_DAYS * 86400}${IS_PROD ? '; Secure' : ''}`);
        audit(req, user, 'Remembered this device for 30 days');
      }
      const next = await nextStep(req, user, entry);
      if (next) { if (cookies.length) next.headers = { 'Set-Cookie': cookies }; return reply(next), true; }
      return reply(finishLogin(req, user, publicUser, cookies)), true;
    }
    // new password
    if (!entry.needChange || entry.needOtp) return sendJson(res, 400, { error: 'Please start again.', restart: true }), true;
    const newPassword = String(body.newPassword || '');
    const problem = passwordProblem(newPassword, user);
    if (problem) return sendJson(res, 400, { error: problem }), true;
    if (verifyPassword(newPassword, user.password)) return sendJson(res, 400, { error: 'Choose a different password from the one you have now' }), true;
    setOwnPassword(user.id, newPassword);
    audit(req, user, 'Chose a new password at sign-in');
    pending.delete(entry.token);
    return reply(finishLogin(req, user, publicUser)), true;
  }

  // ── Sessions ──────────────────────────────────────────────────────────
  // Looks up the signed-in user, enforcing the idle limit
  function sessionUser(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    const row = one(`SELECT users.*, sessions.last_seen_at AS _lastSeen, sessions.token AS _token FROM sessions JOIN users ON users.id = sessions.user_id
                     WHERE sessions.token = ? AND sessions.expires_at > ?`, token, nowIso());
    if (!row) return null;
    if (!row.active) { run('DELETE FROM sessions WHERE token = ?', token); return null; }
    const idleMs = (IDLE_MINUTES[row.role] || 60) * 60e3;
    const last = row._lastSeen ? Date.parse(row._lastSeen) : Date.now();
    if (Date.now() - last > idleMs) {
      run('DELETE FROM sessions WHERE token = ?', token);
      audit(req, row, 'Signed out automatically (no activity)');
      return null;
    }
    if (Date.now() - last > 60e3) run('UPDATE sessions SET last_seen_at = ? WHERE token = ?', nowIso(), token);
    return row;
  }

  // ── Browser security headers ──────────────────────────────────────────
  const CSP = [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; ');
  function applyHeaders(req, res, url) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) res.setHeader('Cache-Control', 'no-store');
  }

  // ── Backups ───────────────────────────────────────────────────────────
  function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR).filter(f => /^school-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?\.sqlite$/.test(f)).sort().reverse()
      .map(name => { const st = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: st.size, at: st.mtime.toISOString() }; });
  }

  function runBackup(reason = 'automatic') {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const name = `school-${nowIso().slice(0, 19).replace(/:/g, '-')}Z.sqlite`;
    const file = path.join(BACKUP_DIR, name);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    // check the copy opens and has the core tables
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      const ok = copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'students')").get().n === 2;
      if (!ok) throw new Error('Backup copy is incomplete');
    } finally { copy.close(); }
    listBackups().slice(BACKUPS_KEPT).forEach(b => fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true }));
    audit(null, null, 'Backup made', `${name} (${reason})`);
    return name;
  }

  function backupIfDue() {
    try {
      const last = listBackups()[0];
      if (!last || Date.now() - Date.parse(last.at) > 23 * 3600e3) runBackup();
    } catch (err) { console.error('Backup failed:', err.message); audit(null, null, 'Backup failed', err.message, 'failed'); }
  }

  function startBackups() {
    setTimeout(backupIfDue, 30e3).unref();
    setInterval(backupIfDue, 3600e3).unref();
    offsite.start();
  }

  function filesUnder(dir, prefix) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(full, `${prefix}${entry.name}/`));
      else out.push([`${prefix}${entry.name}`, fs.readFileSync(full)]);
    }
    return out;
  }

  // ── Admin → Security page ─────────────────────────────────────────────
  async function handleAdmin(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/admin/security')) return false;
    const admin = requireUser(req, res, 'admin');
    if (!admin) return true;
    const m = req.method;
    const token = parseCookies(req)[COOKIE_NAME];

    if (m === 'GET' && p === '/api/admin/security/overview') {
      const users = all('SELECT id, role, name, email, active, password_self_set FROM users');
      const needChange = role => users.filter(u => u.role === role && u.active && u.password_self_set !== 1).length;
      const admins = users.filter(u => u.role === 'admin').map(u => ({ id: u.id, name: u.name, email: u.email || '', active: !!u.active, twoStep: twoStepState(u) }));
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      return sendJson(res, 200, {
        email: smtpConfigStatus().configured,
        admins,
        me: admin.id,
        passwords: { admin: needChange('admin'), teacher: needChange('teacher'), student: needChange('student') },
        failedSignIns7d: one("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'failed' AND action LIKE '%sign%' AND at >= ?", since).n,
        backups: listBackups(),
        offsite: offsite.status(),
        idleMinutes: IDLE_MINUTES,
        devices: all('SELECT label, created_at AS createdAt, expires_at AS expiresAt FROM trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC', admin.id, nowIso()),
      }), true;
    }
    if (m === 'GET' && p === '/api/admin/security/sessions') {
      const rows = all(`SELECT s.token, s.user_id AS userId, u.name, u.role, s.created_at AS createdAt, s.last_seen_at AS lastSeen, s.ip, s.device
                        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC LIMIT 500`, nowIso())
        .filter(s => !s.lastSeen || Date.now() - Date.parse(s.lastSeen) <= (IDLE_MINUTES[s.role] || 60) * 60e3)
        .map(({ token: t, ...s }) => ({ ...s, ref: sha(t).slice(0, 16), current: t === token }));
      return sendJson(res, 200, { sessions: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/security/sessions/end') {
      const body = await readJson(req);
      let ended = 0;
      if (body.all) ended = run('DELETE FROM sessions WHERE token <> ?', token).changes;
      else if (body.userId) ended = run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', cleanText(body.userId).toUpperCase(), token).changes;
      else if (body.ref) {
        for (const s of all('SELECT token FROM sessions')) if (sha(s.token).slice(0, 16) === body.ref && s.token !== token) ended += run('DELETE FROM sessions WHERE token = ?', s.token).changes;
      }
      return sendJson(res, 200, { ok: true, ended }), true;
    }
    if (m === 'POST' && p === '/api/admin/security/devices/forget') {
      run('DELETE FROM trusted_devices WHERE user_id = ?', admin.id);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${DEVICE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PROD ? '; Secure' : ''}` }), true;
    }
    if (m === 'POST' && p === '/api/admin/security/force-change') {
      const body = await readJson(req);
      const role = ['teacher', 'student', 'admin'].includes(body.role) ? body.role : null;
      if (!role) return sendJson(res, 400, { error: 'Choose who must change their password' }), true;
      const n = run('UPDATE users SET password_self_set = 0 WHERE role = ? AND id <> ?', role, admin.id).changes;
      return sendJson(res, 200, { ok: true, updated: n }), true;
    }
    if ((m === 'GET' && p === '/api/admin/security/audit') || (m === 'GET' && p === '/api/admin/security/audit.csv')) {
      const q = `%${cleanText(url.searchParams.get('q')).toLowerCase()}%`;
      const from = cleanText(url.searchParams.get('from'));
      const to = cleanText(url.searchParams.get('to'));
      const outcome = cleanText(url.searchParams.get('outcome'));
      let sql = `SELECT id, at, user_id AS userId, user_name AS userName, role, action, detail, ip, device, outcome FROM audit_log
                 WHERE (LOWER(COALESCE(user_name, '') || ' ' || COALESCE(user_id, '') || ' ' || action || ' ' || COALESCE(detail, '') || ' ' || COALESCE(ip, '')) LIKE ?)`;
      const args = [q];
      if (from) { sql += ' AND at >= ?'; args.push(from); }
      if (to) { sql += ' AND at < ?'; args.push(new Date(Date.parse(to) + 864e5).toISOString()); }
      if (outcome === 'failed') sql += " AND outcome = 'failed'";
      if (p.endsWith('.csv')) {
        const rows = all(`${sql} ORDER BY at DESC LIMIT 20000`, ...args);
        const csv = [['When (UTC)', 'User ID', 'Name', 'Role', 'Action', 'Detail', 'IP', 'Device', 'Outcome'],
          ...rows.map(r => [r.at, r.userId, r.userName, r.role, r.action, r.detail, r.ip, r.device, r.outcome])]
          .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="activity-log.csv"' });
        res.end('﻿' + csv);
        return true;
      }
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const total = one(`SELECT COUNT(*) AS n FROM (${sql})`, ...args).n;
      const rows = all(`${sql} ORDER BY at DESC LIMIT 50 OFFSET ?`, ...args, (page - 1) * 50);
      return sendJson(res, 200, { rows, total, page, perPage: 50 }), true;
    }
    if (m === 'POST' && p === '/api/admin/security/offsite/test') {
      try { await offsite.testConnection(); return sendJson(res, 200, { ok: true }), true; } catch (err) { return sendJson(res, 400, { error: `Connection test failed: ${err.message}` }), true; }
    }
    if (m === 'POST' && p === '/api/admin/security/offsite/run') {
      const r = await offsite.backupNow(`started by ${admin.name}`);
      if (r?.skipped) return sendJson(res, 400, { error: 'Off-site backup is not set up yet' }), true;
      return r?.ok ? sendJson(res, 200, { ok: true, ...r, status: offsite.status() }) : sendJson(res, 500, { error: `Off-site backup failed: ${r?.error}` }), true;
    }
    if (m === 'POST' && p === '/api/admin/security/backups') {
      try { return sendJson(res, 200, { ok: true, name: runBackup(`made by ${admin.name}`), backups: listBackups() }), true; } catch (err) { return sendJson(res, 500, { error: `Backup failed: ${err.message}` }), true; }
    }
    if (m === 'GET' && p === '/api/admin/security/backups/full.zip') {
      const name = listBackups()[0]?.name || runBackup(`full download by ${admin.name}`);
      const files = [[`database/${name}`, fs.readFileSync(path.join(BACKUP_DIR, name))], ...filesUnder(UPLOAD_DIR, 'uploads/'), ...filesUnder(REPORT_DIR, 'published_reports/')];
      const buf = zipFiles(files);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="portal-full-backup-${nowIso().slice(0, 10)}.zip"`, 'Content-Length': buf.length });
      res.end(buf);
      return true;
    }
    const dl = p.match(/^\/api\/admin\/security\/backups\/(school-[\w-]+Z?\.sqlite)$/);
    if (m === 'GET' && dl) {
      const file = path.join(BACKUP_DIR, dl[1]);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Backup not found' }), true;
      const data = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${dl[1]}"`, 'Content-Length': data.length });
      res.end(data);
      return true;
    }
    return false;
  }

  return {
    createSchema, audit, trackRequest, clientIp, deviceLabel, passwordProblem, passwordRulesText, setOwnPassword, emailChanged,
    ipBlocked, ipFailed, afterPassword, handleLoginSteps, sessionUser, applyHeaders, startBackups, handleAdmin,
  };
};
