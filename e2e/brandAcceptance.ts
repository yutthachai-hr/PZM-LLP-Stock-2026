import type { Page } from '@playwright/test'

export interface SubscriptionStart {
  method: string
  logical: string
  resolved: string
  resolver: string
  pinned: string | null
  epoch: number
}

/** Test-only observer: forwards real backend calls, captures names, never records documents/tokens. */
export async function observeBackendStarts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const backendPath = '/src/backend/index.ts'
    const brandPath = '/src/brand/brand.ts'
    const { backend, BACKEND_MODE } = await import(backendPath)
    const { getBrand, resolveCollection, brandEpoch } = await import(brandPath)
    if (BACKEND_MODE !== 'cloud') throw new Error('Real Emulator cloud backend required')
    const w = window as unknown as { __brandAcceptance?: { starts: SubscriptionStart[] } }
    if (w.__brandAcceptance) return
    w.__brandAcceptance = { starts: [] }
    const visited = new WeakSet<object>()
    function wrap(db: Record<string, unknown>, pinned: string | null = null): Record<string, unknown> {
      if (visited.has(db)) return db
      visited.add(db)
      for (const method of ['subscribe', 'subscribeOne', 'getAll', 'getRange', 'getBy', 'getOne', 'query', 'getMany']) {
        const original = db[method]
        if (typeof original !== 'function') continue
        db[method] = function (this: unknown, logical: string, ...rest: unknown[]) {
          w.__brandAcceptance!.starts.push({ method, logical, resolved: resolveCollection(logical, pinned ?? undefined), resolver: getBrand(), pinned, epoch: brandEpoch() })
          return Reflect.apply(original, this, [logical, ...rest])
        }
      }
      const factory = db.forBrand
      if (typeof factory === 'function') {
        db.forBrand = function (this: unknown, b: string) {
          return wrap(Reflect.apply(factory, this, [b]), b)
        }
      }
      return db
    }
    wrap(backend)
  })
}

/** Read the CURRENT React tree's consumed BrandContext value, not label/storage inference. */
export async function actualBrandState(page: Page): Promise<{ context: string | null; resolver: string; accent: string }> {
  return page.evaluate(async () => {
    const brandPath = '/src/brand/brand.ts'
    const { getBrand } = await import(brandPath)
    const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .find(b => /^(Brand|แบรนด์): /.test(b.getAttribute('aria-label') ?? '') && b.checkVisibility())
    if (!button) throw new Error('Visible BrandSwitcher consumer missing')
    interface Fiber {
      return: Fiber | null
      child: Fiber | null
      sibling: Fiber | null
      stateNode: unknown
      dependencies?: { firstContext: Dependency | null }
    }
    interface Dependency { next: Dependency | null; memoizedValue: unknown }
    const key = Object.keys(button).find(k => k.startsWith('__reactFiber$'))
    if (!key) throw new Error('React context probe unavailable; do not substitute label')
    let root = (button as unknown as Record<string, Fiber>)[key]
    while (root.return) root = root.return
    const current = (root.stateNode as { current: Fiber }).current
    if (!current) throw new Error('React current root missing')
    const pending = [current]
    let host: Fiber | undefined
    while (pending.length) {
      const f = pending.pop()!
      if (f.stateNode === button) { host = f; break }
      if (f.child) pending.push(f.child)
      if (f.sibling) pending.push(f.sibling)
    }
    for (let f = host; f; f = f.return ?? undefined) {
      for (let d = f.dependencies?.firstContext; d; d = d.next) {
        const v = d.memoizedValue as { brand?: string | null; choose?: unknown; reset?: unknown } | null
        if (v && Object.hasOwn(v, 'brand') && typeof v.choose === 'function' && typeof v.reset === 'function') {
          return { context: v.brand ?? null, resolver: getBrand(), accent: getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim() }
        }
      }
    }
    throw new Error('Actual consumed BrandContext dependency missing')
  })
}

export async function backendStarts(page: Page): Promise<SubscriptionStart[]> {
  return page.evaluate(() => (window as unknown as { __brandAcceptance: { starts: SubscriptionStart[] } }).__brandAcceptance.starts)
}
