import { accessToken, parseServiceAccount } from '../../worker/src/auth'
import { PROJECT_ID, verifyFirebaseToken } from '../_poImage'
import { experimentalRestStore } from '../_lib/experimentalStore'
import { handleExperimentalRequest } from '../_lib/experimentalReceive'

interface ExperimentalEnv { RND_EXPERIMENTAL_RECEIVE_ENABLED?:string; FIREBASE_SERVICE_ACCOUNT?:string; FIREBASE_PROJECT_ID?:string }
export const onRequestPost:PagesFunction<ExperimentalEnv>=async({request,env})=>{
 // Default off. Deployment/configuration approval is separate from this Draft feature.
 if(env.RND_EXPERIMENTAL_RECEIVE_ENABLED!=='1'||!env.FIREBASE_SERVICE_ACCOUNT)return Response.json({error:'not_configured'},{status:503})
 const project=(env.FIREBASE_PROJECT_ID??'').trim()||PROJECT_ID
 let sa:ReturnType<typeof parseServiceAccount>
 try{sa=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);if(sa.project_id!==project)throw Error('project mismatch')}catch{return Response.json({error:'not_configured'},{status:503})}
 return handleExperimentalRequest(request,{enabled:true,verifyUser:h=>verifyFirebaseToken(h,project),store:experimentalRestStore(project,()=>accessToken(sa))})
}
