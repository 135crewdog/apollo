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

// ---------------------------------------------------------------------------
// Date arithmetic on {y, m, d}
// ---------------------------------------------------------------------------

function parseDate(str) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
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

/** Same day of the month N months later; the last day of that month if the day does not exist. */
function addMonths(ymd, n) {
  var total = ymd.y * 12 + (ymd.m - 1) + n;
  var y = Math.floor(total / 12);
  var m = total - y * 12 + 1;
  return { y: y, m: m, d: Math.min(ymd.d, daysInMonth(y, m)) };
}

function lastDayOfMonth(y, m) {
  return { y: y, m: m, d: daysInMonth(y, m) };
}

function endOfMonth(ymd) {
  return lastDayOfMonth(ymd.y, ymd.m);
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
  var shifted = ymd.y * 12 + (ymd.m - 1) - 9;
  var periodStart = shifted - (((shifted % monthsPerPeriod) + monthsPerPeriod) % monthsPerPeriod);
  var nextPeriodEnd = periodStart + monthsPerPeriod * 2 - 1;
  var total = nextPeriodEnd + 9;
  var y = Math.floor(total / 12);
  var m = total - y * 12 + 1;
  return lastDayOfMonth(y, m);
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
  var m = /^(\d+) ?(years?|yrs?)$/.exec(s);
  if (m) return { kind: 'fy', n: Number(m[1]) };
  m = /^(\d+) ?(months?|mos?)$/.exec(s);
  if (m) return { kind: 'months', n: Number(m[1]) };
  m = /^(\d+) ?(days?)$/.exec(s);
  if (m) return { kind: 'days', n: Number(m[1]) };
  return { kind: 'unknown' };
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
      return formatDate(endOfMonth(addMonths(last, c.n)));
    case 'days':
      return formatDate(endOfMonth(addDays(last, c.n)));
  }
  return CHECK_LABEL;
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
  if (isNaN(n)) return 0;
  if (isPercent) return n / 100;
  return normalizePercent(n);
}

function normalizePercent(n) {
  if (isNaN(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

/** Volume Required as a positive number, or null when there is nothing to count (blank, 'X', ...). */
function parseVolume(value) {
  if (value == null || value === '') return null;
  var n = typeof value === 'number' ? value : Number(String(value).trim());
  if (isNaN(n) || n <= 0) return null;
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
  var aircraftThisFy = 0;
  var simThisFy = 0;

  for (var i = 0; i < rows.length; i++) {
    var date = parseDate(rows[i].date);
    if (!date) continue;
    var kind = rowKind(rows[i].mission);
    var counts, bucket;
    if (!isFlying) {
      counts = true;
      bucket = null;
    } else if (kind === 'sim') {
      counts = pct > 0;
      bucket = 'sim';
    } else {
      counts = true;
      bucket = 'aircraft';
    }
    if (!counts) continue;
    var dateStr = formatDate(date);
    if (dateStr > last) last = dateStr;
    if (bucket && thisFy !== null && fiscalYear(date) === thisFy) {
      if (bucket === 'sim') simThisFy++;
      else aircraftThisFy++;
    }
  }

  var due = last ? dueDate(event.label, last) : (classifyLabel(event.label).kind === 'unknown' ? CHECK_LABEL : '');
  var overdue = '';
  if (labelProducesDueDates(event.label)) {
    if (!last) overdue = 'YES';
    else if (due && due !== CHECK_LABEL && today && due < today) overdue = 'YES';
  }

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

  var cap = Math.floor(required * pct);
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
    event.type = type;
    out.push(summarizeEvent(event, byId[normalizeId(event.id)] || [], today));
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
 * Returns [{ row, mission, date, id, problem }], one problem per row, worst first:
 * a blank or unknown Training ID or an unreadable date means the row was ignored;
 * a future date or a SIM-looking Mission Number means the row was counted but is suspect.
 */
function checkLog(log, ground, flying, today) {
  var known = {};
  var events = ground.concat(flying);
  for (var e = 0; e < events.length; e++) known[normalizeId(events[e].id)] = true;
  var out = [];
  for (var i = 0; i < log.length; i++) {
    var entry = log[i];
    var id = normalizeId(entry.id);
    var date = parseDate(entry.date);
    var mission = String(entry.mission == null ? '' : entry.mission).trim();
    var problem = '';
    if (id === '') problem = 'blank Training ID, row ignored';
    else if (!known[id]) problem = 'Training ID not in either config tab, row ignored';
    else if (!date) problem = 'date is blank or not a date, row ignored';
    else if (today && formatDate(date) > today) problem = 'date is after today, row still counted';
    else if (rowKind(mission) === 'aircraft' && /^sim/i.test(mission)) problem = 'Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row';
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

/** Fraction to a whole-percent string: 0.5 -> '50%'. Blank stays blank. */
function formatPercent(fraction) {
  if (fraction === '' || fraction == null) return '';
  return Math.round(fraction * 100) + '%';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUMMARY_HEADERS: SUMMARY_HEADERS,
    CHECK_LABEL: CHECK_LABEL,
    parseDate: parseDate,
    formatDate: formatDate,
    daysInMonth: daysInMonth,
    addDays: addDays,
    addMonths: addMonths,
    fiscalYear: fiscalYear,
    classifyLabel: classifyLabel,
    labelProducesDueDates: labelProducesDueDates,
    dueDate: dueDate,
    rowKind: rowKind,
    parsePercent: parsePercent,
    parseVolume: parseVolume,
    summarizeEvent: summarizeEvent,
    buildSummary: buildSummary,
    checkLog: checkLog,
    summaryRowToArray: summaryRowToArray,
    formatPercent: formatPercent
  };
}
