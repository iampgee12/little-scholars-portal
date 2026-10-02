// Score boxes (admin Results Grade Book, teacher Results Entry + entry panel).
// They are plain text boxes with a numeric keypad — no spinner arrows and no
// mouse-wheel changes — that only accept whole numbers up to the box's
// data-max (e.g. 40 for a Mid-Term test). ↑ / ↓ move to the score box above or
// below in the same column, like a spreadsheet.
(function () {
  const SCORE_BOX = 'input.score-field';

  function flashMax(input, max) {
    input.classList.add('score-over');
    input.title = `Max ${max}`;
    let tip = input.parentElement.querySelector('.score-max-tip');
    if (!tip) {
      tip = document.createElement('span');
      tip.className = 'score-max-tip';
      input.parentElement.style.position = input.parentElement.style.position || 'relative';
      input.parentElement.appendChild(tip);
    }
    tip.textContent = `Max ${max}`;
    clearTimeout(input._maxTimer);
    input._maxTimer = setTimeout(() => {
      input.classList.remove('score-over');
      tip.remove();
    }, 1400);
  }

  // Runs in the capture phase, before the box's own input handlers, so those
  // always see a clean value.
  document.addEventListener('input', e => {
    const input = e.target;
    if (!input.matches?.(SCORE_BOX)) return;
    const max = Number(input.dataset.max);
    const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const previous = input.dataset.prev ?? '';
    if (digits !== '' && max && Number(digits) > max) {
      input.value = previous;
      flashMax(input, max);
    } else {
      input.value = digits;
    }
    input.dataset.prev = input.value;
  }, true);

  document.addEventListener('focusin', e => {
    if (e.target.matches?.(SCORE_BOX)) e.target.dataset.prev = e.target.value;
  });

  document.addEventListener('keydown', e => {
    const input = e.target;
    if (!input.matches?.(SCORE_BOX) || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const column = input.dataset.col || '';
    const scope = input.closest('table, .entry-panel, .ep-score-row') || document;
    const boxes = [...scope.querySelectorAll(SCORE_BOX)]
      .filter(box => !box.disabled && box.offsetParent !== null && (box.dataset.col || '') === column);
    const next = boxes[boxes.indexOf(input) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      next.focus();
      next.select();
    }
  }, true);
})();
