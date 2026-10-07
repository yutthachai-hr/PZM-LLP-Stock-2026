// B2: the audit log — what each kind of change records, that a single-document change and
// its entry are one transaction, that a failed entry never fails the change, and that the
// history is read a page at a time.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, failWritesWhere } = await import('./helpers/memory-backend')
const audit = await import('../src/services/auditLog')
const { updateProduct, createProduct, addConversion, deleteProduct } = await import('../src/services/products')
const { updateLocation } = await import('../src/services/locations')
const { updateUserProfile } = await import('../src/services/users')
const { saveSettings } = await import('../src/services/schedules')
const { setActiveBrand } = await import('../src/brand/brand')

const ADMIN = { id: 'uid-admin', name: 'Admin', role: 'admin' as const }

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  store.clear()
  audit.setAuditActor(ADMIN)
  seed('products', [{ id: 'p1', sku: 'A-1', name: 'Bacon', category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 5, cost: 100, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
  seed('locations', [{ id: 'b1', name: 'Branch 1', type: 'branch', active: true, createdAt: 1 }])
  seed('users', [{ id: 'uid-staff', name: 'Staff', email: 's@x', role: 'staff', active: true, createdAt: 1 }])
})

const log = (brandPrefix = '') => raw(`${brandPrefix}auditLog`)

describe('what is recorded', () => {
  test('a threshold change: who, role, the changed fields before and after, nothing else', async () => {
    await updateProduct('p1', { minStock: 8 })
    const [e] = log()
    expect(e).toMatchObject({
      actorId: 'uid-admin', actorName: 'Admin', actorRole: 'admin', action: 'product.update', entityType: 'product', entityId: 'p1',
      before: { minStock: 5 }, after: { minStock: 8 },
    })
    expect(e.id).toMatch(/^[0-9]{14}_[a-z0-9]{1,12}$/)
    expect(typeof e.operationId).toBe('string')
    expect(e.before).not.toHaveProperty('updatedAt')
  })

  test('deactivation, a cleared field, unit conversions, roles and settings each have their own action', async () => {
    await updateProduct('p1', { active: false })
    await updateProduct('p1', { cost: undefined })
    await addConversion({ id: 'p1', unitType: 'KG', unitConversions: [] }, 'Box', 10)
    await updateLocation('b1', { active: false })
    await updateUserProfile('uid-staff', { role: 'manager' })
    await saveSettings({ coverDays: 9 }, { id: ADMIN.id })
    const actions = log().map((e) => e.action)
    expect(actions).toEqual(['product.deactivate', 'product.update', 'unitConversion.set', 'location.deactivate', 'user.role', 'settings.update'])
    const cleared = log()[1]
    expect(cleared).toMatchObject({ before: { cost: 100 }, after: { cost: null } })
    expect(log()[4]).toMatchObject({ before: { role: 'staff' }, after: { role: 'manager' } })
  })

  test('a create and a delete', async () => {
    const id = await createProduct({ sku: 'B-1', name: 'Ham', category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 1 })
    await deleteProduct(id)
    const [c, d] = log()
    expect(c).toMatchObject({ action: 'product.create', entityId: id, before: null })
    expect((c.after as Record<string, unknown>).name).toBe('Ham')
    expect(d).toMatchObject({ action: 'product.delete', entityId: id, after: null })
    expect((d.before as Record<string, unknown>).sku).toBe('B-1')
  })

  test("each brand keeps its own log", async () => {
    setActiveBrand('lelapin')
    seed('lelapin__products', [{ id: 'q1', sku: 'L', name: 'Flour', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 1, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
    await updateProduct('q1', { minStock: 2 })
    expect(log('lelapin__')).toHaveLength(1)
    expect(log()).toHaveLength(0)
  })

  test('large values are summarised, never stored whole', () => {
    expect(audit.snapshot({ logo: 'data:image/png;base64,' + 'A'.repeat(5000), list: Array.from({ length: 500 }, (_, i) => i) })).toEqual({
      logo: expect.stringMatching(/^\[data \d+ chars\]$/),
      list: expect.stringMatching(/^\[\d+ chars\]$/),
    })
  })
})

describe('reliability', () => {
  test('the change and its entry are one transaction: a refused change leaves no entry', async () => {
    failWritesWhere((c) => c === 'products')
    await expect(updateProduct('p1', { minStock: 9 })).rejects.toThrow()
    expect(log()).toHaveLength(0)
  })

  test('a refused entry refuses the single-document change with it — never one without the other', async () => {
    failWritesWhere((c) => c === 'auditLog')
    await expect(updateProduct('p1', { minStock: 9 })).rejects.toThrow()
    expect(raw('products')[0].minStock).toBe(5)
  })

  test('a multi-step change stands when its entry fails; the entry waits on the device and is sent next time', async () => {
    failWritesWhere((c) => c === 'auditLog')
    const id = await createProduct({ sku: 'B-2', name: 'Salt', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 1 })
    expect(raw('products').some((p) => p.id === id)).toBe(true)
    expect(log()).toHaveLength(0)
    failWritesWhere(() => false)
    await audit.flushAuditOutbox()
    expect(log().map((e) => e.action)).toEqual(['product.create'])
    expect(store.get('pzm-audit-outbox')).toBeUndefined()
  })

  test('nothing is recorded with nobody signed in (no anonymous entries)', async () => {
    audit.setAuditActor(null)
    await updateProduct('p1', { minStock: 7 })
    expect(log()).toHaveLength(0)
  })
})

describe('reading', () => {
  test('newest first, 50 a page, then the next page from where it stopped', async () => {
    seed('auditLog', Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, createdAt: 1_000 + i, action: 'product.update' })))
    const first = await audit.loadAuditPage()
    expect(first.rows).toHaveLength(50)
    expect(first.more).toBe(true)
    expect(first.rows[0].createdAt).toBe(1_119)
    const second = await audit.loadAuditPage(first.rows.at(-1)!.createdAt)
    expect(second.rows[0].createdAt).toBe(1_069)
    const third = await audit.loadAuditPage(second.rows.at(-1)!.createdAt)
    expect(third.rows).toHaveLength(20)
    expect(third.more).toBe(false)
  })
})
