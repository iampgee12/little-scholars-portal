// Academics › New Term Setup: sessions & terms, calendar periods, school
// holidays, student class allocation (with history and roll back), form and
// subject teacher allocation per session (with history and carry forward),
// and academic leadership. Modelled on the SchoolsFocus Term Setup page.
//
// The live portal keeps one "current" value for each allocation (a pupil's
// class, an arm's form teacher, a subject's teachers). The tables here add a
// per-session record of each allocation: the active session's records are
// mirrored onto the live values, and switching to a session applies its
// records, so carrying allocations forward to next session takes effect the
// day you switch.

const DEFAULT_TERMS = ['Term 1', 'Term 2', 'Term 3'];
const HOLIDAY_CATEGORIES = ['School Event', 'National', 'Religious', 'Global', 'Others'];
const HOLIDAY_APPLIES = ['both', 'students', 'staff'];
const LEADERSHIP_PERMISSIONS = [
  ['Class', [['view_students', 'View Student List'], ['view_profiles', 'View Student Profiles'], ['view_class', 'View Class Details'], ['view_timetable', 'View Timetable'], ['view_subjects', 'View Subject List']]],
  ['Attendance', [['view_attendance', 'View Attendance'], ['mark_attendance', 'Mark / Edit Attendance']]],
  ['Results', [['view_gradebook', 'View Gradebook'], ['view_broadsheets', 'View Broadsheets'], ['publish_results', 'Publish Results'], ['result_comment', 'Add Result Comment']]],
  ['Lesson Plans', [['view_lesson_plans', 'View Lesson Plans'], ['approve_lesson_plans', 'Approve Lesson Plans']]],
  ['LMS / E-Learning', [['view_lms', 'View LMS'], ['view_virtual', 'View Virtual Classes'], ['view_assignments', 'View Assignments'], ['view_cbt', 'View CBT Exams'], ['view_question_bank', 'View Question Bank']]],
  ['Reports', [['view_daily_reports', 'View Daily Reports'], ['class_announcements', 'Send Class Announcements'], ['class_analytics', 'View Class Analytics']]],
  ['Finance', [['view_fees', 'View Fees Status']]],
];
const PERMISSION_KEYS = LEADERSHIP_PERMISSIONS.flatMap(([, items]) => items.map(([key]) => key));

module.exports = function createTermSetup(ctx) {
  const {
    db, one, all, run, cleanText, readJson, sendJson, requireUser, valueFromMeta, setMeta,
    activeAcademic, classHasArms, recordHistory, adminSetupPayload,
  } = ctx;
  const nowIso = () => new Date().toISOString();
  const SESSION_RE = /^(\d{4})\/(\d{4})$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS academic_sessions (
        label TEXT PRIMARY KEY,
        alias TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS school_holidays (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        applies_to TEXT NOT NULL DEFAULT 'both',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        description TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allocation_log (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        from_session TEXT,
        from_class TEXT,
        from_arm_id INTEGER,
        to_session TEXT,
        to_class TEXT,
        to_arm_id INTEGER,
        students TEXT NOT NULL,
        rolled_back TEXT NOT NULL DEFAULT '[]',
        done_by TEXT,
        done_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS form_teacher_allocations (
        id INTEGER PRIMARY KEY,
        session_label TEXT NOT NULL,
        class_code TEXT NOT NULL,
        class_arm_id INTEGER,
        teacher_id TEXT,
        notes TEXT,
        allocated_by TEXT,
        allocated_at TEXT NOT NULL,
        removed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subject_teacher_allocations (
        id INTEGER PRIMARY KEY,
        session_label TEXT NOT NULL,
        class_subject_id INTEGER NOT NULL,
        teacher_id TEXT NOT NULL,
        in_charge INTEGER NOT NULL DEFAULT 0,
        allocated_by TEXT,
        allocated_at TEXT NOT NULL,
        removed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS leadership_allocations (
        id INTEGER PRIMARY KEY,
        session_label TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('section', 'class')),
        scope_key TEXT NOT NULL,
        staff_id TEXT NOT NULL,
        title TEXT,
        notes TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        allocated_by TEXT,
        allocated_at TEXT NOT NULL,
        removed_at TEXT
      );
    `);
  }

  // ── Sessions & terms ──
  const termNames = () => {
    try { const list = JSON.parse(valueFromMeta('term_names', '')); if (Array.isArray(list) && list.length) return list; } catch { /* default */ }
    return DEFAULT_TERMS;
  };
  const yearsOf = label => { const m = SESSION_RE.exec(label || ''); return m ? [Number(m[1]), Number(m[2])] : [null, null]; };
  const nextSession = label => { const [a, b] = yearsOf(label); return a ? `${a + 1}/${b + 1}` : null; };
  function ensureSession(label) {
    if (label && SESSION_RE.test(label)) run('INSERT OR IGNORE INTO academic_sessions (label, created_at) VALUES (?, ?)', label, nowIso());
  }
  function sessionList() {
    const active = activeAcademic()?.sessionLabel;
    const meta = new Map(all('SELECT label, alias FROM academic_sessions').map(r => [r.label, r.alias || '']));
    all('SELECT DISTINCT session_label AS label FROM academic_terms').forEach(r => { if (!meta.has(r.label)) meta.set(r.label, ''); });
    return [...meta.entries()].map(([label, alias]) => {
      const [startYear, endYear] = yearsOf(label);
      return { label, alias, startYear, endYear, isActive: label === active, terms: one('SELECT COUNT(*) n FROM academic_terms WHERE session_label = ?', label).n };
    }).sort((a, b) => String(b.label).localeCompare(String(a.label)));
  }
  function periodList() {
    const order = termNames();
    return all('SELECT id, session_label AS sessionLabel, term_label AS termLabel, start_date AS startDate, end_date AS endDate, is_active AS isActive FROM academic_terms')
      .map(r => ({ ...r, isActive: !!r.isActive }))
      .sort((a, b) => String(b.sessionLabel).localeCompare(String(a.sessionLabel)) || order.indexOf(b.termLabel) - order.indexOf(a.termLabel));
  }
  function holidayList() {
    return all('SELECT id, name, category, applies_to AS appliesTo, start_date AS startDate, end_date AS endDate, description FROM school_holidays ORDER BY start_date DESC');
  }
  function overview() {
    const a = activeAcademic();
    const term = a ? one('SELECT start_date AS startDate, end_date AS endDate FROM academic_terms WHERE id = ?', a.id) : null;
    const [y1] = yearsOf(a?.sessionLabel);
    return {
      active: a ? { ...a, ...term, year: Number(valueFromMeta('active_year', '')) || y1 } : null,
      sessions: sessionList(),
      terms: termNames().map(name => ({ name, isActive: a?.termLabel === name, used: one('SELECT COUNT(*) n FROM academic_terms WHERE term_label = ?', name).n })),
      periods: periodList(),
      holidays: holidayList(),
      categories: HOLIDAY_CATEGORIES,
      permissions: LEADERSHIP_PERMISSIONS,
    };
  }
  function termRow(sessionLabel, termLabel) {
    let row = one('SELECT id FROM academic_terms WHERE session_label = ? AND term_label = ?', sessionLabel, termLabel);
    if (!row) row = { id: Number(run('INSERT INTO academic_terms (session_label, term_label, is_active) VALUES (?, ?, 0)', sessionLabel, termLabel).lastInsertRowid) };
    ensureSession(sessionLabel);
    return row.id;
  }
  function checkDates(startDate, endDate, required) {
    if (!startDate && !endDate && !required) return null;
    if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) return 'Enter both a start date and an end date';
    if (endDate < startDate) return 'The end date must be after the start date';
    return null;
  }

  // Days a holiday that applies to pupils closes, inside [start, end]
  function holidayDates(startDate, endDate, who = 'students') {
    const out = new Set();
    for (const h of all("SELECT start_date AS s, end_date AS e, applies_to AS a FROM school_holidays WHERE end_date >= ? AND start_date <= ?", startDate, endDate)) {
      if (h.a !== 'both' && h.a !== who) continue;
      const cur = new Date(`${h.s > startDate ? h.s : startDate}T00:00:00Z`);
      const last = h.e < endDate ? h.e : endDate;
      while (cur.toISOString().slice(0, 10) <= last) { out.add(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
    }
    return out;
  }

  // ── Teacher allocations: live values ↔ per-session records ──
  const armLabel = (classLabel, armName) => [classLabel, armName].filter(Boolean).join(' ');
  // Same order report cards use: the arm's form teacher, then (for a class
  // with no arms) this page's record, then the class teacher set in Classes.
  function liveFormTeacher(classCode, armId) {
    const fromArm = armId ? one('SELECT form_teacher_id AS id FROM class_arms WHERE id = ?', armId)?.id : null;
    if (fromArm) return fromArm;
    if (!armId) {
      const recorded = currentRecord('form', activeAcademic()?.sessionLabel, { classCode, armId: null })?.teacher_id;
      if (recorded) return recorded;
    }
    return one("SELECT teacher_id AS id FROM teacher_assignments WHERE class_code = ? AND teacher_type = 'class_teacher' ORDER BY id LIMIT 1", classCode)?.id || null;
  }
  function currentRecord(kind, session, key) {
    if (kind === 'form') {
      return one(`SELECT * FROM form_teacher_allocations WHERE session_label = ? AND class_code = ? AND class_arm_id IS ? AND removed_at IS NULL ORDER BY id DESC LIMIT 1`,
        session, key.classCode, key.armId || null);
    }
    return null;
  }
  function setLiveFormTeacher(classCode, armId, teacherId) {
    if (armId) run('UPDATE class_arms SET form_teacher_id = ? WHERE id = ?', teacherId || null, armId);
  }
  function recordForm(session, classCode, armId, teacherId, notes, by) {
    run('UPDATE form_teacher_allocations SET removed_at = ? WHERE session_label = ? AND class_code = ? AND class_arm_id IS ? AND removed_at IS NULL', nowIso(), session, classCode, armId || null);
    run('INSERT INTO form_teacher_allocations (session_label, class_code, class_arm_id, teacher_id, notes, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      session, classCode, armId || null, teacherId || null, notes || null, by, nowIso());
  }

  function liveSubjectTeachers(cs) {
    const ids = new Map();
    if (cs.teacher_in_charge_id) ids.set(cs.teacher_in_charge_id, true);
    String(cs.assisting_teacher_ids || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => { if (!ids.has(id)) ids.set(id, false); });
    for (const ta of all('SELECT teacher_id FROM teacher_assignments WHERE class_code = ? AND subject_id = ?', cs.class_code, cs.subject_id)) {
      if (!ids.has(ta.teacher_id)) ids.set(ta.teacher_id, false);
    }
    return [...ids.entries()].map(([id, inCharge]) => ({ id, inCharge }));
  }
  function subjectRecords(session, csId) {
    return all('SELECT teacher_id AS id, in_charge AS inCharge FROM subject_teacher_allocations WHERE session_label = ? AND class_subject_id = ? AND removed_at IS NULL ORDER BY id', session, csId)
      .map(r => ({ id: r.id, inCharge: !!r.inCharge }));
  }
  // Adds a teacher to a class subject on the live portal: shown on the subject
  // and allowed to enter its results (a teacher_assignments row).
  function liveAddSubjectTeacher(cs, teacherId, inCharge) {
    const t = one("SELECT teacher_type AS type FROM users WHERE id = ? AND role = 'teacher'", teacherId);
    if (t) run('INSERT OR IGNORE INTO teacher_assignments (teacher_id, teacher_type, class_code, subject_id) VALUES (?, ?, ?, ?)',
      teacherId, t.type === 'class_teacher' ? 'class_teacher' : 'subject_teacher', cs.class_code, cs.subject_id);
    const fresh = one('SELECT teacher_in_charge_id, assisting_teacher_ids FROM class_subjects WHERE id = ?', cs.id);
    let assisting = String(fresh.assisting_teacher_ids || '').split(',').map(s => s.trim()).filter(Boolean).filter(id => id !== teacherId);
    let inChargeId = fresh.teacher_in_charge_id;
    if (inCharge) {
      if (inChargeId && inChargeId !== teacherId) assisting.push(inChargeId);
      inChargeId = teacherId;
    } else if (inChargeId !== teacherId) assisting.push(teacherId);
    run('UPDATE class_subjects SET teacher_in_charge_id = ?, assisting_teacher_ids = ? WHERE id = ?', inChargeId || null, [...new Set(assisting)].join(',') || null, cs.id);
  }
  // Returns an error if the teacher already has results saved for this subject
  function liveRemoveSubjectTeacher(cs, teacherId) {
    const saved = one(`SELECT COUNT(*) n FROM result_batches rb JOIN teacher_assignments ta ON ta.id = rb.assignment_id
                       WHERE ta.teacher_id = ? AND ta.class_code = ? AND ta.subject_id = ?`, teacherId, cs.class_code, cs.subject_id).n;
    if (saved) return 'This teacher already has results saved for this subject, so they stay on it. Add the new teacher instead.';
    run('DELETE FROM teacher_assignments WHERE teacher_id = ? AND class_code = ? AND subject_id = ?', teacherId, cs.class_code, cs.subject_id);
    const fresh = one('SELECT teacher_in_charge_id, assisting_teacher_ids FROM class_subjects WHERE id = ?', cs.id);
    const assisting = String(fresh.assisting_teacher_ids || '').split(',').map(s => s.trim()).filter(id => id && id !== teacherId);
    run('UPDATE class_subjects SET teacher_in_charge_id = ?, assisting_teacher_ids = ? WHERE id = ?',
      fresh.teacher_in_charge_id === teacherId ? null : fresh.teacher_in_charge_id, assisting.join(',') || null, cs.id);
    return null;
  }

  // Switching to a session applies the allocations recorded for it
  function applySessionAllocations(session) {
    for (const r of all('SELECT * FROM form_teacher_allocations WHERE session_label = ? AND removed_at IS NULL', session)) {
      setLiveFormTeacher(r.class_code, r.class_arm_id, r.teacher_id);
    }
    const bySubject = new Map();
    for (const r of all('SELECT * FROM subject_teacher_allocations WHERE session_label = ? AND removed_at IS NULL', session)) {
      if (!bySubject.has(r.class_subject_id)) bySubject.set(r.class_subject_id, []);
      bySubject.get(r.class_subject_id).push(r);
    }
    for (const [csId, rows] of bySubject) {
      const cs = one('SELECT * FROM class_subjects WHERE id = ?', csId);
      if (!cs) continue;
      const keep = new Set(rows.map(r => r.teacher_id));
      liveSubjectTeachers(cs).filter(t => !keep.has(t.id)).forEach(t => liveRemoveSubjectTeacher(cs, t.id));
      rows.forEach(r => liveAddSubjectTeacher(one('SELECT * FROM class_subjects WHERE id = ?', csId), r.teacher_id, !!r.in_charge));
    }
  }

  const staffName = id => (id ? one('SELECT name, photo_path AS photo FROM users WHERE id = ?', id) : null);
  const teacherInfo = id => { const u = staffName(id); return u ? { id, name: u.name, photo: u.photo || '' } : null; };
  function classUnits(classCode) {
    // school order: creche, nursery, primary, secondary, then anything else
    const rank = cat => { const c = String(cat || '').toLowerCase(); return ['creche', 'nursery', 'primary', 'junior', 'senior', 'secondary'].findIndex(k => c.includes(k)) + 1 || 9; };
    const classes = all('SELECT code, label, category FROM classes WHERE COALESCE(archived, 0) = 0 ORDER BY rowid')
      .map((c, i) => ({ ...c, i })).sort((a, b) => rank(a.category) - rank(b.category) || a.i - b.i)
      .filter(c => !classCode || c.code === classCode);
    const units = [];
    for (const c of classes) {
      const arms = all('SELECT id, name FROM class_arms WHERE class_code = ? ORDER BY id', c.code);
      if (arms.length) arms.forEach(a => units.push({ classCode: c.code, classLabel: c.label, category: c.category || '', armId: a.id, armName: a.name }));
      else units.push({ classCode: c.code, classLabel: c.label, category: c.category || '', armId: null, armName: '' });
    }
    return units;
  }
  function formTeacherRows(session, classCode) {
    const active = activeAcademic()?.sessionLabel;
    return classUnits(classCode).map(u => {
      const direct = currentRecord('form', session, u);
      let teacherId = null;
      let status = 'pending';
      if (direct) { teacherId = direct.teacher_id; status = 'direct'; } else {
        // nothing recorded for this session: it carries the live value (or the latest earlier record)
        const earlier = session === active ? null : one(`SELECT teacher_id FROM form_teacher_allocations WHERE session_label < ? AND class_code = ? AND class_arm_id IS ? AND removed_at IS NULL ORDER BY session_label DESC, id DESC LIMIT 1`, session, u.classCode, u.armId || null);
        teacherId = earlier ? earlier.teacher_id : liveFormTeacher(u.classCode, u.armId);
        if (teacherId) status = 'inherited';
      }
      if (direct && !direct.teacher_id) status = 'unassigned';
      return { ...u, session, teacher: teacherInfo(teacherId), status, notes: direct?.notes || '' };
    });
  }
  function classSubjectsList(classCode) {
    const order = classOrder();
    return all(`SELECT cs.*, s.name AS subjectName, c.label AS classLabel, ca.name AS armName FROM class_subjects cs
                JOIN subjects s ON s.id = cs.subject_id JOIN classes c ON c.code = cs.class_code
                LEFT JOIN class_arms ca ON ca.id = cs.class_arm_id
                WHERE COALESCE(c.archived, 0) = 0 ${classCode ? 'AND cs.class_code = ?' : ''}
                ORDER BY c.rowid, s.name`, ...(classCode ? [classCode] : []))
      .map((cs, i) => ({ cs, i, at: order.get(cs.class_code) ?? 999 }))
      .sort((a, b) => a.at - b.at || a.i - b.i).map(x => x.cs);
  }
  function classOrder() {
    const order = new Map();
    classUnits().forEach(u => { if (!order.has(u.classCode)) order.set(u.classCode, order.size); });
    return order;
  }
  function subjectTeacherRows(session, classCode) {
    const active = activeAcademic()?.sessionLabel;
    return classSubjectsList(classCode).map(cs => {
      const direct = subjectRecords(session, cs.id);
      const hasDirect = !!one('SELECT id FROM subject_teacher_allocations WHERE session_label = ? AND class_subject_id = ? LIMIT 1', session, cs.id);
      let teachers;
      let status;
      if (hasDirect) { teachers = direct; status = direct.length ? 'direct' : 'unassigned'; } else {
        teachers = session === active ? liveSubjectTeachers(cs) : (() => {
          const prev = one('SELECT session_label FROM subject_teacher_allocations WHERE session_label < ? AND class_subject_id = ? ORDER BY session_label DESC LIMIT 1', session, cs.id);
          return prev ? subjectRecords(prev.session_label, cs.id) : liveSubjectTeachers(cs);
        })();
        status = teachers.length ? 'inherited' : 'pending';
      }
      return {
        id: cs.id, session, classCode: cs.class_code, classLabel: cs.classLabel, subject: cs.subjectName, armName: cs.armName || '', term: cs.term || '',
        teachers: teachers.map(t => ({ ...teacherInfo(t.id), inCharge: t.inCharge })).filter(t => t.name), status,
      };
    });
  }
  const stats = rows => {
    const filled = rows.filter(r => r.status === 'direct' || r.status === 'inherited').length;
    return { total: rows.length, filled, direct: rows.filter(r => r.status === 'direct').length, inherited: rows.filter(r => r.status === 'inherited').length, pending: rows.length - filled };
  };

  // ── Student allocation ──
  function studentState(id) {
    const s = one('SELECT s.id, s.class_code AS classCode, s.class_arm_id AS armId, s.status, u.active FROM students s LEFT JOIN users u ON u.id = s.id WHERE s.id = ?', id);
    return s ? { id: s.id, classCode: s.classCode, armId: s.armId, status: s.status || 'active', active: s.active == null ? null : Number(s.active) } : null;
  }
  function sessionAverage(studentId, session) {
    const r = one(`SELECT AVG(re.total_score) avg FROM result_entries re JOIN result_batches rb ON rb.id = re.batch_id
                   JOIN academic_terms t ON t.id = rb.academic_id WHERE re.student_id = ? AND t.session_label = ?`, studentId, session);
    return r?.avg == null ? null : Math.round(r.avg * 10) / 10;
  }
  function attendancePct(studentId) {
    const r = one("SELECT SUM(status IN ('present','late')) p, COUNT(*) n FROM attendance_records WHERE person_type = 'student' AND person_id = ? AND session_type = 'daily'", studentId);
    return r?.n ? Math.round((r.p / r.n) * 100) : null;
  }

  function logAllocation(type, from, to, before, user) {
    run(`INSERT INTO allocation_log (type, from_session, from_class, from_arm_id, to_session, to_class, to_arm_id, students, done_by, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, type, from.session || null, from.classCode || null, from.armId || null,
    to.session || null, to.classCode || null, to.armId || null, JSON.stringify(before), user.id, nowIso());
  }
  const classText = (code, armId) => {
    if (!code) return '';
    const c = one('SELECT label FROM classes WHERE code = ?', code);
    const a = armId ? one('SELECT name FROM class_arms WHERE id = ?', armId) : null;
    return armLabel(c?.label || code, a?.name);
  };

  // ── Leadership ──
  function leadershipView(session) {
    const record = (scope, key) => {
      const r = one('SELECT * FROM leadership_allocations WHERE session_label = ? AND scope = ? AND scope_key = ? AND removed_at IS NULL ORDER BY id DESC LIMIT 1', session, scope, key);
      if (!r) return null;
      return { staff: teacherInfo(r.staff_id), title: r.title || '', notes: r.notes || '', permissions: JSON.parse(r.permissions || '[]'), allocatedAt: r.allocated_at };
    };
    const units = classUnits();
    const sections = [...new Set(units.map(u => u.category || 'Other'))];
    return sections.map(cat => ({
      key: cat, label: cat.toUpperCase(), head: record('section', cat),
      classes: units.filter(u => (u.category || 'Other') === cat).map(u => {
        const key = u.armId ? `arm:${u.armId}` : `class:${u.classCode}`;
        return { key, label: u.armName && u.armName.toLowerCase() !== u.classLabel.toLowerCase() ? armLabel(u.classLabel, u.armName) : u.classLabel, head: record('class', key) };
      }),
    }));
  }

  // ── Routes ──
  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/admin/term-setup')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const m = req.method;
    const send = (status, body) => (sendJson(res, status, body), true);
    const fail = (status, error) => send(status, { error });
    const activeSession = activeAcademic()?.sessionLabel || '';
    const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (err) { db.exec('ROLLBACK'); throw err; } };

    if (m === 'GET' && p === '/api/admin/term-setup/overview') return send(200, overview());

    // Switch the portal to a session / term (and optionally set its dates)
    if (m === 'POST' && p === '/api/admin/term-setup/switch') {
      const b = await readJson(req);
      const sessionLabel = cleanText(b.sessionLabel);
      const termLabel = cleanText(b.termLabel);
      if (!SESSION_RE.test(sessionLabel)) return fail(400, 'Choose an academic session');
      if (!termNames().includes(termLabel)) return fail(400, 'Choose a term');
      const dateError = checkDates(cleanText(b.startDate), cleanText(b.endDate), false);
      if (dateError) return fail(400, dateError);
      const year = Number(b.year) || null;
      if (year && !yearsOf(sessionLabel).includes(year)) return fail(400, 'The session year must be one of the session\'s two years');
      tx(() => {
        const id = termRow(sessionLabel, termLabel);
        if (b.startDate && b.endDate) run('UPDATE academic_terms SET start_date = ?, end_date = ? WHERE id = ?', cleanText(b.startDate), cleanText(b.endDate), id);
        run('UPDATE academic_terms SET is_active = 0');
        run('UPDATE academic_terms SET is_active = 1 WHERE id = ?', id);
        setMeta('active_year', year || yearsOf(sessionLabel)[0]);
        // like SchoolsFocus: the following session is created quietly in the background
        ensureSession(nextSession(sessionLabel));
        applySessionAllocations(sessionLabel);
      });
      return send(200, { ok: true, overview: overview(), setup: adminSetupPayload() });
    }

    // Calendar periods = a session + term's date range
    if (m === 'POST' && p === '/api/admin/term-setup/periods') {
      const b = await readJson(req);
      const sessionLabel = cleanText(b.sessionLabel);
      const termLabel = cleanText(b.termLabel);
      if (!SESSION_RE.test(sessionLabel) || !termNames().includes(termLabel)) return fail(400, 'Choose the session and term');
      const dateError = checkDates(cleanText(b.startDate), cleanText(b.endDate), true);
      if (dateError) return fail(400, dateError);
      tx(() => { const id = termRow(sessionLabel, termLabel); run('UPDATE academic_terms SET start_date = ?, end_date = ? WHERE id = ?', cleanText(b.startDate), cleanText(b.endDate), id); });
      return send(200, { ok: true, overview: overview() });
    }
    const periodMatch = p.match(/^\/api\/admin\/term-setup\/periods\/(\d+)$/);
    if (periodMatch && (m === 'PUT' || m === 'DELETE')) {
      const id = Number(periodMatch[1]);
      if (!one('SELECT id FROM academic_terms WHERE id = ?', id)) return fail(404, 'Period not found');
      if (m === 'DELETE') {
        // the session + term stays (results hang off it); only its date range goes
        run('UPDATE academic_terms SET start_date = NULL, end_date = NULL WHERE id = ?', id);
        return send(200, { ok: true, overview: overview() });
      }
      const b = await readJson(req);
      const dateError = checkDates(cleanText(b.startDate), cleanText(b.endDate), true);
      if (dateError) return fail(400, dateError);
      run('UPDATE academic_terms SET start_date = ?, end_date = ? WHERE id = ?', cleanText(b.startDate), cleanText(b.endDate), id);
      return send(200, { ok: true, overview: overview() });
    }

    // Academic sessions
    if (m === 'POST' && p === '/api/admin/term-setup/sessions') {
      const b = await readJson(req);
      const start = Number(b.startYear);
      const end = Number(b.endYear);
      if (!start || !end || start < 2000 || start > 2100 || end !== start + 1) return fail(400, 'Enter the start year; the end year is the next year (e.g. 2027 - 2028)');
      const label = `${start}/${end}`;
      if (sessionList().some(s => s.label === label)) return fail(409, `${label} already exists`);
      run('INSERT INTO academic_sessions (label, alias, created_at) VALUES (?, ?, ?)', label, cleanText(b.alias).slice(0, 60) || null, nowIso());
      return send(200, { ok: true, overview: overview() });
    }
    const sessionMatch = p.match(/^\/api\/admin\/term-setup\/sessions\/(\d{4})-(\d{4})$/);
    if (sessionMatch && (m === 'PUT' || m === 'DELETE')) {
      const label = `${sessionMatch[1]}/${sessionMatch[2]}`;
      if (!sessionList().some(s => s.label === label)) return fail(404, 'Session not found');
      if (m === 'PUT') {
        const b = await readJson(req);
        ensureSession(label);
        run('UPDATE academic_sessions SET alias = ? WHERE label = ?', cleanText(b.alias).slice(0, 60) || null, label);
        return send(200, { ok: true, overview: overview() });
      }
      if (label === activeSession) return fail(400, 'You can\'t delete the active session. Switch to another session first.');
      try {
        tx(() => {
          run('DELETE FROM academic_terms WHERE session_label = ?', label);
          run('DELETE FROM academic_sessions WHERE label = ?', label);
        });
      } catch (err) {
        if (/FOREIGN KEY/.test(err.message)) return fail(409, `${label} has results, attendance or fees recorded against it, so it can't be deleted.`);
        throw err;
      }
      return send(200, { ok: true, overview: overview() });
    }

    // Term names
    if (m === 'POST' && p === '/api/admin/term-setup/terms') {
      const name = cleanText((await readJson(req)).name).slice(0, 40);
      if (!name) return fail(400, 'Enter the term name');
      const list = termNames();
      if (list.some(t => t.toLowerCase() === name.toLowerCase())) return fail(409, 'That term already exists');
      setMeta('term_names', JSON.stringify([...list, name]));
      return send(200, { ok: true, overview: overview() });
    }
    const termMatch = p.match(/^\/api\/admin\/term-setup\/terms\/(.+)$/);
    if (m === 'DELETE' && termMatch) {
      const name = decodeURIComponent(termMatch[1]);
      if (DEFAULT_TERMS.includes(name)) return fail(400, `${name} is one of the school's standard terms and can't be removed`);
      if (one('SELECT COUNT(*) n FROM academic_terms WHERE term_label = ?', name).n) return fail(409, 'That term is already used by a session, so it stays');
      setMeta('term_names', JSON.stringify(termNames().filter(t => t !== name)));
      return send(200, { ok: true, overview: overview() });
    }

    // School holidays
    if ((m === 'POST' && p === '/api/admin/term-setup/holidays') || (m === 'PUT' && /^\/api\/admin\/term-setup\/holidays\/\d+$/.test(p))) {
      const b = await readJson(req);
      const name = cleanText(b.name).slice(0, 120);
      const category = HOLIDAY_CATEGORIES.includes(b.category) ? b.category : null;
      const appliesTo = HOLIDAY_APPLIES.includes(b.appliesTo) ? b.appliesTo : null;
      if (!name || !category || !appliesTo) return fail(400, 'Enter the holiday name, category and who it applies to');
      const dateError = checkDates(cleanText(b.startDate), cleanText(b.endDate), true);
      if (dateError) return fail(400, dateError);
      const values = [name, category, appliesTo, cleanText(b.startDate), cleanText(b.endDate), cleanText(b.description).slice(0, 500) || null];
      if (m === 'POST') run('INSERT INTO school_holidays (name, category, applies_to, start_date, end_date, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...values, user.id, nowIso());
      else run('UPDATE school_holidays SET name = ?, category = ?, applies_to = ?, start_date = ?, end_date = ?, description = ? WHERE id = ?', ...values, Number(p.split('/').pop()));
      return send(200, { ok: true, overview: overview() });
    }
    if (m === 'DELETE' && /^\/api\/admin\/term-setup\/holidays\/\d+$/.test(p)) {
      run('DELETE FROM school_holidays WHERE id = ?', Number(p.split('/').pop()));
      return send(200, { ok: true, overview: overview() });
    }

    // ── Student class allocation ──
    if (m === 'GET' && p === '/api/admin/term-setup/allocation/students') {
      const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
      const armId = Number(url.searchParams.get('armId')) || null;
      const session = cleanText(url.searchParams.get('session')) || activeSession;
      const unallocated = classCode === '__UNALLOCATED__';
      if (!classCode) return fail(400, 'Choose the class');
      const rows = all(`SELECT s.id, s.name, s.photo_path AS photo, s.reg_no AS regNo, s.class_code AS classCode, s.class_arm_id AS armId, s.status, s.enrolled_at AS enrolledAt
                        FROM students s WHERE COALESCE(s.archived, 0) = 0 AND ${unallocated ? "s.status = 'unallocated'" : "s.status = 'active' AND s.class_code = ?"} ${armId && !unallocated ? 'AND s.class_arm_id = ?' : ''}
                        ORDER BY s.name`, ...(unallocated ? [] : [classCode]), ...(armId && !unallocated ? [armId] : []))
        .map(s => ({ ...s, classText: unallocated ? 'Not in a class' : classText(s.classCode, s.armId), average: sessionAverage(s.id, session), attendance: attendancePct(s.id) }));
      return send(200, { students: rows });
    }
    if (m === 'POST' && p === '/api/admin/term-setup/allocation') {
      const b = await readJson(req);
      const type = ['promotion', 'transfer', 'graduation', 'deallocation'].includes(b.type) ? b.type : null;
      if (!type) return fail(400, 'Choose what to do');
      const ids = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : []).map(id => cleanText(id).toUpperCase()).filter(Boolean))];
      if (!ids.length) return fail(400, 'Tick at least one pupil');
      const from = { session: cleanText(b.fromSession) || activeSession, classCode: cleanText(b.fromClass).toUpperCase() || null, armId: Number(b.fromArmId) || null };
      const to = { session: type === 'promotion' ? cleanText(b.toSession) : from.session, classCode: null, armId: null };
      if (type === 'promotion' && !SESSION_RE.test(to.session || '')) return fail(400, 'Choose the session to move them into');
      if (type === 'promotion' || type === 'transfer') {
        to.classCode = cleanText(b.toClass).toUpperCase();
        to.armId = Number(b.toArmId) || null;
        if (!one('SELECT code FROM classes WHERE code = ?', to.classCode)) return fail(400, 'Choose the class to move them into');
        if (to.armId && !one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', to.armId, to.classCode)) return fail(400, 'That arm does not belong to the class');
        if (!to.armId && classHasArms(to.classCode)) return fail(400, 'Choose the class arm');
        if (to.classCode === from.classCode && to.armId === from.armId && type === 'transfer') return fail(400, 'Choose a different class or arm to transfer them to');
      }
      const before = ids.map(studentState).filter(Boolean);
      if (!before.length) return fail(404, 'Those pupils were not found');
      tx(() => {
        for (const s of before) {
          if (type === 'promotion' || type === 'transfer') {
            run("UPDATE students SET class_code = ?, class_arm_id = ?, status = 'active' WHERE id = ?", to.classCode, to.armId, s.id);
            run("UPDATE users SET grade = ?, active = 1 WHERE id = ? AND role = 'student'", `Class ${to.classCode}`, s.id);
            recordHistory(s.id, null, to.session);
          } else if (type === 'graduation') {
            run("UPDATE students SET status = 'graduated' WHERE id = ?", s.id);
            run("UPDATE users SET active = 0 WHERE id = ? AND role = 'student'", s.id);
            recordHistory(s.id, 'graduated', from.session);
          } else {
            run("UPDATE students SET status = 'unallocated' WHERE id = ?", s.id);
          }
        }
        logAllocation(type, from, to, before, user);
      });
      const label = { promotion: 'moved', transfer: 'transferred', graduation: 'marked as graduated', deallocation: 'removed from their class' }[type];
      return send(200, { ok: true, message: `${before.length} pupil${before.length === 1 ? '' : 's'} ${label}`, setup: adminSetupPayload() });
    }
    if (m === 'GET' && p === '/api/admin/term-setup/allocation/history') {
      const rows = all('SELECT * FROM allocation_log ORDER BY id DESC LIMIT 500').map(r => {
        const students = JSON.parse(r.students || '[]');
        const back = new Set(JSON.parse(r.rolled_back || '[]'));
        return {
          id: r.id, type: r.type, count: students.length, rolledBack: students.filter(s => back.has(s.id)).length,
          fromSession: r.from_session, fromClass: classText(r.from_class, r.from_arm_id), toSession: r.to_session, toClass: classText(r.to_class, r.to_arm_id),
          doneAt: r.done_at, doneBy: staffName(r.done_by)?.name || r.done_by,
          students: students.map(s => ({ id: s.id, name: one('SELECT name FROM students WHERE id = ?', s.id)?.name || s.id, was: s.status === 'active' ? classText(s.classCode, s.armId) : s.status, rolledBack: back.has(s.id) })),
        };
      });
      return send(200, { history: rows });
    }
    const rollbackMatch = p.match(/^\/api\/admin\/term-setup\/allocation\/history\/(\d+)\/rollback$/);
    if (m === 'POST' && rollbackMatch) {
      const log = one('SELECT * FROM allocation_log WHERE id = ?', Number(rollbackMatch[1]));
      if (!log) return fail(404, 'That allocation was not found');
      const b = await readJson(req);
      const students = JSON.parse(log.students || '[]');
      const back = new Set(JSON.parse(log.rolled_back || '[]'));
      const pick = Array.isArray(b.studentIds) && b.studentIds.length ? new Set(b.studentIds.map(id => cleanText(id).toUpperCase())) : null;
      const todo = students.filter(s => !back.has(s.id) && (!pick || pick.has(s.id)));
      if (!todo.length) return fail(400, 'Nothing left to roll back for those pupils');
      tx(() => {
        for (const s of todo) {
          if (!one('SELECT id FROM students WHERE id = ?', s.id)) continue;
          run('UPDATE students SET class_code = ?, class_arm_id = ?, status = ? WHERE id = ?', s.classCode, s.armId || null, s.status || 'active', s.id);
          if (s.active != null) run("UPDATE users SET active = ?, grade = ? WHERE id = ? AND role = 'student'", s.active, `Class ${s.classCode}`, s.id);
          recordHistory(s.id, ['graduated', 'left'].includes(s.status) ? s.status : null, log.from_session || activeSession);
          back.add(s.id);
        }
        run('UPDATE allocation_log SET rolled_back = ? WHERE id = ?', JSON.stringify([...back]), log.id);
      });
      return send(200, { ok: true, message: `${todo.length} pupil${todo.length === 1 ? '' : 's'} put back`, setup: adminSetupPayload() });
    }

    // ── Form (class) teachers ──
    if (m === 'GET' && p === '/api/admin/term-setup/form-teachers') {
      const session = cleanText(url.searchParams.get('session')) || activeSession;
      const rows = formTeacherRows(session, cleanText(url.searchParams.get('classCode')).toUpperCase());
      return send(200, { rows, stats: stats(rows), session, activeSession });
    }
    if (m === 'PUT' && p === '/api/admin/term-setup/form-teachers') {
      const b = await readJson(req);
      const session = cleanText(b.session) || activeSession;
      const classCode = cleanText(b.classCode).toUpperCase();
      const armId = Number(b.armId) || null;
      const teacherId = cleanText(b.teacherId).toUpperCase() || null;
      if (!one('SELECT code FROM classes WHERE code = ?', classCode)) return fail(400, 'Class not found');
      if (armId && !one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', armId, classCode)) return fail(400, 'Arm not found');
      if (teacherId && !one("SELECT id FROM users WHERE id = ? AND role IN ('teacher', 'admin')", teacherId)) return fail(400, 'Choose a teacher');
      const problems = [];
      tx(() => {
        const previous = session === activeSession ? liveFormTeacher(classCode, armId) : formTeacherRows(session, classCode).find(r => r.armId === armId)?.teacher?.id;
        recordForm(session, classCode, armId, teacherId, cleanText(b.notes).slice(0, 300), user.id);
        if (session !== activeSession) return;
        setLiveFormTeacher(classCode, armId, teacherId);
        const subjects = all('SELECT * FROM class_subjects WHERE class_code = ? AND (class_arm_id IS NULL OR class_arm_id IS ?)', classCode, armId);
        if (b.removePrevious && previous && previous !== teacherId) {
          subjects.forEach(cs => { const e = liveRemoveSubjectTeacher(cs, previous); if (e) problems.push(cs.id); });
        }
        if (b.alsoSubjects && teacherId) subjects.forEach(cs => liveAddSubjectTeacher(one('SELECT * FROM class_subjects WHERE id = ?', cs.id), teacherId, true));
      });
      return send(200, { ok: true, note: problems.length ? `The previous teacher has results saved in ${problems.length} subject${problems.length === 1 ? '' : 's'}, so they stay on those.` : '', setup: adminSetupPayload() });
    }
    if (m === 'GET' && p === '/api/admin/term-setup/form-teachers/history') {
      const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
      const armId = Number(url.searchParams.get('armId')) || null;
      const rows = all('SELECT * FROM form_teacher_allocations WHERE class_code = ? AND class_arm_id IS ? ORDER BY id DESC', classCode, armId)
        .map(r => ({ session: r.session_label, teacher: staffName(r.teacher_id)?.name || (r.teacher_id ? r.teacher_id : 'Unassigned'), notes: r.notes || '', by: staffName(r.allocated_by)?.name || r.allocated_by, at: r.allocated_at, removed: !!r.removed_at }));
      return send(200, { history: rows });
    }

    // ── Subject teachers ──
    if (m === 'GET' && p === '/api/admin/term-setup/subject-teachers') {
      const session = cleanText(url.searchParams.get('session')) || activeSession;
      const rows = subjectTeacherRows(session, cleanText(url.searchParams.get('classCode')).toUpperCase());
      const teachers = new Set(rows.flatMap(r => r.teachers.map(t => t.id)));
      return send(200, { rows, stats: { ...stats(rows), subjects: new Set(rows.map(r => r.subject)).size, teachers: teachers.size }, session, activeSession });
    }
    const subjMatch = p.match(/^\/api\/admin\/term-setup\/subject-teachers\/(\d+)(?:\/([^/]+))?$/);
    if (subjMatch && (m === 'POST' || m === 'DELETE')) {
      const cs = one('SELECT * FROM class_subjects WHERE id = ?', Number(subjMatch[1]));
      if (!cs) return fail(404, 'Subject not found');
      const b = m === 'POST' ? await readJson(req) : {};
      const session = cleanText(b.session || url.searchParams.get('session')) || activeSession;
      const teacherId = (m === 'POST' ? cleanText(b.teacherId) : decodeURIComponent(subjMatch[2] || '')).toUpperCase();
      if (!one("SELECT id FROM users WHERE id = ? AND role IN ('teacher', 'admin')", teacherId)) return fail(400, 'Choose a teacher');
      let error = null;
      tx(() => {
        // start this session's record from what it shows now, then change it
        if (!one('SELECT id FROM subject_teacher_allocations WHERE session_label = ? AND class_subject_id = ? LIMIT 1', session, cs.id)) {
          const shown = subjectTeacherRows(session, cs.class_code).find(r => r.id === cs.id)?.teachers || [];
          shown.forEach(t => run('INSERT INTO subject_teacher_allocations (session_label, class_subject_id, teacher_id, in_charge, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?)', session, cs.id, t.id, t.inCharge ? 1 : 0, user.id, nowIso()));
        }
        if (m === 'POST') {
          if (b.inCharge) run('UPDATE subject_teacher_allocations SET in_charge = 0 WHERE session_label = ? AND class_subject_id = ? AND removed_at IS NULL', session, cs.id);
          run('UPDATE subject_teacher_allocations SET removed_at = ? WHERE session_label = ? AND class_subject_id = ? AND teacher_id = ? AND removed_at IS NULL', nowIso(), session, cs.id, teacherId);
          run('INSERT INTO subject_teacher_allocations (session_label, class_subject_id, teacher_id, in_charge, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?)', session, cs.id, teacherId, b.inCharge ? 1 : 0, user.id, nowIso());
          if (session === activeSession) liveAddSubjectTeacher(cs, teacherId, !!b.inCharge);
        } else {
          if (session === activeSession) error = liveRemoveSubjectTeacher(cs, teacherId);
          if (error) throw Object.assign(new Error(error), { status: 409 });
          run('UPDATE subject_teacher_allocations SET removed_at = ? WHERE session_label = ? AND class_subject_id = ? AND teacher_id = ? AND removed_at IS NULL', nowIso(), session, cs.id, teacherId);
        }
      });
      return send(200, { ok: true, setup: adminSetupPayload() });
    }
    if (m === 'GET' && p === '/api/admin/term-setup/subject-teachers/history') {
      const csId = Number(url.searchParams.get('classSubjectId'));
      const rows = all('SELECT * FROM subject_teacher_allocations WHERE class_subject_id = ? ORDER BY id DESC', csId)
        .map(r => ({ session: r.session_label, teacher: staffName(r.teacher_id)?.name || r.teacher_id, inCharge: !!r.in_charge, by: staffName(r.allocated_by)?.name || r.allocated_by, at: r.allocated_at, removed: !!r.removed_at }));
      return send(200, { history: rows });
    }

    // ── Carry forward (form or subject teachers) ──
    const cfMatch = p.match(/^\/api\/admin\/term-setup\/(form|subject)-teachers\/carry-forward(\/preview)?$/);
    if (m === 'POST' && cfMatch) {
      const kind = cfMatch[1];
      const b = await readJson(req);
      const fromS = cleanText(b.from);
      const toS = cleanText(b.to);
      if (!SESSION_RE.test(fromS) || !SESSION_RE.test(toS)) return fail(400, 'Choose the source and target sessions');
      if (fromS === toS) return fail(400, 'Choose two different sessions');
      if (cfMatch[2]) {
        if (kind === 'form') {
          const target = new Map(formTeacherRows(toS).map(r => [`${r.classCode}|${r.armId || ''}`, r]));
          const rows = formTeacherRows(fromS).filter(r => r.teacher).map(r => {
            const t = target.get(`${r.classCode}|${r.armId || ''}`);
            return { classCode: r.classCode, armId: r.armId, label: armLabel(r.classLabel, r.armName), teacherId: r.teacher.id, teacherName: r.teacher.name, existing: t?.status === 'direct' ? t.teacher?.name || 'Unassigned' : '' };
          });
          return send(200, { rows });
        }
        const target = new Map(subjectTeacherRows(toS).map(r => [r.id, r]));
        const rows = subjectTeacherRows(fromS).filter(r => r.teachers.length).map(r => ({
          classSubjectId: r.id, label: `${r.classLabel} · ${r.subject}${r.armName ? ` (${r.armName})` : ''}`,
          teachers: r.teachers.map(t => ({ id: t.id, name: t.name, inCharge: t.inCharge })),
          existing: target.get(r.id)?.status === 'direct' ? target.get(r.id).teachers.map(t => t.name).join(', ') || 'Unassigned' : '',
        }));
        return send(200, { rows });
      }
      const rows = Array.isArray(b.rows) ? b.rows : [];
      let copied = 0;
      tx(() => {
        for (const r of rows) {
          if (kind === 'form') {
            const classCode = cleanText(r.classCode).toUpperCase();
            const armId = Number(r.armId) || null;
            const teacherId = cleanText(r.teacherId).toUpperCase() || null;
            const has = currentRecord('form', toS, { classCode, armId });
            if (has && !r.override) continue;
            recordForm(toS, classCode, armId, teacherId, 'Carried forward', user.id);
            if (toS === activeSession) setLiveFormTeacher(classCode, armId, teacherId);
          } else {
            const csId = Number(r.classSubjectId);
            const cs = one('SELECT * FROM class_subjects WHERE id = ?', csId);
            if (!cs) continue;
            const has = one('SELECT id FROM subject_teacher_allocations WHERE session_label = ? AND class_subject_id = ? LIMIT 1', toS, csId);
            if (has && !r.override) continue;
            run('UPDATE subject_teacher_allocations SET removed_at = ? WHERE session_label = ? AND class_subject_id = ? AND removed_at IS NULL', nowIso(), toS, csId);
            for (const t of Array.isArray(r.teachers) ? r.teachers : []) {
              const tid = cleanText(t.id).toUpperCase();
              if (!one("SELECT id FROM users WHERE id = ? AND role IN ('teacher', 'admin')", tid)) continue;
              run('INSERT INTO subject_teacher_allocations (session_label, class_subject_id, teacher_id, in_charge, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?)', toS, csId, tid, t.inCharge ? 1 : 0, user.id, nowIso());
              if (toS === activeSession) liveAddSubjectTeacher(one('SELECT * FROM class_subjects WHERE id = ?', csId), tid, !!t.inCharge);
            }
          }
          copied++;
        }
        ensureSession(toS);
      });
      return send(200, { ok: true, copied, setup: adminSetupPayload() });
    }

    // ── Academic leadership ──
    if (m === 'GET' && p === '/api/admin/term-setup/leadership') {
      const session = cleanText(url.searchParams.get('session')) || activeSession;
      return send(200, { session, sections: leadershipView(session), permissions: LEADERSHIP_PERMISSIONS });
    }
    if ((m === 'PUT' || m === 'DELETE') && p === '/api/admin/term-setup/leadership') {
      const b = await readJson(req);
      const session = cleanText(b.session) || activeSession;
      const scope = b.scope === 'section' ? 'section' : 'class';
      const key = cleanText(b.key);
      if (!key) return fail(400, 'Choose the section or class');
      tx(() => {
        run('UPDATE leadership_allocations SET removed_at = ? WHERE session_label = ? AND scope = ? AND scope_key = ? AND removed_at IS NULL', nowIso(), session, scope, key);
        if (m === 'PUT') {
          const staffId = cleanText(b.staffId).toUpperCase();
          if (!one("SELECT id FROM users WHERE id = ? AND role IN ('teacher', 'admin', 'staff')", staffId)) throw Object.assign(new Error('Choose a staff member'), { status: 400 });
          const perms = (Array.isArray(b.permissions) ? b.permissions : []).filter(k => PERMISSION_KEYS.includes(k));
          run('INSERT INTO leadership_allocations (session_label, scope, scope_key, staff_id, title, notes, permissions, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            session, scope, key, staffId, cleanText(b.title).slice(0, 80) || null, cleanText(b.notes).slice(0, 300) || null, JSON.stringify(perms), user.id, nowIso());
        }
      });
      return send(200, { ok: true, sections: leadershipView(session) });
    }
    if (m === 'GET' && p === '/api/admin/term-setup/leadership/history') {
      const rows = all('SELECT * FROM leadership_allocations WHERE scope = ? AND scope_key = ? ORDER BY id DESC', url.searchParams.get('scope') === 'section' ? 'section' : 'class', cleanText(url.searchParams.get('key')))
        .map(r => ({ session: r.session_label, staff: staffName(r.staff_id)?.name || r.staff_id, title: r.title || '', by: staffName(r.allocated_by)?.name || r.allocated_by, at: r.allocated_at, removed: !!r.removed_at }));
      return send(200, { history: rows });
    }
    const lcf = p.match(/^\/api\/admin\/term-setup\/leadership\/carry-forward(\/preview)?$/);
    if (m === 'POST' && lcf) {
      const b = await readJson(req);
      const fromS = cleanText(b.from);
      const toS = cleanText(b.to);
      if (!SESSION_RE.test(fromS) || !SESSION_RE.test(toS) || fromS === toS) return fail(400, 'Choose two different sessions');
      const source = all('SELECT * FROM leadership_allocations WHERE session_label = ? AND removed_at IS NULL ORDER BY id', fromS);
      const plan = source.map(r => ({ r, skip: !!one('SELECT id FROM leadership_allocations WHERE session_label = ? AND scope = ? AND scope_key = ? AND removed_at IS NULL', toS, r.scope, r.scope_key) }));
      if (lcf[1]) return send(200, { copy: plan.filter(x => !x.skip).length, skip: plan.filter(x => x.skip).length });
      tx(() => plan.filter(x => !x.skip).forEach(({ r }) => run('INSERT INTO leadership_allocations (session_label, scope, scope_key, staff_id, title, notes, permissions, allocated_by, allocated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        toS, r.scope, r.scope_key, r.staff_id, r.title, r.notes, r.permissions, user.id, nowIso())));
      return send(200, { ok: true, copied: plan.filter(x => !x.skip).length, skipped: plan.filter(x => x.skip).length });
    }

    return false;
  }

  return { createSchema, handle, termNames, holidayDates, applySessionAllocations, ensureSession };
};
