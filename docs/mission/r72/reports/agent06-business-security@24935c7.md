# R72 AGENT06: Business Security & Live Firestore Rules Verification

**Status: QA_EVIDENCE_READY**  
*(Test sub-agent recovery; provides isolated QA verification evidence; does NOT constitute full security approval of all R72 application code)*

---

## 1. Executive Summary & Recovery Context

- **Task:** R72 Agent 06 controlled recovery after session 169625 auto-compaction (502).
- **Worktree / Branch:** Isolated worktree on branch `r72/agent06-security-r2` branched from `6045b50` (`Merge pull request #53 from yutthachai-hr/hotfix/20261024-sw-navigation-err-failed`).
- **Work Preservation:** No work lost; private history backup retained at `agent06 r72-failures-20261024T1817Z`.
- **Pre-requisite Checks:**
  - Ports `8080`, `9099`, `5176` checked and verified free before test execution.
  - Private `npm ci` completed cleanly (no NTFS junctions).
  - Live production rules hash confirmed: `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` (`cf5176f9` = `git 01bb12c:firestore.rules`, 92,222 bytes).

---

## 2. Checkpoint: Known Results & Audit Gaps

### Prior Verified Results (Saved & Completed — Not Replayed)
- **Unit Suite:** 99 PASS
  - Transfers unit tests & status transitions
  - Purchase order unit tests & pricing validations
  - Saved completed results preserved; not re-run in this bounded cycle.

### Previous Gap Identified & Resolved
- Earlier test runs for `transfers-rules.test.ts` (12 tests) and `transit-workflow.emulator.test.ts` (9 tests) executed without an active live rules overlay, causing `@firebase/rules-unit-testing` and `firebase emulators:exec` to read the repository's local `firestore.rules` on disk (`eee07cf8...` from MAIN at `6045b50`) instead of the verified live deployment (`ae39c231...`).
- This recovery executed an atomic Node try/finally harness (`scripts/verify-r72-live-rules.mjs`) that temporarily loaded the exact bytes of `git 01bb12c:firestore.rules`, executed the emulator suite, and restored the original repository file in `finally`.

---

## 3. Exact Live Rules Verification Execution

### Execution Protocol
- **Harness:** `scripts/verify-r72-live-rules.mjs`
- **Command:** `firebase emulators:exec --only firestore --project demo-r72-rules "npx vitest run --config vitest.rules.config.ts tests/transfers-rules.test.ts tests/transit-workflow.emulator.test.ts"`
- **Active Overlay Hash:** `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` (92,222 bytes)

### Test Execution Output
```
=== Step 1: Read original firestore.rules ===
Original hash: eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2 (len: 93662)
=== Step 2: Fetch exact Git 01bb12c:firestore.rules bytes ===
Git 01bb12c hash: ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270 (len: 92222)
Assert PASS: live rules hash matches AE39 exactly.
=== Step 3: Apply temporary live rules overlay ===
Active overlay on disk hash: ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270
=== Step 4: Run isolated Firebase Emulator test execution ===
Executing: firebase emulators:exec --only firestore --project demo-r72-rules "npx vitest run --config vitest.rules.config.ts tests/transfers-rules.test.ts tests/transit-workflow.emulator.test.ts"
+  firestore: Firestore Emulator was started in standard edition.
+  firestore: Firestore Emulator UI websocket is running on 9150.
Running script: npx vitest run --config vitest.rules.config.ts tests/transfers-rules.test.ts tests/transit-workflow.emulator.test.ts

 RUN  v5.0.0
 Test Files  2 passed (2)
      Tests  21 passed (21)
   Duration  23.38s

+  Script exited successfully (code 0)
=== Step 5: Restore original firestore.rules unconditionally ===
Restored disk hash: eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2
=== Step 6: Verify git diff --exit-code -- firestore.rules ===
PASS: git diff --exit-code confirmed 0 diff on firestore.rules
=== Live rules emulator verification completed successfully ===
```

### Verification Counts
| Suite | File | Tests Passed | Status |
|---|---|---|---|
| Transfer Security Rules | `tests/transfers-rules.test.ts` | 12 / 12 | PASS |
| Transit Lifecycle Emulator | `tests/transit-workflow.emulator.test.ts` | 9 / 9 | PASS |
| **Total Rules / Emulator** | **2 files** | **21 / 21** | **PASS** |

---

## 4. Security & Behavior Coverage Matrix

| Area | Covered by Tests | Details & Findings |
|---|---|---|
| **Role & Authorization** | **COVERED** | - Staff can only file empty draft transfers in their own name (`tests/transfers-rules.test.ts:98`).<br>- Staff cannot file in colleague's name, cannot create pre-approved transfers, and cannot transfer to the same site (`line 103`).<br>- Manager role required to approve, return, or reject transfers (`line 119, 130`).<br>- Admin role required to reopen rejected transfers (`line 130`).<br>- Destination branch staff only can receive; cross-branch staff blocked (`line 156`).<br>- Direct stock ledger movements between sites restricted to managers; staff must use transfer documents (`line 189`).<br>- Stock movement records immutable for all roles including admin (`line 198`). |
| **Brand Isolation** | **COVERED** | - `tests/transit-workflow.emulator.test.ts:156`: Cross-brand boundary enforced. Switching active brands prevents reading or settling transfers belonging to another brand. |
| **Workflow & Status Lifecycle** | **COVERED** | - Forward legs created by managers in-transit with parent reference (`transfers-rules.test.ts:109`).<br>- History records strictly append-only; cannot shrink (`line 148`).<br>- Post-dispatch route immutable; cannot be cancelled once stock is in transit (`line 141`).<br>- Discrepancy handling: receiving branch can report missing/damaged goods while transfer remains in transit (`line 166`).<br>- Discrepancy resolution requires manager; last leg arrival closes parent transfer (`line 172`). |
| **Transit Bucket Ledger Balance** | **COVERED** | - Partial receipts retain transit remainder until completed by manager (`transit-workflow.emulator.test.ts:93`).<br>- Unloaded goods return to origin without phantom loss of stock (`line 103`).<br>- Pre-dispatch cancellation preserves stock; post-dispatch cancellation rejected (`line 111`).<br>- Branch closure after dispatch halts receipt atomically; stock ownership maintained (`line 125`).<br>- Negative transit anomaly visible without silent clamping; invalid receipt rolls back (`line 145`). |
| **New UI Brand Races** | **NOT TESTED** | - Frontend client-side state races during fast brand switcher clicks while transfer or receive mutations are in-flight are not exercised by headless Firestore rules. |
| **High Concurrency Conflicts** | **NOT TESTED** | - High-volume concurrent mutations on identical transfer documents or simultaneous double-receive attempts are not stress-tested in local single-worker emulator suite. |

---

## 5. Working Tree Integrity & Byte Restoration Proof

- Original `firestore.rules` hash before execution: `eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2` (93,662 bytes).
- Temporary overlay applied: `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` (92,222 bytes).
- Final restored `firestore.rules` hash: `eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2` (93,662 bytes).
- `git diff --exit-code -- firestore.rules` exit code: `0` (clean, zero modifications).
- No deployment, push, or credentials accessed. All operations local.
