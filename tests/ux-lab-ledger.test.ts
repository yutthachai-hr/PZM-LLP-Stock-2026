import { describe, expect, it } from 'vitest'
import {
  canTransition,
  dedupeKey,
  findDuplicate,
  nextIssueId,
  validateLedger,
  type Ledger,
  type LedgerIssue,
} from '../scripts/ux-lab/ledger'

const issue = (over: Partial<LedgerIssue> = {}): LedgerIssue => ({
  id: 'UX-0001',
  title: 'ค้นหาสินค้าด้วยชื่อเล่นไม่เจอ',
  file: 'issues/UX-0001-search-nickname.md',
  role: 'staff',
  route: '/requests',
  category: 'UX_FRICTION',
  severity: 'major',
  risk: 'MEDIUM',
  state: 'NEW',
  frequency: 1,
  runs: ['2026-09-23-SC-001-staff-branch-desktop'],
  ...over,
})

const ledger = (issues: LedgerIssue[]): Ledger => ({ version: 1, updatedAt: '2026-09-23', issues })

describe('canTransition', () => {
  it('walks the happy path all the way to CLOSED', () => {
    const path = [
      'NEW',
      'ANALYZING',
      'REPRODUCED',
      'FIXING',
      'QA_PASSED',
      'READY_FOR_USER_RETEST',
      'VERIFIED',
      'READY_FOR_RELEASE',
      'RELEASED',
      'CLOSED',
    ] as const
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  it('lets a failed QA go back to FIXING and a failed retest go back to ANALYZING', () => {
    expect(canTransition('FIXING', 'QA_FAILED')).toBe(true)
    expect(canTransition('QA_FAILED', 'FIXING')).toBe(true)
    expect(canTransition('READY_FOR_USER_RETEST', 'ANALYZING')).toBe(true)
  })

  it('lets analysis close an issue that needs no code change', () => {
    expect(canTransition('ANALYZING', 'CLOSED')).toBe(true)
  })

  it('refuses to jump the queue', () => {
    expect(canTransition('NEW', 'FIXING')).toBe(false)
    expect(canTransition('REPRODUCED', 'RELEASED')).toBe(false)
    expect(canTransition('CLOSED', 'NEW')).toBe(false)
  })
})

describe('nextIssueId', () => {
  it('starts at UX-0001 on an empty ledger', () => {
    expect(nextIssueId(ledger([]))).toBe('UX-0001')
  })

  it('carries on from the highest number, not the count', () => {
    expect(nextIssueId(ledger([issue({ id: 'UX-0001' }), issue({ id: 'UX-0007' })]))).toBe('UX-0008')
  })
})

describe('dedupeKey', () => {
  it('groups by the page and the kind of problem', () => {
    expect(dedupeKey(issue())).toBe('/requests|UX_FRICTION')
  })

  it('finds an existing issue the same run would have filed twice', () => {
    const l = ledger([issue()])
    expect(findDuplicate(l, issue({ id: 'UX-0002' }))?.id).toBe('UX-0001')
  })

  it('does not merge the same page with a different kind of problem', () => {
    const l = ledger([issue()])
    expect(findDuplicate(l, issue({ id: 'UX-0002', category: 'BUG' }))).toBeUndefined()
  })
})

describe('validateLedger', () => {
  const files = ['issues/UX-0001-search-nickname.md']

  it('passes a ledger that agrees with the files on disk', () => {
    expect(validateLedger(ledger([issue()]), files)).toEqual([])
  })

  it('catches an issue whose file is missing', () => {
    const problems = validateLedger(ledger([issue({ file: 'issues/UX-0001-gone.md' })]), files)
    expect(problems.join(' ')).toContain('UX-0001')
  })

  it('catches a file on disk that no ledger entry claims', () => {
    const problems = validateLedger(ledger([]), files)
    expect(problems.join(' ')).toContain('UX-0001-search-nickname.md')
  })

  it('catches two issues sharing an id', () => {
    const problems = validateLedger(
      ledger([issue(), issue({ file: 'issues/UX-0001-search-nickname.md' })]),
      files,
    )
    expect(problems.join(' ')).toContain('ซ้ำ')
  })

  it('catches frequency that disagrees with the runs listed', () => {
    const problems = validateLedger(ledger([issue({ frequency: 4 })]), files)
    expect(problems.join(' ')).toContain('frequency')
  })

  // The owner's safety rule, made mechanical: a risky change cannot be recorded as
  // released unless the owner's approval was recorded with it.
  it('refuses a HIGH issue that reached RELEASED without the owner approving', () => {
    const problems = validateLedger(ledger([issue({ risk: 'HIGH', state: 'RELEASED' })]), files)
    expect(problems.join(' ')).toContain('ownerApproved')
  })

  it('accepts a HIGH issue released with approval recorded', () => {
    expect(
      validateLedger(ledger([issue({ risk: 'HIGH', state: 'RELEASED', ownerApproved: true })]), files),
    ).toEqual([])
  })

  it('never lets a CRITICAL issue be released automatically', () => {
    const problems = validateLedger(ledger([issue({ risk: 'CRITICAL', state: 'RELEASED' })]), files)
    expect(problems.join(' ')).toContain('ownerApproved')
  })

  it('catches a dupeOf pointing at nothing', () => {
    const problems = validateLedger(ledger([issue({ dupeOf: 'UX-9999' })]), files)
    expect(problems.join(' ')).toContain('UX-9999')
  })
})
