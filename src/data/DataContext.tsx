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
    const levelMap = new Map(levels.map((l) => [`${l.locationId}__${l.productId}`, l.qty]))
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
