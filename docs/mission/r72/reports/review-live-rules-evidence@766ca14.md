# Independent QA Operational Review: R72 Live Rules Verification Harness

- **Verdict:** `APPROVE` (Harness & Verification Evidence Only)
- **Reviewer:** Independent QA Sub-agent
- **Platform / Provider:** T3 Code / Antigravity (`opencode`)
- **Model:** `9router/gemini-3.8-flash-high` (same-family independent reviewer, isolated session/checkout)
- **Target Git Reference:** `24935c7` (detached) vs base `6045b50` (`Merge pull request #53 from yutthachai-hr/hotfix/20261024-sw-navigation-err-failed`)
- **Reviewed Artifacts:**
  - `scripts/verify-r72-live-rules.mjs` (77 lines)
  - `docs/mission/r72/agent06-business-security.md` (97 lines)

---

## 1. Scope & Release Authorization Boundary

- **Approval Scope:** This review evaluates **strictly** the operational safety, correctness, and falsifiability of the temporary live-rules overlay test harness (`scripts/verify-r72-live-rules.mjs`) and the accuracy of the recovery report (`docs/mission/r72/agent06-business-security.md`).
- **Explicit Boundary:** PASS in Firestore security rules emulator tests **DOES NOT** constitute full security approval of all new application UI code, nor does it authorize production deployment.

---

## 2. Live Baseline vs Main Verification

- **Live Production Baseline:** Ruleset `cf5176f9` corresponds exactly to `git show 01bb12c:firestore.rules`:
  - Byte length: `92,222` bytes
  - SHA-256: `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` (`AE39`)
- **Stale Main Baseline (`6045b50`):**
  - Byte length: `93,662` bytes
  - SHA-256: `eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2` (`EEE0`)
- **Verification:** Independent SHA-256 hashing executed via Node crypto confirms exact byte and hash parity. The overlay targets the true deployed production ruleset rather than stale main.

---

## 3. Harness Analysis (`scripts/verify-r72-live-rules.mjs`)

| Requirement | Implementation Finding | Status |
|---|---|---|
| **Emulator / Demo Isolation** | Command executes `firebase emulators:exec --only firestore --project demo-r72-rules ...`. Forces offline demo mode; prevents any remote deployment or live database mutation. | **PASS** |
| **No Secret / Env Leakage** | Child process inherits `stdio: 'inherit'`, logs only hashes, lengths, command strings, and test results. No printing of `process.env`, tokens, or credentials. | **PASS** |
| **Actual Overlay Consumption** | `tests/transfers-rules.test.ts:35` and `tests/transit-workflow.emulator.test.ts:38` both read `readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')`, and `firebase.json:17` points to `firestore.rules`. Overwriting `firestore.rules` on disk guarantees both the emulator engine and `@firebase/rules-unit-testing` execute the overlaid rules bytes. | **PASS** |
| **Exact Hash Assertions** | Pre-overlay checks assert `liveHash === EXPECTED_LIVE_HASH` (line 22); post-write checks assert `currentDiskHash === EXPECTED_LIVE_HASH` (line 34); post-restore checks assert `restoredHash === originalHash` (line 53); and `git diff --exit-code -- firestore.rules` (line 60) confirms zero diff. | **PASS** |
| **Error Propagation & Try/Finally** | No `process.exit()` inside `try`. Child status code (`res.status`) and error (`res.error`) are held in outer let-bindings. Restoration runs unconditionally in `finally`, followed by exit code propagation (`lines 68-75`). | **PASS** |
| **OS Limitation on "Unconditional Finally"** | Node.js `finally` guarantees restoration on script errors or normal exit. However, `finally` **cannot** run on OS `SIGKILL` (`kill -9`) or catastrophic power failure. In those edge cases, the working tree would remain at the live overlay until manually restored with `git checkout -- firestore.rules`. Documented as an OS reality, not an infallible guarantee. | **DOCUMENTED** |

---

## 4. Test Evidence & Scope Discrepancy

- **Verified Suites (21 / 21 PASS, ~23.38s duration):**
  - `tests/transfers-rules.test.ts` (12 tests): Staff draft isolation, manager authorization requirements, destination-branch receive enforcement, immutable movement ledger records.
  - `tests/transit-workflow.emulator.test.ts` (9 tests): Cross-brand isolation, ledger balance retention across partial receipts, post-dispatch route immutability, discrepancy reporting.
  - Prior 99 unit tests were retained without redundant replay.
- **Explicit Untested Scenarios:**
  - **New UI Brand Races:** Client-side state transitions during rapid brand-switcher switching while mutations are in-flight remain **NOT TESTED** by headless Firestore rules.
  - **High-Concurrency Multi-Client Writes:** Simultaneous double-receive attempts or lock contention across multiple browser clients remain **NOT TESTED** in single-worker emulator runs.

---

## 5. Working Tree & Source Integrity

- Root application source files (`src/**`), production configurations, and `firestore.rules` have zero unstaged modifications.
- `git diff 6045b50..24935c7` introduces only documentation and test harness tooling.
- Operational check: Approved.
