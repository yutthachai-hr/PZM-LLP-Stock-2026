// The issue ledger: what an issue is, which moves it may make, and whether the index on
// disk still agrees with the files beside it.
//
// This module is deliberately pure. The CLI reads the files; everything decided here is
// decided from values, so the rules that matter — above all that a risky change cannot be
// recorded as released without the owner's approval — are covered by tests rather than by
// someone remembering them.

export type IssueState =
  | 'NEW'
  | 'ANALYZING'
  | 'REPRODUCED'
  | 'NEEDS_MORE_DATA'
  | 'FIXING'
  | 'QA_PASSED'
  | 'QA_FAILED'
  | 'READY_FOR_USER_RETEST'
  | 'VERIFIED'
  | 'READY_FOR_RELEASE'
  | 'RELEASED'
  | 'CLOSED'

export type Category =
  | 'BUG'
  | 'UX_FRICTION'
  | 'MISSING_FEATURE'
  | 'BUSINESS_RULE'
  | 'TRAINING_ISSUE'
  | 'PERFORMANCE'

/** How much the problem hurts. Not the same question as Risk. */
export type Severity = 'blocker' | 'major' | 'minor' | 'cosmetic'

/** How dangerous the fix is. A crooked button on the approval screen is low severity, high risk. */
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface LedgerIssue {
  id: string
  title: string
  /** Path of the issue's own file, relative to docs/ux-lab/. */
  file: string
  role: 'staff' | 'manager'
  route: string
  category: Category
  severity: Severity
  risk: Risk
  state: IssueState
  /** How many runs hit this. Must equal runs.length. */
  frequency: number
  runs: string[]
  /** Set when this turned out to be another issue wearing a different hat. */
  dupeOf?: string
  /** The owner said yes, in chat, to this reaching production. */
  ownerApproved?: boolean
}

export interface Ledger {
  version: 1
  updatedAt: string
  issues: LedgerIssue[]
}

export const NEXT_STATES: Record<IssueState, IssueState[]> = {
  NEW: ['ANALYZING'],
  // Analysis may end the story: a TRAINING_ISSUE is not a code change.
  ANALYZING: ['REPRODUCED', 'NEEDS_MORE_DATA', 'CLOSED'],
  NEEDS_MORE_DATA: ['ANALYZING'],
  REPRODUCED: ['FIXING'],
  FIXING: ['QA_PASSED', 'QA_FAILED'],
  QA_FAILED: ['FIXING'],
  QA_PASSED: ['READY_FOR_USER_RETEST'],
  // A retest that still fails sends it back to the start of thinking, not of fixing.
  READY_FOR_USER_RETEST: ['VERIFIED', 'ANALYZING'],
  VERIFIED: ['READY_FOR_RELEASE'],
  READY_FOR_RELEASE: ['RELEASED'],
  RELEASED: ['CLOSED'],
  CLOSED: [],
}

export function canTransition(from: IssueState, to: IssueState): boolean {
  return NEXT_STATES[from].includes(to)
}

const NUMBER = /^UX-(\d{4})$/

export function nextIssueId(ledger: Ledger): string {
  const highest = ledger.issues.reduce((max, i) => {
    const m = NUMBER.exec(i.id)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `UX-${String(highest + 1).padStart(4, '0')}`
}

/** Two findings on the same page about the same kind of problem are one issue. */
export function dedupeKey(issue: Pick<LedgerIssue, 'route' | 'category'>): string {
  return `${issue.route}|${issue.category}`
}

export function findDuplicate(
  ledger: Ledger,
  candidate: Pick<LedgerIssue, 'route' | 'category'>,
): LedgerIssue | undefined {
  const key = dedupeKey(candidate)
  return ledger.issues.find((i) => !i.dupeOf && dedupeKey(i) === key)
}

/** States in which a change has actually reached the company's real data. */
const RELEASED_STATES: IssueState[] = ['RELEASED', 'CLOSED']

export function validateLedger(ledger: Ledger, issueFiles: readonly string[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const ids = new Set(ledger.issues.map((i) => i.id))
  const claimed = new Set<string>()

  for (const i of ledger.issues) {
    if (!NUMBER.test(i.id)) problems.push(`${i.id}: รหัสต้องเป็นรูปแบบ UX-0001`)
    if (seen.has(i.id)) problems.push(`${i.id}: รหัสซ้ำในทะเบียน`)
    seen.add(i.id)
    claimed.add(i.file)

    if (!issueFiles.includes(i.file)) {
      problems.push(`${i.id}: ทะเบียนอ้างไฟล์ ${i.file} ที่ไม่มีอยู่จริง`)
    }
    if (i.frequency !== i.runs.length) {
      problems.push(`${i.id}: frequency = ${i.frequency} แต่มี run อยู่ ${i.runs.length} รายการ`)
    }
    if (i.dupeOf && !ids.has(i.dupeOf)) {
      problems.push(`${i.id}: dupeOf ชี้ไปที่ ${i.dupeOf} ซึ่งไม่มีในทะเบียน`)
    }
    if ((i.risk === 'HIGH' || i.risk === 'CRITICAL') && RELEASED_STATES.includes(i.state) && !i.ownerApproved) {
      problems.push(`${i.id}: risk ${i.risk} ขึ้นของจริงแล้วแต่ไม่มี ownerApproved — ต้องให้เจ้าของอนุมัติก่อน`)
    }
  }

  for (const file of issueFiles) {
    if (!claimed.has(file)) problems.push(`${file}: มีไฟล์อยู่แต่ไม่มีในทะเบียน`)
  }

  return problems
}
