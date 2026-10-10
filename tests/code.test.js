'use strict';
/*
 * Tests for apps-script/Code.js: the sheet reading and writing, the header migration,
 * the token check, the batch dedupe and the web app API. The Sheets objects the script
 * touches are stood in by a small in-memory workbook that also counts reads and writes,
 * so a refactor that adds a round trip to a sync or a save fails here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'rules.js'), 'utf8');
const CODE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.js'), 'utf8');

/** The script's clock stands still at noon Zulu on this day, so no expectation here depends on when the tests run. */
const TODAY = '2026-10-05';
class FrozenDate extends Date {
  constructor(...args) { super(...(args.length ? args : [TODAY + 'T12:00:00Z'])); }
  static now() { return new Date(TODAY + 'T12:00:00Z').getTime(); }
  static [Symbol.hasInstance](v) { return v instanceof Date; }
}

/** One tab: a 2-D array of cell values plus a record of what the script did to it. */
class Sheet {
  constructor(book, name, data) { this.book = book; this.name = name; this.data = data; this.formats = {}; this.frozen = 0; this.rules = []; this.filter = null; this.maxRows = 50; this.maxCols = 26; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.book.writes++; assert.equal(after, this.maxRows, 'rows are added after the last row'); this.maxRows += n; }
  insertColumnsAfter(after, n) { this.book.writes++; assert.equal(after, this.maxCols, 'columns are added after the last column'); this.maxCols += n; }
  getConditionalFormatRules() { this.book.reads++; return this.rules; }
  getLastRow() { this.book.reads++; let n = 0; this.data.forEach((r, i) => { if (r.some((v) => v !== '' && v != null)) n = i + 1; }); return n; }
  getLastColumn() { this.book.reads++; let n = 0; this.data.forEach((r) => r.forEach((v, j) => { if (v !== '' && v != null) n = Math.max(n, j + 1); })); return n; }
  getIndex() { return Object.keys(this.book.sheets).indexOf(this.name) + 1; }
  getDataRange() { const rows = Math.max(1, this.data.length); const cols = Math.max(1, ...this.data.map((r) => r.length)); return this.getRange(1, 1, rows, cols); }
  clear() { this.book.writes++; this.data = []; this.formats = {}; }
  clearContents() { this.book.writes++; this.data = []; }
  getFilter() { this.book.reads++; return this.filter; }
  setFrozenRows(n) { this.book.writes++; this.frozen = n; }
  setConditionalFormatRules(rules) { this.book.writes++; this.rules = rules; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this, book = this.book;
    // Sheets refuses a range outside the grid; so does this double.
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error(`Range (${r},${c},${nr},${nc}) is outside the ${this.maxRows}x${this.maxCols} grid of "${this.name}"`);
    const cell = (i, j) => (s.data[i] || [])[j] ?? '';
    return {
      getLastRow() { return r + nr - 1; },
      getValue() { book.reads++; return cell(r - 1, c - 1); },
      getValues() { book.reads++; const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r - 1 + i, c - 1 + j)); out.push(row); } return out; },
      getNumberFormat() { book.reads++; return s.formats[`${r},${c}`] || 'General'; },
      setValue(v) { book.writes++; s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; },
      setValues(vals) {
        book.writes++;
        if (s.failWrites) throw new Error('Service error: Spreadsheets');
        if (s.table) { s.data[0] = ['Column 1', 'Column 2']; return; } // a Google Sheets Table owns row 1
        for (let i = 0; i < vals.length; i++) { s.data[r - 1 + i] = s.data[r - 1 + i] || []; for (let j = 0; j < vals[i].length; j++) s.data[r - 1 + i][c - 1 + j] = vals[i][j]; }
      },
      setNumberFormat(f) { book.writes++; for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.formats[`${r + i},${c + j}`] = f; },
    };
  }
}

/** A workbook with the three input tabs and an empty summary tab, plus the script's globals. */
function makeWorkbook(opts = {}) {
  // lockLog records every lock acquire, flush and release, in order.
  const book = { reads: 0, writes: 0, toasts: [], dialogs: [], props: {}, scriptUrl: opts.scriptUrl || null, sheets: {}, lockLog: [], timeZoneReads: 0 };
  const add = (name, data) => { book.sheets[name] = new Sheet(book, name, data); return book.sheets[name]; };
  add('Training Log', opts.log || [['Training ID', 'Date', 'Mission Number']]);
  add('Ground Training Config', [['Task ID', 'Task Name', 'Frequency'], ['G1', 'CBT thing', 'Annual'], ['G2', 'Egress', 'Fortnightly'], ['', '', '']]);
  add('Flying Training Config', [['Task Name', 'Task ID', 'Currency', 'Volume Required', 'Percent Credit in Sim'], ['Landing', 'F1', 'Semi-Annual', 4, 0.5], ['AR', 'F2', '60 Months', 'X', '100.00%']]);
  add('Individual Training Summary', []);
  const ss = {
    getSheetByName: (n) => book.sheets[n] || null,
    insertSheet: (n) => add(n, []),
    deleteSheet: (sh) => { delete book.sheets[sh.name]; },
    getSpreadsheetTimeZone: () => { book.timeZoneReads++; return 'Etc/UTC'; },
    toast: (msg, title) => book.toasts.push({ msg, title }),
  };
  const rule = () => { const r = { getRanges: () => r.ranges }; const b = { whenFormulaSatisfied(f) { r.formula = f; return b; }, setBackground(c) { r.background = c; return b; }, setFontColor(c) { r.font = c; return b; }, setRanges(rs) { r.ranges = rs; return b; }, build() { return r; } }; return b; };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => book.lockLog.push('flush'), newConditionalFormatRule: rule, getUi: () => ({ createMenu: () => { const m = { addItem: () => m, addToUi: () => {} }; return m; }, showModalDialog: (o, title) => book.dialogs.push({ title, html: o.html }) }) },
    HtmlService: { createHtmlOutput: (html) => { const o = { html, setWidth: () => o, setHeight: () => o }; return o; } },
    ScriptApp: { getService: () => ({ getUrl: () => book.scriptUrl }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => book.props[k] ?? null, setProperty: (k, v) => { book.props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { book.lockLog.push('acquire'); }, releaseLock() { book.lockLog.push('release'); } }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    Array, JSON, Math, String, Number, Date: FrozenDate, Error, Object, isNaN, isFinite, RegExp,
  };
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx);
  vm.runInContext(CODE, ctx);
  book.api = {
    get: (token) => ctx.doGet({ parameter: token === undefined ? {} : { token } }),
    post: (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } }),
  };
  book.fn = ctx;
  book.summary = () => book.sheets['Individual Training Summary'].data;
  book.log = () => book.sheets['Training Log'].data;
  book.resetCounts = () => { book.reads = 0; book.writes = 0; };
  return book;
}

test('GET: no token property, bad token, then a payload with parsed config and bands', () => {
  const book = makeWorkbook();
  assert.match(book.api.get('x').error, /Token not set/);
  book.props.APOLLO_TOKEN = 'secret';
  assert.equal(book.api.get('nope').error, 'Bad token');
  const r = book.api.get('secret');
  assert.equal(r.ok, true);
  assert.equal(r.version, book.fn.SCRIPT_VERSION);
  assert.match(r.version, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  assert.equal(r.asOf, TODAY, 'today is the frozen Zulu date');
  assert.deepEqual(r.ground, [{ id: 'G1', name: 'CBT thing', frequency: 'Annual' }, { id: 'G2', name: 'Egress', frequency: 'Fortnightly' }]);
  assert.deepEqual(r.flying, [
    { id: 'F1', name: 'Landing', currency: 'Semi-Annual', volumeRequired: 4, percentCreditInSim: 0.5 },
    { id: 'F2', name: 'AR', currency: '60 Months', volumeRequired: null, percentCreditInSim: 1 },
  ]);
  assert.deepEqual(r.summary.map((s) => [s['Task ID'], s['Due Date'], s['Overdue'], s.band]), [['G1', '', 'YES', 'overdue'], ['G2', 'CHECK LABEL', '', ''], ['F1', '', 'YES', 'overdue'], ['F2', '', 'YES', 'overdue']]);
  assert.deepEqual(r.logCheck, []);
});

test('GET computes without writing the sheet; the log gains the missing fourth header', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  book.api.get('secret');
  assert.deepEqual(book.log()[0], ['Training ID', 'Date', 'Mission Number', 'Due Date Override'], 'header added on first read');
  assert.deepEqual(book.summary(), [], 'a GET leaves the summary tab alone');
  book.resetCounts();
  book.api.get('secret');
  assert.equal(book.writes, 0, 'no writes on a GET once the headers exist');
  assert.equal(book.reads, 4, 'one read per input tab plus the log header row');
});

test('POST: validation rejects the whole batch, a good batch appends, a repeat appends nothing', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  assert.equal(book.api.post({ token: 'secret', rows: [] }).error, 'batchId is required');
  assert.match(book.api.post({ token: 'secret', batchId: 'b0', rows: [{ mission: '', date: '10/05/2026', id: 'G1' }] }).error, /YYYY-MM-DD/);
  assert.match(book.api.post({ token: 'secret', batchId: 'b0', rows: [{ mission: '', date: '2026-10-05', id: '' }] }).error, /id is required/);
  assert.match(book.api.post({ token: 'secret', batchId: 'b0', rows: [{ mission: '=1+1', date: '2026-10-05', id: 'F1' }] }).error, /cannot start with =/);
  assert.match(book.api.post({ token: 'secret', batchId: 'b0', rows: [{ mission: '', date: '2026-10-05', id: '=F1' }] }).error, /cannot start with =/);
  assert.match(book.api.post({ token: 'secret', batchId: 'b'.repeat(101), rows: [] }).error, /batchId is too long/);
  const many = []; for (let i = 0; i < 501; i++) many.push({ mission: '', date: '2026-10-05', id: 'G1' });
  assert.match(book.api.post({ token: 'secret', batchId: 'b0', rows: many }).error, /at most 500 rows/);
  assert.equal(book.log().length, 1, 'nothing appended by a rejected batch');
  assert.deepEqual(book.lockLog, [], 'a rejected batch never takes the lock');
  const rows = [{ mission: '0123', date: '2026-10-02', id: 'F1' }, { mission: 'sim', date: '2026-10-03', id: 'F1' }, { mission: ' ', date: '2026-10-04', id: 'G1' }];
  const r = book.api.post({ token: 'secret', batchId: 'b1', rows });
  assert.equal(r.ok, true);
  assert.deepEqual(book.log().slice(1), [['F1', '2026-10-02', '0123', ''], ['F1', '2026-10-03', 'sim', ''], ['G1', '2026-10-04', '', '']]);
  assert.equal(book.sheets['Training Log'].formats['2,3'], '@', 'Mission Number written as plain text');
  assert.equal(r.summary[0]['Last Accomplished'], '2026-10-04');
  assert.equal(r.summary[2]['Volume Accomplished'], 2, 'aircraft plus one sim row at 50% of 4');
  const again = book.api.post({ token: 'secret', batchId: 'b1', rows });
  assert.equal(again.ok, true);
  assert.equal(book.log().length, 4, 'repeat batch appends nothing');
  assert.deepEqual(JSON.parse(book.props.APOLLO_BATCH_IDS), ['b1']);
});

test('POST writes the summary tab once and does not read the log twice', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  book.api.get('secret');
  book.resetCounts();
  book.api.post({ token: 'secret', batchId: 'b1', rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] });
  assert.equal(book.reads, 9, 'log header row and last row for the append; three tabs and the log header row to compute; color rules, filter and header check to write');
  assert.equal(book.writes, 8, 'append (format and values); format once (two formats, frozen row, colors); clear and values');
  assert.equal(book.summary()[0][0], 'Task ID');
  book.resetCounts();
  book.api.post({ token: 'secret', batchId: 'b2', rows: [{ mission: '', date: '2026-10-05', id: 'G1' }] });
  assert.equal(book.writes, 4, 'second save: append (format and values), clear, values; formatting is not repeated');
});

test('batch ids are capped at 50', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  for (let i = 0; i < 55; i++) book.api.post({ token: 'secret', batchId: 'b' + i, rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] });
  const ids = JSON.parse(book.props.APOLLO_BATCH_IDS);
  assert.equal(ids.length, 50);
  assert.equal(ids[0], 'b5');
});

test('refresh: date cells read as calendar dates, rows ordered ground then flying, formats and colors set', () => {
  const book = makeWorkbook({ log: [['Training ID', 'Date', 'Mission Number', 'Due Date Override'], ['G1', new Date('2026-10-05T12:00:00Z'), '', new Date('2027-01-31T12:00:00Z')], ['F1', '2026-10-02', '0123', '']] });
  book.fn.refresh();
  const s = book.summary();
  assert.deepEqual(s[0], ['Task ID', 'Task Name', 'Last Accomplished', 'Due Date', 'Overdue', 'Volume Accomplished', 'Volume Required', 'Percent Complete', 'Remaining Sim Credit']);
  assert.deepEqual(s[1].slice(0, 5), ['G1', 'CBT thing', '2026-10-05', '2027-01-31', ''], 'override used');
  assert.deepEqual(s[3].slice(0, 5), ['F1', 'Landing', '2026-10-02', '2027-09-30', ''], 'Semi-Annual from Oct is due at the end of the next half');
  const sheet = book.sheets['Individual Training Summary'];
  assert.equal(sheet.frozen, 1);
  assert.equal(sheet.formats['1,1'], '@');
  assert.equal(sheet.formats['50,5'], '@', 'text format on whole columns');
  assert.equal(sheet.formats['2,8'], '0%');
  assert.equal(sheet.rules.length, 4);
  assert.equal(sheet.rules[0].formula, '=$E2="YES"');
  assert.match(sheet.rules[1].formula, /DATEVALUE\(\$D2\) - TODAY\(\), 999\) <= 30/);
  assert.equal(sheet.rules[3].background, '#FFF2CC');
  assert.equal(sheet.rules[0].getRanges()[0].getLastRow(), 50, 'color rules reach the last row');
  assert.match(book.toasts[0].msg, /no problems in 2 rows/);
  assert.equal(book.timeZoneReads, 1, 'the time zone is read once per refresh');
});

test('refresh: a Table on the summary tab makes the script rebuild it', () => {
  const book = makeWorkbook();
  book.sheets['Individual Training Summary'].table = true;
  book.fn.refresh();
  assert.equal(book.summary()[0][0], 'Task ID', 'tab rebuilt');
  assert.equal(book.summary().length, 5);
});

test('refresh: a filter left on the summary tab is removed before the rewrite', () => {
  const book = makeWorkbook();
  let removed = false;
  book.sheets['Individual Training Summary'].filter = { remove: () => { removed = true; } };
  book.fn.refresh();
  assert.equal(removed, true);
});

test('onEdit: a missing config column surfaces as a toast, and the log check reaches the toast and the API', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  book.sheets['Ground Training Config'].data[0][2] = 'Freq';
  book.fn.onEdit({ range: { getSheet: () => book.sheets['Ground Training Config'] } });
  assert.match(book.toasts.at(-1).msg, /missing the column "Frequency"/);
  assert.equal(book.toasts.at(-1).title, 'Apollo refresh failed');
  book.sheets['Ground Training Config'].data[0][2] = 'Frequency';
  book.log().push(['F1', '2026-10-04', 'Simulator', ''], ['NOPE', '2026-10-04', '', ''], ['G1', '2026-10-04', '', 'soon'], ['G1', '2026-10-06', '', ''], ['G1', TODAY, '', '']);
  book.fn.onEdit({ range: { getSheet: () => book.sheets['Training Log'] } });
  assert.match(book.toasts.at(-1).msg, /^4 log rows need attention/);
  assert.deepEqual(book.api.get('secret').logCheck.map((p) => [p.row, p.problem]), [
    [2, 'Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row'],
    [3, 'Training ID not in either config tab, row ignored'],
    [4, 'Due Date Override is not a date, override ignored'],
    [5, 'date is after today, row still counted'],
  ]);
  book.toasts.length = 0;
  book.fn.onEdit({ range: { getSheet: () => ({ getName: () => 'Some other tab' }) } });
  assert.equal(book.toasts.length, 0, 'edits elsewhere do nothing');
});

test('Connect device: names what is missing, then shows the handoff link with /exec', () => {
  const book = makeWorkbook();
  book.fn.connectDevice();
  assert.match(book.dialogs[0].html, /Set APOLLO_TOKEN/);
  assert.match(book.dialogs[0].html, /Deploy the web app/);
  book.props.APOLLO_TOKEN = 'abc123';
  book.scriptUrl = 'https://script.google.com/macros/s/AKfy/dev';
  book.fn.connectDevice();
  const m = /#url=([^&"]+)&(?:amp;)?token=([^"<]+)</.exec(book.dialogs[1].html);
  assert.equal(decodeURIComponent(m[1]), 'https://script.google.com/macros/s/AKfy/exec');
  assert.equal(decodeURIComponent(m[2]), 'abc123');
  assert.doesNotThrow(() => book.fn.onOpen());
});

test('every compute-and-write path runs under the one lock and flushes before releasing it', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  const run = (fn) => { book.lockLog.length = 0; fn(); return book.lockLog.join(' '); };
  assert.equal(run(() => book.fn.refresh()), 'acquire flush release', 'menu refresh');
  assert.equal(run(() => book.fn.onEdit({ range: { getSheet: () => book.sheets['Training Log'] } })), 'acquire flush release', 'edit trigger');
  assert.equal(run(() => book.fn.onOpen()), 'acquire flush release', 'open trigger');
  assert.equal(run(() => book.api.get('secret')), 'acquire flush release', 'GET');
  assert.equal(run(() => book.api.post({ token: 'secret', batchId: 'b1', rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] })), 'acquire flush flush release', 'POST flushes the append before the receipt, then before release');
  assert.equal(run(() => book.api.post({ token: 'secret', batchId: 'b1', rows: [] })), 'acquire flush release', 'a repeated batch appends nothing and flushes once');
  // A failure inside the lock still releases it.
  book.sheets['Ground Training Config'].data[0][2] = 'Freq';
  assert.equal(run(() => book.fn.refresh()), 'acquire flush release');
  assert.equal(book.toasts.at(-1).title, 'Apollo refresh failed');
});

test('a required header that appears twice is an error naming the columns; an extra header is fine', () => {
  const book = makeWorkbook({ log: [['Training ID', 'Date', 'Mission Number', 'Due Date Override', 'Notes', 'Date']] });
  book.props.APOLLO_TOKEN = 'secret';
  assert.equal(book.api.get('secret').error, 'Tab "Training Log" has the column "Date" more than once (B, F)');
  const r = book.api.post({ token: 'secret', batchId: 'b1', rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] });
  assert.equal(r.error, 'Tab "Training Log" has the column "Date" more than once (B, F)');
  assert.equal(book.log().length, 1, 'nothing appended');
  book.log()[0][5] = 'Date typed';
  assert.equal(book.api.get('secret').ok, true, 'two different headers are fine');
  book.sheets['Flying Training Config'].data[0].push('Task ID');
  assert.equal(book.api.get('secret').error, 'Tab "Flying Training Config" has the column "Task ID" more than once (B, F)');
});

test('the grid grows before an append, a summary write or a new header would run past it', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  const log = book.sheets['Training Log'];
  log.maxRows = 3;
  log.maxCols = 3;
  const summary = book.sheets['Individual Training Summary'];
  summary.maxRows = 3;
  book.api.get('secret');
  assert.equal(log.maxCols, 4, 'a column added for the fourth header');
  assert.deepEqual(book.log()[0], ['Training ID', 'Date', 'Mission Number', 'Due Date Override']);
  const rows = [1, 2, 3, 4].map((d) => ({ mission: '', date: '2026-10-0' + d, id: 'G1' }));
  const r = book.api.post({ token: 'secret', batchId: 'b1', rows });
  assert.equal(r.ok, true, r.error);
  assert.equal(log.maxRows, 5, 'rows added for the append');
  assert.equal(book.log().length, 5);
  // The summary tab: 5 rows of values went onto a 3-row grid.
  assert.equal(summary.maxRows, 5);
  assert.equal(book.summary().length, 5);
  assert.equal(summary.rules[0].getRanges()[0].getLastRow(), 5, 'color rules reach the new last row');
});

test('formatting runs again only when the color rules stop short of the last row', () => {
  const book = makeWorkbook();
  const summary = book.sheets['Individual Training Summary'];
  book.fn.refresh();
  const formatted = () => book.writes;
  book.resetCounts();
  book.fn.refresh();
  assert.equal(formatted(), 2, 'clear and values only when the rules reach the last row');
  summary.maxRows = 80; // the tab grew by hand
  book.resetCounts();
  book.fn.refresh();
  assert.equal(formatted(), 6, 'formats, frozen row and colors set once more');
  assert.equal(summary.rules[0].getRanges()[0].getLastRow(), 80);
  assert.equal(summary.formats['80,1'], '@');
  book.resetCounts();
  book.fn.refresh();
  assert.equal(formatted(), 2);
});

test('a write failure on the summary tab is reported and the tab is kept; only a Table rebuilds it', () => {
  const book = makeWorkbook();
  const summary = book.sheets['Individual Training Summary'];
  summary.data = [['Task ID', 'kept']];
  summary.failWrites = true;
  book.fn.refresh();
  assert.equal(book.toasts.at(-1).title, 'Apollo refresh failed');
  assert.match(book.toasts.at(-1).msg, /Service error/);
  assert.equal(book.sheets['Individual Training Summary'], summary, 'the tab was not deleted');
  summary.failWrites = false;
  book.fn.refresh();
  assert.equal(book.toasts.at(-1).title, 'Apollo');
  assert.equal(book.summary().length, 5);
});

test('a receipt list that cannot be read fails the save instead of appending twice', () => {
  const book = makeWorkbook();
  book.props.APOLLO_TOKEN = 'secret';
  book.props.APOLLO_BATCH_IDS = '{"not":"a list"}';
  const r = book.api.post({ token: 'secret', batchId: 'b1', rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] });
  assert.match(r.error, /APOLLO_BATCH_IDS in Script Properties is not a JSON list/);
  assert.equal(book.log().length, 1, 'nothing appended');
  book.props.APOLLO_BATCH_IDS = 'garbage';
  assert.match(book.api.post({ token: 'secret', batchId: 'b1', rows: [] }).error, /not a JSON list/);
  assert.equal(book.api.get('secret').ok, true, 'a sync still reads');
  delete book.props.APOLLO_BATCH_IDS;
  assert.equal(book.api.post({ token: 'secret', batchId: 'b1', rows: [{ mission: '', date: '2026-10-04', id: 'G1' }] }).ok, true);
});
