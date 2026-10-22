# R38 — PR51 SECURITY HOLD: metadata is not an atomic stock reversal

Candidate base: 2abfcb4fe7a582f6d536b5e5cb43c7ca1744c2ca. This audit changes only the focused test and this document; no Rules or app implementation change, push, merge or deployment.

## Executable finding

`tests/void-reason-rules.test.ts` now requires a direct metadata-only admin cancellation to be denied. For each brand it seeds one valid receive movement of 5 and its `stockLevels/wh__p1` balance of 5, then authenticates as the existing active admin and writes valid cancellation reason/time/self-UID/name **without writing the balance**. Rule-disabled contexts are used only for fixture setup and reading the actual result, never for the attempted cancellation.

Observed for both `stockMovements` and `lelapin__stockMovements`:

- decision: **ALLOW** (expected DENY)
- stored movement: **voided=true** (expected false)
- stored balance: **qty=5**, unchanged

The receive disappears from the non-voided ledger, while its cache still contains 5. `voidedHonestly()` validates metadata and caller identity, not the matching balance reversal. The existing source comment already identifies this limitation; a client transaction and happy-path tests do not close it against direct writes. This audit establishes a candidate release blocker, not that PR51 newly introduced all pre-existing ledger/cache trust limitations.

## Verification

From `C:/Users/Yutthachai/pzm-r36-void-reason`:

```text
firebase emulators:exec --only firestore --project pzm-rules-test "npx --no-install vitest run --config vitest.rules.config.ts tests/void-reason-rules.test.ts"
```

Final observed result: **22 passed, 2 failed / 24**, exit 1; both failures show ALLOW / voided=true / qty=5. `oxlint tests/void-reason-rules.test.ts` and `git diff --check` report no errors (Git notes LF-to-CRLF conversion). The tests intentionally remain RED; assertions are not weakened to match the unsafe result.

Two preliminary harness defects were corrected before this evidence: Windows `cmd` cannot execute the POSIX `./node_modules/.bin/vitest` launcher, and `withSecurityRulesDisabled` does not propagate the callback's return value. The final test asserts document state inside the callback; the final log, not the preliminary runs, is the security receipt.

Log preserved in mission `waves/round38/evidence/pr51-atomicity-final.log`.

## Release decision and required closure

**SECURITY HOLD. Do not merge or deploy PR51.** Do not treat the old exact-head green CI or metadata checks as atomicity/security approval. The new tests/docs are local and uncommitted in this worktree.

Closure needs a reviewed trusted atomic command boundary or a proven equivalent authorization design, including normal/legacy units, both movement legs, concurrency, idempotent re-void, direct-write denial and all affected writers. Do not add restrictive Stock Rules before writer migration/compatibility is proven. Existing Stock command prototype is not a deployed cancellation endpoint and is not implicitly approved here.

The original app/Rules coupling also remains: old Production Rules reject the new audit fields. A reviewed compatibility/old-client plan, separate explicit Owner-authorized Rules window, independent security review and rollback/data-recovery plan remain required. No Production write, data correction or backfill was performed.

## Skill evidence

`tdd` loaded yes: C:/Users/Yutthachai/.agents/skills/tdd/SKILL.md. Steps 1–4 executed using the existing emulator harness and a narrow direct-write regression; steps 5–6 deliberately blocked pending atomic-boundary design/review, not represented as a completed fix. systematic-debugging and verification-before-completion used to distinguish harness failures from the final behavioral RED. No independent security approval claimed.
