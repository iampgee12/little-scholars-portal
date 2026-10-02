// Shared by the admin, teacher and pupil portals.

// Shrinks a photo (often 3–5 MB straight off a phone) to a small JPEG before
// upload. Keeps uploads under the server's 1 MB request limit and makes pages
// with many pupil photos load quickly. Photos are cropped to a square
// (centred, nudged towards the top where the face usually is) so circles and
// the result sheet's photo box show them undistorted.
function imageToSmallDataUrl(file, maxSide = 480, square = true) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(file.name)) {
      return reject(new Error(`"${file.name}" is not an image`));
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const side = Math.min(w, h);
      const src = square
        ? { x: (w - side) / 2, y: (h - side) * 0.3, w: side, h: side }
        : { x: 0, y: 0, w, h };
      const scale = Math.min(1, maxSide / Math.max(src.w, src.h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(src.w * scale));
      canvas.height = Math.max(1, Math.round(src.h * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Couldn't open "${file.name}" — use a JPG or PNG photo`));
    };
    img.src = url;
  });
}

// For <input type="file"> photo fields.
function photoInputToDataUrl(inputId, maxSide) {
  return imageToSmallDataUrl(document.getElementById(inputId)?.files?.[0], maxSide);
}

// A pupil's photo in a list, or their initials when there's no photo yet.
function pupilAvatar(pupil, cls = 'stu-av') {
  return pupil?.photoPath
    ? `<img class="${cls} pupil-photo" src="/${escapeHtml(pupil.photoPath)}" alt="" loading="lazy">`
    : `<span class="${cls}">${escapeHtml(pupil?.initials || '')}</span>`;
}

// ── Signature pad (Profile → Profile Update, class teachers + admin) ──
// Sign with a finger, stylus or mouse, or load a photo of a signature onto
// the pad. Saved as a tightly-cropped transparent PNG.
const sigPad = { canvas: null, ctx: null, drawing: false, dirty: false };

function sigInit() {
  const canvas = document.getElementById('sig-pad');
  if (!canvas) return;
  sigPad.canvas = canvas;
  sigPad.ctx = canvas.getContext('2d');
  sigClear();
  if (canvas.dataset.ready) return;
  canvas.dataset.ready = '1';
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    sigPad.drawing = true;
    const p = pos(e);
    sigPad.ctx.beginPath();
    sigPad.ctx.moveTo(p.x, p.y);
    sigPad.ctx.lineTo(p.x + 0.1, p.y + 0.1);
    sigPad.ctx.stroke();
    sigSetDirty(true);
  });
  canvas.addEventListener('pointermove', e => {
    if (!sigPad.drawing) return;
    const p = pos(e);
    sigPad.ctx.lineTo(p.x, p.y);
    sigPad.ctx.stroke();
  });
  const end = () => { sigPad.drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function sigSetDirty(dirty) {
  sigPad.dirty = dirty;
  const hint = document.getElementById('sig-hint');
  if (hint) hint.style.display = dirty ? 'none' : '';
}

function sigClear() {
  if (!sigPad.ctx) return;
  const { ctx, canvas } = sigPad;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  sigSetDirty(false);
}

// A photo of a signature is drawn onto the pad (fitted), so it can be checked first.
async function sigFromFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const dataUrl = await imageToSmallDataUrl(file, 900, false);
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    sigClear();
    const { ctx, canvas } = sigPad;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    // Paper → transparent: keep only the darker ink strokes.
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < px.data.length; i += 4) {
      const lum = 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2];
      if (lum > 165) px.data[i + 3] = 0;
    }
    ctx.putImageData(px, 0, 0);
    sigSetDirty(true);
  } catch (err) {
    showToast(err.message);
  }
}

// Crop to the signed area (plus a little margin) so it fills the signature box.
function sigToDataUrl() {
  const { canvas } = sigPad;
  const data = sigPad.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 10 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return '';
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(canvas.width - 1, maxX + pad); maxY = Math.min(canvas.height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function sigSave(btn, onSaved) {
  if (!sigPad.dirty) return showToast('Sign in the box (or upload a photo of your signature) first');
  const dataUrl = sigToDataUrl();
  if (!dataUrl) return showToast('The box looks empty — sign again');
  btn.disabled = true;
  try {
    const data = await apiFetch('/api/account/signature', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    sigClear();
    onSaved?.(data.signaturePath);
    showToast('Signature saved');
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
}
