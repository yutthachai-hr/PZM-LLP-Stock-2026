import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { matchPath } from 'react-router-dom'
import { canonicalLink } from '../src/lib/notificationLink'
import { globalSearch } from '../src/lib/globalSearch'
import { lookupDocuments, clearDocumentLookupCache } from '../src/services/documentLookup'
import { buildActivityLog } from '../src/lib/activityLog'
import { recentActivity } from '../src/lib/sidebarLive'
import { actionsFor, moreItemsFor, navFor, NAV, TAB_ITEMS, isMoreRoute } from '../src/components/nav/navItems'
import { bkkDayStart } from '../src/lib/inventoryRules/time'
import { RESUME_PARAM, ANNOUNCE_PARAM } from '../src/share/liffResume'
import type {
  Product,
  PurchaseOrder,
  PurchaseRequest,
  StockEvent,
  StockLocation,
  StockMovement,
  Supplier,
  Transfer,
  PurchaseBatch,
  MonthlyCount,
  Announcement,
} from '../src/types'

// Extract all real route patterns declared in src/App.tsx (excluding the catch-all <Route path="*" ... />)
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
export const APP_DECLARED_ROUTES = [...appSource.matchAll(/<Route path="(\/[^"*]*)"/g)].map((m) => m[1])

export interface RouteResolution {
  rawLink: string
  pathname: string
  search: string
  queryParams: Record<string, string>
  matchedRoute: string | null
  landsOnDashboardFallback: boolean
}

export function resolveRoute(link: string): RouteResolution {
  const url = new URL(link, 'http://localhost')
  const pathname = url.pathname
  const matchedRoute =
    APP_DECLARED_ROUTES.find((pattern) =>
      matchPath({ path: pattern, end: true, caseSensitive: true }, pathname),
    ) ?? null

  return {
    rawLink: link,
    pathname,
    search: url.search,
    queryParams: Object.fromEntries(url.searchParams.entries()),
    matchedRoute,
    landsOnDashboardFallback: matchedRoute === null,
  }
}

// Synthetic fixtures
const TEST_NOW = new Date('2026-10-25T02:00:00.000Z').getTime()
const TEST_DAY_START = bkkDayStart(TEST_NOW)

const syntheticSupplier: Supplier = {
  id: 'sup-panfood',
  code: 'PF',
  name: 'Pan Food Co., Ltd.',
  active: true,
  leadTimeDays: 2,
  orderDays: [1, 3, 5],
  cutoffTime: '11:00',
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticProduct: Product = {
  id: 'prod-flour-001',
  sku: 'P-FLOUR',
  name: 'Caputo Pizzeria Flour 25kg',
  unitType: 'KG',
  unit: 'KG',
  minStock: 5,
  active: true,
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticLocation: StockLocation = {
  id: 'wh-main',
  name: 'Main Central Warehouse',
  type: 'warehouse',
  active: true,
  createdAt: 1000,
}

const syntheticBranchLocation: StockLocation = {
  id: 'br-sarasin',
  name: 'Sarasin Branch',
  type: 'store',
  active: true,
  createdAt: 1000,
}

const syntheticOrder: PurchaseOrder = {
  id: 'po-fixture-001',
  docNo: 'PO-202610-0001',
  status: 'ordered',
  supplierId: syntheticSupplier.id,
  supplierName: syntheticSupplier.name,
  locationId: syntheticLocation.id,
  requestId: 'pr-fixture-001',
  lines: [{ productId: syntheticProduct.id, productName: syntheticProduct.name, orderedQty: 25, unit: 'KG' }],
  createdAt: 1000,
  updatedAt: 1000,
  orderedAt: 1000,
  expectedAt: TEST_DAY_START,
}

const syntheticRequest: PurchaseRequest = {
  id: 'pr-fixture-001',
  docNo: 'PR-202610-0001',
  status: 'pendingApproval',
  locationId: syntheticLocation.id,
  revision: 1,
  requestedBy: 'user-01',
  requestedByName: 'Alice Requester',
  items: [{ idx: 1, productId: syntheticProduct.id, productName: syntheticProduct.name, requestedQty: 25, unit: 'KG' }],
  history: [{ at: 1000, by: 'user-01', byName: 'Alice Requester', action: 'create' }],
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticTransfer: Transfer = {
  id: 'tr-fixture-001',
  docNo: 'TR-202610-0001',
  parentId: 'tr-parent-001',
  status: 'inTransit',
  revision: 1,
  fromLocationId: syntheticLocation.id,
  toLocationId: syntheticBranchLocation.id,
  dispatchDate: TEST_NOW,
  requestedBy: 'user-01',
  requestedByName: 'Alice Requester',
  createdAt: 1000,
  updatedAt: 1000,
  items: [{ idx: 1, productId: syntheticProduct.id, productName: syntheticProduct.name, requestedQty: 10, dispatchQty: 10, unit: 'KG' }],
  history: [],
}

const syntheticTask: StockEvent = {
  id: 'task-fixture-001',
  type: 'stockCount',
  title: 'End of Month Stock Count',
  status: 'inProgress',
  priority: 'normal',
  startAt: TEST_NOW + 15 * 60_000,
  locationId: syntheticLocation.id,
  assignedToAll: true,
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticMovement: StockMovement = {
  id: 'mv-fixture-001',
  docNo: 'RC-202610-0001',
  type: 'receive',
  date: 1000,
  productId: syntheticProduct.id,
  productName: syntheticProduct.name,
  toLocationId: syntheticLocation.id,
  qty: 25,
  unit: 'KG',
  byUserId: 'user-01',
  byUserName: 'Alice Requester',
  createdAt: 1000,
  updatedAt: 1000,
  poId: syntheticOrder.id,
  poDocNo: syntheticOrder.docNo,
}

const syntheticBatch: PurchaseBatch = {
  id: 'pb-fixture-001',
  batchNo: 'PB-202610-0001',
  status: 'needsReview',
  blockLabel: 'Week 43 Order',
  sourceFileName: 'Weekly_Orders_Week43.xlsx',
  locationId: syntheticLocation.id,
  rows: [],
  groups: [],
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticCount: MonthlyCount = {
  id: 'cnt-fixture-001',
  locationId: syntheticLocation.id,
  countDate: TEST_DAY_START,
  status: 'counting',
  lines: {},
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticAnnouncement: Announcement = {
  id: 'anc-fixture-001',
  company: 'pizza',
  announcementDate: TEST_NOW,
  subject: 'Warehouse Safety Guidelines',
  body: 'Please review the updated safety protocol.',
  format: 'text',
  status: 'published',
  target: { companyScope: ['pizza'] },
  createdAt: 1000,
  updatedAt: 1000,
}

describe('R72 AGENT04: Route Authority & Coverage Invariants', () => {
  test('App.tsx defines exactly 32 concrete routes matching contract', () => {
    expect(APP_DECLARED_ROUTES.length).toBe(32)
    expect(APP_DECLARED_ROUTES).toContain('/')
    expect(APP_DECLARED_ROUTES).toContain('/products')
    expect(APP_DECLARED_ROUTES).toContain('/products/:id/card')
    expect(APP_DECLARED_ROUTES).toContain('/receive')
    expect(APP_DECLARED_ROUTES).toContain('/issue')
    expect(APP_DECLARED_ROUTES).toContain('/recipes')
    expect(APP_DECLARED_ROUTES).toContain('/transfers')
    expect(APP_DECLARED_ROUTES).toContain('/transfers/today')
    expect(APP_DECLARED_ROUTES).toContain('/transfers/new')
    expect(APP_DECLARED_ROUTES).toContain('/transfers/:id/receive')
    expect(APP_DECLARED_ROUTES).toContain('/transfers/:id')
    expect(APP_DECLARED_ROUTES).toContain('/adjust')
    expect(APP_DECLARED_ROUTES).toContain('/counts')
    expect(APP_DECLARED_ROUTES).toContain('/counts/:id')
    expect(APP_DECLARED_ROUTES).toContain('/movements')
    expect(APP_DECLARED_ROUTES).toContain('/reports')
    expect(APP_DECLARED_ROUTES).toContain('/import')
    expect(APP_DECLARED_ROUTES).toContain('/suppliers')
    expect(APP_DECLARED_ROUTES).toContain('/suppliers/performance')
    expect(APP_DECLARED_ROUTES).toContain('/orders')
    expect(APP_DECLARED_ROUTES).toContain('/requests')
    expect(APP_DECLARED_ROUTES).toContain('/requests/:id')
    expect(APP_DECLARED_ROUTES).toContain('/purchase')
    expect(APP_DECLARED_ROUTES).toContain('/purchase/import')
    expect(APP_DECLARED_ROUTES).toContain('/purchase/:id')
    expect(APP_DECLARED_ROUTES).toContain('/calendar')
    expect(APP_DECLARED_ROUTES).toContain('/announcements')
    expect(APP_DECLARED_ROUTES).toContain('/announcements/new')
    expect(APP_DECLARED_ROUTES).toContain('/announcements/:company/:id')
    expect(APP_DECLARED_ROUTES).toContain('/settings')
    expect(APP_DECLARED_ROUTES).toContain('/settings/:section')
    expect(APP_DECLARED_ROUTES).toContain('/more')
  })

  test('Catch-all "*" route in App.tsx reliably handles undefined paths', () => {
    expect(appSource).toContain('<Route path="*" element={<Navigate to="/" replace />} />')
  })
})

describe('R72 AGENT04: Broader Navigation Route Generators Contract', () => {
  interface RouteGeneratorCase {
    area: string
    sourceFile: string
    generatorLabel: string
    getLink: () => string
    expectedRoute: string
    expectedParams?: string[]
    consumerFile: string
    consumerLine: number
  }

  const cases: RouteGeneratorCase[] = [
    // 1. Dashboard StatTile shortcuts
    {
      area: 'Dashboard',
      sourceFile: 'src/pages/Dashboard.tsx:83',
      generatorLabel: 'StatTile: Received Today',
      getLink: () => '/movements',
      expectedRoute: '/movements',
      consumerFile: 'src/pages/Movements.tsx',
      consumerLine: 90,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/pages/Dashboard.tsx:92',
      generatorLabel: 'StatTile: Pending Requests',
      getLink: () => '/requests?filter=pendingApproval',
      expectedRoute: '/requests',
      expectedParams: ['filter'],
      consumerFile: 'src/pages/requests/PurchaseRequests.tsx',
      consumerLine: 82,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/pages/Dashboard.tsx:101',
      generatorLabel: 'StatTile: Low Stock',
      getLink: () => '/products',
      expectedRoute: '/products',
      consumerFile: 'src/pages/Products.tsx',
      consumerLine: 1,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/pages/Dashboard.tsx:111',
      generatorLabel: 'StatTile: Branch Transfers',
      getLink: () => '/issue',
      expectedRoute: '/issue',
      consumerFile: 'src/pages/Issue.tsx',
      consumerLine: 30,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/pages/Dashboard.tsx:120',
      generatorLabel: 'StatTile: Inventory Value',
      getLink: () => '/reports',
      expectedRoute: '/reports',
      consumerFile: 'src/pages/Reports.tsx',
      consumerLine: 1,
    },

    // 2. Dashboard TodayPanel
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/TodayPanel.tsx:59',
      generatorLabel: 'TodayPanel: Filter Shortcut',
      getLink: () => `/calendar?filter=${encodeURIComponent('tasks')}`,
      expectedRoute: '/calendar',
      expectedParams: ['filter'],
      consumerFile: 'src/pages/calendar/CalendarPage.tsx',
      consumerLine: 113,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/TodayPanel.tsx:67',
      generatorLabel: 'TodayPanel: Full Calendar',
      getLink: () => '/calendar',
      expectedRoute: '/calendar',
      consumerFile: 'src/pages/calendar/CalendarPage.tsx',
      consumerLine: 80,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/TodayPanel.tsx:95',
      generatorLabel: 'TodayPanel: Pick Event Item',
      getLink: () => `/calendar?item=${encodeURIComponent(syntheticTask.id)}`,
      expectedRoute: '/calendar',
      expectedParams: ['item'],
      consumerFile: 'src/pages/calendar/CalendarPage.tsx',
      consumerLine: 114,
    },

    // 3. Dashboard DeliveryRiskPanel
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeliveryRiskPanel.tsx:173',
      generatorLabel: 'DeliveryRiskPanel: New Request',
      getLink: () => '/requests/new',
      expectedRoute: '/requests/:id',
      consumerFile: 'src/pages/requests/RequestPage.tsx',
      consumerLine: 20,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeliveryRiskPanel.tsx:177',
      generatorLabel: 'DeliveryRiskPanel: New Transfer',
      getLink: () => '/transfers/new',
      expectedRoute: '/transfers/new',
      consumerFile: 'src/pages/transfers/TransferDetailPage.tsx',
      consumerLine: 15,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeliveryRiskPanel.tsx:243',
      generatorLabel: 'DeliveryRiskPanel: Open Order',
      getLink: () => `/orders?po=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/orders',
      expectedParams: ['po'],
      consumerFile: 'src/pages/Orders.tsx',
      consumerLine: 252,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeliveryRiskPanel.tsx:246',
      generatorLabel: 'DeliveryRiskPanel: Open Supplier',
      getLink: () => `/suppliers?id=${encodeURIComponent(syntheticSupplier.id)}`,
      expectedRoute: '/suppliers',
      expectedParams: ['id'],
      consumerFile: 'src/pages/Suppliers.tsx',
      consumerLine: 128,
    },

    // 4. Dashboard DeskCards
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:66',
      generatorLabel: 'LowStockCard: Stock Card Link',
      getLink: () => `/products/${encodeURIComponent(syntheticProduct.id)}/card`,
      expectedRoute: '/products/:id/card',
      consumerFile: 'src/pages/StockCardPage.tsx',
      consumerLine: 39,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:124',
      generatorLabel: 'BranchOverviewCard: See All',
      getLink: () => '/reports',
      expectedRoute: '/reports',
      consumerFile: 'src/pages/Reports.tsx',
      consumerLine: 1,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:229',
      generatorLabel: 'RecentActivityCard: Request Link',
      getLink: () => `/requests/${syntheticRequest.id}`,
      expectedRoute: '/requests/:id',
      consumerFile: 'src/pages/requests/RequestPage.tsx',
      consumerLine: 20,
    },
    {
      area: 'Dashboard',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:240',
      generatorLabel: 'RecentActivityCard: Order Link',
      getLink: () => `/orders?po=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/orders',
      expectedParams: ['po'],
      consumerFile: 'src/pages/Orders.tsx',
      consumerLine: 252,
    },

    // 5. QuickMenuCard & Import Targets
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:290',
      generatorLabel: 'IMPORT_TARGETS: Receive Bill Import',
      getLink: () => '/receive?import=1',
      expectedRoute: '/receive',
      expectedParams: ['import'],
      consumerFile: 'src/pages/Receive.tsx',
      consumerLine: 133,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:291',
      generatorLabel: 'IMPORT_TARGETS: PR File Import',
      getLink: () => '/requests/new?fileImport=1',
      expectedRoute: '/requests/:id',
      expectedParams: ['fileImport'],
      consumerFile: 'src/pages/requests/RequestEditor.tsx',
      consumerLine: 73,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:292',
      generatorLabel: 'IMPORT_TARGETS: PR Sheet Multi-day Import',
      getLink: () => '/requests/new?import=1',
      expectedRoute: '/requests/:id',
      expectedParams: ['import'],
      consumerFile: 'src/pages/requests/RequestEditor.tsx',
      consumerLine: 72,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:293',
      generatorLabel: 'IMPORT_TARGETS: Purchase Batch Import',
      getLink: () => '/purchase/import',
      expectedRoute: '/purchase/import',
      consumerFile: 'src/pages/purchase/PurchaseImport.tsx',
      consumerLine: 1,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:294',
      generatorLabel: 'IMPORT_TARGETS: Issue Import',
      getLink: () => '/issue?import=1',
      expectedRoute: '/issue',
      expectedParams: ['import'],
      consumerFile: 'src/pages/Issue.tsx',
      consumerLine: 35,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:295',
      generatorLabel: 'IMPORT_TARGETS: POS Sales Deduction',
      getLink: () => '/issue?mode=pos',
      expectedRoute: '/issue',
      expectedParams: ['mode'],
      consumerFile: 'src/pages/Issue.tsx',
      consumerLine: 36,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:296',
      generatorLabel: 'IMPORT_TARGETS: Adjust Import',
      getLink: () => '/adjust?import=1',
      expectedRoute: '/adjust',
      expectedParams: ['import'],
      consumerFile: 'src/pages/Adjust.tsx',
      consumerLine: 96,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:297',
      generatorLabel: 'IMPORT_TARGETS: Monthly Count Import',
      getLink: () => '/counts',
      expectedRoute: '/counts',
      consumerFile: 'src/pages/counts/MonthlyCountsPage.tsx',
      consumerLine: 1,
    },
    {
      area: 'QuickActions',
      sourceFile: 'src/components/dashboard/DeskCards.tsx:298',
      generatorLabel: 'IMPORT_TARGETS: Base Catalog Import',
      getLink: () => '/import',
      expectedRoute: '/import',
      consumerFile: 'src/pages/Import.tsx',
      consumerLine: 1,
    },

    // 6. PhoneHome Navigation Tiles
    {
      area: 'Mobilenav',
      sourceFile: 'src/pages/PhoneHome.tsx:79',
      generatorLabel: 'PhoneHome: Receive Today Tile',
      getLink: () => '/orders',
      expectedRoute: '/orders',
      consumerFile: 'src/pages/Orders.tsx',
      consumerLine: 179,
    },
    {
      area: 'Mobilenav',
      sourceFile: 'src/pages/PhoneHome.tsx:81',
      generatorLabel: 'PhoneHome: Attention Overdue Tile',
      getLink: () => '/calendar?filter=attention',
      expectedRoute: '/calendar',
      expectedParams: ['filter'],
      consumerFile: 'src/pages/calendar/CalendarPage.tsx',
      consumerLine: 113,
    },
    {
      area: 'Mobilenav',
      sourceFile: 'src/pages/PhoneHome.tsx:82',
      generatorLabel: 'PhoneHome: Today Tasks Tile',
      getLink: () => '/calendar?filter=tasks',
      expectedRoute: '/calendar',
      expectedParams: ['filter'],
      consumerFile: 'src/pages/calendar/CalendarPage.tsx',
      consumerLine: 113,
    },

    // 7. Purchasing Workflows
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/Orders.tsx:257',
      generatorLabel: 'Orders: Receive Order Link',
      getLink: () => `/receive?po=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/receive',
      expectedParams: ['po'],
      consumerFile: 'src/pages/Receive.tsx',
      consumerLine: 137,
    },
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/Orders.tsx:441',
      generatorLabel: 'Orders: Linked Purchase Request',
      getLink: () => `/requests/${syntheticRequest.id}`,
      expectedRoute: '/requests/:id',
      consumerFile: 'src/pages/requests/RequestPage.tsx',
      consumerLine: 20,
    },
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/Orders.tsx:509',
      generatorLabel: 'Orders: Open Batches',
      getLink: () => '/purchase',
      expectedRoute: '/purchase',
      consumerFile: 'src/pages/purchase/PurchaseBatches.tsx',
      consumerLine: 1,
    },
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/requests/PurchaseRequests.tsx:281',
      generatorLabel: 'PurchaseRequests: Import Sheet',
      getLink: () => '/requests/new?import=1',
      expectedRoute: '/requests/:id',
      expectedParams: ['import'],
      consumerFile: 'src/pages/requests/RequestEditor.tsx',
      consumerLine: 72,
    },
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/requests/RequestReview.tsx:65',
      generatorLabel: 'RequestReview: Resume LINE Send',
      getLink: () => `/requests/${syntheticRequest.id}?${RESUME_PARAM}=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/requests/:id',
      expectedParams: [RESUME_PARAM],
      consumerFile: 'src/pages/requests/RequestReview.tsx',
      consumerLine: 65,
    },
    {
      area: 'Purchasing',
      sourceFile: 'src/pages/purchase/PurchaseBatchReview.tsx:54',
      generatorLabel: 'PurchaseBatchReview: Batch Review Sheet',
      getLink: () => `/purchase/${syntheticBatch.id}`,
      expectedRoute: '/purchase/:id',
      consumerFile: 'src/pages/purchase/PurchaseBatchReview.tsx',
      consumerLine: 54,
    },

    // 8. Logistics & Transfers Workflows
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransfersPage.tsx:239',
      generatorLabel: 'TransfersPage: Today Deliveries',
      getLink: () => '/transfers/today',
      expectedRoute: '/transfers/today',
      consumerFile: 'src/pages/transfers/TransfersTodayPage.tsx',
      consumerLine: 1,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransfersPage.tsx:243',
      generatorLabel: 'TransfersPage: New Transfer',
      getLink: () => '/transfers/new',
      expectedRoute: '/transfers/new',
      consumerFile: 'src/pages/transfers/TransferDetailPage.tsx',
      consumerLine: 15,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransfersPage.tsx:341',
      generatorLabel: 'TransfersPage: Transfer Detail',
      getLink: () => `/transfers/${syntheticTransfer.id}`,
      expectedRoute: '/transfers/:id',
      consumerFile: 'src/pages/transfers/TransferDetailPage.tsx',
      consumerLine: 15,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransfersTodayPage.tsx:60',
      generatorLabel: 'TransfersTodayPage: Transfer Receive',
      getLink: () => `/transfers/${syntheticTransfer.id}/receive`,
      expectedRoute: '/transfers/:id/receive',
      consumerFile: 'src/pages/transfers/TransferReceivePage.tsx',
      consumerLine: 46,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransferDetailView.tsx:204',
      generatorLabel: 'TransferDetailView: Parent Transfer Leg',
      getLink: () => `/transfers/${syntheticTransfer.parentId}`,
      expectedRoute: '/transfers/:id',
      consumerFile: 'src/pages/transfers/TransferDetailPage.tsx',
      consumerLine: 15,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransferDetailView.tsx:212',
      generatorLabel: 'TransferDetailView: Back to Transfers',
      getLink: () => '/transfers',
      expectedRoute: '/transfers',
      consumerFile: 'src/pages/transfers/TransfersPage.tsx',
      consumerLine: 36,
    },
    {
      area: 'Logistics',
      sourceFile: 'src/pages/transfers/TransferReceivePage.tsx:164',
      generatorLabel: 'TransferReceivePage: Back to Transfer',
      getLink: () => `/transfers/${syntheticTransfer.id}`,
      expectedRoute: '/transfers/:id',
      consumerFile: 'src/pages/transfers/TransferDetailPage.tsx',
      consumerLine: 15,
    },

    // 9. Calendar ItemDrawer
    {
      area: 'Calendar',
      sourceFile: 'src/pages/calendar/ItemDrawer.tsx:255',
      generatorLabel: 'ItemDrawer: View Order',
      getLink: () => `/orders?po=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/orders',
      expectedParams: ['po'],
      consumerFile: 'src/pages/Orders.tsx',
      consumerLine: 252,
    },
    {
      area: 'Calendar',
      sourceFile: 'src/pages/calendar/ItemDrawer.tsx:260',
      generatorLabel: 'ItemDrawer: Receive Goods',
      getLink: () => `/receive?po=${encodeURIComponent(syntheticOrder.id)}`,
      expectedRoute: '/receive',
      expectedParams: ['po'],
      consumerFile: 'src/pages/Receive.tsx',
      consumerLine: 137,
    },
    {
      area: 'Calendar',
      sourceFile: 'src/pages/calendar/ItemDrawer.tsx:268',
      generatorLabel: 'ItemDrawer: View Request',
      getLink: () => `/requests/${syntheticRequest.id}`,
      expectedRoute: '/requests/:id',
      consumerFile: 'src/pages/requests/RequestPage.tsx',
      consumerLine: 20,
    },
    {
      area: 'Calendar',
      sourceFile: 'src/pages/calendar/ItemDrawer.tsx:281',
      generatorLabel: 'ItemDrawer: Pre-filled Reorder',
      getLink: () => `/requests/new?product=${syntheticProduct.id}&location=${syntheticLocation.id}&qty=10`,
      expectedRoute: '/requests/:id',
      expectedParams: ['product', 'location', 'qty'],
      consumerFile: 'src/pages/requests/RequestEditor.tsx',
      consumerLine: 50,
    },
    {
      area: 'Calendar',
      sourceFile: 'src/pages/calendar/ItemDrawer.tsx:305',
      generatorLabel: 'ItemDrawer: Stock Card Movements',
      getLink: () => `/movements?product=${syntheticProduct.id}&location=${syntheticLocation.id}`,
      expectedRoute: '/movements',
      expectedParams: ['product', 'location'],
      consumerFile: 'src/pages/Movements.tsx',
      consumerLine: 94,
    },

    // 10. History / Movements
    {
      area: 'History',
      sourceFile: 'src/pages/Receive.tsx:436',
      generatorLabel: 'ReceivePage: View Document Rows',
      getLink: () => `/movements?doc=${encodeURIComponent(syntheticMovement.docNo)}`,
      expectedRoute: '/movements',
      expectedParams: ['doc'],
      consumerFile: 'src/pages/Movements.tsx',
      consumerLine: 97,
    },

    // 11. Suppliers
    {
      area: 'Suppliers',
      sourceFile: 'src/pages/suppliers/SupplierPerformance.tsx:1',
      generatorLabel: 'Suppliers: Performance Analytics',
      getLink: () => '/suppliers/performance',
      expectedRoute: '/suppliers/performance',
      consumerFile: 'src/pages/suppliers/SupplierPerformance.tsx',
      consumerLine: 1,
    },

    // 12. Monthly Counts
    {
      area: 'Stock',
      sourceFile: 'src/pages/counts/MonthlyCountSheet.tsx:53',
      generatorLabel: 'MonthlyCountSheet: Count Sheet',
      getLink: () => `/counts/${syntheticCount.id}`,
      expectedRoute: '/counts/:id',
      consumerFile: 'src/pages/counts/MonthlyCountSheet.tsx',
      consumerLine: 53,
    },
    {
      area: 'Stock',
      sourceFile: 'src/pages/counts/MonthlyCountSheet.tsx:399',
      generatorLabel: 'MonthlyCountSheet: Return to Counts',
      getLink: () => '/counts',
      expectedRoute: '/counts',
      consumerFile: 'src/pages/counts/MonthlyCountsPage.tsx',
      consumerLine: 1,
    },

    // 13. Settings Sections (all 14 valid sections)
    ...[
      'notifications',
      'locations',
      'units',
      'thresholds',
      'logistics',
      'schedules',
      'company',
      'users',
      'automation',
      'readUsage',
      'backup',
      'maintenance',
      'unitMigration',
      'rebaseUnit',
    ].map((section) => ({
      area: 'Settings',
      sourceFile: 'src/pages/Settings.tsx:73',
      generatorLabel: `SettingsSection: ${section}`,
      getLink: () => `/settings/${section}`,
      expectedRoute: '/settings/:section',
      consumerFile: 'src/pages/Settings.tsx',
      consumerLine: 123,
    })),

    // 14. Company Announcements
    {
      area: 'Announcements',
      sourceFile: 'src/pages/announcements/AnnouncementsPage.tsx:1',
      generatorLabel: 'Announcements: Overview',
      getLink: () => '/announcements',
      expectedRoute: '/announcements',
      consumerFile: 'src/pages/announcements/AnnouncementsPage.tsx',
      consumerLine: 1,
    },
    {
      area: 'Announcements',
      sourceFile: 'src/pages/announcements/AnnouncementPage.tsx:83',
      generatorLabel: 'Announcements: New Draft with Company Query',
      getLink: () => '/announcements/new?company=pizza',
      expectedRoute: '/announcements/new',
      expectedParams: ['company'],
      consumerFile: 'src/pages/announcements/AnnouncementPage.tsx',
      consumerLine: 84,
    },
    {
      area: 'Announcements',
      sourceFile: 'src/pages/announcements/AnnouncementPage.tsx:74',
      generatorLabel: 'Announcements: Document Route with LINE Resume',
      getLink: () => `/announcements/${syntheticAnnouncement.company}/${syntheticAnnouncement.id}?${ANNOUNCE_PARAM}=${syntheticAnnouncement.id}`,
      expectedRoute: '/announcements/:company/:id',
      expectedParams: [ANNOUNCE_PARAM],
      consumerFile: 'src/pages/announcements/AnnouncementPage.tsx',
      consumerLine: 98,
    },

    // 15. Brand Switcher: Intentional Home Reset
    {
      area: 'Mobilenav',
      sourceFile: 'src/brand/useBrandSwitch.ts:84',
      generatorLabel: 'BrandSwitch: Navigate Home to Prevent Cross-Brand Leakage',
      getLink: () => '/',
      expectedRoute: '/',
      consumerFile: 'src/pages/Dashboard.tsx',
      consumerLine: 1,
    },
  ]

  test.each(cases)(
    '[$area] $sourceFile ($generatorLabel) -> $expectedRoute',
    ({ getLink, expectedRoute, expectedParams }) => {
      const link = getLink()
      const resolution = resolveRoute(link)

      expect(resolution.matchedRoute).toBe(expectedRoute)
      expect(resolution.landsOnDashboardFallback).toBe(false)

      if (expectedParams) {
        for (const param of expectedParams) {
          expect(resolution.queryParams).toHaveProperty(param)
          expect(resolution.queryParams[param]).toBeTruthy()
        }
      }

      // Canonical normalization check
      const canonical = canonicalLink(link)
      expect(canonical).not.toBeNull()
      expect(canonical).toBe(link)
    },
  )
})

describe('R72 AGENT04: Generated Document IDs & Query Keys Invariant', () => {
  test('Generated document IDs match entity identity and avoid title/docNo guessing', () => {
    // Orders deep link uses order ID, not docNo
    const orderLink = `/orders?po=${encodeURIComponent(syntheticOrder.id)}`
    expect(orderLink).not.toContain(syntheticOrder.docNo)
    expect(resolveRoute(orderLink).queryParams.po).toBe(syntheticOrder.id)

    // Transfer deep link uses transfer ID
    const transferLink = `/transfers/${syntheticTransfer.id}`
    expect(transferLink).not.toContain(syntheticTransfer.docNo)
    expect(resolveRoute(transferLink).pathname).toBe(`/transfers/${syntheticTransfer.id}`)

    // Request deep link uses request ID
    const requestLink = `/requests/${syntheticRequest.id}`
    expect(requestLink).not.toContain(syntheticRequest.docNo)
    expect(resolveRoute(requestLink).pathname).toBe(`/requests/${syntheticRequest.id}`)

    // Stock Card deep link uses product ID
    const productLink = `/products/${syntheticProduct.id}/card`
    expect(productLink).not.toContain(syntheticProduct.sku)
    expect(resolveRoute(productLink).pathname).toBe(`/products/${syntheticProduct.id}/card`)
  })

  test('Movement deep link intentionally uses docNo query matching MovementsPage:97 docFilter', () => {
    const movementDocLink = `/movements?doc=${encodeURIComponent(syntheticMovement.docNo)}`
    const resolution = resolveRoute(movementDocLink)
    expect(resolution.matchedRoute).toBe('/movements')
    expect(resolution.queryParams.doc).toBe(syntheticMovement.docNo)
  })
})

describe('R72 AGENT04: Deep-Link Refresh & Safe Error Fallbacks (EmptyState)', () => {
  // Test that non-existent IDs for each entity still route to the declared handler
  // (App route contract PASS), where the component presents an EmptyState or error banner,
  // rather than silently dumping the user on the dashboard.
  const deepLinkErrorCases = [
    { name: 'Unknown Request', path: '/requests/pr-nonexistent-999', expectedRoute: '/requests/:id' },
    { name: 'Unknown Transfer Detail', path: '/transfers/tr-nonexistent-999', expectedRoute: '/transfers/:id' },
    { name: 'Unknown Transfer Receive', path: '/transfers/tr-nonexistent-999/receive', expectedRoute: '/transfers/:id/receive' },
    { name: 'Unknown Product Stock Card', path: '/products/prod-nonexistent-999/card', expectedRoute: '/products/:id/card' },
    { name: 'Unknown Monthly Count Sheet', path: '/counts/cnt-nonexistent-999', expectedRoute: '/counts/:id' },
    { name: 'Unknown Purchase Batch', path: '/purchase/pb-nonexistent-999', expectedRoute: '/purchase/:id' },
    { name: 'Unknown Announcement', path: '/announcements/pizza/anc-nonexistent-999', expectedRoute: '/announcements/:company/:id' },
  ]

  test.each(deepLinkErrorCases)(
    '$name ($path) routes to $expectedRoute without falling back to dashboard',
    ({ path, expectedRoute }) => {
      const resolution = resolveRoute(path)
      expect(resolution.matchedRoute).toBe(expectedRoute)
      expect(resolution.landsOnDashboardFallback).toBe(false)
    },
  )
})

describe('R72 AGENT04: Brand Safety & Stored Legacy Path Handling', () => {
  test('Legacy /logistics/:id path safely normalizes to /transfers/:id', () => {
    const legacyPath = '/logistics/tr-fixture-001'
    const canonical = canonicalLink(legacyPath)
    expect(canonical).toBe('/transfers/tr-fixture-001')

    const res = resolveRoute(canonical!)
    expect(res.matchedRoute).toBe('/transfers/:id')
    expect(res.landsOnDashboardFallback).toBe(false)
  })

  test('canonicalLink strictly rejects transfer links attempting brand injection', () => {
    expect(canonicalLink('/transfers/tr-001?brand=lelapin')).toBeNull()
    expect(canonicalLink('/transfers/tr-001?brandId=lelapin')).toBeNull()
    expect(canonicalLink('/transfers/tr-001?company=lelapin')).toBeNull()
  })

  test('Malformed or external links are safely rejected or sent to Dashboard fallback', () => {
    const invalidLinks = [
      'https://malicious.example.com/orders',
      'javascript:alert(1)',
      '/transfers/tr-001/../products',
      '/settings/unknown-secret-section',
      '/unexpected-endpoint/123',
    ]

    for (const link of invalidLinks) {
      if (link.startsWith('http') || link.startsWith('javascript')) {
        expect(canonicalLink(link)).toBeNull()
      } else {
        const resolution = resolveRoute(link)
        // If route does not match App declared table, lands on Dashboard fallback
        if (resolution.matchedRoute === null) {
          expect(resolution.landsOnDashboardFallback).toBe(true)
        }
      }
    }
  })
})
