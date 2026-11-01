'use strict';
/**
 * Teacher (instructor) daily attendance — In / Out times.
 *
 * Used by the "My Attendance" page and by the monthly report, where
 * page 2 columns "ගත කළ කාලය" (time) and "ගතවූ පැය ගණන" (hours) are filled
 * from these records instead of a static value.
 */
const db = require('../db');

/** Max hours counted for one day on the official form */
const DAILY_HOURS_CAP = 6.5;
const TZ = 'Asia/Colombo';

let ensured = false;
async function ensureTeacherAttendanceTable() {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      adate DATE NOT NULL UNIQUE,
      time_in TIME NULL,
      time_out TIME NULL,
      note VARCHAR(255) NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'manual',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  ensured = true;
}

/** 'HH:MM[:SS]' → minutes since midnight (null if invalid) */
function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 'HH:MM:SS' → 'HH:MM' */
function hhmm(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** Actual worked hours between in & out (1 decimal), null if incomplete */
function workedHours(timeIn, timeOut) {
  const a = toMinutes(timeIn);
  const b = toMinutes(timeOut);
  if (a === null || b === null || b <= a) return null;
  return Math.round(((b - a) / 60) * 10) / 10;
}

/** Hours to show on the report: actual if below 6.5, otherwise 6.5 */
function countedHours(timeIn, timeOut) {
  const w = workedHours(timeIn, timeOut);
  if (w === null) return null;
  return Math.min(DAILY_HOURS_CAP, w);
}

/** Decorate a DB row with display fields */
function decorate(row) {
  const time_in = hhmm(row.time_in);
  const time_out = hhmm(row.time_out);
  return {
    id: row.id,
    date: row.adate,
    time_in,
    time_out,
    note: row.note || '',
    source: row.source,
    worked_hours: workedHours(time_in, time_out),
    counted_hours: countedHours(time_in, time_out),
    time_text: time_in && time_out ? `${time_in} - ${time_out}` : (time_in ? `${time_in} -` : (time_out ? `- ${time_out}` : ''))
  };
}

async function getRange(from, to) {
  await ensureTeacherAttendanceTable();
  const [rows] = await db.query(
    'SELECT * FROM teacher_attendance WHERE adate >= ? AND adate <= ? ORDER BY adate ASC',
    [from, to]
  );
  return rows.map(decorate);
}

/** Map of 'YYYY-MM-DD' → decorated record */
async function getRangeMap(from, to) {
  const list = await getRange(from, to);
  const map = {};
  list.forEach(r => { map[r.date] = r; });
  return map;
}

/** Map of 'YYYY-MM-DD' → { name, type } for all holidays (is_off=1) and teacher_absent/institute_closed days */
async function getOffDaysMap(from, to) {
  const [holRows] = await db.query(
    'SELECT hdate, name, type FROM holidays WHERE is_off = 1 AND hdate >= ? AND hdate <= ? ORDER BY hdate ASC',
    [from, to]
  );
  const [logRows] = await db.query(
    "SELECT ldate, status, reason FROM day_log WHERE ldate >= ? AND ldate <= ? AND status IN ('teacher_absent', 'institute_closed') ORDER BY ldate ASC",
    [from, to]
  );
  const map = {};
  logRows.forEach(d => {
    map[d.ldate] = {
      name: d.reason || (d.status === 'teacher_absent' ? 'Instructor Absent' : 'Institute Closed'),
      type: d.status
    };
  });
  holRows.forEach(h => {
    map[h.hdate] = { name: h.name, type: h.type };
  });
  return map;
}

/** Current Sri Lanka date & time (server may run in UTC) */
function nowLocal() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  fmt.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

module.exports = {
  DAILY_HOURS_CAP,
  ensureTeacherAttendanceTable,
  toMinutes,
  hhmm,
  workedHours,
  countedHours,
  decorate,
  getRange,
  getRangeMap,
  getOffDaysMap,
  nowLocal
};
