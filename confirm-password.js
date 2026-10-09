// Asks the signed-in person to re-enter their password (e.g. before changing
// the email address that receives sign-in codes and reset links).
// Resolves with the typed password, or null if they cancel.
function askCurrentPassword(message = 'Enter your current password to continue.') {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;';
    wrap.innerHTML = `<div role="dialog" aria-modal="true" style="width:100%;max-width:360px;background:var(--black-2, #fff);border:1px solid var(--border, #e5e7eb);border-radius:12px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:'DM Sans',sans-serif;">
        <div style="font-size:15px;font-weight:700;color:var(--text-1, #111);margin-bottom:6px;">Confirm it's you</div>
        <div style="font-size:12.5px;color:var(--text-2, #555);line-height:1.5;margin-bottom:14px;"></div>
        <input type="password" autocomplete="current-password" class="field-input" style="width:100%;padding:10px 12px;" placeholder="Current password">
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button type="button" class="btn-outline" data-act="cancel">Cancel</button>
          <button type="button" class="post-btn" data-act="ok">Confirm</button>
        </div></div>`;
    wrap.querySelector('div > div:nth-child(2)').textContent = message;
    const input = wrap.querySelector('input');
    const done = value => { wrap.remove(); resolve(value); };
    wrap.querySelector('[data-act=cancel]').onclick = () => done(null);
    wrap.querySelector('[data-act=ok]').onclick = () => done(input.value || null);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value || null); if (e.key === 'Escape') done(null); });
    document.body.appendChild(wrap);
    input.focus();
  });
}
