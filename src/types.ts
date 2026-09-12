// ---------- Core domain types for Pizza Mania Stock ----------

export type Role = 'admin' | 'staff'

export interface AppUser {
  id: string // uid
  name: string
  email: string
  role: Role
  active: boolean
  // Only used by the local (offline) backend for demo login. Never used with Firebase Auth.
  localPassword?: string
  createdAt: number
}

export interface Product {
  id: string
  sku: string
  name: string
  category: string
  unit: string // display unit, e.g. "Kilogram", "Bottle"
  unitType: string // short code, e.g. "KG", "EA"
  minStock: number // global minimum (reorder point)
  cost?: number // optional unit cost for inventory value
  /**
   * How many base units are in one pack, when the supplier delivers in packs.
   *
   * Goods arrive as "1 ลัง /300 ชิ้น" or "2/KG" — the company's own item file is full of
   * it — but the ledger has to hold one number per product per location, so a balance
   * cannot be part packs and part pieces. This is the multiplier that lets someone key
   * what the delivery note says and still store base units, exactly as grams already
   * convert into kilograms.
   *
   * Safe to change at any time: movements record base units, so editing it never
   * rewrites history. That is why it is not frozen the way `unitType` is.
   */
  packSize?: number
  /** What the pack is called on the delivery note — ลัง, กล่อง, Pack, Lot. */
  packLabel?: string
  hasImage: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface ProductImage {
  id: string // == product id
  dataUrl: string // compressed base64 JPEG
}

export type LocationType = 'warehouse' | 'branch'

export interface StockLocation {
  id: string
  name: string
  type: LocationType
  active: boolean
  createdAt: number
}

// Current balance of a product at a location (cached projection of the ledger)
export interface StockLevel {
  id: string // `${locationId}__${productId}`
  productId: string
  locationId: string
  qty: number
  updatedAt: number
}

export type MovementType = 'receive' | 'issue' | 'adjust' | 'consume'

// The immutable ledger. Every stock change is one of these.
export interface StockMovement {
  id: string
  docNo: string
  type: MovementType
  productId: string
  productName: string // denormalised for easy reporting
  unit: string
  qty: number // always positive; direction implied by type + from/to
  fromLocationId?: string // issue/adjust-out
  toLocationId?: string // receive/issue-in/adjust-in
  note?: string
  reason?: string // for adjust: lost | broken | expired | damage | found | count
  hasPhoto?: boolean // for consume: a proof photo is attached (stored in movementImages/{docNo})
  date: number // business date (editable), ms epoch of the day
  byUserId: string
  byUserName: string
  createdAt: number
  updatedBy?: string
  updatedByName?: string
  updatedAt?: number
  voided?: boolean
}

export interface Note {
  id: string
  title: string
  body: string
  byUserName: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

// Per-location minimum override (optional). Falls back to product.minStock.
export interface MinOverride {
  id: string // `${locationId}__${productId}`
  productId: string
  locationId: string
  minStock: number
}

// Collection name constants — single source of truth
/** Whether a supplier takes goods back. Shown on the supplier list as a badge. */
export type SupplierType = 'takingReturn' | 'notTakingReturn'

/**
 * A company the warehouse buys from.
 *
 * What it supplies lives in SupplierItem, not here. The design this screen came from put
 * one product and one price on the supplier row — but the same supplier appeared several
 * times in it, which is the tell: those rows are supplier x product pairs. Folding the
 * product into the supplier would make "this supplier also sells us three other things"
 * unrepresentable.
 */
export interface Supplier {
  id: string
  name: string
  contactNumber: string
  email: string
  type: SupplierType
  note?: string
  active: boolean
  createdAt: number
  updatedAt: number
}

/** One product a supplier sells us, and what we pay for it. */
export interface SupplierItem {
  id: string
  supplierId: string
  productId: string
  /** Purchase price per unit of the product's own unitType. Optional: not always known. */
  buyingPrice?: number
  active: boolean
  createdAt: number
  updatedAt: number
}

/**
 * What a calendar entry is about. Deliberately short: a type nobody can create is a type
 * nobody can filter by, and the modules these would come from do not exist yet.
 */
export type StockEventType =
  | 'stockCount'
  | 'audit'
  | 'delivery'
  | 'transfer'
  | 'inventoryTask'
  | 'other'

export type StockEventStatus = 'upcoming' | 'inProgress' | 'completed' | 'cancelled'

export type StockEventPriority = 'normal' | 'high' | 'critical'

/**
 * Something that has to happen, on a date, at a location.
 *
 * Written by hand this round — there is no scheduler and no rule that creates one. It is a
 * plan, not a derived condition: low stock is NOT an event, because it is already computed
 * for free from balances the app has in memory, and one document per low SKU per location
 * would be over a thousand documents nobody asked for.
 */
export interface StockEvent {
  id: string
  title: string
  type: StockEventType
  /** Which warehouse or branch. Empty for something that is not about one place. */
  locationId?: string
  /** When it starts, ms epoch. The only field the calendar queries on. */
  startAt: number
  /** When it should be done by, ms epoch. Optional — not everything has a deadline. */
  dueAt?: number
  status: StockEventStatus
  priority: StockEventPriority
  assignedTo?: string
  /**
   * The assignee's name, stored rather than looked up.
   *
   * `users` is only subscribed for admins, so a staff member holding a uid cannot turn it
   * into a name without a read. Same denormalisation StockMovement already makes for
   * productName and byUserName, and for the same reason.
   */
  assignedToName?: string
  note?: string
  createdBy: string
  createdAt: number
  updatedAt: number
}

export const COL = {
  users: 'users',
  products: 'products',
  productImages: 'productImages',
  movementImages: 'movementImages',
  locations: 'locations',
  stockLevels: 'stockLevels',
  movements: 'stockMovements',
  notes: 'notes',
  counters: 'counters',
  minOverrides: 'productMinOverrides',
  suppliers: 'suppliers',
  supplierItems: 'supplierItems',
  events: 'stockEvents',
  meta: 'meta',
  revokedUsers: 'revokedUsers',
} as const

// Labels are translation keys — screens render them through t(). i18n-key
export const ADJUST_REASONS = [
  { value: 'lost', label: 'ของหาย' }, // i18n-key
  { value: 'broken', label: 'แตก/ชำรุด' }, // i18n-key
  { value: 'expired', label: 'หมดอายุ' }, // i18n-key
  { value: 'damage', label: 'เสียหาย' }, // i18n-key
  { value: 'found', label: 'พบเพิ่ม (นับได้เกิน)' }, // i18n-key
  { value: 'count', label: 'ปรับตามการนับ' }, // i18n-key
  { value: 'opening', label: 'ตั้งยอด/ยอดยกมา' }, // i18n-key
] as const
