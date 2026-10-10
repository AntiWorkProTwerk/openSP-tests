import {parseArgs,runWithdrawalInspection} from './withdrawal-guard-v1/run.mjs';
try{console.log(JSON.stringify(await runWithdrawalInspection(parseArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
