// R4 remediation — exact-only scan resolution, confirm-time revalidation, concurrent line
// safety and the camera session-generation controller.
//
// Every assertion here drives a module the UI actually imports: src/lib/barcode.ts,
// src/lib/barcodeSelection.ts (used by src/lib/useScanGate.ts, which LineBuilder / Adjust /
// TransferReceivePage call), src/lib/lines.ts (LineBuilder.addProduct) and
// src/lib/cameraScan.ts (BarcodeScanner). No helper is asserted that the screens do not run.
import { describe, expect, test, vi } from 'vitest'
import { resolveBarcode } from '../src/lib/barcode'
import { decideScan, revalidateScan } from '../src/lib/barcodeSelection'
import { appendLineOnce } from '../src/lib/lines'
import { CameraScanController, type CameraScanDeps, type StreamLike } from '../src/lib/cameraScan'
import type { Product } from '../src/types'

const p = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id.toUpperCase(),
  name: id.toUpperCase(),
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

describe('R4 C1 — code 128 is exact; a case-mismatched token is NOT_FOUND', () => {
  test('wrong-case alphanumeric never becomes a candidate, only not_found', () => {
    const catalog = [p('case', { barcode: 'AbC128' })]

    expect(resolveBarcode(catalog, 'abc128').status).toBe('not_found')
    expect(decideScan(catalog, 'abc128')).toEqual({ kind: 'reject', reason: 'not_found', code: 'abc128' })

    // The exact token still resolves (case is respected, not dropped).
    expect(resolveBarcode(catalog, 'AbC128').status).toBe('legacy_unverified')

    // Control: a code matching nothing is also not_found, so the divergence above is the
    // case fold, and the fix is that both are now the same terminal state.
    expect(resolveBarcode(catalog, 'zzz999').status).toBe('not_found')
  })

  test('distinct Code 128 casings are never merged, and neither is a folded duplicate', () => {
    const distinct = [
      p('upper', { barcode: 'ABC-128' }),
      p('lower', { barcode: 'abc-128' }),
    ]
    expect(resolveBarcode(distinct, 'ABC-128')).toMatchObject({ status: 'legacy_unverified', product: { id: 'upper' } })
    expect(resolveBarcode(distinct, 'abc-128')).toMatchObject({ status: 'legacy_unverified', product: { id: 'lower' } })
    // A fold of both used to report `duplicate`; now no exact token exists, so not_found.
    expect(resolveBarcode(distinct, 'Abc-128').status).toBe('not_found')
  })
})

describe('R4 C5 — a scan never falls back to SKU, name or a loose match', () => {
  const catalog = [p('coke', { sku: 'BEV-01', name: 'COKE CAN' })]

  test('a SKU or a name is a reject, never a product', () => {
    expect(decideScan(catalog, 'BEV-01').kind).toBe('reject')
    expect(decideScan(catalog, 'coke').kind).toBe('reject')
    expect(decideScan(catalog, 'BEV-01')).toMatchObject({ reason: 'not_found' })
  })

  test('duplicate and inactive are terminal rejects carrying no product', () => {
    const dup = [p('one', { barcode: 'DUP' }), p('two', { barcode: 'DUP' }), p('third', { sku: 'DUP', barcode: 'OTHER' })]
    expect(decideScan(dup, 'DUP')).toMatchObject({ kind: 'reject', reason: 'duplicate', duplicateCount: 2 })

    const inactive = [p('old', { barcode: 'OLD', active: false }), p('third', { sku: 'OLD', barcode: 'OTHER' })]
    expect(decideScan(inactive, 'OLD')).toMatchObject({ kind: 'reject', reason: 'inactive', inactiveName: 'OLD' })
  })

  test('positive path: an exact barcode requires human confirmation', () => {
    expect(decideScan([p('v', { barcode: 'V1' })], 'V1')).toMatchObject({ kind: 'legacy', product: { id: 'v' } })
    expect(decideScan([p('l', { barcode: 'L1' })], 'L1')).toMatchObject({ kind: 'legacy', product: { id: 'l' } })
  })
})

describe('R4 C2 — the confirmation revalidates against the LIVE catalog, not the open-time array', () => {
  const code = '8851000777777'

  test('accepts the expected product when the catalog is unchanged', () => {
    expect(revalidateScan([p('P1', { barcode: code })], code, 'P1')?.id).toBe('P1')
  })

  test('refuses when the product was deactivated while the dialog was open', () => {
    expect(revalidateScan([p('P1', { barcode: code, active: false })], code, 'P1')).toBeNull()
  })

  test('refuses when the barcode was rebound to a different code in the same brand', () => {
    expect(revalidateScan([p('P1', { barcode: 'DIFFERENT-CODE' })], code, 'P1')).toBeNull()
  })

  test('refuses when a duplicate registration appeared after the prompt opened', () => {
    expect(revalidateScan([p('P1', { barcode: code }), p('P2', { barcode: code })], code, 'P1')).toBeNull()
  })

  test('refuses when the exact code now belongs to a different product id', () => {
    expect(revalidateScan([p('P9', { barcode: code })], code, 'P1')).toBeNull()
  })
})

describe('R4 C3 — a confirmed line is appended to the LATEST list', () => {
  const line = (productId: string) => ({ productId })

  test('a line added by another path while the dialog was open is not dropped', () => {
    const afterConcurrentAdd = [line('A'), line('B')]
    expect(appendLineOnce(afterConcurrentAdd, line('P1')).map((l) => l.productId)).toEqual(['A', 'B', 'P1'])
  })

  test('a product already on the list is never added as a twin', () => {
    expect(appendLineOnce([line('A'), line('P1')], line('P1')).map((l) => l.productId)).toEqual(['A', 'P1'])
  })
})

// ---------------------------------------------------------------------------
// C4 — camera session generations. Fakes, not mocks of an internal helper: the real
// controller is driven with controlled promises, exactly as a close→reopen produces them.
// ---------------------------------------------------------------------------

interface StreamLikeWithTracks extends StreamLike {
  getTracks(): { stop(): void }[]
}

function fakeStream(): { stream: StreamLikeWithTracks; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn()
  const stream: StreamLikeWithTracks = { getTracks: () => [{ stop }] }
  return { stream, stop }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function baseDeps(over: Partial<CameraScanDeps>): CameraScanDeps {
  return {
    getUserMedia: async () => fakeStream().stream,
    getVideo: () => ({ srcObject: null, play: async () => {} }),
    getDetector: () => undefined,
    startZxing: async () => {
      throw new Error('zxing unavailable')
    },
    onCode: vi.fn(),
    onError: vi.fn(),
    onStream: vi.fn(),
    ...over,
  }
}

describe('R4 C4 — the camera controller is fenced by session generation', () => {
  test('a getUserMedia that resolves after close is stopped and never assigned', async () => {
    const gum = deferred<StreamLike>()
    const onStream = vi.fn()
    const ctrl = new CameraScanController(baseDeps({ getUserMedia: () => gum.promise, onStream }))

    ctrl.open()
    ctrl.close()
    const { stream, stop } = fakeStream()
    gum.resolve(stream)
    await flush()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(onStream).not.toHaveBeenCalled()
  })

  test('reopen invalidates the previous session: its stale detect frame never calls onCode', async () => {
    const onCode = vi.fn()
    const gum1 = deferred<StreamLike>()
    const gum2 = deferred<StreamLike>()
    const queue = [gum1.promise, gum2.promise]
    const pending: ((hits: { rawValue?: string }[]) => void)[] = []
    let timer = 0
    const ctrl = new CameraScanController(
      baseDeps({
        getUserMedia: () => queue.shift()!,
        getDetector: () =>
          class {
            detect = () => new Promise<{ rawValue?: string }[]>((r) => pending.push(r))
          },
        onCode,
        setTimer: (fn) => {
          void fn
          return ++timer
        },
        clearTimer: vi.fn(),
      }),
    )

    ctrl.open() // session 1
    gum1.resolve(fakeStream().stream)
    await flush()

    ctrl.close()
    ctrl.open() // session 2
    gum2.resolve(fakeStream().stream)
    await flush()

    // Session 1's in-flight detect resolves late, after the reopen.
    expect(pending.length).toBeGreaterThanOrEqual(2)
    pending[0]([{ rawValue: 'STALE' }])
    await flush()
    expect(onCode).not.toHaveBeenCalledWith('STALE')

    // Session 2 still works.
    pending[1]([{ rawValue: 'FRESH' }])
    await flush()
    expect(onCode).toHaveBeenCalledWith('FRESH')
  })

  test('zxing controls created after close are stopped immediately', async () => {
    const controls = { stop: vi.fn() }
    const zx = deferred<{ stop: () => void }>()
    const ctrl = new CameraScanController(
      baseDeps({
        startZxing: () => zx.promise,
      }),
    )

    ctrl.open()
    await flush()
    ctrl.close()
    zx.resolve(controls)
    await flush()

    expect(controls.stop).toHaveBeenCalledTimes(1)
  })

  test('close stops every track of the live stream', async () => {
    const { stream, stop } = fakeStream()
    const ctrl = new CameraScanController(
      baseDeps({
        getUserMedia: async () => stream,
        getDetector: () => class {
          detect = () => Promise.resolve([])
        },
        setTimer: () => 1,
        clearTimer: vi.fn(),
      }),
    )

    ctrl.open()
    await flush()
    ctrl.close()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(ctrl.isActive()).toBe(false)
  })
})
