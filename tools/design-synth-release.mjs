import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const fileId='24d9d841-759d-81bc-8008-b518bc70d8b3';
const call=code=>{const raw=execFileSync(process.execPath,['tools/penpot-call.mjs','execute_code','-'],{input:code,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024});const r=JSON.parse(raw);if(!('result'in r))throw Error('Missing Penpot result');return r.result;};
const inspect=()=>{const state=call('return {file:penpot.currentFile?.id,page:penpot.currentPage?.name};');if(state.file!==fileId)throw Error('OpenSP must be active');return state;};
const open=name=>{inspect();call(`const p=penpot.currentFile.pages.find(p=>p.name===${JSON.stringify(name)});if(!p)throw Error('Missing page');await penpot.openPage(p);return p.id;`);if(inspect().page!==name)throw Error('Page switch pending');};
const load=()=>call(fs.readFileSync('design/penpot/synth-release-library.js','utf8').replace('__COPY__',fs.readFileSync('src/content/releases/synth.json','utf8')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// This planner reads authenticated local sources and generates operations. It has no RPC path.
export function buildRefreshPlan({projectRoot=process.cwd(),overlayRoot=projectRoot,dependencies,copy=path.join(projectRoot,'src/content/releases/synth.json'),figure=path.join(projectRoot,'src/content/releases/synth-recording-figure.json')}={}){
  if(!dependencies)throw Error('Supply the reviewed DESIGN_DEPENDENCIES.json path');
  const configPath=path.join(overlayRoot,'design/penpot/synth-release-refresh-inputs.json');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(!['opensynth.d12-native-refresh-inputs/v1','opensynth.native-refresh-inputs/v1'].includes(config.schema)||config.fileId!==fileId)throw Error('Wrong refresh authority');
  const inputs=[];
  const read=(filename,expected,label)=>{const bytes=fs.readFileSync(filename);if(sha(bytes)!==expected)throw Error('Changed source '+label);inputs.push({label,sha256:sha(bytes),bytes:bytes.length});return bytes.toString('utf8');};
  const content=JSON.parse(read(copy,config.copySha256,'release copy'));
  const captions=JSON.parse(read(figure,config.figureSha256,'release figure captions'));
  const deps=JSON.parse(read(dependencies,config.dependenciesSha256,'release design dependencies'));
  const basis=Object.fromEntries(Object.entries(config.basis).map(([name,pin])=>[name,read(path.join(projectRoot,name),pin.sha256,name)]));
  const helpers=Object.fromEntries(Object.entries(config.helpers).map(([name,pin])=>[name,read(path.join(overlayRoot,name),pin.sha256,name)]));
  const ids=content.sections.map(s=>s.id);
  if(ids.join(',')!=='current,controls,patterns,recording,installation,evidence'||new Set(ids).size!==ids.length)throw Error('Unexpected section authority');
  if(content.sections.find(s=>s.id==='installation').commands?.length!==2||captions.captions?.length!==4||deps.penpot_file_id!==fileId)throw Error('Incomplete release input');
  const missing=['Synth release patterns (Desktop)','Synth release patterns (Mobile)'];
  if(JSON.stringify(deps.missing_release_mains)!==JSON.stringify(missing))throw Error('Unexpected new-main request');
  inputs.push({label:'refresh authority',sha256:sha(fs.readFileSync(configPath)),bytes:fs.statSync(configPath).size});
  const q=JSON.stringify;
  const guarded=(page,body)=>`if(penpot.currentFile?.id!==${q(fileId)}||penpot.currentPage?.id!==${q(config.pages[page])}||penpot.currentPage?.name!==${q(page)})throw Error('Wrong native refresh context');\n${body}`;
  const step=(id,page,body)=>({id,page,code:guarded(page,body)});
  const switchPage=page=>({id:'open-'+page,page,code:`if(penpot.currentFile?.id!==${q(fileId)})throw Error('OpenSP must be active');const p=penpot.currentFile.pages.find(p=>p.id===${q(config.pages[page])}&&p.name===${q(page)});if(!p)throw Error('Missing authenticated page');await penpot.openPage(p);return {page:p.id};`});
  const setup=page=>[switchPage(page),step('load-library',page,basis['design/penpot/synth-release-library.js'].replace('__COPY__',q(content))),step('load-fit',page,helpers['design/penpot/synth-release-fit.js']),step('load-refresh',page,helpers['design/penpot/synth-release-refresh.js'].replace('__DEPENDENCIES__',q(config.native)).replace('__FIGURE__',q(captions)))];
  const components=[...setup('Release components'),step('audit-existing-mains','Release components','return storage.synthRelease.refreshAudit();'),step('create-missing-linked-patterns','Release components','return await storage.synthRelease.refreshPatterns();')];
  for(const mobile of [false,true])components.push(step('refresh-figure-'+(mobile?'mobile':'desktop'),'Release components',`return storage.synthRelease.refreshFigure(${q('openSynth recording figure'+(mobile?' (Mobile)':' (Desktop)'))});`));
  for(const mobile of [false,true])for(const id of ['introduction',...ids])components.push(step('refresh-'+id+'-'+(mobile?'mobile':'desktop'),'Release components',`return storage.synthRelease.refreshMain(${q('Synth release '+id+(mobile?' (Mobile)':' (Desktop)'))});`));
  const layouts=[...setup('Synth release'),step('audit-layouts','Synth release','return storage.synthRelease.refreshLayoutAudit();')];
  // Pass one inserts linked pattern instances. Pass two requires actual propagated bounds/copy before refitting.
  for(const pass of [1,2])for(const row of config.native.layouts)layouts.push(step('layout-'+row.id+'-pass-'+pass,'Synth release',`return storage.synthRelease.refreshLayout(${q(row.id)});`));
  const verify=[...setup('Synth release'),step('audit-layouts','Synth release','return storage.synthRelease.refreshLayoutAudit();'),...config.native.layouts.map(row=>step('verify-'+row.id,'Synth release',`return storage.synthRelease.refreshVerifyLayout(${q(row.id)});`))];
  const serializer=basis['design/penpot/export-guide-components.js'].replace("penpot.currentPage.name!=='Guide components'","penpot.currentPage.name!=='Release components'").replace("c.path==='OpenSP / Guide'","c.path==='OpenSP / Releases'");
  const exportSteps=[...verify,switchPage('Release components'),{...step('export-components','Release components',serializer),output:'synth-release-components.json'},switchPage('Synth release'),{...step('export-layouts','Synth release',`return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:'native-layout-api-export'},boards:penpot.root.children.filter(b=>${q(config.native.layouts.map(r=>r.id))}.includes(b.id)).map(b=>({id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData('opensp-synth-release')),linked:penpotUtils.findShapes(s=>s.isComponentHead(),b).map(s=>({id:s.id,name:s.name,componentId:s.component()?.id,component:s.component()?.name,copy:s.isComponentCopyInstance()})),text:penpotUtils.findShapes(s=>s.type==='text',b).map(s=>({name:s.name,text:s.characters,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height,ink:s.textBounds?{width:s.textBounds.width,height:s.textBounds.height}:null}))}))};`),output:'synth-release-layouts.json'}];
  const phases={components,layouts,verify,exports:exportSteps};
  for(const steps of Object.values(phases))for(const s of steps)s.code_sha256=sha(s.code);
  return {schema:'opensynth.native-refresh-plan/v1',fileId,inputs,existingMains:config.native.releaseMains,newMains:missing,layouts:config.native.layouts,sections:ids,sourceCommandCount:2,phases,livePenpotModified:false,nativePropagationVerified:false,visualReviewed:false,releaseReady:false,uploadEnabled:false};
}

function argumentsFor(argv){const result={};for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--dependencies','--copy','--figure','--output'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||result[key.slice(2)])throw Error('Invalid refresh argument '+key);result[key.slice(2)]=argv[i+1];}if(!result.output)throw Error('Supply a new --output directory');return result;}
function runRefresh(mode,args){
  const options=argumentsFor(args),plan=buildRefreshPlan(options);
  const output=path.resolve(options.output);if(fs.existsSync(output))throw Error('Output already exists');fs.mkdirSync(output,{recursive:true});
  const planText=JSON.stringify(plan,null,2)+'\n';fs.writeFileSync(path.join(output,'PLAN.json'),planText);
  if(mode==='refresh-plan'){console.log({output,operations:Object.values(plan.phases).reduce((n,s)=>n+s.length,0),livePenpotModified:false});return;}
  const selection={'refresh':['components','layouts'],'refresh-layouts':['layouts'],'refresh-check':['verify'],'refresh-export':['exports']}[mode];if(!selection)throw Error('Unknown refresh mode');
  const receipt={mode,fileId,plan_sha256:sha(planText),operations:[],status:'IN_PROGRESS',nativeVisualReviewed:false,releaseReady:false,uploadEnabled:false};
  const save=()=>fs.writeFileSync(path.join(output,'RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');save();
  try{for(const phase of selection)for(const operation of plan.phases[phase]){receipt.current={phase,id:operation.id,code_sha256:operation.code_sha256};save();const result=call(operation.code);receipt.operations.push({...receipt.current,result});if(operation.output)fs.writeFileSync(path.join(output,operation.output),JSON.stringify(result,null,2)+'\n');save();}receipt.status='OPERATIONS_RETURNED_VISUAL_REVIEW_PENDING';delete receipt.current;save();console.log({output,status:receipt.status,operations:receipt.operations.length});}
  catch(error){receipt.status='STOPPED_ERROR_PARTIAL_NATIVE_CHANGES_POSSIBLE';receipt.error=String(error);save();throw error;}
}

function legacyMain(mode){
if(mode==='inspect')console.log(inspect());
if(mode==='pages'){inspect();console.log(call('return ["Release components","Synth release"].map(name=>{let p=penpot.currentFile.pages.find(p=>p.name===name);if(!p){p=penpot.createPage();p.name=name;}return {id:p.id,name:p.name};});'));}
if(mode==='components'){open('Release components');load();for(const mobile of[false,true]){console.log(call(`return await storage.synthRelease.intro(${mobile});`));for(const[i,section]of JSON.parse(fs.readFileSync('src/content/releases/synth.json','utf8')).sections.entries())console.log(call(`return await storage.synthRelease.section(${JSON.stringify(section)},${mobile},${2+i*2+(mobile?1:0)});`));}}
if(mode==='layouts'){open('Synth release');load();for(const mobile of[false,true])for(const dark of[false,true])console.log(call(`return await storage.synthRelease.layout(${mobile},${dark});`));}
if(mode==='figure'){open('Release components');load();call(fs.readFileSync('design/penpot/synth-release-recording-figure.js','utf8').replace('__FIGURE__',fs.readFileSync('src/content/releases/synth-recording-figure.json','utf8')).replace('__SPEC__',fs.readFileSync('src/content/releases/synth-direct-recording-design.json','utf8')));for(const mobile of[false,true])console.log(call(`return await storage.synthRelease.recordingFigure(${mobile});`));}
if(mode==='refine'){open('Release components');load();call(fs.readFileSync('design/penpot/synth-release-fit.js','utf8'));const names=call('return penpot.library.local.components.filter(c=>c.path==="OpenSP / Releases"&&c.name.startsWith("Synth release")).map(c=>c.name);');for(const name of names)console.log(call(`return storage.synthRelease.refitMain(${JSON.stringify(name)});`));open('Synth release');const ids=call('return penpot.root.children.filter(b=>b.name.startsWith("Synth release /")).map(b=>b.id);');for(const id of ids)console.log(call(`return storage.synthRelease.refitLayout(${JSON.stringify(id)});`));}
if(mode==='refine-layouts'){open('Synth release');load();call(fs.readFileSync('design/penpot/synth-release-fit.js','utf8'));const ids=call('return penpot.root.children.filter(b=>b.name.startsWith("Synth release /")).map(b=>b.id);');for(const id of ids)console.log(call(`return storage.synthRelease.refitLayout(${JSON.stringify(id)});`));}
if(mode==='export'){
  open('Release components');const serializer=fs.readFileSync('design/penpot/export-guide-components.js','utf8').replace("penpot.currentPage.name!=='Guide components'","penpot.currentPage.name!=='Release components'").replace("c.path==='OpenSP / Guide'","c.path==='OpenSP / Releases'");fs.writeFileSync('design/penpot/synth-release-components.json',JSON.stringify(call(serializer),null,2)+'\n');
  open('Synth release');const result=call('return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:"native-layout-api-export"},boards:penpot.root.children.filter(b=>b.name.startsWith("Synth release /")).map(b=>({id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData("opensp-synth-release")),linked:penpotUtils.findShapes(s=>s.isComponentHead(),b).map(s=>({id:s.id,name:s.name,componentId:s.component()?.id,component:s.component()?.name,copy:s.isComponentCopyInstance()})),text:penpotUtils.findShapes(s=>s.type==="text",b).map(s=>({name:s.name,text:s.characters,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height,ink:s.textBounds?{width:s.textBounds.width,height:s.textBounds.height}:null}))}))};');fs.writeFileSync('design/penpot/synth-release-layouts.json',JSON.stringify(result,null,2)+'\n');console.log({boards:result.boards.length,page:result.source.pageId});
}
}

export function main(argv=process.argv.slice(2)){const mode=argv[0]||'inspect';if(['refresh-plan','refresh','refresh-layouts','refresh-check','refresh-export'].includes(mode))return runRefresh(mode,argv.slice(1));if(argv.length>1)throw Error('Unexpected legacy arguments');if(!['inspect','pages','components','layouts','figure','refine','refine-layouts','export'].includes(mode))throw Error('Unknown mode '+mode);return legacyMain(mode);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
