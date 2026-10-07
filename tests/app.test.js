'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app/app.js');

const TODAY = '2026-10-07';

test('todayUtc is the UTC date in YYYY-MM-DD', () => {
  const t = app.todayUtc();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t, new Date().toISOString().slice(0, 10));
});

test('isIsoDate accepts real dates only', () => {
  assert.equal(app.isIsoDate('2026-10-07'), true);
  assert.equal(app.isIsoDate('2028-02-29'), true);
  assert.equal(app.isIsoDate('2026-02-29'), false);
  assert.equal(app.isIsoDate('2026-13-01'), false);
  assert.equal(app.isIsoDate('10/07/2026'), false);
  assert.equal(app.isIsoDate(''), false);
  assert.equal(app.isIsoDate('CHECK LABEL'), false);
});

test('formatDisplayDate: DD-Mmm-YY for humans, other values untouched', () => {
  assert.equal(app.formatDisplayDate('2026-10-07'), '07-Oct-26');
  assert.equal(app.formatDisplayDate('2027-01-31'), '31-Jan-27');
  assert.equal(app.formatDisplayDate('2019-08-15'), '15-Aug-19');
  assert.equal(app.formatDisplayDate(''), '');
  assert.equal(app.formatDisplayDate(null), '');
  assert.equal(app.formatDisplayDate('CHECK LABEL'), 'CHECK LABEL');
  assert.equal(app.formatDisplayDate('yesterday'), 'yesterday');
});

test('dueBand matches the sheet bands', () => {
  const row = (due, overdue) => ({ 'Due Date': due, 'Overdue': overdue || '' });
  assert.equal(app.dueBand(row('', 'YES'), TODAY), 'overdue');
  assert.equal(app.dueBand(row('2026-06-30', 'YES'), TODAY), 'overdue');
  assert.equal(app.dueBand(row('2026-10-31'), TODAY), 'd30');
  assert.equal(app.dueBand(row('2026-11-06'), TODAY), 'd30');
  assert.equal(app.dueBand(row('2026-11-07'), TODAY), 'd60');
  assert.equal(app.dueBand(row('2026-12-06'), TODAY), 'd60');
  assert.equal(app.dueBand(row('2026-12-31'), TODAY), 'd90');
  assert.equal(app.dueBand(row('2027-01-05'), TODAY), 'd90');
  assert.equal(app.dueBand(row('2027-01-06'), TODAY), '');
  assert.equal(app.dueBand(row('2027-09-30'), TODAY), '');
  assert.equal(app.dueBand(row(''), TODAY), '');
  assert.equal(app.dueBand(row('CHECK LABEL'), TODAY), '');
});

test('sortSummary: overdue first, then CHECK LABEL, then by due date, then no due date; ties keep config order', () => {
  const rows = [
    { 'Task ID': 'A', 'Due Date': '2027-09-30', 'Overdue': '' },
    { 'Task ID': 'B', 'Due Date': '', 'Overdue': '' },
    { 'Task ID': 'C', 'Due Date': '2026-10-31', 'Overdue': '' },
    { 'Task ID': 'D', 'Due Date': '2026-06-30', 'Overdue': 'YES' },
    { 'Task ID': 'E', 'Due Date': 'CHECK LABEL', 'Overdue': '' },
    { 'Task ID': 'F', 'Due Date': '', 'Overdue': 'YES' },
    { 'Task ID': 'G', 'Due Date': '2026-10-31', 'Overdue': '' },
    { 'Task ID': 'H', 'Due Date': '', 'Overdue': '' },
  ];
  assert.deepEqual(app.sortSummary(rows).map((r) => r['Task ID']), ['F', 'D', 'E', 'C', 'G', 'A', 'B', 'H']);
  // input untouched
  assert.equal(rows[0]['Task ID'], 'A');
});

test('eventsForMode: Flight and Sim use the flying tab, Ground the ground tab, Sim hides 0% events', () => {
  const data = {
    ground: [{ id: 'G1', name: 'g', frequency: 'Annual' }],
    flying: [
      { id: 'F1', name: 'Landing', percentCreditInSim: 1 },
      { id: 'F2', name: 'NVG', percentCreditInSim: 0 },
      { id: 'F3', name: 'AAR', percentCreditInSim: 0.5 },
    ],
  };
  assert.deepEqual(app.eventsForMode('flight', data).map((e) => e.id), ['F1', 'F2', 'F3']);
  assert.deepEqual(app.eventsForMode('sim', data).map((e) => e.id), ['F1', 'F3']);
  assert.deepEqual(app.eventsForMode('ground', data).map((e) => e.id), ['G1']);
  assert.deepEqual(app.eventsForMode('flight', {}), []);
});

test('filterEvents matches id or name, case-insensitive, trimmed', () => {
  const events = [{ id: 'AL01YM', name: 'Landing' }, { id: 'AP15YM', name: 'Approach-Instrument' }];
  assert.equal(app.filterEvents(events, '').length, 2);
  assert.deepEqual(app.filterEvents(events, ' land ').map((e) => e.id), ['AL01YM']);
  assert.deepEqual(app.filterEvents(events, 'ap15').map((e) => e.id), ['AP15YM']);
  assert.deepEqual(app.filterEvents(events, 'zzz'), []);
});

test('groupEvents: by first two characters of the Task ID, groups in first-appearance order, config order inside', () => {
  const events = [
    { id: 'AH11YM' }, { id: 'AL01YM' }, { id: 'AP07YM' }, { id: 'AL15YM' }, { id: 'MB10YM' }, { id: 'AP53YM' }, { id: 'FLTMED' }, { id: ' al99ym ' },
  ];
  const groups = app.groupEvents(events);
  assert.deepEqual(groups.map((g) => g.key), ['AH', 'AL', 'AP', 'MB', 'FL']);
  assert.deepEqual(groups[1].events.map((e) => e.id), ['AL01YM', 'AL15YM', ' al99ym ']);
  assert.deepEqual(groups[2].events.map((e) => e.id), ['AP07YM', 'AP53YM']);
  assert.deepEqual(app.groupEvents([]), []);
});

test('buildRows: one row per tap in event order, mission by mode, validation errors', () => {
  const events = [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }];
  const built = app.buildRows('flight', ' 0123 ', '2026-10-07', { F3: 1, F1: 2 }, events);
  assert.deepEqual(built.rows, [
    { mission: '0123', date: '2026-10-07', id: 'F1' },
    { mission: '0123', date: '2026-10-07', id: 'F1' },
    { mission: '0123', date: '2026-10-07', id: 'F3' },
  ]);
  assert.deepEqual(app.buildRows('sim', '', '2026-10-07', { F2: 1 }, events).rows, [{ mission: 'SIM', date: '2026-10-07', id: 'F2' }]);
  assert.deepEqual(app.buildRows('ground', 'ignored', '2026-10-07', { F2: 1 }, events).rows, [{ mission: '', date: '2026-10-07', id: 'F2' }]);
  assert.match(app.buildRows('flight', '', '2026-10-07', { F1: 1 }, events).error, /mission number/);
  assert.match(app.buildRows('flight', 'sim', '2026-10-07', { F1: 1 }, events).error, /Sim button/);
  assert.match(app.buildRows('flight', '0123', '10/07/2026', { F1: 1 }, events).error, /YYYY-MM-DD/);
  assert.match(app.buildRows('flight', '0123', '2026-10-07', {}, events).error, /at least one/);
});

test('pendingRows counts rows across batches', () => {
  assert.equal(app.pendingRows([]), 0);
  assert.equal(app.pendingRows([{ rows: [1, 2] }, { rows: [3] }]), 3);
});

test('newBatchId is unique', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(app.newBatchId());
  assert.equal(ids.size, 100);
});

test('parseHandoff: reads url and token from the fragment, rejects anything else', () => {
  const url = 'https://script.google.com/macros/s/AKfy/exec';
  const hash = '#url=' + encodeURIComponent(url) + '&token=' + encodeURIComponent('abc123');
  assert.deepEqual(app.parseHandoff(hash), { url, token: 'abc123' });
  assert.deepEqual(app.parseHandoff(hash.slice(1)), { url, token: 'abc123' });
  assert.equal(app.parseHandoff(''), null);
  assert.equal(app.parseHandoff('#'), null);
  assert.equal(app.parseHandoff('#url=' + encodeURIComponent(url)), null);
  assert.equal(app.parseHandoff('#token=abc'), null);
  assert.equal(app.parseHandoff('#url=notaurl&token=abc'), null);
  assert.equal(app.parseHandoff('#url=%E0%A4%A&token=abc'), null);
});

test('volumeText', () => {
  assert.equal(app.volumeText({ 'Volume Accomplished': '' }), '');
  assert.equal(app.volumeText({ 'Volume Accomplished': 3, 'Volume Required': '' }), '3 this FY');
  assert.equal(app.volumeText({ 'Volume Accomplished': 2, 'Volume Required': 4, 'Percent Remaining': 0.5, 'Remaining Sim Credit': 1 }), '2 of 4 this FY, 50% remaining, 1 sim credit left');
  assert.equal(app.volumeText({ 'Volume Accomplished': 4, 'Volume Required': 4, 'Percent Remaining': 0, 'Remaining Sim Credit': 0 }), '4 of 4 this FY, 0% remaining');
});
