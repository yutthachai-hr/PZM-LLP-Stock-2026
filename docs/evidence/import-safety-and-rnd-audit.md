# Import matching safety and the R&D brand audit (8 Oct 2026, evening)

**Branch:** `rc/ops-os-rc1-candidate`. Not merged, not deployed.

Facts below are **[verified]** (code, tests or a live read-only check) or **[assumption]**.

## 1. Import matching: the defect and the fix

**[verified] The defect** (`main ad43971`, `LineImportModal`):
- When a row had no sure match, the word-by-word suggestion (`productSuggest`) with one
  "clear" winner was **filled in and pre-ticked** (`include: !unitUnknown`).
- Pressing "เพิ่ม n รายการ" (add n items) imported it, **without anyone looking at the
  mapping**.

**[verified] A second defect found while fixing:**
- A row whose unit the product had no rate for (`unitUnknown`) could be ticked and imported.
- The message said **"ใช้เป็นหน่วยหลัก"** (used as the base unit), so "1 Box" could be filed
  as "1 KG".

**Fix: `src/lib/importReview.ts`.** It is the one place every consumer's rows are decided:
purchase request, order, monthly count, adjustment and the line builder all import through
this window.

| Row | Before | Now |
|---|---|---|
| Sure (SKU, confirmed alias, one exact name) | ticked | ticked, **if its unit is usable** |
| Guess (fuzzy, one clear winner) | **ticked** | filled in, **not ticked**. A "ยืนยันว่าเป็นสินค้านี้" (confirm it is this product) button, a tick, or a pick confirms it. `importable()` drops a bare guess even if something set its flag. |
| Ambiguous (several of that name) | not ticked | not ticked, with candidates offered and nothing chosen |
| Unknown unit for the product | tickable (as base unit) | **blocked**, with "set the rate on the product first" |
| Product with no unit (R&D) | — | **blocked** |
| Zero or invalid quantity | — | **blocked** |

**Unchanged:**
- Nothing invents a product, supplier or unit, and nothing writes the catalogue.
- The receiving bill reader (`Receive.tsx` → `matchOcrLines`) only ever took sure matches,
  and the person reviews the draft before confirming. A test now pins that.

**Tests:** `tests/import-review.test.ts`, 15 tests. Also covered:
- a guess is never importable unconfirmed;
- ticking confirms, and unticking withdraws;
- ambiguous names stay unmapped;
- nothing is invented;
- conversion works;
- unknown units, no-unit products and zero quantities are blocked;
- every screen imports through the window;
- receiving uses sure matches only.

## 2. R&D brand: data quality (`scripts/rnd-catalog-report.mjs` → `docs/evidence/data/rnd-catalog-report.json`)

[verified] From the committed catalogue (`main 476fa35`, `RND_PRODUCTS`):

| Check | Result |
|---|---|
| Products | 228 |
| SKU format `CAT-02-GG-NNN` | 228 / 228 |
| Duplicate SKUs within R&D | 0 |
| SKUs shared with Pizza Mania or Le Lapin | 0 |
| **Missing `unit` / `unitType`** | **228 / 228**. Pizza Mania 0 / 288, Le Lapin 0 / 166. |
| "(OTHER)" placeholders | 5 (`VGT-02-20-001`, `MES-02-04-014`, `MES-02-15-001`, `CHS-02-08-001`, `SEAS-02-34-001`) |
| Names with bracketed text | 221. **Listed only; a bracket is never taken as the supplier.** |
| Supplier field in the catalogue | none. "Link suppliers" (476fa35) happened in live data. **[assumption] Its accuracy cannot be checked without production reads.** |
| Minimum stock set | 0 / 228 |

**[assumption]** Live `rnd__products` may differ if units were set in the app since. Only
the owner's read can confirm it.

**What now protects stock** [verified, tests]:
- `requireMasterData` runs on **every stock path, client and server**: receive, PO receive,
  issue, consume, adjust, count post, and all transfer steps. It refuses a product with no
  unit: "ยังไม่มีหน่วย — ให้ผู้ดูแลกำหนดหน่วยที่หน้าสินค้าก่อน" (no unit yet — an admin must
  set it on the product first).
- The request picker refuses such a product up front.
- Smart Other always creates items with a unit.
- **Tests:** six server-command refusals with nothing written, and a unit-bearing product
  unaffected.

**Wiring checked** [verified]:

| Area | Status |
|---|---|
| Brand-scoped routing: app = server for every collection × 3 brands | Holds; isolated namespaces; stable across 45 switches (`tests/brand-isolation.test.ts`) |
| Rules | Main's `rnd__*` plus this branch's `rnd__auditLog` / `rnd__intelShadow` / R&D cache epoch |
| Notification indexes for `rnd__` | **Deployed live** (6 = 6) |
| Supplier links | Token brand `r` |
| Backup / restore | Accept `rnd` |
| Worker jobs | `rnd__` |
| Server stock commands | Accept `rnd` |
| Supabase | 0007 widens brand checks |
| Role authorisation | Unchanged: the same rules functions for all brands |

**To do (owner):** set a unit on every R&D product, at least those in use, before any R&D
stock entry. Until then R&D can request (Smart Other items carry a unit), but cannot hold
stock in catalogue items.
