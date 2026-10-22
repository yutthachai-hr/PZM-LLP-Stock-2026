// What a PO send records once the share sheet / LINE picker has answered (R38 review finding B):
// the "opened" status is written while the share is in flight, and its failure must never turn
// a delivery LINE confirmed into "failed" — that is the path to a duplicate send.
import { describe, expect, test, vi } from 'vitest'
import { settleShare } from '../src/pages/purchase/shareSettle'
import type { ShareOutcome } from '../src/share'

const ok = () => Promise.resolve()
const fail = () => Promise.reject(new Error('write failed'))

function run(o: { outcome?: ShareOutcome; shareError?: Error; opened?: () => Promise<void>; sent?: () => Promise<void>; isLast?: boolean }) {
  const recordSent = vi.fn(o.sent ?? ok)
  const recordFailed = vi.fn(ok)
  const shared = o.shareError ? Promise.reject(o.shareError) : Promise.resolve(o.outcome ?? 'sent')
  const p = settleShare({ shared, opened: (o.opened ?? ok)(), isLast: o.isLast ?? true, recordSent, recordFailed })
  return { p, recordSent, recordFailed }
}

describe('settling a share', () => {
  test('LINE confirmed and every write landed: sent', async () => {
    const r = run({ outcome: 'sent' })
    expect(await r.p).toEqual({ kind: 'sent' })
    expect(r.recordSent).toHaveBeenCalledTimes(1)
    expect(r.recordFailed).not.toHaveBeenCalled()
  })

  test('LINE confirmed but the "opened" write failed: still recorded as sent, never failed', async () => {
    const r = run({ outcome: 'sent', opened: fail })
    expect(await r.p).toEqual({ kind: 'sent' })
    expect(r.recordSent).toHaveBeenCalledTimes(1)
    expect(r.recordFailed).not.toHaveBeenCalled()
  })

  test('LINE confirmed but the "sent" write failed: delivery is known, the record is not — no resend offered', async () => {
    const r = run({ outcome: 'sent', opened: fail, sent: fail })
    const out = await r.p
    expect(out.kind).toBe('sentUnsaved')
    expect(r.recordFailed).not.toHaveBeenCalled()
  })

  test('the share itself failed: failed, recorded once, whatever the opened write did', async () => {
    for (const opened of [ok, fail]) {
      const r = run({ shareError: new Error('NotAllowedError'), opened })
      const out = await r.p
      expect(out).toMatchObject({ kind: 'failed' })
      expect(r.recordFailed).toHaveBeenCalledTimes(1)
      expect(r.recordSent).not.toHaveBeenCalled()
    }
  })

  test('picker closed: nothing recorded', async () => {
    const r = run({ outcome: 'cancelled' })
    expect(await r.p).toEqual({ kind: 'cancelled' })
    expect(r.recordSent).not.toHaveBeenCalled()
    expect(r.recordFailed).not.toHaveBeenCalled()
  })

  test('share sheet on the last page asks the person, even if the opened write failed', async () => {
    for (const opened of [ok, fail]) expect(await run({ outcome: 'shareOpened', opened }).p).toEqual({ kind: 'ask' })
  })

  test('an earlier page moves on, LINE-confirmed or not, and writes no final status', async () => {
    for (const outcome of ['sent', 'shareOpened'] as const) {
      const r = run({ outcome, isLast: false })
      expect(await r.p).toEqual({ kind: 'nextPage' })
      expect(r.recordSent).not.toHaveBeenCalled()
    }
  })
})
