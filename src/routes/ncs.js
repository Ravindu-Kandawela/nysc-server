'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/ncs/versions
router.get('/versions', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ncs_versions ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('NCS versions error:', err);
    res.status(500).json({ error: 'Failed to fetch NCS versions' });
  }
});

// GET /api/ncs/modules
router.get('/modules', requireAuth, async (req, res) => {
  try {
    const versionId = req.query.versionId || 1;
    const [rows] = await db.query(
      'SELECT * FROM modules WHERE ncs_version_id = ? ORDER BY teach_order ASC',
      [versionId]
    );
    res.json(rows);
  } catch (err) {
    console.error('NCS modules error:', err);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// GET /api/ncs/modules/:id/tasks
router.get('/modules/:id/tasks', requireAuth, async (req, res) => {
  try {
    const moduleId = req.params.id;
    const [tasks] = await db.query(
      'SELECT * FROM tasks WHERE module_id = ? ORDER BY sort_order ASC',
      [moduleId]
    );

    if (tasks.length === 0) {
      return res.json([]);
    }

    const taskIds = tasks.map(t => t.id);
    const [steps] = await db.query(
      `SELECT * FROM steps WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY sort_order ASC`,
      taskIds
    );

    const stepsByTask = {};
    for (const step of steps) {
      if (!stepsByTask[step.task_id]) stepsByTask[step.task_id] = [];
      stepsByTask[step.task_id].push(step);
    }

    const result = tasks.map(t => ({
      ...t,
      steps: stepsByTask[t.id] || []
    }));

    res.json(result);
  } catch (err) {
    console.error('NCS tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

module.exports = router;
