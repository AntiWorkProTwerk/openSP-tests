import {resolve,posix} from 'node:path';
import {FINAL13,P6S,QUALIFICATION} from './pins.mjs';
import {checkedCompactArchive} from './source.mjs';
import {hash,crc32,need,json,same,namesAt,rootedReader,checkedOfficialInput,imageMetadata} from './common.mjs';

const digest=raw=>hash(raw);
const reportHolds=['actual_native_route_qualified','runtime_budget_qualified','hardware_qualified','software_eligible_for_owner_test','public_release_eligible','release_ready','delivery_enabled','upload_enabled','browser_enabled','public_ready'];
const unsigned=number=>(number>>>0).toString(16).toUpperCase().padStart(8,'0');

function elf(raw){
  need(raw.length>=52&&raw.subarray(0,7).equals(Buffer.from([0x7f,69,76,70,1,1,1]))&&raw.readUInt16LE(18)===40,'Expected an ELF32 ARM module.');
  const at=raw.readUInt32LE(32),stride=raw.readUInt16LE(46),count=raw.readUInt16LE(48),stringsIndex=raw.readUInt16LE(50);
  need(stride===40&&count>0&&stringsIndex<count&&at+count*stride<=raw.length,'ELF section table differs.');
  const rows=[];for(let i=0;i<count;i++){const row=[];for(let j=0;j<10;j++)row.push(raw.readUInt32LE(at+i*stride+j*4));rows.push(row);}
  const slice=row=>{need(row[4]+row[5]<=raw.length,'ELF section extent differs.');return raw.subarray(row[4],row[4]+row[5]);};
  const string=(table,offset)=>{need(offset<table.length,'ELF string offset differs.');const end=table.indexOf(0,offset);need(end>=0,'ELF string terminator differs.');return table.subarray(offset,end).toString('utf8');};
  const names=slice(rows[stringsIndex]),sections={},symbols={},undefinedSymbols=[];
  for(const row of rows.slice(1)){const name=string(names,row[0]);need(!Object.hasOwn(sections,name),'Duplicate ELF section.');const payload=row[1]===8?Buffer.alloc(0):slice(row);sections[name]={type:row[1],flags:row[2],address:row[3],size:row[5],payload};}
  for(const row of rows){if(row[1]!==2)continue;need(row[6]<rows.length&&row[5]%16===0,'ELF symbol table differs.');const table=slice(row),names=slice(rows[row[6]]);
    for(let pos=0;pos<table.length;pos+=16){const name=string(names,table.readUInt32LE(pos)),section=table.readUInt16LE(pos+14),type=table[pos+12]&15;if(!name)continue;
      if(section)symbols[name]=[table.readUInt32LE(pos+4),table.readUInt32LE(pos+8),type];else undefinedSymbols.push(name);
    }
  }
  return {sections,symbols,undefinedSymbols};
}

function replayCandidate(source,module,tail,hook,symbols){
  need(source.length===2652672&&tail.length===17412&&hook.length===4,'APP1 component extents differ.');
  const image=Buffer.alloc(0x290000+module.length,0xff);source.copy(image);hook.copy(image,0);image.write(FINAL13.identity+'\0',0x160560,'ascii');tail.copy(image,0x288000);module.copy(image,0x290000);
  const header=0x288200;image.writeUInt32LE(2,header+8);image.writeUInt32LE(image.length-0x288000,header+12);
  need(symbols.__data_start&&symbols.__data_end,'B2 ELF lacks its data symbols.');
  const values=[0x32425053,tail.length,symbols.__data_start[0],symbols.__data_end[0]-symbols.__data_start[0],0x290000-0x288000,module.length,0,0];
  values.forEach((value,index)=>image.writeUInt32LE(value,header+32+4*index));return image;
}

export function checkCompactReport(report){
  need(report.schema==='opensp-priority1-compact-candidate-build-v1'&&report.status==='PASS_SOURCE_PACKAGE_ONLY'&&report.identity===FINAL13.identity&&report.policy_id===FINAL13.policy_id,'Compact build report profile differs.');
  need(reportHolds.every(key=>report[key]===false)&&report.delivery==='DO_NOT_DELIVER','Compact build report promotes qualification or delivery.');
  need(report.authority_sha256===FINAL13.authority_sha256&&report.source_contract_sha256===FINAL13.source_contract_sha256&&report.compile_units===FINAL13.compile_units&&report.native_patches===FINAL13.native_patches&&same(report.features,FINAL13.features),'Compact report source/configuration binding differs.');
  need(same(report.component_join,FINAL13.component_join),'Compact report component joins or qualification differ.');
  need(report.candidate_sha256===FINAL13.candidate.sha256&&report.candidate_bytes===FINAL13.candidate.bytes&&report.candidate_crc32===unsigned(FINAL13.candidate.crc32)&&report.module_sha256===FINAL13.module_sha256&&report.recipe_sha256===FINAL13.recipe_sha256&&report.source_APP1_sha256===FINAL13.source_app1_sha256,'Compact report artifact identities differ.');
  need(report.file_header_sha256===FINAL13.file_header_sha256&&report.restoration_sha256===P6S.sha256&&report.restoration_bytes===P6S.bytes&&report.restoration_crc32===unsigned(P6S.crc32)&&report.restoration_freshly_compiled===false,'Compact FILE ABI or restoration binding differs.');
  need(report.toolchain_pinned_files===1874&&report.python_role?.version==='3.12.14'&&['isolated','site_disabled','bytecode_disabled','role_bound'].every(key=>report.python_role[key]===true)&&report.python_role.stdlib_and_os_reads_traced===false&&report.historical_binaries_read===false&&report.captured_RAM_read===false,'Compact report dependency/read scope differs.');
}

/** Byte/source inspection is separate from fresh execution, runtime and hardware qualification. */
export async function inspectCompactBuild(build,{sourceArchiveRaw,officialRaw,restorationRaw}){
  const admitted=checkedCompactArchive(sourceArchiveRaw),official=checkedOfficialInput(officialRaw),reader=await rootedReader(build),{plan}=admitted;
  need(restorationRaw.length===P6S.bytes&&hash(restorationRaw)===P6S.sha256&&crc32(restorationRaw)===P6S.crc32,'Supply exact authentic P6S restoration bytes.');
  const reportRaw=await reader.bytes('REPORT.json'),report=json(reportRaw);checkCompactReport(report);
  need(report.official_kind===(official.kind==='official-v552-zip'?'official-zip':'official-app1'),'Compact report official input kind differs.');
  const candidate=await reader.bytes('candidate.disabled.bin'),module=await reader.bytes('module/module.bin'),moduleElf=await reader.bytes('module/module.elf');
  need(candidate.length===report.candidate_bytes&&hash(candidate)===report.candidate_sha256&&unsigned(crc32(candidate))===report.candidate_crc32&&candidate.subarray(0x160560,0x16056d).equals(Buffer.from('openSynth N1\0')),'Compact candidate bytes, CRC or Utility identity differ.');
  need(module.length===report.xip_bytes&&hash(module)===report.module_sha256&&hash(moduleElf)===report.module_elf_sha256&&hash(moduleElf)===FINAL13.module_elf_sha256,'Compact module ELF/BIN differ from admitted identity or report.');
  const parsed=elf(moduleElf),map=json(await reader.bytes('module/ELF_MAP.json'));
  need(same(map.symbols,parsed.symbols)&&same(map.sections,Object.fromEntries(Object.entries(parsed.sections).map(([name,{payload,...row}])=>[name,row])))&&parsed.undefinedSymbols.length===0,'Compact source-only ELF map or unresolved symbols differ.');
  const symbols=parsed.symbols,start=symbols.__synth_bss_start?.[0],end=symbols.__synth_bss_end?.[0];
  need(start===0x83832310&&end<=0x8383a30c&&start===report.bss_begin&&end===report.bss_end&&0x8383a30c-end===report.bss_spare&&symbols.__synth_image_end?.[0]===0x60310000+module.length&&!parsed.sections['.forbidden']?.size&&!parsed.sections['.data']?.size,'Compact linker boundaries differ.');
  for(const [name,size] of [['sp_p6_record_files_v552',plan.file_owner_bytes],['sp_p6_production_capture',1336],['sp_p6_production_session',3824]])need(symbols[name]?.[1]===size,`Compact owner extent differs: ${name}.`);
  need(!symbols.sp_global_v552_owner&&!symbols.sp_p6_full_audio_mix&&!symbols.sp_synth_factory_bank,'Compact build retains unselected owners.');
  const expectedModule=Buffer.alloc(module.length,0);
  for(const name of plan.xip_sections){const section=parsed.sections[name];if(!section||!section.size)continue;need(section.address>=0x60310000&&section.address+section.size<=0x60310000+module.length&&section.type!==8,'Compact loaded section exceeds module bounds.');section.payload.copy(expectedModule,section.address-0x60310000);}
  need(expectedModule.equals(module),'Compact ELF loaded sections differ from module BIN.');
  const sourceNames=await namesAt(resolve(reader.root,'module/source'));need(same(sourceNames,Object.keys(plan.inputs).sort()),'Compact copied source namespace differs.');
  for(const [name,pin] of Object.entries(plan.inputs))need(hash(await reader.bytes('module/source/'+name))===pin,`Compact copied source changed: ${name}.`);
  const ledger=json(await reader.bytes('module/compiler-ledger.json')),objectNames=Object.keys(ledger.objects??{}).sort(),expectedObjects=Array.from({length:FINAL13.compile_units},(_,index)=>`unit-${String(index).padStart(3,'0')}.o`);
  need(ledger.compile_units===FINAL13.compile_units&&same(objectNames,expectedObjects)&&ledger.commands.length===FINAL13.compile_units+2&&ledger.assembly_stack_receipts_not_emitted_by_gcc===true&&same(ledger.undefined_symbols,[]),'Compact object/compiler ledger differs.');
  const link=ledger.commands[FINAL13.compile_units],objcopy=ledger.commands[FINAL13.compile_units+1];
  need(link.returncode===0&&link.command?.[0]?.endsWith('arm-none-eabi-gcc.exe')&&same(link.command.slice(1),plan.link_command)&&objcopy.returncode===0&&objcopy.command?.[0]?.endsWith('arm-none-eabi-objcopy.exe')&&same(objcopy.command.slice(1),['-O','binary',...plan.xip_sections.flatMap(name=>['-j',name]),'module.elf','module.bin']),'Compact link or objcopy command differs from admitted plan.');
  const dependencies={},consumers=[];let reused=0,observedCommands=0;
  for(let index=0;index<FINAL13.compile_units;index++){
    const unit=String(index).padStart(3,'0'),body=await reader.bytes(`module/objects/unit-${unit}.o`);need(hash(body)===ledger.objects[`unit-${unit}.o`],`Compact object differs: ${unit}.`);
    const row=ledger.commands[index],command=row.command;
    if(row.kind==='AUTHENTICATED_CURRENT_TRANSACTION_UNIT_REUSE'){
      need(row.unit===index&&row.new_tool_call===false&&same(command,plan.compile_commands[index]),'Current-transaction unit reuse differs from the admitted compile plan.');reused++;
      for(const [name,pin] of Object.entries(row.input_sha256))need(hash(await reader.bytes('module/'+name))===pin,'Current-transaction reused compiler input differs.');
    }else{
      need(row.returncode===0&&command?.[0]?.endsWith('arm-none-eabi-gcc.exe')&&command[1].startsWith('-Wa,-I,')&&same(command.slice(2),plan.compile_commands[index]),'Compact successful compiler command differs from the fixed plan.');observedCommands++;
    }
    const text=(await reader.bytes(`module/dependencies/unit-${unit}.d`)).toString('utf8').replace(/\\\r?\n/g,' '),separator=text.indexOf(':');need(separator>0,'Compact compiler dependency receipt differs.');let fileConsumer=false;
    for(const label of text.slice(separator+1).trim().split(/\s+/)){
      need(label.startsWith('source/')&&!label.includes('\\'),'Compiler dependency escaped the declared source role.');const name=posix.normalize(label.slice(7));need(name!=='.'&&name!=='..'&&!name.startsWith('../')&&!posix.isAbsolute(name),'Compiler dependency escaped the declared source role.');const pin=plan.inputs[name];need(pin,'Undeclared compiler project dependency.');dependencies[name]=pin;
      if(name.endsWith('/sp_p6_record_files_v552.h')){need(pin===FINAL13.file_header_sha256,'Actual FILE consumer uses another ABI.');fileConsumer=true;}
    }
    if(fileConsumer)consumers.push(index);
  }
  need(same(Object.entries(dependencies).sort(),Object.entries(ledger.actual_dependency_inputs).sort())&&same(consumers,ledger.file_abi_consumers)&&same(consumers,report.actual_file_abi_consumers),'Actual compiler dependency or FILE consumer ledger differs.');
  for(const [name,pin] of Object.entries(ledger.stack_receipts))need(hash(await reader.bytes('module/objects/'+name))===pin,'Compact stack receipt changed.');
  const objectEntries=await namesAt(resolve(reader.root,'module/objects'));need(same(objectEntries,[...objectNames,...Object.keys(ledger.stack_receipts)].sort()),'Compact object/stack namespace differs.');
  const baseline=await reader.bytes('r3/baseline-r3.disabled.bin'),source=await reader.bytes('source_APP1.private.bin'),recipeRaw=await reader.bytes('recipe.json'),tail=await reader.bytes('b2/tail.bin'),hook=await reader.bytes('b2/hook.bin');
  need(hash(baseline)===FINAL13.r3_sha256&&hash(source)===FINAL13.source_app1_sha256&&hash(recipeRaw)===FINAL13.recipe_sha256&&hash(tail)===FINAL13.b2_tail_sha256&&hash(hook)===FINAL13.b2_hook_sha256,'Compact R3, native recipe or B2 components differ.');
  const recipe=json(recipeRaw);
  need(recipe.schema==='opensp-priority1-derived-native-recipe-v1'&&recipe.patches.length===FINAL13.native_patches,'Compact native recipe shape differs.');
  const replay=Buffer.from(baseline),ordered=[...recipe.patches].sort((a,b)=>a.file_offset-b.file_offset);let previousEnd=0;
  for(const row of ordered){const before=Buffer.from(row.before,'hex'),after=Buffer.from(row.after,'hex');need(before.length===after.length&&after.length>0&&row.file_offset>=previousEnd&&row.file_offset+after.length<=replay.length&&baseline.subarray(row.file_offset,row.file_offset+before.length).equals(before),'Compact native recipe preimage or interval differs.');after.copy(replay,row.file_offset);previousEnd=row.file_offset+after.length;}
  need(replay.equals(source)&&replayCandidate(source,module,tail,hook,elf(await reader.bytes('b2/usb_bridge_b2.elf')).symbols).equals(candidate),'Compact native-source or complete candidate replay differs.');
  const boundaryRaw=await reader.bytes('READ_BOUNDARY.json'),boundary=json(boundaryRaw);
  need(boundary.compiler_internal_reads_traced===false&&boundary.os_and_stdlib_reads_attested===false&&boundary.prehook_imports_traced===false&&boundary.input_and_output_labels.every(value=>/^(?:output\/|source-kit\/|pinned-tool\/|python-runtime\/|owner-official$|reviewed-python-launcher$)/.test(value))&&boundary.explicit_tool_calls.every(value=>['bin/arm-none-eabi-gcc.exe','bin/arm-none-eabi-objcopy.exe'].includes(value)),'Compact read boundary differs or overstates its scope.');
  need((await reader.bytes('REPORT.json')).equals(reportRaw)&&hash(await reader.bytes('candidate.disabled.bin'))===FINAL13.candidate.sha256,'Compact report or candidate changed during inspection.');
  const candidateInfo=imageMetadata(candidate,FINAL13.identity),restorationInfo=imageMetadata(restorationRaw,P6S.identity);need(candidateInfo.padded_bytes===report.padded_bytes,'Compact padded extent differs.');
  return {schema:'opensp-compact-local-inspection-v1',status:'PASS_COMPACT_SOURCE_AND_BYTE_REPLAY_RELEASE_HELD',recipe:FINAL13.recipe,
    authority_sha256:FINAL13.authority_sha256,entry_sha256:FINAL13.entry_sha256,source_archive:{...FINAL13.archive},source_contract_sha256:FINAL13.source_contract_sha256,
    official_input:official,report_sha256:hash(reportRaw),recipe_sha256:hash(recipeRaw),read_boundary_sha256:hash(boundaryRaw),
    candidate:{path:'candidate.disabled.bin',...candidateInfo},restoration:{...restorationInfo,source_recompiled_in_compact_transaction:false},
    module_source_files_checked:sourceNames.length,objects_checked:objectNames.length,native_patches_replayed:recipe.patches.length,
    current_transaction_reuse_rows:reused,successful_compile_command_rows:observedCommands,fresh_compile_execution_attested:false,
    pattern_join:true,metronome_join:true,component_join:{...FINAL13.component_join},source_and_artifact_verified:true,writer_authority_granted:false,...QUALIFICATION};
}
