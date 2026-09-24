const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;

function loadLocalEnv() {
  const files = [
    process.env.EMAIL_SETTINGS_FILE,
    path.join(ROOT, 'email-settings.env'),
    path.join(ROOT, '.env'),
  ].filter(Boolean);
  files.forEach(file => {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!/^[A-Z0-9_]+$/.test(key) || Object.prototype.hasOwnProperty.call(process.env, key)) return;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  });
}

loadLocalEnv();

const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_PATH = path.join(DATA_DIR, 'school.sqlite');
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const COOKIE_NAME = 'ls_session';
const EXAM_TYPES = ['Mid-Term Exam', 'Final Exam'];
const DEFAULT_STUDENT_PASSWORD = '1234';
const AFFECTIVE_SKILLS = [
  ['punctuality', 'punctuality', 'Punctuality'],
  ['attentiveness', 'attentiveness', 'Attentiveness'],
  ['neatness', 'neatness', 'Neatness'],
  ['honesty', 'honesty', 'Honesty'],
  ['politeness', 'politeness', 'Politeness'],
  ['perseverance', 'perseverance', 'Perseverance'],
  ['relationshipWithOthers', 'relationship_with_others', 'Relationship with Others'],
  ['organizationAbility', 'organization_ability', 'Organization Ability'],
];
const PSYCHOMOTOR_SKILLS = [
  ['handWriting', 'hand_writing', 'Hand Writing'],
  ['drawingAndPainting', 'drawing_and_painting', 'Drawing and Painting'],
  ['speechVerbalFluency', 'speech_verbal_fluency', 'Speech / Verbal Fluency'],
  ['quantitativeReasoning', 'quantitative_reasoning', 'Quantitative Reasoning'],
  ['processingSpeed', 'processing_speed', 'Processing Speed'],
  ['retentiveness', 'retentiveness', 'Retentiveness'],
  ['visualMemory', 'visual_memory', 'Visual Memory'],
  ['publicSpeaking', 'public_speaking', 'Public Speaking'],
  ['sportsAndGames', 'sports_and_games', 'Sports and Games'],
];
const SKILL_COLUMNS = [...AFFECTIVE_SKILLS, ...PSYCHOMOTOR_SKILLS];
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const REPORT_DIR = path.join(DATA_DIR, 'published_reports');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });

function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

const SCRYPT_KEYLEN = 64;
const HASHED_PASSWORD_RE = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

// Hashes a plaintext password into a `salt:hash` string using scrypt with a
// random per-password salt. No external dependencies (node:crypto only).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function isHashedPassword(value) {
  return typeof value === 'string' && HASHED_PASSWORD_RE.test(value);
}

// Verifies a plaintext password against a stored `salt:hash` value using a
// timing-safe comparison. Returns false (never throws) for malformed/legacy
// stored values so callers can safely treat that as "no match".
function verifyPassword(password, stored) {
  if (!isHashedPassword(stored)) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const candidateBuffer = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
    if (candidateBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(candidateBuffer, hashBuffer);
  } catch {
    return false;
  }
}

// One-time (idempotent) startup migration: any password already stored in
// plaintext (i.e. not matching the salt:hash format) gets hashed in place so
// existing accounts keep working without anyone needing to reset anything.
function migratePlaintextPasswords() {
  const users = all('SELECT id, password FROM users');
  users.forEach(u => {
    if (!isHashedPassword(u.password)) {
      run('UPDATE users SET password = ? WHERE id = ?', hashPassword(u.password), u.id);
    }
  });
}

// One-time (idempotent) startup migration: some seeded students never got a
// matching `users` login row, so they exist in the roster but can never sign
// in. Back-fill a login account (default password) for any such student.
function backfillMissingStudentUsers() {
  const orphans = all(
    `SELECT st.id, st.name, st.initials, st.class_code AS classCode
     FROM students st
     LEFT JOIN users u ON u.id = st.id
     WHERE u.id IS NULL`
  );
  orphans.forEach(st => {
    run(
      `INSERT INTO users (id, role, password, name, first_name, initials, grade)
       VALUES (?, 'student', ?, ?, ?, ?, ?)`,
      st.id,
      hashPassword(DEFAULT_STUDENT_PASSWORD),
      st.name,
      firstNameFromName(st.name),
      st.initials || initialsFromName(st.name),
      `Class ${st.classCode}`
    );
  });
}

function cleanText(value) {
  return String(value || '').trim();
}

// Used by the finance/payroll routes: returns a non-negative finite number,
// or null when the input isn't a valid non-negative amount.
function parseMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function initialsFromName(name) {
  return cleanText(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || 'NA';
}

function firstNameFromName(name) {
  return cleanText(name).split(/\s+/)[0] || cleanText(name);
}

// Returns a function that mints fresh STU-<year>-<sequence> IDs, continuing
// from whatever is already in the table. The counter lives in the closure so
// a batch import can mint many IDs in a row without colliding with itself.
function makeStudentIdGenerator() {
  const academic = activeAcademic();
  const yearMatch = String(academic?.sessionLabel || '').match(/(\d{4})(?!.*\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const prefix = `STU-${year}-`;
  let maxSeq = 0;
  for (const row of all('SELECT id FROM students WHERE id LIKE ?', `${prefix}%`)) {
    const m = row.id.match(/-(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return () => {
    maxSeq += 1;
    return `${prefix}${String(maxSeq).padStart(3, '0')}`;
  };
}

function normalizePercent(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new Error('Average and attendance must be whole numbers from 0 to 100');
  }
  return number;
}

function ensureColumn(table, column, definition) {
  const exists = all(`PRAGMA table_info(${table})`).some(row => row.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function valueFromMeta(key, fallback = '') {
  return one('SELECT value FROM schema_meta WHERE key = ?', key)?.value || fallback;
}

function setMeta(key, value) {
  run(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    String(value || '')
  );
}

// Grade-based fallback comment: the highest min_score band the average
// qualifies for, e.g. a band of 80-100 beats a band of 0-100 for a 92%.
function attendanceCounts(studentId, sessionType) {
  const total = one('SELECT COUNT(*) AS c FROM attendance_records WHERE person_id = ? AND session_type = ?', studentId, sessionType).c;
  const present = one(
    "SELECT COUNT(*) AS c FROM attendance_records WHERE person_id = ? AND session_type = ? AND status IN ('present','late')",
    studentId, sessionType
  ).c;
  const absent = one(
    "SELECT COUNT(*) AS c FROM attendance_records WHERE person_id = ? AND session_type = ? AND status = 'absent'",
    studentId, sessionType
  ).c;
  return { total, present, absent };
}

function commentBankMatch(avgPct) {
  if (avgPct === null || avgPct === undefined) return null;
  const row = one(
    'SELECT comment FROM comment_bank WHERE ? >= min_score AND ? <= max_score ORDER BY min_score DESC LIMIT 1',
    avgPct, avgPct
  );
  return row ? row.comment : null;
}

// A student's report always needs a Form Teacher's and Head of School's
// comment. Preference order: (1) a comment someone actually typed for this
// student this exam, (2) a grade-appropriate line from the Comments Bank,
// (3) the school-wide default string, so a report is never left blank.
function resolveReportComments({ academicId, studentId, examType, average }) {
  const manual = one(
    'SELECT teacher_comment AS teacherComment, head_comment AS headComment FROM report_comments WHERE academic_id = ? AND student_id = ? AND exam_type = ?',
    academicId, studentId, examType
  );
  const bankComment = commentBankMatch(average);
  const teacherComment = (manual?.teacherComment && manual.teacherComment.trim())
    || bankComment
    || valueFromMeta('teacher_comment_default', 'Well done! Your result is remarkable. Do not relent in your efforts.');
  const headComment = (manual?.headComment && manual.headComment.trim())
    || bankComment
    || valueFromMeta('head_comment_default', 'Great work! Your diligence in your academics is impressive.');
  return { teacherComment, headComment };
}

function createSchema() {
  // One-time destructive rebuilds for the CBT tables while the feature is still
  // pre-launch (no real exam data depends on the old shape yet) — drop and let
  // the CREATE TABLE statements below recreate with the current schema.
  const tableHasColumn = (table, column) =>
    all(`PRAGMA table_info(${table})`).some(row => row.name === column);
  if (tableHasColumn('cbt_questions', 'id') && !tableHasColumn('cbt_questions', 'marks')) {
    db.exec('DROP TABLE IF EXISTS cbt_questions');
  }
  if (tableHasColumn('cbt_scores', 'id') && !tableHasColumn('cbt_scores', 'schedule_subject_id')) {
    db.exec('DROP TABLE IF EXISTS cbt_scores');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      initials TEXT NOT NULL,
      teacher_type TEXT,
      chip TEXT,
      grade TEXT,
      signature_path TEXT
    );

    CREATE TABLE IF NOT EXISTS academic_terms (
      id INTEGER PRIMARY KEY,
      session_label TEXT NOT NULL,
      term_label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS classes (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS class_categories (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS class_arms (
      id INTEGER PRIMARY KEY,
      class_code TEXT NOT NULL REFERENCES classes(code) ON DELETE CASCADE,
      name TEXT NOT NULL,
      form_teacher_id TEXT REFERENCES users(id),
      UNIQUE(class_code, name)
    );

    CREATE TABLE IF NOT EXISTS subject_types (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      type TEXT
    );

    CREATE TABLE IF NOT EXISTS class_subjects (
      id INTEGER PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_code TEXT NOT NULL REFERENCES classes(code) ON DELETE CASCADE,
      class_arm_id INTEGER REFERENCES class_arms(id),
      term TEXT,
      pass_mark INTEGER,
      full_mark INTEGER,
      attributes TEXT,
      teacher_in_charge_id TEXT REFERENCES users(id),
      assisting_teacher_ids TEXT,
      UNIQUE(subject_id, class_code, class_arm_id, term)
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initials TEXT NOT NULL,
      gender TEXT NOT NULL,
      avg INTEGER NOT NULL DEFAULT 0,
      att INTEGER NOT NULL DEFAULT 0,
      class_code TEXT NOT NULL REFERENCES classes(code),
      parent_email TEXT,
      photo_path TEXT
    );

    CREATE TABLE IF NOT EXISTS score_divisions (
      id INTEGER PRIMARY KEY,
      class_code TEXT NOT NULL REFERENCES classes(code),
      exam_type TEXT NOT NULL,
      name TEXT NOT NULL,
      max_mark REAL NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS exam_schedule (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      class_code TEXT NOT NULL REFERENCES classes(code),
      subject_id INTEGER REFERENCES subjects(id),
      exam_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      venue TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cbt_questions (
      id INTEGER PRIMARY KEY,
      class_code TEXT NOT NULL REFERENCES classes(code),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      question_type TEXT NOT NULL DEFAULT 'Multiple Choice Question'
        CHECK(question_type IN ('Multiple Choice Question','Fill in the Gap / Subjective','Explanatory Answer / Theory')),
      question_text TEXT NOT NULL,
      marks REAL NOT NULL DEFAULT 1,
      options TEXT,
      helper_hint TEXT,
      tags TEXT,
      answer_explanation TEXT,
      vetted INTEGER NOT NULL DEFAULT 1,
      taken_before INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cbt_instruction_sets (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      class_code TEXT REFERENCES classes(code),
      subject_id INTEGER REFERENCES subjects(id),
      instructions TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cbt_schedules (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      session_label TEXT NOT NULL,
      term_label TEXT NOT NULL,
      for_exam TEXT,
      mode TEXT NOT NULL DEFAULT 'Computer Based',
      start_date TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cbt_schedule_classes (
      id INTEGER PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES cbt_schedules(id) ON DELETE CASCADE,
      class_code TEXT NOT NULL REFERENCES classes(code),
      UNIQUE(schedule_id, class_code)
    );

    CREATE TABLE IF NOT EXISTS cbt_schedule_subjects (
      id INTEGER PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES cbt_schedules(id) ON DELETE CASCADE,
      class_code TEXT NOT NULL REFERENCES classes(code),
      class_arm_id INTEGER REFERENCES class_arms(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      duration_minutes INTEGER NOT NULL,
      exam_date TEXT,
      exam_time TEXT,
      supervisor_id TEXT REFERENCES users(id),
      mode TEXT NOT NULL DEFAULT 'Computer Based' CHECK(mode IN ('Computer Based','Paper Based','Others')),
      venue TEXT,
      visible_to_students INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','live','closed')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cbt_scores (
      id INTEGER PRIMARY KEY,
      schedule_subject_id INTEGER NOT NULL REFERENCES cbt_schedule_subjects(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id),
      score REAL NOT NULL,
      total_marks REAL NOT NULL DEFAULT 100,
      questions_presented INTEGER,
      questions_attempted INTEGER,
      recorded_by TEXT REFERENCES users(id),
      recorded_at TEXT NOT NULL,
      UNIQUE(schedule_subject_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_attempts (
      id INTEGER PRIMARY KEY,
      schedule_subject_id INTEGER NOT NULL REFERENCES cbt_schedule_subjects(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      UNIQUE(schedule_subject_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_attempt_answers (
      id INTEGER PRIMARY KEY,
      attempt_id INTEGER NOT NULL REFERENCES cbt_attempts(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      selected_option INTEGER,
      UNIQUE(attempt_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS student_tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_tag_assignments (
      id INTEGER PRIMARY KEY,
      tag_id INTEGER NOT NULL REFERENCES student_tags(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL,
      UNIQUE(tag_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS communication_book (
      id INTEGER PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      category TEXT,
      message TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extracurricular_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      teacher_in_charge_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extracurricular_members (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES extracurricular_groups(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS admission_applications (
      id INTEGER PRIMARY KEY,
      applicant_name TEXT NOT NULL,
      gender TEXT,
      class_code TEXT REFERENCES classes(code),
      parent_name TEXT,
      parent_phone TEXT,
      parent_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      notes TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      converted_student_id TEXT REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY,
      record_date TEXT NOT NULL,
      person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
      person_id TEXT NOT NULL REFERENCES users(id),
      class_code TEXT REFERENCES classes(code),
      session_type TEXT NOT NULL DEFAULT 'daily' CHECK(session_type IN ('daily','lesson','morning','afternoon')),
      subject_id INTEGER REFERENCES subjects(id),
      status TEXT NOT NULL CHECK(status IN ('present','absent','late','permission')),
      marked_by TEXT NOT NULL REFERENCES users(id),
      marked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_lookup
      ON attendance_records (person_type, session_type, record_date, class_code);

    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id INTEGER PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_type TEXT NOT NULL CHECK(teacher_type IN ('class_teacher','subject_teacher')),
      class_code TEXT NOT NULL REFERENCES classes(code),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      UNIQUE(teacher_id, class_code, subject_id)
    );

    CREATE TABLE IF NOT EXISTS result_batches (
      id INTEGER PRIMARY KEY,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
      assignment_id INTEGER NOT NULL REFERENCES teacher_assignments(id),
      teacher_id TEXT NOT NULL REFERENCES users(id),
      class_code TEXT NOT NULL REFERENCES classes(code),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      exam_type TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      vetted_at TEXT,
      vetted_by TEXT REFERENCES users(id),
      UNIQUE(academic_id, assignment_id, exam_type)
    );

    CREATE TABLE IF NOT EXISTS result_entries (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES result_batches(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id),
      ca_score INTEGER NOT NULL,
      exam_score INTEGER,
      total_score INTEGER NOT NULL,
      UNIQUE(batch_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_publications (
      id INTEGER PRIMARY KEY,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
      student_id TEXT NOT NULL REFERENCES students(id),
      class_code TEXT NOT NULL REFERENCES classes(code),
      exam_type TEXT NOT NULL,
      pdf_path TEXT NOT NULL,
      parent_email TEXT,
      email_status TEXT NOT NULL,
      email_error TEXT,
      published_by TEXT NOT NULL REFERENCES users(id),
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_skill_ratings (
      id INTEGER PRIMARY KEY,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
      student_id TEXT NOT NULL REFERENCES students(id),
      class_code TEXT NOT NULL REFERENCES classes(code),
      exam_type TEXT NOT NULL,
      rated_by TEXT NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL,
      punctuality INTEGER,
      attentiveness INTEGER,
      neatness INTEGER,
      honesty INTEGER,
      politeness INTEGER,
      perseverance INTEGER,
      relationship_with_others INTEGER,
      organization_ability INTEGER,
      hand_writing INTEGER,
      drawing_and_painting INTEGER,
      speech_verbal_fluency INTEGER,
      quantitative_reasoning INTEGER,
      processing_speed INTEGER,
      retentiveness INTEGER,
      visual_memory INTEGER,
      public_speaking INTEGER,
      sports_and_games INTEGER,
      UNIQUE(academic_id, student_id, class_code, exam_type)
    );

    CREATE TABLE IF NOT EXISTS comment_bank (
      id INTEGER PRIMARY KEY,
      min_score INTEGER NOT NULL,
      max_score INTEGER NOT NULL,
      comment TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_comments (
      id INTEGER PRIMARY KEY,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_code TEXT NOT NULL REFERENCES classes(code),
      exam_type TEXT NOT NULL,
      teacher_comment TEXT,
      head_comment TEXT,
      updated_at TEXT,
      UNIQUE(academic_id, student_id, class_code, exam_type)
    );
  `);
  ensureColumn('users', 'signature_path', 'TEXT');
  ensureColumn('users', 'email', 'TEXT');
  ensureColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('users', 'reset_token', 'TEXT');
  ensureColumn('users', 'reset_token_expires', 'TEXT');
  ensureColumn('academic_terms', 'start_date', 'TEXT');
  ensureColumn('academic_terms', 'end_date', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS term_holidays (
      id INTEGER PRIMARY KEY,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
      holiday_date TEXT NOT NULL,
      label TEXT NOT NULL,
      UNIQUE(academic_id, holiday_date)
    );
  `);
  ensureColumn('students', 'parent_email', 'TEXT');
  ensureColumn('students', 'photo_path', 'TEXT');
  ensureColumn('result_batches', 'vetted_at', 'TEXT');
  ensureColumn('result_batches', 'vetted_by', 'TEXT REFERENCES users(id)');
  ensureColumn('students', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn('students', 'enrolled_at', 'TEXT');
  ensureColumn('students', 'class_arm_id', 'INTEGER REFERENCES class_arms(id)');
  ensureColumn('result_entries', 'is_absent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('result_entries', 'is_excluded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('classes', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('classes', 'category', 'TEXT');
  ensureColumn('subjects', 'code', 'TEXT');
  ensureColumn('subjects', 'type', 'TEXT');
  if (one('SELECT COUNT(*) AS count FROM class_categories').count === 0) {
    ['Creche', 'Nursery', 'Primary', 'Secondary'].forEach(name =>
      run('INSERT OR IGNORE INTO class_categories (name) VALUES (?)', name)
    );
  }
  if (one('SELECT COUNT(*) AS count FROM subject_types').count === 0) {
    ['Core', 'Elective', 'Vocational'].forEach(name =>
      run('INSERT OR IGNORE INTO subject_types (name) VALUES (?)', name)
    );
  }
}

// ── FINANCE: HRM/PAYROLL + INCOME & EXPENSES (feature/finance-payroll-expenses) ──
// Kept in its own schema/seed/route blocks (rather than editing the shared
// createSchema()/seedDatabase() bodies) so this sub-area merges cleanly
// alongside sibling finance branches (Fees/Bursary, Store & Accounting).
function createFinancePayrollSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_pay_rates (
      staff_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      base_salary REAL NOT NULL DEFAULT 0,
      allowances REAL NOT NULL DEFAULT 0,
      deductions REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_salaries (
      id INTEGER PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES users(id),
      period TEXT NOT NULL,
      base_salary REAL NOT NULL DEFAULT 0,
      allowances REAL NOT NULL DEFAULT 0,
      deductions REAL NOT NULL DEFAULT 0,
      net_salary REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
      paid_at TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(staff_id, period)
    );

    CREATE TABLE IF NOT EXISTS staff_loans (
      id INTEGER PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES users(id),
      loan_type TEXT NOT NULL DEFAULT 'loan' CHECK(loan_type IN ('loan','advance')),
      amount REAL NOT NULL,
      reason TEXT,
      monthly_deduction REAL NOT NULL DEFAULT 0,
      repayment_status TEXT NOT NULL DEFAULT 'outstanding' CHECK(repayment_status IN ('outstanding','repaying','repaid')),
      issued_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expense_requests (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      amount REAL NOT NULL,
      reason TEXT,
      requested_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','dispensed')),
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      requested_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      request_id INTEGER REFERENCES expense_requests(id),
      recorded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_categories (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('expense','income')),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(type, name)
    );

    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      income_date TEXT NOT NULL,
      recorded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
  `);
}

function periodString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function seedFinancePayrollDemoData() {
  const seeded = one('SELECT value FROM schema_meta WHERE key = ?', 'finance_payroll_seed_version');
  if (seeded && seeded.value === '1') return;

  const staffRows = all("SELECT id FROM users WHERE role IN ('teacher','admin') ORDER BY id");
  if (!staffRows.length) return; // main seed hasn't run yet (shouldn't happen, but stay safe)

  db.exec('BEGIN');
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const rateDefaults = {
      'ADM-001': [450000, 60000, 25000],
      'TCH-001': [280000, 35000, 15000],
      'TCH-002': [260000, 30000, 12000],
    };
    staffRows.forEach(s => {
      const [base, allow, ded] = rateDefaults[s.id] || [220000, 20000, 10000];
      run(
        `INSERT INTO staff_pay_rates (staff_id, base_salary, allowances, deductions, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(staff_id) DO NOTHING`,
        s.id, base, allow, ded, nowIso
      );
    });

    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevPeriod = periodString(prevDate);
    const currentPeriod = periodString(now);
    staffRows.forEach(s => {
      const [base, allow, ded] = rateDefaults[s.id] || [220000, 20000, 10000];
      const net = base + allow - ded;
      const prevPaidAt = new Date(prevDate.getFullYear(), prevDate.getMonth(), 28).toISOString();
      run(
        `INSERT INTO staff_salaries (staff_id, period, base_salary, allowances, deductions, net_salary, status, paid_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, 'ADM-001', ?)`,
        s.id, prevPeriod, base, allow, ded, net, prevPaidAt, prevPaidAt
      );
    });
    // Leave the current period unprocessed for TCH-002 and ADM-001, but show
    // one staff member already processed-but-unpaid so both screens have data.
    const [tBase, tAllow, tDed] = rateDefaults['TCH-001'];
    run(
      `INSERT INTO staff_salaries (staff_id, period, base_salary, allowances, deductions, net_salary, status, created_by, created_at)
       VALUES ('TCH-001', ?, ?, ?, ?, ?, 'pending', 'ADM-001', ?)`,
      currentPeriod, tBase, tAllow, tDed, tBase + tAllow - tDed, nowIso
    );

    run(
      `INSERT INTO staff_loans (staff_id, loan_type, amount, reason, monthly_deduction, repayment_status, issued_at, created_by)
       VALUES ('TCH-001', 'loan', 150000, 'Emergency medical expense for family member', 25000, 'repaying', ?, 'ADM-001')`,
      new Date(now.getFullYear(), now.getMonth() - 2, 10).toISOString()
    );
    run(
      `INSERT INTO staff_loans (staff_id, loan_type, amount, reason, monthly_deduction, repayment_status, issued_at, created_by)
       VALUES ('TCH-002', 'advance', 40000, 'Salary advance ahead of school resumption', 0, 'outstanding', ?, 'ADM-001')`,
      new Date(now.getFullYear(), now.getMonth(), 3).toISOString()
    );

    const reqBase = new Date(now.getFullYear(), now.getMonth(), 2);
    const req1 = run(
      `INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, requested_at)
       VALUES ('Classroom cleaning supplies', 'Facilities', 18500, 'Restock cleaning supplies for Primary block', 'TCH-001', 'pending', ?)`,
      reqBase.toISOString()
    );
    const req2 = run(
      `INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, approved_by, approved_at, requested_at)
       VALUES ('Inter-house sports refreshments', 'Events', 65000, 'Drinks and snacks for sports day', 'TCH-002', 'approved', 'ADM-001', ?, ?)`,
      reqBase.toISOString(), reqBase.toISOString()
    );
    run(
      `INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, approved_by, approved_at, requested_at)
       VALUES ('New printer for front office', 'Equipment', 220000, 'Old printer beyond repair', 'ADM-001', 'rejected', 'ADM-001', ?, ?)`,
      reqBase.toISOString(), reqBase.toISOString()
    );
    const dispensedAt = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();
    const req4 = run(
      `INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, approved_by, approved_at, requested_at)
       VALUES ('Diesel for generator', 'Utilities', 45000, 'Fuel for backup generator', 'TCH-001', 'dispensed', 'ADM-001', ?, ?)`,
      dispensedAt, dispensedAt
    );
    run(
      `INSERT INTO expenses (category, description, amount, expense_date, request_id, recorded_by, created_at)
       VALUES ('Utilities', 'Diesel for generator', 45000, ?, ?, 'ADM-001', ?)`,
      dispensedAt.slice(0, 10), Number(req4.lastInsertRowid), dispensedAt
    );

    [
      ['Stationery', 'Exercise books and office stationery', 32000, new Date(now.getFullYear(), now.getMonth(), 6)],
      ['Maintenance', 'Plumbing repairs in staff wing', 27500, new Date(now.getFullYear(), now.getMonth(), 9)],
      ['Utilities', 'Electricity bill for the term', 98000, new Date(now.getFullYear(), now.getMonth() - 1, 20)],
    ].forEach(([category, description, amount, date]) => run(
      `INSERT INTO expenses (category, description, amount, expense_date, recorded_by, created_at)
       VALUES (?, ?, ?, ?, 'ADM-001', ?)`,
      category, description, amount, date.toISOString().slice(0, 10), date.toISOString()
    ));

    [
      ['School Fees', 'Term 2 fee payments (bulk deposit)', 4250000, new Date(now.getFullYear(), now.getMonth(), 4)],
      ['Donations', 'PTA fundraising contribution', 150000, new Date(now.getFullYear(), now.getMonth(), 11)],
      ['Uniform Sales', 'Sale of school uniforms', 62000, new Date(now.getFullYear(), now.getMonth() - 1, 18)],
    ].forEach(([category, description, amount, date]) => run(
      `INSERT INTO income_entries (category, description, amount, income_date, recorded_by, created_at)
       VALUES (?, ?, ?, ?, 'ADM-001', ?)`,
      category, description, amount, date.toISOString().slice(0, 10), date.toISOString()
    ));

    run(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'finance_payroll_seed_version',
      '1'
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedDatabase() {
  const seeded = one('SELECT value FROM schema_meta WHERE key = ?', 'seed_version');
  if (seeded && seeded.value === '1') return;

  db.exec('BEGIN');
  try {
    run('DELETE FROM result_entries');
    run('DELETE FROM result_batches');
    run('DELETE FROM teacher_assignments');
    run('DELETE FROM students');
    run('DELETE FROM subjects');
    run('DELETE FROM classes');
    run('DELETE FROM academic_terms');
    run('DELETE FROM sessions');
    run('DELETE FROM users');

    const users = [
      ['STU-2024-0421', 'student', 'amara123', 'Amara Osei', 'Amara', 'AO', null, null, 'Grade 4 - Class 4B'],
      ['STU-2024-0388', 'student', 'kwame456', 'Kwame Mensah', 'Kwame', 'KM', null, null, 'Grade 4 - Class 4A'],
      ['TCH-001', 'teacher', 'teach123', 'Mr. Adeyemi', 'Mr. Adeyemi', 'AA', 'class_teacher', 'MR. ADEYEMI', null],
      ['TCH-002', 'teacher', 'teach456', 'Mrs. Eze', 'Mrs. Eze', 'ME', 'subject_teacher', 'MRS. EZE', null],
      ['ADM-001', 'admin', 'admin123', 'Mrs. Chukwu', 'Mrs. Chukwu', 'MC', null, null, null],
    ];
    users.forEach(u => {
      const row = [...u];
      row[2] = hashPassword(row[2]);
      return run(
        `INSERT INTO users (id, role, password, name, first_name, initials, teacher_type, chip, grade)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...row
      );
    });

    run('INSERT INTO academic_terms (id, session_label, term_label, is_active) VALUES (?, ?, ?, ?)', 1, '2025/2026', 'Term 2', 1);

    [
      ['4A', 'Class 4A'],
      ['4B', 'Class 4B'],
      ['5A', 'Class 5A'],
    ].forEach(c => run('INSERT INTO classes (code, label) VALUES (?, ?)', ...c));

    [
      'Mathematics',
      'English Language',
      'Basic Science',
      'Social Studies',
      'Creative Arts',
      'French',
      'ICT',
      'Physical Education',
    ].forEach(name => run('INSERT INTO subjects (name) VALUES (?)', name));

    const students = [
      ['STU-2024-0421', 'Amara Osei', 'AO', 'F', 81, 94, '4B'],
      ['STU-2024-0388', 'Kwame Mensah', 'KM', 'M', 76, 89, '4B'],
      ['STU-2024-0412', 'Chidera Nwosu', 'CN', 'M', 84, 97, '4B'],
      ['STU-2024-0430', 'Fatima Bello', 'FB', 'F', 72, 91, '4B'],
      ['STU-2024-0441', 'Emeka Okafor', 'EO', 'M', 65, 88, '4B'],
      ['STU-2024-0455', 'Yewande Adebisi', 'YA', 'F', 90, 100, '4B'],
      ['STU-2024-0460', 'Kofi Asante', 'KA', 'M', 58, 83, '4B'],
      ['STU-2024-0471', 'Blessing Eze', 'BE', 'F', 79, 95, '4B'],
      ['STU-2024-0482', 'Usman Garba', 'UG', 'M', 68, 86, '4B'],
      ['STU-2024-0493', 'Sade Oluwole', 'SO', 'F', 88, 98, '4B'],
      ['STU-2024-0504', 'Tunde Bakare', 'TB', 'M', 73, 90, '4B'],
      ['STU-2024-0515', 'Ngozi Obi', 'NO', 'F', 82, 93, '4B'],
      ['STU-2024-0301', 'Ade Coker', 'AC', 'M', 77, 92, '4A'],
      ['STU-2024-0312', 'Miriam Asare', 'MA', 'F', 85, 96, '4A'],
      ['STU-2024-0323', 'Chukwudi Onu', 'CO', 'M', 62, 80, '4A'],
      ['STU-2024-0334', 'Habiba Musa', 'HM', 'F', 91, 99, '4A'],
      ['STU-2024-0345', 'Seun Adesanya', 'SA', 'M', 70, 87, '4A'],
      ['STU-2024-0356', 'Adaeze Nkem', 'AN', 'F', 78, 94, '4A'],
      ['STU-2024-0367', 'Femi Ogunyemi', 'FO', 'M', 55, 75, '4A'],
      ['STU-2024-0378', 'Efua Mensah', 'EM', 'F', 83, 97, '4A'],
      ['STU-2023-0101', 'Zara Ahmed', 'ZA', 'F', 89, 95, '5A'],
      ['STU-2023-0112', 'Emmanuel Diop', 'ED', 'M', 74, 88, '5A'],
      ['STU-2023-0123', 'Nneka Uche', 'NU', 'F', 81, 92, '5A'],
      ['STU-2023-0134', 'Oluwaseun Bada', 'OB', 'M', 67, 84, '5A'],
      ['STU-2023-0145', 'Amina Kante', 'AK', 'F', 93, 100, '5A'],
      ['STU-2023-0156', 'Samuel Owusu', 'SO', 'M', 71, 89, '5A'],
    ];
    students.forEach(s => run(
      'INSERT INTO students (id, name, initials, gender, avg, att, class_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ...s
    ));

    const mathId = one('SELECT id FROM subjects WHERE name = ?', 'Mathematics').id;
    const englishId = one('SELECT id FROM subjects WHERE name = ?', 'English Language').id;
    [
      ['TCH-001', 'class_teacher', '4A', mathId],
      ['TCH-001', 'class_teacher', '4B', mathId],
      ['TCH-002', 'subject_teacher', '4B', englishId],
      ['TCH-002', 'subject_teacher', '5A', englishId],
    ].forEach(a => run(
      'INSERT INTO teacher_assignments (teacher_id, teacher_type, class_code, subject_id) VALUES (?, ?, ?, ?)',
      ...a
    ));

    const assignment = one(
      `SELECT id FROM teacher_assignments
       WHERE teacher_id = ? AND class_code = ? AND subject_id = ?`,
      'TCH-001',
      '4B',
      mathId
    );
    const savedAt = '2026-05-10T14:32:00.000Z';
    const batch = run(
      `INSERT INTO result_batches (academic_id, assignment_id, teacher_id, class_code, subject_id, exam_type, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      1,
      assignment.id,
      'TCH-001',
      '4B',
      mathId,
      'Mid-Term Exam',
      savedAt
    );
    const batchId = Number(batch.lastInsertRowid);
    [
      ['STU-2024-0421', 34, null, 34],
      ['STU-2024-0388', 30, null, 30],
      ['STU-2024-0412', 36, null, 36],
      ['STU-2024-0430', 29, null, 29],
      ['STU-2024-0441', 24, null, 24],
      ['STU-2024-0455', 37, null, 37],
      ['STU-2024-0460', 20, null, 20],
      ['STU-2024-0471', 32, null, 32],
      ['STU-2024-0482', 27, null, 27],
      ['STU-2024-0493', 35, null, 35],
      ['STU-2024-0504', 30, null, 30],
      ['STU-2024-0515', 34, null, 34],
    ].forEach(e => run(
      'INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score) VALUES (?, ?, ?, ?, ?)',
      batchId,
      ...e
    ));

    run(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'seed_version',
      '1'
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── FEES / BURSARY SCHEMA (Finance MVP: invoices + payments) ──
// Kept as its own function/tables (not merged into createSchema()'s big
// template literal) so this can land independently of sibling finance
// sub-areas (Payroll/Expenses, Store/Accounting) without touching shared code.
function createFeesSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fee_invoices (
      id INTEGER PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
      class_code TEXT NOT NULL REFERENCES classes(code),
      fee_type TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      due_date TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'successful' CHECK(status IN ('successful','pending','failed')),
      note TEXT,
      recorded_by TEXT NOT NULL REFERENCES users(id),
      recorded_at TEXT NOT NULL
    );
  `);
}

// One-off demo data for Fees/Bursary so the finance screens aren't empty on a
// fresh database. Gated by its own schema_meta key (independent of the main
// seed_version) so it can be added/rerun without touching seedDatabase().
function seedFeesDemoData() {
  const seeded = one('SELECT value FROM schema_meta WHERE key = ?', 'fees_seed_version');
  if (seeded && seeded.value === '1') return;
  if (one('SELECT COUNT(*) AS count FROM students').count === 0) return;

  db.exec('BEGIN');
  try {
    const academic = one('SELECT id FROM academic_terms WHERE is_active = 1');
    const academicId = academic ? academic.id : 1;
    const admin = one("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const createdBy = admin ? admin.id : 'ADM-001';

    // Backfill a parent email for a handful of demo students (only where one
    // isn't already set) so Family Fees History has real families to show.
    const setParentEmail = (studentId, email) => run(
      `UPDATE students SET parent_email = ? WHERE id = ? AND (parent_email IS NULL OR parent_email = '')`,
      email, studentId
    );
    [
      ['STU-2024-0421', 'osei.family@example.com'],
      ['STU-2024-0388', 'mensah.family@example.com'],
      ['STU-2024-0412', 'nwosu.family@example.com'],
      ['STU-2024-0430', 'bello.family@example.com'],
      ['STU-2024-0441', 'okafor.family@example.com'],
      ['STU-2024-0455', 'adebisi.family@example.com'],
      ['STU-2024-0301', 'coker.family@example.com'],
      ['STU-2024-0334', 'musa.family@example.com'],
      ['STU-2024-0345', 'adesanya.family@example.com'],
      ['STU-2023-0101', 'ahmed.family@example.com'],
      ['STU-2023-0112', 'diop.family@example.com'],
      ['STU-2023-0123', 'uche.family@example.com'],
    ].forEach(([studentId, email]) => setParentEmail(studentId, email));

    const invoice = (studentId, feeType, description, amount, dueDate, createdAt) => {
      const result = run(
        `INSERT INTO fee_invoices (student_id, academic_id, class_code, fee_type, description, amount, due_date, created_by, created_at)
         VALUES (?, ?, (SELECT class_code FROM students WHERE id = ?), ?, ?, ?, ?, ?, ?)`,
        studentId, academicId, studentId, feeType, description, amount, dueDate, createdBy, createdAt
      );
      return Number(result.lastInsertRowid);
    };
    const payment = (invoiceId, amount, method, reference, status, recordedAt, note) => {
      run(
        `INSERT INTO fee_payments (invoice_id, amount, method, reference, status, note, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        invoiceId, amount, method, reference, status, note || null, createdBy, recordedAt
      );
    };

    // Fully paid
    let inv = invoice('STU-2024-0421', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 85000, 'Bank Transfer', 'TRX-10021', 'successful', '2026-05-20T10:12:00.000Z', 'Paid in full via bank transfer');

    // Partially paid
    inv = invoice('STU-2024-0388', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 50000, 'Cash', 'RCPT-2201', 'successful', '2026-05-25T11:00:00.000Z', 'First installment');

    // Unpaid, overdue
    invoice('STU-2024-0412', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');

    // Bus fee, unpaid + not yet due (soft demo of a non-tuition fee type)
    invoice('STU-2024-0430', 'Bus Fee', 'Term 2 Transport Levy', 15000, '2026-09-01', '2026-05-12T09:00:00.000Z');
    // ... plus a paid tuition invoice for the same student
    inv = invoice('STU-2024-0430', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 85000, 'Card Payment', 'TRX-10098', 'successful', '2026-05-18T08:40:00.000Z', null);

    // Pending payment awaiting review (Review Payment Proofs demo)
    inv = invoice('STU-2024-0441', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 85000, 'Bank Transfer', 'TRX-PENDING-01', 'pending', '2026-06-02T13:20:00.000Z', 'Awaiting bank confirmation');

    // Failed attempt demo
    inv = invoice('STU-2024-0455', 'Tuition Fee', 'Term 2 Tuition', 85000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 85000, 'Card Payment', 'TRX-FAIL-01', 'failed', '2026-05-28T16:05:00.000Z', 'Card declined');

    // Class 4A students
    inv = invoice('STU-2024-0301', 'Tuition Fee', 'Term 2 Tuition', 80000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 80000, 'Bank Transfer', 'TRX-10145', 'successful', '2026-05-22T09:30:00.000Z', null);

    invoice('STU-2024-0334', 'Tuition Fee', 'Term 2 Tuition', 80000, '2026-06-15', '2026-05-11T09:00:00.000Z');

    inv = invoice('STU-2024-0345', 'Development Levy', 'Annual Development Levy', 20000, '2026-07-01', '2026-05-15T09:00:00.000Z');
    payment(inv, 10000, 'Cash', 'RCPT-2306', 'successful', '2026-06-01T12:00:00.000Z', 'Partial payment');

    // Class 5A students
    inv = invoice('STU-2023-0101', 'Tuition Fee', 'Term 2 Tuition', 90000, '2026-06-15', '2026-05-11T09:00:00.000Z');
    payment(inv, 90000, 'Bank Transfer', 'TRX-10201', 'successful', '2026-05-19T14:00:00.000Z', null);

    invoice('STU-2023-0112', 'Tuition Fee', 'Term 2 Tuition', 90000, '2026-06-15', '2026-05-11T09:00:00.000Z');

    inv = invoice('STU-2023-0123', 'Exam Fee', 'Term 2 Exam Fee', 8000, '2026-06-20', '2026-05-15T09:00:00.000Z');
    payment(inv, 8000, 'USSD', 'TRX-10245', 'successful', '2026-05-30T10:10:00.000Z', null);

    run(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'fees_seed_version',
      '1'
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── FINANCE: STORE & INVENTORY / ACCOUNTING SCHEMA + SEED ──────────────────
// Self-contained schema/seed for the Store & Inventory and Accounting
// sub-areas of the Finance module. Kept separate from createSchema()/
// seedDatabase() above (core academics data) so this can evolve without
// touching that shared boilerplate.
function createStoreAccountingSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS store_products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      category_id INTEGER REFERENCES store_categories(id) ON DELETE SET NULL,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      unit TEXT,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_stock_movements (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
      change_qty INTEGER NOT NULL,
      reason TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_orders (
      id INTEGER PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'pos',
      customer_name TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES store_products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      qty INTEGER NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_requisitions (
      id INTEGER PRIMARY KEY,
      item_description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      department TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      decided_by TEXT REFERENCES users(id),
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS store_banners (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      image_url TEXT,
      link_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_homepage_sections (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      section_type TEXT NOT NULL DEFAULT 'custom',
      content TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acct_accounts (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
      normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS acct_journal_entries (
      id INTEGER PRIMARY KEY,
      entry_no TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL,
      memo TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acct_journal_lines (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES acct_journal_entries(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES acct_accounts(id),
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS acct_contacts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'vendor' CHECK(type IN ('vendor','customer')),
      email TEXT,
      phone TEXT,
      address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acct_bills (
      id INTEGER PRIMARY KEY,
      contact_id INTEGER REFERENCES acct_contacts(id) ON DELETE SET NULL,
      doc_no TEXT,
      doc_type TEXT NOT NULL DEFAULT 'bill' CHECK(doc_type IN ('bill','invoice')),
      issue_date TEXT NOT NULL,
      due_date TEXT,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acct_budgets (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES acct_accounts(id) ON DELETE CASCADE,
      period_label TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS acct_bank_transactions (
      id INTEGER PRIMARY KEY,
      txn_date TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      txn_type TEXT NOT NULL CHECK(txn_type IN ('debit','credit')),
      reconciled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acct_tax_records (
      id INTEGER PRIMARY KEY,
      period_label TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      amount_due REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT,
      notes TEXT
    );
  `);
}

function seedStoreAccountingData() {
  const seeded = one('SELECT value FROM schema_meta WHERE key = ?', 'store_acct_seed_version');
  if (seeded && seeded.value === '1') return;

  db.exec('BEGIN');
  try {
    const now = new Date().toISOString();

    // Store categories + products
    const categories = [
      ['Uniforms', 'School uniforms and wearables'],
      ['Stationery', 'Books, pens, and writing supplies'],
      ['Accessories', 'Bags, bottles, and other accessories'],
    ];
    categories.forEach(c => run('INSERT INTO store_categories (name, description) VALUES (?, ?)', ...c));
    const catId = name => one('SELECT id FROM store_categories WHERE name = ?', name).id;

    const products = [
      ['School Uniform (Set)', 'UNI-001', catId('Uniforms'), 8000, 5000, 'set', 40, 10],
      ['Exercise Book (Pack of 5)', 'STA-001', catId('Stationery'), 1200, 700, 'pack', 150, 30],
      ['Little Scholars Backpack', 'ACC-001', catId('Accessories'), 6000, 3500, 'piece', 20, 5],
      ['Water Bottle', 'ACC-002', catId('Accessories'), 1500, 800, 'piece', 60, 15],
      ['Maths Textbook - Grade 4', 'STA-002', catId('Stationery'), 3500, 2200, 'piece', 25, 8],
    ];
    products.forEach(p => run(
      `INSERT INTO store_products (name, sku, category_id, price, cost, unit, stock_qty, reorder_level, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ...p, now
    ));

    // Sample completed order (already reflected in the seeded stock figures above)
    const order = run(
      `INSERT INTO store_orders (order_no, channel, customer_name, status, subtotal, discount, total, payment_method, created_by, created_at)
       VALUES (?, 'pos', ?, 'completed', ?, 0, ?, 'cash', ?, ?)`,
      'ORD-0001', 'Walk-in Customer', 4200, 4200, 'ADM-001', now
    );
    const orderId = Number(order.lastInsertRowid);
    const bookProduct = one('SELECT id, price FROM store_products WHERE sku = ?', 'STA-001');
    const bottleProduct = one('SELECT id, price FROM store_products WHERE sku = ?', 'ACC-002');
    run(
      `INSERT INTO store_order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)`,
      orderId, bookProduct.id, 'Exercise Book (Pack of 5)', bookProduct.price, 2, bookProduct.price * 2
    );
    run(
      `INSERT INTO store_order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)`,
      orderId, bottleProduct.id, 'Water Bottle', bottleProduct.price, 1, bottleProduct.price
    );

    run(
      `INSERT INTO store_requisitions (item_description, quantity, department, reason, status, requested_by, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      'A4 Paper Reams', 10, 'Front Office', 'Restocking printer paper', 'TCH-001', now
    );

    run(
      `INSERT INTO store_banners (title, subtitle, image_url, link_url, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`,
      'Back to School Sale', '10% off all uniforms this week', '', '', now
    );

    run(
      `INSERT INTO store_homepage_sections (title, section_type, content, sort_order, is_active, created_at)
       VALUES (?, 'featured', ?, 1, 1, ?)`,
      'Featured Items', 'Uniforms, backpacks, and stationery essentials for the new term.', now
    );

    // Chart of accounts
    const accounts = [
      ['1000', 'Cash', 'asset', 'debit'],
      ['1010', 'Bank Account', 'asset', 'debit'],
      ['1200', 'Accounts Receivable', 'asset', 'debit'],
      ['1500', 'Inventory', 'asset', 'debit'],
      ['2000', 'Accounts Payable', 'liability', 'credit'],
      ['3000', "Fund Balance / Equity", 'equity', 'credit'],
      ['4000', 'Tuition & Fees Income', 'income', 'credit'],
      ['4100', 'Store Sales Income', 'income', 'credit'],
      ['5000', 'Salaries Expense', 'expense', 'debit'],
      ['5100', 'Utilities Expense', 'expense', 'debit'],
      ['5200', 'Supplies Expense', 'expense', 'debit'],
    ];
    accounts.forEach(a => run(
      'INSERT INTO acct_accounts (code, name, type, normal_balance, is_active) VALUES (?, ?, ?, ?, 1)',
      ...a
    ));
    const acctId = code => one('SELECT id FROM acct_accounts WHERE code = ?', code).id;

    function insertEntry(entryNo, date, memo, lines) {
      const entry = run(
        `INSERT INTO acct_journal_entries (entry_no, entry_date, memo, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
        entryNo, date, memo, 'ADM-001', now
      );
      const entryId = Number(entry.lastInsertRowid);
      lines.forEach(l => run(
        `INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)`,
        entryId, acctId(l.code), l.debit || 0, l.credit || 0, l.description || ''
      ));
    }

    insertEntry('JE-0001', '2026-01-05', 'Opening fund balance', [
      { code: '1000', debit: 500000, description: 'Opening cash balance' },
      { code: '3000', credit: 500000, description: 'Opening fund balance' },
    ]);
    insertEntry('JE-0002', '2026-01-20', 'Store sale - till reconciliation', [
      { code: '1000', debit: 4200, description: 'Cash from ORD-0001' },
      { code: '4100', credit: 4200, description: 'Store sales revenue' },
    ]);
    insertEntry('JE-0003', '2026-02-02', 'Paid electricity bill', [
      { code: '5100', debit: 25000, description: 'February electricity bill' },
      { code: '1000', credit: 25000, description: 'Paid from cash' },
    ]);

    // Contacts + bills
    const vendor = run(
      `INSERT INTO acct_contacts (name, type, email, phone, address, created_at) VALUES (?, 'vendor', ?, ?, ?, ?)`,
      'ABC Stationery Suppliers', 'sales@abcstationery.example', '+234 800 000 0000', 'Lagos, Nigeria', now
    );
    run(
      `INSERT INTO acct_contacts (name, type, email, phone, address, created_at) VALUES (?, 'customer', ?, ?, ?, ?)`,
      'Parent-Teacher Association', 'pta@littlescholars.example', '+234 800 111 2222', 'On campus', now
    );
    run(
      `INSERT INTO acct_bills (contact_id, doc_no, doc_type, issue_date, due_date, amount, status, notes, created_at)
       VALUES (?, 'BILL-0001', 'bill', '2026-02-10', '2026-03-10', 45000, 'unpaid', 'Stationery restock', ?)`,
      Number(vendor.lastInsertRowid), now
    );

    run(
      `INSERT INTO acct_budgets (account_id, period_label, amount, notes) VALUES (?, ?, ?, ?)`,
      acctId('5100'), '2025/2026 Term 2', 30000, 'Estimated utilities for the term'
    );

    run(
      `INSERT INTO acct_bank_transactions (txn_date, description, amount, txn_type, reconciled, created_at) VALUES (?, ?, ?, 'debit', 1, ?)`,
      '2026-01-05', 'Opening balance deposit', 500000, now
    );
    run(
      `INSERT INTO acct_bank_transactions (txn_date, description, amount, txn_type, reconciled, created_at) VALUES (?, ?, ?, 'credit', 0, ?)`,
      '2026-02-02', 'Electricity bill payment', 25000, now
    );

    run(
      `INSERT INTO acct_tax_records (period_label, tax_type, amount_due, amount_paid, status, due_date, notes)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      '2026 Q1', 'PAYE (Staff)', 60000, 0, '2026-04-15', 'Quarterly staff PAYE remittance'
    );

    run(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'store_acct_seed_version', '1'
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
// ── END FINANCE: STORE & INVENTORY / ACCOUNTING SCHEMA + SEED ──────────────

// Production start-up: no demo people, no known passwords. Creates one admin
// (password from the ADMIN_PASSWORD env var) plus the school's real class /
// arm / subject structure, and nothing else. Runs only while no admin exists.
function bootstrapProduction() {
  if (one('SELECT id FROM users WHERE role = ? LIMIT 1', 'admin')) return;
  const password = process.env.ADMIN_PASSWORD || '';
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD env var (at least 8 characters) is required on first production start to create the admin account.');
  }
  const adminName = cleanText(process.env.ADMIN_NAME) || 'School Administrator';
  db.exec('BEGIN');
  try {
    run(
      `INSERT INTO users (id, role, password, name, first_name, initials) VALUES (?, 'admin', ?, ?, ?, ?)`,
      'ADM-001', hashPassword(password), adminName, firstNameFromName(adminName), initialsFromName(adminName)
    );
    run(
      'INSERT INTO academic_terms (id, session_label, term_label, is_active) VALUES (1, ?, ?, 1)',
      cleanText(process.env.ACADEMIC_SESSION) || '2025/2026',
      cleanText(process.env.ACADEMIC_TERM) || 'Term 2'
    );
    [
      ['CR', 'Creche', 'Creche', []],
      ['KG', 'Kindergarten', 'Nursery', ['Dove', 'Eagle']],
      ['RC', 'Reception', 'Nursery', ['Blue Bell', 'Camelia']],
      ['PS1', 'Pre-School 1', 'Nursery', ['Platinum', 'Orange']],
      ['PS2', 'Pre-School 2', 'Nursery', ['Opal', 'Ruby']],
      ['Y1', 'Year 1', 'Primary', ['Indigo', 'Violet']],
      ['Y2', 'Year 2', 'Primary', ['Confluence', 'Peninsula']],
      ['Y3', 'Year 3', 'Primary', ['Jaguar', 'Lynx']],
      ['Y4', 'Year 4', 'Primary', ['Bauxite', 'Columbite']],
      ['Y5', 'Year 5', 'Primary', ['Mars', 'Venus']],
      ['Y6', 'Year 6', 'Primary', ['Jupiter']],
    ].forEach(([code, label, category, arms]) => {
      run('INSERT INTO classes (code, label, category) VALUES (?, ?, ?)', code, label, category);
      arms.forEach(name => run('INSERT INTO class_arms (class_code, name) VALUES (?, ?)', code, name));
    });
    [
      'Mathematics', 'English Language', 'Basic Science', 'Social Studies', 'Creative Arts', 'French', 'ICT',
      'Physical Education', 'Literacy', 'Numeracy', 'Bible Knowledge', 'News & Conversation', 'Fine Arts',
      'Cultural', 'Practical Life', 'Rhyme', 'Primary Science', 'Q.A.T', 'V.A.T', 'Yoruba Language', 'Diction',
      'Computer', 'Igbo Language', 'Music', 'Vocational Aptitude', 'Hand Writing', 'Creative Writing',
      'C.R.K/I.R.K', 'History',
    ].forEach(name => run('INSERT INTO subjects (name) VALUES (?)', name));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

createSchema();
createFeesSchema();
createFinancePayrollSchema();
createStoreAccountingSchema();
if (IS_PROD) {
  bootstrapProduction();
} else {
  seedDatabase();
  seedFeesDemoData();
  seedFinancePayrollDemoData();
  seedStoreAccountingData();
}
migratePlaintextPasswords();
backfillMissingStudentUsers();
loadGradeScale();
// One-time cleanup: CBT questions used to need a manual admin "vet" step
// before they were usable. That approval step was removed — any question
// created before this change should still work immediately.
run('UPDATE cbt_questions SET vetted = 1 WHERE vetted = 0');

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(part => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }).filter(([key]) => key));
}

function sessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const row = one(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > ?`,
    token,
    new Date().toISOString()
  );
  return row || null;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    firstName: row.first_name,
    initials: row.initials,
    teacherType: row.teacher_type,
    chip: row.chip,
    grade: row.grade,
    email: row.email || '',
    signaturePath: row.signature_path || '',
  };
}

function requireUser(req, res, role) {
  const user = sessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Authentication required' });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(res, 403, { error: 'Forbidden' });
    return null;
  }
  return user;
}

// Class arm is only mandatory when the class actually has arms defined
// (e.g. Creche has none) — matches the admin's own "if it doesn't have an
// arm, it just doesn't appear" rule for these dropdowns.
function classHasArms(classCode) {
  return !!one('SELECT id FROM class_arms WHERE class_code = ? LIMIT 1', classCode);
}

function activeAcademic() {
  return one('SELECT id, session_label AS sessionLabel, term_label AS termLabel FROM academic_terms WHERE is_active = 1');
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of Easter
// Sunday in a given year — needed since Good Friday / Easter Monday shift
// every year and can't just be hardcoded.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// Nigeria's fixed-date public holidays plus the Easter-derived ones. Islamic
// holidays (Eid el-Fitr, Eid el-Kabir) follow the lunar calendar and can't be
// computed reliably in advance, so those are left for the admin to add by
// hand, same as any other school-specific closure day.
function nigerianFixedHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter); goodFriday.setUTCDate(easter.getUTCDate() - 2);
  const easterMonday = new Date(easter); easterMonday.setUTCDate(easter.getUTCDate() + 1);
  return [
    { date: `${year}-01-01`, label: "New Year's Day" },
    { date: isoDate(goodFriday), label: 'Good Friday' },
    { date: isoDate(easterMonday), label: 'Easter Monday' },
    { date: `${year}-05-01`, label: "Workers' Day" },
    { date: `${year}-05-27`, label: "Children's Day" },
    { date: `${year}-06-12`, label: 'Democracy Day' },
    { date: `${year}-10-01`, label: 'Independence Day' },
    { date: `${year}-12-25`, label: 'Christmas Day' },
    { date: `${year}-12-26`, label: 'Boxing Day' },
  ];
}

// Idempotent: only inserts holidays that fall inside the range and aren't
// already there (UNIQUE(academic_id, holiday_date) makes repeat calls safe).
function seedHolidaysForRange(academicId, startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    for (const h of nigerianFixedHolidays(y)) {
      if (h.date < startDate || h.date > endDate) continue;
      try {
        run('INSERT INTO term_holidays (academic_id, holiday_date, label) VALUES (?, ?, ?)', academicId, h.date, h.label);
      } catch (err) { /* already exists */ }
    }
  }
}

// Counts weekdays (Mon-Fri) in [startDate, endDate] minus any that are
// marked as a holiday. Returns null if the term has no date range set yet.
function computeSchoolDays(academicId) {
  const term = one('SELECT start_date AS startDate, end_date AS endDate FROM academic_terms WHERE id = ?', academicId);
  if (!term || !term.startDate || !term.endDate) return null;
  const holidays = new Set(all('SELECT holiday_date AS d FROM term_holidays WHERE academic_id = ?', academicId).map(r => r.d));
  let count = 0;
  const cursor = new Date(`${term.startDate}T00:00:00Z`);
  const end = new Date(`${term.endDate}T00:00:00Z`);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(isoDate(cursor))) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function studentRowsForClass(classCode) {
  return all(
    `SELECT st.id, st.name, st.initials, st.gender, st.avg, st.att, st.class_code AS classCode,
            st.class_arm_id AS classArmId, ca.name AS classArmName
     FROM students st
     LEFT JOIN class_arms ca ON ca.id = st.class_arm_id
     WHERE st.class_code = ?
     ORDER BY st.name`,
    classCode
  );
}

function teacherContexts(teacherId) {
  const academic = activeAcademic();
  const rows = all(
    `SELECT
       ta.id,
       ta.teacher_id AS teacherId,
       ta.teacher_type AS teacherType,
       ta.class_code AS classCode,
       c.label AS classLabel,
       s.id AS subjectId,
       s.name AS subjectName
     FROM teacher_assignments ta
     JOIN classes c ON c.code = ta.class_code
     JOIN subjects s ON s.id = ta.subject_id
     WHERE ta.teacher_id = ?
     ORDER BY c.code, s.name`,
    teacherId
  );
  return rows.map(row => ({
    ...row,
    academicId: academic.id,
    sessionLabel: academic.sessionLabel,
    termLabel: academic.termLabel,
    examTypes: EXAM_TYPES,
    students: studentRowsForClass(row.classCode),
  }));
}

function assignmentForTeacher(contextId, teacherId) {
  return one(
    `SELECT ta.*, s.name AS subjectName, c.label AS classLabel
     FROM teacher_assignments ta
     JOIN subjects s ON s.id = ta.subject_id
     JOIN classes c ON c.code = ta.class_code
     WHERE ta.id = ? AND ta.teacher_id = ?`,
    Number(contextId),
    teacherId
  );
}

function formatSavedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function resultPayload(contextId, examType) {
  const batch = one(
    `SELECT id, saved_at AS savedAt
     FROM result_batches
     WHERE assignment_id = ? AND exam_type = ? AND academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)`,
    Number(contextId),
    examType
  );
  if (!batch) return { batchId: null, savedAt: '', savedAtIso: '', entries: {} };
  const entries = {};
  all(
    `SELECT student_id AS studentId, ca_score AS ca, exam_score AS exam, total_score AS total,
            is_absent AS isAbsent, is_excluded AS isExcluded
     FROM result_entries
     WHERE batch_id = ?
     ORDER BY student_id`,
    batch.id
  ).forEach(row => {
    entries[row.studentId] = {
      ca: row.ca,
      exam: row.exam,
      total: row.total,
      isAbsent: !!row.isAbsent,
      isExcluded: !!row.isExcluded,
    };
  });
  return {
    batchId: batch.id,
    savedAt: formatSavedAt(batch.savedAt),
    savedAtIso: batch.savedAt,
    entries,
  };
}

function validateExamType(examType) {
  return EXAM_TYPES.includes(examType);
}

function normalizeScore(value, fieldName, max) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} is required`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new Error(`${fieldName} must be a whole number from 0 to ${max}`);
  }
  return number;
}

function normalizeSkillRating(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new Error(`${label} rating must be a whole number from 1 to 5`);
  }
  return number;
}

function publicSkillRating(row) {
  if (!row) return null;
  const affective = {};
  const psychomotor = {};
  AFFECTIVE_SKILLS.forEach(([key, column]) => {
    affective[key] = row[column] ?? null;
  });
  PSYCHOMOTOR_SKILLS.forEach(([key, column]) => {
    psychomotor[key] = row[column] ?? null;
  });
  return {
    studentId: row.student_id || row.studentId,
    classCode: row.class_code || row.classCode,
    examType: row.exam_type || row.examType,
    updatedAt: row.updated_at ? formatSavedAt(row.updated_at) : '',
    updatedAtIso: row.updated_at || '',
    affective,
    psychomotor,
  };
}

function skillRatingsForClass(classCode, examType) {
  const academic = activeAcademic();
  const rows = all(
    `SELECT *
     FROM student_skill_ratings
     WHERE academic_id = ? AND class_code = ? AND exam_type = ?`,
    academic.id,
    classCode,
    examType
  );
  return Object.fromEntries(rows.map(row => [row.student_id, publicSkillRating(row)]));
}

function skillRatingForReport(studentId, classCode, examType) {
  const academic = activeAcademic();
  const row = one(
    `SELECT *
     FROM student_skill_ratings
     WHERE academic_id = ? AND student_id = ? AND class_code = ? AND exam_type = ?`,
    academic.id,
    studentId,
    classCode,
    examType
  );
  return publicSkillRating(row);
}

function loadPdfLib() {
  try {
    return require('pdf-lib');
  } catch (err) {
    throw new Error('pdf-lib is required to generate report PDFs. Run `npm install` and try again.');
  }
}

function saveDataUrl(dataUrl, prefix, dir = UPLOAD_DIR) {
  const raw = cleanText(dataUrl);
  if (!raw) return null;
  const match = raw.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i);
  if (!match) throw new Error('Uploaded file must be a base64 data URL');
  const mime = match[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : null;
  if (!ext) throw new Error('Only PNG and JPG uploads are supported');
  const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const absolute = path.join(dir, fileName);
  fs.writeFileSync(absolute, Buffer.from(match[2], 'base64'));
  return path.relative(ROOT, absolute).replace(/\\/g, '/');
}

function absoluteAssetPath(relativePath) {
  if (!relativePath) return '';
  const full = path.resolve(ROOT, relativePath);
  return full.startsWith(ROOT) ? full : '';
}

// ── Minimal dependency-free .xlsx reader ──
// Reads just enough of the OOXML zip container (central directory + local
// file headers, stored or deflate-compressed entries) to pull sharedStrings
// and the first worksheet's cell values. No third-party zip/xlsx library —
// this project intentionally carries no npm dependencies beyond pdf-lib.
function readZipEntries(buffer, wantedNames) {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === eocdSig) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid .xlsx file (zip end-of-directory not found)');
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdEntryCount = buffer.readUInt16LE(eocdOffset + 10);

  const wanted = new Set(wantedNames);
  const out = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < cdEntryCount && wanted.size > out.size; i++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    if (wanted.has(name)) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('Corrupt .xlsx file (bad local header)');
      const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlUnescape(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    xmlUnescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
  );
}

function colLetterToIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheetRows(xml, sharedStrings) {
  const rowMatches = xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
  const rows = [];
  for (const rowMatch of rowMatches) {
    const cellMatches = rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g);
    const row = [];
    for (const c of cellMatches) {
      const attrs = c[1] !== undefined ? c[1] : c[3];
      const body = c[2] || '';
      const rMatch = attrs.match(/r="([A-Z]+)\d+"/);
      if (!rMatch) continue;
      const idx = colLetterToIndex(rMatch[1]);
      const type = (attrs.match(/\st="([^"]*)"/) || [])[1] || null;
      let val = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (val !== undefined) {
        val = type === 's' ? sharedStrings[Number(val)] ?? '' : xmlUnescape(val);
      } else if (type === 'inlineStr') {
        val = xmlUnescape((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      } else {
        val = null;
      }
      row[idx] = val;
    }
    rows.push(row);
  }
  return rows;
}

// Reads the first worksheet of an .xlsx buffer and returns
// { headers: [...], rows: [[...], ...] } — rows are the sheet's data rows,
// aligned by column index to `headers` (the first non-empty row is treated
// as the header row).
function parseXlsxFirstSheet(buffer) {
  const rels = readZipEntries(buffer, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels']);
  const workbookXml = rels.get('xl/workbook.xml')?.toString('utf8') || '';
  const relsXml = rels.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const firstSheet = workbookXml.match(/<sheet\b[^>]*\/>/);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet) {
    const rId = (firstSheet[0].match(/r:id="([^"]+)"/) || [])[1];
    if (rId) {
      const relMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="([^"]+)"`));
      if (relMatch) sheetPath = `xl/${relMatch[1].replace(/^\/?xl\//, '')}`;
    }
  }
  const files = readZipEntries(buffer, ['xl/sharedStrings.xml', sheetPath]);
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));
  const sheetXml = files.get(sheetPath)?.toString('utf8');
  if (!sheetXml) throw new Error('Could not find worksheet data in this .xlsx file');
  const allRows = parseSheetRows(sheetXml, sharedStrings);

  // The header row is the widest of the first few rows, not simply the first
  // non-empty one — some exports (e.g. a school platform's own exports) put a
  // single-cell title banner above the real header row.
  const nonEmptyCount = row => row.reduce((n, cell) => n + (cell !== undefined && cell !== null && String(cell).trim() !== '' ? 1 : 0), 0);
  let headerRowIndex = -1;
  let bestCount = 0;
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    const count = nonEmptyCount(allRows[i]);
    if (count > bestCount) { bestCount = count; headerRowIndex = i; }
  }
  if (headerRowIndex === -1) return { headers: [], rows: [] };
  const headers = allRows[headerRowIndex].map(h => (h === undefined || h === null ? '' : String(h).trim()));
  const rows = allRows.slice(headerRowIndex + 1).filter(r => r.some(cell => cell !== undefined && cell !== null && String(cell).trim() !== ''));
  return { headers, rows };
}

function termHeadingLabel(termLabel) {
  const raw = String(termLabel || '').trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const termNumber = normalized.match(/(?:term\s*)?([123])(?:st|nd|rd|th)?(?:\s*term)?/);
  const labels = {
    1: 'FIRST TERM',
    2: 'SECOND TERM',
    3: 'THIRD TERM',
  };
  if (termNumber && labels[termNumber[1]]) return labels[termNumber[1]];
  if (normalized.includes('first')) return labels[1];
  if (normalized.includes('second')) return labels[2];
  if (normalized.includes('third')) return labels[3];
  return raw.toUpperCase();
}

function sessionHeadingLabel(sessionLabel) {
  return String(sessionLabel || '').trim().replace(/\s*\/\s*/g, '-').toUpperCase();
}

function reportHeading(academic, examType) {
  const term = termHeadingLabel(academic.termLabel);
  const session = sessionHeadingLabel(academic.sessionLabel);
  const exam = examType === 'Mid-Term Exam' ? 'MID TERM REPORT' : 'FINAL REPORT';
  return `${term}, ${session} (${exam})`;
}

function performanceGrade(avg) {
  if (avg >= 80) return 'A (Excellent)';
  if (avg >= 70) return 'B (Very Good)';
  if (avg >= 50) return 'C (Good)';
  if (avg >= 40) return 'D (Fair)';
  return 'F (Needs Support)';
}

// Shared A-F band used for the per-subject "Grade Remarks" column and the
// overall "Result Summary" line on the report card. `point` is the 0-5 scale
// used for Grade Point Average, matching the broadsheet's GRADE_SCALE.
function gradeBand(pct) {
  if (pct >= 80) return { letter: 'A', word: 'Excellent', point: 5 };
  if (pct >= 70) return { letter: 'B', word: 'Very Good', point: 4 };
  if (pct >= 50) return { letter: 'C', word: 'Good', point: 3 };
  if (pct >= 40) return { letter: 'D', word: 'Fair', point: 2 };
  return { letter: 'F', word: 'Needs Support', point: 0 };
}

// For a Final Exam report, which earlier terms in the SAME session (if any)
// should show up as cumulative columns — Term 2's report shows Term 1,
// Term 3's report shows Term 1 and Term 2.
function priorTermsInSession(sessionLabel, currentTermLabel) {
  const order = ['Term 1', 'Term 2', 'Term 3'];
  const idx = order.indexOf(currentTermLabel);
  if (idx <= 0) return [];
  return order.slice(0, idx)
    .map(label => one('SELECT id, term_label AS termLabel FROM academic_terms WHERE session_label = ? AND term_label = ?', sessionLabel, label))
    .filter(Boolean);
}

// { [subjectId]: totalScore } for one student's Final Exam results in a
// specific earlier term — used to populate the cumulative columns.
function priorTermSubjectTotals(classCode, studentId, academicId) {
  const rows = all(
    `SELECT rb.subject_id AS subjectId, re.total_score AS total
     FROM result_batches rb
     JOIN result_entries re ON re.batch_id = rb.id
     WHERE rb.class_code = ? AND rb.exam_type = 'Final Exam' AND rb.academic_id = ?
       AND re.student_id = ? AND re.is_excluded = 0 AND re.is_absent = 0`,
    classCode, academicId, studentId
  );
  const map = {};
  rows.forEach(r => { map[r.subjectId] = r.total; });
  return map;
}

function classReportRows(classCode, examType, studentId) {
  return all(
    `SELECT
       rb.id AS batchId,
       rb.vetted_at AS vettedAt,
       rb.subject_id AS subjectId,
       s.name AS subjectName,
       u.name AS teacherName,
       u.signature_path AS teacherSignaturePath,
       re.ca_score AS ca,
       re.exam_score AS exam,
       re.total_score AS total,
       re.is_absent AS isAbsent
     FROM result_batches rb
     JOIN result_entries re ON re.batch_id = rb.id
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     WHERE rb.class_code = ?
       AND rb.exam_type = ?
       AND re.student_id = ?
       AND re.is_excluded = 0
       AND rb.academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)
     ORDER BY s.name`,
    classCode,
    examType,
    studentId
  ).map(row => ({ ...row, isAbsent: !!row.isAbsent }));
}

function classBatches(classCode, examType) {
  return all(
    `SELECT
       rb.id,
       rb.class_code AS classCode,
       rb.exam_type AS examType,
       rb.saved_at AS savedAt,
       rb.vetted_at AS vettedAt,
       rb.vetted_by AS vettedBy,
       s.name AS subjectName,
       u.name AS teacherName,
       COUNT(re.id) AS entryCount
     FROM result_batches rb
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     LEFT JOIN result_entries re ON re.batch_id = rb.id
     WHERE rb.class_code = ?
       AND rb.exam_type = ?
       AND rb.academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)
     GROUP BY rb.id
     ORDER BY s.name`,
    classCode,
    examType
  );
}

function adminGradebook(classCode, examType) {
  const academic = activeAcademic();
  if (!academic) return null;
  const batches = all(
    `SELECT rb.id AS batchId, rb.subject_id AS subjectId,
            s.name AS subjectName, s.code AS subjectCode,
            u.name AS teacherName, rb.vetted_at AS vettedAt
     FROM result_batches rb
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     WHERE rb.class_code = ? AND rb.exam_type = ? AND rb.academic_id = ?
     ORDER BY s.name`,
    classCode, examType, academic.id
  );
  const subjects = [];
  const seenSubjects = new Set();
  batches.forEach(batch => {
    if (seenSubjects.has(batch.subjectId)) return;
    seenSubjects.add(batch.subjectId);
    subjects.push({
      id: batch.subjectId,
      name: batch.subjectName,
      code: batch.subjectCode,
      teacherName: batch.teacherName,
      batchId: batch.batchId,
      vettedAt: batch.vettedAt,
    });
  });

  const students = all(
    `SELECT st.id, st.name, st.initials, st.class_code AS classCode, st.class_arm_id AS classArmId,
            COALESCE(u.active, 1) AS active
     FROM students st
     LEFT JOIN users u ON u.id = st.id
     WHERE st.class_code = ?
     ORDER BY st.name`,
    classCode
  ).map(student => ({ ...student, active: !!student.active }));

  const scoreMatrix = {};
  subjects.forEach(subject => {
    all(
      `SELECT student_id AS studentId, ca_score AS ca,
              exam_score AS ex, total_score AS tot,
              is_absent AS isAbsent, is_excluded AS isExcluded
       FROM result_entries WHERE batch_id = ?`,
      subject.batchId
    ).forEach(entry => {
      if (!scoreMatrix[entry.studentId]) scoreMatrix[entry.studentId] = {};
      scoreMatrix[entry.studentId][subject.id] = {
        ca: entry.ca,
        ex: entry.ex,
        tot: entry.tot,
        isAbsent: !!entry.isAbsent,
        isExcluded: !!entry.isExcluded,
      };
    });
  });

  return { classCode, examType, subjMax: maxScoreForExamType(examType), subjects, students, scoreMatrix };
}

// ── STUDENT PORTAL HELPERS ──
// A student must only ever be able to see PUBLISHED results (a row exists in
// report_publications for their id/class/exam/term) - never a teacher's
// in-progress result_batches / result_entries directly.

function maxScoreForExamType(examType) {
  return examType === 'Final Exam' ? 100 : 40;
}

const DEFAULT_GRADE_SCALE = [
  { grade: 'A', min: 80, max: 100, remark: 'Excellent', gradePoint: 5.0 },
  { grade: 'B', min: 65, max: 79, remark: 'Very Good', gradePoint: 4.0 },
  { grade: 'C', min: 55, max: 64, remark: 'Good', gradePoint: 3.0 },
  { grade: 'D', min: 45, max: 54, remark: 'Fair', gradePoint: 2.0 },
  { grade: 'F', min: 0, max: 44, remark: 'Fail', gradePoint: 0.0 },
];
let gradeScale = DEFAULT_GRADE_SCALE;

function loadGradeScale() {
  const stored = valueFromMeta('grade_scale', '');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) gradeScale = parsed;
    } catch (err) {}
  }
}

function gradeForPct(pct) {
  const band = gradeScale.find(g => pct >= Number(g.min)) || gradeScale[gradeScale.length - 1];
  return { grade: band.grade, remark: band.remark };
}

function studentRecord(studentId) {
  return one(
    `SELECT st.id, st.name, st.initials, st.gender, st.avg, st.att,
            st.class_code AS classCode, c.label AS classLabel
     FROM students st
     JOIN classes c ON c.code = st.class_code
     WHERE st.id = ?`,
    studentId
  );
}

function isResultPublished(studentId, classCode, examType, academicId) {
  return !!one(
    `SELECT id FROM report_publications
     WHERE student_id = ? AND class_code = ? AND exam_type = ? AND academic_id = ?`,
    studentId, classCode, examType, academicId
  );
}

// Only ever reads rows that belong to a PUBLISHED report (joins result_entries
// through report_publications so unpublished/in-progress teacher entries can
// never leak to a student).
function publishedRowsForClass(classCode, academicId, examType) {
  const params = [classCode, academicId];
  let examClause = '';
  if (examType) {
    examClause = 'AND rb.exam_type = ?';
    params.push(examType);
  }
  return all(
    `SELECT re.student_id AS studentId, rb.exam_type AS examType,
            s.id AS subjectId, s.name AS subjectName, u.name AS teacherName,
            re.ca_score AS ca, re.exam_score AS exam, re.total_score AS total,
            re.is_absent AS isAbsent
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.batch_id
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     JOIN report_publications rp
       ON rp.student_id = re.student_id
      AND rp.class_code = rb.class_code
      AND rp.exam_type = rb.exam_type
      AND rp.academic_id = rb.academic_id
     WHERE rb.class_code = ? AND rb.academic_id = ? AND re.is_excluded = 0 ${examClause}
     ORDER BY s.name`,
    ...params
  ).map(row => ({ ...row, isAbsent: !!row.isAbsent }));
}

// Ranks every classmate who has at least one published result this term,
// by their average percentage across all of their published subjects
// (optionally scoped to a single exam type). Used for class-position stats.
function classStandings(classCode, academicId, examType) {
  const rows = publishedRowsForClass(classCode, academicId, examType);
  const byStudent = new Map();
  rows.forEach(row => {
    if (row.isAbsent) return;
    const pct = (row.total / maxScoreForExamType(row.examType)) * 100;
    if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, []);
    byStudent.get(row.studentId).push(pct);
  });
  return [...byStudent.entries()]
    .map(([studentId, pcts]) => ({
      studentId,
      avgPct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
      subjectCount: pcts.length,
    }))
    .sort((a, b) => b.avgPct - a.avgPct);
}

function rankOf(standings, studentId) {
  const idx = standings.findIndex(s => s.studentId === studentId);
  if (idx === -1) return null;
  return { position: idx + 1, classSize: standings.length, avgPct: standings[idx].avgPct };
}

async function embedImageIfPresent(pdfDoc, relativePath) {
  const full = absoluteAssetPath(relativePath);
  if (!full || !fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  if (full.toLowerCase().endsWith('.png')) return pdfDoc.embedPng(bytes);
  return pdfDoc.embedJpg(bytes);
}

function text(page, value, x, y, size, font, options = {}) {
  page.drawText(String(value ?? ''), {
    x,
    y,
    size,
    font,
    color: options.color,
    maxWidth: options.maxWidth,
  });
}

function line(page, x1, y1, x2, y2, color, width = 0.6) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: width, color });
}

function textWidth(font, value, size) {
  return font.widthOfTextAtSize(String(value ?? ''), size);
}

function trimToFit(font, value, size, width) {
  let out = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!out || textWidth(font, out, size) <= width) return out;
  while (out.length > 3 && textWidth(font, `${out}...`, size) > width) {
    out = out.slice(0, -1).trimEnd();
  }
  return `${out}...`;
}

function drawFittedText(page, value, x, y, width, size, font, color, options = {}) {
  const out = trimToFit(font, value, size, width);
  const actualWidth = textWidth(font, out, size);
  const align = options.align || 'left';
  const tx = align === 'center' ? x + Math.max(0, (width - actualWidth) / 2) : align === 'right' ? x + Math.max(0, width - actualWidth) : x;
  text(page, out, tx, y, size, font, { color });
}

function drawCenteredText(page, value, centerX, y, size, font, color) {
  const width = textWidth(font, value, size);
  text(page, value, centerX - (width / 2), y, size, font, { color });
}

function drawUnderlinedText(page, value, x, y, size, font, color, ruleColor = color) {
  text(page, value, x, y, size, font, { color });
  line(page, x, y - 2, x + textWidth(font, value, size), y - 2, ruleColor, 0.7);
}

function drawCell(page, { x, top, width, height, fill, border, borderWidth = 0.45 }) {
  page.drawRectangle({
    x,
    y: top - height,
    width,
    height,
    color: fill,
    borderColor: border,
    borderWidth,
  });
}

function drawCellText(page, value, x, top, width, height, size, font, color, align = 'left') {
  const pad = 5;
  drawFittedText(page, value, x + pad, top - height + ((height - size) / 2) + 2.5, width - (pad * 2), size, font, color, { align });
}

function normaliseGender(gender) {
  const raw = String(gender || '').trim().toLowerCase();
  if (raw === 'f' || raw === 'female') return 'FEMALE';
  if (raw === 'm' || raw === 'male') return 'MALE';
  return raw ? raw.toUpperCase() : '';
}

function reportScoreColumns(examType) {
  if (examType === 'Mid-Term Exam') return ['Mid-Term Test (40)'];
  return ['Mid-Term Test (30)', 'Examination (70)'];
}

function drawSkillTable(page, skills, ratings, x, top, width, rowH, fonts, colors, options = {}) {
  const firstCol = Math.round(width * 0.63);
  const secondCol = width - firstCol;
  const rows = options.rows ?? skills.length;
  const start = options.start ?? 0;
  let currentTop = top;

  if (options.header !== false) {
    drawCell(page, { x, top: currentTop, width: firstCol, height: rowH, fill: colors.blue, border: colors.grid });
    drawCell(page, { x: x + firstCol, top: currentTop, width: secondCol, height: rowH, fill: colors.blue, border: colors.grid });
    drawCellText(page, 'Skill', x, currentTop, firstCol, rowH, 10, fonts.bold, colors.white, 'center');
    drawCellText(page, 'Rating', x + firstCol, currentTop, secondCol, rowH, 10, fonts.bold, colors.white, 'center');
    currentTop -= rowH;
  }

  skills.slice(start, start + rows).forEach(([key, , label], i) => {
    const fill = i % 2 === 0 ? colors.skillStripe : colors.white;
    drawCell(page, { x, top: currentTop, width: firstCol, height: rowH, fill, border: colors.grid });
    drawCell(page, { x: x + firstCol, top: currentTop, width: secondCol, height: rowH, fill, border: colors.grid });
    drawCellText(page, label, x, currentTop, firstCol, rowH, 9.5, fonts.regular, colors.black);
    drawCellText(page, ratings?.[key] ?? '-', x + firstCol, currentTop, secondCol, rowH, 9.5, fonts.bold, colors.blue, 'center');
    currentTop -= rowH;
  });

  return currentTop;
}

async function drawReportHeader(page, pdfDoc, fonts, colors, reportTitle) {
  const logo = await embedImageIfPresent(pdfDoc, 'report_assets/school-logo.png');
  const coat = await embedImageIfPresent(pdfDoc, 'report_assets/coat-of-arms.png');
  if (logo) page.drawImage(logo, { x: 36, y: 710, width: 82, height: 54 });
  if (coat) page.drawImage(coat, { x: 482, y: 710, width: 54, height: 54 });

  drawCenteredText(page, 'UNIQUE CHILDREN SCHOOL', 306, 742, 16, fonts.bold, colors.blue);
  drawCenteredText(page, 'Block 12, Plot 350 Norus Close, Omole Estate Phase 1', 306, 722, 8.5, fonts.regular, colors.black);
  drawCenteredText(page, 'Website: uniquegroupofschools.com | Phone: 08034106866', 306, 710, 8.5, fonts.regular, colors.black);
  drawCenteredText(page, 'Email: info@uniquegroupofschools.com', 306, 698, 8.5, fonts.regular, colors.black);
  drawCenteredText(page, 'Motto: -', 306, 686, 8.2, fonts.italic, colors.black);
  line(page, 35, 675, 577, 675, colors.blue, 0.7);
  drawCenteredText(page, reportTitle, 306, 646, 10.5, fonts.bold, colors.black);
  line(page, 214, 643, 398, 643, colors.black, 0.6);
}

async function drawStudentInfo(page, pdfDoc, student, rows, totals, average, colors, fonts, metrics) {
  const x = 36;
  const top = 626;
  const rowH = 17.5;
  const labelW = 63;
  const valueW = 148;
  const photoW = 78;
  const rightLabelW = 124;
  const rightValueW = 87;
  const classSize = String(one('SELECT COUNT(*) AS count FROM students WHERE class_code = ?', student.class_code).count);
  const maxScore = rows.length * 100;
  const infoRows = [
    ['Name:', student.name.toUpperCase(), 'Performance Grade:', performanceGrade(average)],
    ['Reg. No:', student.id, 'Class Size:', classSize],
    ['Gender:', normaliseGender(student.gender), 'No. of Subjects:', String(rows.length)],
    ['Age:', valueFromMeta(`student_age_${student.id}`, ''), 'Student Total Score:', `${totals.totalScore} / ${maxScore}`],
    ['DOB:', valueFromMeta(`student_dob_${student.id}`, ''), 'Student Average(%):', `${average}%`],
    ['Class:', student.classLabel, '', ''],
  ];
  const photoX = x + labelW + valueW;
  const rightX = photoX + photoW;

  infoRows.forEach((row, i) => {
    const rowTop = top - (i * rowH);
    drawCell(page, { x, top: rowTop, width: labelW, height: rowH, fill: colors.infoLabel, border: colors.grid });
    drawCell(page, { x: x + labelW, top: rowTop, width: valueW, height: rowH, fill: colors.infoValue, border: colors.grid });
    drawCellText(page, row[0], x, rowTop, labelW, rowH, 8.8, fonts.bold, colors.black);
    drawCellText(page, row[1], x + labelW, rowTop, valueW, rowH, 8.8, i === 0 ? fonts.bold : fonts.regular, colors.black);

    if (i < 5) {
      drawCell(page, { x: rightX, top: rowTop, width: rightLabelW, height: rowH, fill: colors.infoLabel, border: colors.grid });
      drawCell(page, { x: rightX + rightLabelW, top: rowTop, width: rightValueW, height: rowH, fill: colors.infoValue, border: colors.grid });
      drawCellText(page, row[2], rightX, rowTop, rightLabelW, rowH, 8.8, fonts.bold, colors.black);
      drawCellText(page, row[3], rightX + rightLabelW, rowTop, rightValueW, rowH, 8.8, i === 0 ? fonts.bold : fonts.regular, colors.black);
    } else {
      drawCell(page, { x: photoX, top: rowTop, width: photoW + rightLabelW + rightValueW, height: rowH, fill: colors.white, border: colors.grid });
    }
  });

  drawCell(page, { x: photoX, top, width: photoW, height: rowH * 5, fill: colors.white, border: colors.grid });
  const photo = await embedImageIfPresent(pdfDoc, student.photo_path) || await embedImageIfPresent(pdfDoc, 'report_assets/student-placeholder.png');
  if (photo) page.drawImage(photo, { x: photoX + 10, y: top - (rowH * 5) + 12, width: 58, height: 59 });

  return metrics;
}

function drawAcademicTable(page, rows, examType, fonts, colors) {
  const x = 36;
  const top = 477;
  const rowH = 15.6;
  const widths = [206, 98, 98, 98];
  const headers = ['Subject', ...reportScoreColumns(examType), 'Total Score (100)'];
  let cursorX = x;

  drawUnderlinedText(page, 'Academic Performance', x, 502, 11.5, fonts.bold, colors.black);
  headers.forEach((header, i) => {
    drawCell(page, { x: cursorX, top, width: widths[i], height: 21, fill: colors.blue, border: colors.grid });
    drawCellText(page, header, cursorX, top, widths[i], 21, i === 0 ? 9.4 : 8.3, fonts.bold, colors.white, 'center');
    cursorX += widths[i];
  });

  rows.slice(0, 18).forEach((row, i) => {
    const rowTop = top - 21 - (i * rowH);
    const fill = i % 2 === 0 ? colors.academicStripe : colors.white;
    const values = [
      row.subjectName,
      row.ca ?? '-',
      row.exam ?? '-',
      row.total ?? '-',
    ];
    let cellX = x;
    values.forEach((value, col) => {
      drawCell(page, { x: cellX, top: rowTop, width: widths[col], height: rowH, fill, border: colors.grid, borderWidth: 0.35 });
      const isTotal = col === 3;
      const scoreColor = isTotal && Number(value) >= 70 ? colors.green : colors.black;
      drawCellText(page, value, cellX, rowTop, widths[col], rowH, 8.5, isTotal ? fonts.bold : fonts.regular, scoreColor, col === 0 ? 'left' : 'center');
      cellX += widths[col];
    });
  });
}

function drawAttendance(page, student, schoolDays, present, absent, fonts, colors) {
  const x = 36;
  const top = 438;
  const rowH = 16.5;
  const widths = [316, 184];
  const rows = [
    ['No. of School Days:', schoolDays],
    ['No. of Days Present:', present],
    ['No. of Days Absent:', absent],
    ['% Attendance:', `${student.att || 0}%`],
  ];

  drawUnderlinedText(page, 'Attendance Report', x, 457, 11.5, fonts.bold, colors.black);
  rows.forEach((row, i) => {
    const rowTop = top - (i * rowH);
    const fill = i % 2 === 0 ? colors.attendanceStripe : colors.white;
    drawCell(page, { x, top: rowTop, width: widths[0], height: rowH, fill, border: colors.grid });
    drawCell(page, { x: x + widths[0], top: rowTop, width: widths[1], height: rowH, fill: colors.white, border: colors.grid });
    drawCellText(page, row[0], x, rowTop, widths[0], rowH, 9.3, fonts.bold, colors.black);
    drawCellText(page, row[1], x + widths[0], rowTop, widths[1], rowH, 9.3, i === 3 ? fonts.bold : fonts.regular, i === 3 ? colors.green : colors.black, 'center');
  });
}

function drawGradingScale(page, fonts, colors) {
  const x = 36;
  const top = 322;
  const width = 500;
  const rowH = 26;
  const labels = [
    '70-100: 5 Grade\nPoints',
    '60-69: 4 Grade\nPoints',
    '50-59: 3 Grade\nPoints',
    '45-49: 2 Grade\nPoints',
    '40-44: 1 Grade\nPoint',
    '0-39: 0 Grade\nPoints',
  ];
  const cellW = width / labels.length;

  drawUnderlinedText(page, 'Grading Scale', x, 345, 11.5, fonts.bold, colors.black);
  labels.forEach((label, i) => {
    const cellX = x + (i * cellW);
    drawCell(page, { x: cellX, top, width: cellW, height: rowH, fill: colors.gradeFill, border: colors.grid });
    const [line1, line2] = label.split('\n');
    drawFittedText(page, line1, cellX + 4, top - 10.5, cellW - 8, 7.8, i === 0 ? fonts.bold : fonts.regular, colors.black, { align: 'center' });
    drawFittedText(page, line2, cellX + 4, top - 20.5, cellW - 8, 7.8, i === 0 ? fonts.bold : fonts.regular, colors.black, { align: 'center' });
  });
}

function drawComments(page, formTeacher, fonts, colors) {
  const x = 36;
  const top = 267;
  const width = 500;
  const rowH = 34;
  const teacherComment = valueFromMeta('teacher_comment_default', 'Well done! Your result is remarkable. Do not relent in your efforts.');
  const headComment = valueFromMeta('head_comment_default', 'Great work! Your diligence in your academics is impressive.');
  const headName = valueFromMeta('head_of_school_name', 'James Idoko Ajah');

  drawUnderlinedText(page, 'Comments', x, 287, 11.5, fonts.bold, colors.black);
  drawCell(page, { x, top, width, height: rowH, fill: colors.commentCream, border: colors.grid });
  text(page, "Form Teacher's Comment:", x + 7, top - 14, 9.2, fonts.bold, { color: colors.black });
  drawFittedText(page, teacherComment, x + 142, top - 14, width - 150, 9.2, fonts.italic, colors.black);
  text(page, `Form Teacher: ${formTeacher.teacherName || ''}`, x + 7, top - 29, 9.2, fonts.regular, { color: colors.black });

  const secondTop = top - rowH;
  drawCell(page, { x, top: secondTop, width, height: rowH, fill: colors.commentGreen, border: colors.grid });
  text(page, 'Head of School Comment:', x + 7, secondTop - 14, 9.2, fonts.bold, { color: colors.black });
  drawFittedText(page, headComment, x + 140, secondTop - 14, width - 148, 9.2, fonts.italic, colors.black);
  text(page, `Head of School: ${headName}`, x + 7, secondTop - 29, 9.2, fonts.regular, { color: colors.black });
}

// Draws a table header cell whose label runs bottom-to-top (rotated 90deg),
// for narrow score columns where horizontal text would be too cramped.
function drawVerticalHeaderCell(page, { x, top, width, height, value = '', fill, border, borderWidth = 0.35, font, size = 7.2, color }) {
  drawCell(page, { x, top, width, height, fill, border, borderWidth });
  const label = String(value ?? '').trim();
  if (!label) return;
  const { degrees } = loadPdfLib();
  const maxLen = height - 6;
  const out = trimToFit(font, label, size, maxLen);
  const renderedLen = textWidth(font, out, size);
  const cx = x + (width / 2) + (size * 0.32);
  const cy = (top - (height / 2)) - (renderedLen / 2);
  page.drawText(out, { x: cx, y: cy, size, font, color, rotate: degrees(90) });
}

function drawWordCell(page, {
  x,
  top,
  width,
  height,
  value = '',
  fill,
  border,
  borderWidth = 0.35,
  font,
  size = 8,
  color,
  align = 'left',
  pad = 4,
  lineHeight = size + 2,
}) {
  drawCell(page, { x, top, width, height, fill, border, borderWidth });
  const rawLines = String(value ?? '').split('\n');
  const lines = rawLines.length ? rawLines : [''];
  const totalHeight = lines.length * lineHeight;
  let y = top - ((height - totalHeight) / 2) - size + 1;
  lines.forEach(lineText => {
    drawFittedText(page, lineText, x + pad, y, width - (pad * 2), size, font, color, { align });
    y -= lineHeight;
  });
}

async function drawWordHeader(page, pdfDoc, fonts, colors) {
  const x = 36;
  const top = 756;
  const height = 58;
  const widths = [70, 400, 70];
  const logo = await embedImageIfPresent(pdfDoc, 'report_assets/school-logo.png');
  const coat = await embedImageIfPresent(pdfDoc, 'report_assets/coat-of-arms.png');

  drawWordCell(page, { x, top, width: widths[0], height, fill: colors.white, border: colors.grid, font: fonts.regular, color: colors.black });
  drawWordCell(page, { x: x + widths[0], top, width: widths[1], height, fill: colors.white, border: colors.grid, font: fonts.regular, color: colors.black });
  drawWordCell(page, { x: x + widths[0] + widths[1], top, width: widths[2], height, fill: colors.white, border: colors.grid, font: fonts.regular, color: colors.black });

  if (logo) page.drawImage(logo, { x: x + 4, y: top - 47, width: 62, height: 41 });
  if (coat) page.drawImage(coat, { x: x + widths[0] + widths[1] + 13, y: top - 52, width: 44, height: 44 });

  const centerX = x + widths[0] + (widths[1] / 2);
  drawCenteredText(page, 'UNIQUE CHILDREN SCHOOL', centerX, top - 15, 15, fonts.bold, colors.blue);
  drawCenteredText(page, 'BLOCK 12, PLOT 350 NORUS CLOSE, OMOLE ESTATE PHASE 1', centerX, top - 28, 7.3, fonts.regular, colors.black);
  drawCenteredText(page, 'Website : uniquegroupofschools.com     Phone : 08034106866', centerX, top - 39, 7.2, fonts.regular, colors.black);
  drawCenteredText(page, 'Email: info@uniquegroupofschools.com', centerX, top - 49, 7.2, fonts.regular, colors.black);
  drawCenteredText(page, 'Motto: -', centerX, top - 57, 6.8, fonts.italic, colors.black);
}

async function drawWordStudentInfo(page, pdfDoc, student, rows, totalScore, average, subjectMax, fonts, colors, extraRow = null) {
  const x = 36;
  const top = 646;
  const widths = [220, 100, 220];
  const rowH = 17;
  const classSize = String(one('SELECT COUNT(*) AS count FROM students WHERE class_code = ?', student.class_code).count);
  const maxScore = rows.length * subjectMax;
  const infoRows = [
    [`Name: ${student.name.toUpperCase()}`, `Performance Grade: ${performanceGrade(average)}`],
    [`Reg. No:${student.id}`, `Class Size: ${classSize}`],
    [`Gender: ${normaliseGender(student.gender)}`, `No. of Subjects: ${rows.length}`],
    [`Age: ${valueFromMeta(`student_age_${student.id}`, '')}`, `Student Total Score: ${totalScore}/${maxScore}`],
    [`DOB: ${valueFromMeta(`student_dob_${student.id}`, '')}`, `Student Average(%): ${average}%`],
    [`Class: ${student.classLabel}`, `Result Summary: ${gradeBand(average).word}`],
  ];
  if (extraRow) infoRows.push(extraRow);
  const rowCount = infoRows.length;
  infoRows.forEach((row, i) => {
    const rowTop = top - (i * rowH);
    drawWordCell(page, { x, top: rowTop, width: widths[0], height: rowH, value: row[0], fill: colors.white, border: colors.grid, font: fonts.bold, size: 8.2, color: colors.black, pad: 4 });
    drawWordCell(page, { x: x + widths[0] + widths[1], top: rowTop, width: widths[2], height: rowH, value: row[1], fill: colors.white, border: colors.grid, font: fonts.bold, size: 8.2, color: colors.black, pad: 4 });
  });

  drawCell(page, { x: x + widths[0], top, width: widths[1], height: rowH * rowCount, fill: colors.white, border: colors.grid, borderWidth: 0.35 });
  const photo = await embedImageIfPresent(pdfDoc, student.photo_path) || await embedImageIfPresent(pdfDoc, 'report_assets/student-placeholder.png');
  if (photo) {
    const photoX = x + widths[0];
    const photoWidth = widths[1];
    const photoSize = 60;
    page.drawImage(photo, {
      x: photoX + ((photoWidth - photoSize) / 2),
      y: top - (rowH * (rowCount / 2)) - (photoSize / 2),
      width: photoSize,
      height: photoSize,
    });
  }
  return rowH * (rowCount - 6);
}

function reportSubjectRows(rows, examType, priorTerms = [], priorTermData = {}) {
  const max = maxScoreForExamType(examType);
  const out = rows.slice(0, 18).map(row => {
    const pct = (!row.isAbsent && row.total != null && max) ? (row.total / max) * 100 : null;
    const priorTotals = priorTerms.map(t => {
      const val = priorTermData[t.id]?.[row.subjectId];
      return val == null ? '-' : val;
    });
    return {
      subject: row.subjectName,
      ca: row.isAbsent ? 'ABS' : row.ca ?? '-',
      exam: row.isAbsent ? 'ABS' : row.exam ?? '-',
      total: row.isAbsent ? 'ABS' : row.total ?? '-',
      remark: row.isAbsent || pct == null ? '-' : `${gradeBand(pct).letter} - ${gradeBand(pct).word}`,
      priorTotals,
    };
  });
  while (out.length < 18) out.push({ subject: '', ca: '', exam: '', total: '', remark: '', priorTotals: priorTerms.map(() => '') });
  return out;
}

const PRIOR_TERM_COLUMN_LABELS = ['First Term', 'Second Term'];

function drawWordMainTable(page, rows, examType, skillRating, attendance, fonts, colors, priorTerms = [], priorTermData = {}, topOffset = 0) {
  const x = 36;
  const top = 530 - topOffset;
  const isFinalExam = examType === 'Final Exam';
  const priorCount = isFinalExam ? priorTerms.length : 0;
  // Base widths (no prior-term columns) are exactly the original layout —
  // Term 1's Final Exam report, and every Mid-Term report, is unchanged.
  const baseWidths = isFinalExam ? [110, 34, 34, 42, 50, 185, 85] : [110, 44, 46, 54, 180, 106];
  const priorWidthPlans = { 1: [40], 2: [40, 40] };
  const priorShrink = { 1: { subject: 0, remark: 0, skill: 30, rating: 10 }, 2: { subject: 5, remark: 5, skill: 55, rating: 15 } };
  let widths = baseWidths;
  if (priorCount > 0) {
    const shrink = priorShrink[priorCount];
    const priorWidths = priorWidthPlans[priorCount];
    widths = [
      baseWidths[0] - shrink.subject, baseWidths[1], baseWidths[2], baseWidths[3],
      ...priorWidths,
      baseWidths[4] - shrink.remark, baseWidths[5] - shrink.skill, baseWidths[6] - shrink.rating,
    ];
  }
  const headerH = 70;
  const rowH = 14.75;
  const scoreHeaders = reportScoreColumns(examType);
  const priorHeaders = priorTerms.map((t, i) => PRIOR_TERM_COLUMN_LABELS[i] || t.termLabel);
  const headers = ['Subject', ...scoreHeaders, `Total Score (${maxScoreForExamType(examType)})`, ...priorHeaders, 'Grade Remarks', 'Affective / Psychomotor Skills', 'Rating'];
  const totalColumn = isFinalExam ? 3 : 2;
  const remarkColumn = totalColumn + 1 + priorCount;
  const skillColumn = remarkColumn + 1;
  const verticalHeaderCols = [];
  for (let i = 1; i <= remarkColumn; i += 1) verticalHeaderCols.push(i);
  const subjectRows = reportSubjectRows(rows, examType, priorTerms, priorTermData);
  const affective = AFFECTIVE_SKILLS.map(([key, , label]) => ({ key, label, rating: skillRating?.affective?.[key] ?? '-' }));
  const psychomotor = PSYCHOMOTOR_SKILLS.map(([key, , label]) => ({ key, label, rating: skillRating?.psychomotor?.[key] ?? '-' }));
  const attendanceRows = [
    ['No. of School Days :', attendance.schoolDays],
    ['No. of Days Present :', attendance.present],
    ['No. of Days Absent :', attendance.absent],
    ['% Attendance :', `${attendance.percent}%`],
  ];

  let cursorX = x;
  headers.forEach((header, i) => {
    if (verticalHeaderCols.includes(i)) {
      drawVerticalHeaderCell(page, {
        x: cursorX, top, width: widths[i], height: headerH, value: header,
        fill: colors.headerGrey, border: colors.grid, font: fonts.bold, size: 7.2, color: colors.black,
      });
    } else {
      drawWordCell(page, {
        x: cursorX,
        top,
        width: widths[i],
        height: headerH,
        value: header,
        fill: colors.headerGrey,
        border: colors.grid,
        font: fonts.bold,
        size: i === 0 ? 8 : 6.8,
        color: colors.black,
        align: 'center',
        pad: 3,
      });
    }
    cursorX += widths[i];
  });

  for (let i = 0; i < 24; i += 1) {
    const rowTop = top - headerH - (i * rowH);
    const subject = i < 18 ? subjectRows[i] : { subject: '', ca: '', exam: '', total: '', remark: '', priorTotals: priorTerms.map(() => '') };
    let cellX = x;
    const scoreValues = isFinalExam
      ? [subject.subject, subject.ca, subject.exam, subject.total, ...subject.priorTotals, subject.remark]
      : [subject.subject, subject.ca, subject.total, subject.remark];
    scoreValues.forEach((value, col) => {
      drawWordCell(page, {
        x: cellX,
        top: rowTop,
        width: widths[col],
        height: rowH,
        value,
        fill: colors.white,
        border: colors.grid,
        font: col === totalColumn ? fonts.bold : fonts.regular,
        size: col === 0 ? 7.4 : col === remarkColumn ? 6.2 : 7.6,
        color: colors.black,
        align: col === 0 ? 'left' : 'center',
        pad: 2,
      });
      cellX += widths[col];
    });

    const skillX = x + widths.slice(0, skillColumn).reduce((sum, width) => sum + width, 0);
    const skillWidth = widths[skillColumn];
    const ratingWidth = widths[skillColumn + 1];
    if (i === 0) {
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth + ratingWidth, height: rowH, value: 'Affective Skills Rating   (Scale of 1-to-5)', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'left' });
    } else if (i >= 1 && i <= 8) {
      const row = affective[i - 1];
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth, height: rowH, value: row.label, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'left' });
      drawWordCell(page, { x: skillX + skillWidth, top: rowTop, width: ratingWidth, height: rowH, value: row.rating, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    } else if (i === 9) {
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth + ratingWidth, height: rowH, value: 'Psychomotor Skills Rating   (Scale of  1-to-5)', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'left' });
    } else if (i >= 10 && i <= 18) {
      const row = psychomotor[i - 10];
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth, height: rowH, value: row.label, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'left' });
      drawWordCell(page, { x: skillX + skillWidth, top: rowTop, width: ratingWidth, height: rowH, value: row.rating, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    } else if (i === 19) {
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth + ratingWidth, height: rowH, value: 'Attendance Report', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'left' });
    } else {
      const row = attendanceRows[i - 20];
      drawWordCell(page, { x: skillX, top: rowTop, width: skillWidth, height: rowH, value: row?.[0] || '', fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'left' });
      drawWordCell(page, { x: skillX + skillWidth, top: rowTop, width: ratingWidth, height: rowH, value: row?.[1] || '', fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    }
  }
}

function drawWordGradeKey(page, fonts, colors, topOffset = 0) {
  const x = 36;
  const top = 81 - topOffset;
  const height = 28;
  const widths = [55, 80.8, 80.8, 80.8, 80.8, 80.8, 80.8];
  const values = [
    'Key to Grades',
    '70-100:5 Grade Points.',
    '60-69:4 Grade Points.',
    '50-59:3 Grade Points.',
    '45-49:2 Grade Points.',
    '40-44:1 Grade Point.',
    '0-39:0 Grade Points.',
  ];
  let cursorX = x;
  values.forEach((value, i) => {
    drawWordCell(page, { x: cursorX, top, width: widths[i], height, value, fill: colors.white, border: colors.grid, font: i === 0 ? fonts.bold : fonts.regular, size: i === 0 ? 6.2 : 6.8, color: colors.black, align: 'center', pad: 3 });
    cursorX += widths[i];
  });
}

async function drawWordComments(page, pdfDoc, formTeacher, fonts, colors, teacherComment, headComment) {
  const x = 36;
  const width = 540;
  const leftW = 324;
  const rightW = 216;
  const rowH = 24;
  const headName = valueFromMeta('head_of_school_name', 'James Idoko Ajah');

  const teacherTop = 326;
  drawWordCell(page, { x, top: teacherTop, width, height: rowH, value: `Form Teacher's Comment :  ${teacherComment}`, fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, pad: 5 });
  drawWordCell(page, { x, top: teacherTop - rowH, width: leftW, height: rowH, value: `Form Teacher :${formTeacher.teacherName || ''}`, fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, pad: 5 });
  drawWordCell(page, { x: x + leftW, top: teacherTop - rowH, width: rightW, height: rowH, value: "Form Teacher's Signature:", fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, align: 'center' });

  const teacherSigPath = formTeacher.teacherSignaturePath || '';
  const teacherSig = await embedImageIfPresent(pdfDoc, teacherSigPath);
  if (teacherSig) page.drawImage(teacherSig, { x: x + leftW + 70, y: teacherTop - (rowH * 2) + 4, width: 70, height: 18 });

  const headTop = 254;
  drawWordCell(page, { x, top: headTop, width, height: rowH, value: `Head of School Comment:  ${headComment}`, fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, pad: 5 });
  drawWordCell(page, { x, top: headTop - rowH, width: leftW, height: rowH, value: `Head of School: ${headName}`, fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, pad: 5 });
  drawWordCell(page, { x: x + leftW, top: headTop - rowH, width: rightW, height: rowH, value: "Head of School's Signature :", fill: colors.white, border: colors.grid, font: fonts.regular, size: 8, color: colors.black, align: 'center' });
  const headSig = await embedImageIfPresent(pdfDoc, valueFromMeta('head_signature_path', ''));
  if (headSig) page.drawImage(headSig, { x: x + leftW + 70, y: headTop - (rowH * 2) + 4, width: 70, height: 18 });
}

function drawWordScoreChart(page, rows, fonts, colors, degrees) {
  const x = 36;
  const top = 676;
  const width = 540;
  const height = 300;
  drawCell(page, { x, top, width, height, fill: colors.white, border: colors.grid, borderWidth: 0.35 });
  drawCenteredText(page, 'Chart Title', x + (width / 2), top - 24, 14, fonts.regular, colors.chartText);

  const plotX = x + 52;
  const plotY = top - height + 82;
  const plotW = width - 72;
  const plotH = height - 130;
  [0, 20, 40, 60, 80, 100, 120].forEach(mark => {
    const y = plotY + (plotH * mark / 120);
    line(page, plotX, y, plotX + plotW, y, colors.chartGrid, 0.35);
    drawFittedText(page, String(mark), x + 18, y - 3, 22, 7, fonts.regular, colors.chartText, { align: 'right' });
  });

  const chartRows = rows.slice(0, 18);
  const colorsList = colors.chartBars || [colors.blue];
  const slot = plotW / Math.max(chartRows.length, 1);
  chartRows.forEach((row, i) => {
    const barW = Math.min(12, slot * 0.32);
    const score = Math.max(0, Math.min(120, Number(row.total || 0)));
    const barH = plotH * score / 120;
    const bx = plotX + (slot * i) + ((slot - barW) / 2);
    page.drawRectangle({ x: bx, y: plotY, width: barW, height: barH, color: colorsList[i % colorsList.length] });
    const label = trimToFit(fonts.regular, row.subjectName || '', 6.8, 82);
    page.drawText(label, {
      x: bx - 4,
      y: plotY - 14,
      size: 6.8,
      font: fonts.regular,
      color: colors.chartText,
      rotate: degrees(48),
    });
  });
}

async function generateReportPdf({ studentId, classCode, examType }) {
  const { PDFDocument, StandardFonts, rgb, degrees } = loadPdfLib();
  const academic = activeAcademic();
  const student = one(
    `SELECT s.*, c.label AS classLabel, u.grade
     FROM students s
     JOIN classes c ON c.code = s.class_code
     LEFT JOIN users u ON u.id = s.id
     WHERE s.id = ? AND s.class_code = ?`,
    studentId,
    classCode
  );
  if (!student) throw new Error('Student not found for selected class');

  const rows = classReportRows(classCode, examType, studentId);
  if (!rows.length) throw new Error(`No ${examType} results found for ${student.name}`);
  const skillRating = skillRatingForReport(student.id, classCode, examType);

  const countedRows = rows.filter(row => !row.isAbsent);
  const rowTotals = countedRows.map(row => Number(row.total || 0));
  const totalScore = rowTotals.reduce((sum, value) => sum + value, 0);
  const subjectMax = maxScoreForExamType(examType);
  const average = countedRows.length ? Math.round((totalScore / (countedRows.length * subjectMax)) * 100) : 0;

  // Cumulative columns + GPA only apply to the Final Exam report (the one
  // representing a term's overall result) — Mid-Term stays exactly as is.
  let priorTerms = [];
  let priorTermData = {};
  let cumulativeGPA = null;
  if (examType === 'Final Exam') {
    priorTerms = priorTermsInSession(academic.sessionLabel, academic.termLabel);
    priorTerms.forEach(t => { priorTermData[t.id] = priorTermSubjectTotals(classCode, studentId, t.id); });
    const gpaSamples = [gradeBand(average).point];
    priorTerms.forEach(t => {
      const values = Object.values(priorTermData[t.id]);
      if (values.length) {
        const priorAvg = Math.round((values.reduce((a, b) => a + b, 0) / (values.length * subjectMax)) * 100);
        gpaSamples.push(gradeBand(priorAvg).point);
      }
    });
    cumulativeGPA = (gpaSamples.reduce((a, b) => a + b, 0) / gpaSamples.length).toFixed(3);
  }

  const computedSchoolDays = computeSchoolDays(academic.id);
  const schoolDays = computedSchoolDays != null ? computedSchoolDays : Number(valueFromMeta('school_days', 102));
  const present = Math.round((Number(student.att || 0) / 100) * schoolDays);
  const absent = Math.max(0, schoolDays - present);
  const formTeacher = rows.find(row => row.teacherSignaturePath) || rows[0] || {};

  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };
  const colors = {
    black: rgb(0.04, 0.04, 0.04),
    blue: rgb(0.18, 0.47, 0.70),
    green: rgb(0.0, 0.42, 0.18),
    white: rgb(1, 1, 1),
    grid: rgb(0.65, 0.65, 0.65),
    headerGrey: rgb(0.85, 0.85, 0.85),
    sectionGrey: rgb(0.94, 0.94, 0.94),
    chartGrid: rgb(0.80, 0.80, 0.80),
    chartText: rgb(0.32, 0.32, 0.32),
    chartBars: [
      rgb(0.29, 0.46, 0.75), rgb(0.93, 0.45, 0.16), rgb(0.60, 0.60, 0.60),
      rgb(1, 0.75, 0.14), rgb(0.36, 0.62, 0.82), rgb(0.43, 0.68, 0.29),
      rgb(0.16, 0.27, 0.50), rgb(0.62, 0.25, 0.07), rgb(0.38, 0.38, 0.38),
      rgb(0.63, 0.48, 0.00), rgb(0.17, 0.37, 0.56), rgb(0.29, 0.46, 0.21),
    ],
    infoLabel: rgb(0.86, 0.93, 0.98),
    infoValue: rgb(0.96, 0.96, 0.96),
    academicStripe: rgb(0.92, 0.96, 1),
    skillStripe: rgb(0.93, 0.97, 1),
    attendanceStripe: rgb(0.96, 0.96, 0.96),
    gradeFill: rgb(0.90, 0.95, 0.90),
    commentCream: rgb(1, 0.97, 0.90),
    commentGreen: rgb(0.90, 0.96, 0.90),
  };

  const page1 = pdfDoc.addPage([612, 792]);
  await drawWordHeader(page1, pdfDoc, fonts, colors);
  drawCenteredText(page1, reportHeading(academic, examType), 306, 674, 10, fonts.bold, colors.black);
  const extraInfoRow = cumulativeGPA != null ? ['', `Cumulative Grade Point Average: ${cumulativeGPA}`] : null;
  const topOffset = await drawWordStudentInfo(page1, pdfDoc, student, rows, totalScore, average, subjectMax, fonts, colors, extraInfoRow);
  drawWordMainTable(page1, rows, examType, skillRating, { schoolDays, present, absent, percent: student.att || 0 }, fonts, colors, priorTerms, priorTermData, topOffset);
  drawWordGradeKey(page1, fonts, colors, topOffset);

  const { teacherComment, headComment } = resolveReportComments({
    academicId: academic.id, studentId: student.id, examType, average,
  });

  const page2 = pdfDoc.addPage([612, 792]);
  await drawWordHeader(page2, pdfDoc, fonts, colors);
  drawWordScoreChart(page2, rows, fonts, colors, degrees);
  await drawWordComments(page2, pdfDoc, formTeacher, fonts, colors, teacherComment, headComment);
  text(page2, `NEXT TERM BEGINS: ${String(valueFromMeta('next_term_begins', 'MONDAY 27TH APRIL, 2026')).toUpperCase()}`, 36, 174, 9.5, fonts.bold, { color: colors.black });

  return Buffer.from(await pdfDoc.save());
}

async function sendParentEmail({ to, studentName, pdfPath }) {
  const config = smtpConfigStatus();
  const host = process.env.SMTP_HOST;
  if (!config.configured) return { status: 'email_not_configured', error: `Email setup missing: ${config.missing.join(', ')}` };
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user;
  if (!to || !from) return { status: 'missing_email_address', error: 'Parent or sender email is missing' };

  const boundary = `----ls-${crypto.randomBytes(8).toString('hex')}`;
  const pdf = fs.readFileSync(pdfPath).toString('base64').replace(/(.{76})/g, '$1\r\n');
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${studentName} Result Report`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Dear Parent,\r\n\r\nPlease find attached the published result report for ${studentName}.\r\n\r\nRegards,\r\nUnique Children School`,
    `--${boundary}`,
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${studentName.replace(/[^a-z0-9]+/gi, '_')}_result.pdf"`,
    '',
    pdf,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  try {
    await smtpSend({ host, port, user, pass, from, to, message });
    return { status: 'sent', error: '' };
  } catch (err) {
    return { status: 'email_failed', error: err.message };
  }
}

function smtpConfigStatus() {
  const host = cleanText(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 587);
  const user = cleanText(process.env.SMTP_USER);
  const pass = cleanText(process.env.SMTP_PASS);
  const from = cleanText(process.env.SMTP_FROM || user);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');
  if (!from) missing.push('SMTP_FROM');
  return {
    configured: missing.length === 0,
    host,
    port,
    secure,
    from,
    userConfigured: Boolean(user),
    missing,
  };
}

function smtpSend({ host, port, user, pass, from, to, message }) {
  return new Promise((resolve, reject) => {
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const socket = secure ? tls.connect(port, host) : net.connect(port, host);
    let buffer = '';
    const commands = [];
    const send = command => socket.write(`${command}\r\n`);
    const fail = err => {
      socket.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const enqueue = () => {
      commands.push(['EHLO localhost', false]);
      if (user && pass) {
        commands.push(['AUTH LOGIN', false]);
        commands.push([Buffer.from(user).toString('base64'), false]);
        commands.push([Buffer.from(pass).toString('base64'), false]);
      }
      commands.push([`MAIL FROM:<${from}>`, false]);
      commands.push([`RCPT TO:<${to}>`, false]);
      commands.push(['DATA', false]);
      commands.push([`${message}\r\n.`, true]);
      commands.push(['QUIT', true]);
    };
    socket.setTimeout(15000, () => fail(new Error('SMTP connection timed out')));
    socket.on('error', fail);
    socket.on('connect', enqueue);
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (!buffer.endsWith('\n')) return;
      const code = Number(buffer.slice(0, 3));
      if (code >= 400) return fail(new Error(buffer.trim()));
      buffer = '';
      const next = commands.shift();
      if (!next) return resolve();
      send(next[0]);
    });
  });
}

// Simple in-memory brute-force protection for /api/login. Keyed by the
// login identifier (not IP) so repeated attempts against one account are
// throttled regardless of source. No external store needed at this scale.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // window for counting failed attempts
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000; // lockout duration once tripped
const loginAttempts = new Map(); // identifier -> { count, firstAttempt, lockedUntil }

function loginRateLimitStatus(identifier) {
  const key = String(identifier || '').toUpperCase();
  const entry = loginAttempts.get(key);
  const now = Date.now();
  if (entry && entry.lockedUntil && entry.lockedUntil > now) {
    const minutesLeft = Math.ceil((entry.lockedUntil - now) / 60000);
    return {
      allowed: false,
      message: `Too many failed login attempts. Please try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
    };
  }
  return { allowed: true };
}

function recordFailedLogin(identifier) {
  const key = String(identifier || '').toUpperCase();
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || (entry.lockedUntil && entry.lockedUntil <= now) || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    entry = { count: 0, firstAttempt: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_COOLDOWN_MS;
  }
  loginAttempts.set(key, entry);
}

function resetLoginAttempts(identifier) {
  loginAttempts.delete(String(identifier || '').toUpperCase());
}

// ── FEES / BURSARY HELPERS (Finance MVP) ───────────────────────────────────
// Self-contained helpers for the fee_invoices / fee_payments tables added in
// createFeesSchema(). Kept separate from the result/academics helpers above
// so this can be reviewed/lifted independently of the rest of server.js.
const FEE_PAYMENT_STATUSES = ['successful', 'pending', 'failed'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function invoicePaidAmount(invoiceId) {
  return round2(one(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM fee_payments WHERE invoice_id = ? AND status = 'successful'`,
    invoiceId
  ).paid);
}

// Attaches computed paid/balance/status/overdue fields to a raw invoice row
// (a row already carrying `amount` and `dueDate` fields).
function decorateInvoice(row) {
  const paid = invoicePaidAmount(row.id);
  const amount = round2(row.amount);
  const balance = round2(amount - paid);
  const overdue = balance > 0 && !!row.dueDate && row.dueDate < todayStr();
  const status = balance <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
  return { ...row, amount, paid, balance, status, overdue };
}

function feeInvoiceById(id) {
  const row = one(
    `SELECT fi.id, fi.student_id AS studentId, st.name AS studentName, st.parent_email AS parentEmail,
            fi.academic_id AS academicId, fi.class_code AS classCode, c.label AS classLabel,
            fi.fee_type AS feeType, fi.description, fi.amount, fi.due_date AS dueDate,
            fi.created_by AS createdBy, fi.created_at AS createdAt
     FROM fee_invoices fi
     JOIN students st ON st.id = fi.student_id
     JOIN classes c ON c.code = fi.class_code
     WHERE fi.id = ?`,
    Number(id)
  );
  if (!row) return null;
  const payments = all(
    `SELECT id, amount, method, reference, status, note, recorded_by AS recordedBy, recorded_at AS recordedAt
     FROM fee_payments WHERE invoice_id = ? ORDER BY recorded_at DESC`,
    row.id
  ).map(p => ({ ...p, amount: round2(p.amount) }));
  return { ...decorateInvoice(row), payments };
}

function validateFeeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
  return round2(amount);
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJson(req);
    const id = String(body.id || '').trim().toUpperCase();
    const password = String(body.password || '');

    const rateLimit = loginRateLimitStatus(id);
    if (!rateLimit.allowed) {
      return sendJson(res, 429, { error: rateLimit.message });
    }

    const user = one('SELECT * FROM users WHERE id = ?', id);
    if (!user || !verifyPassword(password, user.password)) {
      recordFailedLogin(id);
      return sendJson(res, 401, { error: 'Incorrect ID or password' });
    }
    if (!user.active) {
      recordFailedLogin(id);
      return sendJson(res, 403, { error: 'This account has been deactivated. Contact the school administrator.' });
    }
    resetLoginAttempts(id);

    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    run(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      token,
      user.id,
      now.toISOString(),
      expires.toISOString()
    );
    return sendJson(res, 200, {
      user: publicUser(user),
      portal: `${user.role}-portal.html`,
    }, {
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${IS_PROD ? "; Secure" : ""}`,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) run('DELETE FROM sessions WHERE token = ?', token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PROD ? "; Secure" : ""}`,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const user = sessionUser(req);
    if (!user) return sendJson(res, 401, { authenticated: false });
    return sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      portal: `${user.role}-portal.html`,
    });
  }

  if (req.method === 'PUT' && url.pathname === '/api/account') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const email = cleanText(body.email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Enter a valid email address' });
    }
    run('UPDATE users SET email = ? WHERE id = ?', email, user.id);
    return sendJson(res, 200, { ok: true, user: publicUser(one('SELECT * FROM users WHERE id = ?', user.id)) });
  }

  if (req.method === 'POST' && url.pathname === '/api/account/password') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifyPassword(currentPassword, user.password)) {
      return sendJson(res, 401, { error: 'Current password is incorrect' });
    }
    if (newPassword.length < 4) {
      return sendJson(res, 400, { error: 'New password must be at least 4 characters' });
    }
    run('UPDATE users SET password = ? WHERE id = ?', hashPassword(newPassword), user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/account/signature') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const dataUrl = cleanText(body.dataUrl);
    if (!dataUrl) return sendJson(res, 400, { error: 'Signature image is required' });
    const stored = saveDataUrl(dataUrl, `signature-${user.id}`);
    run('UPDATE users SET signature_path = ? WHERE id = ?', stored, user.id);
    return sendJson(res, 200, { ok: true, signaturePath: stored });
  }

  if (req.method === 'POST' && url.pathname === '/api/forgot-password') {
    const body = await readJson(req);
    const id = String(body.id || '').trim().toUpperCase();
    const genericMessage = 'If that ID has an email address on file, a reset link has been sent to it.';
    if (!id) return sendJson(res, 400, { error: 'Enter your ID' });

    const rateKey = `FORGOT-${id}`;
    const rateLimit = loginRateLimitStatus(rateKey);
    if (!rateLimit.allowed) {
      return sendJson(res, 429, { error: rateLimit.message });
    }

    const user = one('SELECT * FROM users WHERE id = ?', id);
    if (!user || !user.email) {
      recordFailedLogin(rateKey);
      return sendJson(res, 200, { ok: true, message: genericMessage });
    }
    resetLoginAttempts(rateKey);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', token, expires, user.id);

    const config = smtpConfigStatus();
    if (config.configured) {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const link = `${proto}://${req.headers.host}/reset-password.html?token=${token}`;
      const message = [
        `From: ${config.from}`,
        `To: ${user.email}`,
        "Subject: Reset your Unique Children's School password",
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `Hello,\r\n\r\nA password reset was requested for account ${user.id}. Click the link below to set a new password. This link expires in 30 minutes.\r\n\r\n${link}\r\n\r\nIf you did not request this, you can safely ignore this email.\r\n\r\nRegards,\r\nUnique Children School`,
      ].join('\r\n');
      smtpSend({
        host: config.host, port: config.port,
        user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
        from: config.from, to: user.email, message,
      }).catch(() => {});
    }
    return sendJson(res, 200, { ok: true, message: genericMessage });
  }

  if (req.method === 'POST' && url.pathname === '/api/reset-password') {
    const body = await readJson(req);
    const token = String(body.token || '').trim();
    const newPassword = String(body.newPassword || '');
    if (!token) return sendJson(res, 400, { error: 'Missing reset token' });
    if (newPassword.length < 4) {
      return sendJson(res, 400, { error: 'New password must be at least 4 characters' });
    }
    const user = one('SELECT * FROM users WHERE reset_token = ?', token);
    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return sendJson(res, 400, { error: 'This reset link is invalid or has expired. Request a new one.' });
    }
    run(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      hashPassword(newPassword), user.id
    );
    return sendJson(res, 200, { ok: true });
  }

  const accountStatusMatch = url.pathname.match(/^\/api\/admin\/account-status\/([^/]+)$/);
  if (req.method === 'PUT' && accountStatusMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const targetId = decodeURIComponent(accountStatusMatch[1]).trim().toUpperCase();
    const target = one('SELECT id, role FROM users WHERE id = ?', targetId);
    if (!target) return sendJson(res, 404, { error: 'Account not found' });
    if (targetId === admin.id) return sendJson(res, 400, { error: "You can't deactivate your own account" });
    const body = await readJson(req);
    const active = body.active ? 1 : 0;
    run('UPDATE users SET active = ? WHERE id = ?', active, targetId);
    if (!active) run('DELETE FROM sessions WHERE user_id = ?', targetId);
    return sendJson(res, 200, { ok: true, active: !!active });
  }

  // ── ATTENDANCE ───────────────────────────────────────────────────────
  const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'permission'];

  if (req.method === 'POST' && url.pathname === '/api/admin/attendance/mark') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const date = cleanText(body.date);
    const personType = cleanText(body.personType);
    const sessionType = cleanText(body.sessionType) || 'daily';
    const classCode = cleanText(body.classCode).toUpperCase() || null;
    const subjectId = body.subjectId ? Number(body.subjectId) : null;
    const records = Array.isArray(body.records) ? body.records : [];

    if (!date) return sendJson(res, 400, { error: 'Date is required' });
    if (!['student', 'staff'].includes(personType)) return sendJson(res, 400, { error: 'Invalid person type' });
    if (!['daily', 'lesson', 'morning', 'afternoon'].includes(sessionType)) return sendJson(res, 400, { error: 'Invalid session type' });
    if (!records.length) return sendJson(res, 400, { error: 'No attendance records provided' });

    db.exec('BEGIN');
    try {
      run(
        `DELETE FROM attendance_records
         WHERE record_date = ? AND person_type = ? AND session_type = ? AND class_code IS ? AND subject_id IS ?`,
        date, personType, sessionType, classCode, subjectId
      );
      const insert = db.prepare(
        `INSERT INTO attendance_records (record_date, person_type, person_id, class_code, session_type, subject_id, status, marked_by, marked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const markedAt = new Date().toISOString();
      records.forEach(r => {
        const personId = cleanText(r.personId).toUpperCase();
        const status = cleanText(r.status).toLowerCase();
        if (!personId || !ATTENDANCE_STATUSES.includes(status)) return;
        insert.run(date, personType, personId, classCode, sessionType, subjectId, status, user.id, markedAt);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/attendance') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const personType = cleanText(url.searchParams.get('personType')) || 'student';
    const sessionType = cleanText(url.searchParams.get('sessionType')) || 'daily';
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const subjectIdParam = url.searchParams.get('subjectId');
    const from = cleanText(url.searchParams.get('from'));
    const to = cleanText(url.searchParams.get('to'));

    let sql = `SELECT record_date AS date, person_id AS personId, class_code AS classCode, subject_id AS subjectId, status
               FROM attendance_records WHERE person_type = ? AND session_type = ?`;
    const params = [personType, sessionType];
    if (classCode) { sql += ' AND class_code = ?'; params.push(classCode); }
    if (subjectIdParam) { sql += ' AND subject_id = ?'; params.push(Number(subjectIdParam)); }
    if (from) { sql += ' AND record_date >= ?'; params.push(from); }
    if (to) { sql += ' AND record_date <= ?'; params.push(to); }
    sql += ' ORDER BY record_date';
    return sendJson(res, 200, { records: all(sql, ...params) });
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher/result-contexts') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    return sendJson(res, 200, {
      teacher: publicUser(user),
      academic: activeAcademic(),
      contexts: teacherContexts(user.id),
    });
  }

  const studentsMatch = url.pathname.match(/^\/api\/teacher\/result-contexts\/(\d+)\/students$/);
  if (req.method === 'GET' && studentsMatch) {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const assignment = assignmentForTeacher(studentsMatch[1], user.id);
    if (!assignment) return sendJson(res, 404, { error: 'Result context not found' });
    return sendJson(res, 200, {
      students: studentRowsForClass(assignment.class_code),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher/results') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const contextId = url.searchParams.get('contextId');
    const examType = url.searchParams.get('examType');
    if (!contextId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Valid contextId and examType are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This result context is not assigned to you' });
    return sendJson(res, 200, {
      result: resultPayload(contextId, examType),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher/skills') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const contextId = url.searchParams.get('contextId');
    const examType = url.searchParams.get('examType');
    if (!contextId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Valid contextId and examType are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This class is not assigned to you' });
    if (assignment.teacher_type !== 'class_teacher') {
      return sendJson(res, 403, { error: 'Only class teachers can rate affective and psychomotor skills' });
    }
    return sendJson(res, 200, {
      ratings: skillRatingsForClass(assignment.class_code, examType),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher/skills') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const body = await readJson(req);
    const contextId = Number(body.contextId);
    const examType = cleanText(body.examType);
    const studentId = cleanText(body.studentId).toUpperCase();
    if (!contextId || !validateExamType(examType) || !studentId) {
      return sendJson(res, 400, { error: 'Student, class context, and exam type are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This class is not assigned to you' });
    if (assignment.teacher_type !== 'class_teacher') {
      return sendJson(res, 403, { error: 'Only class teachers can rate affective and psychomotor skills' });
    }
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, assignment.class_code);
    if (!student) return sendJson(res, 400, { error: `Student ${studentId} is not in ${assignment.class_code}` });

    let values;
    try {
      values = SKILL_COLUMNS.map(([key, , label]) => {
        const group = AFFECTIVE_SKILLS.some(([skillKey]) => skillKey === key) ? body.affective : body.psychomotor;
        return normalizeSkillRating(group?.[key], label);
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const academic = activeAcademic();
    const updatedAt = new Date().toISOString();
    const columnNames = SKILL_COLUMNS.map(([, column]) => column);
    const updateSql = columnNames.map(column => `${column} = excluded.${column}`).join(', ');
    run(
      `INSERT INTO student_skill_ratings
        (academic_id, student_id, class_code, exam_type, rated_by, updated_at, ${columnNames.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ${columnNames.map(() => '?').join(', ')})
       ON CONFLICT(academic_id, student_id, class_code, exam_type) DO UPDATE SET
         rated_by = excluded.rated_by,
         updated_at = excluded.updated_at,
         ${updateSql}`,
      academic.id,
      studentId,
      assignment.class_code,
      examType,
      user.id,
      updatedAt,
      ...values
    );
    const row = one(
      `SELECT * FROM student_skill_ratings
       WHERE academic_id = ? AND student_id = ? AND class_code = ? AND exam_type = ?`,
      academic.id,
      studentId,
      assignment.class_code,
      examType
    );
    return sendJson(res, 200, { ok: true, rating: publicSkillRating(row) });
  }

  // ── CLASS TEACHER'S COMMENT (per student, per exam) ─────────────────────
  if (req.method === 'GET' && url.pathname === '/api/teacher/report-comments') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const contextId = url.searchParams.get('contextId');
    const examType = url.searchParams.get('examType');
    if (!contextId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Valid contextId and examType are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This class is not assigned to you' });
    if (assignment.teacher_type !== 'class_teacher') {
      return sendJson(res, 403, { error: 'Only class teachers can write result comments' });
    }
    const academic = activeAcademic();
    const rows = all(
      `SELECT student_id AS studentId, teacher_comment AS comment, updated_at AS updatedAtIso
       FROM report_comments WHERE academic_id = ? AND class_code = ? AND exam_type = ?`,
      academic.id, assignment.class_code, examType
    );
    const comments = {};
    rows.forEach(row => {
      comments[row.studentId] = { comment: row.comment || '', updatedAt: formatSavedAt(row.updatedAtIso) };
    });
    return sendJson(res, 200, { comments });
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher/report-comments') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const body = await readJson(req);
    const contextId = Number(body.contextId);
    const examType = cleanText(body.examType);
    const studentId = cleanText(body.studentId).toUpperCase();
    const comment = cleanText(body.comment);
    if (!contextId || !validateExamType(examType) || !studentId) {
      return sendJson(res, 400, { error: 'Student, class context, and exam type are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This class is not assigned to you' });
    if (assignment.teacher_type !== 'class_teacher') {
      return sendJson(res, 403, { error: 'Only class teachers can write result comments' });
    }
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, assignment.class_code);
    if (!student) return sendJson(res, 400, { error: `Student ${studentId} is not in ${assignment.class_code}` });

    const academic = activeAcademic();
    const updatedAt = new Date().toISOString();
    run(
      `INSERT INTO report_comments (academic_id, student_id, class_code, exam_type, teacher_comment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(academic_id, student_id, class_code, exam_type) DO UPDATE SET
         teacher_comment = excluded.teacher_comment, updated_at = excluded.updated_at`,
      academic.id, studentId, assignment.class_code, examType, comment || null, updatedAt
    );
    return sendJson(res, 200, { ok: true, comment, updatedAt: formatSavedAt(updatedAt) });
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher/results') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const body = await readJson(req);
    const contextId = Number(body.contextId);
    const examType = String(body.examType || '');
    const replaceAll = Boolean(body.replaceAll);
    const incoming = Array.isArray(body.entries) ? body.entries : [];
    if (!contextId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Valid contextId and examType are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This result context is not assigned to you' });
    if (!incoming.length) return sendJson(res, 400, { error: 'At least one result entry is required' });

    let entries;
    try {
      entries = incoming.map(entry => {
        const studentId = String(entry.studentId || '').trim();
        const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, assignment.class_code);
        if (!student) throw new Error(`Student ${studentId} is not in ${assignment.class_code}`);
        const ca = normalizeScore(entry.ca, 'CA score', examType === 'Mid-Term Exam' ? 40 : 30);
        let exam = null;
        if (examType === 'Final Exam') {
          exam = normalizeScore(entry.exam, 'Exam score', 70);
        }
        return {
          studentId,
          ca,
          exam,
          total: examType === 'Final Exam' ? ca + exam : ca,
        };
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const academic = activeAcademic();
    const savedAt = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const existing = one(
        'SELECT id FROM result_batches WHERE academic_id = ? AND assignment_id = ? AND exam_type = ?',
        academic.id,
        contextId,
        examType
      );
      let batchId;
      if (existing) {
        batchId = existing.id;
        run('UPDATE result_batches SET saved_at = ?, teacher_id = ?, vetted_at = NULL, vetted_by = NULL WHERE id = ?', savedAt, user.id, batchId);
      } else {
        const inserted = run(
          `INSERT INTO result_batches (academic_id, assignment_id, teacher_id, class_code, subject_id, exam_type, saved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          academic.id,
          contextId,
          user.id,
          assignment.class_code,
          assignment.subject_id,
          examType,
          savedAt
        );
        batchId = Number(inserted.lastInsertRowid);
      }

      if (replaceAll) run('DELETE FROM result_entries WHERE batch_id = ?', batchId);
      entries.forEach(entry => run(
        `INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(batch_id, student_id) DO UPDATE SET
           ca_score = excluded.ca_score,
           exam_score = excluded.exam_score,
           total_score = excluded.total_score`,
        batchId,
        entry.studentId,
        entry.ca,
        entry.exam,
        entry.total
      ));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return sendJson(res, 200, {
      ok: true,
      result: resultPayload(contextId, examType),
    });
  }

  // Toggle Absent / Excluded for one student on a teacher's own result batch.
  // Same semantics and mutual exclusivity as the admin gradebook version, just
  // scoped through assignmentForTeacher instead of a free-form classCode.
  if (req.method === 'PUT' && url.pathname === '/api/teacher/gradebook/entries/flag') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const body = await readJson(req);
    const contextId = Number(body.contextId);
    const examType = cleanText(body.examType);
    const studentId = cleanText(body.studentId).toUpperCase();
    const field = cleanText(body.field);
    const value = !!body.value;
    if (!contextId || !validateExamType(examType) || !studentId || !['absent', 'excluded'].includes(field)) {
      return sendJson(res, 400, { error: 'Context, exam type, student, and a valid field are required' });
    }
    const assignment = assignmentForTeacher(contextId, user.id);
    if (!assignment) return sendJson(res, 403, { error: 'This result context is not assigned to you' });
    if (!one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, assignment.class_code)) {
      return sendJson(res, 400, { error: 'Student is not in this class' });
    }
    const academic = activeAcademic();
    const published = one(
      `SELECT id FROM report_publications WHERE academic_id = ? AND class_code = ? AND exam_type = ? LIMIT 1`,
      academic.id, assignment.class_code, examType
    );
    if (published) return sendJson(res, 409, { error: 'Unpublish this result before editing student scores' });

    const existingBatch = one(
      'SELECT id FROM result_batches WHERE academic_id = ? AND assignment_id = ? AND exam_type = ?',
      academic.id, contextId, examType
    );
    let batchId;
    if (existingBatch) {
      batchId = existingBatch.id;
    } else {
      const inserted = run(
        `INSERT INTO result_batches (academic_id, assignment_id, teacher_id, class_code, subject_id, exam_type, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        academic.id, contextId, user.id, assignment.class_code, assignment.subject_id, examType, new Date().toISOString()
      );
      batchId = Number(inserted.lastInsertRowid);
    }

    const column = field === 'absent' ? 'is_absent' : 'is_excluded';
    const otherColumn = field === 'absent' ? 'is_excluded' : 'is_absent';
    const existingEntry = one('SELECT id FROM result_entries WHERE batch_id = ? AND student_id = ?', batchId, studentId);
    if (existingEntry) {
      run(
        `UPDATE result_entries SET ${column} = ?, ${otherColumn} = CASE WHEN ? THEN 0 ELSE ${otherColumn} END WHERE id = ?`,
        value ? 1 : 0, value ? 1 : 0, existingEntry.id
      );
    } else {
      run(
        `INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score, ${column}) VALUES (?, ?, 0, NULL, 0, ?)`,
        batchId, studentId, value ? 1 : 0
      );
    }
    return sendJson(res, 200, { ok: true, result: resultPayload(contextId, examType) });
  }

  // Result Checker (teacher): read-only lookup of ALREADY-PUBLISHED results —
  // the same finished document a parent received — restricted to classes the
  // teacher is assigned to in some capacity. Never exposes unpublished/
  // in-progress scores from a batch the teacher doesn't own.
  if (req.method === 'GET' && url.pathname === '/api/teacher/result-checker/student') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    if (!studentId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Student and exam type are required' });
    }
    const student = one('SELECT id, name, class_code AS classCode FROM students WHERE id = ?', studentId);
    if (!student) return sendJson(res, 404, { error: 'Student not found' });
    const teacherClasses = all('SELECT DISTINCT class_code FROM teacher_assignments WHERE teacher_id = ?', user.id).map(r => r.class_code);
    if (!teacherClasses.includes(student.classCode)) {
      return sendJson(res, 403, { error: "You are not assigned to this student's class" });
    }
    const academic = activeAcademic();
    const published = one(
      'SELECT published_at AS publishedAtIso FROM report_publications WHERE student_id = ? AND class_code = ? AND exam_type = ? AND academic_id = ?',
      studentId, student.classCode, examType, academic.id
    );
    if (!published) return sendJson(res, 200, { published: false, studentName: student.name });
    const rows = classReportRows(student.classCode, examType, studentId);
    return sendJson(res, 200, {
      published: true,
      studentName: student.name,
      publishedAt: formatSavedAt(published.publishedAtIso),
      rows,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher/result-checker/class') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    const classArmId = url.searchParams.get('classArmId') ? Number(url.searchParams.get('classArmId')) : null;
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    const teacherClasses = all('SELECT DISTINCT class_code FROM teacher_assignments WHERE teacher_id = ?', user.id).map(r => r.class_code);
    if (!teacherClasses.includes(classCode)) {
      return sendJson(res, 403, { error: 'You are not assigned to this class' });
    }
    const academic = activeAcademic();
    const max = maxScoreForExamType(examType);
    const students = (classArmId
      ? all('SELECT id, name FROM students WHERE class_code = ? AND class_arm_id = ? ORDER BY name', classCode, classArmId)
      : all('SELECT id, name FROM students WHERE class_code = ? ORDER BY name', classCode)
    ).map(st => {
      const published = one(
        'SELECT published_at AS publishedAtIso FROM report_publications WHERE student_id = ? AND class_code = ? AND exam_type = ? AND academic_id = ?',
        st.id, classCode, examType, academic.id
      );
      if (!published) return { studentId: st.id, name: st.name, published: false };
      const rows = classReportRows(classCode, examType, st.id);
      const countedRows = rows.filter(r => !r.isAbsent);
      const totalScore = countedRows.reduce((sum, r) => sum + (r.total || 0), 0);
      const avgPct = countedRows.length ? Math.round((totalScore / (countedRows.length * max)) * 100) : 0;
      return { studentId: st.id, name: st.name, published: true, subjectCount: rows.length, avgPct };
    });
    return sendJson(res, 200, { classCode, examType, students });
  }

  // ── STUDENT PORTAL ROUTES ──
  // Every route below requires a valid student session and always filters by
  // the session's own user.id - a student id is never accepted from the
  // client (query/body), so a student can never request another student's
  // data. Results are only ever read via report_publications, so a teacher's
  // unpublished/in-progress scores are never exposed here.

  if (req.method === 'GET' && url.pathname === '/api/student/dashboard') {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const academic = activeAcademic();

    const subjectsCount = one(
      'SELECT COUNT(DISTINCT subject_id) AS n FROM teacher_assignments WHERE class_code = ?',
      student.classCode
    ).n;

    const standings = classStandings(student.classCode, academic.id, null);
    const mine = rankOf(standings, student.id);
    const overall = mine ? gradeForPct(mine.avgPct) : null;

    const publishedExamTypes = all(
      `SELECT DISTINCT exam_type AS examType FROM report_publications
       WHERE student_id = ? AND class_code = ? AND academic_id = ?`,
      student.id, student.classCode, academic.id
    ).map(r => r.examType);

    return sendJson(res, 200, {
      student: {
        id: student.id,
        name: student.name,
        initials: student.initials,
        classCode: student.classCode,
        classLabel: student.classLabel,
      },
      academic,
      attendanceRate: student.att,
      subjectsCount,
      hasPublishedResults: !!mine,
      overallGrade: overall ? overall.grade : null,
      overallPct: mine ? Math.round(mine.avgPct) : null,
      classPosition: mine ? mine.position : null,
      classSize: mine ? mine.classSize : null,
      publishedExamTypes,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/student/courses') {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const academic = activeAcademic();

    const subjects = all(
      `SELECT DISTINCT s.id, s.name, u.name AS teacherName
       FROM teacher_assignments ta
       JOIN subjects s ON s.id = ta.subject_id
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.class_code = ?
       ORDER BY s.name`,
      student.classCode
    );

    const publishedRows = publishedRowsForClass(student.classCode, academic.id, null)
      .filter(row => row.studentId === student.id);
    // Prefer the most authoritative published exam per subject: Final > Mid-Term > CA.
    const priority = { 'Final Exam': 2, 'Mid-Term Exam': 1 };
    const bestBySubject = new Map();
    publishedRows.forEach(row => {
      const current = bestBySubject.get(row.subjectId);
      if (!current || priority[row.examType] > priority[current.examType]) {
        bestBySubject.set(row.subjectId, row);
      }
    });

    const courses = subjects.map(subject => {
      const row = bestBySubject.get(subject.id);
      if (!row) {
        return {
          subjectId: subject.id,
          subjectName: subject.name,
          teacherName: subject.teacherName,
          published: false,
        };
      }
      const max = maxScoreForExamType(row.examType);
      const pct = Math.round((row.total / max) * 100);
      const { grade, remark } = gradeForPct(pct);
      return {
        subjectId: subject.id,
        subjectName: subject.name,
        teacherName: subject.teacherName,
        published: true,
        examType: row.examType,
        ca: row.ca,
        exam: row.exam,
        total: row.total,
        max,
        pct,
        grade,
        remark,
      };
    });

    const standings = classStandings(student.classCode, academic.id, null);
    const mine = rankOf(standings, student.id);
    const publishedCourses = courses.filter(c => c.published);
    const best = publishedCourses.length
      ? publishedCourses.reduce((a, b) => (b.pct > a.pct ? b : a))
      : null;
    const worst = publishedCourses.length
      ? publishedCourses.reduce((a, b) => (b.pct < a.pct ? b : a))
      : null;

    return sendJson(res, 200, {
      academic,
      classLabel: student.classLabel,
      courses,
      summary: {
        overallPct: mine ? Math.round(mine.avgPct) : null,
        classPosition: mine ? mine.position : null,
        classSize: mine ? mine.classSize : null,
        bestSubject: best ? best.subjectName : null,
        needsAttention: worst ? worst.subjectName : null,
        subjectsPassed: publishedCourses.filter(c => c.total >= c.max * 0.4).length,
        subjectsPublished: publishedCourses.length,
        subjectsTotal: courses.length,
      },
    });
  }

  // ── STUDENT: CBT (take scheduled computer-based tests) ──────────────
  // Only Multiple Choice questions are ever served here — Fill-in-the-Gap
  // and Theory questions exist in the bank for paper-based use but have no
  // auto-grading path, so they're excluded from the online exam entirely.
  if (req.method === 'GET' && url.pathname === '/api/student/cbt/exams') {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });

    const rows = all(`
      SELECT ss.id, ss.duration_minutes AS durationMinutes, ss.exam_date AS examDate,
             ss.exam_time AS examTime, ss.status,
             sub.id AS subjectId, sub.name AS subjectName,
             sc.title AS scheduleTitle, sc.session_label AS sessionLabel, sc.term_label AS termLabel,
             (SELECT COUNT(*) FROM cbt_questions q
                WHERE q.class_code = ss.class_code AND q.subject_id = ss.subject_id
                  AND q.question_type = 'Multiple Choice Question' AND q.vetted = 1 AND q.archived = 0) AS questionCount,
             a.id AS attemptId, a.started_at AS startedAt, a.submitted_at AS submittedAt,
             sc2.score, sc2.total_marks AS totalMarks
      FROM cbt_schedule_subjects ss
      JOIN subjects sub ON sub.id = ss.subject_id
      JOIN cbt_schedules sc ON sc.id = ss.schedule_id
      LEFT JOIN cbt_attempts a ON a.schedule_subject_id = ss.id AND a.student_id = ?
      LEFT JOIN cbt_scores sc2 ON sc2.schedule_subject_id = ss.id AND sc2.student_id = ?
      WHERE ss.class_code = ? AND ss.mode = 'Computer Based' AND ss.visible_to_students = 1
      ORDER BY ss.id DESC
    `, student.id, student.id, student.classCode);

    const exams = rows.map(row => ({
      id: row.id,
      subjectName: row.subjectName,
      scheduleTitle: row.scheduleTitle,
      sessionLabel: row.sessionLabel,
      termLabel: row.termLabel,
      durationMinutes: row.durationMinutes,
      examDate: row.examDate,
      examTime: row.examTime,
      status: row.status,
      questionCount: row.questionCount,
      attemptStatus: row.submittedAt ? 'submitted' : row.startedAt ? 'in_progress' : 'not_started',
      score: row.submittedAt ? row.score : null,
      totalMarks: row.submittedAt ? row.totalMarks : null,
    }));
    return sendJson(res, 200, { student: { id: student.id, name: student.name, classLabel: student.classLabel }, exams });
  }

  const cbtStartMatch = url.pathname.match(/^\/api\/student\/cbt\/exams\/(\d+)\/start$/);
  if (req.method === 'POST' && cbtStartMatch) {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const scheduleSubjectId = Number(cbtStartMatch[1]);
    const ss = one(
      `SELECT id, class_code AS classCode, subject_id AS subjectId, duration_minutes AS durationMinutes, status
       FROM cbt_schedule_subjects WHERE id = ? AND mode = 'Computer Based' AND visible_to_students = 1`,
      scheduleSubjectId
    );
    if (!ss || ss.classCode !== student.classCode) return sendJson(res, 404, { error: 'Exam not found' });

    let attempt = one('SELECT id, started_at AS startedAt, submitted_at AS submittedAt FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', scheduleSubjectId, student.id);
    if (attempt?.submittedAt) return sendJson(res, 409, { error: 'You have already submitted this exam' });
    if (!attempt) {
      if (ss.status !== 'live') return sendJson(res, 400, { error: 'This exam is not currently open' });
      const inserted = run(
        'INSERT INTO cbt_attempts (schedule_subject_id, student_id, started_at) VALUES (?, ?, ?)',
        scheduleSubjectId, student.id, new Date().toISOString()
      );
      attempt = { id: Number(inserted.lastInsertRowid), startedAt: new Date().toISOString(), submittedAt: null };
    }

    const questions = all(
      `SELECT id, question_text AS questionText, marks, options
       FROM cbt_questions
       WHERE class_code = ? AND subject_id = ? AND question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0
       ORDER BY id`,
      ss.classCode, ss.subjectId
    ).map(q => {
      let options = [];
      try { options = q.options ? JSON.parse(q.options) : []; } catch { options = []; }
      return { id: q.id, questionText: q.questionText, marks: q.marks, options: options.map(o => o.text) };
    });
    const answers = all('SELECT question_id AS questionId, selected_option AS selectedOption FROM cbt_attempt_answers WHERE attempt_id = ?', attempt.id);
    const deadline = new Date(new Date(attempt.startedAt).getTime() + ss.durationMinutes * 60000).toISOString();

    return sendJson(res, 200, {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      durationMinutes: ss.durationMinutes,
      deadline,
      questions,
      answers,
    });
  }

  const cbtAnswerMatch = url.pathname.match(/^\/api\/student\/cbt\/exams\/(\d+)\/answer$/);
  if (req.method === 'POST' && cbtAnswerMatch) {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const scheduleSubjectId = Number(cbtAnswerMatch[1]);
    const body = await readJson(req);
    const questionId = Number(body.questionId);
    const selectedOption = body.selectedOption === null || body.selectedOption === undefined ? null : Number(body.selectedOption);

    const ss = one('SELECT duration_minutes AS durationMinutes FROM cbt_schedule_subjects WHERE id = ?', scheduleSubjectId);
    if (!ss) return sendJson(res, 404, { error: 'Exam not found' });
    const attempt = one('SELECT id, started_at AS startedAt, submitted_at AS submittedAt FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', scheduleSubjectId, student.id);
    if (!attempt) return sendJson(res, 400, { error: 'Start the exam before answering' });
    if (attempt.submittedAt) return sendJson(res, 409, { error: 'This exam has already been submitted' });
    const deadline = new Date(attempt.startedAt).getTime() + ss.durationMinutes * 60000;
    if (Date.now() > deadline) return sendJson(res, 410, { error: 'Time is up for this exam' });
    if (!one('SELECT id FROM cbt_questions WHERE id = ?', questionId)) {
      return sendJson(res, 400, { error: 'Question not found' });
    }
    run(
      `INSERT INTO cbt_attempt_answers (attempt_id, question_id, selected_option) VALUES (?, ?, ?)
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET selected_option = excluded.selected_option`,
      attempt.id, questionId, selectedOption
    );
    return sendJson(res, 200, { ok: true });
  }

  const cbtSubmitMatch = url.pathname.match(/^\/api\/student\/cbt\/exams\/(\d+)\/submit$/);
  if (req.method === 'POST' && cbtSubmitMatch) {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const scheduleSubjectId = Number(cbtSubmitMatch[1]);
    const ss = one('SELECT class_code AS classCode, subject_id AS subjectId FROM cbt_schedule_subjects WHERE id = ?', scheduleSubjectId);
    if (!ss) return sendJson(res, 404, { error: 'Exam not found' });
    const attempt = one('SELECT id, submitted_at AS submittedAt FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', scheduleSubjectId, student.id);
    if (!attempt) return sendJson(res, 400, { error: 'You have not started this exam' });
    if (attempt.submittedAt) return sendJson(res, 409, { error: 'This exam has already been submitted' });

    const questions = all(
      `SELECT id, marks, options FROM cbt_questions
       WHERE class_code = ? AND subject_id = ? AND question_type = 'Multiple Choice Question' AND vetted = 1 AND archived = 0`,
      ss.classCode, ss.subjectId
    );
    const answered = new Map(
      all('SELECT question_id AS questionId, selected_option AS selectedOption FROM cbt_attempt_answers WHERE attempt_id = ?', attempt.id)
        .map(a => [a.questionId, a.selectedOption])
    );
    let score = 0;
    let totalMarks = 0;
    let questionsAttempted = 0;
    questions.forEach(q => {
      totalMarks += Number(q.marks) || 0;
      const selected = answered.get(q.id);
      if (selected === undefined || selected === null) return;
      questionsAttempted += 1;
      let options = [];
      try { options = q.options ? JSON.parse(q.options) : []; } catch { options = []; }
      if (options[selected]?.correct) score += Number(q.marks) || 0;
    });

    db.exec('BEGIN');
    try {
      run('UPDATE cbt_attempts SET submitted_at = ? WHERE id = ?', new Date().toISOString(), attempt.id);
      run(
        `INSERT INTO cbt_scores (schedule_subject_id, student_id, score, total_marks, questions_presented, questions_attempted, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(schedule_subject_id, student_id) DO UPDATE SET
           score = excluded.score, total_marks = excluded.total_marks,
           questions_presented = excluded.questions_presented, questions_attempted = excluded.questions_attempted,
           recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
        scheduleSubjectId, student.id, score, totalMarks, questions.length, questionsAttempted, student.id, new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true, score, totalMarks, questionsPresented: questions.length, questionsAttempted });
  }

  if (req.method === 'GET' && url.pathname === '/api/student/results') {
    const user = requireUser(req, res, 'student');
    if (!user) return;
    const examType = cleanText(url.searchParams.get('examType') || 'Mid-Term Exam');
    if (!validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Valid examType is required' });
    }
    const student = studentRecord(user.id);
    if (!student) return sendJson(res, 404, { error: 'Student record not found' });
    const academic = activeAcademic();

    if (!isResultPublished(student.id, student.classCode, examType, academic.id)) {
      return sendJson(res, 200, { published: false, examType, academic });
    }

    const pub = one(
      `SELECT published_at AS publishedAtIso FROM report_publications
       WHERE student_id = ? AND class_code = ? AND exam_type = ? AND academic_id = ?`,
      student.id, student.classCode, examType, academic.id
    );
    const max = maxScoreForExamType(examType);
    const rawRows = classReportRows(student.classCode, examType, student.id);
    const rows = rawRows.map(row => {
      if (row.isAbsent) {
        return {
          subjectName: row.subjectName,
          teacherName: row.teacherName,
          ca: null,
          exam: null,
          total: null,
          max,
          pct: null,
          grade: 'ABS',
          remark: 'Absent',
          isAbsent: true,
        };
      }
      const pct = Math.round((row.total / max) * 100);
      const { grade, remark } = gradeForPct(pct);
      return {
        subjectName: row.subjectName,
        teacherName: row.teacherName,
        ca: row.ca,
        exam: row.exam,
        total: row.total,
        max,
        pct,
        grade,
        remark,
        isAbsent: false,
      };
    });
    const countedRows = rows.filter(r => !r.isAbsent);
    const totalScore = countedRows.reduce((sum, r) => sum + r.total, 0);
    const totalMax = countedRows.length * max;
    const avgPct = countedRows.length ? Math.round((totalScore / totalMax) * 100) : 0;
    const overall = gradeForPct(avgPct);
    const highest = countedRows.length ? countedRows.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;

    const standings = classStandings(student.classCode, academic.id, examType);
    const mine = rankOf(standings, student.id);

    return sendJson(res, 200, {
      published: true,
      examType,
      academic,
      publishedAt: formatSavedAt(pub.publishedAtIso),
      rows,
      totals: { score: totalScore, max: totalMax, pct: avgPct, grade: overall.grade, remark: overall.remark },
      classPosition: mine ? mine.position : null,
      classSize: mine ? mine.classSize : null,
      highestSubject: highest ? { subjectName: highest.subjectName, total: highest.total } : null,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/result-setup') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, adminSetupPayload());
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/skills') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType') || 'Mid-Term Exam');
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    return sendJson(res, 200, {
      ratings: skillRatingsForClass(classCode, examType),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/skills') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType || 'Mid-Term Exam');
    const studentId = cleanText(body.studentId).toUpperCase();
    if (!classCode || !validateExamType(examType) || !studentId) {
      return sendJson(res, 400, { error: 'Student, class, and exam type are required' });
    }
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, classCode);
    if (!student) return sendJson(res, 400, { error: `Student ${studentId} is not in ${classCode}` });

    let values;
    try {
      values = SKILL_COLUMNS.map(([key, , label]) => {
        const group = AFFECTIVE_SKILLS.some(([skillKey]) => skillKey === key) ? body.affective : body.psychomotor;
        return normalizeSkillRating(group?.[key], label);
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const academic = activeAcademic();
    const updatedAt = new Date().toISOString();
    const columnNames = SKILL_COLUMNS.map(([, column]) => column);
    const updateSql = columnNames.map(column => `${column} = excluded.${column}`).join(', ');
    run(
      `INSERT INTO student_skill_ratings
        (academic_id, student_id, class_code, exam_type, rated_by, updated_at, ${columnNames.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ${columnNames.map(() => '?').join(', ')})
       ON CONFLICT(academic_id, student_id, class_code, exam_type) DO UPDATE SET
         rated_by = excluded.rated_by,
         updated_at = excluded.updated_at,
         ${updateSql}`,
      academic.id,
      studentId,
      classCode,
      examType,
      user.id,
      updatedAt,
      ...values
    );
    const row = one(
      `SELECT * FROM student_skill_ratings
       WHERE academic_id = ? AND student_id = ? AND class_code = ? AND exam_type = ?`,
      academic.id,
      studentId,
      classCode,
      examType
    );
    return sendJson(res, 200, { ok: true, rating: publicSkillRating(row) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/gradebook') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    const gradebook = adminGradebook(classCode, examType);
    if (!gradebook) return sendJson(res, 400, { error: 'No active academic term' });
    return sendJson(res, 200, { gradebook });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/gradebook/scores') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType);
    const incoming = Array.isArray(body.entries) ? body.entries : [];
    if (!classCode || !validateExamType(examType) || !incoming.length) {
      return sendJson(res, 400, { error: 'Class, exam type, and score entries are required' });
    }
    const academic = activeAcademic();
    if (!academic) return sendJson(res, 400, { error: 'No active academic term' });
    const published = one(
      `SELECT id FROM report_publications
       WHERE academic_id = ? AND class_code = ? AND exam_type = ? LIMIT 1`,
      academic.id, classCode, examType
    );
    if (published) return sendJson(res, 409, { error: 'Unpublish this result before editing student scores' });

    const batches = all(
      `SELECT id, subject_id AS subjectId
       FROM result_batches
       WHERE academic_id = ? AND class_code = ? AND exam_type = ?`,
      academic.id, classCode, examType
    );
    const batchMap = new Map(batches.map(batch => [Number(batch.id), batch]));
    const studentIds = new Set(all('SELECT id FROM students WHERE class_code = ?', classCode).map(row => row.id));
    const caMax = examType === 'Final Exam' ? 30 : 40;
    const examMax = 70;
    const cleanScore = (value, fieldName, max) => {
      if (value === null || value === undefined || value === '') return null;
      return normalizeScore(value, fieldName, max);
    };
    const cleaned = [];
    try {
      incoming.forEach(entry => {
        const batchId = Number(entry.batchId);
        const studentId = cleanText(entry.studentId).toUpperCase();
        const batch = batchMap.get(batchId);
        if (!batch) throw new Error('One or more score rows do not belong to this class and exam');
        if (!studentIds.has(studentId)) throw new Error(`Student ${studentId} is not in this class`);
        const ca = cleanScore(entry.ca, 'CA score', caMax);
        const exam = examType === 'Final Exam' ? cleanScore(entry.exam, 'Exam score', examMax) : null;
        const total = ca === null || (examType === 'Final Exam' && exam === null)
          ? null
          : ca + (examType === 'Final Exam' ? exam : 0);
        cleaned.push({ batchId, studentId, ca, exam, total });
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    db.exec('BEGIN');
    try {
      cleaned.forEach(entry => run(
        `INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(batch_id, student_id) DO UPDATE SET
           ca_score = excluded.ca_score,
           exam_score = excluded.exam_score,
           total_score = excluded.total_score`,
        entry.batchId, entry.studentId, entry.ca, entry.exam, entry.total
      ));
      run(
        `UPDATE result_batches
         SET saved_at = ?, vetted_at = NULL, vetted_by = NULL
         WHERE academic_id = ? AND class_code = ? AND exam_type = ?`,
        new Date().toISOString(), academic.id, classCode, examType
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true, gradebook: adminGradebook(classCode, examType) });
  }

  // Toggle a student's Absent / Excluded flag for one subject batch. Absent
  // means they missed this exam (score locked, shown as "ABS", left out of
  // class average and ranking). Excluded means they don't take this subject
  // at all (removed from this subject's gradebook rows and report card).
  // The two are mutually exclusive — setting one clears the other.
  if (req.method === 'PUT' && url.pathname === '/api/admin/gradebook/entries/flag') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const batchId = Number(body.batchId);
    const studentId = cleanText(body.studentId).toUpperCase();
    const field = cleanText(body.field);
    const value = !!body.value;
    if (!batchId || !studentId || !['absent', 'excluded'].includes(field)) {
      return sendJson(res, 400, { error: 'Batch, student, and a valid field are required' });
    }
    const batch = one(
      'SELECT class_code AS classCode, exam_type AS examType, academic_id AS academicId FROM result_batches WHERE id = ?',
      batchId
    );
    if (!batch) return sendJson(res, 404, { error: 'Result batch not found' });
    const academic = activeAcademic();
    if (!academic || academic.id !== batch.academicId) {
      return sendJson(res, 400, { error: 'This batch is not part of the active academic term' });
    }
    const published = one(
      `SELECT id FROM report_publications WHERE academic_id = ? AND class_code = ? AND exam_type = ? LIMIT 1`,
      academic.id, batch.classCode, batch.examType
    );
    if (published) return sendJson(res, 409, { error: 'Unpublish this result before editing student scores' });
    if (!one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, batch.classCode)) {
      return sendJson(res, 400, { error: 'Student is not in this class' });
    }

    const column = field === 'absent' ? 'is_absent' : 'is_excluded';
    const otherColumn = field === 'absent' ? 'is_excluded' : 'is_absent';
    const existing = one('SELECT id FROM result_entries WHERE batch_id = ? AND student_id = ?', batchId, studentId);
    if (existing) {
      run(
        `UPDATE result_entries SET ${column} = ?, ${otherColumn} = CASE WHEN ? THEN 0 ELSE ${otherColumn} END WHERE id = ?`,
        value ? 1 : 0, value ? 1 : 0, existing.id
      );
    } else {
      run(
        `INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score, ${column})
         VALUES (?, ?, 0, NULL, 0, ?)`,
        batchId, studentId, value ? 1 : 0
      );
    }
    run('UPDATE result_batches SET vetted_at = NULL, vetted_by = NULL WHERE id = ?', batchId);
    return sendJson(res, 200, { ok: true, gradebook: adminGradebook(batch.classCode, batch.examType) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/reports/publish') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType);
    const requestedIds = Array.isArray(body.studentIds) ? body.studentIds.map(id => cleanText(id).toUpperCase()).filter(Boolean) : [];
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    const batches = classBatches(classCode, examType);
    if (!batches.length) {
      return sendJson(res, 400, { error: 'No teacher results have been submitted for that class and exam' });
    }
    const students = all(
      `SELECT id, name, parent_email AS parentEmail
       FROM students
       WHERE class_code = ?
       ${requestedIds.length ? `AND id IN (${requestedIds.map(() => '?').join(',')})` : ''}
       ORDER BY name`,
      classCode,
      ...requestedIds
    );
    if (!students.length) return sendJson(res, 400, { error: 'No students found to publish' });

    const academic = activeAcademic();
    const published = [];
    const skipped = [];
    for (const student of students) {
      if (!classReportRows(classCode, examType, student.id).length) {
        skipped.push({ studentId: student.id, studentName: student.name, reason: 'No results recorded for this exam' });
        continue;
      }
      let pdfBytes;
      try {
        pdfBytes = await generateReportPdf({ studentId: student.id, classCode, examType });
      } catch (err) {
        skipped.push({ studentId: student.id, studentName: student.name, reason: err.message });
        continue;
      }
      const safeName = `${student.id}-${examType}`.replace(/[^a-z0-9-]+/gi, '_');
      const fileName = `${safeName}-${Date.now()}.pdf`;
      const pdfPath = path.join(REPORT_DIR, fileName);
      fs.writeFileSync(pdfPath, pdfBytes);

      const mail = student.parentEmail
        ? await sendParentEmail({ to: student.parentEmail, studentName: student.name, pdfPath })
        : { status: 'missing_parent_email', error: 'Parent email is not set' };
      const inserted = run(
        `INSERT INTO report_publications
          (academic_id, student_id, class_code, exam_type, pdf_path, parent_email, email_status, email_error, published_by, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        academic.id,
        student.id,
        classCode,
        examType,
        path.relative(ROOT, pdfPath).replace(/\\/g, '/'),
        student.parentEmail || '',
        mail.status,
        mail.error || '',
        user.id,
        new Date().toISOString()
      );
      published.push({
        id: Number(inserted.lastInsertRowid),
        studentId: student.id,
        studentName: student.name,
        emailStatus: mail.status,
        emailError: mail.error || '',
      });
    }
    if (!published.length) {
      return sendJson(res, 400, { error: `No reports could be published — ${skipped.length} student${skipped.length === 1 ? '' : 's'} had no recorded results for ${examType}` });
    }
    return sendJson(res, 200, { ok: true, published, skipped, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/reports/unpublish') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType);
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    const academic = activeAcademic();
    const rows = all(
      'SELECT id, pdf_path AS pdfPath FROM report_publications WHERE academic_id = ? AND class_code = ? AND exam_type = ?',
      academic.id, classCode, examType
    );
    rows.forEach(row => {
      const abs = absoluteAssetPath(row.pdfPath);
      if (abs && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch (err) {}
      }
    });
    run('DELETE FROM report_publications WHERE academic_id = ? AND class_code = ? AND exam_type = ?', academic.id, classCode, examType);
    return sendJson(res, 200, { ok: true, unpublishedCount: rows.length, setup: adminSetupPayload() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/reports/preview') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    if (!studentId || !classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Student, class, and exam type are required' });
    }
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, classCode);
    if (!student) return sendJson(res, 404, { error: 'Student not found in this class' });
    let pdfBytes;
    try {
      pdfBytes = await generateReportPdf({ studentId, classCode, examType });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Could not generate report preview' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${studentId}-${examType.replace(/[^a-z0-9]+/gi, '_')}-preview.pdf"`,
      'Content-Length': pdfBytes.length,
    });
    return res.end(pdfBytes);
  }

  // Same preview as the admin route above, but scoped to a teacher who is
  // registered as the CLASS TEACHER for this class — not just any teacher
  // with a subject in it, since this is the full multi-subject report.
  if (req.method === 'GET' && url.pathname === '/api/teacher/reports/preview') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    if (!studentId || !classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Student, class, and exam type are required' });
    }
    const isClassTeacher = one(
      `SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_code = ? AND teacher_type = 'class_teacher' LIMIT 1`,
      user.id, classCode
    );
    if (!isClassTeacher) return sendJson(res, 403, { error: 'You are not the class teacher for this class' });
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, classCode);
    if (!student) return sendJson(res, 404, { error: 'Student not found in this class' });
    let pdfBytes;
    try {
      pdfBytes = await generateReportPdf({ studentId, classCode, examType });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Could not generate report preview' });
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${studentId}-${examType.replace(/[^a-z0-9]+/gi, '_')}-preview.pdf"`,
      'Content-Length': pdfBytes.length,
    });
    return res.end(pdfBytes);
  }

  // ── TEACHER: CBT QUESTION AUTHORING ─────────────────────────────────
  // A teacher may add/edit/delete multiple-choice CBT questions for any
  // class+subject they're assigned to (class_teacher or subject_teacher —
  // either grants access). Questions go live immediately (no vetting step).
  if (req.method === 'GET' && url.pathname === '/api/teacher/cbt/context') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const rows = all(
      `SELECT DISTINCT ta.class_code AS classCode, c.label AS classLabel, ta.subject_id AS subjectId, s.name AS subjectName
       FROM teacher_assignments ta
       JOIN classes c ON c.code = ta.class_code
       JOIN subjects s ON s.id = ta.subject_id
       WHERE ta.teacher_id = ?
       ORDER BY c.label, s.name`,
      user.id
    );
    return sendJson(res, 200, { context: rows });
  }

  function teacherOwnsCbtContext(teacherId, classCode, subjectId) {
    return !!one(
      'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_code = ? AND subject_id = ? LIMIT 1',
      teacherId, classCode, subjectId
    );
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher/cbt/questions') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const subjectId = Number(url.searchParams.get('subjectId'));
    if (!classCode || !subjectId) return sendJson(res, 400, { error: 'Class and subject are required' });
    if (!teacherOwnsCbtContext(user.id, classCode, subjectId)) {
      return sendJson(res, 403, { error: 'You are not assigned to this class/subject' });
    }
    const rows = all(
      `SELECT q.id, q.question_text AS questionText, q.marks, q.options, q.archived,
              q.created_by AS createdBy, u.name AS createdByName, q.created_at AS createdAt
       FROM cbt_questions q
       LEFT JOIN users u ON u.id = q.created_by
       WHERE q.class_code = ? AND q.subject_id = ? AND q.question_type = 'Multiple Choice Question'
       ORDER BY q.created_at DESC`,
      classCode, subjectId
    ).map(r => ({
      ...r,
      options: (() => { try { return r.options ? JSON.parse(r.options) : []; } catch { return []; } })(),
      isMine: r.createdBy === user.id,
    }));
    return sendJson(res, 200, { questions: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher/cbt/questions') {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const subjectId = Number(body.subjectId);
    const questionText = cleanText(body.questionText);
    const marks = Number(body.marks) || 1;
    const options = Array.isArray(body.options)
      ? body.options.map(o => ({ text: cleanText(o.text), correct: !!o.correct })).filter(o => o.text)
      : [];
    if (!classCode || !subjectId || !questionText) {
      return sendJson(res, 400, { error: 'Class, subject, and question text are required' });
    }
    if (!teacherOwnsCbtContext(user.id, classCode, subjectId)) {
      return sendJson(res, 403, { error: 'You are not assigned to this class/subject' });
    }
    if (!options.length || options.length > 6) {
      return sendJson(res, 400, { error: 'Add 1 to 6 answer options' });
    }
    if (!options.some(o => o.correct)) {
      return sendJson(res, 400, { error: 'Mark one option as the correct answer' });
    }
    run(
      `INSERT INTO cbt_questions (class_code, subject_id, question_type, question_text, marks, options, vetted, created_by, created_at)
       VALUES (?, ?, 'Multiple Choice Question', ?, ?, ?, 1, ?, ?)`,
      classCode, subjectId, questionText, marks, JSON.stringify(options), user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const teacherCbtQuestionMatch = url.pathname.match(/^\/api\/teacher\/cbt\/questions\/(\d+)$/);
  if (req.method === 'PUT' && teacherCbtQuestionMatch) {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const id = Number(teacherCbtQuestionMatch[1]);
    const existing = one('SELECT created_by AS createdBy FROM cbt_questions WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Question not found' });
    if (existing.createdBy !== user.id) return sendJson(res, 403, { error: 'You can only edit questions you added yourself' });
    const body = await readJson(req);
    const questionText = cleanText(body.questionText);
    const marks = Number(body.marks) || 1;
    const options = Array.isArray(body.options)
      ? body.options.map(o => ({ text: cleanText(o.text), correct: !!o.correct })).filter(o => o.text)
      : [];
    if (!questionText) return sendJson(res, 400, { error: 'Question text is required' });
    if (!options.length || options.length > 6) return sendJson(res, 400, { error: 'Add 1 to 6 answer options' });
    if (!options.some(o => o.correct)) return sendJson(res, 400, { error: 'Mark one option as the correct answer' });
    run(
      'UPDATE cbt_questions SET question_text = ?, marks = ?, options = ? WHERE id = ?',
      questionText, marks, JSON.stringify(options), id
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && teacherCbtQuestionMatch) {
    const user = requireUser(req, res, 'teacher');
    if (!user) return;
    const id = Number(teacherCbtQuestionMatch[1]);
    const existing = one('SELECT created_by AS createdBy FROM cbt_questions WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Question not found' });
    if (existing.createdBy !== user.id) return sendJson(res, 403, { error: 'You can only delete questions you added yourself' });
    run('DELETE FROM cbt_questions WHERE id = ?', id);
    return sendJson(res, 200, { ok: true });
  }

  const reportMatch = url.pathname.match(/^\/api\/admin\/reports\/(\d+)\/pdf$/);
  if (req.method === 'GET' && reportMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const publication = one('SELECT * FROM report_publications WHERE id = ?', Number(reportMatch[1]));
    if (!publication) return sendJson(res, 404, { error: 'Published report not found' });
    const pdfPath = absoluteAssetPath(publication.pdf_path);
    if (!pdfPath || !fs.existsSync(pdfPath)) return sendJson(res, 404, { error: 'Report PDF file not found' });
    const data = fs.readFileSync(pdfPath);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${publication.student_id}-${publication.exam_type.replace(/[^a-z0-9]+/gi, '_')}.pdf"`,
      'Content-Length': data.length,
    });
    return res.end(data);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/signatures') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const dataUrl = cleanText(body.dataUrl);
    if (!dataUrl) return sendJson(res, 400, { error: 'Signature image is required' });
    const role = cleanText(body.role);
    const stored = saveDataUrl(dataUrl, role === 'head' ? 'head-signature' : 'teacher-signature');
    if (role === 'head') {
      setMeta('head_signature_path', stored);
      if (body.headName) setMeta('head_of_school_name', cleanText(body.headName));
    } else {
      const teacherId = cleanText(body.teacherId).toUpperCase();
      const teacher = one('SELECT id FROM users WHERE id = ? AND role = ?', teacherId, 'teacher');
      if (!teacher) return sendJson(res, 400, { error: 'Teacher account not found' });
      run('UPDATE users SET signature_path = ? WHERE id = ?', stored, teacherId);
    }
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  const studentAssetsMatch = url.pathname.match(/^\/api\/admin\/students\/([^/]+)\/assets$/);
  if (req.method === 'POST' && studentAssetsMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = decodeURIComponent(studentAssetsMatch[1]).trim().toUpperCase();
    const student = one('SELECT id FROM students WHERE id = ?', studentId);
    if (!student) return sendJson(res, 404, { error: 'Student not found' });
    const body = await readJson(req);

    let photoPath = null;
    try {
      if (body.photoDataUrl) photoPath = saveDataUrl(body.photoDataUrl, `student-${studentId}`);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'parentEmail')) {
      run('UPDATE students SET parent_email = ? WHERE id = ?', cleanText(body.parentEmail).toLowerCase(), studentId);
    }
    if (photoPath) {
      run('UPDATE students SET photo_path = ? WHERE id = ?', photoPath, studentId);
    }

    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  const studentUpdateMatch = url.pathname.match(/^\/api\/admin\/students\/([^/]+)$/);
  if (req.method === 'PUT' && studentUpdateMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = decodeURIComponent(studentUpdateMatch[1]).trim().toUpperCase();
    const existing = one('SELECT id FROM students WHERE id = ?', studentId);
    if (!existing) return sendJson(res, 404, { error: 'Student not found' });
    const body = await readJson(req);
    const name = cleanText(body.name);
    const password = cleanText(body.password);
    const gender = cleanText(body.gender).toUpperCase();
    const classCode = cleanText(body.classCode).toUpperCase();
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = cleanText(body.firstName) || firstNameFromName(name);
    const parentEmail = cleanText(body.parentEmail).toLowerCase();

    if (!name || !classCode) {
      return sendJson(res, 400, { error: 'Student name and class are required' });
    }
    if (!['F', 'M'].includes(gender)) {
      return sendJson(res, 400, { error: 'Student gender must be F or M' });
    }
    const cls = one('SELECT code FROM classes WHERE code = ?', classCode);
    if (!cls) return sendJson(res, 400, { error: 'Class does not exist' });

    const classArmId = body.classArmId ? Number(body.classArmId) : null;
    if (classArmId) {
      const arm = one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', classArmId, classCode);
      if (!arm) return sendJson(res, 400, { error: 'Selected class arm does not belong to this class' });
    }

    let avg;
    let att;
    let photoPath = null;
    try {
      avg = normalizePercent(body.avg, 0);
      att = normalizePercent(body.att, 100);
      photoPath = body.photoDataUrl ? saveDataUrl(body.photoDataUrl, `student-${studentId}`) : null;
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    db.exec('BEGIN');
    try {
      run(
        `UPDATE users
         SET name = ?, first_name = ?, initials = ?, grade = ?${password ? ', password = ?' : ''}
         WHERE id = ? AND role = 'student'`,
        ...(password
          ? [name, firstName, initials, `Class ${classCode}`, hashPassword(password), studentId]
          : [name, firstName, initials, `Class ${classCode}`, studentId])
      );
      run(
        `UPDATE students
         SET name = ?, initials = ?, gender = ?, avg = ?, att = ?, class_code = ?, parent_email = ?, class_arm_id = ?
             ${photoPath ? ', photo_path = ?' : ''}
         WHERE id = ?`,
        ...(photoPath
          ? [name, initials, gender, avg, att, classCode, parentEmail, classArmId, photoPath, studentId]
          : [name, initials, gender, avg, att, classCode, parentEmail, classArmId, studentId])
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'DELETE' && studentUpdateMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = decodeURIComponent(studentUpdateMatch[1]).trim().toUpperCase();
    const existing = one('SELECT id FROM students WHERE id = ?', studentId);
    if (!existing) return sendJson(res, 404, { error: 'Student not found' });

    db.exec('BEGIN');
    try {
      run('DELETE FROM result_entries WHERE student_id = ?', studentId);
      run('DELETE FROM report_publications WHERE student_id = ?', studentId);
      run('DELETE FROM student_skill_ratings WHERE student_id = ?', studentId);
      run('DELETE FROM sessions WHERE user_id = ?', studentId);
      run('DELETE FROM students WHERE id = ?', studentId);
      run("DELETE FROM users WHERE id = ? AND role = 'student'", studentId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/students') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const id = cleanText(body.id).toUpperCase() || makeStudentIdGenerator()();
    const name = cleanText(body.name);
    const password = DEFAULT_STUDENT_PASSWORD;
    const gender = cleanText(body.gender).toUpperCase() || 'F';
    const classCode = cleanText(body.classCode).toUpperCase();
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = cleanText(body.firstName) || firstNameFromName(name);
    const parentEmail = cleanText(body.parentEmail).toLowerCase();

    if (!name || !classCode) {
      return sendJson(res, 400, { error: 'Name and class are required' });
    }
    if (!['F', 'M'].includes(gender)) {
      return sendJson(res, 400, { error: 'Student gender must be F or M' });
    }
    const cls = one('SELECT code, label FROM classes WHERE code = ?', classCode);
    if (!cls) return sendJson(res, 400, { error: 'Class does not exist' });

    const classArmId = body.classArmId ? Number(body.classArmId) : null;
    if (!classArmId && classHasArms(classCode)) return sendJson(res, 400, { error: 'Class arm is required' });
    if (classArmId) {
      const arm = one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', classArmId, classCode);
      if (!arm) return sendJson(res, 400, { error: 'Selected class arm does not belong to this class' });
    }

    let avg;
    let att;
    let photoPath = null;
    try {
      avg = normalizePercent(body.avg, 0);
      att = normalizePercent(body.att, 100);
      photoPath = body.photoDataUrl ? saveDataUrl(body.photoDataUrl, `student-${id}`) : null;
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    db.exec('BEGIN');
    try {
      run(
        `INSERT INTO users (id, role, password, name, first_name, initials, grade)
         VALUES (?, 'student', ?, ?, ?, ?, ?)`,
        id,
        hashPassword(password),
        name,
        firstName,
        initials,
        `Class ${classCode}`
      );
      run(
        'INSERT INTO students (id, name, initials, gender, avg, att, class_code, parent_email, photo_path, class_arm_id, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        name,
        initials,
        gender,
        avg,
        att,
        classCode,
        parentEmail,
        photoPath,
        classArmId,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A student or user with that ID already exists' });
      }
      throw err;
    }

    return sendJson(res, 201, {
      ok: true,
      setup: adminSetupPayload(),
    });
  }

  // ── STUDENT BULK IMPORT (.xlsx) ──────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/admin/students/import/preview') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const match = cleanText(body.fileDataUrl).match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return sendJson(res, 400, { error: 'Upload an .xlsx file' });

    let headers, rows;
    try {
      const buffer = Buffer.from(match[1], 'base64');
      ({ headers, rows } = parseXlsxFirstSheet(buffer));
    } catch (err) {
      return sendJson(res, 400, { error: `Could not read this file: ${err.message}` });
    }
    if (!headers.length) return sendJson(res, 400, { error: 'No header row found in this spreadsheet' });

    const col = name => headers.indexOf(name);
    const idxSurname = col('Surname');
    const idxFirst = col('First Name');
    const idxOther = col('Other Names');
    const idxGender = col('Gender');
    const idxParentEmail = col('Parent 1 Email');
    const idxEnrollment = col('Enrollment Status');
    const idxClassArmCombined = col('Class & Class Arm');
    const idxClassOnly = col('Class');
    const idxArmOnly = col('Class Arm');

    const classes = all('SELECT code, label FROM classes ORDER BY label');
    const arms = all('SELECT id, class_code AS classCode, name FROM class_arms');
    // Collapses spacing/punctuation differences so "K.G", "PRE- SCHOOL 1" and
    // "Pre-School 1" all normalize the same way before comparison.
    const squash = s => cleanText(s).toUpperCase().replace(/[.\-\s]+/g, '');
    const classAliases = {
      KG: 'KG', KINDERGARTEN: 'KG',
      RECEPT: 'RC', RECEPTION: 'RC',
      PRESCHOOL1: 'PS1', PRESCHOOL2: 'PS2',
      CRECHE: 'CR',
    };
    const findClass = (rawClassText, armText) => {
      let t = cleanText(rawClassText);
      // A combined "Class & Class Arm" field often bakes the arm name into
      // the class text itself (e.g. "K.G DOVE" for class "K.G", arm "Dove")
      // — strip a trailing arm name before matching the class.
      if (armText && t.toUpperCase().endsWith(armText.toUpperCase())) {
        t = t.slice(0, t.length - armText.length).trim();
      }
      const key = squash(t);
      if (!key) return null;
      const byLabelOrCode = classes.find(c => squash(c.label) === key || squash(c.code) === key);
      if (byLabelOrCode) return byLabelOrCode;
      const aliasCode = classAliases[key];
      return aliasCode ? classes.find(c => c.code === aliasCode) || null : null;
    };
    const normalizeGender = raw => {
      const g = cleanText(raw).toUpperCase();
      if (g === 'M' || g === 'F') return g;
      if (g.startsWith('MALE')) return 'M';
      if (g.startsWith('FEMALE')) return 'F';
      return '';
    };

    const preview = rows.map((row, i) => {
      const surname = idxSurname >= 0 ? cleanText(row[idxSurname]) : '';
      const firstName = idxFirst >= 0 ? cleanText(row[idxFirst]) : '';
      const otherNames = idxOther >= 0 ? cleanText(row[idxOther]) : '';
      const gender = idxGender >= 0 ? normalizeGender(row[idxGender]) : '';
      const parentEmail = idxParentEmail >= 0 ? cleanText(row[idxParentEmail]).toLowerCase() : '';
      const enrollmentStatus = idxEnrollment >= 0 ? cleanText(row[idxEnrollment]) : '';

      let rawClass = '';
      let rawArm = idxArmOnly >= 0 ? cleanText(row[idxArmOnly]) : '';
      const combined = idxClassArmCombined >= 0 ? cleanText(row[idxClassArmCombined]) : '';
      if (combined.includes(' - ')) {
        const parts = combined.split(' - ');
        const armFromCombined = parts.pop().trim();
        rawClass = parts.join(' - ').trim();
        if (!rawArm) rawArm = armFromCombined;
      } else {
        rawClass = idxClassOnly >= 0 ? cleanText(row[idxClassOnly]) : '';
      }

      const matchedClass = findClass(rawClass, rawArm);
      const classArms = matchedClass ? arms.filter(a => a.classCode === matchedClass.code) : [];
      const armExists = !!classArms.find(a => a.name.toLowerCase() === rawArm.toLowerCase());
      const armRequired = classArms.length > 0;

      return {
        rowNumber: i + 1,
        firstName, surname, otherNames, gender, parentEmail, enrollmentStatus,
        rawClass,
        classCode: matchedClass ? matchedClass.code : '',
        classLabel: matchedClass ? matchedClass.label : '',
        armName: rawArm,
        armWillCreate: !!(matchedClass && rawArm && !armExists),
        ready: !!(firstName && surname && matchedClass && (rawArm || !armRequired)),
      };
    });

    return sendJson(res, 200, {
      totalRows: rows.length,
      preview,
      classes: classes.map(c => ({
        code: c.code,
        label: c.label,
        arms: arms.filter(a => a.classCode === c.code).map(a => a.name),
      })),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/students/import/commit') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return sendJson(res, 400, { error: 'No rows to import' });

    const nextId = makeStudentIdGenerator();
    const created = [];
    const failed = [];

    db.exec('BEGIN');
    try {
      for (const row of rows) {
        const firstName = cleanText(row.firstName);
        const surname = cleanText(row.surname);
        const otherNames = cleanText(row.otherNames);
        const classCode = cleanText(row.classCode).toUpperCase();
        const armName = cleanText(row.armName);
        const genderRaw = cleanText(row.gender).toUpperCase();
        const gender = ['F', 'M'].includes(genderRaw) ? genderRaw : 'F';
        const parentEmail = cleanText(row.parentEmail).toLowerCase();

        if (!firstName || !surname || !classCode) {
          failed.push({ rowNumber: row.rowNumber, error: 'Missing first name, surname, or class' });
          continue;
        }
        const cls = one('SELECT code FROM classes WHERE code = ?', classCode);
        if (!cls) {
          failed.push({ rowNumber: row.rowNumber, error: `Unknown class: ${classCode}` });
          continue;
        }
        if (!armName && classHasArms(classCode)) {
          failed.push({ rowNumber: row.rowNumber, error: 'Class arm is required for this class' });
          continue;
        }

        let armId = null;
        if (armName) {
          let arm = one('SELECT id FROM class_arms WHERE class_code = ? AND name = ? COLLATE NOCASE', classCode, armName);
          if (!arm) {
            const inserted = run('INSERT INTO class_arms (class_code, name) VALUES (?, ?)', classCode, armName);
            arm = { id: Number(inserted.lastInsertRowid) };
          }
          armId = arm.id;
        }

        const name = [firstName, otherNames, surname].filter(Boolean).join(' ');
        const initials = initialsFromName(name);
        const id = nextId();

        try {
          run(
            `INSERT INTO users (id, role, password, name, first_name, initials, grade) VALUES (?, 'student', ?, ?, ?, ?, ?)`,
            id, hashPassword(DEFAULT_STUDENT_PASSWORD), name, firstName, initials, `Class ${classCode}`
          );
          run(
            'INSERT INTO students (id, name, initials, gender, avg, att, class_code, parent_email, class_arm_id, enrolled_at) VALUES (?, ?, ?, ?, 0, 100, ?, ?, ?, ?)',
            id, name, initials, gender, classCode, parentEmail || null, armId, new Date().toISOString()
          );
          created.push({ rowNumber: row.rowNumber, id, name });
        } catch (err) {
          failed.push({ rowNumber: row.rowNumber, error: err.message });
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return sendJson(res, 200, { ok: true, created, failed, setup: adminSetupPayload() });
  }

  // ── STUDENT TAGS ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/student-tags') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(`
      SELECT t.id, t.name, t.color, t.created_at AS createdAt,
             (SELECT COUNT(*) FROM student_tag_assignments a WHERE a.tag_id = t.id) AS studentCount
      FROM student_tags t
      ORDER BY t.name
    `);
    return sendJson(res, 200, { tags: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/student-tags') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    const color = cleanText(body.color) || null;
    if (!name) return sendJson(res, 400, { error: 'Tag name is required' });
    try {
      run('INSERT INTO student_tags (name, color, created_at) VALUES (?, ?, ?)', name, color, new Date().toISOString());
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A tag with that name already exists' });
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  const studentTagByIdMatch = url.pathname.match(/^\/api\/admin\/student-tags\/(\d+)$/);
  if (req.method === 'GET' && studentTagByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(studentTagByIdMatch[1]);
    const tag = one('SELECT id, name, color FROM student_tags WHERE id = ?', id);
    if (!tag) return sendJson(res, 404, { error: 'Tag not found' });
    const students = all(`
      SELECT st.id, st.name, st.class_code AS classCode, c.label AS classLabel
      FROM student_tag_assignments a
      JOIN students st ON st.id = a.student_id
      LEFT JOIN classes c ON c.code = st.class_code
      WHERE a.tag_id = ?
      ORDER BY st.name
    `, id);
    return sendJson(res, 200, { tag: { ...tag, students } });
  }
  if (req.method === 'DELETE' && studentTagByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM student_tags WHERE id = ?', Number(studentTagByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const studentTagAssignMatch = url.pathname.match(/^\/api\/admin\/student-tags\/(\d+)\/students$/);
  if (req.method === 'POST' && studentTagAssignMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const tagId = Number(studentTagAssignMatch[1]);
    const body = await readJson(req);
    const studentId = cleanText(body.studentId).toUpperCase();
    if (!studentId) return sendJson(res, 400, { error: 'Student is required' });
    if (!one('SELECT id FROM student_tags WHERE id = ?', tagId)) return sendJson(res, 404, { error: 'Tag not found' });
    if (!one('SELECT id FROM students WHERE id = ?', studentId)) return sendJson(res, 400, { error: 'Student does not exist' });
    run(
      `INSERT INTO student_tag_assignments (tag_id, student_id, assigned_at) VALUES (?, ?, ?)
       ON CONFLICT(tag_id, student_id) DO NOTHING`,
      tagId, studentId, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const studentTagUnassignMatch = url.pathname.match(/^\/api\/admin\/student-tags\/(\d+)\/students\/([^/]+)$/);
  if (req.method === 'DELETE' && studentTagUnassignMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const tagId = Number(studentTagUnassignMatch[1]);
    const studentId = decodeURIComponent(studentTagUnassignMatch[2]).toUpperCase();
    run('DELETE FROM student_tag_assignments WHERE tag_id = ? AND student_id = ?', tagId, studentId);
    return sendJson(res, 200, { ok: true });
  }

  // ── CLASS ALLOCATION / TRANSFER / GRADUATION ────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/students/by-class') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const status = cleanText(url.searchParams.get('status')) || 'active';
    if (!classCode) return sendJson(res, 400, { error: 'Class is required' });
    const rows = all(
      'SELECT id, name, initials, class_code AS classCode, status FROM students WHERE class_code = ? AND status = ? ORDER BY name',
      classCode, status
    );
    return sendJson(res, 200, { students: rows });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/students/by-status') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const status = cleanText(url.searchParams.get('status')) || 'graduated';
    const rows = all(`
      SELECT st.id, st.name, st.initials, st.class_code AS classCode, c.label AS classLabel, st.status
      FROM students st
      LEFT JOIN classes c ON c.code = st.class_code
      WHERE st.status = ?
      ORDER BY st.name
    `, status);
    return sendJson(res, 200, { students: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/students/promote') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const toClassCode = cleanText(body.toClassCode).toUpperCase();
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(id => cleanText(id).toUpperCase()).filter(Boolean) : [];
    if (!toClassCode || !studentIds.length) {
      return sendJson(res, 400, { error: 'Destination class and at least one student are required' });
    }
    if (!one('SELECT code FROM classes WHERE code = ?', toClassCode)) {
      return sendJson(res, 400, { error: 'Destination class does not exist' });
    }
    const placeholders = studentIds.map(() => '?').join(',');
    run(`UPDATE students SET class_code = ? WHERE id IN (${placeholders}) AND status = 'active'`, toClassCode, ...studentIds);
    run(`UPDATE users SET grade = ? WHERE id IN (${placeholders}) AND role = 'student'`, `Class ${toClassCode}`, ...studentIds);
    return sendJson(res, 200, { ok: true, moved: studentIds.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/students/graduate') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(id => cleanText(id).toUpperCase()).filter(Boolean) : [];
    const status = cleanText(body.status) === 'left' ? 'left' : 'graduated';
    if (!studentIds.length) return sendJson(res, 400, { error: 'Select at least one student' });
    const placeholders = studentIds.map(() => '?').join(',');
    run(`UPDATE students SET status = ? WHERE id IN (${placeholders})`, status, ...studentIds);
    run(`UPDATE users SET active = 0 WHERE id IN (${placeholders}) AND role = 'student'`, ...studentIds);
    return sendJson(res, 200, { ok: true, updated: studentIds.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/students/reinstate') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(id => cleanText(id).toUpperCase()).filter(Boolean) : [];
    const classCode = cleanText(body.classCode).toUpperCase();
    if (!studentIds.length || !classCode) return sendJson(res, 400, { error: 'Class and at least one student are required' });
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }
    const placeholders = studentIds.map(() => '?').join(',');
    run(`UPDATE students SET status = 'active', class_code = ? WHERE id IN (${placeholders})`, classCode, ...studentIds);
    run(`UPDATE users SET active = 1, grade = ? WHERE id IN (${placeholders}) AND role = 'student'`, `Class ${classCode}`, ...studentIds);
    return sendJson(res, 200, { ok: true, reinstated: studentIds.length });
  }

  // ── ENROLLMENT HISTORY / STUDENTS REGISTRY ──────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/students/enrollment-history') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const clauses = [];
    const params = [];
    if (classCode) { clauses.push('st.class_code = ?'); params.push(classCode); }
    const rows = all(`
      SELECT st.id, st.name, st.gender, st.class_code AS classCode, c.label AS classLabel,
             st.status, st.enrolled_at AS enrolledAt
      FROM students st
      LEFT JOIN classes c ON c.code = st.class_code
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY st.enrolled_at IS NULL, st.enrolled_at DESC
    `, ...params);
    return sendJson(res, 200, { students: rows });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/students/registry') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const status = cleanText(url.searchParams.get('status')) || 'active';
    const clauses = ['st.status = ?'];
    const params = [status];
    if (classCode) { clauses.push('st.class_code = ?'); params.push(classCode); }
    const rows = all(`
      SELECT st.id AS regNo, st.name, st.gender, st.class_code AS classCode, c.label AS classLabel,
             st.parent_email AS parentEmail, st.status, st.enrolled_at AS enrolledAt
      FROM students st
      LEFT JOIN classes c ON c.code = st.class_code
      WHERE ${clauses.join(' AND ')}
      ORDER BY c.code, st.name
    `, ...params);
    return sendJson(res, 200, { students: rows });
  }

  // ── COMMUNICATION BOOK ───────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/communication-book') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const clauses = [];
    const params = [];
    if (studentId) { clauses.push('cb.student_id = ?'); params.push(studentId); }
    if (classCode) { clauses.push('st.class_code = ?'); params.push(classCode); }
    const rows = all(`
      SELECT cb.id, cb.student_id AS studentId, st.name AS studentName, st.class_code AS classCode, c.label AS classLabel,
             cb.category, cb.message, cb.created_at AS createdAt, u.name AS addedBy
      FROM communication_book cb
      JOIN students st ON st.id = cb.student_id
      LEFT JOIN classes c ON c.code = st.class_code
      LEFT JOIN users u ON u.id = cb.created_by
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY cb.created_at DESC
    `, ...params);
    return sendJson(res, 200, { entries: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/communication-book') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const studentId = cleanText(body.studentId).toUpperCase();
    const category = cleanText(body.category) || null;
    const message = cleanText(body.message);
    if (!studentId || !message) return sendJson(res, 400, { error: 'Student and message are required' });
    if (!one('SELECT id FROM students WHERE id = ?', studentId)) {
      return sendJson(res, 400, { error: 'Student does not exist' });
    }
    run(
      'INSERT INTO communication_book (student_id, category, message, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      studentId, category, message, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const commBookByIdMatch = url.pathname.match(/^\/api\/admin\/communication-book\/(\d+)$/);
  if (req.method === 'DELETE' && commBookByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM communication_book WHERE id = ?', Number(commBookByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ── EXTRACURRICULAR GROUPS ───────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/extracurricular-groups') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(`
      SELECT g.id, g.name, g.description, g.teacher_in_charge_id AS teacherInChargeId, u.name AS teacherInChargeName,
             g.created_at AS createdAt,
             (SELECT COUNT(*) FROM extracurricular_members m WHERE m.group_id = g.id) AS memberCount
      FROM extracurricular_groups g
      LEFT JOIN users u ON u.id = g.teacher_in_charge_id
      ORDER BY g.name
    `);
    return sendJson(res, 200, { groups: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/extracurricular-groups') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    const description = cleanText(body.description) || null;
    const teacherInChargeId = cleanText(body.teacherInChargeId) || null;
    if (!name) return sendJson(res, 400, { error: 'Group name is required' });
    try {
      run(
        'INSERT INTO extracurricular_groups (name, description, teacher_in_charge_id, created_at) VALUES (?, ?, ?, ?)',
        name, description, teacherInChargeId, new Date().toISOString()
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A group with that name already exists' });
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  const ecgByIdMatch = url.pathname.match(/^\/api\/admin\/extracurricular-groups\/(\d+)$/);
  if (req.method === 'GET' && ecgByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(ecgByIdMatch[1]);
    const group = one('SELECT id, name, description, teacher_in_charge_id AS teacherInChargeId FROM extracurricular_groups WHERE id = ?', id);
    if (!group) return sendJson(res, 404, { error: 'Group not found' });
    const members = all(`
      SELECT st.id, st.name, st.class_code AS classCode, c.label AS classLabel
      FROM extracurricular_members m
      JOIN students st ON st.id = m.student_id
      LEFT JOIN classes c ON c.code = st.class_code
      WHERE m.group_id = ?
      ORDER BY st.name
    `, id);
    return sendJson(res, 200, { group: { ...group, members } });
  }
  if (req.method === 'DELETE' && ecgByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM extracurricular_groups WHERE id = ?', Number(ecgByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const ecgMembersMatch = url.pathname.match(/^\/api\/admin\/extracurricular-groups\/(\d+)\/members$/);
  if (req.method === 'POST' && ecgMembersMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const groupId = Number(ecgMembersMatch[1]);
    const body = await readJson(req);
    const studentId = cleanText(body.studentId).toUpperCase();
    if (!studentId) return sendJson(res, 400, { error: 'Student is required' });
    if (!one('SELECT id FROM extracurricular_groups WHERE id = ?', groupId)) return sendJson(res, 404, { error: 'Group not found' });
    if (!one('SELECT id FROM students WHERE id = ?', studentId)) return sendJson(res, 400, { error: 'Student does not exist' });
    run(
      `INSERT INTO extracurricular_members (group_id, student_id, joined_at) VALUES (?, ?, ?)
       ON CONFLICT(group_id, student_id) DO NOTHING`,
      groupId, studentId, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const ecgMemberUnassignMatch = url.pathname.match(/^\/api\/admin\/extracurricular-groups\/(\d+)\/members\/([^/]+)$/);
  if (req.method === 'DELETE' && ecgMemberUnassignMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const groupId = Number(ecgMemberUnassignMatch[1]);
    const studentId = decodeURIComponent(ecgMemberUnassignMatch[2]).toUpperCase();
    run('DELETE FROM extracurricular_members WHERE group_id = ? AND student_id = ?', groupId, studentId);
    return sendJson(res, 200, { ok: true });
  }

  // ── ADMISSION APPLICATIONS ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/admissions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(`
      SELECT aa.id, aa.applicant_name AS applicantName, aa.gender, aa.class_code AS classCode, c.label AS classLabel,
             aa.parent_name AS parentName, aa.parent_phone AS parentPhone, aa.parent_email AS parentEmail,
             aa.status, aa.notes, aa.submitted_at AS submittedAt,
             aa.reviewed_by AS reviewedBy, aa.reviewed_at AS reviewedAt, aa.converted_student_id AS convertedStudentId
      FROM admission_applications aa
      LEFT JOIN classes c ON c.code = aa.class_code
      ORDER BY aa.submitted_at DESC
    `);
    const summary = rows.reduce((acc, r) => {
      acc.total += 1;
      acc[r.status] = (acc[r.status] || 0) + 1;
      if (r.convertedStudentId) acc.converted += 1;
      return acc;
    }, { total: 0, pending: 0, approved: 0, rejected: 0, converted: 0 });
    return sendJson(res, 200, { applications: rows, summary });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/admissions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const applicantName = cleanText(body.applicantName);
    const gender = cleanText(body.gender).toUpperCase();
    const classCode = cleanText(body.classCode).toUpperCase();
    const parentName = cleanText(body.parentName);
    const parentPhone = cleanText(body.parentPhone);
    const parentEmail = cleanText(body.parentEmail).toLowerCase();
    const notes = cleanText(body.notes);

    if (!applicantName) return sendJson(res, 400, { error: 'Applicant name is required' });
    if (gender && !['F', 'M'].includes(gender)) return sendJson(res, 400, { error: 'Gender must be F or M' });
    if (classCode && !one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }

    const inserted = run(
      `INSERT INTO admission_applications (applicant_name, gender, class_code, parent_name, parent_phone, parent_email, status, notes, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      applicantName, gender || null, classCode || null, parentName || null, parentPhone || null,
      parentEmail || null, notes || null, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true, id: inserted.lastInsertRowid });
  }

  const admissionMatch = url.pathname.match(/^\/api\/admin\/admissions\/(\d+)$/);
  if (req.method === 'PUT' && admissionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const appId = Number(admissionMatch[1]);
    const application = one('SELECT id FROM admission_applications WHERE id = ?', appId);
    if (!application) return sendJson(res, 404, { error: 'Application not found' });
    const body = await readJson(req);
    const status = cleanText(body.status).toLowerCase();
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return sendJson(res, 400, { error: 'Status must be pending, approved, or rejected' });
    }
    const notes = cleanText(body.notes);
    run(
      'UPDATE admission_applications SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
      status, notes || null, user.id, new Date().toISOString(), appId
    );
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && admissionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM admission_applications WHERE id = ?', Number(admissionMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const admissionConvertMatch = url.pathname.match(/^\/api\/admin\/admissions\/(\d+)\/convert$/);
  if (req.method === 'POST' && admissionConvertMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const appId = Number(admissionConvertMatch[1]);
    const application = one('SELECT * FROM admission_applications WHERE id = ?', appId);
    if (!application) return sendJson(res, 404, { error: 'Application not found' });
    if (application.converted_student_id) return sendJson(res, 409, { error: 'Application already converted to a student' });

    const body = await readJson(req);
    const id = cleanText(body.id).toUpperCase();
    const gender = cleanText(body.gender || application.gender).toUpperCase();
    const classCode = cleanText(body.classCode || application.class_code).toUpperCase();
    const name = application.applicant_name;
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = firstNameFromName(name);
    const parentEmail = cleanText(body.parentEmail || application.parent_email).toLowerCase();

    if (!id) return sendJson(res, 400, { error: 'Student ID is required' });
    if (!['F', 'M'].includes(gender)) return sendJson(res, 400, { error: 'Applicant gender must be F or M before converting' });
    if (!classCode || !one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'A valid class is required before converting' });
    }

    db.exec('BEGIN');
    try {
      run(
        `INSERT INTO users (id, role, password, name, first_name, initials, grade) VALUES (?, 'student', ?, ?, ?, ?, ?)`,
        id, hashPassword(DEFAULT_STUDENT_PASSWORD), name, firstName, initials, `Class ${classCode}`
      );
      run(
        `INSERT INTO students (id, name, initials, gender, avg, att, class_code, parent_email) VALUES (?, ?, ?, ?, 0, 100, ?, ?)`,
        id, name, initials, gender, classCode, parentEmail || null
      );
      run(
        `UPDATE admission_applications SET status = 'approved', converted_student_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
        id, user.id, new Date().toISOString(), appId
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A student or user with that ID already exists' });
      }
      throw err;
    }
    return sendJson(res, 200, { ok: true, studentId: id, setup: adminSetupPayload() });
  }

  // ── GRADING SYSTEM ───────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/grade-scale') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, { gradeScale });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/grade-scale') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const rows = Array.isArray(body.gradeScale) ? body.gradeScale : [];
    if (!rows.length) return sendJson(res, 400, { error: 'At least one grade band is required' });
    const cleaned = [];
    for (const row of rows) {
      const grade = cleanText(row.grade);
      const min = Number(row.min);
      const max = Number(row.max);
      const remark = cleanText(row.remark);
      const gradePoint = Number(row.gradePoint);
      if (!grade || !Number.isFinite(min) || !Number.isFinite(max)) {
        return sendJson(res, 400, { error: 'Each grade band needs a grade, min score, and max score' });
      }
      cleaned.push({ grade, min, max, remark, gradePoint: Number.isFinite(gradePoint) ? gradePoint : 0 });
    }
    cleaned.sort((a, b) => b.min - a.min);
    gradeScale = cleaned;
    setMeta('grade_scale', JSON.stringify(cleaned));
    return sendJson(res, 200, { ok: true, gradeScale });
  }

  // ── COMMENTS BANK (grade-range fallback comments) ──────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/comment-bank') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, {
      comments: all('SELECT id, min_score AS min, max_score AS max, comment AS text FROM comment_bank ORDER BY min_score DESC'),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/comment-bank') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const min = Number(body.min);
    const max = Number(body.max);
    const text = cleanText(body.text);
    if (!text || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return sendJson(res, 400, { error: 'Valid comment text and score range are required' });
    }
    const inserted = run('INSERT INTO comment_bank (min_score, max_score, comment) VALUES (?, ?, ?)', min, max, text);
    return sendJson(res, 201, { ok: true, id: Number(inserted.lastInsertRowid) });
  }

  const commentBankIdMatch = url.pathname.match(/^\/api\/admin\/comment-bank\/(\d+)$/);
  if (req.method === 'PUT' && commentBankIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(commentBankIdMatch[1]);
    const body = await readJson(req);
    const min = Number(body.min);
    const max = Number(body.max);
    const text = cleanText(body.text);
    if (!text || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return sendJson(res, 400, { error: 'Valid comment text and score range are required' });
    }
    run('UPDATE comment_bank SET min_score = ?, max_score = ?, comment = ? WHERE id = ?', min, max, text, id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && commentBankIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM comment_bank WHERE id = ?', Number(commentBankIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ── HEAD OF SCHOOL COMMENT (per student, per exam) ──────────────────────
  if (req.method === 'PUT' && url.pathname === '/api/admin/report-comments') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const studentId = cleanText(body.studentId).toUpperCase();
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType);
    const comment = cleanText(body.comment);
    if (!studentId || !classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Student, class, and exam type are required' });
    }
    const student = one('SELECT id FROM students WHERE id = ? AND class_code = ?', studentId, classCode);
    if (!student) return sendJson(res, 400, { error: 'Student not found in this class' });
    const academic = activeAcademic();
    const updatedAt = new Date().toISOString();
    run(
      `INSERT INTO report_comments (academic_id, student_id, class_code, exam_type, head_comment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(academic_id, student_id, class_code, exam_type) DO UPDATE SET
         head_comment = excluded.head_comment, updated_at = excluded.updated_at`,
      academic.id, studentId, classCode, examType, comment || null, updatedAt
    );
    return sendJson(res, 200, { ok: true, comment, updatedAt: formatSavedAt(updatedAt) });
  }

  // ── FINANCE CATEGORIES (Expense Heads / Income Heads) ──────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/finance/categories') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const type = cleanText(url.searchParams.get('type'));
    if (!['expense', 'income'].includes(type)) return sendJson(res, 400, { error: 'Type must be expense or income' });
    const categories = all('SELECT id, name FROM finance_categories WHERE type = ? ORDER BY name', type);
    return sendJson(res, 200, { categories });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/finance/categories') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const type = cleanText(body.type);
    const name = cleanText(body.name);
    if (!['expense', 'income'].includes(type)) return sendJson(res, 400, { error: 'Type must be expense or income' });
    if (!name) return sendJson(res, 400, { error: 'Name is required' });
    try {
      const inserted = run('INSERT INTO finance_categories (type, name, created_at) VALUES (?, ?, ?)', type, name, new Date().toISOString());
      return sendJson(res, 201, { ok: true, id: inserted.lastInsertRowid });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'This category already exists' });
      throw err;
    }
  }

  const financeCategoryMatch = url.pathname.match(/^\/api\/admin\/finance\/categories\/(\d+)$/);
  if (req.method === 'DELETE' && financeCategoryMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM finance_categories WHERE id = ?', Number(financeCategoryMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ── SKILL LABELS (Affective / Psychomotor display name + description) ──
  if (req.method === 'GET' && url.pathname === '/api/admin/skill-labels') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const stored = valueFromMeta('skill_labels', '');
    let overrides = {};
    if (stored) { try { overrides = JSON.parse(stored); } catch (err) {} }
    const build = list => list.map(([key, , defaultLabel]) => ({
      key,
      label: overrides[key]?.label || defaultLabel,
      description: overrides[key]?.description || '',
    }));
    return sendJson(res, 200, { affective: build(AFFECTIVE_SKILLS), psychomotor: build(PSYCHOMOTOR_SKILLS) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/skill-labels') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const rows = Array.isArray(body.skills) ? body.skills : [];
    const validKeys = new Set(SKILL_COLUMNS.map(([key]) => key));
    const stored = valueFromMeta('skill_labels', '');
    let overrides = {};
    if (stored) { try { overrides = JSON.parse(stored); } catch (err) {} }
    rows.forEach(r => {
      const key = cleanText(r.key);
      if (!validKeys.has(key)) return;
      overrides[key] = { label: cleanText(r.label), description: cleanText(r.description) };
    });
    setMeta('skill_labels', JSON.stringify(overrides));
    return sendJson(res, 200, { ok: true });
  }

  // ── SCORE DIVISIONS ──────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/score-divisions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const examType = cleanText(url.searchParams.get('examType'));
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    let rows = all(
      'SELECT id, name, max_mark AS maxMark, enabled, sort_order AS sortOrder FROM score_divisions WHERE class_code = ? AND exam_type = ? ORDER BY sort_order',
      classCode, examType
    );
    if (!rows.length) {
      // No custom breakdown saved yet — fall back to the real scoring split
      // used by results entry (maxScoreForExamType), so the display is
      // never inconsistent with what teachers actually enter.
      rows = examType === 'Final Exam'
        ? [
            { id: null, name: 'Continuous Assessment', maxMark: 30, enabled: 1, sortOrder: 0 },
            { id: null, name: 'Examination', maxMark: 70, enabled: 1, sortOrder: 1 },
          ]
        : [{ id: null, name: 'Mid-Term Score', maxMark: 40, enabled: 1, sortOrder: 0 }];
    }
    return sendJson(res, 200, { divisions: rows.map(r => ({ ...r, enabled: !!r.enabled })) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/score-divisions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const examType = cleanText(body.examType);
    const rows = Array.isArray(body.divisions) ? body.divisions : [];
    if (!classCode || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Class and exam type are required' });
    }
    if (!rows.length) return sendJson(res, 400, { error: 'At least one division is required' });
    db.exec('BEGIN');
    try {
      run('DELETE FROM score_divisions WHERE class_code = ? AND exam_type = ?', classCode, examType);
      const insert = db.prepare(
        'INSERT INTO score_divisions (class_code, exam_type, name, max_mark, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      );
      rows.forEach((r, i) => {
        const name = cleanText(r.name);
        const maxMark = Number(r.maxMark);
        if (!name || !Number.isFinite(maxMark)) return;
        insert.run(classCode, examType, name, maxMark, r.enabled ? 1 : 0, i);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  // ── EXAM TIMETABLE ──────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/exam-schedule') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(`
      SELECT es.id, es.title, es.class_code AS classCode, c.label AS classLabel,
             es.subject_id AS subjectId, s.name AS subjectName,
             es.exam_date AS examDate, es.start_time AS startTime, es.end_time AS endTime, es.venue
      FROM exam_schedule es
      JOIN classes c ON c.code = es.class_code
      LEFT JOIN subjects s ON s.id = es.subject_id
      ORDER BY es.exam_date, es.start_time
    `);
    return sendJson(res, 200, { schedule: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/exam-schedule') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    const classCode = cleanText(body.classCode).toUpperCase();
    const subjectId = body.subjectId ? Number(body.subjectId) : null;
    const examDate = cleanText(body.examDate);
    const startTime = cleanText(body.startTime);
    const endTime = cleanText(body.endTime);
    const venue = cleanText(body.venue);

    if (!title || !classCode || !examDate) {
      return sendJson(res, 400, { error: 'Exam title, class, and date are required' });
    }
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }
    run(
      `INSERT INTO exam_schedule (title, class_code, subject_id, exam_date, start_time, end_time, venue, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, classCode, subjectId, examDate, startTime || null, endTime || null, venue || null, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const examScheduleMatch = url.pathname.match(/^\/api\/admin\/exam-schedule\/(\d+)$/);
  if (req.method === 'DELETE' && examScheduleMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM exam_schedule WHERE id = ?', Number(examScheduleMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ── E-CLASS: CBT QUESTION BANK ──────────────────────────────────────
  const CBT_QUESTION_TYPES = ['Multiple Choice Question', 'Fill in the Gap / Subjective', 'Explanatory Answer / Theory'];

  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/questions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const subjectId = Number(url.searchParams.get('subjectId'));
    if (!classCode || !subjectId) return sendJson(res, 400, { error: 'Class and subject are required' });
    const rows = all(`
      SELECT q.id, q.question_text AS questionText, q.question_type AS questionType, q.marks,
             q.options, q.helper_hint AS helperHint, q.tags, q.answer_explanation AS answerExplanation,
             q.vetted, q.taken_before AS takenBefore, q.archived,
             q.created_at AS createdAt, u.name AS addedBy
      FROM cbt_questions q
      LEFT JOIN users u ON u.id = q.created_by
      WHERE q.class_code = ? AND q.subject_id = ?
      ORDER BY q.created_at DESC
    `, classCode, subjectId);
    const questions = rows.map(r => {
      let options = [];
      try { options = r.options ? JSON.parse(r.options) : []; } catch { options = []; }
      return { ...r, options, optionCount: options.length };
    });
    return sendJson(res, 200, { questions });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/questions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const subjectId = Number(body.subjectId);
    const questionType = cleanText(body.questionType) || 'Multiple Choice Question';
    const questionText = cleanText(body.questionText);
    const marks = Number(body.marks) || 1;
    const helperHint = cleanText(body.helperHint);
    const tags = cleanText(body.tags);
    const answerExplanation = cleanText(body.answerExplanation);
    const options = Array.isArray(body.options)
      ? body.options.map(o => ({ text: cleanText(o.text), correct: !!o.correct })).filter(o => o.text)
      : [];
    if (!classCode || !subjectId || !questionText) {
      return sendJson(res, 400, { error: 'Class, subject, and question text are required' });
    }
    if (!CBT_QUESTION_TYPES.includes(questionType)) {
      return sendJson(res, 400, { error: 'Invalid question type' });
    }
    if (questionType === 'Multiple Choice Question') {
      if (!options.length || options.length > 6) {
        return sendJson(res, 400, { error: 'Multiple choice questions need 1 to 6 options' });
      }
      if (!options.some(o => o.correct)) {
        return sendJson(res, 400, { error: 'Mark at least one option as the correct answer' });
      }
    }
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }
    if (!one('SELECT id FROM subjects WHERE id = ?', subjectId)) {
      return sendJson(res, 400, { error: 'Subject does not exist' });
    }
    run(
      `INSERT INTO cbt_questions (class_code, subject_id, question_type, question_text, marks, options, helper_hint, tags, answer_explanation, vetted, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      classCode, subjectId, questionType, questionText, marks,
      options.length ? JSON.stringify(options) : null,
      helperHint || null, tags || null, answerExplanation || null,
      user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const cbtQuestionByIdMatch = url.pathname.match(/^\/api\/admin\/cbt\/questions\/(\d+)$/);
  if (req.method === 'PUT' && cbtQuestionByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtQuestionByIdMatch[1]);
    if (!one('SELECT id FROM cbt_questions WHERE id = ?', id)) {
      return sendJson(res, 404, { error: 'Question not found' });
    }
    const body = await readJson(req);
    const questionType = cleanText(body.questionType) || 'Multiple Choice Question';
    const questionText = cleanText(body.questionText);
    const marks = Number(body.marks) || 1;
    const helperHint = cleanText(body.helperHint);
    const tags = cleanText(body.tags);
    const answerExplanation = cleanText(body.answerExplanation);
    const options = Array.isArray(body.options)
      ? body.options.map(o => ({ text: cleanText(o.text), correct: !!o.correct })).filter(o => o.text)
      : [];
    if (!questionText) return sendJson(res, 400, { error: 'Question text is required' });
    if (!CBT_QUESTION_TYPES.includes(questionType)) return sendJson(res, 400, { error: 'Invalid question type' });
    if (questionType === 'Multiple Choice Question' && (!options.length || !options.some(o => o.correct))) {
      return sendJson(res, 400, { error: 'Multiple choice questions need options with a correct answer marked' });
    }
    run(
      `UPDATE cbt_questions SET question_type = ?, question_text = ?, marks = ?, options = ?, helper_hint = ?, tags = ?, answer_explanation = ?
       WHERE id = ?`,
      questionType, questionText, marks, options.length ? JSON.stringify(options) : null,
      helperHint || null, tags || null, answerExplanation || null, id
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && cbtQuestionByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM cbt_questions WHERE id = ?', Number(cbtQuestionByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const cbtQuestionVetMatch = url.pathname.match(/^\/api\/admin\/cbt\/questions\/(\d+)\/vet$/);
  if (req.method === 'PUT' && cbtQuestionVetMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtQuestionVetMatch[1]);
    const existing = one('SELECT vetted FROM cbt_questions WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Question not found' });
    run('UPDATE cbt_questions SET vetted = ? WHERE id = ?', existing.vetted ? 0 : 1, id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/questions/bulk') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    const action = cleanText(body.action);
    if (!ids.length || !['archive', 'unarchive', 'delete'].includes(action)) {
      return sendJson(res, 400, { error: 'Select at least one question and a valid action' });
    }
    const placeholders = ids.map(() => '?').join(',');
    if (action === 'archive') run(`UPDATE cbt_questions SET archived = 1 WHERE id IN (${placeholders})`, ...ids);
    if (action === 'unarchive') run(`UPDATE cbt_questions SET archived = 0 WHERE id IN (${placeholders})`, ...ids);
    if (action === 'delete') run(`DELETE FROM cbt_questions WHERE id IN (${placeholders})`, ...ids);
    return sendJson(res, 200, { ok: true });
  }

  // ── E-CLASS: CBT INSTRUCTION SETS ───────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/instruction-sets') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(`
      SELECT ins.id, ins.title, ins.instructions, ins.class_code AS classCode, c.label AS classLabel,
             ins.subject_id AS subjectId, s.name AS subjectName, ins.created_at AS createdAt
      FROM cbt_instruction_sets ins
      LEFT JOIN classes c ON c.code = ins.class_code
      LEFT JOIN subjects s ON s.id = ins.subject_id
      ORDER BY ins.created_at DESC
    `);
    return sendJson(res, 200, { instructionSets: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/instruction-sets') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    const instructions = cleanText(body.instructions);
    const classCode = cleanText(body.classCode).toUpperCase() || null;
    const subjectId = body.subjectId ? Number(body.subjectId) : null;
    if (!title || !instructions) return sendJson(res, 400, { error: 'Title and instructions are required' });
    if (classCode && !one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }
    run(
      `INSERT INTO cbt_instruction_sets (title, class_code, subject_id, instructions, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      title, classCode, subjectId, instructions, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  const cbtInstructionMatch = url.pathname.match(/^\/api\/admin\/cbt\/instruction-sets\/(\d+)$/);
  if (req.method === 'DELETE' && cbtInstructionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM cbt_instruction_sets WHERE id = ?', Number(cbtInstructionMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ── E-CLASS: CBT SCHEDULES ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/schedules') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const sessionLabel = cleanText(url.searchParams.get('session'));
    const forExam = cleanText(url.searchParams.get('forExam'));
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
    const clauses = ['s.archived = ?'];
    const params = [archived];
    if (sessionLabel) { clauses.push('s.session_label = ?'); params.push(sessionLabel); }
    if (forExam) { clauses.push('s.for_exam = ?'); params.push(forExam); }
    if (classCode) {
      clauses.push('EXISTS (SELECT 1 FROM cbt_schedule_classes sc WHERE sc.schedule_id = s.id AND sc.class_code = ?)');
      params.push(classCode);
    }
    const rows = all(`
      SELECT s.id, s.title, s.session_label AS sessionLabel, s.term_label AS termLabel, s.for_exam AS forExam,
             s.archived,
             (SELECT COUNT(DISTINCT sc.class_code) FROM cbt_schedule_classes sc WHERE sc.schedule_id = s.id) AS classCount,
             COALESCE(
               (SELECT ss.mode FROM cbt_schedule_subjects ss WHERE ss.schedule_id = s.id GROUP BY ss.mode ORDER BY COUNT(*) DESC LIMIT 1),
               s.mode
             ) AS mode,
             (SELECT MIN(ss.exam_date) FROM cbt_schedule_subjects ss WHERE ss.schedule_id = s.id AND ss.exam_date IS NOT NULL) AS startDate
      FROM cbt_schedules s
      WHERE ${clauses.join(' AND ')}
      ORDER BY s.id DESC
    `, ...params);
    return sendJson(res, 200, { schedules: rows });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/schedules') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    const sessionLabel = cleanText(body.sessionLabel);
    const termLabel = cleanText(body.termLabel);
    const forExam = cleanText(body.forExam);
    const mode = cleanText(body.mode) || 'Computer Based';
    const startDate = cleanText(body.startDate);
    const classCodes = Array.isArray(body.classCodes)
      ? [...new Set(body.classCodes.map(c => cleanText(c).toUpperCase()).filter(Boolean))]
      : [];
    if (!title || !sessionLabel || !termLabel || !startDate || !classCodes.length) {
      return sendJson(res, 400, { error: 'Title, session, term, start date, and at least one class are required' });
    }
    for (const code of classCodes) {
      if (!one('SELECT code FROM classes WHERE code = ?', code)) {
        return sendJson(res, 400, { error: `Class ${code} does not exist` });
      }
    }
    db.exec('BEGIN');
    try {
      const result = run(
        `INSERT INTO cbt_schedules (title, session_label, term_label, for_exam, mode, start_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        title, sessionLabel, termLabel, forExam || null, mode, startDate, user.id, new Date().toISOString()
      );
      const scheduleId = result.lastInsertRowid;
      const insertClass = db.prepare('INSERT INTO cbt_schedule_classes (schedule_id, class_code) VALUES (?, ?)');
      classCodes.forEach(code => insertClass.run(scheduleId, code));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  const cbtScheduleByIdMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedules\/(\d+)$/);
  if (req.method === 'GET' && cbtScheduleByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtScheduleByIdMatch[1]);
    const schedule = one(`
      SELECT id, title, session_label AS sessionLabel, term_label AS termLabel, for_exam AS forExam,
             mode, start_date AS startDate, archived
      FROM cbt_schedules WHERE id = ?
    `, id);
    if (!schedule) return sendJson(res, 404, { error: 'Schedule not found' });
    const classes = all(`
      SELECT sc.class_code AS classCode, c.label AS classLabel
      FROM cbt_schedule_classes sc JOIN classes c ON c.code = sc.class_code
      WHERE sc.schedule_id = ? ORDER BY c.code
    `, id);
    return sendJson(res, 200, { schedule: { ...schedule, classes } });
  }
  if (req.method === 'DELETE' && cbtScheduleByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM cbt_schedules WHERE id = ?', Number(cbtScheduleByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const cbtScheduleArchiveMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedules\/(\d+)\/archive$/);
  if (req.method === 'PUT' && cbtScheduleArchiveMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtScheduleArchiveMatch[1]);
    const existing = one('SELECT archived FROM cbt_schedules WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Schedule not found' });
    run('UPDATE cbt_schedules SET archived = ? WHERE id = ?', existing.archived ? 0 : 1, id);
    return sendJson(res, 200, { ok: true });
  }

  // ── E-CLASS: CBT SCHEDULE SUBJECTS (per-class, per-subject exam entries) ──
  const cbtScheduleSubjectsMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedules\/(\d+)\/subjects$/);
  if (req.method === 'GET' && cbtScheduleSubjectsMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const scheduleId = Number(cbtScheduleSubjectsMatch[1]);
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const classArmId = url.searchParams.get('classArmId') ? Number(url.searchParams.get('classArmId')) : null;
    const mode = cleanText(url.searchParams.get('mode'));
    const clauses = ['ss.schedule_id = ?'];
    const params = [scheduleId];
    if (classCode) { clauses.push('ss.class_code = ?'); params.push(classCode); }
    if (classArmId) { clauses.push('ss.class_arm_id = ?'); params.push(classArmId); }
    if (mode && mode !== 'All') { clauses.push('ss.mode = ?'); params.push(mode); }
    const rows = all(`
      SELECT ss.id, ss.class_code AS classCode, c.label AS classLabel,
             ss.class_arm_id AS classArmId, ca.name AS classArmName,
             ss.subject_id AS subjectId, sub.name AS subjectName,
             ss.duration_minutes AS durationMinutes, ss.exam_date AS examDate, ss.exam_time AS examTime,
             ss.supervisor_id AS supervisorId, u.name AS supervisorName,
             ss.mode, ss.venue, ss.visible_to_students AS visibleToStudents, ss.status,
             sc.title AS scheduleTitle, sc.session_label AS sessionLabel, sc.term_label AS termLabel,
             (SELECT COUNT(*) FROM cbt_scores WHERE schedule_subject_id = ss.id) AS submissionCount,
             (SELECT COUNT(*) FROM students st WHERE st.class_code = ss.class_code) AS candidateCount,
             (SELECT COUNT(*) FROM cbt_questions q WHERE q.class_code = ss.class_code AND q.subject_id = ss.subject_id AND q.archived = 0) AS questionCount
      FROM cbt_schedule_subjects ss
      JOIN cbt_schedules sc ON sc.id = ss.schedule_id
      JOIN classes c ON c.code = ss.class_code
      LEFT JOIN class_arms ca ON ca.id = ss.class_arm_id
      JOIN subjects sub ON sub.id = ss.subject_id
      LEFT JOIN users u ON u.id = ss.supervisor_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY ss.id DESC
    `, ...params);
    return sendJson(res, 200, { subjects: rows });
  }

  if (req.method === 'POST' && cbtScheduleSubjectsMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const scheduleId = Number(cbtScheduleSubjectsMatch[1]);
    if (!one('SELECT id FROM cbt_schedules WHERE id = ?', scheduleId)) {
      return sendJson(res, 404, { error: 'Schedule not found' });
    }
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const classArmIds = Array.isArray(body.classArmIds) ? body.classArmIds.map(Number).filter(Number.isFinite) : [];
    const subjectIds = Array.isArray(body.subjectIds) ? body.subjectIds.map(Number).filter(Number.isFinite) : [];
    const durationMinutes = Number(body.durationMinutes);
    const examDate = cleanText(body.examDate) || null;
    const examTime = cleanText(body.examTime) || null;
    const supervisorId = cleanText(body.supervisorId) || null;
    const mode = cleanText(body.mode) || 'Computer Based';
    const venue = cleanText(body.venue) || null;
    const visibleToStudents = body.visibleToStudents === false || body.visibleToStudents === 'No' ? 0 : 1;
    if (!classCode || !subjectIds.length || !durationMinutes) {
      return sendJson(res, 400, { error: 'Class, subject(s), and duration are required' });
    }
    if (!['Computer Based', 'Paper Based', 'Others'].includes(mode)) {
      return sendJson(res, 400, { error: 'Invalid examination mode' });
    }
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) {
      return sendJson(res, 400, { error: 'Class does not exist' });
    }
    // A class with no arms configured schedules at the whole-class level (arm = null).
    const armTargets = classArmIds.length ? classArmIds : [null];
    db.exec('BEGIN');
    try {
      run('INSERT OR IGNORE INTO cbt_schedule_classes (schedule_id, class_code) VALUES (?, ?)', scheduleId, classCode);
      const insert = db.prepare(
        `INSERT INTO cbt_schedule_subjects
         (schedule_id, class_code, class_arm_id, subject_id, duration_minutes, exam_date, exam_time, supervisor_id, mode, venue, visible_to_students, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const now = new Date().toISOString();
      armTargets.forEach(armId => {
        subjectIds.forEach(subjectId => {
          insert.run(scheduleId, classCode, armId, subjectId, durationMinutes, examDate, examTime, supervisorId, mode, venue, visibleToStudents, user.id, now);
        });
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  }

  const cbtScheduleSubjectByIdMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedule-subjects\/(\d+)$/);
  if (req.method === 'PUT' && cbtScheduleSubjectByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtScheduleSubjectByIdMatch[1]);
    if (!one('SELECT id FROM cbt_schedule_subjects WHERE id = ?', id)) {
      return sendJson(res, 404, { error: 'Exam entry not found' });
    }
    const body = await readJson(req);
    const durationMinutes = Number(body.durationMinutes);
    const examDate = cleanText(body.examDate) || null;
    const examTime = cleanText(body.examTime) || null;
    const supervisorId = cleanText(body.supervisorId) || null;
    const mode = cleanText(body.mode) || 'Computer Based';
    const venue = cleanText(body.venue) || null;
    const visibleToStudents = body.visibleToStudents === false || body.visibleToStudents === 'No' ? 0 : 1;
    if (!durationMinutes) return sendJson(res, 400, { error: 'Duration is required' });
    if (!['Computer Based', 'Paper Based', 'Others'].includes(mode)) {
      return sendJson(res, 400, { error: 'Invalid examination mode' });
    }
    run(
      `UPDATE cbt_schedule_subjects SET duration_minutes = ?, exam_date = ?, exam_time = ?, supervisor_id = ?, mode = ?, venue = ?, visible_to_students = ?
       WHERE id = ?`,
      durationMinutes, examDate, examTime, supervisorId, mode, venue, visibleToStudents, id
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && cbtScheduleSubjectByIdMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM cbt_schedule_subjects WHERE id = ?', Number(cbtScheduleSubjectByIdMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const cbtScheduleSubjectStatusMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedule-subjects\/(\d+)\/status$/);
  if (req.method === 'PUT' && cbtScheduleSubjectStatusMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(cbtScheduleSubjectStatusMatch[1]);
    const body = await readJson(req);
    const status = cleanText(body.status);
    if (!['upcoming', 'live', 'closed'].includes(status)) {
      return sendJson(res, 400, { error: 'Invalid status' });
    }
    if (!one('SELECT id FROM cbt_schedule_subjects WHERE id = ?', id)) {
      return sendJson(res, 404, { error: 'Exam entry not found' });
    }
    run('UPDATE cbt_schedule_subjects SET status = ? WHERE id = ?', status, id);
    return sendJson(res, 200, { ok: true });
  }

  // ── E-CLASS: CBT SCORES ─────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/subject-options') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const classArmId = url.searchParams.get('classArmId') ? Number(url.searchParams.get('classArmId')) : null;
    const sessionLabel = cleanText(url.searchParams.get('session'));
    const termLabel = cleanText(url.searchParams.get('term'));
    if (!classCode) return sendJson(res, 400, { error: 'Class is required' });
    const clauses = ['ss.class_code = ?'];
    const params = [classCode];
    if (classArmId) { clauses.push('ss.class_arm_id = ?'); params.push(classArmId); }
    if (sessionLabel) { clauses.push('sc.session_label = ?'); params.push(sessionLabel); }
    if (termLabel) { clauses.push('sc.term_label = ?'); params.push(termLabel); }
    const rows = all(`
      SELECT ss.id, sub.name AS subjectName, sc.title AS scheduleTitle
      FROM cbt_schedule_subjects ss
      JOIN subjects sub ON sub.id = ss.subject_id
      JOIN cbt_schedules sc ON sc.id = ss.schedule_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY sub.name
    `, ...params);
    return sendJson(res, 200, { options: rows });
  }

  // Read-only grid (students x subjects) of actual CBT submissions for a
  // class within one CBT schedule — auto-filled, nothing typed in here.
  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/gradebook') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const scheduleId = Number(url.searchParams.get('scheduleId'));
    if (!classCode || !scheduleId) return sendJson(res, 400, { error: 'Class and CBT schedule are required' });
    const subjectRows = all(
      `SELECT DISTINCT css.id AS scheduleSubjectId, css.subject_id AS subjectId, s.name AS subjectName, css.status
       FROM cbt_schedule_subjects css
       JOIN subjects s ON s.id = css.subject_id
       WHERE css.schedule_id = ? AND css.class_code = ?
       ORDER BY s.name`,
      scheduleId, classCode
    );
    const students = all('SELECT id, name FROM students WHERE class_code = ? ORDER BY name', classCode);
    const scoreMatrix = {};
    for (const sub of subjectRows) {
      const rows = all(
        'SELECT student_id AS studentId, score, total_marks AS totalMarks FROM cbt_scores WHERE schedule_subject_id = ?',
        sub.scheduleSubjectId
      );
      rows.forEach(r => {
        if (!scoreMatrix[r.studentId]) scoreMatrix[r.studentId] = {};
        scoreMatrix[r.studentId][sub.subjectId] = { score: r.score, totalMarks: r.totalMarks };
      });
    }
    return sendJson(res, 200, { subjects: subjectRows, students, scoreMatrix });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/cbt/scores') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const scheduleSubjectId = Number(url.searchParams.get('scheduleSubjectId'));
    if (!scheduleSubjectId) return sendJson(res, 400, { error: 'A scheduled CBT subject is required' });
    const subjectRow = one('SELECT class_code AS classCode FROM cbt_schedule_subjects WHERE id = ?', scheduleSubjectId);
    if (!subjectRow) return sendJson(res, 404, { error: 'Scheduled CBT subject not found' });
    const rows = all(`
      SELECT st.id AS studentId, st.name, st.initials,
             sc.id AS scoreId, sc.score, sc.total_marks AS totalMarks,
             sc.questions_presented AS questionsPresented, sc.questions_attempted AS questionsAttempted,
             sc.recorded_at AS recordedAt,
             at.submitted_at AS submittedAt
      FROM students st
      LEFT JOIN cbt_scores sc ON sc.student_id = st.id AND sc.schedule_subject_id = ?
      LEFT JOIN cbt_attempts at ON at.student_id = st.id AND at.schedule_subject_id = ?
      WHERE st.class_code = ?
      ORDER BY st.name
    `, scheduleSubjectId, scheduleSubjectId, subjectRow.classCode);
    return sendJson(res, 200, { scores: rows });
  }

  // Admin override: a student's exam is normally locked forever after they
  // submit (one attempt per student per exam). This clears just that one
  // student's attempt for just this one exam so they can sit it again — for
  // a specific documented reason (tech issue, illness, etc.), not a general
  // retake policy.
  const cbtRetakeMatch = url.pathname.match(/^\/api\/admin\/cbt\/schedule-subjects\/(\d+)\/students\/([^/]+)\/retake$/);
  if (req.method === 'POST' && cbtRetakeMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const scheduleSubjectId = Number(cbtRetakeMatch[1]);
    const studentId = decodeURIComponent(cbtRetakeMatch[2]).toUpperCase();
    const attempt = one('SELECT id FROM cbt_attempts WHERE schedule_subject_id = ? AND student_id = ?', scheduleSubjectId, studentId);
    if (!attempt) return sendJson(res, 404, { error: 'This student has no attempt on this exam to reset' });
    run('DELETE FROM cbt_attempts WHERE id = ?', attempt.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/scores') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const scheduleSubjectId = Number(body.scheduleSubjectId);
    const studentId = cleanText(body.studentId).toUpperCase();
    const score = Number(body.score);
    const totalMarks = Number(body.totalMarks) || 100;
    const questionsPresented = body.questionsPresented ? Number(body.questionsPresented) : null;
    const questionsAttempted = body.questionsAttempted ? Number(body.questionsAttempted) : null;
    if (!scheduleSubjectId || !studentId || !Number.isFinite(score)) {
      return sendJson(res, 400, { error: 'Scheduled subject, student, and score are required' });
    }
    if (score < 0 || score > totalMarks) {
      return sendJson(res, 400, { error: `Score must be between 0 and ${totalMarks}` });
    }
    if (!one('SELECT id FROM cbt_schedule_subjects WHERE id = ?', scheduleSubjectId)) {
      return sendJson(res, 400, { error: 'Scheduled CBT subject does not exist' });
    }
    if (!one('SELECT id FROM students WHERE id = ?', studentId)) {
      return sendJson(res, 400, { error: 'Student does not exist' });
    }
    run(`
      INSERT INTO cbt_scores (schedule_subject_id, student_id, score, total_marks, questions_presented, questions_attempted, recorded_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(schedule_subject_id, student_id) DO UPDATE SET
        score = excluded.score, total_marks = excluded.total_marks,
        questions_presented = excluded.questions_presented, questions_attempted = excluded.questions_attempted,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
    `, scheduleSubjectId, studentId, score, totalMarks, questionsPresented, questionsAttempted, user.id, new Date().toISOString());
    return sendJson(res, 200, { ok: true });
  }

  const cbtScoreMatch = url.pathname.match(/^\/api\/admin\/cbt\/scores\/(\d+)$/);
  if (req.method === 'DELETE' && cbtScoreMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM cbt_scores WHERE id = ?', Number(cbtScoreMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // Upload CBT scores into the Results Grade Book, rescaled to a score division's max
  // mark. Only ever writes exam_score (never ca_score), so it can't silently clobber
  // a teacher's continuous-assessment entries.
  if (req.method === 'POST' && url.pathname === '/api/admin/cbt/scores/upload-to-gradebook') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const scheduleSubjectId = Number(body.scheduleSubjectId);
    const examType = cleanText(body.examType);
    const rescaleTotal = body.rescaleTotal ? Number(body.rescaleTotal) : null;
    if (!scheduleSubjectId || !validateExamType(examType)) {
      return sendJson(res, 400, { error: 'Scheduled CBT subject and exam type are required' });
    }
    const subjectRow = one(
      'SELECT class_code AS classCode, subject_id AS subjectId FROM cbt_schedule_subjects WHERE id = ?',
      scheduleSubjectId
    );
    if (!subjectRow) return sendJson(res, 404, { error: 'Scheduled CBT subject not found' });
    const assignment = one(
      'SELECT id, teacher_id AS teacherId FROM teacher_assignments WHERE class_code = ? AND subject_id = ? LIMIT 1',
      subjectRow.classCode, subjectRow.subjectId
    );
    if (!assignment) {
      return sendJson(res, 400, { error: 'No teacher is assigned to this class/subject yet — assign one in Result Settings first' });
    }
    const division = one(
      'SELECT name, max_mark AS maxMark FROM score_divisions WHERE class_code = ? AND exam_type = ? AND enabled = 1 ORDER BY sort_order LIMIT 1',
      subjectRow.classCode, examType
    );
    const targetMax = rescaleTotal || division?.maxMark || 100;
    const academic = activeAcademic();
    if (!academic) return sendJson(res, 400, { error: 'No active academic session/term is set' });

    const scores = all(
      'SELECT student_id AS studentId, score, total_marks AS totalMarks FROM cbt_scores WHERE schedule_subject_id = ?',
      scheduleSubjectId
    );
    if (!scores.length) return sendJson(res, 400, { error: 'No CBT scores recorded yet for this subject' });

    let batchId;
    db.exec('BEGIN');
    try {
      const existingBatch = one(
        'SELECT id FROM result_batches WHERE academic_id = ? AND assignment_id = ? AND exam_type = ?',
        academic.id, assignment.id, examType
      );
      if (existingBatch) {
        batchId = existingBatch.id;
      } else {
        const created = run(
          `INSERT INTO result_batches (academic_id, assignment_id, teacher_id, class_code, subject_id, exam_type, saved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          academic.id, assignment.id, assignment.teacherId, subjectRow.classCode, subjectRow.subjectId, examType, new Date().toISOString()
        );
        batchId = created.lastInsertRowid;
      }
      const upsert = db.prepare(`
        INSERT INTO result_entries (batch_id, student_id, ca_score, exam_score, total_score)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(batch_id, student_id) DO UPDATE SET
          exam_score = excluded.exam_score,
          total_score = ca_score + excluded.exam_score
      `);
      scores.forEach(s => {
        const rescaled = Math.round((s.score / s.totalMarks) * targetMax);
        upsert.run(batchId, s.studentId, rescaled, rescaled);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true, uploaded: scores.length, batchId });
  }

  const staffUpdateMatch = url.pathname.match(/^\/api\/admin\/staff\/([^/]+)$/);
  if (req.method === 'PUT' && staffUpdateMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const staffId = decodeURIComponent(staffUpdateMatch[1]).trim().toUpperCase();
    const existing = one('SELECT id, role FROM users WHERE id = ? AND role IN (?, ?)', staffId, 'teacher', 'admin');
    if (!existing) return sendJson(res, 404, { error: 'Staff account not found' });
    const body = await readJson(req);
    const name = cleanText(body.name);
    const password = cleanText(body.password);
    const role = cleanText(body.role);
    const teacherType = cleanText(body.teacherType);
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = cleanText(body.firstName) || firstNameFromName(name);

    if (!name || !role) {
      return sendJson(res, 400, { error: 'Staff name and role are required' });
    }
    if (!['teacher', 'admin'].includes(role)) {
      return sendJson(res, 400, { error: 'Staff role must be teacher or admin' });
    }
    if (staffId === user.id && role !== 'admin') {
      return sendJson(res, 400, { error: 'You cannot remove admin access from your own account' });
    }
    if (role === 'teacher' && !['class_teacher', 'subject_teacher'].includes(teacherType)) {
      return sendJson(res, 400, { error: 'Teacher type is required for teacher staff' });
    }
    const assignmentCount = one('SELECT COUNT(*) AS count FROM teacher_assignments WHERE teacher_id = ?', staffId).count;
    if (existing.role === 'teacher' && role === 'admin' && assignmentCount > 0) {
      return sendJson(res, 400, { error: 'Remove this teacher from result assignments before changing them to an admin' });
    }

    run(
      `UPDATE users
       SET role = ?, name = ?, first_name = ?, initials = ?, teacher_type = ?, chip = ?
           ${password ? ', password = ?' : ''}
       WHERE id = ?`,
      ...(password
        ? [role, name, firstName, initials, role === 'teacher' ? teacherType : null, role === 'teacher' ? name.toUpperCase() : null, hashPassword(password), staffId]
        : [role, name, firstName, initials, role === 'teacher' ? teacherType : null, role === 'teacher' ? name.toUpperCase() : null, staffId])
    );

    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/staff') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const id = cleanText(body.id).toUpperCase();
    const name = cleanText(body.name);
    const password = cleanText(body.password);
    const role = cleanText(body.role);
    const teacherType = cleanText(body.teacherType);
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = cleanText(body.firstName) || firstNameFromName(name);

    if (!id || !name || !password || !role) {
      return sendJson(res, 400, { error: 'Staff ID, name, role, and password are required' });
    }
    if (!['teacher', 'admin'].includes(role)) {
      return sendJson(res, 400, { error: 'Staff role must be teacher or admin' });
    }
    if (role === 'teacher' && !['class_teacher', 'subject_teacher'].includes(teacherType)) {
      return sendJson(res, 400, { error: 'Teacher type is required for teacher staff' });
    }

    try {
      run(
        `INSERT INTO users (id, role, password, name, first_name, initials, teacher_type, chip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        role,
        hashPassword(password),
        name,
        firstName,
        initials,
        role === 'teacher' ? teacherType : null,
        role === 'teacher' ? name.toUpperCase() : null
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A staff user with that ID already exists' });
      }
      throw err;
    }

    return sendJson(res, 201, {
      ok: true,
      setup: adminSetupPayload(),
    });
  }

  if ((req.method === 'POST' || req.method === 'PUT') && url.pathname === '/api/admin/teacher-assignments') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const teacherId = String(body.teacherId || '').trim().toUpperCase();
    const teacherType = String(body.teacherType || '');
    const classCode = String(body.classCode || '').trim().toUpperCase();
    const subjectId = Number(body.subjectId);
    if (!['class_teacher', 'subject_teacher'].includes(teacherType)) {
      return sendJson(res, 400, { error: 'Teacher type is required' });
    }
    const teacher = one('SELECT id FROM users WHERE id = ? AND role = ?', teacherId, 'teacher');
    const cls = one('SELECT code FROM classes WHERE code = ?', classCode);
    const subject = one('SELECT id FROM subjects WHERE id = ?', subjectId);
    if (!teacher || !cls || !subject) {
      return sendJson(res, 400, { error: 'Teacher, class, and subject must be valid' });
    }

    try {
      if (req.method === 'POST') {
        run(
          'INSERT INTO teacher_assignments (teacher_id, teacher_type, class_code, subject_id) VALUES (?, ?, ?, ?)',
          teacherId,
          teacherType,
          classCode,
          subjectId
        );
      } else {
        const id = Number(body.id);
        if (!id) return sendJson(res, 400, { error: 'Assignment id is required for updates' });
        run(
          'UPDATE teacher_assignments SET teacher_id = ?, teacher_type = ?, class_code = ?, subject_id = ? WHERE id = ?',
          teacherId,
          teacherType,
          classCode,
          subjectId,
          id
        );
      }
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'That assignment already exists' });
      }
      throw err;
    }

    return sendJson(res, 200, {
      ok: true,
      setup: adminSetupPayload(),
    });
  }

  const deleteMatch = url.pathname.match(/^\/api\/admin\/teacher-assignments\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM teacher_assignments WHERE id = ?', Number(deleteMatch[1]));
    return sendJson(res, 200, {
      ok: true,
      setup: adminSetupPayload(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/classes') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const code = cleanText(body.code).toUpperCase();
    const label = cleanText(body.label);
    const category = cleanText(body.category) || null;
    if (!code || !label) return sendJson(res, 400, { error: 'Class code and label are required' });
    try {
      run('INSERT INTO classes (code, label, category) VALUES (?, ?, ?)', code, label, category);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A class with that code already exists' });
      }
      throw err;
    }
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const classUpdateMatch = url.pathname.match(/^\/api\/admin\/classes\/([^/]+)$/);
  if (req.method === 'PUT' && classUpdateMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const code = decodeURIComponent(classUpdateMatch[1]).trim().toUpperCase();
    const existing = one('SELECT code FROM classes WHERE code = ?', code);
    if (!existing) return sendJson(res, 404, { error: 'Class not found' });
    const body = await readJson(req);
    const label = cleanText(body.label);
    const category = cleanText(body.category) || null;
    if (!label) return sendJson(res, 400, { error: 'Class label is required' });
    run('UPDATE classes SET label = ?, category = ? WHERE code = ?', label, category, code);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'DELETE' && classUpdateMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const code = decodeURIComponent(classUpdateMatch[1]).trim().toUpperCase();
    // Counts every student ever linked to this class, active or not — a
    // graduated/left student keeps their class_code, so this also blocks
    // deleting a class that alumni still belong to. Archiving is the only
    // way to retire a class that has ever had students; deletion stays
    // reserved for a class that was created by mistake and never used.
    const studentCount = one('SELECT COUNT(*) AS count FROM students WHERE class_code = ?', code).count;
    if (studentCount > 0) {
      return sendJson(res, 400, { error: 'This class has students (current or past) linked to it and cannot be deleted — archive it instead to hide it without losing their records' });
    }
    run('DELETE FROM class_arms WHERE class_code = ?', code);
    run('DELETE FROM classes WHERE code = ?', code);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'PUT' && url.pathname.match(/^\/api\/admin\/classes\/[^/]+\/archive$/)) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const code = decodeURIComponent(url.pathname.split('/')[4]).trim().toUpperCase();
    const existing = one('SELECT archived FROM classes WHERE code = ?', code);
    if (!existing) return sendJson(res, 404, { error: 'Class not found' });
    run('UPDATE classes SET archived = ? WHERE code = ?', existing.archived ? 0 : 1, code);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/class-categories') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Category name is required' });
    run('INSERT OR IGNORE INTO class_categories (name) VALUES (?)', name);
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const categoryDeleteMatch = url.pathname.match(/^\/api\/admin\/class-categories\/([^/]+)$/);
  if (req.method === 'DELETE' && categoryDeleteMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const name = decodeURIComponent(categoryDeleteMatch[1]).trim();
    const inUse = one('SELECT COUNT(*) AS count FROM classes WHERE category = ?', name).count;
    if (inUse > 0) return sendJson(res, 400, { error: 'Reassign classes using this category before deleting it' });
    run('DELETE FROM class_categories WHERE name = ?', name);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/class-arms') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const classCode = cleanText(body.classCode).toUpperCase();
    const name = cleanText(body.name);
    const formTeacherId = cleanText(body.formTeacherId).toUpperCase() || null;
    if (!classCode || !name) return sendJson(res, 400, { error: 'Class and arm name are required' });
    const cls = one('SELECT code FROM classes WHERE code = ?', classCode);
    if (!cls) return sendJson(res, 400, { error: 'Class does not exist' });
    try {
      run(
        'INSERT INTO class_arms (class_code, name, form_teacher_id) VALUES (?, ?, ?)',
        classCode,
        name,
        formTeacherId
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'That class already has an arm with this name' });
      }
      throw err;
    }
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const classArmMatch = url.pathname.match(/^\/api\/admin\/class-arms\/(\d+)$/);
  if (req.method === 'PUT' && classArmMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(classArmMatch[1]);
    const existing = one('SELECT id FROM class_arms WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Class arm not found' });
    const body = await readJson(req);
    const name = cleanText(body.name);
    const formTeacherId = cleanText(body.formTeacherId).toUpperCase() || null;
    if (!name) return sendJson(res, 400, { error: 'Class arm name is required' });
    run('UPDATE class_arms SET name = ?, form_teacher_id = ? WHERE id = ?', name, formTeacherId, id);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'DELETE' && classArmMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM class_arms WHERE id = ?', Number(classArmMatch[1]));
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/subjects') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    const code = cleanText(body.code) || null;
    const type = cleanText(body.type) || null;
    if (!name) return sendJson(res, 400, { error: 'Subject name is required' });
    try {
      run('INSERT INTO subjects (name, code, type) VALUES (?, ?, ?)', name, code, type);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A subject with that name already exists' });
      }
      throw err;
    }
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const subjectMatch = url.pathname.match(/^\/api\/admin\/subjects\/(\d+)$/);
  if (req.method === 'PUT' && subjectMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(subjectMatch[1]);
    const existing = one('SELECT id FROM subjects WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Subject not found' });
    const body = await readJson(req);
    const name = cleanText(body.name);
    const code = cleanText(body.code) || null;
    const type = cleanText(body.type) || null;
    if (!name) return sendJson(res, 400, { error: 'Subject name is required' });
    try {
      run('UPDATE subjects SET name = ?, code = ?, type = ? WHERE id = ?', name, code, type, id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'A subject with that name already exists' });
      }
      throw err;
    }
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'DELETE' && subjectMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM subjects WHERE id = ?', Number(subjectMatch[1]));
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/subject-types') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Subject type name is required' });
    run('INSERT OR IGNORE INTO subject_types (name) VALUES (?)', name);
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const subjectTypeDeleteMatch = url.pathname.match(/^\/api\/admin\/subject-types\/([^/]+)$/);
  if (req.method === 'DELETE' && subjectTypeDeleteMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const name = decodeURIComponent(subjectTypeDeleteMatch[1]).trim();
    const inUse = one('SELECT COUNT(*) AS count FROM subjects WHERE type = ?', name).count;
    if (inUse > 0) return sendJson(res, 400, { error: 'Reassign subjects using this type before deleting it' });
    run('DELETE FROM subject_types WHERE name = ?', name);
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/class-subjects') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const subjectId = Number(body.subjectId);
    const classCode = cleanText(body.classCode).toUpperCase();
    const classArmId = body.classArmId ? Number(body.classArmId) : null;
    const term = cleanText(body.term) || null;
    const passMark = body.passMark === '' || body.passMark == null ? null : Number(body.passMark);
    const fullMark = body.fullMark === '' || body.fullMark == null ? null : Number(body.fullMark);
    const attributes = cleanText(body.attributes) || null;
    const teacherInChargeId = cleanText(body.teacherInChargeId).toUpperCase() || null;
    const assistingTeacherIds = Array.isArray(body.assistingTeacherIds)
      ? body.assistingTeacherIds.map(id => cleanText(id).toUpperCase()).filter(Boolean).join(',')
      : null;
    if (!subjectId || !classCode) return sendJson(res, 400, { error: 'Subject and class are required' });
    const subject = one('SELECT id FROM subjects WHERE id = ?', subjectId);
    const cls = one('SELECT code FROM classes WHERE code = ?', classCode);
    if (!subject || !cls) return sendJson(res, 400, { error: 'Subject and class must be valid' });
    try {
      run(
        `INSERT INTO class_subjects
           (subject_id, class_code, class_arm_id, term, pass_mark, full_mark, attributes, teacher_in_charge_id, assisting_teacher_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        subjectId,
        classCode,
        classArmId,
        term,
        passMark,
        fullMark,
        attributes,
        teacherInChargeId,
        assistingTeacherIds
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'This subject is already assigned to that class/arm/term' });
      }
      throw err;
    }
    return sendJson(res, 201, { ok: true, setup: adminSetupPayload() });
  }

  const classSubjectMatch = url.pathname.match(/^\/api\/admin\/class-subjects\/(\d+)$/);
  if (req.method === 'PUT' && classSubjectMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(classSubjectMatch[1]);
    const existing = one('SELECT id FROM class_subjects WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Class subject not found' });
    const body = await readJson(req);
    const classArmId = body.classArmId ? Number(body.classArmId) : null;
    const term = cleanText(body.term) || null;
    const passMark = body.passMark === '' || body.passMark == null ? null : Number(body.passMark);
    const fullMark = body.fullMark === '' || body.fullMark == null ? null : Number(body.fullMark);
    const attributes = cleanText(body.attributes) || null;
    const teacherInChargeId = cleanText(body.teacherInChargeId).toUpperCase() || null;
    const assistingTeacherIds = Array.isArray(body.assistingTeacherIds)
      ? body.assistingTeacherIds.map(tid => cleanText(tid).toUpperCase()).filter(Boolean).join(',')
      : null;
    run(
      `UPDATE class_subjects
       SET class_arm_id = ?, term = ?, pass_mark = ?, full_mark = ?, attributes = ?, teacher_in_charge_id = ?, assisting_teacher_ids = ?
       WHERE id = ?`,
      classArmId,
      term,
      passMark,
      fullMark,
      attributes,
      teacherInChargeId,
      assistingTeacherIds,
      id
    );
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'DELETE' && classSubjectMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM class_subjects WHERE id = ?', Number(classSubjectMatch[1]));
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/broadsheet') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const classCode = url.searchParams.get('classCode');
    const examType  = url.searchParams.get('examType');
    const classArmId = url.searchParams.get('classArmId') ? Number(url.searchParams.get('classArmId')) : null;
    if (!classCode || !examType) return sendJson(res, 400, { error: 'classCode and examType required' });
    const academic = activeAcademic();
    if (!academic) return sendJson(res, 400, { error: 'No active academic term' });

    const students = classArmId
      ? all(
          `SELECT id, name, initials, gender, att, photo_path AS photoPath FROM students WHERE class_code = ? AND class_arm_id = ? ORDER BY name`,
          classCode, classArmId
        )
      : all(
          `SELECT id, name, initials, gender, att, photo_path AS photoPath FROM students WHERE class_code = ? ORDER BY name`,
          classCode
        );
    const batches = all(
      `SELECT rb.id, rb.subject_id AS subjectId,
              s.name AS subjectName, s.code AS subjectCode,
              u.name AS teacherName
       FROM result_batches rb
       JOIN subjects s ON s.id = rb.subject_id
       JOIN users u ON u.id = rb.teacher_id
       WHERE rb.class_code = ? AND rb.exam_type = ? AND rb.academic_id = ?`,
      classCode, examType, academic.id
    );
    const seen = new Set();
    const subjects = [];
    for (const b of batches) {
      if (!seen.has(b.subjectId)) { seen.add(b.subjectId); subjects.push({ id: b.subjectId, name: b.subjectName, code: b.subjectCode, teacherName: b.teacherName, batchId: b.id }); }
    }
    const scoreMatrix = {};
    for (const sub of subjects) {
      const entries = all(
        `SELECT student_id AS sid, ca_score AS ca, exam_score AS ex, total_score AS tot, is_absent AS isAbsent
         FROM result_entries WHERE batch_id = ? AND is_excluded = 0`,
        sub.batchId
      );
      for (const e of entries) {
        if (!scoreMatrix[e.sid]) scoreMatrix[e.sid] = {};
        // Absent entries are kept out of the matrix entirely so every average/
        // ranking calculation below (which only ever reads existing matrix
        // entries) naturally treats them the same as "no score yet" — never
        // counted, never dragging an average down.
        if (!e.isAbsent) scoreMatrix[e.sid][sub.id] = { ca: e.ca, ex: e.ex, tot: e.tot };
      }
    }
    const subjMax = maxScoreForExamType(examType);
    const studentData = students.map(st => {
      let grand = 0; let counted = 0;
      for (const sub of subjects) { const s = scoreMatrix[st.id]?.[sub.id]; if (s) { grand += s.tot; counted++; } }
      const maxPoss = counted * subjMax;
      return { ...st, grandTotal: grand, maxPossible: maxPoss, avgPct: maxPoss > 0 ? +(grand / maxPoss * 100).toFixed(2) : 0 };
    });
    const sorted = [...studentData].sort((a, b) => b.grandTotal - a.grandTotal);
    const posMap = {};
    sorted.forEach((s, i) => { posMap[s.id] = i + 1; });
    const rankedStudents = studentData.map(s => {
      const { teacherComment, headComment } = resolveReportComments({
        academicId: academic.id, studentId: s.id, examType, average: s.avgPct,
      });
      const suggestedComment = commentBankMatch(s.avgPct)
        || valueFromMeta('head_comment_default', 'Great work! Your diligence in your academics is impressive.');
      const dailyAttendance = attendanceCounts(s.id, 'daily');
      const lessonAttendance = attendanceCounts(s.id, 'lesson');
      return { ...s, position: posMap[s.id] || '—', teacherComment, headComment, suggestedComment, dailyAttendance, lessonAttendance };
    });

    // Per-subject rank: where a student placed among classmates in just that
    // one subject, shown as a small badge under each subject's Total Score.
    const subjectRanks = {};
    for (const sub of subjects) {
      const withScores = students
        .map(st => ({ id: st.id, tot: scoreMatrix[st.id]?.[sub.id]?.tot }))
        .filter(s => s.tot != null)
        .sort((a, b) => b.tot - a.tot);
      const ranks = {};
      withScores.forEach((s, i) => { ranks[s.id] = i + 1; });
      subjectRanks[sub.id] = ranks;
    }
    const subjectStats = subjects.map(sub => {
      const scores = students.map(st => scoreMatrix[st.id]?.[sub.id]?.tot).filter(v => v != null);
      const total = scores.reduce((a, b) => a + b, 0);
      const avg = scores.length ? +(total / scores.length).toFixed(2) : 0;
      const max = scores.length ? Math.max(...scores) : 0;
      const uniqueSorted = [...new Set(scores)].sort((a, b) => b - a);
      const second = uniqueSorted[1] ?? null;
      return {
        ...sub,
        totalScore: total,
        studentCount: scores.length,
        average: avg,
        topStudents: students.filter(st => scoreMatrix[st.id]?.[sub.id]?.tot === max && max > 0).map(st => `${st.name} (${max})`),
        secondStudents: second != null ? students.filter(st => scoreMatrix[st.id]?.[sub.id]?.tot === second).map(st => `${st.name} (${second})`) : [],
      };
    });
    const grandTotalAvgs = +subjectStats.reduce((a, b) => a + b.average, 0).toFixed(2);
    const classScoreAvg  = subjects.length ? +(grandTotalAvgs / subjects.length).toFixed(2) : 0;
    const best = sorted[0] || null;
    return sendJson(res, 200, {
      academic, examType, subjMax, subjects, students: rankedStudents, scoreMatrix, subjectStats, subjectRanks,
      stats: {
        activeStudents: students.length,
        grandTotalSubjectScoreAverages: grandTotalAvgs,
        classScoreAverage: classScoreAvg,
        bestStudent: best ? { name: best.name, grandTotal: `${best.grandTotal} / ${best.maxPossible}`, average: best.avgPct } : null,
      },
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/active-term') {
    const user = requireUser(req, res);
    if (!user) return;
    const active = one(`SELECT session_label AS sessionLabel, term_label AS termLabel FROM academic_terms WHERE is_active = 1 LIMIT 1`);
    return sendJson(res, 200, active || {});
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/academic-sessions') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const sessions = all(`SELECT id, session_label AS sessionLabel, term_label AS termLabel, is_active AS isActive FROM academic_terms ORDER BY id DESC`);
    return sendJson(res, 200, { sessions });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/academic-sessions') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const body = await readJson(req);
    const sessionLabel = cleanText(body.sessionLabel);
    const termLabel = cleanText(body.termLabel);
    if (!sessionLabel || !termLabel) return sendJson(res, 400, { error: 'Session label and term label are required' });
    const existing = one('SELECT id FROM academic_terms WHERE session_label = ? AND term_label = ?', sessionLabel, termLabel);
    if (existing) return sendJson(res, 409, { error: 'This session/term combination already exists' });
    const result = run('INSERT INTO academic_terms (session_label, term_label, is_active) VALUES (?, ?, 0)', sessionLabel, termLabel);
    return sendJson(res, 200, { ok: true, id: result.lastInsertRowid });
  }

  // Combines create-if-needed + activate into one step, for the Session/Term
  // dropdown picker (no more free-text session/term entry).
  if (req.method === 'POST' && url.pathname === '/api/admin/academic-sessions/set-current') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const body = await readJson(req);
    const sessionLabel = cleanText(body.sessionLabel);
    const termLabel = cleanText(body.termLabel);
    if (!sessionLabel || !termLabel) return sendJson(res, 400, { error: 'Session and term are required' });
    if (!/^\d{4}\/\d{4}$/.test(sessionLabel)) return sendJson(res, 400, { error: 'Session must be in the form 2026/2027' });
    if (!['Term 1', 'Term 2', 'Term 3'].includes(termLabel)) return sendJson(res, 400, { error: 'Term must be Term 1, Term 2, or Term 3' });
    let row = one('SELECT id FROM academic_terms WHERE session_label = ? AND term_label = ?', sessionLabel, termLabel);
    if (!row) {
      const result = run('INSERT INTO academic_terms (session_label, term_label, is_active) VALUES (?, ?, 0)', sessionLabel, termLabel);
      row = { id: result.lastInsertRowid };
    }
    run('UPDATE academic_terms SET is_active = 0');
    run('UPDATE academic_terms SET is_active = 1 WHERE id = ?', row.id);
    return sendJson(res, 200, { ok: true, id: row.id });
  }

  const termDatesMatch = url.pathname.match(/^\/api\/admin\/academic-sessions\/(\d+)\/dates$/);
  if (req.method === 'PUT' && termDatesMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = Number(termDatesMatch[1]);
    const term = one('SELECT id FROM academic_terms WHERE id = ?', id);
    if (!term) return sendJson(res, 404, { error: 'Session not found' });
    const body = await readJson(req);
    const startDate = cleanText(body.startDate);
    const endDate = cleanText(body.endDate);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
      return sendJson(res, 400, { error: 'Start and end date are required' });
    }
    if (endDate < startDate) return sendJson(res, 400, { error: 'End date must be after start date' });
    run('UPDATE academic_terms SET start_date = ?, end_date = ? WHERE id = ?', startDate, endDate, id);
    seedHolidaysForRange(id, startDate, endDate);
    const holidays = all('SELECT id, holiday_date AS date, label FROM term_holidays WHERE academic_id = ? ORDER BY holiday_date', id);
    return sendJson(res, 200, { ok: true, startDate, endDate, schoolDays: computeSchoolDays(id), holidays });
  }

  const termHolidaysMatch = url.pathname.match(/^\/api\/admin\/academic-sessions\/(\d+)\/holidays$/);
  if (req.method === 'GET' && termHolidaysMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = Number(termHolidaysMatch[1]);
    const term = one('SELECT id, start_date AS startDate, end_date AS endDate FROM academic_terms WHERE id = ?', id);
    if (!term) return sendJson(res, 404, { error: 'Session not found' });
    const holidays = all('SELECT id, holiday_date AS date, label FROM term_holidays WHERE academic_id = ? ORDER BY holiday_date', id);
    return sendJson(res, 200, { startDate: term.startDate, endDate: term.endDate, schoolDays: computeSchoolDays(id), holidays });
  }
  if (req.method === 'POST' && termHolidaysMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = Number(termHolidaysMatch[1]);
    const term = one('SELECT id, start_date AS startDate, end_date AS endDate FROM academic_terms WHERE id = ?', id);
    if (!term) return sendJson(res, 404, { error: 'Session not found' });
    const body = await readJson(req);
    const date = cleanText(body.date);
    const label = cleanText(body.label) || 'Holiday';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'A valid date is required' });
    if (term.startDate && (date < term.startDate || date > term.endDate)) {
      return sendJson(res, 400, { error: 'Date must fall within the term\'s start and end date' });
    }
    try {
      run('INSERT INTO term_holidays (academic_id, holiday_date, label) VALUES (?, ?, ?)', id, date, label);
    } catch (err) {
      return sendJson(res, 409, { error: 'That date is already marked as a holiday' });
    }
    const holidays = all('SELECT id, holiday_date AS date, label FROM term_holidays WHERE academic_id = ? ORDER BY holiday_date', id);
    return sendJson(res, 200, { ok: true, schoolDays: computeSchoolDays(id), holidays });
  }

  const deleteHolidayMatch = url.pathname.match(/^\/api\/admin\/academic-sessions\/(\d+)\/holidays\/(\d+)$/);
  if (req.method === 'DELETE' && deleteHolidayMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = Number(deleteHolidayMatch[1]);
    const holidayId = Number(deleteHolidayMatch[2]);
    run('DELETE FROM term_holidays WHERE id = ? AND academic_id = ?', holidayId, id);
    const holidays = all('SELECT id, holiday_date AS date, label FROM term_holidays WHERE academic_id = ? ORDER BY holiday_date', id);
    return sendJson(res, 200, { ok: true, schoolDays: computeSchoolDays(id), holidays });
  }

  const activateSessionMatch = url.pathname.match(/^\/api\/admin\/academic-sessions\/(\d+)\/activate$/);
  if (req.method === 'PUT' && activateSessionMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = activateSessionMatch[1];
    const existing = one('SELECT id FROM academic_terms WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Session not found' });
    run('UPDATE academic_terms SET is_active = 0');
    run('UPDATE academic_terms SET is_active = 1 WHERE id = ?', id);
    return sendJson(res, 200, { ok: true });
  }

  const deleteSessionMatch = url.pathname.match(/^\/api\/admin\/academic-sessions\/(\d+)$/);
  if (req.method === 'DELETE' && deleteSessionMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = deleteSessionMatch[1];
    const existing = one('SELECT id, is_active FROM academic_terms WHERE id = ?', id);
    if (!existing) return sendJson(res, 404, { error: 'Session not found' });
    if (existing.is_active) return sendJson(res, 400, { error: 'Cannot delete the active session' });
    run('DELETE FROM academic_terms WHERE id = ?', id);
    return sendJson(res, 200, { ok: true });
  }

  // ── SYSTEM SETTINGS ──
  const SYS_KEYS = [
    'school_name','school_motto','school_mission','school_vision','school_values',
    'head_staff_title','student_term','reg_prefix',
    'school_address','school_city','school_country','school_email','school_email_alt',
    'school_phone','school_phone_alt','school_whatsapp','wa_chat_btn','wa_chat_msg',
    'fees_desk','admission_desk',
    'active_services','ga_tag','website_url','contact_url',
    'currency','timezone','multi_timezone',
    'att_alert','att_channel','new_user_email',
    'promo_auto','promo_threshold','promo_image_promoted','promo_image_not_promoted',
  ];

  if (req.method === 'GET' && url.pathname === '/api/admin/system-settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const settings = {};
    SYS_KEYS.forEach(k => { settings[k] = valueFromMeta(k, ''); });
    // defaults for empty fields
    if (!settings.school_name)    settings.school_name    = "Unique Children's School";
    if (!settings.head_staff_title) settings.head_staff_title = 'Head of School';
    if (!settings.student_term)   settings.student_term   = 'student';
    if (!settings.reg_prefix)     settings.reg_prefix     = 'LS/{ADMISSION_YEAR}/';
    if (!settings.school_country) settings.school_country = 'Nigeria';
    if (!settings.active_services) settings.active_services = 'School Portal Only';
    if (!settings.currency)       settings.currency       = 'Nigerian naira (₦)';
    if (!settings.timezone)       settings.timezone       = '(GMT+1:00) Africa/Lagos (Western African Time)';
    if (!settings.multi_timezone) settings.multi_timezone = 'Disabled';
    if (!settings.att_alert)      settings.att_alert      = 'Disable';
    if (!settings.att_channel)    settings.att_channel    = 'Email';
    if (!settings.new_user_email) settings.new_user_email = 'Yes';
    if (!settings.wa_chat_btn)    settings.wa_chat_btn    = 'Enable';
    if (!settings.wa_chat_msg)    settings.wa_chat_msg    = "Hello! Chat with us on WhatsApp. We're here to help!";
    if (!settings.promo_threshold) settings.promo_threshold = '50';
    if (!settings.promo_auto)    settings.promo_auto     = 'on';
    return sendJson(res, 200, { settings });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/system-settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    if (body.promoImagePromotedData) {
      try {
        setMeta('promo_image_promoted', saveDataUrl(body.promoImagePromotedData, 'promo-yes'));
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
    if (body.promoImageNotPromotedData) {
      try {
        setMeta('promo_image_not_promoted', saveDataUrl(body.promoImageNotPromotedData, 'promo-no'));
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
    SYS_KEYS.forEach(k => {
      if (k === 'promo_image_promoted' || k === 'promo_image_not_promoted') return;
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        setMeta(k, cleanText(String(body[k] ?? '')));
      }
    });
    return sendJson(res, 200, { ok: true });
  }

  // ── FEES / BURSARY (Finance MVP) ──
  // Invoice list — powers Invoice List and Class Invoice History (same
  // endpoint, filtered by classCode/academicId).
  if (req.method === 'GET' && url.pathname === '/api/admin/fees/invoices') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const academicIdParam = url.searchParams.get('academicId');
    const statusFilter = cleanText(url.searchParams.get('status') || 'all').toLowerCase();
    const search = cleanText(url.searchParams.get('search')).toLowerCase();
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();

    let sql = `SELECT fi.id, fi.student_id AS studentId, st.name AS studentName, st.parent_email AS parentEmail,
                      fi.academic_id AS academicId, fi.class_code AS classCode, c.label AS classLabel,
                      fi.fee_type AS feeType, fi.description, fi.amount, fi.due_date AS dueDate,
                      fi.created_by AS createdBy, fi.created_at AS createdAt
               FROM fee_invoices fi
               JOIN students st ON st.id = fi.student_id
               JOIN classes c ON c.code = fi.class_code
               WHERE 1=1`;
    const params = [];
    if (classCode) { sql += ' AND fi.class_code = ?'; params.push(classCode); }
    if (academicIdParam) { sql += ' AND fi.academic_id = ?'; params.push(Number(academicIdParam)); }
    if (studentId) { sql += ' AND fi.student_id = ?'; params.push(studentId); }
    sql += ' ORDER BY fi.created_at DESC';

    let invoices = all(sql, ...params).map(decorateInvoice);
    if (statusFilter && statusFilter !== 'all') {
      invoices = invoices.filter(inv => (statusFilter === 'overdue' ? inv.overdue : inv.status === statusFilter));
    }
    if (search) {
      invoices = invoices.filter(inv =>
        inv.studentName.toLowerCase().includes(search) ||
        inv.studentId.toLowerCase().includes(search) ||
        (inv.feeType || '').toLowerCase().includes(search) ||
        (inv.description || '').toLowerCase().includes(search)
      );
    }
    const summary = invoices.reduce((acc, inv) => {
      acc.count += 1;
      acc.totalInvoiced = round2(acc.totalInvoiced + inv.amount);
      acc.totalPaid = round2(acc.totalPaid + inv.paid);
      acc.totalBalance = round2(acc.totalBalance + inv.balance);
      return acc;
    }, { count: 0, totalInvoiced: 0, totalPaid: 0, totalBalance: 0 });

    return sendJson(res, 200, { invoices, summary });
  }

  // Create an invoice for one/many students, or a whole class in one call.
  if (req.method === 'POST' && url.pathname === '/api/admin/fees/invoices') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const feeType = cleanText(body.feeType);
    const description = cleanText(body.description);
    const dueDate = cleanText(body.dueDate);
    const classCode = cleanText(body.classCode).toUpperCase();
    const explicitIds = Array.isArray(body.studentIds)
      ? body.studentIds.map(id => cleanText(id).toUpperCase()).filter(Boolean)
      : (body.studentId ? [cleanText(body.studentId).toUpperCase()] : []);

    if (!feeType) return sendJson(res, 400, { error: 'Fee type is required' });
    let amount;
    try {
      amount = validateFeeAmount(body.amount);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    let targetStudentIds = explicitIds;
    if (!targetStudentIds.length && classCode) {
      targetStudentIds = all('SELECT id FROM students WHERE class_code = ?', classCode).map(r => r.id);
    }
    if (!targetStudentIds.length) {
      return sendJson(res, 400, { error: 'Select at least one student, or a whole class, to invoice' });
    }

    let academicId = Number(body.academicId) || null;
    if (academicId) {
      if (!one('SELECT id FROM academic_terms WHERE id = ?', academicId)) {
        return sendJson(res, 400, { error: 'Academic term not found' });
      }
    } else {
      const active = one('SELECT id FROM academic_terms WHERE is_active = 1');
      academicId = active ? active.id : null;
    }
    if (!academicId) return sendJson(res, 400, { error: 'No active academic term is configured' });

    const validStudents = all(
      `SELECT id, class_code AS classCode FROM students WHERE id IN (${targetStudentIds.map(() => '?').join(',')})`,
      ...targetStudentIds
    );
    if (!validStudents.length) return sendJson(res, 400, { error: 'No matching students found' });

    const createdAt = new Date().toISOString();
    const createdIds = validStudents.map(student => {
      const result = run(
        `INSERT INTO fee_invoices (student_id, academic_id, class_code, fee_type, description, amount, due_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        student.id, academicId, student.classCode, feeType, description || null, amount, dueDate || null, user.id, createdAt
      );
      return Number(result.lastInsertRowid);
    });

    return sendJson(res, 200, { ok: true, count: createdIds.length, invoices: createdIds.map(feeInvoiceById) });
  }

  const feeInvoiceMatch = url.pathname.match(/^\/api\/admin\/fees\/invoices\/(\d+)$/);
  if (req.method === 'GET' && feeInvoiceMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const invoice = feeInvoiceById(feeInvoiceMatch[1]);
    if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
    return sendJson(res, 200, { invoice });
  }

  // Record a payment (successful/pending/failed) against an invoice.
  const feePaymentMatch = url.pathname.match(/^\/api\/admin\/fees\/invoices\/(\d+)\/payments$/);
  if (req.method === 'POST' && feePaymentMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const invoiceId = Number(feePaymentMatch[1]);
    if (!one('SELECT id FROM fee_invoices WHERE id = ?', invoiceId)) {
      return sendJson(res, 404, { error: 'Invoice not found' });
    }
    const body = await readJson(req);
    const method = cleanText(body.method);
    if (!method) return sendJson(res, 400, { error: 'Payment method is required' });
    let amount;
    try {
      amount = validateFeeAmount(body.amount);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const status = FEE_PAYMENT_STATUSES.includes(body.status) ? body.status : 'successful';
    const reference = cleanText(body.reference) || null;
    const note = cleanText(body.note) || null;

    run(
      `INSERT INTO fee_payments (invoice_id, amount, method, reference, status, note, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, amount, method, reference, status, note, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true, invoice: feeInvoiceById(invoiceId) });
  }

  // Flip a payment's status — used to approve/reject a pending proof (Review
  // Payment Proofs) or reconcile a payment found by reference (Verify
  // Payment Status).
  const feePaymentStatusMatch = url.pathname.match(/^\/api\/admin\/fees\/payments\/(\d+)\/status$/);
  if (req.method === 'POST' && feePaymentStatusMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const paymentId = Number(feePaymentStatusMatch[1]);
    const payment = one('SELECT id, invoice_id AS invoiceId FROM fee_payments WHERE id = ?', paymentId);
    if (!payment) return sendJson(res, 404, { error: 'Payment not found' });
    const body = await readJson(req);
    const status = cleanText(body.status);
    if (!FEE_PAYMENT_STATUSES.includes(status)) return sendJson(res, 400, { error: 'Invalid status' });
    run('UPDATE fee_payments SET status = ? WHERE id = ?', status, paymentId);
    return sendJson(res, 200, { ok: true, invoice: feeInvoiceById(payment.invoiceId) });
  }

  // Payments log — powers Successful Payments, All Payment Attempts, the
  // Review Payment Proofs queue (status=pending), and Verify Payment Status
  // (reference lookup).
  if (req.method === 'GET' && url.pathname === '/api/admin/fees/payments') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const from = cleanText(url.searchParams.get('from'));
    const to = cleanText(url.searchParams.get('to'));
    const statusFilter = cleanText(url.searchParams.get('status') || 'all').toLowerCase();
    const method = cleanText(url.searchParams.get('method'));
    const search = cleanText(url.searchParams.get('search')).toLowerCase();
    const reference = cleanText(url.searchParams.get('reference')).toLowerCase();

    let sql = `SELECT fp.id, fp.invoice_id AS invoiceId, fp.amount, fp.method, fp.reference, fp.status, fp.note,
                      fp.recorded_by AS recordedBy, fp.recorded_at AS recordedAt,
                      fi.fee_type AS feeType, fi.description, fi.class_code AS classCode, c.label AS classLabel,
                      st.id AS studentId, st.name AS studentName, u.name AS recordedByName
               FROM fee_payments fp
               JOIN fee_invoices fi ON fi.id = fp.invoice_id
               JOIN students st ON st.id = fi.student_id
               JOIN classes c ON c.code = fi.class_code
               LEFT JOIN users u ON u.id = fp.recorded_by
               WHERE 1=1`;
    const params = [];
    if (from) { sql += ' AND date(fp.recorded_at) >= date(?)'; params.push(from); }
    if (to) { sql += ' AND date(fp.recorded_at) <= date(?)'; params.push(to); }
    if (method) { sql += ' AND fp.method = ?'; params.push(method); }
    sql += ' ORDER BY fp.recorded_at DESC';

    let rows = all(sql, ...params).map(r => ({ ...r, amount: round2(r.amount) }));
    if (statusFilter && statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (search) {
      rows = rows.filter(r =>
        r.studentName.toLowerCase().includes(search) ||
        r.studentId.toLowerCase().includes(search) ||
        (r.reference || '').toLowerCase().includes(search)
      );
    }
    if (reference) rows = rows.filter(r => (r.reference || '').toLowerCase().includes(reference));

    const total = round2(rows.filter(r => r.status === 'successful').reduce((sum, r) => sum + r.amount, 0));
    return sendJson(res, 200, { payments: rows, total });
  }

  // Full fee history for one student, or every student sharing a parent
  // email ("family").
  if (req.method === 'GET' && url.pathname === '/api/admin/fees/history') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
    const parentEmail = cleanText(url.searchParams.get('parentEmail')).toLowerCase();
    if (!studentId && !parentEmail) return sendJson(res, 400, { error: 'studentId or parentEmail is required' });

    const students = studentId
      ? all('SELECT id, name, class_code AS classCode, parent_email AS parentEmail FROM students WHERE id = ?', studentId)
      : all('SELECT id, name, class_code AS classCode, parent_email AS parentEmail FROM students WHERE lower(parent_email) = ?', parentEmail);
    if (!students.length) return sendJson(res, 404, { error: 'No matching student(s) found' });

    const studentDetails = students.map(student => {
      const invoices = all(
        `SELECT id, fee_type AS feeType, description, amount, due_date AS dueDate,
                academic_id AS academicId, class_code AS classCode, created_at AS createdAt
         FROM fee_invoices WHERE student_id = ? ORDER BY created_at DESC`,
        student.id
      ).map(row => decorateInvoice({ ...row, studentId: student.id, studentName: student.name }));
      const totals = invoices.reduce((acc, inv) => {
        acc.invoiced = round2(acc.invoiced + inv.amount);
        acc.paid = round2(acc.paid + inv.paid);
        acc.balance = round2(acc.balance + inv.balance);
        return acc;
      }, { invoiced: 0, paid: 0, balance: 0 });
      return { ...student, invoices, totals };
    });

    const totals = studentDetails.reduce((acc, s) => {
      acc.invoiced = round2(acc.invoiced + s.totals.invoiced);
      acc.paid = round2(acc.paid + s.totals.paid);
      acc.balance = round2(acc.balance + s.totals.balance);
      return acc;
    }, { invoiced: 0, paid: 0, balance: 0 });

    return sendJson(res, 200, { students: studentDetails, totals });
  }

  // Families list (students grouped by parent email) for Family Fees History.
  if (req.method === 'GET' && url.pathname === '/api/admin/fees/families') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const students = all(
      `SELECT id, name, class_code AS classCode, parent_email AS parentEmail
       FROM students WHERE parent_email IS NOT NULL AND parent_email <> '' ORDER BY parent_email`
    );
    const families = new Map();
    students.forEach(student => {
      const key = student.parentEmail.toLowerCase();
      if (!families.has(key)) families.set(key, { parentEmail: student.parentEmail, students: [] });
      families.get(key).students.push(student);
    });
    const rows = [...families.values()].map(family => {
      let invoiced = 0, paid = 0, balance = 0;
      family.students.forEach(student => {
        all('SELECT id, amount FROM fee_invoices WHERE student_id = ?', student.id).forEach(inv => {
          const p = invoicePaidAmount(inv.id);
          invoiced = round2(invoiced + inv.amount);
          paid = round2(paid + p);
          balance = round2(balance + (inv.amount - p));
        });
      });
      return { ...family, studentCount: family.students.length, totals: { invoiced, paid, balance } };
    });
    return sendJson(res, 200, { families: rows });
  }

  // Debtors report — students with an outstanding balance.
  if (req.method === 'GET' && url.pathname === '/api/admin/fees/debtors') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
    const academicIdParam = url.searchParams.get('academicId');

    let sql = `SELECT fi.id, fi.student_id AS studentId, st.name AS studentName, fi.class_code AS classCode,
                      c.label AS classLabel, fi.amount, fi.due_date AS dueDate
               FROM fee_invoices fi
               JOIN students st ON st.id = fi.student_id
               JOIN classes c ON c.code = fi.class_code
               WHERE 1=1`;
    const params = [];
    if (classCode) { sql += ' AND fi.class_code = ?'; params.push(classCode); }
    if (academicIdParam) { sql += ' AND fi.academic_id = ?'; params.push(Number(academicIdParam)); }

    const invoices = all(sql, ...params).map(decorateInvoice).filter(inv => inv.balance > 0);
    const byStudent = new Map();
    invoices.forEach(inv => {
      if (!byStudent.has(inv.studentId)) {
        byStudent.set(inv.studentId, {
          studentId: inv.studentId, studentName: inv.studentName, classCode: inv.classCode, classLabel: inv.classLabel,
          invoiceCount: 0, totalInvoiced: 0, totalPaid: 0, balance: 0, dueDate: null, overdue: false,
        });
      }
      const row = byStudent.get(inv.studentId);
      row.invoiceCount += 1;
      row.totalInvoiced = round2(row.totalInvoiced + inv.amount);
      row.totalPaid = round2(row.totalPaid + inv.paid);
      row.balance = round2(row.balance + inv.balance);
      if (inv.overdue) row.overdue = true;
      if (inv.dueDate && (!row.dueDate || inv.dueDate < row.dueDate)) row.dueDate = inv.dueDate;
    });
    const debtors = [...byStudent.values()].sort((a, b) => b.balance - a.balance);
    const summary = debtors.reduce((acc, d) => {
      acc.count += 1;
      acc.totalBalance = round2(acc.totalBalance + d.balance);
      return acc;
    }, { count: 0, totalBalance: 0 });

    return sendJson(res, 200, { debtors, summary });
  }

  // ── FINANCE: HRM/PAYROLL + INCOME & EXPENSES (feature/finance-payroll-expenses) ──
  // Self-contained route block (own tables, own helpers) so it merges cleanly
  // alongside sibling finance branches (Fees/Bursary, Store & Accounting).

  if (req.method === 'GET' && url.pathname === '/api/admin/payroll/rates') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rates = all(
      `SELECT u.id AS staffId, u.name, u.role, u.teacher_type AS teacherType,
              COALESCE(r.base_salary, 0) AS baseSalary,
              COALESCE(r.allowances, 0) AS allowances,
              COALESCE(r.deductions, 0) AS deductions
       FROM users u
       LEFT JOIN staff_pay_rates r ON r.staff_id = u.id
       WHERE u.role IN ('teacher','admin')
       ORDER BY u.role DESC, u.name`
    );
    return sendJson(res, 200, { rates });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/payroll/rates') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const staffId = cleanText(body.staffId).toUpperCase();
    const staff = one("SELECT id FROM users WHERE id = ? AND role IN ('teacher','admin')", staffId);
    if (!staff) return sendJson(res, 400, { error: 'Staff member not found' });
    const baseSalary = parseMoney(body.baseSalary);
    const allowances = parseMoney(body.allowances);
    const deductions = parseMoney(body.deductions);
    if (baseSalary === null || allowances === null || deductions === null) {
      return sendJson(res, 400, { error: 'Base salary, allowances, and deductions must be non-negative numbers' });
    }
    run(
      `INSERT INTO staff_pay_rates (staff_id, base_salary, allowances, deductions, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(staff_id) DO UPDATE SET base_salary = excluded.base_salary, allowances = excluded.allowances, deductions = excluded.deductions, updated_at = excluded.updated_at`,
      staffId, baseSalary, allowances, deductions, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/payroll/salaries') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const period = cleanText(url.searchParams.get('period')) || periodString(new Date());
    const salaries = all(
      `SELECT s.id, s.staff_id AS staffId, u.name, u.role, u.teacher_type AS teacherType,
              s.period, s.base_salary AS baseSalary, s.allowances, s.deductions,
              s.net_salary AS netSalary, s.status, s.paid_at AS paidAt, s.created_at AS createdAt
       FROM staff_salaries s
       JOIN users u ON u.id = s.staff_id
       WHERE s.period = ?
       ORDER BY u.role DESC, u.name`,
      period
    );
    return sendJson(res, 200, { period, salaries });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/payroll/salaries/generate') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const period = cleanText(body.period);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return sendJson(res, 400, { error: 'A valid period (YYYY-MM) is required' });
    }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) return sendJson(res, 400, { error: 'At least one staff entry is required' });

    const now = new Date().toISOString();
    let processed = 0;
    for (const entry of entries) {
      const staffId = cleanText(entry.staffId).toUpperCase();
      const staff = one("SELECT id FROM users WHERE id = ? AND role IN ('teacher','admin')", staffId);
      if (!staff) continue;
      const baseSalary = parseMoney(entry.baseSalary) ?? 0;
      const allowances = parseMoney(entry.allowances) ?? 0;
      const deductions = parseMoney(entry.deductions) ?? 0;
      const netSalary = baseSalary + allowances - deductions;
      const existing = one('SELECT id, status FROM staff_salaries WHERE staff_id = ? AND period = ?', staffId, period);
      if (existing && existing.status === 'paid') continue; // never overwrite a paid record
      if (existing) {
        run(
          `UPDATE staff_salaries SET base_salary = ?, allowances = ?, deductions = ?, net_salary = ?, created_by = ?, created_at = ?
           WHERE id = ?`,
          baseSalary, allowances, deductions, netSalary, user.id, now, existing.id
        );
      } else {
        run(
          `INSERT INTO staff_salaries (staff_id, period, base_salary, allowances, deductions, net_salary, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          staffId, period, baseSalary, allowances, deductions, netSalary, user.id, now
        );
      }
      processed += 1;
    }
    const salaries = all(
      `SELECT s.id, s.staff_id AS staffId, u.name, s.period, s.base_salary AS baseSalary, s.allowances, s.deductions,
              s.net_salary AS netSalary, s.status, s.paid_at AS paidAt
       FROM staff_salaries s JOIN users u ON u.id = s.staff_id
       WHERE s.period = ? ORDER BY u.name`,
      period
    );
    return sendJson(res, 200, { ok: true, processed, period, salaries });
  }

  const salaryPayMatch = url.pathname.match(/^\/api\/admin\/payroll\/salaries\/(\d+)\/pay$/);
  if (req.method === 'POST' && salaryPayMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const record = one('SELECT * FROM staff_salaries WHERE id = ?', Number(salaryPayMatch[1]));
    if (!record) return sendJson(res, 404, { error: 'Salary record not found' });
    if (record.status === 'paid') return sendJson(res, 400, { error: 'This salary has already been marked paid' });
    run('UPDATE staff_salaries SET status = ?, paid_at = ? WHERE id = ?', 'paid', new Date().toISOString(), record.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/payroll/loans') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const loans = all(
      `SELECT l.id, l.staff_id AS staffId, u.name, l.loan_type AS loanType, l.amount, l.reason,
              l.monthly_deduction AS monthlyDeduction, l.repayment_status AS repaymentStatus,
              l.issued_at AS issuedAt
       FROM staff_loans l
       JOIN users u ON u.id = l.staff_id
       ORDER BY l.issued_at DESC`
    );
    return sendJson(res, 200, { loans });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/payroll/loans') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const staffId = cleanText(body.staffId).toUpperCase();
    const staff = one("SELECT id FROM users WHERE id = ? AND role IN ('teacher','admin')", staffId);
    if (!staff) return sendJson(res, 400, { error: 'Staff member not found' });
    const loanType = body.loanType === 'advance' ? 'advance' : 'loan';
    const amount = parseMoney(body.amount);
    if (amount === null || amount <= 0) return sendJson(res, 400, { error: 'A positive amount is required' });
    const monthlyDeduction = parseMoney(body.monthlyDeduction) ?? 0;
    const reason = cleanText(body.reason);
    const inserted = run(
      `INSERT INTO staff_loans (staff_id, loan_type, amount, reason, monthly_deduction, repayment_status, issued_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'outstanding', ?, ?)`,
      staffId, loanType, amount, reason, monthlyDeduction, new Date().toISOString(), user.id
    );
    return sendJson(res, 200, { ok: true, id: Number(inserted.lastInsertRowid) });
  }

  const loanStatusMatch = url.pathname.match(/^\/api\/admin\/payroll\/loans\/(\d+)\/status$/);
  if (req.method === 'POST' && loanStatusMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const loan = one('SELECT id FROM staff_loans WHERE id = ?', Number(loanStatusMatch[1]));
    if (!loan) return sendJson(res, 404, { error: 'Loan record not found' });
    const body = await readJson(req);
    const status = cleanText(body.status);
    if (!['outstanding', 'repaying', 'repaid'].includes(status)) {
      return sendJson(res, 400, { error: 'Invalid repayment status' });
    }
    run('UPDATE staff_loans SET repayment_status = ? WHERE id = ?', status, loan.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/finance/expense-requests') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const requests = all(
      `SELECT r.id, r.title, r.category, r.amount, r.reason, r.status,
              r.requested_by AS requestedBy, ru.name AS requestedByName,
              r.approved_by AS approvedBy, au.name AS approvedByName,
              r.approved_at AS approvedAt, r.requested_at AS requestedAt
       FROM expense_requests r
       JOIN users ru ON ru.id = r.requested_by
       LEFT JOIN users au ON au.id = r.approved_by
       ORDER BY r.requested_at DESC`
    );
    return sendJson(res, 200, { requests });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/finance/expense-requests') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    const amount = parseMoney(body.amount);
    if (!title || amount === null || amount <= 0) {
      return sendJson(res, 400, { error: 'Title and a positive amount are required' });
    }
    const category = cleanText(body.category) || 'General';
    const reason = cleanText(body.reason);
    const inserted = run(
      `INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, requested_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      title, category, amount, reason, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true, id: Number(inserted.lastInsertRowid) });
  }

  const requestDecisionMatch = url.pathname.match(/^\/api\/admin\/finance\/expense-requests\/(\d+)\/decision$/);
  if (req.method === 'POST' && requestDecisionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const request = one('SELECT * FROM expense_requests WHERE id = ?', Number(requestDecisionMatch[1]));
    if (!request) return sendJson(res, 404, { error: 'Expense request not found' });
    const body = await readJson(req);
    const action = cleanText(body.action);
    const now = new Date().toISOString();
    if (action === 'approve') {
      if (request.status !== 'pending') return sendJson(res, 400, { error: 'Only pending requests can be approved' });
      run('UPDATE expense_requests SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?', 'approved', user.id, now, request.id);
    } else if (action === 'reject') {
      if (request.status !== 'pending') return sendJson(res, 400, { error: 'Only pending requests can be rejected' });
      run('UPDATE expense_requests SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?', 'rejected', user.id, now, request.id);
    } else if (action === 'dispense') {
      if (request.status !== 'approved') return sendJson(res, 400, { error: 'Only approved requests can be dispensed' });
      run('UPDATE expense_requests SET status = ? WHERE id = ?', 'dispensed', request.id);
      run(
        `INSERT INTO expenses (category, description, amount, expense_date, request_id, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        request.category || 'General', request.title, request.amount, now.slice(0, 10), request.id, user.id, now
      );
    } else {
      return sendJson(res, 400, { error: 'Action must be approve, reject, or dispense' });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/finance/expenses') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const expenses = all(
      `SELECT e.id, e.category, e.description, e.amount, e.expense_date AS expenseDate,
              e.request_id AS requestId, e.recorded_by AS recordedBy, u.name AS recordedByName,
              e.created_at AS createdAt
       FROM expenses e
       JOIN users u ON u.id = e.recorded_by
       ORDER BY e.expense_date DESC, e.id DESC`
    );
    return sendJson(res, 200, { expenses });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/finance/expenses') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const category = cleanText(body.category);
    const amount = parseMoney(body.amount);
    const expenseDate = cleanText(body.date) || new Date().toISOString().slice(0, 10);
    if (!category || amount === null || amount <= 0) {
      return sendJson(res, 400, { error: 'Category and a positive amount are required' });
    }
    const inserted = run(
      `INSERT INTO expenses (category, description, amount, expense_date, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      category, cleanText(body.description), amount, expenseDate, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true, id: Number(inserted.lastInsertRowid) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/finance/income') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const income = all(
      `SELECT i.id, i.category, i.description, i.amount, i.income_date AS incomeDate,
              i.recorded_by AS recordedBy, u.name AS recordedByName, i.created_at AS createdAt
       FROM income_entries i
       JOIN users u ON u.id = i.recorded_by
       ORDER BY i.income_date DESC, i.id DESC`
    );
    return sendJson(res, 200, { income });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/finance/income') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const category = cleanText(body.category);
    const amount = parseMoney(body.amount);
    const incomeDate = cleanText(body.date) || new Date().toISOString().slice(0, 10);
    if (!category || amount === null || amount <= 0) {
      return sendJson(res, 400, { error: 'Category and a positive amount are required' });
    }
    const inserted = run(
      `INSERT INTO income_entries (category, description, amount, income_date, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      category, cleanText(body.description), amount, incomeDate, user.id, new Date().toISOString()
    );
    return sendJson(res, 200, { ok: true, id: Number(inserted.lastInsertRowid) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/finance/analytics') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const expenses = all('SELECT category, amount, expense_date AS date FROM expenses');
    const income = all('SELECT category, amount, income_date AS date FROM income_entries');

    const sum = rows => rows.reduce((total, r) => total + Number(r.amount || 0), 0);
    const byCategory = rows => {
      const map = new Map();
      rows.forEach(r => map.set(r.category, (map.get(r.category) || 0) + Number(r.amount || 0)));
      return [...map.entries()]
        .map(([category, amount]) => ({ category, amount, count: rows.filter(r => r.category === category).length }))
        .sort((a, b) => b.amount - a.amount);
    };
    const byMonth = () => {
      const map = new Map();
      const bump = (rows, key) => rows.forEach(r => {
        const month = String(r.date || '').slice(0, 7);
        if (!month) return;
        if (!map.has(month)) map.set(month, { month, income: 0, expenses: 0 });
        map.get(month)[key] += Number(r.amount || 0);
      });
      bump(income, 'income');
      bump(expenses, 'expenses');
      return [...map.values()]
        .map(row => ({ ...row, net: row.income - row.expenses }))
        .sort((a, b) => a.month.localeCompare(b.month));
    };

    const totalIncome = sum(income);
    const totalExpenses = sum(expenses);

    const todayStr = new Date().toISOString().slice(0, 10);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const onOrAfter = (rows, dateStr) => rows.filter(r => String(r.date || '').slice(0, 10) >= dateStr);
    const onDate = (rows, dateStr) => rows.filter(r => String(r.date || '').slice(0, 10) === dateStr);

    return sendJson(res, 200, {
      totalIncome,
      totalExpenses,
      net: totalIncome - totalExpenses,
      incomeCount: income.length,
      expenseCount: expenses.length,
      expensesByCategory: byCategory(expenses),
      incomeByCategory: byCategory(income),
      monthlyTrend: byMonth(),
      today: { income: sum(onDate(income, todayStr)), expenses: sum(onDate(expenses, todayStr)) },
      last30Days: { income: sum(onOrAfter(income, since30)), expenses: sum(onOrAfter(expenses, since30)) },
    });
  }

  // ── FINANCE: STORE & INVENTORY ────────────────────────────────────────
  function storeProductRowMap(row) {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      categoryId: row.category_id,
      categoryName: row.categoryName || null,
      price: row.price,
      cost: row.cost,
      unit: row.unit,
      stockQty: row.stock_qty,
      reorderLevel: row.reorder_level,
      isActive: !!row.is_active,
      lowStock: row.stock_qty <= row.reorder_level,
      createdAt: row.created_at,
    };
  }
  function fetchStoreProducts() {
    return all(
      `SELECT p.*, c.name AS categoryName FROM store_products p
       LEFT JOIN store_categories c ON c.id = p.category_id ORDER BY p.name`
    ).map(storeProductRowMap);
  }
  function fetchStoreProduct(id) {
    const row = one(
      `SELECT p.*, c.name AS categoryName FROM store_products p
       LEFT JOIN store_categories c ON c.id = p.category_id WHERE p.id = ?`,
      id
    );
    return row ? storeProductRowMap(row) : null;
  }
  function nextStoreOrderNo() {
    const count = one('SELECT COUNT(*) AS c FROM store_orders').c;
    return `ORD-${String(count + 1).padStart(4, '0')}`;
  }
  function fetchStoreOrders() {
    return all(
      `SELECT o.*, (SELECT COUNT(*) FROM store_order_items i WHERE i.order_id = o.id) AS itemCount
       FROM store_orders o ORDER BY o.created_at DESC`
    ).map(o => ({
      id: o.id,
      orderNo: o.order_no,
      channel: o.channel,
      customerName: o.customer_name,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      paymentMethod: o.payment_method,
      createdBy: o.created_by,
      createdAt: o.created_at,
      itemCount: o.itemCount,
    }));
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/categories') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const categories = all(
      `SELECT c.id, c.name, c.description,
              (SELECT COUNT(*) FROM store_products p WHERE p.category_id = c.id) AS productCount
       FROM store_categories c ORDER BY c.name`
    );
    return sendJson(res, 200, { categories });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/store/categories') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Category name is required' });
    try {
      run('INSERT INTO store_categories (name, description) VALUES (?, ?)', name, cleanText(body.description) || null);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A category with that name already exists' });
      throw err;
    }
    return sendJson(res, 201, { ok: true });
  }

  const storeCategoryMatch = url.pathname.match(/^\/api\/admin\/store\/categories\/(\d+)$/);
  if (req.method === 'PUT' && storeCategoryMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Category name is required' });
    run('UPDATE store_categories SET name = ?, description = ? WHERE id = ?', name, cleanText(body.description) || null, Number(storeCategoryMatch[1]));
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && storeCategoryMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM store_categories WHERE id = ?', Number(storeCategoryMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/products') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, { products: fetchStoreProducts() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/store/products') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Product name is required' });
    try {
      const result = run(
        `INSERT INTO store_products (name, sku, category_id, price, cost, unit, stock_qty, reorder_level, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name,
        cleanText(body.sku) || null,
        body.categoryId ? Number(body.categoryId) : null,
        Number(body.price) || 0,
        Number(body.cost) || 0,
        cleanText(body.unit) || 'piece',
        Number(body.stockQty) || 0,
        Number(body.reorderLevel) || 0,
        body.isActive === false ? 0 : 1,
        new Date().toISOString()
      );
      return sendJson(res, 201, { ok: true, product: fetchStoreProduct(Number(result.lastInsertRowid)) });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A product with that SKU already exists' });
      throw err;
    }
  }

  const storeProductMatch = url.pathname.match(/^\/api\/admin\/store\/products\/(\d+)$/);
  if (req.method === 'PUT' && storeProductMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(storeProductMatch[1]);
    if (!fetchStoreProduct(id)) return sendJson(res, 404, { error: 'Product not found' });
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Product name is required' });
    try {
      run(
        `UPDATE store_products SET name = ?, sku = ?, category_id = ?, price = ?, cost = ?, unit = ?, reorder_level = ?, is_active = ? WHERE id = ?`,
        name,
        cleanText(body.sku) || null,
        body.categoryId ? Number(body.categoryId) : null,
        Number(body.price) || 0,
        Number(body.cost) || 0,
        cleanText(body.unit) || 'piece',
        Number(body.reorderLevel) || 0,
        body.isActive === false ? 0 : 1,
        id
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A product with that SKU already exists' });
      throw err;
    }
    return sendJson(res, 200, { ok: true, product: fetchStoreProduct(id) });
  }
  if (req.method === 'DELETE' && storeProductMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM store_products WHERE id = ?', Number(storeProductMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const stockAdjustMatch = url.pathname.match(/^\/api\/admin\/store\/products\/(\d+)\/stock-adjust$/);
  if (req.method === 'POST' && stockAdjustMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(stockAdjustMatch[1]);
    const product = one('SELECT * FROM store_products WHERE id = ?', id);
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    const body = await readJson(req);
    const delta = Number(body.delta);
    const reason = cleanText(body.reason) || 'Manual adjustment';
    if (!Number.isFinite(delta) || delta === 0) return sendJson(res, 400, { error: 'A non-zero adjustment quantity is required' });
    const newQty = product.stock_qty + delta;
    if (newQty < 0) return sendJson(res, 400, { error: 'Adjustment would result in negative stock' });
    db.exec('BEGIN');
    try {
      run('UPDATE store_products SET stock_qty = ? WHERE id = ?', newQty, id);
      run(
        'INSERT INTO store_stock_movements (product_id, change_qty, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        id, delta, reason, user.id, new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJson(res, 200, { ok: true, product: fetchStoreProduct(id) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/stock-movements') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const movements = all(
      `SELECT m.id, m.product_id AS productId, p.name AS productName, m.change_qty AS changeQty,
              m.reason, m.created_by AS createdBy, m.created_at AS createdAt
       FROM store_stock_movements m JOIN store_products p ON p.id = m.product_id
       ORDER BY m.created_at DESC LIMIT 200`
    );
    return sendJson(res, 200, { movements });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/orders') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, { orders: fetchStoreOrders() });
  }

  const storeOrderDetailMatch = url.pathname.match(/^\/api\/admin\/store\/orders\/(\d+)$/);
  if (req.method === 'GET' && storeOrderDetailMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(storeOrderDetailMatch[1]);
    const order = one('SELECT * FROM store_orders WHERE id = ?', id);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });
    const items = all(
      `SELECT id, product_id AS productId, product_name AS productName, unit_price AS unitPrice, qty, line_total AS lineTotal
       FROM store_order_items WHERE order_id = ?`,
      id
    );
    return sendJson(res, 200, {
      order: {
        id: order.id, orderNo: order.order_no, channel: order.channel, customerName: order.customer_name,
        status: order.status, subtotal: order.subtotal, discount: order.discount, total: order.total,
        paymentMethod: order.payment_method, createdBy: order.created_by, createdAt: order.created_at,
      },
      items,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/store/orders') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return sendJson(res, 400, { error: 'At least one order item is required' });

    const resolved = [];
    for (const item of items) {
      const productId = Number(item.productId);
      const qty = Number(item.qty);
      if (!productId || !Number.isFinite(qty) || qty <= 0) {
        return sendJson(res, 400, { error: 'Each item needs a valid product and quantity' });
      }
      const product = one('SELECT * FROM store_products WHERE id = ?', productId);
      if (!product) return sendJson(res, 400, { error: `Product #${productId} not found` });
      if (product.stock_qty < qty) {
        return sendJson(res, 400, { error: `Not enough stock for "${product.name}" (have ${product.stock_qty}, need ${qty})` });
      }
      resolved.push({ product, qty });
    }

    const subtotal = resolved.reduce((sum, r) => sum + r.product.price * r.qty, 0);
    const discount = Math.max(0, Number(body.discount) || 0);
    const total = Math.max(0, subtotal - discount);
    const orderNo = nextStoreOrderNo();
    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
      const orderResult = run(
        `INSERT INTO store_orders (order_no, channel, customer_name, status, subtotal, discount, total, payment_method, created_by, created_at)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
        orderNo,
        cleanText(body.channel) || 'pos',
        cleanText(body.customerName) || 'Walk-in Customer',
        subtotal,
        discount,
        total,
        cleanText(body.paymentMethod) || 'cash',
        user.id,
        now
      );
      const orderId = Number(orderResult.lastInsertRowid);
      resolved.forEach(({ product, qty }) => {
        run(
          `INSERT INTO store_order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)`,
          orderId, product.id, product.name, product.price, qty, product.price * qty
        );
        run('UPDATE store_products SET stock_qty = stock_qty - ? WHERE id = ?', qty, product.id);
        run(
          'INSERT INTO store_stock_movements (product_id, change_qty, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          product.id, -qty, `Sale ${orderNo}`, user.id, now
        );
      });
      db.exec('COMMIT');
      return sendJson(res, 201, { ok: true, orderId, orderNo });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/requisitions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const requisitions = all(
      `SELECT r.id, r.item_description AS itemDescription, r.quantity, r.department, r.reason, r.status,
              r.requested_by AS requestedBy, u.name AS requestedByName, r.created_at AS createdAt,
              r.decided_by AS decidedBy, r.decided_at AS decidedAt
       FROM store_requisitions r LEFT JOIN users u ON u.id = r.requested_by
       ORDER BY r.created_at DESC`
    );
    return sendJson(res, 200, { requisitions });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/store/requisitions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const itemDescription = cleanText(body.itemDescription);
    const quantity = Number(body.quantity);
    if (!itemDescription || !Number.isFinite(quantity) || quantity <= 0) {
      return sendJson(res, 400, { error: 'Item description and a positive quantity are required' });
    }
    run(
      `INSERT INTO store_requisitions (item_description, quantity, department, reason, status, requested_by, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      itemDescription, quantity, cleanText(body.department) || null, cleanText(body.reason) || null, user.id, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }

  const storeRequisitionMatch = url.pathname.match(/^\/api\/admin\/store\/requisitions\/(\d+)$/);
  if (req.method === 'PUT' && storeRequisitionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const status = cleanText((await readJson(req)).status);
    if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
      return sendJson(res, 400, { error: 'Invalid status' });
    }
    run(
      'UPDATE store_requisitions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?',
      status, user.id, new Date().toISOString(), Number(storeRequisitionMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, {
      storeName: valueFromMeta('store_name', 'Little Scholars Store'),
      currency: valueFromMeta('store_currency', 'NGN'),
      lowStockThreshold: Number(valueFromMeta('store_low_stock_threshold', '10')),
      taxRate: Number(valueFromMeta('store_tax_rate', '0')),
      contactEmail: valueFromMeta('store_contact_email', ''),
    });
  }
  if (req.method === 'PUT' && url.pathname === '/api/admin/store/settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    setMeta('store_name', cleanText(body.storeName) || 'Little Scholars Store');
    setMeta('store_currency', cleanText(body.currency) || 'NGN');
    setMeta('store_low_stock_threshold', String(Number(body.lowStockThreshold) || 0));
    setMeta('store_tax_rate', String(Number(body.taxRate) || 0));
    setMeta('store_contact_email', cleanText(body.contactEmail));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/banners') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const banners = all(
      `SELECT id, title, subtitle, image_url AS imageUrl, link_url AS linkUrl, sort_order AS sortOrder,
              is_active AS isActive, created_at AS createdAt FROM store_banners ORDER BY sort_order, id`
    ).map(b => ({ ...b, isActive: !!b.isActive }));
    return sendJson(res, 200, { banners });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/store/banners') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    if (!title) return sendJson(res, 400, { error: 'Banner title is required' });
    run(
      `INSERT INTO store_banners (title, subtitle, image_url, link_url, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      title, cleanText(body.subtitle) || null, cleanText(body.imageUrl) || null, cleanText(body.linkUrl) || null,
      Number(body.sortOrder) || 0, body.isActive === false ? 0 : 1, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }
  const storeBannerMatch = url.pathname.match(/^\/api\/admin\/store\/banners\/(\d+)$/);
  if (req.method === 'PUT' && storeBannerMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    if (!title) return sendJson(res, 400, { error: 'Banner title is required' });
    run(
      `UPDATE store_banners SET title = ?, subtitle = ?, image_url = ?, link_url = ?, sort_order = ?, is_active = ? WHERE id = ?`,
      title, cleanText(body.subtitle) || null, cleanText(body.imageUrl) || null, cleanText(body.linkUrl) || null,
      Number(body.sortOrder) || 0, body.isActive === false ? 0 : 1, Number(storeBannerMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && storeBannerMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM store_banners WHERE id = ?', Number(storeBannerMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/homepage-sections') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const sections = all(
      `SELECT id, title, section_type AS sectionType, content, sort_order AS sortOrder,
              is_active AS isActive, created_at AS createdAt FROM store_homepage_sections ORDER BY sort_order, id`
    ).map(s => ({ ...s, isActive: !!s.isActive }));
    return sendJson(res, 200, { sections });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/store/homepage-sections') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    if (!title) return sendJson(res, 400, { error: 'Section title is required' });
    run(
      `INSERT INTO store_homepage_sections (title, section_type, content, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      title, cleanText(body.sectionType) || 'custom', cleanText(body.content) || null,
      Number(body.sortOrder) || 0, body.isActive === false ? 0 : 1, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }
  const storeSectionMatch = url.pathname.match(/^\/api\/admin\/store\/homepage-sections\/(\d+)$/);
  if (req.method === 'PUT' && storeSectionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const title = cleanText(body.title);
    if (!title) return sendJson(res, 400, { error: 'Section title is required' });
    run(
      `UPDATE store_homepage_sections SET title = ?, section_type = ?, content = ?, sort_order = ?, is_active = ? WHERE id = ?`,
      title, cleanText(body.sectionType) || 'custom', cleanText(body.content) || null,
      Number(body.sortOrder) || 0, body.isActive === false ? 0 : 1, Number(storeSectionMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && storeSectionMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM store_homepage_sections WHERE id = ?', Number(storeSectionMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/store/storefront') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const products = fetchStoreProducts().filter(p => p.isActive);
    const banners = all(
      `SELECT id, title, subtitle, image_url AS imageUrl, link_url AS linkUrl FROM store_banners WHERE is_active = 1 ORDER BY sort_order, id`
    );
    const sections = all(
      `SELECT id, title, section_type AS sectionType, content FROM store_homepage_sections WHERE is_active = 1 ORDER BY sort_order, id`
    );
    const categories = all('SELECT id, name FROM store_categories ORDER BY name');
    return sendJson(res, 200, {
      storeName: valueFromMeta('store_name', 'Little Scholars Store'),
      currency: valueFromMeta('store_currency', 'NGN'),
      banners,
      sections,
      categories,
      products,
    });
  }

  // ── FINANCE: ACCOUNTING ───────────────────────────────────────────────
  function fetchAcctAccounts() {
    return all('SELECT id, code, name, type, normal_balance AS normalBalance, is_active AS isActive FROM acct_accounts ORDER BY code')
      .map(a => ({ ...a, isActive: !!a.isActive }));
  }
  function nextJournalEntryNo() {
    const count = one('SELECT COUNT(*) AS c FROM acct_journal_entries').c;
    return `JE-${String(count + 1).padStart(4, '0')}`;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/accounts') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    return sendJson(res, 200, { accounts: fetchAcctAccounts() });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/accounts') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const code = cleanText(body.code);
    const name = cleanText(body.name);
    const type = cleanText(body.type);
    const normalBalance = cleanText(body.normalBalance);
    if (!code || !name) return sendJson(res, 400, { error: 'Account code and name are required' });
    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) {
      return sendJson(res, 400, { error: 'Account type is invalid' });
    }
    if (!['debit', 'credit'].includes(normalBalance)) {
      return sendJson(res, 400, { error: 'Normal balance must be debit or credit' });
    }
    try {
      run(
        'INSERT INTO acct_accounts (code, name, type, normal_balance, is_active) VALUES (?, ?, ?, ?, ?)',
        code, name, type, normalBalance, body.isActive === false ? 0 : 1
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'An account with that code already exists' });
      throw err;
    }
    return sendJson(res, 201, { ok: true });
  }
  const acctAccountMatch = url.pathname.match(/^\/api\/admin\/acct\/accounts\/(\d+)$/);
  if (req.method === 'PUT' && acctAccountMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Account name is required' });
    run(
      'UPDATE acct_accounts SET name = ?, is_active = ? WHERE id = ?',
      name, body.isActive === false ? 0 : 1, Number(acctAccountMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctAccountMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const id = Number(acctAccountMatch[1]);
    const used = one('SELECT COUNT(*) AS c FROM acct_journal_lines WHERE account_id = ?', id).c;
    if (used > 0) return sendJson(res, 400, { error: 'This account has journal entries posted to it and cannot be deleted' });
    run('DELETE FROM acct_accounts WHERE id = ?', id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/journal-entries') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const entries = all(
      `SELECT je.id, je.entry_no AS entryNo, je.entry_date AS entryDate, je.memo, je.created_by AS createdBy, je.created_at AS createdAt
       FROM acct_journal_entries je ORDER BY je.entry_date DESC, je.id DESC`
    );
    const lines = all(
      `SELECT jl.id, jl.entry_id AS entryId, jl.account_id AS accountId, a.code AS accountCode, a.name AS accountName,
              jl.debit, jl.credit, jl.description
       FROM acct_journal_lines jl JOIN acct_accounts a ON a.id = jl.account_id`
    );
    const withLines = entries.map(e => ({
      ...e,
      lines: lines.filter(l => l.entryId === e.id),
      totalDebit: lines.filter(l => l.entryId === e.id).reduce((s, l) => s + l.debit, 0),
    }));
    return sendJson(res, 200, { entries: withLines });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/acct/journal-entries') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const entryDate = cleanText(body.date) || new Date().toISOString().slice(0, 10);
    const memo = cleanText(body.memo);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length < 2) return sendJson(res, 400, { error: 'A journal entry needs at least two lines' });

    let totalDebit = 0;
    let totalCredit = 0;
    const cleanLines = [];
    for (const line of lines) {
      const accountId = Number(line.accountId);
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (!accountId) return sendJson(res, 400, { error: 'Every line needs an account' });
      if (debit < 0 || credit < 0) return sendJson(res, 400, { error: 'Amounts cannot be negative' });
      if ((debit > 0) === (credit > 0)) return sendJson(res, 400, { error: 'Each line must have either a debit or a credit amount (not both, not neither)' });
      if (!one('SELECT id FROM acct_accounts WHERE id = ?', accountId)) return sendJson(res, 400, { error: `Account #${accountId} not found` });
      totalDebit += debit;
      totalCredit += credit;
      cleanLines.push({ accountId, debit, credit, description: cleanText(line.description) });
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return sendJson(res, 400, { error: `Entry is not balanced: total debit ${totalDebit.toFixed(2)} vs total credit ${totalCredit.toFixed(2)}` });
    }

    const entryNo = nextJournalEntryNo();
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const result = run(
        'INSERT INTO acct_journal_entries (entry_no, entry_date, memo, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        entryNo, entryDate, memo, user.id, now
      );
      const entryId = Number(result.lastInsertRowid);
      cleanLines.forEach(l => run(
        'INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)',
        entryId, l.accountId, l.debit, l.credit, l.description
      ));
      db.exec('COMMIT');
      return sendJson(res, 201, { ok: true, entryId, entryNo });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const acctEntryMatch = url.pathname.match(/^\/api\/admin\/acct\/journal-entries\/(\d+)$/);
  if (req.method === 'DELETE' && acctEntryMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_journal_entries WHERE id = ?', Number(acctEntryMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/ledger') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const accountId = Number(url.searchParams.get('accountId'));
    if (!accountId) return sendJson(res, 400, { error: 'accountId is required' });
    const account = one('SELECT id, code, name, type, normal_balance AS normalBalance FROM acct_accounts WHERE id = ?', accountId);
    if (!account) return sendJson(res, 404, { error: 'Account not found' });
    const lines = all(
      `SELECT jl.id, je.entry_no AS entryNo, je.entry_date AS entryDate, je.memo AS entryMemo, jl.debit, jl.credit, jl.description
       FROM acct_journal_lines jl JOIN acct_journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = ? ORDER BY je.entry_date, je.id, jl.id`,
      accountId
    );
    let balance = 0;
    const rows = lines.map(l => {
      balance += account.normalBalance === 'debit' ? (l.debit - l.credit) : (l.credit - l.debit);
      return { ...l, runningBalance: balance };
    });
    return sendJson(res, 200, { account, lines: rows, closingBalance: balance });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/trial-balance') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = fetchAcctAccounts().map(a => {
      const sums = one('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM acct_journal_lines WHERE account_id = ?', a.id);
      totalDebit += sums.d;
      totalCredit += sums.c;
      return { ...a, totalDebit: sums.d, totalCredit: sums.c };
    });
    return sendJson(res, 200, { accounts: rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/financial-reports') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const rows = all(
      `SELECT a.type, COALESCE(SUM(jl.debit),0) AS totalDebit, COALESCE(SUM(jl.credit),0) AS totalCredit
       FROM acct_accounts a LEFT JOIN acct_journal_lines jl ON jl.account_id = a.id GROUP BY a.type`
    );
    const byType = {};
    rows.forEach(r => { byType[r.type] = { totalDebit: r.totalDebit, totalCredit: r.totalCredit }; });
    const g = t => byType[t] || { totalDebit: 0, totalCredit: 0 };
    const totalIncome = g('income').totalCredit - g('income').totalDebit;
    const totalExpense = g('expense').totalDebit - g('expense').totalCredit;
    const totalAssets = g('asset').totalDebit - g('asset').totalCredit;
    const totalLiabilities = g('liability').totalCredit - g('liability').totalDebit;
    const totalEquity = g('equity').totalCredit - g('equity').totalDebit;
    const hasData = one('SELECT COUNT(*) AS c FROM acct_journal_lines').c > 0;
    return sendJson(res, 200, {
      hasData,
      totalIncome, totalExpense, netIncome: totalIncome - totalExpense,
      totalAssets, totalLiabilities, totalEquity,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/contacts') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const contacts = all('SELECT id, name, type, email, phone, address, created_at AS createdAt FROM acct_contacts ORDER BY name');
    return sendJson(res, 200, { contacts });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/contacts') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    const type = cleanText(body.type) || 'vendor';
    if (!name) return sendJson(res, 400, { error: 'Contact name is required' });
    if (!['vendor', 'customer'].includes(type)) return sendJson(res, 400, { error: 'Contact type must be vendor or customer' });
    run(
      'INSERT INTO acct_contacts (name, type, email, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      name, type, cleanText(body.email) || null, cleanText(body.phone) || null, cleanText(body.address) || null, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }
  const acctContactMatch = url.pathname.match(/^\/api\/admin\/acct\/contacts\/(\d+)$/);
  if (req.method === 'PUT' && acctContactMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const name = cleanText(body.name);
    if (!name) return sendJson(res, 400, { error: 'Contact name is required' });
    run(
      'UPDATE acct_contacts SET name = ?, type = ?, email = ?, phone = ?, address = ? WHERE id = ?',
      name, cleanText(body.type) || 'vendor', cleanText(body.email) || null, cleanText(body.phone) || null,
      cleanText(body.address) || null, Number(acctContactMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctContactMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_contacts WHERE id = ?', Number(acctContactMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/bills') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const bills = all(
      `SELECT b.id, b.contact_id AS contactId, c.name AS contactName, b.doc_no AS docNo, b.doc_type AS docType,
              b.issue_date AS issueDate, b.due_date AS dueDate, b.amount, b.status, b.notes, b.created_at AS createdAt
       FROM acct_bills b LEFT JOIN acct_contacts c ON c.id = b.contact_id ORDER BY b.issue_date DESC, b.id DESC`
    );
    return sendJson(res, 200, { bills });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/bills') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const docType = cleanText(body.docType) || 'bill';
    const issueDate = cleanText(body.issueDate) || new Date().toISOString().slice(0, 10);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'A positive amount is required' });
    if (!['bill', 'invoice'].includes(docType)) return sendJson(res, 400, { error: 'Document type must be bill or invoice' });
    run(
      `INSERT INTO acct_bills (contact_id, doc_no, doc_type, issue_date, due_date, amount, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      body.contactId ? Number(body.contactId) : null, cleanText(body.docNo) || null, docType, issueDate,
      cleanText(body.dueDate) || null, amount, cleanText(body.status) || 'unpaid', cleanText(body.notes) || null, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }
  const acctBillMatch = url.pathname.match(/^\/api\/admin\/acct\/bills\/(\d+)$/);
  if (req.method === 'PUT' && acctBillMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'A positive amount is required' });
    run(
      `UPDATE acct_bills SET contact_id = ?, doc_no = ?, doc_type = ?, issue_date = ?, due_date = ?, amount = ?, status = ?, notes = ? WHERE id = ?`,
      body.contactId ? Number(body.contactId) : null, cleanText(body.docNo) || null, cleanText(body.docType) || 'bill',
      cleanText(body.issueDate), cleanText(body.dueDate) || null, amount, cleanText(body.status) || 'unpaid',
      cleanText(body.notes) || null, Number(acctBillMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctBillMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_bills WHERE id = ?', Number(acctBillMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/budgets') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const budgets = all(
      `SELECT b.id, b.account_id AS accountId, a.code AS accountCode, a.name AS accountName, a.normal_balance AS normalBalance,
              b.period_label AS periodLabel, b.amount, b.notes
       FROM acct_budgets b JOIN acct_accounts a ON a.id = b.account_id ORDER BY b.period_label, a.code`
    ).map(b => {
      const sums = one('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM acct_journal_lines WHERE account_id = ?', b.accountId);
      const actual = b.normalBalance === 'debit' ? sums.d - sums.c : sums.c - sums.d;
      return { ...b, actual, variance: b.amount - actual };
    });
    return sendJson(res, 200, { budgets });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/budgets') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const accountId = Number(body.accountId);
    const periodLabel = cleanText(body.periodLabel);
    const amount = Number(body.amount);
    if (!accountId || !periodLabel || !Number.isFinite(amount)) {
      return sendJson(res, 400, { error: 'Account, period, and amount are required' });
    }
    run('INSERT INTO acct_budgets (account_id, period_label, amount, notes) VALUES (?, ?, ?, ?)', accountId, periodLabel, amount, cleanText(body.notes) || null);
    return sendJson(res, 201, { ok: true });
  }
  const acctBudgetMatch = url.pathname.match(/^\/api\/admin\/acct\/budgets\/(\d+)$/);
  if (req.method === 'PUT' && acctBudgetMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) return sendJson(res, 400, { error: 'A valid amount is required' });
    run(
      'UPDATE acct_budgets SET account_id = ?, period_label = ?, amount = ?, notes = ? WHERE id = ?',
      Number(body.accountId), cleanText(body.periodLabel), amount, cleanText(body.notes) || null, Number(acctBudgetMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctBudgetMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_budgets WHERE id = ?', Number(acctBudgetMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/bank-transactions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const transactions = all(
      `SELECT id, txn_date AS txnDate, description, amount, txn_type AS txnType, reconciled, created_at AS createdAt
       FROM acct_bank_transactions ORDER BY txn_date DESC, id DESC`
    ).map(t => ({ ...t, reconciled: !!t.reconciled }));
    return sendJson(res, 200, { transactions });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/bank-transactions') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const amount = Number(body.amount);
    const txnType = cleanText(body.txnType);
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'A positive amount is required' });
    if (!['debit', 'credit'].includes(txnType)) return sendJson(res, 400, { error: 'Transaction type must be debit or credit' });
    run(
      `INSERT INTO acct_bank_transactions (txn_date, description, amount, txn_type, reconciled, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
      cleanText(body.txnDate) || new Date().toISOString().slice(0, 10), cleanText(body.description) || null, amount, txnType, new Date().toISOString()
    );
    return sendJson(res, 201, { ok: true });
  }
  const acctBankTxnMatch = url.pathname.match(/^\/api\/admin\/acct\/bank-transactions\/(\d+)$/);
  if (req.method === 'PUT' && acctBankTxnMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    run(
      'UPDATE acct_bank_transactions SET reconciled = ? WHERE id = ?',
      body.reconciled ? 1 : 0, Number(acctBankTxnMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctBankTxnMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_bank_transactions WHERE id = ?', Number(acctBankTxnMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/acct/tax-records') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const records = all(
      `SELECT id, period_label AS periodLabel, tax_type AS taxType, amount_due AS amountDue, amount_paid AS amountPaid,
              status, due_date AS dueDate, notes FROM acct_tax_records ORDER BY due_date DESC, id DESC`
    );
    return sendJson(res, 200, { records });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/acct/tax-records') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    const periodLabel = cleanText(body.periodLabel);
    const taxType = cleanText(body.taxType);
    if (!periodLabel || !taxType) return sendJson(res, 400, { error: 'Period and tax type are required' });
    run(
      `INSERT INTO acct_tax_records (period_label, tax_type, amount_due, amount_paid, status, due_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      periodLabel, taxType, Number(body.amountDue) || 0, Number(body.amountPaid) || 0,
      cleanText(body.status) || 'pending', cleanText(body.dueDate) || null, cleanText(body.notes) || null
    );
    return sendJson(res, 201, { ok: true });
  }
  const acctTaxMatch = url.pathname.match(/^\/api\/admin\/acct\/tax-records\/(\d+)$/);
  if (req.method === 'PUT' && acctTaxMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    run(
      `UPDATE acct_tax_records SET period_label = ?, tax_type = ?, amount_due = ?, amount_paid = ?, status = ?, due_date = ?, notes = ? WHERE id = ?`,
      cleanText(body.periodLabel), cleanText(body.taxType), Number(body.amountDue) || 0, Number(body.amountPaid) || 0,
      cleanText(body.status) || 'pending', cleanText(body.dueDate) || null, cleanText(body.notes) || null, Number(acctTaxMatch[1])
    );
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && acctTaxMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    run('DELETE FROM acct_tax_records WHERE id = ?', Number(acctTaxMatch[1]));
    return sendJson(res, 200, { ok: true });
  }
  // ── END FINANCE: STORE & INVENTORY / ACCOUNTING ────────────────────────


  return sendJson(res, 404, { error: 'API route not found' });
}

function adminSetupPayload() {
  const academic = activeAcademic();
  const classes = all(
    `SELECT c.code, c.label, c.category, c.archived,
            (SELECT COUNT(*) FROM students st WHERE st.class_code = c.code) AS studentCount
     FROM classes c
     ORDER BY c.code`
  ).map(row => ({ ...row, archived: !!row.archived }));
  const classCategories = all('SELECT name FROM class_categories ORDER BY name').map(row => row.name);
  const classArms = all(
    `SELECT ca.id, ca.class_code AS classCode, c.label AS classLabel, ca.name,
            ca.form_teacher_id AS formTeacherId, u.name AS formTeacherName,
            (SELECT COUNT(*) FROM students st WHERE st.class_code = ca.class_code) AS studentCount
     FROM class_arms ca
     JOIN classes c ON c.code = ca.class_code
     LEFT JOIN users u ON u.id = ca.form_teacher_id
     ORDER BY c.code, ca.name`
  );
  const subjectTypes = all('SELECT name FROM subject_types ORDER BY name').map(row => row.name);
  const subjects = all('SELECT id, name, code, type FROM subjects ORDER BY name');
  const classSubjects = all(
    `SELECT cs.id, cs.subject_id AS subjectId, s.name AS subjectName, s.code AS subjectCode,
            cs.class_code AS classCode, c.label AS classLabel,
            cs.class_arm_id AS classArmId, ca.name AS classArmName,
            cs.term, cs.pass_mark AS passMark, cs.full_mark AS fullMark, cs.attributes,
            cs.teacher_in_charge_id AS teacherInChargeId, tic.name AS teacherInChargeName,
            cs.assisting_teacher_ids AS assistingTeacherIds
     FROM class_subjects cs
     JOIN subjects s ON s.id = cs.subject_id
     JOIN classes c ON c.code = cs.class_code
     LEFT JOIN class_arms ca ON ca.id = cs.class_arm_id
     LEFT JOIN users tic ON tic.id = cs.teacher_in_charge_id
     ORDER BY s.name, c.code`
  ).map(row => ({
    ...row,
    assistingTeacherNames: (row.assistingTeacherIds || '')
      .split(',')
      .filter(Boolean)
      .map(id => one('SELECT name FROM users WHERE id = ?', id)?.name || id)
      .join(', '),
  }));
  const students = all(
    `SELECT st.id, st.name, st.initials, st.gender, st.avg, st.att, st.class_code AS classCode,
            st.parent_email AS parentEmail, st.photo_path AS photoPath, u.active AS active,
            st.class_arm_id AS classArmId, ca.name AS classArmName
     FROM students st
     LEFT JOIN users u ON u.id = st.id
     LEFT JOIN class_arms ca ON ca.id = st.class_arm_id
     ORDER BY st.class_code, st.name`
  ).map(row => ({ ...row, active: row.active == null ? true : !!row.active }));
  const teachers = all(
    `SELECT id, name, first_name AS firstName, initials, teacher_type AS teacherType, chip,
            signature_path AS signaturePath
     FROM users
     WHERE role = 'teacher'
     ORDER BY name`
  );
  const staff = all(
    `SELECT id, name, initials, role, teacher_type AS teacherType, active
     FROM users
     WHERE role IN ('teacher', 'admin')
     ORDER BY role DESC, name`
  ).map(row => ({
    ...row,
    roleLabel: row.role === 'admin'
      ? 'Administrator'
      : row.teacherType === 'subject_teacher'
        ? 'Subject Teacher'
        : 'Class Teacher',
    department: row.role === 'admin' ? 'admin' : 'academic',
    active: !!row.active,
    status: row.active ? 'Active' : 'Deactivated',
  }));
  const assignments = all(
    `SELECT
       ta.id,
       ta.teacher_id AS teacherId,
       u.name AS teacherName,
       ta.teacher_type AS teacherType,
       ta.class_code AS classCode,
       c.label AS classLabel,
       s.id AS subjectId,
       s.name AS subjectName
     FROM teacher_assignments ta
     JOIN users u ON u.id = ta.teacher_id
     JOIN classes c ON c.code = ta.class_code
     JOIN subjects s ON s.id = ta.subject_id
     ORDER BY u.name, c.code, s.name`
  );
  const resultBatches = all(
    `SELECT
       rb.id,
       rb.class_code AS classCode,
       c.label AS classLabel,
       rb.exam_type AS examType,
       rb.saved_at AS savedAtIso,
       rb.vetted_at AS vettedAtIso,
       s.name AS subjectName,
       u.name AS teacherName,
       COUNT(re.id) AS entryCount
     FROM result_batches rb
     JOIN classes c ON c.code = rb.class_code
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     LEFT JOIN result_entries re ON re.batch_id = rb.id
     WHERE rb.academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)
     GROUP BY rb.id
     ORDER BY rb.class_code, rb.exam_type, s.name`
  ).map(row => ({
    ...row,
    savedAt: formatSavedAt(row.savedAtIso),
    vettedAt: row.vettedAtIso ? formatSavedAt(row.vettedAtIso) : '',
  }));
  const publications = all(
    `SELECT
       rp.id,
       rp.student_id AS studentId,
       st.name AS studentName,
       rp.class_code AS classCode,
       rp.exam_type AS examType,
       rp.parent_email AS parentEmail,
       rp.email_status AS emailStatus,
       rp.email_error AS emailError,
       rp.published_at AS publishedAtIso,
       u.name AS publishedByName
     FROM report_publications rp
     JOIN students st ON st.id = rp.student_id
     JOIN users u ON u.id = rp.published_by
     ORDER BY rp.published_at DESC
     LIMIT 80`
  ).map(row => ({
    ...row,
    publishedAt: formatSavedAt(row.publishedAtIso),
  }));
  const settings = {
    headOfSchoolName: valueFromMeta('head_of_school_name', 'James Idoko Ajah'),
    headSignaturePath: valueFromMeta('head_signature_path', ''),
    nextTermBegins: valueFromMeta('next_term_begins', 'MONDAY 27TH APRIL, 2026'),
  };
  const schoolInfo = {
    name: valueFromMeta('school_name', 'UNIQUE CHILDREN SCHOOL'),
    address: valueFromMeta('school_address', 'Block 12, Plot 350 Norus Close, Omole Estate Phase 1'),
    phone: valueFromMeta('school_phone', '08034106866'),
    email: valueFromMeta('school_email', 'info@uniquegroupofschools.com'),
    website: valueFromMeta('school_website', 'uniquegroupofschools.com'),
  };

  return { academic, classes, classCategories, classArms, subjects, subjectTypes, classSubjects, students, teachers, staff, assignments, resultBatches, publications, settings, schoolInfo, emailConfig: smtpConfigStatus(), examTypes: EXAM_TYPES };
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const filePath = path.resolve(ROOT, `.${pathname}`);
  // Only web assets are ever served. The database, .env/secrets, source
  // (server.js), .git, node_modules, backups and generated PDFs all live under
  // ROOT too, so anything not on this allowlist — or inside a dot-folder — is
  // refused outright.
  const relParts = path.relative(ROOT, filePath).split(path.sep);
  const publicExt = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp']);
  const blocked = !filePath.startsWith(ROOT + path.sep)
    || relParts.some(part => part.startsWith('.') || part === 'node_modules')
    || relParts[relParts.length - 1] === 'server.js'
    || !publicExt.has(path.extname(filePath).toLowerCase());
  if (blocked) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Server error', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Unique Children's School portal running at http://localhost:${PORT}`);
});
