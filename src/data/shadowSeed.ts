/**
 * Cold-start seed pilot (P1, owner brief of 8 Oct 2026) — OFF unless built with
 * VITE_SHADOW_SEED=1 and a Supabase project, and never for a brand not listed.
 *
 * A device with no copy of `products` or `stockLevels` (or one a day old) normally reads the
 * whole collection from Firestore — about 860 of the ~1,400 reads of a cold open. With the
 * pilot it takes the rows from the Supabase shadow instead, then follows Firestore from the
 * shadow's COMPLETENESS watermark with the same change listener as always. Firestore stays
 * the authority for everything after that watermark, and for every write; nothing here
 * writes anywhere.
 *
 * Any doubt and the device does what it does today (a full Firestore read):
 *   - the pilot is off, the brand is not listed, or this browser has switched it off;
 *   - the copy is being re-read because an admin change bumped the cache epoch, and no
 *     parity check has passed since (the shadow follows timestamps; a restore moves none);
 *   - the shadow's proof is missing, older than SEED_MAX_AGE_MS, has unresolved events, or
 *     no parity check has passed in PARITY_MAX_AGE_MS;
 *   - the rows that arrive are not the number the shadow says it holds (RLS, a cut-off);
 *   - anything fails or takes longer than SEED_TIMEOUT_MS.
 */
import type { StockLevel } from '../types'

export type SeedEntity = 'products' | 'stockLevels'
export const SEED_ENTITIES: readonly SeedEntity[] = ['products', 'stockLevels']

/** The Worker's proof must be this fresh (it runs every half hour; a missed run is refused). */
export const SEED_MAX_AGE_MS = 40 * 60_000
/** A parity check must have passed this recently. */
export const PARITY_MAX_AGE_MS = 24 * 3_600_000
export const SEED_TIMEOUT_MS = 4_000
/** Rows per request (Supabase caps a response at 1,000). */
export const SEED_PAGE = 1000
/** localStorage switch: `off` turns the pilot off in this browser (rollback without a deploy). */
export const SEED_SWITCH_KEY = 'pzm.shadowSeed'

export interface SeedStatus {
  completeThrough: number
  unresolved: number
  syncedAt: number
  parityPassedAt: number | null
  rows: number | null
}

/** How the shadow is reached. PostgREST in the app; a PGlite stand-in in the tests. */
export interface SeedTransport {
  status(brand: string, entity: SeedEntity): Promise<SeedStatus | null>
  rows(brand: string, entity: SeedEntity): Promise<Record<string, unknown>[]>
}

export type SeedResult<T> = { ok: true; docs: T[]; completeThrough: number } | { ok: false; reason: string }

/** Why a proof is not good enough, or null when it is. */
export function refuseReason(st: SeedStatus | null, now: number, epoch: number | undefined): string | null {
  if (!st) return 'no-status'
  if (!(st.completeThrough > 0)) return 'no-watermark'
  if (st.unresolved > 0) return 'unresolved-events'
  if (now - st.syncedAt > SEED_MAX_AGE_MS) return 'stale-proof'
  if (st.parityPassedAt === null || now - st.parityPassedAt > PARITY_MAX_AGE_MS) return 'no-recent-parity'
  if (epoch !== undefined && !(st.parityPassedAt > epoch)) return 'epoch-after-parity'
  if (st.rows === null) return 'no-row-count'
  return null
}

/** A shadow row as the document the app holds (the shape Firestore gives it). */
export function toDoc(entity: SeedEntity, row: Record<string, unknown>): Record<string, unknown> | null {
  if (entity === 'products') {
    const doc = row.doc as Record<string, unknown> | null
    return doc && typeof doc === 'object' ? { ...doc, id: String(row.id) } : null
  }
  const loc = String(row.location_id ?? '')
  const pid = String(row.product_id ?? '')
  const unit = String(row.unit_key ?? '')
  const level: StockLevel = { id: `${loc}__${pid}${unit ? `#${unit}` : ''}`, productId: pid, locationId: loc, qty: Number(row.qty), updatedAt: Number(row.version) }
  if (unit) level.unit = unit
  return Number.isFinite(level.qty) && Number.isFinite(level.updatedAt) ? (level as unknown as Record<string, unknown>) : null
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('seed timeout')), ms)
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)))
  })

/** The collection from the shadow, or why not. Never throws. */
export async function seedFromShadow<T>(t: SeedTransport, brand: string, entity: SeedEntity, now: number, epoch: number | undefined, timeoutMs = SEED_TIMEOUT_MS): Promise<SeedResult<T>> {
  try {
    const st = await withTimeout(t.status(brand, entity), timeoutMs)
    const why = refuseReason(st, now, epoch)
    if (why || !st) return { ok: false, reason: why ?? 'no-status' }
    const rows = await withTimeout(t.rows(brand, entity), timeoutMs)
    if (rows.length !== st.rows) return { ok: false, reason: 'row-count-mismatch' }
    const docs: T[] = []
    for (const r of rows) {
      const d = toDoc(entity, r)
      if (!d) return { ok: false, reason: 'unreadable-row' }
      docs.push(d as T)
    }
    return { ok: true, docs, completeThrough: st.completeThrough }
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.message === 'seed timeout' ? 'timeout' : 'transport-error' }
  }
}

/**
 * Whether a full read may be replaced by a seed: only for a device with no copy, or a copy
 * that is merely old. A copy discarded because the cache epoch moved is an admin change the
 * shadow may not have — the seed itself also checks parity against the epoch.
 */
export function seedMayReplaceFullRead(snap: { fullAt: number; epoch?: number } | null, epoch: number | undefined): boolean {
  return !snap || epoch === undefined || snap.epoch === epoch
}

/** Where the delta listener starts after a seed: never after the shadow's proof. */
export function deltaStart(newestHeld: number, completeThrough: number | null, skewMs: number): number {
  const from = completeThrough === null ? newestHeld : Math.min(newestHeld, completeThrough)
  return Math.max(0, from - skewMs)
}

// ---------------------------------------------------------------- the app's wiring ----

export interface SeedConfig {
  url: string
  key: string
  brands: string[]
}

/** The pilot's build configuration, or null when it is off (the default). */
export function seedConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): SeedConfig | null {
  // The read benchmark (e2e/read-benchmark.spec.ts, emulator only) switches the pilot on
  // against a stand-in shadow it serves itself. MODE is 'production' in every deployed
  // build, so this branch is not in them; and it only ever accepts the test host.
  if (env.MODE === 'e2e') {
    try {
      const o = JSON.parse(localStorage.getItem(`${SEED_SWITCH_KEY}.e2e`) ?? 'null') as { brands?: string[] } | null
      if (o?.brands?.length) return { url: 'https://shadow.e2e.test', key: 'e2e', brands: o.brands }
    } catch {
      // not set: the build flags decide
    }
  }
  if (env.VITE_SHADOW_SEED !== '1') return null
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || !/^https:\/\//.test(url)) return null
  const brands = (env.VITE_SHADOW_SEED_BRANDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!brands.length) return null
  try {
    if (localStorage.getItem(SEED_SWITCH_KEY) === 'off') return null
  } catch {
    // no storage: the build flag decides
  }
  return { url: url.replace(/\/+$/, ''), key, brands }
}

/**
 * PostgREST over HTTPS with the person's Firebase ID token (third-party auth; RLS applies
 * as for any read). Reads only: an RPC for the proof, a select for the rows.
 */
export function postgrestTransport(cfg: SeedConfig, token: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SeedTransport {
  const headers = async () => {
    const t = await token()
    if (!t) throw new Error('no token')
    return { apikey: cfg.key, Authorization: `Bearer ${t}`, 'Accept-Profile': 'shadow', 'Content-Profile': 'shadow', 'Content-Type': 'application/json' }
  }
  const call = async (path: string, init: RequestInit) => {
    const r = await fetchImpl(`${cfg.url}/rest/v1/${path}`, { ...init, headers: await headers() })
    if (!r.ok) throw new Error(`shadow ${r.status}`)
    return r.json() as Promise<unknown>
  }
  return {
    async status(brand, entity) {
      return (await call('rpc/seed_status', { method: 'POST', body: JSON.stringify({ p_brand: brand, p_entity: entity }) })) as SeedStatus | null
    },
    async rows(brand, entity) {
      const b = encodeURIComponent(brand)
      const base =
        entity === 'products'
          ? `products?brand=eq.${b}&deleted_at=is.null&select=id,doc&order=id`
          : `stock_balances?brand=eq.${b}&select=location_id,product_id,unit_key,qty,version&order=location_id,product_id,unit_key`
      // Supabase answers at most 1,000 rows a request: page in a stable order until short.
      const out: Record<string, unknown>[] = []
      for (let offset = 0; ; offset += SEED_PAGE) {
        const page = (await call(`${base}&limit=${SEED_PAGE}&offset=${offset}`, { method: 'GET' })) as Record<string, unknown>[]
        out.push(...page)
        if (page.length < SEED_PAGE) return out
      }
    },
  }
}
