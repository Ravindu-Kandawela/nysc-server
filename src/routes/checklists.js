'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

/**
 * Helper: Given a student's sorted array of Present ('P'/'L') dates and a task's planned dates,
 * pick the Lesson Plan date if the student was Present on that date,
 * or strictly the closest Present day AFTER the planned date when the student next arrived.
 * Never picks a date before the planned date.
 */
function pickAssessmentDateForStudent(presentDatesSorted, presentSet, planDates, strategy = 'plan_end') {
  if (!planDates || planDates.length === 0) {
    return { date: null, reason: 'no_plan_date', absentOnPlanDate: false };
  }

  const primaryPlanDate = strategy === 'plan_start'
    ? planDates[0]
    : planDates[planDates.length - 1];

  // 1. Check if student was present on the task's planned assessment date
  if (presentSet.has(primaryPlanDate)) {
    return {
      date: primaryPlanDate,
      primaryPlanDate,
      reason: 'plan_date',
      absentOnPlanDate: false
    };
  }

  // 2. Student was Absent on the planned date -> strictly pick the closest Present day AFTER primaryPlanDate
  if (!presentDatesSorted || presentDatesSorted.length === 0) {
    return { date: null, primaryPlanDate, reason: 'no_present_attendance', absentOnPlanDate: true };
  }

  const afterDates = presentDatesSorted.filter(d => d > primaryPlanDate);
  if (afterDates.length > 0) {
    return {
      date: afterDates[0],
      primaryPlanDate,
      reason: 'closest_present_after',
      absentOnPlanDate: true
    };
  }

  // Student has not yet attended any day after primaryPlanDate (never assign a date before primaryPlanDate)
  return { date: null, primaryPlanDate, reason: 'no_present_after_plan_date', absentOnPlanDate: true };
}

// GET /api/batches/:id/checklists/progress/summary
router.get('/progress/summary', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;

    // Total checklist tasks (modules with has_checklist = 1)
    const [taskCount] = await db.query(`
      SELECT COUNT(t.id) as total_tasks
      FROM tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE m.has_checklist = 1
    `);
    const totalTasks = Number(taskCount[0].total_tasks);

    // Students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    // Competent counts per student
    const [compRows] = await db.query(`
      SELECT tc.student_id, COUNT(tc.task_id) as competent_count
      FROM task_competency tc
      JOIN students s ON tc.student_id = s.id
      WHERE s.batch_id = ? AND s.status = "active" AND tc.competent = 1
      GROUP BY tc.student_id
    `, [batchId]);

    const compMap = {};
    compRows.forEach(c => { compMap[c.student_id] = Number(c.competent_count); });

    const progress = students.map(st => {
      const competentCount = compMap[st.id] || 0;
      const pct = totalTasks > 0 ? Math.round((competentCount / totalTasks) * 100) : 0;
      return {
        student_id: st.id,
        reg_no: st.reg_no,
        full_name: st.full_name,
        sort_order: st.sort_order,
        competent_tasks: competentCount,
        total_tasks: totalTasks,
        percentage: pct
      };
    });

    res.json({ totalTasks, progress });
  } catch (err) {
    console.error('Checklist progress summary error:', err);
    res.status(500).json({ error: 'Failed to fetch checklist progress' });
  }
});

// GET /api/batches/:id/checklists/analyze/plan
// Read-only analysis of existing manual checklist records vs Lesson Plan dates & Student Attendance
router.get('/analyze/plan', requireAuth, async (req, res) => {
  try {
    if (req.user?.role === 'standard') {
      return res.status(403).json({ error: 'Not available for this account' });
    }
    const batchId = req.params.id;

    // 1. Active students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );
    const totalStudents = students.length;

    // 2. All checklist tasks + lesson plan dates from current plan version
    const [taskRows] = await db.query(`
      SELECT t.id as task_id, t.module_id, m.code as module_code, m.title as module_title,
             t.code as task_code, t.title as task_title, t.sort_order,
             MIN(ps.sdate) as plan_start, MAX(ps.sdate) as plan_end,
             ROUND(SUM(ps.hours), 1) as plan_hours,
             GROUP_CONCAT(DISTINCT ps.sdate ORDER BY ps.sdate) as plan_dates_csv,
             (SELECT COUNT(*) FROM steps stp WHERE stp.task_id = t.id) as step_count
      FROM tasks t
      JOIN modules m ON m.id = t.module_id
      LEFT JOIN plan_versions pv ON pv.batch_id = ? AND pv.is_current = 1
      LEFT JOIN plan_sessions ps ON ps.plan_version_id = pv.id AND ps.task_id = t.id
      WHERE m.has_checklist = 1
      GROUP BY t.id, t.module_id, m.code, m.title, t.code, t.title, t.sort_order
      ORDER BY m.code ASC, t.sort_order ASC, t.id ASC
    `, [batchId]);

    // 3. Existing manual task_competency rows
    const [compRows] = await db.query(`
      SELECT tc.task_id, tc.student_id, tc.competent, tc.competent_date, a.status as att_status
      FROM task_competency tc
      JOIN students s ON s.id = tc.student_id
      LEFT JOIN attendance a ON a.batch_id = s.batch_id AND a.student_id = tc.student_id AND a.adate = tc.competent_date
      WHERE s.batch_id = ? AND s.status = "active" AND tc.competent = 1
    `, [batchId]);

    // 4. Existing checklist_results summary per task
    const [resRows] = await db.query(`
      SELECT stp.task_id, COUNT(DISTINCT cr.student_id) as students_with_steps,
             COUNT(*) as step_marks,
             GROUP_CONCAT(DISTINCT cr.assessed_on ORDER BY cr.assessed_on) as step_dates_csv
      FROM checklist_results cr
      JOIN steps stp ON stp.id = cr.step_id
      JOIN students s ON s.id = cr.student_id
      WHERE s.batch_id = ? AND s.status = "active" AND cr.achieved = 1
      GROUP BY stp.task_id
    `, [batchId]);

    const resMap = {};
    resRows.forEach(r => { resMap[r.task_id] = r; });

    const compByTask = {};
    const compByStudent = {};
    const conflicts = [];

    for (const c of compRows) {
      if (!compByTask[c.task_id]) compByTask[c.task_id] = [];
      compByTask[c.task_id].push(c);

      compByStudent[c.student_id] = (compByStudent[c.student_id] || 0) + 1;

      if (c.att_status === 'A') {
        conflicts.push(c);
      }
    }

    // Max attendance date logged for batch
    const [attMaxRow] = await db.query(
      'SELECT MIN(adate) as min_att, MAX(adate) as max_att, COUNT(DISTINCT adate) as total_days FROM attendance WHERE batch_id = ?',
      [batchId]
    );
    const maxAttendanceDate = attMaxRow[0]?.max_att || new Date().toISOString().slice(0, 10);

    const tasksAnalysis = taskRows.map(t => {
      const comps = compByTask[t.task_id] || [];
      const resInfo = resMap[t.task_id] || { students_with_steps: 0, step_marks: 0, step_dates_csv: '' };
      const manualDates = [...new Set(comps.map(c => c.competent_date).filter(Boolean))].sort();
      const planDates = t.plan_dates_csv ? t.plan_dates_csv.split(',') : [];
      const competentCount = comps.length;
      const missingCount = Math.max(0, totalStudents - competentCount);
      const isTaughtByAttendance = t.plan_start && t.plan_start <= maxAttendanceDate;

      let status = 'not_started';
      if (competentCount >= totalStudents && totalStudents > 0) status = 'complete';
      else if (competentCount > 0) status = 'partial_manual';
      else if (isTaughtByAttendance) status = 'taught_unmarked';

      return {
        task_id: t.task_id,
        module_id: t.module_id,
        module_code: t.module_code,
        module_title: t.module_title,
        task_code: t.task_code,
        task_title: t.task_title,
        step_count: Number(t.step_count || 0),
        plan_start: t.plan_start,
        plan_end: t.plan_end,
        plan_hours: Number(t.plan_hours || 0),
        plan_dates: planDates,
        competent_count: competentCount,
        students_with_steps: Number(resInfo.students_with_steps || 0),
        missing_count: missingCount,
        total_students: totalStudents,
        manual_dates_used: manualDates,
        status,
        is_taught: Boolean(isTaughtByAttendance)
      };
    });

    const studentSummary = students.map(s => ({
      student_id: s.id,
      reg_no: s.reg_no,
      full_name: s.full_name,
      competent_tasks: compByStudent[s.id] || 0
    }));

    res.json({
      totalStudents,
      maxAttendanceDate,
      minAttendanceDate: attMaxRow[0]?.min_att || null,
      totalAttendanceDays: Number(attMaxRow[0]?.total_days || 0),
      conflictsCount: conflicts.length,
      conflicts,
      tasks: tasksAnalysis,
      students: studentSummary
    });
  } catch (err) {
    console.error('Checklist plan analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze checklist against lesson plan' });
  }
});

// POST /api/batches/:id/checklists/auto-fill
// Automatically fills missing student checklists using Lesson Plan dates (or closest Present date if absent).
// NEVER overwrites or modifies existing manual checklist entries.
router.post('/auto-fill', requireAuth, async (req, res) => {
  if (req.user?.role === 'standard') {
    return res.status(403).json({ error: 'Auto-fill is not available for this account' });
  }
  const connection = await db.getConnection();
  try {
    const batchId = req.params.id;
    const {
      scope = 'task', // 'task' | 'module' | 'all_taught'
      taskId = null,
      moduleId = null,
      upToDate = '2026-10-30',
      strategy = 'plan_end', // 'plan_end' | 'plan_start'
      preview = true
    } = req.body;

    // 1. Active students
    const [students] = await connection.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );
    if (students.length === 0) {
      return res.status(400).json({ error: 'No active students found in this batch' });
    }

    // 2. All present ('P' or 'L') attendance dates per student
    const [attRows] = await connection.query(
      `SELECT student_id, adate, status FROM attendance WHERE batch_id = ? AND status IN ('P', 'L') ORDER BY adate ASC`,
      [batchId]
    );
    const presentByStudent = {};
    const presentSetByStudent = {};
    for (const s of students) {
      presentByStudent[s.id] = [];
      presentSetByStudent[s.id] = new Set();
    }
    for (const r of attRows) {
      if (presentByStudent[r.student_id]) {
        presentByStudent[r.student_id].push(r.adate);
        presentSetByStudent[r.student_id].add(r.adate);
      }
    }

    // 3. Determine target tasks with lesson plan dates
    let whereClause = 'WHERE m.has_checklist = 1';
    const queryParams = [batchId];

    if (scope === 'task' && taskId) {
      whereClause += ' AND t.id = ?';
      queryParams.push(taskId);
    } else if (scope === 'module' && moduleId) {
      whereClause += ' AND t.module_id = ?';
      queryParams.push(moduleId);
    }

    const [taskRows] = await connection.query(`
      SELECT t.id as task_id, t.module_id, m.code as module_code, t.code as task_code, t.title as task_title,
             MIN(ps.sdate) as plan_start, MAX(ps.sdate) as plan_end,
             GROUP_CONCAT(DISTINCT ps.sdate ORDER BY ps.sdate) as plan_dates_csv
      FROM tasks t
      JOIN modules m ON m.id = t.module_id
      LEFT JOIN plan_versions pv ON pv.batch_id = ? AND pv.is_current = 1
      LEFT JOIN plan_sessions ps ON ps.plan_version_id = pv.id AND ps.task_id = t.id
      ${whereClause}
      GROUP BY t.id, t.module_id, m.code, t.code, t.title, t.sort_order
      ORDER BY m.code ASC, t.sort_order ASC, t.id ASC
    `, queryParams);

    const targetTasks = taskRows.filter(t => {
      if (!t.plan_start) return false;
      if (scope === 'all_taught') {
        return t.plan_start <= upToDate;
      }
      return true;
    });

    if (targetTasks.length === 0) {
      return res.json({
        preview: Boolean(preview),
        tasksProcessed: 0,
        studentsFilledCount: 0,
        existingPreservedCount: 0,
        planDateMatchesCount: 0,
        closestPresentFallbackCount: 0,
        items: []
      });
    }

    const targetTaskIds = targetTasks.map(t => t.task_id);

    // 4. Steps for target tasks
    const [allSteps] = await connection.query(`
      SELECT id, task_id, code, title, sort_order
      FROM steps
      WHERE task_id IN (${targetTaskIds.map(() => '?').join(',')})
      ORDER BY task_id ASC, sort_order ASC, id ASC
    `, targetTaskIds);

    const stepsByTask = {};
    for (const stp of allSteps) {
      if (!stepsByTask[stp.task_id]) stepsByTask[stp.task_id] = [];
      stepsByTask[stp.task_id].push(stp);
    }

    // 5. Existing competencies and checklist results (to strictly preserve manual data!)
    const studentIds = students.map(s => s.id);
    const [existingComps] = await connection.query(`
      SELECT task_id, student_id, competent, competent_date
      FROM task_competency
      WHERE task_id IN (${targetTaskIds.map(() => '?').join(',')})
        AND student_id IN (${studentIds.map(() => '?').join(',')})
        AND competent = 1
    `, [...targetTaskIds, ...studentIds]);

    const existingCompMap = {};
    const manualDatesByTask = {};
    for (const c of existingComps) {
      existingCompMap[`${c.task_id}_${c.student_id}`] = c;
      if (c.competent_date) {
        if (!manualDatesByTask[c.task_id]) manualDatesByTask[c.task_id] = [];
        manualDatesByTask[c.task_id].push(c.competent_date);
      }
    }

    const [existingStepsRows] = await connection.query(`
      SELECT stp.task_id, cr.student_id, COUNT(*) as achieved_steps, MIN(cr.assessed_on) as min_date
      FROM checklist_results cr
      JOIN steps stp ON stp.id = cr.step_id
      WHERE stp.task_id IN (${targetTaskIds.map(() => '?').join(',')})
        AND cr.student_id IN (${studentIds.map(() => '?').join(',')})
        AND cr.achieved = 1
      GROUP BY stp.task_id, cr.student_id
    `, [...targetTaskIds, ...studentIds]);

    const existingStepMap = {};
    for (const r of existingStepsRows) {
      existingStepMap[`${r.task_id}_${r.student_id}`] = r;
    }

    // 6. Build auto-fill plan for missing student-task pairs
    const items = [];
    let existingPreservedCount = 0;
    let studentsFilledCount = 0;
    let planDateMatchesCount = 0;
    let closestPresentFallbackCount = 0;

    if (!preview) {
      await connection.beginTransaction();
    }

    for (const task of targetTasks) {
      const planDates = task.plan_dates_csv ? task.plan_dates_csv.split(',') : [];
      const taskSteps = stepsByTask[task.task_id] || [];
      if (planDates.length === 0 || taskSteps.length === 0) continue;

      const primaryPlanDate = strategy === 'plan_start'
        ? planDates[0]
        : planDates[planDates.length - 1];

      for (const st of students) {
        const key = `${task.task_id}_${st.id}`;
        const existingComp = existingCompMap[key];
        const existingStep = existingStepMap[key];
        const existingDate = existingComp?.competent_date || existingStep?.min_date || null;

        // Preserve existing valid manual record ONLY if its date is >= primaryPlanDate and student was Present on that date.
        // If an earlier auto-fill set a date BEFORE primaryPlanDate or on an absent/off day, recalculate and fix it!
        const isInvalidBeforeOrAbsent = existingDate && (
          existingDate < primaryPlanDate || !presentSetByStudent[st.id]?.has(existingDate)
        );

        if ((existingComp || (existingStep && existingStep.achieved_steps > 0)) && !isInvalidBeforeOrAbsent) {
          existingPreservedCount++;
          items.push({
            task_id: task.task_id,
            module_code: task.module_code,
            task_code: task.task_code,
            task_title: task.task_title,
            student_id: st.id,
            reg_no: st.reg_no,
            full_name: st.full_name,
            action: 'preserved_manual',
            chosen_date: existingDate,
            plan_date: primaryPlanDate,
            reason: 'manual_existing'
          });
          continue;
        }

        const picked = pickAssessmentDateForStudent(
          presentByStudent[st.id],
          presentSetByStudent[st.id],
          planDates,
          strategy
        );

        if (!picked.date) {
          items.push({
            task_id: task.task_id,
            module_code: task.module_code,
            task_code: task.task_code,
            task_title: task.task_title,
            student_id: st.id,
            reg_no: st.reg_no,
            full_name: st.full_name,
            action: 'skipped_no_attendance',
            chosen_date: null,
            plan_date: picked.primaryPlanDate,
            reason: picked.reason
          });
          continue;
        }

        studentsFilledCount++;
        if (picked.absentOnPlanDate) {
          closestPresentFallbackCount++;
        } else {
          planDateMatchesCount++;
        }

        items.push({
          task_id: task.task_id,
          module_code: task.module_code,
          task_code: task.task_code,
          task_title: task.task_title,
          student_id: st.id,
          reg_no: st.reg_no,
          full_name: st.full_name,
          action: 'auto_fill',
          chosen_date: picked.date,
          plan_date: picked.primaryPlanDate,
          absent_on_plan_date: picked.absentOnPlanDate,
          reason: picked.reason
        });

        if (!preview) {
          // Insert or update checklist_results for all steps of this task (Attempt 1 = achieved on chosen_date)
          const stepValues = taskSteps.map(stp => [st.id, stp.id, 1, 1, picked.date]);
          await connection.query(
            `INSERT INTO checklist_results (student_id, step_id, attempt, achieved, assessed_on) VALUES ?
             ON DUPLICATE KEY UPDATE achieved = VALUES(achieved), assessed_on = VALUES(assessed_on)`,
            [stepValues]
          );

          // Insert or update task_competency with the verified chosen_date
          await connection.query(
            `INSERT INTO task_competency (student_id, task_id, competent, competent_date) VALUES (?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE competent = VALUES(competent), competent_date = VALUES(competent_date)`,
            [st.id, task.task_id, picked.date]
          );
        }
      }
    }

    if (!preview) {
      await connection.commit();
    }

    res.json({
      preview: Boolean(preview),
      scope,
      strategy,
      tasksProcessed: targetTasks.length,
      studentsFilledCount,
      existingPreservedCount,
      planDateMatchesCount,
      closestPresentFallbackCount,
      items
    });
  } catch (err) {
    if (!req.body?.preview) {
      await connection.rollback();
    }
    console.error('Checklist auto-fill error:', err);
    res.status(500).json({ error: err.message || 'Failed to auto-fill checklists' });
  } finally {
    connection.release();
  }
});

// GET /api/batches/:id/checklists/:taskId
router.get('/:taskId', requireAuth, async (req, res) => {
  try {
    const { id: batchId, taskId } = req.params;

    // 1. Task info
    const [tasks] = await db.query(`
      SELECT t.*, m.code as module_code, m.title as module_title
      FROM tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE t.id = ?
    `, [taskId]);

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const task = tasks[0];

    // 1b. Lesson Plan dates for this task from current plan version
    const [planRows] = await db.query(`
      SELECT MIN(ps.sdate) as plan_start, MAX(ps.sdate) as plan_end,
             ROUND(SUM(ps.hours), 1) as plan_hours,
             GROUP_CONCAT(DISTINCT ps.sdate ORDER BY ps.sdate) as plan_dates_csv
      FROM plan_versions pv
      JOIN plan_sessions ps ON ps.plan_version_id = pv.id
      WHERE pv.batch_id = ? AND pv.is_current = 1 AND ps.task_id = ?
    `, [batchId, taskId]);

    const planInfo = {
      plan_start: planRows[0]?.plan_start || null,
      plan_end: planRows[0]?.plan_end || null,
      plan_hours: Number(planRows[0]?.plan_hours || 0),
      plan_dates: planRows[0]?.plan_dates_csv ? planRows[0].plan_dates_csv.split(',') : []
    };

    // 2. Steps for this task
    const [steps] = await db.query(
      'SELECT id, task_id, code, title, sort_order FROM steps WHERE task_id = ? ORDER BY sort_order ASC, id ASC',
      [taskId]
    );

    // 3. Students for this batch
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    if (students.length === 0 || steps.length === 0) {
      return res.json({
        task,
        planInfo,
        steps,
        students,
        results: {},
        competencies: {},
        suggestedDates: {}
      });
    }

    const studentIds = students.map(s => s.id);
    const stepIds = steps.map(s => s.id);

    // 4. Checklist results
    const [resultsRows] = await db.query(`
      SELECT student_id, step_id, attempt, achieved, assessed_on
      FROM checklist_results
      WHERE student_id IN (${studentIds.map(() => '?').join(',')})
        AND step_id IN (${stepIds.map(() => '?').join(',')})
    `, [...studentIds, ...stepIds]);

    const results = {};
    for (const r of resultsRows) {
      if (!results[r.student_id]) results[r.student_id] = {};
      if (!results[r.student_id][r.step_id]) results[r.student_id][r.step_id] = {};
      results[r.student_id][r.step_id][r.attempt] = {
        achieved: Number(r.achieved) === 1,
        assessed_on: r.assessed_on
      };
    }

    // 5. Task competencies
    const [compRows] = await db.query(`
      SELECT student_id, competent, competent_date
      FROM task_competency
      WHERE task_id = ? AND student_id IN (${studentIds.map(() => '?').join(',')})
    `, [taskId, ...studentIds]);

    const competencies = {};
    for (const c of compRows) {
      competencies[c.student_id] = {
        competent: Number(c.competent) === 1,
        competent_date: c.competent_date
      };
    }

    // 6. Attendance for selected assessment date
    const assessmentDate = req.query.date || planInfo.plan_end || new Date().toISOString().slice(0, 10);
    const [attRows] = await db.query(
      'SELECT student_id, status FROM attendance WHERE batch_id = ? AND adate = ?',
      [batchId, assessmentDate]
    );
    const attendanceMap = {};
    attRows.forEach(a => { attendanceMap[a.student_id] = a.status; });

    // 7. Suggested assessment date per student based on Lesson Plan + Student Attendance
    const suggestedDates = {};
    const targetPlanDates = req.query.date
      ? [req.query.date]
      : (planInfo.plan_dates.length > 0 ? planInfo.plan_dates : [assessmentDate]);

    if (targetPlanDates.length > 0) {
      const [allPresentRows] = await db.query(
        `SELECT student_id, adate FROM attendance WHERE batch_id = ? AND status IN ('P', 'L') ORDER BY adate ASC`,
        [batchId]
      );
      const presentByStudent = {};
      const presentSetByStudent = {};
      students.forEach(s => {
        presentByStudent[s.id] = [];
        presentSetByStudent[s.id] = new Set();
      });
      allPresentRows.forEach(r => {
        if (presentByStudent[r.student_id]) {
          presentByStudent[r.student_id].push(r.adate);
          presentSetByStudent[r.student_id].add(r.adate);
        }
      });

      students.forEach(s => {
        suggestedDates[s.id] = pickAssessmentDateForStudent(
          presentByStudent[s.id],
          presentSetByStudent[s.id],
          targetPlanDates,
          'plan_end'
        );
      });
    }

    res.json({
      task,
      planInfo,
      steps,
      students,
      results,
      competencies,
      attendanceMap,
      assessmentDate,
      suggestedDates
    });
  } catch (err) {
    console.error('Checklist get error:', err);
    res.status(500).json({ error: 'Failed to fetch checklist' });
  }
});

// PUT /api/batches/:id/checklists/:taskId (bulk update cells)
router.put('/:taskId', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id: batchId, taskId } = req.params;
    const { updates = [] } = req.body; // array of { student_id, step_id, attempt, achieved, assessed_on }

    const today = new Date().toISOString().slice(0, 10);
    for (const u of updates) {
      const targetDate = u.assessed_on || today;

      // If marking achieved, verify student was NOT absent on that day
      if (u.achieved) {
        const [att] = await connection.query(`
          SELECT a.status, s.full_name 
          FROM attendance a 
          JOIN students s ON a.student_id = s.id 
          WHERE a.batch_id = ? AND a.student_id = ? AND a.adate = ?
        `, [batchId, u.student_id, targetDate]);

        if (att.length > 0 && att[0].status === 'A') {
          await connection.rollback();
          return res.status(400).json({
            error: `Cannot add to checklist: ${att[0].full_name} is marked ABSENT on ${targetDate}. Absent students cannot be evaluated on days they did not attend.`
          });
        }
      }

      await connection.query(`
        INSERT INTO checklist_results (student_id, step_id, attempt, achieved, assessed_on)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          achieved = VALUES(achieved),
          assessed_on = VALUES(assessed_on)
      `, [u.student_id, u.step_id, u.attempt, u.achieved ? 1 : 0, targetDate]);
    }

    await connection.commit();
    res.json({ message: 'Checklist updated successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Checklist update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update checklist' });
  } finally {
    connection.release();
  }
});

// PUT /api/batches/:id/checklists/:taskId/competency
router.put('/:taskId/competency', requireAuth, async (req, res) => {
  try {
    const { id: batchId, taskId } = req.params;
    const { student_id, competent, competent_date } = req.body;

    const date = competent_date || (competent ? new Date().toISOString().slice(0, 10) : null);

    // If marking competent, verify student was NOT absent on that date
    if (competent && date) {
      const [att] = await db.query(`
        SELECT a.status, s.full_name 
        FROM attendance a 
        JOIN students s ON a.student_id = s.id 
        WHERE a.batch_id = ? AND a.student_id = ? AND a.adate = ?
      `, [batchId, student_id, date]);

      if (att.length > 0 && att[0].status === 'A') {
        return res.status(400).json({
          error: `Cannot mark competent: ${att[0].full_name} is marked ABSENT on ${date}. Absent students cannot be evaluated.`
        });
      }
    }

    await db.query(`
      INSERT INTO task_competency (student_id, task_id, competent, competent_date)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        competent = VALUES(competent),
        competent_date = VALUES(competent_date)
    `, [student_id, taskId, competent ? 1 : 0, date]);

    res.json({ message: 'Competency updated successfully', competent, competent_date: date });
  } catch (err) {
    console.error('Competency update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update competency' });
  }
});

// POST /api/batches/:id/checklists/:taskId/steps
router.post('/:taskId/steps', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { code, title, sort_order = 0 } = req.body;
    if (!code || !title) {
      return res.status(400).json({ error: 'Step code and title are required' });
    }

    const [result] = await db.query(
      'INSERT INTO steps (task_id, code, title, sort_order) VALUES (?, ?, ?, ?)',
      [taskId, code.trim(), title.trim(), Number(sort_order) || 0]
    );

    res.status(201).json({
      id: result.insertId,
      task_id: Number(taskId),
      code: code.trim(),
      title: title.trim(),
      sort_order: Number(sort_order) || 0
    });
  } catch (err) {
    console.error('Add step error:', err);
    res.status(500).json({ error: 'Failed to add step' });
  }
});

// PUT /api/batches/:id/checklists/:taskId/steps/:stepId
router.put('/:taskId/steps/:stepId', requireAuth, async (req, res) => {
  try {
    const { taskId, stepId } = req.params;
    const { code, title, sort_order = 0 } = req.body;
    if (!code || !title) {
      return res.status(400).json({ error: 'Step code and title are required' });
    }

    await db.query(
      'UPDATE steps SET code = ?, title = ?, sort_order = ? WHERE id = ? AND task_id = ?',
      [code.trim(), title.trim(), Number(sort_order) || 0, stepId, taskId]
    );

    res.json({ message: 'Step updated successfully' });
  } catch (err) {
    console.error('Update step error:', err);
    res.status(500).json({ error: 'Failed to update step' });
  }
});

// DELETE /api/batches/:id/checklists/:taskId/steps/:stepId
router.delete('/:taskId/steps/:stepId', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { taskId, stepId } = req.params;

    // Delete existing results for this step first
    await connection.query('DELETE FROM checklist_results WHERE step_id = ?', [stepId]);
    await connection.query('DELETE FROM steps WHERE id = ? AND task_id = ?', [stepId, taskId]);

    await connection.commit();
    res.json({ message: 'Step deleted successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Delete step error:', err);
    res.status(500).json({ error: 'Failed to delete step' });
  } finally {
    connection.release();
  }
});

// PUT /api/batches/:id/checklists/:taskId/info
router.put('/:taskId/info', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { code, title } = req.body;
    if (!code || !title) {
      return res.status(400).json({ error: 'Task code and title are required' });
    }

    await db.query('UPDATE tasks SET code = ?, title = ? WHERE id = ?', [code.trim(), title.trim(), taskId]);
    res.json({ message: 'Task details updated successfully' });
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task info' });
  }
});

// POST /api/batches/:id/checklists/:taskId/clear-student
router.post('/:taskId/clear-student', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { taskId } = req.params;
    const { student_id } = req.body;

    await connection.query(`
      DELETE cr FROM checklist_results cr
      JOIN steps s ON cr.step_id = s.id
      WHERE cr.student_id = ? AND s.task_id = ?
    `, [student_id, taskId]);

    await connection.query(
      'DELETE FROM task_competency WHERE student_id = ? AND task_id = ?',
      [student_id, taskId]
    );

    await connection.commit();
    res.json({ message: 'Student marks cleared successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Clear student checklist error:', err);
    res.status(500).json({ error: 'Failed to reset student checklist' });
  } finally {
    connection.release();
  }
});

module.exports = router;
