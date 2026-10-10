# Apollo

Personal KC-135 aircrew training tracker. `CLAUDE.md` is the spec. Setting up a workbook and the app is described once, in the guide at `https://135crewdog.github.io/apollo/guide/`, which also carries the script code live from this repository. This file is for working on the code.

```
apps-script/rules.js   pure functions: due dates, which rows count, summary columns, bands, log check
apps-script/Code.js    sheet reading/writing, refresh, Apollo menu, doGet, doPost
app/                   the app (PWA): plain HTML, CSS and JS, no build step
app/guide/             the setup guide
tests/                 node --test, plus a browser smoke test in tests/browser/
```

## Run the tests

```
node --test                            # rules, the app's pure helpers, and Code.js against an in-memory workbook
node tests/browser/smoke.js            # needs Playwright with Chromium; drives the app against a mock API
node tests/browser/smoke.js ./shots    # same, and saves a screenshot of each screen
```

## Changing the script

`rules.js` holds every rule and is unit-tested in Node; `Code.js` only moves data between the sheet, the rules and the API. After a change, bump `SCRIPT_VERSION` in `Code.js`; every workbook takes it the same way: paste the current files over `Code.gs` and `rules.gs` in Extensions → Apps Script, save, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. Without the new version the sheet's triggers run the new code while the web app URL keeps serving the old one. The URL and token do not change.

## Check the web app from a browser

Paste `WEB_APP_URL?token=YOUR_TOKEN` into a browser. The reply is JSON:

```
{ "ok": true, "asOf": "2026-10-05", "ground": [...], "flying": [...], "summary": [...], "logCheck": [...] }
```

`summary` is one object per summary row, keyed by the summary tab's column headers, plus `band` (`overdue`, `d30`, `d60`, `d90` or empty). `Percent Complete` is a fraction (0.5 is 50%). Dates are `YYYY-MM-DD` strings. `logCheck` lists log rows that need attention, with their sheet row number and the problem. A problem comes back as `{ "ok": false, "error": "..." }`.

## API

- `GET ?token=…` computes the summary without writing the sheet and returns the payload above.
- `POST` with `Content-Type: text/plain` and body `{ "token": "…", "batchId": "…", "rows": [{ "mission": "", "date": "YYYY-MM-DD", "id": "…" }] }` appends the rows to the Training Log (the Due Date Override column stays blank), rewrites the summary tab, and returns the same payload. `mission` is blank for ground training, `SIM` for the simulator, or the mission number. The last 50 `batchId` values are remembered, so a retried POST with the same `batchId` appends nothing and still returns success.

## Changing the app

The app is static files published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches `app/`, at `https://135crewdog.github.io/apollo/`. One hosted copy serves everyone; each person's data stays in their own workbook. Pages was turned on once in the repo under **Settings → Pages → Source: GitHub Actions**.

When you change anything under `app/`, bump `VERSION` in `app/sw.js` and `APP_VERSION` in `app/app.js`, or devices keep the old copy. The app does no currency, volume or date math; it displays what the script returns.
