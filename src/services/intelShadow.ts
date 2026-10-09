import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { COL } from '../types'
import type { ShadowSnapshot } from '../intel/shadow'

/**
 * Phase G9: keep a prediction, once. The only thing shadow mode ever writes — `intelShadow`,
 * create-only in the rules. Best-effort by design: a snapshot that cannot be written is
 * simply not kept; nothing on screen waits for it or fails because of it.
 *
 * "Once" without a read: the id is deterministic, this device remembers what it wrote,
 * and a second device writing the same id is refused by the rules (no updates) — caught
 * and remembered too.
 */
const keyOf = (id: string) => `pmstock:shadow:${getBrand()}:${id}`

function seen(id: string): boolean {
  try {
    return localStorage.getItem(keyOf(id)) === '1'
  } catch {
    return false
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(keyOf(id), '1')
  } catch {
    /* storage full or blocked: at worst the rules refuse a repeat */
  }
}

export async function recordShadow(snapshot: ShadowSnapshot): Promise<boolean> {
  if (seen(snapshot.id)) return false
  try {
    const db = backend.forBrand(getBrand())
    // The demo backend has no rules to refuse a repeat: it asks first, at no cost.
    if (backend.mode === 'local' && (await db.getOne(COL.intelShadow, snapshot.id))) {
      remember(snapshot.id)
      return false
    }
    await db.set(COL.intelShadow, snapshot.id, snapshot as unknown as Record<string, unknown>)
    remember(snapshot.id)
    return true
  } catch (e) {
    const code = (e as { code?: string } | null)?.code
    if (code === 'permission-denied') remember(snapshot.id) // already kept by another device
    return false
  }
}

/** Snapshots made since `from` — read when the evaluation screen opens, never subscribed. */
export async function loadShadows(from: number, to = Date.now()): Promise<ShadowSnapshot[]> {
  return backend.forBrand(getBrand()).getRange<ShadowSnapshot>(COL.intelShadow, 'createdAt', from, to)
}
