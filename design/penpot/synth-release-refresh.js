const d=storage.synthRelease,expected=__DEPENDENCIES__,figure=__FIGURE__;
if(!d)throw Error('Load synth release helper first');
const norm=s=>s.name.replace(/\s*\/\s*/g,'/');
const one=(root,name)=>{const found=root.children.filter(s=>norm(s)===name);if(found.length!==1)throw Error('Missing/ambiguous '+name);return found[0];};
const main=name=>{const c=d.components[name];if(!c||c.path!=='OpenSP / Releases')throw Error('Missing release main '+name);return c.mainInstance();};
const sectionFor=name=>d.copy.sections.find(s=>name==='Synth release '+s.id+(name.endsWith('(Mobile)')?' (Mobile)':' (Desktop)'));
const slots=section=>[...section.paragraphs.map((text,i)=>({key:'paragraph/'+i,text})),...(section.rows||[]).map((row,i)=>({key:'row/'+i,text:row.label+'\n'+row.text})),
  ...(section.steps||[]).map((text,i)=>({key:'step/'+i,text:(i+1)+'. '+text})),...(section.commands||[]).map((row,i)=>({key:'command/'+i,text:row.label+'\n'+row.text})),
  ...(section.note?[{key:'note',text:section.note}]:[])];
d.refreshAudit=()=>{
  d.guard('Release components');
  for(const row of expected.releaseMains){const c=d.components[row.name];if(!c||c.id!==row.id||c.path!=='OpenSP / Releases'||c.mainInstance().id!==row.mainId||c.mainInstance().width!==row.width)throw Error('Changed native main '+row.name);}
  for(const row of expected.shared){const c=d.components[row.name];if(!c||c.id!==row.id)throw Error('Changed shared main '+row.name);}
  for(const row of expected.typography)if(d.types[row.name]?.id!==row.id)throw Error('Changed typography '+row.name);
  for(const row of expected.colors)if(d.colors[row.name]?.id!==row.id)throw Error('Changed color '+row.name);
  return {fileId:penpot.currentFile.id,existingMains:expected.releaseMains.length,sourceOnly:true,nativeRefreshed:false};
};
d.refreshPatterns=async()=>{
  d.guard('Release components');
  const section=d.copy.sections.find(s=>s.id==='patterns');if(!section)throw Error('Missing pattern copy');
  const result=[];
  for(const mobile of [false,true]){
    const name='Synth release patterns'+(mobile?' (Mobile)':' (Desktop)');
    if(d.components[name]){if(d.components[name].path!=='OpenSP / Releases')throw Error('Foreign pattern main');result.push({name,id:d.components[name].id,existed:true});continue;}
    // Use a free row below existing mains, preserving every existing board position.
    const bottom=Math.max(0,...penpot.root.children.map(s=>s.y+s.height));
    const index=Math.ceil((bottom+80)/2200)*3+(mobile?1:0);
    result.push(await d.section(section,mobile,index));
  }
  return result;
};
d.refreshMain=name=>{
  d.guard('Release components');const b=main(name),mobile=name.endsWith('(Mobile)'),section=sectionFor(name),w=mobile?342:760;
  const putBody=(key,text)=>{
    const matches=b.children.filter(s=>norm(s)===key);if(matches.length>1)throw Error('Ambiguous body '+key);let s=matches[0];
    if(!s)s=d.body(b,key,text,0,b.height,w,mobile);
    if(!s.isComponentHead()||s.component()?.id!==d.components['Article paragraph'].id)throw Error('Unlinked body '+key);
    s.hidden=false;d.find(s,'Paragraph').characters=text;
  };
  if(name.includes('introduction')){
    one(b,'copy/title').characters=d.copy.title;
    putBody('copy/introduction',d.copy.introduction);putBody('copy/status',d.copy.status);
    one(b,'copy/featureLink').characters=d.copy.featureLink.label;
    one(b,'copy/guideLink').characters=d.copy.guideLink.label;
    if(d.copy.patcherLink)putBody('copy/patcherLink',d.copy.patcherLink.label);
  }else{
    if(!section)throw Error('Unknown source section '+name);
    if(section.id==='recording'){const figureName='openSynth recording figure'+(mobile?' (Mobile)':' (Desktop)'),linked=b.children.filter(s=>s.isComponentHead()&&s.component()?.id===d.components[figureName]?.id);if(linked.length!==1)throw Error('Missing/ambiguous linked recording figure');checkCopy(linked[0],figureName);}
    const headings=b.children.filter(s=>s.isComponentHead()&&s.component()?.id===d.components['Article heading'].id);
    if(headings.length!==1)throw Error('Missing/ambiguous linked heading');d.find(headings[0],'Heading').characters=section.heading;
    const wanted=new Set(slots(section).map(s=>'copy/'+section.id+'/'+s.key));
    for(const s of b.children)if(norm(s).startsWith('copy/'+section.id+'/')&&!wanted.has(norm(s)))s.hidden=true;
    for(const row of slots(section))putBody('copy/'+section.id+'/'+row.key,row.text);
  }
  return d.refitMain(name);
};
d.refreshFigure=name=>{
  d.guard('Release components');const b=main(name),states=['chooser','armed','recording','saving'];
  if(figure.captions.length!==states.length)throw Error('Figure state/caption count differs');
  for(const [i,state] of states.entries())one(b,'Figure caption '+state).characters=figure.captions[i];
  const evidence=one(b,'Figure provenance');evidence.characters=figure.evidence;
  const height=Math.max(evidence.height,d.height(figure.evidence,evidence.width,Number(evidence.fontSize)));
  evidence.resize(evidence.width,height);b.resize(b.width,Math.max(b.height,evidence.y-b.y+height+16));
  return {name,id:b.id,width:b.width,height:b.height,screenGeometryChanged:false};
};
const checkCopy=(instance,name)=>{
  if(instance.component()?.id!==d.components[name]?.id||!instance.isComponentCopyInstance())throw Error('Wrong linked instance '+name);
  const source=main(name);if(instance.width!==source.width||instance.height!==source.height)throw Error('Wait for bounds propagation: '+name);
  const check=(key,text)=>{const s=one(instance,key),t=s.type==='text'?s:d.find(s,'Paragraph');if(s.hidden||t.characters!==text)throw Error('Wait for main propagation: '+name+'/'+key);};
  if(name.includes('introduction')){
    check('copy/title',d.copy.title);check('copy/introduction',d.copy.introduction);check('copy/status',d.copy.status);
    check('copy/featureLink',d.copy.featureLink.label);check('copy/guideLink',d.copy.guideLink.label);if(d.copy.patcherLink)check('copy/patcherLink',d.copy.patcherLink.label);
  }else if(name.startsWith('openSynth recording figure')){
    for(const [i,state] of ['chooser','armed','recording','saving'].entries())check('Figure caption '+state,figure.captions[i]);check('Figure provenance',figure.evidence);
  }else{
    const section=sectionFor(name);if(!section)throw Error('Unknown section');
    const heading=instance.children.find(s=>s.isComponentHead()&&s.component()?.id===d.components['Article heading'].id);
    if(!heading||d.find(heading,'Heading').characters!==section.heading)throw Error('Wait for heading propagation');
    for(const row of slots(section))check('copy/'+section.id+'/'+row.key,row.text);
    const wanted=new Set(slots(section).map(s=>'copy/'+section.id+'/'+s.key));for(const s of instance.children)if(norm(s).startsWith('copy/'+section.id+'/')&&!wanted.has(norm(s))&&!s.hidden)throw Error('Wait for hidden-slot propagation');
  }
};
d.refreshLayoutAudit=()=>{
  d.guard('Synth release');
  for(const row of expected.layouts){const b=penpot.root.children.find(b=>b.id===row.id);if(!b||b.name!==row.name||b.width!==row.width)throw Error('Changed release layout '+row.name);}
  return {boards:expected.layouts.length,fileId:penpot.currentFile.id};
};
const layoutState=(id,allowInsert)=>{
  d.guard('Synth release');const row=expected.layouts.find(b=>b.id===id),b=penpot.root.children.find(b=>b.id===id);
  if(!row||!b||b.name!==row.name||b.width!==row.width)throw Error('Unknown release layout');
  const meta=JSON.parse(b.getPluginData('opensp-synth-release')),suffix=meta.mobile?' (Mobile)':' (Desktop)';
  if(meta.schema!==1||meta.mobile!==row.mobile||meta.dark!==row.dark||meta.releaseReady!==false||meta.recordingToPad!==false||meta.sharedLinkedComponents!==true)throw Error('Changed layout contract');
  // Refuse stale copies before placing/refitting; never overwrite detached/stale instance copy locally.
  const names=['Synth release introduction'+suffix,...d.copy.sections.filter(s=>s.id!=='patterns').map(s=>'Synth release '+s.id+suffix)];
  for(const name of names){const heads=b.children.filter(s=>s.isComponentHead()&&s.component()?.id===d.components[name]?.id);if(heads.length!==1)throw Error('Missing/duplicate linked section '+name);checkCopy(heads[0],name);}
  const patternName='Synth release patterns'+suffix,heads=b.children.filter(s=>s.isComponentHead()&&s.component()?.id===d.components[patternName]?.id);
  if(heads.length>1)throw Error('Duplicate pattern instance');
  if(!heads.length){if(!allowInsert)throw Error('Missing linked pattern instance');d.instance(patternName,b,meta.mobile?24:384,b.height);return {id,linkedPatternInserted:true,refitPending:true};}
  checkCopy(heads[0],patternName);
  const recording=b.children.find(s=>s.component()?.name==='Synth release recording'+suffix),figureName='openSynth recording figure'+suffix;
  const linkedFigure=recording.children.find(s=>s.isComponentHead()&&s.component()?.id===d.components[figureName]?.id);
  if(!linkedFigure)throw Error('Missing linked recording figure');checkCopy(linkedFigure,figureName);
  return {id,b,propagationChecked:true};
};
d.refreshLayout=id=>{const state=layoutState(id,true);if(state.refitPending)return state;return {...d.refitLayout(id),propagationChecked:true};};
d.refreshVerifyLayout=id=>{const {b,...state}=layoutState(id,false);return {...state,name:b.name,nativeVisualReviewed:false};};
return {loaded:true,kind:'source-bound-refresh-helpers',nativeQualified:false};
