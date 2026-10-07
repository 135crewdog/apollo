'use strict';
/*
 * Browser smoke test for the app. Needs Playwright with Chromium installed
 * (a developer tool, not an app dependency): `node tests/browser/smoke.js`.
 * Serves app/ on one port and the mock API on another, then drives the app:
 * settings, sync, a flight with two landings, an offline save that syncs
 * when the connection returns, and the service worker.
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
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(APP_DIR, p);
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
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
  // Panels slide for 300 ms, so let a screenshot wait for the transition to finish.
  const shot = async (name) => { if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, name + '.png') }); } };

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
    await shot('status-before');

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
    assert.deepEqual(await page.locator('#events .group').allTextContents(), ['AL', 'AN', 'RT'], 'group headings by Task ID prefix');
    await page.fill('#search', 'land');
    assert.equal(await page.locator('#events .event').count(), 1);
    assert.deepEqual(await page.locator('#events .group').allTextContents(), ['AL'], 'only groups with matches keep a heading');
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

    // Local state survives a reload, and the service worker is registered.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null || (navigator.serviceWorker.getRegistrations && true));
    const reg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r));
    assert.equal(reg, true, 'service worker registered');
    assert.equal(await page.isVisible('#view-main'), true, 'configured app opens on the main view');
    await page.click('#settings-btn');
    assert.equal(await page.inputValue('#url'), apiUrl, 'settings persisted');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'theme persisted');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('browser smoke test passed');
  } finally {
    await browser.close();
    appServer.close();
    api.server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
