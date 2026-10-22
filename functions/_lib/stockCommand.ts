// Trusted stock commands (R33 PhaseB prototype, default-off, no caller switched to it).
// See docs/design/r31-trusted-stock-boundary.md. The browser cannot set who it is, which brand
// it may touch, or the ledger revision: the actor is the live user record, brand access is an
// explicit server policy, and `stockLedger_<brand>` is incremented here and nowhere else.
import type { Transactional } from '../../src/backend/tx'
import { AppError } from '../../src/i18n/AppError'
import { planAdjust, type AdjustLine } from '../../src/services/adjustPlan'
import { levelId } from '../../src/lib/levelKey'
import { requireCountQty, roundQty } from '../../src/lib/validate'
import { COL, type AppUser, type StockLevel } from '../../src/types'
import { StockConflict, type StockBrand } from './stockCommandStore'

const BRANDS: readonly StockBrand[] = ['pizza', 'lelapin', 'rnd']

export interface StockCommandDeps {
  enabled: boolean
  store: (brand: StockBrand) => Transactional
  verifyUser: (authorization: string | null) => Promise<string | null>
  /**
   * Whether this user may write this brand's stock. AppUser has siteIds, not brands, so there
   * is no grant to derive one from: the caller must supply a reviewed policy (none is shipped).
   */
  brandAllowed: (user: AppUser, brand: StockBrand) => boolean
  now: () => number
}

type CountLine = { productId: string; productName: string; unit: string; countedQty: number; expectedQty: number }
type Input =
  | { command: 'adjust'; brand: StockBrand; operationId: string; payload: { locationId: string; date: number; note?: string; lines: AdjustLine[] } }
  | { command: 'count'; brand: StockBrand; operationId: string; payload: { locationId: string; date: number; note?: string; lines: CountLine[] } }

export interface StockCommandResult {
  docNo: string | null
  ledgerRev: number
  replayed: boolean
}

export class StockCommandError extends Error {
  constructor(
    readonly code: 'invalid' | 'forbidden' | 'stale' | 'operation_conflict',
    readonly detail?: unknown,
  ) {
    super(code)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Parse once at the boundary; unknown keys are refused, not ignored. */
export function parseStockCommand(raw: unknown): Input {
  const bad = () => new StockCommandError('invalid')
  if (!isObj(raw) || !isObj(raw.payload)) throw bad()
  const { command, brand, operationId, payload } = raw
  if (Object.keys(raw).some((k) => !['command', 'brand', 'operationId', 'payload'].includes(k))) throw bad()
  if (command !== 'adjust' && command !== 'count') throw bad()
  if (!BRANDS.includes(brand as StockBrand)) throw bad()
  if (typeof operationId !== 'string' || !UUID.test(operationId)) throw bad()
  const { locationId, date, note, lines } = payload
  if (Object.keys(payload).some((k) => !['locationId', 'date', 'note', 'lines'].includes(k))) throw bad()
  if (!str(locationId, 200) || !num(date) || (note !== undefined && !str(note, 2000))) throw bad()
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) throw bad()
  const common = ['productId', 'productName', 'unit']
  const keys = command === 'adjust' ? [...common, 'entryUnit', 'entryQty', 'qty', 'note', 'direction', 'reason'] : [...common, 'countedQty', 'expectedQty']
  for (const l of lines) {
    if (!isObj(l) || Object.keys(l).some((k) => !keys.includes(k))) throw bad()
    if (!str(l.productId, 200) || !str(l.productName, 300) || !str(l.unit, 40)) throw bad()
    if (command === 'count' && !(num(l.countedQty) && num(l.expectedQty))) throw bad()
  }
  return raw as Input
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((n) => n.toString(16).padStart(2, '0')).join('')
}

export async function runStockCommand(deps: Pick<StockCommandDeps, 'store' | 'brandAllowed' | 'now'>, raw: unknown, uid: string): Promise<StockCommandResult> {
  const input = parseStockCommand(raw)
  const { brand } = input
  const opKey = 'stockop_' + (await sha256(`${uid}|${brand}|${input.operationId}`))
  const ledgerKey = `stockLedger_${brand}`
  const fingerprint = await sha256(JSON.stringify([input.command, brand, input.payload]))

  return deps.store(brand).transaction(async (tx) => {
    await tx.prefetch?.([
      { collection: COL.users, id: uid },
      { collection: COL.revokedUsers, id: uid },
      { collection: COL.meta, id: opKey },
      { collection: COL.meta, id: ledgerKey },
    ])
    const user = await tx.get<AppUser>(COL.users, uid)
    const revoked = await tx.get(COL.revokedUsers, uid)
    if (!user?.active || revoked || !deps.brandAllowed(user, brand)) throw new StockCommandError('forbidden')

    // A lost response is recovered by the same operation ID; the same ID with other content is a mistake.
    const receipt = await tx.get<{ fingerprint: string; result: { docNo: string | null; ledgerRev: number } }>(COL.meta, opKey)
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new StockCommandError('operation_conflict')
      return { ...receipt.result, replayed: true }
    }
    const rev = (await tx.get<{ value: number }>(COL.meta, ledgerKey))?.value ?? 0
    const actor = { id: uid, name: user.name }
    const { locationId, date, note } = input.payload

    let lines: AdjustLine[]
    if (input.command === 'adjust') {
      lines = input.payload.lines
    } else {
      // A count states what the shelf held when the person saw `expectedQty` on screen. If the
      // balance has moved since, the difference they meant is unknown: refuse, never overwrite.
      const levels = await Promise.all(input.payload.lines.map((l) => tx.get<StockLevel>(COL.stockLevels, levelId(locationId, l.productId))))
      const stale = input.payload.lines.flatMap((l, i) => {
        const cur = levels[i]?.qty ?? 0
        return roundQty(cur) === roundQty(l.expectedQty) ? [] : [{ productId: l.productId, expectedQty: l.expectedQty, currentQty: cur }]
      })
      if (stale.length) throw new StockCommandError('stale', stale)
      lines = input.payload.lines.flatMap((l, i): AdjustLine[] => {
        const delta = roundQty(requireCountQty(l.countedQty) - (levels[i]?.qty ?? 0))
        if (delta === 0) return []
        return [{ productId: l.productId, productName: l.productName, unit: l.unit, qty: Math.abs(delta), direction: delta > 0 ? 'in' : 'out', reason: 'count' }]
      })
    }

    let docNo: string | null = null
    if (lines.length) {
      const planned = await planAdjust(tx, { lines, locationId, date, actor, note }, (mv) => tx.set(COL.movements, crypto.randomUUID().replace(/-/g, ''), mv as Record<string, unknown>))
      docNo = planned.commit()
    }
    const now = deps.now()
    const ledgerRev = docNo ? rev + 1 : rev
    if (docNo) tx.set(COL.meta, ledgerKey, { value: ledgerRev, updatedAt: now, updatedBy: uid })
    tx.set(COL.meta, opKey, { uid, brand, command: input.command, fingerprint, result: { docNo, ledgerRev }, createdAt: now })
    return { docNo, ledgerRev, replayed: false }
  })
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

export async function handleStockCommand(request: Request, deps: StockCommandDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method' }, 405)
  if (!deps.enabled) return json({ error: 'not_configured' }, 503)
  const uid = await deps.verifyUser(request.headers.get('authorization'))
  if (!uid) return json({ error: 'unauthorized' }, 401)
  // Bound the bytes actually streamed, not the untrusted Content-Length.
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'invalid' }, 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  let body: unknown
  try {
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      bytes += r.value.length
      if (bytes > 200_000) {
        await reader.cancel()
        return json({ error: 'too_large' }, 413)
      }
      chunks.push(r.value)
    }
    const all = new Uint8Array(bytes)
    let offset = 0
    for (const c of chunks) all.set(c, (offset += c.length) - c.length)
    body = JSON.parse(new TextDecoder().decode(all))
  } catch {
    return json({ error: 'invalid' }, 400)
  }
  try {
    return json(await runStockCommand(deps, body, uid))
  } catch (e) {
    if (e instanceof StockCommandError) {
      const status = e.code === 'forbidden' ? 403 : e.code === 'invalid' ? 400 : 409
      return json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }, status)
    }
    if (e instanceof AppError) return json({ error: 'refused', message: e.message }, 422)
    if (e instanceof StockConflict) return json({ error: 'conflict' }, 409)
    // A lost database response may already have committed: retry with the same operationId.
    return json({ error: 'unknown_outcome' }, 503)
  }
}
