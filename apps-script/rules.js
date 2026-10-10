/**
 * Apollo rules.
 *
 * Pure functions only: no Apps Script globals, no Date objects for date math.
 * Dates are 'YYYY-MM-DD' strings and all math is on year/month/day numbers.
 *
 * This file is used in two places:
 *   - pasted into the workbook's Apps Script project, where every top-level
 *     function is a global that Code.js calls;
 *   - loaded by Node for the unit tests via the module.exports at the bottom.
 */

var SUMMARY_HEADERS = [
  'Task ID',
  'Task Name',
  'Last Accomplished',
  'Due Date',
  'Overdue',
  'Volume Accomplished',
  'Volume Required',
  'Percent Complete',
  'Remaining Sim Credit'
];

var CHECK_LABEL = 'CHECK LABEL';

/** An interval longer than this is a typo, not a requirement: the label shows CHECK LABEL. */
var MAX_INTERVAL_YEARS = 100;

// ---------------------------------------------------------------------------
// Date arithmetic on {y, m, d}
// ---------------------------------------------------------------------------

function parseDate(str) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str == null ? '' : str).trim());
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y: y, m: mo, d: d };
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDate(ymd) {
  return ymd.y + '-' + pad2(ymd.m) + '-' + pad2(ymd.d);
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days from a fixed epoch, for adding days without a Date object. */
function dayNumber(ymd) {
  var y = ymd.y, m = ymd.m, d = ymd.d;
  // Proleptic Gregorian day count (algorithm from Howard Hinnant's days_from_civil).
  y -= m <= 2 ? 1 : 0;
  var era = Math.floor(y / 400);
  var yoe = y - era * 400;
  var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

function fromDayNumber(n) {
  var era = Math.floor(n / 146097);
  var doe = n - era * 146097;
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  var m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
}

function addDays(ymd, n) {
  return fromDayNumber(dayNumber(ymd) + n);
}

/** Months since year 0, so month arithmetic is plain integer arithmetic. */
function monthIndex(ymd) {
  return ymd.y * 12 + ymd.m - 1;
}

/** The last day of the month with that index. Every due date ends on a month end. */
function monthEnd(index) {
  var y = Math.floor(index / 12);
  var m = index - y * 12 + 1;
  return { y: y, m: m, d: daysInMonth(y, m) };
}

// ---------------------------------------------------------------------------
// Fiscal year and periods
// ---------------------------------------------------------------------------

/** FY runs 1 Oct to 30 Sep and is named for the year it ends in. */
function fiscalYear(ymd) {
  return ymd.m >= 10 ? ymd.y + 1 : ymd.y;
}

function fiscalYearEnd(fy) {
  return { y: fy, m: 9, d: 30 };
}

/**
 * Last day of the period after the one containing ymd.
 * monthsPerPeriod is 1 (Monthly), 3 (Quarterly) or 6 (Semi-Annual).
 * Periods are aligned to the fiscal year, so quarters are Oct-Dec, Jan-Mar,
 * Apr-Jun, Jul-Sep and halves are Oct-Mar, Apr-Sep.
 */
function endOfNextPeriod(ymd, monthsPerPeriod) {
  // Count months with October as month 0 so periods line up with the FY.
  var shifted = monthIndex(ymd) - 9;
  var periodStart = shifted - (((shifted % monthsPerPeriod) + monthsPerPeriod) % monthsPerPeriod);
  return monthEnd(periodStart + monthsPerPeriod * 2 - 1 + 9);
}

// ---------------------------------------------------------------------------
// Frequency / Currency labels
// ---------------------------------------------------------------------------

/**
 * Classify a Frequency / Currency label.
 * Returns { kind, n } where kind is one of:
 *   'period'  n = months per period (1, 3, 6)
 *   'fy'      n = fiscal years to add
 *   'months'  n = months to add
 *   'days'    n = days to add
 *   'none'    no due date
 *   'unknown' unrecognized label
 */
function classifyLabel(label) {
  var s = String(label == null ? '' : label).trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return { kind: 'none' };
  if (s === 'monthly') return { kind: 'period', n: 1 };
  if (s === 'quarterly') return { kind: 'period', n: 3 };
  if (s === 'semi-annual' || s === 'semiannual' || s === 'semi annual') return { kind: 'period', n: 6 };
  if (s === 'annual') return { kind: 'fy', n: 1 };
  if (s === 'biennial') return { kind: 'fy', n: 2 };
  if (s === 'triennial') return { kind: 'fy', n: 3 };
  if (s === 'pcs' || s === 'as required' || s === 'n/a') return { kind: 'none' };
  var m = /^(\d+) ?(years?|months?|days?)$/.exec(s);
  if (!m) return { kind: 'unknown' };
  var n = Number(m[1]);
  var unit = m[2].charAt(0);
  var perYear = unit === 'y' ? 1 : unit === 'm' ? 12 : 365;
  if (n > MAX_INTERVAL_YEARS * perYear) return { kind: 'unknown' };
  return { kind: unit === 'y' ? 'fy' : unit === 'm' ? 'months' : 'days', n: n };
}

/** True when the label is one that yields a due date. */
function labelProducesDueDates(label) {
  var kind = classifyLabel(label).kind;
  return kind !== 'none' && kind !== 'unknown';
}

/**
 * Due date for a label given the last accomplished date ('YYYY-MM-DD').
 * Returns 'YYYY-MM-DD', '' for no due date, or 'CHECK LABEL'.
 */
function dueDate(label, lastAccomplished) {
  var c = classifyLabel(label);
  if (c.kind === 'unknown') return CHECK_LABEL;
  if (c.kind === 'none') return '';
  var last = parseDate(lastAccomplished);
  if (!last) return '';
  switch (c.kind) {
    case 'period':
      return formatDate(endOfNextPeriod(last, c.n));
    case 'fy':
      return formatDate(fiscalYearEnd(fiscalYear(last) + c.n));
    // ARMS computes every interval to the last day of the month (confirmed against
    // SARM due dates for 6, 24 and 48 Months and 365 Days on 2026-10-09).
    case 'months':
      return formatDate(monthEnd(monthIndex(last) + c.n));
    case 'days':
      return formatDate(monthEnd(monthIndex(addDays(last, c.n))));
  }
  return CHECK_LABEL;
}

// ---------------------------------------------------------------------------
// Due Date colors
// ---------------------------------------------------------------------------

/**
 * Display only: no rule lives here. The sheet's conditional formatting and the
 * API's band field are both built from this list. First match wins.
 */
var DUE_BANDS = [
  { band: 'overdue', background: '#666666', fontColor: '#FFFFFF' },
  { band: 'd30', days: 30, background: '#EA9999' },
  { band: 'd60', days: 60, background: '#F9CB9C' },
  { band: 'd90', days: 90, background: '#FFF2CC' }
];

/** The band for a summary row on a given day: 'overdue', 'd30', 'd60', 'd90' or ''. */
function dueBand(row, today) {
  if (row['Overdue'] === 'YES') return 'overdue';
  var due = parseDate(row['Due Date']);
  var day = parseDate(today);
  if (!due || !day) return '';
  var days = dayNumber(due) - dayNumber(day);
  for (var i = 1; i < DUE_BANDS.length; i++) {
    if (days <= DUE_BANDS[i].days) return DUE_BANDS[i].band;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Config values and log rows
// ---------------------------------------------------------------------------

/** 'ground' (blank), 'sim' (SIM, trimmed, any case) or 'aircraft' (anything else). */
function rowKind(missionNumber) {
  var s = String(missionNumber == null ? '' : missionNumber).trim();
  if (s === '') return 'ground';
  if (s.toUpperCase() === 'SIM') return 'sim';
  return 'aircraft';
}

/**
 * Percent Credit in Sim as a fraction 0..1.
 * Accepts a number (0.5), a percent string ('50.00%'), or a bare number string.
 * A bare value above 1 is taken as a percentage (50 -> 0.5). Blank or unreadable is 0.
 */
function parsePercent(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return normalizePercent(value);
  var s = String(value).trim();
  if (s === '') return 0;
  var isPercent = /%$/.test(s);
  var n = Number(s.replace(/%$/, '').trim());
  if (!isFinite(n) || n <= 0) return 0;
  return isPercent ? Math.min(1, n / 100) : normalizePercent(n);
}

/** A fraction 0..1. A bare value above 1 is a percentage; anything above 100% is 100%. */
function normalizePercent(n) {
  if (!isFinite(n) || n <= 0) return 0;
  if (n > 1) n = n / 100;
  return Math.min(1, n);
}

/** Volume Required as a positive number, or null when there is nothing to count (blank, 'X', ...). */
function parseVolume(value) {
  if (value == null || value === '') return null;
  var n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeId(id) {
  return String(id == null ? '' : id).trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Summary row for one event.
 *
 * event: { id, name, type: 'ground' | 'flying', label, volumeRequired, percentCreditInSim }
 * rows:  log rows for this event's Training ID: [{ mission, date }] with date 'YYYY-MM-DD'
 * today: 'YYYY-MM-DD' in the spreadsheet's time zone
 *
 * Returns an object whose keys match SUMMARY_HEADERS; see summaryRowToArray.
 * Percent Complete is a fraction (0.5 for 50%), capped at 1.
 */
function summarizeEvent(event, rows, today) {
  var isFlying = event.type === 'flying';
  var pct = isFlying ? parsePercent(event.percentCreditInSim) : 0;
  var required = isFlying ? parseVolume(event.volumeRequired) : null;
  var todayYmd = parseDate(today);
  var thisFy = todayYmd ? fiscalYear(todayYmd) : null;

  var last = '';
  var lastOverride = '';  // Due Date Override on the row that is Last Accomplished
  var aircraftThisFy = 0;
  var simThisFy = 0;

  for (var i = 0; i < rows.length; i++) {
    var date = parseDate(rows[i].date);
    if (!date) continue;
    // Every ground row counts. A flying row counts unless it is a SIM row at 0%.
    var kind = isFlying ? rowKind(rows[i].mission) : 'ground';
    if (kind === 'sim' && pct <= 0) continue;
    var dateStr = formatDate(date);
    var override = parseDate(rows[i].dueOverride);
    if (dateStr > last) {
      last = dateStr;
      lastOverride = override ? formatDate(override) : '';
    } else if (dateStr === last && override) {
      // Two rows on the same date with different overrides: the earliest wins, whatever
      // the order in the log. The log check reports the other.
      var o = formatDate(override);
      if (!lastOverride || o < lastOverride) lastOverride = o;
    }
    if (isFlying && thisFy !== null && fiscalYear(date) === thisFy) {
      if (kind === 'sim') simThisFy++;
      else aircraftThisFy++;
    }
  }

  // The label computes the due date, unless the Last Accomplished row carries a
  // Due Date Override: the expiration an official document states for that one
  // accomplishment. A newer accomplishment supersedes it like any other date.
  // CHECK LABEL still wins, so a mistyped label stays visible.
  var due = last ? dueDate(event.label, last) : (classifyLabel(event.label).kind === 'unknown' ? CHECK_LABEL : '');
  if (last && lastOverride && due !== CHECK_LABEL) due = lastOverride;
  var overdue = '';
  if (!last && labelProducesDueDates(event.label)) overdue = 'YES';
  else if (due && due !== CHECK_LABEL && today && due < today) overdue = 'YES';

  var row = {
    'Task ID': event.id == null ? '' : event.id,
    'Task Name': event.name == null ? '' : event.name,
    'Last Accomplished': last,
    'Due Date': due,
    'Overdue': overdue,
    'Volume Accomplished': '',
    'Volume Required': '',
    'Percent Complete': '',
    'Remaining Sim Credit': ''
  };

  if (!isFlying) return row;

  if (required === null) {
    row['Volume Accomplished'] = aircraftThisFy + simThisFy;
    return row;
  }

  // 100 x 0.29 is 28.999999999999996 in floating point; the tolerance keeps 29.
  var cap = Math.floor(required * pct + 1e-9);
  var accomplished = aircraftThisFy + Math.min(simThisFy, cap);
  row['Volume Accomplished'] = accomplished;
  row['Volume Required'] = required;
  row['Percent Complete'] = Math.min(1, accomplished / required);
  row['Remaining Sim Credit'] = Math.max(0, Math.min(required - accomplished, cap - simThisFy));
  return row;
}

/**
 * Build the whole summary: every ground event, then every flying event, in config order.
 *
 * ground: [{ id, name, label }]
 * flying: [{ id, name, label, volumeRequired, percentCreditInSim }]
 * log:    [{ mission, date, id }]
 */
function buildSummary(ground, flying, log, today) {
  var byId = {};
  for (var i = 0; i < log.length; i++) {
    var key = normalizeId(log[i].id);
    if (!byId[key]) byId[key] = [];
    byId[key].push(log[i]);
  }
  var out = [];
  var push = function (event, type) {
    var typed = Object.assign({ type: type }, event);
    out.push(summarizeEvent(typed, byId[normalizeId(event.id)] || [], today));
  };
  for (i = 0; i < ground.length; i++) push(ground[i], 'ground');
  for (i = 0; i < flying.length; i++) push(flying[i], 'flying');
  return out;
}

/**
 * Log check: rows the summary could not use, and rows that look wrong.
 *
 * log:    [{ row, mission, date, id }] with row the sheet row number (optional)
 * ground, flying: the config rows
 * today:  'YYYY-MM-DD'
 *
 * Returns [{ row, mission, date, id, problem }], one problem per row, worst first
 * (log rows may carry dueOverride, the Due Date Override cell):
 * a blank or unknown Training ID or an unreadable date means the row was ignored;
 * a future date or a SIM-looking Mission Number means the row was counted but is suspect;
 * an override that is unreadable, beaten by an earlier one on the same date, or before
 * the row's own date is reported as such.
 */
function checkLog(log, ground, flying, today) {
  var known = {};
  var events = ground.concat(flying);
  for (var e = 0; e < events.length; e++) known[normalizeId(events[e].id)] = true;
  // The earliest Due Date Override among rows of one event on one date is the one the
  // summary uses; the others are reported.
  var earliest = {};
  for (var k = 0; k < log.length; k++) {
    var kDate = parseDate(log[k].date);
    var kOverride = parseDate(log[k].dueOverride);
    if (!kDate || !kOverride) continue;
    var key = normalizeId(log[k].id) + '|' + formatDate(kDate);
    var value = formatDate(kOverride);
    if (!(key in earliest) || value < earliest[key]) earliest[key] = value;
  }
  var out = [];
  for (var i = 0; i < log.length; i++) {
    var entry = log[i];
    var id = normalizeId(entry.id);
    var date = parseDate(entry.date);
    var mission = String(entry.mission == null ? '' : entry.mission).trim();
    var overrideText = String(entry.dueOverride == null ? '' : entry.dueOverride).trim();
    var override = parseDate(overrideText);
    var problem = '';
    if (id === '') problem = 'blank Training ID, row ignored';
    else if (!known[id]) problem = 'Training ID not in either config tab, row ignored';
    else if (!date) problem = 'date is blank or not a date, row ignored';
    else if (today && formatDate(date) > today) problem = 'date is after today, row still counted';
    else if (rowKind(mission) === 'aircraft' && /^sim/i.test(mission)) problem = 'Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row';
    else if (overrideText !== '' && !override) problem = 'Due Date Override is not a date, override ignored';
    else if (override && formatDate(override) > earliest[id + '|' + formatDate(date)]) problem = 'another row on the same Date has an earlier Due Date Override, this one ignored';
    else if (override && formatDate(override) < formatDate(date)) problem = 'Due Date Override is before the row\'s Date, override still used';
    if (problem) out.push({ row: entry.row, mission: entry.mission, date: entry.date, id: entry.id, problem: problem });
  }
  return out;
}

/** Summary row object to an array in SUMMARY_HEADERS order. */
function summaryRowToArray(row) {
  var arr = [];
  for (var i = 0; i < SUMMARY_HEADERS.length; i++) arr.push(row[SUMMARY_HEADERS[i]]);
  return arr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUMMARY_HEADERS: SUMMARY_HEADERS,
    CHECK_LABEL: CHECK_LABEL,
    parseDate: parseDate,
    formatDate: formatDate,
    daysInMonth: daysInMonth,
    addDays: addDays,
    fiscalYear: fiscalYear,
    classifyLabel: classifyLabel,
    labelProducesDueDates: labelProducesDueDates,
    dueDate: dueDate,
    DUE_BANDS: DUE_BANDS,
    dueBand: dueBand,
    rowKind: rowKind,
    parsePercent: parsePercent,
    parseVolume: parseVolume,
    summarizeEvent: summarizeEvent,
    buildSummary: buildSummary,
    checkLog: checkLog,
    summaryRowToArray: summaryRowToArray
  };
}
