// Plan D1': the first paint's JavaScript stays within budget. Run after `npm run build`.
//
//   npm run check:bundle
//
// main-*.js under 900 KB (the plan's gate), and everything index.html loads up front under
// 2 MB — so a page pulled back into the entry by an eager import shows up here, not on a
// phone in a basement.
//
// Budgets can be set per release line: BUNDLE_MAIN_KB / BUNDLE_TOTAL_KB. The early-release line
// on production `main` (9 Oct 2026) has no code splitting yet, so CI there holds a NO-REGRESSION
// budget at main's measured size (+~2%); the 900 / 2048 KB targets belong to the RC.
import { readFileSync, statSync } from 'node:fs'

const html = readFileSync('dist/index.html', 'utf8')
const files = [...new Set(html.match(/assets\/[^"]+\.js/g) ?? [])]
const size = (f) => statSync(`dist/${f}`).size
const main = files.find((f) => /assets\/main-/.test(f))
const total = files.reduce((n, f) => n + size(f), 0)
const kb = (n) => `${Math.round(n / 1024)} KB`
const fails = []
const MAIN_KB = Number(process.env.BUNDLE_MAIN_KB || 900)
const TOTAL_KB = Number(process.env.BUNDLE_TOTAL_KB || 2048)
if (!main) fails.push('no main-*.js in dist/index.html')
else if (size(main) > MAIN_KB * 1024) fails.push(`main ${kb(size(main))} > ${MAIN_KB} KB`)
if (total > TOTAL_KB * 1024) fails.push(`initial JS ${kb(total)} > ${TOTAL_KB} KB`)
console.log(`main ${main ? kb(size(main)) : '?'} · initial JS ${kb(total)} in ${files.length} files`)
if (fails.length) {
  console.error(`✗ ${fails.join('; ')}`)
  process.exit(1)
}
console.log('✓ within budget')
