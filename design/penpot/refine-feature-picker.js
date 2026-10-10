if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
const d=storage.featurePicker;
const all=penpotUtils.findShapes(()=>true,penpot.root);
const heads=all.filter(s=>s.isComponentHead?.()&&s.component()?.name?.startsWith('Feature shortcut'));
for(const b of heads){
  const mobile=b.component().name.includes('Mobile'),w=b.width;
  let dark=false;for(let p=b;p;p=p.parent)if(p.fills?.some(f=>f.fillColorRefId===d.colors['Dark paper'].id))dark=true;
  const find=name=>penpotUtils.findShape(s=>s.name===name,b);
  const text=(name,value,x,y,cw,muted=false)=>{let s=find(name);if(!s)s=d.text(b,name,value,x,y,cw,14,'Caption',muted?'Muted':'Ink',24);else{s.characters=value;d.put(s,b,x,y,cw,24);}return s;};
  const rect=(name,x,y,cw)=>{let s=find(name);if(!s)s=d.rect(b,name,x,y,cw,44,'Paper','Line');else d.put(s,b,x,y,cw,44);};
  b.resize(w,mobile?344:248);
  text('Shortcut method label','Open with',0,50,w,true);rect('Shortcut method field',0,76,mobile?w:270);text('Shortcut method','Button shortcut',12,86,mobile?w-24:246);
  const fields=mobile?[[0,162,342],[0,248,164],[178,248,164]]:[[0,158,270],[286,158,270],[572,158,292]];
  for(const [i,[x,y,cw]]of fields.entries()){text('Shortcut label '+i,['Hold first','Then press, or hold','Third (optional)'][i],x,y-26,cw,true);rect('Shortcut field '+i,x,y,cw);d.put(find('Shortcut control '+i),b,x+12,y+10,cw-24,24);}
  const scope=find('Shortcut scope');d.put(scope,b,0,mobile?304:214,w,32);
  if(dark)d.dark(b);
}
for(const b of penpot.root.children.filter(s=>s.name.startsWith('Feature picker /'))){
  if(b.getPluginData('opensp-feature-picker-refinement')==='1')continue;
  const shortcut=b.children.find(s=>s.isComponentHead?.()&&s.component()?.name?.startsWith('Feature shortcut'));
  if(!shortcut)throw Error('Missing shortcut in '+b.name);
  const delta=b.name.includes('Mobile')?104:116;
  for(const s of b.children)if(s.id!==shortcut.id&&s.y>shortcut.y)s.y+=delta;
  b.resize(b.width,b.height+delta);b.setPluginData('opensp-feature-picker-refinement','1');
}
for(const t of all.filter(s=>s.type==='text'&&s.name==='Button label'&&s.characters==='Upload over USB-C'))t.characters=d.copy.upload;
return {shortcuts:heads.length,page:penpot.currentPage.name};
