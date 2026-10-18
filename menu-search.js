// Smart menu search shared by the Admin, Teacher and Student portals.
// Any <input data-menu-search> searches the whole sidebar menu: it matches
// words related to a page (e.g. "money" finds the fee/payment pages), forgives
// small typos, and lists the best matches in a dropdown under the box.
(function () {
  // Words people may type for a page, grouped by meaning. A query word that
  // belongs to a group also matches menu labels containing any other word of it.
  const RELATED = [
    ['fee', 'fees', 'payment', 'pay', 'paid', 'money', 'bursary', 'invoice', 'bill', 'billing', 'receipt', 'debtor', 'debt', 'owing', 'tuition', 'proof', 'finance', 'family'],
    ['salary', 'salaries', 'payroll', 'wage', 'wages', 'loan', 'advance', 'payslip'],
    ['expense', 'expenses', 'spending', 'spend', 'cost', 'income', 'budget', 'account', 'accounts', 'ledger', 'journal', 'balance', 'bank', 'reconciliation', 'tax', 'finance', 'financial'],
    ['store', 'shop', 'product', 'products', 'inventory', 'stock', 'pos', 'sale', 'sales', 'order', 'orders', 'storefront'],
    ['result', 'results', 'score', 'scores', 'grade', 'grades', 'mark', 'marks', 'gradebook', 'report', 'reports', 'broadsheet', 'assessment', 'performance', 'checker', 'cognitive', 'publish'],
    ['exam', 'exams', 'examination', 'test', 'tests', 'cbt', 'quiz', 'question', 'questions', 'practice', 'computer'],
    ['timetable', 'schedule', 'schedules', 'calendar', 'period', 'periods', 'term', 'terms', 'session'],
    ['student', 'students', 'pupil', 'pupils', 'child', 'children', 'learner', 'learners', 'kid', 'kids', 'enrol', 'enroll', 'enrollment', 'enrolment', 'admission', 'admissions', 'application', 'applications', 'registration', 'registry', 'register', 'promote', 'promotion'],
    ['staff', 'teacher', 'teachers', 'employee', 'employees', 'worker', 'workers'],
    ['parent', 'parents', 'guardian', 'guardians', 'family', 'families'],
    ['attendance', 'present', 'absent', 'absence', 'roll', 'register'],
    ['class', 'classes', 'arm', 'arms', 'subject', 'subjects', 'course', 'courses', 'lesson', 'lessons', 'academic', 'academics', 'curriculum'],
    ['announcement', 'announcements', 'notice', 'notices', 'news', 'message', 'messages', 'broadcast', 'communication', 'email', 'mail'],
    ['setting', 'settings', 'config', 'configure', 'configuration', 'preference', 'preferences', 'setup', 'template', 'templates', 'signature', 'signatures'],
    ['profile', 'account', 'password', 'me', 'my'],
    ['comment', 'comments', 'remark', 'remarks'],
    ['photo', 'photos', 'picture', 'pictures', 'image', 'images', 'passport'],
    ['assignment', 'assignments', 'homework', 'classwork'],
    ['dashboard', 'home', 'overview', 'summary', 'stats', 'statistics'],
    ['security', 'login', 'logins', 'audit', 'backup', 'backups', 'restore', 'role', 'roles', 'permission', 'permissions', 'user', 'users'],
  ];

  function words(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }

  // "payments" → "payment", "classes" → "class", "salaries" → "salary"
  function stem(word) {
    if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
    if (/(ss|ch|sh|x)es$/.test(word)) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
  }

  // Edit distance, capped: returns max + 1 once it is clearly too far.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function relatedWords(word) {
    const s = stem(word);
    const out = new Set();
    RELATED.forEach(group => {
      if (group.some(g => g === word || stem(g) === s || (word.length >= 3 && g.startsWith(word)))) {
        group.forEach(g => out.add(stem(g)));
      }
    });
    out.delete(s);
    return out;
  }

  // How well one query word matches a list of (stemmed) words, 0 = not at all.
  function wordScore(q, list, related) {
    const s = stem(q);
    let best = 0;
    list.forEach(w => {
      if (w === s) best = Math.max(best, 10);
      else if (w.startsWith(s)) best = Math.max(best, 8);
      else if (s.length >= 3 && w.includes(s)) best = Math.max(best, 5);
      else if (related.has(w)) best = Math.max(best, 6);
      else if (s.length >= 4 && distance(s, w, s.length >= 7 ? 2 : 1) <= (s.length >= 7 ? 2 : 1)) best = Math.max(best, 4);
    });
    return best;
  }

  function scoreEntry(queryWords, entry) {
    let total = 0;
    let matched = 0;
    queryWords.forEach(q => {
      const related = relatedWords(q);
      const inLabel = wordScore(q, entry.labelWords, related);
      const inPath = wordScore(q, entry.pathWords, related) * 0.5;
      const best = Math.max(inLabel, inPath);
      if (best) matched++;
      total += best;
    });
    // Whole phrase typed exactly as it appears in the label ranks first
    if (entry.label.toLowerCase().includes(queryWords.join(' '))) total += 6;
    return { total, matched };
  }

  // Links switched off for this user (e.g. class-teacher-only pages) are left
  // out; closed sections and folded groups are still searched.
  function isShown(el, sidebar) {
    if (el.closest('.menu-hidden')) return false;
    for (let node = el; node && node !== sidebar; node = node.parentElement) {
      if (node.classList.contains('sub-menu') || node.classList.contains('result-gradebook-children')) continue;
      if (getComputedStyle(node).display === 'none') return false;
    }
    return true;
  }

  function ownText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.sub-chev, .nav-badge, .nav-badge-amber, svg').forEach(n => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  // Every page link in the sidebar, with where it sits ("Finance › Fees / Bursary").
  function collectEntries(sidebar) {
    const links = [...sidebar.querySelectorAll('.sub-nav-item, .nav-item')].filter(el => {
      const onclick = el.getAttribute('onclick') || '';
      return !onclick.includes('toggleDropdown') && isShown(el, sidebar) && ownText(el);
    });
    return links.map(el => {
      const path = [];
      const menu = el.closest('.sub-menu');
      if (menu) {
        const rail = sidebar.querySelector(`.rail-item[data-section="${menu.dataset.menu}"] .rail-label`);
        if (rail) path.push(rail.textContent.trim());
      }
      const group = el.closest('.result-gradebook-children');
      const toggle = group?.previousElementSibling;
      if (toggle) path.push(ownText(toggle));
      if (!menu) {
        // Teacher / Student: the nearest section heading above the link
        let prev = el.previousElementSibling;
        while (prev && !prev.classList.contains('nav-label')) prev = prev.previousElementSibling;
        if (prev) path.push(prev.textContent.trim());
      }
      const label = ownText(el);
      const extra = el.dataset.keywords || '';
      return {
        el,
        label,
        path: path.filter(p => p && p.toLowerCase() !== label.toLowerCase()).join(' › '),
        labelWords: words(label + ' ' + extra).map(stem),
        pathWords: words(path.join(' ')).map(stem),
      };
    });
  }

  function search(sidebar, query) {
    const queryWords = words(query);
    if (!queryWords.length) return [];
    const scored = collectEntries(sidebar).map(entry => ({ entry, ...scoreEntry(queryWords, entry) }));
    // Prefer pages matching every word; fall back to pages matching any word.
    let hits = scored.filter(s => s.matched === queryWords.length);
    if (!hits.length) hits = scored.filter(s => s.matched > 0);
    const seen = new Set();
    return hits
      // equal scores: the shorter label is the closer match
      .sort((a, b) => b.total - a.total || a.entry.label.length - b.entry.label.length || a.entry.label.localeCompare(b.entry.label))
      .filter(s => {
        const key = s.entry.label.toLowerCase() + '|' + s.entry.path.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8)
      .map(s => s.entry);
  }

  function escapeText(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Dropdown colours come from the search box itself, so it fits every theme.
  function backgroundOf(el) {
    for (let node = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#ffffff';
  }

  const style = document.createElement('style');
  style.textContent = `
    .menu-search-results { position:absolute; left:-1px; right:-1px; top:calc(100% + 4px); z-index:1200; border:1px solid; border-radius:6px; box-shadow:0 10px 28px rgba(15,23,42,0.16); padding:4px; max-height:340px; overflow-y:auto; }
    .menu-search-result { display:block; width:100%; border:0; background:transparent; color:inherit; text-align:left; padding:8px 10px; border-radius:4px; cursor:pointer; font-family:'DM Sans',sans-serif; }
    .menu-search-result:hover, .menu-search-result.active { background:rgba(37,99,235,0.10); }
    .menu-search-label { display:block; font-size:13px; font-weight:500; line-height:1.25; }
    .menu-search-path { display:block; font-size:11px; opacity:0.6; margin-top:2px; line-height:1.2; }
    .menu-search-empty { padding:10px; font-size:12px; opacity:0.7; font-family:'DM Sans',sans-serif; }
  `;
  document.head.appendChild(style);

  function attach(input) {
    const box = input.parentElement;
    const sidebar = input.closest('aside, .sidebar') || document;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const list = document.createElement('div');
    list.className = 'menu-search-results';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    box.appendChild(list);
    let results = [];
    let active = 0;

    function close() { list.hidden = true; results = []; }

    function render() {
      results = search(sidebar, input.value);
      active = 0;
      if (!input.value.trim()) return close();
      list.style.background = backgroundOf(box);
      list.style.color = getComputedStyle(input).color;
      list.style.borderColor = getComputedStyle(box).borderTopColor;
      list.innerHTML = results.length
        ? results.map((r, i) => `<button type="button" role="option" class="menu-search-result${i === active ? ' active' : ''}" data-index="${i}">
            <span class="menu-search-label">${escapeText(r.label)}</span>${r.path ? `<span class="menu-search-path">${escapeText(r.path)}</span>` : ''}
          </button>`).join('')
        : '<div class="menu-search-empty">No menu item matches that. Try another word.</div>';
      list.hidden = false;
    }

    function highlight(index) {
      if (!results.length) return;
      active = (index + results.length) % results.length;
      list.querySelectorAll('.menu-search-result').forEach((btn, i) => btn.classList.toggle('active', i === active));
      list.querySelectorAll('.menu-search-result')[active]?.scrollIntoView({ block: 'nearest' });
    }

    function open(index) {
      const entry = results[index];
      if (!entry) return;
      input.value = '';
      close();
      input.blur();
      entry.el.click();
    }

    // Browsers may autofill a saved login ID (e.g. "TCH-097") into the box.
    // They never fill a read-only field, so the box stays read-only (it is
    // marked so in the HTML) until a person clicks, taps or tabs into it.
    const unlock = () => input.removeAttribute('readonly');
    input.addEventListener('pointerdown', unlock);
    input.addEventListener('touchstart', unlock, { passive: true });
    input.addEventListener('focus', unlock);
    input.addEventListener('blur', () => input.setAttribute('readonly', ''));

    // Backstop: a person can only type into it while it has focus, so
    // anything that arrives without focus is autofill and is wiped.
    function clearAutofill() {
      if (document.activeElement !== input && input.value) { input.value = ''; close(); }
    }
    [0, 300, 1000, 2500].forEach(ms => setTimeout(clearAutofill, ms));

    input.addEventListener('input', () => {
      if (document.activeElement !== input) return clearAutofill();
      render();
    });
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); else highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); open(active); }
      else if (e.key === 'Escape') { input.value = ''; close(); }
    });
    // mousedown (not click) so the choice lands before the box loses focus
    list.addEventListener('mousedown', e => {
      const btn = e.target.closest('.menu-search-result');
      if (!btn) return;
      e.preventDefault();
      open(Number(btn.dataset.index));
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  function init() {
    document.querySelectorAll('input[data-menu-search]').forEach(attach);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.menuSearch = { search };
})();
