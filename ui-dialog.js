// In-portal dialogs shared by every portal page, used instead of the
// browser's own confirm() / prompt() / alert() boxes so questions appear
// inside the portal, in its own style.
//
//   if (!await uiConfirm('Delete this question?')) return;
//   const name = await uiPrompt('New tag name:');      // null when cancelled
//   await uiNotice('Order 1042', 'Customer: …');       // read-only, Close button
(function () {
  // Words that make a question destructive: its button turns red
  const DANGER = ['delete', 'remove', 'clear', 'unpublish', 'archive', 'deactivate', 'reject', 'discard'];
  // Words worth using as the button label as they are ("Delete", "Move" …)
  const VERBS = DANGER.concat(['move', 'accept', 'generate', 'upload', 'restore', 'reactivate', 'publish', 'sign']);

  const style = document.createElement('style');
  style.textContent = `
    .ui-dialog-overlay { position:fixed; inset:0; z-index:5000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(15,23,42,0.55); }
    .ui-dialog { width:min(440px,100%); background:var(--black-2,#f8fafc); border:1px solid var(--border,#e2e8f0); border-radius:var(--radius,10px); box-shadow:0 22px 70px rgba(15,23,42,0.35); overflow:hidden; font-family:'DM Sans',sans-serif; }
    .ui-dialog.danger { border-color:rgba(220,38,38,0.35); }
    .ui-dialog-head { padding:16px 18px; border-bottom:1px solid var(--border,#e2e8f0); }
    .ui-dialog-title { font-size:15px; font-weight:700; color:var(--text-1,#0f172a); line-height:1.35; }
    .ui-dialog.danger .ui-dialog-title { color:var(--red,#dc2626); }
    .ui-dialog-sub { font-size:11px; color:var(--text-3,#94a3b8); margin-top:3px; font-family:'DM Mono',monospace; }
    .ui-dialog-body { padding:16px 18px; }
    .ui-dialog-text { font-size:13px; color:var(--text-2,#475569); line-height:1.55; white-space:pre-line; max-height:55vh; overflow-y:auto; margin:0; }
    .ui-dialog-input { width:100%; margin-top:10px; box-sizing:border-box; background:var(--black-3,#f1f5f9); border:1px solid var(--border,#e2e8f0); border-radius:var(--radius-sm,6px); padding:9px 12px; font-family:'DM Sans',sans-serif; font-size:13px; color:var(--text-1,#0f172a); outline:none; }
    .ui-dialog-input:focus { border-color:rgba(34,197,94,0.45); }
    .ui-dialog-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; flex-wrap:wrap; }
    .ui-dialog-actions button { display:inline-flex; align-items:center; justify-content:center; min-width:84px; padding:9px 18px; font-size:12px; line-height:1.2; }
    .ui-dialog.title-only .ui-dialog-head { border-bottom:0; padding-bottom:0; }
    .ui-dialog.title-only .ui-dialog-actions { margin-top:6px; }
  `;
  document.head.appendChild(style);

  let queue = Promise.resolve();

  function capitalise(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  // "Delete this tag? Students will be unassigned." → title + detail
  function splitMessage(message) {
    const text = String(message ?? '').trim();
    const q = text.indexOf('?');
    if (q > 0 && q < 160) return { title: text.slice(0, q + 1), text: text.slice(q + 1).trim() };
    return { title: '', text };
  }

  function open({ kind, title, text, sub, confirmLabel, cancelLabel, danger, placeholder, defaultValue }) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'ui-dialog-overlay';
      const box = document.createElement('div');
      box.className = 'ui-dialog' + (danger ? ' danger' : '') + (!text && kind !== 'prompt' ? ' title-only' : '');
      box.setAttribute('role', kind === 'notice' ? 'dialog' : 'alertdialog');
      box.setAttribute('aria-modal', 'true');

      const head = document.createElement('div');
      head.className = 'ui-dialog-head';
      const titleEl = document.createElement('div');
      titleEl.className = 'ui-dialog-title';
      titleEl.id = 'ui-dialog-title-' + Date.now();
      titleEl.textContent = title;
      box.setAttribute('aria-labelledby', titleEl.id);
      head.appendChild(titleEl);
      if (sub) {
        const subEl = document.createElement('div');
        subEl.className = 'ui-dialog-sub';
        subEl.textContent = sub;
        head.appendChild(subEl);
      }

      const body = document.createElement('div');
      body.className = 'ui-dialog-body';
      if (text) {
        const p = document.createElement('p');
        p.className = 'ui-dialog-text';
        p.textContent = text;
        body.appendChild(p);
      }
      let input = null;
      if (kind === 'prompt') {
        input = document.createElement('input');
        input.className = 'ui-dialog-input';
        input.type = 'text';
        input.placeholder = placeholder || '';
        input.value = defaultValue || '';
        input.setAttribute('aria-labelledby', titleEl.id);
        body.appendChild(input);
      }

      const actions = document.createElement('div');
      actions.className = 'ui-dialog-actions';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = danger ? 'btn-danger' : 'post-btn';
      ok.textContent = confirmLabel;
      if (kind !== 'notice') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-outline';
        cancel.textContent = cancelLabel || 'Cancel';
        cancel.addEventListener('click', () => finish(false));
        actions.appendChild(cancel);
      }
      actions.appendChild(ok);
      body.appendChild(actions);

      box.append(head, body);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function finish(confirmed) {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
        if (kind === 'prompt') resolve(confirmed ? input.value : null);
        else resolve(kind === 'notice' ? undefined : confirmed);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && e.target !== ok)) {
          e.preventDefault(); e.stopPropagation(); finish(true);
        } else if (e.key === 'Tab') {
          // keep keyboard focus inside the dialog
          const items = [...box.querySelectorAll('button, input')];
          const i = items.indexOf(document.activeElement);
          const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
          e.preventDefault();
          items[next].focus();
        }
      }
      ok.addEventListener('click', () => finish(true));
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onKey, true);
      (input || ok).focus();
    });
  }

  // One dialog at a time: a second request waits for the first to close.
  function enqueue(options) {
    const result = queue.then(() => open(options));
    queue = result.catch(() => {});
    return result;
  }

  window.uiConfirm = function (message, opts = {}) {
    const parts = splitMessage(message);
    const first = (parts.title || parts.text).split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    const danger = opts.danger ?? DANGER.includes(first);
    return enqueue({
      kind: 'confirm',
      title: opts.title || parts.title || 'Please confirm',
      text: opts.title ? String(message ?? '') : parts.text,
      sub: opts.sub,
      confirmLabel: opts.confirmLabel || (VERBS.includes(first) ? capitalise(first) : 'Continue'),
      cancelLabel: opts.cancelLabel,
      danger,
    });
  };

  window.uiPrompt = function (message, opts = {}) {
    return enqueue({
      kind: 'prompt',
      title: opts.title || String(message ?? ''),
      text: opts.title ? String(message ?? '') : '',
      confirmLabel: opts.confirmLabel || 'OK',
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      danger: !!opts.danger,
    });
  };

  window.uiNotice = function (title, text, opts = {}) {
    return enqueue({ kind: 'notice', title, text, confirmLabel: opts.closeLabel || 'Close' });
  };

  // ── Keep pop-ups inside the page area ──
  // The dark background still covers the whole window, but extra left
  // padding the width of the sidebar centres the pop-up box over the page,
  // so it never crosses into the menu. --page-left follows the sidebar:
  // its width when open, 0 when collapsed or on phones. --own-pad keeps
  // each background's own spacing on top of that.
  const pageStyle = document.createElement('style');
  pageStyle.textContent = '.in-page-overlay { padding-left: calc(var(--page-left, 0px) + var(--own-pad, 16px)) !important; }'
    // a fixed-width box shrinks to the page area rather than spilling over the menu
    + ' .in-page-overlay > * { max-width: 100%; box-sizing: border-box; }';
  document.head.appendChild(pageStyle);

  function updatePageLeft() {
    const main = document.querySelector('.main');
    const left = main ? Math.max(0, Math.round(main.getBoundingClientRect().left)) : 0;
    document.documentElement.style.setProperty('--page-left', `${left}px`);
  }

  // Anything named like a modal/overlay, or fixed inline, that covers the whole window
  const CANDIDATES = '[class*="modal"], [class*="overlay"], [id*="modal"], [id*="overlay"], [style*="position:fixed"], [style*="position: fixed"]';
  function markOverlays(root = document) {
    const nodes = root.querySelectorAll ? [...root.querySelectorAll(CANDIDATES)] : [];
    if (root.matches?.(CANDIDATES)) nodes.push(root);
    nodes.forEach(el => {
      if (el.classList.contains('in-page-overlay') || el.classList.contains('sidebar-overlay') || el.closest('#main-sidebar')) return;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' && s.top === '0px' && s.left === '0px' && s.right === '0px' && s.bottom === '0px') {
        el.style.setProperty('--own-pad', s.paddingLeft);
        el.classList.add('in-page-overlay');
      }
    });
  }

  function initPageArea() {
    updatePageLeft();
    markOverlays();
    const main = document.querySelector('.main');
    if (main && 'ResizeObserver' in window) new ResizeObserver(updatePageLeft).observe(main);
    window.addEventListener('resize', updatePageLeft);
    // the sidebar slides in/out; settle on its final position
    document.addEventListener('transitionend', e => { if (e.target === main || e.target.id === 'main-sidebar') updatePageLeft(); });
    // collapsing/opening the sidebar toggles a class on <body>: measure now and once it has slid
    new MutationObserver(() => { updatePageLeft(); setTimeout(updatePageLeft, 400); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // pop-ups added later (built by scripts) get the same treatment
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => n.nodeType === 1 && markOverlays(n))))
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPageArea);
  else initPageArea();

  // ── Notifications (toasts) never hide behind a pop-up ──
  // They sit bottom-right; when an open pop-up's box covers that corner, the
  // toast moves to the bottom-left of the screen instead.
  window.uiPlaceToast = function (toast) {
    if (!toast) return;
    toast.style.left = '';
    toast.style.right = '';
    const t = toast.getBoundingClientRect();
    const covered = [...document.querySelectorAll('.in-page-overlay, .ui-dialog-overlay')].some(overlay => {
      if (getComputedStyle(overlay).display === 'none' || !overlay.getClientRects().length) return false;
      return [...overlay.children].some(box => {
        const r = box.getBoundingClientRect();
        return r.width && r.height && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
      });
    });
    if (covered) { toast.style.left = '24px'; toast.style.right = 'auto'; }
  };
})();
