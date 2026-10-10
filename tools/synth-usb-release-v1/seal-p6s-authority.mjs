import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const synth=resolve(process.argv[2]);
const base='diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/';
const raw=await readFile(resolve(synth,base+'authority.ts'));
const hash=body=>createHash('sha256').update(body).digest('hex');
if(hash(raw)!=='d199cc71c310c156292d888e4354f458153813f97701f102540c0b68388dfb97')throw Error('Historical admission authority differs.');
const {P6S_TEST_IMAGE,P6S_TEST_EVIDENCE}=await import(pathToFileURL(resolve(synth,base+'authority.ts')));
const reviewRaw=await readFile(resolve(synth,base+'PHYSICAL_ROUNDTRIP_REVIEW_01.json'));
if(hash(reviewRaw)!=='c954d5bcad0d12331af74451cd759cad80ed62eb6cbb3b0060741760ffcf6242')throw Error('Completed physical review differs.');
const review=JSON.parse(reviewRaw);
const ids=['physical-review','physical-preflight','physical-storage','root-browser-observation','owner-reboot','fresh-del-result','fresh-del-journal','fresh-del-source','physical-preparation'];
const evidence=[...P6S_TEST_EVIDENCE,...review.checkedFiles.slice(0,9).map((pin,index)=>({id:ids[index],...pin})),{id:'additive-offline-review',path:base+'PHYSICAL_ROUNDTRIP_REVIEW_01.json',bytes:reviewRaw.length,sha256:hash(reviewRaw)}];
for(const pin of evidence){const body=await readFile(resolve(synth,pin.path));if(body.length!==pin.bytes||hash(body)!==pin.sha256)throw Error('Retained evidence differs: '+pin.id);}
const text=`// Retained evidence trust anchors. Candidate authorities are deliberately empty.\nexport const P6S_IMAGE = Object.freeze(${JSON.stringify(P6S_TEST_IMAGE,null,2)} as const);\nexport const P6S_EVIDENCE = Object.freeze(${JSON.stringify(evidence,null,2)}.map(pin => Object.freeze(pin)));\nexport const CANDIDATE_AUTHORITIES: readonly never[] = Object.freeze([]);\n`;
await writeFile(new URL('authority.ts',import.meta.url),text);
