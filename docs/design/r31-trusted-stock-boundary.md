# R31 trusted stock commands: PhaseA boundary inventory

Prototype/design only. No endpoint, flag, Rules, schema or Production activation in this branch.
Current base main2c759f7f. Independent architecture/security review still required.

## What is authoritative today

`firestore.rules` authorizes browser Firestore writes; client services are conventions, not a
trusted enforcement boundary. `src/backend/firestore.ts` supplies browser transactions;
`src/backend/local.ts` is demo-only and not a security boundary. Service accounts bypass Rules.

| Current caller/path | Mutable records/invariant | Command migration target |
|---|---|---|
| services/stock.ts receiveStock, consumeStock, issue/adjust/count/edit/void/rebuild helpers | movements, levels, document counters, image references | receive/issue/count/adjust/edit/void |
| services/purchaseOrders.ts create/approve/amend/receive/close/cancel | PO state/approvedAt, receipts, levels, counters | PO transitions + atomic receipt |
| services/transfers.ts reviewTransfer, confirmReceive, discrepancy/misroute/cancel | source/transit/destination legs, movements/levels/transfer state | ship, receive, settle, cancel |
| services/unitMigration.ts migrateProductUnits; unitRebase.ts rebaseProductUnit | product units, historical movement restamps, PO revisions, balances | versioned admin migration plan/commit |
| services/backup.ts restoreBackup | original actors, ledger, derived levels, floors/counters | server admin restore dry-run/commit |
| services/products.ts deletion/retirement | catalogue lifecycle versus stock and open PO references | transactional retirement |
| R25 isolated candidate experimentalReceipt + experimentalStore | R&D experimental products/claims, operation receipt, stock | narrow existing default-off command, not a universal stock store |
| functions/_lib/supplierPo + serverStore | supplier agreement fields and notifications, no stock | retain narrow field allowlist; do not widen for stock |

A4's local open-PO query occurs outside the deletion transaction. It is a useful UI guard,
not proof against a concurrent PO create. Server PO transitions and catalogue retirement
need a common per-product fence/reference invariant before that race can be called closed.

## Restore evidence, corrected

Run `tests/r31-stock-restore-rules.test.ts` with the Rules emulator. It uses schema-valid
movement/level fixtures, explicit positive controls and one Firestore instance per batch.
The old R30 movement used `byName` rather than required `byUserName`; its balance omitted
`updatedBy`. Those errors caused denials independently of the historical-actor question.

On current main: own-author valid movement with/without revision increment ALLOW; foreign
historical actor DENY. Current-admin-signed rebuilt balance ALLOW; historical `updatedBy`
DENY. INTEG requires the revision increment for the own-author movement, then ALLOW.
Both also allow the known S1 fake-balance write when the writer increments ledgerRev.
Nine assertions pass on each ruleset. This is characterization, not a security fix or proof
that Production restore has been exercised. No real restore was attempted.

## Proposed contract, not a published API

Envelope: authenticated user + fixed command name + logical brand + UUID operationId +
opaque expected-revision token + command payload. Actor identity/role comes from live user
and revoked-user records, never the body. Parse IDs/quantities/units/dates once at the boundary.
Cross-brand physical collection names are not accepted as input.

The target is server-owned ledgerRev per brand. Clients receive a snapshot/precondition token;
they never set, increment or repair the server revision directly. An authenticated active user
is insufficient for brand access: the current AppUser has siteIds, not a brand-membership
field. Explicit server-side brand authorization must be designed and reviewed before activation.
Do not reinterpret siteIds as brands or silently grant all brands to every admin.

| Command | Minimum authority to preserve/check |
|---|---|
| receive, issue, draft PO | existing staff policy + authorized brand/site, master data and quantities |
| count/adjust | existing permitted role + expected snapshot/revision, no stale ProductEditor overwrite |
| transfer ship/receive | role, source/destination site, transfer state and outstanding quantities |
| movement correction/void | existing correction role, reason, immutable identity and append-only audit |
| rebase/restore/retirement | admin, explicit reviewed plan and version/fence preconditions |
| PO approval/date decision | preserve deliberate staff PO approval policy; supplier date decide remains manager/admin |

For each state-changing operation, read authority/revocation, brand fence, affected masters,
source documents, counter and operation receipt in the same consistent commit protocol.
Compute ledger deltas and rounded derived levels using the existing unit/receipt calculation.
Commit movements/levels/counters/audit, ledgerRev+1 and the immutable operation result atomically.
A retry with the same actor+brand+command+operationId and same canonical payload returns that
result; a different payload conflicts. Concurrent revocation/state/counter/level changes force
revalidation. A lost response is unknown outcome, recovered by that operation ID, not a new one.

Stock transfer must remove source into transit at shipment, and remove transit into destination
only on destination receipt. Receipt/discrepancy/return are distinct signed transitions. Compare
per-location ledger, transit ledger, levels, counters and source state, not only total company qty.

## Administrative restore

Dry-run has no writes. It validates provenance, original actor metadata, unit conversions,
identity collisions, counter floors, supported backup version and the current brand/revision.
It produces a plan digest, explicit warnings and exact affected records. Commit refuses a stale
plan; no silent provenance downgrade or impersonation. Keep original historical attribution and
record the current restoring admin separately in a reviewed server audit/provenance model.

Large restores need a resumable staged generation with a reviewed publication boundary or an
equivalent atomic-visibility strategy; a loop of independent live batches is not a safe restore.
That model is an architectural/schema decision and remains HOLD. No blanket admin Rules bypass.

## Backward-compatible rollout and acceptance

PhaseA is incomplete until all scenarios have reproducible fixtures and contracts reviewed.
This commit only corrects the restore observation and records the write-path/contract inventory.

PhaseB: implement command-private endpoints behind default-off configuration, no caller switch.
Role/brand/revocation, operation fingerprint, stale revision, counters, missing master data,
atomic rollback, duplicate and lost-response cases require real emulator tests. Compare each
old/new result on synthetic data. Historical restore and product/PO fences need dedicated tests.

PhaseC: migrate one command/caller cohort at a time through approved flags. Account for old
clients before Rules tightening; endpoints alone do not close direct writes. Owner approval of
rollout/Rules/schema/auth changes is separate from ordinary application PR authorization.

Outstanding matrix: S1 (fresh characterization above), S2 forged transfers, S5 historical edits,
B4 ordered PO create, issues41/36 stale count/rebase/import, cross-brand access, catalogue/PO
race and counter/revision integrity. R30 receipts for these are prior evidence, not fresh passes.
R25 restore-provenance behavior is an unmerged candidate, not a substitute for the admin restore.
