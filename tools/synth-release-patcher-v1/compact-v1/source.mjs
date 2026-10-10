import {inflateRawSync} from 'node:zlib';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CORE09,QUALIFICATION} from './pins.mjs';
import {hash,need,json,same,namesAt,rootedReader} from './common.mjs';

/** The caller supplies bytes, never an authority digest or source inventory. */
export function checkedCompactArchive(raw){
  need(raw.length===CORE09.archive.bytes&&hash(raw)===CORE09.archive.sha256,'The compact source archive has no code-owned core09 admission.');
  const end=raw.length-22;need(raw.readUInt32LE(end)===0x06054b50&&raw.readUInt16LE(end+20)===0,'Compact source ZIP end differs.');
  const count=raw.readUInt16LE(end+10),central=raw.readUInt32LE(end+16),size=raw.readUInt32LE(end+12);
  need(count===CORE09.source_members&&raw.readUInt16LE(end+4)===0&&raw.readUInt16LE(end+6)===0&&raw.readUInt16LE(end+8)===count&&central+size===end,'Compact source ZIP layout differs.');
  const members=new Map();let at=central;
  for(let index=0;index<count;index++){
    need(at+46<=end&&raw.readUInt32LE(at)===0x02014b50,'Compact ZIP directory differs.');
    const flags=raw.readUInt16LE(at+8),method=raw.readUInt16LE(at+10),packed=raw.readUInt32LE(at+20),length=raw.readUInt32LE(at+24),namesize=raw.readUInt16LE(at+28),extra=raw.readUInt16LE(at+30),comment=raw.readUInt16LE(at+32),offset=raw.readUInt32LE(at+42),mode=raw.readUInt32LE(at+38)>>>16;
    need(at+46+namesize+extra+comment<=end,'Compact source name extent differs.');
    const name=raw.subarray(at+46,at+46+namesize).toString('utf8');
    need(/^[A-Za-z0-9_.\/-]+$/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!members.has(name)&&(mode&0xf000)===0x8000&&flags===0&&[0,8].includes(method)&&length<=2*1024*1024,'Compact source member path, type or extent differs.');
    need(offset+30<=central&&raw.readUInt32LE(offset)===0x04034b50&&raw.readUInt16LE(offset+6)===flags&&raw.readUInt16LE(offset+8)===method,'Compact source local header differs.');
    const localName=raw.readUInt16LE(offset+26),localExtra=raw.readUInt16LE(offset+28),start=offset+30+localName+localExtra;
    need(raw.subarray(offset+30,offset+30+localName).toString('utf8')===name&&start+packed<=central,'Compact source local extent differs.');
    const encoded=raw.subarray(start,start+packed),body=method===8?inflateRawSync(encoded,{maxOutputLength:2*1024*1024}):encoded;
    need(body.length===length,'Compact source member size differs.');members.set(name,body);at+=46+namesize+extra+comment;
  }
  need(at===end&&hash(members.get('BUILD_AUTHORITY.json'))===CORE09.authority_sha256&&hash(members.get('build_candidate.py'))===CORE09.entry_sha256,'Compact source authority or entry differs.');
  const authority=json(members.get('BUILD_AUTHORITY.json'));
  need(authority.schema==='opensp-priority1-compact-build-authority-v1'&&authority.version===1&&authority.authoring_preparation_only===true&&authority.software_eligible_for_owner_test===false&&authority.public_release_eligible===false&&authority.release_ready===false&&authority.hardware_qualified===false&&authority.delivery==='DO_NOT_DELIVER','Compact source authority promotes qualification.');
  need(same([...members.keys()].sort(),[...Object.keys(authority.files),'BUILD_AUTHORITY.json','build_candidate.py'].sort()),'Compact source namespace differs.');
  for(const [name,pin] of Object.entries(authority.files)){const body=members.get(name);need(body.length===pin.bytes&&hash(body)===pin.sha256,`Compact source input differs: ${name}.`);}
  need(hash(members.get('TOOLCHAIN_AUTHORITY.json'))===CORE09.toolchain_authority_sha256&&authority.toolchain_authority_sha256===CORE09.toolchain_authority_sha256,'Compact compiler authority differs.');
  const plan=json(members.get('inputs/module-plan.json'));
  need(hash(members.get('inputs/module-plan.json'))===CORE09.source_contract_sha256&&authority.source_contract_sha256===CORE09.source_contract_sha256,'Compact source contract differs.');
  need(plan.schema==='opensp-priority1-p6s-record-source-contract-v1'&&plan.identity===CORE09.identity&&plan.policy_id===CORE09.policy_id&&plan.compile_commands.length===CORE09.compile_units&&Object.keys(plan.inputs).length===CORE09.module_source_files&&plan.native_intervals.length===CORE09.native_intervals,'Compact fixed profile differs.');
  need(same(plan.features,{synth:true,record_to_pad:true,global_usb:false,expanded128:false})&&plan.direct_flow_contract&&plan.capture_contract?.maximum_frames===5760000&&plan.capture_contract.source_implemented_maximum_seconds===120&&plan.voices===4&&plan.factory_sounds===16&&plan.release_ready===false&&plan.hardware_qualified===false&&plan.delivery===QUALIFICATION.delivery,'Compact direct capture/profile contract differs.');
  need(members.get('LICENSE').includes('AntiWorkProTwerk')&&members.get('NOTICE').includes("Roland's official firmware"),'Compact source attribution or vendor exclusions differ.');
  need([...members.keys()].every(name=>!/(?:\.(?:exe|dll|bin|elf|o|a|wasm)|candidate|REPORT\.json)$/i.test(name)),'Compiled or firmware output appears in the source archive.');
  return {members,authority,plan};
}

export async function materializeSource(root,admitted){
  await mkdir(root);
  for(const [name,body] of admitted.members){const target=resolve(root,name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,body,{flag:'wx'});}
  await checkMaterializedSource(root,admitted);
}

export async function checkMaterializedSource(root,admitted){
  const reader=await rootedReader(root);need(same(await namesAt(reader.root),[...admitted.members.keys()].sort()),'Materialized compact source namespace differs.');
  for(const [name,body] of admitted.members)need((await reader.bytes(name)).equals(body),`Materialized compact source changed: ${name}.`);
}
