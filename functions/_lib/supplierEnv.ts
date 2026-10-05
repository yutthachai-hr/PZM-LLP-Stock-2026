import { PROJECT_ID, verifyFirebaseToken } from '../_poImage'
import { memoryServerStore } from './memoryStore'
import { restServerStore } from './serverStore'
import type { Deps } from './supplierPo'
import { MIN_SECRET_LENGTH } from './supplierToken'

/**
 * The real dependencies of the supplier-confirmation endpoints, from the Pages
 * environment. Both secrets are set by the owner in the Cloudflare dashboard (Production):
 *
 *   FIREBASE_SERVICE_ACCOUNT  the service-account JSON key (roles/datastore.user only)
 *   SUPPLIER_LINK_SECRET      32+ random characters; changing it kills every link sent
 *
 * Without them every endpoint answers 503 `not_configured` and the app sends sheets exactly
 * as it did before links existed — which is also how to switch the feature off.
 */
export interface SupplierEnv {
  FIREBASE_SERVICE_ACCOUNT?: string
  SUPPLIER_LINK_SECRET?: string
  FIREBASE_PROJECT_ID?: string
  /** Local preview only (`.dev.vars`): an in-memory database with one sample order. */
  SUPPLIER_DEV_FIXTURE?: string
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/

let fixture: ReturnType<typeof memoryServerStore> | null = null

function randomId(): string {
  const b = new Uint8Array(9)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function liveDeps(env: SupplierEnv, request: Request): Deps | null {
  const url = new URL(request.url)
  const secret = (env.SUPPLIER_LINK_SECRET ?? '').trim()
  if (secret.length < MIN_SECRET_LENGTH) return null
  const base = { secret, now: () => Date.now(), makeId: randomId, origin: url.origin }

  if (env.SUPPLIER_DEV_FIXTURE === '1') {
    // Never on a real host, whatever the variables say.
    if (!LOCAL.test(url.hostname)) return null
    fixture ??= devFixture()
    return { ...base, store: fixture, verifyUser: async (h) => (h === 'Bearer dev' ? 'dev-admin' : null) }
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT) return null
  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim() || PROJECT_ID
  return {
    ...base,
    store: restServerStore(projectId, env.FIREBASE_SERVICE_ACCOUNT),
    verifyUser: (h) => verifyFirebaseToken(h, projectId),
  }
}

export const notConfigured = () =>
  new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers: { 'content-type': 'application/json' } })

/** One open order due in three days, for walking the supplier page locally. */
function devFixture() {
  const now = Date.now()
  const day = 86_400_000
  const due = Math.floor((now + 7 * 3_600_000) / day) * day - 7 * 3_600_000 + 3 * day
  return memoryServerStore({
    users: { 'dev-admin': { name: 'Dev Admin', email: 'dev@example.test', role: 'admin', active: true, createdAt: now } },
    purchaseOrders: {
      'dev-po-1': {
        docNo: 'PO-00042',
        supplierId: 'dev-supplier',
        supplierName: 'BETAGRO',
        status: 'ordered',
        locationId: 'warehouse',
        orderedAt: now,
        expectedAt: due,
        lines: [
          { productId: 'p1', productName: 'MOZZARELLA 2.72 KG', unit: 'ถุง', orderedQty: 8 },
          { productId: 'p2', productName: 'SMOKED BACON', unit: 'แพ็ค', orderedQty: 12 },
          { productId: 'p3', productName: 'PEPPERONI 1 KG', unit: 'แพ็ค', orderedQty: 6 },
        ],
        sentBy: 'dev-admin',
        createdBy: 'dev-admin',
        createdByName: 'Dev Admin',
        createdAt: now,
        updatedAt: now,
      },
    },
  })
}
