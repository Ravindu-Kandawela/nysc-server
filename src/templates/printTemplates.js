'use strict';
/**
 * Official NYSC print templates.
 *
 * These reproduce the paper forms supplied by the centre:
 *   - monthly_report_form.pdf  (උපදේශක සටහන් — page 1 landscape, page 2 portrait)
 *   - Check List A.pdf         (Continue Assessment Check List — landscape)
 *
 * Templates are pure functions (data in → HTML string out) so they can be
 * previewed in the browser and rendered to PDF by pdfService (cssPageSize mode).
 */

const SI_MONTHS = [
  'ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි',
  'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'
];

const DEFAULT_APPROVER = 'යූ.එම්.ආර්. නිරෝෂා';
const DEFAULT_APPROVER_TITLE = 'මධ්‍යස්ථාන භාර නිලධාරී';
const DOTS = '...................................';

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain YYYY-MM-DD → parts (no Date objects, per design rule #1) */
function parts(ymd) {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-');
  return { y, m: Number(m), d: Number(d), mm: m, dd: d };
}

function fmtHours(h) {
  const n = Number(h) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fillOrDots(v) {
  return v ? esc(v) : DOTS;
}

/** Split a name over two lines like the official sheet ("B.L.Pasindu" / "Madushanka") */
function splitName(full) {
  const words = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [words[0] || '', ''];
  return [words.slice(0, -1).join(' '), words[words.length - 1]];
}

const TOOLBAR_CSS = `
  .no-print-bar {
    background: #0f172a; color: #fff; padding: 10px 24px;
    display: flex; justify-content: space-between; align-items: center;
    position: sticky; top: 0; z-index: 1000;
    font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; font-weight: 400;
  }
  .no-print-bar .btn {
    background: #2563eb; color: #fff; border: none; padding: 7px 14px; border-radius: 6px;
    cursor: pointer; font-weight: 600; margin-left: 8px; text-decoration: none; font-size: 13px;
    font-family: inherit;
  }
  .no-print-bar .btn-secondary { background: #475569; }
  @media screen {
    html { background: #cbd5e1; }
    .sheet { background: #fff; margin: 18px auto; box-shadow: 0 4px 18px rgba(0,0,0,.25); box-sizing: border-box; }
  }
  @media print {
    .no-print { display: none !important; }
    .sheet { margin: 0; box-shadow: none; }
  }
`;

function toolbar(title, pdfHref) {
  return `
  <div class="no-print no-print-bar">
    <div><strong>${title}</strong></div>
    <div>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ Print</button>
      <a href="${pdfHref}" class="btn">⬇️ Download PDF</a>
    </div>
  </div>`;
}

// =====================================================================
// MONTHLY REPORT (උපදේශක සටහන්) — 2 pages
// =====================================================================
function renderMonthlyReport({ batch, settings = {}, page1, page2, period, pdfHref = '#', minDiaryRows = 14 }) {
  const f = parts(period.from);
  const t = parts(period.to);
  const reportMonth = SI_MONTHS[t.m - 1] || '';
  const year = t.y || f.y || '';

  const courseName = settings.course_title || batch.name;
  const teacherName = settings.teacher_name || '';
  const centreTitle = settings.form_centre_si || 'අකුරැස්ස පුහුණු මධ්‍යස්ථානය';
  const centreShort = settings.centre_short_si || 'අකුරැස්ස';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.center_in_charge_title || DEFAULT_APPROVER_TITLE;

  // Declaration line: "2026 සැප්තැම්බර් මස 27 සිට ඔක්තෝබර් 26 දින දක්වා ..."
  const fromMonth = SI_MONTHS[f.m - 1] || '';
  const toPart = f.m === t.m ? `${t.dd}` : `${reportMonth} ${t.dd}`;
  const declaration = `${esc(f.y)} ${fromMonth} මස ${esc(f.dd)} සිට ${toPart} දින දක්වා පසුගිය මස ප්‍රගතිය මෙයින් ඉදිරිපත් කරමි.`;

  // ---- Page 1 module/hour lists (one data row, like the paper form) ----
  const moduleList = (key, totalVal, onlyNonZero) => {
    const rows = page1.rows.filter(r => !onlyNonZero || Number(r[key]) > 0);
    const lines = rows.map(r =>
      `<div class="li"><span>${esc(r.code)}</span><span>${fmtHours(r[key])}</span></div>`
    ).join('');
    // long lists flow into two mini-columns so the page stays a single sheet
    const cls = rows.length > 8 ? 'lists two' : 'lists';
    return `<div class="${cls}">${lines || '<div class="li"><span>-</span><span></span></div>'}</div>
      <div class="li tot"><span>එකතුව</span><span>${fmtHours(totalVal)}</span></div>`;
  };
  const tt = page1.totals;

  // ---- Page 2 diary rows (padded to look like the blank form) ----
  const diaryRows = page2.rows.map(r => {
    const p = parts(r.date);
    return `
      <td class="c date">${esc(p.y)}<br>${esc(p.mm)}.${esc(p.dd)}</td>
      <td>${esc(r.summary)}</td>
      <td>${esc(r.activities)}</td>
      <td class="c tm">${esc(r.time_text)}</td>
      <td class="c">${fmtHours(r.hours)}</td>`;
  });
  while (diaryRows.length < minDiaryRows) {
    diaryRows.push('<td></td><td></td><td></td><td></td><td></td>');
  }
  const rowCount = diaryRows.length;
  const dense = rowCount > minDiaryRows;
  const tbody = diaryRows.map((cells, i) => {
    const course = i === 0
      ? `<td class="course" rowspan="${rowCount}"><div class="vtext">${esc(courseName)}</div></td>`
      : '';
    // inject the merged course column after the date cell
    const idx = cells.indexOf('</td>') + 5;
    return `<tr>${cells.slice(0, idx)}${course}${cells.slice(idx)}</tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="si">
<head>
  <meta charset="UTF-8">
  <title>උපදේශක සටහන් - ${esc(year)} - ${reportMonth} - ${esc(batch.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm 10mm 14mm; }
    @page land { size: A4 landscape; margin: 16mm 18mm 10mm 18mm; }

    * { box-sizing: border-box; }
    body {
      margin: 0; color: #000;
      font-family: 'Iskoola Pota', 'Noto Sans Sinhala', 'Nirmala UI', serif;
      font-size: 11pt;
    }
    .num { font-family: 'Times New Roman', Times, serif; font-weight: bold; }
    .u { text-decoration: underline; text-underline-offset: 3px; }
    .c { text-align: center; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 0.75pt solid #555; vertical-align: top; }

    /* ---------- Page 1 (landscape) ---------- */
    .p1 { page: land; break-after: page; }
    @media screen { .p1 { width: 297mm; min-height: 210mm; padding: 16mm 18mm 10mm; } }
    .p1-title { text-align: center; font-weight: bold; font-size: 12.5pt; margin: 6mm 0 3.5mm; }
    .p1-sub { text-align: center; font-weight: bold; font-size: 12pt; margin: 0 0 3.5mm; }
    .t1 { margin-top: 8mm; }
    .t1 th { font-weight: bold; font-size: 11pt; text-align: center; padding: 1.5mm 2mm; line-height: 1.45; vertical-align: top; }
    .t1 td { padding: 1.5mm 1.8mm; height: 38mm; font-size: 10pt; line-height: 1.35; }
    .t1 td.mid { vertical-align: middle; text-align: center; font-weight: bold; }
    .lists.two { column-count: 2; column-gap: 2.5mm; column-rule: 0.5pt dotted #999; }
    .li { display: flex; justify-content: space-between; gap: 3px; font-family: 'Times New Roman', Times, serif; font-size: 9.5pt; line-height: 1.28; break-inside: avoid; }
    .li.tot { border-top: 0.75pt solid #555; margin-top: 1mm; padding-top: 0.8mm; font-weight: bold; font-family: inherit; font-size: 10pt; }
    .li.tot span:last-child { font-family: 'Times New Roman', Times, serif; }
    .p1-foot { margin-top: 22mm; font-weight: bold; font-size: 11.5pt; line-height: 1.5; break-inside: avoid; }

    /* ---------- Page 2 (portrait) ---------- */
    @media screen { .p2 { width: 210mm; min-height: 297mm; padding: 12mm 14mm 10mm; } }
    .p2-title { text-align: center; font-weight: bold; font-size: 12pt; line-height: 1.5; margin: 3mm 0 5mm; }
    .p2-meta { display: flex; justify-content: space-between; font-size: 11pt; padding: 0 9mm 0 9mm; margin-bottom: 0.5mm; }
    .t2 thead { display: table-header-group; }
    .t2 tr { break-inside: avoid; }
    .t2 th { font-weight: normal; text-align: left; padding: 1mm 1.5mm; font-size: 11pt; line-height: 1.4; height: ${dense ? '22mm' : '26mm'}; vertical-align: top; }
    .t2 th.vh { vertical-align: middle; padding: 0; }
    .t2 td { padding: ${dense ? '0.35mm 1.2mm' : '0.8mm 1.3mm'}; font-size: ${dense ? '8pt' : '9pt'}; line-height: ${dense ? '1.12' : '1.2'}; height: ${dense ? '7mm' : '11.5mm'}; }
    .t2 td.date { font-family: 'Times New Roman', Times, serif; font-size: ${dense ? '8pt' : '9pt'}; line-height: 1.1; vertical-align: middle; }
    .t2 td.tm { white-space: nowrap; font-size: ${dense ? '7.5pt' : '8.5pt'}; }
    .t2 td.course { vertical-align: middle; padding: 2mm 0; }
    .vtext { writing-mode: vertical-rl; transform: rotate(180deg); margin: 0 auto; text-align: center; font-size: 10.5pt; line-height: 1.3; max-height: 100%; }
    .t2 th .vtext { font-size: 11pt; }
    .p2-decl { margin: 3.5mm 0 0 9mm; font-size: 11pt; break-inside: avoid; }
    .p2-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10mm; margin: 5mm 0 0 9mm; font-size: 11pt; break-inside: avoid; }
    .p2-sign .row { display: grid; grid-template-columns: 30mm 1fr; line-height: 1.5; }
    .p2-sign .gap { height: 3.5mm; }
    .keep { break-inside: avoid; }

    ${TOOLBAR_CSS}
  </style>
</head>
<body>
  ${toolbar(`උපදේශක සටහන් — ${esc(period.from)} to ${esc(period.to)}`, pdfHref)}

  <!-- ==================== PAGE 1 (Landscape) ==================== -->
  <section class="sheet p1">
    <div class="p1-title">උපදේශක සටහන් <span class="num">- ${esc(year)} -</span> ${reportMonth} මාසය</div>
    <div class="p1-sub">${esc(centreTitle)}</div>
    <div class="p1-sub u">විෂය නිර්දේශයට අදාළ පැය ගණන</div>

    <table class="t1">
      <colgroup>
        <col style="width:14.5%"><col style="width:14.5%"><col style="width:9.6%">
        <col style="width:12.2%"><col style="width:12.2%"><col style="width:12.2%">
        <col style="width:12.2%"><col style="width:12.6%">
      </colgroup>
      <thead>
        <tr>
          <th>පාඨමාලාවේ<br>නම</th>
          <th>උපදේශකගේ<br>නම</th>
          <th>අදාළ<br>මාසය</th>
          <th>සම්පූර්ණ කළ යුතු මොඩියුලර් හා පැය ගණන</th>
          <th>පෙර මස වන විට සම්පූර්ණ කර ඇති මොඩියුලර් හා පැය ගණන</th>
          <th>අදාළ මාසයට සම්පූර්ණ කළ මොඩියුලර් හා පැය ගණන</th>
          <th>මෙතෙක් සම්පූර්ණ කර ඇති මොඩියුලර් හා පැය ගණන් වල එකතුව</th>
          <th>නිවැරදි බවට උපදේශකගේ අත්සන</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="mid">${esc(courseName)}</td>
          <td class="mid">${esc(teacherName)}</td>
          <td class="mid">${esc(year)}<br>${reportMonth}</td>
          <td>${moduleList('total_hours', tt.totalCurriculumHours, false)}</td>
          <td>${moduleList('prev_hours', tt.totalPrevHours, true)}</td>
          <td>${moduleList('this_month_hours', tt.totalThisMonthHours, true)}</td>
          <td>${moduleList('to_date_hours', tt.totalToDateHours, true)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div class="p1-foot">
      ${esc(approverTitle)} (${esc(centreShort)})<br>
      ජාතික තරුණ සේවා සභාව.
    </div>
  </section>

  <!-- ==================== PAGE 2 (Portrait) ==================== -->
  <section class="sheet p2">
    <div class="p2-title u">
      ජාතික තරුණ සේවා සභාවේ සියළුම පුහුණු මධ්‍යස්ථාන වල සේවය කරනු ලබන<br>
      උපදේශක මණ්ඩලය විසින් ඉදිරිපත් කරනු ලබන මාසික ප්‍රගතිය
    </div>

    <div class="p2-meta">
      <span>මාසය :- ${esc(year)} ${reportMonth}</span>
      <span>පුහුණු මධ්‍යස්ථානය :- ${esc(centreShort)}</span>
    </div>

    <table class="t2">
      <colgroup>
        <col style="width:7.2%"><col style="width:9.5%"><col style="width:30.3%">
        <col style="width:29.4%"><col style="width:12.2%"><col style="width:11.4%">
      </colgroup>
      <thead>
        <tr>
          <th class="vh"><div class="vtext">දිනය</div></th>
          <th class="vh"><div class="vtext">පාඨමාලාවේ නම</div></th>
          <th>මොඩියුල අංකය/ කෙටි විස්තරය/ ලිපි ගොනු විස්තරය</th>
          <th>න්‍යායාත්මක/ ප්‍රායෝගික ක්‍රියාකාරකම්/ <span class="num">OJT</span> ස්ථානය</th>
          <th>ගත කළ කාලය</th>
          <th>ගතවූ පැය ගණන</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>

    <div class="keep">
      <div class="p2-decl">${declaration}</div>
      <div class="p2-sign">
        <div>
          <div class="row"><span>ඉදිරිපත් කළේ :-</span><span></span></div>
          <div class="gap"></div>
          <div class="row"><span>නම</span><span>:- ${fillOrDots(teacherName)}</span></div>
          <div class="row"><span>තනතුර</span><span>:- ${fillOrDots(settings.teacher_designation)}</span></div>
          <div class="gap"></div>
          <div class="row"><span>සේවා අංකය</span><span>:- ${fillOrDots(settings.service_no)}</span></div>
          <div class="row"><span>දු.ක.අංකය</span><span>:- ${fillOrDots(settings.teacher_phone)}</span></div>
        </div>
        <div>
          <div class="row"><span>අනුමත කළේ :-</span><span></span></div>
          <div class="gap"></div>
          <div class="row"><span>අත්සන :-</span><span></span></div>
          <div class="row"><span>නම</span><span>:- ${esc(approverName)}</span></div>
          <div class="row"><span>තනතුර</span><span>:- ${esc(approverTitle)}</span></div>
          <div class="row"><span>මුද්‍රාව</span><span>:-</span></div>
        </div>
      </div>
    </div>
  </section>
</body>
</html>`;
}

// =====================================================================
// CONTINUE ASSESSMENT CHECK LIST — landscape, max 13 students per page
// =====================================================================
const CHECKLIST_MAX_PER_PAGE = 13;
const CHECKLIST_MIN_COLUMNS = 12; // blank columns keep the sheet looking like the paper form

/**
 * Split students evenly over pages: 26 → 13 + 13, 17 → 9 + 8, 12 → 12.
 */
function paginateStudents(students, maxPerPage = CHECKLIST_MAX_PER_PAGE) {
  const n = students.length;
  if (n === 0) return [[]];
  const pages = Math.ceil(n / maxPerPage);
  const per = Math.ceil(n / pages);
  const out = [];
  for (let i = 0; i < n; i += per) out.push(students.slice(i, i + per));
  return out;
}

function renderChecklist({ task, steps, students, resultsMap = {}, compMap = {}, settings = {}, pdfHref = '#' }) {
  const groups = paginateStudents(students);
  const columns = Math.max(CHECKLIST_MIN_COLUMNS, ...groups.map(g => g.length));
  const centre = settings.institute_name || 'Technical Training Centre – Akuressa';
  const courseEn = settings.course_title_en_short || 'Information & Communication Technology Technician';
  const manySteps = steps.length > 6;

  const fmtDate = (d) => {
    if (!d) return '';
    const p = parts(d);
    return `${p.dd}/${p.mm}/${String(p.y).slice(2)}`;
  };

  const sheet = (group, pageIdx) => {
    const cols = group.slice();
    while (cols.length < columns) cols.push(null);

    const nameHeads = cols.map(s => {
      if (!s) return '<th colspan="2" class="name"></th>';
      const [a, b] = splitName(s.full_name);
      return `<th colspan="2" class="name"><div class="vname">${esc(a)}${b ? '<br>' + esc(b) : ''}</div></th>`;
    }).join('');
    const attemptHeads = cols.map(() => '<th class="att">1</th><th class="att">2</th>').join('');

    const stepRows = steps.map(step => {
      const label = /^[A-Z]\d+\./.test(step.code || '') ? step.code : `${task.code}.${step.code}`;
      const cells = cols.map(s => {
        if (!s) return '<td></td><td></td>';
        const r = (resultsMap[s.id] && resultsMap[s.id][step.id]) || {};
        return `<td class="mk">${r[1] ? 'C' : ''}</td><td class="mk">${r[2] ? 'C' : ''}</td>`;
      }).join('');
      return `<tr class="step"><td class="st">${esc(label)} ${esc(step.title)}</td>${cells}</tr>`;
    }).join('');

    const compCells = cols.map(s => {
      const c = s && compMap[s.id];
      if (c && c.competent && c.date) return `<td colspan="2" class="cd">${esc(fmtDate(c.date))}</td>`;
      if (c && c.competent) return `<td colspan="2" class="mk">C</td>`;
      return '<td></td><td></td>';
    }).join('');

    const pageNote = groups.length > 1
      ? `<div class="pg-note">Page ${pageIdx + 1} of ${groups.length}</div>` : '';

    return `
  <section class="sheet">
    <div class="fit">
      <h1>${esc(courseEn)}</h1>
      <div class="hrow">
        <span>${esc(centre)}</span>
        <span class="right-head">Continue Assessment Check List <span class="nvq">NVQ - 4</span></span>
      </div>
      <div class="hrow">
        <span>Module Name :- ${esc(task.module_title)}</span>
        <span class="taskno">Task No :- ${esc(task.code)}</span>
      </div>
      <div class="task-title">${esc(task.title)}</div>

      <table class="grid">
        <colgroup>
          <col style="width:17.5%">
          ${cols.map(() => '<col><col>').join('')}
        </colgroup>
        <thead>
          <tr class="names">
            <th rowspan="2" class="diag"><span class="dn">Name</span><span class="ds">Step</span></th>
            ${nameHeads}
          </tr>
          <tr class="atts">${attemptHeads}</tr>
        </thead>
        <tbody>
          ${stepRows}
          <tr class="comp"><td class="cl">Competent Date</td>${compCells}</tr>
        </tbody>
      </table>

      <div class="sig">
        <div><div>………………………..</div><div>Prepared by</div></div>
        <div><div>………………………..</div><div>Approved&nbsp; by</div></div>
      </div>
      ${pageNote}
    </div>
  </section>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Continue Assessment Check List - ${esc(task.code)}</title>
  <style>
    @page { size: A4 landscape; margin: 9mm 11mm 7mm 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #000; font-family: 'Times New Roman', Times, serif; font-weight: bold; }
    .sheet { break-after: page; }
    .sheet:last-of-type { break-after: auto; }
    @media screen { .sheet { width: 297mm; height: 210mm; padding: 9mm 11mm 7mm; overflow: hidden; } }
    .fit { width: 275mm; transform-origin: top left; }

    h1 { text-align: center; font-size: 18pt; margin: 0 0 3mm; }
    .hrow { display: flex; justify-content: space-between; font-size: 13pt; margin-bottom: 3mm; }
    .right-head { padding-right: 15mm; }
    .nvq { margin-left: 9mm; }
    .taskno { padding-right: 31mm; }
    .task-title { text-align: right; font-size: 11pt; margin: -3.5mm 6mm 4mm 0; }

    table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-left: 4mm; width: calc(100% - 4mm); }
    .grid th, .grid td { border: 0.75pt solid #555; padding: 0; }
    .grid thead { display: table-header-group; }
    .grid tr { break-inside: avoid; }
    .names th { height: ${manySteps ? '27mm' : '31mm'}; vertical-align: bottom; }
    .diag {
      position: relative;
      background: linear-gradient(to bottom left, transparent calc(50% - 0.6pt), #333 50%, transparent calc(50% + 0.6pt));
    }
    .diag .dn { position: absolute; top: 7mm; right: 7mm; font-size: 15pt; }
    .diag .ds { position: absolute; bottom: 4mm; left: 8mm; font-size: 15pt; }
    .vname {
      writing-mode: vertical-rl; transform: rotate(180deg);
      margin: 0 auto; padding: 1.5mm 0; font-size: 10.5pt; line-height: 1.15; white-space: nowrap;
      text-align: left;
    }
    .att { font-size: 12pt; height: 9mm; vertical-align: middle; text-align: center; }
    .st { font-size: ${manySteps ? '9pt' : '10pt'}; line-height: 1.12; padding: 0.4mm 1.5mm 0.6mm 2mm !important; vertical-align: top; text-align: left; }
    .mk { text-align: center; vertical-align: middle; font-family: 'Segoe UI Symbol', 'DejaVu Sans', sans-serif; font-size: 11pt; }
    .comp td { height: ${manySteps ? '9mm' : '11mm'}; }
    .cl { text-align: center; font-size: 11pt; vertical-align: middle; }
    .cd { text-align: center; vertical-align: middle; font-size: 8pt; }

    .sig { display: flex; justify-content: space-between; margin: 9mm 0 0; font-size: 11pt; text-align: center; padding: 0 12mm 0 14mm; }
    .sig > div > div:first-child { margin-bottom: 1.5mm; }
    .pg-note { text-align: right; font-size: 8pt; font-weight: normal; color: #444; margin-top: 1mm; }

    ${TOOLBAR_CSS}
  </style>
</head>
<body>
  ${toolbar(`Continue Assessment Check List — ${esc(task.code)} ${esc(task.title)} (${students.length} students, ${groups.length} page${groups.length > 1 ? 's' : ''})`, pdfHref)}
  ${groups.map(sheet).join('')}
  <script>
    // Auto-fit: shrink a sheet only if its content is taller than one A4 landscape page
    (function () {
      var mm = 96 / 25.4, availH = 194 * mm, baseW = 275 * mm;
      document.querySelectorAll('.fit').forEach(function (el) {
        for (var i = 0; i < 3; i++) {
          var z = parseFloat(el.style.zoom || 1);
          var h = el.getBoundingClientRect().height / z;
          if (h <= availH) break;
          var nz = Math.max(0.6, availH / h * z * 0.995);
          el.style.zoom = nz;
          el.style.width = (baseW / nz) + 'px';
        }
      });
    })();
  </script>
</body>
</html>`;
}

// =====================================================================
// 3. OFFICIAL NVQ-4 LESSON PLAN & TEACHING RECORD
// =====================================================================
function renderLessonPlan({ batch, settings = {}, version, weeklyHours = 0, modules = [], totals = {}, pdfHref = '#', moduleId = null }) {
  const teacherName = settings.teacher_name || 'ICT Instructor';
  const teacherDesig = settings.teacher_designation || 'ICT Instructor';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.center_in_charge_title || DEFAULT_APPROVER_TITLE;
  const centreName = settings.institute_name || 'Technical Training Centre – Akuressa';
  const centreSi = settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';

  // Filter modules if a specific moduleId was chosen
  const displayModules = moduleId ? modules.filter(m => m.module_id === Number(moduleId)) : modules;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lesson Plan NVQ-4 - ${esc(batch.name)} - ${esc(settings.course_title || 'ICT Technician')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700&display=swap');
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 0; color: #0f172a; font-size: 10pt; background: #f8fafc;
    }
    .page {
      max-width: 210mm; margin: 20px auto; background: white; padding: 16mm 18mm;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 4px;
    }
    @media print {
      body { background: white; }
      .page {
        max-width: none; margin: 0; padding: 10mm 12mm; box-shadow: none; border-radius: 0;
      }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }

    .header-box {
      text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;
    }
    .header-org { font-size: 12pt; font-weight: 800; letter-spacing: 0.8px; color: #0f172a; text-transform: uppercase; }
    .header-sub { font-size: 10pt; font-weight: 600; color: #475569; margin-top: 2px; }
    .header-title {
      font-size: 14pt; font-weight: 800; color: #1e3a8a; margin-top: 6px; letter-spacing: 0.3px;
    }
    .header-badge {
      display: inline-block; background: #e0e7ff; color: #3730a3; padding: 2px 10px; border-radius: 999px;
      font-size: 8.5pt; font-weight: 700; margin-top: 4px;
    }

    .meta-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;
    }
    .meta-card {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px;
    }
    .meta-lbl { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; }
    .meta-val { font-size: 11pt; font-weight: 800; color: #0f172a; margin-top: 2px; }
    .meta-val.highlight { color: #059669; }

    .section-title {
      font-size: 11pt; font-weight: 800; color: #0f172a; border-left: 4px solid #2563eb;
      padding-left: 8px; margin: 18px 0 10px 0; text-transform: uppercase; letter-spacing: 0.4px;
    }

    /* Modules overview table */
    .table-overview {
      width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 24px;
    }
    .table-overview th, .table-overview td {
      border: 1px solid #cbd5e1; padding: 5px 7px; vertical-align: middle;
    }
    .table-overview th { background: #f1f5f9; font-weight: 700; text-align: center; color: #334155; }
    .table-overview td.c { text-align: center; }
    .table-overview td.r { text-align: right; }
    .table-overview tr:nth-child(even) td { background: #fafbfc; }
    .badge {
      display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 7.5pt;
    }
    .badge-done { background: #dcfce7; color: #166534; }
    .badge-prog { background: #fef3c7; color: #92400e; }
    .badge-sched { background: #f1f5f9; color: #475569; }

    /* Module unit block */
    .mod-card {
      border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 22px; overflow: hidden;
      break-inside: avoid;
    }
    .mod-hdr {
      background: #0f172a; color: white; padding: 10px 14px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .mod-code {
      font-size: 12pt; font-weight: 800; color: #60a5fa; margin-right: 8px;
    }
    .mod-name { font-size: 11pt; font-weight: 700; }
    .mod-hours {
      font-size: 9pt; font-weight: 700; background: rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 4px;
    }
    .mod-body { padding: 12px 14px; background: white; }
    .mod-goal {
      background: #eff6ff; border-left: 3px solid #3b82f6; padding: 8px 12px; border-radius: 0 4px 4px 0;
      font-size: 8.5pt; line-height: 1.45; color: #1e3a8a; margin-bottom: 12px;
    }
    .mod-goal strong { color: #1e40af; }

    /* Sessions table */
    .session-tbl {
      width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 8px;
    }
    .session-tbl th, .session-tbl td {
      border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top;
    }
    .session-tbl th {
      background: #f8fafc; font-weight: 700; color: #475569; text-align: left;
    }
    .session-tbl td.c { text-align: center; }
    .session-no { font-weight: 800; color: #1e3a8a; white-space: nowrap; }
    .session-topics { list-style: disc; margin: 3px 0 0 16px; padding: 0; font-size: 8pt; color: #334155; }
    .session-topics li { margin-bottom: 2px; }
    .session-act {
      background: #f0fdf4; border-left: 2px solid #22c55e; padding: 4px 6px; border-radius: 0 3px 3px 0;
      font-size: 7.8pt; color: #15803d; margin-top: 4px;
    }

    .mod-extras {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; font-size: 8pt;
    }
    .extra-box {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px;
    }
    .extra-box strong { color: #334155; display: block; margin-bottom: 3px; font-size: 8pt; text-transform: uppercase; }
    .extra-box ul { margin: 0 0 0 14px; padding: 0; color: #475569; }

    /* Sign-off */
    .sig-block {
      display: flex; justify-content: space-between; margin-top: 36px; padding-top: 16px;
      border-top: 1px solid #cbd5e1; break-inside: avoid; font-size: 9pt;
    }
    .sig-box { width: 45%; }
    .sig-box p { margin: 3px 0; }
    .sig-line { border-bottom: 1px dotted #64748b; height: 32px; margin-bottom: 8px; }

    ${TOOLBAR_CSS}
  </style>
</head>
<body>
  ${toolbar(`Lesson Plan NVQ-4 — ${esc(batch.name)} (${displayModules.length} Modules)`, pdfHref)}

  <div class="page">
    <div class="header-box">
      <div class="header-org">ජාතික තරුණ සේවා සභාව — National Youth Services Council</div>
      <div class="header-sub">${esc(centreSi)} / ${esc(centreName)}</div>
      <div class="header-title">LESSON PLAN &amp; TEACHING HOURS RECORD</div>
      <div class="header-badge">NVQ Level 4 · ICT Technician · National Competency Standard (NCS: K72S004)</div>
    </div>

    <div class="meta-grid">
      <div class="meta-card">
        <div class="meta-lbl">Batch / Intake</div>
        <div class="meta-val">${esc(batch.name)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-lbl">Curriculum Hours</div>
        <div class="meta-val">${totals.curriculumHours || 720} h</div>
      </div>
      <div class="meta-card">
        <div class="meta-lbl">Hours Taught</div>
        <div class="meta-val highlight">${totals.delivered || 0} h</div>
      </div>
      <div class="meta-card">
        <div class="meta-lbl">Completion</div>
        <div class="meta-val highlight">${totals.planned > 0 ? Math.round(((totals.delivered || 0) / totals.planned) * 100) : 0}%</div>
      </div>
    </div>

    ${!moduleId ? `
    <div class="section-title">1. Curriculum Overview &amp; Teaching Hours Progress</div>
    <table class="table-overview">
      <thead>
        <tr>
          <th style="width: 6%;">Code</th>
          <th style="width: 38%;">Module Title</th>
          <th style="width: 9%;">Theory</th>
          <th style="width: 9%;">Practical</th>
          <th style="width: 9%;">Total</th>
          <th style="width: 10%;">Planned</th>
          <th style="width: 10%;">Taught</th>
          <th style="width: 9%;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${modules.map(m => {
          const pct = m.plannedHours > 0 ? Math.round((m.deliveredHours / m.plannedHours) * 100) : 0;
          const statusBadge = pct >= 100
            ? '<span class="badge badge-done">Completed</span>'
            : pct > 0
            ? `<span class="badge badge-prog">${pct}% Taught</span>`
            : '<span class="badge badge-sched">Scheduled</span>';
          return `
          <tr>
            <td class="c"><strong>${esc(m.code)}</strong></td>
            <td><strong>${esc(m.title)}</strong></td>
            <td class="c">${m.theory_hours}h</td>
            <td class="c">${m.practical_hours}h</td>
            <td class="c font-bold"><strong>${m.total_hours}h</strong></td>
            <td class="c">${m.plannedHours}h</td>
            <td class="c font-bold" style="color: #059669;">${m.deliveredHours}h</td>
            <td class="c">${statusBadge}</td>
          </tr>`;
        }).join('')}
        <tr style="font-weight: 800; background: #f1f5f9;">
          <td colspan="2" style="text-align: right; padding-right: 12px;">Total Hours:</td>
          <td class="c">${modules.reduce((a,m)=>a+m.theory_hours,0)}h</td>
          <td class="c">${modules.reduce((a,m)=>a+m.practical_hours,0)}h</td>
          <td class="c">${totals.curriculumHours || 720}h</td>
          <td class="c">${totals.planned || 720}h</td>
          <td class="c" style="color: #059669;">${totals.delivered || 0}h</td>
          <td class="c">${totals.planned > 0 ? Math.round(((totals.delivered || 0) / totals.planned) * 100) : 0}%</td>
        </tr>
      </tbody>
    </table>
    ` : ''}

    <div class="section-title">2. Module Lesson Plans &amp; Practical Session Breakdowns</div>

    ${displayModules.map((m, idx) => `
      <div class="mod-card ${idx > 0 && !moduleId ? 'page-break' : ''}">
        <div class="mod-hdr">
          <div>
            <span class="mod-code">${esc(m.code)}</span>
            <span class="mod-name">${esc(m.unit_title || m.title)}</span>
          </div>
          <div class="mod-hours">
            Duration: ${m.total_hours} Hours · Taught: ${m.deliveredHours || 0} Hours
          </div>
        </div>

        <div class="mod-body">
          <div class="mod-goal">
            <strong>Goal / Competency:</strong> ${esc(m.goal || 'To equip learners with essential skills and practical competencies.')}
          </div>

          <table class="session-tbl">
            <thead>
              <tr>
                <th style="width: 22%;">Session &amp; Focus</th>
                <th style="width: 50%;">Topics Covered &amp; Practical Activity</th>
                <th style="width: 14%; text-align: center;">Planned Hrs</th>
                <th style="width: 14%; text-align: center;">Taught Hrs</th>
              </tr>
            </thead>
            <tbody>
              ${m.sessions.length === 0 ? `
                <tr><td colspan="4" class="c" style="color: #64748b; padding: 12px;">Standard curriculum topics scheduled for this module.</td></tr>
              ` : m.sessions.map(s => `
                <tr>
                  <td>
                    <div class="session-no">Session ${s.session_no}: ${esc(s.title)}</div>
                    ${s.focus ? `<div style="font-size: 7.5pt; color: #64748b; margin-top: 2px;"><strong>Focus:</strong> ${esc(s.focus)}</div>` : ''}
                  </td>
                  <td>
                    ${s.topics && s.topics.length ? `
                      <ul class="session-topics">
                        ${s.topics.map(t => `<li>${esc(t)}</li>`).join('')}
                      </ul>
                    ` : ''}
                    ${s.activity ? `
                      <div class="session-act">
                        <strong>Practical Activity:</strong> ${esc(s.activity)}
                      </div>
                    ` : ''}
                  </td>
                  <td class="c"><strong>${s.hours} h</strong></td>
                  <td class="c" style="color: #059669; font-weight: 700;">${s.deliveredHours || 0} h</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="mod-extras">
            <div class="extra-box">
              <strong>Resource Checklist:</strong>
              ${m.resources && m.resources.length ? `
                <ul>${m.resources.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
              ` : '<span style="color:#94a3b8;">Standard lab computers and peripherals</span>'}
            </div>
            <div class="extra-box">
              <strong>Assessment Methods:</strong>
              ${m.assessment && m.assessment.length ? `
                <ul>${m.assessment.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
              ` : '<span style="color:#94a3b8;">Formative assessment, practical test, and competency checklist</span>'}
            </div>
          </div>
        </div>
      </div>
    `).join('')}

    <div class="sig-block">
      <div class="sig-box">
        <strong>Prepared by (Instructor):</strong>
        <div class="sig-line"></div>
        <p><strong>Name:</strong> ${esc(teacherName)}</p>
        <p><strong>Designation:</strong> ${esc(teacherDesig)}</p>
        <p><strong>Date:</strong> ....................................................</p>
      </div>
      <div class="sig-box" style="text-align: right;">
        <strong style="display: block; text-align: right;">Approved by (Centre In-Charge):</strong>
        <div class="sig-line"></div>
        <p><strong>Name:</strong> ${esc(approverName)}</p>
        <p><strong>Designation:</strong> ${esc(approverTitle)}</p>
        <p><strong>Date:</strong> ....................................................</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// =====================================================================
// MONTHLY PLAN CALENDAR (5-Column Mon-Fri Grid) — matches Monthly Plan October.pdf
// =====================================================================
function renderMonthlyCalendarPlan({
  batch,
  settings = {},
  year,
  month,
  weeks = [],
  totals = {},
  pdfHref = '#'
}) {
  const MONTH_NAMES_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const MONTH_NAMES_SI = [
    'ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි',
    'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'
  ];

  const mIdx = Math.max(0, Math.min(11, Number(month) - 1));
  const monthNameEn = MONTH_NAMES_EN[mIdx];
  const monthNameSi = MONTH_NAMES_SI[mIdx];

  const teacherName = settings.teacher_name || '';
  const teacherDesig = settings.teacher_designation || 'Instructor (ICT)';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.approver_title || DEFAULT_APPROVER_TITLE;
  const centreName = settings.centre_name_si || settings.form_centre_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Monthly Plan - ${monthNameEn} ${year} - ${esc(batch.name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Noto+Sans+Sinhala:wght@400;600;700&display=swap');
    * { box-sizing: border-box; }
    @page {
      size: A4 landscape;
      margin: 6mm 8mm;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #f1f5f9;
      font-size: 8.5pt;
    }
    .page {
      width: 285mm;
      min-height: 198mm;
      margin: 10px auto;
      background: white;
      padding: 8mm 10mm;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    @media print {
      body { background: white; }
      .page {
        width: 100%;
        min-height: auto;
        margin: 0;
        padding: 4mm 6mm;
        box-shadow: none;
      }
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
    ${TOOLBAR_CSS}

    /* Header styling from Monthly Plan October.pdf */
    .plan-header {
      margin-bottom: 6px;
      text-align: center;
    }
    .plan-header .title-main {
      font-size: 17pt;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 12px;
      border-top: 1.5px solid #0f172a;
      border-bottom: 1.5px solid #0f172a;
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
      margin-top: 4px;
    }
    .meta-bar span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    /* 5-Column Grid */
    .cal-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 4px;
      margin-bottom: 6px;
    }
    .cal-table th {
      background: #e2e8f0;
      color: #0f172a;
      border: 1.5px solid #0f172a;
      padding: 6px 4px;
      font-size: 10.5pt;
      font-weight: 800;
      text-align: center;
      width: 20%;
    }
    .cal-table td {
      border: 1.5px solid #0f172a;
      vertical-align: top;
      padding: 4px 5px;
      height: 25mm;
      overflow: hidden;
      background: #ffffff;
    }

    /* Cell Variants */
    .cell-empty {
      background: #f8fafc !important;
      border: 1.5px solid #cbd5e1 !important;
    }
    .cell-before {
      background: #f8fafc;
      color: #94a3b8;
    }
    .cell-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 3px;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 2px;
    }
    .day-num {
      font-size: 10.5pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1;
    }
    .day-hrs {
      font-size: 7.5pt;
      font-weight: 700;
      color: #0284c7;
      background: #e0f2fe;
      padding: 1px 4px;
      border-radius: 3px;
      line-height: 1;
    }

    /* Cell Content */
    .cell-body {
      font-size: 7.8pt;
      line-height: 1.25;
      color: #1e293b;
    }
    .topic-line {
      margin-bottom: 3px;
      font-weight: 600;
    }
    .topic-line strong {
      color: #0f172a;
    }
    .tag-act {
      display: inline-block;
      font-size: 7pt;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      background: #f1f5f9;
      color: #475569;
      margin-top: 2px;
    }
    .tag-software {
      background: #dbeafe;
      color: #1d4ed8;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7pt;
    }
    .tag-assign {
      background: #fef3c7;
      color: #b45309;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7pt;
      display: inline-block;
      margin-top: 2px;
    }

    /* Holidays */
    .cell-holiday {
      background: #fff1f2 !important;
      border-color: #be123c !important;
    }
    .cell-holiday .day-num {
      color: #be123c;
    }
    .holiday-box {
      color: #be123c;
      font-weight: 700;
      font-size: 8.5pt;
      line-height: 1.3;
      margin-top: 4px;
      text-align: center;
      padding: 4px 2px;
    }
    .holiday-icon {
      font-size: 11pt;
      display: block;
      margin-bottom: 2px;
    }

    /* Footer styling from Monthly Plan October.pdf */
    .plan-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 6px;
      border-top: 1.5px solid #0f172a;
      margin-top: 4px;
      font-size: 8.5pt;
    }
    .ftr-course {
      font-size: 11pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.5px;
    }
    .ftr-year-month {
      font-size: 9.5pt;
      font-weight: 700;
      color: #334155;
      margin-top: 1px;
    }
    .ftr-stats {
      font-size: 8pt;
      color: #64748b;
      margin-top: 2px;
    }

    .sig-container {
      display: flex;
      gap: 36px;
    }
    .sig-col {
      min-width: 55mm;
      text-align: left;
    }
    .sig-line {
      border-bottom: 1px dotted #0f172a;
      height: 16px;
      margin-bottom: 4px;
    }
    .sig-name {
      font-size: 8.5pt;
      font-weight: 700;
      color: #0f172a;
    }
    .sig-desig {
      font-size: 7.5pt;
      color: #475569;
    }
  </style>
</head>
<body>
  ${toolbar(`Monthly Plan — ${monthNameEn} ${year} (${batch.name})`, pdfHref)}

  <div class="page">
    <div>
      <div class="plan-header">
        <h1 class="title-main">Monthly Plan</h1>
        <div class="meta-bar">
          <span>YEAR: ${year}</span>
          <span>MONTH: ${monthNameEn.toUpperCase()}</span>
        </div>
      </div>

      <table class="cal-table">
        <thead>
          <tr>
            <th>Mon</th>
            <th>Tue</th>
            <th>Wed</th>
            <th>Thu</th>
            <th>Fri</th>
          </tr>
        </thead>
        <tbody>
          ${weeks.map(week => `
            <tr>
              ${week.map(cell => {
                if (!cell.inMonth) {
                  return `<td class="cell-empty"></td>`;
                }

                if (cell.isHoliday) {
                  return `
                    <td class="cell-holiday">
                      <div class="cell-top">
                        <span class="day-num">${cell.day}</span>
                        <span class="day-hrs" style="background:#ffe4e6;color:#be123c;">Holiday</span>
                      </div>
                      <div class="holiday-box">
                        <span class="holiday-icon">🌕</span>
                        ${esc(cell.holidayName)}
                      </div>
                    </td>
                  `;
                }

                if (cell.isClosure) {
                  return `
                    <td class="cell-before">
                      <div class="cell-top">
                        <span class="day-num">${cell.day}</span>
                      </div>
                      <div style="font-size:7.5pt;color:#b45309;font-weight:600;padding-top:4px;">
                        ⚠️ ${esc(cell.closureReason || 'Centre Closed')}
                      </div>
                    </td>
                  `;
                }

                if (cell.isBeforeStart) {
                  return `
                    <td class="cell-before">
                      <div class="cell-top">
                        <span class="day-num">${cell.day}</span>
                      </div>
                      <div style="font-size:7.5pt;color:#94a3b8;padding-top:4px;">
                        Prior to batch start
                      </div>
                    </td>
                  `;
                }

                return `
                  <td>
                    <div class="cell-top">
                      <span class="day-num">${cell.day}</span>
                      ${cell.hours ? `<span class="day-hrs">${cell.hours}h</span>` : ''}
                    </div>
                    <div class="cell-body">
                      ${cell.contentHtml}
                    </div>
                  </td>
                `;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="plan-footer">
      <div>
        <div class="ftr-course">ICTT – NVQ 4</div>
        <div class="ftr-year-month">${year} · ${monthNameEn.toUpperCase()}</div>
        <div class="ftr-stats">
          ${batch.name} · ${totals.teachingDays || 0} Teaching Days · ${totals.totalHours || 0} Scheduled Hours
        </div>
      </div>

      <div class="sig-container">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">Prepared by: ${esc(teacherName || 'Course Instructor')}</div>
          <div class="sig-desig">${esc(teacherDesig)}</div>
        </div>

        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">Approved by: ${esc(approverName || 'Centre In-Charge')}</div>
          <div class="sig-desig">${esc(approverTitle)}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  renderMonthlyReport,
  renderChecklist,
  renderLessonPlan,
  renderMonthlyCalendarPlan,
  paginateStudents,
  splitName,
  SI_MONTHS
};

