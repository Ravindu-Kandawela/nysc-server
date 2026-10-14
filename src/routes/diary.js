'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/batches/:id/diary
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { from, to, status } = req.query;

    let query = 'SELECT * FROM diary_entries WHERE batch_id = ?';
    const params = [batchId];

    if (from) {
      query += ' AND ddate >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND ddate <= ?';
      params.push(to);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY ddate DESC';
    const [entries] = await db.query(query, params);

    if (entries.length === 0) {
      return res.json([]);
    }

    const entryIds = entries.map(e => e.id);
    const [lines] = await db.query(
      `SELECT dl.*, m.code as module_code, t.code as task_code 
       FROM diary_lines dl
       LEFT JOIN modules m ON dl.module_id = m.id
       LEFT JOIN tasks t ON dl.task_id = t.id
       WHERE dl.diary_id IN (${entryIds.map(() => '?').join(',')})`,
      entryIds
    );

    const linesByEntry = {};
    lines.forEach(l => {
      if (!linesByEntry[l.diary_id]) linesByEntry[l.diary_id] = [];
      linesByEntry[l.diary_id].push(l);
    });

    const result = entries.map(e => ({
      ...e,
      lines: linesByEntry[e.id] || []
    }));

    res.json(result);
  } catch (err) {
    console.error('Diary list error:', err);
    res.status(500).json({ error: 'Failed to fetch diary entries' });
  }
});

// GET /api/batches/:id/diary/:date
router.get('/:date', requireAuth, async (req, res) => {
  try {
    const { id: batchId, date } = req.params;

    const [entries] = await db.query(
      'SELECT * FROM diary_entries WHERE batch_id = ? AND ddate = ?',
      [batchId, date]
    );

    if (entries.length === 0) {
      return res.json({ entry: null, exists: false });
    }

    const entry = entries[0];
    const [lines] = await db.query(
      `SELECT dl.*, m.code as module_code, m.title as module_title, t.code as task_code, t.title as task_title
       FROM diary_lines dl
       LEFT JOIN modules m ON dl.module_id = m.id
       LEFT JOIN tasks t ON dl.task_id = t.id
       WHERE dl.diary_id = ?`,
      [entry.id]
    );

    res.json({ entry: { ...entry, lines }, exists: true });
  } catch (err) {
    console.error('Diary single error:', err);
    res.status(500).json({ error: 'Failed to fetch diary entry' });
  }
});

// POST /api/batches/:id/diary/generate (generate or refresh draft for a date)
router.post('/generate', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const batchId = req.params.id;
    const { date } = req.body;

    if (!date) {
      await connection.rollback();
      return res.status(400).json({ error: 'Date is required' });
    }

    // Check if day_log exists
    const [dayLogRows] = await connection.query(
      'SELECT * FROM day_log WHERE batch_id = ? AND ldate = ?',
      [batchId, date]
    );
    const dayLog = dayLogRows[0] || null;

    // Check plan sessions for current plan version
    const [sessions] = await connection.query(`
      SELECT ps.*, m.code as module_code, m.title as module_title,
             t.code as task_code, t.title as task_title, pv.version_no
      FROM plan_sessions ps
      JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1
      JOIN modules m ON ps.module_id = m.id
      LEFT JOIN tasks t ON ps.task_id = t.id
      WHERE ps.batch_id = ? AND ps.sdate = ?
      ORDER BY ps.seq ASC
    `, [batchId, date]);

    // Check default week pattern timing
    const weekday = new Date(date).getDay() || 7;
    const [patternRows] = await connection.query(
      'SELECT start_time, end_time FROM batch_week_pattern WHERE batch_id = ? AND weekday = ?',
      [batchId, weekday]
    );
    const timeText = patternRows[0] && patternRows[0].start_time && patternRows[0].end_time
      ? `${patternRows[0].start_time.slice(0, 5)} - ${patternRows[0].end_time.slice(0, 5)}`
      : '09:00 - 16:00';

    // Count attendance
    const [attStats] = await connection.query(`
      SELECT 
        COUNT(CASE WHEN status IN ('P', 'L') THEN 1 END) as present_count,
        COUNT(*) as total_count
      FROM attendance
      WHERE batch_id = ? AND adate = ?
    `, [batchId, date]);

    const studentsPresent = attStats[0] ? Number(attStats[0].present_count) : null;
    const studentsTotal = attStats[0] ? Number(attStats[0].total_count) : null;

    let summaryText = '';
    let activitiesText = 'න්‍යායාත්මක හා ප්‍රායෝගික ක්‍රියාකාරකම්';
    let remarks = '';
    let hoursDelivered = 0;
    const versionNo = sessions[0] ? sessions[0].version_no : 1;

    if (dayLog && (dayLog.status === 'teacher_absent' || dayLog.status === 'institute_closed')) {
      const reasonPart = dayLog.reason ? ` (${dayLog.reason})` : '';
      summaryText = dayLog.status === 'teacher_absent' 
        ? `No lesson conducted – teacher on leave${reasonPart}`
        : `Institute closed${reasonPart}`;
      activitiesText = 'නැත';
      hoursDelivered = 0;
    } else if (sessions.length > 0) {
      summaryText = sessions.map(s => {
        if (s.task_code) return `${s.module_code} - ${s.task_code}: ${s.task_title || ''}`;
        return `${s.module_code}: ${s.module_title}`;
      }).join('; ');

      hoursDelivered = dayLog && dayLog.hours_delivered !== undefined 
        ? Number(dayLog.hours_delivered) 
        : sessions.reduce((acc, s) => acc + Number(s.hours), 0);
    } else {
      summaryText = dayLog && dayLog.reason ? dayLog.reason : 'Special training session';
      hoursDelivered = dayLog ? Number(dayLog.hours_delivered) : 0;
    }

    // Insert or update diary_entries
    const [diaryRes] = await connection.query(`
      INSERT INTO diary_entries (batch_id, ddate, summary_text, activities_text, remarks, hours_delivered, time_text, students_present, students_total, status, generated_from_plan_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
      ON DUPLICATE KEY UPDATE
        summary_text = VALUES(summary_text),
        activities_text = VALUES(activities_text),
        hours_delivered = VALUES(hours_delivered),
        time_text = VALUES(time_text),
        students_present = VALUES(students_present),
        students_total = VALUES(students_total),
        generated_from_plan_version = VALUES(generated_from_plan_version)
    `, [batchId, date, summaryText, activitiesText, remarks, hoursDelivered, timeText, studentsPresent, studentsTotal, versionNo]);

    // Get the diary ID
    const [curEntry] = await connection.query('SELECT id FROM diary_entries WHERE batch_id = ? AND ddate = ?', [batchId, date]);
    const diaryId = curEntry[0].id;

    // Delete existing lines and re-create from sessions
    await connection.query('DELETE FROM diary_lines WHERE diary_id = ?', [diaryId]);
    for (const s of sessions) {
      const lineText = s.task_code ? `${s.module_code} - ${s.task_code} ${s.task_title || ''}` : `${s.module_code} ${s.module_title}`;
      await connection.query(`
        INSERT INTO diary_lines (diary_id, module_id, task_id, hours, line_text)
        VALUES (?, ?, ?, ?, ?)
      `, [diaryId, s.module_id, s.task_id || null, s.hours, lineText]);
    }

    await connection.commit();
    res.json({ message: 'Diary draft generated successfully', diaryId });
  } catch (err) {
    await connection.rollback();
    console.error('Diary generate error:', err);
    res.status(500).json({ error: 'Failed to generate diary draft' });
  } finally {
    connection.release();
  }
});

// PUT /api/batches/:id/diary/:date (edit)
router.put('/:date', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id: batchId, date } = req.params;
    const {
      summary_text,
      activities_text,
      remarks,
      hours_delivered,
      time_text,
      students_present,
      students_total,
      status = 'draft',
      lines = []
    } = req.body;

    await connection.query(`
      INSERT INTO diary_entries (batch_id, ddate, summary_text, activities_text, remarks, hours_delivered, time_text, students_present, students_total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        summary_text = VALUES(summary_text),
        activities_text = VALUES(activities_text),
        remarks = VALUES(remarks),
        hours_delivered = VALUES(hours_delivered),
        time_text = VALUES(time_text),
        students_present = VALUES(students_present),
        students_total = VALUES(students_total),
        status = VALUES(status)
    `, [batchId, date, summary_text, activities_text, remarks, hours_delivered, time_text, students_present, students_total, status]);

    const [curEntry] = await connection.query('SELECT id FROM diary_entries WHERE batch_id = ? AND ddate = ?', [batchId, date]);
    const diaryId = curEntry[0].id;

    if (Array.isArray(lines) && lines.length > 0) {
      await connection.query('DELETE FROM diary_lines WHERE diary_id = ?', [diaryId]);
      for (const l of lines) {
        await connection.query(`
          INSERT INTO diary_lines (diary_id, module_id, task_id, hours, line_text)
          VALUES (?, ?, ?, ?, ?)
        `, [diaryId, l.module_id || null, l.task_id || null, l.hours || 0, l.line_text || '']);
      }
    }

    await connection.commit();
    res.json({ message: 'Diary entry saved successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Diary update error:', err);
    res.status(500).json({ error: 'Failed to update diary entry' });
  } finally {
    connection.release();
  }
});

// POST /api/batches/:id/diary/:date/confirm
router.post('/:date/confirm', requireAuth, async (req, res) => {
  try {
    const { id: batchId, date } = req.params;
    await db.query(
      'UPDATE diary_entries SET status = "confirmed" WHERE batch_id = ? AND ddate = ?',
      [batchId, date]
    );
    res.json({ message: 'Diary entry confirmed successfully' });
  } catch (err) {
    console.error('Diary confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm diary entry' });
  }
});

module.exports = router;
