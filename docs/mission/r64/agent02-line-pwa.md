# R64 AGENT02: LINE & PWA RELIABILITY REVIEW & RELEASE READINESS

## 1. Executive Summary & Release Gates

- **Status:** `REVIEW_PENDING` (Independent review by Gemini model family; prior review by DeepSeek).
- **Owner Approval:** `NO RELEASE APPROVAL` — deployment to Production remains strictly blocked pending explicit owner review and physical device QA sign-off.
- **Rollback Target:** Cloudflare Pages deployment `cbbec765` (pre-incident stable deployment).
- **Rollback Policy:** Strictly via Cloudflare Pages deployment rollback or `git revert`. `NO HARD RESET`.
- **Preexisting Bug A2 Isolation:** Bug A2 (`t3-abb9af93`, branch `t3/defer-supplier-request-until-send`) owned by Agent07 is kept strictly read-only and unmerged.

---

## 2. Commit & Ref Ledger

| Ref / Target | SHA | Description |
|---|---|---|
| **Base Main** | `312f8a7` | Merge PR #49 (`feat/20261022-in-transit-buckets`), production baseline |
| **Hotfix Commit** | `df34558f9dfe317fb18986e5b21a35b74e575173` | `test(pwa): assert worker served recovered page load; static server path check` |
| **Hotfix Base Fix**| `dc0e6ee11e39e85db2b8188185440440c6952a78` | `fix(pwa): cache app shell as / so lost cache never turns page into ERR_FAILED` |
| **PR 52 Head** | `d785ae858cb1db41907d30d36837b28fc7bfb02a` | `fix(orders): batch never finishes over unread order; LINE Login in tap's tick` |
| **Review Hotfix Merge** | `e59d3c604b901ba32c96939e6a0a0ae6332ec134` | Merge `origin/hotfix/20261024-sw-navigation-err-failed` into review worktree |
| **Review Compatibility Merge** | `f6706c7e3f84869da979743c4a63fae999c03780` | Merge PR 52 (`d785ae8`) with hotfix into `t3/review-line-pwa-reliability` |
| **Rollback Target Deployment** | `cbbec765` | Cloudflare Pages deployment for immediate rollback if needed |
| **Verified Preview** | `9789240e` | Cloudflare preview returning 200 for `createHandlerBoundToURL('/')` |

---

## 3. Technical Review: 8-Line Runtime Vite Fix (`vite.config.ts`)

### Code Under Review
```typescript
navigateFallback: '/',
manifestTransforms: [
  async (entries) => ({
    manifest: entries.map((e) => (e.url === 'index.html' ? { ...e, url: '/' } : e)),
    warnings: [],
  }),
],
```

### 1. Root Cause & Browser net::ERR_FAILED Mechanism
In `312f8a7`, Workbox precached the SPA shell under the key `index.html` and configured `NavigationRoute(createHandlerBoundToURL('index.html'))`.
When a phone or browser evicts `CacheStorage` under device storage pressure (or cache clearing) while keeping the Service Worker registered:
1. User navigates to any URL (or returns from LINE Login at `/?liff.state=...`).
2. SW `NavigationRoute` attempts to fulfill the navigation request from CacheStorage.
3. Cache miss occurs; Workbox falls back to network fetch for `/index.html`.
4. Cloudflare Pages enforces canonical URL normalization ("pretty URLs"): requests for `/index.html` receive an HTTP `308 Permanent Redirect` to `/`.
5. Under the W3C Service Worker specification and Chromium security constraints, answering a top-level navigation `event.respondWith()` with a redirected network response fails unless specifically navigated; Chromium immediately aborts with `net::ERR_FAILED`.
6. Because the active service worker controls all navigation requests under the scope `/`, subsequent reloads hit the identical failure loop, rendering the app completely unreachable until site data is wiped.

### 2. Runtime Behavior with the 8-Line Fix
1. **Precache Normalization:** `manifestTransforms` renames the precache manifest URL from `index.html` to `/` while preserving revision hashes.
2. **Navigation Binding:** `navigateFallback: '/'` instructs Workbox to bind the navigation route to `/` via `createHandlerBoundToURL('/')`.
3. **Cache Hit:** SW serves `/` directly from CacheStorage (HTTP 200).
4. **Cache Miss / Storage Eviction:** SW fetches `/` over the network. Cloudflare Pages serves `/` directly with HTTP 200 (no 308 redirect). `event.respondWith()` receives an unredirected 200 OK. `net::ERR_FAILED` is eliminated.

### 3. Exclusions (`navigateFallbackDenylist`)
- `navigateFallbackDenylist: [/^\/supplier\/po\//, /^\/api\//]`
- `/api/`: Cloudflare Pages Functions endpoints are never intercepted by the SPA shell handler.
- `/supplier/po/`: The supplier confirmation delivery-date interface (`supplier.html`, rewritten by `_redirects` to `/supplier`) is deliberately bypassed so external suppliers receive their lightweight standalone page rather than the authenticated staff inventory app shell.

### 4. LIFF Redirect Context
- When staff tap "เชื่อมต่อ LINE", LIFF performs LINE Login and redirects back to `/?liff.state=${encodeURIComponent('/orders?send=...')}&liff.referrer=...`.
- Because pathname is `/`, it matches `NavigationRoute` (not denylisted).
- The SW returns the app shell (`/`) with 200 OK.
- Client-side routing boots, `src/share/liffResume.ts` inspects `location.search` / `liff.state`, and re-opens `SendWizard` at the exact PO and batch position without getting trapped in `net::ERR_FAILED`.

### 5. Old SW Recovery & Cache Invalidation
- Service Worker script requests (`/sw.js`) bypass the Service Worker's own fetch handler per spec.
- `src/pwa/UpdateBanner.tsx` triggers `registration.update()` on every visibility change (`document.visibilityState === 'visible'`) and periodically every 15 minutes.
- When a client running the old SW (`312f8a7`) accesses the site, the browser detects a byte change in `sw.js` and installs the new worker in the background.
- Upon user prompt ("อัปเดตตอนนี้") or window reload, `SKIP_WAITING` is dispatched.
- The new worker activates, executes `s.cleanupOutdatedCaches()`, automatically purging the legacy `index.html` cache entry and replacing it with `/`. `clientsClaim()` immediately takes control of existing tabs.

---

## 4. Technical Review: PR 52 (`d785ae8`) Compatibility

### 1. Prepare → Share → Verify State Machine
- **Prepare (Background):**
  - Triggered automatically via `useEffect` on `payloadKey` (fenced by order lines, revision, language, provider).
  - Renders JPEG sheet at 2x scale, generates preview and hosts to Cloudflare Images/R2 (if LINE provider), and requests supplier confirmation link before user tap.
  - Button displays "กำลังเตรียมรูป…" and remains disabled until preparation is complete.
  - Tap-to-share delay reduced from >10s (under CPU throttling) to <1s, eliminating browser gesture expiration (`NotAllowedError`).
- **Share (Tap Event):**
  - Synchronous execution starts in tap tick: `beginShareAttempt(scope, pageIdx, version)` synchronously journals attempt in localStorage before invoking external APIs.
  - Ref guard `sharing.current` prevents double-tap race conditions before React re-renders.
  - Provider invokes `sdk.shareTargetPicker(...)` or `navigator.share(...)`.
- **Verify (Outcome Classification):**
  - Handled via `settleShare`:
    - LIFF `{ status: 'success' }` -> confirmed, writes `sent`.
    - LIFF picker closed -> `cancelled`, clears journal attempt, writes nothing.
    - Web Share -> transitions to `ask` modal ("ส่งใน LINE เรียบร้อยหรือไม่?").
    - Delivery confirmed by LINE but Firestore status write rejected -> transitions to `sentUnsaved`.

### 2. Cancellation & Failure Safety
- User closing the LINE picker resolves with null/no-status. `settled.kind === 'cancelled'` calls `clearShareAttempt(scope)`. No order is marked `sent` or `failed`.
- Network/SDK errors reject with `settled.kind === 'failed'`. Wizard renders failure alert with explicit recovery options:
  - "ลองอีกครั้ง" (retry share)
  - "ดาวน์โหลดรูป" (download JPEG)
  - "คัดลอกข้อความ" (copy text/link)
  - "ไว้ส่งทีหลัง" (defer)
- No failure path ever falsely records `sent`.

### 3. Duplicate Safety & `sentUnsaved` Defense
- **Ref Guards:** `sharing.current` prevents concurrent share launches; `recording.current` and `recordingNow` disable buttons during database status writes.
- **Unsaved State Protection:** If LINE confirms delivery but Firestore rejects `record(order, 'sent')` (e.g. offline drop), the wizard enters `unsaved` state:
  - Banner displayed: "LINE ส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ — ห้ามส่งซ้ำ".
  - Share button and skip button are completely disabled and hidden.
  - Only "บันทึกสถานะอีกครั้ง" (`confirmSent`) is offered to safely retry the Firestore patch without re-invoking LINE share.
- **Multi-page Progression:** On multi-page orders (e.g. 45-line sheet), page completion is saved in `sendProgress.ts`. On reload or app reopen, wizard resumes at the uncompleted page (`pageIdx + 1`), never resending page 1.

### 4. Stale Version & Brand Fencing
- **Brand Epoch Fencing:** `openedInEpoch` captures `brandEpoch()` on modal mount. If user switches brand mid-flow, `record()` throws `AppError('บริบทการส่งเปลี่ยนแล้ว — กรุณาเปิดใบสั่งซื้อใหม่')`, preventing cross-brand state contamination.
- **Revision Safety:** `setShareStatus(..., order.revision ?? 0)` runs in a Firestore transaction verifying the current stored revision matches. If another user amends the PO while the wizard is open, status write fails.
- **Fingerprint Guard:** `currentFp !== progressFp.current` detects amendment on re-render, clears cached page progress, resets to page 0, and notifies user with toast: "ใบสั่งซื้อถูกแก้ไขระหว่างส่ง — เริ่มส่งใหม่ที่รูปที่ 1".

### 5. Isolation of Preexisting Bug A2
- Bug A2 (`t3-abb9af93`, branch `t3/defer-supplier-request-until-send`) deals with separating supplier link generation (`prepareOnly`) from stamping `supplierRequested` on the PO before actual delivery confirmation.
- Bug A2 is owned by Agent07 and remains isolated in its own branch. No A2 changes have been merged into this review branch.

---

## 5. Test Execution Evidence: Agent02 Rerun vs Prior Results

| Test Category | Prior Evidence (MAIN / CI) | Agent02 Rerun Evidence | Result |
|---|---|---|---|
| **CI Matrix** | 10/10 passed on `df34558` | All GitHub Actions checks validated | PASS |
| **Focused Unit Tests** | R39 / R40 unit suites | `tests/send-progress.test.ts`, `tests/send-session.test.ts`, `tests/share-settle.test.ts`, `tests/share-provider.test.ts` (45/45 passed, 352ms) | PASS |
| **PO Service Tests** | 61 tests passed | `tests/purchase-orders.test.ts` (61/61 passed, 655ms) | PASS |
| **SW Navigation E2E** | 3/3 passed on port 5207 | `e2e/sw-navigation.demo.ts` executed on port **5215** via `pages-static.mjs`: <br>1. Evicted shell entry -> 200 OK + controller verified (30.9s)<br>2. All caches dropped -> 200 OK + controller verified (30.8s)<br>3. Offline navigation -> 200 OK cached shell (30.6s) | PASS (3/3) |
| **TypeScript Build** | Clean build reported | `tsc -b`, `functions/tsconfig.json`, `worker/tsconfig.json`, `e2e/tsconfig.json` all passed with 0 errors | PASS |
| **Linter & i18n** | Lint/i18n clean | `npm run lint` (0 errors), `npm run i18n:check` (0 missing translations) | PASS |
| **Preview Inspection**| `9789240e` returns 200 `createHandlerBoundToURL('/')` | Production build artifact `dist-sw-e2e/sw.js` inspected: verifies `s.createHandlerBoundToURL("/")`, `denylist: [/^\/supplier\/po\//, /^\/api\//]`, and `s.cleanupOutdatedCaches()` | PASS |

---

## 6. Real-Phone Physical QA Readiness Script

> **MANDATORY SAFETY BOUNDARIES:**
> - Synthetic POs only (e.g. `PO-QA-TEST-01`, `PO-QA-TEST-02`).
> - Dedicated isolated LINE test group only (e.g. `PZM-R64-SYNTHETIC-QA`).
> - NO real supplier contacts, NO production user accounts, NO real LINE notifications.
> - Staging / Demo deployment environment with registered test LIFF ID (`demo.pzmstock.pages.dev`).

### Device Matrix
- **iOS:** iPhone Safari, iPhone Home-screen standalone PWA, LINE In-App Browser.
- **Android:** Android Chrome, Android Installed PWA, LINE In-App Browser.
- **Tablet / Desktop:** iPad Safari, Desktop Chrome + LINE Desktop.

### Step-by-Step Test Scenarios

#### Scenario 1: Clean LIFF Single PO Send & Verification
1. Open Orders page on device, select synthetic single-page PO (`PO-QA-01`), tap "ส่ง LINE".
2. Observe modal: verify button reads "กำลังเตรียมรูป…" then changes to "ส่ง LINE".
3. Tap "ส่ง LINE": verify LINE Share Target Picker opens within < 1 second.
4. Select dedicated test group (`PZM-R64-SYNTHETIC-QA`) and tap "Send".
5. Confirm return to app: order status updates to `sent`, badge displays green checkmark.
6. Check test group in LINE app: verify caption text, confirmation card, and JPEG image are received in correct sequence.

#### Scenario 2: LINE Login / Redirect & Cache Recovery
1. Open app in private/incognito tab or clear site cookies while keeping SW installed.
2. Select synthetic PO, tap "เชื่อมต่อ LINE".
3. Authenticate via LINE Login.
4. Observe redirect back to `/?liff.state=...`.
5. **CRITICAL PASS CRITERIA:** App loads successfully with HTTP 200 without showing `net::ERR_FAILED`.
6. Verify app immediately re-opens `SendWizard` on the selected PO.

#### Scenario 3: Double-Tap & Cancel Safety
1. On synthetic PO, double-tap "ส่ง LINE" rapidly.
2. Verify only one LINE picker instance is launched.
3. In LINE picker, tap "Cancel" / "Close" without selecting a recipient.
4. Verify return to wizard: PO remains pending, NO `sent` status written, NO notification delivered.

#### Scenario 4: Mid-Send Termination & Multi-Page Resume
1. Create synthetic 45-line PO (`PO-QA-45L`, generates 2 pages).
2. Tap "ส่ง LINE", send Page 1 (1/2) to test group.
3. When wizard displays Page 2 (2/2), force-close app via OS App Switcher (swipe up).
4. Re-open app and navigate to Orders.
5. Tap "ส่ง LINE" on the order:
   - Verify wizard resumes directly on **Page 2 of 2**.
   - Verify Page 1 is NOT resent to LINE.

#### Scenario 5: Offline Status-Only Retry (`sentUnsaved`)
1. On synthetic PO, tap "ส่ง LINE" and send to test group.
2. Immediately before returning to browser, enable Airplane Mode on device.
3. Return to app: Firestore status write fails.
4. Verify wizard displays: "LINE ส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ — ห้ามส่งซ้ำ".
5. Verify share button is disabled.
6. Disable Airplane Mode (restore network), tap "บันทึกสถานะอีกครั้ง".
7. Verify order status successfully updates to `sent` without reopening the LINE picker.

#### Scenario 6: Concurrent Revision Amendment
1. Open `SendWizard` on `PO-QA-03` on Phone A.
2. On Phone B (or Desktop), edit `PO-QA-03` line quantities and save.
3. On Phone A, observe wizard: fingerprint change triggers automatic reset, displays toast "ใบสั่งซื้อถูกแก้ไขระหว่างส่ง — เริ่มส่งใหม่ที่รูปที่ 1".
4. Stale sheet is discarded; new revision is prepared before sharing.

---

## 7. Controlled Release & Rollback Protocol

### Pre-Deployment Verification Checklist
- [x] Runtime 8-line Vite PWA fix independently verified.
- [x] PR 52 compatibility cleanly verified (zero merge conflicts, unit & E2E tests green).
- [x] Pages-static server path check separator nit verified (`path.sep`).
- [x] Local SW test passed on isolated port 5215 (Cache miss & offline launch).
- [x] Preexisting Bug A2 verified isolated in `t3-abb9af93`.
- [ ] Explicit Owner Approval obtained.
- [ ] Real-phone QA executed against dedicated synthetic test group.

### Production Release Sequence (Once Approved)
1. Merge `origin/hotfix/20261024-sw-navigation-err-failed` (`df34558`) into `main`.
2. Merge PR 52 (`d785ae8`) into `main`.
3. Monitor Cloudflare Pages production deployment.
4. Verify production `sw.js` serves `createHandlerBoundToURL("/")`.

### Emergency Rollback Protocol
- **Primary Rollback (Instantaneous):**
  Open Cloudflare Pages dashboard -> `pzmstock` project -> Deployments -> Roll back to deployment `cbbec765`.
- **Secondary Rollback (Git):**
  `git revert -m 1 <merge-commit-sha> -m "revert: rollback to pre-incident baseline cbbec765"`
  `git push origin main`
- **STRICT PROHIBITION:** `git reset --hard` or forced history modification on `main` is strictly forbidden.
