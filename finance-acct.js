// Finance › Accounting — chart of accounts (groups / postable accounts),
// auto-posting setup, period locks, currencies, journal entries (draft,
// posted, reversed; Excel import), account ledger and trial balance as at a
// date, contacts with vendor bills (AP) / customer invoices (AR) and their
// ageing, budgets, bank reconciliation, tax & compliance, and the
// financial reports (P&L, balance sheet, debtor ageing, payroll remittances …).

module.exports = function createAcct(ctx, F) {
  const { db, one, all, run, cleanText, readJson, sendJson, requireUser, valueFromMeta, setMeta } = ctx;
  const { round2, money, posMoney, nowIso, today } = F;

  const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
  const ENTRY_TYPES = ['manual', 'accrual', 'opening_balance', 'adjustment', 'fee_payment', 'payroll', 'storefront_sale', 'pos_sale', 'requisition', 'vendor_invoice', 'vendor_payment', 'bank_recon', 'accrual_reversal'];

  function schema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS acct_recon_items (
        recon_id INTEGER NOT NULL REFERENCES acct_reconciliations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        UNIQUE(recon_id, kind, ref_id)
      );
      CREATE TABLE IF NOT EXISTS acct_bill_payments (
        id INTEGER PRIMARY KEY,
        bill_id INTEGER NOT NULL REFERENCES acct_bills(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_on TEXT NOT NULL,
        account_id INTEGER,
        method TEXT,
        reference TEXT,
        link_kind TEXT,
        link_id INTEGER,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ── Accounts ───────────────────────────────────────────────────────────
  function accounts() {
    return all(`SELECT a.id, a.code, a.name, a.type, a.normal_balance AS normalBalance, a.is_active AS isActive, a.parent_id AS parentId,
                       pa.code AS parentCode, pa.name AS parentName, a.is_group AS isGroup, a.is_system AS isSystem, a.description
                FROM acct_accounts a LEFT JOIN acct_accounts pa ON pa.id = a.parent_id ORDER BY a.code`)
      .map(a => ({ ...a, isActive: !!a.isActive, isGroup: !!a.isGroup, isSystem: !!a.isSystem }));
  }
  function sums(accountId, { from, to } = {}) {
    let sql = "SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c FROM acct_journal_lines jl JOIN acct_journal_entries je ON je.id = jl.entry_id WHERE jl.account_id = ? AND je.status <> 'draft'";
    const p = [accountId];
    if (from) { sql += ' AND je.entry_date >= ?'; p.push(from); }
    if (to) { sql += ' AND je.entry_date <= ?'; p.push(to); }
    const r = one(sql, ...p);
    return { debit: round2(r.d), credit: round2(r.c) };
  }
  function natural(a, s) { return round2(a.normalBalance === 'debit' ? s.debit - s.credit : s.credit - s.debit); }

  // ── Journals ───────────────────────────────────────────────────────────
  function entries(f = {}) {
    let sql = `SELECT je.id, je.entry_no AS entryNo, je.entry_date AS entryDate, je.memo, je.entry_type AS entryType, je.status, je.source, je.source_id AS sourceId,
                      je.created_by AS createdBy, cu.name AS createdByName, je.posted_by AS postedBy, pu.name AS postedByName, je.created_at AS createdAt
               FROM acct_journal_entries je LEFT JOIN users cu ON cu.id = je.created_by LEFT JOIN users pu ON pu.id = je.posted_by WHERE 1=1`;
    const p = [];
    if (f.status) { sql += ' AND je.status = ?'; p.push(f.status); }
    if (f.type) { sql += ' AND je.entry_type = ?'; p.push(f.type); }
    if (f.from) { sql += ' AND je.entry_date >= ?'; p.push(f.from); }
    if (f.to) { sql += ' AND je.entry_date <= ?'; p.push(f.to); }
    const rows = all(`${sql} ORDER BY je.entry_date DESC, je.id DESC`, ...p);
    const lines = all(`SELECT jl.id, jl.entry_id AS entryId, jl.account_id AS accountId, a.code AS accountCode, a.name AS accountName, jl.debit, jl.credit, jl.description
                       FROM acct_journal_lines jl JOIN acct_accounts a ON a.id = jl.account_id`);
    return rows.map(e => {
      const mine = lines.filter(l => l.entryId === e.id);
      return { ...e, lines: mine, totalDebit: round2(mine.reduce((s, l) => s + l.debit, 0)), totalCredit: round2(mine.reduce((s, l) => s + l.credit, 0)) };
    });
  }
  function readLines(list) {
    const lines = [];
    for (const l of Array.isArray(list) ? list : []) {
      const accountId = Number(l.accountId);
      const debit = money(l.debit);
      const credit = money(l.credit);
      if (!accountId && !debit && !credit) continue;
      if (!accountId) return { error: 'Every line needs an account' };
      const a = one('SELECT is_group AS g FROM acct_accounts WHERE id = ?', accountId);
      if (!a) return { error: `Account #${accountId} not found` };
      if (a.g) return { error: 'Group accounts cannot be posted to — choose a postable account' };
      if (debit < 0 || credit < 0) return { error: 'Amounts cannot be negative' };
      if ((debit > 0) === (credit > 0)) return { error: 'Each line needs either a debit or a credit (not both)' };
      lines.push({ accountId, debit, credit, description: cleanText(l.description) || null });
    }
    if (lines.length < 2) return { error: 'A journal entry needs at least two lines' };
    const d = round2(lines.reduce((s, l) => s + l.debit, 0));
    const c = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(d - c) > 0.01) return { error: `Not balanced: debits ${d.toFixed(2)} vs credits ${c.toFixed(2)}` };
    return { lines };
  }

  // ── Bills / invoices ───────────────────────────────────────────────────
  function bills(f = {}) {
    let rows = all(`SELECT b.id, b.contact_id AS contactId, c.name AS contactName, b.doc_no AS docNo, b.doc_type AS docType, b.issue_date AS issueDate, b.due_date AS dueDate,
                           b.amount, b.paid_amount AS paid, b.status, b.notes, b.description, b.grn_id AS grnId, b.created_at AS createdAt
                    FROM acct_bills b LEFT JOIN acct_contacts c ON c.id = b.contact_id ORDER BY b.issue_date DESC, b.id DESC`)
      .map(b => {
        const outstanding = round2(b.amount - b.paid);
        const status = outstanding <= 0 ? 'paid' : b.paid > 0 ? 'partial' : (b.dueDate && b.dueDate < today() ? 'overdue' : 'unpaid');
        return { ...b, amount: round2(b.amount), paid: round2(b.paid), outstanding, status: b.status === 'void' ? 'void' : status, daysOverdue: b.dueDate && outstanding > 0 ? Math.max(0, Math.floor((Date.now() - new Date(`${b.dueDate}T00:00:00Z`)) / 86400000)) : 0 };
      });
    if (f.type) rows = rows.filter(b => b.docType === f.type);
    if (f.status) rows = rows.filter(b => b.status === f.status);
    if (f.from) rows = rows.filter(b => b.issueDate >= f.from);
    if (f.to) rows = rows.filter(b => b.issueDate <= f.to);
    return rows;
  }
  function ageing(type) {
    const buckets = ['Current', '1–30', '31–60', '61–90', '90+'];
    const by = new Map();
    bills({ type }).filter(b => b.outstanding > 0 && b.status !== 'void').forEach(b => {
      const k = b.contactName || '—';
      const v = by.get(k) || { contact: k, Current: 0, '1–30': 0, '31–60': 0, '61–90': 0, '90+': 0, total: 0 };
      const d = b.daysOverdue;
      const bucket = d <= 0 ? 'Current' : d <= 30 ? '1–30' : d <= 60 ? '31–60' : d <= 90 ? '61–90' : '90+';
      v[bucket] = round2(v[bucket] + b.outstanding); v.total = round2(v.total + b.outstanding);
      by.set(k, v);
    });
    const rows = [...by.values()];
    const totals = { contact: 'Total', total: 0 };
    buckets.forEach(k => { totals[k] = round2(rows.reduce((s, r) => s + r[k], 0)); });
    totals.total = round2(rows.reduce((s, r) => s + r.total, 0));
    return { buckets, rows, totals };
  }

  // ── Reconciliation ─────────────────────────────────────────────────────
  function reconRow(r) {
    const [y, mo] = r.period.split('-').map(Number);
    const from = `${r.period}-01`;
    const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const lines = F.movementRows(r.account_id, from, to);
    const cleared = new Set(all('SELECT kind, ref_id AS id FROM acct_recon_items WHERE recon_id = ?', r.id).map(x => `${x.kind}:${x.id}`));
    const items = lines.map(l => ({ ...l, cleared: cleared.has(`${l.kind}:${l.id}`) }));
    const clearedIn = round2(items.filter(i => i.cleared).reduce((s, i) => s + i.inflow, 0));
    const clearedOut = round2(items.filter(i => i.cleared).reduce((s, i) => s + i.outflow, 0));
    const difference = round2(r.closing - (r.opening + clearedIn - clearedOut));
    return { id: r.id, accountId: r.account_id, accountName: r.accountName, period: r.period, opening: round2(r.opening), closing: round2(r.closing), status: r.status,
      openedAt: r.opened_at, openedBy: r.openedByName, completedAt: r.completed_at, items, clearedIn, clearedOut, difference };
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    if (!p.startsWith('/api/admin/acct')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const g = k => cleanText(url.searchParams.get(k));

    // Chart of accounts
    if (m === 'GET' && p === '/api/admin/acct/accounts') {
      let rows = accounts();
      if (g('type')) rows = rows.filter(a => a.type === g('type'));
      if (g('status') === 'active') rows = rows.filter(a => a.isActive);
      if (g('status') === 'inactive') rows = rows.filter(a => !a.isActive);
      return sendJson(res, 200, { accounts: rows }), true;
    }
    const accMatch = p.match(/^\/api\/admin\/acct\/accounts(?:\/(\d+))?$/);
    if (accMatch && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const code = cleanText(b.code);
      const name = cleanText(b.name);
      const type = cleanText(b.type);
      if (!code || !name) return sendJson(res, 400, { error: 'Account code and name are required' }), true;
      if (!TYPES.includes(type)) return sendJson(res, 400, { error: 'Choose the account type' }), true;
      const normal = ['debit', 'credit'].includes(b.normalBalance) ? b.normalBalance : (['asset', 'expense'].includes(type) ? 'debit' : 'credit');
      const parentId = Number(b.parentId) || null;
      if (parentId && !one('SELECT id FROM acct_accounts WHERE id = ? AND is_group = 1', parentId)) return sendJson(res, 400, { error: 'The parent must be a group account' }), true;
      try {
        if (m === 'POST') run('INSERT INTO acct_accounts (code, name, type, normal_balance, is_active, parent_id, is_group, is_system, description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
          code, name, type, normal, b.isActive === false ? 0 : 1, parentId, b.isGroup ? 1 : 0, cleanText(b.description) || null);
        else {
          const cur = one('SELECT * FROM acct_accounts WHERE id = ?', Number(accMatch[1]));
          if (!cur) return sendJson(res, 404, { error: 'Account not found' }), true;
          if (cur.is_system && (code !== cur.code || type !== cur.type)) return sendJson(res, 400, { error: 'System accounts keep their code and type' }), true;
          run('UPDATE acct_accounts SET code = ?, name = ?, type = ?, normal_balance = ?, is_active = ?, parent_id = ?, is_group = ?, description = ? WHERE id = ?',
            code, name, type, normal, b.isActive === false ? 0 : 1, parentId, b.isGroup ? 1 : 0, cleanText(b.description) || null, cur.id);
        }
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'An account with that code already exists' }), true;
        throw err;
      }
      return sendJson(res, 200, { ok: true }), true;
    }
    if (accMatch && accMatch[1] && m === 'DELETE') {
      const id = Number(accMatch[1]);
      const a = one('SELECT is_system AS s FROM acct_accounts WHERE id = ?', id);
      if (!a) return sendJson(res, 404, { error: 'Account not found' }), true;
      if (a.s) return sendJson(res, 400, { error: 'System accounts cannot be deleted — make them inactive instead' }), true;
      if (one('SELECT 1 FROM acct_journal_lines WHERE account_id = ? LIMIT 1', id)) return sendJson(res, 400, { error: 'This account has entries posted to it' }), true;
      if (one('SELECT 1 FROM acct_accounts WHERE parent_id = ? LIMIT 1', id)) return sendJson(res, 400, { error: 'Move or delete the accounts under this group first' }), true;
      run('DELETE FROM acct_accounts WHERE id = ?', id);
      return sendJson(res, 200, { ok: true }), true;
    }

    // Auto-posting
    if (m === 'GET' && p === '/api/admin/acct/auto-posting') {
      return sendJson(res, 200, { enabled: F.autoPostingOn(), accounts: F.finAccounts(), assetAccounts: accounts().filter(a => a.type === 'asset' && !a.isGroup) }), true;
    }
    if (m === 'PUT' && p === '/api/admin/acct/auto-posting') {
      const b = await readJson(req);
      if (b.enabled !== undefined) setMeta('acct_auto_posting', b.enabled ? '1' : '0');
      (Array.isArray(b.mappings) ? b.mappings : []).forEach(x => run('UPDATE fin_accounts SET coa_account_id = ? WHERE id = ?', Number(x.coaAccountId) || null, Number(x.accountId)));
      return sendJson(res, 200, { ok: true, enabled: F.autoPostingOn() }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/auto-posting/backfill') {
      // posts everything recorded before Auto-Posting was switched on
      let n = 0;
      F.tx(() => {
        all('SELECT id FROM income_entries WHERE gl_entry_id IS NULL').forEach(r => { if (F.glPostIncome(r.id, user.id, true)) n += 1; });
        all('SELECT id FROM expenses WHERE gl_entry_id IS NULL').forEach(r => { if (F.glPostExpense(r.id, user.id, true)) n += 1; });
      });
      return sendJson(res, 200, { ok: true, posted: n }), true;
    }

    // Period management
    if (m === 'GET' && p === '/api/admin/acct/periods') {
      const terms = F.sessions();
      const locks = all('SELECT * FROM acct_period_locks');
      const rows = terms.map(t => {
        const lock = locks.find(l => l.session_label === t.sessionLabel && l.term_label === t.termLabel);
        const dates = one(`SELECT MIN(d) AS a, MAX(d) AS b FROM (SELECT income_date AS d FROM income_entries UNION ALL SELECT expense_date FROM expenses UNION ALL SELECT entry_date FROM acct_journal_entries)
                            WHERE d BETWEEN ? AND ?`, lock ? lock.from_date : '0000', lock ? lock.to_date : '0000');
        return { sessionLabel: t.sessionLabel, termLabel: t.termLabel, status: lock && lock.status === 'locked' ? 'locked' : 'open',
          fromDate: lock ? lock.from_date : null, toDate: lock ? lock.to_date : null, datesOnFile: dates && dates.a ? `${dates.a} → ${dates.b}` : '' };
      });
      return sendJson(res, 200, { periods: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/periods/lock') {
      const b = await readJson(req);
      const from = cleanText(b.fromDate);
      const to = cleanText(b.toDate);
      if (!cleanText(b.sessionLabel) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return sendJson(res, 400, { error: 'Choose the session / term and a valid date range' }), true;
      run(`INSERT INTO acct_period_locks (session_label, term_label, from_date, to_date, status, locked_by, locked_at) VALUES (?, ?, ?, ?, 'locked', ?, ?)
           ON CONFLICT(session_label, term_label) DO UPDATE SET from_date = excluded.from_date, to_date = excluded.to_date, status = 'locked', locked_by = excluded.locked_by, locked_at = excluded.locked_at`,
        cleanText(b.sessionLabel), cleanText(b.termLabel) || '', from, to, user.id, nowIso());
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/periods/unlock') {
      const b = await readJson(req);
      run("UPDATE acct_period_locks SET status = 'open' WHERE session_label = ? AND term_label = ?", cleanText(b.sessionLabel), cleanText(b.termLabel) || '');
      return sendJson(res, 200, { ok: true }), true;
    }

    // Currencies
    if (m === 'GET' && p === '/api/admin/acct/currencies') return sendJson(res, 200, { base: 'NGN', currencies: all('SELECT * FROM acct_currencies ORDER BY code') }), true;
    const curMatch = p.match(/^\/api\/admin\/acct\/currencies(?:\/(\d+))?$/);
    if (curMatch && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const code = cleanText(b.code).toUpperCase();
      if (!/^[A-Z]{3}$/.test(code) || !cleanText(b.name)) return sendJson(res, 400, { error: 'A 3-letter code and a name are required' }), true;
      if (code === 'NGN') return sendJson(res, 400, { error: 'NGN is the base currency' }), true;
      try {
        if (m === 'POST') run('INSERT INTO acct_currencies (code, name, symbol, rate, status) VALUES (?, ?, ?, ?, ?)', code, cleanText(b.name), cleanText(b.symbol) || null, Number(b.rate) || 1, b.status === 'inactive' ? 'inactive' : 'active');
        else run('UPDATE acct_currencies SET code = ?, name = ?, symbol = ?, rate = ?, status = ? WHERE id = ?', code, cleanText(b.name), cleanText(b.symbol) || null, Number(b.rate) || 1, b.status === 'inactive' ? 'inactive' : 'active', Number(curMatch[1]));
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'That currency is already added' }), true;
        throw err;
      }
      return sendJson(res, 200, { ok: true }), true;
    }
    if (curMatch && curMatch[1] && m === 'DELETE') { run('DELETE FROM acct_currencies WHERE id = ?', Number(curMatch[1])); return sendJson(res, 200, { ok: true }), true; }

    // Journal entries
    if (m === 'GET' && p === '/api/admin/acct/journal-entries') {
      return sendJson(res, 200, { entries: entries({ status: g('status'), type: g('type'), from: g('from'), to: g('to') }), types: ENTRY_TYPES }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/journal-entries') {
      const b = await readJson(req);
      const v = readLines(b.lines);
      if (v.error) return sendJson(res, 400, { error: v.error }), true;
      const type = ENTRY_TYPES.includes(b.entryType) ? b.entryType : 'manual';
      const out = F.tx(() => F.postJournal({ date: cleanText(b.date) || today(), memo: cleanText(b.memo), type, lines: v.lines, userId: user.id, status: b.draft ? 'draft' : 'posted' }));
      return sendJson(res, 200, { ok: true, ...out }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/journal-entries/import') {
      const b = await F.readBigJson(req);
      const sheet = F.readSheet(b.file);
      const c = { ref: sheet.col('Entry', 'Entry No', 'Reference', 'Group'), date: sheet.col('Date'), memo: sheet.col('Description', 'Memo'), code: sheet.col('Account Code', 'Code', 'Account'),
        debit: sheet.col('Debit', 'Dr'), credit: sheet.col('Credit', 'Cr'), line: sheet.col('Line Description', 'Narration') };
      if (c.code === -1 || (c.debit === -1 && c.credit === -1)) return sendJson(res, 400, { error: 'The file needs "Account Code", "Debit" and "Credit" columns' }), true;
      const groups = new Map();
      sheet.rows.forEach((row, i) => {
        const key = sheet.cell(row, c.ref) || 'ENTRY';
        if (!groups.has(key)) groups.set(key, { date: sheet.date(row, c.date) || today(), memo: sheet.cell(row, c.memo), lines: [] });
        const acc = F.coaByCode(sheet.cell(row, c.code));
        groups.get(key).lines.push({ accountId: acc ? acc.id : 0, debit: sheet.cell(row, c.debit).replace(/[₦,\s]/g, ''), credit: sheet.cell(row, c.credit).replace(/[₦,\s]/g, ''), description: sheet.cell(row, c.line), row: i + 2 });
      });
      const errors = [];
      const ready = [];
      groups.forEach((grp, key) => { const v = readLines(grp.lines); if (v.error) errors.push(`${key}: ${v.error}`); else ready.push({ ...grp, lines: v.lines }); });
      if (errors.length) return sendJson(res, 400, { error: errors.slice(0, 4).join(' · ') }), true;
      F.tx(() => ready.forEach(grp => F.postJournal({ date: grp.date, memo: grp.memo, type: 'manual', lines: grp.lines, userId: user.id, status: 'draft' })));
      return sendJson(res, 200, { ok: true, count: ready.length }), true;
    }
    const jeMatch = p.match(/^\/api\/admin\/acct\/journal-entries\/(\d+)(?:\/(post|reverse))?$/);
    if (jeMatch) {
      const e = one('SELECT * FROM acct_journal_entries WHERE id = ?', Number(jeMatch[1]));
      if (!e) return sendJson(res, 404, { error: 'Entry not found' }), true;
      if (m === 'POST' && jeMatch[2] === 'post') {
        if (e.status !== 'draft') return sendJson(res, 400, { error: 'Only drafts can be posted' }), true;
        F.assertOpenPeriod(e.entry_date);
        run("UPDATE acct_journal_entries SET status = 'posted', posted_by = ?, posted_at = ? WHERE id = ?", user.id, nowIso(), e.id);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'POST' && jeMatch[2] === 'reverse') {
        if (e.status !== 'posted') return sendJson(res, 400, { error: 'Only posted entries can be reversed' }), true;
        const out = F.tx(() => F.reverseJournal(e.id, user.id));
        ['income_entries', 'expenses'].forEach(t => run(`UPDATE ${t} SET gl_entry_id = NULL WHERE gl_entry_id = ?`, e.id));
        return sendJson(res, 200, { ok: true, ...out }), true;
      }
      if (m === 'DELETE') {
        if (e.status !== 'draft') return sendJson(res, 400, { error: 'Posted entries cannot be deleted — reverse them instead' }), true;
        run('DELETE FROM acct_journal_entries WHERE id = ?', e.id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    if (m === 'GET' && p === '/api/admin/acct/ledger') {
      const a = accounts().find(x => x.id === Number(g('accountId')));
      if (!a) return sendJson(res, 400, { error: 'Select an account' }), true;
      const from = g('from');
      const to = g('to');
      const opening = from ? natural(a, sums(a.id, { to: prevDay(from) })) : 0;
      let sql = `SELECT jl.id, je.entry_no AS entryNo, je.entry_date AS entryDate, je.memo AS entryMemo, je.entry_type AS entryType, jl.debit, jl.credit, jl.description
                 FROM acct_journal_lines jl JOIN acct_journal_entries je ON je.id = jl.entry_id WHERE jl.account_id = ? AND je.status <> 'draft'`;
      const prm = [a.id];
      if (from) { sql += ' AND je.entry_date >= ?'; prm.push(from); }
      if (to) { sql += ' AND je.entry_date <= ?'; prm.push(to); }
      let bal = opening;
      const lines = all(`${sql} ORDER BY je.entry_date, je.id, jl.id`, ...prm).map(l => {
        bal = round2(bal + (a.normalBalance === 'debit' ? l.debit - l.credit : l.credit - l.debit));
        return { ...l, runningBalance: bal };
      });
      return sendJson(res, 200, { account: a, opening, lines, closingBalance: bal }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/trial-balance') {
      const asAt = g('asAt') || today();
      let td = 0, tc = 0;
      const rows = accounts().filter(a => !a.isGroup).map(a => {
        const s = sums(a.id, { to: asAt });
        const net = round2(s.debit - s.credit);
        const debit = net > 0 ? net : 0;
        const credit = net < 0 ? -net : 0;
        td += debit; tc += credit;
        return { ...a, totalDebit: debit, totalCredit: credit };
      }).filter(a => a.totalDebit || a.totalCredit);
      return sendJson(res, 200, { asAt, accounts: rows, totalDebit: round2(td), totalCredit: round2(tc), balanced: Math.abs(td - tc) < 0.01 }), true;
    }

    // Contacts
    if (m === 'GET' && p === '/api/admin/acct/contacts') {
      let rows = all(`SELECT id, code, name, type, contact_person AS contactPerson, email, phone, address, terms_days AS termsDays, status, created_at AS createdAt FROM acct_contacts ORDER BY name`);
      if (g('type')) rows = rows.filter(r => r.type === g('type'));
      if (g('status')) rows = rows.filter(r => r.status === g('status'));
      const bl = bills();
      rows = rows.map(r => {
        const mine = bl.filter(b => b.contactId === r.id && b.status !== 'void');
        return { ...r, payable: round2(mine.filter(b => b.docType === 'bill').reduce((s, b) => s + b.outstanding, 0)), receivable: round2(mine.filter(b => b.docType === 'invoice').reduce((s, b) => s + b.outstanding, 0)) };
      });
      return sendJson(res, 200, { contacts: rows }), true;
    }
    const conMatch = p.match(/^\/api\/admin\/acct\/contacts(?:\/(\d+))?$/);
    if (conMatch && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const name = cleanText(b.name);
      const type = ['vendor', 'customer'].includes(b.type) ? b.type : null;
      if (!name || !type) return sendJson(res, 400, { error: 'Business name and type are required' }), true;
      const vals = [name, type, cleanText(b.contactPerson) || null, cleanText(b.email) || null, cleanText(b.phone) || null, cleanText(b.address) || null, Math.max(0, Number(b.termsDays) || 0), b.status === 'inactive' ? 'inactive' : 'active'];
      if (m === 'POST') run('INSERT INTO acct_contacts (name, type, contact_person, email, phone, address, terms_days, status, created_at, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...vals, nowIso(), F.sequenceCode('acct_contacts', 'code', type === 'vendor' ? 'VEN-' : 'CUS-', 4));
      else run('UPDATE acct_contacts SET name = ?, type = ?, contact_person = ?, email = ?, phone = ?, address = ?, terms_days = ?, status = ? WHERE id = ?', ...vals, Number(conMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (conMatch && conMatch[1] && m === 'DELETE') {
      if (one('SELECT 1 FROM acct_bills WHERE contact_id = ? LIMIT 1', Number(conMatch[1]))) return sendJson(res, 400, { error: 'This contact has bills or invoices — make it inactive instead' }), true;
      run('DELETE FROM acct_contacts WHERE id = ?', Number(conMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }

    // Bills (AP) and customer invoices (AR)
    if (m === 'GET' && p === '/api/admin/acct/bills') return sendJson(res, 200, { bills: bills({ type: g('type'), status: g('status'), from: g('from'), to: g('to') }) }), true;
    if (m === 'GET' && p === '/api/admin/acct/ageing') return sendJson(res, 200, ageing(g('type') === 'invoice' ? 'invoice' : 'bill')), true;
    const billMatch = p.match(/^\/api\/admin\/acct\/bills(?:\/(\d+))?(?:\/(pay|void))?$/);
    if (billMatch && !billMatch[2] && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const amount = posMoney(b.amount);
      const docType = b.docType === 'invoice' ? 'invoice' : 'bill';
      if (!Number(b.contactId)) return sendJson(res, 400, { error: `Choose the ${docType === 'bill' ? 'vendor' : 'customer'}` }), true;
      if (!amount) return sendJson(res, 400, { error: 'A positive amount is required' }), true;
      const issue = cleanText(b.issueDate) || today();
      const terms = (one('SELECT terms_days AS t FROM acct_contacts WHERE id = ?', Number(b.contactId)) || {}).t || 0;
      const dueDefault = new Date(`${issue}T00:00:00Z`); dueDefault.setUTCDate(dueDefault.getUTCDate() + Number(terms));
      const vals = [Number(b.contactId), cleanText(b.docNo) || null, docType, issue, cleanText(b.dueDate) || dueDefault.toISOString().slice(0, 10), amount, cleanText(b.description) || null, cleanText(b.notes) || null];
      if (m === 'POST') {
        const id = F.tx(() => {
          const r = run(`INSERT INTO acct_bills (contact_id, doc_no, doc_type, issue_date, due_date, amount, description, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`,
            ...vals.map((v, i) => i === 1 ? (v || F.sequenceCode('acct_bills', 'doc_no', docType === 'bill' ? 'BILL-' : 'INV-', 4)) : v), nowIso());
          const bid = Number(r.lastInsertRowid);
          if (F.autoPostingOn()) F.postJournal({ date: issue, memo: `${docType === 'bill' ? 'Vendor bill' : 'Customer invoice'} ${cleanText(b.description)}`.trim(), type: 'vendor_invoice', source: 'bill', sourceId: bid, userId: user.id,
            lines: docType === 'bill'
              ? [{ accountId: Number(b.expenseAccountId) || F.coaId('5250'), debit: amount }, { accountId: F.coaId('2100'), credit: amount }]
              : [{ accountId: F.coaId('1400'), debit: amount }, { accountId: Number(b.incomeAccountId) || F.coaId('4200'), credit: amount }] });
          return bid;
        });
        return sendJson(res, 200, { ok: true, id }), true;
      }
      const cur = one('SELECT paid_amount AS p FROM acct_bills WHERE id = ?', Number(billMatch[1]));
      if (!cur) return sendJson(res, 404, { error: 'Not found' }), true;
      if (amount < cur.p) return sendJson(res, 400, { error: 'The amount cannot be less than what has been paid' }), true;
      run('UPDATE acct_bills SET contact_id = ?, doc_no = ?, doc_type = ?, issue_date = ?, due_date = ?, amount = ?, description = ?, notes = ? WHERE id = ?', ...vals, Number(billMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (billMatch && billMatch[1] && billMatch[2] === 'pay' && m === 'POST') {
      const bill = bills().find(x => x.id === Number(billMatch[1]));
      if (!bill) return sendJson(res, 404, { error: 'Not found' }), true;
      const b = await readJson(req);
      const amount = posMoney(b.amount);
      if (!amount || amount > bill.outstanding + 0.01) return sendJson(res, 400, { error: `Enter an amount up to ₦${bill.outstanding.toLocaleString()}` }), true;
      const date = cleanText(b.date) || today();
      F.tx(() => {
        const accountId = Number(b.accountId) || F.defaultFinAccountId();
        let linkKind; let linkId;
        if (bill.docType === 'bill') {
          linkKind = 'expense';
          linkId = F.addExpense({ category: cleanText(b.category) || 'Vendor Payments', item: bill.docNo, title: `${bill.docNo} — ${bill.contactName}`, description: bill.description || `Payment of ${bill.docNo}`, amount, date, userId: user.id, source: 'vendor_payment', sourceId: bill.id, accountId, method: cleanText(b.method) || 'Bank', paidTo: bill.contactName });
        } else {
          linkKind = 'income';
          linkId = F.addIncome({ category: cleanText(b.category) || 'Customer Receipts', item: bill.docNo, description: bill.description || `Receipt for ${bill.docNo}`, amount, date, userId: user.id, source: 'customer_receipt', sourceId: bill.id, accountId, method: cleanText(b.method) || 'Bank', receivedFrom: bill.contactName });
        }
        run('INSERT INTO acct_bill_payments (bill_id, amount, paid_on, account_id, method, reference, link_kind, link_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          bill.id, amount, date, accountId, cleanText(b.method) || null, cleanText(b.reference) || null, linkKind, linkId, user.id, nowIso());
        run('UPDATE acct_bills SET paid_amount = paid_amount + ? WHERE id = ?', amount, bill.id);
      });
      return sendJson(res, 200, { ok: true }), true;
    }
    if (billMatch && billMatch[1] && billMatch[2] === 'void' && m === 'POST') {
      const bill = bills().find(x => x.id === Number(billMatch[1]));
      if (!bill || bill.paid > 0) return sendJson(res, 400, { error: 'Only unpaid documents can be voided' }), true;
      run("UPDATE acct_bills SET status = 'void' WHERE id = ?", bill.id);
      return sendJson(res, 200, { ok: true }), true;
    }
    if (billMatch && billMatch[1] && !billMatch[2] && m === 'DELETE') {
      const bill = bills().find(x => x.id === Number(billMatch[1]));
      if (!bill || bill.paid > 0 || bill.grnId) return sendJson(res, 400, { error: 'Paid documents and bills from goods received cannot be deleted' }), true;
      run('DELETE FROM acct_bills WHERE id = ?', bill.id);
      return sendJson(res, 200, { ok: true }), true;
    }

    // Budgets
    if (m === 'GET' && p === '/api/admin/acct/budgets') {
      let periods = all('SELECT id, name, period_from AS periodFrom, period_to AS periodTo, status, notes FROM acct_budget_periods ORDER BY period_from DESC');
      if (g('status')) periods = periods.filter(x => x.status === g('status'));
      const accs = accounts();
      const out = periods.map(bp => {
        const lines = all('SELECT id, account_id AS accountId, amount, notes FROM acct_budgets WHERE budget_id = ?', bp.id).map(l => {
          const a = accs.find(x => x.id === l.accountId) || {};
          const actual = a.id ? natural(a, sums(a.id, { from: bp.periodFrom, to: bp.periodTo })) : 0;
          return { ...l, accountCode: a.code, accountName: a.name, type: a.type, amount: round2(l.amount), actual, variance: round2(l.amount - actual), usedPct: l.amount ? round2(actual / l.amount * 100) : 0 };
        });
        return { ...bp, lines, budgeted: round2(lines.reduce((s, l) => s + l.amount, 0)), actual: round2(lines.reduce((s, l) => s + l.actual, 0)) };
      });
      return sendJson(res, 200, { budgets: out }), true;
    }
    const budMatch = p.match(/^\/api\/admin\/acct\/budgets(?:\/(\d+))?$/);
    if (budMatch && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      const name = cleanText(b.name);
      if (!name || !cleanText(b.periodFrom) || !cleanText(b.periodTo)) return sendJson(res, 400, { error: 'Name and period are required' }), true;
      const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ accountId: Number(l.accountId), amount: money(l.amount), notes: cleanText(l.notes) })).filter(l => l.accountId && l.amount > 0);
      if (!lines.length) return sendJson(res, 400, { error: 'Add at least one budget line' }), true;
      F.tx(() => {
        let id = Number(budMatch[1]);
        if (m === 'POST') id = Number(run('INSERT INTO acct_budget_periods (name, period_from, period_to, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', name, cleanText(b.periodFrom), cleanText(b.periodTo), ['draft', 'approved', 'closed'].includes(b.status) ? b.status : 'draft', cleanText(b.notes) || null, nowIso()).lastInsertRowid);
        else { run('UPDATE acct_budget_periods SET name = ?, period_from = ?, period_to = ?, status = ?, notes = ? WHERE id = ?', name, cleanText(b.periodFrom), cleanText(b.periodTo), ['draft', 'approved', 'closed'].includes(b.status) ? b.status : 'draft', cleanText(b.notes) || null, id); run('DELETE FROM acct_budgets WHERE budget_id = ?', id); }
        lines.forEach(l => run('INSERT INTO acct_budgets (account_id, period_label, amount, notes, budget_id) VALUES (?, ?, ?, ?, ?)', l.accountId, name, l.amount, l.notes || null, id));
      });
      return sendJson(res, 200, { ok: true }), true;
    }
    if (budMatch && budMatch[1] && m === 'DELETE') {
      F.tx(() => { run('DELETE FROM acct_budgets WHERE budget_id = ?', Number(budMatch[1])); run('DELETE FROM acct_budget_periods WHERE id = ?', Number(budMatch[1])); });
      return sendJson(res, 200, { ok: true }), true;
    }

    // Bank reconciliation
    if (m === 'GET' && p === '/api/admin/acct/reconciliations') {
      let rows = all('SELECT r.*, fa.name AS accountName, u.name AS openedByName FROM acct_reconciliations r JOIN fin_accounts fa ON fa.id = r.account_id LEFT JOIN users u ON u.id = r.opened_by ORDER BY r.period DESC, fa.name');
      if (g('accountId')) rows = rows.filter(r => r.account_id === Number(g('accountId')));
      if (g('period')) rows = rows.filter(r => r.period === g('period'));
      return sendJson(res, 200, { reconciliations: rows.map(r => { const x = reconRow(r); delete x.items; return x; }) }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/reconciliations') {
      const b = await readJson(req);
      const acc = F.finAccountById(b.accountId);
      const period = cleanText(b.period);
      if (!acc || !/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { error: 'Choose the account and the month' }), true;
      if (one('SELECT id FROM acct_reconciliations WHERE account_id = ? AND period = ?', acc.id, period)) return sendJson(res, 400, { error: 'That month is already being reconciled for this account' }), true;
      const r = run(`INSERT INTO acct_reconciliations (account_id, period, opening, closing, status, opened_by, opened_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`, acc.id, period, money(b.opening), money(b.closing), user.id, nowIso());
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) }), true;
    }
    const recMatch = p.match(/^\/api\/admin\/acct\/reconciliations\/(\d+)(?:\/(toggle|complete|reopen))?$/);
    if (recMatch) {
      const r = one('SELECT r.*, fa.name AS accountName, u.name AS openedByName FROM acct_reconciliations r JOIN fin_accounts fa ON fa.id = r.account_id LEFT JOIN users u ON u.id = r.opened_by WHERE r.id = ?', Number(recMatch[1]));
      if (!r) return sendJson(res, 404, { error: 'Not found' }), true;
      if (m === 'GET') return sendJson(res, 200, { reconciliation: reconRow(r) }), true;
      if (m === 'PUT') {
        const b = await readJson(req);
        if (r.status === 'completed') return sendJson(res, 400, { error: 'Reopen it first' }), true;
        run('UPDATE acct_reconciliations SET opening = ?, closing = ? WHERE id = ?', money(b.opening), money(b.closing), r.id);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') { run('DELETE FROM acct_reconciliations WHERE id = ?', r.id); return sendJson(res, 200, { ok: true }), true; }
      if (m === 'POST' && recMatch[2] === 'toggle') {
        if (r.status === 'completed') return sendJson(res, 400, { error: 'Reopen it first' }), true;
        const b = await readJson(req);
        if (b.cleared) run('INSERT OR IGNORE INTO acct_recon_items (recon_id, kind, ref_id) VALUES (?, ?, ?)', r.id, cleanText(b.kind), Number(b.refId));
        else run('DELETE FROM acct_recon_items WHERE recon_id = ? AND kind = ? AND ref_id = ?', r.id, cleanText(b.kind), Number(b.refId));
        return sendJson(res, 200, { ok: true, reconciliation: reconRow(r) }), true;
      }
      if (m === 'POST' && recMatch[2] === 'complete') {
        const x = reconRow(r);
        if (Math.abs(x.difference) > 0.01) return sendJson(res, 400, { error: `There is still a ₦${x.difference.toLocaleString()} difference` }), true;
        run("UPDATE acct_reconciliations SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), r.id);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'POST' && recMatch[2] === 'reopen') { run("UPDATE acct_reconciliations SET status = 'open', completed_at = NULL WHERE id = ?", r.id); return sendJson(res, 200, { ok: true }), true; }
    }

    // Tax & compliance
    if (m === 'GET' && p === '/api/admin/acct/tax/overview') {
      const period = g('period') || today().slice(0, 7);
      const sal = all("SELECT paye, pension_emp AS pe, pension_er AS pr, nhis, nhf FROM staff_salaries WHERE period = ? AND excluded = 0", period);
      const s = k => round2(sal.reduce((a, x) => a + (x[k] || 0), 0));
      const rem = all('SELECT obligation, amount, date_remitted AS dateRemitted, reference FROM acct_payroll_remittances WHERE period = ?', period);
      const ob = (name, regulator, emp, er) => {
        const r = rem.find(x => x.obligation === name);
        const owed = round2(emp + er);
        return { obligation: name, regulator, employee: emp, employer: er, total: owed, status: !sal.length ? 'no_data' : r ? (r.amount >= owed - 0.01 ? 'remitted' : 'part') : (owed > 0 ? 'due' : 'no_data'), dateRemitted: r ? r.dateRemitted : null, reference: r ? r.reference : null, remitted: r ? round2(r.amount) : 0 };
      };
      const obligations = [ob('PAYE Tax', 'Income Tax Authority', s('paye'), 0), ob('Pension', 'Pension Authority', s('pe'), s('pr')), ob('Health Insurance', 'Health Insurance Authority', s('nhis'), 0), ob('Housing Fund', 'Housing Fund Authority', s('nhf'), 0)];
      const codes = all('SELECT tc.id, tc.code, tc.name, tc.rate, tc.gl_account_id AS glAccountId, a.code AS acctCode, a.name AS glName FROM acct_tax_codes tc LEFT JOIN acct_accounts a ON a.id = tc.gl_account_id WHERE tc.status = ?', 'active')
        .map(tc => { const x = tc.glAccountId ? sums(tc.glAccountId) : { debit: 0, credit: 0 }; const out = round2(x.credit - x.debit); return { ...tc, accumulated: x.credit, remitted: x.debit, outstanding: out, status: out > 0.01 ? 'outstanding' : 'cleared' }; });
      return sendJson(res, 200, { period, obligations, totalPayroll: round2(obligations.reduce((a, o) => a + o.total, 0)), employeeSide: round2(obligations.reduce((a, o) => a + o.employee, 0)), employerSide: round2(obligations.reduce((a, o) => a + o.employer, 0)), codes, totalTax: round2(codes.reduce((a, c) => a + c.outstanding, 0)) }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/tax/sources') {
      const period = g('period');
      const ob = g('obligation');
      const col = { 'PAYE Tax': 'paye', Pension: 'pension_emp + pension_er', 'Health Insurance': 'nhis', 'Housing Fund': 'nhf' }[ob] || 'paye';
      return sendJson(res, 200, { rows: all(`SELECT u.name, s.staff_id AS staffId, s.base_salary AS basic, (s.base_salary + s.allowances) AS gross, (${col}) AS amount FROM staff_salaries s JOIN users u ON u.id = s.staff_id WHERE s.period = ? AND s.excluded = 0 ORDER BY u.name`, period).map(r => ({ ...r, amount: round2(r.amount) })) }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/tax/payroll-remittances') {
      return sendJson(res, 200, { remittances: all('SELECT r.*, u.name AS createdByName FROM acct_payroll_remittances r LEFT JOIN users u ON u.id = r.created_by ORDER BY period DESC, obligation') }), true;
    }
    if (m === 'POST' && p === '/api/admin/acct/tax/payroll-remittances') {
      const b = await readJson(req);
      const amount = posMoney(b.amount);
      if (!/^\d{4}-\d{2}$/.test(cleanText(b.period)) || !cleanText(b.obligation) || !amount) return sendJson(res, 400, { error: 'Period, obligation and amount are required' }), true;
      const date = cleanText(b.dateRemitted) || today();
      F.tx(() => {
        run(`INSERT INTO acct_payroll_remittances (period, obligation, amount, date_remitted, reference, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(period, obligation) DO UPDATE SET amount = excluded.amount, date_remitted = excluded.date_remitted, reference = excluded.reference`,
          cleanText(b.period), cleanText(b.obligation), amount, date, cleanText(b.reference) || null, user.id, nowIso());
        if (b.recordExpense !== false) F.addExpense({ category: 'Payroll Statutory Remittances', item: cleanText(b.obligation), title: `${cleanText(b.obligation)} — ${cleanText(b.period)}`, description: `${cleanText(b.obligation)} remittance for ${cleanText(b.period)}`, amount, date, userId: user.id, source: 'payroll_remittance', accountId: Number(b.accountId) || null, method: 'Bank', paidTo: cleanText(b.regulator) || cleanText(b.obligation), voucherNo: cleanText(b.reference) || null });
      });
      return sendJson(res, 200, { ok: true }), true;
    }
    const taxSimple = p.match(/^\/api\/admin\/acct\/tax\/(codes|types|regulators)(?:\/(\d+))?$/);
    if (taxSimple) {
      const table = { codes: 'acct_tax_codes', types: 'acct_tax_types', regulators: 'acct_regulators' }[taxSimple[1]];
      if (m === 'GET') {
        const sql = { codes: 'SELECT tc.*, a.code AS acctCode, a.name AS glName FROM acct_tax_codes tc LEFT JOIN acct_accounts a ON a.id = tc.gl_account_id ORDER BY tc.code',
          types: 'SELECT t.*, r.name AS regulatorName FROM acct_tax_types t LEFT JOIN acct_regulators r ON r.id = t.regulator_id ORDER BY t.name', regulators: 'SELECT * FROM acct_regulators ORDER BY name' }[taxSimple[1]];
        return sendJson(res, 200, { rows: all(sql) }), true;
      }
      if (m === 'DELETE' && taxSimple[2]) { run(`DELETE FROM ${table} WHERE id = ?`, Number(taxSimple[2])); return sendJson(res, 200, { ok: true }), true; }
      if (m === 'POST' || m === 'PUT') {
        const b = await readJson(req);
        if (!cleanText(b.name)) return sendJson(res, 400, { error: 'Name is required' }), true;
        try {
          if (taxSimple[1] === 'codes') {
            if (!cleanText(b.code)) return sendJson(res, 400, { error: 'Code is required' }), true;
            const v = [cleanText(b.code).toUpperCase(), cleanText(b.name), Number(b.rate) || 0, Number(b.glAccountId) || null, b.status === 'inactive' ? 'inactive' : 'active'];
            if (m === 'POST') run('INSERT INTO acct_tax_codes (code, name, rate, gl_account_id, status) VALUES (?, ?, ?, ?, ?)', ...v);
            else run('UPDATE acct_tax_codes SET code = ?, name = ?, rate = ?, gl_account_id = ?, status = ? WHERE id = ?', ...v, Number(taxSimple[2]));
          } else if (taxSimple[1] === 'types') {
            const v = [cleanText(b.name), cleanText(b.description) || null, Number(b.regulatorId) || null];
            if (m === 'POST') run('INSERT INTO acct_tax_types (name, description, regulator_id) VALUES (?, ?, ?)', ...v);
            else run('UPDATE acct_tax_types SET name = ?, description = ?, regulator_id = ? WHERE id = ?', ...v, Number(taxSimple[2]));
          } else {
            const v = [cleanText(b.name), cleanText(b.shortName) || null, cleanText(b.contact) || null];
            if (m === 'POST') run('INSERT INTO acct_regulators (name, short_name, contact) VALUES (?, ?, ?)', ...v);
            else run('UPDATE acct_regulators SET name = ?, short_name = ?, contact = ? WHERE id = ?', ...v, Number(taxSimple[2]));
          }
        } catch (err) {
          if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'That already exists' }), true;
          throw err;
        }
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    // Tax remittances (filing log)
    if (m === 'GET' && p === '/api/admin/acct/tax-records') {
      return sendJson(res, 200, { records: all(`SELECT id, period_label AS periodLabel, tax_type AS taxType, amount_due AS amountDue, amount_paid AS amountPaid, status, due_date AS dueDate,
                                                  date_paid AS datePaid, reference, notes FROM acct_tax_records ORDER BY COALESCE(due_date, period_label) DESC, id DESC`) }), true;
    }
    const taxRec = p.match(/^\/api\/admin\/acct\/tax-records(?:\/(\d+))?$/);
    if (taxRec && (m === 'POST' || m === 'PUT')) {
      const b = await readJson(req);
      if (!cleanText(b.periodLabel) || !cleanText(b.taxType)) return sendJson(res, 400, { error: 'Period and tax type are required' }), true;
      const due = money(b.amountDue);
      const paid = money(b.amountPaid);
      const status = paid <= 0 ? 'pending' : paid >= due ? 'paid' : 'part paid';
      const v = [cleanText(b.periodLabel), cleanText(b.taxType), due, paid, status, cleanText(b.dueDate) || null, cleanText(b.datePaid) || null, cleanText(b.reference) || null, cleanText(b.notes) || null];
      if (m === 'POST') run('INSERT INTO acct_tax_records (period_label, tax_type, amount_due, amount_paid, status, due_date, date_paid, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ...v);
      else run('UPDATE acct_tax_records SET period_label = ?, tax_type = ?, amount_due = ?, amount_paid = ?, status = ?, due_date = ?, date_paid = ?, reference = ?, notes = ? WHERE id = ?', ...v, Number(taxRec[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (taxRec && taxRec[1] && m === 'DELETE') { run('DELETE FROM acct_tax_records WHERE id = ?', Number(taxRec[1])); return sendJson(res, 200, { ok: true }), true; }

    // Financial reports
    if (m === 'GET' && p === '/api/admin/acct/reports/pnl') {
      const from = g('from') || `${today().slice(0, 4)}-01-01`;
      const to = g('to') || today();
      const basis = g('basis') === 'ledger' ? 'ledger' : 'records';
      let income = []; let expense = [];
      if (basis === 'ledger') {
        const accs = accounts().filter(a => !a.isGroup);
        income = accs.filter(a => a.type === 'income').map(a => ({ name: `${a.code} ${a.name}`, accountId: a.id, amount: natural(a, sums(a.id, { from, to })) })).filter(x => x.amount);
        expense = accs.filter(a => a.type === 'expense').map(a => ({ name: `${a.code} ${a.name}`, accountId: a.id, amount: natural(a, sums(a.id, { from, to })) })).filter(x => x.amount);
      } else {
        income = all('SELECT category AS name, SUM(amount) AS amount FROM income_entries WHERE income_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to).map(r => ({ ...r, amount: round2(r.amount) }));
        expense = all('SELECT category AS name, SUM(amount) AS amount FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to).map(r => ({ ...r, amount: round2(r.amount) }));
      }
      const ti = round2(income.reduce((s, x) => s + x.amount, 0));
      const te = round2(expense.reduce((s, x) => s + x.amount, 0));
      let budget = null;
      if (g('budgetId')) {
        const lines = all('SELECT account_id AS accountId, amount FROM acct_budgets WHERE budget_id = ?', Number(g('budgetId')));
        budget = Object.fromEntries(lines.map(l => [l.accountId, round2(l.amount)]));
      }
      return sendJson(res, 200, { from, to, basis, income, expense, totalIncome: ti, totalExpense: te, net: round2(ti - te), budget }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/reports/balance-sheet') {
      const asAt = g('asAt') || today();
      const accs = accounts().filter(a => !a.isGroup);
      const line = type => accs.filter(a => a.type === type).map(a => ({ name: `${a.code} ${a.name}`, amount: natural(a, sums(a.id, { to: asAt })) })).filter(x => x.amount);
      const assets = line('asset');
      const liabilities = line('liability');
      const equity = line('equity');
      const retained = round2(accs.filter(a => a.type === 'income').reduce((s, a) => s + natural(a, sums(a.id, { to: asAt })), 0) - accs.filter(a => a.type === 'expense').reduce((s, a) => s + natural(a, sums(a.id, { to: asAt })), 0));
      const ta = round2(assets.reduce((s, x) => s + x.amount, 0));
      const tl = round2(liabilities.reduce((s, x) => s + x.amount, 0));
      const te = round2(equity.reduce((s, x) => s + x.amount, 0) + retained);
      return sendJson(res, 200, { asAt, assets, liabilities, equity, retained, totalAssets: ta, totalLiabilities: tl, totalEquity: te, balanced: Math.abs(ta - tl - te) < 0.01 }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/reports/fee-ageing') {
      const rows = all(`SELECT fi.id, fi.student_id AS studentId, st.name, c.label AS classLabel, fi.due_date AS dueDate, fi.amount,
                               (SELECT COALESCE(SUM(amount),0) FROM fee_payments WHERE invoice_id = fi.id AND status = 'successful') AS paid,
                               t.session_label AS sessionLabel
                        FROM fee_invoices fi JOIN students st ON st.id = fi.student_id JOIN classes c ON c.code = fi.class_code LEFT JOIN academic_terms t ON t.id = fi.academic_id`)
        .map(r => ({ ...r, balance: round2(r.amount - r.paid) })).filter(r => r.balance > 0);
      const by = new Map();
      rows.forEach(r => {
        const days = r.dueDate ? Math.floor((Date.now() - new Date(`${r.dueDate}T00:00:00Z`)) / 86400000) : 0;
        const k = days <= 0 ? 'Current' : days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+';
        const v = by.get(r.studentId) || { studentId: r.studentId, name: r.name, classLabel: r.classLabel, Current: 0, '1–30': 0, '31–60': 0, '61–90': 0, '90+': 0, total: 0 };
        v[k] = round2(v[k] + r.balance); v.total = round2(v.total + r.balance);
        by.set(r.studentId, v);
      });
      const groups = new Map();
      rows.forEach(r => { const k = r.sessionLabel || '—'; const v = groups.get(k) || { session: k, students: new Set(), total: 0 }; v.students.add(r.studentId); v.total = round2(v.total + r.balance); groups.set(k, v); });
      return sendJson(res, 200, { buckets: ['Current', '1–30', '31–60', '61–90', '90+'], rows: [...by.values()].sort((a, b) => b.total - a.total),
        groups: [...groups.values()].map(x => ({ session: x.session, students: x.students.size, total: x.total })) }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/reports/payroll-remittance') {
      const period = g('period') || today().slice(0, 7);
      return sendJson(res, 200, { period, rows: all(`SELECT u.name, s.staff_id AS staffId, (s.base_salary + s.allowances) AS gross, s.paye, s.pension_emp AS pensionEmp, s.pension_er AS pensionEr, s.nhis, s.nhf
                                                    FROM staff_salaries s JOIN users u ON u.id = s.staff_id WHERE s.period = ? AND s.excluded = 0 ORDER BY u.name`, period).map(r => ({ ...r, gross: round2(r.gross) })) }), true;
    }
    if (m === 'GET' && p === '/api/admin/acct/financial-reports') {
      const accs = accounts().filter(a => !a.isGroup);
      const tot = type => round2(accs.filter(a => a.type === type).reduce((s, a) => s + natural(a, sums(a.id)), 0));
      const ti = tot('income'); const te = tot('expense');
      return sendJson(res, 200, { hasData: !!one("SELECT 1 FROM acct_journal_lines LIMIT 1"), totalIncome: ti, totalExpense: te, netIncome: round2(ti - te), totalAssets: tot('asset'), totalLiabilities: tot('liability'), totalEquity: tot('equity') }), true;
    }
    return false;
  }

  function prevDay(d) {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - 1);
    return x.toISOString().slice(0, 10);
  }

  return { handle, schema };
};
