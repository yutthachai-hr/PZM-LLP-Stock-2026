import { readFileSync } from 'node:fs'
import { createAccount, putDoc, putPaths, resetEmulators } from './emulator'
import { PASSWORD, PEOPLE, type Person } from './fixture'

/**
 * A real brand's data, loaded from a backup file into the emulator — so read costs are
 * measured against real volumes (336 products, 524 balances, 3,173 movements …) instead of
 * a toy stage. The file never leaves this machine and nothing is written anywhere but the
 * local emulator. Set PZM_BACKUP to the file (Settings › สำรองข้อมูล).
 *
 * The backup's own accounts are left as data; the test people from fixture.ts are added
 * to sign in with.
 */
export function backupPath(): string | undefined {
  return process.env.PZM_BACKUP
}

export async function seedFromBackup(file: string): Promise<{ uid: Record<Person, string>; counts: Record<string, number> }> {
  await resetEmulators()
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { brand: string; data: Record<string, Record<string, unknown>[]> }
  // The brand's collection prefix: Pizza Mania is unprefixed, Le Lapin `lelapin__`.
  const prefix = backup.brand === 'lelapin' ? 'lelapin__' : ''
  const docs: { path: string; data: Record<string, unknown> }[] = []
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(backup.data)) {
    // Accounts and meta are global, not per brand; the test people replace the accounts.
    if (name === 'users') continue
    const col = name === 'meta' ? 'meta' : `${prefix}${name}`
    for (const row of rows) {
      const id = String(row.id)
      if (!id) continue
      docs.push({ path: `${col}/${id}`, data: row })
    }
    counts[name] = rows.length
  }
  await putPaths(docs)
  const uid = {} as Record<Person, string>
  const now = Date.now()
  for (const [key, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    uid[key] = await createAccount(p.email, PASSWORD)
    await putDoc(`users/${uid[key]}`, { name: p.name, email: p.email, role: p.role, active: true, createdAt: now }, { stampId: false })
  }
  return { uid, counts }
}
