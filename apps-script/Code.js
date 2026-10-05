/**
 * Apollo workbook script.
 *
 * Reads the Training Log and the two config tabs, asks rules.js for the
 * summary, and writes the Individual Training Summary tab. Also serves the
 * web app API (doGet / doPost) used by the phone app.
 *
 * All date and volume math lives in rules.js. This file only moves data
 * between the sheet, the rules and the API.
 */

var TAB_LOG = 'Training Log';
var TAB_GROUND = 'Ground Training Config';
var TAB_FLYING = 'Flying Training Config';
var TAB_SUMMARY = 'Individual Training Summary';

var LOG_HEADERS = ['Mission Number', 'Date', 'Training ID'];
var GROUND_HEADERS = ['Task ID', 'Task Name', 'Frequency'];
var FLYING_HEADERS = ['Task ID', 'Task Name', 'Currency', 'Volume Required', 'Percent Credit in Sim'];

var PROP_TOKEN = 'APOLLO_TOKEN';
var PROP_BATCH_IDS = 'APOLLO_BATCH_IDS';
var BATCH_IDS_KEPT = 50;
var LOCK_WAIT_MS = 30000;

// ---------------------------------------------------------------------------
// Triggers and menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Apollo').addItem('Refresh', 'refresh').addToUi();
  safeRefresh();
}

function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === TAB_LOG || name === TAB_GROUND || name === TAB_FLYING) safeRefresh();
}

/** Menu entry and installable-trigger entry point. */
function refresh() {
  refreshSummary(SpreadsheetApp.getActiveSpreadsheet());
}

/** Refresh that reports a problem as a toast instead of a silent trigger failure. */
function safeRefresh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    refreshSummary(ss);
  } catch (err) {
    ss.toast(String(err && err.message ? err.message : err), 'Apollo refresh failed', 10);
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

function refreshSummary(ss) {
  var ground = readGround(ss);
  var flying = readFlying(ss);
  var log = readLog(ss);
  var rows = buildSummary(ground, flying, log, today(ss));
  writeSummary(ss, rows);
  return rows;
}

function today(ss) {
  return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

function writeSummary(ss, rows) {
  var values = [SUMMARY_HEADERS];
  for (var i = 0; i < rows.length; i++) values.push(summaryRowToArray(rows[i]));

  var sheet = ss.getSheetByName(TAB_SUMMARY) || ss.insertSheet(TAB_SUMMARY);
  try {
    fillSummary(sheet, values);
    if (String(sheet.getRange(1, 1).getValue()) === SUMMARY_HEADERS[0]) return;
  } catch (err) {
    // fall through and rebuild the tab
  }
  // Something done by hand to the script-owned tab (for example Format > Convert
  // to table, which takes over the header row) stopped the write. Rebuild the tab.
  var index = sheet.getIndex();
  ss.deleteSheet(sheet);
  sheet = ss.insertSheet(TAB_SUMMARY, index - 1);
  fillSummary(sheet, values);
}

function fillSummary(sheet, values) {
  sheet.clear();
  // Task Name .. Overdue are text so 'YYYY-MM-DD' and 'CHECK LABEL' are kept as written.
  sheet.getRange(1, 1, values.length, 5).setNumberFormat('@');
  if (values.length > 1) {
    var pctCol = SUMMARY_HEADERS.indexOf('Percent Remaining') + 1;
    sheet.getRange(2, pctCol, values.length - 1, 1).setNumberFormat('0%');
  }
  sheet.getRange(1, 1, values.length, SUMMARY_HEADERS.length).setValues(values);
  sheet.setFrozenRows(1);
}

// ---------------------------------------------------------------------------
// Reading tabs
// ---------------------------------------------------------------------------

function getSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Tab "' + name + '" not found');
  return sheet;
}

/**
 * Read a tab with a header row. Columns are found by exact header text
 * (trimmed) in row 1, never by position.
 * Returns { col: { header: index }, rows: [[...]] } with rows below the header.
 */
function readTable(sheet, requiredHeaders) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) throw new Error('Tab "' + sheet.getName() + '" has no header row');
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0];
  var col = {};
  for (var i = 0; i < header.length; i++) {
    var text = String(header[i]).trim();
    if (text && !(text in col)) col[text] = i;
  }
  for (var j = 0; j < requiredHeaders.length; j++) {
    if (!(requiredHeaders[j] in col)) {
      throw new Error('Tab "' + sheet.getName() + '" is missing the column "' + requiredHeaders[j] + '"');
    }
  }
  return { col: col, rows: values.slice(1) };
}

function cellText(v) {
  return v == null ? '' : String(v).trim();
}

function cellDate(ss, v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return cellText(v);
}

function readGround(ss) {
  var t = readTable(getSheet(ss, TAB_GROUND), GROUND_HEADERS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var id = r[t.col['Task ID']];
    if (cellText(id) === '') continue;
    out.push({
      id: id,
      name: r[t.col['Task Name']],
      label: r[t.col['Frequency']]
    });
  }
  return out;
}

function readFlying(ss) {
  var t = readTable(getSheet(ss, TAB_FLYING), FLYING_HEADERS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var id = r[t.col['Task ID']];
    if (cellText(id) === '') continue;
    out.push({
      id: id,
      name: r[t.col['Task Name']],
      label: r[t.col['Currency']],
      volumeRequired: r[t.col['Volume Required']],
      percentCreditInSim: r[t.col['Percent Credit in Sim']]
    });
  }
  return out;
}

/** Write the log headers if row 1 is empty, and keep Mission Number as plain text. */
function ensureLogHeaders(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), LOG_HEADERS.length);
  var row1 = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var empty = true;
  for (var i = 0; i < row1.length; i++) {
    if (cellText(row1[i]) !== '') { empty = false; break; }
  }
  if (empty) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    sheet.setFrozenRows(1);
  }
}

function readLog(ss) {
  var sheet = getSheet(ss, TAB_LOG);
  ensureLogHeaders(sheet);
  var t = readTable(sheet, LOG_HEADERS);
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var id = cellText(r[t.col['Training ID']]);
    var date = cellDate(ss, r[t.col['Date']]);
    if (id === '' && date === '') continue;
    out.push({
      mission: cellText(r[t.col['Mission Number']]),
      date: date,
      id: id
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Appending log rows
// ---------------------------------------------------------------------------

/** rows: [{ mission, date, id }] already validated. */
function appendLogRows(ss, rows) {
  if (!rows.length) return;
  var sheet = getSheet(ss, TAB_LOG);
  ensureLogHeaders(sheet);
  var t = readTable(sheet, LOG_HEADERS);
  var width = sheet.getLastColumn();
  var values = [];
  for (var i = 0; i < rows.length; i++) {
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    line[t.col['Mission Number']] = rows[i].mission;
    line[t.col['Date']] = rows[i].date;
    line[t.col['Training ID']] = rows[i].id;
    values.push(line);
  }
  var start = sheet.getLastRow() + 1;
  // Mission Number stays plain text so '0123' and '1E5' are not altered by Sheets.
  sheet.getRange(start, t.col['Mission Number'] + 1, rows.length, 1).setNumberFormat('@');
  sheet.getRange(start, 1, rows.length, width).setValues(values);
}

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var date = cellText(r.date);
    var id = cellText(r.id);
    if (!parseDate(date)) throw new Error('Row ' + (i + 1) + ': date must be YYYY-MM-DD');
    if (id === '') throw new Error('Row ' + (i + 1) + ': id is required');
    out.push({ mission: cellText(r.mission), date: date, id: id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Web app API
// ---------------------------------------------------------------------------

function doGet(e) {
  return respond(function () {
    checkToken(e && e.parameter ? e.parameter.token : '');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_WAIT_MS);
    try {
      return buildPayload(ss, refreshSummary(ss));
    } finally {
      lock.releaseLock();
    }
  });
}

function doPost(e) {
  return respond(function () {
    var body = parseBody(e);
    checkToken(body.token);
    var batchId = cellText(body.batchId);
    if (batchId === '') throw new Error('batchId is required');
    var rows = validateRows(body.rows || []);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_WAIT_MS);
    try {
      if (!isKnownBatch(batchId)) {
        appendLogRows(ss, rows);
        rememberBatch(batchId);
      }
      return buildPayload(ss, refreshSummary(ss));
    } finally {
      lock.releaseLock();
    }
  });
}

function buildPayload(ss, summary) {
  var ground = readGround(ss).map(function (g) {
    return { id: cellText(g.id), name: cellText(g.name), frequency: cellText(g.label) };
  });
  var flying = readFlying(ss).map(function (f) {
    return {
      id: cellText(f.id),
      name: cellText(f.name),
      currency: cellText(f.label),
      volumeRequired: parseVolume(f.volumeRequired),
      percentCreditInSim: parsePercent(f.percentCreditInSim)
    };
  });
  return { ok: true, asOf: today(ss), ground: ground, flying: flying, summary: summary };
}

function parseBody(e) {
  var text = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!text) throw new Error('Empty request body');
  var body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new Error('Body is not valid JSON');
  }
  if (!body || typeof body !== 'object') throw new Error('Body must be a JSON object');
  return body;
}

function checkToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  if (!expected) throw new Error('Token not set: add ' + PROP_TOKEN + ' in Project Settings > Script Properties');
  if (cellText(token) !== expected) throw new Error('Bad token');
}

function readBatchIds() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_BATCH_IDS);
  try {
    var ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    return [];
  }
}

function isKnownBatch(batchId) {
  return readBatchIds().indexOf(batchId) !== -1;
}

function rememberBatch(batchId) {
  var ids = readBatchIds();
  ids.push(batchId);
  while (ids.length > BATCH_IDS_KEPT) ids.shift();
  PropertiesService.getScriptProperties().setProperty(PROP_BATCH_IDS, JSON.stringify(ids));
}

function respond(fn) {
  var payload;
  try {
    payload = fn();
  } catch (err) {
    payload = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
