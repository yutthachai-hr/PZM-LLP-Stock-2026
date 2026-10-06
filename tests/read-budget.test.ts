// Release gate: the Firestore read budget for a busy day, from MEASURED per-open costs.
//
// The per-scenario figures are e2e/read-benchmark.spec.ts on a production-sized brand
// (docs/evidence/data/read-benchmark-{before,after}.json). The usage profile is calibrated
// so the BEFORE figures reproduce what production actually reported (~203k reads/day);
// the same profile then prices the AFTER code. Fails when a busy day goes over 25k.
//
//   npm test

import { expect, test } from 'vitest'

const MEASURED = {
  before: { coldOpen: 2_820, warmScreen: 17.5 },
  // Reopen with the device cache (avg of the cold.* scenarios and the second tab).
  after: { reopen: 70, warmScreen: 10, firstOpenOnDevice: 2_850, movementsFull: 430, rangeCachesFull: 220, suppliersFull: 31 },
}

/** A busy day, both brands together. */
const PROFILE = {
  opens: 70, // app opens / fresh tabs a day (calibrated: 70 × 2,820 + warm ≈ 203k)
  screensPerOpen: 3,
  devices: 10, // browsers that each keep their own cache
  cacheFullEveryDays: 7, // CACHE_MAX_AGE_MS
  rangeFullEveryDays: 1, // persisted order / transfer / request caches
  epochBumpsPerDay: 1, // an admin void or edit: every device reads the ledger window again
}

function day(code: 'before' | 'after'): number {
  if (code === 'before') return PROFILE.opens * (MEASURED.before.coldOpen + PROFILE.screensPerOpen * MEASURED.before.warmScreen)
  const a = MEASURED.after
  const opens = PROFILE.opens * (a.reopen + PROFILE.screensPerOpen * a.warmScreen)
  const weeklyFull = (PROFILE.devices / PROFILE.cacheFullEveryDays) * a.firstOpenOnDevice
  const bumps = PROFILE.epochBumpsPerDay * PROFILE.devices * a.movementsFull
  const daily = (PROFILE.devices / PROFILE.rangeFullEveryDays) * (a.rangeCachesFull + a.suppliersFull)
  return opens + weeklyFull + bumps + daily
}

test('the profile reproduces what production reported before the hardening', () => {
  const before = day('before')
  expect(before).toBeGreaterThan(203_000 * 0.85)
  expect(before).toBeLessThan(203_000 * 1.15)
})

test('a busy day after the hardening stays under 25k app reads (half the free quota or less)', () => {
  const after = day('after')
  console.info(JSON.stringify({ before: Math.round(day('before')), after: Math.round(after) }))
  expect(after).toBeLessThan(25_000)
})

test('even twice the opens stays well inside the free quota', () => {
  const saved = PROFILE.opens
  PROFILE.opens = saved * 2
  try {
    expect(day('after')).toBeLessThan(40_000)
  } finally {
    PROFILE.opens = saved
  }
})
