'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const svc = require('../services/teacherAttendanceService');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

const normTime = (t) => {
  if (t === undefined) return undefined;
  if (t === null || t === '') return null;
  if (!TIME_RE.test(String(t)) || svc.toMinutes(t) === null) throw new Error(`Invalid time: ${t}`);
  return svc.hhmm(t) + ':00';
};

// GET /api/teacher-attendance?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });
    }
    const offDays = await svc.getOffDaysMap(from, to);
    const offDates = Object.keys(offDays);
    if (offDates.length > 0) {
      await svc.ensureTeacherAttendanceTable();
      const ph = offDates.map(() => '?').join(',');
      await db.query(`DELETE FROM teacher_attendance WHERE adate IN (${ph})`, offDates);
    }
    const rows = await svc.getRange(from, to);
    const totalCounted = Math.round(rows.reduce((a, r) => a + (r.counted_hours || 0), 0) * 10) / 10;
    res.json({ rows, offDays, totalCounted, cap: svc.DAILY_HOURS_CAP, today: svc.nowLocal() });
  } catch (err) {
    console.error('Teacher attendance list error:', err);
    res.status(500).json({ error: 'Failed to load teacher attendance' });
  }
});

// GET /api/teacher-attendance/today
router.get('/today', requireAuth, async (req, res) => {
  try {
    const now = svc.nowLocal();
    const map = await svc.getRangeMap(now.date, now.date);
    res.json({ today: now, record: map[now.date] || null, cap: svc.DAILY_HOURS_CAP });
  } catch (err) {
    console.error('Teacher attendance today error:', err);
    res.status(500).json({ error: 'Failed to load today attendance' });
  }
});

// POST /api/teacher-attendance/clock  { action: 'in' | 'out' }
// Marks the current Sri Lanka time for today.
router.post('/clock', requireAuth, async (req, res) => {
  try {
    await svc.ensureTeacherAttendanceTable();
    const { action } = req.body || {};
    if (!['in', 'out'].includes(action)) return res.status(400).json({ error: "action must be 'in' or 'out'" });
    const now = svc.nowLocal();
    const col = action === 'in' ? 'time_in' : 'time_out';
    await db.query(
      `INSERT INTO teacher_attendance (adate, ${col}, source) VALUES (?, ?, 'clock')
       ON DUPLICATE KEY UPDATE ${col} = VALUES(${col})`,
      [now.date, now.time + ':00']
    );
    const map = await svc.getRangeMap(now.date, now.date);
    res.json({ today: now, record: map[now.date] });
  } catch (err) {
    console.error('Teacher attendance clock error:', err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// PUT /api/teacher-attendance/:date  { time_in, time_out, note }
// Manual add / edit for any date (e.g. filling in last month).
router.put('/:date', requireAuth, async (req, res) => {
  try {
    await svc.ensureTeacherAttendanceTable();
    const { date } = req.params;
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });
    let timeIn, timeOut;
    try {
      timeIn = normTime(req.body.time_in) ?? null;
      timeOut = normTime(req.body.time_out) ?? null;
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (timeIn && timeOut && svc.toMinutes(timeOut) <= svc.toMinutes(timeIn)) {
      return res.status(400).json({ error: 'Out time must be after In time' });
    }
    if (!timeIn && !timeOut) {
      await db.query('DELETE FROM teacher_attendance WHERE adate = ?', [date]);
      return res.json({ record: null });
    }
    const note = (req.body.note || '').toString().slice(0, 255) || null;
    await db.query(
      `INSERT INTO teacher_attendance (adate, time_in, time_out, note, source) VALUES (?, ?, ?, ?, 'manual')
       ON DUPLICATE KEY UPDATE time_in = VALUES(time_in), time_out = VALUES(time_out),
         note = VALUES(note), source = 'manual'`,
      [date, timeIn, timeOut, note]
    );
    const map = await svc.getRangeMap(date, date);
    res.json({ record: map[date] });
  } catch (err) {
    console.error('Teacher attendance save error:', err);
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

// DELETE /api/teacher-attendance/:date
router.delete('/:date', requireAuth, async (req, res) => {
  try {
    await svc.ensureTeacherAttendanceTable();
    if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: 'Invalid date' });
    await db.query('DELETE FROM teacher_attendance WHERE adate = ?', [req.params.date]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Teacher attendance delete error:', err);
    res.status(500).json({ error: 'Failed to delete attendance' });
  }
});

module.exports = router;

