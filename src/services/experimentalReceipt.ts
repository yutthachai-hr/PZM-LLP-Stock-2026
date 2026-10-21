import type { Transactional } from '../backend/tx'
import { planReceive, type MovementLine } from './receivePlan'
import { COL, type AppUser, type Product, type Supplier, type StockMovement } from '../types'
import { isKnownOtherSupplier, isOtherPlaceholder, makeOtherSku, otherHash, otherIdentity, otherTextKey } from '../lib/otherItem'
import { entryFor } from '../lib/uom'
import { sameUnit } from '../lib/units'
import { requireEpochMs, requireQty } from '../lib/validate'

export interface ExperimentalLine {
  draftId: string
  parentId: string
  name: string
  spec: string
  qty: number
  unit: string
  expectedBaseQty: number
  existingProductId?: string
  note?: string
}
export interface ExperimentalReceiptInput {
  brand: string
  mode: string
  operationId: string
  supplierId: string
  toLocationId: string
  date: number
  docDate: number
  invoiceNo: string
  note?: string
  photoDataUrl?: string
  lines: MovementLine[]
  experimental: ExperimentalLine[]
}
export interface ExperimentalReceiptResult {
  docNo: string
  products: { draftId: string; productId: string; sku: string; name: string; unit: string }[]
}
/** Lines one trusted request can read within a Pages invocation's subrequest budget. */
export const EXPERIMENTAL_MAX_LINES = 6

export class ExperimentalReceiptError extends Error {
  code: string
  constructor(code: string, message = code) { super(message); this.name = 'ExperimentalReceiptError'; this.code = code }
}
const refuse = (code: string, message = code): never => { throw new ExperimentalReceiptError(code, message) }
const idOk = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(s)
const textOk = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max

/** Validate the trust boundary even when the caller bypasses the React form. */
export function validateExperimentalInput(raw: unknown): ExperimentalReceiptInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('invalid')
  const p = raw as ExperimentalReceiptInput
  const allowed = ['brand','mode','operationId','supplierId','toLocationId','date','docDate','invoiceNo','note','photoDataUrl','lines','experimental']
  if (Object.keys(p).some(k=>!allowed.includes(k))) return refuse('invalid')
  if (p.brand !== 'rnd' || p.mode !== 'manual') return refuse('ineligible')
  if (!idOk(p.supplierId) || p.supplierId === '__other' || !idOk(p.toLocationId)) return refuse('ineligible')
  if (typeof p.operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.operationId)) return refuse('invalid')
  if (!textOk(p.invoiceNo,100) || !p.invoiceNo.trim() || (p.note !== undefined && !textOk(p.note,2000))) return refuse('invalid')
  requireEpochMs(p.date); requireEpochMs(p.docDate)
  if (!Array.isArray(p.lines) || !Array.isArray(p.experimental) || p.experimental.length<1) return refuse('invalid')
  // shortcut: each tx.get is one REST subrequest (~8 + 5 per line); 6 lines stays under Pages' 50. Lift after batched reads.
  if (p.lines.length+p.experimental.length>EXPERIMENTAL_MAX_LINES) return refuse('too_large')
  if (p.photoDataUrl !== undefined && (!textOk(p.photoDataUrl,1_000_000) || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photoDataUrl))) return refuse('invalid')
  const drafts = new Set<string>()
  for (const l of p.experimental) {
    if (!l || Object.keys(l).some(k=>!['draftId','parentId','name','spec','qty','unit','expectedBaseQty','existingProductId','note'].includes(k))) return refuse('invalid')
    if (!idOk(l.draftId) || drafts.has(l.draftId) || !idOk(l.parentId) || (l.existingProductId !== undefined && !idOk(l.existingProductId))) return refuse('invalid')
    drafts.add(l.draftId)
    if (!textOk(l.name,300) || otherTextKey(l.name).length<2 || !textOk(l.spec,300) || !textOk(l.unit,20) || !l.unit.trim() || (l.note !== undefined && !textOk(l.note,2000))) return refuse('invalid')
    requireQty(l.qty,l.name); requireQty(l.expectedBaseQty,l.name)
  }
  for (const l of p.lines) {
    if (!l || Object.keys(l).some(k=>!['productId','productName','unit','qty','entryUnit','entryQty','note'].includes(k)) || !idOk(l.productId) || !textOk(l.unit,60) || !l.unit.trim() || !textOk(l.productName,300) || (l.note !== undefined && !textOk(l.note,2000)) || (l.entryUnit !== undefined && (!textOk(l.entryUnit,60)||!l.entryUnit.trim()))) return refuse('invalid')
    requireQty(l.qty,l.productName); if (l.entryQty !== undefined) requireQty(l.entryQty,l.productName)
  }
  // Detach caller state: a brand/supplier/form edit while hashing cannot mutate this request.
  return JSON.parse(JSON.stringify(p)) as ExperimentalReceiptInput
}

export async function receiveExperimental(db: Transactional, raw: ExperimentalReceiptInput, uid: string): Promise<ExperimentalReceiptResult> {
  const input = validateExperimentalInput(raw)
  if (!idOk(uid)) return refuse('forbidden')
  // The photo is an attachment the draft never keeps, so a replay after a reload must not depend on it.
  const fingerprint = await otherHash(JSON.stringify({ ...input, photoDataUrl: undefined }))
  const opKey = 'rnd_receipt_'+await otherHash(uid+'|'+input.operationId)
  const keys = await Promise.all(input.experimental.map(l=>otherHash(otherIdentity(input.supplierId,l.parentId,l.name,l.spec,l.unit))))
  return db.transaction(async tx => {
    const user = await tx.get<AppUser>(COL.users,uid)
    const revoked = await tx.get(COL.revokedUsers,uid)
    // Main catalogue authority is admin-only. Do not import PR1's broader proposal roles.
    if (!user?.active || user.role !== 'admin' || revoked) return refuse('forbidden')
    const prior = await tx.get<{ fingerprint: string; result: ExperimentalReceiptResult }>(COL.meta,opKey)
    if (prior) {
      if (prior.fingerprint !== fingerprint) return refuse('operation_conflict','operation payload changed')
      return prior.result
    }
    const supplier = await tx.get<Supplier>(COL.suppliers,input.supplierId)
    if (!isKnownOtherSupplier(supplier)) return refuse('ineligible')
    const counter = await tx.get<{value:number}>(COL.counters,'otherSku')
    let seq = counter?.value ?? 0
    if (!Number.isSafeInteger(seq) || seq<0 || seq>=999_999_999) return refuse('collision')
    const planned = new Map<string,Product>(), products: ExperimentalReceiptResult['products'] = [], claims: {id:string;productId:string;sku:string}[] = [], stock: MovementLine[] = []
    const seen = new Set<string>()
    for (let i=0;i<input.experimental.length;i++) {
      const l=input.experimental[i]
      const parent=await tx.get<Product>(COL.products,l.parentId)
      if (!parent || !isOtherPlaceholder(parent)) return refuse('ineligible')
      const claimId='rnd_other_key_'+keys[i]
      const claim=await tx.get<{productId:string;sku:string}>(COL.meta,claimId)
      let p: Product
      if (l.existingProductId) {
        const existing=await tx.get<Product>(COL.products,l.existingProductId)
        if (!existing || existing.active===false || existing.experimental?.parentId!==parent.id || existing.supplierId!==supplier!.id || otherTextKey(existing.name)!==otherTextKey(l.name) || otherTextKey(existing.experimental.spec)!==otherTextKey(l.spec) || existing.category!==parent.category) return refuse('stale')
        p=existing
      } else {
        if (claim) return refuse('existing','existing experimental item: '+claim.productId)
        seq++
        const id='rnd_other_'+String(seq).padStart(6,'0')
        if (await tx.get(COL.products,id)) return refuse('collision')
        const now=Date.now()
        p={id,sku:makeOtherSku(seq),name:l.name.trim(),category:parent.category,unit:l.unit.trim(),unitType:l.unit.trim(),supplierId:supplier!.id,minStock:0,hasImage:false,active:true,createdAt:now,updatedAt:now,experimental:{parentId:parent.id,spec:l.spec.trim(),status:'pending',createdBy:uid,createdByName:user.name}}
        planned.set(id,p);claims.push({id:claimId,productId:id,sku:p.sku})
      }
      if (seen.has(p.id) || (claims.filter(c=>c.id===claimId).length>1)) return refuse('existing','existing item already on this receipt')
      seen.add(p.id)
      if (!p.unitType.trim()) return refuse('invalid')
      const e=entryFor(p,requireQty(l.qty,l.name),l.unit)
      const qty=requireQty(e.qty,l.name)
      if (qty!==l.expectedBaseQty) return refuse('stale')
      stock.push({productId:p.id,productName:p.name,unit:p.unitType,qty,...(e.entryUnit?{entryUnit:e.entryUnit,entryQty:e.entryQty}:{}),...(l.note?{note:l.note}:{})})
      products.push({draftId:l.draftId,productId:p.id,sku:p.sku,name:p.name,unit:p.unitType})
    }
    for (const l of input.lines) {
      const p=await tx.get<Product>(COL.products,l.productId)
      if (!p || p.active===false || isOtherPlaceholder(p) || !p.unitType.trim() || !sameUnit(p.unitType,l.unit) || seen.has(p.id)) return refuse('invalid')
      const e=entryFor(p,l.entryQty??l.qty,l.entryUnit??l.unit)
      if (requireQty(e.qty,p.name)!==l.qty) return refuse('stale')
      seen.add(p.id);stock.push({...l,productName:p.name})
    }
    // The regular stock engine owns every balance and movement calculation.
    let index=0
    const file=(mv:Omit<StockMovement,'id'>)=>tx.set(COL.movements,opKey+'_'+index++,mv as Record<string,unknown>)
    const plan=await planReceive(tx,{lines:stock,toLocationId:input.toLocationId,date:input.date,actor:{id:uid,name:user.name},note:input.note,doc:{supplierId:supplier!.id,supplierName:supplier!.name,invoiceNo:input.invoiceNo,docDate:input.docDate},photoDataUrl:input.photoDataUrl},file,planned)
    for (let i=0;i<plan.lines.length;i++) if (await tx.get(COL.movements,opKey+'_'+i)) return refuse('operation_conflict','operation receipt missing for existing movement')
    const receiptCounter=await tx.get<{value:number}>(COL.counters,'receive')
    if (receiptCounter && (!Number.isSafeInteger(receiptCounter.value)||receiptCounter.value<0||receiptCounter.value>=999_999_999)) return refuse('collision')
    // No writes above this line. Buffered writes and operation receipt commit as one unit.
    for (const p of planned.values()) tx.set(COL.products,p.id,p as unknown as Record<string,unknown>)
    for (const c of claims) tx.set(COL.meta,c.id,{productId:c.productId,sku:c.sku,by:uid,createdAt:Date.now()})
    if (claims.length) tx.set(COL.counters,'otherSku',{value:seq})
    const result={docNo:plan.commit(),products}
    tx.set(COL.meta,opKey,{fingerprint,result,by:uid,createdAt:Date.now()})
    return result
  })
}
