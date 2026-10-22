import { beforeEach, expect, test, vi } from 'vitest'
import { handleExperimentalRequest } from '../../functions/_lib/experimentalReceive'
import { experimentalRestStore } from '../../functions/_lib/experimentalStore'
import { onRequestPost } from '../../functions/api/rnd-experimental-receive'
import { encodeFields } from '../../worker/src/codec'
import { createMemoryBackend, raw, resetMemory, seed } from '../helpers/memory-backend'

const input=()=>({brand:'rnd',mode:'manual',operationId:'11111111-1111-4111-8111-111111111111',supplierId:'other',toLocationId:'wh',date:1000,docDate:1000,invoiceNo:'SYN',lines:[],experimental:[{draftId:'draft-a',parentId:'parent',name:'Synthetic cheese',spec:'',qty:5,unit:'Pack',expectedBaseQty:5}]})
const request=(value:unknown=input())=>new Request('https://example.test/api/rnd-experimental-receive',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(value)})
beforeEach(()=>{resetMemory();seed('users',[{id:'admin',name:'Synthetic',role:'admin',active:true}]);seed('rnd__suppliers',[{id:'other',name:'OTHER',active:true}]);seed('rnd__products',[{id:'parent',name:'CHEESE-(OTHER)',category:'CHEESE',active:true}]);seed('rnd__locations',[{id:'wh',active:true}])})
const deps=()=>({enabled:true,store:createMemoryBackend('rnd'),verifyUser:async()=> 'admin'})
test('disabled API and invalid identity do not call the database',async()=>{
 const tx=vi.fn();const d={enabled:false,store:{transaction:tx},verifyUser:vi.fn(async()=>null)}
 expect((await handleExperimentalRequest(request(),d)).status).toBe(503);expect(tx).not.toHaveBeenCalled();expect(d.verifyUser).not.toHaveBeenCalled()
 d.enabled=true;expect((await handleExperimentalRequest(request(),d)).status).toBe(401);expect(tx).not.toHaveBeenCalled()
})
test('whole HTTP receipt is atomic and same request replay posts once',async()=>{
 const a=await handleExperimentalRequest(request(),deps()),b=await handleExperimentalRequest(request(),deps())
 expect(a.status).toBe(200);expect(await a.json()).toEqual(await b.json());expect(raw('rnd__stockMovements')).toHaveLength(1)
})
test('unknown fields, typedOTHER, PO and cross-brand requests never write',async()=>{
 for(const p of [{...input(),role:'admin'},{...input(),supplierId:'__other'},{...input(),mode:'po'},{...input(),brand:'pizza'}])expect((await handleExperimentalRequest(request(p),deps())).status).toBe(422)
 expect(raw('rnd__stockMovements')).toEqual([])
})
test('role is fetched inside transaction rather than trusted from token/UI',async()=>{
 seed('users',[{id:'admin',name:'Changed role',role:'staff',active:true}]);expect((await handleExperimentalRequest(request(),deps())).status).toBe(403)
})
test('body limit checks actual bytes; no Content-Length trust',async()=>{
 const r=new Request('https://example.test',{method:'POST',body:'x'.repeat(2_000_001)});expect((await handleExperimentalRequest(r,deps())).status).toBe(413)
})
test('database error is unknown outcome, not a promise that nothing committed',async()=>{
 const d=deps();d.store={...d.store,transaction:async()=>{throw Error('network response lost')}}
 const r=await handleExperimentalRequest(request(),d);expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'unknown_outcome'})
})
test('real Pages entrypoint is off without explicit owner configuration',async()=>{
 const r=await onRequestPost({request:request(),env:{}} as Parameters<typeof onRequestPost>[0]);expect(r.status).toBe(503)
})

test('REST adapter commits written AND read-only preconditions atomically in rnd only',async()=>{
 const calls:{url:string;body:Record<string,unknown>}[]=[]
 const fetcher:typeof fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body));calls.push({url:String(url),body})
  if(String(url).endsWith(':batchGet'))return Response.json(body.documents.map((name:string)=>name.endsWith('/users/admin')?{found:{name,fields:encodeFields({active:true}),updateTime:'2026-01-01T00:00:00Z'}}:{missing:name}))
  return Response.json({writeResults:[]})
 }
 const s=experimentalRestStore('demo-r25',async()=> 'synthetic',fetcher)
 await s.transaction(async tx=>{await tx.get('users','admin');await tx.get('revokedUsers','admin');await tx.get('counters','receive');tx.set('counters','receive',{value:1})})
 const writes=calls.at(-1)!.body.writes as {update?:{name:string};verify?:string;currentDocument:Record<string,unknown>}[]
 expect(writes).toHaveLength(3)
 expect(writes.find(w=>w.update)?.update?.name).toContain('/rnd__counters/receive')
 expect(writes.find(w=>w.verify?.endsWith('/users/admin'))?.currentDocument).toEqual({updateTime:'2026-01-01T00:00:00Z'})
 expect(writes.find(w=>w.verify?.endsWith('/revokedUsers/admin'))?.currentDocument).toEqual({exists:false})
})
test('REST read-only replay does not send an empty commit',async()=>{
 const f=vi.fn<typeof fetch>(async(_url,init)=>Response.json(JSON.parse(String(init?.body)).documents.map((name:string)=>({missing:name}))));const s=experimentalRestStore('demo-r25',async()=> 'synthetic',f)
 await s.transaction(tx=>tx.get('users','admin'));expect(f).toHaveBeenCalledTimes(1)
})
test('REST adapter denies arbitrary collections, paths, updates and deletes',async()=>{
 const f=vi.fn<typeof fetch>();const s=experimentalRestStore('demo-r25',async()=> 'synthetic',f)
 await expect(s.transaction(tx=>tx.get('lelapin__products','p'))).rejects.toThrow(/not allowed/)
 await expect(s.transaction(tx=>tx.get('products','../bad'))).rejects.toThrow(/invalid/)
 await expect(s.transaction(async tx=>tx.set('users','admin',{role:'admin'}))).rejects.toThrow(/not allowed/)
 await expect(s.transaction(async tx=>tx.update('products','p',{}))).rejects.toThrow(/not allowed/)
 await expect(s.transaction(async tx=>tx.delete('products','p'))).rejects.toThrow(/not allowed/)
 expect(f).not.toHaveBeenCalled()
})
test('conflicting read-only authority is re-read before any retry can commit',async()=>{
 let attempts=0,reads=0
 const f:typeof fetch=async(url,init)=>{
  if(String(url).endsWith(':batchGet'))return Response.json(JSON.parse(String(init?.body)).documents.map((name:string)=>name.endsWith('/users/admin')?{found:{name,fields:encodeFields({active:++reads===1}),updateTime:String(reads)}}:{missing:name}))
  attempts++;return Response.json({error:{status:'ABORTED'}},{status:409})
 }
 const s=experimentalRestStore('demo-r25',async()=> 'synthetic',f)
 await expect(s.transaction(async tx=>{const u=await tx.get<{active:boolean}>('users','admin');if(!u?.active)throw Error('authority changed');await tx.get('counters','receive');tx.set('counters','receive',{value:1})})).rejects.toThrow('authority changed')
 expect(attempts).toBe(1)
})
