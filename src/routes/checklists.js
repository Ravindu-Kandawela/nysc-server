'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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
        steps,
        students,
        results: {},
        competencies: {}
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
    const assessmentDate = req.query.date || new Date().toISOString().slice(0, 10);
    const [attRows] = await db.query(
      'SELECT student_id, status FROM attendance WHERE batch_id = ? AND adate = ?',
      [batchId, assessmentDate]
    );
    const attendanceMap = {};
    attRows.forEach(a => { attendanceMap[a.student_id] = a.status; });

    res.json({
      task,
      steps,
      students,
      results,
      competencies,
      attendanceMap,
      assessmentDate
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

// GET /api/batches/:id/checklists/progress
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
      WHERE s.batch_id = ? AND tc.competent = 1
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

module.exports = router;
