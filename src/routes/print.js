'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { buildMonthlyReport } = require('../services/reportService');
const { htmlToPdf } = require('../services/pdfService');
const { renderMonthlyReport, renderChecklist, renderLessonPlan, renderMonthlyCalendarPlan } = require('../templates/printTemplates');
const lessonPlanService = require('../services/lessonPlanService');

/** Keep the auth token on the "Download PDF" link inside the preview */
function pdfLink(req) {
  const q = new URLSearchParams({ ...req.query, format: 'pdf' });
  return `${req.baseUrl}${req.path}?${q.toString()}`;
}

async function sendHtmlOrPdf(res, html, format, filename) {
  if (format === 'pdf') {
    try {
      const pdfBuffer = await htmlToPdf(html, { cssPageSize: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=${filename}`);
      return res.send(pdfBuffer);
    } catch (pdfErr) {
      console.warn('PDF generation failed, falling back to HTML:', pdfErr.message);
    }
  }
  return res.send(html);
}

// -------------------------------------------------------------
// 1. OFFICIAL MONTHLY REPORT — උපදේශක සටහන් (2 pages)
//    Page 1: landscape module/hours summary, Page 2: portrait daily progress
// GET /api/print/monthly-report?batchId=&from=&to=&format=html|pdf
// -------------------------------------------------------------
router.get('/monthly-report', optionalAuth, async (req, res) => {
  try {
    const { batchId, from, to, format = 'html' } = req.query;
    if (!batchId || !from || !to) {
      return res.status(400).send('batchId, from, and to are required');
    }

    const data = await buildMonthlyReport(batchId, from, to);
    const html = renderMonthlyReport({ ...data, pdfHref: pdfLink(req) });
    return sendHtmlOrPdf(res, html, format, `nysc_monthly_report_${from}_${to}.pdf`);
  } catch (err) {
    console.error('Print monthly report error:', err);
    res.status(500).send('Failed to generate print document');
  }
});

// -------------------------------------------------------------
// 2. OFFICIAL CONTINUE ASSESSMENT CHECK LIST (Check List A format)
//    Students are split evenly over pages, max 13 per page (26 → 13 + 13)
// GET /api/print/checklist?batchId=&taskId=&format=html|pdf
// -------------------------------------------------------------
router.get('/checklist', optionalAuth, async (req, res) => {
  try {
    const { batchId, taskId, format = 'html' } = req.query;
    if (!batchId || !taskId) {
      return res.status(400).send('batchId and taskId are required');
    }

    // Task details
    const [tasks] = await db.query(`
      SELECT t.*, m.code as module_code, m.title as module_title
      FROM tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE t.id = ?
    `, [taskId]);
    if (tasks.length === 0) return res.status(404).send('Task not found');
    const task = tasks[0];

    // Steps
    const [steps] = await db.query(
      'SELECT * FROM steps WHERE task_id = ? ORDER BY sort_order ASC, id ASC',
      [taskId]
    );

    // Active students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    // Results & competencies
    const studentIds = students.map(s => s.id);
    const stepIds = steps.map(s => s.id);

    const resultsMap = {};
    const compMap = {};

    if (studentIds.length > 0 && stepIds.length > 0) {
      const [resRows] = await db.query(`
        SELECT student_id, step_id, attempt, achieved, assessed_on
        FROM checklist_results
        WHERE student_id IN (${studentIds.map(() => '?').join(',')})
          AND step_id IN (${stepIds.map(() => '?').join(',')})
      `, [...studentIds, ...stepIds]);

      for (const r of resRows) {
        if (!resultsMap[r.student_id]) resultsMap[r.student_id] = {};
        if (!resultsMap[r.student_id][r.step_id]) resultsMap[r.student_id][r.step_id] = {};
        resultsMap[r.student_id][r.step_id][r.attempt] = Number(r.achieved) === 1;
      }
    }

    if (studentIds.length > 0) {
      const [compRows] = await db.query(`
        SELECT student_id, competent, competent_date
        FROM task_competency
        WHERE task_id = ? AND student_id IN (${studentIds.map(() => '?').join(',')})
      `, [taskId, ...studentIds]);

      compRows.forEach(c => {
        compMap[c.student_id] = {
          competent: Number(c.competent) === 1,
          date: c.competent_date
        };
      });
    }

    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });

    const html = renderChecklist({
      task, steps, students, resultsMap, compMap, settings,
      pdfHref: pdfLink(req)
    });
    return sendHtmlOrPdf(res, html, format, `checklist_${task.code}.pdf`);
  } catch (err) {
    console.error('Print checklist error:', err);
    res.status(500).send('Failed to generate checklist print view');
  }
});

// -------------------------------------------------------------
// Helper to build 5-Column Monthly Plan Calendar Grid
// Matches Monthly Plan October.pdf exactly
// -------------------------------------------------------------
async function getMonthlyCalendarData(batchId, targetYear, targetMonth) {
  const [batchRows] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (batchRows.length === 0) throw new Error('Batch not found');
  const batch = batchRows[0];

  const [settingsRows] = await db.query('SELECT k, v FROM settings');
  const settings = {};
  settingsRows.forEach(r => { settings[r.k] = r.v; });

  if (!settings.teacher_name) {
    const [u] = await db.query('SELECT name FROM users ORDER BY id ASC LIMIT 1');
    if (u.length > 0 && u[0].name) settings.teacher_name = u[0].name;
  }

  const year = Number(targetYear);
  const month = Number(targetMonth);
  const pad = n => String(n).padStart(2, '0');
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const [sessions] = await db.query(`
    SELECT ps.*, m.code as module_code, m.title as module_title, t.code as task_code, t.title as task_title 
    FROM plan_sessions ps 
    JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1 
    JOIN modules m ON ps.module_id = m.id 
    LEFT JOIN tasks t ON ps.task_id = t.id 
    WHERE ps.batch_id = ? AND ps.sdate >= ? AND ps.sdate <= ? 
    ORDER BY ps.sdate ASC, ps.seq ASC
  `, [batchId, from, to]);

  const [dayLogs] = await db.query('SELECT * FROM day_log WHERE batch_id = ? AND ldate >= ? AND ldate <= ?', [batchId, from, to]);
  const [holidays] = await db.query('SELECT * FROM holidays WHERE hdate >= ? AND hdate <= ? AND is_off = 1', [from, to]);

  const sessMap = {};
  sessions.forEach(s => (sessMap[s.sdate] = sessMap[s.sdate] || []).push(s));
  const dlMap = {};
  dayLogs.forEach(dl => dlMap[dl.ldate] = dl);
  const holMap = {};
  holidays.forEach(h => holMap[h.hdate] = h);

  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const dow = firstDate.getUTCDay();
  const daysBefore = dow === 0 ? 6 : dow - 1;
  const curr = new Date(firstDate);
  curr.setUTCDate(curr.getUTCDate() - daysBefore);

  const weeks = [];
  let totalHours = 0;
  let teachingDays = 0;

  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dDow = curr.getUTCDay();
      const isWeekend = dDow === 0 || dDow === 6;
      const cy = curr.getUTCFullYear();
      const cm = curr.getUTCMonth() + 1;
      const cd = curr.getUTCDate();
      const inMonth = (cy === year && cm === month);
      const ymd = `${cy}-${pad(cm)}-${pad(cd)}`;

      if (!isWeekend) {
        if (!inMonth) {
          week.push({ inMonth: false });
        } else {
          const hol = holMap[ymd];
          const dl = dlMap[ymd];
          const sList = sessMap[ymd] || [];
          const isBeforeStart = ymd < batch.start_date;
          const dayHours = sList.reduce((acc, s) => acc + Number(s.hours), 0) || (dl && Number(dl.hours_delivered)) || 0;
          if (dayHours > 0) {
            totalHours += dayHours;
            teachingDays++;
          }

          let contentHtml = '';
          if (sList.length > 0) {
            contentHtml = sList.map(s => {
              const text = s.topic_text || (s.task_code ? `${s.module_code} - ${s.task_code}: ${s.task_title || s.module_title}` : `${s.module_code}: ${s.module_title}`);
              const isAssign = text.toLowerCase().includes('assignment') || s.kind === 'assessment';
              const isPract = text.toLowerCase().includes('practical');
              return `<div class="topic-line">${text}${isAssign ? ' <span class="tag-assign">Assignment</span>' : ''}${isPract ? ' <span class="tag-act">Practical</span>' : ''}</div>`;
            }).join('');
          } else if (dl && dl.reason) {
            contentHtml = `<div class="topic-line">${dl.reason}</div>`;
          }

          week.push({
            inMonth: true,
            day: cd,
            ymd,
            isBeforeStart,
            isHoliday: !!hol,
            holidayName: hol ? hol.name : '',
            isClosure: dl && ['leave', 'holiday', 'centre_closed'].includes(dl.status),
            closureReason: dl ? dl.reason : '',
            hours: dayHours,
            contentHtml
          });
        }
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
    if (week.some(cell => cell.inMonth)) {
      weeks.push(week);
    }
  }

  return {
    batch,
    settings,
    year,
    month,
    weeks,
    totals: { totalHours, teachingDays }
  };
}

// -------------------------------------------------------------
// 3. OFFICIAL MONTHLY PLAN CALENDAR (5-Column Mon-Fri Grid)
//    Exact replica of Monthly Plan October.pdf
// GET /api/print/monthly-plan?batchId=&year=&month=&from=&to=&format=html|pdf
// -------------------------------------------------------------
router.get('/monthly-plan', optionalAuth, async (req, res) => {
  try {
    const { batchId, year: qYear, month: qMonth, from, to, format = 'html' } = req.query;
    if (!batchId) return res.status(400).send('batchId is required');

    let year = qYear ? Number(qYear) : null;
    let month = qMonth ? Number(qMonth) : null;

    if (!year || !month) {
      if (from) {
        const [y, m] = from.split('-').map(Number);
        year = y;
        month = m;
      } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
      }
    }

    const data = await getMonthlyCalendarData(batchId, year, month);
    const html = renderMonthlyCalendarPlan({ ...data, pdfHref: pdfLink(req) });
    return sendHtmlOrPdf(res, html, format, `monthly_plan_${year}_${String(month).padStart(2, '0')}.pdf`);
  } catch (err) {
    console.error('Print monthly plan error:', err);
    res.status(500).send('Failed to generate monthly plan calendar');
  }
});

// -------------------------------------------------------------
// 3B. OFFICIAL MONTHLY TIMETABLE (Schedule / Monthly Calendar)
// GET /api/print/timetable?batchId=&from=&to=&month=&layout=grid|list&format=html|pdf
// -------------------------------------------------------------
router.get('/timetable', optionalAuth, async (req, res) => {
  try {
    const { batchId, from, to, month: qMonth, layout = 'grid', format = 'html' } = req.query;
    if (!batchId) return res.status(400).send('batchId is required');

    // If layout is grid (default, matching Monthly Plan October.pdf):
    if (layout !== 'list') {
      let year = null;
      let month = null;

      if (qMonth && qMonth.includes('-')) {
        const [y, m] = qMonth.split('-').map(Number);
        year = y;
        month = m;
      } else if (from) {
        const [y, m] = from.split('-').map(Number);
        year = y;
        month = m;
      } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
      }

      const data = await getMonthlyCalendarData(batchId, year, month);
      const html = renderMonthlyCalendarPlan({ ...data, pdfHref: pdfLink(req) });
      return sendHtmlOrPdf(res, html, format, `monthly_timetable_${year}_${String(month).padStart(2, '0')}.pdf`);
    }

    // List view (legacy layout):
    const [batchRows] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (batchRows.length === 0) return res.status(404).send('Batch not found');
    const batch = batchRows[0];

    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });

    if (!settings.teacher_name) {
      const [u] = await db.query('SELECT name FROM users ORDER BY id ASC LIMIT 1');
      if (u.length > 0 && u[0].name) settings.teacher_name = u[0].name;
    }

    let sql = `
      SELECT ps.sdate, ps.hours, ps.kind, ps.topic_text,
             m.code as module_code, m.title as module_title
      FROM plan_sessions ps
      JOIN plan_versions pv ON ps.plan_version_id = pv.id
      JOIN modules m ON ps.module_id = m.id
      WHERE ps.batch_id = ? AND pv.is_current = 1
    `;
    const params = [batchId];
    if (from) {
      sql += ' AND ps.sdate >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND ps.sdate <= ?';
      params.push(to);
    }
    sql += ' ORDER BY ps.sdate ASC, ps.seq ASC';

    const [sessions] = await db.query(sql, params);

    const dayNamesSi = ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'];
    const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let totalHours = 0;
    const sessionRows = sessions.map((s, idx) => {
      const d = new Date(s.sdate + 'T00:00:00');
      const dayOfWeek = d.getDay();
      totalHours += Number(s.hours) || 0;
      return {
        ...s,
        index: idx + 1,
        dayNameSi: dayNamesSi[dayOfWeek],
        dayNameEn: dayNamesEn[dayOfWeek]
      };
    });

    const displayFrom = from || (sessions.length > 0 ? sessions[0].sdate : 'Start');
    const displayTo = to || (sessions.length > 0 ? sessions[sessions.length - 1].sdate : 'End');

    const html = `<!DOCTYPE html>
<html lang="si">
<head>
  <meta charset="UTF-8">
  <title>Monthly Timetable - ${batch.name} (${displayFrom} to ${displayTo})</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400;600;700&family=Inter:wght@400;600;700&display=swap');
    * { box-sizing: border-box; }
    body {
      font-family: 'Noto Sans Sinhala', 'Inter', sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      font-size: 9.5pt;
    }
    .page {
      padding: 12mm 15mm;
      margin: 0 auto;
      background: white;
    }
    @media print {
      body { margin: 0; }
      .page { padding: 5mm; }
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
    .no-print-bar {
      background: #0f172a;
      color: white;
      padding: 10px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 1000;
    }
    .btn {
      background: #2563eb;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      margin-left: 8px;
      text-decoration: none;
      display: inline-block;
    }
    .btn-secondary { background: #475569; }
    .header-block {
      text-align: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .header-block h2 {
      margin: 0 0 3px 0;
      font-size: 15pt;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .header-block h3 {
      margin: 0 0 4px 0;
      font-size: 12pt;
      font-weight: 600;
      color: #334155;
    }
    .header-block h4 {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      color: #1e3a8a;
    }
    .meta-box {
      display: flex;
      justify-content: space-between;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 14px;
      margin-bottom: 12px;
      font-size: 9pt;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
    }
    th, td {
      border: 1px solid #334155;
      padding: 5px 7px;
      vertical-align: middle;
    }
    th {
      background: #e2e8f0;
      font-weight: 700;
      text-align: center;
      font-size: 9pt;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
    }
    .tag-theory { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
    .tag-practical { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
    .tag-mixed { background: #fef3c7; color: #92400e; border-color: #fde68a; }
    .footer-block {
      display: flex;
      justify-content: space-between;
      margin-top: 35px;
      page-break-inside: avoid;
      font-size: 9pt;
      line-height: 1.6;
    }
    .sign-box { width: 45%; }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div>
      <strong>Monthly Timetable / Schedule</strong> (${displayFrom} to ${displayTo}) · ${sessionRows.length} Days · ${totalHours} Hours
    </div>
    <div>
      <button class="btn btn-secondary" onclick="window.print()">🖨️ Print Timetable</button>
      <a href="/api/print/timetable?batchId=${batchId}&from=${from || ''}&to=${to || ''}&format=pdf" class="btn">⬇️ Download PDF</a>
    </div>
  </div>

  <div class="page">
    <div class="header-block">
      <h2>ජාතික තරුණ සේවා සභාව — NATIONAL YOUTH SERVICES COUNCIL</h2>
      <h3>${settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස'} / Technical Training Centre – Akuressa</h3>
      <h4>මාසික කාලසටහන — MONTHLY TIMETABLE & LESSON SCHEDULE</h4>
    </div>

    <div class="meta-box">
      <div>
        <span>පාඨමාලාව / Course:</span> ${settings.course_title || batch.name}<br>
        <span>කාණ්ඩය / Batch:</span> ${batch.name} (NVQ Level 4)
      </div>
      <div>
        <span>කාල සීමාව / Period:</span> ${displayFrom} සිට ${displayTo} දක්වා<br>
        <span>දෛනික වේලාව / Daily Time:</span> 09:00 AM – 04:00 PM (පැය 6.5)
      </div>
      <div style="text-align: right;">
        <span>ඉගැන්වීම් දින / Days:</span> ${sessionRows.length} දින<br>
        <span>මුළු පැය / Total Hours:</span> ${totalHours} h (ඉලක්කය: 120h)
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 11%;">දිනය (Date)</th>
          <th style="width: 11%;">දවස (Day)</th>
          <th style="width: 11%;">වේලාව (Time)</th>
          <th style="width: 14%;">මොඩියුලය (Module)</th>
          <th style="width: 33%;">මාතෘකාව / කාර්යය (Topic / Tasks Covered)</th>
          <th style="width: 9%;">ක්‍රමය (Mode)</th>
          <th style="width: 7%;">පැය (Hrs)</th>
        </tr>
      </thead>
      <tbody>
        ${sessionRows.length === 0 ? '<tr><td colspan="8" class="center">මෙම කාලසීමාව සඳහා කාලසටහනක් නොමැත</td></tr>' : sessionRows.map(s => `
          <tr>
            <td class="center font-bold">${s.index}</td>
            <td class="center bold">${s.sdate}</td>
            <td class="center">${s.dayNameSi} <span style="font-size: 7.5pt; color: #64748b;">(${s.dayNameEn})</span></td>
            <td class="center">09:00 - 16:00</td>
            <td><strong>${s.module_code}</strong> <div style="font-size: 7.5pt; color: #475569;">${s.module_title}</div></td>
            <td>${s.topic_text || s.module_title}</td>
            <td class="center">
              <span class="tag ${s.kind === 'theory' ? 'tag-theory' : s.kind === 'practical' ? 'tag-practical' : 'tag-mixed'}">
                ${s.kind === 'theory' ? 'න්‍යායාත්මක' : s.kind === 'practical' ? 'ප්‍රායෝගික' : 'මිශ්‍ර / Mixed'}
              </span>
            </td>
            <td class="center bold">${s.hours} h</td>
          </tr>
        `).join('')}
        <tr style="font-weight: bold; background: #f8fafc;">
          <td colspan="7" class="right">මුළු සැලසුම් කළ ඉගැන්වීම් පැය ගණන (Total Planned Hours for Period):</td>
          <td class="center" style="font-size: 10pt; color: #1e3a8a;">${totalHours} h</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-block">
      <div class="sign-box">
        <strong>සැකසුවේ (Prepared by Instructor):</strong><br><br>
        අත්සන: ..............................................................<br>
        නම: ${settings.teacher_name || 'ICT Instructor'}<br>
        තනතුර: ${settings.teacher_designation || 'ICT Instructor'}<br>
        දුරකථන: ${settings.teacher_phone || ''}
      </div>

      <div class="sign-box" style="text-align: right;">
        <strong>අනුමත කළේ (Approved by Centre In-Charge):</strong><br><br>
        අත්සන: ..............................................................<br>
        නම: ${settings.center_in_charge_name || 'යූ.එම්.ආර්. නිරෝෂා'}<br>
        තනතුර: ${settings.center_in_charge_title || 'මධ්‍යස්ථාන භාර නිලධාරී'}<br>
        තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස
      </div>
    </div>
  </div>
</body>
</html>`;

    if (format === 'pdf') {
      try {
        const pdfBuffer = await htmlToPdf(html, { landscape: true, format: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=nysc_monthly_timetable_${displayFrom}_${displayTo}.pdf`);
        return res.send(pdfBuffer);
      } catch (e) {
        return res.send(html);
      }
    }

    res.send(html);
  } catch (err) {
    console.error('Print timetable error:', err);
    res.status(500).send('Failed to generate timetable print view');
  }
});

// -------------------------------------------------------------
// 4. OFFICIAL LESSON PLAN & TEACHING RECORD (NVQ-4)
// GET /api/print/lesson-plan?batchId=&moduleId=&format=html|pdf
// -------------------------------------------------------------
router.get('/lesson-plan', optionalAuth, async (req, res) => {
  try {
    const { batchId, moduleId, format = 'html' } = req.query;
    if (!batchId) return res.status(400).send('batchId is required');

    const data = await lessonPlanService.buildLessonPlan(batchId);
    const html = renderLessonPlan({
      ...data,
      moduleId: moduleId ? Number(moduleId) : null,
      pdfHref: pdfLink(req)
    });
    return sendHtmlOrPdf(res, html, format, `lesson_plan_${batchId}${moduleId ? '_mod_' + moduleId : ''}.pdf`);
  } catch (err) {
    console.error('Print lesson plan error:', err);
    res.status(500).send('Failed to generate lesson plan document');
  }
});

module.exports = router;

