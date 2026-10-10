'use strict';
/*
 * Browser smoke test for the app. Needs Playwright with Chromium installed
 * (a developer tool, not an app dependency): `node tests/browser/smoke.js`.
 * Serves app/ on one port and the mock API on another, then drives the app:
 * settings, sync, a flight with two landings, an offline save that syncs
 * when the connection returns, a full store, a second tab, a URL change with
 * rows pending, a late reply after Clear, the handoff link, the guide, and the
 * service worker.
 * Pass a directory as the first argument to save a screenshot of each screen there.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createMockApi } = require('./mock-api.js');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const TODAY = new Date().toISOString().slice(0, 10);

function serveApp() {
  // While server.down is true every request is dropped mid-connection, so a service worker's
  // own fetch fails the way it does with no network (a context's offline mode does not reach it).
  const server = http.createServer((req, res) => {
    if (server.down) { req.destroy(); return; }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(APP_DIR, p);
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  server.down = false;
  return server;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function main() {
  const { chromium } = require('playwright');
  const ground = [{ id: 'GD27YM', name: 'CRM/TEM Refresher', label: 'Annual' }];
  const flying = [
    { id: 'AL01YM', name: 'Landing', label: 'Monthly', volumeRequired: 12, percentCreditInSim: 1 },
    { id: 'AN01YM', name: 'NVG Sortie', label: 'N/A', volumeRequired: '', percentCreditInSim: 0 },
    { id: 'RT05YM', name: 'Tanker AAR Autopilot Off', label: 'Semi-Annual', volumeRequired: 4, percentCreditInSim: 0.5 },
  ];
  const api = createMockApi({ token: 'abc123', ground, flying, today: TODAY, log: [{ mission: '', date: '2025-05-01', id: 'GD27YM' }] });
  const appServer = serveApp();
  const [appPort, apiPort] = await Promise.all([listen(appServer), listen(api.server)]);
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const apiUrl = `http://127.0.0.1:${apiPort}/exec`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The offline step makes the browser log its own failed fetch; that is expected.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shots = process.argv[2];
  const shot = async (name, p = page) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };

  try {
    await page.goto(appUrl);
    // With no settings the app opens on Settings.
    assert.equal(await page.isVisible('#screen-settings'), true, 'opens on Settings when unconfigured');
    assert.equal(await page.isVisible('#view-main'), false, 'main view hidden behind Settings');
    await page.fill('#url', apiUrl);
    await page.fill('#token', 'wrong');
    await page.click('#save-settings');
    await page.waitForFunction(() => document.getElementById('settings-error').textContent.includes('Bad token'));
    await page.fill('#token', 'abc123');
    await page.click('#save-settings');
    await page.waitForFunction(() => document.getElementById('sync-status').textContent.startsWith('Last sync'));
    await shot('settings');
    // Theme setting applies to the document and persists.
    await page.selectOption('#theme', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await shot('settings-dark');
    await page.selectOption('#theme', 'light');
    await page.click('#done');
    assert.equal(await page.isVisible('#view-main'), true, 'Done returns to the main view');

    // Status: overdue first. Never-logged AL01YM and RT05YM (blank due date) sort ahead of
    // GD27YM (Annual from 2025-05-01, due 2026-09-30, overdue); AN01YM has no due date and is last.
    await page.click('.seg-tabs button[data-tab="status"]');
    const order = await page.locator('#summary .item .id').allTextContents();
    assert.deepEqual(order, ['AL01YM', 'RT05YM', 'GD27YM', 'AN01YM'], 'status order');
    assert.match(await page.textContent('#status-head'), /^As of \d{2}-[A-Z][a-z]{2}-\d{2} /, 'As of in DD-Mmm-YY');
    const names = await page.locator('#summary .item .name').allTextContents();
    assert.deepEqual(names, ['Landing', 'Tanker AAR Autopilot Off', 'CRM/TEM Refresher', 'NVG Sortie'], 'task name leads');
    const dues = await page.locator('#summary .item .due').allTextContents();
    assert.deepEqual(dues, ['OVERDUE', 'OVERDUE', 'OVERDUE 30-Sep-26', 'No due date'], 'due badges in DD-Mmm-YY');
    assert.deepEqual(await page.locator('#summary .item .due').evaluateAll((els) => els.map((e) => e.className)), ['due band-overdue', 'due band-overdue', 'due band-overdue', 'due'], 'bands from the payload');
    await shot('status-before');

    // Status search narrows by name or ID, and clears back to the full list.
    await page.fill('#status-search', 'tanker');
    assert.deepEqual(await page.locator('#summary .item .id').allTextContents(), ['RT05YM'], 'status search by name');
    await page.fill('#status-search', 'gd27');
    assert.deepEqual(await page.locator('#summary .item .id').allTextContents(), ['GD27YM'], 'status search by id');
    await page.fill('#status-search', 'zzz');
    assert.equal(await page.textContent('#summary .empty'), 'No events match.', 'status search empty state');
    await page.fill('#status-search', '');
    assert.equal(await page.locator('#summary .item').count(), 4, 'status search cleared');

    // Log a flight with two landings; the 0% NVG event is offered in Flight.
    await page.click('.seg-tabs button[data-tab="log"]');
    await page.click('.toggle-group button[data-mode="flight"]');
    assert.equal(await page.inputValue('#date'), TODAY, 'date defaults to the Zulu date');
    const shown = await page.textContent('#date-display');
    assert.match(shown, /^\d{2}-[A-Z][a-z]{2}-\d{2}$/, 'date shown as DD-Mmm-YY: ' + shown);
    await page.fill('#date', '2026-10-03');
    assert.equal(await page.textContent('#date-display'), '03-Oct-26', 'display follows the picker');
    await page.fill('#date', TODAY);
    assert.equal(await page.locator('#events .event').count(), 3, 'all flying events in Flight');
    assert.deepEqual(await page.locator('#events ul').evaluateAll((els) => els.map((u) => u.dataset.group)), ['AL', 'AN', 'RT'], 'one card per Task ID prefix, no headings');
    assert.equal(await page.locator('#events .group').count(), 0, 'no group headings');
    await page.fill('#search', 'zzz');
    assert.equal(await page.textContent('#events .empty'), 'No events match.', 'Log search empty state');
    await page.fill('#search', 'land');
    assert.equal(await page.locator('#events .event').count(), 1);
    assert.deepEqual(await page.locator('#events ul').evaluateAll((els) => els.map((u) => u.dataset.group)), ['AL'], 'only groups with matches keep a card');
    await page.click('#events button[data-id="AL01YM"][data-delta="1"]');
    await page.click('#events button[data-id="AL01YM"][data-delta="1"]');
    assert.equal(await page.textContent('#save'), 'Save 2 rows');
    await page.fill('#search', '');
    await shot('log-flight');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('mission number'));
    await page.fill('#mission', '0123');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    assert.equal(api.state.log.filter((r) => r.id === 'AL01YM' && r.mission === '0123').length, 2, 'two landing rows reached the API');

    // Sim hides the 0% event.
    await page.fill('#search', '');
    await page.click('.toggle-group button[data-mode="sim"]');
    assert.equal(await page.locator('#events .event').count(), 2, '0% event hidden in Sim');
    assert.equal(await page.isVisible('#mission-field'), false, 'no mission field in Sim');

    // Offline: save a sim AAR row, it waits; back online it syncs once.
    await context.setOffline(true);
    await page.click('#events button[data-id="RT05YM"][data-delta="1"]');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('1 row waiting to sync'));
    const postsBefore = api.state.posts;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    assert.equal(api.state.log.filter((r) => r.id === 'RT05YM' && r.mission === 'SIM').length, 1, 'sim row synced after reconnect');
    assert.equal(api.state.posts, postsBefore + 1, 'exactly one POST after reconnect');

    // Status reflects the new volume: 2 of 12 landings.
    await page.click('.seg-tabs button[data-tab="status"]');
    const landing = await page.locator('#summary .item', { hasText: 'AL01YM' }).textContent();
    assert.ok(landing.includes('2 of 12 this FY'), 'volume shown from the summary: ' + landing);
    await shot('status-after');

    // Space on a focused stepper counts one and keeps the keyboard on that stepper.
    await page.click('.seg-tabs button[data-tab="log"]');
    await page.click('.toggle-group button[data-mode="flight"]');
    await page.focus('#events button[data-id="AL01YM"][data-delta="1"]');
    await page.keyboard.press('Space');
    assert.equal(await page.textContent('#save'), 'Save 1 row', 'Space counts one');
    assert.deepEqual(await page.evaluate(() => [document.activeElement.dataset.id, document.activeElement.dataset.delta]), ['AL01YM', '1'], 'focus stays on the stepper');
    await page.keyboard.press('Space');
    assert.equal(await page.textContent('#save'), 'Save 2 rows');

    // A full or blocked store: Save says so and the taps stay on the screen; nothing is queued.
    await page.fill('#mission', '0456');
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__realSetItem = real;
      Storage.prototype.setItem = function (k, v) { if (k === 'apollo.queue') throw new DOMException('full', 'QuotaExceededError'); return real.call(this, k, v); };
    });
    const postsBeforeQuota = api.state.posts;
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('storage is full or blocked'));
    assert.equal(await page.textContent('#save'), 'Save 2 rows', 'taps kept after a failed save');
    assert.equal(await page.inputValue('#mission'), '0456', 'mission kept after a failed save');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apollo.queue')).length), 0, 'nothing queued');
    assert.equal(api.state.posts, postsBeforeQuota, 'nothing sent');
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    assert.equal(api.state.log.filter((r) => r.mission === '0456').length, 2, 'the kept taps save once storage works');

    // A second tab in the same browser watches; only the first logs. Closing it frees the lock.
    const tab2 = await context.newPage();
    tab2.on('pageerror', (e) => errors.push(e.message));
    await tab2.goto(appUrl);
    await tab2.waitForSelector('#events .event');
    assert.ok((await tab2.textContent('#lock-notice')).includes('open in another tab'), 'second tab shows the notice');
    assert.equal(await tab2.isDisabled('#events button[data-id="AL01YM"][data-delta="1"]'), true, 'steppers off in the second tab');
    assert.equal(await tab2.isDisabled('#save'), true, 'Save off in the second tab');
    assert.equal(await page.textContent('#lock-notice'), '', 'first tab keeps logging');
    assert.equal(await page.isDisabled('#events button[data-id="AL01YM"][data-delta="1"]'), false);
    await shot('log-second-tab', tab2);
    // The watching tab shows the logging tab's pending count.
    await context.setOffline(true);
    await page.click('#events button[data-id="AL01YM"][data-delta="1"]');
    await page.fill('#mission', '0789');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('1 row waiting to sync'));
    await tab2.waitForFunction(() => document.getElementById('status-head').textContent.includes('1 row waiting to sync'));
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    await tab2.close();
    // The first tab holds on; a new tab after the close gets the lock only if the first is gone.
    await page.reload();
    await page.waitForSelector('#events .event');
    assert.equal(await page.textContent('#lock-notice'), '', 'a reloaded single tab logs');

    // A new web app URL is refused while rows are pending; the draft survives the refusal.
    await context.setOffline(true);
    await page.click('#events button[data-id="AL01YM"][data-delta="1"]');
    await page.fill('#mission', '0321');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('1 row waiting to sync'));
    await page.click('#settings-btn');
    await page.fill('#url', apiUrl + '?other=1');
    await page.click('#save-settings');
    await page.waitForFunction(() => document.getElementById('settings-error').textContent.includes('Sync them first'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apollo.settings')).url), apiUrl, 'URL unchanged with rows pending');
    assert.equal(await page.inputValue('#url'), apiUrl + '?other=1', 'the typed URL is still in the field');
    // Settings drafts survive a sync.
    await page.fill('#url', apiUrl);
    await page.fill('#token', 'draft-not-saved');
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.getElementById('sync-status').textContent.startsWith('Last sync'));
    await page.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    assert.equal(await page.inputValue('#token'), 'draft-not-saved', 'draft token survives a sync');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apollo.settings')).token), 'abc123', 'saved token untouched');
    assert.equal(api.state.log.filter((r) => r.mission === '0321').length, 1, 'pending row synced to the current workbook');
    await page.click('#done');
    await page.click('#settings-btn');
    assert.equal(await page.inputValue('#token'), 'abc123', 'reopening Settings shows the saved token');
    await page.click('#done');

    // Local state survives a reload, and the service worker is registered.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null || (navigator.serviceWorker.getRegistrations && true));
    const reg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r));
    assert.equal(reg, true, 'service worker registered');
    assert.equal(await page.isVisible('#view-main'), true, 'configured app opens on the main view');
    await page.click('#settings-btn');
    assert.equal(await page.inputValue('#url'), apiUrl, 'settings persisted');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'theme persisted');
    await page.click('#done');

    // Offline, the whole shell (page, script, styles) comes from the service worker's cache.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    appServer.down = true;
    await page.reload();
    await page.waitForSelector('#events .event');
    const appVersion = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
    assert.equal(await page.textContent('#version'), appVersion, 'script loaded from cache offline');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.app')).maxWidth), '720px', 'styles loaded from cache offline');
    appServer.down = false;

    // The handoff link: a fresh device opens the app URL with the connection in the fragment.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await fresh.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(appUrl + '#url=' + encodeURIComponent(apiUrl) + '&token=' + encodeURIComponent('abc123'));
    await p2.waitForFunction(() => document.getElementById('status-head').textContent.includes('0 rows waiting'));
    assert.equal(await p2.isVisible('#view-main'), true, 'handoff opens on the main view');
    assert.equal(await p2.evaluate(() => window.location.hash), '', 'fragment stripped after handoff');
    assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('apollo.settings')).token), 'abc123', 'token saved from the handoff');
    await p2.click('#settings-btn');
    assert.equal(await p2.inputValue('#url'), apiUrl, 'url saved from the handoff');

    // A reply that arrives after Clear local data is dropped.
    p2.on('dialog', (d) => d.accept());
    api.state.delay = 1500;
    await p2.click('#sync-now');
    await p2.click('#clear-data');
    await p2.waitForFunction(() => document.getElementById('toast').textContent.includes('Local data cleared'));
    await p2.waitForTimeout(2500);
    api.state.delay = 0;
    assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('apollo.data') || 'null')), null, 'late reply not stored after Clear');
    assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('apollo.settings')).url), '', 'connection stays cleared');
    assert.equal(await p2.inputValue('#url'), '', 'the URL field is cleared');
    assert.equal(await p2.textContent('#sync-status'), 'Not synced yet', 'no sync recorded');
    // A cold offline visit to a page never saved on this device says so rather than becoming the app.
    await p2.evaluate(() => navigator.serviceWorker.ready);
    appServer.down = true;
    const cold = await fresh.newPage();
    await cold.goto(appUrl + 'guide/');
    assert.match(await cold.textContent('body'), /^Offline\. This page has not been saved on this device yet/, 'offline guide shows the offline text');
    assert.notEqual(await cold.title(), 'Apollo', 'offline guide is not the app shell');
    // The app's own address still opens from the cache.
    await cold.goto(appUrl);
    await cold.waitForSelector('#screen-settings');
    assert.equal(await cold.title(), 'Apollo', 'the app shell comes from the cache');
    appServer.down = false;
    await cold.close();
    await fresh.close();

    // Another app's cache on the same origin survives the service worker's activation.
    const shared = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await shared.addInitScript(() => { window.__seed = caches.open('showtime-v1'); });
    const p3 = await shared.newPage();
    p3.on('pageerror', (e) => errors.push(e.message));
    await p3.goto(appUrl);
    await p3.evaluate(() => window.__seed.then(() => navigator.serviceWorker.ready));
    await p3.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.startsWith('apollo-'))));
    assert.equal(await p3.evaluate(() => caches.has('showtime-v1')), true, 'showtime cache kept');
    await shared.close();

    // The guide page: loads under the app's scope, fetches the two script files, and the
    // service worker does not swap it for the app shell.
    const guide = await context.newPage();
    guide.on('pageerror', (e) => errors.push(e.message));
    await guide.route('https://raw.githubusercontent.com/**', (route) => {
      const name = route.request().url().split('/').pop();
      route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', name), 'utf8') });
    });
    await guide.goto(appUrl + 'guide/');
    assert.equal(await guide.title(), 'Apollo setup guide', 'guide page served, not the app shell');
    await guide.waitForFunction(() => !document.getElementById('code-js').classList.contains('loading') && !document.getElementById('rules-js').classList.contains('loading'));
    assert.ok((await guide.textContent('#code-js')).includes('function doPost'), 'Code.js shown');
    assert.ok((await guide.textContent('#rules-js')).includes('function dueDate'), 'rules.js shown');
    assert.match(await guide.getAttribute('#template-link', 'href'), /\/copy$/, 'template copy link');
    await guide.reload();
    assert.equal(await guide.title(), 'Apollo setup guide', 'guide still served after the service worker is active');
    await shot('guide', guide);
    await guide.close();

    assert.deepEqual(errors, [], 'no page errors');
    console.log('browser smoke test passed');
  } finally {
    await browser.close();
    appServer.close();
    api.server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
