'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildMonthlyReport } = require('../services/reportService');

// GET /api/reports/hours?batchId=
router.get('/hours', requireAuth, async (req, res) => {
  try {
    const batchId = req.query.batchId;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });

    // Module progress
    const [modules] = await db.query(`
      SELECT bm.module_id, bm.teach_order, bm.theory_hours, bm.practical_hours,
             m.code, m.title,
             COALESCE((
               SELECT SUM(dl.hours) 
               FROM diary_lines dl 
               JOIN diary_entries de ON dl.diary_id = de.id 
               WHERE dl.module_id = bm.module_id AND de.batch_id = bm.batch_id
             ), 0) as delivered_hours
      FROM batch_modules bm
      JOIN modules m ON bm.module_id = m.id
      WHERE bm.batch_id = ?
      ORDER BY bm.teach_order ASC
    `, [batchId]);

    const totalCurriculum = modules.reduce((a, m) => a + Number(m.theory_hours) + Number(m.practical_hours), 0);
    const totalDelivered = modules.reduce((a, m) => a + Number(m.delivered_hours), 0);

    res.json({
      total_curriculum: totalCurriculum,
      total_delivered: totalDelivered,
      total_remaining: Math.max(0, totalCurriculum - totalDelivered),
      modules: modules.map(m => {
        const planned = Number(m.theory_hours) + Number(m.practical_hours);
        const delivered = Number(m.delivered_hours);
        return {
          module_id: m.module_id,
          code: m.code,
          title: m.title,
          planned_hours: planned,
          delivered_hours: delivered,
          remaining_hours: Math.max(0, planned - delivered),
          percent_complete: planned > 0 ? Math.min(100, Math.round((delivered / planned) * 100)) : 0
        };
      })
    });
  } catch (err) {
    console.error('Hours report error:', err);
    res.status(500).json({ error: 'Failed to generate hours report' });
  }
});

// GET /api/reports/periods?batchId=
router.get('/periods', requireAuth, async (req, res) => {
  try {
    const batchId = req.query.batchId;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });

    const [batches] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (batches.length === 0) return res.status(404).json({ error: 'Batch not found' });
    const batch = batches[0];

    const periods = [];
    const targetHours = batch.target_hours_per_month || 120;
    const [startYear, startMonth, startDay] = batch.start_date.split('-').map(Number);
    const plannedMonths = (batch.planned_months || 6) + 1; // +1 to account for split initial month

    const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTH_NAMES_SI = ['ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'];

    // Month 1: Start Date to End of that calendar month
    const pad = (n) => String(n).padStart(2, '0');
    let curY = startYear;
    let curM = startMonth;

    for (let i = 0; i < plannedMonths; i++) {
      const isFirst = i === 0;
      const lastDayOfMonth = new Date(Date.UTC(curY, curM, 0)).getUTCDate();
      const from = isFirst ? batch.start_date : `${curY}-${pad(curM)}-01`;
      const to = `${curY}-${pad(curM)}-${pad(lastDayOfMonth)}`;
      const mIdx = curM - 1;
      const mNameEn = MONTH_NAMES_EN[mIdx];
      const mNameSi = MONTH_NAMES_SI[mIdx];

      const [sumRow] = await db.query(`
        SELECT COALESCE(SUM(hours_delivered), 0) as taught_hours,
               COUNT(CASE WHEN hours_delivered > 0 THEN 1 END) as taught_days
        FROM day_log
        WHERE batch_id = ? AND ldate >= ? AND ldate <= ? AND status IN ('taught', 'partial', 'substitute', 'assessment_day')
      `, [batchId, from, to]);

      const taught = Number(sumRow[0].taught_hours) || 0;
      const days = Number(sumRow[0].taught_days) || 0;

      // For a partial initial month (e.g. July 27-31, only 4 teaching days = 26h), target is 26h
      const periodTarget = isFirst && (lastDayOfMonth - startDay + 1) < 15 ? 26 : targetHours;

      periods.push({
        month_no: i + 1,
        title: isFirst ? `${mNameEn} (Start)` : `${mNameEn} ${curY}`,
        titleSi: isFirst ? `${mNameSi} (ආරම්භක)` : `${mNameSi} ${curY}`,
        from,
        to,
        year: curY,
        month: curM,
        targetHours: periodTarget,
        taughtHours: taught,
        taughtDays: days,
        isEligible: taught >= periodTarget,
        diff: Math.round((taught - periodTarget) * 10) / 10
      });

      // Advance to next calendar month
      curM++;
      if (curM > 12) {
        curM = 1;
        curY++;
      }
    }

    res.json(periods);
  } catch (err) {
    console.error('Report periods error:', err);
    res.status(500).json({ error: 'Failed to fetch report periods' });
  }
});

// GET /api/reports/monthly?batchId=&from=&to=
router.get('/monthly', requireAuth, async (req, res) => {
  try {
    const { batchId, from, to } = req.query;
    if (!batchId || !from || !to) {
      return res.status(400).json({ error: 'batchId, from, and to dates are required' });
    }

    const report = await buildMonthlyReport(batchId, from, to);
    res.json(report);
  } catch (err) {
    console.error('Monthly report preview error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate monthly report preview' });
  }
});

// POST /api/reports/monthly/confirm
router.post('/monthly/confirm', requireAuth, async (req, res) => {
  try {
    const { batchId, from, to } = req.body;
    if (!batchId || !from || !to) {
      return res.status(400).json({ error: 'batchId, from, and to dates are required' });
    }

    const reportData = await buildMonthlyReport(batchId, from, to);

    // Find next version_no for this period
    const [existing] = await db.query(
      'SELECT COALESCE(MAX(version_no), 0) + 1 as next_ver FROM monthly_reports WHERE batch_id = ? AND period_from = ? AND period_to = ?',
      [batchId, from, to]
    );
    const nextVer = existing[0].next_ver;

    const [result] = await db.query(`
      INSERT INTO monthly_reports (batch_id, period_from, period_to, version_no, status, snapshot)
      VALUES (?, ?, ?, ?, 'confirmed', ?)
    `, [batchId, from, to, nextVer, JSON.stringify(reportData)]);

    res.status(201).json({
      id: result.insertId,
      version_no: nextVer,
      message: 'Monthly report snapshot confirmed and saved'
    });
  } catch (err) {
    console.error('Monthly report confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm monthly report' });
  }
});

// GET /api/reports/monthly-saved?batchId=
router.get('/monthly-saved', requireAuth, async (req, res) => {
  try {
    const batchId = req.query.batchId;
    const [rows] = await db.query(
      'SELECT id, batch_id, period_from, period_to, version_no, status, created_at FROM monthly_reports WHERE batch_id = ? ORDER BY period_from DESC, version_no DESC',
      [batchId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Saved monthly reports error:', err);
    res.status(500).json({ error: 'Failed to fetch saved reports' });
  }
});

module.exports = router;
