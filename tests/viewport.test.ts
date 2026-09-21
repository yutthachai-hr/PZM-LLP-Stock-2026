// Which shell a screen width gets — the spec's three sizes (21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { viewportFor } from '../src/lib/viewport'

describe('viewportFor', () => {
  test('phones are below 768, tablets below 1280, desktops from 1280', () => {
    expect(viewportFor(375)).toBe('phone')
    expect(viewportFor(767)).toBe('phone')
    expect(viewportFor(768)).toBe('tablet')
    expect(viewportFor(1024)).toBe('tablet')
    expect(viewportFor(1279)).toBe('tablet')
    expect(viewportFor(1280)).toBe('desktop')
    expect(viewportFor(1920)).toBe('desktop')
  })
})
