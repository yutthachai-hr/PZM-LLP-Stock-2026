/**
 * The Playwright tests' handle on the local Firebase emulators (project `demo-pzm-e2e`).
 *
 * Seeding and reading back go through the emulators' REST endpoints with the emulator-only
 * `Bearer owner` token, which skips the security rules — the test sets the stage and then
 * checks the outcome directly, while everything in between happens through the app as a
 * person would do it, under the real rules. Nothing here can reach a real project: the
 * hosts are 127.0.0.1 and the project id starts `demo-`.
 */

export const PROJECT = 'demo-pzm-e2e'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const AUTH = 'http://127.0.0.1:9099'
const OWNER = { Authorization: 'Bearer owner' }

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type FsValue = Record<string, unknown>

function encode(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)])) } }
}

function decode(v: FsValue): Json {
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return v.booleanValue as boolean
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue as number
  if ('stringValue' in v) return v.stringValue as string
  if ('timestampValue' in v) return v.timestampValue as string
  if ('arrayValue' in v) return (((v.arrayValue as { values?: FsValue[] }).values ?? []) as FsValue[]).map(decode)
  if ('mapValue' in v) return decodeFields(((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {}))
  return null
}

function decodeFields(fields: Record<string, FsValue>): { [k: string]: Json } {
  return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decode(x)]))
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`)
  return res
}

/** Empty both emulators: every document and every account. */
export async function resetEmulators(): Promise<void> {
  await ok(await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }), 'reset firestore')
  await ok(await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }), 'reset auth')
}

/** An Auth account; returns its uid. */
export async function createAccount(email: string, password: string): Promise<string> {
  const res = await ok(
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }),
    'create account',
  )
  return ((await res.json()) as { localId: string }).localId
}

/**
 * Write a document as the emulator owner (rules skipped). `path` is `collection/id`.
 * The app keeps each document's id inside it as well, and the rules read it — so it is
 * stamped here unless the caller says otherwise.
 */
export async function putDoc(path: string, data: Record<string, unknown>, opts: { stampId?: boolean } = {}): Promise<void> {
  const id = path.split('/').pop()!
  const fields = (encode(opts.stampId === false ? data : { id, ...data }).mapValue as { fields: Record<string, FsValue> }).fields
  await ok(await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }), `put ${path}`)
}

/** Delete a document as the emulator owner. */
export async function deleteDoc(path: string): Promise<void> {
  await ok(await fetch(`${FS}/${path}`, { method: 'DELETE', headers: OWNER }), `delete ${path}`)
}

/** Many documents at once (owner, rules skipped), 400 to a commit. Each doc's `id` is stamped in. */
export async function putMany(collection: string, docs: ({ id: string } & Record<string, unknown>)[]): Promise<void> {
  const root = `projects/${PROJECT}/databases/(default)/documents`
  for (let i = 0; i < docs.length; i += 400) {
    const writes = docs.slice(i, i + 400).map((d) => ({ update: { name: `${root}/${collection}/${d.id}`, fields: (encode(d).mapValue as { fields: Record<string, FsValue> }).fields } }))
    await ok(await fetch(`${FS}:commit`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) }), `commit ${collection}`)
  }
}

export async function getDoc(path: string): Promise<{ [k: string]: Json } | null> {
  const res = await fetch(`${FS}/${path}`, { headers: OWNER })
  if (res.status === 404) return null
  await ok(res, `get ${path}`)
  const body = (await res.json()) as { fields?: Record<string, FsValue> }
  return decodeFields(body.fields ?? {})
}

/** Every document in a collection, with its id. */
export async function listDocs(collection: string): Promise<({ id: string } & { [k: string]: Json })[]> {
  const out: ({ id: string } & { [k: string]: Json })[] = []
  let token = ''
  do {
    const res = await ok(await fetch(`${FS}/${collection}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: OWNER }), `list ${collection}`)
    const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, FsValue> }[]; nextPageToken?: string }
    for (const d of body.documents ?? []) out.push({ id: d.name.split('/').pop()!, ...decodeFields(d.fields ?? {}) })
    token = body.nextPageToken ?? ''
  } while (token)
  return out
}

/** Sign in through the Auth emulator; returns the ID token the rules will see. */
export async function signIn(email: string, password: string): Promise<{ token: string; uid: string }> {
  const res = await ok(
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }),
    'sign in',
  )
  const body = (await res.json()) as { idToken: string; localId: string }
  return { token: body.idToken, uid: body.localId }
}

/**
 * Write as a signed-in person, under the real security rules — what a modified client
 * holding that person's token could send. Returns the HTTP status (200 allowed, 403 denied).
 * `fields` limits the write to those top-level fields (an update); `create` refuses to
 * overwrite an existing document.
 */
export async function writeAs(token: string, path: string, data: Record<string, unknown>, opts: { fields?: string[]; create?: boolean } = {}): Promise<number> {
  const params = new URLSearchParams()
  for (const f of opts.fields ?? []) params.append('updateMask.fieldPaths', f)
  if (opts.create) params.append('currentDocument.exists', 'false')
  const fields = (encode(data).mapValue as { fields: Record<string, FsValue> }).fields
  const res = await fetch(`${FS}/${path}?${params}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  return res.status
}
