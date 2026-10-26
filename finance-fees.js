// Finance › Fees / Bursary and Fees Logs & Reports — fee templates (Publish /
// Manage Class Fees) with fee items that auto-generate an invoice for every
// pupil in the class, quick on-demand invoices, the printable invoice,
// payments (cash / bank / wallet / parent-uploaded proof), families and their
// fees wallets, class invoice history, debtors with e-mail reminders.

module.exports = function createFees(ctx, F) {
  const { one, all, run, cleanText, readJson, sendJson, requireUser, schoolInfoFromMeta, smtpConfigStatus, smtpSend } = ctx;
  const { round2, money, posMoney, flag, nowIso, today } = F;

  const INVOICE_TYPES = ['mandatory', 'ondemand', 'other'];
  const METHODS = ['Cash', 'Bank Payment', 'Bank Transfer', 'POS / Card', 'Cheque', 'USSD', 'Wallet', 'Others'];

  const csv = v => cleanText(v).split(',').map(s => s.trim()).filter(Boolean);

  // ── Invoice rows ───────────────────────────────────────────────────────
  const INVOICE_SELECT = `
    SELECT fi.id, fi.invoice_no AS invoiceNo, fi.title, fi.fee_type AS feeType, fi.description, fi.invoice_type AS invoiceType,
           fi.amount, fi.discount, fi.due_date AS dueDate, fi.hidden, fi.template_id AS templateId,
           fi.part_payment AS partPayment, fi.show_breakdown AS showBreakdown,
           fi.student_id AS studentId, st.name AS studentName, st.reg_no AS regNo, st.parent_email AS parentEmail,
           st.student_email AS studentEmail, st.photo_path AS photoPath, st.family_id AS familyId,
           COALESCE(u.active, 1) AS studentActive,
           fi.academic_id AS academicId, t.session_label AS sessionLabel, t.term_label AS termLabel,
           fi.class_code AS classCode, c.label AS classLabel,
           COALESCE(fi.class_arm_id, st.class_arm_id) AS classArmId, ca.name AS armName,
           fi.created_by AS createdBy, cu.name AS createdByName, fi.created_at AS createdAt,
           (SELECT COALESCE(SUM(fp.amount), 0) FROM fee_payments fp WHERE fp.invoice_id = fi.id AND fp.status = 'successful') AS paid,
           (SELECT COALESCE(SUM(it.amount), 0) FROM fee_invoice_items it WHERE it.invoice_id = fi.id) AS subtotal
    FROM fee_invoices fi
    JOIN students st ON st.id = fi.student_id
    LEFT JOIN users u ON u.id = st.id
    LEFT JOIN users cu ON cu.id = fi.created_by
    JOIN classes c ON c.code = fi.class_code
    LEFT JOIN academic_terms t ON t.id = fi.academic_id
    LEFT JOIN class_arms ca ON ca.id = COALESCE(fi.class_arm_id, st.class_arm_id)`;

  function decorate(r) {
    const amount = round2(r.amount);
    const paid = round2(r.paid);
    const balance = round2(amount - paid);
    const status = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return {
      ...r, amount, paid, balance, status, discount: round2(r.discount), subtotal: round2(r.subtotal || amount + (r.discount || 0)),
      overdue: balance > 0 && !!r.dueDate && r.dueDate < today(),
      hidden: !!r.hidden, studentActive: !!r.studentActive, partPayment: !!r.partPayment, showBreakdown: !!r.showBreakdown,
      title: r.title || r.feeType,
      fullTitle: `${r.title || r.feeType} | ${r.termLabel || ''} | ${r.sessionLabel || ''} ACADEMIC SESSION`.replace(/\|\s*\|/g, '|'),
    };
  }

  function invoiceItems(invoiceId) {
    return all(
      `SELECT it.id, it.name, it.amount, it.description, it.account_id AS accountId, fa.name AS accountName
       FROM fee_invoice_items it LEFT JOIN fin_accounts fa ON fa.id = it.account_id WHERE it.invoice_id = ? ORDER BY it.id`,
      invoiceId
    ).map(i => ({ ...i, amount: round2(i.amount) }));
  }

  // filters: { classCode, armId, session, term, academicIds, titles[], types[], statuses[], search, studentId, studentIds, studentStatus, includeHidden }
  function queryInvoices(f = {}) {
    let sql = `${INVOICE_SELECT} WHERE 1=1`;
    const p = [];
    if (f.classCode) { sql += ' AND fi.class_code = ?'; p.push(f.classCode); }
    if (f.armId === 'none') sql += ' AND COALESCE(fi.class_arm_id, st.class_arm_id) IS NULL';
    else if (f.armId) { sql += ' AND COALESCE(fi.class_arm_id, st.class_arm_id) = ?'; p.push(Number(f.armId)); }
    const ids = f.academicIds || ((f.session || f.term) ? F.termIds(f.session, f.term) : null);
    if (ids) {
      if (!ids.length) return [];
      sql += ` AND fi.academic_id IN (${ids.map(() => '?').join(',')})`; p.push(...ids);
    }
    if (f.studentId) { sql += ' AND fi.student_id = ?'; p.push(f.studentId); }
    if (f.studentIds) {
      if (!f.studentIds.length) return [];
      sql += ` AND fi.student_id IN (${f.studentIds.map(() => '?').join(',')})`; p.push(...f.studentIds);
    }
    if (f.titles && f.titles.length && !f.titles.includes('all')) {
      sql += ` AND COALESCE(fi.title, fi.fee_type) IN (${f.titles.map(() => '?').join(',')})`; p.push(...f.titles);
    }
    if (f.types && f.types.length && f.types.length < 3) {
      sql += ` AND fi.invoice_type IN (${f.types.map(() => '?').join(',')})`; p.push(...f.types);
    }
    if (f.studentStatus === 'active') sql += ' AND COALESCE(u.active, 1) = 1';
    if (f.studentStatus === 'deactivated') sql += ' AND COALESCE(u.active, 1) = 0';
    if (f.hiddenOff) sql += ' AND fi.hidden = 0';
    sql += ' ORDER BY st.name, fi.created_at';
    let rows = all(sql, ...p).map(decorate);
    if (f.statuses && f.statuses.length && f.statuses.length < 3) rows = rows.filter(r => f.statuses.includes(r.status));
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(r => [r.studentName, r.studentId, r.regNo, r.parentEmail, r.studentEmail, r.invoiceNo, r.title]
        .some(v => String(v || '').toLowerCase().includes(q)));
    }
    return rows;
  }
  function invoiceById(id) {
    const r = one(`${INVOICE_SELECT} WHERE fi.id = ?`, Number(id));
    return r ? decorate(r) : null;
  }
  function filtersFrom(url) {
    const g = k => cleanText(url.searchParams.get(k));
    return {
      classCode: g('classCode').toUpperCase(), armId: g('armId'), session: g('session'), term: g('term'),
      titles: csv(g('titles')), types: csv(g('types')), statuses: csv(g('statuses')), search: g('search'),
      studentId: g('studentId').toUpperCase(), studentStatus: g('studentStatus'),
    };
  }
  function totals(rows) {
    return rows.reduce((a, r) => {
      a.count += 1; a.subtotal = round2(a.subtotal + r.subtotal); a.discount = round2(a.discount + r.discount);
      a.total = round2(a.total + r.amount); a.paid = round2(a.paid + r.paid); a.due = round2(a.due + Math.max(0, r.balance));
      return a;
    }, { count: 0, subtotal: 0, discount: 0, total: 0, paid: 0, due: 0 });
  }

  // ── Templates (Publish / Manage Class Fees) ────────────────────────────
  function templateRow(t) {
    const items = all(
      `SELECT ti.id, ti.name, ti.amount, ti.description, ti.account_id AS accountId, fa.name AS accountName
       FROM fee_template_items ti LEFT JOIN fin_accounts fa ON fa.id = ti.account_id WHERE ti.template_id = ? ORDER BY ti.sort_order, ti.id`, t.id
    ).map(i => ({ ...i, amount: round2(i.amount) }));
    const classes = all(
      `SELECT tc.class_code AS classCode, c.label AS classLabel, tc.class_arm_id AS classArmId, ca.name AS armName
       FROM fee_template_classes tc JOIN classes c ON c.code = tc.class_code LEFT JOIN class_arms ca ON ca.id = tc.class_arm_id
       WHERE tc.template_id = ? ORDER BY c.code, ca.name`, t.id);
    const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
    return {
      id: t.id, title: t.title, academicId: t.academic_id, sessionLabel: t.session_label, termLabel: t.term_label,
      invoiceType: t.invoice_type, discount: round2(t.discount), partPayment: !!t.part_payment, showBreakdown: !!t.show_breakdown,
      autoGenerate: !!t.auto_generate, selfGenerate: !!t.self_generate, dueDate: t.due_date,
      items, classes, subtotal, total: round2(Math.max(0, subtotal - t.discount)),
      generatedCount: one('SELECT COUNT(*) AS c FROM fee_invoices WHERE template_id = ?', t.id).c,
      createdAt: t.created_at,
    };
  }
  function templateById(id) {
    const t = one('SELECT ft.*, at.session_label, at.term_label FROM fee_templates ft JOIN academic_terms at ON at.id = ft.academic_id WHERE ft.id = ?', Number(id));
    return t ? templateRow(t) : null;
  }
  function eligibleStudents(templateId) {
    const classes = all('SELECT class_code AS c, class_arm_id AS a FROM fee_template_classes WHERE template_id = ?', templateId);
    const out = new Map();
    classes.forEach(tc => {
      const rows = tc.a
        ? all("SELECT st.id, st.class_code AS classCode, st.class_arm_id AS armId FROM students st LEFT JOIN users u ON u.id = st.id WHERE st.class_code = ? AND st.class_arm_id = ? AND COALESCE(u.active,1) = 1 AND COALESCE(st.archived,0) = 0", tc.c, tc.a)
        : all("SELECT st.id, st.class_code AS classCode, st.class_arm_id AS armId FROM students st LEFT JOIN users u ON u.id = st.id WHERE st.class_code = ? AND COALESCE(u.active,1) = 1 AND COALESCE(st.archived,0) = 0", tc.c);
      rows.forEach(r => out.set(r.id, r));
    });
    return [...out.values()];
  }
  function createInvoice({ studentId, classCode, armId, academicId, title, invoiceType, items, discount, dueDate, partPayment, showBreakdown, templateId, userId }) {
    const subtotal = round2(items.reduce((s, i) => s + money(i.amount), 0));
    const amount = round2(Math.max(0, subtotal - money(discount)));
    const r = run(
      `INSERT INTO fee_invoices (student_id, academic_id, class_code, fee_type, description, amount, due_date, created_by, created_at,
                                 template_id, invoice_no, title, invoice_type, discount, hidden, class_arm_id, part_payment, show_breakdown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      studentId, academicId, classCode, title, null, amount, dueDate || null, userId, nowIso(),
      templateId || null, F.uniqueCode('fee_invoices', 'invoice_no', '#INV', 9), title, invoiceType, money(discount),
      armId || null, partPayment === false ? 0 : 1, showBreakdown === false ? 0 : 1
    );
    const id = Number(r.lastInsertRowid);
    items.forEach(i => run('INSERT INTO fee_invoice_items (invoice_id, name, amount, description, account_id) VALUES (?, ?, ?, ?, ?)',
      id, cleanText(i.name), money(i.amount), cleanText(i.description) || null, Number(i.accountId) || F.defaultFinAccountId()));
    return id;
  }
  function templateItemsForInvoice(t) {
    return t.items.map(i => ({ name: i.name, amount: i.amount, description: i.description, accountId: i.accountId }));
  }
  // Create the missing invoices for a template (every eligible pupil gets one).
  function generateFromTemplate(templateId, userId) {
    const t = templateById(templateId);
    if (!t) return 0;
    let made = 0;
    F.tx(() => {
      eligibleStudents(t.id).forEach(st => {
        if (one('SELECT id FROM fee_invoices WHERE template_id = ? AND student_id = ?', t.id, st.id)) return;
        createInvoice({
          studentId: st.id, classCode: st.classCode, armId: st.armId, academicId: t.academicId, title: t.title, invoiceType: t.invoiceType,
          items: templateItemsForInvoice(t), discount: t.discount, dueDate: t.dueDate, partPayment: t.partPayment,
          showBreakdown: t.showBreakdown, templateId: t.id, userId,
        });
        made += 1;
      });
    });
    return made;
  }
  // Template edits flow into its invoices that have no payment yet.
  function refreshUnpaidFromTemplate(templateId) {
    const t = templateById(templateId);
    if (!t) return;
    all("SELECT id FROM fee_invoices fi WHERE template_id = ? AND NOT EXISTS (SELECT 1 FROM fee_payments fp WHERE fp.invoice_id = fi.id AND fp.status IN ('successful','pending'))", t.id)
      .forEach(inv => {
        run('DELETE FROM fee_invoice_items WHERE invoice_id = ?', inv.id);
        t.items.forEach(i => run('INSERT INTO fee_invoice_items (invoice_id, name, amount, description, account_id) VALUES (?, ?, ?, ?, ?)', inv.id, i.name, i.amount, i.description || null, i.accountId || F.defaultFinAccountId()));
        run('UPDATE fee_invoices SET title = ?, fee_type = ?, amount = ?, discount = ?, due_date = ?, invoice_type = ?, part_payment = ?, show_breakdown = ? WHERE id = ?',
          t.title, t.title, t.total, t.discount, t.dueDate || null, t.invoiceType, t.partPayment ? 1 : 0, t.showBreakdown ? 1 : 0, inv.id);
      });
  }
  // New and newly-promoted pupils pick up auto-generated invoices lazily, whenever fee lists are opened.
  let lastAutoSync = 0;
  function syncAutoTemplates(userId, force = false) {
    if (!force && Date.now() - lastAutoSync < 15000) return;
    lastAutoSync = Date.now();
    all('SELECT id FROM fee_templates WHERE auto_generate = 1').forEach(t => generateFromTemplate(t.id, userId));
  }
  function readTemplateBody(body) {
    const title = cleanText(body.title).toUpperCase();
    if (!title) return { error: 'Invoice title is required' };
    const academicId = Number(body.academicId);
    if (!academicId || !one('SELECT id FROM academic_terms WHERE id = ?', academicId)) return { error: 'Choose the fees session and term' };
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i, n) => ({ name: cleanText(i.name).toUpperCase(), amount: money(i.amount), description: cleanText(i.description), accountId: Number(i.accountId) || null, sort: n }))
      .filter(i => i.name);
    if (!items.length) return { error: 'Add at least one fee item' };
    if (items.some(i => i.amount <= 0)) return { error: 'Every fee item needs an amount' };
    const classes = (Array.isArray(body.classes) ? body.classes : [])
      .map(c => ({ classCode: cleanText(c.classCode).toUpperCase(), armId: Number(c.armId) || null }))
      .filter(c => c.classCode && one('SELECT code FROM classes WHERE code = ?', c.classCode));
    if (!classes.length) return { error: 'Choose at least one class' };
    const invoiceType = INVOICE_TYPES.includes(body.invoiceType) ? body.invoiceType : 'mandatory';
    const discount = money(body.discount);
    if (discount < 0 || discount > items.reduce((s, i) => s + i.amount, 0)) return { error: 'The discount cannot be more than the total' };
    return {
      title, academicId, items, classes, invoiceType, discount, dueDate: cleanText(body.dueDate) || null,
      partPayment: flag(body.partPayment), showBreakdown: body.showBreakdown === undefined ? 1 : flag(body.showBreakdown),
      autoGenerate: flag(body.autoGenerate), selfGenerate: flag(body.selfGenerate),
    };
  }
  function saveTemplateParts(id, v) {
    run('DELETE FROM fee_template_items WHERE template_id = ?', id);
    v.items.forEach(i => run('INSERT INTO fee_template_items (template_id, name, amount, description, account_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      id, i.name, i.amount, i.description || null, i.accountId || F.defaultFinAccountId(), i.sort));
    run('DELETE FROM fee_template_classes WHERE template_id = ?', id);
    v.classes.forEach(c => run('INSERT OR IGNORE INTO fee_template_classes (template_id, class_code, class_arm_id) VALUES (?, ?, ?)', id, c.classCode, c.armId));
  }

  // ── Payments ───────────────────────────────────────────────────────────
  function paymentRows(where, params) {
    return all(
      `SELECT fp.id, fp.invoice_id AS invoiceId, fp.amount, fp.method, fp.reference, fp.status, fp.note, fp.kind,
              fp.attachment_path AS attachmentPath, fp.submitted_by AS submittedBy, fp.account_id AS accountId, fa.name AS accountName,
              fp.recorded_by AS recordedBy, ru.name AS recordedByName, fp.recorded_at AS recordedAt, fp.payment_date AS paymentDate,
              fp.reviewed_by AS reviewedBy, rv.name AS reviewedByName, fp.reviewed_at AS reviewedAt,
              fi.invoice_no AS invoiceNo, COALESCE(fi.title, fi.fee_type) AS title, fi.fee_type AS feeType,
              t.session_label AS sessionLabel, t.term_label AS termLabel,
              fi.class_code AS classCode, c.label AS classLabel, st.id AS studentId, st.name AS studentName, st.reg_no AS regNo,
              (SELECT ie.gl_entry_id FROM income_entries ie WHERE ie.source = 'fee_payment' AND ie.source_id = fp.id) AS glEntryId
       FROM fee_payments fp
       JOIN fee_invoices fi ON fi.id = fp.invoice_id
       JOIN students st ON st.id = fi.student_id
       JOIN classes c ON c.code = fi.class_code
       LEFT JOIN academic_terms t ON t.id = fi.academic_id
       LEFT JOIN users ru ON ru.id = fp.recorded_by
       LEFT JOIN users rv ON rv.id = fp.reviewed_by
       LEFT JOIN fin_accounts fa ON fa.id = fp.account_id
       WHERE ${where} ORDER BY fp.recorded_at DESC`, ...params
    ).map(r => ({
      ...r, amount: round2(r.amount), txnCode: `TXN${String(r.id).padStart(7, '0')}`,
      displayStatus: r.kind === 'proof' ? ({ pending: 'proof_review', failed: 'proof_rejected', successful: 'successful' }[r.status]) : r.status,
      glStatus: r.glEntryId ? 'Posted' : (r.status === 'successful' ? 'Not Posted' : '—'),
    }));
  }
  function addPayment(invoiceId, { amount, method, reference, note, status, kind, attachment, accountId, paymentDate, userId, submittedBy }) {
    const inv = invoiceById(invoiceId);
    if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
    F.assertOpenPeriod(paymentDate || today());
    const r = run(
      `INSERT INTO fee_payments (invoice_id, amount, method, reference, status, note, recorded_by, recorded_at, kind, attachment_path, submitted_by, account_id, payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, amount, method, reference || null, status, note || null, userId, paymentDate ? `${paymentDate}T12:00:00.000Z` : nowIso(),
      kind || 'manual', attachment || null, submittedBy || null, accountId || F.defaultFinAccountId(), paymentDate || today()
    );
    const id = Number(r.lastInsertRowid);
    if (status === 'successful') F.syncFeePaymentIncome(id, userId);
    return id;
  }

  // ── Families & wallets ─────────────────────────────────────────────────
  function familyKeyFor(st) {
    if (st.familyId) return `F${st.familyId}`;
    if (st.parentEmail) return `E:${String(st.parentEmail).toLowerCase()}`;
    return `S:${st.id}`;
  }
  function familiesList() {
    const students = all(
      `SELECT st.id, st.name, st.class_code AS classCode, c.label AS classLabel, ca.name AS armName, st.family_id AS familyId,
              st.parent_email AS parentEmail, COALESCE(u.active,1) AS active, COALESCE(st.status,'active') AS status, COALESCE(st.archived,0) AS archived
       FROM students st JOIN classes c ON c.code = st.class_code LEFT JOIN class_arms ca ON ca.id = st.class_arm_id LEFT JOIN users u ON u.id = st.id
       ORDER BY st.name`
    );
    const fams = new Map();
    students.forEach(st => {
      const key = familyKeyFor(st);
      if (key.startsWith('S:')) return; // a pupil with no family or parent e-mail on file
      if (!fams.has(key)) fams.set(key, { key, familyId: st.familyId || null, parentEmail: st.parentEmail || '', wards: [], parents: [] });
      const graduated = /graduat|left|withdrawn/i.test(`${st.status} ${st.classLabel}`) || !!st.archived;
      fams.get(key).wards.push({ id: st.id, name: st.name, classLabel: st.classLabel, armName: st.armName, active: !!st.active, graduated });
    });
    const hasFamilies = F.tableExists('families') && F.tableExists('parents');
    fams.forEach(f => {
      if (f.familyId && hasFamilies) {
        const fam = one('SELECT name, parent1_id AS p1, parent2_id AS p2 FROM families WHERE id = ?', f.familyId) || {};
        f.name = fam.name || '';
        [fam.p1, fam.p2].filter(Boolean).forEach(pid => {
          const p = one('SELECT id, title, full_name AS name, relationship, phone, email FROM parents WHERE id = ?', pid);
          if (p) f.parents.push(p);
        });
      }
      if (!f.parents.length && f.parentEmail) f.parents.push({ id: null, name: f.parentEmail, relationship: 'Parent / Guardian', email: f.parentEmail, phone: '' });
      const inv = queryInvoices({ studentIds: f.wards.map(w => w.id) });
      const t = totals(inv);
      f.totals = { invoiced: t.total, paid: t.paid, balance: t.due };
      f.walletBalance = walletBalance(f.key);
    });
    return [...fams.values()].sort((a, b) => (a.parents[0]?.name || '').localeCompare(b.parents[0]?.name || ''));
  }
  function walletBalance(key) {
    const r = one("SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE -amount END), 0) AS b FROM fee_wallet_txns WHERE wallet_key = ?", key);
    return round2(r.b);
  }

  // ── Reminders ──────────────────────────────────────────────────────────
  async function sendReminder(studentId, userId) {
    const st = one('SELECT id, name, parent_email AS parentEmail, student_email AS studentEmail FROM students WHERE id = ?', studentId);
    if (!st) return { studentId, status: 'failed', error: 'Pupil not found' };
    const inv = queryInvoices({ studentId }).filter(i => i.balance > 0 && !i.hidden);
    const due = round2(inv.reduce((s, i) => s + i.balance, 0));
    const to = st.parentEmail || st.studentEmail;
    const log = (status, error) => {
      run('INSERT INTO fee_reminders (student_id, sent_to, amount, status, error, sent_by, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)', studentId, to || null, due, status, error || null, userId, nowIso());
      return { studentId, name: st.name, to, status, error: error || '' };
    };
    if (!inv.length) return log('skipped', 'Nothing outstanding');
    if (!to) return log('failed', 'No parent e-mail on file');
    const config = smtpConfigStatus();
    if (!config.configured) return log('failed', `E-mail is not set up (${config.missing.join(', ')})`);
    const school = schoolInfoFromMeta();
    const lines = inv.map(i => `  • ${i.title} (${i.termLabel || ''} ${i.sessionLabel || ''}) — ${i.invoiceNo}: balance ₦${i.balance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}${i.dueDate ? `, due ${i.dueDate}` : ''}`);
    const banks = F.finAccounts({ activeOnly: true }).filter(a => a.showOnInvoice && a.accountNumber)
      .map(a => `  • ${a.bankName || a.name}: ${a.accountNumber} (${a.accountName || a.name})`);
    const text = [
      'Dear Parent / Guardian,', '',
      `This is a friendly reminder that ${st.name} has outstanding school fees of ₦${due.toLocaleString('en-NG', { minimumFractionDigits: 2 })}:`, '',
      ...lines, '',
      ...(banks.length ? ['You can pay into any of these accounts:', ...banks, '', `Please use ${st.name}'s name as the payment description, then upload the payment proof on the pupil portal (Fees page).`, ''] : []),
      'Thank you.', '', school.name, school.phone || '', school.email || '',
    ].join('\r\n');
    const message = [
      `From: ${config.from}`, `To: ${to}`, `Subject: Fees reminder — ${st.name}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text,
    ].join('\r\n');
    try {
      await smtpSend({ host: config.host, port: config.port, user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: config.from, to, message });
      return log('sent');
    } catch (err) {
      return log('failed', err.message);
    }
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    if (p.startsWith('/api/student/fees')) return handleStudent(req, res, url);
    if (!p.startsWith('/api/admin/fees')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;

    if (m === 'GET' && p === '/api/admin/fees/meta') {
      const titles = all('SELECT DISTINCT COALESCE(title, fee_type) AS t FROM fee_invoices ORDER BY t').map(r => r.t);
      const itemNames = [...new Set([
        ...all('SELECT DISTINCT name FROM fee_template_items').map(r => r.name),
        ...all('SELECT DISTINCT name FROM fee_invoice_items').map(r => r.name),
        'SCHOOL FEES', 'SCHOOL BUS', 'TEXTBOOK & STATIONARIES', 'MID-DAY-MEAL', 'EDUCATIONAL RESOURCES', 'P.T.A', 'CLUB ACTIVITY', 'END OF THE YEAR PARTY',
      ])].sort();
      return sendJson(res, 200, {
        sessions: F.sessions(), titles, itemNames, school: schoolInfoFromMeta(), accounts: F.finAccounts({ activeOnly: true }), methods: METHODS,
        smtp: smtpConfigStatus().configured,
      }), true;
    }
    if (m === 'GET' && p === '/api/admin/fees/titles') {
      const f = filtersFrom(url);
      const rows = queryInvoices({ classCode: f.classCode, armId: f.armId, session: f.session, term: f.term });
      return sendJson(res, 200, { titles: [...new Set(rows.map(r => r.title))].sort() }), true;
    }

    // Invoice List
    if (m === 'GET' && p === '/api/admin/fees/invoices') {
      syncAutoTemplates(user.id);
      const f = filtersFrom(url);
      const rows = queryInvoices(f);
      const classTotals = [];
      const byClass = new Map();
      rows.forEach(r => { if (!byClass.has(r.classLabel)) byClass.set(r.classLabel, []); byClass.get(r.classLabel).push(r); });
      byClass.forEach((list, label) => classTotals.push({ classLabel: label, ...totals(list) }));
      const itemTotals = new Map();
      rows.forEach(r => invoiceItems(r.id).forEach(i => itemTotals.set(i.name, round2((itemTotals.get(i.name) || 0) + i.amount))));
      const itemSum = [...itemTotals.values()].reduce((s, v) => s + v, 0);
      const itemSummary = [...itemTotals.entries()].sort((a, b) => b[1] - a[1])
        .map(([name, amount]) => ({ name, amount, share: itemSum ? round2(amount / itemSum * 100) : 0 }));
      return sendJson(res, 200, { invoices: rows, summary: totals(rows), classTotals, itemSummary }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/invoices') {
      const body = await readJson(req);
      const title = cleanText(body.title || body.feeType).toUpperCase();
      if (!title) return sendJson(res, 400, { error: 'Invoice title is required' }), true;
      let items = Array.isArray(body.items) ? body.items.map(i => ({ name: cleanText(i.name).toUpperCase(), amount: money(i.amount), description: cleanText(i.description), accountId: Number(i.accountId) || null })).filter(i => i.name) : [];
      if (!items.length && body.amount) items = [{ name: title, amount: money(body.amount), description: cleanText(body.description) }];
      if (!items.length) return sendJson(res, 400, { error: 'Add at least one fee item' }), true;
      if (items.some(i => i.amount <= 0)) return sendJson(res, 400, { error: 'Every fee item needs an amount' }), true;
      const academicId = Number(body.academicId) || (ctx.activeAcademic() || {}).id;
      if (!academicId) return sendJson(res, 400, { error: 'No active academic term is configured' }), true;
      let students = [];
      const ids = Array.isArray(body.studentIds) ? body.studentIds : body.studentId ? [body.studentId] : [];
      if (ids.length) students = ids.map(id => one('SELECT id, class_code AS classCode, class_arm_id AS armId FROM students WHERE id = ?', cleanText(id).toUpperCase())).filter(Boolean);
      else if (body.classCode) {
        const cc = cleanText(body.classCode).toUpperCase();
        students = body.armId ? all('SELECT id, class_code AS classCode, class_arm_id AS armId FROM students WHERE class_code = ? AND class_arm_id = ?', cc, Number(body.armId))
          : all('SELECT id, class_code AS classCode, class_arm_id AS armId FROM students WHERE class_code = ?', cc);
      }
      if (!students.length) return sendJson(res, 400, { error: 'Select a pupil (or a whole class) to invoice' }), true;
      const discount = money(body.discount);
      if (discount > items.reduce((s, i) => s + i.amount, 0)) return sendJson(res, 400, { error: 'The discount cannot be more than the total' }), true;
      const invoiceType = INVOICE_TYPES.includes(body.invoiceType) ? body.invoiceType : 'ondemand';
      const created = F.tx(() => students.map(st => createInvoice({
        studentId: st.id, classCode: st.classCode, armId: st.armId, academicId, title, invoiceType, items, discount,
        dueDate: cleanText(body.dueDate), partPayment: body.partPayment !== false, showBreakdown: body.showBreakdown !== false, userId: user.id,
      })));
      return sendJson(res, 200, { ok: true, count: created.length, ids: created }), true;
    }
    const invMatch = p.match(/^\/api\/admin\/fees\/invoices\/(\d+)$/);
    if (invMatch) {
      const inv = invoiceById(invMatch[1]);
      if (!inv) return sendJson(res, 404, { error: 'Invoice not found' }), true;
      if (m === 'GET') {
        return sendJson(res, 200, {
          invoice: { ...inv, items: invoiceItems(inv.id), payments: paymentRows('fp.invoice_id = ?', [inv.id]) },
          school: schoolInfoFromMeta(), banks: F.finAccounts({ activeOnly: true }).filter(a => a.showOnInvoice && a.accountNumber),
        }), true;
      }
      if (m === 'PUT') {
        const body = await readJson(req);
        const items = (Array.isArray(body.items) ? body.items : []).map(i => ({ name: cleanText(i.name).toUpperCase(), amount: money(i.amount), description: cleanText(i.description), accountId: Number(i.accountId) || null })).filter(i => i.name);
        if (!items.length || items.some(i => i.amount <= 0)) return sendJson(res, 400, { error: 'Every fee item needs a name and an amount' }), true;
        const discount = money(body.discount);
        const total = round2(items.reduce((s, i) => s + i.amount, 0) - discount);
        if (total < 0) return sendJson(res, 400, { error: 'The discount cannot be more than the total' }), true;
        if (total < inv.paid) return sendJson(res, 400, { error: `₦${inv.paid.toLocaleString()} has already been paid on this invoice — the total cannot go below that` }), true;
        F.tx(() => {
          run('DELETE FROM fee_invoice_items WHERE invoice_id = ?', inv.id);
          items.forEach(i => run('INSERT INTO fee_invoice_items (invoice_id, name, amount, description, account_id) VALUES (?, ?, ?, ?, ?)', inv.id, i.name, i.amount, i.description || null, i.accountId || F.defaultFinAccountId()));
          run('UPDATE fee_invoices SET title = ?, fee_type = ?, amount = ?, discount = ?, due_date = ? WHERE id = ?',
            cleanText(body.title).toUpperCase() || inv.title, cleanText(body.title).toUpperCase() || inv.title, total, discount, cleanText(body.dueDate) || null, inv.id);
        });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (one("SELECT id FROM fee_payments WHERE invoice_id = ? AND status IN ('successful','pending')", inv.id)) {
          return sendJson(res, 400, { error: 'This invoice has payments on it and cannot be deleted' }), true;
        }
        run('DELETE FROM fee_invoices WHERE id = ?', inv.id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    if (m === 'POST' && p === '/api/admin/fees/invoices/visibility') {
      const body = await readJson(req);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
      if (!ids.length) return sendJson(res, 400, { error: 'Select at least one invoice' }), true;
      ids.forEach(id => run('UPDATE fee_invoices SET hidden = ? WHERE id = ?', body.hidden ? 1 : 0, id));
      return sendJson(res, 200, { ok: true, count: ids.length }), true;
    }
    const payMatch = p.match(/^\/api\/admin\/fees\/invoices\/(\d+)\/payments$/);
    if (m === 'POST' && payMatch) {
      const body = await F.readBigJson(req);
      const method = cleanText(body.method);
      if (!method) return sendJson(res, 400, { error: 'Payment method is required' }), true;
      const amount = posMoney(body.amount);
      if (!amount) return sendJson(res, 400, { error: 'Amount must be a positive number' }), true;
      const status = ['successful', 'pending', 'failed'].includes(body.status) ? body.status : 'successful';
      const inv = invoiceById(payMatch[1]);
      if (inv && status === 'successful' && amount > inv.balance + 0.001) {
        return sendJson(res, 400, { error: `That is more than the ₦${inv.balance.toLocaleString()} still due` }), true;
      }
      let attachment = null;
      try { attachment = F.saveDocument(body.attachment, 'payment'); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
      const id = addPayment(Number(payMatch[1]), {
        amount, method, reference: cleanText(body.reference), note: cleanText(body.note), status,
        kind: body.kind === 'proof' ? 'proof' : 'manual', attachment, accountId: Number(body.accountId) || null,
        paymentDate: cleanText(body.paymentDate) || null, userId: user.id,
      });
      return sendJson(res, 200, { ok: true, id, invoice: invoiceById(payMatch[1]) }), true;
    }
    const payStatusMatch = p.match(/^\/api\/admin\/fees\/payments\/(\d+)\/status$/);
    if (m === 'POST' && payStatusMatch) {
      const id = Number(payStatusMatch[1]);
      const pay = one('SELECT id, invoice_id AS invoiceId, status, amount FROM fee_payments WHERE id = ?', id);
      if (!pay) return sendJson(res, 404, { error: 'Payment not found' }), true;
      const body = await readJson(req);
      const status = cleanText(body.status);
      if (!['successful', 'pending', 'failed'].includes(status)) return sendJson(res, 400, { error: 'Invalid status' }), true;
      if (status === 'successful' && pay.status !== 'successful') {
        const inv = invoiceById(pay.invoiceId);
        if (pay.amount > inv.balance + 0.001) return sendJson(res, 400, { error: `Approving this would overpay the invoice (₦${inv.balance.toLocaleString()} due)` }), true;
      }
      run('UPDATE fee_payments SET status = ?, reviewed_by = ?, reviewed_at = ?, note = COALESCE(?, note) WHERE id = ?', status, user.id, nowIso(), cleanText(body.note) || null, id);
      F.syncFeePaymentIncome(id, user.id);
      return sendJson(res, 200, { ok: true, invoice: invoiceById(pay.invoiceId) }), true;
    }
    if (m === 'GET' && p === '/api/admin/fees/payments') {
      const g = k => cleanText(url.searchParams.get(k));
      const where = ['1=1'];
      const params = [];
      if (g('from')) { where.push('date(COALESCE(fp.payment_date, fp.recorded_at)) >= date(?)'); params.push(g('from')); }
      if (g('to')) { where.push('date(COALESCE(fp.payment_date, fp.recorded_at)) <= date(?)'); params.push(g('to')); }
      const methods = csv(g('method'));
      if (methods.length) { where.push(`fp.method IN (${methods.map(() => '?').join(',')})`); params.push(...methods); }
      if (g('invoiceId')) { where.push('fp.invoice_id = ?'); params.push(Number(g('invoiceId'))); }
      let rows = paymentRows(where.join(' AND '), params);
      const status = g('status') || 'all';
      if (status !== 'all') rows = rows.filter(r => r.displayStatus === status || (status === 'pending' && r.status === 'pending' && r.kind !== 'proof') || (status === 'failed' && r.status === 'failed' && r.kind !== 'proof'));
      const ref = g('reference').toLowerCase();
      if (ref) rows = rows.filter(r => String(r.reference || '').toLowerCase() === ref || r.txnCode.toLowerCase() === ref);
      const q = g('search').toLowerCase();
      if (q) rows = rows.filter(r => [r.studentName, r.studentId, r.regNo, r.reference, r.invoiceNo, r.txnCode].some(v => String(v || '').toLowerCase().includes(q)));
      const total = round2(rows.filter(r => r.status === 'successful').reduce((s, r) => s + r.amount, 0));
      return sendJson(res, 200, { payments: rows, total }), true;
    }

    // Students' full history (one pupil or a family)
    if (m === 'GET' && p === '/api/admin/fees/history') {
      const studentId = cleanText(url.searchParams.get('studentId')).toUpperCase();
      const familyKey = cleanText(url.searchParams.get('familyKey'));
      let ids = [];
      if (studentId) ids = [studentId];
      else if (familyKey) {
        const fam = familiesList().find(f => f.key === familyKey);
        ids = fam ? fam.wards.map(w => w.id) : [];
      }
      if (!ids.length) return sendJson(res, 404, { error: 'No matching pupil(s) found' }), true;
      const f = filtersFrom(url);
      const rows = queryInvoices({ studentIds: ids, session: f.session, term: f.term, types: f.types, statuses: f.statuses });
      const admissions = F.tableExists('admission_applications')
        ? ids.map(id => {
          const st = one('SELECT name FROM students WHERE id = ?', id);
          const app = one('SELECT id, status, submitted_at AS submittedAt FROM admission_applications WHERE converted_student_id = ?', id);
          return { studentId: id, name: st ? st.name : id, found: !!app, status: app ? app.status : null, submittedAt: app ? app.submittedAt : null };
        }) : [];
      // per pupil (used by the Class Result Checker's Fees popup)
      const students = ids.map(id => {
        const mine = rows.filter(r => r.studentId === id);
        const t = totals(mine);
        const st = one('SELECT id, name, class_code AS classCode FROM students WHERE id = ?', id) || { id };
        return { ...st, invoices: mine.map(r => ({ ...r, feeType: r.title })), totals: { invoiced: t.total, paid: t.paid, balance: t.due } };
      });
      return sendJson(res, 200, { invoices: rows, summary: totals(rows), admissions, students }), true;
    }

    // Families (Family Fees History)
    if (m === 'GET' && p === '/api/admin/fees/families') {
      const type = cleanText(url.searchParams.get('type')) || 'active';
      let list = familiesList();
      const allActive = f => f.wards.every(w => w.active && !w.graduated);
      const anyActive = f => f.wards.some(w => w.active && !w.graduated);
      const anyLeft = f => f.wards.some(w => w.graduated || !w.active);
      const counts = { families: list.length };
      if (type === 'active') list = list.filter(anyActive);
      else if (type === 'some_left') list = list.filter(anyLeft);
      else if (type === 'all_left') list = list.filter(f => !anyActive(f));
      else if (type === 'none_left') list = list.filter(allActive);
      const stats = {
        families: list.length,
        oneParent: list.filter(f => f.parents.length === 1).length,
        twoParents: list.filter(f => f.parents.length >= 2).length,
        parents: list.reduce((s, f) => s + f.parents.length, 0),
        total: counts.families,
      };
      return sendJson(res, 200, { families: list, stats }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/families/action') {
      const body = await readJson(req);
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const active = body.action === 'activate_wards' ? 1 : body.action === 'deactivate_wards' ? 0 : null;
      if (active === null) return sendJson(res, 400, { error: 'Unknown action' }), true;
      const fams = familiesList().filter(f => keys.includes(f.key));
      let n = 0;
      fams.forEach(f => f.wards.forEach(w => { run('UPDATE users SET active = ? WHERE id = ?', active, w.id); n += 1; }));
      return sendJson(res, 200, { ok: true, count: n }), true;
    }

    // Wallets
    if (m === 'GET' && p === '/api/admin/fees/wallets') {
      const fams = familiesList();
      const keys = all('SELECT DISTINCT wallet_key AS k FROM fee_wallet_txns').map(r => r.k);
      const wallets = keys.map(k => {
        const f = fams.find(x => x.key === k);
        const txns = all('SELECT id, kind, amount, invoice_id AS invoiceId, method, reference, note, created_at AS createdAt FROM fee_wallet_txns WHERE wallet_key = ? ORDER BY id DESC', k);
        return {
          key: k, owner: f ? (f.parents.map(x => x.name).join(' & ') || f.parentEmail) : k, ownerType: 'Family',
          wards: f ? f.wards : [], balance: walletBalance(k), fees: f ? f.totals : null, txns,
        };
      });
      return sendJson(res, 200, { wallets }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/wallets/deposit') {
      const body = await readJson(req);
      const amount = posMoney(body.amount);
      const key = cleanText(body.key);
      if (!key || !amount) return sendJson(res, 400, { error: 'Choose a family and enter a positive amount' }), true;
      run(`INSERT INTO fee_wallet_txns (wallet_key, kind, amount, method, reference, note, account_id, created_by, created_at) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)`,
        key, amount, cleanText(body.method) || 'Bank Payment', cleanText(body.reference) || null, cleanText(body.note) || null, Number(body.accountId) || F.defaultFinAccountId(), user.id, nowIso());
      return sendJson(res, 200, { ok: true, balance: walletBalance(key) }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/wallets/apply') {
      const body = await readJson(req);
      const key = cleanText(body.key);
      const inv = invoiceById(body.invoiceId);
      if (!inv) return sendJson(res, 404, { error: 'Invoice not found' }), true;
      const amount = Math.min(posMoney(body.amount) || inv.balance, inv.balance, walletBalance(key));
      if (amount <= 0) return sendJson(res, 400, { error: 'Nothing to apply — the wallet is empty or the invoice is paid' }), true;
      F.tx(() => {
        const payId = addPayment(inv.id, { amount, method: 'Wallet', reference: `WALLET-${key}`, note: 'Paid from family fees wallet', status: 'successful', userId: user.id });
        run(`INSERT INTO fee_wallet_txns (wallet_key, kind, amount, invoice_id, payment_id, method, created_by, created_at) VALUES (?, 'applied', ?, ?, ?, 'Wallet', ?, ?)`,
          key, amount, inv.id, payId, user.id, nowIso());
      });
      return sendJson(res, 200, { ok: true, applied: amount, balance: walletBalance(key) }), true;
    }

    // Class Invoice History (one row per pupil)
    if (m === 'GET' && p === '/api/admin/fees/class-history') {
      syncAutoTemplates(user.id);
      const f = filtersFrom(url);
      if (!f.classCode) return sendJson(res, 400, { error: 'Choose a class' }), true;
      const rows = queryInvoices({ ...f, statuses: [] });
      let sql = `SELECT st.id, st.name, st.reg_no AS regNo, st.photo_path AS photoPath, c.label AS classLabel, ca.name AS armName, COALESCE(u.active,1) AS active
                 FROM students st JOIN classes c ON c.code = st.class_code LEFT JOIN class_arms ca ON ca.id = st.class_arm_id LEFT JOIN users u ON u.id = st.id
                 WHERE st.class_code = ?`;
      const prm = [f.classCode];
      if (f.armId === 'none') sql += ' AND st.class_arm_id IS NULL';
      else if (f.armId) { sql += ' AND st.class_arm_id = ?'; prm.push(Number(f.armId)); }
      if (f.studentStatus === 'active') sql += ' AND COALESCE(u.active,1) = 1';
      if (f.studentStatus === 'deactivated') sql += ' AND COALESCE(u.active,1) = 0';
      const students = all(`${sql} ORDER BY st.name`, ...prm);
      // pupils who had invoices in this class but have since moved on still appear
      rows.forEach(r => { if (!students.some(s => s.id === r.studentId)) students.push({ id: r.studentId, name: r.studentName, regNo: r.regNo, photoPath: r.photoPath, classLabel: r.classLabel, armName: r.armName, active: r.studentActive ? 1 : 0 }); });
      const tagsFor = id => F.tableExists('student_tag_assignments')
        ? all('SELECT t.name FROM student_tag_assignments a JOIN student_tags t ON t.id = a.tag_id WHERE a.student_id = ?', id).map(r => r.name) : [];
      const list = students.map(s => {
        const mine = rows.filter(r => r.studentId === s.id);
        const t = totals(mine);
        return {
          studentId: s.id, name: s.name, regNo: s.regNo, photoPath: s.photoPath, tags: safe(() => tagsFor(s.id), []),
          sessionTerm: f.session ? `${f.session} ${f.term && f.term !== 'all' ? f.term : ''}`.trim() : '',
          classLabel: `${s.classLabel}${s.armName ? ` - ${s.armName}` : ''}`,
          mandatory: mine.filter(r => r.invoiceType === 'mandatory').length, ondemand: mine.filter(r => r.invoiceType !== 'mandatory').length,
          totalInvoiced: t.subtotal, totalDiscount: t.discount, netTotal: t.total, paid: t.paid, due: t.due,
        };
      });
      return sendJson(res, 200, { students: list, summary: totals(rows) }), true;
    }

    // Fees Debtors
    if (m === 'GET' && p === '/api/admin/fees/debtors') {
      syncAutoTemplates(user.id);
      const f = filtersFrom(url);
      const rows = queryInvoices({ ...f, statuses: [] }).filter(r => r.balance > 0);
      const by = new Map();
      rows.forEach(r => {
        if (!by.has(r.studentId)) by.set(r.studentId, {
          studentId: r.studentId, name: r.studentName, regNo: r.regNo, classLabel: `${r.classLabel}${r.armName ? ` - ${r.armName}` : ''}`,
          parentEmail: r.parentEmail || r.studentEmail || '', invoices: 0, unpaid: 0, overdue: 0, dueDate: null,
        });
        const d = by.get(r.studentId);
        d.invoices += 1; d.unpaid = round2(d.unpaid + r.balance);
        if (r.overdue) d.overdue = round2(d.overdue + r.balance);
        if (r.dueDate && (!d.dueDate || r.dueDate < d.dueDate)) d.dueDate = r.dueDate;
      });
      const debtors = [...by.values()].sort((a, b) => a.name.localeCompare(b.name)).map(d => {
        const last = one('SELECT status, sent_at AS sentAt FROM fee_reminders WHERE student_id = ? ORDER BY id DESC LIMIT 1', d.studentId);
        return { ...d, lastReminder: last || null };
      });
      return sendJson(res, 200, { debtors, total: round2(debtors.reduce((s, d) => s + d.unpaid, 0)) }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/reminders') {
      const body = await readJson(req);
      const ids = (Array.isArray(body.studentIds) ? body.studentIds : []).map(id => cleanText(id).toUpperCase()).filter(Boolean);
      if (!ids.length) return sendJson(res, 400, { error: 'Choose at least one pupil' }), true;
      const results = [];
      for (const id of ids) results.push(await sendReminder(id, user.id));
      const sent = results.filter(r => r.status === 'sent').length;
      return sendJson(res, 200, { ok: true, sent, results }), true;
    }

    // Verify Payment Status — finds a payment by its reference / transaction ID
    if (m === 'POST' && p === '/api/admin/fees/verify') {
      const body = await readJson(req);
      const ref = cleanText(body.reference).toLowerCase();
      if (!ref) return sendJson(res, 400, { error: 'Enter a payment / transaction reference' }), true;
      const rows = paymentRows('1=1', []).filter(r => String(r.reference || '').toLowerCase() === ref || r.txnCode.toLowerCase() === ref);
      return sendJson(res, 200, { payments: rows }), true;
    }

    // Templates
    if (m === 'GET' && p === '/api/admin/fees/templates') {
      const g = k => cleanText(url.searchParams.get(k));
      let sql = 'SELECT ft.*, at.session_label, at.term_label FROM fee_templates ft JOIN academic_terms at ON at.id = ft.academic_id WHERE 1=1';
      const prm = [];
      const ids = (g('session') || g('term')) ? F.termIds(g('session'), g('term')) : null;
      if (ids) { if (!ids.length) return sendJson(res, 200, { templates: [] }), true; sql += ` AND ft.academic_id IN (${ids.map(() => '?').join(',')})`; prm.push(...ids); }
      let list = all(`${sql} ORDER BY ft.id DESC`, ...prm).map(templateRow);
      const cc = g('classCode').toUpperCase();
      const arm = g('armId');
      if (cc && cc !== 'ALL') list = list.filter(t => t.classes.some(c => c.classCode === cc && (!arm || arm === 'all' || !c.classArmId || String(c.classArmId) === arm)));
      const type = g('invoiceType');
      if (type) list = list.filter(t => t.invoiceType === type);
      return sendJson(res, 200, { templates: list }), true;
    }
    if (m === 'POST' && p === '/api/admin/fees/templates') {
      const v = readTemplateBody(await readJson(req));
      if (v.error) return sendJson(res, 400, { error: v.error }), true;
      const id = F.tx(() => {
        const r = run(`INSERT INTO fee_templates (title, academic_id, invoice_type, discount, part_payment, show_breakdown, auto_generate, self_generate, due_date, created_by, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          v.title, v.academicId, v.invoiceType, v.discount, v.partPayment, v.showBreakdown, v.autoGenerate, v.selfGenerate, v.dueDate, user.id, nowIso(), nowIso());
        const tid = Number(r.lastInsertRowid);
        saveTemplateParts(tid, v);
        return tid;
      });
      const generated = v.autoGenerate ? generateFromTemplate(id, user.id) : 0;
      return sendJson(res, 200, { ok: true, id, generated }), true;
    }
    const tMatch = p.match(/^\/api\/admin\/fees\/templates\/(\d+)$/);
    if (tMatch) {
      const t = templateById(tMatch[1]);
      if (!t) return sendJson(res, 404, { error: 'Fee template not found' }), true;
      if (m === 'GET') return sendJson(res, 200, { template: t, school: schoolInfoFromMeta() }), true;
      if (m === 'PUT') {
        const v = readTemplateBody(await readJson(req));
        if (v.error) return sendJson(res, 400, { error: v.error }), true;
        F.tx(() => {
          run(`UPDATE fee_templates SET title = ?, academic_id = ?, invoice_type = ?, discount = ?, part_payment = ?, show_breakdown = ?, auto_generate = ?, self_generate = ?, due_date = ?, updated_at = ? WHERE id = ?`,
            v.title, v.academicId, v.invoiceType, v.discount, v.partPayment, v.showBreakdown, v.autoGenerate, v.selfGenerate, v.dueDate, nowIso(), t.id);
          saveTemplateParts(t.id, v);
        });
        refreshUnpaidFromTemplate(t.id);
        const generated = v.autoGenerate ? generateFromTemplate(t.id, user.id) : 0;
        return sendJson(res, 200, { ok: true, generated }), true;
      }
      if (m === 'DELETE') {
        if (one("SELECT fp.id FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id WHERE fi.template_id = ? AND fp.status IN ('successful','pending')", t.id)) {
          return sendJson(res, 400, { error: 'Pupils have already paid on invoices from this template — switch Auto-generate off instead of deleting it' }), true;
        }
        F.tx(() => {
          run('DELETE FROM fee_invoices WHERE template_id = ?', t.id);
          run('DELETE FROM fee_templates WHERE id = ?', t.id);
        });
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    const tToggle = p.match(/^\/api\/admin\/fees\/templates\/(\d+)\/(toggle|generate)$/);
    if (m === 'POST' && tToggle) {
      const t = templateById(tToggle[1]);
      if (!t) return sendJson(res, 404, { error: 'Fee template not found' }), true;
      if (tToggle[2] === 'generate') return sendJson(res, 200, { ok: true, generated: generateFromTemplate(t.id, user.id) }), true;
      const body = await readJson(req);
      const field = { autoGenerate: 'auto_generate', selfGenerate: 'self_generate' }[body.field];
      if (!field) return sendJson(res, 400, { error: 'Unknown switch' }), true;
      run(`UPDATE fee_templates SET ${field} = ?, updated_at = ? WHERE id = ?`, body.value ? 1 : 0, nowIso(), t.id);
      const generated = field === 'auto_generate' && body.value ? generateFromTemplate(t.id, user.id) : 0;
      return sendJson(res, 200, { ok: true, generated }), true;
    }
    return false;
  }

  function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

  // ── Pupil portal: their fees, invoices and payment proofs ──────────────
  async function handleStudent(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    const user = requireUser(req, res, 'student');
    if (!user) return true;
    if (m === 'GET' && p === '/api/student/fees') {
      syncAutoTemplates(user.id);
      const rows = queryInvoices({ studentId: user.id, hiddenOff: true }).map(r => ({ ...r, items: r.showBreakdown ? invoiceItems(r.id) : [] }));
      const payments = rows.length ? paymentRows(`fp.invoice_id IN (${rows.map(() => '?').join(',')})`, rows.map(r => r.id)) : [];
      const st = one('SELECT class_code AS c, class_arm_id AS a FROM students WHERE id = ?', user.id) || {};
      const selfTemplates = all('SELECT ft.id FROM fee_templates ft WHERE ft.self_generate = 1').map(t => templateById(t.id))
        .filter(t => t.classes.some(c => c.classCode === st.c && (!c.classArmId || c.classArmId === st.a)))
        .filter(t => !one('SELECT id FROM fee_invoices WHERE template_id = ? AND student_id = ?', t.id, user.id))
        .map(t => ({ id: t.id, title: t.title, sessionLabel: t.sessionLabel, termLabel: t.termLabel, total: t.total, items: t.items }));
      return sendJson(res, 200, {
        invoices: rows, payments, summary: totals(rows), selfTemplates,
        school: schoolInfoFromMeta(), banks: F.finAccounts({ activeOnly: true }).filter(a => a.showOnInvoice && a.accountNumber), methods: ['Bank Payment', 'Bank Transfer', 'POS / Card', 'Cash', 'Cheque', 'USSD'],
      }), true;
    }
    const selfGen = p.match(/^\/api\/student\/fees\/templates\/(\d+)\/generate$/);
    if (m === 'POST' && selfGen) {
      const t = templateById(selfGen[1]);
      const st = one('SELECT id, class_code AS classCode, class_arm_id AS armId FROM students WHERE id = ?', user.id);
      if (!t || !t.selfGenerate || !st || !t.classes.some(c => c.classCode === st.classCode && (!c.classArmId || c.classArmId === st.armId))) {
        return sendJson(res, 400, { error: 'This fee is not available for your class' }), true;
      }
      if (one('SELECT id FROM fee_invoices WHERE template_id = ? AND student_id = ?', t.id, st.id)) return sendJson(res, 400, { error: 'You already have this invoice' }), true;
      const id = createInvoice({ studentId: st.id, classCode: st.classCode, armId: st.armId, academicId: t.academicId, title: t.title, invoiceType: t.invoiceType,
        items: templateItemsForInvoice(t), discount: t.discount, dueDate: t.dueDate, partPayment: t.partPayment, showBreakdown: t.showBreakdown, templateId: t.id, userId: user.id });
      return sendJson(res, 200, { ok: true, id }), true;
    }
    const proof = p.match(/^\/api\/student\/fees\/invoices\/(\d+)\/proof$/);
    if (m === 'POST' && proof) {
      const inv = invoiceById(proof[1]);
      if (!inv || inv.studentId !== user.id || inv.hidden) return sendJson(res, 404, { error: 'Invoice not found' }), true;
      const body = await F.readBigJson(req);
      const amount = posMoney(body.amount);
      if (!amount) return sendJson(res, 400, { error: 'Enter the amount you paid' }), true;
      const pending = round2(one("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE invoice_id = ? AND status = 'pending'", inv.id).s);
      if (amount > inv.balance - pending + 0.001) return sendJson(res, 400, { error: `That is more than the ₦${round2(inv.balance - pending).toLocaleString()} still due` }), true;
      if (!inv.partPayment && Math.abs(amount - (inv.balance - pending)) > 0.001) return sendJson(res, 400, { error: 'Part payment is not allowed on this invoice — please pay the full balance' }), true;
      if (!cleanText(body.attachment)) return sendJson(res, 400, { error: 'Attach the payment receipt or proof' }), true;
      let attachment;
      try { attachment = F.saveDocument(body.attachment, 'proof'); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
      const id = addPayment(inv.id, {
        amount, method: cleanText(body.method) || 'Bank Payment', reference: cleanText(body.reference), note: cleanText(body.note),
        status: 'pending', kind: 'proof', attachment, paymentDate: cleanText(body.paymentDate) || today(), userId: user.id, submittedBy: user.id,
      });
      return sendJson(res, 200, { ok: true, id }), true;
    }
    return false;
  }

  return { handle, queryInvoices, invoiceById, totals };
};
