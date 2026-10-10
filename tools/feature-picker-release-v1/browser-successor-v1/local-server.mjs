import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {checkedSourceArchive} from '../standalone-build.mjs';
import {rejectDuplicateJsonKeys} from '../../../src/lib/features/selection.ts';
import {canonicalLocalSelection,STANDALONE_RECIPE,STANDALONE_SOURCE} from '../../../src/lib/features/standaloneReceipt.ts';
import {inspectBuildForBrowser,stageBrowserInspection,checkedOfficialInput} from './receipt.mjs';

const opensp=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const inside=(root,path)=>{const p=relative(root,path);return p===''||(!p.startsWith('..')&&!isAbsolute(p));};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const runName=name=>typeof name==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
export function checkedSiteOrigin(text){
 const url=new URL(text);need(url.origin===text&&!url.username&&!url.password,'Use one exact site origin.');
 need(text==='https://opensp.fyi'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&(!url.port||Number(url.port)>0)),'Only the OpenSP origin or a local preview origin is supported.');return text;
}
export function parseServerArgs(args){
 const allowed=['source-archive','python','toolchain-root','official','output-root','site-origin','port','existing-build'],out={};
 for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--')&&!Object.hasOwn(out,key),'Invalid or repeated local helper option.');out[key]=args[i+1];}
 need(allowed.slice(0,6).every(key=>out[key]),'Supply source archive, Python/tools, official input, output root and site origin.');
 need(out.port===undefined||/^\d{1,5}$/.test(out.port)&&Number(out.port)<=65535,'Invalid local helper port.');return out;
}
export async function fixedStandaloneRuntime(options){
 need(process.platform==='win32','This exact standalone helper supports Windows only.');
 options=parseServerArgs(Object.entries(options).flatMap(([key,value])=>[`--${key}`,String(value)]));
 const origin=checkedSiteOrigin(options['site-origin']);
 const paths={sourceArchive:options['source-archive'],python:options.python,tools:options['toolchain-root'],official:options.official,outputRoot:options['output-root']};
 for(const key of Object.keys(paths))paths[key]=await realpath(resolve(paths[key]));
 need((await stat(paths.outputRoot)).isDirectory()&&!inside(opensp,paths.outputRoot)&&!inside(opensp,paths.official),'Use an existing private output root and official firmware outside the website.');
 need(![paths.sourceArchive,paths.python,paths.tools,paths.official].some(path=>inside(paths.outputRoot,path)),'The output root must be separate from source/tool/firmware inputs.');
 need(!inside(paths.tools,paths.outputRoot)&&!inside(dirname(paths.python),paths.outputRoot),'The output root must not modify installed tool namespaces.');
 need(!['public','dist'].some(name=>inside(resolve(opensp,name),paths.sourceArchive)),'Source authority must remain outside website assets.');
 const raw=await readFile(paths.sourceArchive),{authority}=checkedSourceArchive(raw);checkedOfficialInput(await readFile(paths.official));
 need(authority.python_role.launcher_sha256.includes(hash(await readFile(paths.python))),'Python has no fixed reviewed launcher role.');
 const pins={sourceArchive:hash(raw),python:hash(await readFile(paths.python)),official:hash(await readFile(paths.official))};
 const existingBuild=options['existing-build']?await realpath(resolve(options['existing-build'])):null;
 need(!existingBuild||!inside(opensp,existingBuild)&&!inside(existingBuild,paths.outputRoot),'Retained evidence stays outside the website and must not contain the new output root.');
 return Object.freeze({...paths,origin,pins:Object.freeze(pins),recipe:STANDALONE_RECIPE,port:Number(options.port??0),existingBuild});
}
/** Actual reviewed standalone entrypoint, structured child arguments, no shell. */
export async function executeStandaloneBuild(runtime,{selectionPath,output}){
 const args=['--import',pathToFileURL(resolve(opensp,'tools/register-test-typescript.mjs')).href,resolve(opensp,'tools/feature-picker-release-v1/standalone-build.mjs'),
  '--source-archive',runtime.sourceArchive,'--python',runtime.python,'--toolchain-root',runtime.tools,'--selection',selectionPath,'--official',runtime.official,'--output',output];
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase())));env.PATH=resolve(process.env.SystemRoot??process.env.SYSTEMROOT,'System32');
 const result=await new Promise(accept=>{
  const child=spawn(process.execPath,args,{cwd:opensp,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let count=0,overflow=false;const stdout=[],stderr=[];
  for(const [stream,chunks]of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',bytes=>{count+=bytes.length;if(count>24*1024*1024){overflow=true;child.kill();}else chunks.push(bytes);});
  child.on('error',error=>accept({error,code:null,stdout,stderr}));child.on('close',code=>accept({code,overflow,stdout,stderr}));
 });
 await writeFile(resolve(dirname(output),'standalone-child.stdout.log'),Buffer.concat(result.stdout),{flag:'wx'});
 await writeFile(resolve(dirname(output),'standalone-child.stderr.log'),Buffer.concat(result.stderr),{flag:'wx'});
 need(!result.error&&result.code===0&&!result.overflow,'The standalone builder refused. Inspect its private local logs.');
 return resolve(output,'build');
}
async function boundedRequest(request){
 need(request.headers['content-type']?.split(';')[0]==='application/json','Expected JSON.');const parts=[];let bytes=0;
 for await(const chunk of request){bytes+=chunk.length;need(bytes<=49152,'Request too large.');parts.push(chunk);}
 const text=Buffer.concat(parts).toString('utf8');rejectDuplicateJsonKeys(text);return JSON.parse(text);
}
/** Fixed authority supplied once by local startup; requests cannot supply paths or grants. */
export async function startLocalBuildServer({fixedRuntime,executeBuild=executeStandaloneBuild}){
 const runtime=fixedRuntime;need(runtime.recipe===STANDALONE_RECIPE&&checkedSiteOrigin(runtime.origin)===runtime.origin,'Unsupported helper authority.');
 const token=randomBytes(32).toString('base64url'),jobs=new Map();let active=null,closing=false,submitting=false;
 const summary=job=>({run_key:job.key,phase:job.phase,message:job.message??null,receipt:job.receipt??null});
 async function inspectAndStage(job,build,recompiled){
  const inspection=await inspectBuildForBrowser({build,sourceArchive:runtime.sourceArchive,official:runtime.official,runKey:job.key,recompiledThisRequest:recompiled});
  job.stage=await stageBrowserInspection(resolve(job.folder,'stage'),inspection);job.receipt=inspection.receipt;job.phase='checked';
 }
 if(runtime.existingBuild){
  const key='retained-proof',folder=resolve(runtime.outputRoot,key);await mkdir(folder);const job={key,folder,phase:'checking'};jobs.set(key,job);await inspectAndStage(job,runtime.existingBuild,false);
 }
 const server=createServer(async(request,response)=>{
  const send=(code,body)=>{response.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body));};
  try{
   const port=server.address().port;
   need(request.headers.host===`127.0.0.1:${port}`&&request.headers.origin===runtime.origin,'This request is outside the local helper origin.');
   response.setHeader('Access-Control-Allow-Origin',runtime.origin);response.setHeader('Vary','Origin');
   if(request.method==='OPTIONS'){
    need(['GET','POST'].includes(request.headers['access-control-request-method']),'Unsupported preflight method.');
    const headers=(request.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);need(headers.every(h=>['content-type','x-opensp-capability'].includes(h)),'Unsupported preflight headers.');
    response.setHeader('Access-Control-Allow-Methods','GET, POST');response.setHeader('Access-Control-Allow-Headers','Content-Type, X-OpenSP-Capability');
    if(request.headers['access-control-request-private-network']==='true')response.setHeader('Access-Control-Allow-Private-Network','true');response.writeHead(204);response.end();return;
   }
   const supplied=Buffer.from(request.headers['x-opensp-capability']??''),expected=Buffer.from(token);need(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'The local helper capability is missing.');
   const url=new URL(request.url,'http://127.0.0.1');need(!url.search&&!url.hash,'Unsupported request fields.');
   if(request.method==='GET'&&url.pathname==='/v1/state'){send(200,{schema:'opensp-local-feature-helper-v1',recipe:STANDALONE_RECIPE,source_archive:STANDALONE_SOURCE,jobs:[...jobs.values()].map(summary),active_run:active,public_ready:false,device_operations:false,browser_upload_enabled:false});return;}
   const route=url.pathname.match(/^\/v1\/jobs\/([a-z0-9][a-z0-9-]{0,63})(?:\/artifact\/(receipt|candidate|restoration|handoff|selection))?$/);
   if(request.method==='GET'&&route){
    const job=jobs.get(route[1]);need(job,'Unknown local run.');if(!route[2]){send(200,summary(job));return;}
    need(job.phase==='checked'&&job.stage,'This local run has no admitted artifact.');const role=route[2],raw=await readFile(resolve(job.stage.folder,job.stage.files[role])),pin=job.stage.pins[role];
    need(raw.length===pin.bytes&&hash(raw)===pin.sha256,'Staged bytes changed.');response.writeHead(200,{'Content-Type':role==='candidate'||role==='restoration'?'application/octet-stream':'application/json','Content-Length':raw.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(raw);return;
   }
   if(request.method==='POST'&&url.pathname==='/v1/build'){
    need(!closing&&!active&&!submitting,'One local build is already active.');submitting=true;
    try{const body=await boundedRequest(request);
    need(exact(body,['run_key','selection'])&&runName(body.run_key)&&typeof body.selection==='string'&&Buffer.byteLength(body.selection)<=32768,'Use only a new run name and canonical selection.');canonicalLocalSelection(body.selection);
    need(!jobs.has(body.run_key),'Run name already exists.');for(const [role,digest]of Object.entries(runtime.pins))need(hash(await readFile(runtime[role]))===digest,'Fixed local authority changed.');
    const key=body.run_key,folder=resolve(runtime.outputRoot,key);await mkdir(folder);const selectionPath=resolve(folder,'selection.json');await writeFile(selectionPath,body.selection,{flag:'wx'});
    const job={key,folder,phase:'building'};jobs.set(key,job);active=key;send(202,summary(job));
    void (async()=>{try{const build=await executeBuild(runtime,{selectionPath,output:resolve(folder,'build-run')});job.phase='checking';await inspectAndStage(job,build,true);}catch{job.phase='failed';job.message='The local builder or source/artifact inspection refused. Preserve this attempt and inspect its private logs.';}finally{active=null;}})();return;
    }finally{submitting=false;}
   }
   send(404,{error:'Unsupported local helper operation.'});
  }catch{if(!response.headersSent)send(400,{error:'The local helper refused this request.'});else response.end();}
 });
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(runtime.port,'127.0.0.1',accept);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 return {server,origin,connection:`${origin}/#${token}`,capability:token,jobs,close:()=>{closing=true;return new Promise(accept=>server.close(accept));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const runtime=await fixedStandaloneRuntime(parseServerArgs(process.argv.slice(2))),helper=await startLocalBuildServer({fixedRuntime:runtime});
  console.log(JSON.stringify({connection:helper.connection,site_origin:runtime.origin,recipe:STANDALONE_RECIPE,source_archive:STANDALONE_SOURCE,device_operations:false,public_ready:false,browser_upload_enabled:false},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
