import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { brandDef, setActiveBrand, type BrandId } from './brand'

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

  // Paint the whole interface in the open brand's colour. The tokens in index.css read
  // --brand-accent, so every `brand`-coloured utility follows from this one place rather
  // than from a red written into sixty components.
  useEffect(() => {
    const root = document.documentElement
    if (!brand) {
      root.style.removeProperty('--brand-accent')
      root.style.removeProperty('--brand-accent-soft')
      return
    }
    const def = brandDef(brand)
    root.style.setProperty('--brand-accent', def.accent)
    root.style.setProperty('--brand-accent-soft', def.accentSoft)
  }, [brand])

  return <Ctx.Provider value={{ brand, choose, reset }}>{children}</Ctx.Provider>
}

export function useBrand(): BrandState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
