// Pupil result sheet: one A4 layout, drawn two ways.
//
// layoutReportSheet(sheet) turns a pupil's sheet data into a flat list of
// drawing items (boxes, lines, text, pictures, icons) measured in PDF points
// from the TOP-LEFT of an A4 page. The same list is then
//   - drawn into the PDF here (drawLayoutPdf), for downloads, printing and
//     the parent email, and
//   - drawn as an SVG in the browser (results-review.js), for View Results,
// so the screen and the paper can never drift apart. Text is measured with
// the same Nunito font files both renderers use.

const fs = require('fs');
const path = require('path');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const X0 = 28;
const X1 = PAGE_W - 28;

const FONT_FILES = {
  regular: 'Nunito-Regular.ttf',
  semibold: 'Nunito-SemiBold.ttf',
  bold: 'Nunito-Bold.ttf',
  italic: 'Nunito-Italic.ttf',
  boldItalic: 'Nunito-BoldItalic.ttf',
};
const FONT_DIR = path.join(__dirname, 'report_assets', 'fonts');

const C = {
  blue: '#1d5c9b',
  text: '#1f2328',
  grid: '#a9a9a9',
  light: '#d4d4d4',
  frame: '#bdbdbd',
  white: '#ffffff',
  axis: '#ccd6eb',
  gridLine: '#e6e6e6',
  chartText: '#666666',
};
// Highcharts' default series colours, as on the sample sheet's chart
const BAR_COLORS = ['#7cb5ec', '#434348', '#90ed7d', '#f7a35c', '#8085e9', '#f15c80', '#e4d354', '#2b908f', '#f45b5b', '#91e8e1'];

// Minimal single-colour icons (24-unit boxes)
const ICONS = {
  pin: 'M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z',
  phone: 'M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3.6 4.2c-.5 0-1.4.7-1.4 2 0 3.7 5.9 9.6 9.6 9.6 1.3 0 2-.9 2-1.4 0-.3-.2-.5-.4-.6l-2.3-1.1c-.3-.1-.6 0-.8.2l-.8 1c-1.6-.8-2.9-2.1-3.7-3.7l1-.8c.2-.2.3-.5.2-.8L9.8 6.6c-.1-.3-.3-.4-.6-.4H7.6z',
  mail: 'M2 5a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v.4l-10 6.3L2 5.4V5zm0 2.8 9.5 6c.3.2.7.2 1 0l9.5-6V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.8z',
};

let fontCache = null;
function fontData() {
  if (!fontCache) {
    const fontkit = require('@pdf-lib/fontkit');
    fontCache = {};
    for (const [key, file] of Object.entries(FONT_FILES)) {
      const bytes = fs.readFileSync(path.join(FONT_DIR, file));
      fontCache[key] = { bytes, face: fontkit.create(bytes) };
    }
  }
  return fontCache;
}

function textWidth(str, font, size) {
  const { face } = fontData()[font];
  return (face.layout(String(str)).advanceWidth / face.unitsPerEm) * size;
}

function wrapText(str, font, size, maxW) {
  const lines = [];
  for (const para of String(str || '').split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, font, size) > maxW) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function layoutReportSheet(s) {
  const pages = [[]];
  let items = pages[0];

  const rect = (x, y, w, h, { fill, stroke, sw = 0.6 } = {}) => items.push({ t: 'rect', x, y, w, h, fill, stroke, sw });
  const line = (x1, y1, x2, y2, c = C.grid, w = 0.6) => items.push({ t: 'line', x1, y1, x2, y2, c, w });
  const image = (src, x, y, w, h, { fit = 'contain', opacity } = {}) => { if (src) items.push({ t: 'img', src, x, y, w, h, fit, opacity }); };
  const icon = (name, x, y, size, c = C.text) => items.push({ t: 'path', d: ICONS[name], x, y, k: size / 24, c });
  // Text at baseline y. Too wide for maxW → shrink a little, then trim with "…".
  const text = (value, x, y, { size = 7.6, font = 'regular', c = C.text, align = 'left', maxW, rotate } = {}) => {
    let str = String(value ?? '');
    if (!str) return 0;
    let fs = size;
    let w = textWidth(str, font, fs);
    if (maxW && w > maxW) {
      fs = Math.max(size * 0.78, size * (maxW / w));
      w = textWidth(str, font, fs);
      while (w > maxW && str.length > 1) { str = str.slice(0, -2) + '…'; w = textWidth(str, font, fs); }
    }
    const left = align === 'center' ? x - (w / 2) : align === 'right' ? x - w : x;
    items.push({ t: 'text', x: left, y, s: str, size: fs, f: font, c, r: rotate || 0 });
    return w;
  };
  const midBase = (top, h, size) => top + (h / 2) + (size * 0.34); // vertically centred baseline

  // ── Header: logo · school details · coat of arms ──
  const headTop = 26;
  const headH = 84;
  rect(X0, headTop, X1 - X0, headH, { stroke: C.frame });
  image('report_assets/school-logo.png', X0 + 9, headTop + 9, 60, 64, { fit: 'fill' });
  image('report_assets/sheet-coat-of-arms.jpg', X1 - 57, headTop + 9, 48, 62, { fit: 'fill' });
  const cx = PAGE_W / 2;
  text(s.school.name.toUpperCase(), cx, headTop + 21, { size: 14.5, font: 'bold', c: C.blue, align: 'center', maxW: 390 });
  const iconLine = (segments, base) => {
    const size = 8.4;
    const iconSize = 7.4;
    const segW = segments.map(([, label]) => iconSize + 3 + textWidth(label, 'italic', size));
    const total = segW.reduce((a, b) => a + b, 0) + (12 * (segments.length - 1));
    let x = cx - (total / 2);
    segments.forEach(([ic, label], i) => {
      icon(ic, x, base - iconSize + 0.8, iconSize);
      text(label, x + iconSize + 3, base, { size, font: 'italic' });
      x += segW[i] + 12;
    });
  };
  iconLine([['pin', s.school.address.toUpperCase()]], headTop + 35);
  iconLine([['globe', `Website : ${s.school.website}`], ['phone', `Phone : ${s.school.phone}`]], headTop + 48.5);
  iconLine([['mail', `Email : ${s.school.email}`]], headTop + 62);
  text(`Motto : ${s.school.motto || '-'}`, cx, headTop + 76, { size: 8.4, font: 'italic', align: 'center' });

  // ── Title band ──
  const bandTop = headTop + headH;
  rect(X0, bandTop, X1 - X0, 16.5, { fill: C.blue });
  text(s.heading, cx, bandTop + 11.4, { size: 8.6, font: 'bold', c: C.white, align: 'center' });

  // ── Pupil details: left table · photo · right table ──
  const infoTop = bandTop + 19;
  const infoRowH = 12.6;
  const infoH = infoRowH * 7;
  const L = { x: X0, label: 58, w: 226 };
  const P = { x: X0 + 226, w: 91 };
  const Rt = { x: P.x + P.w, label: 95, w: X1 - (P.x + P.w) };
  rect(L.x, infoTop, L.w, infoH, { stroke: C.frame });
  rect(P.x, infoTop, P.w, infoH, { stroke: C.frame });
  rect(Rt.x, infoTop, Rt.w, infoH, { stroke: C.frame });
  for (let i = 0; i < 7; i += 1) {
    const top = infoTop + (i * infoRowH);
    if (i) { line(L.x, top, L.x + L.w, top, C.light, 0.5); line(Rt.x, top, X1, top, C.light, 0.5); }
    const base = midBase(top, infoRowH, 7.4);
    const [ll, lv] = s.info.left[i] || [];
    if (ll) {
      text(ll, L.x + 6, base, { size: 7.4, font: 'bold' });
      text(lv, L.x + L.label + 6, base, { size: 7.4, maxW: L.w - L.label - 10 });
    }
    const [rl, rv, small] = s.info.right[i] || [];
    if (rl) {
      text(rl, Rt.x + 6, base, { size: 7.4, font: 'bold' });
      text(rv, Rt.x + Rt.label + 6, small ? base - 0.4 : base, { size: small ? 5.8 : 7.4, maxW: Rt.w - Rt.label - 10 });
    }
  }
  image(s.photoPath, P.x + 8, infoTop + 5, P.w - 16, infoH - 10);

  // ── Scores table (left) + skills and attendance (right) ──
  const tTop = infoTop + infoH + 3;
  const tLeft = X0;
  const tRight = 434.8;
  const panelX = tRight;
  const headerH = 58;
  const keyH = 37;
  // The skills panel beside the table needs room for its 21 rows, so a class
  // with few subjects gets blank ruled rows (like a printed form).
  const panelMin = 55 + 6 + (21 * 11.6);
  const rowH = s.subjects.length <= 16 ? 14 : Math.max(10.5, 224 / s.subjects.length);
  const n = Math.max(s.subjects.length, Math.ceil((panelMin - headerH - keyH) / rowH));
  const bodyTop = tTop + headerH;
  const keyTop = bodyTop + (n * rowH);
  const tBottom = keyTop + keyH;

  // watermark: the school logo, faint, behind the table
  image('report_assets/school-logo.png', 150, tTop + 40, 300, 201, { fit: 'fill', opacity: 0.07 });

  // columns: Subject · score columns · Score Grade · Grade Remark
  const scoreCols = s.columns; // [{ label, max, bold }]
  const colW = 27.1;
  const remarkW = 60.2;
  const subjectW = (tRight - tLeft) - remarkW - (colW * (scoreCols.length + 1));
  const cols = [{ key: 'subject', x: tLeft, w: subjectW }];
  let cxp = tLeft + subjectW;
  scoreCols.forEach((col, i) => { cols.push({ key: `c${i}`, x: cxp, w: colW, ...col }); cxp += colW; });
  cols.push({ key: 'grade', x: cxp, w: colW, label: 'Score Grade' }); cxp += colW;
  cols.push({ key: 'remark', x: cxp, w: remarkW });

  rect(tLeft, tTop, tRight - tLeft, tBottom - tTop, { stroke: C.grid });
  line(tLeft, bodyTop, tRight, bodyTop, C.grid, 0.8);
  cols.slice(1).forEach(col => line(col.x, tTop, col.x, keyTop, C.grid, 0.6));
  text('Subject', tLeft + (subjectW / 2), bodyTop - 5, { size: 7.6, font: 'bold', align: 'center' });
  text('Grade Remark', cols.at(-1).x + (remarkW / 2), bodyTop - 5, { size: 7.4, font: 'bold', align: 'center' });
  cols.slice(1, -1).forEach(col => {
    const bottomPad = col.max ? 13 : 5;
    // runs bottom-to-top, like the sample's turned headings
    text(col.label, col.x + (col.w / 2) + 2.7, bodyTop - bottomPad, { size: 7.4, rotate: 90, maxW: headerH - bottomPad - 4 });
    if (col.max) text(col.max, col.x + (col.w / 2), bodyTop - 4, { size: 5.6, align: 'center' });
  });

  for (let i = 1; i < n; i += 1) line(tLeft, bodyTop + (i * rowH), tRight, bodyTop + (i * rowH), C.grid, 0.5);
  s.subjects.forEach((row, i) => {
    const top = bodyTop + (i * rowH);
    const size = rowH < 12.5 ? 7 : 7.6;
    const base = midBase(top, rowH, size);
    text(row.subject, tLeft + 3, base, { size, maxW: subjectW - 6 });
    row.cells.forEach((value, c) => {
      const col = cols[c + 1];
      text(value, col.x + (col.w / 2), base, { size, font: col.bold ? 'bold' : 'regular', align: 'center' });
    });
    const g = cols.at(-2);
    text(row.grade, g.x + (g.w / 2), base, { size, align: 'center' });
    const r = cols.at(-1);
    text(row.remark, r.x + (r.w / 2), base, { size: size - 0.2, align: 'center', maxW: r.w - 4 });
  });

  // Key to Grades (two rows: "70-100: / A", then the remark)
  line(tLeft, keyTop, tRight, keyTop, C.grid, 0.8);
  const keyLabelW = 95;
  const bands = s.gradeKey.length ? s.gradeKey : [];
  const bandW = (tRight - tLeft - keyLabelW) / Math.max(bands.length, 1);
  const keyRow1 = 20;
  line(tLeft + keyLabelW, keyTop + keyRow1, tRight, keyTop + keyRow1, C.grid, 0.5);
  line(tLeft + keyLabelW, keyTop, tLeft + keyLabelW, tBottom, C.grid, 0.6);
  text('Key to Grades', tLeft + (keyLabelW / 2), midBase(keyTop, keyRow1, 7.6), { size: 7.6, font: 'bold', align: 'center' });
  bands.forEach((band, i) => {
    const bx = tLeft + keyLabelW + (i * bandW);
    if (i) line(bx, keyTop, bx, tBottom, C.grid, 0.5);
    text(band.range, bx + (bandW / 2), keyTop + 8.4, { size: 7.2, align: 'center' });
    text(band.grade, bx + (bandW / 2), keyTop + 16.6, { size: 7.2, align: 'center' });
    text(band.remark, bx + (bandW / 2), midBase(keyTop + keyRow1, keyH - keyRow1, 7.2), { size: 7.2, align: 'center', maxW: bandW - 4 });
  });

  // Skills + attendance panel, same height as the table
  const panelW = X1 - panelX;
  rect(panelX, tTop, panelW, tBottom - tTop, { stroke: C.grid });
  const sectionHeads = 21 + 21 + 13;
  const sRow = (tBottom - tTop - sectionHeads - 6) / 21;
  let y = tTop + 1.5;
  const sectionHead = (title, sub) => {
    const h = sub ? 21 : 13;
    rect(panelX + 1.5, y, panelW - 3, h - 1, { fill: C.blue });
    text(title, panelX + 5, sub ? y + 9 : midBase(y, h - 1, 7.4), { size: 7.4, font: 'bold', c: C.white });
    if (sub) text(sub, panelX + 5, y + 17, { size: 5.8, c: C.white });
    y += h;
  };
  const skillRow = (label, value, valueLeftAt) => {
    const base = midBase(y, sRow, 7.2);
    text(label, panelX + 4, base, { size: 7.2, maxW: panelW - 30 });
    if (valueLeftAt) text(value, valueLeftAt, base, { size: 7.2 });
    else text(value, X1 - 6, base, { size: 7.2, align: 'right' });
    y += sRow;
    line(panelX + 1.5, y, X1 - 1.5, y, C.light, 0.5);
  };
  sectionHead('Affective Skills Rating', '(Scale of 1-to-5)');
  s.affective.forEach(r => skillRow(r.label, r.rating));
  y += 1.5;
  sectionHead('Psychomotor Skills Rating', '(Scale of 1-to-5)');
  s.psychomotor.forEach(r => skillRow(r.label, r.rating));
  y += 1.5;
  sectionHead('Attendance Report');
  s.attendance.forEach(([label, value]) => skillRow(label, value, panelX + 88));

  // ── Comments, signatures, next term, footer (sized first; the chart gets the rest) ──
  const textW = X1 - X0 - 20;
  const teacherLines = wrapText(s.comments.teacherComment || '-', 'regular', 8, textW);
  const headLabel = "Head of School's Comment :";
  const headLabelW = textWidth(headLabel, 'boldItalic', 8) + 5;
  const headLines = wrapText(s.comments.headComment || '-', 'regular', 8, textW - headLabelW);
  const sigRowH = 34;
  const commentsH = 14 + (teacherLines.length * 11) + 4 + sigRowH + 4 + (headLines.length * 11) + 6 + sigRowH;
  const footH = 32;
  const pageBottom = PAGE_H - 18;
  let chartTop = tBottom + 3;
  let chartH = pageBottom - footH - commentsH - chartTop;
  let commentsOnNewPage = false;
  if (chartH < 120) { chartH = 200; commentsOnNewPage = true; }

  // ── Subjects performance chart ──
  const chartBottom = chartTop + chartH;
  rect(X0, chartTop, X1 - X0, chartH, { stroke: C.frame });
  text('SUBJECTS PERFORMANCE CHART', cx, chartTop + 13, { size: 8, font: 'bold', c: '#333333', align: 'center' });
  const plotL = X0 + 56;
  const plotR = X1 - 6;
  const plotT = chartTop + 30;
  const plotB = chartBottom - 50;
  const plotH = plotB - plotT;
  [0, 50, 100].forEach(mark => {
    const gy = plotB - (plotH * mark / 100);
    line(plotL, gy, plotR, gy, mark ? C.gridLine : C.axis, mark ? 0.6 : 0.9);
    text(String(mark), plotL - 8, gy + 2.6, { size: 7.6, c: C.chartText, align: 'right' });
  });
  const axisLabel = 'Score (%)';
  text(axisLabel, X0 + 20, plotT + (plotH / 2) + (textWidth(axisLabel, 'regular', 8) / 2), { size: 8, c: C.chartText, rotate: 90 });
  const bars = s.chart;
  const slot = (plotR - plotL) / Math.max(bars.length, 1);
  const barW = Math.min(14, slot * 0.55);
  bars.forEach((bar, i) => {
    const bx = plotL + (slot * i);
    line(bx, plotB, bx, plotB + 4, C.axis, 0.6);
    const value = Math.max(0, Math.min(100, Number(bar.value) || 0));
    const h = plotH * value / 100;
    const barX = bx + ((slot - barW) / 2);
    if (h > 0) rect(barX, plotB - h, barW, h, { fill: BAR_COLORS[i % BAR_COLORS.length] });
    if (bar.label !== '') text(bar.label, barX + (barW / 2), plotB - h - 3, { size: 7.4, font: 'bold', c: '#000000', align: 'center' });
    // subject name, slanted and ending under its bar; at this angle neighbouring names run parallel and never touch
    const angle = 32;
    const rad = angle * Math.PI / 180;
    const size = 7.4;
    const maxW = 40 / Math.sin(rad); // stays inside the chart box
    let name = bar.subject;
    while (name.length > 3 && textWidth(name, 'regular', size) > maxW) name = name.slice(0, -2) + '…';
    const w = textWidth(name, 'regular', size);
    const endX = bx + (slot / 2);
    const endY = plotB + 8;
    text(name, endX - (w * Math.cos(rad)), endY + (w * Math.sin(rad)), { size, c: C.chartText, rotate: angle });
  });
  line(X1 - 0.3, plotB, X1 - 0.3, plotB + 4, C.axis, 0.6);

  // ── Comments + signatures ──
  if (commentsOnNewPage) { items = []; pages.push(items); }
  const cTop = commentsOnNewPage ? 28 : chartBottom;
  let cy = cTop;
  const cx0 = X0 + 10;
  text("Form Teacher's Comment :", cx0, cy + 11, { size: 8, font: 'boldItalic' });
  cy += 14;
  teacherLines.forEach(l => { text(l, cx0, cy + 8.5, { size: 8 }); cy += 11; });
  cy += 4;
  const doubleRule = at => { line(X0 + 6, at, X1 - 6, at, C.grid, 0.6); line(X0 + 6, at + 1.6, X1 - 6, at + 1.6, C.light, 0.5); };
  doubleRule(cy);
  const sigX = 352;
  const nameRow = (label, name, sigLabel, sigPath) => {
    const base = cy + sigRowH - 7;
    const lw = text(label, cx0, base, { size: 8, font: 'boldItalic' });
    text(name, cx0 + lw + 5, base, { size: 8, maxW: sigX - cx0 - lw - 15 });
    const sw = text(sigLabel, sigX, base, { size: 8, font: 'boldItalic' });
    image(sigPath, sigX + sw + 6, cy + 3, 70, sigRowH - 6);
    cy += sigRowH;
    doubleRule(cy);
  };
  nameRow('Form Teacher :', s.comments.formTeacherName, "Form Teacher's Signature :", s.comments.teacherSignaturePath);
  cy += 4;
  text(headLabel, cx0, cy + 9.5, { size: 8, font: 'boldItalic' });
  headLines.forEach(l => { text(l, cx0 + headLabelW, cy + 9.5, { size: 8 }); cy += 11; });
  cy += 6;
  doubleRule(cy);
  nameRow('Head of School:', s.comments.headName, "Head of School's Signature :", s.comments.headSignaturePath);
  // side borders of the comments box (the chart's frame continues around it)
  line(X0, cTop, X0, cy, C.frame, 0.6);
  line(X1, cTop, X1, cy, C.frame, 0.6);
  line(X0, cy, X1, cy, C.frame, 0.6);

  // ── Next term + footer ──
  const nBase = cy + 11;
  const nw = text('Next Term is: ', X0, nBase, { size: 8 });
  text(s.nextTerm.term, X0 + nw, nBase, { size: 8, font: 'bold', maxW: 270 - nw });
  const bw = text('Next Term Begins: ', 335, nBase, { size: 8 });
  text(s.nextTerm.begins, 335 + bw, nBase, { size: 8, font: 'bold', maxW: X1 - 335 - bw });
  line(X0, nBase + 5, X1, nBase + 5, C.light, 0.5);
  text(`Printed : ${s.printedAt}`, X0, nBase + 14, { size: 6.6 });

  return { width: PAGE_W, height: PAGE_H, pages };
}

// ── PDF renderer ──
function hexColor(rgb, hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

// Draws a layout into pdfDoc (one PDF page per layout page). `loadImage(src)`
// returns an embedded pdf-lib image or null.
async function drawLayoutPdf(pdfDoc, layout, loadImage) {
  const { rgb, degrees } = require('pdf-lib');
  pdfDoc.registerFontkit(require('@pdf-lib/fontkit'));
  const fonts = {};
  for (const [key, { bytes }] of Object.entries(fontData())) {
    fonts[key] = await pdfDoc.embedFont(bytes, { subset: true });
  }
  const images = {};
  const H = layout.height;
  for (const pageItems of layout.pages) {
    const page = pdfDoc.addPage([layout.width, layout.height]);
    for (const it of pageItems) {
      if (it.t === 'rect') {
        page.drawRectangle({
          x: it.x, y: H - it.y - it.h, width: it.w, height: it.h,
          color: it.fill ? hexColor(rgb, it.fill) : undefined,
          borderColor: it.stroke ? hexColor(rgb, it.stroke) : undefined,
          borderWidth: it.stroke ? it.sw : 0,
        });
      } else if (it.t === 'line') {
        page.drawLine({ start: { x: it.x1, y: H - it.y1 }, end: { x: it.x2, y: H - it.y2 }, thickness: it.w, color: hexColor(rgb, it.c) });
      } else if (it.t === 'text') {
        page.drawText(it.s, { x: it.x, y: H - it.y, size: it.size, font: fonts[it.f], color: hexColor(rgb, it.c), rotate: it.r ? degrees(it.r) : undefined });
      } else if (it.t === 'path') {
        page.drawSvgPath(it.d, { x: it.x, y: H - it.y, scale: it.k, color: hexColor(rgb, it.c), borderWidth: 0 });
      } else if (it.t === 'img') {
        if (!(it.src in images)) images[it.src] = await loadImage(it.src);
        const img = images[it.src];
        if (!img) continue;
        let { x, y, w, h } = it;
        if (it.fit === 'contain') {
          const fit = img.scaleToFit(w, h);
          x += (w - fit.width) / 2;
          y += (h - fit.height) / 2;
          w = fit.width;
          h = fit.height;
        }
        page.drawImage(img, { x, y: H - y - h, width: w, height: h, opacity: it.opacity ?? 1 });
      }
    }
  }
}

module.exports = { layoutReportSheet, drawLayoutPdf, PAGE_W, PAGE_H };
