import { validateExperimentalInput, type ExperimentalReceiptInput } from '../../services/experimentalReceipt'

type Store = Pick<Storage,'getItem'|'setItem'|'removeItem'>
const key=(uid:string)=>'pmstock:rnd-experimental:pending:'+uid
export type ExperimentalRecovery = {kind:'none'}|{kind:'ready';input:ExperimentalReceiptInput}|{kind:'corrupt'}
export function readExperimentalRecovery(storage:Store,uid:string):ExperimentalRecovery {
 try{const saved=storage.getItem(key(uid));if(!saved)return{kind:'none'};return{kind:'ready',input:validateExperimentalInput(JSON.parse(saved))}}catch{return{kind:'corrupt'}}
}
/** Synchronous durable snapshot BEFORE network; failure must prevent sending. No tokens. */
export function stageExperimentalRecovery(storage:Store,uid:string,input:ExperimentalReceiptInput):void {
 storage.setItem(key(uid),JSON.stringify(validateExperimentalInput(input)))
}
export function clearExperimentalRecovery(storage:Store,uid:string):void { storage.removeItem(key(uid)) }
