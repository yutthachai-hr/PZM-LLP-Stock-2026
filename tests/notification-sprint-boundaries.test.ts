import { beforeEach, expect, test, vi } from 'vitest'
import { setActiveBrand } from '../src/brand/brand'
import type { AppNotification } from '../src/types'
vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed, failWritesWhere } = await import('./helpers/memory-backend')
const { markRead, markAllRead } = await import('../src/services/notifications')
const note = (id: string) => ({ id, readBy: {} }) as AppNotification
beforeEach(() => { resetMemory(); setActiveBrand('pizza') })

test('concurrent identical clicks issue one actual backend update, not merely the same final value', async () => {
  const n = note('same')
  seed('notifications', [n as unknown as Record<string, unknown>])
  let writes = 0
  failWritesWhere(() => { writes++; return false })
  await Promise.all([markRead(n, 'user', 2000), markRead(n, 'user', 2000)])
  expect(writes).toBe(1)
  expect(raw('notifications')[0].readBy).toEqual({ user: 2000 })
})

test('read-all stops after a brand change DURING its first update; never updates matching IDs in another company', async () => {
  const list = [note('first'), note('second')]
  const rows = list as unknown as Record<string, unknown>[]
  seed('notifications', rows)
  seed('rnd__notifications', rows)
  const writes: string[] = []
  failWritesWhere((collection, id) => {
    writes.push(`${collection}/${id}`)
    if (id === 'first') setActiveBrand('rnd')
    return false
  })
  const count = await markAllRead(list, 'user', 'pizza')
  expect(count).toBe(1)
  expect(writes).toEqual(['notifications/first'])
  expect(raw('rnd__notifications').map(n => n.readBy)).toEqual([{}, {}])
})
