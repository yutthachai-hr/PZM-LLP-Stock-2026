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
  meta: 'meta',
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
