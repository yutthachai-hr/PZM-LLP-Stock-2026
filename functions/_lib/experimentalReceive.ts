import { ExperimentalReceiptError, receiveExperimental } from '../../src/services/experimentalReceipt'
import { AppError } from '../../src/i18n/AppError'
import type { Transactional } from '../../src/backend/tx'

export interface ExperimentalDeps { enabled:boolean; store:Transactional; verifyUser:(header:string|null)=>Promise<string|null> }
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})
export async function handleExperimentalRequest(request:Request,deps:ExperimentalDeps):Promise<Response>{
 if(request.method!=='POST')return json({error:'method'},405)
 if(!deps.enabled)return json({error:'not_configured'},503)
 const uid=await deps.verifyUser(request.headers.get('authorization'))
 if(!uid)return json({error:'unauthorized'},401)
 // Bound the actual streamed bytes, not only the untrusted Content-Length header.
 const reader=request.body?.getReader();if(!reader)return json({error:'invalid'},400)
 const chunks:Uint8Array[]= [];let bytes=0
 try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>2_000_000){await reader.cancel();return json({error:'too_large'},413)}chunks.push(r.value)}}catch{return json({error:'invalid'},400)}
 const body=new Uint8Array(bytes);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length}
 let input:unknown;try{input=JSON.parse(new TextDecoder().decode(body))}catch{return json({error:'invalid'},400)}
 try{return json(await receiveExperimental(deps.store,input as Parameters<typeof receiveExperimental>[1],uid))}
 catch(e){
  if(e instanceof ExperimentalReceiptError)return json({error:e.code},e.code==='forbidden'?403:['existing','stale','operation_conflict','collision'].includes(e.code)?409:422)
  if(e instanceof AppError)return json({error:'invalid'},422)
  // A lost database response may already have committed. Never assert "nothing saved".
  return json({error:'unknown_outcome'},503)
 }
}
