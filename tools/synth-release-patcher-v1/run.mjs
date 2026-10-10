import {readFile,writeFile,mkdir,realpath,access} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStandalone,checkedSourceArchive} from '../feature-picker-release-v1/standalone-build.mjs';
import {checkedOfficialInput} from './official.mjs';
import {canonicalSelectionBytes,checkFixedSynthSelection,inspectStandaloneForPatcher} from './handoff.mjs';

const here=dirname(fileURLToPath(import.meta.url)),website=resolve(here,'../..');
const archive=resolve(here,'../feature-picker-release-v1/standalone-source-bundle.zip');
const need=(value,why)=>{if(!value)throw Error(why);};
const inside=(root,path)=>{const value=relative(root,path);return value===''||(!value.startsWith('..')&&!isAbsolute(value));};
const exists=async path=>{try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const save=(path,body)=>writeFile(path,JSON.stringify(body,null,2)+'\n',{flag:'wx'});

export function parseArgs(args) {
  const options={},allowed=['mode','selection','official','python','toolchain-root','build','output'];
  for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),`Invalid patcher argument ${args[i]??''}.`);need(!Object.hasOwn(options,key),`Duplicate --${key}.`);options[key]=args[i+1];}
  const modes={selection:['output'],'source16-build':['selection','official','python','toolchain-root','output'],'restoration-inspect':['official','build','output']};
  need(Object.hasOwn(modes,options.mode),'Choose selection, source16-build or restoration-inspect. The compact recording recipe is awaiting sealed source admission.');
  const required=modes[options.mode];need(required.every(key=>options[key]),`Supply ${required.map(key=>'--'+key).join(', ')} for ${options.mode}.`);
  need(Object.keys(options).every(key=>key==='mode'||required.includes(key)),'This patcher mode contains unrelated arguments.');
  return options;
}

async function checkedOutput(path) {
  const requested=resolve(path),parent=await realpath(dirname(requested)),output=resolve(parent,requested.split(/[\\/]/).at(-1));
  need(!inside(website,output),'Patcher outputs must remain outside the website repository.');
  need(!await exists(output),'Use a new patcher output; completed and failed evidence is preserved.');
  return output;
}

export async function runPatcher(options,{execute}={}) {
  options=parseArgs(Object.entries(options).flatMap(([key,value])=>[`--${key}`,String(value)]));
  const output=await checkedOutput(options.output);
  if(options.mode==='selection'){
    const raw=canonicalSelectionBytes();await writeFile(output,raw,{flag:'wx'});
    return {schema:'opensp-fixed-synth-selection-export-v1',status:'EXPORTED',selection_bytes:raw.length,compact_recording_candidate_admitted:false,device_operations:false};
  }
  const official=await realpath(resolve(options.official));need(!inside(website,official),'Official firmware must remain outside the website repository.');
  checkedOfficialInput(await readFile(official));checkedSourceArchive(await readFile(archive));
  let build;
  if(options.mode==='source16-build'){
    const selection=await realpath(resolve(options.selection));checkFixedSynthSelection(await readFile(selection));
    const python=await realpath(resolve(options.python)),tools=await realpath(resolve(options['toolchain-root']));
    need(![official,selection,python,tools].some(path=>inside(output,path)),'Output would contain source, tool or input authority.');
    await mkdir(output);
    try{
      await buildStandalone({'source-archive':archive,python,'toolchain-root':tools,selection,official,output:resolve(output,'transaction')},{execute});
      build=resolve(output,'transaction/build');
    }catch(error){
      await save(resolve(output,'PATCHER_REFUSAL.json'),{schema:'opensp-synth-local-patcher-refusal-v1',status:'REFUSED',reason:error.message,recipe:'historical-standalone-source16-v1',candidate_accepted:false,compact_recording_candidate_admitted:false,release_ready:false,browser_upload_enabled:false,device_operations:false,delivery:'DO_NOT_DELIVER'});
      throw error;
    }
  }else{
    build=await realpath(resolve(options.build));need(!inside(output,build)&&!inside(build,output)&&!inside(website,build),'Inspection output and private build must be separate from each other and website assets.');
  }
  try{
    const handoff=await inspectStandaloneForPatcher(build,{sourceArchive:archive,official});
    if(options.mode==='restoration-inspect')await mkdir(output);
    await save(resolve(output,'PATCHER_HANDOFF.json'),handoff);
    return {schema:handoff.schema,status:handoff.status,candidate:handoff.candidate,restoration:handoff.restoration,compact_recording_candidate_admitted:false,release_ready:false,browser_upload_enabled:false,device_operations:false,delivery:'DO_NOT_DELIVER'};
  }catch(error){
    if(options.mode==='source16-build')await save(resolve(output,'PATCHER_REFUSAL.json'),{schema:'opensp-synth-local-patcher-refusal-v1',status:'REFUSED',reason:error.message,candidate_accepted:false,release_ready:false,browser_upload_enabled:false,device_operations:false,delivery:'DO_NOT_DELIVER'});
    throw error;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')==='--help')console.log('node --import ./tools/register-test-typescript.mjs tools/synth-release-patcher-v1/run.mjs --mode selection --output NEW_SELECTION.json\n--mode source16-build --selection FIXED_SELECTION.json --official OWNER_V552 --python PINNED_PYTHON.exe --toolchain-root PINNED_ARM_ROOT --output NEW_PRIVATE_OUTPUT\n--mode restoration-inspect --official OWNER_V552 --build EXISTING_STANDALONE_TRANSACTION_BUILD --output NEW_PRIVATE_OUTPUT');
  else try{console.log(JSON.stringify(await runPatcher(parseArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
