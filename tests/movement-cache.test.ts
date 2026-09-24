import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory } = await import('./helpers/memory-backend')
const { movementCache } = await import('../src/data/movementCache')
const { setActiveBrand } = await import('../src/brand/brand')

beforeEach(() => {
  resetMemory()
  movementCache.clear()
  setActiveBrand('pizza')
  vi.restoreAllMocks()
})

describe('movement range cache', () => {
  test('serves historical movement range from memory once read', async () => {
    const from = 1_000_000
    const to = 2_000_000
    expect(movementCache.hasRange(from, to)).toBe(false)
    const r1 = await movementCache.fetchRange(from, to)
    expect(r1).toEqual([])
    expect(movementCache.hasRange(from, to)).toBe(true)

    // A narrower range within the loaded range is served from memory.
    expect(movementCache.hasRange(from + 100, to - 100)).toBe(true)
    const r2 = await movementCache.fetchRange(from + 100, to - 100)
    expect(r2).toEqual([])
  })
})
