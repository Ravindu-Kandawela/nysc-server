'use strict';
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// Ensure upload directory exists
let uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn(`[WARN] Configured UPLOAD_DIR (${uploadDir}) unavailable (${err.message}). Falling back to local uploads.`);
  uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB max

// Read CLIENT_URL fresh from .env each time, so a new Cloudflare tunnel URL
// (written by `npm run tunnel`) is used without restarting the server.
const envFilePath = path.join(__dirname, '../../.env');
function getClientUrl() {
  try {
    const parsed = require('dotenv').parse(fs.readFileSync(envFilePath, 'utf8'));
    if (parsed.CLIENT_URL) return parsed.CLIENT_URL.trim().replace(/\/+$/, '');
  } catch (e) { /* fall back below */ }
  return (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

// Mailer setup helper
function createTransport() {
  const port = Number(process.env.SMTP_PORT) || 465;
  const isSecure = port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: port,
    secure: isSecure,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

// -------------------------------------------------------------
// TEACHER ENDPOINTS (requireAuth)
// -------------------------------------------------------------

// GET /api/batches/:id/assignments
router.get('/batches/:id/assignments', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const [assignments] = await db.query(`
      SELECT a.*, m.code as module_code, m.title as module_title, t.code as task_code, t.title as task_title,
        (SELECT COUNT(*) FROM assignment_recipients ar WHERE ar.assignment_id = a.id) as recipient_count,
        (SELECT COUNT(DISTINCT ar.student_id) FROM assignment_recipients ar JOIN submissions s ON s.recipient_id = ar.id WHERE ar.assignment_id = a.id) as submission_count
      FROM assignments a
      JOIN modules m ON a.module_id = m.id
      LEFT JOIN tasks t ON a.task_id = t.id
      WHERE a.batch_id = ?
      ORDER BY a.created_at DESC
    `, [batchId]);

    res.json(assignments);
  } catch (err) {
    console.error('Assignments list error:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// POST /api/batches/:id/assignments (create assignment with optional attachment)
router.post('/batches/:id/assignments', requireAuth, upload.single('attachment'), async (req, res) => {
  try {
    const batchId = req.params.id;
    const { module_id, task_id, title, instructions, due_at, max_marks = 100, allow_resubmit = 1, drive_link } = req.body;

    if (!module_id || !title || !due_at) {
      return res.status(400).json({ error: 'Module, title, and due date are required' });
    }

    const attachmentPath = req.file ? req.file.filename : null;
    const attachmentName = req.file ? req.file.originalname : null;

    const [result] = await db.query(`
      INSERT INTO assignments (batch_id, module_id, task_id, title, instructions, attachment_path, attachment_name, drive_link, due_at, max_marks, allow_resubmit, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `, [batchId, module_id, task_id || null, title.trim(), instructions || null, attachmentPath, attachmentName, drive_link ? drive_link.trim() : null, due_at, max_marks, Number(allow_resubmit) ? 1 : 0]);

    res.status(201).json({ id: result.insertId, message: 'Assignment created successfully' });
  } catch (err) {
    console.error('Assignment create error:', err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// PUT /api/assignments/:id (update assignment with optional new attachment)
router.put('/:id', requireAuth, upload.single('attachment'), async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const { module_id, task_id, title, instructions, due_at, max_marks, allow_resubmit, status, remove_attachment, drive_link } = req.body;

    let attachmentSql = '';
    const params = [
      title ? title.trim() : null,
      module_id || null,
      task_id || null,
      instructions !== undefined ? instructions : null,
      drive_link !== undefined ? (drive_link ? drive_link.trim() : null) : null,
      due_at || null,
      max_marks !== undefined ? max_marks : null,
      allow_resubmit !== undefined ? (Number(allow_resubmit) ? 1 : 0) : null,
      status || null
    ];

    if (req.file) {
      attachmentSql = ', attachment_path = ?, attachment_name = ?';
      params.push(req.file.filename, req.file.originalname);
    } else if (remove_attachment === 'true' || remove_attachment === true) {
      attachmentSql = ', attachment_path = NULL, attachment_name = NULL';
    }

    params.push(assignmentId);

    await db.query(`
      UPDATE assignments
      SET title = COALESCE(?, title),
          module_id = COALESCE(?, module_id),
          task_id = COALESCE(?, task_id),
          instructions = COALESCE(?, instructions),
          drive_link = COALESCE(?, drive_link),
          due_at = COALESCE(?, due_at),
          max_marks = COALESCE(?, max_marks),
          allow_resubmit = COALESCE(?, allow_resubmit),
          status = COALESCE(?, status)
          ${attachmentSql}
      WHERE id = ?
    `, params);

    res.json({ message: 'Assignment updated successfully' });
  } catch (err) {
    console.error('Assignment update error:', err);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// DELETE /api/assignments/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const assignmentId = req.params.id;

    // Delete attachment file from disk if exists
    const [rows] = await connection.query('SELECT attachment_path FROM assignments WHERE id = ?', [assignmentId]);
    if (rows.length > 0 && rows[0].attachment_path) {
      const filePath = path.join(uploadDir, rows[0].attachment_path);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }

    // Delete grades and submissions for recipients
    await connection.query(`
      DELETE FROM grades WHERE submission_id IN (
        SELECT s.id FROM submissions s
        JOIN assignment_recipients ar ON s.recipient_id = ar.id
        WHERE ar.assignment_id = ?
      )
    `, [assignmentId]);

    await connection.query(`
      DELETE FROM submissions WHERE recipient_id IN (
        SELECT id FROM assignment_recipients WHERE assignment_id = ?
      )
    `, [assignmentId]);

    await connection.query('DELETE FROM assignment_recipients WHERE assignment_id = ?', [assignmentId]);
    await connection.query('DELETE FROM assignments WHERE id = ?', [assignmentId]);

    await connection.commit();
    res.json({ message: 'Assignment deleted successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Assignment delete error:', err);
    res.status(500).json({ error: 'Failed to delete assignment' });
  } finally {
    connection.release();
  }
});


// GET /api/assignments/:id (detail + recipients list)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const assignmentId = req.params.id;

    const [assignments] = await db.query(`
      SELECT a.*, m.code as module_code, m.title as module_title, t.code as task_code, t.title as task_title
      FROM assignments a
      JOIN modules m ON a.module_id = m.id
      LEFT JOIN tasks t ON a.task_id = t.id
      WHERE a.id = ?
    `, [assignmentId]);

    if (assignments.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const assignment = assignments[0];

    // Recipients with submission & grade
    const [recipients] = await db.query(`
      SELECT 
        ar.id as recipient_id, ar.student_id, ar.token, ar.email_status, ar.email_error, ar.emailed_at, ar.first_opened_at,
        s.full_name as student_name, s.reg_no as student_reg_no, s.email as student_email,
        sub.id as submission_id, sub.submitted_at, sub.is_late, sub.text_answer, sub.file_path, sub.file_name,
        g.result as grade_result, g.marks as grade_marks, g.feedback as grade_feedback, g.graded_at
      FROM assignment_recipients ar
      JOIN students s ON ar.student_id = s.id
      LEFT JOIN submissions sub ON sub.recipient_id = ar.id
      LEFT JOIN grades g ON g.submission_id = sub.id
      WHERE ar.assignment_id = ?
      ORDER BY s.sort_order ASC, s.id ASC
    `, [assignmentId]);

    const clientUrl = getClientUrl();

    // Compute status and full link for each recipient
    const recipientList = recipients.map(r => {
      let state = 'Not sent';
      if (r.grade_result) state = 'Graded';
      else if (r.submission_id) state = r.is_late ? 'Late' : 'Submitted';
      else if (r.first_opened_at) state = 'Opened';
      else if (r.email_status === 'sent') state = 'Sent';
      else if (r.email_status === 'failed') state = 'Direct Link';
      else if (r.token) state = 'Ready to Share';

      return {
        ...r,
        link: r.token ? `${clientUrl}/a/${r.token}` : null,
        derived_status: state
      };
    });

    res.json({ assignment, recipients: recipientList });
  } catch (err) {
    console.error('Assignment detail error:', err);
    res.status(500).json({ error: 'Failed to fetch assignment details' });
  }
});

// POST /api/assignments/:id/send (generate tokens, save links, and send emails if configured)
router.post('/:id/send', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const assignmentId = req.params.id;

    const [assignments] = await connection.query('SELECT * FROM assignments WHERE id = ?', [assignmentId]);
    if (assignments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const assignment = assignments[0];

    // Active students
    const [students] = await connection.query(
      'SELECT id, full_name, email FROM students WHERE batch_id = ? AND status = "active" ORDER BY sort_order ASC, id ASC',
      [assignment.batch_id]
    );

    // Existing recipients to preserve existing tokens
    const [existingRecipients] = await connection.query(
      'SELECT student_id, token, token_hash FROM assignment_recipients WHERE assignment_id = ?',
      [assignmentId]
    );
    const existingMap = new Map();
    existingRecipients.forEach(r => existingMap.set(r.student_id, r));

    const clientUrl = getClientUrl();
    const sentTokens = [];

    for (const student of students) {
      let rawToken;
      let tokenHash;

      const existing = existingMap.get(student.id);
      if (existing && existing.token) {
        rawToken = existing.token;
        tokenHash = existing.token_hash || crypto.createHash('sha256').update(rawToken).digest('hex');
      } else {
        rawToken = crypto.randomBytes(32).toString('hex');
        tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      }

      await connection.query(`
        INSERT INTO assignment_recipients (assignment_id, student_id, token, token_hash, email_status, emailed_at)
        VALUES (?, ?, ?, ?, 'pending', NULL)
        ON DUPLICATE KEY UPDATE token = VALUES(token), token_hash = VALUES(token_hash)
      `, [assignmentId, student.id, rawToken, tokenHash]);

      sentTokens.push({
        student_id: student.id,
        student_name: student.full_name,
        email: student.email,
        token: rawToken,
        link: `${clientUrl}/a/${rawToken}`,
        email_status: 'pending',
        email_error: null
      });
    }

    // Update assignment status to published
    await connection.query('UPDATE assignments SET status = "published" WHERE id = ?', [assignmentId]);
    await connection.commit();

    // Check if real SMTP credentials are provided
    const hasSmtp = Boolean(
      process.env.SMTP_USER &&
      process.env.SMTP_USER !== 'test_user' &&
      process.env.SMTP_PASS &&
      process.env.SMTP_PASS !== 'test_pass'
    );

    let emailsSentCount = 0;
    let emailsFailedCount = 0;

    if (hasSmtp) {
      const transporter = createTransport();
      for (const item of sentTokens) {
        if (!item.email) {
          item.email_status = 'failed';
          item.email_error = 'No student email address registered';
          await db.query(
            'UPDATE assignment_recipients SET email_status = ?, email_error = ? WHERE assignment_id = ? AND student_id = ?',
            ['failed', item.email_error, assignmentId, item.student_id]
          );
          emailsFailedCount++;
          continue;
        }

        try {
          const dueDateFormatted = new Date(assignment.due_at).toLocaleString();
          const driveLinkSection = assignment.drive_link ? `\nGoogle Drive Worksheet: ${assignment.drive_link}\n` : '';
          const driveLinkHtml = assignment.drive_link ? `
            <div style="margin: 14px 0; text-align: center;">
              <a href="${assignment.drive_link}" target="_blank" style="background: #0f9d58; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; font-size: 13px; display: inline-block;">
                📁 Open Worksheet on Google Drive
              </a>
            </div>
          ` : '';

          await transporter.sendMail({
            from: `"NYSC Akuressa ICT" <${process.env.SMTP_USER}>`,
            to: item.email,
            subject: `Assignment: ${assignment.title}`,
            text: `Hello ${item.student_name},\n\nYou have been assigned: "${assignment.title}".\nDue date: ${dueDateFormatted}${driveLinkSection}\nYour personal submission link:\n${item.link}\n\nThank you.\nNational Youth Services Council - Akuressa`,
            html: `
              <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background: #ffffff;">
                <h2 style="color: #4f46e5; margin-top: 0; font-size: 20px;">NYSC ICT Technician Course</h2>
                <p style="font-size: 14px;">Hello <strong>${item.student_name}</strong>,</p>
                <p style="font-size: 14px;">A new assignment has been published: <strong style="color: #1e293b;">${assignment.title}</strong>.</p>
                <div style="background: #f8fafc; border-left: 4px solid #4f46e5; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
                  <p style="margin: 0; font-size: 13px;"><strong>Due Date:</strong> ${dueDateFormatted}</p>
                  <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Max Marks:</strong> ${assignment.max_marks || 100}</p>
                </div>
                ${assignment.instructions ? `<div style="margin: 16px 0; font-size: 13px; color: #475569; background: #f1f5f9; padding: 12px; border-radius: 6px;"><strong>Instructions:</strong><br>${assignment.instructions}</div>` : ''}
                ${driveLinkHtml}
                <div style="margin: 20px 0; text-align: center;">
                  <a href="${item.link}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                    Open & Submit Assignment
                  </a>
                </div>
                <p style="font-size: 12px; color: #64748b; word-break: break-all;">Direct Link: <a href="${item.link}">${item.link}</a></p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                <p style="font-size: 11px; color: #94a3b8; margin: 0; text-align: center;">Technical Training Centre – Akuressa | National Youth Services Council</p>
              </div>
            `
          });
          item.email_status = 'sent';
          await db.query(
            'UPDATE assignment_recipients SET email_status = "sent", email_error = NULL, emailed_at = CURRENT_TIMESTAMP WHERE assignment_id = ? AND student_id = ?',
            [assignmentId, item.student_id]
          );
          emailsSentCount++;
        } catch (mailErr) {
          console.warn(`Email delivery failed for ${item.email}:`, mailErr.message);
          item.email_status = 'failed';
          item.email_error = mailErr.message;
          await db.query(
            'UPDATE assignment_recipients SET email_status = "failed", email_error = ? WHERE assignment_id = ? AND student_id = ?',
            [mailErr.message.slice(0, 290), assignmentId, item.student_id]
          );
          emailsFailedCount++;
        }
      }
    } else {
      // SMTP not configured or using test placeholder
      for (const item of sentTokens) {
        const reason = !item.email 
          ? 'No student email address registered' 
          : 'Ready to share directly (configure Gmail App Password in .env to auto-email)';
        await db.query(
          'UPDATE assignment_recipients SET email_status = "failed", email_error = ? WHERE assignment_id = ? AND student_id = ?',
          [reason, assignmentId, item.student_id]
        );
        item.email_status = 'failed';
        item.email_error = reason;
      }
    }

    res.json({
      message: hasSmtp 
        ? `Assignment published! ${emailsSentCount} emails delivered, ${emailsFailedCount} pending or direct-share.`
        : `Assignment published! All ${sentTokens.length} student submission links generated and ready to share.`,
      has_smtp: hasSmtp,
      emails_sent: emailsSentCount,
      recipients: sentTokens
    });
  } catch (err) {
    await connection.rollback();
    console.error('Assignment send error:', err);
    res.status(500).json({ error: 'Failed to send assignment: ' + err.message });
  } finally {
    connection.release();
  }
});

// POST /api/submissions/:submissionId/grade
router.post('/submissions/:submissionId/grade', requireAuth, async (req, res) => {
  try {
    const submissionId = req.params.submissionId;
    const { result, marks, feedback } = req.body;

    if (!result) {
      return res.status(400).json({ error: 'Grade result is required' });
    }

    await db.query(`
      INSERT INTO grades (submission_id, result, marks, feedback, graded_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        result = VALUES(result),
        marks = VALUES(marks),
        feedback = VALUES(feedback),
        graded_at = CURRENT_TIMESTAMP
    `, [submissionId, result, marks !== undefined ? marks : null, feedback || null]);

    res.json({ message: 'Submission graded successfully' });
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ error: 'Failed to grade submission' });
  }
});

// -------------------------------------------------------------
// PUBLIC STUDENT ENDPOINTS (no login required, verified via token)
// -------------------------------------------------------------

// GET /api/public/assignment/:token
router.get('/public/:token', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const [rows] = await db.query(`
      SELECT 
        ar.id as recipient_id, ar.first_opened_at,
        s.full_name as student_name, s.reg_no as student_reg_no,
        a.id as assignment_id, a.title, a.instructions, a.attachment_path, a.attachment_name, a.drive_link, a.due_at, a.max_marks, a.allow_resubmit, a.status as assignment_status,
        m.code as module_code, m.title as module_title
      FROM assignment_recipients ar
      JOIN students s ON ar.student_id = s.id
      JOIN assignments a ON ar.assignment_id = a.id
      JOIN modules m ON a.module_id = m.id
      WHERE ar.token = ? OR ar.token_hash = ?
    `, [rawToken, tokenHash]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired assignment link' });
    }

    const info = rows[0];

    // Mark first opened if not yet recorded
    if (!info.first_opened_at) {
      await db.query(
        'UPDATE assignment_recipients SET first_opened_at = CURRENT_TIMESTAMP WHERE id = ?',
        [info.recipient_id]
      );
    }

    // Check existing submission
    const [subRows] = await db.query(`
      SELECT sub.*, g.result as grade_result, g.marks as grade_marks, g.feedback as grade_feedback
      FROM submissions sub
      LEFT JOIN grades g ON g.submission_id = sub.id
      WHERE sub.recipient_id = ?
      ORDER BY sub.submitted_at DESC
      LIMIT 1
    `, [info.recipient_id]);

    res.json({
      assignment: {
        title: info.title,
        module: `${info.module_code} - ${info.module_title}`,
        instructions: info.instructions,
        attachment_url: info.attachment_path ? `/uploads/${info.attachment_path}` : null,
        attachment_name: info.attachment_name || (info.attachment_path ? 'Download Attachment' : null),
        drive_link: info.drive_link || null,
        due_at: info.due_at,
        max_marks: info.max_marks,
        allow_resubmit: info.allow_resubmit === 1
      },
      student: {
        name: info.student_name,
        reg_no: info.student_reg_no
      },
      submission: subRows[0] || null
    });
  } catch (err) {
    console.error('Public assignment fetch error:', err);
    res.status(500).json({ error: 'Failed to load assignment' });
  }
});

// POST /api/public/assignment/:token/submit
router.post('/public/:token/submit', upload.single('file'), async (req, res) => {
  try {
    const rawToken = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { text_answer } = req.body;
    const file = req.file;

    const [rows] = await db.query(`
      SELECT ar.id as recipient_id, a.due_at, a.allow_resubmit
      FROM assignment_recipients ar
      JOIN assignments a ON ar.assignment_id = a.id
      WHERE ar.token = ? OR ar.token_hash = ?
    `, [rawToken, tokenHash]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired assignment link' });
    }

    const recipient = rows[0];
    const now = new Date();
    const dueDate = new Date(recipient.due_at);
    const isLate = now > dueDate ? 1 : 0;

    // Check if already submitted
    const [existing] = await db.query(
      'SELECT id FROM submissions WHERE recipient_id = ?',
      [recipient.recipient_id]
    );

    if (existing.length > 0 && !recipient.allow_resubmit) {
      return res.status(400).json({ error: 'Resubmissions are not permitted for this assignment' });
    }

    const attemptNo = existing.length + 1;
    const filePath = file ? file.filename : null;
    const fileName = file ? file.originalname : null;
    const fileSize = file ? file.size : null;

    const [result] = await db.query(`
      INSERT INTO submissions (recipient_id, attempt_no, submitted_at, is_late, text_answer, file_path, file_name, file_size)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `, [recipient.recipient_id, attemptNo, isLate, text_answer || null, filePath, fileName, fileSize]);

    res.status(201).json({
      message: 'Assignment submitted successfully',
      submissionId: result.insertId,
      is_late: isLate === 1,
      attempt_no: attemptNo
    });
  } catch (err) {
    console.error('Public submit error:', err);
    res.status(500).json({ error: 'Failed to submit assignment' });
  }
});

module.exports = router;
