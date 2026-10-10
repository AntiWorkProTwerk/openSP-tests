// Author the schema-2 openSynth page in the shared OpenSP Penpot file.
// Modes: components | layouts | patcher | features | export; features redraws the intro hero and per-row feature screens in place; patcher adds the browser-patcher state mains and redraws the patch section; refresh-components redraws existing mains in place
// (instances stay linked) and refresh-layouts replaces the four openSynth page layouts. Earlier "Synth release / ..." layouts and
// mains are preserved; this adds openSynth page mains/layouts beside them.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const fileId='24d9d841-759d-81bc-8008-b518bc70d8b3';
const call=code=>{const raw=execFileSync(process.execPath,['tools/penpot-call.mjs','execute_code','-'],{input:code,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024});const r=JSON.parse(raw);if(!('result'in r))throw Error('Missing Penpot result: '+raw.slice(0,400));return r.result;};
const q=JSON.stringify;
const copy=JSON.parse(fs.readFileSync('src/content/releases/synth.json','utf8'));
const screens=JSON.parse(fs.readFileSync('src/content/releases/opensynth-screens.json','utf8'));
const open=async name=>{call(`if(penpot.currentFile?.id!==${q(fileId)})throw Error('OpenSP must be active');const p=penpot.currentFile.pages.find(p=>p.name===${q(name)});if(!p)throw Error('Missing page');await penpot.openPage(p);return p.id;`);for(let i=0;i<20;i++){if(call('return penpot.currentPage?.name;')===name)return;await new Promise(r=>setTimeout(r,500));}throw Error('Page switch pending '+name);};
const load=()=>{
  call(fs.readFileSync('design/penpot/synth-release-library.js','utf8').replace('__COPY__',q(copy)));
  for(const a of screens.animations)call(`storage.osPosterData=storage.osPosterData||{};storage.osPosterData[${q(a.id)}]=${q(fs.readFileSync(`design/assets/screens/opensynth/${a.id}-poster.png`).toString('base64'))};return true;`);
  const r=call(fs.readFileSync('design/penpot/opensynth-page-library.js','utf8').replace('__SCREENS__',q(screens)));
  call(fs.readFileSync('design/penpot/opensynth-patcher-library.js','utf8'));
  return r;
};
const sections=copy.sections;
const mode=process.argv[2].replace(/^refresh-/,''),refresh=process.argv[2].startsWith('refresh-');
const loadMode=()=>{const r=load();call(`storage.synthRelease.remakeAll=${refresh};return true;`);return r;};
if(mode==='components'){
  await open('Release components');console.log(loadMode());
  console.log(call('return await storage.synthRelease.tile();'));
  for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.introPage(${mobile});`));
  for(const [i,s] of sections.entries())for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.section(${q(s)},${mobile},${23+i*2+(mobile?1:0)});`));
}else if(mode==='layouts'){
  await open('Synth release');console.log(loadMode());
  for(const mobile of [false,true])for(const dark of [false,true])console.log(call(`return await storage.synthRelease.pageLayout(${mobile},${dark});`));
}else if(mode==='patcher'){
  // Patcher state mains (created, or redrawn in place with refresh-patcher), then the patch section
  // mains are redrawn in place so every layout instance follows, then the states review board.
  await open('Release components');console.log(loadMode());
  for(const [i,state] of ['Drop zone','Working','Done'].entries())for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.patcher(${q(state)},${mobile},${40+i*2+(mobile?1:0)});`));
  const patch=sections.find(s=>s.id==='patch');
  call('storage.synthRelease.remakeAll=true;return true;');
  for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.section(${q(patch)},${mobile},${mobile?26:25});`));
  await open('Synth release');
  console.log(call('return await storage.synthRelease.patcherBoard();'));
}else if(mode==='features'){
  // Redraw only the introduction (hero screen) and features (one linked screen tile per row) mains in
  // place; the patch and safety mains are left as they are. Then refresh-layouts and export.
  await open('Release components');console.log(load());call('storage.synthRelease.remakeAll=true;return true;');
  for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.introPage(${mobile});`));
  const features=sections.find(s=>s.id==='features');
  for(const mobile of [false,true])console.log(call(`return await storage.synthRelease.section(${q(features)},${mobile},${mobile?24:23});`));
}else if(mode==='export'){
  await open('Synth release');
  const result=call(`return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:'native-layout-api-export'},boards:penpot.root.children.filter(b=>b.name.startsWith('openSynth page /')||b.name==='openSynth patcher / States').map(b=>({id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData('opensp-synth-release')||'null'),linked:penpotUtils.findShapes(s=>s.isComponentHead(),b).map(s=>({name:s.name,component:s.component()?.name,copy:s.isComponentCopyInstance()})),text:penpotUtils.findShapes(s=>s.type==='text',b).map(s=>s.characters)}))};`);
  fs.writeFileSync('design/penpot/opensynth-page-layouts.json',JSON.stringify(result,null,2)+'\n');console.log({boards:result.boards.map(b=>[b.name,b.id,b.linked.length])});
}else throw Error('Mode: components | layouts | patcher | export, or refresh-components | refresh-layouts | refresh-patcher');
