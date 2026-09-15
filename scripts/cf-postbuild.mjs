// After `vite build` on Cloudflare Pages: put the headers file where Pages reads it.
//
//   CF_PAGES=1 node scripts/cf-postbuild.mjs
//
// Cloudflare sets CF_PAGES=1 in its build environment; anywhere else this is a no-op, so
// a Netlify build never ends up with a second copy of the security headers.

import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.env.CF_PAGES !== '1') {
  console.log('cf-postbuild: not a Cloudflare Pages build, nothing to do')
  process.exit(0)
}
const src = fileURLToPath(new URL('../cloudflare/_headers', import.meta.url))
const dst = fileURLToPath(new URL('../dist/_headers', import.meta.url))
if (!existsSync(src)) throw new Error('cloudflare/_headers is missing')
copyFileSync(src, dst)
console.log('cf-postbuild: wrote dist/_headers')
