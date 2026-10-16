# Jain Wire — Invoice Audit

Checks Tally sales invoices (PDF) against the day's rate sheet or loading plan (Excel).

| Page | Branch | Version |
|---|---|---|
| `index.html` | Branch picker | — |
| `ernakulam/index.html` | Ernakulam (EKM) | v6.3 |
| `calicut/index.html` | Calicut and Kannur (CLT · KNR) | v3.0 |

Both tools are built from the same code. They differ only in each branch's formulas (how the
sheet is read, how bills are matched, how expected quantity and rate are worked out), their texts
and two colours (background and accent).

Everything runs in the browser. Bills and rate sheets are never uploaded anywhere, and no AI is
called. Settings, the discrepancy log and the parser report are saved in each computer's browser.

## Updating
Upload the new `index.html` into its folder (Add file → Upload files) and commit. The live site
updates within a minute or two.
