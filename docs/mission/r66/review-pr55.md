# PR55 Independent Review Report (R66 Wave 3)

## 1. Overview & Exact Head
- **Target SHA Reviewed**: `f301f39b94adaf561e23b2b841fe79175edd9d67`
- **Base Commit**: `312f8a7` (`origin/main`)
- **Branch**: `fix/20261024-transfer-notification-link`
- **Verification**: `git rev-parse HEAD` -> `f301f39b94adaf561e23b2b841fe79175edd9d67`

## 2. Authorship & Independence Statement
- **Commit Lineage**:
  - `62fa3ba`: base fix by earlier MAIN/Codex session
  - `6c17c98`: patch by Gemini session (R64 Agent03)
  - `f301f39`: regression tests by MAIN (Codex)
- **Reviewer Independence**:
  - Fresh reviewer agent in isolated worktree (`t3-79580d7e`).
  - No participation in authoring `62fa3ba`, `6c17c98`, or `f301f39`.
  - Cross-model relative to MAIN (Codex) commits; distinct agent session relative to R64 Agent03 Gemini commit.

## 3. Files Read & Inspected
- `src/lib/notificationLink.ts`
- `src/lib/notificationPresentation.ts`
- `src/services/notifications.ts`
- `src/components/notifications/NotificationBell.tsx`
- `src/components/notifications/NotificationHost.tsx`
- `src/pages/transfers/TransferDetailPage.tsx`
- `src/pages/transfers/TransferReceivePage.tsx`
- `src/App.tsx`
- `src/services/transfers.ts`
- `src/lib/inventoryRules/notifications.ts`
- `src/data/DataContext.tsx`
- `src/data/notificationInbox.ts`
- `tests/notification-link.test.ts`
- `tests/notification-destination.test.ts`
- `tests/notification-sprint-boundaries.test.ts`
- `tests/notification-regression-r64.test.ts`
- `tests/notifications-service.test.ts`
- `tests/notification-popups.test.ts`
- `playwright.notification.config.ts`
- `e2e/notification-navigation.demo.ts`

## 4. Attack Cases Tried & Outcomes

### 4.1 Legacy URL Normalisation
- `//evil.com`, `///evil.com`, `/\\evil.com` -> rejected (`null`).
- `javascript:alert(1)`, `data:text/html,...` -> rejected (`null`).
- Control characters (`%00`, `%0d%0a`, `\u0000`, `\u2028`) in path, query, or hash -> rejected (`null`).
- Backslashes (`%5c`, `%5C`, `%255c`) in path, query, or hash -> rejected (`null`).
- Path traversal (`..`, `.`, `%2e%2e`, `/transfers/tr-1/..`) -> rejected (`null`).
- Double-encoded separators (`%252f`, `%255c`) -> rejected (`null`).
- Brand query hijacking (`/transfers/tr-1?brand=lelapin`, `?brandId=lelapin`, `?company=lelapin`, `?BRAND=lelapin`, `/transfers/tr-1?x=1&brand=lelapin`) -> rejected (`null`).
- Safe hash/query fragments (`/transfers/tr-1#notes`, `/orders?po=PO-1#history`) -> preserved as valid local URLs; `entityOf` strips `#` and `?` cleanly and decodes identifiers.
- Trailing slashes (`/transfers/tr-1/`, `/transfers/tr-1///`, `/transfers/tr-1/receive/`, `/logistics/tr-1/`) -> normalized to canonical form without trailing slash.
- Legacy route mapping: `/logistics/:id` mapped to `/transfers/:id`; `/logistics` mapped to `/transfers`. Unrecognized subroutes rejected.
- Off-origin navigation: completely impossible; all returned URLs are relative and match explicit `NOTIFICATION_ROUTES` list corresponding to `App.tsx` routes.

### 4.2 Brand Isolation
- **Notification from brand A while brand B is active**: `notificationDestination(link, brand)` evaluates `scoped(brand).getOne(COL.transfers, id)` strictly against the notification's brand namespace.
- **Brand switch during destination check**: Both `notificationDestination` and `NotificationBell.tsx`/`NotificationHost.tsx` verify `getBrand() !== brand` before and after awaits; throws `AppError('บริษัทเปลี่ยนแล้ว กรุณาเปิดการแจ้งเตือนอีกครั้ง')`, toast is shown, navigation aborted, notification stays unread.
- **Brand switch during `readAll` (`markAllRead`)**: The loop in `markAllRead` evaluates `if (getBrand() !== brand) break` on each iteration, immediately terminating if brand shifts. `markRead` also evaluates `if (getBrand() !== brand) return` and writes strictly to `scoped(brand)`. Cross-brand writes are blocked.
- **Concurrent `markRead` deduplication**: Deduplication keyed on `${brand}:${n.id}:${uid}` in `readInflight` guarantees that parallel or repeated clicks trigger exactly one backend write.

### 4.3 Missing Document Handling
- **Deleted / nonexistent / cross-brand transfer ID**:
  - Notification click: `notificationDestination` throws `AppError('ไม่พบเอกสารโอนสินค้า')`. UI displays toast error; notification is not marked read; no navigation occurs; no stock mutation occurs.
  - Bookmarked or direct navigation: `TransferDetailPage` and `TransferReceivePage` verify the loaded document; missing document displays `<EmptyState icon="..." title="ไม่พบเอกสารโอนสินค้า" />`. No crash, no edit controls, no stock movement mutations.

### 4.4 Bell vs Popup Parity & Concurrency
- **Destination parity**: Both Bell list (`NotificationBell.tsx`) and popup action button (`NotificationHost.tsx`) pass the link through `notificationDestination` and `canonicalLink`, routing to the identical URL.
- **Rapid click / double-click protection**: Both components lock with `openingRef.current = true` synchronously and set `opening = n.id / card.key`, disabling interactive buttons (`aria-busy`, `disabled`) and discarding concurrent clicks.

## 5. Test Commands & Verification Counts

### 5.1 Unit and Regression Test Suites
- Command:
  ```bash
  npx vitest run tests/notification-link.test.ts tests/notification-destination.test.ts tests/notification-sprint-boundaries.test.ts tests/notification-regression-r64.test.ts tests/notifications-service.test.ts tests/notification-popups.test.ts
  ```
- Result: **6 test files passed, 102 tests passed, 0 failed**.
  - `tests/notification-link.test.ts`: 36 passed
  - `tests/notification-destination.test.ts`: 15 passed
  - `tests/notification-sprint-boundaries.test.ts`: 2 passed
  - `tests/notification-regression-r64.test.ts`: 14 passed
  - `tests/notifications-service.test.ts`: 22 passed
  - `tests/notification-popups.test.ts`: 13 passed

- Full repo test suite check:
  ```bash
  npx vitest run
  ```
  Result: **145 test files passed, 1781 tests passed, 0 failed**.

### 5.2 TypeScript Build
- Command:
  ```bash
  npx tsc -b
  ```
- Result: **0 errors** (clean build).

### 5.3 Localization Verification
- Command:
  ```bash
  node scripts/i18n-check.mjs
  ```
- Result: **Every Thai UI string is translated**.

### 5.4 Playwright Browser Run
- **Skipped**: Per instructions, optional browser run was permitted only on port 5217 using `playwright.notification.config.ts` if it could be pointed there without modifying tracked files. Because `playwright.notification.config.ts` hardcodes port 5206 and has no environment variable override for port, and editing tracked files is strictly prohibited, the browser run was skipped.

## 6. Findings
- **Must Fix**: None.
- **Should Fix**: None.

## 7. Final Verdict
**APPROVE**
