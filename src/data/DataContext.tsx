import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLive } from './useLive'
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

  // selectors
  productById: (id: string) => Product | undefined
  locationById: (id: string) => StockLocation | undefined
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { data: products, loading: pLoading } = useLive<Product>(COL.products)
  const { data: locations, loading: lLoading } = useLive<StockLocation>(COL.locations)
  const { data: levels, loading: sLoading } = useLive<StockLevel>(COL.stockLevels)
  const { data: movements, loading: mLoading } = useLive<StockMovement>(COL.movements)
  const { data: notes } = useLive<Note>(COL.notes)
  const { data: minOverrides } = useLive<MinOverride>(COL.minOverrides)
  const { data: users } = useLive<AppUser>(COL.users)

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
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
