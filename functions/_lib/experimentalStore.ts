// Fixed-rnd, command-private atomic adapter. Does not widen supplier ServerStore.
import type { TxContext } from '../../src/backend/tx'
import { encodeFields, decodeFields, type FsValue } from '../../worker/src/codec'

const readable = new Set(['users','revokedUsers','meta','products','suppliers','locations','counters','stockLevels','stockMovements'])
const writable = new Set(['meta','products','counters','stockLevels','stockMovements','movementImages'])
const globals = new Set(['users','revokedUsers','meta'])
const safeId = (s:string) => /^[A-Za-z0-9_\-]{1,200}$/.test(s)
export function experimentalRestStore(projectId:string, token:()=>Promise<string>, fetcher:typeof fetch=fetch) {
 if(!/^[a-z0-9-]{4,40}$/.test(projectId))throw Error('invalid project')
 const root=`projects/${projectId}/databases/(default)/documents`,base=`https://firestore.googleapis.com/v1/${root}`
 const physical=(c:string)=>globals.has(c)?c:'rnd__'+c
 const doc=(c:string,id:string)=>{
  if(!safeId(id))throw Error('invalid document id')
  if(c==='meta'&&!/^rnd_(receipt|other_key)_[a-f0-9]{64}$/.test(id))throw Error('invalid private key')
  if(c==='counters'&&!['receive','otherSku'].includes(id))throw Error('invalid counter')
  return `${root}/${physical(c)}/${id}`
 }
 async function call(suffix:string,body:unknown){
  const r=await fetcher(base+suffix,{method:'POST',headers:{authorization:'Bearer '+await token(),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
  if(!r.ok){let status='';try{status=(await r.json() as {error?:{status?:string}}).error?.status??''}catch{};if([409,412].includes(r.status)||['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(status))throw new Error('R25_CONFLICT');throw new Error('R25_DATABASE_UNAVAILABLE')}
  return r.json()
 }
 return {async transaction<R>(run:(tx:TxContext)=>Promise<R>):Promise<R>{
  for(let attempt=0;attempt<3;attempt++){
   const reads=new Map<string,{doc:Record<string,unknown>|null;precondition:Record<string,unknown>}>(),writes=new Map<string,Record<string,unknown>>()
   let writing=false
   async function prefetch(documents:readonly {collection:string;id:string}[]){
    if(writing)throw Error('read after write')
    const pending=new Map<string,string>()
    for(const {collection,id}of documents){
     if(!readable.has(collection))throw Error('read not allowed')
     const name=doc(collection,id)
     if(!reads.has(name))pending.set(name,id)
    }
    if(!pending.size)return
    if(pending.size>200)throw Error('read budget exceeded')
    const rows=await call(':batchGet',{documents:[...pending.keys()]}) as {found?:{name:string;fields?:Record<string,FsValue>;updateTime:string};missing?:string}[]
    if(!Array.isArray(rows))throw Error('invalid read response')
    const resolved=new Map<string,{doc:Record<string,unknown>|null;precondition:Record<string,unknown>}>()
    for(const row of rows){
     const found=row?.found,name=found?.name??row?.missing
     if(!name||!pending.has(name)||resolved.has(name)||(found&&row.missing))throw Error('invalid read response')
     if(found&&(typeof found.updateTime!=='string'||!found.updateTime))throw Error('missing read precondition')
     resolved.set(name,{doc:found?{...decodeFields(found.fields??{}),id:pending.get(name)!}:null,precondition:found?{updateTime:found.updateTime}:{exists:false}})
    }
    if(resolved.size!==pending.size)throw Error('invalid read response')
    for(const [name,value]of resolved)reads.set(name,value)
   }
   const tx:TxContext={
    prefetch,
    async get<T>(c:string,id:string){
     await prefetch([{collection:c,id}])
     return reads.get(doc(c,id))!.doc as T|null
    },
    set(c,id,data){
     writing=true
     if(!writable.has(c))throw Error('write not allowed')
     if(c==='products'&&(!/^rnd_other_\d{6,}$/.test(id)||!(data.experimental as {status?:string})?.status))throw Error('product write not allowed')
     if(c==='stockMovements'&&(data.type!=='receive'||!/^rnd_receipt_[a-f0-9]{64}_\d+$/.test(id)))throw Error('movement write not allowed')
     const name=doc(c,id),prior=reads.get(name)
     if(!prior&&c!=='movementImages')throw Error('write requires prior read')
     // The engine's photo is a fresh receipt-number document, never overwrite one.
     writes.set(name,{update:{name,fields:encodeFields({...data,id})},currentDocument:prior?.precondition??{exists:false}})
    },
    update(){throw Error('update not allowed')},delete(){throw Error('delete not allowed')},
   }
   try{
    const result=await run(tx)
    if(!writes.size)return result // successful replay; no empty commit/read amplification
    const all=[...writes.values()]
    for(const [name,r]of reads)if(!writes.has(name))all.push({verify:name,currentDocument:r.precondition})
    if(all.length>500)throw Error('write budget exceeded')
    await call(':commit',{writes:all})
    return result
   }catch(e){if(e instanceof Error&&e.message==='R25_CONFLICT'&&attempt<2)continue;throw e}
  }
  throw Error('R25_CONFLICT')
 }}
}
