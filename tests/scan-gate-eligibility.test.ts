import { describe, expect, test, vi } from 'vitest'
import { useScanGate } from '../src/lib/useScanGate'
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

describe('useScanGate eligibility gate (Transfer UX & fail-closed ordering)', () => {
  const pInDoc = p('inDoc', { barcode: '1111111111111' })
  const pNotInDoc = p('notInDoc', { barcode: '2222222222222' })
  const pDup1 = p('dup1', { barcode: '3333333333333' })
  const pDup2 = p('dup2', { barcode: '3333333333333' })
  const products = [pInDoc, pNotInDoc, pDup1, pDup2]

  test('non-document product does not trigger confirmation prompt and does not mutate', () => {
    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn() }
    const t = (k: string, vars?: any) => vars ? `${k} ${JSON.stringify(vars)}` : k
    const onIneligible = vi.fn()

    const lines = [{ productId: 'inDoc' }]

    const gate = useScanGate({
      products,
      onAdd,
      confirm,
      toast,
      t,
      isEligible: (prod) => lines.some((l) => l.productId === prod.id),
      onIneligible,
    } as any)

    gate('2222222222222')

    // Must NOT show confirmation prompt for non-document product
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(onIneligible).toHaveBeenCalledWith(pNotInDoc)
  })

  test('valid document member prompts legacy confirmation and adds on confirm', async () => {
    const onAdd = vi.fn()
    let resolveConfirm: (ok: boolean) => void = () => {}
    const confirm = vi.fn().mockImplementation(() => new Promise<boolean>((res) => { resolveConfirm = res }))
    const toast = { error: vi.fn() }
    const t = (k: string, vars?: any) => vars ? `${k} ${JSON.stringify(vars)}` : k
    const onIneligible = vi.fn()

    const lines = [{ productId: 'inDoc' }]

    const gate = useScanGate({
      products,
      onAdd,
      confirm,
      toast,
      t,
      isEligible: (prod) => lines.some((l) => l.productId === prod.id),
      onIneligible,
    } as any)

    gate('1111111111111')

    // Must show confirm dialog
    expect(confirm).toHaveBeenCalled()
    expect(onIneligible).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()

    // Confirm addition
    resolveConfirm(true)
    await Promise.resolve()

    expect(onAdd).toHaveBeenCalledWith(pInDoc)
  })

  test('duplicate product in brand catalog remains terminal duplicate reject even if one/both outside document', () => {
    const onAdd = vi.fn()
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = { error: vi.fn() }
    const t = (k: string, vars?: any) => vars ? `${k} ${JSON.stringify(vars)}` : k
    const isEligible = vi.fn().mockReturnValue(true)
    const onIneligible = vi.fn()

    const gate = useScanGate({
      products,
      onAdd,
      confirm,
      toast,
      t,
      isEligible,
      onIneligible,
    } as any)

    gate('3333333333333')

    // Resolution happens BEFORE eligibility: duplicate fails closed immediately
    expect(isEligible).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  test('membership removed while confirmation is pending fails closed at answer time', async () => {
    const onAdd = vi.fn()
    let resolveConfirm: (ok: boolean) => void = () => {}
    const confirm = vi.fn().mockImplementation(() => new Promise<boolean>((res) => { resolveConfirm = res }))
    const toast = { error: vi.fn() }
    const t = (k: string, vars?: any) => vars ? `${k} ${JSON.stringify(vars)}` : k
    const onIneligible = vi.fn()

    let lines = [{ productId: 'inDoc' }]

    const gate = useScanGate({
      products,
      onAdd,
      confirm,
      toast,
      t,
      isEligible: (prod) => lines.some((l) => l.productId === prod.id),
      onIneligible,
    } as any)

    gate('1111111111111')
    expect(confirm).toHaveBeenCalled()

    // While confirmation is open, document line is removed
    lines = []

    resolveConfirm(true)
    await Promise.resolve()

    // Fail-closed at answer time
    expect(onAdd).not.toHaveBeenCalled()
    expect(onIneligible).toHaveBeenCalledWith(pInDoc)
  })
})
