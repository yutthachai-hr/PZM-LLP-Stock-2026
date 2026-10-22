# R35 trusted-command site fence (isolated prototype)

No browser writer/endpoint/Rules/feature activation is switched here. This is not Production security clearance.

`runStockCommand` now uses the existing `canUserAccessBranch` policy on live server-side user data before returning any receipt: restricted staff may adjust/count/approve a PO only at assigned sites; admins/managers retain all-site access; empty/absent staff `siteIds` retain existing unrestricted access. Brand authorization remains an explicit injected server policy, not an inferred grant. Transfer approval still requires manager/admin and checks the live source/destination.

User and target reads are commit preconditions. Reassignment during a commit forces a retry and reauthorization; response-loss replay cannot revive a revoked site or a downgraded manager role. Missing live PO/transfer now refuses even an old receipt: without that target the boundary cannot establish its current site. A repeated `tx.get` of those targets is served by the adapter's pinned read cache.

## Evidence

- Emulator RED: six newly asserted authorization/replay paths failed on `18b0dcc` source; four positive-policy controls passed.
- GREEN: site denial writes no movement/balance/counter/receipt; allowed sites, empty grants and managerial access preserve prior semantics; live reassignment and role-downgrade replays are denied.
- S5 adapter characterization: an existing movement ID is create-only (`exists:false`), and collision aborts the balance write too; `update`/`delete` are refused. This does **not** migrate legacy `editMovement` or implement a correction command.
- A product-master unit change injected between read/commit causes conflict then rejects the old-unit retry. This is not full legacy rebase concurrency coverage.

## Remaining security/lifecycle gates

Legacy direct browser writers still admit known S1/S2/S5/B4 characterizations. Complete receipt/issue/receipt/cancel/count/correction/rebase/restore/catalogue migration and reviewed brand authorization are required before restrictive Rules. Historical corrections must preserve original attribution and append audited effects; administrative restore must preserve historical attribution separately from the current administrator's authorization, never impersonate the old actor. Product deletion still needs an open-PO/catalogue fence. Internal ledger revision cannot fence writers that do not participate.

The prototype remains base-unit-only and has no Production rollout authorization. No new role/grant/schema, migration, backfill or Production data correction is deployed. Independent R35 exact-head review is BLOCKED by provider quota. Rollback: revert this isolated R35 commit to `18b0dcc`; preserve R33/R34 receipts.
