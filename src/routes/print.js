'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { buildMonthlyReport } = require('../services/reportService');
const { htmlToPdf } = require('../services/pdfService');
const { renderMonthlyReport, renderChecklist, renderBatchChecklists, renderLessonPlan, renderMonthlyCalendarPlan, renderWorkPlan } = require('../templates/printTemplates');
const lessonPlanService = require('../services/lessonPlanService');

/** Sanitize a string for safe OS filenames while preserving spaces, dashes, and letters */
function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep the auth token on the "Download PDF" link inside the preview */
function pdfLink(req) {
  const q = new URLSearchParams({ ...req.query, format: 'pdf' });
  return `${req.baseUrl}${req.path}?${q.toString()}`;
}

async function sendHtmlOrPdf(res, html, format, filename, asAttachment = false) {
  if (format === 'pdf') {
    try {
      const pdfBuffer = await htmlToPdf(html, { cssPageSize: true });
      const cleanName = sanitizeFilename(filename) || 'document.pdf';
      const disp = asAttachment ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${disp}; filename="${cleanName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`
      );
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
//    Supports paperSize=legal (all students on 1 Legal landscape sheet)
//    or paperSize=a4 (classic A4 landscape, max 13 students per page)
// GET /api/print/checklist?batchId=&taskId=&paperSize=legal|a4&format=html|pdf
// -------------------------------------------------------------
router.get('/checklist', optionalAuth, async (req, res) => {
  try {
    const { batchId, taskId, format = 'html', paperSize: rawPaperSize = 'legal' } = req.query;
    if (!batchId || !taskId) {
      return res.status(400).send('batchId and taskId are required');
    }
    const paperSize = String(rawPaperSize).toLowerCase() === 'a4' ? 'a4' : 'legal';

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

    const qLegal = new URLSearchParams({ ...req.query, paperSize: 'legal', format: 'html' });
    const qA4 = new URLSearchParams({ ...req.query, paperSize: 'a4', format: 'html' });
    const legalHref = `${req.baseUrl}${req.path}?${qLegal.toString()}`;
    const a4Href = `${req.baseUrl}${req.path}?${qA4.toString()}`;

    const html = renderChecklist({
      task, steps, students, resultsMap, compMap, settings,
      paperSize,
      legalHref,
      a4Href,
      pdfHref: pdfLink(req)
    });
    const includeModule = req.query.includeModule === '1' || req.query.includeModule === 'true';
    const asAttachment = req.query.download === '1' || req.query.download === 'true';
    const savedTaskFilename = includeModule
      ? `${task.module_code} - ${task.code} - ${task.title}.pdf`
      : `${task.code} - ${task.title}.pdf`;
    return sendHtmlOrPdf(res, html, format, savedTaskFilename, asAttachment);
  } catch (err) {
    console.error('Print checklist error:', err);
    res.status(500).send('Failed to generate checklist print view');
  }
});

// -------------------------------------------------------------
// 2b. LIST & BATCH DOWNLOAD / PRINT CHECKLISTS
//     Supports downloading all marked tasks or selected modules' tasks
//     with their current manually saved task code & title
// GET /api/print/checklists-list?batchId=&moduleIds=1,2&onlyMarked=1
// GET /api/print/checklists-batch?batchId=&moduleIds=1,2&onlyMarked=1&paperSize=legal|a4&format=html|pdf
// -------------------------------------------------------------
router.get('/checklists-list', optionalAuth, async (req, res) => {
  try {
    const { batchId, moduleIds = '', onlyMarked = '1' } = req.query;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });

    const modFilterIds = String(moduleIds)
      .split(',')
      .map(x => Number(x.trim()))
      .filter(Boolean);

    const [tasks] = await db.query(`
      SELECT t.id, t.module_id, m.code as module_code, m.title as module_title,
             t.code, t.title, t.sort_order,
             (
               SELECT COUNT(DISTINCT tc.student_id)
               FROM task_competency tc
               JOIN students s ON s.id = tc.student_id
               WHERE tc.task_id = t.id AND tc.competent = 1 AND s.batch_id = ? AND s.status = 'active'
             ) as comp_count,
             (
               SELECT COUNT(DISTINCT cr.student_id)
               FROM checklist_results cr
               JOIN steps stp ON stp.id = cr.step_id
               JOIN students s ON s.id = cr.student_id
               WHERE stp.task_id = t.id AND cr.achieved = 1 AND s.batch_id = ? AND s.status = 'active'
             ) as step_students_count
      FROM tasks t
      JOIN modules m ON m.id = t.module_id
      WHERE m.has_checklist = 1
      ORDER BY m.code ASC, t.sort_order ASC, t.id ASC
    `, [batchId, batchId]);

    const onlyMarkedBool = onlyMarked !== '0' && onlyMarked !== 'false';
    const filtered = tasks.filter(t => {
      if (modFilterIds.length > 0 && !modFilterIds.includes(Number(t.module_id))) {
        return false;
      }
      const isMarked = Number(t.comp_count) > 0 || Number(t.step_students_count) > 0;
      if (onlyMarkedBool && !isMarked) return false;
      return true;
    }).map(t => ({
      id: t.id,
      module_id: t.module_id,
      module_code: t.module_code,
      module_title: t.module_title,
      code: t.code,
      title: t.title,
      marked_students: Math.max(Number(t.comp_count), Number(t.step_students_count)),
      is_marked: Number(t.comp_count) > 0 || Number(t.step_students_count) > 0,
      filename_task: sanitizeFilename(`${t.code} - ${t.title}.pdf`),
      filename_module_task: sanitizeFilename(`${t.module_code} - ${t.code} - ${t.title}.pdf`)
    }));

    res.json({ tasks: filtered, count: filtered.length });
  } catch (err) {
    console.error('Checklists list error:', err);
    res.status(500).json({ error: 'Failed to list checklists for batch download' });
  }
});

router.get('/checklists-batch', optionalAuth, async (req, res) => {
  try {
    const {
      batchId,
      moduleIds = '',
      onlyMarked = '1',
      paperSize: rawPaperSize = 'legal',
      format = 'html'
    } = req.query;
    if (!batchId) return res.status(400).send('batchId is required');

    const paperSize = String(rawPaperSize).toLowerCase() === 'a4' ? 'a4' : 'legal';
    const modFilterIds = String(moduleIds)
      .split(',')
      .map(x => Number(x.trim()))
      .filter(Boolean);
    const onlyMarkedBool = onlyMarked !== '0' && onlyMarked !== 'false';

    // 1. All checklist tasks
    const [allTasks] = await db.query(`
      SELECT t.*, m.code as module_code, m.title as module_title,
             (
               SELECT COUNT(DISTINCT tc.student_id)
               FROM task_competency tc
               JOIN students s ON s.id = tc.student_id
               WHERE tc.task_id = t.id AND tc.competent = 1 AND s.batch_id = ? AND s.status = 'active'
             ) as comp_count,
             (
               SELECT COUNT(DISTINCT cr.student_id)
               FROM checklist_results cr
               JOIN steps stp ON stp.id = cr.step_id
               JOIN students s ON s.id = cr.student_id
               WHERE stp.task_id = t.id AND cr.achieved = 1 AND s.batch_id = ? AND s.status = 'active'
             ) as step_students_count
      FROM tasks t
      JOIN modules m ON m.id = t.module_id
      WHERE m.has_checklist = 1
      ORDER BY m.code ASC, t.sort_order ASC, t.id ASC
    `, [batchId, batchId]);

    const targetTasks = allTasks.filter(t => {
      if (modFilterIds.length > 0 && !modFilterIds.includes(Number(t.module_id))) return false;
      const isMarked = Number(t.comp_count) > 0 || Number(t.step_students_count) > 0;
      if (onlyMarkedBool && !isMarked) return false;
      return true;
    });

    if (targetTasks.length === 0) {
      return res.status(404).send('No matching checklists found for the selected filter.');
    }

    // 2. Active students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );
    const studentIds = students.map(s => s.id);
    const taskIds = targetTasks.map(t => t.id);

    // 3. Steps for target tasks
    const [allSteps] = await db.query(
      `SELECT * FROM steps WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY task_id ASC, sort_order ASC, id ASC`,
      taskIds
    );
    const stepsByTask = {};
    const stepIds = [];
    for (const stp of allSteps) {
      if (!stepsByTask[stp.task_id]) stepsByTask[stp.task_id] = [];
      stepsByTask[stp.task_id].push(stp);
      stepIds.push(stp.id);
    }

    // 4. Checklist results
    const resultsByTask = {};
    if (studentIds.length > 0 && stepIds.length > 0) {
      const [resRows] = await db.query(`
        SELECT cr.student_id, cr.step_id, cr.attempt, cr.achieved, stp.task_id
        FROM checklist_results cr
        JOIN steps stp ON stp.id = cr.step_id
        WHERE cr.student_id IN (${studentIds.map(() => '?').join(',')})
          AND cr.step_id IN (${stepIds.map(() => '?').join(',')})
      `, [...studentIds, ...stepIds]);

      for (const r of resRows) {
        if (!resultsByTask[r.task_id]) resultsByTask[r.task_id] = {};
        if (!resultsByTask[r.task_id][r.student_id]) resultsByTask[r.task_id][r.student_id] = {};
        if (!resultsByTask[r.task_id][r.student_id][r.step_id]) resultsByTask[r.task_id][r.student_id][r.step_id] = {};
        resultsByTask[r.task_id][r.student_id][r.step_id][r.attempt] = Number(r.achieved) === 1;
      }
    }

    // 5. Competencies
    const compsByTask = {};
    if (studentIds.length > 0 && taskIds.length > 0) {
      const [compRows] = await db.query(`
        SELECT task_id, student_id, competent, competent_date
        FROM task_competency
        WHERE task_id IN (${taskIds.map(() => '?').join(',')})
          AND student_id IN (${studentIds.map(() => '?').join(',')})
      `, [...taskIds, ...studentIds]);

      for (const c of compRows) {
        if (!compsByTask[c.task_id]) compsByTask[c.task_id] = {};
        compsByTask[c.task_id][c.student_id] = {
          competent: Number(c.competent) === 1,
          date: c.competent_date
        };
      }
    }

    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });

    const tasksData = targetTasks.map(task => ({
      task,
      steps: stepsByTask[task.id] || [],
      resultsMap: resultsByTask[task.id] || {},
      compMap: compsByTask[task.id] || {}
    }));

    const modCodes = [...new Set(targetTasks.map(t => t.module_code))];
    const titleLabel = modFilterIds.length > 0
      ? `Modules ${modCodes.join(', ')} (${targetTasks.length} Checklists)`
      : `All Marked Checklists (${targetTasks.length} Tasks)`;

    const qLegal = new URLSearchParams({ ...req.query, paperSize: 'legal', format: 'html' });
    const qA4 = new URLSearchParams({ ...req.query, paperSize: 'a4', format: 'html' });
    const legalHref = `${req.baseUrl}${req.path}?${qLegal.toString()}`;
    const a4Href = `${req.baseUrl}${req.path}?${qA4.toString()}`;

    const html = renderBatchChecklists({
      tasksData,
      students,
      settings,
      paperSize,
      legalHref,
      a4Href,
      pdfHref: pdfLink(req),
      titleLabel
    });

    const outFilename = modFilterIds.length > 0
      ? `Checklists_${modCodes.join('_')}_${paperSize.toUpperCase()}.pdf`
      : `All_Marked_Checklists_${targetTasks.length}_Tasks_${paperSize.toUpperCase()}.pdf`;

    const asAttachment = req.query.download === '1' || req.query.download === 'true';
    return sendHtmlOrPdf(res, html, format, outFilename, asAttachment);
  } catch (err) {
    console.error('Batch print checklists error:', err);
    res.status(500).send('Failed to generate batch checklists');
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

  const { syncOffDaysForBatch } = require('../services/schedulerService');
  await syncOffDaysForBatch(batchId);

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
          const isClosure = !!(dl && ['teacher_absent', 'institute_closed', 'leave', 'holiday', 'centre_closed'].includes(dl.status));
          const sList = (hol || isClosure) ? [] : (sessMap[ymd] || []);
          const isBeforeStart = ymd < batch.start_date;
          const dayHours = (hol || isClosure)
            ? 0
            : (sList.reduce((acc, s) => acc + Number(s.hours), 0) || (dl && Number(dl.hours_delivered)) || 0);
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
              return `<div class="topic-line">${text}${isAssign ? ' <span class="tag-assign">(Assignment)</span>' : ''}${isPract ? ' <span class="tag-act">(Practical)</span>' : ''}</div>`;
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
            isClosure,
            closureReason: dl ? (dl.reason || (dl.status === 'teacher_absent' ? 'Instructor Absent' : 'Centre Closed')) : '',
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
    @page {
      size: A4 landscape;
      margin: 10mm 12mm 10mm 20mm;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: 'Book Antiqua', 'Georgia', 'Times New Roman', 'Iskoola Pota', 'Nirmala UI', serif;
      margin: 0;
      padding: 0;
      color: #000;
      font-size: 9.5pt;
    }
    .page {
      padding: 10mm 12mm 10mm 20mm;
      margin: 14px auto;
      max-width: 297mm;
      background: white;
      box-shadow: 0 4px 18px rgba(0,0,0,0.22);
    }
    @media print {
      body { margin: 0; }
      .page { padding: 0; margin: 0; max-width: none; box-shadow: none; }
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
      font-family: 'Segoe UI', Arial, sans-serif;
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
      border-bottom: 2pt double #000;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .header-block h2 {
      margin: 0 0 2px 0;
      font-size: 13.5pt;
      font-weight: bold;
      letter-spacing: 0.4px;
    }
    .header-block h3 {
      margin: 0 0 3px 0;
      font-size: 11pt;
      font-weight: bold;
      color: #222;
    }
    .header-block h4 {
      margin: 0;
      font-size: 11.5pt;
      font-weight: bold;
      color: #000;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 9pt;
    }
    .meta-table td {
      border: 0.75pt solid #222;
      padding: 4px 8px;
      background: #fafafa;
    }
    table.sched-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }
    table.sched-table th, table.sched-table td {
      border: 0.75pt solid #111;
      padding: 4.5px 6px;
      vertical-align: middle;
    }
    table.sched-table th {
      background: #eaecef;
      font-weight: bold;
      text-align: center;
      font-size: 9pt;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .num { font-family: 'Times New Roman', Times, serif; }
    .footer-block {
      display: flex;
      justify-content: space-between;
      margin-top: 28px;
      page-break-inside: avoid;
      font-size: 9.2pt;
      line-height: 1.55;
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
      <a href="/api/print/timetable?batchId=${batchId}&from=${from || ''}&to=${to || ''}&layout=list&format=pdf" class="btn">⬇️ Download PDF</a>
    </div>
  </div>

  <div class="page">
    <div class="header-block">
      <h2>ජාතික තරුණ සේවා සභාව — NATIONAL YOUTH SERVICES COUNCIL</h2>
      <h3>${settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස'} / Technical Training Centre – Akuressa</h3>
      <h4>මාසික කාලසටහන — MONTHLY TIMETABLE &amp; LESSON SCHEDULE</h4>
    </div>

    <table class="meta-table">
      <tr>
        <td><strong>පාඨමාලාව / Course :-</strong> ${settings.course_title || batch.name}</td>
        <td><strong>කාල සීමාව / Period :-</strong> <span class="num">${displayFrom}</span> සිට <span class="num">${displayTo}</span> දක්වා</td>
        <td><strong>ඉගැන්වීම් දින / Days :-</strong> <span class="num">${sessionRows.length}</span> දින</td>
      </tr>
      <tr>
        <td><strong>කාණ්ඩය / Batch :-</strong> ${batch.name} (NVQ Level 4)</td>
        <td><strong>දෛනික වේලාව / Daily Time :-</strong> <span class="num">09:00 AM – 04:00 PM</span></td>
        <td><strong>මුළු පැය / Total Hours :-</strong> <strong class="num">${totalHours} Hrs</strong> (ඉලක්කය: 120h)</td>
      </tr>
    </table>

    <table class="sched-table">
      <thead>
        <tr>
          <th style="width: 4%;">අංකය</th>
          <th style="width: 11%;">දිනය (Date)</th>
          <th style="width: 12%;">දවස (Day)</th>
          <th style="width: 11%;">වේලාව (Time)</th>
          <th style="width: 14%;">මොඩියුලය (Module)</th>
          <th style="width: 32%;">මාතෘකාව / කාර්යය (Topic / Tasks Covered)</th>
          <th style="width: 9%;">ක්‍රමය (Mode)</th>
          <th style="width: 7%;">පැය (Hrs)</th>
        </tr>
      </thead>
      <tbody>
        ${sessionRows.length === 0 ? '<tr><td colspan="8" class="center">මෙම කාලසීමාව සඳහා කාලසටහනක් නොමැත</td></tr>' : sessionRows.map(s => `
          <tr>
            <td class="center bold num">${s.index}</td>
            <td class="center bold num">${s.sdate}</td>
            <td class="center">${s.dayNameSi} <span style="font-size: 7.5pt; color: #333;">(${s.dayNameEn})</span></td>
            <td class="center num">09:00 - 16:00</td>
            <td><strong class="num">${s.module_code}</strong> <div style="font-size: 7.8pt; color: #222;">${s.module_title}</div></td>
            <td>${s.topic_text || s.module_title}</td>
            <td class="center" style="font-size: 8.5pt; font-style: italic;">
              ${s.kind === 'theory' ? 'න්‍යායාත්මක' : s.kind === 'practical' ? 'ප්‍රායෝගික' : 'න්‍යායාත්මක / ප්‍රායෝගික'}
            </td>
            <td class="center bold num">${s.hours}</td>
          </tr>
        `).join('')}
        <tr style="font-weight: bold; background: #eaecef;">
          <td colspan="7" class="right">මුළු සැලසුම් කළ ඉගැන්වීම් පැය ගණන (Total Planned Hours for Period) :-</td>
          <td class="center num" style="font-size: 10pt;">${totalHours}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-block">
      <div class="sign-box">
        <strong>ඉදිරිපත් කළේ (Prepared by Instructor) :-</strong><br><br>
        අත්සන :- ..............................................................<br>
        නම :- ${settings.teacher_name || 'R.Kandawela'}<br>
        තනතුර :- ${settings.teacher_designation || 'ICT Instructor'}<br>
        දුරකථන :- ${settings.teacher_phone || ''}
      </div>

      <div class="sign-box" style="text-align: right;">
        <strong>අනුමත කළේ (Approved by Centre In-Charge) :-</strong><br><br>
        අත්සන :- ..............................................................<br>
        නම :- ${settings.center_in_charge_name || 'යූ.එම්.ආර්. නිරෝෂා'}<br>
        තනතුර :- ${settings.center_in_charge_title || 'මධ්‍යස්ථාන භාර නිලධාරී'}<br>
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

// -------------------------------------------------------------
// 5. OFFICIAL MASTER TRAINING WORK PLAN (GANTT CHART)
//    Synchronized with Lesson Plan, Timetable & Holiday Calendar
// GET /api/print/work-plan?batchId=&paperSize=a4|legal&format=html|pdf
// -------------------------------------------------------------
router.get('/work-plan', optionalAuth, async (req, res) => {
  try {
    const { batchId, format = 'html', paperSize: rawPaperSize = 'a4' } = req.query;
    if (!batchId) return res.status(400).send('batchId is required');

    const paperSize = String(rawPaperSize).toLowerCase() === 'legal' ? 'legal' : 'a4';
    const data = await lessonPlanService.buildLessonPlan(batchId);

    const qA4 = new URLSearchParams({ ...req.query, paperSize: 'a4', format: 'html' });
    const qLegal = new URLSearchParams({ ...req.query, paperSize: 'legal', format: 'html' });
    const a4Href = `${req.baseUrl}${req.path}?${qA4.toString()}`;
    const legalHref = `${req.baseUrl}${req.path}?${qLegal.toString()}`;

    const html = renderWorkPlan({
      ...data,
      paperSize,
      a4Href,
      legalHref,
      pdfHref: pdfLink(req)
    });
    return sendHtmlOrPdf(res, html, format, `nysc_work_plan_gantt_${batchId}_${paperSize}.pdf`);
  } catch (err) {
    console.error('Print work plan error:', err);
    res.status(500).send('Failed to generate work plan Gantt document');
  }
});

module.exports = router;

