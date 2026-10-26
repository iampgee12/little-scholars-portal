// Finance › Store & Inventory — products, categories, the POS terminal with
// shifts, orders & sales (statuses, fulfilment, bulk actions; every completed
// sale becomes income), stock movements / valuation / low stock, purchase
// orders and goods received notes (posting a GRN adds stock and raises the
// vendor bill), internal requisitions, store settings, banners, homepage
// sections, the storefront preview and the inventory reports.

module.exports = function createStore(ctx, F) {
  const { one, all, run, cleanText, readJson, sendJson, requireUser, valueFromMeta, setMeta, saveDataUrl } = ctx;
  const { round2, money, posMoney, nowIso, today } = F;

  const ORDER_STATUSES = ['pending_payment', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'return_requested', 'completed', 'cancelled'];
  const PAYMENT_STATUSES = ['paid', 'unpaid', 'refunded', 'partially_refunded'];
  const FULFILMENT = ['pending', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'picked_up', 'return_requested', 'returned', 'cancelled'];

  // ── Products ───────────────────────────────────────────────────────────
  function productRow(p) {
    const price = round2(p.price);
    const salePrice = p.discount_pct > 0 ? round2(price * (1 - p.discount_pct / 100)) : price;
    return {
      id: p.id, name: p.name, sku: p.sku, categoryId: p.category_id, categoryName: p.categoryName || null, price, salePrice, cost: round2(p.cost),
      unit: p.unit, stockQty: p.stock_qty, reorderLevel: p.reorder_level, isActive: !!p.is_active, lowStock: p.product_type !== 'digital' && p.stock_qty <= p.reorder_level,
      status: p.status || (p.is_active ? 'published' : 'draft'), visibility: p.visibility || 'public', productType: p.product_type || 'physical',
      imagePath: p.image_path, discountPct: p.discount_pct || 0, description: p.description, createdAt: p.created_at, updatedAt: p.updated_at || p.created_at,
      stockValue: round2(p.stock_qty * p.cost),
    };
  }
  function products() {
    return all('SELECT p.*, c.name AS categoryName FROM store_products p LEFT JOIN store_categories c ON c.id = p.category_id ORDER BY p.name').map(productRow);
  }
  function productById(id) {
    const p = one('SELECT p.*, c.name AS categoryName FROM store_products p LEFT JOIN store_categories c ON c.id = p.category_id WHERE p.id = ?', Number(id));
    return p ? productRow(p) : null;
  }
  function moveStock(productId, delta, { type, reason, reference, unitCost, userId }) {
    const p = one('SELECT stock_qty AS q, product_type AS t FROM store_products WHERE id = ?', productId);
    if (!p) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (p.t === 'digital') return;
    const after = p.q + delta;
    if (after < 0) throw Object.assign(new Error('Not enough stock'), { status: 400 });
    run('UPDATE store_products SET stock_qty = ?, updated_at = ? WHERE id = ?', after, nowIso(), productId);
    run(`INSERT INTO store_stock_movements (product_id, change_qty, reason, created_by, created_at, movement_type, reference, unit_cost, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      productId, delta, reason || null, userId || null, nowIso(), type, reference || null, unitCost == null ? null : money(unitCost), after);
  }
  function readProduct(b) {
    const name = cleanText(b.name);
    if (!name) return { error: 'Product name is required' };
    const status = ['draft', 'published', 'archived'].includes(b.status) ? b.status : 'published';
    return {
      name, sku: cleanText(b.sku) || null, categoryId: Number(b.categoryId) || null, price: money(b.price), cost: money(b.cost), unit: cleanText(b.unit) || 'piece',
      reorderLevel: Math.max(0, Number(b.reorderLevel) || 0), status, isActive: status === 'published' ? 1 : 0,
      visibility: ['public', 'logged_in', 'private'].includes(b.visibility) ? b.visibility : 'public',
      productType: b.productType === 'digital' ? 'digital' : 'physical', description: cleanText(b.description) || null,
      discountPct: Math.min(100, Math.max(0, Number(b.discountPct) || 0)),
    };
  }

  // ── Orders ─────────────────────────────────────────────────────────────
  function orderRow(o) {
    return {
      id: o.id, orderNo: o.order_no, channel: o.channel, customerName: o.customer_name, status: o.status, subtotal: round2(o.subtotal), discount: round2(o.discount),
      total: round2(o.total), paymentMethod: o.payment_method, paymentStatus: o.payment_status, fulfilmentStatus: o.fulfilment_status, fulfilmentType: o.fulfilment_type,
      shiftId: o.shift_id, paymentNote: o.payment_note, createdBy: o.created_by, createdByName: o.createdByName, createdAt: o.created_at, updatedAt: o.updated_at || o.created_at,
      itemCount: o.itemCount,
    };
  }
  function orders(f = {}) {
    let sql = `SELECT o.*, u.name AS createdByName, (SELECT COALESCE(SUM(qty),0) FROM store_order_items i WHERE i.order_id = o.id) AS itemCount
               FROM store_orders o LEFT JOIN users u ON u.id = o.created_by WHERE 1=1`;
    const p = [];
    const eq = (col, v) => { if (v && v !== 'all') { sql += ` AND ${col} = ?`; p.push(v); } };
    if (f.status === 'open') sql += " AND o.status NOT IN ('completed','cancelled')";
    else eq('o.status', f.status);
    if (f.payment === 'exclude_refunded') sql += " AND o.payment_status NOT IN ('refunded','partially_refunded')";
    else eq('o.payment_status', f.payment);
    eq('o.fulfilment_status', f.fulfilment);
    eq('o.fulfilment_type', f.fulfilmentType);
    eq('o.channel', f.channel);
    eq('o.shift_id', f.shiftId);
    if (f.from) { sql += ' AND date(o.created_at) >= date(?)'; p.push(f.from); }
    if (f.to) { sql += ' AND date(o.created_at) <= date(?)'; p.push(f.to); }
    let rows = all(`${sql} ORDER BY o.created_at DESC`, ...p).map(orderRow);
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter(o => [o.orderNo, o.customerName].some(v => String(v || '').toLowerCase().includes(q))); }
    return rows;
  }
  function orderItems(id) {
    return all('SELECT id, product_id AS productId, product_name AS productName, unit_price AS unitPrice, qty, line_total AS lineTotal FROM store_order_items WHERE order_id = ?', id);
  }
  function syncOrderIncome(orderId, userId) {
    const o = one('SELECT * FROM store_orders WHERE id = ?', orderId);
    const counts = o && o.payment_status === 'paid' && o.status !== 'cancelled' && o.total > 0;
    const existing = one("SELECT id FROM income_entries WHERE source = 'store_sale' AND source_id = ?", orderId);
    if (!counts && existing) F.removeLinked('income_entries', 'store_sale', orderId, userId);
    if (counts && !existing) {
      F.addIncome({ category: o.channel === 'online' ? 'Storefront Sales' : 'POS Sales', description: `${o.channel === 'online' ? 'Storefront' : 'POS'} sale ${o.order_no}`, amount: o.total,
        date: String(o.created_at).slice(0, 10), userId, source: 'store_sale', sourceId: o.id, method: o.payment_method, receivedFrom: o.customer_name });
    }
  }
  function openShift() {
    return one("SELECT id, opened_by AS openedBy, opened_at AS openedAt, opening_cash AS openingCash FROM pos_shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  }
  function shiftRow(s) {
    const sales = all("SELECT payment_method AS m, total FROM store_orders WHERE shift_id = ? AND status <> 'cancelled' AND payment_status = 'paid'", s.id);
    const cashSales = round2(sales.filter(x => /cash/i.test(x.m || '')).reduce((a, x) => a + x.total, 0));
    return {
      id: s.id, openedBy: s.openedByName, openedAt: s.opened_at, openingCash: round2(s.opening_cash), closedAt: s.closed_at, closedBy: s.closedByName,
      closingCash: s.closing_cash == null ? null : round2(s.closing_cash), status: s.status, notes: s.notes, sales: sales.length,
      totalSales: round2(sales.reduce((a, x) => a + x.total, 0)), cashSales, expectedCash: round2(s.opening_cash + cashSales),
      variance: s.closing_cash == null ? null : round2(s.closing_cash - (s.opening_cash + cashSales)),
    };
  }
  function shifts() {
    return all('SELECT s.*, ou.name AS openedByName, cu.name AS closedByName FROM pos_shifts s LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by ORDER BY s.id DESC').map(shiftRow);
  }

  // ── Purchasing ─────────────────────────────────────────────────────────
  function poRow(po) {
    const items = all(`SELECT i.id, i.product_id AS productId, p.name AS productName, i.description, i.qty, i.unit_cost AS unitCost,
                              (SELECT COALESCE(SUM(gi.qty),0) FROM store_grn_items gi JOIN store_grns g ON g.id = gi.grn_id WHERE g.po_id = i.po_id AND g.status = 'posted' AND gi.product_id = i.product_id) AS received
                       FROM store_po_items i LEFT JOIN store_products p ON p.id = i.product_id WHERE i.po_id = ?`, po.id);
    return { id: po.id, poCode: po.po_code, contactId: po.contact_id, vendor: po.vendor, orderDate: po.order_date, expectedDate: po.expected_date, status: po.status, notes: po.notes,
      items, total: round2(items.reduce((s, i) => s + i.qty * i.unitCost, 0)) };
  }
  function grnRow(g) {
    const items = all('SELECT gi.id, gi.product_id AS productId, p.name AS productName, gi.qty, gi.unit_cost AS unitCost FROM store_grn_items gi JOIN store_products p ON p.id = gi.product_id WHERE gi.grn_id = ?', g.id);
    return { id: g.id, grnCode: g.grn_code, poId: g.po_id, poCode: g.po_code, contactId: g.contact_id, vendor: g.vendor, receiptDate: g.receipt_date, status: g.status, postedAt: g.posted_at, notes: g.notes,
      items, total: round2(items.reduce((s, i) => s + i.qty * i.unitCost, 0)) };
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    if (!p.startsWith('/api/admin/store')) return false;
    const user = requireUser(req, res, 'admin');
    if (!user) return true;
    const g = k => cleanText(url.searchParams.get(k));

    // Categories
    if (m === 'GET' && p === '/api/admin/store/categories') {
      let rows = all(`SELECT c.id, c.name, c.description, c.status, c.visibility, c.sort_order AS sortOrder,
                             (SELECT COUNT(*) FROM store_products p WHERE p.category_id = c.id) AS productCount
                      FROM store_categories c ORDER BY c.sort_order, c.name`);
      const st = g('status') || 'active';
      if (st === 'active') rows = rows.filter(r => r.status !== 'archived');
      else if (st !== 'all') rows = rows.filter(r => r.status === st);
      if (g('visibility')) rows = rows.filter(r => r.visibility === g('visibility'));
      return sendJson(res, 200, { categories: rows }), true;
    }
    if ((m === 'POST' && p === '/api/admin/store/categories') || (m === 'PUT' && /^\/api\/admin\/store\/categories\/\d+$/.test(p))) {
      const b = await readJson(req);
      const name = cleanText(b.name);
      if (!name) return sendJson(res, 400, { error: 'Category name is required' }), true;
      const vals = [name, cleanText(b.description) || null, ['draft', 'published', 'archived'].includes(b.status) ? b.status : 'published', ['public', 'logged_in', 'private'].includes(b.visibility) ? b.visibility : 'public'];
      try {
        if (m === 'POST') run('INSERT INTO store_categories (name, description, status, visibility, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM store_categories))', ...vals);
        else run('UPDATE store_categories SET name = ?, description = ?, status = ?, visibility = ? WHERE id = ?', ...vals, Number(p.split('/').pop()));
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A category with that name already exists' }), true;
        throw err;
      }
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/categories/reorder') {
      const b = await readJson(req);
      (Array.isArray(b.ids) ? b.ids : []).forEach((id, i) => run('UPDATE store_categories SET sort_order = ? WHERE id = ?', i + 1, Number(id)));
      return sendJson(res, 200, { ok: true }), true;
    }
    const catDel = p.match(/^\/api\/admin\/store\/categories\/(\d+)$/);
    if (m === 'DELETE' && catDel) { run('DELETE FROM store_categories WHERE id = ?', Number(catDel[1])); return sendJson(res, 200, { ok: true }), true; }

    // Products
    if (m === 'GET' && p === '/api/admin/store/products') {
      let rows = products();
      const st = g('status') || 'active';
      if (st === 'active') rows = rows.filter(r => r.status !== 'archived');
      else if (st !== 'all') rows = rows.filter(r => r.status === st);
      if (g('visibility')) rows = rows.filter(r => r.visibility === g('visibility'));
      if (g('type')) rows = rows.filter(r => r.productType === g('type'));
      if (g('categoryId')) rows = rows.filter(r => String(r.categoryId) === g('categoryId'));
      if (g('search')) { const q = g('search').toLowerCase(); rows = rows.filter(r => [r.name, r.sku].some(v => String(v || '').toLowerCase().includes(q))); }
      return sendJson(res, 200, { products: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/products') {
      const b = await F.readBigJson(req);
      const v = readProduct(b);
      if (v.error) return sendJson(res, 400, { error: v.error }), true;
      let image = null;
      try { image = b.image ? saveDataUrl(b.image, 'product') : null; } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
      try {
        const id = F.tx(() => {
          const r = run(`INSERT INTO store_products (name, sku, category_id, price, cost, unit, stock_qty, reorder_level, is_active, created_at, status, visibility, product_type, image_path, discount_pct, description, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            v.name, v.sku, v.categoryId, v.price, v.cost, v.unit, v.reorderLevel, v.isActive, nowIso(), v.status, v.visibility, v.productType, image, v.discountPct, v.description, nowIso());
          const pid = Number(r.lastInsertRowid);
          const opening = Math.max(0, Number(b.stockQty) || 0);
          if (opening) moveStock(pid, opening, { type: 'opening_balance', reason: 'Opening balance', unitCost: v.cost, userId: user.id });
          return pid;
        });
        return sendJson(res, 200, { ok: true, product: productById(id) }), true;
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A product with that SKU already exists' }), true;
        throw err;
      }
    }
    if (m === 'POST' && p === '/api/admin/store/products/import') {
      const b = await F.readBigJson(req);
      const sheet = F.readSheet(b.file);
      const c = { name: sheet.col('Title', 'Name', 'Product'), sku: sheet.col('SKU'), cat: sheet.col('Category'), price: sheet.col('Price', 'Selling Price'),
        cost: sheet.col('Cost', 'Cost Price'), qty: sheet.col('Stock', 'Quantity', 'Opening Stock', 'Qty'), reorder: sheet.col('Reorder Level', 'Low Stock Level'), unit: sheet.col('Unit', 'UoM') };
      if (c.name === -1 || c.price === -1) return sendJson(res, 400, { error: 'The file needs at least "Title" and "Price" columns' }), true;
      let added = 0;
      F.tx(() => sheet.rows.forEach(row => {
        const name = sheet.cell(row, c.name);
        if (!name) return;
        const sku = sheet.cell(row, c.sku) || null;
        if (sku && one('SELECT id FROM store_products WHERE sku = ?', sku)) return;
        let catId = null;
        const cat = sheet.cell(row, c.cat);
        if (cat) {
          const ex = one('SELECT id FROM store_categories WHERE lower(name) = lower(?)', cat);
          catId = ex ? ex.id : Number(run("INSERT INTO store_categories (name, status, visibility) VALUES (?, 'published', 'public')", cat).lastInsertRowid);
        }
        const num = i => money(sheet.cell(row, i).replace(/[₦,\s]/g, ''));
        const r = run(`INSERT INTO store_products (name, sku, category_id, price, cost, unit, stock_qty, reorder_level, is_active, created_at, status, visibility, product_type, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 'published', 'public', 'physical', ?)`,
          name, sku, catId, num(c.price), num(c.cost), sheet.cell(row, c.unit) || 'piece', Math.max(0, Number(sheet.cell(row, c.reorder)) || 0), nowIso(), nowIso());
        const qty = Math.max(0, Math.round(Number(sheet.cell(row, c.qty)) || 0));
        if (qty) moveStock(Number(r.lastInsertRowid), qty, { type: 'opening_balance', reason: 'Opening balance (import)', unitCost: num(c.cost), userId: user.id });
        added += 1;
      }));
      return sendJson(res, 200, { ok: true, added }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/products/bulk') {
      const b = await readJson(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      if (!ids.length) return sendJson(res, 400, { error: 'Select at least one product' }), true;
      ids.forEach(id => {
        if (b.action === 'update') {
          if (['draft', 'published', 'archived'].includes(b.status)) run('UPDATE store_products SET status = ?, is_active = ?, updated_at = ? WHERE id = ?', b.status, b.status === 'published' ? 1 : 0, nowIso(), id);
          if (['public', 'logged_in', 'private'].includes(b.visibility)) run('UPDATE store_products SET visibility = ?, updated_at = ? WHERE id = ?', b.visibility, nowIso(), id);
        }
        if (b.action === 'discount') run('UPDATE store_products SET discount_pct = ?, updated_at = ? WHERE id = ?', Math.min(100, Math.max(0, Number(b.pct) || 0)), nowIso(), id);
        if (b.action === 'remove_discount') run('UPDATE store_products SET discount_pct = 0, updated_at = ? WHERE id = ?', nowIso(), id);
      });
      return sendJson(res, 200, { ok: true, count: ids.length }), true;
    }
    const prodMatch = p.match(/^\/api\/admin\/store\/products\/(\d+)$/);
    if (prodMatch) {
      const id = Number(prodMatch[1]);
      const cur = productById(id);
      if (!cur) return sendJson(res, 404, { error: 'Product not found' }), true;
      if (m === 'PUT') {
        const b = await F.readBigJson(req);
        const v = readProduct(b);
        if (v.error) return sendJson(res, 400, { error: v.error }), true;
        let image = cur.imagePath;
        try { if (b.image) image = saveDataUrl(b.image, 'product'); else if (b.removeImage) image = null; } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
        try {
          run(`UPDATE store_products SET name = ?, sku = ?, category_id = ?, price = ?, cost = ?, unit = ?, reorder_level = ?, is_active = ?, status = ?, visibility = ?, product_type = ?,
               image_path = ?, discount_pct = ?, description = ?, updated_at = ? WHERE id = ?`,
            v.name, v.sku, v.categoryId, v.price, v.cost, v.unit, v.reorderLevel, v.isActive, v.status, v.visibility, v.productType, image, v.discountPct, v.description, nowIso(), id);
        } catch (err) {
          if (String(err.message).includes('UNIQUE')) return sendJson(res, 409, { error: 'A product with that SKU already exists' }), true;
          throw err;
        }
        return sendJson(res, 200, { ok: true, product: productById(id) }), true;
      }
      if (m === 'DELETE') {
        if (one('SELECT 1 FROM store_order_items WHERE product_id = ? LIMIT 1', id)) {
          run("UPDATE store_products SET status = 'archived', is_active = 0, updated_at = ? WHERE id = ?", nowIso(), id);
          return sendJson(res, 200, { ok: true, archived: true }), true;
        }
        run('DELETE FROM store_products WHERE id = ?', id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    const adjMatch = p.match(/^\/api\/admin\/store\/products\/(\d+)\/stock-adjust$/);
    if (m === 'POST' && adjMatch) {
      const b = await readJson(req);
      const delta = Math.round(Number(b.delta));
      if (!Number.isFinite(delta) || delta === 0) return sendJson(res, 400, { error: 'A non-zero adjustment quantity is required' }), true;
      const product = productById(adjMatch[1]);
      if (!product) return sendJson(res, 404, { error: 'Product not found' }), true;
      F.tx(() => {
        moveStock(product.id, delta, { type: 'adjustment', reason: cleanText(b.reason) || 'Manual adjustment', reference: cleanText(b.reference), unitCost: product.cost, userId: user.id });
        if (delta < 0 && /write|damag|expir|loss/i.test(cleanText(b.reason)) && F.autoPostingOn() && product.cost > 0) {
          F.postJournal({ date: today(), memo: `Inventory write-off — ${product.name}`, type: 'adjustment', source: 'stock', sourceId: product.id, userId: user.id,
            lines: [{ accountId: F.coaId('5360'), debit: -delta * product.cost }, { accountId: F.coaId('1300'), credit: -delta * product.cost }] });
        }
      });
      return sendJson(res, 200, { ok: true, product: productById(product.id) }), true;
    }
    if (m === 'GET' && p === '/api/admin/store/stock-movements') {
      let sql = `SELECT m.id, m.product_id AS productId, p.name AS productName, p.sku, m.change_qty AS changeQty, m.reason, m.movement_type AS type, m.reference,
                        COALESCE(m.unit_cost, p.cost) AS unitCost, m.balance_after AS balance, m.created_by AS createdBy, u.name AS createdByName, m.created_at AS createdAt
                 FROM store_stock_movements m JOIN store_products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.created_by WHERE 1=1`;
      const prm = [];
      if (g('type')) { sql += ' AND m.movement_type = ?'; prm.push(g('type')); }
      if (g('from')) { sql += ' AND date(m.created_at) >= date(?)'; prm.push(g('from')); }
      if (g('to')) { sql += ' AND date(m.created_at) <= date(?)'; prm.push(g('to')); }
      let rows = all(`${sql} ORDER BY m.created_at DESC, m.id DESC LIMIT 2000`, ...prm).map(r => ({ ...r, value: round2(Math.abs(r.changeQty) * (r.unitCost || 0)) }));
      if (g('search')) { const q = g('search').toLowerCase(); rows = rows.filter(r => [r.productName, r.sku, r.reason, r.reference].some(v => String(v || '').toLowerCase().includes(q))); }
      return sendJson(res, 200, { movements: rows }), true;
    }

    // Orders
    if (m === 'GET' && p === '/api/admin/store/orders') {
      return sendJson(res, 200, { orders: orders({ status: g('status'), payment: g('payment'), fulfilment: g('fulfilment'), fulfilmentType: g('fulfilmentType'), channel: g('channel'), from: g('from'), to: g('to'), search: g('search'), shiftId: g('shiftId') }) }), true;
    }
    const ordMatch = p.match(/^\/api\/admin\/store\/orders\/(\d+)$/);
    if (m === 'GET' && ordMatch) {
      const o = orders().find(x => x.id === Number(ordMatch[1]));
      if (!o) return sendJson(res, 404, { error: 'Order not found' }), true;
      return sendJson(res, 200, { order: o, items: orderItems(o.id) }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/orders') {
      const b = await readJson(req);
      const channel = b.channel === 'online' ? 'online' : 'pos';
      const shift = openShift();
      if (channel === 'pos' && !shift) return sendJson(res, 400, { error: 'Open a shift before processing any sales' }), true;
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return sendJson(res, 400, { error: 'The cart is empty' }), true;
      const resolved = [];
      for (const it of items) {
        const prod = productById(it.productId);
        const qty = Math.round(Number(it.qty));
        if (!prod || !(qty > 0)) return sendJson(res, 400, { error: 'Each item needs a valid product and quantity' }), true;
        if (prod.productType !== 'digital' && prod.stockQty < qty) return sendJson(res, 400, { error: `Not enough stock for "${prod.name}" (have ${prod.stockQty}, need ${qty})` }), true;
        resolved.push({ prod, qty });
      }
      const subtotal = round2(resolved.reduce((s, r) => s + r.prod.salePrice * r.qty, 0));
      const discount = Math.min(subtotal, money(b.discount));
      const total = round2(subtotal - discount);
      const now = nowIso();
      const orderNo = F.sequenceCode('store_orders', 'order_no', 'ORD-', 4);
      const id = F.tx(() => {
        const r = run(`INSERT INTO store_orders (order_no, channel, customer_name, status, subtotal, discount, total, payment_method, created_by, created_at, payment_status, fulfilment_status, fulfilment_type, shift_id, payment_note, updated_at)
                       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, 'paid', 'picked_up', 'pickup', ?, ?, ?)`,
          orderNo, channel, cleanText(b.customerName) || 'Walk-in Customer', subtotal, discount, total, cleanText(b.paymentMethod) || 'cash', user.id, now,
          channel === 'pos' ? shift.id : null, cleanText(b.paymentNote) || null, now);
        const oid = Number(r.lastInsertRowid);
        resolved.forEach(({ prod, qty }) => {
          run('INSERT INTO store_order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)', oid, prod.id, prod.name, prod.salePrice, qty, round2(prod.salePrice * qty));
          moveStock(prod.id, -qty, { type: 'sale', reason: `Sale ${orderNo}`, reference: orderNo, unitCost: prod.cost, userId: user.id });
        });
        syncOrderIncome(oid, user.id);
        return oid;
      });
      return sendJson(res, 200, { ok: true, orderId: id, orderNo }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/orders/bulk') {
      const b = await readJson(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      if (!ids.length) return sendJson(res, 400, { error: 'Select at least one order' }), true;
      let n = 0;
      F.tx(() => ids.forEach(id => {
        const o = one('SELECT * FROM store_orders WHERE id = ?', id);
        if (!o) return;
        const restock = () => orderItems(id).forEach(i => i.productId && productById(i.productId) && moveStock(i.productId, i.qty, { type: 'void_reversal', reason: `Reversal ${o.order_no}`, reference: o.order_no, userId: user.id }));
        if (b.action === 'processing' && !['cancelled', 'completed'].includes(o.status)) run("UPDATE store_orders SET status = 'processing', fulfilment_status = 'processing', updated_at = ? WHERE id = ?", nowIso(), id);
        else if (b.action === 'fulfilled' && o.status !== 'cancelled') run("UPDATE store_orders SET status = 'completed', fulfilment_status = CASE WHEN fulfilment_type = 'delivery' THEN 'delivered' ELSE 'picked_up' END, updated_at = ? WHERE id = ?", nowIso(), id);
        else if (b.action === 'cancel' && o.status !== 'cancelled') { restock(); run("UPDATE store_orders SET status = 'cancelled', fulfilment_status = 'cancelled', payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END, updated_at = ? WHERE id = ?", nowIso(), id); }
        else if (b.action === 'refunded' && o.payment_status !== 'refunded') { if (o.status !== 'cancelled') restock(); run("UPDATE store_orders SET payment_status = 'refunded', status = 'cancelled', fulfilment_status = 'returned', updated_at = ? WHERE id = ?", nowIso(), id); }
        else if (b.action === 'status') {
          if (ORDER_STATUSES.includes(b.status)) run('UPDATE store_orders SET status = ?, updated_at = ? WHERE id = ?', b.status, nowIso(), id);
          if (PAYMENT_STATUSES.includes(b.paymentStatus)) run('UPDATE store_orders SET payment_status = ?, updated_at = ? WHERE id = ?', b.paymentStatus, nowIso(), id);
          if (FULFILMENT.includes(b.fulfilmentStatus)) run('UPDATE store_orders SET fulfilment_status = ?, updated_at = ? WHERE id = ?', b.fulfilmentStatus, nowIso(), id);
        } else return;
        syncOrderIncome(id, user.id);
        n += 1;
      }));
      return sendJson(res, 200, { ok: true, count: n }), true;
    }

    // POS shifts
    if (m === 'GET' && p === '/api/admin/store/shifts') {
      const cur = openShift();
      return sendJson(res, 200, { current: cur ? shifts().find(s => s.id === cur.id) : null, shifts: shifts() }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/shifts/open') {
      if (openShift()) return sendJson(res, 400, { error: 'A shift is already open' }), true;
      const b = await readJson(req);
      run("INSERT INTO pos_shifts (opened_by, opened_at, opening_cash, status) VALUES (?, ?, ?, 'open')", user.id, nowIso(), money(b.openingCash));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/shifts/close') {
      const cur = openShift();
      if (!cur) return sendJson(res, 400, { error: 'No shift is open' }), true;
      const b = await readJson(req);
      run("UPDATE pos_shifts SET status = 'closed', closed_by = ?, closed_at = ?, closing_cash = ?, notes = ? WHERE id = ?", user.id, nowIso(), money(b.closingCash), cleanText(b.notes) || null, cur.id);
      return sendJson(res, 200, { ok: true, shift: shifts().find(s => s.id === cur.id) }), true;
    }

    // Requisitions
    if (m === 'GET' && p === '/api/admin/store/requisitions') {
      let rows = all(`SELECT r.id, r.item_description AS itemDescription, r.product_id AS productId, p.name AS productName, r.quantity, r.fulfilled_qty AS fulfilledQty,
                             r.department, r.reason, r.status, r.requested_by AS requestedBy, u.name AS requestedByName, r.created_at AS createdAt,
                             r.decided_by AS decidedBy, du.name AS decidedByName, r.decided_at AS decidedAt, r.decision_note AS decisionNote, COALESCE(p.cost,0) AS unitCost
                      FROM store_requisitions r LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by
                      LEFT JOIN store_products p ON p.id = r.product_id ORDER BY r.created_at DESC`);
      if (g('status')) rows = rows.filter(r => r.status === g('status'));
      return sendJson(res, 200, { requisitions: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/requisitions') {
      const b = await readJson(req);
      const prod = Number(b.productId) ? productById(b.productId) : null;
      const desc = cleanText(b.itemDescription) || (prod && prod.name);
      const qty = Math.round(Number(b.quantity));
      if (!desc || !(qty > 0)) return sendJson(res, 400, { error: 'Item and a positive quantity are required' }), true;
      run(`INSERT INTO store_requisitions (item_description, product_id, quantity, department, reason, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        desc, prod ? prod.id : null, qty, cleanText(b.department) || null, cleanText(b.reason) || null, user.id, nowIso());
      return sendJson(res, 200, { ok: true }), true;
    }
    const reqMatch = p.match(/^\/api\/admin\/store\/requisitions\/(\d+)$/);
    if (m === 'PUT' && reqMatch) {
      const r = one('SELECT * FROM store_requisitions WHERE id = ?', Number(reqMatch[1]));
      if (!r) return sendJson(res, 404, { error: 'Requisition not found' }), true;
      const b = await readJson(req);
      const status = cleanText(b.status);
      if (!['approved', 'rejected', 'fulfilled'].includes(status)) return sendJson(res, 400, { error: 'Invalid status' }), true;
      if (status === 'fulfilled' && r.status !== 'approved') return sendJson(res, 400, { error: 'Approve the requisition before issuing it' }), true;
      if (status !== 'fulfilled' && r.status !== 'pending') return sendJson(res, 400, { error: 'Only pending requisitions can be approved or rejected' }), true;
      F.tx(() => {
        if (status === 'fulfilled' && r.product_id) {
          const qty = Math.round(Number(b.quantity)) || r.quantity;
          const prod = productById(r.product_id);
          moveStock(r.product_id, -qty, { type: 'requisition', reason: `Requisition #${r.id} — ${r.department || ''}`.trim(), reference: `REQ-${r.id}`, unitCost: prod.cost, userId: user.id });
          run('UPDATE store_requisitions SET fulfilled_qty = ? WHERE id = ?', qty, r.id);
          if (F.autoPostingOn() && prod.cost > 0) F.postJournal({ date: today(), memo: `Internal stock usage — ${prod.name}`, type: 'requisition', source: 'requisition', sourceId: r.id, userId: user.id,
            lines: [{ accountId: F.coaId('5300'), debit: qty * prod.cost }, { accountId: F.coaId('1300'), credit: qty * prod.cost }] });
        }
        run('UPDATE store_requisitions SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', status, user.id, nowIso(), cleanText(b.note) || null, r.id);
      });
      return sendJson(res, 200, { ok: true }), true;
    }

    // Purchase orders
    if (m === 'GET' && p === '/api/admin/store/purchase-orders') {
      let rows = all('SELECT po.*, c.name AS vendor FROM store_purchase_orders po LEFT JOIN acct_contacts c ON c.id = po.contact_id ORDER BY po.id DESC').map(poRow);
      if (g('status')) rows = rows.filter(r => r.status === g('status'));
      if (g('search')) { const q = g('search').toLowerCase(); rows = rows.filter(r => [r.poCode, r.vendor].some(v => String(v || '').toLowerCase().includes(q))); }
      return sendJson(res, 200, { orders: rows }), true;
    }
    const poMatch = p.match(/^\/api\/admin\/store\/purchase-orders(?:\/(\d+))?(?:\/(status))?$/);
    if (poMatch && (m === 'POST' || m === 'PUT') && !poMatch[2]) {
      const b = await readJson(req);
      const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ productId: Number(i.productId) || null, description: cleanText(i.description), qty: Number(i.qty) || 0, unitCost: money(i.unitCost) })).filter(i => (i.productId || i.description) && i.qty > 0);
      if (!Number(b.contactId)) return sendJson(res, 400, { error: 'Choose the vendor' }), true;
      if (!items.length) return sendJson(res, 400, { error: 'Add at least one item' }), true;
      const id = F.tx(() => {
        let poId = Number(poMatch[1]);
        if (m === 'POST') {
          poId = Number(run(`INSERT INTO store_purchase_orders (po_code, contact_id, order_date, expected_date, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
            F.sequenceCode('store_purchase_orders', 'po_code', 'PO-', 4), Number(b.contactId), cleanText(b.orderDate) || today(), cleanText(b.expectedDate) || null, cleanText(b.notes) || null, user.id, nowIso()).lastInsertRowid);
        } else {
          const po = one('SELECT status FROM store_purchase_orders WHERE id = ?', poId);
          if (!po || po.status !== 'draft') throw Object.assign(new Error('Only draft purchase orders can be edited'), { status: 400 });
          run('UPDATE store_purchase_orders SET contact_id = ?, order_date = ?, expected_date = ?, notes = ? WHERE id = ?', Number(b.contactId), cleanText(b.orderDate) || today(), cleanText(b.expectedDate) || null, cleanText(b.notes) || null, poId);
          run('DELETE FROM store_po_items WHERE po_id = ?', poId);
        }
        items.forEach(i => run('INSERT INTO store_po_items (po_id, product_id, description, qty, unit_cost) VALUES (?, ?, ?, ?, ?)', poId, i.productId, i.description || null, i.qty, i.unitCost));
        return poId;
      });
      return sendJson(res, 200, { ok: true, id }), true;
    }
    if (poMatch && poMatch[2] && m === 'POST') {
      const b = await readJson(req);
      if (!['draft', 'sent', 'cancelled', 'closed'].includes(b.status)) return sendJson(res, 400, { error: 'Invalid status' }), true;
      run('UPDATE store_purchase_orders SET status = ? WHERE id = ?', b.status, Number(poMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (poMatch && poMatch[1] && m === 'DELETE') {
      if (one("SELECT 1 FROM store_grns WHERE po_id = ? AND status = 'posted'", Number(poMatch[1]))) return sendJson(res, 400, { error: 'Goods have been received on this order — cancel it instead' }), true;
      run('DELETE FROM store_purchase_orders WHERE id = ?', Number(poMatch[1]));
      return sendJson(res, 200, { ok: true }), true;
    }

    // Goods Received Notes
    if (m === 'GET' && p === '/api/admin/store/grns') {
      let rows = all('SELECT g.*, c.name AS vendor, po.po_code FROM store_grns g LEFT JOIN acct_contacts c ON c.id = g.contact_id LEFT JOIN store_purchase_orders po ON po.id = g.po_id ORDER BY g.id DESC').map(grnRow);
      if (g('status')) rows = rows.filter(r => r.status === g('status'));
      if (g('search')) { const q = g('search').toLowerCase(); rows = rows.filter(r => [r.grnCode, r.vendor, r.poCode].some(v => String(v || '').toLowerCase().includes(q))); }
      return sendJson(res, 200, { grns: rows }), true;
    }
    if (m === 'POST' && p === '/api/admin/store/grns') {
      const b = await readJson(req);
      const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ productId: Number(i.productId), qty: Number(i.qty) || 0, unitCost: money(i.unitCost) })).filter(i => i.productId && i.qty > 0);
      const po = Number(b.poId) ? one('SELECT * FROM store_purchase_orders WHERE id = ?', Number(b.poId)) : null;
      const contactId = Number(b.contactId) || (po && po.contact_id);
      if (!contactId) return sendJson(res, 400, { error: 'Choose the vendor' }), true;
      if (!items.length) return sendJson(res, 400, { error: 'Add the items received' }), true;
      const id = F.tx(() => {
        const gid = Number(run(`INSERT INTO store_grns (grn_code, po_id, contact_id, receipt_date, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
          F.sequenceCode('store_grns', 'grn_code', 'GRN-', 4), po ? po.id : null, contactId, cleanText(b.receiptDate) || today(), cleanText(b.notes) || null, user.id, nowIso()).lastInsertRowid);
        items.forEach(i => run('INSERT INTO store_grn_items (grn_id, product_id, qty, unit_cost) VALUES (?, ?, ?, ?)', gid, i.productId, i.qty, i.unitCost));
        return gid;
      });
      return sendJson(res, 200, { ok: true, id }), true;
    }
    const grnMatch = p.match(/^\/api\/admin\/store\/grns\/(\d+)(?:\/(post))?$/);
    if (grnMatch) {
      const gr = one('SELECT g.*, c.name AS vendor, po.po_code FROM store_grns g LEFT JOIN acct_contacts c ON c.id = g.contact_id LEFT JOIN store_purchase_orders po ON po.id = g.po_id WHERE g.id = ?', Number(grnMatch[1]));
      if (!gr) return sendJson(res, 404, { error: 'GRN not found' }), true;
      const row = grnRow(gr);
      if (m === 'POST' && grnMatch[2]) {
        if (gr.status === 'posted') return sendJson(res, 400, { error: 'Already posted' }), true;
        F.tx(() => {
          row.items.forEach(i => {
            const prod = productById(i.productId);
            const newQty = prod.stockQty + i.qty;
            const avgCost = newQty > 0 ? round2((prod.stockQty * prod.cost + i.qty * i.unitCost) / newQty) : i.unitCost;
            moveStock(i.productId, Math.round(i.qty), { type: 'grn_receipt', reason: `Received ${gr.grn_code}`, reference: gr.grn_code, unitCost: i.unitCost, userId: user.id });
            run('UPDATE store_products SET cost = ? WHERE id = ?', avgCost, i.productId);
          });
          run("UPDATE store_grns SET status = 'posted', posted_at = ? WHERE id = ?", nowIso(), gr.id);
          const terms = (one('SELECT terms_days AS t FROM acct_contacts WHERE id = ?', gr.contact_id) || {}).t || 30;
          const due = new Date(`${gr.receipt_date}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + Number(terms));
          run(`INSERT INTO acct_bills (contact_id, doc_no, doc_type, issue_date, due_date, amount, status, notes, created_at, description, grn_id) VALUES (?, ?, 'bill', ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
            gr.contact_id, F.sequenceCode('acct_bills', 'doc_no', 'BILL-', 4), gr.receipt_date, due.toISOString().slice(0, 10), row.total, `From ${gr.grn_code}`, nowIso(), `Goods received ${gr.grn_code}${gr.po_code ? ` (${gr.po_code})` : ''}`, gr.id);
          if (F.autoPostingOn() && row.total > 0) F.postJournal({ date: gr.receipt_date, memo: `Goods received ${gr.grn_code}`, type: 'vendor_invoice', source: 'grn', sourceId: gr.id, userId: user.id,
            lines: [{ accountId: F.coaId('1300'), debit: row.total }, { accountId: F.coaId('2100'), credit: row.total }] });
          if (gr.po_id) {
            const po = poRow(one('SELECT po.*, c.name AS vendor FROM store_purchase_orders po LEFT JOIN acct_contacts c ON c.id = po.contact_id WHERE po.id = ?', gr.po_id));
            const full = po.items.every(i => !i.productId || i.received >= i.qty);
            run('UPDATE store_purchase_orders SET status = ? WHERE id = ?', full ? 'received' : 'partially_received', gr.po_id);
          }
        });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (gr.status === 'posted') return sendJson(res, 400, { error: 'Posted GRNs cannot be deleted' }), true;
        run('DELETE FROM store_grns WHERE id = ?', gr.id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }

    // Reports
    if (m === 'GET' && p === '/api/admin/store/reports') {
      const list = products().filter(x => x.productType !== 'digital');
      const reqs = all('SELECT department, item_description AS item, quantity, fulfilled_qty AS fulfilled, status FROM store_requisitions');
      const byDept = new Map();
      reqs.forEach(r => { const k = r.department || '—'; const v = byDept.get(k) || { department: k, requests: 0, requested: 0, issued: 0, pending: 0 }; v.requests += 1; v.requested += r.quantity; v.issued += r.fulfilled || 0; if (r.status === 'pending') v.pending += 1; byDept.set(k, v); });
      return sendJson(res, 200, {
        valuation: list, totals: { products: list.length, units: list.reduce((s, x) => s + x.stockQty, 0), value: round2(list.reduce((s, x) => s + x.stockValue, 0)) },
        lowStock: list.filter(x => x.lowStock), requisitions: [...byDept.values()], shifts: shifts(),
      }), true;
    }

    // Settings, banners, sections, storefront
    const SETTING_KEYS = { storeName: ['store_name', 'School Store'], currency: ['store_currency', 'NGN'], lowStockThreshold: ['store_low_stock_threshold', '10'], taxRate: ['store_tax_rate', '0'],
      contactEmail: ['store_contact_email', ''], contactPhone: ['store_contact_phone', ''], storeOpen: ['store_open', '1'], pickupEnabled: ['store_pickup', '1'],
      deliveryEnabled: ['store_delivery', '0'], deliveryFee: ['store_delivery_fee', '0'], about: ['store_about', ''], receiptFooter: ['store_receipt_footer', 'Thank you for your patronage.'] };
    if (m === 'GET' && p === '/api/admin/store/settings') {
      const out = {};
      Object.entries(SETTING_KEYS).forEach(([k, [meta, def]]) => { out[k] = valueFromMeta(meta, def); });
      ['lowStockThreshold', 'taxRate', 'deliveryFee'].forEach(k => { out[k] = Number(out[k]) || 0; });
      ['storeOpen', 'pickupEnabled', 'deliveryEnabled'].forEach(k => { out[k] = out[k] === '1'; });
      return sendJson(res, 200, out), true;
    }
    if (m === 'PUT' && p === '/api/admin/store/settings') {
      const b = await readJson(req);
      Object.entries(SETTING_KEYS).forEach(([k, [meta]]) => {
        if (b[k] === undefined) return;
        setMeta(meta, typeof b[k] === 'boolean' ? (b[k] ? '1' : '0') : String(['lowStockThreshold', 'taxRate', 'deliveryFee'].includes(k) ? (Number(b[k]) || 0) : cleanText(b[k])));
      });
      return sendJson(res, 200, { ok: true }), true;
    }
    const contentMatch = p.match(/^\/api\/admin\/store\/(banners|homepage-sections)(?:\/(\d+))?$/);
    if (contentMatch) {
      const isBanner = contentMatch[1] === 'banners';
      const table = isBanner ? 'store_banners' : 'store_homepage_sections';
      if (m === 'GET') {
        const rows = isBanner
          ? all('SELECT id, title, subtitle, image_url AS imageUrl, image_path AS imagePath, link_url AS linkUrl, sort_order AS sortOrder, is_active AS isActive FROM store_banners ORDER BY sort_order, id')
          : all('SELECT id, title, section_type AS sectionType, content, sort_order AS sortOrder, is_active AS isActive FROM store_homepage_sections ORDER BY sort_order, id');
        return sendJson(res, 200, { [isBanner ? 'banners' : 'sections']: rows.map(r => ({ ...r, isActive: !!r.isActive })) }), true;
      }
      if (m === 'DELETE' && contentMatch[2]) { run(`DELETE FROM ${table} WHERE id = ?`, Number(contentMatch[2])); return sendJson(res, 200, { ok: true }), true; }
      if (m === 'POST' || m === 'PUT') {
        const b = await F.readBigJson(req);
        const title = cleanText(b.title);
        if (!title) return sendJson(res, 400, { error: 'Title is required' }), true;
        if (isBanner) {
          let image = m === 'PUT' ? (one('SELECT image_path AS i FROM store_banners WHERE id = ?', Number(contentMatch[2])) || {}).i : null;
          try { if (b.image) image = saveDataUrl(b.image, 'banner'); } catch (err) { return sendJson(res, 400, { error: err.message }), true; }
          const vals = [title, cleanText(b.subtitle) || null, cleanText(b.imageUrl) || null, image, cleanText(b.linkUrl) || null, Number(b.sortOrder) || 0, b.isActive === false ? 0 : 1];
          if (m === 'POST') run('INSERT INTO store_banners (title, subtitle, image_url, image_path, link_url, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...vals, nowIso());
          else run('UPDATE store_banners SET title = ?, subtitle = ?, image_url = ?, image_path = ?, link_url = ?, sort_order = ?, is_active = ? WHERE id = ?', ...vals, Number(contentMatch[2]));
        } else {
          const vals = [title, cleanText(b.sectionType) || 'custom', cleanText(b.content) || null, Number(b.sortOrder) || 0, b.isActive === false ? 0 : 1];
          if (m === 'POST') run('INSERT INTO store_homepage_sections (title, section_type, content, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)', ...vals, nowIso());
          else run('UPDATE store_homepage_sections SET title = ?, section_type = ?, content = ?, sort_order = ?, is_active = ? WHERE id = ?', ...vals, Number(contentMatch[2]));
        }
        return sendJson(res, 200, { ok: true }), true;
      }
    }
    if (m === 'GET' && p === '/api/admin/store/storefront') {
      return sendJson(res, 200, {
        storeName: valueFromMeta('store_name', 'School Store'), currency: valueFromMeta('store_currency', 'NGN'), about: valueFromMeta('store_about', ''),
        storeOpen: valueFromMeta('store_open', '1') === '1',
        banners: all('SELECT id, title, subtitle, image_url AS imageUrl, image_path AS imagePath, link_url AS linkUrl FROM store_banners WHERE is_active = 1 ORDER BY sort_order, id'),
        sections: all('SELECT id, title, section_type AS sectionType, content FROM store_homepage_sections WHERE is_active = 1 ORDER BY sort_order, id'),
        categories: all("SELECT id, name FROM store_categories WHERE status = 'published' AND visibility <> 'private' ORDER BY sort_order, name"),
        products: products().filter(x => x.status === 'published' && x.visibility !== 'private'),
      }), true;
    }
    return false;
  }

  return { handle };
};
