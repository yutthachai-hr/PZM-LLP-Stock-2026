// Multi-page PO send progress survives a reload, per brand, and expires.
import { beforeEach, describe, expect, test } from 'vitest'
import { clearPageProgress, pageToResume, savePageProgress } from '../src/pages/purchase/sendProgress'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage
})

describe('send progress', () => {
  test('resumes at the saved page, per brand and order, and clears', () => {
    savePageProgress('pizza', 'po1', 1, 1000)
    expect(pageToResume('pizza', 'po1', 3, 2000)).toBe(1)
    expect(pageToResume('lelapin', 'po1', 3, 2000)).toBe(0)
    expect(pageToResume('pizza', 'po2', 3, 2000)).toBe(0)
    clearPageProgress('pizza', 'po1')
    expect(pageToResume('pizza', 'po1', 3, 2000)).toBe(0)
  })

  test('never points past the last page (the order lost lines) and expires after a day', () => {
    savePageProgress('pizza', 'po1', 2, 0)
    expect(pageToResume('pizza', 'po1', 2, 10)).toBe(1)
    expect(pageToResume('pizza', 'po1', 1, 10)).toBe(0)
    expect(pageToResume('pizza', 'po1', 3, 86_400_001)).toBe(0)
  })

  test('unreadable storage is no progress, not a crash', () => {
    store.set('pmstock:v1:send-progress', '{not json')
    expect(pageToResume('pizza', 'po1', 3)).toBe(0)
  })
})
