import { backend } from '../backend'
import type { Backend } from '../backend/types'
import { COL, type StockMovement, type StockLevel } from '../types'
import { brandDef, getBrand, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { roundQty } from '../lib/validate'

// ---------------------------------------------------------------------------
// Whole-database backup and restore for one brand.
//
// Firestore's own safety nets — point-in-time recovery and scheduled backups — both
// require a billing account, so on the free plan a mistaken delete is permanent and there
// is nothing to restore from. This file IS the recovery path, which sets the bar: it either
// restores correctly or refuses before touching anything.
//
// Two decisions shape the rest:
//
//  - The ledger is what gets backed up and restored. Balances and document counters are
//    derived from it and are REBUILT after a restore rather than written back. That is why
//    a file whose balances were read a moment after its movements is still usable, and why
//    restoring cannot undo a receipt someone recorded after the backup was taken.
//  - Restoring is idempotent. It can be run twice, or resumed after failing halfway,
//    without duplicating anything — which is the closest thing to atomicity available from
//    a client with no server to hold a transaction open.
//
// Product images are included. They live as base64 inside Firestore (Cloud Storage was
// dropped from the free plan in February 2026), so they are just more documents here,
// which does make the file large.
// ---------------------------------------------------------------------------

/** Bumped when the shape changes in a way a restore has to know about. */
const FORMAT_VERSION = 2

/**
 * Collections written to the file, in the order a restore replays them: master data first,
 * then the ledger that refers to it.
 *
 * `users` and `meta` are here because a backup without them restores a database nobody can
 * sign in to — the roster is gone and, with the provisioning marker missing, the app reports
 * itself as never set up. They are shared across brands rather than brand-scoped, so
 * restoring either brand's file puts the same roster back.
 */
const COLLECTIONS = [
  COL.users,
  COL.meta,
  COL.products,
  COL.productImages,
  COL.locations,
  COL.minOverrides,
  COL.notes,
  COL.movements,
  COL.movementImages,
] as const

/** Rebuilt from the ledger on restore, so they are stored for reference only. */
const DERIVED = [COL.stockLevels, COL.counters] as const

const ALL_COLLECTIONS: readonly string[] = [...COLLECTIONS, ...DERIVED]

/** Master data an "overwrite" restore is allowed to put back over newer edits. */
const OVERWRITABLE: readonly string[] = [
  COL.products,
  COL.productImages,
  COL.locations,
  COL.minOverrides,
  COL.notes,
  COL.movementImages,
]

/** Never restored over an existing document: the ledger is append-only. */
const APPEND_ONLY: readonly string[] = [COL.movements]

/**
 * Backed up for the record, never written back.
 *
 * `meta/bootstrap` marks a database as provisioned and no client may write it — that is
 * the rule that stopped whoever arrived first from claiming ownership. Restoring into a
 * database you can sign in to means the marker is already there; restoring into an empty
 * one means creating the first admin in the Firebase console first, which creates it. So
 * the file keeps a copy for reference and the restore skips it rather than failing.
 */
const BACKUP_ONLY: readonly string[] = [COL.meta]

/**
 * Collections where one refused document should not abandon the whole restore.
 *
 * The roster is worth putting back, but a single profile the rules will not accept — a
 * revoked account, say — must not stop the stock data being recovered. Stock collections
 * stay strict: a movement that will not write is a reason to stop and look.
 */
const BEST_EFFORT: readonly string[] = [COL.users]

export const RESTORE_MODES = {
  /** Write only what is missing. Anything changed since the backup is left alone. */
  repair: 'repair',
  /** Also put master data back as the file has it, overwriting later edits. */
  overwrite: 'overwrite',
} as const

export type RestoreMode = (typeof RESTORE_MODES)[keyof typeof RESTORE_MODES]

export interface BackupIntegrity {
  /** movement count and latest timestamp when the ledger was read */
  ledgerStamp: string
  /** how many stored balances disagreed with the ledger at the moment of export */
  drift: number
  /** false if stock was recorded while the file was being written */
  consistent: boolean
}

export interface BackupFile {
  format: 'pzm-stock-backup'
  version: number
  brand: BrandId
  brandName: string
  createdAt: number
  createdBy: string
  counts: Record<string, number>
  integrity: BackupIntegrity
  data: Record<string, Record<string, unknown>[]>
}

function ledgerStamp(movements: StockMovement[]): string {
  let latest = 0
  for (const m of movements) {
    const t = Math.max(m.createdAt ?? 0, m.updatedAt ?? 0)
    if (t > latest) latest = t
  }
  return `${movements.length}:${latest}`
}

function balancesFromLedger(movements: StockMovement[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of movements) {
    if (m.voided) continue
    if (m.fromLocationId) {
      const k = `${m.fromLocationId}__${m.productId}`
      map.set(k, roundQty((map.get(k) ?? 0) - m.qty))
    }
    if (m.toLocationId) {
      const k = `${m.toLocationId}__${m.productId}`
      map.set(k, roundQty((map.get(k) ?? 0) + m.qty))
    }
  }
  return map
}

/** Highest sequence number each counter must be at, read back out of the document numbers. */
function countersFromLedger(movements: StockMovement[]): Map<string, number> {
  const max = new Map<string, number>()
  const kinds: Record<string, string> = { RC: 'receive', IS: 'issue', ADJ: 'adjust', CS: 'consume' }
  for (const m of movements) {
    const [prefix, num] = String(m.docNo ?? '').split('-')
    const counter = kinds[prefix]
    const seq = Number(num)
    if (!counter || !Number.isFinite(seq)) continue
    if (seq > (max.get(counter) ?? 0)) max.set(counter, seq)
  }
  return max
}

/**
 * Read every collection for one brand into a single object.
 *
 * The ledger is read first and checked again at the end. Reading a dozen collections one
 * after another is not a snapshot, so stock recorded in the middle would leave the file
 * holding an older balance beside a newer movement. Because a restore rebuilds balances
 * from the ledger, that mismatch is harmless — but the file says which it is rather than
 * leaving the owner to guess.
 */
export async function buildBackup(createdBy: string): Promise<BackupFile> {
  const brand = getBrand()
  const db: Backend = backend.forBrand(brand)

  const before = await db.getAll<StockMovement>(COL.movements)
  const data: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}

  for (const name of ALL_COLLECTIONS) {
    const docs = await db.getAll<Record<string, unknown>>(name)
    data[name] = name === COL.users ? docs.map(withoutSecrets) : docs
    counts[name] = data[name].length
  }

  const after = await db.getAll<StockMovement>(COL.movements)
  const levels = (data[COL.stockLevels] ?? []) as unknown as StockLevel[]
  const expected = balancesFromLedger(after)
  let drift = 0
  for (const id of new Set([...expected.keys(), ...levels.map((l) => l.id)])) {
    const want = expected.get(id) ?? 0
    const got = levels.find((l) => l.id === id)?.qty ?? 0
    if (Math.abs(want - got) >= 0.0005) drift++
  }

  return {
    format: 'pzm-stock-backup',
    version: FORMAT_VERSION,
    brand,
    brandName: brandDef(brand).name,
    createdAt: Date.now(),
    createdBy,
    counts,
    integrity: {
      ledgerStamp: ledgerStamp(after),
      drift,
      consistent: ledgerStamp(before) === ledgerStamp(after),
    },
    data,
  }
}

/**
 * A backup travels by email and sits in Drive. The demo-mode password has no business
 * being in it, and nothing reads it back — local mode is for trying the app out.
 */
function withoutSecrets(user: Record<string, unknown>): Record<string, unknown> {
  const { localPassword: _drop, ...rest } = user
  return rest
}

/** Total documents in a backup. Counted from the contents, which are always present. */
export function backupSize(b: BackupFile): number {
  return Object.values(b.data ?? {}).reduce((sum, docs) => sum + (docs?.length ?? 0), 0)
}

export function backupFilename(b: BackupFile): string {
  const d = new Date(b.createdAt)
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '-',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('')
  return `pzm-stock-${b.brand}-${stamp}.json`
}

/**
 * Hands the backup to the browser as a download.
 *
 * Indented on purpose. A backup nobody can read is a backup nobody trusts, and the owner
 * should be able to open the file and see their own product names in it. The cost is about
 * 20% more bytes on a file measured in hundreds of KB.
 */
export function downloadBackup(b: BackupFile): void {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(b)
  a.click()
  URL.revokeObjectURL(url)
}

export class BackupFormatError extends Error {}

/** Ids become document keys, so they have to be usable as one. */
const UNSAFE_IDS = new Set(['', '.', '..', '__proto__', 'constructor', 'prototype'])

function idProblem(id: unknown): string | null {
  if (typeof id !== 'string') return 'id is not text'
  if (UNSAFE_IDS.has(id)) return `id "${id}" cannot be used as a document key`
  if (id.includes('/')) return `id "${id}" contains a slash`
  if (id.length > 400) return 'id is too long'
  return null
}

/**
 * Every number has to survive the round trip.
 *
 * JSON has no Infinity, but `1e999` parses to it, and JSON.parse produces NaN for nothing —
 * so this is mostly about numbers big enough to overflow. Either one reaches the database
 * intact and turns every total that touches it into nonsense.
 */
function hasBadNumber(value: unknown, depth = 0): boolean {
  if (depth > 12) return true
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some((v) => hasBadNumber(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => hasBadNumber(v, depth + 1))
  }
  return false
}

/** Refuse a file so large the browser would die trying to restore it. */
const MAX_DOCUMENTS = 200_000

/**
 * Parse and fully check a backup file.
 *
 * Everything is verified before a restore writes its first document. The old version
 * checked the format string and the version number and then trusted the rest, so a file
 * with a collection that was not a list, a duplicate id, or a quantity of Infinity would
 * start writing and fail somewhere in the middle — leaving the database in a state nobody
 * asked for, with no way back.
 */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupFormatError('not-json')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupFormatError('not-a-backup')
  }
  const b = parsed as Partial<BackupFile>
  if (b.format !== 'pzm-stock-backup') throw new BackupFormatError('not-a-backup')
  if (typeof b.version !== 'number' || !Number.isInteger(b.version) || b.version < 1) {
    throw new BackupFormatError('unsupported-version')
  }
  if (b.version > FORMAT_VERSION) throw new BackupFormatError('unsupported-version')
  if (b.brand !== 'pizza' && b.brand !== 'lelapin') throw new BackupFormatError('unknown-brand')
  if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) {
    throw new BackupFormatError('no-data')
  }

  let total = 0
  for (const [name, docs] of Object.entries(b.data)) {
    if (!ALL_COLLECTIONS.includes(name)) {
      throw new BackupFormatError(`unknown collection "${name}"`)
    }
    if (!Array.isArray(docs)) throw new BackupFormatError(`"${name}" is not a list`)
    const seen = new Set<string>()
    for (const doc of docs) {
      if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new BackupFormatError(`"${name}" contains something that is not a record`)
      }
      const problem = idProblem((doc as Record<string, unknown>).id)
      if (problem) throw new BackupFormatError(`"${name}": ${problem}`)
      const id = (doc as Record<string, unknown>).id as string
      if (seen.has(id)) throw new BackupFormatError(`"${name}" has two records with id "${id}"`)
      seen.add(id)
      if (hasBadNumber(doc)) {
        throw new BackupFormatError(`"${name}/${id}" holds a number that is not finite`)
      }
    }
    total += docs.length
    // `counts` is a convenience header. When it is there it has to be true, or the number
    // shown in the confirmation dialog is a different file's.
    const declared = b.counts?.[name]
    if (declared !== undefined && declared !== docs.length) {
      throw new BackupFormatError(`"${name}" says ${declared} records but holds ${docs.length}`)
    }
  }
  if (total > MAX_DOCUMENTS) throw new BackupFormatError('file-too-large')

  // Version 1 files predate the integrity header; treat them as unknown rather than good.
  const integrity: BackupIntegrity = b.integrity ?? {
    ledgerStamp: '',
    drift: 0,
    consistent: false,
  }
  return { ...(b as BackupFile), counts: b.counts ?? {}, integrity }
}

export interface RestoreResult {
  /** documents created or overwritten */
  written: number
  /** documents already present and left as they were */
  kept: number
  /** balances and counters rebuilt from the ledger afterwards */
  rebuilt: number
  /** documents the database would not accept, or that are never restored */
  skipped: number
}

/**
 * Write a backup into the ACTIVE brand.
 *
 * The order matters: master data, then the ledger, then the derived balances and counters
 * rebuilt from whatever ledger now exists. That last step is what makes the result correct
 * rather than merely restored — a receipt recorded after the backup keeps its stock, and
 * document numbers continue past the highest one ever used instead of being sent back to
 * where they were and handing out a number twice.
 *
 * Nothing here overwrites a movement: the ledger is append-only, and a row someone
 * corrected or voided since the backup stays corrected.
 *
 * Running it twice is safe, which matters because there is no transaction big enough to
 * hold a whole database. If it fails partway, running it again finishes the job.
 */
export async function restoreBackup(
  b: BackupFile,
  mode: RestoreMode = RESTORE_MODES.repair,
): Promise<RestoreResult> {
  const brand = getBrand()

  // Two companies, two sets of books. Restoring one brand's file into the other used to be
  // allowed behind a type-the-brand-name warning, but there is no undo for it: movements
  // cannot be deleted, so the merged ledger would be permanent and both brands' Cost of
  // Goods figures would be wrong from then on. A warning is not proportionate to that.
  if (b.brand !== brand) {
    throw new AppError(
      'ไฟล์นี้เป็นข้อมูลของ {file} แต่ตอนนี้เปิด {current} อยู่ — สลับไปที่ {file} ก่อนแล้วค่อยกู้คืน',
      { file: b.brandName || b.brand, current: brandDef(brand).name },
    )
  }

  const db: Backend = backend.forBrand(brand)
  let written = 0
  let kept = 0
  let skipped = 0

  for (const name of COLLECTIONS) {
    const docs = b.data[name] ?? []
    if (docs.length === 0) continue
    if (BACKUP_ONLY.includes(name)) {
      skipped += docs.length
      continue
    }
    const existing = new Set((await db.getAll<{ id: string }>(name)).map((d) => d.id))

    for (const doc of docs) {
      const { id: _drop, ...rest } = doc
      const id = doc.id as string
      const present = existing.has(id)
      const mayOverwrite =
        !APPEND_ONLY.includes(name) &&
        mode === RESTORE_MODES.overwrite &&
        OVERWRITABLE.includes(name)

      if (present && !mayOverwrite) {
        kept++
        continue
      }
      try {
        await db.set(name, id, rest)
        written++
      } catch (e) {
        if (!BEST_EFFORT.includes(name)) throw e
        console.error(`[restore] ${name}/${id} was refused`, e)
        skipped++
      }
    }
  }

  const rebuilt = await rebuildDerived(db)
  return { written, kept, rebuilt, skipped }
}

/**
 * Recompute balances and document counters from the ledger that is now in the database.
 *
 * Called at the end of every restore. Backed-up balances are deliberately NOT written back:
 * they were a snapshot of a ledger that has since gained rows, and one of the two has to
 * win. The ledger is the one every report is built from.
 */
async function rebuildDerived(db: Backend): Promise<number> {
  const movements = await db.getAll<StockMovement>(COL.movements)
  const balances = balancesFromLedger(movements)
  const counters = countersFromLedger(movements)
  const now = Date.now()
  let n = 0

  const negative = [...balances].filter(([, qty]) => qty < 0)
  if (negative.length > 0) {
    throw new AppError(
      'กู้คืนข้อมูลแล้ว แต่สร้างยอดคงเหลือใหม่ไม่ได้: ประวัติทำให้ยอดติดลบ {count} รายการ (เช่น {example})',
      { count: negative.length, example: negative[0][0] },
    )
  }

  const existing = await db.getAll<StockLevel>(COL.stockLevels)
  for (const [id, qty] of balances) {
    const [locationId, productId] = id.split('__')
    await db.set(COL.stockLevels, id, {
      productId,
      locationId,
      qty,
      updatedAt: now,
      updatedBy: 'restore',
    })
    n++
  }
  for (const lv of existing) {
    if (balances.has(lv.id)) continue
    await db.set(COL.stockLevels, lv.id, {
      productId: lv.productId,
      locationId: lv.locationId,
      qty: 0,
      updatedAt: now,
      updatedBy: 'restore',
    })
    n++
  }

  for (const [counter, seq] of counters) {
    const current = await db.getOne<{ value: number }>(COL.counters, counter)
    // Only ever forwards: a counter sent backwards hands out a document number twice.
    if ((current?.value ?? 0) >= seq) continue
    await db.set(COL.counters, counter, { value: seq })
    n++
  }
  return n
}
