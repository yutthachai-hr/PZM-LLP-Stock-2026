import { backend, BACKEND_MODE } from '../backend'
import { trackWrite } from '../backend/pendingWrites'
import { authHeader } from './poImages'
import { receiveExperimental, ExperimentalReceiptError, type ExperimentalReceiptInput, type ExperimentalReceiptResult } from './experimentalReceipt'

/** Known refusal permits editing; an unknown outcome keeps the frozen operation for retry. */
export class ExperimentalClientError extends Error {
 code:string; unknownOutcome:boolean
 constructor(code:string,unknownOutcome:boolean){super(code);this.code=code;this.unknownOutcome=unknownOutcome}
}
export function submitExperimental(input:ExperimentalReceiptInput,uid:string):Promise<ExperimentalReceiptResult>{
 return trackWrite((async()=>{
  if(BACKEND_MODE!=='cloud'){
   try{return await receiveExperimental(backend.forBrand('rnd'),input,uid)}catch(e){if(e instanceof ExperimentalReceiptError)throw new ExperimentalClientError(e.code,e.code==='operation_conflict');throw e}
  }
  let response:Response
  try{response=await fetch('/api/rnd-experimental-receive',{method:'POST',headers:{...await authHeader(),'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)})}catch{throw new ExperimentalClientError('unknown_outcome',true)}
  const body=await response.json().catch(()=>null) as ExperimentalReceiptResult&{error?:string}|null
  if(!response.ok){const code=body?.error??'unknown_outcome';throw new ExperimentalClientError(code,code==='unknown_outcome'||code==='operation_conflict'||(![400,401,403,409,413,422].includes(response.status)&&code!=='not_configured'))}
  if(!body||typeof body.docNo!=='string'||!Array.isArray(body.products))throw new ExperimentalClientError('unknown_outcome',true)
  return body
 })())
}
