import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { matchPath } from 'react-router-dom'
import {
  adjustmentDraft,
  evaluate,
  poSentDraft,
  prReturnedDraft,
  prSubmittedDraft,
  supplierAnswerDraft,
  supplierDecisionDraft,
  supplierOpenedDraft,
  taskApprovalDraft,
  transferArrivingDraft,
  transferIssueDraft,
  transferSubmittedDraft,
  type EngineInput,
  type NotificationDraft,
} from '../src/lib/inventoryRules/notifications'
import { NOTIFICATION_ROUTES, canonicalLink } from '../src/lib/notificationLink'
import { buildActivityLog, type ActivityInput } from '../src/lib/activityLog'
import { recentActivity } from '../src/lib/sidebarLive'
import { globalSearch } from '../src/lib/globalSearch'
import { actionsFor, navFor, NAV, TAB_ITEMS } from '../src/components/nav/navItems'
import { bkkDayStart } from '../src/lib/inventoryRules/time'
import type {
  Product,
  PurchaseOrder,
  PurchaseRequest,
  StockEvent,
  StockLocation,
  StockMovement,
  Supplier,
  Transfer,
} from '../src/types'

// Extract all real route patterns from src/App.tsx (excluding the catch-all <Route path="*" ... />)
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
  const matchedRoute = APP_DECLARED_ROUTES.find((pattern) =>
    matchPath({ path: pattern, end: true, caseSensitive: true }, pathname),
  ) ?? null

  return {
    rawLink: link,
    pathname,
    search: url.search,
    queryParams: Object.fromEntries(url.searchParams.entries()),
    matchedRoute,
    // When matchedRoute is null, App.tsx falls back to <Route path="*" element={<Navigate to="/" replace />} />
    landsOnDashboardFallback: matchedRoute === null,
  }
}

// Synthetic fixtures for building generator links
const TEST_NOW = new Date('2026-10-19T02:30:00.000Z').getTime() // Monday 09:30 AM BKK
const TEST_DAY_START = bkkDayStart(TEST_NOW)

const syntheticSupplier: Supplier = {
  id: 'sup-panfood',
  code: 'PF',
  name: 'Pan Food',
  active: true,
  leadTimeDays: 2,
  orderDays: [1, 3, 5],
  cutoffTime: '11:00',
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticOrder: PurchaseOrder = {
  id: 'po-fixture-001',
  docNo: 'PO-00001',
  status: 'ordered',
  supplierId: syntheticSupplier.id,
  supplierName: syntheticSupplier.name,
  locationId: 'wh-main',
  lines: [{ productId: 'prod-flour', productName: 'Flour', orderedQty: 10, unit: 'KG' }],
  createdAt: 1000,
  updatedAt: 1000,
  orderedAt: 1000,
  expectedAt: TEST_DAY_START,
}

const syntheticRequest: PurchaseRequest = {
  id: 'pr-fixture-001',
  docNo: 'PR-00001',
  status: 'pendingApproval',
  locationId: 'wh-main',
  revision: 1,
  requestedBy: 'user-01',
  requestedByName: 'Alice',
  items: [{ idx: 1, productId: 'prod-flour', productName: 'Flour', requestedQty: 10, unit: 'KG' }],
  history: [{ at: 1000, by: 'user-01', byName: 'Alice', action: 'create' }],
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticTask: StockEvent = {
  id: 'task-fixture-001',
  type: 'stockCount',
  title: 'Monthly Count',
  status: 'inProgress',
  priority: 'normal',
  startAt: TEST_NOW + 15 * 60_000,
  locationId: 'wh-main',
  assignedToAll: true,
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticTransfer: Transfer = {
  id: 'tr-fixture-001',
  docNo: 'TR-00001',
  status: 'pendingApproval',
  revision: 1,
  fromLocationId: 'wh-main',
  toLocationId: 'br-sarasin',
  dispatchDate: 1000,
  requestedBy: 'user-01',
  requestedByName: 'Alice',
  createdAt: 1000,
  updatedAt: 1000,
  items: [],
  history: [],
}

const syntheticProduct: Product = {
  id: 'prod-flour',
  sku: 'P-FLOUR',
  name: 'Wheat Flour',
  unitType: 'KG',
  unit: 'KG',
  minStock: 5,
  active: true,
  createdAt: 1000,
  updatedAt: 1000,
}

const syntheticLocation: StockLocation = {
  id: 'wh-main',
  name: 'Main Warehouse',
  type: 'warehouse',
  active: true,
  createdAt: 1000,
}

const syntheticMovement: StockMovement = {
  id: 'mv-fixture-001',
  docNo: 'RC-00001',
  type: 'receive',
  date: 1000,
  productId: syntheticProduct.id,
  productName: syntheticProduct.name,
  toLocationId: 'wh-main',
  qty: 10,
  unit: 'KG',
  byUserId: 'user-01',
  byUserName: 'Alice',
  createdAt: 1000,
  updatedAt: 1000,
  poId: syntheticOrder.id,
  poDocNo: syntheticOrder.docNo,
}

describe('ROUTE-CONTRACT: App.tsx Route Table & NOTIFICATION_ROUTES Integrity', () => {
  test('App.tsx declared routes match NOTIFICATION_ROUTES exactly', () => {
    expect([...NOTIFICATION_ROUTES].sort()).toEqual([...APP_DECLARED_ROUTES].sort())
  })

  test('Catch-all "*" route in App.tsx redirects unmatched routes to "/" (Dashboard fallback)', () => {
    expect(appSource).toContain('<Route path="*" element={<Navigate to="/" replace />} />')
  })
})

describe('ROUTE-CONTRACT: All Link Generators Match Real Routes & Required Query Params', () => {
  const evaluatedDrafts = evaluate({
    now: TEST_NOW,
    jobs: ['tasks', 'purchasing', 'inventory', 'brief', 'weekly', 'risk'],
    events: [syntheticTask],
    orders: [syntheticOrder],
    requests: [syntheticRequest],
    suppliers: [syntheticSupplier],
    insights: {
      shortages: [
        {
          product: syntheticProduct,
          location: syntheticLocation,
          qty: 2,
          min: 10,
          out: false,
        },
        {
          product: syntheticProduct,
          location: syntheticLocation,
          qty: 0,
          min: 10,
          out: true,
        },
      ],
      reorders: [
        {
          product: syntheticProduct,
          location: syntheticLocation,
          recommendedQty: 20,
          supplier: syntheticSupplier,
          inProgress: false,
        },
      ],
      stockouts: [
        {
          product: syntheticProduct,
          location: syntheticLocation,
          daysLeft: 2,
          avgDaily: 5,
        },
      ],
      adjustments: [
        {
          movement: {
            docNo: 'ADJ-00001',
            productId: syntheticProduct.id,
            productName: syntheticProduct.name,
            qty: 5,
            unit: 'KG',
            fromLocationId: 'wh-main',
            byUserName: 'Alice',
          },
          kind: 'adjustment',
          value: 500,
        },
      ],
    },
    weekly: {
      tasksDone: 10,
      tasksMissed: 0,
      deliveries: 5,
      lateDeliveries: 0,
      adjustments: 1,
      wasteValue: 0,
    },
    risk: {
      deliveries: [
        {
          poId: syntheticOrder.id,
          docNo: syntheticOrder.docNo,
          supplierId: syntheticSupplier.id,
          supplierName: syntheticSupplier.name,
          locationId: 'wh-main',
          level: 'HIGH',
          score: 75,
          people: ['user-01'],
        },
      ],
      shortages: [
        {
          productId: syntheticProduct.id,
          productName: syntheticProduct.name,
          locationId: 'wh-main',
          locationName: 'Main Warehouse',
          level: 'HIGH',
          stockoutDate: 2000,
          gapDays: 2,
          docNo: syntheticOrder.docNo,
        },
      ],
    },
    locationName: () => 'Main Warehouse',
    settings: { reminderBeforeMin: 60, escalateAfterHours: 4 },
  })

  // List of all generators covered
  const generators: Array<{
    source: string
    generator: string
    getLink: () => string
    expectedRoute: string
    expectedParams?: string[]
  }> = [
    // 1. Notification drafts from inventoryRules/notifications evaluate()
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'taskSoon / taskOverdue / taskEscalated',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'taskSoon')
        if (!d) throw new Error('Missing taskSoon in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'poArriving / poDelayed',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'poArriving')
        if (!d) throw new Error('Missing poArriving in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'cutoffToday',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'cutoffToday')
        if (!d) throw new Error('Missing cutoffToday in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/requests',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'lowStock',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'lowStock')
        if (!d) throw new Error('Missing lowStock in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'outOfStock',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'outOfStock')
        if (!d) throw new Error('Missing outOfStock in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'reorder',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'reorder')
        if (!d) throw new Error('Missing reorder in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'stockoutSoon',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'stockoutSoon')
        if (!d) throw new Error('Missing stockoutSoon in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'dailyBrief',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'dailyBrief')
        if (!d) throw new Error('Missing dailyBrief in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['filter'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'weeklySummary',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'weeklySummary')
        if (!d) throw new Error('Missing weeklySummary in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/reports',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'deliveryRisk',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'deliveryRisk')
        if (!d) throw new Error('Missing deliveryRisk in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:evaluate',
      generator: 'stockoutRisk',
      getLink: () => {
        const d = evaluatedDrafts.find((x) => x.kind === 'stockoutRisk')
        if (!d) throw new Error('Missing stockoutRisk in evaluatedDrafts')
        return d.link
      },
      expectedRoute: '/',
    },

    // 2. Standalone notification draft builders
    {
      source: 'src/lib/inventoryRules/notifications.ts:taskApprovalDraft',
      generator: 'taskApprovalDraft',
      getLink: () => taskApprovalDraft(syntheticTask, () => 'Main Warehouse').link,
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:prSubmittedDraft',
      generator: 'prSubmittedDraft',
      getLink: () => prSubmittedDraft(syntheticRequest, () => 'Main Warehouse').link,
      expectedRoute: '/requests/:id',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:prReturnedDraft',
      generator: 'prReturnedDraft',
      getLink: () => prReturnedDraft(syntheticRequest, 'Manager Bob').link,
      expectedRoute: '/requests/:id',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierAnswerDraft',
      generator: 'supplierAnswerDraft:supplierConfirmed',
      getLink: () => supplierAnswerDraft(syntheticOrder, 'supplierConfirmed', 'ch1', 2000, 'Vendor').link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierAnswerDraft',
      generator: 'supplierAnswerDraft:supplierDateChanged',
      getLink: () => supplierAnswerDraft(syntheticOrder, 'supplierDateChanged', 'ch1', 2000, 'Vendor').link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierAnswerDraft',
      generator: 'supplierAnswerDraft:supplierDatePending',
      getLink: () => supplierAnswerDraft(syntheticOrder, 'supplierDatePending', 'ch1', 2000, 'Vendor').link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierOpenedDraft',
      generator: 'supplierOpenedDraft',
      getLink: () => supplierOpenedDraft(syntheticOrder, 1).link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:poSentDraft',
      generator: 'poSentDraft',
      getLink: () => poSentDraft(syntheticOrder, { id: 'u1', name: 'Alice' }, 1).link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierDecisionDraft',
      generator: 'supplierDecisionDraft:approved',
      getLink: () => supplierDecisionDraft(syntheticOrder, true, 'ch1', 2000, 'Manager Bob').link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:supplierDecisionDraft',
      generator: 'supplierDecisionDraft:rejected',
      getLink: () => supplierDecisionDraft(syntheticOrder, false, 'ch1', 2000, 'Manager Bob').link,
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:adjustmentDraft',
      generator: 'adjustmentDraft:adjustment',
      getLink: () =>
        adjustmentDraft(
          {
            docNo: 'ADJ-00001',
            productId: syntheticProduct.id,
            productName: syntheticProduct.name,
            qty: 5,
            unit: 'KG',
            fromLocationId: 'wh-main',
            byUserName: 'Alice',
          },
          'adjustment',
          500,
          () => 'Main Warehouse',
        ).link,
      expectedRoute: '/movements',
      expectedParams: ['product', 'location'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:adjustmentDraft',
      generator: 'adjustmentDraft:waste',
      getLink: () =>
        adjustmentDraft(
          {
            docNo: 'WST-00001',
            productId: syntheticProduct.id,
            productName: syntheticProduct.name,
            qty: 2,
            unit: 'KG',
            fromLocationId: 'wh-main',
            byUserName: 'Alice',
          },
          'waste',
          200,
          () => 'Main Warehouse',
        ).link,
      expectedRoute: '/movements',
      expectedParams: ['product', 'location'],
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:transferSubmittedDraft',
      generator: 'transferSubmittedDraft',
      getLink: () => transferSubmittedDraft(syntheticTransfer, () => 'Main Warehouse').link,
      expectedRoute: '/transfers/:id',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:transferArrivingDraft',
      generator: 'transferArrivingDraft',
      getLink: () => transferArrivingDraft(syntheticTransfer, () => 'Main Warehouse').link,
      expectedRoute: '/transfers/:id',
    },
    {
      source: 'src/lib/inventoryRules/notifications.ts:transferIssueDraft',
      generator: 'transferIssueDraft',
      getLink: () => transferIssueDraft(syntheticTransfer, () => 'Main Warehouse', 'Reporter').link,
      expectedRoute: '/transfers/:id',
    },

    // 3. Activity log links (src/lib/activityLog.ts)
    {
      source: 'src/lib/activityLog.ts:buildActivityLog',
      generator: 'activityLog:movement',
      getLink: () => {
        const entries = buildActivityLog({
          movements: [syntheticMovement],
          orders: [],
          requests: [],
          events: [],
          from: 0,
          to: 2000,
          locationName: () => 'Main Warehouse',
          formatDate: () => '24/10/2026',
          formatDateTime: () => '24/10/2026 10:00',
          fmtQty: (n) => String(n),
          movementType: () => 'Receive',
          editChange: () => '',
          requestAction: () => '',
          taskAction: () => '',
          t: (k) => k,
        })
        const entry = entries[0]
        if (!entry) throw new Error('Missing movement entry in activity log')
        return entry.link
      },
      expectedRoute: '/movements',
      expectedParams: ['product'],
    },
    {
      source: 'src/lib/activityLog.ts:buildActivityLog',
      generator: 'activityLog:order',
      getLink: () => {
        const entries = buildActivityLog({
          movements: [],
          orders: [syntheticOrder],
          requests: [],
          events: [],
          from: 0,
          to: 2000,
          locationName: () => 'Main Warehouse',
          formatDate: () => '24/10/2026',
          formatDateTime: () => '24/10/2026 10:00',
          fmtQty: (n) => String(n),
          movementType: () => '',
          editChange: () => '',
          requestAction: () => '',
          taskAction: () => '',
          t: (k) => k,
        })
        const entry = entries[0]
        if (!entry) throw new Error('Missing order entry in activity log')
        return entry.link
      },
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },
    {
      source: 'src/lib/activityLog.ts:buildActivityLog',
      generator: 'activityLog:request',
      getLink: () => {
        const entries = buildActivityLog({
          movements: [],
          orders: [],
          requests: [syntheticRequest],
          events: [],
          from: 0,
          to: 2000,
          locationName: () => 'Main Warehouse',
          formatDate: () => '24/10/2026',
          formatDateTime: () => '24/10/2026 10:00',
          fmtQty: (n) => String(n),
          movementType: () => '',
          editChange: () => '',
          requestAction: () => '',
          taskAction: () => '',
          t: (k) => k,
        })
        const entry = entries[0]
        if (!entry) throw new Error('Missing request entry in activity log')
        return entry.link
      },
      expectedRoute: '/requests/:id',
    },
    {
      source: 'src/lib/activityLog.ts:buildActivityLog',
      generator: 'activityLog:task',
      getLink: () => {
        const entries = buildActivityLog({
          movements: [],
          orders: [],
          requests: [],
          events: [{ ...syntheticTask, history: [{ at: 1000, by: 'u1', byName: 'Alice', action: 'create' }] }],
          from: 0,
          to: 2000,
          locationName: () => 'Main Warehouse',
          formatDate: () => '24/10/2026',
          formatDateTime: () => '24/10/2026 10:00',
          fmtQty: (n) => String(n),
          movementType: () => '',
          editChange: () => '',
          requestAction: () => '',
          taskAction: () => '',
          t: (k) => k,
        })
        const entry = entries[0]
        if (!entry) throw new Error('Missing task entry in activity log')
        return entry.link
      },
      expectedRoute: '/calendar',
      expectedParams: ['item'],
    },

    // 4. Sidebar live feed (src/lib/sidebarLive.ts)
    {
      source: 'src/lib/sidebarLive.ts:recentActivity',
      generator: 'sidebarLive:movement',
      getLink: () => {
        const item = recentActivity([syntheticMovement], [], 1500)[0]
        if (!item) throw new Error('Missing movement item in recentActivity')
        return item.link
      },
      expectedRoute: '/movements',
      expectedParams: ['doc'],
    },
    {
      source: 'src/lib/sidebarLive.ts:recentActivity',
      generator: 'sidebarLive:order',
      getLink: () => {
        const item = recentActivity([], [syntheticOrder], 1500)[0]
        if (!item) throw new Error('Missing order item in recentActivity')
        return item.link
      },
      expectedRoute: '/orders',
      expectedParams: ['po'],
    },

    // 5. Global Search results (src/lib/globalSearch.ts)
    {
      source: 'src/lib/globalSearch.ts:globalSearch',
      generator: 'search:product',
      getLink: () => {
        const res = globalSearch('flour', {
          pages: navFor('admin'),
          products: [syntheticProduct],
          locations: [syntheticLocation],
          suppliers: [syntheticSupplier],
          movements: [syntheticMovement],
          label: (k) => k,
        })
        const hit = res.hits.find((h) => h.group === 'products')
        if (!hit) throw new Error('Missing product hit in globalSearch')
        return hit.to
      },
      expectedRoute: '/products/:id/card',
    },
    {
      source: 'src/lib/globalSearch.ts:globalSearch',
      generator: 'search:document',
      getLink: () => {
        const res = globalSearch('RC-00001', {
          pages: navFor('admin'),
          products: [syntheticProduct],
          locations: [syntheticLocation],
          suppliers: [syntheticSupplier],
          movements: [syntheticMovement],
          label: (k) => k,
        })
        const hit = res.hits.find((h) => h.group === 'documents')
        if (!hit) throw new Error('Missing document hit in globalSearch')
        return hit.to
      },
      expectedRoute: '/movements',
      expectedParams: ['doc'],
    },
    {
      source: 'src/lib/globalSearch.ts:globalSearch',
      generator: 'search:supplier',
      getLink: () => {
        const res = globalSearch('Pan Food', {
          pages: navFor('admin'),
          products: [syntheticProduct],
          locations: [syntheticLocation],
          suppliers: [syntheticSupplier],
          movements: [syntheticMovement],
          label: (k) => k,
        })
        const hit = res.hits.find((h) => h.group === 'suppliers')
        if (!hit) throw new Error('Missing supplier hit in globalSearch')
        return hit.to
      },
      expectedRoute: '/suppliers',
      expectedParams: ['id'],
    },
    {
      source: 'src/lib/globalSearch.ts:globalSearch',
      generator: 'search:location',
      getLink: () => {
        const res = globalSearch('Main Warehouse', {
          pages: navFor('admin'),
          products: [syntheticProduct],
          locations: [syntheticLocation],
          suppliers: [syntheticSupplier],
          movements: [syntheticMovement],
          label: (k) => k,
        })
        const hit = res.hits.find((h) => h.group === 'locations')
        if (!hit) throw new Error('Missing location hit in globalSearch')
        return hit.to
      },
      expectedRoute: '/movements',
      expectedParams: ['location'],
    },

    // 6. Action sheet & Nav builders (src/components/nav/navItems.ts)
    ...actionsFor('admin').map((action) => ({
      source: 'src/components/nav/navItems.ts:actionsFor',
      generator: `actionSheet:${action.to}`,
      getLink: () => action.to,
      expectedRoute: action.to.split('?')[0] === '/requests/new' ? '/requests/:id' : action.to.split('?')[0],
      expectedParams: action.to.includes('?') ? [...new URL(action.to, 'http://localhost').searchParams.keys()] : undefined,
    })),

    // 7. Core Navigation (src/components/nav/navItems.ts:NAV)
    ...NAV.map((navItem) => ({
      source: 'src/components/nav/navItems.ts:NAV',
      generator: `nav:${navItem.to}`,
      getLink: () => navItem.to,
      expectedRoute: navItem.to,
    })),
  ]

  test.each(generators)(
    '$source [$generator]: matches $expectedRoute',
    ({ getLink, expectedRoute, expectedParams }) => {
      const link = getLink()
      const resolution = resolveRoute(link)

      // Must match a real declared route in App.tsx
      expect(resolution.matchedRoute).toBe(expectedRoute)
      // Must NOT fall back to Dashboard via catch-all '*'
      expect(resolution.landsOnDashboardFallback).toBe(false)

      // Check required query parameters if specified
      if (expectedParams && expectedParams.length > 0) {
        for (const param of expectedParams) {
          expect(resolution.queryParams).toHaveProperty(param)
          expect(resolution.queryParams[param]).toBeTruthy()
        }
      }

      // Canonical link check: must be accepted by canonicalLink()
      const canonical = canonicalLink(link)
      expect(canonical).not.toBeNull()
      expect(canonical).toBe(link)
    },
  )
})

describe('ROUTE-CONTRACT: Broken Link Contract & Catch-all Rejection (RED guards)', () => {
  test('Unmatched /logistics/:id route directly fails App route contract and lands on Dashboard', () => {
    const rawLegacyLink = '/logistics/tr-fixture-001'
    const resolution = resolveRoute(rawLegacyLink)
    // No route matches /logistics/:id in App.tsx
    expect(resolution.matchedRoute).toBeNull()
    // It falls through to the catch-all <Route path="*" ... /> and navigates to '/'
    expect(resolution.landsOnDashboardFallback).toBe(true)
  })

  test('canonicalLink() normalizes legacy /logistics/:id so it safely matches /transfers/:id', () => {
    const rawLegacyLink = '/logistics/tr-fixture-001'
    const canonical = canonicalLink(rawLegacyLink)
    expect(canonical).toBe('/transfers/tr-fixture-001')

    const resolution = resolveRoute(canonical!)
    expect(resolution.matchedRoute).toBe('/transfers/:id')
    expect(resolution.landsOnDashboardFallback).toBe(false)
  })

  test.each([
    '/unknown-feature/123',
    '/products/deleted/card/sub',
    '/orders?po=',
    '/transfers/x/receive/unexpected',
    'https://evil.example/transfers/tr-1',
  ])('Disallowed or unrouted link %s is refused or lands on Dashboard fallback', (link) => {
    if (link.startsWith('http')) {
      expect(canonicalLink(link)).toBeNull()
    } else {
      const resolution = resolveRoute(link)
      const canonical = canonicalLink(link)
      if (resolution.matchedRoute === null) {
        expect(resolution.landsOnDashboardFallback).toBe(true)
      }
      if (link.includes('unexpected') || link.includes('unknown') || link.includes('sub')) {
        expect(canonical).toBeNull()
      }
    }
  })
})
