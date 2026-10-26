// Finance › Store & Inventory pages (SchoolsFocus layout): Visit Storefront,
// Point-of-Sale Terminal (shifts, several open sales, barcode / SKU search),
// Orders & Sales, Products, Categories, Inventory & Supply (stock movement,
// valuation, low stock, adjustment, purchase orders, goods received, vendor
// bills, vendor contacts), Inventory Reports, Store Settings, Storefront
// Banners, Storefront Homepage Sections and Internal Requisitions.
(function () {
  const { esc, money, date, dateTime, field, select, val, badge, stats, card, modal, table, options } = FIN;
  const S = { pos: { sales: [{ id: 1, items: [], customer: 'Walk-in Customer', discount: 0 }], cur: 0, next: 2 }, ord: { status: 'all' }, prod: { status: 'active' }, cat: { status: 'active' }, inv: { tab: 'movement' }, rep: { tab: 'movement' }, req: {} };
  const MOVE_TYPES = [['', 'All Types'], ['sale', 'Sale'], ['requisition', 'Requisition'], ['adjustment', 'Adjustment'], ['grn_receipt', 'GRN Receipt'], ['manual', 'Manual'], ['void_reversal', 'Void Reversal'], ['opening_balance', 'Opening Balance']];
  const statusColor = s => ({ published: 'green', draft: 'amber', archived: 'grey', public: 'blue', logged_in: 'cyan', private: 'grey' }[s] || 'grey');
  const img = p => (p ? `/${esc(p)}` : '');

  // ══ Visit Storefront ══════════════════════════════════════════════════
  FIN.page('visitStorefront', async el => {
    const d = await FIN.get('/api/admin/store/storefront');
    S.sf = d;
    el.innerHTML = `${FIN.header('Visit Storefront')}
      <div class="fin-note" style="margin-bottom:14px">This is the shop as parents and pupils see it (published, non-private products only).${d.storeOpen ? '' : ' <b>The store is currently closed</b> (Store Settings).'}</div>
      ${d.banners.map(b => `<div class="fin-hero" style="margin-bottom:12px;${b.imagePath || b.imageUrl ? `background:linear-gradient(90deg,rgba(13,110,253,.85),rgba(30,64,175,.4)),url('${b.imagePath ? img(b.imagePath) : esc(b.imageUrl)}') center/cover` : ''}"><h3 style="font-size:20px">${esc(b.title)}</h3><p>${esc(b.subtitle || '')}</p></div>`).join('')}
      ${card(`🛍 ${esc(d.storeName)}`, `${d.about ? `<p class="muted" style="margin-bottom:12px">${esc(d.about)}</p>` : ''}
        ${d.sections.map(s => `<div class="fin-tile" style="margin-bottom:10px"><h4>${esc(s.title)}</h4><p>${esc(s.content || '')}</p></div>`).join('')}
        <div class="fin-grid" style="margin-bottom:12px">${field('Category', select('vs-cat', [['', 'All Categories'], ...d.categories.map(c => [c.id, c.name])], '', null, 'onchange="FIN.store.vsDraw()"'))}${field('Search', '<input class="field-input" id="vs-q" placeholder="Search products..." oninput="FIN.store.vsDraw()">')}</div>
        <div id="vs-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px"></div>`)}`;
    vsDraw();
  });
  function vsDraw() {
    const cat = val('vs-cat'); const q = val('vs-q').toLowerCase();
    const rows = S.sf.products.filter(p => (!cat || String(p.categoryId) === cat) && (!q || p.name.toLowerCase().includes(q)));
    document.getElementById('vs-grid').innerHTML = rows.map(p => `<div class="fin-tile"><div style="height:120px;border-radius:8px;background:var(--black-3) ${p.imagePath ? `url('${img(p.imagePath)}') center/cover` : ''};display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:11px">${p.imagePath ? '' : esc(p.categoryName || 'Product')}</div>
      <h4>${esc(p.name)}</h4><div style="font-weight:800;color:#0d6efd">${money(p.salePrice)} ${p.discountPct ? `<s class="muted">${money(p.price)}</s> ${badge(`-${p.discountPct}%`, 'red')}` : ''}</div>
      <div class="muted">${p.productType === 'digital' ? 'Digital' : p.stockQty > 0 ? 'In stock' : 'Out of stock'}</div></div>`).join('') || '<div class="fin-empty">No active products yet — add some under Products.</div>';
  }

  // ══ Point-of-Sale Terminal ════════════════════════════════════════════
  FIN.page('posTerminal', async el => {
    const [sh, pr, st] = await Promise.all([FIN.get('/api/admin/store/shifts'), FIN.get('/api/admin/store/products?status=published'), FIN.get('/api/admin/store/settings')]);
    S.pos.shift = sh.current; S.pos.products = pr.products; S.pos.settings = st;
    el.innerHTML = `${FIN.header('Point of Sale Terminal')}
      <div class="fin-actions" style="justify-content:flex-end;margin-bottom:10px"><button class="fin-btn plain sm" onclick="FIN.store.posRecent()">⟲ Recent Sales</button><button class="fin-btn plain sm" onclick="FIN.store.posShifts()">⏱ Shifts</button><button class="fin-btn plain sm" onclick="FIN.goTab('ordersSales')">☰ All Orders</button>
        ${sh.current ? `<button class="fin-btn warn sm" onclick="FIN.store.posClose()">■ Close Shift</button>` : ''}</div>
      <div style="position:relative">${sh.current ? '' : `<div style="position:absolute;inset:0;background:rgba(255,255,255,.88);z-index:5;display:flex;align-items:center;justify-content:center;border-radius:var(--radius)"><div style="text-align:center"><div style="font-size:36px;color:var(--text-3)">◷</div><h3>No Active Shift</h3><p class="muted" style="margin:6px 0 14px">Open a shift before processing any sales.</p><button class="fin-btn" onclick="FIN.store.posOpen()">▶ Open Shift</button></div></div>`}
        ${sh.current ? `<div class="fin-note" style="margin-bottom:10px">Shift #${sh.current.id} opened ${dateTime(sh.current.openedAt)} by ${esc(sh.current.openedBy || '')} · Opening cash ${money(sh.current.openingCash)} · Sales so far ${money(sh.current.totalSales)}</div>` : ''}
        <div id="pos-tabs" class="fin-actions" style="margin-bottom:10px"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;align-items:start">
          <div class="fin-card" style="margin:0"><div class="fin-card-body"><div class="fin-grid" style="margin-bottom:12px">${field('', '<input class="field-input" id="pos-scan" placeholder="📷 Scan barcode..." onkeydown="if(event.key===\'Enter\'){FIN.store.posScan(this.value);this.value=\'\'}">')}${field('', '<input class="field-input" id="pos-q" placeholder="🔍 Search by name or SKU..." oninput="FIN.store.posProducts()">')}</div>
            <div id="pos-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;max-height:520px;overflow-y:auto"></div></div></div>
          <div class="fin-card" style="margin:0"><div class="fin-card-head"><div class="fin-card-title">Current Sale</div></div><div class="fin-card-body" id="pos-cart"></div></div>
        </div></div>`;
    posProducts(); posCart();
  });
  function posProducts() {
    const q = val('pos-q').toLowerCase();
    const rows = S.pos.products.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q));
    document.getElementById('pos-products').innerHTML = rows.map(p => `<button type="button" class="fin-tile" style="text-align:left;cursor:pointer;font-family:'DM Sans',sans-serif" onclick="FIN.store.posAdd(${p.id})" ${p.productType !== 'digital' && p.stockQty <= 0 ? 'disabled' : ''}>
      ${p.imagePath ? `<div style="height:70px;border-radius:6px;background:url('${img(p.imagePath)}') center/cover;margin-bottom:6px"></div>` : ''}<b style="font-size:12px">${esc(p.name)}</b><div class="muted">${esc(p.sku || '')}</div><div style="color:#0d6efd;font-weight:700">${money(p.salePrice)}</div><div class="muted">${p.productType === 'digital' ? 'Digital' : `${p.stockQty} in stock`}</div></button>`).join('') || '<div class="fin-empty">No products found.</div>';
    const tabs = document.getElementById('pos-tabs');
    tabs.innerHTML = S.pos.sales.map((s, i) => `<button class="fin-btn ${i === S.pos.cur ? '' : 'plain'} sm" onclick="FIN.store.posSwitch(${i})">Sale ${s.id}${S.pos.sales.length > 1 ? ` <span onclick="event.stopPropagation();FIN.store.posDrop(${i})">×</span>` : ''}</button>`).join('') + '<button class="fin-btn outline sm" onclick="FIN.store.posNew()">+ New Sale</button>';
  }
  const sale = () => S.pos.sales[S.pos.cur];
  function posCart() {
    const s = sale();
    const sub = s.items.reduce((a, i) => a + i.price * i.qty, 0);
    const tax = sub * (Number(S.pos.settings.taxRate) || 0) / 100;
    const total = Math.max(0, sub - (Number(s.discount) || 0));
    document.getElementById('pos-cart').innerHTML = `${field('Customer', `<input class="field-input" value="${esc(s.customer)}" oninput="FIN.store.posSet('customer', this.value)">`)}
      <table class="fin-table" style="margin:10px 0"><thead><tr><th>Item</th><th class="num">Unit Price</th><th>Quantity</th><th class="num">Sub Total</th><th></th></tr></thead>
      <tbody>${s.items.map((i, n) => `<tr><td>${esc(i.name)}</td><td class="num">${money(i.price)}</td><td><input class="field-input" type="number" min="1" style="width:64px;padding:4px 6px" value="${i.qty}" onchange="FIN.store.posQty(${n}, this.value)"></td><td class="num">${money(i.price * i.qty)}</td><td><button class="fin-btn red sm" onclick="FIN.store.posQty(${n}, 0)">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="fin-empty">Cart is empty<br><span class="muted">Add products from the left panel</span></td></tr>'}</tbody></table>
      <dl class="fin-kv"><dt>Subtotal</dt><dd class="num">${money(sub)}</dd><dt>Discount ✎</dt><dd><input class="field-input" type="number" min="0" style="width:120px;padding:4px 6px" value="${s.discount}" onchange="FIN.store.posSet('discount', this.value)"></dd>
        ${tax ? `<dt>Tax included (${S.pos.settings.taxRate}%)</dt><dd>${money(tax)}</dd>` : ''}<dt><b>Total</b></dt><dd style="font-size:18px">${money(total)}</dd></dl>
      <div class="fin-grid two" style="margin-top:10px">${field('Payment Method', select('pos-method', [['cash', 'Cash'], ['card', 'Card / POS'], ['transfer', 'Bank Transfer']], s.method || 'cash', null, 'onchange="FIN.store.posSet(\'method\', this.value)"'))}${field('Payment Note (optional)', `<input class="field-input" id="pos-note" value="${esc(s.note || '')}" oninput="FIN.store.posSet('note', this.value)">`)}</div>
      <div class="fin-actions" style="margin-top:12px"><button class="fin-btn red" onclick="FIN.store.posVoid()">⊘ Void</button><button class="fin-btn green" style="flex:1;justify-content:center" onclick="FIN.store.posCharge()" ${s.items.length ? '' : 'disabled'}>✓ CHARGE ${money(total)}</button></div>`;
  }
  const POS = {
    posAdd(id) { const p = S.pos.products.find(x => x.id === id); const s = sale(); const ex = s.items.find(i => i.id === id); if (ex) ex.qty += 1; else s.items.push({ id, name: p.name, price: p.salePrice, qty: 1 }); posCart(); },
    posScan(code) { const p = S.pos.products.find(x => String(x.sku || '').toLowerCase() === String(code).trim().toLowerCase()); if (!p) return showToast(`No product with code "${code}"`); POS.posAdd(p.id); },
    posQty(n, q) { const s = sale(); q = Number(q); if (q <= 0) s.items.splice(n, 1); else s.items[n].qty = q; posCart(); },
    posSet(k, v) { sale()[k] = v; if (k === 'discount') posCart(); },
    posNew() { S.pos.sales.push({ id: S.pos.next++, items: [], customer: 'Walk-in Customer', discount: 0 }); S.pos.cur = S.pos.sales.length - 1; posProducts(); posCart(); },
    posSwitch(i) { S.pos.cur = i; posProducts(); posCart(); },
    posDrop(i) { S.pos.sales.splice(i, 1); S.pos.cur = 0; posProducts(); posCart(); },
    posVoid() { const s = sale(); s.items = []; s.discount = 0; posCart(); showToast('Sale cleared'); },
    async posCharge() {
      const s = sale();
      const r = await FIN.post('/api/admin/store/orders', { items: s.items.map(i => ({ productId: i.id, qty: i.qty })), discount: s.discount, customerName: s.customer, paymentMethod: s.method || 'cash', paymentNote: s.note });
      showToast(`Sale ${r.orderNo} completed`);
      const done = { ...s, orderNo: r.orderNo };
      POS.posReceipt(done);
      S.pos.sales.splice(S.pos.cur, 1);
      if (!S.pos.sales.length) S.pos.sales.push({ id: S.pos.next++, items: [], customer: 'Walk-in Customer', discount: 0 });
      S.pos.cur = 0;
      FIN.open('posTerminal');
    },
    posReceipt(s) {
      const sub = s.items.reduce((a, i) => a + i.price * i.qty, 0);
      FIN.print(`Receipt ${s.orderNo}`, `<div style="text-align:center"><b>${esc(S.pos.settings.storeName)}</b><br>${esc(S.pos.settings.contactPhone || '')}</div><hr>Receipt: ${esc(s.orderNo)}<br>${dateTime(new Date().toISOString())}<br>Customer: ${esc(s.customer)}<hr>
        <table>${s.items.map(i => `<tr><td>${esc(i.name)} × ${i.qty}</td><td class="num">${money(i.price * i.qty)}</td></tr>`).join('')}<tr><td>Subtotal</td><td class="num">${money(sub)}</td></tr>${s.discount ? `<tr><td>Discount</td><td class="num">-${money(s.discount)}</td></tr>` : ''}<tr><td><b>Total</b></td><td class="num"><b>${money(sub - (Number(s.discount) || 0))}</b></td></tr></table><hr><div style="text-align:center">${esc(S.pos.settings.receiptFooter || '')}</div>`, { pos: true });
    },
    posOpen() {
      modal({ title: 'Open Shift', body: field('Opening Cash in Drawer (₦)', FIN.input('sh-open', { type: 'number', value: 0 })), buttons: [{ label: 'Cancel', cls: 'plain' }, { label: '▶ Open Shift', onClick: async (o, close) => { await FIN.post('/api/admin/store/shifts/open', { openingCash: val('sh-open') }); showToast('Shift opened'); close(); FIN.open('posTerminal'); } }] });
    },
    posClose() {
      const c = S.pos.shift;
      modal({ title: `Close Shift #${c.id}`, body: `<dl class="fin-kv"><dt>Opening cash</dt><dd>${money(c.openingCash)}</dd><dt>Cash sales</dt><dd>${money(c.cashSales)}</dd><dt>Expected cash in drawer</dt><dd>${money(c.expectedCash)}</dd><dt>All sales</dt><dd>${money(c.totalSales)} (${c.sales})</dd></dl>
        <div class="fin-grid two" style="margin-top:12px">${field('Counted Closing Cash (₦)', FIN.input('sh-close', { type: 'number', value: c.expectedCash }), { required: true })}${field('Notes', FIN.input('sh-notes'))}</div>`,
        buttons: [{ label: 'Cancel', cls: 'plain' }, { label: '■ Close Shift', cls: 'warn', onClick: async (o, close) => { const r = await FIN.post('/api/admin/store/shifts/close', { closingCash: val('sh-close'), notes: val('sh-notes') }); showToast(`Shift closed${r.shift.variance ? ` — variance ${FIN.plain(money(r.shift.variance))}` : ''}`); close(); FIN.open('posTerminal'); } }] });
    },
    async posShifts() {
      const d = await FIN.get('/api/admin/store/shifts');
      const m = modal({ title: 'POS Shifts', size: 'xwide', body: '<div id="sh-table"></div>' });
      shiftTable(document.getElementById('sh-table'), d.shifts);
      return m;
    },
    async posRecent() {
      const d = await FIN.get('/api/admin/store/orders?channel=pos');
      modal({ title: 'Recent Sales', size: 'wide', body: `<table class="fin-table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>${d.orders.slice(0, 30).map(o => `<tr><td>${esc(o.orderNo)}</td><td>${dateTime(o.createdAt)}</td><td>${esc(o.customerName)}</td><td class="num">${money(o.total)}</td><td>${badge(FIN.cap(o.status), o.status === 'cancelled' ? 'red' : 'green')}</td><td><button class="fin-btn plain sm" onclick="FIN.store.orderView(${o.id})">View</button></td></tr>`).join('') || '<tr><td colspan="6" class="fin-empty">No sales yet</td></tr>'}</tbody></table>` });
    },
  };
  function shiftTable(el, rows) {
    table(el, { title: 'POS Shifts', rows, perPage: 25, columns: [
      { key: 'id', label: 'Shift', render: r => `#${r.id}` }, { key: 'openedAt', label: 'Opened', render: r => `${dateTime(r.openedAt)}<div class="muted">${esc(r.openedBy || '')}</div>` },
      { key: 'closedAt', label: 'Closed', render: r => (r.closedAt ? `${dateTime(r.closedAt)}<div class="muted">${esc(r.closedBy || '')}</div>` : badge('Open', 'green')) },
      { key: 'sales', label: 'Sales', num: true }, { key: 'totalSales', label: 'Total Sales', num: true, render: r => money(r.totalSales), exportValue: r => r.totalSales, total: true },
      { key: 'openingCash', label: 'Opening Cash', num: true, render: r => money(r.openingCash), exportValue: r => r.openingCash },
      { key: 'expectedCash', label: 'Expected Cash', num: true, render: r => money(r.expectedCash), exportValue: r => r.expectedCash },
      { key: 'closingCash', label: 'Counted Cash', num: true, render: r => (r.closingCash == null ? '—' : money(r.closingCash)), exportValue: r => r.closingCash },
      { key: 'variance', label: 'Variance', num: true, render: r => (r.variance == null ? '—' : `<span style="color:${r.variance < 0 ? 'var(--red)' : 'var(--green)'}">${money(r.variance)}</span>`), exportValue: r => r.variance },
    ] });
  }

  // ══ Orders & Sales ════════════════════════════════════════════════════
  FIN.page('ordersSales', async el => {
    const st = S.ord;
    const sel = (id, list, v) => select(id, list, v || '');
    el.innerHTML = `${FIN.header('Storefront Orders')}
      <div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">Storefront Orders</div><div class="fin-actions"><button class="fin-btn plain sm" onclick="FIN.goTab('posTerminal')">🛒 POS Terminal</button><button class="fin-btn plain sm" onclick="FIN.tableExport('ord-table','xlsx')">⤓ Export</button><button class="fin-btn plain sm" onclick="FIN.store.ordLoad()">⟳ Refresh</button></div></div>
      <div class="fin-card-body"><div class="fin-grid">
        ${field('Order Status', sel('ord-status', [['all', 'All statuses'], ['open', 'Open orders'], ['pending_payment', 'Pending payment'], ['paid', 'Paid'], ['processing', 'Processing'], ['shipped', 'Shipped / Out for delivery'], ['ready_for_pickup', 'Available for pickup'], ['return_requested', 'Return requested'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], st.status))}
        ${field('Payment', sel('ord-pay', [['all', 'All payment statuses'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['refunded', 'Refunded'], ['partially_refunded', 'Partially refunded'], ['exclude_refunded', 'Exclude refunded']], st.payment))}
        ${field('Fulfilment', sel('ord-ful', [['all', 'All fulfilment stages'], ['pending', 'Pending fulfilment'], ['processing', 'Processing'], ['shipped', 'Shipped / In transit'], ['ready_for_pickup', 'Available for pickup'], ['delivered', 'Delivered'], ['picked_up', 'Picked up'], ['return_requested', 'Return requested'], ['returned', 'Returned'], ['cancelled', 'Cancelled']], st.fulfilment))}
        ${field('Fulfilment Type', sel('ord-ftype', [['all', 'All fulfilment types'], ['delivery', 'Delivery'], ['pickup', 'Pickup'], ['digital', 'Digital']], st.fulfilmentType))}
        ${field('Channel', sel('ord-channel', [['all', 'All channels'], ['online', 'Online Store'], ['pos', 'POS Terminal']], st.channel))}
        ${field('From', FIN.input('ord-from', { type: 'date', value: st.from || '' }))}${field('To', FIN.input('ord-to', { type: 'date', value: st.to || '' }))}
        ${field('Search', FIN.input('ord-q', { value: st.search || '', placeholder: 'Search by order code, invoice, customer' }))}
        <div><button class="fin-btn" onclick="FIN.store.ordLoad()">🔍</button> <button class="fin-btn plain" onclick="FIN.store.ordReset()">Reset</button></div></div></div>
      <div id="ord-table"></div></div>`;
    ordLoad();
  });
  async function ordLoad() {
    const st = S.ord;
    Object.assign(st, { status: val('ord-status'), payment: val('ord-pay'), fulfilment: val('ord-ful'), fulfilmentType: val('ord-ftype'), channel: val('ord-channel'), from: val('ord-from'), to: val('ord-to'), search: val('ord-q') });
    const d = await FIN.get(`/api/admin/store/orders${FIN.qs(st)}`);
    S.ordTable = table(document.getElementById('ord-table'), { title: 'Storefront Orders', rows: d.orders, selectable: true, perPage: 50,
      toolbar: () => FIN.menuButton('☰ Bulk actions', [['processing', 'Mark as processing'], ['fulfilled', 'Mark as fulfilled'], ['cancel', 'Cancel orders'], ['refunded', 'Mark as refunded']].map(([a, l]) => ({ label: l, onClick: () => ordBulk(a) }))),
      columns: [
        { key: 'orderNo', label: 'Order', render: r => `<b>${esc(r.orderNo)}</b><div class="muted">${esc(r.channel === 'pos' ? 'POS Terminal' : 'Online Store')}</div>` },
        { key: 'customerName', label: 'Customer' },
        { key: 'total', label: 'Financial', num: true, render: r => `${money(r.total)}<div class="muted">${r.itemCount} item(s)${r.discount ? ` · -${FIN.whole(r.discount)}` : ''}</div>`, exportValue: r => r.total, total: true },
        { key: 'status', label: 'Order Status', render: r => badge(FIN.cap(r.status), r.status === 'cancelled' ? 'red' : r.status === 'completed' ? 'green' : 'amber') },
        { key: 'paymentStatus', label: 'Payment', render: r => `${badge(FIN.cap(r.paymentStatus), r.paymentStatus === 'paid' ? 'green' : r.paymentStatus === 'unpaid' ? 'amber' : 'red')}<div class="muted">${esc(r.paymentMethod || '')}</div>` },
        { key: 'fulfilmentStatus', label: 'Fulfilment', render: r => `${esc(FIN.cap(r.fulfilmentStatus))}<div class="muted">${esc(FIN.cap(r.fulfilmentType))}</div>` },
        { key: 'updatedAt', label: 'Activity', render: r => `<span class="muted">${dateTime(r.createdAt)}<br>by ${esc(r.createdByName || '')}</span>` },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.store.orderView(${r.id})">View</button>` },
      ] });
  }
  async function ordBulk(action) {
    const ids = S.ordTable.picked();
    if (!ids.length) return showToast('Tick at least one order');
    if (['cancel', 'refunded'].includes(action) && !await FIN.confirm('Stock will be returned and the sale removed from Income. Continue?')) return;
    const r = await FIN.post('/api/admin/store/orders/bulk', { ids, action });
    showToast(`${r.count} order(s) updated`); ordLoad();
  }
  async function orderView(id) {
    const d = await FIN.get(`/api/admin/store/orders/${id}`);
    const o = d.order;
    modal({ title: `Order ${esc(o.orderNo)}`, size: 'wide', body: `<dl class="fin-kv"><dt>Customer</dt><dd>${esc(o.customerName)}</dd><dt>Date</dt><dd>${dateTime(o.createdAt)}</dd><dt>Channel</dt><dd>${o.channel === 'pos' ? 'POS Terminal' : 'Online Store'}</dd><dt>Payment</dt><dd>${esc(o.paymentMethod || '')} — ${esc(FIN.cap(o.paymentStatus))}</dd></dl>
      <table class="fin-table" style="margin-top:12px"><thead><tr><th>Item</th><th class="num">Unit Price</th><th class="num">Qty</th><th class="num">Line Total</th></tr></thead><tbody>${d.items.map(i => `<tr><td>${esc(i.productName)}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${i.qty}</td><td class="num">${money(i.lineTotal)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">Subtotal</td><td class="num">${money(o.subtotal)}</td></tr><tr><td colspan="3">Discount</td><td class="num">-${money(o.discount)}</td></tr><tr><td colspan="3">Total</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
      <div class="fin-grid" style="margin-top:12px">${field('Order Status', select('ov-status', ['pending_payment', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'return_requested', 'completed', 'cancelled'].map(s => [s, FIN.cap(s)]), o.status))}
        ${field('Payment Status', select('ov-pay', ['paid', 'unpaid', 'refunded', 'partially_refunded'].map(s => [s, FIN.cap(s)]), o.paymentStatus))}
        ${field('Fulfilment', select('ov-ful', ['pending', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'picked_up', 'return_requested', 'returned', 'cancelled'].map(s => [s, FIN.cap(s)]), o.fulfilmentStatus))}</div>`,
      buttons: [{ label: '🖶 Receipt', cls: 'plain', onClick: () => { POS.posReceipt({ orderNo: o.orderNo, customer: o.customerName, discount: o.discount, items: d.items.map(i => ({ name: i.productName, price: i.unitPrice, qty: i.qty })) }); return false; } },
        { label: 'Save', onClick: async (o2, close) => { await FIN.post('/api/admin/store/orders/bulk', { ids: [id], action: 'status', status: val('ov-status'), paymentStatus: val('ov-pay'), fulfilmentStatus: val('ov-ful') }); showToast('Order updated'); close(); if (document.getElementById('ord-table')) ordLoad(); } }] });
  }

  // ══ Products ══════════════════════════════════════════════════════════
  FIN.page('products', async el => {
    const cats = (await FIN.get('/api/admin/store/categories?status=all')).categories;
    S.cats = cats;
    const st = S.prod;
    el.innerHTML = `${FIN.header('Storefront Products')}
      <div class="fin-card"><div class="fin-card-body"><div class="fin-grid">
        ${field('Status', select('pr-status', [['active', 'Active (Draft | Published)'], ['draft', 'Draft only'], ['published', 'Published only'], ['archived', 'Archived only'], ['all', 'All statuses']], st.status))}
        ${field('Visibility', select('pr-vis', [['', 'All visibility options'], ['public', 'Public'], ['logged_in', 'Logged-In only'], ['private', 'Private']], st.visibility || ''))}
        ${field('Type', select('pr-type', [['', 'All'], ['physical', 'Physical Products'], ['digital', 'Digital Products']], st.type || ''))}
        ${field('Category', select('pr-cat', [['', 'All categories'], ...cats.map(c => [c.id, c.name])], st.categoryId || ''))}
        ${field('Search', FIN.input('pr-q', { value: st.search || '', placeholder: 'Search by title, SKU, or slug' }))}
        <div><button class="fin-btn" onclick="FIN.store.prLoad()">🔍</button> <button class="fin-btn plain" onclick="FIN.store.prReset()">Reset</button></div></div>
        <div class="fin-actions" style="justify-content:flex-end;margin-top:12px"><button class="fin-btn" onclick="FIN.store.prEdit()">+ New Product</button><button class="fin-btn outline" onclick="FIN.store.prImport()">⤓ Bulk Import</button></div></div>
      <div id="pr-table"></div></div>`;
    prLoad();
  });
  async function prLoad() {
    const st = S.prod;
    Object.assign(st, { status: val('pr-status'), visibility: val('pr-vis'), type: val('pr-type'), categoryId: val('pr-cat'), search: val('pr-q') });
    const d = await FIN.get(`/api/admin/store/products${FIN.qs(st)}`);
    S.prodRows = d.products;
    S.prTable = table(document.getElementById('pr-table'), { title: 'Storefront Products', rows: d.products, selectable: true, perPage: 25, emptyText: 'No products match the selected filters.<br><button class="fin-btn sm" style="margin-top:8px" onclick="FIN.store.prEdit()">+ Create your first product</button>',
      toolbar: () => FIN.menuButton('Bulk actions', [{ label: 'Bulk Update Products', onClick: prBulkUpdate }, { label: 'Apply Bulk Discount', onClick: prBulkDiscount }, { label: 'Remove Bulk Discount', onClick: () => prBulk({ action: 'remove_discount' }) }]),
      columns: [
        { key: 'img', label: 'Image', sortable: false, noExport: true, render: r => (r.imagePath ? `<img src="${img(r.imagePath)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : '<div style="width:40px;height:40px;border-radius:6px;background:var(--black-3)"></div>') },
        { key: 'name', label: 'Title', render: r => `<b>${esc(r.name)}</b>${r.discountPct ? ` ${badge(`-${r.discountPct}%`, 'red')}` : ''}` },
        { key: 'sku', label: 'SKU', render: r => esc(r.sku || '—') },
        { key: 'stockQty', label: 'Inventory', num: true, render: r => (r.productType === 'digital' ? '<span class="muted">Digital</span>' : `<span style="color:${r.lowStock ? 'var(--red)' : 'inherit'}">${r.stockQty} ${esc(r.unit || '')}</span>`) },
        { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), statusColor(r.status)) },
        { key: 'visibility', label: 'Visibility', render: r => badge(FIN.cap(r.visibility), statusColor(r.visibility)) },
        { key: 'price', label: 'Price', num: true, render: r => `${money(r.salePrice)}${r.discountPct ? `<div class="muted"><s>${money(r.price)}</s></div>` : ''}`, exportValue: r => r.price },
        { key: 'categoryName', label: 'Categories', render: r => esc(r.categoryName || '—') },
        { key: 'updatedAt', label: 'Updated', render: r => `<span class="muted">${dateTime(r.updatedAt)}</span>` },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.menu(this,[{label:'Edit',onClick:()=>FIN.store.prEdit(${r.id})},{label:'Adjust Stock',onClick:()=>FIN.store.adjust(${r.id})},{label:'Delete / Archive',danger:true,onClick:()=>FIN.store.prDelete(${r.id})}])">⋯</button>` },
      ] });
  }
  function prEdit(id) {
    const p = id ? S.prodRows.find(x => x.id === id) : { status: 'published', visibility: 'public', productType: 'physical', unit: 'piece' };
    modal({ title: id ? 'Edit Product' : 'New Product', size: 'wide', body: `<div class="fin-grid two">
        ${field('Title', FIN.input('pe-name', { value: p.name || '' }), { required: true })}${field('SKU / Barcode', FIN.input('pe-sku', { value: p.sku || '' }))}
        ${field('Category', select('pe-cat', S.cats.map(c => [c.id, c.name]), p.categoryId || '', 'None'))}${field('Type', select('pe-type', [['physical', 'Physical Product'], ['digital', 'Digital Product']], p.productType))}
        ${field('Selling Price (₦)', FIN.input('pe-price', { type: 'number', value: p.price || '' }), { required: true })}${field('Cost Price (₦)', FIN.input('pe-cost', { type: 'number', value: p.cost || '' }))}
        ${field('Discount %', FIN.input('pe-disc', { type: 'number', value: p.discountPct || 0 }))}${field('Unit', FIN.input('pe-unit', { value: p.unit || 'piece' }))}
        ${id ? '' : field('Opening Stock', FIN.input('pe-stock', { type: 'number', value: 0 }))}${field('Low Stock Level (re-order at)', FIN.input('pe-reorder', { type: 'number', value: p.reorderLevel || 0 }))}
        ${field('Status', select('pe-status', [['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']], p.status))}${field('Visibility', select('pe-vis', [['public', 'Public'], ['logged_in', 'Logged-In only'], ['private', 'Private']], p.visibility))}
        ${field('Description', `<textarea class="field-input" id="pe-desc" rows="3">${esc(p.description || '')}</textarea>`, { span: 2 })}
        ${field('Image', `<input type="file" class="field-input" id="pe-img" accept=".png,.jpg,.jpeg">${p.imagePath ? `<label class="fin-check" style="margin-top:6px"><input type="checkbox" id="pe-rmimg"> Remove current image</label>` : ''}`, { span: 2, hint: 'PNG or JPG' })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const body = { name: val('pe-name'), sku: val('pe-sku'), categoryId: val('pe-cat'), productType: val('pe-type'), price: val('pe-price'), cost: val('pe-cost'), discountPct: val('pe-disc'), unit: val('pe-unit'),
          stockQty: id ? undefined : val('pe-stock'), reorderLevel: val('pe-reorder'), status: val('pe-status'), visibility: val('pe-vis'), description: val('pe-desc'),
          image: await FIN.fileToDataUrl(document.getElementById('pe-img')), removeImage: id && document.getElementById('pe-rmimg') ? val('pe-rmimg') : false };
        await FIN.api(id ? `/api/admin/store/products/${id}` : '/api/admin/store/products', { method: id ? 'PUT' : 'POST', body });
        showToast('Product saved'); close(); prLoad();
      } }] });
  }
  async function prDelete(id) {
    if (!await FIN.confirm('Delete this product? (Products already sold are archived instead.)')) return;
    const r = await FIN.del(`/api/admin/store/products/${id}`);
    showToast(r.archived ? 'Product archived (it has sales)' : 'Product deleted'); prLoad();
  }
  async function prBulk(body) {
    const ids = S.prTable.picked();
    if (!ids.length) return showToast('Tick at least one product');
    const r = await FIN.post('/api/admin/store/products/bulk', { ids, ...body });
    showToast(`${r.count} product(s) updated`); prLoad();
  }
  function prBulkUpdate() {
    modal({ title: 'Bulk Update Products', body: `<div class="fin-grid two">${field('Status', select('bu-status', [['', 'No change'], ['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']], ''))}${field('Visibility', select('bu-vis', [['', 'No change'], ['public', 'Public'], ['logged_in', 'Logged-In only'], ['private', 'Private']], ''))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Update Products', onClick: async (o, close) => { await prBulk({ action: 'update', status: val('bu-status'), visibility: val('bu-vis') }); close(); } }] });
  }
  function prBulkDiscount() {
    modal({ title: 'Apply Bulk Discount', body: field('Discount Percentage', FIN.input('bd-pct', { type: 'number', attrs: 'min="1" max="100"' }), { required: true }),
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Apply Discount', onClick: async (o, close) => { await prBulk({ action: 'discount', pct: val('bd-pct') }); close(); } }] });
  }
  function prImport() {
    const headers = ['Title', 'SKU', 'Category', 'Price', 'Cost', 'Stock', 'Reorder Level', 'Unit'];
    modal({ title: 'Bulk Import Products', body: `<div class="fin-note">An .xlsx file with columns <b>${headers.join(', ')}</b>. "Title" and "Price" are required; new categories are created; products whose SKU already exists are skipped.
        <a href="javascript:void(0)" onclick="FIN.exportRows('xlsx',{title:'products import template',headers:${JSON.stringify(headers).replace(/"/g, '&quot;')},rows:[['Exercise Book','EXB-01','Stationery','500','300','100','20','piece']]})">Download the template</a></div>
      <div style="margin-top:12px">${field('Excel file (.xlsx)', '<input type="file" class="field-input" id="pi-file" accept=".xlsx">', { required: true })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Import', onClick: async (o, close) => { const file = await FIN.fileToDataUrl(document.getElementById('pi-file')); const r = await FIN.api('/api/admin/store/products/import', { method: 'POST', body: { file } }); showToast(`${r.added} product(s) imported`); close(); prLoad(); } }] });
  }
  async function adjust(id) {
    const p = (S.prodRows || S.invProducts || []).find(x => x.id === id) || (await FIN.get('/api/admin/store/products?status=all')).products.find(x => x.id === id);
    modal({ title: `Stock Adjustment — ${esc(p.name)}`, body: `<div class="fin-note" style="margin-bottom:10px">Current stock: <b>${p.stockQty}</b></div><div class="fin-grid two">
        ${field('Direction', select('sa-dir', [['1', 'Add stock (+)'], ['-1', 'Remove stock (−)']], '1'))}${field('Quantity', FIN.input('sa-qty', { type: 'number', attrs: 'min="1"' }), { required: true })}
        ${field('Reason', select('sa-reason', ['Stock count correction', 'Damaged', 'Expired', 'Lost / stolen', 'Write-off', 'Returned by customer', 'Found in count'], 'Stock count correction'))}${field('Reference', FIN.input('sa-ref'))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save Adjustment', onClick: async (o, close) => {
        await FIN.post(`/api/admin/store/products/${id}/stock-adjust`, { delta: Number(val('sa-dir')) * Number(val('sa-qty')), reason: val('sa-reason'), reference: val('sa-ref') });
        showToast('Stock adjusted'); close(); if (document.getElementById('pr-table')) prLoad(); if (document.getElementById('inv-body')) invDraw();
      } }] });
  }

  // ══ Categories ════════════════════════════════════════════════════════
  FIN.page('categories', async el => {
    const st = S.cat;
    el.innerHTML = `${FIN.header('Storefront Product Categories')}
      <div class="fin-card"><div class="fin-card-body"><div class="fin-grid">${field('Status', select('ca-status', [['active', 'Active (Draft | Published)'], ['draft', 'Draft only'], ['published', 'Published only'], ['archived', 'Archived only'], ['all', 'All statuses']], st.status))}
        ${field('Visibility', select('ca-vis', [['', 'All visibility options'], ['public', 'Public'], ['logged_in', 'Logged-In only'], ['private', 'Private']], st.visibility || ''))}
        <div><button class="fin-btn" onclick="FIN.store.caLoad()">🔍</button></div></div><div class="fin-actions" style="justify-content:flex-end;margin-top:12px"><button class="fin-btn" onclick="FIN.store.caEdit()">+ New Category</button></div></div>
      <div id="ca-table"></div></div>`;
    caLoad();
  });
  async function caLoad() {
    Object.assign(S.cat, { status: val('ca-status'), visibility: val('ca-vis') });
    const d = await FIN.get(`/api/admin/store/categories${FIN.qs(S.cat)}`);
    S.catRows = d.categories;
    table(document.getElementById('ca-table'), { title: 'Product Categories', rows: d.categories, perPage: 50, emptyText: 'No categories match the selected filters.<br><button class="fin-btn sm" style="margin-top:8px" onclick="FIN.store.caEdit()">+ Create your first category</button>',
      columns: [
        { key: 'order', label: '⇕', sortable: false, noExport: true, render: (r, i) => `<button class="fin-btn plain sm" title="Move up" onclick="FIN.store.caMove(${r.id},-1)">↑</button><button class="fin-btn plain sm" title="Move down" onclick="FIN.store.caMove(${r.id},1)">↓</button>` },
        { key: 'name', label: 'Name', render: r => `<b>${esc(r.name)}</b><div class="muted">${esc(r.description || '')}</div>` }, { key: 'productCount', label: 'Products', num: true },
        { key: 'visibility', label: 'Visibility', render: r => badge(FIN.cap(r.visibility), statusColor(r.visibility)) }, { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), statusColor(r.status)) },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.store.caEdit(${r.id})">Edit</button> <button class="fin-btn red sm" onclick="FIN.store.caDelete(${r.id})">✕</button>` }] });
  }
  function caEdit(id) {
    const c = id ? S.catRows.find(x => x.id === id) : { status: 'published', visibility: 'public' };
    modal({ title: id ? 'Edit Category' : 'New Category', body: `<div class="fin-grid two">${field('Name', FIN.input('ce-name', { value: c.name || '' }), { required: true })}${field('Status', select('ce-status', [['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']], c.status))}
      ${field('Visibility', select('ce-vis', [['public', 'Public'], ['logged_in', 'Logged-In only'], ['private', 'Private']], c.visibility))}${field('Description', FIN.input('ce-desc', { value: c.description || '' }))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { name: val('ce-name'), status: val('ce-status'), visibility: val('ce-vis'), description: val('ce-desc') }; id ? await FIN.put(`/api/admin/store/categories/${id}`, b) : await FIN.post('/api/admin/store/categories', b); showToast('Category saved'); close(); caLoad(); } }] });
  }
  async function caMove(id, dir) {
    const ids = S.catRows.map(c => c.id);
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await FIN.post('/api/admin/store/categories/reorder', { ids }); caLoad();
  }
  async function caDelete(id) { if (!await FIN.confirm('Delete this category? Its products become uncategorised.')) return; await FIN.del(`/api/admin/store/categories/${id}`); showToast('Category deleted'); caLoad(); }

  // ══ Inventory & Supply ════════════════════════════════════════════════
  const INV_TABS = [['movement', '⇄ Stock Movement'], ['valuation', '▤ Stock Valuation'], ['low', '⚠ Low Stock'], ['adjust', '⊙ Stock Adjustment'], ['po', '🗎 Purchase Orders'], ['grn', '⤓ Goods Received'], ['bills', '🗎 Vendor Bills'], ['vendors', '☷ Contacts (Vendors)']];
  FIN.page('inventorySupply', async el => {
    el.innerHTML = `${FIN.header('Inventory Supply')}<div class="fin-side">${FIN.sideNav('inv', INV_TABS, S.inv.tab, k => { S.inv.tab = k; invDraw(); })}<div class="fin-card" style="margin:0"><div id="inv-body"></div></div></div>`;
    invDraw();
  });
  async function movementView(box, prefix, st) {
    box.innerHTML = `<div class="fin-card-body"><div class="fin-grid">${field('', FIN.input(`${prefix}-q`, { value: st.q || '', placeholder: 'Product, SKU, reason…' }))}${field('', select(`${prefix}-type`, MOVE_TYPES, st.type || ''))}
      ${field('', FIN.input(`${prefix}-from`, { type: 'date', value: st.from || '' }))}${field('', FIN.input(`${prefix}-to`, { type: 'date', value: st.to || '' }))}<div><button class="fin-btn sm" onclick="FIN.store.mvLoad('${prefix}')">⟳</button></div></div></div><div id="${prefix}-table"></div>`;
    S[`${prefix}St`] = st;
    mvLoad(prefix);
  }
  async function mvLoad(prefix) {
    const st = S[`${prefix}St`];
    Object.assign(st, { q: val(`${prefix}-q`), type: val(`${prefix}-type`), from: val(`${prefix}-from`), to: val(`${prefix}-to`) });
    const d = await FIN.get(`/api/admin/store/stock-movements${FIN.qs({ search: st.q, type: st.type, from: st.from, to: st.to })}`);
    table(document.getElementById(`${prefix}-table`), { title: 'Stock Movement', rows: d.movements, perPage: 25, exportFormats: ['csv', 'xlsx'], emptyText: 'No stock movements recorded yet.', columns: [
      { key: 'createdAt', label: 'Date', render: r => dateTime(r.createdAt) }, { key: 'productName', label: 'Product' }, { key: 'sku', label: 'SKU', render: r => esc(r.sku || '—') },
      { key: 'type', label: 'Type', render: r => badge(FIN.cap(r.type), r.changeQty > 0 ? 'green' : 'red') }, { key: 'reference', label: 'Reference', render: r => esc(r.reference || '—') },
      { key: 'changeQty', label: 'Change', num: true, render: r => `<b style="color:${r.changeQty > 0 ? 'var(--green)' : 'var(--red)'}">${r.changeQty > 0 ? '+' : ''}${r.changeQty}</b>` },
      { key: 'balance', label: 'Balance', num: true, render: r => (r.balance == null ? '—' : r.balance) }, { key: 'value', label: 'Value', num: true, render: r => money(r.value), exportValue: r => r.value },
      { key: 'reason', label: 'Reason', render: r => `${esc(r.reason || '')}<div class="muted">${esc(r.createdByName || '')}</div>` }] });
  }
  function valuationTable(el, list, title = 'Stock Valuation') {
    table(el, { title, rows: list, perPage: 25, emptyText: 'No tracked products found.', columns: [
      { key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU', render: r => esc(r.sku || '—') }, { key: 'categoryName', label: 'Category', render: r => esc(r.categoryName || '—') }, { key: 'unit', label: 'UoM' },
      { key: 'stockQty', label: 'Qty on Hand', num: true, total: rows => rows.reduce((a, r) => a + r.stockQty, 0) }, { key: 'cost', label: 'Unit Cost', num: true, render: r => money(r.cost), exportValue: r => r.cost },
      { key: 'stockValue', label: 'Total Value', num: true, render: r => money(r.stockValue), exportValue: r => r.stockValue, total: true },
      { key: 'status', label: 'Status', render: r => (r.lowStock ? badge('Low stock', 'red') : badge('OK', 'green')), exportValue: r => (r.lowStock ? 'Low stock' : 'OK') }] });
  }
  async function invDraw() {
    const box = document.getElementById('inv-body');
    const tab = S.inv.tab;
    if (tab === 'movement') return movementView(box, 'mv', S.mvSt || {});
    if (tab === 'valuation' || tab === 'low' || tab === 'adjust') {
      const d = await FIN.get('/api/admin/store/products?status=all');
      const list = d.products.filter(p => p.productType !== 'digital');
      S.invProducts = list;
      if (tab === 'adjust') {
        box.innerHTML = '<div class="fin-card-body"><b>Stock Adjustment</b><div class="muted">Pick a product to add or remove stock (counts, damages, write-offs). Every adjustment shows in Stock Movement.</div></div><div id="inv-t"></div>';
        return table(document.getElementById('inv-t'), { title: 'Stock Adjustment', rows: list, perPage: 25, columns: [
          { key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU', render: r => esc(r.sku || '—') }, { key: 'stockQty', label: 'On Hand', num: true }, { key: 'reorderLevel', label: 'Reorder Level', num: true },
          { key: 'a', label: '', sortable: false, noExport: true, render: r => `<button class="fin-btn outline sm" onclick="FIN.store.adjust(${r.id})">Adjust</button>` }] });
      }
      const rows = tab === 'low' ? list.filter(p => p.lowStock) : list;
      const totals = { n: rows.length, u: rows.reduce((a, r) => a + r.stockQty, 0), v: rows.reduce((a, r) => a + r.stockValue, 0) };
      box.innerHTML = `<div class="fin-card-body"><b>${tab === 'low' ? 'Low Stock' : 'Stock Valuation'}</b> <span class="muted">Products: ${totals.n} · Total Units: ${totals.u} · Total Value: ${money(totals.v)}</span></div><div id="inv-t"></div>`;
      return valuationTable(document.getElementById('inv-t'), rows, tab === 'low' ? 'Low Stock' : 'Stock Valuation');
    }
    if (tab === 'po') {
      const d = await FIN.get('/api/admin/store/purchase-orders');
      S.pos2 = d.orders;
      box.innerHTML = `<div class="fin-card-head"><div class="fin-card-title">Purchase Orders</div><button class="fin-btn sm" onclick="FIN.store.poEdit()">+ New Purchase Order</button></div><div id="inv-t"></div>`;
      return table(document.getElementById('inv-t'), { title: 'Purchase Orders', rows: d.orders, perPage: 25, emptyText: 'No purchase orders found.', columns: [
        { key: 'poCode', label: 'PO Code' }, { key: 'vendor', label: 'Vendor' }, { key: 'orderDate', label: 'Order Date', render: r => date(r.orderDate) }, { key: 'expectedDate', label: 'Expected Delivery', render: r => date(r.expectedDate) },
        { key: 'status', label: 'Status', render: r => badge(FIN.cap(r.status), { draft: 'grey', sent: 'blue', partially_received: 'amber', received: 'green', cancelled: 'red', closed: 'grey' }[r.status]) },
        { key: 'total', label: 'Total Value', num: true, render: r => money(r.total), exportValue: r => r.total, total: true },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.store.poMenu(this, ${r.id})">⋯</button>` }] });
    }
    if (tab === 'grn') {
      const d = await FIN.get('/api/admin/store/grns');
      S.grns = d.grns;
      box.innerHTML = `<div class="fin-card-head"><div class="fin-card-title">Goods Received Notes (GRN)</div><button class="fin-btn sm" onclick="FIN.store.grnEdit()">+ New GRN</button></div><div id="inv-t"></div>`;
      return table(document.getElementById('inv-t'), { title: 'Goods Received Notes', rows: d.grns, perPage: 25, emptyText: 'No goods received notes found.', columns: [
        { key: 'grnCode', label: 'GRN Code' }, { key: 'vendor', label: 'Vendor' }, { key: 'poCode', label: 'PO Reference', render: r => esc(r.poCode || '—') }, { key: 'receiptDate', label: 'Receipt Date', render: r => date(r.receiptDate) },
        { key: 'status', label: 'Status', render: r => badge(r.status === 'posted' ? 'Posted' : 'Draft', r.status === 'posted' ? 'green' : 'amber') },
        { key: 'total', label: 'Total Value', num: true, render: r => money(r.total), exportValue: r => r.total, total: true }, { key: 'postedAt', label: 'Posted At', render: r => (r.postedAt ? dateTime(r.postedAt) : '—') },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => (r.status === 'posted' ? `<button class="fin-btn plain sm" onclick="FIN.store.grnView(${r.id})">View</button>` : `<button class="fin-btn green sm" onclick="FIN.store.grnPost(${r.id})">Post (Receive)</button> <button class="fin-btn red sm" onclick="FIN.store.grnDelete(${r.id})">✕</button>`) }] });
    }
    if (tab === 'bills') { box.innerHTML = '<div id="inv-t"></div>'; return FIN.acct.billsView(document.getElementById('inv-t'), 'bill', () => invDraw()); }
    if (tab === 'vendors') { box.innerHTML = '<div id="inv-t"></div>'; return FIN.acct.contactsView(document.getElementById('inv-t'), 'vendor', () => invDraw()); }
  }
  async function vendorsAndProducts() {
    const [c, p] = await Promise.all([FIN.get('/api/admin/acct/contacts?type=vendor'), FIN.get('/api/admin/store/products?status=all')]);
    return { vendors: c.contacts.filter(v => v.status === 'active'), products: p.products.filter(x => x.productType !== 'digital') };
  }
  const lineRow = (products, l = {}) => `<tr><td><select class="ctrl-select" data-k="productId">${options(products.map(p => [p.id, `${p.name}${p.sku ? ` (${p.sku})` : ''}`]), l.productId || '', 'Product')}</select></td>
    <td><input class="field-input" type="number" min="1" data-k="qty" value="${l.qty || ''}"></td><td><input class="field-input" type="number" min="0" step="0.01" data-k="unitCost" value="${l.unitCost || ''}"></td><td><button class="fin-btn red sm" onclick="this.closest('tr').remove()">✕</button></td></tr>`;
  const readLines = id => [...document.querySelectorAll(`#${id} tr`)].map(tr => ({ productId: tr.querySelector('[data-k=productId]').value, qty: tr.querySelector('[data-k=qty]').value, unitCost: tr.querySelector('[data-k=unitCost]').value })).filter(x => x.productId);
  async function poEdit(id) {
    const { vendors, products } = await vendorsAndProducts();
    if (!vendors.length) return showToast('Add a vendor first (Contacts (Vendors))');
    const po = id ? S.pos2.find(x => x.id === id) : { items: [] };
    S.lineRow = l => lineRow(products, l);
    modal({ title: id ? `Edit ${esc(po.poCode)}` : 'New Purchase Order', size: 'wide', body: `<div class="fin-grid">${field('Vendor', select('po-vendor', vendors.map(v => [v.id, v.name]), po.contactId || '', 'Select'), { required: true })}
        ${field('Order Date', FIN.input('po-date', { type: 'date', value: po.orderDate || FIN.today() }))}${field('Expected Delivery', FIN.input('po-exp', { type: 'date', value: po.expectedDate || '' }))}${field('Notes', FIN.input('po-notes', { value: po.notes || '' }))}</div>
      <table class="fin-table fin-lines" style="margin-top:12px"><thead><tr><th>Product</th><th style="width:100px">Qty</th><th style="width:130px">Unit Cost</th><th></th></tr></thead><tbody id="po-lines">${(po.items.length ? po.items : [{}]).map(l => lineRow(products, l)).join('')}</tbody></table>
      <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('po-lines').insertAdjacentHTML('beforeend', FIN.store._line())">+ Add Line</button>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => { const b = { contactId: val('po-vendor'), orderDate: val('po-date'), expectedDate: val('po-exp'), notes: val('po-notes'), items: readLines('po-lines') }; id ? await FIN.put(`/api/admin/store/purchase-orders/${id}`, b) : await FIN.post('/api/admin/store/purchase-orders', b); showToast('Purchase order saved'); close(); invDraw(); } }] });
  }
  function poMenu(btn, id) {
    const po = S.pos2.find(x => x.id === id);
    const set = status => async () => { await FIN.post(`/api/admin/store/purchase-orders/${id}/status`, { status }); showToast('Purchase order updated'); invDraw(); };
    FIN.menu(btn, [
      { label: 'View / Print', onClick: () => FIN.print(po.poCode, `${FIN.schoolHeader()}<h3>PURCHASE ORDER ${esc(po.poCode)}</h3><p>Vendor: <b>${esc(po.vendor)}</b> · Date: ${date(po.orderDate)} · Expected: ${date(po.expectedDate)}</p><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Total</th></tr></thead><tbody>${po.items.map(i => `<tr><td>${esc(i.productName || i.description)}</td><td class="num">${i.qty}</td><td class="num">${money(i.unitCost)}</td><td class="num">${money(i.qty * i.unitCost)}</td></tr>`).join('')}</tbody></table><h3 style="text-align:right">Total: ${money(po.total)}</h3>`) },
      ...(po.status === 'draft' ? [{ label: 'Edit', onClick: () => poEdit(id) }, { label: 'Mark as Sent', onClick: set('sent') }] : []),
      ...(['sent', 'partially_received'].includes(po.status) ? [{ label: 'Receive Goods (GRN)', onClick: () => grnEdit(id) }] : []),
      ...(!['received', 'cancelled', 'closed'].includes(po.status) ? [{ label: 'Cancel', danger: true, onClick: set('cancelled') }] : []),
      ...(po.status === 'draft' ? [{ label: 'Delete', danger: true, onClick: async () => { await FIN.del(`/api/admin/store/purchase-orders/${id}`); showToast('Deleted'); invDraw(); } }] : []),
    ]);
  }
  async function grnEdit(poId) {
    const { vendors, products } = await vendorsAndProducts();
    const po = poId ? (S.pos2 || []).find(x => x.id === poId) : null;
    const lines = po ? po.items.filter(i => i.productId).map(i => ({ productId: i.productId, qty: Math.max(0, i.qty - i.received), unitCost: i.unitCost })) : [{}];
    S.lineRow = l => lineRow(products, l);
    modal({ title: po ? `Receive Goods for ${esc(po.poCode)}` : 'New Goods Received Note', size: 'wide', body: `<div class="fin-grid">${field('Vendor', select('gr-vendor', vendors.map(v => [v.id, v.name]), po ? po.contactId : '', 'Select'), { required: true })}
        ${field('Receipt Date', FIN.input('gr-date', { type: 'date', value: FIN.today() }))}${field('Notes', FIN.input('gr-notes'))}</div>
      <table class="fin-table fin-lines" style="margin-top:12px"><thead><tr><th>Product</th><th style="width:100px">Qty Received</th><th style="width:130px">Unit Cost</th><th></th></tr></thead><tbody id="gr-lines">${lines.map(l => lineRow(products, l)).join('')}</tbody></table>
      <button class="fin-btn plain sm" style="margin-top:8px" onclick="document.getElementById('gr-lines').insertAdjacentHTML('beforeend', FIN.store._line())">+ Add Line</button>
      <div class="fin-note" style="margin-top:12px">Saving creates a <b>draft</b> GRN. <b>Posting</b> it adds the quantities to stock, updates the average cost and raises the vendor bill.</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save Draft', onClick: async (o, close) => { await FIN.post('/api/admin/store/grns', { poId, contactId: val('gr-vendor'), receiptDate: val('gr-date'), notes: val('gr-notes'), items: readLines('gr-lines') }); showToast('GRN saved as draft'); close(); S.inv.tab = 'grn'; FIN.open('inventorySupply'); } }] });
  }
  async function grnPost(id) { if (!await FIN.confirm('Post this GRN? Stock goes up and a vendor bill is raised.')) return; await FIN.post(`/api/admin/store/grns/${id}/post`); showToast('GRN posted — stock received'); invDraw(); }
  async function grnDelete(id) { await FIN.del(`/api/admin/store/grns/${id}`); showToast('Deleted'); invDraw(); }
  function grnView(id) {
    const g = S.grns.find(x => x.id === id);
    modal({ title: `${esc(g.grnCode)} — ${esc(g.vendor)}`, body: `<table class="fin-table"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Total</th></tr></thead><tbody>${g.items.map(i => `<tr><td>${esc(i.productName)}</td><td class="num">${i.qty}</td><td class="num">${money(i.unitCost)}</td><td class="num">${money(i.qty * i.unitCost)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">${money(g.total)}</td></tr></tfoot></table>`, buttons: [{ label: 'Close', cls: 'plain' }] });
  }

  // ══ Inventory Reports ═════════════════════════════════════════════════
  const REP_TABS = [['movement', 'Stock Movement'], ['valuation', 'Stock Valuation'], ['requisition', 'Requisition Analysis'], ['adjustments', 'Stock Adjustments'], ['grn', 'GRN / Receipts'], ['low', 'Low Stock'], ['shifts', 'POS Shifts']];
  FIN.page('inventoryReports', async el => {
    el.innerHTML = `${FIN.header('Inventory Reports')}<div class="fin-card">${FIN.tabs('rep', REP_TABS, S.rep.tab, k => { S.rep.tab = k; repDraw(); })}<div id="rep-body"></div></div>`;
    repDraw();
  });
  async function repDraw() {
    const box = document.getElementById('rep-body');
    const tab = S.rep.tab;
    if (tab === 'movement') return movementView(box, 'rmv', S.rmvSt || {});
    if (tab === 'adjustments') return movementView(box, 'radj', { ...(S.radjSt || {}), type: 'adjustment' });
    const d = await FIN.get('/api/admin/store/reports');
    if (tab === 'valuation') { box.innerHTML = `<div class="fin-card-body"><span class="muted">Products: ${d.totals.products} · Total Units: ${d.totals.units} · Total Value: ${money(d.totals.value)}</span></div><div id="rep-t"></div>`; return valuationTable(document.getElementById('rep-t'), d.valuation); }
    if (tab === 'low') { box.innerHTML = '<div id="rep-t"></div>'; return valuationTable(document.getElementById('rep-t'), d.lowStock, 'Low Stock'); }
    if (tab === 'shifts') { box.innerHTML = '<div id="rep-t"></div>'; return shiftTable(document.getElementById('rep-t'), d.shifts); }
    if (tab === 'requisition') {
      box.innerHTML = '<div id="rep-t"></div>';
      return table(document.getElementById('rep-t'), { title: 'Requisition Analysis', rows: d.requisitions, rowKey: 'department', perPage: 25, columns: [
        { key: 'department', label: 'Department' }, { key: 'requests', label: 'Requests', num: true, total: rows => rows.reduce((a, r) => a + r.requests, 0) }, { key: 'pending', label: 'Pending', num: true },
        { key: 'requested', label: 'Qty Requested', num: true, total: rows => rows.reduce((a, r) => a + r.requested, 0) }, { key: 'issued', label: 'Qty Issued', num: true, total: rows => rows.reduce((a, r) => a + r.issued, 0) }] });
    }
    if (tab === 'grn') {
      const g = await FIN.get('/api/admin/store/grns?status=posted');
      box.innerHTML = '<div id="rep-t"></div>';
      return table(document.getElementById('rep-t'), { title: 'GRN / Receipts', rows: g.grns, perPage: 25, columns: [
        { key: 'grnCode', label: 'GRN' }, { key: 'vendor', label: 'Vendor' }, { key: 'poCode', label: 'PO', render: r => esc(r.poCode || '—') }, { key: 'receiptDate', label: 'Receipt Date', render: r => date(r.receiptDate) },
        { key: 'items', label: 'Items', render: r => r.items.map(i => `${esc(i.productName)} × ${i.qty}`).join('<br>'), exportValue: r => r.items.map(i => `${i.productName} x ${i.qty}`).join('; ') },
        { key: 'total', label: 'Total Value', num: true, render: r => money(r.total), exportValue: r => r.total, total: true }] });
    }
  }

  // ══ Store Settings ════════════════════════════════════════════════════
  FIN.page('storeSettings', async el => {
    const s = await FIN.get('/api/admin/store/settings');
    el.innerHTML = `${FIN.header('Store Settings')}${card('⚙ Store Settings', `<div class="fin-grid two">
        ${field('Store Name', FIN.input('ss-name', { value: s.storeName }), { required: true })}${field('Currency', FIN.input('ss-cur', { value: s.currency }))}
        ${field('Store Status', select('ss-open', [['1', 'Open — taking orders'], ['0', 'Closed']], s.storeOpen ? '1' : '0'))}${field('Low Stock Threshold (default)', FIN.input('ss-low', { type: 'number', value: s.lowStockThreshold }))}
        ${field('Store Tax Rate (%)', FIN.input('ss-tax', { type: 'number', value: s.taxRate }), { hint: 'Shown as tax included on POS sales' })}${field('Contact Email', FIN.input('ss-email', { value: s.contactEmail }))}
        ${field('Contact Phone', FIN.input('ss-phone', { value: s.contactPhone }))}${field('Pickup', select('ss-pickup', [['1', 'Enabled'], ['0', 'Disabled']], s.pickupEnabled ? '1' : '0'))}
        ${field('Delivery', select('ss-deliv', [['1', 'Enabled'], ['0', 'Disabled']], s.deliveryEnabled ? '1' : '0'))}${field('Delivery Fee (₦)', FIN.input('ss-fee', { type: 'number', value: s.deliveryFee }))}
        ${field('About the Store (shown on the storefront)', `<textarea class="field-input" id="ss-about" rows="3">${esc(s.about)}</textarea>`, { span: 2 })}${field('Receipt Footer', FIN.input('ss-footer', { value: s.receiptFooter }), { span: 2 })}
      </div><button class="fin-btn" style="margin-top:14px" onclick="FIN.store.ssSave()">💾 Save Settings</button>`)}`;
  });
  async function ssSave() {
    await FIN.put('/api/admin/store/settings', { storeName: val('ss-name'), currency: val('ss-cur'), storeOpen: val('ss-open') === '1', lowStockThreshold: val('ss-low'), taxRate: val('ss-tax'), contactEmail: val('ss-email'), contactPhone: val('ss-phone'),
      pickupEnabled: val('ss-pickup') === '1', deliveryEnabled: val('ss-deliv') === '1', deliveryFee: val('ss-fee'), about: val('ss-about'), receiptFooter: val('ss-footer') });
    showToast('Store settings saved');
  }

  // ══ Banners & Homepage Sections ═══════════════════════════════════════
  function contentPage(tab, kind) {
    const isB = kind === 'banners';
    FIN.page(tab, async el => {
      const d = await FIN.get(`/api/admin/store/${kind}`);
      const rows = isB ? d.banners : d.sections;
      S[kind] = rows;
      el.innerHTML = `${FIN.header(isB ? 'Storefront Banners' : 'Storefront Homepage Sections')}<div class="fin-card"><div class="fin-card-head"><div class="fin-card-title">${isB ? 'Promotional banners at the top of the storefront' : 'Sections shown on the storefront homepage'}</div><button class="fin-btn" onclick="FIN.store.contentEdit('${tab}','${kind}')">+ Add ${isB ? 'Banner' : 'Section'}</button></div><div id="${kind}-t"></div></div>`;
      table(document.getElementById(`${kind}-t`), { title: isB ? 'Storefront Banners' : 'Homepage Sections', rows, perPage: 25, columns: [
        ...(isB ? [{ key: 'img', label: 'Image', sortable: false, noExport: true, render: r => (r.imagePath || r.imageUrl ? `<img src="${r.imagePath ? img(r.imagePath) : esc(r.imageUrl)}" style="width:80px;height:40px;object-fit:cover;border-radius:4px">` : '—') }] : []),
        { key: 'title', label: 'Title', render: r => `<b>${esc(r.title)}</b><div class="muted">${esc(isB ? r.subtitle || '' : r.content || '').slice(0, 120)}</div>` },
        ...(isB ? [{ key: 'linkUrl', label: 'Link', render: r => esc(r.linkUrl || '—') }] : [{ key: 'sectionType', label: 'Type', render: r => esc(FIN.cap(r.sectionType)) }]),
        { key: 'sortOrder', label: 'Sort Order', num: true }, { key: 'isActive', label: 'Status', render: r => badge(r.isActive ? 'Active' : 'Hidden', r.isActive ? 'green' : 'grey') },
        { key: 'a', label: 'Actions', sortable: false, noExport: true, render: r => `<button class="fin-btn plain sm" onclick="FIN.store.contentEdit('${tab}','${kind}',${r.id})">Edit</button> <button class="fin-btn red sm" onclick="FIN.store.contentDelete('${tab}','${kind}',${r.id})">✕</button>` }] });
    });
  }
  function contentEdit(tab, kind, id) {
    const isB = kind === 'banners';
    const r = id ? S[kind].find(x => x.id === id) : { isActive: true, sortOrder: S[kind].length + 1, sectionType: 'featured' };
    modal({ title: `${id ? 'Edit' : 'Add'} ${isB ? 'Banner' : 'Section'}`, body: `<div class="fin-grid two">${field('Title', FIN.input('ct-title', { value: r.title || '' }), { required: true, span: 2 })}
      ${isB ? `${field('Subtitle', FIN.input('ct-sub', { value: r.subtitle || '' }), { span: 2 })}${field('Image', '<input type="file" class="field-input" id="ct-img" accept=".png,.jpg,.jpeg">', { hint: 'PNG or JPG; or give an image link' })}${field('Image Link (optional)', FIN.input('ct-imgurl', { value: r.imageUrl || '' }))}${field('Button Link', FIN.input('ct-link', { value: r.linkUrl || '' }), { span: 2 })}`
        : `${field('Type', select('ct-type', [['featured', 'Featured Products'], ['new', 'New Arrivals'], ['category', 'Category Showcase'], ['text', 'Text / Announcement'], ['custom', 'Custom']], r.sectionType))}${field('Content', `<textarea class="field-input" id="ct-content" rows="3">${esc(r.content || '')}</textarea>`, { span: 2 })}`}
      ${field('Sort Order', FIN.input('ct-sort', { type: 'number', value: r.sortOrder }))}${field('Status', select('ct-active', [['1', 'Active'], ['0', 'Hidden']], r.isActive ? '1' : '0'))}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Save', onClick: async (o, close) => {
        const b = { title: val('ct-title'), sortOrder: val('ct-sort'), isActive: val('ct-active') === '1' };
        if (isB) Object.assign(b, { subtitle: val('ct-sub'), imageUrl: val('ct-imgurl'), linkUrl: val('ct-link'), image: await FIN.fileToDataUrl(document.getElementById('ct-img')) });
        else Object.assign(b, { sectionType: val('ct-type'), content: val('ct-content') });
        await FIN.api(`/api/admin/store/${kind}${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: b });
        showToast('Saved'); close(); FIN.open(tab);
      } }] });
  }
  async function contentDelete(tab, kind, id) { if (!await FIN.confirm('Delete this?')) return; await FIN.del(`/api/admin/store/${kind}/${id}`); showToast('Deleted'); FIN.open(tab); }
  contentPage('storefrontBanners', 'banners');
  contentPage('storefrontHomepageSections', 'homepage-sections');

  // ══ Internal Requisitions ═════════════════════════════════════════════
  FIN.page('internalRequisitions', async el => {
    el.innerHTML = `${FIN.header('Internal Requisitions')}<div class="fin-card"><div class="fin-card-body"><div class="fin-grid">${field('Status', select('rq-status', [['', 'All Statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['fulfilled', 'Issued / Fulfilled']], S.req.status || '', null, 'onchange="FIN.store.rqLoad()"'))}
      <div style="text-align:right"><button class="fin-btn" onclick="FIN.store.rqNew()">+ New Requisition</button></div></div><div class="muted" style="margin-top:8px">Requests for store items for use within the school (e.g. stationery for a class). Issuing a requisition takes the items out of stock.</div></div><div id="rq-t"></div></div>`;
    rqLoad();
  });
  async function rqLoad() {
    S.req.status = val('rq-status');
    const d = await FIN.get(`/api/admin/store/requisitions${FIN.qs({ status: S.req.status })}`);
    S.reqRows = d.requisitions;
    table(document.getElementById('rq-t'), { title: 'Internal Requisitions', rows: d.requisitions, perPage: 25, columns: [
      { key: '#', label: '#', sortable: false }, { key: 'itemDescription', label: 'Item', render: r => `${esc(r.productName || r.itemDescription)}${r.productId ? '' : `<div>${badge('Not a store product', 'grey')}</div>`}<div class="muted">${esc(r.reason || '')}</div>` },
      { key: 'quantity', label: 'Qty', num: true, render: r => `${r.quantity}${r.fulfilledQty ? `<div class="muted">issued ${r.fulfilledQty}</div>` : ''}` }, { key: 'department', label: 'Department', render: r => esc(r.department || '—') },
      { key: 'requestedByName', label: 'Requested By', render: r => `${esc(r.requestedByName || '')}<div class="muted">${date(r.createdAt)}</div>` },
      { key: 'status', label: 'Status', render: r => `${badge(r.status === 'fulfilled' ? 'Issued' : FIN.cap(r.status), { pending: 'amber', approved: 'blue', rejected: 'red', fulfilled: 'green' }[r.status])}${r.decidedByName ? `<div class="muted">${esc(r.decidedByName)}</div>` : ''}` },
      { key: 'a', label: 'Action', sortable: false, noExport: true, render: r => (r.status === 'pending' ? `<button class="fin-btn green sm" onclick="FIN.store.rqSet(${r.id},'approved')">Approve</button> <button class="fin-btn red sm" onclick="FIN.store.rqSet(${r.id},'rejected')">Reject</button>` : r.status === 'approved' ? `<button class="fin-btn sm" onclick="FIN.store.rqSet(${r.id},'fulfilled')">Issue Items</button>` : '—') }] });
  }
  async function rqNew() {
    const p = await FIN.get('/api/admin/store/products?status=all');
    modal({ title: 'New Requisition', body: `<div class="fin-grid two">${field('Store Product', select('rq-prod', p.products.filter(x => x.productType !== 'digital').map(x => [x.id, `${x.name} (${x.stockQty} in stock)`]), '', 'Not a store product — describe below'), { span: 2 })}
      ${field('Item Description', FIN.input('rq-desc', { placeholder: 'If not a store product' }), { span: 2 })}${field('Quantity', FIN.input('rq-qty', { type: 'number', attrs: 'min="1"' }), { required: true })}${field('Department', FIN.input('rq-dept', { placeholder: 'e.g. Year 3 / Admin' }))}${field('Reason', FIN.input('rq-reason'), { span: 2 })}</div>`,
      buttons: [{ label: 'Cancel', cls: 'plain' }, { label: 'Submit', onClick: async (o, close) => { await FIN.post('/api/admin/store/requisitions', { productId: val('rq-prod'), itemDescription: val('rq-desc'), quantity: val('rq-qty'), department: val('rq-dept'), reason: val('rq-reason') }); showToast('Requisition submitted'); close(); rqLoad(); } }] });
  }
  async function rqSet(id, status) {
    try { await FIN.put(`/api/admin/store/requisitions/${id}`, { status }); showToast(status === 'fulfilled' ? 'Items issued from stock' : `Requisition ${status}`); rqLoad(); } catch (err) { showToast(err.message); }
  }

  FIN.store = Object.assign(POS, { vsDraw, posProducts, ordLoad, ordReset: () => { S.ord = { status: 'all' }; FIN.open('ordersSales'); }, orderView, prLoad, prReset: () => { S.prod = { status: 'active' }; FIN.open('products'); }, prEdit, prDelete, prImport, adjust,
    caLoad, caEdit, caMove, caDelete, mvLoad, poEdit, poMenu, grnEdit, grnPost, grnDelete, grnView, ssSave, contentEdit, contentDelete, rqLoad, rqNew, rqSet, _line: () => S.lineRow({}) });
})();
