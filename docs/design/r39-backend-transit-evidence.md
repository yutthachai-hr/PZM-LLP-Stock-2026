# R39 backend transfer evidence

Base ae4ed7d42a678e89d0b3c94bf4fd2bd413c70f4b. All 19 PR49 changed files and critical transfer/stock/Firestore dependencies were read inline. No shipped algorithm is changed by this R39 addition; the new file is `tests/transit-workflow.emulator.test.ts`.

## What actually executes

Real `src/services/transfers.ts` and `src/services/stock.ts` call real `createFirestoreBackend`, the Firebase SDK transaction implementation and the local Firestore emulator with the candidate's Rules. The only backend-selection shim chooses that adapter and an authenticated emulator identity. Stock operations, persistence, reads, transactions and Rules are not mocked. Notification delivery is stubbed so no external/customer message is possible. Fixture setup alone uses the emulator's rule-disabled context.

The acting client matches `src/firebase/app.ts`'s `ignoreUndefinedProperties:true`. The first harness run omitted this setting and all nine tests failed on optional undefined note fields, before testing the workflow. That was a harness mismatch, not a newly discovered production defect. The corrected test uses the shipped setting. No API token, Production project or supplier link is used.

## Nine passing integration cases

1. Pizza dispatch 100 -> warehouse90/transit10 -> branch10/transit0, complete receipt.
2. Same workflow independently in Le Lapin.
3. Partial receipt 7 leaves 3 in transit, then manager resolution completes the remaining receipt. This is the app's discrepancy-resolution contract, not repeated arbitrary `confirmReceive` calls.
4. Zero received and NOT_ACTUALLY_LOADED returns the full dispatch to origin.
5. Pre-dispatch cancellation changes no stock; in-transit cancellation, repeated approval and repeated completed receipt are refused; recovering the valid receipt still conserves stock.
6. Closing an already-stocked branch after dispatch refuses receipt atomically. Its existing5, warehouse90 and transit10 remain company-owned105.
7. An additional typed transit location holds3 while canonical transit holds7, counted once. A real stock-service move returns3 to canonical transit before the existing receipt workflow completes. This does NOT claim the transfer workflow directly routes receipt out of any arbitrary transit location.
8. A seeded historical negative anomaly (-2 transit) stays signed in company88 and valuation3278; impossible receipt is refused without partial mutation. The historical anomaly is seeded, not created by a valid transfer.
9. Brand switching cannot read/settle the other namespace's transfer; Le Lapin's separate40 does not change Pizza's warehouse90/transit10.

At every asserted state, actual persisted stockLevels equal the non-voided ledger's location/unit deltas. The test checks warehouse, branch, both transit balances, company = sites + transit exactly once, and valuation at37.25 per KG including cents. Cross-brand evidence is namespace isolation; current client Rules deliberately grant active users all brands, so this is not proof of a nonexistent per-user brand ACL.

## Verification and limits

- Full candidate Rules/emulator suite237 passed / 9 files, including all9 new workflow cases.
- Full unit1714 passed / 141 files; includes bucket/Stock Card/as-of/trend regressions.
- Build including all typecheck targets passed.
- Existing browser-storage suite10 passed, including Stock Card, Dashboard, Reports, parsed Excel, Cost Report, closed stock, multiple transit locations and as-of dates. These ten are still demo/localStorage UI checks, not backend workflow proof. Backend proof is the separate suite above.

No physical transport/scanner/device workflow, remote staging transaction, or historical Production backfill was performed. Independent final-head review and exact-head CI remain release gates. The code-only rollback baseline is main e34a847. No Rules deployment is authorized by these results.
