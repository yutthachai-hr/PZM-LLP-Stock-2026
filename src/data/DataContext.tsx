import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLive } from './useLive'
import { useAuth } from '../auth/AuthContext'
import {
  COL,
  type Product,
  type StockLocation,
  type StockLevel,
  type StockMovement,
  type Note,
  type MinOverride,
  type AppUser,
} from '../types'

interface DataState {
  products: Product[]
  locations: StockLocation[]
  levels: StockLevel[]
  movements: StockMovement[]
  notes: Note[]
  minOverrides: MinOverride[]
  users: AppUser[]
  loading: boolean

  /** Business date of the oldest movement currently subscribed to. */
  movementsFrom: number
  /**
   * Widen the movement window back to `date` if it does not already reach that far.
   * Screens that let the user pick an older period must call this, or the rows before
   * the window simply will not be there.
   */
  ensureMovementsFrom: (date: number) => void

  // selectors
  productById: (id: string) => Product | undefined
  locationById: (id: string) => StockLocation | undefined
  qtyAt: (locationId: string, productId: string) => number
  /**
   * Every unit this product has a non-zero balance in at this location, base unit first.
   *
   * Usually one row. More than one means two people keyed the same goods differently —
   * "10 Pack" and "2 KG" — and the screens show both rather than guessing a conversion.
   */
  qtyByUnit: (locationId: string, productId: string) => { unit: string; qty: number }[]
  minFor: (product: Product, locationId: string) => number
}

const Ctx = createContext<DataState | null>(null)

// How far back the ledger is loaded on start-up. Every movement in the window is a billed
// read each time the app cold-starts on a device, and the collection only ever grows —
// without a bound, one page load eventually costs a whole day's free quota.
const RECENT_DAYS = 90

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Only admins may list the roster (see firestore.rules); for anyone else the query would
  // be rejected, and the only screen that reads `users` is the admin section of Settings.
  const isAdmin = user?.role === 'admin'

  const { data: products, loading: pLoading } = useLive<Product>(COL.products)
  const { data: locations, loading: lLoading } = useLive<StockLocation>(COL.locations)
  const { data: levels, loading: sLoading } = useLive<StockLevel>(COL.stockLevels)
  const [movementsFrom, setMovementsFrom] = useState(
    () => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000,
  )
  const ensureMovementsFrom = useCallback((date: number) => {
    setMovementsFrom((cur) => (date < cur ? date : cur))
  }, [])

  const { data: movements, loading: mLoading } = useLive<StockMovement>(COL.movements, {
    sinceField: 'date',
    sinceValue: movementsFrom,
  })
  const { data: notes } = useLive<Note>(COL.notes)
  const { data: minOverrides } = useLive<MinOverride>(COL.minOverrides)
  const { data: users } = useLive<AppUser>(COL.users, { enabled: isAdmin })

  const value = useMemo<DataState>(() => {
    const productMap = new Map(products.map((p) => [p.id, p]))
    const locationMap = new Map(locations.map((l) => [l.id, l]))
    // Only the product's own unit. A row for a unit someone keyed carries the same
    // locationId and productId, so keying this map on those alone would let a Pack balance
    // overwrite the KG one and every total on every screen would quietly be the wrong row.
    const levelMap = new Map(
      levels.filter((l) => !l.unit).map((l) => [`${l.locationId}__${l.productId}`, l.qty]),
    )
    // Every unit a product has a balance in, per location, base unit first. Balances are
    // never added across units — ten Pack and two KG are two numbers a person reconciles.
    const byUnit = new Map<string, { unit: string; qty: number }[]>()
    for (const l of levels) {
      if (!l.qty) continue
      const key = `${l.locationId}__${l.productId}`
      const unit = l.unit ?? productMap.get(l.productId)?.unitType ?? ''
      const row = { unit, qty: l.qty }
      const list = byUnit.get(key)
      if (!list) byUnit.set(key, [row])
      else if (l.unit) list.push(row)
      else list.unshift(row)
    }
    const overrideMap = new Map(
      minOverrides.map((o) => [`${o.locationId}__${o.productId}`, o.minStock]),
    )

    return {
      products,
      locations,
      levels,
      movements,
      notes,
      minOverrides,
      users,
      loading: pLoading || lLoading || sLoading || mLoading,
      movementsFrom,
      ensureMovementsFrom,
      productById: (id) => productMap.get(id),
      locationById: (id) => locationMap.get(id),
      qtyAt: (locationId, productId) => levelMap.get(`${locationId}__${productId}`) ?? 0,
      qtyByUnit: (locationId, productId) => byUnit.get(`${locationId}__${productId}`) ?? [],
      minFor: (product, locationId) =>
        overrideMap.get(`${locationId}__${product.id}`) ?? product.minStock ?? 0,
    }
  }, [
    products,
    locations,
    levels,
    movements,
    notes,
    minOverrides,
    users,
    pLoading,
    lLoading,
    sLoading,
    mLoading,
    movementsFrom,
    ensureMovementsFrom,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
