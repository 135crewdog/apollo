'use strict';
/*
 * A stand-in for the workbook's web app, used by the browser smoke test.
 * Same payloads and rules as Code.js, with the sheet replaced by memory.
 * Node only; not part of the app.
 */
const http = require('node:http');
const rules = require('../../apps-script/rules.js');

function createMockApi({ token, ground, flying, log = [], today }) {
  // delay: milliseconds to hold every reply, so a test can act while a call is in flight.
  const state = { log: log.slice(), batchIds: [], posts: 0, delay: 0 };
  const payload = () => ({
    ok: true,
    asOf: today,
    ground: ground.map((g) => ({ id: g.id, name: g.name, frequency: g.label })),
    flying: flying.map((f) => ({ id: f.id, name: f.name, currency: f.label, volumeRequired: rules.parseVolume(f.volumeRequired), percentCreditInSim: rules.parsePercent(f.percentCreditInSim) })),
    summary: rules.buildSummary(ground, flying, state.log, today).map((row) => ({ band: rules.dueBand(row, today), ...row })),
    logCheck: rules.checkLog(state.log.map((r, i) => ({ ...r, row: i + 2 })), ground, flying, today),
  });
  const server = http.createServer((req, res) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const send = (body) => setTimeout(() => { res.writeHead(200, headers); res.end(JSON.stringify(body)); }, state.delay);
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      if (url.searchParams.get('token') !== token) return send({ ok: false, error: 'Bad token' });
      return send(payload());
    }
    let text = '';
    req.on('data', (c) => { text += c; });
    req.on('end', () => {
      state.posts++;
      let body;
      try { body = JSON.parse(text); } catch (e) { return send({ ok: false, error: 'Body is not valid JSON' }); }
      if (body.token !== token) return send({ ok: false, error: 'Bad token' });
      if (!body.batchId) return send({ ok: false, error: 'batchId is required' });
      if (!state.batchIds.includes(body.batchId)) {
        for (const r of body.rows || []) {
          if (!rules.parseDate(r.date)) return send({ ok: false, error: 'date must be YYYY-MM-DD' });
          state.log.push({ mission: String(r.mission || ''), date: r.date, id: String(r.id) });
        }
        state.batchIds.push(body.batchId);
      }
      send(payload());
    });
  });
  return { server, state };
}

module.exports = { createMockApi };
