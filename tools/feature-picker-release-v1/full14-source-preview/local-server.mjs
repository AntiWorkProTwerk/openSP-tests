import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {readSelection,exportSelection,sourceProfile,rejectDuplicateJsonKeys,catalogDigest} from '../../../src/lib/features/source-preview/selection.ts';
import {selectionDigest,SOURCE_RECIPE,SOURCE_PROFILES} from '../../../src/lib/features/source-preview/receipt.ts';

const site=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const need=(condition,message)=>{if(!condition)throw Error(message);};
const inside=(root,file)=>{const value=relative(root,file);return value===''||(!value.startsWith('..')&&!isAbsolute(value));};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
export function parseArgs(args){
 const allowed=['sp-root','python','tool-prefix','official','output-root','site-origin','port'],result={};
 for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--')&&!Object.hasOwn(result,key),'Invalid or repeated source-helper option.');result[key]=args[i+1];}
 need(allowed.slice(0,6).every(key=>result[key]),'Supply SP source checkout, Python, ARM prefix, official input, existing output root and site origin.');
 need(result.port===undefined||/^\d{1,5}$/.test(result.port)&&Number(result.port)<=65535,'Invalid source-helper port.');return result;
}
export function siteOrigin(value){
 const url=new URL(value);need(url.origin===value&&!url.username&&!url.password&&(value==='https://opensp.fyi'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)),'Use the exact OpenSP or local preview origin.');return value;
}
export async function fixedRuntime(options){
 options=parseArgs(Object.entries(options).flatMap(([key,value])=>['--'+key,String(value)]));
 const root=await realpath(resolve(options['sp-root'])),python=await realpath(resolve(options.python)),official=await realpath(resolve(options.official)),outputRoot=await realpath(resolve(options['output-root']));
 const toolPrefix=resolve(options['tool-prefix']);await stat(toolPrefix+'gcc.exe');
 need(inside(root,outputRoot)&&!inside(site,outputRoot)&&outputRoot!==root&&(await stat(outputRoot)).isDirectory(),'Use an existing private output directory inside the SP source checkout, outside the website.');
 const sourceFolder=resolve(root,'diagnostics/opensynth_feature_picker_full14_finish_01');
 need(!inside(outputRoot,sourceFolder)&&!inside(outputRoot,python)&&!inside(outputRoot,official)&&!inside(outputRoot,toolPrefix),'Keep output separate from fixed source, firmware and tool inputs.');
 const handoffPath=resolve(sourceFolder,'HANDOFF.json'),handoffRaw=await readFile(handoffPath);
 need(sha(handoffRaw)==='24bd81c7ae7bfc5fb75c7239efb7834786d8d3d8f0d16b996c191094b036ee58','Use the reviewed Full14 source-preview builder checkout.');
 const handoff=JSON.parse(handoffRaw),runner=resolve(sourceFolder,'run.mjs');
 for(const name of ['run.mjs','preview.mjs','build_source.py','SOURCE_PINS.json'])need(sha(await readFile(resolve(sourceFolder,name)))===handoff.files[name].sha256,'The reviewed source builder changed: '+name);
 const sourceApi=await import(pathToFileURL(resolve(sourceFolder,'preview.mjs')).href);await sourceApi.sourceAuthority();
 const officialHash=sha(await readFile(official));
 need(['ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5','4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80'].includes(officialHash),'Supply unchanged official Roland v5.52 firmware.');
 return Object.freeze({root,python,official,outputRoot,toolPrefix,runner,origin:siteOrigin(options['site-origin']),port:Number(options.port??0),recipe:SOURCE_RECIPE,
  pins:Object.freeze({official:officialHash,python:sha(await readFile(python)),runner:sha(await readFile(runner))})});
}
/** Real reviewed source-module runner. It never invokes firmware patching. */
export async function executeSourceBuild(runtime,{selectionPath,output}){
 const args=['--import',pathToFileURL(resolve(site,'tools/register-test-typescript.mjs')).href,runtime.runner,'--selection',selectionPath,'--official',runtime.official,'--tool-prefix',runtime.toolPrefix,'--python',runtime.python,'--output',output];
 const result=await new Promise(accept=>{
  const child=spawn(process.execPath,args,{cwd:runtime.root,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];let count=0,overflow=false;
  for(const [stream,parts]of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',bytes=>{count+=bytes.length;if(count>24*1024*1024){overflow=true;child.kill();}else parts.push(bytes);});
  child.once('error',error=>accept({error,stdout,stderr}));child.once('close',code=>accept({code,overflow,stdout,stderr}));
 });
 await writeFile(resolve(dirname(output),'source-child.stdout.log'),Buffer.concat(result.stdout),{flag:'wx'});
 await writeFile(resolve(dirname(output),'source-child.stderr.log'),Buffer.concat(result.stderr),{flag:'wx'});
 need(!result.error&&result.code===0&&!result.overflow,'Source compilation refused. Preserve the output and inspect the private logs.');return output;
}
async function body(request){
 need(request.headers['content-type']?.split(';')[0]==='application/json','Expected JSON.');const parts=[];let count=0;
 for await(const bytes of request){count+=bytes.length;need(count<=49152,'Source request too large.');parts.push(bytes);}
 const text=Buffer.concat(parts).toString('utf8');rejectDuplicateJsonKeys(text);return JSON.parse(text);
}
export async function startSourceServer({runtime,executeBuild=executeSourceBuild}){
 need(runtime.recipe===SOURCE_RECIPE&&siteOrigin(runtime.origin)===runtime.origin,'Unsupported fixed source-helper runtime.');
 const token=randomBytes(32).toString('base64url'),jobs=new Map();let active=null,submitting=false;
 const summary=job=>({run_key:job.key,phase:job.phase,receipt:job.receipt??null,message:job.message??null});
 async function inspect(job,output,selection){
  const report=JSON.parse(await readFile(resolve(output,'REPORT.json'),'utf8'));
  need(report.status==='PASS_SOURCE_MERGE_MODULE_LINK_ONLY'&&report.APP1_emitted===false&&report.device_operations===false&&report.hardware_qualified===false&&report.compiler_calls.length===113&&report.compiler_calls.every(row=>row.returncode===0)&&report.link.returncode===0,'The source module did not complete its actual compile/link plan.');
  const profile=sourceProfile(selection),pins=SOURCE_PROFILES[profile],selectionSha=await selectionDigest(selection);
  need(report.source_preview?.profile===profile&&report.source_preview.selection_sha256===selectionSha&&report.source_preview.reference_module.sha256===pins.module&&report.source_preview.firmware_build_admitted===false,'The source result names another selection or profile.');
  const module=await realpath(report.module.path);need(inside(output,module),'The module is outside this source-build output.');
  const bytes=await readFile(module);need(bytes.length===report.module.bytes&&sha(bytes)===report.module.sha256&&bytes.length<=2*1024*1024&&bytes.subarray(0,4).toString('hex')==='7f454c46','The source module bytes differ from their build report.');
  job.receipt={schema:'opensp-full14-source-module-build-receipt-v1',recipe:SOURCE_RECIPE,run_key:job.key,source_profile:profile,
   selection_sha256:selectionSha,source_report_sha256:pins.report,reference_module_sha256:pins.module,module:{bytes:bytes.length,sha256:sha(bytes)},compiler_units:113,
   APP1_emitted:false,device_operations:false,hardware_qualified:false,firmware_build_admitted:false,installation_eligible:false};
  const receiptPath=resolve(job.folder,'source-receipt.json');await writeFile(receiptPath,JSON.stringify(job.receipt,null,2)+'\n',{flag:'wx'});
  job.files={receipt:receiptPath,module,selection:resolve(job.folder,'selection.json')};job.pins={};
  for(const [role,file]of Object.entries(job.files)){const raw=await readFile(file);job.pins[role]={bytes:raw.length,sha256:sha(raw)};}
  job.phase='checked';
 }
 const server=createServer(async(request,response)=>{
  const send=(code,value)=>{response.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
  try{
   need(request.headers.host===`127.0.0.1:${server.address().port}`&&request.headers.origin===runtime.origin,'Outside the fixed local helper origin.');
   response.setHeader('Access-Control-Allow-Origin',runtime.origin);response.setHeader('Vary','Origin');
   if(request.method==='OPTIONS'){
    need(['GET','POST'].includes(request.headers['access-control-request-method']),'Unsupported method.');
    const headers=(request.headers['access-control-request-headers']??'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);need(headers.every(value=>['content-type','x-opensp-capability'].includes(value)),'Unsupported headers.');
    response.setHeader('Access-Control-Allow-Methods','GET, POST');response.setHeader('Access-Control-Allow-Headers','Content-Type, X-OpenSP-Capability');if(request.headers['access-control-request-private-network']==='true')response.setHeader('Access-Control-Allow-Private-Network','true');response.writeHead(204);response.end();return;
   }
   const supplied=Buffer.from(request.headers['x-opensp-capability']??''),expected=Buffer.from(token);need(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'Local helper capability missing.');
   const url=new URL(request.url,'http://127.0.0.1');need(!url.search&&!url.hash,'Unsupported URL fields.');
   if(request.method==='GET'&&url.pathname==='/v1/state'){send(200,{schema:'opensp-local-source-preview-helper-v1',recipe:SOURCE_RECIPE,catalog_digest:catalogDigest,source_profiles:SOURCE_PROFILES,jobs:[...jobs.values()].map(summary),active_run:active,APP1_emitted:false,device_operations:false,installation_eligible:false});return;}
   const route=url.pathname.match(/^\/v1\/jobs\/([a-z0-9][a-z0-9-]{0,63})(?:\/artifact\/(receipt|module|selection))?$/);
   if(request.method==='GET'&&route){const job=jobs.get(route[1]);need(job,'Unknown source run.');if(!route[2]){send(200,summary(job));return;}
    need(job.phase==='checked','Source run has no checked artifact.');const role=route[2],raw=await readFile(job.files[role]),pin=job.pins[role];need(raw.length===pin.bytes&&sha(raw)===pin.sha256,'Source artifact changed.');response.writeHead(200,{'Content-Type':role==='module'?'application/octet-stream':'application/json','Content-Length':raw.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(raw);return;}
   if(request.method==='POST'&&url.pathname==='/v1/build'){
    need(!active&&!submitting,'A source build is already active.');submitting=true;
    try{const value=await body(request);need(exact(value,['run_key','selection'])&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.run_key)&&typeof value.selection==='string'&&Buffer.byteLength(value.selection)<=32768,'Use a new run key and canonical source selection only.');
     const selection=readSelection(value.selection);sourceProfile(selection);need(exportSelection(selection)===value.selection,'Use the exact canonical source selection.');need(!jobs.has(value.run_key),'Run already exists.');
     for(const [role,pin]of Object.entries(runtime.pins))need(sha(await readFile(runtime[role]))===pin,'Fixed source-helper input changed.');
     const key=value.run_key,folder=resolve(runtime.outputRoot,key);await mkdir(folder);const selectionPath=resolve(folder,'selection.json');await writeFile(selectionPath,value.selection,{flag:'wx'});
     const job={key,folder,phase:'building'};jobs.set(key,job);active=key;send(202,summary(job));
     void(async()=>{try{const output=await executeBuild(runtime,{selectionPath,output:resolve(folder,'source-build')});job.phase='checking';await inspect(job,output,selection);}catch{job.phase='failed';job.message='Source build or exact artifact inspection refused. Preserve this run and inspect its private logs.';}finally{active=null;}})();return;
    }finally{submitting=false;}
   }
   send(404,{error:'Unsupported source-helper operation.'});
  }catch{if(!response.headersSent)send(400,{error:'The source helper refused this request.'});else response.end();}
 });
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(runtime.port,'127.0.0.1',accept);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,connection:`${origin}/#${token}`,server,jobs,close:()=>new Promise(accept=>server.close(accept))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const runtime=await fixedRuntime(parseArgs(process.argv.slice(2))),helper=await startSourceServer({runtime});console.log(JSON.stringify({connection:helper.connection,site_origin:runtime.origin,recipe:SOURCE_RECIPE,device_operations:false,APP1_emitted:false,installation_eligible:false},null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
