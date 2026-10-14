'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/batches
router.get('/', requireAuth, async (req, res) => {
  try {
    const [batches] = await db.query(`
      SELECT b.*, 
        nv.code as ncs_code, nv.title as ncs_title,
        (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.status = 'active') as active_students,
        (SELECT version_no FROM plan_versions pv WHERE pv.batch_id = b.id AND pv.is_current = 1 LIMIT 1) as current_plan_version,
        (SELECT COALESCE(SUM(hours_delivered), 0) FROM day_log dl WHERE dl.batch_id = b.id) as total_delivered_hours
      FROM batches b
      JOIN ncs_versions nv ON b.ncs_version_id = nv.id
      ORDER BY b.start_date DESC
    `);
    res.json(batches);
  } catch (err) {
    console.error('Batches get error:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// POST /api/batches
router.post('/', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      name,
      ncs_version_id = 1,
      start_date,
      planned_months = 6,
      month_mode = 'batch',
      target_hours_per_month = 120,
      hours_per_day = 6.5,
      start_time = '09:00:00',
      end_time = '16:00:00',
      already_done = {}
    } = req.body;

    if (!name || !start_date) {
      await connection.rollback();
      return res.status(400).json({ error: 'Name and start date are required' });
    }

    // 1. Insert batch
    const [result] = await connection.query(
      `INSERT INTO batches (name, ncs_version_id, start_date, planned_months, month_mode, target_hours_per_month, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [name, ncs_version_id, start_date, planned_months, month_mode, target_hours_per_month]
    );
    const batchId = result.insertId;

    // 2. Insert week pattern: Mon(1)-Fri(5) = hours_per_day (default 6.5h), Sat(6)-Sun(7) = 0h
    for (let d = 1; d <= 7; d++) {
      const h = (d >= 1 && d <= 5) ? hours_per_day : 0;
      await connection.query(
        `INSERT INTO batch_week_pattern (batch_id, weekday, hours, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)`,
        [batchId, d, h, h > 0 ? start_time : null, h > 0 ? end_time : null]
      );
    }

    // 3. Copy modules from NCS version
    const [modules] = await connection.query(
      'SELECT id, theory_hours, practical_hours, teach_order FROM modules WHERE ncs_version_id = ? ORDER BY teach_order ASC',
      [ncs_version_id]
    );

    for (const m of modules) {
      const done = already_done[m.id] || 0;
      await connection.query(
        `INSERT INTO batch_modules (batch_id, module_id, teach_order, theory_hours, practical_hours, hours_already_done)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, m.id, m.teach_order, m.theory_hours, m.practical_hours, done]
      );
    }

    // 4. Initialize task weights (default = count of steps per task)
    const [tasks] = await connection.query(`
      SELECT t.id, t.module_id, COUNT(s.id) as step_count
      FROM tasks t
      JOIN modules m ON t.module_id = m.id
      LEFT JOIN steps s ON s.task_id = t.id
      WHERE m.ncs_version_id = ?
      GROUP BY t.id, t.module_id
    `, [ncs_version_id]);

    for (const t of tasks) {
      const weight = t.step_count > 0 ? t.step_count : 1;
      await connection.query(
        `INSERT INTO batch_task_weights (batch_id, task_id, weight)
         VALUES (?, ?, ?)`,
        [batchId, t.id, weight]
      );
    }

    await connection.commit();
    res.status(201).json({ id: batchId, message: 'Batch created successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Batch create error:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  } finally {
    connection.release();
  }
});

// GET /api/batches/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const [batches] = await db.query(`
      SELECT b.*, nv.code as ncs_code, nv.title as ncs_title
      FROM batches b
      JOIN ncs_versions nv ON b.ncs_version_id = nv.id
      WHERE b.id = ?
    `, [batchId]);

    if (batches.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batch = batches[0];

    // Week pattern
    const [pattern] = await db.query(
      'SELECT weekday, hours, start_time, end_time FROM batch_week_pattern WHERE batch_id = ? ORDER BY weekday ASC',
      [batchId]
    );

    // Modules
    const [modules] = await db.query(`
      SELECT bm.*, m.code, m.title, m.has_checklist
      FROM batch_modules bm
      JOIN modules m ON bm.module_id = m.id
      WHERE bm.batch_id = ?
      ORDER BY bm.teach_order ASC
    `, [batchId]);

    // Task weights
    const [weights] = await db.query(`
      SELECT btw.*, t.code as task_code, t.title as task_title, t.module_id
      FROM batch_task_weights btw
      JOIN tasks t ON btw.task_id = t.id
      WHERE btw.batch_id = ?
    `, [batchId]);

    // Current plan version
    const [planVersions] = await db.query(
      'SELECT * FROM plan_versions WHERE batch_id = ? ORDER BY version_no DESC',
      [batchId]
    );

    // Active students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, email, sort_order, status FROM students WHERE batch_id = ? ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    res.json({
      ...batch,
      week_pattern: pattern,
      modules,
      task_weights: weights,
      plan_versions: planVersions,
      students
    });
  } catch (err) {
    console.error('Batch detail error:', err);
    res.status(500).json({ error: 'Failed to fetch batch details' });
  }
});

// PUT /api/batches/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { name, start_date, planned_months, month_mode, target_hours_per_month, status } = req.body;

    await db.query(`
      UPDATE batches 
      SET name = COALESCE(?, name),
          start_date = COALESCE(?, start_date),
          planned_months = COALESCE(?, planned_months),
          month_mode = COALESCE(?, month_mode),
          target_hours_per_month = COALESCE(?, target_hours_per_month),
          status = COALESCE(?, status)
      WHERE id = ?
    `, [name, start_date, planned_months, month_mode, target_hours_per_month, status, batchId]);

    res.json({ message: 'Batch updated successfully' });
  } catch (err) {
    console.error('Batch update error:', err);
    res.status(500).json({ error: 'Failed to update batch' });
  }
});

// PUT /api/batches/:id/pattern
router.put('/:id/pattern', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { pattern } = req.body; // array of { weekday, hours, start_time, end_time }

    if (!Array.isArray(pattern)) {
      return res.status(400).json({ error: 'Pattern array required' });
    }

    for (const p of pattern) {
      await db.query(`
        INSERT INTO batch_week_pattern (batch_id, weekday, hours, start_time, end_time)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE hours = VALUES(hours), start_time = VALUES(start_time), end_time = VALUES(end_time)
      `, [batchId, p.weekday, p.hours, p.start_time || null, p.end_time || null]);
    }

    res.json({ message: 'Week pattern updated successfully' });
  } catch (err) {
    console.error('Week pattern update error:', err);
    res.status(500).json({ error: 'Failed to update week pattern' });
  }
});

// PUT /api/batches/:id/modules
router.put('/:id/modules', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { modules } = req.body; // array of { module_id, teach_order, theory_hours, practical_hours, hours_already_done }

    if (!Array.isArray(modules)) {
      return res.status(400).json({ error: 'Modules array required' });
    }

    for (const m of modules) {
      await db.query(`
        UPDATE batch_modules
        SET teach_order = COALESCE(?, teach_order),
            theory_hours = COALESCE(?, theory_hours),
            practical_hours = COALESCE(?, practical_hours),
            hours_already_done = COALESCE(?, hours_already_done)
        WHERE batch_id = ? AND module_id = ?
      `, [m.teach_order, m.theory_hours, m.practical_hours, m.hours_already_done, batchId, m.module_id]);
    }

    res.json({ message: 'Batch modules updated successfully' });
  } catch (err) {
    console.error('Batch modules update error:', err);
    res.status(500).json({ error: 'Failed to update batch modules' });
  }
});

// PUT /api/batches/:id/task-weights
router.put('/:id/task-weights', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { weights } = req.body; // array of { task_id, weight }

    if (!Array.isArray(weights)) {
      return res.status(400).json({ error: 'Weights array required' });
    }

    for (const w of weights) {
      await db.query(`
        INSERT INTO batch_task_weights (batch_id, task_id, weight)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE weight = VALUES(weight)
      `, [batchId, w.task_id, w.weight]);
    }

    res.json({ message: 'Task weights updated successfully' });
  } catch (err) {
    console.error('Task weights update error:', err);
    res.status(500).json({ error: 'Failed to update task weights' });
  }
});

// DELETE /api/batches/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const batchId = req.params.id;

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DELETE FROM attendance WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM day_log WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM diary_lines WHERE diary_entry_id IN (SELECT id FROM diary_entries WHERE batch_id = ?)', [batchId]);
    await connection.query('DELETE FROM diary_entries WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM checklist_results WHERE student_id IN (SELECT id FROM students WHERE batch_id = ?)', [batchId]);
    await connection.query('DELETE FROM task_competency WHERE student_id IN (SELECT id FROM students WHERE batch_id = ?)', [batchId]);
    await connection.query('DELETE FROM submissions WHERE recipient_id IN (SELECT id FROM assignment_recipients WHERE assignment_id IN (SELECT id FROM assignments WHERE batch_id = ?))', [batchId]);
    await connection.query('DELETE FROM assignment_recipients WHERE assignment_id IN (SELECT id FROM assignments WHERE batch_id = ?)', [batchId]);
    await connection.query('DELETE FROM assignments WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM monthly_reports WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM students WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM plan_sessions WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM plan_versions WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM batch_modules WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM batch_task_weights WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM batch_week_pattern WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM schedule_changes WHERE batch_id = ?', [batchId]);
    await connection.query('DELETE FROM batches WHERE id = ?', [batchId]);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    await connection.commit();
    res.json({ message: 'Batch deleted successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Batch delete error:', err);
    res.status(500).json({ error: 'Failed to delete batch' });
  } finally {
    connection.release();
  }
});

module.exports = router;

