import {readFile,writeFile,mkdir,realpath,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {CORE09,P6S,QUALIFICATION} from './pins.mjs';
import {checkedCompactArchive,materializeSource,checkMaterializedSource} from './source.mjs';
import {inspectCompactBuild} from './inspect.mjs';
import {inspectCompactHandoff} from './handoff.mjs';
import {checkedOfficialInput,hash,need,json,same,inside} from './common.mjs';

const website=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const exists=async path=>{try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});

export function parseArgs(args){
  const options={},allowed=['mode','source-archive','official','restoration','python','toolchain-root','build','output'];
  for(let index=0;index<args.length;index+=2){const key=args[index]?.slice(2);need(args[index]?.startsWith('--')&&allowed.includes(key)&&args[index+1]&&!args[index+1].startsWith('--'),`Invalid compact patcher argument ${args[index]??''}.`);need(!Object.hasOwn(options,key),`Duplicate --${key}.`);options[key]=args[index+1];}
  const required={build:['source-archive','official','restoration','python','toolchain-root','output'],inspect:['source-archive','official','restoration','build','output']};
  need(Object.hasOwn(required,options.mode),'Use compact mode build or inspect.');
  need(required[options.mode].every(key=>options[key]),`Supply ${required[options.mode].map(key=>'--'+key).join(', ')}.`);
  need(Object.keys(options).every(key=>key==='mode'||required[options.mode].includes(key)),'Compact mode contains unrelated arguments.');return options;
}

export function compilerArguments(source,official,tools,output){
  return ['-I','-S','-B',resolve(source,'build_candidate.py'),'--inputs',resolve(source,'inputs'),'--official',official,'--tool-prefix',resolve(tools,'bin','arm-none-eabi-'),'--output',output];
}

export function invokeCompiler(python,args,{cwd,env},execute=spawnSync){
  return execute(python,args,{cwd,env,encoding:'utf8',shell:false,windowsHide:true,maxBuffer:24*1024*1024});
}

async function outputPath(value){
  const requested=resolve(value),parent=await realpath(dirname(requested)),output=resolve(parent,requested.split(/[\\/]/).at(-1));
  need(!inside(website,output),'Compact outputs must remain outside the website repository.');need(!await exists(output),'Use a new compact output; old success and failure evidence is preserved.');return output;
}

export async function runCompactPatcher(options,{execute=spawnSync}={}){
  options=parseArgs(Object.entries(options).flatMap(([key,value])=>[`--${key}`,String(value)]));
  const archive=await realpath(resolve(options['source-archive'])),official=await realpath(resolve(options.official)),restoration=await realpath(resolve(options.restoration)),output=await outputPath(options.output);
  need(!inside(website,official)&&!inside(website,restoration),'Firmware inputs must stay outside the website repository.');
  const sourceArchiveRaw=await readFile(archive),admitted=checkedCompactArchive(sourceArchiveRaw),officialRaw=await readFile(official),officialPin=checkedOfficialInput(officialRaw),restorationRaw=await readFile(restoration);
  need(restorationRaw.length===P6S.bytes&&hash(restorationRaw)===P6S.sha256,'Supply exact authentic P6S restoration bytes.');
  need(![archive,official,restoration].some(path=>inside(output,path)),'Output would contain an input authority.');
  let build,source,childCompleted=false;
  if(options.mode==='build'){
    const python=await realpath(resolve(options.python)),tools=await realpath(resolve(options['toolchain-root']));
    need(admitted.authority.python_role.launcher_sha256.includes(hash(await readFile(python))),'Python launcher has no reviewed compact binary role.');
    need(![python,tools].some(path=>inside(output,path)),'Output would contain compiler or Python authority.');
    source=resolve(output,'source-kit');build=resolve(output,'build');
    await mkdir(output);await materializeSource(source,admitted);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase())));
    env.PATH=resolve(tools,'bin')+';'+resolve(process.env.SystemRoot??process.env.SYSTEMROOT,'System32');
    const argumentsList=compilerArguments(source,official,tools,build);
    let child;
    try{
      child=invokeCompiler(python,argumentsList,{cwd:source,env},execute);
      await writeFile(resolve(output,'compiler.stdout.log'),child.stdout??'',{flag:'wx'});await writeFile(resolve(output,'compiler.stderr.log'),child.stderr??'',{flag:'wx'});
      need(!child.error&&child.status===0,`Compact source entry refused (exit ${child.status??'unknown'}). Inspect local compiler logs.`);
      const stdout=json(Buffer.from(child.stdout??'')),saved=json(await readFile(resolve(build,'REPORT.json')));need(same(stdout,saved),'Compact child stdout differs from its saved build report.');
      childCompleted=true;
    }catch(error){
      await save(resolve(output,'COMPACT_REFUSAL.json'),{schema:'opensp-compact-local-refusal-v1',status:'REFUSED',recipe:CORE09.recipe,reason:error.message,source_archive_sha256:CORE09.archive.sha256,entry_sha256:CORE09.entry_sha256,child_invoked:true,child_exit_status:child?.status??null,compiler_calls:null,canonical_entry_completed:false,candidate_accepted:false,...QUALIFICATION});throw error;
    }
  }else{
    build=await realpath(resolve(options.build));need(!inside(website,build)&&!inside(output,build)&&!inside(build,output),'Private build and inspection output must be separate from each other and website assets.');
  }
  try{
    const inspection=await inspectCompactBuild(build,{sourceArchiveRaw,officialRaw,restorationRaw});
    if(childCompleted){
      need(inspection.current_transaction_reuse_rows===0&&inspection.successful_compile_command_rows===CORE09.compile_units,'Canonical source entry did not provide 105 fresh successful compiler command rows.');
      await checkMaterializedSource(source,admitted);
    }
    need((await readFile(archive)).equals(sourceArchiveRaw)&&(await readFile(official)).equals(officialRaw)&&(await readFile(restoration)).equals(restorationRaw),'Compact source, official or restoration input changed during execution or inspection.');
    if(options.mode==='inspect')await mkdir(output);
    const handoff={schema:'opensp-compact-local-handoff-v1',version:1,recipe:CORE09.recipe,identity:CORE09.identity,
      source_archive:{...CORE09.archive},entry_sha256:CORE09.entry_sha256,source_contract_sha256:CORE09.source_contract_sha256,
      official_input:officialPin,candidate:inspection.candidate,restoration:inspection.restoration,
      build_report_sha256:inspection.report_sha256,native_recipe_sha256:inspection.recipe_sha256,
      canonical_entry_completed:childCompleted,source_recompiled_in_this_patcher:childCompleted,
      compilation_observation:childCompleted?'105_SUCCESSFUL_CURRENT_CHILD_COMMAND_ROWS':'RETAINED_CURRENT_TRANSACTION_REUSE',
      fresh_compile_execution_attested:childCompleted,restoration_freshly_compiled:false,
      pattern_join:false,metronome_join:false,source_and_artifact_verified:true,writer_authority_granted:false,...QUALIFICATION};
    inspectCompactHandoff(Buffer.from(JSON.stringify(handoff)),await readFile(resolve(build,'candidate.disabled.bin')),restorationRaw);
    await save(resolve(output,'COMPACT_INSPECTION.json'),inspection);await save(resolve(output,'COMPACT_HANDOFF.json'),handoff);
    await save(resolve(output,'COMPACT_INPUT_BINDING.json'),{schema:'opensp-compact-local-input-binding-v1',source_archive_sha256:CORE09.archive.sha256,entry_sha256:CORE09.entry_sha256,official_input_sha256:officialPin.sha256,restoration_sha256:P6S.sha256,inspection_sha256:hash(await readFile(resolve(output,'COMPACT_INSPECTION.json'))),handoff_sha256:hash(await readFile(resolve(output,'COMPACT_HANDOFF.json'))),canonical_entry_completed:childCompleted,...QUALIFICATION});
    return {schema:handoff.schema,status:inspection.status,recipe:CORE09.recipe,identity:CORE09.identity,candidate:handoff.candidate,restoration:handoff.restoration,canonical_entry_completed:childCompleted,...QUALIFICATION};
  }catch(error){
    if(options.mode==='build')await save(resolve(output,'COMPACT_REFUSAL.json'),{schema:'opensp-compact-local-refusal-v1',status:'REFUSED',recipe:CORE09.recipe,reason:error.message,child_invoked:true,canonical_entry_completed:childCompleted,candidate_accepted:false,...QUALIFICATION});throw error;
  }
}
