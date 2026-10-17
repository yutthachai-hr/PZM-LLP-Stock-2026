import type { StockMovement } from '../types'
import { isLegacyUnitRow } from './inventoryRules/uom'

export const DAY_MS = 86_400_000

/** End of time: the rewind read must never stop short of a row that exists. */
export const MOVEMENTS_CEILING = Number.MAX_SAFE_INTEGER

export type ReportMode = 'overview' | 'movement' | 'snapshot' | 'activity' | 'cost'

export interface SnapshotRewindRange {
  from: number
  to: number
}

/**
 * End of Bangkok day cut: a movement on that day counts as already on the shelf by end of day.
 * Anything dated at or after cut needs to be rewound.
 */
export function snapshotRewindCut(asOfDay: number): number {
  return asOfDay + DAY_MS
}

/**
 * Historical snapshot query bounds: everything from cut to end of time (MOVEMENTS_CEILING).
 * No arbitrary 400-day or Date.now limit.
 */
export function snapshotRewindRange(asOfDay: number): SnapshotRewindRange {
  return {
    from: snapshotRewindCut(asOfDay),
    to: MOVEMENTS_CEILING,
  }
}

export function isSnapshotBackdated(asOfDay: number | null, today: number): boolean {
  return asOfDay !== null && asOfDay < today
}

export interface ReportScopeParams {
  mode: ReportMode
  productId: string
  fromStr: string
  toStr: string
  asOfStr: string
  loadAll: boolean
  today: number
}

export interface ResolvedReportHistoryScope {
  /** Should useMovementHistory be enabled? */
  queryEnabled: boolean
  /** Product ID to query (or '' for range query) */
  queryProductId: string
  /** Range from (if range query) */
  queryFrom?: number
  /** Range to (if range query) */
  queryTo?: number
  /** Is date range valid? (only relevant for movement mode) */
  validRange: boolean
  /** Is movement query an explicit date range or load-all */
  explicitRange: boolean
  /** Is snapshot backdated before today? */
  isBackdated: boolean
  asOfDay: number | null
}

export function resolveReportHistoryScope(
  params: ReportScopeParams,
  parseDayRange: (fromStr: string, toStr: string) => { from: number; to: number },
  dateToMs: (dateStr: string) => number,
): ResolvedReportHistoryScope {
  const { mode, productId, fromStr, toStr, asOfStr, loadAll, today } = params

  if (mode === 'movement') {
    const range = parseDayRange(fromStr, toStr)
    const validRange = !Number.isNaN(range.from) && !Number.isNaN(range.to) && range.from < range.to
    const explicitRange = !productId && (!!fromStr || !!toStr || loadAll)

    if (productId) {
      return {
        queryEnabled: true,
        queryProductId: productId,
        queryFrom: undefined,
        queryTo: undefined,
        validRange,
        explicitRange: false,
        isBackdated: false,
        asOfDay: null,
      }
    }

    if (explicitRange && validRange) {
      return {
        queryEnabled: true,
        queryProductId: '',
        queryFrom: Math.max(0, range.from),
        queryTo: Math.min(MOVEMENTS_CEILING, range.to),
        validRange: true,
        explicitRange: true,
        isBackdated: false,
        asOfDay: null,
      }
    }

    return {
      queryEnabled: false,
      queryProductId: '',
      queryFrom: undefined,
      queryTo: undefined,
      validRange,
      explicitRange,
      isBackdated: false,
      asOfDay: null,
    }
  }

  if (mode === 'snapshot') {
    const asOfDay = asOfStr ? dateToMs(asOfStr) : null
    const isBackdated = isSnapshotBackdated(asOfDay, today)
    if (asOfDay !== null && (!Number.isFinite(asOfDay) || asOfDay > today)) {
      return { queryEnabled: false, queryProductId: '', validRange: false, explicitRange: false, isBackdated: false, asOfDay }
    }

    if (!isBackdated) {
      return {
        queryEnabled: false,
        queryProductId: '',
        queryFrom: undefined,
        queryTo: undefined,
        validRange: true,
        explicitRange: false,
        isBackdated: false,
        asOfDay,
      }
    }

    if (productId) {
      return {
        queryEnabled: true,
        queryProductId: productId,
        queryFrom: undefined,
        queryTo: undefined,
        validRange: true,
        explicitRange: false,
        isBackdated: true,
        asOfDay,
      }
    }

    const { from, to } = snapshotRewindRange(asOfDay!)
    return {
      queryEnabled: true,
      queryProductId: '',
      queryFrom: from,
      queryTo: to,
      validRange: true,
      explicitRange: false,
      isBackdated: true,
      asOfDay,
    }
  }

  return {
    queryEnabled: false,
    queryProductId: '',
    queryFrom: undefined,
    queryTo: undefined,
    validRange: true,
    explicitRange: false,
    isBackdated: false,
    asOfDay: null,
  }
}

export interface ReportCompleteness {
  /** Can calculations (stockCard / movedSince) run on loaded data? */
  mayCalculate: boolean
  /** Can user export Excel / PDF? */
  canExport: boolean
  /** Visual history status to report in notice */
  status: 'idle' | 'loading' | 'empty' | 'complete' | 'error' | 'partial' | 'invalid-range'
}

export function evaluateReportCompleteness(opts: {
  mode: ReportMode
  historyStatus: 'idle' | 'loading' | 'empty' | 'complete' | 'error' | 'partial'
  historyReady: boolean
  validRange: boolean
  productId: string
  explicitRange: boolean
  isBackdated: boolean
}): ReportCompleteness {
  const { mode, historyStatus, historyReady, validRange, productId, explicitRange, isBackdated } = opts

  if ((mode === 'movement' || mode === 'snapshot') && !validRange) {
    return { mayCalculate: false, canExport: false, status: 'invalid-range' }
  }
  if (mode === 'movement') {
    if (productId || explicitRange) {
      if (historyStatus === 'loading' || historyStatus === 'idle') {
        return { mayCalculate: false, canExport: false, status: 'loading' }
      }
      if (historyStatus === 'error') {
        return { mayCalculate: false, canExport: false, status: 'error' }
      }
      if (historyReady) {
        return { mayCalculate: true, canExport: true, status: historyStatus }
      }
      return { mayCalculate: false, canExport: false, status: historyStatus }
    }
    // Default global movement: partial live window
    return { mayCalculate: true, canExport: false, status: 'partial' }
  }

  if (mode === 'snapshot') {
    if (!isBackdated) {
      // Live stock on hand
      return { mayCalculate: true, canExport: true, status: 'complete' }
    }
    // Backdated snapshot requires complete rewind
    if (historyStatus === 'loading' || historyStatus === 'idle') {
      return { mayCalculate: false, canExport: false, status: 'loading' }
    }
    if (historyStatus === 'error') {
      return { mayCalculate: false, canExport: false, status: 'error' }
    }
    if (historyReady) {
      return { mayCalculate: true, canExport: true, status: historyStatus }
    }
    return { mayCalculate: false, canExport: false, status: historyStatus }
  }

  // Other modes (overview, cost, activity)
  return { mayCalculate: true, canExport: true, status: 'complete' }
}

export function mergeReportMovements(
  history: readonly StockMovement[],
  live: readonly StockMovement[],
): StockMovement[] {
  if (history.length === 0) return [...live]
  const map = new Map<string, StockMovement>()
  for (const m of history) map.set(m.id, m)
  for (const m of live) {
    const held = map.get(m.id)
    if (!held || (m.updatedAt ?? m.createdAt) > (held.updatedAt ?? held.createdAt)) map.set(m.id, m)
  }
  return [...map.values()]
}

/** Unknown conversions and distinct raw units cannot contribute to one scalar balance. */
export function hasMixedLegacyUnits(
  rows: readonly StockMovement[],
  scope: { productId?: string; locationId?: string } = {},
): boolean {
  const units = new Map<string, string>()
  for (const row of rows) {
    if (row.voided || (scope.productId && row.productId !== scope.productId)) continue
    if (scope.locationId && row.fromLocationId !== scope.locationId && row.toLocationId !== scope.locationId) continue
    if (isLegacyUnitRow(row)) return true
    const prior = units.get(row.productId)
    if (prior !== undefined && prior !== row.unit) return true
    units.set(row.productId, row.unit)
  }
  return false
}
