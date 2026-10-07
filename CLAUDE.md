# Apollo

Personal KC-135 aircrew training tracker. A phone PWA logs training events into a Google Sheets workbook. A script inside the workbook works out currency, due dates and volume and writes them to a summary tab.

## The three project rules

1. **SIMPLE.** The log is three columns, one accomplishment per row. Plain HTML/CSS/JS, no framework, no build step, no runtime dependencies. When in doubt, choose fewer columns, files and features.
2. **FUTURE-PROOF.** Everything the app knows about training requirements comes from the two config tabs. Aircrew will edit those tabs for years, in the RTM's own plain words. An RTM change must never need a code change. Never hardcode a Task ID, a task name, or behaviour for one specific event.
3. **ZULU.** Every date and time in the log, the summary, the API and the app is Zulu (UTC). No exceptions. "Today" is the UTC date, never the phone's or the spreadsheet's local date. A sortie is logged on its Zulu date.

Ask the user before adding anything that is not in this file. Ideas that were discussed and not adopted are listed under "Parked" at the end; do not build them without asking.

## Milestones

| # | Scope | Status |
|---|---|---|
| 1 | `apps-script/rules.js`, `apps-script/Code.js`, `tests/`, `README.md`. Installed in the user's workbook and checked against test rows. | Done |
| 2 | The PWA in `app/` as described under "The app", hosted from this repo with GitHub Pages so one hosted copy serves every user. | Next |
| 3 | Sharing: a template workbook offered as a "Make a copy" link with the script, headers and RTM config already in it, and a one-tap handoff link that carries the web app URL and token into the app's Settings so nothing is typed by hand. | After 2 |

## The workbook

A Google Sheets workbook named "Apollo" with four tabs. Find tabs by exact name and columns by exact header text in row 1 (trimmed), never by position. Renaming a tab or a header is the one hand edit that breaks the script.

| Tab | Written by | Columns |
|---|---|---|
| `Training Log` | the app, and the user by hand | Mission Number, Date, Training ID |
| `Ground Training Config` | the user | Task ID, Task Name, Frequency |
| `Flying Training Config` | the user | Task ID, Task Name, Currency, Volume Required, Percent Credit in Sim |
| `Individual Training Summary` | the script only; rewritten on every refresh | Task ID, Task Name, Last Accomplished, Due Date, Overdue, Volume Accomplished, Volume Required, Percent Remaining, Remaining Sim Credit |

**Plain ranges only, on every tab.** Do not use Format → Convert to table (a Google Sheets Table) anywhere in the workbook. A Table owns its header row and swallowed the summary once. If one appears on the summary tab the script rebuilds that tab. Colours, widths, frozen rows and number formats are fine on the three input tabs; anything set by hand on the summary tab is lost on the next refresh because the tab is cleared and rewritten.

### Training Log

- One row per accomplishment. Three landings on one sortie are three rows.
- **Mission Number** says what kind of row it is: blank = ground training, `SIM` (trimmed, any case) = simulator, anything else = aircraft.
- No other columns, ever: no row IDs, timestamps, names, counts or notes.
- The log is the only record of accomplishments. The user may add, fix or delete rows by hand in the sheet, and that must just work.
- A row whose Training ID is not in either config tab is kept and ignored. Training IDs are matched trimmed and case-insensitive.
- A row whose Date cannot be read as a date is ignored.
- The script writes the three headers if row 1 is empty and keeps the Mission Number column formatted as plain text.
- **Typing dates by hand:** dates are Zulu dates. The workbook has a US locale, so `05/10/2026` is read as 10 May. Type `2026-10-05`. The app always sends that format.

### Log check

Every refresh checks the log and reports, never fixes, rows that need a human. One problem per row, worst first:

| Row | Problem reported | Counted? |
|---|---|---|
| Blank Training ID | `blank Training ID, row ignored` | No |
| Training ID not in either config tab | `Training ID not in either config tab, row ignored` | No |
| Date blank or not readable as a date | `date is blank or not a date, row ignored` | No |
| Date after today | `date is after today, row still counted` | Yes |
| Mission Number starts with `SIM` but is not exactly `SIM` (`SIM1`, `Simulator`) | `Mission Number looks like SIM but is not exactly SIM, counted as an aircraft row` | Yes, as aircraft |

Rows with both a blank ID and a blank date are skipped silently. The report goes to two places: a toast in the sheet after a refresh (always after Apollo → Refresh, only when there are problems after an open or edit; the first five rows plus a count of the rest) and the `logCheck` list in the API payload, so the app's Status screen can show it. Nothing is written to any tab. Not caught: a plausible wrong date, a wrong but valid ID, and a duplicate row, which the spec treats as a second accomplishment.

### Config tabs

- A row being present is what makes an event tracked. There is no profile tab and no crew position, FTL, or equipment setting. The user has already copied their own column of the RTM into these tabs.
- Task IDs are unique across both tabs. Rows with a blank Task ID are skipped.
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
| `N Months` | Same day of the month, N months later. If that day does not exist, the last day of that month. |
| `N Days` | Last Accomplished + N days |
| `PCS`, `As Required`, `N/A`, blank | No due date |
| anything else | Due Date shows `CHECK LABEL` |

A label "produces due dates" when it is in the first five rows of this table.

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
| 60 Months | 2022-03-05 | 2027-03-05 |
| 17 Months | 2025-06-10 | 2026-11-10 |
| 24 Months | 2025-06-10 | 2027-06-10 |
| 6 Months | 2026-08-31 | 2027-02-28 |
| 48 Months | 2024-02-29 | 2028-02-29 |
| 455 Days | 2025-07-01 | 2026-09-29 |
| 365 Days | 2026-01-15 | 2027-01-15 |
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
| Due Date | From the label table above. Blank if there is no Last Accomplished, except that `CHECK LABEL` shows whether or not the event has been logged, so a mistyped label is visible at once. |
| Overdue | `YES` if Due Date is before today, or if the label produces due dates and the event has never been logged. Otherwise blank. Never `YES` for `CHECK LABEL`. |
| Volume Required | The config value if it is a number above 0. Anything else (blank, `X`) means nothing to count: this column, Percent Remaining and Remaining Sim Credit are blank, and Volume Accomplished shows the plain count of rows that count this FY. |
| Volume Accomplished | Aircraft rows this FY + SIM rows this FY, with SIM rows capped at `floor(Volume Required × Percent Credit in Sim)`. |
| Percent Remaining | `max(0, Required − Accomplished) / Required`, stored as a fraction (0.5) and shown as a percent (50%) by the column's number format. The API returns the fraction. |
| Remaining Sim Credit | `max(0, min(Required − Accomplished, cap − SIM rows this FY))` |

Ground rows leave all four volume columns blank.

In the sheet, Task ID through Overdue are written as plain text, so dates stay `YYYY-MM-DD` and `CHECK LABEL` stays as written. The numeric columns are numbers.

### Due Date colours

The script writes conditional formatting on the Due Date column on every refresh, so it survives the rewrite and travels with the template. Display only; no rule lives here. First match wins.

| Band | Test | Colour |
|---|---|---|
| Overdue | Overdue column is `YES` (so never-logged events go grey too) | `#666666` background, white text |
| Due in 30 days or less | Due Date minus TODAY() is 30 or less | `#EA9999` |
| Due in 60 days or less | 60 or less | `#F9CB9C` |
| Due in 90 days or less | 90 or less | `#FFF2CC` |
| More than 90 days, no due date, `CHECK LABEL` | | none |

Sheets evaluates TODAY() in the workbook's time zone, which is UTC. Columns are referenced by their position in the header list, not hardcoded letters.

### Required test cases for volume

Today is 2026-10-05 (FY27) in all of these. The tests compare the fraction, so "50%" means 0.5.

| Event setup | Rows this FY | Accomplished | Percent Remaining | Remaining Sim Credit |
|---|---|---|---|---|
| Volume 4, sim 50% | 3 SIM | 2 | 50% | 0 |
| Volume 4, sim 50% | 1 SIM, 1 aircraft | 2 | 50% | 1 |
| Volume 12, sim 100% | 5 SIM, 4 aircraft | 9 | 25% | 3 |
| Volume 2, sim 0% | 2 SIM | 0 (and Last Accomplished stays blank) | 100% | 0 |
| Volume `X`, sim 100% | 1 aircraft | 1 | blank | blank |
| Volume 12, sim 100% | 1 aircraft dated 2026-09-30 | 0 (last FY), but Last Accomplished = 2026-09-30 | 100% | 12 |

## Architecture

```
CLAUDE.md              this file, the spec
README.md              install, token and deploy steps for the workbook script
apps-script/rules.js   pure functions, no Apps Script globals, unit-tested in Node
apps-script/Code.js    sheet reading/writing, refresh, menu, doGet, doPost
app/                   the PWA: index.html, app.js, style.css, sw.js, manifest (milestone 2)
tests/                 node --test
```

- **One implementation of the rules.** The script computes the summary. The app does no currency or volume math; it displays the summary the script returns.
- **The script is bound to the workbook**, so a copy of the workbook carries the script with it. The user pastes `rules.js` and `Code.js` into Extensions → Apps Script (two files, `Code.gs` and `rules.gs`) and deploys as a web app (Execute as: Me; Access: Anyone). After a code change, paste again and deploy a **new version** of the same deployment, or the web app keeps serving old code while the sheet triggers run the new code.
- **Refresh** rewrites the Individual Training Summary, reapplies its Due Date colours, and runs the log check. It runs on open, on any hand edit to the log or config tabs, on every GET and POST, and from a custom menu (Apollo → Refresh). A failure inside a trigger shows as a toast in the sheet rather than failing silently.
- **The app is offline-first.** A log entry goes into a local queue at once and syncs when there is a connection. Config, summary and queue are kept in `localStorage`.

### Web app API

Every response is JSON. Apps Script cannot set HTTP status codes, so errors come back as `{ "ok": false, "error": "..." }`.

- `GET ?token=…` refreshes the summary and returns `{ ok, asOf, ground, flying, summary, logCheck }`.
  - `asOf` is today's UTC date.
  - `ground` is `[{ id, name, frequency }]`.
  - `flying` is `[{ id, name, currency, volumeRequired, percentCreditInSim }]` with `volumeRequired` a number or `null` and `percentCreditInSim` a fraction, so the app can hide 0% events in Sim without parsing.
  - `summary` is one object per summary row, keyed by the summary tab's column headers.
  - `logCheck` is `[{ row, mission, date, id, problem }]` from the log check above, empty when the log is clean. `row` is the sheet row number.
- `POST` with body `{ token, batchId, rows: [{ mission, date, id }] }` appends the rows, refreshes, and returns the same payload as GET. `batchId` is required. Every `date` must be `YYYY-MM-DD` and every `id` non-empty or the whole batch is rejected and nothing is appended.
- **The token** is a shared secret in Script Properties under `APOLLO_TOKEN`. Use lowercase letters and digits only; other characters caused a `Bad token` reply from the URL. The app stores the web app URL and token from its Settings screen. Never commit either.
- **Retry safety without extra log columns:** the script keeps the last 50 `batchId` values in Script Properties under `APOLLO_BATCH_IDS`. A repeated `batchId` appends nothing and returns success. Appends and refreshes run under `LockService`.

### The app (three screens)

- **Log:** pick Flight, Sim or Ground. Flight needs a mission number and date. Sim needs a date and writes `SIM` as the mission number. Ground needs a date only. Then a searchable list of events from the matching config tab, each with + and −. Save writes one row per tap. In Sim, events with 0% sim credit are not offered.
- **Status:** the summary, overdue first, then by due date, with its "as of" date, the number of rows waiting to sync, and the log check problems if there are any.
- **Settings:** web app URL, token, Sync now.

## Gotchas

- **Dates are `YYYY-MM-DD` strings everywhere outside the sheet.** Do date math on year/month/day numbers, never on local-time `Date` objects.
- **Today is `Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd')` in the script and `new Date().toISOString().slice(0, 10)` in the app.** Never `getDate()`, `getMonth()` or a date picker's local default.
- **Reading a date cell:** a date cell is a calendar date, stored by Sheets as midnight in the spreadsheet's time zone, so convert it with `Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')` to get back exactly the date that was typed. Formatting it in UTC would shift it a day whenever the spreadsheet's zone is not UTC. The workbook's time zone is set to UTC anyway (File → Settings → Time zone), and the milestone 3 template ships that way.
- **Percent Credit in Sim** may arrive as a number (`0.5`) or text (`50.00%`). Accept both. A bare number above 1 is read as a percentage (`50` is 50%).
- **Volume Required** may arrive as a number, a numeric string, blank, or text such as `X`.
- **Mission Number must be stored as plain text**, so values like `0123` or `1E5` are not altered by Sheets.
- **POST with `Content-Type: text/plain`.** Apps Script does not answer CORS preflight requests, and `application/json` triggers one.
- **No Google Sheets Tables anywhere in the workbook.** See "The workbook". Note for anyone touching the sheet through the Sheets API: `deleteTable` clears the Table's cells as well, so read the values first and write them back.
- The summary tab is script-owned. Never put formulas or user data there.

## Deliberately not in the app

Do not add these. The user and their training office handle them.

- A profile or settings tab in the workbook
- Auto-credit: logging one event never credits another
- Month-end rounding for `N Months` labels
- Proration, waivers, deployment grace periods
- The 6-month non-current / unqualified rule
- The instructor 50% credit rule
- CSV/XLSX export (the workbook is the export)

## Parked

Discussed, not adopted, might come back. Ask before building.

- **An Apollo → Set up menu** in the sheet that generates and stores the token, writes the headers, and shows the remaining deploy steps in a dialog. Considered for milestone 3 alongside the template workbook and the handoff link; the user chose those two and parked this.
- **A reminder email** from the script when something is due soon. The Status screen is the only nudge for now.

## Source documents

RTM = KC-135 RAP Tasking Memo, 1 Oct 24, Change 2 (30 Jun 25): paragraph 7c, Table 7.1 (ground), Table 7.2 (pilot flying). The user is an Evaluator Pilot using the MP / FTL A column. The config tabs, not this file, hold the event list. Volume is counted per fiscal year; confirm against Table 7.2 that no event states its volume per semi-annual period.
