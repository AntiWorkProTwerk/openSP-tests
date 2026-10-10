// openSynth browser patcher: shared mains for its three states and the patch section that uses them.
// Load after synth-release-library.js and opensynth-page-library.js. Copy comes from
// src/content/releases/synth.json (patcher + patch steps); code twin: OpenSynthPatcher.astro.
const lib=penpot.library.local;const d=storage.synthRelease;if(!d?.tile)throw Error('Load opensynth-page-library.js first');
const pc=d.copy.patcher;
const stroke=(s,color,width=1,style='solid')=>{s.strokes=[{...d.colors[color].asStroke(),strokeWidth:width,strokeStyle:style,strokeAlignment:'inner'}];return s;};
const label=(p,name,value,x,y,w,color='Ink',h=20)=>d.text(p,name,value.toUpperCase(),x,y,w,13,'Label',color,h);
// Strokes follow the theme too (d.dark maps fills only).
if(!d.dark0)d.dark0=d.dark;
d.dark=root=>{d.dark0(root);const map={Paper:'Dark paper',Ink:'Dark ink',Muted:'Dark muted',Line:'Dark line',Surface:'Dark surface'};for(const s of[root,...penpotUtils.findShapes(()=>true,root)]){if(s.strokes?.length)s.strokes=s.strokes.map(f=>{const n=Object.keys(map).find(n=>f.strokeColorRefId===d.colors[n].id);return n?{...f,...d.colors[map[n]].asStroke()}:f;});}};
d.patcherStates=['Drop zone','Working','Done'];
// Main names avoid " / " (Penpot would read it as a path). A first run on 9 October 2026 created
// mains named "<State> (Desktop|Mobile)" under OpenSP / Releases; adopt them instead of duplicating.
for(const c of lib.components){const m=/^(Drop zone|Working|Done) \((Desktop|Mobile)\)$/.exec(c.name);if(m&&c.path==='OpenSP / Releases'){const name='openSynth patcher '+c.name;c.name=name;c.path='OpenSP / Releases';const b=c.mainInstance();if(b)b.name=name;d.components[name]=c;}}
// One main per state and size. Instances override nothing but position.
d.patcher=(state,mobile,index)=>d.make('openSynth patcher '+state+(mobile?' (Mobile)':' (Desktop)'),mobile?342:760,400,index,async b=>{
  const w=b.width,pad=mobile?20:32;let y=0;
  if(state==='Drop zone'){
    const zone=d.board('Drop zone',0,0,w,mobile?232:208);b.appendChild(zone);zone.x=b.x;zone.y=b.y;stroke(zone,'Ink',1,'dashed');
    d.text(zone,'Drop title',pc.dropTitle,pad,mobile?28:40,w-pad*2,mobile?21:24,'Caption','Ink',mobile?64:36);
    d.text(zone,'Drop hint',pc.dropHint,pad,mobile?96:82,w-pad*2,16,'Caption','Muted',mobile?50:26);
    const btn=d.board('Choose file button',0,0,mobile?148:128,44);zone.appendChild(btn);btn.x=zone.x+pad;btn.y=zone.y+(mobile?156:124);stroke(btn,'Ink');
    label(btn,'Choose file label',pc.chooseLabel,18,13,mobile?120:100,'Ink');
    y=zone.height;
  }else{
    const done=state==='Done',box=d.board('Progress',0,0,w,mobile?142:132);b.appendChild(box);box.x=b.x;box.y=b.y;stroke(box,'Ink');
    d.text(box,'File name','sp404mk2_sys_v552.zip',pad-8,mobile?18:24,w-pad*2,14,'Code','Ink',22);
    const stages=Object.values(pc.stages),gap=8,sw=(w-pad*2+16-gap*3)/4,activeIndex=done?4:2;
    stages.forEach((s,i)=>{const on=i<=activeIndex;d.rect(box,'Stage rule / '+s,pad-8+i*(sw+gap),mobile?54:60,sw,2,on&&(done||i<activeIndex||i===activeIndex)?'Ink':'Line');label(box,'Stage / '+s,s,pad-8+i*(sw+gap),mobile?64:70,sw,i<=activeIndex?'Ink':'Muted',18).fontSize=mobile?'10':'13';});
    const barW=w-pad*2+16-56,value=done?1:.62;const track=d.rect(box,'Progress track',pad-8,mobile?102:104,barW,8,'Paper');stroke(track,'Ink');d.rect(box,'Progress value',pad-8,mobile?102:104,Math.round(barW*value),8,'Ink');
    d.text(box,'Percent',done?'100%':'62%',w-pad-40,mobile?96:98,48,14,'Code','Ink',20);
    y=box.height+14;
    const status=d.text(b,'Status',done?pc.messages.done:pc.messages.patching,0,y,w,17,'Caption','Ink',mobile?78:28);y+=status.height+18;
    if(done){
      const save=d.board('Download button',0,0,mobile?w:300,52,'Ink');b.appendChild(save);save.x=b.x;save.y=b.y+y;d.text(save,'Download label',pc.saveLabel,mobile?44:24,14,mobile?w-40:260,mobile?17:18,'Caption','Paper',26);y+=68;
      label(b,'SHA256 label',pc.shaLabel,0,y,w,'Muted');y+=24;
      d.text(b,'SHA256 value','909b92107a5c93b50ff2382dfb0c79cec0835319f93829b2576d5f2ff957e718',0,y,w,14,'Code','Ink',mobile?48:24);y+=mobile?60:40;
      d.text(b,'Patch another file',pc.resetLabel,0,y,w,16,'Caption','Ink',26).textDecoration='underline';y+=30;
    }
  }
  b.resize(w,y);
});
// Patch section: steps may carry a link or the patcher; the drop zone state is a linked instance.
if(!d.section0)d.section0=d.section;
d.section=(section,mobile,index)=>{if(section.id!=='patch')return d.section0(section,mobile,index);return d.make('Synth release patch'+(mobile?' (Mobile)':' (Desktop)'),mobile?342:928,2000,index,b=>{const w=b.width;d.rect(b,'Section divider',0,0,w,1);const h=d.heading(b,section.heading,0,32,w,mobile);let y=32+h.height+16;for(const [i,value]of section.paragraphs.entries()){const p=d.body(b,'copy/patch/paragraph/'+i,value,0,y,w,mobile);y+=p.height+16;}
  for(const [i,step]of section.steps.entries()){const text=typeof step==='string'?step:step.text;const p=d.body(b,'copy/patch/step/'+i,(i+1)+'. '+text,0,y,w,mobile);y+=p.height+8;
    if(step.link){const l=d.text(b,'copy/patch/step/'+i+'/link',step.link.label,mobile?0:28,y,w-28,mobile?18:20,'Caption','Ink',32);l.textDecoration='underline';y+=44;}
    if(step.patcher){const inst=d.instance('openSynth patcher Drop zone'+(mobile?' (Mobile)':' (Desktop)'),b,mobile?0:28,y+8);inst.name='openSynth patcher';y+=inst.height+28;}
    y+=12;}
  if(section.note){const p=d.body(b,'copy/patch/note',section.note,0,y,w,mobile);y+=p.height+16;}b.resize(w,y+24);});};
// Review board on the Synth release page: every state, both sizes, both themes, as linked instances.
d.patcherBoard=async()=>{d.guard('Synth release');const name='openSynth patcher / States';const old=penpot.root.children.find(s=>s.name===name);const x=old?.x??(Math.max(...penpot.root.children.map(s=>s.x+s.width))+400);old?.remove();const b=d.board(name,0,0,2400,1800,'Paper');b.x=x;b.y=0;
  let cx=64;for(const dark of [false,true]){const col=d.board(dark?'Dark':'Light',0,0,1100,1700,'Paper');b.appendChild(col);col.x=b.x+cx;col.y=b.y+64;let y=24;label(col,'Theme label',dark?'Dark':'Light',24,y,400);y+=40;
    for(const state of d.patcherStates){label(col,'State label / '+state,state,24,y,400,'Muted');const de=d.instance('openSynth patcher '+state+' (Desktop)',col,24,y+28),mo=d.instance('openSynth patcher '+state+' (Mobile)',col,832,y+28);y+=Math.max(de.height,mo.height)+80;}
    col.resize(1180,y);if(dark)d.dark(col);cx+=1180+64;}
  b.resize(cx,Math.max(...b.children.map(c=>c.height))+128);b.setPluginData('opensp-synth-release',JSON.stringify({schema:2,page:'opensynth-patcher-states',sharedCopy:'src/content/releases/synth.json',code:'src/components/releases/OpenSynthPatcher.astro',sharedLinkedComponents:true}));return {id:b.id,name,width:b.width,height:b.height};};
return {loaded:'patcher',states:d.patcherStates};
