import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const fileId='24d9d841-759d-81bc-8008-b518bc70d8b3';
const call=code=>{
  const raw=execFileSync(process.execPath,['tools/penpot-call.mjs','execute_code','-'],{input:code,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024});
  const data=JSON.parse(raw);if(data.error)throw Error(data.error);return data.result;
};
const assertFile=()=>{const s=call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};');if(s.file!==fileId)throw Error('OpenSP file is not active.');return s;};
const open=page=>{assertFile();call(`const page=penpot.currentFile.pages.find(p=>p.name===${JSON.stringify(page)});if(!page)throw Error('Missing page');await penpot.openPage(page);return {requested:page.name};`);const s=assertFile();if(s.page!==page)throw Error('Page switch not yet complete.');};
const load=()=>{assertFile();const copy=JSON.parse(fs.readFileSync('src/content/emulator.json','utf8'));return call(fs.readFileSync('design/penpot/emulator-library.js','utf8').replace('__COPY__',JSON.stringify(copy)));};
const drain=method=>{let remaining;do{const result=call(`return await storage.emulatorDesign.${method}();`);remaining=result.remaining;}while(remaining);};
const mode=process.argv[2]||'inspect';
if(mode==='inspect')console.log(call('return {file:penpot.currentFile.id,page:penpot.currentPage.name,pages:penpotUtils.getPages(),components:penpot.library.local.components.filter(c=>c.path==="OpenSP / Emulator").map(c=>({id:c.id,name:c.name,mainId:c.mainInstance().id}))};'));
if(mode==='pages'){
  assertFile();console.log(call('const made=[];for(const name of ["Emulator components","Emulator"]){let p=penpot.currentFile.pages.find(p=>p.name===name);if(!p){p=penpot.createPage();p.name=name;}made.push({id:p.id,name:p.name});}return made;'));
}
if(mode==='components'){
  open('Emulator components');load();
  for(const name of ['Emulator action','Emulator blank OLED'])console.log(call(`return await storage.emulatorDesign.prepare(${JSON.stringify(name)});`));
  for(const method of ['introduction','execution','inputs','usb'])for(const mobile of [false,true])console.log(call(`return await storage.emulatorDesign.${method}(${mobile});`));
  for(const mobile of [false,true]){console.log(call(`return await storage.emulatorDesign.session(${mobile});`));drain('batch');}
}
if(mode==='layouts'){
  open('Emulator');load();for(const mobile of [false,true])for(const dark of [false,true]){console.log(call(`return await storage.emulatorDesign.layout(${mobile},${dark});`));if(dark)drain('darkBatch');}
}
if(mode==='states'){
  open('Emulator components');load();for(const mobile of [false,true])console.log(call(`return await storage.emulatorDesign.status(${mobile});`));open('Emulator');console.log(call('return await storage.emulatorDesign.states();'));
}
if(mode==='export'){
  open('Emulator components');
  const serializer=fs.readFileSync('design/penpot/export-guide-components.js','utf8').replace("penpot.currentPage.name!=='Guide components'","penpot.currentPage.name!=='Emulator components'").replace("c.path==='OpenSP / Guide'","c.path==='OpenSP / Emulator'").replace('rotation:round(s.rotation||0)','rotation:round(s.rotation||0),opacity:s.opacity');
  const mains=call(serializer);fs.writeFileSync('design/penpot/emulator-components.json',JSON.stringify(mains,null,2)+'\n');
  open('Emulator');
  const layouts=call(`const visible=s=>{for(let p=s;p;p=p.parent)if(p.hidden)return false;return true;};return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:'native-layout-api-export'},boards:penpot.root.children.filter(s=>s.type==='board'&&s.name.startsWith('Firmware emulator /')).map(b=>({id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData('opensp-emulator')),linkedComponents:penpotUtils.findShapes(s=>visible(s)&&s.isComponentHead(),b).map(s=>({id:s.id,name:s.name,componentId:s.component()?.id,component:s.component()?.name,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height})),text:penpotUtils.findShapes(s=>s.type==='text'&&visible(s),b).map(s=>({name:s.name,text:s.characters,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height,font:s.fontFamily,size:Number(s.fontSize),ink:s.textBounds?{x:s.textBounds.x-b.x,y:s.textBounds.y-b.y,width:s.textBounds.width,height:s.textBounds.height}:null})),fills:b.fills.map(f=>({color:f.fillColor,ref:f.fillColorRefId}))}))};`);
  fs.writeFileSync('design/penpot/emulator-layouts.json',JSON.stringify(layouts,null,2)+'\n');
  const states=call(`const b=penpot.root.children.find(s=>s.name==='Emulator interaction states');if(!b)throw Error('Missing native state sheet');return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:'native-state-api-export'},id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData('opensp-emulator-states')),linkedComponents:penpotUtils.findShapes(s=>s.isComponentHead(),b).map(s=>({id:s.id,componentId:s.component()?.id,component:s.component()?.name})),text:penpotUtils.findShapes(s=>s.type==='text',b).map(s=>({name:s.name,text:s.characters,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height,size:Number(s.fontSize),ink:s.textBounds?{x:s.textBounds.x-b.x,y:s.textBounds.y-b.y,width:s.textBounds.width,height:s.textBounds.height}:null}))};`);
  fs.writeFileSync('design/penpot/emulator-states.json',JSON.stringify(states,null,2)+'\n');
  console.log(`Exported ${mains.components.length} native mains and ${layouts.boards.length} layouts.`);
}

if(mode==='pull-copy'){
 const snapshot=JSON.parse(fs.readFileSync('design/penpot/emulator-components.json','utf8'));
 if(snapshot.source.fileId!==fileId||snapshot.source.kind!=='native-component-api-export')throw Error('Unexpected native copy source');
 const copy=JSON.parse(fs.readFileSync('src/content/emulator.json','utf8')),values=new Map();
 const collect=shape=>{const name=shape.name.replace(/\s*\/\s*/g,'/');if(shape.type==='text'&&name.startsWith('copy/')){const key=name.slice(5);if(typeof copy[key]==='string'){const old=values.get(key);if(old!==undefined&&old!==shape.text)throw Error('Responsive copy disagreement: '+key);values.set(key,shape.text);}}for(const child of shape.children||[])collect(child);};
 for(const component of snapshot.components)collect(component.shape);for(const [key,value]of values)copy[key]=value;
 fs.writeFileSync('src/content/emulator.json',JSON.stringify(copy,null,2)+'\n');console.log('Pulled '+values.size+' shared visible copy fields. Review the diff before building.');
}
