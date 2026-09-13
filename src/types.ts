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
  /**
   * Who we buy this from.
   *
   * Held here rather than in supplierItems because that is one document per product, and
   * "what does this supplier sell?" is asked every time an order is started — 454 reads for
   * a question the catalogue, already in memory, can answer for nothing. supplierItems stays
   * for the price we pay, which is not needed to place an order.
   *
   * Absent on a product whose name never said: the owner fills those in by hand.
   */
  supplierId?: string
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
  /**
   * `${locationId}__${productId}` for the product's own unit, and that plus `#${unit}` for
   * anything else someone keyed.
   *
   * The unsuffixed form is what every balance written before units were selectable uses, so
   * it is left exactly as it was rather than migrated.
   */
  id: string
  productId: string
  locationId: string
  /**
   * The unit this balance is counted in, when it is not the product's own.
   *
   * Absent means the product's own unit. Balances are never converted between units: a
   * delivery keyed as 10 Pack and one keyed as 2 KG are two balances, shown side by side,
   * because adding them would invent a pack size nobody stated.
   */
  unit?: string
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
  /** The product's own unit, as it was when this was filed. */
  unit: string
  /**
   * The unit the person actually picked, present only when it is not the product's own.
   *
   * Nothing is converted between the two: a line keyed as "10 Pack" is filed as 10 Pack and
   * counted against a Pack balance. Keeping `unit` alongside it is what lets a void find the
   * same balance the movement first touched.
   */
  entryUnit?: string
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
  /** Who touched it last. The full list is in `edits`. */
  updatedBy?: string
  updatedByName?: string
  updatedAt?: number
  /**
   * Every edit ever made to this row, oldest first, appended and never rewritten.
   *
   * `updatedBy` only ever names the most recent person, which is exactly the thing someone
   * covering their tracks would rely on: edit a colleague's row, then let the next editor
   * overwrite your name. The reports print this whole list.
   */
  edits?: MovementEdit[]
  voided?: boolean
}

/** One entry in a movement's edit history. */
export interface MovementEdit {
  by: string
  byName: string
  at: number
  /** Which fields this edit changed, for the report to name them. */
  changed: string[]
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
  /**
   * The weekly order to a supplier.
   *
   * The one event type that carries work rather than only describing it: creating one opens
   * an order, and its status follows the order rather than the generic calendar states.
   */
  | 'weeklyOrder'
  | 'other'

export type StockEventStatus = 'upcoming' | 'inProgress' | 'completed' | 'cancelled'

export type StockEventPriority = 'normal' | 'high' | 'critical'

/**
 * Where an order has got to.
 *
 * Deliberately three states and no more. "Ordered" is the moment somebody sent the list to
 * the supplier; "received" is the moment the goods were checked in and the stock actually
 * moved. A draft is a list still being built, and nothing outside this app knows about it.
 */
export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received'

/** One product on an order, as ordered and as it actually turned up. */
export interface PurchaseOrderLine {
  productId: string
  /** Denormalised, like a movement: the order has to still read correctly years later. */
  productName: string
  /** The product's own unit when the order was placed. */
  unit: string
  orderedQty: number
  /**
   * What actually arrived, filled in during the receiving check.
   *
   * Absent until somebody checks the delivery in. Equal to orderedQty on a line that was
   * simply ticked as correct.
   */
  receivedQty?: number
  /** Ticked to say the delivery matched the order, without retyping the number. */
  checked?: boolean
  /** Why it did not match. The screen insists on one whenever the quantity was changed. */
  note?: string
}

/**
 * An order placed with one supplier.
 *
 * Its own collection rather than a field on the calendar entry: an order carries a list of
 * lines that grows, gets checked off on arrival, and is reported on by date and supplier
 * long after the calendar has moved past it.
 */
export interface PurchaseOrder {
  id: string
  /** PO-00001. The number people say out loud. */
  docNo: string
  supplierId: string
  /** Denormalised so an old order still names its supplier after a rename. */
  supplierName: string
  status: PurchaseOrderStatus
  /** Where the goods will land, and where the stock receipt will be filed. */
  locationId: string
  /** When it was sent to the supplier, ms epoch. */
  orderedAt: number
  lines: PurchaseOrderLine[]
  /**
   * The supplier's invoice number.
   *
   * Required before the goods can be taken into stock, exactly as it is when somebody keys a
   * receipt by hand — an order that reaches the books without one is a number nobody can
   * trace back to a piece of paper.
   */
  invoiceNo?: string
  receivedAt?: number
  receivedBy?: string
  receivedByName?: string
  /** The stock receipt this became, so the two can be read against each other. */
  movementDocNo?: string
  /** The calendar entry that opened it, when it came from a weekly order. */
  eventId?: string
  note?: string
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

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
  purchaseOrders: 'purchaseOrders',
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
