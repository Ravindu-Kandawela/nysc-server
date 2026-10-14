'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const os = require('os');

// Helper to format Sri Lankan mobile number for iPhone SMS app (e.g. 077XXXXXXX)
function normalizePhoneForSms(num) {
  if (!num) return '';
  let clean = String(num).replace(/[^0-9]/g, '');
  if (clean.startsWith('94') && clean.length === 11) return '0' + clean.slice(2);
  if (clean.length === 9) return '0' + clean;
  return clean;
}

// GET /api/auto-sms/today?batchId=&date=&includeAll=
// This is the endpoint called silently by iPhone Shortcuts at 9:00 AM
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const date = req.query.date || today;

    // 1. Get batch
    let batchId = req.query.batchId;
    if (!batchId) {
      const [b] = await db.query('SELECT id, name FROM batches WHERE status = "active" ORDER BY id ASC LIMIT 1');
      if (b.length > 0) batchId = b[0].id;
      else batchId = 1;
    }

    const [batchRows] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    const batch = batchRows[0] || { name: 'NVQ 4' };

    // 2. Settings
    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });
    const teacherName = settings.teacher_name || 'ICT Instructor';
    const teacherPhone = settings.teacher_phone || '';

    // 3. Find absent students on this date (marked 'A')
    const [students] = await db.query(`
      SELECT s.id, s.reg_no, s.full_name, s.phone, s.parent_name, s.parent_phone,
             a.status as att_status
      FROM students s
      JOIN attendance a ON s.id = a.student_id AND a.batch_id = s.batch_id AND a.adate = ?
      WHERE s.batch_id = ? AND s.status = 'active' AND a.status = 'A'
      ORDER BY s.sort_order ASC, s.id ASC
    `, [date, batchId]);

    // 4. Find who was already notified today so iPhone doesn't double-text
    const [logs] = await db.query(
      'SELECT student_id FROM parent_notifications WHERE batch_id = ? AND ndate = ?',
      [batchId, date]
    );
    const notifiedIds = new Set(logs.map(l => l.student_id));

    // 5. Build items array for Apple Shortcuts dictionary parser
    const items = [];
    for (const st of students) {
      if (!req.query.includeAll && notifiedIds.has(st.id)) continue;

      const rawPhone = st.parent_phone || st.phone;
      const phone = normalizePhoneForSms(rawPhone);
      if (!phone) continue;

      const message = `[NYSC AKURESSA - දෙමාපිය දැනුම්දීම]\n` +
        `ඔබගේ දරුවා වන ${st.full_name} (${st.reg_no || 'NVQ 4'}) අද (${date}) පෙරවරු 9.00 වන විට පන්තියට පැමිණ නැත.\n` +
        `Your child is marked ABSENT today as of 9:00 AM.\n` +
        `උපදේශක: ${teacherName}${teacherPhone ? ' - ' + teacherPhone : ''}`;

      items.push({
        student_id: st.id,
        student_name: st.full_name,
        reg_no: st.reg_no || '',
        parent_name: st.parent_name || 'Guardian',
        phone,
        message
      });
    }

    res.json({
      success: true,
      date,
      batch_id: batchId,
      total_absent: students.length,
      pending_count: items.length,
      items
    });
  } catch (err) {
    console.error('Auto SMS error:', err);
    res.status(500).json({ error: 'Failed to process auto SMS' });
  }
});

// GET /api/auto-sms/log?student_id=&phone=&batchId=
// Called by iPhone shortcut to record dispatch in audit database
router.get('/log', async (req, res) => {
  try {
    const { student_id, phone, batchId = 1 } = req.query;
    const date = new Date().toISOString().slice(0, 10);
    if (!student_id) return res.status(400).json({ error: 'student_id required' });

    await db.query(`
      INSERT INTO parent_notifications (
        batch_id, student_id, ndate, channel, recipient_phone, message_text, status
      ) VALUES (?, ?, ?, 'sms', ?, 'Automated 9:00 AM iPhone SMS sent', 'sent')
    `, [batchId, student_id, date, phone || '']);

    res.json({ success: true, message: 'SMS logged successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auto-sms/oic-summary?batchId=&date=
// Dedicated endpoint to fetch the daily attendance summary message for the Officer-in-Charge (මධ්‍යස්ථාන භාර නිලධාරී)
router.get('/oic-summary', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const date = req.query.date || today;

    // 1. Get batch
    let batchId = req.query.batchId;
    if (!batchId) {
      const [b] = await db.query('SELECT id, name FROM batches WHERE status = "active" ORDER BY id ASC LIMIT 1');
      if (b.length > 0) batchId = b[0].id;
      else batchId = 1;
    }

    const [batchRows] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    const batch = batchRows[0] || { name: 'NVQ 4' };

    // 2. Settings (Teacher, OIC, Center)
    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });

    const oicName = settings.center_in_charge_name || settings.oic_name || 'මධ්‍යස්ථාන භාර නිලධාරී තුමා';
    const oicTitle = settings.center_in_charge_title || settings.oic_title || 'මධ්‍යස්ථාන භාර නිලධාරී';
    const rawOicPhone = settings.center_in_charge_phone || settings.oic_phone || '';
    const oicPhone = normalizePhoneForSms(rawOicPhone);

    const teacherName = settings.teacher_name || 'ICT Instructor';
    const teacherPhone = settings.teacher_phone || '';
    const centreName = settings.centre_name_si || 'ජාතික තරුණ සේවා සභාව - අකුරැස්ස';
    const courseTitle = settings.course_title || batch.name || 'ICT (NVQ 4)';

    // 3. Count total active students in this batch
    const [totRows] = await db.query(
      'SELECT COUNT(*) as total FROM students WHERE batch_id = ? AND status = "active"',
      [batchId]
    );
    const totalStudents = totRows[0]?.total || 0;

    // 4. Count attendance breakdown for this date
    const [attRows] = await db.query(
      'SELECT status, COUNT(*) as cnt FROM attendance WHERE batch_id = ? AND adate = ? GROUP BY status',
      [batchId, date]
    );

    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let excusedCount = 0;

    for (const r of attRows) {
      if (r.status === 'P') presentCount = Number(r.cnt);
      else if (r.status === 'L') lateCount = Number(r.cnt);
      else if (r.status === 'A') absentCount = Number(r.cnt);
      else if (r.status === 'E') excusedCount = Number(r.cnt);
    }

    const totalPresent = presentCount + lateCount;
    const attendancePercentage = totalStudents > 0 
      ? Math.round((totalPresent / totalStudents) * 100) 
      : 0;

    // 5. Build official Sinhala message for OIC (මධ්‍යස්ථාන භාර නිලධාරී)
    const message = 
      `[${centreName} - දෛනික පැමිණීමේ වාර්තාව]\n` +
      `දිනය: ${date} (පෙරවරු 09:00)\n` +
      `පාඨමාලාව: ${courseTitle}\n\n` +
      `ගරු ${oicTitle} (${oicName}) වෙත,\n` +
      `අද දින පැමිණීමේ සාරාංශය පහත පරිදි වේ:\n` +
      `• මුළු ලියාපදිංචි: ${totalStudents}\n` +
      `• පැමිණි සිසුන් (Present): ${totalPresent}${lateCount > 0 ? ` (ප්‍රමාද: ${lateCount})` : ''}\n` +
      `• නොපැමිණි සිසුන් (Absent): ${absentCount}\n` +
      `${excusedCount > 0 ? `• නිවාඩු (Excused): ${excusedCount}\n` : ''}` +
      `• පැමිණීමේ ප්‍රතිශතය: ${attendancePercentage}%\n\n` +
      `උපදේශක: ${teacherName}${teacherPhone ? ' (' + teacherPhone + ')' : ''}`;

    const items = oicPhone ? [{
      recipient_name: oicName,
      title: oicTitle,
      phone: oicPhone,
      message
    }] : [];

    res.json({
      success: true,
      date,
      batch_id: batchId,
      batch_name: batch.name,
      oic_name: oicName,
      oic_title: oicTitle,
      phone: oicPhone,
      has_phone: Boolean(oicPhone),
      total_students: totalStudents,
      present_count: totalPresent,
      absent_count: absentCount,
      excused_count: excusedCount,
      attendance_percentage: attendancePercentage,
      message,
      items
    });
  } catch (err) {
    console.error('OIC Auto SMS error:', err);
    res.status(500).json({ error: 'Failed to generate OIC attendance summary' });
  }
});

// GET /api/auto-sms/info (Returns network URLs for setting up iPhone shortcut)
router.get('/info', async (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  const localIp = ips[0] || 'localhost';
  const port = process.env.PORT || 5000;
  res.json({
    localIp,
    endpointUrl: `/api/auto-sms/today`,
    oicEndpointUrl: `/api/auto-sms/oic-summary`,
    logUrl: `/api/auto-sms/log`
  });
});

module.exports = router;
