import {readHelperConnection} from '../helperConnection.ts';
import {catalogDigest} from './selection.ts';
import {SOURCE_RECIPE,SOURCE_PROFILES} from './receipt.ts';
export function createSourceHelperClient(text:string,fetcher:typeof fetch=fetch){
 const connection=readHelperConnection(text);
 async function request(route:string,body?:unknown){
  const response=await fetcher(connection.origin+route,{method:body===undefined?'GET':'POST',mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'X-OpenSP-Capability':connection.capability,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw Error('The local source helper refused. Check its terminal and preserve the attempt.');return response;
 }
 return {
  state:async()=>{const value=await(await request('/v1/state')).json();if(value.schema!=='opensp-local-source-preview-helper-v1'||value.recipe!==SOURCE_RECIPE||value.catalog_digest!==catalogDigest||JSON.stringify(value.source_profiles)!==JSON.stringify(SOURCE_PROFILES)||value.device_operations!==false||value.APP1_emitted!==false||value.installation_eligible!==false||!Array.isArray(value.jobs))throw Error('Connect the matching Full14 source-preview helper. The P6S standalone helper uses another recipe.');return value;},
  build:async(runKey:string,selection:string)=>(await request('/v1/build',{run_key:runKey,selection})).json(),
  job:async(runKey:string)=>(await request('/v1/jobs/'+encodeURIComponent(runKey))).json(),
  artifact:async(runKey:string,role:'receipt'|'module'|'selection')=>request(`/v1/jobs/${encodeURIComponent(runKey)}/artifact/${role}`)
 };
}
