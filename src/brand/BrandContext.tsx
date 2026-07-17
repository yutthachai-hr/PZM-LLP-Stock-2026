import { createContext, useContext, useState, type ReactNode } from 'react'
import { setActiveBrand, type BrandId } from './brand'

interface BrandState {
  brand: BrandId | null // null => not chosen yet (show picker)
  choose: (b: BrandId) => void
  reset: () => void
}

const Ctx = createContext<BrandState | null>(null)

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<BrandId | null>(null)

  function choose(b: BrandId) {
    setActiveBrand(b) // update the data-layer resolver BEFORE the app subscribes
    setBrand(b)
  }
  function reset() {
    setBrand(null)
  }

  return <Ctx.Provider value={{ brand, choose, reset }}>{children}</Ctx.Provider>
}

export function useBrand(): BrandState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
