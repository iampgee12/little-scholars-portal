// Finance: shared schema, money helpers and the links that tie the finance
// screens together — a successful fee payment becomes "School Fees" income, a
// paid salary or dispensed request becomes an expense, a store sale becomes
// income, and (when Auto-Posting is on) each of those also posts a balanced
// journal entry to the General Ledger. Mirrors SchoolsFocus' Finance module.
//
// server.js passes in its database helpers (ctx). The route files
// (finance-fees.js, finance-books.js, finance-payroll.js, finance-store.js,
// finance-acct.js) all share the helpers returned from here.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function createFinance(ctx) {
  const { db, one, all, run, ensureColumn, valueFromMeta, setMeta, cleanText, UPLOAD_DIR, DATA_DIR } = ctx;

  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const money = v => { const n = Number(v); return Number.isFinite(n) ? round2(n) : 0; };
  const posMoney = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? round2(n) : null; };
  const flag = v => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0;

  // Who system-made rows (backfills, migrations) are recorded against.
  function systemUserId() {
    const row = one("SELECT id FROM users WHERE id = 'ADM-001'") || one("SELECT id FROM users WHERE role = 'admin' ORDER BY rowid LIMIT 1");
    return row ? row.id : null;
  }
  function tableExists(name) {
    return !!one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
  }
  function columns(table) {
    return all(`PRAGMA table_info(${table})`).map(r => r.name);
  }
  function tx(fn) {
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
  // Rebuilds a table whose CHECK constraint is too narrow (SQLite can't alter a CHECK).
  function rebuildTable(table, createSql, copyColumns) {
    const tmp = `${table}__old`;
    tx(() => {
      db.exec(`ALTER TABLE ${table} RENAME TO ${tmp}`);
      db.exec(createSql);
      const cols = copyColumns.filter(c => columns(tmp).includes(c));
      db.exec(`INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.join(',')} FROM ${tmp}`);
      db.exec(`DROP TABLE ${tmp}`);
    });
  }

  // ── Uploaded documents (payment proofs, receipts, loan documents) ──────
  const DOC_DIR = path.join(UPLOAD_DIR, 'finance-docs');
  const DOC_TYPES = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  function saveDocument(dataUrl, prefix) {
    const raw = cleanText(dataUrl);
    if (!raw) return null;
    const match = raw.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i);
    if (!match) throw new Error('The attachment could not be read');
    const ext = DOC_TYPES[match[1].toLowerCase()];
    if (!ext) throw new Error('Allowed formats: JPG, PNG, PDF, DOC, DOCX, XLS, XLSX');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('The attachment is larger than 5MB');
    fs.mkdirSync(DOC_DIR, { recursive: true });
    const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(DOC_DIR, fileName), bytes);
    return path.relative(DATA_DIR, path.join(DOC_DIR, fileName)).replace(/\\/g, '/');
  }
  // JSON bodies that may carry a 5MB attachment (base64 adds a third).
  function readBigJson(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 8_000_000) { req.destroy(); reject(new Error('Request body too large')); }
      });
      req.on('end', () => {
        if (!body) return resolve((req.finBody = {}));
        try { resolve((req.finBody = JSON.parse(body))); } catch { reject(new Error('Invalid JSON body')); }
      });
      req.on('error', reject);
    });
  }

  // ── Excel imports (.xlsx data URL → rows; dates may arrive as serial numbers) ──
  function readSheet(dataUrl) {
    const match = cleanText(dataUrl).match(/^data:[^;]*;base64,(.+)$/);
    if (!match) throw Object.assign(new Error('Choose the Excel (.xlsx) file'), { status: 400 });
    let parsed;
    try { parsed = ctx.parseXlsxFirstSheet(Buffer.from(match[1], 'base64')); } catch (err) {
      throw Object.assign(new Error(`Could not read this file: ${err.message}`), { status: 400 });
    }
    const key = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = parsed.headers.map(key);
    const col = (...names) => { for (const n of names) { const i = keys.indexOf(key(n)); if (i !== -1) return i; } return -1; };
    const cell = (row, i) => (i === -1 ? '' : String(row[i] ?? '').trim());
    const date = (row, i) => {
      const v = cell(row, i);
      if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000).toISOString().slice(0, 10);
      const dmy = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
    };
    return { headers: parsed.headers, rows: parsed.rows.filter(r => r.some(c => String(c ?? '').trim())), col, cell, date };
  }

  // ── Settings stored in schema_meta as JSON ─────────────────────────────
  function getJsonMeta(key, fallback) {
    const raw = valueFromMeta(key, '');
    if (!raw) return fallback;
    try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
  }
  function setJsonMeta(key, value) { setMeta(key, JSON.stringify(value)); }

  // ── Codes (invoice no., voucher no., loan code …) ──────────────────────
  function randomCode(prefix, length = 9) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < length; i++) s += chars[crypto.randomInt(chars.length)];
    return `${prefix}${s}`;
  }
  function uniqueCode(table, column, prefix, length) {
    for (;;) {
      const code = randomCode(prefix, length);
      if (!one(`SELECT 1 FROM ${table} WHERE ${column} = ?`, code)) return code;
    }
  }
  function sequenceCode(table, column, prefix, pad = 4) {
    const rows = all(`SELECT ${column} AS c FROM ${table} WHERE ${column} LIKE ?`, `${prefix}%`);
    const max = rows.reduce((m, r) => Math.max(m, Number(String(r.c).slice(prefix.length)) || 0), 0);
    return `${prefix}${String(max + 1).padStart(pad, '0')}`;
  }
  function voucherNo() {
    const d = today().replace(/-/g, '');
    return `#EXP-${d}-${randomCode('', 4)}`;
  }

  // ── Sessions & terms ───────────────────────────────────────────────────
  function sessions() {
    return all('SELECT id, session_label AS sessionLabel, term_label AS termLabel, is_active AS isActive FROM academic_terms ORDER BY session_label DESC, id')
      .map(t => ({ ...t, isActive: !!t.isActive }));
  }
  function termIds(sessionLabel, termLabel) {
    let sql = 'SELECT id FROM academic_terms WHERE 1=1';
    const p = [];
    if (sessionLabel && sessionLabel !== 'all') { sql += ' AND session_label = ?'; p.push(sessionLabel); }
    if (termLabel && termLabel !== 'all') { sql += ' AND term_label = ?'; p.push(termLabel); }
    return all(sql, ...p).map(r => r.id);
  }
  // Session dates: 1 Sep → 31 Aug, read from a "2026-2027" label.
  function sessionRange(label) {
    const m = String(label || '').match(/(\d{4})\D+(\d{4})/);
    if (!m) return null;
    return { from: `${m[1]}-09-01`, to: `${m[2]}-08-31` };
  }

  // ── Operating accounts (school bank / cash accounts) ───────────────────
  function finAccounts({ activeOnly = false } = {}) {
    return all(
      `SELECT fa.id, fa.name, fa.bank_name AS bankName, fa.account_number AS accountNumber, fa.account_name AS accountName,
              fa.type, fa.opening_balance AS openingBalance, fa.track_balance AS trackBalance,
              fa.coa_account_id AS coaAccountId, a.code AS coaCode, a.name AS coaName,
              fa.is_default AS isDefault, fa.is_active AS isActive, fa.show_on_invoice AS showOnInvoice
       FROM fin_accounts fa LEFT JOIN acct_accounts a ON a.id = fa.coa_account_id
       ${activeOnly ? 'WHERE fa.is_active = 1' : ''}
       ORDER BY fa.is_default DESC, fa.name, fa.id`
    ).map(r => ({
      ...r, trackBalance: !!r.trackBalance, isDefault: !!r.isDefault, isActive: !!r.isActive, showOnInvoice: !!r.showOnInvoice,
      label: accountLabel(r),
    }));
  }
  function accountLabel(a) {
    if (!a) return '';
    return [a.name, a.bankName, a.accountNumber, a.accountName].filter(Boolean).join(' | ');
  }
  function defaultFinAccountId() {
    const row = one('SELECT id FROM fin_accounts WHERE is_default = 1 ORDER BY id LIMIT 1') || one('SELECT id FROM fin_accounts ORDER BY id LIMIT 1');
    return row ? row.id : null;
  }
  function finAccountById(id) {
    return id ? finAccounts().find(a => a.id === Number(id)) || null : null;
  }

  // ── Chart of accounts helpers ──────────────────────────────────────────
  function coaByCode(code) {
    return one('SELECT id, code, name, type, normal_balance AS normalBalance FROM acct_accounts WHERE code = ?', String(code));
  }
  function coaId(code) {
    const a = coaByCode(code);
    return a ? a.id : null;
  }

  // ── Period locks ───────────────────────────────────────────────────────
  function lockedPeriodFor(date) {
    if (!date) return null;
    return one(
      `SELECT session_label AS sessionLabel, term_label AS termLabel, from_date AS fromDate, to_date AS toDate
       FROM acct_period_locks WHERE status = 'locked' AND ? BETWEEN from_date AND to_date LIMIT 1`,
      String(date).slice(0, 10)
    );
  }
  function assertOpenPeriod(date) {
    const lock = lockedPeriodFor(date);
    if (lock) {
      const err = new Error(`${lock.sessionLabel} ${lock.termLabel || ''} is locked — nothing can be posted to ${String(date).slice(0, 10)}`.replace(/\s+/g, ' '));
      err.status = 400;
      throw err;
    }
  }

  // ── General Ledger posting ─────────────────────────────────────────────
  function autoPostingOn() {
    return valueFromMeta('acct_auto_posting', '0') === '1';
  }
  function nextEntryNo() {
    return sequenceCode('acct_journal_entries', 'entry_no', 'JE-', 5);
  }
  // lines: [{ accountId, debit, credit, description }] — must balance.
  function postJournal({ date, memo, type = 'manual', source = null, sourceId = null, lines, userId, status = 'posted' }) {
    const clean = lines.filter(l => l.accountId && (money(l.debit) > 0 || money(l.credit) > 0));
    const dr = round2(clean.reduce((s, l) => s + money(l.debit), 0));
    const cr = round2(clean.reduce((s, l) => s + money(l.credit), 0));
    if (clean.length < 2 || Math.abs(dr - cr) > 0.01) throw new Error('Journal entry does not balance');
    assertOpenPeriod(date);
    const entryNo = nextEntryNo();
    const result = run(
      `INSERT INTO acct_journal_entries (entry_no, entry_date, memo, created_by, created_at, entry_type, status, source, source_id, posted_by, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entryNo, String(date).slice(0, 10), memo || null, userId || null, nowIso(), type, status, source, sourceId,
      status === 'posted' ? (userId || null) : null, status === 'posted' ? nowIso() : null
    );
    const entryId = Number(result.lastInsertRowid);
    clean.forEach(l => run(
      'INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)',
      entryId, l.accountId, money(l.debit), money(l.credit), l.description || null
    ));
    return { entryId, entryNo };
  }
  function reverseJournal(entryId, userId, memo) {
    const entry = one('SELECT * FROM acct_journal_entries WHERE id = ?', entryId);
    if (!entry || entry.status === 'reversed') return null;
    const lines = all('SELECT account_id AS accountId, debit, credit, description FROM acct_journal_lines WHERE entry_id = ?', entryId);
    const rev = postJournal({
      date: today(), memo: memo || `Reversal of ${entry.entry_no}`, type: 'accrual_reversal', source: 'reversal', sourceId: entryId,
      lines: lines.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })), userId,
    });
    run("UPDATE acct_journal_entries SET status = 'reversed' WHERE id = ?", entryId);
    return rev;
  }
  // The CoA account a bank/cash account maps to (falls back to 1200 Bank / 1100 Cash).
  function cashCoaFor(finAccountId) {
    const a = finAccountById(finAccountId);
    if (a && a.coaAccountId) return a.coaAccountId;
    return coaId(a && a.type === 'bank' ? '1200' : '1100') || coaId('1100') || coaId('1200');
  }
  function categoryCoa(type, name, fallbackCode) {
    const row = one('SELECT coa_account_id AS id FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND parent_id IS NULL', type, name || '');
    return (row && row.id) || coaId(fallbackCode);
  }

  // Post an income row to the GL (DR bank/cash, CR the income head's account).
  function glPostIncome(incomeId, userId, force = false) {
    if (!force && !autoPostingOn()) return null;
    const inc = one('SELECT * FROM income_entries WHERE id = ?', incomeId);
    if (!inc || inc.gl_entry_id) return null;
    const fallback = inc.source === 'fee_payment' ? '4100' : inc.source === 'store_sale' ? '4320' : inc.source === 'loan_repayment' ? '1500' : '4200';
    const crAccount = inc.source === 'fee_payment' ? coaId('4100') : categoryCoa('income', inc.category, fallback);
    const drAccount = cashCoaFor(inc.account_id);
    if (!crAccount || !drAccount) return null;
    const type = { fee_payment: 'fee_payment', store_sale: inc.description && /storefront/i.test(inc.description) ? 'storefront_sale' : 'pos_sale' }[inc.source] || 'manual';
    const { entryId } = postJournal({
      date: inc.income_date, memo: `${inc.category}: ${inc.description || ''}`.trim(), type, source: 'income', sourceId: inc.id, userId,
      lines: [{ accountId: drAccount, debit: inc.amount }, { accountId: crAccount, credit: inc.amount }],
    });
    run('UPDATE income_entries SET gl_entry_id = ? WHERE id = ?', entryId, inc.id);
    return entryId;
  }
  function glPostExpense(expenseId, userId, force = false) {
    if (!force && !autoPostingOn()) return null;
    const exp = one('SELECT * FROM expenses WHERE id = ?', expenseId);
    if (!exp || exp.gl_entry_id) return null;
    const fallback = exp.source === 'salary' ? '5100' : exp.source === 'loan_disbursement' ? '1500' : '5250';
    const drAccount = exp.source === 'salary' ? coaId('5100') : exp.source === 'loan_disbursement' ? coaId('1500') : categoryCoa('expense', exp.category, fallback);
    const crAccount = cashCoaFor(exp.account_id);
    if (!crAccount || !drAccount) return null;
    const type = exp.source === 'salary' ? 'payroll' : exp.source === 'requisition' ? 'requisition' : 'manual';
    const { entryId } = postJournal({
      date: exp.expense_date, memo: `${exp.category}: ${exp.description || ''}`.trim(), type, source: 'expense', sourceId: exp.id, userId,
      lines: [{ accountId: drAccount, debit: exp.amount }, { accountId: crAccount, credit: exp.amount }],
    });
    run('UPDATE expenses SET gl_entry_id = ? WHERE id = ?', entryId, exp.id);
    return entryId;
  }
  function glUnpost(table, id, userId) {
    const row = one(`SELECT gl_entry_id AS g FROM ${table} WHERE id = ?`, id);
    if (row && row.g) {
      reverseJournal(row.g, userId);
      run(`UPDATE ${table} SET gl_entry_id = NULL WHERE id = ?`, id);
    }
  }

  // ── Links: things that create income / expense rows ────────────────────
  function addIncome({ category, item, description, amount, date, userId, source = 'manual', sourceId = null, accountId = null, method = null, receivedFrom = null, voucherNo: vno = null, attachment = null }) {
    assertOpenPeriod(date);
    const r = run(
      `INSERT INTO income_entries (category, item, description, amount, income_date, recorded_by, created_at, source, source_id, account_id, method, received_from, voucher_no, attachment_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      category, item || null, description || null, round2(amount), String(date).slice(0, 10), userId, nowIso(), source, sourceId,
      accountId || defaultFinAccountId(), method, receivedFrom, vno, attachment
    );
    const id = Number(r.lastInsertRowid);
    glPostIncome(id, userId);
    return id;
  }
  function addExpense({ category, item, title, description, amount, date, userId, source = 'manual', sourceId = null, requestId = null, accountId = null, method = null, paidTo = null, voucherNo: vno = null, attachment = null, approvedBy = null }) {
    assertOpenPeriod(date);
    const r = run(
      `INSERT INTO expenses (category, item, title, description, amount, expense_date, request_id, recorded_by, created_at, source, source_id, account_id, method, paid_to, voucher_no, attachment_path, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      category, item || null, title || null, description || null, round2(amount), String(date).slice(0, 10), requestId, userId, nowIso(),
      source, sourceId, accountId || defaultFinAccountId(), method, paidTo, vno, attachment, approvedBy
    );
    const id = Number(r.lastInsertRowid);
    glPostExpense(id, userId);
    return id;
  }
  function removeLinked(table, source, sourceId, userId) {
    all(`SELECT id FROM ${table} WHERE source = ? AND source_id = ?`, source, sourceId).forEach(r => {
      glUnpost(table, r.id, userId);
      run(`DELETE FROM ${table} WHERE id = ?`, r.id);
    });
  }

  // A fee payment's income row exists exactly while the payment is successful.
  function syncFeePaymentIncome(paymentId, userId) {
    const p = one(
      `SELECT fp.id, fp.amount, fp.status, fp.method, fp.reference, fp.recorded_at AS recordedAt, fp.recorded_by AS recordedBy,
              fp.account_id AS accountId, fi.title, fi.fee_type AS feeType, fi.invoice_no AS invoiceNo, st.name AS studentName
       FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students st ON st.id = fi.student_id
       WHERE fp.id = ?`, paymentId
    );
    const existing = one("SELECT id FROM income_entries WHERE source = 'fee_payment' AND source_id = ?", paymentId);
    if (!p || p.status !== 'successful') {
      if (existing) removeLinked('income_entries', 'fee_payment', paymentId, userId);
      return;
    }
    if (existing) return;
    addIncome({
      category: 'School Fees', item: p.title || p.feeType,
      description: `${p.studentName} — ${p.title || p.feeType}${p.invoiceNo ? ` (${p.invoiceNo})` : ''}`,
      amount: p.amount, date: String(p.recordedAt).slice(0, 10), userId: userId || p.recordedBy || systemUserId(),
      source: 'fee_payment', sourceId: p.id, accountId: p.accountId, method: p.method, receivedFrom: p.studentName,
    });
  }

  // ── Schema ─────────────────────────────────────────────────────────────
  const SF_COA = [
    // code, name, type, normal, parent code, group?
    ['1000', 'Assets', 'asset', 'debit', null, 1],
    ['1100', 'Cash Accounts', 'asset', 'debit', '1000'],
    ['1200', 'Bank Accounts', 'asset', 'debit', '1000'],
    ['1300', 'Inventory Asset', 'asset', 'debit', '1000'],
    ['1400', 'Accounts Receivable', 'asset', 'debit', '1000'],
    ['1500', 'Staff Loans Receivable', 'asset', 'debit', '1000'],
    ['2000', 'Liabilities', 'liability', 'credit', null, 1],
    ['2100', 'Accounts Payable', 'liability', 'credit', '2000'],
    ['2170', 'WHT Payable', 'liability', 'credit', '2000'],
    ['2180', 'VAT Payable', 'liability', 'credit', '2000'],
    ['2181', 'VAT Output — Uncollected', 'liability', 'credit', '2000'],
    ['2200', 'PAYE Tax Payable', 'liability', 'credit', '2000'],
    ['2210', 'Pension Payable (Employee)', 'liability', 'credit', '2000'],
    ['2220', 'NHIS Payable', 'liability', 'credit', '2000'],
    ['2230', 'NHF Payable', 'liability', 'credit', '2000'],
    ['2300', 'Pension Payable (Employer)', 'liability', 'credit', '2000'],
    ['3000', 'Equity / Fund Balance', 'equity', 'credit', null, 1],
    ['4000', 'Revenue', 'income', 'credit', null, 1],
    ['4100', 'School Fees Income', 'income', 'credit', '4000'],
    ['4110', 'Admission Fees Income', 'income', 'credit', '4000'],
    ['4120', 'Course Registration Fees', 'income', 'credit', '4000'],
    ['4130', 'Scratch Card & Result Checker Sales', 'income', 'credit', '4000'],
    ['4140', 'Activity & Club Joining Fees', 'income', 'credit', '4000'],
    ['4150', 'Library Fines Income', 'income', 'credit', '4000'],
    ['4160', 'Hostel Fees Income', 'income', 'credit', '4000'],
    ['4170', 'Transport Fees Income', 'income', 'credit', '4000'],
    ['4200', 'Other Income', 'income', 'credit', '4000'],
    ['4210', 'Discount Received', 'income', 'credit', '4000'],
    ['4220', 'Foreign Exchange Gain', 'income', 'credit', '4000'],
    ['4300', 'Storefront Sales', 'income', 'credit', '4000'],
    ['4320', 'POS Sales Income', 'income', 'credit', '4000'],
    ['5000', 'Expenses', 'expense', 'debit', null, 1],
    ['5100', 'Salaries & Wages', 'expense', 'debit', '5000'],
    ['5110', 'Pension Expense (Employer)', 'expense', 'debit', '5000'],
    ['5120', 'NHIS Expense (Employer)', 'expense', 'debit', '5000'],
    ['5200', 'Administrative Expenses', 'expense', 'debit', '5000'],
    ['5250', 'Operating Expenses', 'expense', 'debit', '5000'],
    ['5300', 'Internal Stock Usage', 'expense', 'debit', '5000'],
    ['5350', 'Cost of Goods Sold', 'expense', 'debit', '5000'],
    ['5360', 'Inventory Write-Off', 'expense', 'debit', '5000'],
    ['5400', 'Staff Welfare Expense', 'expense', 'debit', '5000'],
    ['5420', 'Foreign Exchange Loss', 'expense', 'debit', '5000'],
    ['5500', 'Discount Allowed', 'expense', 'debit', '5000'],
  ];
  const SYSTEM_EXPENSE_HEADS = [
    ['Payroll Statutory Remittances', 'SYS_PAYROLL_REMIT', '5250'],
    ['Salaries & Staff Wages', 'SYS_PAYROLL_SALARY', '5100'],
    ['Staff Loans & Advances Disbursed', 'SYS_LOAN_DISBURSE', '1500'],
    ['Tax Remittances', 'SYS_TAX_REMITTANCE', '5250'],
    ['Internal Stock Usage', 'SYS_STOCK_USAGE', '5300'],
  ];
  const SYSTEM_INCOME_HEADS = [
    ['School Fees', 'SYS_FEES', '4100'],
    ['Admission Application Fees', 'SYS_ADMISSION', '4110'],
    ['Course Registration Fees', 'SYS_COURSE_REG', '4120'],
    ['Scratch Card & Result Checker Purchases', 'SYS_SCRATCH', '4130'],
    ['Extracurricular Activity & Club Fees', 'SYS_CLUB', '4140'],
    ['Library Fines', 'SYS_LIBRARY', '4150'],
    ['Hostel Fees', 'SYS_HOSTEL', '4160'],
    ['Transport Fees', 'SYS_TRANSPORT', '4170'],
    ['Other Income', 'SYS_OTHER', '4200'],
    ['Storefront Sales', 'SYS_STOREFRONT', '4300'],
    ['POS Sales', 'SYS_POS', '4320'],
    ['Staff Loan Repayments Received', 'SYS_LOAN_REPAY', '1500'],
  ];

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fin_accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        bank_name TEXT,
        account_number TEXT,
        account_name TEXT,
        type TEXT NOT NULL DEFAULT 'bank',
        opening_balance REAL NOT NULL DEFAULT 0,
        track_balance INTEGER NOT NULL DEFAULT 1,
        coa_account_id INTEGER REFERENCES acct_accounts(id) ON DELETE SET NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        show_on_invoice INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fee_templates (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        academic_id INTEGER NOT NULL REFERENCES academic_terms(id),
        invoice_type TEXT NOT NULL DEFAULT 'mandatory',
        discount REAL NOT NULL DEFAULT 0,
        part_payment INTEGER NOT NULL DEFAULT 0,
        show_breakdown INTEGER NOT NULL DEFAULT 1,
        auto_generate INTEGER NOT NULL DEFAULT 0,
        self_generate INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS fee_template_items (
        id INTEGER PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES fee_templates(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        description TEXT,
        account_id INTEGER REFERENCES fin_accounts(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS fee_template_classes (
        template_id INTEGER NOT NULL REFERENCES fee_templates(id) ON DELETE CASCADE,
        class_code TEXT NOT NULL,
        class_arm_id INTEGER,
        UNIQUE(template_id, class_code, class_arm_id)
      );
      CREATE TABLE IF NOT EXISTS fee_invoice_items (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        description TEXT,
        account_id INTEGER REFERENCES fin_accounts(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS fee_reminders (
        id INTEGER PRIMARY KEY,
        student_id TEXT NOT NULL,
        sent_to TEXT,
        amount REAL,
        status TEXT NOT NULL,
        error TEXT,
        sent_by TEXT,
        sent_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fee_wallet_txns (
        id INTEGER PRIMARY KEY,
        wallet_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount REAL NOT NULL,
        invoice_id INTEGER,
        payment_id INTEGER,
        method TEXT,
        reference TEXT,
        note TEXT,
        account_id INTEGER,
        created_by TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pay_grade_levels (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        numeric_level INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS pay_grade_steps (
        id INTEGER PRIMARY KEY,
        grade_level_id INTEGER NOT NULL REFERENCES pay_grade_levels(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        numeric_step INTEGER NOT NULL DEFAULT 1,
        basic_salary REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pay_positions (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        department TEXT,
        default_grade_level_id INTEGER REFERENCES pay_grade_levels(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS staff_contracts (
        id INTEGER PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position_id INTEGER REFERENCES pay_positions(id) ON DELETE SET NULL,
        contract_type TEXT NOT NULL DEFAULT 'permanent',
        start_date TEXT,
        end_date TEXT,
        probation_end TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS staff_payroll_profiles (
        staff_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        grade_step_id INTEGER REFERENCES pay_grade_steps(id) ON DELETE SET NULL,
        position_id INTEGER REFERENCES pay_positions(id) ON DELETE SET NULL,
        payment_channel TEXT NOT NULL DEFAULT 'Cash Payment',
        account_number TEXT,
        account_name TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS staff_pay_items (
        id INTEGER PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS paye_configs (
        id INTEGER PRIMARY KEY,
        effective_from TEXT NOT NULL,
        pension_emp REAL NOT NULL DEFAULT 8,
        pension_er REAL NOT NULL DEFAULT 10,
        nhis REAL NOT NULL DEFAULT 1.75,
        nhf REAL NOT NULL DEFAULT 2.5,
        cra_fixed REAL NOT NULL DEFAULT 200000,
        bands TEXT NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS loan_repayments (
        id INTEGER PRIMARY KEY,
        loan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        salary_id INTEGER,
        note TEXT,
        paid_at TEXT NOT NULL,
        recorded_by TEXT
      );

      CREATE TABLE IF NOT EXISTS pos_shifts (
        id INTEGER PRIMARY KEY,
        opened_by TEXT,
        opened_at TEXT NOT NULL,
        opening_cash REAL NOT NULL DEFAULT 0,
        closed_by TEXT,
        closed_at TEXT,
        closing_cash REAL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'open'
      );
      CREATE TABLE IF NOT EXISTS store_purchase_orders (
        id INTEGER PRIMARY KEY,
        po_code TEXT NOT NULL UNIQUE,
        contact_id INTEGER REFERENCES acct_contacts(id) ON DELETE SET NULL,
        order_date TEXT NOT NULL,
        expected_date TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS store_po_items (
        id INTEGER PRIMARY KEY,
        po_id INTEGER NOT NULL REFERENCES store_purchase_orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES store_products(id) ON DELETE SET NULL,
        description TEXT,
        qty REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS store_grns (
        id INTEGER PRIMARY KEY,
        grn_code TEXT NOT NULL UNIQUE,
        po_id INTEGER REFERENCES store_purchase_orders(id) ON DELETE SET NULL,
        contact_id INTEGER REFERENCES acct_contacts(id) ON DELETE SET NULL,
        receipt_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        posted_at TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS store_grn_items (
        id INTEGER PRIMARY KEY,
        grn_id INTEGER NOT NULL REFERENCES store_grns(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES store_products(id),
        qty REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS acct_period_locks (
        id INTEGER PRIMARY KEY,
        session_label TEXT NOT NULL,
        term_label TEXT,
        from_date TEXT NOT NULL,
        to_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'locked',
        locked_by TEXT,
        locked_at TEXT,
        UNIQUE(session_label, term_label)
      );
      CREATE TABLE IF NOT EXISTS acct_currencies (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        symbol TEXT,
        rate REAL NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS acct_budget_periods (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        period_from TEXT NOT NULL,
        period_to TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acct_reconciliations (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
        period TEXT NOT NULL,
        opening REAL NOT NULL DEFAULT 0,
        closing REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        opened_by TEXT,
        opened_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(account_id, period)
      );
      CREATE TABLE IF NOT EXISTS acct_tax_codes (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        rate REAL NOT NULL DEFAULT 0,
        gl_account_id INTEGER REFERENCES acct_accounts(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS acct_tax_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        regulator_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS acct_regulators (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        short_name TEXT,
        contact TEXT
      );
      CREATE TABLE IF NOT EXISTS acct_payroll_remittances (
        id INTEGER PRIMARY KEY,
        period TEXT NOT NULL,
        obligation TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        date_remitted TEXT,
        reference TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(period, obligation)
      );
    `);

    // ── Columns added to existing finance tables ──
    [
      ['template_id', 'INTEGER'], ['invoice_no', 'TEXT'], ['title', 'TEXT'], ['invoice_type', "TEXT NOT NULL DEFAULT 'ondemand'"],
      ['discount', 'REAL NOT NULL DEFAULT 0'], ['hidden', 'INTEGER NOT NULL DEFAULT 0'], ['class_arm_id', 'INTEGER'],
      ['part_payment', 'INTEGER NOT NULL DEFAULT 1'], ['show_breakdown', 'INTEGER NOT NULL DEFAULT 1'],
    ].forEach(([c, d]) => ensureColumn('fee_invoices', c, d));
    [
      ['kind', "TEXT NOT NULL DEFAULT 'manual'"], ['attachment_path', 'TEXT'], ['submitted_by', 'TEXT'], ['account_id', 'INTEGER'],
      ['reviewed_by', 'TEXT'], ['reviewed_at', 'TEXT'], ['payment_date', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('fee_payments', c, d));
    [
      ['source', "TEXT NOT NULL DEFAULT 'manual'"], ['source_id', 'INTEGER'], ['item', 'TEXT'], ['voucher_no', 'TEXT'], ['method', 'TEXT'],
      ['received_from', 'TEXT'], ['account_id', 'INTEGER'], ['attachment_path', 'TEXT'], ['gl_entry_id', 'INTEGER'],
    ].forEach(([c, d]) => ensureColumn('income_entries', c, d));
    [
      ['source', "TEXT NOT NULL DEFAULT 'manual'"], ['source_id', 'INTEGER'], ['item', 'TEXT'], ['title', 'TEXT'], ['voucher_no', 'TEXT'],
      ['method', 'TEXT'], ['paid_to', 'TEXT'], ['account_id', 'INTEGER'], ['attachment_path', 'TEXT'], ['approved_by', 'TEXT'], ['gl_entry_id', 'INTEGER'],
    ].forEach(([c, d]) => ensureColumn('expenses', c, d));
    [
      ['voucher_no', 'TEXT'], ['item', 'TEXT'], ['description', 'TEXT'], ['method', 'TEXT'], ['transaction_date', 'TEXT'],
      ['requested_by_name', 'TEXT'], ['account_id', 'INTEGER'], ['dispensed_at', 'TEXT'], ['expense_id', 'INTEGER'],
    ].forEach(([c, d]) => ensureColumn('expense_requests', c, d));
    [
      ['code', 'TEXT'], ['coa_account_id', 'INTEGER'], ['parent_id', 'INTEGER'], ['is_system', 'INTEGER NOT NULL DEFAULT 0'],
    ].forEach(([c, d]) => ensureColumn('finance_categories', c, d));
    [
      ['lines', 'TEXT'], ['excluded', 'INTEGER NOT NULL DEFAULT 0'], ['payment_channel', 'TEXT'], ['account_number', 'TEXT'],
      ['account_name', 'TEXT'], ['grade_label', 'TEXT'], ['staff_type', 'TEXT'], ['paye', 'REAL NOT NULL DEFAULT 0'],
      ['pension_emp', 'REAL NOT NULL DEFAULT 0'], ['pension_er', 'REAL NOT NULL DEFAULT 0'], ['nhis', 'REAL NOT NULL DEFAULT 0'],
      ['nhf', 'REAL NOT NULL DEFAULT 0'], ['paid_from_account_id', 'INTEGER'], ['paid_by', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('staff_salaries', c, d));
    [
      ['status', "TEXT NOT NULL DEFAULT 'published'"], ['visibility', "TEXT NOT NULL DEFAULT 'public'"], ['product_type', "TEXT NOT NULL DEFAULT 'physical'"],
      ['image_path', 'TEXT'], ['discount_pct', 'REAL NOT NULL DEFAULT 0'], ['description', 'TEXT'], ['updated_at', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('store_products', c, d));
    [
      ['status', "TEXT NOT NULL DEFAULT 'published'"], ['visibility', "TEXT NOT NULL DEFAULT 'public'"], ['sort_order', 'INTEGER NOT NULL DEFAULT 0'],
    ].forEach(([c, d]) => ensureColumn('store_categories', c, d));
    [
      ['payment_status', "TEXT NOT NULL DEFAULT 'paid'"], ['fulfilment_status', "TEXT NOT NULL DEFAULT 'picked_up'"],
      ['fulfilment_type', "TEXT NOT NULL DEFAULT 'pickup'"], ['shift_id', 'INTEGER'], ['payment_note', 'TEXT'], ['updated_at', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('store_orders', c, d));
    [
      ['movement_type', "TEXT NOT NULL DEFAULT 'manual'"], ['reference', 'TEXT'], ['unit_cost', 'REAL'], ['balance_after', 'INTEGER'],
    ].forEach(([c, d]) => ensureColumn('store_stock_movements', c, d));
    [
      ['product_id', 'INTEGER'], ['fulfilled_qty', 'INTEGER'], ['decision_note', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('store_requisitions', c, d));
    [
      ['image_path', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('store_banners', c, d));
    [
      ['parent_id', 'INTEGER'], ['is_group', 'INTEGER NOT NULL DEFAULT 0'], ['is_system', 'INTEGER NOT NULL DEFAULT 0'], ['description', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('acct_accounts', c, d));
    [
      ['entry_type', "TEXT NOT NULL DEFAULT 'manual'"], ['status', "TEXT NOT NULL DEFAULT 'posted'"], ['source', 'TEXT'], ['source_id', 'INTEGER'],
      ['posted_by', 'TEXT'], ['posted_at', 'TEXT'],
    ].forEach(([c, d]) => ensureColumn('acct_journal_entries', c, d));
    [
      ['code', 'TEXT'], ['contact_person', 'TEXT'], ['terms_days', 'INTEGER NOT NULL DEFAULT 30'], ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ].forEach(([c, d]) => ensureColumn('acct_contacts', c, d));
    [
      ['paid_amount', 'REAL NOT NULL DEFAULT 0'], ['description', 'TEXT'], ['grn_id', 'INTEGER'],
    ].forEach(([c, d]) => ensureColumn('acct_bills', c, d));
    [['budget_id', 'INTEGER']].forEach(([c, d]) => ensureColumn('acct_budgets', c, d));
    [['account_id', 'INTEGER'], ['recon_id', 'INTEGER']].forEach(([c, d]) => ensureColumn('acct_bank_transactions', c, d));
    [['tax_code_id', 'INTEGER'], ['reference', 'TEXT'], ['date_paid', 'TEXT']].forEach(([c, d]) => ensureColumn('acct_tax_records', c, d));

    modules.forEach(mod => mod.schema && mod.schema());
    migrateLoans();
    migrateData();
  }

  // staff_loans had CHECKs for only loan/advance and outstanding/repaying/repaid;
  // SchoolsFocus' flow needs grants and a Pending → Reviewed → Approved → Active → Settled path.
  function migrateLoans() {
    const sql = (one("SELECT sql FROM sqlite_master WHERE type='table' AND name='staff_loans'") || {}).sql || '';
    if (sql.includes('loan_code')) return;
    const createSql = `CREATE TABLE staff_loans (
      id INTEGER PRIMARY KEY,
      loan_code TEXT,
      staff_id TEXT NOT NULL REFERENCES users(id),
      loan_type TEXT NOT NULL DEFAULT 'loan',
      amount REAL NOT NULL,
      amount_approved REAL,
      interest_rate REAL NOT NULL DEFAULT 0,
      total_repayable REAL,
      reason TEXT,
      monthly_deduction REAL NOT NULL DEFAULT 0,
      repayment_months INTEGER,
      start_month INTEGER,
      start_year INTEGER,
      repayment_status TEXT NOT NULL DEFAULT 'outstanding',
      status TEXT NOT NULL DEFAULT 'pending',
      disb_bank TEXT,
      disb_account_number TEXT,
      disb_account_name TEXT,
      guarantor_name TEXT,
      guarantor_relationship TEXT,
      guarantor_phone TEXT,
      guarantor_email TEXT,
      document_path TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      approved_by TEXT,
      approved_at TEXT,
      disbursed_at TEXT,
      disbursed_account_id INTEGER,
      decision_note TEXT,
      issued_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id)
    )`;
    rebuildTable('staff_loans', createSql, ['id', 'staff_id', 'loan_type', 'amount', 'reason', 'monthly_deduction', 'repayment_status', 'issued_at', 'created_by']);
    all('SELECT id, amount, repayment_status AS rs FROM staff_loans').forEach(l => {
      const status = l.rs === 'repaid' ? 'settled' : 'active';
      run('UPDATE staff_loans SET loan_code = ?, amount_approved = amount, total_repayable = amount, status = ?, disbursed_at = issued_at WHERE id = ?',
        `LN-${String(l.id).padStart(5, '0')}`, status, l.id);
      if (l.rs === 'repaid') {
        run("INSERT INTO loan_repayments (loan_id, amount, source, note, paid_at) VALUES (?, ?, 'manual', 'Brought forward', ?)", l.id, l.amount, nowIso());
      }
    });
  }

  function migrateData() {
    // Operating accounts: the school always has a Default Fees Account.
    if (!one('SELECT id FROM fin_accounts LIMIT 1')) {
      run(`INSERT INTO fin_accounts (name, type, opening_balance, track_balance, is_default, show_on_invoice, created_at)
           VALUES ('DEFAULT FEES ACCOUNT', 'bank', 0, 1, 1, 0, ?)`, nowIso());
    }

    // SchoolsFocus' chart of accounts (codes already in use are left alone).
    if (valueFromMeta('fin_coa_v1', '') !== '1') {
      tx(() => {
        SF_COA.forEach(([code, name, type, normal, parent, group]) => {
          if (!coaByCode(code)) {
            run('INSERT INTO acct_accounts (code, name, type, normal_balance, is_active, is_group, is_system) VALUES (?, ?, ?, ?, 1, ?, 1)',
              code, name, type, normal, group ? 1 : 0);
          }
        });
        SF_COA.forEach(([code, , , , parent]) => {
          if (parent) run('UPDATE acct_accounts SET parent_id = ? WHERE code = ? AND parent_id IS NULL', coaId(parent), code);
        });
        // older accounts sit under the matching group
        const groups = { asset: '1000', liability: '2000', equity: '3000', income: '4000', expense: '5000' };
        all('SELECT id, type, code, parent_id AS p, is_group AS g FROM acct_accounts').forEach(a => {
          if (!a.p && !a.g && groups[a.type] && groups[a.type] !== a.code) run('UPDATE acct_accounts SET parent_id = ? WHERE id = ?', coaId(groups[a.type]), a.id);
        });
      });
      setMeta('fin_coa_v1', '1');
    }

    // The original demo chart (1000 Cash, 1200 Accounts Receivable, 5100 Utilities …) used
    // codes that SchoolsFocus gives to other accounts. Fold each into its SchoolsFocus
    // counterpart (entries, budgets and links move with it) or give it a free code.
    if (valueFromMeta('fin_coa_v2', '') !== '1') {
      const OLD = [
        ['1000', 'Cash', '1100'], ['1010', 'Bank Account', '1200'], ['1200', 'Accounts Receivable', '1400'], ['1500', 'Inventory', '1300'],
        ['2000', 'Accounts Payable', '2100'], ['3000', 'Fund Balance / Equity', null, '3100'], ['4000', 'Tuition & Fees Income', '4100'],
        ['4100', 'Store Sales Income', '4300'], ['5000', 'Salaries Expense', '5100'], ['5100', 'Utilities Expense', null, '5210'], ['5200', 'Supplies Expense', null, '5220'],
      ];
      const REFS = [['acct_journal_lines', 'account_id'], ['acct_budgets', 'account_id'], ['fin_accounts', 'coa_account_id'], ['finance_categories', 'coa_account_id'], ['acct_tax_codes', 'gl_account_id'], ['acct_accounts', 'parent_id']];
      tx(() => {
        const found = OLD.map(([code, name, into, recode]) => ({ row: one('SELECT id FROM acct_accounts WHERE code = ? AND name = ? AND is_system = 0', code, name), into, recode, name }))
          .filter(x => x.row);
        found.forEach(x => run('UPDATE acct_accounts SET code = ? WHERE id = ?', `OLD-${x.row.id}`, x.row.id));
        SF_COA.forEach(([code, name, type, normal, , group]) => {
          if (!coaByCode(code)) run('INSERT INTO acct_accounts (code, name, type, normal_balance, is_active, is_group, is_system) VALUES (?, ?, ?, ?, 1, ?, 1)', code, name, type, normal, group ? 1 : 0);
          else run('UPDATE acct_accounts SET is_group = ?, is_system = 1 WHERE code = ?', group ? 1 : 0, code);
        });
        found.forEach(x => {
          if (x.into) {
            const target = coaId(x.into);
            REFS.forEach(([t, c]) => run(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, target, x.row.id));
            run('DELETE FROM acct_accounts WHERE id = ?', x.row.id);
          } else {
            run('UPDATE acct_accounts SET code = ? WHERE id = ?', coaByCode(x.recode) ? `${x.recode}-${x.row.id}` : x.recode, x.row.id);
          }
        });
        SF_COA.forEach(([code, , , , parent]) => run('UPDATE acct_accounts SET parent_id = ? WHERE code = ?', parent ? coaId(parent) : null, code));
        const groups = { asset: '1000', liability: '2000', equity: '3000', income: '4000', expense: '5000' };
        const sfCodes = new Set(SF_COA.map(a => a[0]));
        all('SELECT id, type, code, parent_id AS p FROM acct_accounts WHERE is_group = 0').forEach(a => {
          const parent = a.p && one('SELECT is_group AS g FROM acct_accounts WHERE id = ?', a.p);
          if (!sfCodes.has(a.code) && groups[a.type] && !(parent && parent.g)) run('UPDATE acct_accounts SET parent_id = ? WHERE id = ?', coaId(groups[a.type]), a.id);
        });
        // system heads were linked by code while the old accounts still held those codes
        [...SYSTEM_EXPENSE_HEADS.map(h => ['expense', ...h]), ...SYSTEM_INCOME_HEADS.map(h => ['income', ...h])]
          .forEach(([type, , code, coa]) => run('UPDATE finance_categories SET coa_account_id = ? WHERE type = ? AND code = ? AND parent_id IS NULL', coaId(coa), type, code));
      });
      setMeta('fin_coa_v2', '1');
    }

    // System expense / income heads with ledger accounts.
    if (valueFromMeta('fin_heads_v1', '') !== '1') {
      const addHead = (type, name, code, coa) => {
        const row = one('SELECT id FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND parent_id IS NULL', type, name);
        if (row) run('UPDATE finance_categories SET code = COALESCE(code, ?), coa_account_id = COALESCE(coa_account_id, ?), is_system = 1 WHERE id = ?', code, coaId(coa), row.id);
        else run('INSERT INTO finance_categories (type, name, created_at, code, coa_account_id, is_system) VALUES (?, ?, ?, ?, ?, 1)', type, name, nowIso(), code, coaId(coa));
      };
      // unique (type,name) — sub-heads (items) use the same table with parent_id, so the old constraint must allow duplicates across parents
      const catSql = (one("SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_categories'") || {}).sql || '';
      if (catSql.includes('UNIQUE(type, name)')) {
        rebuildTable('finance_categories', `CREATE TABLE finance_categories (
          id INTEGER PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('expense','income')),
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          code TEXT,
          coa_account_id INTEGER,
          parent_id INTEGER,
          is_system INTEGER NOT NULL DEFAULT 0
        )`, ['id', 'type', 'name', 'created_at', 'code', 'coa_account_id', 'parent_id', 'is_system']);
      }
      SYSTEM_EXPENSE_HEADS.forEach(([n, c, coa]) => addHead('expense', n, c, coa));
      SYSTEM_INCOME_HEADS.forEach(([n, c, coa]) => addHead('income', n, c, coa));
      // heads already used on income/expense rows become real heads
      all('SELECT DISTINCT category FROM expenses').forEach(r => r.category && !one("SELECT id FROM finance_categories WHERE type='expense' AND lower(name)=lower(?) AND parent_id IS NULL", r.category) && run("INSERT INTO finance_categories (type, name, created_at, coa_account_id) VALUES ('expense', ?, ?, ?)", r.category, nowIso(), coaId('5250')));
      all('SELECT DISTINCT category FROM income_entries').forEach(r => r.category && !one("SELECT id FROM finance_categories WHERE type='income' AND lower(name)=lower(?) AND parent_id IS NULL", r.category) && run("INSERT INTO finance_categories (type, name, created_at, coa_account_id) VALUES ('income', ?, ?, ?)", r.category, nowIso(), coaId('4200')));
      setMeta('fin_heads_v1', '1');
    }

    // Every income / expense row belongs to a bank or cash account.
    const defaultId = defaultFinAccountId();
    run('UPDATE income_entries SET account_id = ? WHERE account_id IS NULL', defaultId);
    run('UPDATE expenses SET account_id = ? WHERE account_id IS NULL', defaultId);
    run('UPDATE fee_payments SET account_id = ? WHERE account_id IS NULL', defaultId);
    run("UPDATE expenses SET source = 'request', source_id = request_id WHERE request_id IS NOT NULL AND source = 'manual'");

    // Old single-fee invoices get one line item, a title and an invoice number.
    all('SELECT id, fee_type AS feeType, description, amount FROM fee_invoices WHERE invoice_no IS NULL').forEach(inv => {
      run('UPDATE fee_invoices SET invoice_no = ?, title = COALESCE(title, ?) WHERE id = ?', uniqueCode('fee_invoices', 'invoice_no', '#INV', 9), inv.feeType, inv.id);
      if (!one('SELECT id FROM fee_invoice_items WHERE invoice_id = ?', inv.id)) {
        run('INSERT INTO fee_invoice_items (invoice_id, name, amount, description, account_id) VALUES (?, ?, ?, ?, ?)',
          inv.id, inv.feeType, inv.amount, inv.description || null, defaultFinAccountId());
      }
    });

    // Every successful fee payment shows up in Income (once).
    if (valueFromMeta('fin_fee_income_v1', '') !== '1') {
      all("SELECT id FROM fee_payments WHERE status = 'successful'").forEach(p => syncFeePaymentIncome(p.id, null));
      setMeta('fin_fee_income_v1', '1');
    }
    // Paid salaries become expenses, store sales become income.
    if (valueFromMeta('fin_links_v1', '') !== '1') {
      all("SELECT s.id, s.net_salary AS net, s.period, s.paid_at AS paidAt, s.created_by AS by, u.name FROM staff_salaries s JOIN users u ON u.id = s.staff_id WHERE s.status = 'paid'").forEach(s => {
        if (!one("SELECT id FROM expenses WHERE source = 'salary' AND source_id = ?", s.id)) {
          addExpense({ category: 'Salaries & Staff Wages', title: `Salary — ${s.name}`, description: `Salary for ${s.period} — ${s.name}`, amount: s.net, date: String(s.paidAt || nowIso()).slice(0, 10), userId: s.by || systemUserId(), source: 'salary', sourceId: s.id, paidTo: s.name });
        }
      });
      all("SELECT id, order_no AS no, channel, total, created_at AS at, created_by AS by, customer_name AS customer, payment_method AS method FROM store_orders WHERE status = 'completed'").forEach(o => {
        if (!one("SELECT id FROM income_entries WHERE source = 'store_sale' AND source_id = ?", o.id) && o.total > 0) {
          addIncome({ category: o.channel === 'online' ? 'Storefront Sales' : 'POS Sales', description: `${o.channel === 'online' ? 'Storefront' : 'POS'} sale ${o.no}`, amount: o.total, date: String(o.at).slice(0, 10), userId: o.by || systemUserId(), source: 'store_sale', sourceId: o.id, method: o.method, receivedFrom: o.customer });
        }
      });
      setMeta('fin_links_v1', '1');
    }

    // Statutory PAYE defaults (PITA bands effective 2024-01-01).
    if (!one('SELECT id FROM paye_configs LIMIT 1')) {
      const bands = [
        { limit: 300000, rate: 7 }, { limit: 300000, rate: 11 }, { limit: 500000, rate: 15 },
        { limit: 500000, rate: 19 }, { limit: 1600000, rate: 21 }, { limit: null, rate: 24 },
      ];
      run(`INSERT INTO paye_configs (effective_from, pension_emp, pension_er, nhis, nhf, cra_fixed, bands, notes)
           VALUES ('2024-01-01', 8, 10, 1.75, 2.5, 200000, ?, ?)`,
        JSON.stringify(bands), 'PITA default bands — effective 2024-01-01. Limit=null on last band means all income above ₦3.2m annual.');
    }
    // Grade levels ONE … TEN with two steps each (basic salaries left for the school to set).
    if (!one('SELECT id FROM pay_grade_levels LIMIT 1')) {
      const words = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
      words.forEach((w, i) => {
        const g = run('INSERT INTO pay_grade_levels (name, numeric_level) VALUES (?, ?)', `GRADE LEVEL ${w}`, i + 1);
        ['STEP ONE', 'STEP TWO'].forEach((s, j) => run('INSERT INTO pay_grade_steps (grade_level_id, name, numeric_step, basic_salary) VALUES (?, ?, ?, 0)', Number(g.lastInsertRowid), s, j + 1));
      });
    }
    // Old per-staff allowance / deduction totals become named pay items.
    if (valueFromMeta('fin_pay_items_v1', '') !== '1') {
      all('SELECT staff_id AS s, allowances AS a, deductions AS d FROM staff_pay_rates').forEach(r => {
        if (r.a > 0) run("INSERT INTO staff_pay_items (staff_id, kind, name, amount) VALUES (?, 'allowance', 'Allowance', ?)", r.s, r.a);
        if (r.d > 0) run("INSERT INTO staff_pay_items (staff_id, kind, name, amount) VALUES (?, 'deduction', 'Deduction', ?)", r.s, r.d);
      });
      setMeta('fin_pay_items_v1', '1');
    }
    // Tax setup defaults.
    if (!one('SELECT id FROM acct_regulators LIMIT 1')) {
      [['Income Tax Authority', 'FIRS/SIRS'], ['Pension Authority', 'PenCom'], ['Health Insurance Authority', 'NHIA'], ['Housing Fund Authority', 'FMBN']]
        .forEach(([n, s]) => run('INSERT INTO acct_regulators (name, short_name) VALUES (?, ?)', n, s));
    }
    if (!one('SELECT id FROM acct_tax_codes LIMIT 1')) {
      run("INSERT INTO acct_tax_codes (code, name, rate, gl_account_id) VALUES ('VAT', 'Value Added Tax', 7.5, ?)", coaId('2180'));
      run("INSERT INTO acct_tax_codes (code, name, rate, gl_account_id) VALUES ('WHT', 'Withholding Tax', 5, ?)", coaId('2170'));
    }
    if (!one('SELECT id FROM acct_tax_types LIMIT 1')) {
      const reg = n => (one('SELECT id FROM acct_regulators WHERE name = ?', n) || {}).id || null;
      [['PAYE Tax', 'Income Tax Authority'], ['Pension', 'Pension Authority'], ['Health Insurance', 'Health Insurance Authority'],
        ['Housing Fund', 'Housing Fund Authority'], ['VAT', 'Income Tax Authority'], ['WHT', 'Income Tax Authority']]
        .forEach(([n, r]) => run('INSERT INTO acct_tax_types (name, regulator_id) VALUES (?, ?)', n, reg(r)));
    }
    // journal entries made before entry types existed
    run("UPDATE acct_journal_entries SET posted_at = COALESCE(posted_at, created_at), posted_by = COALESCE(posted_by, created_by) WHERE status = 'posted'");
  }

  const api = {
    round2, today, nowIso, money, posMoney, flag, tx, tableExists, columns, systemUserId,
    saveDocument, readBigJson, readSheet, getJsonMeta, setJsonMeta, randomCode, uniqueCode, sequenceCode, voucherNo,
    sessions, termIds, sessionRange,
    finAccounts, finAccountById, defaultFinAccountId, accountLabel, coaByCode, coaId, cashCoaFor,
    lockedPeriodFor, assertOpenPeriod, autoPostingOn, postJournal, reverseJournal, glPostIncome, glPostExpense, glUnpost,
    addIncome, addExpense, removeLinked, syncFeePaymentIncome, createSchema,
  };

  // the route files read request bodies through this, so the activity log can see what was sent
  const routeCtx = { ...ctx, readJson: async req => (req.finBody = await ctx.readJson(req)) };
  const modules = [
    require('./finance-fees')(routeCtx, api),
    require('./finance-books')(routeCtx, api),
    require('./finance-payroll')(routeCtx, api),
    require('./finance-store')(routeCtx, api),
    require('./finance-acct')(routeCtx, api),
  ];
  api.movementRows = modules[1].movementRows;

  // ── Activity log ───────────────────────────────────────────────────────
  // Every change made on a Finance page goes into the admin's Security &
  // Activity Log (who, what, how much); accountants can't open that page.
  const AREAS = [
    [/^fees\/invoices\/\d+\/payments/, 'Fee payment recorded'], [/^fees\/payments\/\d+\/status/, 'Fee payment status changed'],
    [/^fees\/invoices/, 'Fee invoice'], [/^fees\/templates/, 'Class fees template'], [/^fees\/wallets/, 'Fees wallet'],
    [/^fees\/families/, 'Family fees'], [/^fees\/reminders/, 'Fee reminder sent'], [/^fees\//, 'Fees'],
    [/^finance\/expense-requests/, 'Expense request'], [/^finance\/expenses/, 'Expense'], [/^finance\/income/, 'Income'],
    [/^finance\/(transfers|adjustments)/, 'Bank / cash transfer or adjustment'], [/^finance\/accounts/, 'Bank / cash account'],
    [/^finance\/heads/, 'Income / expense head'], [/^finance\//, 'Income & Expenses'],
    [/^payroll\/salaries/, 'Salaries'], [/^payroll\/loans/, 'Staff loan'], [/^payroll\//, 'Payroll settings'],
    [/^store\/orders/, 'Store sale / order'], [/^store\/(grns|purchase-orders)/, 'Store purchasing'], [/^store\/products/, 'Store product'], [/^store\//, 'Store'],
    [/^acct\/journal-entries/, 'Journal entry'], [/^acct\/bills/, 'Bill / customer invoice'], [/^acct\/periods/, 'Accounting period'], [/^acct\//, 'Accounting'],
  ];
  const VERB = { POST: 'added / actioned', PUT: 'edited', DELETE: 'deleted' };
  function logChange(req, res, url) {
    if (req.method === 'GET' || res.statusCode >= 400 || !ctx.audit || !ctx.currentUser) return;
    const user = ctx.currentUser(req);
    if (!user) return;
    const p = url.pathname.replace(/^\/api\/admin\//, '');
    const area = (AREAS.find(([re]) => re.test(p)) || [null, 'Finance'])[1];
    const b = req.finBody || {};
    const amount = b.amount ?? b.total ?? b.openingCash ?? b.closingCash;
    const detail = [
      amount != null && amount !== '' ? `₦${Number(amount).toLocaleString('en-NG')}` : '',
      ...['action', 'status', 'title', 'name', 'description', 'studentId', 'period', 'reference']
        .filter(k => b[k] != null && b[k] !== '' && typeof b[k] !== 'object').map(k => `${k}: ${String(b[k]).slice(0, 60)}`),
      Array.isArray(b.ids) ? `${b.ids.length} item(s)` : '',
      `(${req.method} /${p})`,
    ].filter(Boolean).join(' · ');
    const action = /recorded|changed|sent/.test(area) ? area : `${area} ${VERB[req.method] || ''}`.trim();
    ctx.audit(req, user, `Finance: ${action}`, detail);
  }

  // ── Finance home (the accountant's dashboard) and the payment-proof badge ─
  function homeData() {
    const t = today();
    const month = t.slice(0, 7);
    const academic = one('SELECT id, session_label AS sessionLabel, term_label AS termLabel FROM academic_terms WHERE is_active = 1');
    const count = sql => (one(sql) || {}).n || 0;
    const sum = (sql, ...p) => round2((one(sql, ...p) || {}).s);
    const paidToday = one(`SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS n FROM fee_payments
                           WHERE status = 'successful' AND COALESCE(payment_date, substr(recorded_at, 1, 10)) = ?`, t);
    const term = academic ? one(`SELECT COALESCE(SUM(fi.amount), 0) AS billed, COUNT(*) AS n,
                                        COALESCE(SUM((SELECT COALESCE(SUM(fp.amount), 0) FROM fee_payments fp WHERE fp.invoice_id = fi.id AND fp.status = 'successful')), 0) AS paid
                                 FROM fee_invoices fi WHERE fi.academic_id = ? AND fi.hidden = 0`, academic.id) : { billed: 0, paid: 0, n: 0 };
    return {
      today: t, academic,
      collectedToday: round2(paidToday.s), paymentsToday: paidToday.n,
      termBilled: round2(term.billed), termPaid: round2(term.paid), termOutstanding: round2(term.billed - term.paid), termInvoices: term.n,
      pendingProofs: count("SELECT COUNT(*) AS n FROM fee_payments WHERE status = 'pending'"),
      pendingExpenseRequests: count("SELECT COUNT(*) AS n FROM expense_requests WHERE status = 'pending'"),
      approvedToDispense: count("SELECT COUNT(*) AS n FROM expense_requests WHERE status = 'approved'"),
      lowStock: count(`SELECT COUNT(*) AS n FROM store_products WHERE COALESCE(product_type, 'physical') <> 'digital'
                       AND COALESCE(status, 'published') <> 'archived' AND stock_qty <= reorder_level`),
      incomeThisMonth: sum('SELECT COALESCE(SUM(amount), 0) AS s FROM income_entries WHERE substr(income_date, 1, 7) = ?', month),
      expensesThisMonth: sum('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE substr(expense_date, 1, 7) = ?', month),
      recentPayments: all(`SELECT fp.id, fp.amount, fp.method, COALESCE(fp.payment_date, substr(fp.recorded_at, 1, 10)) AS date,
                                  st.id AS studentId, st.name AS studentName, COALESCE(fi.title, fi.fee_type) AS title, fi.id AS invoiceId
                           FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id JOIN students st ON st.id = fi.student_id
                           WHERE fp.status = 'successful' ORDER BY fp.recorded_at DESC, fp.id DESC LIMIT 8`).map(r => ({ ...r, amount: round2(r.amount) })),
    };
  }

  api.handle = async function handle(req, res, url) {
    if (!/^\/api\/(admin|student)\/(fees|finance|payroll|store|acct)(\/|$)/.test(url.pathname)) return false;
    try {
      if (req.method === 'GET' && url.pathname === '/api/admin/finance/home') {
        if (ctx.requireUser(req, res, 'admin')) ctx.sendJson(res, 200, homeData());
        return true;
      }
      for (const m of modules) {
        if (await m.handle(req, res, url)) {
          if (url.pathname.startsWith('/api/admin/')) logChange(req, res, url);
          return true;
        }
      }
    } catch (err) {
      if (err && err.status) { ctx.sendJson(res, err.status, { error: err.message }); return true; }
      throw err;
    }
    return false;
  };
  return api;
};
