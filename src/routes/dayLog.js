'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const schedulerService = require('../services/schedulerService');

// GET /api/batches/:id/day-log
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { from, to } = req.query;

    let query = 'SELECT * FROM day_log WHERE batch_id = ?';
    const params = [batchId];

    if (from) {
      query += ' AND ldate >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND ldate <= ?';
      params.push(to);
    }

    query += ' ORDER BY ldate DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Day log error:', err);
    res.status(500).json({ error: 'Failed to fetch day logs' });
  }
});

// PUT /api/batches/:id/day-log/:date
router.put('/:date', requireAuth, async (req, res) => {
  try {
    const { id: batchId, date } = req.params;
    const { status, reason, hours_delivered, substitute_name, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    await db.query(`
      INSERT INTO day_log (batch_id, ldate, status, reason, hours_delivered, substitute_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        reason = VALUES(reason),
        hours_delivered = VALUES(hours_delivered),
        substitute_name = VALUES(substitute_name),
        notes = VALUES(notes)
    `, [batchId, date, status, reason || null, hours_delivered !== undefined ? hours_delivered : 0, substitute_name || null, notes || null]);

    res.json({ message: 'Day log updated successfully' });
  } catch (err) {
    console.error('Day log update error:', err);
    res.status(500).json({ error: 'Failed to update day log' });
  }
});

// GET /api/batches/:id/unresolved-days
router.get('/unresolved-days', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const today = new Date().toISOString().slice(0, 10);

    // Get current plan sessions up to today
    const [sessions] = await db.query(`
      SELECT ps.sdate, SUM(ps.hours) as planned_hours,
             GROUP_CONCAT(DISTINCT m.code SEPARATOR ', ') as module_codes
      FROM plan_sessions ps
      JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1
      JOIN modules m ON ps.module_id = m.id
      WHERE ps.batch_id = ? AND ps.sdate <= ?
      GROUP BY ps.sdate
      ORDER BY ps.sdate ASC
    `, [batchId, today]);

    if (sessions.length === 0) {
      return res.json([]);
    }

    // Get dates with day_log
    const [dayLogs] = await db.query(
      'SELECT ldate FROM day_log WHERE batch_id = ? AND ldate <= ?',
      [batchId, today]
    );
    const loggedDates = new Set(dayLogs.map(d => d.ldate));

    // Get dates with attendance
    const [attDates] = await db.query(
      'SELECT DISTINCT adate FROM attendance WHERE batch_id = ? AND adate <= ?',
      [batchId, today]
    );
    const attendedDates = new Set(attDates.map(d => d.adate));

    // Unresolved = past planned date with NO day_log AND NO attendance
    const unresolved = sessions.filter(s => !loggedDates.has(s.sdate) && !attendedDates.has(s.sdate));

    res.json(unresolved);
  } catch (err) {
    console.error('Unresolved days error:', err);
    res.status(500).json({ error: 'Failed to fetch unresolved days' });
  }
});

// POST /api/batches/:id/unresolved-days/resolve-bulk
router.post('/unresolved-days/resolve-bulk', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const batchId = req.params.id;
    const { dates, status = 'taught' } = req.body;

    if (!Array.isArray(dates) || dates.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Dates array is required' });
    }

    for (const date of dates) {
      // Find planned hours from current plan
      const [pRows] = await connection.query(`
        SELECT COALESCE(SUM(hours), 0) as planned_hours
        FROM plan_sessions ps
        JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1
        WHERE ps.batch_id = ? AND ps.sdate = ?
      `, [batchId, date]);

      const plannedHours = Number(pRows[0] ? pRows[0].planned_hours : 0);
      const hoursDelivered = status === 'taught' ? plannedHours : 0;

      await connection.query(`
        INSERT INTO day_log (batch_id, ldate, status, reason, hours_delivered)
        VALUES (?, ?, ?, 'Bulk resolved', ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status), hours_delivered = VALUES(hours_delivered)
      `, [batchId, date, status, hoursDelivered]);

      // If status is 'taught', also auto-mark attendance for active students as 'P'
      if (status === 'taught') {
        const [students] = await connection.query(
          'SELECT id FROM students WHERE batch_id = ? AND status = "active"',
          [batchId]
        );
        for (const st of students) {
          await connection.query(`
            INSERT INTO attendance (batch_id, student_id, adate, status)
            VALUES (?, ?, ?, 'P')
            ON DUPLICATE KEY UPDATE status = VALUES(status)
          `, [batchId, st.id, date]);
        }
      }
    }

    await connection.commit();
    res.json({ message: `Resolved ${dates.length} days successfully` });
  } catch (err) {
    await connection.rollback();
    console.error('Resolve bulk error:', err);
    res.status(500).json({ error: 'Failed to bulk resolve days' });
  } finally {
    connection.release();
  }
});

module.exports = router;
