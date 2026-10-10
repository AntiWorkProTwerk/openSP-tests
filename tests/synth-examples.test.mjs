import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExample,loadSound,setPage,knobPacket,note,valuePress,valueTurn,rec,renderExample,envelopeTimes,sounds} from '../src/lib/synth-examples.ts';

test('initial and repeated physical packets preserve defaults; motion controls only the active parameter',()=>{
  const s=createExample(),defaults=[...s.values];
  assert.equal(knobPacket(s,0,64),false);assert.deepEqual(s.values,defaults);
  assert.equal(knobPacket(s,0,64),false);assert.deepEqual(s.values,defaults);
  assert.equal(knobPacket(s,0,127),true);assert.equal(s.values[0],4095);assert.deepEqual(s.values.slice(1),defaults.slice(1));
  setPage(s,2);assert.equal(knobPacket(s,0,127),false);assert.equal(s.values[6],defaults[6]);
  loadSound(s,6);assert.equal(s.values[6],2600);assert.equal(knobPacket(s,0,127),false);assert.equal(s.values[6],2600);
  assert.equal(knobPacket(s,0,0),true);assert.equal(s.values[6],0);assert.equal(s.values[7],2400);
});
test('VALUE cycles four pages while held turning clamps octave without changing page',()=>{
  const s=createExample();for(let i=0;i<4;i++)valuePress(s);assert.equal(s.page,0);
  for(let i=0;i<10;i++)valueTurn(s,1,true);assert.equal(s.octave,2);assert.equal(s.page,0);assert.equal(s.preset,0);
  for(let i=0;i<10;i++)valueTurn(s,-1,true);assert.equal(s.octave,-2);assert.equal(s.page,0);
  valueTurn(s,1);assert.equal(s.preset,1);assert.equal(s.octave,0);
});
test('Options has sound, inline voice and Logo; voice direction matches source',()=>{
  const s=createExample();s.screen='menu';valueTurn(s,1);valuePress(s);assert.equal(s.screen,'voice');
  valueTurn(s,-1);valuePress(s);assert.equal(s.mono,true);assert.equal(s.screen,'menu');
  valuePress(s);valueTurn(s,1);valuePress(s);assert.equal(s.mono,false);
  valueTurn(s,1);valuePress(s);assert.equal(s.screen,'logo');
});
test('REC consumes an empty destination press, refuses occupied pads and never invents SAVE success',()=>{
  const s=createExample();rec(s);assert.equal(s.screen,'choose');note(s,0,true);assert.equal(s.screen,'choose');assert.deepEqual(s.notes,[]);
  note(s,1,true);assert.equal(s.screen,'armed');assert.equal(s.destination,1);assert.deepEqual(s.notes,[]);
  rec(s);assert.equal(s.screen,'recording');note(s,4,true);assert.deepEqual(s.notes,[4]);rec(s);assert.equal(s.screen,'saving');assert.deepEqual(s.notes,[]);assert.match(s.message,/unverified/);
});
test('pattern selection consumes pads, queues other selections, stops the same playing slot and resumes REC',()=>{
  const s=createExample();s.screen='patterns';note(s,1,true);assert.equal(s.screen,'patterns');assert.deepEqual(s.notes,[]);
  note(s,0,true);assert.equal(s.pattern,0);assert.equal(s.screen,'play');assert.deepEqual(s.notes,[]);
  s.screen='patterns';s.patternReturn='recording';note(s,4,true);assert.equal(s.queued,4);assert.equal(s.screen,'recording');
  s.screen='patterns';note(s,0,true);assert.equal(s.pattern,null);assert.equal(s.queued,null);
});
test('HP12 filter diagrams rise while LP diagrams fall, and LFO extrema stay within the native schematic',()=>{
  const s=createExample(),pixel=(frame,x,y)=>frame[y*128+x];
  s.values[0]=1500;s.values[1]=0;s.values[2]=0;let frame=renderExample(s);
  assert.equal(pixel(frame,4,39),1);assert.equal(pixel(frame,4,43),0);assert.equal(pixel(frame,95,43),1);assert.equal(pixel(frame,95,39),0);
  // All current presets use LP12/LP24. Inject a supported HP12 renderer fixture,
  // then restore original source data rather than inventing a shipped HP sound.
  const preset=sounds[s.preset],filter=preset.filter;
  try{preset.filter=2;frame=renderExample(s);
    assert.equal(pixel(frame,4,43),1);assert.equal(pixel(frame,4,39),0);assert.equal(pixel(frame,95,39),1);assert.equal(pixel(frame,95,43),0);
  }finally{preset.filter=filter;}
  setPage(s,3);s.values[9]=4095;s.values[10]=4095;frame=renderExample(s);
  assert.equal(pixel(frame,3,39),1);assert.equal(pixel(frame,7,35),1);assert.equal(pixel(frame,15,43),1);
});
test('all presets, pages, recorder/pattern states and 64 logo phases have bounded original pixel output',()=>{
  const s=createExample();let changed=0,previous;
  for(let preset=0;preset<16;preset++)for(let page=0;page<4;page++){
    loadSound(s,preset);setPage(s,page);note(s,3,true);const output=renderExample(s);assert.equal(output.length,8192);assert(output.some(Boolean));assert(output.every(x=>x===0||x===1));assert(envelopeTimes(s).every(x=>x>=1&&x<=4020));
  }
  for(const screen of ['menu','sound','voice','choose','armed','recording','saving','patterns']){s.screen=screen;assert(renderExample(s).some(Boolean));}
  s.screen='logo';for(let phase=0;phase<64;phase++){const output=renderExample(s,phase);assert(output.some(Boolean));if(previous&&!Buffer.from(output).equals(Buffer.from(previous)))changed++;previous=output;}
  assert(changed>50);
});
