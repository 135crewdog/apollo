# Apollo

Personal KC-135 aircrew training tracker. `CLAUDE.md` is the spec. Milestone 1 (the rules and the workbook script) is done; the phone app is milestone 2.

```
apps-script/rules.js   pure functions: due dates, which rows count, summary columns
apps-script/Code.js    sheet reading/writing, refresh, Apollo menu, doGet, doPost
tests/                 node --test
```

## Run the tests

```
node --test
```

## Install the script in the workbook

The workbook is a Google Sheet named "Apollo" with the tabs `Training Log`, `Ground Training Config`, `Flying Training Config` and `Individual Training Summary`, with the row 1 headers listed in `CLAUDE.md`.

1. Open the workbook in Google Sheets. Choose **File → Settings**, set **Time zone** to **(GMT+00:00) UTC** and save. Every date in Apollo is Zulu. Then choose **Extensions → Apps Script**. A script project bound to the workbook opens.
2. In the editor, click `Code.gs` in the file list, select everything in it and delete it. Paste in the whole of `apps-script/Code.js`. Save (Ctrl/Cmd+S).
3. Click the **+** next to **Files**, choose **Script**, and name the new file `rules`. Delete the stub it contains and paste in the whole of `apps-script/rules.js`. Save.
4. Set the token. Click the gear (**Project Settings**) in the left bar, scroll to **Script Properties**, click **Add script property**, enter the property name `APOLLO_TOKEN` and, as the value, a long random secret of your own made of lowercase letters and digits only. Click **Save script properties**. Do not write the token anywhere in the repo or the workbook.
5. Run it once by hand to grant permissions. Back in the editor, pick `refresh` in the function dropdown next to **Run** and click **Run**. Approve the authorisation prompt (Advanced → Go to project if Google warns that the app is unverified). When it finishes, the `Individual Training Summary` tab is filled in, and the `Training Log` has its three headers if it was empty.
6. Deploy the web app. Click **Deploy → New deployment**, click the gear next to **Select type** and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL**. The app's Settings screen takes this URL and the token.
7. Reload the workbook. An **Apollo** menu appears with **Refresh**. The summary also rewrites itself when the workbook opens and after any hand edit to the log or config tabs. The Due Date column is coloured by the script: grey for overdue, red within 30 days, orange within 60, yellow within 90. Each refresh checks the log: a small message in the bottom corner of the sheet lists any rows with an unknown Training ID, an unreadable date, a date in the future, or a Mission Number that looks like `SIM` but is not exactly `SIM`. After a menu refresh the message appears even when there is nothing wrong, so you know it ran.

Formatting the input tabs by hand is fine (colours, widths, percent and date formats), with one exception: do not use **Format → Convert to table** on any tab. A Table takes over the header row with its own column names and the script cannot write through it. The script rebuilds the summary tab if that happens, but anything you set on that tab by hand is lost on every refresh anyway, because the tab is rewritten each time.

After changing the script later, paste the new file contents over the old ones, save, then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy** so the web app URL serves the new code. The URL does not change.

## Check it from a browser

Paste `WEB_APP_URL?token=YOUR_TOKEN` into a browser. The reply is JSON:

```
{ "ok": true, "asOf": "2026-10-05", "ground": [...], "flying": [...], "summary": [...], "logCheck": [...] }
```

`summary` is one object per summary row, keyed by the summary tab's column headers. The tab's columns run Task ID, Task Name, Last Accomplished, Due Date, Overdue, Volume Accomplished, Volume Required, Percent Remaining, Remaining Sim Credit. `Percent Remaining` is a fraction (0.5 is 50%). Dates are `YYYY-MM-DD` strings. `logCheck` lists log rows that need attention, with their sheet row number and the problem. A problem comes back as `{ "ok": false, "error": "..." }`.

## API

- `GET ?token=…` refreshes the summary and returns the payload above.
- `POST` with `Content-Type: text/plain` and body `{ "token": "…", "batchId": "…", "rows": [{ "mission": "", "date": "YYYY-MM-DD", "id": "…" }] }` appends the rows to the Training Log, refreshes, and returns the same payload. `mission` is blank for ground training, `SIM` for the simulator, or the mission number. The last 50 `batchId` values are remembered, so a retried POST with the same `batchId` appends nothing and still returns success.
