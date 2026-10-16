# Jain Wire — Invoice Audit

Checks Tally sales invoices (PDF) against the day's rate sheet (Excel), one tool per branch.

| Page | Branch | Version |
|---|---|---|
| `index.html` | Branch picker | — |
| `ernakulam/index.html` | Ernakulam (EKM) | v6.2 |
| `calicut/index.html` | Calicut (CLT) | v1.1 |

Everything runs in the browser. Bills and rate sheets are never uploaded anywhere, and no AI is called.
Settings, the discrepancy log and the parser report are saved in the browser of each computer.

## Updating a tool
1. Open the file on GitHub (for example `ernakulam/index.html`) and choose **Edit** or **Upload files** to replace it.
2. Bump the version (`APP_VERSION` in the EKM tool) and the label on the front page.
3. Commit. The live site updates within a minute or two.
