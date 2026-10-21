import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../../types'
import { EXPERIMENTAL_MAX_LINES, type ExperimentalLine } from '../../services/experimentalReceipt'
import { isOtherPlaceholder, otherTextKey } from '../../lib/otherItem'
import { entryFor } from '../../lib/uom'
import { requireQty } from '../../lib/validate'
import { fmtQty } from '../../lib/format'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { useEntryUnits } from '../../services/entryUnits'
import { Button, Field, Input, Modal, Select } from '../../components/ui'

export function ExperimentalRows({items}:{items:ExperimentalLine[]}){
 const t=useT()
 return <ul className="divide-y divide-line rounded-xl border border-line">{items.map(l=><li key={l.draftId} className="space-y-1 p-3"><div className="flex flex-wrap justify-between gap-2"><span className="break-words font-semibold">{l.name}</span><span className="num">{fmtQty(l.qty)} {l.unit}</span></div>{l.spec&&<div className="break-words text-sm text-ink-soft">{l.spec}</div>}<div className="break-all text-xs text-ink-soft">{t('รหัสร่าง {id} — รหัสจริงออกเมื่อยืนยัน',{id:l.draftId.slice(-8)})}</div>{l.note&&<div className="text-sm text-ink-soft">{l.note}</div>}</li>)}</ul>
}
export function ExperimentalItems({products,items,onChange,requestedParentId,onConsumedRequest}:{products:Product[];items:ExperimentalLine[];onChange:(items:ExperimentalLine[])=>void;requestedParentId:string|null;onConsumedRequest:()=>void}){
 const t=useT(),plainUnits=useEntryUnits()
 const parents=useMemo(()=>products.filter(isOtherPlaceholder),[products])
 const [parentId,setParentId]=useState(''),[open,setOpen]=useState(false),[name,setName]=useState(''),[spec,setSpec]=useState(''),[unit,setUnit]=useState(''),[qty,setQty]=useState(''),[note,setNote]=useState(''),[existing,setExisting]=useState<string|undefined>(),[error,setError]=useState('')
 const parent=parents.find(p=>p.id===parentId)??parents[0]
 function start(id?:string){setParentId(id??parent?.id??'');setName('');setSpec('');setUnit('');setQty('');setNote('');setExisting(undefined);setError('');setOpen(true)}
 useEffect(()=>{if(requestedParentId){start(requestedParentId);onConsumedRequest()}},[requestedParentId]) // request is an explicit product-pick event
 const candidates=products.filter(p=>p.active!==false&&p.experimental?.parentId===parent?.id&&otherTextKey(p.name)===otherTextKey(name))
 const selected=products.find(p=>p.id===existing)
 const units=[...new Set(['EA','KG','L','Pack','Carton',...plainUnits,...(selected?[selected.unitType,...(selected.unitConversions??[]).map(c=>c.label)]:[])])].filter(Boolean)
 const duplicate=candidates.some(p=>otherTextKey(p.experimental?.spec??'')===otherTextKey(spec)&&otherTextKey(p.unitType)===otherTextKey(unit))
 function add(){
  if(!parent||!name.trim()||!unit.trim()){setError(t('ระบุชื่อและหน่วยสินค้าทดลอง'));return}
  if(duplicate&&!existing){setError(t('พบรายการเดิม — เลือกใช้รายการเดิมก่อน'));return}
  try{
   const n=requireQty(Number(qty),name),base=selected?entryFor(selected,n,unit).qty:n
   requireQty(base,name)
   if(items.some(l=>l.parentId===parent.id&&otherTextKey(l.name)===otherTextKey(name)&&otherTextKey(l.spec)===otherTextKey(spec)&&otherTextKey(l.unit)===otherTextKey(unit))){setError(t('มีสินค้าทดลองนี้ในร่างแล้ว — ลบรายการเดิมก่อนแก้'));return}
   onChange([...items,{draftId:'xp_'+crypto.randomUUID(),parentId:parent.id,name:name.trim(),spec:spec.trim(),unit:unit.trim(),qty:n,expectedBaseQty:base,...(existing?{existingProductId:existing}:{}),...(note.trim()?{note:note.trim()}:{})}]);setOpen(false)
  }catch(e){setError(errText(e,t))}
 }
 return <div className="mt-4 space-y-3 border-t border-line pt-4" data-testid="experimental-items">
  <div className="flex flex-wrap items-end gap-3"><Field label={t('หมวด OTHER')} className="min-w-0 flex-1"><Select aria-label={t('หมวด OTHER')} value={parent?.id??''} onChange={e=>setParentId(e.target.value)}>{parents.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</Select></Field><Button variant="secondary" disabled={!parent||items.length>=EXPERIMENTAL_MAX_LINES} onClick={()=>start()}>{t('+ เพิ่มสินค้าทดลอง')}</Button></div>
  <p className="text-xs text-ink-soft">{t('สินค้าทดลองแยกยอดจากหมวดเดิม — ยังไม่บันทึกจนกดยืนยันรับเข้าคลัง')}</p>
  {items.length>0&&<><ExperimentalRows items={items}/><div className="flex flex-wrap gap-2">{items.map(l=><Button key={l.draftId} variant="secondary" onClick={()=>onChange(items.filter(x=>x.draftId!==l.draftId))} aria-label={t('ลบสินค้าทดลอง {name}',{name:l.name})}>{t('ลบสินค้าทดลอง {name}',{name:l.name})}</Button>)}</div></>}
  {open&&parent&&<Modal open title={t('เพิ่มสินค้าทดลอง')} onClose={()=>setOpen(false)} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setOpen(false)}>{t('ยกเลิก')}</Button><Button onClick={add}>{t('เพิ่มในร่างใบรับ')}</Button></div>}>
   <div className="space-y-4"><Field label={t('หมวดหลัก')}><Input aria-label={t('หมวดหลัก')} value={parent.name} disabled/></Field>
    <Field label={t('ชื่อสินค้าทดลอง')} required><Input aria-label={t('ชื่อสินค้าทดลอง')} autoFocus value={name} onChange={e=>{setName(e.target.value);setExisting(undefined)}}/></Field>
    <Field label={t('รายละเอียด / สเปก')}><Input aria-label={t('รายละเอียด / สเปก')} value={spec} onChange={e=>{setSpec(e.target.value);setExisting(undefined)}}/></Field>
    {candidates.length>0&&<div className="space-y-2 rounded-lg bg-sunken p-3"><div className="text-sm font-semibold">{t('รายการที่มีอยู่แล้ว — เลือกเอง ไม่รวมอัตโนมัติ')}</div>{candidates.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{p.sku} · {p.experimental?.spec||t('ไม่ระบุสเปก')} · {p.unitType}</span><Button variant="secondary" onClick={()=>{setExisting(p.id);setName(p.name);setSpec(p.experimental?.spec??'');setUnit(p.unitType)}}>{existing===p.id?t('เลือกแล้ว'):t('ใช้รายการนี้')}</Button></div>)}</div>}
    <div className="grid grid-cols-2 gap-3"><Field label={t('จำนวน')} required><Input aria-label={t('จำนวนสินค้าทดลอง')} type="number" inputMode="decimal" min="0.001" step="0.001" value={qty} onChange={e=>setQty(e.target.value)}/></Field><Field label={t('หน่วย')} required><Select aria-label={t('หน่วยสินค้าทดลอง')} value={unit} onChange={e=>setUnit(e.target.value)}><option value="">{t('— เลือกหน่วย —')}</option>{units.map(u=><option key={u} value={u}>{u}</option>)}</Select></Field></div>
    <Field label={t('หมายเหตุ')}><Input aria-label={t('หมายเหตุสินค้าทดลอง')} value={note} onChange={e=>setNote(e.target.value)}/></Field>
    <p className="text-xs text-ink-soft">{t('ต้นทุนและรูปสินค้าแก้ได้ภายหลังที่หน้าสินค้า — ใบรับนี้ไม่สร้างระบบราคาใหม่')}</p>
    {error&&<div role="alert" className="text-sm text-danger">{error}</div>}
   </div>
  </Modal>}
 </div>
}
