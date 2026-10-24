# R61: P0 Logistics "Missing or insufficient permissions" hotfix

24 Oct 2026. Branch `hotfix/20261024-transit-location-rules`, PR #54, base `origin/main` 312f8a7.

| Commit | Content |
|---|---|
| `feb3c9c` | Rules fix + `tests/transit-location-rules.test.ts` |
| `01bb12c` | LogisticsSection status/feedback + `tests/logistics-status.test.ts` |

## Proven denial point (emulator)

`ensureTransitLocation()` (`src/services/transfers.ts:215`) calls `backend.set`, which writes
`{ ...data, id }` (`src/backend/firestore.ts:245`) to `<brand>locations/transit`:
`{ id:'transit', name:'ระหว่างขนส่ง', nameEn:'In Transit', type:'transit', active:true, createdAt }`.

The emulator on 312f8a7 denies the admin's create in `locations`, `lelapin__locations` and
`rnd__locations`: `PERMISSION_DENIED: false for 'create' @ L1673` (`allow create: writer &&
validShape && createdHonestly`). The same admin can create a warehouse, so the failing term is
`validLocation`'s `d.type in ['warehouse', 'branch']` (`firestore.rules:327`). Log:
`red-312f8a7.log`.

The gap shipped because `tests/transit-workflow.emulator.test.ts` seeds the transit location
with Rules disabled, so no test ran the admin's create path.

**Production root cause: LIKELY, not CONFIRMED.** I could not read the deployed ruleset because
the local Firebase CLI credentials have expired ("credentials are no longer valid"). The project
id is `pzm-stock-x5` (`.firebaserc`). The Rules on main have the same `validLocation` as PR51 and
PR1, so production has it too unless a deploy came from somewhere else.

## Rules before / after

```diff
     function validLocation(d) {
       ...
-        && d.type in ['warehouse', 'branch']
+        && (d.type == 'transit' || (d.type in ['warehouse', 'branch'] && d.id != 'transit'))
```

- Locations stay admin-only (`adminWritable`, `writer()` requires an active admin). There is no
  wildcard, no unauthenticated write, and no change to stock balances.
- `transit` is already a `LocationType` (`src/types.ts:117`), so this adds no new type.
- The canonical id `transit` may hold only the transit type. A transit location under another id
  stays writable by an admin: the domain model supports imported ones (`transitLocationIds` in
  `src/lib/inventoryRules/stockView.ts`, and `transit2` / `transit-b` in the existing tests).
- A legacy document at `transit` with the wrong type is left as it is. Rules block renaming it
  until its type is set to `transit`. The UI shows it as "invalid record" and does not report it
  as on.
- Movement Rules never read location documents (the location ids are only text-checked), so
  extra transit-typed locations change no movement permission.

## Tests (worktree `C:\Users\Yutthachai\pzm-r61-transit`)

| Check | Result |
|---|---|
| `tests/transit-location-rules.test.ts` on 312f8a7 (RED) | 9 failed / 5 passed |
| same, after fix (GREEN) | 14/14: admin create ×3 brands, repeat enable ×3, manager/staff/inactive admin/unauthenticated denied ×3, canonical id rejects warehouse/branch, wrong-type repair, imported transit, invalid shape, warehouse/branch unchanged |
| `npm run test:rules` (incl. `firestore-rules-budget`, `transfers-rules`, `transit-workflow.emulator`) | 251/251 |
| `vitest run` (incl. `tests/logistics-status.test.ts`, 5) | 1719/1719 |
| `tsc -b`, `oxlint`, `i18n:check`, `npm run build` | exit 0 (one new `only-export-components` warning, matching an existing one) |
| `playwright -c playwright.transit.config.ts` | 13/13 |
| Applicable E2E for Settings → Logistics | none exists; covered by the Rules test + `statusOf` unit test |

Logs in this directory: `red-312f8a7.log`, `green-transit.log`, `green-rules-full.log`,
`unit-full.log`, `e2e-transit.log`.

## UX (Wave D)

`check()` used to swallow every error, so a brand whose document could not be read sat on
"loading" forever. Each brand now reads its own status: on / off / wrong type / no permission /
could not check (with a manual "try again"). Success is shown only after the document reads back
with type `transit`. Errors name the brand and show AppError text or a generic translated
message, never raw Firebase text. A denied write is not retried.

## Independent review

Gemini (`opencode` / `9router/gemini-3.8-flash-high`), round 1: APPROVE_WITH_NITS on
`feb3c9c` / `01bb12c`. Active-admin gates and schema remain intact; reviewer reran Rules 251/251
and unit 1719/1719. P3 nits (await UI check, Fast Refresh helper placement, explicit canonical
update test) are optional follow-ups, not blockers for the minimal Rules hotfix. Exact-head CI
on PR54 `01bb12c`: 10/10 passed. R62 combined review of PR51 `634edd7`: APPROVE.

## PR51 / PR1 / G25 (Wave F)

- PR51 now carries this Rules fix and its regression test at `634edd7` (R62 cherry-pick of
  `feb3c9c`); combined Rules suite 305/305 and Gemini confirmation APPROVE. Deploying that
  exact PR51 head preserves transit support. Recheck after any later sync/rebase/Rules edit.
- PR1 (`rc/ops-os-rc1-candidate`): its `firestore.rules` merges clean with the fix (PR1 already
  conflicts with main in other files). **Its `firestore.transition.rules` (G25) still has the old
  line, so it needs the same change before any G25 deploy.**
- Guard against regression: once #54 is in main, `tests/transit-location-rules.test.ts` runs in
  CI for every branch that merges main. Any Rules file that drops the fix fails it.

## Status: BLOCKED for Rules deploy

What's missing, in order:
1. Independent review and CI on PR #54: passed (see above).
2. Owner: run `firebase login --reauth` so I can read the deployed ruleset and save it as the
   rollback copy (`prod-firestore.rules.rollback`), and confirm the production root cause.
3. **Owner approval for the Production Rules deploy.**

## Release plan (after approval)

1. Record approved Rules source `feb3c9c` / PR54 app head `01bb12c`. Do NOT merge first:
   merging main automatically deploys the app (HANDOFF / R59).
2. Read and compare the active production ruleset; save it as `prod-firestore.rules.rollback`.
   If it differs materially from the approved source, stop and reconcile rather than overwrite.
3. With explicit Production Rules approval, deploy ONLY `firestore:rules` from the approved SHA
   to `pzm-stock-x5`, preserving any live security changes.
4. Verify active Rules version, then request/execute separately approved #54 app merge. The
   existing app can enable Logistics once the Rules-only fix is live; UI release is optional.
5. As Admin: Settings → ระบบส่งสินค้า → switch on each brand once. Each should show "เปิดใช้แล้ว",
   and `locations/transit`, `lelapin__locations/transit`, `rnd__locations/transit` should exist
   with `type: 'transit'`.
6. Check that a manager/staff session cannot write locations. Open the Transfers page without
   approving a real transfer (no stock balances touched).
7. The app deploy (UI commit) can follow; the Rules fix works with the current app by itself.

## Rollback

Redeploy the saved active ruleset (`firebase deploy --only firestore:rules` from a checkout whose
`firestore.rules` is the saved copy). Main 312f8a7 is NOT a verified live rollback copy until
production comparison succeeds; do not overwrite unknown live security changes. The transit
documents created meanwhile are harmless under the old Rules (reads are allowed; approval only
checks that the document exists) and do not need to be deleted.
