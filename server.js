const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
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

const DB_PATH = path.join(ROOT, 'school.sqlite');
const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'ls_session';
const EXAM_TYPES = ['Continuous Assessment', 'Mid-Term Exam', 'Final Exam'];
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
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const REPORT_DIR = path.join(ROOT, 'published_reports');

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

function cleanText(value) {
  return String(value || '').trim();
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

function createSchema() {
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
  `);
  ensureColumn('users', 'signature_path', 'TEXT');
  ensureColumn('students', 'parent_email', 'TEXT');
  ensureColumn('students', 'photo_path', 'TEXT');
  ensureColumn('result_batches', 'vetted_at', 'TEXT');
  ensureColumn('result_batches', 'vetted_by', 'TEXT REFERENCES users(id)');
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
    users.forEach(u => run(
      `INSERT INTO users (id, role, password, name, first_name, initials, teacher_type, chip, grade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...u
    ));

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
      ['STU-2024-0421', 22, 62, 84],
      ['STU-2024-0388', 18, 58, 76],
      ['STU-2024-0412', 24, 66, 90],
      ['STU-2024-0430', 19, 53, 72],
      ['STU-2024-0441', 15, 46, 61],
      ['STU-2024-0455', 28, 64, 92],
      ['STU-2024-0460', 12, 38, 50],
      ['STU-2024-0471', 21, 59, 80],
      ['STU-2024-0482', 17, 51, 68],
      ['STU-2024-0493', 26, 62, 88],
      ['STU-2024-0504', 20, 54, 74],
      ['STU-2024-0515', 23, 61, 84],
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

createSchema();
seedDatabase();

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

function activeAcademic() {
  return one('SELECT id, session_label AS sessionLabel, term_label AS termLabel FROM academic_terms WHERE is_active = 1');
}

function studentRowsForClass(classCode) {
  return all(
    `SELECT id, name, initials, gender, avg, att, class_code AS classCode
     FROM students
     WHERE class_code = ?
     ORDER BY name`,
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
  if (!batch) return { savedAt: '', savedAtIso: '', entries: {} };
  const entries = {};
  all(
    `SELECT student_id AS studentId, ca_score AS ca, exam_score AS exam, total_score AS total
     FROM result_entries
     WHERE batch_id = ?
     ORDER BY student_id`,
    batch.id
  ).forEach(row => {
    entries[row.studentId] = {
      ca: row.ca,
      exam: row.exam,
      total: row.total,
    };
  });
  return {
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
  const candidates = [
    path.join(ROOT, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.js'),
    'C:\\Users\\Emmanuel Okoroafor\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\pdf-lib\\dist\\pdf-lib.js',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('pdf-lib is required to generate report PDFs');
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
  const exam = examType === 'Mid-Term Exam'
    ? 'MID TERM REPORT'
    : examType === 'Final Exam'
      ? 'FINAL REPORT'
      : 'CONTINUOUS ASSESSMENT REPORT';
  return `${term}, ${session} (${exam})`;
}

function performanceGrade(avg) {
  if (avg >= 80) return 'A (Excellent)';
  if (avg >= 70) return 'B (Very Good)';
  if (avg >= 50) return 'C (Good)';
  if (avg >= 40) return 'D (Fair)';
  return 'F (Needs Support)';
}

function classReportRows(classCode, examType, studentId) {
  return all(
    `SELECT
       rb.id AS batchId,
       rb.vetted_at AS vettedAt,
       s.name AS subjectName,
       u.name AS teacherName,
       u.signature_path AS teacherSignaturePath,
       re.ca_score AS ca,
       re.exam_score AS exam,
       re.total_score AS total
     FROM result_batches rb
     JOIN result_entries re ON re.batch_id = rb.id
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     WHERE rb.class_code = ?
       AND rb.exam_type = ?
       AND re.student_id = ?
       AND rb.academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)
     ORDER BY s.name`,
    classCode,
    examType,
    studentId
  );
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

function adminBatchReview(batchId) {
  const batch = one(
    `SELECT
       rb.id,
       rb.class_code AS classCode,
       c.label AS classLabel,
       rb.exam_type AS examType,
       rb.saved_at AS savedAtIso,
       rb.vetted_at AS vettedAtIso,
       rb.vetted_by AS vettedBy,
       s.name AS subjectName,
       u.name AS teacherName
     FROM result_batches rb
     JOIN classes c ON c.code = rb.class_code
     JOIN subjects s ON s.id = rb.subject_id
     JOIN users u ON u.id = rb.teacher_id
     WHERE rb.id = ?
       AND rb.academic_id = (SELECT id FROM academic_terms WHERE is_active = 1)`,
    Number(batchId)
  );
  if (!batch) return null;
  const entries = all(
    `SELECT
       st.id AS studentId,
       st.name AS studentName,
       st.gender,
       re.ca_score AS ca,
       re.exam_score AS exam,
       re.total_score AS total
     FROM result_entries re
     JOIN students st ON st.id = re.student_id
     WHERE re.batch_id = ?
     ORDER BY st.name`,
    Number(batchId)
  );
  return {
    ...batch,
    savedAt: formatSavedAt(batch.savedAtIso),
    vettedAt: batch.vettedAtIso ? formatSavedAt(batch.vettedAtIso) : '',
    entries,
    entryCount: entries.length,
  };
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
  if (examType === 'Mid-Term Exam') return ['Mid Term Test (40)', 'Examination (60)'];
  if (examType === 'Continuous Assessment') return ['CA (30)', 'Examination (70)'];
  return ['CA (30)', 'Examination (70)'];
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

async function drawWordStudentInfo(page, pdfDoc, student, rows, totalScore, average, fonts, colors) {
  const x = 36;
  const top = 646;
  const widths = [130, 80, 330];
  const rowH = 17;
  const classSize = String(one('SELECT COUNT(*) AS count FROM students WHERE class_code = ?', student.class_code).count);
  const maxScore = rows.length * 100;
  const infoRows = [
    [`Name: ${student.name.toUpperCase()}`, `Performance Grade: ${performanceGrade(average)}`],
    [`Reg. No:${student.id}`, `Class Size: ${classSize}`],
    [`Gender: ${normaliseGender(student.gender)}`, `No. of Subjects: ${rows.length}`],
    [`Age: ${valueFromMeta(`student_age_${student.id}`, '')}`, `Student Total Score: ${totalScore}        ${maxScore}`],
    [`DOB: ${valueFromMeta(`student_dob_${student.id}`, '')}`, `Student Average(%): ${average}%`],
    [`Class: ${student.classLabel}`, ''],
  ];
  infoRows.forEach((row, i) => {
    const rowTop = top - (i * rowH);
    drawWordCell(page, { x, top: rowTop, width: widths[0], height: rowH, value: row[0], fill: colors.white, border: colors.grid, font: fonts.bold, size: 8.2, color: colors.black, pad: 4 });
    drawWordCell(page, { x: x + widths[0] + widths[1], top: rowTop, width: widths[2], height: rowH, value: row[1], fill: colors.white, border: colors.grid, font: fonts.bold, size: 8.2, color: colors.black, pad: 4 });
  });

  drawCell(page, { x: x + widths[0], top, width: widths[1], height: rowH * 6, fill: colors.white, border: colors.grid, borderWidth: 0.35 });
  const photo = await embedImageIfPresent(pdfDoc, student.photo_path) || await embedImageIfPresent(pdfDoc, 'report_assets/student-placeholder.png');
  if (photo) page.drawImage(photo, { x: x + widths[0] + 14, y: top - 75, width: 52, height: 52 });
}

function reportSubjectRows(rows) {
  const out = rows.slice(0, 18).map(row => ({
    subject: row.subjectName,
    ca: row.ca ?? '-',
    exam: row.exam ?? '-',
    total: row.total ?? '-',
  }));
  while (out.length < 18) out.push({ subject: '', ca: '', exam: '', total: '' });
  return out;
}

function drawWordMainTable(page, rows, examType, skillRating, attendance, fonts, colors) {
  const x = 36;
  const top = 530;
  const widths = [115, 55, 55, 60, 170, 85];
  const rowH = 14.75;
  const scoreHeaders = reportScoreColumns(examType).map(label => label.replace(/\s+\(/, '\n('));
  const headers = ['Subject', ...scoreHeaders, 'Total Score\n(100)', 'Affective / Psychomotor Skills', 'Rating'];
  const subjectRows = reportSubjectRows(rows);
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
    drawWordCell(page, {
      x: cursorX,
      top,
      width: widths[i],
      height: rowH,
      value: header,
      fill: colors.headerGrey,
      border: colors.grid,
      font: fonts.bold,
      size: i >= 1 && i <= 3 ? 5.4 : i === 0 ? 8 : 6.8,
      color: colors.black,
      align: 'center',
      pad: 3,
      lineHeight: i >= 1 && i <= 3 ? 6 : 8,
    });
    cursorX += widths[i];
  });

  for (let i = 0; i < 24; i += 1) {
    const rowTop = top - rowH - (i * rowH);
    const subject = i < 18 ? subjectRows[i] : { subject: '', ca: '', exam: '', total: '' };
    let cellX = x;
    [subject.subject, subject.ca, subject.exam, subject.total].forEach((value, col) => {
      drawWordCell(page, {
        x: cellX,
        top: rowTop,
        width: widths[col],
        height: rowH,
        value,
        fill: colors.white,
        border: colors.grid,
        font: col === 3 ? fonts.bold : fonts.regular,
        size: col === 0 ? 7.4 : 7.6,
        color: colors.black,
        align: col === 0 ? 'center' : 'center',
        pad: 3,
      });
      cellX += widths[col];
    });

    const skillX = x + widths[0] + widths[1] + widths[2] + widths[3];
    if (i === 0) {
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4] + widths[5], height: rowH, value: 'Affective Skills Rating   (Scale of 1-to-5)', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'center' });
    } else if (i >= 1 && i <= 8) {
      const row = affective[i - 1];
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4], height: rowH, value: row.label, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
      drawWordCell(page, { x: skillX + widths[4], top: rowTop, width: widths[5], height: rowH, value: row.rating, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    } else if (i === 9) {
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4] + widths[5], height: rowH, value: 'Psychomotor Skills Rating   (Scale of  1-to-5)', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'center' });
    } else if (i >= 10 && i <= 18) {
      const row = psychomotor[i - 10];
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4], height: rowH, value: row.label, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
      drawWordCell(page, { x: skillX + widths[4], top: rowTop, width: widths[5], height: rowH, value: row.rating, fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    } else if (i === 19) {
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4] + widths[5], height: rowH, value: 'Attendance Report', fill: colors.sectionGrey, border: colors.grid, font: fonts.bold, size: 7.8, color: colors.black, align: 'center' });
    } else {
      const row = attendanceRows[i - 20];
      drawWordCell(page, { x: skillX, top: rowTop, width: widths[4], height: rowH, value: row?.[0] || '', fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
      drawWordCell(page, { x: skillX + widths[4], top: rowTop, width: widths[5], height: rowH, value: row?.[1] || '', fill: colors.white, border: colors.grid, font: fonts.regular, size: 7.8, color: colors.black, align: 'center' });
    }
  }
}

function drawWordGradeKey(page, fonts, colors) {
  const x = 36;
  const top = 136;
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

async function drawWordComments(page, pdfDoc, formTeacher, fonts, colors) {
  const x = 36;
  const width = 540;
  const leftW = 324;
  const rightW = 216;
  const rowH = 24;
  const teacherComment = valueFromMeta('teacher_comment_default', 'Well done! Your result is remarkable. Do not relent in your efforts.');
  const headComment = valueFromMeta('head_comment_default', 'Great work! Your diligence in your academics is impressive.');
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
     JOIN users u ON u.id = s.id
     WHERE s.id = ? AND s.class_code = ?`,
    studentId,
    classCode
  );
  if (!student) throw new Error('Student not found for selected class');

  const rows = classReportRows(classCode, examType, studentId);
  if (!rows.length) throw new Error(`No ${examType} results found for ${student.name}`);
  const skillRating = skillRatingForReport(student.id, classCode, examType);

  const rowTotals = rows.map(row => Number(row.total || 0));
  const totalScore = rowTotals.reduce((sum, value) => sum + value, 0);
  const average = rows.length ? Math.round(totalScore / rows.length) : 0;
  const schoolDays = Number(valueFromMeta('school_days', 102));
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
  await drawWordStudentInfo(page1, pdfDoc, student, rows, totalScore, average, fonts, colors);
  drawWordMainTable(page1, rows, examType, skillRating, { schoolDays, present, absent, percent: student.att || 0 }, fonts, colors);
  drawWordGradeKey(page1, fonts, colors);

  const page2 = pdfDoc.addPage([612, 792]);
  await drawWordHeader(page2, pdfDoc, fonts, colors);
  drawWordScoreChart(page2, rows, fonts, colors, degrees);
  await drawWordComments(page2, pdfDoc, formTeacher, fonts, colors);
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

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJson(req);
    const id = String(body.id || '').trim().toUpperCase();
    const password = String(body.password || '');
    const user = one('SELECT * FROM users WHERE id = ?', id);
    if (!user || user.password !== password) {
      return sendJson(res, 401, { error: 'Incorrect ID or password' });
    }

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
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) run('DELETE FROM sessions WHERE token = ?', token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
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
        const ca = normalizeScore(entry.ca, 'CA score', 30);
        let exam = null;
        if (examType !== 'Continuous Assessment') {
          exam = normalizeScore(entry.exam, 'Exam score', 70);
        }
        return {
          studentId,
          ca,
          exam,
          total: examType === 'Continuous Assessment' ? ca : ca + exam,
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

  const batchReviewMatch = url.pathname.match(/^\/api\/admin\/result-batches\/(\d+)$/);
  if (req.method === 'GET' && batchReviewMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const batch = adminBatchReview(Number(batchReviewMatch[1]));
    if (!batch) return sendJson(res, 404, { error: 'Result batch not found' });
    return sendJson(res, 200, { batch });
  }

  const vetMatch = url.pathname.match(/^\/api\/admin\/result-batches\/(\d+)\/vet$/);
  if (req.method === 'POST' && vetMatch) {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const batch = one('SELECT id FROM result_batches WHERE id = ?', Number(vetMatch[1]));
    if (!batch) return sendJson(res, 404, { error: 'Result batch not found' });
    run(
      'UPDATE result_batches SET vetted_at = ?, vetted_by = ? WHERE id = ?',
      new Date().toISOString(),
      user.id,
      batch.id
    );
    return sendJson(res, 200, { ok: true, setup: adminSetupPayload() });
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
    const unvetted = batches.filter(batch => !batch.vettedAt);
    if (unvetted.length) {
      return sendJson(res, 400, { error: `Vet all result batches first: ${unvetted.map(b => b.subjectName).join(', ')}` });
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
    for (const student of students) {
      const pdfBytes = await generateReportPdf({ studentId: student.id, classCode, examType });
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
    return sendJson(res, 200, { ok: true, published, setup: adminSetupPayload() });
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
          ? [name, firstName, initials, `Class ${classCode}`, password, studentId]
          : [name, firstName, initials, `Class ${classCode}`, studentId])
      );
      run(
        `UPDATE students
         SET name = ?, initials = ?, gender = ?, avg = ?, att = ?, class_code = ?, parent_email = ?
             ${photoPath ? ', photo_path = ?' : ''}
         WHERE id = ?`,
        ...(photoPath
          ? [name, initials, gender, avg, att, classCode, parentEmail, photoPath, studentId]
          : [name, initials, gender, avg, att, classCode, parentEmail, studentId])
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
    const id = cleanText(body.id).toUpperCase();
    const name = cleanText(body.name);
    const password = DEFAULT_STUDENT_PASSWORD;
    const gender = cleanText(body.gender).toUpperCase();
    const classCode = cleanText(body.classCode).toUpperCase();
    const initials = cleanText(body.initials).toUpperCase() || initialsFromName(name);
    const firstName = cleanText(body.firstName) || firstNameFromName(name);
    const parentEmail = cleanText(body.parentEmail).toLowerCase();

    if (!id || !name || !classCode) {
      return sendJson(res, 400, { error: 'Student ID, name, and class are required' });
    }
    if (!['F', 'M'].includes(gender)) {
      return sendJson(res, 400, { error: 'Student gender must be F or M' });
    }
    const cls = one('SELECT code, label FROM classes WHERE code = ?', classCode);
    if (!cls) return sendJson(res, 400, { error: 'Class does not exist' });

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
        password,
        name,
        firstName,
        initials,
        `Class ${classCode}`
      );
      run(
        'INSERT INTO students (id, name, initials, gender, avg, att, class_code, parent_email, photo_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        name,
        initials,
        gender,
        avg,
        att,
        classCode,
        parentEmail,
        photoPath
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
        ? [role, name, firstName, initials, role === 'teacher' ? teacherType : null, role === 'teacher' ? name.toUpperCase() : null, password, staffId]
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
        password,
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
    const studentCount = one('SELECT COUNT(*) AS count FROM students WHERE class_code = ?', code).count;
    if (studentCount > 0) {
      return sendJson(res, 400, { error: 'Move or remove students from this class before deleting it' });
    }
    run('DELETE FROM class_arms WHERE class_code = ?', code);
    run('DELETE FROM classes WHERE code = ?', code);
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
    if (!classCode || !examType) return sendJson(res, 400, { error: 'classCode and examType required' });
    const academic = activeAcademic();
    if (!academic) return sendJson(res, 400, { error: 'No active academic term' });

    const students = all(
      `SELECT id, name, initials, gender, att FROM students WHERE class_code = ? ORDER BY name`,
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
      const entries = all(`SELECT student_id AS sid, ca_score AS ca, exam_score AS ex, total_score AS tot FROM result_entries WHERE batch_id = ?`, sub.batchId);
      for (const e of entries) {
        if (!scoreMatrix[e.sid]) scoreMatrix[e.sid] = {};
        scoreMatrix[e.sid][sub.id] = { ca: e.ca, ex: e.ex, tot: e.tot };
      }
    }
    const studentData = students.map(st => {
      let grand = 0; let counted = 0;
      for (const sub of subjects) { const s = scoreMatrix[st.id]?.[sub.id]; if (s) { grand += s.tot; counted++; } }
      const maxPoss = counted * 100;
      return { ...st, grandTotal: grand, maxPossible: maxPoss, avgPct: maxPoss > 0 ? +(grand / maxPoss * 100).toFixed(2) : 0 };
    });
    const sorted = [...studentData].sort((a, b) => b.grandTotal - a.grandTotal);
    const posMap = {};
    sorted.forEach((s, i) => { posMap[s.id] = i + 1; });
    const rankedStudents = studentData.map(s => ({ ...s, position: posMap[s.id] || '—' }));
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
      academic, subjects, students: rankedStudents, scoreMatrix, subjectStats,
      stats: {
        activeStudents: students.length,
        grandTotalSubjectScoreAverages: grandTotalAvgs,
        classScoreAverage: classScoreAvg,
        bestStudent: best ? { name: best.name, grandTotal: `${best.grandTotal} / ${best.maxPossible}`, average: best.avgPct } : null,
      },
    });
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
  ];

  if (req.method === 'GET' && url.pathname === '/api/admin/system-settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const settings = {};
    SYS_KEYS.forEach(k => { settings[k] = valueFromMeta(k, ''); });
    // defaults for empty fields
    if (!settings.school_name)    settings.school_name    = 'Little Scholars';
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
    return sendJson(res, 200, { settings });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/system-settings') {
    const user = requireUser(req, res, 'admin');
    if (!user) return;
    const body = await readJson(req);
    SYS_KEYS.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        setMeta(k, cleanText(String(body[k] ?? '')));
      }
    });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'API route not found' });
}

function adminSetupPayload() {
  const academic = activeAcademic();
  const classes = all(
    `SELECT c.code, c.label, c.category,
            (SELECT COUNT(*) FROM students st WHERE st.class_code = c.code) AS studentCount
     FROM classes c
     ORDER BY c.code`
  );
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
    `SELECT id, name, initials, gender, avg, att, class_code AS classCode,
            parent_email AS parentEmail, photo_path AS photoPath
     FROM students
     ORDER BY class_code, name`
  );
  const teachers = all(
    `SELECT id, name, first_name AS firstName, initials, teacher_type AS teacherType, chip,
            signature_path AS signaturePath
     FROM users
     WHERE role = 'teacher'
     ORDER BY name`
  );
  const staff = all(
    `SELECT id, name, initials, role, teacher_type AS teacherType
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
    status: 'Active',
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
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
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
  console.log(`Little Scholars portal running at http://localhost:${PORT}`);
});
