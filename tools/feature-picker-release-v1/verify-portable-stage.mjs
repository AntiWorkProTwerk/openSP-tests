import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {stagePortable,parsePortableArgs,checkedPortableCatalog} from './portable-stage.mjs';

// All private paths are supplied; this source carries no retained-machine paths.
const base=parsePortableArgs(process.argv.slice(2)),root=resolve(base['private-root']);
const {catalog}=await checkedPortableCatalog(root,base['dependency-catalog'],base['dependency-catalog-sha']);
const out=resolve(base['stage-root'],base.run+'-review');await mkdir(out,{recursive:false});
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const positives=[];
for(const [profile,row] of Object.entries(catalog.profiles)){
  const result=await stagePortable({...base,profile,'kit-root':resolve(root,row.kit_root),family:resolve(root,row.family.path),
    'family-sha':row.family.sha256,'anchor-sha':row.anchor.sha256,run:base.run+'-'+profile});
  const inspection=JSON.parse(await readFile(resolve(result.output,'WEBSITE_INSPECTION.json'),'utf8'));
  assert.equal(inspection.valid,true);assert.equal(inspection.matchesSelection,true);
  for(const name of ['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'])assert.equal(inspection[name],false);
  const candidate=await readFile(resolve(result.output,'stage/candidate.disabled.bin'));
  assert.equal(hash(candidate),row.candidate.sha256);assert.equal(candidate.length,row.candidate.bytes);
  positives.push({profile,status:result.status,candidate_sha256:hash(candidate),
    stage_report_path:relative(root,resolve(result.output,'STAGE_REPORT.json')).replaceAll('\\','/'),
    stage_report_sha256:hash(await readFile(resolve(result.output,'STAGE_REPORT.json')))});
}
const row=catalog.profiles.combined;
const actual={...base,profile:'combined','kit-root':resolve(root,row.kit_root),family:resolve(root,row.family.path),
  'family-sha':row.family.sha256,'anchor-sha':row.anchor.sha256};
const outsideOfficial=resolve(out,'wrong-official.bin');await writeFile(outsideOfficial,Buffer.from('owned invalid official fixture'),{flag:'wx'});
const copiedFamily=resolve(out,'copied-family.json');await writeFile(copiedFamily,await readFile(actual.family),{flag:'wx'});
const forgedCatalog=resolve(out,'forged-catalog.json');await write(forgedCatalog,{...catalog,public_ready:true});
const refusals=[];
for(const [name,changed,match] of [
  ['changed family admission',{'family-sha':'0'.repeat(64)},/family path\/digest/],
  ['changed anchor admission',{'anchor-sha':'0'.repeat(64)},/anchor digest/],
  ['copied genuine family path',{family:copiedFamily},/family path\/digest/],
  ['opposite profile with combined family',{profile:'synth-only'},/kit root differs|family path\/digest/],
  ['wrong explicit kit',{'kit-root':root},/kit root differs/],
  ['wrong explicit evidence',{'evidence-root':root},/evidence root differs/],
  ['website output root',{'stage-root':resolve(process.cwd(),'tools')},/private build directory/],
  ['website private root',{'private-root':process.cwd()},/separate from/],
  ['outside private catalog',{'dependency-catalog':resolve(process.cwd(),'package.json')},/catalog escapes/],
  ['modified catalog with approved digest',{'dependency-catalog':forgedCatalog},/catalog digest differs/],
  ['self-authored catalog digest',{'dependency-catalog':forgedCatalog,'dependency-catalog-sha':hash(await readFile(forgedCatalog))},/no reviewed admission/],
  ['invalid owner official bytes',{official:outsideOfficial},/Pinned portable verifier refused/],
  ['existing positive stage',{run:base.run+'-combined'},/already exists/],
]){
  const runKey=base.run+'-neg-'+String(refusals.length+1).padStart(2,'0');
  await assert.rejects(stagePortable({...actual,run:runKey,...changed}),match);
  let exists=false;try{await access(resolve(base['stage-root'],runKey,'stage/candidate.disabled.bin'));exists=true;}catch{}
  assert.equal(exists,false,'A refused new attempt must not contain a staged candidate');
  refusals.push({name,status:'REFUSED_EXPECTED',new_staged_candidate_present:false});
}
const report={schema:'opensp-private-portable-stage-integration-review-v1',status:'PASS_THREE_REAL_PORTABLE_STAGES_13_REFUSALS',
  positives,refusals,dependency_catalog_sha256:base['dependency-catalog-sha'],source_recompiled:false,
  website_modules_modified:false,legacy_staging_admitted:false,source_redistribution_reviewed:false,
  source_promotion_authorized:false,public_ready:false,native_hardware_qualified:false,device_operations:false,delivery:'DO_NOT_DELIVER'};
await write(resolve(out,'REPORT.json'),report);
console.log(JSON.stringify({status:report.status,output:out,positive_profiles:3,refusals:refusals.length},null,2));
