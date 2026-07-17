import type { LocationType } from '../types'

// ============================================================================
// Multi-brand support.
// Each brand has its OWN products / locations / stock / movements / notes, fully
// isolated. Auth (users) + bootstrap (meta) are SHARED across brands (one login).
//
// Isolation strategy: brand-scoped collection names.
//   - 'pizza'   => unprefixed collection names  (keeps existing Pizza Mania data intact)
//   - others    => `${brandId}__<collection>`   (a fresh, separate namespace)
// ============================================================================

export type BrandId = 'pizza' | 'lelapin'

export interface BrandDef {
  id: BrandId
  name: string
  emoji: string
  /** default locations seeded on first entry (if the brand has none yet) */
  defaultLocations: { name: string; type: LocationType }[]
  /** whether the "import sample products" button is offered for this brand */
  hasSampleProducts: boolean
}

export const BRANDS: BrandDef[] = [
  {
    id: 'pizza',
    name: 'Pizza Mania',
    emoji: '🍕',
    hasSampleProducts: true,
    defaultLocations: [
      { name: 'คลังหลัก', type: 'warehouse' },
      { name: 'สาขาสารสิน', type: 'branch' },
      { name: 'สาขาอ่อนนุช', type: 'branch' },
    ],
  },
  {
    id: 'lelapin',
    name: 'Le Lapin Sandwich Delivery',
    emoji: '🥪',
    hasSampleProducts: false,
    defaultLocations: [
      { name: 'คลังสุขุมวิท', type: 'warehouse' },
      { name: 'คลังสารสิน', type: 'warehouse' },
      { name: 'สาขาอ่อนนุช', type: 'branch' },
      { name: 'สาขาสารสิน', type: 'branch' },
      { name: 'สาขาสุขุมวิท', type: 'branch' },
    ],
  },
]

export function brandDef(id: BrandId): BrandDef {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]
}

// Collections that are SHARED across brands (never prefixed).
const SHARED = new Set(['users', 'meta'])

const LS_KEY = 'pmstock:v1:lastBrand'

let current: BrandId = 'pizza'
try {
  const saved = localStorage.getItem(LS_KEY)
  if (saved === 'pizza' || saved === 'lelapin') current = saved
} catch {
  /* ignore */
}

export function getBrand(): BrandId {
  return current
}

/** Set the active brand for the data layer (updates collection resolution immediately). */
export function setActiveBrand(b: BrandId): void {
  current = b
  try {
    localStorage.setItem(LS_KEY, b)
  } catch {
    /* ignore */
  }
}

export function lastBrand(): BrandId {
  return current
}

/** Map a logical collection name to its brand-scoped physical name. */
export function resolveCollection(name: string): string {
  if (SHARED.has(name)) return name
  if (current === 'pizza') return name
  return `${current}__${name}`
}
