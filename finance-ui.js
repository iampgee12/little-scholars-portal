// Finance pages: shared toolkit (window.FIN). Every Finance tab panel is drawn
// by one of the finance-*-admin.js scripts, which register a page with
// FIN.page(tab, draw). This file holds what they share: money/date
// formatting, popups, dropdown menus, stat cards, filter fields, and the data
// table (search, records per page, paging, sorting, tick boxes, totals,
// export to DOC / CSV / XLS / XLSX and print).
(function () {
  const pages = {};
  const esc = v => escapeHtml(v == null ? '' : v);

  const css = `
  .fin-page { padding-bottom:30px; }
  .fin-crumb { font-size:11px; color:var(--text-3); margin:-6px 0 14px; }
  .fin-card { background:var(--black); border:1px solid var(--border); border-radius:var(--radius); margin-bottom:16px; }
  .fin-card-head { padding:13px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .fin-card-title { font-size:13px; font-weight:600; color:var(--text-1); display:flex; align-items:center; gap:8px; }
  .fin-card-body { padding:16px 18px; }
  .fin-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; align-items:end; }
  .fin-grid.two { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
  .fin-field label { display:block; font-size:12px; color:var(--text-2); margin-bottom:5px; font-weight:500; }
  .fin-field label .req { color:var(--red); }
  .fin-field .hint { font-size:11px; color:var(--text-3); margin-top:4px; }
  .fin-field .hint.warn { color:var(--amber); }
  .fin-btn { display:inline-flex; align-items:center; gap:6px; background:#0d6efd; color:#fff; border:1px solid #0d6efd; border-radius:var(--radius-sm); padding:8px 16px; font-family:'DM Sans',sans-serif; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; transition:all var(--transition); }
  .fin-btn:hover { background:#0b5ed7; }
  .fin-btn.outline { background:var(--black); color:#0d6efd; }
  .fin-btn.outline:hover { background:var(--blue-bg); }
  .fin-btn.plain { background:var(--black); color:var(--text-1); border-color:var(--border-2); }
  .fin-btn.plain:hover { background:var(--black-3); }
  .fin-btn.green { background:var(--green); border-color:var(--green); }
  .fin-btn.red { background:var(--black); color:var(--red); border-color:rgba(220,38,38,.35); }
  .fin-btn.red:hover { background:var(--red-bg); }
  .fin-btn.warn { background:var(--black); color:var(--amber); border-color:rgba(217,119,6,.45); }
  .fin-btn.sm { padding:5px 10px; font-size:11px; }
  .fin-btn:disabled { opacity:.55; cursor:not-allowed; }
  .fin-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .fin-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:16px; }
  .fin-stat { background:var(--black); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; display:flex; gap:12px; align-items:center; }
  .fin-stat .ic { width:38px; height:38px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:16px; font-weight:700; }
  .fin-stat .v { font-size:16px; font-weight:800; color:var(--text-1); }
  .fin-stat .l { font-size:11px; color:var(--text-2); }
  .fin-stat .s { font-size:10px; color:var(--text-3); margin-top:1px; }
  .fin-stat .p { margin-left:auto; font-size:11px; font-weight:700; align-self:flex-end; }
  .fin-badge { display:inline-block; font-size:10px; font-weight:700; padding:3px 9px; border-radius:20px; white-space:nowrap; text-transform:none; }
  .fin-badge.green { background:var(--green-bg); color:var(--green); } .fin-badge.red { background:var(--red-bg); color:var(--red); }
  .fin-badge.amber { background:var(--amber-bg); color:var(--amber); } .fin-badge.blue { background:var(--blue-bg); color:var(--blue); }
  .fin-badge.grey { background:var(--black-3); color:var(--text-2); } .fin-badge.cyan { background:var(--cyan-bg); color:var(--cyan); }
  .fin-tabs { display:flex; border-bottom:1px solid var(--border); flex-wrap:wrap; background:var(--black); border-radius:var(--radius) var(--radius) 0 0; }
  .fin-tab { flex:1; min-width:140px; padding:12px 14px; background:none; border:0; border-bottom:2px solid transparent; color:var(--text-2); font-weight:600; font-size:12px; cursor:pointer; font-family:'DM Sans',sans-serif; }
  .fin-tab.active { color:#0d6efd; border-bottom-color:#0d6efd; }
  .fin-side { display:grid; grid-template-columns:210px 1fr; gap:14px; align-items:start; }
  .fin-side-nav { background:var(--black); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
  .fin-side-nav button { display:block; width:100%; text-align:left; padding:11px 14px; background:none; border:0; border-left:3px solid transparent; font-size:12px; color:#0d6efd; cursor:pointer; font-family:'DM Sans',sans-serif; }
  .fin-side-nav button.active { border-left-color:#0d6efd; background:var(--blue-bg); font-weight:700; }
  @media (max-width:760px) { .fin-side { grid-template-columns:1fr; } }
  .fin-tools { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 18px; }
  .fin-tools .left, .fin-tools .right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--text-2); }
  .fin-table-wrap { overflow-x:auto; }
  .fin-table { width:100%; border-collapse:collapse; font-size:12px; }
  .fin-table th { text-align:left; padding:10px 10px; font-size:11px; font-weight:700; color:var(--text-2); border-bottom:1px solid var(--border); background:var(--black-2); white-space:nowrap; }
  .fin-table th.sortable { cursor:pointer; }
  .fin-table th .sub { display:block; font-weight:400; font-size:9px; color:var(--text-3); white-space:normal; max-width:200px; }
  .fin-table td { padding:9px 10px; border-bottom:1px solid var(--border); vertical-align:top; color:var(--text-1); }
  .fin-table tr:hover td { background:var(--black-2); }
  .fin-table td.num, .fin-table th.num { text-align:right; white-space:nowrap; }
  .fin-table tfoot td { font-weight:700; background:var(--black-2); }
  .fin-table .muted { color:var(--text-3); font-size:11px; }
  .fin-empty { padding:28px; text-align:center; color:var(--text-3); }
  .fin-foot { display:flex; justify-content:space-between; align-items:center; padding:10px 18px; font-size:11px; color:var(--text-3); flex-wrap:wrap; gap:8px; }
  .fin-pager { display:flex; gap:3px; }
  .fin-pager button { min-width:30px; padding:5px 8px; border:1px solid var(--border); background:var(--black); border-radius:5px; cursor:pointer; font-size:11px; color:#0d6efd; }
  .fin-pager button.active { background:#0d6efd; color:#fff; border-color:#0d6efd; }
  .fin-pager button:disabled { opacity:.45; cursor:default; }
  .fin-dd { position:relative; display:inline-block; }
  .fin-menu { position:fixed; z-index:3000; min-width:170px; background:var(--black); border:1px solid var(--border); border-radius:8px; box-shadow:0 12px 30px rgba(15,23,42,.16); padding:5px 0; }
  .fin-menu button { display:block; width:100%; text-align:left; background:none; border:0; padding:8px 14px; font-size:12px; color:var(--text-1); cursor:pointer; font-family:'DM Sans',sans-serif; }
  .fin-menu button:hover { background:var(--black-3); }
  .fin-menu button.danger { color:var(--red); }
  .fin-overlay { position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:2000; display:flex; align-items:flex-start; justify-content:center; padding:28px 14px; overflow-y:auto; }
  .fin-modal { width:min(560px,100%); background:var(--black); border:1px solid var(--border); border-radius:var(--radius); box-shadow:0 22px 70px rgba(15,23,42,.35); }
  .fin-modal.wide { width:min(900px,100%); } .fin-modal.xwide { width:min(1180px,100%); }
  .fin-modal-head { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .fin-modal-head h3 { font-size:14px; font-weight:700; }
  .fin-modal-x { background:none; border:0; font-size:18px; cursor:pointer; color:var(--text-3); line-height:1; }
  .fin-modal-body { padding:18px; }
  .fin-modal-foot { padding:12px 18px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
  .fin-note { font-size:12px; color:var(--text-2); background:var(--blue-bg); border:1px solid rgba(37,99,235,.18); border-radius:8px; padding:10px 12px; line-height:1.6; }
  .fin-note.warn { background:var(--amber-bg); border-color:rgba(217,119,6,.25); }
  .fin-note.red { background:var(--red-bg); border-color:rgba(220,38,38,.2); color:var(--red); }
  .fin-check { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-1); cursor:pointer; }
  .fin-switch { position:relative; display:inline-flex; align-items:center; border:1px solid var(--border-2); border-radius:6px; overflow:hidden; font-size:10px; font-weight:700; cursor:pointer; }
  .fin-switch span { padding:4px 9px; color:var(--text-3); } .fin-switch.on span.on { background:#0d6efd; color:#fff; } .fin-switch.off span.off { background:var(--black-3); color:var(--text-2); }
  .fin-lines td { padding:6px 6px; } .fin-lines input, .fin-lines select { width:100%; }
  .fin-kv { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:12px; } .fin-kv dt { color:var(--text-2); } .fin-kv dd { font-weight:600; }
  .fin-big { font-size:24px; font-weight:800; }
  .fin-hero { background:linear-gradient(135deg,#0d6efd,#1e40af); color:#fff; border-radius:var(--radius); padding:24px; }
  .fin-hero .chip { display:inline-block; border:1px solid rgba(255,255,255,.4); border-radius:20px; padding:5px 12px; font-size:11px; margin:4px 4px 0 0; font-style:italic; }
  .fin-tile { border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:var(--black); }
  .fin-tile h4 { font-size:13px; margin:8px 0 4px; } .fin-tile p { font-size:11px; color:var(--text-2); line-height:1.5; }
  .fin-report-card { border:1px solid var(--border); border-left:3px solid #0d6efd; border-radius:var(--radius); padding:14px; background:var(--black); cursor:pointer; display:flex; gap:12px; align-items:flex-start; text-align:left; font-family:'DM Sans',sans-serif; }
  .fin-report-card:hover { box-shadow:0 6px 18px rgba(15,23,42,.08); }
  .fin-report-card h4 { font-size:13px; margin-bottom:3px; color:var(--text-1); } .fin-report-card p { font-size:11px; color:var(--text-2); line-height:1.5; }
  .fin-section-label { font-size:10px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--text-3); margin:18px 0 10px; }
  @media print { .fin-no-print { display:none !important; } }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── Formatting ─────────────────────────────────────────────────────────
  const money = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = n => '₦' + Math.round(Number(n || 0)).toLocaleString('en-NG');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function date(v) {
    if (!v) return '—';
    const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
  }
  function dateTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return `${date(v)} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  const monthLabel = p => { const [y, m] = String(p).split('-'); return `${MONTHS_LONG[Number(m) - 1] || ''} ${y}`; };
  const pct = (a, b) => (b ? (a / b * 100).toFixed(2) : '0.00') + '%';
  const cap = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Today / Yesterday / This Week … Custom (same choices as SchoolsFocus)
  const QUICK = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This Week'], ['last_week', 'Last Week'], ['last_7', 'Last 7 Days'], ['this_month', 'This Month'],
    ['last_month', 'Last Month'], ['last_30', 'Last 30 Days'], ['last_90', 'Last 90 Days'], ['this_quarter', 'This Quarter'], ['this_session', 'This Session'], ['this_year', 'This Year'], ['all', 'All Time'], ['custom', 'Custom']];
  function quickRange(key) {
    const now = new Date();
    const d = (y, m, day) => iso(new Date(y, m, day));
    const y = now.getFullYear(); const m = now.getMonth(); const day = now.getDate(); const wd = (now.getDay() + 6) % 7;
    const sess = (state.setup && state.setup.academic && state.setup.academic.sessionLabel) || '';
    const sm = String(sess).match(/(\d{4})\D+(\d{4})/);
    switch (key) {
      case 'today': return { from: today(), to: today() };
      case 'yesterday': return { from: d(y, m, day - 1), to: d(y, m, day - 1) };
      case 'this_week': return { from: d(y, m, day - wd), to: today() };
      case 'last_week': return { from: d(y, m, day - wd - 7), to: d(y, m, day - wd - 1) };
      case 'last_7': return { from: d(y, m, day - 6), to: today() };
      case 'this_month': return { from: d(y, m, 1), to: today() };
      case 'last_month': return { from: d(y, m - 1, 1), to: d(y, m, 0) };
      case 'last_30': return { from: d(y, m, day - 29), to: today() };
      case 'last_90': return { from: d(y, m, day - 89), to: today() };
      case 'this_quarter': return { from: d(y, Math.floor(m / 3) * 3, 1), to: today() };
      case 'this_session': return sm ? { from: `${sm[1]}-09-01`, to: `${sm[2]}-08-31` } : { from: d(m >= 8 ? y : y - 1, 8, 1), to: d(m >= 8 ? y + 1 : y, 7, 31) };
      case 'this_year': return { from: d(y, 0, 1), to: today() };
      default: return { from: '', to: '' };
    }
  }
  const quickLabel = key => (QUICK.find(q => q[0] === key) || [, ''])[1];

  // ── Small builders ─────────────────────────────────────────────────────
  function options(list, selected, placeholder) {
    const opts = list.map(o => (Array.isArray(o) ? o : [o, o]));
    return (placeholder != null ? `<option value="">${esc(placeholder)}</option>` : '') +
      opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }
  function field(label, control, { required = false, hint = '', warn = false, id = '', span = 1 } = {}) {
    return `<div class="fin-field"${span > 1 ? ` style="grid-column:span ${span}"` : ''}${id ? ` id="${id}"` : ''}><label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>${control}${hint ? `<div class="hint${warn ? ' warn' : ''}">${hint}</div>` : ''}</div>`;
  }
  const input = (id, { type = 'text', value = '', placeholder = '', attrs = '' } = {}) =>
    `<input class="field-input" id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>`;
  const select = (id, list, selected, placeholder, attrs = '') => `<select class="ctrl-select" id="${id}" ${attrs}>${options(list, selected, placeholder)}</select>`;
  const val = id => { const el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : ''; };
  function badge(text, color = 'grey') { return `<span class="fin-badge ${color}">${esc(text)}</span>`; }
  function stats(list) {
    return `<div class="fin-stats">${list.map(s => `
      <div class="fin-stat">
        <div class="ic" style="background:${s.bg || 'var(--blue-bg)'};color:${s.color || 'var(--blue)'};">${s.icon || '₦'}</div>
        <div><div class="v" style="color:${s.valueColor || 'var(--text-1)'}">${s.value}</div><div class="l">${esc(s.label)}</div>${s.sub ? `<div class="s">${esc(s.sub)}</div>` : ''}</div>
        ${s.pct ? `<div class="p" style="color:${s.valueColor || 'var(--text-2)'}">${esc(s.pct)}</div>` : ''}
      </div>`).join('')}</div>`;
  }
  function card(title, body, { actions = '', id = '', bodyStyle = '' } = {}) {
    return `<div class="fin-card"${id ? ` id="${id}"` : ''}>${title || actions ? `<div class="fin-card-head"><div class="fin-card-title">${title}</div><div class="fin-actions">${actions}</div></div>` : ''}<div class="fin-card-body"${bodyStyle ? ` style="${bodyStyle}"` : ''}>${body}</div></div>`;
  }
  function tabs(id, list, active, onPick) {
    FIN._tabPick[id] = onPick;
    return `<div class="fin-tabs">${list.map(([k, l]) => `<button type="button" class="fin-tab${k === active ? ' active' : ''}" onclick="FIN._pickTab('${id}','${k}',this)">${l}</button>`).join('')}</div>`;
  }
  function sideNav(id, list, active, onPick) {
    FIN._tabPick[id] = onPick;
    return `<div class="fin-side-nav">${list.map(([k, l]) => `<button type="button" class="${k === active ? 'active' : ''}" onclick="FIN._pickTab('${id}','${k}',this)">${l}</button>`).join('')}</div>`;
  }
  function onOffSwitch(on, onclick, locked) {
    return `<span class="fin-switch ${on ? 'on' : 'off'}" ${onclick ? `onclick="${onclick}"` : ''} title="${on ? 'On' : 'Off'}">${locked ? '<span>🔒</span>' : ''}<span class="on">ON</span><span class="off">OFF</span></span>`;
  }
  function fileToDataUrl(inputEl) {
    const f = inputEl && inputEl.files && inputEl.files[0];
    if (!f) return Promise.resolve('');
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(f);
    });
  }
  const docLink = p => (p ? `<a href="/${esc(p)}" target="_blank" rel="noopener">View attachment</a>` : '—');

  // ── Popups ─────────────────────────────────────────────────────────────
  function modal({ title, body, size = '', buttons = [], onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'fin-overlay';
    ov.innerHTML = `<div class="fin-modal ${size}" role="dialog" aria-modal="true">
      <div class="fin-modal-head"><h3>${title}</h3><button class="fin-modal-x" aria-label="Close">✕</button></div>
      <div class="fin-modal-body">${body}</div>
      ${buttons.length ? '<div class="fin-modal-foot"></div>' : ''}</div>`;
    const close = () => { ov.remove(); if (onClose) onClose(); };
    ov.querySelector('.fin-modal-x').onclick = close;
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    const foot = ov.querySelector('.fin-modal-foot');
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fin-btn ${b.cls || ''}`;
      btn.innerHTML = b.label;
      btn.onclick = async () => {
        if (!b.onClick) return close();
        btn.disabled = true;
        try { const keep = await b.onClick(ov, close); if (keep === false) return; } catch (err) { showToast(err.message); } finally { btn.disabled = false; }
      };
      foot.appendChild(btn);
    });
    document.body.appendChild(ov);
    const first = ov.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: ov, close, body: ov.querySelector('.fin-modal-body') };
  }
  function confirmBox(message) { return window.uiConfirm ? uiConfirm(message) : Promise.resolve(confirm(message)); }

  // ── Dropdown menu next to a button ─────────────────────────────────────
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  function menu(btn, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'fin-menu';
    items.filter(Boolean).forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = it.danger ? 'danger' : '';
      b.textContent = it.label;
      b.onclick = () => { closeMenu(); it.onClick(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    const w = m.offsetWidth; const h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    m.style.top = `${r.bottom + h + 4 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    openMenu = m;
  }
  // inline "▾" buttons: FIN.menus[key] holds the items
  const menus = {};
  function menuButton(label, items, cls = 'plain sm') {
    const key = `m${Math.random().toString(36).slice(2, 9)}`;
    menus[key] = items;
    return `<button type="button" class="fin-btn ${cls}" onclick="FIN.menu(this, FIN.menus['${key}'])">${label} ▾</button>`;
  }

  // ── Export / print ─────────────────────────────────────────────────────
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const plain = v => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
  function htmlTable(title, headers, rows) {
    return `<h3 style="font-family:Arial;font-size:14px;margin:0 0 8px">${esc(title)}</h3><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Arial;font-size:11px">
      <thead><tr>${headers.map(h => `<th style="background:#f1f5f9">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  // tiny .xlsx writer (stored zip, inline strings)
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder();
    const parts = []; const central = []; let offset = 0;
    files.forEach(([name, text]) => {
      const nameB = enc.encode(name); const data = enc.encode(text); const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(h.buffer), nameB, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nameB.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    });
    const size = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xlsx(headers, rows) {
    const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const colName = i => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const row = (cells, r) => `<row r="${r}">${cells.map((c, i) => {
      const num = typeof c === 'number' || (/^-?\d+(\.\d+)?$/.test(String(c)) && String(c).length < 15 && !/^0\d/.test(String(c)));
      return num ? `<c r="${colName(i)}${r}"><v>${c}</v></c>` : `<c r="${colName(i)}${r}" t="inlineStr"><is><t xml:space="preserve">${x(c)}</t></is></c>`;
    }).join('')}</row>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[headers, ...rows].map((r, i) => row(r, i + 1)).join('')}</sheetData></worksheet>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet],
    ]);
  }
  function exportRows(format, { title, headers, rows }) {
    const name = String(title || 'export').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'export';
    const data = rows.map(r => r.map(plain));
    if (!data.length) return showToast('Nothing to export');
    if (format === 'csv') {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      download(`${name}.csv`, new Blob(['﻿' + [headers, ...data].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    } else if (format === 'xlsx') {
      download(`${name}.xlsx`, xlsx(headers, data));
    } else {
      const html = `<html><head><meta charset="utf-8"></head><body>${htmlTable(title, headers, data)}</body></html>`;
      download(`${name}.${format === 'doc' ? 'doc' : 'xls'}`, new Blob(['﻿' + html], { type: format === 'doc' ? 'application/msword' : 'application/vnd.ms-excel' }));
    }
    showToast('Export downloaded');
  }
  function schoolHeader() {
    const s = FIN.cache.school || {};
    const name = s.name || document.title.split('—')[0].trim();
    return `<div style="text-align:center;margin-bottom:12px"><img src="/report_assets/school-logo.png" onerror="this.remove()" style="height:56px"><div style="font-size:16px;font-weight:800">${esc(name)}</div></div>`;
  }
  function print(title, html, { pos = false } = {}) {
    const w = window.open('', '_blank', pos ? 'width=380,height=700' : 'width=1000,height=750');
    if (!w) return showToast('Allow pop-ups to print');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>body{font-family:'DM Sans',Arial,sans-serif;color:#0f172a;margin:${pos ? '6px' : '24px'};font-size:${pos ? '11px' : '12px'}}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;font-size:${pos ? '10px' : '11px'}}th{background:#f1f5f9}
      .num{text-align:right}.muted{color:#64748b}h2,h3{margin:6px 0}@page{margin:12mm}</style></head><body>${html}
      <script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script></body></html>`);
    w.document.close();
  }

  // ── Data table ─────────────────────────────────────────────────────────
  // FIN.table(el, { columns:[{key,label,sub,render(row),num,sort,total,exportValue(row)}], rows, perPage, title,
  //                  selectable, rowKey, toolbar(htmlFn), emptyText, searchKeys, exportFormats })
  const tables = {};
  function table(el, cfg) {
    const id = el.id || (el.id = `ft${Math.random().toString(36).slice(2, 8)}`);
    const prev = tables[id];
    const t = { ...cfg, el, page: 1, perPage: cfg.perPage || 25, search: '', sortKey: null, sortDir: 1, picked: new Set(), ...(prev && prev.keep ? { perPage: prev.perPage, search: prev.search, sortKey: prev.sortKey, sortDir: prev.sortDir } : {}) };
    t.keep = true;
    tables[id] = t;
    drawTable(id);
    return {
      picked: () => [...t.picked], rows: () => filtered(t), redraw: () => drawTable(id),
      setRows: rows => { t.rows = rows; t.picked.clear(); drawTable(id); },
    };
  }
  function cellText(t, c, r) {
    if (c.exportValue) return c.exportValue(r);
    if (c.render) return plain(c.render(r));
    return r[c.key];
  }
  function filtered(t) {
    let rows = t.rows || [];
    if (t.search) {
      const q = t.search.toLowerCase();
      rows = rows.filter(r => t.columns.some(c => String(cellText(t, c, r) ?? '').toLowerCase().includes(q)) || (t.searchKeys || []).some(k => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    if (t.sortKey) {
      const c = t.columns.find(x => x.key === t.sortKey);
      const get = r => (c && c.sort ? c.sort(r) : r[t.sortKey]);
      rows = [...rows].sort((a, b) => { const x = get(a); const y = get(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * t.sortDir; });
    }
    return rows;
  }
  function drawTable(id) {
    const t = tables[id];
    const rows = filtered(t);
    const per = t.perPage === 'all' ? rows.length || 1 : Number(t.perPage);
    const pages = Math.max(1, Math.ceil(rows.length / per));
    t.page = Math.min(t.page, pages);
    const start = (t.page - 1) * per;
    const pageRows = rows.slice(start, start + per);
    const key = r => r[t.rowKey || 'id'];
    const totals = t.columns.some(c => c.total);
    const exportBtns = t.noExport ? '' : `${menuButton('Export List', (t.exportFormats || ['doc', 'csv', 'xls', 'xlsx']).map(f => ({ label: f.toUpperCase(), onClick: () => FIN.tableExport(id, f) })))}
      ${menuButton('Print List', [{ label: 'Print List Only', onClick: () => FIN.tablePrint(id, false) }, ...(t.printSummary ? [{ label: 'Print List with Summary', onClick: () => FIN.tablePrint(id, true) }] : [])])}`;
    const pagesList = [];
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - t.page) <= 2) pagesList.push(i); else if (pagesList[pagesList.length - 1] !== '…') pagesList.push('…');
    t.el.innerHTML = `
      <div class="fin-tools fin-no-print">
        <div class="left">${t.toolbar ? t.toolbar() : ''}${exportBtns}</div>
        <div class="right">
          <select class="ctrl-select" style="width:auto" onchange="FIN._tableSet('${id}','perPage',this.value)">${[10, 20, 25, 30, 50, 100, 200, 500, 'all'].map(n => `<option value="${n}"${String(n) === String(t.perPage) ? ' selected' : ''}>${n === 'all' ? 'All' : n}</option>`).join('')}</select> records per page
          <input class="search-input" placeholder="Search" value="${esc(t.search)}" oninput="FIN._tableSet('${id}','search',this.value)">
        </div>
      </div>
      ${t.caption ? `<div style="text-align:center;font-weight:700;font-size:14px;padding:4px 18px 10px">${t.caption}</div>` : ''}
      <div class="fin-table-wrap"><table class="fin-table">
        <thead><tr>${t.selectable ? `<th style="width:28px"><input type="checkbox" ${pageRows.length && pageRows.every(r => t.picked.has(key(r))) ? 'checked' : ''} onchange="FIN._tablePickAll('${id}',this.checked)"></th>` : ''}
          ${t.columns.map(c => `<th class="${c.num ? 'num ' : ''}${c.key && c.sortable !== false ? 'sortable' : ''}" ${c.key && c.sortable !== false ? `onclick="FIN._tableSort('${id}','${c.key}')"` : ''}>${esc(c.label)}${t.sortKey === c.key ? (t.sortDir > 0 ? ' ▲' : ' ▼') : ''}${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${pageRows.length ? pageRows.map((r, i) => `<tr>${t.selectable ? `<td><input type="checkbox" ${t.picked.has(key(r)) ? 'checked' : ''} onchange="FIN._tablePick('${id}',${jsArg(key(r))},this.checked)"></td>` : ''}
          ${t.columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.key === '#' ? start + i + 1 : c.render ? c.render(r, start + i) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${t.columns.length + (t.selectable ? 1 : 0)}" class="fin-empty">${t.emptyText || 'No data available in table'}</td></tr>`}</tbody>
        ${totals && rows.length ? `<tfoot><tr>${t.selectable ? '<td></td>' : ''}${t.columns.map((c, i) => `<td class="${c.num ? 'num' : ''}">${c.total ? (typeof c.total === 'function' ? c.total(rows) : money(rows.reduce((s, r) => s + Number(r[c.key] || 0), 0))) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>
      <div class="fin-foot fin-no-print"><span>Showing ${rows.length ? start + 1 : 0} to ${start + pageRows.length} of ${rows.length} entries${(t.rows || []).length !== rows.length ? ` (filtered from ${(t.rows || []).length} total entries)` : ''}${t.selectable && t.picked.size ? ` · ${t.picked.size} selected` : ''}</span>
        <div class="fin-pager"><button ${t.page <= 1 ? 'disabled' : ''} onclick="FIN._tableSet('${id}','page',1)">«</button><button ${t.page <= 1 ? 'disabled' : ''} onclick="FIN._tableSet('${id}','page',${t.page - 1})">‹</button>
          ${pagesList.map(p => p === '…' ? '<button disabled>…</button>' : `<button class="${p === t.page ? 'active' : ''}" onclick="FIN._tableSet('${id}','page',${p})">${p}</button>`).join('')}
          <button ${t.page >= pages ? 'disabled' : ''} onclick="FIN._tableSet('${id}','page',${t.page + 1})">›</button><button ${t.page >= pages ? 'disabled' : ''} onclick="FIN._tableSet('${id}','page',${pages})">»</button></div></div>`;
    if (t.onDraw) t.onDraw();
  }
  function tableData(id, onlyPicked) {
    const t = tables[id];
    const key = r => r[t.rowKey || 'id'];
    const rows = filtered(t).filter(r => !onlyPicked || t.picked.has(key(r)));
    const cols = t.columns.filter(c => !c.noExport);
    return { title: t.title || 'Export', headers: cols.map(c => c.label), rows: rows.map((r, i) => cols.map(c => (c.key === '#' ? i + 1 : cellText(t, c, r) ?? ''))) };
  }

  const FIN = window.FIN = {
    pages, esc, money, whole, date, dateTime, iso, today, monthLabel, pct, cap, MONTHS, MONTHS_LONG, QUICK, quickRange, quickLabel,
    options, field, input, select, val, badge, stats, card, tabs, sideNav, onOffSwitch, fileToDataUrl, docLink,
    modal, confirm: confirmBox, menu, menus, menuButton, exportRows, print, schoolHeader, table, plain, htmlTable,
    _tabPick: {},
    page(tab, draw) { pages[tab] = draw; },
    open(tab) {
      closeMenu();
      const draw = pages[tab];
      const el = document.getElementById(`tab-${tab}`);
      if (!draw || !el) return false;
      Promise.resolve(draw(el)).catch(err => { el.innerHTML = `<div class="fin-note red">${esc(err.message)}</div>`; });
      return true;
    },
    api(url, opts = {}) { return apiFetch(url, opts.body && typeof opts.body !== 'string' ? { ...opts, body: JSON.stringify(opts.body) } : opts); },
    get: url => apiFetch(url),
    post: (url, body) => apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) }),
    put: (url, body) => apiFetch(url, { method: 'PUT', body: JSON.stringify(body || {}) }),
    del: url => apiFetch(url, { method: 'DELETE' }),
    qs(obj) { const p = new URLSearchParams(); Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(',') : v); }); const s = p.toString(); return s ? `?${s}` : ''; },
    header(title, crumb) { return `<div class="page-header"><h2>${esc(title)}</h2>${crumb ? `<p>${crumb}</p>` : ''}</div>`; },
    classes: () => (state.setup && state.setup.classes || []).filter(c => !c.archived),
    arms: code => (state.setup && state.setup.classArms || []).filter(a => a.classCode === code),
    students: () => [...(state.setup && state.setup.students || [])].sort((a, b) => a.name.localeCompare(b.name)),
    goTab(tab) { const btn = document.querySelector(`.sub-nav-item[data-tab="${tab}"]`); switchTab(tab, btn); },
    tableExport(id, f) { exportRows(f, tableData(id)); },
    tablePrint(id, withSummary) {
      const t = tables[id];
      const d = tableData(id);
      print(d.title, `${schoolHeader()}<h3 style="text-align:center">${esc(d.title)}</h3>${withSummary && t.printSummary ? t.printSummary(filtered(t)) : ''}
        <table><thead><tr>${d.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${d.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    },
    tablePicked(id) { return tables[id] ? [...tables[id].picked] : []; },
    _pickTab(id, key, btn) {
      const box = btn.parentElement;
      box.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      if (FIN._tabPick[id]) FIN._tabPick[id](key);
    },
    _tableSet(id, k, v) {
      const t = tables[id];
      t[k] = k === 'page' ? Number(v) : v;
      if (k !== 'page') t.page = 1;
      const focus = k === 'search';
      drawTable(id);
      if (focus) { const s = t.el.querySelector('.search-input'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    },
    _tableSort(id, key) { const t = tables[id]; t.sortDir = t.sortKey === key ? -t.sortDir : 1; t.sortKey = key; drawTable(id); },
    _tablePick(id, key, on) { const t = tables[id]; on ? t.picked.add(key) : t.picked.delete(key); const s = t.el.querySelector('.fin-foot span'); if (s) drawTable(id); },
    _tablePickAll(id, on) {
      const t = tables[id];
      const rows = filtered(t);
      const per = t.perPage === 'all' ? rows.length || 1 : Number(t.perPage);
      rows.slice((t.page - 1) * per, (t.page - 1) * per + per).forEach(r => (on ? t.picked.add(r[t.rowKey || 'id']) : t.picked.delete(r[t.rowKey || 'id'])));
      drawTable(id);
    },
  };

  // shared look-ups, loaded once per visit
  FIN.cache = {};
  FIN.feesMeta = async (fresh) => { if (fresh || !FIN.cache.feesMeta) { FIN.cache.feesMeta = await FIN.get('/api/admin/fees/meta'); FIN.cache.school = FIN.cache.feesMeta.school; } return FIN.cache.feesMeta; };
  FIN.financeMeta = async (fresh) => (!fresh && FIN.cache.finMeta) || (FIN.cache.finMeta = await FIN.get('/api/admin/finance/meta'));
  FIN.payrollMeta = async (fresh) => (!fresh && FIN.cache.payMeta) || (FIN.cache.payMeta = await FIN.get('/api/admin/payroll/meta'));
  FIN.sessionList = meta => [...new Set(meta.sessions.map(s => s.sessionLabel))];
  FIN.termList = meta => [...new Set(meta.sessions.map(s => s.termLabel))];
  FIN.activeTerm = () => (state.setup && state.setup.academic) || {};
  FIN.classOptions = (sel, extra = []) => options([...extra, ...FIN.classes().map(c => [c.code, c.label])], sel);
  FIN.armOptions = (code, sel, allLabel = 'All') => options([['', code ? allLabel : 'Select Class First'], ...FIN.arms(code).map(a => [a.id, a.name]), ...(code && FIN.arms(code).length ? [['none', 'Not Assigned to Class Arm']] : [])], sel);
  FIN.statusBadge = s => ({ paid: badge('Total Paid', 'green'), partial: badge('Partly Paid', 'amber'), unpaid: badge('Unpaid', 'red') }[s] || badge(cap(s)));
})();
