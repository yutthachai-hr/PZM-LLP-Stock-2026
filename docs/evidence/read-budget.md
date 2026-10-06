# Release blocker — Firestore read budget

Production reported about **203k document reads a day** against the free plan's 50k. This
document gives the measured cause, the fix, and before and after figures. Every number below
is a count of documents delivered on the Firestore emulator. None of them is estimated from
reading the code.

## How it is measured

- **`e2e/read-benchmark.spec.ts`** seeds a brand the size of production (`e2e/bigFixture.ts`):
  - 460 products;
  - 1,400 balances;
  - 50 per-branch minimums;
  - 30 suppliers;
  - 60 movements a day for 45 days;
  - 120 POs;
  - 280 notifications.

  The spec then opens each scenario and counts reads in two places:
  - **In the app** (`src/data/readMeter.ts`): listeners (first snapshot = its size; later
    snapshots = their changes), single-document reads, queries (an empty one counts 1),
    transaction reads, and single-document listeners.
  - **On the server**, for the stock commands (`e2e/command-server.mjs`, `/__reads`).
- **The e2e hook** `window.__pzmReads` exists only in emulator builds.
- **The data files:** `docs/evidence/data/read-benchmark-{before,preG,after}.json`.
  - before = commit `e499e47` (all phases up to G10, with only the meter added);
  - preG = `2f395c6` (before Phase G);
  - after = this change.
- **The Worker:** `tests/worker/worker-reads.test.ts` measures the cron Worker on the same
  sizes, with Le Lapin at a quarter of them. Data file: `docs/evidence/data/worker-reads.json`.

## Root cause

Every **cold open** read the whole working set again: products, balances, overrides, the
ledger window, and a week of notifications. That is about 2,800 documents per open:

- a phone opening the app from its home screen;
- a reload;
- a second tab;
- a listener that resumes after more than 30 minutes away.

Moving around inside the app was already cheap (0–60 per screen). About 70 opens a day
across both brands reproduces the 203k (`tests/read-budget.test.ts`).

## The fix

1. **A device cache with a delta listener** (`src/data/cachedLive.ts`, `localCache.ts`,
   `useLive({ cache })`).
   - The five big live sets are kept in IndexedDB.
   - On open the app shows them from the cache. The listener then asks only for
     `field >= min(newest seen, now) − 30 min`.
   - It reads everything again when:
     - there is no cache;
     - the cache is more than 7 days old;
     - the ledger window has widened;
     - or the brand's **cache epoch** has moved.
   - Missing or blocked storage simply means no cache, which behaves exactly as before.
2. **The cache epoch** (`meta/cacheEpoch_<brand>`, `services/cacheEpoch.ts`).
   - A change listener cannot see a deletion or a rewrite. So these admin actions bump the
     epoch after they succeed: edit, void, recompute, product unit changes, a unit
     migration or rebase, deleting a product or location, and a restore.
   - Every device then reads the affected set once in full.
   - Rules: any active user may read the epoch; only an admin may write it, and only number
     fields for the five named sets (`tests/cache-epoch-rules.test.ts`).
3. **Persisted range caches.** The order, transfer and request caches are kept on the
   device. They refresh with a delta on `updatedAt`, and in full once every 24 hours. The
   Orders page now uses the order cache.
4. **Suppliers.** They are cached on the device, with a delta on `updatedAt` and a full
   read every 24 hours.
5. **Import** used to read the whole ledger. It now reads from the earliest imported date
   minus one day. A test shows the plan is identical to the full-ledger plan.
6. **Meter completeness.** `getOne`, `getBy`, `getRange`, `getAll`, transaction reads and
   single-document listeners are now counted, and live listeners are counted up and down.

### Per-branch minimums

`productMinOverrides` carry no `updatedAt`, and no screen in the app writes them. They come
only from a restore, which bumps the epoch. A delta query therefore returns nothing for them
(Firestore leaves out documents without the field).

If an admin edits an override in the Firebase console, devices pick it up at the next 7-day
refresh. Restore is the supported path.

## Before and after (documents per scenario)

| Scenario | preG | before | **after** |
|---|---:|---:|---:|
| cold start, dashboard (first open on a device) | 2,848 | 2,848 | 2,851 |
| second tab, dashboard | 2,835 | 2,835 | **72** |
| cold /products | 2,651 | 2,651 | **57** |
| cold /receive | 2,665 | 2,665 | **71** |
| cold /orders | 2,713 | 2,713 | **60** |
| cold /movements | 2,651 | 2,651 | **57** |
| cold /suppliers/performance | 2,864 | 2,864 | **59** |
| cold /calendar | 2,832 | 2,832 | **61** |
| cold /inbox | 2,685 | 2,807 | **93** |
| cold /products/p1/card | 2,673 | 2,795 | **81** |
| warm /orders | 62 | 62 | **2** |
| warm /receive · /calendar · /inbox · stock card | 14 · 4 · 34 · 22 | same | same |
| route switching, second round | 142 | 142 | **82** |
| open the bell | 0 | 0 | 0 |
| reconnect in session | 0 | 0 | 0 |

**Phase G's own cost:** about 122 documents, only on a cold open of the inbox or a stock card
(compare preG with before). It is now covered by the cache like everything else.

### Checks on the listeners

| Check | Evidence |
|---|---|
| Recipient-scoped notifications | Opening the bell reads 0. The notification listener is the one global listener (`useNotifications` context); NotificationHost adds none. |
| No listener leaks | Live listeners on a quiet screen after visiting every route are the 8 global ones: users/one, meta/one, locations, products, stockLevels, stockMovements, productMinOverrides, notifications. |
| No global movement listener beyond the windowed one | The ledger listener is windowed by `date` and cached by `createdAt`. |
| Supplier intelligence fetched once | `SupplierIntelProvider` serves every consumer. |
| Overlapping range reads coalesced | `rangeCache.gapsIn`. |

## Daily budget (busy day, both brands)

The model in `tests/read-budget.test.ts` is calibrated so that the BEFORE figures reproduce
production: 70 × (2,820 + 3 × 17.5) ≈ **201k**.

The same profile prices the AFTER code at **≈ 17.9k a day**:

- 70 opens × (70 + 3 screens × 10);
- 10 devices each rebuilding fully once every 7 days;
- one admin epoch bump a day (every device re-reads the ledger window);
- the daily full refresh of the range caches and suppliers.

The cron Worker (`tests/worker/worker-reads.test.ts`) adds about **5.9k a day**:

| Job | Reads per run |
|---|---:|
| half-hourly (×48) | 12 |
| generate | 8 |
| morning | 4,957 |
| weekly (once a week) | 2,811 |

**Total: about 23.8k a day**, below the 25k target and under half the 50k quota.

- Doubling the opens (140 a day) stays under 40k; the test checks this.
- The largest remaining cost is the Worker's morning job. It reads products, balances and
  30 days of the ledger once a day. If more headroom is needed, that job could read a
  stored daily summary instead. This is **not** done here; it is an option for the owner.

## Gates run with this change

| Gate | Result |
|---|---|
| unit | 1,297 passed (114 files) |
| rules | 225 passed |
| e2e | 30 of 30 (benchmark excluded); the benchmark passes on its own |
| tsc | clean |
| oxlint | 0 errors |
| i18n | complete |
| bundle | within budget (main 220 KB, initial 1,697 KB) |

## What it cannot show here

- These are emulator counts on a production-sized fixture, not production's billing console.
- After deploy, step 2 ("verify the read budget") is to watch Usage → Firestore reads for 24
  hours. Expected: under 25k on a busy day.
- The first open on every device after deploy reads the full set once, since no cache
  exists yet. Expect day one to be higher, around 10 devices × 2,850 more.
