// The morning digest shared into a LINE group (Automation Plan Phase 5, 25 Sep 2026):
// LINE Personal via the LIFF picker, a card whose rows open the page where the job is done.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { buildDigest, digestFlex, digestText } from '../src/lib/dailyDigest'

const t = (s: string, v?: Record<string, string | number>) => (v ? Object.entries(v).reduce((a, [k, x]) => a.replace(`{${k}}`, String(x)), s) : s)
const input = {
  brandName: 'Pizza Mania', dateText: '25/09/2569', arrivingToday: 3, lateOrders: 1, pendingRequests: 2,
  pendingTransfers: 0, transfersOnTheWay: 1, lowStock: 7, lowNames: ['A', 'B', 'C', 'D', 'E', 'F'], suggestedLines: 12,
}

describe('daily digest', () => {
  test('a row per figure, each with the page to open; waiting work is flagged', () => {
    const d = buildDigest(input, t)
    expect(d.title).toBe('สรุปประจำวัน — Pizza Mania')
    expect(d.rows.map((r) => [r.key, r.value, r.path])).toEqual([
      ['arriving', 3, '/receive'],
      ['late', 1, '/orders'],
      ['pr', 2, '/requests?filter=pendingApproval'],
      ['trPending', 0, '/transfers?status=pendingApproval'],
      ['trWay', 1, '/transfers/today'],
      ['low', 7, '/products'],
      ['suggest', 12, '/'],
    ])
    expect(d.rows.find((r) => r.key === 'late')?.alert).toBe(true)
    expect(d.rows.find((r) => r.key === 'trPending')?.alert).toBe(false)
    expect(d.low).toHaveLength(5)
  })

  test('the Flex card links every row on https, and never on a local http address', () => {
    const d = buildDigest(input, t)
    const live = JSON.stringify(digestFlex(d, 'https://demo.pzmstock.pages.dev').contents)
    expect(live).toContain('"uri":"https://demo.pzmstock.pages.dev/requests?filter=pendingApproval"')
    const local = JSON.stringify(digestFlex(d, 'http://localhost:5173').contents)
    expect(local).not.toContain('"uri"')
    expect(digestFlex(d, 'https://x').altText.length).toBeLessThanOrEqual(400)
  })

  test('the text version carries the same figures with a link under each', () => {
    const text = digestText(buildDigest(input, t), 'https://pzmstock.pages.dev', t)
    expect(text).toContain('ใบขอสั่งซื้อรออนุมัติ: 2')
    expect(text).toContain('https://pzmstock.pages.dev/receive')
    expect(text).toContain('ใกล้หมด: A, B, C, D, E')
  })
})
