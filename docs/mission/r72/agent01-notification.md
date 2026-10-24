# R72 AGENT01 — Logistics Transfer Notification Verification Report

**Status:** COMPLETE / VERIFIED  
**Agent:** R72 AGENT01 (opencode / `9router/gemini-3.8-flash-high`)  
**Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-0e06f3b6`  
**Branch:** `r72/agent01-notification`  
**Base Commit:** `1651548aef5337d7caf786a081aefd7ee9a19a9a` (PR #55 exact head, CI 10/10)  
**Deployed Production Baseline:** `6045b50` (Cloudflare Pages `pzmstock.pages.dev`, bundle `app-CoF6YBUt.js` / `tones-C7Ca19Zo.js`)  
**Resource Lease:** Port 5206 demo only (no emulators, no production writes, no real LINE sends)

---

## 1. Executive Summary

This mission verifies the complete repair of logistics transfer notification routing and read-state integrity for the R72 release line.

In production (`6045b50`), transfer notification generators emit legacy `/logistics/:id` routes that do not exist in `App.tsx`. Clicking a transfer notification in the Bell or Host popup triggers React Router's catch-all redirect to Dashboard (`/`), while prematurely marking the notification as read in Firestore. As a result, warehouse and branch managers lost track of pending transfer approvals (`TR-00001`), arrivals, and discrepancies.

Under PR #55 (`1651548`) and verified under R72:
1. All newly generated transfer notification drafts (`transferSubmittedDraft`, `transferArrivingDraft`, `transferIssueDraft`) link directly to `/transfers/:id` using the internal document ID.
2. The canonical link resolver (`canonicalLink`) deterministically translates legacy `/logistics/:id` and `/logistics` links to `/transfers/:id` and `/transfers`, while rejecting malicious traversals, query injections, and cross-brand leaks.
3. Pre-navigation destination resolution (`notificationDestination`) verifies document existence under the active brand before navigating, preventing premature read-marking when documents are missing, deleted, or denied.
4. Bell and Host components protect against double-clicks, concurrent requests, and brand switch races.
5. All 168 focused unit tests, TypeScript (`tsc -b`), linter (`oxlint`), and Playwright E2E suite (19 tests on port 5206) pass cleanly.

---

## 2. All Transfer Notification Kinds Matrix

| Notification Kind | Trigger Event | Generated Link | Internal ID vs DocNo | Category & Priority | Bell/Host UI & Action | Resolution & Destination Check |
|---|---|---|---|---|---|---|
| `transferSubmitted` | User submits branch transfer for approval | `/transfers/${t.id}` | Uses `t.id` (e.g. `tr-fixture`). `params.docNo` carries display code `TR-00001`. | `inventory` / `medium` | Popup: YES (`severity: 'warning'`, `sound: 'warning'`). Primary action: `'ดูใบโอน'` -> `/transfers/${t.id}`. Bell sub-line: `'ระบบส่งสินค้า'`. | Verifies `getOne('transfers', t.id)` in active brand. If missing -> error toast, stays unread. |
| `transferArriving` | Manager approves and dispatches transfer (in transit today) | `/transfers/${t.id}` | Uses `t.id`. `params.docNo` carries `TR-00001`. | `inventory` / `info` | Popup: YES (`INFO_POPUP` enabled, `severity: 'info'`, `sound: null`). Primary action: `'ดูใบโอน'` -> `/transfers/${t.id}`. | Verifies `getOne('transfers', t.id)` in active brand. |
| `transferIssue` | Branch receiving reports short/over/damaged goods or misroute | `/transfers/${t.id}` | Uses `t.id`. `params.docNo` carries `TR-00001`. | `inventory` / `high` | Popup: YES (`severity: 'warning'`, `sound: 'warning'`). Primary action: `'ดูใบโอน'` -> `/transfers/${t.id}`. | Verifies `getOne('transfers', t.id)` in active brand. |
| `stockoutRisk` | Location runs out before delivery | `/calendar?item=...` | Related to transfer planning. | `inventory` / `high` | Popup: YES. Offers primary risk link + secondary action `'ตัวเลือกโอนของ'` -> `/transfers/new`. | Resolves `/transfers/new` without extra document query. |
| Legacy `/logistics/:id` | Stored historical notification | `/transfers/:id` | Maps legacy route prefix `/logistics/` to `/transfers/`. Preserves internal document ID. | Preserved from stored document | Mapped by `canonicalLink` to `/transfers/:id`. Entity type decoded as `'transfer'`. | Verifies document ID exists in active brand prior to navigation. |
| Legacy `/logistics` | Legacy hub bookmark or link | `/transfers` | No document ID. | Preserved | Mapped to `/transfers` list view. | Resolves directly without single document lookup. |

---

## 3. Root Cause Analysis: Deployed Production vs Unreleased PR #55

### Deployed Production Evidence (`6045b50` / `app-CoF6YBUt.js`)
Static analysis of publicly served assets at `https://pzmstock.pages.dev/`:
1. **Asset `/assets/tones-C7Ca19Zo.js`**:
   - Contains unpatched generator functions:
     ```js
     link: `/logistics/${e.id}` // for transferSubmitted, transferArriving, transferIssue
     ```
2. **Asset `/assets/main-HH4IxH_j.js`**:
   - Contains router configuration with exact paths:
     ```js
     path: "/transfers/new", path: "/transfers/:id/receive", path: "/transfers/:id"
     ```
   - Crucially, `/logistics` and `/logistics/:id` are **completely absent** from the route table.
   - Catch-all fallback route:
     ```js
     path: "*", element: <Navigate to="/" replace />
     ```
3. **Unpatched Bell Behavior**:
   - In `6045b50`, `NotificationBell.openOne` executed:
     ```ts
     setOpen(false)
     navigate(n.link) // navigates to /logistics/:id -> caught by * -> redirects to /
     await markRead(n, user.id) // notification marked read in Firestore immediately!
     ```
   - The user was bounced to the Dashboard (`/`), while the notification was cleared from their unread badge, making the transfer impossible to locate without manual search.

### Unreleased PR #55 Solution (`1651548`)
1. **Direct Canonical Links**:
   - Updated `src/lib/inventoryRules/notifications.ts` to output `/transfers/${t.id}`.
2. **Canonical Link Translation (`src/lib/notificationLink.ts`)**:
   - Translates `/logistics` -> `/transfers` and `/logistics/:id` -> `/transfers/:id`.
   - Validates routes against strict `NOTIFICATION_ROUTES` whitelist.
   - Discards malformed URI encodings, directory traversal (`..`), null bytes (`%00`), and cross-brand query parameters.
3. **Pre-Navigation Target Verification (`src/services/notifications.ts`)**:
   - `notificationDestination(link, brand)` queries `scoped(brand).getOne(COL.transfers, id)` before navigating.
   - Throws `AppError('ไม่พบเอกสารโอนสินค้า')` if document does not exist.
   - Only upon successful resolution and navigation does `markRead` execute.
4. **Concurrency & Brand Race Safety**:
   - Bell and Host components use `openingRef` to synchronously gate rapid double-clicks.
   - Detects brand switching during asynchronous document fetch:
     `if (getBrand() !== brand) throw new AppError('บริษัทเปลี่ยนแล้ว กรุณาเปิดการแจ้งเตือนอีกครั้ง')`
   - Aborts without marking read or navigating across company namespaces.

---

## 4. Internal Document ID vs DocNo Identity Rule

1. **Deterministic Document ID**:
   - Transfer notifications link strictly by internal Firestore document ID `t.id` (e.g. `tr-internal-uuid-88392`).
   - Human-readable document numbers (e.g. `TR-00001`) are placed exclusively in `params.docNo` for template rendering and localized copy interpolation.
2. **No Title-Derived Identity**:
   - Title strings (e.g. `"คำขอโอนสินค้ารออนุมัติ TR-00001"`) are never parsed to extract route destinations.
   - If a caller crafts a link using `docNo` (e.g. `/transfers/TR-00001`), `notificationDestination` executes `getOne('transfers', 'TR-00001')`. Because `TR-00001` is not the document primary key, Firestore returns `null`, the call rejects with `ไม่พบเอกสารโอนสินค้า`, and the notification remains strictly unread.

---

## 5. Read State and Brand Boundaries

1. **Unread on Missing, Deleted, or Denied Target**:
   - If a transfer is deleted or missing from the database, `notificationDestination` throws `ไม่พบเอกสารโอนสินค้า`.
   - Neither `navigate()` nor `markRead()` is executed; the user receives a localized Thai toast error, and the notification stays unread in localStorage/Firestore.
   - If read permission is denied (`permission-denied`), the error is surfaced via toast, and read state is untouched.
2. **Brand Isolation**:
   - A transfer belonging to `lelapin` is queried under `scoped('pizza')` when Pizza is active. It returns `null`, failing closed with `ไม่พบเอกสารโอนสินค้า`.
   - Cross-brand query injection (e.g. `/transfers/tr-1?brand=rnd` or `/logistics/tr-1?company=lelapin`) is explicitly refused by `canonicalLink` returning `null`.
3. **Brand Switch Race**:
   - If a user switches active brands while `notificationDestination` or `markRead` is in-flight, `getBrand() !== brand` gates prevent navigation or writes into the wrong brand. `markAllRead` halts immediately.

---

## 6. Mobile PWA & Offline Navigation

1. **Service Worker Fallback (`dc0e6ee` / `df34558`)**:
   - App shell is cached as `/`. Deep links (`/transfers/:id`, `/transfers/:id/receive`) loaded directly or refreshed under PWA fallback to the app shell without encountering `ERR_FAILED`.
2. **Responsive Bell & Viewport**:
   - Tested on desktop and mobile viewports (390x844 iPhone profile). Bell interaction cleanly opens modal sheet, executes navigation to `/transfers/tr-fixture`, and updates unread badge count from 1 to 0.

---

## 7. Verification Evidence & Test Counts

### Unit & Contract Tests (Vitest)
Command: `npx vitest run tests/r72-logistics-notifications.test.ts tests/notification-destination.test.ts tests/notification-link.test.ts tests/notification-route-contract.test.ts tests/notification-regression-r64.test.ts`
- `tests/r72-logistics-notifications.test.ts`: **35 passed** (NEW dedicated R72 suite)
- `tests/notification-destination.test.ts`: **15 passed**
- `tests/notification-link.test.ts`: **36 passed**
- `tests/notification-route-contract.test.ts`: **68 passed**
- `tests/notification-regression-r64.test.ts`: **14 passed**
- **Total Vitest Tests:** **168 passed** (5 files, 0 failed, 541ms)

### Static Typing & Linter
- TypeScript (`npx tsc -b`): **0 errors** (clean)
- Oxlint (`npx oxlint tests/r72-logistics-notifications.test.ts e2e/notification-navigation.demo.ts`): **0 errors / 0 warnings** (clean)

### Playwright E2E Suite
Command: `npx playwright test -c playwright.notification.config.ts` (port 5206, browser storage only)
- **19 passed** (0 failed)
- Includes Owner `TR-00001` legacy `/logistics/:id` resolution and R72 `transferArriving` notification navigation.

### Visual Evidence Artifacts (PNG)
1. `docs/mission/r72/repro-tr-00001-legacy-link-resolved.png` (118,664 bytes)
   - Visual capture of legacy `/logistics/tr-fixture` notification in Thai locale resolving to `/transfers/tr-fixture` with `TR-00001` details rendered.
2. `docs/mission/r72/r72-agent01-transfer-notification.png` (118,664 bytes)
   - Visual capture of `transferArriving` notification resolving to `/transfers/tr-fixture` and marked read.

---

## 8. Mutation Sensitivity Proof

1. **Mutation 1 (DocNo Identity Leak)**:
   - In `src/lib/inventoryRules/notifications.ts`, mutated `transferSubmittedDraft` link from `/transfers/${t.id}` to `/transfers/${t.docNo}`.
   - Result: `tests/r72-logistics-notifications.test.ts` failed with `AssertionError: expected '/transfers/TR-00001' to be '/transfers/tr-internal-uuid-88392'`.
2. **Mutation 2 (Broken Legacy Mapping)**:
   - In `src/lib/notificationLink.ts`, mutated `if (path === '/logistics') path = '/transfers'` to `/somewhere_else`.
   - Result: `tests/r72-logistics-notifications.test.ts` failed 2 tests (`legacy logistics hub` and `legacy logistics hub with trailing slash`).
3. Reverted all mutations cleanly (`git diff src/` confirmed empty).

---

## 9. Gaps & Hand-Off Boundaries

1. **TransferReceivePage**: The receiving mobile layout (four-row card, stepper geometry, decimal inputs) is strictly owned by Agent02. No UI or component changes were made to `TransferReceivePage.tsx`.
2. **Broader Route Contracts**: Non-notification route contracts (purchasing, calendar, reports, search) are audited and maintained by Agent04.
3. **Production Deployment**: Cloudflare Pages production host `pzmstock.pages.dev` remains at `6045b50` until PR #55 and R72 releases are merged and deployed by MAIN.
