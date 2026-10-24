# R67 Wave B — Cross-Model Security Review of PR #59 (Staging Tier)

- **Commit under review**: `0cdda9ae418c791e090d790a8a3512f8506c5438`
- **Parent commit**: `6045b502171b1639d1e55c0f09e9a910e14ad064` (`origin/main`)
- **Reviewer**: `9router/gemini-3.8-flash-high` (Antigravity harness)
- **Independence Statement**: Independent cross-model security reviewer. Did not author or assist in authoring commit `0cdda9a` (authored by MAIN/Claude).
- **Scope**: Security review of dedicated OCR staging tier isolation, separate Cloudflare Pages project (`pzmstock-staging`), separate Firebase project, token verification boundaries, and deploy scripts.

---

## 1. Files Read

- `src/lib/deployTier.ts`
- `src/firebase/config.ts`
- `src/vite-env.d.ts`
- `vite.config.ts`
- `functions/_poImage.ts`
- `functions/_lib/supplierEnv.ts`
- `functions/_lib/previewGuard.ts`
- `functions/api/ocr-bill.ts`
- `functions/api/po-image.ts`
- `functions/api/supplier-po/link.ts`
- `functions/api/supplier-po/decide.ts`
- `functions/api/supplier-po/revoke.ts`
- `functions/api/supplier/[token].ts`
- `deploy/staging/wrangler.toml`
- `wrangler.toml`
- `scripts/deploy-staging.mjs`
- `scripts/staging-functions-check.sh`
- `scripts/staging-local-check.mjs`
- `tests/staging-tier.test.ts`
- `tests/preview-isolation.test.ts`
- `.gitignore`

---

## 2. Attacks and Outcomes

### Attack 1: Breaking Tier Boundary & Client Config Isolation
**Goal**: Test if any production/preview build can become staging, or if a staging build can reach production Firebase `pzm-stock-x5` via `BUILT_IN`, `localStorage`, or crafted `VITE_STAGING_FIREBASE_CONFIG`.

1. **Pages Git Builds Becoming Staging**:
   - `buildTier` in `src/lib/deployTier.ts:38-42`:
     ```ts
     if ((env.DEPLOY_TIER ?? '').trim() === 'staging') {
       if (env.CF_PAGES) throw new Error('A staging build is a direct upload (scripts/deploy-staging.mjs), never a Cloudflare Pages git build')
     ```
   - If `CF_PAGES` is set (present on all Cloudflare Pages git builds), setting `DEPLOY_TIER="staging"` throws an error immediately. A git build on `main` remains `'production'`; preview branches remain `'preview'`.
   - **Outcome**: Protected. Pages CI git builds cannot build as staging.

2. **Reaching `pzm-stock-x5` via `BUILT_IN` or `localStorage` on Staging**:
   - In `src/firebase/config.ts:82-86`:
     ```ts
     if (import.meta.env.VITE_DEPLOY_TIER === 'staging') {
       const raw = import.meta.env.VITE_STAGING_FIREBASE_CONFIG
       if (typeof location === 'undefined' || hostTier(location.hostname) === 'production' || !stagingWebProject(raw)) return null
       return JSON.parse(raw as string) as FirebaseConfig
     }
     ```
   - When `VITE_DEPLOY_TIER === 'staging'`, the function returns before reaching `localStorage.getItem(LS_KEY)` (line 92) and `BUILT_IN` (line 100). If the config is invalid or on the production host, it returns `null` (fails closed).
   - **Outcome**: Protected. Neither `BUILT_IN` nor `localStorage` is accessible in a staging build.

3. **Crafted `VITE_STAGING_FIREBASE_CONFIG` Attacks against `stagingWebProject(json)`**:
   - Implementation in `src/lib/deployTier.ts:140-151`:
     ```ts
     export function stagingWebProject(json: string | undefined): string | null {
       if (!json || json.includes(PRODUCTION_PROJECT) || json.includes(PRODUCTION_PROJECT_NUMBER)) return null
       let c: Record<string, unknown>
       try {
         c = JSON.parse(json)
       } catch {
         return null
       }
       if (!c || typeof c !== 'object') return null
       const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string).trim() : '')
       if (!str('apiKey') || !str('authDomain') || !str('appId') || !str('projectId')) return null
       return str('projectId')
     }
     ```
   - **Attack 1A (Unicode Escape Bypass — BREAKS BOUNDARY)**:
     - **Input**:
       ```json
       {"apiKey":"k","authDomain":"pzm-stock-x\u0035.firebaseapp.com","projectId":"pzm-stock-x\u0035","storageBucket":"pzm-stock-x\u0035.firebasestorage.app","appId":"1:789\u003071579161:web:58df8f34e911cd7218c288"}
       ```
       (where `\u0035` is `'5'` and `\u0030` is `'0'`).
     - **Execution**: The raw unparsed JSON string does not contain the literal substring `"pzm-stock-x5"` nor `"789071579161"`. Therefore, `json.includes(PRODUCTION_PROJECT)` and `json.includes(PRODUCTION_PROJECT_NUMBER)` both evaluate to `false`. Next, `JSON.parse` decodes `\u0035` into `'5'` and `\u0030` into `'0'`. `stagingWebProject` never checks the parsed fields against `PRODUCTION_PROJECT` or `PRODUCTION_PROJECT_NUMBER`!
     - **Wrong Result**: `stagingWebProject(json)` returns `"pzm-stock-x5"` (`src/lib/deployTier.ts:150`).
     - **Consequence**: `buildTier({ DEPLOY_TIER: 'staging', VITE_STAGING_FIREBASE_CONFIG: unicodeJson })` returns `'staging'`. In `src/firebase/config.ts:84-85`, on staging host `pzmstock-staging.pages.dev` (`hostTier` is `'preview'`), `!stagingWebProject(raw)` is `false`, and `getFirebaseConfig()` returns the production Firebase configuration with `projectId: "pzm-stock-x5"`, connecting the staging web bundle directly to the live production database.
     - **Outcome**: **FAILED (Vulnerability Confirmed)**.
   - **Attack 1B (Case Variation Bypass)**:
     - **Input**: `{"apiKey":"k","authDomain":"PZM-STOCK-X5.firebaseapp.com","projectId":"PZM-STOCK-X5","appId":"1:123456789012:web:x"}`
     - **Execution**: `json.includes("pzm-stock-x5")` is case-sensitive, returning `false`.
     - **Wrong Result**: `stagingWebProject` returns `"PZM-STOCK-X5"`.
     - **Outcome**: **FAILED (Boundary Leaked)**.
   - **Attack 1C (Whitespace & Extra Keys)**:
     - Whitespace around project name (e.g. `" pzm-stock-x5 "`) or extra keys containing `"pzm-stock-x5"` are caught by `json.includes(PRODUCTION_PROJECT)` if unescaped.
     - **Outcome**: Protected for unescaped ASCII strings.

---

### Attack 2: Functions Authentication & Token Verification Boundary
**Goal**: Verify `firebaseProjectFor()`, `callerUid()`, and `supplierEnv.liveDeps`.

1. **Production Host Verification**:
   - In `src/lib/deployTier.ts:158-162`:
     ```ts
     export function firebaseProjectFor(url: string, env: FunctionEnv): string | null {
       const tier = functionTier(new URL(url).hostname, env)
       if (tier === 'production') return PRODUCTION_PROJECT
       return tier === 'staging' ? (env.FIREBASE_PROJECT_ID ?? '').trim() : null
     }
     ```
   - On the production host (`pzmstock.pages.dev`), `functionTier` resolves to `'production'`.
   - `firebaseProjectFor` returns `PRODUCTION_PROJECT` (`'pzm-stock-x5'`), regardless of what `env.FIREBASE_PROJECT_ID` is set to.
   - In `functions/_lib/supplierEnv.ts:50-52`, `liveDeps` previously used `(env.FIREBASE_PROJECT_ID ?? '').trim() || PROJECT_ID`. It now uses `firebaseProjectFor(request.url, env)`. A misconfigured or malicious `FIREBASE_PROJECT_ID` variable on the production deployment cannot divert Firestore operations to a non-production project.
   - **Outcome**: Pass. Production host always binds to `pzm-stock-x5`.

2. **Staging Rejecting Production Tokens**:
   - On staging (`pzmstock-staging.pages.dev`), `functionTier` is `'staging'` only if `stagingAllowed(env)` passes.
   - `stagingAllowed` asserts `env.FIREBASE_PROJECT_ID !== PRODUCTION_PROJECT` and `saProject !== PRODUCTION_PROJECT`.
   - `firebaseProjectFor` returns staging's `FIREBASE_PROJECT_ID` (e.g. `pzm-stock-staging`).
   - `verifyFirebaseToken` verifies the JWT with `jwtVerify(token, JWKS, { issuer: .../${projectId}, audience: projectId })`.
   - A production Firebase ID token (bearing `aud: "pzm-stock-x5"`) presented to a staging function is rejected with an audience mismatch.
   - **Outcome**: Pass. Staging cannot accept production tokens.

3. **Preview Rejecting Any Token**:
   - On preview hosts, `functionTier` is `'preview'`.
   - `firebaseProjectFor` returns `null`.
   - `callerUid` (`functions/_poImage.ts:74`) returns `null` immediately without verifying tokens.
   - `supplierEnv.liveDeps` (`functions/_lib/supplierEnv.ts:52`) receives `projectId: null` and returns `null` (routes return 503 `notConfigured`).
   - Furthermore, `previewGuard` in `functions/_lib/previewGuard.ts` intercepts `/api/*`, `/po/*`, and `/a/*` via `_middleware.ts` and returns HTTP 503 `PREVIEW_ISOLATED` before function handlers execute.
   - **Outcome**: Pass. Previews reject all tokens and privileged operations.

4. **Conversion of all `verifyFirebaseToken` callers**:
   - `functions/_poImage.ts:57`: signature changed to `verifyFirebaseToken(header: string | null, projectId: string): Promise<string | null>`. The previous default `projectId = PROJECT_ID` was removed, requiring explicit project specification.
   - `callerUid` in `functions/_poImage.ts:72-75` wraps `verifyFirebaseToken` with `firebaseProjectFor(request.url, env)`.
   - `functions/api/ocr-bill.ts:47` and `functions/api/po-image.ts:19` converted from `verifyFirebaseToken` to `callerUid(request, env)`.
   - `functions/_lib/supplierEnv.ts:58` supplies `verifyUser: (h) => verifyFirebaseToken(h, projectId)` with `projectId = firebaseProjectFor(request.url, env)`.
   - Grep across `functions/` confirms no unmigrated callers exist.
   - **Outcome**: Pass. All token verification paths converted.

---

### Attack 3: Deployment Config & Deploy Script Verification
**Goal**: Inspect `deploy/staging/wrangler.toml` and `scripts/deploy-staging.mjs`.

1. **Production KV / Project Upload Protection**:
   - In `scripts/deploy-staging.mjs:27-37`:
     - Asserts `name = "pzmstock-staging"`.
     - Asserts `deploy/staging/wrangler.toml` does not contain `PRODUCTION_PROJECT` (`pzm-stock-x5`) nor `PRODUCTION_HOSTS`.
     - Compares KV namespace IDs against `wrangler.toml` (production) and fails if any production KV ID is found.
     - Asserts KV namespace ID is a valid 32-hex ID (rejecting placeholder `STAGING_KV_NAMESPACE_ID`).
     - Asserts `FIREBASE_PROJECT_ID` matches the project extracted from `VITE_STAGING_FIREBASE_CONFIG`.
     - Asserts `DEPLOY_TIER = "staging"`.
   - Direct upload runs with `--project-name pzmstock-staging`.
   - **Outcome**: Pass. No path allows staging scripts to upload to the production Pages project or bind production KV.

2. **Bundle Verification in `deploy-staging.mjs`**:
   - Lines 44-48:
     ```js
     const js = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n')
     if (!js.includes(project)) fail('the built bundle does not carry the staging project')
     if (!/VITE_DEPLOY_TIER["']?\s*:\s*["']staging["']|["']staging["']/.test(js)) fail('the built bundle is not a staging build')
     ```
   - `js.includes(project)` is meaningful: it confirms the staging project ID is baked into the bundle.
   - Note on regex: `/VITE_DEPLOY_TIER["']?\s*:\s*["']staging["']|["']staging["']/` contains `|["']staging["']`, which loosely matches any occurrence of the quoted word `staging`. (See Should finding).
   - **Outcome**: Pass with note.

3. **Secret Leakage Check**:
   - `scripts/deploy-staging.mjs` logs only project name, commit SHA, and staging Pages project name. It does not echo `VITE_STAGING_FIREBASE_CONFIG`.
   - No secret files written to disk; `.staging-deploy/` is added to `.gitignore`.
   - Staging secrets (`FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`) are managed exclusively in Cloudflare Pages project secrets.
   - **Outcome**: Pass. No secrets logged or written.

---

### Attack 4: Production Behavior Verification
**Goal**: Ensure production behavior remains strictly unchanged.

1. `tests/preview-isolation.test.ts` was examined via `git diff 6045b50 0cdda9a -- tests/preview-isolation.test.ts` and is 100% untouched.
2. `wrangler.toml` (production) is 100% untouched.
3. `vite.config.ts` is 100% untouched.
4. Normal build path (`npm run build`) uses `buildTier(process.env)` where production branch `main` with `CF_PAGES=1` resolves to `'production'`.
- **Outcome**: Pass. Production behavior is fully preserved.

---

## 3. Commands and Counts

Executed in worktree `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-24e033bb` at detached HEAD `0cdda9a`:

1. **Vitest Verification**:
   ```bash
   npx vitest run tests/staging-tier.test.ts tests/preview-isolation.test.ts tests/functions/
   ```
   - `tests/staging-tier.test.ts`: 15 passed
   - `tests/preview-isolation.test.ts`: 72 passed
   - `tests/functions/supplier-po.test.ts`: 26 passed
   - `tests/functions/supplier-link-lifecycle.test.ts`: 11 passed
   - **Result**: 4 test files passed, 124 tests passed, 0 failed.

2. **TypeScript App Check**:
   ```bash
   npx tsc -p tsconfig.app.json --noEmit
   ```
   - **Result**: 0 errors.

3. **TypeScript Functions Check**:
   ```bash
   npx tsc -p functions/tsconfig.json --noEmit
   ```
   - **Result**: 0 errors.

---

## 4. Findings

### Must Findings

1. **Unicode Escape Perimeter Bypass in `stagingWebProject(json)`**
   - **Location**: `src/lib/deployTier.ts:140-151`, affecting `src/firebase/config.ts:84-86`.
   - **Concrete Case**:
     ```json
     {"apiKey":"k","authDomain":"pzm-stock-x\u0035.firebaseapp.com","projectId":"pzm-stock-x\u0035","storageBucket":"pzm-stock-x\u0035.firebasestorage.app","appId":"1:789\u003071579161:web:x"}
     ```
   - **Mechanism**: `stagingWebProject` performs blacklist string matching (`json.includes(PRODUCTION_PROJECT) || json.includes(PRODUCTION_PROJECT_NUMBER)`) directly on the unparsed JSON string. A JSON payload with standard Unicode escapes (e.g. `\u0035` for `'5'` or `\u0030` for `'0'`) bypasses the raw substring check. After `JSON.parse`, the decoded object contains `projectId: "pzm-stock-x5"`, but the function never inspects the parsed fields against production constants and returns `"pzm-stock-x5"`. Consequently, `src/firebase/config.ts:85` serves the live production Firebase configuration on the staging host.
   - **Remediation**:
     Validate post-parse fields on the decoded object and check re-serialized or normalized values case-insensitively:
     ```ts
     export function stagingWebProject(json: string | undefined): string | null {
       if (!json) return null
       let c: Record<string, unknown>
       try {
         c = JSON.parse(json)
       } catch {
         return null
       }
       if (!c || typeof c !== 'object') return null
       const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string).trim() : '')
       const projectId = str('projectId')
       const authDomain = str('authDomain')
       const appId = str('appId')
       if (!str('apiKey') || !authDomain || !appId || !projectId) return null

       const serialized = JSON.stringify(c).toLowerCase()
       if (serialized.includes(PRODUCTION_PROJECT.toLowerCase()) || serialized.includes(PRODUCTION_PROJECT_NUMBER)) return null
       if (projectId.toLowerCase() === PRODUCTION_PROJECT.toLowerCase()) return null
       return projectId
     }
     ```

### Should Findings

1. **Case-Insensitive Validation in `stagingWebProject` & `stagingAllowed`**
   - **Location**: `src/lib/deployTier.ts:119, 140`.
   - **Case**: An input like `{"projectId": "PZM-STOCK-X5", ...}` bypasses case-sensitive checks against `'pzm-stock-x5'`. Project ID comparisons should normalize with `.toLowerCase()`.

2. **Tighten Staging Bundle Assertion Regex in `deploy-staging.mjs`**
   - **Location**: `scripts/deploy-staging.mjs:48`.
   - **Case**: The regex `/VITE_DEPLOY_TIER["']?\s*:\s*["']staging["']|["']staging["']/` contains `|["']staging["']`, which would match any arbitrary quoted string literal `'staging'` in vendor or app code. The alternative should be removed to ensure it specifically checks the injected tier definition.

---

## 5. Verdict

**CHANGES_REQUESTED**

The PR achieves excellent isolation across Functions, deploy scripts, and Cloudflare Pages project boundaries. However, because `stagingWebProject` in `src/lib/deployTier.ts` relies on raw JSON substring searching before parsing, crafted Unicode-escaped inputs bypass the check and allow a staging build to resolve and connect to the production Firebase project (`pzm-stock-x5`). This must be fixed to ensure the boundary fails closed against all JSON-encoded variations.

---

- **Provider/model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-24e033bb`
- **Report commit SHA**: 73b1188 (amended)
