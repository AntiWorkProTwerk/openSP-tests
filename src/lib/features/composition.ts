import {exportSelection,parseSelection,registry,type Selection,type Issue} from './selection.ts';

export type Range={owner:string;space:string;start:number;end:number};
export type ComponentReceipt={id:string;version:string;sha256:string;provides:string[];requires:string[]};
export type CompositionReceipt={
  schema:'opensp-composition-receipt';version:2;registryRevision:string;catalogDigest:string;selectionSha256:string;profile:string;
  components:ComponentReceipt[];features:{id:string;version:string;component:string}[];
  resources:{resource:string;owner:string}[];patches:Range[];memory:Range[];
  checks:{sourcePins:boolean;stockPatchBytes:boolean;linkerOwnership:boolean;coldInitialization:boolean;shortcutDispatch:boolean;lifecycle:boolean;deviceQualification:boolean};
  image:{format:'app1-abi2';bytes:number;sha256:string;identity:string};
  writer:{id:'b2-abi2';marker:'52420201';hostSha256:string;imageSha256:string};
};
const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const interval=(r:Range)=>typeof r.owner==='string'&&r.owner.length>0&&typeof r.space==='string'&&r.space.length>0&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=0&&r.end>r.start;
const selectionHash=async(selection:Selection)=>{
  const bytes=new TextEncoder().encode(exportSelection(selection));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
};

/** Check a builder receipt offline. This result never authorizes or performs a flash. */
export async function validateComposition(selection:Selection,receipt:CompositionReceipt,selectionSha256:string):Promise<{valid:boolean;issues:Issue[];uploadReady:false}>{
  const s=parseSelection(selection),issues:Issue[]=[],canonicalSha256=await selectionHash(s);
  const add=(code:string,message:string)=>issues.push({code,message});
  if(!hash(selectionSha256)||selectionSha256!==canonicalSha256)add('selection-digest','The supplied selection digest must match the canonical version 2 selection.');
  if(receipt.schema!=='opensp-composition-receipt'||receipt.version!==2||receipt.registryRevision!==s.registryRevision||receipt.catalogDigest!==s.catalogDigest||receipt.profile!==s.profile||!hash(receipt.selectionSha256)||receipt.selectionSha256!==canonicalSha256)add('receipt-identity','The build receipt must match this exact version 2 selection, feature catalog and firmware base.');
  if(!s.features.length)add('empty-selection','A selected-feature composition needs at least one feature.');
  const profile=registry.profiles.find(p=>p.id===s.profile);
  if(!profile?.supported||profile.writer!=='b2-abi2')add('profile','This firmware base has no qualified composition writer profile.');
  const componentIds=new Set<string>(),provided=new Set<string>();
  for(const c of receipt.components){if(componentIds.has(c.id)||!hash(c.sha256)||!c.version)add('component-pin','Every component needs a unique ID, exact version and source hash.');componentIds.add(c.id);for(const cap of c.provides)provided.add(cap);}
  for(const c of receipt.components)for(const cap of c.requires)if(!provided.has(cap))add('dependency',`${c.id} requires the missing capability ${cap}.`);
  if(receipt.features.length!==s.features.length)add('feature-set','The receipt must contain exactly the selected features.');
  const mapped=new Set<string>();
  for(const f of receipt.features){if(mapped.has(f.id)||!s.features.some(c=>c.id===f.id&&c.version===f.version)||!componentIds.has(f.component))add('feature-set','A feature/version or component mapping does not match the selection.');mapped.add(f.id);}
  for(const f of s.features){const entry=registry.features.find(r=>r.id===f.id)!;for(const cap of entry.requires)if(!provided.has(cap))add('dependency',`${entry.name} requires the missing capability ${cap}.`);}
  const owners=new Map<string,string>();
  for(const resource of receipt.resources){if(!componentIds.has(resource.owner)||!resource.resource)add('resource-owner','Resources must belong to a pinned component.');if(owners.has(resource.resource))add('resource-conflict',`Resource ${resource.resource} has more than one owner.`);owners.set(resource.resource,resource.owner);}
  if(!owners.has('panel-dispatch-v1')||!owners.has('app1-update-writer'))add('resource-owner','The joined dispatcher and APP1 writer need explicit owners.');
  for(const [kind,ranges]of [['patch',receipt.patches],['memory',receipt.memory]] as const){
    if(!ranges.length)add('missing-ranges',`The build needs a ${kind} ownership report.`);
    for(const r of ranges)if(!interval(r)||!componentIds.has(r.owner))add('range',`A ${kind} interval is invalid or has an unpinned owner.`);
    for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length;j++){const a=ranges[i],b=ranges[j];if(a.space===b.space&&a.start<b.end&&b.start<a.end)add('range-overlap',`${kind} intervals overlap between ${a.owner} and ${b.owner}.`);}
  }
  for(const name of ['sourcePins','stockPatchBytes','linkerOwnership','coldInitialization','shortcutDispatch','lifecycle','deviceQualification'] as const)if(receipt.checks[name]!==true)add('qualification',`The ${name} check is incomplete.`);
  const image=receipt.image;
  if(image.format!=='app1-abi2'||!Number.isSafeInteger(image.bytes)||image.bytes<=0||!profile?.app1MaxBytes||image.bytes>profile.app1MaxBytes||!hash(image.sha256)||!image.identity)add('image','The image needs a bounded ABI2 APP1, exact hash and visible build identity.');
  if(receipt.writer.id!=='b2-abi2'||receipt.writer.marker!=='52420201'||!hash(receipt.writer.hostSha256)||receipt.writer.imageSha256!==image.sha256)add('matched-writer','The B2 host recipe must pin the exact composed image hash.');
  return {valid:issues.length===0,issues,uploadReady:false};
}
