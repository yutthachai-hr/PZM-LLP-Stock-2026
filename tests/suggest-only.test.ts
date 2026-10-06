// Plan F1 exit gate: no automatic action the owner has not switched on. What runs without a
// person pressing a button — the cron Worker and the app's stand-in for it — may write only
// tasks, notifications and their own housekeeping; never a request, an order, a transfer
// or a stock row. The suggestion and risk rules write nothing at all.
//
// A source check, so a new write slipping into a job fails here before review.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('suggest-only: background jobs', () => {
  test('the browser automation names no collection but events', () => {
    const refs = new Set(read('src/services/automation.ts').match(/COL\.\w+/g) ?? [])
    expect([...refs]).toEqual(['COL.events'])
  })

  test('the cron Worker writes only tasks, notifications and messages housekeeping', () => {
    const src = read('worker/src/jobs.ts')
    const written = new Set([...src.matchAll(/collection: col\(COL\.(\w+)\)/g)].map((m) => m[1]))
    for (const c of written) expect(['events', 'notifications', 'messages']).toContain(c)
  })

  test('the suggestion, reorder and risk rules import nothing that writes', () => {
    for (const f of ['src/lib/inventoryRules/suggestions.ts', 'src/lib/inventoryRules/reorder.ts', 'src/lib/inventoryRules/insights.ts', 'src/lib/deliveryRisk.ts', 'src/lib/inventoryRisk.ts', 'src/lib/inventoryRules/supply.ts']) {
      const src = read(f)
      expect(src, f).not.toMatch(/from '(\.\.\/)+(backend|services)/)
    }
  })
})
