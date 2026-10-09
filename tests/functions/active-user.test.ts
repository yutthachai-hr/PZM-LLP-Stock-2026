// Server endpoints check the caller is still active, not only that the token is valid (plan B6).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { stillActive } from '../../functions/_lib/activeUser'
import { memoryServerStore } from '../../functions/_lib/memoryStore'

describe('stillActive', () => {
  const store = memoryServerStore({
    users: { on: { active: true }, off: { active: false }, gone: { active: true } },
    revokedUsers: { gone: { at: 1 } },
  })
  test('an active account yes; switched off, revoked or unknown no', async () => {
    expect(await stillActive({}, 'on', store)).toBe(true)
    expect(await stillActive({}, 'off', store)).toBe(false)
    expect(await stillActive({}, 'gone', store)).toBe(false)
    expect(await stillActive({}, 'nobody', store)).toBe(false)
  })
  test('without the service account nothing can be checked, and the old behaviour stands', async () => {
    expect(await stillActive({}, 'anyone')).toBe(true)
  })
})
