# Deployment runbook: `rc/ops-os-rc1-candidate` → production (owner decision 8)

**Every step is the owner's to run, or to approve before it is run.** Nothing here has been
executed. Each step has a check, and each has a way back.

| Term | Meaning |
|---|---|
| **PROD** | Firebase project `pzm-stock-x5`, Pages `pzmstock.pages.dev` |
| **Rollback app** | Pages deployment `0d00ae76` (`903c8db`). The current app is `614fcc13` (`ad43971`). |
| **Rollback rules** | The rules of `origin/main` at release time: `git show origin/main:firestore.rules > rules.prod.bak` |

## 1. Backup and baseline (before anything changes)

1. **Backup.** Settings › สำรองข้อมูล (backup), for each brand: Pizza Mania, Le Lapin, R&D.
   Store the three files off the machine. Record their `createdAt`.
2. **Integrity baseline:** `node scripts/integrity-audit.mjs <backup>` for each brand.
   Expect **PASS**, and keep the output.
3. **Read baseline:** Cloud Monitoring `document/read_ops_count`, hourly, for the last 3 days
   (same query as `docs/ops/owner-gates.md` §C). Note yesterday's total.
4. **Error baseline:** the `/api/client-error` logs for the last day (`wrangler pages
   deployment tail`, filter `client-error`).

## 2. Verify rules and indexes

1. Save the live rules as the rollback copy: Firebase console → Firestore → Rules → copy
   into `rules.prod.bak`. Diff it against `git show origin/main:firestore.rules`; it must be
   identical. If not, stop: production has drifted.
2. Check indexes: `npx firebase firestore:indexes --project pzm-stock-x5`. The live set must
   equal `firestore.indexes.json`. It did on 8 Oct: 6 = 6.

## 3. Transition rules (backward-compatible, temporary)

- **What:** `firestore.transition.rules`. It is generated from `firestore.rules` by
  `scripts/rules-transition.mjs`, and differs **only** in `versionMoved()`: a non-admin
  edit of a product or order may move `version` by +1 (new app) **or leave it unchanged**
  (old app).
- **Everything else is already the strict ruleset:** R&D collections, audience-keyed
  notifications, the stock commands' closure and the rest.
- **Deploy:** point `firebase.json` → `firestore.rules` at `firestore.transition.rules`
  **for this deploy only**, then:
  `npx firebase deploy --only firestore:rules --project pzm-stock-x5`.
- **Check:**
  - an old tab (not reloaded) edits a product's unit rate and succeeds;
  - a test account's request still files.

  (Emulator-proven: `tests/rules-transition.test.ts`.)
- **Temporary:** keep it only until step 7. Do not ship another app release while it is
  live without re-checking this list.

## 4. Deploy the app

1. Merge PR #1 after review **with CI green** (branch protection requires the 9 checks).
   Pages builds `main` → production.
2. Before merging, confirm Cloudflare Pages production variables carry no new flags:
   - `VITE_SHADOW_SEED`: unset;
   - `VITE_OTHER_ITEM`: unset (Smart Other on for R&D) or `off`;
   - `OUTBOX_ENABLED`: unset.

## 5. Verify the critical workflows (production, one brand at a time)

Use real but small actions by an admin, and undo each where it applies.

| Workflow | Check |
|---|---|
| Sign in | All three brands open; the R&D catalogue shows its pictures and its logo |
| Receive against a PO | 1 line; balance and order updated once |
| Transfer | Request → approve → receive; transit nets to 0 |
| Purchase request → PO | Created; supplier link signed and opens |
| Import (Excel) | A guessed row is **not** ticked; an unknown unit is blocked |
| R&D stock entry on a unit-less product | **Refused** with "ยังไม่มีหน่วย" (no unit yet) |
| Smart Other (R&D) | Type → create `RND-…` → request line |
| Notifications | The bell, a popup for a new event |
| Previews | `integration-ops-os-rc1.pzmstock.pages.dev` → privileged routes `preview_isolated` |

## 6. Verify old clients are gone (evidence, not hours)

Old app tabs are the reason step 3 exists. A fixed wait is **not** proof. The signal:
- Every stock command from the new app carries `x-pzm-build` (the commit prefix), logged
  as `build` in its `pzm.trace` line (`tests/trace-build.test.ts`).
- Old builds send none.

1. `npx wrangler pages deployment tail --project-name pzmstock --environment production
   --format json | grep pzm.trace`
2. For each command line, read `build`. **Old client = a command with no `build`** (or an
   older commit than the release).
3. **Gate to step 7:**
   - **zero** build-less commands for one full working day, across the hours each branch
     works; **and**
   - no `/api/client-error` report carries an older `build` (error reports already send it);
   - devices that only read do not matter: they cannot break a rule.
4. If an old build keeps appearing, find the device (`requestId` → time → site) and reload it
   by hand. Then restart the count.

## 7. Strict G25 rules

- Point `firebase.json` back at `firestore.rules`, then deploy the rules only.
- **Check:** a new-app product edit succeeds. On the emulator, an edit without a version
  bump is refused (`tests/rules-transition.test.ts`).
- **Back:** redeploy `firestore.transition.rules`. It is safe for both builds.

## 8. Monitor (first 3 days)

| Signal | Where | Alarm |
|---|---|---|
| Firestore reads | Cloud Monitoring, hourly | Any hour above 1.5× the baseline hour; a day above 30K |
| Client errors | `/api/client-error` logs | Any `permission-denied` on products or orders (old clients) |
| Ledger integrity | `integrity-audit` on a fresh backup, each morning | Anything but PASS |
| PO / receipts / transfers | The app's audit log; transit balance = open transfers (`INV.TRANSIT_EQ_OPEN_TRANSFERS`) | Any finding |
| Read meter per device | Settings › การอ่านข้อมูล (data reads) | A device far above the others (a listener loop) |

## 9. Rollback and recovery (rehearse before step 3)

| Failure | Action | Safe because |
|---|---|---|
| App broken | Pages → `pzmstock` → Deployments → `0d00ae76` → Rollback | The transition rules accept the old app |
| Rules break writes | Redeploy `rules.prod.bak`, the exact pre-release rules (step 2) | Old and new apps both work under main's rules **except** the new app's `version` field on products and orders; so roll the app back first, then the rules |
| Data damage | Restore the step-1 backup into an **isolated** project first, compare with `integrity-audit`, then restore production from Settings › กู้คืน (restore) | The restore bumps the cache epoch; devices re-read |

**Rehearsal:** run each rollback once on the **staging/emulator** copy (`npm run test:e2e` +
`tests/rules-transition.test.ts`) and time it. Record the times here before the real
release.
