import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const fileId='24d9d841-759d-81bc-8008-b518bc70d8b3';
const call=code=>JSON.parse(execFileSync(process.execPath,['tools/penpot-call.mjs','execute_code','-'],{input:code,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024})).result;
const open=name=>{const s=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};');if(s.file!==fileId)throw Error('OpenSP is not active');call(`await penpot.openPage(penpot.currentFile.pages.find(p=>p.name===${JSON.stringify(name)}));return true;`);const r=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};');if(r.file!==fileId||r.page!==name)throw Error('Page switch not complete');};
const load=()=>call(fs.readFileSync('design/penpot/emulator-footer.js','utf8').replace('__COPY__',fs.readFileSync('src/content/emulator.json','utf8')));
const mode=process.argv[2]||'inspect';
if(mode==='fit-focused'){
 const pageNames=['Guide series','Homepage','First guide','Guide index','Emulator'];const records=[];
 const save=complete=>fs.writeFileSync('design/penpot/emulator-footer-propagation.json',JSON.stringify({source:{fileId,kind:'native-footer-link-propagation'},revision:'2026-10-02',complete,method:'One active footer per request; viewport focused away from whole-page overview',instances:records},null,2)+'\n');
 save(false);
 for(const name of pageNames){
  const state=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};');if(state.file!==fileId)throw Error('OpenSP is not active');
  if(state.page!==name){call(`const p=penpotUtils.getPageByName(${JSON.stringify(name)}),f=penpotUtils.findShape(s=>s.isComponentHead()&&s.component()?.name==='Footer',p.root);penpot.viewport.zoom=1;if(f)penpot.viewport.center={x:f.x+f.width/2,y:f.y};await penpot.openPage(p);penpot.viewport.zoom=1;if(f)penpot.viewport.center={x:f.x+f.width/2,y:f.y};return {requested:p.name};`);}
  const checked=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name,id:penpot.currentPage.id};');if(checked.file!==fileId||checked.page!==name)throw Error('Page switch not complete');
  load();const plan=call('return storage.emulatorFooter.plan();');console.log(plan);let result;
  do{result=call('return await storage.emulatorFooter.fitOne();');records.push(...result.results.map(r=>({...r,pageId:checked.id,page:name})));save(false);}while(result.remaining);
 }
 save(true);console.log(`Verified linked fits for ${records.length} native Footer instances.`);
}
if(mode==='main'){
 open('Design system');load();console.log(call('return await storage.emulatorFooter.main();'));
 const serializer=fs.readFileSync('design/penpot/export-guide-components.js','utf8').replace("penpot.currentPage.name!=='Guide components'","penpot.currentPage.name!=='Design system'").replace("c.path==='OpenSP / Guide'","c.path==='OpenSP'&&['Footer','Utility link'].includes(c.name)");
 fs.writeFileSync('design/penpot/emulator-footer-components.json',JSON.stringify(call(serializer),null,2)+'\n');
}
if(mode==='fit'){
 const pages=call('return penpotUtils.getPages();');const records=[];
 for(const page of pages){open(page.name);load();const plan=call('return await storage.emulatorFooter.plan();');console.log(plan);let result;do{result=call('return await storage.emulatorFooter.batch();');records.push(...result.results.map(r=>({...r,pageId:page.id,page:page.name})));}while(result.remaining);}
 fs.writeFileSync('design/penpot/emulator-footer-propagation.json',JSON.stringify({source:{fileId,kind:'native-footer-link-propagation'},revision:'2026-10-02',instances:records},null,2)+'\n');
}
if(mode==='inspect'){
 load();console.log(call('return await storage.emulatorFooter.inspect();'));
}
if(mode==='verify'){
 const pages=call('return penpotUtils.getPages();');const records=[];
 for(const page of pages){open(page.name);load();records.push(call('return await storage.emulatorFooter.inspect();'));}
 fs.writeFileSync('design/penpot/emulator-footer-bounds.json',JSON.stringify({source:{fileId,kind:'native-footer-text-bounds'},pages:records},null,2)+'\n');
 console.log(`Read footer text bounds from ${records.length} pages.`);
}
if(mode==='verify-inactive'){
 const state=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};');if(state.file!==fileId||state.page!=='Emulator')throw Error('Keep the smaller Emulator page active');load();const records=[];
 for(const name of ['Homepage','First guide','Guide series','Guide index','Emulator'])records.push(call(`return storage.emulatorFooter.inspectPage(${JSON.stringify(name)});`));
 fs.writeFileSync('design/penpot/emulator-footer-bounds.json',JSON.stringify({source:{fileId,kind:'native-footer-text-bounds',activePage:'Emulator',method:'Read-only page proxies; matching component filter precedes visibility'},pages:records},null,2)+'\n');console.log(`Read footer bounds from ${records.length} pages without switching the canvas.`);
}
