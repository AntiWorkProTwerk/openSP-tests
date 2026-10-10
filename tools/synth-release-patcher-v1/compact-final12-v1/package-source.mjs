import {readFile,writeFile,realpath,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import {FINAL12,RESTORATION_SOURCE,QUALIFICATION} from './pins.mjs';
import {hash,crc32,need,inside} from './common.mjs';
import {checkedCompactArchive} from './source.mjs';

const here=dirname(fileURLToPath(import.meta.url)),website=resolve(here,'../../..');
const wrapperNames=['pins.mjs','common.mjs','source.mjs','inspect.mjs','handoff.mjs','build.mjs','run.mjs','test-delta.mjs','owner-handoff.mjs','package-source.mjs','README.md','DEPENDENCIES.md','LICENSE','NOTICE','source-final12.zip'];

function zip(files){
  const locals=[],directory=[];let offset=0;const date=((2026-1980)<<9)|(10<<5)|6;
  for(const [name,body] of [...files].sort(([a],[b])=>a.localeCompare(b,'en'))){
    const label=Buffer.from(name),packed=deflateRawSync(body,{level:9}),crc=crc32(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt16LE(date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(label.length,26);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt16LE(date,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(0x81a40000,38);central.writeUInt32LE(offset,42);
    locals.push(local,label,packed);directory.push(central,label);offset+=local.length+label.length+packed.length;
  }
  const rows=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(rows.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,rows,end]);
}

export async function packageSource(output){
  const requested=resolve(output),parent=await realpath(dirname(requested));output=resolve(parent,requested.split(/[\\/]/).at(-1));need(!inside(website,output),'Source review archive must remain outside website assets.');
  try{await access(output);throw Error('Preserve existing source review archives.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const files=new Map();for(const name of wrapperNames)files.set('tools/synth-release-patcher-v1/compact-final12-v1/'+name,await readFile(resolve(here,name)));
  const compact=files.get('tools/synth-release-patcher-v1/compact-final12-v1/source-final12.zip');checkedCompactArchive(compact);
  files.set('tools/synth-release-patcher-v1/official.mjs',await readFile(resolve(here,'../official.mjs')));
  const restore=await readFile(resolve(here,'../../feature-picker-release-v1/standalone-source-bundle.zip'));
  need(restore.length===RESTORATION_SOURCE.bytes&&hash(restore)===RESTORATION_SOURCE.sha256,'Restoration source bundle identity differs.');files.set('tools/feature-picker-release-v1/standalone-source-bundle.zip',restore);
  const template=await readFile(resolve(here,'../../feature-picker-release-v1/compiler_manifest.template.json'));
  need(template.length===245&&hash(template)==='3e30983bd1b2607f2b9c63614186dce060ac6ff5f18b758dc41d534a633e725c','Compiler metadata template differs.');files.set('tools/feature-picker-release-v1/compiler_manifest.template.json',template);
  files.set('LICENSE',files.get('tools/synth-release-patcher-v1/compact-final12-v1/LICENSE'));files.set('NOTICE',files.get('tools/synth-release-patcher-v1/compact-final12-v1/NOTICE'));
  files.set('README.md',Buffer.from('# openSynth N1 source review kit\n\nThis package contains the fixed compact final12 builder and source archive, local byte-replay inspector and the separate unchanged restoration source bundle. It contains no official firmware, generated APP1, compiled module, compiler executable or hardware capture.\n\nFrom this extracted root, follow [the compact guide](tools/synth-release-patcher-v1/compact-final12-v1/README.md) and [the exact dependency instructions](tools/synth-release-patcher-v1/compact-final12-v1/DEPENDENCIES.md). Supply unchanged official Roland v5.52, exact P6S restoration bytes, the admitted Python and Arm installations, and a new private output.\n\nSealed kit12 includes the sixteen-sound, four-voice synth, direct recording with a 120-second cap, pattern controls and native recording click. Software, hardware, upload and public-release eligibility remain false. Local build or byte inspection cannot grant writer authority. MIT LICENSE/NOTICE retain attribution and the original-code/vendor exclusions. This is a private source review package; source promotion and publication remain separate.\n'));
  const manifest={schema:'opensp-compact-source-only-review-package-v1',recipe:FINAL12.recipe,identity:FINAL12.identity,source_archive:{...FINAL12.archive},entry_sha256:FINAL12.entry_sha256,source_contract_sha256:FINAL12.source_contract_sha256,features:{...FINAL12.features},component_join:{...FINAL12.component_join},reference_report_sha256:FINAL12.reference_report_sha256,reference_owner_handoff_sha256:FINAL12.reference_owner_handoff_sha256,restoration_source_archive:{...RESTORATION_SOURCE},
    files:Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,body])=>[name,{bytes:body.length,sha256:hash(body)}])),
    official_firmware_included:false,compiled_outputs_included:false,compiler_binaries_included:false,hardware_captures_included:false,source_promotion_authorized:false,publication_performed:false,...QUALIFICATION};
  files.set('SOURCE_PACKAGE.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));const body=zip(files);await writeFile(output,body,{flag:'wx'});
  return {schema:manifest.schema,recipe:FINAL12.recipe,archive:{bytes:body.length,sha256:hash(body)},members:files.size,official_firmware_included:false,compiled_outputs_included:false,publication_performed:false,...QUALIFICATION};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{need(process.argv.length===4&&process.argv[2]==='--output','Use --output NEW_PRIVATE_SOURCE_KIT.zip.');console.log(JSON.stringify(await packageSource(process.argv[3]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
