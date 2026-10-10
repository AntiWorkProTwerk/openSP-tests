import {readFile,realpath,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {hash,crc32,checkedOfficialInput} from '../official.mjs';
export {hash,crc32,checkedOfficialInput};
export const need=(value,reason)=>{if(!value)throw Error(reason);};
export const inside=(root,path)=>{const child=relative(root,path);return child===''||(!child.startsWith('..')&&!isAbsolute(child));};
export const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Check duplicate fields before JSON.parse can erase them. */
export function json(raw){
  const text=raw.toString('utf8');let at=0;
  const space=()=>{while(/\s/.test(text[at]??''))at++;};
  const token=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}throw Error('Unclosed JSON string.');};
  const value=()=>{
    space();const char=text[at];
    if(char==='"'){token();return;}
    if(char==='['){at++;space();if(text[at]===']'){at++;return;}while(true){value();space();if(text[at]===']'){at++;return;}need(text[at++]===',','Invalid JSON array.');}}
    if(char==='{'){
      at++;space();const keys=new Set();if(text[at]==='}'){at++;return;}
      while(true){space();need(text[at]==='"','Invalid JSON object.');const key=token();need(!keys.has(key),`Duplicate JSON field: ${key}.`);keys.add(key);space();need(text[at++]===':','Invalid JSON field.');value();space();if(text[at]==='}'){at++;return;}need(text[at++]===',','Invalid JSON object.');}
    }
    const start=at;while(at<text.length&&!/[\s,\]}]/.test(text[at]))at++;need(start!==at,'Invalid JSON value.');JSON.parse(text.slice(start,at));
  };
  // Delimiters are commas. Keep parsing separate from object construction.
  const scanner=value;
  scanner();space();need(at===text.length,'Trailing JSON content.');
  const parsed=JSON.parse(text);need(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'Expected an object receipt.');return parsed;
}

export async function rootedReader(root){
  root=await realpath(resolve(root));
  return {root,async bytes(name){need(!isAbsolute(name)&&name.split(/[\\/]/).every(part=>part!=='.'&&part!=='..'),'Artifact path is not relative.');const expected=resolve(root,name),actual=await realpath(expected);need(actual===expected&&inside(root,actual),'Artifact escaped its source or transaction role.');return readFile(actual);}};
}
export async function namesAt(root){
  root=await realpath(root);const result=[];
  async function walk(folder,prefix=''){for(const entry of await readdir(folder,{withFileTypes:true})){const name=prefix+entry.name;need(!entry.isSymbolicLink(),'Source or artifact link is not admitted.');if(entry.isDirectory())await walk(resolve(folder,entry.name),name+'/');else{need(entry.isFile(),'Foreign filesystem entry.');result.push(name);}}}
  await walk(root);return result.sort();
}
export function imageMetadata(raw,identity){
  const padded=Buffer.alloc(Math.ceil(raw.length/4096)*4096,0xff);raw.copy(padded);
  return {identity,bytes:raw.length,sha256:hash(raw),crc32:crc32(raw),padded_bytes:padded.length,padded_crc32:crc32(padded),sectors:padded.length/4096,abi:2,expected_cold_del_marker:0x52420201};
}
