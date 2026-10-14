'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/holidays
router.get('/', requireAuth, async (req, res) => {
  try {
    const { year } = req.query;
    let query = 'SELECT * FROM holidays';
    const params = [];

    if (year) {
      query += ' WHERE YEAR(hdate) = ?';
      params.push(year);
    }

    query += ' ORDER BY hdate ASC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Holidays get error:', err);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  }
});

// POST /api/holidays
router.post('/', requireAuth, async (req, res) => {
  try {
    const { hdate, name, type = 'public', is_off = 1, source = 'Manual entry', verified = 1 } = req.body;
    if (!hdate || !name) {
      return res.status(400).json({ error: 'Date and name are required' });
    }

    const [result] = await db.query(`
      INSERT INTO holidays (hdate, name, type, is_off, source, verified)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE type = VALUES(type), is_off = VALUES(is_off), verified = VALUES(verified)
    `, [hdate, name.trim(), type, is_off ? 1 : 0, source, verified ? 1 : 0]);

    res.status(201).json({ id: result.insertId, message: 'Holiday added successfully' });
  } catch (err) {
    console.error('Holiday add error:', err);
    res.status(500).json({ error: 'Failed to add holiday' });
  }
});

// PUT /api/holidays/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const holidayId = req.params.id;
    const { hdate, name, type, is_off, source, verified } = req.body;

    await db.query(`
      UPDATE holidays
      SET hdate = COALESCE(?, hdate),
          name = COALESCE(?, name),
          type = COALESCE(?, type),
          is_off = COALESCE(?, is_off),
          source = COALESCE(?, source),
          verified = COALESCE(?, verified)
      WHERE id = ?
    `, [hdate, name, type, is_off !== undefined ? (is_off ? 1 : 0) : undefined, source, verified !== undefined ? (verified ? 1 : 0) : undefined, holidayId]);

    res.json({ message: 'Holiday updated successfully' });
  } catch (err) {
    console.error('Holiday update error:', err);
    res.status(500).json({ error: 'Failed to update holiday' });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const holidayId = req.params.id;
    await db.query('DELETE FROM holidays WHERE id = ?', [holidayId]);
    res.json({ message: 'Holiday deleted successfully' });
  } catch (err) {
    console.error('Holiday delete error:', err);
    res.status(500).json({ error: 'Failed to delete holiday' });
  }
});

// POST /api/holidays/import
router.post('/import', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { csvText, source = 'CSV Import' } = req.body;

    if (!csvText || typeof csvText !== 'string') {
      await connection.rollback();
      return res.status(400).json({ error: 'csvText is required' });
    }

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    let importedCount = 0;

    for (const line of lines) {
      if (line.toLowerCase().startsWith('date') || line.toLowerCase().startsWith('hdate')) continue;
      const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 2) {
        const hdate = parts[0];
        const name = parts[1];
        const type = parts[2] || 'public';

        if (/^\d{4}-\d{2}-\d{2}$/.test(hdate)) {
          await connection.query(`
            INSERT INTO holidays (hdate, name, type, is_off, source, verified)
            VALUES (?, ?, ?, 1, ?, 0)
            ON DUPLICATE KEY UPDATE type = VALUES(type)
          `, [hdate, name, type, source]);
          importedCount++;
        }
      }
    }

    await connection.commit();
    res.json({ count: importedCount, message: `Imported ${importedCount} holidays successfully` });
  } catch (err) {
    await connection.rollback();
    console.error('Holiday import error:', err);
    res.status(500).json({ error: 'Failed to import holidays' });
  } finally {
    connection.release();
  }
});

module.exports = router;
