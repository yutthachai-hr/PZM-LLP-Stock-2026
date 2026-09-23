import { describe, expect, it } from 'vitest'
import { DEMO_USERS, DEMO_ADMIN } from '../src/services/demoUsers'

// The demo exists so a screen can be rehearsed without the warehouse. A rehearsal done
// entirely as an admin proves nothing about what a branch staffer or a shift manager can
// reach, so the seed has to hand out all three roles — this is what keeps that true.
describe('DEMO_USERS', () => {
  it('covers every role the app has', () => {
    expect([...DEMO_USERS].map((u) => u.role).sort()).toEqual(['admin', 'manager', 'staff'])
  })

  it('gives each one its own sign-in', () => {
    expect(new Set(DEMO_USERS.map((u) => u.email)).size).toBe(DEMO_USERS.length)
  })

  it('still names the admin the auto sign-in uses', () => {
    expect(DEMO_USERS.some((u) => u.email === DEMO_ADMIN.email && u.role === 'admin')).toBe(true)
  })
})
