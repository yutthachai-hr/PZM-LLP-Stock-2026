# Phase G — PZM Operations Intelligence (read / analyze / recommend): evidence

Branch: `claude/phase-a-ledger-continue-uzbbb5`

| Commit | Content |
|---|---|
| `4a5b299` | G1–G7 |
| `cc87e1a` | G8 |
| `945a3fd` | G9 |
| `e499e47` | G10 |
| `9b3ee06` | read budget (see `read-budget.md`) |

**Status**
- **Phase G is built.** Every engine only reads, analyzes and recommends.
- **No new automatic actions.** Nothing creates a PO, approves a PR, moves stock, adjusts a
  balance, or sends LINE.
- **Phase H is not started.**

## Exit gate

| Requirement | Result | Evidence |
|---|---|---|
| Read / analyze / recommend only | **PASS** | `tests/suggest-only.test.ts`: nothing under `src/intel` imports backend, services, firebase or data (static check on every file). The only write is the shadow snapshot, made from `services/intelShadow.ts`, which is outside `src/intel`, and it is create-only. |
| Versioning | **PASS** | Every result carries `IntelMeta { engine, engineVersion, calculatedAt, inputsAsOf, dataConfidence, dataNotes }`; versions are in `INTEL_VERSIONS` (`src/intel/meta.ts`). Test: "every result carries engine…" |
| Data confidence; "no reliable recommendation" is a valid answer | **PASS** | `high / medium / low / insufficient`, plus named gaps such as `noUsageHistory`, `unknownUnit`, `unknownLeadTime` and `missingIncomingDate`. Tests: "no usage history: no prediction", "no history at all is insufficient", "a unit with no rate is flagged". |
| Explainable (WHY) | **PASS** | Reasons are codes with their figures. Every code is worded in `src/intel/copy.ts` (test: "all codes the engines return are worded"). The screen shows them through `components/intel/Why.tsx`. |
| Grounded | **PASS** | Test: "grounded: every id in a result is an id from the inputs". |
| Scores are not probabilities | **PASS** | Scores are shown as "HIGH · 72/100", never as a %. Test: "a heuristic score is a score…". Brier and calibration are reported only as *uncalibrated* diagnostics. |
| Time-correct historical benchmark (no leakage) | **PASS** | `asOf(data, t)` slicing. Leakage tests scramble everything after t and require identical predictions (delivery risk and stock-out). |
| Shadow mode | **PASS** | `intelShadow`: manager/admin create only; no update or delete for anyone; staff cannot read (`tests/intel-shadow-rules.test.ts`, 4 tests). Each snapshot is judged later against the outcome (`tests/shadow.test.ts`). |
| Benchmark on the latest real production backup | **NOT RUN HERE** | The backup is on the owner's machine (`D:\AI Solution\pzm-stock-*-20261006-1500.json`) and not in this container. Command: `npm run intel:backtest -- "<backup.json>" --json report.json` (read-only, zero Firestore reads). The figures below are from the seeded synthetic history. |

## G1–G10

| # | Engine / part | File | Key behaviour (all tested in `tests/intel.test.ts`, 26 tests) |
|---|---|---|---|
| G1 | Supplier intelligence | `intel/supplier.ts` (`supplierIntel`, `skuIntel`) | Score broken into components that sum to it; delay distribution (median, P90); trend; date changes; cancellations. |
| G2 | Delivery risk | `intel/supplier.ts` (`deliveryRiskIntel`) | Risk from delivery history; without supplier history, confidence is low. |
| G3 | Stock-out prediction | `intel/stockout.ts` | 14-day day-by-day walk. Partial receipts count only what is still owed; cancelled, closed and draft orders count as nothing; goods in transit count as incoming. A late-prone delivery is also run at its P90 delay ("would gap if late"). |
| G4 | Transfer recommendation | `intel/transfer.ts` | The source keeps `max(min, 3 days of use)` and pending outgoing transfers come off first. Property test over 300 random worlds: the source never goes short. |
| G5 | Purchase quantity | `intel/purchase.ts` | Each step shown: forecast → safety → available → reliable incoming → transfer → need → MOQ → pack → recommended. Risky or undated incoming goods are *not* counted as reliable and are listed. |
| G6 | Alternate suppliers | `intel/alternate.ts` | Side by side: price, days short avoided, lead-time difference, score. |
| G7 | Anomalies | `intel/anomaly.ts` | 7 kinds, using median/MAD statistics and aware of `asOf`: unusual use, large adjustment, rejection share, over-receipt, price spike/drop, count variance (including repeats), duplicate entry. |
| G8 | Backtest harness | `intel/backtest.ts`, `intel/synthetic.ts`, `scripts/intel-backtest.mjs` | Precision, recall, false-warning and miss rates, ROC-AUC, PR-AUC, Brier, calibration bins. |
| G9 | Shadow mode | `intel/shadow.ts`, `services/intelShadow.ts`, rules | Snapshots of delivery and stock-out predictions are kept once (deduplicated) and judged later. |
| G10 | Where people look | `pages/products/IntelPanel.tsx`, Inbox `stockoutRisk`, SupplierPerformance `SkuTable`, `pages/settings/ShadowSection.tsx` | Every item shows Why plus a confidence note. Recommendations only (e2e `e2e/intel.spec.ts`). |

## Benchmark (synthetic history, seed 42, 150 days; test window, every 2 days)

Data: `docs/evidence/data/phase-g-benchmark.json`, written by `tests/backtest.test.ts`.

### Delivery risk (n = 97 orders, coverage 0.866)

| Point · threshold | Precision | Recall | False-warning rate | Miss rate | ROC-AUC | PR-AUC | Brier* |
|---|---:|---:|---:|---:|---:|---:|---:|
| at placement · MEDIUM | 0.692 | 0.750 | 0.250 | 0.250 | 0.772 | 0.647 | 0.19 |
| at placement · HIGH | 0.719 | 0.639 | 0.188 | 0.361 | 0.772 | 0.647 | 0.19 |
| day before due · MEDIUM | 0.692 | 0.750 | 0.250 | 0.250 | 0.768 | 0.640 | 0.19 |
| day before due · HIGH | 0.719 | 0.639 | 0.188 | 0.361 | 0.768 | 0.640 | 0.19 |

\* *Uncalibrated.* The score is a heuristic and not a probability. Calibration bins: in the
0–0.2 bin the mean score is 0.03 against an observed rate of 0.19. That is why scores are
never shown as a percentage.

### Stock-out (7-day window)

| Measure | Value |
|---|---|
| Decisions (n) | 825 |
| Precision | 0.301 |
| Recall | 0.430 |
| False-warning rate | 0.106 |
| Miss rate | 0.570 |

- **Quantity** (n 113): MAE 10.4 units, bias +0.07, 86.7% within ±25%.
- **Transfer safety:** 0 violations in 163 recommendations.
  - The first, unrefined rule found 1 violation. On inspection it came from the history's own
    later refill of the same destination being counted twice.
  - The refined rule excludes real shipments to that destination. Documented in
    `evaluateStockout`.

### Supplier deterioration

| Measure | Value |
|---|---|
| n | 47 |
| Coverage | 0.298 |
| Precision | 0.667 |
| Recall | 0.167 |

It warns rarely and misses most cases. Keep it as a hint, not a signal.

### Reading these honestly

- **The history is synthetic.** These figures show the harness works and that the engines
  rank better than chance. They do **not** show production accuracy.
- **Stock-out precision of 0.30** means about 2 in 3 warnings would not have become a
  stock-out within 7 days. That is acceptable for a suggestion in the Inbox, but not as a
  trigger for any automatic action.
- **The next step is shadow mode on production.** Snapshots are judged against what really
  happened (Settings → shadow). Only then should anything be considered for Phase H, and
  Phase H is not started.

## Read cost

- Phase G alone added about 122 reads, only on a cold open of the Inbox or a stock card
  (`read-benchmark-preG.json` against `-before.json`).
- Supplier intelligence is computed once in `SupplierIntelProvider`.
- Since `9b3ee06` this is covered by the device cache: a cold Inbox open is 93 reads in total
  and a stock card 81.

## Tests

| Suite | Tests |
|---|---:|
| `tests/intel.test.ts` | 26 |
| `tests/backtest.test.ts` | 8 |
| `tests/shadow.test.ts` | 3 |
| `tests/suggest-only.test.ts` | — |
| **Total (with suggest-only)** | **42 passed** |
| `tests/intel-shadow-rules.test.ts` (emulator) | 4 passed |
| e2e `intel.spec.ts` | passes (full e2e 30/30) |

## What waits on the owner

1. Run `npm run intel:backtest -- "D:\AI Solution\pzm-stock-<brand>-20261006-1500.json" --json g-real.json`
   for each brand, and paste the report into this document.
2. Deploy the rules (`intelShadow`) together with the release, so shadow snapshots start
   collecting.
3. After 14 days or more of shadow data plus the integrity gate, decide whether any engine
   should move beyond suggestion. That is the Phase H decision, and it is not started here.
