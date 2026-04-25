# CMA — Financial Dashboard
### Carlisle Moore Architects

A private financial intelligence dashboard for CMA's two principals. No server, no account, no data leaves the browser.

---

## Getting started

### Option A — Import from QuickBooks (recommended monthly workflow)

1. In QuickBooks: **Reports → Profit and Loss Detail** → set date range to the month or year → **Export → Export to Excel**
2. Open the dashboard → **Import / Data** tab → drag the `.xlsx` file into the drop zone
3. Revenue by principal (Scott/Bill), all expense categories, and monthly breakdowns parse automatically from the Class column
4. Manually enter **Cash & AR** and **Pipeline** data in the same tab (these are not in the P&L export)

### Option B — Load sample data

Open the dashboard and it loads sample CMA data automatically.

### Option C — Local

```bash
open index.html
# or: npx serve .
```

### Option D — GitHub Pages

Push to a GitHub repo, enable Pages (Settings → Pages → Deploy from main), share the URL.

---

## Tabs

| Tab | What it shows |
|---|---|
| **Firm** | Combined firm P&L, revenue by principal, net margin, action items |
| **Scott** | Scott's fees, projects, and estimated 2026 tax picture |
| **Bill** | Bill's fees, projects, and estimated 2026 tax picture |
| **Pipeline** | All active projects by phase, billed %, remaining fees |
| **Expenses** | Expense mix, trends, software audit — mapped to QB account numbers |
| **Cash & AR** | Cash position, AR aging by bucket |
| **Import / Data** | Upload QB Excel, enter cash/AR, manage pipeline, configure tax settings |
| **Settings** | Firm name, principal names |

---

## Tax picture

The Scott and Bill tabs each include an estimated tax calculation based on:

- **W-2 salary** — set in Import / Data → Tax Settings
- **S-corp distributions** — estimated from annualized YTD fees minus salary
- **QBI deduction** — 20% of S-corp income (architecture is explicitly excluded from SSTB — no phase-out)
- **Federal brackets** — 2025 MFJ rates
- **Alabama income tax** — 4.95% flat above exempt amount
- **Quarterly payment schedule** — with safe harbor calculation

Consult Aprio before acting on any estimates here.

---

## Data

All data lives in `localStorage` under the key `cma_dashboard_v2`. Export anytime from Settings tab.

---

MIT License
