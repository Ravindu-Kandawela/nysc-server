'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./db');

const authRouter = require('./routes/auth');
const settingsRouter = require('./routes/settings');
const ncsRouter = require('./routes/ncs');
const batchesRouter = require('./routes/batches');
const studentsRouter = require('./routes/students');
const planRouter = require('./routes/plan');
const dayLogRouter = require('./routes/dayLog');
const attendanceRouter = require('./routes/attendance');
const diaryRouter = require('./routes/diary');
const checklistsRouter = require('./routes/checklists');
const holidaysRouter = require('./routes/holidays');
const assignmentsRouter = require('./routes/assignments');
const reportsRouter = require('./routes/reports');
const printRouter = require('./routes/print');
const autoSmsRouter = require('./routes/autoSms');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads directory
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// Health check endpoint (Milestone M0)
app.get('/api/health', async (req, res) => {
  try {
    const [stepCount] = await db.query('SELECT COUNT(*) as steps FROM steps');
    const [moduleHours] = await db.query('SELECT SUM(theory_hours + practical_hours) as total_hours FROM modules');
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      db: 'connected',
      stepsCount: stepCount[0].steps,
      curriculumHours: moduleHours[0].total_hours
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Register API Routes
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ncs', ncsRouter);

// Batches & nested routers
app.use('/api/batches', batchesRouter);
app.use('/api/batches/:id/students', studentsRouter);
app.use('/api/batches/:id/plan', planRouter);
app.use('/api/batches/:id/day-log', dayLogRouter);
app.use('/api/batches/:id/attendance', attendanceRouter);
app.use('/api/batches/:id/diary', diaryRouter);
app.use('/api/batches/:id/checklists', checklistsRouter);

// Holidays
app.use('/api/holidays', holidaysRouter);

// Assignments & student public endpoints
app.use('/api', assignmentsRouter);
app.use('/api/assignments', assignmentsRouter);

// Reports & Printing
app.use('/api/reports', reportsRouter);
app.use('/api/print', printRouter);

// iPhone Automated SMS Endpoint
app.use('/api/auto-sms', autoSmsRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
