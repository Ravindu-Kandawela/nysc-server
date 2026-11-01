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

  // 3. Holidays (is_off = 1) + batch day_log off-days (teacher_absent / institute_closed)
  const [holidaysRows] = await db.query(
    'SELECT hdate FROM holidays WHERE is_off = 1 ORDER BY hdate ASC'
  );
  const [offLogRows] = await db.query(
    "SELECT ldate FROM day_log WHERE batch_id = ? AND status IN ('teacher_absent', 'institute_closed') ORDER BY ldate ASC",
    [batchId]
  );
  const holidaySet = new Set([
    ...holidaysRows.map(h => h.hdate),
    ...offLogRows.map(d => d.ldate)
  ]);
  const holidays = [...holidaySet].sort();

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

/**
 * Ensures all off-days (holidays with is_off = 1 and day_log rows with
 * teacher_absent / institute_closed) are synced with:
 *   1. day_log (never left unresolved or marked 'taught' on an is_off=1 holiday)
 *   2. diary_entries & diary_lines (removed on off-days so they never appear as taught on monthly reports)
 *   3. attendance (cleared on off-days so students aren't shown as Present on closed days)
 *   4. plan_sessions (if any session is scheduled on an off-day, shifts sessions forward automatically)
 */
async function syncOffDaysForBatch(batchId) {
  const [batches] = await db.query('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (batches.length === 0) return { replanned: false };
  const batch = batches[0];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Sync holidays (is_off = 1) into day_log for past/current dates (or dates that were bulk-resolved as 'taught')
  const [holRows] = await db.query(
    'SELECT hdate, name, type FROM holidays WHERE is_off = 1 AND hdate >= ? ORDER BY hdate ASC',
    [batch.start_date]
  );
  const [existingLogs] = await db.query(
    'SELECT ldate, status, reason, hours_delivered FROM day_log WHERE batch_id = ?',
    [batchId]
  );
  const logMap = {};
  existingLogs.forEach(l => { logMap[l.ldate] = l; });

  for (const h of holRows) {
    const existing = logMap[h.hdate];
    const shouldSyncLog = h.hdate <= today || !!existing;
    if (!shouldSyncLog) continue;

    const desiredStatus = /absent|leave/i.test(h.name || '') ? 'teacher_absent' : 'institute_closed';
    if (!existing || existing.status === 'taught' || Number(existing.hours_delivered) > 0) {
      await db.query(`
        INSERT INTO day_log (batch_id, ldate, status, reason, hours_delivered)
        VALUES (?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          reason = VALUES(reason),
          hours_delivered = 0
      `, [batchId, h.hdate, desiredStatus, h.name]);
    }
  }

  // 2. Collect all off-dates for this batch
  const [offLogs] = await db.query(
    "SELECT ldate FROM day_log WHERE batch_id = ? AND status IN ('teacher_absent', 'institute_closed')",
    [batchId]
  );
  const offDateSet = new Set([
    ...holRows.map(h => h.hdate),
    ...offLogs.map(d => d.ldate)
  ]);
  const offDates = [...offDateSet].sort();

  if (offDates.length === 0) return { replanned: false };

  // 3. Remove any diary entries/lines and student attendance on off-dates
  const placeholders = offDates.map(() => '?').join(',');
  await db.query(
    `DELETE dl FROM diary_lines dl
     JOIN diary_entries de ON dl.diary_id = de.id
     WHERE de.batch_id = ? AND de.ddate IN (${placeholders})`,
    [batchId, ...offDates]
  );
  await db.query(
    `DELETE FROM diary_entries WHERE batch_id = ? AND ddate IN (${placeholders})`,
    [batchId, ...offDates]
  );
  await db.query(
    `DELETE FROM attendance WHERE batch_id = ? AND adate IN (${placeholders})`,
    [batchId, ...offDates]
  );

  // 4. Check if current plan_version has any sessions scheduled on an off-date
  const [verRows] = await db.query(
    'SELECT id, version_no FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1',
    [batchId]
  );
  if (verRows.length === 0) return { replanned: false };
  const currentVer = verRows[0];

  const [conflictRows] = await db.query(
    `SELECT MIN(sdate) as min_date FROM plan_sessions
     WHERE plan_version_id = ? AND sdate IN (${placeholders})`,
    [currentVer.id, ...offDates]
  );
  const earliestConflict = conflictRows[0] && conflictRows[0].min_date;
  if (!earliestConflict) return { replanned: false };

  // 5. Re-plan from earliestConflict forward, shifting sessions past all off-dates
  const inputs = await getSchedulerInputs(batchId);
  const [sessionRows] = await db.query(
    'SELECT sdate as date, seq, module_id as moduleId, task_id as taskId, hours FROM plan_sessions WHERE plan_version_id = ? ORDER BY sdate ASC, seq ASC',
    [currentVer.id]
  );

  const replanResult = scheduler.replan({
    ...inputs,
    sessions: sessionRows,
    disruptedDate: earliestConflict,
    hoursDelivered: 0,
    strategy: 'shift'
  });

  const [taskRows] = await db.query('SELECT id, code, title FROM tasks');
  const taskMap = {};
  taskRows.forEach(t => { taskMap[t.id] = t; });

  const [modRows] = await db.query('SELECT id, code, title FROM modules');
  const modMap = {};
  modRows.forEach(m => { modMap[m.id] = m; });

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      'DELETE FROM plan_sessions WHERE plan_version_id = ? AND sdate >= ?',
      [currentVer.id, earliestConflict]
    );

    const shiftedSessions = replanResult.sessions.filter(s => s.date >= earliestConflict);
    for (const s of shiftedSessions) {
      const m = modMap[s.moduleId];
      const t = s.taskId ? taskMap[s.taskId] : null;
      const topic = t ? `${m ? m.code : ''} - ${t.code} ${t.title}` : (m ? `${m.code} ${m.title}` : '');

      await connection.query(`
        INSERT INTO plan_sessions (plan_version_id, batch_id, sdate, seq, module_id, task_id, hours, kind, topic_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'mixed', ?)
      `, [currentVer.id, batchId, s.date, s.seq, s.moduleId, s.taskId || null, s.hours, topic]);
    }

    // Clear auto-generated diary entries on/after earliestConflict so they re-sync with the shifted plan
    await connection.query(
      `DELETE dl FROM diary_lines dl
       JOIN diary_entries de ON dl.diary_id = de.id
       WHERE de.batch_id = ? AND de.ddate >= ?`,
      [batchId, earliestConflict]
    );
    await connection.query(
      'DELETE FROM diary_entries WHERE batch_id = ? AND ddate >= ?',
      [batchId, earliestConflict]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return { replanned: true, earliestConflict, newEndDate: replanResult.newEndDate };
}

async function syncOffDaysForAllBatches() {
  const [batches] = await db.query('SELECT id FROM batches');
  for (const b of batches) {
    await syncOffDaysForBatch(b.id);
  }
}

module.exports = {
  getSchedulerInputs,
  generatePlan: scheduler.generatePlan,
  replan: scheduler.replan,
  syncOffDaysForBatch,
  syncOffDaysForAllBatches
};
