// A product photo is read from Firestore once per device and version, not on every visit
// (owner, 26 Sep 2026 — the free tier's reads). The device store and the read are mocked.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

const kept = new Map<string, { v: number; dataUrl: string }>()
const reads: string[] = []

vi.mock('../src/lib/imageStore', () => ({
  readStoredImage: async (key: string, version: number) => {
    const e = kept.get(key)
    return e && e.v === version ? e.dataUrl : undefined
  },
  storeImage: async (key: string, version: number, dataUrl: string) => {
    kept.set(key, { v: version, dataUrl })
  },
  forgetStoredImage: async (key: string) => {
    kept.delete(key)
  },
}))

vi.mock('../src/services/products', () => ({
  getProductImage: async (id: string) => {
    reads.push(id)
    return id === 'none' ? null : `data:image/jpeg;base64,${id}`
  },
}))

const { forgetProductImage, loadProductImage } = await import('../src/services/productImageCache')
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  kept.clear()
  reads.length = 0
})

describe('product photos kept on the device', () => {
  test('the second visit reads nothing', async () => {
    expect(await loadProductImage('pizza', 'p1', 100)).toContain('p1')
    await settle()
    expect(await loadProductImage('pizza', 'p1', 100)).toContain('p1')
    expect(reads).toEqual(['p1'])
  })

  test('a new version of the product fetches the photo again and keeps that one', async () => {
    await loadProductImage('pizza', 'p1', 100)
    await settle()
    await loadProductImage('pizza', 'p1', 200)
    await settle()
    expect(reads).toEqual(['p1', 'p1'])
    expect(kept.get('pizza::p1')?.v).toBe(200)
  })

  test('the brands do not share a photo', async () => {
    await loadProductImage('pizza', 'p1', 100)
    await settle()
    await loadProductImage('lelapin', 'p1', 100)
    expect(reads).toEqual(['p1', 'p1'])
  })

  test('without a version nothing is kept; a missing photo is not kept either', async () => {
    await loadProductImage('pizza', 'p1', undefined)
    expect(await loadProductImage('pizza', 'none', 5)).toBeNull()
    await settle()
    expect(kept.size).toBe(0)
  })

  test('forgetting drops the copy for every brand', async () => {
    await loadProductImage('pizza', 'p1', 100)
    await loadProductImage('lelapin', 'p1', 100)
    await settle()
    forgetProductImage('p1', ['pizza', 'lelapin'])
    await settle()
    expect(kept.size).toBe(0)
  })
})
