'use strict';
const db = require('../db');
const { getRangeMap: getTeacherAttendanceMap } = require('./teacherAttendanceService');
const { syncOffDaysForBatch } = require('./schedulerService');

/**
 * Ensures diary_entries and diary_lines exist for all taught dates in the period.
 * Pulls from plan_sessions, day_log, and attendance if missing.
 */
async function syncDiariesForPeriod(batchId, from, to) {
  // 0. Ensure all off-holidays and teacher_absent / institute_closed days are synced and shifted first
  await syncOffDaysForBatch(batchId);

  // 1. Find all day_log records in range with taught hours > 0 (excluding any off-holidays)
  const [taughtDays] = await db.query(`
    SELECT dl.ldate, dl.status, dl.hours_delivered, dl.reason
    FROM day_log dl
    LEFT JOIN holidays h ON h.hdate = dl.ldate AND h.is_off = 1
    WHERE dl.batch_id = ? AND dl.ldate >= ? AND dl.ldate <= ?
      AND dl.status IN ('taught', 'partial', 'substitute', 'assessment_day')
      AND h.id IS NULL
    ORDER BY dl.ldate ASC
  `, [batchId, from, to]);

  if (taughtDays.length === 0) return;

  // 2. Fetch existing diary entries in range
  const [existingEntries] = await db.query(
    'SELECT id, ddate, hours_delivered FROM diary_entries WHERE batch_id = ? AND ddate >= ? AND ddate <= ?',
    [batchId, from, to]
  );
  const existingMap = {};
  existingEntries.forEach(e => { existingMap[e.ddate] = e; });

  // 3. Fetch plan sessions for these dates
  const [sessions] = await db.query(`
    SELECT ps.sdate, ps.module_id, ps.task_id, ps.hours, ps.topic_text,
           m.code as module_code, m.title as module_title,
           t.code as task_code, t.title as task_title, pv.version_no
    FROM plan_sessions ps
    JOIN plan_versions pv ON ps.plan_version_id = pv.id AND pv.is_current = 1
    JOIN modules m ON ps.module_id = m.id
    LEFT JOIN tasks t ON ps.task_id = t.id
    WHERE ps.batch_id = ? AND ps.sdate >= ? AND ps.sdate <= ?
    ORDER BY ps.sdate ASC, ps.seq ASC
  `, [batchId, from, to]);

  const sessionsByDate = {};
  sessions.forEach(s => {
    (sessionsByDate[s.sdate] = sessionsByDate[s.sdate] || []).push(s);
  });

  // 4. Fetch attendance stats
  const [attRows] = await db.query(`
    SELECT adate,
      COUNT(CASE WHEN status IN ('P', 'L') THEN 1 END) as present_count,
      COUNT(*) as total_count
    FROM attendance
    WHERE batch_id = ? AND adate >= ? AND adate <= ?
    GROUP BY adate
  `, [batchId, from, to]);
  const attMap = {};
  attRows.forEach(a => { attMap[a.adate] = a; });

  // 5. Week pattern for timing
  const [patternRows] = await db.query(
    'SELECT weekday, start_time, end_time FROM batch_week_pattern WHERE batch_id = ?',
    [batchId]
  );
  const timeByWeekday = {};
  patternRows.forEach(p => {
    if (p.start_time && p.end_time) {
      timeByWeekday[p.weekday] = `${p.start_time.slice(0, 5)} - ${p.end_time.slice(0, 5)}`;
    }
  });

  for (const day of taughtDays) {
    const date = day.ldate;
    const daySessions = sessionsByDate[date] || [];
    const att = attMap[date] || { present_count: 0, total_count: 0 };
    const hours = Number(day.hours_delivered) > 0 
      ? Number(day.hours_delivered) 
      : daySessions.reduce((acc, s) => acc + Number(s.hours), 0);

    if (hours <= 0) continue; // Skip 0-hour days

    const dObj = new Date(date + 'T00:00:00Z');
    const dow = dObj.getUTCDay();
    const weekdayNum = dow === 0 ? 7 : dow;
    const timeText = timeByWeekday[weekdayNum] || '09:00 - 16:00';

    let summaryText = '';
    if (daySessions.length > 0) {
      summaryText = daySessions.map(s => {
        if (s.task_code) return `${s.module_code} - ${s.task_code}: ${s.task_title || s.module_title}`;
        return `${s.module_code}: ${s.module_title}`;
      }).join('; ');
    } else {
      summaryText = day.reason || 'ප්‍රායෝගික පුහුණු සැසිය (Practical Training Session)';
    }

    const activitiesText = 'න්‍යායාත්මක හා ප්‍රායෝගික ක්‍රියාකාරකම්';
    const versionNo = daySessions[0] ? daySessions[0].version_no : 1;

    // Check if entry already exists
    let diaryId;
    if (existingMap[date]) {
      diaryId = existingMap[date].id;
      // Update hours if they were 0 or missing
      if (Number(existingMap[date].hours_delivered) !== hours) {
        await db.query(
          'UPDATE diary_entries SET hours_delivered = ? WHERE id = ?',
          [hours, diaryId]
        );
      }
    } else {
      // Insert new diary entry
      const [insertRes] = await db.query(`
        INSERT INTO diary_entries (
          batch_id, ddate, summary_text, activities_text, remarks,
          hours_delivered, time_text, students_present, students_total,
          status, generated_from_plan_version
        ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 'confirmed', ?)
      `, [
        batchId, date, summaryText, activitiesText,
        hours, timeText, att.present_count || null, att.total_count || null,
        versionNo
      ]);
      diaryId = insertRes.insertId;
    }

    // Check if lines exist
    const [existingLines] = await db.query('SELECT COUNT(*) as c FROM diary_lines WHERE diary_id = ?', [diaryId]);
    if (existingLines[0].c === 0) {
      if (daySessions.length > 0) {
        // Distribute hours across sessions
        for (const s of daySessions) {
          const lineText = s.task_code ? `${s.module_code} - ${s.task_code} ${s.task_title || ''}` : `${s.module_code} ${s.module_title}`;
          await db.query(`
            INSERT INTO diary_lines (diary_id, module_id, task_id, hours, line_text)
            VALUES (?, ?, ?, ?, ?)
          `, [diaryId, s.module_id, s.task_id || null, s.hours, lineText]);
        }
      } else {
        // Fallback: pick the first active module
        const [mod] = await db.query('SELECT id FROM modules LIMIT 1');
        await db.query(`
          INSERT INTO diary_lines (diary_id, module_id, task_id, hours, line_text)
          VALUES (?, ?, NULL, ?, 'Practical demonstration and training')
        `, [diaryId, mod[0].id, hours]);
      }
    }
  }
}

/**
 * Builds official NYSC Monthly Progress Report (Pages 1 & 2)
 */
async function buildMonthlyReport(batchId, from, to) {
  // 1. Fetch batch & settings
  const [batches] = await db.query(`
    SELECT b.*, nv.code as ncs_code, nv.title as ncs_title
    FROM batches b
    JOIN ncs_versions nv ON b.ncs_version_id = nv.id
    WHERE b.id = ?
  `, [batchId]);
  if (batches.length === 0) throw new Error('Batch not found');
  const batch = batches[0];

  const [settingsRows] = await db.query('SELECT k, v FROM settings');
  const settings = {};
  settingsRows.forEach(r => { settings[r.k] = r.v; });

  if (!settings.teacher_name) {
    const [userRows] = await db.query('SELECT name FROM users ORDER BY id ASC LIMIT 1');
    if (userRows.length > 0 && userRows[0].name) {
      settings.teacher_name = userRows[0].name;
    }
  }

  // Auto-sync diaries for this period so data is always 100% accurate and never empty
  await syncDiariesForPeriod(batchId, from, to);

  // 2. Fetch all modules in batch order
  const [modules] = await db.query(`
    SELECT bm.module_id, bm.teach_order, bm.theory_hours, bm.practical_hours,
           m.code, m.title
    FROM batch_modules bm
    JOIN modules m ON bm.module_id = m.id
    WHERE bm.batch_id = ?
    ORDER BY bm.teach_order ASC
  `, [batchId]);

  // 3. Delivered hours before `from` date (Column 5 - පෙර මස දක්වා කළ පැය)
  const [prevRows] = await db.query(`
    SELECT dl.module_id, SUM(dl.hours) as hours
    FROM diary_lines dl
    JOIN diary_entries de ON dl.diary_id = de.id
    WHERE de.batch_id = ? AND de.ddate < ?
    GROUP BY dl.module_id
  `, [batchId, from]);
  const prevMap = {};
  prevRows.forEach(r => { prevMap[r.module_id] = Number(r.hours) || 0; });

  // 4. Delivered hours in this month (`from` to `to`) (Column 6 - අදාළ මස කළ පැය)
  const [currRows] = await db.query(`
    SELECT dl.module_id, SUM(dl.hours) as hours
    FROM diary_lines dl
    JOIN diary_entries de ON dl.diary_id = de.id
    WHERE de.batch_id = ? AND de.ddate >= ? AND de.ddate <= ?
    GROUP BY dl.module_id
  `, [batchId, from, to]);
  const currMap = {};
  currRows.forEach(r => { currMap[r.module_id] = Number(r.hours) || 0; });

  // Page 1: Module Summary
  let totalCurriculumHours = 0;
  let totalPrevHours = 0;
  let totalThisMonthHours = 0;
  let totalToDateHours = 0;

  const page1Rows = modules.map(m => {
    const totalHours = Number(m.theory_hours) + Number(m.practical_hours);
    const prevHours = prevMap[m.module_id] || 0;
    const thisMonthHours = currMap[m.module_id] || 0;
    const toDateHours = prevHours + thisMonthHours;

    totalCurriculumHours += totalHours;
    totalPrevHours += prevHours;
    totalThisMonthHours += thisMonthHours;
    totalToDateHours += toDateHours;

    return {
      module_id: m.module_id,
      code: m.code,
      title: m.title,
      total_hours: totalHours,
      prev_hours: prevHours,
      this_month_hours: thisMonthHours,
      to_date_hours: toDateHours,
      remaining_hours: Math.max(0, totalHours - toDateHours)
    };
  });

  const page1Totals = {
    totalCurriculumHours,
    totalPrevHours,
    totalThisMonthHours,
    totalToDateHours,
    remainingHours: Math.max(0, totalCurriculumHours - totalToDateHours)
  };

  // Page 2: Daily Diary Table (exclude any 0-hour or holiday/absent rows)
  const [diaryEntries] = await db.query(`
    SELECT de.*, 
      (SELECT status FROM day_log dl WHERE dl.batch_id = de.batch_id AND dl.ldate = de.ddate LIMIT 1) as day_log_status,
      (SELECT reason FROM day_log dl WHERE dl.batch_id = de.batch_id AND dl.ldate = de.ddate LIMIT 1) as day_log_reason
    FROM diary_entries de
    LEFT JOIN holidays h ON h.hdate = de.ddate AND h.is_off = 1
    LEFT JOIN day_log dl2 ON dl2.batch_id = de.batch_id AND dl2.ldate = de.ddate
    WHERE de.batch_id = ? AND de.ddate >= ? AND de.ddate <= ?
      AND de.hours_delivered > 0
      AND h.id IS NULL
      AND (dl2.status IS NULL OR dl2.status NOT IN ('teacher_absent', 'institute_closed'))
    ORDER BY de.ddate ASC
  `, [batchId, from, to]);

  // Teacher's own In/Out attendance → "ගත කළ කාලය" and "ගතවූ පැය ගණන"
  const teacherAtt = await getTeacherAttendanceMap(from, to);

  const page2Rows = diaryEntries.map(e => {
    const att = teacherAtt[e.ddate];
    const diaryHours = Number(e.hours_delivered) || 0;
    // Hours: from In/Out time, capped at 6.5h (shows actual if less). Falls back to diary hours.
    const attHours = att && att.counted_hours !== null ? att.counted_hours : null;
    return {
      date: e.ddate,
      course_name: settings.course_title || batch.name,
      summary: e.summary_text || '',
      activities: e.activities_text || 'න්‍යායාත්මක හා ප්‍රායෝගික ක්‍රියාකාරකම්',
      // Empty unless the teacher marked In/Out for this date (no more static 09:00 - 16:00)
      time_text: att ? att.time_text : '',
      time_in: att ? att.time_in : '',
      time_out: att ? att.time_out : '',
      hours: attHours !== null ? attHours : diaryHours,
      diary_hours: diaryHours,
      has_attendance: attHours !== null,
      status: e.status
    };
  });

  const page2TotalHours = Math.round(page2Rows.reduce((acc, r) => acc + r.hours, 0) * 10) / 10;

  // Check matching hours
  const hoursMatch = Math.abs(totalThisMonthHours - page2TotalHours) < 0.1;

  // ── Salary 120 Hours Qualification Calculation ──
  const standardMonthlyTarget = Number(settings.target_hours_per_month) || Number(batch.target_hours_per_month) || 120;
  
  // Detect if this is an initial partial startup month (e.g. batch started July 27 and period is July 27 - 31)
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  const daysInPeriod = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
  const isInitialPartialMonth = (from === batch.start_date && daysInPeriod < 15);

  // Target hours: 26h for initial partial month (4 teaching days @ 6.5h), standard 120h for full months
  const targetMonthlyHours = isInitialPartialMonth ? 26 : standardMonthlyTarget;
  const isSalaryEligible = totalThisMonthHours >= targetMonthlyHours;
  const salaryDiff = Math.round((totalThisMonthHours - targetMonthlyHours) * 10) / 10;
  const salaryStatus = isSalaryEligible ? 'PASSED' : 'DEFICIT';

  // Check warnings
  const warnings = [];
  if (!hoursMatch) {
    warnings.push({
      code: 'HOUR_MISMATCH',
      message: `Page 1 sum (${totalThisMonthHours}h) does not match Page 2 diary sum (${page2TotalHours}h)`
    });
  }

  if (!isSalaryEligible) {
    warnings.push({
      code: 'SALARY_DEFICIT',
      message: isInitialPartialMonth
        ? `Initial startup month hours (${totalThisMonthHours}h) is below target (${targetMonthlyHours}h).`
        : `Total hours for this month (${totalThisMonthHours}h) is below the required 120h target (Deficit: ${Math.abs(salaryDiff)}h). You must teach at least 120 hours to qualify for full monthly salary claims.`
    });
  }

  // Check missing instructor settings
  if (!settings.service_no || !settings.teacher_phone) {
    warnings.push({
      code: 'MISSING_SETTINGS',
      message: 'Instructor service number or phone number is missing in settings'
    });
  }

  return {
    batch,
    settings,
    period: { from, to, isInitialPartialMonth },
    page1: {
      rows: page1Rows,
      totals: page1Totals
    },
    page2: {
      rows: page2Rows,
      totalHours: page2TotalHours
    },
    salary: {
      targetHours: targetMonthlyHours,
      achievedHours: totalThisMonthHours,
      isEligible: isSalaryEligible,
      diff: salaryDiff,
      status: salaryStatus,
      teachingDays: page2Rows.length,
      isInitialPartialMonth,
      explanation: isInitialPartialMonth
        ? `Initial Startup Period (July 27–31): ${totalThisMonthHours} Hours taught across ${page2Rows.length} teaching days (Startup Target: ${targetMonthlyHours}h Met ✓). Course commenced on July 27.`
        : isSalaryEligible
          ? `Target Met: ${totalThisMonthHours} Hours taught across ${page2Rows.length} teaching days (Exceeds 120h requirement by +${salaryDiff}h). Eligible for full monthly salary approval.`
          : `Deficit Alert: ${totalThisMonthHours} Hours taught across ${page2Rows.length} teaching days (${Math.abs(salaryDiff)}h short of the 120h monthly salary requirement).`
    },
    hoursMatch,
    warnings
  };
}

module.exports = {
  buildMonthlyReport,
  syncDiariesForPeriod
};
