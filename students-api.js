// View Students and Students Registry (mirrors SchoolsFocus's Students
// Information System and Student Registry), plus each pupil's class history.
// server.js passes in its database helpers (ctx).

module.exports = function createStudents(ctx) {
  const { db, one, all, run, ensureColumn, cleanText, readJson, sendJson, requireUser, activeAcademic, adminSetupPayload, zipFiles, pupilRecord, schoolInfoFromMeta } = ctx;

  const nowIso = () => new Date().toISOString();

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_class_history (
        id INTEGER PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        session_label TEXT NOT NULL,
        class_code TEXT,
        class_arm_id INTEGER,
        class_text TEXT NOT NULL,
        form_teacher TEXT,
        recorded_at TEXT NOT NULL,
        UNIQUE(student_id, session_label)
      );
    `);
    ensureColumn('students', 'archived', 'INTEGER NOT NULL DEFAULT 0');
    // Everyone starts with their current class as this session's history line
    const session = activeAcademic()?.sessionLabel;
    if (session) {
      for (const st of all("SELECT id, class_code, class_arm_id, status FROM students WHERE id NOT IN (SELECT student_id FROM student_class_history WHERE session_label = ?)", session)) {
        recordHistory(st.id, st.status === 'active' ? null : st.status);
      }
    }
  }

  function formTeacherFor(classCode, armId) {
    const fromArm = armId && one(`SELECT u.name FROM class_arms ca JOIN users u ON u.id = ca.form_teacher_id WHERE ca.id = ?`, armId);
    if (fromArm?.name) return fromArm.name;
    const ct = one(`SELECT u.name FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_id
                    WHERE ta.class_code = ? AND ta.teacher_type = 'class_teacher' ORDER BY ta.id LIMIT 1`, classCode);
    return ct?.name || '';
  }

  // Records where the pupil is this session (one line per pupil per session).
  // `status` 'graduated' / 'left' records that instead of a class.
  function recordHistory(studentId, status = null, sessionLabel = null) {
    const session = sessionLabel || activeAcademic()?.sessionLabel;
    if (!session) return;
    const st = one('SELECT s.class_code, s.class_arm_id, c.label AS classLabel, ca.name AS armName FROM students s LEFT JOIN classes c ON c.code = s.class_code LEFT JOIN class_arms ca ON ca.id = s.class_arm_id WHERE s.id = ?', studentId);
    if (!st) return;
    const classText = status === 'graduated' ? 'GRADUATED' : status === 'left' ? 'LEFT'
      : `${String(st.classLabel || st.class_code || '').toUpperCase()}${st.armName ? ` ${st.armName.toUpperCase()} - ${st.armName.toUpperCase()}` : ''}`;
    run(`INSERT INTO student_class_history (student_id, session_label, class_code, class_arm_id, class_text, form_teacher, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, session_label) DO UPDATE SET class_code = excluded.class_code, class_arm_id = excluded.class_arm_id,
           class_text = excluded.class_text, form_teacher = excluded.form_teacher, recorded_at = excluded.recorded_at`,
      studentId, session, status ? null : st.class_code, status ? null : st.class_arm_id, classText,
      status ? '' : formTeacherFor(st.class_code, st.class_arm_id), nowIso());
  }

  function dobOf(row) {
    const raw = row.dob || row.user_dob || '';
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }

  // Parents / guardians line for a family
  function familyParents() {
    const map = new Map();
    for (const f of all(`SELECT f.id, p1.title AS t1, p1.full_name AS n1, p1.phone AS ph1, p1.relationship AS r1,
                                p2.title AS t2, p2.full_name AS n2, p2.phone AS ph2, p2.relationship AS r2
                         FROM families f LEFT JOIN parents p1 ON p1.id = f.parent1_id LEFT JOIN parents p2 ON p2.id = f.parent2_id`)) {
      map.set(f.id, [[f.t1, f.n1, f.r1, f.ph1], [f.t2, f.n2, f.r2, f.ph2]].filter(p => p[1]).map(([t, n, r, ph]) => ({ name: [t, n].filter(Boolean).join(' '), relationship: r || '', phone: ph || '' })));
    }
    return map;
  }

  const BASE_SELECT = `
    SELECT s.id, s.reg_no AS regNo, s.name, s.initials, s.surname, s.first_name AS firstName, s.other_names AS otherNames, s.gender,
           s.class_code AS classCode, c.label AS classLabel, s.class_arm_id AS classArmId, ca.name AS classArmName,
           s.status, COALESCE(s.archived, 0) AS archived, COALESCE(u.active, 1) AS active, s.photo_path AS photoPath,
           COALESCE(NULLIF(s.student_email, ''), u.email, '') AS email, s.parent_email AS parentEmail, s.family_id AS familyId,
           s.dob, u.dob AS user_dob, s.admission_date AS admissionDate, s.enrolled_at AS enrolledAt, s.phone, s.religion,
           s.nationality, s.state_origin AS state, s.lga_origin AS lga, s.town_origin AS town, s.residential_address AS residentialAddress,
           s.permanent_address AS permanentAddress, s.blood_group AS bloodGroup, s.genotype, s.nin, s.roll_no AS rollNo, s.enrol_session AS session
    FROM students s
    LEFT JOIN users u ON u.id = s.id
    LEFT JOIN classes c ON c.code = s.class_code
    LEFT JOIN class_arms ca ON ca.id = s.class_arm_id`;

  function shape(rows) {
    const fam = familyParents();
    return rows.map(r => ({
      ...r, dob: dobOf(r), user_dob: undefined, active: !!r.active, archived: !!r.archived,
      enrolledOn: String(r.admissionDate || r.enrolledAt || '').slice(0, 10),
      parents: r.familyId ? (fam.get(r.familyId) || []) : [],
    }));
  }

  // ── Excel export (rows of plain text) ─────────────────────────────────
  function xlsx(headers, rows) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const col = i => { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    const row = (cells, r, style) => `<row r="${r}">${cells.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(12, Math.min(40, String(h).length + 6))}" customWidth="1"/>`).join('')}</cols><sheetData>${row(headers, 1, 1)}${rows.map((r, i) => row(r, i + 2)).join('')}</sheetData></worksheet>`;
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
    return zipFiles([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/styles.xml', styles],
    ]);
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/admin/registry') && !p.startsWith('/api/admin/view-students')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const m = req.method;
    try {
      // ── Students Registry ──
      if (m === 'GET' && p === '/api/admin/registry') {
        const status = cleanText(url.searchParams.get('status')) || 'all';
        const gender = cleanText(url.searchParams.get('gender')).toUpperCase() || 'ALL';
        const year = cleanText(url.searchParams.get('year'));
        const rows = shape(all(`${BASE_SELECT} ORDER BY s.name`)).filter(r =>
          (status === 'all' || r.status === status)
          && (gender === 'ALL' || r.gender === gender)
          && (!year || r.enrolledOn.startsWith(year)));
        const count = fn => rows.filter(fn).length;
        return sendJson(res, 200, {
          students: rows,
          counts: {
            total: rows.length, active: count(r => r.status === 'active'), left: count(r => r.status === 'left'),
            graduated: count(r => r.status === 'graduated'), male: count(r => r.gender === 'M'), female: count(r => r.gender === 'F'),
          },
        }), true;
      }
      // Makes each pupil's enrolment status agree with their record: pupils in an
      // archived class count as Left; an empty status becomes Active.
      if (m === 'POST' && p === '/api/admin/registry/sync') {
        const a = run(`UPDATE students SET status = 'active' WHERE status IS NULL OR TRIM(status) = ''`).changes;
        const b = run(`UPDATE students SET status = 'left' WHERE status = 'active' AND class_code IN (SELECT code FROM classes WHERE COALESCE(archived, 0) = 1)`).changes;
        for (const st of all("SELECT id, status FROM students")) recordHistory(st.id, st.status === 'active' ? null : st.status);
        return sendJson(res, 200, { ok: true, updated: a + b }), true;
      }
      if (m === 'GET' && p === '/api/admin/registry/history') {
        const id = cleanText(url.searchParams.get('id')).toUpperCase();
        const rows = all('SELECT session_label AS session, class_text AS classText, form_teacher AS formTeacher FROM student_class_history WHERE student_id = ? ORDER BY session_label DESC', id);
        return sendJson(res, 200, { history: rows }), true;
      }

      // ── View Students ──
      if (m === 'GET' && p === '/api/admin/view-students') {
        const session = cleanText(url.searchParams.get('session')) || activeAcademic()?.sessionLabel;
        const cls = cleanText(url.searchParams.get('classCode'));
        const arm = cleanText(url.searchParams.get('arm'));
        const account = cleanText(url.searchParams.get('account')) || 'all';
        const isCurrent = session === activeAcademic()?.sessionLabel;
        let rows;
        if (isCurrent) {
          rows = shape(all(`${BASE_SELECT} WHERE s.status = 'active' OR ? = 'archived' ORDER BY s.name`, cls));
        } else {
          // an earlier session: pupils as they were then (from class history)
          const hist = new Map(all('SELECT student_id, class_code, class_arm_id, class_text FROM student_class_history WHERE session_label = ?', session).map(h => [h.student_id, h]));
          rows = shape(all(`${BASE_SELECT} ORDER BY s.name`)).filter(r => hist.has(r.id)).map(r => {
            const h = hist.get(r.id);
            return { ...r, classCode: h.class_code, classArmId: h.class_arm_id, classLabel: h.class_text, classArmName: '' };
          });
        }
        rows = rows.filter(r => {
          if (cls === 'archived') return r.archived;
          if (r.archived) return false;
          if (cls === 'unassigned') return !r.classCode;
          if (cls && cls !== 'all' && r.classCode !== cls) return false;
          if (arm === 'unassigned') return !r.classArmId;
          if (arm && arm !== 'all' && String(r.classArmId) !== arm) return false;
          return true;
        }).filter(r => account === 'all' || (account === 'active' ? r.active : !r.active));
        return sendJson(res, 200, { students: rows, session, isCurrent }), true;
      }
      if (m === 'POST' && p === '/api/admin/view-students/action') {
        const body = await readJson(req);
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(id => cleanText(id).toUpperCase()).filter(Boolean);
        if (!ids.length) return sendJson(res, 400, { error: 'Tick at least one student first' }), true;
        const ph = ids.map(() => '?').join(',');
        const action = body.action;
        if (action === 'activate') run(`UPDATE users SET active = 1 WHERE id IN (${ph}) AND role = 'student'`, ...ids);
        else if (action === 'deactivate') run(`UPDATE users SET active = 0 WHERE id IN (${ph}) AND role = 'student'`, ...ids);
        else if (action === 'archive') run(`UPDATE students SET archived = 1 WHERE id IN (${ph})`, ...ids);
        else if (action === 'unarchive') run(`UPDATE students SET archived = 0 WHERE id IN (${ph})`, ...ids);
        else if (action === 'set-session') {
          const session = activeAcademic()?.sessionLabel;
          run(`UPDATE students SET enrol_session = COALESCE(NULLIF(enrol_session, ''), ?), status = 'active', archived = 0 WHERE id IN (${ph})`, session, ...ids);
          ids.forEach(id => recordHistory(id));
        } else return sendJson(res, 400, { error: 'Unknown action' }), true;
        return sendJson(res, 200, { ok: true, updated: ids.length, setup: adminSetupPayload() }), true;
      }
      // Everything the Student Information card shows
      if (m === 'GET' && p === '/api/admin/view-students/profile') {
        const id = cleanText(url.searchParams.get('id')).toUpperCase();
        const rec = pupilRecord(id);
        if (!rec) return sendJson(res, 404, { error: 'Student not found' }), true;
        const st = one(`SELECT s.enrolled_at AS enrolledAt, s.registered_by AS registeredBy, c.label AS classLabel, c.category,
                              ca.name AS armName, ru.name AS registeredByName, ru.role AS registeredByRole
                       FROM students s LEFT JOIN classes c ON c.code = s.class_code LEFT JOIN class_arms ca ON ca.id = s.class_arm_id
                       LEFT JOIN users ru ON ru.id = s.registered_by WHERE s.id = ?`, id);
        const groups = all(`SELECT g.name, m.joined_at AS joinedAt FROM extracurricular_members m JOIN extracurricular_groups g ON g.id = m.group_id
                            WHERE m.student_id = ? ORDER BY g.name`, id);
        const tags = all('SELECT id, name, color FROM student_tags ORDER BY name');
        const tagIds = all('SELECT tag_id AS id FROM student_tag_assignments WHERE student_id = ?', id).map(r => r.id);
        let family = null;
        if (rec.familyId) {
          const f = one('SELECT * FROM families WHERE id = ?', rec.familyId);
          if (f) {
            const parent = pid => {
              const p = pid && one('SELECT * FROM parents WHERE id = ?', pid);
              return p ? { id: p.id, title: p.title || '', fullName: p.full_name, relationship: p.relationship === 'Other' ? (p.relationship_other || 'Other') : (p.relationship || ''),
                occupation: p.occupation || '', phone: p.phone || '', email: p.email || '', address: p.address || '' } : null;
            };
            const wards = all(`SELECT s.id, s.name, s.gender, s.reg_no AS regNo, s.photo_path AS photoPath, s.initials, c.label AS classLabel, ca.name AS armName,
                                      s.status, COALESCE(u.active, 1) AS active
                               FROM students s LEFT JOIN classes c ON c.code = s.class_code LEFT JOIN class_arms ca ON ca.id = s.class_arm_id
                               LEFT JOIN users u ON u.id = s.id WHERE s.family_id = ? ORDER BY s.name`, f.id).map(w => ({ ...w, active: !!w.active }));
            family = { id: f.id, name: f.name, parents: [parent(f.parent1_id), parent(f.parent2_id)].filter(Boolean), wards };
          }
        }
        const results = all(`SELECT rp.id, rp.exam_type AS examType, rp.published_at AS publishedAt, a.session_label AS session, a.term_label AS term, c.label AS classLabel
                             FROM report_publications rp JOIN academic_terms a ON a.id = rp.academic_id LEFT JOIN classes c ON c.code = rp.class_code
                             WHERE rp.student_id = ? ORDER BY rp.published_at DESC`, id);
        const active = one('SELECT COALESCE(active, 1) AS active FROM users WHERE id = ?', id);
        return sendJson(res, 200, {
          student: { ...rec, ...st, active: active ? !!active.active : rec.active },
          groups, tags, tagIds, family, results, school: schoolInfoFromMeta(),
        }), true;
      }
      if (m === 'POST' && p === '/api/admin/view-students/tags') {
        const body = await readJson(req);
        const id = cleanText(body.id).toUpperCase();
        if (!one('SELECT id FROM students WHERE id = ?', id)) return sendJson(res, 404, { error: 'Student not found' }), true;
        run('DELETE FROM student_tag_assignments WHERE student_id = ?', id);
        for (const tagId of (Array.isArray(body.tags) ? body.tags : []).map(Number).filter(Boolean)) {
          if (one('SELECT id FROM student_tags WHERE id = ?', tagId)) {
            run('INSERT OR IGNORE INTO student_tag_assignments (tag_id, student_id, assigned_at) VALUES (?, ?, ?)', tagId, id, nowIso());
          }
        }
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'POST' && p === '/api/admin/view-students/xlsx') {
        const body = await readJson(req);
        const headers = (Array.isArray(body.headers) ? body.headers : []).map(String).slice(0, 60);
        const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 5000).map(r => (Array.isArray(r) ? r : []).slice(0, 60).map(v => String(v ?? '')));
        const buf = xlsx(headers, rows);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${cleanText(body.fileName || 'students').replace(/[^\w.-]+/g, '-')}.xlsx"`,
          'Content-Length': buf.length,
        });
        res.end(buf);
        return true;
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message }), true;
    }
    return false;
  }

  return { createSchema, handle, recordHistory };
};
