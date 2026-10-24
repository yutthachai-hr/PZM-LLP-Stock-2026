> MAIN copy: the production web API key quoted by the reviewer is redacted here; it is unchanged in src/firebase/config.ts.

# R67 PR #59 — Round 3 Review (Delta Review)

- **Commit under review**: `6b8707b52c57a675104e5ca1ae167033eb3b70dc`
- **Parent commit (round 2)**: `3d48ad17400e6f31a47a29bd4e433776a8ec1414` (approved in report `7e7c610`)
- **Reviewer**: `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Independence Statement**: Independent cross-model security reviewer. Did not author commit `6b8707b` (authored by MAIN/Claude).
- **Scope**: Delta review of `git diff 3d48ad1 6b8707b` across 3 files (`.gitleaksignore`, `src/lib/deployTier.ts`, `tests/staging-tier.test.ts`).

---

## 1. Background & Cause

CI `secrets` (gitleaks) failed on commit `3d48ad1` because the public Firebase web apiKey of production was duplicated into `src/lib/deployTier.ts` at line 25 (triggering rule `gcp-api-key`). Because `3d48ad1` was already pushed to the remote branch and history rewrite/force-push is forbidden, commit `6b8707b` resolves this by:
1. Adding an exact fingerprint entry to `.gitleaksignore` for commit `3d48ad1`.
2. Truncating the key in `src/lib/deployTier.ts` to a 20-character prefix (`PRODUCTION_WEB_API_KEY_PREFIX = 'AIzaSyB2cQL0G-OLibdo'`), keeping the full key exclusively in `src/firebase/config.ts`.
3. Updating tests to dynamically read the full key from `src/firebase/config.ts` to pin the prefix.

---

## 2. Check 1: `.gitleaksignore` Entry Precision

- **Diff inspected**:
  ```
  +3d48ad17400e6f31a47a29bd4e433776a8ec1414:src/lib/deployTier.ts:gcp-api-key:25
  ```
- **Structure**: Format is `commit:file:rule:line`.
  - Commit: `3d48ad17400e6f31a47a29bd4e433776a8ec1414` (exact 40-char SHA)
  - File: `src/lib/deployTier.ts`
  - Rule: `gcp-api-key`
  - Line: `25`
- **Scope analysis**: This is an exact single-finding fingerprint. It contains no wildcards, no path exclusions, and no broad rule exclusions. It suppresses only finding `gcp-api-key` at line 25 of commit `3d48ad1`. It cannot conceal leaks in other files, lines, rules, or subsequent commits.
- **Finding**: **SOUND & MINIMAL**.

---

## 3. Check 2: Full Web API Key Locality

- Command executed:
  ```bash
  git grep -nE "AIza[0-9A-Za-z_-]{35}" -- src tests functions scripts deploy
  ```
- **Output**:
  ```
  src/firebase/config.ts:24:  apiKey: 'AIza…(public web key, see src/firebase/config.ts)',
  ```
- **Analysis**: The full 39-character key exists in exactly one place in the repository (`src/firebase/config.ts:24`), which was already allow-listed by exact fingerprint on 17 Jul (`08e0dbd35a6ab589cc0aeb093ef159f95de7c516:src/firebase/config.ts:gcp-api-key:24`). No full key literals exist in `src/lib/deployTier.ts` or `tests/staging-tier.test.ts`.
- **Finding**: **VERIFIED**.

---

## 4. Check 3: Soundness of 20-Character Prefix Recognition

- Prefix defined: `PRODUCTION_WEB_API_KEY_PREFIX = 'AIzaSyB2cQL0G-OLibdo'` (20 characters).
- Matching logic: `values.some((v) => ... || v.startsWith(PRODUCTION_WEB_API_KEY_PREFIX.toLowerCase()))`.
- **False accepts**: Any configuration containing the production web API key (`AIza…(public web key, see src/firebase/config.ts)`) starts with `aizasyb2cql0g-olibdo` (case-insensitive). It evaluates `startsWith(...) === true` and returns `null`. Production key is guaranteed to be refused. False accepts = 0.
- **False refusals**: The prefix comprises `AIzaSy` followed by 14 random base64url characters. An independent Google Cloud / Firebase project generating an API key with the identical 14-character prefix has collision probability $64^{-14} \approx 2.2 \times 10^{-25}$. Accidental collision with a legitimate staging project key is negligible. False refusals = 0.
- **Finding**: **SOUND**.

---

## 5. Check 4: Round-2 Boundary Guarantees

- **JSON Escape perimeter**: Input JSON is parsed via `JSON.parse(json)` before extraction, resolving Unicode escapes (`\u0041...`) prior to validation.
- **Case normalization**: All object values are lowercased via `v.trim().toLowerCase()`, matched against `PRODUCTION_WEB_API_KEY_PREFIX.toLowerCase()`.
- **Field scanning**: `Object.values(o)` checks all top-level string values; the check is not restricted to `apiKey`, preventing smuggling via secondary fields.
- **Project formatting & identifier boundaries**: Substring rejection of `PRODUCTION_PROJECT` (`pzm-stock-x5`) and `PRODUCTION_PROJECT_NUMBER` (`789071579161`), plus strict regex `/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/` on `projectId`, remain intact.
- **Finding**: **PRESERVED**.

---

## 6. Verification Commands & Results

1. **Staging & Preview Isolation Tests**:
   ```bash
   npx vitest run tests/staging-tier.test.ts tests/preview-isolation.test.ts
   ```
   - `tests/staging-tier.test.ts`: 28 passed
   - `tests/preview-isolation.test.ts`: 38 passed
   - Total: 2 test files passed, 66 tests passed, 0 failed.

2. **Functions Tests**:
   ```bash
   npx vitest run tests/functions/
   ```
   - `tests/functions/supplier-po.test.ts`: 26 passed
   - `tests/functions/supplier-link-lifecycle.test.ts`: 11 passed
   - Total: 2 test files passed, 37 tests passed, 0 failed.

3. **TypeScript Build Verification**:
   ```bash
   npx tsc -p tsconfig.app.json --noEmit
   npx tsc -p functions/tsconfig.json --noEmit
   ```
   - Result: 0 errors across app and functions.

---

## 7. Verdict

**APPROVE**

Commit `6b8707b` cleanly resolves the CI secrets failure on `3d48ad1`. The `.gitleaksignore` rule is an exact single-fingerprint entry for the already-pushed commit, the 20-character prefix safely identifies production's web key without false accepts or false refusals, all Round 2 boundary protections remain intact, and all test suites pass.

---

- **Provider/model**: `9router/gemini-3.8-flash-high`
- **Report commit SHA**: `8beece7` (amended)
