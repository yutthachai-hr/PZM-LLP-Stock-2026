import { describe, expect, test, vi, beforeEach } from 'vitest'
import { useScanGate } from '../src/lib/useScanGate'
import { clearScanCatalog } from '../src/lib/scanCatalog'
import { setActiveBrand } from '../src/brand/brand'
import type { Product } from '../src/types'

// Mock react hooks in pure function harness for useScanGate
vi.mock('react', () => ({
  useRef: (val: any) => ({ current: val }),
  useCallback: (fn: any) => fn,
  useEffect: (fn: any) => {
    // mounted
    fn()
  },
}))

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id.toUpperCase(),
  name: `Product ${id}`,
  category: 'cat',
  unit: 'Kilogram',
  unitType: 'KG',
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('useScanGate & scanCatalog authoritative cold-catalog contract', () => {
  beforeEach(() => {
    clearScanCatalog()
    setActiveBrand('pizza')
  })

  test('cold scan waits for authoritative server catalog and does NOT fail with false not_found', async () => {
    const item = p('p1', { name: 'REPEAT ITEM', barcode: '8851000111111' })
    let resolveServerCatalog!: (products: readonly Product[]) => void
    const catalogPromise = new Promise<readonly Product[]>((res) => {
      resolveServerCatalog = res
    })
    const loadCatalog = vi.fn().mockReturnValue(catalogPromise)

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [], // in-memory snapshot still empty!
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    // Trigger cold scan
    const scanPromise = gate('8851000111111')

    // At this moment, catalog has not arrived yet.
    // Must NOT show false not_found error!
    expect(toast.error).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()

    // Authoritative catalog finishes loading
    resolveServerCatalog([item])
    await scanPromise
    await Promise.resolve()

    // Now legacy confirmation MUST be displayed
    expect(confirm).toHaveBeenCalled()
    expect(onAdd).toHaveBeenCalledWith(item)
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('server read failure shows explicit read-error, no cache fallback, and retries on rescan', async () => {
    let failFetch = true
    const item = p('p1', { name: 'ITEM 1', barcode: '8851000111111' })
    const loadCatalog = vi.fn().mockImplementation(() => {
      if (failFetch) return Promise.reject(new Error('Network error'))
      return Promise.resolve([item])
    })

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    // Stale products cache present in options, but must NOT be used as cache fallback
    const gate = useScanGate({
      products: [item],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    // First scan fails
    await gate('8851000111111')
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    // Explicit read error toast shown
    expect(toast.error).toHaveBeenCalled()
    expect(toast.error.mock.calls[0][0]).not.toMatch(/ไม่พบบาร์โค้ด/)

    // Rescan retry succeeds
    failFetch = false
    await gate('8851000111111')
    expect(confirm).toHaveBeenCalled()
    expect(onAdd).toHaveBeenCalledWith(item)
  })

  test('genuinely empty server catalog returns not_found without inventing ready=products.length>0', async () => {
    const loadCatalog = vi.fn().mockResolvedValue([])
    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    await gate('8851000111111')
    // Server acknowledged empty catalog -> not_found is honest
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด 8851000111111 ในระบบ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('switching brand while catalog fetch is pending abandons queued scope', async () => {
    let resolveServerCatalog!: (products: readonly Product[]) => void
    const catalogPromise = new Promise<readonly Product[]>((res) => {
      resolveServerCatalog = res
    })
    const loadCatalog = vi.fn().mockReturnValue(catalogPromise)

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    const scanPromise = gate('8851000111111')

    // Brand switched to Le Lapin before catalog arrives
    setActiveBrand('lelapin')

    // Catalog resolves for Pizza
    resolveServerCatalog([p('p1', { barcode: '8851000111111' })])
    await scanPromise

    // Must NOT prompt or add because brand/epoch changed!
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('newer scan supersedes older pending scan', async () => {
    let resolveCatalog!: (products: readonly Product[]) => void
    const catalogPromise = new Promise<readonly Product[]>((res) => {
      resolveCatalog = res
    })

    const loadCatalog = vi.fn().mockReturnValue(catalogPromise)

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    // Scan 1 initiated
    const scan1 = gate('11111')
    // Scan 2 initiated while scan 1 in-flight
    const scan2 = gate('22222')

    // Catalog resolves with both items
    resolveCatalog([
      p('p1', { name: 'Item 1', barcode: '11111' }),
      p('p2', { name: 'Item 2', barcode: '22222' }),
    ])
    await Promise.all([scan1, scan2])

    // Scan 1 was superseded, so Item 1 was never added or confirmed for Scan 1
    // Scan 2 succeeded with Item 2
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }))
    expect(onAdd).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  test('exact case-sensitivity and leading zeros preserved', async () => {
    const pZero = p('pZero', { name: 'Zero', barcode: '00123' })
    const pCase = p('pCase', { name: 'Case', barcode: 'Code128-AB' })
    const loadCatalog = vi.fn().mockResolvedValue([pZero, pCase])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    // Leading zeros stripped ("123") must NOT match "00123"
    await gate('123')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด 123 ในระบบ'))
    expect(onAdd).not.toHaveBeenCalled()

    // Wrong case ("code128-ab") must NOT match "Code128-AB"
    await gate('code128-ab')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด code128-ab ในระบบ'))
    expect(onAdd).not.toHaveBeenCalled()

    // Exact matches succeed
    await gate('00123')
    expect(onAdd).toHaveBeenCalledWith(pZero)
  })

  test('duplicate and inactive in full catalog fail closed even if eligibility filter is active', async () => {
    const dup1 = p('dup1', { name: 'DUP 1', barcode: '8851000999999' })
    const dup2 = p('dup2', { name: 'DUP 2', barcode: '8851000999999' })
    const inact = p('inact', { name: 'INACT', barcode: '8851000888888', active: false })
    const loadCatalog = vi.fn().mockResolvedValue([dup1, dup2, inact])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    // Only dup1 is in document lines
    const isEligible = vi.fn().mockImplementation((prod: Product) => prod.id === 'dup1')

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      isEligible,
      loadCatalog,
    } as any)

    await gate('8851000999999')
    // Duplicate in catalog fails closed immediately, does not filter to dup1
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ซ้ำกับสินค้า 2 รายการ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()

    await gate('8851000888888')
    // Inactive fails closed
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ถูกปิดใช้งานแล้ว: "INACT"'))
    expect(confirm).not.toHaveBeenCalled()
  })

  test('revalidation at answer time refuses if product was deactivated on server while dialog was open', async () => {
    const itemActive = p('p1', { name: 'Item 1', barcode: '8851000555555', active: true })
    const itemDeactivated = p('p1', { name: 'Item 1', barcode: '8851000555555', active: false })

    let callCount = 0
    const loadCatalog = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve([itemActive])
      return Promise.resolve([itemDeactivated])
    })

    const onAdd = vi.fn()
    let resolveConfirm!: (ok: boolean) => void
    const confirm = vi.fn().mockImplementation(() => new Promise<boolean>((res) => { resolveConfirm = res }))
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [],
      onAdd,
      confirm,
      toast,
      t,
      loadCatalog,
    } as any)

    const scanPromise = gate('8851000555555')
    await new Promise((r) => setTimeout(r, 10))

    expect(confirm).toHaveBeenCalled()
    // User confirms
    resolveConfirm(true)
    await scanPromise

    // Answer time revalidation saw product deactivated on server -> must NOT add!
    expect(onAdd).not.toHaveBeenCalled()
  })
})
