import type { Role } from '../types'

/**
 * Who exists in a demo build.
 *
 * Kept apart from demoSeed.ts because that file reaches for the backend the moment it is
 * imported, and this roster is plain data that both the seeder and the sign-in card need.
 *
 * All three roles are here on purpose. A screen rehearsed entirely as an admin says nothing
 * about what a branch staffer can reach, and "can this person even get to it" is one of the
 * things a rehearsal is for.
 */
export interface DemoUser {
  name: string
  email: string
  role: Role
}

/** One password for all of them: this is a sandbox in browser storage, not an account. */
export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS: readonly DemoUser[] = [
  { name: 'ผู้ดูแลเดโม', email: 'demo@inventory-pzm.local', role: 'admin' },
  { name: 'หัวหน้าเดโม', email: 'manager@inventory-pzm.local', role: 'manager' },
  { name: 'พนักงานเดโม', email: 'staff@inventory-pzm.local', role: 'staff' },
]

/** The one the demo signs itself in as, so a showing needs no typing. */
export const DEMO_ADMIN = {
  name: DEMO_USERS[0].name,
  email: DEMO_USERS[0].email,
  password: DEMO_PASSWORD,
} as const
