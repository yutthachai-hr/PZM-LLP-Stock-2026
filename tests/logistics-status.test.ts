// Settings → ระบบส่งสินค้า (R61): a company whose transit document cannot be read is not shown
// as "off" with a button to press. Only a read that found nothing offers the switch.

import { describe, expect, test, vi } from 'vitest'

const reads: Record<string, () => Promise<unknown>> = {}
vi.mock('../src/backend', () => ({
  backend: { forBrand: (b: string) => ({ getOne: () => reads[b]() }) },
  BACKEND_MODE: 'cloud',
}))
const { statusOf } = await import('../src/pages/settings/LogisticsSection')

const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
const offline = Object.assign(new Error('unavailable'), { code: 'unavailable' })

describe('statusOf', () => {
  test.each([
    ['on', async () => ({ id: 'transit', type: 'transit' })],
    ['off', async () => null],
    ['wrongType', async () => ({ id: 'transit', type: 'warehouse' })],
    ['denied', async () => { throw denied }],
    ['unknown', async () => { throw offline }],
  ] as const)('%s', async (want, read) => {
    reads.pizza = read
    expect(await statusOf('pizza')).toBe(want)
  })
})
