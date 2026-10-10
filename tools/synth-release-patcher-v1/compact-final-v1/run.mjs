import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,runCompactPatcher} from './build.mjs';
export {parseArgs,runCompactPatcher};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')==='--help')console.log('node tools/synth-release-patcher-v1/compact-final-v1/run.mjs --mode build --source-archive SOURCE_FINAL11.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --python PINNED_PYTHON.exe --toolchain-root PINNED_ARM_ROOT --output NEW_PRIVATE_OUTPUT\n--mode inspect --source-archive SOURCE_FINAL11.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --build EXISTING_COMPACT_BUILD --output NEW_PRIVATE_OUTPUT');
  else try{console.log(JSON.stringify(await runCompactPatcher(parseArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
