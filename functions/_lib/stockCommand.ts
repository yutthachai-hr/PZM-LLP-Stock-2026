// Trusted stock commands (R33 PhaseB prototype, default-off, no caller switched to it).
// See docs/design/r31-trusted-stock-boundary.md. The browser cannot set who it is, which brand
// it may touch, or the ledger revision: the actor is the live user record, brand access is an
// explicit server policy, and `stockLedger_<brand>` is incremented here and nowhere else.
import type { Transactional } from '../../src/backend/tx'
import { AppError } from '../../src/i18n/AppError'
import { planAdjust, type AdjustLine } from '../../src/services/adjustPlan'
import { levelId } from '../../src/lib/levelKey'
import { requireCountQty, roundQty } from '../../src/lib/validate'
import { COL, type AppUser, type Product, type PurchaseOrder, type StockLevel, type StockMovement, type Transfer } from '../../src/types'
import { canUserAccessBranch, isManager, liveItems } from '../../src/lib/transferStatus'
import { planApproveTransfer } from '../../src/services/transferPlan'
import { sameUnit } from '../../src/lib/units'
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
type Envelope = { brand: StockBrand; operationId: string; expectedRev: number | null }
type Input = Envelope &
  (
    | { command: 'adjust'; payload: { locationId: string; date: number; note: string | null; lines: AdjustLine[] } }
    | { command: 'count'; payload: { locationId: string; date: number; note: string | null; lines: CountLine[] } }
    | { command: 'transferApprove'; payload: { transferId: string; expectedRevision: number; note: string | null } }
    | { command: 'poApprove'; payload: { poId: string } }
  )

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

/**
 * Parse once at the boundary; unknown keys are refused, not ignored. The result is rebuilt in a
 * fixed key order, so its JSON is canonical: the same request in another key order replays.
 * shortcut: base-unit lines only (no entryUnit/entryQty), so the server never trusts a client's
 * unit conversion; add server-side conversion from the product's unitConversions before a
 * screen that keys other units is switched over.
 */
export function parseStockCommand(raw: unknown): Input {
  const bad = () => new StockCommandError('invalid')
  if (!isObj(raw) || !isObj(raw.payload)) throw bad()
  const { command, brand, operationId, expectedRev, payload } = raw
  if (Object.keys(raw).some((k) => !['command', 'brand', 'operationId', 'expectedRev', 'payload'].includes(k))) throw bad()
  if (command !== 'adjust' && command !== 'count' && command !== 'transferApprove' && command !== 'poApprove') throw bad()
  if (!BRANDS.includes(brand as StockBrand)) throw bad()
  if (typeof operationId !== 'string' || !UUID.test(operationId)) throw bad()
  if (expectedRev !== undefined && !(Number.isSafeInteger(expectedRev) && (expectedRev as number) >= 0)) throw bad()
  const envelopeOf = (): Envelope => ({ brand: brand as StockBrand, operationId, expectedRev: (expectedRev as number | undefined) ?? null })
  if (command === 'poApprove') {
    if (Object.keys(payload).some((k) => k !== 'poId') || !str(payload.poId, 200) || !/^[A-Za-z0-9_-]+$/.test(payload.poId as string)) throw bad()
    return { command, ...envelopeOf(), payload: { poId: payload.poId as string } }
  }
  if (command === 'transferApprove') {
    // shortcut: no line edits at approval on the trusted path; the manager approves the lines as
    // submitted. Accept an items list (with the same checks as the browser) when a screen needs it.
    const { transferId, expectedRevision, note } = payload
    if (Object.keys(payload).some((k) => !['transferId', 'expectedRevision', 'note'].includes(k))) throw bad()
    if (!str(transferId, 200) || !/^[A-Za-z0-9_-]+$/.test(transferId as string)) throw bad()
    if (!(Number.isSafeInteger(expectedRevision) && (expectedRevision as number) >= 0)) throw bad()
    if (note !== undefined && !str(note, 2000)) throw bad()
    return { command, ...envelopeOf(), payload: { transferId: transferId as string, expectedRevision: expectedRevision as number, note: (note as string | undefined) ?? null } }
  }
  const { locationId, date, note, lines } = payload
  if (Object.keys(payload).some((k) => !['locationId', 'date', 'note', 'lines'].includes(k))) throw bad()
  if (!str(locationId, 200) || !num(date) || (note !== undefined && !str(note, 2000))) throw bad()
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) throw bad()
  const common = ['productId', 'productName', 'unit']
  const keys = command === 'adjust' ? [...common, 'qty', 'note', 'direction', 'reason'] : [...common, 'countedQty', 'expectedQty']
  for (const l of lines) {
    if (!isObj(l) || Object.keys(l).some((k) => !keys.includes(k))) throw bad()
    if (!str(l.productId, 200) || !str(l.productName, 300) || !str(l.unit, 40)) throw bad()
    if (command === 'count' && !(num(l.countedQty) && num(l.expectedQty))) throw bad()
    if (command === 'adjust' && !(num(l.qty) && str(l.direction, 10) && str(l.reason, 60) && (l.note === undefined || str(l.note, 2000)))) throw bad()
  }
  const envelope = envelopeOf()
  const head = { locationId: locationId as string, date: date as number, note: (note as string | undefined) ?? null }
  const rows = lines as Record<string, unknown>[]
  if (command === 'count') {
    const counted = rows.map((l) => ({ productId: l.productId, productName: l.productName, unit: l.unit, countedQty: l.countedQty, expectedQty: l.expectedQty }) as CountLine)
    return { command, ...envelope, payload: { ...head, lines: counted } }
  }
  const adjusted = rows.map((l) => ({ productId: l.productId, productName: l.productName, unit: l.unit, qty: l.qty, direction: l.direction, reason: l.reason, ...(l.note === undefined ? {} : { note: l.note }) }) as AdjustLine)
  return { command, ...envelope, payload: { ...head, lines: adjusted } }
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
  // Canonical by construction (parseStockCommand). expectedRev is a precondition, not content.
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

    // Replays recover an outcome, not an old grant: authorize live sites/role before receipts.
    const requireSite = (locationId: string) => {
      if (!canUserAccessBranch(user, locationId)) throw new StockCommandError('forbidden')
    }
    if (input.command === 'poApprove') {
      const po = await tx.get<PurchaseOrder>(COL.purchaseOrders, input.payload.poId)
      if (!po) throw new AppError('ไม่พบใบสั่งซื้อ')
      requireSite(po.locationId)
    } else if (input.command === 'transferApprove') {
      if (!isManager(user.role)) throw new StockCommandError('forbidden')
      const t = await tx.get<Transfer>(COL.transfers, input.payload.transferId)
      if (!t) throw new AppError('ไม่พบเอกสาร')
      requireSite(t.fromLocationId)
      requireSite(t.toLocationId)
    } else {
      requireSite(input.payload.locationId)
    }

    // A lost response is recovered by the same operation ID; the same ID with other content is a mistake.
    const receipt = await tx.get<{ fingerprint: string; result: { docNo: string | null; ledgerRev: number } }>(COL.meta, opKey)
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new StockCommandError('operation_conflict')
      return { ...receipt.result, replayed: true }
    }
    const rev = (await tx.get<{ value: number }>(COL.meta, ledgerKey))?.value ?? 0
    // The brand's ledger moved since the caller looked: whatever it meant to file is unknown.
    if (input.expectedRev !== null && input.expectedRev !== rev) throw new StockCommandError('stale', { expectedRev: input.expectedRev, ledgerRev: rev })
    const actor = { id: uid, name: user.name }
    const now = deps.now()
    const finish = (docNo: string | null) => {
      const ledgerRev = docNo ? rev + 1 : rev
      if (docNo) tx.set(COL.meta, ledgerKey, { value: ledgerRev, updatedAt: now, updatedBy: uid })
      tx.set(COL.meta, opKey, { uid, brand, command: input.command, fingerprint, result: { docNo, ledgerRev }, createdAt: now })
      return { docNo, ledgerRev, replayed: false }
    }
    const file = (mv: Omit<StockMovement, 'id'>) => tx.set(COL.movements, crypto.randomUUID().replace(/-/g, ''), mv as Record<string, unknown>)

    if (input.command === 'poApprove') {
      // B4/approvedAt: who approved and when are the server's to write, from the live user and
      // its own clock. Who may approve is unchanged (any active user, as the browser allows).
      const po = await tx.get<PurchaseOrder>(COL.purchaseOrders, input.payload.poId)
      if (!po) throw new AppError('ไม่พบใบสั่งซื้อ')
      if (po.status !== 'draft') throw new StockCommandError('stale', { status: po.status })
      tx.set(COL.purchaseOrders, po.id, { ...po, status: 'ordered', orderedAt: now, approvedBy: uid, approvedByName: user.name, approvedAt: now, updatedAt: now })
      return finish(null)
    }

    if (input.command === 'transferApprove') {
      // S2: stock leaves a branch for transit only through a real transfer, in the state and
      // revision the manager saw, approved by a manager the server knows.
      const { transferId, expectedRevision, note } = input.payload
      const t = await tx.get<Transfer>(COL.transfers, transferId)
      if (t) {
        const items = liveItems(t.items)
        const masters = await Promise.all(items.map((i) => tx.get<Product>(COL.products, i.productId)))
        items.forEach((i, n) => {
          const p = masters[n]
          // Same rule as adjust/count: the master's unit, and no client-made unit conversion.
          if ((p && !sameUnit(i.unit, p.unitType)) || i.dispatchEntryUnit) throw new StockCommandError('invalid', { productId: i.productId })
        })
      }
      const approved = await planApproveTransfer(tx, { transferId, expectedRevision, actor: { ...actor, role: user.role }, note: note ?? undefined }, file)
      return finish(approved.dispatchMovementDocNo ?? null)
    }

    const { locationId, date } = input.payload
    const note = input.payload.note ?? undefined

    // The product master decides unit and name; a line naming another unit would file a
    // phantom balance row that the count fence never read. A mismatch is a bad client.
    const masters = await Promise.all(input.payload.lines.map((l) => tx.get<Product>(COL.products, l.productId)))
    input.payload.lines.forEach((l, i) => {
      const p = masters[i]
      if (p && !sameUnit(l.unit, p.unitType)) throw new StockCommandError('invalid', { productId: l.productId, unit: p.unitType })
    })
    const named = <L extends { productId: string; productName: string; unit: string }>(l: L, i: number): L =>
      masters[i] ? { ...l, productName: masters[i]!.name, unit: masters[i]!.unitType } : l

    let lines: AdjustLine[]
    if (input.command === 'adjust') {
      lines = input.payload.lines.map(named)
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
        const m = named(l, i)
        return [{ productId: m.productId, productName: m.productName, unit: m.unit, qty: Math.abs(delta), direction: delta > 0 ? 'in' : 'out', reason: 'count' }]
      })
    }

    let docNo: string | null = null
    if (lines.length) docNo = (await planAdjust(tx, { lines, locationId, date, actor, note }, file)).commit()
    return finish(docNo)
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
    // Busy, not wrong: safe to resend with the same operationId (unlike stale/operation_conflict).
    if (e instanceof StockConflict) return json({ error: 'conflict', retryable: true }, 409)
    // A lost database response may already have committed: retry with the same operationId.
    return json({ error: 'unknown_outcome' }, 503)
  }
}
