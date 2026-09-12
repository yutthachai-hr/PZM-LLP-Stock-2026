// Reading the supplier out of a product name, against the names that are actually in there.
//
//   npm test
//
// Every case below is a real product from the catalogue, not an invented one. The rules only
// exist because the names do what they do, so a test written from imagination would be
// testing the wrong thing.

import { describe, expect, test } from 'vitest'
import {
  mergeKey,
  proposeMerges,
  renameInProductName,
  supplierFromName,
} from '../src/lib/supplierName'

describe('finding the supplier in a name', () => {
  test('the ordinary case: one bracket at the end', () => {
    expect(supplierFromName('BAKING SODA (MARKO)')).toBe('MARKO')
    expect(supplierFromName('BABY SPINACH (FOODGALLERY)')).toBe('FOODGALLERY')
  })

  test('text after the bracket does not hide it', () => {
    expect(supplierFromName('ANCHOVIES 720GR (OLIVA) NEW')).toBe('OLIVA')
  })

  test('with two brackets the supplier is the last one', () => {
    // All four two-bracket names in the catalogue are shaped this way.
    expect(supplierFromName('PRAMA HAM 18 MONTH(8KG/PC) (PREMIUM FOOD)')).toBe('PREMIUM FOOD')
    expect(supplierFromName('BOX PASTA PC-750 ML+COVER (25*12) (NEXTECH) 1 ลัง /300 ชิ้น')).toBe(
      'NEXTECH',
    )
    expect(supplierFromName('PLASTIC BAG 18*25 (0.5KG)แบบใส (MANEE UDOMSUK)')).toBe(
      'MANEE UDOMSUK',
    )
  })

  test('a bracket that is a pack size is not a supplier', () => {
    expect(supplierFromName('BAKERY BOX C9 MK (1*100)')).toBeNull()
    expect(supplierFromName('SOMETHING (25*12)')).toBeNull()
    expect(supplierFromName('SOMETHING (0.5KG)')).toBeNull()
    expect(supplierFromName('SOMETHING (8KG/PC)')).toBeNull()
  })

  test('a two-letter code is a supplier — most of the big ones are', () => {
    // KT alone accounts for 28 products, and the owner renames it to Klongtoei.
    expect(supplierFromName('DRIED CHILLI (KT)')).toBe('KT')
    expect(supplierFromName('SOMETHING (VL)')).toBe('VL')
  })

  test('a name with no bracket names no supplier', () => {
    expect(supplierFromName('GAS 48 KG')).toBeNull()
    expect(supplierFromName('WOOD')).toBeNull()
    expect(supplierFromName('Bread Roll/Soft Bread')).toBeNull()
  })

  test('an empty bracket is not a supplier', () => {
    expect(supplierFromName('SOMETHING ()')).toBeNull()
  })
})

describe('spellings that mean one supplier', () => {
  test('case, spaces and punctuation are noise', () => {
    expect(mergeKey('FOOD GALLERY')).toBe(mergeKey('FOODGALLERY'))
    expect(mergeKey('Zaino')).toBe(mergeKey('ZAINO'))
    expect(mergeKey('DEL CASARO')).toBe(mergeKey('DELCASARO'))
  })

  test('a transposed letter is proposed as the same supplier', () => {
    // The real pair: 22 products under MARKO and 16 under MAKRO.
    expect(proposeMerges(['MARKO', 'MAKRO'])).toEqual([['MARKO', 'MAKRO']])
  })

  test('three spellings of one name come back as one group', () => {
    const groups = proposeMerges(['SINO FACIFIC', 'SINO PACIFIC', 'SINO BACIFIC'])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  test('a missing space is proposed', () => {
    expect(proposeMerges(['FARANG FOOD', 'FARANGFOOD'])[0]).toHaveLength(2)
  })

  test('genuinely different suppliers are left alone', () => {
    expect(proposeMerges(['OLIVA', 'JAGOTA', 'VILLA', 'CENTRAL'])).toEqual([])
  })

  test('short codes are never merged into each other on a guess', () => {
    // KT, MK, FL, VL are four different companies that look alike to a ratio.
    expect(proposeMerges(['KT', 'MK', 'FL', 'VL', 'CP', 'BS', 'CT'])).toEqual([])
  })
})

describe('renaming a supplier inside the product names', () => {
  test('the bracket is rewritten, the rest of the name is not', () => {
    expect(renameInProductName('DRIED CHILLI (KT)', ['KT'], 'Klongtoei')).toBe(
      'DRIED CHILLI (Klongtoei)',
    )
  })

  test('text after the bracket survives', () => {
    expect(renameInProductName('ANCHOVIES 720GR (OLIVA) NEW', ['OLIVA'], 'Oliva Foods')).toBe(
      'ANCHOVIES 720GR (Oliva Foods) NEW',
    )
  })

  test('a pack size in the same name is never touched', () => {
    expect(
      renameInProductName(
        'BOX PASTA PC-750 ML+COVER (25*12) (NEXTECH) 1 ลัง /300 ชิ้น',
        ['NEXTECH'],
        'Nextech Co',
      ),
    ).toBe('BOX PASTA PC-750 ML+COVER (25*12) (Nextech Co) 1 ลัง /300 ชิ้น')
  })

  test('a product belonging to another supplier comes back untouched', () => {
    expect(renameInProductName('BAKING SODA (MARKO)', ['KT'], 'Klongtoei')).toBe(
      'BAKING SODA (MARKO)',
    )
  })

  test('a product with no supplier comes back untouched', () => {
    expect(renameInProductName('GAS 48 KG', ['KT'], 'Klongtoei')).toBe('GAS 48 KG')
  })

  test('every spelling merged into the supplier is renamed too', () => {
    // MAKRO was merged into MARKO, so products exist under both and a rename must reach both.
    const spellings = ['MARKO', 'MAKRO']
    expect(renameInProductName('SOMETHING (MAKRO)', spellings, 'Makro Cash & Carry')).toBe(
      'SOMETHING (Makro Cash & Carry)',
    )
    expect(renameInProductName('BAKING SODA (MARKO)', spellings, 'Makro Cash & Carry')).toBe(
      'BAKING SODA (Makro Cash & Carry)',
    )
  })

  test('a lookalike that was never merged in is left alone', () => {
    // Matching loosely here would rewrite somebody else's product, and there is no undo.
    expect(renameInProductName('SOMETHING (MAKRO)', ['MARKO'], 'Makro')).toBe(
      'SOMETHING (MAKRO)',
    )
  })
})
