import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import { COL } from '../types'

/**
 * The units a quantity may be keyed in, as the owner maintains them.
 *
 * ## Why one shared document, and not a collection
 *
 * This is a vocabulary — Lot, Pack, EA, Carton — a dozen short words that change a few
 * times a year. A collection would cost one read per name every time anyone opened a
 * receiving screen, and this app has 50,000 reads a day for both companies together. One
 * document costs one read for the whole list.
 *
 * It lives in `meta`, which is shared rather than per-brand, so no fourth collection is
 * added and no brand namespace is invented. A carton is a carton in either company; if the
 * two ever need different vocabularies, this becomes two documents, not two collections.
 *
 * ## Why it is read once and then remembered
 *
 * Nothing here is live. A subscription is charged again on every cold start, and because
 * the shared tablets sign out after 20 minutes and clear their offline copy, nearly every
 * session is one. The list is fetched the first time a screen asks for it and then held for
 * the session; editing it in Settings updates the copy in memory directly, so the receiving
 * screen shows the new unit without anyone paying to read it again.
 */

const DOC_ID = 'entryUnits'

/** What the list contains before anyone has changed it. */
export const DEFAULT_UNITS = ['Lot', 'Pack', 'EA'] as const

const MAX_UNITS = 40
const MAX_LENGTH = 20

interface UnitDoc {
  id: string
  names: string[]
  updatedAt: number
}

/**
 * Tidy a list the way it will be stored: trimmed, de-duplicated case-insensitively, and
 * bounded. Exported because the editor shows the person the same result it will save.
 */
export function normaliseUnits(raw: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of raw) {
    const clean = name.trim().slice(0, MAX_LENGTH)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= MAX_UNITS) break
  }
  return out
}

// ---------------------------------------------------------------- session cache ----

// One frozen array, so a component that has not got the real list yet is handed the same
// reference every render — a fresh [...DEFAULT_UNITS] would invalidate every memo below it.
const FALLBACK: string[] = [...DEFAULT_UNITS]

// null means "not fetched yet", which is different from a list someone emptied on purpose.
let cached: string[] | null = null
let inflight: Promise<string[]> | null = null
const listeners = new Set<() => void>()

function announce(): void {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// useSyncExternalStore compares snapshots by identity, so this must not build a new array.
function snapshot(): string[] | null {
  return cached
}

/**
 * Drop the remembered list.
 *
 * Logout reloads the page, which wipes this along with every other module, so nothing in
 * the app needs to call it — it is here so tests can start from a known state.
 */
export function clearEntryUnitCache(): void {
  cached = null
  inflight = null
  announce()
}

/** The list as it stands, or null if nobody has asked for it yet this session. */
export function peekEntryUnits(): string[] | null {
  return cached
}

/** One read, once per session. Concurrent callers share the same request. */
export async function loadEntryUnits(): Promise<string[]> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = backend
    .getOne<UnitDoc>(COL.meta, DOC_ID)
    .then((doc) => {
      cached = doc ? normaliseUnits(doc.names ?? []) : [...DEFAULT_UNITS]
      announce()
      return cached
    })
    .catch(() => {
      // A missing document is normal, and a denied read must not take the entry screens
      // with it — the built-in list is a working answer either way.
      cached = [...DEFAULT_UNITS]
      announce()
      return cached
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export async function saveEntryUnits(names: readonly string[]): Promise<string[]> {
  const clean = normaliseUnits(names)
  if (clean.length === 0) throw new AppError('ต้องมีอย่างน้อย 1 หน่วย')
  await backend.set(COL.meta, DOC_ID, {
    id: DOC_ID,
    names: clean,
    updatedAt: Date.now(),
  })
  // Update in place rather than re-reading: the write already told us what it says now.
  cached = clean
  announce()
  return clean
}

/**
 * The unit list for a screen, fetching it the first time and reusing it after.
 *
 * Returns the built-in list until the real one arrives, so a dropdown is never briefly
 * empty — the units in it are the ones that need no configuration anyway.
 */
export function useEntryUnits(): string[] {
  const units = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    void loadEntryUnits()
  }, [])
  return units ?? FALLBACK
}
