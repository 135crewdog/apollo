# Apollo audit, 2026-10-09

Scope: every file in the repository, the spec, the live workbook as it stands today, the deployed app at phone and desktop widths against the mock API with your real config, and the guide. Method: read end to end, trace each user path (log a sortie, log offline, hand-edit the sheet, change the RTM, redeploy, connect a new device) and each failure path (bad token, stale deployment, a Table, a sort, a bad date, a bad override). Check each rule against the spec and the spec against itself.

Nothing in the code was changed for this audit. Each finding names a fix; you pick, and each fix goes through the propose-then-PR flow.

**Severity scale.** *Wrong result* (a number or date a user would act on is wrong), *data risk* (rows could be lost or doubled), *confusing* (right result, wrong impression), *efficiency* (time, requests, battery), *debt* (code that costs more than it earns), *cosmetic*.

## 1. Verdict

The system is sound. No finding in this audit produces a wrong due date, a wrong volume, or a lost row. The rules are pure, tested against 37 required dates and 6 volume cases, and run in 19 ms for 85 events against a 5,000-row log, so the sheet's own read and write calls are the whole cost of a refresh. The app is 45 KB of files with no dependencies and loads in one round of requests.

What the audit found is weight, not faults: duplicated reads in the script, a rule kept in three places, helper functions that outlived their reason, a page-level patch for a bug that no longer exists, a spec sentence that contradicts the workbook, and setup instructions maintained twice. Taking every recommendation below removes about 150 lines and adds about 90, of which 80 are a test harness for the one file that has none.

## 2. Right as it stands, leave alone

- **The rules file.** Pure functions, no Date objects in date math, every required case from the spec held verbatim in the test file. The day-count arithmetic is the standard civil-date algorithm and is correct across leap years and centuries.
- **Finding columns by header and tabs by name.** The one thing that let the log grow a column with no hand edit anywhere.
- **The batch ID and the lock.** A retried save cannot double rows; two devices cannot interleave writes. The 50-ID window is the right size for a personal log.
- **The offline queue.** Rows are in local storage before any network call. A failed sync keeps them. The smoke test proves the reconnect path sends exactly one POST.
- **Network-first service worker with the cached copy as the offline fallback.** Page and script always arrive together. The offline reload test proves the cache works.
- **The Due Date Override.** One general rule where a label vocabulary would have grown case by case.
- **The flowing page.** No shell, no viewport math, one width. Keep it that way; the new Gotcha already says so.
- **The handoff link in the fragment.** The token never reaches GitHub.

## 3. Findings

### A. Rules (`apps-script/rules.js`)

**A1. Unused helper.** `formatPercent` is called by nothing but its own test. The sheet formats the column, the app rounds its own. *Debt.* Remove it and its test. About 15 lines.

**A2. Three helpers for one job.** `addMonths` computes a same-day-of-month result whose day is then thrown away by `endOfMonth`, which itself only calls `lastDayOfMonth`. Since the month-end rule landed, every interval ends at a month end, and so does every period label. One helper, "last day of month number N", serves Monthly, Quarterly, Semi-Annual, N Months and N Days. *Debt.* Collapse three functions to one and test the public `dueDate` instead of the helpers. About 12 lines removed.

**A3. Label abbreviations the spec does not mention.** The classifier accepts `yrs`, `yr`, `mos`, `mo` as well as the RTM's `Years` and `Months`. Harmless, but undocumented, and the rule is "the RTM's own words". *Debt.* Drop the abbreviations, or add them to the spec. Recommend drop. 2 lines.

**A4. A row's counting logic is longer than its rule.** The loop in `summarizeEvent` builds `counts` and `bucket` through a three-way branch. The rule is two sentences: every ground row counts; a flying row counts unless it is a SIM row at 0%. *Debt.* Rewrite as those two tests. About 8 lines removed.

**A5. `buildSummary` writes into the config objects.** It sets `event.type` on the rows it was handed, a side effect the caller never asked for. *Debt.* Pass the type as an argument. 2 lines.

**A6. A Task ID in both config tabs is not reported.** The spec says IDs are unique across the tabs. If one is not, the summary shows two rows that each consume the same log rows, and nothing says so. *Confusing, rare.* The log check could add one line: "Task ID appears in both config tabs". About 6 lines added. Your call whether the rarity earns it.

**A7. Volume cap at 50% and a requirement of 1.** The cap is `floor(required × percent)`. With a requirement of 1 and 50% sim credit the cap is 0, so no sim row ever counts. Your current config has no such row (the two 50% events require 2 and 4), so nothing is wrong today. *Question for the RTM, not a code finding.* If the RTM means "half may be in the sim, rounded up", the floor is wrong for odd requirements. Confirm against Table 7.2 when convenient.

### B. Script (`apps-script/Code.js`)

**B1. Every API call reads the two config tabs twice.** `refreshSummary` reads ground, flying and log; then `buildPayload` reads ground and flying again to shape the payload. Two of the five sheet reads on every sync are repeats. Each read is a round trip to Sheets, typically 100 to 300 ms. *Efficiency, medium.* Have `refreshSummary` return what it read and let `buildPayload` map it. About 6 lines removed, and every sync loses two round trips.

**B2. A POST reads the whole log twice and checks the headers twice.** `appendLogRows` runs `ensureLogHeaders` and reads the entire log just to find three column indexes, then `refreshSummary` runs `ensureLogHeaders` and reads the log again. *Efficiency, medium.* Read row 1 only for the indexes, or pass the log read forward. One large read and one header pass gone from every save.

**B3. The summary tab is fully re-formatted on every refresh.** `fillSummary` clears values and formats, sets two number formats, writes values, freezes the header, and rebuilds four conditional-format rules. Seven write calls, of which five set things that never change between refreshes. *Efficiency, medium.* Clear contents only, write values, and apply formats, frozen row and color rules once when the tab is created or rebuilt, with the color rules on whole columns so row count no longer matters. The rebuild path for a Table stays. About 5 lines fewer, and a refresh drops from seven write calls to two.

**B4. The on-edit trigger refreshes on every keystroke that leaves a cell.** During a backfill of 77 rows the sheet runs 77 full refreshes, each a few seconds, with "Running script" showing throughout. The result is always right; only the cost is high. *Efficiency, medium.* Three options: keep it (right after every edit, slow while typing); drop it and rely on open, the menu, and every app sync (fast while typing, one menu click to see the summary after a hand edit); or keep it and accept it. Recommend keep for now, since you edit by hand rarely, and revisit if a future bulk entry hurts. Your call.

**B5. A GET writes the summary tab.** Every app open rewrites the tab and reapplies its formatting even when nothing changed, so a sync waits on the write. The tab also refreshes itself on open, on edit, on every POST and from the menu, so a GET that computes the payload without writing would leave the sheet no staler than it is today between app opens. *Efficiency, low to medium.* Recommend GET computes only, POST and the sheet-side triggers keep writing. Removes nothing but a function call; saves the write calls on every sync. Spec line changes to match.

**B6. Script property read twice per POST.** `isKnownBatch` and `rememberBatch` each read the batch list. *Efficiency, trivial.* Read once. 3 lines.

**B7. Two doc comments on `ensureLogHeaders`.** The old one-line comment sits above the new block. *Cosmetic.* 1 line.

**B8. The Connect device dialog carries 20 lines of inline style and script.** It works and is used once per device. *Debt, low.* Leave it unless Code.js is being touched for B1 to B3 anyway, in which case trim the styling to what Sheets' dialog default already provides.

### C. App (`app/`)

**C1. The due-date color bands live in three places.** Thresholds 30, 60 and 90 days are in `Code.js` (conditional formatting), `app.js` (`dueBand`, with its own `daysBetween` and date parsing) and the spec. The app computes dates to color a badge, which is the one piece of date math the spec says the app should not do. *Debt, medium.* Put the band thresholds in `rules.js` once, have the script build the sheet's color rules from them and add a `band` field to each summary row in the API payload (no new sheet column), and have the app read the field. Removes `daysBetween`, `dueBand` and most of `isIsoDate` from the app, about 30 lines; adds about 10 to the rules. Trade-off: a badge is then "as of" the payload date rather than the device date, which the Overdue flag already is, and the "As of" line already shows that date.

**C2. The old-worker self-heal script in the page is finished.** The ten-line inline script reloads the guide when an old service worker hands it the app page. That worker was replaced on 2026-10-07 by one that takes over immediately and never does that, and the only devices that had it are yours and have long since updated. *Debt.* Remove the script. 11 lines.

**C3. The iOS-specific meta is now redundant.** `apple-mobile-web-app-capable` predates manifest support; iOS has honored `display: standalone` in the manifest for several versions, and the page now rides with defaults everywhere else. *Debt, low.* Remove it. 1 line. The title meta can stay, since the manifest's short name covers it only on newer iOS.

**C4. The Log list has no empty state for a search with no match.** Status says "No events match"; Log shows a blank area. *Confusing, minor.* One line in `renderLog`.

**C5. Each tap on + rebuilds the whole event list.** `renderLog` recreates every card and row on every count change. At 56 rows this is a few milliseconds on a phone and not visible; it only matters if a config ever reaches hundreds of rows. *Efficiency, low.* Leave it. Noted so nobody optimizes it prematurely.

**C6. Unused stylesheet rules.** `.btn.success` and the `--success` and `--fill2` tokens are referenced by nothing. *Cosmetic.* 4 lines.

**C7. The toast sits 96px up on every screen.** That clearance was for the Save bar; on Status and Settings it floats higher than it needs to. *Cosmetic.* Leave it. Mentioned for completeness.

**C8. Status does not surface a volume event that is behind pace.** A flying event with no currency label (N/A, volume 6) sorts to the bottom under "No due date" even with 0 of 6 done in March. This is by the spec's ordering and the summary has no notion of pace, so it is not a defect. *Observation.* If it ever matters, the rule would be "fraction of the FY elapsed against fraction of volume done", which is a new rule and would need its own discussion. Not recommended now.

### D. Tests

**D1. `Code.js` has no test in the repository.** The sheet reading and writing, header migration, token check, batch dedupe and the API are exercised only by a mock harness that lives in my scratch space. That file has broken more often than any other (stale deployment, the Table, the filter, the headers). *Debt, medium, and the one addition this audit recommends.* Move the harness into `tests/` as a Node test with a 60-line stand-in for the Sheets objects it touches. About 80 lines added. It would have caught B1 and B2 by counting reads.

**D2. Stale comment and wait in the smoke test.** "Panels slide for 300 ms" and the 400 ms pause before screenshots refer to the slide that no longer exists. *Cosmetic.* 2 lines.

**D3. Tests of private helpers.** `addDays`/`addMonths` and `formatPercent` tests go with A1 and A2; the public `dueDate` table already covers the arithmetic.

### E. Spec, README and guide

**E1. Rule 1 contradicts the workbook.** "The log is three columns" is no longer true; the Training Log has four, one of them hand-only. *Confusing.* Change to "three columns the app writes, plus one hand-entered override". 1 line.

**E2. Setup steps are maintained twice.** README steps 1 to 7 and guide steps 2 to 8 describe the same procedure in different words, and they have already drifted once (README mentions "three headers"). *Debt.* README keeps what a developer needs (tests, API, version bumps, hosting) and points to the guide for setup. About 25 lines removed. Milestone 3 is pinned, but the guide exists and is the better copy; this is removal from README, not work on the guide.

**E3. Incident narratives have accumulated in the spec.** The Table, the sort, the band, the cache-first script and the override each carry a sentence or two of "this once happened". They are good rationale and should stay, but several run long. *Cosmetic.* Trim each to one clause. About 10 lines.

**E4. The spec says GET refreshes the summary.** Changes with B5 if adopted.

**E5. Milestone 3 row still reads "Done" with a to-do attached.** *Cosmetic.* Note it as paused on 2026-10-09 so the next reader does not pick it up.

### F. Workbook and template

**F1. The live workbook is clean.** Four log headers, 85 summary rows in config order, no Tables, no filters, UTC, correct Percent Complete header, FLTMED and CHAMBER matching SARM. Nothing to do.

**F2. The template is clean** after the header fix earlier today. Two decisions remain from my last message (FLTMED and CHAMBER in a template labeled as RTM rows; two flying rows your workbook does not have). Pinned with milestone 3.

### G. Security and privacy

Nothing to change. The token is a shared secret for a training log, stored in the browser and in Script Properties, sent in the query for GET and the body for POST, over HTTPS, to a web app that only reads and appends your own sheet. Guessing an eight-character lowercase-alphanumeric token against Apps Script's rate limits is not a realistic risk. GitHub Pages never sees the token because it travels in the fragment. The one thing worth knowing is that Apps Script logs the GET query, token included, in your own execution log, which only you can read.

## 4. Decisions needed from you

1. **B4**, the on-edit trigger: keep, drop, or keep and revisit.
2. **B5**, GET without a sheet write: yes or no.
3. **C1**, bands computed once in the rules and sent in the payload: yes or no. This is the one change that moves the Status badge from device date to payload date.
4. **A6**, report a Task ID that appears in both config tabs: worth six lines or not.
5. **D1**, the Code.js test harness: the only net addition; yes or no.
6. **A7** is a question for the RTM, no decision needed now.

Everything else is removal or tidying with no behavior change, and I would group it as below unless you want it split differently.

## 5. Proposed order of work

- **PR 1, rules and script, no behavior change.** A1 to A5, B1, B2, B3, B6, B7, and D3. Script needs a paste and new version. This is the "fast and light" PR: two fewer reads per sync, one fewer per save, five fewer writes per refresh.
- **PR 2, the app.** C2, C3, C4, C6, D2, and C1 if you say yes. Version bump, no script change unless C1.
- **PR 3, documents.** E1, E2, E3, E5, and E4 if B5 is adopted.
- **PR 4, if you say yes to it.** D1, the Code.js tests. Test code only.
- **B4 and B5** fold into PR 1 if adopted.

Each PR waits for your review.
