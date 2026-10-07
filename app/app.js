/*
 * Apollo app. Plain JS, no build step, no dependencies.
 *
 * The pure helpers at the top have no DOM and are unit-tested in Node
 * (tests/app.test.js). Everything that touches the page is inside the
 * block guarded by `typeof document !== 'undefined'`.
 *
 * The app does no currency or volume math. It shows the summary the
 * workbook script returns. Every date is a 'YYYY-MM-DD' Zulu string.
 */
'use strict';

var APP_VERSION = '2026.10.07.1';
var STORAGE = { settings: 'apollo.settings', data: 'apollo.data', queue: 'apollo.queue' };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Today's Zulu date. Never the phone's local date. */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
}

/** Whole days from a to b, both 'YYYY-MM-DD', on UTC calendar numbers. Display only. */
function daysBetween(a, b) {
  var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Colour band for a summary row, the same bands as the sheet's Due Date column. */
function dueBand(row, today) {
  if (row['Overdue'] === 'YES') return 'overdue';
  var due = row['Due Date'];
  if (!isIsoDate(due) || !isIsoDate(today)) return '';
  var d = daysBetween(today, due);
  if (d <= 30) return 'd30';
  if (d <= 60) return 'd60';
  if (d <= 90) return 'd90';
  return '';
}

/** 0 overdue, 1 CHECK LABEL, 2 has a due date, 3 no due date. */
function statusGroup(row) {
  if (row['Overdue'] === 'YES') return 0;
  if (row['Due Date'] === 'CHECK LABEL') return 1;
  if (isIsoDate(row['Due Date'])) return 2;
  return 3;
}

/** Overdue first, then by due date; ties keep config order. */
function sortSummary(summary) {
  return summary
    .map(function (r, i) { return { r: r, i: i }; })
    .sort(function (a, b) {
      var ga = statusGroup(a.r), gb = statusGroup(b.r);
      if (ga !== gb) return ga - gb;
      var da = String(a.r['Due Date'] || ''), db = String(b.r['Due Date'] || '');
      if (da !== db) return da < db ? -1 : 1;
      return a.i - b.i;
    })
    .map(function (x) { return x.r; });
}

/** Events offered for a mode. In Sim, 0% events are not offered. */
function eventsForMode(mode, data) {
  if (mode === 'ground') return data.ground || [];
  var flying = data.flying || [];
  if (mode === 'sim') return flying.filter(function (e) { return Number(e.percentCreditInSim) > 0; });
  return flying;
}

function filterEvents(events, query) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return events;
  return events.filter(function (e) {
    return String(e.id || '').toLowerCase().indexOf(q) !== -1 || String(e.name || '').toLowerCase().indexOf(q) !== -1;
  });
}

/**
 * Rows to append for one Save: one row per tap, in event order.
 * Returns { rows } or { error }.
 */
function buildRows(mode, mission, date, counts, events) {
  var m = String(mission || '').trim();
  if (!isIsoDate(date)) return { error: 'Enter the date as YYYY-MM-DD (Zulu).' };
  if (mode === 'flight') {
    if (!m) return { error: 'Enter the mission number.' };
    if (m.toUpperCase() === 'SIM') return { error: 'Use the Sim button for a simulator.' };
  }
  var missionValue = mode === 'flight' ? m : mode === 'sim' ? 'SIM' : '';
  var rows = [];
  for (var i = 0; i < events.length; i++) {
    var n = counts[events[i].id] || 0;
    for (var k = 0; k < n; k++) rows.push({ mission: missionValue, date: date, id: events[i].id });
  }
  if (!rows.length) return { error: 'Tap + on at least one event.' };
  return { rows: rows };
}

function pendingRows(queue) {
  var n = 0;
  for (var i = 0; i < queue.length; i++) n += queue[i].rows.length;
  return n;
}

function newBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Volume line for a summary row, or '' for ground rows. */
function volumeText(row) {
  var acc = row['Volume Accomplished'];
  var req = row['Volume Required'];
  if (acc === '' || acc == null) return '';
  if (req === '' || req == null) return acc + ' this FY';
  var pct = row['Percent Remaining'];
  var text = acc + ' of ' + req + ' this FY';
  if (typeof pct === 'number') text += ', ' + Math.round(pct * 100) + '% remaining';
  var sim = row['Remaining Sim Credit'];
  if (typeof sim === 'number' && sim > 0) text += ', ' + sim + ' sim credit left';
  return text;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  (function () {
    function load(key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        return fallback;
      }
    }
    function save(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage full or blocked */ }
    }
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }

    var settings = load(STORAGE.settings, { url: '', token: '' });
    var data = load(STORAGE.data, { ground: [], flying: [], summary: [], logCheck: [], asOf: '', lastSync: '' });
    var queue = load(STORAGE.queue, []);
    var ui = { tab: 'log', mode: 'flight', query: '', counts: {}, syncing: false, lastError: '' };
    var toastTimer = null;

    // ---- rendering ----

    function render() {
      renderTabs();
      renderTopline();
      renderLog();
      renderStatus();
      renderSettings();
    }

    function renderTabs() {
      document.querySelectorAll('.tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.tab === ui.tab);
      });
      ['log', 'status', 'settings'].forEach(function (name) {
        $('screen-' + name).classList.toggle('hidden', ui.tab !== name);
      });
    }

    function renderTopline() {
      var pending = pendingRows(queue);
      var parts = [];
      if (pending) parts.push(pending + (pending === 1 ? ' row' : ' rows') + ' waiting to sync');
      else if (ui.syncing) parts.push('Syncing…');
      else if (data.asOf) parts.push('As of ' + data.asOf);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) parts.push('offline');
      $('topline').textContent = parts.join(' · ');
    }

    function renderLog() {
      document.querySelectorAll('.seg-btn').forEach(function (b) {
        b.classList.toggle('on', b.dataset.mode === ui.mode);
      });
      $('mission-field').classList.toggle('hidden', ui.mode !== 'flight');
      if (!$('date').value) $('date').value = todayUtc();

      var events = filterEvents(eventsForMode(ui.mode, data), ui.query);
      var list = $('events');
      list.textContent = '';
      if (!eventsForMode(ui.mode, data).length) {
        list.appendChild(el('li', 'empty', data.asOf ? 'No events in this config tab.' : 'No config yet. Set the web app URL and token in Settings, then Sync now.'));
      }
      events.forEach(function (e) {
        var n = ui.counts[e.id] || 0;
        var li = el('li', 'event' + (n ? ' picked' : ''));
        var name = el('div', 'name');
        name.appendChild(el('b', null, e.name || e.id));
        name.appendChild(el('span', null, e.id));
        li.appendChild(name);
        var counter = el('div', 'counter');
        var minus = el('button', null, '−');
        minus.type = 'button';
        minus.dataset.id = e.id;
        minus.dataset.delta = '-1';
        minus.disabled = n === 0;
        minus.setAttribute('aria-label', 'Remove one ' + (e.name || e.id));
        var count = el('span', 'n' + (n ? '' : ' zero'), String(n));
        var plus = el('button', null, '+');
        plus.type = 'button';
        plus.dataset.id = e.id;
        plus.dataset.delta = '1';
        plus.setAttribute('aria-label', 'Add one ' + (e.name || e.id));
        counter.appendChild(minus);
        counter.appendChild(count);
        counter.appendChild(plus);
        li.appendChild(counter);
        list.appendChild(li);
      });

      var total = 0;
      Object.keys(ui.counts).forEach(function (id) { total += ui.counts[id]; });
      $('save').disabled = total === 0;
      $('save').textContent = total ? 'Save ' + total + (total === 1 ? ' row' : ' rows') : 'Save';
    }

    function renderStatus() {
      var head = [];
      if (data.asOf) head.push('As of ' + data.asOf);
      var pending = pendingRows(queue);
      head.push(pending + (pending === 1 ? ' row' : ' rows') + ' waiting to sync');
      if (ui.lastError) head.push(ui.lastError);
      $('status-head').textContent = head.join(' · ');

      var lc = $('logcheck');
      lc.textContent = '';
      if (data.logCheck && data.logCheck.length) {
        var card = el('div', 'card warn');
        card.appendChild(el('b', null, data.logCheck.length + ' log ' + (data.logCheck.length === 1 ? 'row needs' : 'rows need') + ' attention in the sheet'));
        var ul = el('ul');
        data.logCheck.forEach(function (p) {
          ul.appendChild(el('li', null, 'Row ' + p.row + ': ' + p.problem + ' (' + [p.mission, p.date, p.id].join(' | ') + ')'));
        });
        card.appendChild(ul);
        lc.appendChild(card);
      }

      var list = $('summary');
      list.textContent = '';
      if (!data.summary || !data.summary.length) {
        list.appendChild(el('li', 'empty', 'No summary yet. Set the web app URL and token in Settings, then Sync now.'));
        return;
      }
      var today = todayUtc();
      sortSummary(data.summary).forEach(function (r) {
        var band = dueBand(r, today);
        var li = el('li', 'item' + (band ? ' band-' + band : ''));
        var head = el('div', 'head');
        var left = el('div');
        left.appendChild(el('div', 'id', String(r['Task ID'])));
        left.appendChild(el('div', 'name', String(r['Task Name'] || '')));
        head.appendChild(left);
        var dueText = r['Overdue'] === 'YES' && !r['Due Date'] ? 'OVERDUE' : r['Due Date'] || 'No due date';
        if (r['Overdue'] === 'YES' && r['Due Date']) dueText = 'OVERDUE ' + r['Due Date'];
        head.appendChild(el('div', 'due' + (band ? ' band-' + band : ''), dueText));
        li.appendChild(head);
        var vol = volumeText(r);
        var last = r['Last Accomplished'] ? 'Last ' + r['Last Accomplished'] : 'Never logged';
        li.appendChild(el('div', 'vol', vol ? last + ' · ' + vol : last));
        list.appendChild(li);
      });
    }

    function renderSettings() {
      if (document.activeElement !== $('url')) $('url').value = settings.url || '';
      if (document.activeElement !== $('token')) $('token').value = settings.token || '';
      $('token').type = $('show-token').checked ? 'text' : 'password';
      var s = [];
      if (ui.syncing) s.push('Syncing…');
      else if (data.lastSync) s.push('Last sync ' + data.lastSync + 'Z');
      else s.push('Not synced yet');
      if (ui.lastError) s.push(ui.lastError);
      $('sync-status').textContent = s.join(' · ');
      $('version').textContent = APP_VERSION;
    }

    function toast(text) {
      var t = $('toast');
      t.textContent = text;
      t.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2500);
    }

    // ---- sync ----

    function apiUrl(params) {
      var base = String(settings.url || '').trim();
      return params ? base + (base.indexOf('?') === -1 ? '?' : '&') + params : base;
    }

    function parseResponse(res) {
      return res.text().then(function (text) {
        try {
          return JSON.parse(text);
        } catch (err) {
          throw new Error('Unexpected reply. Check the web app URL and that access is set to Anyone.');
        }
      });
    }

    function apiGet() {
      return fetch(apiUrl('token=' + encodeURIComponent(settings.token)), { method: 'GET', cache: 'no-store' }).then(parseResponse);
    }

    function apiPost(batch) {
      return fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ token: settings.token, batchId: batch.batchId, rows: batch.rows })
      }).then(parseResponse);
    }

    function applyPayload(payload) {
      data.ground = payload.ground || [];
      data.flying = payload.flying || [];
      data.summary = payload.summary || [];
      data.logCheck = payload.logCheck || [];
      data.asOf = payload.asOf || '';
      data.lastSync = new Date().toISOString().slice(0, 16).replace('T', ' ');
      save(STORAGE.data, data);
    }

    function sync() {
      if (ui.syncing) return Promise.resolve();
      if (!settings.url || !settings.token) {
        ui.lastError = 'Set the web app URL and token in Settings.';
        render();
        return Promise.resolve();
      }
      ui.syncing = true;
      ui.lastError = '';
      render();
      var applied = false;
      var step = function () {
        if (!queue.length) return applied ? Promise.resolve() : apiGet().then(check).then(applyPayload);
        var batch = queue[0];
        return apiPost(batch).then(check).then(function (payload) {
          queue.shift();
          save(STORAGE.queue, queue);
          applyPayload(payload);
          applied = true;
          return step();
        });
      };
      return step()
        .then(function () { ui.lastError = ''; })
        .catch(function (err) {
          var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          ui.lastError = offline ? 'Offline. Rows are saved and will sync later.' : (err && err.message) || 'Sync failed';
          if (!offline && err instanceof TypeError) ui.lastError = 'No connection. Rows are saved and will sync later.';
        })
        .then(function () {
          ui.syncing = false;
          render();
        });
    }

    function check(payload) {
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'The web app returned an error.');
      return payload;
    }

    // ---- events ----

    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      ui.tab = b.dataset.tab;
      render();
    });

    document.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b || b.dataset.mode === ui.mode) return;
      ui.mode = b.dataset.mode;
      ui.counts = {};
      render();
    });

    $('search').addEventListener('input', function (e) {
      ui.query = e.target.value;
      renderLog();
    });

    $('events').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      var id = b.dataset.id;
      var n = (ui.counts[id] || 0) + Number(b.dataset.delta);
      if (n <= 0) delete ui.counts[id];
      else ui.counts[id] = n;
      renderLog();
    });

    $('save').addEventListener('click', function () {
      var events = eventsForMode(ui.mode, data);
      var built = buildRows(ui.mode, $('mission').value, $('date').value, ui.counts, events);
      if (built.error) {
        toast(built.error);
        return;
      }
      queue.push({ batchId: newBatchId(), rows: built.rows });
      save(STORAGE.queue, queue);
      ui.counts = {};
      if (ui.mode === 'flight') $('mission').value = '';
      render();
      toast(built.rows.length + (built.rows.length === 1 ? ' row saved' : ' rows saved'));
      sync();
    });

    $('save-settings').addEventListener('click', function () {
      settings.url = $('url').value.trim();
      settings.token = $('token').value.trim();
      save(STORAGE.settings, settings);
      toast('Settings saved');
      sync();
    });

    $('show-token').addEventListener('change', renderSettings);
    $('sync-now').addEventListener('click', function () { sync(); });

    $('clear-data').addEventListener('click', function () {
      var pending = pendingRows(queue);
      var msg = pending
        ? 'This deletes ' + pending + ' unsynced ' + (pending === 1 ? 'row' : 'rows') + ', the saved summary, and the URL and token on this phone. The workbook is untouched. Continue?'
        : 'This deletes the saved summary and the URL and token on this phone. The workbook is untouched. Continue?';
      if (!window.confirm(msg)) return;
      Object.keys(STORAGE).forEach(function (k) { try { localStorage.removeItem(STORAGE[k]); } catch (err) { /* ignore */ } });
      settings = { url: '', token: '' };
      data = { ground: [], flying: [], summary: [], logCheck: [], asOf: '', lastSync: '' };
      queue = [];
      ui.counts = {};
      ui.lastError = '';
      render();
      toast('Local data cleared');
    });

    window.addEventListener('online', function () { sync(); });
    window.addEventListener('offline', render);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && pendingRows(queue)) sync();
    });

    // ---- start ----

    $('date').value = todayUtc();
    if (!settings.url || !settings.token) ui.tab = 'settings';
    render();
    if (settings.url && settings.token) sync();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ });
    }
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP_VERSION: APP_VERSION,
    todayUtc: todayUtc,
    isIsoDate: isIsoDate,
    daysBetween: daysBetween,
    dueBand: dueBand,
    statusGroup: statusGroup,
    sortSummary: sortSummary,
    eventsForMode: eventsForMode,
    filterEvents: filterEvents,
    buildRows: buildRows,
    pendingRows: pendingRows,
    newBatchId: newBatchId,
    volumeText: volumeText
  };
}
