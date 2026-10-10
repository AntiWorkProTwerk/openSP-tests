// Extend existing native session mains with linked read-only SD controls.
if(penpot.currentFile?.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
const d=storage.emulatorDesign;
if(!d)throw Error('Load emulator-library.js first');
d.sd=mobile=>d.make('Emulator SD images'+(mobile?' (Mobile)':' (Desktop)'),mobile?342:1312,600,mobile?15:14,b=>{
 const w=b.width;d.rect(b,'SD images rule',0,0,w,1);d.copyText(b,'sdImages',0,16,w,18);
 let y=64,t=d.copyText(b,'sdNote',0,y,mobile?w:1032,16,'Caption','Muted');y+=t.height+24;
 const top=y,cw=mobile?w:(w-24)/2;
 for(const slot of [1,2]){
  const x=mobile?0:(slot-1)*(cw+24),sy=mobile?y:top;
  d.field(b,'sd'+slot+'File','Choose file  /  No file chosen',x,sy,cw);
  d.copyText(b,'sdNoImage',x,sy+92,cw-144,13,'Label','Muted');
  d.button(b,'sdRemove',x+cw-128,sy+84,128,false,true);
  if(mobile)y=sy+152;
 }
 if(!mobile)y=top+152;
 t=d.copyText(b,'sdChangeNote',0,y,mobile?w:1032,14,'Caption','Muted');b.resize(w,y+t.height);
 b.setPluginData('opensp-sd-ui',JSON.stringify({revision:'2026-10-03',readOnly:true,staged:true,slotCount:2,minimum:262144,maximum:134217728,unit:262144,firmwareProvided:false}));
});
d.attachSdMain=mobile=>{
 d.guard('Emulator components');
 const session=d.components['Emulator session'+(mobile?' (Mobile)':' (Desktop)')].mainInstance();
 if(session.getPluginData('opensp-sd-ui'))throw Error('SD main already extended; inspect before repeating');
 const inputs=session.children.find(s=>s.component()?.name==='Emulator inputs'+(mobile?' (Mobile)':' (Desktop)'));
 const usb=session.children.find(s=>s.component()?.name==='Emulator USB'+(mobile?' (Mobile)':' (Desktop)'));
 if(!inputs||!usb||session.flex||session.grid)throw Error('Unexpected session structure');
 const y=inputs.y-session.y,sd=d.instance('Emulator SD images'+(mobile?' (Mobile)':' (Desktop)'),session,0,y);
 const delta=sd.height+32;inputs.y+=delta;usb.y+=delta;session.resize(session.width,session.height+delta);
 session.setPluginData('opensp-sd-ui',JSON.stringify({revision:'2026-10-03',delta,sdId:sd.id,linked:true}));
 return {session:session.id,sd:sd.id,componentId:sd.component()?.id,delta,height:session.height};
};
d.fitSdLayout=name=>{
 d.guard('Emulator');
 const b=penpot.root.children.find(s=>s.name===name),metadata=JSON.parse(b?.getPluginData('opensp-emulator')||'null');
 if(!b||!metadata||b.flex||b.grid)throw Error('Unexpected layout');
 if(b.getPluginData('opensp-sd-ui'))throw Error('SD layout already fit; inspect before repeating');
 const mobile=metadata.mobile,dark=metadata.dark;
 const session=b.children.find(s=>s.component()?.name==='Emulator session'+(mobile?' (Mobile)':' (Desktop)'));
 const sd=session?.children.find(s=>s.component()?.name==='Emulator SD images'+(mobile?' (Mobile)':' (Desktop)'));
 if(!session||!sd)throw Error('Linked SD main has not propagated');
 const main=d.components[session.component().name].mainInstance();
 session.resize(main.width,main.height);
 const footer=b.children.find(s=>s.component()?.name==='Footer');if(!footer)throw Error('Missing Footer');
 footer.y=session.y+session.height+32;b.resize(b.width,footer.y-b.y+footer.height+(mobile?40:64));
 const map={Paper:'Dark paper',Ink:'Dark ink',Muted:'Dark muted',Line:'Dark line',Surface:'Dark surface'};
 if(dark)for(const s of [sd,...penpotUtils.findShapes(()=>true,sd)]){
  s.fills=s.fills.map(f=>{const name=Object.keys(map).find(n=>f.fillColorRefId===d.colors[n].id);return name?{...f,...d.colors[map[name]].asFill()}:f;});
  s.strokes=s.strokes.map(f=>{const name=Object.keys(map).find(n=>f.strokeColorRefId===d.colors[n].id);return name?{...f,...d.colors[map[name]].asStroke(),strokeWidth:f.strokeWidth}:f;});
 }
 b.setPluginData('opensp-sd-ui',JSON.stringify({revision:'2026-10-03',session:session.id,sd:sd.id,componentId:sd.component()?.id,linked:true,mobile,dark}));
 return {board:b.id,name,height:b.height,sessionHeight:session.height,sd:sd.id,linked:sd.isComponentCopyInstance()};
};
return {loaded:true,page:penpot.currentPage.name};
