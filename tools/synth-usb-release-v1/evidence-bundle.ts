import type {LocalBinary} from './model.ts';
import {allowOnlyFields, hexDigest, ownedBytes, record, rejectDuplicateJsonKeys} from './data.ts';
import {P6S_EVIDENCE} from './authority.ts';
import {admitQualifiedP6SRestoration} from './release.ts';

export const EVIDENCE_BUNDLE_MAXIMUM = 1024 * 1024;
const need = (value:unknown,reason:string):void => {if(!value)throw new TypeError(reason);};

/** Decode an owner-local snapshot; every inner byte pin still comes from the reviewed authority. */
export async function readRetainedP6SEvidenceBundle(file:LocalBinary) {
  need(file && typeof file.arrayBuffer === 'function' && Number.isSafeInteger(file.size) && file.size >= 2 && file.size <= EVIDENCE_BUNDLE_MAXIMUM,'P6S evidence bundle exceeds its 1 MiB bound');
  const bytes=ownedBytes(new Uint8Array(await file.arrayBuffer()));
  need(bytes.length === file.size,'P6S evidence bundle changed while reading');
  let value:Record<string,unknown>;
  try {
    const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    rejectDuplicateJsonKeys(source);value=record(JSON.parse(source),'Evidence bundle');
  } catch(error) {throw new TypeError('P6S evidence bundle is not bounded JSON without duplicate fields',{cause:error});}
  allowOnlyFields(value,new Set(['schema','version','scope','firmwareIncluded','candidateAuthorityGranted','files']),'Evidence bundle');
  need(value.schema === 'opensp-retained-p6s-evidence-files-v1' && value.version === 1 && value.scope === 'exact-historical-p6s-only' &&
    value.firmwareIncluded === false && value.candidateAuthorityGranted === false,'Evidence bundle scope or authority differs');
  need(Array.isArray(value.files) && value.files.length === P6S_EVIDENCE.length,'Evidence bundle needs the exact21 retained files');
  const pins=new Map(P6S_EVIDENCE.map(pin=>[pin.id,pin])),files:Record<string,Blob>=Object.create(null);
  for(const entry of value.files as unknown[]) {
    const item=record(entry,'Evidence file');allowOnlyFields(item,new Set(['id','bytes','sha256','base64']),'Evidence file');
    need(typeof item.id === 'string' && !Object.hasOwn(files,item.id),'Evidence bundle has an invalid or duplicate file ID');
    const pin=pins.get(item.id as string);need(pin && item.bytes === pin.bytes && item.sha256 === pin.sha256,'Evidence file does not match an actual authority pin');
    const base64=item.base64;
    need(typeof base64 === 'string' && base64.length === Math.ceil(pin!.bytes/3)*4 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64),'Evidence file base64 length or encoding differs');
    let body:Uint8Array<ArrayBuffer>;
    try {
      const binary=atob(base64 as string);need(btoa(binary) === base64,'Evidence base64 is not canonical');
      body=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)body[index]=binary.charCodeAt(index);
    } catch(error) {throw new TypeError('Evidence file base64 is invalid',{cause:error});}
    need(body.length === pin!.bytes && await hexDigest(body) === pin!.sha256,'Evidence inner file digest differs');
    files[pin!.id]=new Blob([body]);
  }
  return Object.freeze({schema:'opensp-authenticated-retained-p6s-evidence-bundle-v1',bundleSha256:await hexDigest(bytes),
    evidenceFiles:Object.freeze(files),firmwareIncluded:false,candidateAuthorityGranted:false});
}

export async function admitQualifiedP6SRestorationFromEvidenceBundle(restoration:LocalBinary,bundle:LocalBinary) {
  const decoded=await readRetainedP6SEvidenceBundle(bundle);
  return admitQualifiedP6SRestoration(restoration,decoded.evidenceFiles);
}
