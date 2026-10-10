import {STANDALONE_RECIPE,STANDALONE_SOURCE} from './standaloneReceipt.ts';

import {readHelperConnection} from './helperConnection.ts';
export {readHelperConnection} from './helperConnection.ts';

/** Capability stays in memory; never place it in fetch URLs, storage or downloads. */
export function createHelperClient(text:string,fetcher:typeof fetch=fetch){
 const connection=readHelperConnection(text);
 const request=async(path:string,{method='GET',body}:{method?:string;body?:unknown}={})=>{
  const result=await fetcher(connection.origin+path,{method,mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'X-OpenSP-Capability':connection.capability,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!result.ok)throw Error('The local helper refused this operation. Check its terminal and preserved attempt.');return result;
 };
 return {
  state:async()=>{const result=await(await request('/v1/state')).json();if(result.schema!=='opensp-local-feature-helper-v1'||result.recipe!==STANDALONE_RECIPE||result.source_archive?.sha256!==STANDALONE_SOURCE.sha256||result.source_archive?.bytes!==STANDALONE_SOURCE.bytes||result.public_ready!==false||result.browser_upload_enabled!==false||result.device_operations!==false||!Array.isArray(result.jobs))throw Error('This helper does not use the reviewed standalone source recipe.');return result;},
  build:async(runKey:string,selection:string)=>(await request('/v1/build',{method:'POST',body:{run_key:runKey,selection}})).json(),
  job:async(runKey:string)=>(await request(`/v1/jobs/${encodeURIComponent(runKey)}`)).json(),
  artifact:async(runKey:string,role:'receipt'|'candidate'|'restoration'|'handoff'|'selection')=>request(`/v1/jobs/${encodeURIComponent(runKey)}/artifact/${role}`)
 };
}
