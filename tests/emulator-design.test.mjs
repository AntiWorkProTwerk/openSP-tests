import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>JSON.parse(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'));
const mains=read('design/penpot/emulator-components.json');
const layouts=read('design/penpot/emulator-layouts.json');
const footer=read('design/penpot/emulator-footer-components.json');
const copy=read('src/content/emulator.json');
const colors=read('design/penpot/production.json').colors;
const walk=s=>[s,...(s.children||[]).flatMap(walk)];
const normalized=name=>name.replace(/\s*\/\s*/g,'/');
const component=name=>{const c=mains.components.find(c=>c.name===name);assert.ok(c,`Missing native main: ${name}`);return c;};
const fileId='24d9d841-759d-81bc-8008-b518bc70d8b3';
const instrumentId='687117da-a825-80bd-8008-b5694305e7b0';
const utility=footer.components.find(c=>c.name==='Utility link');

test('native emulator mains have unique identities and retain their editable structure',()=>{
  assert.equal(mains.source.fileId,fileId);
  assert.equal(mains.source.kind,'native-component-api-export');
  assert.equal(mains.components.length,16);
  assert.equal(new Set(mains.components.map(c=>c.id)).size,16);
  assert.equal(new Set(mains.components.map(c=>c.mainId)).size,16);
  for(const c of mains.components){
    assert.equal(c.path,'OpenSP / Emulator');
    assert.equal(c.shape.id,c.mainId);
    assert.equal(c.shape.componentId,c.id);
    assert.equal(c.shape.type,'board');
    assert.ok(c.shape.children.length>0,c.name);
  }
});

test('each responsive session keeps the shared Instrument and an empty linked OLED',()=>{
  const blank=component('Emulator blank OLED');
  assert.equal(blank.shape.width,128);
  assert.equal(blank.shape.height,64);
  assert.equal(walk(blank.shape).filter(s=>s.type==='text').length,0);
  assert.equal(blank.shape.children.length,1);
  assert.equal(blank.shape.children[0].fills[0].color,'#000000');
  for(const size of ['Desktop','Mobile']){
    const shapes=walk(component(`Emulator session (${size})`).shape);
    const instrument=shapes.find(s=>s.name==='Instrument');
    assert.equal(instrument.componentId,instrumentId);
    assert.ok(Math.abs(instrument.height/instrument.width-570/400)<0.0001);
    const slot=shapes.find(s=>s.name==='OLED content slot');
    assert.equal(slot.componentId,blank.id);
    assert.ok(Math.abs(slot.width/slot.height-2)<0.0001);
    assert.ok(shapes.some(s=>s.name==='OLED circular aperture'));
    for(const group of ['execution','inputs','USB','SD images'])assert.ok(shapes.some(s=>s.componentId===component(`Emulator ${group} (${size})`).id));
  }
});

test('pad inputs use sixteen linked action instances with distinct labels',()=>{
  const action=component('Emulator action');
  for(const size of ['Desktop','Mobile']){
    const shapes=walk(component(`Emulator inputs (${size})`).shape);
    const actions=shapes.filter(s=>s.componentId===action.id);
    const pads=actions.filter(s=>walk(s).some(t=>/^copy\/pad\/\d+$/.test(normalized(t.name))));
    assert.equal(pads.length,16);
    assert.deepEqual(pads.flatMap(s=>walk(s).filter(t=>/^copy\/pad\/\d+$/.test(normalized(t.name))).map(t=>t.text)),Array.from({length:16},(_,i)=>`Pad ${i+1}`));
    assert.ok(pads.every(s=>s.height>=44));
    assert.equal(shapes.find(s=>normalized(s.name)==='Value/control').text,'VALUE PRESS');
  }
});

test('optional SD controls retain shared mains and theme assets in every session layout',()=>{
  const action=component('Emulator action');
  const saved=read('design/penpot/emulator-sd-propagation.json');
  assert.equal(saved.source.fileId,fileId);assert.equal(saved.mains.length,2);assert.equal(saved.layouts.length,4);
  for(const c of saved.mains)assert.deepEqual(c.metadata,{revision:'2026-10-03',readOnly:true,staged:true,slotCount:2,minimum:262144,maximum:134217728,unit:262144,firmwareProvided:false});
  for(const size of ['Desktop','Mobile']){
    const sd=component(`Emulator SD images (${size})`),shapes=walk(sd.shape);
    for(const key of ['sdImages','sdNote','sd1File','sd2File','sdChangeNote'])assert.equal(shapes.find(s=>normalized(s.name)==='copy/'+key)?.text,copy[key]);
    assert.equal(shapes.filter(s=>normalized(s.name)==='copy/sdNoImage').length,2);
    const remove=shapes.filter(s=>s.componentId===action.id);assert.equal(remove.length,2);assert.ok(remove.every(s=>s.height>=44));
    for(const b of layouts.boards.filter(b=>(b.metadata.mobile?'Mobile':'Desktop')===size)){
      assert.equal(b.linkedComponents.filter(s=>s.componentId===sd.id).length,1);
      const propagation=saved.layouts.find(p=>p.id===b.id);assert.ok(propagation);assert.equal(propagation.sd.length,1);assert.equal(propagation.sd[0].componentId,sd.id);assert.equal(propagation.sd[0].linked,true);
      for(const t of propagation.sd[0].text){
        const muted=['copy/sdNote','copy/sdNoImage','copy/sdChangeNote'].includes(normalized(t.name));
        const token=b.metadata.dark?(muted?'Dark muted':'Dark ink'):(muted?'Muted':'Ink');
        assert.equal(t.fills[0].ref,colors.find(c=>c.name===token).id,`${b.name}: ${t.name}`);
      }
      for(const t of b.text.filter(t=>['copy/sdImages','copy/sdNote','copy/sdChangeNote'].includes(normalized(t.name)))){
        assert.ok(t.ink&&t.ink.height<=t.height+2&&t.ink.width<=t.width+2,`${b.name}: ${t.name}`);
      }
    }
  }
});

test('four linked layouts cover both themes and sizes without invented firmware output',()=>{
  assert.equal(layouts.source.fileId,fileId);
  assert.equal(layouts.boards.length,4);
  assert.equal(new Set(layouts.boards.map(b=>`${b.metadata.mobile}/${b.metadata.dark}`)).size,4);
  for(const b of layouts.boards){
    assert.equal(b.metadata.state,'empty');
    assert.equal(b.metadata.firmwareProvided,false);
    assert.equal(b.metadata.linked,true);
    assert.equal(b.width,b.metadata.mobile?390:1440);
    assert.equal(b.linkedComponents.length,101);
    assert.ok(b.linkedComponents.every(s=>s.componentId&&s.copy===true));
    assert.deepEqual({stage:b.updateMetadata.stage,board:b.updateMetadata.board,mobile:b.updateMetadata.mobile,
      dark:b.updateMetadata.dark,linked:b.updateMetadata.linked,firmwareProvided:b.updateMetadata.firmwareProvided},
    {stage:'layout-complete',board:b.id,mobile:b.metadata.mobile,dark:b.metadata.dark,linked:true,firmwareProvided:false});
    for(const key of ['updateHeading','updateNote','updateImage','updateManifest','updateNoCandidate','updateStart',
      'updateCancel','updateWaiting','updateNoReceipt','updateReceipt','updateCancelNote','advancedReports']){
      const rows=b.text.filter(t=>normalized(t.name)==='copy/'+key);assert.equal(rows.length,1,`${b.name}: ${key}`);assert.equal(rows[0].text,copy[key]);
    }
    for(const key of ['updateStart','updateCancel']){
      const label=b.text.find(t=>normalized(t.name)==='copy/'+key);
      const action=b.linkedComponents.find(s=>s.componentId===component('Emulator action').id&&Math.abs(s.x+12-label.x)<0.01&&Math.abs(s.y+10-label.y)<0.01);
      assert.ok(action,`${b.name}: linked ${key}`);assert.equal(action.copy,true);assert.ok(action.height>=44);
    }
    assert.equal(b.linkedComponents.filter(s=>s.componentId===component(`Emulator status (${b.metadata.mobile?'Mobile':'Desktop'})`).id).length,1);
    assert.ok(b.linkedComponents.some(s=>s.componentId===instrumentId));
    assert.ok(b.linkedComponents.some(s=>s.componentId===component('Emulator blank OLED').id));
    assert.ok(b.linkedComponents.some(s=>s.componentId===component(`Emulator session (${b.metadata.mobile?'Mobile':'Desktop'})`).id));
    assert.ok(b.linkedComponents.some(s=>s.componentId===utility.id));
    for(const item of copy.diagnostics){
      const value=b.text.find(t=>normalized(t.name)===`diagnostic/${item.key}/initial`);
      assert.equal(value?.text,item.initial,`${b.name}: ${item.key}`);
    }
  }
});

test('visible native copy agrees with the browser source and reading text fits its frames',()=>{
  for(const b of layouts.boards){
    const reading=b.text.filter(t=>t.size>=11);
    assert.equal(reading.length,95);
    let shared=0;
    for(const t of reading){
      const key=normalized(t.name).replace(/^copy\//,'');
      if(normalized(t.name).startsWith('copy/')&&typeof copy[key]==='string'){
        assert.equal(t.text,copy[key],`${b.name}: ${key}`);shared++;
      }
      assert.ok(['Arimo','Cousine'].includes(t.font),t.name);
      assert.ok(t.x>=-1&&t.y>=-1&&t.x+t.width<=b.width+1&&t.y+t.height<=b.height+1,`${b.name}: ${t.name} outside board`);
      assert.ok(t.ink,`${b.name}: ${t.name} missing ink bounds`);
      assert.ok(t.ink.width<=t.width+2&&t.ink.height<=t.height+2,`${b.name}: ${t.name} text exceeds frame`);
    }
    assert.ok(shared>=30,`${b.name}: shared copy not found`);
  }
});

test('interaction examples are linked and explicitly illustrative',()=>{
  const states=read('design/penpot/emulator-states.json');
  assert.equal(states.source.fileId,fileId);
  assert.equal(states.metadata.illustrative,true);
  assert.equal(states.metadata.firmwareProvided,false);
  assert.deepEqual(states.metadata.states,['ready','loading','paused','fault']);
  assert.ok(states.text.some(t=>t.text==='Design examples. Firmware does not run on the Penpot canvas.'));
  assert.equal(states.linkedComponents.filter(s=>s.componentId===component('Emulator status (Desktop)').id).length,8);
  assert.equal(states.linkedComponents.filter(s=>s.componentId===component('Emulator status (Mobile)').id).length,4);
  const keys=['image','upload','error','boot-verified'],updates=states.linkedComponents.filter(s=>s.updateMetadata!==null&&s.updateMetadata!==undefined);
  assert.equal(updates.length,8);assert.equal(new Set(updates.map(s=>`${s.updateMetadata.mobile}/${s.updateMetadata.key}`)).size,8);
  for(const mobile of [false,true])for(const key of keys){
    const rows=updates.filter(s=>s.updateMetadata.mobile===mobile&&s.updateMetadata.key===key);assert.equal(rows.length,1);
    const status=rows[0];assert.equal(status.copy,true);assert.equal(status.componentId,component(`Emulator status (${mobile?'Mobile':'Desktop'})`).id);
    assert.equal(normalized(status.name),`Illustrative APP1 update/${mobile}/${key}/linked status`);
    assert.deepEqual(status.updateMetadata,{illustrative:true,key,mobile,completedReceipt:false,firmwareProvided:false});
    assert.equal(states.text.filter(t=>normalized(t.name)===`Illustrative APP1 update/${mobile}/${key}`).length,1);
  }
  assert.equal(states.text.filter(t=>t.name==='Update phase').length,8);
  for(const key of keys)assert.equal(states.text.filter(t=>t.name==='Update phase'&&t.text===(key==='error'?'Update stopped.':copy.updatePhaseLabels[key])).length,2);
  assert.equal(states.text.filter(t=>t.name==='Update status message'&&t.text===copy.updateNoReceipt).length,4);
  assert.equal(states.text.filter(t=>t.name==='Update status message'&&t.text===copy.updateReceipt).length,2);
  for(const t of states.text)assert.ok(t.x>=-1&&t.y>=-1&&t.x+t.width<=states.width+1&&t.y+t.height<=states.height+1,`${t.name} outside state sheet`);
  assert.deepEqual(states.text.filter(t=>t.name==='State label').map(t=>t.text),states.metadata.states.map(key=>copy.stateLabels[key]));
  for(const t of states.text)assert.ok(t.ink&&t.ink.width<=t.width+2&&t.ink.height<=t.height+2,`${t.name} exceeds state frame`);
});

test('shared Footer utility stays linked across all eighty existing layout instances',()=>{
  const propagation=read('design/penpot/emulator-footer-propagation.json');
  const bounds=read('design/penpot/emulator-footer-bounds.json');
  assert.equal(propagation.complete,true);
  assert.equal(propagation.instances.length,80);
  assert.equal(new Set(propagation.instances.map(f=>f.id)).size,80);
  assert.equal(propagation.instances.filter(f=>f.mobile).length,40);
  assert.equal(propagation.instances.filter(f=>f.dark).length,40);
  assert.ok(propagation.instances.every(f=>f.linked&&f.textPreserved&&f.utilityId===utility.id));
  assert.equal(bounds.pages.length,5);
  const saved=bounds.pages.flatMap(p=>p.footers);
  assert.equal(saved.length,80);
  assert.deepEqual(new Set(saved.map(f=>f.id)),new Set(propagation.instances.map(f=>f.id)));
  for(const f of saved){
    const link=f.links.find(s=>s.componentId===utility.id);
    assert.ok(link,`${f.id}: missing utility link`);
    assert.ok(link.x>=-1&&link.y>=0&&link.x+link.width<=f.width+1&&link.y+link.height<=f.height+1,`${f.id}: utility outside footer`);
    assert.equal(f.text.find(t=>t.name==='Utility label')?.text,copy.title);
    for(const t of f.text){
      if(!t.ink||t.width<=0||t.height<=0)continue;
      assert.ok(t.ink.width<=t.width+2&&t.ink.height<=t.height+2,`${f.id}: ${t.name} clipped`);
    }
    const record=propagation.instances.find(r=>r.id===f.id);
    assert.equal(f.text.find(t=>t.name==='Utility label').colors[0].ref,colors.find(c=>c.name===(record.dark?'Dark ink':'Ink')).id);
  }
});
