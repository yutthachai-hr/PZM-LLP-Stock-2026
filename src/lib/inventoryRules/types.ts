import type {
  Product,
  PurchaseOrder,
  PurchaseRequest,
  StockEvent,
  StockLocation,
  StockMovement,
  Supplier,
} from '../../types'

/**
 * The inventory calendar's view of the world.
 *
 * Nothing in this folder touches the database, React or the translations: it is the
 * business rules, and it is bundled twice — into the app, and into the cron Worker that
 * runs when nobody has the app open. What both need is one answer to "what is on the
 * calendar today, and what needs telling to whom", from data they have already fetched.
 *
 * A `CalendarItem` is what the screens draw. Only tasks are documents (stockEvents); every
 * other kind is derived at read time from orders, requests, suppliers and balances, so
 * there is nothing to keep in step and nothing to de-duplicate — the id IS the rule.
 */

export type CalendarKind =
  | 'task' // a stockEvents document: stock count, delivery, inventory task, other
  | 'poExpected' // an order waiting for the goods, on the day they are due
  | 'prPending' // a purchase request waiting for the manager
  | 'cutoff' // a supplier's order cut-off, on each of their order days
  | 'lowStock'
  | 'outOfStock'
  | 'stockoutEstimate'
  | 'adjustment'
  | 'waste'
  | 'reorder'

export type ItemStatus =
  | 'pending'
  | 'inProgress'
  | 'waitingApproval'
  | 'completed'
  | 'overdue'
  | 'cancelled'
  | 'info'

export type ItemPriority = 'critical' | 'high' | 'medium' | 'normal'

export type ItemSource =
  | 'stockEvent'
  | 'purchaseOrder'
  | 'purchaseRequest'
  | 'supplier'
  | 'stockLevel'
  | 'movement'
  | 'derived'

/** What an order's calendar entry says about the delivery. */
export type DeliveryState = 'expected' | 'arrivingToday' | 'delayed' | 'received'

export type ItemMeta =
  | { kind: 'task'; event: StockEvent }
  | { kind: 'poExpected'; order: PurchaseOrder; delivery: DeliveryState; daysLate: number; items: number }
  | { kind: 'prPending'; request: PurchaseRequest; items: number; suppliers: number; waitingDays: number }
  | { kind: 'cutoff'; supplier: Supplier; time: string }
  | { kind: 'lowStock' | 'outOfStock'; product: Product; location: StockLocation; qty: number; min: number }
  | { kind: 'stockoutEstimate'; product: Product; location: StockLocation; qty: number; avgDaily: number; daysLeft: number }
  | { kind: 'adjustment' | 'waste'; movement: StockMovement; product?: Product; value: number }
  | {
      kind: 'reorder'
      product: Product
      location: StockLocation
      onHand: number
      incoming: number
      avgDaily: number | null
      daysLeft: number | null
      recommendedQty: number
      supplier?: Supplier
      basis: 'usage' | 'minStock'
    }

export interface CalendarItem {
  /** Deterministic: the same fact always gets the same id, so nothing is ever shown twice. */
  id: string
  kind: CalendarKind
  sourceType: ItemSource
  sourceId: string
  /** A Thai translation key for the screen to render through t(); params fill its {slots}. */
  titleKey: string
  titleParams?: Record<string, string | number>
  /** When it sits on the calendar, ms epoch. */
  at: number
  endAt?: number
  allDay: boolean
  locationId?: string
  supplierId?: string
  productId?: string
  priority: ItemPriority
  status: ItemStatus
  meta: ItemMeta
  /** True for a stockEvents document; false for anything derived. */
  persisted: boolean
}

/** Everything the feed is built from — already in memory or one range read away. */
export interface FeedInput {
  events: readonly StockEvent[]
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  suppliers: readonly Supplier[]
  products: readonly Product[]
  locations: readonly StockLocation[]
  /** Base-unit balance at a location; the app's `qtyAt`. */
  qtyAt: (locationId: string, productId: string) => number
  /** Minimum for a product at a location; the app's `minFor`. */
  minFor: (product: Product, locationId: string) => number
  /** Whether a location has ever held a product; the app's `tracksProduct`. */
  tracksProduct: (locationId: string, productId: string) => boolean
  /** The window on the calendar, ms epoch, inclusive. */
  range: { from: number; to: number }
  now: number
}
