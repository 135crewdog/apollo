# Apollo

Personal KC-135 aircrew training tracker. `CLAUDE.md` is the spec. Milestone 1 is the rules and the workbook script. Milestone 2 is the app in `app/`.

```
apps-script/rules.js   pure functions: due dates, which rows count, summary columns, log check
apps-script/Code.js    sheet reading/writing, refresh, Apollo menu, doGet, doPost
app/                   the app (PWA): plain HTML, CSS and JS, no build step
tests/                 node --test, plus a browser smoke test in tests/browser/
```

## Run the tests

```
node --test
node tests/browser/smoke.js            # needs Playwright with Chromium; drives the app against a mock API
node tests/browser/smoke.js ./shots    # same, and saves a screenshot of each screen
```

## Install the script in the workbook

The workbook is a Google Sheet named "Apollo" with the tabs `Training Log`, `Ground Training Config`, `Flying Training Config` and `Individual Training Summary`, with the row 1 headers listed in `CLAUDE.md`.

1. Open the workbook in Google Sheets. Choose **File → Settings**, set **Time zone** to **(GMT+00:00) UTC** and save. Every date in Apollo is Zulu. Then choose **Extensions → Apps Script**. A script project bound to the workbook opens.
2. In the editor, click `Code.gs` in the file list, select everything in it and delete it. Paste in the whole of `apps-script/Code.js`. Save (Ctrl/Cmd+S).
3. Click the **+** next to **Files**, choose **Script**, and name the new file `rules`. Delete the stub it contains and paste in the whole of `apps-script/rules.js`. Save.
4. Set the token. Click the gear (**Project Settings**) in the left bar, scroll to **Script Properties**, click **Add script property**, enter the property name `APOLLO_TOKEN` and, as the value, a secret of your own: eight or more lowercase letters and digits, nothing else. Click **Save script properties**. Do not write the token anywhere in the repo or the workbook.
5. Run it once by hand to grant permissions. Back in the editor, pick `refresh` in the function dropdown next to **Run** and click **Run**. Approve the authorization prompt (Advanced → Go to project if Google warns that the app is unverified). When it finishes, the `Individual Training Summary` tab is filled in, and the `Training Log` has its three headers if it was empty.
6. Deploy the web app. Click **Deploy → New deployment**, click the gear next to **Select type** and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL**. The app's Settings screen takes this URL and the token.
7. Reload the workbook. An **Apollo** menu appears with **Refresh**. The summary also rewrites itself when the workbook opens and after any hand edit to the log or config tabs. The Due Date column is colored by the script: gray for overdue, red within 30 days, orange within 60, yellow within 90. Each refresh checks the log: a small message in the bottom corner of the sheet lists any rows with an unknown Training ID, an unreadable date, a date in the future, or a Mission Number that looks like `SIM` but is not exactly `SIM`. After a menu refresh the message appears even when there is nothing wrong, so you know it ran.

Formatting the input tabs by hand is fine (colors, widths, percent and date formats), with one exception: do not use **Format → Convert to table** on any tab. A Table takes over the header row with its own column names and the script cannot write through it. The script rebuilds the summary tab if that happens, but anything you set on that tab by hand is lost on every refresh anyway, because the tab is rewritten each time.

After changing the script later, paste the new file contents over the old ones, save, then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy** so the web app URL serves the new code. The URL does not change.

## Check it from a browser

Paste `WEB_APP_URL?token=YOUR_TOKEN` into a browser. The reply is JSON:

```
{ "ok": true, "asOf": "2026-10-05", "ground": [...], "flying": [...], "summary": [...], "logCheck": [...] }
```

`summary` is one object per summary row, keyed by the summary tab's column headers. The tab's columns run Task ID, Task Name, Last Accomplished, Due Date, Overdue, Volume Accomplished, Volume Required, Percent Complete, Remaining Sim Credit. `Percent Complete` is a fraction (0.5 is 50%). Dates are `YYYY-MM-DD` strings. `logCheck` lists log rows that need attention, with their sheet row number and the problem. A problem comes back as `{ "ok": false, "error": "..." }`.

## API

- `GET ?token=…` refreshes the summary and returns the payload above.
- `POST` with `Content-Type: text/plain` and body `{ "token": "…", "batchId": "…", "rows": [{ "mission": "", "date": "YYYY-MM-DD", "id": "…" }] }` appends the rows to the Training Log, refreshes, and returns the same payload. `mission` is blank for ground training, `SIM` for the simulator, or the mission number. The last 50 `batchId` values are remembered, so a retried POST with the same `batchId` appends nothing and still returns success.

## The app

The app is static files served from GitHub Pages. One hosted copy serves everyone; each person's data stays in their own workbook.

1. Turn on Pages once: in the GitHub repo choose **Settings → Pages**, and under **Build and deployment** set **Source** to **GitHub Actions**. From then on every push to `main` that touches `app/` publishes to `https://135crewdog.github.io/apollo/`.
2. Open that URL on the device you will log from. On iPhone or iPad use **Share → Add to Home Screen**; on Android accept the install prompt or use the browser menu's **Install app**; on a computer use the browser's install option or a bookmark.
3. The app opens on **Settings**. Paste the web app URL and the token, tap **Save**. It syncs at once. Tap **Done**, and the **Status** tab fills in. The gear in the top corner reopens Settings, where you can also pick Light, Dark or Auto.
4. **Log**: choose Flight, Sim or Ground, set the mission number and Zulu date, tap **+** on each event as many times as it was done, then **Save**. Rows go into the sheet when there is a connection and wait in the app until then. Swipe or tap the segmented control to move between Log and Status; Status shows how many rows are waiting.

When you change anything under `app/`, bump `VERSION` in `app/sw.js` and `APP_VERSION` in `app/app.js`, or devices keep the old copy.

### Connect a device without typing

In the workbook choose **Apollo → Connect device**. The dialog shows a link that opens Apollo with this workbook's web app URL and token already filled in. Open it on the device that will run Apollo and add the app to the home screen from there. The link contains your token, so send it only to yourself. If the dialog says something is missing, it names the step: the token property or the web app deployment.

## Share Apollo with another aircrew member

Send them the guide: `https://135crewdog.github.io/apollo/guide/`. It has the narrative, the setup steps, the template link, the troubleshooting list, and the script code read live from this repository, so it is never out of date. Their data stays in their own Google Drive; nothing points back at yours.

The template workbook behind the guide's "Copy the Apollo template" button is a script-free Google Sheet with the four tabs, headers, UTC time zone and the MP / FTL A config. It needs to be shared as "Anyone with the link: Viewer" once. When the RTM config changes for everyone, edit the template's config tabs; the code never lives in it.
