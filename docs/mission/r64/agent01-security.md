# R64 Agent01 Security & Firestore Review: Transit Location Rules

**Reviewer:** AGENT01 (Security & Firestore Sub-Agent, Gemini 3.8 Flash High)  
**Date:** 2026-10-24  
**Worktree Branch:** `t3/1322da1e`  
**Candidate Commit:** `01bb12cdf56334406d256bbf5462f9a5aeae26f0` (PR #54 HEAD)  
**Baseline Main:** `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`  
**Verdict:** **APPROVE** (zero security regressions, full schema & role integrity verified)

---

## 1. Candidate Files & Exact Cryptographic Hashes

### Candidate Files under Review (Commit `01bb12c`)

| File Path | Git Object SHA-1 | Normalized LF SHA-256 | Raw Worktree Bytes SHA-256 |
|---|---|---|---|
| `firestore.rules` | `03f530400057fea75fcbb2475e2237d81eb372f1` | `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270` | `dc86b4158477e6fca29f48c0452642a0da542bac2cabfbe7beac795a1a9d1677` |
| `src/pages/settings/LogisticsSection.tsx` | `7ca28ab0866cc283540553f5e52fe69b5405322d` | `4392fb2aac14b009617a867145d7a0d8a0da8115c4ac974301066b501de758b5` | `e4fa445fffd8a6b020e045faa983bd578a35657be7e33d851079e8095d4188c5` |
| `src/i18n/en.ts` | `6c8238c2c8656c98c0e0c1acce32c195900d795a` | `af9f52bd6c555afe8039e5b433f64adba3eb00a436110222ab988f99816529de` | `089afa0945e56ec83cb6097c51cf744edd7963be1f962877429c2113bdc26412` |
| `tests/transit-location-rules.test.ts` | `69eae9aa66f82b5f51b83a1533ccf9fa7c09647b` | `c08aa9fd2340f025ba4fde30c3997c2ed7b95053659264f3a2f3fb825c1205dd` | `ff704bffe378173e681ff7740931cf4c0d05aa427eeede85be09483ec07bf112` |
| `tests/logistics-status.test.ts` | `25b3605008631035c300ee8bf0e0ce4fbebc9e06` | `2be8e7882e155bf2fcea1d587edf8e9a9cf71d3c98c37a73df6ad4c08e7940e9` | `2201d8af6c55a565a0670acb336ec368d827bf67a3609541af87455047c9ee2f` |

### Live Production Rules vs Candidate vs Baseline

Fetched Live Production Rules Artifact (`C:/Users/Yutthachai/PZM-LLP-Stock-2026/docs/mission/r64/live-rules/`):
- **Live Ruleset ID:** `projects/pzm-stock-x5/rulesets/80b1cd17-4388-4d49-8b91-31b58ed459a7`
- **Release:** `projects/pzm-stock-x5/releases/cloud.firestore`
- **Release updateTime:** `2026-10-08T07:00:45.266800Z`
- **Backup File:** `0-firestore.rules` (93,662 bytes)
- **Live Raw File SHA-256:** `eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2`
- **Live Normalized LF SHA-256:** `bdc5bfad4b76b60d73f9a7a46fbb4150350cbf6063a3b926b3adb6280113dba8`
- **Baseline `312f8a7:firestore.rules` LF SHA-256:** `bdc5bfad4b76b60d73f9a7a46fbb4150350cbf6063a3b926b3adb6280113dba8`
- **Diff between Live Rules and Baseline `312f8a7`:** **STRICT EQUALITY (`===`) confirmed.** Zero out-of-band Console changes exist in production.

---

## 2. Security Gate, Schema, & Threat Model Analysis

### Diff under Review in `firestore.rules`
```diff
@@ -319,12 +319,14 @@ service cloud.firestore {
         && epochMs(d.createdAt) && epochMs(d.updatedAt);
     }
 
+    // `transit` is the in-transit location (Settings → ระบบส่งสินค้า); its canonical id holds
+    // nothing else. A transit location under another id comes from an imported backup.
     function validLocation(d) {
       return d.keys().hasAll(['id', 'name', 'type', 'active', 'createdAt'])
         && d.keys().hasOnly(['id', 'name', 'nameEn', 'type', 'active', 'createdAt'])
         && text(d.name, 200)
         && (!('nameEn' in d) || text(d.nameEn, 200))
-        && d.type in ['warehouse', 'branch']
+        && (d.type == 'transit' || (d.type in ['warehouse', 'branch'] && d.id != 'transit'))
         && d.active is bool
         && epochMs(d.createdAt);
     }
```

### 1. Allow Gates & Role Enforcement
- **Read:** `allow read: if active() && brandData(collection);`
  - Active users across all 3 brands (`locations`, `lelapin__locations`, `rnd__locations`) may read.
  - Deactivated users (`active == false`) and unauthenticated requests are blocked.
- **Write (Create / Update / Delete):**
  - Controlled by `writer(collection)`.
  - For `locations`, `lelapin__locations`, `rnd__locations`, these are listed exclusively in `adminWritable(name)` (lines 103, 105, 108), **not** in `staffWritable(name)`.
  - Therefore, writing requires `admin()`: `active() && roleIsAdmin()`.
  - Managers (`role: 'manager'`), staff (`role: 'staff'`), deactivated admins (`active: false`), and anonymous callers are strictly blocked (`assertFails`).

### 2. Schema Boundary Validation (`validLocation`)
- **Required keys:** `['id', 'name', 'type', 'active', 'createdAt']`
- **Permitted keys:** `['id', 'name', 'nameEn', 'type', 'active', 'createdAt']`
- **Strict key constraint:** `keys().hasOnly(...)` rejects unexpected fields (e.g. `capacity`, `status`, extra metadata).
- **String bounds:** `text(name, 200)` and `text(nameEn, 200)` enforce non-empty string <= 200 characters.
- **Timestamp validation:** `epochMs(d.createdAt)` ensures valid numeric milliseconds.
- **ID binding:** `d.id == docId` enforced by `validShape(name, docId, d, fresh)` (line 907).

### 3. Canonical vs Imported Location Types
- **Canonical ID (`id == 'transit'`):**
  - Condition: `(d.type == 'transit' || (d.type in ['warehouse', 'branch'] && d.id != 'transit'))`
  - When `d.id == 'transit'`, the right operand is `false` because `d.id != 'transit'` fails.
  - Hence, for document ID `transit`, `d.type` **must** be `'transit'`. An admin cannot mistakenly or maliciously create or update `locations/transit` with `type: 'warehouse'` or `'branch'`.
- **Imported Transit Locations (`id != 'transit'`):**
  - If a restored backup or legacy migration contains a transit location under a distinct ID (e.g. `transit-backup-2026`), `d.type == 'transit'` evaluates to `true`.
  - Admin write access is preserved for imported transit locations without weakening canonical invariants.

### 4. Wrong-Type Handling & In-Place Repair
- If an existing database document at `locations/transit` has `type: 'warehouse'` (due to legacy seed or test fixture), an update attempting to keep the wrong type (or modifying other fields like `name`) fails because `validShape` re-evaluates `validLocation(request.resource.data)`.
- It can only be updated if `type: 'transit'` is supplied, repairing the document.

### 5. Multi-Brand Isolation
- Evaluated against all 3 company collections:
  - Pizza Mania: `locations/transit`
  - Le Lapin: `lelapin__locations/transit`
  - R&D: `rnd__locations/transit`
- `kind(name)` resolves `lelapin__locations` -> `locations` and `rnd__locations` -> `locations`. All 3 collections inherit identical access control and validation rules.

### 6. Idempotency
- `ensureTransitLocation()` writes the canonical payload via Firestore `set`.
- Re-running the operation writes the exact same document structure without mutating state, satisfying idempotency requirements.

---

## 3. Comparison with PR #51 (`634edd7`) and PR #1 / Transition Rules

- **PR #51 (`634edd7`, `fix/20261022-void-reason`):**
  - Carries the exact same 4-line `validLocation` fix from `feb3c9c`.
  - In addition, PR #51 carries the stock movement void reason rules (`voidedHonestly`, `cancelOnly`, `balanceMovedBack`, `voidedByName` 200-char cap, 10-minute clock drift limit).
  - PR #51 runs 305 rules tests (291 void reason suite + 14 transit location suite).
- **Candidate PR #54 (`01bb12c`, `hotfix/20261024-transit-location-rules`):**
  - Cleanly branched off `main` baseline `312f8a7`.
  - Contains **only** the transit location fix, keeping blast radius minimal.
  - Does not introduce the void reason changes, allowing independent hotfix release.
  - The changes between PR #54 and PR #51 in `validLocation` are identical, guaranteeing clean forward merges without merge conflicts.

---

## 4. Emulator Test Execution on Port 8082 (Isolated Worktree)

To ensure zero interference with parent or other agents running on default ports (8080, 9099, 5206, 5207), all tests were executed on **port 8082** using temporary untracked configuration fixtures (`firebase-8082.local` and `.firebase/vitest.rules8082.config.ts` with `.firebase/setup-8082.ts`), leaving all tracked production files completely untouched (`git status` 100% clean).

### Test Configuration
- **Firestore Emulator Port:** `8082` (host `127.0.0.1`)
- **Project ID:** `pzm-rules-test`
- **Command:** `firebase -c firebase-8082.local emulators:exec --only firestore --project pzm-rules-test "npx vitest run --config .firebase/vitest.rules8082.config.ts"`

### Test Results

1. **`tests/transit-location-rules.test.ts`:**
   - 14/14 passed (100%)
   - Covers: admin switch on, idempotency (repeat write), manager/staff/deactivated-admin/unauthenticated denials across all 3 brand collections, canonical ID type locking, wrong-type repair, imported transit locations, shape/field validation, warehouse/branch compatibility.

2. **Full Firestore Rules Suite (8 files + `transit-workflow.emulator.test.ts`):**
   - **`tests/announcements-rules.test.ts`:** 13 passed
   - **`tests/audit-rules-data.test.ts`:** 26 passed
   - **`tests/audit-rules.test.ts`:** 14 passed
   - **`tests/firestore-rules-budget.test.ts`:** 7 passed
   - **`tests/firestore-rules.test.ts`:** 134 passed
   - **`tests/monthly-counts-rules.test.ts`:** 11 passed
   - **`tests/transfers-rules.test.ts`:** 12 passed
   - **`tests/transit-location-rules.test.ts`:** 14 passed
   - **`tests/transit-workflow.emulator.test.ts`:** 9 passed
   - **Total:** **9/9 test files passed, 240/240 tests passed** in 50.21s.

3. **Settings UI Unit Tests (`tests/logistics-status.test.ts`):**
   - **5/5 passed** (`on`, `off`, `wrongType`, `denied`, `unknown`).

*(Note on `supplier-po.emulator.test.ts`: This Cloudflare Pages Function REST batch test hits transaction lock contention code 10 on emulator v1.22.0 concurrent phone confirmations; it is not part of Firestore security rules).*

---

## 5. Review of Prior Review P3 Notes

The three P3 items noted in prior reviews were verified:
1. **`awaitcheck` (`LogisticsSection.tsx` lines 48-50, 56-59):**
   - In `useEffect`, `void check(b.id)` triggers non-blocking initial status resolution. In `enable()`, `await check(brand)` properly awaits the fresh status before evaluating `'on'`. No security impact; UI state handling is resilient.
2. **`exporthelper` (`LogisticsSection.tsx` line 20):**
   - `export async function statusOf(brand: BrandId): Promise<Status>` is exported from the page component for unit testing in `tests/logistics-status.test.ts`. An architectural cleanliness observation, not a release blocker.
3. **`canonicalupdatetest` (`tests/transit-location-rules.test.ts` line 92):**
   - The test correctly proves that updating a canonical transit doc to a non-transit type is rejected, while updating to `type: 'transit'` succeeds.

---

## 6. Rules-Only Release & Rollback Checklist

Because the live rules in production (`80b1cd17-4388-4d49-8b91-31b58ed459a7`) strictly match baseline commit `312f8a7`, there are no out-of-band Console rules to preserve.

### Pre-Release Verification
- [ ] Confirm git branch HEAD is `01bb12cdf56334406d256bbf5462f9a5aeae26f0`
- [ ] Verify `firestore.rules` normalized LF SHA-256 is `ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`
- [ ] Run rules test suite against synthetic `pzm-rules-test`

### Release Steps
1. Deploy rules only:
   ```bash
   firebase deploy --only firestore:rules --project pzm-stock-x5
   ```
2. Confirm new ruleset is associated with release `projects/pzm-stock-x5/releases/cloud.firestore`.
3. In web application as Admin, navigate to **Settings → ระบบส่งสินค้า** and switch on logistics for Pizza Mania, Le Lapin, and R&D.
4. Verify all 3 company cards display badge "เปิดใช้แล้ว" (On).

### Rollback Steps
If any unexpected issue arises:
1. Re-deploy the baseline rules from commit `312f8a7`:
   ```bash
   git checkout 312f8a7 -- firestore.rules
   firebase deploy --only firestore:rules --project pzm-stock-x5
   ```
   *(Alternatively, use the Firebase CLI / REST API to update release `projects/pzm-stock-x5/releases/cloud.firestore` back to ruleset `projects/pzm-stock-x5/rulesets/80b1cd17-4388-4d49-8b91-31b58ed459a7`).*
2. Verify rollback ruleset LF SHA-256 matches `bdc5bfad4b76b60d73f9a7a46fbb4150350cbf6063a3b926b3adb6280113dba8`.

---

## 7. Conclusion & Sign-Off

**Status:** **APPROVED FOR RELEASE**  
The candidate fix in commit `01bb12c` (`feb3c9c`) solves the in-transit location creation failure cleanly, enforces strict typing on the canonical `transit` ID, preserves admin-only write gates, supports imported locations, covers all 3 brands, and introduces zero security regressions.
