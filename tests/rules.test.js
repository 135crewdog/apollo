'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../apps-script/rules.js');

// ---------------------------------------------------------------------------
// Required test cases for due dates (copied from CLAUDE.md, do not edit values)
// ---------------------------------------------------------------------------

const DUE_DATE_CASES = [
  // [Label, Last Accomplished, Due Date]
  ['Monthly', '2026-09-01', '2026-10-31'],
  ['Monthly', '2026-09-28', '2026-10-31'],
  ['Monthly', '2026-01-31', '2026-02-28'],
  ['Monthly', '2026-12-15', '2027-01-31'],
  ['Quarterly', '2026-08-15', '2026-12-31'],
  ['Quarterly', '2026-10-01', '2027-03-31'],
  ['Quarterly', '2026-12-31', '2027-03-31'],
  ['Quarterly', '2026-03-31', '2026-06-30'],
  ['Semi-Annual', '2026-02-10', '2026-09-30'],
  ['Semi-Annual', '2026-04-01', '2027-03-31'],
  ['Semi-Annual', '2026-09-30', '2027-03-31'],
  ['Semi-Annual', '2026-10-05', '2027-09-30'],
  ['Annual', '2025-11-12', '2027-09-30'],
  ['Annual', '2026-09-30', '2027-09-30'],
  ['Annual', '2026-10-01', '2028-09-30'],
  ['Biennial', '2025-03-03', '2027-09-30'],
  ['Triennial', '2024-10-15', '2028-09-30'],
  ['5 Years', '2021-10-01', '2027-09-30'],
  ['5 Years', '2022-01-15', '2027-09-30'],
  ['5 Years', '2022-09-30', '2027-09-30'],
  ['60 Months', '2022-03-05', '2027-03-05'],
  ['17 Months', '2025-06-10', '2026-11-10'],
  ['24 Months', '2025-06-10', '2027-06-10'],
  ['6 Months', '2026-08-31', '2027-02-28'],
  ['48 Months', '2024-02-29', '2028-02-29'],
  ['455 Days', '2025-07-01', '2026-09-29'],
  ['365 Days', '2026-01-15', '2027-01-15'],
  ['365 Days', '2027-06-01', '2028-05-31'],
  ['PCS', '2026-01-01', '(none)'],
  ['As Required', '2026-01-01', '(none)'],
  ['N/A', '2026-01-01', '(none)'],
  ['Fortnightly', '2026-01-01', 'CHECK LABEL'],
];

test('due dates: required test cases', () => {
  for (const [label, last, expected] of DUE_DATE_CASES) {
    const want = expected === '(none)' ? '' : expected;
    assert.equal(rules.dueDate(label, last), want, `${label} from ${last}`);
  }
});

test('due dates: labels are matched trimmed and case-insensitive', () => {
  assert.equal(rules.dueDate('  monthly ', '2026-09-01'), '2026-10-31');
  assert.equal(rules.dueDate('SEMI-ANNUAL', '2026-02-10'), '2026-09-30');
  assert.equal(rules.dueDate('annual', '2026-09-30'), '2027-09-30');
  assert.equal(rules.dueDate('5 years', '2022-01-15'), '2027-09-30');
  assert.equal(rules.dueDate(' 60 months ', '2022-03-05'), '2027-03-05');
  assert.equal(rules.dueDate('pcs', '2026-01-01'), '');
  assert.equal(rules.dueDate('as required', '2026-01-01'), '');
  assert.equal(rules.dueDate('n/a', '2026-01-01'), '');
});

test('due dates: number labels work for intervals not seen before', () => {
  assert.equal(rules.dueDate('36 Months', '2025-01-31'), '2028-01-31');
  assert.equal(rules.dueDate('1 Year', '2026-09-30'), '2027-09-30');
  assert.equal(rules.dueDate('1 Year', '2026-10-01'), '2028-09-30');
  assert.equal(rules.dueDate('10 Days', '2026-12-25'), '2027-01-04');
  assert.equal(rules.dueDate('7 Years', '2026-09-30'), '2033-09-30');
});

test('due dates: blank label gives no due date', () => {
  assert.equal(rules.dueDate('', '2026-01-01'), '');
  assert.equal(rules.dueDate(null, '2026-01-01'), '');
  assert.equal(rules.dueDate(undefined, '2026-01-01'), '');
  assert.equal(rules.labelProducesDueDates(''), false);
});

test('due dates: blank Last Accomplished gives no due date for a good label', () => {
  assert.equal(rules.dueDate('Annual', ''), '');
  assert.equal(rules.dueDate('Monthly', null), '');
});

test('labelProducesDueDates', () => {
  for (const label of ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Biennial', 'Triennial', '5 Years', '60 Months', '455 Days']) {
    assert.equal(rules.labelProducesDueDates(label), true, label);
  }
  for (const label of ['PCS', 'As Required', 'N/A', '', 'Fortnightly']) {
    assert.equal(rules.labelProducesDueDates(label), false, label);
  }
});

// ---------------------------------------------------------------------------
// Required test cases for volume (copied from CLAUDE.md, do not edit values)
// Today is 2026-10-05 (FY27) in all of these.
// ---------------------------------------------------------------------------

const TODAY = '2026-10-05';

function flyingEvent(volumeRequired, percentCreditInSim, label) {
  return {
    id: 'F1',
    name: 'Flying event',
    type: 'flying',
    label: label === undefined ? 'Annual' : label,
    volumeRequired,
    percentCreditInSim,
  };
}

function rowsThisFy(simCount, aircraftCount) {
  const rows = [];
  for (let i = 0; i < simCount; i++) rows.push({ mission: 'SIM', date: '2026-10-02', id: 'F1' });
  for (let i = 0; i < aircraftCount; i++) rows.push({ mission: '1234', date: '2026-10-03', id: 'F1' });
  return rows;
}

/** '50%' -> 0.5, 'blank' -> '' */
function expectedPercent(text) {
  if (text === 'blank') return '';
  return Number(text.replace('%', '')) / 100;
}

function expectedNumber(text) {
  return text === 'blank' ? '' : Number(text);
}

const VOLUME_CASES = [
  // [Event setup (volume, sim), Rows this FY (sim, aircraft), Accomplished, Percent Complete, Remaining Sim Credit]
  { setup: [4, 0.5], rows: [3, 0], accomplished: '2', percent: '50%', simCredit: '0' },
  { setup: [4, 0.5], rows: [1, 1], accomplished: '2', percent: '50%', simCredit: '1' },
  { setup: [12, 1], rows: [5, 4], accomplished: '9', percent: '75%', simCredit: '3' },
  { setup: [2, 0], rows: [2, 0], accomplished: '0', percent: '0%', simCredit: '0', lastAccomplished: '' },
  { setup: ['X', 1], rows: [0, 1], accomplished: '1', percent: 'blank', simCredit: 'blank' },
];

test('volume: required test cases', () => {
  for (const c of VOLUME_CASES) {
    const event = flyingEvent(c.setup[0], c.setup[1]);
    const row = rules.summarizeEvent(event, rowsThisFy(c.rows[0], c.rows[1]), TODAY);
    const label = `Volume ${c.setup[0]}, sim ${c.setup[1]}, ${c.rows[0]} SIM, ${c.rows[1]} aircraft`;
    assert.equal(row['Volume Accomplished'], expectedNumber(c.accomplished), `${label}: Accomplished`);
    assert.equal(row['Percent Complete'], expectedPercent(c.percent), `${label}: Percent Complete`);
    assert.equal(row['Remaining Sim Credit'], expectedNumber(c.simCredit), `${label}: Remaining Sim Credit`);
    if ('lastAccomplished' in c) {
      assert.equal(row['Last Accomplished'], c.lastAccomplished, `${label}: Last Accomplished`);
    }
  }
});

test('volume: Volume 12, sim 100%, 1 aircraft dated 2026-09-30 (last FY)', () => {
  const row = rules.summarizeEvent(flyingEvent(12, 1), [{ mission: '1234', date: '2026-09-30', id: 'F1' }], TODAY);
  assert.equal(row['Volume Accomplished'], 0);
  assert.equal(row['Last Accomplished'], '2026-09-30');
  assert.equal(row['Percent Complete'], expectedPercent('0%'));
  assert.equal(row['Remaining Sim Credit'], 12);
});

test('volume: Volume X leaves Volume Required blank too', () => {
  const row = rules.summarizeEvent(flyingEvent('X', 1), rowsThisFy(0, 1), TODAY);
  assert.equal(row['Volume Required'], '');
  assert.equal(row['Volume Accomplished'], 1);
});

test('volume: blank Volume Required counts rows that count this FY', () => {
  const row = rules.summarizeEvent(flyingEvent('', 1), rowsThisFy(2, 1), TODAY);
  assert.equal(row['Volume Required'], '');
  assert.equal(row['Volume Accomplished'], 3);
  assert.equal(row['Percent Complete'], '');
  assert.equal(row['Remaining Sim Credit'], '');
  // At 0% sim, SIM rows do not count even in the plain count.
  const row0 = rules.summarizeEvent(flyingEvent('', 0), rowsThisFy(2, 1), TODAY);
  assert.equal(row0['Volume Accomplished'], 1);
});

test('volume: Volume Required as a number is echoed in the summary', () => {
  const row = rules.summarizeEvent(flyingEvent(4, 0.5), rowsThisFy(1, 1), TODAY);
  assert.equal(row['Volume Required'], 4);
});

// ---------------------------------------------------------------------------
// Gotchas
// ---------------------------------------------------------------------------

test('gotcha: Percent Credit in Sim as 0.5 or "50.00%" are the same', () => {
  assert.equal(rules.parsePercent(0.5), 0.5);
  assert.equal(rules.parsePercent('50.00%'), 0.5);
  assert.equal(rules.parsePercent('50%'), 0.5);
  assert.equal(rules.parsePercent(' 100.00% '), 1);
  assert.equal(rules.parsePercent(1), 1);
  assert.equal(rules.parsePercent(0), 0);
  assert.equal(rules.parsePercent('0.00%'), 0);
  assert.equal(rules.parsePercent(''), 0);
  assert.equal(rules.parsePercent(null), 0);
  assert.equal(rules.parsePercent(undefined), 0);
  assert.equal(rules.parsePercent('abc'), 0);
  // A bare number above 1 is read as a percentage.
  assert.equal(rules.parsePercent(50), 0.5);
  assert.equal(rules.parsePercent('50'), 0.5);

  const a = rules.summarizeEvent(flyingEvent(4, 0.5), rowsThisFy(3, 0), TODAY);
  const b = rules.summarizeEvent(flyingEvent(4, '50.00%'), rowsThisFy(3, 0), TODAY);
  assert.deepEqual(a, b);
  assert.equal(a['Volume Accomplished'], 2);
});

test('gotcha: Volume Required as number, blank or "X"', () => {
  assert.equal(rules.parseVolume(4), 4);
  assert.equal(rules.parseVolume('4'), 4);
  assert.equal(rules.parseVolume(' 12 '), 12);
  assert.equal(rules.parseVolume(''), null);
  assert.equal(rules.parseVolume(null), null);
  assert.equal(rules.parseVolume(undefined), null);
  assert.equal(rules.parseVolume('X'), null);
  assert.equal(rules.parseVolume('x'), null);
  assert.equal(rules.parseVolume('N/A'), null);
});

test('gotcha: SIM in any case, trimmed', () => {
  for (const v of ['SIM', 'sim', 'Sim', ' sim ', 'SIM ', '\tSIM\n']) {
    assert.equal(rules.rowKind(v), 'sim', JSON.stringify(v));
  }
  for (const v of ['', ' ', null, undefined]) {
    assert.equal(rules.rowKind(v), 'ground', JSON.stringify(v));
  }
  for (const v of ['0123', '1E5', 'SIM1', 'SIMULATOR', 1234, 'ABC 12']) {
    assert.equal(rules.rowKind(v), 'aircraft', JSON.stringify(v));
  }

  const rows = [
    { mission: 'sim', date: '2026-10-02', id: 'F1' },
    { mission: ' Sim ', date: '2026-10-02', id: 'F1' },
    { mission: 'SIM', date: '2026-10-02', id: 'F1' },
  ];
  const row = rules.summarizeEvent(flyingEvent(4, 0.5), rows, TODAY);
  assert.equal(row['Volume Accomplished'], 2);
  assert.equal(row['Remaining Sim Credit'], 0);
});

test('gotcha: SIM rows at 0% count for neither currency nor volume', () => {
  const rows = [
    { mission: 'SIM', date: '2026-10-02', id: 'F1' },
    { mission: 'SIM', date: '2025-01-02', id: 'F1' },
  ];
  const row = rules.summarizeEvent(flyingEvent(2, 0), rows, TODAY);
  assert.equal(row['Last Accomplished'], '');
  assert.equal(row['Due Date'], '');
  assert.equal(row['Overdue'], 'YES');
  assert.equal(row['Volume Accomplished'], 0);
  const blank = rules.summarizeEvent(flyingEvent(2, ''), rows, TODAY);
  assert.equal(blank['Last Accomplished'], '');
  assert.equal(blank['Volume Accomplished'], 0);
});

// ---------------------------------------------------------------------------
// Which rows count, Last Accomplished, Overdue
// ---------------------------------------------------------------------------

test('ground event: every row counts whatever the mission number, volume columns blank', () => {
  const event = { id: 'G1', name: 'Ground thing', type: 'ground', label: 'Annual' };
  const rows = [
    { mission: '', date: '2025-05-01', id: 'G1' },
    { mission: 'SIM', date: '2026-03-01', id: 'G1' },
    { mission: '1234', date: '2026-01-01', id: 'G1' },
  ];
  const row = rules.summarizeEvent(event, rows, TODAY);
  assert.equal(row['Last Accomplished'], '2026-03-01');
  assert.equal(row['Due Date'], '2027-09-30');
  assert.equal(row['Overdue'], '');
  assert.equal(row['Volume Accomplished'], '');
  assert.equal(row['Volume Required'], '');
  assert.equal(row['Percent Complete'], '');
  assert.equal(row['Remaining Sim Credit'], '');
});

test('Last Accomplished is the latest date among rows that count', () => {
  const rows = [
    { mission: 'SIM', date: '2026-10-04', id: 'F1' },
    { mission: '1234', date: '2026-09-01', id: 'F1' },
    { mission: '5678', date: '2025-12-31', id: 'F1' },
  ];
  // 0% sim: the newest row is a SIM row and does not count.
  assert.equal(rules.summarizeEvent(flyingEvent(4, 0), rows, TODAY)['Last Accomplished'], '2026-09-01');
  // 50% sim: it counts.
  assert.equal(rules.summarizeEvent(flyingEvent(4, 0.5), rows, TODAY)['Last Accomplished'], '2026-10-04');
});

test('Overdue: YES when Due Date is before today', () => {
  const event = { id: 'G1', name: 'g', type: 'ground', label: 'Monthly' };
  assert.equal(rules.summarizeEvent(event, [{ mission: '', date: '2026-08-15', id: 'G1' }], TODAY)['Overdue'], 'YES'); // due 2026-09-30
  assert.equal(rules.summarizeEvent(event, [{ mission: '', date: '2026-09-15', id: 'G1' }], TODAY)['Overdue'], '');    // due 2026-10-31
  // Due today is not before today.
  const days = { id: 'G1', name: 'g', type: 'ground', label: '5 Days' };
  assert.equal(rules.summarizeEvent(days, [{ mission: '', date: '2026-09-30', id: 'G1' }], TODAY)['Overdue'], '');
  assert.equal(rules.summarizeEvent(days, [{ mission: '', date: '2026-09-29', id: 'G1' }], TODAY)['Overdue'], 'YES');
});

test('Overdue: YES when the label produces due dates and the event was never logged', () => {
  const never = (label) => rules.summarizeEvent({ id: 'G1', name: 'g', type: 'ground', label }, [], TODAY);
  assert.equal(never('Annual')['Overdue'], 'YES');
  assert.equal(never('Annual')['Last Accomplished'], '');
  assert.equal(never('Annual')['Due Date'], '');
  assert.equal(never('PCS')['Overdue'], '');
  assert.equal(never('As Required')['Overdue'], '');
  assert.equal(never('N/A')['Overdue'], '');
  assert.equal(never('')['Overdue'], '');
  assert.equal(never('Fortnightly')['Overdue'], '');
  assert.equal(never('Fortnightly')['Due Date'], 'CHECK LABEL');
});

test('unknown label: Due Date shows CHECK LABEL and Overdue stays blank', () => {
  const event = { id: 'G1', name: 'g', type: 'ground', label: 'Fortnightly' };
  const row = rules.summarizeEvent(event, [{ mission: '', date: '2026-01-01', id: 'G1' }], TODAY);
  assert.equal(row['Due Date'], 'CHECK LABEL');
  assert.equal(row['Overdue'], '');
});

test('rows with an unreadable date are ignored', () => {
  const event = { id: 'G1', name: 'g', type: 'ground', label: 'Annual' };
  const rows = [
    { mission: '', date: '', id: 'G1' },
    { mission: '', date: 'yesterday', id: 'G1' },
    { mission: '', date: '2026-02-30', id: 'G1' },
    { mission: '', date: '2026-02-28', id: 'G1' },
  ];
  assert.equal(rules.summarizeEvent(event, rows, TODAY)['Last Accomplished'], '2026-02-28');
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

test('buildSummary: ground rows then flying rows in config order, unknown IDs ignored', () => {
  const ground = [
    { id: 'G2', name: 'Ground two', label: 'Annual' },
    { id: 'G1', name: 'Ground one', label: 'PCS' },
  ];
  const flying = [
    { id: 'F2', name: 'Flying two', label: 'Semi-Annual', volumeRequired: 4, percentCreditInSim: '50.00%' },
    { id: 'F1', name: 'Flying one', label: 'Monthly', volumeRequired: 'X', percentCreditInSim: 0 },
  ];
  const log = [
    { mission: '', date: '2026-01-10', id: 'G2' },
    { mission: '', date: '2026-01-11', id: 'ZZZ' }, // not in config: kept and ignored
    { mission: 'sim', date: '2026-10-01', id: 'f2' }, // id matched trimmed, any case
    { mission: '0123', date: '2026-10-02', id: 'F2 ' },
    { mission: 'SIM', date: '2026-10-03', id: 'F1' }, // 0% sim: ignored
    { mission: '1E5', date: '2026-09-15', id: 'F1' },
  ];
  const summary = rules.buildSummary(ground, flying, log, TODAY);
  assert.deepEqual(summary.map((r) => r['Task ID']), ['G2', 'G1', 'F2', 'F1']);
  assert.deepEqual(summary.map((r) => r['Task Name']), ['Ground two', 'Ground one', 'Flying two', 'Flying one']);

  assert.deepEqual(rules.summaryRowToArray(summary[0]), ['G2', 'Ground two', '2026-01-10', '2027-09-30', '', '', '', '', '']);
  assert.deepEqual(rules.summaryRowToArray(summary[1]), ['G1', 'Ground one', '', '', '', '', '', '', '']);
  assert.deepEqual(rules.summaryRowToArray(summary[2]), ['F2', 'Flying two', '2026-10-02', '2027-09-30', '', 2, 4, 0.5, 1]);
  assert.deepEqual(rules.summaryRowToArray(summary[3]), ['F1', 'Flying one', '2026-09-15', '2026-10-31', '', 0, '', '', '']);
});

test('buildSummary: numeric Task IDs match numeric log IDs', () => {
  const ground = [{ id: 101, name: 'Numeric', label: 'Annual' }];
  const log = [{ mission: '', date: '2026-10-01', id: '101' }];
  const summary = rules.buildSummary(ground, [], log, TODAY);
  assert.equal(summary[0]['Last Accomplished'], '2026-10-01');
  assert.equal(summary[0]['Task ID'], 101);
});

// ---------------------------------------------------------------------------
// Log check
// ---------------------------------------------------------------------------

test('checkLog: reports ignored and suspect rows with the sheet row number, worst problem first', () => {
  const ground = [{ id: 'GD27YM', name: 'CRM', label: 'Annual' }];
  const flying = [{ id: 'AL01YM', name: 'Landing', label: 'Monthly', volumeRequired: 12, percentCreditInSim: 1 }];
  const log = [
    { row: 2, mission: '1234', date: '2026-10-02', id: 'AL01YN' },
    { row: 3, mission: 'Simulator', date: '2026-10-02', id: 'AL01YM' },
    { row: 4, mission: '', date: '2026-10-03', id: 'AL01YM' },
    { row: 5, mission: '1234', date: '2062-10-03', id: 'AL01YM' },
    { row: 6, mission: '', date: 'yesterday', id: 'GD27YM' },
    { row: 7, mission: '', date: '', id: 'GD27YM' },
    { row: 8, mission: '', date: '2026-09-01', id: '' },
    { row: 9, mission: '', date: '2026-09-01', id: 'gd27ym ' },
    { row: 10, mission: ' sim ', date: '2026-10-05', id: 'AL01YM' },
    { row: 11, mission: 'SIM1', date: 'bad', id: 'ZZZ' },
  ];
  const out = rules.checkLog(log, ground, flying, TODAY);
  assert.deepEqual(out.map((p) => [p.row, p.problem]), [
    [2, 'Training ID not in either config tab, row ignored'],
    [3, 'Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row'],
    [5, 'date is after today, row still counted'],
    [6, 'date is blank or not a date, row ignored'],
    [7, 'date is blank or not a date, row ignored'],
    [8, 'blank Training ID, row ignored'],
    [11, 'Training ID not in either config tab, row ignored'],
  ]);
  assert.deepEqual(out[0], { row: 2, mission: '1234', date: '2026-10-02', id: 'AL01YN', problem: 'Training ID not in either config tab, row ignored' });
});

test('checkLog: a clean log reports nothing, and a date equal to today is fine', () => {
  const ground = [{ id: 'G1', name: 'g', label: 'Annual' }];
  const log = [
    { row: 2, mission: '', date: TODAY, id: 'G1' },
    { row: 3, mission: 'SIM', date: '2026-10-01', id: 'G1' },
    { row: 4, mission: '0123', date: '2026-10-01', id: 'g1' },
  ];
  assert.deepEqual(rules.checkLog(log, ground, [], TODAY), []);
});

test('SUMMARY_HEADERS: Task ID leads, then the CLAUDE.md columns', () => {
  assert.deepEqual(rules.SUMMARY_HEADERS, [
    'Task ID', 'Task Name', 'Last Accomplished', 'Due Date', 'Overdue',
    'Volume Accomplished', 'Volume Required', 'Percent Complete', 'Remaining Sim Credit',
  ]);
});

test('formatPercent', () => {
  assert.equal(rules.formatPercent(0.5), '50%');
  assert.equal(rules.formatPercent(1), '100%');
  assert.equal(rules.formatPercent(0), '0%');
  assert.equal(rules.formatPercent(''), '');
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

test('fiscalYear', () => {
  assert.equal(rules.fiscalYear(rules.parseDate('2026-09-30')), 2026);
  assert.equal(rules.fiscalYear(rules.parseDate('2026-10-01')), 2027);
  assert.equal(rules.fiscalYear(rules.parseDate('2027-01-01')), 2027);
});

test('addDays and addMonths handle leap years and month ends', () => {
  const f = (s, n) => rules.formatDate(rules.addDays(rules.parseDate(s), n));
  assert.equal(f('2024-02-28', 1), '2024-02-29');
  assert.equal(f('2023-02-28', 1), '2023-03-01');
  assert.equal(f('2026-12-31', 1), '2027-01-01');
  assert.equal(f('2100-02-28', 1), '2100-03-01');
  const g = (s, n) => rules.formatDate(rules.addMonths(rules.parseDate(s), n));
  assert.equal(g('2026-01-31', 1), '2026-02-28');
  assert.equal(g('2024-01-31', 1), '2024-02-29');
  assert.equal(g('2026-11-30', 3), '2027-02-28');
  assert.equal(g('2026-03-31', 1), '2026-04-30');
});
