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

var LOG_HEADERS = ['Training ID', 'Date', 'Mission Number', 'Due Date Override'];
var LOG_DATE_FORMAT = 'yyyy-mm-dd';
var GROUND_HEADERS = ['Task ID', 'Task Name', 'Frequency'];
var FLYING_HEADERS = ['Task ID', 'Task Name', 'Currency', 'Volume Required', 'Percent Credit in Sim'];

/** Bump on every change to Code.js or rules.js. Returned in the API payload and shown in the app's Settings. */
var SCRIPT_VERSION = '2026.10.10.2';

var APP_URL = 'https://135crewdog.github.io/apollo/';
var PROP_TOKEN = 'APOLLO_TOKEN';
var PROP_BATCH_IDS = 'APOLLO_BATCH_IDS';
var BATCH_IDS_KEPT = 50;
var BATCH_ID_MAX_LENGTH = 100;
var BATCH_ROWS_MAX = 500;
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
    var result = withLock(function () { return refreshSummary(ss); });
    ss.toast(describeLogCheck(result.logCheck, result.log.length), 'Apollo', 15);
  } catch (err) {
    ss.toast(String(err && err.message ? err.message : err), 'Apollo refresh failed', 15);
  }
}

/** Trigger refresh: quiet when all is well, a toast when the log needs attention or the refresh fails. */
function safeRefresh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var result = withLock(function () { return refreshSummary(ss); });
    if (result.logCheck.length) ss.toast(describeLogCheck(result.logCheck, result.log.length), 'Apollo', 15);
  } catch (err) {
    ss.toast(String(err && err.message ? err.message : err), 'Apollo refresh failed', 15);
  }
}

/**
 * Every path that reads the tabs and writes the summary or the log runs under the one
 * script lock, so a trigger refresh, a menu refresh and an app save never interleave.
 * Pending writes are flushed before the lock is released, so the next holder reads them.
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
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

/**
 * Read the three input tabs once and compute the summary and the log check.
 * Writes nothing. Returns { ground, flying, log, day, summary, logCheck }.
 */
function computeSummary(ss) {
  var ground = readGround(ss);
  var flying = readFlying(ss);
  var log = readLog(ss);
  var day = today();
  return {
    ground: ground,
    flying: flying,
    log: log,
    day: day,
    summary: buildSummary(ground, flying, log, day),
    logCheck: checkLog(log, ground, flying, day)
  };
}

/** Compute, then rewrite the Individual Training Summary tab. */
function refreshSummary(ss) {
  var result = computeSummary(ss);
  writeSummary(ss, result.summary);
  return result;
}

/** Today's date in Zulu (UTC). Every date in Apollo is Zulu, no exceptions. */
function today() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
}

function writeSummary(ss, rows) {
  var values = [SUMMARY_HEADERS];
  for (var i = 0; i < rows.length; i++) values.push(summaryRowToArray(rows[i]));

  var sheet = ss.getSheetByName(TAB_SUMMARY) || ss.insertSheet(TAB_SUMMARY);
  fillSummary(sheet, values);
  if (String(sheet.getRange(1, 1).getValue()) === SUMMARY_HEADERS[0]) return;
  // The header did not land: a Google Sheets Table (Format > Convert to table) owns row 1
  // of the script-owned tab. Rebuild the tab. Any other failure above is an error and
  // the tab stays as it is.
  var index = sheet.getIndex();
  ss.deleteSheet(sheet);
  sheet = ss.insertSheet(TAB_SUMMARY, index - 1);
  fillSummary(sheet, values);
}

/**
 * A refresh clears and rewrites the values. The text and percent formats, the frozen
 * header and the Due Date colors are set once, on whole columns, and survive every
 * refresh. A tab whose color rules do not reach its last row (never formatted, formatted
 * when it was shorter, or grown since) is formatted again, once.
 */
function fillSummary(sheet, values) {
  ensureRows(sheet, values.length);
  if (!colorRulesReachLastRow(sheet)) formatSummary(sheet);
  // A filter or sort left on this tab by hand reorders rows under the next write.
  var filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, SUMMARY_HEADERS.length).setValues(values);
}

function colorRulesReachLastRow(sheet) {
  var rules = sheet.getConditionalFormatRules();
  if (rules.length !== DUE_BANDS.length) return false;
  var ranges = rules[0].getRanges();
  return ranges.length > 0 && ranges[0].getLastRow() >= sheet.getMaxRows();
}

/** A write past the grid fails, so the grid grows first. */
function ensureRows(sheet, rows) {
  var max = sheet.getMaxRows();
  if (rows > max) sheet.insertRowsAfter(max, rows - max);
}

function ensureColumns(sheet, columns) {
  var max = sheet.getMaxColumns();
  if (columns > max) sheet.insertColumnsAfter(max, columns - max);
}

function formatSummary(sheet) {
  var rows = sheet.getMaxRows();
  // Task ID .. Overdue are text so 'YYYY-MM-DD' and 'CHECK LABEL' are kept as written.
  sheet.getRange(1, 1, rows, SUMMARY_HEADERS.indexOf('Overdue') + 1).setNumberFormat('@');
  sheet.getRange(2, SUMMARY_HEADERS.indexOf('Percent Complete') + 1, rows - 1, 1).setNumberFormat('0%');
  sheet.setFrozenRows(1);
  colorDueDates(sheet, rows - 1);
}

/**
 * Due Date colors from DUE_BANDS in rules.js, the same list the API's band field
 * uses. Sheets evaluates TODAY() in the workbook's time zone, which is UTC.
 */
function colorDueDates(sheet, rowCount) {
  var dueCol = SUMMARY_HEADERS.indexOf('Due Date') + 1;
  var range = sheet.getRange(2, dueCol, rowCount, 1);
  var due = '$' + columnLetter(dueCol) + '2';
  var overdue = '$' + columnLetter(SUMMARY_HEADERS.indexOf('Overdue') + 1) + '2';
  var rules = DUE_BANDS.map(function (b) {
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(b.band === 'overdue'
        ? '=' + overdue + '="YES"'
        : '=AND(' + overdue + '<>"YES", IFERROR(DATEVALUE(' + due + ') - TODAY(), 999) <= ' + b.days + ')')
      .setBackground(b.background)
      .setRanges([range]);
    if (b.fontColor) rule.setFontColor(b.fontColor);
    return rule.build();
  });
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
 * Columns by exact header text (trimmed) in row 1, never by position: { header: index }.
 * The one parser for reading and for appending, so both see the same column. A required
 * header that appears twice is an error naming the columns, since a read and a write
 * could otherwise disagree about which one is meant.
 */
function headerColumns(name, row1, requiredHeaders) {
  var col = {};
  var twice = {};
  for (var i = 0; i < row1.length; i++) {
    var text = cellText(row1[i]);
    if (text === '') continue;
    if (text in col) twice[text] = (twice[text] || [columnLetter(col[text] + 1)]).concat(columnLetter(i + 1));
    else col[text] = i;
  }
  for (var j = 0; j < requiredHeaders.length; j++) {
    var h = requiredHeaders[j];
    if (twice[h]) throw new Error('Tab "' + name + '" has the column "' + h + '" more than once (' + twice[h].join(', ') + ')');
  }
  return col;
}

/**
 * Read a tab with a header row.
 * Returns { col: { header: index }, rows: [[...]] } with rows below the header.
 */
function readTable(sheet, requiredHeaders) {
  // One call for the whole used range: a separate last-row and last-column lookup
  // would each be another round trip to Sheets.
  var values = sheet.getDataRange().getValues();
  if (!values.length || !values[0].length) throw new Error('Tab "' + sheet.getName() + '" has no header row');
  var col = headerColumns(sheet.getName(), values[0], requiredHeaders);
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
function cellDate(v, timeZone) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, timeZone, 'yyyy-MM-dd');
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

/**
 * Reads row 1 of the log and returns { header: column index }. Writes the headers when
 * row 1 is empty, and adds any header that is missing (a workbook made before a column
 * existed) in the next free column, so an existing log picks up a new column on its
 * next refresh with no hand edit.
 */
function ensureLogHeaders(sheet) {
  var row1 = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];
  var col = headerColumns(sheet.getName(), row1, LOG_HEADERS);
  var used = 0;
  for (var i = 0; i < row1.length; i++) {
    if (cellText(row1[i]) !== '') used = i + 1;
  }
  var added = false;
  for (var h = 0; h < LOG_HEADERS.length; h++) {
    var header = LOG_HEADERS[h];
    if (header in col) continue;
    ensureColumns(sheet, used + 1);
    sheet.getRange(1, used + 1).setValue(header);
    if (header === 'Mission Number') sheet.getRange(1, used + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    if (header === 'Date' || header === 'Due Date Override') sheet.getRange(2, used + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(LOG_DATE_FORMAT);
    col[header] = used;
    used++;
    added = true;
  }
  if (added) sheet.setFrozenRows(1);
  return col;
}

function readLog(ss) {
  var sheet = getSheet(ss, TAB_LOG);
  ensureLogHeaders(sheet);
  var t = readTable(sheet, LOG_HEADERS);
  var timeZone = ss.getSpreadsheetTimeZone();
  var out = [];
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    var id = cellText(r[t.col['Training ID']]);
    var date = cellDate(r[t.col['Date']], timeZone);
    if (id === '' && date === '') continue;
    out.push({
      row: i + 2,
      mission: cellText(r[t.col['Mission Number']]),
      date: date,
      id: id,
      dueOverride: cellDate(r[t.col['Due Date Override']], timeZone)
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Appending log rows
// ---------------------------------------------------------------------------

/** rows: [{ mission, date, id }] already validated. Reads only the header row. */
function appendLogRows(ss, rows) {
  if (!rows.length) return;
  var sheet = getSheet(ss, TAB_LOG);
  var col = ensureLogHeaders(sheet);
  var width = 0;
  Object.keys(col).forEach(function (h) { width = Math.max(width, col[h] + 1); });
  var values = rows.map(function (r) {
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    line[col['Mission Number']] = r.mission;
    line[col['Date']] = r.date;
    line[col['Training ID']] = r.id;
    return line;
  });
  var start = sheet.getLastRow() + 1;
  ensureRows(sheet, start + rows.length - 1);
  // Mission Number stays plain text so '0123' and '1E5' are not altered by Sheets.
  sheet.getRange(start, col['Mission Number'] + 1, rows.length, 1).setNumberFormat('@');
  sheet.getRange(start, 1, rows.length, width).setValues(values);
}

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (rows.length > BATCH_ROWS_MAX) throw new Error('A batch holds at most ' + BATCH_ROWS_MAX + ' rows');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var date = cellText(r.date);
    var id = cellText(r.id);
    var mission = cellText(r.mission);
    if (!parseDate(date)) throw new Error('Row ' + (i + 1) + ': date must be YYYY-MM-DD');
    if (id === '') throw new Error('Row ' + (i + 1) + ': id is required');
    // A leading = would be a formula to Sheets; the log holds values only.
    if (id.charAt(0) === '=' || mission.charAt(0) === '=') throw new Error('Row ' + (i + 1) + ': a value cannot start with =');
    out.push({ mission: mission, date: date, id: id });
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
    // A sync reads; it does not rewrite the summary tab. The tab refreshes on open,
    // on edit, on every POST and from the menu.
    return withLock(function () { return buildPayload(computeSummary(ss)); });
  });
}

function doPost(e) {
  return respond(function () {
    var body = parseBody(e);
    checkToken(body.token);
    var batchId = cellText(body.batchId);
    if (batchId === '') throw new Error('batchId is required');
    if (batchId.length > BATCH_ID_MAX_LENGTH) throw new Error('batchId is too long');
    var rows = validateRows(body.rows || []);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return withLock(function () {
      var known = readBatchIds();
      if (known.indexOf(batchId) === -1) {
        appendLogRows(ss, rows);
        // The rows are in the sheet before the receipt says so.
        SpreadsheetApp.flush();
        rememberBatch(known, batchId);
      }
      return buildPayload(refreshSummary(ss));
    });
  });
}

/** The API payload from what computeSummary read and computed; no further reads. */
function buildPayload(result) {
  return {
    ok: true,
    version: SCRIPT_VERSION,
    asOf: result.day,
    ground: result.ground.map(function (g) {
      return { id: cellText(g.id), name: cellText(g.name), frequency: cellText(g.label) };
    }),
    flying: result.flying.map(function (f) {
      return {
        id: cellText(f.id),
        name: cellText(f.name),
        currency: cellText(f.label),
        volumeRequired: parseVolume(f.volumeRequired),
        percentCreditInSim: parsePercent(f.percentCreditInSim)
      };
    }),
    // Each row carries its Due Date color band so the app displays it without date math.
    summary: result.summary.map(function (row) {
      return Object.assign({ band: dueBand(row, result.day) }, row);
    }),
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

/** The receipts of the last batches. A receipt list that cannot be read must not become an empty one, or a retry appends twice. */
function readBatchIds() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_BATCH_IDS);
  if (!raw) return [];
  var ids;
  try {
    ids = JSON.parse(raw);
  } catch (err) {
    ids = null;
  }
  if (!Array.isArray(ids)) throw new Error(PROP_BATCH_IDS + ' in Script Properties is not a JSON list; fix or delete it');
  return ids;
}

function rememberBatch(ids, batchId) {
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
