// Transfer notifications open the transfer (R63, 24 Oct 2026). The three transfer drafts linked to
// `/logistics/<id>`, a route the app never had, so the catch-all sent the click to the dashboard.
// New drafts link to `/transfers/<id>`; stored ones keep the old link and are mapped on click.
//
//   npm test

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { transferArrivingDraft, transferIssueDraft, transferSubmittedDraft } from '../src/lib/inventoryRules/notifications'
import { NOTIFICATION_ROUTES, canonicalLink } from '../src/lib/notificationLink'
import { presentNotification } from '../src/lib/notificationPresentation'
import type { AppNotification, Transfer } from '../src/types'

// The document id and the document number differ on purpose: the link must carry the id.
const transfer = {
  id: 'tr-7Hq2',
  docNo: 'TR-00001',
  status: 'submitted',
  fromLocationId: 'wh',
  toLocationId: 'br',
  requestedByName: 'WH',
  submittedAt: 1,
  approvedAt: 2,
  createdAt: 1,
  items: [],
} as unknown as Transfer
const name = (id: string | undefined) => id ?? ''

describe('transfer drafts link to the transfer page by document id', () => {
  test.each([
    ['transferSubmitted', transferSubmittedDraft(transfer, name)],
    ['transferArriving', transferArrivingDraft(transfer, name)],
    ['transferIssue', transferIssueDraft(transfer, name, 'SR')],
  ])('%s', (_kind, draft) => {
    expect(draft.link).toBe('/transfers/tr-7Hq2')
    expect(canonicalLink(draft.link)).toBe('/transfers/tr-7Hq2')
  })
})

describe('canonicalLink', () => {
  test.each([
    ['/transfers/tr-7Hq2', '/transfers/tr-7Hq2'],
    ['/logistics/tr-7Hq2', '/transfers/tr-7Hq2'],
    ['/logistics/tr-7Hq2?tab=items', '/transfers/tr-7Hq2?tab=items'],
    ['/logistics', '/transfers'],
    ['/orders?po=po6', '/orders?po=po6'],
    ['/calendar?item=task__e1', '/calendar?item=task__e1'],
    ['/requests/pr1', '/requests/pr1'],
    ['/settings/notifications', '/settings/notifications'],
    ['/settings#notifications', '/settings#notifications'],
    ['/', '/'],
  ])('%s -> %s', (link, want) => {
    expect(canonicalLink(link)).toBe(want)
  })

  test.each([
    'https://evil.example/transfers/x',
    '//evil.example/transfers/x',
    '/\\evil.example',
    'javascript:alert(1)',
    'transfers/x',
    '',
    '/logistics/a/b',
    '/logisticsx/1',
    '/unknown/1',
    '/transfers/../settings',
    '/transfers/x\nSet-Cookie',
    '/transfers/x y',
    '/transfers/x/unsupported',
    '/transfers/%2e%2e',
    '/transfers/a%2Fb',
    '/transfers/%255c',
    '/transfers/%ZZ',
    '/transfers/x?brand=rnd',
    '/logistics/x?company=lelapin',
  ])('refuses %j', (link) => {
    expect(canonicalLink(link)).toBeNull()
  })

  test('refuses what is not a string', () => {
    expect(canonicalLink(undefined)).toBeNull()
    expect(canonicalLink(null)).toBeNull()
    expect(canonicalLink(42)).toBeNull()
  })

  test('knows the exact routes, not the catch-all', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const routed = [...app.matchAll(/<Route path="(\/[^"*]*)"/g)].map((m) => m[1])
    expect([...NOTIFICATION_ROUTES].sort()).toEqual(routed.sort())
  })
})

function note(link: string): AppNotification {
  return {
    id: 'transferSubmitted__tr-7Hq2__1',
    kind: 'transferSubmitted',
    category: 'inventory',
    priority: 'medium',
    to: { roles: ['manager', 'admin'] },
    params: { docNo: 'TR-00001' },
    link,
    active: true,
    readBy: {},
    source: 'client',
    createdBy: 'x',
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2,
  }
}

describe('presentation of transfer notifications', () => {
  test.each(['/transfers/tr-7Hq2', '/logistics/tr-7Hq2'])('%s is the transfer, opened at /transfers', (link) => {
    const p = presentNotification(note(link))
    expect(p).toMatchObject({ entityType: 'transfer', entityId: 'tr-7Hq2', actionUrl: '/transfers/tr-7Hq2' })
    expect(p.actions).toEqual([{ label: 'ดูใบโอน', url: '/transfers/tr-7Hq2' }])
  })

  test('a link that goes nowhere offers no button to press', () => {
    const p = presentNotification(note('https://evil.example/x'))
    expect(p.actions).toEqual([])
    expect(p.actionUrl).toBe('')
  })
})
