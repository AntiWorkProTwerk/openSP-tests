import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,inside} from '../compact-final13-v1/common.mjs';
import {inspectWithdrawnHandoff,requireReleaseAction} from './guard.mjs';

export function parseArgs(args){
  if(args.some(value=>['--build','--upload','--publish','--allow','--force'].includes(value))||args.includes('build'))requireReleaseAction();
  const options={},allowed=['handoff','candidate','restoration','output'];
  for(let at=0;at<args.length;at+=2){const key=args[at]?.slice(2);need(args[at]?.startsWith('--')&&allowed.includes(key)&&args[at+1]&&!args[at+1].startsWith('--')&&!Object.hasOwn(options,key),'Use only --handoff, --candidate, --restoration and optional --output.');options[key]=args[at+1];}
  need(['handoff','candidate','restoration'].every(key=>options[key]),'Supply the historical held handoff and exact candidate/restoration files for read-only withdrawal inspection.');return options;
}

export async function runWithdrawalInspection(options){
  const handoff=await readFile(resolve(options.handoff)),candidate=await readFile(resolve(options.candidate)),restoration=await readFile(resolve(options.restoration));
  const result=inspectWithdrawnHandoff(handoff,candidate,restoration);
  if(options.output){const requested=resolve(options.output),parent=await realpath(dirname(requested)),output=resolve(parent,requested.split(/[\\/]/).at(-1)),website=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');need(!inside(website,output),'Withdrawal receipts remain outside website assets.');await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runWithdrawalInspection(parseArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
