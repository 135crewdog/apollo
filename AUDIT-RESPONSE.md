# Response to the external audit of 10 October 2026

Lead: Claude Code. Audited commit: `4aba7af` (current `main` at the time of this response). Spec: `CLAUDE.md`. This document revalidates every finding in the external handoff against HEAD and the spec, gives each an explicit disposition, and proposes the correction packages. Nothing was merged, deployed, published or changed in live records or sharing to produce it. Each package goes through the established flow: agree, build, open a PR, wait for review.

## 1. Revalidation method and what was verified

- Read the handoff against the current checkout. HEAD is the audited commit, so every file:line reference is live.
- Reproduced the rules findings with the repository's own `rules.js` in Node: R1, R2, R4 and R5 reproduce exactly as reported.
- Confirmed the app, service-worker and adapter findings by reading the code paths cited. Where the handoff's claim rests on a browser or Google probe I could not repeat here, the disposition says "confirmed by code" rather than "reproduced".
- Re-checked the live workbook read-only: the PRORATED row exists at Training Log row 71. The conditional-format ranges on the summary tab now cover D2:D1000 (verified after the owner's redeploy earlier today), so W2 is resolved on this workbook; the guard that let it happen is still addressed below.
- Could not verify the live workbook's sharing through the Drive connector (the file is not visible to it by ID), so W3 is carried as an owner question, not a verified state.
- Prior owner decisions reused without re-asking: on-edit trigger kept; GET computes without writing; bands live in the rules; duplicate-ID check skipped; Code.js tests added; sentence case; no app shell; 720px column; eight-character lowercase token accepted; Due Date Override is the mechanism for document-stated expirations; nothing is hardcoded per event.

Status words used below: **reproduced** (run here), **confirmed** (by code reading at HEAD), **resolved** (already fixed on HEAD or on the live workbook), **limitation** (true, accepted and documented rather than fixed), **rejected** (not a defect under the spec, or already decided the other way by the owner), **policy** (needs an owner decision), **integration** (needs a check in a disposable Google workbook).

## 2. Disposition of every finding

| ID | Status | Severity | Disposition | Package |
|---|---|---|---|---|
| A1 two tabs lose rows | confirmed | data risk, low likelihood | Fix: re-read the queue from storage before every mutation and remove acknowledged batches by ID; refresh in-memory state on the `storage` event. Residual window of simultaneous writes documented. No IndexedDB. | 1 |
| A2 failed storage write reports saved | confirmed | data risk | Fix: `save()` returns success; a failed queue write keeps the taps and mission and shows a recoverable error; a failed acknowledgement write keeps the batch in memory and retries next sync (the batch ID dedupe makes that safe). | 1 |
| A3 pending rows sent to another workbook | confirmed | data risk | Fix: refuse a web-app URL change (Settings or handoff) while rows are pending, naming the count and the two ways out (sync, or clear local data); a token-only change on the same URL is allowed; each sync captures URL and token at start. | 1 |
| A4 stale default date after resume | confirmed | confusing | Fix: on becoming visible, advance a date the user has not touched to today's Zulu date, and sync when the stored `asOf` is not today. A deliberately chosen date is kept. | 1 |
| A5 cleared data repopulated by a late reply | confirmed | confusing | Fix: a generation counter; a reply from an earlier generation is dropped; acknowledgements remove their batch by ID. Clearing never claims to undo a committed append. | 1 |
| A6 settings draft overwritten | confirmed | confusing | Fix: inputs are populated when Settings opens and after Save or Clear, never by a status re-render. | 1 |
| A7 stepper loses keyboard focus | confirmed | accessibility | Fix: after the list re-renders, focus returns to the same stepper button; a minus button that became disabled hands focus to its plus. | 1 |
| A8 contrast and control semantics | confirmed (3.26:1 computed) | accessibility | Fix: `aria-pressed` on Flight/Sim/Ground, `aria-controls` and arrow-key handling on the tabs, visible focus on the date wrapper. Darkening the secondary and error text is a palette decision (owner question 5); the due-date band colors are untouched either way. | 1 |
| S1 unlocked menu and trigger refreshes | confirmed | wrong result (stale sheet), rare | Fix: one `withLock` around every compute-and-write path (open, edit, menu, POST), `SpreadsheetApp.flush()` before release, inner helpers unlocked. A human sorting the sheet is still outside any lock; the spec already says so. | 2 |
| S2 retry gap and 50-ID horizon | limitation, partly fixed | data risk, rare | Fix: bound batch ID length and batch size before any mutation; flush the append before writing the receipt; a corrupt receipt list fails the request visibly instead of becoming empty. The 50-batch horizon stays and is already in the spec; a stronger guarantee would need a second record outside the four-column log, which the spec forbids. | 2 |
| S3 duplicate headers split read and write | confirmed | wrong result | Fix: one header parser (first occurrence) used by both paths; a duplicated required header is an error before any append, naming the columns. | 2 |
| S4 no grid growth | confirmed | failure at capacity | Fix: grow rows before an append or summary write that would overflow, and columns before adding a missing header; modest increments. The test double gains strict bounds. | 2 |
| S5 any write error rebuilds the tab | confirmed | data risk (sheet ID), rare | Fix: rebuild only when the header cell is wrong after a write (the Table signature); every other error propagates and the tab stays. | 2 |
| S6 leading `=` in mission or ID | confirmed acceptance; integration | wrong result if Sheets evaluates it | Fix: reject a mission number or Training ID that starts with `=` at both ends (app `buildRows`, script `validateRows`). The text-format behavior of `setValues` is noted as an integration check; rejection makes it moot for the log. | 1 and 2 |
| S7 row deletion does not fire onEdit | integration, Google semantics | confusing | Document: a deleted row takes effect at the next open, menu refresh or app save; the app's own data is always fresh because GET computes. No installable trigger (authorization and loop risk outweigh it). | 3 |
| S8 timezone read per cell; narrow format guard | confirmed | efficiency | Fix: read the time zone once per log read. Guard the one-time formatting on the conditional rules' range (one read) rather than one cell's text format, so a tab with short rules is repaired once. | 2 |
| R1 29% of 100 floors to 28 | reproduced | wrong result for future config | Fix: a tiny tolerance in the cap only (`floor(x + 1e-9)`); a true cap of 2.5 still floors to 2. Regression at and just below integer boundaries. | 2 |
| R2 negative or infinite config | reproduced | wrong result for bad config | Fix: percent clamped to 0..1 and finite, volume finite; blank and `X` unchanged. | 2 |
| R3 duplicate IDs across tabs | rejected | | Owner decision of 2026-10-10 stands: no check. Noted that the app cannot select the same ID in two modes at once, so the counter concern does not arise in practice. | none |
| R4 same-date override conflict | reproduced | policy | Owner question 1. Proposed rule: the earliest override wins and the later row is reported by the log check. | 2 after decision |
| R5 extreme intervals | reproduced | cosmetic | Fix: a label beyond 100 years, 1200 months or 36500 days is `CHECK LABEL`. | 2 |
| D1 deletes sibling caches on the origin | confirmed | breaks Show Time's offline cache | Fix: delete only cache names with the `apollo-` prefix. Real and immediate: Show Time shares the `135crewdog.github.io` origin. | 1 |
| D2 page and script coherence under partial failure | limitation | rare, seconds-wide | Document: both files are fetched network-first from the same host within the same second, and a failure of one almost always means both are served from the cache together. The spec's "always" becomes "in practice". No new caching strategy; the owner chose network-first on 2026-10-09. | 3 |
| D3 offline guide shows the app | confirmed | confusing | Fix: the app-shell fallback applies only to the app's own route; any other uncached page offline gets a plain "offline" response. | 1 |
| D4 backfill guidance erases SIM classification | confirmed | wrong result for this-FY backfill | Fix the guide: for rows dated this fiscal year, write `SIM` for a simulator accomplishment and anything else for an aircraft one; for earlier rows the mission text does not matter. State the limit of an aggregate ITS count. The owner's own backfill is all FY26, so no live row is affected. | 3 |
| D5 tests depend on the real clock | confirmed | test debt | Fix: freeze `Date` inside the adapter test's VM context; derive the smoke test's dated expectations from the rules. | 4 |
| D6 deploy not gated on tests | confirmed | release risk | Fix: `pages.yml` runs `node --test` before deploying. Adding the browser smoke to CI is owner question 4 (development tooling only). | 4 |
| D7 two script files from moving `main`; no script revision in the API | confirmed | support debt | Fix: a `SCRIPT_VERSION` constant in `Code.js`, returned in the payload and shown under the app version in Settings, so a stale deployment is visible. The two-fetch window in the guide is documented, not engineered away. | 2 and 1 |
| W1 saved summary matches the rules | verified by the audit | | No action. | none |
| W2 color rules stopped at row 86 | resolved live; guard improved | | Verified D2:D1000 after today's redeploy. The guard change under S8 prevents the same gap on any other workbook. | 2 |
| W3 workbook readable by anyone with the link | policy | | Owner question 2. The connector cannot read this file's sharing, so the audit's observation is carried as stated. | owner |
| W4 PRORATED row establishes currency | policy | | Owner question 3. No code is proposed for PRORATED; if it is administrative relief, the override column on row 70 is the documented mechanism. | owner |
| W5, W6 | no action | | Accurate observations with nothing to change. | none |
| Token in GET query; eight characters | rejected | | Owner decision of 2026-10-08 stands. Documented in the spec already. | none |
| Endpoint format validation | rejected | | The development mock uses a plain HTTP endpoint; a production-only rule would be a special case. The handoff already requires `http(s)`. | none |
| Guide wording (never-logged, GET, device cache, update timing, "Copied") | confirmed | cosmetic | Fix the sentences. | 3 |

## 3. Packages

Four PRs, each reviewable on its own. Packages 1 and 2 are independent; 3 and 4 follow.

### Package 1: the app and its service worker (A1–A8, D1, D3, S6 app side, D7 app side)

Changes in `app/app.js`, `app/index.html`, `app/style.css`, `app/sw.js`; version bump.

- Queue discipline: every mutation re-reads `apollo.queue`, applies, writes back; acknowledgement removes by `batchId`; `storage` events refresh the in-memory copy and the pending count. Format unchanged: `[{ batchId, rows }]`.
- `save()` reports failure; Save keeps its state on failure; acknowledgement failure keeps the batch.
- URL change refused while pending rows exist (Settings save and handoff alike); token-only change allowed; sync captures its connection at start.
- Generation counter for Clear local data and connection changes; late replies dropped.
- Visibility: untouched default date advances; sync when `asOf` is stale.
- Settings inputs populated only on open, Save and Clear.
- Focus restored to the stepper after re-render.
- `aria-pressed` on kinds, `aria-controls` on tabs with arrow keys, `:focus-within` on the date wrapper; palette change only if owner question 5 says yes.
- `buildRows` rejects a mission number starting with `=`.
- Service worker: delete only `apollo-*` caches; shell fallback only for the app route, plain offline response otherwise.
- Settings shows the script version from the payload when present.

Tests: smoke-test steps for a quota-failing save (storage stubbed), a second tab saving while the first has pending rows, a URL change refused with pending rows, a late reply after Clear, settings drafts surviving a sync, Space on a focused stepper, a seeded `showtime-*` cache surviving activation, and a cold offline visit to the guide URL. Unit tests for the queue helpers.

Migration: existing pending batches keep their IDs and shape; a batch made before this change has no workbook identity, and the URL-change refusal protects it without needing one; old open tabs pick up the new code on their next load (network-first).

### Package 2: the script and the rules (S1–S6, S8, R1, R2, R5, D7 script side, R4 if decided)

Changes in `apps-script/Code.js`, `apps-script/rules.js`, `tests/code.test.js`, `tests/rules.test.js`, spec lines. One paste and one new version for the owner.

- `withLock` around open, edit, menu, GET and POST; flush before release.
- Header parser shared; duplicate required header rejected with column letters.
- Grid growth before append, summary write and header add.
- Rebuild only on the Table signature; other errors propagate.
- Bounds on batch ID length and rows per batch; flush after append before the receipt; corrupt receipt fails visibly.
- `validateRows` rejects a leading `=` in mission or ID.
- Time zone read once per log read; formatting guard on the conditional rules' range.
- `SCRIPT_VERSION` in the payload.
- Rules: cap tolerance, percent clamp and finiteness, interval ceiling; the override conflict rule once decided.

Tests: the in-memory workbook gains strict bounds, a lock that records acquire and release order, failure injection on writes and on the property service, a formula-literal check, and a frozen clock. Rules tests for R1 boundaries, R2 inputs, R5 ceilings, and R4 under the agreed rule. The required RTM tables are untouched.

Migration: no change to the log's four columns, the receipt list, or any stored value; the formatting guard runs its one-time pass only on a tab whose color rules do not reach the last row.

### Package 3: the guide and the spec (D4, S7, D2 wording, guide sentences)

Changes in `app/guide/index.html`, `CLAUDE.md`; version bump for the guide.

- Backfill: SIM versus aircraft for this-FY rows; the limit of aggregate counts.
- Deleted rows take effect at the next refresh; GET does not rewrite the sheet; data is also cached on the device; updates arrive on the next open; "Copied" only after the clipboard call succeeds.
- Spec: "always arrive together" becomes "in practice"; the S7 note; the R4 rule.

### Package 4: tests and release (D5, D6)

Changes in `tests/`, `.github/workflows/`.

- Frozen clock in the adapter tests; rules-derived expectations in the smoke test.
- `pages.yml` runs `node --test` before deploying; the browser smoke in CI if owner question 4 says yes.

## 4. Owner questions

1. **R4, same-date override conflict.** Recommend: the earliest override wins and the log check reports the later row. The alternative is to report only and keep last-wins, which leaves the result order-dependent.
2. **W3, workbook sharing.** The audit reports the live workbook as readable by anyone with the link. If that was for the audit, restricting it is a one-click change on your side; nothing in Apollo needs it, since the app reaches the sheet through the script. Your call; I will not change sharing.
3. **W4, the PRORATED row (MB85YM, 2026-09-30).** If it records an authorized accomplishment, it stays as it is. If it records administrative relief, the documented path is to delete row 71 and put the authorized expiration in row 70's Due Date Override. I will not touch the row.
4. **D6, browser smoke in CI.** Adds a development-only Playwright step and about two minutes per deploy. Recommend yes.
5. **A8, palette.** Darken the light-mode secondary text from `#8e8e93` to about `#6d6d72` and the error text to a deeper red, to reach 4.5:1. The due-date band colors stay. Recommend yes.
6. **A1 queue model.** Recommend the re-read discipline above with the documented residual window, not a single-tab lock and not IndexedDB.

## 5. What this response does not do

No merge, deploy, publish, live-record change or sharing change. No new column, tab, framework, dependency or per-event rule. No change to any required RTM expectation. The deployed script revision, Script Properties and trigger inventory remain as the owner reported them after today's redeploy; they were not inspected from here.
