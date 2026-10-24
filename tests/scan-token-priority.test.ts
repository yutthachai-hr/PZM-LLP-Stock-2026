// R18 S4 follow-up: the literal token wins over any keyboard-layout guess.
//
// Measured ground truth on the existing Windows Thai (Kedmanee) layout HKL 0x41e041e:
//   0=จ 1=ๅ 2=/ 3=- 4=ภ 5=ถ 6=ุ 7=ึ 8=ค 9=ต
// (GetKeyboardLayoutList + MapVirtualKeyExW + ToUnicodeEx; no layout was activated).
// These fixtures are portable copies of that mapping, not OS calls.
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { useScanGate } from '../src/lib/useScanGate'
import { normalizeScanToken, resolveBarcode } from '../src/lib/barcode'
import { setActiveBrand } from '../src/brand/brand'
import type { Product } from '../src/types'

// Pure-function harness for the React hook, as tests/scan-catalog-gate.test.ts does.
vi.mock('react', () => ({
  useRef: (val: any) => ({ current: val }),
  useCallback: (fn: any) => fn,
  useEffect: (fn: any) => {
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

/** Kedmanee digit-row output for 0123456789012 (raw keystrokes, digit 3 = '-'). */
const THAI_ZERO_ROW = 'จๅ/-ภถุึคตจๅ/'
/** Kedmanee digit-row output for 8851111222222. */
const THAI_CHEESE_ROW = 'คคถๅๅๅๅ//////'

const t = (k: string, vars?: any) =>
  vars ? k.replace(/\{(\w+)\}/g, (_: string, f: string) => String(vars[f] ?? '')) : k

function useGateHarness(products: Product[], server: Product[] = products) {
  const store = new Map(server.map((doc) => [doc.id, doc]))
  const be: any = {
    mode: 'local',
    forBrand: () => be,
    getOne: vi.fn(async (_c: string, id: string) => store.get(id) ?? null),
    getBy: vi.fn(async (_c: string, field: string, val: any) =>
      [...store.values()].filter((item: any) => (item[field] ?? '').trim() === String(val).trim()),
    ),
  }
  const onAdd = vi.fn()
  const confirm = vi.fn().mockResolvedValue(true)
  const toast = { error: vi.fn(), info: vi.fn() }
  const gate = useScanGate({ products, productsServerSynced: true, onAdd, confirm, toast, t, backend: be })
  return { gate, onAdd, confirm, toast, be, store }
}

beforeEach(() => {
  setActiveBrand('pizza')
})

describe('normalizeScanToken: the actual Kedmanee digit row', () => {
  test('digit 3 is "-" and leading zeros survive', () => {
    expect(normalizeScanToken(THAI_ZERO_ROW)).toBe('0123456789012')
    expect(resolveBarcode([p('zero', { barcode: '0123456789012' })], normalizeScanToken(THAI_ZERO_ROW))).toMatchObject({
      status: 'legacy_unverified',
      product: { id: 'zero' },
    })
  })

  test('"_" is not a measured digit-row key: that token stays literal', () => {
    expect(normalizeScanToken('จๅ/_ภถุึคตจๅ/')).toBe('จๅ/_ภถุึคตจๅ/')
  })

  test('ASCII punctuation, slashes and leading zeros are untouched when literal', () => {
    expect(normalizeScanToken('885-123')).toBe('885-123')
    expect(normalizeScanToken('/123/')).toBe('/123/')
    expect(normalizeScanToken('0123456789012')).toBe('0123456789012')
    expect(normalizeScanToken('ABC-128')).toBe('ABC-128')
    expect(normalizeScanToken('คุกกี้')).toBe('คุกกี้')
  })
})

describe('useScanGate: raw literal precedence', () => {
  const literal = p('literal', { name: 'LITERAL RAW', barcode: THAI_CHEESE_ROW })
  const digits = p('digits', { name: 'DIGIT PRODUCT', barcode: '8851111222222' })

  test('an exact raw barcode beats the keyboard-layout translation', async () => {
    const { gate, onAdd, confirm } = useGateHarness([literal, digits])
    await gate(THAI_CHEESE_ROW)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(literal)
    expect(onAdd).not.toHaveBeenCalledWith(digits)
  })

  test('an inactive raw barcode is reported, never translated into an active product', async () => {
    const retired = p('retired', { name: 'RETIRED RAW', barcode: THAI_CHEESE_ROW, active: false })
    const { gate, onAdd, confirm, toast } = useGateHarness([retired, digits])
    await gate(THAI_CHEESE_ROW)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('RETIRED RAW'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('a duplicate raw barcode fails closed instead of translating', async () => {
    const dup2 = p('dup2', { name: 'LITERAL RAW 2', barcode: THAI_CHEESE_ROW })
    const { gate, onAdd, confirm, toast } = useGateHarness([literal, dup2, digits])
    await gate(THAI_CHEESE_ROW)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ซ้ำกับสินค้า 2 รายการ'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('a translated keyboard token still resolves when no literal product exists', async () => {
    const { gate, onAdd } = useGateHarness([digits])
    await gate(THAI_CHEESE_ROW)
    expect(onAdd).toHaveBeenCalledWith(digits)
  })
})

describe('useScanGate: camera tokens stay literal', () => {
  const literal = p('literal', { name: 'LITERAL RAW', barcode: THAI_CHEESE_ROW })
  const digits = p('digits', { name: 'DIGIT PRODUCT', barcode: '8851111222222' })

  test('a camera-decoded token is never run through the keyboard map', async () => {
    // The digits product alone would be found by the keyboard map; the camera saw Thai text.
    const { gate, onAdd, confirm, toast } = useGateHarness([digits])
    await gate(THAI_CHEESE_ROW, { literal: true })
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ไม่พบบาร์โค้ด'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test('a camera-decoded raw barcode matches its own product', async () => {
    const { gate, onAdd } = useGateHarness([literal, digits])
    await gate(THAI_CHEESE_ROW, { literal: true })
    expect(onAdd).toHaveBeenCalledWith(literal)
  })
})

describe('useScanGate: the translated fallback is verified against the raw code too', () => {
  const digits = p('digits', { name: 'DIGIT PRODUCT', barcode: '8851111222222' })
  const ghost = p('ghost', { name: 'LATE RAW CLAIM', barcode: THAI_CHEESE_ROW })

  test('a raw barcode that exists only on the server refuses the translated match', async () => {
    // Local catalog is stale: the raw code is not in it, but the server has it.
    const { gate, onAdd, confirm, toast } = useGateHarness([digits], [digits, ghost])
    await gate(THAI_CHEESE_ROW)
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  test('a brand switch during the server check refuses the pending add', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const local = useGateHoldHarness([digits], held)
    // The verification read is in flight when the brand changes.
    const pending = local.gate(THAI_CHEESE_ROW)
    setActiveBrand('lelapin')
    release?.()
    await pending
    expect(local.confirm).not.toHaveBeenCalled()
    expect(local.onAdd).not.toHaveBeenCalled()
  })
})

/** Same gate, but the backend reads wait on `held` before answering. */
function useGateHoldHarness(products: Product[], held: Promise<void>) {
  const store = new Map(products.map((doc) => [doc.id, doc]))
  const be: any = {
    mode: 'local',
    forBrand: () => be,
    getOne: vi.fn(async (_c: string, id: string) => {
      await held
      return store.get(id) ?? null
    }),
    getBy: vi.fn(async (_c: string, field: string, val: any) => {
      await held
      return [...store.values()].filter((item: any) => (item[field] ?? '').trim() === String(val).trim())
    }),
  }
  const onAdd = vi.fn()
  const confirm = vi.fn().mockResolvedValue(true)
  const toast = { error: vi.fn(), info: vi.fn() }
  const gate = useScanGate({ products, productsServerSynced: true, onAdd, confirm, toast, t, backend: be })
  return { gate, onAdd, confirm, toast }
}
