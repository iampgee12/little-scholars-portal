// Finance › Income & Expenses — expense requests (request → approve →
// dispense), expenses and income (single, multi and Excel posting, receipts,
// "Save & Post to Ledger"), expense / income heads with sub-heads (items),
// analytics, bank balance report, cash flow statement and the account ledger
// of each school bank / cash account. Also the operating accounts themselves.

module.exports = function createBooks(ctx, F) {
  const { one, all, run, db, cleanText, readJson, sendJson, requireUser } = ctx;
  const { round2, money, posMoney, flag, nowIso, today } = F;

  const METHODS = ['Cash', 'Bank', 'Cheque', 'Card', 'Others', 'Online', 'Transfer'];

  function schema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fin_account_movements (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        amount REAL NOT NULL,
        move_date TEXT NOT NULL,
        pair_id INTEGER,
        note TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ── Date range from the filters every list shares ─────────────────────
  function range(url) {
    const g = k => cleanText(url.searchParams.get(k));
    let from = g('from');
    let to = g('to');
    const session = g('session');
    if (session && session !== 'all') {
      const r = F.sessionRange(session);
      if (r) { from = from && from > r.from ? from : r.from; to = to && to < r.to ? to : r.to; }
    }
    return { from, to };
  }

  // ── Heads (categories) and their sub-heads (items) ─────────────────────
  function heads(type) {
    const rows = all(
      `SELECT fc.id, fc.name, fc.code, fc.coa_account_id AS coaAccountId, a.code AS coaCode, a.name AS coaName, fc.is_system AS isSystem, fc.parent_id AS parentId
       FROM finance_categories fc LEFT JOIN acct_accounts a ON a.id = fc.coa_account_id WHERE fc.type = ? ORDER BY fc.name`, type
    ).map(r => ({ ...r, isSystem: !!r.isSystem }));
    const top = rows.filter(r => !r.parentId);
    return top.map(h => ({ ...h, items: rows.filter(r => r.parentId === h.id) }));
  }
  function ensureHead(type, name) {
    if (!name) return;
    if (!one('SELECT id FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND parent_id IS NULL', type, name)) {
      run('INSERT INTO finance_categories (type, name, created_at, coa_account_id) VALUES (?, ?, ?, ?)', type, name, nowIso(), F.coaId(type === 'expense' ? '5250' : '4200'));
    }
  }
  function ensureItem(type, headName, item) {
    if (!item) return;
    const head = one('SELECT id, coa_account_id AS c FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND parent_id IS NULL', type, headName);
    if (head && !one('SELECT id FROM finance_categories WHERE parent_id = ? AND lower(name) = lower(?)', head.id, item)) {
      run('INSERT INTO finance_categories (type, name, created_at, parent_id, coa_account_id) VALUES (?, ?, ?, ?, ?)', type, item, nowIso(), head.id, head.c);
    }
  }

  // ── Expense / income rows ──────────────────────────────────────────────
  function expenseRows(f) {
    let sql = `SELECT e.id, e.voucher_no AS voucherNo, e.title, e.category, e.item, e.description, e.amount, e.expense_date AS date,
                      e.method, e.paid_to AS paidTo, e.account_id AS accountId, fa.name AS accountName, e.attachment_path AS attachmentPath,
                      e.approved_by AS approvedBy, au.name AS approvedByName, e.recorded_by AS recordedBy, u.name AS recordedByName,
                      e.created_at AS createdAt, e.source, e.source_id AS sourceId, e.request_id AS requestId, e.gl_entry_id AS glEntryId
               FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by LEFT JOIN users au ON au.id = e.approved_by
               LEFT JOIN fin_accounts fa ON fa.id = e.account_id WHERE 1=1`;
    const p = [];
    if (f.from) { sql += ' AND e.expense_date >= ?'; p.push(f.from); }
    if (f.to) { sql += ' AND e.expense_date <= ?'; p.push(f.to); }
    if (f.head) { sql += ' AND e.category = ?'; p.push(f.head); }
    if (f.accountId) { sql += ' AND e.account_id = ?'; p.push(Number(f.accountId)); }
    if (f.method) { sql += ' AND e.method = ?'; p.push(f.method); }
    sql += ' ORDER BY e.expense_date DESC, e.id DESC';
    return all(sql, ...p).map(r => ({ ...r, amount: round2(r.amount), glStatus: r.glEntryId ? 'Posted' : 'Not Posted' }));
  }
  function incomeRows(f) {
    let sql = `SELECT i.id, i.voucher_no AS voucherNo, i.category, i.item, i.description, i.amount, i.income_date AS date,
                      i.method, i.received_from AS receivedFrom, i.account_id AS accountId, fa.name AS accountName,
                      i.attachment_path AS attachmentPath, i.recorded_by AS recordedBy, u.name AS recordedByName, i.created_at AS createdAt,
                      i.source, i.source_id AS sourceId, i.gl_entry_id AS glEntryId
               FROM income_entries i LEFT JOIN users u ON u.id = i.recorded_by LEFT JOIN fin_accounts fa ON fa.id = i.account_id WHERE 1=1`;
    const p = [];
    if (f.from) { sql += ' AND i.income_date >= ?'; p.push(f.from); }
    if (f.to) { sql += ' AND i.income_date <= ?'; p.push(f.to); }
    if (f.head) { sql += ' AND i.category = ?'; p.push(f.head); }
    if (f.accountId) { sql += ' AND i.account_id = ?'; p.push(Number(f.accountId)); }
    if (f.method) { sql += ' AND i.method = ?'; p.push(f.method); }
    sql += ' ORDER BY i.income_date DESC, i.id DESC';
    return all(sql, ...p).map(r => ({ ...r, amount: round2(r.amount), glStatus: r.glEntryId ? 'Posted' : 'Not Posted' }));
  }
  function summaries(rows) {
    const total = round2(rows.reduce((s, r) => s + r.amount, 0));
    const group = keyFn => {
      const map = new Map();
      rows.forEach(r => {
        const k = keyFn(r) || '—';
        const v = map.get(k) || { name: k, amount: 0, count: 0 };
        v.amount = round2(v.amount + r.amount); v.count += 1;
        map.set(k, v);
      });
      return [...map.values()].sort((a, b) => b.amount - a.amount).map(v => ({ ...v, share: total ? round2(v.amount / total * 100) : 0 }));
    };
    const t = today();
    return {
      total, count: rows.length, avg: rows.length ? round2(total / rows.length) : 0,
      today: round2(rows.filter(r => r.date === t).reduce((s, r) => s + r.amount, 0)),
      todayCount: rows.filter(r => r.date === t).length,
      month: round2(rows.filter(r => String(r.date).slice(0, 7) === t.slice(0, 7)).reduce((s, r) => s + r.amount, 0)),
      monthCount: rows.filter(r => String(r.date).slice(0, 7) === t.slice(0, 7)).length,
      byCategory: group(r => r.category), byAccount: group(r => r.accountName), byMonth: group(r => String(r.date).slice(0, 7)).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  // shared body reader for a single income / expense posting
  function readEntry(body, type) {
    const category = cleanText(body.category);
    const amount = posMoney(body.amount);
    const date = cleanText(body.date) || today();
    if (!category) return { error: `Choose the ${type} head / category` };
    if (!amount) return { error: 'Amount must be a positive number' };
    if (type === 'expense' && !cleanText(body.item)) return { error: 'Choose or type the item' };
    if (type === 'expense' && !cleanText(body.description)) return { error: 'Description is required' };
    if (type === 'expense' && !cleanText(body.paidTo)) return { error: 'Paid To is required' };
    if (type === 'expense' && !cleanText(body.method)) return { error: 'Choose the payment method' };
    return {
      category, item: cleanText(body.item) || null, description: cleanText(body.description) || null, amount, date,
      method: cleanText(body.method) || null, paidTo: cleanText(body.paidTo) || null, receivedFrom: cleanText(body.receivedFrom) || null,
      accountId: Number(body.accountId) || null, voucherNo: cleanText(body.voucherNo) || null, approvedBy: cleanText(body.approvedBy) || null,
    };
  }

  // ── Account balances ───────────────────────────────────────────────────
  function movementRows(accountId, from, to) {
    const p = [accountId];
    if (from) p.push(from);
    if (to) p.push(to);
    const range = (col) => `${from ? ` AND ${col} >= ?` : ''}${to ? ` AND ${col} <= ?` : ''}`;
    const inc = all(`SELECT 'income' AS kind, id, income_date AS date, category, description, amount, voucher_no AS ref, source FROM income_entries WHERE account_id = ?${range('income_date')}`, ...p);
    const exp = all(`SELECT 'expense' AS kind, id, expense_date AS date, category, COALESCE(description, title) AS description, amount, voucher_no AS ref, source FROM expenses WHERE account_id = ?${range('expense_date')}`, ...p);
    const mov = all(`SELECT kind, id, move_date AS date, kind AS category, note AS description, amount, NULL AS ref, 'movement' AS source FROM fin_account_movements WHERE account_id = ?${range('move_date')}`, ...p);
    return [...inc, ...exp, ...mov].map(r => {
      const credit = ['income', 'transfer_in', 'adj_credit'].includes(r.kind);
      return { ...r, amount: round2(r.amount), inflow: credit ? round2(r.amount) : 0, outflow: credit ? 0 : round2(r.amount) };
    }).sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  }
  function balanceOf(account, upTo) {
    const before = movementRows(account.id, null, upTo);
    return round2(account.openingBalance + before.reduce((s, r) => s + r.inflow - r.outflow, 0));
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    if (!p.startsWith('/api/admin/finance')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const g = k => cleanText(url.searchParams.get(k));

    if (m === 'GET' && p === '/api/admin/finance/meta') {
      return sendJson(res, 200, {
        accounts: F.finAccounts(), expenseHeads: heads('expense'), incomeHeads: heads('income'), methods: METHODS, sessions: F.sessions(),
        approvers: all("SELECT id, name FROM users WHERE role IN ('admin','teacher','staff') AND COALESCE(active,1) = 1 AND COALESCE(archived,0) = 0 ORDER BY name"),
        voucherNo: F.voucherNo(), autoPosting: F.autoPostingOn(),
      }), true;
    }
    if (m === 'GET' && p === '/api/admin/finance/voucher-no') return sendJson(res, 200, { voucherNo: F.voucherNo() }), true;

    // Operating accounts (bank / cash)
    if (m === 'GET' && p === '/api/admin/finance/accounts') return sendJson(res, 200, { accounts: F.finAccounts() }), true;
    if (m === 'POST' && p === '/api/admin/finance/accounts') {
      const b = await readJson(req);
      const name = cleanText(b.name).toUpperCase();
      if (!name) return sendJson(res, 400, { error: 'Account name is required' }), true;
      const r = run(`INSERT INTO fin_accounts (name, bank_name, account_number, account_name, type, opening_balance, track_balance, coa_account_id, is_default, is_active, show_on_invoice, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        name, cleanText(b.bankName) || null, cleanText(b.accountNumber) || null, cleanText(b.accountName) || null, b.type === 'cash' ? 'cash' : 'bank',
        money(b.openingBalance), b.trackBalance === false ? 0 : 1, Number(b.coaAccountId) || null, b.showOnInvoice === false ? 0 : 1, nowIso());
      if (b.isDefault) { run('UPDATE fin_accounts SET is_default = 0'); run('UPDATE fin_accounts SET is_default = 1 WHERE id = ?', Number(r.lastInsertRowid)); }
      return sendJson(res, 200, { ok: true }), true;
    }
    const accMatch = p.match(/^\/api\/admin\/finance\/accounts\/(\d+)$/);
    if (accMatch) {
      const id = Number(accMatch[1]);
      const acc = F.finAccountById(id);
      if (!acc) return sendJson(res, 404, { error: 'Account not found' }), true;
      if (m === 'PUT') {
        const b = await readJson(req);
        run(`UPDATE fin_accounts SET name = ?, bank_name = ?, account_number = ?, account_name = ?, type = ?, opening_balance = ?, track_balance = ?,
             coa_account_id = ?, is_active = ?, show_on_invoice = ? WHERE id = ?`,
          cleanText(b.name).toUpperCase() || acc.name, cleanText(b.bankName) || null, cleanText(b.accountNumber) || null, cleanText(b.accountName) || null,
          b.type === 'cash' ? 'cash' : 'bank', money(b.openingBalance), b.trackBalance === false ? 0 : 1, Number(b.coaAccountId) || null,
          b.isActive === false ? 0 : 1, b.showOnInvoice === false ? 0 : 1, id);
        if (b.isDefault) { run('UPDATE fin_accounts SET is_default = 0'); run('UPDATE fin_accounts SET is_default = 1 WHERE id = ?', id); }
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        const used = ['income_entries', 'expenses', 'fee_payments', 'fee_invoice_items'].some(t => one(`SELECT 1 FROM ${t} WHERE account_id = ? LIMIT 1`, id));
        if (used || acc.isDefault) return sendJson(res, 400, { error: 'This account has been used (or is the default) — switch it off instead' }), true;
        run('DELETE FROM fin_accounts WHERE id = ?', id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    if (m === 'POST' && p === '/api/admin/finance/transfers') {
      const b = await readJson(req);
      const amount = posMoney(b.amount);
      const from = Number(b.fromAccountId);
      const to = Number(b.toAccountId);
      const date = cleanText(b.date) || today();
      if (!amount || !from || !to || from === to) return sendJson(res, 400, { error: 'Choose two different accounts and a positive amount' }), true;
      F.assertOpenPeriod(date);
      F.tx(() => {
        const a = run(`INSERT INTO fin_account_movements (account_id, kind, amount, move_date, note, created_by, created_at) VALUES (?, 'transfer_out', ?, ?, ?, ?, ?)`, from, amount, date, cleanText(b.note) || 'Transfer', user.id, nowIso());
        const c = run(`INSERT INTO fin_account_movements (account_id, kind, amount, move_date, pair_id, note, created_by, created_at) VALUES (?, 'transfer_in', ?, ?, ?, ?, ?, ?)`, to, amount, date, Number(a.lastInsertRowid), cleanText(b.note) || 'Transfer', user.id, nowIso());
        run('UPDATE fin_account_movements SET pair_id = ? WHERE id = ?', Number(c.lastInsertRowid), Number(a.lastInsertRowid));
        if (F.autoPostingOn()) F.postJournal({ date, memo: cleanText(b.note) || 'Transfer between accounts', type: 'adjustment', source: 'transfer', sourceId: Number(a.lastInsertRowid), userId: user.id,
          lines: [{ accountId: F.cashCoaFor(to), debit: amount }, { accountId: F.cashCoaFor(from), credit: amount }] });
      });
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/finance/adjustments') {
      const b = await readJson(req);
      const amount = posMoney(b.amount);
      const accountId = Number(b.accountId);
      const date = cleanText(b.date) || today();
      if (!amount || !accountId || !['adj_credit', 'adj_debit'].includes(b.kind)) return sendJson(res, 400, { error: 'Choose the account, the direction and a positive amount' }), true;
      F.assertOpenPeriod(date);
      run(`INSERT INTO fin_account_movements (account_id, kind, amount, move_date, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, accountId, b.kind, amount, date, cleanText(b.note) || 'Balance adjustment', user.id, nowIso());
      return sendJson(res, 200, { ok: true }), true;
    }

    // Heads
    if (m === 'GET' && p === '/api/admin/finance/heads') {
      const type = g('type') === 'income' ? 'income' : 'expense';
      return sendJson(res, 200, { heads: heads(type) }), true;
    }
    if (m === 'POST' && p === '/api/admin/finance/heads') {
      const b = await readJson(req);
      const type = b.type === 'income' ? 'income' : 'expense';
      const name = cleanText(b.name);
      if (!name) return sendJson(res, 400, { error: 'Name is required' }), true;
      const parentId = Number(b.parentId) || null;
      if (one('SELECT id FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND COALESCE(parent_id, 0) = ?', type, name, parentId || 0)) {
        return sendJson(res, 409, { error: 'This already exists' }), true;
      }
      const parent = parentId ? one('SELECT coa_account_id AS c FROM finance_categories WHERE id = ?', parentId) : null;
      run('INSERT INTO finance_categories (type, name, created_at, code, coa_account_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
        type, name, nowIso(), cleanText(b.code).toUpperCase() || null, Number(b.coaAccountId) || (parent && parent.c) || F.coaId(type === 'expense' ? '5250' : '4200'), parentId);
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/finance/heads/import') {
      const b = await F.readBigJson(req);
      const type = b.type === 'income' ? 'income' : 'expense';
      const sheet = F.readSheet(b.file);
      const iName = sheet.col('Name', 'Head', 'Category', `${type} head`, 'Expense Head / Category Name', 'Head Name');
      const iCode = sheet.col('Code');
      const iItem = sheet.col('Item', 'Sub Head', 'Sub Head (Item)');
      if (iName === -1) return sendJson(res, 400, { error: 'The file needs a "Name" column' }), true;
      let added = 0;
      sheet.rows.forEach(row => {
        const name = sheet.cell(row, iName);
        if (!name) return;
        if (!one('SELECT id FROM finance_categories WHERE type = ? AND lower(name) = lower(?) AND parent_id IS NULL', type, name)) {
          run('INSERT INTO finance_categories (type, name, created_at, code, coa_account_id) VALUES (?, ?, ?, ?, ?)', type, name, nowIso(), sheet.cell(row, iCode).toUpperCase() || null, F.coaId(type === 'expense' ? '5250' : '4200'));
          added += 1;
        }
        const item = sheet.cell(row, iItem);
        if (item) ensureItem(type, name, item);
      });
      return sendJson(res, 200, { ok: true, added }), true;
    }
    const headMatch = p.match(/^\/api\/admin\/finance\/heads\/(\d+)$/);
    if (headMatch) {
      const id = Number(headMatch[1]);
      const h = one('SELECT * FROM finance_categories WHERE id = ?', id);
      if (!h) return sendJson(res, 404, { error: 'Not found' }), true;
      if (m === 'PUT') {
        const b = await readJson(req);
        const name = cleanText(b.name) || h.name;
        if (h.is_system && name !== h.name) return sendJson(res, 400, { error: 'System heads cannot be renamed' }), true;
        F.tx(() => {
          run('UPDATE finance_categories SET name = ?, code = ?, coa_account_id = ? WHERE id = ?', name, cleanText(b.code).toUpperCase() || null, Number(b.coaAccountId) || h.coa_account_id, id);
          if (!h.parent_id && name !== h.name) {
            run(`UPDATE ${h.type === 'expense' ? 'expenses' : 'income_entries'} SET category = ? WHERE category = ?`, name, h.name);
          }
        });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (h.is_system) return sendJson(res, 400, { error: 'System heads cannot be removed' }), true;
        const table = h.type === 'expense' ? 'expenses' : 'income_entries';
        const used = h.parent_id ? one(`SELECT 1 FROM ${table} WHERE item = ? LIMIT 1`, h.name) : one(`SELECT 1 FROM ${table} WHERE category = ? LIMIT 1`, h.name);
        if (used) return sendJson(res, 400, { error: 'This has been used on records and cannot be removed' }), true;
        run('DELETE FROM finance_categories WHERE id = ? OR parent_id = ?', id, id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }

    // Expense Requests
    if (m === 'GET' && p === '/api/admin/finance/expense-requests') {
      const { from, to } = range(url);
      let sql = `SELECT r.id, r.voucher_no AS voucherNo, r.title, r.category, r.item, r.description, r.amount, r.reason, r.method,
                        COALESCE(r.transaction_date, substr(r.requested_at,1,10)) AS transactionDate, r.requested_at AS requestedAt,
                        COALESCE(r.requested_by_name, u.name) AS requestedByName, r.requested_by AS raisedBy, r.status, r.approved_by AS approvedBy, au.name AS approvedByName,
                        r.approved_at AS approvedAt, r.dispensed_at AS dispensedAt, r.account_id AS accountId, fa.name AS accountName
                 FROM expense_requests r JOIN users u ON u.id = r.requested_by LEFT JOIN users au ON au.id = r.approved_by
                 LEFT JOIN fin_accounts fa ON fa.id = r.account_id WHERE 1=1`;
      const prm = [];
      if (from) { sql += ' AND COALESCE(r.transaction_date, substr(r.requested_at,1,10)) >= ?'; prm.push(from); }
      if (to) { sql += ' AND COALESCE(r.transaction_date, substr(r.requested_at,1,10)) <= ?'; prm.push(to); }
      if (g('head')) { sql += ' AND r.category = ?'; prm.push(g('head')); }
      if (g('method')) { sql += ' AND r.method = ?'; prm.push(g('method')); }
      const status = g('status') || 'active';
      if (status === 'active') sql += " AND r.status IN ('pending','approved')";
      else if (status !== 'all') { sql += ' AND r.status = ?'; prm.push(status); }
      const rows = all(`${sql} ORDER BY r.requested_at DESC`, ...prm).map(r => ({ ...r, amount: round2(r.amount) }));
      const everything = all('SELECT status, amount FROM expense_requests');
      const sum = st => round2(everything.filter(r => !st || r.status === st).reduce((s, r) => s + r.amount, 0));
      const cnt = st => everything.filter(r => !st || r.status === st).length;
      return sendJson(res, 200, {
        requests: rows,
        stats: { total: sum(), totalCount: cnt(), pending: sum('pending'), pendingCount: cnt('pending'), approved: sum('approved'), approvedCount: cnt('approved'), dispensed: sum('dispensed'), dispensedCount: cnt('dispensed') },
      }), true;
    }
    if (m === 'POST' && p === '/api/admin/finance/expense-requests') {
      const b = await readJson(req);
      const category = cleanText(b.category);
      const item = cleanText(b.item);
      const amount = posMoney(b.amount);
      if (!category) return sendJson(res, 400, { error: 'Choose the expense head / category' }), true;
      if (!item) return sendJson(res, 400, { error: 'Choose or type the item' }), true;
      if (!cleanText(b.description)) return sendJson(res, 400, { error: 'Description is required' }), true;
      if (!amount) return sendJson(res, 400, { error: 'Amount must be a positive number' }), true;
      if (!cleanText(b.method)) return sendJson(res, 400, { error: 'Choose the method' }), true;
      if (!cleanText(b.requestedBy)) return sendJson(res, 400, { error: 'Requested By is required' }), true;
      ensureItem('expense', category, item);
      run(`INSERT INTO expense_requests (title, category, amount, reason, requested_by, status, requested_at, voucher_no, item, description, method, transaction_date, requested_by_name)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        item, category, amount, cleanText(b.description), user.id, nowIso(), cleanText(b.voucherNo) || F.voucherNo(), item, cleanText(b.description),
        cleanText(b.method), cleanText(b.transactionDate) || today(), cleanText(b.requestedBy));
      return sendJson(res, 200, { ok: true }), true;
    }
    function dispense(request, accountId) {
      if (request.status !== 'approved') throw Object.assign(new Error('Only approved requests can be dispensed'), { status: 400 });
      const date = today();
      const expenseId = F.addExpense({
        category: request.category || 'General', item: request.item, title: request.title, description: request.description || request.reason || request.title,
        amount: request.amount, date, userId: user.id, source: 'request', sourceId: request.id, requestId: request.id, accountId,
        method: request.method, paidTo: request.requested_by_name, voucherNo: request.voucher_no, approvedBy: request.approved_by,
      });
      run("UPDATE expense_requests SET status = 'dispensed', dispensed_at = ?, account_id = ?, expense_id = ? WHERE id = ?", nowIso(), accountId || F.defaultFinAccountId(), expenseId, request.id);
    }
    const reqMatch = p.match(/^\/api\/admin\/finance\/expense-requests\/(\d+)(\/decision)?$/);
    if (reqMatch) {
      const request = one('SELECT * FROM expense_requests WHERE id = ?', Number(reqMatch[1]));
      if (!request) return sendJson(res, 404, { error: 'Expense request not found' }), true;
      if (m === 'POST' && reqMatch[2]) {
        const b = await readJson(req);
        const action = cleanText(b.action);
        if (action === 'approve' || action === 'reject') {
          if (request.status !== 'pending') return sendJson(res, 400, { error: 'Only pending requests can be approved or declined' }), true;
          // whoever raised a request can't approve it: a second person must
          if (action === 'approve' && request.requested_by === user.id) return sendJson(res, 403, { error: 'You raised this request, so someone else must approve it' }), true;
          run('UPDATE expense_requests SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?', action === 'approve' ? 'approved' : 'rejected', user.id, nowIso(), request.id);
        } else if (action === 'dispense') {
          F.tx(() => dispense(request, Number(b.accountId) || null));
        } else return sendJson(res, 400, { error: 'Action must be approve, reject or dispense' }), true;
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE' && !reqMatch[2]) {
        if (request.status !== 'pending') return sendJson(res, 400, { error: 'Only pending requests can be deleted' }), true;
        run('DELETE FROM expense_requests WHERE id = ?', request.id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    if (m === 'POST' && p === '/api/admin/finance/expense-requests/dispense') {
      const b = await readJson(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      const list = ids.map(id => one('SELECT * FROM expense_requests WHERE id = ?', id)).filter(r => r && r.status === 'approved');
      if (!list.length) return sendJson(res, 400, { error: 'Select approved requests to mark dispensed' }), true;
      F.tx(() => list.forEach(r => dispense(r, Number(b.accountId) || null)));
      return sendJson(res, 200, { ok: true, count: list.length }), true;
    }

    // Expenses & Income (same shape)
    const kindMatch = p.match(/^\/api\/admin\/finance\/(expenses|income)(?:\/(multi|import|\d+)(?:\/(post))?)?$/);
    if (kindMatch) {
      const isExp = kindMatch[1] === 'expenses';
      const type = isExp ? 'expense' : 'income';
      const sub = kindMatch[2];
      if (m === 'GET' && !sub) {
        const { from, to } = range(url);
        const rows = (isExp ? expenseRows : incomeRows)({ from, to, head: g('head'), accountId: g('accountId'), method: g('method') });
        return sendJson(res, 200, { rows, summary: summaries(rows) }), true;
      }
      const save = (v, b, attachment) => {
        ensureHead(type, v.category);
        if (v.item) ensureItem(type, v.category, v.item);
        const common = { category: v.category, item: v.item, description: v.description, amount: v.amount, date: v.date, userId: user.id, accountId: v.accountId, method: v.method, voucherNo: v.voucherNo, attachment };
        const id = isExp ? F.addExpense({ ...common, title: v.item, paidTo: v.paidTo, approvedBy: v.approvedBy }) : F.addIncome({ ...common, receivedFrom: v.receivedFrom });
        if (b.postToLedger) (isExp ? F.glPostExpense : F.glPostIncome)(id, user.id, true);
        return id;
      };
      if (m === 'POST' && !sub) {
        const b = await F.readBigJson(req);
        const v = readEntry(b, type);
        if (v.error) return sendJson(res, 400, { error: v.error }), true;
        let attachment = null;
        try { attachment = F.saveDocument(b.attachment, type); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
        const id = F.tx(() => save(v, b, attachment));
        return sendJson(res, 200, { ok: true, id }), true;
      }
      if (m === 'POST' && sub === 'multi') {
        const b = await readJson(req);
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const parsed = rows.map(r => readEntry({ ...b, ...r }, type));
        const bad = parsed.findIndex(v => v.error);
        if (!rows.length) return sendJson(res, 400, { error: 'Add at least one line' }), true;
        if (bad !== -1) return sendJson(res, 400, { error: `Line ${bad + 1}: ${parsed[bad].error}` }), true;
        F.tx(() => parsed.forEach(v => save(v, b, null)));
        return sendJson(res, 200, { ok: true, count: parsed.length }), true;
      }
      if (m === 'POST' && sub === 'import') {
        const b = await F.readBigJson(req);
        const sheet = F.readSheet(b.file);
        const c = {
          date: sheet.col('Transaction Date', 'Date'), head: sheet.col(`${isExp ? 'Expense' : 'Income'} Head`, 'Head', 'Category', 'Head / Category'),
          item: sheet.col('Item', 'Sub Head'), desc: sheet.col('Description', 'Details'), amount: sheet.col('Amount'),
          method: sheet.col('Method', 'Payment Method'), party: sheet.col(isExp ? 'Paid To' : 'Received From', 'Payee', 'Payer'), voucher: sheet.col('Voucher ID', 'Voucher', 'Reference'),
        };
        if (c.head === -1 || c.amount === -1) return sendJson(res, 400, { error: 'The file needs at least "Head" and "Amount" columns' }), true;
        const errors = [];
        const entries = [];
        sheet.rows.forEach((row, i) => {
          const v = readEntry({
            category: sheet.cell(row, c.head), item: sheet.cell(row, c.item) || sheet.cell(row, c.desc), description: sheet.cell(row, c.desc) || sheet.cell(row, c.item),
            amount: sheet.cell(row, c.amount).replace(/[₦,\s]/g, ''), date: sheet.date(row, c.date) || today(), method: sheet.cell(row, c.method) || 'Cash',
            paidTo: sheet.cell(row, c.party) || '—', receivedFrom: sheet.cell(row, c.party), voucherNo: sheet.cell(row, c.voucher), accountId: b.accountId,
          }, type);
          if (v.error) errors.push(`Row ${i + 2}: ${v.error}`); else entries.push(v);
        });
        if (errors.length) return sendJson(res, 400, { error: errors.slice(0, 5).join(' · ') }), true;
        F.tx(() => entries.forEach(v => save(v, {}, null)));
        return sendJson(res, 200, { ok: true, count: entries.length }), true;
      }
      if (sub && /^\d+$/.test(sub)) {
        const table = isExp ? 'expenses' : 'income_entries';
        const row = one(`SELECT * FROM ${table} WHERE id = ?`, Number(sub));
        if (!row) return sendJson(res, 404, { error: 'Record not found' }), true;
        if (m === 'POST' && kindMatch[3] === 'post') {
          const id = (isExp ? F.glPostExpense : F.glPostIncome)(row.id, user.id, true);
          return sendJson(res, id ? 200 : 400, id ? { ok: true } : { error: 'Already posted, or no ledger account is mapped' }), true;
        }
        if (row.source !== 'manual') return sendJson(res, 400, { error: `This was made by the system (${row.source.replace('_', ' ')}) — change it where it came from` }), true;
        if (m === 'DELETE') {
          F.assertOpenPeriod(isExp ? row.expense_date : row.income_date);
          F.tx(() => { F.glUnpost(table, row.id, user.id); run(`DELETE FROM ${table} WHERE id = ?`, row.id); });
          return sendJson(res, 200, { ok: true }), true;
        }
        if (m === 'PUT') {
          const b = await readJson(req);
          const v = readEntry(b, type);
          if (v.error) return sendJson(res, 400, { error: v.error }), true;
          F.assertOpenPeriod(v.date);
          F.tx(() => {
            F.glUnpost(table, row.id, user.id);
            if (isExp) run('UPDATE expenses SET category = ?, item = ?, title = ?, description = ?, amount = ?, expense_date = ?, method = ?, paid_to = ?, account_id = ?, voucher_no = ?, approved_by = ? WHERE id = ?',
              v.category, v.item, v.item, v.description, v.amount, v.date, v.method, v.paidTo, v.accountId || F.defaultFinAccountId(), v.voucherNo, v.approvedBy, row.id);
            else run('UPDATE income_entries SET category = ?, item = ?, description = ?, amount = ?, income_date = ?, method = ?, received_from = ?, account_id = ?, voucher_no = ? WHERE id = ?',
              v.category, v.item, v.description, v.amount, v.date, v.method, v.receivedFrom, v.accountId || F.defaultFinAccountId(), v.voucherNo, row.id);
            if (row.gl_entry_id) (isExp ? F.glPostExpense : F.glPostIncome)(row.id, user.id, true);
          });
          return sendJson(res, 200, { ok: true }), true;
        }
      }
    }

    // Income & Expense Analytics
    if (m === 'GET' && p === '/api/admin/finance/analytics') {
      const f = { from: g('from'), to: g('to'), accountId: g('accountId') };
      const inc = incomeRows(f);
      const exp = expenseRows(f);
      const si = summaries(inc);
      const se = summaries(exp);
      const months = [...new Set([...si.byMonth, ...se.byMonth].map(x => x.name))].sort();
      const byAccount = F.finAccounts().map(a => ({
        name: a.name, income: round2(inc.filter(r => r.accountId === a.id).reduce((s, r) => s + r.amount, 0)),
        expenses: round2(exp.filter(r => r.accountId === a.id).reduce((s, r) => s + r.amount, 0)),
        incomeCount: inc.filter(r => r.accountId === a.id).length, expenseCount: exp.filter(r => r.accountId === a.id).length,
      })).filter(a => a.income || a.expenses);
      const t = today();
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const sumWhere = (rows, fn) => round2(rows.filter(fn).reduce((s, r) => s + r.amount, 0));
      return sendJson(res, 200, {
        today: { income: sumWhere(inc, r => r.date === t), expenses: sumWhere(exp, r => r.date === t) },
        last30Days: { income: sumWhere(inc, r => r.date >= since30), expenses: sumWhere(exp, r => r.date >= since30) },
        totalIncome: si.total, totalExpenses: se.total, net: round2(si.total - se.total), incomeCount: si.count, expenseCount: se.count,
        incomeByCategory: si.byCategory, expensesByCategory: se.byCategory, byAccount,
        monthlyTrend: months.map(mo => {
          const i = (si.byMonth.find(x => x.name === mo) || {}).amount || 0;
          const e = (se.byMonth.find(x => x.name === mo) || {}).amount || 0;
          return { month: mo, income: i, expenses: e, net: round2(i - e) };
        }),
      }), true;
    }

    // Bank Balance Report
    if (m === 'GET' && p === '/api/admin/finance/bank-balance') {
      const r = range(url);
      const accounts = F.finAccounts().filter(a => a.trackBalance && (!g('accountId') || a.id === Number(g('accountId'))));
      const rows = accounts.map(a => {
        const opening = r.from ? balanceOf(a, prevDay(r.from)) : a.openingBalance;
        const mv = movementRows(a.id, r.from, r.to);
        const totalIncome = round2(mv.reduce((s, x) => s + x.inflow, 0));
        const totalExpense = round2(mv.reduce((s, x) => s + x.outflow, 0));
        return { ...a, opening, totalIncome, totalExpense, current: round2(opening + totalIncome - totalExpense) };
      });
      const sumOf = list => round2(list.reduce((s, x) => s + x.current, 0));
      return sendJson(res, 200, { accounts: rows, totals: { all: sumOf(rows), bank: sumOf(rows.filter(x => x.type === 'bank')), cash: sumOf(rows.filter(x => x.type === 'cash')) } }), true;
    }
    // Cash Flow Statement
    if (m === 'GET' && p === '/api/admin/finance/cash-flow') {
      const from = g('from') || `${today().slice(0, 7)}-01`;
      const to = g('to') || today();
      const ids = g('accountId') ? [Number(g('accountId'))] : F.finAccounts().map(a => a.id);
      const mv = ids.flatMap(id => movementRows(id, from, to));
      const sumKind = k => round2(mv.filter(x => x.kind === k).reduce((s, x) => s + x.amount, 0));
      const inflows = { income: sumKind('income'), transferIn: sumKind('transfer_in'), adjCredit: sumKind('adj_credit') };
      const outflows = { expenses: sumKind('expense'), transferOut: sumKind('transfer_out'), adjDebit: sumKind('adj_debit') };
      const totalIn = round2(inflows.income + inflows.transferIn + inflows.adjCredit);
      const totalOut = round2(outflows.expenses + outflows.transferOut + outflows.adjDebit);
      return sendJson(res, 200, { from, to, inflows, outflows, totalIn, totalOut, net: round2(totalIn - totalOut) }), true;
    }
    // Account Ledger (a bank / cash account's statement)
    if (m === 'GET' && p === '/api/admin/finance/account-ledger') {
      const acc = F.finAccountById(g('accountId'));
      if (!acc) return sendJson(res, 400, { error: 'Select an account' }), true;
      const r = range(url);
      const opening = r.from ? balanceOf(acc, prevDay(r.from)) : acc.openingBalance;
      let bal = opening;
      const rows = movementRows(acc.id, r.from, r.to).map(x => { bal = round2(bal + x.inflow - x.outflow); return { ...x, balance: bal }; });
      return sendJson(res, 200, { account: acc, opening, rows, closing: bal, totalIn: round2(rows.reduce((s, x) => s + x.inflow, 0)), totalOut: round2(rows.reduce((s, x) => s + x.outflow, 0)) }), true;
    }
    return false;
  }

  function prevDay(d) {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - 1);
    return x.toISOString().slice(0, 10);
  }

  return { handle, schema, movementRows };
};
