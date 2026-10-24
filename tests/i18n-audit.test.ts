import { expect, test } from 'vitest'
import { dictionaryProblems, translationCalls } from '../scripts/i18n-audit.mjs'

test('dictionary audit checks variables, empty translations and Thai leakage; baht is not leakage', () => {
  expect(dictionaryProblems({ 'มี {n}': 'Has {n}', '฿ {n}': '฿ {n}' })).toEqual([])
  expect(dictionaryProblems({ 'มี {n}': 'Has', 'ข้อความ': '', 'ชื่อ': 'ชื่อ' })).toHaveLength(3)
  expect(dictionaryProblems({ 'เลือก {name}': 'Choose {other}' })[0]).toContain('Placeholder mismatch')
})

test('translation audit handles quoted, escaped and static-template keys but not comments', () => {
  const { keys, problems } = translationCalls("// t('ไม่มีจริง')\nt('ชื่อ'); t(`จำนวน`); t('เลือก \\\'ของ\\\''); new AppError('ไม่พบ'); t(label)")
  expect([...keys]).toEqual(['ชื่อ', 'จำนวน', "เลือก 'ของ'", 'ไม่พบ'])
  expect(problems).toEqual([])
})

test('dynamic Thai template keys fail closed; stored data through a variable is not reclassified as UI', () => {
  expect(translationCalls('t(`มี ${n} รายการ`)').problems).toHaveLength(1)
  expect(translationCalls('t(product.name)').problems).toEqual([])
})
