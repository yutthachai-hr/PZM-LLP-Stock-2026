> MAIN copy: the production web API key quoted by the reviewer is redacted here.

# R67 PR #59 — Round 4 Review (Delta Review)

- **Commit under review**: `891da595ac177effc2a1f5c9f318230568bd8707`
- **Parent commit (round 3)**: `6b8707b52c57a675104e5ca1ae167033eb3b70dc` (approved in round 3 `0f18a4e`)
- **Reviewer**: `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Independence Statement**: Independent cross-model security reviewer. Did not author commit `891da59` (authored by MAIN/Claude).
- **Scope**: Delta review of `git diff 6b8707b 891da59` across 5 files (`.gitleaksignore`, `scripts/deploy-staging.mjs`, `src/firebase/config.ts`, `src/lib/deployTier.ts`, `tests/staging-tier.test.ts`).

---

## 1. Context & Cause of Change

In commit `6b8707b` (Round 3), `PRODUCTION_WEB_API_KEY_PREFIX = 'AIza…(public web key, see src/firebase/config.ts)'` was retained in `src/lib/deployTier.ts` as a 20-character prefix constant. CI `secrets` (gitleaks) flagged this prefix under rule `generic-api-key`.

Commit `891da59` eliminates all API key material from `src/lib/deployTier.ts`:
1. `stagingWebProject(json, forbiddenApiKeys = [])` accepts forbidden keys as a parameter.
2. `src/firebase/config.ts` passes `productionKeys = BUILT_IN ? [BUILT_IN.apiKey] : []` at browser runtime.
3. `scripts/deploy-staging.mjs` parses `apiKey` from `src/firebase/config.ts` via regex and passes it into `stagingWebProject(web, [productionKey])`.
4. `.gitleaksignore` adds an exact single fingerprint for line 27 of `6b8707b`.
5. Tests verify refusal of forbidden web API keys in any case/whitespace and confirm the browser rejects production keys.

---

## 2. Concrete Case Evaluations

### Case (1): Can a staging build in the browser still accept production's web apiKey by any path?
**Verdict: NO.**
- **`BUILT_IN` null**: `BUILT_IN` is statically declared in `src/firebase/config.ts:23-30`. It is non-null in all deployed builds. Even in a hypothetical scenario where `BUILT_IN` were null, `stagingWebProject` still strictly rejects production's `projectId` (`pzm-stock-x5`) and `projectNumber` (`789071579161`). With `BUILT_IN` populated, `productionKeys` contains `BUILT_IN.apiKey`.
- **Whitespace / case**: `stagingWebProject` normalizes all JSON values and forbidden keys with `.trim().toLowerCase()`:
  ```ts
  const values = Object.values(o).map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
  const forbidden = forbiddenApiKeys.map((k) => k.trim().toLowerCase()).filter(Boolean)
  if (values.some((v) => ... || forbidden.includes(v))) return null
  ```
  Any variation in case or whitespace is normalized before matching against `forbidden.includes(v)`. Furthermore, `JSON.parse` resolves Unicode escape sequences (e.g., `\u0041...`) before extraction.
- **Key in another field**: `Object.values(o)` scans all top-level properties of the configuration object, not just `apiKey`. If production's API key appears in any field (e.g., `authDomain`, `appId`, `storageBucket`, or extra fields), `forbidden.includes(v)` triggers and returns `null`.

### Case (2): `buildTier()` in `vite.config.ts` no longer receives the key — consequences of manual build
**Verdict: Sound with fail-safe browser runtime protection.**
- **Can a bundle be built?** Yes. If `npm run build` is executed directly with `DEPLOY_TIER=staging` and a config containing a staging `projectId` alongside production's `apiKey`, `buildTier(process.env)` calls `stagingWebProject(raw)` with default `forbiddenApiKeys = []`. Because `buildTier` does not receive the production key, the build does not throw and generates `dist/`.
- **Can it be deployed via pipeline?** No. `scripts/deploy-staging.mjs:27-28` reads `productionKey` from `src/firebase/config.ts` and calls `stagingWebProject(web, [productionKey])` before invoking `npm run build` or uploading. It immediately refuses and aborts deployment.
- **Consequence if served in browser:** If such a bundle is served (via manual upload or preview host), browser execution of `getFirebaseConfig()` in `src/firebase/config.ts:85-87` passes `productionKeys = [BUILT_IN.apiKey]` into `stagingWebProject(raw, productionKeys)`. Because the bundle carries production's key in `raw`, `stagingWebProject` returns `null`. `getFirebaseConfig()` returns `null`, forcing the app into unconfigured offline/local mode. It cannot establish a connection to Firebase Auth or Firestore.

### Case (3): `deploy-staging.mjs` regex resilience & failure behavior
**Verdict: Fails closed.**
- In `scripts/deploy-staging.mjs`:
  ```js
  const productionKey = readFileSync(join(ROOT, 'src/firebase/config.ts'), 'utf8').match(/apiKey:\s*'([^']+)'/)?.[1]
  if (!productionKey) fail('could not read the production web config from src/firebase/config.ts')
  ```
- If `src/firebase/config.ts` is reformatted (double quotes, backticks, multiline property, renamed field): `productionKey` evaluates to `undefined`, `!productionKey` evaluates to `true`, and `fail(...)` exits with code 1. Deployment refuses to proceed. It never deploys with an empty or unverified key list.

### Case (4): `.gitleaksignore` entry precision
**Verdict: Exact single-fingerprint.**
- Line added:
  ```
  6b8707b52c57a675104e5ca1ae167033eb3b70dc:src/lib/deployTier.ts:generic-api-key:27
  ```
- Specifies exact commit SHA `6b8707b52c57a675104e5ca1ae167033eb3b70dc`, path `src/lib/deployTier.ts`, rule `generic-api-key`, and line `27`.
- No wildcards, directory suppressions, or broad rule disables. It applies only to the immutable pushed commit `6b8707b`.

### Case (5): Red test verification on empty keys
**Verdict: Verified.**
- Mutated `src/firebase/config.ts:85` to `const productionKeys: string[] = []`.
- Executed `npx vitest run tests/staging-tier.test.ts -t "web API key"`.
  - Result: **FAILED (RED)**:
    ```
    FAIL tests/staging-tier.test.ts > the browser of a staging build opens only the staging project > never the production web API key, even with a staging project id
    AssertionError: expected { ... apiKey: "AIza…(public web key, see src/firebase/config.ts)", ... } to be null
    ```
- Restored `src/firebase/config.ts` to `const productionKeys = BUILT_IN ? [BUILT_IN.apiKey] : []`.
- Executed test again: **PASSED (GREEN)** (2 passed, 27 skipped).

---

## 3. Test & Verification Evidence

1. **Vitest Suites**:
   ```bash
   npx vitest run tests/staging-tier.test.ts tests/preview-isolation.test.ts
   ```
   - Result: 2 test files passed, 67 tests passed, 0 failed.

2. **TypeScript Typecheck**:
   ```bash
   npx tsc -p tsconfig.app.json --noEmit
   npx tsc -p functions/tsconfig.json --noEmit
   ```
   - Result: 0 errors across app and Cloudflare Pages functions.

3. **Functions Suites**:
   ```bash
   npx vitest run tests/functions/
   ```
   - Result: 2 test files passed, 66 tests passed, 0 failed.

4. **Key Locality Check**:
   ```bash
   git grep -nE "AIza[0-9A-Za-z_-]{35}" -- src tests functions scripts deploy
   ```
   - Result: Exactly 1 occurrence in repository: `src/firebase/config.ts:24`.

---

## 4. Verdict

**APPROVE**

Commit `891da59` completely removes API key material and prefix constants from `src/lib/deployTier.ts`, resolving the CI gitleaks failure on `6b8707b`. Runtime browser rejection remains fail-closed and verified via empirical red-green testing, deployment script checks fail closed, and the `.gitleaksignore` suppression is an exact single fingerprint.

---

- **Provider/model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-2b17aaf3`
- **Report commit SHA**: `f180bca` (amended)
