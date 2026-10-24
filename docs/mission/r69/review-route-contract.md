# R69 Review: Notification Route-Contract Tests

Reviewer: Review Sub-Agent
Target Commit: `1651548aef5337d7caf786a081aefd7ee9a19a9a`
Parent Chain: `35403c1` → `66813ee` → `63fd76d` → `0d38dee` → `94ff0bc` (PR #55 head)
Diff Range: `94ff0bc..1651548`

---

## 1. Scope & Diff Verification

Diff touches ONLY test, documentation, and artifact files:
- `tests/notification-route-contract.test.ts` (+840 lines, 68 tests)
- `e2e/notification-navigation.demo.ts` (+1 repro test for Owner bug TR-00001)
- `docs/mission/r69/agent01-link-integrity.md` (integrity matrix & test report)
- `docs/mission/r69/repro-tr-00001-legacy-link-resolved.png` (Playwright screenshot artifact)
- No files under `src/` modified.

---

## 2. Review Checklist

### (1) Dynamic Route Extraction & Drift Resistance
- `tests/notification-route-contract.test.ts:36-37` reads `src/App.tsx` directly via `readFileSync` and extracts declared routes with regex `/<Route path="(\/[^"*]*)"/g` into `APP_DECLARED_ROUTES`.
- `tests/notification-route-contract.test.ts:178-180` asserts exact bidirectional equality:
  `expect([...NOTIFICATION_ROUTES].sort()).toEqual([...APP_DECLARED_ROUTES].sort())`.
- `tests/notification-route-contract.test.ts:182-184` asserts the catch-all redirect `<Route path="*" element={<Navigate to="/" replace />} />` exists in `src/App.tsx`.
- Verdict: PASS. Routes are derived dynamically from source, and static route table `NOTIFICATION_ROUTES` is checked against drift.

### (2) Link Generator Coverage
Grep comparison against `src/lib/inventoryRules/notifications.ts`, `src/lib/activityLog.ts`, and surrounding navigation builders:
- **`src/lib/inventoryRules/notifications.ts`**:
  - `taskSoon` / `taskOverdue` / `taskEscalated` (`/calendar?item=task__<id>`)
  - `poArriving` / `poDelayed` (`/orders?po=<id>`)
  - `cutoffToday` (`/requests`)
  - `lowStock` / `outOfStock` (`/calendar?item=<kind>__<pId>__<locId>`)
  - `reorder` (`/calendar?item=reorder__<pId>__<locId>`)
  - `stockoutSoon` (`/calendar?item=stockoutEstimate__<pId>__<locId>`)
  - `dailyBrief` (`/calendar?filter=today`)
  - `weeklySummary` (`/reports`)
  - `deliveryRisk` (`/orders?po=<id>`)
  - `stockoutRisk` (`/`)
  - Standalone drafts: `taskApprovalDraft`, `prSubmittedDraft`, `prReturnedDraft`, `supplierAnswerDraft` (3 sub-kinds), `supplierOpenedDraft`, `poSentDraft`, `supplierDecisionDraft` (approved & rejected), `adjustmentDraft` (adjustment & waste), `transferSubmittedDraft`, `transferArrivingDraft`, `transferIssueDraft`.
- **`src/lib/activityLog.ts`**:
  - `movement` (`/movements?product=<id>`)
  - `order` (`/orders?po=<id>`)
  - `request` (`/requests/<id>`)
  - `task` (`/calendar?item=task__<id>`)
- **`src/lib/sidebarLive.ts`**:
  - `recentActivity` movements (`/movements?doc=<docNo>`)
  - `recentActivity` orders (`/orders?po=<id>`)
- **`src/lib/globalSearch.ts`**:
  - Products (`/products/<id>/card`), documents (`/movements?doc=<docNo>`), suppliers (`/suppliers?id=<id>`), locations (`/movements?location=<id>`).
- **`src/components/nav/navItems.ts`**:
  - All `actionsFor('admin')` actions and all 18 `NAV` routes.
- **Missing Generators**: None. 100% of notification and activity link generators are exercised.

### (3) Non-Vacuous Verification
- Verified by manual mutation in local worktree:
  1. Mutated `src/lib/inventoryRules/notifications.ts:549` (`transferSubmittedDraft`) to `/logistics/${t.id}`:
     → `tests/notification-route-contract.test.ts:780` failed immediately with `AssertionError: expected null to be '/transfers/:id'`.
  2. Mutated `src/lib/inventoryRules/notifications.ts:244` (`cutoffToday`) to `/bogus-path`:
     → `tests/notification-route-contract.test.ts:780` failed immediately with `AssertionError: expected null to be '/requests'`.
  3. Reverted `src/` cleanly via `git checkout -- src`. Tests returned to 100% pass.
- Verdict: PASS. Contract test detects broken routes and catches falling back to catch-all.

### (4) End-to-End Test Assertion Integrity
`e2e/notification-navigation.demo.ts:222-252` (`owner TR-00001: legacy /logistics/:id notification navigates to /transfers/:id and marks read`):
- Sets Thai locale and staged notification with legacy unrouted link `/logistics/tr-fixture`.
- Asserts bell displays Thai title `คำขอโอนสินค้ารออนุมัติ TR-00001` and body text.
- Asserts notification unread before click (`readBy['r63-user']` is falsy).
- Clicks notification and asserts destination URL is `/transfers/tr-fixture` and NOT `/`.
- Asserts `<main>` contains `TR-00001`.
- Asserts notification is marked read in storage only after navigation succeeds.
- Saves screenshot to `docs/mission/r69/repro-tr-00001-legacy-link-resolved.png`.
- Verdict: PASS.

---

## 3. Test Suite Execution Results

| Suite | Command | Result |
|---|---|---|
| Vitest Route Contract | `npx vitest run tests/notification-route-contract.test.ts` | 68 passed (1 file) |
| Vitest Full Notification Suite | `npx vitest run tests/notification-route-contract.test.ts tests/notification-link.test.ts tests/notification-destination.test.ts` | 119 passed (3 files) |
| TypeScript Compiler | `npx tsc -b` | Clean (0 errors) |
| Oxlint Linter | `npx oxlint tests/notification-route-contract.test.ts e2e/notification-navigation.demo.ts` | Clean (0 errors, 0 warnings) |
| Playwright E2E | `npx playwright test -c playwright.notification.config.ts` | 18 passed (57.3s, port 5206) |

---

## 4. Findings

- **Must**: None.
- **Should**:
  - `tests/notification-route-contract.test.ts:37`: `appSource.matchAll(/<Route path="(\/[^"*]*)"/g)` assumes double-quoted `path="..."` attributes. If any future route uses single quotes, `APP_DECLARED_ROUTES` wouldn't capture it; however, the assertion on line 179 against `NOTIFICATION_ROUTES` guarantees this drift would be caught immediately at test time.

---

## 5. Verdict

**APPROVE**

---

## 6. Execution Metadata

- **Provider / Model**: `9router/gemini-3.8-flash-high`
- **Worktree**: `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-cfda0c17`
- **Report Commit SHA**: `2f239aa`
