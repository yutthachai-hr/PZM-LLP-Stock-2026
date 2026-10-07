// Lot / expiry — schema only. Defaults are false, and no stock path reads the flags yet.
//
//   npm test

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { tracksExpiry, tracksLot } from '../src/lib/lotExpiry'

test('absent or false means not tracked; only true turns it on', () => {
  expect([tracksLot({}), tracksLot({ trackLot: false }), tracksLot({ trackLot: true })]).toEqual([false, false, true])
  expect([tracksExpiry({}), tracksExpiry({ trackExpiry: false }), tracksExpiry({ trackExpiry: true })]).toEqual([false, false, true])
})

test('deferred: nothing outside the schema reads the flags yet (no behaviour change in this release)', () => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  walk('src')
  walk('functions')
  walk('worker/src')
  const readers = files.filter((f) => !/src[\\/](types|lib[\\/]lotExpiry)\.ts$/.test(f) && /trackLot|trackExpiry|tracksLot|tracksExpiry/.test(readFileSync(f, 'utf8')))
  expect(readers).toEqual([])
})
