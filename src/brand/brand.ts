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
  /** placeholder shown for products that have no photo yet */
  productIcon: string
  /** default locations seeded on first entry (if the brand has none yet) */
  defaultLocations: { name: string; type: LocationType }[]
}

export const BRANDS: BrandDef[] = [
  {
    id: 'pizza',
    name: 'Pizza Mania',
    emoji: '🍕',
    productIcon: '🍕',
    defaultLocations: [
      { name: 'Main Warehouse', type: 'warehouse' },
      { name: 'Sarasin Branch', type: 'branch' },
      { name: 'On Nut Branch', type: 'branch' },
    ],
  },
  {
    id: 'lelapin',
    name: 'Le Lapin Sandwich Delivery',
    emoji: '🥪',
    productIcon: '🥖',
    defaultLocations: [
      { name: 'Sukhumvit Warehouse', type: 'warehouse' },
      { name: 'Sarasin Warehouse', type: 'warehouse' },
      { name: 'On Nut Branch', type: 'branch' },
      { name: 'Sarasin Branch', type: 'branch' },
      { name: 'Sukhumvit Branch', type: 'branch' },
    ],
  },
]

export function brandDef(id: BrandId): BrandDef {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]
}

// Collections that are SHARED across brands (never prefixed). These are about who may sign
// in, which is one question for the whole system rather than one per brand.
const SHARED = new Set(['users', 'meta', 'revokedUsers'])

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

/**
 * Map a logical collection name to its brand-scoped physical name.
 *
 * `brand` defaults to whatever is selected right now, which is what a screen wants. Any
 * operation made of more than one step must pass it explicitly instead: the user can tap
 * "switch brand" mid-save, and a Firestore transaction can be retried after they do. Read
 * afresh each time, this function would then send the second half of one receipt into the
 * other brand's namespace.
 */
export function resolveCollection(name: string, brand: BrandId = current): string {
  if (SHARED.has(name)) return name
  if (brand === 'pizza') return name
  return `${brand}__${name}`
}
