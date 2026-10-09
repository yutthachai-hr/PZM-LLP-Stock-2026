// Plan D1': the first paint's JavaScript stays within budget. Run after `npm run build`.
//
//   npm run check:bundle
//
// main-*.js under 900 KB (the plan's gate), and everything index.html loads up front under
// 2 MB — so a page pulled back into the entry by an eager import shows up here, not on a
// phone in a basement.
import { readFileSync, statSync } from 'node:fs'

const html = readFileSync('dist/index.html', 'utf8')
const files = [...new Set(html.match(/assets\/[^"]+\.js/g) ?? [])]
const size = (f) => statSync(`dist/${f}`).size
const main = files.find((f) => /assets\/main-/.test(f))
const total = files.reduce((n, f) => n + size(f), 0)
const kb = (n) => `${Math.round(n / 1024)} KB`
const fails = []
if (!main) fails.push('no main-*.js in dist/index.html')
else if (size(main) > 900 * 1024) fails.push(`main ${kb(size(main))} > 900 KB`)
if (total > 2 * 1024 * 1024) fails.push(`initial JS ${kb(total)} > 2048 KB`)
console.log(`main ${main ? kb(size(main)) : '?'} · initial JS ${kb(total)} in ${files.length} files`)
if (fails.length) {
  console.error(`✗ ${fails.join('; ')}`)
  process.exit(1)
}
console.log('✓ within budget')
