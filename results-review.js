// Review Results (broadsheet) + bulk result sheets, shared by the admin portal
// and the class teacher's copy in the teacher portal. Each portal defines RR:
//   RR.role        'admin' | 'teacher'
//   RR.api         '/api/admin' | '/api/teacher' (the server checks access)
//   RR.classLabel(code), RR.sessionLabel(), RR.openTab(tab)
//   RR.onBroadsheetLoaded(data)  optional hook (Publish buttons, status, lock)

// Bulk result viewer: every pupil in the class, each with a live HTML copy of
// their report sheet (same data and layout as the printed PDF, built from
// …/reports/class-sheets) and its own actions — mirrors the
// schoolsfocus "Bulk Students Result Checker".
let _crc = null; // { classCode, examType, classArmId, classLabel, data, sheets }
const _crcPdfCache = {};
let _crcRenderToken = 0;

// Admin reads its Class Result Checker filters; the teacher portal passes the
// class + exam in (opts) and a target element.
async function crcBulkView(opts = {}) {
  const classCode = opts.classCode ?? document.getElementById('crc-class').value;
  const examType  = opts.examType ?? document.getElementById('crc-exam').value;
  const classArmId = opts.classArmId ?? (document.getElementById('crc-arm')?.value || '');
  if (!classCode || !examType) return;

  const area = opts.area || document.getElementById('crc-results-area');
  area.innerHTML = `<div class="crc-fetching"><div class="crc-spinner"></div><div style="color:#0d6efd;font-weight:600;">Fetching results</div>
    <div>Viewing results in bulk takes a bit more time to load.<br>Please be patient while the system fetches the results.</div></div>`;
  const token = ++_crcRenderToken;

  try {
    const qs = new URLSearchParams({ classCode, examType });
    if (classArmId) qs.set('classArmId', classArmId);
    const [data, sheetData] = await Promise.all([
      apiFetch(`${RR.api}/broadsheet?${qs}`),
      apiFetch(`${RR.api}/reports/class-sheets?${qs}`),
    ]);
    if (token !== _crcRenderToken) return; // a newer search replaced this one
    const sheets = sheetData.sheets || [];
    if (!sheets.length) {
      area.innerHTML = '<div class="card"><div class="card-body" style="padding:24px;color:var(--text-3);text-align:center">No pupils in this class.</div></div>';
      return;
    }
    const classLabel = RR.classLabel(classCode);
    _crc = { classCode, examType, classArmId, classLabel, data, sheets };
    Object.keys(_crcPdfCache).forEach(k => delete _crcPdfCache[k]);
    const withResults = sheets.filter(s => s.hasResults).length;

    area.innerHTML = `
      <div class="crc-toolbar">
        <span class="crc-count">${sheets.length} pupil${sheets.length === 1 ? '' : 's'} · ${withResults} with results · ${escapeHtml(classLabel)} · ${escapeHtml(examType)}</span>
        <button class="bs-print-btn" id="crc-print-all" onclick="crcPrintAll(this)" ${withResults ? '' : 'disabled'}>Print all Results</button>
      </div>
      ${sheets.map(sheet => crcRowHtml(sheet)).join('')}
      <button class="crc-top-btn" onclick="this.closest('.tab-panel').scrollIntoView({behavior:'smooth'})">&#x2191; Back to Top</button>`;
  } catch (e) {
    if (token === _crcRenderToken) {
      area.innerHTML = `<div class="card"><div class="card-body" style="padding:24px;color:#f87171;text-align:center">${escapeHtml(e.message)}</div></div>`;
    }
  }
}

function crcRowHtml(sheet) {
  const id = escapeHtml(sheet.studentId);
  const st = crcStudent(sheet.studentId);
  const parentEmail = sheet.parentEmail ? escapeHtml(sheet.parentEmail) : '';
  const off = sheet.hasResults ? '' : 'disabled title="No scores entered yet for this exam"';
  const isAdmin = RR.role === 'admin'; // class teachers get Print + PDF only
  return `<div class="crc-row" id="crc-row-${id}">
    <div class="crc-sheet">
      ${sheet.hasResults ? '' : `<div class="crc-empty-note">No ${escapeHtml(_crc.examType)} scores have been entered for ${escapeHtml(sheet.name)} yet.</div>`}
      ${crcSheetHtml(sheet)}
    </div>
    <div class="crc-actions">
      <div class="crc-who"><strong>${escapeHtml(sheet.name)}</strong><span>${id}${sheet.hasResults && st ? ` · Position ${escapeHtml(String(st.position))}` : ''}</span></div>
      ${isAdmin ? `<button class="crc-act" onclick="crcAnalysis('${id}')" ${off}>Result Analysis</button>` : ''}
      <button class="crc-act" onclick="crcPrint('${id}', this)" ${off}>Print Result</button>
      <div class="crc-dd">
        <button class="crc-act" onclick="crcToggleDd(this)" ${off}>Get as PDF &#x25BE;</button>
        <div class="crc-dd-menu">
          <button onclick="crcViewPdf('${id}')">View PDF</button>
          <button onclick="crcDownloadPdf('${id}')">Download PDF</button>
        </div>
      </div>
      ${isAdmin ? crcAdminActionsHtml(id, parentEmail, off) : ''}
    </div>
  </div>`;
}

function crcAdminActionsHtml(id, parentEmail, off) {
  return `<div class="crc-dd">
        <button class="crc-act" onclick="crcToggleDd(this)" ${off}>Send to Email &#x25BE;</button>
        <div class="crc-dd-menu">
          ${parentEmail
            ? `<button onclick="crcEmail('${id}', '')">To Parent / Guardian<small>${parentEmail}</small></button>`
            : '<button disabled>To Parent / Guardian<small>No parent email on file</small></button>'}
          <button onclick="crcEmailOther('${id}')">To Other Email</button>
        </div>
      </div>
      <div class="crc-dd">
        <button class="crc-act" onclick="crcToggleDd(this)" ${off}>To WhatsApp &#x25BE;</button>
        <div class="crc-dd-menu">
          <button onclick="crcWhatsApp('${id}', '')">Send from My Phone / Device</button>
          <button onclick="crcWhatsAppOther('${id}')">To Other WhatsApp Number</button>
        </div>
      </div>
      <button class="crc-act" onclick="crcFees('${id}')">Student's Fees</button>`;
}

// ── On-screen report sheet ──
// The server sends each pupil's sheet as the very drawing list the PDF is made
// from (report-sheet.js); here each page becomes one SVG, so the screen shows
// exactly what prints and what parents receive.
const RS_FONT = {
  regular: 'font-weight="400"',
  semibold: 'font-weight="600"',
  bold: 'font-weight="700"',
  italic: 'font-style="italic"',
  boldItalic: 'font-weight="700" font-style="italic"',
};

function rsSvgPage(items, width, height) {
  const n = v => Math.round(v * 100) / 100;
  const body = items.map(it => {
    if (it.t === 'rect') {
      return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${it.fill || 'none'}"${it.stroke ? ` stroke="${it.stroke}" stroke-width="${it.sw}"` : ''}/>`;
    }
    if (it.t === 'line') {
      return `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${it.c}" stroke-width="${it.w}"/>`;
    }
    if (it.t === 'text') {
      // the layout's angles turn anticlockwise (PDF); SVG turns clockwise
      const turn = it.r ? ` transform="rotate(${-it.r} ${n(it.x)} ${n(it.y)})"` : '';
      return `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${n(it.size)}" fill="${it.c}" ${RS_FONT[it.f] || ''}${turn}>${escapeHtml(it.s)}</text>`;
    }
    if (it.t === 'path') {
      return `<path d="${it.d}" fill="${it.c}" transform="translate(${n(it.x)} ${n(it.y)}) scale(${it.k})"/>`;
    }
    if (it.t === 'img') {
      return `<image href="/${escapeHtml(it.src)}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="${it.fit === 'fill' ? 'none' : 'xMidYMid meet'}"${it.opacity != null ? ` opacity="${it.opacity}"` : ''}/>`;
    }
    return '';
  }).join('');
  return `<svg class="rs-page" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function crcSheetHtml(s) {
  const { width, height, pages } = s.layout;
  return `<div class="rs-sheet">${pages.map(items => rsSvgPage(items, width, height)).join('')}</div>`;
}

function crcStudent(id) {
  return _crc?.data.students.find(s => s.id === id);
}

async function crcPdfBlob(id) {
  if (_crcPdfCache[id]) return _crcPdfCache[id];
  const params = new URLSearchParams({ studentId: id, classCode: _crc.classCode, examType: _crc.examType });
  const res = await fetch(`${RR.api}/reports/preview?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not generate this result');
  }
  _crcPdfCache[id] = await res.blob();
  return _crcPdfCache[id];
}

function crcToggleDd(btn) {
  const dd = btn.parentElement;
  const open = !dd.classList.contains('open');
  document.querySelectorAll('.crc-dd.open').forEach(d => d.classList.remove('open'));
  if (open) dd.classList.add('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.crc-dd')) document.querySelectorAll('.crc-dd.open').forEach(d => d.classList.remove('open'));
  else if (e.target.closest('.crc-dd-menu button')) e.target.closest('.crc-dd').classList.remove('open');
});

function crcPrintBlob(blob) {
  let frame = document.getElementById('crc-print-frame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = 'crc-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const url = URL.createObjectURL(blob);
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { window.open(url, '_blank'); } // some browsers block printing PDFs in frames
  };
  frame.src = url;
  document.body.appendChild(frame);
}

async function crcBusy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (err) { showToast(err.message); } finally { if (btn) btn.disabled = false; }
}

function crcPrint(id, btn) {
  return crcBusy(btn, async () => crcPrintBlob(await crcPdfBlob(id)));
}

function crcPrintAll(btn) {
  return crcBusy(btn, async () => {
    const label = btn.innerHTML;
    btn.innerHTML = 'Preparing all results…';
    try {
      const params = new URLSearchParams({ classCode: _crc.classCode, examType: _crc.examType });
      if (_crc.classArmId) params.set('classArmId', _crc.classArmId);
      const res = await fetch(`${RR.api}/reports/class-pdf?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not prepare results');
      crcPrintBlob(await res.blob());
    } finally {
      btn.innerHTML = label;
    }
  });
}

function crcFileName(id) {
  const st = crcStudent(id);
  return `${(st?.name || id).replace(/[^a-z0-9]+/gi, '_')}_${_crc.examType.replace(/[^a-z0-9]+/gi, '_')}_result.pdf`;
}

async function crcViewPdf(id) {
  try { window.open(URL.createObjectURL(await crcPdfBlob(id)), '_blank'); } catch (err) { showToast(err.message); }
}

async function crcDownloadPdf(id) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await crcPdfBlob(id));
    a.download = crcFileName(id);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    showToast(err.message);
  }
}

// ── BROADSHEET ──

let _bsData = null;
let _bsView = 'full';
let _bsStudentsById = {};
let _bsCommentBank = null;

let GRADE_SCALE = [
  { min:80, grade:'A', remark:'Excellent', gradePoint:5.0 },
  { min:65, grade:'B', remark:'Very Good', gradePoint:4.0 },
  { min:55, grade:'C', remark:'Good', gradePoint:3.0 },
  { min:45, grade:'D', remark:'Fair', gradePoint:2.0 },
  { min:0,  grade:'F', remark:'Fail', gradePoint:0.0 },
];
function bsGrade(pct) { return GRADE_SCALE.find(g => pct >= g.min) || GRADE_SCALE.at(-1); }

// Older saved grade scales may predate the gradePoint field; fall back to the
// conventional 5/4/3/2/0 scale by letter so GPA never silently comes out as 0.
const GRADE_POINT_FALLBACK = { A: 5, B: 4, C: 3, D: 2, F: 0 };
function gradePointFor(band) {
  return Number.isFinite(band.gradePoint) ? band.gradePoint : (GRADE_POINT_FALLBACK[band.grade] ?? 0);
}

async function loadGradeScaleFromServer() {
  try {
    const data = await apiFetch(`${RR.api}/grade-scale`);
    if (Array.isArray(data.gradeScale) && data.gradeScale.length) {
      GRADE_SCALE = data.gradeScale.map(r => ({ min: Number(r.min), grade: r.grade, remark: r.remark, gradePoint: Number(r.gradePoint) }));
    }
    return data.gradeScale;
  } catch (err) {
    return null;
  }
}

function viewBroadsheet() {
  const sec = document.getElementById('bs-results-section');
  if (sec) sec.style.display = '';

  const classCode = document.getElementById('bs-class-sel')?.value;
  const examLabel = document.getElementById('bs-exam-sel')?.value;
  const session = document.getElementById('bs-session-sel')?.value || RR.sessionLabel() || '';
  const hdrTitle = document.getElementById('bs-hdr-title');
  if (hdrTitle) {
    hdrTitle.textContent = `${RR.classLabel(classCode)} Students Result for ${examLabel} (${session})  —  Master / Broad Sheet`;
  }

  RR.onBroadsheetView?.();
  loadBroadsheet();
}

function renderBroadsheetHeader(info = {}) {
  const schoolName = info.name || 'UNIQUE CHILDREN SCHOOL';
  const address = info.address || '';
  const email = info.email || '';
  const phone = info.phone || '';
  const website = info.website || '';

  const hdrName = document.getElementById('bs-hdr-name');
  const hdrAddr = document.getElementById('bs-hdr-address');
  const hdrContact = document.getElementById('bs-hdr-contact');

  if (hdrName) hdrName.textContent = schoolName.toUpperCase();
  if (hdrAddr) hdrAddr.textContent = address;
  if (hdrContact) {
    const parts = [];
    if (website) parts.push(`Website: ${website}`);
    if (phone) parts.push(`Phone: ${phone}`);
    if (email) parts.push(`Email: ${email}`);
    hdrContact.textContent = parts.join('  |  ');
  }
}

function setBsView(v) {
  _bsView = v;
  document.getElementById('bs-btn-full').classList.toggle('active', v==='full');
  document.getElementById('bs-btn-min').classList.toggle('active', v==='minimal');
  if (_bsData) renderBroadsheetTable(_bsData);
}

async function loadBroadsheet() {
  const classCode = document.getElementById('bs-class-sel').value;
  const examLabel = document.getElementById('bs-exam-sel').value;
  if (!classCode || !examLabel) return;

  document.getElementById('bs-table-outer').innerHTML =
    '<div style="padding:40px;text-align:center;color:var(--text-3);font-size:13px;">Loading broadsheet…</div>';
  document.getElementById('bs-summary').style.display = 'none';

  try {
    const data = await apiFetch(`${RR.api}/broadsheet?classCode=${encodeURIComponent(classCode)}&examType=${encodeURIComponent(examLabel)}`);
    _bsData = data;
    renderBroadsheetHeader(data.schoolInfo);
    if (!_bsCommentBank) {
      try {
        const cb = await apiFetch(`${RR.api}/comment-bank`);
        _bsCommentBank = cb.comments || [];
      } catch (e) { _bsCommentBank = []; }
    }
    renderBroadsheetPills(data);
    renderBroadsheetTable(data);
    renderBroadsheetSummary(data);
    RR.onBroadsheetLoaded?.(data);
  } catch(e) {
    document.getElementById('bs-table-outer').innerHTML =
      `<div style="padding:40px;text-align:center;color:#f87171;font-size:13px;">${e.message}</div>`;
  }
}

function renderBroadsheetPills(data) {
  const bar = document.getElementById('bs-pills');
  if (!bar) return;
  bar.innerHTML = (data.subjects||[]).map(s=>{
    const label = s.name.length>13 ? s.name.slice(0,12)+'…' : s.name;
    return `<span class="bs-pill" title="${s.name}">${label}</span>`;
  }).join('');
}

function previewStudentReport(studentId) {
  const classCode = document.getElementById('bs-class-sel')?.value;
  const examType = document.getElementById('bs-exam-sel')?.value;
  if (!classCode || !examType) {
    showToast('Select a class and exam first');
    return;
  }
  const params = new URLSearchParams({ studentId, classCode, examType });
  window.open(`${RR.api}/reports/preview?${params.toString()}`, '_blank', 'noopener');
}

function renderBroadsheetTable(data) {
  const subj     = data.subjects || [];
  const students = data.students || [];
  const matrix   = data.scoreMatrix || {};
  const subjectRanks = data.subjectRanks || {};
  const examType = data.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const isFinal  = examType === 'Final Exam';
  const subjMax  = data.subjMax || (isFinal ? 100 : 40);
  const minimal  = _bsView === 'minimal' || !isFinal;
  _bsStudentsById = {};
  students.forEach(st => { _bsStudentsById[st.id] = st; });

  function ordinal(n) {
    if (n == null) return '';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function remarkSelectHtml(studentId, currentValue, who = 'head') {
    const bank = _bsCommentBank || [];
    const current = currentValue || '';
    const matchesBank = bank.some(c => c.text === current);
    const customOption = (!matchesBank && current)
      ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current.length > 60 ? current.slice(0,60)+'…' : current)}</option>`
      : '';
    const bankOptions = bank.map(c =>
      `<option value="${escapeHtml(c.text)}" ${c.text === current ? 'selected' : ''}>${escapeHtml(c.text.length > 60 ? c.text.slice(0,60)+'…' : c.text)}</option>`
    ).join('');
    const saveFn = who === 'teacher' ? 'saveTeacherRemark' : 'saveHeadComment';
    return `<select class="bs-remark-select" id="bs-${who}-remark-${escapeHtml(studentId)}" data-student-id="${escapeHtml(studentId)}" onchange="${saveFn}('${escapeHtml(studentId)}', this)" ${who === 'teacher' && data.published ? 'disabled' : ''}>
      ${!current ? '<option value="">- Select Preset Comment -</option>' : ''}
      ${customOption}${bankOptions}
    </select>`;
  }

  function getGradeLetter(score) {
    if (score == null || score === '') return '—';
    const n = (Number(score) / subjMax) * 100;
    const found = GRADE_SCALE.find(g => n >= g.min);
    return found ? found.grade : '—';
  }

  const subjCols = minimal ? 1 : 3;

  // Row 1: sticky cols (rowspan 3) + subject group headers + trailing cols (rowspan 3)
  let thGroup = `
    <th class="bs-sticky bs-sticky-h bs-th-num" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">#</th>
    <th class="bs-sticky bs-sticky-h bs-th-name" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;text-align:left;">Students &#x2193;</th>
    <th class="bs-sticky bs-sticky-h bs-th-reg" rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Reg. No.</th>`;
  subj.forEach(s => {
    thGroup += `<th class="bs-th-subj" colspan="${subjCols}">${escapeHtml(s.name)}${RR.role === 'admin' ? `<button type="button" class="bs-subj-edit-btn" title="Edit assessment setup for ${escapeHtml(s.name)}" onclick="RR.openTab('scoreDivisions')">&#x270E;</button>` : ''}</th>`;
  });
  thGroup += `
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:55px;">Grand<br>Total</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:55px;">Grade<br>Point<br>Average</th>
    <th rowspan="3" class="bs-avg-cell" style="vertical-align:bottom;padding-bottom:8px;">Total Score Average %<br><small style="color:#2563eb;font-weight:400;font-size:9px;">(performance ranking)</small></th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:80px;">Result<br>Summary</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Position</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:180px;">Form Teacher's Remark</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:180px;">Head of School's Remark</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;min-width:70px;">Cognitive<br>Skills Report</th>
    <th class="bs-th-subj" colspan="3" style="min-width:90px;">Daily Attendance<br>Report</th>
    <th class="bs-th-subj" colspan="3" style="min-width:90px;">Lesson Attendance<br>Report</th>
    <th rowspan="3" style="vertical-align:bottom;padding-bottom:8px;">Preview<br>Result</th>`;

  // Row 2: rotated sub-col headers for subjects + attendance/cog sub-cols
  let thSub = '';
  if (!minimal) {
    subj.forEach(() => {
      thSub += `<th class="bs-th-rotated">Mid-Term Test (30%)<small style="display:block;font-size:8px;">(30)</small></th>
        <th class="bs-th-rotated">Examination (70%)<small style="display:block;font-size:8px;">(70)</small></th>
        <th class="bs-th-rotated">Total Score<small style="display:block;font-size:8px;">(100)</small></th>`;
    });
  } else {
    subj.forEach(() => {
      thSub += `<th class="bs-th-rotated">Total Score<small style="display:block;font-size:8px;">(${subjMax})</small></th>`;
    });
  }
  // Attendance sub-cols (T/P/A) — Daily then Lesson
  for (let i = 0; i < 2; i++) {
    thSub += `<th class="bs-th-rotated">T<small style="display:block;font-size:8px;">Total</small></th>
      <th class="bs-th-rotated">P<small style="display:block;font-size:8px;">Present</small></th>
      <th class="bs-th-rotated">A<small style="display:block;font-size:8px;">Absent</small></th>`;
  }

  // Row 3: score limits under subject sub-cols (blank for attendance)
  let thLimit = '';
  if (!minimal) {
    subj.forEach(() => {
      thLimit += `<th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(30)</th>
        <th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(70)</th>
        <th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(100)</th>`;
    });
  } else {
    subj.forEach(() => { thLimit += `<th style="font-size:9px;color:var(--text-3);padding:2px 4px;">(${subjMax})</th>`; });
  }
  for (let i = 0; i < 6; i++) thLimit += `<th></th>`;

  // Compute grand totals for ranking
  const studentTotals = students.map(st => {
    const scores = matrix[st.id] || {};
    let gt = 0, count = 0;
    subj.forEach(s => { const sc = scores[s.id]; if (sc && sc.tot != null) { gt += sc.tot; count++; } });
    return { st, gt, count };
  });
  studentTotals.sort((a,b) => b.gt - a.gt);
  const rankMap = {};
  studentTotals.forEach((item, i) => { rankMap[item.st.id] = i + 1; });

  // Body rows
  let tbody = '';
  students.forEach((st, idx) => {
    const scores = matrix[st.id] || {};
    let grandTotal = 0, subjectCount = 0, gpaSum = 0;

    let scoreCells = '';
    subj.forEach(s => {
      const sc = scores[s.id];
      if (sc && sc.tot != null) {
        grandTotal += sc.tot; subjectCount++;
        gpaSum += gradePointFor(bsGrade((sc.tot / subjMax) * 100));
      }
      const grade = sc && sc.tot != null ? getGradeLetter(sc.tot) : '';
      const hasScore = sc && sc.tot != null;
      const subjRank = hasScore ? subjectRanks[s.id]?.[st.id] : null;
      const rankBadge = subjRank ? `<br><small class="bs-subj-rank">${ordinal(subjRank)}</small>` : '';
      if (minimal) {
        scoreCells += `<td style="text-align:center;">${hasScore
          ? `<strong>${sc.tot}</strong><span class="bs-grade-badge">(${grade})</span>${rankBadge}`
          : '<span class="bs-excluded">—</span>'}</td>`;
      } else {
        const excluded = !hasScore;
        scoreCells += `<td style="text-align:center;">${excluded ? '<span class="bs-excluded">Excluded</span>' : (sc.ca ?? '—')}</td>`;
        scoreCells += `<td style="text-align:center;">${excluded ? '<span class="bs-excluded">—</span>' : (sc.ex ?? '—')}</td>`;
        scoreCells += `<td class="bs-score-total" style="text-align:center;">${hasScore
          ? `<strong>${sc.tot}</strong><span class="bs-grade-badge">(${grade})</span>${rankBadge}`
          : '<span class="bs-excluded">—</span>'}</td>`;
      }
    });

    const maxPossible = subjectCount * subjMax;
    const avgPct = maxPossible > 0 ? (grandTotal / maxPossible * 100).toFixed(3) : '0.000';
    const avgNum = parseFloat(avgPct);
    const gpa = subjectCount ? (gpaSum / subjectCount).toFixed(3) : '0.000';
    const g = bsGrade(avgNum);
    const pos = rankMap[st.id] || idx + 1;
    const posLabel = pos===1?'1st':pos===2?'2nd':pos===3?'3rd':`${pos}th`;
    const posClass = pos===1?'top1':pos===2?'top2':pos===3?'top3':'';
    const badgeClass = avgNum >= 70 ? '' : avgNum >= 50 ? 'fair' : 'poor';

    tbody += `<tr>
      <td class="bs-sticky bs-col-num">${idx + 1}</td>
      <td class="bs-sticky bs-col-name bs-td-name">
        ${st.photoPath
          ? `<img class="bs-avatar" src="/${escapeHtml(st.photoPath)}" alt="">`
          : `<span class="bs-avatar bs-avatar-fallback">${escapeHtml((st.initials || st.name || '?').slice(0,2))}</span>`}
        <span>${escapeHtml(st.name)}</span>
      </td>
      <td class="bs-sticky bs-col-reg bs-td-reg">${escapeHtml(st.id||'—')}</td>
      ${scoreCells}
      <td class="bs-score-total" style="text-align:center;">${grandTotal}${subjectCount?`<br><small style="color:var(--text-3);font-size:9px;">/ ${subjectCount*subjMax}</small>`:''}</td>
      <td style="text-align:center;font-weight:700;">${gpa}</td>
      <td class="bs-avg-cell">
        <div class="bs-avg-pct">${avgPct}%</div>
        <div class="bs-avg-sub">(${g.grade})</div>
        <div class="bs-avg-track"><div class="bs-avg-fill" style="width:${Math.min(avgNum,100)}%"></div></div>
      </td>
      <td style="text-align:center;"><span class="bs-summary-badge ${badgeClass}">${g.remark}</span></td>
      <td style="text-align:center;"><span class="bs-pos-badge ${posClass}">${posLabel}</span></td>
      ${RR.role === 'teacher'
        ? `<td class="bs-remark-td">
        ${remarkSelectHtml(st.id, st.savedTeacherComment, 'teacher')}
        <button type="button" class="bs-auto-remark-btn" title="Fill with a suggested comment based on this pupil's score" onclick="autoFillTeacherRemark('${escapeHtml(st.id)}')" ${data.published ? 'disabled' : ''}>&#x21bb; Auto Remark</button>
      </td>
      <td class="bs-remark-td" style="font-size:10px;color:var(--text-2);">${escapeHtml(st.headComment || '')}</td>`
        : `<td class="bs-remark-td" style="font-size:10px;color:var(--text-2);">${escapeHtml(st.teacherComment || '')}</td>
      <td class="bs-remark-td">
        ${remarkSelectHtml(st.id, st.headComment)}
        <button type="button" class="bs-auto-remark-btn" title="Fill with a suggested remark based on this student's score" onclick="autoFillHeadRemark('${escapeHtml(st.id)}')">&#x21bb; Auto Remark</button>
      </td>`}
      <td style="text-align:center;"><button class="bs-preview-btn" title="Open Cognitive Skills Assessment" onclick="RR.openTab('cognitiveSkills')"><svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l7-3 7 3-7 3z"/><path d="M4 7.5V11c0 1 1.8 2 4 2s4-1 4-2V7.5"/></svg></button></td>
      <td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.total ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.present ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.dailyAttendance?.absent ?? 0}</td>
      <td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.total ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.present ?? 0}</td><td class="bs-att-cell" style="text-align:center;">${st.lessonAttendance?.absent ?? 0}</td>
      <td style="text-align:center;"><button class="bs-preview-btn" title="Preview result" onclick="previewStudentReport('${escapeHtml(st.id)}')"><svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg></button></td>
    </tr>`;
  });

  const html = `<table class="bs-table" id="bs-table-el">
    <thead>
      <tr>${thGroup}</tr>
      <tr>${thSub}</tr>
      <tr>${thLimit}</tr>
    </thead>
    <tbody>${tbody || '<tr><td colspan="99" style="padding:30px;text-align:center;color:var(--text-3)">No results found.</td></tr>'}</tbody>
  </table>`;

  document.getElementById('bs-table-outer').innerHTML = html;
}

function filterBroadsheetTable() {
  const q = (document.getElementById('bs-search').value||'').toLowerCase();
  const tbl = document.getElementById('bs-table-el');
  if (!tbl) return;
  tbl.querySelectorAll('tbody tr').forEach(tr => {
    const name = (tr.cells[1]?.textContent||'').toLowerCase();
    const reg  = (tr.cells[2]?.textContent||'').toLowerCase();
    tr.style.display = (name.includes(q)||reg.includes(q)) ? '' : 'none';
  });
}

function renderBroadsheetSummary(data) {
  const subj = data.subjects || [];
  const stats = data.stats || {};
  const subjectStats = data.subjectStats || [];
  const students = data.students || [];
  const matrix = data.scoreMatrix || {};
  const studentCount = students.length;
  const examType = data.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax = data.subjMax || (examType === 'Final Exam' ? 100 : 40);

  // Compute per-subject totals for stats table
  const subjTotals = {};
  const subjBest = {};  // {name, score}
  const subjWorst = {}; // {name, score}
  subj.forEach(s => {
    subjTotals[s.id] = 0;
    subjBest[s.id] = null;
    subjWorst[s.id] = null;
  });
  students.forEach(st => {
    const scores = matrix[st.id] || {};
    subj.forEach(s => {
      const sc = scores[s.id];
      if (!sc || sc.tot == null) return;
      subjTotals[s.id] += sc.tot;
      if (!subjBest[s.id] || sc.tot > subjBest[s.id].score) subjBest[s.id] = { name: st.name, score: sc.tot };
      if (!subjWorst[s.id] || sc.tot < subjWorst[s.id].score) subjWorst[s.id] = { name: st.name, score: sc.tot };
    });
  });

  // Compute student grand totals for best-in-class
  const studentGT = students.map(st => {
    const scores = matrix[st.id] || {};
    let gt = 0, cnt = 0;
    subj.forEach(s => { const sc = scores[s.id]; if (sc && sc.tot != null) { gt += sc.tot; cnt++; } });
    return { name: st.name, gt, avg: cnt > 0 ? (gt / cnt).toFixed(2) : '0.00' };
  });
  studentGT.sort((a, b) => b.gt - a.gt);
  const best = studentGT[0];

  // Subject score averages
  const subjAvgs = subj.map(s => {
    const total = subjTotals[s.id] || 0;
    const cnt = students.filter(st => { const sc = (matrix[st.id]||{})[s.id]; return sc && sc.tot != null; }).length;
    return { s, total, cnt, avg: cnt > 0 ? (total / cnt).toFixed(2) : '0.00' };
  });

  const grandTotalSubjAvg = subjAvgs.reduce((a, v) => a + parseFloat(v.avg), 0).toFixed(2);
  const classScoreAvg = subj.length > 0 ? (parseFloat(grandTotalSubjAvg) / subj.length).toFixed(2) : '0.00';

  // Stats table
  const statsTbody = document.getElementById('bs-stats-tbody');
  if (statsTbody) {
    statsTbody.innerHTML = subjAvgs.map((item, i) => {
      const teacherEntry = (subjectStats[i] || {}).teacherName || '—';
      const best = subjBest[item.s.id];
      const worst = subjWorst[item.s.id];
      return `<tr>
        <td style="font-weight:600;">${escapeHtml(item.s.name)}</td>
        <td style="text-align:center;">${item.total}</td>
        <td style="text-align:center;">${item.cnt}</td>
        <td style="text-align:center;font-weight:700;font-family:'DM Mono',monospace;">${item.avg}</td>
        <td style="text-align:center;"><button class="bs-rank-btn" title="View ranking for ${escapeHtml(item.s.name)}" onclick="showSubjectRanking(${item.s.id}, '${escapeHtml(item.s.name)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button></td>
        <td style="color:#16a34a;font-size:11px;">${best ? `${escapeHtml(best.name)} (${best.score})` : '—'}</td>
        <td style="color:#dc2626;font-size:11px;">${worst && worst !== best ? `${escapeHtml(worst.name)} (${worst.score})` : '—'}</td>
        <td style="color:var(--text-3);">${teacherEntry}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--text-3)">No subject data.</td></tr>`;
  }

  // Footer stats
  const footAvg = document.getElementById('bs-foot-avg');
  const footCount = document.getElementById('bs-foot-count');
  const footClassAvg = document.getElementById('bs-foot-class-avg');
  if (footAvg) footAvg.textContent = grandTotalSubjAvg;
  if (footCount) footCount.textContent = studentCount;
  if (footClassAvg) footClassAvg.textContent = classScoreAvg;

  // Best student row
  const bestRow = document.getElementById('bs-best-student-row');
  if (bestRow && best) {
    bestRow.innerHTML = `
      <span>${escapeHtml(best.name)}</span>
      <span>${best.gt} / ${subj.length * subjMax}</span>
      <span>${best.avg}</span>`;
  }

  document.getElementById('bs-summary').style.display = '';
}

function showSubjectRanking(subjectId, subjectName) {
  if (!_bsData) return;
  const students = _bsData.students || [];
  const matrix   = _bsData.scoreMatrix || {};
  const examType = _bsData.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax  = _bsData.subjMax || (examType === 'Final Exam' ? 100 : 40);

  const ranked = students
    .map(st => ({ name: st.name, score: matrix[st.id]?.[subjectId]?.tot ?? null }))
    .filter(r => r.score !== null)
    .sort((a, b) => b.score - a.score);

  const rows = ranked.map((r, i) => {
    const medal = '';
    const color = i === 0 ? 'var(--amber)' : i < 3 ? 'var(--text-2)' : 'var(--text-3)';
    return `<tr>
      <td class="rank-num" style="color:${color};">${medal || (i + 1)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="rank-score" style="color:${i === 0 ? 'var(--green)' : 'var(--text-1)'};">${r.score}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--text-3);">No scores recorded.</td></tr>`;

  const modal = document.createElement('div');
  modal.className = 'rank-modal-overlay';
  modal.innerHTML = `
    <div class="rank-modal">
      <div class="rank-modal-head">
        <span class="rank-modal-title">Performance Ranking — ${escapeHtml(subjectName)}</span>
        <button class="rank-modal-close" onclick="this.closest('.rank-modal-overlay').remove()">&#x2715;</button>
      </div>
      <div class="rank-modal-body">
        <table class="rank-table">
          <thead><tr><th>#</th><th>Student</th><th>Score / ${subjMax}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function exportBroadsheetCSV() {
  if (!_bsData) { showToast('Load a broadsheet first','warn'); return; }
  const subj     = _bsData.subjects || [];
  const students = _bsData.students || [];
  const matrix   = _bsData.scoreMatrix || {};
  const examType = _bsData.examType || document.getElementById('bs-exam-sel')?.value || 'Final Exam';
  const subjMax  = _bsData.subjMax || (examType === 'Final Exam' ? 100 : 40);

  const headers = ['#','Name','Reg No',...subj.map(s=>s.name+' Total'),'Grand Total','Avg%'];
  const rows = students.map((st,i) => {
    const scores = matrix[st.id]||{};
    const totals = subj.map(s => scores[s.id]?.tot ?? '');
    const grand  = totals.reduce((a,v) => a + (Number(v)||0), 0);
    const maxP   = subj.length * subjMax;
    const avg    = maxP > 0 ? Math.round(grand/maxP*100) : 0;
    return [i+1, st.name, st.id||'', ...totals, grand, avg+'%'];
  });

  const csv = [headers, ...rows].map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'broadsheet.csv';
  a.click();
}

