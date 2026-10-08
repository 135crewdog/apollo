/**
 * Apollo workbook script.
 *
 * Reads the Training Log and the two config tabs, asks rules.js for the
 * summary, and writes the Individual Training Summary tab. Also serves the
 * web app API (doGet / doPost) used by the app.
 *
 * All date and volume math lives in rules.js. This file only moves data
 * between the sheet, the rules and the API.
 */

var TAB_LOG = 'Training Log';
var TAB_GROUND = 'Ground Training Config';
var TAB_FLYING = 'Flying Training Config';
var TAB_SUMMARY = 'Individual Training Summary';

var LOG_HEADERS = ['Training ID', 'Date', 'Mission Number'];
var GROUND_HEADERS = ['Task ID', 'Task Name', 'Frequency'];
var FLYING_HEADERS = ['Task ID', 'Task Name', 'Currency', 'Volume Required', 'Percent Credit in Sim'];

var APP_URL = 'https://135crewdog.github.io/apollo/';
var PROP_TOKEN = 'APOLLO_TOKEN';
var PROP_BATCH_IDS = 'APOLLO_BATCH_IDS';
var BATCH_IDS_KEPT = 50;
var LOCK_WAIT_MS = 30000;

// ---------------------------------------------------------------------------
// Triggers and menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Apollo')
    .addItem('Refresh', 'refresh')
    .addItem('Connect device', 'connectDevice')
    .addToUi();
  safeRefresh();
}

function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === TAB_LOG || name === TAB_GROUND || name === TAB_FLYING) safeRefresh();
}

/** Menu entry: refresh and always report the log check. */
function refresh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var result = refreshSummary(ss);
    ss.toast(describeLogCheck(result.logCheck, result.logRows), 'Apollo', 15);
  } catch (err) {
    ss.toast(String(err && err.message ? err.message : err), 'Apollo refresh failed', 15);
  }
}

/** Trigger refresh: quiet when all is well, a toast when the log needs attention or the refresh fails. */
function safeRefresh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var result = refreshSummary(ss);
    if (result.logCheck.length) ss.toast(describeLogCheck(result.logCheck, result.logRows), 'Apollo', 15);
  } catch (err) {
    ss.toast(String(err && err.message ? err.message : err), 'Apollo refresh failed', 15);
  }
}

var LOG_CHECK_TOAST_LINES = 5;

function describeLogCheck(logCheck, logRows) {
  if (!logCheck.length) return 'Summary refreshed. Log check: no problems in ' + logRows + ' rows.';
  var lines = [logCheck.length + ' log row' + (logCheck.length === 1 ? '' : 's') + ' need attention:'];
  for (var i = 0; i < logCheck.length && i < LOG_CHECK_TOAST_LINES; i++) {
    var p = logCheck[i];
    lines.push('Row ' + p.row + ': ' + p.problem + ' (' + [p.mission, p.date, p.id].join(' | ') + ')');
  }
  if (logCheck.length > LOG_CHECK_TOAST_LINES) lines.push('and ' + (logCheck.length - LOG_CHECK_TOAST_LINES) + ' more');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Connect device: a one-tap link that carries the web app URL and token into the app
// ---------------------------------------------------------------------------

/** The app URL with the connection in the fragment, which browsers never send to a server. */
function buildHandoffLink(appUrl, webAppUrl, token) {
  return appUrl + '#url=' + encodeURIComponent(webAppUrl) + '&token=' + encodeURIComponent(token);
}

/** The deployed web app URL, or '' before the first deployment. */
function webAppUrl() {
  var url = ScriptApp.getService().getUrl();
  return url ? String(url).replace(/\/dev$/, '/exec') : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Menu entry: show the handoff link, or what is still missing before one can exist. */
function connectDevice() {
  var token = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN) || '';
  var url = webAppUrl();
  var missing = [];
  if (!token) missing.push('Set ' + PROP_TOKEN + ' in Project Settings \u2192 Script Properties (lowercase letters and digits only).');
  if (!url) missing.push('Deploy the web app: Deploy \u2192 New deployment \u2192 Web app, Execute as Me, Who has access: Anyone.');
  var style = '<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;margin:0;padding:16px}' +
    'textarea{width:100%;box-sizing:border-box;height:88px;font:13px/1.4 Menlo,Consolas,monospace;padding:8px;border:1px solid #c6c6c8;border-radius:8px;resize:none}' +
    'button,a.btn{display:inline-block;font:600 15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:10px 16px;border-radius:10px;border:0;cursor:pointer;text-decoration:none;margin:10px 8px 0 0}' +
    'button{background:#EA9999;color:#1c1c1e}a.btn{background:#e5e5ea;color:#1c1c1e}p{margin:0 0 10px}.note{color:#8e8e93;font-size:13px}</style>';
  var body;
  if (missing.length) {
    body = '<p>Two things make the link, and this workbook is missing one:</p><p>' + missing.map(escapeHtml).join('</p><p>') + '</p><p class="note">Then open Apollo \u2192 Connect device again.</p>';
  } else {
    var link = buildHandoffLink(APP_URL, url, token);
    body = '<p>Open this link on the device that will run Apollo. The app opens with this workbook\u2019s connection filled in, and you can add it to the home screen from there.</p>' +
      '<textarea id="link" readonly>' + escapeHtml(link) + '</textarea>' +
      '<button onclick="copy()">Copy link</button><a class="btn" href="' + escapeHtml(link) + '" target="_blank" rel="noopener">Open on this device</a>' +
      '<p class="note" style="margin-top:12px">The link holds your token. Send it only to yourself.</p>' +
      '<script>function copy(){var t=document.getElementById("link");t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand("copy")}document.querySelector("button").textContent="Copied"}</script>';
  }
  var output = HtmlService.createHtmlOutput(style + body).setWidth(560).setHeight(missing.length ? 240 : 320);
  SpreadsheetApp.getUi().showModalDialog(output, 'Connect device');
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/** Returns { summary, logCheck, logRows }. */
function refreshSummary(ss) {
  var ground = readGround(ss);
  var flying = readFlying(ss);
  var log = readLog(ss);
  var day = today();
  var rows = buildSummary(ground, flying, log, day);
  writeSummary(ss, rows);
  return { summary: rows, logCheck: checkLog(log, ground, flying, day), logRows: log.length };
}

/** Today's date in Zulu (UTC). Every date in Apollo is Zulu, no exceptions. */
function today() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
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
  // A filter or sort left on this tab by hand survives clear() and reorders
  // rows under the next write. The tab is script-owned, so drop it.
  var filter = sheet.getFilter();
  if (filter) filter.remove();
  // Task Name .. Overdue are text so 'YYYY-MM-DD' and 'CHECK LABEL' are kept as written.
  sheet.getRange(1, 1, values.length, 5).setNumberFormat('@');
  if (values.length > 1) {
    var pctCol = SUMMARY_HEADERS.indexOf('Percent Complete') + 1;
    sheet.getRange(2, pctCol, values.length - 1, 1).setNumberFormat('0%');
  }
  sheet.getRange(1, 1, values.length, SUMMARY_HEADERS.length).setValues(values);
  sheet.setFrozenRows(1);
  colorDueDates(sheet, values.length - 1);
}

/**
 * Due Date colors, display only: no rule lives here. Sheets evaluates these
 * with TODAY() in the workbook's time zone, which is UTC. First match wins.
 */
var DUE_SOON_BANDS = [
  { days: 30, background: '#EA9999' },
  { days: 60, background: '#F9CB9C' },
  { days: 90, background: '#FFF2CC' }
];
var OVERDUE_BACKGROUND = '#666666';
var OVERDUE_FONT = '#FFFFFF';

function colorDueDates(sheet, rowCount) {
  if (rowCount < 1) {
    sheet.setConditionalFormatRules([]);
    return;
  }
  var dueCol = SUMMARY_HEADERS.indexOf('Due Date') + 1;
  var overdueCol = SUMMARY_HEADERS.indexOf('Overdue') + 1;
  var range = sheet.getRange(2, dueCol, rowCount, 1);
  var due = '$' + columnLetter(dueCol) + '2';
  var overdue = '$' + columnLetter(overdueCol) + '2';
  var rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + overdue + '="YES"')
      .setBackground(OVERDUE_BACKGROUND)
      .setFontColor(OVERDUE_FONT)
      .setRanges([range])
      .build()
  ];
  for (var i = 0; i < DUE_SOON_BANDS.length; i++) {
    var band = DUE_SOON_BANDS[i];
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + overdue + '<>"YES", IFERROR(DATEVALUE(' + due + ') - TODAY(), 999) <= ' + band.days + ')')
        .setBackground(band.background)
        .setRanges([range])
        .build()
    );
  }
  sheet.setConditionalFormatRules(rules);
}

/** 1 -> A, 27 -> AA. */
function columnLetter(col) {
  var s = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = (col - 1 - rem) / 26;
  }
  return s;
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

/**
 * A date cell holds a calendar date (a Zulu date, typed as such). Sheets stores it
 * as midnight in the spreadsheet's time zone, so formatting it in that same zone
 * gives back exactly the date that was typed, whatever the zone is set to.
 */
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
    sheet.getRange(1, LOG_HEADERS.indexOf('Mission Number') + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
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
      row: i + 2,
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

function buildPayload(ss, result) {
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
  return {
    ok: true,
    asOf: today(),
    ground: ground,
    flying: flying,
    summary: result.summary,
    logCheck: result.logCheck
  };
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
