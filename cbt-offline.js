// Offline (LAN) CBT.
// Online portal:  download an encrypted exam pack, download the exam-server
//                 kit, upload the encrypted results file afterwards.
// Exam computer:  EXAM_MODE=1 — load the pack, open/close papers, watch
//                 progress, allow retakes, export the results file.
// Pupils write on the exam computer over the school LAN using the normal CBT
// page; no internet is needed while the exam runs.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const PACK_FORMAT = 'ucs-cbt-pack';
const RESULTS_FORMAT = 'ucs-cbt-results';

function createCbtOffline(deps) {
  const {
    db, one, all, run, ensureColumn, cleanText, readJson, sendJson, requireUser, zipFiles,
    markCbtAttempt, valueFromMeta, setMeta, ROOT, EXAM_MODE, PORT,
  } = deps;

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cbt_offline_packs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_by TEXT,
        schedule_ids TEXT NOT NULL,
        paper_count INTEGER NOT NULL DEFAULT 0,
        student_count INTEGER NOT NULL DEFAULT 0,
        question_count INTEGER NOT NULL DEFAULT 0,
        results_uploaded_at TEXT,
        results_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    // where an attempt came from: NULL = written online, 'offline:<pack id>' = uploaded from the LAN
    ensureColumn('cbt_attempts', 'source', 'TEXT');
  }

  // ── Encryption: scrypt(passphrase) → AES-256-GCM over gzipped JSON ──
  function deriveKey(passphrase, salt) {
    return crypto.scryptSync(String(passphrase), salt, 32, { N: 16384, r: 8, p: 1 });
  }
  function sealWithKey(format, payload, key, salt) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))), cipher.final()]);
    return JSON.stringify({
      format, version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
    });
  }
  function seal(format, payload, passphrase) {
    const salt = crypto.randomBytes(16);
    return { file: sealWithKey(format, payload, deriveKey(passphrase, salt), salt), salt, key: deriveKey(passphrase, salt) };
  }
  // Returns { payload, key, salt } or throws a readable error.
  function unseal(format, text, passphrase) {
    let envelope;
    try { envelope = JSON.parse(text); } catch { throw new Error('This file could not be read. Choose the file the portal gave you.'); }
    if (envelope?.format !== format) {
      throw new Error(format === PACK_FORMAT ? 'This is not an exam pack file.' : 'This is not a CBT results file.');
    }
    const salt = Buffer.from(String(envelope.salt), 'base64');
    const key = deriveKey(passphrase, salt);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(envelope.iv), 'base64'));
      decipher.setAuthTag(Buffer.from(String(envelope.tag), 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(String(envelope.data), 'base64')), decipher.final()]);
      return { payload: JSON.parse(zlib.gunzipSync(plain).toString('utf8')), key, salt };
    } catch {
      throw new Error('Wrong passphrase, or the file has been changed.');
    }
  }
  function fileFromDataUrl(value) {
    const match = cleanText(value).match(/^data:[^;]*;base64,(.+)$/);
    if (!match) throw new Error('Choose the file first');
    return Buffer.from(match[1], 'base64').toString('utf8');
  }
  function checkPassphrase(passphrase) {
    if (String(passphrase || '').length < 6) throw new Error('The passphrase must be at least 6 characters');
  }
  function sendFile(res, name, text, type = 'application/octet-stream') {
    const body = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  }
  function lanAddresses() {
    return Object.values(os.networkInterfaces()).flat()
      .filter(a => a && a.family === 'IPv4' && !a.internal)
      .map(a => `http://${a.address}${PORT && Number(PORT) !== 80 ? `:${PORT}` : ''}`);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  // ── ONLINE: build the exam pack ──
  function buildPack(scheduleIds, admin) {
    const ids = [...new Set(scheduleIds.map(Number).filter(Boolean))];
    if (!ids.length) throw new Error('Tick at least one CBT schedule');
    const marks = ids.map(() => '?').join(',');
    const schedules = all(`SELECT * FROM cbt_schedules WHERE id IN (${marks})`, ...ids);
    if (schedules.length !== ids.length) throw new Error('One of the chosen schedules no longer exists');
    const papers = all(`SELECT * FROM cbt_schedule_subjects WHERE schedule_id IN (${marks}) AND mode = 'Computer Based'`, ...ids);
    if (!papers.length) throw new Error('The chosen schedules have no Computer Based papers');
    const pairs = new Set(papers.map(p => `${p.class_code}|${p.subject_id}`));
    const questions = all("SELECT * FROM cbt_questions WHERE question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0")
      .filter(q => pairs.has(`${q.class_code}|${q.subject_id}`));
    const classCodes = [...new Set(papers.map(p => p.class_code))];
    const students = all(`SELECT * FROM students WHERE class_code IN (${classCodes.map(() => '?').join(',')})`, ...classCodes)
      .filter(s => !s.archived && (!s.status || s.status === 'active'));
    const studentIds = new Set(students.map(s => s.id));
    const scrub = u => ({ ...u, reset_token: null, reset_token_expires: null });
    const users = all("SELECT * FROM users WHERE role IN ('student', 'admin')")
      .filter(u => (u.role === 'student' && studentIds.has(u.id)) || (u.role === 'admin' && u.active))
      .map(scrub);
    const packId = crypto.randomUUID();
    return {
      packId,
      summary: { schedules: schedules.map(s => s.title), papers: papers.length, students: students.length, questions: questions.length },
      payload: {
        format: PACK_FORMAT, version: 1, packId, createdAt: new Date().toISOString(),
        createdBy: { id: admin.id, name: admin.name },
        schedules: schedules.map(s => ({ id: s.id, title: s.title, session: s.session_label, term: s.term_label })),
        tables: {
          academic_terms: all('SELECT * FROM academic_terms'),
          classes: all('SELECT * FROM classes'),
          class_arms: all('SELECT * FROM class_arms'),
          subjects: all('SELECT * FROM subjects'),
          users,
          students,
          cbt_instruction_sets: all('SELECT * FROM cbt_instruction_sets'),
          cbt_schedules: schedules,
          cbt_schedule_subjects: papers,
          cbt_questions: questions,
        },
      },
    };
  }

  // ── ONLINE: exam-server kit (app files + libraries + start scripts + guide) ──
  function kitFiles() {
    const out = appFiles(ROOT).map(([rel, data]) => [`ucs-exam-server/${rel}`, data]);
    const bat = [
      '@echo off',
      'title Unique Children\'s School - CBT Exam Server',
      'cd /d "%~dp0"',
      'where node >nul 2>nul || (echo. & echo Node.js is not installed on this computer. & echo Install Node.js 24 LTS from https://nodejs.org and then double-click this file again. & echo. & pause & exit /b 1)',
      'set EXAM_MODE=1',
      'set "DATA_DIR=%~dp0exam-data"',
      'set PORT=8080',
      'if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"',
      // opens the Exam Console in the browser a few seconds after the server starts
      'start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8080"',
      'node server.js',
      'echo.',
      'echo The exam server has stopped.',
      'pause',
    ].join('\r\n');
    const sh = [
      '#!/bin/sh',
      'cd "$(dirname "$0")"',
      'command -v node >/dev/null 2>&1 || { echo "Install Node.js 24 LTS from https://nodejs.org first."; exit 1; }',
      'export EXAM_MODE=1 DATA_DIR="$(pwd)/exam-data" PORT=8080',
      'mkdir -p "$DATA_DIR"',
      '(sleep 3; xdg-open http://localhost:8080 2>/dev/null || open http://localhost:8080 2>/dev/null) &',
      'exec node server.js',
    ].join('\n');
    out.push(['ucs-exam-server/START-EXAM-SERVER.bat', bat]);
    // double-click to get back to the Exam Console if the browser was closed
    out.push(['ucs-exam-server/OPEN EXAM CONSOLE.url', '[InternetShortcut]\r\nURL=http://localhost:8080/\r\n']);
    out.push(['ucs-exam-server/start-exam-server.sh', sh]);
    out.push(['ucs-exam-server/EXAM-SERVER-GUIDE.txt', KIT_GUIDE.replace(/\n/g, '\r\n')]);
    return out;
  }

  // ── ONLINE: take in a results file from the exam computer ──
  function importResults(text, passphrase, admin) {
    const { payload } = unseal(RESULTS_FORMAT, text, passphrase);
    const pack = one('SELECT * FROM cbt_offline_packs WHERE id = ?', payload.packId);
    if (!pack) throw new Error('These results come from an exam pack this portal did not create.');
    const source = `offline:${payload.packId}`;
    const report = { imported: 0, alreadyUploaded: 0, conflicts: [], skipped: [], scoreChanged: [], notSubmitted: (payload.notSubmitted || []).length };
    const label = (ssId, studentId) => {
      const r = one(`SELECT st.name, sub.name AS subject, c.label AS cls FROM students st, cbt_schedule_subjects ss
                     JOIN subjects sub ON sub.id = ss.subject_id JOIN classes c ON c.code = ss.class_code
                     WHERE st.id = ? AND ss.id = ?`, studentId, ssId);
      return r ? `${r.name} — ${r.cls} ${r.subject}` : `${studentId} (paper ${ssId})`;
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const a of payload.attempts || []) {
        const ssId = Number(a.scheduleSubjectId);
        const studentId = cleanText(a.studentId);
        if (!one('SELECT id FROM cbt_schedule_subjects WHERE id = ?', ssId) || !one('SELECT id FROM students WHERE id = ?', studentId)) {
          report.skipped.push(`${studentId}: paper or pupil no longer exists online`);
          continue;
        }
        const existing = one('SELECT id, submitted_at AS submittedAt, source FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', ssId, studentId);
        if (existing && existing.source === source) { report.alreadyUploaded++; continue; }
        if (existing && existing.submittedAt) { report.conflicts.push(`${label(ssId, studentId)}: already wrote this paper online — kept the online result`); continue; }
        if (existing) run('DELETE FROM cbt_attempts WHERE id = ?', existing.id); // an unfinished online try gives way
        const inserted = run(
          'INSERT INTO cbt_attempts (schedule_subject_id, student_id, started_at, submitted_at, source) VALUES (?, ?, ?, NULL, ?)',
          ssId, studentId, cleanText(a.startedAt) || new Date().toISOString(), source
        );
        const attemptId = Number(inserted.lastInsertRowid);
        for (const [questionId, selected] of a.answers || []) {
          if (!one('SELECT id FROM cbt_questions WHERE id = ?', Number(questionId))) continue;
          run('INSERT OR REPLACE INTO cbt_attempt_answers (attempt_id, question_id, selected_option) VALUES (?, ?, ?)',
            attemptId, Number(questionId), selected === null || selected === undefined ? null : Number(selected));
        }
        // marked again here against the portal's questions, so the online score is authoritative
        const result = markCbtAttempt(ssId, studentId, attemptId, admin.id, cleanText(a.submittedAt) || new Date().toISOString());
        if (Number(a.score) !== result.score) report.scoreChanged.push(`${label(ssId, studentId)}: ${a.score} on the exam computer → ${result.score} here (questions changed since the pack was made)`);
        report.imported++;
      }
      run('UPDATE cbt_offline_packs SET results_uploaded_at = ?, results_count = results_count + ? WHERE id = ?', new Date().toISOString(), report.imported, pack.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return report;
  }

  // ── EXAM COMPUTER: load a pack ──
  const PACK_TABLE_ORDER = ['academic_terms', 'classes', 'class_arms', 'subjects', 'users', 'students', 'cbt_instruction_sets', 'cbt_schedules', 'cbt_schedule_subjects', 'cbt_questions'];
  const WIPE_ORDER = ['cbt_attempt_answers', 'cbt_attempts', 'cbt_scores', 'cbt_schedule_subjects', 'cbt_schedules', 'cbt_questions', 'cbt_instruction_sets', 'sessions', 'trusted_devices', 'students', 'users', 'class_arms', 'classes', 'subjects', 'academic_terms'];
  const tableExists = name => !!one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
  function insertRows(table, rows) {
    if (!rows?.length || !tableExists(table)) return 0;
    const local = new Set(all(`PRAGMA table_info("${table}")`).map(c => c.name));
    for (const row of rows) {
      const cols = Object.keys(row).filter(c => local.has(c));
      run(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => row[c]));
    }
    return rows.length;
  }
  function loadPack(text, passphrase) {
    const { payload, key, salt } = unseal(PACK_FORMAT, text, passphrase);
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        WIPE_ORDER.forEach(t => { if (tableExists(t)) run(`DELETE FROM "${t}"`); });
        PACK_TABLE_ORDER.forEach(t => insertRows(t, payload.tables[t]));
        // links to things the pack doesn't carry (e.g. the teacher who wrote a question) are cleared
        for (const v of all('PRAGMA foreign_key_check')) {
          const fk = all(`PRAGMA foreign_key_list("${v.table}")`).find(f => f.id === v.fkid);
          try { run(`UPDATE "${v.table}" SET "${fk.from}" = NULL WHERE rowid = ?`, v.rowid); } catch { run(`DELETE FROM "${v.table}" WHERE rowid = ?`, v.rowid); }
        }
        setMeta('exam_pack', JSON.stringify({ packId: payload.packId, createdAt: payload.createdAt, createdBy: payload.createdBy, schedules: payload.schedules, loadedAt: new Date().toISOString() }));
        setMeta('exam_pack_key', `${salt.toString('base64')}:${key.toString('base64')}`);
        setMeta('exam_results_exported_at', '');
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    return {
      papers: payload.tables.cbt_schedule_subjects.length,
      students: payload.tables.students.length,
      questions: payload.tables.cbt_questions.length,
    };
  }
  const currentPack = () => { try { return JSON.parse(valueFromMeta('exam_pack', '') || 'null'); } catch { return null; } };

  function papersOverview() {
    return all(`
      SELECT ss.id, ss.status, ss.duration_minutes AS durationMinutes, ss.exam_date AS examDate, ss.exam_time AS examTime,
             ss.class_code AS classCode, c.label AS classLabel, ca.name AS armName, sub.name AS subjectName, sc.title AS scheduleTitle,
             (SELECT COUNT(*) FROM cbt_questions q WHERE q.class_code = ss.class_code AND q.subject_id = ss.subject_id
                AND q.question_type = 'Multiple Choice Question' AND q.vetted = 1 AND q.archived = 0) AS questions,
             (SELECT COUNT(*) FROM students st WHERE st.class_code = ss.class_code AND (ss.class_arm_id IS NULL OR st.class_arm_id = ss.class_arm_id)) AS pupils,
             (SELECT COUNT(*) FROM cbt_attempts a WHERE a.schedule_subject_id = ss.id) AS started,
             (SELECT COUNT(*) FROM cbt_attempts a WHERE a.schedule_subject_id = ss.id AND a.submitted_at IS NOT NULL) AS submitted
      FROM cbt_schedule_subjects ss
      JOIN classes c ON c.code = ss.class_code
      JOIN subjects sub ON sub.id = ss.subject_id
      JOIN cbt_schedules sc ON sc.id = ss.schedule_id
      LEFT JOIN class_arms ca ON ca.id = ss.class_arm_id
      ORDER BY ss.exam_date, ss.exam_time, c.label, sub.name`);
  }

  function resultsFile() {
    const stored = valueFromMeta('exam_pack_key', '');
    const pack = currentPack();
    if (!stored || !pack) throw new Error('No exam pack is loaded');
    const [saltB64, keyB64] = stored.split(':');
    const attempts = all(`SELECT a.id, a.schedule_subject_id AS scheduleSubjectId, a.student_id AS studentId, a.started_at AS startedAt,
                                 a.submitted_at AS submittedAt, s.score, s.total_marks AS totalMarks
                          FROM cbt_attempts a LEFT JOIN cbt_scores s ON s.schedule_subject_id = a.schedule_subject_id AND s.student_id = a.student_id`);
    const submitted = attempts.filter(a => a.submittedAt).map(a => ({
      scheduleSubjectId: a.scheduleSubjectId, studentId: a.studentId, startedAt: a.startedAt, submittedAt: a.submittedAt,
      score: a.score, totalMarks: a.totalMarks,
      answers: all('SELECT question_id, selected_option FROM cbt_attempt_answers WHERE attempt_id = ?', a.id).map(r => [r.question_id, r.selected_option]),
    }));
    const payload = {
      format: RESULTS_FORMAT, version: 1, packId: pack.packId, exportedAt: new Date().toISOString(),
      attempts: submitted,
      notSubmitted: attempts.filter(a => !a.submittedAt).map(a => ({ scheduleSubjectId: a.scheduleSubjectId, studentId: a.studentId })),
    };
    setMeta('exam_results_exported_at', payload.exportedAt);
    return { file: sealWithKey(RESULTS_FORMAT, payload, Buffer.from(keyB64, 'base64'), Buffer.from(saltB64, 'base64')), count: submitted.length };
  }

  // ── Routes ──
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    try {
      // ONLINE PORTAL
      if (!EXAM_MODE && p.startsWith('/api/admin/cbt/offline/')) {
        const admin = requireUser(req, res, 'admin');
        if (!admin) return true;
        if (m === 'GET' && p === '/api/admin/cbt/offline/overview') {
          const schedules = all(`SELECT sc.id, sc.title, sc.session_label AS session, sc.term_label AS term, sc.start_date AS startDate,
                                        (SELECT COUNT(*) FROM cbt_schedule_subjects ss WHERE ss.schedule_id = sc.id AND ss.mode = 'Computer Based') AS papers
                                 FROM cbt_schedules sc WHERE sc.archived = 0 ORDER BY sc.id DESC`);
          const packs = all(`SELECT p.*, u.name AS createdByName FROM cbt_offline_packs p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.created_at DESC LIMIT 30`);
          return sendJson(res, 200, { schedules, packs }), true;
        }
        if (m === 'POST' && p === '/api/admin/cbt/offline/pack') {
          const body = await readJson(req);
          checkPassphrase(body.passphrase);
          const { packId, payload, summary } = buildPack(Array.isArray(body.scheduleIds) ? body.scheduleIds : [], admin);
          const { file } = seal(PACK_FORMAT, payload, body.passphrase);
          run(`INSERT INTO cbt_offline_packs (id, created_at, created_by, schedule_ids, paper_count, student_count, question_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)`, packId, payload.createdAt, admin.id, JSON.stringify(body.scheduleIds), summary.papers, summary.students, summary.questions);
          return sendFile(res, `cbt-exam-pack-${today()}.ucscbt`, file), true;
        }
        // The Windows app and Setup wizard are built into dist/ when the portal is deployed
        if (m === 'GET' && p === '/api/admin/cbt/offline/app-info') {
          const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'exam-app.json'), 'utf8')); } catch { return null; } })();
          const size = name => { try { return fs.statSync(path.join(ROOT, 'dist', name)).size; } catch { return 0; } };
          return sendJson(res, 200, { info, appSize: size('UCS Exam Server.exe'), setupSize: size('UCS Exam Server Setup.exe') }), true;
        }
        const appMatch = { '/api/admin/cbt/offline/app.exe': 'UCS Exam Server.exe', '/api/admin/cbt/offline/setup.exe': 'UCS Exam Server Setup.exe' }[p];
        if (m === 'GET' && appMatch) {
          const file = path.join(ROOT, 'dist', appMatch);
          let stat;
          try { stat = fs.statSync(file); } catch { return sendJson(res, 404, { error: 'The Windows app is built when the portal is deployed and isn\'t on this server yet. Use the zip kit for now.' }), true; }
          res.writeHead(200, { 'Content-Type': 'application/vnd.microsoft.portable-executable', 'Content-Disposition': `attachment; filename="${appMatch}"`, 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
          fs.createReadStream(file).pipe(res);
          return true;
        }
        if (m === 'GET' && p === '/api/admin/cbt/offline/kit.zip') {
          return sendFile(res, 'ucs-exam-server.zip', zipFiles(kitFiles()), 'application/zip'), true;
        }
        if (m === 'POST' && p === '/api/admin/cbt/offline/results') {
          const body = await readJson(req);
          const report = importResults(fileFromDataUrl(body.fileDataUrl), body.passphrase, admin);
          return sendJson(res, 200, { ok: true, report }), true;
        }
        return false;
      }

      // EXAM COMPUTER
      if (!p.startsWith('/api/exam/')) return false;
      if (!EXAM_MODE) return sendJson(res, 404, { error: 'Not found' }), true;
      const hasUsers = !!one('SELECT id FROM users LIMIT 1');
      if (m === 'GET' && p === '/api/exam/status') {
        return sendJson(res, 200, { examMode: true, setUp: hasUsers && !!currentPack(), pack: currentPack(), lanAddresses: lanAddresses(), exportedAt: valueFromMeta('exam_results_exported_at', '') || null }), true;
      }
      if (m === 'POST' && p === '/api/exam/import') {
        // the very first load happens before any admin exists on this computer
        const admin = hasUsers ? requireUser(req, res, 'admin') : { id: 'setup' };
        if (!admin) return true;
        const body = await readJson(req);
        const unexported = one('SELECT COUNT(*) c FROM cbt_attempts WHERE submitted_at IS NOT NULL').c;
        if (unexported && !valueFromMeta('exam_results_exported_at', '') && !body.replaceResults) {
          return sendJson(res, 409, { error: `This computer holds ${unexported} submitted exam${unexported === 1 ? '' : 's'} that have not been exported. Export the results first, or tick "replace" to discard them.` }), true;
        }
        const loaded = loadPack(fileFromDataUrl(body.fileDataUrl), body.passphrase);
        return sendJson(res, 200, { ok: true, loaded, pack: currentPack() }), true;
      }
      const admin = requireUser(req, res, 'admin');
      if (!admin) return true;
      if (m === 'GET' && p === '/api/exam/overview') {
        return sendJson(res, 200, { pack: currentPack(), papers: papersOverview(), lanAddresses: lanAddresses(), exportedAt: valueFromMeta('exam_results_exported_at', '') || null }), true;
      }
      const statusMatch = p.match(/^\/api\/exam\/papers\/(\d+)\/status$/);
      if (m === 'POST' && statusMatch) {
        const id = Number(statusMatch[1]);
        const status = cleanText((await readJson(req)).status);
        if (!['upcoming', 'live', 'closed'].includes(status)) return sendJson(res, 400, { error: 'Choose a status' }), true;
        if (!one('SELECT id FROM cbt_schedule_subjects WHERE id = ?', id)) return sendJson(res, 404, { error: 'Paper not found' }), true;
        run('UPDATE cbt_schedule_subjects SET status = ? WHERE id = ?', status, id);
        let autoSubmitted = 0;
        // closing a paper hands in everyone still writing it
        if (status === 'closed') {
          for (const a of all('SELECT id, student_id AS studentId FROM cbt_attempts WHERE schedule_subject_id = ? AND submitted_at IS NULL', id)) {
            markCbtAttempt(id, a.studentId, a.id, admin.id);
            autoSubmitted++;
          }
        }
        return sendJson(res, 200, { ok: true, autoSubmitted }), true;
      }
      const pupilsMatch = p.match(/^\/api\/exam\/papers\/(\d+)\/pupils$/);
      if (m === 'GET' && pupilsMatch) {
        const id = Number(pupilsMatch[1]);
        const ss = one('SELECT class_code AS classCode, class_arm_id AS armId FROM cbt_schedule_subjects WHERE id = ?', id);
        if (!ss) return sendJson(res, 404, { error: 'Paper not found' }), true;
        const pupils = all(`
          SELECT st.id, st.name, a.started_at AS startedAt, a.submitted_at AS submittedAt, s.score, s.total_marks AS totalMarks,
                 (SELECT COUNT(*) FROM cbt_attempt_answers x WHERE x.attempt_id = a.id AND x.selected_option IS NOT NULL) AS answered
          FROM students st
          LEFT JOIN cbt_attempts a ON a.schedule_subject_id = ? AND a.student_id = st.id
          LEFT JOIN cbt_scores s ON s.schedule_subject_id = ? AND s.student_id = st.id
          WHERE st.class_code = ? AND (? IS NULL OR st.class_arm_id = ?)
          ORDER BY st.name`, id, id, ss.classCode, ss.armId, ss.armId);
        return sendJson(res, 200, { pupils }), true;
      }
      const resetMatch = p.match(/^\/api\/exam\/papers\/(\d+)\/reset$/);
      if (m === 'POST' && resetMatch) {
        const id = Number(resetMatch[1]);
        const studentId = cleanText((await readJson(req)).studentId);
        run('DELETE FROM cbt_scores WHERE schedule_subject_id = ? AND student_id = ?', id, studentId);
        run('DELETE FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', id, studentId);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'GET' && p === '/api/exam/results-file') {
        const { file } = resultsFile();
        return sendFile(res, `cbt-results-${today()}.ucsres`, file), true;
      }
      return sendJson(res, 404, { error: 'Not found' }), true;
    } catch (err) {
      return sendJson(res, 400, { error: err.message }), true;
    }
  }

  return { createSchema, handle };
}

const KIT_GUIDE = `UNIQUE CHILDREN'S SCHOOL — OFFLINE CBT EXAM SERVER
==================================================

This lets pupils write their CBT on the school's own Wi-Fi/LAN, with no
internet needed while the exam runs. Questions are still set on the online
portal; results go back to the online portal afterwards.

WHAT YOU NEED
- One computer to be the exam server (a normal laptop is fine).
- A Wi-Fi router or network switch. It does NOT need internet.
- Devices for pupils (computer lab, tablets or phones) with a web browser.

ONE-TIME SETUP (on the exam computer)
1. Install Node.js 24 LTS from https://nodejs.org (accept the defaults).
2. Unzip this folder somewhere permanent, e.g. Documents\\ucs-exam-server.

BEFORE EACH EXAM (needs internet, on any computer)
1. Sign in to the online portal as admin.
2. E-Class > CBT > Offline CBT (LAN) > tick the CBT schedule(s) > choose a
   passphrase > Download Exam Pack. Keep the passphrase safe: the pack holds
   the questions, answers and pupils' sign-in details.
3. Copy the .ucscbt file to the exam computer (USB stick is fine).

ON EXAM DAY (no internet needed)
1. Connect the exam computer to the school router/Wi-Fi.
2. Double-click START-EXAM-SERVER.bat. Leave that black window open for the
   whole exam. If Windows Firewall asks, click "Allow access" (Private
   networks).
3. The Exam Console opens in the browser by itself after a few seconds.
   (Closed it? Double-click "OPEN EXAM CONSOLE" in this folder.)
   The first time, load the exam pack (choose the file, type the passphrase).
4. Sign in with your normal admin ID and password. The Exam Console shows the
   address pupils should open, e.g. http://192.168.0.10:8080
5. Pupils connect to the same Wi-Fi, open that address, choose Pupil and sign
   in with their usual ID (or email) and password.
6. In the Exam Console, click "Open" on a paper when it's time to start, and
   "Close" when it ends. Closing hands in any paper still being written.
   You can watch who has started/finished, and allow a retake if needed.

AFTER THE EXAM
1. In the Exam Console click "Export Results". Copy the .ucsres file to a
   computer with internet.
2. Online portal > E-Class > CBT > Offline CBT (LAN) > Upload Results >
   choose the file > same passphrase. Scores appear in CBT Scores and the CBT
   Grade Book, like an online CBT.

TIPS
- Keep the exam computer plugged in and stop it from sleeping during exams.
- If a pupil's device drops off the Wi-Fi, their answers are kept on that
  device and sent again automatically when it reconnects.
- If the exam computer restarts, double-click START-EXAM-SERVER.bat again;
  nothing is lost. Pupils just sign in again and continue.
`;

// The portal files an exam computer needs (app files, report assets and
// libraries), as [relative path, contents]. Shared by the zip kit and the
// Windows exam-server app build (exam-app/build.js).
const KIT_SKIP = /(^|\/)(\.git|\.claude|backups|uploads|published_reports|exam-data|exam-app|dist)(\/|$)|\.codex-backup-|\.sqlite|email-settings\.env|^node_modules\/pdf-lib\/(dist|es|src)\/|^node_modules\/(postject|resedit|pe-library|commander|\.bin)\/|^node_modules\/\.package-lock\.json$|\.map$|\.d\.ts$/;
function appFiles(root) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (KIT_SKIP.test(childRel)) continue;
      if (entry.isDirectory()) {
        if (!rel && !['report_assets', 'node_modules'].includes(entry.name)) continue;
        walk(childRel);
      } else if (rel || /\.(html|js|css|json)$/.test(entry.name)) {
        out.push([childRel, fs.readFileSync(path.join(root, childRel))]);
      }
    }
  };
  walk('');
  return out;
}

module.exports = { createCbtOffline, appFiles, KIT_GUIDE };
