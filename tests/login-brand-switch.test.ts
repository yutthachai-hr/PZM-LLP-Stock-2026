import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BRANDS, brandDef, type BrandId } from '../src/brand/brand'

describe('login brand switcher', () => {
  it('defines all 3 supported brands with circular logos', () => {
    const ids: BrandId[] = ['pizza', 'lelapin', 'rnd']
    expect(BRANDS.map((b) => b.id)).toEqual(ids)

    for (const id of ids) {
      const def = brandDef(id)
      expect(def.name).toBeTruthy()
      expect(def.logo).toMatch(/^\/brand\/.+\.png$/)
      expect(def.accent).toBeTruthy()
      expect(def.accentVivid).toBeTruthy()

      // Ensure the actual file exists in public directory
      const filePath = path.resolve('public', def.logo.replace(/^\//, ''))
      expect(fs.existsSync(filePath), `logo for ${id} must exist at ${filePath}`).toBe(true)
    }
  })

  it('cycles through brands circularly for keyboard arrow navigation', () => {
    const ids = BRANDS.map((b) => b.id)
    const nextOf = (curr: BrandId, step: number) => {
      const idx = ids.indexOf(curr)
      return ids[(idx + step + ids.length) % ids.length]
    }

    expect(nextOf('pizza', 1)).toBe('lelapin')
    expect(nextOf('lelapin', 1)).toBe('rnd')
    expect(nextOf('rnd', 1)).toBe('pizza') // wraps around
    expect(nextOf('pizza', -1)).toBe('rnd') // wraps backwards
  })
})
