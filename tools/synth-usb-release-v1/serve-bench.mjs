import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBenchTransaction} from './prepare-bench.mjs';
import {inspectLocalBenchByteBindings} from './local-bench-v1.ts';

const directory=fileURLToPath(new URL('./',import.meta.url)),project=resolve(directory,'../..');
const transaction=process.argv[2],port=Number(process.argv[3]??8768);
if(!transaction||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Usage: serve-bench.mjs TRANSACTION_DIRECTORY [PORT]');
const loaded=await loadBenchTransaction(transaction),inspection=await inspectLocalBenchByteBindings(loaded.inputs);
const version=inspection.rootReviewContract?.version===2?2:1;
const bundle=await build({absWorkingDir:project,entryPoints:[`tools/synth-usb-release-v1/bench-browser-v${version}.ts`],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
const files=new Map([['/',{body:await readFile(resolve(directory,`bench-site-v${version}.html`)),type:'text/html; charset=utf-8'}],
  ['/bench.js',{body:Buffer.from(bundle.outputFiles[0].contents),type:'text/javascript; charset=utf-8'}],
  ['/map.json',{body:Buffer.from(JSON.stringify(loaded.map)),type:'application/json'}]]);
const add=async(label,file)=>files.set('/file/'+encodeURIComponent(label),{body:Buffer.from(await file.arrayBuffer()),type:'application/octet-stream'});
await add(loaded.map.manifest,loaded.inputs.ownerTestEligibilityManifest);await add(loaded.map.candidate,loaded.inputs.candidate);await add(loaded.map.restoration,loaded.inputs.restoration);
if(loaded.map.root_seal)await add(loaded.map.root_seal,loaded.inputs.rootSeal);
for(const [id,label] of Object.entries(loaded.map.software_evidence))await add(label,loaded.inputs.softwareEvidenceFiles[id]);
files.set('/file/'+encodeURIComponent(loaded.map.restoration_evidence_bundle),{body:await readFile(resolve(loaded.root,loaded.map.restoration_evidence_bundle)),type:'application/json'});
const server=createServer((request,response)=>{
  if(request.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(request.method)){response.writeHead(403);response.end();return;}
  const file=files.get(request.url);if(!file){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':file.type,'Content-Length':file.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});
  response.end(request.method==='HEAD'?undefined:file.body);
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${port}/`,manifestSha256:inspection.manifestSha256,
  bundleSha256:createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),held:inspection.blockers,deviceOperations:false,registryChanged:false})+'\n'));
