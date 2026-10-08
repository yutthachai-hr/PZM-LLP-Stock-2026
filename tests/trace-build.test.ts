// Release runbook (9 Oct 2026): stock commands carry the app build, so old PWA tabs can be
// counted from the function logs before the strict G25 rules go live — no Firestore reads.
//
//   npm test
import { describe, expect, test } from 'vitest'
import { BUILD_HEADER, fromHeaders, traceLine } from '../src/lib/trace'

describe('the calling build', () => {
  test('a build id is taken from its header and logged', () => {
    const ok = fromHeaders((h) => (h === BUILD_HEADER ? 'a1b2c3d4e5f6' : null))
    expect(ok.build).toBe('a1b2c3d4e5f6')
    expect(JSON.parse(traceLine({ ...ok, stage: 'api.command' })).build).toBe('a1b2c3d4e5f6')
    expect(fromHeaders((h) => (h === BUILD_HEADER ? 'dev' : null)).build).toBe('dev')
  })
  test('anything that is not a build id is dropped, never logged', () => {
    const ids = fromHeaders(() => null)
    for (const bad of ['<script>', 'x'.repeat(50), 'ABC; drop', '']) {
      expect(fromHeaders((h) => (h === BUILD_HEADER ? bad : null)).build, bad).toBeUndefined()
      expect(JSON.parse(traceLine({ traceId: ids.traceId, requestId: ids.requestId, build: bad })).build, bad).toBeUndefined()
    }
  })
})
