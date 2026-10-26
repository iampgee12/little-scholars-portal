// Connected exam servers (the UCS Exam Server app linked to this portal with keys).
//
// Online portal
//   /api/admin/exam-servers…  admins see connections; super admins create
//                             (API Number + Auth Key + Secret Key, the secret
//                             shown once and stored only as a SHA-256 hash) and revoke.
//   /api/exam-sync/…          the channel an exam server calls with its keys:
//                             hello, data (by group), photo files, submissions, update info.
// Exam computer (EXAM_MODE)
//   /api/exam/connect, /refresh, /push, /archive, /sync-report — link to the
//   portal, pull data down (never touching results not yet pushed), push
//   finished exams up, and keep an archive of everything written here.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const GROUPS = ['students', 'staff', 'cbt', 'images'];
const DATASET_LABELS = {
  school: 'School Branding', academic_terms: 'Academic Years & Terms', classes: 'Classes', class_arms: 'Class Arms & Sections',
  subjects: 'Subjects', students: 'Students', student_users: 'Student Accounts', staff_users: 'Staff Accounts',
  cbt_instruction_sets: 'CBT Instructions', cbt_schedules: 'CBT Exam Schedules', cbt_schedule_subjects: 'CBT Papers',
  cbt_questions: 'CBT Questions', teacher_assignments: 'Teacher Subjects', photos: 'Photos',
};
const PUSH_BATCH = 100;

module.exports = function createExamSync(ctx) {
  const {
    db, one, all, run, ensureColumn, cleanText, readJson, sendJson, requireUser, valueFromMeta, setMeta,
    adminLevel, schoolInfoFromMeta, ROOT, DATA_DIR, UPLOAD_DIR, EXAM_MODE, cbtOffline,
  } = ctx;
  const nowIso = () => new Date().toISOString();
  const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS exam_server_keys (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        api_number TEXT NOT NULL UNIQUE,
        auth_key TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        last_ip TEXT,
        last_sync_at TEXT,
        last_push_at TEXT,
        revoked_at TEXT,
        revoked_by TEXT
      );
    `);
    // exam computer: which finished attempts have reached the portal
    db.exec(`
      CREATE TABLE IF NOT EXISTS exam_server_machines (
        id INTEGER PRIMARY KEY,
        key_id INTEGER NOT NULL,
        machine TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        last_sync TEXT,
        last_push TEXT,
        last_ip TEXT,
        UNIQUE(key_id, machine)
      );
    `);
    ensureColumn('cbt_attempts', 'pushed_at', 'TEXT');
    ensureColumn('cbt_attempts', 'push_note', 'TEXT');
  }

  // ══ ONLINE PORTAL ══
  function keyRow(r, extra = {}) {
    return {
      id: r.id, name: r.name, apiNumber: r.api_number, authKeyHint: `${r.auth_key.slice(0, 6)}…`,
      createdAt: r.created_at, createdBy: one('SELECT name FROM users WHERE id = ?', r.created_by)?.name || r.created_by,
      lastUsedAt: r.last_used_at, lastSyncAt: r.last_sync_at, lastPushAt: r.last_push_at, lastIp: r.last_ip,
      revokedAt: r.revoked_at, ...extra,
    };
  }
  function newApiNumber() {
    for (;;) {
      const n = `UCS${crypto.randomInt(10_000_000, 99_999_999)}`;
      if (!one('SELECT id FROM exam_server_keys WHERE api_number = ?', n)) return n;
    }
  }

  // Failed key checks are slowed per address: 10 misses in 15 minutes locks it out for a while
  const misses = new Map();
  function blocked(ip) {
    const m = misses.get(ip);
    if (!m) return false;
    if (Date.now() - m.first > 15 * 60e3) { misses.delete(ip); return false; }
    return m.count >= 10;
  }
  function miss(ip) {
    const m = misses.get(ip) || { count: 0, first: Date.now() };
    m.count++;
    misses.set(ip, m);
  }
  function clientIp(req) {
    return String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  }
  function authenticate(req) {
    const apiNumber = cleanText(req.headers['x-ucs-api-number']).toUpperCase();
    const authKey = cleanText(req.headers['x-ucs-auth-key']);
    const secret = String(req.headers['x-ucs-secret'] || '');
    if (!apiNumber || !authKey || !secret) return null;
    const row = one('SELECT * FROM exam_server_keys WHERE api_number = ? AND auth_key = ?', apiNumber, authKey);
    if (!row) return null;
    const a = Buffer.from(sha(secret), 'hex');
    const b = Buffer.from(row.secret_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return row;
  }

  // The data a connected exam server takes, by group
  function syncData(groups) {
    const want = new Set(groups.includes('all') ? GROUPS : groups);
    const tables = {};
    const scrub = u => ({ ...u, reset_token: null, reset_token_expires: null });
    if (want.has('students') || want.has('cbt') || want.has('staff')) {
      tables.classes = all('SELECT * FROM classes');
      tables.class_arms = all('SELECT * FROM class_arms');
    }
    if (want.has('students')) {
      tables.students = all("SELECT * FROM students WHERE COALESCE(archived, 0) = 0 AND (status IS NULL OR status = 'active')");
      const ids = new Set(tables.students.map(s => s.id));
      tables.student_users = all("SELECT * FROM users WHERE role = 'student'").filter(u => ids.has(u.id)).map(scrub);
    }
    if (want.has('staff')) {
      // admins sign in to the exam server; other staff are listed only, so they get no usable password
      tables.staff_users = all("SELECT * FROM users WHERE role IN ('admin', 'teacher', 'staff') AND COALESCE(archived, 0) = 0 AND active = 1")
        .map(u => scrub(u.role === 'admin' && u.staff_type !== 'accountant' ? u : { ...u, password: '!' }));
      // for the staff lists: subjects in charge and form classes
      tables.subjects = all('SELECT * FROM subjects');
      tables.teacher_assignments = all('SELECT * FROM teacher_assignments');
    }
    if (want.has('cbt')) {
      tables.academic_terms = all('SELECT * FROM academic_terms');
      tables.subjects = all('SELECT * FROM subjects');
      tables.cbt_instruction_sets = all('SELECT * FROM cbt_instruction_sets');
      tables.cbt_schedules = all('SELECT * FROM cbt_schedules WHERE archived = 0');
      const scheduleIds = new Set(tables.cbt_schedules.map(s => s.id));
      tables.cbt_schedule_subjects = all("SELECT * FROM cbt_schedule_subjects WHERE mode = 'Computer Based'").filter(p => scheduleIds.has(p.schedule_id));
      const pairs = new Set(tables.cbt_schedule_subjects.map(p => `${p.class_code}|${p.subject_id}`));
      tables.cbt_questions = all("SELECT * FROM cbt_questions WHERE question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0")
        .filter(q => pairs.has(`${q.class_code}|${q.subject_id}`));
    }
    const photos = [];
    if (want.has('images')) {
      const seen = new Set();
      for (const r of [...all('SELECT photo_path FROM students WHERE photo_path IS NOT NULL'), ...all("SELECT photo_path FROM users WHERE photo_path IS NOT NULL AND role IN ('admin', 'teacher', 'staff', 'student')")]) {
        const name = path.basename(String(r.photo_path));
        if (seen.has(name) || !/^[\w.-]+\.(png|jpe?g|webp)$/i.test(name)) continue;
        try { const st = fs.statSync(path.join(UPLOAD_DIR, name)); seen.add(name); photos.push({ name, size: st.size }); } catch { /* missing on disk */ }
      }
    }
    const school = { ...schoolInfoFromMeta(), ownerAdminId: valueFromMeta('owner_admin_id', ''), session: one('SELECT session_label s, term_label t FROM academic_terms WHERE is_active = 1') || null };
    const counts = { school: 1, ...Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) };
    if (want.has('images')) counts.photos = photos.length;
    return { groups: [...want], school, tables, photos, counts };
  }
  const photoAllowed = name => /^[\w.-]+\.(png|jpe?g|webp)$/i.test(name)
    && !!(one('SELECT id FROM students WHERE photo_path = ?', `uploads/${name}`) || one('SELECT id FROM users WHERE photo_path = ?', `uploads/${name}`));

  function sendGzipJson(req, res, body) {
    const json = Buffer.from(JSON.stringify(body), 'utf8');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      const gz = zlib.gzipSync(json);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Cache-Control': 'no-store' });
      return res.end(gz);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': json.length, 'Cache-Control': 'no-store' });
    return res.end(json);
  }
  const appInfo = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'exam-app.json'), 'utf8')); } catch { return null; } };
  // Installers kept for going back a version: the newest one of each app frame (shell),
  // for the current frame and the one before (about 132 MB each), in the data folder so
  // they outlive deploys. An exam computer going back from a full update fetches the one
  // for the frame it had before.
  const ARCHIVE = path.join(DATA_DIR || ROOT, 'exam-app-archive');
  function archiveInstaller() {
    const info = appInfo();
    const setup = path.join(ROOT, 'dist', 'UCS Exam Server Setup.exe');
    if (EXAM_MODE || !info?.shell || !fs.existsSync(setup)) return;
    fs.mkdirSync(ARCHIVE, { recursive: true });
    const meta = path.join(ARCHIVE, `${info.shell}.json`);
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* none yet */ }
    if (kept?.build === info.build) return;
    const tmp = path.join(ARCHIVE, `${info.shell}.exe.part`);
    fs.copyFile(setup, tmp, err => {
      if (err) return console.error('[exam-app] could not keep the installer:', err.message);
      fs.renameSync(tmp, path.join(ARCHIVE, `${info.shell}.exe`));
      fs.writeFileSync(meta, JSON.stringify({ ...info, keptAt: nowIso() }));
      // only the current frame and the one before
      const frames = fs.readdirSync(ARCHIVE).filter(f => f.endsWith('.json'))
        .map(f => ({ shell: f.slice(0, -5), at: fs.statSync(path.join(ARCHIVE, f)).mtimeMs })).sort((a, b) => b.at - a.at);
      for (const old of frames.slice(2)) for (const ext of ['.json', '.exe']) fs.rmSync(path.join(ARCHIVE, `${old.shell}${ext}`), { force: true });
    });
  }
  const keptInstaller = shell => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(ARCHIVE, `${shell}.json`), 'utf8'));
      const file = path.join(ARCHIVE, `${shell}.exe`);
      return { ...meta, file, size: fs.statSync(file).size };
    } catch { return null; }
  };
  setTimeout(archiveInstaller, 5000); // after start-up, in the background

  // [path, sha256, size, gzipped size] for each portal file in the app (see exam-app/build.js)
  let fileListCache = null;
  const appFileList = () => {
    try {
      const file = path.join(ROOT, 'dist', 'exam-app-files.json');
      const stat = fs.statSync(file);
      if (!appInfo()?.shell) return null;
      if (!fileListCache || fileListCache.mtime !== stat.mtimeMs) fileListCache = { mtime: stat.mtimeMs, list: JSON.parse(fs.readFileSync(file, 'utf8')) };
      return fileListCache.list;
    } catch { return null; }
  };

  async function handlePortal(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    // ── admin screens: the school's one set of API keys ──
    // Generated once; the secret is shown that one time and only its hash is
    // kept. Every exam computer uses the same set. Reset Keys (super admins,
    // typed confirmation) cancels the set and makes a new one, for lost or
    // leaked keys.
    if (p.startsWith('/api/admin/exam-servers')) {
      const admin = requireUser(req, res, 'admin');
      if (!admin) return true;
      const canManage = ['owner', 'super'].includes(adminLevel(admin));
      const active = () => one('SELECT * FROM exam_server_keys WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1');
      const issue = () => {
        const apiNumber = newApiNumber();
        const authKey = crypto.randomBytes(16).toString('hex');
        const secret = crypto.randomBytes(24).toString('base64url');
        const id = Number(run('INSERT INTO exam_server_keys (name, api_number, auth_key, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          'School API keys', apiNumber, authKey, sha(secret), admin.id, nowIso()).lastInsertRowid);
        return { id, keys: { apiNumber, authKey, secret } };
      };
      if (m === 'GET' && p === '/api/admin/exam-servers') {
        const key = active();
        const machines = key ? all('SELECT * FROM exam_server_machines WHERE key_id = ? ORDER BY last_seen DESC', key.id).map(r => ({
          machine: r.machine, firstSeen: r.first_seen, lastSeen: r.last_seen, lastSyncAt: r.last_sync, lastPushAt: r.last_push, lastIp: r.last_ip,
        })) : [];
        return sendJson(res, 200, { canManage, key: key ? keyRow(key) : null, machines }), true;
      }
      if (!canManage) return sendJson(res, 403, { error: 'Only a super admin can generate or reset the school\'s API keys' }), true;
      if (m === 'POST' && p === '/api/admin/exam-servers') {
        if (active()) return sendJson(res, 409, { error: 'The school\'s API keys have already been generated. They are shown only once; if they are lost, a super admin can reset them.' }), true;
        const { id, keys } = issue();
        return sendJson(res, 201, { ok: true, key: keyRow(one('SELECT * FROM exam_server_keys WHERE id = ?', id)), keys }), true;
      }
      if (m === 'POST' && p === '/api/admin/exam-servers/reset') {
        if (cleanText((await readJson(req)).confirm).toUpperCase() !== 'RESET') return sendJson(res, 400, { error: 'Type RESET to confirm' }), true;
        run('UPDATE exam_server_keys SET revoked_at = ?, revoked_by = ? WHERE revoked_at IS NULL', nowIso(), admin.id);
        const { id, keys } = issue();
        return sendJson(res, 201, { ok: true, key: keyRow(one('SELECT * FROM exam_server_keys WHERE id = ?', id)), keys }), true;
      }
      return false;
    }

    // ── the channel exam servers call ──
    if (!p.startsWith('/api/exam-sync/')) return false;
    const ip = clientIp(req);
    if (blocked(ip)) return sendJson(res, 429, { error: 'Too many wrong keys from this address. Wait 15 minutes and try again.' }), true;
    const key = authenticate(req);
    if (!key) { miss(ip); return sendJson(res, 401, { error: 'These keys were not accepted. Check the API Number, Authentication Key and Secret Key.' }), true; }
    if (key.revoked_at) return sendJson(res, 403, { error: 'These API keys were reset on the portal. Ask a super admin for the new keys.' }), true;
    run('UPDATE exam_server_keys SET last_used_at = ?, last_ip = ? WHERE id = ?', nowIso(), ip, key.id);
    // which exam computer is calling (they all share the school's keys)
    const machine = cleanText(req.headers['x-ucs-machine']).slice(0, 60) || 'Unnamed computer';
    run(`INSERT INTO exam_server_machines (key_id, machine, first_seen, last_seen, last_ip) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_id, machine) DO UPDATE SET last_seen = excluded.last_seen, last_ip = excluded.last_ip`, key.id, machine, nowIso(), nowIso(), ip);
    const touch = col => run(`UPDATE exam_server_machines SET ${col} = ? WHERE key_id = ? AND machine = ?`, nowIso(), key.id, machine);

    if (m === 'GET' && p === '/api/exam-sync/hello') {
      return sendJson(res, 200, { ok: true, connection: { name: key.name, apiNumber: key.api_number }, school: syncData([]).school, app: appInfo() }), true;
    }
    if (m === 'GET' && p === '/api/exam-sync/data') {
      const groups = cleanText(url.searchParams.get('groups') || 'all').split(',').map(g => g.trim()).filter(g => g === 'all' || GROUPS.includes(g));
      if (!groups.length) return sendJson(res, 400, { error: 'Choose what to refresh' }), true;
      run('UPDATE exam_server_keys SET last_sync_at = ? WHERE id = ?', nowIso(), key.id);
      touch('last_sync');
      return sendGzipJson(req, res, syncData(groups)), true;
    }
    if (m === 'GET' && p === '/api/exam-sync/photo') {
      const name = path.basename(cleanText(url.searchParams.get('name')));
      if (!photoAllowed(name)) return sendJson(res, 404, { error: 'Photo not found' }), true;
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Photo not found' }), true;
      res.writeHead(200, { 'Content-Type': /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    if (m === 'POST' && p === '/api/exam-sync/submissions') {
      const body = await readJson(req);
      const attempts = Array.isArray(body.attempts) ? body.attempts.slice(0, PUSH_BATCH) : [];
      if (!attempts.length) return sendJson(res, 400, { error: 'No submissions sent' }), true;
      // marked under the super admin who made the keys
      const report = cbtOffline.importAttempts(attempts, `sync:${key.id}`, key.created_by);
      run('UPDATE exam_server_keys SET last_push_at = ? WHERE id = ?', nowIso(), key.id);
      touch('last_push');
      return sendJson(res, 200, { ok: true, report }), true;
    }
    if (m === 'GET' && p === '/api/exam-sync/update') {
      const info = appInfo();
      const size = name => { try { return fs.statSync(path.join(ROOT, 'dist', name)).size; } catch { return 0; } };
      // the installers kept for going back: { shell: { version, build, size } }
      const kept = {};
      try {
        for (const f of fs.readdirSync(ARCHIVE).filter(n => n.endsWith('.json'))) {
          const k = keptInstaller(f.slice(0, -5));
          if (k) kept[k.shell] = { version: k.version, build: k.build, size: k.size };
        }
      } catch { /* none kept yet */ }
      return sendJson(res, 200, { app: info, setupSize: size('UCS Exam Server Setup.exe'), files: !!appFileList(), kept }), true;
    }
    // Updates that download only what changed: the fingerprint and size of every portal
    // file in the app, then just the files an exam computer asks for, each checked
    // against its fingerprint before it is sent
    if (m === 'GET' && p === '/api/exam-sync/update-files') {
      const list = appFileList();
      if (!list) return sendJson(res, 404, { error: 'No file list for this version' }), true;
      return sendGzipJson(req, res, { build: appInfo()?.build, shell: appInfo()?.shell, files: list }), true;
    }
    if (m === 'POST' && p === '/api/exam-sync/update-files') {
      const list = appFileList();
      if (!list) return sendJson(res, 404, { error: 'No file list for this version' }), true;
      const body = await readJson(req);
      const wanted = new Set(Array.isArray(body.paths) ? body.paths : []);
      const entries = list.filter(([rel]) => wanted.has(rel));
      const parts = [];
      for (const [rel, sha] of entries) {
        let data;
        try { data = fs.readFileSync(path.join(ROOT, ...rel.split('/'))); } catch { data = null; }
        if (!data || crypto.createHash('sha256').update(data).digest('hex') !== sha) {
          return sendJson(res, 409, { error: 'The portal is updating itself. Try again in a few minutes, or use the full download.' }), true;
        }
        parts.push([rel, data]);
      }
      // same layout as the app's own bundle: 4-byte header length, a JSON header, the files
      let offset = 0;
      const header = Buffer.from(JSON.stringify({ files: parts.map(([rel, data]) => { const e = [rel, offset, data.length]; offset += data.length; return e; }) }), 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(header.length, 0);
      const packed = zlib.gzipSync(Buffer.concat([len, header, ...parts.map(([, data]) => data)]));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': packed.length, 'Cache-Control': 'no-store' });
      res.end(packed);
      return true;
    }
    if (m === 'GET' && p === '/api/exam-sync/setup.exe') {
      // ?shell=… : the kept installer for an earlier app frame (going back a version)
      const wantShell = cleanText(url.searchParams.get('shell'));
      const kept = wantShell && wantShell !== appInfo()?.shell ? keptInstaller(wantShell) : null;
      if (wantShell && wantShell !== appInfo()?.shell && !kept) return sendJson(res, 404, { error: 'The portal no longer has that version of the app, so this exam computer can\'t go back to it.' }), true;
      const file = kept ? kept.file : path.join(ROOT, 'dist', 'UCS Exam Server Setup.exe');
      let stat;
      try { stat = fs.statSync(file); } catch { return sendJson(res, 404, { error: 'No installer on the portal yet' }), true; }
      res.writeHead(200, { 'Content-Type': 'application/vnd.microsoft.portable-executable', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    return sendJson(res, 404, { error: 'Not found' }), true;
  }

  // ══ EXAM COMPUTER ══
  const DEFAULT_PORTAL = cleanText(process.env.UCS_PORTAL_URL) || 'https://portal.uniquechildrenschool.com';
  const connection = () => ({
    portal: valueFromMeta('sync_portal', '') || DEFAULT_PORTAL,
    apiNumber: valueFromMeta('sync_api_number', ''),
    authKey: valueFromMeta('sync_auth_key', ''),
    secret: valueFromMeta('sync_secret', ''),
  });
  async function callPortal(pathname, { method = 'GET', body, conn = connection(), raw = false, timeout = 120_000 } = {}) {
    if (!conn.apiNumber) throw new Error('This exam server is not connected to the school portal yet');
    let res;
    try {
      res = await fetch(new URL(pathname, conn.portal), {
        method,
        headers: { 'X-UCS-Api-Number': conn.apiNumber, 'X-UCS-Auth-Key': conn.authKey, 'X-UCS-Secret': conn.secret, 'X-UCS-Machine': require('node:os').hostname(), 'Accept-Encoding': 'gzip', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new Error(`Couldn't reach the school portal (${conn.portal}). Check this computer's internet connection. (${err.cause?.code || err.message})`);
    }
    if (raw) {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The portal said ${res.status}`);
      return res;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The portal said ${res.status}`);
    return data;
  }
  const report = () => { try { return JSON.parse(valueFromMeta('sync_last_report', '') || 'null'); } catch { return null; } };

  // Replaces the refreshed tables. Results written here (cbt_attempts,
  // answers, scores) are never deleted, pushed or not.
  const APPLY_ORDER = ['academic_terms', 'classes', 'class_arms', 'subjects', 'staff_users', 'student_users', 'students', 'teacher_assignments', 'cbt_instruction_sets', 'cbt_schedules', 'cbt_schedule_subjects', 'cbt_questions'];
  const KEEP = new Set(['cbt_attempts', 'cbt_attempt_answers', 'cbt_scores']);
  function applyData(data) {
    const { tables } = data;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        // papers are opened and closed on exam day here, not online: keep this
        // computer's state for papers it already had, and start new ones unopened
        const localStatus = tables.cbt_schedule_subjects
          ? new Map(all('SELECT id, status FROM cbt_schedule_subjects').map(r => [r.id, r.status]))
          : null;
        for (const name of APPLY_ORDER) {
          if (!tables[name]) continue;
          if (name === 'staff_users') run("DELETE FROM users WHERE role IN ('admin', 'teacher', 'staff')");
          // trial accounts (testers) are made on this computer: keep them, and don't let
          // a pupil copied from the portal take one of their usernames
          else if (name === 'student_users') run("DELETE FROM users WHERE role = 'student' AND COALESCE(trial, 0) = 0");
          else if (cbtOffline.tableExists(name)) run(`DELETE FROM "${name}"`);
          const taken = name === 'student_users' ? new Set(all('SELECT LOWER(username) AS u FROM users WHERE trial = 1 AND username IS NOT NULL').map(r => r.u)) : null;
          const rows = taken ? tables[name].map(u => (u.username && taken.has(String(u.username).toLowerCase()) ? { ...u, username: null } : u)) : tables[name];
          cbtOffline.insertRows(name.endsWith('_users') ? 'users' : name, rows);
        }
        if (localStatus) {
          for (const p of tables.cbt_schedule_subjects) {
            run('UPDATE cbt_schedule_subjects SET status = ? WHERE id = ?', localStatus.get(p.id) || 'upcoming', p.id);
          }
        }
        run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)');
        // links to things not synced (e.g. who wrote a question) are cleared; results are left alone
        for (const v of all('PRAGMA foreign_key_check')) {
          if (KEEP.has(v.table)) continue;
          const fk = all(`PRAGMA foreign_key_list("${v.table}")`).find(f => f.id === v.fkid);
          try { run(`UPDATE "${v.table}" SET "${fk.from}" = NULL WHERE rowid = ?`, v.rowid); } catch { run(`DELETE FROM "${v.table}" WHERE rowid = ?`, v.rowid); }
        }
        for (const [k, val] of Object.entries({ owner_admin_id: data.school?.ownerAdminId, school_name: data.school?.name, school_address: data.school?.address, school_phone: data.school?.phone, school_email: data.school?.email, school_website: data.school?.website })) {
          if (val) setMeta(k, val);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  async function refresh(groups, actor) {
    const want = groups.includes('all') ? ['all'] : groups.filter(g => GROUPS.includes(g));
    if (!want.length) throw new Error('Choose what to refresh');
    const touchesCbt = want.includes('all') || want.includes('cbt');
    if (touchesCbt) {
      const live = one("SELECT COUNT(*) n FROM cbt_schedule_subjects WHERE status = 'live'").n;
      if (live) throw new Error(`${live} paper${live === 1 ? ' is' : 's are'} open right now. Close ${live === 1 ? 'it' : 'them'} in the Exam Console before refreshing CBT data.`);
    }
    const started = nowIso();
    const data = await callPortal(`/api/exam-sync/data?groups=${want.join(',')}`);
    applyData(data);
    const rows = Object.entries(data.counts).map(([k, n]) => ({ key: k, label: DATASET_LABELS[k] || k, rows: n, status: 'ok' }));
    if (data.photos?.length) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      let got = 0;
      let failed = 0;
      for (const ph of data.photos) {
        const file = path.join(UPLOAD_DIR, ph.name);
        try {
          if (fs.existsSync(file) && fs.statSync(file).size === ph.size) { got++; continue; }
          const res = await callPortal(`/api/exam-sync/photo?name=${encodeURIComponent(ph.name)}`, { raw: true });
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          got++;
        } catch { failed++; }
      }
      const photoRow = rows.find(r => r.key === 'photos');
      if (photoRow) { photoRow.rows = got; if (failed) { photoRow.status = 'partial'; photoRow.note = `${failed} could not be downloaded`; } }
    }
    const result = {
      scope: want.includes('all') ? 'All Necessary Data' : want.map(g => ({ students: 'Students', staff: 'Staff', cbt: 'CBT / Exams', images: 'Images' }[g])).join(', '),
      startedAt: started, completedAt: nowIso(), by: actor?.name || 'Setup',
      datasets: rows, ok: rows.filter(r => r.status === 'ok').length, failed: rows.filter(r => r.status !== 'ok').length,
      school: data.school,
    };
    setMeta('sync_last_report', JSON.stringify(result));
    setMeta('exam_synced', JSON.stringify({ at: result.completedAt, scope: result.scope }));
    return result;
  }

  async function push() {
    const pending = all(`SELECT a.id, a.schedule_subject_id AS scheduleSubjectId, a.student_id AS studentId, a.started_at AS startedAt,
                                a.submitted_at AS submittedAt, s.score, s.total_marks AS totalMarks
                         FROM cbt_attempts a LEFT JOIN cbt_scores s ON s.schedule_subject_id = a.schedule_subject_id AND s.student_id = a.student_id
                         WHERE a.submitted_at IS NOT NULL AND a.pushed_at IS NULL ORDER BY a.id`);
    const totals = { sent: 0, imported: 0, alreadyUploaded: 0, retakes: [], conflicts: [], skipped: [], scoreChanged: [], failedBatches: 0, pending: pending.length };
    for (let i = 0; i < pending.length; i += PUSH_BATCH) {
      const batch = pending.slice(i, i + PUSH_BATCH);
      const attempts = batch.map(a => ({
        scheduleSubjectId: a.scheduleSubjectId, studentId: a.studentId, startedAt: a.startedAt, submittedAt: a.submittedAt, score: a.score, totalMarks: a.totalMarks,
        answers: all('SELECT question_id, selected_option FROM cbt_attempt_answers WHERE attempt_id = ?', a.id).map(r => [r.question_id, r.selected_option]),
      }));
      let r;
      try { r = (await callPortal('/api/exam-sync/submissions', { method: 'POST', body: { attempts } })).report; } catch (err) {
        totals.failedBatches++;
        totals.error = err.message;
        break; // keep the rest for next time
      }
      const at = nowIso();
      for (const o of r.outcomes || []) {
        const a = batch.find(x => x.scheduleSubjectId === o.scheduleSubjectId && x.studentId === o.studentId);
        if (a) run('UPDATE cbt_attempts SET pushed_at = ?, push_note = ? WHERE id = ?', at, o.status, a.id);
      }
      totals.sent += batch.length;
      totals.imported += r.imported;
      totals.alreadyUploaded += r.alreadyUploaded;
      totals.conflicts.push(...r.conflicts);
      totals.retakes.push(...(r.retakes || []));
      totals.skipped.push(...r.skipped);
      totals.scoreChanged.push(...r.scoreChanged);
    }
    totals.left = one('SELECT COUNT(*) n FROM cbt_attempts WHERE submitted_at IS NOT NULL AND pushed_at IS NULL').n;
    setMeta('sync_last_push', JSON.stringify({ at: nowIso(), ...totals }));
    return totals;
  }

  function archive(from, to) {
    return all(`
      SELECT a.id, a.student_id AS studentId, st.name AS studentName, c.label AS classLabel, sub.name AS subject, sc.title AS schedule,
             a.started_at AS startedAt, a.submitted_at AS submittedAt, s.score, s.total_marks AS totalMarks, a.pushed_at AS pushedAt, a.push_note AS pushNote
      FROM cbt_attempts a
      LEFT JOIN students st ON st.id = a.student_id
      LEFT JOIN cbt_schedule_subjects ss ON ss.id = a.schedule_subject_id
      LEFT JOIN classes c ON c.code = ss.class_code
      LEFT JOIN subjects sub ON sub.id = ss.subject_id
      LEFT JOIN cbt_schedules sc ON sc.id = ss.schedule_id
      LEFT JOIN cbt_scores s ON s.schedule_subject_id = a.schedule_subject_id AND s.student_id = a.student_id
      WHERE a.submitted_at IS NOT NULL AND substr(a.submitted_at, 1, 10) BETWEEN ? AND ?
      ORDER BY a.submitted_at DESC`, from, to);
  }

  function statusInfo() {
    const conn = connection();
    let synced = null;
    try { synced = JSON.parse(valueFromMeta('exam_synced', '') || 'null'); } catch { /* none */ }
    let lastPush = null;
    try { lastPush = JSON.parse(valueFromMeta('sync_last_push', '') || 'null'); } catch { /* none */ }
    return {
      connected: !!conn.apiNumber, portal: conn.portal, apiNumber: conn.apiNumber, machine: require('node:os').hostname(),
      connectionName: valueFromMeta('sync_connection_name', ''), school: valueFromMeta('school_name', ''),
      synced, lastPush,
      unpushed: one('SELECT COUNT(*) n FROM cbt_attempts WHERE submitted_at IS NOT NULL AND pushed_at IS NULL').n,
    };
  }

  // ── app screens: dashboard, read-only lists, updates ──
  const appBuild = () => ({ build: cleanText(process.env.UCS_APP_BUILD), version: cleanText(process.env.UCS_APP_VERSION), shell: cleanText(process.env.UCS_APP_SHELL) });
  function dashboard() {
    const term = one('SELECT session_label AS session, term_label AS term FROM academic_terms WHERE is_active = 1');
    const since = new Date(Date.now() - 10 * 60e3).toISOString();
    const hasSeen = all('PRAGMA table_info(sessions)').some(c => c.name === 'last_seen_at');
    return {
      school: valueFromMeta('school_name', ''), term,
      lanAddresses: cbtOffline.lanAddresses(), lanNetworks: cbtOffline.lanNetworks(),
      totalStudents: one("SELECT COUNT(*) n FROM students WHERE status IS NULL OR status = 'active'").n,
      activeStudents: hasSeen ? one(`SELECT COUNT(DISTINCT s.user_id) n FROM sessions s JOIN users u ON u.id = s.user_id
                                     WHERE u.role = 'student' AND s.expires_at > ? AND COALESCE(s.last_seen_at, s.created_at) > ?`, nowIso(), since).n : 0,
      papers: one("SELECT COUNT(*) total, SUM(status = 'live') live FROM cbt_schedule_subjects"),
      writing: one('SELECT COUNT(*) n FROM cbt_attempts WHERE submitted_at IS NULL').n,
      handedIn: one('SELECT COUNT(*) n FROM cbt_attempts WHERE submitted_at IS NOT NULL').n,
      ...statusInfo(), app: appBuild(), pack: cbtOffline.currentPack(),
    };
  }
  function studentsList(classCode, armId, search = '') {
    return all(`SELECT st.id, st.name, st.reg_no AS regNo, st.gender, st.photo_path AS photo, st.class_code AS classCode, c.label AS classLabel, ca.name AS armName
                FROM students st LEFT JOIN classes c ON c.code = st.class_code LEFT JOIN class_arms ca ON ca.id = st.class_arm_id
                WHERE (st.status IS NULL OR st.status = 'active') ${classCode ? 'AND st.class_code = ?' : ''} ${armId ? 'AND st.class_arm_id = ?' : ''}
                  ${search ? "AND (st.name LIKE ? OR st.id LIKE ? OR COALESCE(st.reg_no, '') LIKE ?)" : ''}
                ORDER BY c.label, ca.name, st.name`, ...[classCode, armId].filter(Boolean), ...(search ? Array(3).fill(`%${search}%`) : []));
  }
  function staffList() {
    const cols = new Set(all('PRAGMA table_info(users)').map(c => c.name));
    const pick = c => (cols.has(c) ? c : 'NULL');
    const subjects = new Map();
    for (const r of all(`SELECT ta.teacher_id AS teacherId, sub.name AS subject, c.label AS classLabel FROM teacher_assignments ta
                         JOIN subjects sub ON sub.id = ta.subject_id JOIN classes c ON c.code = ta.class_code ORDER BY c.rowid, sub.name`)) {
      if (!subjects.has(r.teacherId)) subjects.set(r.teacherId, []);
      subjects.get(r.teacherId).push({ subject: r.subject, classLabel: r.classLabel });
    }
    const forms = new Map();
    for (const r of all(`SELECT ca.form_teacher_id AS teacherId, c.label AS classLabel, ca.name AS armName FROM class_arms ca
                         JOIN classes c ON c.code = ca.class_code WHERE ca.form_teacher_id IS NOT NULL ORDER BY c.rowid, ca.name`)) {
      if (!forms.has(r.teacherId)) forms.set(r.teacherId, []);
      forms.get(r.teacherId).push(`${r.classLabel} ${r.armName}`.trim());
    }
    // as on report cards: without an arm of their own, a class's Class Teacher is its form teacher
    for (const r of all(`SELECT DISTINCT ta.teacher_id AS teacherId, c.label AS classLabel FROM teacher_assignments ta JOIN classes c ON c.code = ta.class_code
                         WHERE ta.teacher_type = 'class_teacher' ORDER BY c.rowid`)) {
      if (!forms.has(r.teacherId)) forms.set(r.teacherId, []);
      const list = forms.get(r.teacherId);
      if (!list.some(x => x === r.classLabel || x.startsWith(`${r.classLabel} `))) list.push(r.classLabel);
    }
    return all(`SELECT id, name, role, ${pick('designation')} AS designation, ${pick('phone')} AS phone, ${pick('email')} AS email, ${pick('photo_path')} AS photo,
                       ${pick('staff_type')} AS staffType, ${pick('gender')} AS gender, ${pick('department')} AS department, ${pick('qualifications')} AS qualifications,
                       ${pick('date_of_appointment')} AS dateOfAppointment, ${pick('active')} AS active
                FROM users WHERE role IN ('admin', 'teacher', 'staff') ORDER BY name COLLATE NOCASE`)
      .map(u => ({ ...u, level: u.role === 'admin' ? adminLevel(u.id) : null, subjects: subjects.get(u.id) || [], formClasses: forms.get(u.id) || [] }));
  }
  function schedulesList() {
    return all(`SELECT sc.id, sc.title, sc.session_label AS session, sc.term_label AS term,
                       ss.id AS paperId, ss.status, ss.mode, ss.class_code AS classCode, ss.class_arm_id AS armId, ss.exam_date AS examDate, ss.exam_time AS examTime, ss.duration_minutes AS durationMinutes,
                       c.label AS classLabel, ca.name AS armName, sub.name AS subject,
                       (SELECT COUNT(*) FROM cbt_questions q WHERE q.class_code = ss.class_code AND q.subject_id = ss.subject_id AND q.question_type = 'Multiple Choice Question' AND q.vetted = 1 AND q.archived = 0) AS questions
                FROM cbt_schedules sc JOIN cbt_schedule_subjects ss ON ss.schedule_id = sc.id
                JOIN classes c ON c.code = ss.class_code JOIN subjects sub ON sub.id = ss.subject_id LEFT JOIN class_arms ca ON ca.id = ss.class_arm_id
                ORDER BY sc.id DESC, ss.exam_date, ss.exam_time, c.label, sub.name`);
  }
  // An update is either just the portal files that changed (when the app's frame, its
  // window and engine, is the same) or, when the frame changed, the full Setup.
  const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
  // the portal's files this exam server doesn't have yet (it runs from the folder it started in)
  const changedFiles = list => list.filter(([rel, sha]) => {
    try { return sha256(fs.readFileSync(path.join(process.cwd(), ...rel.split('/')))) !== sha; } catch { return true; }
  });
  // ── Going back to the previous version ──
  // The app records the version it ran before (exam-app/launcher.js, app/history.json)
  // and keeps its files. Same app frame: switch back to those files and restart, in
  // seconds, offline. Different frame (a full update): install the portal's kept
  // installer for that frame, then the kept files are picked up again.
  const appHistory = () => {
    try { return JSON.parse(fs.readFileSync(path.join(process.env.UCS_APP_HOME || '', 'app', 'history.json'), 'utf8')); } catch { return {}; }
  };
  const folderReady = build => {
    try { return fs.readFileSync(path.join(process.env.UCS_APP_HOME || '', 'app', build, '.ready'), 'utf8').trim() === build; } catch { return false; }
  };
  // kept: the installers the portal has (null: not asked, e.g. no internet)
  function previousVersion(kept = null) {
    const prev = appHistory().previous;
    if (!prev?.build || prev.build === appBuild().build) return null;
    const sameFrame = prev.shell && prev.shell === appBuild().shell;
    if (sameFrame && folderReady(prev.build)) return { ...prev, kind: 'instant' };
    if (!sameFrame && (!kept || kept[prev.shell])) return { ...prev, kind: 'full', downloadSize: kept?.[prev.shell]?.size || 0 };
    return { ...prev, kind: 'unavailable' };
  }
  async function rollback() {
    if (process.platform !== 'win32' || !process.env.UCS_APP_BUILD) throw new Error('Going back works in the UCS Exam Server app on Windows');
    if (download && !download.done && !download.error) throw new Error('An update is downloading. Wait for it to finish first.');
    let kept = null; // no internet: an instant one still works; a full one says it can't reach the portal
    try { kept = (await callPortal('/api/exam-sync/update')).kept || {}; } catch { /* offline: only an instant one */ }
    const prev = previousVersion(kept);
    if (!prev) throw new Error('There is no previous version on this computer to go back to');
    const appRoot = path.join(process.env.UCS_APP_HOME, 'app');
    if (prev.kind === 'instant') {
      if (prev.build === process.env.UCS_APP_BASE) fs.rmSync(path.join(appRoot, 'current.json'), { force: true });
      else fs.writeFileSync(path.join(appRoot, 'current.json'), JSON.stringify({ build: prev.build, base: process.env.UCS_APP_BASE, shell: prev.shell, version: prev.version }));
      download = { kind: 'files', received: 1, total: 1, startedAt: Date.now(), done: true, error: '', rollback: true };
      setTimeout(() => {
        if (typeof globalThis.ucsRestartEngine === 'function') globalThis.ucsRestartEngine();
        else process.exit(75);
      }, 1500);
      return { started: true, kind: 'instant' };
    }
    if (prev.kind === 'full') {
      // after the earlier installer, the launcher picks the kept version back up
      fs.writeFileSync(path.join(appRoot, 'rollback.json'), JSON.stringify({ build: prev.build, shell: prev.shell, version: prev.version }));
      return downloadAndRunSetup(`/api/exam-sync/setup.exe?shell=${encodeURIComponent(prev.shell)}`, 'full');
    }
    throw new Error('The portal no longer has that version of the app, so this exam computer can\'t go back to it');
  }

  async function updateCheck() {
    const mine = appBuild();
    const r = await callPortal('/api/exam-sync/update');
    const latest = r.app || null;
    const out = { running: mine, latest, setupSize: r.setupSize, available: !!(latest && mine.build && latest.build !== mine.build && r.setupSize), insideApp: !!mine.build, kind: 'full', previous: previousVersion(r.kept || {}) };
    if (out.available && r.files && mine.shell && latest.shell === mine.shell) {
      try {
        const changed = changedFiles((await callPortal('/api/exam-sync/update-files')).files);
        Object.assign(out, { kind: 'files', changed: changed.map(([rel]) => rel), downloadSize: changed.reduce((n, f) => n + (f[3] || f[2]), 0) });
      } catch { /* the full download instead */ }
    }
    return out;
  }
  // Downloads the update in the background; the app follows it through updateProgress().
  let download = null; // { kind, received, total, startedAt, done, error }
  const updateProgress = () => download || { idle: true };
  async function updateInstall() {
    if (process.platform !== 'win32' || !process.env.UCS_APP_BUILD) throw new Error('Updates install from the UCS Exam Server app on Windows');
    if (download && !download.done && !download.error) return { started: true }; // already downloading
    const check = await updateCheck();
    if (!check.available) throw new Error('This exam server already has the latest version');
    if (check.kind === 'files') return installChangedFiles(check.latest);
    return downloadAndRunSetup('/api/exam-sync/setup.exe', 'full');
  }
  // Downloads a Setup from the portal, starts it and closes this server so it can be replaced
  async function downloadAndRunSetup(portalPath, kind) {
    // the full Setup is large (it carries the app's own window engine): allow a slow line plenty of time
    const res = await callPortal(portalPath, { raw: true, timeout: 45 * 60e3 });
    download = { kind, received: 0, total: Number(res.headers.get('content-length')) || 0, startedAt: Date.now(), done: false, error: '' };
    const file = path.join(require('node:os').tmpdir(), `UCS Exam Server Setup ${Date.now()}.exe`);
    (async () => {
      const out = fs.createWriteStream(file);
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
          download.received += chunk.length;
        }
        await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
        if (download.total && download.received < download.total) throw new Error('The download stopped before it finished');
        download.done = true;
      } catch (err) {
        out.destroy();
        fs.rm(file, { force: true }, () => {});
        // a failed go-back leaves nothing waiting for the next start
        if (process.env.UCS_APP_HOME) fs.rm(path.join(process.env.UCS_APP_HOME, 'app', 'rollback.json'), { force: true }, () => {});
        download.error = `The download stopped: ${err.cause?.code || err.message}. Check the internet connection and try again.`;
        return;
      }
      // give the app a moment to show 100%, then close its window first, so the updated app opens the only window
      setTimeout(() => {
        if (typeof globalThis.ucsCloseAppWindow === 'function') globalThis.ucsCloseAppWindow();
        require('node:child_process').spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => process.exit(0), 1000);
      }, 1500);
    })();
    return { started: true };
  }

  // Just the changed files: the new version is put together in a folder of its own
  // (unchanged files copied from this one, changed ones from the download, each checked
  // against its fingerprint) and only then switched to, so a dropped connection or a
  // bad file changes nothing. The engine then restarts on the new version in seconds.
  async function installChangedFiles(latest) {
    const home = process.env.UCS_APP_HOME;
    if (!home) throw new Error('Restart the UCS Exam Server app, then check for updates again');
    const { files } = await callPortal('/api/exam-sync/update-files');
    const changed = changedFiles(files);
    download = { kind: 'files', received: 0, total: changed.reduce((n, f) => n + (f[3] || f[2]), 0), startedAt: Date.now(), done: false, error: '' };
    const target = path.join(home, 'app', latest.build);
    const temp = `${target}.partial`;
    (async () => {
      try {
        const fresh = new Map();
        if (changed.length) {
          const res = await callPortal('/api/exam-sync/update-files', { method: 'POST', body: { paths: changed.map(([rel]) => rel) }, raw: true, timeout: 30 * 60e3 });
          download.total = Number(res.headers.get('content-length')) || download.total;
          const chunks = [];
          for await (const chunk of res.body) { chunks.push(chunk); download.received += chunk.length; }
          const raw = zlib.gunzipSync(Buffer.concat(chunks));
          const headerLength = raw.readUInt32LE(0);
          const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8'));
          const base = 4 + headerLength;
          for (const [rel, offset, length] of header.files) fresh.set(rel, raw.subarray(base + offset, base + offset + length));
        }
        fs.rmSync(temp, { recursive: true, force: true });
        for (const [rel, sha] of files) {
          const data = fresh.get(rel) || fs.readFileSync(path.join(process.cwd(), ...rel.split('/')));
          if (sha256(data) !== sha) throw new Error(`${rel} did not arrive correctly`);
          const file = path.join(temp, ...rel.split('/'));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, data);
        }
        fs.writeFileSync(path.join(temp, '.ready'), latest.build);
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(temp, target);
        // from its next start the engine runs from the new folder (see exam-app/launcher.js)
        fs.writeFileSync(path.join(home, 'app', 'current.json'), JSON.stringify({
          build: latest.build, base: process.env.UCS_APP_BASE, shell: process.env.UCS_APP_SHELL, version: latest.version,
        }));
        download.received = download.total;
        download.done = true;
      } catch (err) {
        fs.rm(temp, { recursive: true, force: true }, () => {});
        download.error = `The update didn't install, so nothing was changed: ${err.cause?.code || err.message}. Check the internet connection and try again.`;
        return;
      }
      // the app restarts the engine (exit code 75) and reloads the window
      setTimeout(() => {
        if (typeof globalThis.ucsRestartEngine === 'function') globalThis.ucsRestartEngine();
        else process.exit(75);
      }, 1500);
    })();
    return { started: true, kind: 'files' };
  }

  async function handleExam(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    // the app asking for its window back (a second launch); only from this computer
    if (m === 'POST' && p === '/api/exam/app-window') {
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      if (!local || typeof globalThis.ucsShowAppWindow !== 'function') return sendJson(res, 404, { error: 'Not found' }), true;
      globalThis.ucsShowAppWindow();
      return sendJson(res, 200, { ok: true }), true;
    }
    if (['/api/exam/dashboard', '/api/exam/people/students', '/api/exam/people/staff', '/api/exam/schedules', '/api/exam/update-check', '/api/exam/update-install', '/api/exam/update-progress', '/api/exam/rollback', '/api/exam/rollback-info'].includes(p)) {
      const admin = requireUser(req, res, 'admin');
      if (!admin) return true;
      try {
        if (m === 'GET' && p === '/api/exam/dashboard') return sendJson(res, 200, dashboard()), true;
        if (m === 'GET' && p === '/api/exam/people/students') {
          return sendJson(res, 200, { students: studentsList(cleanText(url.searchParams.get('classCode')).toUpperCase(), Number(url.searchParams.get('armId')) || null, cleanText(url.searchParams.get('q'))),
            sessions: all('SELECT DISTINCT session_label AS label, MAX(is_active) AS active FROM academic_terms GROUP BY session_label ORDER BY session_label DESC'),
            classes: all('SELECT code, label FROM classes WHERE COALESCE(archived, 0) = 0 ORDER BY rowid'), arms: all('SELECT id, class_code AS classCode, name FROM class_arms ORDER BY name') }), true;
        }
        if (m === 'GET' && p === '/api/exam/people/staff') return sendJson(res, 200, { staff: staffList() }), true;
        if (m === 'GET' && p === '/api/exam/schedules') return sendJson(res, 200, { rows: schedulesList() }), true;
        if (m === 'GET' && p === '/api/exam/update-check') return sendJson(res, 200, await updateCheck()), true;
        if (m === 'POST' && p === '/api/exam/update-install') return sendJson(res, 200, await updateInstall()), true;
        if (m === 'GET' && p === '/api/exam/update-progress') return sendJson(res, 200, updateProgress()), true;
        if (m === 'POST' && p === '/api/exam/rollback') return sendJson(res, 200, await rollback()), true;
        if (m === 'GET' && p === '/api/exam/rollback-info') return sendJson(res, 200, { previous: previousVersion(null), running: appBuild() }), true;
      } catch (err) {
        return sendJson(res, 400, { error: err.message }), true;
      }
    }
    const syncPaths = ['/api/exam/sync-status', '/api/exam/connect', '/api/exam/disconnect', '/api/exam/refresh', '/api/exam/push', '/api/exam/archive', '/api/exam/sync-report'];
    if (!syncPaths.includes(p)) return false;
    // (the trial testers made on this computer don't count: they exist from the first start)
    const hasUsers = !!one('SELECT id FROM users WHERE COALESCE(trial, 0) = 0 LIMIT 1');
    // a brand-new install connects and does its first refresh before any admin exists here
    const firstRun = !hasUsers;
    if (m === 'GET' && p === '/api/exam/sync-status') return sendJson(res, 200, { ...statusInfo(), firstRun, defaultPortal: DEFAULT_PORTAL }), true;
    const admin = firstRun && ['/api/exam/connect', '/api/exam/refresh'].includes(p) ? { id: 'setup', name: 'Setup' } : requireUser(req, res, 'admin');
    if (!admin) return true;
    try {
      if (m === 'POST' && p === '/api/exam/connect') {
        const b = await readJson(req);
        const conn = {
          portal: (cleanText(b.portal) || DEFAULT_PORTAL).replace(/\/+$/, ''),
          apiNumber: cleanText(b.apiNumber).toUpperCase(), authKey: cleanText(b.authKey), secret: String(b.secret || '').trim(),
        };
        if (!/^https?:\/\/[^\s]+$/i.test(conn.portal)) return sendJson(res, 400, { error: 'Enter the portal address, e.g. https://portal.uniquechildrenschool.com' }), true;
        if (!conn.apiNumber || !conn.authKey || !conn.secret) return sendJson(res, 400, { error: 'Enter the API Number, Authentication Key and Secret Key' }), true;
        const hello = await callPortal('/api/exam-sync/hello', { conn });
        setMeta('sync_portal', conn.portal);
        setMeta('sync_api_number', conn.apiNumber);
        setMeta('sync_auth_key', conn.authKey);
        setMeta('sync_secret', conn.secret);
        setMeta('sync_connection_name', hello.connection?.name || '');
        if (hello.school?.name) setMeta('school_name', hello.school.name);
        return sendJson(res, 200, { ok: true, hello, status: statusInfo() }), true;
      }
      if (m === 'POST' && p === '/api/exam/disconnect') {
        ['sync_api_number', 'sync_auth_key', 'sync_secret', 'sync_connection_name'].forEach(k => setMeta(k, ''));
        return sendJson(res, 200, { ok: true, status: statusInfo() }), true;
      }
      if (m === 'POST' && p === '/api/exam/refresh') {
        const b = await readJson(req);
        if (!b.confirm) return sendJson(res, 400, { error: 'Tick "I confirm" to refresh. This overwrites the data on this computer.' }), true;
        const groups = firstRun ? ['all'] : (Array.isArray(b.groups) ? b.groups : [b.group || 'all']).map(String);
        return sendJson(res, 200, { ok: true, report: await refresh(groups, admin), status: statusInfo() }), true;
      }
      if (m === 'POST' && p === '/api/exam/push') {
        return sendJson(res, 200, { ok: true, result: await push(), status: statusInfo() }), true;
      }
      if (m === 'GET' && p === '/api/exam/sync-report') return sendJson(res, 200, { report: report() }), true;
      if (m === 'GET' && p === '/api/exam/archive') {
        const day = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
        const to = day(url.searchParams.get('to')) || new Date().toISOString().slice(0, 10);
        const from = day(url.searchParams.get('from')) || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
        return sendJson(res, 200, { from, to, rows: archive(from, to) }), true;
      }
      return sendJson(res, 404, { error: 'Not found' }), true;
    } catch (err) {
      return sendJson(res, 400, { error: err.message }), true;
    }
  }

  async function handle(req, res, url) {
    if (EXAM_MODE) return handleExam(req, res, url);
    return handlePortal(req, res, url);
  }

  return { createSchema, handle, push, refresh, statusInfo };
};
