// Student enrolment: the 5-step Enroll Student wizard, families (parents /
// guardians), Bulk Enroll (Excel), and Self Registration (public forms for
// students, parents and staff, reviewed by the admin before anything is
// created). Mirrors the SchoolsFocus "Enroll Students" section.
//
// server.js passes in its database helpers (ctx) so this file has no state of
// its own beyond the tables it adds.

const crypto = require('node:crypto');
const zlib = require('node:zlib');

module.exports = function createEnrolment(ctx) {
  const {
    db, one, all, run, ensureColumn, valueFromMeta, setMeta, cleanText, readJson, sendJson,
    requireUser, hashPassword, saveDataUrl, adminSetupPayload, initialsFromName, activeAcademic,
    classHasArms, parseXlsxFirstSheet, DEFAULT_STUDENT_PASSWORD, makeStudentIdGenerator,
  } = ctx;

  // ── Schema ────────────────────────────────────────────────────────────
  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parents (
        id INTEGER PRIMARY KEY,
        title TEXT,
        full_name TEXT NOT NULL,
        relationship TEXT,
        relationship_other TEXT,
        occupation TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS families (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent1_id INTEGER REFERENCES parents(id),
        parent2_id INTEGER REFERENCES parents(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS self_registrations (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        name TEXT,
        email TEXT,
        phone TEXT,
        class_label TEXT,
        data TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        note TEXT,
        outcome TEXT
      );
    `);
    [
      ['reg_no', 'TEXT'], ['family_id', 'INTEGER'], ['surname', 'TEXT'], ['first_name', 'TEXT'], ['other_names', 'TEXT'],
      ['student_email', 'TEXT'], ['phone', 'TEXT'], ['dob', 'TEXT'], ['nin', 'TEXT'], ['religion', 'TEXT'],
      ['nationality', 'TEXT'], ['state_origin', 'TEXT'], ['lga_origin', 'TEXT'], ['town_origin', 'TEXT'],
      ['residential_address', 'TEXT'], ['permanent_address', 'TEXT'], ['bio', 'TEXT'], ['roll_no', 'TEXT'],
      ['admission_date', 'TEXT'], ['enrol_session', 'TEXT'], ['blood_group', 'TEXT'], ['genotype', 'TEXT'],
      ['next_of_kin', 'TEXT'], ['emergency_contact', 'TEXT'],
    ].forEach(([col, def]) => ensureColumn('students', col, def));
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_reg_no ON students(reg_no) WHERE reg_no IS NOT NULL');
    migrate();
  }

  // One-off: every pupil gets a registration number in the new format, and
  // pupils sharing a parent email are grouped into one family.
  function migrate() {
    if (valueFromMeta('enrol_regno_migrated', '') !== '1') {
      const year = sessionStartYear(activeAcademic()?.sessionLabel);
      const next = regNoGenerator(year);
      for (const st of all("SELECT id FROM students WHERE reg_no IS NULL OR reg_no = '' ORDER BY COALESCE(enrolled_at, ''), id")) {
        run('UPDATE students SET reg_no = ? WHERE id = ?', next(), st.id);
      }
      setMeta('enrol_regno_migrated', '1');
    }
    if (valueFromMeta('enrol_families_migrated', '') !== '1') {
      const groups = all(`SELECT LOWER(TRIM(parent_email)) AS email, GROUP_CONCAT(id) AS ids, MIN(name) AS name
                          FROM students WHERE parent_email IS NOT NULL AND TRIM(parent_email) <> '' AND family_id IS NULL
                          GROUP BY LOWER(TRIM(parent_email))`);
      for (const g of groups) {
        const surname = (String(g.name || '').trim().split(/\s+/).pop() || 'Family').toUpperCase();
        const now = new Date().toISOString();
        const parent = run('INSERT INTO parents (full_name, relationship, email, created_at) VALUES (?, ?, ?, ?)',
          `MR & MRS ${surname}`, 'Parent', g.email, now);
        const family = run('INSERT INTO families (name, parent1_id, created_at) VALUES (?, ?, ?)',
          `${surname} Family`, Number(parent.lastInsertRowid), now);
        for (const id of String(g.ids).split(',')) run('UPDATE students SET family_id = ? WHERE id = ?', Number(family.lastInsertRowid), id);
      }
      setMeta('enrol_families_migrated', '1');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  const nowIso = () => new Date().toISOString();
  const text = (v, max = 500) => cleanText(v).slice(0, max);

  function sessionStartYear(label) {
    const m = String(label || '').match(/(\d{4})/);
    return m ? m[1] : String(new Date().getFullYear());
  }

  // 2026/000001, 2026/000002 … per enrolment year, continuing from the highest.
  function regNoGenerator(year) {
    let max = 0;
    for (const row of all('SELECT reg_no FROM students WHERE reg_no LIKE ?', `${year}/%`)) {
      const n = Number(String(row.reg_no).split('/')[1]);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return () => `${year}/${String(++max).padStart(6, '0')}`;
  }

  function nextRollNo(classCode, classArmId) {
    const rows = classArmId
      ? all('SELECT roll_no FROM students WHERE class_code = ? AND class_arm_id = ?', classCode, classArmId)
      : all('SELECT roll_no FROM students WHERE class_code = ?', classCode);
    return String(rows.reduce((max, r) => Math.max(max, Number(r.roll_no) || 0), 0) + 1);
  }

  function sessions() {
    const labels = new Set(all('SELECT DISTINCT session_label AS s FROM academic_terms').map(r => r.s));
    const active = activeAcademic()?.sessionLabel;
    if (active) labels.add(active);
    return [...labels].filter(Boolean).sort().reverse();
  }

  function normDate(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' || /^\d{5}(\.\d+)?$/.test(String(value))) {
      // Excel serial date
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(value)) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }

  function normGender(value) {
    const g = String(value || '').trim().toUpperCase();
    if (g === 'M' || g === 'MALE' || g === 'BOY') return 'M';
    if (g === 'F' || g === 'FEMALE' || g === 'GIRL') return 'F';
    return '';
  }

  function cleanContact(c = {}) {
    return { name: text(c.name, 120), relationship: text(c.relationship, 60), phone: text(c.phone, 40), email: text(c.email, 120).toLowerCase(), address: text(c.address, 300) };
  }

  function parentRow(p) {
    return p ? {
      id: p.id, title: p.title || '', fullName: p.full_name, relationship: p.relationship || '', relationshipOther: p.relationship_other || '',
      occupation: p.occupation || '', phone: p.phone || '', email: p.email || '', address: p.address || '',
    } : null;
  }

  function familyList() {
    const parents = new Map(all('SELECT * FROM parents').map(p => [p.id, parentRow(p)]));
    const counts = new Map(all('SELECT family_id AS id, COUNT(*) AS n FROM students WHERE family_id IS NOT NULL GROUP BY family_id').map(r => [r.id, r.n]));
    return all('SELECT * FROM families ORDER BY name').map(f => {
      const p1 = parents.get(f.parent1_id) || null;
      const p2 = parents.get(f.parent2_id) || null;
      const who = p => p ? `${[p.title, p.fullName].filter(Boolean).join(' ')}${p.relationship ? ` (${p.relationship})` : ''}` : '';
      return { id: f.id, name: f.name, parent1: p1, parent2: p2, children: counts.get(f.id) || 0, label: `${f.name} — ${[who(p1), who(p2)].filter(Boolean).join(' & ')}` };
    });
  }

  function familyEmail(familyId) {
    if (!familyId) return '';
    const f = one('SELECT parent1_id, parent2_id FROM families WHERE id = ?', familyId);
    if (!f) return '';
    for (const pid of [f.parent1_id, f.parent2_id]) {
      const p = pid && one('SELECT email FROM parents WHERE id = ?', pid);
      if (p?.email) return p.email;
    }
    return '';
  }

  function cleanParent(p) {
    if (!p) return null;
    const fullName = text(p.fullName, 150);
    if (!fullName) return null;
    return {
      title: text(p.title, 20), fullName, relationship: text(p.relationship, 40), relationshipOther: text(p.relationshipOther, 60),
      occupation: text(p.occupation, 100), phone: text(p.phone, 40), email: text(p.email, 150).toLowerCase(), address: text(p.address, 400),
    };
  }

  function saveParent(p, existingId = null) {
    if (existingId) {
      run(`UPDATE parents SET title = ?, full_name = ?, relationship = ?, relationship_other = ?, occupation = ?, phone = ?, email = ?, address = ? WHERE id = ?`,
        p.title, p.fullName, p.relationship, p.relationshipOther, p.occupation, p.phone, p.email, p.address, existingId);
      return existingId;
    }
    return Number(run(`INSERT INTO parents (title, full_name, relationship, relationship_other, occupation, phone, email, address, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.title, p.fullName, p.relationship, p.relationshipOther, p.occupation, p.phone, p.email, p.address, nowIso()).lastInsertRowid);
  }

  function defaultFamilyName(parent) {
    const last = String(parent?.fullName || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).pop() || 'New';
    return `${last.toUpperCase()} Family`;
  }

  // Creates a family from {name?, parent1: {...} | {existingId}, parent2?}.
  function createFamily(body) {
    const slot = s => {
      if (!s) return null;
      if (s.existingId) return one('SELECT id FROM parents WHERE id = ?', Number(s.existingId)) ? Number(s.existingId) : null;
      const p = cleanParent(s);
      return p ? saveParent(p) : null;
    };
    const p1 = slot(body.parent1);
    if (!p1) throw new Error("Parent 1's full name is required");
    const p2 = slot(body.parent2);
    const p1row = one('SELECT full_name FROM parents WHERE id = ?', p1);
    const p2row = p2 ? one('SELECT full_name FROM parents WHERE id = ?', p2) : null;
    // Both parents share a surname ("Adekoya Saheed" & "Bisi Adekoya") → ADEKOYA Family
    const words = n => String(n || '').replace(/\(.*?\)/g, '').toUpperCase().split(/\s+/).filter(w => w.length > 2 && !['MR', 'MRS', 'AND'].includes(w));
    const shared = p2row ? words(p1row.full_name).find(w => words(p2row.full_name).includes(w)) : '';
    const name = text(body.name, 120) || (shared ? `${shared} Family` : defaultFamilyName({ fullName: p1row.full_name }));
    return Number(run('INSERT INTO families (name, parent1_id, parent2_id, created_at) VALUES (?, ?, ?, ?)', name, p1, p2, nowIso()).lastInsertRowid);
  }

  function syncFamilyEmails(familyId) {
    run('UPDATE students SET parent_email = ? WHERE family_id = ?', familyEmail(familyId), familyId);
  }

  // Finds a family whose parent has this email or phone (siblings share one).
  function findFamilyByContact(email, phone) {
    const e = String(email || '').trim().toLowerCase();
    const ph = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!e && ph.length < 7) return null;
    for (const p of all('SELECT id, email, phone FROM parents')) {
      const hit = (e && String(p.email || '').toLowerCase() === e) || (ph.length >= 7 && String(p.phone || '').replace(/\D/g, '').slice(-10) === ph);
      if (hit) {
        const f = one('SELECT id FROM families WHERE parent1_id = ? OR parent2_id = ? ORDER BY id LIMIT 1', p.id, p.id);
        if (f) return f.id;
      }
    }
    return null;
  }

  function emailInUse(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return false;
    return !!(one('SELECT id FROM users WHERE LOWER(email) = ?', e)
      || one('SELECT id FROM students WHERE LOWER(student_email) = ?', e)
      || one('SELECT id FROM parents WHERE LOWER(email) = ?', e));
  }

  // The one place a pupil is created (wizard, bulk import, self registration).
  function createPupil(f) {
    const surname = text(f.surname, 80);
    const firstName = text(f.firstName, 80);
    const otherNames = text(f.otherNames, 120);
    if (!surname || !firstName) throw new Error('Surname and first name are required');
    const gender = normGender(f.gender);
    if (!gender) throw new Error(`Choose a gender for ${firstName} ${surname}`);
    const classCode = text(f.classCode, 20).toUpperCase();
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) throw new Error('Choose a valid class');
    const classArmId = f.classArmId ? Number(f.classArmId) : null;
    if (classArmId && !one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', classArmId, classCode)) throw new Error('That class arm does not belong to the class');
    if (!classArmId && classHasArms(classCode)) throw new Error('Choose a class arm');
    const session = text(f.session, 20) || activeAcademic()?.sessionLabel || '';
    let regNo = text(f.regNo, 40);
    if (regNo && one('SELECT id FROM students WHERE reg_no = ?', regNo)) throw new Error(`Registration number ${regNo} is already used`);
    if (!regNo) regNo = regNoGenerator(sessionStartYear(session))();
    const id = makeStudentIdGenerator()();
    const name = [firstName, otherNames, surname].filter(Boolean).join(' ');
    const familyId = f.familyId ? Number(f.familyId) : null;
    const studentEmail = text(f.studentEmail, 150).toLowerCase();
    const dob = normDate(f.dob);
    const now = nowIso();
    run(`INSERT INTO users (id, role, password, name, first_name, initials, grade, email, dob, active)
         VALUES (?, 'student', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, hashPassword(text(f.password, 60) || DEFAULT_STUDENT_PASSWORD), name, firstName, initialsFromName(`${firstName} ${surname}`),
      `Class ${classCode}`, studentEmail || null, dob || null, f.active === false ? 0 : 1);
    run(`INSERT INTO students (id, name, initials, gender, avg, att, class_code, parent_email, photo_path, class_arm_id, enrolled_at,
           reg_no, family_id, surname, first_name, other_names, student_email, phone, dob, nin, religion, nationality, state_origin,
           lga_origin, town_origin, residential_address, permanent_address, bio, roll_no, admission_date, enrol_session, blood_group,
           genotype, next_of_kin, emergency_contact)
         VALUES (?, ?, ?, ?, 0, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, name, initialsFromName(`${firstName} ${surname}`), gender, classCode, familyEmail(familyId) || text(f.parentEmail, 150).toLowerCase(),
      f.photoPath || null, classArmId, now, regNo, familyId, surname, firstName, otherNames, studentEmail, text(f.phone, 40), dob,
      text(f.nin, 60), text(f.religion, 60), text(f.nationality, 80), text(f.state, 80), text(f.lga, 80), text(f.town, 80),
      text(f.residentialAddress, 400), text(f.permanentAddress, 400), text(f.bio, 1000),
      text(f.rollNo, 20) || nextRollNo(classCode, classArmId), normDate(f.admissionDate) || now.slice(0, 10), session,
      text(f.bloodGroup, 10), text(f.genotype, 10), JSON.stringify(cleanContact(f.nextOfKin)), JSON.stringify(cleanContact(f.emergency)));
    if (dob) setMeta(`student_dob_${id}`, `${dob.slice(8, 10)}/${dob.slice(5, 7)}/${dob.slice(0, 4)}`);
    setTags(id, f.tags);
    classChanged(id);
    return { id, regNo, name };
  }

  function setTags(studentId, tags) {
    if (!Array.isArray(tags)) return;
    run('DELETE FROM student_tag_assignments WHERE student_id = ?', studentId);
    for (const tagId of tags.map(Number).filter(Boolean)) {
      if (one('SELECT id FROM student_tags WHERE id = ?', tagId)) {
        run('INSERT OR IGNORE INTO student_tag_assignments (tag_id, student_id, assigned_at) VALUES (?, ?, ?)', tagId, studentId, nowIso());
      }
    }
  }

  function pupilRecord(id) {
    const st = one(`SELECT s.*, u.email AS user_email, u.dob AS user_dob, COALESCE(u.active, 1) AS active
                    FROM students s LEFT JOIN users u ON u.id = s.id WHERE s.id = ?`, id);
    if (!st) return null;
    const parts = String(st.name || '').trim().split(/\s+/);
    const parse = v => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
    return {
      id: st.id, regNo: st.reg_no || '', familyId: st.family_id || '',
      surname: st.surname || (parts.length > 1 ? parts[parts.length - 1] : ''),
      firstName: st.first_name || parts[0] || '',
      otherNames: st.other_names ?? (parts.length > 2 ? parts.slice(1, -1).join(' ') : ''),
      gender: st.gender || '', studentEmail: st.student_email || st.user_email || '', active: !!st.active,
      session: st.enrol_session || '', classCode: st.class_code, classArmId: st.class_arm_id || '',
      tags: all('SELECT tag_id FROM student_tag_assignments WHERE student_id = ?', id).map(r => r.tag_id),
      admissionDate: st.admission_date || String(st.enrolled_at || '').slice(0, 10), rollNo: st.roll_no || '',
      phone: st.phone || '', dob: st.dob || st.user_dob || '', nin: st.nin || '', religion: st.religion || '', nationality: st.nationality || '',
      state: st.state_origin || '', lga: st.lga_origin || '', town: st.town_origin || '',
      residentialAddress: st.residential_address || '', permanentAddress: st.permanent_address || '', bio: st.bio || '',
      bloodGroup: st.blood_group || '', genotype: st.genotype || '', photoPath: st.photo_path || '',
      nextOfKin: parse(st.next_of_kin), emergency: parse(st.emergency_contact),
    };
  }

  function updatePupil(id, f) {
    const st = one('SELECT * FROM students WHERE id = ?', id);
    if (!st) throw new Error('Student not found');
    const surname = text(f.surname, 80);
    const firstName = text(f.firstName, 80);
    const otherNames = text(f.otherNames, 120);
    if (!surname || !firstName) throw new Error('Surname and first name are required');
    const gender = normGender(f.gender);
    if (!gender) throw new Error('Choose a gender');
    const classCode = text(f.classCode, 20).toUpperCase();
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) throw new Error('Choose a valid class');
    const classArmId = f.classArmId ? Number(f.classArmId) : null;
    if (classArmId && !one('SELECT id FROM class_arms WHERE id = ? AND class_code = ?', classArmId, classCode)) throw new Error('That class arm does not belong to the class');
    if (!classArmId && classHasArms(classCode)) throw new Error('Choose a class arm');
    const regNo = text(f.regNo, 40) || st.reg_no;
    if (regNo && one('SELECT id FROM students WHERE reg_no = ? AND id <> ?', regNo, id)) throw new Error(`Registration number ${regNo} is already used`);
    const name = [firstName, otherNames, surname].filter(Boolean).join(' ');
    const familyId = f.familyId ? Number(f.familyId) : null;
    const studentEmail = text(f.studentEmail, 150).toLowerCase();
    const dob = normDate(f.dob);
    const password = text(f.password, 60);
    run(`UPDATE users SET name = ?, first_name = ?, initials = ?, grade = ?, email = ?, dob = ?, active = ?${password ? ', password = ?' : ''} WHERE id = ?`,
      ...[name, firstName, initialsFromName(`${firstName} ${surname}`), `Class ${classCode}`, studentEmail || null, dob || null, f.active === false ? 0 : 1],
      ...(password ? [hashPassword(password)] : []), id);
    run(`UPDATE students SET name = ?, initials = ?, gender = ?, class_code = ?, class_arm_id = ?, parent_email = ?, reg_no = ?, family_id = ?,
           surname = ?, first_name = ?, other_names = ?, student_email = ?, phone = ?, dob = ?, nin = ?, religion = ?, nationality = ?,
           state_origin = ?, lga_origin = ?, town_origin = ?, residential_address = ?, permanent_address = ?, bio = ?, roll_no = ?,
           admission_date = ?, enrol_session = ?, blood_group = ?, genotype = ?, next_of_kin = ?, emergency_contact = ?
           ${f.photoPath ? ', photo_path = ?' : ''}
         WHERE id = ?`,
      name, initialsFromName(`${firstName} ${surname}`), gender, classCode, classArmId, familyEmail(familyId) || st.parent_email || '', regNo, familyId,
      surname, firstName, otherNames, studentEmail, text(f.phone, 40), dob, text(f.nin, 60), text(f.religion, 60), text(f.nationality, 80),
      text(f.state, 80), text(f.lga, 80), text(f.town, 80), text(f.residentialAddress, 400), text(f.permanentAddress, 400), text(f.bio, 1000),
      text(f.rollNo, 20) || st.roll_no || nextRollNo(classCode, classArmId), normDate(f.admissionDate) || st.admission_date, text(f.session, 20) || st.enrol_session,
      text(f.bloodGroup, 10), text(f.genotype, 10), JSON.stringify(cleanContact(f.nextOfKin)), JSON.stringify(cleanContact(f.emergency)),
      ...(f.photoPath ? [f.photoPath] : []), id);
    if (dob) setMeta(`student_dob_${id}`, `${dob.slice(8, 10)}/${dob.slice(5, 7)}/${dob.slice(0, 4)}`);
    setTags(id, f.tags);
    if (st.class_code !== classCode || String(st.class_arm_id || '') !== String(classArmId || '')) classChanged(id);
  }

  function withTransaction(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // ── Excel template (built here, no library) ───────────────────────────
  const TEMPLATE_COLUMNS = [
    ["Father's Full Name", true], ["Father's Email", true], ["Father's Phone", true],
    ["Mother's Full Name", true], ["Mother's Email", true], ["Mother's Phone", true],
    ['Student Email', false], ['Surname', true], ['First Name', true], ['Other Names', false], ['Gender (M or F)', true],
    ['Registration Number', false], ['Nationality', false], ['Date of Birth (dd-mm-YYYY)', false], ['Blood Group', false],
    ['N.ID or Birth Cert. No', false], ['Religion', false], ['Contact Phone', false], ['Province or State (of origin)', false],
    ['ZIP or LGA (of origin)', false], ['Town (of origin)', false], ['Permanent Address', false], ['Residential Address', false],
  ];

  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  function zip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of files) {
      const data = Buffer.from(content, 'utf8');
      const packed = zlib.deflateRawSync(data);
      const nameBuf = Buffer.from(name, 'utf8');
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
      local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
      locals.push(local, nameBuf, packed);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
      central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
      central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
      centrals.push(central, nameBuf);
      offset += 30 + nameBuf.length + packed.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, end]);
  }

  function templateXlsx() {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const colName = i => String.fromCharCode(65 + i);
    const header = TEMPLATE_COLUMNS.map(([label, req], i) => `<c r="${colName(i)}1" t="inlineStr" s="${req ? 1 : 2}"><is><t>${esc(label)}</t></is></c>`).join('');
    const blankRows = Array.from({ length: 200 }, (_, r) => `<row r="${r + 2}">${TEMPLATE_COLUMNS.slice(0, 6).map((_, i) => `<c r="${colName(i)}${r + 2}" s="3"/>`).join('')}</row>`).join('');
    const cols = TEMPLATE_COLUMNS.map(([label], i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(16, label.length + 4)}" customWidth="1"/>`).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1" ht="32" customHeight="1">${header}</row>${blankRows}</sheetData></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFF00"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F497D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/></cellXfs>
</styleSheet>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/styles.xml', styles],
    ]);
  }

  // ── Bulk enrol from the template ──────────────────────────────────────
  function bulkEnrol(body) {
    const match = cleanText(body.fileDataUrl).match(/^data:[^;]*;base64,(.+)$/);
    if (!match) throw new Error('Choose the spreadsheet (.xlsx) file');
    const classCode = text(body.classCode, 20).toUpperCase();
    if (!one('SELECT code FROM classes WHERE code = ?', classCode)) throw new Error('Choose the class');
    const classArmId = body.classArmId ? Number(body.classArmId) : null;
    if (!classArmId && classHasArms(classCode)) throw new Error('Choose the class arm');
    const session = text(body.session, 20);
    if (!session) throw new Error('Choose the academic session');
    if (!body.confirmed) throw new Error("Tick \"I'm sure the list file is for the selected class\" first");
    let headers;
    let rows;
    try {
      ({ headers, rows } = parseXlsxFirstSheet(Buffer.from(match[1], 'base64')));
    } catch (err) {
      throw new Error(`Could not read this file: ${err.message}`);
    }
    const key = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = headers.map(key);
    const col = (...names) => { for (const n of names) { const i = keys.indexOf(key(n)); if (i !== -1) return i; } return -1; };
    const idx = {
      fName: col("Father's Full Name", 'Father Full Name', 'Father Name'), fEmail: col("Father's Email", 'Father Email'), fPhone: col("Father's Phone", 'Father Phone'),
      mName: col("Mother's Full Name", 'Mother Full Name', 'Mother Name'), mEmail: col("Mother's Email", 'Mother Email'), mPhone: col("Mother's Phone", 'Mother Phone'),
      email: col('Student Email', 'Email'), surname: col('Surname', 'Last Name'), first: col('First Name', 'Firstname'), other: col('Other Names', 'Other Name', 'Middle Name'),
      gender: col('Gender (M or F)', 'Gender', 'Sex'), reg: col('Registration Number', 'Reg No', 'Admission No'), nationality: col('Nationality'),
      dob: col('Date of Birth (dd-mm-YYYY)', 'Date of Birth', 'DOB'), blood: col('Blood Group'), nin: col('N.ID or Birth Cert. No', 'NIN', 'Birth Cert No'),
      religion: col('Religion'), phone: col('Contact Phone', 'Phone'), state: col('Province or State (of origin)', 'State of Origin', 'State'),
      lga: col('ZIP or LGA (of origin)', 'LGA'), town: col('Town (of origin)', 'Town'), permanent: col('Permanent Address'), residential: col('Residential Address', 'Address'),
    };
    if (idx.surname === -1 || idx.first === -1) throw new Error('This is not the enrolment template — Surname and First Name columns are missing. Download the template and use it.');
    const cell = (row, i) => (i === -1 ? '' : (row[i] ?? ''));
    const existingNames = new Set(all('SELECT LOWER(name) AS n FROM students').map(r => r.n));
    const enrolled = [];
    const skipped = [];
    const errors = [];
    rows.forEach((row, r) => {
      const rowNo = r + 2;
      const surname = String(cell(row, idx.surname)).trim();
      const first = String(cell(row, idx.first)).trim();
      if (!surname && !first) return; // empty line
      const other = String(cell(row, idx.other)).trim();
      const full = [first, other, surname].filter(Boolean).join(' ');
      if (body.filterDoubles !== false && existingNames.has(full.toLowerCase())) {
        skipped.push({ row: rowNo, name: full, reason: 'Already in the students records' });
        return;
      }
      try {
        withTransaction(() => {
          const father = cleanParent({ fullName: cell(row, idx.fName), email: cell(row, idx.fEmail), phone: cell(row, idx.fPhone), relationship: 'Father' });
          const mother = cleanParent({ fullName: cell(row, idx.mName), email: cell(row, idx.mEmail), phone: cell(row, idx.mPhone), relationship: 'Mother' });
          if (!father && !mother) throw new Error("Father's or Mother's full name is required");
          let familyId = findFamilyByContact(father?.email, father?.phone) || findFamilyByContact(mother?.email, mother?.phone);
          if (!familyId) {
            familyId = createFamily({ name: `${surname.toUpperCase()} Family`, parent1: father || mother, parent2: father ? mother : null });
          }
          const created = createPupil({
            surname, firstName: first, otherNames: other, gender: cell(row, idx.gender), classCode, classArmId, session, familyId,
            studentEmail: cell(row, idx.email), regNo: cell(row, idx.reg), nationality: cell(row, idx.nationality), dob: cell(row, idx.dob),
            bloodGroup: cell(row, idx.blood), nin: cell(row, idx.nin), religion: cell(row, idx.religion), phone: cell(row, idx.phone),
            state: cell(row, idx.state), lga: cell(row, idx.lga), town: cell(row, idx.town), permanentAddress: cell(row, idx.permanent),
            residentialAddress: cell(row, idx.residential), password: text(body.defaultPassword, 60) || DEFAULT_STUDENT_PASSWORD,
          });
          existingNames.add(full.toLowerCase());
          enrolled.push({ row: rowNo, name: created.name, regNo: created.regNo });
        });
      } catch (err) {
        errors.push({ row: rowNo, name: full, reason: err.message });
      }
    });
    return { enrolled, skipped, errors };
  }

  // ── Self registration ─────────────────────────────────────────────────
  // [key, label, group, locked]
  const FIELD_SETS = {
    student: [
      ['surname', 'Surname', 'Personal', true], ['first_name', 'First Name', 'Personal', true], ['last_name', 'Last Name', 'Personal'],
      ['gender', 'Gender', 'Personal'], ['dob', 'Date of Birth', 'Personal'], ['blood_group', 'Blood Group', 'Personal'],
      ['genotype', 'Genotype', 'Personal'], ['nin', 'NIN / Birth Cert. No.', 'Personal'], ['religion', 'Religion', 'Personal'],
      ['nationality', 'Nationality', 'Personal'], ['state', 'State', 'Personal'], ['lga', 'LGA', 'Personal'], ['town', 'Town', 'Personal'],
      ['email', 'Email', 'Personal'], ['phone', 'Phone', 'Personal'], ['address', 'Address', 'Personal'],
      ['permanent_address', 'Permanent Address', 'Personal'],
      ['class', 'Class', 'Academic', true], ['class_arm', 'Class Arm', 'Academic'],
      ['father_name', 'Father Name', 'Guardian'], ['father_phone', 'Father Phone', 'Guardian'], ['father_email', 'Father Email', 'Guardian'],
      ['father_occupation', 'Father Occupation', 'Guardian'], ['mother_name', 'Mother Name', 'Guardian'], ['mother_phone', 'Mother Phone', 'Guardian'],
      ['mother_email', 'Mother Email', 'Guardian'], ['mother_occupation', 'Mother Occupation', 'Guardian'], ['guardian_name', 'Guardian Name', 'Guardian'],
      ['guardian_phone', 'Guardian Phone', 'Guardian'], ['guardian_email', 'Guardian Email', 'Guardian'],
      ['guardian_relationship', 'Guardian Relationship', 'Guardian'], ['guardian_occupation', 'Guardian Occupation', 'Guardian'],
    ],
    parent: [
      ['full_name', 'Full Name', 'Personal', true], ['phone', 'Phone', 'Personal'], ['email', 'Email', 'Personal'],
      ['relationship', 'Relationship', 'Personal'], ['address', 'Address', 'Personal'],
      ['c_surname', 'Surname', 'Children', true], ['c_first_name', 'First Name', 'Children', true], ['c_last_name', 'Last Name', 'Children'],
      ['c_gender', 'Gender', 'Children'], ['c_dob', 'Date of Birth', 'Children'], ['c_blood_group', 'Blood Group', 'Children'],
      ['c_genotype', 'Genotype', 'Children'], ['c_nin', 'NIN / Birth Cert. No.', 'Children'], ['c_religion', 'Religion', 'Children'],
      ['c_nationality', 'Nationality', 'Children'], ['c_state', 'State', 'Children'], ['c_lga', 'LGA', 'Children'], ['c_town', 'Town', 'Children'],
      ['c_phone', 'Phone', 'Children'], ['c_address', 'Address', 'Children'], ['c_permanent_address', 'Permanent Address', 'Children'],
      ['c_class_arm', 'Class Arm', 'Children'],
    ],
    staff: [
      ['surname', 'Surname', 'Personal', true], ['first_name', 'First Name', 'Personal', true], ['other_names', 'Other Names', 'Personal', true],
      ['gender', 'Gender', 'Personal'], ['dob', 'Date of Birth', 'Personal'], ['blood_group', 'Blood Group', 'Personal'],
      ['genotype', 'Genotype', 'Personal'], ['religion', 'Religion', 'Personal'], ['nationality', 'Nationality', 'Personal'],
      ['state', 'State', 'Personal'], ['lga', 'LGA', 'Personal'], ['town', 'Town', 'Personal'], ['email', 'Email', 'Personal', true],
      ['phone', 'Phone', 'Personal'], ['address', 'Address', 'Personal'], ['permanent_address', 'Permanent Address', 'Personal'],
      ['qualification', 'Qualification', 'Professional'],
      ['nok_name', 'Name', 'Next Of Kin'], ['nok_phone', 'Phone', 'Next Of Kin'], ['nok_email', 'Email', 'Next Of Kin'], ['nok_address', 'Address', 'Next Of Kin'],
    ],
  };
  const STAFF_TYPES = [
    ['teacher', 'Teacher'], ['accountant', 'Accountant/Bursary Officer'], ['librarian', 'Librarian'], ['registrar', 'Registrar'],
    ['transport_manager', 'Transport Manager'], ['hostel_manager', 'Hostel Manager'], ['store_manager', 'Store Manager'],
    ['general_staff', 'General Staff / Others'], ['admin', 'Admin'],
  ];

  function defaultSettings() {
    const fields = kind => Object.fromEntries(FIELD_SETS[kind].map(([k, , , locked]) => [k, { show: true, required: !!locked }]));
    return {
      student: { enabled: false, blockReReg: true, fields: fields('student') },
      parent: { enabled: false, blockReReg: true, requireChild: true, fields: fields('parent') },
      staff: { enabled: false, blockReReg: false, fields: fields('staff'), types: [] },
      codes: { studentParent: '', staff: '' },
    };
  }

  function getSettings() {
    const base = defaultSettings();
    let saved = {};
    try { saved = JSON.parse(valueFromMeta('selfreg_settings', '{}')); } catch {}
    for (const kind of ['student', 'parent', 'staff']) {
      base[kind] = { ...base[kind], ...(saved[kind] || {}), fields: { ...base[kind].fields, ...(saved[kind]?.fields || {}) } };
      for (const [k, , , locked] of FIELD_SETS[kind]) if (locked) base[kind].fields[k] = { show: true, required: true };
    }
    base.codes = { ...base.codes, ...(saved.codes || {}) };
    return base;
  }

  function saveSettings(s) { setMeta('selfreg_settings', JSON.stringify(s)); }

  function newCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(8), b => alphabet[b % alphabet.length]).join('');
  }

  function publicForm(kind) {
    const s = getSettings();
    return {
      kind,
      fields: FIELD_SETS[kind].map(([key, label, group, locked]) => ({ key, label, group, locked: !!locked, ...s[kind].fields[key] })),
      requireChild: kind === 'parent' ? !!s.parent.requireChild : undefined,
      staffTypes: kind === 'staff' ? STAFF_TYPES.filter(([k]) => s.staff.types.includes(k)).map(([value, label]) => ({ value, label })) : undefined,
      classes: kind === 'staff' ? undefined : all("SELECT code, label FROM classes WHERE COALESCE(archived, 0) = 0 ORDER BY rowid").map(c => ({ code: c.code, label: c.label })),
      arms: kind === 'staff' ? undefined : all('SELECT id, class_code AS classCode, name FROM class_arms ORDER BY name'),
      school: valueFromMeta('school_name', "Unique Children's School"),
    };
  }

  // Which form an access code opens. Staff code never opens student/parent forms.
  function codeAllows(code, kind) {
    const s = getSettings();
    const c = String(code || '').trim().toUpperCase();
    if (!c) return false;
    if (kind === 'staff') return s.staff.enabled && c === s.codes.staff;
    return s[kind]?.enabled && c === s.codes.studentParent;
  }

  const submitLog = new Map(); // ip -> [times]
  function rateLimited(ip) {
    const now = Date.now();
    const list = (submitLog.get(ip) || []).filter(t => now - t < 3600_000);
    list.push(now);
    submitLog.set(ip, list);
    return list.length > 20;
  }

  function validateSubmission(kind, data) {
    const s = getSettings()[kind];
    const missing = [];
    const check = (fieldKey, value, label) => {
      const f = s.fields[fieldKey];
      if (f?.show && f.required && !String(value ?? '').trim()) missing.push(label);
    };
    const labels = Object.fromEntries(FIELD_SETS[kind].map(([k, l]) => [k, l]));
    if (kind === 'parent') {
      ['full_name', 'phone', 'email', 'relationship', 'address'].forEach(k => check(k, data[k], labels[k]));
      const children = Array.isArray(data.children) ? data.children : [];
      if (s.requireChild && !children.length) missing.push('at least one child');
      children.forEach((c, i) => {
        FIELD_SETS.parent.filter(([k]) => k.startsWith('c_')).forEach(([k, l]) => check(k, c[k.slice(2)], `Child ${i + 1}: ${l}`));
        if (!c.class) missing.push(`Child ${i + 1}: Class`);
        // a class with arms needs one (when the form shows the arm box)
        else if (s.fields.c_class_arm?.show && !c.class_arm && classHasArms(c.class)) missing.push(`Child ${i + 1}: Class Arm`);
      });
    } else {
      FIELD_SETS[kind].forEach(([k, l]) => check(k, data[k], l));
      if (kind === 'staff' && !data.staff_type) missing.push('Staff Type');
      if (kind === 'student' && data.class && s.fields.class_arm?.show && !data.class_arm && classHasArms(data.class)) missing.push('Class Arm');
    }
    if (missing.length) throw new Error(`Please fill in: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`);
  }

  function submissionSummary(kind, data) {
    const classLabel = code => one('SELECT label FROM classes WHERE code = ?', code)?.label || '';
    if (kind === 'parent') {
      const kids = Array.isArray(data.children) ? data.children : [];
      return { name: data.full_name, email: data.email, phone: data.phone, classLabel: kids.map(c => `${c.first_name || ''} (${classLabel(c.class)})`).join(', ') };
    }
    if (kind === 'staff') {
      return { name: [data.surname, data.first_name, data.other_names].filter(Boolean).join(' '), email: data.email, phone: data.phone,
        classLabel: STAFF_TYPES.find(([k]) => k === data.staff_type)?.[1] || '' };
    }
    return { name: [data.surname, data.first_name, data.last_name].filter(Boolean).join(' '), email: data.email, phone: data.phone, classLabel: classLabel(data.class) };
  }

  function sanitizeData(value, depth = 0) {
    if (depth > 3) return null;
    if (Array.isArray(value)) return value.slice(0, 12).map(v => sanitizeData(v, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 80).map(([k, v]) => [String(k).slice(0, 40), sanitizeData(v, depth + 1)]));
    }
    return String(value ?? '').slice(0, 600);
  }

  function nextStaffId(role) {
    const prefix = role === 'admin' ? 'ADM-' : 'TCH-';
    const max = all('SELECT id FROM users WHERE id LIKE ?', `${prefix}%`).reduce((m, r) => Math.max(m, Number(r.id.slice(4)) || 0), 0);
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  function randomPassword() { return String(crypto.randomInt(100000, 1000000)); }

  // Accepting a submission creates the pupil(s), family, or staff account.
  function acceptSubmission(sub, overrides = {}) {
    const d = JSON.parse(sub.data);
    if (sub.kind === 'student') {
      const parents = [
        d.father_name && { fullName: d.father_name, phone: d.father_phone, email: d.father_email, occupation: d.father_occupation, relationship: 'Father' },
        d.mother_name && { fullName: d.mother_name, phone: d.mother_phone, email: d.mother_email, occupation: d.mother_occupation, relationship: 'Mother' },
        d.guardian_name && { fullName: d.guardian_name, phone: d.guardian_phone, email: d.guardian_email, occupation: d.guardian_occupation, relationship: d.guardian_relationship || 'Guardian' },
      ].filter(Boolean).map(cleanParent).filter(Boolean);
      let familyId = parents.map(p => findFamilyByContact(p.email, p.phone)).find(Boolean) || null;
      if (!familyId && parents.length) familyId = createFamily({ name: `${String(d.surname || '').toUpperCase()} Family`, parent1: parents[0], parent2: parents[1] || null });
      const created = createPupil({
        surname: d.surname, firstName: d.first_name, otherNames: d.last_name, gender: d.gender, dob: d.dob, bloodGroup: d.blood_group,
        genotype: d.genotype, nin: d.nin, religion: d.religion, nationality: d.nationality, state: d.state, lga: d.lga, town: d.town,
        studentEmail: d.email, phone: d.phone, residentialAddress: d.address, permanentAddress: d.permanent_address,
        classCode: overrides.classCode || d.class, classArmId: overrides.classArmId || d.class_arm, familyId,
      });
      return `Enrolled ${created.name} — Reg. No. ${created.regNo}, password ${DEFAULT_STUDENT_PASSWORD}`;
    }
    if (sub.kind === 'parent') {
      const parent = cleanParent({ fullName: d.full_name, phone: d.phone, email: d.email, relationship: d.relationship, address: d.address });
      if (!parent) throw new Error('The parent has no name');
      const familyId = findFamilyByContact(parent.email, parent.phone) || createFamily({ parent1: parent });
      const names = [];
      const childOverrides = Array.isArray(overrides.children) ? overrides.children : [];
      for (const [i, c] of (Array.isArray(d.children) ? d.children : []).entries()) {
        const o = childOverrides[i] || {};
        if (o.classCode) { c.class = o.classCode; c.class_arm = o.classArmId; }
        const created = createPupil({
          surname: c.surname, firstName: c.first_name, otherNames: c.last_name, gender: c.gender, dob: c.dob, bloodGroup: c.blood_group,
          genotype: c.genotype, nin: c.nin, religion: c.religion, nationality: c.nationality, state: c.state, lga: c.lga, town: c.town,
          phone: c.phone, residentialAddress: c.address, permanentAddress: c.permanent_address, classCode: c.class, classArmId: c.class_arm, familyId,
        });
        names.push(`${created.name} (${created.regNo})`);
      }
      syncFamilyEmails(familyId);
      return `Family saved${names.length ? ` — enrolled ${names.join(', ')}` : ''}`;
    }
    // staff
    const type = d.staff_type;
    const name = [d.first_name, d.other_names, d.surname].filter(Boolean).join(' ');
    if (type === 'teacher' || type === 'admin') {
      const role = type;
      const id = nextStaffId(role);
      const password = randomPassword();
      run(`INSERT INTO users (id, role, password, name, first_name, initials, teacher_type, chip, email, dob, phone, address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, role, hashPassword(password), name, d.first_name || name, initialsFromName(name),
        role === 'teacher' ? (overrides.teacherType || 'subject_teacher') : null, role === 'teacher' ? name.toUpperCase() : null,
        text(d.email, 150).toLowerCase() || null, normDate(d.dob) || null, text(d.phone, 40) || null, text(d.address, 400) || null);
      return `Created ${role === 'admin' ? 'admin' : 'teacher'} account ${id} for ${name} — password ${password}`;
    }
    return `Accepted ${name} (${STAFF_TYPES.find(([k]) => k === type)?.[1] || type}) — this staff type has no portal account, so the record is kept here`;
  }

  // ── Routes ────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    // Public self registration
    if (m === 'POST' && p === '/api/register/open') {
      const body = await readJson(req);
      const kind = ['student', 'parent', 'staff'].includes(body.kind) ? body.kind : '';
      if (!kind) return sendJson(res, 400, { error: 'Choose what you are registering as' }), true;
      if (!codeAllows(body.code, kind)) return sendJson(res, 403, { error: 'That access code is not valid, or this registration is closed' }), true;
      return sendJson(res, 200, publicForm(kind)), true;
    }
    if (m === 'GET' && p === '/api/register/status') {
      const s = getSettings();
      return sendJson(res, 200, { student: s.student.enabled, parent: s.parent.enabled, staff: s.staff.enabled, school: valueFromMeta('school_name', "Unique Children's School") }), true;
    }
    if (m === 'POST' && p === '/api/register/submit') {
      const ip = String(req.headers['fly-client-ip'] || req.socket.remoteAddress || '');
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many registrations from this connection. Try again later.' }), true;
      const body = await readJson(req);
      const kind = ['student', 'parent', 'staff'].includes(body.kind) ? body.kind : '';
      if (!kind || !codeAllows(body.code, kind)) return sendJson(res, 403, { error: 'That access code is not valid, or this registration is closed' }), true;
      const data = sanitizeData(body.data || {});
      if (kind === 'staff' && !getSettings().staff.types.includes(data.staff_type)) return sendJson(res, 400, { error: 'Choose an allowed staff type' }), true;
      try { validateSubmission(kind, data); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
      const summary = submissionSummary(kind, data);
      let status = 'pending';
      if (emailInUse(summary.email)) {
        if (getSettings()[kind].blockReReg) return sendJson(res, 409, { error: 'This email is already registered with the school. Contact the school office instead.' }), true;
        status = 'bypassed';
      }
      run(`INSERT INTO self_registrations (kind, status, name, email, phone, class_label, data, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        kind, status, text(summary.name, 200), text(summary.email, 150).toLowerCase(), text(summary.phone, 40), text(summary.classLabel, 300), JSON.stringify(data), nowIso());
      return sendJson(res, 201, { ok: true }), true;
    }

    if (!p.startsWith('/api/admin/enrol') && !p.startsWith('/api/admin/families') && !p.startsWith('/api/admin/parents/') && !p.startsWith('/api/admin/selfreg')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;

    try {
      if (m === 'GET' && p === '/api/admin/enrol/meta') {
        const academic = activeAcademic();
        const session = academic?.sessionLabel || '';
        return sendJson(res, 200, {
          families: familyList(),
          sessions: sessions(),
          activeSession: session,
          nextRegNo: regNoGenerator(sessionStartYear(session))(),
          tags: all('SELECT id, name, color FROM student_tags ORDER BY name'),
        }), true;
      }
      if (m === 'GET' && p === '/api/admin/enrol/next') {
        const session = url.searchParams.get('session') || activeAcademic()?.sessionLabel;
        const classCode = cleanText(url.searchParams.get('classCode')).toUpperCase();
        const armId = Number(url.searchParams.get('classArmId')) || null;
        return sendJson(res, 200, { regNo: regNoGenerator(sessionStartYear(session))(), rollNo: classCode ? nextRollNo(classCode, armId) : '' }), true;
      }
      if (m === 'GET' && p.startsWith('/api/admin/enrol/student/')) {
        const rec = pupilRecord(decodeURIComponent(p.split('/').pop()).toUpperCase());
        return rec ? sendJson(res, 200, { student: rec }) : sendJson(res, 404, { error: 'Student not found' }), true;
      }
      if ((m === 'POST' && p === '/api/admin/enrol/student') || (m === 'PUT' && p.startsWith('/api/admin/enrol/student/'))) {
        const body = await readJson(req);
        let photoPath = null;
        if (body.photoDataUrl) photoPath = saveDataUrl(body.photoDataUrl, 'student-photo');
        const fields = { ...body, photoPath };
        if (m === 'POST') {
          const created = withTransaction(() => {
            if (!body.familyId) throw new Error("Select the student's family (or create one) first");
            return createPupil(fields);
          });
          return sendJson(res, 201, { ok: true, student: created, setup: adminSetupPayload() }), true;
        }
        const id = decodeURIComponent(p.split('/').pop()).toUpperCase();
        withTransaction(() => updatePupil(id, fields));
        return sendJson(res, 200, { ok: true, setup: adminSetupPayload() }), true;
      }
      if (m === 'POST' && p === '/api/admin/families') {
        const body = await readJson(req);
        const id = withTransaction(() => createFamily(body));
        return sendJson(res, 201, { ok: true, familyId: id, families: familyList() }), true;
      }
      const famMatch = p.match(/^\/api\/admin\/families\/(\d+)$/);
      if (m === 'PUT' && famMatch) {
        const id = Number(famMatch[1]);
        const fam = one('SELECT * FROM families WHERE id = ?', id);
        if (!fam) return sendJson(res, 404, { error: 'Family not found' }), true;
        const body = await readJson(req);
        withTransaction(() => {
          // A slot is either an existing parent picked from search, or details
          // that update the family's own parent (or add a new one).
          const slotId = (slot, currentId) => {
            if (slot?.existingId) {
              if (!one('SELECT id FROM parents WHERE id = ?', Number(slot.existingId))) throw new Error('That parent no longer exists');
              return Number(slot.existingId);
            }
            const p = cleanParent(slot);
            return p ? saveParent(p, currentId) : null;
          };
          const p1id = slotId(body.parent1, fam.parent1_id);
          if (!p1id) throw new Error("Parent 1's full name is required");
          let p2id = slotId(body.parent2, fam.parent2_id);
          if (!p2id && !body.removeParent2) p2id = fam.parent2_id;
          run('UPDATE families SET name = ?, parent1_id = ?, parent2_id = ? WHERE id = ?', text(body.name, 120) || fam.name, p1id, p2id, id);
          syncFamilyEmails(id);
        });
        return sendJson(res, 200, { ok: true, families: familyList() }), true;
      }
      if (m === 'GET' && p === '/api/admin/parents/search') {
        const q = `%${cleanText(url.searchParams.get('q')).toLowerCase()}%`;
        const rows = all('SELECT * FROM parents WHERE LOWER(full_name) LIKE ? OR LOWER(COALESCE(email, \'\')) LIKE ? OR COALESCE(phone, \'\') LIKE ? ORDER BY full_name LIMIT 12', q, q, q);
        return sendJson(res, 200, { parents: rows.map(parentRow) }), true;
      }
      if (m === 'GET' && p === '/api/admin/enrol/template.xlsx') {
        const buf = templateXlsx();
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="Students-Enrolment-Template.xlsx"',
          'Content-Length': buf.length,
        });
        res.end(buf);
        return true;
      }
      if (m === 'POST' && p === '/api/admin/enrol/bulk') {
        const body = await readJson(req);
        const result = bulkEnrol(body);
        return sendJson(res, 200, { ok: true, ...result, setup: adminSetupPayload() }), true;
      }

      // Self registration admin
      if (m === 'GET' && p === '/api/admin/selfreg/settings') {
        return sendJson(res, 200, { settings: getSettings(), fieldSets: FIELD_SETS, staffTypes: STAFF_TYPES }), true;
      }
      if (m === 'POST' && p === '/api/admin/selfreg/settings') {
        const body = await readJson(req);
        const s = getSettings();
        for (const kind of ['student', 'parent', 'staff']) {
          const inc = body[kind] || {};
          if ('enabled' in inc) s[kind].enabled = !!inc.enabled;
          if ('blockReReg' in inc) s[kind].blockReReg = !!inc.blockReReg;
          if (kind === 'parent' && 'requireChild' in inc) s.parent.requireChild = !!inc.requireChild;
          if (kind === 'staff' && Array.isArray(inc.types)) s.staff.types = inc.types.filter(t => STAFF_TYPES.some(([k]) => k === t));
          for (const [k, v] of Object.entries(inc.fields || {})) {
            if (!s[kind].fields[k]) continue;
            const locked = FIELD_SETS[kind].find(([key]) => key === k)?.[3];
            if (locked) continue;
            s[kind].fields[k] = { show: !!v.show, required: !!v.show && !!v.required };
          }
        }
        if ((s.student.enabled || s.parent.enabled) && !s.codes.studentParent) s.codes.studentParent = newCode();
        if (s.staff.enabled && !s.codes.staff) s.codes.staff = newCode();
        saveSettings(s);
        return sendJson(res, 200, { ok: true, settings: s }), true;
      }
      if (m === 'POST' && p === '/api/admin/selfreg/regenerate') {
        const body = await readJson(req);
        const s = getSettings();
        if (body.which === 'staff') s.codes.staff = newCode(); else s.codes.studentParent = newCode();
        saveSettings(s);
        return sendJson(res, 200, { ok: true, settings: s }), true;
      }
      if (m === 'GET' && p === '/api/admin/selfreg/summary') {
        const counts = all("SELECT kind, status, COUNT(*) AS n FROM self_registrations GROUP BY kind, status");
        return sendJson(res, 200, { counts }), true;
      }
      if (m === 'GET' && p === '/api/admin/selfreg/list') {
        const kind = url.searchParams.get('kind') || 'student';
        const status = url.searchParams.get('status') || 'pending';
        const rows = all('SELECT id, kind, status, name, email, phone, class_label AS classLabel, submitted_at AS submittedAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, note, outcome FROM self_registrations WHERE kind = ? AND status = ? ORDER BY submitted_at DESC', kind, status);
        return sendJson(res, 200, { rows }), true;
      }
      const subMatch = p.match(/^\/api\/admin\/selfreg\/(\d+)$/);
      if (m === 'GET' && subMatch) {
        const sub = one('SELECT * FROM self_registrations WHERE id = ?', Number(subMatch[1]));
        if (!sub) return sendJson(res, 404, { error: 'Submission not found' }), true;
        return sendJson(res, 200, { submission: { ...sub, data: JSON.parse(sub.data) }, fieldSets: FIELD_SETS, staffTypes: STAFF_TYPES }), true;
      }
      if (m === 'POST' && p === '/api/admin/selfreg/action') {
        const body = await readJson(req);
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
        if (!ids.length) return sendJson(res, 400, { error: 'Select at least one submission' }), true;
        const results = [];
        for (const id of ids) {
          const sub = one('SELECT * FROM self_registrations WHERE id = ?', id);
          if (!sub) continue;
          try {
            if (body.action === 'delete') {
              run('DELETE FROM self_registrations WHERE id = ?', id);
              results.push({ id, ok: true, message: 'Deleted' });
            } else if (body.action === 'reject') {
              run("UPDATE self_registrations SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?", user.name, nowIso(), text(body.note, 500), id);
              results.push({ id, ok: true, message: 'Rejected' });
            } else if (body.action === 'accept') {
              if (sub.status === 'accepted') { results.push({ id, ok: false, message: 'Already accepted' }); continue; }
              const outcome = withTransaction(() => acceptSubmission(sub, body.overrides || {}));
              run("UPDATE self_registrations SET status = 'accepted', reviewed_by = ?, reviewed_at = ?, outcome = ? WHERE id = ?", user.name, nowIso(), outcome, id);
              results.push({ id, ok: true, message: outcome });
            }
          } catch (err) {
            results.push({ id, ok: false, message: err.message });
          }
        }
        return sendJson(res, 200, { ok: true, results, setup: adminSetupPayload() }), true;
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message }), true;
    }
    return false;
  }

  // Set by server.js so class history follows enrolments and class changes
  let classChanged = () => {};
  function onClassChange(fn) { classChanged = fn; }

  return { createSchema, handle, pupilRecord, zipFiles: zip, onClassChange };
};
