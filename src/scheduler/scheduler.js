'use strict';
/**
 * Lesson plan scheduler (pure functions, no database, no dependencies).
 * Dates are 'YYYY-MM-DD' strings. Hours are handled internally as half-hours (integers)
 * so there are no floating point errors.
 */

const pad = (n) => String(n).padStart(2, '0');
const parse = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const fmt = (ms) => { const t = new Date(ms); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const addDays = (d, n) => fmt(parse(d) + n * 86400000);
const weekday = (d) => { const w = new Date(parse(d)).getUTCDay(); return w === 0 ? 7 : w; }; // 1=Mon..7=Sun

function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(day, last))}`;
}

/** Split an integer total across weights (largest remainder method). Sum is always exact. */
function splitByWeights(total, weights) {
  let w = weights.slice();
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) { w = w.map(() => 1); sum = w.length; }
  const raw = w.map((x) => (total * x) / sum);
  const base = raw.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < left; k++) base[order[k].i]++;
  return base;
}

/**
 * modules: [{moduleId, code, hours, tasks:[{taskId, weight}]}]  (already in teaching order)
 * alreadyDone: {moduleId: hours}
 * Returns work units in order: [{moduleId, taskId|null, half}]
 */
function buildUnits(modules, alreadyDone = {}) {
  const units = [];
  for (const m of modules) {
    const remaining = Math.round((m.hours - (alreadyDone[m.moduleId] || 0)) * 2);
    if (remaining <= 0) continue;
    if (!m.tasks || m.tasks.length === 0) {
      units.push({ moduleId: m.moduleId, taskId: null, half: remaining });
    } else {
      const parts = splitByWeights(remaining, m.tasks.map((t) => t.weight));
      m.tasks.forEach((t, i) => { if (parts[i] > 0) units.push({ moduleId: m.moduleId, taskId: t.taskId, half: parts[i] }); });
    }
  }
  return units;
}

/** Capacity of a date in half-hours. weekPattern: {1:6,2:6,...}; offDates: Set; extra: {date: hours} */
function capacityHalf(date, weekPattern, offDates, extra = {}) {
  const base = offDates.has(date) ? 0 : Math.round((weekPattern[weekday(date)] || 0) * 2);
  return base + Math.round((extra[date] || 0) * 2);
}

function fill(units, startDate, weekPattern, offDates, extra = {}, maxDays = 3000) {
  const q = units.map((u) => ({ ...u }));
  const sessions = [];
  let qi = 0;
  let date = startDate;
  for (let n = 0; n < maxDays && qi < q.length; n++, date = addDays(date, 1)) {
    let cap = capacityHalf(date, weekPattern, offDates, extra);
    let seq = 0;
    while (cap > 0 && qi < q.length) {
      const u = q[qi];
      const take = Math.min(cap, u.half);
      const last = sessions[sessions.length - 1];
      if (last && last.date === date && last.moduleId === u.moduleId && last.taskId === u.taskId) {
        last.hours += take / 2;
      } else {
        sessions.push({ date, seq: ++seq, moduleId: u.moduleId, taskId: u.taskId, hours: take / 2 });
      }
      u.half -= take; cap -= take;
      if (u.half === 0) qi++;
    }
  }
  if (qi < q.length) throw new Error('Not enough teaching days found (check week pattern).');
  return sessions;
}

function monthIndex(date, startDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  let idx = (y - sy) * 12 + (m - sm);
  if (d < sd) idx -= 1;
  return idx;
}

function summarize(sessions, opts) {
  const { startDate, plannedMonths = 6, targetPerMonth = 120, monthMode = 'batch', holidayYears = null } = opts;
  const byKey = new Map();
  for (const s of sessions) {
    const key = monthMode === 'calendar' ? s.date.slice(0, 7) : `B${monthIndex(s.date, startDate) + 1}`;
    byKey.set(key, (byKey.get(key) || 0) + s.hours);
  }
  const keys = [...byKey.keys()];
  const endDate = sessions.length ? sessions[sessions.length - 1].date : null;
  let cumulative = 0;
  const months = keys.map((key, i) => {
    let from, to;
    if (monthMode === 'calendar') { from = `${key}-01`; to = fmt(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)); }
    else { const n = Number(key.slice(1)) - 1; from = addMonths(startDate, n); to = addDays(addMonths(startDate, n + 1), -1); }
    const hours = byKey.get(key);
    cumulative += hours;
    const cumulativeTarget = targetPerMonth * (i + 1);
    const laterExists = i < keys.length - 1;
    // Judge progress on the running total: a long month can cover a short one.
    const behindBy = laterExists && cumulative < cumulativeTarget ? cumulativeTarget - cumulative : 0;
    return { key, from, to, hours, target: targetPerMonth, cumulative, cumulativeTarget, behindBy };
  });
  const warnings = [];
  for (const m of months) if (m.behindBy > 0) warnings.push({ code: 'BEHIND_TARGET', month: m.key, behindBy: m.behindBy });
  const plannedEnd = addDays(addMonths(startDate, plannedMonths), -1);
  if (endDate && endDate > plannedEnd) warnings.push({ code: 'ENDS_AFTER_PLANNED', endDate, plannedEnd });
  if (holidayYears && sessions.length) {
    const years = new Set(sessions.map((s) => Number(s.date.slice(0, 4))));
    for (const y of years) if (!holidayYears.includes(y)) warnings.push({ code: 'MISSING_HOLIDAYS_YEAR', year: y });
  }
  return { totalHours: sessions.reduce((a, s) => a + s.hours, 0), endDate, plannedEnd, months, warnings };
}

/**
 * Generate the initial plan.
 * input: {startDate, weekPattern, holidays:[dates that are OFF], modules, alreadyDone,
 *         plannedMonths, targetPerMonth, monthMode, holidayYears}
 */
function generatePlan(input) {
  const off = new Set(input.holidays || []);
  const units = buildUnits(input.modules, input.alreadyDone);
  const sessions = fill(units, input.startDate, input.weekPattern, off, input.extraHours || {});
  return { sessions, summary: summarize(sessions, input) };
}

/**
 * Re-plan after a disrupted day.
 * input: {sessions (current plan), disruptedDate, hoursDelivered (0 if none), weekPattern, holidays,
 *         strategy:'shift'|'makeup', extraHours:{date:hours}, extraPerDay:{days:N, hours:h}, plus summary options}
 * Sessions before disruptedDate are never changed.
 */
function replan(input) {
  const { sessions, disruptedDate, hoursDelivered = 0, weekPattern, startDate } = input;
  const off = new Set(input.holidays || []);
  const past = sessions.filter((s) => s.date < disruptedDate);
  const dayRows = sessions.filter((s) => s.date === disruptedDate).sort((a, b) => a.seq - b.seq);
  const future = sessions.filter((s) => s.date > disruptedDate);

  let deliveredHalf = Math.round(hoursDelivered * 2);
  const kept = [];
  const queue = [];
  for (const s of dayRows) {
    const h = Math.round(s.hours * 2);
    const d = Math.min(deliveredHalf, h);
    if (d > 0) kept.push({ ...s, hours: d / 2 });
    deliveredHalf -= d;
    if (h - d > 0) queue.push({ moduleId: s.moduleId, taskId: s.taskId, half: h - d });
  }
  for (const s of future) {
    const last = queue[queue.length - 1];
    const h = Math.round(s.hours * 2);
    if (last && last.moduleId === s.moduleId && last.taskId === s.taskId) last.half += h;
    else queue.push({ moduleId: s.moduleId, taskId: s.taskId, half: h });
  }
  const hoursLost = dayRows.reduce((a, s) => a + s.hours, 0) - kept.reduce((a, s) => a + s.hours, 0);

  let extra = { ...(input.extraHours || {}) };
  if (input.strategy === 'makeup' && input.extraPerDay) {
    let date = addDays(disruptedDate, 1), n = 0, guard = 0;
    while (n < input.extraPerDay.days && guard++ < 400) {
      if (capacityHalf(date, weekPattern, off) > 0) { extra[date] = (extra[date] || 0) + input.extraPerDay.hours; n++; }
      date = addDays(date, 1);
    }
  }
  const tail = fill(queue, addDays(disruptedDate, 1), weekPattern, off, extra);
  // keep numbering of seq inside kept rows
  const newSessions = [...past, ...kept, ...tail];
  const oldEnd = sessions.length ? sessions[sessions.length - 1].date : null;
  return {
    sessions: newSessions,
    hoursLost,
    oldEndDate: oldEnd,
    newEndDate: newSessions[newSessions.length - 1].date,
    summary: summarize(newSessions, { ...input, startDate }),
  };
}

module.exports = { generatePlan, replan, summarize, buildUnits, splitByWeights, capacityHalf, addDays, addMonths, weekday, monthIndex };
