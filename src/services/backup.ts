import { backend } from '../backend'
import { COL } from '../types'
import { brandDef, getBrand, type BrandId } from '../brand/brand'

// ---------------------------------------------------------------------------
// Whole-database backup and restore for the current brand.
//
// Firestore's own safety nets — point-in-time recovery and scheduled backups — both
// require a billing account, so on the free plan a mistaken delete is permanent and
// there is nothing to restore from. This is the substitute: a single file the owner
// keeps in Drive, containing everything needed to rebuild the brand.
//
// Product images are included. They live as base64 inside Firestore (Cloud Storage was
// dropped from the free plan in February 2026), so they are just more documents here,
// which does make the file large.
// ---------------------------------------------------------------------------

/** Bumped only when the shape changes in a way a restore has to know about. */
const FORMAT_VERSION = 1

const COLLECTIONS = [
  COL.products,
  COL.productImages,
  COL.locations,
  COL.stockLevels,
  COL.movements,
  COL.movementImages,
  COL.notes,
  COL.counters,
  COL.minOverrides,
] as const

export interface BackupFile {
  format: 'pzm-stock-backup'
  version: number
  brand: BrandId
  brandName: string
  createdAt: number
  createdBy: string
  counts: Record<string, number>
  data: Record<string, Record<string, unknown>[]>
}

/** Reads every collection for the active brand into one object. */
export async function buildBackup(createdBy: string): Promise<BackupFile> {
  const brand = getBrand()
  const data: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}

  for (const name of COLLECTIONS) {
    const docs = await backend.getAll<Record<string, unknown>>(name)
    data[name] = docs
    counts[name] = docs.length
  }

  return {
    format: 'pzm-stock-backup',
    version: FORMAT_VERSION,
    brand,
    brandName: brandDef(brand).name,
    createdAt: Date.now(),
    createdBy,
    counts,
    data,
  }
}

/** Total documents in a backup — the headline number worth showing the user. */
export function backupSize(b: BackupFile): number {
  return Object.values(b.counts).reduce((sum, n) => sum + n, 0)
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

/** Hands the backup to the browser as a download. */
export function downloadBackup(b: BackupFile): void {
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(b)
  a.click()
  URL.revokeObjectURL(url)
}

export class BackupFormatError extends Error {}

/** Parses and sanity-checks a backup file before anything is written. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupFormatError('not-json')
  }
  const b = parsed as Partial<BackupFile>
  if (b?.format !== 'pzm-stock-backup') throw new BackupFormatError('not-a-backup')
  if (typeof b.version !== 'number' || b.version > FORMAT_VERSION) {
    throw new BackupFormatError('unsupported-version')
  }
  if (!b.data || typeof b.data !== 'object') throw new BackupFormatError('no-data')
  return b as BackupFile
}

export interface RestoreResult {
  written: number
  skipped: number
}

/**
 * Writes a backup into the ACTIVE brand, document by document, keeping the original ids.
 *
 * Existing documents with the same id are overwritten; anything created since the backup
 * is left alone. So this repairs a bad delete without rolling the whole brand back — and
 * it is why it does not clear the collections first.
 */
export async function restoreBackup(b: BackupFile): Promise<RestoreResult> {
  let written = 0
  let skipped = 0

  for (const name of COLLECTIONS) {
    for (const doc of b.data[name] ?? []) {
      const id = doc.id
      if (typeof id !== 'string' || !id) {
        skipped++
        continue
      }
      const { id: _drop, ...rest } = doc
      await backend.set(name, id, rest)
      written++
    }
  }
  return { written, skipped }
}
