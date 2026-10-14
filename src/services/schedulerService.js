'use strict';
const db = require('../db');
const scheduler = require('../scheduler/scheduler');

async function getSchedulerInputs(batchId) {
  // 1. Fetch batch
  const [batches] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (batches.length === 0) throw new Error('Batch not found');
  const batch = batches[0];

  // 2. Week pattern
  let [patternRows] = await db.query(
    'SELECT weekday, hours FROM batch_week_pattern WHERE batch_id = ?',
    [batchId]
  );
  if (patternRows.length === 0) {
    for (let d = 1; d <= 7; d++) {
      const h = (d >= 1 && d <= 5) ? 6.5 : 0;
      await db.query(
        'INSERT INTO batch_week_pattern (batch_id, weekday, hours, start_time, end_time) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE hours = VALUES(hours)',
        [batchId, d, h, h > 0 ? '09:00:00' : null, h > 0 ? '16:00:00' : null]
      );
    }
    [patternRows] = await db.query(
      'SELECT weekday, hours FROM batch_week_pattern WHERE batch_id = ?',
      [batchId]
    );
  }
  const weekPattern = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (const r of patternRows) {
    weekPattern[r.weekday] = Number(r.hours) || 0;
  }

  // 3. Holidays (is_off = 1)
  const [holidaysRows] = await db.query(
    'SELECT hdate FROM holidays WHERE is_off = 1 ORDER BY hdate ASC'
  );
  const holidays = holidaysRows.map(h => h.hdate);

  // Distinct holiday years
  const [yearsRows] = await db.query(
    'SELECT DISTINCT YEAR(hdate) as yr FROM holidays WHERE is_off = 1'
  );
  const holidayYears = yearsRows.map(y => Number(y.yr));

  // 4. Batch modules in teach_order
  const [moduleRows] = await db.query(`
    SELECT bm.module_id, bm.teach_order, bm.theory_hours, bm.practical_hours, bm.hours_already_done,
           m.code, m.title
    FROM batch_modules bm
    JOIN modules m ON bm.module_id = m.id
    WHERE bm.batch_id = ?
    ORDER BY bm.teach_order ASC
  `, [batchId]);

  // 5. Tasks and weights for these modules
  const [weightRows] = await db.query(`
    SELECT btw.task_id, btw.weight, t.module_id, t.code as task_code, t.title as task_title, t.sort_order
    FROM batch_task_weights btw
    JOIN tasks t ON btw.task_id = t.id
    WHERE btw.batch_id = ?
    ORDER BY t.sort_order ASC
  `, [batchId]);

  const tasksByModule = {};
  for (const w of weightRows) {
    if (!tasksByModule[w.module_id]) tasksByModule[w.module_id] = [];
    tasksByModule[w.module_id].push({
      taskId: w.task_id,
      weight: Number(w.weight) || 1,
      code: w.task_code,
      title: w.task_title
    });
  }

  const alreadyDone = {};
  const modules = moduleRows.map(m => {
    const totalHours = Number(m.theory_hours) + Number(m.practical_hours);
    if (Number(m.hours_already_done) > 0) {
      alreadyDone[m.module_id] = Number(m.hours_already_done);
    }
    return {
      moduleId: m.module_id,
      code: m.code,
      hours: totalHours,
      theoryHours: Number(m.theory_hours),
      practicalHours: Number(m.practical_hours),
      tasks: tasksByModule[m.module_id] || []
    };
  });

  return {
    batch,
    startDate: batch.start_date,
    weekPattern,
    holidays,
    holidayYears,
    modules,
    alreadyDone,
    plannedMonths: batch.planned_months || 6,
    targetPerMonth: batch.target_hours_per_month || 120,
    monthMode: batch.month_mode || 'batch'
  };
}

module.exports = {
  getSchedulerInputs,
  generatePlan: scheduler.generatePlan,
  replan: scheduler.replan
};
