import test from 'node:test';
import assert from 'node:assert/strict';
import {EmulatorSession} from '../src/lib/emulator/session.ts';
import {loadFirmwareImage} from '../src/lib/emulator/image.ts';

// Every CPU step is a finite programmed response. No engine or guest executes.
class FakeCPU {
  totalInstructions=0; backendFailed=false; backendFault=undefined; pc=0x1002;
  calls=[]; actions=[]; closed=false; registers=new Map();
  readRegister(name) {this.calls.push(['read',name]); if(this.closed)throw Error('Closed fake CPU read'); return name==='pc'?this.pc:(this.registers.get(name)??0);}
  readMemory(_address,length) {return new Uint8Array(length);}
  writeRegister(name,value) {this.registers.set(name,value);if(name==='pc')this.pc=value&~1;}
  loadMemory() {} close() {this.closed=true;this.calls.push(['close']);}
  step(limit) {
    this.calls.push(['step',limit]);const action=this.actions.shift();assert(action,'Unexpected fake CPU step');
    const response=action(limit);this.totalInstructions+=response.instructions;
    return {...response,totalInstructions:this.totalInstructions,pc:this.pc};
  }
}
const wfi=()=>({instructions:1,reason:'stopped',sleep:{kind:'wfi',address:0x1000,resumePc:0x1002}});
const budget=n=>({instructions:n,reason:'budget'});
async function fixture(t) {
  const image=await loadFirmwareImage(Uint8Array.of(0xfe,0xe7,0xfe,0xe7),{format:'app1',name:'synthetic.bin'});
  const session=new EmulatorSession(image,{format:'app1',name:'synthetic.bin'});
  session.board.flash.flash.set(image.bytes,0x80000);
  const cpu=new FakeCPU();session.cpu=cpu;session.state='paused';
  const events=[];let powered=true;
  const status=session.board.status.bind(session.board);
  session.board.status=()=>({...status(),powered});
  session.board.tick=n=>{events.push(['board',n]);};
  const clock={cpu,wake:false,deliverable:false,next:null,
    hasWfiWakePending(){events.push(['wakeQuery']);return this.wake;},
    hasDeliverablePending(){events.push(['deliveryQuery']);return this.deliverable;},
    processorTicksToWfiWake(){events.push(['eventQuery']);return this.next;},
    advanceSysTick(n){events.push(['clock',n]);if(this.next!==null){this.next-=n;if(this.next<=0)this.wake=true;}return Number(this.wake);},
    dispatchPending(){events.push(['dispatch',this.deliverable]);if(this.deliverable)this.wake=false;},
    afterExecution(){events.push(['afterExecution']);},status(){return {fakeOnly:true};},
  };
  session.exceptions=clock;
  t.after(()=>{if(session.state!=='closed')session.close();});
  return {session,cpu,clock,events,powerOff:()=>{powered=false;}};
}
const steps=cpu=>cpu.calls.filter(x=>x[0]==='step');
function sleepOnce(f){f.cpu.actions.push(wfi);return f.session.step(5);}

test('WFI with no eligible event retains ownership without extra instruction starts',async t=>{
  const f=await fixture(t),r=sleepOnce(f);assert.equal(r.reason,'stopped');assert.equal(r.instructions,1);
  assert.equal(f.session.snapshot().sleep.waitingForInterrupt,true);assert.equal(f.session.snapshot().sleep.idleTicks,0);
  assert.deepEqual(steps(f.cpu),[['step',5]]);assert.equal(f.events.filter(x=>x[0]==='clock'||x[0]==='board').length,0);
});
test('A later no-event call stays asleep and executes no CPU step',async t=>{
  const f=await fixture(t);sleepOnce(f);const r=f.session.step(4);
  assert.equal(r.instructions,0);assert.equal(r.totalInstructions,1);assert.equal(r.reason,'stopped');assert.equal(steps(f.cpu).length,1);
});
test('Pending deliverable wake resumes through normal dispatch without idle advancement',async t=>{
  const f=await fixture(t);sleepOnce(f);f.clock.wake=true;f.clock.deliverable=true;f.cpu.actions.push(budget);
  const r=f.session.step(4);assert.equal(r.reason,'budget');assert.equal(r.instructions,4);assert.equal(r.totalInstructions,5);
  assert(f.events.some(x=>x[0]==='dispatch'&&x[1]===true));assert.equal(f.session.snapshot().sleep.waitingForInterrupt,false);
  assert.equal(f.events.filter(x=>x[0]==='board').length,0);
});
test('PRIMASK-style wake resumes with no deliverable handler',async t=>{
  const f=await fixture(t);sleepOnce(f);f.clock.wake=true;f.clock.deliverable=false;f.cpu.actions.push(budget);
  const r=f.session.step(4);assert.equal(r.reason,'budget');assert.equal(r.instructions,4);
  assert.equal(f.events.filter(x=>x[0]==='dispatch'&&x[1]===true).length,0);assert.equal(f.session.idleCounters.ticks,0);
});
test('Next clock wake advances separate paired ticks and preserves requested instruction work',async t=>{
  const f=await fixture(t);f.clock.next=3;f.cpu.actions.push(wfi,budget);const r=f.session.step(5);
  assert.equal(r.reason,'budget');assert.equal(r.instructions,5);assert.equal(r.totalInstructions,5);
  assert.deepEqual(f.events.filter(x=>x[0]==='clock'||x[0]==='board'),[['board',3],['clock',3]]);
  assert.deepEqual(f.session.idleCounters,{ticks:3,quanta:1});assert.deepEqual(steps(f.cpu),[['step',5],['step',4]]);
});
test('Farther event advances one bounded quantum per call while retaining sleep',async t=>{
  const f=await fixture(t);f.clock.next=2000000;const r=sleepOnce(f);
  assert.equal(r.instructions,1);assert.equal(r.reason,'stopped');assert.deepEqual(f.session.idleCounters,{ticks:1000000,quanta:1});
  f.cpu.actions.push(budget);const second=f.session.step(4);assert.equal(second.instructions,4);assert.equal(second.totalInstructions,5);
  assert.deepEqual(f.session.idleCounters,{ticks:2000000,quanta:2});assert.equal(steps(f.cpu).length,2);
});
test('Wake-query failure faults the session and invalidates waiting state',async t=>{
  const f=await fixture(t);f.clock.hasWfiWakePending=()=>{throw Error('injected query failure');};const r=sleepOnce(f);
  assert.equal(r.reason,'fault');assert.equal(f.session.state,'fault');assert.equal(f.session.wfiSleep,undefined);assert.equal(steps(f.cpu).length,1);
});
test('Board-only failed attempt is recorded separately from paired idle ticks',async t=>{
  const f=await fixture(t);f.clock.next=3;f.session.board.tick=n=>{f.events.push(['board',n]);throw Error('injected board failure');};
  const r=sleepOnce(f);assert.equal(r.reason,'fault');assert.deepEqual(f.session.idleCounters,{ticks:0,quanta:0});
  assert.equal(f.session.lastWfiIdle.attemptedTicks,3);assert.equal(f.events.filter(x=>x[0]==='clock').length,0);
});
test('Clock failure preserves attempted board effects without claiming rollback',async t=>{
  const f=await fixture(t);f.clock.next=3;f.clock.advanceSysTick=n=>{f.events.push(['clock',n]);throw Error('injected clock failure');};
  const r=sleepOnce(f);assert.equal(r.reason,'fault');assert.deepEqual(f.session.idleCounters,{ticks:0,quanta:0});
  assert.equal(f.session.lastWfiIdle.attemptedTicks,3);assert.deepEqual(f.events.filter(x=>x[0]==='clock'||x[0]==='board'),[['board',3],['clock',3]]);
});
test('Power loss during idle prevents clock and CPU continuation',async t=>{
  const f=await fixture(t);f.clock.next=3;f.session.board.tick=n=>{f.events.push(['board',n]);f.powerOff();};const r=sleepOnce(f);
  assert.equal(r.reason,'stopped');assert.equal(f.session.state,'halted');assert.equal(f.session.wfiSleep,undefined);
  assert.equal(f.events.filter(x=>x[0]==='clock').length,0);assert.equal(steps(f.cpu).length,1);
});
test('Terminal idle backend loss becomes fault instead of resuming',async t=>{
  const f=await fixture(t);f.clock.next=3;f.session.board.tick=()=>{f.cpu.backendFailed=true;f.cpu.backendFault='injected terminal failure';};
  const r=sleepOnce(f);assert.equal(r.reason,'fault');assert.equal(r.backendLost,true);assert.equal(f.session.wfiSleep,undefined);
  assert.equal(f.events.filter(x=>x[0]==='clock').length,0);assert.equal(steps(f.cpu).length,1);
});
test('Generation/CPU replacement during idle leaves replacement state and counters untouched',async t=>{
  const f=await fixture(t);f.clock.next=3;const replacement=new FakeCPU();
  f.session.board.tick=()=>{f.session.cpu=replacement;f.session.cpuGeneration++;f.session.state='loaded';f.session.wfiSleep=undefined;f.session.idleCounters={ticks:9,quanta:2};};
  const r=sleepOnce(f);assert.equal(r.reason,'stopped');assert.equal(r.pc,0x1002);assert.equal(r.totalInstructions,1);
  assert.equal(f.session.state,'loaded');assert.deepEqual(f.session.idleCounters,{ticks:9,quanta:2});assert.deepEqual(replacement.calls,[]);
});
test('Close during idle retains closed state and avoids a final closed-CPU read',async t=>{
  const f=await fixture(t);f.clock.next=3;f.session.board.tick=()=>f.session.close();const r=sleepOnce(f);
  assert.equal(r.reason,'stopped');assert.equal(f.session.state,'closed');assert.equal(r.pc,0x1002);assert.equal(f.session.wfiSleep,undefined);
});
test('Changed resume PC clears sleep without clock or CPU execution',async t=>{
  const f=await fixture(t);sleepOnce(f);f.cpu.pc=0x2000;f.events.length=0;const r=f.session.step(4);
  assert.equal(r.reason,'stopped');assert.equal(r.pc,0x2000);assert.equal(f.session.wfiSleep,undefined);assert.equal(steps(f.cpu).length,1);assert.deepEqual(f.events,[]);
});
test('Plain explicit stopped response has no sleep handling',async t=>{
  const f=await fixture(t);f.cpu.actions.push(()=>({instructions:1,reason:'stopped'}));const r=f.session.step(5);
  assert.equal(r.reason,'stopped');assert.equal(f.session.wfiSleep,undefined);assert.equal(f.events.filter(x=>x[0]==='wakeQuery').length,0);
});
test('Rejected reset admission retains owned sleep',async t=>{
  const f=await fixture(t);sleepOnce(f);const owned=f.session.wfiSleep;await assert.rejects(f.session.reset({bad:true}));
  assert.equal(f.session.wfiSleep,owned);assert.equal(f.cpu.closed,false);assert.equal(steps(f.cpu).length,1);
});
test('Accepted raw-fixture reset clears waiting and idle counters without guest execution',async t=>{
  const f=await fixture(t);f.clock.next=2000000;sleepOnce(f);const generation=f.session.cpuGeneration;
  const replacement=new FakeCPU();f.session.makeCPU=async()=>{f.clock.cpu=replacement;f.session.exceptions=f.clock;return replacement;};
  await f.session.reset();assert.equal(f.cpu.closed,true);assert.equal(f.session.cpu,replacement);assert.equal(f.session.state,'loaded');
  assert.equal(f.session.wfiSleep,undefined);assert.deepEqual(f.session.idleCounters,{ticks:0,quanta:0});assert.equal(f.session.cpuGeneration,generation+2);
  assert.equal(steps(replacement).length,0);
});
test('Executed WFI at exact requested budget retains sleep for the next call',async t=>{
  const f=await fixture(t);f.clock.next=3;f.cpu.actions.push(()=>({...wfi(),reason:'budget'}));
  const r=f.session.step(1);assert.equal(r.reason,'budget');assert.equal(r.instructions,1);assert(f.session.wfiSleep);
  assert.equal(f.events.filter(x=>x[0]==='board'||x[0]==='clock').length,0);
  f.cpu.actions.push(budget);const resumed=f.session.step(4);assert.equal(resumed.reason,'budget');assert.equal(resumed.instructions,4);
  assert.deepEqual(f.session.idleCounters,{ticks:3,quanta:1});
});
test('Repeated valid WFI clock wakes have an independent per-call work limit',async t=>{
  const f=await fixture(t);f.clock.next=3;
  f.clock.dispatchPending=function(){this.wake=false;this.next=3;};
  for(let i=0;i<65;i++)f.cpu.actions.push(wfi);
  const r=f.session.step(1000);assert.equal(r.reason,'stopped');assert.equal(r.instructions,65);assert.equal(r.totalInstructions,65);
  assert.equal(f.events.filter(x=>x[0]==='clock').length,64);assert.equal(steps(f.cpu).length,65);
  assert.deepEqual(f.session.idleCounters,{ticks:192,quanta:64});assert(f.session.wfiSleep);
  assert.equal(f.session.lastWfiIdle.reason,'quantum-limit');
});
test('Consecutive no-instruction transitions fault after a small independent bound',async t=>{
  const f=await fixture(t);for(let i=0;i<100;i++)f.cpu.actions.push(()=>budget(0));
  const r=f.session.step(1000000);assert.equal(r.reason,'fault');assert.match(r.fault,/64 retries/);
  assert.equal(r.instructions,0);assert.equal(steps(f.cpu).length,64);
});
test('Returned sleep metadata cannot mutate the private owned record',async t=>{
  const f=await fixture(t),r=sleepOnce(f);r.sleep.resumePc=0x3000;
  assert.equal(f.session.wfiSleep.metadata.resumePc,0x1002);
  const again=f.session.step(4);assert.equal(again.pc,0x1002);assert.equal(again.reason,'stopped');assert(f.session.wfiSleep);
});
test('Non-paused same-owner state changes retain that state and clear stale sleep',async t=>{
  for(const state of ['fault','halted','loaded']) {
    const f=await fixture(t);f.clock.next=3;f.session.board.tick=()=>{f.session.state=state;};const r=sleepOnce(f);
    assert.equal(r.reason,'stopped');assert.equal(f.session.state,state);assert.equal(f.session.wfiSleep,undefined);
    assert.deepEqual(f.session.idleCounters,{ticks:0,quanta:0});assert.equal(f.session.snapshot().sleep.waitingForInterrupt,false);
    assert.equal(f.events.filter(x=>x[0]==='clock').length,0);
  }
});
test('Failed direct CPU cleanup still leaves Session closed and invalidates sleep',async t=>{
  const f=await fixture(t);sleepOnce(f);f.cpu.close=()=>{f.cpu.closed=true;throw Error('injected cleanup failure');};
  assert.throws(()=>f.session.close(),/cleanup failure/);assert.equal(f.session.state,'closed');assert.equal(f.session.wfiSleep,undefined);
  assert.throws(()=>f.session.step(4),/closed/);
});
test('Throwing cleanup during idle leaves closed state without a later CPU read',async t=>{
  const f=await fixture(t);f.clock.next=3;f.cpu.close=()=>{f.cpu.closed=true;throw Error('injected cleanup failure');};
  f.session.board.tick=()=>f.session.close();const r=sleepOnce(f);
  assert.equal(r.reason,'stopped');assert.equal(f.session.state,'closed');assert.equal(f.session.wfiSleep,undefined);
  assert.equal(f.events.filter(x=>x[0]==='clock').length,0);
});
