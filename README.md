# Invoice Audit v7.0

One installable app for both branches (Ernakulam · Calicut/Kannur). It checks Jain Wire sales bills against the day's rate sheet or loading plan. The item lists, party lists, rules and audit log are kept in one Google Sheet.

## What's in this folder

| File | What it is |
|---|---|
| `index.html`, `app.js` | The app: shared screens, the bill reader, sync, saved progress |
| `branch-ekm.js`, `branch-clt.js` | Each branch's formulas and matching |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable, and let it open without internet |
| `ernakulam/`, `calicut/` | Old links, which now forward to the app |
| `apps-script/Code.gs` | The Google Sheet script. It goes into the sheet, not onto the website (harmless if uploaded) |

## 1 · Put it on GitHub (replaces the old site)

1. Open the `invoice-audit` repository, choose **Add file → Upload files**, and drag in everything in this folder, folders included. Files with the same name are replaced. Commit.
2. Wait a minute, then open https://jainwireindia.github.io/invoice-audit/

## 2 · Make the Google Sheet (once)

1. Create a new Google Sheet named **Invoice Audit**.
2. Go to **Extensions → Apps Script**. Paste all of `apps-script/Code.gs` over the code that is there, and save.
3. Pick **setup** in the function box and press **Run**. Allow access when Google asks. This creates the tabs: Users, EKM Items, CLT Items, EKM Parties, CLT Parties, Rules, Audit Log.
4. In **Users**, change the `admin` password and add one row per person (user, password, active = yes).
5. Go to **Deploy → New deployment → Web app**. Set Execute as: **Me** and Who has access: **Anyone**. Press **Deploy** and copy the URL that ends in `/exec`.
6. In the app, press **☁ Sync settings**, paste the URL, enter a user and password, and press **Log in & sync**. Do this once on each PC.

After you edit `Code.gs` later, go to **Deploy → Manage deployments → ✎ → New version**. The URL stays the same.

## 3 · Fill the lists

- **EKM Items / CLT Items** use the same columns as TallySync's master export: Code · Tally stock item name · Category · Unit · Ht ft · Len ft · Bundle kg · Other codes / spellings. Extra columns such as HSN are ignored.
  - In the app, **📦 Items & parties** can fill an empty EKM Items tab with the built-in list of 500+ codes.
  - **After a mass rename in Tally**, put the new names in *Tally stock item name* and keep the old names in *Other codes / spellings*. Both are recognised.
- **EKM Parties / CLT Parties**: the Tally party name, and the name or names used on the rate sheet or loading plan. Separate several names with commas.
- After any change in the sheet, press **⟳ Sync now**, or reopen the app.

## 4 · Install on the desktop

Open the site in Chrome or Edge and press **⬇ Install app** at the top, or the install icon in the address bar. It then opens in its own window from the desktop or Start menu. Open it once with internet so it can keep the PDF and Excel readers for offline use.

## How it behaves

- **Sync:** it syncs once each time it is opened, and whenever you press ⟳ Sync now. The last copy is kept in the browser, so it works offline.
- **Bills and the rate sheet:** they stay in this browser, even after you close the app, until you press **Clear all**. Each branch keeps its own work. Bills are never uploaded.
- **Rules:** a rule changed in the app goes to the Rules tab and reaches the other PCs on their next sync.
- **Audit log:** "📋 Add to log" on a bill, or "📤 Send all to Audit Log" in the overview, writes one row per invoice. Sending the same invoice again updates its row.
