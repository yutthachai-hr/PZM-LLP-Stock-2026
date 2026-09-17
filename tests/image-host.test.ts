// The picture host (functions/*, Cloudflare KV) and the headers file are not run here —
// they run on Cloudflare — but the pieces the app relies on are pinned so that a change
// to one side is a failing test until the other follows.
//
//   npm test

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('the Cloudflare configuration agrees with the app', () => {
  test('the headers file reaches dist/ and the CSP admits everything LINE needs', () => {
    const headers = read('public/_headers')
    const csp = headers.match(/Content-Security-Policy: (.*)/)![1]
    // The LIFF SDK loads its client-features script and wording from these two hosts; the
    // picker is opened on liff.line.me / access.line.me; api.line.me answers the SDK.
    for (const host of [
      'https://static.line-scdn.net',
      'https://liffsdk.line-scdn.net',
      'https://api.line.me',
      'https://liff.line.me',
      'https://access.line.me',
    ]) {
      expect(csp).toContain(host)
    }
    expect(csp).toContain("frame-ancestors 'none'")
    // A cached service worker would keep showing the previous build after a deploy.
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: public, max-age=0, must-revalidate/)
  })

  test('the image host pins the Firebase project and the limits the app assumes', () => {
    const cf = read('functions/_poImage.ts')
    expect(cf).toContain("PROJECT_ID = 'pzm-stock-x5'")
    expect(cf).toContain('MAX_BYTES = 1_500_000')
    expect(cf).toContain('TTL_SECONDS = 7 * 86_400')
  })

  test('the app posts to /api/po-image and LINE fetches /po/<token>.jpg', () => {
    expect(read('src/services/poImages.ts')).toContain("'/api/po-image'")
    expect(read('functions/po/[token].ts')).toContain('/^[0-9a-f]{32}$/')
  })

  test('the demo branch builds in demo mode from the Cloudflare branch name', () => {
    expect(read('vite.config.ts')).toContain("process.env.CF_PAGES_BRANCH === 'demo'")
  })
})
