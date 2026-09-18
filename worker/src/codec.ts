/**
 * Plain values to Firestore REST `Value`s and back.
 *
 * Numbers follow what the web SDK does, so a document the Worker writes reads exactly like
 * one the app wrote: a whole number is an integer (the rules check `is int` on some
 * fields), anything else a double.
 */

export type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } }

export function encode(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } }
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } }
  throw new Error(`cannot encode ${typeof v}`)
}

export function encodeFields(o: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = encode(v)
  return out
}

export function decode(v: FsValue): unknown {
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('stringValue' in v) return v.stringValue
  if ('timestampValue' in v) return Date.parse(v.timestampValue)
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode)
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {})
  return null
}

export function decodeFields(f: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) out[k] = decode(v)
  return out
}
