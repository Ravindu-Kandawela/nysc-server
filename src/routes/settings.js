'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    for (const r of rows) {
      settings[r.k] = r.v;
    }
    res.json(settings);
  } catch (err) {
    console.error('Settings get error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings
router.put('/', requireAuth, async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }

    for (const [k, v] of Object.entries(updates)) {
      await db.query(
        'INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
        [k, String(v)]
      );
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
