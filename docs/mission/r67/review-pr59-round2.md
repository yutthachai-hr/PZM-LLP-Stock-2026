> MAIN copy: the production web API key quoted by the reviewer is redacted here; it is unchanged in src/firebase/config.ts.

# R67 Wave B — Cross-Model Security Re-Review of PR #59 (Round 2)

- **Commit under review**: `3d48ad17400e6f31a47a29bd4e433776a8ec1414`
- **Parent commit (round 1)**: `0cdda9ae418c791e090d790a8a3512f8506c5438`
- **Base commit**: `6045b502171b1639d1e55c0f09e9a910e14ad064` (`origin/main`)
- **Reviewer**: `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Independence Statement**: Independent cross-model security reviewer. Did not author or assist in authoring commit `0cdda9a` or `3d48ad1` (both authored by MAIN/Claude).
- **Scope**: Re-review of dedicated OCR staging tier isolation, verification of fixes for Round 1 findings, adversarial attack testing on parsed config boundaries, and verification of test claims.

---

## 1. Status of Round-1 Findings

### Must Finding: Unicode Escape Perimeter Bypass in `stagingWebProject(json)`
- **Round-1 Issue**: Substring matching (`json.includes`) on raw JSON before `JSON.parse` allowed standard JSON Unicode escapes (`x\u0035`, `\u0030`) to bypass detection and resolve to production (`pzm-stock-x5`).
- **Round-2 Response**: `stagingWebProject` now parses first via `JSON.parse(json)`, validates object structure, normalizes (trims and lowercases) all parsed string values, and checks that no value contains `PRODUCTION_PROJECT`, `PRODUCTION_PROJECT_NUMBER`, or equals `PRODUCTION_WEB_API_KEY.toLowerCase()`. In addition, `projectId` is strictly validated against Firebase project format `/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/`. Furthermore, configs carrying production's web API key are rejected to prevent sign-in from routing to production Auth.
- **Verification**: Verified RED-on-`0cdda9a` and GREEN-on-`3d48ad1`.
- **Status**: **RESOLVED**.

### Should Finding 1: Case-Insensitive Validation in `stagingAllowed`
- **Round-1 Issue**: Project ID comparisons in `stagingAllowed` were case-sensitive.
- **Round-2 Response**: `stagingAllowed` in `src/lib/deployTier.ts` compares `project.toLowerCase() === PRODUCTION_PROJECT` and `saProject.toLowerCase() === PRODUCTION_PROJECT`.
- **Verification**: `tests/staging-tier.test.ts` includes explicit test with `FIREBASE_PROJECT_ID: 'PZM-STOCK-X5'` and asserts refusal (resolves to `'preview'`).
- **Status**: **RESOLVED**.

### Should Finding 2: Bundle Assertion Regex in `scripts/deploy-staging.mjs`
- **Round-1 Issue**: The regex `/VITE_DEPLOY_TIER["']?\s*:\s*["']staging["']|["']staging["']/` matched arbitrary string literals.
- **Round-2 Response**: The regex was removed rather than tightened. In Vite production builds, `import.meta.env.VITE_DEPLOY_TIER === 'staging'` is inlined and folded by the minifier/dead-code eliminator, so `"VITE_DEPLOY_TIER"` literal does not appear in bundle chunks. `buildTier(env)` in `vite.config.ts` guarantees throwing before build completion if `DEPLOY_TIER === 'staging'` lacks valid staging web config. `scripts/deploy-staging.mjs` retains `js.includes(project)` to guarantee the staging project is baked into the bundle.
- **Assessment**: The reasoning holds. Bundle regex was unreliable due to AST minifier folding; compiler-level fail-closed assertion + project bundle presence check is sound.
- **Status**: **RESOLVED**.

---

## 2. Verification of RED-on-0cdda9a Claim

1. Checked out `src/lib/deployTier.ts` from `0cdda9a` in the working tree.
2. Ran `npx vitest run tests/staging-tier.test.ts -t "JSON escape"`:
   - `refused: production id written with a JSON escape`: **FAILED** (expected `null`, received `'pzm-stock-x5'`).
   - `refused: production number written with a JSON escape`: **FAILED** (expected `null`, received `'pzm-stock-staging'`).
   - Output: 2 failed, 26 skipped.
3. Restored `src/lib/deployTier.ts` to `3d48ad1`.
4. Re-ran `npx vitest run tests/staging-tier.test.ts -t "JSON escape"`:
   - Output: 2 passed, 26 skipped.
- **Result**: Claim verified independently.

---

## 3. Web API Key Verification

- `PRODUCTION_WEB_API_KEY` in `src/lib/deployTier.ts:25`: `'AIza…(public web key, see src/firebase/config.ts)'`
- `BUILT_IN.apiKey` in `src/firebase/config.ts:24`: `'AIza…(public web key, see src/firebase/config.ts)'`
- Values are identical.
- Pinned by regression test in `tests/staging-tier.test.ts:44-48` (`the production identifiers it refuses are the ones the app ships`).
- **Result**: Confirmed.

---

## 4. New Attacks on Parsed Values & Outcomes

Adversarial testing was conducted against `stagingWebProject` with new attack vectors:

1. **Nested Objects / Arrays as Values**:
   - Attack: `{ ...validStaging, extra: { target: 'pzm-stock-x5' } }` or `{ extra: ['789071579161'] }`.
   - Outcome: Ignored by Firebase SDK; client initializes with top-level `projectId: 'pzm-stock-staging'`.
   - Attack: `{ projectId: { id: 'pzm-stock-staging' } }` or `{ projectId: ['pzm-stock-staging'] }`.
   - Outcome: `str('projectId')` evaluates to empty string; regex check `/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/` fails; returns `null`. **PASS (Fails Closed)**.

2. **Non-String Values in Required Fields**:
   - Attack: Numeric, boolean, or null values for `projectId`, `apiKey`, `authDomain`, `appId`.
   - Outcome: `typeof o[k] === 'string'` check fails; `str(k)` returns `''`; all return `null`. **PASS**.

3. **Extra Keys Carrying Production**:
   - Attack: Top-level keys like `databaseURL: 'https://pzm-stock-x5-default-rtdb.firebaseio.com'`, `measurementId: 'G-pzm-stock-x5'`, `storageBucket: 'pzm-stock-x5.firebasestorage.app'`, or arbitrary key containing `789071579161` or `PRODUCTION_WEB_API_KEY`.
   - Outcome: `Object.values(o)` scans all top-level values; `values.some(...)` detects production identifiers; returns `null`. **PASS**.

4. **Unicode Look-Alikes (Homoglyphs / Confusables)**:
   - Attack: Cyrillic `\u0440` ('р'), Cyrillic `\u043e` ('о'), or fullwidth Latin `\uff50` in `projectId` (e.g. `\u0440zm-stock-x5`).
   - Outcome: JavaScript regex `/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/` strictly matches ASCII `[a-z]` (0x61–0x7A); test evaluates to `false`; returns `null`. **PASS**.

5. **Leading / Trailing Whitespace**:
   - Attack: `projectId: '   pzm-stock-x5   '`, `apiKey: '  ' + PRODUCTION_WEB_API_KEY + '  '`.
   - Outcome: Values are trimmed before substring comparison and API key equality check; returns `null`. **PASS**.

6. **Substring Variations of Production ID**:
   - Attack: `projectId: 'pzm-stock-x5-staging'`, `projectId: 'staging-pzm-stock-x5'`, `authDomain: 'sub.pzm-stock-x5.firebaseapp.com'`.
   - Outcome: `v.includes(PRODUCTION_PROJECT)` checks substring inclusion; returns `null`. **PASS (Fails Closed)**.

7. **Production Leakage via Functions**:
   - Verified `firebaseProjectFor(url, env)` and `callerUid(request, env)`. Staging host (`pzmstock-staging.pages.dev`) only permits non-production project specified by both `FIREBASE_PROJECT_ID` and matching `FIREBASE_SERVICE_ACCOUNT`. Production tokens with `aud: 'pzm-stock-x5'` are rejected by `jwtVerify`. **PASS**.

---

## 5. Verification Commands and Counts

1. **Vitest Test Suite**:
   ```bash
   npx vitest run tests/staging-tier.test.ts tests/preview-isolation.test.ts tests/functions/
   ```
   - `tests/staging-tier.test.ts`: 22 passed
   - `tests/preview-isolation.test.ts`: 72 passed
   - `tests/functions/supplier-po.test.ts`: 26 passed
   - `tests/functions/supplier-link-lifecycle.test.ts`: 11 passed
   - **Result**: 4 test files passed, 132 tests passed, 0 failed.

2. **TypeScript App Compilation**:
   ```bash
   npx tsc -p tsconfig.app.json --noEmit
   ```
   - **Result**: 0 errors.

3. **TypeScript Functions Compilation**:
   ```bash
   npx tsc -p functions/tsconfig.json --noEmit
   ```
   - **Result**: 0 errors.

---

## 6. Verdict

**APPROVE**

All Round 1 issues have been resolved correctly. Substring checks against parsed values, strict lowercase ASCII regex on `projectId`, rejection of production's web API key, and case-insensitive matching in `stagingAllowed` close the perimeter. No path allows a staging build or function to reach production Firebase project `pzm-stock-x5`.

---

- **Provider/model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-eb682c36`
- **Report commit SHA**: `d521871` (amended)
