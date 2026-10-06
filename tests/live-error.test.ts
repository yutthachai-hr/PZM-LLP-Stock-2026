// Plan C1: what a failed listener means on screen.
import { describe, expect, test } from 'vitest'
import { liveErrorKind, retriesBySelf, worstFailure } from '../src/data/liveError'

describe('a listener the database ended', () => {
  test('is classified by its code', () => {
    expect(liveErrorKind({ code: 'permission-denied' })).toBe('denied')
    expect(liveErrorKind({ code: 'resource-exhausted' })).toBe('quota')
    expect(liveErrorKind({ code: 'unavailable' })).toBe('offline')
    expect(liveErrorKind(new Error('boom'))).toBe('other')
    expect(liveErrorKind(null)).toBe('other')
  })

  test('only a dropped line retries by itself; a refusal or spent quota waits for a person', () => {
    expect(retriesBySelf('offline')).toBe(true)
    expect(retriesBySelf('denied')).toBe(false)
    expect(retriesBySelf('quota')).toBe(false)
  })

  test('the banner tells the worst one', () => {
    expect(worstFailure([null, null])).toBeNull()
    expect(worstFailure([{ collection: 'a', kind: 'offline' }, { collection: 'b', kind: 'denied' }, null])).toEqual({ collection: 'b', kind: 'denied' })
    expect(worstFailure([{ collection: 'a', kind: 'quota' }, { collection: 'b', kind: 'other' }])?.kind).toBe('quota')
  })
})
