import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const call=code=>{const r=JSON.parse(execFileSync(process.execPath,['tools/penpot-call.mjs','execute_code','-'],{input:code,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024}));if(r.error||!('result'in r))throw Error(r.error||'Missing result');return r.result;};
for(const name of ['Feature components','Feature picker']){
  const state=call('return {file:penpot.currentFile.id};');if(state.file!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
  call(`await penpot.openPage(penpot.currentFile.pages.find(p=>p.name===${JSON.stringify(name)}));return true;`);
  if(call('return penpot.currentPage.name;')!==name)throw Error('Page pending');
  call(fs.readFileSync('design/penpot/feature-picker-library.js','utf8').replace('__COPY__',fs.readFileSync('src/content/features.json','utf8')).replace('__FEATURES__',JSON.stringify(JSON.parse(fs.readFileSync('src/content/feature-registry.json','utf8')).features)));
  console.log(call(fs.readFileSync('design/penpot/refine-feature-picker.js','utf8')));
}
// Separate width-change requests refresh rendered positions on themed text overrides.
console.log(call(`storage.featureTextRefresh=penpotUtils.findShapes(s=>s.type==='text'&&(s.name.startsWith('Shortcut control')||s.name==='Shortcut scope'),penpot.root).map(s=>({s,width:s.width,height:s.height}));for(const a of storage.featureTextRefresh)a.s.resize(a.width+1,a.height);return {refresh:storage.featureTextRefresh.length};`));
console.log(call('for(const a of storage.featureTextRefresh)a.s.resize(a.width,a.height);return {restored:storage.featureTextRefresh.length};'));
