import { beforeEach, expect, test } from 'vitest'
import { receiveExperimental, type ExperimentalReceiptInput } from '../src/services/experimentalReceipt'
import { createMemoryBackend, failWritesWhere, raw, resetMemory, seed } from './helpers/memory-backend'
import { setActiveBrand } from '../src/brand/brand'

const db = createMemoryBackend('rnd')
const now = 1_792_000_000_000
const parent = { id: 'parent', sku: 'CHS-02-08-001', name: 'CHEESE & BUTTER-(OTHER)', category: 'CHEESE & BUTTER', unitType: '', unit: '', active: true, createdAt: 1, updatedAt: 1 }
const line = (name = 'Anchor Cream Cheese', draftId = 'draft-a') => ({ draftId, parentId: 'parent', name, spec: '', qty: 5, unit: 'Pack', expectedBaseQty: 5 })
const input = (): ExperimentalReceiptInput => ({ brand: 'rnd', mode: 'manual', operationId: '11111111-1111-4111-8111-111111111111', supplierId: 'real-other', toLocationId: 'wh', date: now, docDate: now, invoiceNo: 'SYNTHETIC-R25', lines: [], experimental: [line()] })
const snapshot = () => Object.fromEntries(['products', 'stockLevels', 'stockMovements', 'counters', 'movementImages'].map(c => [c, raw('rnd__'+c)]).concat([['meta', raw('meta')]]))
beforeEach(() => {
  resetMemory(); setActiveBrand('rnd')
  seed('users', [{ id: 'admin', name: 'Synthetic admin', role: 'admin', active: true }])
  seed('rnd__suppliers', [{ id: 'real-other', name: 'OTHER', active: true }, { id: 'normal', name: 'Normal supplier', active: true }])
  seed('rnd__products', [parent])
  seed('rnd__locations', [{ id: 'wh', name: 'Synthetic warehouse', active: true }])
})

test('three kinds create three identities, balances and named movements, never placeholder stock', async () => {
  const p = input(); p.experimental = [line(), { ...line('Unsalted Butter','draft-b'), qty:2, expectedBaseQty:2 }, { ...line('Cream Cheese Trial B','draft-c'), qty:3, expectedBaseQty:3 }]
  const r = await receiveExperimental(db,p,'admin')
  expect(new Set(r.products.map(p=>p.productId)).size).toBe(3)
  expect(r.products.map(p=>p.sku)).toEqual(['RND-000001','RND-000002','RND-000003'])
  expect(raw('rnd__stockLevels').map(l=>l.qty)).toEqual([5,2,3])
  expect(raw('rnd__stockMovements').map(l=>l.productName)).toEqual(p.experimental.map(l=>l.name))
  expect(raw('rnd__stockMovements').every(l=>l.productId!=='parent')).toBe(true)
  expect(raw('rnd__products').slice(1).every(p=>(p.experimental as {status:string}).status==='pending')).toBe(true)
})
test('duplicate new identity is refused with no new records until explicit existing choice',async()=>{
  const r=await receiveExperimental(db,input(),'admin');const before=snapshot();const p=input();p.operationId='22222222-2222-4222-8222-222222222222'
  await expect(receiveExperimental(db,p,'admin')).rejects.toThrow(/existing|เดิม/)
  expect(snapshot()).toEqual(before)
  p.experimental[0].existingProductId=r.products[0].productId
  await receiveExperimental(db,p,'admin')
  expect(raw('rnd__products')).toHaveLength(2);expect(raw('rnd__stockLevels')[0].qty).toBe(10)
})
test('same name different spec creates separate identities without automatic merge',async()=>{
  const p=input();p.experimental=[{...line(),spec:'unsalted 200 g'},{...line('Anchor Cream Cheese','draft-b'),spec:'salted 300 g'}]
  const r=await receiveExperimental(db,p,'admin');expect(new Set(r.products.map(x=>x.productId)).size).toBe(2)
})
for(const [name,change] of [
 ['typed OTHER',(p:ExperimentalReceiptInput)=>{p.supplierId='__other'}],
 ['other supplier',(p:ExperimentalReceiptInput)=>{p.supplierId='normal'}],
 ['pizza',(p:ExperimentalReceiptInput)=>{p.brand='pizza'}],
 ['lelapin',(p:ExperimentalReceiptInput)=>{p.brand='lelapin'}],
 ['PO mode',(p:ExperimentalReceiptInput)=>{p.mode='po'}],
 ['missing unit',(p:ExperimentalReceiptInput)=>{p.experimental[0].unit=''}],
 ['invalid quantity',(p:ExperimentalReceiptInput)=>{p.experimental[0].qty=NaN}],
 ['bad parent',(p:ExperimentalReceiptInput)=>{p.experimental[0].parentId='absent'}],
] as const)test(name+' refuses the entire receipt',async()=>{const p=input();change(p);const before=snapshot();await expect(receiveExperimental(db,p,'admin')).rejects.toThrow();expect(snapshot()).toEqual(before)})
for(const role of ['staff','manager','unknown','inactive','revoked'])test('authority '+role+' is rechecked, not supplied by UI',async()=>{
 if(role!=='unknown')seed('users',[{id:role,name:'Synthetic',role:role==='staff'||role==='manager'?role:'admin',active:role!=='inactive'}])
 if(role==='revoked')seed('revokedUsers',[{id:role}])
 const before=snapshot();await expect(receiveExperimental(db,input(),role)).rejects.toThrow();expect(snapshot()).toEqual(before)
})
test('disabled or renamed OTHER master supplier is rejected at final confirmation',async()=>{
 seed('rnd__suppliers',[{id:'real-other',name:'Not OTHER',active:true}]);await expect(receiveExperimental(db,input(),'admin')).rejects.toThrow()
})
test('ordinary named product is not accepted as OTHER placeholder',async()=>{
 seed('rnd__products',[{...parent,name:'Ordinary cheese'}]);await expect(receiveExperimental(db,input(),'admin')).rejects.toThrow()
})
test('duplicate Confirm and parallel identical replay post exactly once',async()=>{
 const p=input();const [a,b]=await Promise.all([receiveExperimental(db,p,'admin'),receiveExperimental(db,p,'admin')]);expect(a).toEqual(b);expect(raw('rnd__stockMovements')).toHaveLength(1);expect(raw('rnd__stockLevels')[0].qty).toBe(5)
 await receiveExperimental(db,p,'admin');expect(raw('rnd__stockMovements')).toHaveLength(1)
 const changed={...p,invoiceNo:'CHANGED'};await expect(receiveExperimental(db,changed,'admin')).rejects.toThrow(/operation|รายการ/)
})
test('two devices proposing the same kind do not get duplicate SKU or implicit reuse',async()=>{
 const a=input(),b={...input(),operationId:'22222222-2222-4222-8222-222222222222'}
 const result=await Promise.allSettled([receiveExperimental(db,a,'admin'),receiveExperimental(db,b,'admin')])
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(raw('rnd__products')).toHaveLength(2);expect(raw('rnd__stockMovements')).toHaveLength(1)
})
test('any commit failure leaves no orphan products, claims, counters, photos or partial stock',async()=>{
 const before=snapshot();failWritesWhere(c=>c==='rnd__stockMovements')
 await expect(receiveExperimental(db,input(),'admin')).rejects.toThrow(/injected/);expect(snapshot()).toEqual(before)
})
test('bad second row aborts all, including a valid ordinary line',async()=>{
 const p=input();p.experimental.push({...line('Broken','draft-b'),unit:''});const before=snapshot();await expect(receiveExperimental(db,p,'admin')).rejects.toThrow();expect(snapshot()).toEqual(before)
})
test('corrupt counter or occupied product ID never overwrites existing stock identity',async()=>{
 seed('rnd__products',[{...parent,id:'rnd_other_000001',name:'Never overwrite'}]);await expect(receiveExperimental(db,input(),'admin')).rejects.toThrow();expect(raw('rnd__products').find(p=>p.id==='rnd_other_000001')?.name).toBe('Never overwrite')
})
test('unrepresentable quantity and stale reviewed conversion refuse',async()=>{
 const p=input();p.experimental[0].qty=0.0001;await expect(receiveExperimental(db,p,'admin')).rejects.toThrow()
 p.experimental[0]={...line(),expectedBaseQty:99};await expect(receiveExperimental(db,p,'admin')).rejects.toThrow()
})
