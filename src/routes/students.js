'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/batches/:id/students
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const [students] = await db.query(
      'SELECT * FROM students WHERE batch_id = ? ORDER BY sort_order ASC, id ASC',
      [batchId]
    );
    res.json(students);
  } catch (err) {
    console.error('Students get error:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// POST /api/batches/:id/students (single)
router.post('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.params.id;
    const { 
      full_name, reg_no = null, email = null,
      phone = null, parent_name = null, parent_phone = null, parent_email = null 
    } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Student full name is required' });
    }

    const [maxOrder] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM students WHERE batch_id = ?',
      [batchId]
    );
    const sort_order = maxOrder[0].next_order;

    const [result] = await db.query(
      `INSERT INTO students (
        batch_id, reg_no, full_name, email, phone, parent_name, parent_phone, parent_email, sort_order, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "active")`,
      [
        batchId, reg_no ? reg_no.trim() : null, full_name.trim(), email ? email.trim() : null,
        phone ? phone.trim() : null, parent_name ? parent_name.trim() : null,
        parent_phone ? parent_phone.trim() : null, parent_email ? parent_email.trim() : null,
        sort_order
      ]
    );

    res.status(201).json({ id: result.insertId, message: 'Student added successfully' });
  } catch (err) {
    console.error('Student add error:', err);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// POST /api/batches/:id/students/bulk (bulk paste)
router.post('/bulk', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const batchId = req.params.id;
    const { text, replace = false } = req.body;

    if (!text || typeof text !== 'string') {
      await connection.rollback();
      return res.status(400).json({ error: 'Text content required for bulk import' });
    }

    if (replace) {
      await connection.query('DELETE FROM students WHERE batch_id = ?', [batchId]);
    }

    const [maxOrder] = await connection.query(
      'SELECT COALESCE(MAX(sort_order), 0) as cur_order FROM students WHERE batch_id = ?',
      [batchId]
    );
    let currentOrder = maxOrder[0].cur_order;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const added = [];

    for (const line of lines) {
      // Formats supported:
      // 1. "RegNo \t Name \t Email"
      // 2. "RegNo, Name, Email"
      // 3. "1. Name" or just "Name"
      let parts = line.includes('\t') ? line.split('\t') : (line.includes(',') ? line.split(',') : [line]);
      parts = parts.map(p => p.trim());

      let reg_no = null;
      let full_name = '';
      let email = null;

      if (parts.length >= 3) {
        reg_no = parts[0];
        full_name = parts[1];
        email = parts[2];
      } else if (parts.length === 2) {
        if (parts[1].includes('@')) {
          full_name = parts[0];
          email = parts[1];
        } else {
          reg_no = parts[0];
          full_name = parts[1];
        }
      } else {
        // Strip leading numbering like "1. ", "01. "
        full_name = parts[0].replace(/^\d+[\.\-\)]\s*/, '');
      }

      if (!full_name) continue;

      currentOrder++;
      const [res] = await connection.query(
        'INSERT INTO students (batch_id, reg_no, full_name, email, sort_order, status) VALUES (?, ?, ?, ?, ?, "active")',
        [batchId, reg_no || null, full_name, email || null, currentOrder]
      );
      added.push({ id: res.insertId, full_name, reg_no, email, sort_order: currentOrder });
    }

    await connection.commit();
    res.json({ count: added.length, students: added, message: `Added ${added.length} students` });
  } catch (err) {
    await connection.rollback();
    console.error('Bulk students error:', err);
    res.status(500).json({ error: 'Failed to bulk add students' });
  } finally {
    connection.release();
  }
});

// PUT /api/batches/:id/students/:studentId
router.put('/:studentId', requireAuth, async (req, res) => {
  try {
    const { studentId, id: batchId } = req.params;
    const { 
      full_name, reg_no, email, phone, parent_name, parent_phone, parent_email, status, sort_order 
    } = req.body;

    await db.query(`
      UPDATE students
      SET full_name = COALESCE(?, full_name),
          reg_no = COALESCE(?, reg_no),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          parent_name = COALESCE(?, parent_name),
          parent_phone = COALESCE(?, parent_phone),
          parent_email = COALESCE(?, parent_email),
          status = COALESCE(?, status),
          sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND batch_id = ?
    `, [
      full_name, reg_no, email, phone, parent_name, parent_phone, parent_email,
      status, sort_order, studentId, batchId
    ]);

    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    console.error('Student update error:', err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// DELETE /api/batches/:id/students/:studentId
router.delete('/:studentId', requireAuth, async (req, res) => {
  try {
    const { studentId, id: batchId } = req.params;
    const soft = req.query.soft !== 'false';

    if (soft) {
      await db.query('UPDATE students SET status = "dropped" WHERE id = ? AND batch_id = ?', [studentId, batchId]);
      res.json({ message: 'Student marked as dropped' });
    } else {
      await db.query('DELETE FROM students WHERE id = ? AND batch_id = ?', [studentId, batchId]);
      res.json({ message: 'Student deleted' });
    }
  } catch (err) {
    console.error('Student delete error:', err);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// PUT /api/batches/:id/students/reorder
router.put('/reorder', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const batchId = req.params.id;
    const { orders } = req.body; // array of { id, sort_order }

    if (Array.isArray(orders)) {
      for (const item of orders) {
        await connection.query('UPDATE students SET sort_order = ? WHERE id = ? AND batch_id = ?', [
          item.sort_order,
          item.id,
          batchId
        ]);
      }
    }

    await connection.commit();
    res.json({ message: 'Order updated successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder students' });
  } finally {
    connection.release();
  }
});

module.exports = router;
