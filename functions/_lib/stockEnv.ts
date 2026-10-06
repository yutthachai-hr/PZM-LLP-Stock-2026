import { PROJECT_ID, verifyFirebaseToken } from '../_poImage'
import { restServerStore } from './serverStore'
import type { StockDeps } from './stockCommands'

/**
 * The stock commands' real dependencies (ADR-001). They use the same service account as the
 * supplier links (FIREBASE_SERVICE_ACCOUNT, roles/datastore.user), so nothing new is set in
 * the dashboard. Without it every command answers 503 and the app keeps its client path —
 * the app only calls a command that VITE_STOCK_COMMANDS switched on at build time.
 */
export interface StockEnv {
  FIREBASE_SERVICE_ACCOUNT?: string
  FIREBASE_PROJECT_ID?: string
}

function randomId(): string {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20).toUpperCase()
}

export function stockDeps(env: StockEnv): StockDeps | null {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null
  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim() || PROJECT_ID
  return {
    store: restServerStore(projectId, env.FIREBASE_SERVICE_ACCOUNT),
    now: () => Date.now(),
    makeId: randomId,
    verifyUser: (h) => verifyFirebaseToken(h, projectId),
  }
}

export const notConfigured = () =>
  new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers: { 'content-type': 'application/json' } })
