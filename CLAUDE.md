# Apollo

Personal KC-135 aircrew training tracker. A PWA on any device logs training events into a Google Sheets workbook. A script inside the workbook works out currency, due dates and volume and writes them to a summary tab.

## The three project rules

1. **SIMPLE.** The log is three columns the app writes, plus one hand-entered override, one accomplishment per row. Plain HTML/CSS/JS, no framework, no build step, no runtime dependencies. When in doubt, choose fewer columns, files and features.
2. **FUTURE-PROOF.** Everything the app knows about training requirements comes from the two config tabs. Aircrew will edit those tabs for years, in the RTM's own plain words. An RTM change must never need a code change. Never hardcode a Task ID, a task name, or behavior for one specific event.
3. **ZULU.** Every date and time in the log, the summary, the API and the app is Zulu (UTC). No exceptions. "Today" is the UTC date, never the device's or the spreadsheet's local date. A sortie is logged on its Zulu date.

Ask the user before adding anything that is not in this file. Ideas that were discussed and not adopted are listed under "Parked" at the end; do not build them without asking.

**Working rule (2026-10-09):** propose a solution and agree it with the user before building it. A pull request waits for the user's review; never merge one unasked.

## Milestones

| # | Scope | Status |
|---|---|---|
| 1 | `apps-script/rules.js`, `apps-script/Code.js`, `tests/`, `README.md`. Installed in the user's workbook and checked against test rows. | Done |
| 2 | The PWA in `app/` as described under "The app", hosted from this repo with GitHub Pages so one hosted copy serves every user. | Done. Live at `https://135crewdog.github.io/apollo/` since the first Pages deploy on 2026-10-07 |
| 3 | Sharing: a template workbook offered as a "Make a copy" link with the script, headers and RTM config already in it, and a one-tap handoff link that carries the web app URL and token into the app's Settings so nothing is typed by hand. | Done, then paused on 2026-10-09 while the app and sheet are refined for one user. The guide at `/guide/` is the share link; script-free template; Apollo → Connect device handoff. Still open: Google-side screen captures for the guide, and two template questions (non-RTM rows, two flying rows the user's workbook lacks) |

## The workbook

A Google Sheets workbook named "Apollo" with four tabs. Find tabs by exact name and columns by exact header text in row 1 (trimmed), never by position. Renaming a tab or a header is the one hand edit that breaks the script.

| Tab | Written by | Columns |
|---|---|---|
| `Training Log` | the app, and the user by hand | Training ID, Date, Mission Number, Due Date Override (hand-entered only) |
| `Ground Training Config` | the user | Task ID, Task Name, Frequency |
| `Flying Training Config` | the user | Task ID, Task Name, Currency, Volume Required, Percent Credit in Sim |
| `Individual Training Summary` | the script only; rewritten on every refresh | Task ID, Task Name, Last Accomplished, Due Date, Overdue, Volume Accomplished, Volume Required, Percent Complete, Remaining Sim Credit |

**Plain ranges only, on every tab.** Do not use Format → Convert to table (a Google Sheets Table) anywhere in the workbook. A Table owns its header row and swallowed the summary once. If one appears on the summary tab the script rebuilds that tab. Colors, widths, frozen rows and number formats are fine on the three input tabs; anything set by hand on the summary tab, a filter or sort included, is lost on the next refresh. A hand sort racing a refresh once scrambled the tab; the Status screen in the app is the sorted view.

### Training Log

- One row per accomplishment. Three landings on one sortie are three rows.
- **Mission Number** says what kind of row it is: blank = ground training, `SIM` (trimmed, any case) = simulator, anything else = aircraft.
- **Due Date Override** is the one hand-only column. A date there is the expiration an official document states for that one accomplishment (a DD 2992, a waiver, an extension). It belongs to the row, not the event: when that row is the event's Last Accomplished, the summary uses it instead of the label's date; a newer accomplishment supersedes it like any other date. If two rows of one event on the same date carry different overrides, the earliest wins, whatever their order in the log, and the log check reports the other. It never affects volume. The app never writes or reads it; the result reaches the app through the summary. The script adds the header to a log made before the column existed.
- No other columns, ever: no row IDs, timestamps, names, counts or notes.
- The log is the only record of accomplishments. The user may add, fix or delete rows by hand in the sheet, and that must just work.
- A row whose Training ID is not in either config tab is kept and ignored. Training IDs are matched trimmed and case-insensitive.
- A row whose Date cannot be read as a date is ignored.
- The script writes the four headers if row 1 is empty, adds any missing header in the next free column, keeps the Mission Number column formatted as plain text, and formats a date column it adds as `yyyy-mm-dd`.
- **Typing dates by hand:** anything Sheets recognizes as a date works (`2026-10-05`, `5 Oct 2026`); the column displays `yyyy-mm-dd` and the script reads the date value, not the text. Avoid all-numeric `05/10/2026`, which the US locale reads month-first. The app always sends `YYYY-MM-DD`.

### Log check

Every refresh checks the log and reports, never fixes, rows that need a human. One problem per row, worst first:

| Row | Problem reported | Counted? |
|---|---|---|
| Blank Training ID | `blank Training ID, row ignored` | No |
| Training ID not in either config tab | `Training ID not in either config tab, row ignored` | No |
| Date blank or not readable as a date | `date is blank or not a date, row ignored` | No |
| Date after today | `date is after today, row still counted` | Yes |
| Mission Number starts with `SIM` but is not exactly `SIM` (`SIM1`, `Simulator`) | `Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row` | Yes, as aircraft |
| Due Date Override not readable as a date | `Due Date Override is not a date, override ignored` | Yes, with the label's due date |
| Due Date Override later than another on the same event and date | `another row on the same Date has an earlier Due Date Override, this one ignored` | Yes, with the earlier override |
| Due Date Override earlier than the row's Date | `Due Date Override is before the row's Date, override still used` | Yes |

Rows with both a blank ID and a blank date are skipped silently. The report goes to two places: a toast in the sheet after a refresh (always after Apollo → Refresh, only when there are problems after an open or edit; the first five rows plus a count of the rest) and the `logCheck` list in the API payload, so the app's Status screen can show it. Nothing is written to any tab. Not caught: a plausible wrong date, a wrong but valid ID, and a duplicate row, which the spec treats as a second accomplishment.

### Config tabs

- A row being present is what makes an event tracked. There is no profile tab and no crew position, FTL, or equipment setting. The user has already copied their own column of the RTM into these tabs.
- Task IDs are unique across both tabs. Rows with a blank Task ID are skipped. Every tab leads with the Task ID / Training ID column.
- The Individual Training Summary lists every Ground row, then every Flying row, in config order.

### When the RTM changes

Everything is recomputed from the whole log on every refresh, so a config edit takes effect at once and applies to all history.

- **Currency, Frequency, Volume Required or Percent Credit in Sim changes:** edit the cell. Nothing else.
- **New event:** add a row. It shows Overdue until it is logged, and the app offers it after its next sync.
- **Retired event:** delete the row. Its log rows stay, are ignored, and come back if the ID is ever re-added.
- **Renamed Task ID:** find-and-replace the old code in the log's Training ID column, or the history is orphaned.
- **A new kind of label** (not in the label table below) shows `CHECK LABEL` in the summary. Teaching the script what it means is a change to one function in `rules.js`, the only case where an RTM change needs code.

## The rules

All of this lives in one file, `apps-script/rules.js`. Nothing else does date or volume math.

**Fiscal year (FY):** 1 Oct to 30 Sep, named for the year it ends in. FY27 is 1 Oct 2026 to 30 Sep 2027. Quarters are Oct–Dec, Jan–Mar, Apr–Jun, Jul–Sep. Semi-annual periods are Oct–Mar and Apr–Sep.

### Due date from the Frequency / Currency label

Labels are matched trimmed and case-insensitive. Number labels are matched by pattern, so a new interval such as `36 Months` works with no code change.

| Label | Due date |
|---|---|
| `Monthly`, `Quarterly`, `Semi-Annual` | Last day of the period after the one containing Last Accomplished |
| `Annual`, `Biennial`, `Triennial` | 30 Sep of (FY of Last Accomplished + 1, 2, 3) |
| `N Years` | 30 Sep of (FY of Last Accomplished + N) |
| `N Months` | Last day of the month N months after Last Accomplished |
| `N Days` | Last day of the month containing Last Accomplished + N days |
| `PCS`, `As Required`, `N/A`, blank | No due date |
| anything else, or an interval beyond 100 years (`101 Years`, `1201 Months`, `36501 Days`) | Due Date shows `CHECK LABEL` |

A label "produces due dates" when it is in the first five rows of this table.

ARMS, the system SARM reads, computes every interval to the last day of the month. SARM due dates for `6 Months`, `24 Months`, `48 Months` and `365 Days` events confirmed this on 2026-10-09; the rows marked SARM in the table below are those dates. A requirement whose expiration comes from another system or a document (the flight physical on a DD 2992, a waiver, an extension) is not given a label of its own: its date goes in the log's Due Date Override column.

### Required test cases for due dates

These are checked against the RTM. If the code disagrees with this table, the code is wrong. Never change an expected value to make a test pass; ask the user. `tests/rules.test.js` holds this table verbatim.

| Label | Last Accomplished | Due Date |
|---|---|---|
| Monthly | 2026-09-01 | 2026-10-31 |
| Monthly | 2026-09-28 | 2026-10-31 |
| Monthly | 2026-01-31 | 2026-02-28 |
| Monthly | 2026-12-15 | 2027-01-31 |
| Quarterly | 2026-08-15 | 2026-12-31 |
| Quarterly | 2026-10-01 | 2027-03-31 |
| Quarterly | 2026-12-31 | 2027-03-31 |
| Quarterly | 2026-03-31 | 2026-06-30 |
| Semi-Annual | 2026-02-10 | 2026-09-30 |
| Semi-Annual | 2026-04-01 | 2027-03-31 |
| Semi-Annual | 2026-09-30 | 2027-03-31 |
| Semi-Annual | 2026-10-05 | 2027-09-30 |
| Annual | 2025-11-12 | 2027-09-30 |
| Annual | 2026-09-30 | 2027-09-30 |
| Annual | 2026-10-01 | 2028-09-30 |
| Biennial | 2025-03-03 | 2027-09-30 |
| Triennial | 2024-10-15 | 2028-09-30 |
| 5 Years | 2021-10-01 | 2027-09-30 |
| 5 Years | 2022-01-15 | 2027-09-30 |
| 5 Years | 2022-09-30 | 2027-09-30 |
| 60 Months | 2022-03-05 | 2027-03-31 |
| 60 Months | 2025-03-04 | 2030-03-31 (SARM) |
| 17 Months | 2025-06-10 | 2026-11-30 |
| 24 Months | 2025-06-10 | 2027-06-30 |
| 24 Months | 2025-03-07 | 2027-03-31 (SARM) |
| 6 Months | 2026-08-31 | 2027-02-28 |
| 6 Months | 2026-05-18 | 2026-11-30 (SARM) |
| 48 Months | 2024-02-29 | 2028-02-29 |
| 48 Months | 2025-11-14 | 2029-11-30 (SARM) |
| 455 Days | 2025-07-01 | 2026-09-30 |
| 365 Days | 2026-01-15 | 2027-01-31 |
| 365 Days | 2026-05-18 | 2027-05-31 (SARM) |
| 365 Days | 2027-06-01 | 2028-05-31 |
| PCS | 2026-01-01 | (none) |
| As Required | 2026-01-01 | (none) |
| N/A | 2026-01-01 | (none) |
| Fortnightly | 2026-01-01 | CHECK LABEL |

### Which log rows count

- **Ground event:** every row with its Training ID counts, whatever the Mission Number says.
- **Flying event, aircraft row:** always counts. A flying-event row with a blank Mission Number is treated as an aircraft row (the app never writes one, a hand edit might).
- **Flying event, SIM row:** counts only if Percent Credit in Sim is above 0. At 0% (or blank) a SIM row counts for nothing, neither currency nor volume.

### Summary columns

"Today" is the UTC date. "This FY" is the fiscal year containing today.

| Column | Value |
|---|---|
| Last Accomplished | Latest date among the rows that count. Blank if none. |
| Due Date | From the label table above, or the Due Date Override on the Last Accomplished row if it has one. Blank if there is no Last Accomplished, except that `CHECK LABEL` shows whether or not the event has been logged, so a mistyped label is visible at once; `CHECK LABEL` beats an override. |
| Overdue | `YES` if Due Date is before today (whether the label or an override set it), or if the label produces due dates and the event has never been logged. Otherwise blank. Never `YES` for `CHECK LABEL`. |
| Volume Required | The config value if it is a number above 0. Anything else (blank, `X`) means nothing to count: this column, Percent Complete and Remaining Sim Credit are blank, and Volume Accomplished shows the plain count of rows that count this FY. |
| Volume Accomplished | Aircraft rows this FY + SIM rows this FY, with SIM rows capped at `floor(Volume Required × Percent Credit in Sim)`. |
| Percent Complete | `min(1, Accomplished / Required)`, stored as a fraction (0.5) and shown as a percent (50%) by the column's number format. The API returns the fraction. Was Percent Remaining until 2026-10-08; the test table was converted. |
| Remaining Sim Credit | `max(0, min(Required − Accomplished, cap − SIM rows this FY))` |

Ground rows leave all four volume columns blank.

In the sheet, Task ID through Overdue are written as plain text, so dates stay `YYYY-MM-DD` and `CHECK LABEL` stays as written. The numeric columns are numbers.

### Due Date colors

The bands are one list in `rules.js` (`DUE_BANDS`) that feeds both the sheet's conditional formatting and the `band` field on each summary row in the API, so the app displays a band without doing date math. The script sets the summary tab's text and percent formats, frozen header and color rules once, on whole columns, when the tab is created, rebuilt or found unformatted; a refresh clears and rewrites values only. Display only; no rule lives here. First match wins.

| Band | Test | Color |
|---|---|---|
| Overdue | Overdue column is `YES` (so never-logged events go gray too) | `#666666` background, white text |
| Due in 30 days or less | Due Date minus TODAY() is 30 or less | `#EA9999` |
| Due in 60 days or less | 60 or less | `#F9CB9C` |
| Due in 90 days or less | 90 or less | `#FFF2CC` |
| More than 90 days, no due date, `CHECK LABEL` | | none |

Sheets evaluates TODAY() in the workbook's time zone, which is UTC. Columns are referenced by their position in the header list, not hardcoded letters.

### Required test cases for volume

Today is 2026-10-05 (FY27) in all of these. The tests compare the fraction, so "50%" means 0.5.

| Event setup | Rows this FY | Accomplished | Percent Complete | Remaining Sim Credit |
|---|---|---|---|---|
| Volume 4, sim 50% | 3 SIM | 2 | 50% | 0 |
| Volume 4, sim 50% | 1 SIM, 1 aircraft | 2 | 50% | 1 |
| Volume 12, sim 100% | 5 SIM, 4 aircraft | 9 | 75% | 3 |
| Volume 2, sim 0% | 2 SIM | 0 (and Last Accomplished stays blank) | 0% | 0 |
| Volume `X`, sim 100% | 1 aircraft | 1 | blank | blank |
| Volume 12, sim 100% | 1 aircraft dated 2026-09-30 | 0 (last FY), but Last Accomplished = 2026-09-30 | 0% | 12 |

## Architecture

```
CLAUDE.md                 this file, the spec
README.md                 for developers: tests, API, hosting, version bumps; setup lives in the guide
apps-script/rules.js      pure functions, no Apps Script globals, unit-tested in Node
apps-script/Code.js       sheet reading/writing, refresh, menu, doGet, doPost
app/                      the PWA: index.html, app.js, style.css, sw.js, manifest.webmanifest, icons
app/guide/                the setup guide page; loads the script code live from the repository
tests/*.test.js           node --test: rules.test.js, app.test.js (the app's pure helpers), code.test.js (Code.js against an in-memory workbook that counts reads and writes)
tests/browser/            smoke.js drives the app in Chromium against mock-api.js; needs Playwright, dev only
.github/workflows/        test.yml runs node --test; pages.yml publishes app/ to GitHub Pages from main
```

- **One implementation of the rules.** The script computes the summary. The app does no currency or volume math; it displays the summary the script returns.
- **The script is bound to the workbook**, so a copy of the workbook carries the script with it. The user pastes `rules.js` and `Code.js` into Extensions → Apps Script (two files, `Code.gs` and `rules.gs`) and deploys as a web app (Execute as: Me; Access: Anyone). After a code change, bump `SCRIPT_VERSION` in `Code.js`, paste again and deploy a **new version** of the same deployment, or the web app keeps serving old code while the sheet triggers run the new code. The payload carries the version and the app shows it under its own in Settings, so a stale deployment is visible.
- **Refresh** rewrites the Individual Training Summary and runs the log check. It runs on open, on any hand edit to the log or config tabs, on every POST, and from a custom menu (Apollo → Refresh). A GET computes the same payload without writing the sheet, so a sync does not wait on a write. A failure inside a trigger shows as a toast in the sheet rather than failing silently, and leaves the summary tab as it was; the one case that rebuilds the tab is a Google Sheets Table owning its header row. Each input tab is read in one call per refresh and nothing is read twice. Every path that reads the tabs and writes the summary or the log (open, edit, menu, GET, POST) runs under the one script lock and flushes its writes before releasing it. Columns are found by the first cell in row 1 with the header's text; a required header that appears twice stops the refresh with the column letters. The grid grows before a write would run past it.
- **The app is offline-first.** A log entry goes into a local queue at once and syncs when there is a connection. Config, summary and queue are kept in `localStorage`.

### Web app API

Every response is JSON. Apps Script cannot set HTTP status codes, so errors come back as `{ "ok": false, "error": "..." }`.

- `GET ?token=…` computes the summary (without writing the sheet) and returns `{ ok, version, asOf, ground, flying, summary, logCheck }`.
  - `version` is the script's `SCRIPT_VERSION`.
  - `asOf` is today's UTC date.
  - `ground` is `[{ id, name, frequency }]`.
  - `flying` is `[{ id, name, currency, volumeRequired, percentCreditInSim }]` with `volumeRequired` a number or `null` and `percentCreditInSim` a fraction, so the app can hide 0% events in Sim without parsing.
  - `summary` is one object per summary row, keyed by the summary tab's column headers, plus `band`: `overdue`, `d30`, `d60`, `d90` or `''` from the Due Date colors table, computed for `asOf`.
  - `logCheck` is `[{ row, mission, date, id, problem }]` from the log check above, empty when the log is clean. `row` is the sheet row number.
- `POST` with body `{ token, batchId, rows: [{ mission, date, id }] }` appends the rows (Due Date Override left blank), refreshes, and returns the same payload as GET. `batchId` is required and at most 100 characters; a batch holds at most 500 rows. Every `date` must be `YYYY-MM-DD`, every `id` non-empty, and no `id` or `mission` may start with `=`, or the whole batch is rejected and nothing is appended.
- **The token** is a shared secret in Script Properties under `APOLLO_TOKEN`. Use lowercase letters and digits only; other characters caused a `Bad token` reply from the URL. Eight or more characters is enough; it guards a training log. The app stores the web app URL and token from its Settings screen. Never commit either.
- **Retry safety without extra log columns:** the script keeps the last 50 `batchId` values in Script Properties under `APOLLO_BATCH_IDS`. A repeated `batchId` appends nothing and returns success. The append is flushed before its receipt is written. A receipt list that cannot be read fails the save with a message naming the property rather than becoming empty and appending twice.

### The app (three screens)

**An ordinary web page.** The app is a page the browser scrolls, not an app shell. The browser owns the viewport, the status bar, the home indicator, the toolbar, the keyboard and zoom; nothing in the app is sized to the viewport height or to a safe-area inset, and the page background is the app background, so there is nothing behind the app to show through on any device. (A fixed shell once left a band of page showing on an installed iOS copy.) Content sits in one column, at most 720px wide, the same reading width as the guide: a portrait phone fills it, a landscape phone, an iPad or a desktop centers it. Header and tabs scroll away with the page like any web page. The one thing that sticks is the Save bar, at the bottom of the Log section, because the event list is long and Save must stay one tap away; it uses standard sticky positioning and settles into place after the list at the end of the page.

**Design system.** The visual language follows the user's Show Time PWA (github.com/135crewdog/showtime), an iOS-style system: system font stack, antialiased; a white (dark: `#1c1c1e`) header with the 34px bold title on the left and a round 40px gear button on the right; an iOS segmented control under the header switching Log and Status, with a swipe doing the same (horizontal movement must dominate, 50px threshold; the switch is immediate, there is no slide); content in sections with 13px uppercase letter-spaced gray titles over rounded 10px cards with a 1px border; 17px inputs on a gray fill with 10px radius; full-width 12px-radius buttons; Settings as its own screen with "Done" on the left and a centered title; a Light/Dark/Auto theme setting that also sets the page's theme color, which colors the browser's and the installed app's status bar; Apple's gray palette for backgrounds, borders, fills and secondary text (`#f2f2f7`, `#ffffff`, `#c6c6c8`, `#8e8e93`, `#e5e5ea`; dark `#000000`, `#1c1c1e`, `#38383a`, `#98989d`, `#48484a`). Where Show Time uses iOS blue, Apollo uses the due-date palette: red `#EA9999` for primary buttons, orange `#F9CB9C` for the active kind and a picked stepper, yellow `#FFF2CC` and gray `#666666` where the bands already apply, with dark text on all of them. Every list row leads with the Task Name and puts the Task ID beneath it in gray, on Log and Status alike; search matches either. Everything the app says is sentence case (buttons, labels, hints, toasts, empty states, the version line); section titles are uppercase and letter-spaced as a visual device; proper nouns keep their capitals (Zulu, Task ID, Sim); the OVERDUE badge is a status flag drawn in capitals on purpose. Every date a human reads in the app is `DD-Mmm-YY` (`07-Oct-26`): due dates, Last Accomplished, "As of", last sync, and the date field, which shows that label over the native picker while its value stays `YYYY-MM-DD`.

- **Log:** pick Flight, Sim or Ground. Flight needs a mission number and date. Sim needs a date and writes `SIM` as the mission number. Ground needs a date only. Then a searchable list of events from the matching config tab, each with + and −, in one card per RTM category (the first two characters of the Task ID; groups in the order they first appear in the config, events in config order within a group). The cards carry no heading: the prefix means nothing to a user, the gap between cards is the grouping. Save writes one row per tap. In Sim, events with 0% sim credit are not offered. The date defaults to the Zulu date. Flight refuses a mission number of `SIM`. Changing the kind clears the counts.
- **Status:** the summary, overdue first, then by due date, with its "as of" date, the number of rows waiting to sync, the log check problems if there are any, and a search field that narrows the list by Task Name or Task ID (the same match as the Log search), so "when did I last do X?" is one search away. Order within the list: Overdue rows, then `CHECK LABEL` rows, then rows with a due date ascending, then rows with no due date; ties keep config order. Each row shows the Task Name over the Task ID, the due date as `DD-Mmm-YY` colored by the `band` the row carries from the script (the same list that colors the sheet; the app does no date math), Last Accomplished or "Never logged", and the volume line when the event has one (`2 of 12 this FY, 17% complete, 10 sim credit available`).
- **Settings:** its own screen, opened from the gear and closed with Done. Sections: Connection (web app URL, token, Show token, Save, Sync now, last sync and last error), Appearance (Theme: Light, Dark, Auto), Data (Clear local data, asks first; the workbook is never touched), Help (Setup guide, Send Feedback), and the version. The app opens on Settings until a URL and token are saved.

**Sync.** Save puts the rows into the local queue as one batch with a fresh `batchId` and tries to sync at once. Sync sends queued batches in order with POST, then, if nothing was sent, refreshes with GET. It runs on load, after Save, when the browser comes back online, when the app becomes visible with rows waiting, and from Sync now. A network failure keeps the queue and says so; a `{ ok: false }` reply keeps the queue and shows the error. The payload from the last successful call is what Status shows.

**Storage.** `localStorage` keys `apollo.settings` (`{ url, token, theme }`), `apollo.data` (the last payload plus `lastSync`) and `apollo.queue` (`[{ batchId, rows }]`).

**Hosting and updates.** `app/` is published to GitHub Pages by `.github/workflows/pages.yml` on every push to main that touches it, at `https://135crewdog.github.io/apollo/`. `sw.js` caches the app shell so the app opens offline. Every file, page or asset, is network-first and revalidated past the browser's HTTP cache, with the cached copy as the offline fallback, so a new page and its new script always arrive together (cache-first assets once paired a new page with an old script); API calls are never intercepted. Bump `VERSION` in `sw.js` and `APP_VERSION` in `app.js` on every change to `app/`, or devices keep the old copy.

## Sharing (milestone 3)

Sharing Apollo is sending someone one link: the guide at `https://135crewdog.github.io/apollo/guide/`. The guide holds the narrative, the setup steps, the troubleshooting list, the template link and the script code. The repository is the single source of truth; nothing about setup lives anywhere that can go stale.

**The guide** (`app/guide/`: `index.html`, `guide.css`, `guide.js`, `img/`) is a plain page on the app's design tokens with a 720px reading column. Each step and section carries the amount of text a first-time reader needs, and a native `<details>` "More" block beneath it holds the step-by-step detail and the why, so the page stays short unless opened. Its code section fetches `apps-script/Code.js` and `apps-script/rules.js` live from the repository's main branch on GitHub's raw host, which allows cross-origin reads, and shows each with a Copy button, so the code a new user pastes is always the merged version. If the fetch fails it links to the files on GitHub. Google-side steps have marked spots (`figure.capture`) for screen captures the user takes; app screenshots in `img/` come from the browser smoke test. Settings → Help links to the guide. The service worker serves pages network-first keyed by their own URL, so the guide and the app never swap when offline.

**The template workbooks** are script-free Google Sheets with the four tabs, their headers, frozen header rows, the UTC time zone, the Mission Number column as plain text, dates as `yyyy-mm-dd`, and one crew position's column of the RTM as the config seed. Each is named for its position, column and RTM version, and cell A1 of each config tab carries a note naming the source, so the provenance travels with every copy. The first is "Apollo Template: Pilot, MP / FTL A (FY25 KC-135 RTM Change 2, 30 June 2025)", id `1ucCJ4fbnNOwo-326-TFRMtDzrQlxeDYF2IdJGExgevg`. The guide names the position, column and RTM version on each copy button. Nothing in a template changes when the code changes. It is offered through its `/copy` URL, which asks the recipient to make their own copy; it must be shared as "Anyone with the link: Viewer" for that to work. Because it carries no script, copying it shows no Apps Script warning and no code can go stale inside it.

**A new user:** copy the template, paste the two files from the guide into Apps Script, set `APOLLO_TOKEN`, run `refresh` once to authorize, deploy the web app (Execute as Me, Anyone), then Apollo → Connect device and open the link on the device. The same paste-and-new-version procedure is how every user takes a script update, and the guide's Updates section says so.

**The handoff link.** Apollo → Connect device in the sheet shows `https://135crewdog.github.io/apollo/#url=<web app URL>&token=<token>`, with Copy and Open buttons. The URL comes from `ScriptApp.getService().getUrl()` (a `/dev` ending is swapped for `/exec`) and the token from Script Properties; if either is missing the dialog says which step is left instead. The app reads the fragment on load and on `hashchange`, saves the connection, strips the fragment from the address bar with `history.replaceState`, closes Settings, shows "Connected to the workbook" and syncs. The connection travels in the fragment on purpose: browsers never send a fragment to the server, so GitHub Pages never sees the token. The link still contains the token, so it is for the owner's own devices only.

## Gotchas

- **Dates are `YYYY-MM-DD` strings everywhere outside the sheet.** Do date math on year/month/day numbers, never on local-time `Date` objects.
- **Today is `Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd')` in the script and `new Date().toISOString().slice(0, 10)` in the app.** Never `getDate()`, `getMonth()` or a date picker's local default.
- **Reading a date cell:** a date cell is a calendar date, stored by Sheets as midnight in the spreadsheet's time zone, so convert it with `Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')` to get back exactly the date that was typed. Formatting it in UTC would shift it a day whenever the spreadsheet's zone is not UTC. The workbook's time zone is set to UTC anyway (File → Settings → Time zone), and the milestone 3 template ships that way.
- **Percent Credit in Sim** may arrive as a number (`0.5`) or text (`50.00%`). Accept both. A bare number above 1 is read as a percentage (`50` is 50%). Anything above 100%, below 0, or not finite is clamped: 100%, 0, 0. A Volume Required that is not a finite number above 0 means nothing to count.
- **Volume Required** may arrive as a number, a numeric string, blank, or text such as `X`.
- **Mission Number must be stored as plain text**, so values like `0123` or `1E5` are not altered by Sheets.
- **POST with `Content-Type: text/plain`.** Apps Script does not answer CORS preflight requests, and `application/json` triggers one.
- **A native date input shows the device's date format** (10/07/2026 on a US device) but its value is always `YYYY-MM-DD`; the app reads the value, never the display.
- **Bump both version strings** (`sw.js` `VERSION`, `app.js` `APP_VERSION`) with every change under `app/`.
- **No app shell.** Never size anything to the viewport height (`vh`, `dvh`, `height: 100%` chains, `position: fixed; inset: 0`) or to `env(safe-area-inset-*)`, and leave the viewport meta at `width=device-width, initial-scale=1`. The page scrolls; the browser handles the rest, the same way on every device.
- **No Google Sheets Tables anywhere in the workbook.** See "The workbook". Note for anyone touching the sheet through the Sheets API: `deleteTable` clears the Table's cells as well, so read the values first and write them back.
- The summary tab is script-owned. Never put formulas or user data there.

## Deliberately not in the app

Do not add these. The user and their training office handle them.

- A profile or settings tab in the workbook
- Auto-credit: logging one event never credits another
- Proration
- The 6-month non-current / unqualified rule
- The instructor 50% credit rule
- CSV/XLSX export (the workbook is the export)

Not rules, but handled by the Due Date Override column in the log: waivers, extensions, deployment grace periods, and any requirement whose expiration is stated on a form (the flight physical's DD 2992 gave 2027-06-10 for an exam on 2026-03-13, which no interval label produces).

## Parked

Discussed, not adopted, might come back. Ask before building.

- **An Apollo → Set up menu** in the sheet that generates and stores the token, writes the headers, and shows the remaining deploy steps in a dialog. Considered for milestone 3 alongside the template workbook and the handoff link; the user chose those two and parked this.
- **A reminder email** from the script when something is due soon. The Status screen is the only nudge for now.

## Source documents

RTM = KC-135 RAP Tasking Memo, 1 Oct 24, Change 2 (30 Jun 25): paragraph 7c, Table 7.1 (ground), Table 7.2 (pilot flying). The user is an Evaluator Pilot using the MP / FTL A column. The config tabs, not this file, hold the event list. Volume is counted per fiscal year; confirm against Table 7.2 that no event states its volume per semi-annual period.
