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
// CONTINUE ASSESSMENT CHECK LIST — Legal (1-page all students) or A4 (max 13/page)
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

function renderChecklist({
  task,
  steps,
  students,
  resultsMap = {},
  compMap = {},
  settings = {},
  paperSize = 'legal',
  legalHref = '#',
  a4Href = '#',
  pdfHref = '#'
}) {
  const isLegal = String(paperSize).toLowerCase() !== 'a4';
  const maxPerPage = isLegal ? Math.max(students.length, 25) : CHECKLIST_MAX_PER_PAGE;
  const groups = paginateStudents(students, maxPerPage);
  const columns = Math.max(CHECKLIST_MIN_COLUMNS, ...groups.map(g => g.length));
  const centre = settings.institute_name || 'Technical Training Centre – Akuressa';
  const courseEn = settings.course_title_en_short || 'Information & Communication Technology Technician';
  const manySteps = steps.length > 6;
  const denseCols = isLegal && columns > 15;

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
          <col style="width:${denseCols ? '14.5%' : '17.5%'}">
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

  // 20mm left gutter for standard 2-hole / file-binder punching on both Legal and A4
  const pageSizeCss = isLegal
    ? '@page { size: 355.6mm 215.9mm; margin: 9mm 10mm 7mm 20mm; }'
    : '@page { size: A4 landscape; margin: 9mm 10mm 7mm 18mm; }';

  const screenSheetCss = isLegal
    ? '.sheet { width: 355.6mm; height: 215.9mm; padding: 9mm 10mm 7mm 20mm; overflow: hidden; }'
    : '.sheet { width: 297mm; height: 210mm; padding: 9mm 10mm 7mm 18mm; overflow: hidden; }';

  const fitWidthMm = isLegal ? 325.6 : 269;
  const availHeightMm = isLegal ? 199 : 194;

  const customToolbar = `
  <div class="no-print no-print-bar">
    <div>
      <strong>Continue Assessment Check List — ${esc(task.code)} ${esc(task.title)}</strong>
      <span style="opacity:0.8; margin-left:8px;">(${students.length} students · ${isLegal ? 'Legal 1-Page Format' : `A4 Format, ${groups.length} page${groups.length > 1 ? 's' : ''}`})</span>
    </div>
    <div style="display:flex; align-items:center;">
      <span style="font-size:12px; color:#cbd5e1; margin-right:6px;">Paper Size:</span>
      <a href="${legalHref}" class="btn" style="background:${isLegal ? '#059669' : '#334155'}; margin-left:4px;">📄 Legal (1 Page - All Names)</a>
      <a href="${a4Href}" class="btn" style="background:${!isLegal ? '#059669' : '#334155'}; margin-left:4px;">📄 A4 (2 Pages - Classic)</a>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ Print</button>
      <a href="${pdfHref}" class="btn">⬇️ Download PDF</a>
    </div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Continue Assessment Check List (${isLegal ? 'Legal' : 'A4'}) - ${esc(task.code)}</title>
  <style>
    ${pageSizeCss}
    * { box-sizing: border-box; }
    body { margin: 0; color: #000; font-family: 'Times New Roman', Times, serif; font-weight: bold; }
    .sheet { break-after: page; }
    .sheet:last-of-type { break-after: auto; }
    @media screen { ${screenSheetCss} }
    .fit { width: ${fitWidthMm}mm; transform-origin: top left; }

    h1 { text-align: center; font-size: ${denseCols ? '16.5pt' : '18pt'}; margin: 0 0 2.5mm; }
    .hrow { display: flex; justify-content: space-between; font-size: ${denseCols ? '12pt' : '13pt'}; margin-bottom: 2.5mm; }
    .right-head { padding-right: 15mm; }
    .nvq { margin-left: 9mm; }
    .taskno { padding-right: 31mm; }
    .task-title { text-align: right; font-size: 11pt; margin: -3mm 6mm 3.5mm 0; }

    table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-left: ${denseCols ? '0' : '2mm'}; width: ${denseCols ? '100%' : 'calc(100% - 2mm)'}; }
    .grid th, .grid td { border: 0.75pt solid #555; padding: 0; }
    .grid thead { display: table-header-group; }
    .grid tr { break-inside: avoid; }
    .names th { height: ${manySteps ? '27mm' : '31mm'}; vertical-align: bottom; }
    .diag {
      position: relative;
      background: linear-gradient(to bottom left, transparent calc(50% - 0.6pt), #333 50%, transparent calc(50% + 0.6pt));
    }
    .diag .dn { position: absolute; top: 7mm; right: 7mm; font-size: ${denseCols ? '13.5pt' : '15pt'}; }
    .diag .ds { position: absolute; bottom: 4mm; left: 8mm; font-size: ${denseCols ? '13.5pt' : '15pt'}; }
    .vname {
      writing-mode: vertical-rl; transform: rotate(180deg);
      margin: 0 auto; padding: 1.5mm 0; font-size: ${denseCols ? '8.5pt' : '10.5pt'}; line-height: ${denseCols ? '1.05' : '1.15'}; white-space: nowrap;
      text-align: left;
    }
    .att { font-size: ${denseCols ? '9pt' : '12pt'}; height: ${denseCols ? '6.5mm' : '9mm'}; vertical-align: middle; text-align: center; }
    .st { font-size: ${manySteps ? '8.8pt' : '9.8pt'}; line-height: 1.12; padding: 0.4mm 1.5mm 0.6mm 2mm !important; vertical-align: top; text-align: left; }
    .mk { text-align: center; vertical-align: middle; font-family: 'Segoe UI Symbol', 'DejaVu Sans', sans-serif; font-size: ${denseCols ? '9.5pt' : '11pt'}; }
    .comp td { height: ${manySteps ? '8.5mm' : '10.5mm'}; }
    .cl { text-align: center; font-size: ${denseCols ? '10pt' : '11pt'}; vertical-align: middle; }
    .cd { text-align: center; vertical-align: middle; font-size: ${denseCols ? '6.6pt' : '8pt'}; white-space: nowrap; letter-spacing: ${denseCols ? '-0.2px' : '0'}; }

    .sig { display: flex; justify-content: space-between; margin: ${denseCols ? '7mm' : '9mm'} 0 0; font-size: 11pt; text-align: center; padding: 0 12mm 0 14mm; }
    .sig > div > div:first-child { margin-bottom: 1.5mm; }
    .pg-note { text-align: right; font-size: 8pt; font-weight: normal; color: #444; margin-top: 1mm; }

    ${TOOLBAR_CSS}
  </style>
</head>
<body>
  ${customToolbar}
  ${groups.map(sheet).join('')}
  <script>
    // Auto-fit: shrink a sheet only if its content is taller than one landscape page
    (function () {
      var mm = 96 / 25.4, availH = ${availHeightMm} * mm, baseW = ${fitWidthMm} * mm;
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
//    Classic Institutional / Academic Typography (20mm Left Gutter)
// =====================================================================
function renderLessonPlan({ batch, settings = {}, version, weeklyHours = 0, modules = [], totals = {}, pdfHref = '#', moduleId = null }) {
  const teacherName = settings.teacher_name || 'R.Kandawela';
  const teacherDesig = settings.teacher_designation || 'ICT Instructor';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.center_in_charge_title || DEFAULT_APPROVER_TITLE;
  const centreName = settings.institute_name || 'Technical Training Centre – Akuressa';
  const centreSi = settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';
  const courseName = settings.course_title || 'Information & Communication Technology Technician (ICTT)';

  // Filter modules if a specific moduleId was chosen
  const displayModules = moduleId ? modules.filter(m => m.module_id === Number(moduleId)) : modules;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lesson Plan NVQ-4 - ${esc(batch.name)} - ${esc(courseName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 12mm 12mm 20mm;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: 'Book Antiqua', 'Georgia', 'Times New Roman', 'Iskoola Pota', 'Nirmala UI', serif;
      margin: 0; padding: 0; color: #111; font-size: 9.8pt; line-height: 1.38;
    }
    .page {
      max-width: 210mm; margin: 18px auto; background: #fff; padding: 12mm 12mm 12mm 20mm;
      box-shadow: 0 4px 18px rgba(0,0,0,0.22);
    }
    @media print {
      body { background: #fff; }
      .page {
        max-width: none; margin: 0; padding: 0; box-shadow: none;
      }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }

    /* Classic Double-Rule Institutional Header */
    .header-box {
      text-align: center;
      border-bottom: 2.2pt double #111;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .header-org {
      font-size: 12.5pt;
      font-weight: bold;
      letter-spacing: 0.4px;
      color: #000;
    }
    .header-sub {
      font-size: 10.5pt;
      font-weight: bold;
      color: #222;
      margin-top: 2px;
    }
    .header-title {
      font-size: 13.5pt;
      font-weight: bold;
      color: #000;
      margin-top: 5px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .header-ncs {
      font-size: 9.2pt;
      font-style: italic;
      color: #333;
      margin-top: 3px;
    }

    /* Formal Specification Table instead of web cards */
    .spec-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 9pt;
    }
    .spec-table td {
      border: 0.75pt solid #333;
      padding: 4px 8px;
      vertical-align: middle;
    }
    .spec-table td.lbl {
      background: #f3f4f6;
      font-weight: bold;
      width: 18%;
      color: #111;
    }
    .spec-table td.val {
      width: 32%;
      color: #000;
    }

    .section-title {
      font-size: 10.5pt;
      font-weight: bold;
      color: #000;
      border-bottom: 1pt solid #222;
      padding-bottom: 2px;
      margin: 14px 0 8px 0;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    /* Modules overview table */
    .table-overview {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.8pt;
      margin-bottom: 18px;
    }
    .table-overview th, .table-overview td {
      border: 0.75pt solid #333;
      padding: 4.5px 6px;
      vertical-align: middle;
    }
    .table-overview th {
      background: #eaecef;
      font-weight: bold;
      text-align: center;
      color: #000;
    }
    .table-overview td.c { text-align: center; font-family: 'Times New Roman', Times, serif; }
    .table-overview td.r { text-align: right; }

    /* Module unit block — Classic Framed Sheet */
    .mod-card {
      border: 1pt solid #222;
      margin-bottom: 18px;
      break-inside: avoid;
      background: #fff;
    }
    .mod-hdr {
      background: #eaecef;
      color: #000;
      border-bottom: 1pt solid #222;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .mod-code {
      font-size: 11pt;
      font-weight: bold;
      margin-right: 6px;
      font-family: 'Times New Roman', Times, serif;
    }
    .mod-name {
      font-size: 10.5pt;
      font-weight: bold;
    }
    .mod-hours {
      font-size: 8.8pt;
      font-weight: bold;
      font-family: 'Times New Roman', Times, serif;
    }
    .mod-body { padding: 8px 10px; }
    .mod-goal {
      border-left: 2pt solid #333;
      padding: 3px 8px;
      font-size: 8.8pt;
      line-height: 1.38;
      color: #111;
      margin-bottom: 8px;
      background: #fafafa;
    }

    /* Sessions table */
    .session-tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-top: 6px;
    }
    .session-tbl th, .session-tbl td {
      border: 0.75pt solid #444;
      padding: 4.5px 6px;
      vertical-align: top;
    }
    .session-tbl th {
      background: #f3f4f6;
      font-weight: bold;
      color: #000;
      text-align: left;
    }
    .session-tbl td.c {
      text-align: center;
      font-family: 'Times New Roman', Times, serif;
    }
    .session-no {
      font-weight: bold;
      color: #000;
    }
    .session-topics {
      list-style: circle;
      margin: 2px 0 0 15px;
      padding: 0;
      font-size: 8.2pt;
      color: #111;
    }
    .session-topics li { margin-bottom: 1.5px; }
    .session-act {
      border-top: 0.5pt dotted #777;
      padding-top: 3px;
      font-size: 8pt;
      font-style: italic;
      color: #111;
      margin-top: 4px;
    }

    .mod-extras {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
      font-size: 8pt;
    }
    .extra-box {
      border: 0.75pt solid #555;
      padding: 5px 8px;
      background: #fcfcfc;
    }
    .extra-box strong {
      color: #000;
      display: block;
      margin-bottom: 2px;
      font-size: 8pt;
      text-decoration: underline;
    }
    .extra-box ul { margin: 0 0 0 14px; padding: 0; color: #222; }

    /* Sign-off */
    .sig-block {
      display: flex;
      justify-content: space-between;
      margin-top: 26px;
      padding-top: 10px;
      border-top: 1pt solid #222;
      break-inside: avoid;
      font-size: 9.2pt;
    }
    .sig-box { width: 44%; }
    .sig-box p { margin: 2.5px 0; }
    .sig-line { border-bottom: 0.75pt dotted #222; height: 26px; margin-bottom: 6px; }

    ${TOOLBAR_CSS}
  </style>
</head>
<body>
  ${toolbar(`Lesson Plan NVQ-4 — ${esc(batch.name)} (${displayModules.length} Modules)`, pdfHref)}

  <div class="page">
    <div class="header-box">
      <div class="header-org">ජාතික තරුණ සේවා සභාව — NATIONAL YOUTH SERVICES COUNCIL</div>
      <div class="header-sub">${esc(centreSi)} / ${esc(centreName)}</div>
      <div class="header-title">MASTER LESSON PLAN &amp; TEACHING HOURS RECORD</div>
      <div class="header-ncs">${esc(courseName)} · NVQ Level 4 · National Competency Standard (NCS: ${esc(batch.ncs_code || 'K72S004')})</div>
    </div>

    <table class="spec-table">
      <tr>
        <td class="lbl">Batch / Intake :-</td>
        <td class="val"><strong>${esc(batch.name)}</strong></td>
        <td class="lbl">Curriculum Hours :-</td>
        <td class="val"><strong>${totals.curriculumHours || 720} Hours</strong> (16 Competency Units)</td>
      </tr>
      <tr>
        <td class="lbl">Instructor :-</td>
        <td class="val">${esc(teacherName)} (${esc(teacherDesig)})</td>
        <td class="lbl">Progress to Date :-</td>
        <td class="val"><strong>${totals.delivered || 0} / ${totals.planned || 720} Hours Taught</strong> (${totals.planned > 0 ? Math.round(((totals.delivered || 0) / totals.planned) * 100) : 0}%)</td>
      </tr>
    </table>

    ${!moduleId ? `
    <div class="section-title">Part I — Curriculum Modules &amp; Hour Allocation Summary</div>
    <table class="table-overview">
      <thead>
        <tr>
          <th style="width: 7%;">Code</th>
          <th style="width: 39%;">Module / Competency Unit Title</th>
          <th style="width: 9%;">Theory</th>
          <th style="width: 9%;">Practical</th>
          <th style="width: 9%;">Total</th>
          <th style="width: 9%;">Planned</th>
          <th style="width: 9%;">Taught</th>
          <th style="width: 9%;">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${modules.map(m => {
          const pct = m.plannedHours > 0 ? Math.round((m.deliveredHours / m.plannedHours) * 100) : 0;
          const statusTxt = pct >= 100 ? 'Completed' : pct > 0 ? `${pct}% Done` : 'Scheduled';
          return `
          <tr>
            <td class="c"><strong>${esc(m.code)}</strong></td>
            <td>${esc(m.title)}</td>
            <td class="c">${m.theory_hours}</td>
            <td class="c">${m.practical_hours}</td>
            <td class="c"><strong>${m.total_hours}</strong></td>
            <td class="c">${m.plannedHours}</td>
            <td class="c"><strong>${m.deliveredHours}</strong></td>
            <td class="c" style="font-size:8pt;font-style:${pct === 0 ? 'italic' : 'normal'};">${statusTxt}</td>
          </tr>`;
        }).join('')}
        <tr style="font-weight: bold; background: #eaecef;">
          <td colspan="2" style="text-align: right; padding-right: 10px;">Total Curriculum Hours :-</td>
          <td class="c">${modules.reduce((a,m)=>a+m.theory_hours,0)}</td>
          <td class="c">${modules.reduce((a,m)=>a+m.practical_hours,0)}</td>
          <td class="c">${totals.curriculumHours || 720}</td>
          <td class="c">${totals.planned || 720}</td>
          <td class="c">${totals.delivered || 0}</td>
          <td class="c">${totals.planned > 0 ? Math.round(((totals.delivered || 0) / totals.planned) * 100) : 0}%</td>
        </tr>
      </tbody>
    </table>
    ` : ''}

    <div class="section-title">Part II — Detailed Module Lesson Plans &amp; Practical Schemes</div>

    ${displayModules.map((m, idx) => `
      <div class="mod-card ${idx > 0 && !moduleId ? 'page-break' : ''}">
        <div class="mod-hdr">
          <div>
            <span class="mod-code">${esc(m.code)} :</span>
            <span class="mod-name">${esc(m.unit_title || m.title)}</span>
          </div>
          <div class="mod-hours">
            [ Theory: ${m.theory_hours}h | Practical: ${m.practical_hours}h | Total: ${m.total_hours}h | Taught: ${m.deliveredHours || 0}h ]
          </div>
        </div>

        <div class="mod-body">
          <div class="mod-goal">
            <strong>Learning Outcome / Competency Goal :-</strong> ${esc(m.goal || 'To equip trainees with standard competencies and practical workplace skills required under NVQ Level 4.')}
          </div>

          <table class="session-tbl">
            <thead>
              <tr>
                <th style="width: 24%;">Session No. &amp; Focus Area</th>
                <th style="width: 52%;">Topics Covered &amp; Practical Laboratory Assignment</th>
                <th style="width: 12%; text-align: center;">Allocated (Hrs)</th>
                <th style="width: 12%; text-align: center;">Completed (Hrs)</th>
              </tr>
            </thead>
            <tbody>
              ${m.sessions.length === 0 ? `
                <tr><td colspan="4" class="c" style="color: #444; padding: 10px;">Standard curriculum topics scheduled for this module.</td></tr>
              ` : m.sessions.map(s => `
                <tr>
                  <td>
                    <div class="session-no">Session ${s.session_no}: ${esc(s.title)}</div>
                    ${s.focus ? `<div style="font-size: 7.8pt; color: #333; margin-top: 2px;"><em>Focus: ${esc(s.focus)}</em></div>` : ''}
                    ${s.firstDate ? `<div style="font-size: 7.5pt; color: #444; margin-top: 2px; font-family: 'Times New Roman', serif;">Date: ${esc(s.firstDate)}${s.lastDate && s.lastDate !== s.firstDate ? ' – ' + esc(s.lastDate) : ''}</div>` : ''}
                  </td>
                  <td>
                    ${s.topics && s.topics.length ? `
                      <ul class="session-topics">
                        ${s.topics.map(t => `<li>${esc(t)}</li>`).join('')}
                      </ul>
                    ` : ''}
                    ${s.activity ? `
                      <div class="session-act">
                        <strong>Practical Exercise :-</strong> ${esc(s.activity)}
                      </div>
                    ` : ''}
                  </td>
                  <td class="c"><strong>${fmtHours(s.hours)}</strong></td>
                  <td class="c"><strong>${fmtHours(s.deliveredHours || 0)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="mod-extras">
            <div class="extra-box">
              <strong>Instructional Resources &amp; Equipment :-</strong>
              ${m.resources && m.resources.length ? `
                <ul>${m.resources.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
              ` : '<span>Standard computer laboratory facilities and tools</span>'}
            </div>
            <div class="extra-box">
              <strong>Competency Assessment Criteria :-</strong>
              ${m.assessment && m.assessment.length ? `
                <ul>${m.assessment.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
              ` : '<span>Practical demonstration, continuous assessment &amp; checklist evaluation</span>'}
            </div>
          </div>
        </div>
      </div>
    `).join('')}

    <div class="sig-block">
      <div class="sig-box">
        <strong>Prepared by (Course Instructor) :-</strong>
        <div class="sig-line"></div>
        <p>Name :- ${esc(teacherName)}</p>
        <p>Designation :- ${esc(teacherDesig)}</p>
        <p>Date :- ....................................................</p>
      </div>
      <div class="sig-box">
        <strong>Checked &amp; Approved by (Centre In-Charge) :-</strong>
        <div class="sig-line"></div>
        <p>Name :- ${esc(approverName)}</p>
        <p>Designation :- ${esc(approverTitle)}</p>
        <p>Date &amp; Official Seal :- ....................................</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// =====================================================================
// MONTHLY PLAN CALENDAR (5-Column Mon-Fri Grid)
// Classic Editorial / Institutional Typography (20mm Left Gutter)
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

  const teacherName = settings.teacher_name || 'R.Kandawela';
  const teacherDesig = settings.teacher_designation || 'Computer Instructor';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.approver_title || DEFAULT_APPROVER_TITLE;
  const centreName = settings.centre_name_si || settings.form_centre_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Monthly Plan - ${monthNameEn} ${year} - ${esc(batch.name)}</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page {
      size: A4 landscape;
      margin: 8mm 10mm 8mm 20mm;
    }
    body {
      font-family: 'Book Antiqua', 'Georgia', 'Times New Roman', 'Iskoola Pota', serif;
      margin: 0;
      padding: 0;
      color: #000;
      font-size: 8.5pt;
    }
    .page {
      width: 297mm;
      min-height: 210mm;
      margin: 14px auto;
      background: #fff;
      padding: 8mm 10mm 8mm 20mm;
      box-shadow: 0 4px 18px rgba(0,0,0,0.22);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    @media print {
      body { background: #fff; }
      .page {
        width: 100%;
        min-height: auto;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
    ${TOOLBAR_CSS}

    /* Classic Institutional Header */
    .plan-header {
      margin-bottom: 5px;
      text-align: center;
    }
    .plan-header .org-line {
      font-size: 10.5pt;
      font-weight: bold;
      color: #111;
      letter-spacing: 0.3px;
    }
    .plan-header .title-main {
      font-size: 15.5pt;
      font-weight: bold;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #000;
      margin: 2px 0 4px 0;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3.5px 10px;
      border-top: 1.5pt solid #000;
      border-bottom: 1pt solid #000;
      font-size: 9.8pt;
      font-weight: bold;
      color: #000;
      background: #f5f5f5;
    }

    /* 5-Column Grid */
    .cal-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 4px;
      margin-bottom: 5px;
    }
    .cal-table th {
      background: #eaecef;
      color: #000;
      border: 1pt solid #000;
      padding: 5px 4px;
      font-size: 10pt;
      font-weight: bold;
      text-align: center;
      width: 20%;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .cal-table td {
      border: 1pt solid #111;
      vertical-align: top;
      padding: 4px 5px;
      height: 24.5mm;
      overflow: hidden;
      background: #ffffff;
    }

    /* Cell Variants */
    .cell-empty {
      background: #f9fafb !important;
      border: 1pt solid #888 !important;
    }
    .cell-before {
      background: #fafafa;
      color: #555;
    }
    .cell-top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 3px;
      border-bottom: 0.6pt dotted #666;
      padding-bottom: 1.5px;
    }
    .day-num {
      font-family: 'Times New Roman', Times, serif;
      font-size: 10.5pt;
      font-weight: bold;
      color: #000;
      line-height: 1;
    }
    .day-hrs {
      font-family: 'Times New Roman', Times, serif;
      font-size: 7.8pt;
      font-weight: bold;
      color: #111;
      border: 0.5pt solid #444;
      padding: 0.5px 4px;
      background: #f3f4f6;
      line-height: 1.1;
    }

    /* Cell Content */
    .cell-body {
      font-size: 7.8pt;
      line-height: 1.24;
      color: #000;
      font-family: 'Calibri', 'Segoe UI', 'Iskoola Pota', sans-serif;
    }
    .topic-line {
      margin-bottom: 2.5px;
      font-weight: 500;
    }
    .topic-line strong {
      color: #000;
    }
    .tag-act, .tag-assign, .tag-software {
      font-style: italic;
      font-weight: bold;
      font-size: 7pt;
      color: #222;
    }

    /* Holidays — Classic Shaded Paper Cell (no emojis) */
    .cell-holiday {
      background: #f3f4f6 !important;
    }
    .holiday-box {
      color: #000;
      font-family: 'Book Antiqua', 'Times New Roman', serif;
      font-weight: bold;
      font-style: italic;
      font-size: 8.5pt;
      line-height: 1.3;
      margin-top: 6px;
      text-align: center;
      padding: 4px 3px;
      border: 0.5pt dashed #555;
      background: #fff;
    }

    /* Footer styling */
    .plan-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 5px;
      border-top: 1.5pt double #000;
      margin-top: 3px;
      font-size: 8.8pt;
    }
    .ftr-course {
      font-size: 10.5pt;
      font-weight: bold;
      color: #000;
    }
    .ftr-year-month {
      font-size: 9pt;
      font-weight: bold;
      color: #222;
      margin-top: 1px;
    }
    .ftr-stats {
      font-size: 8pt;
      color: #333;
      margin-top: 1px;
      font-style: italic;
    }

    .sig-container {
      display: flex;
      gap: 32mm;
    }
    .sig-col {
      min-width: 55mm;
      text-align: left;
    }
    .sig-line {
      border-bottom: 0.75pt dotted #000;
      height: 15px;
      margin-bottom: 3px;
    }
    .sig-name {
      font-size: 8.8pt;
      font-weight: bold;
      color: #000;
    }
    .sig-desig {
      font-size: 7.8pt;
      color: #333;
    }
  </style>
</head>
<body>
  ${toolbar(`Monthly Plan — ${monthNameEn} ${year} (${batch.name})`, pdfHref)}

  <div class="page">
    <div>
      <div class="plan-header">
        <div class="org-line">ජාතික තරුණ සේවා සභාව — NATIONAL YOUTH SERVICES COUNCIL · ${esc(centreName)}</div>
        <h1 class="title-main">Monthly Training Schedule &amp; Lesson Plan</h1>
        <div class="meta-bar">
          <span>COURSE: ICT TECHNICIAN (NVQ LEVEL 4)</span>
          <span>BATCH: ${esc(batch.name)}</span>
          <span>YEAR: ${year}</span>
          <span>MONTH: ${monthNameEn.toUpperCase()} (${monthNameSi})</span>
        </div>
      </div>

      <table class="cal-table">
        <thead>
          <tr>
            <th>Monday</th>
            <th>Tuesday</th>
            <th>Wednesday</th>
            <th>Thursday</th>
            <th>Friday</th>
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
                        <span class="day-hrs">HOLIDAY</span>
                      </div>
                      <div class="holiday-box">
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
                        <span class="day-hrs">OFF</span>
                      </div>
                      <div style="font-size:8pt;color:#222;font-style:italic;text-align:center;padding-top:6px;">
                        [ ${esc(cell.closureReason || 'Centre Closed')} ]
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
                      <div style="font-size:7.5pt;color:#666;font-style:italic;padding-top:4px;">
                        Prior to batch commencement
                      </div>
                    </td>
                  `;
                }

                return `
                  <td>
                    <div class="cell-top">
                      <span class="day-num">${cell.day}</span>
                      ${cell.hours ? `<span class="day-hrs">${cell.hours} Hrs</span>` : ''}
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
        <div class="ftr-course">ICTT – NVQ Level 4 (${esc(batch.name)})</div>
        <div class="ftr-year-month">${monthNameEn} ${year} — ${totals.teachingDays || 0} Teaching Days · ${totals.totalHours || 0} Scheduled Hours</div>
        <div class="ftr-stats">
          Technical Training Centre – Akuressa · National Youth Services Council
        </div>
      </div>

      <div class="sig-container">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">Prepared by :- ${esc(teacherName || 'Course Instructor')}</div>
          <div class="sig-desig">${esc(teacherDesig)}</div>
        </div>

        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">Approved by :- ${esc(approverName || 'Centre In-Charge')}</div>
          <div class="sig-desig">${esc(approverTitle)}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// =====================================================================
// MASTER TRAINING WORK PLAN (GANTT CHART) — NVQ LEVEL 4
// Classic Engineering / TVEC Institutional Schedule Style (A4 & Legal)
// Includes 20mm Left Binding/Punch Gutter
// =====================================================================
function renderWorkPlan({
  batch = {},
  settings = {},
  version = null,
  weeklyHours = 30,
  modules = [],
  gantt = { months: [], weeks: [] },
  totals = {},
  paperSize = 'a4',
  a4Href = '#',
  legalHref = '#',
  pdfHref = '#'
}) {
  const isLegal = String(paperSize).toLowerCase() === 'legal';
  const pageWidthMm = isLegal ? '355.6mm' : '297mm';
  const pageHeightMm = isLegal ? '215.9mm' : '210mm';

  const courseName = settings.course_title || 'Information & Communication Technology Technician (ICTT - NVQ Level 4)';
  const teacherName = settings.teacher_name || 'R.Kandawela';
  const teacherDesig = settings.teacher_designation || 'Computer Instructor';
  const approverName = settings.center_in_charge_name || settings.approver_name || DEFAULT_APPROVER;
  const approverTitle = settings.center_in_charge_title || DEFAULT_APPROVER_TITLE;
  const centreSi = settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';
  const centreEn = settings.institute_name || 'Technical Training Centre – Akuressa';

  const months = gantt.months || [];
  const weeks = gantt.weeks || [];

  const shortDate = (ymd) => {
    if (!ymd) return '-';
    const [y, m, d] = String(ymd).slice(0, 10).split('-');
    return `${d}.${m}.${y.slice(2)}`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Master Training Work Plan (Gantt Chart) — ${esc(batch.name)} (${isLegal ? 'Legal' : 'A4'})</title>
  <style>
    /* 20mm left binding/punch gutter */
    @page {
      size: ${isLegal ? '355.6mm 215.9mm' : 'A4 landscape'};
      margin: 8mm 8mm 8mm 20mm;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      margin: 0;
      padding: 0;
      color: #000;
      font-family: 'Book Antiqua', 'Georgia', 'Times New Roman', 'Iskoola Pota', serif;
      font-size: ${isLegal ? '8pt' : '7.2pt'};
    }
    ${TOOLBAR_CSS}
    .sheet {
      width: 100%;
    }
    @media screen {
      .sheet {
        width: ${pageWidthMm};
        min-height: ${pageHeightMm};
        padding: 8mm 8mm 8mm 20mm;
      }
    }

    /* Classic Official Title Masthead */
    .wp-masthead {
      text-align: center;
      border-bottom: 2pt double #000;
      padding-bottom: 4px;
      margin-bottom: 5px;
    }
    .wp-masthead .org-title {
      font-size: ${isLegal ? '11pt' : '10pt'};
      font-weight: bold;
      letter-spacing: 0.4px;
      color: #000;
    }
    .wp-masthead .doc-title {
      font-size: ${isLegal ? '13.5pt' : '12.5pt'};
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin: 1px 0;
      text-decoration: underline;
      text-underline-offset: 2.5px;
    }
    .wp-masthead .course-sub {
      font-size: ${isLegal ? '8.8pt' : '8pt'};
      font-weight: bold;
      color: #222;
    }

    /* Formal Bordered Specification Strip */
    .wp-spec-strip {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 5px;
      font-family: 'Times New Roman', Times, serif;
      font-size: ${isLegal ? '8pt' : '7.3pt'};
    }
    .wp-spec-strip td {
      border: 0.75pt solid #000;
      padding: 2.5px 6px;
      background: #fafafa;
    }
    .wp-spec-strip td strong {
      font-weight: bold;
      color: #000;
    }

    /* Classic Gantt Schedule Table */
    .gantt-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-family: 'Calibri', 'Arial', sans-serif;
    }
    .gantt-table th, .gantt-table td {
      border: 0.75pt solid #111;
      padding: ${isLegal ? '2.5px 3px' : '2px 2px'};
      vertical-align: middle;
      overflow: hidden;
    }
    .gantt-table thead th {
      background: #eaecef;
      color: #000;
      font-family: 'Times New Roman', Times, serif;
      font-weight: bold;
      text-align: center;
      font-size: ${isLegal ? '7.4pt' : '6.6pt'};
      line-height: 1.15;
    }
    .gantt-table thead tr.month-row th.month-hdr {
      background: #d5d9e0;
      color: #000;
      font-size: ${isLegal ? '7.8pt' : '7pt'};
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 2.5px 2px;
      border-left: 1.2pt solid #000;
    }
    .gantt-table thead tr.week-row th.wk-hdr {
      background: #f3f4f6;
      font-family: 'Times New Roman', Times, serif;
      font-size: ${isLegal ? '6.4pt' : '5.8pt'};
      padding: 1.5px 1px;
    }
    .gantt-table thead tr.week-row th.wk-hdr.month-start {
      border-left: 1.2pt solid #000;
    }
    .wk-dates {
      display: block;
      font-size: ${isLegal ? '5.2pt' : '4.6pt'};
      font-weight: normal;
      color: #222;
      white-space: nowrap;
    }

    .col-no { width: 5.5mm; text-align: center; font-weight: bold; font-family: 'Times New Roman', serif; }
    .col-code { width: ${isLegal ? '12mm' : '10.5mm'}; text-align: center; font-weight: bold; font-family: 'Times New Roman', serif; }
    .col-title { width: ${isLegal ? '60mm' : '47mm'}; text-align: left; }
    .col-hrs { width: ${isLegal ? '15mm' : '13.5mm'}; text-align: center; font-family: 'Times New Roman', serif; font-size: ${isLegal ? '7pt' : '6.3pt'}; }
    .col-done { width: ${isLegal ? '10mm' : '8.8mm'}; text-align: center; font-weight: bold; font-family: 'Times New Roman', serif; }
    .col-dates { width: ${isLegal ? '22mm' : '19.5mm'}; text-align: center; font-family: 'Times New Roman', serif; font-size: ${isLegal ? '6.5pt' : '5.8pt'}; white-space: nowrap; }
    .col-days { width: ${isLegal ? '7.5mm' : '6.5mm'}; text-align: center; font-weight: bold; font-family: 'Times New Roman', serif; }

    .mod-title-main {
      font-family: 'Book Antiqua', 'Times New Roman', serif;
      font-weight: bold;
      color: #000;
      font-size: ${isLegal ? '7.6pt' : '6.8pt'};
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mod-sub-meta {
      font-family: 'Times New Roman', serif;
      font-style: italic;
      font-size: ${isLegal ? '6pt' : '5.4pt'};
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .g-cell {
      padding: 1.2px !important;
      text-align: center;
      position: relative;
      height: ${isLegal ? '7.4mm' : '6.7mm'};
    }
    .g-cell.month-start {
      border-left: 1.2pt solid #000;
    }

    /* Classic Print-Friendly Gantt Bars (Clean on both B&W and Color Printers) */
    .g-bar {
      width: 100%;
      height: 100%;
      min-height: ${isLegal ? '5.4mm' : '4.8mm'};
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Times New Roman', Times, serif;
      font-size: ${isLegal ? '6.3pt' : '5.5pt'};
      font-weight: bold;
      line-height: 1;
    }
    /* Completed: Deep Classic Ink Charcoal/Forest */
    .g-bar-done {
      background: #2c3e35;
      color: #ffffff;
      border: 0.75pt solid #000;
    }
    /* In Progress: Classic Hatched / Double-Framed Bar */
    .g-bar-partial {
      background: repeating-linear-gradient(
        -45deg,
        #d1d5db,
        #d1d5db 3px,
        #ffffff 3px,
        #ffffff 6px
      );
      color: #000;
      border: 1pt solid #000;
    }
    /* Planned: Classic Framed Light Grey Tint */
    .g-bar-planned {
      background: #dfe3e8;
      color: #000;
      border: 0.75pt solid #222;
    }

    .tot-row td {
      background: #eaecef;
      font-family: 'Times New Roman', Times, serif;
      font-weight: bold;
      font-size: ${isLegal ? '7pt' : '6.2pt'};
      text-align: center;
      border-top: 1.2pt solid #000;
      border-bottom: 1.2pt solid #000;
    }

    .wp-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 7px;
      padding-top: 5px;
      font-family: 'Book Antiqua', 'Times New Roman', serif;
      font-size: ${isLegal ? '8pt' : '7.3pt'};
    }
    .legend-items {
      display: flex;
      align-items: center;
      gap: 14px;
      font-weight: bold;
    }
    .lg-box {
      display: inline-block;
      width: 13px;
      height: 9px;
      vertical-align: middle;
      margin-right: 4px;
    }
    .sig-row {
      display: flex;
      gap: 28mm;
    }
    .sig-block {
      min-width: 55mm;
    }
    .sig-line {
      border-bottom: 0.75pt dotted #000;
      height: 15px;
      margin-bottom: 3px;
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div>
      <strong>Master Training Work Plan (Gantt Chart) — ${esc(batch.name)}</strong>
      <span style="margin-left:10px;background:#1e293b;padding:3px 8px;border-radius:4px;font-size:11px;color:#cbd5e1;">
        ${isLegal ? 'Legal Landscape (355.6 × 215.9mm) · 20mm Left Gutter' : 'A4 Landscape (297 × 210mm) · 20mm Left Gutter'}
      </span>
    </div>
    <div style="display:flex;align-items:center;">
      <a href="${a4Href}" class="btn ${!isLegal ? '' : 'btn-secondary'}" style="${!isLegal ? 'background:#059669;' : ''}">
        A4 Landscape
      </a>
      <a href="${legalHref}" class="btn ${isLegal ? '' : 'btn-secondary'}" style="${isLegal ? 'background:#059669;' : ''}">
        Legal Landscape
      </a>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ Print</button>
      <a href="${pdfHref}" class="btn">⬇️ Download PDF</a>
    </div>
  </div>

  <section class="sheet">
    <div class="wp-masthead">
      <div class="org-title">ජාතික තරුණ සේවා සභාව — NATIONAL YOUTH SERVICES COUNCIL · ${esc(centreSi)} (${esc(centreEn)})</div>
      <div class="doc-title">පුහුණු ක්‍රියාකාරී සැලැස්ම — MASTER TRAINING WORK PLAN &amp; GANTT SCHEDULE</div>
      <div class="course-sub">${esc(courseName)} · National Competency Standard (NCS: ${esc(batch.ncs_code || 'K72S002')})</div>
    </div>

    <table class="wp-spec-strip">
      <tr>
        <td><strong>Batch / Intake :-</strong> ${esc(batch.name)}</td>
        <td><strong>Commencement :-</strong> ${esc(totals.startDate || batch.start_date)}</td>
        <td><strong>Completion :-</strong> ${esc(totals.endDate || '-')}</td>
        <td><strong>Duration :-</strong> ${ fmtHours(totals.curriculumHours || 720) } Hours (${totals.teachingDays || 0} Days / ${weeks.length} Weeks)</td>
        <td><strong>Delivered to Date :-</strong> ${fmtHours(totals.delivered || 0)} Hours</td>
        <td><strong>Instructor :-</strong> ${esc(teacherName)}</td>
      </tr>
    </table>

    <table class="gantt-table">
      <thead>
        <tr class="month-row">
          <th rowspan="2" class="col-no">No</th>
          <th rowspan="2" class="col-code">Unit Code</th>
          <th rowspan="2" class="col-title">Competency Unit / Module Title &amp; Tasks</th>
          <th rowspan="2" class="col-hrs">Hours<br><span style="font-weight:normal;font-size:5.5pt;">(T+P=Tot)</span></th>
          <th rowspan="2" class="col-done">Taught<br><span style="font-weight:normal;font-size:5.5pt;">(Hrs)</span></th>
          <th rowspan="2" class="col-dates">Scheduled Period<br><span style="font-weight:normal;font-size:5.5pt;">(From – To)</span></th>
          <th rowspan="2" class="col-days">Days</th>
          ${months.map(m => `
            <th colspan="${m.weeksCount}" class="month-hdr">
              ${esc(m.label)} (${fmtHours(m.plannedHours)}h)
            </th>
          `).join('')}
        </tr>
        <tr class="week-row">
          ${weeks.map(w => `
            <th class="wk-hdr ${w.weekInMonth === 1 ? 'month-start' : ''}" title="Week ${w.weekNo}: ${w.monday} to ${w.friday} (${w.plannedHours}h)">
              W${w.weekInMonth}
              <span class="wk-dates">${esc(w.monday.slice(8, 10))}–${esc(w.friday.slice(8, 10))}</span>
            </th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${modules.map((m, idx) => {
          const taskList = (m.tasks || []).map(t => t.code).join(', ');
          return `
            <tr>
              <td class="col-no">${idx + 1}</td>
              <td class="col-code">${esc(m.code)}</td>
              <td class="col-title">
                <div class="mod-title-main">${esc(m.unit_title || m.title)}</div>
                <div class="mod-sub-meta">
                  ${taskList ? `Tasks: ${esc(taskList)} · ` : ''}${(m.sessions || []).length} Lesson Sessions
                </div>
              </td>
              <td class="col-hrs">
                ${fmtHours(m.theory_hours)}+${fmtHours(m.practical_hours)}=<strong>${fmtHours(m.total_hours)}</strong>
              </td>
              <td class="col-done">
                ${fmtHours(m.deliveredHours)}
              </td>
              <td class="col-dates">
                ${shortDate(m.firstDate)} – ${shortDate(m.lastDate)}
              </td>
              <td class="col-days">${m.days || 0}</td>
              ${weeks.map(w => {
                const cell = m.weeklyHours && m.weeklyHours[w.weekNo];
                const isMonthStart = w.weekInMonth === 1;
                if (!cell || !cell.planned) {
                  return `<td class="g-cell ${isMonthStart ? 'month-start' : ''}"></td>`;
                }
                const isDone = cell.delivered >= cell.planned && cell.planned > 0;
                const isPartial = !isDone && cell.delivered > 0;
                const barCls = isDone ? 'g-bar-done' : isPartial ? 'g-bar-partial' : 'g-bar-planned';
                return `
                  <td class="g-cell ${isMonthStart ? 'month-start' : ''}">
                    <div class="g-bar ${barCls}" title="${m.code} · Week ${w.weekNo} (${w.monday} to ${w.friday}): ${cell.delivered}/${cell.planned}h">
                      ${fmtHours(cell.planned)}
                    </div>
                  </td>
                `;
              }).join('')}
            </tr>
          `;
        }).join('')}
        <tr class="tot-row">
          <td colspan="3" style="text-align:right;padding-right:8px;">TOTAL CURRICULUM HOURS &amp; WEEKLY ALLOCATION :-</td>
          <td>${fmtHours(totals.curriculumHours || 720)}</td>
          <td>${fmtHours(totals.delivered || 0)}</td>
          <td>${shortDate(totals.startDate)} – ${shortDate(totals.endDate)}</td>
          <td>${totals.teachingDays || 0}</td>
          ${weeks.map((w, wi) => `
            <td class="${w.weekInMonth === 1 ? 'g-cell month-start' : ''}" style="font-size:${isLegal ? '6pt' : '5.3pt'};padding:1px;">
              ${w.plannedHours ? `${fmtHours(w.plannedHours)}` : '-'}
            </td>
          `).join('')}
        </tr>
      </tbody>
    </table>

    <div class="wp-footer">
      <div>
        <div class="legend-items">
          <span>Legend :-</span>
          <span><span class="lg-box" style="background:#2c3e35;border:0.75pt solid #000;"></span>Completed / Taught Week</span>
          <span><span class="lg-box" style="background:repeating-linear-gradient(-45deg,#d1d5db,#d1d5db 2px,#fff 2px,#fff 4px);border:0.75pt solid #000;"></span>In Progress (Partial)</span>
          <span><span class="lg-box" style="background:#dfe3e8;border:0.75pt solid #222;"></span>Planned Training Schedule (Hours/Week)</span>
        </div>
        <div style="margin-top:2px;color:#333;font-size:6.6pt;font-style:italic;">
          * Synchronized with the Master Lesson Plan, Daily Timetable, and Official Public Holiday Calendar.
        </div>
      </div>

      <div class="sig-row">
        <div class="sig-block">
          <div class="sig-line"></div>
          <div><strong>Prepared by :-</strong> ${esc(teacherName)}</div>
          <div style="font-size:6.8pt;color:#333;">${esc(teacherDesig)}</div>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <div><strong>Approved by :-</strong> ${esc(approverName)}</div>
          <div style="font-size:6.8pt;color:#333;">${esc(approverTitle)}</div>
        </div>
      </div>
    </div>
  </section>
</body>
</html>`;
}

module.exports = {
  renderMonthlyReport,
  renderChecklist,
  renderLessonPlan,
  renderMonthlyCalendarPlan,
  renderWorkPlan,
  paginateStudents,
  splitName,
  SI_MONTHS
};

