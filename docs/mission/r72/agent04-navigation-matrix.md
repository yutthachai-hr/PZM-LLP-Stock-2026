# R72 AGENT04 Navigation Contract Matrix & Audit Report

## 1. Execution & Environment Metadata

- **Agent Role:** R72 Agent 04 — Broader Navigation Contract & Route Audit (Recovery R2)
- **Status:** REVIEW_PENDING
- **Provider:** opencode
- **Model:** `9router/gemini-3.8-flash-high`
- **Variant:** high
- **Worktree Path:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-c683a9fe`
- **Branch:** `r72/agent04-navigation-r2`
- **Baseline Commit:** `ac3bfdbb89c1978c5383165bd8b5fd784b2d5895`
- **Authority Route Reference:** `src/App.tsx` (32 declared routes + catch-all `*` redirecting to `/`)
- **Test Evidence:**
  - Existing Contract Suite (`tests/notification-route-contract.test.ts`): 68 PASS
  - New Navigation Contract Suite (`tests/r72-navigation-contract.test.ts`): 82 PASS
  - Combined Navigation Contract: 150 PASS
  - TypeScript Typecheck (`tsc -p tsconfig.json --noEmit`): 0 ERRORS
  - Application Source Diff: 0 lines changed (audits & contracts preserved, fix implementation deferred to MAIN)

---

## 2. Scope & Verification Boundaries

> **IMPORTANT VERIFICATION CAVEAT:**
> - A **PASS** in this matrix denotes a **code / static contract verification**: the generated URL matches an active route pattern declared in `src/App.tsx`, expected search parameters / route parameters align with parameter consumer definitions, and fallbacks/guards exist in code.
> - **Code / static contract PASS is NOT rendered E2E, live document-load hydration, brand switch persistence across browser reload, or visual element rendering PASS.**
> - Interactive browser DOM interactions, canvas rendering, and dynamic device behaviors are **NOT TESTED** in this contract pass (deferred to dedicated Playwright / browser E2E suites). Absolute claims of "every clickable element" are explicitly disclaimed.

---

## 3. Route Authority Table (`src/App.tsx`)

Every destination route in this application is declared in `src/App.tsx` lines 126–158. Any path not matching one of these 32 route patterns falls through to `<Route path="*" element={<Navigate to="/" replace />} />`.

| # | Route Pattern | Target Component | File Location | Static Match Verified |
|---|---|---|---|---|
| 1 | `/` | `DashboardPage` | `src/pages/Dashboard.tsx` | YES |
| 2 | `/products` | `ProductsPage` | `src/pages/Products.tsx` | YES |
| 3 | `/products/:id/card` | `StockCardPage` | `src/pages/StockCardPage.tsx` | YES |
| 4 | `/receive` | `ReceivePage` | `src/pages/Receive.tsx` | YES |
| 5 | `/issue` | `IssuePage` | `src/pages/Issue.tsx` | YES |
| 6 | `/recipes` | `RecipesPage` | `src/pages/recipes/RecipesPage.tsx` | YES |
| 7 | `/transfers` | `TransfersPage` | `src/pages/transfers/TransfersPage.tsx` | YES |
| 8 | `/transfers/today` | `TransfersTodayPage` | `src/pages/transfers/TransfersTodayPage.tsx` | YES |
| 9 | `/transfers/new` | `TransferDetailPage` | `src/pages/transfers/TransferDetailPage.tsx` | YES |
| 10 | `/transfers/:id/receive` | `TransferReceivePage` | `src/pages/transfers/TransferReceivePage.tsx` | YES |
| 11 | `/transfers/:id` | `TransferDetailPage` | `src/pages/transfers/TransferDetailPage.tsx` | YES |
| 12 | `/adjust` | `AdjustPage` | `src/pages/Adjust.tsx` | YES |
| 13 | `/counts` | `MonthlyCountsPage` | `src/pages/counts/MonthlyCountsPage.tsx` | YES |
| 14 | `/counts/:id` | `MonthlyCountSheet` | `src/pages/counts/MonthlyCountSheet.tsx` | YES |
| 15 | `/movements` | `MovementsPage` | `src/pages/Movements.tsx` | YES |
| 16 | `/reports` | `ReportsPage` | `src/pages/Reports.tsx` | YES |
| 17 | `/import` | `ImportPage` | `src/pages/Import.tsx` | YES |
| 18 | `/suppliers` | `SuppliersPage` | `src/pages/Suppliers.tsx` | YES |
| 19 | `/suppliers/performance` | `SupplierPerformancePage` | `src/pages/suppliers/SupplierPerformance.tsx` | YES |
| 20 | `/orders` | `OrdersPage` | `src/pages/Orders.tsx` | YES |
| 21 | `/requests` | `PurchaseRequestsPage` | `src/pages/requests/PurchaseRequests.tsx` | YES |
| 22 | `/requests/:id` | `RequestPage` | `src/pages/requests/RequestPage.tsx` | YES |
| 23 | `/purchase` | `PurchaseBatchesPage` | `src/pages/purchase/PurchaseBatches.tsx` | YES |
| 24 | `/purchase/import` | `PurchaseImportPage` | `src/pages/purchase/PurchaseImport.tsx` | YES |
| 25 | `/purchase/:id` | `PurchaseBatchReviewPage` | `src/pages/purchase/PurchaseBatchReview.tsx` | YES |
| 26 | `/calendar` | `CalendarPage` | `src/pages/calendar/CalendarPage.tsx` | YES |
| 27 | `/announcements` | `AnnouncementsPage` | `src/pages/announcements/AnnouncementsPage.tsx` | YES |
| 28 | `/announcements/new` | `AnnouncementPage` | `src/pages/announcements/AnnouncementPage.tsx` | YES |
| 29 | `/announcements/:company/:id` | `AnnouncementPage` | `src/pages/announcements/AnnouncementPage.tsx` | YES |
| 30 | `/settings` | `SettingsPage` | `src/pages/Settings.tsx` | YES |
| 31 | `/settings/:section` | `SettingsPage` | `src/pages/Settings.tsx` | YES |
| 32 | `/more` | `MorePage` | `src/pages/More.tsx` | YES |
| * | `*` (Catch-all) | `Navigate to="/"` | Redirects to Dashboard fallback | YES |

---

## 4. Audited Navigation Areas & Comprehensive Matrix

### Domain 1: Bell & Notifications
- **Components:** `src/components/notifications/NotificationBell.tsx`, `src/services/notifications.ts`
- **Resolver Policy:** Reuses canonical resolution defined in `PR #55` via `notificationDestination(link, brand)` (owned by Agent 01). No secondary or duplicate resolver created.

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Click Notification Item (Transfer) | `/transfers/:id` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Scoped brand existence check (`notifications.ts:29`); throws `ไม่พบเอกสารโอนสินค้า` if missing. | PASS | NOT TESTED |
| Click Legacy Stored Transfer Link | `/logistics/:id` | Canonicalized to `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Normalizes legacy prefix before navigation; rejects multi-brand leaks. | PASS | NOT TESTED |
| Click Settings Shortcut in Bell Header | `/settings/notifications` | `/settings/:section` | `SettingsPage.tsx:123` (`useParams().section`) | Section resolves to `notifications`. | PASS | NOT TESTED |
| Click "ตั้งค่าการแจ้งเตือน" at Modal Footer | `/settings#notifications` | `/settings` | `SettingsPage.tsx:123` (Ignores hash) | **Defect Identified (P04-01)**: Mobile defaults to root menu instead of notifications tab. | PROPOSED FIX | NOT TESTED |

### Domain 2: Notification Popups & Host
- **Components:** `src/components/notifications/NotificationHost.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Popup Card Action Click | `a.url` (e.g. `/orders?po=...`, `/transfers/...`) | Declared Route | Respective destination page | Resolves via `notificationDestination(link, brand)`; catches error, displays toast, prevents navigation. | PASS | NOT TESTED |

### Domain 3: Dashboard Cards & Widgets
- **Components:** `src/pages/Dashboard.tsx`, `src/components/dashboard/DeskCards.tsx`, `src/components/dashboard/TodayPanel.tsx`, `src/components/dashboard/DeliveryRiskPanel.tsx`, `src/components/dashboard/DailySuggestions.tsx`, `src/pages/PhoneHome.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| StatTile: Received Today | `/movements` | `/movements` | `MovementsPage.tsx:90` | General ledger view. | PASS | NOT TESTED |
| StatTile: Pending PRs | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`params.get('filter')`) | Filters requests list to `pendingApproval`. | PASS | NOT TESTED |
| StatTile: Low Stock | `/products` | `/products` | `Products.tsx:1` | Filterable inventory catalog. | PASS | NOT TESTED |
| StatTile: Branch Transfers | `/issue` | `/issue` | `IssuePage.tsx:30` | Issue/Transfer keying screen. | PASS | NOT TESTED |
| StatTile: Stock Value | `/reports` | `/reports` | `Reports.tsx:1` | Inventory valuation and movement reports. | PASS | NOT TESTED |
| TodayPanel: Filter shortcut | `/calendar?filter=${filter}` | `/calendar` | `CalendarPage.tsx:113` (`params.get('filter')`) | Selects agenda view and active filter. | PASS | NOT TESTED |
| TodayPanel: View Calendar | `/calendar` | `/calendar` | `CalendarPage.tsx:1` | Opens calendar month/agenda. | PASS | NOT TESTED |
| TodayPanel: Pick Event Item | `/calendar?item=${item.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens `ItemDrawer` for specified task/event ID. | PASS | NOT TESTED |
| DeliveryRiskPanel: New Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | Opens `RequestEditor` for new draft. | PASS | NOT TESTED |
| DeliveryRiskPanel: New Transfer | `/transfers/new` | `/transfers/new` | `TransferDetailPage.tsx:15` (`id === 'new'`) | Opens `TransferEditor` for new draft. | PASS | NOT TESTED |
| DeliveryRiskPanel: Open Order | `/orders?po=${poId}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Deep-links to PO viewing modal. | PASS | NOT TESTED |
| DeliveryRiskPanel: Open Supplier | `/suppliers?id=${supplierId}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Deep-links to supplier detail. Note: See defect P04-02 for dynamic URL changes. | PASS | NOT TESTED |
| DailySuggestions: Filled PR | `/requests/${filled.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Loads generated request ID. | PASS | NOT TESTED |
| DailySuggestions: Saved Transfer | `/transfers/${saved.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Loads generated transfer ID. | PASS | NOT TESTED |
| LowStockCard: Product Stock Card | `/products/${productId}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | Renders stock card; displays `EmptyState` if ID not found. | PASS | NOT TESTED |
| RecentActivityCard: Movements | `/movements` | `/movements` | `MovementsPage.tsx:90` | General movement ledger. | PASS | NOT TESTED |
| RecentActivityCard: Open PR | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens requested document. | PASS | NOT TESTED |
| RecentActivityCard: Open PO | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens PO modal for document ID. | PASS | NOT TESTED |
| PhoneHome: Receiving tile | `/orders` | `/orders` | `Orders.tsx:179` | Orders list. | PASS | NOT TESTED |
| PhoneHome: Low stock tile | `/products` | `/products` | `Products.tsx:1` | Product catalog. | PASS | NOT TESTED |
| PhoneHome: Overdue tile | `/calendar?filter=attention` | `/calendar` | `CalendarPage.tsx:113` (`filter='attention'`) | Agenda filtered to overdue items. | PASS | NOT TESTED |
| PhoneHome: Tasks tile | `/calendar?filter=tasks` | `/calendar` | `CalendarPage.tsx:113` (`filter='tasks'`) | Agenda filtered to tasks. | PASS | NOT TESTED |
| PhoneHome: Pending PR tile | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`filter='pendingApproval'`) | Requests filtered to awaiting approval. | PASS | NOT TESTED |

### Domain 4: Global Search & Document Lookup
- **Components:** `src/components/TopBar.tsx`, `src/lib/globalSearch.ts`, `src/services/documentLookup.ts`

| Search Group / Trigger | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Hit: Product | `/products/${p.id}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | If product deleted/wrong brand: `<EmptyState icon="search" title="ไม่พบสินค้า" />`. | PASS | NOT TESTED |
| Hit: Movement Document | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Queries document rows; if not found: empty list. | PASS | NOT TESTED |
| Hit: Supplier | `/suppliers?id=${s.id}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Opens detail drawer; displays `ไม่พบผู้ขายรายนี้แล้ว` if invalid ID. | PASS | NOT TESTED |
| Hit: Location / Warehouse | `/movements?location=${l.id}` | `/movements` | `MovementsPage.tsx:95` (`params.get('location')`) | Filters ledger to specified location. | PASS | NOT TESTED |
| Remote Lookup: PO Doc | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Asynchronously loads order via `resolvePoDeepLink`; toasts error if not found. | PASS | NOT TESTED |
| Remote Lookup: Movement Doc | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Same docFilter consumer. | PASS | NOT TESTED |

### Domain 5: Purchasing Workflows
- **Components:** `src/pages/Orders.tsx`, `src/pages/requests/PurchaseRequests.tsx`, `src/pages/requests/RequestPage.tsx`, `src/pages/requests/RequestEditor.tsx`, `src/pages/requests/RequestReview.tsx`, `src/pages/purchase/PurchaseBatches.tsx`, `src/pages/purchase/PurchaseBatchReview.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Orders list: Click Receive | `/receive?po=${o.id}` | `/receive` | `ReceivePage.tsx:137` (`params.get('po')`) | Pre-fills receipt draft with order ID. | PASS | NOT TESTED |
| Orders list: View linked PR | `/requests/${o.requestId}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens original request. | PASS | NOT TESTED |
| Orders list: Open Batches | `/purchase` | `/purchase` | `PurchaseBatches.tsx:1` | Purchase batch import overview. | PASS | NOT TESTED |
| PR list: Click Request Row | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | If missing: `<EmptyState icon="note" title="ไม่พบรายการขอสั่งซื้อ" />`. | PASS | NOT TESTED |
| PR list: New Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | Opens blank `RequestEditor`. | PASS | NOT TESTED |
| PR list: Import Sheet | `/requests/new?import=1` | `/requests/:id` | `RequestEditor.tsx:72` (`query.get('import') === '1'`) | Opens multi-day import dialog. | PASS | NOT TESTED |
| RequestEditor: Pre-filled query | `/requests/new?product=P&location=L&qty=Q` | `/requests/:id` | `RequestEditor.tsx:50-57` (`product`, `location`, `qty`) | Automatically populates first line item. | PASS | NOT TESTED |
| RequestReview: LINE Resume | `/requests/${id}?send=${poId}` | `/requests/:id` | `RequestReview.tsx:65` (`params.get(RESUME_PARAM)`) | Restores LINE send wizard state. | PASS | NOT TESTED |
| PurchaseBatchReview: Batch ID | `/purchase/${batch.id}` | `/purchase/:id` | `PurchaseBatchReview.tsx:54` (`useParams().id`) | If missing: `<EmptyState icon="upload" title="ไม่พบชุดนำเข้านี้" />`. | PASS | NOT TESTED |
| PurchaseBatchReview: Back button | `/purchase` | `/purchase` | `PurchaseBatches.tsx:1` | Returns to batch list. | PASS | NOT TESTED |

### Domain 6: Stock & Inventory Management
- **Components:** `src/pages/Products.tsx`, `src/pages/StockCardPage.tsx`, `src/pages/Receive.tsx`, `src/pages/Issue.tsx`, `src/pages/Adjust.tsx`, `src/pages/counts/MonthlyCountsPage.tsx`, `src/pages/counts/MonthlyCountSheet.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Product Row: View Stock Card | `/products/${p.id}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | Displays full balance & ledger; safe EmptyState on bad ID. | PASS | NOT TESTED |
| Receive Screen: View Doc | `/movements?doc=${done.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Deep-links to filed receipt movements. | PASS | NOT TESTED |
| Receive Screen: Back to History | `/movements` | `/movements` | `MovementsPage.tsx:90` | General movements ledger. | PASS | NOT TESTED |
| Issue: POS mode switch | `/issue?mode=pos` | `/issue` | `IssuePage.tsx:36` (`params.get('mode') === 'pos'`) | Opens POS sales import card. | PASS | NOT TESTED |
| MonthlyCountSheet: Sheet ID | `/counts/${sheet.id}` | `/counts/:id` | `MonthlyCountSheet.tsx:53` (`useParams().id`) | If missing: `<AlertBanner>ไม่พบใบนับนี้</AlertBanner>`. | PASS | NOT TESTED |
| MonthlyCountSheet: Back to list | `/counts` | `/counts` | `MonthlyCountsPage.tsx:1` | Returns to counts list. | PASS | NOT TESTED |

### Domain 7: Logistics & Transfers
- **Components:** `src/pages/transfers/TransfersPage.tsx`, `src/pages/transfers/TransfersTodayPage.tsx`, `src/pages/transfers/TransferDetailPage.tsx`, `src/pages/transfers/TransferReceivePage.tsx`, `src/pages/transfers/TransferEditor.tsx`, `src/pages/transfers/TransferDetailView.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Transfers: Today Delivery Sheet | `/transfers/today` | `/transfers/today` | `TransfersTodayPage.tsx:1` | Dispatches for today's deliveries. | PASS | NOT TESTED |
| Transfers: New Transfer | `/transfers/new` | `/transfers/new` | `TransferDetailPage.tsx:15` (`id === 'new'`) | Creates new transfer draft in editor. | PASS | NOT TESTED |
| Transfers: Click Transfer Row | `/transfers/${tr.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | If missing: `<EmptyState icon="swap" title="ไม่พบเอกสารโอนสินค้า" />`. | PASS | NOT TESTED |
| Transfers: Filter Status Query | `/transfers?status=${status}` | `/transfers` | `TransfersPage.tsx:49` (`params.get('status')`) | Filters list by transfer status. | PASS | NOT TESTED |
| TransfersToday: Receive Button | `/transfers/${tr.id}/receive` | `/transfers/:id/receive` | `TransferReceivePage.tsx:46` (`useParams().id`) | Opens receiving checklist; safe error if missing. | PASS | NOT TESTED |
| TransferDetailView: Receive Button | `/transfers/${tr.id}/receive` | `/transfers/:id/receive` | `TransferReceivePage.tsx:46` (`useParams().id`) | Same receiving entry. | PASS | NOT TESTED |
| TransferDetailView: Parent Leg | `/transfers/${parentId}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Navigates to parent transfer document. | PASS | NOT TESTED |
| TransferDetailView: Linked Leg | `/transfers/${l.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Navigates to branch leg transfer. | PASS | NOT TESTED |
| TransferDetailView: Back to list | `/transfers` | `/transfers` | `TransfersPage.tsx:1` | Returns to transfer list. | PASS | NOT TESTED |
| TransferReceive: Back to detail | `/transfers/${tr.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Returns to detail view after check or cancel. | PASS | NOT TESTED |

### Domain 8: Suppliers
- **Components:** `src/pages/Suppliers.tsx`, `src/pages/suppliers/SupplierPerformance.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Suppliers: Deep Link to Detail | `/suppliers?id=${sup.id}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Opens supplier master-detail drawer. | PASS (mount) | NOT TESTED |
| Suppliers: Performance report | `/suppliers/performance` | `/suppliers/performance` | `SupplierPerformancePage.tsx:1` | Supplier fulfillment analytics. | PASS | NOT TESTED |

### Domain 9: Calendar
- **Components:** `src/pages/calendar/CalendarPage.tsx`, `src/pages/calendar/ItemDrawer.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Agenda: Pick Event Item | `/calendar?item=${item.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens drawer for event ID. | PASS | NOT TESTED |
| ItemDrawer: Open Order | `/orders?po=${item.sourceId}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Deep-links to PO. | PASS | NOT TESTED |
| ItemDrawer: Receive Goods | `/receive?po=${item.sourceId}` | `/receive` | `ReceivePage.tsx:137` (`params.get('po')`) | Opens receipt draft. | PASS | NOT TESTED |
| ItemDrawer: Open Request | `/requests/${item.sourceId}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens PR detail. | PASS | NOT TESTED |
| ItemDrawer: Open Suppliers | `/suppliers` | `/suppliers` | `Suppliers.tsx:1` | Opens supplier list. | PASS | NOT TESTED |
| ItemDrawer: Reorder Line | `/requests/new?product=P&location=L&qty=Q` | `/requests/:id` | `RequestEditor.tsx:50-57` | Pre-fills new request line. | PASS | NOT TESTED |
| ItemDrawer: Stock Card | `/movements?product=P&location=L` | `/movements` | `MovementsPage.tsx:94-95` | Pre-filters product & location. | PASS | NOT TESTED |

### Domain 10: History & Activity Log
- **Components:** `src/pages/Movements.tsx`, `src/lib/activityLog.ts`, `src/lib/sidebarLive.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Activity Log: Movement entry | `/movements?product=${m.productId}` | `/movements` | `MovementsPage.tsx:94` (`params.get('product')`) | Pre-selects product in history ledger. | PASS | NOT TESTED |
| Activity Log: Order entry | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens order modal. | PASS | NOT TESTED |
| Activity Log: Request entry | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens request. | PASS | NOT TESTED |
| Activity Log: Task entry | `/calendar?item=${e.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens calendar item drawer. | PASS | NOT TESTED |
| Sidebar Live: Movement entry | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Filters to document. | PASS | NOT TESTED |
| Sidebar Live: Order entry | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens order. | PASS | NOT TESTED |

### Domain 11: Approvals
- **Components:** `src/pages/requests/PurchaseRequests.tsx`, `src/pages/transfers/TransfersPage.tsx`, `src/pages/Orders.tsx`, `src/lib/dailyDigest.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Daily Digest: Pending PRs | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`filter='pendingApproval'`) | Filters PR table to pending approval. | PASS | NOT TESTED |
| Daily Digest: Pending Transfers | `/transfers?status=pendingApproval` | `/transfers` | `TransfersPage.tsx:49` (`params.get('status')`) | Filters transfer table to pending approval. | PASS | NOT TESTED |
| Orders: Date Pending Approval | `/orders` (tab `datePending`) | `/orders` | `Orders.tsx` / `orders/presentation.ts:61` | Shows supplier date changes awaiting approval. | PASS | NOT TESTED |

### Domain 12: Quick Actions & Action Sheet
- **Components:** `src/components/nav/navItems.ts`, `src/components/nav/ActionSheet.tsx`, `src/components/dashboard/DeskCards.tsx:QuickMenuCard`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Quick Action: Receive | `/receive` | `/receive` | `ReceivePage.tsx:1` | Goods receipt. | PASS | NOT TESTED |
| Quick Action: Issue / Transfer | `/issue` | `/issue` | `IssuePage.tsx:1` | Issue and transfer. | PASS | NOT TESTED |
| Quick Action: Adjust | `/adjust` | `/adjust` | `AdjustPage.tsx:1` | Stock adjustment. | PASS | NOT TESTED |
| Quick Action: Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | New purchase request. | PASS | NOT TESTED |
| Quick Action: Manager Order | `/orders?new=1` | `/orders` | `Orders.tsx:179` (`params.get('new')`) | Creates new order. | PASS | NOT TESTED |
| Import Targets: Receive File | `/receive?import=1` | `/receive` | `ReceivePage.tsx:133` (`params.get('import') === '1'`) | Sets mode to manual. | PASS | NOT TESTED |
| Import Targets: Request File | `/requests/new?fileImport=1` | `/requests/:id` | `RequestEditor.tsx:73` (`query.get('fileImport') === '1'`) | Opens file import modal. | PASS | NOT TESTED |
| Import Targets: Company Order | `/requests/new?import=1` | `/requests/:id` | `RequestEditor.tsx:72` (`query.get('import') === '1'`) | Opens multi-day order sheet import. | PASS | NOT TESTED |
| Import Targets: Purchase Batch | `/purchase/import` | `/purchase/import` | `PurchaseImportPage.tsx:1` | Excel supplier batch creation. | PASS | NOT TESTED |
| Import Targets: Transfer File | `/issue?import=1` | `/issue` | `IssuePage.tsx:35` | Note: Handled by line-builder, see Defect P04-03. | PASS (Route) | NOT TESTED |
| Import Targets: POS Sales | `/issue?mode=pos` | `/issue` | `IssuePage.tsx:36` (`params.get('mode') === 'pos'`) | Switches to POS mode. | PASS | NOT TESTED |
| Import Targets: Adjust File | `/adjust?import=1` | `/adjust` | `AdjustPage.tsx:96` (`location.search:import`) | Opens adjust import straight away. | PASS | NOT TESTED |
| Import Targets: Monthly Count | `/counts` | `/counts` | `MonthlyCountsPage.tsx:1` | Opens monthly count overview. | PASS | NOT TESTED |
| Import Targets: Base Catalog | `/import` | `/import` | `ImportPage.tsx:1` | Admin product master import. | PASS | NOT TESTED |

### Domain 13: Mobile Navigation & Shell
- **Components:** `src/components/nav/BottomTabBar.tsx`, `src/pages/More.tsx`, `src/brand/useBrandSwitch.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Static Contract Status | Live Rendered E2E Status |
|---|---|---|---|---|---|---|
| Tab 1: Home | `/` | `/` | `DashboardPage.tsx` / `PhoneHome.tsx` | Active highlight when `pathname === '/'`. | PASS | NOT TESTED |
| Tab 2: Stock | `/products` | `/products` | `ProductsPage.tsx` | Active highlight for `/products` and sub-routes. | PASS | NOT TESTED |
| Tab 3: History | `/movements` | `/movements` | `MovementsPage.tsx` | Active highlight for `/movements`. | PASS | NOT TESTED |
| Tab 4: More | `/more` | `/more` | `MorePage.tsx` | Active highlight via `isMoreRoute()`. | PASS | NOT TESTED |
| More: Settings links | `/settings` | `/settings` | `SettingsPage.tsx` | Opens phone settings menu. | PASS | NOT TESTED |
| Brand Switcher: Switch Brand | `/` | `/` | `useBrandSwitch.ts:84` (`navigate('/')`) | Intentional reset to Home to prevent cross-brand leakage. | PASS | NOT TESTED |

---

## 5. Concrete Source Fix Proposals (Deferred to MAIN)

As specified by the R72 protocol, R72 Agent 04 is strictly scoped to test contracts and navigation audit. Source code modifications are deferred to MAIN for bounded implementation.

### Proposal 1 (P04-01): Fix notification settings anchor in `NotificationBell.tsx`
- **File & Line:** `src/components/notifications/NotificationBell.tsx:202`
- **Issue:** `SettingsPage.tsx:123` inspects route param `section`, not the URL hash. When a mobile user clicks "ตั้งค่าการแจ้งเตือน", `navigate('/settings#notifications')` causes `section` to evaluate to `undefined`, landing on the general settings root menu instead of the notification preferences tab.
- **Proposed Diff for MAIN:**
  ```tsx
  // src/components/notifications/NotificationBell.tsx:202
  - navigate('/settings#notifications')
  + navigate('/settings/notifications')
  ```

### Proposal 2 (P04-02): Listen for reactive search param changes in `Suppliers.tsx`
- **File & Line:** `src/pages/Suppliers.tsx:128, 134`
- **Issue:** `selectedId` is initialized once from `location.search` during component mount. If the user is already on `/suppliers` and triggers a navigation (e.g. from notification or search) with `?id=sup-123`, the state does not update.
- **Proposed Diff for MAIN:**
  ```tsx
  // src/pages/Suppliers.tsx:128
  + const [searchParams] = useSearchParams()
  + const deepLinkedId = searchParams.get('id')
  + useEffect(() => {
  +   if (deepLinkedId) {
  +     setSelectedId(deepLinkedId)
  +     setSheetOpen(true)
  +   }
  + }, [deepLinkedId])
  ```

### Proposal 3 (P04-03): Handle `?import=1` parameter in `Issue.tsx`
- **File & Line:** `src/pages/Issue.tsx:35`
- **Issue:** `QuickMenuCard` generates `/issue?import=1`, but `IssuePage` only checks `params.get('mode') === 'pos'`.
- **Proposed Diff for MAIN:** Pass `importMode={params.get('import') === '1'}` down to `LineBuilder` to trigger import drawer opening upon mount.
