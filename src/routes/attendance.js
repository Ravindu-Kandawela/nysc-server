'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/batches/:id/attendance?date=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // Fetch active students in sort_order
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, phone, parent_name, parent_phone, parent_email, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    // Fetch attendance for this date
    const [attRows] = await db.query(
      'SELECT student_id, status, note FROM attendance WHERE batch_id = ? AND adate = ?',
      [batchId, date]
    );
    const attMap = {};
    attRows.forEach(a => { attMap[a.student_id] = a; });

    const result = students.map(s => {
      const recorded = attMap[s.id];
      return {
        student_id: s.id,
        reg_no: s.reg_no,
        full_name: s.full_name,
        phone: s.phone || '',
        parent_name: s.parent_name || '',
        parent_phone: s.parent_phone || '',
        parent_email: s.parent_email || '',
        sort_order: s.sort_order,
        status: recorded ? recorded.status : 'P', // default Present for quick marking
        note: recorded ? recorded.note : '',
        is_recorded: !!recorded
      };
    });

    // Check day_log for context
    const [dayLog] = await db.query(
      'SELECT * FROM day_log WHERE batch_id = ? AND ldate = ?',
      [batchId, date]
    );

    res.json({
      date,
      day_log: dayLog[0] || null,
      attendance: result
    });
  } catch (err) {
    console.error('Attendance get error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// PUT /api/batches/:id/attendance/:date
router.put('/:date', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id: batchId, date } = req.params;
    const { records = [], day_status = 'taught', hours_delivered } = req.body;

    let presentCount = 0;
    for (const r of records) {
      if (r.status === 'P' || r.status === 'L') presentCount++;
      await connection.query(`
        INSERT INTO attendance (batch_id, student_id, adate, status, note)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note)
      `, [batchId, r.student_id, date, r.status, r.note || null]);
    }

    // Determine hours delivered
    let hours = hours_delivered;
    if (hours === undefined) {
      const [pRows] = await connection.query(`
        SELECT COALESCE(SUM(hours), 0) as planned_hours
        FROM plan_sessions ps
        JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1
        WHERE ps.batch_id = ? AND ps.sdate = ?
      `, [batchId, date]);
      hours = Number(pRows[0] ? pRows[0].planned_hours : 0);
    }

    // Update day_log
    await connection.query(`
      INSERT INTO day_log (batch_id, ldate, status, hours_delivered)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), hours_delivered = VALUES(hours_delivered)
    `, [batchId, date, day_status, hours]);

    // Update students count in diary if entry exists
    await connection.query(`
      UPDATE diary_entries
      SET students_present = ?, students_total = ?
      WHERE batch_id = ? AND ddate = ?
    `, [presentCount, records.length, batchId, date]);

    await connection.commit();
    res.json({ message: 'Attendance saved successfully', presentCount, total: records.length });
  } catch (err) {
    await connection.rollback();
    console.error('Attendance save error:', err);
    res.status(500).json({ error: 'Failed to save attendance' });
  } finally {
    connection.release();
  }
});

// GET /api/batches/:id/attendance/summary?month=YYYY-MM or batch month key
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { from, to, month } = req.query;

    let dateFilter = '';
    const params = [batchId];

    if (from && to) {
      dateFilter = 'AND a.adate >= ? AND a.adate <= ?';
      params.push(from, to);
    } else if (month) {
      dateFilter = 'AND a.adate LIKE ?';
      params.push(`${month}%`);
    }

    // Active students
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    // Aggregate attendance
    const [stats] = await db.query(`
      SELECT a.student_id,
        COUNT(CASE WHEN a.status = 'P' THEN 1 END) as present_days,
        COUNT(CASE WHEN a.status = 'A' THEN 1 END) as absent_days,
        COUNT(CASE WHEN a.status = 'L' THEN 1 END) as late_days,
        COUNT(CASE WHEN a.status = 'E' THEN 1 END) as excused_days,
        COUNT(*) as total_days
      FROM attendance a
      WHERE a.batch_id = ? ${dateFilter}
      GROUP BY a.student_id
    `, params);

    const statMap = {};
    stats.forEach(s => { statMap[s.student_id] = s; });

    const summary = students.map(st => {
      const s = statMap[st.id] || { present_days: 0, absent_days: 0, late_days: 0, excused_days: 0, total_days: 0 };
      const attended = Number(s.present_days) + Number(s.late_days);
      const total = Number(s.total_days);
      const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
      return {
        student_id: st.id,
        reg_no: st.reg_no,
        full_name: st.full_name,
        sort_order: st.sort_order,
        present_days: Number(s.present_days),
        absent_days: Number(s.absent_days),
        late_days: Number(s.late_days),
        excused_days: Number(s.excused_days),
        total_days: total,
        attendance_percentage: pct
      };
    });

    res.json(summary);
  } catch (err) {
    console.error('Attendance summary error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
});

// GET /api/batches/:id/attendance/monthly-grid?month=YYYY-MM
router.get('/monthly-grid', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const month = req.query.month; // e.g. '2026-09'
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month parameter required (YYYY-MM)' });
    }

    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();

    // Students sorted
    const [students] = await db.query(
      'SELECT id, reg_no, full_name, sort_order FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [batchId]
    );

    // All attendance records for this month
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    const [attRows] = await db.query(
      'SELECT student_id, adate, status FROM attendance WHERE batch_id = ? AND adate >= ? AND adate <= ?',
      [batchId, startDate, endDate]
    );

    // Build lookup: { student_id: { day_number: status } }
    const attMap = {};
    attRows.forEach(r => {
      const day = new Date(r.adate).getDate();
      if (!attMap[r.student_id]) attMap[r.student_id] = {};
      attMap[r.student_id][day] = r.status;
    });

    // Holidays for this month (where is_off = 1)
    const [holidays] = await db.query(
      'SELECT hdate, name, type, is_off FROM holidays WHERE hdate >= ? AND hdate <= ?',
      [startDate, endDate]
    );

    const holidayMap = {};
    holidays.forEach(h => {
      const day = new Date(h.hdate).getDate();
      holidayMap[day] = { name: h.name, type: h.type, is_off: h.is_off };
    });

    // Build grid
    const grid = students.map(st => {
      const days = {};
      for (let d = 1; d <= daysInMonth; d++) {
        days[d] = attMap[st.id] ? (attMap[st.id][d] || null) : null;
      }

      // Counts
      const values = Object.values(days).filter(v => v !== null);
      const present = values.filter(v => v === 'P').length;
      const absent = values.filter(v => v === 'A').length;
      const late = values.filter(v => v === 'L').length;
      const excused = values.filter(v => v === 'E').length;

      return {
        student_id: st.id,
        reg_no: st.reg_no,
        full_name: st.full_name,
        days,
        present,
        absent,
        late,
        excused,
        total_marked: values.length
      };
    });

    res.json({
      month,
      year,
      mon,
      days_in_month: daysInMonth,
      holidays: holidayMap,
      grid
    });
  } catch (err) {
    console.error('Monthly grid error:', err);
    res.status(500).json({ error: 'Failed to fetch monthly grid' });
  }
});

// -------------------------------------------------------------
// ABSENT PARENT NOTIFICATION CENTER (100% Free WhatsApp & SMS)
// -------------------------------------------------------------

// Helper to normalize Sri Lankan phone numbers for WhatsApp & SMS
function normalizeSlPhone(num) {
  if (!num) return '';
  let clean = String(num).replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) clean = '94' + clean.slice(1);
  if (!clean.startsWith('94') && clean.length === 9) clean = '94' + clean;
  return clean;
}

// GET /api/batches/:id/attendance/absent-alerts?date=YYYY-MM-DD
router.get('/absent-alerts', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1. Fetch batch & settings
    const [batches] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (batches.length === 0) return res.status(404).json({ error: 'Batch not found' });
    const batch = batches[0];

    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });

    const teacherName = settings.teacher_name || 'ICT Instructor';
    const teacherPhone = settings.teacher_phone || '';
    const centreName = settings.centre_name_si || 'තාක්ෂණික පුහුණු මධ්‍යස්ථානය - අකුරැස්ස';
    const courseTitle = settings.course_title || batch.name;

    // 2. Fetch active students with attendance on this date
    const [students] = await db.query(`
      SELECT s.id, s.reg_no, s.full_name, s.phone, s.parent_name, s.parent_phone, s.parent_email, s.sort_order,
             COALESCE(a.status, 'unmarked') as att_status, a.note
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND a.batch_id = s.batch_id AND a.adate = ?
      WHERE s.batch_id = ? AND s.status = 'active'
      ORDER BY s.sort_order ASC, s.id ASC
    `, [date, batchId]);

    // 3. Filter absentees (marked 'A')
    const absentees = students.filter(s => s.att_status === 'A');

    // 4. Fetch notification log for this batch & date
    const [logs] = await db.query(
      'SELECT student_id, channel, recipient_phone, sent_at, status FROM parent_notifications WHERE batch_id = ? AND ndate = ?',
      [batchId, date]
    );
    const logMap = {};
    logs.forEach(l => {
      if (!logMap[l.student_id]) logMap[l.student_id] = [];
      logMap[l.student_id].push(l);
    });

    // 5. Generate individualized messages & links
    const absenteeList = absentees.map(st => {
      const parentPhoneClean = normalizeSlPhone(st.parent_phone || st.phone);
      const studentPhoneClean = normalizeSlPhone(st.phone);
      const studentLogs = logMap[st.id] || [];

      // Official pre-formulated messages
      const msgSinhala = `ජාතික තරුණ සේවා සභාව - අකුරැස්ස\n` +
        `පාඨමාලාව: ${courseTitle}\n\n` +
        `දෙමාපිය දැනුම්දීම:\n` +
        `ඔබගේ දරුවා වන ${st.full_name} (${st.reg_no || 'NVQ 4'}) අද දින (${date}) පෙරවරු 9:00 වන විට පුහුණු පන්තියට පැමිණ නොමැත. කරුණාකර මේ පිළිබඳව සොයා බලා අවශ්‍ය නම් පුහුණු මධ්‍යස්ථානය අමතන්න.\n\n` +
        `උපදේශක: ${teacherName}${teacherPhone ? ' - ' + teacherPhone : ''}`;

      const msgEnglish = `National Youth Services Council (NYSC) - Akuressa\n` +
        `Course: ${courseTitle}\n\n` +
        `PARENT ATTENDANCE ALERT:\n` +
        `Your child ${st.full_name} (${st.reg_no || 'NVQ 4'}) has not reported to the training centre today (${date}) as of 9:00 AM.\n` +
        `Please verify their attendance and contact the instructor if there is an emergency or illness.\n\n` +
        `Instructor: ${teacherName}${teacherPhone ? ' - ' + teacherPhone : ''}`;

      const msgCombined = `[NYSC AKURESSA - දෙමාපිය දැනුම්දීම / PARENT ALERT]\n\n` +
        `ඔබගේ දරුවා වන ${st.full_name} (${st.reg_no || 'NVQ 4'}) අද (${date}) පෙරවරු 9.00 වන විට පන්තියට පැමිණ නැත.\n\n` +
        `Your child ${st.full_name} is marked ABSENT today (${date}) as of 9:00 AM.\n\n` +
        `උපදේශක / Instructor: ${teacherName} (${teacherPhone || 'NYSC'})`;

      // Free WhatsApp URLs (wa.me)
      const waUrlSi = parentPhoneClean ? `https://wa.me/${parentPhoneClean}?text=${encodeURIComponent(msgSinhala)}` : null;
      const waUrlEn = parentPhoneClean ? `https://wa.me/${parentPhoneClean}?text=${encodeURIComponent(msgEnglish)}` : null;
      const waUrlCombined = parentPhoneClean ? `https://wa.me/${parentPhoneClean}?text=${encodeURIComponent(msgCombined)}` : null;

      // Free native SMS Intent URLs
      const smsUrlSi = parentPhoneClean ? `sms:+${parentPhoneClean}?body=${encodeURIComponent(msgSinhala)}` : null;
      const smsUrlEn = parentPhoneClean ? `sms:+${parentPhoneClean}?body=${encodeURIComponent(msgEnglish)}` : null;

      return {
        ...st,
        parent_phone_formatted: parentPhoneClean,
        student_phone_formatted: studentPhoneClean,
        has_phone: !!parentPhoneClean,
        messages: {
          si: msgSinhala,
          en: msgEnglish,
          combined: msgCombined
        },
        links: {
          whatsapp_si: waUrlSi,
          whatsapp_en: waUrlEn,
          whatsapp_combined: waUrlCombined,
          sms_si: smsUrlSi,
          sms_en: smsUrlEn
        },
        logs: studentLogs,
        notified: studentLogs.length > 0,
        last_notified_at: studentLogs[studentLogs.length - 1]?.sent_at || null
      };
    });

    res.json({
      date,
      total_students: students.length,
      absent_count: absentees.length,
      absentees: absenteeList,
      teacher_contact: {
        name: teacherName,
        phone: teacherPhone,
        centre: centreName
      }
    });
  } catch (err) {
    console.error('Absent alerts fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch absent alerts' });
  }
});

// POST /api/batches/:id/attendance/absent-alerts/log
router.post('/absent-alerts/log', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { student_id, date, channel = 'whatsapp', recipient_phone, message_text } = req.body;
    if (!student_id || !date || !recipient_phone) {
      return res.status(400).json({ error: 'student_id, date, and recipient_phone are required' });
    }

    const userId = req.user ? req.user.id : null;
    const [result] = await db.query(`
      INSERT INTO parent_notifications (
        batch_id, student_id, ndate, channel, recipient_phone, message_text, sent_by_user_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')
    `, [batchId, student_id, date, channel, recipient_phone, message_text || '', userId]);

    res.json({ success: true, notification_id: result.insertId });
  } catch (err) {
    console.error('Notification log error:', err);
    res.status(500).json({ error: 'Failed to log parent notification' });
  }
});

// POST /api/batches/:id/attendance/absent-alerts/quick-update-parent
router.post('/absent-alerts/quick-update-parent', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { student_id, parent_name, parent_phone, phone } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });

    await db.query(`
      UPDATE students
      SET parent_name = COALESCE(?, parent_name),
          parent_phone = COALESCE(?, parent_phone),
          phone = COALESCE(?, phone)
      WHERE id = ? AND batch_id = ?
    `, [parent_name, parent_phone, phone, student_id, batchId]);

    res.json({ success: true, message: 'Parent contact updated successfully' });
  } catch (err) {
    console.error('Quick update parent error:', err);
    res.status(500).json({ error: 'Failed to update parent contact' });
  }
});

module.exports = router;

