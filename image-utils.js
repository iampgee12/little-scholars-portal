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
