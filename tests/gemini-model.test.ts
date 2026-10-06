// Picking the document-reading model from the Gemini model list (6 Oct 2026): Google retired
// gemini-2.5-flash and every read failed; the function now picks the newest stable Flash.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { pickReaderModel } from '../functions/_lib/geminiModel'

const gen = (name: string, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods })

describe('pickReaderModel', () => {
  test('the newest stable Flash wins over older, preview, lite and specialised ones', () => {
    const models = [
      gen('gemini-2.5-flash'),
      gen('gemini-3.5-flash-lite'),
      gen('gemini-3.8-flash-preview-09-2026'),
      gen('gemini-3.5-flash'),
      gen('gemini-3.5-flash-image'),
      gen('gemini-3.5-pro'),
      gen('gemini-3.5-flash-tts'),
      gen('text-embedding-004', ['embedContent']),
    ]
    expect(pickReaderModel(models)).toBe('gemini-3.5-flash')
  })
  test('only Lite left: Lite; only previews left: the newest preview', () => {
    expect(pickReaderModel([gen('gemini-3.1-flash-lite'), gen('gemini-2.0-pro')])).toBe('gemini-3.1-flash-lite')
    expect(pickReaderModel([gen('gemini-3.8-flash-preview'), gen('gemini-3.6-flash-preview')])).toBe('gemini-3.8-flash-preview')
  })
  test('nothing that reads: null', () => {
    expect(pickReaderModel([gen('gemini-3.5-pro'), gen('gemini-3.5-flash', ['countTokens'])])).toBeNull()
    expect(pickReaderModel([])).toBeNull()
  })
})
