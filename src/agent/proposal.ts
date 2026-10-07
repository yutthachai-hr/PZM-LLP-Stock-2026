/**
 * G11 — the ActionProposal contract (owner, 7 Oct 2026: "AI can reason and recommend, but
 * deterministic business rules and database integrity remain the source of truth").
 *
 * Every action anything other than a person at a screen wants taken becomes THIS data
 * first. Nothing here, or anywhere under src/agent, writes: no backend, service or Firebase
 * import is allowed (tests/agent-no-write-path.test.ts). A proposal is checked by the
 * deterministic Business Guard (guard.ts); executing one is Phase H and not built.
 *
 * Free text from documents, OCR, suppliers or models lives only in `untrusted[]`. It is
 * carried so a person can see it — it is never read by the guard, never parsed for
 * instructions, and stripping it must not change any decision (the G16 invariance tests).
 */

export const PROPOSAL_SCHEMA = 'action-proposal/1' as const

/** What may be proposed in Phase G. All are drafts or messages — no stock moves. */
export const ACTION_TYPES = ['CREATE_PR_DRAFT', 'CREATE_TRANSFER_DRAFT', 'PROPOSE_PO_DATE_CHANGE', 'CONTACT_SUPPLIER', 'RECOMMEND_PURCHASE'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** Recognised so the refusal can name them, and refused always (G.ACTION.FORBIDDEN). */
export const FORBIDDEN_ACTIONS = ['POST_STOCK', 'ADJUST_STOCK', 'AUTO_APPROVE', 'AUTO_RECEIVE', 'AUTO_SEND_PO'] as const
export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number]

export type ProposerKind = 'human' | 'engine' | 'model'
export type UntrustedSource = 'ocr' | 'supplier' | 'user' | 'model' | 'document'
export type Role = 'admin' | 'manager' | 'staff'

export interface DraftLine {
  productId: string
  /** The name the proposer believed it was choosing — checked against the id (wrong record). */
  productName?: string
  qty: number
  /** Unit the qty is in; absent = the product's own unit. */
  unit?: string
  supplierId?: string
}

export type ActionParameters =
  | { kind: 'CREATE_PR_DRAFT'; locationId: string; lines: DraftLine[] }
  | { kind: 'CREATE_TRANSFER_DRAFT'; fromLocationId: string; toLocationId: string; lines: DraftLine[] }
  | { kind: 'PROPOSE_PO_DATE_CHANGE'; poId: string; newDate: number }
  | { kind: 'CONTACT_SUPPLIER'; supplierId: string; poId?: string; topic: 'followUp' | 'dateConfirm' | 'shortage' }
  | { kind: 'RECOMMEND_PURCHASE'; locationId: string; productId: string; productName?: string; supplierId?: string; qty: number; unit?: string }

export interface ActionProposal {
  schemaVersion: typeof PROPOSAL_SCHEMA
  proposalId: string
  /** One intent → at most one execution (idempotency key for Phase H). */
  operationIntentId: string
  /** On whose behalf. Re-checked against the users on file; never trusted as given. */
  actor: { id: string; role: Role; siteIds?: string[] }
  proposedBy: { kind: ProposerKind; engine?: string; provider?: string; model?: string; version: string }
  actionType: ActionType | ForbiddenAction
  /** Every id the parameters refer to — must match them exactly (G.ENTITY.CONSISTENT). */
  entityIds: string[]
  parameters: ActionParameters | { kind: ForbiddenAction }
  /** Why, as a code with figures — the same split as Phase G reasons. Not free text. */
  reason: { code: string; params?: Record<string, string | number> }
  /** What the proposal was computed from: references, never content. */
  evidence: { kind: string; ref: string; asOf: number }[]
  /** Quarantined free text. Data for a person to read; never instructions. */
  untrusted?: { source: UntrustedSource; text: string }[]
  /**
   * What the proposer could NOT resolve and refused to guess ("move some cheese to On Nut":
   * which cheese, how much). Any entry sends the proposal to a person (G.AMBIGUOUS.UNRESOLVED);
   * a line may then be missing. Guessing an id instead is what this field exists to prevent.
   */
  unresolved?: { field: string; candidates?: string[] }[]
  createdAt: number
  inputsAsOf: number
  integrity: { alg: 'fnv1a-64'; hash: string }
}

// ---------------------------------------------------------------- canonical form + hash ----

/** JSON with every object's keys sorted, recursively — the same bytes for the same content. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`
}

/** FNV-1a, 64-bit, hex. Detects a proposal changed after it was made — not authentication. */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(s)
  for (const b of bytes) {
    h ^= BigInt(b)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

export function proposalHash(p: Omit<ActionProposal, 'integrity'> | ActionProposal): string {
  const { integrity: _i, ...rest } = p as ActionProposal
  void _i
  return fnv1a64(canonicalJson(rest))
}

/** Seal a proposal: compute its integrity hash. */
export function seal(p: Omit<ActionProposal, 'integrity'>): ActionProposal {
  return { ...p, integrity: { alg: 'fnv1a-64', hash: proposalHash(p) } }
}

/** Every id the parameters name, in a stable order. */
export function referencedIds(params: ActionProposal['parameters']): string[] {
  const ids = new Set<string>()
  const add = (v: string | undefined) => v && ids.add(v)
  switch (params.kind) {
    case 'CREATE_PR_DRAFT':
      add(params.locationId)
      for (const l of params.lines) add(l.productId), add(l.supplierId)
      break
    case 'CREATE_TRANSFER_DRAFT':
      add(params.fromLocationId)
      add(params.toLocationId)
      for (const l of params.lines) add(l.productId)
      break
    case 'PROPOSE_PO_DATE_CHANGE':
      add(params.poId)
      break
    case 'CONTACT_SUPPLIER':
      add(params.supplierId)
      add(params.poId)
      break
    case 'RECOMMEND_PURCHASE':
      add(params.locationId)
      add(params.productId)
      add(params.supplierId)
      break
  }
  return [...ids].sort()
}

// ---------------------------------------------------------------- parsing ----

export type ParseResult = { ok: true; proposal: ActionProposal } | { ok: false; errors: string[] }

const ID = /^[A-Za-z0-9_-]{1,128}$/
const PID = /^[A-Za-z0-9_-]{8,64}$/
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const QTY_LIMIT = 1e9
const TEXT_MAX = 4_000
const MAX_LINES = 200

/** Any key, at any depth, that could reach an object's prototype. */
function hasBannedKey(v: unknown, depth = 0): boolean {
  if (depth > 12) return true
  if (!v || typeof v !== 'object') return false
  for (const k of Object.keys(v)) {
    if (BANNED_KEYS.has(k)) return true
    if (hasBannedKey((v as Record<string, unknown>)[k], depth + 1)) return true
  }
  return false
}

/**
 * Strict: unknown fields, wrong types, non-finite numbers, prototype keys and oversized
 * text are refused, not ignored. The raw input is NOT trusted to be from this module — a
 * proposal from a model arrives as JSON and is parsed here first.
 */
export function parseProposal(raw: unknown): ParseResult {
  const errors: string[] = []
  const err = (m: string) => void errors.push(m)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not an object'] }
  // Own keys only: JSON.parse makes a "__proto__" key an own property, which this catches.
  if (hasBannedKey(raw)) return { ok: false, errors: ['prototype key'] }
  const r = raw as Record<string, unknown>
  const allowed = ['schemaVersion', 'proposalId', 'operationIntentId', 'actor', 'proposedBy', 'actionType', 'entityIds', 'parameters', 'reason', 'evidence', 'untrusted', 'unresolved', 'createdAt', 'inputsAsOf', 'integrity']
  for (const k of Object.keys(r)) if (!allowed.includes(k)) err(`unknown field ${k}`)
  if (r.schemaVersion !== PROPOSAL_SCHEMA) err('schemaVersion')
  if (typeof r.proposalId !== 'string' || !PID.test(r.proposalId)) err('proposalId')
  if (typeof r.operationIntentId !== 'string' || !PID.test(r.operationIntentId)) err('operationIntentId')
  const epoch = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 4_102_444_800_000
  if (!epoch(r.createdAt)) err('createdAt')
  if (!epoch(r.inputsAsOf)) err('inputsAsOf')
  if (epoch(r.createdAt) && epoch(r.inputsAsOf) && (r.inputsAsOf as number) > (r.createdAt as number)) err('inputsAsOf after createdAt')

  const actor = r.actor as Record<string, unknown> | undefined
  if (!actor || typeof actor !== 'object') err('actor')
  else {
    for (const k of Object.keys(actor)) if (!['id', 'role', 'siteIds'].includes(k)) err(`actor.${k}`)
    if (typeof actor.id !== 'string' || !ID.test(actor.id)) err('actor.id')
    if (!['admin', 'manager', 'staff'].includes(actor.role as string)) err('actor.role')
    if (actor.siteIds !== undefined && (!Array.isArray(actor.siteIds) || actor.siteIds.length > 50 || !actor.siteIds.every((s) => typeof s === 'string' && ID.test(s)))) err('actor.siteIds')
  }
  const by = r.proposedBy as Record<string, unknown> | undefined
  if (!by || typeof by !== 'object') err('proposedBy')
  else {
    for (const k of Object.keys(by)) if (!['kind', 'engine', 'provider', 'model', 'version'].includes(k)) err(`proposedBy.${k}`)
    if (!['human', 'engine', 'model'].includes(by.kind as string)) err('proposedBy.kind')
    for (const k of ['engine', 'provider', 'model'] as const) if (by[k] !== undefined && (typeof by[k] !== 'string' || (by[k] as string).length > 80)) err(`proposedBy.${k}`)
    if (typeof by.version !== 'string' || by.version.length < 1 || by.version.length > 40) err('proposedBy.version')
    if (by.kind === 'model' && (typeof by.model !== 'string' || typeof by.provider !== 'string')) err('proposedBy.model/provider required for a model')
  }
  const type = r.actionType as string
  const known = (ACTION_TYPES as readonly string[]).includes(type) || (FORBIDDEN_ACTIONS as readonly string[]).includes(type)
  if (!known) err('actionType')

  const p = r.parameters as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object' || Array.isArray(p)) err('parameters')
  else if (p.kind !== type) err('parameters.kind must equal actionType')
  else errors.push(...checkParameters(p, Array.isArray(r.unresolved) && r.unresolved.length > 0))

  if (!Array.isArray(r.entityIds) || r.entityIds.length > 400 || !r.entityIds.every((s) => typeof s === 'string' && ID.test(s))) err('entityIds')
  const reason = r.reason as Record<string, unknown> | undefined
  if (!reason || typeof reason.code !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(reason.code)) err('reason.code')
  else {
    for (const k of Object.keys(reason)) if (!['code', 'params'].includes(k)) err(`reason.${k}`)
    if (reason.params !== undefined) {
      if (typeof reason.params !== 'object' || reason.params === null || Array.isArray(reason.params)) err('reason.params')
      else for (const [k, v] of Object.entries(reason.params)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)) err(`reason.params.${k}`)
        if (!((typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)))) err(`reason.params.${k}`)
      }
    }
  }
  if (!Array.isArray(r.evidence) || r.evidence.length > 100) err('evidence')
  else for (const e of r.evidence as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object' || typeof e.kind !== 'string' || typeof e.ref !== 'string' || e.ref.length > 200 || !epoch(e.asOf) || Object.keys(e).some((k) => !['kind', 'ref', 'asOf'].includes(k))) err('evidence[]')
  }
  if (r.untrusted !== undefined) {
    if (!Array.isArray(r.untrusted) || r.untrusted.length > 20) err('untrusted')
    else for (const u of r.untrusted as Record<string, unknown>[]) {
      if (!u || typeof u !== 'object' || !['ocr', 'supplier', 'user', 'model', 'document'].includes(u.source as string) || typeof u.text !== 'string' || u.text.length > TEXT_MAX || Object.keys(u).some((k) => !['source', 'text'].includes(k))) err('untrusted[]')
    }
  }
  const unresolved = r.unresolved
  if (unresolved !== undefined) {
    if (!Array.isArray(unresolved) || unresolved.length === 0 || unresolved.length > 20) err('unresolved')
    else for (const u of unresolved as Record<string, unknown>[]) {
      if (!u || typeof u !== 'object' || typeof u.field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.[\]]{0,59}$/.test(u.field) || Object.keys(u).some((k) => !['field', 'candidates'].includes(k))) err('unresolved[]')
      else if (u.candidates !== undefined && (!Array.isArray(u.candidates) || u.candidates.length > 20 || !u.candidates.every((c) => typeof c === 'string' && ID.test(c)))) err('unresolved[].candidates')
    }
  }
  const integ = r.integrity as Record<string, unknown> | undefined
  if (!integ || integ.alg !== 'fnv1a-64' || typeof integ.hash !== 'string' || !/^[0-9a-f]{16}$/.test(integ.hash)) err('integrity')
  if (errors.length) return { ok: false, errors }
  return { ok: true, proposal: raw as ActionProposal }
}

function checkLines(v: unknown, withSupplier: boolean, mayBeEmpty: boolean): string[] {
  const e: string[] = []
  if (!Array.isArray(v) || (v.length === 0 && !mayBeEmpty) || v.length > MAX_LINES) return ['parameters.lines']
  for (const l of v as Record<string, unknown>[]) {
    if (!l || typeof l !== 'object') { e.push('line'); continue }
    for (const k of Object.keys(l)) if (!['productId', 'productName', 'qty', 'unit', 'supplierId'].includes(k)) e.push(`line.${k}`)
    if (typeof l.productId !== 'string' || !ID.test(l.productId)) e.push('line.productId')
    if (l.productName !== undefined && (typeof l.productName !== 'string' || l.productName.length > 300)) e.push('line.productName')
    if (typeof l.qty !== 'number' || !Number.isFinite(l.qty) || Math.abs(l.qty) > QTY_LIMIT) e.push('line.qty')
    if (l.unit !== undefined && (typeof l.unit !== 'string' || l.unit.length > 40)) e.push('line.unit')
    if (withSupplier && (typeof l.supplierId !== 'string' || !ID.test(l.supplierId))) e.push('line.supplierId')
    if (!withSupplier && l.supplierId !== undefined) e.push('line.supplierId')
  }
  return e
}

function checkParameters(p: Record<string, unknown>, unresolved: boolean): string[] {
  const e: string[] = []
  const keys = (list: string[]) => Object.keys(p).filter((k) => !['kind', ...list].includes(k)).forEach((k) => e.push(`parameters.${k}`))
  const idOk = (v: unknown) => typeof v === 'string' && ID.test(v)
  switch (p.kind) {
    case 'CREATE_PR_DRAFT':
      keys(['locationId', 'lines'])
      if (!idOk(p.locationId)) e.push('parameters.locationId')
      e.push(...checkLines(p.lines, true, unresolved))
      break
    case 'CREATE_TRANSFER_DRAFT':
      keys(['fromLocationId', 'toLocationId', 'lines'])
      if (!idOk(p.fromLocationId)) e.push('parameters.fromLocationId')
      if (!idOk(p.toLocationId)) e.push('parameters.toLocationId')
      e.push(...checkLines(p.lines, false, unresolved))
      break
    case 'PROPOSE_PO_DATE_CHANGE':
      keys(['poId', 'newDate'])
      if (!idOk(p.poId)) e.push('parameters.poId')
      if (typeof p.newDate !== 'number' || !Number.isInteger(p.newDate) || p.newDate <= 0) e.push('parameters.newDate')
      break
    case 'CONTACT_SUPPLIER':
      keys(['supplierId', 'poId', 'topic'])
      if (!idOk(p.supplierId)) e.push('parameters.supplierId')
      if (p.poId !== undefined && !idOk(p.poId)) e.push('parameters.poId')
      if (!['followUp', 'dateConfirm', 'shortage'].includes(p.topic as string)) e.push('parameters.topic')
      break
    case 'RECOMMEND_PURCHASE':
      keys(['locationId', 'productId', 'productName', 'supplierId', 'qty', 'unit'])
      if (!idOk(p.locationId)) e.push('parameters.locationId')
      if (!idOk(p.productId)) e.push('parameters.productId')
      if (p.productName !== undefined && (typeof p.productName !== 'string' || p.productName.length > 300)) e.push('parameters.productName')
      if (p.supplierId !== undefined && !idOk(p.supplierId)) e.push('parameters.supplierId')
      if (typeof p.qty !== 'number' || !Number.isFinite(p.qty) || Math.abs(p.qty) > QTY_LIMIT) e.push('parameters.qty')
      if (p.unit !== undefined && (typeof p.unit !== 'string' || p.unit.length > 40)) e.push('parameters.unit')
      break
    default:
      // A forbidden action carries no parameters worth checking: it is refused by type.
      keys([])
  }
  return e
}
