import type { AppUser } from '../../src/types'
import { AppError } from '../../src/i18n/AppError'
import { receiptIdFor, receiveOrderInTx, type ReceiptLineInput } from '../../src/commands/receivePO'
import { COL } from '../../src/types'
import { brandCollection, type ServerStore } from './serverStore'
import { runServerTx, TxConflict } from './serverTx'

/**
 * The trusted command boundary for stock (ADR-001, plan A3).
 *
 * Every number written to the ledger and the balances here is worked out on the server from
 * what the server reads — the caller only says what happened (which order, which lines,
 * which bill), never what a balance should become. The transaction bodies are the app's own
 * (src/commands), so a command and the app's old client path cannot disagree; the golden
 * test in tests/functions/stock-commands.test.ts holds them to that.
 *
 * Who may call: an active, unrevoked user, checked against `users/{uid}` exactly as the
 * rules' active() does. Who it is filed under: that user — the body cannot name anyone.
 *
 *   POST /api/stock/receive-po   check a delivery in against its order
 */

export interface StockDeps {
  store: ServerStore
  now: () => number
  makeId: () => string
  verifyUser: (authorization: string | null) => Promise<string | null>
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } })

type Brand = 'pizza' | 'lelapin'
const isBrand = (b: unknown): b is Brand => b === 'pizza' || b === 'lelapin'
const isId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)
const isText = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max
const isMs = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 4_102_444_800_000

async function caller(deps: StockDeps, authorization: string | null): Promise<AppUser | null> {
  const uid = await deps.verifyUser(authorization)
  if (!uid) return null
  if (await deps.store.get('revokedUsers', uid)) return null
  const user = (await deps.store.get<AppUser>('users', uid))?.doc
  return user && user.active === true ? { ...user, id: uid } : null
}

/** The app's own refusal, carried as its translation key so the screen says it in words. */
function refused(e: unknown): Reply | null {
  if (e instanceof AppError) return fail(422, 'app', { key: e.key, ...(e.vars ? { vars: e.vars } : {}) })
  if (e instanceof TxConflict) return fail(409, 'busy')
  return null
}

function lineOf(x: unknown): ReceiptLineInput | null {
  if (typeof x !== 'object' || x === null) return null
  const l = x as Record<string, unknown>
  if (!isId(l.productId) || typeof l.receivedQty !== 'number' || !Number.isFinite(l.receivedQty) || typeof l.checked !== 'boolean') return null
  if (l.note !== undefined && !isText(l.note, 2000)) return null
  return { productId: l.productId, receivedQty: l.receivedQty, checked: l.checked, ...(typeof l.note === 'string' ? { note: l.note } : {}) }
}

export async function receivePOCommand(deps: StockDeps, authorization: string | null, body: unknown): Promise<Reply> {
  const user = await caller(deps, authorization)
  if (!user) return fail(401, 'unauthorized')
  const b = (body ?? {}) as Record<string, unknown>
  const lines = Array.isArray(b.lines) ? b.lines.map(lineOf) : null
  if (
    !isBrand(b.brand) || !isId(b.orderId) || !isText(b.invoiceNo, 100) || !b.invoiceNo.trim() ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(String(b.operationId ?? '')) ||
    !lines || lines.length === 0 || lines.length > 200 || lines.some((l) => l === null) ||
    (b.date !== undefined && !isMs(b.date)) || (b.docDate !== undefined && !isMs(b.docDate)) ||
    (b.note !== undefined && !isText(b.note, 2000)) ||
    (b.photoDataUrl !== undefined && !(isText(b.photoDataUrl, 1_000_000) && b.photoDataUrl.startsWith('data:image/'))) ||
    (b.closeReason !== undefined && !(isText(b.closeReason, 2000) && b.closeReason.trim()))
  ) {
    return fail(400, 'bad_request')
  }
  const brand = b.brand
  const orderId = b.orderId
  const operationId = String(b.operationId)
  const actor = { id: user.id, name: user.name }
  try {
    const out = await runServerTx(deps.store, brand, 'receivePO', (tx) =>
      receiveOrderInTx(
        tx,
        (mv, given) => tx.set(COL.movements, given ?? deps.makeId(), mv as Record<string, unknown>),
        {
          orderId,
          invoiceNo: (b.invoiceNo as string).trim(),
          lines: lines as ReceiptLineInput[],
          actor,
          receiptId: receiptIdFor(orderId, operationId),
          date: (b.date as number | undefined) ?? deps.now(),
          ...(b.docDate !== undefined ? { docDate: b.docDate as number } : {}),
          ...(typeof b.note === 'string' && b.note.trim() ? { note: b.note.trim() } : {}),
          ...(typeof b.photoDataUrl === 'string' ? { photoDataUrl: b.photoDataUrl } : {}),
          ...(typeof b.closeReason === 'string' ? { closeReason: b.closeReason.trim() } : {}),
        },
      ),
    )
    const order = out.written ?? (await deps.store.get(brandCollection(brand, 'purchaseOrders'), orderId))?.doc ?? null
    return ok({ ...out.result, ...(order ? { order } : {}) })
  } catch (e) {
    const r = refused(e)
    if (r) return r
    throw e
  }
}
