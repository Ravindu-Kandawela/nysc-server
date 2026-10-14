'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const schedulerService = require('../services/schedulerService');
const lessonPlanService = require('../services/lessonPlanService');

// GET /api/batches/:id/plan/lessons?from=&to=
// Full lesson plan: modules + lesson sessions (with planned/delivered hours) + day-by-day schedule
router.get('/lessons', requireAuth, async (req, res) => {
  try {
    const data = await lessonPlanService.buildLessonPlan(req.params.id, { from: req.query.from, to: req.query.to });
    res.json(data);
  } catch (err) {
    console.error('Lesson plan build error:', err);
    res.status(500).json({ error: err.message || 'Failed to build lesson plan' });
  }
});

// PUT /api/batches/:id/plan/lessons/:moduleId — edit lesson content of a module
router.put('/lessons/:moduleId', requireAuth, async (req, res) => {
  try {
    await lessonPlanService.saveModuleContent(req.params.moduleId, req.body || {});
    res.json({ message: 'Lesson content saved' });
  } catch (err) {
    console.error('Lesson content save error:', err);
    res.status(500).json({ error: err.message || 'Failed to save lesson content' });
  }
});

// POST /api/batches/:id/plan/generate
router.post('/generate', requireAuth, async (req, res) => {
  const batchId = req.params.id;
  const { preview = false, reason = 'Initial plan' } = req.body;

  try {
    const inputs = await schedulerService.getSchedulerInputs(batchId);
    const weeklyHours = Object.values(inputs.weekPattern).reduce((a, h) => a + h, 0);
    if (weeklyHours <= 0) {
      return res.status(400).json({ error: 'Set your weekly teaching hours (Mon–Sun) before generating the lesson plan.' });
    }
    if (!inputs.modules.length) {
      return res.status(400).json({ error: 'This batch has no modules assigned.' });
    }
    const result = schedulerService.generatePlan(inputs);

    if (preview) {
      return res.json(result);
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Find next version_no
      const [verRows] = await connection.query(
        'SELECT COALESCE(MAX(version_no), 0) + 1 as next_ver FROM plan_versions WHERE batch_id = ?',
        [batchId]
      );
      const nextVer = verRows[0].next_ver;

      // Mark old current as 0
      await connection.query(
        'UPDATE plan_versions SET is_current = 0 WHERE batch_id = ?',
        [batchId]
      );

      // Create new plan version
      const [pvRes] = await connection.query(`
        INSERT INTO plan_versions (batch_id, version_no, reason, effective_from, is_current)
        VALUES (?, ?, ?, ?, 1)
      `, [batchId, nextVer, reason, inputs.startDate]);
      const planVersionId = pvRes.insertId;

      // Fetch task details map for topic text
      const [taskRows] = await connection.query('SELECT id, code, title FROM tasks');
      const taskMap = {};
      taskRows.forEach(t => { taskMap[t.id] = t; });

      const [modRows] = await connection.query('SELECT id, code, title FROM modules');
      const modMap = {};
      modRows.forEach(m => { modMap[m.id] = m; });

      // Insert plan_sessions
      for (const s of result.sessions) {
        const m = modMap[s.moduleId];
        const t = s.taskId ? taskMap[s.taskId] : null;
        const topic = t ? `${m ? m.code : ''} - ${t.code} ${t.title}` : (m ? `${m.code} ${m.title}` : '');

        await connection.query(`
          INSERT INTO plan_sessions (plan_version_id, batch_id, sdate, seq, module_id, task_id, hours, kind, topic_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'mixed', ?)
        `, [planVersionId, batchId, s.date, s.seq, s.moduleId, s.taskId || null, s.hours, topic]);
      }

      // Days already marked "taught" before a plan existed were saved with 0 hours —
      // fill them with the planned hours of that date so delivered hours are correct.
      await connection.query(`
        UPDATE day_log dl
        JOIN (SELECT sdate, SUM(hours) AS h FROM plan_sessions WHERE plan_version_id = ? GROUP BY sdate) p
          ON p.sdate = dl.ldate
        SET dl.hours_delivered = p.h
        WHERE dl.batch_id = ? AND dl.status = 'taught' AND dl.hours_delivered = 0
      `, [planVersionId, batchId]);

      await connection.commit();
      res.status(201).json({
        planVersionId,
        version_no: nextVer,
        summary: result.summary,
        sessionsCount: result.sessions.length,
        message: `Plan version ${nextVer} generated successfully`
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Plan generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate plan' });
  }
});

// GET /api/batches/:id/plan
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { version = 'current', from, to, moduleId } = req.query;

    let planVersionId;
    if (version === 'current') {
      const [verRows] = await db.query(
        'SELECT id, version_no FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1',
        [batchId]
      );
      if (verRows.length === 0) {
        return res.json({ sessions: [], version: null });
      }
      planVersionId = verRows[0].id;
    } else {
      const [verRows] = await db.query(
        'SELECT id, version_no FROM plan_versions WHERE batch_id = ? AND version_no = ? LIMIT 1',
        [batchId, version]
      );
      if (verRows.length === 0) {
        return res.status(404).json({ error: 'Plan version not found' });
      }
      planVersionId = verRows[0].id;
    }

    let query = `
      SELECT ps.*, 
             m.code as module_code, m.title as module_title, m.has_checklist,
             t.code as task_code, t.title as task_title,
             dl.status as day_status, dl.hours_delivered as actual_hours_delivered, dl.reason as day_reason
      FROM plan_sessions ps
      JOIN modules m ON ps.module_id = m.id
      LEFT JOIN tasks t ON ps.task_id = t.id
      LEFT JOIN day_log dl ON dl.batch_id = ps.batch_id AND dl.ldate = ps.sdate
      WHERE ps.plan_version_id = ?
    `;
    const params = [planVersionId];

    if (from) {
      query += ' AND ps.sdate >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND ps.sdate <= ?';
      params.push(to);
    }
    if (moduleId) {
      query += ' AND ps.module_id = ?';
      params.push(moduleId);
    }

    query += ' ORDER BY ps.sdate ASC, ps.seq ASC';

    const [sessions] = await db.query(query, params);
    res.json({ plan_version_id: planVersionId, sessions });
  } catch (err) {
    console.error('Plan get error:', err);
    res.status(500).json({ error: 'Failed to fetch plan sessions' });
  }
});

// GET /api/batches/:id/plan/summary
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const inputs = await schedulerService.getSchedulerInputs(batchId);

    // Fetch current plan sessions
    const [currentVersion] = await db.query(
      'SELECT id, version_no FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1',
      [batchId]
    );

    if (currentVersion.length === 0) {
      return res.json({ hasPlan: false });
    }

    const [sessions] = await db.query(
      'SELECT sdate as date, seq, module_id as moduleId, task_id as taskId, hours FROM plan_sessions WHERE plan_version_id = ? ORDER BY sdate ASC, seq ASC',
      [currentVersion[0].id]
    );

    // Run scheduler summarize on existing plan
    const { summarize } = require('../scheduler/scheduler');
    const summary = summarize(sessions, inputs);

    // Total delivered so far from day_log
    const [delivered] = await db.query(
      'SELECT COALESCE(SUM(hours_delivered), 0) as total FROM day_log WHERE batch_id = ?',
      [batchId]
    );

    res.json({
      hasPlan: true,
      version_no: currentVersion[0].version_no,
      plan_version_id: currentVersion[0].id,
      summary,
      total_delivered: Number(delivered[0].total)
    });
  } catch (err) {
    console.error('Plan summary error:', err);
    res.status(500).json({ error: 'Failed to fetch plan summary' });
  }
});

// POST /api/batches/:id/plan/replan/preview
router.post('/replan/preview', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { disruptedDate, hoursDelivered = 0, strategy = 'shift', extraHours, extraPerDay } = req.body;

    if (!disruptedDate) {
      return res.status(400).json({ error: 'disruptedDate is required' });
    }

    const inputs = await schedulerService.getSchedulerInputs(batchId);

    // Fetch current sessions
    const [currentVer] = await db.query(
      'SELECT id FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1',
      [batchId]
    );
    if (currentVer.length === 0) {
      return res.status(400).json({ error: 'No current plan found to replan' });
    }

    const [sessionRows] = await db.query(
      'SELECT sdate as date, seq, module_id as moduleId, task_id as taskId, hours FROM plan_sessions WHERE plan_version_id = ? ORDER BY sdate ASC, seq ASC',
      [currentVer[0].id]
    );

    const result = schedulerService.replan({
      ...inputs,
      sessions: sessionRows,
      disruptedDate,
      hoursDelivered: Number(hoursDelivered) || 0,
      strategy,
      extraHours,
      extraPerDay
    });

    res.json(result);
  } catch (err) {
    console.error('Replan preview error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate replan preview' });
  }
});

// POST /api/batches/:id/plan/replan/confirm
router.post('/replan/confirm', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const batchId = req.params.id;
    const {
      disruptedDate,
      hoursDelivered = 0,
      status = 'teacher_absent',
      reason = 'Disruption re-plan',
      strategy = 'shift',
      extraHours,
      extraPerDay
    } = req.body;

    const inputs = await schedulerService.getSchedulerInputs(batchId);

    // Get current version
    const [currentVerRows] = await connection.query(
      'SELECT id, version_no FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1',
      [batchId]
    );
    if (currentVerRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No active plan version found' });
    }
    const currentVer = currentVerRows[0];

    const [sessionRows] = await connection.query(
      'SELECT sdate as date, seq, module_id as moduleId, task_id as taskId, hours FROM plan_sessions WHERE plan_version_id = ? ORDER BY sdate ASC, seq ASC',
      [currentVer.id]
    );

    // Run pure replan
    const replanResult = schedulerService.replan({
      ...inputs,
      sessions: sessionRows,
      disruptedDate,
      hoursDelivered: Number(hoursDelivered) || 0,
      strategy,
      extraHours,
      extraPerDay
    });

    const nextVerNo = currentVer.version_no + 1;

    // Record day_log for disrupted day
    await connection.query(`
      INSERT INTO day_log (batch_id, ldate, status, reason, hours_delivered)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason), hours_delivered = VALUES(hours_delivered)
    `, [batchId, disruptedDate, status, reason, Number(hoursDelivered) || 0]);

    // Update current plan versions
    await connection.query('UPDATE plan_versions SET is_current = 0 WHERE batch_id = ?', [batchId]);

    const [pvRes] = await connection.query(`
      INSERT INTO plan_versions (batch_id, version_no, reason, effective_from, is_current)
      VALUES (?, ?, ?, ?, 1)
    `, [batchId, nextVerNo, reason, disruptedDate]);
    const newPlanVersionId = pvRes.insertId;

    // Log schedule change
    await connection.query(`
      INSERT INTO schedule_changes (batch_id, change_date, change_type, from_plan_version, to_plan_version, hours_lost, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      batchId,
      disruptedDate,
      strategy,
      currentVer.id,
      newPlanVersionId,
      replanResult.hoursLost,
      JSON.stringify({
        oldEndDate: replanResult.oldEndDate,
        newEndDate: replanResult.newEndDate,
        hoursDelivered,
        strategy
      })
    ]);

    // Save new sessions
    const [taskRows] = await connection.query('SELECT id, code, title FROM tasks');
    const taskMap = {};
    taskRows.forEach(t => { taskMap[t.id] = t; });

    const [modRows] = await connection.query('SELECT id, code, title FROM modules');
    const modMap = {};
    modRows.forEach(m => { modMap[m.id] = m; });

    for (const s of replanResult.sessions) {
      const m = modMap[s.moduleId];
      const t = s.taskId ? taskMap[s.taskId] : null;
      const topic = t ? `${m ? m.code : ''} - ${t.code} ${t.title}` : (m ? `${m.code} ${m.title}` : '');

      await connection.query(`
        INSERT INTO plan_sessions (plan_version_id, batch_id, sdate, seq, module_id, task_id, hours, kind, topic_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'mixed', ?)
      `, [newPlanVersionId, batchId, s.date, s.seq, s.moduleId, s.taskId || null, s.hours, topic]);
    }

    await connection.commit();
    res.json({
      message: `Re-planned to version ${nextVerNo}`,
      newVersionNo: nextVerNo,
      hoursLost: replanResult.hoursLost,
      oldEndDate: replanResult.oldEndDate,
      newEndDate: replanResult.newEndDate,
      summary: replanResult.summary
    });
  } catch (err) {
    await connection.rollback();
    console.error('Replan confirm error:', err);
    res.status(500).json({ error: err.message || 'Failed to confirm replan' });
  } finally {
    connection.release();
  }
});

// GET /api/batches/:id/plan/versions
router.get('/versions', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const [rows] = await db.query(
      'SELECT * FROM plan_versions WHERE batch_id = ? ORDER BY version_no DESC',
      [batchId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Plan versions error:', err);
    res.status(500).json({ error: 'Failed to fetch plan versions' });
  }
});

module.exports = router;
