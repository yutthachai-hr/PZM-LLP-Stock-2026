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
  /**
   * The brand's colour as the interface uses it — for text, active states and buttons.
   *
   * Not decoration: the two brands are separate companies with separate books, and the
   * only thing that used to say which one you were looking at was a word in the sidebar.
   * Pizza Mania's red was hardcoded across the app, so Le Lapin — a sandwich brand — was
   * rendered in it too. A wrong-brand receipt is expensive to unpick, and colour is the
   * fastest signal there is.
   *
   * These are a step deeper than the logo colours on purpose. Measured against white:
   * the logo orange is 2.28:1 and the logo red 4.78:1, so the orange is unreadable as
   * text and unusable behind white button text. The values here are 6.47:1 (red) and
   * 5.18:1 (orange) — same hues, still obviously the brand, and legible for someone
   * reading a tablet at arm's length under warehouse lighting.
   */
  accent: string
  /** the same colour at fill strength, for tinted backgrounds */
  accentSoft: string
  /**
   * The logo colour exactly as drawn, for decoration only.
   *
   * Never put text on this or in it — that is what `accent` is for. It exists so the brand
   * still reads as ITS colour somewhere on screen, rather than only as a darkened cousin.
   */
  accentVivid: string
  /** default locations seeded on first entry (if the brand has none yet) */
  defaultLocations: { name: string; type: LocationType }[]
  /**
   * The tab this brand occupies in the company's closing-stock workbook.
   *
   * One file carries both companies, a sheet each, and the two sets of books must not mix.
   * The import screen uses this to open on the right sheet instead of asking someone to
   * remember that PZM is the pizza one.
   */
  sheetKey: string
}

export const BRANDS: BrandDef[] = [
  {
    id: 'pizza',
    name: 'Pizza Mania',
    emoji: '🍕',
    productIcon: '🍕',
    accent: '#b91c1c',
    accentSoft: '#fef2f2',
    accentVivid: '#e01f26',
    defaultLocations: [
      { name: 'Main Warehouse', type: 'warehouse' },
      { name: 'Sarasin Branch', type: 'branch' },
      { name: 'On Nut Branch', type: 'branch' },
    ],
    sheetKey: 'PZM',
  },
  {
    id: 'lelapin',
    name: 'Le Lapin Sandwich Delivery',
    emoji: '🥪',
    productIcon: '🥖',
    // The orange from the brand artwork, deepened until white text on it is legible.
    accent: '#c2410c',
    accentSoft: '#fff7ed',
    accentVivid: '#f7941e',
    defaultLocations: [
      { name: 'Sukhumvit Warehouse', type: 'warehouse' },
      { name: 'Sarasin Warehouse', type: 'warehouse' },
      { name: 'On Nut Branch', type: 'branch' },
      { name: 'Sarasin Branch', type: 'branch' },
      { name: 'Sukhumvit Branch', type: 'branch' },
    ],
    sheetKey: 'LLP',
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
