// The two image hosts (Netlify Blobs today, Cloudflare KV when the site moves) and the
// two header files must say the same thing. Nothing runs them here — they run on their
// platforms — but the pieces the app relies on are pinned so a change to one is a failing
// test until the other follows.
//
//   npm test

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('the Cloudflare and Netlify configurations agree', () => {
  test('the Content-Security-Policy is the same on both hosts', () => {
    const netlify = read('netlify.toml').match(/Content-Security-Policy = '''([\s\S]*?)'''/)![1].trim()
    const cf = read('cloudflare/_headers').match(/Content-Security-Policy: (.*)/)![1].trim()
    expect(cf).toBe(netlify)
  })

  test('both image hosts pin the same Firebase project and the same limits', () => {
    const netlify = read('netlify/functions/po-image.mts')
    const cf = read('functions/_poImage.ts')
    for (const src of [netlify, cf]) {
      expect(src).toContain("PROJECT_ID = 'pzm-stock-x5'")
      expect(src).toContain('MAX_BYTES = 1_500_000')
    }
    expect(netlify).toContain('TTL_DAYS = 7')
    expect(cf).toContain('TTL_SECONDS = 7 * 86_400')
  })

  test('the GET route for a hosted picture is /po/<token>.jpg on both', () => {
    expect(read('netlify/functions/po-image.mts')).toContain("'/po/:token'")
    expect(read('functions/po/[token].ts')).toContain('/^[0-9a-f]{32}$/')
    expect(read('src/services/poImages.ts')).toContain('/.netlify/functions/po-image')
  })
})
