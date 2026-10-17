import { describe, expect, test } from 'vitest'
import {
  DAY_MS,
  MOVEMENTS_CEILING,
  evaluateReportCompleteness,
  isSnapshotBackdated,
  mergeReportMovements,
  resolveReportHistoryScope,
  snapshotRewindCut,
  snapshotRewindRange,
} from '../src/lib/reportHistory'
import type { StockMovement } from '../src/types'
import { dayRange, dateInputToMs } from '../src/lib/format'

const TODAY = dateInputToMs('2026-10-17')
const PAST_DAY = dateInputToMs('2026-09-30')
const dummyDayRange = dayRange
const dummyDateToMs = dateInputToMs

test('invalid product dates and invalid/future snapshot days fail closed', () => {
  for (const scope of [
    resolveReportHistoryScope({ mode: 'movement', productId: 'p1', fromStr: '2026-10-09', toStr: '2026-10-08', asOfStr: '', loadAll: false, today: TODAY }, dayRange, dateInputToMs),
    ...['2026-02-31', '2026-10-18'].map(asOfStr => resolveReportHistoryScope({ mode: 'snapshot', productId: '', fromStr: '', toStr: '', asOfStr, loadAll: false, today: TODAY }, dayRange, dateInputToMs)),
  ]) expect(scope.validRange).toBe(false)
  expect(evaluateReportCompleteness({ mode: 'snapshot', historyStatus: 'idle', historyReady: false, validRange: false, productId: '', explicitRange: false, isBackdated: false }).canExport).toBe(false)
})

test('a stale live-window copy never undoes a later historical edit or void', () => {
  const newest = { ...makeMovement('edited', PAST_DAY), updatedAt: 500, voided: true }
  const stale = { ...newest, updatedAt: 100, voided: false }
  expect(mergeReportMovements([newest], [stale])[0].voided).toBe(true)
})

let seq = 0
function makeMovement(id: string, date: number, productId = 'p1'): StockMovement {
  seq++
  return {
    id,
    docNo: `DOC-${seq}`,
    type: 'receive',
    productId,
    productName: 'Paris Ham',
    unit: 'KG',
    qty: 10,
    date,
    byUserId: 'u1',
    byUserName: 'User 1',
    createdAt: date,
  }
}

describe('Historical Snapshot Rewind Bounds (Audit C-02 & D-2)', () => {
  test('cut is the end of the selected Bangkok day', () => {
    expect(snapshotRewindCut(PAST_DAY)).toBe(PAST_DAY + DAY_MS)
  })

  test('rewind range reaches MOVEMENTS_CEILING with no arbitrary device-clock limit', () => {
    const range = snapshotRewindRange(PAST_DAY)
    expect(range.from).toBe(PAST_DAY + DAY_MS)
    expect(range.to).toBe(Number.MAX_SAFE_INTEGER)
    expect(MOVEMENTS_CEILING).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('future-dated movements past 400 days fall inside the rewind query range', () => {
    const range = snapshotRewindRange(PAST_DAY)
    const futureMovementDate = PAST_DAY + 500 * DAY_MS
    expect(futureMovementDate).toBeGreaterThan(PAST_DAY + 400 * DAY_MS)
    expect(futureMovementDate).toBeGreaterThanOrEqual(range.from)
    expect(futureMovementDate).toBeLessThanOrEqual(range.to)
  })
})

describe('Historical Snapshot Scope Resolution & Gating', () => {
  test('snapshot for today uses live inventory and requires no historical movement rewind', () => {
    expect(isSnapshotBackdated(TODAY, TODAY)).toBe(false)
    const scope = resolveReportHistoryScope(
      {
        mode: 'snapshot',
        productId: '',
        fromStr: '',
        toStr: '',
        asOfStr: '2026-10-17',
        loadAll: false,
        today: TODAY,
      },
      dummyDayRange,
      dummyDateToMs,
    )
    expect(scope.isBackdated).toBe(false)
    expect(scope.queryEnabled).toBe(false)

    const completeness = evaluateReportCompleteness({
      mode: 'snapshot',
      historyStatus: 'idle',
      historyReady: false,
      validRange: true,
      productId: '',
      explicitRange: false,
      isBackdated: false,
    })
    expect(completeness.mayCalculate).toBe(true)
    expect(completeness.canExport).toBe(true)
    expect(completeness.status).toBe('complete')
  })

  test('backdated snapshot enables rewind query from cut to MOVEMENTS_CEILING', () => {
    expect(isSnapshotBackdated(PAST_DAY, TODAY)).toBe(true)
    const scope = resolveReportHistoryScope(
      {
        mode: 'snapshot',
        productId: '',
        fromStr: '',
        toStr: '',
        asOfStr: '2026-09-30',
        loadAll: false,
        today: TODAY,
      },
      dummyDayRange,
      dummyDateToMs,
    )
    expect(scope.isBackdated).toBe(true)
    expect(scope.queryEnabled).toBe(true)
    expect(scope.queryProductId).toBe('')
    expect(scope.queryFrom).toBe(snapshotRewindCut(PAST_DAY))
    expect(scope.queryTo).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('backdated snapshot blocks calculation and export while loading (prevents C-02 inflated stock)', () => {
    const completeness = evaluateReportCompleteness({
      mode: 'snapshot',
      historyStatus: 'loading',
      historyReady: false,
      validRange: true,
      productId: '',
      explicitRange: false,
      isBackdated: true,
    })
    expect(completeness.mayCalculate).toBe(false)
    expect(completeness.canExport).toBe(false)
    expect(completeness.status).toBe('loading')
  })

  test('backdated snapshot blocks calculation and export on error (never render false zero/empty)', () => {
    const completeness = evaluateReportCompleteness({
      mode: 'snapshot',
      historyStatus: 'error',
      historyReady: false,
      validRange: true,
      productId: '',
      explicitRange: false,
      isBackdated: true,
    })
    expect(completeness.mayCalculate).toBe(false)
    expect(completeness.canExport).toBe(false)
    expect(completeness.status).toBe('error')
  })

  test('backdated snapshot allows calculation and export once rewind read completes', () => {
    const completeness = evaluateReportCompleteness({
      mode: 'snapshot',
      historyStatus: 'complete',
      historyReady: true,
      validRange: true,
      productId: '',
      explicitRange: false,
      isBackdated: true,
    })
    expect(completeness.mayCalculate).toBe(true)
    expect(completeness.canExport).toBe(true)
    expect(completeness.status).toBe('complete')
  })
})

describe('Movement History Scope Resolution & Gating (Audit C-01)', () => {
  test('selected product queries full product ledger and gates calculation until complete', () => {
    const scope = resolveReportHistoryScope(
      {
        mode: 'movement',
        productId: 'prod-paris-ham',
        fromStr: '2026-10-08',
        toStr: '2026-10-15',
        asOfStr: '',
        loadAll: false,
        today: TODAY,
      },
      dummyDayRange,
      dummyDateToMs,
    )
    expect(scope.queryEnabled).toBe(true)
    expect(scope.queryProductId).toBe('prod-paris-ham')
    expect(scope.queryFrom).toBeUndefined() // full product history across all time

    // While loading, calculation and export MUST be blocked so opening balance is not 0
    const loadingComp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'loading',
      historyReady: false,
      validRange: true,
      productId: 'prod-paris-ham',
      explicitRange: false,
      isBackdated: false,
    })
    expect(loadingComp.mayCalculate).toBe(false)
    expect(loadingComp.canExport).toBe(false)
    expect(loadingComp.status).toBe('loading')

    // On complete, calculation and export are allowed
    const readyComp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'complete',
      historyReady: true,
      validRange: true,
      productId: 'prod-paris-ham',
      explicitRange: false,
      isBackdated: false,
    })
    expect(readyComp.mayCalculate).toBe(true)
    expect(readyComp.canExport).toBe(true)
  })

  test('global movement with explicit date range queries bounded range [from, to)', () => {
    const fromMs = Date.UTC(2026, 9, 1)
    const toMs = Date.UTC(2026, 9, 15)
    const scope = resolveReportHistoryScope(
      {
        mode: 'movement',
        productId: '',
        fromStr: '2026-10-01',
        toStr: '2026-10-15',
        asOfStr: '',
        loadAll: false,
        today: TODAY,
      },
      () => ({ from: fromMs, to: toMs }),
      dummyDateToMs,
    )
    expect(scope.queryEnabled).toBe(true)
    expect(scope.queryProductId).toBe('')
    expect(scope.queryFrom).toBe(fromMs)
    expect(scope.queryTo).toBe(toMs)

    const loadingComp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'loading',
      historyReady: false,
      validRange: true,
      productId: '',
      explicitRange: true,
      isBackdated: false,
    })
    expect(loadingComp.mayCalculate).toBe(false)
    expect(loadingComp.canExport).toBe(false)
  })

  test('invalid date range blocks calculation and export', () => {
    const scope = resolveReportHistoryScope(
      {
        mode: 'movement',
        productId: '',
        fromStr: '2026-10-15',
        toStr: '2026-10-01', // backwards!
        asOfStr: '',
        loadAll: false,
        today: TODAY,
      },
      () => ({ from: 1000, to: 500 }),
      dummyDateToMs,
    )
    expect(scope.validRange).toBe(false)
    expect(scope.queryEnabled).toBe(false)

    const comp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'idle',
      historyReady: false,
      validRange: false,
      productId: '',
      explicitRange: true,
      isBackdated: false,
    })
    expect(comp.mayCalculate).toBe(false)
    expect(comp.canExport).toBe(false)
    expect(comp.status).toBe('invalid-range')
  })

  test('default global movement suppresses running balances and marks status partial without eager fetch', () => {
    const scope = resolveReportHistoryScope(
      {
        mode: 'movement',
        productId: '',
        fromStr: '',
        toStr: '',
        asOfStr: '',
        loadAll: false,
        today: TODAY,
      },
      () => ({ from: -Infinity, to: Infinity }),
      dummyDateToMs,
    )
    // Does not eagerly query full ledger
    expect(scope.queryEnabled).toBe(false)
    expect(scope.explicitRange).toBe(false)

    const comp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'idle',
      historyReady: false,
      validRange: true,
      productId: '',
      explicitRange: false,
      isBackdated: false,
    })
    // Can calculate preview rows for live movements, but CANNOT export incomplete ledger
    expect(comp.mayCalculate).toBe(true)
    expect(comp.canExport).toBe(false)
    expect(comp.status).toBe('partial')
  })

  test('loadAll consent triggers full ledger query and enables export on completion', () => {
    const scope = resolveReportHistoryScope(
      {
        mode: 'movement',
        productId: '',
        fromStr: '',
        toStr: '',
        asOfStr: '',
        loadAll: true,
        today: TODAY,
      },
      () => ({ from: -Infinity, to: Infinity }),
      dummyDateToMs,
    )
    expect(scope.queryEnabled).toBe(true)
    expect(scope.queryProductId).toBe('')
    expect(scope.queryFrom).toBe(0)
    expect(scope.queryTo).toBe(Number.MAX_SAFE_INTEGER)

    const comp = evaluateReportCompleteness({
      mode: 'movement',
      historyStatus: 'complete',
      historyReady: true,
      validRange: true,
      productId: '',
      explicitRange: true,
      isBackdated: false,
    })
    expect(comp.mayCalculate).toBe(true)
    expect(comp.canExport).toBe(true)
    expect(comp.status).toBe('complete')
  })
})

describe('Movement Deduplication and Merging', () => {
  test('merges history and live movements without duplicate rows', () => {
    const h1 = makeMovement('m1', 100)
    const h2 = makeMovement('m2', 200)
    const l2 = makeMovement('m2', 200) // duplicate ID
    const l3 = makeMovement('m3', 300)

    const merged = mergeReportMovements([h1, h2], [l2, l3])
    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })
})
