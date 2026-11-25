# Invoice Audit v8.0

One installable app for both branches (Ernakulam · Calicut/Kannur). It checks every sales bill in two ways:

1. **Rate slab:** one safety slab for all branches, with rates after GST. A line below the minimum is flagged as a loss (₹ per unit, %, and the total on the quantity). A line above the maximum (minimum + 15% by default, changeable per item) is flagged as billed too high. This applies to loading-list bills and to **local sales**.
2. **Loading list:** as before, for bills on the day's rate sheet or loading plan. Differences are now shown after GST.

Each line ends as **✓** (checked and fine), **✗** (discrepancy) or **❓** (no slab rate to check against). The app never guesses a slab rate: it is found only by the exact Tally item name printed on the bill (or a spelling on the slab row), in the same unit, valid on the invoice date.

## What's new in v8.0

- **☰ sidebar** on the left, which collapses to icons: Check bills · Item master · Party master · Rate slab · Rules · Code reference · Discrepancy log · Parser report · Sync & login.
- **Item, Party and Rate slab masters** can be edited inside the app (add, edit, delete, search, paste from Excel, export) and are saved to the Google Sheet.
- **Local sales** have their own drop box and are checked against the slab only.
- **📱 Copy for WhatsApp** on every bill, and **📱 Day summary for WhatsApp** in the overview. Each one draws a complete picture of the check and copies it, so you can press Ctrl+V in WhatsApp. If the browser refuses the copy, the picture is saved as a file instead.
- **Learning:** sending bills to the Audit Log adds confirmed parties and item codes to the masters, marked "learned".
- **Roles:** in the Users tab's Role column, `admin` can edit masters, the slab and rules; `checker` can only check bills and log them.

## Update from v7.1 (once)

1. **Sheet:** go to Extensions → Apps Script, paste the new `apps-script/Code.gs` over the old one, and save. Then go to Deploy → Manage deployments → ✎ → Version: **New version** → Deploy. The URL stays the same.
   The next sync adds the **Rate Slab** tab and the new columns (Role, GST %, Source, Slab loss ₹, Type) by itself. Nothing existing is moved or deleted.
2. **Site:** upload everything in this folder to the `invoice-audit` GitHub repo, replacing the old files. Each PC shows "A new version is ready — Reload now".
3. In **Users**, set the Role for each person: `admin` or `checker`. A blank role counts as admin.

## Rate slab rules

| Column | Meaning |
|---|---|
| Tally item name | Exactly as Tally prints it on the bill |
| Unit | The bill's unit (Sq.Ft, Kg, Roll, Pcs, Nos…). A different unit gives ❓, never a conversion |
| GST % | Blank → the item master's GST %, then the category's (18% / 5%) |
| Minimum rate (incl GST) | The safety rate, per unit, after GST |
| Max % | Blank → the default in Rate slab settings (15%) |
| Maximum rate | Filled in by the app (minimum + Max %) |
| Effective from | Blank = always. To change a rate, use **＋ New rate**: older bills keep being checked against the rate valid on their date |
| Other names / spellings | Other Tally names for the same item, comma-separated |

The check: billed rate × (1 + GST%) is compared with the minimum and maximum. Differences of 1 paisa or less are ignored as GST rounding; you can change this under Rate slab settings.
