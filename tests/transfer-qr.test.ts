// A transfer's Master QR (Automation Plan Phase 2, 25 Sep 2026): the code is the receiving
// page's own address; a reader that hands back only "TR-00012" is understood too.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { readTransferCode, transferReceiveUrl } from '../src/lib/transferQr'

describe('transfer QR', () => {
  test('the code is the receiving page, and reads back to the same transfer', () => {
    const url = transferReceiveUrl('https://pzmstock.pages.dev/', 'MUGNT8ZVGNUFV4JY')
    expect(url).toBe('https://pzmstock.pages.dev/transfers/MUGNT8ZVGNUFV4JY/receive')
    expect(readTransferCode(url)).toEqual({ id: 'MUGNT8ZVGNUFV4JY' })
    expect(readTransferCode('https://demo.pzmstock.pages.dev/transfers/abc?x=1')).toEqual({ id: 'abc' })
  })

  test('a typed or plain-text number is looked up by its TR- number', () => {
    expect(readTransferCode(' tr-12 ')).toEqual({ docNo: 'TR-00012' })
    expect(readTransferCode('TR00005')).toEqual({ docNo: 'TR-00005' })
  })

  test('anything else — a product barcode, the list pages — is not a transfer', () => {
    expect(readTransferCode('8850999320014')).toBeNull()
    expect(readTransferCode('https://pzmstock.pages.dev/transfers/today')).toBeNull()
    expect(readTransferCode('')).toBeNull()
  })
})
