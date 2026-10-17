import { describe, expect, test, vi, beforeEach } from 'vitest'
import { useScanGate } from '../src/lib/useScanGate'
import { setActiveBrand } from '../src/brand/brand'
import type { Product } from '../src/types'
import type { Backend } from '../src/backend/types'

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

function createMockBackend(initialDocs: Product[] = []) {
  const store = new Map<string, Product>(initialDocs.map((doc) => [doc.id, doc]))
  const calls = {
    getOne: 0,
    getBy: 0,
    getAll: 0,
    getRange: 0,
  }
  const be: any = {
    mode: 'local',
    forBrand: () => be,
    getOne: vi.fn(async (_col: string, id: string, _opts?: any) => {
      calls.getOne++
      return store.get(id) ?? null
    }),
    getBy: vi.fn(async (_col: string, field: string, val: any, _opts?: any) => {
      calls.getBy++
      return [...store.values()].filter((item: any) => (item[field] ?? '').trim() === String(val).trim())
    }),
    getAll: vi.fn(async () => {
      calls.getAll++
      return [...store.values()]
    }),
    getRange: vi.fn(async () => {
      calls.getRange++
      return [...store.values()]
    }),
    _store: store,
    _calls: calls,
  }
  return be as Backend & { _calls: typeof calls; _store: Map<string, Product> }
}

describe('useScanGate R3 authoritative quota-safe contract', () => {
  beforeEach(() => {
    setActiveBrand('pizza')
  })

  test('C1: quota proof - scan path uses getOne+getBy only (no getAll/getRange) and verifies read quotas', async () => {
    const item = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const dup1 = p('dup1', { name: 'Dup 1', barcode: '8851000222222' })
    const dup2 = p('dup2', { name: 'Dup 2', barcode: '8851000222222' })
    const mockBackend = createMockBackend([item, dup1, dup2])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item, dup1, dup2],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    // 1. not_found scan: 0 server reads
    await gate('9999999999999')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด 9999999999999 ในระบบ'))
    expect(mockBackend._calls.getAll).toBe(0)
    expect(mockBackend._calls.getRange).toBe(0)
    expect(mockBackend._calls.getOne).toBe(0)
    expect(mockBackend._calls.getBy).toBe(0)

    // 2. duplicate in catalog: 0 server reads
    await gate('8851000222222')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ซ้ำกับสินค้า 2 รายการ'))
    expect(mockBackend._calls.getAll).toBe(0)
    expect(mockBackend._calls.getRange).toBe(0)
    expect(mockBackend._calls.getOne).toBe(0)
    expect(mockBackend._calls.getBy).toBe(0)

    // 3. legacy match prompt + answer: exactly <= 4 reads (2 getOne + 2 getBy), 0 getAll/getRange
    await gate('8851000111111')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(item)
    expect(mockBackend._calls.getAll).toBe(0)
    expect(mockBackend._calls.getRange).toBe(0)
    expect(mockBackend._calls.getOne).toBe(2)
    expect(mockBackend._calls.getBy).toBe(2)
    const totalReads = mockBackend._calls.getOne + mockBackend._calls.getBy
    expect(totalReads).toBeLessThanOrEqual(4)
  })

  test('C1: cold-before-sync refuses with catalogue loading message and performs 0 server reads', async () => {
    const item = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const mockBackend = createMockBackend([item])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [], // cold empty
      productsServerSynced: false, // not server-synced yet
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    await gate('8851000111111')

    // Must NOT say not_found! Must refuse with loading message
    expect(toast.error).toHaveBeenCalledWith('กำลังโหลดข้อมูลสินค้า — กรุณาสแกนอีกครั้ง')
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()

    // 0 server reads
    expect(mockBackend._calls.getAll).toBe(0)
    expect(mockBackend._calls.getRange).toBe(0)
    expect(mockBackend._calls.getOne).toBe(0)
    expect(mockBackend._calls.getBy).toBe(0)
  })

  test('I1: scan arriving while confirmation is pending does NOT silently drop and adds nothing', async () => {
    const item1 = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const item2 = p('p2', { name: 'Item 2', barcode: '8851000222222' })
    const mockBackend = createMockBackend([item1, item2])

    let resolveConfirm!: (ok: boolean) => void
    const confirm = vi.fn().mockImplementation(() => new Promise<boolean>((res) => { resolveConfirm = res }))
    const onAdd = vi.fn()
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item1, item2],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    // First scan triggers pending confirm
    const scan1 = gate('8851000111111')
    await new Promise((r) => setTimeout(r, 10))
    expect(confirm).toHaveBeenCalledTimes(1)

    // Second scan arrives while confirmation is pending!
    await gate('8851000222222')

    // Must display explicit message (info or error), NOT silent drop
    const pendingMsg = 'กำลังรอยืนยันรายการก่อนหน้า — กรุณาสแกนใหม่หลังยืนยัน'
    const notified = toast.info.mock.calls.some((c) => c[0] === pendingMsg) ||
      toast.error.mock.calls.some((c) => c[0] === pendingMsg)
    expect(notified).toBe(true)

    // Item 2 must NOT be added
    expect(onAdd).not.toHaveBeenCalledWith(item2)

    // Resolve first confirm
    resolveConfirm(true)
    await scan1
    expect(onAdd).toHaveBeenCalledWith(item1)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  test('server listener error shows read error message and refuses scan', async () => {
    const item = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const mockBackend = createMockBackend([item])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item],
      productsServerSynced: false,
      productsListenerError: new Error('Permission denied'),
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    await gate('8851000111111')
    expect(toast.error).toHaveBeenCalledWith('เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง')
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('server duplicate check catches duplicate created on another device and fails closed', async () => {
    const item1 = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const item1Dup = p('p1_other', { name: 'Item 1 Remote Duplicate', barcode: '8851000111111' })
    // Synced client only knows item1, but server backend has item1 AND item1Dup
    const mockBackend = createMockBackend([item1, item1Dup])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item1],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    await gate('8851000111111')
    // Server duplicate check fails closed with duplicate error before prompting
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ซ้ำกับสินค้า 2 รายการ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('server check catches hard-deleted product and fails closed', async () => {
    const item = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    // Synced client has item, but server deleted it
    const mockBackend = createMockBackend([])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    await gate('8851000111111')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด 8851000111111 ในระบบ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('server check catches barcode rebound to another barcode and fails closed', async () => {
    const itemClient = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    const itemServer = p('p1', { name: 'Item 1', barcode: '8851000999999' }) // Rebound on server!
    const mockBackend = createMockBackend([itemServer])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [itemClient],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    await gate('8851000111111')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด 8851000111111 ในระบบ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('revalidation at answer time refuses if product was deactivated on server while dialog was open', async () => {
    const itemActive = p('p1', { name: 'Item 1', barcode: '8851000555555', active: true })
    const mockBackend = createMockBackend([itemActive])

    const onAdd = vi.fn()
    let resolveConfirm!: (ok: boolean) => void
    const confirm = vi.fn().mockImplementation(() => new Promise<boolean>((res) => { resolveConfirm = res }))
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [itemActive],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    const scanPromise = gate('8851000555555')
    await new Promise((r) => setTimeout(r, 10))
    expect(confirm).toHaveBeenCalledTimes(1)

    // Product deactivated on server while dialog was open!
    mockBackend._store.set('p1', { ...itemActive, active: false })

    resolveConfirm(true)
    await scanPromise

    // Answer time revalidation saw deactivated product -> must fail closed with inactive toast
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ถูกปิดใช้งานแล้ว: "Item 1"'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('exact case-sensitivity and leading zeros preserved', async () => {
    const pZero = p('pZero', { name: 'Zero', barcode: '00123' })
    const pCase = p('pCase', { name: 'Case', barcode: 'Code128-AB' })
    const mockBackend = createMockBackend([pZero, pCase])

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [pZero, pCase],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

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

  test('switching brand while server check is in flight abandons scope', async () => {
    const item = p('p1', { name: 'Item 1', barcode: '8851000111111' })
    let resolveGetOne!: (doc: Product | null) => void
    const getOnePromise = new Promise<Product | null>((res) => {
      resolveGetOne = res
    })
    const mockBackend = createMockBackend([item])
    mockBackend.getOne = vi.fn().mockImplementation(() => getOnePromise)

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    const scanPromise = gate('8851000111111')

    // Brand switched before server check completes
    setActiveBrand('lelapin')

    resolveGetOne(item)
    await scanPromise

    // Must NOT confirm or add because brand changed
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('newer scan supersedes older pending scan', async () => {
    const item1 = p('p1', { name: 'Item 1', barcode: '11111' })
    const item2 = p('p2', { name: 'Item 2', barcode: '22222' })
    let resolveGetOne1!: (doc: Product | null) => void
    const getOne1Promise = new Promise<Product | null>((res) => {
      resolveGetOne1 = res
    })
    const mockBackend = createMockBackend([item1, item2])
    mockBackend.getOne = vi.fn().mockImplementation((_col: string, id: string) => {
      if (id === 'p1') return getOne1Promise
      return Promise.resolve(item2)
    })

    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn(), info: vi.fn() }
    const t = (k: string, vars?: any) => (vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k)

    const gate = useScanGate({
      products: [item1, item2],
      productsServerSynced: true,
      onAdd,
      confirm,
      toast,
      t,
      backend: mockBackend,
    })

    const scan1 = gate('11111')
    const scan2 = gate('22222')

    resolveGetOne1(item1)
    await Promise.all([scan1, scan2])

    // Scan 1 was superseded, so only Item 2 was confirmed and added
    expect(onAdd).toHaveBeenCalledWith(item2)
    expect(onAdd).not.toHaveBeenCalledWith(item1)
  })
})
