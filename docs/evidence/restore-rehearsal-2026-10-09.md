# Restore rehearsal with real backups: all three brands (9 Oct 2026)

**Backups:** taken by Claude at the owner's request, from the production app
(Settings › สำรอง / กู้คืนข้อมูล, "Backup / Restore"), signed in as the owner, about 10:41–10:43
ICT.

| Brand | File | SHA-256 (first 16) | Size |
|---|---|---|---|
| Pizza Mania | `pzm-stock-pizza-20261009-1041.json` | `3c67be2c20abc80e` | 8.0 MB |
| Le Lapin | `pzm-stock-lelapin-20261009-1042.json` | `bc1ffa011e6362d5` | 3.2 MB |
| R&D | `pzm-stock-rnd-20261009-1043.json` | `adc5fb45b850654b` | 0.1 MB |

**Where they are:** the owner's Downloads folder and `C:/pzm/backups` (outside OneDrive and
outside Git). Business data: never committed.

**Read cost:** one full read of each brand.

## 1. Integrity audit of the backups (app auditor, `scripts/integrity-audit.mjs`)

| Brand | Scanned | Critical | Warning |
|---|---|---|---|
| Pizza Mania | products 336, locations 3, levels 499, movements 3,340, POs 156, PRs 8 | **0** | 1: movement `RC-00019` refers to a deleted product |
| Le Lapin | products 176, locations 3, levels 49, movements 131, POs 60, PRs 8 | **0** | 0 |
| R&D | products 228, locations 3, nothing else | **0** | 0 |

Each backup's own check: 0 cached balances disagreed with the ledger when it was taken.

## 2. Isolated restore (`tests/restore-rehearsal.test.ts`)

**Method:**
- The app's own `restoreBackup` (overwrite mode) writes into the in-memory backend: no Firebase
  project, no network.
- The app's own `buildBackup` then reads it back.
- The two are compared collection by collection, field by field.

**Results: PASS for all three brands.**

| Check | Result |
|---|---|
| Restoring a file into the **wrong brand** | Refused |
| Every record of every collection | Back with identical fields |
| Ledger stamp | Identical |
| Drift | 0 before and after |
| Re-exported files, run through the integrity audit again | Same results as the originals |

**Expected, by design:** restore rebuilds balances from the ledger. Balances are restamped
(`updatedAt` / `updatedBy`), and **empty** balances are not recreated:
- Pizza Mania 42, of which 36 are legacy `#unit` balances already zeroed by the unit migration;
- Le Lapin 9 (5 legacy);
- every one held **0**, so no stock is lost.

The test encodes exactly that rule.

**Not covered:** a restore into a real isolated Firebase project. It would also exercise security
rules and quotas. It needs a separate Firebase project (owner).

## 3. Both integrity engines on the same files (`scripts/integrity-backup.mjs`)

The TypeScript reference and the Rust engine (`crates/pzm-integrity`) **agree on all six files**
(3 originals + 3 restored).

Both report `INV.PO_RECEIVED_EQ_RECEIPTS` as critical: Pizza Mania 110, Le Lapin 45, identical
before and after the restore. Examined, these are a **limit of the simplified reference, not
damaged data**:
- **Legacy orders** (PO-00001…) were received before receipt rows carried `poId`. The reference
  finds "received 8, ledger 0".
- **Lines ordered in another unit** (1 Carton = 6 EA). `receivedQty` is in the order's unit, the
  ledger in the base unit.

The app auditor understands both and reports 0 PO-receipt problems.

**Consequence:** the Rust engine agrees with its reference everywhere. It is **not yet fit to be
the authoritative check on real data** until that rule handles legacy receipts and entry units.
That needs a vectors change, tracked as follow-up work.
