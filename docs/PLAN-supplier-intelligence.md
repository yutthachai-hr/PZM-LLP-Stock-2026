# Supplier Intelligence · Delivery Risk · Shortage Early-Warning

Plan written 5 Oct 2026, from the code as it stands on `main` (bf7ae93). Phases run in
order: S1 → S2 → S3 → S4 → S5 (readiness only). Nothing here is an LLM; every number is
a deterministic function of stored records and can be explained line by line.

## 1. Architecture found

- React 19 + Vite + TS PWA, Firestore **Spark** (free: 50k reads / 20k writes a day, no
  Cloud Functions). Two brands share one project through collection prefixes.
- Pure domain rules live in `src/lib/` and `src/lib/inventoryRules/` (bundled into the
  cron Worker too). Services in `src/services/` read/write through one `Backend`
  interface (Firestore / localStorage / in-memory for tests).
- Server-side: Cloudflare Pages Functions (`functions/`) with a service account since
  5 Oct 2026 (supplier confirmation), and a cron Worker (`worker/`) built but not yet
  deployed by the owner.
- Reads are the scarce resource (two quota incidents in Sept). Session range caches
  (`src/data/rangeCache.ts`, `orderCache` on `orderedAt`) and bounded listeners are the
  existing answer.

## 2. Collections that matter

| Collection | Use here |
|---|---|
| `purchaseOrders` | the ground truth: lines, `expectedAt`, `revisions[]`, `receipts[]`, cancel/close-short, supplier-answer fields |
| `suppliers` | `leadTimeDays`, `orderDays`, `cutoffTime` |
| `stockLevels` | on-hand per location × product (projection of the ledger) |
| `stockMovements` | usage rate (`usageIndex`, bounded window) |
| `transfers` | stock in flight between sites (`inTransit` etc.) |
| `notifications` | dedup-by-id alerts, stateful kinds (`resolve`/`rearm`) |
| `inventorySchedules/settings` | brand thresholds (where new knobs go) |

## 3. Reusable as is

- `receipts[]` (partial deliveries since 24 Sep): each has `date` (the delivery day the
  receipt is filed under) and per-line qty; `lines[].receivedQty` is cumulative.
- `revisions[]` with `{kind:'expectedAt', from, to}` — the full purchasing-side date story
  for orders that predate supplier confirmation.
- Supplier confirmation (5 Oct): `requestedDeliveryDate`, `confirmedDeliveryDate`,
  `deliveryDateHistory[]`, `supplierConfirmedAt`, `supplierLink.issuedAt`.
- `usageIndex()` (avg daily use per location/product), `stockView()` (on-hand, minimums),
  `incomingFor()`, `stockoutSoon()`, `dailySuggestions()` (warehouse → branch transfers),
  `notifications.plan()` (create / re-arm / resolve with no duplicates).
- Calendar `poExpected__<id>` items and the dashboard insight panels.

## 4. Missing

- **Rejected quantity** is not captured at receiving (only received qty + a note). S1
  reports `rejectedQuantity: null` (unknown) rather than inventing 0; capturing it is a
  receiving-screen change for later, with the owner.
- No stored delivery outcome / supplier aggregate / risk snapshot.
- `incomingFor()` ignores `receivedQty` — a part-delivered order is counted in full
  (S4 fixes this in its own function; the existing one is left for the screens that use it).
- No "reserved" stock concept. `reservedStock` = stock already committed to transfers not
  yet sent (`draft/pendingApproval/returned` from the source) — the only commitment the
  system records.
- No PO reopen: cancel and received are final (rules + service). The test plan pins that.

## 5. Migration / backfill

**No data migration.** Every S1 field is *derived* from what an order already stores, by
one pure function (`deliveryOutcome`). Nothing is written to historical orders, so there
is nothing to back-fill, roll back or re-bill. Aggregates (S2) are computed from the
orders the session already reads, through the existing range cache. If later the read
cost needs it, the cron Worker can persist per-supplier aggregates nightly — the API is
shaped so the UI does not change.

## 6. Old POs

- requested = the first `expectedAt` the order had: the `from` of its earliest
  `expectedAt` revision, else `expectedAt`; `requestedDeliveryDate` when it exists.
- confirmed = `confirmedDeliveryDate`, else the final `expectedAt` (a purchasing
  amendment is an agreed date), else none.
- No date at all → `deliveryStatus` is computed but the order is **excluded from
  on-time metrics** (`dueKnown: false`) — a lead-time guess is not ground truth.
- Received in one go before `receipts[]` existed → one synthetic receipt from
  `receivedAt` + `lines[].receivedQty`.

## 7. Receiving ground truth

- `actualFirstReceivedAt` = earliest receipt `date`; `actualFullyReceivedAt` = the receipt
  that brought every line to its ordered qty, or `null` (closed short / still open).
- Days are Bangkok business days (`bkkDayStart`); "on the due day" is on time.
- Fill rate on the due day = qty received by end of the due day ÷ ordered.
- A receipt duplicated (same docNo) counts once.

## 8. Metric formulas (per completed PO, then aggregated)

- `delayDays` = Bangkok days from **confirmed** date to the delivery that completed the
  order (or to the last delivery when closed short). Negative = early.
- `deliveryStatus`: `cancelled`; `partial` when closed short or still owed; else `early`
  (< 0), `on_time` (= 0), `late` (> 0). The first-delivery and due-day-fill facts are
  kept beside it, so "2 of 10 on time, rest 2 days late" is never just "on time".
- OTD = completed POs delivered in full by the confirmed date ÷ completed POs with a due date.
- Average / median / P90 / max delay over **late** POs only.
- Requested-date acceptance = POs whose confirmed date equals the requested date ÷ POs
  with both dates.
- Fill rate = Σ received ÷ Σ ordered (base qty) over completed POs.
- Response minutes = `supplierConfirmedAt` − `supplierLink.issuedAt`; pending/never
  answered are excluded from the average and counted separately.
- Cancellation rate = cancelled ÷ all non-draft POs in the window.
- Trend = OTD of the latest 30 days vs the 30 before (only when both have ≥ 5 POs).
- Windows: 30 d / 90 d / 6 m / 12 m / all, by `orderedAt`.

## 9. Supplier Score (0–100)

Weights in one config object (`SUPPLIER_SCORE_CONFIG`), default
40 OTD · 20 fill · 15 delay severity · 10 requested-date acceptance · 10 response · 5 reliability.
Each component is mapped to 0–100, multiplied by its weight, summed; a missing component
(no supplier link yet, say) is dropped and the remaining weights renormalised, and the
breakdown says so. Grades A+ ≥ 95, A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below.
Confidence by completed POs: < 5 insufficient (no grade shown), 5–19 low, 20–49 medium,
50+ high. Aggregation returns raw counts + rates so Bayesian smoothing can replace the
rate function later without touching the UI.

## 10. Risk engine v1 (S3, rules, open POs)

Additive points, capped at 100, every point a stored reason:
supplier OTD 90 d < 80 % (+25) / < 90 % (+10); 2 of last 3 late (+20); SKU late rate
> 25 % (+15); supplier already changed the date (+15); confirmed lead time below the
supplier's normal (+10); slow confirmation (+10); still unconfirmed one day before due
(+10); pending date approval (+15). Levels LOW < 30, MEDIUM < 60, HIGH < 80, CRITICAL.
Shown as "Risk Score 72/100", never as a probability. `riskEngineVersion` on every result.

## 11. Shortage algorithm (S4)

Per location × product with usage: available = on-hand − committed outgoing transfers;
cover = available ÷ avg daily use; stockout day = today + floor(cover); incoming = open
POs' (ordered − received) to that location, by their effective date, cancelled/received
excluded. Shortage when stockout day < first incoming day (or incoming after stockout
does not cover the gap). Gap days and units = usage × gap. Transfer suggestion only from
a location whose own cover after giving stays above its minimum and lead time.

## 12–13. UI, calendar, notifications

- New: Purchasing → **ผลงานผู้ขาย** (`/suppliers/performance`) list + detail (S2).
- Dashboard "Delivery Risk" panel; PO detail risk card (S3/S4).
- Calendar: the existing `poExpected__<id>` item gains risk level; a stockout item
  `stockoutRisk__<product>__<location>` (S4) — same id = no duplicates, rebuilt from data.
- Notifications: stateful kinds keyed by PO / product+location, fired only on an upward
  level crossing (level stored in the notification params) — `plan()` already dedups.

## 14. Files

S1/S2: `src/lib/deliveryMetrics.ts`, `src/lib/supplierPerformance.ts`,
`src/lib/supplierScore.ts`, `src/pages/suppliers/SupplierPerformance*.tsx`,
`src/data/usePerformanceOrders.ts`, nav + route, `en.ts`, tests.
S3+: `src/lib/deliveryRisk.ts`, `src/lib/inventoryRisk.ts`, notification kinds, calendar feed.

## 15. Tests

The 30 cases in the brief, as pure unit tests on the domain modules (no Firestore), plus
an i18n/typecheck/build pass. Read cost is pinned by the existing quota tests.

## 16. Risks

- Small samples: confidence gating, no grade below 5 POs.
- Back-dated receipts (`date` is what staff key) — accepted as ground truth, as the books do.
- Quota: "all time" reads every order once per session; acceptable at today's volume,
  measured on the read meter; Worker aggregation is the escape hatch.
- Units: quantities compared in base units (`baseQty`), old cross-unit lines without it
  are left out of fill rate rather than guessed.
