/**
 * "Suggested A, the person chose B" — kept on this device as a data-quality signal
 * (lib/supplierResolution.ts supplierIssues). Never applied: one correction changes no
 * product and no preferred supplier. Kept locally because a shared record needs a new
 * collection, which is the owner's call (rules change); this costs no read and no write.
 */
import type { OverrideEvent } from './supplierResolution'

const KEY = 'pzm.receive.supplierOverrides'
const MAX = 200

export function loadOverrides(): OverrideEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((o) => o && typeof o.productId === 'string' && typeof o.suggested === 'string' && typeof o.chosen === 'string') : []
  } catch {
    return []
  }
}

export function recordOverride(e: OverrideEvent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadOverrides(), e].slice(-MAX)))
  } catch {
    // Private mode or full storage: the signal is lost, nothing else is.
  }
}
