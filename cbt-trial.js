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
    // What a tester can see, always chosen on purpose: 'teacher' (that teacher's own
    // classes and subjects), 'papers' (the class + subject pairs in trial_access),
    // 'all' (every trial paper: IT) or 'none' (not chosen yet: sees nothing)
    ensureColumn('users', 'trial_scope', 'TEXT');
    ensureColumn('users', 'trial_access', 'TEXT');
    // Testers from before this: linked ones keep their teacher, the IT tester keeps every
    // paper, and anyone else (who used to see every paper by default) waits for a choice
    const itNames = DEFAULT_TESTERS.filter(t => t[2]).map(t => t[1].toLowerCase());
    for (const t of all('SELECT id, name, trial_teacher_id AS link FROM users WHERE trial = 1 AND trial_scope IS NULL')) {
      run('UPDATE users SET trial_scope = ? WHERE id = ?', t.link ? 'teacher' : itNames.includes(String(t.name).trim().toLowerCase()) ? 'all' : 'none', t.id);
    }
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
  // The class + subject pairs ("Y2-14") a tester can see, or null for every paper.
  // A teacher's tester follows that teacher's assignments (a class teacher: the subjects
  // ticked for their class; a subject teacher: their subject in each of their classes),
  // so changing the assignments changes what the tester sees.
  const accessList = raw => { try { return (JSON.parse(raw || '[]') || []).map(String); } catch { return []; } };
  function testerKeys(user) {
    const scope = user.trial_scope || 'none';
    if (scope === 'all') return null;
    if (scope === 'papers') return new Set(accessList(user.trial_access));
    if (scope === 'teacher' && user.trial_teacher_id && !String(user.trial_teacher_id).startsWith(PENDING)) {
      return new Set(all("SELECT class_code || '-' || subject_id AS k FROM teacher_assignments WHERE teacher_id = ?", user.trial_teacher_id).map(r => r.k));
    }
    return new Set();
  }
  function papersFor(user, ids) {
    const papers = [...ids].map(paperRow).filter(Boolean);
    const keys = testerKeys(user);
    return keys ? papers.filter(p => keys.has(`${p.classCode}-${p.subjectId}`)) : papers;
  }
  // "Year 1: Mathematics, English · Year 3: Mathematics", for the Testers table
  function describeKeys(keys) {
    const byClass = new Map();
    for (const key of keys) {
      const [code, subjectId] = [key.slice(0, key.lastIndexOf('-')), key.slice(key.lastIndexOf('-') + 1)];
      const cls = one('SELECT label, rowid AS r FROM classes WHERE code = ?', code);
      const subject = one('SELECT name FROM subjects WHERE id = ?', Number(subjectId));
      if (!cls || !subject) continue;
      if (!byClass.has(code)) byClass.set(code, { label: cls.label, order: cls.r, subjects: [] });
      byClass.get(code).subjects.push(subject.name);
    }
    return [...byClass.values()].sort((a, b) => a.order - b.order)
      .map(c => `${c.label}: ${c.subjects.length > 3 ? `${c.subjects.length} subjects` : c.subjects.sort().join(', ')}`).join(' · ');
  }
  function canSee(t) {
    const scope = t.trial_scope || 'none';
    if (scope === 'all') return { label: 'Every paper', needsChoice: false };
    if (scope === 'teacher' && String(t.trial_teacher_id || '').startsWith(PENDING)) {
      return { label: `${String(t.trial_teacher_id).slice(PENDING.length)}'s papers, after Refresh Data`, needsChoice: false };
    }
    if (scope === 'none') return { label: 'Choose what they can see', needsChoice: true };
    const keys = testerKeys(t);
    return { label: describeKeys(keys) || (scope === 'teacher' ? 'Nothing: this teacher has no classes or subjects yet' : 'Nothing chosen'), needsChoice: !keys.size && scope === 'papers' };
  }
  // Checks a tester's access as sent from the Trial Run page
  function checkAccess({ scope, teacherId, access }) {
    if (scope === 'teacher') {
      const teacher = teacherId ? one("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", teacherId) : null;
      if (!teacher) throw new Error('Pick the teacher whose papers they see');
      return { scope, teacher, access: null };
    }
    if (scope === 'papers') {
      const keys = [...new Set((Array.isArray(access) ? access : []).map(String).filter(k => /^.+-\d+$/.test(k)))];
      if (!keys.length) throw new Error('Tick at least one paper they can see');
      return { scope, teacher: null, access: keys };
    }
    if (scope === 'all' || scope === 'none') return { scope, teacher: null, access: null };
    throw new Error('Choose what they can see');
  }
  function openAttempt(userId, paperId) {
    return one('SELECT * FROM trial_attempts WHERE user_id = ? AND paper_id = ? AND submitted_at IS NULL ORDER BY id DESC LIMIT 1', userId, paperId);
  }
  const deadlineOf = (attempt, paper) => new Date(attempt.started_at).getTime() + paper.durationMinutes * 60000;
  const answersOf = attempt => { try { return JSON.parse(attempt.answers || '{}'); } catch { return {}; } };

  function makeTester(username, name, teacherId, scope, access = null) {
    run(`INSERT INTO users (id, role, password, name, first_name, initials, active, trial, trial_teacher_id, trial_scope, trial_access, username)
         VALUES (?, 'student', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
      `TRIAL-${username}`, hashPassword(TRIAL_PASSWORD), name, firstNameFromName(name), initialsFromName(name), teacherId || null,
      scope, access ? JSON.stringify(access) : null, String(username));
    return { id: `TRIAL-${username}`, username: String(username), name, password: TRIAL_PASSWORD };
  }
  const usernameFree = n => !one('SELECT id FROM users WHERE LOWER(username) = ? OR id = ?', String(n), `TRIAL-${n}`);
  // Without a choice (a name in Add several that matches no teacher) a tester sees nothing
  // until one is made: never every paper by accident
  function createTester({ name, teacherId, scope, access }) {
    const chosen = checkAccess({ scope: scope || (teacherId ? 'teacher' : 'none'), teacherId, access });
    const full = cleanText(name) || chosen.teacher?.name || '';
    if (!full) throw new Error('Type the tester\'s name');
    let n = 9001;
    while (!usernameFree(n)) n++;
    return makeTester(n, full, chosen.teacher?.id, chosen.scope, chosen.access);
  }
  function setTesterAccess(id, body) {
    const tester = one('SELECT id FROM users WHERE id = ? AND trial = 1', id);
    if (!tester) throw new Error('That tester no longer exists');
    const chosen = checkAccess(body);
    run('UPDATE users SET trial_scope = ?, trial_teacher_id = ?, trial_access = ? WHERE id = ?',
      chosen.scope, chosen.teacher?.id || null, chosen.access ? JSON.stringify(chosen.access) : null, id);
    // a tester can't keep writing a paper they no longer see
    const keys = testerKeys(one('SELECT * FROM users WHERE id = ?', id));
    if (keys) {
      for (const a of all('SELECT a.id, ss.class_code AS c, ss.subject_id AS s FROM trial_attempts a JOIN cbt_schedule_subjects ss ON ss.id = a.paper_id WHERE a.user_id = ? AND a.submitted_at IS NULL', id)) {
        if (!keys.has(`${a.c}-${a.s}`)) run('DELETE FROM trial_attempts WHERE id = ?', a.id);
      }
    }
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
            run('UPDATE users SET name = ?, first_name = ?, initials = ?, trial_teacher_id = ?, trial_scope = ? WHERE id = ?',
              name, firstNameFromName(name), initialsFromName(name), link, it ? 'all' : 'teacher', existing.id);
          }
          done++;
        } else if (it && !usernameFree(n)) {
          // the IT tester's usual number is taken: next free one instead
          let m = n;
          while (!usernameFree(m)) m++;
          makeTester(m, name, link, it ? 'all' : 'teacher');
          done++;
        } else if (usernameFree(n)) {
          makeTester(n, name, link, it ? 'all' : 'teacher');
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
            ...paper, ...paperStats(paper.classCode, paper.subjectId), status: 'live', mine: (user.trial_scope || 'none') !== 'all',
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
          deadline: new Date(deadlineOf(attempt, paper)).toISOString(), serverTime: new Date().toISOString(), questions: forPupil(paperQuestions(paper.classCode, paper.subjectId)), answers,
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
      const testers = all(`SELECT u.id, u.username, u.name, u.trial_teacher_id, u.trial_scope, u.trial_access, t.name AS teacherName FROM users u
                           LEFT JOIN users t ON t.id = u.trial_teacher_id WHERE u.trial = 1 ORDER BY CAST(u.username AS INTEGER)`)
        .map(t => {
          const pending = String(t.trial_teacher_id || '').startsWith(PENDING);
          return {
            id: t.id, username: t.username, name: t.name, password: TRIAL_PASSWORD, secondsAgo: seen.get(t.id)?.secondsAgo ?? null,
            scope: t.trial_scope || 'none', teacherId: pending ? '' : t.trial_teacher_id || '', access: accessList(t.trial_access),
            teacherName: t.trial_scope === 'all' ? 'IT' : pending ? String(t.trial_teacher_id).slice(PENDING.length) : t.trial_scope === 'teacher' ? t.teacherName : '',
            canSee: canSee(t),
          };
        });
      // every class + subject that has a paper here, for choosing a tester's papers
      const choices = all(`SELECT DISTINCT ss.class_code AS classCode, c.label AS classLabel, ss.subject_id AS subjectId, s.name AS subjectName
                           FROM cbt_schedule_subjects ss JOIN classes c ON c.code = ss.class_code JOIN subjects s ON s.id = ss.subject_id
                           ORDER BY c.rowid, s.name`);
      const results = all(`SELECT a.id, u.username, u.name, c.label AS classLabel, s.name AS subjectName, a.score, a.total_marks AS totalMarks, a.submitted_at AS submittedAt
                           FROM trial_attempts a JOIN users u ON u.id = a.user_id JOIN cbt_schedule_subjects ss ON ss.id = a.paper_id
                           JOIN classes c ON c.code = ss.class_code JOIN subjects s ON s.id = ss.subject_id
                           WHERE a.submitted_at IS NOT NULL AND a.score IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 200`);
      const teachers = all("SELECT id, name FROM users WHERE role = 'teacher' ORDER BY name COLLATE NOCASE");
      return sendJson(res, 200, { papers, testers, results, teachers, choices, connections: connectionList(), lanNetworks: cbtOffline.lanNetworks() }), true;
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
        const created = list.map(t => createTester(t));
        db.exec('COMMIT');
        return sendJson(res, 201, { ok: true, created }), true;
      } catch (err) {
        db.exec('ROLLBACK');
        return sendJson(res, 400, { error: err.message }), true;
      }
    }
    const accessMatch = p.match(/^\/api\/exam\/trial\/testers\/([^/]+)\/access$/);
    if (m === 'POST' && accessMatch) {
      try {
        setTesterAccess(decodeURIComponent(accessMatch[1]), await readJson(req));
        return sendJson(res, 200, { ok: true }), true;
      } catch (err) {
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
