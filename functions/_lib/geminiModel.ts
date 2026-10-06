/**
 * Which Gemini model reads documents (6 Oct 2026).
 *
 * The app named `gemini-2.5-flash` and Google retired it: the API answered 404 "model is no
 * longer available" and every bill read failed with 502. Google retires Flash models about
 * once a year, so instead of another hardcoded name the function asks the API which models
 * this key can use and picks the newest stable Flash that does generateContent — once per
 * worker isolate, and again whenever the chosen one starts answering 404.
 */

export interface ListedModel {
  name: string
  supportedGenerationMethods?: string[]
}

/** "models/gemini-3.5-flash" → [3, 5]; non-Gemini or unnumbered names → null. */
function version(id: string): number[] | null {
  const m = /^gemini-(\d+(?:\.\d+)*)-/.exec(id)
  return m ? m[1].split('.').map(Number) : null
}

const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}

/**
 * The best model for reading a document: a Flash (fast, cheap, multimodal) that supports
 * generateContent, newest version first; a stable name before a preview or experiment, the
 * full Flash before Lite. Nothing image-generation, speech, live or embedding.
 */
export function pickReaderModel(models: readonly ListedModel[]): string | null {
  const candidates = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => id.includes('flash') && version(id) !== null)
    .filter((id) => !/(image|tts|audio|live|embedding|thinking-exp|native)/.test(id))
  const rank = (id: string) => ({
    v: version(id)!,
    unstable: /(preview|exp|latest)/.test(id) ? 1 : 0,
    lite: id.includes('lite') ? 1 : 0,
  })
  candidates.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra.unstable - rb.unstable || cmp(rb.v, ra.v) || ra.lite - rb.lite || a.length - b.length
  })
  return candidates[0] ?? null
}
