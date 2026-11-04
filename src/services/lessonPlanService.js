'use strict';
/**
 * Lesson plan service
 *  - Stores per-module lesson content (goal, sessions, topics, activities, hours, resources, assessment)
 *  - Combines it with the generated day-by-day plan (plan_sessions) and what was actually taught (day_log)
 *    to build a complete, hour-accurate lesson plan for the UI and for printing/PDF.
 */
const db = require('../db');
const NVQ4_CONTENT = require('../data/lessonPlanNvq4');

const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TAUGHT_STATUSES = new Set(['taught', 'partial', 'substitute', 'assessment_day']);

const toLines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).trim()).filter(Boolean);
const round1 = (n) => Math.round(n * 10) / 10;

/** Split total hours across n parts in 0.5h steps (sum is exact). */
function splitHours(total, n) {
  if (n <= 0) return [];
  const half = Math.round(total * 2);
  const base = Math.floor(half / n);
  let left = half - base * n;
  return Array.from({ length: n }, () => {
    const h = base + (left > 0 ? 1 : 0);
    if (left > 0) left--;
    return h / 2;
  });
}

let ensured = false;
async function ensureLessonTables() {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS lesson_units (
      module_id INT PRIMARY KEY,
      unit_title VARCHAR(255),
      goal TEXT,
      resources TEXT,
      assessment TEXT,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (module_id) REFERENCES modules(id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS lesson_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_id INT NOT NULL,
      session_no INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      focus VARCHAR(255),
      topics TEXT,
      activity TEXT,
      hours DECIMAL(5,1) NOT NULL DEFAULT 0,
      INDEX (module_id, session_no),
      FOREIGN KEY (module_id) REFERENCES modules(id)
    )
  `);

  const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM lesson_units');
  if (Number(c) === 0) await seedFromNvq4();
  ensured = true;
}

async function seedFromNvq4() {
  const [mods] = await db.query('SELECT id, code, theory_hours, practical_hours FROM modules');
  for (const m of mods) {
    const content = NVQ4_CONTENT[m.code];
    if (!content) continue;
    const total = Number(m.theory_hours) + Number(m.practical_hours);
    await db.query(
      'INSERT INTO lesson_units (module_id, unit_title, goal, resources, assessment) VALUES (?, ?, ?, ?, ?)',
      [m.id, content.unit_title, content.goal, toLines(content.resources).join('\n'), toLines(content.assessment).join('\n')]
    );
    const hours = splitHours(total, content.sessions.length);
    for (let i = 0; i < content.sessions.length; i++) {
      const s = content.sessions[i];
      await db.query(
        'INSERT INTO lesson_sessions (module_id, session_no, title, focus, topics, activity, hours) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [m.id, i + 1, s.title, s.focus || null, toLines(s.topics).join('\n'), s.activity || null, s.hours != null ? s.hours : hours[i]]
      );
    }
  }
  console.log('Lesson plan content seeded from NVQ 4 lesson plan');
}

async function getContentMap() {
  await ensureLessonTables();
  const [units] = await db.query('SELECT * FROM lesson_units');
  const [sessions] = await db.query('SELECT * FROM lesson_sessions ORDER BY module_id, session_no, id');
  const map = {};
  for (const u of units) {
    map[u.module_id] = {
      unit_title: u.unit_title, goal: u.goal || '',
      resources: toLines(u.resources), assessment: toLines(u.assessment), sessions: []
    };
  }
  for (const s of sessions) {
    if (!map[s.module_id]) map[s.module_id] = { unit_title: '', goal: '', resources: [], assessment: [], sessions: [] };
    map[s.module_id].sessions.push({
      id: s.id, session_no: s.session_no, title: s.title, focus: s.focus || '',
      topics: toLines(s.topics), activity: s.activity || '', hours: Number(s.hours) || 0
    });
  }
  return map;
}

async function saveModuleContent(moduleId, body) {
  await ensureLessonTables();
  const { unit_title = '', goal = '', resources = [], assessment = [], sessions = [] } = body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`
      INSERT INTO lesson_units (module_id, unit_title, goal, resources, assessment) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE unit_title = VALUES(unit_title), goal = VALUES(goal),
        resources = VALUES(resources), assessment = VALUES(assessment)
    `, [moduleId, unit_title, goal, toLines(resources).join('\n'), toLines(assessment).join('\n')]);
    await conn.query('DELETE FROM lesson_sessions WHERE module_id = ?', [moduleId]);
    let no = 0;
    for (const s of sessions) {
      if (!s.title || !String(s.title).trim()) continue;
      await conn.query(
        'INSERT INTO lesson_sessions (module_id, session_no, title, focus, topics, activity, hours) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [moduleId, ++no, String(s.title).trim(), s.focus || null, toLines(s.topics).join('\n'), s.activity || null, Math.max(0, Number(s.hours) || 0)]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function getSettings() {
  const [rows] = await db.query('SELECT k, v FROM settings');
  const settings = {};
  rows.forEach(r => { settings[r.k] = r.v; });
  if (!settings.teacher_name) {
    const [u] = await db.query('SELECT name FROM users ORDER BY id ASC LIMIT 1');
    if (u.length && u[0].name) settings.teacher_name = u[0].name;
  }
  return settings;
}

const fmtTime = (t) => (t ? String(t).slice(0, 5) : null);

/**
 * Helper: Get the Monday YYYY-MM-DD of any YYYY-MM-DD date string
 */
function getMondayYmd(ymd) {
  const dt = new Date(ymd + 'T00:00:00Z');
  const dow = dt.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const dt = new Date(ymd + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Build the full lesson plan & synchronized Work Plan (Gantt Chart) for a batch.
 * opts: { from, to } — limits the day-by-day list only; module & Gantt mapping always uses the full plan.
 */
async function buildLessonPlan(batchId, opts = {}) {
  const { from, to } = opts;
  const [batchRows] = await db.query(`
    SELECT b.*, nv.code AS ncs_code, nv.title AS ncs_title
    FROM batches b JOIN ncs_versions nv ON nv.id = b.ncs_version_id WHERE b.id = ?
  `, [batchId]);
  if (!batchRows.length) throw new Error('Batch not found');
  const batch = batchRows[0];

  // Keep Lesson Plan, Timetable & Work Plan Gantt 100% synced with custom holidays & off-days
  try {
    const { syncOffDaysForBatch } = require('./schedulerService');
    await syncOffDaysForBatch(batchId);
  } catch (syncErr) {
    console.warn('syncOffDaysForBatch warning inside buildLessonPlan:', syncErr.message);
  }

  const settings = await getSettings();
  const content = await getContentMap();

  const [patternRows] = await db.query(
    'SELECT weekday, hours, start_time, end_time FROM batch_week_pattern WHERE batch_id = ? ORDER BY weekday', [batchId]
  );
  const pattern = {};
  patternRows.forEach(p => {
    pattern[p.weekday] = { hours: Number(p.hours) || 0, start: fmtTime(p.start_time), end: fmtTime(p.end_time) };
  });
  const weeklyHours = patternRows.reduce((a, p) => a + (Number(p.hours) || 0), 0);

  const [modRows] = await db.query(`
    SELECT bm.module_id, bm.teach_order, bm.theory_hours, bm.practical_hours, bm.hours_already_done,
           m.code, m.title
    FROM batch_modules bm JOIN modules m ON m.id = bm.module_id
    WHERE bm.batch_id = ? ORDER BY bm.teach_order ASC
  `, [batchId]);

  const [verRows] = await db.query(
    'SELECT id, version_no, effective_from, created_at FROM plan_versions WHERE batch_id = ? AND is_current = 1 LIMIT 1', [batchId]
  );
  const version = verRows[0] || null;

  let planRows = [];
  if (version) {
    [planRows] = await db.query(`
      SELECT ps.sdate, ps.seq, ps.module_id, ps.task_id, ps.hours,
             t.code AS task_code, t.title AS task_title
      FROM plan_sessions ps LEFT JOIN tasks t ON t.id = ps.task_id
      WHERE ps.plan_version_id = ? ORDER BY ps.sdate ASC, ps.seq ASC
    `, [version.id]);
  }

  const [dayLogRows] = await db.query(
    'SELECT ldate, status, hours_delivered, reason FROM day_log WHERE batch_id = ?', [batchId]
  );
  const dayLog = {};
  dayLogRows.forEach(d => { dayLog[d.ldate] = d; });

  // ── Build Gantt Timeline Weeks (Monday to Friday) across the entire course ──
  const weekMap = new Map();
  if (planRows.length > 0) {
    const firstMon = getMondayYmd(planRows[0].sdate);
    const lastMon = getMondayYmd(planRows[planRows.length - 1].sdate);
    let curMon = firstMon;
    let wIdx = 1;
    while (curMon <= lastMon) {
      const fri = addDaysYmd(curMon, 4);
      // Assign week to the month of its Wednesday (mid-week) so weeks group cleanly into months
      const wed = addDaysYmd(curMon, 2);
      const [wy, wm] = wed.split('-').map(Number);
      const monthKey = `${wy}-${String(wm).padStart(2, '0')}`;
      const monthLabel = `${MONTH_SHORT_EN[wm - 1]} ${wy}`;
      weekMap.set(curMon, {
        weekNo: wIdx++,
        monday: curMon,
        friday: fri,
        monthKey,
        monthLabel,
        monthShort: MONTH_SHORT_EN[wm - 1],
        year: wy,
        weekInMonth: 0,
        label: `${curMon.slice(8, 10)}–${fri.slice(8, 10)}`,
        plannedHours: 0,
        deliveredHours: 0,
        teachingDays: 0
      });
      curMon = addDaysYmd(curMon, 7);
    }
  }

  const ganttWeeks = Array.from(weekMap.values());
  const ganttMonths = [];
  let curMonthObj = null;
  for (const w of ganttWeeks) {
    if (!curMonthObj || curMonthObj.monthKey !== w.monthKey) {
      curMonthObj = {
        monthKey: w.monthKey,
        label: w.monthLabel,
        shortLabel: w.monthShort,
        year: w.year,
        weeksCount: 0,
        plannedHours: 0,
        deliveredHours: 0
      };
      ganttMonths.push(curMonthObj);
    }
    curMonthObj.weeksCount++;
    w.weekInMonth = curMonthObj.weeksCount;
  }

  // ── Modules with lesson-session hour ranges & task / weekly Gantt buckets ──
  const modules = modRows.map(m => {
    const c = content[m.module_id] || { unit_title: '', goal: '', resources: [], assessment: [], sessions: [] };
    const total = Number(m.theory_hours) + Number(m.practical_hours);
    let cum = 0;
    const sessions = c.sessions.map(s => {
      const r = {
        ...s,
        rangeStart: cum,
        rangeEnd: cum + s.hours,
        plannedHours: 0,
        deliveredHours: 0,
        firstDate: null,
        lastDate: null,
        days: 0,
        weeklyHours: {}
      };
      cum += s.hours;
      return r;
    });
    return {
      module_id: m.module_id, code: m.code, title: m.title, teach_order: m.teach_order,
      unit_title: c.unit_title || m.title, goal: c.goal, resources: c.resources, assessment: c.assessment,
      theory_hours: Number(m.theory_hours), practical_hours: Number(m.practical_hours), total_hours: total,
      already_done: Number(m.hours_already_done) || 0,
      lesson_hours_total: round1(cum),
      sessions,
      tasks: [],
      weeklyHours: {},
      monthlyHours: {},
      plannedHours: 0, deliveredHours: 0, firstDate: null, lastDate: null, days: 0,
      _cursor: Number(m.hours_already_done) || 0,
      _taskMap: new Map()
    };
  });
  const modById = {};
  modules.forEach(m => { modById[m.module_id] = m; });

  // ── Delivered hours per plan row (distribute each day's delivered hours across its rows) ──
  const rowsByDate = {};
  planRows.forEach(r => { (rowsByDate[r.sdate] = rowsByDate[r.sdate] || []).push(r); });
  for (const [date, rows] of Object.entries(rowsByDate)) {
    const log = dayLog[date];
    let left = log && TAUGHT_STATUSES.has(log.status) ? Number(log.hours_delivered) || 0 : 0;
    rows.forEach((r, i) => {
      const h = Number(r.hours) || 0;
      const d = i === rows.length - 1 ? left : Math.min(left, h);
      r.delivered = Math.max(0, d);
      left -= r.delivered;
    });

    const mon = getMondayYmd(date);
    const wk = weekMap.get(mon);
    if (wk) {
      wk.teachingDays += 1;
    }
  }

  // ── Map each plan row to the lesson sessions, tasks, and weekly Gantt buckets ──
  for (const r of planRows) {
    const m = modById[r.module_id];
    const hours = Number(r.hours) || 0;
    const delivered = r.delivered || 0;
    r.lessons = [];
    if (!m) continue;

    const mon = getMondayYmd(r.sdate);
    const wk = weekMap.get(mon);
    const weekNo = wk ? wk.weekNo : null;
    if (wk) {
      wk.plannedHours = round1(wk.plannedHours + hours);
      wk.deliveredHours = round1(wk.deliveredHours + delivered);
      if (!m.weeklyHours[weekNo]) m.weeklyHours[weekNo] = { planned: 0, delivered: 0, days: 0, lastDate: null };
      m.weeklyHours[weekNo].planned = round1(m.weeklyHours[weekNo].planned + hours);
      m.weeklyHours[weekNo].delivered = round1(m.weeklyHours[weekNo].delivered + delivered);
      if (m.weeklyHours[weekNo].lastDate !== r.sdate) {
        m.weeklyHours[weekNo].days += 1;
        m.weeklyHours[weekNo].lastDate = r.sdate;
      }

      if (!m.monthlyHours[wk.monthKey]) m.monthlyHours[wk.monthKey] = { planned: 0, delivered: 0 };
      m.monthlyHours[wk.monthKey].planned = round1(m.monthlyHours[wk.monthKey].planned + hours);
      m.monthlyHours[wk.monthKey].delivered = round1(m.monthlyHours[wk.monthKey].delivered + delivered);
    }

    const start = m._cursor;
    const end = start + hours;
    m._cursor = end;
    m.plannedHours += hours;
    m.deliveredHours += delivered;
    if (!m.firstDate) m.firstDate = r.sdate;
    if (m.lastDate !== r.sdate) m.days++;
    m.lastDate = r.sdate;

    // Task-level aggregation for Work Plan Gantt drilldown
    if (r.task_code) {
      let tk = m._taskMap.get(r.task_code);
      if (!tk) {
        tk = {
          task_id: r.task_id,
          code: r.task_code,
          title: r.task_title || r.task_code,
          plannedHours: 0,
          deliveredHours: 0,
          firstDate: null,
          lastDate: null,
          days: 0,
          weeklyHours: {}
        };
        m._taskMap.set(r.task_code, tk);
      }
      tk.plannedHours = round1(tk.plannedHours + hours);
      tk.deliveredHours = round1(tk.deliveredHours + delivered);
      if (!tk.firstDate) tk.firstDate = r.sdate;
      if (tk.lastDate !== r.sdate) tk.days++;
      tk.lastDate = r.sdate;
      if (weekNo) {
        if (!tk.weeklyHours[weekNo]) tk.weeklyHours[weekNo] = { planned: 0, delivered: 0 };
        tk.weeklyHours[weekNo].planned = round1(tk.weeklyHours[weekNo].planned + hours);
        tk.weeklyHours[weekNo].delivered = round1(tk.weeklyHours[weekNo].delivered + delivered);
      }
    }

    if (m.sessions.length) {
      for (let i = 0; i < m.sessions.length; i++) {
        const s = m.sessions[i];
        const isLast = i === m.sessions.length - 1;
        const sEnd = isLast ? Infinity : s.rangeEnd;
        const overlap = Math.min(end, sEnd) - Math.max(start, s.rangeStart);
        if (overlap > 1e-9) {
          const sessDeliv = hours > 0 ? delivered * (overlap / hours) : 0;
          r.lessons.push({ session_no: s.session_no, title: s.title, focus: s.focus, hours: round1(overlap) });
          s.plannedHours += overlap;
          s.deliveredHours += sessDeliv;
          if (!s.firstDate) s.firstDate = r.sdate;
          if (s.lastDate !== r.sdate) s.days++;
          s.lastDate = r.sdate;
          if (weekNo) {
            if (!s.weeklyHours[weekNo]) s.weeklyHours[weekNo] = { planned: 0, delivered: 0 };
            s.weeklyHours[weekNo].planned = round1(s.weeklyHours[weekNo].planned + overlap);
            s.weeklyHours[weekNo].delivered = round1(s.weeklyHours[weekNo].delivered + sessDeliv);
          }
        }
      }
    }
  }

  // Finalize month totals in ganttMonths
  const monthByKey = {};
  ganttMonths.forEach(gm => { monthByKey[gm.monthKey] = gm; });
  ganttWeeks.forEach(w => {
    if (monthByKey[w.monthKey]) {
      monthByKey[w.monthKey].plannedHours = round1(monthByKey[w.monthKey].plannedHours + w.plannedHours);
      monthByKey[w.monthKey].deliveredHours = round1(monthByKey[w.monthKey].deliveredHours + w.deliveredHours);
    }
  });

  modules.forEach(m => {
    delete m._cursor;
    m.tasks = Array.from(m._taskMap.values());
    delete m._taskMap;
    m.plannedHours = round1(m.plannedHours);
    m.deliveredHours = round1(m.deliveredHours);
    Object.values(m.weeklyHours).forEach(wh => { delete wh.lastDate; });
    m.sessions.forEach(s => {
      s.plannedHours = round1(s.plannedHours);
      s.deliveredHours = round1(s.deliveredHours);
      delete s.rangeStart; delete s.rangeEnd;
    });
  });

  // ── Day-by-day schedule ──
  let cumulative = 0;
  let cumulativeDelivered = 0;
  const days = [];
  for (const [date, rows] of Object.entries(rowsByDate)) {
    const dayTotal = rows.reduce((a, r) => a + (Number(r.hours) || 0), 0);
    const delivered = rows.reduce((a, r) => a + (r.delivered || 0), 0);
    cumulative += dayTotal;
    cumulativeDelivered += delivered;
    if ((from && date < from) || (to && date > to)) continue;
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const p = pattern[dow === 0 ? 7 : dow] || {};
    const log = dayLog[date];
    days.push({
      date,
      day: DAY_EN[dow],
      time: p.start && p.end ? `${p.start} – ${p.end}` : '',
      hours: round1(dayTotal),
      cumulative: round1(cumulative),
      delivered: round1(delivered),
      cumulativeDelivered: round1(cumulativeDelivered),
      status: log ? log.status : null,
      rows: rows.map(r => {
        const m = modById[r.module_id];
        return {
          module_id: r.module_id,
          module_code: m ? m.code : '',
          module_title: m ? m.title : '',
          task_code: r.task_code, task_title: r.task_title,
          hours: Number(r.hours) || 0,
          lessons: r.lessons
        };
      })
    });
  }

  const totalPlanned = round1(planRows.reduce((a, r) => a + (Number(r.hours) || 0), 0));
  const totalDelivered = round1(planRows.reduce((a, r) => a + (r.delivered || 0), 0));
  const today = new Date().toISOString().slice(0, 10);
  const plannedToDate = round1(planRows.filter(r => r.sdate <= today).reduce((a, r) => a + (Number(r.hours) || 0), 0));
  const teachingDays = Object.keys(rowsByDate).length;

  return {
    batch, settings, version,
    pattern: patternRows.map(p => ({ weekday: p.weekday, hours: Number(p.hours) || 0, start_time: fmtTime(p.start_time), end_time: fmtTime(p.end_time) })),
    weeklyHours,
    modules,
    days,
    gantt: {
      months: ganttMonths,
      weeks: ganttWeeks
    },
    totals: {
      curriculumHours: modules.reduce((a, m) => a + m.total_hours, 0),
      planned: totalPlanned,
      delivered: totalDelivered,
      plannedToDate,
      teachingDays,
      startDate: planRows.length ? planRows[0].sdate : batch.start_date,
      endDate: planRows.length ? planRows[planRows.length - 1].sdate : null
    }
  };
}

module.exports = { ensureLessonTables, getContentMap, saveModuleContent, buildLessonPlan, getSettings, splitHours };
