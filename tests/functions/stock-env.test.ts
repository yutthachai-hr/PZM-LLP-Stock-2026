// The outbox is switched on deliberately (owner, 7 Oct 2026): merging it changed nothing in
// production until OUTBOX_ENABLED is set to "true".
import { describe, expect, test } from 'vitest'
import { stockDeps } from '../../functions/_lib/stockEnv'

const SA = JSON.stringify({ project_id: 'demo', client_email: 'x@demo.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----\n' })

describe('stockDeps: outbox switch', () => {
  test('unset, or anything but "true": no outbox events', () => {
    expect(stockDeps({ FIREBASE_SERVICE_ACCOUNT: SA })?.eventId).toBeUndefined()
    for (const v of ['false', '1', 'TRUE', 'yes', '']) expect(stockDeps({ FIREBASE_SERVICE_ACCOUNT: SA, OUTBOX_ENABLED: v })?.eventId, v).toBeUndefined()
  })
  test('"true": every commit gets its events, each with a fresh UUID', () => {
    const d = stockDeps({ FIREBASE_SERVICE_ACCOUNT: SA, OUTBOX_ENABLED: 'true' })
    const a = d?.eventId?.()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(d?.eventId?.()).not.toBe(a)
  })
  test('without a service account nothing is configured at all', () => {
    expect(stockDeps({ OUTBOX_ENABLED: 'true' })).toBeNull()
  })
})
