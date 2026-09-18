import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLive } from './useLive'
import { stockView } from '../lib/inventoryRules/stockView'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import {
  COL,
  type Product,
  type StockLocation,
  type StockLevel,
  type StockMovement,
  type MinOverride,
  type AppUser,
  type AppNotification,
} from '../types'
import { NOTIFICATION_WINDOW_DAYS } from '../lib/inventoryRules/notifications'

interface DataState {
  products: Product[]
  /** Named for the interface language: the English name when the screen is in English. */
  locations: StockLocation[]
  /** As stored — the Thai name — for the screen that edits them. */
  rawLocations: StockLocation[]
  levels: StockLevel[]
  movements: StockMovement[]
  minOverrides: MinOverride[]
  users: AppUser[]
  /**
   * Notifications created in the last week, every recipient's — the bell filters them to
   * the signed-in person. The seventh listener (it took the slot `notes` had).
   */
  notifications: AppNotification[]
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
  /**
   * Whether this location is somewhere this product is actually kept.
   *
   * A branch is only responsible for a product once some has been there. Barley that has
   * never been sent to Sarasin is not "0 of 20 at Sarasin" — it is simply not a Sarasin
   * line, and counting it as one produced the same shortage three times over, once per
   * location, and buried the real ones.
   *
   * The exception is a product with no stock anywhere: that is a thing to buy, so it is
   * chased at the main warehouse, once.
   */
  tracksProduct: (locationId: string, productId: string) => boolean
}

const Ctx = createContext<DataState | null>(null)

// How far back the ledger is loaded on start-up. Every movement in the window is a billed
// read each time the app cold-starts on a device, and the collection only ever grows —
// without a bound, one page load eventually costs a whole day's free quota. Ninety days
// was three months of every receipt and issue at three sites on every cold start; thirty
// is what the dashboard and the everyday screens actually look at, and anything older is
// one click away on the screens that show history (LedgerWindowNotice).
const RECENT_DAYS = 30

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Only admins may list the roster (see firestore.rules); for anyone else the query would
  // be rejected, and the only screen that reads `users` is the admin section of Settings.
  const isAdmin = user?.role === 'admin'

  const { data: products, loading: pLoading } = useLive<Product>(COL.products)
  const { data: rawLocations, loading: lLoading } = useLive<StockLocation>(COL.locations)
  const { lang } = useI18n()
  // Every screen prints `location.name`; swapping it here is what makes "คลังหลัก" read
  // "Main Warehouse" everywhere at once when the interface is in English.
  const locations = useMemo(
    () => (lang === 'en' ? rawLocations.map((l) => (l.nameEn ? { ...l, name: l.nameEn } : l)) : rawLocations),
    [rawLocations, lang],
  )
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
  const { data: minOverrides } = useLive<MinOverride>(COL.minOverrides)
  const { data: users } = useLive<AppUser>(COL.users, { enabled: isAdmin })
  // Fixed for the session: a moving lower bound would re-subscribe (and re-read) every render.
  const [notificationsFrom] = useState(() => Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const { data: notifications } = useLive<AppNotification>(COL.notifications, {
    enabled: !!user,
    sinceField: 'createdAt',
    sinceValue: notificationsFrom,
  })

  const value = useMemo<DataState>(() => {
    const productMap = new Map(products.map((p) => [p.id, p]))
    const locationMap = new Map(locations.map((l) => [l.id, l]))
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
    // The same rule the cron Worker applies — see lib/inventoryRules/stockView.ts.
    const view = stockView({ locations, levels, minOverrides })

    return {
      products,
      locations,
      rawLocations,
      levels,
      movements,
      minOverrides,
      users,
      notifications,
      loading: pLoading || lLoading || sLoading || mLoading,
      movementsFrom,
      ensureMovementsFrom,
      productById: (id) => productMap.get(id),
      locationById: (id) => locationMap.get(id),
      qtyAt: view.qtyAt,
      qtyByUnit: (locationId, productId) => byUnit.get(`${locationId}__${productId}`) ?? [],
      minFor: view.minFor,
      tracksProduct: view.tracksProduct,
    }
  }, [
    products,
    locations,
    rawLocations,
    levels,
    movements,
    minOverrides,
    users,
    notifications,
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
