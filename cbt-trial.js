// CBT trial runs: checking the questions, the exam server and the network.
// Online portal:  teachers (their own classes and subjects) and admins (any)
//                 "Try as a pupil": the real exam screen with nothing saved,
//                 then a report of each answer picked next to the one marked
//                 correct, with warnings for badly made questions.
// Exam computer:  (EXAM_MODE) IT opens papers in trial mode and registers
//                 testers: trial accounts 9001, 9002 … (password 1234) that
//                 see every trial paper and nothing else. Trial attempts live
//                 in their own table, so they never reach the grade book or
//                 the portal, and are cleared with one click. /check lets any
//                 pupil computer test its connection, and the Trial Run page
//                 lists every computer that has connected.
const TRIAL_PASSWORD = '1234';
// Made once on each exam computer: 9001–9010 are teachers, each seeing only their own
// classes and subjects; 9011 is Mr. Chima, the IT tester, who sees every trial paper
const DEFAULT_TESTERS = [
  [9001, 'MISS EDDY'], [9002, 'MERCY'], [9003, 'JOSEPH'], [9004, 'KEHINDE'], [9005, 'MR ADEYEMI'],
  [9006, 'MR DANIEL'], [9007, 'Olaniyi Gbenga'], [9008, 'EZEJI'], [9009, 'HARUNA'], [9010, 'HELEN'],
  [9011, 'MR. CHIMA', 'it'],
];
const DEFAULTS_VERSION = '2'; // 1: "Tester 1" … "Tester 10", not linked to anyone
// A tester waiting for their teacher to be copied to this computer holds the name
// here instead of an ID: it matches no assignments, so they see nothing until linked
const PENDING = 'name:';
const LETTER = i => String.fromCharCode(65 + i);

function createCbtTrial(deps) {
  const {
    db, one, all, run, ensureColumn, cleanText, readJson, sendJson, requireUser, sessionUser, hashPassword,
    initialsFromName, firstNameFromName, valueFromMeta, setMeta, EXAM_MODE, cbtOffline,
  } = deps;

  function createSchema() {
    ensureColumn('users', 'trial', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('users', 'trial_teacher_id', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS trial_attempts (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        paper_id INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        submitted_at TEXT,
        answers TEXT NOT NULL DEFAULT '{}',
        score REAL,
        total_marks REAL
      );
    `);
    // Once, online: the test pupils 9001–9010 made before trial accounts existed
    // are archived, so they leave class lists and counts and are no longer copied
    // to exam computers (which make their own trial accounts 9001–9010 instead).
    // Un-archive them on View Students to bring them back.
    if (!EXAM_MODE && !valueFromMeta('test_pupils_archived', '')) {
      run(`UPDATE students SET archived = 1 WHERE id IN (
             SELECT id FROM users WHERE role = 'student' AND username GLOB '90[0-9][0-9]' AND COALESCE(trial, 0) = 0)`);
      setMeta('test_pupils_archived', '1');
    }
  }

  // ── questions, and the report that checks them ──
  // The same questions, in the same order, as pupils are served
  function paperQuestions(classCode, subjectId) {
    return all(
      `SELECT id, question_text AS questionText, marks, options FROM cbt_questions
       WHERE class_code = ? AND subject_id = ? AND question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0
       ORDER BY id`,
      classCode, subjectId
    ).map(q => {
      let options = [];
      try { options = q.options ? JSON.parse(q.options) : []; } catch { options = []; }
      return { ...q, options: Array.isArray(options) ? options : [] };
    });
  }
  const forPupil = qs => qs.map(q => ({ id: q.id, questionText: q.questionText, marks: q.marks, options: q.options.map(o => o?.text ?? '') }));
  const correctOf = q => q.options.map((o, i) => (o?.correct ? i : -1)).filter(i => i >= 0);

  function questionWarnings(q) {
    const warnings = [];
    if (!String(q.questionText || '').trim()) warnings.push('The question has no text');
    const texts = q.options.map(o => String(o?.text ?? '').trim());
    if (texts.length < 2) warnings.push('It has fewer than 2 answers to choose from');
    texts.forEach((t, i) => { if (!t) warnings.push(`Answer ${LETTER(i)} is empty`); });
    const seen = new Map();
    texts.forEach((t, i) => {
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      if (!key) return;
      if (seen.has(key)) warnings.push(`Answers ${LETTER(seen.get(key))} and ${LETTER(i)} are the same`);
      else seen.set(key, i);
    });
    const correct = correctOf(q);
    if (!correct.length) warnings.push('No answer is marked correct');
    else if (correct.length > 1) warnings.push(`More than one answer is marked correct (${correct.map(LETTER).join(', ')})`);
    return warnings;
  }

  // picked: Map of question id → chosen option (index)
  function review(questions, picked) {
    let score = 0;
    let totalMarks = 0;
    const items = questions.map((q, n) => {
      const correct = correctOf(q);
      const p = picked.has(q.id) && picked.get(q.id) !== null ? Number(picked.get(q.id)) : null;
      totalMarks += Number(q.marks) || 0;
      if (p !== null && q.options[p]?.correct) score += Number(q.marks) || 0;
      return {
        number: n + 1, id: q.id, questionText: q.questionText, marks: q.marks, options: q.options.map(o => String(o?.text ?? '')),
        correct, picked: p, status: p === null ? 'skipped' : correct.includes(p) ? 'match' : 'mismatch', warnings: questionWarnings(q),
      };
    });
    return { score, totalMarks, items };
  }

  const paperStats = (classCode, subjectId) => one(
    `SELECT COUNT(*) AS questionCount, COALESCE(SUM(marks), 0) AS paperMarks FROM cbt_questions
     WHERE class_code = ? AND subject_id = ? AND question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0`,
    classCode, subjectId
  );

  // ── ONLINE: Try as a pupil (teachers and admins) ──
  function tryUser(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (!['teacher', 'admin'].includes(user.role)) { sendJson(res, 403, { error: 'Only teachers and admins can try questions' }); return null; }
    return user;
  }
  function tryPapers(user) {
    const rows = user.role === 'admin'
      ? all(`SELECT DISTINCT q.class_code AS classCode, q.subject_id AS subjectId, c.label AS classLabel, s.name AS subjectName
             FROM cbt_questions q JOIN classes c ON c.code = q.class_code JOIN subjects s ON s.id = q.subject_id
             WHERE q.archived = 0 AND q.question_type = 'Multiple Choice Question' ORDER BY c.rowid, s.name`)
      : all(`SELECT DISTINCT ta.class_code AS classCode, ta.subject_id AS subjectId, c.label AS classLabel, s.name AS subjectName
             FROM teacher_assignments ta JOIN classes c ON c.code = ta.class_code JOIN subjects s ON s.id = ta.subject_id
             WHERE ta.teacher_id = ? ORDER BY c.rowid, s.name`, user.id);
    return rows.map(r => {
      const stats = paperStats(r.classCode, r.subjectId);
      const latest = one(`SELECT duration_minutes AS d FROM cbt_schedule_subjects WHERE class_code = ? AND subject_id = ? AND mode = 'Computer Based'
                          ORDER BY id DESC LIMIT 1`, r.classCode, r.subjectId);
      return { id: `${r.classCode}-${r.subjectId}`, ...r, ...stats, durationMinutes: latest?.d || null, mine: true };
    });
  }
  function tryPaper(user, key) {
    const m = String(key).match(/^([A-Za-z0-9]+)-(\d+)$/);
    if (!m) return null;
    const [, classCode, subjectId] = [m[0], m[1].toUpperCase(), Number(m[2])];
    if (user.role !== 'admin' && !one('SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_code = ? AND subject_id = ?', user.id, classCode, subjectId)) return null;
    return { classCode, subjectId };
  }

  // ── EXAM COMPUTER: trial papers, testers, attempts ──
  const trialPaperIds = () => {
    try { return new Set(JSON.parse(valueFromMeta('trial_papers', '[]'))); } catch { return new Set(); }
  };
  const saveTrialPaperIds = ids => setMeta('trial_papers', JSON.stringify([...ids]));
  const paperRow = id => one(
    `SELECT ss.id, ss.class_code AS classCode, ss.subject_id AS subjectId, ss.duration_minutes AS durationMinutes,
            c.label AS classLabel, s.name AS subjectName, sc.title AS scheduleTitle
     FROM cbt_schedule_subjects ss JOIN classes c ON c.code = ss.class_code JOIN subjects s ON s.id = ss.subject_id
     LEFT JOIN cbt_schedules sc ON sc.id = ss.schedule_id WHERE ss.id = ?`, id);

  function trialUser(req, res) {
    const user = requireUser(req, res, 'student');
    if (!user) return null;
    if (!user.trial) { sendJson(res, 403, { error: 'Only trial accounts can take trial papers' }); return null; }
    return user;
  }
  // A tester linked to a teacher sees only that teacher's own class and subject papers (a
  // class teacher: every subject of their class; a subject teacher: their subject in each
  // class). Testers not linked to a teacher (IT, 9001–9010) see every trial paper.
  function papersFor(user, ids) {
    const papers = [...ids].map(paperRow).filter(Boolean);
    if (!user.trial_teacher_id) return papers;
    const allowed = new Set(all("SELECT class_code || '-' || subject_id AS k FROM teacher_assignments WHERE teacher_id = ?", user.trial_teacher_id).map(r => r.k));
    return papers.filter(p => allowed.has(`${p.classCode}-${p.subjectId}`));
  }
  function openAttempt(userId, paperId) {
    return one('SELECT * FROM trial_attempts WHERE user_id = ? AND paper_id = ? AND submitted_at IS NULL ORDER BY id DESC LIMIT 1', userId, paperId);
  }
  const deadlineOf = (attempt, paper) => new Date(attempt.started_at).getTime() + paper.durationMinutes * 60000;
  const answersOf = attempt => { try { return JSON.parse(attempt.answers || '{}'); } catch { return {}; } };

  function makeTester(username, name, teacherId) {
    run(`INSERT INTO users (id, role, password, name, first_name, initials, active, trial, trial_teacher_id, username)
         VALUES (?, 'student', ?, ?, ?, ?, 1, 1, ?, ?)`,
      `TRIAL-${username}`, hashPassword(TRIAL_PASSWORD), name, firstNameFromName(name), initialsFromName(name), teacherId || null, String(username));
    return { id: `TRIAL-${username}`, username: String(username), name, password: TRIAL_PASSWORD };
  }
  const usernameFree = n => !one('SELECT id FROM users WHERE LOWER(username) = ? OR id = ?', String(n), `TRIAL-${n}`);
  function createTester(name, teacherId) {
    const teacher = teacherId ? one("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", teacherId) : null;
    const full = cleanText(name) || teacher?.name || '';
    if (!full) throw new Error('Type a name or pick a teacher');
    let n = 9001;
    while (!usernameFree(n)) n++;
    return makeTester(n, full, teacher?.id);
  }
  // The default testers are made once on each exam computer (a pupil copied from the
  // portal with one of those usernames is left alone; that tester is made next time).
  // Computers that already made "Tester 1" … "Tester 10" have them renamed and linked.
  // Then, every time, testers still waiting for their teacher are linked if the
  // teacher is now on this computer (after Refresh Data).
  function ensureDefaultTesters() {
    if (!EXAM_MODE) return;
    if (valueFromMeta('trial_seeded', '') !== DEFAULTS_VERSION) {
      let done = 0;
      DEFAULT_TESTERS.forEach(([n, name, it], i) => {
        const link = it ? null : `${PENDING}${name}`;
        const existing = one('SELECT id, name FROM users WHERE id = ?', `TRIAL-${n}`);
        if (existing) {
          if (existing.name === `Tester ${i + 1}`) {
            run('UPDATE users SET name = ?, first_name = ?, initials = ?, trial_teacher_id = ? WHERE id = ?',
              name, firstNameFromName(name), initialsFromName(name), link, existing.id);
          }
          done++;
        } else if (it && !usernameFree(n)) {
          // the IT tester's usual number is taken: next free one instead
          let m = n;
          while (!usernameFree(m)) m++;
          makeTester(m, name, link);
          done++;
        } else if (usernameFree(n)) {
          makeTester(n, name, link);
          done++;
        }
      });
      if (done === DEFAULT_TESTERS.length) setMeta('trial_seeded', DEFAULTS_VERSION);
    }
    for (const t of all('SELECT id, trial_teacher_id AS link FROM users WHERE trial = 1 AND trial_teacher_id LIKE ?', `${PENDING}%`)) {
      const teacher = one("SELECT id FROM users WHERE role IN ('teacher', 'staff') AND LOWER(TRIM(name)) = LOWER(TRIM(?))", t.link.slice(PENDING.length));
      if (teacher) run('UPDATE users SET trial_teacher_id = ? WHERE id = ?', teacher.id, t.id);
    }
  }
  function removeTester(id) {
    run('DELETE FROM trial_attempts WHERE user_id = ?', id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
    run('DELETE FROM users WHERE id = ? AND trial = 1', id);
  }

  // ── EXAM COMPUTER: who has connected (for the network check) ──
  const connections = new Map(); // address → { ip, via, user, lastSeen, firstSeen, rtt, rttMax, requests }
  const bare = a => String(a || '').replace(/^::ffff:/, '');
  function viaOf(req) {
    const local = bare(req.socket?.localAddress);
    const net = cbtOffline.lanNetworks().find(n => n.url.includes(`//${local}:`) || n.url.endsWith(`//${local}`));
    return net?.label || 'Network';
  }
  function track(req, url) {
    if (!EXAM_MODE) return;
    const ip = bare(req.socket?.remoteAddress);
    if (!ip || ip === '127.0.0.1' || ip === '::1') return;
    const now = Date.now();
    const entry = connections.get(ip) || { ip, firstSeen: now, requests: 0, rtt: null, rttMax: null, user: null };
    entry.lastSeen = now;
    entry.via = viaOf(req);
    entry.requests++;
    const user = sessionUser(req);
    if (user) entry.user = { id: user.id, name: user.name, username: user.username || '', trial: !!user.trial, role: user.role };
    if (url.pathname === '/api/check/ping') {
      const rtt = Number(url.searchParams.get('rtt'));
      if (Number.isFinite(rtt) && rtt >= 0) { entry.rtt = Math.round(rtt); entry.rttMax = Math.max(entry.rttMax || 0, entry.rtt); }
    }
    connections.set(ip, entry);
    if (connections.size > 500) connections.delete(connections.keys().next().value);
  }
  const connectionList = () => [...connections.values()].sort((a, b) => b.lastSeen - a.lastSeen)
    .map(c => ({ ...c, secondsAgo: Math.round((Date.now() - c.lastSeen) / 1000) }));

  async function handle(req, res, url) {
    const m = req.method;
    const p = url.pathname;

    // ── ONLINE (and on the exam computer for admins): Try as a pupil ──
    if (p.startsWith('/api/cbt-try/')) {
      const user = tryUser(req, res);
      if (!user) return true;
      if (m === 'GET' && p === '/api/cbt-try/papers') {
        return sendJson(res, 200, { student: { name: user.name, classLabel: '' }, exams: tryPapers(user) }), true;
      }
      const startMatch = p.match(/^\/api\/cbt-try\/papers\/([^/]+)\/(start|check)$/);
      if (m === 'POST' && startMatch) {
        const paper = tryPaper(user, decodeURIComponent(startMatch[1]));
        if (!paper) return sendJson(res, 404, { error: 'You can only try questions for your own classes and subjects' }), true;
        const questions = paperQuestions(paper.classCode, paper.subjectId);
        if (startMatch[2] === 'start') return sendJson(res, 200, { attemptId: 0, questions: forPupil(questions), answers: [] }), true;
        const body = await readJson(req);
        const picked = new Map((Array.isArray(body.answers) ? body.answers : []).map(([q, o]) => [Number(q), o === null ? null : Number(o)]));
        const result = review(questions, picked);
        return sendJson(res, 200, { ok: true, score: result.score, totalMarks: result.totalMarks, review: result.items }), true;
      }
      return sendJson(res, 404, { error: 'Not found' }), true;
    }

    if (!EXAM_MODE) return false;

    // ── EXAM COMPUTER: connection check (no sign-in needed) ──
    if (m === 'GET' && p === '/api/check/ping') {
      return sendJson(res, 200, { ok: true, via: viaOf(req), ip: bare(req.socket?.remoteAddress), serverTime: Date.now() }), true;
    }

    // ── EXAM COMPUTER: testers sitting trial papers ──
    if (p.startsWith('/api/trial/')) {
      const user = trialUser(req, res);
      if (!user) return true;
      const ids = trialPaperIds();
      if (m === 'GET' && p === '/api/trial/papers') {
        const exams = papersFor(user, ids).map(paper => {
          const last = one('SELECT score, total_marks AS totalMarks FROM trial_attempts WHERE user_id = ? AND paper_id = ? AND submitted_at IS NOT NULL ORDER BY id DESC LIMIT 1', user.id, paper.id);
          const open = openAttempt(user.id, paper.id);
          return {
            ...paper, ...paperStats(paper.classCode, paper.subjectId), status: 'live', mine: !!user.trial_teacher_id,
            attemptStatus: open && Date.now() < deadlineOf(open, paper) ? 'in_progress' : 'not_started',
            lastScore: last ? last.score : null, lastTotal: last ? last.totalMarks : null, instructions: [],
          };
        });
        const order = new Map(all('SELECT code FROM classes ORDER BY rowid').map((c, i) => [c.code, i]));
        exams.sort((a, b) => (b.mine - a.mine) || ((order.get(a.classCode) ?? 99) - (order.get(b.classCode) ?? 99)) || a.subjectName.localeCompare(b.subjectName));
        return sendJson(res, 200, { student: { name: user.name, classLabel: '' }, exams }), true;
      }
      const action = p.match(/^\/api\/trial\/papers\/(\d+)\/(start|answer|submit)$/);
      if (m !== 'POST' || !action) return sendJson(res, 404, { error: 'Not found' }), true;
      const paperId = Number(action[1]);
      const paper = papersFor(user, ids).find(x => x.id === paperId);
      if (!paper) return sendJson(res, 404, { error: 'This paper is not open for you in the trial' }), true;
      let attempt = openAttempt(user.id, paperId);
      if (action[2] === 'start') {
        // a fresh try each time, unless one is still running
        if (!attempt || Date.now() > deadlineOf(attempt, paper)) {
          if (attempt) run('UPDATE trial_attempts SET submitted_at = ? WHERE id = ?', new Date().toISOString(), attempt.id);
          const id = Number(run('INSERT INTO trial_attempts (user_id, paper_id, started_at) VALUES (?, ?, ?)', user.id, paperId, new Date().toISOString()).lastInsertRowid);
          attempt = one('SELECT * FROM trial_attempts WHERE id = ?', id);
        }
        const answers = Object.entries(answersOf(attempt)).map(([questionId, selectedOption]) => ({ questionId: Number(questionId), selectedOption }));
        return sendJson(res, 200, {
          attemptId: attempt.id, startedAt: attempt.started_at, durationMinutes: paper.durationMinutes,
          deadline: new Date(deadlineOf(attempt, paper)).toISOString(), questions: forPupil(paperQuestions(paper.classCode, paper.subjectId)), answers,
        }), true;
      }
      if (!attempt) return sendJson(res, 409, { error: 'This trial paper has already been handed in' }), true;
      if (action[2] === 'answer') {
        if (Date.now() > deadlineOf(attempt, paper) + 120000) return sendJson(res, 410, { error: 'Time is up for this paper' }), true;
        const body = await readJson(req);
        const answers = answersOf(attempt);
        const option = body.selectedOption === null || body.selectedOption === undefined ? null : Number(body.selectedOption);
        if (option === null) delete answers[Number(body.questionId)];
        else answers[Number(body.questionId)] = option;
        run('UPDATE trial_attempts SET answers = ? WHERE id = ?', JSON.stringify(answers), attempt.id);
        return sendJson(res, 200, { ok: true }), true;
      }
      const result = review(paperQuestions(paper.classCode, paper.subjectId), new Map(Object.entries(answersOf(attempt)).map(([q, o]) => [Number(q), o])));
      run('UPDATE trial_attempts SET submitted_at = ?, score = ?, total_marks = ? WHERE id = ?', new Date().toISOString(), result.score, result.totalMarks, attempt.id);
      return sendJson(res, 200, { ok: true, score: result.score, totalMarks: result.totalMarks, review: result.items }), true;
    }

    // ── EXAM COMPUTER: the Trial Run page (admins) ──
    if (!p.startsWith('/api/exam/trial')) return false;
    const admin = requireUser(req, res, 'admin');
    if (!admin) return true;
    if (m === 'GET' && p === '/api/exam/trial') {
      ensureDefaultTesters();
      const ids = trialPaperIds();
      const papers = all(`SELECT ss.id, c.label AS classLabel, s.name AS subjectName, sc.title AS scheduleTitle, ss.class_code AS classCode, ss.subject_id AS subjectId
                          FROM cbt_schedule_subjects ss JOIN classes c ON c.code = ss.class_code JOIN subjects s ON s.id = ss.subject_id
                          LEFT JOIN cbt_schedules sc ON sc.id = ss.schedule_id ORDER BY c.rowid, s.name`)
        .map(r => ({ ...r, questions: paperStats(r.classCode, r.subjectId).questionCount, trial: ids.has(r.id) }));
      const seen = new Map(connectionList().filter(c => c.user).map(c => [c.user.id, c]));
      const testers = all(`SELECT u.id, u.username, u.name, u.trial_teacher_id AS teacherId, t.name AS teacherName FROM users u
                           LEFT JOIN users t ON t.id = u.trial_teacher_id WHERE u.trial = 1 ORDER BY CAST(u.username AS INTEGER)`)
        .map(t => ({
          ...t, password: TRIAL_PASSWORD, secondsAgo: seen.get(t.id)?.secondsAgo ?? null,
          teacherName: !t.teacherId ? 'IT'
            : t.teacherId.startsWith(PENDING) ? `${t.teacherId.slice(PENDING.length)} (after Refresh Data)` : t.teacherName,
        }));
      const results = all(`SELECT a.id, u.username, u.name, c.label AS classLabel, s.name AS subjectName, a.score, a.total_marks AS totalMarks, a.submitted_at AS submittedAt
                           FROM trial_attempts a JOIN users u ON u.id = a.user_id JOIN cbt_schedule_subjects ss ON ss.id = a.paper_id
                           JOIN classes c ON c.code = ss.class_code JOIN subjects s ON s.id = ss.subject_id
                           WHERE a.submitted_at IS NOT NULL AND a.score IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 200`);
      const teachers = all("SELECT id, name FROM users WHERE role = 'teacher' ORDER BY name COLLATE NOCASE");
      return sendJson(res, 200, { papers, testers, results, teachers, connections: connectionList(), lanNetworks: cbtOffline.lanNetworks() }), true;
    }
    const paperToggle = p.match(/^\/api\/exam\/trial\/papers\/(\d+|all)$/);
    if (m === 'POST' && paperToggle) {
      const on = !!(await readJson(req)).on;
      const ids = trialPaperIds();
      const targets = paperToggle[1] === 'all' ? all('SELECT id FROM cbt_schedule_subjects').map(r => r.id) : [Number(paperToggle[1])];
      targets.forEach(id => (on ? ids.add(id) : ids.delete(id)));
      saveTrialPaperIds(ids);
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/exam/trial/testers') {
      const body = await readJson(req);
      const list = (Array.isArray(body.testers) ? body.testers : []).slice(0, 200);
      if (!list.length) return sendJson(res, 400, { error: 'Add at least one tester' }), true;
      try {
        db.exec('BEGIN');
        const created = list.map(t => createTester(t.name, t.teacherId));
        db.exec('COMMIT');
        return sendJson(res, 201, { ok: true, created }), true;
      } catch (err) {
        db.exec('ROLLBACK');
        return sendJson(res, 400, { error: err.message }), true;
      }
    }
    const removeMatch = p.match(/^\/api\/exam\/trial\/testers\/([^/]+)\/remove$/);
    if (m === 'POST' && removeMatch) {
      removeTester(decodeURIComponent(removeMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/exam/trial/testers/remove-all') {
      all('SELECT id FROM users WHERE trial = 1').forEach(u => removeTester(u.id));
      setMeta('trial_seeded', DEFAULTS_VERSION); // don't bring the default testers back
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/exam/trial/results/clear') {
      run('DELETE FROM trial_attempts');
      return sendJson(res, 200, { ok: true }), true;
    }
    return sendJson(res, 404, { error: 'Not found' }), true;
  }

  return { createSchema, handle, track, ensureDefaultTesters };
}

module.exports = { createCbtTrial };
