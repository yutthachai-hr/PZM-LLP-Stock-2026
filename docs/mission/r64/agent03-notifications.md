# R64 — Notification & UX Broad Regression Review

**Date:** 24 Oct 2026  
**Base:** `origin/main = 312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`  
**PR #55 HEAD:** `62fa3ba06cf481e4b5e25c07f60e5ea497124ac8` (`origin/fix/20261024-transfer-notification-link`)  
**Sprint Commit:** `6c17c9843ab0cc28c29265afbf6c4a115f91d9c4` (branch `t3/review-notification-regressions`)  
**Review Status:** `REVIEW_PENDING` (Gemini implementation requires independent non-Gemini review; no self-approval)

---

## 1. Root Cause & PR Existence

PR #55 exists on branch `fix/20261024-transfer-notification-link` resolving R63 transfer navigation (`/logistics/:id` legacy routing and destination verification before marking read).

R64 sprint conducted deep multi-axis regression across all notification kinds, routes, UI components (`NotificationBell`, `NotificationHost`), presentation, service layer, and worker.

Five verified defects were identified and resolved:
1. **Query/Hash percent-decoding vulnerability in `canonicalLink`:**
   `canonicalLink` checked `/[\\\s\p{Cc}]/u.test(link)` on the raw string before `decodeURI`. Encoded control characters (e.g. `%00`, `%0D%0A`) and backslashes (`%5C`) in query or hash bypassed validation.
2. **Hash fragment pollution and missing decode in `entityOf`:**
   Regexes `/[?&]po=([^&]+)/` and `/^\/requests\/([^/?]+)/` did not exclude `#`, causing hash fragments (e.g. `/orders?po=PO-1#audit`) to pollute `entityId` as `'PO-1#audit'`.
3. **Uncanonicalized secondary actions in `presentNotification`:**
   Secondary actions (`/suppliers?id=...`, `/transfers/new`) were constructed directly without `canonicalLink`, allowing unvalidated or broken action URLs.
4. **Brand switch race in `markRead` and `markAllRead`:**
   `markRead` in `src/services/notifications.ts` called `scoped()` without checking whether the active brand still matched the notification's brand, risking writes to the wrong company's notifications collection.
5. **Duplicate click race in Bell and Host:**
   `openOne` and `open` relied on React state `opening` asynchronously. Fast double-clicks executed concurrent destination resolutions and duplicate backend `markRead` writes. `readAll` had no click guard.

---

## 2. Exact HEAD Information

- **Merge Base:** `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`
- **PR #55 HEAD:** `62fa3ba06cf481e4b5e25c07f60e5ea497124ac8`
- **R64 Patched Commit:** `6c17c9843ab0cc28c29265afbf6c4a115f91d9c4`
- **Files Modified:**
  - `src/lib/notificationLink.ts`
  - `src/lib/notificationPresentation.ts`
  - `src/services/notifications.ts`
  - `src/components/notifications/NotificationBell.tsx`
  - `src/components/notifications/NotificationHost.tsx`
  - `tests/notification-regression-r64.test.ts` (new RED->GREEN test)
  - `e2e/notification-navigation.demo.ts` (expanded browser QA)
  - `playwright.r64.config.ts` (new isolated QA config on port 5213)

---

## 3. Tested Kinds & URLs

All 29 notification kinds verified:
- **Transfers:** `transferSubmitted`, `transferArriving`, `transferIssue` -> `/transfers/:id`, `/transfers/:id/receive`, `/transfers/today`, `/transfers/new`, `/logistics/:id` (legacy mapped).
- **Orders:** `poArriving`, `poDelayed`, `supplierConfirmed`, `supplierDateChanged`, `supplierDatePending`, `supplierDateApproved`, `supplierDateRejected`, `supplierOpened`, `poSent`, `deliveryRisk` -> `/orders?po=:id`.
- **Purchase Requests:** `prSubmitted`, `prReturned`, `cutoffToday` -> `/requests/:id`, `/requests`.
- **Inventory & Tasks:** `taskSoon`, `taskOverdue`, `taskEscalated`, `taskApproval`, `lowStock`, `outOfStock`, `stockoutSoon`, `reorder`, `stockoutRisk`, `dailyBrief` -> `/calendar?item=...`, `/calendar?filter=today`.
- **Stock Movements & Reports:** `adjustment`, `waste` -> `/movements?product=...`, `weeklySummary` -> `/reports`.
- **Dashboard:** overview notifications -> `/`.

Safety validations verified:
- Refuses percent-encoded control chars and backslashes in query/hash (`%00`, `%5C`, `%0D%0A`).
- Preserves valid percent-encoded spaces and query parameters (`/orders?po=PO%201`).
- Exact parity maintained with all 30 routes in `App.tsx` and `NOTIFICATION_ROUTES`.

---

## 4. Commands & Results

| Command | Suite | Result |
|---|---|---|
| `npm test -- tests/notification-regression-r64.test.ts` | R64 RED->GREEN Regression | **14/14 passed** (initially 11 failed RED) |
| `npm test -- tests/notification-destination.test.ts tests/notification-link.test.ts tests/notification-popups.test.ts tests/notifications-service.test.ts tests/notification-regression-r64.test.ts` | Focused Notifications | **5 files / 100 passed** |
| `npm test` | Full Vitest Unit Suite | **144 files / 1779 passed** |
| `npx playwright test --config playwright.r64.config.ts` | Isolated Browser QA (Port 5213) | **17/17 passed** (38.5s) |
| `npm run build` | Full Production Typecheck & Bundle | **PASS** (zero errors across client, worker, functions, e2e) |

---

## 5. Source Findings

1. **`src/lib/notificationLink.ts`:**
   Added `if (/[\\\p{Cc}]/u.test(decodedUri)) return null` after `decodeURI(link)` to ensure decoded query and hash components cannot inject control characters or backslashes.
2. **`src/lib/notificationPresentation.ts`:**
   - Fixed `po` regex to `/[?&]po=([^&#]+)/` and `req` regex to `/^\/requests\/([^/?#]+)/`, decoding with `decodeURIComponent`.
   - Secondary actions for `supplierId` and `stockoutRisk` (`/transfers/new`) are routed through `canonicalLink` before appending.
3. **`src/services/notifications.ts`:**
   - `markRead` signature updated to `(n, uid, now = Date.now(), brand = getBrand())`.
   - Added `readInflight` set to dedupe concurrent in-flight writes.
   - Refuses write if `getBrand() !== brand`.
   - `markAllRead` breaks immediately if brand switches mid-iteration.
4. **`src/components/notifications/NotificationBell.tsx` & `NotificationHost.tsx`:**
   - Added synchronous `openingRef` to suppress rapid multi-click races before React re-render.
   - Added `readingAllRef` and disabled state on the "Mark all as read" button.
   - Captured and passed current brand explicitly to `markRead` and `markAllRead`.

---

## 6. Browser Preview Evidence (Prior vs Rerun)

- **Prior Evidence (R63):** Cloudflare deployment `https://722d9218.pzmstock.pages.dev` on PR55 HEAD `62fa3ba`.
- **Rerun Evidence (R64):**
  - Run via Playwright test runner on port `5213` using dedicated synthetic storage fixture config (`playwright.r64.config.ts`).
  - Never touches reserved ports (8080, 9099, 5206, 5207, 8082).
  - 17/17 browser scenarios green including:
    - Desktop & mobile legacy Bell click opening document id.
    - Double click on Bell row without race.
    - Direct navigation for order notifications (`/orders?po=PO-1`).
    - Refused destinations (`%00` query, missing transfers, evil URLs) remaining unread with no stock mutations.
    - Popup actions and empty state verification.

---

## 7. Readiness & Rollback

- **Release Readiness:** Code changes are verified green across unit, E2E browser, and build typechecks. However, per repository policy, independent review of Gemini implementation is **`REVIEW_PENDING`** until reviewed by a different model family.
- **Rollback:**
  - Branch can be reverted to PR55 HEAD with `git reset --hard 62fa3ba06cf481e4b5e25c07f60e5ea497124ac8`.
  - No database migrations, no schema updates, and no `firestore.rules` changes exist.
  - Safe for immediate rollback if needed.

---

## 8. Sub-Agent Execution Metadata

- **Provider:** `9router`
- **Model:** `gemini-3.8-flash-high`
- **Isolated Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-c23e0cb4`
- **Worktree Branch:** `t3/review-notification-regressions`
- **Parent Worktree State:** Preserved without modification.
