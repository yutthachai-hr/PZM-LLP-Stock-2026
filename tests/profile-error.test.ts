// What a failed profile subscription means.
//
//   npm test
//
// Regression for a live fault: a tablet left open on a counter came back to the sign-in
// screen with no explanation, mid-shift, while Firebase Auth still held a valid session.
// The profile listener's error callback cleared the user for EVERY failure, so a dropped
// connection was handled the same way as a revoked account — and Firestore's onSnapshot
// does not retry, so one blip ended the listener for good.

import { describe, expect, test } from 'vitest'
import { classifyProfileError, retryDelayMs } from '../src/auth/profileError'

describe('classifying a profile listener failure', () => {
  test('the rules refusing the read is the only thing that means access is gone', () => {
    expect(classifyProfileError({ code: 'permission-denied' })).toBe('denied')
  })

  test('a dropped connection is not a sign-out', () => {
    expect(classifyProfileError({ code: 'unavailable' })).toBe('transient')
  })

  test('an exhausted daily read quota is not a sign-out either', () => {
    // The free plan gives the whole project 50,000 reads a day. Running out locked every
    // branch out of the app until midnight Pacific; it must not also log them out.
    expect(classifyProfileError({ code: 'resource-exhausted' })).toBe('transient')
  })

  test('an error with no code at all is assumed transient', () => {
    // Being wrong this way costs a retry. Being wrong the other way costs the shift's work.
    expect(classifyProfileError(new Error('boom'))).toBe('transient')
    expect(classifyProfileError(null)).toBe('transient')
    expect(classifyProfileError(undefined)).toBe('transient')
    expect(classifyProfileError('permission-denied')).toBe('transient')
  })

  test('cancelled and deadline-exceeded are transient', () => {
    expect(classifyProfileError({ code: 'cancelled' })).toBe('transient')
    expect(classifyProfileError({ code: 'deadline-exceeded' })).toBe('transient')
  })
})

describe('retry backoff', () => {
  test('starts at a second and backs off', () => {
    expect(retryDelayMs(1)).toBe(1000)
    expect(retryDelayMs(2)).toBe(2000)
    expect(retryDelayMs(3)).toBe(4000)
  })

  test('is capped, so a long outage does not become a long silence', () => {
    expect(retryDelayMs(5)).toBe(16_000)
    expect(retryDelayMs(50)).toBe(16_000)
    expect(retryDelayMs(500)).toBe(16_000)
  })

  test('a zero or negative attempt still waits', () => {
    // Guards against a caller resetting the counter and producing a hot loop against a
    // database that is already refusing reads.
    expect(retryDelayMs(0)).toBe(1000)
    expect(retryDelayMs(-3)).toBe(1000)
  })
})
