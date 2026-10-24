# R72 AGENT04 Navigation Contract Matrix & Audit Report

## 1. Execution & Environment Metadata

- **Agent Role:** R72 Agent 04 — Broader Navigation Contract & Route Audit
- **Provider:** opencode / 9router
- **Model:** `9router/gemini-3.8-flash-high` (variant: high)
- **Worktree:** `C:\Users\Yutthachai\.t3\worktrees\PZM-LLP-Stock-2026\t3-5e83e1f2`
- **Branch:** `r72/agent04-navigation-contract`
- **Baseline Commit:** `1651548aef5337d7caf786a081aefd7ee9a19a9a` (PR55)
- **Authority Route Reference:** `src/App.tsx` (32 declared routes + catch-all `*` redirecting to `/`)

---

## 2. Route Authority Table (`src/App.tsx`)

Every destination route in this application is declared in `src/App.tsx` lines 126–158. Any path not matching one of these 32 route patterns falls through to `<Route path="*" element={<Navigate to="/" replace />} />`.

| # | Route Pattern | Target Component | File Location |
|---|---|---|---|
| 1 | `/` | `DashboardPage` | `src/pages/Dashboard.tsx` |
| 2 | `/products` | `ProductsPage` | `src/pages/Products.tsx` |
| 3 | `/products/:id/card` | `StockCardPage` | `src/pages/StockCardPage.tsx` |
| 4 | `/receive` | `ReceivePage` | `src/pages/Receive.tsx` |
| 5 | `/issue` | `IssuePage` | `src/pages/Issue.tsx` |
| 6 | `/recipes` | `RecipesPage` | `src/pages/recipes/RecipesPage.tsx` |
| 7 | `/transfers` | `TransfersPage` | `src/pages/transfers/TransfersPage.tsx` |
| 8 | `/transfers/today` | `TransfersTodayPage` | `src/pages/transfers/TransfersTodayPage.tsx` |
| 9 | `/transfers/new` | `TransferDetailPage` | `src/pages/transfers/TransferDetailPage.tsx` |
| 10 | `/transfers/:id/receive` | `TransferReceivePage` | `src/pages/transfers/TransferReceivePage.tsx` |
| 11 | `/transfers/:id` | `TransferDetailPage` | `src/pages/transfers/TransferDetailPage.tsx` |
| 12 | `/adjust` | `AdjustPage` | `src/pages/Adjust.tsx` |
| 13 | `/counts` | `MonthlyCountsPage` | `src/pages/counts/MonthlyCountsPage.tsx` |
| 14 | `/counts/:id` | `MonthlyCountSheet` | `src/pages/counts/MonthlyCountSheet.tsx` |
| 15 | `/movements` | `MovementsPage` | `src/pages/Movements.tsx` |
| 16 | `/reports` | `ReportsPage` | `src/pages/Reports.tsx` |
| 17 | `/import` | `ImportPage` | `src/pages/Import.tsx` |
| 18 | `/suppliers` | `SuppliersPage` | `src/pages/Suppliers.tsx` |
| 19 | `/suppliers/performance` | `SupplierPerformancePage` | `src/pages/suppliers/SupplierPerformance.tsx` |
| 20 | `/orders` | `OrdersPage` | `src/pages/Orders.tsx` |
| 21 | `/requests` | `PurchaseRequestsPage` | `src/pages/requests/PurchaseRequests.tsx` |
| 22 | `/requests/:id` | `RequestPage` | `src/pages/requests/RequestPage.tsx` |
| 23 | `/purchase` | `PurchaseBatchesPage` | `src/pages/purchase/PurchaseBatches.tsx` |
| 24 | `/purchase/import` | `PurchaseImportPage` | `src/pages/purchase/PurchaseImport.tsx` |
| 25 | `/purchase/:id` | `PurchaseBatchReviewPage` | `src/pages/purchase/PurchaseBatchReview.tsx` |
| 26 | `/calendar` | `CalendarPage` | `src/pages/calendar/CalendarPage.tsx` |
| 27 | `/announcements` | `AnnouncementsPage` | `src/pages/announcements/AnnouncementsPage.tsx` |
| 28 | `/announcements/new` | `AnnouncementPage` | `src/pages/announcements/AnnouncementPage.tsx` |
| 29 | `/announcements/:company/:id` | `AnnouncementPage` | `src/pages/announcements/AnnouncementPage.tsx` |
| 30 | `/settings` | `SettingsPage` | `src/pages/Settings.tsx` |
| 31 | `/settings/:section` | `SettingsPage` | `src/pages/Settings.tsx` |
| 32 | `/more` | `MorePage` | `src/pages/More.tsx` |
| * | `*` (Catch-all) | `Navigate to="/"` | Redirects to Dashboard fallback |

---

## 3. Audited Navigation Areas & Comprehensive Matrix

Every clickable element, card, menu item, and deep link generator across all 13 domains was audited. The table below lists the generator source, trigger, generated URL, matched route, destination query/param consumer (with exact file:line), and brand/error handling behavior.

### Domain 1: Bell & Notifications
- **Components:** `src/components/notifications/NotificationBell.tsx`, `src/services/notifications.ts`
- **Resolver Policy:** Delegated to `notificationDestination(link, brand)` owned by Agent 01. No local modifications.

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Click Notification Item (Transfer) | `/transfers/:id` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Scoped brand existence check (`notifications.ts:29`); throws `ไม่พบเอกสารโอนสินค้า` if missing. | PASS |
| Click Legacy Stored Transfer Link | `/logistics/:id` | Canonicalized to `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Normalizes legacy prefix before navigation; rejects multi-brand leaks. | PASS |
| Click Settings Shortcut in Bell Header | `/settings/notifications` | `/settings/:section` | `SettingsPage.tsx:123` (`useParams().section`) | Section resolves to `notifications`. | PASS |
| Click "ตั้งค่าการแจ้งเตือน" at Modal Footer | `/settings#notifications` | `/settings` | `SettingsPage.tsx:123` (Ignores hash) | **Defect Identified (P04-01)**: Mobile defaults to root menu instead of notifications tab. | PROPOSED FIX |

### Domain 2: Notification Popups & Host
- **Components:** `src/components/notifications/NotificationHost.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Popup Card Action Click | `a.url` (e.g. `/orders?po=...`, `/transfers/...`) | Declared Route | Respective destination page | Resolves via `notificationDestination(link, brand)`; catches error, displays toast, prevents navigation. | PASS |

### Domain 3: Dashboard Cards & Widgets
- **Components:** `src/pages/Dashboard.tsx`, `src/components/dashboard/DeskCards.tsx`, `src/components/dashboard/TodayPanel.tsx`, `src/components/dashboard/DeliveryRiskPanel.tsx`, `src/components/dashboard/DailySuggestions.tsx`, `src/pages/PhoneHome.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| StatTile: Received Today | `/movements` | `/movements` | `MovementsPage.tsx:90` | General ledger view. | PASS |
| StatTile: Pending PRs | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`params.get('filter')`) | Filters requests list to `pendingApproval`. | PASS |
| StatTile: Low Stock | `/products` | `/products` | `Products.tsx:1` | Filterable inventory catalog. | PASS |
| StatTile: Branch Transfers | `/issue` | `/issue` | `IssuePage.tsx:30` | Issue/Transfer keying screen. | PASS |
| StatTile: Stock Value | `/reports` | `/reports` | `Reports.tsx:1` | Inventory valuation and movement reports. | PASS |
| TodayPanel: Filter shortcut | `/calendar?filter=${filter}` | `/calendar` | `CalendarPage.tsx:113` (`params.get('filter')`) | Selects agenda view and active filter. | PASS |
| TodayPanel: View Calendar | `/calendar` | `/calendar` | `CalendarPage.tsx:1` | Opens calendar month/agenda. | PASS |
| TodayPanel: Pick Event Item | `/calendar?item=${item.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens `ItemDrawer` for specified task/event ID. | PASS |
| DeliveryRiskPanel: New Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | Opens `RequestEditor` for new draft. | PASS |
| DeliveryRiskPanel: New Transfer | `/transfers/new` | `/transfers/new` | `TransferDetailPage.tsx:15` (`id === 'new'`) | Opens `TransferEditor` for new draft. | PASS |
| DeliveryRiskPanel: Open Order | `/orders?po=${poId}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Deep-links to PO viewing modal. | PASS |
| DeliveryRiskPanel: Open Supplier | `/suppliers?id=${supplierId}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Deep-links to supplier detail. Note: See defect P04-02 for dynamic URL changes. | PASS |
| DailySuggestions: Filled PR | `/requests/${filled.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Loads generated request ID. | PASS |
| DailySuggestions: Saved Transfer | `/transfers/${saved.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Loads generated transfer ID. | PASS |
| LowStockCard: Product Stock Card | `/products/${productId}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | Renders stock card; displays `EmptyState` if ID not found. | PASS |
| RecentActivityCard: Movements | `/movements` | `/movements` | `MovementsPage.tsx:90` | General movement ledger. | PASS |
| RecentActivityCard: Open PR | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens requested document. | PASS |
| RecentActivityCard: Open PO | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens PO modal for document ID. | PASS |
| PhoneHome: Receiving tile | `/orders` | `/orders` | `Orders.tsx:179` | Orders list. | PASS |
| PhoneHome: Low stock tile | `/products` | `/products` | `Products.tsx:1` | Product catalog. | PASS |
| PhoneHome: Overdue tile | `/calendar?filter=attention` | `/calendar` | `CalendarPage.tsx:113` (`filter='attention'`) | Agenda filtered to overdue items. | PASS |
| PhoneHome: Tasks tile | `/calendar?filter=tasks` | `/calendar` | `CalendarPage.tsx:113` (`filter='tasks'`) | Agenda filtered to tasks. | PASS |
| PhoneHome: Pending PR tile | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`filter='pendingApproval'`) | Requests filtered to awaiting approval. | PASS |

### Domain 4: Global Search & Document Lookup
- **Components:** `src/components/TopBar.tsx`, `src/lib/globalSearch.ts`, `src/services/documentLookup.ts`

| Search Group / Trigger | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Hit: Product | `/products/${p.id}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | If product deleted/wrong brand: `<EmptyState icon="search" title="ไม่พบสินค้า" />`. | PASS |
| Hit: Movement Document | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Queries document rows; if not found: empty list. | PASS |
| Hit: Supplier | `/suppliers?id=${s.id}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Opens detail drawer; displays `ไม่พบผู้ขายรายนี้แล้ว` if invalid ID. | PASS |
| Hit: Location / Warehouse | `/movements?location=${l.id}` | `/movements` | `MovementsPage.tsx:95` (`params.get('location')`) | Filters ledger to specified location. | PASS |
| Remote Lookup: PO Doc | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Asynchronously loads order via `resolvePoDeepLink`; toasts error if not found. | PASS |
| Remote Lookup: Movement Doc | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Same docFilter consumer. | PASS |

### Domain 5: Purchasing Workflows
- **Components:** `src/pages/Orders.tsx`, `src/pages/requests/PurchaseRequests.tsx`, `src/pages/requests/RequestPage.tsx`, `src/pages/requests/RequestEditor.tsx`, `src/pages/requests/RequestReview.tsx`, `src/pages/purchase/PurchaseBatches.tsx`, `src/pages/purchase/PurchaseBatchReview.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Orders list: Click Receive | `/receive?po=${o.id}` | `/receive` | `ReceivePage.tsx:137` (`params.get('po')`) | Pre-fills receipt draft with order ID. | PASS |
| Orders list: View linked PR | `/requests/${o.requestId}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens original request. | PASS |
| Orders list: Open Batches | `/purchase` | `/purchase` | `PurchaseBatches.tsx:1` | Purchase batch import overview. | PASS |
| PR list: Click Request Row | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | If missing: `<EmptyState icon="note" title="ไม่พบรายการขอสั่งซื้อ" />`. | PASS |
| PR list: New Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | Opens blank `RequestEditor`. | PASS |
| PR list: Import Sheet | `/requests/new?import=1` | `/requests/:id` | `RequestEditor.tsx:72` (`query.get('import') === '1'`) | Opens multi-day import dialog. | PASS |
| RequestEditor: Pre-filled query | `/requests/new?product=P&location=L&qty=Q` | `/requests/:id` | `RequestEditor.tsx:50-57` (`product`, `location`, `qty`) | Automatically populates first line item. | PASS |
| RequestReview: LINE Resume | `/requests/${id}?send=${poId}` | `/requests/:id` | `RequestReview.tsx:65` (`params.get(RESUME_PARAM)`) | Restores LINE send wizard state. | PASS |
| PurchaseBatchReview: Batch ID | `/purchase/${batch.id}` | `/purchase/:id` | `PurchaseBatchReview.tsx:54` (`useParams().id`) | If missing: `<EmptyState icon="upload" title="ไม่พบชุดนำเข้านี้" />`. | PASS |
| PurchaseBatchReview: Back button | `/purchase` | `/purchase` | `PurchaseBatches.tsx:1` | Returns to batch list. | PASS |

### Domain 6: Stock & Inventory Management
- **Components:** `src/pages/Products.tsx`, `src/pages/StockCardPage.tsx`, `src/pages/Receive.tsx`, `src/pages/Issue.tsx`, `src/pages/Adjust.tsx`, `src/pages/counts/MonthlyCountsPage.tsx`, `src/pages/counts/MonthlyCountSheet.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Product Row: View Stock Card | `/products/${p.id}/card` | `/products/:id/card` | `StockCardPage.tsx:39` (`useParams().id`) | Displays full balance & ledger; safe EmptyState on bad ID. | PASS |
| Receive Screen: View Doc | `/movements?doc=${done.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Deep-links to filed receipt movements. | PASS |
| Receive Screen: Back to History | `/movements` | `/movements` | `MovementsPage.tsx:90` | General movements ledger. | PASS |
| Issue: POS mode switch | `/issue?mode=pos` | `/issue` | `IssuePage.tsx:36` (`params.get('mode') === 'pos'`) | Opens POS sales import card. | PASS |
| MonthlyCountSheet: Sheet ID | `/counts/${sheet.id}` | `/counts/:id` | `MonthlyCountSheet.tsx:53` (`useParams().id`) | If missing: `<AlertBanner>ไม่พบใบนับนี้</AlertBanner>`. | PASS |
| MonthlyCountSheet: Back to list | `/counts` | `/counts` | `MonthlyCountsPage.tsx:1` | Returns to counts list. | PASS |

### Domain 7: Logistics & Transfers
- **Components:** `src/pages/transfers/TransfersPage.tsx`, `src/pages/transfers/TransfersTodayPage.tsx`, `src/pages/transfers/TransferDetailPage.tsx`, `src/pages/transfers/TransferReceivePage.tsx`, `src/pages/transfers/TransferEditor.tsx`, `src/pages/transfers/TransferDetailView.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Transfers: Today Delivery Sheet | `/transfers/today` | `/transfers/today` | `TransfersTodayPage.tsx:1` | Dispatches for today's deliveries. | PASS |
| Transfers: New Transfer | `/transfers/new` | `/transfers/new` | `TransferDetailPage.tsx:15` (`id === 'new'`) | Creates new transfer draft in editor. | PASS |
| Transfers: Click Transfer Row | `/transfers/${tr.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | If missing: `<EmptyState icon="swap" title="ไม่พบเอกสารโอนสินค้า" />`. | PASS |
| Transfers: Filter Status Query | `/transfers?status=${status}` | `/transfers` | `TransfersPage.tsx:49` (`params.get('status')`) | Filters list by transfer status. | PASS |
| TransfersToday: Receive Button | `/transfers/${tr.id}/receive` | `/transfers/:id/receive` | `TransferReceivePage.tsx:46` (`useParams().id`) | Opens receiving checklist; safe error if missing. | PASS |
| TransferDetailView: Receive Button | `/transfers/${tr.id}/receive` | `/transfers/:id/receive` | `TransferReceivePage.tsx:46` (`useParams().id`) | Same receiving entry. | PASS |
| TransferDetailView: Parent Leg | `/transfers/${parentId}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Navigates to parent transfer document. | PASS |
| TransferDetailView: Linked Leg | `/transfers/${l.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Navigates to branch leg transfer. | PASS |
| TransferDetailView: Back to list | `/transfers` | `/transfers` | `TransfersPage.tsx:1` | Returns to transfer list. | PASS |
| TransferReceive: Back to detail | `/transfers/${tr.id}` | `/transfers/:id` | `TransferDetailPage.tsx:15` (`useParams().id`) | Returns to detail view after check or cancel. | PASS |

### Domain 8: Suppliers
- **Components:** `src/pages/Suppliers.tsx`, `src/pages/suppliers/SupplierPerformance.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Suppliers: Deep Link to Detail | `/suppliers?id=${sup.id}` | `/suppliers` | `Suppliers.tsx:128` (`location.search:id`) | Opens supplier master-detail drawer. | PASS (mount) |
| Suppliers: Performance report | `/suppliers/performance` | `/suppliers/performance` | `SupplierPerformancePage.tsx:1` | Supplier fulfillment analytics. | PASS |

### Domain 9: Calendar
- **Components:** `src/pages/calendar/CalendarPage.tsx`, `src/pages/calendar/ItemDrawer.tsx`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Agenda: Pick Event Item | `/calendar?item=${item.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens drawer for event ID. | PASS |
| ItemDrawer: Open Order | `/orders?po=${item.sourceId}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Deep-links to PO. | PASS |
| ItemDrawer: Receive Goods | `/receive?po=${item.sourceId}` | `/receive` | `ReceivePage.tsx:137` (`params.get('po')`) | Opens receipt draft. | PASS |
| ItemDrawer: Open Request | `/requests/${item.sourceId}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens PR detail. | PASS |
| ItemDrawer: Open Suppliers | `/suppliers` | `/suppliers` | `Suppliers.tsx:1` | Opens supplier list. | PASS |
| ItemDrawer: Reorder Line | `/requests/new?product=P&location=L&qty=Q` | `/requests/:id` | `RequestEditor.tsx:50-57` | Pre-fills new request line. | PASS |
| ItemDrawer: Stock Card | `/movements?product=P&location=L` | `/movements` | `MovementsPage.tsx:94-95` | Pre-filters product & location. | PASS |

### Domain 10: History & Activity Log
- **Components:** `src/pages/Movements.tsx`, `src/lib/activityLog.ts`, `src/lib/sidebarLive.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Activity Log: Movement entry | `/movements?product=${m.productId}` | `/movements` | `MovementsPage.tsx:94` (`params.get('product')`) | Pre-selects product in history ledger. | PASS |
| Activity Log: Order entry | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens order modal. | PASS |
| Activity Log: Request entry | `/requests/${r.id}` | `/requests/:id` | `RequestPage.tsx:20` (`useParams().id`) | Opens request. | PASS |
| Activity Log: Task entry | `/calendar?item=${e.id}` | `/calendar` | `CalendarPage.tsx:114` (`params.get('item')`) | Opens calendar item drawer. | PASS |
| Sidebar Live: Movement entry | `/movements?doc=${m.docNo}` | `/movements` | `MovementsPage.tsx:97` (`params.get('doc')`) | Filters to document. | PASS |
| Sidebar Live: Order entry | `/orders?po=${o.id}` | `/orders` | `Orders.tsx:252` (`params.get('po')`) | Opens order. | PASS |

### Domain 11: Approvals
- **Components:** `src/pages/requests/PurchaseRequests.tsx`, `src/pages/transfers/TransfersPage.tsx`, `src/pages/Orders.tsx`, `src/lib/dailyDigest.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Daily Digest: Pending PRs | `/requests?filter=pendingApproval` | `/requests` | `PurchaseRequests.tsx:82` (`filter='pendingApproval'`) | Filters PR table to pending approval. | PASS |
| Daily Digest: Pending Transfers | `/transfers?status=pendingApproval` | `/transfers` | `TransfersPage.tsx:49` (`params.get('status')`) | Filters transfer table to pending approval. | PASS |
| Orders: Date Pending Approval | `/orders` (tab `datePending`) | `/orders` | `Orders.tsx` / `orders/presentation.ts:61` | Shows supplier date changes awaiting approval. | PASS |

### Domain 12: Quick Actions & Action Sheet
- **Components:** `src/components/nav/navItems.ts`, `src/components/nav/ActionSheet.tsx`, `src/components/dashboard/DeskCards.tsx:QuickMenuCard`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Quick Action: Receive | `/receive` | `/receive` | `ReceivePage.tsx:1` | Goods receipt. | PASS |
| Quick Action: Issue / Transfer | `/issue` | `/issue` | `IssuePage.tsx:1` | Issue and transfer. | PASS |
| Quick Action: Adjust | `/adjust` | `/adjust` | `AdjustPage.tsx:1` | Stock adjustment. | PASS |
| Quick Action: Request | `/requests/new` | `/requests/:id` | `RequestPage.tsx:20` (`id === 'new'`) | New purchase request. | PASS |
| Quick Action: Manager Order | `/orders?new=1` | `/orders` | `Orders.tsx:179` (`params.get('new')`) | Creates new order. | PASS |
| Import Targets: Receive File | `/receive?import=1` | `/receive` | `ReceivePage.tsx:133` (`params.get('import') === '1'`) | Sets mode to manual. | PASS |
| Import Targets: Request File | `/requests/new?fileImport=1` | `/requests/:id` | `RequestEditor.tsx:73` (`query.get('fileImport') === '1'`) | Opens file import modal. | PASS |
| Import Targets: Company Order | `/requests/new?import=1` | `/requests/:id` | `RequestEditor.tsx:72` (`query.get('import') === '1'`) | Opens multi-day order sheet import. | PASS |
| Import Targets: Purchase Batch | `/purchase/import` | `/purchase/import` | `PurchaseImportPage.tsx:1` | Excel supplier batch creation. | PASS |
| Import Targets: Transfer File | `/issue?import=1` | `/issue` | `IssuePage.tsx:35` | Note: Handled by line-builder, see Defect P04-03. | PASS (Route) |
| Import Targets: POS Sales | `/issue?mode=pos` | `/issue` | `IssuePage.tsx:36` (`params.get('mode') === 'pos'`) | Switches to POS mode. | PASS |
| Import Targets: Adjust File | `/adjust?import=1` | `/adjust` | `AdjustPage.tsx:96` (`location.search:import`) | Opens adjust import straight away. | PASS |
| Import Targets: Monthly Count | `/counts` | `/counts` | `MonthlyCountsPage.tsx:1` | Opens monthly count overview. | PASS |
| Import Targets: Base Catalog | `/import` | `/import` | `ImportPage.tsx:1` | Admin product master import. | PASS |

### Domain 13: Mobile Navigation & Shell
- **Components:** `src/components/nav/BottomTabBar.tsx`, `src/pages/More.tsx`, `src/brand/useBrandSwitch.ts`

| Trigger / Action | Generated Link | Route Match | Query / Param Consumer File:Line | Safe Error / Brand Guard | Status |
|---|---|---|---|---|---|
| Tab 1: Home | `/` | `/` | `DashboardPage.tsx` / `PhoneHome.tsx` | Active highlight when `pathname === '/'`. | PASS |
| Tab 2: Stock | `/products` | `/products` | `ProductsPage.tsx` | Active highlight for `/products` and sub-routes. | PASS |
| Tab 3: History | `/movements` | `/movements` | `MovementsPage.tsx` | Active highlight for `/movements`. | PASS |
| Tab 4: More | `/more` | `/more` | `MorePage.tsx` | Active highlight via `isMoreRoute()`. | PASS |
| More: Settings links | `/settings` | `/settings` | `SettingsPage.tsx` | Opens phone settings menu. | PASS |
| Brand Switcher: Switch Brand | `/` | `/` | `useBrandSwitch.ts:84` (`navigate('/')`) | Intentional reset to Home to prevent cross-brand leakage. | PASS |

---

## 4. Gaps Discovered & Source Fix Proposals for MAIN

As required by the R72 protocol, R72 Agent 04 owns test contracts and audit only. These three concrete defects were discovered during code audit and contract verification, with exact reproductions provided below for MAIN implementation.

### Proposal 1: Fix notification settings anchor in `NotificationBell.tsx`
- **Location:** `src/components/notifications/NotificationBell.tsx:202`
- **Current Behavior:**
  ```tsx
  onClick={() => {
    setOpen(false)
    navigate('/settings#notifications')
  }}
  ```
- **Issue:** `SettingsPage.tsx` checks `useParams<{ section?: string }>()`, which parses pathname segments (e.g. `/settings/notifications`), not URL hash fragments (`#notifications`). On phone viewports where `desktop === false`, `section` evaluates to `undefined`, so clicking "ตั้งค่าการแจ้งเตือน" lands on the top-level settings menu rather than opening `NotificationPrefsSection`.
- **Proposed Fix for MAIN:**
  ```tsx
  // src/components/notifications/NotificationBell.tsx:202
  - navigate('/settings#notifications')
  + navigate('/settings/notifications')
  ```

### Proposal 2: Listen for reactive search param changes in `Suppliers.tsx`
- **Location:** `src/pages/Suppliers.tsx:128, 134`
- **Current Behavior:**
  ```tsx
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('id'))
  const [sheetOpen, setSheetOpen] = useState(() => !!new URLSearchParams(location.search).get('id'))
  ```
- **Issue:** `selectedId` is only read once during initial component mount from `window.location.search`. If a user is already on `/suppliers` and clicks a supplier notification or global search result (`/suppliers?id=sup-001`), the page address changes in the browser, but `SuppliersPage` does not re-render or select the new supplier.
- **Proposed Fix for MAIN:**
  Adopt `useSearchParams()` from `react-router-dom` (as done in `Movements.tsx:90-95`):
  ```tsx
  const [searchParams] = useSearchParams()
  const deepLinkedId = searchParams.get('id')
  useEffect(() => {
    if (deepLinkedId) {
      setSelectedId(deepLinkedId)
      setSheetOpen(true)
    }
  }, [deepLinkedId])
  ```

### Proposal 3: Handle `?import=1` parameter in `Issue.tsx`
- **Location:** `src/pages/Issue.tsx:35`
- **Current Behavior:** `QuickMenuCard` offers `{ to: '/issue?import=1', label: 'โอน / เบิกสินค้า' }`, but `IssuePage` only inspects `params.get('mode') === 'pos'`.
- **Proposed Fix for MAIN:** Pass `import=1` flag to the child `LineBuilder` to automatically pop open the line import dialog when arriving with `?import=1`.
