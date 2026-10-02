import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { brandDef, setActiveBrand, type BrandId } from './brand'

interface BrandState {
  brand: BrandId | null // null => not chosen yet (show picker)
  choose: (b: BrandId) => void
  reset: () => void
}

const Ctx = createContext<BrandState | null>(null)

// Per tab: a refresh keeps the brand, a new visit still starts at the picker.
const SS_KEY = 'pmstock:v1:tabBrand'
function tabBrand(): BrandId | null {
  try {
    const b = sessionStorage.getItem(SS_KEY)
    if (b === 'pizza' || b === 'lelapin') {
      setActiveBrand(b)
      return b
    }
  } catch {
    /* ignore */
  }
  return null
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<BrandId | null>(tabBrand)

  function choose(b: BrandId) {
    setActiveBrand(b) // update the data-layer resolver BEFORE the app subscribes
    setBrand(b)
    try {
      sessionStorage.setItem(SS_KEY, b)
    } catch {
      /* ignore */
    }
  }
  function reset() {
    setBrand(null)
    try {
      sessionStorage.removeItem(SS_KEY)
    } catch {
      /* ignore */
    }
  }

  // Paint the whole interface in the open brand's colour. The tokens in index.css read
  // --brand-accent, so every `brand`-coloured utility follows from this one place rather
  // than from a red written into sixty components.
  useEffect(() => {
    const root = document.documentElement
    if (!brand) {
      root.style.removeProperty('--brand-accent')
      root.style.removeProperty('--brand-accent-soft')
      root.style.removeProperty('--brand-accent-vivid')
      return
    }
    const def = brandDef(brand)
    root.style.setProperty('--brand-accent', def.accent)
    root.style.setProperty('--brand-accent-soft', def.accentSoft)
    root.style.setProperty('--brand-accent-vivid', def.accentVivid)
  }, [brand])

  return <Ctx.Provider value={{ brand, choose, reset }}>{children}</Ctx.Provider>
}

export function useBrand(): BrandState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
