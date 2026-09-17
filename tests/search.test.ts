// Loose matching: what people type versus what the catalogue says.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { foldSearch, looseIncludes, looseMatch, looseScore } from '../src/lib/search'

describe('loose search', () => {
  test('spacing, case and punctuation do not matter', () => {
    expect(looseIncludes('SIAMFOOD', 'siam food')).toBe(true)
    expect(looseIncludes('SIAM FOOD', 'siamfood')).toBe(true)
    expect(looseIncludes('RED OAK SALAD (ACK)', 'redoak')).toBe(true)
    expect(looseIncludes('D.K. BAKERY', 'dk bakery')).toBe(true)
    expect(foldSearch('B & B (Co.)')).toBe('bbco')
  })

  test('several words match in any order; one word must appear as typed', () => {
    expect(looseIncludes('RED OAK SALAD (ACK)', 'salad ack')).toBe(true)
    expect(looseIncludes('RED OAK SALAD (ACK)', 'ack red')).toBe(true)
    expect(looseIncludes('RED OAK SALAD (ACK)', 'oakred')).toBe(false)
    expect(looseIncludes('RED OAK SALAD (ACK)', 'green')).toBe(false)
  })

  test('Thai text folds the same way', () => {
    expect(looseIncludes('ณายลอย เบเกอรี่', 'ณายลอยเบเกอรี่')).toBe(true)
    expect(looseIncludes('คลัง หลัก', 'คลังหลัก')).toBe(true)
  })

  test('an empty needle matches everything; fields are tried in turn', () => {
    expect(looseMatch(['X'], '   ')).toBe(true)
    expect(looseMatch([undefined, 'VGT-01-01-001'], 'vgt0101')).toBe(true)
    expect(looseMatch(['COS SALAD'], 'vgt')).toBe(false)
  })

  test('scores rank an exact fold above a prefix above a substring above a word match', () => {
    expect(looseScore(['SIAMFOOD'], 'siam food')).toBe(100)
    expect(looseScore(['SIAMFOOD LTD'], 'siam food')).toBe(80)
    expect(looseScore(['NEW SIAMFOOD'], 'siam food')).toBe(50)
    expect(looseScore(['RED OAK SALAD (ACK)'], 'ack salad')).toBe(30)
    expect(looseScore(['COS'], 'zzz')).toBe(0)
  })
})
