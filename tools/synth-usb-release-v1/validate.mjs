import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {inspectLocalDelivery} from './inspect.mjs';

const directory=fileURLToPath(new URL('./',import.meta.url)),project=resolve(directory,'../..');
const synth=resolve(process.env.OPENSP_SYNTH_USB_EVIDENCE_ROOT??resolve(project,'../sp404mk2-synth'));
const ownedBuild=resolve(synth,'build/standalone-source-picker-v1/whole-02');
const hash=body=>createHash('sha256').update(body).digest('hex');
function run(args) {
  return new Promise((done,reject)=>{
    const child=spawn(process.execPath,args,{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
    child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));
  });
}
const testArgs=['--import','./tools/register-test-typescript.mjs','--test','tools/synth-usb-release-v1/test-release.mjs','tools/synth-usb-release-v1/test-bench.mjs','tools/synth-usb-release-v1/test-root-review-v2.mjs'];
const typeArgs=['node_modules/typescript/bin/tsc','--ignoreConfig','--noEmit','--strict','--target','ES2022','--module','ESNext','--moduleResolution','bundler','--allowImportingTsExtensions','--lib','ES2022,DOM',...['release','b2-driver','flow','evidence-bundle','local-bench-v1','bench-flow-v1','bench-browser-v1','bench-flow-v2','bench-browser-v2','root-review-schema-fixture'].map(name=>`tools/synth-usb-release-v1/${name}.ts`)];
const [tests,types,browser,inspection]=await Promise.all([
  run(testArgs),run(typeArgs),build({absWorkingDir:project,entryPoints:['tools/synth-usb-release-v1/flow.ts','tools/synth-usb-release-v1/evidence-bundle.ts','tools/synth-usb-release-v1/local-bench-v1.ts','tools/synth-usb-release-v1/bench-browser-v1.ts','tools/synth-usb-release-v1/bench-browser-v2.ts'],outdir:'local-browser-check-only',bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',minify:true}),
  inspectLocalDelivery({synthRoot:synth,restorationPath:resolve(ownedBuild,'restore-build/restore-p6s.disabled.bin'),handoffPath:resolve(synth,'build/synth-release-patcher-v1/retained-inspection-01/PATCHER_HANDOFF.json'),buildRoot:ownedBuild}),
]);
if(tests.code!==0||types.code!==0)throw Error(JSON.stringify({tests,types}));
const totals=Object.fromEntries(['tests','pass','fail','skipped'].map(key=>[key,Number(tests.stdout.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1])]));
if(totals.tests!==73||totals.pass!==73||totals.fail!==0||totals.skipped!==0)throw Error('Focused test totals differ.');
const checkedFiles=[];
for(const name of (await readdir(directory)).sort()) {
  if(!/\.(?:ts|mjs|md|json)$/.test(name)||name.startsWith('VALIDATION_'))continue;
  const body=await readFile(resolve(directory,name));checkedFiles.push({path:name,bytes:body.length,sha256:hash(body)});
}
const bundle=browser.outputFiles[0].contents;
const report={schema:'opensp-synth-usb-release-software-validation-v1',version:1,status:'PASS_RESTORATION_AND_HELD_CONCRETE_LOCALBENCH_SOFTWARE_CHECKS',checkedAt:new Date().toISOString(),
  focusedTests:{...totals,command:[process.execPath.split(/[\\/]/).at(-1),...testArgs].join(' '),outputSha256:hash(tests.stdout),hostProtocolModelOnly:true},
  strictTypecheck:{passed:true,command:['node',...typeArgs].join(' ')},browserBundle:{passed:true,bytes:bundle.length,gzipBytes:gzipSync(bundle).length,sha256:hash(bundle),writtenToWebsite:false,
    entries:browser.outputFiles.map(file=>({name:file.path.split(/[\\/]/).at(-1),bytes:file.contents.length,gzipBytes:gzipSync(file.contents).length,sha256:hash(file.contents)}))},
  inspection,checkedFiles,priorPhysicalEvidence:{imageSha256:inspection.restoration.sha256,storageReceiptSha256:'090872342cc913029ca9f5ba5005ee2606dc4399df99710a9029b2557f4e97ac',rootReviewSha256:'3849470e893c5e49767b25312cbe4f4b08442988ce01c0d184603120eb4d0e79'},
  limitations:{additiveIntegrationPhysicallyTested:false,actualPriorExactP6STransportTrialPassed:true,newCandidateQualified:false,publicReleaseReady:false,stockFirstInstallSupported:false},
  correctedTestAssertions:["The first negative handoff assertion expected 'differs'; the correct refusal ended in 'differ'.","The first flow timeout assertion expected 'timed out'; the preserved driver reports 'exceeded its 20 ms bound'."],
  deviceOperations:false,browserControlled:false,firmwareRebuilt:false,sharedWebsiteEdited:false,published:false,
};
const output=process.argv[2]??'VALIDATION_05.json';
if(!/^VALIDATION_\d{2}\.json$/.test(output))throw Error('Use a new versioned validation filename.');
await writeFile(new URL(output,import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({status:report.status,tests:totals,browserBundle:report.browserBundle})+'\n');
